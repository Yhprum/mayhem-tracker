import {
  DAY_START_HOUR,
  type SessionGrouping,
  parseSessionGrouping,
  SESSION_GROUPING_SETTING,
} from "../../shared/session";
import type {
  MatchSession,
  MatchListItem,
  MatchFilterOptions,
  MatchParticipantRecord,
  MatchDetail,
  GameRecord,
  PlayerStatsRecord,
  GameAugment,
} from "../../shared/api";
import { db } from "./connection";
import { hideRemakes, applyQueueFilter } from "./filters";
import { getSetting } from "./settings";
import { displayName, identityFromGame } from "./summoner";

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
export const MATCH_ROW_SQL = `
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
export function getMatchSessions(filters?: MatchListFilters): MatchSession[] {
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
    .all(...params) as MatchSession[];
}

export function getMatchHistory(
  limit: number,
  offset: number,
  filters?: MatchListFilters,
): { matches: MatchListItem[]; total: number } {
  const { whereSql, params } = matchListWhere(filters);
  const orderBy = matchOrderBy(filters?.sort, filters?.sortDir);

  const total = db
    .prepare(`
    SELECT COUNT(*) as count
    FROM games g
    JOIN player_stats ps ON g.game_id = ps.game_id
    ${whereSql}
  `)
    .get(...params) as { count: number };
  const matches = db
    .prepare(`
    SELECT ${MATCH_ROW_SQL}
    FROM games g
    JOIN player_stats ps ON g.game_id = ps.game_id
    ${whereSql}
    ORDER BY ${orderBy}
    LIMIT ? OFFSET ?
  `)
    .all(...params, limit, offset) as MatchListItem[];
  return { matches, total: total.count };
}

export function getMatchFilterOptions(filters?: {
  championId?: number;
  patch?: string;
  queue?: number;
  account?: string;
}): MatchFilterOptions {
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
function getMatchParticipants(gameId: number): MatchParticipantRecord[] {
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

export function getMatchDetail(gameId: number): MatchDetail | null {
  // Columns are listed rather than starred so the compressed payload stays out
  // of an IPC message that only needs the game's metadata.
  const game = db
    .prepare(`
      SELECT game_id, queue_id, game_mode, game_creation, game_duration,
             is_remake, puuid, game_version, favorite
      FROM games WHERE game_id = ?
    `)
    .get(gameId) as GameRecord | undefined;
  if (!game) return null;
  const stats = db
    .prepare("SELECT * FROM player_stats WHERE game_id = ?")
    .get(gameId) as PlayerStatsRecord;
  const augments = db
    .prepare("SELECT * FROM game_augments WHERE game_id = ? ORDER BY slot")
    .all(gameId) as GameAugment[];
  return {
    game,
    stats,
    augments,
    participants: getMatchParticipants(gameId),
  };
}

export function getChampionMatchHistory(
  championId: number,
  limit: number,
  offset: number,
  patch?: string,
  queue?: number,
): { matches: MatchListItem[]; total: number } {
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
    .get(...params) as { count: number };
  const matches = db
    .prepare(`
    SELECT ${MATCH_ROW_SQL}
    FROM games g
    JOIN player_stats ps ON g.game_id = ps.game_id
    ${whereSql}
    ORDER BY g.game_creation DESC
    LIMIT ? OFFSET ?
  `)
    .all(...params, limit, offset) as MatchListItem[];
  return { matches, total: total.count };
}

export function toggleFavorite(gameId: number): boolean {
  db.prepare("UPDATE games SET favorite = 1 - favorite WHERE game_id = ?").run(gameId);
  const row = db.prepare("SELECT favorite FROM games WHERE game_id = ?").get(gameId) as
    | { favorite: number }
    | undefined;
  return !!row?.favorite;
}
