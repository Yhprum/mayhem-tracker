# Mayhem Tracker

Desktop app for tracking complete League of Legends match history locally. It can connect to the League Client (LCU) for automatic detection and uses Riot's Match-V5 API for complete historical sync.

<img width="1280" height="820" alt="image" src="https://github.com/user-attachments/assets/cdce7dae-d96e-4be0-8d0a-bf9c7ee245d3" />

## Features

- Automatic match detection via League Client API
- Imports all queues by default, including ARAM Mayhem
- Match history with detailed game breakdowns
- Champion, augment, and friend stats with win rates
- Aggregate statistics from all players in your games
- Local SQLite database
- Offline-first cached match history with incremental Riot API sync

## Tech Stack

Electron + React + TypeScript, built with electron-vite. Uses Tailwind CSS for styling, better-sqlite3 for local storage, and league-connect for LCU integration.

## Riot API configuration

The API key is read only by Electron's main process from `RIOT_API_KEY`; it is never exposed to the renderer or stored in the database. Treat keys shared in chat or source control as compromised and rotate them. For local development, set it in the shell before starting the app:

```powershell
$env:RIOT_API_KEY = "RGAPI-your-development-key"
npm run dev
```

Open **Settings** and enter the Riot ID and platform routing code (for example `na1`, `euw1`, or `kr`) when the League Client is not running. The client is used opportunistically to detect the active account; it is not required for historical Riot API sync. Regional routing is derived from the platform code and uses Account-V1 plus Match-V5 correctly.

## League Client access and local data

Automatic recent-game capture and account detection require the desktop League Client to be running and accessible to the same Windows user. Running the client elevated may require running this app elevated too. If the client is unavailable, configure a Riot ID and use **Sync all League games** in Settings.

Development data is stored in `data/matches.db` under the project directory. Packaged builds store the SQLite database under Electron's user-data directory. The database, WAL files, and backups remain local; previously synced matches can be viewed without network access.

## Development

```bash
npm install
npm run rebuild   # rebuild native modules for Electron
npm run dev       # start in dev mode
```

`better-sqlite3` is a native module and must use the ABI shipped with the
installed Electron version. `npm install` runs the configured postinstall hook
to rebuild it automatically. If Electron reports a `NODE_MODULE_VERSION`
mismatch, run these commands from the project root:

```powershell
npm rebuild better-sqlite3
npx electron-rebuild -w better-sqlite3
npm run dev
```

If the rebuild still fails, perform a clean install in PowerShell:

```powershell
Remove-Item -Recurse -Force node_modules
Remove-Item -Force package-lock.json
npm install
npm run dev
```

These run on pull requests, again before a tagged release, and locally via
`preversion` — so `npm version` will not tag a tree that fails them:

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
