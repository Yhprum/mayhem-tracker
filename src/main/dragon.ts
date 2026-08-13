import fs from "fs";
import path from "path";
import { getDataDir } from "./paths";

// Every one of these requests gates something the UI waits on: champion data
// blocks dragon:champions, db:teammate-detail and data:repair-puuids, and a
// request that never settles leaves those hanging with no error to show.
const REQUEST_TIMEOUT_MS = 10_000;

let championCache: Record<number, { name: string; key: string; class?: string }> = {};
// Data Dragon version the champion cache came from ("none" until any data
// loads). Folded into the score-backfill key so stored scores recompute when
// champion class data changes.
let championDataVersion = "none";
let augmentCache: Record<number, { name: string; desc: string; iconPath: string; rarity: string }> =
  {};

let championReady: Promise<void> | null = null;
let augmentReady: Promise<void> | null = null;

// fetch follows redirects itself, with its own cap — the hand-rolled version
// this replaces recursed on Location with no limit and no timeout.
async function fetchJson(url: string): Promise<any> {
  const res = await fetch(url, {
    headers: { "User-Agent": "MayhemTracker/1.0" },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(`Request failed: ${res.status} ${url}`);
  }
  return res.json();
}

const championCacheFile = () => path.join(getDataDir(), "champion-cache.json");

// Last successfully fetched champion data, so offline startups still have
// names and classes (and scoring stays consistent with the previous run).
function hydrateChampionCacheFromDisk() {
  try {
    const cached = JSON.parse(fs.readFileSync(championCacheFile(), "utf8"));
    if (cached?.champions && cached?.version) {
      championCache = cached.champions;
      championDataVersion = cached.version;
    }
  } catch {
    // No cache yet, or unreadable — network load will populate it
  }
}

export function loadChampionData() {
  championReady = (async () => {
    hydrateChampionCacheFromDisk();
    try {
      const versions = await fetchJson("https://ddragon.leagueoflegends.com/api/versions.json");
      const version = versions[0];

      const data = await fetchJson(
        `https://ddragon.leagueoflegends.com/cdn/${version}/data/en_US/champion.json`,
      );
      const cache: typeof championCache = {};
      for (const [key, champ] of Object.entries(data.data) as any[]) {
        cache[parseInt(champ.key)] = { name: champ.name, key, class: champ.tags?.[0] };
      }
      championCache = cache;
      championDataVersion = version;
      try {
        fs.writeFileSync(championCacheFile(), JSON.stringify({ version, champions: cache }));
      } catch (err) {
        console.error("Failed to persist champion cache:", err);
      }
      console.log(
        `Loaded ${Object.keys(championCache).length} champions from Data Dragon v${version}`,
      );
    } catch (err) {
      console.error("Failed to load champion data:", err);
    }
  })();
  return championReady;
}

export function loadAugmentData() {
  augmentReady = (async () => {
    try {
      const data = await fetchJson(
        "https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1/cherry-augments.json",
      );
      augmentCache = {};

      // cherry-augments.json is an array of augment objects
      if (Array.isArray(data)) {
        for (const aug of data) {
          augmentCache[aug.id] = {
            name: aug.name || aug.nameTRA || `Augment ${aug.id}`,
            desc: aug.desc || aug.descriptionTRA || "",
            iconPath: aug.augmentSmallIconPath || aug.iconSmall || aug.iconLarge || "",
            rarity: aug.rarity || "",
          };
        }
      } else if (typeof data === "object") {
        // Could be keyed by id
        for (const [id, aug] of Object.entries(data) as any[]) {
          const numId = parseInt(id);
          if (!isNaN(numId)) {
            augmentCache[numId] = {
              name: aug.name || aug.nameTRA || `Augment ${numId}`,
              desc: aug.desc || aug.descriptionTRA || "",
              iconPath: aug.augmentSmallIconPath || aug.iconSmall || aug.iconLarge || "",
              rarity: aug.rarity || "",
            };
          }
        }
      }

      console.log(`Loaded ${Object.keys(augmentCache).length} augments from CommunityDragon`);
    } catch (err) {
      console.error("Failed to load augment data:", err);
    }
  })();
  return augmentReady;
}

export type ItemInfo = { name: string; iconPath: string; branch: string };

const itemCache = new Map<string, Record<number, ItemInfo>>();
const itemPromises = new Map<string, Promise<Record<number, ItemInfo>>>();
let latestLivePatch: string | null = null;

const itemsJsonUrl = (branch: string) =>
  `https://raw.communitydragon.org/${branch}/plugins/rcp-be-lol-game-data/global/default/v1/items.json`;

// Map a game's major.minor patch to the CommunityDragon branch that has its
// data: live patches have their own branch, the current patch is "latest",
// and a patch newer than live only exists on "pbe".
async function resolveItemBranch(patch?: string): Promise<string> {
  if (!patch) return "latest";
  try {
    if (!latestLivePatch) {
      const versions = await fetchJson("https://ddragon.leagueoflegends.com/api/versions.json");
      const m = String(versions[0]).match(/^(\d+)\.(\d+)/);
      if (m) latestLivePatch = `${m[1]}.${m[2]}`;
    }
    if (latestLivePatch) {
      const [liveMajor, liveMinor] = latestLivePatch.split(".").map(Number);
      const [major, minor] = patch.split(".").map(Number);
      if (major > liveMajor || (major === liveMajor && minor > liveMinor)) return "pbe";
      if (major === liveMajor && minor === liveMinor) return "latest";
    }
  } catch {
    /* fall through to the patch's own branch */
  }
  return patch;
}

export function loadItemData(patch?: string): Promise<Record<number, ItemInfo>> {
  const key = patch ?? "latest";
  const cached = itemCache.get(key);
  if (cached) return Promise.resolve(cached);

  let promise = itemPromises.get(key);
  if (!promise) {
    promise = (async () => {
      const branch = await resolveItemBranch(patch);
      let data: any;
      try {
        data = await fetchJson(itemsJsonUrl(branch));
      } catch (err) {
        if (branch === "latest") throw err;
        data = await fetchJson(itemsJsonUrl("latest"));
      }
      const items: Record<number, ItemInfo> = {};
      if (Array.isArray(data)) {
        for (const item of data) {
          items[item.id] = { name: item.name || "", iconPath: item.iconPath || "", branch };
        }
      }
      itemCache.set(key, items);
      console.log(`Loaded ${Object.keys(items).length} items from CommunityDragon (${branch})`);
      return items;
    })();
    // Drop failed loads so a later request can retry
    promise.catch(() => itemPromises.delete(key));
    itemPromises.set(key, promise);
  }
  return promise;
}

export async function waitForChampionData() {
  if (championReady) await championReady;
}

export async function waitForAugmentData() {
  if (augmentReady) await augmentReady;
}

export function getChampionData() {
  return championCache;
}

export function getChampionClasses(): Record<number, string> {
  const map: Record<number, string> = {};
  for (const [id, champ] of Object.entries(championCache)) {
    if (champ.class) map[Number(id)] = champ.class;
  }
  return map;
}

export function getChampionDataVersion() {
  return championDataVersion;
}

export function getAugmentDataCache() {
  return augmentCache;
}
