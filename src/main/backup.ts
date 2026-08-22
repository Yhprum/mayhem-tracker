import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { closeDatabase, getDatabase, getDbPath, getSetting, initDatabase } from "./db";
import { getBackupDir } from "./paths";

// Snapshots are taken through SQLite's online backup API rather than by copying
// matches.db off disk. The database runs in WAL mode, so the file on its own is
// missing every commit still sitting in the -wal: copying it produces a
// database that is stale at best and unopenable at worst.
//
// The copy runs a hundred pages at a time, returning to the event loop between
// steps, so a poll landing a game mid-backup doesn't block on it. That the
// backup is stepped rather than instantaneous is safe here because it reads
// through the same connection everything else writes on — SQLite applies those
// writes to the copy in flight instead of leaving it torn across versions.

// How stale the newest snapshot may get before the scheduler takes another
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
// The scheduler only checks staleness, so this is a resolution, not a rate:
// snapshots still land roughly a day apart no matter how long the app runs.
const CHECK_INTERVAL_MS = 60 * 60 * 1000;

// Tiered retention rather than "keep the last N". Corruption is often noticed
// days after it happened, and a flat window of daily snapshots can be fully
// rotated out by then.
//
// The tiers overlap heavily — the newest snapshot is the representative of its
// day, its week and its month all at once — so each tier has to be counted
// generously to reach back as far as it sounds like it does. Six monthly slots
// buy roughly half a year of horizon; three would have bought about three
// weeks, because the first two would be spent on months the weekly tier
// already covers. In steady use this settles at a dozen or so files.
const KEEP_RECENT = 5;
const KEEP_WEEKLY = 4;
const KEEP_MONTHLY = 6;

export type BackupReason = "auto" | "manual" | "pre-import" | "pre-repair" | "pre-restore";

export interface BackupInfo {
  file: string;
  created: number;
  size: number;
  games: number | null;
  reason: string;
}

export interface RecoveryReport {
  problem: "missing" | "corrupt";
  restoredFrom: string | null;
  quarantined: string | null;
  detail?: string;
}

const FILE_RE = /^matches-(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2})-([a-z-]+)\.db$/;

let recoveryReport: RecoveryReport | null = null;
let scheduleTimer: NodeJS.Timeout | null = null;
// Backups are async, so the hourly check, a Settings-page click and a
// pre-import snapshot can all be in flight at once. They would race over the
// same directory and prune each other's files, so they share one run instead.
let inFlight: Promise<BackupInfo> | null = null;

function stamp(date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return (
    `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}` +
    `T${p(date.getHours())}-${p(date.getMinutes())}-${p(date.getSeconds())}`
  );
}

// The inverse of stamp: "2026-08-22T14-30-05" is the local time it was taken,
// so the colons go back before Date parses it as local rather than as UTC.
function parseStamp(text: string): number {
  const iso = text.replace(/T(\d{2})-(\d{2})-(\d{2})$/, "T$1:$2:$3");
  const ms = new Date(iso).getTime();
  return Number.isNaN(ms) ? 0 : ms;
}

function countGames(db: Database.Database): number {
  return (db.prepare("SELECT COUNT(*) AS n FROM games").get() as { n: number }).n;
}

// Opens a finished snapshot and decides whether it can be trusted. Anything
// that throws here means the file is not a backup we would ever restore.
function verifySnapshot(file: string): number {
  const snap = new Database(file);
  try {
    const result = snap.pragma("quick_check") as { quick_check: string }[];
    if (result[0]?.quick_check !== "ok") {
      throw new Error(`integrity check failed: ${result[0]?.quick_check ?? "unknown"}`);
    }
    const games = countGames(snap);
    // The copy inherits WAL mode from the source, and a WAL database can't be
    // opened read-only without writing its -shm alongside it. Storing snapshots
    // in rollback-journal mode keeps each one a single self-contained file that
    // listing and verification can open without modifying anything.
    snap.pragma("journal_mode = DELETE");
    return games;
  } finally {
    snap.close();
  }
}

function describe(file: string): BackupInfo | null {
  const match = FILE_RE.exec(file);
  if (!match) return null;
  let size = 0;
  try {
    size = fs.statSync(path.join(getBackupDir(), file)).size;
  } catch {
    return null;
  }
  return { file, created: parseStamp(match[1]), size, games: null, reason: match[2] };
}

// Newest first. Names carry the timestamp, so this never depends on mtimes,
// which a copy or a sync client is free to rewrite.
function readBackups(): BackupInfo[] {
  let names: string[];
  try {
    names = fs.readdirSync(getBackupDir());
  } catch (err) {
    console.error("Failed to read backup directory:", err);
    return [];
  }
  return names
    .map(describe)
    .filter((backup): backup is BackupInfo => backup !== null)
    .sort((a, b) => b.created - a.created);
}

export function listBackups(): BackupInfo[] {
  const dir = getBackupDir();
  return readBackups().map((backup) => {
    try {
      const snap = new Database(path.join(dir, backup.file), { readonly: true });
      try {
        return { ...backup, games: countGames(snap) };
      } finally {
        snap.close();
      }
    } catch {
      // A snapshot too damaged to read still belongs in the list — the user
      // should see that it exists and that its contents are unknown.
      return backup;
    }
  });
}

// Grandfather-father-son: the newest few unconditionally, then the newest
// snapshot from each of the last few weeks and months. Everything else goes.
function prune(backups: BackupInfo[]): void {
  const keep = new Set<string>();
  for (const backup of backups.slice(0, KEEP_RECENT)) keep.add(backup.file);

  const bucket = (key: (date: Date) => string, limit: number) => {
    const seen = new Set<string>();
    for (const backup of backups) {
      const id = key(new Date(backup.created));
      if (seen.has(id)) continue;
      seen.add(id);
      if (seen.size > limit) break;
      keep.add(backup.file);
    }
  };
  // Week key: the date of the Sunday that starts it, which needs no ISO-week
  // arithmetic and groups exactly the same way.
  bucket((date) => {
    const start = new Date(date.getFullYear(), date.getMonth(), date.getDate() - date.getDay());
    return stamp(start).slice(0, 10);
  }, KEEP_WEEKLY);
  bucket((date) => `${date.getFullYear()}-${date.getMonth()}`, KEEP_MONTHLY);

  const dir = getBackupDir();
  for (const backup of backups) {
    if (keep.has(backup.file)) continue;
    try {
      fs.rmSync(path.join(dir, backup.file), { force: true });
    } catch (err) {
      console.error("Failed to remove old backup:", backup.file, err);
    }
  }
}

async function runBackup(reason: BackupReason): Promise<BackupInfo> {
  const db = getDatabase();
  const before = countGames(db);

  const created = new Date();
  const file = `matches-${stamp(created)}-${reason}.db`;
  const dest = path.join(getBackupDir(), file);
  // Written under a name the listing ignores, so a crash or a full disk part
  // way through can't leave a truncated file that looks like a usable backup.
  const partial = `${dest}.part`;
  try {
    await db.backup(partial);
    const games = verifySnapshot(partial);
    if (games < before) {
      throw new Error(`snapshot holds ${games} games, database had ${before}`);
    }
    fs.renameSync(partial, dest);
    const size = fs.statSync(dest).size;
    // Only once the new snapshot is on disk and verified: a database that has
    // already gone bad must never be able to rotate out the good copies.
    prune(readBackups());
    return { file, created: created.getTime(), size, games, reason };
  } catch (err) {
    fs.rmSync(partial, { force: true });
    fs.rmSync(`${partial}-wal`, { force: true });
    fs.rmSync(`${partial}-shm`, { force: true });
    throw err;
  }
}

export function createBackup(reason: BackupReason): Promise<BackupInfo> {
  // Queued behind whatever is already running, successful or not
  const next = (inFlight ?? Promise.resolve()).then(
    () => runBackup(reason),
    () => runBackup(reason),
  );
  inFlight = next;
  // Whoever finishes last clears the slot; an earlier one doing it would let
  // the next caller start alongside a backup that is still running.
  const done = () => {
    if (inFlight === next) inFlight = null;
  };
  next.then(done, done);
  return next;
}

// Snapshots protect the user's data, so a failure to take one is reported but
// never allowed to abort whatever it was protecting.
export async function backupQuietly(reason: BackupReason): Promise<void> {
  if (getSetting("auto_backup") === "false") return;
  try {
    const backup = await createBackup(reason);
    console.log(`Backed up ${backup.games} games to ${backup.file}`);
  } catch (err) {
    console.error(`Backup (${reason}) failed:`, err);
  }
}

function isStale(): boolean {
  const newest = readBackups()[0];
  return !newest || Date.now() - newest.created > MAX_AGE_MS;
}

export function startBackupSchedule(): void {
  if (scheduleTimer) return;
  const tick = () => {
    if (getSetting("auto_backup") === "false") return;
    if (isStale()) void backupQuietly("auto");
  };
  tick();
  scheduleTimer = setInterval(tick, CHECK_INTERVAL_MS);
}

export function stopBackupSchedule(): void {
  if (!scheduleTimer) return;
  clearInterval(scheduleTimer);
  scheduleTimer = null;
}

// ---- Restore ----

// Only ever a bare filename this module itself would have written, resolved
// inside the backup directory: the name arrives from the renderer, and joining
// an arbitrary string onto a path is how a "restore" ends up reading somewhere
// else entirely.
function resolveBackup(file: string): string {
  if (!FILE_RE.test(file)) throw new Error("Not a backup file name");
  const full = path.join(getBackupDir(), file);
  if (!fs.existsSync(full)) throw new Error("That backup no longer exists");
  return full;
}

// Puts a database file in place of the live one. The caller must have closed
// the connection first.
function swapIn(source: string): void {
  const dbPath = getDbPath();
  // The -wal and -shm describe the database being replaced. Left behind, SQLite
  // would replay them onto the restored file and corrupt it immediately.
  fs.rmSync(`${dbPath}-wal`, { force: true });
  fs.rmSync(`${dbPath}-shm`, { force: true });
  // Copy then rename, rather than copying over the live path: a copy that fails
  // half way would otherwise leave a truncated database and nothing to restore.
  const incoming = `${dbPath}.incoming`;
  fs.copyFileSync(source, incoming);
  fs.renameSync(incoming, dbPath);
}

export async function restoreBackup(file: string): Promise<{ games: number }> {
  const source = resolveBackup(file);
  // Verified again at restore time, not trusted from when it was written — the
  // file has been sitting on disk since, and this is the moment it matters.
  const games = verifySnapshot(source);

  // A restore chosen by mistake is itself undoable. Failing to take this one
  // doesn't block the restore the user asked for; it only gets logged.
  await backupQuietly("pre-restore");

  closeDatabase();
  swapIn(source);
  initDatabase();
  return { games };
}

// ---- Startup recovery ----

function quarantine(dbPath: string): string | null {
  const dead = `${dbPath}.corrupt-${stamp()}`;
  try {
    fs.renameSync(dbPath, dead);
    fs.rmSync(`${dbPath}-wal`, { force: true });
    fs.rmSync(`${dbPath}-shm`, { force: true });
    return dead;
  } catch (err) {
    console.error("Failed to set aside the damaged database:", err);
    return null;
  }
}

// Newest first, verifying as it goes: the most recent snapshot is worth nothing
// if it can't be opened, and the one before it usually can.
function newestUsableBackup(): string | null {
  const dir = getBackupDir();
  for (const backup of readBackups()) {
    const full = path.join(dir, backup.file);
    try {
      verifySnapshot(full);
      return full;
    } catch (err) {
      console.error("Skipping unusable backup:", backup.file, err);
    }
  }
  return null;
}

function recover(problem: "missing" | "corrupt", detail?: string): RecoveryReport {
  closeDatabase();
  const dbPath = getDbPath();
  // On the missing path this is the empty database initDatabase just created,
  // which is still worth setting aside rather than overwriting blind.
  const quarantined = fs.existsSync(dbPath) ? quarantine(dbPath) : null;

  let source = newestUsableBackup();
  if (source) {
    try {
      swapIn(source);
    } catch (err) {
      // Out of disk, or the file vanished between the check and the copy. An
      // empty database the user can still use beats a window that never opens.
      console.error("Failed to restore from backup:", err);
      source = null;
    }
  }
  initDatabase();

  const report: RecoveryReport = {
    problem,
    restoredFrom: source ? path.basename(source) : null,
    quarantined: quarantined ? path.basename(quarantined) : null,
    detail,
  };
  console.error("Database recovery:", report);
  return report;
}

// Wraps initDatabase so the two ways this database can be lost — the file gone,
// or the file unreadable — both come back from the newest good snapshot instead
// of leaving the app to start empty, or not at all.
export function initDatabaseWithRecovery(): void {
  recoveryReport = null;
  const missing = !fs.existsSync(getDbPath());

  try {
    initDatabase();
    if (!missing) {
      const result = getDatabase().pragma("quick_check") as { quick_check: string }[];
      if (result[0]?.quick_check !== "ok") {
        throw new Error(result[0]?.quick_check ?? "integrity check failed");
      }
    }
  } catch (err: any) {
    // Damage can surface either on open or on the first statements migrations
    // run, so the check and the init it follows share one handler.
    console.error("Database failed to open:", err);
    recoveryReport = recover("corrupt", err.message);
    return;
  }

  // The database opened cleanly, but it wasn't there a moment ago. On a fresh
  // install that is simply the first launch; with snapshots on disk it means
  // the file was deleted, and starting empty would look like data loss.
  if (missing && readBackups().length > 0) {
    recoveryReport = recover("missing");
  }
}

export function getRecoveryReport(): RecoveryReport | null {
  return recoveryReport;
}
