import { db } from "./connection";

// "Name#TAG" where we have both halves, the bare name where we don't.
export function displayName(gameName: string | null, tagLine: string | null): string | null {
  if (!gameName) return null;
  return tagLine ? `${gameName}#${tagLine}` : gameName;
}

export function upsertSummoner(summoner: any): void {
  // REPLACE wipes the row, so keep the stored icon when this update doesn't
  // carry one (imported summoner rows predate the column)
  db.prepare(`
    INSERT OR REPLACE INTO summoner (puuid, game_name, tag_line, summoner_id, account_id, updated_at, profile_icon)
    VALUES (?, ?, ?, ?, ?, ?, COALESCE(?, (SELECT profile_icon FROM summoner WHERE puuid = ?)))
  `).run(
    summoner.puuid,
    summoner.displayName || summoner.gameName || summoner.internalName || summoner.game_name,
    summoner.tagLine || summoner.tag_line || null,
    summoner.summonerId ?? summoner.summoner_id,
    summoner.accountId ?? summoner.account_id,
    Date.now(),
    summoner.profileIconId ?? summoner.profile_icon ?? null,
    summoner.puuid,
  );
}

function getSummoner(): any {
  return db.prepare("SELECT * FROM summoner ORDER BY updated_at DESC LIMIT 1").get();
}

// One account's name and icon as that game recorded them. Covers databases
// built purely from an import, where the client has never connected and the
// summoner table has no icon.
export function identityFromGame(
  gameId: number,
  puuid: string,
): { name: string | null; icon: number | null } {
  const row = db
    .prepare(
      "SELECT game_name, tag_line, profile_icon FROM match_participants WHERE game_id = ? AND puuid = ?",
    )
    .get(gameId, puuid) as
    | { game_name: string | null; tag_line: string | null; profile_icon: number | null }
    | undefined;
  if (!row) return { name: null, icon: null };
  return {
    name: displayName(row.game_name, row.tag_line),
    icon: row.profile_icon,
  };
}

// The header names whichever account played most recently, so its name and icon
// always come from the same place. Keying off the summoner table's updated_at
// instead would name the account the client last synced — which need not be the
// one that played, and which repairPuuids rewrites for every account at once.
export function getProfile(): { name: string | null; profileIcon: number | null } {
  const latest = db
    .prepare(
      "SELECT game_id, puuid FROM games WHERE puuid != '' ORDER BY game_creation DESC LIMIT 1",
    )
    .get() as { game_id: number; puuid: string } | undefined;

  // No games yet — the client is the only thing that knows who we are
  const row = latest
    ? (db.prepare("SELECT * FROM summoner WHERE puuid = ?").get(latest.puuid) as any)
    : getSummoner();

  const name = row?.game_name
    ? row.tag_line
      ? `${row.game_name}#${row.tag_line}`
      : row.game_name
    : null;
  const icon = row?.profile_icon ?? null;
  if (name && icon != null) return { name, profileIcon: icon };

  // profile_icon only fills in once the client has synced this account, and an
  // imported game may have no summoner row at all — read both off the game
  // itself, still the same account.
  const fallback = latest
    ? identityFromGame(latest.game_id, latest.puuid)
    : { name: null, icon: null };
  return { name: name ?? fallback.name, profileIcon: icon ?? fallback.icon };
}

export function getAllPuuids(): string[] {
  const rows = db.prepare("SELECT puuid FROM summoner").all() as { puuid: string }[];
  return rows.map((r) => r.puuid);
}
