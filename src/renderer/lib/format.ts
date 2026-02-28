export function formatKDA(kills: number, deaths: number, assists: number): string {
  return `${kills} / ${deaths} / ${assists}`;
}

export function kdaRatio(kills: number, deaths: number, assists: number): string {
  if (deaths === 0) return "Perfect";
  return ((kills + assists) / deaths).toFixed(2);
}

export function kdaColor(ratio: number): string {
  if (ratio >= 5) return "text-amber-400";
  if (ratio >= 4) return "text-sky-400";
  if (ratio >= 3) return "text-emerald-400";
  return "text-slate-300";
}

export function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

export function formatTimeAgo(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 30) return `${days}d ago`;
  return new Date(timestamp).toLocaleDateString();
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
  return "text-red-400";
}
