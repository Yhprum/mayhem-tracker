import { useState, useEffect, useCallback, useRef } from "react";
import type { MatchFilters, MatchListItem, MultikillType } from "../lib/types";

const PAGE_SIZE = 20;

export function useMatches(filters: MatchFilters = {}) {
  const { championId, patch, queue, sort, sortDir, multikills, favorites } = filters;
  // Arrays are recreated each render, so the joined string is what the hook
  // actually depends on. The list is rebuilt from it below rather than closing
  // over the array, which keeps every dependency here a primitive.
  const multikillsKey = multikills?.join(",") ?? "";
  const [matches, setMatches] = useState<MatchListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);

  // How many rows are already loaded. Held in a ref rather than read from
  // matches.length so that appending a page doesn't change `load`'s identity —
  // if it did, the effect below would re-run on every page and reset the list.
  const offsetRef = useRef(0);

  const load = useCallback(
    async (reset = false) => {
      setLoading(true);
      const offset = reset ? 0 : offsetRef.current;
      try {
        const result = await window.api.getMatchHistory(PAGE_SIZE, offset, {
          championId,
          patch,
          queue,
          sort,
          sortDir,
          favorites,
          // Safe to narrow: the key was joined from these same values
          multikills: multikillsKey ? (multikillsKey.split(",") as MultikillType[]) : [],
        });
        if (reset) {
          setMatches(result.matches);
        } else {
          setMatches((prev) => [...prev, ...result.matches]);
        }
        offsetRef.current = offset + result.matches.length;
        setTotal(result.total);
        setHasMore(offset + result.matches.length < result.total);
      } finally {
        setLoading(false);
      }
    },
    [championId, patch, queue, sort, sortDir, multikillsKey, favorites],
  );

  // `load` changes only when a filter changes, so this both loads the first
  // page and resets to it whenever the filters move.
  useEffect(() => {
    load(true);

    const unsub = window.api.onGamesUpdated(() => load(true));
    return unsub;
  }, [load]);

  const loadMore = useCallback(() => {
    if (!loading && hasMore) load(false);
  }, [loading, hasMore, load]);

  const reload = useCallback(() => load(true), [load]);

  return { matches, total, loading, hasMore, loadMore, reload };
}
