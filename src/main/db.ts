import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import zlib from "zlib";
import {
  SCORE_FORMULA_VERSION,
  computeMatchScores,
  type PlayerScore,
  type ScoreInput,
} from "../shared/opScore";
import { AUGMENT_SLOTS, QUEUE_ID_MAYHEM_CLASSIC } from "../shared/queues";
import { mapNameForSkin } from "../shared/maps";
import { ARAM_S_GRADE_CHALLENGE_ID } from "../shared/challenges";
import {
  DAY_START_HOUR,
  SESSION_GROUPING_SETTING,
  parseSessionGrouping,
  sessionDay,
  type SessionGrouping,
} from "../shared/session";
import { ordinal } from "../shared/text";
import { getDataDir } from "./paths";
import { getChampionClasses, getChampionDataVersion } from "./dragon";
import type {
  PlayerRecord,
  RecapChallenge,
  RecapMilestone,
  RecapPlacement,
  RecapSessionGame,
  RecapStreak,
} from "../shared/api";

// Poro-Snax (base and upgraded) is handed out for free, so it skews item stats
const EXCLUDED_ITEM_IDS = [2052, 220013];
const EXCLUDED_ITEMS_SQL = EXCLUDED_ITEM_IDS.join(", ");

// item0..item6 on both player_stats and match_participants; slot 6 is the trinket
const ITEM_SLOTS = [0, 1, 2, 3, 4, 5, 6];

let db: Database.Database;

export function getDbPath() {
  return path.join(getDataDir(), "matches.db");
}

export function initDatabase() {
  const dbPath = getDbPath();
  db = new Database(dbPath);
  // Prepared statements belong to the connection that made them, so the cache
  // can't outlive it.
  writeParticipantsStmts = null;
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

  // Backfill bonus augment slots (5+) for games stored when only 4 slots
  // were captured.
  if (getSetting("augment_slots") !== String(AUGMENT_SLOTS)) {
    backfillAugmentSlots();
    setSetting("augment_slots", String(AUGMENT_SLOTS));
  }

  migrateHiddenQueues();
}

// The old hide-Mayhem-Classic switch became a per-queue list. Carry the boolean
// over once; writing the key even when nothing was hidden is what keeps this
// from firing again after the user switches every queue back on.
function migrateHiddenQueues() {
  if (getSetting("hidden_queues") !== null) return;
  const hidClassic = getSetting("hide_classic_games") === "true";
  setSetting("hidden_queues", hidClassic ? String(QUEUE_ID_MAYHEM_CLASSIC) : "");
}

// Checkpoints the WAL and releases the file. Without this a quit leaves the
// -wal alongside the database to be replayed on next launch.
export function closeDatabase() {
  if (!db || !db.open) return;
  writeParticipantsStmts = null;
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
      -- The match exactly as the client handed it to us, gzipped. Nothing on a
      -- query path reads it: match_participants below answers every question
      -- the UI asks. It stays because it's the only copy of the fields we
      -- haven't normalized, and the client's history is too short to refetch
      -- from — see unpackRaw.
      raw_gz        BLOB
    );

    -- Every player in every game, which is what separates this from
    -- player_stats (only ever our own row). Stats over all ten players are
    -- ordinary aggregates against this table.
    CREATE TABLE IF NOT EXISTS match_participants (
      game_id        INTEGER NOT NULL REFERENCES games(game_id),
      participant_id INTEGER NOT NULL,
      puuid          TEXT,
      game_name      TEXT,
      tag_line       TEXT,
      profile_icon   INTEGER,
      team_id        INTEGER NOT NULL DEFAULT 100,
      champion_id    INTEGER NOT NULL DEFAULT 0,
      win            INTEGER NOT NULL DEFAULT 0,
      kills          INTEGER NOT NULL DEFAULT 0,
      deaths         INTEGER NOT NULL DEFAULT 0,
      assists        INTEGER NOT NULL DEFAULT 0,
      double_kills   INTEGER NOT NULL DEFAULT 0,
      triple_kills   INTEGER NOT NULL DEFAULT 0,
      quadra_kills   INTEGER NOT NULL DEFAULT 0,
      penta_kills    INTEGER NOT NULL DEFAULT 0,
      total_damage_dealt INTEGER NOT NULL DEFAULT 0,
      total_damage_taken INTEGER NOT NULL DEFAULT 0,
      gold_earned    INTEGER NOT NULL DEFAULT 0,
      total_heal     INTEGER NOT NULL DEFAULT 0,
      largest_killing_spree INTEGER NOT NULL DEFAULT 0,
      early_surrender INTEGER NOT NULL DEFAULT 0,
      -- Copied down from games so an aggregate over every participant never
      -- has to join back. Kept honest by trg_games_denorm_*, since these are
      -- the only three game columns a stats query filters on.
      is_remake      INTEGER NOT NULL DEFAULT 0,
      queue_id       INTEGER,
      game_version   TEXT,
      spell1 INTEGER, spell2 INTEGER,
      item0 INTEGER, item1 INTEGER, item2 INTEGER,
      item3 INTEGER, item4 INTEGER, item5 INTEGER, item6 INTEGER,
      PRIMARY KEY (game_id, participant_id)
    );

    -- One row per augment taken by anyone, against game_augments' one row per
    -- augment WE took. champion_id/win/is_remake are denormalized so the
    -- augment leaderboards are a single grouped index scan.
    CREATE TABLE IF NOT EXISTS match_participant_augments (
      game_id        INTEGER NOT NULL,
      participant_id INTEGER NOT NULL,
      slot           INTEGER NOT NULL,
      augment_id     INTEGER NOT NULL,
      champion_id    INTEGER NOT NULL DEFAULT 0,
      win            INTEGER NOT NULL DEFAULT 0,
      is_remake      INTEGER NOT NULL DEFAULT 0,
      queue_id       INTEGER,
      game_version   TEXT,
      PRIMARY KEY (game_id, participant_id, slot)
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
      -- Unclamped score, ordering key only — see PlayerScore.raw
      score_raw            REAL,
      score_badge          TEXT,
      spell1 INTEGER, spell2 INTEGER,
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

    -- Which of the three ARAM maps a game was rolled onto. Only the running
    -- game knows this, so rows land here while the Live Game tab is watching
    -- and never for a game imported after the fact. Deliberately outside the
    -- export: it is opportunistic, and a backup that restores without it is
    -- missing nothing a stat depends on.
    CREATE TABLE IF NOT EXISTS match_maps (
      game_id  INTEGER PRIMARY KEY,
      map_id   INTEGER,
      map_skin TEXT NOT NULL
    );

    -- The last challenge payload the client answered with, so the tab has
    -- something to draw when the client isn't running. One row, always id 1.
    -- Stored as JSON rather than columns because it's Riot's shape, not ours,
    -- and nothing here queries into it.
    CREATE TABLE IF NOT EXISTS challenge_state (
      id         INTEGER PRIMARY KEY CHECK (id = 1),
      payload    TEXT NOT NULL,
      fetched_at INTEGER NOT NULL
    );

    -- One value per challenge per day. The client only ever reports where a
    -- challenge stands right now, so this is the only place a "+312 this week"
    -- can come from, and the one thing the tab can show that the client
    -- itself can't. Outside the export for the same reason match_maps is: it
    -- rebuilds itself from the client, and no stat depends on it.
    CREATE TABLE IF NOT EXISTS challenge_history (
      day          TEXT NOT NULL,
      challenge_id INTEGER NOT NULL,
      value        REAL NOT NULL,
      level        TEXT NOT NULL,
      PRIMARY KEY (day, challenge_id)
    );

    -- What one game moved, captured from the client's post-game answer. That
    -- answer covers the most recent game only, so a row not written while the
    -- game was still current can never be recovered. The name and art ride
    -- along with the numbers because the client is the only place they live,
    -- and a recap has to draw months later with it closed. Outside the export
    -- like the other two: opportunistic, and no stat depends on it.
    CREATE TABLE IF NOT EXISTS challenge_game_progress (
      game_id        INTEGER NOT NULL,
      challenge_id   INTEGER NOT NULL,
      name           TEXT NOT NULL,
      description    TEXT NOT NULL,
      previous_value REAL NOT NULL,
      current_value  REAL NOT NULL,
      previous_level TEXT NOT NULL,
      current_level  TEXT NOT NULL,
      next_level     TEXT,
      next_threshold REAL,
      icon_path      TEXT NOT NULL,
      PRIMARY KEY (game_id, challenge_id)
    );
  `);
}

// Split out from createTables because an index over a migrated-in column can
// only be built after runMigrations has actually added it. The triggers belong
// here too: a trigger body naming a column blocks ALTER TABLE ... DROP COLUMN
// on that table, and migrateToV2 drops games.raw_json.
function createIndexes() {
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_games_creation ON games(game_creation DESC);
    CREATE INDEX IF NOT EXISTS idx_games_puuid ON games(puuid);
    CREATE INDEX IF NOT EXISTS idx_games_version ON games(game_version);
    CREATE INDEX IF NOT EXISTS idx_games_queue ON games(queue_id);
    CREATE INDEX IF NOT EXISTS idx_player_stats_champion ON player_stats(champion_id);
    CREATE INDEX IF NOT EXISTS idx_game_augments_augment ON game_augments(augment_id);

    -- champion_id first because every global aggregate either groups by it or
    -- filters on it; is_remake and win ride along so the common counts are
    -- answered from the index alone.
    CREATE INDEX IF NOT EXISTS idx_mp_champion
      ON match_participants(champion_id, is_remake, win);
    CREATE INDEX IF NOT EXISTS idx_mp_puuid ON match_participants(puuid);
    -- The teammate self-join matches a game's two teams against each other.
    CREATE INDEX IF NOT EXISTS idx_mp_game_team ON match_participants(game_id, team_id);
    CREATE INDEX IF NOT EXISTS idx_mpa_augment
      ON match_participant_augments(augment_id, is_remake, win, champion_id);
  `);

  // is_remake, queue_id and game_version live on games but are copied onto
  // every participant row. Syncing them here rather than at each call site
  // means a future writer of those columns can't silently desync the copies.
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS trg_games_denorm_participants
    AFTER UPDATE OF is_remake, queue_id, game_version ON games
    BEGIN
      UPDATE match_participants
         SET is_remake = NEW.is_remake, queue_id = NEW.queue_id, game_version = NEW.game_version
       WHERE game_id = NEW.game_id;
      UPDATE match_participant_augments
         SET is_remake = NEW.is_remake, queue_id = NEW.queue_id, game_version = NEW.game_version
       WHERE game_id = NEW.game_id;
    END;
  `);
}

// ---- Raw match payloads ----
//
// A match is ~30 KB of JSON and gzips to about an eighth of that, which is the
// difference between the blobs being most of the database and being a rounding
// error. Nothing reads them to answer a query — only export, and the one-time
// normalization in migrateToV2.

function packRaw(raw: any): Buffer {
  return zlib.gzipSync(JSON.stringify(raw));
}

function unpackRaw(blob: Buffer | null): any {
  if (!blob) return null;
  try {
    return JSON.parse(zlib.gunzipSync(blob).toString("utf8"));
  } catch {
    return null;
  }
}

// ---- Participant extraction ----

// Riot hands us two shapes: the LCU's participants[i] + participantIdentities[i]
// pair, and SGP's flattened participant with its stats inline. Both are
// unpicked exactly once, here, on the way into match_participants — so no read
// path has to know the difference.
interface RawParticipantRow {
  participant_id: number;
  puuid: string | null;
  game_name: string | null;
  tag_line: string | null;
  profile_icon: number | null;
  team_id: number;
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
  early_surrender: number;
  spell1: number | null;
  spell2: number | null;
  items: (number | null)[];
  augments: { slot: number; augment_id: number }[];
}

// Bots and unresolved players carry an all-zeroes puuid. Dropping it here means
// every read path can treat "has a puuid" as "is a real, identifiable player".
function realPuuid(value: unknown): string | null {
  if (typeof value !== "string" || value === "") return null;
  return /^0+(-0+)*$/.test(value) ? null : value;
}

// "Name#TAG" where we have both halves, the bare name where we don't.
function displayName(gameName: string | null, tagLine: string | null): string | null {
  if (!gameName) return null;
  return tagLine ? `${gameName}#${tagLine}` : gameName;
}

function participantRowsFromRaw(raw: any): RawParticipantRow[] {
  const participants = raw?.participants;
  if (!Array.isArray(participants)) return [];
  const identities = raw.participantIdentities || [];

  return participants.map((p: any, i: number): RawParticipantRow => {
    const s = p.stats || p;
    const player = identities[i]?.player || {};
    const augments: { slot: number; augment_id: number }[] = [];
    for (let slot = 1; slot <= AUGMENT_SLOTS; slot++) {
      const augId = s[`playerAugment${slot}`];
      if (augId && augId > 0) augments.push({ slot, augment_id: augId });
    }
    const icon = player.profileIcon;

    return {
      participant_id: p.participantId ?? i + 1,
      puuid: realPuuid(p.puuid) ?? realPuuid(player.puuid),
      game_name:
        player.gameName || player.summonerName || p.summonerName || p.riotIdGameName || null,
      tag_line: player.tagLine || p.riotIdTagline || null,
      profile_icon: typeof icon === "number" && icon > 0 ? icon : null,
      team_id: p.teamId ?? s.teamId ?? 100,
      champion_id: p.championId ?? s.championId ?? 0,
      win: s.win ? 1 : 0,
      kills: s.kills ?? 0,
      deaths: s.deaths ?? 0,
      assists: s.assists ?? 0,
      double_kills: s.doubleKills ?? 0,
      triple_kills: s.tripleKills ?? 0,
      quadra_kills: s.quadraKills ?? 0,
      penta_kills: s.pentaKills ?? 0,
      total_damage_dealt: s.totalDamageDealtToChampions ?? s.totalDamageDealt ?? 0,
      total_damage_taken: s.totalDamageTaken ?? 0,
      gold_earned: s.goldEarned ?? 0,
      total_heal: s.totalHeal ?? 0,
      largest_killing_spree: s.largestKillingSpree ?? 0,
      early_surrender: s.gameEndedInEarlySurrender ? 1 : 0,
      spell1: p.spell1Id ?? s.spell1Id ?? null,
      spell2: p.spell2Id ?? s.spell2Id ?? null,
      items: [s.item0, s.item1, s.item2, s.item3, s.item4, s.item5, s.item6].map((it) =>
        typeof it === "number" ? it : null,
      ),
      augments,
    };
  });
}

interface GameDenorm {
  is_remake: number;
  queue_id: number | null;
  game_version: string | null;
}

let writeParticipantsStmts: {
  participant: Database.Statement;
  augment: Database.Statement;
  clearParticipants: Database.Statement;
  clearAugments: Database.Statement;
} | null = null;

function participantStatements() {
  if (!writeParticipantsStmts) {
    writeParticipantsStmts = {
      participant: db.prepare(`
        INSERT OR REPLACE INTO match_participants (
          game_id, participant_id, puuid, game_name, tag_line, profile_icon,
          team_id, champion_id, win, kills, deaths, assists,
          double_kills, triple_kills, quadra_kills, penta_kills,
          total_damage_dealt, total_damage_taken, gold_earned, total_heal,
          largest_killing_spree, early_surrender, is_remake, queue_id, game_version,
          spell1, spell2, item0, item1, item2, item3, item4, item5, item6
        ) VALUES (
          @game_id, @participant_id, @puuid, @game_name, @tag_line, @profile_icon,
          @team_id, @champion_id, @win, @kills, @deaths, @assists,
          @double_kills, @triple_kills, @quadra_kills, @penta_kills,
          @total_damage_dealt, @total_damage_taken, @gold_earned, @total_heal,
          @largest_killing_spree, @early_surrender, @is_remake, @queue_id, @game_version,
          @spell1, @spell2, @item0, @item1, @item2, @item3, @item4, @item5, @item6
        )
      `),
      augment: db.prepare(`
        INSERT OR REPLACE INTO match_participant_augments (
          game_id, participant_id, slot, augment_id,
          champion_id, win, is_remake, queue_id, game_version
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `),
      clearParticipants: db.prepare("DELETE FROM match_participants WHERE game_id = ?"),
      clearAugments: db.prepare("DELETE FROM match_participant_augments WHERE game_id = ?"),
    };
  }
  return writeParticipantsStmts;
}

// Replaces one game's participant rows wholesale. Callers are already inside a
// transaction; this deliberately isn't one, so a game and its participants
// commit together or not at all.
function writeParticipants(gameId: number, meta: GameDenorm, rows: RawParticipantRow[]): void {
  const stmts = participantStatements();
  stmts.clearParticipants.run(gameId);
  stmts.clearAugments.run(gameId);

  for (const row of rows) {
    stmts.participant.run({
      game_id: gameId,
      participant_id: row.participant_id,
      puuid: row.puuid,
      game_name: row.game_name,
      tag_line: row.tag_line,
      profile_icon: row.profile_icon,
      team_id: row.team_id,
      champion_id: row.champion_id,
      win: row.win,
      kills: row.kills,
      deaths: row.deaths,
      assists: row.assists,
      double_kills: row.double_kills,
      triple_kills: row.triple_kills,
      quadra_kills: row.quadra_kills,
      penta_kills: row.penta_kills,
      total_damage_dealt: row.total_damage_dealt,
      total_damage_taken: row.total_damage_taken,
      gold_earned: row.gold_earned,
      total_heal: row.total_heal,
      largest_killing_spree: row.largest_killing_spree,
      early_surrender: row.early_surrender,
      is_remake: meta.is_remake,
      queue_id: meta.queue_id,
      game_version: meta.game_version,
      spell1: row.spell1,
      spell2: row.spell2,
      item0: row.items[0],
      item1: row.items[1],
      item2: row.items[2],
      item3: row.items[3],
      item4: row.items[4],
      item5: row.items[5],
      item6: row.items[6],
    });

    for (const aug of row.augments) {
      stmts.augment.run(
        gameId,
        row.participant_id,
        aug.slot,
        aug.augment_id,
        row.champion_id,
        row.win,
        meta.is_remake,
        meta.queue_id,
        meta.game_version,
      );
    }
  }
}

// ---- Migrations ----
//
// Stamped in PRAGMA user_version. Version 0 means the database predates
// versioning, so it could be missing any subset of the columns v1 adds — which
// is why each step checks for its column rather than assuming. A database that
// createTables just built is also version 0, and lands on the same no-op path.
const SCHEMA_VERSION = 4;

function tableColumns(table: string): Set<string> {
  const rows = db.pragma(`table_info(${table})`) as { name: string }[];
  return new Set(rows.map((r) => r.name));
}

function runMigrations() {
  const current = db.pragma("user_version", { simple: true }) as number;
  if (current >= SCHEMA_VERSION) return;

  if (current < 1) migrateToV1();
  if (current < 2) migrateToV2();
  if (current < 3) migrateToV3();
  if (current < 4) migrateToV4();

  db.pragma(`user_version = ${SCHEMA_VERSION}`);
}

// Brings pre-versioning databases up to the schema createTables now declares.
// Each column is added only if absent, so this is a no-op on a database that
// already has the column, however it got there.
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
// Payloads are read a page at a time wherever they're read in bulk: a library
// of a few thousand is a hundred megabytes-plus of JSON, far too much to hold
// in memory at once.
const PAYLOAD_PAGE_SIZE = 200;

interface NormalizeResult {
  /** Games that produced at least one participant row. */
  normalized: number;
  /** Games whose payload wouldn't parse, or carried no participants. */
  unusable: number;
}

// Re-derives match_participants and match_participant_augments for every game
// that still has its payload. This is the one place that turns a stored payload
// into rows, shared by the v2 migration and by Repair — so the two can't drift
// into disagreeing about what a participant row should contain.
function rebuildParticipantsFromPayloads(): NormalizeResult {
  const page = db.prepare(`
    SELECT game_id, is_remake, queue_id, game_version, raw_gz
    FROM games
    WHERE raw_gz IS NOT NULL AND game_id > ?
    ORDER BY game_id
    LIMIT ?
  `);

  let lastId = 0;
  const result: NormalizeResult = { normalized: 0, unusable: 0 };
  for (;;) {
    const rows = page.all(lastId, PAYLOAD_PAGE_SIZE) as {
      game_id: number;
      is_remake: number;
      queue_id: number | null;
      game_version: string | null;
      raw_gz: Buffer;
    }[];
    if (rows.length === 0) break;

    const tx = db.transaction(() => {
      for (const row of rows) {
        const participants = participantRowsFromRaw(unpackRaw(row.raw_gz));
        if (participants.length === 0) {
          result.unusable++;
          continue;
        }
        writeParticipants(
          row.game_id,
          {
            is_remake: row.is_remake,
            queue_id: row.queue_id,
            game_version: row.game_version,
          },
          participants,
        );
        result.normalized++;
      }
    });
    tx();

    lastId = rows[rows.length - 1].game_id;
  }

  return result;
}

// Compresses the raw payloads, normalizes them into match_participants, and
// then drops the raw_json column. This is the only chance to extract from the
// text column, so the rows are written and checked before it goes away.
function migrateToV2() {
  const games = tableColumns("games");
  // Nothing to carry over: either a database this version created, or one
  // already migrated whose user_version didn't stick.
  if (!games.has("raw_json")) return;

  if (!games.has("raw_gz")) {
    db.exec("ALTER TABLE games ADD COLUMN raw_gz BLOB");
  }

  // Pass one moves the payloads across as-is. The stored text is compressed
  // rather than reserialized, so a backup taken after this migration is byte
  // for byte the backup that would have been taken before it.
  const page = db.prepare(`
    SELECT game_id, raw_json
    FROM games
    WHERE raw_json IS NOT NULL AND raw_gz IS NULL AND game_id > ?
    ORDER BY game_id
    LIMIT ?
  `);
  const compress = db.prepare("UPDATE games SET raw_gz = ? WHERE game_id = ?");

  let lastId = 0;
  for (;;) {
    const rows = page.all(lastId, PAYLOAD_PAGE_SIZE) as {
      game_id: number;
      raw_json: string;
    }[];
    if (rows.length === 0) break;

    const tx = db.transaction(() => {
      for (const row of rows) compress.run(zlib.gzipSync(row.raw_json), row.game_id);
    });
    tx();

    lastId = rows[rows.length - 1].game_id;
  }

  // Pass two derives the rows every query now reads.
  const { normalized, unusable } = rebuildParticipantsFromPayloads();

  // Nothing below this line is reversible, so confirm the rows are actually on
  // disk first: every game holding a payload should have participants, bar the
  // ones this pass already reported it couldn't read.
  const stranded = db
    .prepare(`
      SELECT COUNT(*) AS count
      FROM games g
      WHERE g.raw_json IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM match_participants mp WHERE mp.game_id = g.game_id)
    `)
    .get() as { count: number };

  if (stranded.count > unusable) {
    console.error(
      `Skipping raw_json drop: ${stranded.count} games have no participant rows (expected at most ${unusable})`,
    );
    return;
  }

  db.exec("ALTER TABLE games DROP COLUMN raw_json");
  // The dropped column's pages are free but still in the file — for a typical
  // library that's most of it, so reclaim them now rather than leaving the
  // saving invisible.
  db.exec("VACUUM");
  console.log(
    `Normalized ${normalized} games into match_participants` +
      (unusable > 0 ? ` (${unusable} payloads unreadable)` : ""),
  );
}

// Adds the summoner spell columns and fills them from the stored payloads.
function migrateToV3() {
  for (const table of ["match_participants", "player_stats"]) {
    const cols = tableColumns(table);
    if (!cols.has("spell1")) db.exec(`ALTER TABLE ${table} ADD COLUMN spell1 INTEGER`);
    if (!cols.has("spell2")) db.exec(`ALTER TABLE ${table} ADD COLUMN spell2 INTEGER`);
  }
  // Re-deriving the participant rows wholesale is how spells reach
  // match_participants; the copy below then narrows them to the game's owner.
  rebuildParticipantsFromPayloads();
  backfillPlayerStatsSpells();
}

// Adds the unclamped score column. Nothing to backfill here: bumping
// SCORE_FORMULA_VERSION alongside it makes checkScoreBackfill rescore every
// game on the next launch, which is what fills it in.
function migrateToV4() {
  if (!tableColumns("player_stats").has("score_raw")) {
    db.exec("ALTER TABLE player_stats ADD COLUMN score_raw REAL");
  }
}

// Copies each game owner's spells from their participant row onto player_stats.
// Owner resolution mirrors rebuildDerivedStats: puuid first, then the stored
// stats line for old imports whose owner puuid was never recovered.
function backfillPlayerStatsSpells() {
  const games = db
    .prepare(`
      SELECT g.game_id, g.puuid, ps.champion_id, ps.kills, ps.deaths, ps.assists
      FROM games g
      JOIN player_stats ps ON g.game_id = ps.game_id
    `)
    .all() as {
    game_id: number;
    puuid: string;
    champion_id: number;
    kills: number;
    deaths: number;
    assists: number;
  }[];

  const participants = groupByGame(
    db
      .prepare(`
        SELECT game_id, puuid, champion_id, kills, deaths, assists, spell1, spell2
        FROM match_participants
      `)
      .all() as {
      game_id: number;
      puuid: string | null;
      champion_id: number;
      kills: number;
      deaths: number;
      assists: number;
      spell1: number | null;
      spell2: number | null;
    }[],
  );

  const updateStmt = db.prepare("UPDATE player_stats SET spell1 = ?, spell2 = ? WHERE game_id = ?");
  const tx = db.transaction(() => {
    for (const game of games) {
      const rows = participants.get(game.game_id) ?? [];
      let owner = game.puuid ? rows.find((p) => p.puuid === game.puuid) : undefined;
      owner ??= rows.find(
        (p) =>
          p.champion_id === game.champion_id &&
          p.kills === game.kills &&
          p.deaths === game.deaths &&
          p.assists === game.assists,
      );
      if (owner) updateStmt.run(owner.spell1, owner.spell2, game.game_id);
    }
  });
  tx();
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
      // Runs inside migrateToV1, before the blobs have been normalized, so the
      // participant rows have to come from the payload itself.
      let rows: { early_surrender: number }[] = [];
      if (game.raw_json) {
        try {
          rows = participantRowsFromRaw(JSON.parse(game.raw_json));
        } catch {
          /* ignore parse errors */
        }
      }
      if (detectRemake(game.game_duration, rows)) {
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

// game_augments holds our own picks; match_participant_augments holds
// everyone's. Once a game is normalized the former is just the latter narrowed
// to the game's owner, so widening our stored slots is a copy, not a re-parse.
function backfillAugmentSlots() {
  db.exec(`
    INSERT OR IGNORE INTO game_augments (game_id, slot, augment_id)
    SELECT a.game_id, a.slot, a.augment_id
    FROM match_participant_augments a
    JOIN games g ON g.game_id = a.game_id
    JOIN match_participants p
      ON p.game_id = a.game_id AND p.participant_id = a.participant_id
    WHERE g.puuid != '' AND p.puuid = g.puuid
  `);
}

// Queues switched off on the Settings page, as stored in hidden_queues. An
// absent key means the setting was never written; an empty one means the user
// has everything switched on.
function getHiddenQueues(): number[] {
  const raw = getSetting("hidden_queues");
  if (!raw) return [];
  return raw
    .split(",")
    .map(Number)
    .filter((id) => Number.isFinite(id));
}

// Every queue with games stored, ignoring which ones are hidden — the Settings
// page needs the full list to offer a hidden queue's switch back on.
export function getStoredQueues(): number[] {
  const rows = db
    .prepare(`
      SELECT DISTINCT g.queue_id
      FROM games g
      JOIN player_stats ps ON g.game_id = ps.game_id
      ORDER BY g.queue_id
    `)
    .all() as { queue_id: number }[];
  return rows.map((r) => r.queue_id);
}

// Appends queue conditions to a query's WHERE list. An explicit queue filter
// wins; otherwise the queues switched off in Settings are excluded everywhere.
function applyQueueFilter(where: string[], params: any[], queue?: number, alias = "g") {
  if (queue != null) {
    where.push(`${alias}.queue_id = ?`);
    params.push(queue);
    return;
  }
  const hidden = getHiddenQueues();
  if (hidden.length > 0) {
    where.push(`${alias}.queue_id NOT IN (${hidden.map(() => "?").join(", ")})`);
    params.push(...hidden);
  }
}

// Remakes are already left out of every stat; this setting takes them out of
// the match list as well. An absent key means they stay visible.
function hideRemakes(): boolean {
  return getSetting("hide_remakes") === "true";
}

// Score backfills are keyed on formula version + champion data version, so
// stored scores recompute when either changes (new formula, new patch,
// re-tagged champion).
function scoreFormulaKey() {
  return `${SCORE_FORMULA_VERSION}@${getChampionDataVersion()}`;
}

// Recompute stored scores from the participant rows. Runs whenever the formula version or
// the champion class data changes (new patch, re-tagged champion) so stored
// scores never go stale. Call after champion data has loaded; returns whether
// a backfill ran so the caller can refresh the renderer.
export function checkScoreBackfill(): boolean {
  if (getSetting("score_formula_version") === scoreFormulaKey()) return false;
  backfillScores();
  setSetting("score_formula_version", scoreFormulaKey());
  return true;
}

// Scoring grades a player against the other nine, so it always works on a whole
// game's worth of participant rows.
interface ScoreRow {
  participant_id: number;
  puuid: string | null;
  team_id: number;
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
}

const SCORE_ROW_COLUMNS = `participant_id, puuid, team_id, champion_id, win,
       kills, deaths, assists, double_kills, triple_kills, quadra_kills, penta_kills,
       total_damage_dealt, total_damage_taken, gold_earned, total_heal`;

function scoreInputsFromRows(rows: ScoreRow[]): (ScoreInput & { puuid: string | null })[] {
  return rows.map((r) => ({
    participantId: r.participant_id,
    teamId: r.team_id,
    puuid: r.puuid,
    championId: r.champion_id,
    kills: r.kills,
    deaths: r.deaths,
    assists: r.assists,
    doubleKills: r.double_kills,
    tripleKills: r.triple_kills,
    quadraKills: r.quadra_kills,
    pentaKills: r.penta_kills,
    totalDamageDealtToChampions: r.total_damage_dealt,
    totalDamageTaken: r.total_damage_taken,
    goldEarned: r.gold_earned,
    totalHeal: r.total_heal,
    win: r.win === 1,
  }));
}

// Groups flat participant rows spanning many games back into per-game lists,
// so a whole-library rescore is one query rather than one per game.
function groupByGame<T extends { game_id: number }>(rows: T[]): Map<number, T[]> {
  const byGame = new Map<number, T[]>();
  for (const row of rows) {
    const list = byGame.get(row.game_id);
    if (list) list.push(row);
    else byGame.set(row.game_id, [row]);
  }
  return byGame;
}

function computeOwnerScore(
  participants: ScoreRow[],
  ownerPuuid: string | null,
  fallback?: { champion_id: number; kills: number; deaths: number; assists: number },
): PlayerScore | null {
  const inputs = scoreInputsFromRows(participants);
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
  return computeMatchScores(inputs, getChampionClasses()).get(owner.participantId) ?? null;
}

function backfillScores() {
  const games = db
    .prepare(`
      SELECT g.game_id, g.puuid, g.is_remake,
             ps.champion_id, ps.kills, ps.deaths, ps.assists
      FROM games g
      JOIN player_stats ps ON g.game_id = ps.game_id
    `)
    .all() as {
    game_id: number;
    puuid: string;
    is_remake: number;
    champion_id: number;
    kills: number;
    deaths: number;
    assists: number;
  }[];

  const participants = groupByGame(
    db
      .prepare(`SELECT game_id, ${SCORE_ROW_COLUMNS} FROM match_participants`)
      .all() as (ScoreRow & { game_id: number })[],
  );

  const updateStmt = db.prepare(
    "UPDATE player_stats SET score = ?, score_raw = ?, score_badge = ? WHERE game_id = ?",
  );
  const tx = db.transaction(() => {
    for (const row of games) {
      if (row.is_remake) {
        updateStmt.run(null, null, null, row.game_id);
        continue;
      }
      const result = computeOwnerScore(participants.get(row.game_id) ?? [], row.puuid || null, row);
      updateStmt.run(
        result?.score ?? null,
        result?.raw ?? null,
        result?.badge ?? null,
        row.game_id,
      );
    }
  });
  tx();
}

function parsePatch(version: unknown): string | null {
  if (typeof version !== "string") return null;
  const m = version.match(/^(\d+)\.(\d+)/);
  return m ? `${m[1]}.${m[2]}` : null;
}

function detectRemake(gameDuration: number, rows: { early_surrender: number }[]): boolean {
  // Very short games are always remakes
  if (gameDuration < 300) return true;
  // An early surrender still inside the first ten minutes counts as one too
  if (gameDuration < 600) return rows.some((r) => r.early_surrender === 1);
  return false;
}

// ---- Helpers ----

// The per-game maxima the match list scales its stat bars against. Selected
// alongside the row rather than derived in JS: three correlated MAX()es over a
// page of 25 games cost a fraction of a millisecond.
const GAME_MAX_STATS_SQL = `
           MAX(IFNULL((SELECT MAX(mp.total_damage_dealt) FROM match_participants mp
                        WHERE mp.game_id = g.game_id), 0), 1) as game_max_dmg,
           MAX(IFNULL((SELECT MAX(mp.total_damage_taken) FROM match_participants mp
                        WHERE mp.game_id = g.game_id), 0), 1) as game_max_taken,
           MAX(IFNULL((SELECT MAX(mp.total_heal) FROM match_participants mp
                        WHERE mp.game_id = g.game_id), 0), 1) as game_max_heal`;

// Everything MatchListItem promises, for the three queries that return a row
// per game to the match list. Shared so a column added for one of them can't
// leave the other two handing back a row the renderer's type says is complete.
const MATCH_ROW_SQL = `
      g.game_id, g.queue_id, g.game_creation, g.game_duration, g.is_remake, g.favorite,
      g.puuid, g.game_version,
      ps.champion_id, ps.win, ps.kills, ps.deaths, ps.assists,
      ps.double_kills, ps.triple_kills, ps.quadra_kills, ps.penta_kills,
      ps.total_damage_dealt, ps.total_damage_taken, ps.total_heal, ps.gold_earned,
      ps.score, ps.score_badge, ps.spell1, ps.spell2,
      ps.item0, ps.item1, ps.item2, ps.item3, ps.item4, ps.item5,
      (SELECT GROUP_CONCAT(ga.augment_id) FROM game_augments ga
        WHERE ga.game_id = g.game_id ORDER BY ga.slot) as augment_ids,
${GAME_MAX_STATS_SQL}`;

// ---- Query functions ----

const MATCH_SORT_COLUMNS: Record<string, string> = {
  date: "g.game_creation",
  kda: "(ps.kills + ps.assists) * 1.0 / MAX(ps.deaths, 1)",
  kills: "ps.kills",
  duration: "g.game_duration",
  // Ordered on the unclamped score so the 10s at the top of the list — and
  // every 0.1-rounding tie below them — keep their real order.
  score: "ps.score_raw",
  damageDealt: "ps.total_damage_dealt",
  damageTaken: "ps.total_damage_taken",
  healing: "ps.total_heal",
};

function matchOrderBy(sort?: string, sortDir?: string): string {
  const key = sort && MATCH_SORT_COLUMNS[sort] ? sort : "date";
  const dir = sortDir === "asc" ? "ASC" : "DESC";
  const parts: string[] = [];
  // Games without a score belong at the bottom whichever way we're sorting
  if (key === "score") parts.push("ps.score_raw IS NULL");
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

interface MatchListFilters {
  championId?: number;
  patch?: string;
  queue?: number;
  account?: string;
  sort?: string;
  sortDir?: string;
  multikills?: string[];
  favorites?: boolean;
}

// The WHERE the match list is built on, shared with anything that has to
// describe the same set of games. Sorting and paging are the caller's business;
// everything that decides *which* games are in the list is here, so a summary
// over the list can't drift from the list itself.
function matchListWhere(filters?: MatchListFilters): { whereSql: string; params: any[] } {
  const where: string[] = [];
  const params: any[] = [];
  if (hideRemakes()) {
    where.push("g.is_remake = 0");
  }
  if (filters?.favorites) {
    where.push("g.favorite = 1");
  }
  if (filters?.account) {
    where.push("g.puuid = ?");
    params.push(filters.account);
  }
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
  return { whereSql: where.length > 0 ? `WHERE ${where.join(" AND ")}` : "", params };
}

// What a session is grouped by, in the same terms sessionKey uses in the
// renderer so a group there lines up with a row here. Day and week both start
// at the hour a day of play does, and 'weekday 0' then '-6 days' walks back to
// that week's Monday.
const LOCAL_SESSION_DATE = `g.game_creation / 1000, 'unixepoch', 'localtime', '-${DAY_START_HOUR} hours'`;
const SESSION_KEY_SQL: Record<Exclude<SessionGrouping, "none">, string> = {
  day: `date(${LOCAL_SESSION_DATE})`,
  week: `date(${LOCAL_SESSION_DATE}, 'weekday 0', '-6 days')`,
  patch: "COALESCE(g.game_version, '')",
};

/**
 * One row per session of play, over every game the current filters match.
 *
 * The list itself arrives a page at a time, so counting the rows on screen
 * describes the page rather than the session: a twenty-five game session read
 * as twenty until it was scrolled. These totals don't depend on how far anyone
 * has scrolled.
 *
 * Remakes are in the game count and out of everything else, matching how the
 * rest of the app treats them.
 */
export function getMatchSessions(filters?: MatchListFilters): any[] {
  const grouping = parseSessionGrouping(getSetting(SESSION_GROUPING_SETTING));
  // Nothing to total up when the list runs flat.
  if (grouping === "none") return [];
  const { whereSql, params } = matchListWhere(filters);

  return db
    .prepare(`
      SELECT ${SESSION_KEY_SQL[grouping]} AS key,
             COUNT(*) AS games,
             SUM(CASE WHEN g.is_remake = 0 AND ps.win = 1 THEN 1 ELSE 0 END) AS wins,
             SUM(CASE WHEN g.is_remake = 0 AND ps.win = 0 THEN 1 ELSE 0 END) AS losses,
             SUM(CASE WHEN g.is_remake = 0 THEN ps.kills ELSE 0 END) AS kills,
             SUM(CASE WHEN g.is_remake = 0 THEN ps.deaths ELSE 0 END) AS deaths,
             SUM(CASE WHEN g.is_remake = 0 THEN ps.assists ELSE 0 END) AS assists,
             SUM(CASE WHEN g.is_remake = 0 THEN ps.score END) AS score_sum,
             COUNT(CASE WHEN g.is_remake = 0 THEN ps.score END) AS scored_games
      FROM games g
      JOIN player_stats ps ON g.game_id = ps.game_id
      ${whereSql}
      GROUP BY key
      ORDER BY MAX(g.game_creation) DESC
    `)
    .all(...params);
}

export function getMatchHistory(
  limit: number,
  offset: number,
  filters?: MatchListFilters,
): { matches: any[]; total: number } {
  const { whereSql, params } = matchListWhere(filters);
  const orderBy = matchOrderBy(filters?.sort, filters?.sortDir);

  const total = db
    .prepare(`
    SELECT COUNT(*) as count
    FROM games g
    JOIN player_stats ps ON g.game_id = ps.game_id
    ${whereSql}
  `)
    .get(...params) as any;
  const matches = db
    .prepare(`
    SELECT ${MATCH_ROW_SQL}
    FROM games g
    JOIN player_stats ps ON g.game_id = ps.game_id
    ${whereSql}
    ORDER BY ${orderBy}
    LIMIT ? OFFSET ?
  `)
    .all(...params, limit, offset);
  return { matches, total: total.count };
}

export function getMatchFilterOptions(filters?: {
  championId?: number;
  patch?: string;
  queue?: number;
  account?: string;
}): {
  patches: string[];
  champions: number[];
  queues: number[];
  accounts: { puuid: string; name: string | null; profileIcon: number | null }[];
  hasFavorites: boolean;
} {
  // Each list is narrowed by the OTHER filters so a dropdown never hides its own selection
  const applyAccountFilter = (where: string[], params: any[]) => {
    if (filters?.account) {
      where.push("g.puuid = ?");
      params.push(filters.account);
    }
  };

  const patchWhere = ["g.game_version IS NOT NULL AND g.game_version != ''"];
  const patchParams: any[] = [];
  if (filters?.championId != null) {
    patchWhere.push("ps.champion_id = ?");
    patchParams.push(filters.championId);
  }
  applyQueueFilter(patchWhere, patchParams, filters?.queue);
  applyAccountFilter(patchWhere, patchParams);
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
  applyAccountFilter(champWhere, champParams);
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
  applyAccountFilter(queueWhere, queueParams);
  const queueRows = db
    .prepare(`
    SELECT DISTINCT g.queue_id
    FROM games g
    JOIN player_stats ps ON g.game_id = ps.game_id
    WHERE ${queueWhere.join(" AND ")}
    ORDER BY g.queue_id
  `)
    .all(...queueParams) as { queue_id: number }[];

  // Like the favorites toggle below, this list ignores the other filters: the
  // set of tracked accounts is stable, and the dropdown shouldn't reshuffle as
  // the user narrows by champion or patch. Games whose owner was never resolved
  // carry an empty puuid and aren't an account.
  const accountRows = db
    .prepare(`
    SELECT g.puuid, s.game_name, s.tag_line, s.profile_icon
    FROM games g
    LEFT JOIN summoner s ON s.puuid = g.puuid
    WHERE g.puuid != ''
    GROUP BY g.puuid
    ORDER BY MAX(g.game_creation) DESC
  `)
    .all() as {
    puuid: string;
    game_name: string | null;
    tag_line: string | null;
    profile_icon: number | null;
  }[];
  // An imported database may have no summoner row for an account — fall back to
  // the name and icon its most recent game recorded, same as getProfile does.
  const latestGameStmt = db.prepare(
    "SELECT game_id FROM games WHERE puuid = ? ORDER BY game_creation DESC LIMIT 1",
  );
  const accounts = accountRows.map((r) => {
    let name = displayName(r.game_name, r.tag_line);
    let profileIcon = r.profile_icon;
    if (!name || profileIcon == null) {
      const latest = latestGameStmt.get(r.puuid) as { game_id: number } | undefined;
      const fromGame = latest
        ? identityFromGame(latest.game_id, r.puuid)
        : { name: null, icon: null };
      name = name ?? fromGame.name;
      profileIcon = profileIcon ?? fromGame.icon;
    }
    return { puuid: r.puuid, name, profileIcon };
  });

  // Unlike the lists above, this one ignores the other filters: the favorites
  // toggle should stay put while the user narrows the list rather than blinking
  // out whenever the current selection happens to hold no favorites.
  const favoriteRow = db
    .prepare(`
    SELECT EXISTS (
      SELECT 1
      FROM games g
      JOIN player_stats ps ON g.game_id = ps.game_id
      WHERE g.favorite = 1
    ) as has
  `)
    .get() as { has: number };

  return {
    patches,
    champions: champRows.map((r) => r.champion_id),
    queues: queueRows.map((r) => r.queue_id),
    accounts,
    hasFavorites: !!favoriteRow.has,
  };
}

// The full ten-player scoreboard for one game, in the shape the renderer draws.
// Columns are listed rather than starred so the IPC message stays a few
// kilobytes instead of carrying the stored payload with it.
function getMatchParticipants(gameId: number): any[] {
  const rows = db
    .prepare(`
      SELECT participant_id, puuid, game_name, tag_line, team_id, champion_id, win,
             kills, deaths, assists, double_kills, triple_kills, quadra_kills, penta_kills,
             total_damage_dealt, total_damage_taken, gold_earned, total_heal,
             largest_killing_spree, spell1, spell2,
             item0, item1, item2, item3, item4, item5, item6
      FROM match_participants
      WHERE game_id = ?
      ORDER BY participant_id
    `)
    .all(gameId) as any[];

  const augmentRows = db
    .prepare(`
      SELECT participant_id, augment_id
      FROM match_participant_augments
      WHERE game_id = ?
      ORDER BY participant_id, slot
    `)
    .all(gameId) as { participant_id: number; augment_id: number }[];

  const augments = new Map<number, number[]>();
  for (const row of augmentRows) {
    const list = augments.get(row.participant_id);
    if (list) list.push(row.augment_id);
    else augments.set(row.participant_id, [row.augment_id]);
  }

  return rows.map((r) => ({
    participantId: r.participant_id,
    puuid: r.puuid,
    gameName: r.game_name,
    tagLine: r.tag_line,
    championId: r.champion_id,
    teamId: r.team_id,
    win: r.win === 1,
    kills: r.kills,
    deaths: r.deaths,
    assists: r.assists,
    doubleKills: r.double_kills,
    tripleKills: r.triple_kills,
    quadraKills: r.quadra_kills,
    pentaKills: r.penta_kills,
    totalDamageDealtToChampions: r.total_damage_dealt,
    totalDamageTaken: r.total_damage_taken,
    goldEarned: r.gold_earned,
    totalHeal: r.total_heal,
    largestKillingSpree: r.largest_killing_spree,
    spell1Id: r.spell1,
    spell2Id: r.spell2,
    items: [r.item0, r.item1, r.item2, r.item3, r.item4, r.item5, r.item6].map((i) => i ?? 0),
    augments: augments.get(r.participant_id) ?? [],
  }));
}

export function getMatchDetail(gameId: number): any {
  // Columns are listed rather than starred so the compressed payload stays out
  // of an IPC message that only needs the game's metadata.
  const game = db
    .prepare(`
      SELECT game_id, queue_id, game_mode, game_creation, game_duration,
             is_remake, puuid, game_version, favorite
      FROM games WHERE game_id = ?
    `)
    .get(gameId) as any;
  if (!game) return null;
  const stats = db.prepare("SELECT * FROM player_stats WHERE game_id = ?").get(gameId);
  const augments = db
    .prepare("SELECT * FROM game_augments WHERE game_id = ? ORDER BY slot")
    .all(gameId);
  return {
    game,
    stats,
    augments,
    participants: getMatchParticipants(gameId),
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
  account?: string;
}): any {
  const where: string[] = ["g.is_remake = 0"];
  const params: any[] = [];
  if (filters?.championId != null) {
    where.push("ps.champion_id = ?");
    params.push(filters.championId);
  }
  if (filters?.account) {
    where.push("g.puuid = ?");
    params.push(filters.account);
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
           SUM(g.game_duration) as totalDuration,
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
    totalDuration: totals.totalDuration ?? 0,
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
  totalGames: number;
  augments: {
    augment_id: number;
    picks: number;
    wins: number;
    champions: { champion_id: number; picks: number; wins: number }[];
  }[];
} {
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

  // Counted here rather than derived from the augment rows. Picks are slots,
  // not games: a game carries up to AUGMENT_SLOTS of them and often fewer, so
  // dividing picks by the slot count lands on neither number and disagrees
  // with what the Champions tab sums for the same filters.
  const { totalGames } = db
    .prepare(`
    SELECT COUNT(*) as totalGames
    FROM player_stats ps
    JOIN games g ON ps.game_id = g.game_id
    WHERE ${where.join(" AND ")}
  `)
    .get(...params) as { totalGames: number };

  return {
    totalGames,
    augments: augments.map((a) => ({
      ...a,
      champions: champMap.get(a.augment_id) ?? [],
    })),
  };
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
  const matches = db
    .prepare(`
    SELECT ${MATCH_ROW_SQL}
    FROM games g
    JOIN player_stats ps ON g.game_id = ps.game_id
    ${whereSql}
    ORDER BY g.game_creation DESC
    LIMIT ? OFFSET ?
  `)
    .all(...params, limit, offset);
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

// The single-id form of the above, for the recent-games sync: it looks at
// twenty ids a minute, so the per-id query is the cheaper of the two.
export function isGameKnown(gameId: number): boolean {
  const row = db
    .prepare(
      "SELECT 1 FROM games WHERE game_id = ? UNION ALL SELECT 1 FROM ignored_games WHERE game_id = ? LIMIT 1",
    )
    .get(gameId, gameId);
  return !!row;
}

export function markIgnoredGame(gameId: number): void {
  db.prepare("INSERT OR IGNORE INTO ignored_games (game_id) VALUES (?)").run(gameId);
}

// The game's owner among its participant rows. participantRowsFromRaw has
// already folded participantIdentities into each row's puuid, so one lookup
// covers both the LCU and SGP shapes.
function findOwnerRow(rows: RawParticipantRow[], puuid: string): RawParticipantRow | null {
  if (!puuid) return null;
  return rows.find((r) => r.puuid === puuid) ?? null;
}

export function insertGameFull(gameData: any, puuid: string): boolean {
  const rows = participantRowsFromRaw(gameData);
  const owner = findOwnerRow(rows, puuid);
  if (!owner) return false;

  const isRemake = detectRemake(gameData.gameDuration, rows) ? 1 : 0;

  let ownerScore: PlayerScore | null = null;
  if (!isRemake) {
    ownerScore = computeOwnerScore(rows, puuid, {
      champion_id: owner.champion_id,
      kills: owner.kills,
      deaths: owner.deaths,
      assists: owner.assists,
    });
  }

  const gameVersion = parsePatch(gameData.gameVersion);

  const insertGameStmt = db.prepare(`
    INSERT OR IGNORE INTO games (game_id, queue_id, game_mode, game_creation, game_duration, is_remake, puuid, game_version, raw_gz)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertStatsStmt = db.prepare(`
    INSERT OR IGNORE INTO player_stats (
      game_id, champion_id, win, kills, deaths, assists,
      double_kills, triple_kills, quadra_kills, penta_kills,
      total_damage_dealt, total_damage_taken, gold_earned, total_heal,
      largest_killing_spree, spell1, spell2,
      item0, item1, item2, item3, item4, item5, item6,
      score, score_raw, score_badge
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      gameVersion,
      packRaw(gameData),
    );

    if (result.changes === 0) return false; // duplicate

    writeParticipants(
      gameData.gameId,
      { is_remake: isRemake, queue_id: gameData.queueId, game_version: gameVersion },
      rows,
    );

    insertStatsStmt.run(
      gameData.gameId,
      owner.champion_id,
      owner.win,
      owner.kills,
      owner.deaths,
      owner.assists,
      owner.double_kills,
      owner.triple_kills,
      owner.quadra_kills,
      owner.penta_kills,
      owner.total_damage_dealt,
      owner.total_damage_taken,
      owner.gold_earned,
      owner.total_heal,
      owner.largest_killing_spree,
      owner.spell1,
      owner.spell2,
      owner.items[0],
      owner.items[1],
      owner.items[2],
      owner.items[3],
      owner.items[4],
      owner.items[5],
      owner.items[6],
      ownerScore?.score ?? null,
      ownerScore?.raw ?? null,
      ownerScore?.badge ?? null,
    );

    // Augments
    for (const aug of owner.augments) {
      insertAugmentStmt.run(gameData.gameId, aug.slot, aug.augment_id);
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

function getSummoner(): any {
  return db.prepare("SELECT * FROM summoner ORDER BY updated_at DESC LIMIT 1").get();
}

// One account's name and icon as that game recorded them. Covers databases
// built purely from an import, where the client has never connected and the
// summoner table has no icon.
function identityFromGame(
  gameId: number,
  puuid: string,
): { name: string | null; icon: number | null } {
  const row = db
    .prepare(
      "SELECT game_name, tag_line, profile_icon FROM match_participants WHERE game_id = ? AND puuid = ?",
    )
    .get(gameId, puuid) as
    | { game_name: string | null; tag_line: string | null; profile_icon: number | null }
    | undefined;
  if (!row) return { name: null, icon: null };
  return {
    name: displayName(row.game_name, row.tag_line),
    icon: row.profile_icon,
  };
}

// The header names whichever account played most recently, so its name and icon
// always come from the same place. Keying off the summoner table's updated_at
// instead would name the account the client last synced — which need not be the
// one that played, and which repairPuuids rewrites for every account at once.
export function getProfile(): { name: string | null; profileIcon: number | null } {
  const latest = db
    .prepare(
      "SELECT game_id, puuid FROM games WHERE puuid != '' ORDER BY game_creation DESC LIMIT 1",
    )
    .get() as { game_id: number; puuid: string } | undefined;

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
    ? identityFromGame(latest.game_id, latest.puuid)
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
// The id the Friends list keys a teammate on — puuid when we know it, so name
// changes don't split a player in two.
function teammateKey(puuid: string | null, name: string): string {
  return puuid || name;
}

function teammateName(gameName: string | null, tagLine: string | null, participantId: number) {
  return displayName(gameName, tagLine) ?? `Player ${participantId}`;
}

interface TeammateRow {
  game_id: number;
  game_creation: number;
  participant_id: number;
  puuid: string | null;
  game_name: string | null;
  tag_line: string | null;
  profile_icon: number | null;
  champion_id: number;
  win: number;
  kills: number;
  deaths: number;
  assists: number;
}

// Every participant who shared a team with one of our accounts, one row per
// player per game.
//
// Which (game, team) pairs are ours is resolved up front in a CTE rather than
// as an EXISTS against each candidate row: the CTE is a single indexed lookup
// per account, where the correlated form makes SQLite build a throwaway index
// on every call. DISTINCT is what keeps the row count honest when two of our
// own accounts played the same game on the same side.
function teammateRows(puuids: string[]): TeammateRow[] {
  const ours = puuids.map(() => "?").join(", ");
  const where = ["o.is_remake = 0", `(o.puuid IS NULL OR o.puuid NOT IN (${ours}))`];
  const params: any[] = [...puuids];
  applyQueueFilter(where, params, undefined, "o");

  return db
    .prepare(`
      WITH our_teams AS (
        SELECT DISTINCT game_id, team_id FROM match_participants WHERE puuid IN (${ours})
      )
      SELECT o.game_id, g.game_creation, o.participant_id, o.puuid, o.game_name, o.tag_line,
             o.profile_icon, o.champion_id, o.win, o.kills, o.deaths, o.assists
      FROM our_teams t
      JOIN match_participants o ON o.game_id = t.game_id AND o.team_id = t.team_id
      JOIN games g ON g.game_id = o.game_id
      WHERE ${where.join(" AND ")}
      ORDER BY g.game_creation DESC
    `)
    .all(...puuids, ...params) as TeammateRow[];
}

export function getTeammateStats(): any[] {
  const puuids = getAllPuuids();
  if (puuids.length === 0) return [];

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

  for (const row of teammateRows(puuids)) {
    const name = teammateName(row.game_name, row.tag_line, row.participant_id);
    const key = teammateKey(row.puuid, name);

    // If we now have a puuid but previously tracked this player by name, merge
    if (row.puuid && !playerMap.has(row.puuid) && playerMap.has(name)) {
      const old = playerMap.get(name)!;
      if (!old.puuid) {
        playerMap.set(row.puuid, old);
        old.puuid = row.puuid;
        playerMap.delete(name);
      }
    }

    if (!playerMap.has(key)) {
      playerMap.set(key, {
        name,
        puuid: row.puuid,
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
    if (row.game_creation > entry.lastPlayed) {
      entry.name = name;
      if (row.profile_icon != null) entry.profileIcon = row.profile_icon;
    }
    entry.games++;
    if (row.win) entry.wins++;
    entry.kills += row.kills;
    entry.deaths += row.deaths;
    entry.assists += row.assists;
    entry.lastPlayed = Math.max(entry.lastPlayed, row.game_creation);
    entry.champions.set(row.champion_id, (entry.champions.get(row.champion_id) || 0) + 1);
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
      // Champion id breaks ties so the same five champions come back in the
      // same order every time, rather than in whatever order the rows arrived.
      champions: Array.from(p.champions.entries())
        .sort((a, b) => b[1] - a[1] || a[0] - b[0])
        .slice(0, 5)
        .map(([champion_id, games]) => ({ champion_id, games })),
      lastPlayed: p.lastPlayed,
    }))
    .sort((a, b) => b.games - a.games);
}

// Every game we played alongside one teammate, from both sides: our stored
// stats for the row plus the teammate's own line in that game.
export function getTeammateDetail(key: string): { player: any; matches: any[] } | null {
  const puuids = getAllPuuids();
  if (puuids.length === 0) return null;

  // Rows are newest-first, so the first hit carries the current name and icon.
  // Older games can be missing puuids; once we know who we're looking at, match
  // those on name too — the same merge the Friends list does.
  const theirs: TeammateRow[] = [];
  let name: string | null = null;
  for (const row of teammateRows(puuids)) {
    const rowName = teammateName(row.game_name, row.tag_line, row.participant_id);
    if (teammateKey(row.puuid, rowName) === key) {
      name ??= rowName;
      theirs.push(row);
    } else if (name != null && row.puuid == null && rowName === name) {
      theirs.push(row);
    }
  }
  if (theirs.length === 0) return null;

  const byGame = new Map(theirs.map((row) => [row.game_id, row]));
  const gameIds = Array.from(byGame.keys());
  const idList = gameIds.map(() => "?").join(", ");

  // Our own row for each shared game — the same columns the match list shows.
  const ourMatches = db
    .prepare(`
      SELECT ${MATCH_ROW_SQL}
      FROM games g
      JOIN player_stats ps ON g.game_id = ps.game_id
      WHERE g.game_id IN (${idList})
      ORDER BY g.game_creation DESC
    `)
    .all(...gameIds) as any[];

  // The teammate's score has to be computed rather than looked up — player_stats
  // only ever scores our own row — so each shared game needs all ten players.
  const scoreRows = groupByGame(
    db
      .prepare(
        `SELECT game_id, ${SCORE_ROW_COLUMNS} FROM match_participants WHERE game_id IN (${idList})`,
      )
      .all(...gameIds) as (ScoreRow & { game_id: number })[],
  );

  interface ChampionTotals {
    games: number;
    wins: number;
    kills: number;
    deaths: number;
    assists: number;
  }

  const matches: any[] = [];
  const champions = new Map<number, ChampionTotals>();
  const first = theirs[0];
  const player = {
    key,
    name: name ?? key,
    puuid: first.puuid,
    profileIcon: first.profile_icon,
    games: 0,
    wins: 0,
    kills: 0,
    deaths: 0,
    assists: 0,
    champions: [] as ({ champion_id: number } & ChampionTotals)[],
    lastPlayed: first.game_creation,
  };

  for (const row of ourMatches) {
    const friend = byGame.get(row.game_id);
    if (!friend) continue;

    if (player.profileIcon == null) player.profileIcon = friend.profile_icon;

    player.games++;
    if (friend.win) player.wins++;
    player.kills += friend.kills;
    player.deaths += friend.deaths;
    player.assists += friend.assists;

    if (!champions.has(friend.champion_id)) {
      champions.set(friend.champion_id, { games: 0, wins: 0, kills: 0, deaths: 0, assists: 0 });
    }
    const champ = champions.get(friend.champion_id)!;
    champ.games++;
    if (friend.win) champ.wins++;
    champ.kills += friend.kills;
    champ.deaths += friend.deaths;
    champ.assists += friend.assists;

    const gameRows = scoreRows.get(row.game_id) ?? [];
    const friendScore = computeMatchScores(scoreInputsFromRows(gameRows), getChampionClasses()).get(
      friend.participant_id,
    );
    const friendStats = gameRows.find((p) => p.participant_id === friend.participant_id);

    matches.push({
      ...row,
      friend: {
        champion_id: friend.champion_id,
        win: friend.win,
        kills: friend.kills,
        deaths: friend.deaths,
        assists: friend.assists,
        total_damage_dealt: friendStats?.total_damage_dealt ?? 0,
        total_damage_taken: friendStats?.total_damage_taken ?? 0,
        total_heal: friendStats?.total_heal ?? 0,
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
  const params = ITEM_SLOTS.flatMap(() => [championId, ...extraParams]);
  return db
    .prepare(`
    SELECT item_id, COUNT(*) as picks, SUM(win) as wins
    FROM (
        ${itemSlotUnion(
          (i) => `SELECT ps.item${i} as item_id, ps.win
                FROM player_stats ps JOIN games g ON ps.game_id = g.game_id
                WHERE ps.champion_id = ? AND g.is_remake = 0${extraSql}
                  AND ps.item${i} > 0 AND ps.item${i} NOT IN (${EXCLUDED_ITEMS_SQL})`,
        )}
    )
    GROUP BY item_id
    ORDER BY picks DESC
  `)
    .all(...params) as any[];
}

// The seven item slots are columns, and every item stat wants them as rows.
// `row` builds one slot's SELECT; the caller's params repeat once per slot.
function itemSlotUnion(row: (slot: number) => string): string {
  return ITEM_SLOTS.map(row).join("\n        UNION ALL\n        ");
}

// Filters for a query over match_participants. is_remake, queue_id and
// game_version are carried on the participant rows themselves, so nothing here
// has to join back to games.
function participantFilter(patch?: string, queue?: number, alias = "mp") {
  const where = [`${alias}.is_remake = 0`];
  const params: any[] = [];
  if (patch) {
    where.push(`${alias}.game_version = ?`);
    params.push(patch);
  }
  applyQueueFilter(where, params, queue, alias);
  return { where, params, sql: where.join(" AND ") };
}

export function getGlobalStats(
  patch?: string,
  queue?: number,
): {
  champions: { champion_id: number; games: number; wins: number }[];
  augments: { augment_id: number; picks: number; wins: number }[];
  items: { item_id: number; picks: number; wins: number }[];
  totalParticipantSlots: number;
} {
  const mp = participantFilter(patch, queue);
  const mpa = participantFilter(patch, queue, "mpa");

  const champions = db
    .prepare(`
      SELECT mp.champion_id, COUNT(*) as games, SUM(mp.win) as wins
      FROM match_participants mp
      WHERE ${mp.sql} AND mp.champion_id > 0
      GROUP BY mp.champion_id
      ORDER BY games DESC
    `)
    .all(...mp.params) as { champion_id: number; games: number; wins: number }[];

  const augments = db
    .prepare(`
      SELECT mpa.augment_id, COUNT(*) as picks, SUM(mpa.win) as wins
      FROM match_participant_augments mpa
      WHERE ${mpa.sql}
      GROUP BY mpa.augment_id
      ORDER BY picks DESC
    `)
    .all(...mpa.params) as { augment_id: number; picks: number; wins: number }[];

  const items = db
    .prepare(`
      SELECT item_id, COUNT(*) as picks, SUM(win) as wins
      FROM (
        ${itemSlotUnion(
          (i) => `SELECT mp.item${i} as item_id, mp.win as win
                FROM match_participants mp
                WHERE ${mp.sql}
                  AND mp.item${i} > 0 AND mp.item${i} NOT IN (${EXCLUDED_ITEMS_SQL})`,
        )}
      )
      GROUP BY item_id
      ORDER BY picks DESC
    `)
    .all(...ITEM_SLOTS.flatMap(() => mp.params)) as {
    item_id: number;
    picks: number;
    wins: number;
  }[];

  const slots = db
    .prepare(`
      SELECT COUNT(*) as count
      FROM match_participants mp
      WHERE ${mp.sql} AND mp.champion_id > 0
    `)
    .get(...mp.params) as { count: number };

  return { champions, augments, items, totalParticipantSlots: slots.count };
}

// Everything we know about one champion across every stored game, counting all
// ten players in each game (not just our own). Items and augments come from the
// participant tables for the same reason — the player_stats/game_augments
// tables only hold our own picks.
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
  const mp = participantFilter(patch, queue);
  const mpa = participantFilter(patch, queue, "mpa");

  // Shares are per-game ratios averaged over the games they're defined in, so
  // a game with no team damage/kills recorded can't drag the average to zero —
  // which is what AVG over a NULLable expression does.
  const totals = db
    .prepare(`
      WITH teams AS (
        SELECT mp.game_id, mp.team_id,
               SUM(mp.total_damage_dealt) as team_damage,
               SUM(mp.kills) as team_kills
        FROM match_participants mp
        WHERE ${mp.sql}
        GROUP BY mp.game_id, mp.team_id
      )
      SELECT COUNT(*) as games,
             SUM(mp.win) as wins,
             SUM(mp.kills) as kills,
             SUM(mp.deaths) as deaths,
             SUM(mp.assists) as assists,
             SUM(mp.total_damage_dealt) as damage,
             SUM(mp.total_damage_taken) as damageTaken,
             SUM(mp.gold_earned) as gold,
             SUM(mp.total_heal) as heal,
             SUM(mp.double_kills) as doubleKills,
             SUM(mp.triple_kills) as tripleKills,
             SUM(mp.quadra_kills) as quadraKills,
             SUM(mp.penta_kills) as pentaKills,
             AVG(CASE WHEN t.team_damage > 0
                      THEN mp.total_damage_dealt * 1.0 / t.team_damage END) as damageShare,
             AVG(CASE WHEN t.team_kills > 0
                      THEN (mp.kills + mp.assists) * 1.0 / t.team_kills END) as killParticipation
      FROM match_participants mp
      JOIN teams t ON t.game_id = mp.game_id AND t.team_id = mp.team_id
      WHERE ${mp.sql} AND mp.champion_id = ?
    `)
    .get(...mp.params, ...mp.params, championId) as any;

  const slots = db
    .prepare(`
      SELECT COUNT(*) as count
      FROM match_participants mp
      WHERE ${mp.sql} AND mp.champion_id > 0
    `)
    .get(...mp.params) as { count: number };

  const items = db
    .prepare(`
      SELECT item_id, COUNT(*) as picks, SUM(win) as wins
      FROM (
        ${itemSlotUnion(
          (i) => `SELECT mp.item${i} as item_id, mp.win as win
                FROM match_participants mp
                WHERE ${mp.sql} AND mp.champion_id = ?
                  AND mp.item${i} > 0 AND mp.item${i} NOT IN (${EXCLUDED_ITEMS_SQL})`,
        )}
      )
      GROUP BY item_id
      ORDER BY picks DESC
    `)
    .all(...ITEM_SLOTS.flatMap(() => [...mp.params, championId])) as {
    item_id: number;
    picks: number;
    wins: number;
  }[];

  const augments = db
    .prepare(`
      SELECT mpa.augment_id, COUNT(*) as picks, SUM(mpa.win) as wins
      FROM match_participant_augments mpa
      WHERE ${mpa.sql} AND mpa.champion_id = ?
      GROUP BY mpa.augment_id
      ORDER BY picks DESC
    `)
    .all(...mpa.params, championId) as {
    augment_id: number;
    picks: number;
    wins: number;
  }[];

  const games = totals?.games ?? 0;
  const avg = (total: number | null) => (games > 0 ? Math.round((total ?? 0) / games) : 0);

  return {
    champion_id: championId,
    games,
    wins: totals?.wins ?? 0,
    kills: totals?.kills ?? 0,
    deaths: totals?.deaths ?? 0,
    assists: totals?.assists ?? 0,
    avgDamage: avg(totals?.damage),
    avgDamageTaken: avg(totals?.damageTaken),
    avgGold: avg(totals?.gold),
    avgHeal: avg(totals?.heal),
    damageShare: totals?.damageShare ?? 0,
    killParticipation: totals?.killParticipation ?? 0,
    doubleKills: totals?.doubleKills ?? 0,
    tripleKills: totals?.tripleKills ?? 0,
    quadraKills: totals?.quadraKills ?? 0,
    pentaKills: totals?.pentaKills ?? 0,
    totalParticipantSlots: slots.count,
    items,
    augments,
  };
}

// Everything the Trends page draws, in one round trip. Days are the finest
// grain the page uses, so the renderer re-buckets them into weeks or months
// itself instead of asking again; patches and clock buckets can't be derived
// from days and come as their own aggregates. All local time — "games per day"
// means the player's day, not UTC's.
export function getTrendsData(queue?: number): any {
  const where = ["g.is_remake = 0"];
  const params: any[] = [];
  applyQueueFilter(where, params, queue);
  const whereSql = `WHERE ${where.join(" AND ")}`;
  const fromSql = `FROM games g JOIN player_stats ps ON g.game_id = ps.game_id`;

  // SUM/COUNT over ps.score skip NULLs, so score averages stay honest for
  // days where only some games have a stored score.
  const daily = db
    .prepare(`
      SELECT date(g.game_creation / 1000, 'unixepoch', 'localtime') as day,
             COUNT(*) as games,
             SUM(ps.win) as wins,
             SUM(ps.kills) as kills,
             SUM(ps.deaths) as deaths,
             SUM(ps.assists) as assists,
             SUM(ps.score) as score_sum,
             COUNT(ps.score) as scored_games
      ${fromSql}
      ${whereSql}
      GROUP BY day
      ORDER BY day
    `)
    .all(...params);

  // Ordered by when the patch was first played rather than by parsing version
  // strings — chronological is what a trend axis wants anyway.
  const patches = db
    .prepare(`
      SELECT g.game_version as patch,
             COUNT(*) as games,
             SUM(ps.win) as wins,
             AVG(ps.score) as avg_score,
             MIN(g.game_creation) as first_played
      ${fromSql}
      ${whereSql} AND g.game_version IS NOT NULL AND g.game_version != ''
      GROUP BY g.game_version
      ORDER BY first_played
    `)
    .all(...params);

  const hours = db
    .prepare(`
      SELECT CAST(strftime('%H', g.game_creation / 1000, 'unixepoch', 'localtime') AS INTEGER) as hour,
             COUNT(*) as games,
             SUM(ps.win) as wins
      ${fromSql}
      ${whereSql}
      GROUP BY hour
      ORDER BY hour
    `)
    .all(...params);

  // strftime('%w'): 0 = Sunday
  const weekdays = db
    .prepare(`
      SELECT CAST(strftime('%w', g.game_creation / 1000, 'unixepoch', 'localtime') AS INTEGER) as weekday,
             COUNT(*) as games,
             SUM(ps.win) as wins
      ${fromSql}
      ${whereSql}
      GROUP BY weekday
      ORDER BY weekday
    `)
    .all(...params);

  return { daily, patches, hours, weekdays };
}

// One row per counted game, oldest first: everything a whole-career walk needs
// and nothing it doesn't. Records and the post-game recap both read the library
// this way, and both depend on the order, since a streak and a milestone are
// only meaningful in the order the games were played.
interface CareerRow {
  game_id: number;
  game_creation: number;
  game_duration: number;
  queue_id: number;
  champion_id: number;
  win: number;
  kills: number;
  deaths: number;
  assists: number;
  total_damage_dealt: number;
  total_damage_taken: number;
  gold_earned: number;
  total_heal: number;
  largest_killing_spree: number;
  score: number | null;
  score_raw: number | null;
  score_badge: "MVP" | "ACE" | null;
  double_kills: number;
  triple_kills: number;
  quadra_kills: number;
  penta_kills: number;
}

function careerRows(queue?: number, account?: string): CareerRow[] {
  const where = ["g.is_remake = 0"];
  const params: any[] = [];
  applyQueueFilter(where, params, queue);
  if (account) {
    where.push("g.puuid = ?");
    params.push(account);
  }

  return db
    .prepare(`
      SELECT g.game_id, g.game_creation, g.game_duration, g.queue_id,
             ps.champion_id, ps.win, ps.kills, ps.deaths, ps.assists,
             ps.total_damage_dealt, ps.total_damage_taken,
             ps.gold_earned, ps.total_heal, ps.largest_killing_spree,
             ps.score, ps.score_raw, ps.score_badge,
             ps.double_kills, ps.triple_kills, ps.quadra_kills, ps.penta_kills
      FROM games g
      JOIN player_stats ps ON g.game_id = ps.game_id
      WHERE ${where.join(" AND ")}
      ORDER BY g.game_creation ASC
    `)
    .all(...params) as CareerRow[];
}

// The trophy case: best single-game marks and longest streaks, from one
// chronological pass over our own rows — streaks need the ordering anyway, and
// the maxima fall out of the same loop. On ties the earliest game keeps the
// record, so a mark has to be strictly beaten to change hands.
export function getRecords(queue?: number, account?: string): any {
  const rows = careerRows(queue, account);

  // Just enough of the game to render a record's context and open its match
  const matchOf = (r: any) => ({
    game_id: r.game_id,
    game_creation: r.game_creation,
    game_duration: r.game_duration,
    queue_id: r.queue_id,
    champion_id: r.champion_id,
    win: r.win,
    kills: r.kills,
    deaths: r.deaths,
    assists: r.assists,
  });

  const bests: Record<string, { value: number; match: any } | null> = {
    kills: null,
    deaths: null,
    assists: null,
    kda: null,
    score: null,
    killingSpree: null,
    damage: null,
    damageTaken: null,
    healing: null,
    gold: null,
    fastestWin: null,
    longestGame: null,
  };
  // What each record is ranked on, where that differs from the value the card
  // shows: the score displays the clamped 1-10 number and ranks on the raw one.
  const ranks: Record<string, number> = {};
  const track = (
    key: string,
    value: number | null,
    row: any,
    better = higher,
    rank: number | null = value,
  ) => {
    if (value == null || rank == null) return;
    if (!bests[key] || better(rank, ranks[key])) {
      bests[key] = { value, match: matchOf(row) };
      ranks[key] = rank;
    }
  };

  interface Streak {
    length: number;
    start: number;
    end: number;
    match: any;
  }
  let winStreak: Streak | null = null;
  let lossStreak: Streak | null = null;
  let run: { win: number; length: number; start: number } | null = null;

  for (const r of rows) {
    track("kills", r.kills, r);
    track("deaths", r.deaths, r);
    track("assists", r.assists, r);
    // Deathless games rank by kills+assists rather than dividing by zero; the
    // renderer still labels them "Perfect"
    track("kda", (r.kills + r.assists) / Math.max(r.deaths, 1), r);
    track("score", r.score, r, higher, r.score_raw ?? r.score);
    track("killingSpree", r.largest_killing_spree, r);
    track("damage", r.total_damage_dealt, r);
    track("damageTaken", r.total_damage_taken, r);
    track("healing", r.total_heal, r);
    track("gold", r.gold_earned, r);
    if (r.win) track("fastestWin", r.game_duration, r, lower);
    track("longestGame", r.game_duration, r);

    // Remakes never make it into rows, so they can't break a streak
    if (!run || run.win !== r.win) {
      run = { win: r.win, length: 0, start: r.game_creation };
    }
    run.length++;
    const record: Streak = {
      length: run.length,
      start: run.start,
      end: r.game_creation,
      match: matchOf(r),
    };
    if (r.win) {
      if (!winStreak || run.length > winStreak.length) winStreak = record;
    } else {
      if (!lossStreak || run.length > lossStreak.length) lossStreak = record;
    }
  }

  return { totalGames: rows.length, bests, winStreak, lossStreak };
}

// ---- Challenges ----

// The whole payload plus one history row per challenge, in a single
// transaction: a snapshot that recorded half its challenges would show up later
// as a week of progress that never happened.
export function saveChallenges(
  day: string,
  payload: string,
  values: { id: number; value: number; level: string }[],
): void {
  const writeState = db.prepare(
    "INSERT OR REPLACE INTO challenge_state (id, payload, fetched_at) VALUES (1, ?, ?)",
  );
  // Last read of the day wins, so today's row keeps pace with the live numbers
  // while older days stay as they were.
  const writeHistory = db.prepare(
    "INSERT OR REPLACE INTO challenge_history (day, challenge_id, value, level) VALUES (?, ?, ?, ?)",
  );
  db.transaction(() => {
    writeState.run(payload, Date.now());
    for (const entry of values) writeHistory.run(day, entry.id, entry.value, entry.level);
  })();
}

export function getStoredChallenges(): { payload: string; fetched_at: number } | null {
  const row = db.prepare("SELECT payload, fetched_at FROM challenge_state WHERE id = 1").get() as
    | { payload: string; fetched_at: number }
    | undefined;
  return row ?? null;
}

/**
 * The newest snapshot taken on or before `cutoff`, as a value per challenge.
 *
 * Deltas all measure from one day rather than from each challenge's own last
 * reading, so "+312 since Tuesday" means the same thing on every row. Until the
 * history reaches back as far as `cutoff` this falls back to the oldest day
 * recorded, so the first week of tracking still says something; only `today`
 * itself is refused, since measuring progress from now is measuring nothing.
 */
export function getChallengeBaseline(
  cutoff: string,
  today: string,
): { day: string; values: Record<number, number> } | null {
  const dayRow = (db
    .prepare("SELECT day FROM challenge_history WHERE day <= ? ORDER BY day DESC LIMIT 1")
    .get(cutoff) ??
    db.prepare("SELECT MIN(day) as day FROM challenge_history WHERE day < ?").get(today)) as
    | { day: string | null }
    | undefined;
  if (!dayRow?.day) return null;

  const rows = db
    .prepare("SELECT challenge_id, value FROM challenge_history WHERE day = ?")
    .all(dayRow.day) as { challenge_id: number; value: number }[];
  const values: Record<number, number> = {};
  for (const row of rows) values[row.challenge_id] = row.value;
  return { day: dayRow.day, values };
}

export function saveGameChallenges(gameId: number, rows: RecapChallenge[]): void {
  const insert = db.prepare(`
    INSERT OR REPLACE INTO challenge_game_progress
      (game_id, challenge_id, name, description, previous_value, current_value,
       previous_level, current_level, next_level, next_threshold, icon_path)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  db.transaction(() => {
    for (const row of rows) {
      insert.run(
        gameId,
        row.id,
        row.name,
        row.description,
        row.previousValue,
        row.currentValue,
        row.previousLevel,
        row.currentLevel,
        row.nextLevel,
        row.nextThreshold,
        row.iconPath,
      );
    }
  })();
}

export function hasGameChallenges(gameId: number): boolean {
  return (
    db.prepare("SELECT 1 FROM challenge_game_progress WHERE game_id = ? LIMIT 1").get(gameId) !=
    null
  );
}

// A tier earned is the headline, so those come first; the rest keep the order
// the client listed them in.
function getGameChallenges(gameId: number): any[] {
  return db
    .prepare(`
      SELECT challenge_id, name, description, previous_value, current_value,
             previous_level, current_level, next_level, next_threshold, icon_path
      FROM challenge_game_progress
      WHERE game_id = ?
      ORDER BY (previous_level = current_level), challenge_id
    `)
    .all(gameId);
}

// ---- Live game support ----

// Which ARAM map a game was rolled onto, learned from the running game and
// remembered so the recap can still name it once the match is over.
export function setGameMap(gameId: number, mapId: number | null, mapSkin: string): void {
  db.prepare("INSERT OR REPLACE INTO match_maps (game_id, map_id, map_skin) VALUES (?, ?, ?)").run(
    gameId,
    mapId,
    mapSkin,
  );
}

export function getGameMapName(gameId: number): string | null {
  const row = db.prepare("SELECT map_skin FROM match_maps WHERE game_id = ?").get(gameId) as
    | { map_skin: string }
    | undefined;
  return mapNameForSkin(row?.map_skin);
}

// The icon the account who played a game was wearing at the time, which is what
// a picture of that game should carry. Games imported before the participant
// rows recorded one fall back to the account's icon as it stands now.
export function getGameProfileIcon(gameId: number): number | null {
  const game = db.prepare("SELECT puuid FROM games WHERE game_id = ?").get(gameId) as
    | { puuid: string }
    | undefined;
  if (!game?.puuid) return null;

  const played = db
    .prepare("SELECT profile_icon FROM match_participants WHERE game_id = ? AND puuid = ?")
    .get(gameId, game.puuid) as { profile_icon: number | null } | undefined;
  if (played?.profile_icon != null) return played.profile_icon;

  const account = db.prepare("SELECT profile_icon FROM summoner WHERE puuid = ?").get(game.puuid) as
    | { profile_icon: number | null }
    | undefined;
  return account?.profile_icon ?? null;
}

// A player to look up, however much of their identity we have. The in-game API
// gives names and no puuid; the client gives puuids and sometimes no name.
export interface PlayerRef {
  key: string;
  puuid: string | null;
  gameName: string | null;
  tagLine: string | null;
  championId: number;
}

export interface PlayerHistory {
  // Their line on the champion they're playing now, and across every champion
  champion: PlayerRecord | null;
  overall: PlayerRecord | null;
  // Games on our own team, this one included
  withUs: number;
  // Set once there are enough shared games for the Friends page to hold them
  friendKey: string | null;
}

// Lowercased so a riot id that comes back in different casing from two sources
// still matches, which it does: the client and the game disagree about it.
function playerNameKey(gameName: string | null, tagLine: string | null): string | null {
  if (!gameName) return null;
  return `${gameName}#${tagLine ?? ""}`.toLowerCase();
}

const NAME_KEY_SQL = "lower(%.game_name) || '#' || lower(COALESCE(%.tag_line, ''))";

// Matches rows belonging to any of the given players, by puuid where we have
// one and by riot id otherwise. Older stored games predate puuids entirely, so
// a player can own rows found only by name and rows found only by puuid.
function playerMatchClause(alias: string, players: PlayerRef[], params: any[]): string | null {
  const puuids = [...new Set(players.map((p) => p.puuid).filter((p): p is string => !!p))];
  const names = [
    ...new Set(
      players
        .map((p) => playerNameKey(p.gameName, p.tagLine))
        .filter((n): n is string => n !== null),
    ),
  ];

  const clauses: string[] = [];
  if (puuids.length > 0) {
    clauses.push(`${alias}.puuid IN (${puuids.map(() => "?").join(", ")})`);
    params.push(...puuids);
  }
  if (names.length > 0) {
    clauses.push(`${NAME_KEY_SQL.replaceAll("%", alias)} IN (${names.map(() => "?").join(", ")})`);
    params.push(...names);
  }
  return clauses.length > 0 ? `(${clauses.join(" OR ")})` : null;
}

function emptyRecord(): PlayerRecord {
  return { games: 0, wins: 0, kills: 0, deaths: 0, assists: 0, lastPlayed: 0 };
}

/**
 * What this app has seen of a handful of players, keyed by the caller's own
 * key. Everyone in a random lobby is a stranger, so most of these come back
 * empty, and the ones that don't are the point: a friend's record on the
 * champion they just locked in.
 */
export function getPlayerHistories(players: PlayerRef[]): Record<string, PlayerHistory> {
  const histories: Record<string, PlayerHistory> = {};
  if (players.length === 0) return histories;

  const params: any[] = [];
  const match = playerMatchClause("mp", players, params);
  // Nothing identifiable to look up, which is every player in a game the
  // client has stopped reporting names for
  if (!match) return histories;

  const where = [match, "mp.is_remake = 0"];
  applyQueueFilter(where, params, undefined, "mp");

  const rows = db
    .prepare(`
      SELECT mp.puuid, mp.game_name, mp.tag_line, mp.champion_id,
             COUNT(*) AS games, SUM(mp.win) AS wins,
             SUM(mp.kills) AS kills, SUM(mp.deaths) AS deaths, SUM(mp.assists) AS assists,
             MAX(g.game_creation) AS last_played
      FROM match_participants mp
      JOIN games g ON g.game_id = mp.game_id
      WHERE ${where.join(" AND ")}
      GROUP BY mp.puuid, lower(mp.game_name), lower(COALESCE(mp.tag_line, '')), mp.champion_id
    `)
    .all(...params) as {
    puuid: string | null;
    game_name: string | null;
    tag_line: string | null;
    champion_id: number;
    games: number;
    wins: number;
    kills: number;
    deaths: number;
    assists: number;
    last_played: number;
  }[];

  const byPuuid = new Map<string, PlayerRef>();
  const byName = new Map<string, PlayerRef>();
  for (const player of players) {
    if (player.puuid) byPuuid.set(player.puuid, player);
    const name = playerNameKey(player.gameName, player.tagLine);
    if (name) byName.set(name, player);
  }
  const ownerOf = (row: {
    puuid: string | null;
    game_name: string | null;
    tag_line: string | null;
  }) => {
    if (row.puuid) {
      const match = byPuuid.get(row.puuid);
      if (match) return match;
    }
    const name = playerNameKey(row.game_name, row.tag_line);
    return name ? (byName.get(name) ?? null) : null;
  };

  for (const row of rows) {
    const owner = ownerOf(row);
    if (!owner) continue;

    const history = (histories[owner.key] ??= {
      champion: null,
      overall: null,
      withUs: 0,
      friendKey: null,
    });

    const overall = (history.overall ??= emptyRecord());
    const targets =
      owner.championId && row.champion_id === owner.championId
        ? [overall, (history.champion ??= emptyRecord())]
        : [overall];
    for (const target of targets) {
      target.games += row.games;
      target.wins += row.wins;
      target.kills += row.kills;
      target.deaths += row.deaths;
      target.assists += row.assists;
      target.lastPlayed = Math.max(target.lastPlayed, row.last_played);
    }
  }

  // Games on our own side, which is what the Friends page counts and the only
  // number that says whether a name in the lobby is someone we know.
  const ours = getAllPuuids();
  if (ours.length > 0) {
    const teamParams: any[] = [];
    const teamMatch = playerMatchClause("o", players, teamParams);
    if (teamMatch) {
      const ourList = ours.map(() => "?").join(", ");
      const teamWhere = [
        teamMatch,
        "o.is_remake = 0",
        `(o.puuid IS NULL OR o.puuid NOT IN (${ourList}))`,
      ];
      teamParams.push(...ours);
      applyQueueFilter(teamWhere, teamParams, undefined, "o");

      const teamRows = db
        .prepare(`
          WITH our_teams AS (
            SELECT DISTINCT game_id, team_id FROM match_participants WHERE puuid IN (${ourList})
          )
          SELECT o.puuid, o.game_name, o.tag_line, COUNT(*) AS games
          FROM our_teams t
          JOIN match_participants o ON o.game_id = t.game_id AND o.team_id = t.team_id
          WHERE ${teamWhere.join(" AND ")}
          GROUP BY o.puuid, lower(o.game_name), lower(COALESCE(o.tag_line, ''))
        `)
        .all(...ours, ...teamParams) as {
        puuid: string | null;
        game_name: string | null;
        tag_line: string | null;
        games: number;
      }[];

      for (const row of teamRows) {
        const owner = ownerOf(row);
        if (!owner) continue;
        const history = (histories[owner.key] ??= {
          champion: null,
          overall: null,
          withUs: 0,
          friendKey: null,
        });
        history.withUs += row.games;
        // Built from the stored row rather than from the lobby, so it matches
        // the key the Friends page routes on even when the client spells the
        // riot id differently from the game that was recorded.
        if (history.withUs >= MIN_SHARED_GAMES) {
          history.friendKey =
            row.puuid || displayName(row.game_name, row.tag_line) || history.friendKey;
        }
      }
    }
  }

  return histories;
}

// ---- Post-game recap ----

// The biggest listed mark a running total passed on this game, or null for
// none. The largest wins so a game that crosses two at once reports the one
// worth reporting.
function crossedMark(before: number, after: number, marks: number[]): number | null {
  let best: number | null = null;
  for (const mark of marks) {
    if (before < mark && after >= mark && (best === null || mark > best)) best = mark;
  }
  return best;
}

// Repeating marks, for totals that keep climbing past any list worth writing.
function crossedStep(before: number, after: number, step: number): number | null {
  const mark = Math.floor(after / step) * step;
  return mark > 0 && before < mark ? mark : null;
}

interface PlacementDef {
  key: string;
  label: string;
  format: RecapPlacement["format"];
  good: boolean;
  value: (row: CareerRow) => number | null;
  // True when a is the better of the two, which for deaths and duration is
  // not the larger one
  better: (a: number, b: number) => boolean;
}

const higher = (a: number, b: number) => a > b;
const lower = (a: number, b: number) => a < b;

const PLACEMENTS: PlacementDef[] = [
  {
    key: "kills",
    label: "Kills",
    format: "int",
    good: true,
    value: (r) => r.kills,
    better: higher,
  },
  {
    key: "kda",
    label: "KDA",
    format: "kda",
    good: true,
    // Deathless games rank by kills plus assists rather than dividing by zero,
    // the same way the Records page ranks them
    value: (r) => (r.kills + r.assists) / Math.max(r.deaths, 1),
    better: higher,
  },
  {
    key: "score",
    label: "Score",
    format: "score",
    good: true,
    value: (r) => r.score,
    better: higher,
  },
  {
    key: "assists",
    label: "Assists",
    format: "int",
    good: true,
    value: (r) => r.assists,
    better: higher,
  },
  {
    key: "killingSpree",
    label: "Killing spree",
    format: "int",
    good: true,
    value: (r) => r.largest_killing_spree,
    better: higher,
  },
  {
    key: "damage",
    label: "Damage dealt",
    format: "compact",
    good: true,
    value: (r) => r.total_damage_dealt,
    better: higher,
  },
  {
    key: "damageTaken",
    label: "Damage taken",
    format: "compact",
    good: true,
    value: (r) => r.total_damage_taken,
    better: higher,
  },
  {
    key: "healing",
    label: "Healing",
    format: "compact",
    good: true,
    value: (r) => r.total_heal,
    better: higher,
  },
  {
    key: "gold",
    label: "Gold earned",
    format: "compact",
    good: true,
    value: (r) => r.gold_earned,
    better: higher,
  },
  {
    key: "deaths",
    label: "Deaths",
    format: "int",
    good: false,
    value: (r) => r.deaths,
    better: higher,
  },
  {
    key: "fastestWin",
    label: "Fastest win",
    format: "duration",
    good: true,
    value: (r) => (r.win ? r.game_duration : null),
    better: lower,
  },
  {
    key: "longestGame",
    label: "Longest game",
    format: "duration",
    good: true,
    value: (r) => r.game_duration,
    better: higher,
  },
];

// Deep enough to be worth saying, shallow enough that a stat which happens to
// be ordinary doesn't get listed as though it weren't.
const MAX_PLACEMENT_RANK = 10;

function buildPlacements(rows: CareerRow[], row: CareerRow): RecapPlacement[] {
  const placements: RecapPlacement[] = [];

  for (const def of PLACEMENTS) {
    const value = def.value(row);
    if (value == null) continue;

    let rank = 1;
    let total = 0;
    for (const other of rows) {
      const otherValue = def.value(other);
      if (otherValue == null) continue;
      total++;
      // Strictly better only, so a tie shares the rank rather than pushing the
      // game down behind a game it matched
      if (other.game_id !== row.game_id && def.better(otherValue, value)) rank++;
    }
    if (rank <= MAX_PLACEMENT_RANK) {
      placements.push({
        key: def.key,
        label: def.label,
        value,
        rank,
        total,
        good: def.good,
        format: def.format,
      });
    }
  }

  return placements.sort((a, b) => a.rank - b.rank);
}

function buildMilestones(rows: CareerRow[], index: number): RecapMilestone[] {
  const row = rows[index];
  const milestones: RecapMilestone[] = [];
  const add = (key: string, label: string, detail: string) =>
    milestones.push({ key, label, detail });

  let wins = 0;
  let kills = 0;
  let mvps = 0;
  let pentas = 0;
  let quadras = 0;
  let champGames = 0;
  let champWins = 0;
  for (let i = 0; i <= index; i++) {
    const r = rows[i];
    wins += r.win;
    kills += r.kills;
    if (r.score_badge === "MVP") mvps++;
    pentas += r.penta_kills;
    quadras += r.quadra_kills;
    if (r.champion_id === row.champion_id) {
      champGames++;
      champWins += r.win;
    }
  }

  const games = index + 1;
  const gamesMark =
    crossedMark(games - 1, games, [10, 25, 50]) ?? crossedStep(games - 1, games, 100);
  if (gamesMark) add("games", `${ordinal(gamesMark)} game`, "Across every tracked account");

  const winsMark =
    crossedMark(wins - row.win, wins, [10, 25, 50]) ?? crossedStep(wins - row.win, wins, 100);
  if (winsMark) add("wins", `${ordinal(winsMark)} win`, "Career wins");

  const killsMark = crossedStep(kills - row.kills, kills, 1000);
  if (killsMark)
    add("kills", `${killsMark.toLocaleString()} career kills`, "Every game, every champion");

  if (champGames === 1) {
    add("champion-first", "First game on this champion", "A new name on the list");
  } else {
    const champMark = crossedMark(champGames - 1, champGames, [5, 10, 25, 50, 100, 200]);
    if (champMark)
      add(
        "champion-games",
        `${ordinal(champMark)} game on this champion`,
        "Career games on this pick",
      );
  }

  const champWinMark = crossedMark(champWins - row.win, champWins, [5, 10, 25, 50, 100]);
  if (champWinMark)
    add(
      "champion-wins",
      `${ordinal(champWinMark)} win on this champion`,
      "Career wins on this pick",
    );

  if (row.penta_kills > 0) {
    add(
      "penta",
      pentas === row.penta_kills ? "First pentakill" : `${ordinal(pentas)} pentakill`,
      "The rarest one",
    );
  } else if (row.quadra_kills > 0 && quadras === row.quadra_kills) {
    add("quadra", "First quadra kill", "So close");
  }

  if (row.score_badge === "MVP") {
    const mvpMark =
      crossedMark(mvps - 1, mvps, [1, 5, 10, 25, 50]) ?? crossedStep(mvps - 1, mvps, 50);
    if (mvpMark === 1) add("mvp", "First MVP", "Best player on the winning team");
    else if (mvpMark) add("mvp", `${ordinal(mvpMark)} MVP`, "Best player on the winning team");
  }

  return milestones;
}

// The streak this game leaves us on, and whether it is the longest of its kind
// on record. A single loss is a streak of one, which is honest: the page says
// "1 loss" rather than pretending nothing is happening.
function buildStreak(rows: CareerRow[], index: number): RecapStreak {
  let length = 0;
  const kind = rows[index].win ? "win" : "loss";
  for (let i = index; i >= 0 && rows[i].win === rows[index].win; i--) length++;

  let best = 0;
  let run = 0;
  for (let i = 0; i < rows.length; i++) {
    run = i > 0 && rows[i].win === rows[i - 1].win ? run + 1 : 1;
    if (rows[i].win === rows[index].win && run > best) best = run;
  }

  return { kind, length, best, isRecord: length >= best && length > 1 };
}

/**
 * Everything the post-game page says about one match: the match itself, where
 * its numbers land among every game on record, what the day looks like around
 * it, and which marks it moved past.
 *
 * Placements are all-time, since "where it lands among your records" is a
 * question about the library as it stands. Milestones are as of the game,
 * because crossing a mark only happens once and happened then.
 */
export function getGameRecap(gameId?: number): any {
  const rows = careerRows();
  const id = gameId ?? rows[rows.length - 1]?.game_id;
  if (id == null) return null;

  const detail = getMatchDetail(id);
  if (!detail) return null;

  // A remake is in no aggregate anywhere, so it has no placements, no
  // milestones and no streak. Everything else on the page still works.
  const index = rows.findIndex((r) => r.game_id === id);
  const row = index >= 0 ? rows[index] : null;

  const day = sessionDay(detail.game.game_creation);
  const sessionRows = rows.filter((r) => sessionDay(r.game_creation) === day);
  const session = {
    day,
    index: sessionRows.findIndex((r) => r.game_id === id),
    games: sessionRows.map(
      (r): RecapSessionGame => ({
        game_id: r.game_id,
        game_creation: r.game_creation,
        game_duration: r.game_duration,
        champion_id: r.champion_id,
        win: r.win,
        kills: r.kills,
        deaths: r.deaths,
        assists: r.assists,
        score: r.score,
      }),
    ),
    wins: 0,
    losses: 0,
    kills: 0,
    deaths: 0,
    assists: 0,
    avgScore: null as number | null,
    duration: 0,
  };
  let sessionScore = 0;
  let sessionScored = 0;
  for (const r of sessionRows) {
    if (r.win) session.wins++;
    else session.losses++;
    session.kills += r.kills;
    session.deaths += r.deaths;
    session.assists += r.assists;
    session.duration += r.game_duration;
    if (r.score != null) {
      sessionScore += r.score;
      sessionScored++;
    }
  }
  if (sessionScored > 0) session.avgScore = sessionScore / sessionScored;

  const championId = detail.stats?.champion_id ?? 0;
  const championRows = rows.filter((r) => r.champion_id === championId);
  const champion = {
    championId,
    games: championRows.length,
    wins: 0,
    kills: 0,
    deaths: 0,
    assists: 0,
    avgScore: null as number | null,
    previousBest: null as number | null,
    firstTime:
      row != null && championRows.filter((r) => r.game_creation <= row.game_creation).length === 1,
  };
  let champScore = 0;
  let champScored = 0;
  for (const r of championRows) {
    champion.wins += r.win;
    champion.kills += r.kills;
    champion.deaths += r.deaths;
    champion.assists += r.assists;
    if (r.score != null) {
      champScore += r.score;
      champScored++;
      if (r.game_id !== id && (champion.previousBest == null || r.score > champion.previousBest)) {
        champion.previousBest = r.score;
      }
    }
  }
  if (champScored > 0) champion.avgScore = champScore / champScored;

  const career = {
    games: rows.length,
    wins: 0,
    avgScore: null as number | null,
    avgKills: 0,
    avgDeaths: 0,
    avgAssists: 0,
    avgDamage: 0,
    avgTaken: 0,
    avgHeal: 0,
    avgGold: 0,
  };
  let careerScore = 0;
  let careerScored = 0;
  for (const r of rows) {
    career.wins += r.win;
    career.avgKills += r.kills;
    career.avgDeaths += r.deaths;
    career.avgAssists += r.assists;
    career.avgDamage += r.total_damage_dealt;
    career.avgTaken += r.total_damage_taken;
    career.avgHeal += r.total_heal;
    career.avgGold += r.gold_earned;
    if (r.score != null) {
      careerScore += r.score;
      careerScored++;
    }
  }
  if (rows.length > 0) {
    for (const key of [
      "avgKills",
      "avgDeaths",
      "avgAssists",
      "avgDamage",
      "avgTaken",
      "avgHeal",
      "avgGold",
    ] as const) {
      career[key] /= rows.length;
    }
  }
  if (careerScored > 0) career.avgScore = careerScore / careerScored;

  const challenges = getGameChallenges(id).map(
    (c): RecapChallenge => ({
      id: c.challenge_id,
      name: c.name,
      description: c.description,
      previousValue: c.previous_value,
      currentValue: c.current_value,
      previousLevel: c.previous_level,
      currentLevel: c.current_level,
      nextLevel: c.next_level,
      nextThreshold: c.next_threshold,
      iconPath: c.icon_path,
    }),
  );

  const milestones = row ? buildMilestones(rows, index) : [];
  // The S- challenge counts champions, not grades, so it only moves on one a
  // champion has never earned before. A game that moved it is that game.
  const firstSGrade = challenges.find(
    (c) => c.id === ARAM_S_GRADE_CHALLENGE_ID && c.currentValue > c.previousValue,
  );
  if (firstSGrade) {
    milestones.push({
      key: "challenge-s-grade",
      label: "First S on this champion",
      detail: `${firstSGrade.name}: ${firstSGrade.currentValue} champions`,
    });
  }

  return {
    detail,
    mapName: getGameMapName(id),
    score: detail.stats?.score ?? null,
    scoreBadge: detail.stats?.score_badge ?? null,
    placements: row ? buildPlacements(rows, row) : [],
    milestones,
    session,
    streak: row ? buildStreak(rows, index) : null,
    champion,
    career,
    challenges,
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
// building the whole backup in memory. Two reasons: a library of a few thousand
// games is a hundred megabytes-plus of JSON to hold twice over, and every await
// here returns the main process to the event loop, so the window keeps painting
// while the export runs.
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
      SELECT game_id, raw_gz, puuid
      FROM games
      WHERE raw_gz IS NOT NULL AND game_id > ?
      ORDER BY game_id
      LIMIT ?
    `);

    let lastId = 0;
    for (;;) {
      const rows = page.all(lastId, EXPORT_PAGE_SIZE) as {
        game_id: number;
        raw_gz: Buffer;
        puuid: string;
      }[];
      if (rows.length === 0) break;

      let chunk = "";
      for (const row of rows) {
        // A backup stays the untouched payloads, so an import into any version
        // rebuilds whatever that version derives from them.
        const game = unpackRaw(row.raw_gz);
        if (!game) continue;
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

// Rebuild everything derived from the participant rows for each game's current
// owner: player_stats (champion, KDA, items), augments, the remake flag, and
// the score under the current formula. Heals games whose owner puuid changed
// during repair (their stored stats still described the old participant) and
// doubles as a manual "rescore now" for formula changes.
function rebuildDerivedStats(): number {
  const games = db
    .prepare(`
      SELECT g.game_id, g.puuid, g.game_duration,
             ps.champion_id, ps.kills, ps.deaths, ps.assists
      FROM games g
      LEFT JOIN player_stats ps ON g.game_id = ps.game_id
    `)
    .all() as {
    game_id: number;
    puuid: string;
    game_duration: number;
    champion_id: number | null;
    kills: number | null;
    deaths: number | null;
    assists: number | null;
  }[];

  const participants = groupByGame(
    db
      .prepare(`
        SELECT game_id, ${SCORE_ROW_COLUMNS}, early_surrender, largest_killing_spree,
               spell1, spell2, item0, item1, item2, item3, item4, item5, item6
        FROM match_participants
      `)
      .all() as (ScoreRow & {
      game_id: number;
      early_surrender: number;
      largest_killing_spree: number;
      spell1: number | null;
      spell2: number | null;
      item0: number | null;
      item1: number | null;
      item2: number | null;
      item3: number | null;
      item4: number | null;
      item5: number | null;
      item6: number | null;
    })[],
  );

  const augmentsByGame = groupByGame(
    db
      .prepare("SELECT game_id, participant_id, slot, augment_id FROM match_participant_augments")
      .all() as {
      game_id: number;
      participant_id: number;
      slot: number;
      augment_id: number;
    }[],
  );

  const upsertStats = db.prepare(`
    INSERT OR REPLACE INTO player_stats (
      game_id, champion_id, win, kills, deaths, assists,
      double_kills, triple_kills, quadra_kills, penta_kills,
      total_damage_dealt, total_damage_taken, gold_earned, total_heal,
      largest_killing_spree, spell1, spell2,
      item0, item1, item2, item3, item4, item5, item6,
      score, score_raw, score_badge
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const updateRemake = db.prepare("UPDATE games SET is_remake = ? WHERE game_id = ?");
  const deleteAugments = db.prepare("DELETE FROM game_augments WHERE game_id = ?");
  const insertAugment = db.prepare(
    "INSERT OR IGNORE INTO game_augments (game_id, slot, augment_id) VALUES (?, ?, ?)",
  );

  let rebuilt = 0;
  const tx = db.transaction(() => {
    for (const row of games) {
      const rows = participants.get(row.game_id);
      if (!rows || rows.length === 0) continue;

      let owner = row.puuid ? rows.find((p) => p.puuid === row.puuid) : undefined;
      // Owner puuid unknown (old imports): fall back to matching the stored
      // stats row, same as the puuid backfill migration.
      if (!owner && row.champion_id != null) {
        owner = rows.find(
          (p) =>
            p.champion_id === row.champion_id &&
            p.kills === row.kills &&
            p.deaths === row.deaths &&
            p.assists === row.assists,
        );
      }
      if (!owner) continue;

      // Writing is_remake fires trg_games_denorm_participants, which carries
      // the new value down to the participant rows.
      const isRemake = detectRemake(row.game_duration, rows) ? 1 : 0;
      updateRemake.run(isRemake, row.game_id);

      let ownerScore: PlayerScore | null = null;
      if (!isRemake) {
        ownerScore = computeOwnerScore(rows, row.puuid || null, {
          champion_id: owner.champion_id,
          kills: owner.kills,
          deaths: owner.deaths,
          assists: owner.assists,
        });
      }

      upsertStats.run(
        row.game_id,
        owner.champion_id,
        owner.win,
        owner.kills,
        owner.deaths,
        owner.assists,
        owner.double_kills,
        owner.triple_kills,
        owner.quadra_kills,
        owner.penta_kills,
        owner.total_damage_dealt,
        owner.total_damage_taken,
        owner.gold_earned,
        owner.total_heal,
        owner.largest_killing_spree,
        owner.spell1,
        owner.spell2,
        owner.item0,
        owner.item1,
        owner.item2,
        owner.item3,
        owner.item4,
        owner.item5,
        owner.item6,
        ownerScore?.score ?? null,
        ownerScore?.raw ?? null,
        ownerScore?.badge ?? null,
      );

      deleteAugments.run(row.game_id);
      for (const aug of augmentsByGame.get(row.game_id) ?? []) {
        if (aug.participant_id === owner.participant_id) {
          insertAugment.run(row.game_id, aug.slot, aug.augment_id);
        }
      }
      rebuilt++;
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
  // Step 0: Re-derive the participant rows from the stored payloads. Everything
  // below reads those rows, so if they were the thing that went wrong — a game
  // that missed normalization, rows lost to a half-finished write — no later
  // step could see it, let alone fix it. The payloads are kept precisely so
  // this is recoverable, and Repair is where that recovery belongs.
  const { unusable } = rebuildParticipantsFromPayloads();
  if (unusable > 0) {
    console.warn(`Repair: ${unusable} stored payloads could not be read`);
  }

  // Step 1: Collect participant puuids per game. Bots and unresolved players
  // were already filtered to NULL on the way into match_participants.
  const rows = db
    .prepare(`
      SELECT mp.game_id, mp.puuid, mp.game_name, mp.tag_line, g.game_creation
      FROM match_participants mp
      JOIN games g ON g.game_id = mp.game_id
      WHERE mp.puuid IS NOT NULL
    `)
    .all() as {
    game_id: number;
    puuid: string;
    game_name: string | null;
    tag_line: string | null;
    game_creation: number;
  }[];

  const puuidToGames = new Map<string, Set<number>>();
  const gameToPuuids = new Map<number, Set<string>>();

  for (const row of rows) {
    let games = puuidToGames.get(row.puuid);
    if (!games) {
      games = new Set();
      puuidToGames.set(row.puuid, games);
    }
    games.add(row.game_id);

    let inGame = gameToPuuids.get(row.game_id);
    if (!inGame) {
      inGame = new Set();
      gameToPuuids.set(row.game_id, inGame);
    }
    inGame.add(row.puuid);
  }

  // Step 2: Sort puuids by frequency (most games first)
  const sortedPuuids = Array.from(puuidToGames.entries()).sort((a, b) => b[1].size - a[1].size);

  // Step 3: Settle which puuids are our accounts. The ones the client itself
  // reported are ours outright: upsertSummoner keeps the summoner and account
  // ids it hands over, which no account discovered here ever has. The rest are
  // taken greedily, most games first, and only if they never share a game with
  // an account already settled. That filters out friends, who always appear
  // alongside one of ours, while still finding alt accounts, which never share
  // a game with each other. A friend who played every one of an alt's games
  // ties with it on count, and only the client's word tells those two apart.
  const reported = db
    .prepare("SELECT puuid FROM summoner WHERE summoner_id IS NOT NULL OR account_id IS NOT NULL")
    .all() as { puuid: string }[];
  const userPuuids = new Set(
    reported.map((row) => row.puuid).filter((puuid) => puuidToGames.has(puuid)),
  );

  for (const [puuid, gameIds] of sortedPuuids) {
    if (userPuuids.has(puuid)) continue;
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

  // Step 4: Point each game at the account that played it. A recorded owner
  // that is one of our accounts and among the game's players stands; only a
  // game whose owner is missing or not in it takes the account found there.
  const ownerRows = db.prepare("SELECT game_id, puuid FROM games").all() as {
    game_id: number;
    puuid: string;
  }[];
  const owners = new Map(ownerRows.map((row) => [row.game_id, row.puuid]));
  const updateStmt = db.prepare("UPDATE games SET puuid = ? WHERE game_id = ?");
  let repairedGames = 0;

  const repairTx = db.transaction(() => {
    for (const [gameId, puuidsInGame] of gameToPuuids) {
      const owner = owners.get(gameId);
      if (owner && userPuuids.has(owner) && puuidsInGame.has(owner)) continue;
      for (const puuid of puuidsInGame) {
        if (userPuuids.has(puuid)) {
          updateStmt.run(puuid, gameId);
          repairedGames++;
          break;
        }
      }
    }
  });
  repairTx();

  // Step 5: Upsert discovered summoners using each account's most recent name
  const upsertStmt = db.prepare(`
    INSERT OR IGNORE INTO summoner (puuid, game_name, tag_line, summoner_id, account_id, updated_at)
    VALUES (?, ?, ?, NULL, NULL, ?)
  `);

  const latestNames = new Map<string, { name: string; tagLine: string | null; at: number }>();
  for (const row of rows) {
    if (!userPuuids.has(row.puuid) || !row.game_name) continue;
    const current = latestNames.get(row.puuid);
    if (!current || row.game_creation > current.at) {
      latestNames.set(row.puuid, {
        name: row.game_name,
        tagLine: row.tag_line,
        at: row.game_creation,
      });
    }
  }

  const summonerTx = db.transaction(() => {
    for (const puuid of userPuuids) {
      const latest = latestNames.get(puuid);
      upsertStmt.run(puuid, latest?.name ?? null, latest?.tagLine ?? null, Date.now());
    }
  });
  summonerTx();

  // Step 6: Rebuild stats, augments, remake flags, and scores now that game
  // ownership is settled.
  const rebuiltGames = rebuildDerivedStats();

  return { repairedGames, discoveredAccounts: userPuuids.size, rebuiltGames };
}
