import { useEffect, useState } from "react";
import { LOCALE } from "../lib/format";
import type { ReleaseNote, UpdateInfo } from "../lib/types";
import { ChevronRightIcon, RefreshIcon } from "./icons";
import Markdown from "./Markdown";

function formatReleaseDate(iso: string): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString(LOCALE, { month: "short", day: "numeric" });
}

function ReleaseBody({ release }: { release: ReleaseNote }) {
  if (!release.body) {
    return <p className="text-[12px] text-lol-text/50 italic">No notes for this release.</p>;
  }
  return (
    <div className="text-[12px] text-lol-text">
      <Markdown text={release.body} />
    </div>
  );
}

export default function UpdateDialog({
  update,
  onClose,
}: {
  update: UpdateInfo;
  onClose: () => void;
}) {
  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const releases = update.releases ?? [];
  // Only the newest is expanded up front: someone several versions behind gets a
  // scannable list of what they missed instead of a wall of bullets.
  const [openVersions, setOpenVersions] = useState<Set<string>>(
    () => new Set(releases.length ? [releases[0].version] : []),
  );

  useEffect(() => {
    return window.api.onUpdateProgress(setProgress);
  }, []);

  const toggleVersion = (version: string) => {
    setOpenVersions((prev) => {
      const next = new Set(prev);
      if (next.has(version)) next.delete(version);
      else next.add(version);
      return next;
    });
  };

  const handleUpdate = async () => {
    if (!update.assetUrl) {
      setError("No download found for this release");
      return;
    }
    setDownloading(true);
    setError(null);
    const result = await window.api.downloadUpdate(update.assetUrl);
    if (!result.success) {
      setDownloading(false);
      setError(result.error ?? "Update failed");
    }
    // On success the app restarts itself, no further action needed
  };

  const sizeMb = update.assetSize ? (update.assetSize / 1024 / 1024).toFixed(1) : null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={downloading ? undefined : onClose}
    >
      <div
        className="flex max-h-[85vh] w-[32rem] max-w-[90vw] flex-col rounded-lg border border-lol-border bg-lol-card p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-[15px] font-bold text-lol-text-bright">Update Available</h2>
        <p className="mt-2 text-[13px] text-lol-text">
          Version <span className="text-lol-gold">v{update.latest}</span> is available (you have v
          {update.current}).
        </p>
        {releases.length > 1 && (
          <p className="mt-0.5 text-[12px] text-lol-text/60">
            {releases.length} versions of changes since your install
            {update.moreVersions ? ", plus earlier ones on GitHub" : ""}.
          </p>
        )}

        {releases.length > 0 && (
          <div className="mt-3 min-h-0 flex-1 overflow-y-auto rounded-md border border-lol-border bg-black/20 p-3">
            {releases.map((release, i) => {
              // A single missed release needs no accordion around it.
              if (releases.length === 1)
                return <ReleaseBody key={release.version} release={release} />;
              const open = openVersions.has(release.version);
              return (
                <div
                  key={release.version}
                  className={i > 0 ? "mt-1 border-t border-lol-border/50 pt-1" : ""}
                >
                  <button
                    onClick={() => toggleVersion(release.version)}
                    className="flex w-full items-center gap-1.5 rounded py-1 text-left hover:bg-white/5 transition-colors cursor-pointer"
                  >
                    <ChevronRightIcon
                      className={`w-3 h-3 shrink-0 text-lol-text/50 transition-transform ${open ? "rotate-90" : ""}`}
                    />
                    <span className="text-[12px] font-semibold text-lol-gold">
                      v{release.version}
                    </span>
                    <span className="ml-auto text-[11px] text-lol-text/40">
                      {formatReleaseDate(release.publishedAt)}
                    </span>
                  </button>
                  {open && (
                    <div className="pb-2 pl-[18px]">
                      <ReleaseBody release={release} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {downloading && (
          <div className="mt-4">
            <div className="h-1.5 w-full rounded-full bg-white/10 overflow-hidden">
              <div
                className="h-full rounded-full bg-lol-gold transition-all"
                style={{ width: `${progress}%` }}
              />
            </div>
            <p className="mt-1.5 text-[11px] text-lol-text">
              Downloading... {progress}%{sizeMb ? ` of ${sizeMb} MB` : ""}
            </p>
          </div>
        )}

        {error && (
          <div className="mt-4 text-[12px] text-lol-loss">
            {error}
            {update.url && (
              <button
                onClick={() => window.api.openUrl(update.url!)}
                className="ml-1.5 text-lol-gold hover:text-lol-gold-light transition-colors cursor-pointer"
              >
                Download manually
              </button>
            )}
          </div>
        )}

        <div className="mt-5 flex items-center justify-between gap-2">
          <button
            onClick={() => window.api.openUrl(update.url!)}
            className="text-[12px] text-lol-gold hover:text-lol-gold-light transition-colors cursor-pointer"
          >
            View on GitHub
          </button>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              disabled={downloading}
              className="text-xs px-3 py-1.5 rounded-md border border-lol-border text-lol-text hover:bg-white/5 disabled:opacity-50 transition-colors"
            >
              Not Now
            </button>
            <button
              onClick={handleUpdate}
              disabled={downloading || !update.assetUrl}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md border border-lol-gold/25 bg-lol-gold/10 text-lol-gold hover:bg-lol-gold/20 disabled:opacity-50 transition-colors"
            >
              <RefreshIcon className={`w-3 h-3 ${downloading ? "animate-spin" : ""}`} />
              {downloading ? "Updating..." : "Update & Restart"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
