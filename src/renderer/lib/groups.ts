import type { TeammateGroup } from "./types";

// Sizes count us, so a duo is one friend
export const GROUP_SIZES: Record<number, string> = {
  2: "Duo",
  3: "Trio",
  4: "Quad",
  5: "5-stack",
};

export function groupSize(group: TeammateGroup): number {
  return group.members.length + 1;
}
