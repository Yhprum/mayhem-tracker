import { useState } from "react";
import { useItemData } from "../hooks/useChampions";
import { CDRAGON_ASSET_URL } from "../lib/constants";
import HoverCard from "./HoverCard";
import RiotText from "./RiotText";

interface ItemIconProps {
  itemId: number;
  size?: number;
  patch?: string | null;
}

// Some Mayhem item icons carry a texture-variant suffix that CommunityDragon
// doesn't export (e.g. "3153_Blade_of_the_Ruined_King.project_jade.png" 404s
// while "3153_Blade_of_the_Ruined_King.png" exists), so keep the base path as
// a fallback.
function stripIconVariant(iconPath: string): string | null {
  const stripped = iconPath.replace(/\.[^./]+(\.\w+)$/, "$1");
  return stripped === iconPath ? null : stripped;
}

export default function ItemIcon({ itemId, size = 24, patch }: ItemIconProps) {
  const items = useItemData(patch);

  const item = items[itemId];
  // No tier below these: an item with no CommunityDragon mapping, or whose
  // icons all fail, falls through to the placeholder below.
  const sources: string[] = [];
  if (item?.iconPath) {
    sources.push(CDRAGON_ASSET_URL(item.branch, item.iconPath));
    const base = stripIconVariant(item.iconPath);
    if (base) sources.push(CDRAGON_ASSET_URL(item.branch, base));
  }

  // New sources, from the item data landing or another patch, start the list
  // over
  const sourcesKey = sources.join(" ");
  const [attempt, setAttempt] = useState(0);
  const [attemptsFor, setAttemptsFor] = useState(sourcesKey);
  if (attemptsFor !== sourcesKey) {
    setAttemptsFor(sourcesKey);
    setAttempt(0);
  }

  const src = sources[attempt];

  if (!itemId || itemId === 0 || !src) {
    return (
      <div
        className="rounded bg-white/5 border border-white/10"
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <HoverCard
      content={
        item?.name ? (
          <>
            <div className="mb-1 font-semibold text-lol-gold-light">{item.name}</div>
            <RiotText markup={item.description} />
          </>
        ) : null
      }
    >
      <img
        key={src}
        src={src}
        alt=""
        // No title= — the browser's own tooltip would surface a second later
        // and sit on top of the card showing the same name.
        width={size}
        height={size}
        className="rounded"
        onError={() => setAttempt((a) => a + 1)}
      />
    </HoverCard>
  );
}
