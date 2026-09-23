import type { ChallengeLevel } from "./types";
import { LOCALE, formatCompact } from "./format";

// The display half of shared/challenges.ts, which holds the data rules. Both
// the Challenges tab and the post-game recap draw tiers, so the colours and the
// two formatters live here rather than in either one of them.

// Riot's tier colours, close enough to the token art that a row reads as one
// piece. Applied inline rather than through classes because the tier is data.
export const CHALLENGE_LEVEL_COLORS: Record<ChallengeLevel, string> = {
  NONE: "#5c6679",
  IRON: "#7a7371",
  BRONZE: "#b07a48",
  SILVER: "#a8b8c8",
  GOLD: "#e0b153",
  PLATINUM: "#4dc4b4",
  DIAMOND: "#6ea0f0",
  MASTER: "#c168e8",
  GRANDMASTER: "#ef5c6e",
  CHALLENGER: "#f0e6d2",
};

export function challengeLevelName(level: ChallengeLevel | null): string {
  if (!level || level === "NONE") return "Unranked";
  return level.charAt(0) + level.slice(1).toLowerCase();
}

// Challenge values run from "2 pentakills" to "5,000,000 mastery points" in the
// same list, so the big ones get abbreviated and the small ones stay exact.
// Millions carry their own unit: formatCompact only knows thousands, and five
// million rendered as "5000.0k" is harder to read than the raw number.
export function formatChallengeValue(value: number): string {
  const rounded = Math.round(value);
  if (rounded >= 1_000_000) return `${(rounded / 1_000_000).toFixed(1)}M`;
  return rounded >= 10000 ? formatCompact(rounded) : rounded.toLocaleString(LOCALE);
}
