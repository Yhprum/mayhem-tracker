import { useEffect, useState } from "react";
import type { MatchFilterOptions } from "../lib/types";

// What the dropdowns offer until the database has answered
export const EMPTY_FILTER_OPTIONS: MatchFilterOptions = {
  patches: [],
  champions: [],
  queues: [],
  accounts: [],
  hasFavorites: false,
};

// What the filter dropdowns can offer, refreshed whenever new games land — a
// game from a queue the database had never seen adds its option without a
// reload. Unnarrowed: a dropdown that filtered itself could hide its own
// selection, so the pages that narrow these ask for them directly instead.
export function useFilterOptions(): MatchFilterOptions {
  const [options, setOptions] = useState<MatchFilterOptions>(EMPTY_FILTER_OPTIONS);

  useEffect(() => {
    const fetchOptions = () => window.api.getMatchFilterOptions().then(setOptions);
    fetchOptions();
    return window.api.onGamesUpdated(fetchOptions);
  }, []);

  return options;
}
