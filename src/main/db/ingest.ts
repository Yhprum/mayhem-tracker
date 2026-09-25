import type { PlayerScore } from "../../shared/opScore";
import { db } from "./connection";
import {
  type RawParticipantRow,
  participantRowsFromRaw,
  detectRemake,
  parsePatch,
  packRaw,
  writeParticipants,
} from "./payloads";
import { computeOwnerScore } from "./scoring";

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
