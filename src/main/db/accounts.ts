import type { AccountRemovalPlan, StoredAccount } from "../../shared/api";
import { db } from "./connection";
import { rebuildDerivedStats } from "./repair";
import { displayName, identityFromGame } from "./summoner";

// Every table keyed by a stored game. Children before games, since
// match_participants, player_stats and game_augments reference it and foreign
// keys are on.
const GAME_TABLES = [
  "match_participant_augments",
  "match_participants",
  "player_stats",
  "game_augments",
  "match_maps",
  "challenge_game_progress",
  "games",
];

// An account is ours if the client ever reported it, repair discovered it, or
// a stored game is attributed to it. A game's owner need not have a summoner
// row (see getProfile), so the summoner table alone can miss one.
function storedAccountPuuids(): string[] {
  const rows = db
    .prepare("SELECT puuid FROM summoner UNION SELECT puuid FROM games WHERE puuid != ''")
    .all() as { puuid: string }[];
  return rows.map((row) => row.puuid);
}

function ownedGameCounts(): Map<string, number> {
  const rows = db.prepare("SELECT puuid, COUNT(*) AS n FROM games GROUP BY puuid").all() as {
    puuid: string;
    n: number;
  }[];
  return new Map(rows.map((row) => [row.puuid, row.n]));
}

export function getStoredAccounts(): StoredAccount[] {
  const owned = ownedGameCounts();
  const summonerStmt = db.prepare(
    "SELECT game_name, tag_line, profile_icon FROM summoner WHERE puuid = ?",
  );
  const latestGameStmt = db.prepare(
    "SELECT game_id FROM games WHERE puuid = ? ORDER BY game_creation DESC LIMIT 1",
  );

  return storedAccountPuuids()
    .map((puuid) => {
      const row = summonerStmt.get(puuid) as
        | { game_name: string | null; tag_line: string | null; profile_icon: number | null }
        | undefined;
      let name = displayName(row?.game_name ?? null, row?.tag_line ?? null);
      let profileIcon = row?.profile_icon ?? null;
      // Same fallback the account dropdown uses: an imported account may have
      // no summoner row, but its newest game still names it.
      if (!name || profileIcon == null) {
        const latest = latestGameStmt.get(puuid) as { game_id: number } | undefined;
        const fromGame = latest ? identityFromGame(latest.game_id, puuid) : null;
        name = name ?? fromGame?.name ?? null;
        profileIcon = profileIcon ?? fromGame?.icon ?? null;
      }
      return { puuid, name, profileIcon, games: owned.get(puuid) ?? 0 };
    })
    .sort((a, b) => b.games - a.games);
}

// A game is stored once, under whichever account synced it first. So a game an
// account played alongside another of ours may well be filed under it, and is
// still that other account's game: those move to the other account instead of
// going. Only a game no other account of ours played in is deleted. Games filed
// under another account that this one merely appears in are not touched at
// all: there it is just a teammate or an opponent.
function planRemoval(puuid: string): { reassign: Map<number, string>; remove: number[] } {
  const others = storedAccountPuuids().filter((p) => p !== puuid);
  const rows = db
    .prepare(`
      SELECT g.game_id, mp.puuid AS other
      FROM games g
      LEFT JOIN match_participants mp
        ON mp.game_id = g.game_id AND mp.puuid IN (SELECT value FROM json_each(?))
      WHERE g.puuid = ?
      ORDER BY g.game_id
    `)
    .all(JSON.stringify(others), puuid) as { game_id: number; other: string | null }[];

  // Where a game holds more than one of our other accounts, it goes to the one
  // with the most games already, which is the likeliest main.
  const owned = ownedGameCounts();

  const reassign = new Map<number, string>();
  const seen = new Set<number>();
  for (const row of rows) {
    seen.add(row.game_id);
    if (!row.other) continue;
    const current = reassign.get(row.game_id);
    if (!current || (owned.get(row.other) ?? 0) > (owned.get(current) ?? 0)) {
      reassign.set(row.game_id, row.other);
    }
  }
  const remove = [...seen].filter((gameId) => !reassign.has(gameId));
  return { reassign, remove };
}

export function previewAccountRemoval(puuid: string): AccountRemovalPlan {
  const { reassign, remove } = planRemoval(puuid);
  return { deleted: remove.length, reassigned: reassign.size };
}

export function removeAccount(puuid: string): AccountRemovalPlan {
  const { reassign, remove } = planRemoval(puuid);
  const removeJson = JSON.stringify(remove);

  db.transaction(() => {
    const setOwner = db.prepare("UPDATE games SET puuid = ? WHERE game_id = ?");
    for (const [gameId, owner] of reassign) setOwner.run(owner, gameId);

    for (const table of GAME_TABLES) {
      db.prepare(`DELETE FROM ${table} WHERE game_id IN (SELECT value FROM json_each(?))`).run(
        removeJson,
      );
    }

    db.prepare("DELETE FROM summoner WHERE puuid = ?").run(puuid);
    // Left behind, a later sign-in of the same account would take the short
    // walk, which stops at the first page it already knows. Its non-Mayhem
    // games are still in ignored_games, so that page could sit right in front
    // of the Mayhem games just deleted.
    db.prepare("DELETE FROM settings WHERE key = ?").run(`backfill_complete_${puuid}`);

    // player_stats, the score and the augments of a moved game still describe
    // the removed account's row in it
    if (reassign.size > 0) rebuildDerivedStats([...reassign.keys()]);
  })();

  return { deleted: remove.length, reassigned: reassign.size };
}
