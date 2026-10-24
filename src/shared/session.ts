// A session is a day of play, but the day doesn't end at midnight: games before
// this hour belong to the night that started the evening before.
export const DAY_START_HOUR = 5;

// How the match list breaks its rows into sessions. The post-game recap always
// talks about a day, whichever of these is chosen.
export type SessionGrouping = "day" | "week" | "patch" | "none";

export const SESSION_GROUPING_SETTING = "session_grouping";
export const DEFAULT_SESSION_GROUPING: SessionGrouping = "day";

export function parseSessionGrouping(raw: string | null | undefined): SessionGrouping {
  return raw === "week" || raw === "patch" || raw === "none" ? raw : DEFAULT_SESSION_GROUPING;
}

// Local midnight of the session day a game belongs to. Both processes run in
// the same timezone, so the match list and the recap agree on where a session
// starts without either one having to say so.
export function sessionDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(d.getHours() - DAY_START_HOUR);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

// The weekday weeks open on in `locale`, numbered the way getDay() numbers them
// (0 = Sunday): Sunday in en-US and pt-BR, Monday across most of Europe,
// Saturday in fa-IR. Monday when the runtime can't say.
export function firstDayOfWeek(locale: string | undefined): number {
  try {
    const resolved = new Intl.DateTimeFormat(locale).resolvedOptions().locale;
    return new Intl.Locale(resolved).getWeekInfo().firstDay % 7;
  } catch {
    return 1;
  }
}

// How far into its week a weekday falls, for weeks opening on `weekStart`
export function daysIntoWeek(weekday: number, weekStart: number): number {
  return (weekday - weekStart + 7) % 7;
}

// Local midnight of the day that opens the session week, taking the same view
// of when a day begins as sessionDay.
export function sessionWeek(ms: number, weekStart: number): number {
  const d = new Date(sessionDay(ms));
  d.setDate(d.getDate() - daysIntoWeek(d.getDay(), weekStart));
  return d.getTime();
}

// Local midnight some days on from another local midnight, which a multiple of
// 24 hours isn't across a daylight saving change
export function addDays(day: number, count: number): number {
  const d = new Date(day);
  d.setDate(d.getDate() + count);
  return d.getTime();
}

// The local calendar date a moment falls on, as YYYY-MM-DD. SQLite has no
// local-midnight epoch to hand back, so its per-day totals are keyed by date
// string, and this is what matches a day worked out here up with them.
export function dayKey(when: number | Date): string {
  const d = new Date(when);
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const date = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${month}-${date}`;
}

// What a game is grouped under, in the form the database groups by too. Day and
// week are dates; a patch is the stored version, with games that never got one
// pooled under the empty string.
export function sessionKey(
  game: { game_creation: number; game_version?: string | null },
  grouping: SessionGrouping,
  weekStart: number,
): string {
  switch (grouping) {
    case "week":
      return dayKey(sessionWeek(game.game_creation, weekStart));
    case "patch":
      return game.game_version || "";
    default:
      return dayKey(sessionDay(game.game_creation));
  }
}
