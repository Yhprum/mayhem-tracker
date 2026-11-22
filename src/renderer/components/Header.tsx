import { NavLink } from "react-router-dom";
import {
  useState,
  useEffect,
  useLayoutEffect,
  useRef,
  type ComponentType,
  type ReactNode,
  type SVGProps,
} from "react";
import { useLcuStatus } from "../hooks/useLcuStatus";
import { useRecapBadge } from "../hooks/useRecapBadge";
import type { LcuStatus, SeasonSummary, UpdateInfo } from "../lib/types";
import UpdateDialog from "./UpdateDialog";
import {
  MayhemIcon,
  SettingsIcon,
  DownloadIcon,
  MinusIcon,
  MaximizeIcon,
  RestoreIcon,
  XIcon,
} from "./icons";
import { NAV_LINKS } from "../lib/navLinks";
import { useHiddenNavLinks } from "../hooks/useHiddenNavLinks";

type IconComponent = ComponentType<SVGProps<SVGSVGElement>>;

// The app is often left open for days, so a launch-only check would never
// surface a release cut in the meantime.
const UPDATE_POLL_MS = 6 * 60 * 60 * 1000;

const statusColors: Record<LcuStatus, string> = {
  connected: "bg-lol-win",
  ingame: "bg-sky-400",
  connecting: "bg-amber-500",
  disconnected: "bg-lol-loss",
};

const statusLabels: Record<LcuStatus, string> = {
  connected: "Connected",
  ingame: "In Game",
  connecting: "Connecting...",
  disconnected: "Disconnected",
};

// Shared by the links and the hidden row that measures them, so the width the
// measurement reports is the width the labelled links really take
const ITEM_CLASS =
  "relative flex items-center gap-1.5 rounded-md text-[13px] font-medium whitespace-nowrap transition-colors";
const LABELLED_PADDING = "px-2 py-1.5";

type NavEntry = {
  to: string;
  label: string;
  icon: IconComponent;
  search?: string;
  title?: string;
  badge?: ReactNode;
  onClick?: () => void;
};

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
                badge
              ))}
          </>
        );
      }}
    </NavLink>
  );
}

// A season that has just ended, named beside the Season Recap link until the
// recap has been opened
function RecapBadge({ season }: { season: SeasonSummary }) {
  return (
    <span className="rounded-full border border-lol-gold/40 bg-lol-gold/15 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-lol-gold">
      {season.name}
    </span>
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

function WindowControls() {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    window.api.isWindowMaximized().then(setMaximized);
    return window.api.onMaximizedChanged(setMaximized);
  }, []);

  return (
    <div className="titlebar-no-drag flex items-stretch self-stretch">
      <button
        onClick={() => window.api.minimizeWindow()}
        title="Minimize"
        className="w-11 flex items-center justify-center text-lol-text hover:bg-white/5 hover:text-lol-text-bright transition-colors"
      >
        <MinusIcon className="w-3.5 h-3.5" />
      </button>
      <button
        onClick={() => window.api.toggleMaximizeWindow()}
        title={maximized ? "Restore" : "Maximize"}
        className="w-11 flex items-center justify-center text-lol-text hover:bg-white/5 hover:text-lol-text-bright transition-colors"
      >
        {maximized ? <RestoreIcon className="w-3 h-3" /> : <MaximizeIcon className="w-3 h-3" />}
      </button>
      <button
        onClick={() => window.api.closeWindow()}
        title="Close"
        className="w-11 flex items-center justify-center text-lol-text hover:bg-lol-loss hover:text-white transition-colors"
      >
        <XIcon className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

export default function Header() {
  const status = useLcuStatus();
  const recapBadge = useRecapBadge();
  const hiddenLinks = useHiddenNavLinks();
  const { navRef, measureRef, compact } = useCompactNav();
  const [update, setUpdate] = useState<UpdateInfo | null>(null);
  const [showUpdateDialog, setShowUpdateDialog] = useState(false);

  // Read inside the poll instead of as an effect dep, so opening the dialog
  // doesn't restart the interval
  const dialogOpenRef = useRef(false);
  useEffect(() => {
    dialogOpenRef.current = showUpdateDialog;
  }, [showUpdateDialog]);

  useEffect(() => {
    const check = () =>
      window.api.checkForUpdate().then((info) => {
        // A failed poll shouldn't clear a badge an earlier check earned
        setUpdate((prev) => (info.error && prev ? prev : info));
      });
    check();
    const timer = setInterval(() => {
      // Skip while the dialog is up: swapping the release out from under an
      // in-progress download would invalidate the URL being installed
      if (!dialogOpenRef.current) check();
    }, UPDATE_POLL_MS);
    return () => clearInterval(timer);
  }, []);

  const shownLinks = NAV_LINKS.filter((link) => !hiddenLinks.has(link.to));
  const entries: NavEntry[] = shownLinks.map((link) =>
    link.to === "/season" && recapBadge.season
      ? {
          ...link,
          // Straight to the season that ended, whichever one the page would
          // otherwise open on
          search: `?season=${encodeURIComponent(recapBadge.season.id)}`,
          title: `Your ${recapBadge.season.name} recap is ready to share`,
          badge: <RecapBadge season={recapBadge.season} />,
          onClick: recapBadge.dismiss,
        }
      : link,
  );

  return (
    <>
      <header className="titlebar-drag h-11 shrink-0 flex items-center border-b border-lol-border/60 bg-lol-card/60">
        <div className="flex items-center gap-2.5 pl-4 pr-5 shrink-0">
          <div className="w-7 h-7 rounded-lg border border-lol-gold/40 bg-lol-gold/10 flex items-center justify-center shrink-0">
            <MayhemIcon className="w-5 h-5 text-lol-gold" />
          </div>
          <span className="font-bold text-[15px] tracking-[0.02em] text-lol-gold whitespace-nowrap">
            Mayhem Tracker
          </span>
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
                {entry.badge}
              </span>
            ))}
          </div>
        </nav>

        <div className="titlebar-no-drag flex items-center gap-1 pl-3 pr-2 shrink-0">
          {update?.hasUpdate && (
            <button
              onClick={() => setShowUpdateDialog(true)}
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
      {showUpdateDialog && update && (
        <UpdateDialog update={update} onClose={() => setShowUpdateDialog(false)} />
      )}
    </>
  );
}
