import { ipcMain, BrowserWindow, dialog, app } from "electron";
import fs from "fs";
import * as db from "./db";
import * as lcu from "./lcu";
import * as dragon from "./dragon";
import * as updater from "./updater";
import { openExternalUrl } from "./security";

// The settings table doubles as internal bookkeeping — sgp_host, the
// per-account backfill_complete_* flags, score_formula_version — none of which
// the renderer has any business reading or rewriting. Only the keys backing the
// Settings page are exposed.
const RENDERER_SETTINGS = new Set(["minimize_to_tray", "hide_classic_games"]);

// Registered once for the lifetime of the app — ipcMain.handle throws on a
// second registration for the same channel. Anything needing a window resolves
// it from the sender rather than closing over one, so a window that is replaced
// doesn't leave handlers pointing at a destroyed instance.
function senderWindow(event: { sender: Electron.WebContents }): BrowserWindow | null {
  return BrowserWindow.fromWebContents(event.sender);
}

export function registerIpcHandlers() {
  ipcMain.handle(
    "db:match-history",
    (
      _event,
      limit: number,
      offset: number,
      filters?: {
        championId?: number;
        patch?: string;
        queue?: number;
        sort?: string;
        sortDir?: string;
        multikills?: string[];
        favorites?: boolean;
      },
    ) => {
      return db.getMatchHistory(limit, offset, filters);
    },
  );

  ipcMain.handle(
    "db:match-filters",
    (_event, filters?: { championId?: number; patch?: string; queue?: number }) => {
      return db.getMatchFilterOptions(filters);
    },
  );

  ipcMain.handle("db:match-detail", (_event, gameId: number) => {
    return db.getMatchDetail(gameId);
  });

  ipcMain.handle("db:toggle-favorite", (_event, gameId: number) => {
    return db.toggleFavorite(gameId);
  });

  ipcMain.handle("db:champion-stats", (_event, patch?: string, queue?: number) => {
    return db.getChampionStatsAll(patch, queue);
  });

  ipcMain.handle(
    "db:augment-stats",
    (_event, championId?: number, patch?: string, queue?: number) => {
      return db.getAugmentStatsAll(championId, patch, queue);
    },
  );

  ipcMain.handle("db:augment-stats-detailed", (_event, patch?: string, queue?: number) => {
    return db.getAugmentStatsWithChampions(patch, queue);
  });

  ipcMain.handle(
    "db:dashboard",
    (_event, filters?: { championId?: number; patch?: string; queue?: number }) => {
      return db.getDashboardData(filters);
    },
  );

  ipcMain.handle(
    "db:champion-match-history",
    (_event, championId: number, limit: number, offset: number, patch?: string, queue?: number) => {
      return db.getChampionMatchHistory(championId, limit, offset, patch, queue);
    },
  );

  ipcMain.handle("lcu:refresh", async (event) => {
    // Return errors as data instead of throwing, so the renderer gets a clean
    // message rather than Electron's "Error invoking remote method" wrapper
    try {
      return await lcu.fetchNewGames(senderWindow(event));
    } catch (err) {
      return { error: lcu.friendlyErrorMessage(err) };
    }
  });

  ipcMain.handle("lcu:backfill", async (event) => {
    try {
      return await lcu.backfillHistory(senderWindow(event));
    } catch (err) {
      return { error: lcu.friendlyErrorMessage(err) };
    }
  });

  ipcMain.handle("lcu:cancel-backfill", () => {
    lcu.cancelBackfill();
  });

  ipcMain.handle("lcu:backfill-running", () => {
    return lcu.isBackfillRunning();
  });

  ipcMain.handle("lcu:status", () => {
    return lcu.getStatus();
  });

  ipcMain.handle("dragon:champions", async () => {
    await dragon.waitForChampionData();
    return dragon.getChampionData();
  });

  ipcMain.handle("dragon:augments", async () => {
    await dragon.waitForAugmentData();
    return dragon.getAugmentDataCache();
  });

  ipcMain.handle("dragon:items", async (_event, patch?: string) => {
    try {
      return await dragon.loadItemData(patch);
    } catch {
      return {};
    }
  });

  ipcMain.handle(
    "db:champion-item-stats",
    (_event, championId: number, patch?: string, queue?: number) => {
      return db.getChampionItemStats(championId, patch, queue);
    },
  );

  ipcMain.handle("db:teammate-stats", () => {
    return db.getTeammateStats();
  });

  ipcMain.handle("db:teammate-detail", async (_event, key: string) => {
    // Teammate scores are computed on the fly and need champion classes
    await dragon.waitForChampionData();
    return db.getTeammateDetail(key);
  });

  ipcMain.handle("db:global-stats", (_event, patch?: string, queue?: number) => {
    return db.getGlobalStats(patch, queue);
  });

  ipcMain.handle(
    "db:global-champion-detail",
    (_event, championId: number, patch?: string, queue?: number) => {
      return db.getGlobalChampionDetail(championId, patch, queue);
    },
  );

  ipcMain.handle("db:all-summoner-puuids", () => {
    return db.getAllPuuids();
  });

  ipcMain.handle("db:summoner-puuid", () => {
    const s = db.getSummoner();
    return s?.puuid ?? null;
  });

  ipcMain.handle("db:profile", () => {
    return db.getProfile();
  });

  // Settings
  ipcMain.handle("settings:get", (_event, key: string) => {
    if (!RENDERER_SETTINGS.has(key)) return null;
    return db.getSetting(key);
  });

  ipcMain.handle("settings:set", (_event, key: string, value: string) => {
    if (!RENDERER_SETTINGS.has(key)) {
      console.warn("Refused to write non-renderer setting:", key);
      return;
    }
    db.setSetting(key, value);
  });

  // Window controls (custom title bar). The maximize/unmaximize events that
  // pair with these are wired up in createWindow, where the window lives.
  ipcMain.handle("window:minimize", (event) => {
    senderWindow(event)?.minimize();
  });

  ipcMain.handle("window:toggle-maximize", (event) => {
    const win = senderWindow(event);
    if (!win) return;
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
  });

  ipcMain.handle("window:close", (event) => {
    senderWindow(event)?.close();
  });

  ipcMain.handle("window:is-maximized", (event) => {
    return senderWindow(event)?.isMaximized() ?? false;
  });

  // Version & updates
  ipcMain.handle("app:version", () => {
    return app.getVersion();
  });

  ipcMain.handle("app:check-update", () => {
    return updater.checkForUpdate();
  });

  ipcMain.handle("app:download-update", (event, assetUrl: string) => {
    const win = senderWindow(event);
    if (!win) return { success: false, error: "No window to report progress to" };
    return updater.downloadAndInstall(win, assetUrl);
  });

  ipcMain.handle("app:open-url", (_event, url: string) => {
    openExternalUrl(url);
  });

  // Data export/import
  ipcMain.handle("data:export", async (event) => {
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

  ipcMain.handle("data:import", async (event) => {
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
      const raw = await fs.promises.readFile(result.filePaths[0], "utf-8");
      const data = JSON.parse(raw);
      if (!data || typeof data !== "object" || !Array.isArray(data.games)) {
        return { success: false, error: "That file isn't a Mayhem Tracker backup" };
      }
      const imported = db.importData(data);
      return { success: true, imported };
    } catch (err: any) {
      const reason = err instanceof SyntaxError ? "it isn't valid JSON" : err.message;
      return { success: false, error: `Import failed: ${reason}` };
    }
  });

  ipcMain.handle("data:repair-puuids", async () => {
    // Repair rescoring needs champion classes; wait so a repair triggered
    // right after launch doesn't score with default weights.
    await dragon.waitForChampionData();
    return db.repairPuuids();
  });
}
