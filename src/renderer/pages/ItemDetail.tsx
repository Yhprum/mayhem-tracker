import { Link, useParams } from "react-router-dom";
import { useState } from "react";
import { useIpc } from "../hooks/useIpc";
import { useHistoryScopeQueue } from "../lib/historyScope";
import { useItemData, getItemName, useChampionData, getChampionName } from "../hooks/useChampions";
import ItemIcon from "../components/ItemIcon";
import ChampionIcon from "../components/ChampionIcon";
import WinRateBar from "../components/WinRateBar";
import type { ItemDetail as ItemDetailData } from "../lib/types";
import RiotText from "../components/RiotText";

export default function ItemDetail() {
  const { itemId, scope = "full" } = useParams<{ itemId: string; scope?: string }>();
  const id = Number(itemId);
  const queue = useHistoryScopeQueue(scope);
  const items = useItemData();
  const champions = useChampionData();
  const [expandedChampion, setExpandedChampion] = useState<number | null>(null);
  const { data, loading } = useIpc<ItemDetailData>(
    () => window.api.getOwnedItemDetail(id, undefined, queue),
    [id, queue],
  );
  if (loading || !data) return <div className="mt-20 text-center text-lol-text">Loading...</div>;
  const back = `/history/${scope}/items`;
  const item = items[id];
  const winRate = data.picks ? (data.wins / data.picks) * 100 : 0;
  const buildRate = data.totalGames ? (data.picks / data.totalGames) * 100 : 0;
  return (
    <div className="max-w-6xl space-y-5">
      <Link to={back} className="text-xs text-lol-text hover:text-lol-gold">
        ← Item Stats
      </Link>
      <div className="grid grid-cols-[12rem_1fr_18rem] gap-4">
        <div>
          <div className="rounded-lg border-4 border-lol-border/80 p-1">
            <ItemIcon itemId={id} size={176} />
          </div>
          {item?.from && item.from.length > 0 && (
            <div className="mt-2 flex flex-wrap items-center gap-1">
              {item.from.map((component, index) => (
                <span key={component} className="flex items-center gap-1">
                  {index > 0 && <span className="text-xs font-bold text-lol-gold">+</span>}
                  <ItemIcon itemId={component} size={28} />
                </span>
              ))}
            </div>
          )}
        </div>
        <div className="rounded-xl border border-lol-border/60 bg-lol-card p-5">
          <h1 className="text-2xl font-bold text-lol-text-bright">{getItemName(items, id)}</h1>
          <p className="mt-3 text-sm text-lol-text">
            Built in {data.picks} games across saved history.
          </p>
          <p className="mt-4 text-sm text-lol-text">
            <RiotText markup={item?.description ?? "No item description available."} />
          </p>
        </div>
        <div className="space-y-3">
          <div className="rounded-xl border border-lol-border/60 bg-lol-card p-4">
            <span className="text-xs text-lol-text">PRICE</span>
            <div className="text-2xl font-bold text-lol-gold">{item?.price ?? "—"}</div>
          </div>
          <div className="rounded-xl border border-lol-border/60 bg-lol-card p-4">
            <span className="text-xs text-lol-text">WIN RATE</span>
            <div className="text-2xl font-bold text-lol-text-bright">{winRate.toFixed(1)}%</div>
            <div className="text-sm">
              <span className="text-lol-win">{data.wins}W</span>{" "}
              <span className="text-lol-loss">{data.picks - data.wins}L</span>
            </div>
            <WinRateBar wins={data.wins} total={data.picks} />
          </div>
          <div className="rounded-xl border border-lol-border/60 bg-lol-card p-4">
            <span className="text-xs text-lol-text">BUILD RATE</span>
            <div className="text-2xl font-bold text-lol-text-bright">{buildRate.toFixed(1)}%</div>
            <div className="text-sm text-lol-text">
              {data.picks} of {data.totalGames} games
            </div>
          </div>
        </div>
      </div>
      <h2 className="text-sm font-semibold uppercase text-lol-text-bright">Champions</h2>
      <div className="rounded-xl border border-lol-border/60 bg-lol-card">
        {data.champions.map((row) => (
          <div key={row.champion_id}>
            <button
              type="button"
              onClick={() =>
                setExpandedChampion((current) =>
                  current === row.champion_id ? null : row.champion_id,
                )
              }
              className="flex min-h-12 w-full items-center gap-3 border-b border-lol-border/40 px-4 py-2 text-left transition-colors hover:bg-white/[0.03]"
            >
              <ChampionIcon championId={row.champion_id} size={30} />
              <span className="min-w-0 flex-1 text-sm text-lol-text-bright">
                {getChampionName(champions, row.champion_id)}
              </span>
              <span className="w-20 shrink-0 text-right text-xs text-lol-text">
                {row.games} of {row.championGames} games
              </span>
              <div className="w-28 shrink-0">
                <WinRateBar wins={row.wins} total={row.games} />
              </div>
            </button>
            {expandedChampion === row.champion_id && (
              <div className="border-b border-lol-border/40 bg-lol-dark/30 px-6 py-2">
                {(row.matches ?? []).length > 0 ? (
                  row.matches.map((match) => (
                    <div
                      key={match.game_id}
                      className="flex items-center gap-3 border-b border-lol-border/30 py-2 text-xs text-lol-text last:border-0"
                    >
                      <span className={match.win ? "text-lol-win" : "text-lol-loss"}>
                        {match.win ? "WIN" : "LOSS"}
                      </span>
                      <span className="text-lol-text-bright">
                        {match.kills} / {match.deaths} / {match.assists}
                      </span>
                      <span>{Math.floor(match.game_duration / 60)}m</span>
                      <span className="ml-auto">
                        {new Date(match.game_creation).toLocaleDateString()}
                      </span>
                    </div>
                  ))
                ) : (
                  <div className="py-2 text-xs text-lol-text">No matching games found.</div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
