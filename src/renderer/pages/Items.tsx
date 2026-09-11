import { useMemo, useState } from "react";
import { useHistoryScopeQueue } from "../lib/historyScope";
import { useIpc } from "../hooks/useIpc";
import { useItemData, getItemName } from "../hooks/useChampions";
import type { ItemStats } from "../lib/types";
import ItemIcon from "../components/ItemIcon";
import WinRateBar from "../components/WinRateBar";
import { useNavigate } from "react-router-dom";
import { useParams } from "react-router-dom";

export default function Items() {
  const queue = useHistoryScopeQueue();
  const navigate = useNavigate();
  const { scope } = useParams<{ scope?: string }>();
  const data = useItemData();
  const { data: stats, loading } = useIpc<ItemStats[]>(
    () => window.api.getOwnedItemStats(undefined, queue),
    [queue],
  );
  const [sortDesc, setSortDesc] = useState(true);
  const [sortKey, setSortKey] = useState<"index" | "name" | "games" | "pickRate" | "winRate">(
    "games",
  );
  const [search, setSearch] = useState("");
  const items = useMemo(() => {
    if (!stats) return [];
    const sorted = stats.filter((item) =>
      getItemName(data, item.item_id).toLowerCase().includes(search.toLowerCase()),
    );
    sorted.sort((a, b) => {
      const aName = getItemName(data, a.item_id);
      const bName = getItemName(data, b.item_id);
      let result =
        sortKey === "name"
          ? aName.localeCompare(bName)
          : sortKey === "winRate"
            ? a.wins / Math.max(a.picks, 1) - b.wins / Math.max(b.picks, 1)
            : sortKey === "pickRate" || sortKey === "games"
              ? a.picks - b.picks
              : a.item_id - b.item_id;
      if (sortDesc) result *= -1;
      return result || aName.localeCompare(bName);
    });
    return sorted;
  }, [data, search, sortDesc, sortKey, stats]);
  const toggleSort = (key: typeof sortKey) => {
    if (sortKey === key) setSortDesc((value) => !value);
    else {
      setSortKey(key);
      setSortDesc(key !== "name");
    }
  };
  if (loading || !stats) return <div className="mt-20 text-center text-lol-text">Loading...</div>;
  const total = stats.reduce((sum, item) => sum + item.picks, 0);
  return (
    <div className="max-w-6xl space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-sm text-lol-text">Item popularity</span>
        <div className="flex gap-2">
          <input
            className="input w-48"
            placeholder="Search item..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>
      <div className="overflow-hidden rounded-xl border border-lol-border/60 bg-lol-card">
        <table className="w-full">
          <thead className="bg-lol-dark/50">
            <tr>
              <th
                className="px-3 py-2 text-left text-xs text-lol-text cursor-pointer"
                onClick={() => toggleSort("index")}
              >
                # {sortKey === "index" ? (sortDesc ? "▼" : "▲") : ""}
              </th>
              <th
                className="px-3 py-2 text-left text-xs text-lol-text cursor-pointer"
                onClick={() => toggleSort("name")}
              >
                ITEM {sortKey === "name" ? (sortDesc ? "▼" : "▲") : ""}
              </th>
              <th
                className="px-3 py-2 text-left text-xs text-lol-text cursor-pointer"
                onClick={() => setSortDesc((v) => !v)}
              >
                GAMES {sortKey === "games" ? (sortDesc ? "▼" : "▲") : ""}
              </th>
              <th
                className="px-3 py-2 text-left text-xs text-lol-text cursor-pointer"
                onClick={() => toggleSort("pickRate")}
              >
                PICK RATE {sortKey === "pickRate" ? (sortDesc ? "▼" : "▲") : ""}
              </th>
              <th
                className="px-3 py-2 text-left text-xs text-lol-text cursor-pointer"
                onClick={() => toggleSort("winRate")}
              >
                WIN RATE {sortKey === "winRate" ? (sortDesc ? "▼" : "▲") : ""}
              </th>
            </tr>
          </thead>
          <tbody>
            {items.map((item, index) => {
              const name = getItemName(data, item.item_id);
              return (
                <tr
                  key={item.item_id}
                  onClick={() => navigate(`/history/${scope ?? "full"}/items/${item.item_id}`)}
                  className="border-t border-lol-border/50 hover:bg-lol-card-hover cursor-pointer"
                >
                  <td className="px-3 py-2 text-xs text-lol-text">{index + 1}</td>
                  <td className="px-3 py-2">
                    <span className="flex items-center gap-2 text-sm text-lol-text-bright">
                      <ItemIcon itemId={item.item_id} size={28} />
                      {name}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-sm text-lol-text-bright">{item.picks}</td>
                  <td className="px-3 py-2 text-sm text-lol-text">
                    {total ? `${((item.picks / total) * 100).toFixed(1)}%` : "0.0%"}
                  </td>
                  <td className="px-3 py-2">
                    <WinRateBar wins={item.wins} total={item.picks} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
