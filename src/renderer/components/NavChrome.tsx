// The parts of the window frame shared by both navigation layouts, the header
// and the sidebar
import { useState, useEffect, useRef, type ComponentType, type SVGProps } from "react";
import { useRecapBadge } from "../hooks/useRecapBadge";
import { useSettingStore } from "../hooks/useSettingStore";
import { NAV_LINKS, hiddenNavLinks } from "../lib/navigation";
import type { LcuStatus, UpdateInfo, UpdateNotes } from "../lib/types";
import UpdateDialog from "./UpdateDialog";
import WhatsNewDialog from "./WhatsNewDialog";
import { MayhemIcon, MinusIcon, MaximizeIcon, RestoreIcon, XIcon } from "./icons";

type IconComponent = ComponentType<SVGProps<SVGSVGElement>>;

// The app is often left open for days, so a launch-only check would never
// surface a release cut in the meantime.
const UPDATE_POLL_MS = 6 * 60 * 60 * 1000;

export const statusColors: Record<LcuStatus, string> = {
  connected: "bg-lol-win",
  ingame: "bg-sky-400",
  connecting: "bg-amber-500",
  disconnected: "bg-lol-loss",
};

export const statusLabels: Record<LcuStatus, string> = {
  connected: "Connected",
  ingame: "In Game",
  connecting: "Connecting...",
  disconnected: "Disconnected",
};

export type NavEntry = {
  to: string;
  label: string;
  icon: IconComponent;
  search?: string;
  title?: string;
  /** A season that has just ended, named beside the Season Recap link */
  badge?: string;
  onClick?: () => void;
};

/** The links the user hasn't hidden, Season Recap pointing at a season that
 * has just ended until its recap has been opened */
export function useNavEntries(): NavEntry[] {
  const hidden = useSettingStore(hiddenNavLinks);
  const recapBadge = useRecapBadge();
  return NAV_LINKS.filter((link) => !hidden.has(link.to)).map((link) =>
    link.to === "/season" && recapBadge.season
      ? {
          ...link,
          // Straight to the season that ended, whichever one the page would
          // otherwise open on
          search: `?season=${encodeURIComponent(recapBadge.season.id)}`,
          title: `Your ${recapBadge.season.name} recap is ready to share`,
          badge: recapBadge.season.name,
          onClick: recapBadge.dismiss,
        }
      : link,
  );
}

export function RecapBadge({ name, className = "" }: { name: string; className?: string }) {
  return (
    <span
      className={`rounded-full border border-lol-gold/40 bg-lol-gold/15 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-lol-gold ${className}`}
    >
      {name}
    </span>
  );
}

export function Brand({ nameClassName = "" }: { nameClassName?: string }) {
  return (
    <div className="flex items-center gap-2.5 shrink-0">
      <div className="w-7 h-7 rounded-lg border border-lol-gold/40 bg-lol-gold/10 flex items-center justify-center shrink-0">
        <MayhemIcon className="w-5 h-5 text-lol-gold" />
      </div>
      <span
        className={`font-bold text-[15px] tracking-[0.02em] text-lol-gold whitespace-nowrap ${nameClassName}`}
      >
        Mayhem Tracker
      </span>
    </div>
  );
}

export function WindowControls() {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    window.api.isWindowMaximized().then(setMaximized);
    return window.api.onMaximizedChanged(setMaximized);
  }, []);

  return (
    <div className="titlebar-no-drag flex items-stretch self-stretch">
      <button
        onClick={() => window.api.minimizeWindow()}
        title="Minimize"
        className="w-11 flex items-center justify-center text-lol-text hover:bg-white/5 hover:text-lol-text-bright transition-colors"
      >
        <MinusIcon className="w-3.5 h-3.5" />
      </button>
      <button
        onClick={() => window.api.toggleMaximizeWindow()}
        title={maximized ? "Restore" : "Maximize"}
        className="w-11 flex items-center justify-center text-lol-text hover:bg-white/5 hover:text-lol-text-bright transition-colors"
      >
        {maximized ? <RestoreIcon className="w-3 h-3" /> : <MaximizeIcon className="w-3 h-3" />}
      </button>
      <button
        onClick={() => window.api.closeWindow()}
        title="Close"
        className="w-11 flex items-center justify-center text-lol-text hover:bg-lol-loss hover:text-white transition-colors"
      >
        <XIcon className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

/** The latest release, checked on launch and every few hours, with the dialogs
 * that install it and show what changed. Held above the navigation so
 * switching layouts neither restarts the poll nor closes a dialog. */
export function useUpdates() {
  const [update, setUpdate] = useState<UpdateInfo | null>(null);
  const [showUpdateDialog, setShowUpdateDialog] = useState(false);

  // Read inside the poll instead of as an effect dep, so opening the dialog
  // doesn't restart the interval
  const dialogOpenRef = useRef(false);
  useEffect(() => {
    dialogOpenRef.current = showUpdateDialog;
  }, [showUpdateDialog]);

  useEffect(() => {
    const check = () =>
      window.api.checkForUpdate().then((info) => {
        // A failed poll shouldn't clear a badge an earlier check earned
        setUpdate((prev) => (info.error && prev ? prev : info));
      });
    check();
    const timer = setInterval(() => {
      // Skip while the dialog is up: swapping the release out from under an
      // in-progress download would invalidate the URL being installed
      if (!dialogOpenRef.current) check();
    }, UPDATE_POLL_MS);
    return () => clearInterval(timer);
  }, []);

  // The launch check installs on its own; the dialog is just there to show it
  // happening. Asked for as well as listened for, since the install can begin
  // before this window has loaded.
  const [installing, setInstalling] = useState(false);
  useEffect(() => {
    const show = (info: UpdateInfo) => {
      setUpdate(info);
      setInstalling(true);
      setShowUpdateDialog(true);
    };
    window.api.getLaunchInstall().then((info) => info && show(info));
    return window.api.onUpdateInstalling(show);
  }, []);

  const closeUpdateDialog = () => {
    setShowUpdateDialog(false);
    setInstalling(false);
  };

  const [updateNotes, setUpdateNotes] = useState<UpdateNotes | null>(null);
  useEffect(() => {
    window.api.getUpdateNotes().then(setUpdateNotes);
  }, []);

  const dialogs = (
    <>
      {showUpdateDialog && update && (
        // Keyed so a launch install taking over an open dialog starts it afresh
        <UpdateDialog
          key={installing ? "installing" : "manual"}
          update={update}
          installing={installing}
          onClose={closeUpdateDialog}
        />
      )}
      {/* An update installing right now outranks notes on the last one */}
      {updateNotes && !showUpdateDialog && (
        <WhatsNewDialog notes={updateNotes} onClose={() => setUpdateNotes(null)} />
      )}
    </>
  );

  return {
    /** The newer release, if there is one */
    available: update?.hasUpdate ? update : null,
    open: () => setShowUpdateDialog(true),
    dialogs,
  };
}
