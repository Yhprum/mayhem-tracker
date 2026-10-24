import type { SortDir } from "../hooks/useSort";

interface SortProps<K extends string> {
  sortKey: K;
  sortDir: SortDir;
  onSort: (field: K) => void;
  // Tighter for the two narrow tables that sit side by side on a champion page
  compact?: boolean;
  // Right-aligned, over a column of right-aligned numbers
  numeric?: boolean;
  className?: string;
}

// A clickable column header. Spread what useSort returns to wire one up:
// <SortHeader {...sort} label="Games" field="games" />.
export default function SortHeader<K extends string>({
  label,
  field,
  sortKey,
  sortDir,
  onSort,
  ...cell
}: SortProps<K> & { label: string; field: K }) {
  const active = sortKey === field;

  return (
    <HeaderCell
      {...cell}
      label={label}
      active={active}
      sortDir={sortDir}
      onClick={() => onSort(field)}
      title={active ? (sortDir === "desc" ? "Sorted descending" : "Sorted ascending") : undefined}
    />
  );
}

// A header over a column that sorts by several related fields, like the
// multikill total and then each kind on its own. Every click steps to the next
// field and starts it descending, and the label names the field in use.
export function CycleSortHeader<K extends string>({
  steps,
  sortKey,
  sortDir,
  onSort,
  ...cell
}: SortProps<K> & { steps: readonly { field: K; label: string }[] }) {
  const index = steps.findIndex((s) => s.field === sortKey);
  const current = steps[Math.max(index, 0)];
  const next = steps[(index + 1) % steps.length];

  return (
    <HeaderCell
      {...cell}
      label={current.label}
      active={index >= 0}
      sortDir={sortDir}
      onClick={() => onSort(next.field)}
      title={index >= 0 ? `Sorted by ${current.label}. Click for ${next.label}` : undefined}
    />
  );
}

function HeaderCell({
  label,
  active,
  sortDir,
  onClick,
  title,
  compact = false,
  numeric = false,
  className = "",
}: {
  label: string;
  active: boolean;
  sortDir: SortDir;
  onClick: () => void;
  title: string | undefined;
  compact?: boolean;
  numeric?: boolean;
  className?: string;
}) {
  return (
    <th
      onClick={onClick}
      title={title}
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
