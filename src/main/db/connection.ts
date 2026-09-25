import Database from "better-sqlite3";
import path from "path";
import { getDataDir } from "../paths";

// The one connection to matches.db that every other db module works through.
// initDatabase (schema.ts) opens it and brings the tables up to date.
export let db: Database.Database;

export function getDbPath() {
  return path.join(getDataDir(), "matches.db");
}

export function openDatabase() {
  db = new Database(getDbPath());
  db.pragma("journal_mode = WAL");
  // NORMAL is the standard companion to WAL: commits stop waiting on an fsync,
  // which is what makes a several-thousand-game backfill bearable. The only
  // exposure is losing the most recent commits to an OS crash, and everything
  // here is re-fetchable from the client.
  db.pragma("synchronous = NORMAL");
  db.pragma("foreign_keys = ON");
}

// Checkpoints the WAL and releases the file. Without this a quit leaves the
// -wal alongside the database to be replayed on next launch.
export function closeDatabase() {
  if (!db || !db.open) return;
  try {
    db.close();
  } catch (err) {
    console.error("Failed to close database:", err);
  }
}

export function getDatabase(): Database.Database {
  return db;
}
