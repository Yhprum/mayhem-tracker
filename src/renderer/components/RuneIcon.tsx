import { useState, useEffect } from "react";
import { PERK_ICON_URL, DDRAGON_PERK_ICON_URL, CANISBACK_PERK_ICON_URL } from "../lib/constants";

// Shared across every match view that draws individual perk/tree icons
// (Runes tab, match history row, expanded scoreboard). `path` is the "icon"
// field resolved in the main process (window.api.getRuneData(), see
// loadRuneData in src/main/dragon.ts) and is the ONLY reliable way to build a
// working icon URL: Data Dragon does not expose a "/cdn/{version}/img/perk/
// {perkId}.png" endpoint (that path 403s — perk id numbers are not filenames
// there), so `runeId` alone is never enough. Three mirrors of the same
// un-versioned path are tried in order: Data Dragon itself, the canisback.com
// mirror, then CommunityDragon (whose asset layout differs slightly and is
// normalized by PERK_ICON_URL).
const FALLBACKS = [DDRAGON_PERK_ICON_URL, CANISBACK_PERK_ICON_URL, PERK_ICON_URL];

export default function RuneIcon({
  path,
  runeId,
  version: _version,
  size = 28,
  className = "",
}: {
  path?: string | null;
  runeId?: number | null;
  version?: string | null;
  size?: number;
  className?: string;
}) {
  const [attempt, setAttempt] = useState(0);
  useEffect(() => setAttempt(0), [path, runeId]);

  const src = path && attempt < FALLBACKS.length ? FALLBACKS[attempt](path) : null;

  if (!src) {
    return (
      <span
        className={`flex shrink-0 items-center justify-center rounded-full bg-lol-border text-[9px] text-lol-text ${className}`}
        style={{ width: size, height: size }}
        title={runeId ? `Rune ${runeId}: icon path unavailable` : "Rune icon unavailable"}
      >
        R
      </span>
    );
  }
  return (
    <img
      className={`shrink-0 rounded-full ${className}`}
      src={src}
      width={size}
      height={size}
      alt=""
      onError={() => {
        console.error(
          `[RuneIcon] Icon source ${attempt + 1}/${FALLBACKS.length} failed for rune ${runeId ?? "?"} (${src}).`,
        );
        setAttempt((n) => n + 1);
      }}
    />
  );
}
