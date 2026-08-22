import { useState, useEffect, useCallback } from "react";
import { useBackfill } from "../hooks/useBackfill";
import { queueLabel } from "../components/QueueSelect";
import { setRemembering } from "../lib/viewState";
import type { BackupInfo } from "../lib/types";

const BACKUP_REASONS: Record<string, string> = {
  auto: "Scheduled",
  manual: "Manual",
  "pre-import": "Before import",
  "pre-repair": "Before repair",
  "pre-restore": "Before restore",
};

function formatSize(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatTaken(timestamp: number): string {
  const date = new Date(timestamp);
  return `${date.toLocaleDateString()} ${date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  })}`;
}

function Switch({
  checked,
  onChange,
  disabled = false,
}: {
  checked: boolean;
  onChange: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={onChange}
      className={`relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent transition-colors duration-200 ${
        disabled ? "cursor-not-allowed opacity-40" : "cursor-pointer"
      } ${checked ? "bg-lol-gold" : "bg-lol-border"}`}
    >
      <span
        className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow transform transition-transform duration-200 ${
          checked ? "translate-x-5" : "translate-x-0"
        }`}
      />
    </button>
  );
}

export default function Settings() {
  // Shared so a backfill started automatically on first connect shows here too
  const { running: backfilling, progress } = useBackfill();
  const [autoStart, setAutoStart] = useState(false);
  // Only the packaged program has a path worth registering, so the switch says
  // so instead of pretending in a dev build
  const [autoStartSupported, setAutoStartSupported] = useState(false);
  const [minimizeToTray, setMinimizeToTray] = useState(true);
  // Every queue with games stored, and the subset the user has switched off
  const [queues, setQueues] = useState<number[]>([]);
  const [hiddenQueues, setHiddenQueues] = useState<Set<number>>(new Set());
  const [autoBackup, setAutoBackup] = useState(true);
  const [rememberFilters, setRememberFilters] = useState(false);
  const [loading, setLoading] = useState(true);
  const [exportStatus, setExportStatus] = useState<string | null>(null);
  const [importStatus, setImportStatus] = useState<string | null>(null);
  const [repairStatus, setRepairStatus] = useState<string | null>(null);
  const [backfillStatus, setBackfillStatus] = useState<string | null>(null);
  const [backups, setBackups] = useState<BackupInfo[]>([]);
  const [backupStatus, setBackupStatus] = useState<string | null>(null);
  const [backupBusy, setBackupBusy] = useState(false);
  // Restoring replaces the whole database, so the row asks a second time
  const [confirmRestore, setConfirmRestore] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      window.api.getSetting("auto_start"),
      window.api.isAutoStartSupported(),
      window.api.getSetting("minimize_to_tray"),
      window.api.getSetting("hidden_queues"),
      window.api.getSetting("auto_backup"),
      window.api.getSetting("remember_filters"),
    ]).then(([startup, startupSupported, tray, hidden, backup, remember]) => {
      setAutoStart(startup === "true");
      setAutoStartSupported(startupSupported);
      setMinimizeToTray(tray !== "false");
      setHiddenQueues(new Set(hidden ? hidden.split(",").map(Number) : []));
      setAutoBackup(backup !== "false");
      setRememberFilters(remember === "true");
      setLoading(false);
    });
  }, []);

  // Kept current the same way the queue dropdown is: a game from a queue that
  // wasn't in the database yet adds a switch for it without a reload.
  useEffect(() => {
    const fetchQueues = () => window.api.getStoredQueues().then(setQueues);
    fetchQueues();
    return window.api.onGamesUpdated(fetchQueues);
  }, []);

  const refreshBackups = useCallback(() => {
    window.api.listBackups().then(setBackups);
  }, []);

  useEffect(refreshBackups, [refreshBackups]);

  const handleAutoStartToggle = useCallback(async () => {
    const next = !autoStart;
    setAutoStart(next);
    // The main process registers or clears the login item off the back of this
    await window.api.setSetting("auto_start", String(next));
  }, [autoStart]);

  const handleToggle = useCallback(async () => {
    const next = !minimizeToTray;
    setMinimizeToTray(next);
    await window.api.setSetting("minimize_to_tray", String(next));
  }, [minimizeToTray]);

  const handleQueueToggle = useCallback(
    async (queueId: number) => {
      const next = new Set(hiddenQueues);
      if (!next.delete(queueId)) next.add(queueId);
      setHiddenQueues(next);
      await window.api.setSetting("hidden_queues", [...next].join(","));
    },
    [hiddenQueues],
  );

  const handleAutoBackupToggle = useCallback(async () => {
    const next = !autoBackup;
    setAutoBackup(next);
    await window.api.setSetting("auto_backup", String(next));
  }, [autoBackup]);

  const handleRememberFiltersToggle = useCallback(async () => {
    const next = !rememberFilters;
    setRememberFilters(next);
    // Takes effect on the pages right away: they read the flag as they mount,
    // and turning it off drops whatever was already stored.
    setRemembering(next);
    await window.api.setSetting("remember_filters", String(next));
  }, [rememberFilters]);

  const handleBackupNow = useCallback(async () => {
    setBackupBusy(true);
    setBackupStatus(null);
    try {
      const result = await window.api.createBackup();
      setBackupStatus(
        result.success
          ? `Backed up ${result.backup?.games} game(s)`
          : `Error: ${result.error ?? "backup failed"}`,
      );
      refreshBackups();
    } catch (err: any) {
      setBackupStatus(`Error: ${err.message}`);
    } finally {
      setBackupBusy(false);
    }
  }, [refreshBackups]);

  const handleRestore = useCallback(
    async (file: string) => {
      setConfirmRestore(null);
      setBackupBusy(true);
      setBackupStatus(null);
      try {
        const result = await window.api.restoreBackup(file);
        setBackupStatus(
          result.success
            ? `Restored ${result.games} game(s) from ${file}`
            : `Error: ${result.error ?? "restore failed"}`,
        );
        refreshBackups();
      } catch (err: any) {
        setBackupStatus(`Error: ${err.message}`);
      } finally {
        setBackupBusy(false);
      }
    },
    [refreshBackups],
  );

  const handleExport = useCallback(async () => {
    setExportStatus(null);
    try {
      const result = await window.api.exportData();
      if (result.success) {
        setExportStatus(`Exported ${result.games} game(s) to ${result.path}`);
      } else {
        // No error means the file dialog was dismissed, which needs no message
        setExportStatus(result.error ? `Error: ${result.error}` : null);
      }
    } catch (err: any) {
      setExportStatus(`Error: ${err.message}`);
    }
  }, []);

  const handleImport = useCallback(async () => {
    setImportStatus(null);
    try {
      const result = await window.api.importData();
      if (result.success) {
        setImportStatus(`Imported ${result.imported} new game(s)`);
      } else {
        setImportStatus(result.error ? `Error: ${result.error}` : null);
      }
      // An import takes a snapshot on its way in
      refreshBackups();
    } catch (err: any) {
      setImportStatus(`Error: ${err.message}`);
    }
  }, [refreshBackups]);

  useEffect(() => {
    if (!progress) return;
    setBackfillStatus(
      progress.total === 0
        ? "Nothing new to check"
        : `Checking game ${progress.current} of ${progress.total}, ${progress.added} added so far`,
    );
  }, [progress]);

  const handleBackfill = useCallback(async () => {
    setBackfillStatus("Fetching your match list from Riot...");
    try {
      const result = await window.api.backfillHistory();
      if ("error" in result) {
        setBackfillStatus(`Error: ${result.error}`);
      } else {
        const summary =
          result.added > 0
            ? `Added ${result.added} game(s) from ${result.scanned} found in your Riot history`
            : `No new Mayhem games found (${result.scanned} games checked)`;
        setBackfillStatus(
          result.cancelled
            ? `Stopped after adding ${result.added} game(s). Run it again to finish.`
            : result.truncated
              ? `${summary}. Stopped at the ${result.scanned}-game paging limit, so anything older was not checked.`
              : summary,
        );
      }
    } catch (err: any) {
      setBackfillStatus(`Error: ${err.message}`);
    }
  }, []);

  const handleRepair = useCallback(async () => {
    setRepairStatus(null);
    try {
      const result = await window.api.repairPuuids();
      setRepairStatus(
        `Repaired ${result.repairedGames} game(s), found ${result.discoveredAccounts} account(s), rebuilt stats and scores for ${result.rebuiltGames} game(s)`,
      );
      // A repair takes a snapshot on its way in
      refreshBackups();
    } catch (err: any) {
      setRepairStatus(`Error: ${err.message}`);
    }
  }, [refreshBackups]);

  if (loading) return null;

  return (
    <div className="max-w-2xl space-y-6">
      <h1 className="text-xl font-bold text-lol-text-bright">Settings</h1>

      {/* General */}
      <div className="bg-lol-card rounded-xl border border-lol-border/60 p-5">
        <h2 className="text-sm font-semibold text-lol-text-bright mb-4">General</h2>
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-lol-text-bright">Start with Windows</p>
              <p className="text-xs text-lol-text mt-0.5">
                Open the program in the system tray when you sign in to Windows, so your games are
                recorded without having to remember to start it.
                {!autoStartSupported && " Only available in the packaged program."}
              </p>
            </div>
            <Switch
              checked={autoStart}
              onChange={handleAutoStartToggle}
              disabled={!autoStartSupported}
            />
          </div>

          <div className="border-t border-lol-border" />

          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-lol-text-bright">Minimize to tray on close</p>
              <p className="text-xs text-lol-text mt-0.5">
                When enabled, the program can keep storing your games even when the window is
                closed. You can still close the program from the system tray.
              </p>
            </div>
            <Switch checked={minimizeToTray} onChange={handleToggle} />
          </div>

          <div className="border-t border-lol-border" />

          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-lol-text-bright">Remember filters and sorting</p>
              <p className="text-xs text-lol-text mt-0.5">
                Reopen every page with the filters, search, and sort order you last used. When off,
                each page starts on its defaults again every time the program opens.
              </p>
            </div>
            <Switch checked={rememberFilters} onChange={handleRememberFiltersToggle} />
          </div>

          {/* A single queue has nothing to choose between, so the whole block
              waits until a second one shows up in the database */}
          {queues.length > 1 && (
            <>
              <div className="border-t border-lol-border" />

              <div>
                <p className="text-sm text-lol-text-bright">Queues to include</p>
                <p className="text-xs text-lol-text mt-0.5">
                  Stats and match history only count the queues switched on here. Games from the
                  others are still recorded, and can be counted again by switching their queue back
                  on.
                </p>
                <div className="mt-3 space-y-3">
                  {queues.map((q, _i, all) => {
                    const shown = !hiddenQueues.has(q);
                    const shownCount = all.filter((id) => !hiddenQueues.has(id)).length;
                    return (
                      <div key={q} className="flex items-center justify-between">
                        <p className="text-sm text-lol-text">{queueLabel(q)}</p>
                        {/* Switching off the last one would empty every page */}
                        <Switch
                          checked={shown}
                          disabled={shown && shownCount === 1}
                          onChange={() => handleQueueToggle(q)}
                        />
                      </div>
                    );
                  })}
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Data Management */}
      <div className="bg-lol-card rounded-xl border border-lol-border/60 p-5">
        <h2 className="text-sm font-semibold text-lol-text-bright mb-4">Data Management</h2>
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-lol-text-bright">Backfill match history</p>
              <p className="text-xs text-lol-text mt-0.5">
                Pull your older Mayhem games from Riot and add any that aren't stored yet. This runs
                automatically the first time an account connects; use this to run it again, or to
                finish an import you cancelled.
              </p>
            </div>
            <button
              onClick={handleBackfill}
              disabled={backfilling}
              className="px-4 py-1.5 rounded text-sm bg-lol-gold/20 text-lol-gold hover:bg-lol-gold/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {backfilling ? "Working..." : "Backfill"}
            </button>
          </div>
          {backfillStatus && <p className="text-xs text-lol-text">{backfillStatus}</p>}

          <div className="border-t border-lol-border" />

          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-lol-text-bright">Export data</p>
              <p className="text-xs text-lol-text mt-0.5">
                Save all match data to a JSON file for backup
              </p>
            </div>
            <button
              onClick={handleExport}
              className="px-4 py-1.5 rounded text-sm bg-lol-gold/20 text-lol-gold hover:bg-lol-gold/30 transition-colors"
            >
              Export
            </button>
          </div>
          {exportStatus && <p className="text-xs text-lol-text">{exportStatus}</p>}

          <div className="border-t border-lol-border" />

          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-lol-text-bright">Import data</p>
              <p className="text-xs text-lol-text mt-0.5">
                Load match data from a previously exported file
              </p>
            </div>
            <button
              onClick={handleImport}
              className="px-4 py-1.5 rounded text-sm bg-lol-gold/20 text-lol-gold hover:bg-lol-gold/30 transition-colors"
            >
              Import
            </button>
          </div>
          {importStatus && <p className="text-xs text-lol-text">{importStatus}</p>}

          <div className="border-t border-lol-border" />

          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-lol-text-bright">Repair account data</p>
              <p className="text-xs text-lol-text mt-0.5">
                Re-detect which accounts are yours by analyzing game history, then rebuild stored
                stats, augments, and performance scores from the raw game data. Use this if games
                are attributed to the wrong account or scores look stale.
              </p>
            </div>
            <button
              onClick={handleRepair}
              className="px-4 py-1.5 rounded text-sm bg-lol-gold/20 text-lol-gold hover:bg-lol-gold/30 transition-colors"
            >
              Repair
            </button>
          </div>
          {repairStatus && <p className="text-xs text-lol-text">{repairStatus}</p>}
        </div>
      </div>

      {/* Backups */}
      <div className="bg-lol-card rounded-xl border border-lol-border/60 p-5">
        <h2 className="text-sm font-semibold text-lol-text-bright mb-4">Backups</h2>
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-lol-text-bright">Automatic backups</p>
              <p className="text-xs text-lol-text mt-0.5">
                Keep a daily copy of your database on this computer, plus one before any import or
                repair. Older copies thin out to weekly and monthly. If the database ever goes
                missing or won't open, the newest working copy is restored on startup.
              </p>
            </div>
            <Switch checked={autoBackup} onChange={handleAutoBackupToggle} />
          </div>

          <div className="border-t border-lol-border" />

          {backups.length === 0 ? (
            <p className="text-xs text-lol-text">No backups yet.</p>
          ) : (
            <div className="space-y-1">
              {backups.map((backup) => (
                <div
                  key={backup.file}
                  className="flex items-center justify-between gap-3 text-xs py-1"
                >
                  <div className="min-w-0">
                    <p className="text-lol-text-bright">{formatTaken(backup.created)}</p>
                    <p className="text-lol-text">
                      {BACKUP_REASONS[backup.reason] ?? backup.reason} ·{" "}
                      {backup.games === null ? "unreadable" : `${backup.games} games`} ·{" "}
                      {formatSize(backup.size)}
                    </p>
                  </div>
                  {confirmRestore === backup.file ? (
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-lol-text">Replace current data?</span>
                      <button
                        onClick={() => handleRestore(backup.file)}
                        disabled={backupBusy}
                        className="px-3 py-1 rounded bg-red-500/20 text-red-300 hover:bg-red-500/30 transition-colors disabled:opacity-50"
                      >
                        Restore
                      </button>
                      <button
                        onClick={() => setConfirmRestore(null)}
                        className="px-3 py-1 rounded bg-lol-border/40 text-lol-text hover:bg-lol-border/60 transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setConfirmRestore(backup.file)}
                      disabled={backupBusy || backup.games === null}
                      className="px-3 py-1 rounded shrink-0 bg-lol-gold/20 text-lol-gold hover:bg-lol-gold/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Restore
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}

          <div className="flex items-center gap-2">
            <button
              onClick={handleBackupNow}
              disabled={backupBusy}
              className="px-4 py-1.5 rounded text-sm bg-lol-gold/20 text-lol-gold hover:bg-lol-gold/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {backupBusy ? "Working..." : "Back up now"}
            </button>
            <button
              onClick={() => window.api.openBackupFolder()}
              className="px-4 py-1.5 rounded text-sm bg-lol-border/40 text-lol-text hover:bg-lol-border/60 transition-colors"
            >
              Open folder
            </button>
          </div>
          {backupStatus && <p className="text-xs text-lol-text">{backupStatus}</p>}
        </div>
      </div>
    </div>
  );
}
