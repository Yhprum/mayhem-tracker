import { useMemo, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useIpc } from "../hooks/useIpc";
import { useViewState } from "../hooks/useViewState";
import { useSort } from "../hooks/useSort";
import { useChampionData, getChampionName } from "../hooks/useChampions";
import { MIN_SHARED_GAMES, type TeammateStats } from "../lib/types";
import ChampionIcon from "../components/ChampionIcon";
import SummonerIcon from "../components/SummonerIcon";
import WinRateBar from "../components/WinRateBar";
import SortHeader from "../components/SortHeader";
import { LOCALE, formatDecimal, formatTimeAgo, kdaRatio, kdaColor } from "../lib/format";
import Kda from "../components/Kda";
import SearchInput from "../components/SearchInput";
import FilterMenu from "../components/FilterMenu";
import MinGamesFilter from "../components/MinGamesFilter";
import SeasonSelect from "../components/SeasonSelect";

type SortKey = "games" | "winRate" | "kda" | "lastPlayed";

export default function Friends() {
  const navigate = useNavigate();
  const champData = useChampionData();
  const [season, setSeason] = useViewState<string | undefined>("friends.season", undefined);
  // The list holds everyone we've played with; this decides who counts as a
  // friend, and it starts and resets at MIN_SHARED_GAMES rather than off.
  const { data, refetch } = useIpc<TeammateStats[]>(
    () => window.api.getTeammateStats(season),
    [season],
  );
  const [search, setSearch] = useViewState("friends.search", "");
  const [minGames, setMinGames] = useViewState<number | undefined>(
    "friends.minGames",
    MIN_SHARED_GAMES,
  );
  const sort = useSort<SortKey>("friends", "games");
  const { sortKey, sortDir } = sort;

  useEffect(() => {
    const unsub = window.api.onGamesUpdated(() => refetch());
    return unsub;
  }, [refetch]);

  const sorted = useMemo(() => {
    if (!data) return [];
    let filtered = data.filter(
      (t) =>
        (minGames === undefined || t.games >= minGames) &&
        t.name.toLowerCase().includes(search.toLowerCase()),
    );

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
  }, [data, search, minGames, sortKey, sortDir]);

  if (!data) {
    return <div className="text-lol-text text-center mt-20">Loading...</div>;
  }

  return (
    <div className="max-w-7xl space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-bold text-lol-text-bright">Friends</h1>
          <span className="text-sm text-lol-text">
            {sorted.length.toLocaleString(LOCALE)} players · {minGames ?? 1}+ games together
          </span>
        </div>
        <div className="flex items-center gap-2">
          <FilterMenu
            active={(season !== undefined ? 1 : 0) + (minGames !== MIN_SHARED_GAMES ? 1 : 0)}
            onReset={() => {
              setSeason(undefined);
              setMinGames(MIN_SHARED_GAMES);
            }}
          >
            <SeasonSelect value={season} onChange={setSeason} label="Set" />
            <MinGamesFilter
              value={minGames}
              onChange={setMinGames}
              max={Math.max(...data.map((t) => t.games))}
            />
          </FilterMenu>
          <SearchInput value={search} onChange={setSearch} placeholder="Search player..." />
        </div>
      </div>

      <div className="bg-lol-card rounded-xl border border-lol-border/60 overflow-hidden">
        <table className="w-full">
          <thead className="bg-lol-dark/50">
            <tr>
              <th className="px-3 py-2 text-right text-xs font-medium text-lol-text uppercase tracking-wider w-12">
                #
              </th>
              <th className="px-3 py-2 text-left text-xs font-medium text-lol-text uppercase tracking-wider">
                Player
              </th>
              <SortHeader {...sort} numeric label="Games" field="games" className="w-24" />
              <SortHeader {...sort} numeric label="Win Rate" field="winRate" className="w-32" />
              <SortHeader {...sort} label="Their KDA" field="kda" className="w-32" />
              <th className="px-3 py-2 text-left text-xs font-medium text-lol-text uppercase tracking-wider w-36">
                Top Champions
              </th>
              <SortHeader {...sort} label="Last Played" field="lastPlayed" className="w-32" />
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
                  <td className="px-3 py-2 text-xs text-lol-text text-right tabular-nums">
                    {i + 1}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <SummonerIcon iconId={t.profileIcon} size={28} lazy />
                      <span className="text-sm text-lol-text-bright">{t.name}</span>
                    </div>
                  </td>
                  <td className="px-3 py-2 text-sm text-lol-text-bright text-right tabular-nums">
                    {t.games.toLocaleString(LOCALE)}
                  </td>
                  <td className="px-3 py-2 w-32">
                    <WinRateBar wins={t.wins} total={t.games} />
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex flex-col">
                      <span className={`text-sm ${kdaColor(ratio)}`}>{ratioStr}</span>
                      <span className="text-[10px] text-lol-text">
                        <Kda
                          kills={formatDecimal(avgKills)}
                          deaths={formatDecimal(avgDeaths)}
                          assists={formatDecimal(avgAssists)}
                        />
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
