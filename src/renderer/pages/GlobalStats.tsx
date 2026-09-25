import { useState, useMemo, useEffect, useCallback } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useIpc } from "../hooks/useIpc";
import { useViewState } from "../hooks/useViewState";
import { readViewState, writeViewState } from "../lib/viewState";
import {
  useChampionData,
  getChampionName,
  useAugmentData,
  getAugmentName,
  useItemData,
} from "../hooks/useChampions";
import type { GlobalStats } from "../lib/types";
import ChampionIcon from "../components/ChampionIcon";
import AugmentIcon from "../components/AugmentIcon";
import ItemIcon from "../components/ItemIcon";
import WinRateBar from "../components/WinRateBar";
import PatchSelect from "../components/PatchSelect";
import QueueSelect from "../components/QueueSelect";
import RarityFilter, { type Rarity } from "../components/RarityFilter";
import SortHeader from "../components/SortHeader";
import { useSort } from "../hooks/useSort";

type Tab = "champions" | "augments" | "items";
type ChampSortKey = "games" | "winRate" | "pickRate" | "name";
type AugSortKey = "picks" | "winRate" | "pickRate" | "name";
type ItemSortKey = "picks" | "winRate" | "name";

function SearchInput({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <div className="relative">
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="input w-48 pr-7"
      />
      {value && (
        <button
          onClick={() => onChange("")}
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
  );
}

export default function GlobalStats() {
  const champData = useChampionData();
  const augmentData = useAugmentData();
  const navigate = useNavigate();
  // Filters and tab live in the URL so returning from a champion page lands
  // back on the same view
  const [searchParams, setSearchParams] = useSearchParams();
  const patch = searchParams.get("patch") ?? undefined;
  const queueParam = searchParams.get("queue");
  const queue = queueParam ? Number(queueParam) : undefined;
  const tabParam = searchParams.get("tab");
  const tab: Tab = tabParam === "augments" || tabParam === "items" ? tabParam : "champions";

  const setParam = (key: string, value: string | number | undefined) => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (value == null || value === "") next.delete(key);
        else next.set(key, String(value));
        return next;
      },
      { replace: true },
    );
  };
  const setPatch = (p: string | undefined) => setParam("patch", p);
  const setQueue = (q: number | undefined) => setParam("queue", q);
  const setTab = (t: Tab) => setParam("tab", t === "champions" ? undefined : t);

  // Those three live in the URL, so remembering them means putting the query
  // string back on the way in. Arriving with one already set — the back link
  // from a champion page — wins over whatever was stored.
  const [restored, setRestored] = useState(false);
  useEffect(() => {
    const saved = readViewState("global.params", "");
    if (saved && !searchParams.toString()) {
      setSearchParams(new URLSearchParams(saved), { replace: true });
    }
    setRestored(true);
    // Only ever on the way in, so the stored value can't clobber a live edit
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (restored) writeViewState("global.params", searchParams.toString());
  }, [restored, searchParams]);

  // Carried into the champion page so it opens with the same filters, and
  // comes back on its back link
  const filterQuery = useMemo(() => {
    const params = new URLSearchParams();
    if (patch) params.set("patch", patch);
    if (queue != null) params.set("queue", String(queue));
    const query = params.toString();
    return query ? `?${query}` : "";
  }, [patch, queue]);

  const { data, refetch } = useIpc<GlobalStats>(
    () => window.api.getGlobalStats(patch, queue),
    [patch, queue],
  );

  // Champion tab state
  const [champSearch, setChampSearch] = useViewState("global.champSearch", "");
  const champSort = useSort<ChampSortKey>("global.champ", "games");
  const { sortKey: champSortKey, sortDir: champSortDir } = champSort;

  // Augment tab state
  const [augSearch, setAugSearch] = useViewState("global.augSearch", "");
  const augSort = useSort<AugSortKey>("global.aug", "picks");
  const { sortKey: augSortKey, sortDir: augSortDir } = augSort;
  const [rarityFilter, setRarityFilter] = useViewState<Rarity>("global.augRarity", "all");

  // Item tab state
  const itemData = useItemData(patch);
  const [itemSearch, setItemSearch] = useViewState("global.itemSearch", "");
  const itemSort = useSort<ItemSortKey>("global.item", "picks");
  const { sortKey: itemSortKey, sortDir: itemSortDir } = itemSort;

  useEffect(() => {
    const unsub = window.api.onGamesUpdated(() => refetch());
    return unsub;
  }, [refetch]);

  const totalGames = data ? Math.round(data.totalParticipantSlots / 10) : 0;

  const sortedChampions = useMemo(() => {
    if (!data) return [];
    let filtered = data.champions.filter((c) => {
      const name = getChampionName(champData, c.champion_id).toLowerCase();
      return name.includes(champSearch.toLowerCase());
    });

    filtered.sort((a, b) => {
      let av: number, bv: number;
      if (champSortKey === "name") {
        const nameA = getChampionName(champData, a.champion_id);
        const nameB = getChampionName(champData, b.champion_id);
        const cmp = nameA.localeCompare(nameB);
        return champSortDir === "asc" ? cmp : -cmp;
      } else if (champSortKey === "winRate") {
        av = a.games > 0 ? a.wins / a.games : 0;
        bv = b.games > 0 ? b.wins / b.games : 0;
      } else if (champSortKey === "pickRate") {
        av = data.totalParticipantSlots > 0 ? a.games / data.totalParticipantSlots : 0;
        bv = data.totalParticipantSlots > 0 ? b.games / data.totalParticipantSlots : 0;
      } else {
        av = a.games;
        bv = b.games;
      }
      return champSortDir === "desc" ? bv - av : av - bv;
    });

    return filtered;
  }, [data, champSearch, champSortKey, champSortDir, champData]);

  const sortedAugments = useMemo(() => {
    if (!data) return [];
    let filtered = data.augments.filter((a) => {
      const name = getAugmentName(augmentData, a.augment_id).toLowerCase();
      if (!name.includes(augSearch.toLowerCase())) return false;
      if (rarityFilter !== "all" && augmentData[a.augment_id]?.rarity !== rarityFilter)
        return false;
      return true;
    });

    filtered.sort((a, b) => {
      let av: number, bv: number;
      if (augSortKey === "name") {
        const nameA = getAugmentName(augmentData, a.augment_id);
        const nameB = getAugmentName(augmentData, b.augment_id);
        const cmp = nameA.localeCompare(nameB);
        return augSortDir === "asc" ? cmp : -cmp;
      } else if (augSortKey === "winRate") {
        av = a.picks > 0 ? a.wins / a.picks : 0;
        bv = b.picks > 0 ? b.wins / b.picks : 0;
      } else if (augSortKey === "pickRate") {
        av = data!.totalParticipantSlots > 0 ? a.picks / data!.totalParticipantSlots : 0;
        bv = data!.totalParticipantSlots > 0 ? b.picks / data!.totalParticipantSlots : 0;
      } else {
        av = a.picks;
        bv = b.picks;
      }
      return augSortDir === "desc" ? bv - av : av - bv;
    });

    return filtered;
  }, [data, augSearch, augSortKey, augSortDir, augmentData, rarityFilter]);

  const getItemName = useCallback((id: number) => itemData[id]?.name ?? `Item ${id}`, [itemData]);

  const sortedItems = useMemo(() => {
    if (!data) return [];
    const filtered = data.items.filter((it) =>
      getItemName(it.item_id).toLowerCase().includes(itemSearch.toLowerCase()),
    );

    filtered.sort((a, b) => {
      if (itemSortKey === "name") {
        const cmp = getItemName(a.item_id).localeCompare(getItemName(b.item_id));
        return itemSortDir === "asc" ? cmp : -cmp;
      }
      let av: number, bv: number;
      if (itemSortKey === "winRate") {
        av = a.picks > 0 ? a.wins / a.picks : 0;
        bv = b.picks > 0 ? b.wins / b.picks : 0;
      } else {
        av = a.picks;
        bv = b.picks;
      }
      return itemSortDir === "desc" ? bv - av : av - bv;
    });

    return filtered;
  }, [data, itemSearch, itemSortKey, itemSortDir, getItemName]);

  if (!data) {
    return <div className="text-lol-text text-center mt-20">Loading...</div>;
  }

  return (
    <div className="max-w-7xl space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-lol-text-bright">Total Stats</h1>
        <div className="flex items-center gap-3">
          <span className="text-xs text-lol-text">
            {totalGames} games &middot; {data.champions.length} champions &middot;{" "}
            {data.augments.length} augments &middot; {data.items.length} items
          </span>
          <QueueSelect value={queue} onChange={setQueue} />
          <PatchSelect value={patch} onChange={setPatch} />
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => setTab("champions")}
          className={`px-4 py-1.5 text-sm font-medium rounded-lg border transition-colors ${
            tab === "champions"
              ? "bg-lol-gold/20 text-lol-gold border-lol-gold/50"
              : "text-lol-text border-lol-border bg-lol-card hover:border-lol-border/80"
          }`}
        >
          Champions
        </button>
        <button
          onClick={() => setTab("augments")}
          className={`px-4 py-1.5 text-sm font-medium rounded-lg border transition-colors ${
            tab === "augments"
              ? "bg-lol-gold/20 text-lol-gold border-lol-gold/50"
              : "text-lol-text border-lol-border bg-lol-card hover:border-lol-border/80"
          }`}
        >
          Augments
        </button>
        <button
          onClick={() => setTab("items")}
          className={`px-4 py-1.5 text-sm font-medium rounded-lg border transition-colors ${
            tab === "items"
              ? "bg-lol-gold/20 text-lol-gold border-lol-gold/50"
              : "text-lol-text border-lol-border bg-lol-card hover:border-lol-border/80"
          }`}
        >
          Items
        </button>
      </div>

      {tab === "champions" && (
        <>
          <div className="flex items-center justify-between">
            <span className="text-xs text-lol-text">{sortedChampions.length} champions</span>
            <SearchInput
              value={champSearch}
              onChange={setChampSearch}
              placeholder="Search champion..."
            />
          </div>

          <div className="bg-lol-card rounded-xl border border-lol-border/60 overflow-hidden">
            <table className="w-full">
              <thead className="bg-lol-dark/50">
                <tr>
                  <th className="px-3 py-2 text-right text-xs font-medium text-lol-text uppercase tracking-wider w-12">
                    #
                  </th>
                  <SortHeader {...champSort} label="Champion" field="name" />
                  <SortHeader {...champSort} numeric label="Games" field="games" className="w-24" />
                  <SortHeader
                    {...champSort}
                    numeric
                    label="Pick Rate"
                    field="pickRate"
                    className="w-24"
                  />
                  <SortHeader
                    {...champSort}
                    numeric
                    label="Win Rate"
                    field="winRate"
                    className="w-32"
                  />
                </tr>
              </thead>
              <tbody>
                {sortedChampions.map((c, i) => {
                  const pickRate =
                    data.totalParticipantSlots > 0
                      ? ((c.games / data.totalParticipantSlots) * 100).toFixed(1)
                      : "0.0";
                  return (
                    <tr
                      key={c.champion_id}
                      onClick={() => navigate(`/global/champion/${c.champion_id}${filterQuery}`)}
                      className="group border-t border-lol-border/50 hover:bg-lol-card-hover cursor-pointer transition-colors"
                    >
                      <td className="px-3 py-2 text-xs text-lol-text text-right tabular-nums">
                        {i + 1}
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2">
                          <ChampionIcon championId={c.champion_id} size={28} />
                          <span className="text-sm text-lol-text-bright group-hover:text-lol-gold transition-colors">
                            {getChampionName(champData, c.champion_id)}
                          </span>
                        </div>
                      </td>
                      <td className="px-3 py-2 text-sm text-lol-text-bright text-right tabular-nums">
                        {c.games}
                      </td>
                      <td className="px-3 py-2 text-sm text-lol-text text-right tabular-nums">
                        {pickRate}%
                      </td>
                      <td className="px-3 py-2 w-32">
                        <WinRateBar wins={c.wins} total={c.games} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {sortedChampions.length === 0 && (
              <div className="py-8 text-center text-sm text-lol-text">No champions found</div>
            )}
          </div>
        </>
      )}

      {tab === "items" && (
        <>
          <div className="flex items-center justify-between">
            <span className="text-xs text-lol-text">{sortedItems.length} items</span>
            <SearchInput value={itemSearch} onChange={setItemSearch} placeholder="Search item..." />
          </div>

          <div className="bg-lol-card rounded-xl border border-lol-border/60 overflow-hidden">
            <table className="w-full">
              <thead className="bg-lol-dark/50">
                <tr>
                  <SortHeader {...itemSort} label="Item" field="name" />
                  <SortHeader {...itemSort} numeric label="Picks" field="picks" className="w-24" />
                  <th className="px-3 py-2 text-right text-xs font-medium text-lol-text uppercase tracking-wider w-24">
                    Pick Rate
                  </th>
                  <SortHeader
                    {...itemSort}
                    numeric
                    label="Win Rate"
                    field="winRate"
                    className="w-32"
                  />
                </tr>
              </thead>
              <tbody>
                {sortedItems.map((item) => {
                  const pickRate =
                    data.totalParticipantSlots > 0
                      ? ((item.picks / data.totalParticipantSlots) * 100).toFixed(1)
                      : "0.0";
                  return (
                    <tr
                      key={item.item_id}
                      className="border-t border-lol-border/50 hover:bg-lol-card-hover transition-colors"
                    >
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2">
                          <ItemIcon itemId={item.item_id} size={28} patch={patch} />
                          <span className="text-sm text-lol-text-bright">
                            {getItemName(item.item_id)}
                          </span>
                        </div>
                      </td>
                      <td className="px-3 py-2 text-sm text-lol-text-bright text-right tabular-nums">
                        {item.picks}
                      </td>
                      <td className="px-3 py-2 text-sm text-lol-text text-right tabular-nums">
                        {pickRate}%
                      </td>
                      <td className="px-3 py-2 w-32">
                        <WinRateBar wins={item.wins} total={item.picks} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {sortedItems.length === 0 && (
              <div className="py-8 text-center text-sm text-lol-text">No items found</div>
            )}
          </div>
        </>
      )}

      {tab === "augments" && (
        <>
          <div className="flex items-center gap-2">
            <RarityFilter value={rarityFilter} onChange={setRarityFilter} />
            <span className="text-xs text-lol-text self-center ml-2">
              {sortedAugments.length} augments
            </span>
            <div className="ml-auto">
              <SearchInput
                value={augSearch}
                onChange={setAugSearch}
                placeholder="Search augment..."
              />
            </div>
          </div>

          <div className="bg-lol-card rounded-xl border border-lol-border/60 overflow-hidden">
            <table className="w-full">
              <thead className="bg-lol-dark/50">
                <tr>
                  <SortHeader {...augSort} label="Augment" field="name" />
                  <SortHeader {...augSort} numeric label="Picks" field="picks" className="w-24" />
                  <th className="px-3 py-2 text-right text-xs font-medium text-lol-text uppercase tracking-wider w-24">
                    Pick Rate
                  </th>
                  <SortHeader
                    {...augSort}
                    numeric
                    label="Win Rate"
                    field="winRate"
                    className="w-32"
                  />
                </tr>
              </thead>
              <tbody>
                {sortedAugments.map((a) => {
                  const pickRate =
                    data.totalParticipantSlots > 0
                      ? ((a.picks / data.totalParticipantSlots) * 100).toFixed(1)
                      : "0.0";
                  return (
                    <tr
                      key={a.augment_id}
                      className="border-t border-lol-border/50 hover:bg-lol-card-hover transition-colors"
                    >
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
                  );
                })}
              </tbody>
            </table>
            {sortedAugments.length === 0 && (
              <div className="py-8 text-center text-sm text-lol-text">No augments found</div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
