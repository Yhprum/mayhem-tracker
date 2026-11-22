import { useEffect, useState } from "react";
import { formatDecimal, formatPercent } from "../lib/format";
import type { UpdateInfo } from "../lib/types";
import { RefreshIcon } from "./icons";
import ReleaseNotes from "./ReleaseNotes";

export default function UpdateDialog({
  update,
  installing = false,
  onClose,
}: {
  update: UpdateInfo;
  // The main process started this install itself at launch, rather than the
  // user from this dialog
  installing?: boolean;
  onClose: () => void;
}) {
  const [downloading, setDownloading] = useState(installing);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // A launch install has no button press awaiting its result, so a failure
  // arrives as an event instead
  useEffect(() => {
    return window.api.onUpdateInstallFailed((message) => {
      setDownloading(false);
      setError(message);
    });
  }, []);

  const releases = update.releases ?? [];
  // A launch install that failed is back to an offer like any other
  const launchInstalling = installing && !error;

  useEffect(() => {
    return window.api.onUpdateProgress(setProgress);
  }, []);

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

  const sizeMb = update.assetSize ? formatDecimal(update.assetSize / 1024 / 1024) : null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={downloading ? undefined : onClose}
    >
      <div
        className="flex max-h-[85vh] w-[32rem] max-w-[90vw] flex-col rounded-lg border border-lol-border bg-lol-card p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-[15px] font-bold text-lol-text-bright">
          {launchInstalling ? "Updating" : "Update Available"}
        </h2>
        {launchInstalling ? (
          <p className="mt-2 text-[13px] text-lol-text">
            Updating to <span className="text-lol-gold">v{update.latest}</span> from v
            {update.current}. The program restarts on its own when it's done.
          </p>
        ) : (
          <p className="mt-2 text-[13px] text-lol-text">
            Version <span className="text-lol-gold">v{update.latest}</span> is available (you have v
            {update.current}).
          </p>
        )}
        {releases.length > 1 && (
          <p className="mt-0.5 text-[12px] text-lol-text/60">
            {releases.length} versions of changes since your install
            {update.moreVersions ? ", plus earlier ones on GitHub" : ""}.
          </p>
        )}

        {releases.length > 0 && <ReleaseNotes releases={releases} />}

        {downloading && (
          <div className="mt-4">
            <div className="h-1.5 w-full rounded-full bg-white/10 overflow-hidden">
              <div
                className="h-full rounded-full bg-lol-gold transition-all"
                style={{ width: `${progress}%` }}
              />
            </div>
            <p className="mt-1.5 text-[11px] text-lol-text">
              Downloading... {formatPercent(progress / 100, 0)}
              {sizeMb ? ` of ${sizeMb} MB` : ""}
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
