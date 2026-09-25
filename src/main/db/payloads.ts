import zlib from "zlib";
import { AUGMENT_SLOTS } from "../../shared/queues";
import Database from "better-sqlite3";
import { db } from "./connection";

// A match is ~30 KB of JSON and gzips to about an eighth of that, which is the
// difference between the blobs being most of the database and being a rounding
// error. Nothing reads them to answer a query — only export, and the one-time
// normalization in migrateToV2.

export function packRaw(raw: any): Buffer {
  return zlib.gzipSync(JSON.stringify(raw));
}

export function unpackRaw(blob: Buffer | null): any {
  if (!blob) return null;
  try {
    return JSON.parse(zlib.gunzipSync(blob).toString("utf8"));
  } catch {
    return null;
  }
}

// Riot hands us two shapes: the LCU's participants[i] + participantIdentities[i]
// pair, and SGP's flattened participant with its stats inline. Both are
// unpicked exactly once, here, on the way into match_participants — so no read
// path has to know the difference.
export interface RawParticipantRow {
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

export function participantRowsFromRaw(raw: any): RawParticipantRow[] {
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

interface ParticipantStatements {
  participant: Database.Statement;
  augment: Database.Statement;
  clearParticipants: Database.Statement;
  clearAugments: Database.Statement;
}

// Prepared statements belong to the connection that made them, so they're
// cached per connection: a reopened database prepares its own.
const participantStatementCache = new WeakMap<Database.Database, ParticipantStatements>();

function participantStatements(): ParticipantStatements {
  let stmts = participantStatementCache.get(db);
  if (!stmts) {
    stmts = {
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
    participantStatementCache.set(db, stmts);
  }
  return stmts;
}

// Replaces one game's participant rows wholesale. Callers are already inside a
// transaction; this deliberately isn't one, so a game and its participants
// commit together or not at all.
export function writeParticipants(
  gameId: number,
  meta: GameDenorm,
  rows: RawParticipantRow[],
): void {
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

// Payloads are read a page at a time wherever they're read in bulk: a library
// of a few thousand is a hundred megabytes-plus of JSON, far too much to hold
// in memory at once.
export const PAYLOAD_PAGE_SIZE = 200;

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
export function rebuildParticipantsFromPayloads(): NormalizeResult {
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

export function parsePatch(version: unknown): string | null {
  if (typeof version !== "string") return null;
  const m = version.match(/^(\d+)\.(\d+)/);
  return m ? `${m[1]}.${m[2]}` : null;
}

export function detectRemake(gameDuration: number, rows: { early_surrender: number }[]): boolean {
  // Very short games are always remakes
  if (gameDuration < 300) return true;
  // An early surrender still inside the first ten minutes counts as one too
  if (gameDuration < 600) return rows.some((r) => r.early_surrender === 1);
  return false;
}
