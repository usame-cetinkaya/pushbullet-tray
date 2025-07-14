const { app, Menu, nativeImage, Notification, Tray } = require("electron");
const prompt = require("electron-prompt");
const keytar = require("keytar");
const WebSocket = require("ws");
const path = require("path");

const PUSHBULLET_WS_URL = `wss://stream.pushbullet.com/websocket/`;
const PUSHBULLET_DISMISS_URL = "https://api.pushbullet.com/v2/ephemerals";
const PUSHBULLET_PUSHES_URL = "https://api.pushbullet.com/v2/pushes";
const NOP_INTERVAL = 30000;
const activeNotifications = new Map();
let accessToken = null;
let tray = null;
let interval = null;
let ws = null;
let latestModified = null;
let latestNop = null;

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
});

function connectPushbulletWebSocket() {
  if (ws) {
    ws.removeAllListeners();
  }

  ws = new WebSocket(PUSHBULLET_WS_URL + accessToken);

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
        if (message.push.type === "mirror") {
          showNotification(message.push);
        } else if (message.push.type === "dismissal") {
          dismissNotification(message.push);
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

  const notification = new Notification({
    title: `${push.application_name}${push.title ? `: ${push.title}` : ""}`,
    body: push.body || "",
    icon: nativeImage.createFromDataURL(`data:image/jpeg;base64,${push.icon}`),
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
            if (push.dismissed) {
              dismissNotification(push);
            } else {
              showNotification(push);
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

  const menuItems = [];

  if (accessToken) {
    menuItems.push(
      {
        label: "Clear Access Token",
        click: () => clearAccessToken(),
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
