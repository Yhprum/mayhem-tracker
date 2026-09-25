import type { PlayerScore } from "../../shared/opScore";
import { AUGMENT_SLOTS } from "../../shared/queues";
import { db } from "./connection";
import { detectRemake, rebuildParticipantsFromPayloads } from "./payloads";
import {
  groupByGame,
  SCORE_ROW_COLUMNS,
  type ScoreRow,
  computeOwnerScore,
  scoreFormulaKey,
} from "./scoring";
import { setSetting } from "./settings";

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
