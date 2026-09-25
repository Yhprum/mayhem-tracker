// Windows' regional format, passed in by the main process (src/main/locale.ts).
// Every date and number the UI prints names it, since the page's own default
// is en-US in the packaged app whatever Windows is set to.
export const LOCALE = window.api.locale;

export function formatKDA(kills: number, deaths: number, assists: number): string {
  return `${kills} / ${deaths} / ${assists}`;
}

export function kdaRatio(kills: number, deaths: number, assists: number): string {
  if (deaths === 0) return "Perfect";
  return ((kills + assists) / deaths).toFixed(2);
}

// A KDA worth pointing out, taken from the string kdaRatio returns: "Perfect"
// always counts, and parseFloat leaves NaN there, which fails the comparison.
export function kdaHighlight(kda: string): string {
  return parseFloat(kda) >= 3 || kda === "Perfect" ? "text-lol-gold" : "text-lol-text";
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

// Large stats at a glance, for table cells and bar labels: 12345 reads "12.3k".
export function formatCompact(value: number): string {
  return value >= 1000 ? `${(value / 1000).toFixed(1)}k` : Math.round(value).toString();
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
  if (total === 0) return "0%";
  return `${((wins / total) * 100).toFixed(1)}%`;
}

export function winRateColor(wins: number, total: number): string {
  if (total === 0) return "text-slate-400";
  const rate = wins / total;
  if (rate >= 0.6) return "text-emerald-400";
  if (rate >= 0.5) return "text-sky-400";
  return "text-lol-loss";
}
