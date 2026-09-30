import { useEffect, useRef, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { useIpc } from "../hooks/useIpc";
import { useViewState } from "../hooks/useViewState";
import { useChampionData } from "../hooks/useChampions";
import type { SeasonRecap as SeasonRecapData, SeasonSummary } from "../lib/types";
import { CARD_WIDTH, type CardSpec } from "../../shared/card";
import { LOCALE } from "../lib/format";
import SeasonRecapCard from "../components/SeasonRecapCard";
import QueueSelect from "../components/QueueSelect";
import AccountSelect from "../components/AccountSelect";
import { ExportImageButton, ExportImageMessage, useImageExport } from "../components/ExportImage";
import { EyeOffIcon } from "../components/icons";

function seasonOption(season: SeasonSummary): string {
  const games = `${season.games.toLocaleString(LOCALE)} ${season.games === 1 ? "game" : "games"}`;
  return `${season.name} (${games})`;
}

export default function SeasonRecap() {
  // Unset until chosen, which asks for the latest season with games in it
  const [seasonId, setSeasonId] = useViewState<string | undefined>("season.id", undefined);
  const [queue, setQueue] = useViewState<number | undefined>("season.queue", undefined);
  const [account, setAccount] = useViewState<string | undefined>("season.account", undefined);
  const [hideFriends, setHideFriends] = useViewState("season.hideFriends", false);

  // The sidebar's badge links here naming the season that just ended. That
  // becomes the selection like any other pick, then leaves the address so a
  // later pick from the menu isn't overridden by it.
  const [params, setParams] = useSearchParams();
  const linked = params.get("season");
  if (linked && linked !== seasonId) setSeasonId(linked);
  useEffect(() => {
    if (linked) setParams({}, { replace: true });
  }, [linked, setParams]);

  const { data, loading, refetch } = useIpc<SeasonRecapData | null>(
    () => window.api.getSeasonRecap(seasonId, queue, account),
    [seasonId, queue, account],
  );
  const champData = useChampionData();
  const exporting = useImageExport();

  useEffect(() => {
    const unsub = window.api.onGamesUpdated(() => refetch());
    return unsub;
  }, [refetch]);

  // A pick that isn't on offer, a remembered season this build no longer lists
  // say, goes back to the default
  useEffect(() => {
    if (!loading && data === null && seasonId !== undefined) setSeasonId(undefined);
  }, [loading, data, seasonId, setSeasonId]);

  if (!data) {
    return <div className="text-lol-text text-center mt-20">Loading...</div>;
  }

  // The season on show, which is the one picked or the default while none has
  // been
  const card: CardSpec = {
    kind: "season",
    seasonId: data.season.id,
    queue,
    account,
    hideFriends,
  };

  return (
    <div className="max-w-7xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-bold text-lol-text-bright">Season Recap</h1>
        <div className="flex items-center gap-3">
          <select
            value={data.season.id}
            onChange={(e) => setSeasonId(e.target.value)}
            className="select"
          >
            {data.seasons.map((season) => (
              <option
                key={season.id}
                value={season.id}
                disabled={season.games === 0 && season.id !== data.season.id}
              >
                {seasonOption(season)}
              </option>
            ))}
          </select>
          <AccountSelect value={account} onChange={setAccount} />
          <QueueSelect value={queue} onChange={setQueue} />
          {data.friends.length > 0 && (
            <button
              onClick={() => setHideFriends((v) => !v)}
              aria-pressed={hideFriends}
              title={
                hideFriends
                  ? "Your friends' names are hidden on the card"
                  : "Hide your friends' names on the card, for sharing"
              }
              className={`flex items-center gap-1.5 rounded-lg border px-2 py-1 text-xs transition-colors ${
                hideFriends
                  ? "border-lol-gold/60 bg-lol-gold/10 text-lol-gold"
                  : "border-lol-border bg-lol-card text-lol-text hover:border-lol-gold/60 hover:text-lol-text-bright"
              }`}
            >
              <EyeOffIcon className="h-3.5 w-3.5" />
              Hide friends
            </button>
          )}
          {data.games > 0 && (
            <>
              <ExportImageButton action="copy" card={card} exporting={exporting} />
              <ExportImageButton action="save" card={card} exporting={exporting} />
            </>
          )}
        </div>
      </div>

      {data.games === 0 ? (
        <div className="bg-lol-card rounded-xl border border-lol-border/60 py-16 text-center text-sm text-lol-text">
          {account || queue != null
            ? "No games in this season match this filter."
            : "No games recorded in this season."}
        </div>
      ) : (
        <CardPreview>
          <SeasonRecapCard recap={data} champData={champData} hideFriends={hideFriends} />
        </CardPreview>
      )}

      <ExportImageMessage message={exporting.message} />
    </div>
  );
}

// The card at the width it is exported at, zoomed down to whatever room the
// page has. Reflowing it to fit instead would preview a different layout from
// the image that gets saved.
function CardPreview({ children }: { children: ReactNode }) {
  const frame = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);

  useEffect(() => {
    const el = frame.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      setZoom(Math.min(1, entry.contentRect.width / CARD_WIDTH));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={frame} className="overflow-hidden rounded-xl border border-lol-border/60 bg-lol-dark">
      <div className="p-6" style={{ width: CARD_WIDTH, zoom }}>
        {children}
      </div>
    </div>
  );
}
