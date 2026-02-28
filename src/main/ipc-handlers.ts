import { ipcMain, BrowserWindow, dialog } from "electron";
import fs from "fs";
import * as db from "./db";
import * as lcu from "./lcu";
import * as dragon from "./dragon";

export function registerIpcHandlers(win: BrowserWindow) {
  ipcMain.handle("db:match-history", (_event, limit: number, offset: number) => {
    return db.getMatchHistory(limit, offset);
  });

  ipcMain.handle("db:match-detail", (_event, gameId: number) => {
    return db.getMatchDetail(gameId);
  });

  ipcMain.handle("db:champion-stats", () => {
    return db.getChampionStatsAll();
  });

  ipcMain.handle("db:augment-stats", (_event, championId?: number) => {
    return db.getAugmentStatsAll(championId);
  });

  ipcMain.handle("db:augment-stats-detailed", () => {
    return db.getAugmentStatsWithChampions();
  });

  ipcMain.handle("db:dashboard", () => {
    return db.getDashboardData();
  });

  ipcMain.handle(
    "db:champion-match-history",
    (_event, championId: number, limit: number, offset: number) => {
      return db.getChampionMatchHistory(championId, limit, offset);
    },
  );

  ipcMain.handle("lcu:refresh", async () => {
    return lcu.fetchNewGames(win);
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

  ipcMain.handle("db:champion-item-stats", (_event, championId: number) => {
    return db.getChampionItemStats(championId);
  });

  ipcMain.handle("db:teammate-stats", () => {
    return db.getTeammateStats();
  });

  ipcMain.handle("db:global-stats", () => {
    return db.getGlobalStats();
  });

  ipcMain.handle("db:summoner-puuid", () => {
    const s = db.getSummoner();
    return s?.puuid ?? null;
  });

  // Settings
  ipcMain.handle("settings:get", (_event, key: string) => {
    return db.getSetting(key);
  });

  ipcMain.handle("settings:set", (_event, key: string, value: string) => {
    db.setSetting(key, value);
  });

  // Data export/import
  ipcMain.handle("data:export", async () => {
    const result = await dialog.showSaveDialog(win, {
      title: "Export Mayhem Data",
      defaultPath: `mayhem-backup-${new Date().toISOString().slice(0, 10)}.json`,
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
    if (result.canceled || !result.filePath) return { success: false };
    const data = db.exportAllData();
    fs.writeFileSync(result.filePath, JSON.stringify(data, null, 2));
    return { success: true, path: result.filePath };
  });

  ipcMain.handle("data:import", async () => {
    const result = await dialog.showOpenDialog(win, {
      title: "Import Mayhem Data",
      filters: [{ name: "JSON", extensions: ["json"] }],
      properties: ["openFile"],
    });
    if (result.canceled || !result.filePaths[0]) return { success: false };
    const raw = fs.readFileSync(result.filePaths[0], "utf-8");
    const data = JSON.parse(raw);
    const imported = db.importData(data);
    return { success: true, imported };
  });
}
