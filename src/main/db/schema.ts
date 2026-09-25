import { AUGMENT_SLOTS } from "../../shared/queues";
import { db, openDatabase } from "./connection";
import { runMigrations, backfillAugmentSlots, migrateHiddenQueues } from "./migrations";
import { getSetting, setSetting } from "./settings";

export function initDatabase() {
  openDatabase();

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
