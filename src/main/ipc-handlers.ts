import { BrowserWindow, dialog, app, shell } from "electron";
import fs from "fs";
import * as db from "./db";
import * as lcu from "./lcu";
import * as live from "./live";
import * as challenges from "./challenges";
import * as dragon from "./dragon";
import * as updater from "./updater";
import * as backup from "./backup";
import { copyGameImage, exportGameImage } from "./export-image";
import { importBackupFile } from "./import";
import { getBackupDir, getLogDir } from "./paths";
import { openExternalUrl } from "./security";
import { applyAutoStart, isAutoStartSupported } from "./autostart";
import { handle, sendToRenderer } from "./ipc";
import { SESSION_GROUPING_SETTING } from "../shared/session";

// The settings table doubles as internal bookkeeping — sgp_host, the
// per-account backfill_complete_* flags, score_formula_version — none of which
// the renderer has any business reading or rewriting. Only the keys backing the
// Settings page are exposed.
const RENDERER_SETTINGS = new Set([
  "auto_start",
  "minimize_to_tray",
  "hidden_queues",
  "hide_remakes",
  "auto_backup",
  "remember_filters",
  SESSION_GROUPING_SETTING,
]);

// Registered once for the lifetime of the app — ipcMain.handle throws on a
// second registration for the same channel. Anything needing a window resolves
// it from the sender rather than closing over one, so a window that is replaced
// doesn't leave handlers pointing at a destroyed instance.
function senderWindow(event: { sender: Electron.WebContents }): BrowserWindow | null {
  return BrowserWindow.fromWebContents(event.sender);
}

export function registerIpcHandlers() {
  handle("getMatchHistory", (_event, limit, offset, filters) =>
    db.getMatchHistory(limit, offset, filters),
  );

  handle("getMatchFilterOptions", (_event, filters) => db.getMatchFilterOptions(filters));

  handle("getMatchSessions", (_event, filters) => db.getMatchSessions(filters));

  // Unlike the queue list in getMatchFilterOptions, this one ignores the hidden
  // queues: it backs the switches that decide which queues are hidden.
  handle("getStoredQueues", () => db.getStoredQueues());

  handle("getMatchDetail", (_event, gameId) => db.getMatchDetail(gameId));

  handle("toggleFavorite", (_event, gameId) => db.toggleFavorite(gameId));

  handle("getChampionStats", (_event, patch, queue) => db.getChampionStatsAll(patch, queue));

  handle("getAugmentStats", (_event, championId, patch, queue) =>
    db.getAugmentStatsAll(championId, patch, queue),
  );

  handle("getAugmentStatsDetailed", (_event, patch, queue) =>
    db.getAugmentStatsWithChampions(patch, queue),
  );

  handle("getDashboard", (_event, filters) => db.getDashboardData(filters));

  handle("getChampionMatchHistory", (_event, championId, limit, offset, patch, queue) =>
    db.getChampionMatchHistory(championId, limit, offset, patch, queue),
  );

  handle("refreshGames", async (event) => {
    // Return errors as data instead of throwing, so the renderer gets a clean
    // message rather than Electron's "Error invoking remote method" wrapper
    try {
      return await lcu.syncRecentGames(senderWindow(event));
    } catch (err) {
      return { error: lcu.friendlyErrorMessage(err) };
    }
  });

  handle("backfillHistory", async (event) => {
    try {
      // Asked for by hand, so it checks everything Riot still has rather than
      // stopping at the newest page it recognises. Someone reaching for this
      // button is looking for games the ordinary sync didn't find.
      return await lcu.backfillHistory(senderWindow(event), { full: true });
    } catch (err) {
      return { error: lcu.friendlyErrorMessage(err) };
    }
  });

  handle("cancelBackfill", () => {
    lcu.cancelBackfill();
  });

  handle("isBackfillRunning", () => lcu.isBackfillRunning());

  handle("getLcuStatus", () => lcu.getStatus());

  handle("getChampionData", async () => {
    await dragon.waitForChampionData();
    return dragon.getChampionData();
  });

  handle("getAugmentData", async (_event, patch) => {
    try {
      return await dragon.loadAugmentData(patch);
    } catch {
      return {};
    }
  });

  handle("resolveAugmentIcon", async (_event, id, patch) => {
    try {
      return await dragon.resolveAugmentIcon(id, patch);
    } catch {
      return null;
    }
  });

  handle("getItemData", async (_event, patch) => {
    try {
      return await dragon.loadItemData(patch);
    } catch {
      return {};
    }
  });

  handle("getSummonerSpellData", async () => {
    try {
      return await dragon.loadSummonerSpellData();
    } catch {
      return {};
    }
  });

  handle("getChampionItemStats", (_event, championId, patch, queue) =>
    db.getChampionItemStats(championId, patch, queue),
  );

  handle("getTeammateStats", () => db.getTeammateStats());

  handle("getTeammateDetail", async (_event, key) => {
    // Teammate scores are computed on the fly and need champion classes
    await dragon.waitForChampionData();
    return db.getTeammateDetail(key);
  });

  handle("getGlobalStats", (_event, patch, queue) => db.getGlobalStats(patch, queue));

  handle("getTrends", (_event, queue) => db.getTrendsData(queue));

  handle("getRecords", (_event, queue, account) => db.getRecords(queue, account));

  // A fresh look rather than the cached snapshot: the page can be opened in
  // the middle of a match the poll loop has not started for, and the answer to
  // "is a game running" is the whole reason it asked. With no client there is
  // nothing to ask.
  handle("getLiveGame", () =>
    lcu.isClientConnected() ? live.refreshLiveGame() : live.getLiveGame(),
  );

  handle("getGameRecap", async (_event, gameId) => {
    // The scoreboard scores every player, which reads champion classes
    await dragon.waitForChampionData();
    return db.getGameRecap(gameId);
  });

  // Backs the exported image: the scoreboard scores every player, which reads
  // champion classes
  handle("getGameCard", async (_event, gameId) => {
    await dragon.waitForChampionData();
    const detail = db.getMatchDetail(gameId);
    if (!detail) return null;
    return {
      detail,
      mapName: db.getGameMapName(gameId),
      profileIcon: db.getGameProfileIcon(gameId),
    };
  });

  handle("getGlobalChampionDetail", (_event, championId, patch, queue) =>
    db.getGlobalChampionDetail(championId, patch, queue),
  );

  handle("getChallenges", () => challenges.getChallenges());

  handle("getAllSummonerPuuids", () => db.getAllPuuids());

  handle("getProfile", () => db.getProfile());

  // Settings
  handle("getSetting", (_event, key) => {
    if (!RENDERER_SETTINGS.has(key)) return null;
    return db.getSetting(key);
  });

  handle("setSetting", (_event, key, value) => {
    if (!RENDERER_SETTINGS.has(key)) {
      console.warn("Refused to write non-renderer setting:", key);
      return;
    }
    db.setSetting(key, value);

    // The one setting with a home outside the database: the login item has to be
    // rewritten to match, and only this handler knows the answer just changed.
    if (key === "auto_start") applyAutoStart(value === "true");
  });

  // Auto-start registers the app by its own path, which an unpackaged run does
  // not have — the Settings page reads this to say so rather than offering a
  // switch that would quietly do nothing.
  handle("isAutoStartSupported", () => isAutoStartSupported());

  // Window controls (custom title bar). The maximize/unmaximize events that
  // pair with these are wired up in createWindow, where the window lives.
  handle("minimizeWindow", (event) => {
    senderWindow(event)?.minimize();
  });

  handle("toggleMaximizeWindow", (event) => {
    const win = senderWindow(event);
    if (!win) return;
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
  });

  handle("closeWindow", (event) => {
    senderWindow(event)?.close();
  });

  handle("isWindowMaximized", (event) => senderWindow(event)?.isMaximized() ?? false);

  // Version & updates
  handle("getVersion", () => app.getVersion());

  handle("checkForUpdate", () => updater.checkForUpdate());

  handle("downloadUpdate", (event, assetUrl) => {
    const win = senderWindow(event);
    if (!win) return { success: false, error: "No window to report progress to" };
    return updater.downloadAndInstall(win, assetUrl);
  });

  handle("openUrl", (_event, url) => {
    openExternalUrl(url);
  });

  // Data export/import
  handle("exportData", async (event) => {
    const win = senderWindow(event);
    const options = {
      title: "Export Mayhem Data",
      defaultPath: `mayhem-backup-${new Date().toISOString().slice(0, 10)}.json`,
      filters: [{ name: "JSON", extensions: ["json"] }],
    };
    // Parented to the window when there is one, so the dialog is modal
    const result = win
      ? await dialog.showSaveDialog(win, options)
      : await dialog.showSaveDialog(options);
    if (result.canceled || !result.filePath) return { success: false };
    try {
      const games = await db.writeExportTo(result.filePath);
      return { success: true, path: result.filePath, games };
    } catch (err: any) {
      // A partial file would still look like a backup, so don't leave one
      try {
        fs.rmSync(result.filePath, { force: true });
      } catch {
        /* nothing more we can do */
      }
      return { success: false, error: `Export failed: ${err.message}` };
    }
  });

  // One game as a PNG, drawn by the renderer in a window of its own. Separate
  // from exportData, which is the whole database as JSON.
  handle("exportGameImage", async (event, gameId) => {
    // The card carries the scoreboard, which scores every player from their
    // champion's class
    await dragon.waitForChampionData();
    return exportGameImage(senderWindow(event), gameId);
  });

  // The same card, onto the clipboard instead of into a file
  handle("copyGameImage", async (_event, gameId) => {
    await dragon.waitForChampionData();
    return copyGameImage(gameId);
  });

  handle("importData", async (event) => {
    const win = senderWindow(event);
    const options = {
      title: "Import Mayhem Data",
      filters: [{ name: "JSON", extensions: ["json"] }],
      properties: ["openFile" as const],
    };
    const result = win
      ? await dialog.showOpenDialog(win, options)
      : await dialog.showOpenDialog(options);
    if (result.canceled || !result.filePaths[0]) return { success: false };
    // Anything can be chosen in that dialog, so unreadable files, malformed
    // JSON and well-formed JSON that isn't a backup all have to come back as
    // messages rather than as a thrown "Error invoking remote method".
    try {
      const imported = await importBackupFile(result.filePaths[0], win);
      return { success: true, imported };
    } catch (err: any) {
      const reason = err instanceof SyntaxError ? "it isn't valid JSON" : err.message;
      return { success: false, error: `Import failed: ${reason}` };
    }
  });

  handle("repairPuuids", async () => {
    // Repair rescoring needs champion classes; wait so a repair triggered
    // right after launch doesn't score with default weights.
    await dragon.waitForChampionData();
    // A repair reassigns game ownership and rewrites every derived stat, so
    // there is no undo for it short of the snapshot taken here.
    await backup.backupQuietly("pre-repair");
    return db.repairPuuids();
  });

  // Backups
  handle("listBackups", () => backup.listBackups());

  handle("createBackup", async () => {
    try {
      return { success: true, backup: await backup.createBackup("manual") };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  handle("restoreBackup", async (event, file) => {
    try {
      const result = await backup.restoreBackup(file);
      // Everything on screen was read from the database that just got replaced
      sendToRenderer(senderWindow(event), "lcu:games-updated");
      return { success: true, games: result.games };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  handle("getRecoveryReport", () => backup.getRecoveryReport());

  // No renderer input reaches this: the path is ours, and the folder is the
  // one place a user needs to reach to copy a backup somewhere safer.
  handle("openBackupFolder", () => {
    void shell.openPath(getBackupDir());
  });

  // The same for the log, which is what a bug report needs attached
  handle("openLogsFolder", () => {
    void shell.openPath(getLogDir());
  });
}
