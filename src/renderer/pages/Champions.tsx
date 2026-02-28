import { useState, useMemo, useEffect, Fragment } from "react";
import { useIpc } from "../hooks/useIpc";
import { useChampionData, getChampionName, useAugmentData } from "../hooks/useChampions";
import type { ChampionStats, AugmentStats, ItemStats, MatchListItem } from "../lib/types";
import ChampionIcon from "../components/ChampionIcon";
import AugmentIcon from "../components/AugmentIcon";
import ItemIcon from "../components/ItemIcon";
import WinRateBar from "../components/WinRateBar";
import MultikillBadge from "../components/MultikillBadge";
import { formatKDA, formatDuration, formatTimeAgo } from "../lib/format";

type SortKey =
  | "games"
  | "wins"
  | "avg_kills"
  | "avg_deaths"
  | "avg_assists"
  | "avg_damage"
  | "avg_gold"
  | "multikills";
type SortDir = "asc" | "desc";

function ChampionExpanded({ championId }: { championId: number }) {
  const augData = useAugmentData();
  const [augStats, setAugStats] = useState<AugmentStats[] | null>(null);
  const [itemStats, setItemStats] = useState<ItemStats[] | null>(null);
  const [matches, setMatches] = useState<MatchListItem[] | null>(null);

  useEffect(() => {
    window.api.getAugmentStats(championId).then(setAugStats);
    window.api.getChampionItemStats(championId).then(setItemStats);
    window.api.getChampionMatchHistory(championId, 5, 0).then((r) => setMatches(r.matches));
  }, [championId]);

  if (!augStats || !itemStats || !matches) {
    return (
      <td colSpan={10} className="px-4 py-4">
        <div className="text-sm text-lol-text text-center">Loading...</div>
      </td>
    );
  }

  const topAugments = augStats.slice(0, 6);
  const topItems = itemStats.slice(0, 6);

  return (
    <td colSpan={10} className="px-4 py-4">
      <div className="grid grid-cols-3 gap-6">
        {/* Augments */}
        <div className="min-w-0">
          <h3 className="text-xs text-lol-text uppercase tracking-wider mb-2">Top Augments</h3>
          <div className="space-y-1">
            {topAugments.length > 0 ? (
              topAugments.map((a) => (
                <div key={a.augment_id} className="flex items-center gap-2 h-7">
                  <div className="shrink-0">
                    <AugmentIcon augmentId={a.augment_id} />
                  </div>
                  <span className="text-xs text-lol-text-bright truncate min-w-0">
                    {augData[a.augment_id]?.name ?? `Augment ${a.augment_id}`}
                  </span>
                  <span className="text-[11px] text-lol-text shrink-0 ml-auto">{a.picks}x</span>
                  <div className="shrink-0">
                    <WinRateBar wins={a.wins} total={a.picks} />
                  </div>
                </div>
              ))
            ) : (
              <span className="text-xs text-lol-text">No data</span>
            )}
          </div>
        </div>

        {/* Items */}
        <div className="min-w-0">
          <h3 className="text-xs text-lol-text uppercase tracking-wider mb-2">Top Items</h3>
          <div className="space-y-1">
            {topItems.length > 0 ? (
              topItems.map((item) => (
                <div key={item.item_id} className="flex items-center gap-2 h-7">
                  <div className="shrink-0">
                    <ItemIcon itemId={item.item_id} size={24} />
                  </div>
                  <span className="text-[11px] text-lol-text shrink-0 ml-auto">{item.picks}x</span>
                  <div className="shrink-0">
                    <WinRateBar wins={item.wins} total={item.picks} />
                  </div>
                </div>
              ))
            ) : (
              <span className="text-xs text-lol-text">No data</span>
            )}
          </div>
        </div>

        {/* Recent Games */}
        <div className="min-w-0">
          <h3 className="text-xs text-lol-text uppercase tracking-wider mb-2">Recent Games</h3>
          <div className="space-y-1">
            {matches.length > 0 ? (
              matches.map((m) => (
                <div
                  key={m.game_id}
                  className={`flex items-center gap-2 px-2 h-7 rounded text-xs ${
                    m.win
                      ? "bg-lol-win/5 border border-lol-win/20"
                      : "bg-lol-loss/5 border border-lol-loss/20"
                  }`}
                >
                  <span
                    className={`font-bold w-4 shrink-0 ${m.win ? "text-lol-win" : "text-lol-loss"}`}
                  >
                    {m.win ? "W" : "L"}
                  </span>
                  <span className="text-lol-text-bright shrink-0">
                    {formatKDA(m.kills, m.deaths, m.assists)}
                  </span>
                  <span className="text-lol-text ml-auto shrink-0">
                    {formatDuration(m.game_duration)}
                  </span>
                  <span className="text-lol-text shrink-0">{formatTimeAgo(m.game_creation)}</span>
                </div>
              ))
            ) : (
              <span className="text-xs text-lol-text">No games</span>
            )}
          </div>
        </div>
      </div>
    </td>
  );
}

export default function Champions() {
  const champData = useChampionData();
  const { data, loading, refetch } = useIpc<ChampionStats[]>(() => window.api.getChampionStats());
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("games");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [expandedId, setExpandedId] = useState<number | null>(null);

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

  const toggleExpand = (championId: number) => {
    setExpandedId((prev) => (prev === championId ? null : championId));
  };

  const sorted = useMemo(() => {
    if (!data) return [];
    let filtered = data.filter((c) => {
      const name = getChampionName(champData, c.champion_id).toLowerCase();
      return name.includes(search.toLowerCase());
    });

    filtered.sort((a, b) => {
      let av: number, bv: number;
      if (sortKey === "multikills") {
        av = a.double_kills + a.triple_kills + a.quadra_kills + a.penta_kills;
        bv = b.double_kills + b.triple_kills + b.quadra_kills + b.penta_kills;
      } else if (sortKey === "wins") {
        av = a.games > 0 ? a.wins / a.games : 0;
        bv = b.games > 0 ? b.wins / b.games : 0;
      } else {
        av = (a as any)[sortKey];
        bv = (b as any)[sortKey];
      }
      return sortDir === "desc" ? bv - av : av - bv;
    });

    return filtered;
  }, [data, search, sortKey, sortDir, champData]);

  if (loading || !data) {
    return <div className="text-lol-text text-center mt-20">Loading...</div>;
  }

  const SortHeader = ({ label, field }: { label: string; field: SortKey }) => (
    <th
      onClick={() => handleSort(field)}
      className="px-3 py-2 text-left text-xs font-medium text-lol-text uppercase tracking-wider cursor-pointer hover:text-lol-gold select-none"
    >
      {label} {sortKey === field ? (sortDir === "desc" ? "▼" : "▲") : ""}
    </th>
  );

  return (
    <div className="max-w-5xl space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-lol-text-bright">Champions</h1>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search champion..."
          className="bg-lol-card border border-lol-border rounded-lg px-3 py-1.5 text-sm text-lol-text-bright placeholder:text-lol-text/50 focus:outline-none focus:border-lol-gold/50 w-48"
        />
      </div>

      <div className="bg-lol-card rounded-xl border border-lol-border overflow-hidden">
        <table className="w-full">
          <thead className="bg-lol-dark/50">
            <tr>
              <th className="px-3 py-2 text-left text-xs font-medium text-lol-text uppercase tracking-wider w-12">
                #
              </th>
              <th className="px-3 py-2 text-left text-xs font-medium text-lol-text uppercase tracking-wider">
                Champion
              </th>
              <SortHeader label="Games" field="games" />
              <SortHeader label="Win Rate" field="wins" />
              <SortHeader label="Avg K" field="avg_kills" />
              <SortHeader label="Avg D" field="avg_deaths" />
              <SortHeader label="Avg A" field="avg_assists" />
              <SortHeader label="Avg Dmg" field="avg_damage" />
              <SortHeader label="Avg Gold" field="avg_gold" />
              <SortHeader label="Multikills" field="multikills" />
            </tr>
          </thead>
          <tbody>
            {sorted.map((c, i) => (
              <Fragment key={c.champion_id}>
                <tr
                  onClick={() => toggleExpand(c.champion_id)}
                  className={`border-t border-lol-border/50 hover:bg-lol-card-hover cursor-pointer transition-colors ${
                    expandedId === c.champion_id ? "bg-lol-card-hover" : ""
                  }`}
                >
                  <td className="px-3 py-2 text-xs text-lol-text">{i + 1}</td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <ChampionIcon championId={c.champion_id} size={28} />
                      <span className="text-sm text-lol-text-bright">
                        {getChampionName(champData, c.champion_id)}
                      </span>
                    </div>
                  </td>
                  <td className="px-3 py-2 text-sm text-lol-text-bright">{c.games}</td>
                  <td className="px-3 py-2 w-32">
                    <WinRateBar wins={c.wins} total={c.games} />
                  </td>
                  <td className="px-3 py-2 text-sm text-lol-text">{c.avg_kills}</td>
                  <td className="px-3 py-2 text-sm text-lol-text">{c.avg_deaths}</td>
                  <td className="px-3 py-2 text-sm text-lol-text">{c.avg_assists}</td>
                  <td className="px-3 py-2 text-sm text-lol-text">
                    {(c.avg_damage ?? 0).toLocaleString()}
                  </td>
                  <td className="px-3 py-2 text-sm text-lol-gold">
                    {(c.avg_gold ?? 0).toLocaleString()}
                  </td>
                  <td className="px-3 py-2">
                    <div className="grid grid-cols-4 gap-1 text-[10px]">
                      <span className={c.double_kills > 0 ? "text-sky-400" : "text-transparent"}>
                        D{c.double_kills}
                      </span>
                      <span className={c.triple_kills > 0 ? "text-amber-400" : "text-transparent"}>
                        T{c.triple_kills}
                      </span>
                      <span className={c.quadra_kills > 0 ? "text-purple-400" : "text-transparent"}>
                        Q{c.quadra_kills}
                      </span>
                      <span className={c.penta_kills > 0 ? "text-red-400" : "text-transparent"}>
                        P{c.penta_kills}
                      </span>
                    </div>
                  </td>
                </tr>
                {expandedId === c.champion_id && (
                  <tr className="border-t border-lol-border/30 bg-lol-dark/30">
                    <ChampionExpanded championId={c.champion_id} />
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
        {sorted.length === 0 && (
          <div className="py-8 text-center text-sm text-lol-text">No champions found</div>
        )}
      </div>
    </div>
  );
}
