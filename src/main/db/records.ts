import type { RecordsData, RecordMatchRef, StreakRecord } from "../../shared/api";
import { db } from "./connection";
import { applyQueueFilter } from "./filters";

// One row per counted game, oldest first: everything a whole-career walk needs
// and nothing it doesn't. Records and the post-game recap both read the library
// this way, and both depend on the order, since a streak and a milestone are
// only meaningful in the order the games were played.
export interface CareerRow {
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

// Which games a career walk counts. Every field is optional, and none at all is
// every game on every account in the visible queues.
export interface CareerFilter {
  queue?: number;
  // The account that owns the game, as every account filter reads it
  account?: string;
  // game_creation bounds, from inclusive and to exclusive, null for an open end
  from?: number | null;
  to?: number | null;
}

// The WHERE for those games, over games g joined to player_stats. Exported so a
// query that totals them up in SQL counts exactly the games careerRows walks.
export function careerWhere(filter: CareerFilter = {}): { sql: string; params: any[] } {
  const where = ["g.is_remake = 0"];
  const params: any[] = [];
  applyQueueFilter(where, params, filter.queue);
  if (filter.account) {
    where.push("g.puuid = ?");
    params.push(filter.account);
  }
  if (filter.from != null) {
    where.push("g.game_creation >= ?");
    params.push(filter.from);
  }
  if (filter.to != null) {
    where.push("g.game_creation < ?");
    params.push(filter.to);
  }
  return { sql: where.join(" AND "), params };
}

export function careerRows(filter: CareerFilter = {}): CareerRow[] {
  const where = careerWhere(filter);
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
      WHERE ${where.sql}
      ORDER BY g.game_creation ASC
    `)
    .all(...where.params) as CareerRow[];
}

export function getRecords(queue?: number, account?: string): RecordsData {
  return computeRecords(careerRows({ queue, account }));
}

// The trophy case: best single-game marks and longest streaks, from one
// chronological pass over our own rows — streaks need the ordering anyway, and
// the maxima fall out of the same loop. On ties the earliest game keeps the
// record, so a mark has to be strictly beaten to change hands. Takes the rows
// rather than reading them so a season recap can ask the same of its slice.
export function computeRecords(rows: CareerRow[]): RecordsData {
  // Just enough of the game to render a record's context and open its match
  const matchOf = (r: CareerRow): RecordMatchRef => ({
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

  const bests: RecordsData["bests"] = {
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
  const track = (
    key: keyof RecordsData["bests"],
    value: number | null,
    row: CareerRow,
    better = higher,
  ) => {
    if (value == null) return;
    const best = bests[key];
    if (!best || better(value, best.value)) bests[key] = { value, match: matchOf(row) };
  };

  let winStreak: StreakRecord | null = null;
  let lossStreak: StreakRecord | null = null;
  let run: { win: number; length: number; start: number } | null = null;

  for (const r of rows) {
    track("kills", r.kills, r);
    track("deaths", r.deaths, r);
    track("assists", r.assists, r);
    // Deathless games rank by kills+assists rather than dividing by zero; the
    // renderer still labels them "Perfect"
    track("kda", (r.kills + r.assists) / Math.max(r.deaths, 1), r);
    // Unclamped: every great game shows as 10, so the clamped score would make
    // the best of them indistinguishable from the rest
    track("score", r.score_raw ?? r.score, r);
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
    const record: StreakRecord = {
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

export const higher = (a: number, b: number) => a > b;

export const lower = (a: number, b: number) => a < b;
