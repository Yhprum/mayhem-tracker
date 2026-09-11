import { useMemo, useState, useEffect } from "react";
import type { RuneOverview } from "../lib/types";
import WinRateBar from "../components/WinRateBar";
import ChampionIcon from "../components/ChampionIcon";
import RuneIcon from "../components/RuneIcon";
import { useIpc } from "../hooks/useIpc";
import { useChampionData, getChampionName } from "../hooks/useChampions";
import QueueSelect from "../components/QueueSelect";
import PatchSelect from "../components/PatchSelect";

export default function Runes({ queue }: { queue?: number }) {
  const [selectedQueue, setSelectedQueue] = useState<number | undefined>(queue);
  const [patch, setPatch] = useState<string | undefined>();
  useEffect(() => setSelectedQueue(queue), [queue]);
  const champions = useChampionData();
  const { data, loading } = useIpc<RuneOverview>(
    () => window.api.getOwnedRuneStats(selectedQueue, patch),
    [selectedQueue, patch],
  );
  const { data: runeData } = useIpc(() => window.api.getRuneData());
  const [search, setSearch] = useState("");
  const fallbackKeystones = new Set([
    8005, 8007, 8009, 8010, 8021, 8112, 8124, 8128, 8214, 8229, 8237, 8351, 8360, 8369, 8437, 8439,
    8465, 9923,
  ]);
  const rows = useMemo(() => {
    const result = (data?.runes ?? []).filter((r) => String(r.rune_id).includes(search));
    return result.sort((a, b) => b.picks - a.picks);
  }, [data, search]);
  const renderGroup = (title: string, category: "keystone" | "secondary") => {
    const group = rows.filter((r) => {
      const metadata = runeData?.[r.rune_id];
      // Keep stored rune usage visible even when Riot's metadata request is
      // temporarily unavailable; unknown entries belong in the secondary list.
      return (
        metadata?.category === category ||
        (!metadata &&
          (fallbackKeystones.has(r.rune_id) ? category === "keystone" : category === "secondary"))
      );
    });
    return (
      <section className="space-y-2">
        <h2 className="text-sm font-semibold uppercase text-lol-text-bright">{title}</h2>
        <div className="overflow-hidden rounded-xl border border-lol-border/60 bg-lol-card">
          <table className="w-full">
            <thead className="bg-lol-dark/50">
              <tr>
                <th className="px-3 py-2 text-left text-xs text-lol-text">#</th>
                <th className="px-3 py-2 text-left text-xs text-lol-text">RUNE</th>
                <th className="px-3 py-2 text-left text-xs text-lol-text">GAMES</th>
                <th className="px-3 py-2 text-left text-xs text-lol-text">WIN RATE</th>
              </tr>
            </thead>
            <tbody>
              {group.map((r, index) => (
                <tr key={r.rune_id} className="border-t border-lol-border/50">
                  <td className="px-3 py-2 text-xs text-lol-text">{index + 1}</td>
                  <td className="px-3 py-2">
                    <span className="flex items-center gap-2 text-sm text-lol-text-bright">
                      <RuneIcon
                        runeId={r.rune_id}
                        path={runeData?.[r.rune_id]?.icon}
                        size={28}
                      />
                      {runeData?.[r.rune_id]?.name ?? `Rune ${r.rune_id}`}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-sm text-lol-text-bright">{r.picks}</td>
                  <td className="px-3 py-2">
                    <WinRateBar wins={r.wins} total={r.picks} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    );
  };
  if (loading) return <div className="mt-20 text-center text-lol-text">Loading...</div>;
  return (
    <div className="max-w-6xl space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-sm text-lol-text">Rune popularity</span>
        <div className="flex gap-2">
          {queue == null && <QueueSelect value={selectedQueue} onChange={setSelectedQueue} />}
          <PatchSelect
            value={patch}
            onChange={(value) => {
              setPatch(value);
              // Rune payloads are archived by match and the backend currently
              // has no patch argument; patch selection is metadata/icon-only.
            }}
          />
          <input
            className="input w-48"
            placeholder="Search rune ID..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>
      {renderGroup("Keystones", "keystone")}
      {renderGroup("Secondaries", "secondary")}
      {!data?.runes?.length && (
        <div className="rounded-xl border border-lol-border/60 bg-lol-card p-6 text-center text-sm text-lol-text">
          No rune data is available in the archived match payloads for this history scope.
        </div>
      )}
      <section className="space-y-2">
        <h2 className="text-sm font-semibold uppercase text-lol-text-bright">
          Champions and most-used keystones
        </h2>
        <div className="grid gap-2 md:grid-cols-2">
          {(data?.champions ?? []).map((champion) => (
            <div
              key={champion.champion_id}
              className="flex items-center gap-3 rounded-xl border border-lol-border/60 bg-lol-card px-3 py-2"
            >
              <ChampionIcon championId={champion.champion_id} size={32} />
              <span className="min-w-0 flex-1 truncate text-sm text-lol-text-bright">
                {getChampionName(champions, champion.champion_id)}
              </span>
              <div className="flex items-center gap-2">
                {champion.keystones.map((rune) => (
                  <span key={rune.rune_id} className="flex flex-col items-center gap-0.5">
                    <RuneIcon
                      runeId={rune.rune_id}
                      path={runeData?.[rune.rune_id]?.icon}
                      size={28}
                    />
                    <span className="text-[10px] text-lol-text">{rune.picks}</span>
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
