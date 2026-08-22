import type { ReactNode } from "react";

export type StatAccent = "gold" | "win" | "sky" | "purple";

// A soft corner glow and a tinted icon chip, so a row of cards reads as
// distinct tiles rather than one flat block. Exported so the Records page can
// build its clickable cards out of the same palette.
export const ACCENTS: Record<StatAccent, { glow: string; chip: string }> = {
  gold: {
    glow: "bg-lol-gold/[0.07]",
    chip: "bg-lol-gold/10 text-lol-gold",
  },
  win: {
    glow: "bg-lol-win/[0.07]",
    chip: "bg-lol-win/10 text-lol-win",
  },
  sky: {
    glow: "bg-sky-400/[0.07]",
    chip: "bg-sky-400/10 text-sky-400",
  },
  purple: {
    glow: "bg-purple-400/[0.07]",
    chip: "bg-purple-400/10 text-purple-400",
  },
};

interface StatCardProps {
  label: string;
  value?: ReactNode;
  subtext?: ReactNode;
  icon?: ReactNode;
  accent?: StatAccent;
  className?: string;
  // Footer content — pinned to the bottom so cards in a grid line up
  children?: ReactNode;
}

export default function StatCard({
  label,
  value,
  subtext,
  icon,
  accent,
  className = "",
  children,
}: StatCardProps) {
  const a = accent ? ACCENTS[accent] : null;

  return (
    <div
      className={`relative flex flex-col overflow-hidden bg-lol-card rounded-xl border border-lol-border/60 p-4 ${className}`}
    >
      {a && (
        <span
          className={`pointer-events-none absolute -top-14 -right-8 h-32 w-32 rounded-full blur-2xl ${a.glow}`}
        />
      )}
      <div className="relative flex items-center gap-1.5 mb-1">
        {icon && a && (
          <span className={`flex h-5 w-5 items-center justify-center rounded-md ${a.chip}`}>
            {icon}
          </span>
        )}
        <span className="text-[11px] text-lol-text uppercase tracking-wider">{label}</span>
      </div>
      {value !== undefined && (
        <div className="relative text-2xl font-bold text-lol-text-bright">{value}</div>
      )}
      {subtext && <div className="relative text-xs text-lol-text mt-1">{subtext}</div>}
      {children && <div className="relative mt-auto pt-2">{children}</div>}
    </div>
  );
}
