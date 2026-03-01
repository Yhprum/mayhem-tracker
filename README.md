# Mayhem Tracker

Desktop app for tracking ARAM Mayhem match history in League of Legends. Connects to the League Client (LCU) to automatically record matches and display stats.

## Features

- Automatic match detection via League Client API
- Match history with detailed game breakdowns
- Champion, augment, and friend stats with win rates
- Aggregate statistics from all players in your games
- Local SQLite database

## Tech Stack

Electron + React + TypeScript, built with electron-vite. Uses Tailwind CSS for styling, better-sqlite3 for local storage, and league-connect for LCU integration.

## Development

```bash
npm install
npm run rebuild   # rebuild native modules for Electron
npm run dev       # start in dev mode
```

## Build

```bash
npm run dist      # build Windows portable executable
```

## Disclaimer

Mayhem Tracker was created under Riot Games' "Legal Jibber Jabber" policy using assets owned by Riot Games. Riot Games does not endorse or sponsor this project.
