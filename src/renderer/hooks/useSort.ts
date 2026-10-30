import { useCallback } from "react";
import { useViewState } from "./useViewState";

export type SortDir = "asc" | "desc";

// Sort state for one table, remembered under `key` so a relaunch opens on the
// same ordering. Picking a new column starts it at the end worth looking at: a
// name reads alphabetically, every other column is a quantity whose largest
// values are the interesting ones.
export function useSort<K extends string>(key: string, initial: K, initialDir: SortDir = "desc") {
  const [sortKey, setSortKey] = useViewState<K>(`${key}.sortKey`, initial);
  const [sortDir, setSortDir] = useViewState<SortDir>(`${key}.sortDir`, initialDir);

  const onSort = useCallback(
    (next: K) => {
      if (next === sortKey) {
        setSortDir((d) => (d === "desc" ? "asc" : "desc"));
      } else {
        setSortKey(next);
        setSortDir(next === "name" ? "asc" : "desc");
      }
    },
    [sortKey, setSortKey, setSortDir],
  );

  return { sortKey, sortDir, onSort };
}
