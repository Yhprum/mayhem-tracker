export const QUEUE_ID_MAYHEM = 2400;
export const QUEUE_ID_MAYHEM_CLASSIC = 2450;

export const MAYHEM_QUEUE_IDS = [QUEUE_ID_MAYHEM, QUEUE_ID_MAYHEM_CLASSIC];
export const ARENA_QUEUE_IDS = [1700, 1740, 1750];

// Arena and Mayhem replace the standard rune page with Augments — there is no
// rune data to show for these queues at all (see extractRunes in
// src/main/db.ts, which returns empty rune ids for them), so the UI should
// swap the "RUNES" column/section for "AUGMENTS" instead of showing it empty.
export function isAugmentQueue(queueId?: number | null): boolean {
  if (queueId == null) return false;
  return MAYHEM_QUEUE_IDS.includes(queueId) || ARENA_QUEUE_IDS.includes(queueId);
}

// UI-only queue scopes used by the history tabs.
export const QUEUE_SCOPE_MAYHEM = -1;
export const QUEUE_SCOPE_REST = -2;
export const QUEUE_SCOPE_RANKED = -4;
export const QUEUE_SCOPE_NORMAL = -5;
export const QUEUE_SCOPE_ARAM = -6;
export const QUEUE_SCOPE_ARENA = -7;
export const QUEUE_GROUP_ARENA = -3;

export const QUEUE_LABELS: Record<number, string> = {
  [QUEUE_ID_MAYHEM]: "ARAM Mayhem",
  [QUEUE_ID_MAYHEM_CLASSIC]: "Mayhem Classic",
  0: "Custom",
  2: "Summoner's Rift (Blind)",
  4: "Ranked Solo",
  6: "Ranked Premade",
  7: "Summoner's Rift (Blind)",
  14: "Summoner's Rift (Draft)",
  16: "Dominion",
  17: "Dominion (Draft)",
  25: "Dominion (Blind)",
  30: "Summoner's Rift (Practice)",
  31: "Summoner's Rift (Co-op vs AI)",
  32: "Summoner's Rift (Co-op vs AI)",
  33: "Summoner's Rift (Co-op vs AI)",
  41: "Ranked Team Builder",
  42: "Ranked Solo/Duo",
  52: "Twisted Treeline (Co-op vs AI)",
  61: "Team Builder",
  65: "ARAM",
  67: "ARAM (Co-op vs AI)",
  70: "One for All",
  72: "Snowdown Showdown",
  73: "Victory Prototype",
  75: "Summoner's Rift 1v1",
  76: "Summoner's Rift 2v2",
  78: "Hexakill",
  83: "Co-op vs AI URF",
  98: "Twisted Treeline 3v3",
  100: "ARAM",
  310: "Nemesis",
  313: "Black Market Brawlers",
  315: "Nexus Siege",
  317: "Definitely Not Dominion",
  318: "All Random Summoner's Rift",
  325: "All Random",
  400: "Summoner's Rift (Draft)",
  410: "Ranked 5v5",
  420: "Ranked Solo/Duo",
  430: "Summoner's Rift (Blind)",
  440: "Ranked Flex",
  450: "ARAM",
  490: "Quickplay",
  480: "Swiftplay",
  880: "Co-op vs AI Intermediate",
  1700: "Arena",
  1740: "Arena Bravery",
  1750: "Arena 3x6",
  900: "ARURF",
  2020: "Tutorial 3",
  4310: "League Classic",
  2000: "Tutorial 1",
  2010: "Tutorial 2",
  3140: "Training Tool",
};

// Four picked at level breakpoints, plus up to two bonus slots for special augments
export const AUGMENT_SLOTS = 6;
