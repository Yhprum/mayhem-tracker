import { useMemo, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useIpc } from "../hooks/useIpc";
import { useViewState } from "../hooks/useViewState";
import { useChampionData, getChampionName } from "../hooks/useChampions";
import type { TeammateStats } from "../lib/types";
import ChampionIcon from "../components/ChampionIcon";
import SummonerIcon from "../components/SummonerIcon";
import WinRateBar from "../components/WinRateBar";
import { formatTimeAgo, kdaRatio, kdaColor } from "../lib/format";

type SortKey = "games" | "winRate" | "kda" | "lastPlayed";
type SortDir = "asc" | "desc";

export default function Friends() {
  const navigate = useNavigate();
  const champData = useChampionData();
  const { data, loading, refetch } = useIpc<TeammateStats[]>(() => window.api.getTeammateStats());
  const [search, setSearch] = useViewState("friends.search", "");
  const [sortKey, setSortKey] = useViewState<SortKey>("friends.sortKey", "games");
  const [sortDir, setSortDir] = useViewState<SortDir>("friends.sortDir", "desc");

  useEffect(() => {
    const unsub = window.api.onGamesUpdated(() => refetch());
    return unsub;
  }, [refetch]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(sortDir === "desc" ? "asc" : "desc");
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  };

  const sorted = useMemo(() => {
    if (!data) return [];
    let filtered = data.filter((t) => t.name.toLowerCase().includes(search.toLowerCase()));

    filtered.sort((a, b) => {
      let av: number, bv: number;
      switch (sortKey) {
        case "winRate":
          av = a.games > 0 ? a.wins / a.games : 0;
          bv = b.games > 0 ? b.wins / b.games : 0;
          break;
        case "kda":
          av = a.deaths > 0 ? (a.kills + a.assists) / a.deaths : a.kills + a.assists;
          bv = b.deaths > 0 ? (b.kills + b.assists) / b.deaths : b.kills + b.assists;
          break;
        case "lastPlayed":
          av = a.lastPlayed;
          bv = b.lastPlayed;
          break;
        default:
          av = a.games;
          bv = b.games;
      }
      return sortDir === "desc" ? bv - av : av - bv;
    });

    return filtered;
  }, [data, search, sortKey, sortDir]);

  if (loading || !data) {
    return <div className="text-lol-text text-center mt-20">Loading...</div>;
  }

  const SortHeader = ({
    label,
    field,
    className,
  }: {
    label: string;
    field: SortKey;
    className?: string;
  }) => (
    <th
      onClick={() => handleSort(field)}
      className={`px-3 py-2 text-left text-xs font-medium text-lol-text uppercase tracking-wider cursor-pointer hover:text-lol-gold select-none ${className ?? ""}`}
    >
      {label} {sortKey === field ? (sortDir === "desc" ? "▼" : "▲") : ""}
    </th>
  );

  return (
    <div className="max-w-7xl space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-bold text-lol-text-bright">Friends</h1>
          <span className="text-sm text-lol-text">{sorted.length} players · 2+ games together</span>
        </div>
        <div className="relative">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search player..."
            className="input w-48 pr-7"
          />
          {search && (
            <button
              onClick={() => setSearch("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-lol-text/50 hover:text-lol-text-bright transition-colors"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 16 16"
                fill="currentColor"
                className="w-3.5 h-3.5"
              >
                <path
                  fillRule="evenodd"
                  d="M8 15A7 7 0 1 0 8 1a7 7 0 0 0 0 14Zm2.78-4.22a.75.75 0 0 1-1.06 0L8 9.06l-1.72 1.72a.75.75 0 1 1-1.06-1.06L6.94 8 5.22 6.28a.75.75 0 0 1 1.06-1.06L8 6.94l1.72-1.72a.75.75 0 1 1 1.06 1.06L9.06 8l1.72 1.72a.75.75 0 0 1 0 1.06Z"
                  clipRule="evenodd"
                />
              </svg>
            </button>
          )}
        </div>
      </div>

      <div className="bg-lol-card rounded-xl border border-lol-border/60 overflow-hidden">
        <table className="w-full">
          <thead className="bg-lol-dark/50">
            <tr>
              <th className="px-3 py-2 text-left text-xs font-medium text-lol-text uppercase tracking-wider w-12">
                #
              </th>
              <th className="px-3 py-2 text-left text-xs font-medium text-lol-text uppercase tracking-wider">
                Player
              </th>
              <SortHeader label="Games" field="games" />
              <SortHeader label="Win Rate" field="winRate" />
              <SortHeader label="Their KDA" field="kda" />
              <th className="px-3 py-2 text-left text-xs font-medium text-lol-text uppercase tracking-wider">
                Top Champions
              </th>
              <SortHeader label="Last Played" field="lastPlayed" />
            </tr>
          </thead>
          <tbody>
            {sorted.map((t, i) => {
              const avgKills = t.games > 0 ? t.kills / t.games : 0;
              const avgDeaths = t.games > 0 ? t.deaths / t.games : 0;
              const avgAssists = t.games > 0 ? t.assists / t.games : 0;
              const ratio =
                avgDeaths > 0 ? (avgKills + avgAssists) / avgDeaths : avgKills + avgAssists;
              const ratioStr = kdaRatio(t.kills, t.deaths, t.assists);

              return (
                <tr
                  key={t.key}
                  onClick={() => navigate(`/friends/${encodeURIComponent(t.key)}`)}
                  className="border-t border-lol-border/50 hover:bg-lol-card-hover cursor-pointer transition-colors"
                >
                  <td className="px-3 py-2 text-xs text-lol-text">{i + 1}</td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <SummonerIcon iconId={t.profileIcon} size={28} />
                      <span className="text-sm text-lol-text-bright">{t.name}</span>
                    </div>
                  </td>
                  <td className="px-3 py-2 text-sm text-lol-text-bright">{t.games}</td>
                  <td className="px-3 py-2 w-32">
                    <WinRateBar wins={t.wins} total={t.games} />
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex flex-col">
                      <span className={`text-sm ${kdaColor(ratio)}`}>{ratioStr}</span>
                      <span className="text-[10px] text-lol-text">
                        {avgKills.toFixed(1)} / {avgDeaths.toFixed(1)} / {avgAssists.toFixed(1)}
                      </span>
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-1">
                      {t.champions.slice(0, 3).map((c) => (
                        <div key={c.champion_id} className="relative group">
                          <ChampionIcon championId={c.champion_id} size={24} />
                          <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 hidden group-hover:block bg-lol-dark border border-lol-border rounded px-2 py-1 text-[10px] text-lol-text-bright whitespace-nowrap z-10">
                            {getChampionName(champData, c.champion_id)} ({c.games})
                          </div>
                        </div>
                      ))}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-sm text-lol-text">{formatTimeAgo(t.lastPlayed)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {sorted.length === 0 && (
          <div className="py-8 text-center text-sm text-lol-text">No players found</div>
        )}
      </div>
    </div>
  );
}
