import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import { app } from "electron";

let db: Database.Database;

function getDbPath() {
  // In development, use the project's data directory
  // In production, use app.getPath('userData')
  const isDev = !app.isPackaged;
  const dataDir = isDev
    ? path.join(__dirname, "..", "..", "data")
    : path.join(app.getPath("userData"), "data");
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  return path.join(dataDir, "matches.db");
}

export function initDatabase() {
  const dbPath = getDbPath();
  db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  createTables();
}

function createTables() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS games (
      game_id       INTEGER PRIMARY KEY,
      queue_id      INTEGER NOT NULL,
      game_mode     TEXT NOT NULL,
      game_creation INTEGER NOT NULL,
      game_duration INTEGER NOT NULL,
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
      puuid       TEXT PRIMARY KEY,
      game_name   TEXT,
      tag_line    TEXT,
      summoner_id INTEGER,
      account_id  INTEGER,
      updated_at  INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_games_creation ON games(game_creation DESC);
    CREATE INDEX IF NOT EXISTS idx_player_stats_champion ON player_stats(champion_id);
    CREATE INDEX IF NOT EXISTS idx_game_augments_augment ON game_augments(augment_id);
  `);
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

export function getMatchHistory(limit: number, offset: number): { matches: any[]; total: number } {
  const total = db.prepare("SELECT COUNT(*) as count FROM games").get() as any;
  const rows = db
    .prepare(`
    SELECT g.game_id, g.game_creation, g.game_duration, g.raw_json,
           ps.champion_id, ps.win, ps.kills, ps.deaths, ps.assists,
           ps.double_kills, ps.triple_kills, ps.quadra_kills, ps.penta_kills,
           ps.total_damage_dealt, ps.total_damage_taken, ps.total_heal, ps.gold_earned,
           ps.item0, ps.item1, ps.item2, ps.item3, ps.item4, ps.item5,
           (SELECT GROUP_CONCAT(ga.augment_id) FROM game_augments ga WHERE ga.game_id = g.game_id ORDER BY ga.slot) as augment_ids
    FROM games g
    JOIN player_stats ps ON g.game_id = ps.game_id
    ORDER BY g.game_creation DESC
    LIMIT ? OFFSET ?
  `)
    .all(limit, offset);
  const matches = rows.map((row: any) => {
    const maxStats = extractGameMaxStats(row.raw_json);
    const { raw_json, ...match } = row;
    return { ...match, ...maxStats };
  });
  return { matches, total: total.count };
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

export function getChampionStatsAll(): any[] {
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
      SUM(ps.double_kills) as double_kills,
      SUM(ps.triple_kills) as triple_kills,
      SUM(ps.quadra_kills) as quadra_kills,
      SUM(ps.penta_kills) as penta_kills
    FROM player_stats ps
    GROUP BY ps.champion_id
    ORDER BY games DESC
  `)
    .all();
}

export function getAugmentStatsAll(championId?: number): any[] {
  if (championId !== undefined) {
    return db
      .prepare(`
      SELECT ga.augment_id, COUNT(*) as picks, SUM(ps.win) as wins
      FROM game_augments ga
      JOIN player_stats ps ON ga.game_id = ps.game_id
      WHERE ps.champion_id = ?
      GROUP BY ga.augment_id
      ORDER BY picks DESC
    `)
      .all(championId);
  }
  return db
    .prepare(`
    SELECT ga.augment_id, COUNT(*) as picks, SUM(ps.win) as wins
    FROM game_augments ga
    JOIN player_stats ps ON ga.game_id = ps.game_id
    GROUP BY ga.augment_id
    ORDER BY picks DESC
  `)
    .all();
}

export function getDashboardData(): any {
  const totals = db
    .prepare(`
    SELECT COUNT(*) as totalGames,
           SUM(win) as wins,
           SUM(kills) as totalKills,
           SUM(deaths) as totalDeaths,
           SUM(assists) as totalAssists,
           SUM(double_kills) as doubles,
           SUM(triple_kills) as triples,
           SUM(quadra_kills) as quadras,
           SUM(penta_kills) as pentas
    FROM player_stats
  `)
    .get() as any;

  const recentForm = db
    .prepare(`
    SELECT ps.win, g.game_id
    FROM games g
    JOIN player_stats ps ON g.game_id = ps.game_id
    ORDER BY g.game_creation DESC
    LIMIT 10
  `)
    .all();

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
    GROUP BY ps.champion_id
    ORDER BY games DESC
    LIMIT 5
  `)
    .all();

  const topAugments = db
    .prepare(`
    SELECT ga.augment_id, COUNT(*) as picks, SUM(ps.win) as wins
    FROM game_augments ga
    JOIN player_stats ps ON ga.game_id = ps.game_id
    GROUP BY ga.augment_id
    ORDER BY picks DESC
    LIMIT 5
  `)
    .all();

  return {
    totalGames: totals.totalGames ?? 0,
    wins: totals.wins ?? 0,
    totalKills: totals.totalKills ?? 0,
    totalDeaths: totals.totalDeaths ?? 0,
    totalAssists: totals.totalAssists ?? 0,
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

export function getAugmentStatsWithChampions(): {
  augment_id: number;
  picks: number;
  wins: number;
  champions: { champion_id: number; picks: number; wins: number }[];
}[] {
  const augments = db
    .prepare(`
    SELECT ga.augment_id, COUNT(*) as picks, SUM(ps.win) as wins
    FROM game_augments ga
    JOIN player_stats ps ON ga.game_id = ps.game_id
    GROUP BY ga.augment_id
    ORDER BY picks DESC
  `)
    .all() as { augment_id: number; picks: number; wins: number }[];

  const champBreakdown = db
    .prepare(`
    SELECT ga.augment_id, ps.champion_id, COUNT(*) as picks, SUM(ps.win) as wins
    FROM game_augments ga
    JOIN player_stats ps ON ga.game_id = ps.game_id
    GROUP BY ga.augment_id, ps.champion_id
    ORDER BY picks DESC
  `)
    .all() as { augment_id: number; champion_id: number; picks: number; wins: number }[];

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
): { matches: any[]; total: number } {
  const total = db
    .prepare("SELECT COUNT(*) as count FROM player_stats WHERE champion_id = ?")
    .get(championId) as any;
  const rows = db
    .prepare(`
    SELECT g.game_id, g.game_creation, g.game_duration, g.raw_json,
           ps.champion_id, ps.win, ps.kills, ps.deaths, ps.assists,
           ps.double_kills, ps.triple_kills, ps.quadra_kills, ps.penta_kills,
           ps.total_damage_dealt, ps.total_damage_taken, ps.total_heal, ps.gold_earned,
           ps.item0, ps.item1, ps.item2, ps.item3, ps.item4, ps.item5,
           (SELECT GROUP_CONCAT(ga.augment_id) FROM game_augments ga WHERE ga.game_id = g.game_id ORDER BY ga.slot) as augment_ids
    FROM games g
    JOIN player_stats ps ON g.game_id = ps.game_id
    WHERE ps.champion_id = ?
    ORDER BY g.game_creation DESC
    LIMIT ? OFFSET ?
  `)
    .all(championId, limit, offset);
  const matches = rows.map((row: any) => {
    const maxStats = extractGameMaxStats(row.raw_json);
    const { raw_json, ...match } = row;
    return { ...match, ...maxStats };
  });
  return { matches, total: total.count };
}

export function gameExists(gameId: number): boolean {
  const row = db.prepare("SELECT 1 FROM games WHERE game_id = ?").get(gameId);
  return !!row;
}

export function insertGameFull(gameData: any, puuid: string): boolean {
  // Find participant
  let participant: any = null;
  if (gameData.participants) {
    participant = gameData.participants.find((p: any) => p.puuid === puuid);
    if (!participant && gameData.participantIdentities) {
      const identity = gameData.participantIdentities.find((pi: any) => pi.player?.puuid === puuid);
      if (identity) {
        participant = gameData.participants.find(
          (p: any) => p.participantId === identity.participantId,
        );
      }
    }
  }

  if (!participant) return false;

  const s = participant.stats || participant;

  const insertGameStmt = db.prepare(`
    INSERT OR IGNORE INTO games (game_id, queue_id, game_mode, game_creation, game_duration, raw_json)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  const insertStatsStmt = db.prepare(`
    INSERT OR IGNORE INTO player_stats (
      game_id, champion_id, win, kills, deaths, assists,
      double_kills, triple_kills, quadra_kills, penta_kills,
      total_damage_dealt, total_damage_taken, gold_earned, total_heal,
      largest_killing_spree, item0, item1, item2, item3, item4, item5, item6
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
    );

    // Augments
    for (let i = 1; i <= 4; i++) {
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
  db.prepare(`
    INSERT OR REPLACE INTO summoner (puuid, game_name, tag_line, summoner_id, account_id, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    summoner.puuid,
    summoner.displayName || summoner.gameName || summoner.internalName || summoner.game_name,
    summoner.tagLine || summoner.tag_line || null,
    summoner.summonerId ?? summoner.summoner_id,
    summoner.accountId ?? summoner.account_id,
    Date.now(),
  );
}

export function getSummoner(): any {
  return db.prepare("SELECT * FROM summoner LIMIT 1").get();
}

export function getTeammateStats(): any[] {
  const summoner = getSummoner();
  if (!summoner) return [];

  const games = db
    .prepare("SELECT game_id, raw_json, game_creation FROM games WHERE raw_json IS NOT NULL")
    .all() as any[];
  const puuid = summoner.puuid;

  const playerMap = new Map<
    string,
    {
      name: string;
      puuid: string | null;
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

    const participants = raw.participants || [];
    const identities = raw.participantIdentities || [];

    // Find our participant to get teamId
    let myTeamId: number | null = null;
    let myParticipantId: number | null = null;

    for (let i = 0; i < participants.length; i++) {
      const p = participants[i];
      const identity = identities[i];
      if (p.puuid === puuid || identity?.player?.puuid === puuid) {
        myTeamId = p.teamId || 100;
        myParticipantId = p.participantId;
        break;
      }
    }

    if (myTeamId === null) continue;

    // Collect teammates (same team, not self)
    for (let i = 0; i < participants.length; i++) {
      const p = participants[i];
      const identity = identities[i];
      const teamId = p.teamId || 100;

      if (teamId !== myTeamId) continue;
      if (p.puuid === puuid || identity?.player?.puuid === puuid) continue;
      if (p.participantId === myParticipantId) continue;

      const rawPuuid = p.puuid || identity?.player?.puuid || null;
      // Filter out placeholder/bot puuids
      const playerPuuid = rawPuuid && !/^0+(-0+)*$/.test(rawPuuid) ? rawPuuid : null;
      const gameName =
        identity?.player?.gameName || identity?.player?.summonerName || p.summonerName || null;
      const tagLine = identity?.player?.tagLine || null;
      const name = gameName ? (tagLine ? `${gameName}#${tagLine}` : gameName) : `Player ${i + 1}`;

      // Always prefer puuid as key
      const key = playerPuuid || name;
      const s = p.stats || p;

      // If we now have a puuid but previously tracked this player by name, merge
      if (playerPuuid && !playerMap.has(playerPuuid) && playerMap.has(name)) {
        const old = playerMap.get(name)!;
        if (!old.puuid) {
          playerMap.set(playerPuuid, old);
          old.puuid = playerPuuid;
          playerMap.delete(name);
        }
      }

      if (!playerMap.has(key)) {
        playerMap.set(key, {
          name,
          puuid: playerPuuid,
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
      // Update name to most recent version
      if (game.game_creation > entry.lastPlayed) {
        entry.name = name;
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

  return Array.from(playerMap.values())
    .map((p) => ({
      name: p.name,
      puuid: p.puuid,
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

export function getChampionItemStats(
  championId: number,
): { item_id: number; picks: number; wins: number }[] {
  return db
    .prepare(`
    SELECT item_id, COUNT(*) as picks, SUM(win) as wins
    FROM (
      SELECT item0 as item_id, win FROM player_stats WHERE champion_id = ? AND item0 IS NOT NULL AND item0 > 0
      UNION ALL
      SELECT item1, win FROM player_stats WHERE champion_id = ? AND item1 IS NOT NULL AND item1 > 0
      UNION ALL
      SELECT item2, win FROM player_stats WHERE champion_id = ? AND item2 IS NOT NULL AND item2 > 0
      UNION ALL
      SELECT item3, win FROM player_stats WHERE champion_id = ? AND item3 IS NOT NULL AND item3 > 0
      UNION ALL
      SELECT item4, win FROM player_stats WHERE champion_id = ? AND item4 IS NOT NULL AND item4 > 0
      UNION ALL
      SELECT item5, win FROM player_stats WHERE champion_id = ? AND item5 IS NOT NULL AND item5 > 0
      UNION ALL
      SELECT item6, win FROM player_stats WHERE champion_id = ? AND item6 IS NOT NULL AND item6 > 0
    )
    GROUP BY item_id
    ORDER BY picks DESC
  `)
    .all(
      championId,
      championId,
      championId,
      championId,
      championId,
      championId,
      championId,
    ) as any[];
}

export function getGlobalStats(): {
  champions: { champion_id: number; games: number; wins: number }[];
  augments: { augment_id: number; picks: number; wins: number }[];
  totalParticipantSlots: number;
} {
  const games = db.prepare("SELECT raw_json FROM games WHERE raw_json IS NOT NULL").all() as any[];

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

      for (let i = 1; i <= 4; i++) {
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

export function exportAllData(): {
  version: number;
  summoner: any | null;
  games: any[];
} {
  const summoner = getSummoner();
  const rows = db.prepare("SELECT raw_json FROM games WHERE raw_json IS NOT NULL").all() as {
    raw_json: string;
  }[];
  const games = rows.map((r) => JSON.parse(r.raw_json));
  return { version: 2, summoner, games };
}

export function importData(data: any): number {
  const puuid = data.summoner?.puuid;
  if (!puuid) return 0;
  upsertSummoner(data.summoner);
  let imported = 0;
  for (const game of data.games ?? []) {
    if (insertGameFull(game, puuid)) imported++;
  }
  return imported;
}
