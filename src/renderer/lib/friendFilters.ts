import type { SortDir } from "../hooks/useSort";

// How the Friends table sorts, and which of its two tables is open.
export type FriendSortKey = "games" | "winRate" | "kda" | "lastPlayed";
export type FriendsMode = "players" | "groups";

// Everything the Friends page is filtered and sorted by. Carried through the
// navigation to a player's or group's page and back, so returning to the list
// lands on the same view even when remembered filters are off.
export interface FriendsFilters {
  season?: string;
  partySize?: number;
  minGames?: number;
  search: string;
  mode: FriendsMode;
  sortKey: FriendSortKey;
  sortDir: SortDir;
}

// The view the Friends page had when it was last open, kept in memory for this
// session. The list's own back link carries the filters in the navigation's
// state, but going back through history lands on the entry we left, which has
// none — this is what puts the view back in that case.
let lastFilters: FriendsFilters | undefined;

export function rememberFriendsFilters(filters: FriendsFilters): void {
  lastFilters = filters;
}

export function getLastFriendsFilters(): FriendsFilters | undefined {
  return lastFilters;
}
