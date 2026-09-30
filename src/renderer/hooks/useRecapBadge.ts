import { useCallback, useEffect, useState } from "react";
import type { SeasonSummary } from "../lib/types";
import { findSeason, seasonBounds } from "../../shared/seasons";

// How long after a season closes its recap keeps calling for attention
const RECENT_MS = 14 * 24 * 60 * 60 * 1000;
// Remembers which season's badge has already done its job. Outside the view:
// prefix on purpose, since turning off remembered filters clears those and
// shouldn't bring a badge back.
const SEEN_KEY = "recap-badge-seen";

function readSeen(): string | null {
  try {
    return localStorage.getItem(SEEN_KEY);
  } catch {
    return null;
  }
}

// The newest season the player has games in that closed within RECENT_MS
function recentlyEnded(seasons: SeasonSummary[], now: number): SeasonSummary | null {
  const ended = seasons.findLast((summary) => {
    const season = findSeason(summary.id);
    const to = season ? seasonBounds(season).to : null;
    return summary.games > 0 && to != null && to <= now && now - to < RECENT_MS;
  });
  return ended ?? null;
}

/**
 * The season whose recap the sidebar should point at: one the player has games
 * in that ended in the last couple of weeks, until they follow the badge to it.
 * Null the rest of the time, which is most of it. `dismiss` is for the click
 * that follows it.
 */
export function useRecapBadge() {
  const [ended, setEnded] = useState<SeasonSummary | null>(null);
  const [seen, setSeen] = useState(readSeen);

  useEffect(() => {
    const load = () => {
      window.api.getSeasons().then(
        (seasons) => setEnded(recentlyEnded(seasons, Date.now())),
        () => {},
      );
    };
    load();
    return window.api.onGamesUpdated(load);
  }, []);

  const dismiss = useCallback(() => {
    if (!ended) return;
    try {
      localStorage.setItem(SEEN_KEY, ended.id);
    } catch {
      /* the badge comes back next launch, which is harmless */
    }
    setSeen(ended.id);
  }, [ended]);

  const season = ended && seen !== ended.id ? ended : null;
  return { season, dismiss };
}
