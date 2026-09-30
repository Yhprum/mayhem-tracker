import type { ReactNode } from "react";
import { ACCENTS, type StatAccent } from "./StatCard";

// A titled section in the StatCard palette: the post-game recap and the season
// recap are both built out of these. The body takes whatever height the panel
// is stretched to, so a list beside a taller neighbour can spread out into it.
export default function Panel({
  title,
  subtitle,
  icon,
  accent,
  className = "",
  children,
}: {
  title: string;
  subtitle?: string;
  icon: ReactNode;
  accent: StatAccent;
  className?: string;
  children: ReactNode;
}) {
  const a = ACCENTS[accent];
  return (
    <div
      className={`relative flex flex-col overflow-hidden rounded-xl border border-lol-border/60 bg-lol-card p-4 ${className}`}
    >
      <span
        className={`pointer-events-none absolute -top-14 -right-8 h-32 w-32 rounded-full blur-2xl ${a.glow}`}
      />
      <div className="relative mb-3 flex items-baseline gap-2">
        <span className={`flex h-5 w-5 items-center justify-center rounded-md ${a.chip}`}>
          {icon}
        </span>
        <span className="text-sm font-semibold text-lol-text-bright">{title}</span>
        {subtitle && <span className="text-[11px] text-lol-text">{subtitle}</span>}
      </div>
      <div className="relative flex-1">{children}</div>
    </div>
  );
}
