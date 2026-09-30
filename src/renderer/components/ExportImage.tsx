import { useCallback, useEffect, useRef, useState } from "react";
import { cardRoute, type CardSpec } from "../../shared/card";
import { CopyIcon, ImageIcon } from "./icons";

// Long enough to read where the file went, short enough that it doesn't sit
// over the page for the rest of the session
const MESSAGE_MS = 8_000;

// Saving the card asks where to put it; copying it just takes the clipboard.
type ImageAction = "save" | "copy";

// What each kind of card is called in the messages and tooltips about it
const SUBJECTS: Record<CardSpec["kind"], { image: string; noun: string }> = {
  game: { image: "the game image", noun: "game" },
  season: { image: "the season recap", noun: "recap" },
};

interface ExportMessage {
  text: string;
  failed: boolean;
}

interface Busy {
  // The card's route, which is as good an identity as a card has
  card: string;
  action: ImageAction;
}

/**
 * Turning a card into a PNG: the main process draws it and either runs the save
 * dialog or writes the clipboard, so all there is to hold here is which card is
 * in flight and what to say about the one that finished. Pages that offer this
 * from more than one place (a button and a context menu, say) share a single
 * instance so there is only ever one message on screen.
 */
export function useImageExport() {
  const [busy, setBusy] = useState<Busy | null>(null);
  const [message, setMessage] = useState<ExportMessage | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  const say = useCallback((text: string, failed: boolean) => {
    setMessage({ text, failed });
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setMessage(null), MESSAGE_MS);
  }, []);

  const run = useCallback(
    async (card: CardSpec, action: ImageAction) => {
      if (busy != null) return;
      setBusy({ card: cardRoute(card), action });
      setMessage(null);
      try {
        if (action === "copy") {
          const result = await window.api.copyCardImage(card);
          if (result.success) say(`Copied ${SUBJECTS[card.kind].image} to the clipboard`, false);
          else if (result.error) say(result.error, true);
        } else {
          const result = await window.api.exportCardImage(card);
          if (result.success) say(`Saved to ${result.path}`, false);
          // Neither succeeded nor failed: the save dialog was dismissed
          else if (result.error) say(result.error, true);
        }
      } catch (err: any) {
        say(err.message, true);
      } finally {
        setBusy(null);
      }
    },
    [busy, say],
  );

  const busyWith = useCallback(
    (card: CardSpec, action: ImageAction) =>
      busy != null && busy.card === cardRoute(card) && busy.action === action,
    [busy],
  );

  return { busyWith, message, run };
}

export function ExportImageMessage({ message }: { message: ExportMessage | null }) {
  if (!message) return null;

  return (
    <div className="pointer-events-none fixed bottom-4 left-1/2 z-50 -translate-x-1/2">
      <div
        className={`max-w-[600px] truncate rounded-lg border px-3 py-2 text-xs shadow-lg shadow-black/40 ${
          message.failed
            ? "border-lol-loss/40 bg-lol-card text-lol-loss"
            : "border-lol-border bg-lol-card text-lol-text-bright"
        }`}
      >
        {message.text}
      </div>
    </div>
  );
}

const LABELS: Record<ImageAction, { idle: string; busy: string; title: (noun: string) => string }> =
  {
    save: {
      idle: "Export PNG",
      busy: "Exporting...",
      title: (noun) => `Save this ${noun} as a PNG`,
    },
    copy: {
      idle: "Copy Image",
      busy: "Copying...",
      title: (noun) => `Copy this ${noun}'s image to the clipboard`,
    },
  };

export function ExportImageButton({
  action,
  card,
  exporting,
}: {
  action: ImageAction;
  card: CardSpec;
  exporting: ReturnType<typeof useImageExport>;
}) {
  const labels = LABELS[action];
  const Icon = action === "copy" ? CopyIcon : ImageIcon;
  const busy = exporting.busyWith(card, action);

  return (
    <button
      onClick={() => exporting.run(card, action)}
      disabled={busy}
      title={labels.title(SUBJECTS[card.kind].noun)}
      className="flex items-center gap-1.5 rounded-lg border border-lol-border bg-lol-card px-2 py-1 text-xs text-lol-text transition-colors hover:border-lol-gold/60 hover:text-lol-text-bright disabled:opacity-60"
    >
      <Icon className="h-3.5 w-3.5" />
      {busy ? labels.busy : labels.idle}
    </button>
  );
}
