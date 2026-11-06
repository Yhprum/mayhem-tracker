import {
  MIN_GROUP_MEMBER_GAMES,
  MIN_SHARED_GAMES,
  type TeammateGroup,
  type TeammateGroupDetail,
  type TeammateLine,
  type TeammateStats,
  type TeammateDetail,
  type MatchListItem,
  type TeammateMatch,
} from "../../shared/api";
import { computeMatchScores } from "../../shared/opScore";
import { getChampionClasses } from "../dragon";
import { db } from "./connection";
import { applyQueueFilter } from "./filters";
import { MATCH_ROW_SQL } from "./matches";
import type { CareerFilter } from "./records";
import { groupByGame, SCORE_ROW_COLUMNS, type ScoreRow, scoreInputsFromRows } from "./scoring";
import { displayName, getAllPuuids } from "./summoner";

// The id the Friends list keys a teammate on — puuid when we know it, so name
// changes don't split a player in two.
function teammateKey(puuid: string | null, name: string): string {
  return puuid || name;
}

function teammateName(gameName: string | null, tagLine: string | null, participantId: number) {
  return displayName(gameName, tagLine) ?? `Player ${participantId}`;
}

interface TeammateRow {
  game_id: number;
  game_creation: number;
  participant_id: number;
  team_id: number;
  puuid: string | null;
  game_name: string | null;
  tag_line: string | null;
  profile_icon: number | null;
  champion_id: number;
  win: number;
  kills: number;
  deaths: number;
  assists: number;
}

// Every participant who shared a team with one of our accounts, one row per
// player per game.
//
// Which (game, team) pairs are ours is resolved up front in a CTE rather than
// as an EXISTS against each candidate row: the CTE is a single indexed lookup
// per account, where the correlated form makes SQLite build a throwaway index
// on every call. DISTINCT is what keeps the row count honest when two of our
// own accounts played the same game on the same side.
//
// Narrowed to one account, the games are the ones it owns, as the account
// filter counts them everywhere else, and the team is the side it played on.
// Every tracked account is still kept out of the results, and so is the one
// asked for, which an imported library can hold games for without a summoner
// row: an alt is never a friend.
function teammateRows(puuids: string[], filter: CareerFilter = {}): TeammateRow[] {
  const teamOwners = filter.account ? [filter.account] : puuids;
  const ours = filter.account ? [...puuids, filter.account] : puuids;
  const where = [
    "o.is_remake = 0",
    `(o.puuid IS NULL OR o.puuid NOT IN (${ours.map(() => "?").join(", ")}))`,
  ];
  const params: any[] = [...ours];
  applyQueueFilter(where, params, filter.queue, "o");
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

  return db
    .prepare(`
      WITH our_teams AS (
        SELECT DISTINCT game_id, team_id FROM match_participants
        WHERE puuid IN (${teamOwners.map(() => "?").join(", ")})
      )
      SELECT o.game_id, g.game_creation, o.participant_id, o.team_id, o.puuid, o.game_name,
             o.tag_line, o.profile_icon, o.champion_id, o.win, o.kills, o.deaths, o.assists
      FROM our_teams t
      JOIN match_participants o ON o.game_id = t.game_id AND o.team_id = t.team_id
      JOIN games g ON g.game_id = o.game_id
      WHERE ${where.join(" AND ")}
      ORDER BY g.game_creation DESC
    `)
    .all(...teamOwners, ...params) as TeammateRow[];
}

// Narrowed by the same filter as careerRows, so a season recap's friends come
// from the games the rest of the recap counts. Players we've shared fewer than
// `minGames` games with are left out.
export function getTeammateStats(
  filter?: CareerFilter,
  minGames = MIN_SHARED_GAMES,
): TeammateStats[] {
  const puuids = getAllPuuids();
  if (puuids.length === 0) return [];

  const playerMap = new Map<
    string,
    {
      name: string;
      puuid: string | null;
      profileIcon: number | null;
      games: number;
      wins: number;
      kills: number;
      deaths: number;
      assists: number;
      champions: Map<number, number>;
      lastPlayed: number;
    }
  >();

  for (const row of teammateRows(puuids, filter)) {
    const name = teammateName(row.game_name, row.tag_line, row.participant_id);
    const key = teammateKey(row.puuid, name);

    // If we now have a puuid but previously tracked this player by name, merge
    if (row.puuid && !playerMap.has(row.puuid) && playerMap.has(name)) {
      const old = playerMap.get(name)!;
      if (!old.puuid) {
        playerMap.set(row.puuid, old);
        old.puuid = row.puuid;
        playerMap.delete(name);
      }
    }

    if (!playerMap.has(key)) {
      playerMap.set(key, {
        name,
        puuid: row.puuid,
        profileIcon: null,
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
    // Update name and icon to the most recent version
    if (row.game_creation > entry.lastPlayed) {
      entry.name = name;
      if (row.profile_icon != null) entry.profileIcon = row.profile_icon;
    }
    entry.games++;
    if (row.win) entry.wins++;
    entry.kills += row.kills;
    entry.deaths += row.deaths;
    entry.assists += row.assists;
    entry.lastPlayed = Math.max(entry.lastPlayed, row.game_creation);
    entry.champions.set(row.champion_id, (entry.champions.get(row.champion_id) || 0) + 1);
  }

  return Array.from(playerMap.entries())
    .filter(([, p]) => p.games >= minGames)
    .map(([key, p]) => ({
      key,
      name: p.name,
      puuid: p.puuid,
      profileIcon: p.profileIcon,
      games: p.games,
      wins: p.wins,
      kills: p.kills,
      deaths: p.deaths,
      assists: p.assists,
      // Champion id breaks ties so the same five champions come back in the
      // same order every time, rather than in whatever order the rows arrived.
      champions: Array.from(p.champions.entries())
        .sort((a, b) => b[1] - a[1] || a[0] - b[0])
        .slice(0, 5)
        .map(([champion_id, games]) => ({ champion_id, games })),
      lastPlayed: p.lastPlayed,
    }))
    .sort((a, b) => b.games - a.games);
}

type GroupCandidate = TeammateGroup["members"][number] & { games: number };

// One game as a group played it: the friends on our side, most-played first.
// `key` is the group the game belongs to.
interface GroupSide {
  key: string;
  roster: { player: GroupCandidate; row: TeammateRow }[];
}

// The people we play with, a game at a time: whoever on our team counts as a
// friend makes up that game's group, so a trio's game goes to the trio and not
// to the pairs inside it. A game with no friends on the team has no group.
//
// Who counts is settled over every game we have, so `filter` only picks which
// games are returned, and a game keeps its group under any filter.
function groupSides(puuids: string[], filter?: CareerFilter): GroupSide[] {
  // Rows are newest-first, so the first hit carries the current name and icon.
  const players = new Map<string, GroupCandidate>();
  for (const row of teammateRows(puuids)) {
    const name = teammateName(row.game_name, row.tag_line, row.participant_id);
    const key = teammateKey(row.puuid, name);
    const player = players.get(key);
    if (player) {
      player.games++;
      player.profileIcon ??= row.profile_icon;
    } else {
      players.set(key, { key, name, profileIcon: row.profile_icon, games: 1 });
    }
  }

  // Keyed by side rather than game: two of our accounts can meet on opposite
  // teams, and those are two rosters.
  const sides = new Map<string, GroupSide["roster"]>();
  for (const row of teammateRows(puuids, filter)) {
    const name = teammateName(row.game_name, row.tag_line, row.participant_id);
    const player = players.get(teammateKey(row.puuid, name));
    if (!player || player.games < MIN_GROUP_MEMBER_GAMES) continue;

    const id = `${row.game_id}:${row.team_id}`;
    const roster = sides.get(id);
    if (roster) roster.push({ player, row });
    else sides.set(id, [{ player, row }]);
  }

  return Array.from(sides.values(), (roster) => {
    // The key breaks ties so a roster reads the same from every game
    roster.sort(
      (a, b) => b.player.games - a.player.games || a.player.key.localeCompare(b.player.key),
    );
    return { key: roster.map(({ player }) => player.key).join(","), roster };
  });
}

function tallyGroups(sides: GroupSide[]): TeammateGroup[] {
  const ourLines = db.prepare("SELECT game_id, kills, deaths, assists FROM player_stats").all() as {
    game_id: number;
    kills: number;
    deaths: number;
    assists: number;
  }[];
  const ours = new Map(ourLines.map((line) => [line.game_id, line]));

  const groups = new Map<string, TeammateGroup>();
  for (const { key, roster } of sides) {
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        members: roster.map(({ player }) => ({
          key: player.key,
          name: player.name,
          profileIcon: player.profileIcon,
        })),
        games: 0,
        wins: 0,
        kills: 0,
        deaths: 0,
        assists: 0,
        lastPlayed: 0,
      });
    }
    const group = groups.get(key)!;
    const { row } = roster[0];
    group.games++;
    if (row.win) group.wins++;
    for (const line of [ours.get(row.game_id), ...roster.map((member) => member.row)]) {
      group.kills += line?.kills ?? 0;
      group.deaths += line?.deaths ?? 0;
      group.assists += line?.assists ?? 0;
    }
    group.lastPlayed = Math.max(group.lastPlayed, row.game_creation);
  }
  return Array.from(groups.values());
}

export function getTeammateGroups(filter?: CareerFilter): TeammateGroup[] {
  const puuids = getAllPuuids();
  if (puuids.length === 0) return [];
  return tallyGroups(groupSides(puuids, filter)).sort((a, b) => b.games - a.games);
}

// Our own row for each of these games, the same columns the match list shows,
// plus all ten players of each, which a teammate's score is computed from.
function sharedGameRows(gameIds: number[]) {
  const idList = gameIds.map(() => "?").join(", ");

  const ourMatches = db
    .prepare(`
      SELECT ${MATCH_ROW_SQL}
      FROM games g
      JOIN player_stats ps ON g.game_id = ps.game_id
      WHERE g.game_id IN (${idList})
      ORDER BY g.game_creation DESC
    `)
    .all(...gameIds) as MatchListItem[];

  const scoreRows = groupByGame(
    db
      .prepare(
        `SELECT game_id, ${SCORE_ROW_COLUMNS} FROM match_participants WHERE game_id IN (${idList})`,
      )
      .all(...gameIds) as (ScoreRow & { game_id: number })[],
  );

  return { ourMatches, scoreRows };
}

// These teammates' lines in one game. A teammate's score has to be computed
// rather than looked up, since player_stats only ever scores our own row.
function teammateLines(gameRows: ScoreRow[], teammates: TeammateRow[]): TeammateLine[] {
  const scores = computeMatchScores(scoreInputsFromRows(gameRows), getChampionClasses());

  return teammates.map((row) => {
    const stats = gameRows.find((p) => p.participant_id === row.participant_id);
    const score = scores.get(row.participant_id);
    return {
      champion_id: row.champion_id,
      win: row.win,
      kills: row.kills,
      deaths: row.deaths,
      assists: row.assists,
      total_damage_dealt: stats?.total_damage_dealt ?? 0,
      total_damage_taken: stats?.total_damage_taken ?? 0,
      total_heal: stats?.total_heal ?? 0,
      score: score?.score ?? null,
      score_badge: score?.badge ?? null,
    };
  });
}

// Every game one group played, with each member's line in it
export function getTeammateGroupDetail(key: string): TeammateGroupDetail | null {
  const puuids = getAllPuuids();
  if (puuids.length === 0) return null;

  const sides = groupSides(puuids).filter((side) => side.key === key);
  const [group] = tallyGroups(sides);
  if (!group) return null;

  const byGame = new Map(sides.map((side) => [side.roster[0].row.game_id, side]));
  const { ourMatches, scoreRows } = sharedGameRows(Array.from(byGame.keys()));

  return {
    group,
    matches: ourMatches.map((row) => ({
      ...row,
      members: teammateLines(
        scoreRows.get(row.game_id) ?? [],
        byGame.get(row.game_id)!.roster.map((member) => member.row),
      ),
    })),
  };
}

// Every game we played alongside one teammate, from both sides: our stored
// stats for the row plus the teammate's own line in that game.
export function getTeammateDetail(key: string): TeammateDetail | null {
  const puuids = getAllPuuids();
  if (puuids.length === 0) return null;

  // Rows are newest-first, so the first hit carries the current name and icon.
  // Older games can be missing puuids; once we know who we're looking at, match
  // those on name too — the same merge the Friends list does.
  const theirs: TeammateRow[] = [];
  let name: string | null = null;
  for (const row of teammateRows(puuids)) {
    const rowName = teammateName(row.game_name, row.tag_line, row.participant_id);
    if (teammateKey(row.puuid, rowName) === key) {
      name ??= rowName;
      theirs.push(row);
    } else if (name != null && row.puuid == null && rowName === name) {
      theirs.push(row);
    }
  }
  if (theirs.length === 0) return null;

  const byGame = new Map(theirs.map((row) => [row.game_id, row]));
  const { ourMatches, scoreRows } = sharedGameRows(Array.from(byGame.keys()));

  interface ChampionTotals {
    games: number;
    wins: number;
    kills: number;
    deaths: number;
    assists: number;
  }

  const matches: TeammateMatch[] = [];
  const champions = new Map<number, ChampionTotals>();
  const first = theirs[0];
  const player = {
    key,
    name: name ?? key,
    puuid: first.puuid,
    profileIcon: first.profile_icon,
    games: 0,
    wins: 0,
    kills: 0,
    deaths: 0,
    assists: 0,
    champions: [] as ({ champion_id: number } & ChampionTotals)[],
    lastPlayed: first.game_creation,
  };

  for (const row of ourMatches) {
    const friend = byGame.get(row.game_id);
    if (!friend) continue;

    if (player.profileIcon == null) player.profileIcon = friend.profile_icon;

    player.games++;
    if (friend.win) player.wins++;
    player.kills += friend.kills;
    player.deaths += friend.deaths;
    player.assists += friend.assists;

    if (!champions.has(friend.champion_id)) {
      champions.set(friend.champion_id, { games: 0, wins: 0, kills: 0, deaths: 0, assists: 0 });
    }
    const champ = champions.get(friend.champion_id)!;
    champ.games++;
    if (friend.win) champ.wins++;
    champ.kills += friend.kills;
    champ.deaths += friend.deaths;
    champ.assists += friend.assists;

    const [line] = teammateLines(scoreRows.get(row.game_id) ?? [], [friend]);
    matches.push({ ...row, friend: line });
  }

  if (player.games === 0) return null;
  player.champions = Array.from(champions.entries())
    .map(([champion_id, totals]) => ({ champion_id, ...totals }))
    .sort((a, b) => b.games - a.games);

  return { player, matches };
}
