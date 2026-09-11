import fs from "fs";
import path from "path";
import { getDataDir } from "./paths";
import augmentDescriptions from "./augment-descriptions.json";

// Every one of these requests gates something the UI waits on: champion data
// blocks dragon:champions, db:teammate-detail and data:repair-puuids, and a
// request that never settles leaves those hanging with no error to show.
const REQUEST_TIMEOUT_MS = 10_000;

let championCache: Record<number, { name: string; key: string; class?: string }> = {};
// Data Dragon version the champion cache came from ("none" until any data
// loads). Folded into the score-backfill key so stored scores recompute when
// champion class data changes.
let championDataVersion = "none";

let championReady: Promise<void> | null = null;

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

export type AugmentInfo = {
  name: string;
  desc: string;
  iconPath: string;
  rarity: string;
  branch: string;
};

const augmentCaches = new Map<string, Record<number, AugmentInfo>>();
const augmentPromises = new Map<string, Promise<Record<number, AugmentInfo>>>();

const cherryAugmentsUrl = (branch: string) =>
  `https://raw.communitydragon.org/${branch}/plugins/rcp-be-lol-game-data/global/default/v1/cherry-augments.json`;

// Tooltip text, bundled rather than fetched: cherry-augments.json carries an
// augment's name, rarity and art but no description at all, and the game data
// that does is 44MB per patch. See scripts/generate-augment-descriptions.mjs.
//
// Unlike the rest of AugmentInfo, this is not patch-accurate — it's whatever
// the text was when the generator last ran. That's the right trade for prose,
// and the wrong one for a rarity ring, which is why only this field takes it.
const descriptions: Record<string, string> = augmentDescriptions.descriptions;

// cherry-augments.json is normally an array of augment objects, but has also
// been served keyed by id.
function parseAugments(data: any, branch: string): Record<number, AugmentInfo> {
  const augments: Record<number, AugmentInfo> = {};
  const entries = Array.isArray(data) ? data : Object.values(data ?? {});
  for (const aug of entries as any[]) {
    const id = Number(aug?.id);
    if (!Number.isFinite(id)) continue;
    augments[id] = {
      name: aug.name || aug.nameTRA || `Augment ${id}`,
      desc: descriptions[String(id)] ?? "",
      iconPath: aug.augmentSmallIconPath || aug.iconSmall || aug.iconLarge || "",
      rarity: aug.rarity || "",
      branch,
    };
  }
  return augments;
}

/**
 * Augment names, rarities and icon paths as of a given patch, or of the live
 * game when no patch is given.
 *
 * Riot reworks augments in place — Double Tap went from kGold to kPrismatic in
 * 16.17, keeping id 2010 — so reading a historical game against the live export
 * misreports what was actually played. Asking the game's own branch keeps the
 * name, the rarity ring and the art in agreement, and it incidentally solves
 * retired augments: they're still present, with working art, on the branches
 * where they shipped.
 */
export function loadAugmentData(patch?: string): Promise<Record<number, AugmentInfo>> {
  const key = patch ?? "latest";
  const cached = augmentCaches.get(key);
  if (cached) return Promise.resolve(cached);

  let promise = augmentPromises.get(key);
  if (!promise) {
    promise = (async () => {
      const branch = await resolveDataBranch(patch);
      let resolved = branch;
      let data: any;
      try {
        data = await fetchJson(cherryAugmentsUrl(branch));
      } catch (err) {
        if (branch === "latest") throw err;
        // An archived branch that isn't there is better answered with current
        // data than with nothing.
        resolved = "latest";
        data = await fetchJson(cherryAugmentsUrl("latest"));
      }
      const augments = parseAugments(data, resolved);
      augmentCaches.set(key, augments);
      console.log(
        `Loaded ${Object.keys(augments).length} augments from CommunityDragon (${resolved})`,
      );
      return augments;
    })();
    // Drop failed loads so a later request can retry
    promise.catch(() => augmentPromises.delete(key));
    augmentPromises.set(key, promise);
  }
  return promise;
}

export type ItemInfo = {
  name: string;
  description: string;
  iconPath: string;
  branch: string;
  price?: number;
  from?: number[];
};

let runeDataCache: Record<
  number,
  { name: string; longDesc: string; icon: string; category: "keystone" | "secondary" | "tree" }
> | null = null;
export async function loadRuneData() {
  if (runeDataCache) return runeDataCache;
  const roots = (await fetchJson(
    "https://ddragon.leagueoflegends.com/cdn/16.18.1/data/en_US/runesReforged.json",
  )) as any[];
  const data: Record<
    number,
    { name: string; longDesc: string; icon: string; category: "keystone" | "secondary" | "tree" }
  > = {};
  let communityPerks: Record<number, { name?: string; shortDesc?: string; longDesc?: string; iconPath?: string }> = {};
  try {
    const perks = (await fetchJson(
      "https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1/perks.json",
    )) as any[];
    communityPerks = Object.fromEntries(perks.map((perk) => [perk.id, perk]));
  } catch {
    // Data Dragon metadata remains sufficient for names and IDs.
  }
  for (const root of roots) {
    // The tree itself (e.g. 8100 Domination) is a valid rune id too — it's
    // what participants.perks.styles[].style holds, and the primary/secondary
    // tree icon the compact match views draw comes from here.
    data[root.id] = {
      name: root.name,
      longDesc: "",
      icon: communityPerks[root.id]?.iconPath ?? root.icon,
      category: "tree",
    };
    for (const slot of root.slots ?? []) {
      for (const rune of slot.runes ?? []) {
        data[rune.id] = {
          name: rune.name,
          longDesc: rune.longDesc,
          icon: communityPerks[rune.id]?.iconPath ?? rune.icon,
          category: slot === root.slots[0] ? "keystone" : "secondary",
        };
      }
    }
  }
  // Data Dragon's reforged export does not include the three stat-shard
  // choices. CommunityDragon's complete perk catalog does, so retain those
  // entries as well for match tooltips and the compact scoreboard.
  for (const [id, perk] of Object.entries(communityPerks)) {
    const numericId = Number(id);
    if (!Number.isFinite(numericId) || data[numericId] || !perk.iconPath) continue;
    data[numericId] = {
      name: perk.name ?? `Perk ${numericId}`,
      longDesc: perk.longDesc ?? perk.shortDesc ?? "",
      icon: perk.iconPath,
      category: "secondary",
    };
  }
  runeDataCache = data;
  return data;
}

let runeTreeLayoutCache: Record<
  number,
  { id: number; key: string; name: string; icon: string; slots: number[][] }
> | null = null;
export async function loadRuneTreeLayout() {
  if (runeTreeLayoutCache) return runeTreeLayoutCache;
  const roots = (await fetchJson(
    "https://ddragon.leagueoflegends.com/cdn/16.18.1/data/en_US/runesReforged.json",
  )) as any[];
  const layout: Record<
    number,
    { id: number; key: string; name: string; icon: string; slots: number[][] }
  > = {};
  for (const root of roots) {
    layout[root.id] = {
      id: root.id,
      key: root.key,
      name: root.name,
      icon: root.icon,
      slots: (root.slots ?? []).map((slot: any) => (slot.runes ?? []).map((r: any) => r.id)),
    };
  }
  runeTreeLayoutCache = layout;
  return layout;
}

const runeDictionaryCache = new Map<string, Record<number, string>>();
export async function getRunesDictionary(version = "16.18.1") {
  const cached = runeDictionaryCache.get(version);
  if (cached) return cached;
  const roots = (await fetchJson(
    `https://ddragon.leagueoflegends.com/cdn/${version}/data/en_US/runesReforged.json`,
  )) as any[];
  const dictionary: Record<number, string> = {};
  for (const tree of roots) {
    dictionary[tree.id] = tree.key;
    for (const slot of tree.slots ?? []) {
      for (const rune of slot.runes ?? []) dictionary[rune.id] = rune.key;
    }
  }
  runeDictionaryCache.set(version, dictionary);
  return dictionary;
}

const itemCache = new Map<string, Record<number, ItemInfo>>();
const itemPromises = new Map<string, Promise<Record<number, ItemInfo>>>();
let latestLivePatch: string | null = null;

const itemsJsonUrl = (branch: string) =>
  `https://raw.communitydragon.org/${branch}/plugins/rcp-be-lol-game-data/global/default/v1/items.json`;

const dataDragonItemsUrl = (patch: string) =>
  `https://ddragon.leagueoflegends.com/cdn/${patch}/data/en_US/item.json`;

// Map a game's major.minor patch to the CommunityDragon branch that has its
// data: live patches have their own branch, the current patch is "latest",
// and a patch newer than live only exists on "pbe".
async function resolveDataBranch(patch?: string): Promise<string> {
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
      const branch = await resolveDataBranch(patch);
      let data: any;
      // Track the branch that actually served the data: if the historical
      // branch 404s and we fall back to "latest", icons must be built from
      // "latest" too, not the branch that failed.
      let usedBranch = branch;
      try {
        data = await fetchJson(itemsJsonUrl(branch));
      } catch (err) {
        if (branch === "latest") throw err;
        try {
          data = await fetchJson(itemsJsonUrl("latest"));
        } catch (fallbackError) {
          console.error(
            `Failed to load item data from ${branch} and latest fallback`,
            fallbackError,
          );
          throw fallbackError;
        }
        usedBranch = "latest";
      }
      let dataDragon: any = null;
      try {
        const versions = await fetchJson("https://ddragon.leagueoflegends.com/api/versions.json");
        const patch = usedBranch === "latest" ? String(versions[0]) : usedBranch;
        dataDragon = await fetchJson(dataDragonItemsUrl(patch));
      } catch {
        // CommunityDragon remains the source for descriptions and icons.
      }
      const items: Record<number, ItemInfo> = {};
      if (Array.isArray(data)) {
        for (const item of data) {
          const ddragonItem = dataDragon?.data?.[String(item.id)];
          items[item.id] = {
            name: item.name || "",
            // Riot ships this already resolved — no @Var@ placeholders to substitute,
            // unlike the augment tooltips, which name their values indirectly.
            description: item.description || "",
            iconPath: item.iconPath || "",
            branch: usedBranch,
            price: Number.isFinite(Number(ddragonItem?.gold?.total))
              ? Number(ddragonItem.gold.total)
              : undefined,
            from: Array.isArray(item.from) ? item.from : undefined,
          };
        }
      }
      itemCache.set(key, items);
      console.log(`Loaded ${Object.keys(items).length} items from CommunityDragon (${usedBranch})`);
      return items;
    })();
    // Drop failed loads so a later request can retry
    promise.catch(() => itemPromises.delete(key));
    itemPromises.set(key, promise);
  }
  return promise;
}

export type SummonerSpellInfo = { name: string; iconPath: string };

let spellCache: Record<number, SummonerSpellInfo> | null = null;
let spellPromise: Promise<Record<number, SummonerSpellInfo>> | null = null;

// Summoner spell art doesn't change patch to patch the way item art does, so
// one "latest" fetch serves every game.
export function loadSummonerSpellData(): Promise<Record<number, SummonerSpellInfo>> {
  if (spellCache) return Promise.resolve(spellCache);
  if (!spellPromise) {
    spellPromise = (async () => {
      const data = await fetchJson(
        "https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1/summoner-spells.json",
      );
      const spells: Record<number, SummonerSpellInfo> = {};
      if (Array.isArray(data)) {
        for (const spell of data) {
          spells[spell.id] = { name: spell.name || "", iconPath: spell.iconPath || "" };
        }
      }
      spellCache = spells;
      console.log(`Loaded ${Object.keys(spells).length} summoner spells from CommunityDragon`);
      return spells;
    })();
    // Drop failed loads so a later request can retry
    spellPromise.catch(() => {
      spellPromise = null;
    });
  }
  return spellPromise;
}

export async function waitForChampionData() {
  if (championReady) await championReady;
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

// The live export, for callers that reason about the current game rather than
// a historical one. Empty until loadAugmentData() has resolved.
function getLiveAugments(): Record<number, AugmentInfo> {
  return augmentCaches.get("latest") ?? {};
}

// ---------------------------------------------------------------------------
// Retired augment icons
//
// cherry-augments.json on "latest" still names augments Riot has cut (Hat on a
// Hat, Self Destruct), but their art is gone from the latest game export, so
// the icon 404s while the tooltip still works. The art does survive on the
// archived patch branches, and an augment's iconPath can differ between
// branches (1108's picked up a ".MAYHEM_New_Augments" texture suffix), so
// resolving one means reading that branch's own cherry-augments.json.

// How far back to walk before giving up. Retired augments were in the game
// recently enough to be in someone's match history, so hits come early; the cap
// stops a permanently-missing icon from pulling down a year of manifests.
const MAX_ICON_BRANCH_LOOKBACK = 12;

// A stats page renders hundreds of icons at once and CommunityDragon throttles
// bursts, so several <img> tags can fail at the same moment. Resolving those in
// parallel would aim the same burst at the same host; keep it to a trickle.
const ICON_LOOKUP_CONCURRENCY = 4;

type AugmentIconCache = Record<string, string | null>;

let augmentIconCache: AugmentIconCache | null = null;
const augmentIconPending = new Map<string, Promise<string | null>>();
const branchAugmentIcons = new Map<string, Record<number, string>>();
// Branches whose manifest couldn't be read. The empty result is still memoized
// so the walk doesn't retry them for every augment, but a branch we failed to
// read is not evidence that the art isn't on it.
const branchLoadFailures = new Set<string>();
let archivedBranches: string[] | null = null;

const augmentIconCacheFile = () => path.join(getDataDir(), "augment-icon-cache.json");

function readAugmentIconCache(): AugmentIconCache {
  if (!augmentIconCache) {
    try {
      augmentIconCache = JSON.parse(fs.readFileSync(augmentIconCacheFile(), "utf8"));
    } catch {
      augmentIconCache = {};
    }
  }
  return augmentIconCache!;
}

function writeAugmentIconCache(id: number, url: string | null) {
  const cache = readAugmentIconCache();
  cache[String(id)] = url;
  try {
    fs.writeFileSync(augmentIconCacheFile(), JSON.stringify(cache));
  } catch (err) {
    console.error("Failed to persist augment icon cache:", err);
  }
}

let lookupSlots = ICON_LOOKUP_CONCURRENCY;
const lookupQueue: (() => void)[] = [];

async function withLookupSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (lookupSlots === 0) await new Promise<void>((resolve) => lookupQueue.push(resolve));
  lookupSlots--;
  try {
    return await fn();
  } finally {
    lookupSlots++;
    lookupQueue.shift()?.();
  }
}

// Patch branches newest first. Only numeric ones — "latest" and "pbe" are
// already covered by the live data, and the rest are per-locale mirrors.
async function getArchivedBranches(): Promise<string[]> {
  if (archivedBranches) return archivedBranches;
  const listing = await fetchJson("https://raw.communitydragon.org/json/");
  const branches: string[] = (Array.isArray(listing) ? listing : [])
    .map((entry: any) => String(entry?.name ?? ""))
    .filter((name) => /^\d+\.\d+$/.test(name))
    .sort((a, b) => {
      const [aMajor, aMinor] = a.split(".").map(Number);
      const [bMajor, bMinor] = b.split(".").map(Number);
      return bMajor - aMajor || bMinor - aMinor;
    });
  archivedBranches = branches;
  return branches;
}

async function getBranchAugmentIcons(branch: string): Promise<Record<number, string>> {
  const cached = branchAugmentIcons.get(branch);
  if (cached) return cached;
  const icons: Record<number, string> = {};
  try {
    const data = await fetchJson(
      `https://raw.communitydragon.org/${branch}/plugins/rcp-be-lol-game-data/global/default/v1/cherry-augments.json`,
    );
    const entries = Array.isArray(data) ? data : Object.values(data ?? {});
    for (const aug of entries as any[]) {
      const iconPath = aug?.augmentSmallIconPath || aug?.iconSmall || aug?.iconLarge;
      if (aug?.id != null && iconPath) icons[Number(aug.id)] = iconPath;
    }
  } catch {
    // Branch missing or unreadable — memoize the empty result so the walk
    // doesn't retry it for every other augment in the same session.
    branchLoadFailures.add(branch);
  }
  branchAugmentIcons.set(branch, icons);
  return icons;
}

// Mirrors the renderer's CDRAGON_ASSET_URL so a resolved URL can be used as-is.
function assetUrl(branch: string, iconPath: string): string {
  return `https://raw.communitydragon.org/${branch}/game/${iconPath
    .replace("/lol-game-data/assets/", "")
    .toLowerCase()}`;
}

// The UI prefers the large art; the data names the small path, and a few
// augments only ever shipped the one the data names.
function iconVariants(iconPath: string): string[] {
  return [...new Set([iconPath.replace("small", "large"), iconPath])];
}

// "missing" is CommunityDragon answering that the asset isn't in this export;
// "error" is it declining to answer at all. Collapsing the two is what let a
// throttled request pass for a retired augment.
type IconProbe = "ok" | "missing" | "error";

async function probeUrl(url: string): Promise<IconProbe> {
  try {
    const res = await fetch(url, {
      method: "HEAD",
      headers: { "User-Agent": "MayhemTracker/1.0" },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (res.ok) return "ok";
    return res.status === 404 ? "missing" : "error";
  } catch {
    // Timed out or never connected — says nothing about the asset.
    return "error";
  }
}

// `conclusive` is false when a variant failed for a reason other than absence,
// so the caller can tell "this branch doesn't have it" from "we couldn't look".
type BranchIcon = { url: string | null; conclusive: boolean };

async function findIconOnBranch(branch: string, iconPath: string): Promise<BranchIcon> {
  let conclusive = true;
  for (const variant of iconVariants(iconPath)) {
    const url = assetUrl(branch, variant);
    const probe = await probeUrl(url);
    if (probe === "ok") return { url, conclusive: true };
    if (probe === "error") conclusive = false;
  }
  return { url: null, conclusive };
}

/**
 * Full CDN URL for an augment whose icon failed to load from the latest export,
 * or null if no recent patch branch has it.
 *
 * A genuinely retired augment resolves to an archived patch branch, and that
 * result (misses included) persists to disk so the branch walk happens once per
 * augment rather than once per launch. An augment whose art is still on
 * "latest" only got here because the CDN dropped the request, so it hands back
 * the live URL and caches nothing — pinning it to today's patch branch would
 * freeze art that Riot may still update.
 *
 * Nothing persists unless the walk actually established that the live export
 * lacks the art. Under a burst CommunityDragon throttles rather than 404s, and
 * a resolution built on a throttled answer is a guess; serve it for this
 * session, but writing it down would pin a live augment to old art forever.
 */
export function resolveAugmentIcon(id: number, patch?: string): Promise<string | null> {
  const cache = readAugmentIconCache();
  const key = String(id);
  if (key in cache) return Promise.resolve(cache[key]);

  let pending = augmentIconPending.get(key);
  if (!pending) {
    pending = withLookupSlot(async () => {
      const live = getLiveAugments();
      const livePath = live[id]?.iconPath;
      // An empty augment cache means the latest export never loaded, not that
      // the augment is absent from it.
      let liveIsGone = Object.keys(live).length > 0;
      if (livePath) {
        const onLatest = await findIconOnBranch("latest", livePath);
        if (onLatest.url) return onLatest.url;
        liveIsGone = onLatest.conclusive;
      }
      const branches = await getArchivedBranches();
      // The game's own patch is the branch most likely to have the art, so try
      // it first; otherwise walk back from the newest archived patch.
      const ordered = new Set([
        ...(patch && branches.includes(patch) ? [patch] : []),
        ...branches.slice(0, MAX_ICON_BRANCH_LOOKBACK),
      ]);
      let walkComplete = true;
      for (const branch of ordered) {
        const iconPath = (await getBranchAugmentIcons(branch))[id];
        if (branchLoadFailures.has(branch)) walkComplete = false;
        if (!iconPath) continue;
        const found = await findIconOnBranch(branch, iconPath);
        if (found.url) {
          console.log(`Resolved augment ${id} icon from CommunityDragon ${branch}`);
          if (liveIsGone) writeAugmentIconCache(id, found.url);
          return found.url;
        }
        if (!found.conclusive) walkComplete = false;
      }
      // Only remember "no art anywhere" if every branch actually said so.
      if (liveIsGone && walkComplete) writeAugmentIconCache(id, null);
      return null;
    });
    // Drop the in-flight entry either way: a resolved lookup is either cached
    // on disk or a transient miss that should be retried on the next render.
    pending.catch(() => {}).finally(() => augmentIconPending.delete(key));
    augmentIconPending.set(key, pending);
  }
  return pending;
}
