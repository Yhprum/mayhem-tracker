import { useState, useEffect, useCallback } from "react";
import type { MatchListItem } from "../lib/types";

const PAGE_SIZE = 20;

export function useMatches(championId?: number) {
  const [matches, setMatches] = useState<MatchListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);

  const load = useCallback(
    async (reset = false) => {
      setLoading(true);
      const offset = reset ? 0 : matches.length;
      try {
        const result =
          championId !== undefined
            ? await window.api.getChampionMatchHistory(championId, PAGE_SIZE, offset)
            : await window.api.getMatchHistory(PAGE_SIZE, offset);
        if (reset) {
          setMatches(result.matches);
        } else {
          setMatches((prev) => [...prev, ...result.matches]);
        }
        setTotal(result.total);
        setHasMore(offset + result.matches.length < result.total);
      } finally {
        setLoading(false);
      }
    },
    [championId, matches.length],
  );

  useEffect(() => {
    load(true);

    const unsub = window.api.onGamesUpdated(() => load(true));
    return unsub;
  }, [championId]);

  const loadMore = useCallback(() => {
    if (!loading && hasMore) load(false);
  }, [loading, hasMore, load]);

  return { matches, total, loading, hasMore, loadMore, reload: () => load(true) };
}
