import { useEffect, useRef, useState } from "react";
import { CARD_STATUS_KEY, type CardStatus } from "../../shared/card";

// How often the settle check looks at the card, and how long it keeps looking
// before deciding this is as finished as the page is going to get. A card with
// one icon missing is still worth having; a card that never arrives is not.
const SETTLE_POLL_MS = 150;
const SETTLE_TIMEOUT_MS = 10_000;
// Champion names, and the item and augment data icons are drawn from, come from
// caches the main process has usually already filled, so they land before the
// first paint. A cold offline start is the exception, and a card that names
// champions by id beats a card that never gets drawn.
const LOOKUP_GRACE_MS = 3_000;

function publish(status: CardStatus) {
  (window as unknown as Record<string, CardStatus>)[CARD_STATUS_KEY] = status;
}

/**
 * Everything a card route does besides draw its card. The page is loaded in a
 * window of its own, sized to the card, and photographed the moment it says it
 * is done, so the work here is knowing when that is: once the page reports
 * `drawn`, it waits for every image to arrive and stop changing, then publishes
 * the card's height. An error is published instead, whenever there is one.
 *
 * Returns the ref for the card's root element, which is what gets measured.
 */
export function useCardCapture(drawn: boolean, error: string | null) {
  const root = useRef<HTMLDivElement>(null);

  // The app's layout pins the root to the viewport and hides the overflow,
  // which is right for a window you scroll in and wrong for one that is sized
  // to its contents.
  useEffect(() => {
    document.body.classList.add("card-window");
    return () => document.body.classList.remove("card-window");
  }, []);

  useEffect(() => {
    if (error) publish({ state: "error", height: 0, error });
  }, [error]);

  // Icons arrive over the network, and several of them walk a list of candidate
  // URLs when the first one 404s, so the page isn't finished when its images
  // first all report complete — it is finished when that stops changing.
  useEffect(() => {
    if (!drawn || error) return;
    const el = root.current;
    if (!el) return;

    let previous: string | null = null;
    const deadline = Date.now() + SETTLE_TIMEOUT_MS;

    const check = () => {
      const images = Array.from(el.querySelectorAll("img"));
      const pending = images.filter((img) => !img.complete).length;
      const signature = `${images.length}|${images.map((img) => img.src).join(" ")}`;
      const settled = pending === 0 && signature === previous;
      previous = signature;
      if (!settled && Date.now() < deadline) return;
      clearInterval(timer);
      publish({ state: "ready", height: Math.ceil(el.getBoundingClientRect().height) });
    };

    const timer = setInterval(check, SETTLE_POLL_MS);
    return () => clearInterval(timer);
  }, [drawn, error]);

  return root;
}

// True once the lookups a card can do without have had their chance to land
export function useLookupGrace(): boolean {
  const [overdue, setOverdue] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setOverdue(true), LOOKUP_GRACE_MS);
    return () => clearTimeout(timer);
  }, []);
  return overdue;
}
