import { QUEUE_ID_MAYHEM_CLASSIC } from "../../shared/queues";
import zlib from "zlib";
import { db } from "./connection";
import {
  PAYLOAD_PAGE_SIZE,
  rebuildParticipantsFromPayloads,
  participantRowsFromRaw,
  detectRemake,
  parsePatch,
} from "./payloads";
import { groupByGame } from "./scoring";
import { getSetting, setSetting } from "./settings";

// The old hide-Mayhem-Classic switch became a per-queue list. Carry the boolean
// over once; writing the key even when nothing was hidden is what keeps this
// from firing again after the user switches every queue back on.
export function migrateHiddenQueues() {
  if (getSetting("hidden_queues") !== null) return;
  const hidClassic = getSetting("hide_classic_games") === "true";
  setSetting("hidden_queues", hidClassic ? String(QUEUE_ID_MAYHEM_CLASSIC) : "");
}

// Stamped in PRAGMA user_version. Version 0 means the database predates
// versioning, so it could be missing any subset of the columns v1 adds — which
// is why each step checks for its column rather than assuming. A database that
// createTables just built is also version 0, and lands on the same no-op path.
const SCHEMA_VERSION = 4;

function tableColumns(table: string): Set<string> {
  const rows = db.pragma(`table_info(${table})`) as { name: string }[];
  return new Set(rows.map((r) => r.name));
}

export function runMigrations() {
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
export function backfillAugmentSlots() {
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
