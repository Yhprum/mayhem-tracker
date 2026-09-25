import { mapNameForSkin } from "../../shared/maps";
import type { PlayerRecord } from "../../shared/api";
import { db } from "./connection";
import { applyQueueFilter } from "./filters";
import { getAllPuuids, displayName } from "./summoner";
import { MIN_SHARED_GAMES } from "./teammates";

// Which ARAM map a game was rolled onto, learned from the running game and
// remembered so the recap can still name it once the match is over.
export function setGameMap(gameId: number, mapId: number | null, mapSkin: string): void {
  db.prepare("INSERT OR REPLACE INTO match_maps (game_id, map_id, map_skin) VALUES (?, ?, ?)").run(
    gameId,
    mapId,
    mapSkin,
  );
}

export function getGameMapName(gameId: number): string | null {
  const row = db.prepare("SELECT map_skin FROM match_maps WHERE game_id = ?").get(gameId) as
    | { map_skin: string }
    | undefined;
  return mapNameForSkin(row?.map_skin);
}

// The icon the account who played a game was wearing at the time, which is what
// a picture of that game should carry. Games imported before the participant
// rows recorded one fall back to the account's icon as it stands now.
export function getGameProfileIcon(gameId: number): number | null {
  const game = db.prepare("SELECT puuid FROM games WHERE game_id = ?").get(gameId) as
    | { puuid: string }
    | undefined;
  if (!game?.puuid) return null;

  const played = db
    .prepare("SELECT profile_icon FROM match_participants WHERE game_id = ? AND puuid = ?")
    .get(gameId, game.puuid) as { profile_icon: number | null } | undefined;
  if (played?.profile_icon != null) return played.profile_icon;

  const account = db
    .prepare("SELECT profile_icon FROM summoner WHERE puuid = ?")
    .get(game.puuid) as { profile_icon: number | null } | undefined;
  return account?.profile_icon ?? null;
}

// A player to look up, however much of their identity we have. The in-game API
// gives names and no puuid; the client gives puuids and sometimes no name.
export interface PlayerRef {
  key: string;
  puuid: string | null;
  gameName: string | null;
  tagLine: string | null;
  championId: number;
}

export interface PlayerHistory {
  // Their line on the champion they're playing now, and across every champion
  champion: PlayerRecord | null;
  overall: PlayerRecord | null;
  // Games on our own team, this one included
  withUs: number;
  // Set once there are enough shared games for the Friends page to hold them
  friendKey: string | null;
}

// Lowercased so a riot id that comes back in different casing from two sources
// still matches, which it does: the client and the game disagree about it.
function playerNameKey(gameName: string | null, tagLine: string | null): string | null {
  if (!gameName) return null;
  return `${gameName}#${tagLine ?? ""}`.toLowerCase();
}

const NAME_KEY_SQL = "lower(%.game_name) || '#' || lower(COALESCE(%.tag_line, ''))";

// Matches rows belonging to any of the given players, by puuid where we have
// one and by riot id otherwise. Older stored games predate puuids entirely, so
// a player can own rows found only by name and rows found only by puuid.
function playerMatchClause(alias: string, players: PlayerRef[], params: any[]): string | null {
  const puuids = [...new Set(players.map((p) => p.puuid).filter((p): p is string => !!p))];
  const names = [
    ...new Set(
      players
        .map((p) => playerNameKey(p.gameName, p.tagLine))
        .filter((n): n is string => n !== null),
    ),
  ];

  const clauses: string[] = [];
  if (puuids.length > 0) {
    clauses.push(`${alias}.puuid IN (${puuids.map(() => "?").join(", ")})`);
    params.push(...puuids);
  }
  if (names.length > 0) {
    clauses.push(`${NAME_KEY_SQL.replaceAll("%", alias)} IN (${names.map(() => "?").join(", ")})`);
    params.push(...names);
  }
  return clauses.length > 0 ? `(${clauses.join(" OR ")})` : null;
}

function emptyRecord(): PlayerRecord {
  return { games: 0, wins: 0, kills: 0, deaths: 0, assists: 0, lastPlayed: 0 };
}

/**
 * What this app has seen of a handful of players, keyed by the caller's own
 * key. Everyone in a random lobby is a stranger, so most of these come back
 * empty, and the ones that don't are the point: a friend's record on the
 * champion they just locked in.
 */
export function getPlayerHistories(players: PlayerRef[]): Record<string, PlayerHistory> {
  const histories: Record<string, PlayerHistory> = {};
  if (players.length === 0) return histories;

  const params: any[] = [];
  const match = playerMatchClause("mp", players, params);
  // Nothing identifiable to look up, which is every player in a game the
  // client has stopped reporting names for
  if (!match) return histories;

  const where = [match, "mp.is_remake = 0"];
  applyQueueFilter(where, params, undefined, "mp");

  const rows = db
    .prepare(`
      SELECT mp.puuid, mp.game_name, mp.tag_line, mp.champion_id,
             COUNT(*) AS games, SUM(mp.win) AS wins,
             SUM(mp.kills) AS kills, SUM(mp.deaths) AS deaths, SUM(mp.assists) AS assists,
             MAX(g.game_creation) AS last_played
      FROM match_participants mp
      JOIN games g ON g.game_id = mp.game_id
      WHERE ${where.join(" AND ")}
      GROUP BY mp.puuid, lower(mp.game_name), lower(COALESCE(mp.tag_line, '')), mp.champion_id
    `)
    .all(...params) as {
    puuid: string | null;
    game_name: string | null;
    tag_line: string | null;
    champion_id: number;
    games: number;
    wins: number;
    kills: number;
    deaths: number;
    assists: number;
    last_played: number;
  }[];

  const byPuuid = new Map<string, PlayerRef>();
  const byName = new Map<string, PlayerRef>();
  for (const player of players) {
    if (player.puuid) byPuuid.set(player.puuid, player);
    const name = playerNameKey(player.gameName, player.tagLine);
    if (name) byName.set(name, player);
  }
  const ownerOf = (row: {
    puuid: string | null;
    game_name: string | null;
    tag_line: string | null;
  }) => {
    if (row.puuid) {
      const match = byPuuid.get(row.puuid);
      if (match) return match;
    }
    const name = playerNameKey(row.game_name, row.tag_line);
    return name ? (byName.get(name) ?? null) : null;
  };

  for (const row of rows) {
    const owner = ownerOf(row);
    if (!owner) continue;

    const history = (histories[owner.key] ??= {
      champion: null,
      overall: null,
      withUs: 0,
      friendKey: null,
    });

    const overall = (history.overall ??= emptyRecord());
    const targets =
      owner.championId && row.champion_id === owner.championId
        ? [overall, (history.champion ??= emptyRecord())]
        : [overall];
    for (const target of targets) {
      target.games += row.games;
      target.wins += row.wins;
      target.kills += row.kills;
      target.deaths += row.deaths;
      target.assists += row.assists;
      target.lastPlayed = Math.max(target.lastPlayed, row.last_played);
    }
  }

  // Games on our own side, which is what the Friends page counts and the only
  // number that says whether a name in the lobby is someone we know.
  const ours = getAllPuuids();
  if (ours.length > 0) {
    const teamParams: any[] = [];
    const teamMatch = playerMatchClause("o", players, teamParams);
    if (teamMatch) {
      const ourList = ours.map(() => "?").join(", ");
      const teamWhere = [
        teamMatch,
        "o.is_remake = 0",
        `(o.puuid IS NULL OR o.puuid NOT IN (${ourList}))`,
      ];
      teamParams.push(...ours);
      applyQueueFilter(teamWhere, teamParams, undefined, "o");

      const teamRows = db
        .prepare(`
          WITH our_teams AS (
            SELECT DISTINCT game_id, team_id FROM match_participants WHERE puuid IN (${ourList})
          )
          SELECT o.puuid, o.game_name, o.tag_line, COUNT(*) AS games
          FROM our_teams t
          JOIN match_participants o ON o.game_id = t.game_id AND o.team_id = t.team_id
          WHERE ${teamWhere.join(" AND ")}
          GROUP BY o.puuid, lower(o.game_name), lower(COALESCE(o.tag_line, ''))
        `)
        .all(...ours, ...teamParams) as {
        puuid: string | null;
        game_name: string | null;
        tag_line: string | null;
        games: number;
      }[];

      for (const row of teamRows) {
        const owner = ownerOf(row);
        if (!owner) continue;
        const history = (histories[owner.key] ??= {
          champion: null,
          overall: null,
          withUs: 0,
          friendKey: null,
        });
        history.withUs += row.games;
        // Built from the stored row rather than from the lobby, so it matches
        // the key the Friends page routes on even when the client spells the
        // riot id differently from the game that was recorded.
        if (history.withUs >= MIN_SHARED_GAMES) {
          history.friendKey =
            row.puuid || displayName(row.game_name, row.tag_line) || history.friendKey;
        }
      }
    }
  }

  return histories;
}
