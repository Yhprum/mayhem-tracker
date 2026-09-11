// Both the match list and the expanded scoreboard hand us a flattened rune id
// list built the same way in the main process: [primaryTreeId, keystone, ...3
// more primary perks, secondaryTreeId, ...2 secondary perks] (see
// getMatchHistory / getMatchParticipants in src/main/db.ts). Filtering out the
// two known tree ids — rather than assuming fixed positions — keeps this
// correct even if a payload is missing a perk or ships extras.
export interface RuneSelection {
  primaryTree?: number;
  secondaryTree?: number;
  keystone?: number;
  primaryPerks: number[];
  secondaryPerks: number[];
}

export function parseRuneIds(raw: string | null | undefined): number[] {
  return raw
    ? raw
        .split(",")
        .map(Number)
        .filter((id) => Number.isFinite(id) && id > 0)
    : [];
}

export function splitRuneSelections(
  runeIds: number[] | null | undefined,
  primaryStyle?: number | null,
  secondaryStyle?: number | null,
): RuneSelection {
  const perks = (runeIds ?? []).filter((id) => id !== primaryStyle && id !== secondaryStyle);
  return {
    primaryTree: primaryStyle ?? undefined,
    secondaryTree: secondaryStyle ?? undefined,
    keystone: perks[0],
    primaryPerks: perks.slice(1, 4),
    secondaryPerks: perks.slice(4, 6),
  };
}

export function getRuneTree(data: RuneData, styleId?: number | null) {
  if (styleId == null) return undefined;
  const tree = data[styleId];
  return tree?.category === "tree" ? tree : undefined;
}
import type { RuneData } from "./types";
