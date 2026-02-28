interface StatCardProps {
  label: string;
  value: string | number;
  subtext?: string;
  className?: string;
}

export default function StatCard({ label, value, subtext, className = "" }: StatCardProps) {
  return (
    <div className={`bg-lol-card rounded-xl border border-lol-border p-4 ${className}`}>
      <div className="text-xs text-lol-text uppercase tracking-wider mb-1">{label}</div>
      <div className="text-2xl font-bold text-lol-text-bright">{value}</div>
      {subtext && <div className="text-xs text-lol-text mt-1">{subtext}</div>}
    </div>
  );
}
