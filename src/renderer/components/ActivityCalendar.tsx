import type { CSSProperties, ReactNode } from "react";
import { LOCALE } from "../lib/format";
import { addDays } from "../../shared/session";

export interface CalendarDay {
  games: number;
  wins: number;
}

// How strongly each step up from an empty day is shaded, the busiest day on
// show at full strength
const LEVELS = [0.25, 0.45, 0.7, 1];
// The weekday rows that get a label, 0 = Sunday, as GitHub labels its calendar
const LABELLED_WEEKDAYS = [1, 3, 5];
const GAP = 3;
const DAY_MS = 86_400_000;

const DAY_FORMAT = new Intl.DateTimeFormat(LOCALE, {
  weekday: "short",
  month: "short",
  day: "numeric",
  year: "numeric",
});
const MONTH_FORMAT = new Intl.DateTimeFormat(LOCALE, { month: "short" });
const WEEKDAY_FORMAT = new Intl.DateTimeFormat(LOCALE, { weekday: "short" });

function describe(day: number, played: CalendarDay | undefined): string {
  const date = DAY_FORMAT.format(day);
  if (!played) return `${date} · no games`;
  const { games, wins } = played;
  return `${date} · ${games} ${games === 1 ? "game" : "games"} · ${wins}W ${games - wins}L`;
}

/**
 * Days from `first` to `last` as a GitHub-style grid, a column per week with
 * Sunday at the top, each day shaded by its games against the busiest day on
 * show. Days are keyed by their local midnight. Those after `through` haven't
 * happened yet and are drawn as outlines, so a span still in progress shows
 * how much of it is left.
 *
 * Columns are `cell` pixels wide where there is room and narrower where there
 * isn't, so a long span shrinks to fit rather than scrolling.
 */
export default function ActivityCalendar({
  days,
  first,
  last,
  through = last,
  cell,
}: {
  days: ReadonlyMap<number, CalendarDay>;
  first: number;
  last: number;
  through?: number;
  cell: number;
}) {
  // The Sunday on or before the first day, which starts the first column
  const start = addDays(first, -new Date(first).getDay());
  const weeks = Math.floor(Math.round((last - start) / DAY_MS) / 7) + 1;

  let busiest = 1;
  for (const [day, played] of days) {
    if (day >= first && day <= through) busiest = Math.max(busiest, played.games);
  }

  const months: ReactNode[] = [];
  const cells: ReactNode[] = [];
  let month = -1;
  for (let week = 0; week < weeks; week++) {
    const sunday = addDays(start, week * 7);
    // A column goes by the month of the first day it shows
    const shown = Math.max(sunday, first);
    if (new Date(shown).getMonth() !== month) {
      month = new Date(shown).getMonth();
      // A first column the next one already starts a new month beside has no
      // room for a label of its own
      const next = new Date(addDays(sunday, 7)).getMonth();
      if (week > 0 || next === month || weeks === 1) {
        months.push(
          <div
            key={week}
            style={{ gridColumn: week + 2, gridRow: 1 }}
            className="w-0 whitespace-nowrap text-[10px] leading-none text-lol-text"
          >
            {MONTH_FORMAT.format(shown)}
          </div>,
        );
      }
    }

    for (let weekday = 0; weekday < 7; weekday++) {
      const day = addDays(sunday, weekday);
      if (day < first || day > last) continue;
      const place: CSSProperties = { gridColumn: week + 2, gridRow: weekday + 2 };

      if (day > through) {
        cells.push(
          <div
            key={day}
            style={place}
            className="aspect-square rounded-[2px] border border-white/10"
          />,
        );
        continue;
      }

      const played = days.get(day);
      const games = played?.games ?? 0;
      const level = games === 0 ? 0 : Math.ceil((games / busiest) * LEVELS.length);
      cells.push(
        <div
          key={day}
          title={describe(day, played)}
          style={level > 0 ? { ...place, opacity: LEVELS[level - 1] } : place}
          className={`aspect-square rounded-[2px] ${level > 0 ? "bg-lol-gold" : "bg-white/5"}`}
        />,
      );
    }
  }

  return (
    <div className="w-fit max-w-full">
      <div
        className="grid"
        style={{
          gridTemplateColumns: `auto repeat(${weeks}, minmax(0, ${cell}px))`,
          gap: GAP,
        }}
      >
        {months}
        {LABELLED_WEEKDAYS.map((weekday) => (
          // No height of its own, so a label never makes its row taller than
          // the cells beside it
          <div
            key={weekday}
            style={{ gridColumn: 1, gridRow: weekday + 2 }}
            className="flex h-0 items-center self-center pr-1 text-[9px] leading-none text-lol-text"
          >
            {/* January 2, 2000 was a Sunday */}
            {WEEKDAY_FORMAT.format(new Date(2000, 0, 2 + weekday))}
          </div>
        ))}
        {cells}
      </div>
      <div className="mt-2 flex items-center justify-end gap-1 text-[10px] text-lol-text">
        <span className="mr-1">Less</span>
        <span className="h-2.5 w-2.5 rounded-[2px] bg-white/5" />
        {LEVELS.map((opacity) => (
          <span
            key={opacity}
            className="h-2.5 w-2.5 rounded-[2px] bg-lol-gold"
            style={{ opacity }}
          />
        ))}
        <span className="ml-1">More</span>
      </div>
    </div>
  );
}
