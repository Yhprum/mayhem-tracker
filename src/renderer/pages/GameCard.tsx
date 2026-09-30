import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import type { GameCardData } from "../lib/types";
import { useChampionData } from "../hooks/useChampions";
import { useCardCapture, useLookupGrace } from "../hooks/useCardCapture";
import { formatDateTime, formatDuration } from "../lib/format";
import MatchScoreboard from "../components/MatchScoreboard";
import SummonerIcon from "../components/SummonerIcon";

/**
 * The scoreboard on its own, with no sidebar, no scrolling and nothing
 * interactive: this route exists so the main process can photograph it.
 */
export default function GameCard() {
  const { gameId } = useParams<{ gameId: string }>();
  const id = Number(gameId);
  const validId = Number.isFinite(id);
  const champData = useChampionData();
  const [card, setCard] = useState<GameCardData | null>(null);
  const [puuids, setPuuids] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(
    validId ? null : "That game isn't in the database",
  );

  useEffect(() => {
    if (!validId) return;
    let active = true;
    Promise.all([window.api.getGameCard(id), window.api.getAllSummonerPuuids()]).then(
      ([result, ids]) => {
        if (!active) return;
        setPuuids(ids);
        if (result) setCard(result);
        else setError("That game isn't in the database");
      },
      (err) => {
        if (active) setError(err.message);
      },
    );
    return () => {
      active = false;
    };
  }, [id, validId]);

  const namesOverdue = useLookupGrace();
  const drawn =
    card != null && puuids != null && (Object.keys(champData).length > 0 || namesOverdue);
  const root = useCardCapture(drawn, error);

  if (error) {
    return <div className="p-6 text-sm text-lol-text">{error}</div>;
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
