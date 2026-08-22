import { contextBridge, ipcRenderer } from "electron";

const api = {
  getMatchHistory: (
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
  ) => ipcRenderer.invoke("db:match-history", limit, offset, filters),

  getMatchFilterOptions: (filters?: { championId?: number; patch?: string; queue?: number }) =>
    ipcRenderer.invoke("db:match-filters", filters),

  getMatchDetail: (gameId: number) => ipcRenderer.invoke("db:match-detail", gameId),

  toggleFavorite: (gameId: number) => ipcRenderer.invoke("db:toggle-favorite", gameId),

  getChampionStats: (patch?: string, queue?: number) =>
    ipcRenderer.invoke("db:champion-stats", patch, queue),

  getAugmentStats: (championId?: number, patch?: string, queue?: number) =>
    ipcRenderer.invoke("db:augment-stats", championId, patch, queue),

  getAugmentStatsDetailed: (patch?: string, queue?: number) =>
    ipcRenderer.invoke("db:augment-stats-detailed", patch, queue),

  getDashboard: (filters?: { championId?: number; patch?: string; queue?: number }) =>
    ipcRenderer.invoke("db:dashboard", filters),

  getChampionMatchHistory: (
    championId: number,
    limit: number,
    offset: number,
    patch?: string,
    queue?: number,
  ) => ipcRenderer.invoke("db:champion-match-history", championId, limit, offset, patch, queue),

  refreshGames: () => ipcRenderer.invoke("lcu:refresh"),

  backfillHistory: () => ipcRenderer.invoke("lcu:backfill"),

  cancelBackfill: () => ipcRenderer.invoke("lcu:cancel-backfill"),

  isBackfillRunning: () => ipcRenderer.invoke("lcu:backfill-running"),

  onBackfillDone: (callback: (result: any) => void) => {
    const handler = (_event: any, result: any) => callback(result);
    ipcRenderer.on("lcu:backfill-done", handler);
    return () => ipcRenderer.removeListener("lcu:backfill-done", handler);
  },

  onBackfillProgress: (
    callback: (progress: { current: number; total: number; added: number }) => void,
  ) => {
    const handler = (_event: any, progress: { current: number; total: number; added: number }) =>
      callback(progress);
    ipcRenderer.on("lcu:backfill-progress", handler);
    return () => ipcRenderer.removeListener("lcu:backfill-progress", handler);
  },

  getLcuStatus: () => ipcRenderer.invoke("lcu:status"),

  getChampionData: () => ipcRenderer.invoke("dragon:champions"),

  getAugmentData: () => ipcRenderer.invoke("dragon:augments"),

  getItemData: (patch?: string) => ipcRenderer.invoke("dragon:items", patch),

  getChampionItemStats: (championId: number, patch?: string, queue?: number) =>
    ipcRenderer.invoke("db:champion-item-stats", championId, patch, queue),

  getTeammateStats: () => ipcRenderer.invoke("db:teammate-stats"),

  getTeammateDetail: (key: string) => ipcRenderer.invoke("db:teammate-detail", key),

  getGlobalStats: (patch?: string, queue?: number) =>
    ipcRenderer.invoke("db:global-stats", patch, queue),

  getTrends: (queue?: number) => ipcRenderer.invoke("db:trends", queue),

  getRecords: (queue?: number) => ipcRenderer.invoke("db:records", queue),

  getGlobalChampionDetail: (championId: number, patch?: string, queue?: number) =>
    ipcRenderer.invoke("db:global-champion-detail", championId, patch, queue),

  getSummonerPuuid: () => ipcRenderer.invoke("db:summoner-puuid"),

  getAllSummonerPuuids: () => ipcRenderer.invoke("db:all-summoner-puuids"),

  getProfile: () => ipcRenderer.invoke("db:profile"),

  onStatusChanged: (callback: (status: string) => void) => {
    const handler = (_event: any, status: string) => callback(status);
    ipcRenderer.on("lcu:status-changed", handler);
    return () => ipcRenderer.removeListener("lcu:status-changed", handler);
  },

  onGamesUpdated: (callback: () => void) => {
    const handler = () => callback();
    ipcRenderer.on("lcu:games-updated", handler);
    return () => ipcRenderer.removeListener("lcu:games-updated", handler);
  },

  getSetting: (key: string) => ipcRenderer.invoke("settings:get", key),

  setSetting: (key: string, value: string) => ipcRenderer.invoke("settings:set", key, value),

  exportData: () => ipcRenderer.invoke("data:export"),

  importData: () => ipcRenderer.invoke("data:import"),

  repairPuuids: () => ipcRenderer.invoke("data:repair-puuids"),

  getVersion: () => ipcRenderer.invoke("app:version"),

  checkForUpdate: () => ipcRenderer.invoke("app:check-update"),

  downloadUpdate: (assetUrl: string) => ipcRenderer.invoke("app:download-update", assetUrl),

  onUpdateProgress: (callback: (percent: number) => void) => {
    const handler = (_event: any, percent: number) => callback(percent);
    ipcRenderer.on("update:progress", handler);
    return () => ipcRenderer.removeListener("update:progress", handler);
  },

  openUrl: (url: string) => ipcRenderer.invoke("app:open-url", url),

  minimizeWindow: () => ipcRenderer.invoke("window:minimize"),

  toggleMaximizeWindow: () => ipcRenderer.invoke("window:toggle-maximize"),

  closeWindow: () => ipcRenderer.invoke("window:close"),

  isWindowMaximized: () => ipcRenderer.invoke("window:is-maximized"),

  onMaximizedChanged: (callback: (maximized: boolean) => void) => {
    const handler = (_event: any, maximized: boolean) => callback(maximized);
    ipcRenderer.on("window:maximized-changed", handler);
    return () => ipcRenderer.removeListener("window:maximized-changed", handler);
  },
};

contextBridge.exposeInMainWorld("api", api);
