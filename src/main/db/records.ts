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

export function careerRows(queue?: number, account?: string): CareerRow[] {
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
export function getRecords(queue?: number, account?: string): RecordsData {
  const rows = careerRows(queue, account);

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
  // What each record is ranked on, where that differs from the value the card
  // shows: the score displays the clamped 1-10 number and ranks on the raw one.
  const ranks: Partial<Record<keyof RecordsData["bests"], number>> = {};
  const track = (
    key: keyof RecordsData["bests"],
    value: number | null,
    row: CareerRow,
    better = higher,
    rank: number | null = value,
  ) => {
    if (value == null || rank == null) return;
    if (!bests[key] || better(rank, ranks[key]!)) {
      bests[key] = { value, match: matchOf(row) };
      ranks[key] = rank;
    }
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
