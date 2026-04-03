import { contextBridge, ipcRenderer } from "electron";

const api = {
  getMatchHistory: (limit: number, offset: number) =>
    ipcRenderer.invoke("db:match-history", limit, offset),

  getMatchDetail: (gameId: number) => ipcRenderer.invoke("db:match-detail", gameId),

  getChampionStats: () => ipcRenderer.invoke("db:champion-stats"),

  getAugmentStats: (championId?: number) => ipcRenderer.invoke("db:augment-stats", championId),

  getAugmentStatsDetailed: () => ipcRenderer.invoke("db:augment-stats-detailed"),

  getDashboard: () => ipcRenderer.invoke("db:dashboard"),

  getChampionMatchHistory: (championId: number, limit: number, offset: number) =>
    ipcRenderer.invoke("db:champion-match-history", championId, limit, offset),

  refreshGames: () => ipcRenderer.invoke("lcu:refresh"),

  getLcuStatus: () => ipcRenderer.invoke("lcu:status"),

  getChampionData: () => ipcRenderer.invoke("dragon:champions"),

  getAugmentData: () => ipcRenderer.invoke("dragon:augments"),

  getChampionItemStats: (championId: number) =>
    ipcRenderer.invoke("db:champion-item-stats", championId),

  getTeammateStats: () => ipcRenderer.invoke("db:teammate-stats"),

  getGlobalStats: () => ipcRenderer.invoke("db:global-stats"),

  getSummonerPuuid: () => ipcRenderer.invoke("db:summoner-puuid"),

  getAllSummonerPuuids: () => ipcRenderer.invoke("db:all-summoner-puuids"),

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

  openUrl: (url: string) => ipcRenderer.invoke("app:open-url", url),
};

contextBridge.exposeInMainWorld("api", api);
