import { useEffect, useState } from "react";
import { useIpc } from "../hooks/useIpc";
import { useViewState } from "../hooks/useViewState";
import { useChampionData, getChampionName } from "../hooks/useChampions";
import type { ChampionData, MatchDetail, RecordMatchRef, RecordsData } from "../lib/types";
import ChampionIcon from "../components/ChampionIcon";
import MatchScoreboard from "../components/MatchScoreboard";
import QueueSelect, { queueLabel } from "../components/QueueSelect";
import AccountSelect from "../components/AccountSelect";
import { RecordCard, recordCards, recordDate, streakCard } from "../components/RecordCard";
import { XIcon } from "../components/icons";
import { formatDuration } from "../lib/format";
import Kda from "../components/Kda";

// ---- Match modal ----

// Records live outside the match list, so their games open here rather than
// deep-linking into an infinitely-scrolled page.
function MatchModal({
  match,
  champData,
  puuids,
  onClose,
}: {
  match: RecordMatchRef;
  champData: ChampionData;
  puuids: string[] | null;
  onClose: () => void;
}) {
  const { data: detail } = useIpc<MatchDetail | null>(
    () => window.api.getMatchDetail(match.game_id),
    [match.game_id],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6"
      onClick={onClose}
    >
      <div
        className="w-full max-w-5xl max-h-full overflow-y-auto rounded-xl border border-lol-border bg-lol-card p-4 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 mb-3">
          <ChampionIcon championId={match.champion_id} size={36} />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-bold text-lol-text-bright truncate">
              <span className={match.win ? "text-lol-win" : "text-lol-loss"}>
                {match.win ? "Victory" : "Defeat"}
              </span>
              {" — "}
              {getChampionName(champData, match.champion_id)}{" "}
              <Kda kills={match.kills} deaths={match.deaths} assists={match.assists} />
            </div>
            <div className="text-xs text-lol-text truncate">
              {queueLabel(match.queue_id)} · {formatDuration(match.game_duration)} ·{" "}
              {recordDate(match.game_creation)}
            </div>
          </div>
          <button
            onClick={onClose}
            className="shrink-0 flex h-7 w-7 items-center justify-center rounded-md text-lol-text hover:bg-white/5 hover:text-lol-text-bright transition-colors"
          >
            <XIcon className="w-4 h-4" />
          </button>
        </div>
        <div className="overflow-x-auto">
          {detail ? (
            <MatchScoreboard detail={detail} champData={champData} puuids={puuids} />
          ) : (
            <div className="text-sm text-lol-text text-center py-8">Loading...</div>
          )}
        </div>
      </div>
    </div>
  );
}

// ---- Page ----

export default function Records() {
  const [queue, setQueue] = useViewState<number | undefined>("records.queue", undefined);
  const [account, setAccount] = useViewState<string | undefined>("records.account", undefined);

  const { data, refetch } = useIpc<RecordsData>(
    () => window.api.getRecords(queue, account),
    [queue, account],
  );
  const champData = useChampionData();
  const [puuids, setPuuids] = useState<string[] | null>(null);
  const [openMatch, setOpenMatch] = useState<RecordMatchRef | null>(null);

  useEffect(() => {
    window.api.getAllSummonerPuuids().then(setPuuids);
  }, []);

  useEffect(() => {
    const unsub = window.api.onGamesUpdated(() => refetch());
    return unsub;
  }, [refetch]);

  if (!data) {
    return <div className="text-lol-text text-center mt-20">Loading...</div>;
  }

  // The filters stay on screen even with nothing to show, so a selection that
  // happens to hold no games can be undone
  const header = (
    <div className="flex items-center justify-between">
      <h1 className="text-xl font-bold text-lol-text-bright">Records</h1>
      <div className="flex items-center gap-3">
        <span className="text-xs text-lol-text">
          personal bests across {data.totalGames} {data.totalGames === 1 ? "game" : "games"}
        </span>
        <AccountSelect value={account} onChange={setAccount} />
        <QueueSelect value={queue} onChange={setQueue} />
      </div>
    </div>
  );

  if (data.totalGames === 0) {
    return (
      <div className="max-w-7xl space-y-4">
        {header}
        <div className="bg-lol-card rounded-xl border border-lol-border/60 py-16 text-center text-sm text-lol-text">
          {account || queue != null
            ? "No games match this filter."
            : "No games recorded yet — sync your match history to start setting records."}
        </div>
      </div>
    );
  }

  const cards = recordCards(data.bests);
  if (data.winStreak) cards.push(streakCard(data.winStreak, true));
  if (data.lossStreak && data.lossStreak.length > 1) {
    // A single loss is just a loss; it only becomes a "streak" worth
    // memorializing at two.
    cards.push(streakCard(data.lossStreak, false));
  }

  return (
    <div className="max-w-7xl space-y-4">
      {header}

      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 items-stretch">
        {cards.map(({ key, ...card }) => (
          <RecordCard key={key} {...card} champData={champData} onOpen={setOpenMatch} />
        ))}
      </div>

      {openMatch && (
        <MatchModal
          match={openMatch}
          champData={champData}
          puuids={puuids}
          onClose={() => setOpenMatch(null)}
        />
      )}
    </div>
  );
}
