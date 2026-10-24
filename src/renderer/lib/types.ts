import type { ElectronAPI } from "../../shared/api";

// The contract itself lives in src/shared/api.ts, where the preload can reach
// it too. Re-exported here because the renderer names this module everywhere,
// and because the window.api global belongs to the renderer alone.
export * from "../../shared/api";

// Filters another page opens the Match History on, carried in the navigation's
// state: the Champions page's link to every game on one champion
export interface MatchHistoryLink {
  championId: number;
  patch?: string;
  queue?: number;
  season?: string;
}

declare global {
  interface Window {
    api: ElectronAPI;
  }
}
