import { useEffect, useState } from "react";
import type { LiveGameSnapshot } from "../lib/types";

export interface LiveGameState {
  // Null until the first answer arrives, which is what tells the page apart
  // from one that has looked and found no game
  snapshot: LiveGameSnapshot | null;
  // When the snapshot landed, so the game clock can keep running between polls
  receivedAt: number;
  // The last match seen running while the page was open. Kept apart from the
  // snapshot, because the snapshot that says the match is over is the same one
  // that has stopped describing it.
  lastGame: { gameId: number; queueId: number | null } | null;
}

/**
 * The current match, as the main process sees it.
 *
 * One pull on mount covers the tab being opened mid-match, and after that the
 * main process pushes: it polls for exactly as long as a game runs, so there is
 * no timer here to leave running.
 *
 * The client status is the other thing worth asking again on. A pull made
 * before the client had been found comes back empty and nothing would push
 * afterwards, which is exactly the case of launching the app into a game
 * already in progress.
 */
export function useLiveGame(): LiveGameState {
  const [state, setState] = useState<LiveGameState>({
    snapshot: null,
    receivedAt: 0,
    lastGame: null,
  });

  useEffect(() => {
    let active = true;
    const apply = (snapshot: LiveGameSnapshot) => {
      if (!active) return;
      const receivedAt = Date.now();
      setState((prev) => ({
        snapshot,
        receivedAt,
        lastGame:
          snapshot.inGame && snapshot.gameId
            ? { gameId: snapshot.gameId, queueId: snapshot.queueId }
            : prev.lastGame,
      }));
    };
    const pull = () => window.api.getLiveGame().then(apply);

    pull();
    const unsubLive = window.api.onLiveGame(apply);
    const unsubStatus = window.api.onStatusChanged(pull);
    return () => {
      active = false;
      unsubLive();
      unsubStatus();
    };
  }, []);

  return state;
}
