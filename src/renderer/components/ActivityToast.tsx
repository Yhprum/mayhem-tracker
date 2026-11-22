import { useState, useEffect } from "react";
import { useBackfill } from "../hooks/useBackfill";
import { LOCALE } from "../lib/format";
import { XIcon } from "./icons";

// History imports run in the background, often on their own the first time an
// account connects, so their progress and outcome surface in a corner card
// instead of taking room in the header. The outcome stays for ten seconds.
export default function ActivityToast() {
  const { running, progress, percent } = useBackfill();
  const [result, setResult] = useState<string | null>(null);

  useEffect(() => {
    if (!result) return;
    const timer = setTimeout(() => setResult(null), 10_000);
    return () => clearTimeout(timer);
  }, [result]);

  useEffect(
    () =>
      window.api.onBackfillDone((done) => {
        if ("error" in done) {
          setResult(`Import failed: ${done.error}`);
        } else if (done.cancelled) {
          setResult(`Import stopped after ${done.added.toLocaleString(LOCALE)} game(s)`);
        } else if (done.added > 0) {
          setResult(`Imported ${done.added.toLocaleString(LOCALE)} past game(s)`);
        }
      }),
    [],
  );

  if (!running && !result) return null;

  return (
    <div className="fixed bottom-4 right-6 z-40 w-72 rounded-lg border border-lol-border bg-lol-card px-3 py-2.5 shadow-lg shadow-black/40">
      {running ? (
        <>
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs text-lol-text-bright truncate">
              {progress && progress.total > 0
                ? `Importing history ${progress.current.toLocaleString(LOCALE)}/${progress.total.toLocaleString(LOCALE)}`
                : "Importing history..."}
            </span>
            <button
              onClick={() => window.api.cancelBackfill()}
              className="text-xs text-lol-text hover:text-lol-text-bright transition-colors shrink-0"
            >
              Cancel
            </button>
          </div>
          <div className="mt-2 h-1 rounded-full bg-lol-border overflow-hidden">
            <div
              className="h-full bg-lol-gold transition-all duration-300"
              style={{ width: `${percent}%` }}
            />
          </div>
        </>
      ) : (
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs text-lol-text truncate" title={result ?? undefined}>
            {result}
          </span>
          <button
            onClick={() => setResult(null)}
            title="Dismiss"
            className="text-lol-text hover:text-lol-text-bright transition-colors shrink-0"
          >
            <XIcon className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}
