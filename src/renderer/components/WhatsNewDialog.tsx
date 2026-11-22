import type { UpdateNotes } from "../lib/types";
import ReleaseNotes from "./ReleaseNotes";

// Shown on the first launch after an update, with every release it brought in
export default function WhatsNewDialog({
  notes,
  onClose,
}: {
  notes: UpdateNotes;
  onClose: () => void;
}) {
  const { releases } = notes;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={onClose}
    >
      <div
        className="flex max-h-[85vh] w-[32rem] max-w-[90vw] flex-col rounded-lg border border-lol-border bg-lol-card p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-[15px] font-bold text-lol-text-bright">What's New</h2>
        <p className="mt-2 text-[13px] text-lol-text">
          Updated to <span className="text-lol-gold">v{notes.to}</span> from v{notes.from}.
        </p>
        {releases.length > 1 && (
          <p className="mt-0.5 text-[12px] text-lol-text/60">
            {releases.length} versions of changes since your last launch.
          </p>
        )}

        {releases.length > 0 ? (
          <ReleaseNotes releases={releases} />
        ) : (
          <p className="mt-3 text-[12px] text-lol-text/60">
            The release notes couldn't be loaded. They're on GitHub instead.
          </p>
        )}

        <div className="mt-5 flex items-center justify-between gap-2">
          <button
            onClick={() => window.api.openUrl(notes.url)}
            className="text-[12px] text-lol-gold hover:text-lol-gold-light transition-colors cursor-pointer"
          >
            View on GitHub
          </button>
          <button
            onClick={onClose}
            className="text-xs px-3 py-1.5 rounded-md border border-lol-gold/25 bg-lol-gold/10 text-lol-gold hover:bg-lol-gold/20 transition-colors"
          >
            Got It
          </button>
        </div>
      </div>
    </div>
  );
}
