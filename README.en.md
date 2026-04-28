# ROMたん (Romtan)

**Real-time lurker detection desktop app for Twitch streamers**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Platform: Windows](https://img.shields.io/badge/Platform-Windows-lightgrey.svg)](https://github.com/cypress-sticker/romtan/releases)
[![Version](https://img.shields.io/badge/Version-1.0.5-green.svg)](https://github.com/cypress-sticker/romtan/releases)

[日本語 README](README.md)

Romtan detects viewers entering your Twitch channel in real time and shows a desktop popup notification — even for lurkers who never type in chat.

> ⚠️ **Windows only** at this time.  
> Due to Twitch API limitations, there is a **1–2 minute delay** between a viewer joining and the notification appearing.

---

## Features

- **Join popup notifications** — Desktop overlay alert when a viewer enters your channel
- **Click-through overlay** — Floats above your stream, never blocking your mouse
- **Notification sounds** — Audio alert on join (toggleable)
- **Customizable position** — Choose from corners or center of screen
- **Dark / Light mode**
- **Join log** — View join history in a separate window

---

## Download

Grab the latest `.zip` from [Releases](https://github.com/cypress-sticker/romtan/releases).

> **About the Windows warning on first launch**  
> Windows may show a "Windows protected your PC" dialog. Click "More info" → "Run anyway" to proceed. This appears because the app is not code-signed.

---

## Usage

1. Extract the `.zip` and launch `ROMたん.exe`
2. Click **"Login with Twitch"** and authorize
3. Configure notification position and sound, then click **"Connect"**
4. A popup will appear whenever a viewer joins your channel

---

## Development Setup

### Requirements
- [Node.js](https://nodejs.org/) 18+
- A Twitch Developer Application (create one at [dev.twitch.tv/console](https://dev.twitch.tv/console))

### Steps

```bash
git clone https://github.com/cypress-sticker/romtan.git
cd romtan
npm install
```

Copy `.env.example` to `.env` and fill in your Twitch Client ID:

```bash
cp .env.example .env
# Edit .env and set TWITCH_CLIENT_ID
```

In the Twitch Developer Console, set the following:
- **OAuth Redirect URL**: `http://localhost:3000`

```bash
npm start
```

### Build

```bash
npm run build
```

Output goes to `release/` — a portable `.zip`.

---

## Architecture

```
main.js              ← Electron main process (OAuth, API polling, IPC)
preload.js           ← IPC bridge (context bridge)
renderer/
  control.html       ← Control panel (settings & connect UI)
  overlay.html       ← Overlay window (popup notifications)
  log.html           ← Join history log window
  manual.html        ← In-app manual
  assets/            ← CSS, JS, sound effects
```

**How it works:**
1. `main.js` polls the Twitch Chatters API every 5 seconds
2. New joiners are detected and sent to `control.html` via IPC
3. `control.html` → `main.js` → `overlay.html` to trigger the popup
4. `overlay.html` renders the notification

---

## Contributing

Bug reports, feature requests, and pull requests are all welcome!  
See [CONTRIBUTING.md](CONTRIBUTING.md) for details.

---

## License

[MIT](LICENSE) © cypress_sticker
