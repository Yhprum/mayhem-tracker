import { useEffect, useRef, useState, type ReactNode } from "react";
import { FunnelIcon } from "./icons";

// A page's filters folded behind one button, so the toolbar keeps to search and
// sort. The badge counts the filters in use, and Reset clears every one of them.
//
// The panel stays mounted while it is closed: some controls inside drop their
// own selection when new data leaves it with no games, and that has to keep
// happening with the menu shut.
export default function FilterMenu({
  active,
  onReset,
  children,
}: {
  active: number;
  onReset: () => void;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        title="Filters"
        aria-expanded={open}
        className={`relative flex items-center rounded-lg border px-2 py-1.5 transition-colors ${
          active > 0 || open
            ? "border-lol-gold/60 bg-lol-gold/10 text-lol-gold"
            : "border-lol-border bg-lol-card text-lol-text hover:border-lol-gold/60 hover:text-lol-text-bright"
        }`}
      >
        {/* h-5 matches the selects' line-height so the boxes end up the same height */}
        <span className="flex h-5 items-center">
          <FunnelIcon className="h-3.5 w-3.5" />
        </span>
        {active > 0 && (
          <span className="absolute -top-1.5 -right-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-lol-gold px-1 text-[10px] font-bold text-lol-dark">
            {active}
          </span>
        )}
      </button>

      <div
        className={`${open ? "" : "hidden"} absolute right-0 top-full z-30 mt-1.5 w-72 space-y-3 rounded-lg border border-lol-border bg-lol-card p-3 shadow-lg shadow-black/40`}
      >
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold text-lol-text-bright">Filters</span>
          <button
            onClick={onReset}
            disabled={active === 0}
            className="text-xs text-lol-text transition-colors hover:text-lol-gold disabled:opacity-40 disabled:hover:text-lol-text"
          >
            Reset
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

// One labelled control in a filter menu
export function FilterField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-1">
      <div className="text-[11px] font-medium uppercase tracking-wider text-lol-text">{label}</div>
      {children}
    </div>
  );
}
