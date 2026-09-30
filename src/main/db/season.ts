import type {
  AugmentStats,
  ItemStats,
  SeasonChampion,
  SeasonDay,
  SeasonPlayer,
  SeasonRecap,
  SeasonSummary,
} from "../../shared/api";
import { ALL_TIME_ID, SEASONS, findSeason, seasonBounds } from "../../shared/seasons";
import { addDays, sessionDay } from "../../shared/session";
import { db } from "./connection";
import { type CareerFilter, careerRows, careerWhere, computeRecords } from "./records";
import { EXCLUDED_ITEMS_SQL, ITEM_SLOTS, itemSlotUnion } from "./stats";
import { getTeammateStats } from "./teammates";

const TOP_CHAMPIONS = 6;
const TOP_AUGMENTS = 6;
// Deep enough that setting the boots aside still leaves a full list
const TOP_ITEMS = 20;
const TOP_FRIENDS = 5;

type Where = ReturnType<typeof careerWhere>;

// Index of the largest count, the earliest one winning a tie; null when every
// count is zero
function busiest(counts: number[]): number | null {
  let best: number | null = null;
  for (let i = 0; i < counts.length; i++) {
    if (counts[i] > 0 && (best == null || counts[i] > counts[best])) best = i;
  }
  return best;
}

// Days come in order, so a run carries on through each day that follows
// straight on from the one before it
function longestStreak(days: SeasonDay[]): SeasonRecap["dayStreak"] {
  let best: SeasonRecap["dayStreak"] = null;
  let previous: number | null = null;
  let from = 0;
  let length = 0;
  for (const { day } of days) {
    if (previous != null && addDays(previous, 1) === day) {
      length++;
    } else {
      from = day;
      length = 1;
    }
    previous = day;
    if (!best || length > best.days) best = { days: length, from, to: day };
  }
  return best;
}

// Averaged per game rather than pooled, the same way the Total Stats page
// measures a champion's share, so a stomp doesn't count for more than a close
// one.
function teamShares(where: Where): {
  killParticipation: number | null;
  damageShare: number | null;
} {
  return db
    .prepare(`
      WITH mine AS (
        SELECT mp.game_id, mp.team_id, mp.kills, mp.assists, mp.total_damage_dealt
        FROM games g
        JOIN player_stats ps ON ps.game_id = g.game_id
        JOIN match_participants mp ON mp.game_id = g.game_id AND mp.puuid = g.puuid
        WHERE ${where.sql}
      ),
      teams AS (
        SELECT mp.game_id, mp.team_id,
               SUM(mp.kills) as team_kills,
               SUM(mp.total_damage_dealt) as team_damage
        FROM mine m
        JOIN match_participants mp ON mp.game_id = m.game_id AND mp.team_id = m.team_id
        GROUP BY mp.game_id, mp.team_id
      )
      SELECT AVG(CASE WHEN t.team_kills > 0
                      THEN (m.kills + m.assists) * 1.0 / t.team_kills END) as killParticipation,
             AVG(CASE WHEN t.team_damage > 0
                      THEN m.total_damage_dealt * 1.0 / t.team_damage END) as damageShare
      FROM mine m
      JOIN teams t ON t.game_id = m.game_id AND t.team_id = m.team_id
    `)
    .get(...where.params) as { killParticipation: number | null; damageShare: number | null };
}

function topAugments(where: Where): AugmentStats[] {
  return db
    .prepare(`
      SELECT ga.augment_id, COUNT(*) as picks, SUM(ps.win) as wins
      FROM game_augments ga
      JOIN games g ON g.game_id = ga.game_id
      JOIN player_stats ps ON ps.game_id = g.game_id
      WHERE ${where.sql}
      GROUP BY ga.augment_id
      ORDER BY picks DESC, wins DESC, ga.augment_id
      LIMIT ?
    `)
    .all(...where.params, TOP_AUGMENTS) as AugmentStats[];
}

function topItems(where: Where): ItemStats[] {
  return db
    .prepare(`
      SELECT item_id, COUNT(*) as picks, SUM(win) as wins
      FROM (
        ${itemSlotUnion(
          (i) => `SELECT ps.item${i} as item_id, ps.win
                FROM player_stats ps JOIN games g ON g.game_id = ps.game_id
                WHERE ${where.sql}
                  AND ps.item${i} > 0 AND ps.item${i} NOT IN (${EXCLUDED_ITEMS_SQL})`,
        )}
      )
      GROUP BY item_id
      ORDER BY picks DESC, wins DESC, item_id
      LIMIT ?
    `)
    .all(...ITEM_SLOTS.flatMap(() => where.params), TOP_ITEMS) as ItemStats[];
}

// The account that played the most of these games, named and pictured as its
// last game in the span recorded it: the recap describes the season, and a
// rename or new icon since is not part of it. Falls back on the summoner table
// for anything a game didn't record, and on the account filter, or the most
// recently synced account, when the span has no games to go on at all.
function spanPlayer(where: Where, account?: string): { player: SeasonPlayer; accounts: number } {
  const owners = db
    .prepare(`
      SELECT g.puuid, COUNT(*) as games
      FROM games g
      JOIN player_stats ps ON ps.game_id = g.game_id
      WHERE ${where.sql} AND g.puuid != ''
      GROUP BY g.puuid
      ORDER BY games DESC, MAX(g.game_creation) DESC
    `)
    .all(...where.params) as { puuid: string; games: number }[];

  const puuid = owners[0]?.puuid ?? account;
  const recorded = puuid
    ? (db
        .prepare(`
          SELECT mp.game_name, mp.tag_line, mp.profile_icon
          FROM games g
          JOIN player_stats ps ON ps.game_id = g.game_id
          JOIN match_participants mp ON mp.game_id = g.game_id AND mp.puuid = g.puuid
          WHERE ${where.sql} AND g.puuid = ?
          ORDER BY g.game_creation DESC
          LIMIT 1
        `)
        .get(...where.params, puuid) as
        | { game_name: string | null; tag_line: string | null; profile_icon: number | null }
        | undefined)
    : undefined;
  const synced = (
    puuid
      ? db
          .prepare("SELECT game_name, tag_line, profile_icon FROM summoner WHERE puuid = ?")
          .get(puuid)
      : db
          .prepare(
            "SELECT game_name, tag_line, profile_icon FROM summoner ORDER BY updated_at DESC LIMIT 1",
          )
          .get()
  ) as
    | { game_name: string | null; tag_line: string | null; profile_icon: number | null }
    | undefined;

  // Name and tag come as a pair: a tag only means anything beside the name it
  // was recorded with
  const named = recorded?.game_name ? recorded : synced;
  return {
    player: {
      gameName: named?.game_name ?? null,
      tagLine: named?.game_name ? named.tag_line : null,
      profileIcon: recorded?.profile_icon ?? synced?.profile_icon ?? null,
    },
    accounts: owners.length,
  };
}

function latestPatch(where: Where): string | null {
  const row = db
    .prepare(`
      SELECT g.game_version
      FROM games g
      JOIN player_stats ps ON ps.game_id = g.game_id
      WHERE ${where.sql} AND g.game_version IS NOT NULL AND g.game_version != ''
      ORDER BY g.game_creation DESC
      LIMIT 1
    `)
    .get(...where.params) as { game_version: string } | undefined;
  return row?.game_version ?? null;
}

// How many games careerRows would walk under a filter, without walking them
function countGames(filter: CareerFilter): number {
  const where = careerWhere(filter);
  const row = db
    .prepare(`
      SELECT COUNT(*) as games
      FROM games g
      JOIN player_stats ps ON ps.game_id = g.game_id
      WHERE ${where.sql}
    `)
    .get(...where.params) as { games: number };
  return row.games;
}

// Every season that has begun, oldest first, then the all-time entry, each
// with how many of the filter's games it holds. One still to come has nothing
// to recap.
function summarize(filter: CareerFilter): SeasonSummary[] {
  const now = Date.now();
  const seasons = SEASONS.filter((season) => seasonBounds(season).from <= now).map(
    (season): SeasonSummary => ({
      id: season.id,
      name: season.name,
      start: season.start,
      end: season.end,
      games: countGames({ ...filter, ...seasonBounds(season) }),
    }),
  );
  seasons.push({
    id: ALL_TIME_ID,
    name: "All time",
    start: null,
    end: null,
    games: countGames(filter),
  });
  return seasons;
}

// The season picker's list with no recap attached, over every account in the
// visible queues: enough to tell which seasons have games worth pointing at
export function getSeasons(): SeasonSummary[] {
  return summarize({});
}

/**
 * One season of Mayhem, or every game when asked for all time, under the same
 * queue and account filters the Records page offers. With no season named it
 * picks the latest one that has games, so the page opens on the season people
 * are most likely to want to share. A season named but not on offer, one still
 * to come or one this build doesn't know, is null.
 */
export function getSeasonRecap(
  seasonId?: string,
  queue?: number,
  account?: string,
): SeasonRecap | null {
  const seasons = summarize({ queue, account });
  const summary =
    seasonId == null
      ? (seasons.findLast((s) => s.id !== ALL_TIME_ID && s.games > 0) ??
        seasons[seasons.length - 1])
      : seasons.find((s) => s.id === seasonId);
  if (!summary) return null;
  const season = findSeason(summary.id);
  const filter: CareerFilter = { queue, account, ...(season ? seasonBounds(season) : {}) };
  const rows = careerRows(filter);
  // careerRows' own WHERE, so the augments, items and shares describe exactly
  // the games the row-by-row half counted
  const where = careerWhere(filter);

  let wins = 0;
  let duration = 0;
  let kills = 0;
  let deaths = 0;
  let assists = 0;
  let damage = 0;
  let damageTaken = 0;
  let healing = 0;
  let gold = 0;
  let mvps = 0;
  let aces = 0;
  let scoreSum = 0;
  let scored = 0;
  let scoredWins = 0;
  let scoredLosses = 0;
  const multikills = { doubles: 0, triples: 0, quadras: 0, pentas: 0 };
  const days = new Map<number, { games: number; wins: number }>();
  const hours = new Array<number>(24).fill(0);
  const weekdays = new Array<number>(7).fill(0);
  const champions = new Map<number, SeasonChampion & { scoreSum: number; scored: number }>();

  for (const r of rows) {
    wins += r.win;
    duration += r.game_duration;
    kills += r.kills;
    deaths += r.deaths;
    assists += r.assists;
    damage += r.total_damage_dealt;
    damageTaken += r.total_damage_taken;
    healing += r.total_heal;
    gold += r.gold_earned;
    if (r.score_badge === "MVP") mvps++;
    if (r.score_badge === "ACE") aces++;
    if (r.score != null) {
      scoreSum += r.score;
      scored++;
      if (r.win) scoredWins++;
      else scoredLosses++;
    }
    multikills.doubles += r.double_kills;
    multikills.triples += r.triple_kills;
    multikills.quadras += r.quadra_kills;
    multikills.pentas += r.penta_kills;

    const day = sessionDay(r.game_creation);
    const played = days.get(day) ?? { games: 0, wins: 0 };
    played.games++;
    played.wins += r.win;
    days.set(day, played);
    // The hour on the clock, but the weekday of the session: a 1am game on a
    // Saturday was part of Friday night
    hours[new Date(r.game_creation).getHours()]++;
    weekdays[new Date(day).getDay()]++;

    let champ = champions.get(r.champion_id);
    if (!champ) {
      champ = {
        champion_id: r.champion_id,
        games: 0,
        wins: 0,
        kills: 0,
        deaths: 0,
        assists: 0,
        avgScore: null,
        scoreSum: 0,
        scored: 0,
      };
      champions.set(r.champion_id, champ);
    }
    champ.games++;
    champ.wins += r.win;
    champ.kills += r.kills;
    champ.deaths += r.deaths;
    champ.assists += r.assists;
    if (r.score != null) {
      champ.scoreSum += r.score;
      champ.scored++;
    }
  }

  const championList: SeasonChampion[] = Array.from(
    champions.values(),
    ({ scoreSum: sum, scored: count, ...champ }) => ({
      ...champ,
      avgScore: count > 0 ? sum / count : null,
    }),
  ).sort((a, b) => b.games - a.games || b.wins - a.wins || a.champion_id - b.champion_id);

  // The rows are in the order played, so the days are too
  const dayList: SeasonDay[] = Array.from(days, ([day, played]) => ({ day, ...played }));
  let busiestDay: SeasonDay | null = null;
  for (const played of dayList) {
    if (
      !busiestDay ||
      played.games > busiestDay.games ||
      (played.games === busiestDay.games && played.wins > busiestDay.wins)
    ) {
      busiestDay = played;
    }
  }

  const { player, accounts } = spanPlayer(where, account);
  const shares =
    rows.length > 0 ? teamShares(where) : { killParticipation: null, damageShare: null };

  return {
    season: summary,
    seasons,
    player,
    accounts,
    patch: latestPatch(where),
    firstGame: rows[0]?.game_creation ?? null,
    lastGame: rows[rows.length - 1]?.game_creation ?? null,
    games: rows.length,
    wins,
    duration,
    days: dayList,
    busiestDay,
    dayStreak: longestStreak(dayList),
    peakHour: busiest(hours),
    topWeekday: busiest(weekdays),
    kills,
    deaths,
    assists,
    damage,
    damageTaken,
    healing,
    gold,
    multikills,
    killParticipation: shares.killParticipation,
    damageShare: shares.damageShare,
    avgScore: scored > 0 ? scoreSum / scored : null,
    mvps,
    aces,
    scoredWins,
    scoredLosses,
    champions: championList.slice(0, TOP_CHAMPIONS),
    uniqueChampions: champions.size,
    augments: rows.length > 0 ? topAugments(where) : [],
    items: rows.length > 0 ? topItems(where) : [],
    records: computeRecords(rows),
    friends: getTeammateStats(filter).slice(0, TOP_FRIENDS),
  };
}
