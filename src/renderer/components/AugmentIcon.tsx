import { useEffect, useMemo, useState } from "react";
import { useAugmentData } from "../hooks/useChampions";
import { CDRAGON_ASSET_URL } from "../lib/constants";
import HoverCard from "./HoverCard";
import RiotText from "./RiotText";

interface AugmentIconProps {
  augmentId: number;
  size?: number;
  showName?: boolean;
  patch?: string | null;
}

const rarityBorder: Record<string, string> = {
  kSilver: "ring-1 ring-gray-400/60",
  kGold: "ring-1 ring-yellow-500/70",
  kPrismatic: "ring-1 ring-fuchsia-400/80",
};

const rarityTextColor: Record<string, string> = {
  kSilver: "text-gray-300",
  kGold: "text-yellow-400",
  kPrismatic: "text-fuchsia-400",
};

// One lookup per augment for the whole renderer: a retired augment shows up on
// every row of the stats pages, and they'd otherwise each ask the main process.
// Keyed by patch as well, because a lookup that started from the live export
// searches different branches than one that knows the game it's drawing.
const fallbackLookups = new Map<string, Promise<string | null>>();
// The settled result of those lookups, so a remount can start on the archived
// URL instead of waiting a tick for the promise to come back around.
const fallbackResults = new Map<string, string | null>();
// Live "latest" URLs already known to 404. Without this, every remount of a
// retired augment — re-sorting a list, reopening an expanded row — replays the
// dead paths and shows a broken <img> until the fallback lands, which is what
// made the icon flicker each time.
const deadSources = new Set<string>();

const fallbackKey = (augmentId: number, patch?: string | null) =>
  `${augmentId}|${patch || "latest"}`;

function lookupFallbackIcon(augmentId: number, patch?: string | null): Promise<string | null> {
  const key = fallbackKey(augmentId, patch);
  let promise = fallbackLookups.get(key);
  if (!promise) {
    promise = window.api.resolveAugmentIcon(augmentId, patch ?? undefined);
    fallbackLookups.set(key, promise);
    promise.then(
      (url) => fallbackResults.set(key, url),
      () => fallbackLookups.delete(key),
    );
  }
  return promise;
}

function getAugmentRarityLabel(rarity: string): string {
  if (rarity === "kSilver") return "Silver";
  if (rarity === "kGold") return "Gold";
  if (rarity === "kPrismatic") return "Prismatic";
  return "";
}

export default function AugmentIcon({
  augmentId,
  size = 28,
  showName = false,
  patch,
}: AugmentIconProps) {
  const augmentData = useAugmentData(patch);
  const aug = augmentData[augmentId];
  const [attempt, setAttempt] = useState(0);
  const cacheKey = fallbackKey(augmentId, patch);
  const [fallback, setFallback] = useState<string | null>(
    () => fallbackResults.get(cacheKey) ?? null,
  );

  const sources = useMemo(() => {
    if (!aug?.iconPath) return [];
    // Paths are only valid against the branch they were read from, and the
    // data names the small art with the large variant beside it under the
    // same name.
    const branch = aug.branch || "latest";
    const large = CDRAGON_ASSET_URL(branch, aug.iconPath.replace("small", "large"));
    const small = CDRAGON_ASSET_URL(branch, aug.iconPath);
    return [...new Set([large, small])].filter((url) => !deadSources.has(url));
  }, [aug]);

  // Augment data arrives after the first render, so the live paths appear late;
  // start over on them, keeping whatever fallback is already known.
  const sourcesKey = `${cacheKey} ${sources.join(" ")}`;
  const [attemptsFor, setAttemptsFor] = useState(sourcesKey);
  if (attemptsFor !== sourcesKey) {
    setAttemptsFor(sourcesKey);
    setAttempt(0);
    setFallback(fallbackResults.get(cacheKey) ?? null);
  }

  // Augments Riot has cut keep their name and rarity on "latest" but lose their
  // art, so once the live paths 404 ask the main process to dig the icon out of
  // an archived patch branch.
  const exhausted = attempt >= sources.length;
  const resolved = fallbackResults.has(cacheKey);
  useEffect(() => {
    if (!exhausted || resolved) return;
    let active = true;
    lookupFallbackIcon(augmentId, patch).then((url) => {
      if (active) setFallback(url);
    });
    return () => {
      active = false;
    };
  }, [exhausted, resolved, augmentId, patch]);

  const name = aug?.name || `Augment ${augmentId}`;
  const borderClass = rarityBorder[aug?.rarity ?? ""] || "";
  const nameColor = rarityTextColor[aug?.rarity ?? ""] || "text-lol-text-bright";
  const src = sources[attempt] ?? fallback;

  const rarityLabel = getAugmentRarityLabel(aug?.rarity ?? "");

  return (
    <HoverCard
      content={
        aug ? (
          <>
            <div className="mb-1 flex items-baseline justify-between gap-2">
              <span className={`font-semibold ${nameColor}`}>{name}</span>
              {rarityLabel && (
                <span className={`shrink-0 text-[10px] uppercase tracking-wide ${nameColor}`}>
                  {rarityLabel}
                </span>
              )}
            </div>
            {aug.desc ? (
              <RiotText markup={aug.desc} />
            ) : (
              // Two Mayhem augments have no entry in the game data the
              // generator reads, and retired ones can outlive it.
              <span className="italic text-lol-text/50">No description available.</span>
            )}
          </>
        ) : null
      }
    >
      {/* The native tooltip stays for the moment before augment data lands. */}
      <div className="flex items-center gap-1.5 min-w-0" title={aug ? undefined : name}>
        {src ? (
          <img
            key={src}
            src={src}
            alt={name}
            width={size}
            height={size}
            className={`rounded shrink-0 ${borderClass}`}
            onError={() => {
              // Step down the live paths first, remembering the dead one so no
              // other icon retries it; a failed fallback has nothing left to try,
              // so drop to the placeholder.
              if (attempt < sources.length) {
                deadSources.add(sources[attempt]);
                setAttempt((a) => a + 1);
              } else setFallback(null);
            }}
          />
        ) : (
          // Keeps the rarity ring and the hover tooltip so an augment with no art
          // anywhere still reads as an augment rather than a gap in the row.
          <div
            className={`rounded shrink-0 bg-white/5 border border-white/10 ${borderClass}`}
            style={{ width: size, height: size }}
          />
        )}
        {showName && <span className={`text-xs truncate ${nameColor}`}>{name}</span>}
      </div>
    </HoverCard>
  );
}
