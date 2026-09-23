import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import type { GameCardData } from "../lib/types";
import { useChampionData } from "../hooks/useChampions";
import { formatDateTime, formatDuration } from "../lib/format";
import { CARD_STATUS_KEY, type CardStatus } from "../../shared/card";
import MatchScoreboard from "../components/MatchScoreboard";
import SummonerIcon from "../components/SummonerIcon";

// How often the settle check looks at the card, and how long it keeps looking
// before deciding this is as finished as the page is going to get. A card with
// one icon missing is still worth having; a card that never arrives is not.
const SETTLE_POLL_MS = 150;
const SETTLE_TIMEOUT_MS = 10_000;
// Champion names come from a cache the main process has usually already filled,
// so they land before the first paint. A cold offline start is the exception,
// and a card that names champions by id beats a card that never gets drawn.
const NAME_GRACE_MS = 3_000;

function publish(status: CardStatus) {
  (window as unknown as Record<string, CardStatus>)[CARD_STATUS_KEY] = status;
}

/**
 * The scoreboard on its own, with no sidebar, no scrolling and nothing
 * interactive: this route exists so the main process can photograph it. It is
 * loaded in a window of its own, sized to the card, and captured the moment the
 * page says it is done — so the only job here beyond drawing the game is
 * knowing when that is.
 */
export default function GameCard() {
  const { gameId } = useParams<{ gameId: string }>();
  const id = Number(gameId);
  const validId = Number.isFinite(id);
  const champData = useChampionData();
  const [card, setCard] = useState<GameCardData | null>(null);
  const [puuids, setPuuids] = useState<string[] | null>(null);
  const [notFound, setNotFound] = useState(false);
  const missing = !validId || notFound;
  const root = useRef<HTMLDivElement>(null);

  // The app's layout pins the root to the viewport and hides the overflow,
  // which is right for a window you scroll in and wrong for one that is sized
  // to its contents.
  useEffect(() => {
    document.body.classList.add("card-window");
    return () => document.body.classList.remove("card-window");
  }, []);

  useEffect(() => {
    if (!validId) return;
    let active = true;
    Promise.all([window.api.getGameCard(id), window.api.getAllSummonerPuuids()]).then(
      ([result, ids]) => {
        if (!active) return;
        setPuuids(ids);
        if (result) setCard(result);
        else setNotFound(true);
      },
      (err) => {
        if (active) publish({ state: "error", height: 0, error: err.message });
      },
    );
    return () => {
      active = false;
    };
  }, [id, validId]);

  useEffect(() => {
    if (missing) publish({ state: "error", height: 0, error: "That game isn't in the database" });
  }, [missing]);

  const [namesOverdue, setNamesOverdue] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setNamesOverdue(true), NAME_GRACE_MS);
    return () => clearTimeout(timer);
  }, []);

  const drawn =
    card != null && puuids != null && (Object.keys(champData).length > 0 || namesOverdue);

  // Icons arrive over the network, and several of them walk a list of candidate
  // URLs when the first one 404s, so the page isn't finished when its images
  // first all report complete — it is finished when that stops changing.
  useEffect(() => {
    if (!drawn) return;
    const el = root.current;
    if (!el) return;

    let previous: string | null = null;
    const deadline = Date.now() + SETTLE_TIMEOUT_MS;

    const check = () => {
      const images = Array.from(el.querySelectorAll("img"));
      const pending = images.filter((img) => !img.complete).length;
      const signature = `${images.length}|${images.map((img) => img.src).join(" ")}`;
      const settled = pending === 0 && signature === previous;
      previous = signature;
      if (!settled && Date.now() < deadline) return;
      clearInterval(timer);
      publish({ state: "ready", height: Math.ceil(el.getBoundingClientRect().height) });
    };

    const timer = setInterval(check, SETTLE_POLL_MS);
    return () => clearInterval(timer);
  }, [drawn]);

  if (missing) {
    return (
      <div className="p-6 text-sm text-lol-text">
        That game isn&apos;t in the database any more.
      </div>
    );
  }

  if (!drawn) return <div className="p-6 text-sm text-lol-text">Drawing...</div>;

  // The two team panels are the card, so they get the width to themselves —
  // a panel around them would only draw a box around a box.
  return (
    <div ref={root} className="w-full p-6">
      <CardHeading card={card} puuids={puuids} />
      <div className="mt-3">
        <MatchScoreboard detail={card.detail} champData={champData} puuids={puuids} multikills />
      </div>
    </div>
  );
}

// Whose game this was, when, where and how long it ran — everything the
// scoreboard itself doesn't say, which the app never has to state because the
// answer is always "yours, and you were there". An image outlives both.
function CardHeading({ card, puuids }: { card: GameCardData; puuids: string[] | null }) {
  const { game, participants } = card.detail;
  const self = participants?.find(
    (p) => p.puuid != null && (p.puuid === game.puuid || puuids?.includes(p.puuid)),
  );
  const name = self?.gameName ? `${self.gameName}${self.tagLine ? ` #${self.tagLine}` : ""}` : null;

  return (
    <div className="flex items-center gap-2.5 px-1">
      <SummonerIcon iconId={card.profileIcon} size={28} />
      <div className="flex flex-1 items-baseline gap-2 text-xs text-lol-text">
        {name && <span className="text-sm font-semibold text-lol-gold-light">{name}</span>}
        <span>{formatDateTime(game.game_creation)}</span>
        {card.mapName && (
          <>
            <Dot />
            <span>{card.mapName}</span>
          </>
        )}
        <Dot />
        <span>{formatDuration(game.game_duration)}</span>
        <span className="ml-auto text-[10px] uppercase tracking-[0.2em] text-lol-text/50">
          Mayhem Tracker
        </span>
      </div>
    </div>
  );
}

function Dot() {
  return <span className="text-lol-text/40">·</span>;
}
