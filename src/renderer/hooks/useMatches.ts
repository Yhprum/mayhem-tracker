import { useState, useEffect, useCallback } from "react";
import type { MatchFilters, MatchListItem } from "../lib/types";

const PAGE_SIZE = 20;

export function useMatches(filters: MatchFilters = {}) {
  const { championId, patch, sort } = filters;
  const [matches, setMatches] = useState<MatchListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);

  const load = useCallback(
    async (reset = false) => {
      setLoading(true);
      const offset = reset ? 0 : matches.length;
      try {
        const result = await window.api.getMatchHistory(PAGE_SIZE, offset, {
          championId,
          patch,
          sort,
        });
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
    [championId, patch, sort, matches.length],
  );

  useEffect(() => {
    load(true);

    const unsub = window.api.onGamesUpdated(() => load(true));
    return unsub;
  }, [championId, patch, sort]);

  const loadMore = useCallback(() => {
    if (!loading && hasMore) load(false);
  }, [loading, hasMore, load]);

  return { matches, total, loading, hasMore, loadMore, reload: () => load(true) };
}
