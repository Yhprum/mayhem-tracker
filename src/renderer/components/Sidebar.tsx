import { NavLink } from "react-router-dom";
import { useState, useCallback, useEffect } from "react";
import { useLcuStatus } from "../hooks/useLcuStatus";

const links = [
  { to: "/", label: "Match History", icon: "⚔️" },
  { to: "/champions", label: "Champions", icon: "🏆" },
  { to: "/augments", label: "Augments", icon: "🎯" },
  { to: "/friends", label: "Friends", icon: "👥" },
  { to: "/global", label: "Total Stats", icon: "🌐" },
];

const statusColors = {
  connected: "bg-lol-win",
  connecting: "bg-amber-500",
  disconnected: "bg-lol-loss",
};

const statusLabels = {
  connected: "Connected",
  connecting: "Connecting...",
  disconnected: "Disconnected",
};

export default function Sidebar() {
  const status = useLcuStatus();
  const [refreshing, setRefreshing] = useState(false);
  const [lastResult, setLastResult] = useState<string | null>(null);

  useEffect(() => {
    if (!lastResult) return;
    const timer = setTimeout(() => setLastResult(null), 10_000);
    return () => clearTimeout(timer);
  }, [lastResult]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    setLastResult(null);
    try {
      const result = await window.api.refreshGames();
      setLastResult(result.newGames > 0 ? `Found ${result.newGames} new game(s)` : "No new games");
    } catch (err: any) {
      setLastResult(`Error: ${err.message}`);
    } finally {
      setRefreshing(false);
    }
  }, []);

  return (
    <nav className="w-56 bg-lol-card border-r border-lol-border flex flex-col shrink-0">
      <div className="titlebar-drag h-9 flex items-center px-4">
        <span className="text-lol-gold font-bold text-sm titlebar-no-drag">MAYHEM TRACKER</span>
      </div>
      <div className="flex flex-col gap-1 p-3 mt-2 flex-1">
        {links.map(({ to, label, icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === "/"}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors ${
                isActive
                  ? "bg-lol-gold/15 text-lol-gold"
                  : "text-lol-text hover:bg-lol-card-hover hover:text-lol-text-bright"
              }`
            }
          >
            <span>{icon}</span>
            <span>{label}</span>
          </NavLink>
        ))}
      </div>
      <div className="px-3 pb-1">
        <NavLink
          to="/settings"
          className={({ isActive }) =>
            `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors ${
              isActive
                ? "bg-lol-gold/15 text-lol-gold"
                : "text-lol-text hover:bg-lol-card-hover hover:text-lol-text-bright"
            }`
          }
        >
          <span>{"\u2699\uFE0F"}</span>
          <span>Settings</span>
        </NavLink>
      </div>
      <div className="p-3 border-t border-lol-border flex flex-col gap-2">
        {lastResult && <span className="text-xs text-lol-text truncate">{lastResult}</span>}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${statusColors[status]}`} />
            <span className="text-xs text-lol-text">{statusLabels[status]}</span>
          </div>
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="text-xs px-3 py-1 rounded bg-lol-gold/20 text-lol-gold hover:bg-lol-gold/30 disabled:opacity-50 transition-colors"
          >
            {refreshing ? "Refreshing..." : "Refresh"}
          </button>
        </div>
      </div>
    </nav>
  );
}
