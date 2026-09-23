import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useChampionData } from "../hooks/useChampions";
import { useLcuStatus } from "../hooks/useLcuStatus";
import { useLiveGame } from "../hooks/useLiveGame";
import type {
  ChampionData,
  GameRecap as GameRecapData,
  LcuStatus,
  LiveGameSnapshot,
} from "../lib/types";
import { MAYHEM_QUEUE_IDS } from "../../shared/queues";
import { formatDuration } from "../lib/format";
import { queueLabel } from "../components/QueueSelect";
import GameRecap from "../components/GameRecap";
import LiveScoreboard, { LiveEventFeed } from "../components/LiveScoreboard";
import { MapPinIcon, RadioIcon, SwordsIcon } from "../components/icons";
import {
  ExportImageButton,
  ExportImageMessage,
  useGameImageExport,
} from "../components/ExportImage";

// How long to keep waiting for a finished game's results before giving up and
// showing the most recent recorded one instead. The post-game capture normally
// lands within seconds; this only matters when the client never publishes the
// game at all, which a dodged or unfinished match manages.
const RESULT_WAIT_MS = 90_000;
const RESULT_RETRY_MS = 4_000;

// Whether a finished game is one the app would have stored, so the page knows
// whether to wait for results at all. A game in some other queue is recorded
// nowhere and would leave the page waiting forever.
function isTrackedQueue(queueId: number | null): boolean {
  return queueId != null && MAYHEM_QUEUE_IDS.includes(queueId);
}

export default function LiveGame() {
  const { snapshot, receivedAt, lastGame } = useLiveGame();
  const status = useLcuStatus();
  const champData = useChampionData();
  const [puuids, setPuuids] = useState<string[] | null>(null);

  useEffect(() => {
    window.api.getAllSummonerPuuids().then(setPuuids);
  }, []);

  // Nothing has been asked yet, as opposed to asked and answered with no game
  if (!snapshot) return <div className="mt-20 text-center text-lol-text">Loading...</div>;

  if (snapshot.inGame || snapshot.starting) {
    return <LiveView snapshot={snapshot} receivedAt={receivedAt} champData={champData} />;
  }

  // Null means "whatever the newest recorded game is", which is what the page
  // falls back to on a fresh launch and after a game that was never stored.
  // The snapshot carries the last game the main process saw, which is what
  // covers leaving the tab and coming back before the results have landed.
  const watching =
    lastGame ??
    (snapshot.gameId != null ? { gameId: snapshot.gameId, queueId: snapshot.queueId } : null);
  const target = watching && isTrackedQueue(watching.queueId) ? watching.gameId : null;

  return <RecapView target={target} champData={champData} puuids={puuids} status={status} />;
}

// ---- Live ----

function LiveView({
  snapshot,
  receivedAt,
  champData,
}: {
  snapshot: LiveGameSnapshot;
  receivedAt: number;
  champData: ChampionData;
}) {
  // The clock runs between polls rather than jumping three seconds at a time
  const [now, setNow] = useState(receivedAt);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const elapsed = snapshot.gameTime + Math.max(0, Math.floor((now - receivedAt) / 1000));

  const teamKills = useMemo(() => {
    const totals = { 100: 0, 200: 0 } as Record<number, number>;
    for (const player of snapshot.players) totals[player.teamId] += player.kills;
    return totals;
  }, [snapshot.players]);

  if (snapshot.players.length === 0) {
    return (
      <div className="max-w-7xl space-y-4">
        <LiveHeader snapshot={snapshot} elapsed={0} teamKills={teamKills} />
        <div className="rounded-xl border border-lol-border/60 bg-lol-card p-10 text-center text-sm text-lol-text">
          The game is loading. Champions, items and scores appear as soon as it starts.
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl space-y-4">
      <LiveHeader snapshot={snapshot} elapsed={elapsed} teamKills={teamKills} />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(0,1fr)]">
        <LiveScoreboard players={snapshot.players} champData={champData} />

        <div className="rounded-xl border border-lol-border/60 bg-lol-card p-4">
          <div className="mb-2 flex items-baseline gap-2">
            <SwordsIcon className="h-3.5 w-3.5 text-lol-text" />
            <span className="text-sm font-semibold text-lol-text-bright">Feed</span>
          </div>
          <LiveEventFeed events={snapshot.events} />
        </div>
      </div>
    </div>
  );
}

function LiveHeader({
  snapshot,
  elapsed,
  teamKills,
}: {
  snapshot: LiveGameSnapshot;
  elapsed: number;
  teamKills: Record<number, number>;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-lol-border/60 bg-lol-card px-4 py-3">
      <span className="flex items-center gap-2 text-sm font-bold text-lol-text-bright">
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-lol-loss opacity-75" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-lol-loss" />
        </span>
        {snapshot.inGame ? "Live" : "Starting"}
      </span>

      {snapshot.mapName && (
        <span className="inline-flex items-center gap-1 rounded-md border border-lol-border bg-white/5 px-2 py-0.5 text-[11px] text-lol-text-bright">
          <MapPinIcon className="h-3 w-3" />
          {snapshot.mapName}
        </span>
      )}
      {snapshot.queueId != null && snapshot.queueId > 0 && (
        <span className="text-[11px] text-lol-text">{queueLabel(snapshot.queueId)}</span>
      )}

      <div className="ml-auto flex items-center gap-4">
        {snapshot.inGame && (
          <span className="text-sm font-semibold">
            <span className="text-sky-400">{teamKills[100] ?? 0}</span>
            <span className="mx-1.5 text-lol-text/40">vs</span>
            <span className="text-lol-loss">{teamKills[200] ?? 0}</span>
          </span>
        )}
        <span className="text-lg font-bold tabular-nums text-lol-text-bright">
          {formatDuration(elapsed)}
        </span>
      </div>
    </div>
  );
}

// ---- Recap ----

function RecapView({
  target,
  champData,
  puuids,
  status,
}: {
  target: number | null;
  champData: ChampionData;
  puuids: string[] | null;
  status: LcuStatus;
}) {
  const [recap, setRecap] = useState<GameRecapData | null>(null);
  const [loading, setLoading] = useState(true);
  const exporting = useGameImageExport();
  // Set when a game finished but its results never turned up, so the page can
  // say why it is showing an older one
  const [gaveUp, setGaveUp] = useState(false);

  const resolved = target == null ? recap != null : recap?.detail.game.game_id === target;

  const load = useCallback(async () => {
    const result = await window.api.getGameRecap(target ?? undefined);
    setLoading(false);
    if (!result) return;
    setRecap((previous) => {
      // While waiting on one specific game, an older one is worth showing only
      // until the real answer arrives, never in place of it
      if (target != null && result.detail.game.game_id !== target && previous != null) {
        return previous;
      }
      return result;
    });
  }, [target]);

  // A new target starts a wait of its own. The recap already on screen stays
  // until the new one arrives, which is what lets it stand in meanwhile.
  const [waitingFor, setWaitingFor] = useState(target);
  if (waitingFor !== target) {
    setWaitingFor(target);
    setGaveUp(false);
    setLoading(true);
  }

  useEffect(() => {
    let cancelled = false;
    const run = () => {
      if (!cancelled) void load();
    };
    run();

    // Nothing left to wait for once the game we asked about has landed
    if (resolved)
      return () => {
        cancelled = true;
      };

    const started = Date.now();
    const timer = setInterval(() => {
      if (Date.now() - started > RESULT_WAIT_MS) {
        clearInterval(timer);
        setGaveUp(true);
        return;
      }
      run();
    }, RESULT_RETRY_MS);
    const unsub = window.api.onGamesUpdated(run);

    return () => {
      cancelled = true;
      clearInterval(timer);
      unsub();
    };
  }, [load, resolved]);

  const waiting = target != null && !resolved && !gaveUp;

  if (waiting) {
    return (
      <div className="max-w-7xl space-y-4">
        <div className="rounded-xl border border-lol-border/60 bg-lol-card p-10 text-center">
          <div className="text-sm text-lol-text-bright">Game over. Fetching the results...</div>
          <div className="mt-1 text-[11px] text-lol-text">
            The client publishes the scoreboard a few seconds after the nexus falls.
          </div>
        </div>
        {recap && (
          <GameRecap
            recap={recap}
            champData={champData}
            puuids={puuids}
            heading={
              <RecapHeading recap={recap} exporting={exporting}>
                <span className="text-xs text-lol-text">Meanwhile, the game before it:</span>
              </RecapHeading>
            }
          />
        )}
        <ExportImageMessage message={exporting.message} />
      </div>
    );
  }

  if (loading && !recap) {
    return <div className="mt-20 text-center text-lol-text">Loading...</div>;
  }

  if (!recap) {
    return (
      <div className="max-w-7xl">
        <div className="rounded-xl border border-lol-border/60 bg-lol-card py-16 text-center text-sm text-lol-text">
          {status === "disconnected"
            ? "Start the League client and this tab follows your next game live."
            : "No recorded games yet. Play a Mayhem game and it shows up here the moment it ends."}
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl">
      <GameRecap
        recap={recap}
        champData={champData}
        puuids={puuids}
        heading={
          <RecapHeading recap={recap} exporting={exporting}>
            <RadioIcon className="h-3.5 w-3.5 text-lol-text" />
            <span className="text-xs text-lol-text">
              {gaveUp
                ? "That game never produced results, so here is your most recent recorded one."
                : "Your most recent game. This tab switches to a live scoreboard when the next one starts."}
            </span>
          </RecapHeading>
        }
      />
      <ExportImageMessage message={exporting.message} />
    </div>
  );
}

// The line above the recap: what this game is, and what can be done with it
// besides read it.
function RecapHeading({
  recap,
  exporting,
  children,
}: {
  recap: GameRecapData;
  exporting: ReturnType<typeof useGameImageExport>;
  children: ReactNode;
}) {
  const gameId = recap.detail.game.game_id;

  return (
    <div className="flex items-center gap-2 px-1">
      {children}
      <div className="ml-auto flex items-center gap-2">
        <ExportImageButton
          action="copy"
          busy={exporting.busyWith(gameId, "copy")}
          onClick={() => exporting.run(gameId, "copy")}
        />
        <ExportImageButton
          action="save"
          busy={exporting.busyWith(gameId, "save")}
          onClick={() => exporting.run(gameId, "save")}
        />
      </div>
    </div>
  );
}
