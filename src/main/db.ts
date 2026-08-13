import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { SCORE_FORMULA_VERSION, computeMatchScores, scoreInputsFromRaw } from "../shared/opScore";
import { AUGMENT_SLOTS, QUEUE_ID_MAYHEM_CLASSIC } from "../shared/queues";
import { getDataDir } from "./paths";
import { getChampionClasses, getChampionDataVersion } from "./dragon";

// Poro-Snax (base and upgraded) is handed out for free, so it skews item stats
const EXCLUDED_ITEM_IDS = [2052, 220013];

let db: Database.Database;

function getDbPath() {
  return path.join(getDataDir(), "matches.db");
}

export function initDatabase() {
  const dbPath = getDbPath();
  db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  // NORMAL is the standard companion to WAL: commits stop waiting on an fsync,
  // which is what makes a several-thousand-game backfill bearable. The only
  // exposure is losing the most recent commits to an OS crash, and everything
  // here is re-fetchable from the client.
  db.pragma("synchronous = NORMAL");
  db.pragma("foreign_keys = ON");

  createTables();
  runMigrations();
  // After migrations: on a database from before a column existed, the index
  // covering it can only be built once that column has been added.
  createIndexes();

  // Backfill bonus augment slots (5+) from raw_json for games stored
  // when only 4 slots were captured.
  if (getSetting("augment_slots") !== String(AUGMENT_SLOTS)) {
    backfillAugmentSlots();
    setSetting("augment_slots", String(AUGMENT_SLOTS));
  }
}

// Checkpoints the WAL and releases the file. Without this a quit leaves the
// -wal alongside the database to be replayed on next launch.
export function closeDatabase() {
  if (!db || !db.open) return;
  try {
    db.close();
  } catch (err) {
    console.error("Failed to close database:", err);
  }
}

// Every table below is declared in its *current* shape, so a new database is
// correct without running a single migration. Migrations exist only to carry
// databases created by older versions up to the same shape — see runMigrations.
function createTables() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS games (
      game_id       INTEGER PRIMARY KEY,
      queue_id      INTEGER NOT NULL,
      game_mode     TEXT NOT NULL,
      game_creation INTEGER NOT NULL,
      game_duration INTEGER NOT NULL,
      is_remake     INTEGER NOT NULL DEFAULT 0,
      puuid         TEXT NOT NULL DEFAULT '',
      game_version  TEXT,
      favorite      INTEGER NOT NULL DEFAULT 0,
      raw_json      TEXT
    );

    CREATE TABLE IF NOT EXISTS player_stats (
      game_id              INTEGER PRIMARY KEY REFERENCES games(game_id),
      champion_id          INTEGER NOT NULL,
      win                  INTEGER NOT NULL,
      kills                INTEGER NOT NULL DEFAULT 0,
      deaths               INTEGER NOT NULL DEFAULT 0,
      assists              INTEGER NOT NULL DEFAULT 0,
      double_kills         INTEGER NOT NULL DEFAULT 0,
      triple_kills         INTEGER NOT NULL DEFAULT 0,
      quadra_kills         INTEGER NOT NULL DEFAULT 0,
      penta_kills          INTEGER NOT NULL DEFAULT 0,
      total_damage_dealt   INTEGER NOT NULL DEFAULT 0,
      total_damage_taken   INTEGER NOT NULL DEFAULT 0,
      gold_earned          INTEGER NOT NULL DEFAULT 0,
      total_heal           INTEGER NOT NULL DEFAULT 0,
      largest_killing_spree INTEGER NOT NULL DEFAULT 0,
      score                REAL,
      score_badge          TEXT,
      item0 INTEGER, item1 INTEGER, item2 INTEGER,
      item3 INTEGER, item4 INTEGER, item5 INTEGER, item6 INTEGER
    );

    CREATE TABLE IF NOT EXISTS game_augments (
      game_id    INTEGER NOT NULL REFERENCES games(game_id),
      slot       INTEGER NOT NULL,
      augment_id INTEGER NOT NULL,
      PRIMARY KEY (game_id, slot)
    );

    CREATE TABLE IF NOT EXISTS summoner (
      puuid        TEXT PRIMARY KEY,
      game_name    TEXT,
      tag_line     TEXT,
      summoner_id  INTEGER,
      account_id   INTEGER,
      profile_icon INTEGER,
      updated_at   INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    -- Games seen during a backfill that aren't Mayhem. Remembering them keeps
    -- repeat backfills from re-fetching every ARAM/Arena game each time.
    CREATE TABLE IF NOT EXISTS ignored_games (
      game_id INTEGER PRIMARY KEY
    );
  `);
}

// Split out from createTables because an index over a migrated-in column can
// only be built after runMigrations has actually added it.
function createIndexes() {
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_games_creation ON games(game_creation DESC);
    CREATE INDEX IF NOT EXISTS idx_games_puuid ON games(puuid);
    CREATE INDEX IF NOT EXISTS idx_games_version ON games(game_version);
    CREATE INDEX IF NOT EXISTS idx_games_queue ON games(queue_id);
    CREATE INDEX IF NOT EXISTS idx_player_stats_champion ON player_stats(champion_id);
    CREATE INDEX IF NOT EXISTS idx_game_augments_augment ON game_augments(augment_id);
  `);
}

// ---- Migrations ----
//
// Stamped in PRAGMA user_version. Version 0 means the database predates
// versioning, so it could be missing any subset of the columns v1 adds — which
// is why each step checks for its column rather than assuming. A database that
// createTables just built is also version 0, and lands on the same no-op path.
const SCHEMA_VERSION = 1;

function tableColumns(table: string): Set<string> {
  const rows = db.pragma(`table_info(${table})`) as { name: string }[];
  return new Set(rows.map((r) => r.name));
}

function runMigrations() {
  const current = db.pragma("user_version", { simple: true }) as number;
  if (current >= SCHEMA_VERSION) return;

  if (current < 1) migrateToV1();

  db.pragma(`user_version = ${SCHEMA_VERSION}`);
}

// Brings pre-versioning databases up to the schema createTables now declares.
// Each column is added only if absent, so this is a no-op on both new databases
// and ones already carried forward by the old try/catch migrations.
function migrateToV1() {
  const games = tableColumns("games");

  if (!games.has("is_remake")) {
    db.exec("ALTER TABLE games ADD COLUMN is_remake INTEGER NOT NULL DEFAULT 0");
    backfillRemakes();
  }

  if (!games.has("puuid")) {
    db.exec("ALTER TABLE games ADD COLUMN puuid TEXT NOT NULL DEFAULT ''");
    backfillGamePuuids();
  }

  if (!games.has("game_version")) {
    db.exec("ALTER TABLE games ADD COLUMN game_version TEXT");
    backfillGameVersions();
  }

  // Pins games to the top of match history; nothing to backfill.
  if (!games.has("favorite")) {
    db.exec("ALTER TABLE games ADD COLUMN favorite INTEGER NOT NULL DEFAULT 0");
  }

  // Scores are populated by checkScoreBackfill once champion data has loaded,
  // so the columns only need to exist here.
  const playerStats = tableColumns("player_stats");
  if (!playerStats.has("score")) {
    db.exec("ALTER TABLE player_stats ADD COLUMN score REAL");
  }
  if (!playerStats.has("score_badge")) {
    db.exec("ALTER TABLE player_stats ADD COLUMN score_badge TEXT");
  }

  // Remember our own profile icon so the home page can show it
  if (!tableColumns("summoner").has("profile_icon")) {
    db.exec("ALTER TABLE summoner ADD COLUMN profile_icon INTEGER");
  }
}

// Retroactively detect remakes for games stored before the flag existed
function backfillRemakes() {
  const games = db.prepare("SELECT game_id, game_duration, raw_json FROM games").all() as {
    game_id: number;
    game_duration: number;
    raw_json: string | null;
  }[];
  const updateStmt = db.prepare("UPDATE games SET is_remake = 1 WHERE game_id = ?");
  const tx = db.transaction(() => {
    for (const game of games) {
      if (detectRemake(game.game_duration, game.raw_json)) {
        updateStmt.run(game.game_id);
      }
    }
  });
  tx();
}

// Recover each game's owner by matching stored player_stats against the
// raw_json participants, for databases from before multi-account support
function backfillGamePuuids() {
  const gamesToBackfill = db
    .prepare(`
      SELECT g.game_id, g.raw_json,
             ps.champion_id, ps.kills, ps.deaths, ps.assists
      FROM games g
      JOIN player_stats ps ON g.game_id = ps.game_id
      WHERE g.puuid = '' AND g.raw_json IS NOT NULL
    `)
    .all() as {
    game_id: number;
    raw_json: string;
    champion_id: number;
    kills: number;
    deaths: number;
    assists: number;
  }[];

  const updateStmt = db.prepare("UPDATE games SET puuid = ? WHERE game_id = ?");
  const upsertStmt = db.prepare(`
    INSERT OR IGNORE INTO summoner (puuid, game_name, tag_line, summoner_id, account_id, updated_at)
    VALUES (?, ?, ?, NULL, NULL, ?)
  `);

  const tx = db.transaction(() => {
    for (const game of gamesToBackfill) {
      try {
        const raw = JSON.parse(game.raw_json);
        const participants = raw.participants || [];
        const identities = raw.participantIdentities || [];

        for (let i = 0; i < participants.length; i++) {
          const p = participants[i];
          const identity = identities[i];
          const s = p.stats || p;
          const championId = p.championId ?? s.championId ?? 0;

          if (
            championId === game.champion_id &&
            (s.kills ?? 0) === game.kills &&
            (s.deaths ?? 0) === game.deaths &&
            (s.assists ?? 0) === game.assists
          ) {
            const pPuuid = p.puuid || identity?.player?.puuid;
            if (pPuuid) {
              updateStmt.run(pPuuid, game.game_id);
              const gameName =
                identity?.player?.gameName ||
                identity?.player?.summonerName ||
                p.summonerName ||
                p.riotIdGameName ||
                null;
              const tagLine = identity?.player?.tagLine || p.riotIdTagline || null;
              upsertStmt.run(pPuuid, gameName, tagLine, Date.now());
            }
            break;
          }
        }
      } catch {
        /* ignore parse errors */
      }
    }
  });
  tx();
}

function backfillGameVersions() {
  const games = db
    .prepare("SELECT game_id, raw_json FROM games WHERE raw_json IS NOT NULL")
    .all() as { game_id: number; raw_json: string }[];
  const updateStmt = db.prepare("UPDATE games SET game_version = ? WHERE game_id = ?");
  const tx = db.transaction(() => {
    for (const game of games) {
      try {
        const raw = JSON.parse(game.raw_json);
        const patch = parsePatch(raw.gameVersion);
        if (patch) updateStmt.run(patch, game.game_id);
      } catch {
        /* ignore parse errors */
      }
    }
  });
  tx();
}

function backfillAugmentSlots() {
  const games = db
    .prepare("SELECT game_id, puuid, raw_json FROM games WHERE raw_json IS NOT NULL")
    .all() as { game_id: number; puuid: string; raw_json: string }[];
  const insertStmt = db.prepare(
    "INSERT OR IGNORE INTO game_augments (game_id, slot, augment_id) VALUES (?, ?, ?)",
  );
  const tx = db.transaction(() => {
    for (const game of games) {
      try {
        const raw = JSON.parse(game.raw_json);
        const participants = raw.participants || [];
        const identities = raw.participantIdentities || [];
        let participant = participants.find((p: any) => p.puuid === game.puuid);
        if (!participant) {
          const identity = identities.find((pi: any) => pi.player?.puuid === game.puuid);
          if (identity) {
            participant = participants.find((p: any) => p.participantId === identity.participantId);
          }
        }
        if (!participant) continue;
        const s = participant.stats || participant;
        for (let i = 1; i <= AUGMENT_SLOTS; i++) {
          const augId = s[`playerAugment${i}`];
          if (augId && augId > 0) {
            insertStmt.run(game.game_id, i, augId);
          }
        }
      } catch {
        /* ignore parse errors */
      }
    }
  });
  tx();
}

// Appends queue conditions to a query's WHERE list. An explicit queue filter
// wins; otherwise the hide-classic setting excludes Mayhem Classic everywhere.
function applyQueueFilter(where: string[], params: any[], queue?: number, alias = "g") {
  if (queue != null) {
    where.push(`${alias}.queue_id = ?`);
    params.push(queue);
  } else if (getSetting("hide_classic_games") === "true") {
    where.push(`${alias}.queue_id != ?`);
    params.push(QUEUE_ID_MAYHEM_CLASSIC);
  }
}

// Score backfills are keyed on formula version + champion data version, so
// stored scores recompute when either changes (new formula, new patch,
// re-tagged champion).
function scoreFormulaKey() {
  return `${SCORE_FORMULA_VERSION}@${getChampionDataVersion()}`;
}

// Recompute stored scores from raw_json. Runs whenever the formula version or
// the champion class data changes (new patch, re-tagged champion) so stored
// scores never go stale. Call after champion data has loaded; returns whether
// a backfill ran so the caller can refresh the renderer.
export function checkScoreBackfill(): boolean {
  if (getSetting("score_formula_version") === scoreFormulaKey()) return false;
  backfillScores();
  setSetting("score_formula_version", scoreFormulaKey());
  return true;
}

function computeOwnerScore(
  raw: any,
  ownerPuuid: string | null,
  fallback?: { champion_id: number; kills: number; deaths: number; assists: number },
): { score: number; badge: string | null } | null {
  const inputs = scoreInputsFromRaw(raw);
  if (inputs.length === 0) return null;
  let owner = ownerPuuid ? inputs.find((p) => p.puuid === ownerPuuid) : undefined;
  if (!owner && fallback) {
    owner = inputs.find(
      (p) =>
        p.championId === fallback.champion_id &&
        p.kills === fallback.kills &&
        p.deaths === fallback.deaths &&
        p.assists === fallback.assists,
    );
  }
  if (!owner) return null;
  const s = computeMatchScores(inputs, getChampionClasses()).get(owner.participantId);
  return s ? { score: s.score, badge: s.badge } : null;
}

function backfillScores() {
  const rows = db
    .prepare(`
      SELECT g.game_id, g.puuid, g.raw_json, g.is_remake,
             ps.champion_id, ps.kills, ps.deaths, ps.assists
      FROM games g
      JOIN player_stats ps ON g.game_id = ps.game_id
      WHERE g.raw_json IS NOT NULL
    `)
    .all() as {
    game_id: number;
    puuid: string;
    raw_json: string;
    is_remake: number;
    champion_id: number;
    kills: number;
    deaths: number;
    assists: number;
  }[];

  const updateStmt = db.prepare(
    "UPDATE player_stats SET score = ?, score_badge = ? WHERE game_id = ?",
  );
  const tx = db.transaction(() => {
    for (const row of rows) {
      if (row.is_remake) {
        updateStmt.run(null, null, row.game_id);
        continue;
      }
      try {
        const result = computeOwnerScore(JSON.parse(row.raw_json), row.puuid || null, row);
        updateStmt.run(result?.score ?? null, result?.badge ?? null, row.game_id);
      } catch {
        /* ignore parse errors */
      }
    }
  });
  tx();
}

function parsePatch(version: unknown): string | null {
  if (typeof version !== "string") return null;
  const m = version.match(/^(\d+)\.(\d+)/);
  return m ? `${m[1]}.${m[2]}` : null;
}

function detectRemake(gameDuration: number, rawJson: string | null): boolean {
  // Very short games are always remakes
  if (gameDuration < 300) return true;
  // Check for early surrender flag in participant data
  if (rawJson) {
    try {
      const raw = JSON.parse(rawJson);
      if (raw.participants) {
        for (const p of raw.participants) {
          const s = p.stats || p;
          if (s.gameEndedInEarlySurrender && gameDuration < 600) return true;
        }
      }
    } catch {
      /* ignore parse errors */
    }
  }
  return false;
}

// ---- Helpers ----

function extractGameMaxStats(rawJson: string | null): {
  game_max_dmg: number;
  game_max_taken: number;
  game_max_heal: number;
} {
  const fallback = { game_max_dmg: 1, game_max_taken: 1, game_max_heal: 1 };
  if (!rawJson) return fallback;
  try {
    const raw = JSON.parse(rawJson);
    if (!raw?.participants) return fallback;
    let dmg = 0,
      taken = 0,
      heal = 0;
    for (const p of raw.participants) {
      const s = p.stats || p;
      const d = s.totalDamageDealtToChampions ?? s.totalDamageDealt ?? 0;
      const t = s.totalDamageTaken ?? 0;
      const h = s.totalHeal ?? 0;
      if (d > dmg) dmg = d;
      if (t > taken) taken = t;
      if (h > heal) heal = h;
    }
    return { game_max_dmg: dmg || 1, game_max_taken: taken || 1, game_max_heal: heal || 1 };
  } catch {
    return fallback;
  }
}

// ---- Query functions ----

const MATCH_SORT_COLUMNS: Record<string, string> = {
  date: "g.game_creation",
  kda: "(ps.kills + ps.assists) * 1.0 / MAX(ps.deaths, 1)",
  kills: "ps.kills",
  duration: "g.game_duration",
  score: "ps.score",
};

function matchOrderBy(sort?: string, sortDir?: string): string {
  const key = sort && MATCH_SORT_COLUMNS[sort] ? sort : "date";
  const dir = sortDir === "asc" ? "ASC" : "DESC";
  const parts: string[] = [];
  // Games without a score belong at the bottom whichever way we're sorting
  if (key === "score") parts.push("ps.score IS NULL");
  parts.push(`${MATCH_SORT_COLUMNS[key]} ${dir}`);
  if (key !== "date") parts.push("g.game_creation DESC");
  return parts.join(", ");
}

const MULTIKILL_COLUMNS: Record<string, string> = {
  doubles: "ps.double_kills",
  triples: "ps.triple_kills",
  quadras: "ps.quadra_kills",
  pentas: "ps.penta_kills",
};

export function getMatchHistory(
  limit: number,
  offset: number,
  filters?: {
    championId?: number;
    patch?: string;
    queue?: number;
    sort?: string;
    sortDir?: string;
    multikills?: string[];
  },
): { matches: any[]; total: number } {
  const where: string[] = [];
  const params: any[] = [];
  if (filters?.championId != null) {
    where.push("ps.champion_id = ?");
    params.push(filters.championId);
  }
  if (filters?.patch) {
    where.push("g.game_version = ?");
    params.push(filters.patch);
  }
  applyQueueFilter(where, params, filters?.queue);
  if (filters?.multikills && filters.multikills.length > 0) {
    const cols = filters.multikills
      .map((k) => MULTIKILL_COLUMNS[k])
      .filter((col): col is string => !!col);
    if (cols.length > 0) {
      where.push(`(${cols.map((col) => `${col} > 0`).join(" OR ")})`);
    }
  }
  const whereSql = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
  const orderBy = matchOrderBy(filters?.sort, filters?.sortDir);

  const total = db
    .prepare(`
    SELECT COUNT(*) as count
    FROM games g
    JOIN player_stats ps ON g.game_id = ps.game_id
    ${whereSql}
  `)
    .get(...params) as any;
  const rows = db
    .prepare(`
    SELECT g.game_id, g.queue_id, g.game_creation, g.game_duration, g.is_remake, g.favorite, g.puuid, g.game_version, g.raw_json,
           ps.champion_id, ps.win, ps.kills, ps.deaths, ps.assists,
           ps.double_kills, ps.triple_kills, ps.quadra_kills, ps.penta_kills,
           ps.total_damage_dealt, ps.total_damage_taken, ps.total_heal, ps.gold_earned,
           ps.score, ps.score_badge,
           ps.item0, ps.item1, ps.item2, ps.item3, ps.item4, ps.item5,
           (SELECT GROUP_CONCAT(ga.augment_id) FROM game_augments ga WHERE ga.game_id = g.game_id ORDER BY ga.slot) as augment_ids
    FROM games g
    JOIN player_stats ps ON g.game_id = ps.game_id
    ${whereSql}
    ORDER BY g.favorite DESC, ${orderBy}
    LIMIT ? OFFSET ?
  `)
    .all(...params, limit, offset);
  const matches = rows.map((row: any) => {
    const maxStats = extractGameMaxStats(row.raw_json);
    const { raw_json: _raw_json, ...match } = row;
    return { ...match, ...maxStats };
  });
  return { matches, total: total.count };
}

export function getMatchFilterOptions(filters?: {
  championId?: number;
  patch?: string;
  queue?: number;
}): {
  patches: string[];
  champions: number[];
  queues: number[];
} {
  // Each list is narrowed by the OTHER filters so a dropdown never hides its own selection
  const patchWhere = ["g.game_version IS NOT NULL AND g.game_version != ''"];
  const patchParams: any[] = [];
  if (filters?.championId != null) {
    patchWhere.push("ps.champion_id = ?");
    patchParams.push(filters.championId);
  }
  applyQueueFilter(patchWhere, patchParams, filters?.queue);
  const patchRows = db
    .prepare(`
    SELECT DISTINCT g.game_version
    FROM games g
    JOIN player_stats ps ON g.game_id = ps.game_id
    WHERE ${patchWhere.join(" AND ")}
  `)
    .all(...patchParams) as { game_version: string }[];
  const patches = patchRows
    .map((r) => r.game_version)
    .sort((a, b) => {
      const [aMajor, aMinor] = a.split(".").map(Number);
      const [bMajor, bMinor] = b.split(".").map(Number);
      return bMajor - aMajor || bMinor - aMinor;
    });

  const champWhere = ["1 = 1"];
  const champParams: any[] = [];
  if (filters?.patch) {
    champWhere.push("g.game_version = ?");
    champParams.push(filters.patch);
  }
  applyQueueFilter(champWhere, champParams, filters?.queue);
  const champRows = db
    .prepare(`
    SELECT DISTINCT ps.champion_id
    FROM player_stats ps
    JOIN games g ON ps.game_id = g.game_id
    WHERE ${champWhere.join(" AND ")}
    ORDER BY ps.champion_id
  `)
    .all(...champParams) as { champion_id: number }[];

  const queueWhere = ["1 = 1"];
  const queueParams: any[] = [];
  if (filters?.championId != null) {
    queueWhere.push("ps.champion_id = ?");
    queueParams.push(filters.championId);
  }
  if (filters?.patch) {
    queueWhere.push("g.game_version = ?");
    queueParams.push(filters.patch);
  }
  applyQueueFilter(queueWhere, queueParams, undefined);
  const queueRows = db
    .prepare(`
    SELECT DISTINCT g.queue_id
    FROM games g
    JOIN player_stats ps ON g.game_id = ps.game_id
    WHERE ${queueWhere.join(" AND ")}
    ORDER BY g.queue_id
  `)
    .all(...queueParams) as { queue_id: number }[];

  return {
    patches,
    champions: champRows.map((r) => r.champion_id),
    queues: queueRows.map((r) => r.queue_id),
  };
}

export function getMatchDetail(gameId: number): any {
  const game = db.prepare("SELECT * FROM games WHERE game_id = ?").get(gameId) as any;
  if (!game) return null;
  const stats = db.prepare("SELECT * FROM player_stats WHERE game_id = ?").get(gameId);
  const augments = db
    .prepare("SELECT * FROM game_augments WHERE game_id = ? ORDER BY slot")
    .all(gameId);
  return {
    game,
    stats,
    augments,
    raw: game.raw_json ? JSON.parse(game.raw_json) : null,
  };
}

export function getChampionStatsAll(patch?: string, queue?: number): any[] {
  const where = ["g.is_remake = 0"];
  const params: any[] = [];
  if (patch) {
    where.push("g.game_version = ?");
    params.push(patch);
  }
  applyQueueFilter(where, params, queue);
  return db
    .prepare(`
    SELECT
      ps.champion_id,
      COUNT(*) as games,
      SUM(ps.win) as wins,
      SUM(ps.kills) as kills,
      SUM(ps.deaths) as deaths,
      SUM(ps.assists) as assists,
      ROUND(AVG(ps.kills), 1) as avg_kills,
      ROUND(AVG(ps.deaths), 1) as avg_deaths,
      ROUND(AVG(ps.assists), 1) as avg_assists,
      ROUND(AVG(ps.total_damage_dealt)) as avg_damage,
      ROUND(AVG(ps.gold_earned)) as avg_gold,
      ROUND(AVG(ps.score), 1) as avg_score,
      SUM(CASE WHEN ps.score_badge = 'MVP' THEN 1 ELSE 0 END) as mvps,
      SUM(CASE WHEN ps.score_badge = 'ACE' THEN 1 ELSE 0 END) as aces,
      SUM(ps.double_kills) as double_kills,
      SUM(ps.triple_kills) as triple_kills,
      SUM(ps.quadra_kills) as quadra_kills,
      SUM(ps.penta_kills) as penta_kills
    FROM player_stats ps
    JOIN games g ON ps.game_id = g.game_id
    WHERE ${where.join(" AND ")}
    GROUP BY ps.champion_id
    ORDER BY games DESC
  `)
    .all(...params);
}

export function getAugmentStatsAll(championId?: number, patch?: string, queue?: number): any[] {
  const where = ["g.is_remake = 0"];
  const params: any[] = [];
  if (championId !== undefined) {
    where.push("ps.champion_id = ?");
    params.push(championId);
  }
  if (patch) {
    where.push("g.game_version = ?");
    params.push(patch);
  }
  applyQueueFilter(where, params, queue);
  return db
    .prepare(`
    SELECT ga.augment_id, COUNT(*) as picks, SUM(ps.win) as wins
    FROM game_augments ga
    JOIN player_stats ps ON ga.game_id = ps.game_id
    JOIN games g ON ga.game_id = g.game_id
    WHERE ${where.join(" AND ")}
    GROUP BY ga.augment_id
    ORDER BY picks DESC
  `)
    .all(...params);
}

export function getDashboardData(filters?: {
  championId?: number;
  patch?: string;
  queue?: number;
}): any {
  const where: string[] = ["g.is_remake = 0"];
  const params: any[] = [];
  if (filters?.championId != null) {
    where.push("ps.champion_id = ?");
    params.push(filters.championId);
  }
  if (filters?.patch) {
    where.push("g.game_version = ?");
    params.push(filters.patch);
  }
  applyQueueFilter(where, params, filters?.queue);
  const whereSql = `WHERE ${where.join(" AND ")}`;

  const totals = db
    .prepare(`
    SELECT COUNT(*) as totalGames,
           SUM(ps.win) as wins,
           SUM(ps.kills) as totalKills,
           SUM(ps.deaths) as totalDeaths,
           SUM(ps.assists) as totalAssists,
           SUM(ps.double_kills) as doubles,
           SUM(ps.triple_kills) as triples,
           SUM(ps.quadra_kills) as quadras,
           SUM(ps.penta_kills) as pentas,
           AVG(ps.score) as avgScore,
           SUM(CASE WHEN ps.score_badge = 'MVP' THEN 1 ELSE 0 END) as mvps,
           SUM(CASE WHEN ps.score_badge = 'ACE' THEN 1 ELSE 0 END) as aces,
           SUM(CASE WHEN ps.score IS NOT NULL AND ps.win = 1 THEN 1 ELSE 0 END) as scoredWins,
           SUM(CASE WHEN ps.score IS NOT NULL AND ps.win = 0 THEN 1 ELSE 0 END) as scoredLosses,
           -- Every total here pools all tracked accounts; games whose owner was
           -- never resolved carry an empty puuid and aren't an account
           COUNT(DISTINCT NULLIF(g.puuid, '')) as accounts
    FROM player_stats ps
    JOIN games g ON ps.game_id = g.game_id
    ${whereSql}
  `)
    .get(...params) as any;

  const recentForm = db
    .prepare(`
    SELECT ps.win, g.game_id
    FROM games g
    JOIN player_stats ps ON g.game_id = ps.game_id
    ${whereSql}
    ORDER BY g.game_creation DESC
    LIMIT 10
  `)
    .all(...params);

  const topChampions = db
    .prepare(`
    SELECT
      ps.champion_id,
      COUNT(*) as games,
      SUM(ps.win) as wins,
      ROUND(AVG(ps.kills), 1) as avg_kills,
      ROUND(AVG(ps.deaths), 1) as avg_deaths,
      ROUND(AVG(ps.assists), 1) as avg_assists
    FROM player_stats ps
    JOIN games g ON ps.game_id = g.game_id
    ${whereSql}
    GROUP BY ps.champion_id
    ORDER BY games DESC
    LIMIT 5
  `)
    .all(...params);

  const topAugments = db
    .prepare(`
    SELECT ga.augment_id, COUNT(*) as picks, SUM(ps.win) as wins
    FROM game_augments ga
    JOIN player_stats ps ON ga.game_id = ps.game_id
    JOIN games g ON ga.game_id = g.game_id
    ${whereSql}
    GROUP BY ga.augment_id
    ORDER BY picks DESC
    LIMIT 5
  `)
    .all(...params);

  return {
    totalGames: totals.totalGames ?? 0,
    wins: totals.wins ?? 0,
    totalKills: totals.totalKills ?? 0,
    totalDeaths: totals.totalDeaths ?? 0,
    totalAssists: totals.totalAssists ?? 0,
    avgScore: totals.avgScore ?? null,
    mvps: totals.mvps ?? 0,
    aces: totals.aces ?? 0,
    scoredWins: totals.scoredWins ?? 0,
    scoredLosses: totals.scoredLosses ?? 0,
    accounts: totals.accounts ?? 0,
    recentForm,
    topChampions,
    multikills: {
      doubles: totals.doubles ?? 0,
      triples: totals.triples ?? 0,
      quadras: totals.quadras ?? 0,
      pentas: totals.pentas ?? 0,
    },
    topAugments,
  };
}

export function getAugmentStatsWithChampions(
  patch?: string,
  queue?: number,
): {
  augment_id: number;
  picks: number;
  wins: number;
  champions: { champion_id: number; picks: number; wins: number }[];
}[] {
  const where = ["g.is_remake = 0"];
  const params: any[] = [];
  if (patch) {
    where.push("g.game_version = ?");
    params.push(patch);
  }
  applyQueueFilter(where, params, queue);
  const augments = db
    .prepare(`
    SELECT ga.augment_id, COUNT(*) as picks, SUM(ps.win) as wins
    FROM game_augments ga
    JOIN player_stats ps ON ga.game_id = ps.game_id
    JOIN games g ON ga.game_id = g.game_id
    WHERE ${where.join(" AND ")}
    GROUP BY ga.augment_id
    ORDER BY picks DESC
  `)
    .all(...params) as { augment_id: number; picks: number; wins: number }[];

  const champBreakdown = db
    .prepare(`
    SELECT ga.augment_id, ps.champion_id, COUNT(*) as picks, SUM(ps.win) as wins
    FROM game_augments ga
    JOIN player_stats ps ON ga.game_id = ps.game_id
    JOIN games g ON ga.game_id = g.game_id
    WHERE ${where.join(" AND ")}
    GROUP BY ga.augment_id, ps.champion_id
    ORDER BY picks DESC
  `)
    .all(...params) as { augment_id: number; champion_id: number; picks: number; wins: number }[];

  const champMap = new Map<number, { champion_id: number; picks: number; wins: number }[]>();
  for (const row of champBreakdown) {
    if (!champMap.has(row.augment_id)) champMap.set(row.augment_id, []);
    champMap
      .get(row.augment_id)!
      .push({ champion_id: row.champion_id, picks: row.picks, wins: row.wins });
  }

  return augments.map((a) => ({
    ...a,
    champions: champMap.get(a.augment_id) ?? [],
  }));
}

export function getChampionMatchHistory(
  championId: number,
  limit: number,
  offset: number,
  patch?: string,
  queue?: number,
): { matches: any[]; total: number } {
  const where = ["ps.champion_id = ?"];
  const params: any[] = [championId];
  if (patch) {
    where.push("g.game_version = ?");
    params.push(patch);
  }
  applyQueueFilter(where, params, queue);
  const whereSql = `WHERE ${where.join(" AND ")}`;
  const total = db
    .prepare(`
    SELECT COUNT(*) as count
    FROM games g
    JOIN player_stats ps ON g.game_id = ps.game_id
    ${whereSql}
  `)
    .get(...params) as any;
  const rows = db
    .prepare(`
    SELECT g.game_id, g.game_creation, g.game_duration, g.is_remake, g.favorite, g.puuid, g.raw_json,
           ps.champion_id, ps.win, ps.kills, ps.deaths, ps.assists,
           ps.double_kills, ps.triple_kills, ps.quadra_kills, ps.penta_kills,
           ps.total_damage_dealt, ps.total_damage_taken, ps.total_heal, ps.gold_earned,
           ps.score, ps.score_badge,
           ps.item0, ps.item1, ps.item2, ps.item3, ps.item4, ps.item5,
           (SELECT GROUP_CONCAT(ga.augment_id) FROM game_augments ga WHERE ga.game_id = g.game_id ORDER BY ga.slot) as augment_ids
    FROM games g
    JOIN player_stats ps ON g.game_id = ps.game_id
    ${whereSql}
    ORDER BY g.game_creation DESC
    LIMIT ? OFFSET ?
  `)
    .all(...params, limit, offset);
  const matches = rows.map((row: any) => {
    const maxStats = extractGameMaxStats(row.raw_json);
    const { raw_json: _raw_json, ...match } = row;
    return { ...match, ...maxStats };
  });
  return { matches, total: total.count };
}

export function toggleFavorite(gameId: number): boolean {
  db.prepare("UPDATE games SET favorite = 1 - favorite WHERE game_id = ?").run(gameId);
  const row = db.prepare("SELECT favorite FROM games WHERE game_id = ?").get(gameId) as
    | { favorite: number }
    | undefined;
  return !!row?.favorite;
}

export function gameExists(gameId: number): boolean {
  const row = db.prepare("SELECT 1 FROM games WHERE game_id = ?").get(gameId);
  return !!row;
}

// Every game id we've already made a decision about — stored or deliberately
// skipped. One query beats a lookup per id when a backfill checks hundreds.
export function getKnownGameIds(): Set<number> {
  const rows = db
    .prepare("SELECT game_id FROM games UNION SELECT game_id FROM ignored_games")
    .all() as { game_id: number }[];
  return new Set(rows.map((r) => r.game_id));
}

export function markIgnoredGame(gameId: number): void {
  db.prepare("INSERT OR IGNORE INTO ignored_games (game_id) VALUES (?)").run(gameId);
}

// Find the raw participant object for a puuid (LCU shape, both flat and
// participantIdentities variants).
function findParticipant(raw: any, puuid: string): any | null {
  if (!raw?.participants || !puuid) return null;
  let participant = raw.participants.find((p: any) => p.puuid === puuid);
  if (!participant && raw.participantIdentities) {
    const identity = raw.participantIdentities.find((pi: any) => pi.player?.puuid === puuid);
    if (identity) {
      participant = raw.participants.find((p: any) => p.participantId === identity.participantId);
    }
  }
  return participant || null;
}

export function insertGameFull(gameData: any, puuid: string): boolean {
  const participant = findParticipant(gameData, puuid);
  if (!participant) return false;

  const s = participant.stats || participant;

  const isRemake = detectRemake(gameData.gameDuration, JSON.stringify(gameData)) ? 1 : 0;

  let ownerScore: { score: number; badge: string | null } | null = null;
  if (!isRemake) {
    ownerScore = computeOwnerScore(gameData, puuid, {
      champion_id: participant.championId ?? s.championId ?? 0,
      kills: s.kills ?? 0,
      deaths: s.deaths ?? 0,
      assists: s.assists ?? 0,
    });
  }

  const insertGameStmt = db.prepare(`
    INSERT OR IGNORE INTO games (game_id, queue_id, game_mode, game_creation, game_duration, is_remake, puuid, game_version, raw_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertStatsStmt = db.prepare(`
    INSERT OR IGNORE INTO player_stats (
      game_id, champion_id, win, kills, deaths, assists,
      double_kills, triple_kills, quadra_kills, penta_kills,
      total_damage_dealt, total_damage_taken, gold_earned, total_heal,
      largest_killing_spree, item0, item1, item2, item3, item4, item5, item6,
      score, score_badge
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertAugmentStmt = db.prepare(`
    INSERT OR IGNORE INTO game_augments (game_id, slot, augment_id) VALUES (?, ?, ?)
  `);

  const tx = db.transaction(() => {
    const result = insertGameStmt.run(
      gameData.gameId,
      gameData.queueId,
      gameData.gameMode,
      gameData.gameCreation,
      gameData.gameDuration,
      isRemake,
      puuid,
      parsePatch(gameData.gameVersion),
      JSON.stringify(gameData),
    );

    if (result.changes === 0) return false; // duplicate

    insertStatsStmt.run(
      gameData.gameId,
      participant.championId ?? s.championId ?? 0,
      s.win ? 1 : 0,
      s.kills ?? 0,
      s.deaths ?? 0,
      s.assists ?? 0,
      s.doubleKills ?? 0,
      s.tripleKills ?? 0,
      s.quadraKills ?? 0,
      s.pentaKills ?? 0,
      s.totalDamageDealtToChampions ?? s.totalDamageDealt ?? 0,
      s.totalDamageTaken ?? 0,
      s.goldEarned ?? 0,
      s.totalHeal ?? 0,
      s.largestKillingSpree ?? 0,
      s.item0 ?? null,
      s.item1 ?? null,
      s.item2 ?? null,
      s.item3 ?? null,
      s.item4 ?? null,
      s.item5 ?? null,
      s.item6 ?? null,
      ownerScore?.score ?? null,
      ownerScore?.badge ?? null,
    );

    // Augments
    for (let i = 1; i <= AUGMENT_SLOTS; i++) {
      const augId = s[`playerAugment${i}`];
      if (augId && augId > 0) {
        insertAugmentStmt.run(gameData.gameId, i, augId);
      }
    }

    return true;
  });

  return tx() as boolean;
}

export function upsertSummoner(summoner: any): void {
  // REPLACE wipes the row, so keep the stored icon when this update doesn't
  // carry one (imported summoner rows predate the column)
  db.prepare(`
    INSERT OR REPLACE INTO summoner (puuid, game_name, tag_line, summoner_id, account_id, updated_at, profile_icon)
    VALUES (?, ?, ?, ?, ?, ?, COALESCE(?, (SELECT profile_icon FROM summoner WHERE puuid = ?)))
  `).run(
    summoner.puuid,
    summoner.displayName || summoner.gameName || summoner.internalName || summoner.game_name,
    summoner.tagLine || summoner.tag_line || null,
    summoner.summonerId ?? summoner.summoner_id,
    summoner.accountId ?? summoner.account_id,
    Date.now(),
    summoner.profileIconId ?? summoner.profile_icon ?? null,
    summoner.puuid,
  );
}

export function getSummoner(): any {
  return db.prepare("SELECT * FROM summoner ORDER BY updated_at DESC LIMIT 1").get();
}

// One account's name and icon as that game recorded them. Covers databases
// built purely from an import, where the client has never connected and the
// summoner table has no icon.
function identityFromGame(
  rawJson: string | null,
  puuid: string,
): { name: string | null; icon: number | null } {
  if (!rawJson) return { name: null, icon: null };
  try {
    const raw = JSON.parse(rawJson);
    const player = (raw.participantIdentities || []).find(
      (pi: any) => pi.player?.puuid === puuid,
    )?.player;
    if (!player) return { name: null, icon: null };
    const gameName = player.gameName || player.summonerName || null;
    return {
      name: gameName && player.tagLine ? `${gameName}#${player.tagLine}` : gameName,
      icon:
        typeof player.profileIcon === "number" && player.profileIcon > 0
          ? player.profileIcon
          : null,
    };
  } catch {
    return { name: null, icon: null };
  }
}

// The header names whichever account played most recently, so its name and icon
// always come from the same place. Keying off the summoner table's updated_at
// instead would name the account the client last synced — which need not be the
// one that played, and which repairPuuids rewrites for every account at once.
export function getProfile(): { name: string | null; profileIcon: number | null } {
  const latest = db
    .prepare(
      "SELECT puuid, raw_json FROM games WHERE puuid != '' ORDER BY game_creation DESC LIMIT 1",
    )
    .get() as { puuid: string; raw_json: string | null } | undefined;

  // No games yet — the client is the only thing that knows who we are
  const row = latest
    ? (db.prepare("SELECT * FROM summoner WHERE puuid = ?").get(latest.puuid) as any)
    : getSummoner();

  const name = row?.game_name
    ? row.tag_line
      ? `${row.game_name}#${row.tag_line}`
      : row.game_name
    : null;
  const icon = row?.profile_icon ?? null;
  if (name && icon != null) return { name, profileIcon: icon };

  // profile_icon only fills in once the client has synced this account, and an
  // imported game may have no summoner row at all — read both off the game
  // itself, still the same account.
  const fallback = latest
    ? identityFromGame(latest.raw_json, latest.puuid)
    : { name: null, icon: null };
  return { name: name ?? fallback.name, profileIcon: icon ?? fallback.icon };
}

export function getAllPuuids(): string[] {
  const rows = db.prepare("SELECT puuid FROM summoner").all() as { puuid: string }[];
  return rows.map((r) => r.puuid);
}

// Someone we queued with once is a stranger, not a friend — the list only
// counts players we've shared at least this many games with.
const MIN_SHARED_GAMES = 2;

interface TeammateEntry {
  participant: any;
  puuid: string | null;
  name: string;
  profileIcon: number | null;
}

// Everyone on the same team as one of our accounts in a single game (excluding
// our own accounts). Returns null when no tracked account played this game.
function collectTeammates(raw: any, puuids: Set<string>): TeammateEntry[] | null {
  const participants = raw.participants || [];
  const identities = raw.participantIdentities || [];

  let myTeamId: number | null = null;
  let myParticipantId: number | null = null;
  for (let i = 0; i < participants.length; i++) {
    const p = participants[i];
    const pPuuid = p.puuid || identities[i]?.player?.puuid;
    if (pPuuid && puuids.has(pPuuid)) {
      myTeamId = p.teamId || 100;
      myParticipantId = p.participantId;
      break;
    }
  }
  if (myTeamId === null) return null;

  const teammates: TeammateEntry[] = [];
  for (let i = 0; i < participants.length; i++) {
    const p = participants[i];
    const identity = identities[i];
    if ((p.teamId || 100) !== myTeamId) continue;
    if (p.participantId === myParticipantId) continue;

    const rawPuuid = p.puuid || identity?.player?.puuid || null;
    if (rawPuuid && puuids.has(rawPuuid)) continue;

    // Filter out placeholder/bot puuids
    const playerPuuid = rawPuuid && !/^0+(-0+)*$/.test(rawPuuid) ? rawPuuid : null;
    const gameName =
      identity?.player?.gameName || identity?.player?.summonerName || p.summonerName || null;
    const tagLine = identity?.player?.tagLine || null;
    const name = gameName ? (tagLine ? `${gameName}#${tagLine}` : gameName) : `Player ${i + 1}`;
    const icon = identity?.player?.profileIcon;

    teammates.push({
      participant: p,
      puuid: playerPuuid,
      name,
      profileIcon: typeof icon === "number" && icon > 0 ? icon : null,
    });
  }
  return teammates;
}

// The id the Friends list keys a teammate on — puuid when we know it, so name
// changes don't split a player in two.
function teammateKey(entry: { puuid: string | null; name: string }): string {
  return entry.puuid || entry.name;
}

export function getTeammateStats(): any[] {
  const puuids = new Set(getAllPuuids());
  if (puuids.size === 0) return [];

  const teammateWhere = ["g.raw_json IS NOT NULL", "g.is_remake = 0"];
  const teammateParams: any[] = [];
  applyQueueFilter(teammateWhere, teammateParams, undefined);
  const games = db
    .prepare(
      `SELECT g.game_id, g.raw_json, g.game_creation FROM games g WHERE ${teammateWhere.join(" AND ")}`,
    )
    .all(...teammateParams) as any[];

  const playerMap = new Map<
    string,
    {
      name: string;
      puuid: string | null;
      profileIcon: number | null;
      games: number;
      wins: number;
      kills: number;
      deaths: number;
      assists: number;
      champions: Map<number, number>;
      lastPlayed: number;
    }
  >();

  for (const game of games) {
    let raw: any;
    try {
      raw = JSON.parse(game.raw_json);
    } catch {
      continue;
    }

    const teammates = collectTeammates(raw, puuids);
    if (!teammates) continue;

    for (const t of teammates) {
      const key = teammateKey(t);
      const p = t.participant;
      const s = p.stats || p;

      // If we now have a puuid but previously tracked this player by name, merge
      if (t.puuid && !playerMap.has(t.puuid) && playerMap.has(t.name)) {
        const old = playerMap.get(t.name)!;
        if (!old.puuid) {
          playerMap.set(t.puuid, old);
          old.puuid = t.puuid;
          playerMap.delete(t.name);
        }
      }

      if (!playerMap.has(key)) {
        playerMap.set(key, {
          name: t.name,
          puuid: t.puuid,
          profileIcon: null,
          games: 0,
          wins: 0,
          kills: 0,
          deaths: 0,
          assists: 0,
          champions: new Map(),
          lastPlayed: 0,
        });
      }

      const entry = playerMap.get(key)!;
      // Update name and icon to the most recent version
      if (game.game_creation > entry.lastPlayed) {
        entry.name = t.name;
        if (t.profileIcon != null) entry.profileIcon = t.profileIcon;
      }
      entry.games++;
      if (s.win) entry.wins++;
      entry.kills += s.kills ?? 0;
      entry.deaths += s.deaths ?? 0;
      entry.assists += s.assists ?? 0;
      entry.lastPlayed = Math.max(entry.lastPlayed, game.game_creation);

      const champId = p.championId ?? s.championId ?? 0;
      entry.champions.set(champId, (entry.champions.get(champId) || 0) + 1);
    }
  }

  return Array.from(playerMap.entries())
    .filter(([, p]) => p.games >= MIN_SHARED_GAMES)
    .map(([key, p]) => ({
      key,
      name: p.name,
      puuid: p.puuid,
      profileIcon: p.profileIcon,
      games: p.games,
      wins: p.wins,
      kills: p.kills,
      deaths: p.deaths,
      assists: p.assists,
      champions: Array.from(p.champions.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([champion_id, games]) => ({ champion_id, games })),
      lastPlayed: p.lastPlayed,
    }))
    .sort((a, b) => b.games - a.games);
}

// Every game we played alongside one teammate, from both sides: our stored
// stats for the row plus the teammate's own line in that game.
export function getTeammateDetail(key: string): { player: any; matches: any[] } | null {
  const puuids = new Set(getAllPuuids());
  if (puuids.size === 0) return null;

  const where = ["g.raw_json IS NOT NULL", "g.is_remake = 0"];
  const params: any[] = [];
  applyQueueFilter(where, params, undefined);
  const rows = db
    .prepare(`
    SELECT g.game_id, g.queue_id, g.game_creation, g.game_duration, g.is_remake, g.favorite,
           g.puuid, g.game_version, g.raw_json,
           ps.champion_id, ps.win, ps.kills, ps.deaths, ps.assists,
           ps.double_kills, ps.triple_kills, ps.quadra_kills, ps.penta_kills,
           ps.total_damage_dealt, ps.total_damage_taken, ps.total_heal, ps.gold_earned,
           ps.score, ps.score_badge,
           ps.item0, ps.item1, ps.item2, ps.item3, ps.item4, ps.item5,
           (SELECT GROUP_CONCAT(ga.augment_id) FROM game_augments ga WHERE ga.game_id = g.game_id ORDER BY ga.slot) as augment_ids
    FROM games g
    JOIN player_stats ps ON g.game_id = ps.game_id
    WHERE ${where.join(" AND ")}
    ORDER BY g.game_creation DESC
  `)
    .all(...params) as any[];

  interface ChampionTotals {
    games: number;
    wins: number;
    kills: number;
    deaths: number;
    assists: number;
  }

  const matches: any[] = [];
  const champions = new Map<number, ChampionTotals>();
  const player = {
    key,
    name: key,
    puuid: null as string | null,
    profileIcon: null as number | null,
    games: 0,
    wins: 0,
    kills: 0,
    deaths: 0,
    assists: 0,
    champions: [] as ({ champion_id: number } & ChampionTotals)[],
    lastPlayed: 0,
  };

  for (const row of rows) {
    let raw: any;
    try {
      raw = JSON.parse(row.raw_json);
    } catch {
      continue;
    }

    const teammates = collectTeammates(raw, puuids);
    if (!teammates) continue;
    // Older games can be missing puuids; once we know who we're looking at,
    // match those on name too — the same merge the Friends list does.
    const match = teammates.find(
      (t) =>
        teammateKey(t) === key || (player.games > 0 && t.puuid == null && t.name === player.name),
    );
    if (!match) continue;

    const p = match.participant;
    const s = p.stats || p;
    const participantId = p.participantId ?? 0;
    const friendScore = computeMatchScores(scoreInputsFromRaw(raw), getChampionClasses()).get(
      participantId,
    );

    // Rows are newest-first, so the first hit carries the current name and icon
    if (player.games === 0) {
      player.name = match.name;
      player.puuid = match.puuid;
      player.profileIcon = match.profileIcon;
      player.lastPlayed = row.game_creation;
    } else if (player.profileIcon == null) {
      player.profileIcon = match.profileIcon;
    }

    player.games++;
    if (s.win) player.wins++;
    player.kills += s.kills ?? 0;
    player.deaths += s.deaths ?? 0;
    player.assists += s.assists ?? 0;

    const champId = p.championId ?? s.championId ?? 0;
    if (!champions.has(champId)) {
      champions.set(champId, { games: 0, wins: 0, kills: 0, deaths: 0, assists: 0 });
    }
    const champ = champions.get(champId)!;
    champ.games++;
    if (s.win) champ.wins++;
    champ.kills += s.kills ?? 0;
    champ.deaths += s.deaths ?? 0;
    champ.assists += s.assists ?? 0;

    const maxStats = extractGameMaxStats(row.raw_json);
    const { raw_json: _raw_json, ...rest } = row;
    matches.push({
      ...rest,
      ...maxStats,
      friend: {
        champion_id: champId,
        win: s.win ? 1 : 0,
        kills: s.kills ?? 0,
        deaths: s.deaths ?? 0,
        assists: s.assists ?? 0,
        total_damage_dealt: s.totalDamageDealtToChampions ?? s.totalDamageDealt ?? 0,
        total_damage_taken: s.totalDamageTaken ?? 0,
        total_heal: s.totalHeal ?? 0,
        score: friendScore?.score ?? null,
        score_badge: friendScore?.badge ?? null,
      },
    });
  }

  if (player.games === 0) return null;

  player.champions = Array.from(champions.entries())
    .map(([champion_id, totals]) => ({ champion_id, ...totals }))
    .sort((a, b) => b.games - a.games);

  return { player, matches };
}

export function getChampionItemStats(
  championId: number,
  patch?: string,
  queue?: number,
): { item_id: number; picks: number; wins: number }[] {
  const extraWhere: string[] = [];
  const extraParams: any[] = [];
  if (patch) {
    extraWhere.push("g.game_version = ?");
    extraParams.push(patch);
  }
  applyQueueFilter(extraWhere, extraParams, queue);
  const extraSql = extraWhere.length > 0 ? ` AND ${extraWhere.join(" AND ")}` : "";
  const itemCols = ["item0", "item1", "item2", "item3", "item4", "item5", "item6"];
  const excludedList = EXCLUDED_ITEM_IDS.join(", ");
  const subquery = (col: string) =>
    `SELECT ps.${col} as item_id, ps.win FROM player_stats ps JOIN games g ON ps.game_id = g.game_id WHERE ps.champion_id = ? AND ps.${col} IS NOT NULL AND ps.${col} > 0 AND ps.${col} NOT IN (${excludedList}) AND g.is_remake = 0${extraSql}`;
  const params = itemCols.flatMap(() => [championId, ...extraParams]);
  return db
    .prepare(`
    SELECT item_id, COUNT(*) as picks, SUM(win) as wins
    FROM (
      ${itemCols.map(subquery).join("\n      UNION ALL\n      ")}
    )
    GROUP BY item_id
    ORDER BY picks DESC
  `)
    .all(...params) as any[];
}

export function getGlobalStats(
  patch?: string,
  queue?: number,
): {
  champions: { champion_id: number; games: number; wins: number }[];
  augments: { augment_id: number; picks: number; wins: number }[];
  totalParticipantSlots: number;
} {
  const where = ["g.raw_json IS NOT NULL", "g.is_remake = 0"];
  const params: any[] = [];
  if (patch) {
    where.push("g.game_version = ?");
    params.push(patch);
  }
  applyQueueFilter(where, params, queue);
  const games = db
    .prepare(`SELECT g.raw_json FROM games g WHERE ${where.join(" AND ")}`)
    .all(...params) as any[];

  const championMap = new Map<number, { games: number; wins: number }>();
  const augmentMap = new Map<number, { picks: number; wins: number }>();
  let totalParticipantSlots = 0;

  for (const game of games) {
    let raw: any;
    try {
      raw = JSON.parse(game.raw_json);
    } catch {
      continue;
    }

    const participants = raw.participants || [];

    for (const p of participants) {
      const s = p.stats || p;
      const champId = p.championId ?? s.championId ?? 0;
      const win = !!s.win;

      if (champId <= 0) continue;
      totalParticipantSlots++;

      if (!championMap.has(champId)) {
        championMap.set(champId, { games: 0, wins: 0 });
      }
      const champ = championMap.get(champId)!;
      champ.games++;
      if (win) champ.wins++;

      for (let i = 1; i <= AUGMENT_SLOTS; i++) {
        const augId = s[`playerAugment${i}`];
        if (augId && augId > 0) {
          if (!augmentMap.has(augId)) {
            augmentMap.set(augId, { picks: 0, wins: 0 });
          }
          const aug = augmentMap.get(augId)!;
          aug.picks++;
          if (win) aug.wins++;
        }
      }
    }
  }

  return {
    champions: Array.from(championMap.entries())
      .map(([champion_id, stats]) => ({ champion_id, ...stats }))
      .sort((a, b) => b.games - a.games),
    augments: Array.from(augmentMap.entries())
      .map(([augment_id, stats]) => ({ augment_id, ...stats }))
      .sort((a, b) => b.picks - a.picks),
    totalParticipantSlots,
  };
}

// Everything we know about one champion across every stored game, counting all
// ten players in each game (not just our own). Items and augments come from
// raw_json for the same reason — the player_stats/game_augments tables only
// hold our own picks.
export function getGlobalChampionDetail(
  championId: number,
  patch?: string,
  queue?: number,
): {
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
  damageShare: number;
  killParticipation: number;
  doubleKills: number;
  tripleKills: number;
  quadraKills: number;
  pentaKills: number;
  totalParticipantSlots: number;
  items: { item_id: number; picks: number; wins: number }[];
  augments: { augment_id: number; picks: number; wins: number }[];
} {
  const where = ["g.raw_json IS NOT NULL", "g.is_remake = 0"];
  const params: any[] = [];
  if (patch) {
    where.push("g.game_version = ?");
    params.push(patch);
  }
  applyQueueFilter(where, params, queue);
  const rows = db
    .prepare(`SELECT g.raw_json FROM games g WHERE ${where.join(" AND ")}`)
    .all(...params) as { raw_json: string }[];

  const itemMap = new Map<number, { picks: number; wins: number }>();
  const augmentMap = new Map<number, { picks: number; wins: number }>();
  const totals = {
    games: 0,
    wins: 0,
    kills: 0,
    deaths: 0,
    assists: 0,
    damage: 0,
    damageTaken: 0,
    gold: 0,
    heal: 0,
    doubleKills: 0,
    tripleKills: 0,
    quadraKills: 0,
    pentaKills: 0,
  };
  let totalParticipantSlots = 0;
  // Shares are per-game ratios averaged over the games they're defined in, so
  // a game with no team damage/kills recorded can't drag the average to zero.
  let damageShareSum = 0;
  let damageShareGames = 0;
  let kpSum = 0;
  let kpGames = 0;

  for (const row of rows) {
    let raw: any;
    try {
      raw = JSON.parse(row.raw_json);
    } catch {
      continue;
    }

    const parsed = (raw.participants || [])
      .map((p: any) => {
        const s = p.stats || p;
        return {
          championId: p.championId ?? s.championId ?? 0,
          teamId: p.teamId ?? s.teamId ?? 100,
          s,
        };
      })
      .filter((p: any) => p.championId > 0);

    const teamDamage = new Map<number, number>();
    const teamKills = new Map<number, number>();
    for (const p of parsed) {
      totalParticipantSlots++;
      const dmg = p.s.totalDamageDealtToChampions ?? p.s.totalDamageDealt ?? 0;
      teamDamage.set(p.teamId, (teamDamage.get(p.teamId) ?? 0) + dmg);
      teamKills.set(p.teamId, (teamKills.get(p.teamId) ?? 0) + (p.s.kills ?? 0));
    }

    for (const p of parsed) {
      if (p.championId !== championId) continue;
      const s = p.s;
      const win = !!s.win;
      const dmg = s.totalDamageDealtToChampions ?? s.totalDamageDealt ?? 0;

      totals.games++;
      if (win) totals.wins++;
      totals.kills += s.kills ?? 0;
      totals.deaths += s.deaths ?? 0;
      totals.assists += s.assists ?? 0;
      totals.damage += dmg;
      totals.damageTaken += s.totalDamageTaken ?? 0;
      totals.gold += s.goldEarned ?? 0;
      totals.heal += s.totalHeal ?? 0;
      totals.doubleKills += s.doubleKills ?? 0;
      totals.tripleKills += s.tripleKills ?? 0;
      totals.quadraKills += s.quadraKills ?? 0;
      totals.pentaKills += s.pentaKills ?? 0;

      const teamDmg = teamDamage.get(p.teamId) ?? 0;
      if (teamDmg > 0) {
        damageShareSum += dmg / teamDmg;
        damageShareGames++;
      }
      const tk = teamKills.get(p.teamId) ?? 0;
      if (tk > 0) {
        kpSum += ((s.kills ?? 0) + (s.assists ?? 0)) / tk;
        kpGames++;
      }

      for (let i = 0; i <= 6; i++) {
        const itemId = s[`item${i}`];
        if (itemId && itemId > 0 && !EXCLUDED_ITEM_IDS.includes(itemId)) {
          if (!itemMap.has(itemId)) itemMap.set(itemId, { picks: 0, wins: 0 });
          const item = itemMap.get(itemId)!;
          item.picks++;
          if (win) item.wins++;
        }
      }

      for (let i = 1; i <= AUGMENT_SLOTS; i++) {
        const augId = s[`playerAugment${i}`];
        if (augId && augId > 0) {
          if (!augmentMap.has(augId)) augmentMap.set(augId, { picks: 0, wins: 0 });
          const aug = augmentMap.get(augId)!;
          aug.picks++;
          if (win) aug.wins++;
        }
      }
    }
  }

  const avg = (total: number) => (totals.games > 0 ? Math.round(total / totals.games) : 0);

  return {
    champion_id: championId,
    games: totals.games,
    wins: totals.wins,
    kills: totals.kills,
    deaths: totals.deaths,
    assists: totals.assists,
    avgDamage: avg(totals.damage),
    avgDamageTaken: avg(totals.damageTaken),
    avgGold: avg(totals.gold),
    avgHeal: avg(totals.heal),
    damageShare: damageShareGames > 0 ? damageShareSum / damageShareGames : 0,
    killParticipation: kpGames > 0 ? kpSum / kpGames : 0,
    doubleKills: totals.doubleKills,
    tripleKills: totals.tripleKills,
    quadraKills: totals.quadraKills,
    pentaKills: totals.pentaKills,
    totalParticipantSlots,
    items: Array.from(itemMap.entries())
      .map(([item_id, stats]) => ({ item_id, ...stats }))
      .sort((a, b) => b.picks - a.picks),
    augments: Array.from(augmentMap.entries())
      .map(([augment_id, stats]) => ({ augment_id, ...stats }))
      .sort((a, b) => b.picks - a.picks),
  };
}

export function getDatabase(): Database.Database {
  return db;
}

// ---- Settings ----

export function getSetting(key: string): string | null {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? null;
}

export function setSetting(key: string, value: string): void {
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run(key, value);
}

// ---- Export / Import ----

// Games are read a page at a time and written straight to disk, rather than
// building the whole backup in memory and handing one huge string to
// writeFileSync. Two reasons: a library of a few thousand games is a hundred
// megabytes-plus of JSON to hold twice over, and every await here returns the
// main process to the event loop, so exporting no longer freezes the window.
const EXPORT_PAGE_SIZE = 200;

export async function writeExportTo(filePath: string): Promise<number> {
  const out = fs.createWriteStream(filePath, { encoding: "utf8" });
  const write = (chunk: string) =>
    new Promise<void>((resolve, reject) => {
      out.write(chunk, (err) => (err ? reject(err) : resolve()));
    });

  let count = 0;
  try {
    const summoners = db.prepare("SELECT * FROM summoner").all();
    await write(`{"version":3,"summoners":${JSON.stringify(summoners)},"games":[`);

    // Keyset paging, not LIMIT/OFFSET: each query completes before the next
    // await, so no statement is left open across one — a statement still
    // running when a poll tries to insert a game would fail as busy. Paging by
    // last id also stays correct if rows arrive mid-export.
    const page = db.prepare(`
      SELECT game_id, raw_json, puuid
      FROM games
      WHERE raw_json IS NOT NULL AND game_id > ?
      ORDER BY game_id
      LIMIT ?
    `);

    let lastId = 0;
    for (;;) {
      const rows = page.all(lastId, EXPORT_PAGE_SIZE) as {
        game_id: number;
        raw_json: string;
        puuid: string;
      }[];
      if (rows.length === 0) break;

      let chunk = "";
      for (const row of rows) {
        const game = JSON.parse(row.raw_json);
        game._ownerPuuid = row.puuid;
        chunk += (count === 0 ? "" : ",") + JSON.stringify(game);
        count++;
      }
      lastId = rows[rows.length - 1].game_id;
      await write(chunk);
    }

    await write("]}");
  } finally {
    await new Promise<void>((resolve, reject) => {
      out.on("error", reject);
      out.end(() => resolve());
    });
  }
  return count;
}

export function importData(data: any): number {
  if (data.version >= 3) {
    for (const s of data.summoners ?? []) {
      upsertSummoner(s);
    }
    let imported = 0;
    for (const game of data.games ?? []) {
      const puuid = game._ownerPuuid || data.summoners?.[0]?.puuid;
      if (!puuid) continue;
      if (insertGameFull(game, puuid)) imported++;
    }
    return imported;
  }
  // v2 fallback: single summoner
  const puuid = data.summoner?.puuid;
  if (!puuid) return 0;
  upsertSummoner(data.summoner);
  let imported = 0;
  for (const game of data.games ?? []) {
    if (insertGameFull(game, puuid)) imported++;
  }
  return imported;
}

// ---- Repair ----

// Rebuild everything derived from raw_json for each game's current owner:
// player_stats (champion, KDA, items), augments, the remake flag, and the
// score under the current formula. Heals games whose owner puuid changed
// during repair (their stored stats still described the old participant) and
// doubles as a manual "rescore now" for formula changes.
function rebuildDerivedStats(): number {
  const rows = db
    .prepare(`
      SELECT g.game_id, g.puuid, g.game_duration, g.raw_json,
             ps.champion_id, ps.kills, ps.deaths, ps.assists
      FROM games g
      LEFT JOIN player_stats ps ON g.game_id = ps.game_id
      WHERE g.raw_json IS NOT NULL
    `)
    .all() as {
    game_id: number;
    puuid: string;
    game_duration: number;
    raw_json: string;
    champion_id: number | null;
    kills: number | null;
    deaths: number | null;
    assists: number | null;
  }[];

  const upsertStats = db.prepare(`
    INSERT OR REPLACE INTO player_stats (
      game_id, champion_id, win, kills, deaths, assists,
      double_kills, triple_kills, quadra_kills, penta_kills,
      total_damage_dealt, total_damage_taken, gold_earned, total_heal,
      largest_killing_spree, item0, item1, item2, item3, item4, item5, item6,
      score, score_badge
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const updateRemake = db.prepare("UPDATE games SET is_remake = ? WHERE game_id = ?");
  const deleteAugments = db.prepare("DELETE FROM game_augments WHERE game_id = ?");
  const insertAugment = db.prepare(
    "INSERT OR IGNORE INTO game_augments (game_id, slot, augment_id) VALUES (?, ?, ?)",
  );

  let rebuilt = 0;
  const tx = db.transaction(() => {
    for (const row of rows) {
      try {
        const raw = JSON.parse(row.raw_json);
        let participant = findParticipant(raw, row.puuid);
        // Owner puuid unknown (old imports): fall back to matching the stored
        // stats row, same as the puuid backfill migration.
        if (!participant && row.champion_id != null && raw.participants) {
          participant = raw.participants.find((p: any) => {
            const st = p.stats || p;
            return (
              (p.championId ?? st.championId) === row.champion_id &&
              (st.kills ?? 0) === row.kills &&
              (st.deaths ?? 0) === row.deaths &&
              (st.assists ?? 0) === row.assists
            );
          });
        }
        if (!participant) continue;
        const s = participant.stats || participant;

        const isRemake = detectRemake(row.game_duration, row.raw_json) ? 1 : 0;
        updateRemake.run(isRemake, row.game_id);

        let ownerScore: { score: number; badge: string | null } | null = null;
        if (!isRemake) {
          ownerScore = computeOwnerScore(raw, row.puuid || null, {
            champion_id: participant.championId ?? s.championId ?? 0,
            kills: s.kills ?? 0,
            deaths: s.deaths ?? 0,
            assists: s.assists ?? 0,
          });
        }

        upsertStats.run(
          row.game_id,
          participant.championId ?? s.championId ?? 0,
          s.win ? 1 : 0,
          s.kills ?? 0,
          s.deaths ?? 0,
          s.assists ?? 0,
          s.doubleKills ?? 0,
          s.tripleKills ?? 0,
          s.quadraKills ?? 0,
          s.pentaKills ?? 0,
          s.totalDamageDealtToChampions ?? s.totalDamageDealt ?? 0,
          s.totalDamageTaken ?? 0,
          s.goldEarned ?? 0,
          s.totalHeal ?? 0,
          s.largestKillingSpree ?? 0,
          s.item0 ?? null,
          s.item1 ?? null,
          s.item2 ?? null,
          s.item3 ?? null,
          s.item4 ?? null,
          s.item5 ?? null,
          s.item6 ?? null,
          ownerScore?.score ?? null,
          ownerScore?.badge ?? null,
        );

        deleteAugments.run(row.game_id);
        for (let i = 1; i <= AUGMENT_SLOTS; i++) {
          const augId = s[`playerAugment${i}`];
          if (augId && augId > 0) {
            insertAugment.run(row.game_id, i, augId);
          }
        }
        rebuilt++;
      } catch {
        /* ignore parse errors */
      }
    }
  });
  tx();

  // Stamp the startup-backfill keys — the rebuild just did their work
  setSetting("score_formula_version", scoreFormulaKey());
  setSetting("augment_slots", String(AUGMENT_SLOTS));
  return rebuilt;
}

export function repairPuuids(): {
  repairedGames: number;
  discoveredAccounts: number;
  rebuiltGames: number;
} {
  // Step 1: Parse all games and collect participant puuids per game
  const games = db
    .prepare("SELECT game_id, raw_json FROM games WHERE raw_json IS NOT NULL")
    .all() as { game_id: number; raw_json: string }[];

  const puuidToGames = new Map<string, Set<number>>();
  const gameToPuuids = new Map<number, Set<string>>();

  for (const game of games) {
    try {
      const raw = JSON.parse(game.raw_json);
      const participants = raw.participants || [];
      const identities = raw.participantIdentities || [];
      const puuidsInGame = new Set<string>();

      for (let i = 0; i < participants.length; i++) {
        const p = participants[i];
        const identity = identities[i];
        const pPuuid = p.puuid || identity?.player?.puuid;
        if (pPuuid && !/^0+(-0+)*$/.test(pPuuid)) {
          puuidsInGame.add(pPuuid);
          if (!puuidToGames.has(pPuuid)) {
            puuidToGames.set(pPuuid, new Set());
          }
          puuidToGames.get(pPuuid)!.add(game.game_id);
        }
      }

      gameToPuuids.set(game.game_id, puuidsInGame);
    } catch {
      continue;
    }
  }

  // Step 2: Sort puuids by frequency (most games first)
  const sortedPuuids = Array.from(puuidToGames.entries()).sort((a, b) => b[1].size - a[1].size);

  // Step 3: Greedily identify user accounts — a puuid is a user account if it
  // never co-occurs in the same game as an already-identified user account.
  // This filters out friends (who always appear alongside a user account)
  // while correctly identifying alt accounts (which never share a game).
  const userPuuids = new Set<string>();

  for (const [puuid, gameIds] of sortedPuuids) {
    let coOccurs = false;
    for (const gameId of gameIds) {
      const puuidsInGame = gameToPuuids.get(gameId)!;
      for (const userPuuid of userPuuids) {
        if (puuidsInGame.has(userPuuid)) {
          coOccurs = true;
          break;
        }
      }
      if (coOccurs) break;
    }

    if (!coOccurs) {
      userPuuids.add(puuid);
    }
  }

  // Step 4: For each game, find which user account is present and update puuid
  const updateStmt = db.prepare("UPDATE games SET puuid = ? WHERE game_id = ?");
  let repairedGames = 0;

  for (const game of games) {
    try {
      const raw = JSON.parse(game.raw_json);
      const participants = raw.participants || [];
      const identities = raw.participantIdentities || [];

      for (let i = 0; i < participants.length; i++) {
        const p = participants[i];
        const identity = identities[i];
        const pPuuid = p.puuid || identity?.player?.puuid;
        if (pPuuid && userPuuids.has(pPuuid)) {
          updateStmt.run(pPuuid, game.game_id);
          repairedGames++;
          break;
        }
      }
    } catch {
      continue;
    }
  }

  // Step 5: Upsert discovered summoners using the most recent name from raw_json
  const upsertStmt = db.prepare(`
    INSERT OR IGNORE INTO summoner (puuid, game_name, tag_line, summoner_id, account_id, updated_at)
    VALUES (?, ?, ?, NULL, NULL, ?)
  `);

  for (const puuid of userPuuids) {
    const gameIds = puuidToGames.get(puuid)!;
    let latestName: string | null = null;
    let latestTagLine: string | null = null;
    let latestCreation = 0;

    for (const game of games) {
      if (!gameIds.has(game.game_id)) continue;
      try {
        const raw = JSON.parse(game.raw_json);
        const creation = raw.gameCreation || 0;
        if (creation <= latestCreation) continue;

        const participants = raw.participants || [];
        const identities = raw.participantIdentities || [];
        for (let i = 0; i < participants.length; i++) {
          const p = participants[i];
          const identity = identities[i];
          const pPuuid = p.puuid || identity?.player?.puuid;
          if (pPuuid === puuid) {
            const name =
              identity?.player?.gameName ||
              identity?.player?.summonerName ||
              p.summonerName ||
              p.riotIdGameName ||
              null;
            if (name) {
              latestName = name;
              latestTagLine = identity?.player?.tagLine || p.riotIdTagline || null;
              latestCreation = creation;
            }
            break;
          }
        }
      } catch {
        continue;
      }
    }

    upsertStmt.run(puuid, latestName, latestTagLine, Date.now());
  }

  // Step 6: Rebuild stats, augments, remake flags, and scores from raw_json
  // now that game ownership is settled.
  const rebuiltGames = rebuildDerivedStats();

  return { repairedGames, discoveredAccounts: userPuuids.size, rebuiltGames };
}
