import { useState } from "react";
import { PROFILE_ICON_URL } from "../lib/constants";

interface SummonerIconProps {
  iconId: number | null;
  size?: number;
  className?: string;
  // Fetched only as it scrolls near view, for lists long enough that loading
  // every icon up front would mean a request per player
  lazy?: boolean;
}

// Profile icons only exist for players we've seen a profileIcon for, and the
// CDN drops very old ones — fall back to a neutral placeholder either way so
// the column keeps its width.
export default function SummonerIcon({
  iconId,
  size = 28,
  className = "",
  lazy = false,
}: SummonerIconProps) {
  const [failed, setFailed] = useState(false);

  if (iconId == null || failed) {
    return (
      <div
        style={{ width: size, height: size }}
        className={`rounded-full bg-lol-border/60 shrink-0 ${className}`}
      />
    );
  }

  return (
    <img
      src={PROFILE_ICON_URL(iconId)}
      alt=""
      width={size}
      height={size}
      loading={lazy ? "lazy" : undefined}
      className={`rounded-full shrink-0 ${className}`}
      onError={() => setFailed(true)}
    />
  );
}
