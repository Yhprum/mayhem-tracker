import type { SortDir } from "../hooks/useSort";

// A clickable column header. Spread what useSort returns to wire one up:
// <SortHeader {...sort} label="Games" field="games" />.
export default function SortHeader<K extends string>({
  label,
  field,
  sortKey,
  sortDir,
  onSort,
  compact = false,
  numeric = false,
  className = "",
}: {
  label: string;
  field: K;
  sortKey: K;
  sortDir: SortDir;
  onSort: (field: K) => void;
  // Tighter for the two narrow tables that sit side by side on a champion page
  compact?: boolean;
  // Right-aligned, over a column of right-aligned numbers
  numeric?: boolean;
  className?: string;
}) {
  const active = sortKey === field;

  return (
    <th
      onClick={() => onSort(field)}
      title={active ? (sortDir === "desc" ? "Sorted descending" : "Sorted ascending") : undefined}
      className={`relative ${compact ? "px-2 py-2 text-[11px]" : "px-3 py-2 text-xs"} ${
        numeric ? "text-right" : "text-left"
      } font-medium uppercase tracking-wider cursor-pointer select-none whitespace-nowrap transition-colors ${
        active
          ? "text-lol-gold bg-lol-gold/[0.06]"
          : "text-lol-text hover:text-lol-text-bright hover:bg-white/[0.03]"
      } ${className}`}
    >
      {label}
      {/* The sort shows as a bar on the cell's edge rather than a glyph beside the
          label, so it takes no room and cannot shift anything. It sits on the
          edge the order runs toward: the bottom for descending, the top for
          ascending. */}
      {active && (
        <span
          className={`absolute inset-x-0 h-0.5 bg-lol-gold ${
            sortDir === "desc" ? "bottom-0" : "top-0"
          }`}
        />
      )}
    </th>
  );
}
