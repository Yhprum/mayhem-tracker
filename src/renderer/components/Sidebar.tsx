import { NavLink } from "react-router-dom";
import { useState, useCallback, useEffect, useRef, type ComponentType, type SVGProps } from "react";
import { useLcuStatus } from "../hooks/useLcuStatus";
import { useBackfill } from "../hooks/useBackfill";
import type { LcuStatus, UpdateInfo } from "../lib/types";
import UpdateDialog from "./UpdateDialog";
import {
  HourglassIcon,
  SwordsIcon,
  TrophyIcon,
  CrosshairIcon,
  UsersIcon,
  GlobeIcon,
  TrendingUpIcon,
  MedalIcon,
  SettingsIcon,
  RefreshIcon,
} from "./icons";

type IconComponent = ComponentType<SVGProps<SVGSVGElement>>;

const links: { to: string; label: string; icon: IconComponent }[] = [
  { to: "/", label: "Match History", icon: SwordsIcon },
  { to: "/champions", label: "Champions", icon: TrophyIcon },
  { to: "/augments", label: "Augments", icon: CrosshairIcon },
  { to: "/friends", label: "Friends", icon: UsersIcon },
  { to: "/trends", label: "Trends", icon: TrendingUpIcon },
  { to: "/records", label: "Records", icon: MedalIcon },
  { to: "/global", label: "Total Stats", icon: GlobeIcon },
];

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

function NavItem({ to, label, icon: Icon }: { to: string; label: string; icon: IconComponent }) {
  return (
    <NavLink
      to={to}
      end={to === "/"}
      className={({ isActive }) =>
        `flex items-center gap-3 px-3 py-2 rounded-md text-[13px] font-medium transition-colors ${
          isActive
            ? "bg-lol-gold/10 text-lol-gold"
            : "text-lol-text hover:bg-white/5 hover:text-lol-text-bright"
        }`
      }
    >
      <Icon className="w-4 h-4 shrink-0" />
      <span>{label}</span>
    </NavLink>
  );
}

export default function Sidebar() {
  const status = useLcuStatus();
  const { running: backfilling, progress, percent } = useBackfill();
  const [refreshing, setRefreshing] = useState(false);
  const [lastResult, setLastResult] = useState<string | null>(null);
  const [version, setVersion] = useState("");
  const [update, setUpdate] = useState<UpdateInfo | null>(null);
  const [showUpdateDialog, setShowUpdateDialog] = useState(false);

  // Read inside the poll instead of as an effect dep, so opening the dialog
  // doesn't restart the interval
  const dialogOpenRef = useRef(false);
  dialogOpenRef.current = showUpdateDialog;

  useEffect(() => {
    window.api.getVersion().then(setVersion);

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

  useEffect(() => {
    if (!lastResult) return;
    const timer = setTimeout(() => setLastResult(null), 10_000);
    return () => clearTimeout(timer);
  }, [lastResult]);

  useEffect(
    () =>
      window.api.onBackfillDone((result) => {
        if ("error" in result) {
          setLastResult(`Import failed: ${result.error}`);
        } else if (result.cancelled) {
          setLastResult(`Import stopped after ${result.added} game(s)`);
        } else if (result.added > 0) {
          setLastResult(`Imported ${result.added} past game(s)`);
        }
      }),
    [],
  );

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    setLastResult(null);
    try {
      const result = await window.api.refreshGames();
      if ("error" in result) {
        setLastResult(`Error: ${result.error}`);
      } else {
        setLastResult(
          result.newGames > 0 ? `Found ${result.newGames} new game(s)` : "No new games",
        );
      }
    } catch (err: any) {
      // Strip Electron's IPC wrapper so only the underlying message shows
      const message = String(err?.message ?? err).replace(
        /^Error invoking remote method '[^']+': (Error: )?/,
        "",
      );
      setLastResult(`Error: ${message}`);
    } finally {
      setRefreshing(false);
    }
  }, []);

  return (
    <nav className="w-56 bg-lol-card/60 border-r border-lol-border/60 flex flex-col shrink-0">
      <div className="titlebar-drag h-14 shrink-0 flex items-center gap-2.5 px-4 border-b border-lol-border/40">
        <div className="w-7 h-7 rounded-lg border border-lol-gold/40 bg-lol-gold/10 flex items-center justify-center shrink-0">
          <HourglassIcon className="w-4 h-4 text-lol-gold" />
        </div>
        <div className="flex flex-col justify-center leading-none">
          <span className="font-bold text-[15px] tracking-[0.02em] text-lol-text-bright">
            Mayhem
          </span>
          <span className="text-[8px] font-semibold uppercase tracking-[0.35em] text-lol-text/80 mt-1">
            Tracker
          </span>
        </div>
      </div>
      <div className="flex flex-col gap-0.5 p-3 mt-1 flex-1">
        {links.map((link) => (
          <NavItem key={link.to} {...link} />
        ))}
      </div>
      <div className="px-3 pb-1">
        <NavItem to="/settings" label="Settings" icon={SettingsIcon} />
      </div>
      <div className="p-3 border-t border-lol-border/60 flex flex-col gap-2">
        {lastResult && !backfilling && (
          <span className="text-xs text-lol-text truncate" title={lastResult}>
            {lastResult}
          </span>
        )}
        {backfilling && (
          <div className="flex flex-col gap-1.5">
            <span className="text-xs text-lol-text truncate">
              {progress && progress.total > 0
                ? `Importing history ${progress.current}/${progress.total}`
                : "Importing history..."}
            </span>
            <div className="h-1 rounded-full bg-lol-border overflow-hidden">
              <div
                className="h-full bg-lol-gold transition-all duration-300"
                style={{ width: `${percent}%` }}
              />
            </div>
          </div>
        )}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${statusColors[status]}`} />
            <span className="text-xs text-lol-text">{statusLabels[status]}</span>
          </div>
          {backfilling ? (
            <button
              onClick={() => window.api.cancelBackfill()}
              className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-md border border-lol-border bg-white/5 text-lol-text hover:text-lol-text-bright hover:bg-white/10 transition-colors"
            >
              Cancel
            </button>
          ) : (
            <button
              onClick={handleRefresh}
              disabled={refreshing}
              className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-md border border-lol-gold/25 bg-lol-gold/10 text-lol-gold hover:bg-lol-gold/20 disabled:opacity-50 transition-colors"
            >
              <RefreshIcon className={`w-3 h-3 ${refreshing ? "animate-spin" : ""}`} />
              {refreshing ? "Syncing..." : "Sync"}
            </button>
          )}
        </div>
        <div className="flex items-center justify-between mt-1">
          <button
            onClick={() =>
              window.api.openUrl(
                `https://github.com/Yhprum/mayhem-tracker/releases/tag/v${version}`,
              )
            }
            className="text-[10px] text-lol-text/50 hover:text-lol-text transition-colors cursor-pointer"
          >
            v{version}
          </button>
          {update?.hasUpdate && (
            <button
              onClick={() => setShowUpdateDialog(true)}
              className="text-[10px] text-lol-gold hover:text-lol-gold-light transition-colors cursor-pointer"
            >
              v{update.latest} available
            </button>
          )}
        </div>
      </div>
      {showUpdateDialog && update && (
        <UpdateDialog update={update} onClose={() => setShowUpdateDialog(false)} />
      )}
    </nav>
  );
}
