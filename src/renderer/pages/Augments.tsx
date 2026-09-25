import { useState, useMemo, useEffect, Fragment } from "react";
import { useIpc } from "../hooks/useIpc";
import { useViewState } from "../hooks/useViewState";
import { useSort } from "../hooks/useSort";
import {
  useChampionData,
  getChampionName,
  useAugmentData,
  getAugmentName,
} from "../hooks/useChampions";
import type { AugmentStatsDetailedResult } from "../lib/types";
import AugmentIcon from "../components/AugmentIcon";
import ChampionIcon from "../components/ChampionIcon";
import WinRateBar from "../components/WinRateBar";
import PatchSelect from "../components/PatchSelect";
import QueueSelect from "../components/QueueSelect";
import SortHeader from "../components/SortHeader";

type SortKey = "picks" | "winRate" | "name";
type RarityFilter = "all" | "kSilver" | "kGold" | "kPrismatic";

const rarityFilters: { key: RarityFilter; label: string; color: string; activeColor: string }[] = [
  {
    key: "all",
    label: "All",
    color: "text-lol-text",
    activeColor: "bg-lol-gold/20 text-lol-gold border-lol-gold/50",
  },
  {
    key: "kSilver",
    label: "Silver",
    color: "text-gray-300",
    activeColor: "bg-gray-400/20 text-gray-200 border-gray-400/50",
  },
  {
    key: "kGold",
    label: "Gold",
    color: "text-yellow-400",
    activeColor: "bg-yellow-500/20 text-yellow-300 border-yellow-500/50",
  },
  {
    key: "kPrismatic",
    label: "Prismatic",
    color: "text-fuchsia-400",
    activeColor: "bg-fuchsia-500/20 text-fuchsia-300 border-fuchsia-400/50",
  },
];

export default function Augments() {
  const champData = useChampionData();
  const augmentData = useAugmentData();
  const [patch, setPatch] = useViewState<string | undefined>("augments.patch", undefined);
  const [queue, setQueue] = useViewState<number | undefined>("augments.queue", undefined);
  const { data, refetch } = useIpc<AugmentStatsDetailedResult>(
    () => window.api.getAugmentStatsDetailed(patch, queue),
    [patch, queue],
  );
  const [search, setSearch] = useViewState("augments.search", "");
  const sort = useSort<SortKey>("augments", "picks");
  const { sortKey, sortDir } = sort;
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [rarityFilter, setRarityFilter] = useViewState<RarityFilter>("augments.rarity", "all");

  useEffect(() => {
    const unsub = window.api.onGamesUpdated(() => refetch());
    return unsub;
  }, [refetch]);

  const totalGames = data?.totalGames ?? 0;

  const toggleExpand = (augmentId: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(augmentId)) next.delete(augmentId);
      else next.add(augmentId);
      return next;
    });
  };

  const sorted = useMemo(() => {
    if (!data) return [];
    let filtered = data.augments.filter((a) => {
      const aug = augmentData[a.augment_id];
      const name = getAugmentName(augmentData, a.augment_id).toLowerCase();
      if (!name.includes(search.toLowerCase())) return false;
      if (rarityFilter !== "all" && aug?.rarity !== rarityFilter) return false;
      return true;
    });

    filtered.sort((a, b) => {
      let av: number, bv: number;
      if (sortKey === "name") {
        const nameA = getAugmentName(augmentData, a.augment_id);
        const nameB = getAugmentName(augmentData, b.augment_id);
        const cmp = nameA.localeCompare(nameB);
        return sortDir === "asc" ? cmp : -cmp;
      } else if (sortKey === "winRate") {
        av = a.picks > 0 ? a.wins / a.picks : 0;
        bv = b.picks > 0 ? b.wins / b.picks : 0;
      } else {
        av = a.picks;
        bv = b.picks;
      }
      return sortDir === "desc" ? bv - av : av - bv;
    });

    return filtered;
  }, [data, search, sortKey, sortDir, augmentData, rarityFilter]);

  if (!data) {
    return <div className="text-lol-text text-center mt-20">Loading...</div>;
  }

  return (
    <div className="max-w-7xl space-y-4">
      <h1 className="text-xl font-bold text-lol-text-bright">Augments</h1>

      {/* Rarity Filter + Search */}
      <div className="flex items-center gap-2">
        {rarityFilters.map((f) => (
          <button
            key={f.key}
            onClick={() => setRarityFilter(f.key)}
            className={`px-3 py-1 text-xs font-medium rounded-lg border transition-colors ${
              rarityFilter === f.key
                ? f.activeColor
                : `${f.color} border-lol-border hover:border-lol-border/80 bg-lol-card`
            }`}
          >
            {f.label}
          </button>
        ))}
        <span className="text-xs text-lol-text self-center ml-2">{sorted.length} augments</span>
        <div className="ml-auto flex items-center gap-2">
          <QueueSelect value={queue} onChange={setQueue} />
          <PatchSelect value={patch} onChange={setPatch} />
        </div>
        <div className="relative">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search augment..."
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
              <th className="px-3 py-2 text-left text-xs font-medium text-lol-text uppercase tracking-wider w-8"></th>
              <SortHeader {...sort} label="Augment" field="name" />
              <SortHeader {...sort} numeric label="Picks" field="picks" className="w-24" />
              <th className="px-3 py-2 text-right text-xs font-medium text-lol-text uppercase tracking-wider w-24">
                Pick Rate
              </th>
              <SortHeader {...sort} numeric label="Win Rate" field="winRate" className="w-32" />
            </tr>
          </thead>
          <tbody>
            {sorted.map((a) => {
              const isExpanded = expanded.has(a.augment_id);
              const pickRate = totalGames > 0 ? ((a.picks / totalGames) * 100).toFixed(1) : "0.0";
              return (
                <Fragment key={a.augment_id}>
                  <tr
                    onClick={() => toggleExpand(a.augment_id)}
                    className="border-t border-lol-border/50 hover:bg-lol-card-hover cursor-pointer transition-colors"
                  >
                    <td className="px-3 py-2 text-xs text-lol-text">
                      <span
                        className={`inline-block transition-transform ${isExpanded ? "rotate-90" : ""}`}
                      >
                        ▶
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <AugmentIcon augmentId={a.augment_id} showName />
                    </td>
                    <td className="px-3 py-2 text-sm text-lol-text-bright text-right tabular-nums">
                      {a.picks}
                    </td>
                    <td className="px-3 py-2 text-sm text-lol-text text-right tabular-nums">
                      {pickRate}%
                    </td>
                    <td className="px-3 py-2 w-32">
                      <WinRateBar wins={a.wins} total={a.picks} />
                    </td>
                  </tr>
                  {isExpanded &&
                    a.champions.map((c) => (
                      <tr
                        key={`${a.augment_id}-${c.champion_id}`}
                        className="border-t border-lol-border/30 bg-lol-dark/30"
                      >
                        <td></td>
                        <td className="px-3 py-1.5 pl-8">
                          <div className="flex items-center gap-2">
                            <ChampionIcon championId={c.champion_id} size={22} />
                            <span className="text-xs text-lol-text">
                              {getChampionName(champData, c.champion_id)}
                            </span>
                          </div>
                        </td>
                        <td className="px-3 py-1.5 text-xs text-lol-text text-right tabular-nums">
                          {c.picks}
                        </td>
                        <td></td>
                        <td className="px-3 py-1.5 w-32">
                          <WinRateBar wins={c.wins} total={c.picks} />
                        </td>
                      </tr>
                    ))}
                </Fragment>
              );
            })}
          </tbody>
        </table>
        {sorted.length === 0 && (
          <div className="py-8 text-center text-sm text-lol-text">No augments found</div>
        )}
      </div>
    </div>
  );
}
