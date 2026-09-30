import { DAY_START_HOUR } from "./session";

// ARAM: Mayhem runs in sets, each with a free progression pass, and a season
// recap covers the days its pass was live. Those dates are Riot's announcements
// rather than anything the client reports, and they don't follow patches: a
// set starts with one, but its pass closes mid-patch, and there can be weeks of
// Mayhem between one pass closing and the next opening. Games from those gaps
// belong to no season and still count toward the all-time recap.
export interface Season {
  id: string;
  name: string;
  // Local calendar dates, both inclusive, taken the way the match list takes a
  // day: a game at 1am belongs to the night before
  start: string;
  // Null until Riot announces when the pass closes
  end: string | null;
}

export const SEASONS: Season[] = [
  // The original run, from launch in 25.21 until Set 1 replaced it. It had no
  // pass of its own.
  { id: "set-0", name: "Set 0", start: "2025-10-22", end: "2026-02-03" },
  { id: "set-1", name: "Set 1", start: "2026-02-04", end: "2026-04-29" },
  { id: "set-2", name: "Set 2", start: "2026-06-10", end: "2026-10-05" },
  { id: "set-3", name: "Set 3", start: "2026-10-07", end: null },
];

// Every game on record, whichever season it fell in or between
export const ALL_TIME_ID = "all";

export function findSeason(id: string): Season | null {
  return SEASONS.find((season) => season.id === id) ?? null;
}

// Midnight-plus-DAY_START_HOUR of a local calendar date, which is where the
// session day that date names begins
function dayStart(date: string, offsetDays = 0): number {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(year, month - 1, day + offsetDays, DAY_START_HOUR).getTime();
}

// The span of game_creation values a season covers: from the start of its
// first day up to, but not including, the start of the day after its last.
export function seasonBounds(season: Season): { from: number; to: number | null } {
  return {
    from: dayStart(season.start),
    to: season.end ? dayStart(season.end, 1) : null,
  };
}

// The local calendar date a season's day names, as a timestamp for formatting
export function seasonDate(date: string): number {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(year, month - 1, day).getTime();
}
