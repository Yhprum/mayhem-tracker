import {
  MIN_SHARED_GAMES,
  type TeammateStats,
  type MatchListItem,
  type FriendCombo,
  type FriendDetail,
  type FriendMemberStats,
  type FriendGame,
  type ComboFriend,
  type TeammateChampionStats,
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
      SELECT o.game_id, g.game_creation, o.participant_id, o.puuid, o.game_name, o.tag_line,
             o.profile_icon, o.champion_id, o.win, o.kills, o.deaths, o.assists
      FROM our_teams t
      JOIN match_participants o ON o.game_id = t.game_id AND o.team_id = t.team_id
      JOIN games g ON g.game_id = o.game_id
      WHERE ${where.join(" AND ")}
      ORDER BY g.game_creation DESC
    `)
    .all(...teamOwners, ...params) as TeammateRow[];
}

// A row's teammate id. Older games can be missing the puuid, so a name-only row
// borrows the puuid another row already gave the same riot id — the same merge
// the Friends list does when it totals them up.
function rowKey(row: TeammateRow, names: Map<string, string>): string {
  const name = teammateName(row.game_name, row.tag_line, row.participant_id);
  return row.puuid ?? names.get(name) ?? name;
}

// The friend ids by game, over the whole history rather than the filter window,
// so narrowing the page to a set doesn't demote a regular teammate to a
// stranger and make an ordinary game look like a smaller party. `names` is the
// name → puuid map the same resolution used.
interface FriendIndex {
  byGame: Map<number, Set<string>>;
  names: Map<string, string>;
}

function friendIndex(rows: TeammateRow[], puuids: string[], filter?: CareerFilter): FriendIndex {
  const narrowed =
    filter != null && (filter.from != null || filter.to != null || filter.queue != null);
  const historyRows = narrowed ? teammateRows(puuids, { account: filter?.account }) : rows;

  const names = new Map<string, string>();
  for (const row of historyRows) {
    if (row.puuid) {
      names.set(teammateName(row.game_name, row.tag_line, row.participant_id), row.puuid);
    }
  }

  const sharedGames = new Map<string, number>();
  for (const row of historyRows) {
    const key = rowKey(row, names);
    sharedGames.set(key, (sharedGames.get(key) ?? 0) + 1);
  }

  const friends = new Set<string>();
  for (const [key, games] of sharedGames) {
    if (games >= MIN_SHARED_GAMES) friends.add(key);
  }

  const byGame = new Map<number, Set<string>>();
  for (const row of historyRows) {
    const key = rowKey(row, names);
    if (!friends.has(key)) continue;
    const keys = byGame.get(row.game_id) ?? new Set<string>();
    keys.add(key);
    byGame.set(row.game_id, keys);
  }

  return { byGame, names };
}

// Keeps only the games with exactly `partySize - 1` friends on our side, and
// only the rows of those friends. A random teammate is not a friend, so a duo
// still counts when the rest of the team is strangers; a game with more friends
// than the party asks for counts for none of them.
function partyRows(
  rows: TeammateRow[],
  puuids: string[],
  partySize: number,
  filter?: CareerFilter,
): { rows: TeammateRow[]; names: Map<string, string> } {
  const index = friendIndex(rows, puuids, filter);
  const friendsInParty = partySize - 1;
  return {
    rows: rows.filter((row) => {
      const keys = index.byGame.get(row.game_id);
      return keys?.size === friendsInParty && keys.has(rowKey(row, index.names));
    }),
    names: index.names,
  };
}

// Narrowed by the same filter as careerRows, so a season recap's friends come
// from the games the rest of the recap counts. Players we've shared fewer than
// `minGames` games with are left out.
//
// `partySize` keeps only the games with that many players including us: 2 is a
// duo, 5 is a full team. It answers "how do we do when it's just the two of us?"
// without the games where other friends joined.
export function getTeammateStats(
  filter?: CareerFilter,
  minGames = MIN_SHARED_GAMES,
  partySize?: number,
): TeammateStats[] {
  const puuids = getAllPuuids();
  if (puuids.length === 0) return [];

  const rows = teammateRows(puuids, filter);
  const party = partySize != null ? partyRows(rows, puuids, partySize, filter) : null;
  const counted = party?.rows ?? rows;

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

  for (const row of counted) {
    const name = teammateName(row.game_name, row.tag_line, row.participant_id);
    // The party walk already knows which name-only rows belong to a teammate
    // with a puuid, so it keys those rows the same way.
    const key = party ? rowKey(row, party.names) : teammateKey(row.puuid, name);

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
    if (entry.puuid == null) entry.puuid = row.puuid;
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

// One row per distinct set of friends a game was played with — the duos, trios
// and full teams — rather than one row per friend. Narrowed by the same filter
// as getTeammateStats, and `partySize`, when given, keeps only the parties of
// that many players including us.
export function getFriendCombos(
  filter?: CareerFilter,
  minGames = MIN_SHARED_GAMES,
  partySize?: number,
): FriendCombo[] {
  const puuids = getAllPuuids();
  if (puuids.length === 0) return [];

  const rows = teammateRows(puuids, filter);
  const index = friendIndex(rows, puuids, filter);
  const nameOf = (row: TeammateRow) =>
    teammateName(row.game_name, row.tag_line, row.participant_id);

  // Rows are newest-first, so each friend's first row carries their current
  // name and icon.
  const friendInfo = new Map<
    string,
    { name: string; puuid: string | null; profileIcon: number | null }
  >();
  for (const row of rows) {
    const key = rowKey(row, index.names);
    if (!friendInfo.has(key)) {
      friendInfo.set(key, { name: nameOf(row), puuid: row.puuid, profileIcon: row.profile_icon });
    }
  }

  // Teammate rows come one per friend per game, so a game's rows have to be
  // regrouped to count the game once and the whole group's line once.
  const rowsByGame = new Map<number, TeammateRow[]>();
  for (const row of rows) {
    let gameRows = rowsByGame.get(row.game_id);
    if (!gameRows) rowsByGame.set(row.game_id, (gameRows = []));
    gameRows.push(row);
  }

  const totals = new Map<
    string,
    {
      games: number;
      wins: number;
      kills: number;
      deaths: number;
      assists: number;
      lastPlayed: number;
    }
  >();
  for (const [gameId, gameRows] of rowsByGame) {
    const keys = index.byGame.get(gameId);
    if (!keys || keys.size === 0) continue;
    if (partySize != null && keys.size !== partySize - 1) continue;

    const comboKey = Array.from(keys).sort().join("\u0000");
    const combo = totals.get(comboKey) ?? {
      games: 0,
      wins: 0,
      kills: 0,
      deaths: 0,
      assists: 0,
      lastPlayed: 0,
    };

    combo.games++;
    // Each friend's own line, summed across the group: the combined KDA the
    // row shows. The win is the team's, so it counts the game once.
    for (const row of gameRows) {
      if (!keys.has(rowKey(row, index.names))) continue;
      combo.kills += row.kills;
      combo.deaths += row.deaths;
      combo.assists += row.assists;
    }
    if (gameRows.some((row) => row.win)) combo.wins++;
    combo.lastPlayed = Math.max(combo.lastPlayed, gameRows[0].game_creation);
    totals.set(comboKey, combo);
  }

  return Array.from(totals.entries())
    .filter(([, combo]) => combo.games >= minGames)
    .map(([key, combo]) => ({
      key,
      friends: key.split("\u0000").map((friendId) => ({
        key: friendId,
        ...friendInfo.get(friendId)!,
      })),
      games: combo.games,
      wins: combo.wins,
      kills: combo.kills,
      deaths: combo.deaths,
      assists: combo.assists,
      lastPlayed: combo.lastPlayed,
    }))
    .sort((a, b) => b.games - a.games);
}

// One player's or one group's page: the games the set of friends in `key`
// played together, with each member's own line and the totals above them. A
// single friend is the player view, where every game with them counts whatever
// the rest of the party; a group is a party in itself, so its games are the
// ones whose friends are exactly that set (one further friend makes it another
// group's game). `filter` narrows the games the way the list did, while the
// friend set still comes from the whole history, and `partySize` applies the
// list's own party filter, which is what narrows a single friend's games.
export function getFriendDetail(
  key: string,
  filter?: CareerFilter,
  partySize?: number,
): FriendDetail | null {
  const puuids = getAllPuuids();
  if (puuids.length === 0) return null;

  const wanted = new Set(key.split("\u0000"));
  // A group keys on more than one friend and is a party of its own size; a
  // single friend's page takes the size from the list's filter instead.
  const size = partySize ?? (wanted.size > 1 ? wanted.size + 1 : undefined);
  const rows = teammateRows(puuids, filter);
  const index = friendIndex(rows, puuids, filter);

  // Rows are newest-first, so each member's first row carries their current
  // name and icon.
  const info = new Map<string, ComboFriend>();
  const rowsByGame = new Map<number, TeammateRow[]>();
  for (const row of rows) {
    const id = rowKey(row, index.names);
    if (!info.has(id)) {
      info.set(id, {
        key: id,
        name: teammateName(row.game_name, row.tag_line, row.participant_id),
        puuid: row.puuid,
        profileIcon: row.profile_icon,
      });
    }
    const gameRows = rowsByGame.get(row.game_id);
    if (gameRows) gameRows.push(row);
    else rowsByGame.set(row.game_id, [row]);
  }

  // The games the page is about: every wanted friend was in them, and, when a
  // party size applies, the party had exactly that many friends — so the games
  // are the ones the list row counted, not every game with any of the friends.
  // Without a party size the games are simply the ones the friends played: a
  // player below MIN_SHARED_GAMES is still on the list with a low min-games
  // filter, and their page has to open rather than claim they never played.
  const games = new Map<number, TeammateRow[]>();
  for (const [gameId, gameRows] of rowsByGame) {
    const present = new Set(gameRows.map((row) => rowKey(row, index.names)));
    if (size != null) {
      const ids = index.byGame.get(gameId);
      if (!ids || !Array.from(wanted).every((id) => ids.has(id))) continue;
      if (ids.size !== size - 1) continue;
    } else if (!Array.from(wanted).every((id) => present.has(id))) {
      continue;
    }
    games.set(
      gameId,
      gameRows.filter((row) => present.has(rowKey(row, index.names))),
    );
  }
  if (games.size === 0) return null;

  // Members in the key's own order, so the header's names, the member panel and
  // each game's lines all line up the same way the list row drew them.
  const memberList = Array.from(wanted)
    .sort()
    .map((id): FriendMemberStats => {
      const friend = info.get(id);
      return {
        key: id,
        name: friend?.name ?? id,
        puuid: friend?.puuid ?? null,
        profileIcon: friend?.profileIcon ?? null,
        games: 0,
        wins: 0,
        kills: 0,
        deaths: 0,
        assists: 0,
        champions: [],
        lastPlayed: 0,
      };
    });
  const memberById = new Map(memberList.map((member) => [member.key, member]));

  const champions = new Map<string, Map<number, Omit<TeammateChampionStats, "champion_id">>>();
  const group: FriendCombo = {
    key: Array.from(wanted).sort().join("\u0000"),
    friends: memberList.map(({ key: id, name, puuid, profileIcon }) => ({
      key: id,
      name,
      puuid,
      profileIcon,
    })),
    games: 0,
    wins: 0,
    kills: 0,
    deaths: 0,
    assists: 0,
    lastPlayed: 0,
  };

  for (const gameRows of games.values()) {
    group.games++;
    if (gameRows.some((row) => row.win)) group.wins++;
    for (const row of gameRows) {
      const id = rowKey(row, index.names);
      const member = memberById.get(id);
      if (!member) continue;

      member.games++;
      if (row.win) member.wins++;
      member.kills += row.kills;
      member.deaths += row.deaths;
      member.assists += row.assists;
      member.lastPlayed = Math.max(member.lastPlayed, row.game_creation);

      // The page's line is its members' lines summed; for one friend it is
      // just theirs, as the player page has always shown it.
      group.kills += row.kills;
      group.deaths += row.deaths;
      group.assists += row.assists;
      group.lastPlayed = Math.max(group.lastPlayed, row.game_creation);

      const byChampion = champions.get(id) ?? new Map();
      const champ = byChampion.get(row.champion_id) ?? {
        games: 0,
        wins: 0,
        kills: 0,
        deaths: 0,
        assists: 0,
      };
      champ.games++;
      if (row.win) champ.wins++;
      champ.kills += row.kills;
      champ.deaths += row.deaths;
      champ.assists += row.assists;
      byChampion.set(row.champion_id, champ);
      champions.set(id, byChampion);
    }
  }

  for (const member of memberList) {
    member.champions = Array.from(champions.get(member.key) ?? new Map())
      .map(([champion_id, totals]) => ({ champion_id, ...totals }))
      // Champion id breaks ties, as in the friends list.
      .sort((a, b) => b.games - a.games || a.champion_id - b.champion_id);
  }

  const gameIds = Array.from(games.keys());
  const idList = gameIds.map(() => "?").join(", ");

  // Our own row for each game of the page — the same columns the match list
  // shows — newest-first.
  const ourMatches = db
    .prepare(`
      SELECT ${MATCH_ROW_SQL}
      FROM games g
      JOIN player_stats ps ON g.game_id = ps.game_id
      WHERE g.game_id IN (${idList})
      ORDER BY g.game_creation DESC
    `)
    .all(...gameIds) as MatchListItem[];

  // A member's score has to be computed rather than looked up — player_stats
  // only ever scores our own row — so each game needs all ten players.
  const scoreRows = groupByGame(
    db
      .prepare(
        `SELECT game_id, ${SCORE_ROW_COLUMNS} FROM match_participants WHERE game_id IN (${idList})`,
      )
      .all(...gameIds) as (ScoreRow & { game_id: number })[],
  );

  const membersByGame = new Map(
    Array.from(games, ([gameId, gameRows]) => [
      gameId,
      new Map(gameRows.map((row) => [rowKey(row, index.names), row])),
    ]),
  );

  const matches: FriendGame[] = [];
  for (const row of ourMatches) {
    const byId = membersByGame.get(row.game_id);
    if (!byId) continue;
    const participants = scoreRows.get(row.game_id) ?? [];
    const scores = computeMatchScores(scoreInputsFromRows(participants), getChampionClasses());
    matches.push({
      ...row,
      members: memberList.map((member) => {
        const friend = byId.get(member.key)!;
        const score = scores.get(friend.participant_id);
        const stats = participants.find((p) => p.participant_id === friend.participant_id);
        return {
          key: member.key,
          champion_id: friend.champion_id,
          win: friend.win,
          kills: friend.kills,
          deaths: friend.deaths,
          assists: friend.assists,
          total_damage_dealt: stats?.total_damage_dealt ?? 0,
          total_damage_taken: stats?.total_damage_taken ?? 0,
          total_heal: stats?.total_heal ?? 0,
          score: score?.score ?? null,
          score_badge: score?.badge ?? null,
        };
      }),
    });
  }
  if (matches.length === 0) return null;

  return { group, members: memberList, matches };
}
