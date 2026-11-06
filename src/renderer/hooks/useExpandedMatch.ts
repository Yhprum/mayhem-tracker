import { useCallback, useEffect, useState } from "react";
import type { MatchDetail } from "../lib/types";

// The one game open in a list of shared games, with the scoreboard to show for
// it and whose rows on that scoreboard are ours
export function useExpandedMatch() {
  const [puuids, setPuuids] = useState<string[] | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<MatchDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  useEffect(() => {
    window.api.getAllSummonerPuuids().then(setPuuids);
  }, []);

  const toggleExpand = useCallback(
    async (gameId: number) => {
      if (expandedId === gameId) {
        setExpandedId(null);
        setDetail(null);
        return;
      }
      setExpandedId(gameId);
      setDetailLoading(true);
      try {
        setDetail(await window.api.getMatchDetail(gameId));
      } finally {
        setDetailLoading(false);
      }
    },
    [expandedId],
  );

  return { puuids, expandedId, detail, detailLoading, toggleExpand };
}
