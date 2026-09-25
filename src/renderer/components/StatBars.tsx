import { formatCompact } from "../lib/format";

interface StatBarsProps {
  damage: number;
  taken: number;
  heal: number;
  // Highest value any player in that game reached, so bars are comparable
  max: { dmg: number; taken: number; heal: number };
  className?: string;
}

// Damage dealt / taken / healed, each as a share of the game's best.
export default function StatBars({ damage, taken, heal, max, className = "" }: StatBarsProps) {
  return (
    <div className={`shrink-0 space-y-0.5 ${className}`}>
      <StatBar value={damage} max={max.dmg} color="bg-red-400/50" label="DMG" />
      <StatBar value={taken} max={max.taken} color="bg-sky-400/50" label="TKN" />
      <StatBar value={heal} max={max.heal} color="bg-emerald-400/50" label="HEL" />
    </div>
  );
}

function StatBar({
  value,
  max,
  color,
  label,
}: {
  value: number;
  max: number;
  color: string;
  label: string;
}) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[10px] text-lol-text w-6 text-right shrink-0">{label}</span>
      <div className="flex-1 h-3.5 bg-white/5 rounded-sm overflow-hidden relative">
        <div className={`h-full rounded-sm ${color}`} style={{ width: `${pct}%` }} />
        <span className="absolute inset-0 flex items-center justify-end pr-1 text-[10px] font-medium text-white/90 leading-none tabular-nums">
          {value > 0 ? formatCompact(value) : ""}
        </span>
      </div>
    </div>
  );
}
