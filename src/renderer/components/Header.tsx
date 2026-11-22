import { NavLink } from "react-router-dom";
import { useState, useLayoutEffect, useRef } from "react";
import { useLcuStatus } from "../hooks/useLcuStatus";
import type { LcuStatus, UpdateInfo } from "../lib/types";
import { SettingsIcon, DownloadIcon } from "./icons";
import {
  Brand,
  RecapBadge,
  WindowControls,
  statusColors,
  statusLabels,
  useNavEntries,
  type NavEntry,
} from "./NavChrome";

// Shared by the links and the hidden row that measures them, so the width the
// measurement reports is the width the labelled links really take
const ITEM_CLASS =
  "relative flex items-center gap-1.5 rounded-md text-[13px] font-medium whitespace-nowrap transition-colors";
const LABELLED_PADDING = "px-2 py-1.5";

// Labelled while the row has room for every label. Without it, each link
// shrinks to its icon except the page being shown, which keeps its label so the
// header still says where you are.
function NavItem({ entry, compact }: { entry: NavEntry; compact: boolean }) {
  const { to, label, icon: Icon, search, title, badge, onClick } = entry;
  return (
    <NavLink
      to={search ? { pathname: to, search } : to}
      end={to === "/"}
      title={title ?? (compact ? label : undefined)}
      aria-label={label}
      onClick={onClick}
      className={({ isActive }) =>
        `titlebar-no-drag ${ITEM_CLASS} ${compact && !isActive ? "p-2" : LABELLED_PADDING} ${
          isActive
            ? "bg-lol-gold/10 text-lol-gold"
            : "text-lol-text hover:bg-white/5 hover:text-lol-text-bright"
        }`
      }
    >
      {({ isActive }) => {
        const iconOnly = compact && !isActive;
        return (
          <>
            {compact && <Icon className="w-4 h-4 shrink-0" />}
            {!iconOnly && <span>{label}</span>}
            {badge &&
              (iconOnly ? (
                <span className="absolute top-1 right-1 h-1.5 w-1.5 rounded-full bg-lol-gold" />
              ) : (
                <RecapBadge name={badge} />
              ))}
          </>
        );
      }}
    </NavLink>
  );
}

// Compact once the labelled links no longer fit beside the brand and the right
// hand controls. The labelled row is measured from a hidden copy rather than
// from the links themselves, which are already icons by the time it matters.
// Nothing outside the nav changes width with the mode, so switching can't
// feed back into the measurement.
function useCompactNav() {
  const navRef = useRef<HTMLElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const [compact, setCompact] = useState(false);

  useLayoutEffect(() => {
    const nav = navRef.current;
    const measure = measureRef.current;
    if (!nav || !measure) return;
    const update = () => setCompact(measure.offsetWidth > nav.clientWidth);
    const observer = new ResizeObserver(update);
    observer.observe(nav);
    observer.observe(measure);
    update();
    return () => observer.disconnect();
  }, []);

  return { navRef, measureRef, compact };
}

// A dot rather than a label, so the controls on the right keep one width
// whatever the client is doing and never decide whether the nav fits
function ConnectionStatus({ status }: { status: LcuStatus }) {
  return (
    <div
      role="status"
      aria-label={`League client: ${statusLabels[status]}`}
      title={`League client: ${statusLabels[status]}`}
      className="flex items-center justify-center w-8 h-8"
    >
      <span className={`h-2 w-2 rounded-full ${statusColors[status]}`} />
    </div>
  );
}

export default function Header({
  update,
  onUpdate,
}: {
  update: UpdateInfo | null;
  onUpdate: () => void;
}) {
  const status = useLcuStatus();
  const entries = useNavEntries();
  const { navRef, measureRef, compact } = useCompactNav();

  return (
    <header className="titlebar-drag h-11 shrink-0 flex items-center border-b border-lol-border/60 bg-lol-card/60">
      <div className="pl-4 pr-5 shrink-0">
        <Brand />
      </div>

      {/* The gaps between links, and the space after them, stay draggable */}
      <nav
        ref={navRef}
        className="relative flex-1 min-w-0 flex items-center gap-0.5 overflow-hidden"
      >
        {entries.map((entry) => (
          <NavItem key={entry.to} entry={entry} compact={compact} />
        ))}
        <div
          ref={measureRef}
          aria-hidden
          className="invisible pointer-events-none absolute left-0 top-0 w-max flex items-center gap-0.5"
        >
          {entries.map((entry) => (
            <span key={entry.to} className={`${ITEM_CLASS} ${LABELLED_PADDING}`}>
              <span>{entry.label}</span>
              {entry.badge && <RecapBadge name={entry.badge} />}
            </span>
          ))}
        </div>
      </nav>

      <div className="titlebar-no-drag flex items-center gap-1 pl-3 pr-2 shrink-0">
        {update && (
          <button
            onClick={onUpdate}
            title={`Update to version ${update.latest}`}
            aria-label={`Update to version ${update.latest}`}
            className="rounded-md border border-lol-gold/30 bg-lol-gold/10 p-[7px] text-lol-gold hover:bg-lol-gold/20 transition-colors"
          >
            <DownloadIcon className="w-4 h-4" />
          </button>
        )}
        <ConnectionStatus status={status} />
        <NavLink
          to="/settings"
          title="Settings"
          aria-label="Settings"
          className={({ isActive }) =>
            `rounded-md p-2 transition-colors ${
              isActive
                ? "bg-lol-gold/10 text-lol-gold"
                : "text-lol-text hover:bg-white/5 hover:text-lol-text-bright"
            }`
          }
        >
          <SettingsIcon className="w-4 h-4" />
        </NavLink>
      </div>

      <WindowControls />
    </header>
  );
}
