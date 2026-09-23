# Mayhem Tracker

Desktop app for tracking ARAM Mayhem match history in League of Legends. Connects to the League Client (LCU) to automatically record matches and display stats.

<img width="1280" height="820" alt="image" src="https://github.com/user-attachments/assets/cdce7dae-d96e-4be0-8d0a-bf9c7ee245d3" />

## Features

- Automatic match detection via League Client API
- Supports the limited-time ARAM Mayhem Classic-ish game mode
- Match history with detailed game breakdowns
- Live scoreboard while a game is running, and a post-game recap when it ends
- Export any game as a shareable PNG from the recap or the match list
- Champion, augment, and friend stats with win rates
- Aggregate statistics from all players in your games
- Local SQLite database

## Download

Grab `MayhemTracker.exe` from the [latest release](https://github.com/Yhprum/mayhem-tracker/releases/latest) and run it. It's a portable Windows build with no installer, so it can live anywhere.

## Usage

1. Start the League client and sign in. The app talks to the client's local API, so the client has to be running for it to detect your account, import history, or record new games.
2. Launch Mayhem Tracker. The sidebar shows the connection status once it finds the client.
3. The first time an account connects it automatically imports your past Mayhem games. Riot only serves an account's last 1000 matches across all queues, so that window is how far back the import can reach. A large one takes a few minutes and fills the app in as it runs.
4. After that it records each game as you finish it, so leave it running while you play.

You can re-run the import at any time from **Settings → Backfill match history**, which is also how you finish one you cancelled. Games already stored stay readable with the client closed; only importing and recording need it open.

Match data lives in `%APPDATA%\mayhem-tracker\data`, with automatic backups alongside it. The app checks GitHub for new releases and offers to update itself when one lands.

## Tech Stack

Electron + React + TypeScript, built with electron-vite. Uses Tailwind CSS for styling, better-sqlite3 for local storage, and league-connect for LCU integration.

## Development

```bash
npm install
npm run dev       # start in dev mode
```

better-sqlite3 ships prebuilt Node-API binaries, so there is no native module to rebuild for Electron. The Electron binary itself downloads the first time `npm run dev` needs it.

These run on pull requests, again before a tagged release, and locally via
`preversion`, so `npm version` will not tag a tree that fails them:

```bash
npm run typecheck
npm run lint
npm run format    # rewrites in place; format:check only reports
```

## Build

```bash
npm run dist      # build Windows portable executable
```

## Disclaimer

Mayhem Tracker was created under Riot Games' "Legal Jibber Jabber" policy using assets owned by Riot Games. Riot Games does not endorse or sponsor this project.
