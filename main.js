const { app, Menu, nativeImage, Notification, Tray } = require("electron");
const prompt = require("electron-prompt");
const keytar = require("keytar");
const WebSocket = require("ws");
const path = require("path");
const forge = require("node-forge");

const PUSHBULLET_WS_URL = `wss://stream.pushbullet.com/websocket/`;
const PUSHBULLET_DISMISS_URL = "https://api.pushbullet.com/v2/ephemerals";
const PUSHBULLET_PUSHES_URL = "https://api.pushbullet.com/v2/pushes";
const NOP_INTERVAL = 30000;
const activeNotifications = new Map();
let user = null;
let accessToken = null;
let tray = null;
let interval = null;
let ws = null;
let latestModified = null;
let latestNop = null;
let e2eeEnabled = false;
let e2eePassword = null;

process.on("uncaughtException", (error) => {
  console.error("Uncaught Exception:", error);
});

app.on("window-all-closed", (event) => {
  event.preventDefault();
});

app.on("ready", async () => {
  await prepareTray();

  app.dock.hide();

  app.setLoginItemSettings({
    openAtLogin: true,
    openAsHidden: true,
  });

  // Test notification support
  if (!Notification.isSupported()) {
    console.log("Notifications are not supported on this system");
  }
});

function connectPushbulletWebSocket() {
  if (ws) {
    ws.removeAllListeners();
  }

  ws = new WebSocket(PUSHBULLET_WS_URL + accessToken);

  getUser();

  ws.on("open", () => {
    prepareTray();

    latestModified = null;
    // log("WebSocket open");
    getLatestPushes();
  });

  ws.on("message", (data) => {
    prepareTray();

    const message = JSON.parse(data);

    switch (message.type) {
      case "nop":
        latestNop = new Date();
        break;
      case "push":
        const decryptedPush = decryptPush(message.push);
        if (decryptedPush.type === "mirror") {
          showNotification(decryptedPush);
        } else if (decryptedPush.type === "dismissal") {
          dismissNotification(decryptedPush);
        }
        break;
      case "tickle":
        if (message.subtype === "push") {
          getLatestPushes();
        }
        break;
    }
  });

  ws.on("close", () => {
    log("WebSocket closed, reconnecting...");
    setTimeout(connectPushbulletWebSocket, NOP_INTERVAL);
  });

  ws.on("error", (error) => {
    log(`WebSocket error: ${error.message}`);
    setTimeout(connectPushbulletWebSocket, NOP_INTERVAL);
  });
}

function showNotification(push) {
  if (!push.application_name) {
    push.application_name = "Pushbullet";
  }

  // Check if notifications are supported
  if (!Notification.isSupported()) {
    log("Notifications are not supported on this system");
    return;
  }

  try {
    const notification = new Notification({
      title: `${push.application_name}${push.title ? `: ${push.title}` : ""}`,
      body: push.body || "",
      icon: nativeImage.createFromDataURL(
        `data:image/jpeg;base64,${push.icon}`,
      ),
    });

    const key = getNotificationKey(push);

    if (activeNotifications.has(key)) {
      return;
    }

    notification.on("click", () => {
      sendDismissalToAndroid(push);
    });

    notification.on("close", () => {
      sendDismissalToAndroid(push);
    });

    activeNotifications.set(key, notification);

    notification.show();
  } catch (error) {
    log(
      `Please enable notifications in System Preferences > Notifications > Pushbullet Tray`,
    );
  }
}

function dismissNotification(push) {
  const key = getNotificationKey(push);

  if (!activeNotifications.has(key)) {
    return;
  }

  const notification = activeNotifications.get(key);
  notification.close();
  activeNotifications.delete(key);
}

function sendDismissalToAndroid(push) {
  fetch(PUSHBULLET_DISMISS_URL, {
    method: "POST",
    headers: {
      "Access-Token": accessToken,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      push: {
        ...ephemeralFields(push),
        type: "dismissal",
      },
      type: "push",
    }),
  })
    .then(() => {
      dismissNotification(push);
    })
    .catch((error) => {
      log(`Error sending dismissal: ${error.message}`);
    });
}

function deleteAllPushes() {
  latestModified = null;

  fetch("https://api.pushbullet.com/v2/pushes", {
    method: "DELETE",
    headers: {
      "Access-Token": accessToken,
    },
  })
    .then(() => {
      // log("Push history cleared");
    })
    .catch((error) => {
      log(`Error clearing push history: ${error.message}`);
    });
}

function getLatestPushes() {
  let url = PUSHBULLET_PUSHES_URL;
  if (latestModified) {
    url += `?modified_after=${latestModified}`;
  } else {
    url += `?limit=1`;
  }
  fetch(url, {
    headers: {
      "Access-Token": accessToken,
    },
  })
    .then((response) => response.json())
    .then((data) => {
      if (latestModified) {
        data?.pushes
          ?.filter((push) => push?.type)
          ?.forEach((push) => {
            const decryptedPush = decryptPush(push);
            if (decryptedPush.dismissed) {
              dismissNotification(decryptedPush);
            } else {
              showNotification(decryptedPush);
            }
          });
      }
      if (data?.pushes?.[0]?.modified) {
        latestModified = data.pushes[0].modified;
      }
    })
    .catch((error) => {
      log(`Error fetching pushes: ${error.message}`);
    });
}

function ephemeralFields(push) {
  return {
    notification_id: push.notification_id,
    notification_tag: push.notification_tag,
    package_name: push.package_name,
    source_user_iden: push.source_user_iden,
  };
}

function getNotificationKey(push) {
  return push.iden || JSON.stringify(ephemeralFields(push));
}

function log(message) {
  prepareTray(message);
}

function getUser() {
  fetch("https://api.pushbullet.com/v2/users/me", {
    headers: {
      "Access-Token": accessToken,
    },
  })
    .then((response) => response.json())
    .then((data) => {
      user = data;
    })
    .catch((error) => {
      log(`Error fetching user data`);
    });
}

// E2EE Helper Functions
function deriveKey(password) {
  const pseudorandom_function = forge.md.sha256.create();
  const salt = user.iden;
  const iterations = 30000;
  const derived_key_length_bytes = 32; // 256-bit
  return forge.pkcs5.pbkdf2(
    password,
    salt,
    iterations,
    derived_key_length_bytes,
    pseudorandom_function,
  );
}

function decryptE2EE(ciphertext, password) {
  try {
    const key = deriveKey(password);
    console.log({ key });
    const encoded_message = atob(ciphertext);
    console.log({ encoded_message });

    const version = encoded_message.substr(0, 1);
    const tag = encoded_message.substr(1, 16); // 128 bits
    const initialization_vector = encoded_message.substr(17, 12); // 96 bits
    const encrypted_message = encoded_message.substr(29);

    if (version !== "1") {
      throw "invalid version";
    }

    const decipher = forge.cipher.createDecipher("AES-GCM", key);
    decipher.start({
      iv: initialization_vector,
      tag: tag,
    });
    decipher.update(forge.util.createBuffer(encrypted_message));
    decipher.finish();

    const message = decipher.output.toString("utf8");

    return JSON.parse(message);
  } catch (error) {
    console.log({ error });
    log(`E2EE decryption failed: ${error.message}`);
    return null;
  }
}

function decryptPush(push) {
  if (!push.encrypted) {
    return push;
  }

  if (!e2eeEnabled) {
    log("E2EE is not enabled, cannot decrypt push");
    return push;
  }

  try {
    const decryptedData = decryptE2EE(push.ciphertext, e2eePassword);
    if (!decryptedData) {
      log("Failed to decrypt push message");
      return push;
    }

    // Merge decrypted data with original push, preserving metadata
    return {
      ...push,
      ...decryptedData,
      encrypted: false, // Mark as decrypted
    };
  } catch (error) {
    log(`Error decrypting push: ${error.message}`);
    return push; // Return original push if decryption fails
  }
}

async function prepareTray(error = null) {
  const trayIconPath = app.isPackaged
    ? path.join(process.resourcesPath, "resources", "icon.png")
    : "resources/icon.png";
  const errorIconPath = app.isPackaged
    ? path.join(process.resourcesPath, "resources", "error.png")
    : "resources/error.png";
  let icon = nativeImage.createFromPath(error ? errorIconPath : trayIconPath);
  let trayIcon = icon.resize({ width: 24, height: 24 });
  trayIcon.setTemplateImage(true);

  accessToken = await keytar.getPassword("Pushbullet Tray", "accessToken");

  // Load E2EE settings
  e2eePassword = await keytar.getPassword("Pushbullet Tray", "e2eePassword");
  e2eeEnabled = !!e2eePassword;

  const menuItems = [];

  if (accessToken) {
    menuItems.push(
      {
        label: "Clear Access Token",
        click: () => clearAccessToken(),
      },
      { type: "separator" },
      {
        label: e2eeEnabled
          ? "✓ End-to-End Encryption Enabled"
          : "Enable End-to-End Encryption...",
        click: () => toggleE2EE(),
      },
      { type: "separator" },
      {
        label: "Delete Push History",
        click: () => deleteAllPushes(),
      },
    );

    if (!interval) {
      connectPushbulletWebSocket();

      interval = setInterval(() => {
        const now = new Date();
        if (now - latestNop > 2 * NOP_INTERVAL) {
          setTimeout(connectPushbulletWebSocket, 0);
        }
      }, NOP_INTERVAL / 2);
    }
  } else {
    menuItems.push({
      label: "Set Access Token...",
      click: () => promptAccessToken(),
    });

    if (interval) {
      clearInterval(interval);
      interval = null;
    }
  }

  menuItems.push(
    {
      type: "separator",
    },
    {
      label: "Quit",
      click: () => app.quit(),
    },
  );

  const trayMenu = Menu.buildFromTemplate(menuItems);

  if (!tray) {
    tray = new Tray(trayIcon);
  }
  tray.setImage(trayIcon);
  tray.setToolTip(error ? error : "Pushbullet Tray");
  tray.setContextMenu(trayMenu);
}

async function promptAccessToken() {
  try {
    const token = await prompt({
      title: "Enter Access Token",
      label: "Access Token:",
      inputAttrs: {
        type: "password",
      },
      type: "input",
      height: 180,
    });

    if (token !== null) {
      await keytar.setPassword("Pushbullet Tray", "accessToken", token);
      await prepareTray();
    }
  } catch (error) {
    log(`Error prompting for token: ${error}`);
  }
}

async function clearAccessToken() {
  await keytar.deletePassword("Pushbullet Tray", "accessToken");
  await prepareTray();
}

async function promptE2EEPassword() {
  try {
    const password = await prompt({
      title: "Enter E2EE Password",
      label: "Encryption Password:",
      inputAttrs: {
        type: "password",
      },
      type: "input",
      height: 180,
    });

    if (password !== null) {
      await keytar.setPassword("Pushbullet Tray", "e2eePassword", password);
      e2eePassword = password;
      e2eeEnabled = true;
      await prepareTray();
    }
  } catch (error) {
    log(`Error prompting for E2EE password: ${error}`);
  }
}

async function clearE2EEPassword() {
  await keytar.deletePassword("Pushbullet Tray", "e2eePassword");
  e2eePassword = null;
  e2eeEnabled = false;
  await prepareTray();
}

async function toggleE2EE() {
  if (e2eeEnabled) {
    await clearE2EEPassword();
  } else {
    await promptE2EEPassword();
  }
}
