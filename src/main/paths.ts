import path from "path";
import fs from "fs";
import { app } from "electron";

// In development, use the project's data directory
// In production, use app.getPath('userData')
function getRootDir() {
  const isDev = !app.isPackaged;
  return isDev ? path.join(__dirname, "..", "..") : app.getPath("userData");
}

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

export function getDataDir() {
  return ensureDir(path.join(getRootDir(), "data"));
}

// A sibling of the data directory, never a child of it: the failure this
// guards against includes "the data folder got wiped", and backups kept inside
// it would go the same way.
export function getBackupDir() {
  return ensureDir(path.join(getRootDir(), "backups"));
}
