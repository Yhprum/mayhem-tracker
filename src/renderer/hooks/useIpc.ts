import { useState, useEffect, useCallback, useRef } from "react";

export function useIpc<T>(fetcher: () => Promise<T>, deps: any[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Callers pass an inline arrow, which is a new function every render. Reading
  // it through a ref keeps refetch tied to the caller's deps instead — those
  // are the caller's statement of what actually changes the result.
  const fetcherRef = useRef(fetcher);
  useEffect(() => {
    fetcherRef.current = fetcher;
  });

  // Only the newest request may write state. Two can be in flight at once
  // whenever a filter changes mid-fetch, and IPC gives no ordering guarantee —
  // without this the slower, older response lands last and leaves the view
  // showing data for a filter that is no longer selected.
  const requestId = useRef(0);

  const refetch = useCallback(
    async () => {
      const id = ++requestId.current;
      setLoading(true);
      setError(null);
      try {
        const result = await fetcherRef.current();
        if (id !== requestId.current) return;
        setData(result);
      } catch (err: any) {
        if (id !== requestId.current) return;
        setError(err.message || "Unknown error");
      } finally {
        if (id === requestId.current) setLoading(false);
      }
    },
    // The dependency list belongs to the caller, so it cannot be a literal here
    // and cannot be statically checked. The ref above is what makes that safe:
    // nothing else from the enclosing scope is captured.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    deps,
  );

  useEffect(() => {
    refetch();
  }, [refetch]);

  return { data, loading, error, refetch };
}
