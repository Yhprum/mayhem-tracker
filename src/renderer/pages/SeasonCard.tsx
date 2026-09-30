import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import type { SeasonRecap } from "../lib/types";
import { useAugmentData, useChampionData, useItemData } from "../hooks/useChampions";
import { useCardCapture, useLookupGrace } from "../hooks/useCardCapture";
import SeasonRecapCard from "../components/SeasonRecapCard";

const loaded = (data: object) => Object.keys(data).length > 0;

/**
 * The season recap card on its own, for the main process to photograph. The
 * filters ride in the route, so the image is of exactly what the Season Recap
 * page had selected.
 */
export default function SeasonCard() {
  const { seasonId = "" } = useParams<{ seasonId: string }>();
  const [params] = useSearchParams();
  const queueParam = params.get("queue");
  const queue = queueParam != null ? Number(queueParam) : undefined;
  const account = params.get("account") ?? undefined;
  const hideFriends = params.has("hideFriends");

  const [recap, setRecap] = useState<SeasonRecap | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    window.api.getSeasonRecap(seasonId, queue, account).then(
      (result) => {
        if (!active) return;
        if (!result) setError("That season isn't available");
        else if (result.games === 0) setError("There are no games in that season to recap");
        else setRecap(result);
      },
      (err) => {
        if (active) setError(err.message);
      },
    );
    return () => {
      active = false;
    };
  }, [seasonId, queue, account]);

  // Names, and the item data the boots are told apart by, are text rather than
  // images, so the settle check can't see them arrive: wait for them here
  const champData = useChampionData();
  const augmentData = useAugmentData(recap?.patch);
  const itemData = useItemData(recap?.patch);
  const overdue = useLookupGrace();
  const drawn =
    recap != null && ((loaded(champData) && loaded(augmentData) && loaded(itemData)) || overdue);
  const root = useCardCapture(drawn, error);

  if (error) return <div className="p-6 text-sm text-lol-text">{error}</div>;
  if (!drawn) return <div className="p-6 text-sm text-lol-text">Drawing...</div>;

  return (
    <div ref={root} className="w-full p-6">
      <SeasonRecapCard recap={recap} champData={champData} hideFriends={hideFriends} />
    </div>
  );
}
