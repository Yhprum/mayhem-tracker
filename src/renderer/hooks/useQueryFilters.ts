import { useCallback } from "react";
import { useSearchParams } from "react-router-dom";

// The Total Stats pages keep their filters in the query string rather than in
// view state: the list hands them to a champion page in its link, and the
// champion page's back link hands them back, whether or not filters are being
// remembered.
export function useQueryFilters() {
  const [searchParams, setSearchParams] = useSearchParams();

  const setParam = useCallback(
    (key: string, value: string | number | undefined) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (value == null || value === "") next.delete(key);
          else next.set(key, String(value));
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const queueParam = searchParams.get("queue");
  return {
    searchParams,
    setSearchParams,
    setParam,
    patch: searchParams.get("patch") ?? undefined,
    queue: queueParam ? Number(queueParam) : undefined,
  };
}
