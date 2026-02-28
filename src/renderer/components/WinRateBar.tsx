interface WinRateBarProps {
  wins: number;
  total: number;
  showPercent?: boolean;
}

export default function WinRateBar({ wins, total, showPercent = true }: WinRateBarProps) {
  const rate = total > 0 ? (wins / total) * 100 : 0;

  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-2 bg-lol-loss/30 rounded-full overflow-hidden min-w-16">
        <div
          className="h-full bg-lol-win rounded-full transition-all"
          style={{ width: `${rate}%` }}
        />
      </div>
      {showPercent && (
        <span
          className={`text-xs font-medium min-w-10 text-right ${
            rate >= 60 ? "text-lol-win" : rate >= 50 ? "text-sky-400" : "text-lol-loss"
          }`}
        >
          {rate.toFixed(1)}%
        </span>
      )}
    </div>
  );
}
