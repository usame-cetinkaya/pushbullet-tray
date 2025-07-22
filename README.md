# pushbullet-tray

This is a command bar only [Pushbullet](https://www.pushbullet.com/) client for MacOS built with [Electron](https://www.electronjs.org/).

## Features

- Displays mirrored Android notifications from Pushbullet on MacOS.
- Displays push notifications sent to your Pushbullet account via API.
- Runs on system startup. That way you don't have to remember to open it every time you restart your computer.

## Mirrored Notifications

- Dissmiss notifications on MacOS and they will be dismissed on your Android device.
- Dismiss notifications on your Android device and they will be dismissed on MacOS.

## Installation

1. Download the latest `.dmg` file from [Releases](https://github.com/robert-cardillo/pushbullet-tray/releases) page.
2. Double-click it when it is downloaded.
3. A window will open.
4. Drag the "Pushbullet Tray.app" icon on to the "Applications" icon.
5. App is installed now!
6. Run it from the MacOS Launchpad, or Spotlight (Cmd+Space).

When you run the app you might see a warning like this:

> macOS cannot verify the developer of "Pushbullet Tray". Are you sure you want to open it?

Here is how to fix it:

1. Click **Cancel** button of the warning message.
2. Go to **System Settings > Privacy & Security**.
3. Scroll down to the bottom.
4. Find the message **"Pushbullet Tray" was blocked...** and click **Open Anyway** button.

You can also refer to this [Apple Support](https://support.apple.com/guide/mac-help/open-a-mac-app-from-an-unknown-developer-mh40616/mac) page for more information.

## Connecting Your Pushbullet Account

1. Go to [Pushbullet](https://www.pushbullet.com/) and sign in.
2. On the left side of the screen, click **Settings**.
3. On the right side of the screen, click **Create Access Token** button.
4. Copy the access token.
5. Open the **Pushbullet** app. You can find it in MacOS Launchpad.
6. Click on the icon in the menu bar.
7. Click on the **Set Access Token...** option in the menu.
8. Paste your Pushbullet access token and click **OK**.

## A Note About `Delete Push History` Option

If you are using Pushbullet to get notifications from other services like me, you may want to delete the push history from time to time. This option will delete all push history from your Pushbullet account. It will not delete the notifications from your Android device.
