import { findSeason, seasonBounds } from "../../shared/seasons";
import { db } from "./connection";
import { getSetting } from "./settings";

// Queues switched off on the Settings page, as stored in hidden_queues. An
// absent key means the setting was never written; an empty one means the user
// has everything switched on.
function getHiddenQueues(): number[] {
  const raw = getSetting("hidden_queues");
  if (!raw) return [];
  return raw
    .split(",")
    .map(Number)
    .filter((id) => Number.isFinite(id));
}

// Every queue with games stored, ignoring which ones are hidden — the Settings
// page needs the full list to offer a hidden queue's switch back on.
export function getStoredQueues(): number[] {
  const rows = db
    .prepare(`
      SELECT DISTINCT g.queue_id
      FROM games g
      JOIN player_stats ps ON g.game_id = ps.game_id
      ORDER BY g.queue_id
    `)
    .all() as { queue_id: number }[];
  return rows.map((r) => r.queue_id);
}

// Appends queue conditions to a query's WHERE list. An explicit queue filter
// wins; otherwise the queues switched off in Settings are excluded everywhere.
export function applyQueueFilter(where: string[], params: any[], queue?: number, alias = "g") {
  if (queue != null) {
    where.push(`${alias}.queue_id = ?`);
    params.push(queue);
    return;
  }
  const hidden = getHiddenQueues();
  if (hidden.length > 0) {
    where.push(`${alias}.queue_id NOT IN (${hidden.map(() => "?").join(", ")})`);
    params.push(...hidden);
  }
}

// The game_creation window of a Mayhem set, named by its id in shared/seasons.
// Empty for no set, or for one this build doesn't know, which filters nothing.
export function seasonWindow(season?: string): { from?: number; to?: number | null } {
  const found = season ? findSeason(season) : null;
  return found ? seasonBounds(found) : {};
}

// Appends a set's window to a query's WHERE list, the way applyQueueFilter
// appends a queue
export function applySeasonFilter(where: string[], params: any[], season?: string, alias = "g") {
  const { from, to } = seasonWindow(season);
  if (from != null) {
    where.push(`${alias}.game_creation >= ?`);
    params.push(from);
  }
  if (to != null) {
    where.push(`${alias}.game_creation < ?`);
    params.push(to);
  }
}

// Remakes are already left out of every stat; this setting takes them out of
// the match list as well. An absent key means they stay visible.
export function hideRemakes(): boolean {
  return getSetting("hide_remakes") === "true";
}
