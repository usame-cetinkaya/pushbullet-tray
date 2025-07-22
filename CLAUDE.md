# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

- `npm run dev` - Run the Electron app in development mode
- `npm run build` - Build the application using electron-builder
- `npx prettier --write .` - Format code with Prettier

## Architecture Overview

This is a macOS tray application built with Electron that integrates with Pushbullet's WebSocket API to display Android notifications on macOS. The application consists of a single main process file (`main.js`) that handles:

### Core Components

- **Tray Interface**: System tray icon with context menu for user interactions
- **WebSocket Client**: Real-time connection to Pushbullet's streaming API (`wss://stream.pushbullet.com/websocket/`)
- **Notification System**: macOS native notifications that sync with Android device dismissals
- **Credential Management**: Secure token storage using the `keytar` library (macOS Keychain)

### Key Features

- **Bidirectional Notification Sync**: Dismissing notifications on either macOS or Android dismisses them on both
- **Connection Recovery**: Automatic WebSocket reconnection with 30-second intervals
- **Error State Indication**: Tray icon changes to error.png when connection issues occur
- **Auto-launch**: Configured to start on system boot and run in background

### Data Flow

1. WebSocket receives push messages from Pushbullet API
2. Mirror notifications create macOS Notification objects
3. User interactions (click/dismiss) send dismissal requests back to Pushbullet
4. Dismissal messages from Android automatically close local notifications

### File Structure

- `main.js` - Single-file application containing all logic
- `resources/` - Icons (icon.png for normal state, error.png for error state)
- `dist/` - Build output directory with packaged .app and .dmg files

### API Integration

- **WebSocket Stream**: Real-time push notifications and dismissals
- **REST API**: Token validation, push history management, and dismissal sending
- **Authentication**: Uses Pushbullet access tokens stored securely in macOS Keychain

### State Management

The application maintains several key state variables:

- `activeNotifications` Map for tracking displayed notifications
- `latestModified` timestamp for fetching incremental push updates
- `latestNop` for monitoring WebSocket health via heartbeat messages
