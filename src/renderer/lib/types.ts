export interface GameRecord {
  game_id: number;
  queue_id: number;
  game_mode: string;
  game_creation: number;
  game_duration: number;
  puuid?: string;
  game_version?: string | null;
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
  spell1: number | null;
  spell2: number | null;
  augment_ids: string | null;
  game_version: string | null;
  game_max_dmg: number;
  game_max_taken: number;
  game_max_heal: number;
}

export type MatchSort =
  | "date"
  | "kda"
  | "kills"
  | "duration"
  | "score"
  | "damageDealt"
  | "damageTaken"
  | "healing";

export type MatchSortDir = "asc" | "desc";

export type MultikillType = "doubles" | "triples" | "quadras" | "pentas";

export interface MatchFilters {
  championId?: number;
  patch?: string;
  queue?: number;
  account?: string;
  sort?: MatchSort;
  sortDir?: MatchSortDir;
  multikills?: MultikillType[];
  favorites?: boolean;
}

export interface TrackedAccount {
  puuid: string;
  name: string | null;
  profileIcon: number | null;
}

export interface MatchFilterOptions {
  patches: string[];
  champions: number[];
  queues: number[];
  accounts: TrackedAccount[];
  hasFavorites: boolean;
}

// One row per player, straight from match_participants — the scoreboard no
// longer reconstructs these from a raw match payload.
export interface MatchParticipantRecord {
  participantId: number;
  puuid: string | null;
  gameName: string | null;
  tagLine: string | null;
  championId: number;
  teamId: number;
  win: boolean;
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
  spell1Id: number | null;
  spell2Id: number | null;
  items: number[];
  augments: number[];
}

export interface MatchDetail {
  game: GameRecord;
  stats: PlayerStatsRecord;
  augments: GameAugment[];
  participants: MatchParticipantRecord[];
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

export interface SummonerSpellData {
  [id: number]: {
    name: string;
    iconPath: string;
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

// One row per calendar day with at least one game, local time. The Trends page
// re-buckets these into weeks/months itself, so this is the only time series
// the main process has to produce.
export interface TrendsDay {
  day: string; // YYYY-MM-DD
  games: number;
  wins: number;
  kills: number;
  deaths: number;
  assists: number;
  // Summed over games that have a score; scored_games is that count, so the
  // average stays honest when only some games are scored
  score_sum: number | null;
  scored_games: number;
}

export interface TrendsData {
  daily: TrendsDay[];
  // Chronological by first game played on the patch
  patches: {
    patch: string;
    games: number;
    wins: number;
    avg_score: number | null;
    first_played: number;
  }[];
  hours: { hour: number; games: number; wins: number }[];
  // 0 = Sunday, matching strftime('%w')
  weekdays: { weekday: number; games: number; wins: number }[];
}

// Just enough of a game to draw a record's context line and open its match.
export interface RecordMatchRef {
  game_id: number;
  game_creation: number;
  game_duration: number;
  queue_id: number;
  champion_id: number;
  win: number;
  kills: number;
  deaths: number;
  assists: number;
}

// A single-game best: the mark itself plus the game it was set in.
export interface StatRecord {
  value: number;
  match: RecordMatchRef;
}

export interface StreakRecord {
  length: number;
  start: number;
  end: number;
  // The streak's final game
  match: RecordMatchRef;
}

export interface RecordsData {
  totalGames: number;
  bests: {
    kills: StatRecord | null;
    deaths: StatRecord | null;
    assists: StatRecord | null;
    kda: StatRecord | null;
    score: StatRecord | null;
    killingSpree: StatRecord | null;
    damage: StatRecord | null;
    damageTaken: StatRecord | null;
    healing: StatRecord | null;
    gold: StatRecord | null;
    fastestWin: StatRecord | null;
    longestGame: StatRecord | null;
  };
  winStreak: StreakRecord | null;
  lossStreak: StreakRecord | null;
}

export interface GlobalStats {
  champions: { champion_id: number; games: number; wins: number }[];
  augments: { augment_id: number; picks: number; wins: number }[];
  items: { item_id: number; picks: number; wins: number }[];
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
  spell1Id: number | null;
  spell2Id: number | null;
  items: number[];
  augments: number[];
  win: boolean;
  isSelf: boolean;
}

export type LcuStatus = "disconnected" | "connecting" | "connected" | "ingame";

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

export interface BackupInfo {
  file: string;
  created: number;
  size: number;
  // null when the snapshot exists but couldn't be read
  games: number | null;
  reason: string;
}

export interface RecoveryReport {
  problem: "missing" | "corrupt";
  restoredFrom: string | null;
  quarantined: string | null;
  detail?: string;
}

export interface ElectronAPI {
  getMatchHistory: (
    limit: number,
    offset: number,
    filters?: MatchFilters,
  ) => Promise<{ matches: MatchListItem[]; total: number }>;
  getMatchFilterOptions: (
    filters?: Pick<MatchFilters, "championId" | "patch" | "queue" | "account">,
  ) => Promise<MatchFilterOptions>;
  getMatchDetail: (gameId: number) => Promise<MatchDetail>;
  toggleFavorite: (gameId: number) => Promise<boolean>;
  getChampionStats: (patch?: string, queue?: number) => Promise<ChampionStats[]>;
  getAugmentStats: (championId?: number, patch?: string, queue?: number) => Promise<AugmentStats[]>;
  getAugmentStatsDetailed: (patch?: string, queue?: number) => Promise<AugmentStatsDetailed[]>;
  getDashboard: (
    filters?: Pick<MatchFilters, "championId" | "patch" | "queue" | "account">,
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
  getTrends: (queue?: number) => Promise<TrendsData>;
  getRecords: (queue?: number) => Promise<RecordsData>;
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
  getSummonerSpellData: () => Promise<SummonerSpellData>;
  onStatusChanged: (callback: (status: LcuStatus) => void) => () => void;
  onGamesUpdated: (callback: () => void) => () => void;
  getSetting: (key: string) => Promise<string | null>;
  isAutoStartSupported: () => Promise<boolean>;
  setSetting: (key: string, value: string) => Promise<void>;
  exportData: () => Promise<{
    success: boolean;
    path?: string;
    games?: number;
    error?: string;
  }>;
  importData: () => Promise<{ success: boolean; imported?: number; error?: string }>;
  repairPuuids: () => Promise<{
    repairedGames: number;
    discoveredAccounts: number;
    rebuiltGames: number;
  }>;
  listBackups: () => Promise<BackupInfo[]>;
  createBackup: () => Promise<{ success: boolean; backup?: BackupInfo; error?: string }>;
  restoreBackup: (file: string) => Promise<{ success: boolean; games?: number; error?: string }>;
  getRecoveryReport: () => Promise<RecoveryReport | null>;
  openBackupFolder: () => Promise<void>;
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
