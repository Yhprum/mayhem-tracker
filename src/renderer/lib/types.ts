export interface GameRecord {
  game_id: number;
  queue_id: number;
  game_mode: string;
  game_creation: number;
  game_duration: number;
  puuid?: string;
  game_version?: string | null;
  raw_json?: string;
}

export interface PlayerStatsRecord {
  game_id: number;
  champion_id: number;
  win: number;
  kills: number;
  deaths: number;
  assists: number;
  double_kills: number;
  triple_kills: number;
  quadra_kills: number;
  penta_kills: number;
  total_damage_dealt: number;
  total_damage_taken: number;
  gold_earned: number;
  total_heal: number;
  largest_killing_spree: number;
  item0: number | null;
  item1: number | null;
  item2: number | null;
  item3: number | null;
  item4: number | null;
  item5: number | null;
  item6: number | null;
}

export interface GameAugment {
  game_id: number;
  slot: number;
  augment_id: number;
}

export interface MatchListItem {
  game_id: number;
  queue_id: number;
  game_creation: number;
  game_duration: number;
  is_remake: number;
  favorite: number;
  champion_id: number;
  win: number;
  kills: number;
  deaths: number;
  assists: number;
  double_kills: number;
  triple_kills: number;
  quadra_kills: number;
  penta_kills: number;
  total_damage_dealt: number;
  total_damage_taken: number;
  total_heal: number;
  gold_earned: number;
  item0: number | null;
  item1: number | null;
  item2: number | null;
  item3: number | null;
  item4: number | null;
  item5: number | null;
  score: number | null;
  score_badge: "MVP" | "ACE" | null;
  augment_ids: string | null;
  game_version: string | null;
  game_max_dmg: number;
  game_max_taken: number;
  game_max_heal: number;
}

export type MatchSort = "date" | "kda" | "kills" | "duration" | "score";

export type MatchSortDir = "asc" | "desc";

export type MultikillType = "doubles" | "triples" | "quadras" | "pentas";

export interface MatchFilters {
  championId?: number;
  patch?: string;
  queue?: number;
  sort?: MatchSort;
  sortDir?: MatchSortDir;
  multikills?: MultikillType[];
}

export interface MatchFilterOptions {
  patches: string[];
  champions: number[];
  queues: number[];
}

export interface MatchDetail {
  game: GameRecord;
  stats: PlayerStatsRecord;
  augments: GameAugment[];
  raw: any;
}

export interface ChampionStats {
  champion_id: number;
  games: number;
  wins: number;
  kills: number;
  deaths: number;
  assists: number;
  avg_kills: number;
  avg_deaths: number;
  avg_assists: number;
  avg_damage: number;
  avg_gold: number;
  // Null when none of the champion's games have a stored score
  avg_score: number | null;
  mvps: number;
  aces: number;
  double_kills: number;
  triple_kills: number;
  quadra_kills: number;
  penta_kills: number;
}

export interface AugmentStats {
  augment_id: number;
  picks: number;
  wins: number;
}

export interface ItemStats {
  item_id: number;
  picks: number;
  wins: number;
}

export interface AugmentStatsDetailed {
  augment_id: number;
  picks: number;
  wins: number;
  champions: { champion_id: number; picks: number; wins: number }[];
}

export interface DashboardData {
  totalGames: number;
  wins: number;
  totalKills: number;
  totalDeaths: number;
  totalAssists: number;
  avgScore: number | null;
  mvps: number;
  aces: number;
  // MVP is only awarded on a win and ACE only on a loss, so those are the
  // denominators for their rates — and only over games that have a score at all
  scoredWins: number;
  scoredLosses: number;
  // Tracked accounts these totals pool together, under the current filters
  accounts: number;
  // Newest first
  recentForm: { win: number; game_id: number }[];
  topChampions: ChampionStats[];
  multikills: {
    doubles: number;
    triples: number;
    quadras: number;
    pentas: number;
  };
  topAugments: AugmentStats[];
}

export interface ChampionData {
  [id: number]: {
    name: string;
    key: string;
    class?: string;
  };
}

export interface AugmentData {
  [id: number]: {
    name: string;
    desc: string;
    iconPath: string;
    rarity: string;
  };
}

export interface ItemData {
  [id: number]: {
    name: string;
    iconPath: string;
    branch: string;
  };
}

export interface TeammateStats {
  // Stable id for routing — the teammate's puuid, or their name when unknown
  key: string;
  name: string;
  puuid: string | null;
  profileIcon: number | null;
  games: number;
  wins: number;
  kills: number;
  deaths: number;
  assists: number;
  champions: { champion_id: number; games: number }[];
  lastPlayed: number;
}

// A shared game, seen from both sides: our stats on the row itself, theirs
// under `friend`.
export interface TeammateMatch extends MatchListItem {
  friend: {
    champion_id: number;
    win: number;
    kills: number;
    deaths: number;
    assists: number;
    total_damage_dealt: number;
    total_damage_taken: number;
    total_heal: number;
    score: number | null;
    score_badge: "MVP" | "ACE" | null;
  };
}

export interface TeammateChampionStats {
  champion_id: number;
  games: number;
  wins: number;
  kills: number;
  deaths: number;
  assists: number;
}

// The list view only needs a teammate's most-played champions; their profile
// breaks every champion down.
export interface TeammateProfile extends Omit<TeammateStats, "champions"> {
  champions: TeammateChampionStats[];
}

export interface TeammateDetail {
  player: TeammateProfile;
  matches: TeammateMatch[];
}

export interface GlobalStats {
  champions: { champion_id: number; games: number; wins: number }[];
  augments: { augment_id: number; picks: number; wins: number }[];
  totalParticipantSlots: number;
}

// One champion across every stored game, counting all ten players per game.
export interface GlobalChampionDetail {
  champion_id: number;
  games: number;
  wins: number;
  kills: number;
  deaths: number;
  assists: number;
  avgDamage: number;
  avgDamageTaken: number;
  avgGold: number;
  avgHeal: number;
  // Averaged per-game ratios, 0-1
  damageShare: number;
  killParticipation: number;
  doubleKills: number;
  tripleKills: number;
  quadraKills: number;
  pentaKills: number;
  totalParticipantSlots: number;
  items: ItemStats[];
  augments: AugmentStats[];
}

export interface ParsedParticipant {
  participantId: number;
  championId: number;
  teamId: number;
  puuid: string | null;
  summonerName: string;
  kills: number;
  deaths: number;
  assists: number;
  doubleKills: number;
  tripleKills: number;
  quadraKills: number;
  pentaKills: number;
  totalDamageDealtToChampions: number;
  totalDamageTaken: number;
  goldEarned: number;
  totalHeal: number;
  largestKillingSpree: number;
  items: number[];
  augments: number[];
  win: boolean;
  isSelf: boolean;
}

export type LcuStatus = "disconnected" | "connecting" | "connected";

export interface BackfillProgress {
  current: number;
  total: number;
  added: number;
}

export interface BackfillResult {
  added: number;
  scanned: number;
  checked: number;
  totalGames: number;
  truncated: boolean;
  cancelled: boolean;
}

export interface UpdateInfo {
  hasUpdate: boolean;
  latest?: string;
  current?: string;
  url?: string;
  assetUrl?: string;
  assetSize?: number;
  error?: string;
}

export interface ElectronAPI {
  getMatchHistory: (
    limit: number,
    offset: number,
    filters?: MatchFilters,
  ) => Promise<{ matches: MatchListItem[]; total: number }>;
  getMatchFilterOptions: (
    filters?: Pick<MatchFilters, "championId" | "patch" | "queue">,
  ) => Promise<MatchFilterOptions>;
  getMatchDetail: (gameId: number) => Promise<MatchDetail>;
  toggleFavorite: (gameId: number) => Promise<boolean>;
  getChampionStats: (patch?: string, queue?: number) => Promise<ChampionStats[]>;
  getAugmentStats: (championId?: number, patch?: string, queue?: number) => Promise<AugmentStats[]>;
  getAugmentStatsDetailed: (patch?: string, queue?: number) => Promise<AugmentStatsDetailed[]>;
  getDashboard: (
    filters?: Pick<MatchFilters, "championId" | "patch" | "queue">,
  ) => Promise<DashboardData>;
  getChampionMatchHistory: (
    championId: number,
    limit: number,
    offset: number,
    patch?: string,
    queue?: number,
  ) => Promise<{ matches: MatchListItem[]; total: number }>;
  getChampionItemStats: (
    championId: number,
    patch?: string,
    queue?: number,
  ) => Promise<ItemStats[]>;
  getTeammateStats: () => Promise<TeammateStats[]>;
  getTeammateDetail: (key: string) => Promise<TeammateDetail | null>;
  getGlobalStats: (patch?: string, queue?: number) => Promise<GlobalStats>;
  getGlobalChampionDetail: (
    championId: number,
    patch?: string,
    queue?: number,
  ) => Promise<GlobalChampionDetail>;
  getSummonerPuuid: () => Promise<string | null>;
  getAllSummonerPuuids: () => Promise<string[]>;
  getProfile: () => Promise<{ name: string | null; profileIcon: number | null }>;
  refreshGames: () => Promise<{ newGames: number; totalGames: number } | { error: string }>;
  backfillHistory: () => Promise<BackfillResult | { error: string }>;
  cancelBackfill: () => Promise<void>;
  isBackfillRunning: () => Promise<boolean>;
  onBackfillProgress: (callback: (progress: BackfillProgress) => void) => () => void;
  onBackfillDone: (result: (result: BackfillResult | { error: string }) => void) => () => void;
  getLcuStatus: () => Promise<LcuStatus>;
  getChampionData: () => Promise<ChampionData>;
  getAugmentData: () => Promise<AugmentData>;
  getItemData: (patch?: string) => Promise<ItemData>;
  onStatusChanged: (callback: (status: LcuStatus) => void) => () => void;
  onGamesUpdated: (callback: () => void) => () => void;
  getSetting: (key: string) => Promise<string | null>;
  setSetting: (key: string, value: string) => Promise<void>;
  exportData: () => Promise<{ success: boolean; path?: string; error?: string }>;
  importData: () => Promise<{ success: boolean; imported?: number; error?: string }>;
  repairPuuids: () => Promise<{
    repairedGames: number;
    discoveredAccounts: number;
    rebuiltGames: number;
  }>;
  getVersion: () => Promise<string>;
  checkForUpdate: () => Promise<UpdateInfo>;
  downloadUpdate: (assetUrl: string) => Promise<{ success: boolean; error?: string }>;
  onUpdateProgress: (callback: (percent: number) => void) => () => void;
  openUrl: (url: string) => Promise<void>;
  minimizeWindow: () => Promise<void>;
  toggleMaximizeWindow: () => Promise<void>;
  closeWindow: () => Promise<void>;
  isWindowMaximized: () => Promise<boolean>;
  onMaximizedChanged: (callback: (maximized: boolean) => void) => () => void;
}

declare global {
  interface Window {
    api: ElectronAPI;
  }
}
