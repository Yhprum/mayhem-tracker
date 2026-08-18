import { useState, useEffect, useMemo } from "react";
import { useItemData } from "../hooks/useChampions";
import { CDRAGON_ASSET_URL } from "../lib/constants";

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
  const [attempt, setAttempt] = useState(0);

  const item = items[itemId];
  const sources = useMemo(() => {
    const urls: string[] = [];
    if (item?.iconPath) {
      urls.push(CDRAGON_ASSET_URL(item.branch, item.iconPath));
      const base = stripIconVariant(item.iconPath);
      if (base) urls.push(CDRAGON_ASSET_URL(item.branch, base));
    }
    // No tier below this: an item with no CommunityDragon mapping, or whose
    // icons all fail, falls through to the placeholder below.
    return urls;
  }, [item?.iconPath, item?.branch]);

  useEffect(() => {
    setAttempt(0);
  }, [sources]);

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
    <img
      key={src}
      src={src}
      alt=""
      title={item?.name}
      width={size}
      height={size}
      className="rounded"
      onError={() => setAttempt((a) => a + 1)}
    />
  );
}
