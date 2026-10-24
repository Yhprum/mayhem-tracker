import { firstDayOfWeek } from "../../shared/session";

// Windows' regional format, passed in by the main process (src/main/locale.ts).
// Every date and number the UI prints names it, since the page's own default
// is en-US in the packaged app whatever Windows is set to.
export const LOCALE = window.api.locale;

// The weekday weeks open on in the regional format, 0 = Sunday. The main
// process works it out from the same locale when it totals a week's games.
export const WEEK_START = firstDayOfWeek(LOCALE);

// Built once per precision: these run for every cell of every table
const NUMBER_FORMATS = new Map<string, Intl.NumberFormat>();

function numberFormat(style: "decimal" | "percent", digits: number): Intl.NumberFormat {
  const key = `${style}:${digits}`;
  let format = NUMBER_FORMATS.get(key);
  if (!format) {
    format = new Intl.NumberFormat(LOCALE, {
      style,
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    });
    NUMBER_FORMATS.set(key, format);
  }
  return format;
}

// A fractional stat at a fixed precision, with the regional decimal mark:
// 10.6 reads "10,6" in pt-BR
export function formatDecimal(value: number, digits = 1): string {
  return numberFormat("decimal", digits).format(value);
}

// A 0-1 ratio as a percentage, with the sign placed and spaced the regional
// way: 0.575 reads "57.5%", "57,5 %" in de-DE and "%57,5" in tr-TR
export function formatPercent(ratio: number, digits = 1): string {
  return numberFormat("percent", digits).format(ratio);
}

export function formatKDA(kills: number, deaths: number, assists: number): string {
  return `${kills} / ${deaths} / ${assists}`;
}

export function kdaRatio(kills: number, deaths: number, assists: number): string {
  if (deaths === 0) return "Perfect";
  return formatDecimal((kills + assists) / deaths, 2);
}

// A KDA worth pointing out: 3 or better, or a deathless "Perfect"
export function kdaHighlight(kills: number, deaths: number, assists: number): string {
  return deaths === 0 || (kills + assists) / deaths >= 3 ? "text-lol-gold" : "text-lol-text";
}

export function kdaColor(ratio: number): string {
  if (ratio >= 5) return "text-amber-400";
  if (ratio >= 4) return "text-sky-400";
  if (ratio >= 3) return "text-emerald-400";
  return "text-slate-300";
}

export function scoreColor(score: number): string {
  if (score >= 9) return "text-amber-400";
  if (score >= 7) return "text-sky-400";
  if (score >= 5) return "text-emerald-400";
  return "text-slate-400";
}

// Large stats at a glance, for table cells and bar labels: 12345 reads "12.3k",
// or "12,3k" in pt-BR. The "k" is the same everywhere: Intl's compact notation
// would widen narrow cells in some locales ("12,3 tys.") and leave thousands
// unabbreviated in others (de-DE prints "12.345").
export function formatCompact(value: number): string {
  return value >= 1000 ? `${formatDecimal(value / 1000)}k` : formatDecimal(value, 0);
}

export function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

// Long spans of accumulated game time, where minute precision only matters
// until the hours pile up
export function formatPlaytime(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  if (hours === 0) return `${mins}m`;
  if (hours >= 100) return `${hours.toLocaleString(LOCALE)}h`;
  return `${hours}h ${mins}m`;
}

export function formatTimeAgo(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 30) return `${days}d ago`;
  return new Date(timestamp).toLocaleDateString(LOCALE);
}

// The exact moment behind a relative timestamp, for tooltips
export function formatDateTime(timestamp: number): string {
  const date = new Date(timestamp);
  return `${date.toLocaleDateString(LOCALE, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  })} ${date.toLocaleTimeString(LOCALE, { hour: "numeric", minute: "2-digit" })}`;
}

// Riot switched displayed patch numbers to year-based in 2025 (internal 15.x
// shown as "25.x"), but match data and CDN branches still use the internal
// season number. Shift the major version for display only.
export function formatPatch(patch: string): string {
  const m = patch.match(/^(\d+)\.(.+)$/);
  if (!m) return patch;
  const major = Number(m[1]);
  return major >= 15 ? `${major + 10}.${m[2]}` : patch;
}

export function winRatePercent(wins: number, total: number): string {
  if (total === 0) return formatPercent(0, 0);
  return formatPercent(wins / total);
}

export function winRateColor(wins: number, total: number): string {
  if (total === 0) return "text-slate-400";
  const rate = wins / total;
  if (rate >= 0.6) return "text-emerald-400";
  if (rate >= 0.5) return "text-sky-400";
  return "text-lol-loss";
}

const TOTAL_FORMAT = new Intl.NumberFormat(LOCALE, {
  notation: "compact",
  maximumFractionDigits: 1,
});

// Season-sized totals, which run into the millions: 12,345,678 reads "12.3M"
export function formatTotal(value: number): string {
  return TOTAL_FORMAT.format(value);
}

const HOUR_FORMAT = new Intl.DateTimeFormat(LOCALE, { hour: "numeric", minute: "2-digit" });

// An hour of the day on the regional clock: "3:00 PM", or "15:00" in pt-BR.
// The minutes stay even though they're always zero, since a 24-hour clock
// prints the hour alone as a bare "15".
export function formatHour(hour: number): string {
  return HOUR_FORMAT.format(new Date(2000, 0, 1, hour));
}

const WEEKDAY_FORMATS = {
  short: new Intl.DateTimeFormat(LOCALE, { weekday: "short" }),
  long: new Intl.DateTimeFormat(LOCALE, { weekday: "long" }),
};

// A day of the week by its getDay() number, where Sunday is 0
export function formatWeekday(weekday: number, width: "short" | "long"): string {
  // January 2, 2000 was a Sunday
  return WEEKDAY_FORMATS[width].format(new Date(2000, 0, 2 + weekday));
}
