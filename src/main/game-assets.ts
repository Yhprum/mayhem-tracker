import { createHash, randomBytes } from "crypto";
import fs from "fs";
import path from "path";
import { protocol, session, type Session } from "electron";
import { getAssetCacheDir } from "./paths";
import { lcuBytes, onLcuStatusChange } from "./lcu";
import { ASSET_SCHEME, isPatchBranch } from "../shared/game-assets";

/*
 * Every piece of League art the app draws, and the game data that names it,
 * comes through here. Sources, in order:
 *
 *   1. A copy on disk, filed under the patch it is from. A patch's files never
 *      change once it ships, so a copy stays good until it's pruned. "latest" is
 *      filed under the patch it currently holds, so a new patch starts afresh.
 *   2. CommunityDragon, the only source with archived patches.
 *   3. The running client, which serves the current patch's files under
 *      /lol-game-data/assets/, including a few CommunityDragon doesn't export.
 *   4. For art only, the same file from another patch. Icons rarely change
 *      between patches, and art a little out of date beats a blank square.
 *
 * Game data on "latest" asks CommunityDragon before the disk instead, because
 * Riot hotfixes it mid-patch; the disk copy is then its fallback.
 */

const CDRAGON = "https://raw.communitydragon.org";

const REQUEST_TIMEOUT_MS = 10_000;
// A stats page asks for hundreds of icons at once. This many at a time still
// keeps up with the page, without aiming the whole burst at a host that
// throttles bursts.
const REMOTE_CONCURRENCY = 8;
// How long to stop asking CommunityDragon once it fails to answer. Otherwise
// every icon on a page waits out its own timeout before falling back.
const OUTAGE_BACKOFF_MS = 30_000;
// How soon to ask again which patch "latest" holds, after failing to find out
const LATEST_RETRY_MS = 60_000;

// Past the first, the least recently used files go until the second is reached
const MAX_CACHE_BYTES = 256 * 1024 * 1024;
const TARGET_CACHE_BYTES = 192 * 1024 * 1024;
// A read marks its file as used through the mtime, at most this often, so a
// cache hit is a read and not also a write
const TOUCH_INTERVAL_MS = 24 * 60 * 60 * 1000;
const PRUNE_DELAY_MS = 60_000;
const PRUNE_INTERVAL_MS = 24 * 60 * 60 * 1000;
// A temp file this old belongs to a write that never finished
const STRAY_TEMP_MS = 60 * 60 * 1000;

// "missing" is a source answering that it has no such file; "error" is no
// source answering at all, which says nothing about the file.
export type Fetched = { state: "ok"; bytes: Buffer } | { state: "missing" } | { state: "error" };

interface GameFile {
  // "latest", "pbe", or a patch like "16.14"
  branch: string;
  // Its identity within the branch, and what its disk copy is filed under
  path: string;
  // Where CommunityDragon serves it
  remote: string;
  // The running client's copy, if the client is up and has one
  local: () => Promise<Buffer | null>;
}

interface LoadMode {
  // Ask CommunityDragon before reading the disk copy
  networkFirst: boolean;
  // Accept another patch's copy when nothing else answers
  stale: boolean;
}

// ---------------------------------------------------------------------------
// CommunityDragon

let remoteSlots = REMOTE_CONCURRENCY;
const remoteQueue: (() => void)[] = [];

async function withRemoteSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (remoteSlots > 0) remoteSlots--;
  else await new Promise<void>((resolve) => remoteQueue.push(resolve));
  try {
    return await fn();
  } finally {
    // Handed straight to the next in line, so nothing can slip in between
    const next = remoteQueue.shift();
    if (next) next();
    else remoteSlots++;
  }
}

let outageUntil = 0;

function noteOutage(reason: string) {
  if (Date.now() >= outageUntil) {
    console.log(
      `CommunityDragon is not answering (${reason}); serving art from the client and disk`,
    );
  }
  outageUntil = Date.now() + OUTAGE_BACKOFF_MS;
}

const isOutage = () => Date.now() < outageUntil;

async function fetchRemote(url: string): Promise<Fetched> {
  if (isOutage()) return { state: "error" };
  return withRemoteSlot(async (): Promise<Fetched> => {
    // It may have gone down while this waited its turn
    if (isOutage()) return { state: "error" };
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": "MayhemTracker/1.0" },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (res.ok) return { state: "ok", bytes: Buffer.from(await res.arrayBuffer()) };
      if (res.status === 404) return { state: "missing" };
      // A throttled request is CommunityDragon answering, just not this
      // request, so only a failing server counts as an outage.
      if (res.status >= 500) noteOutage(`HTTP ${res.status}`);
      return { state: "error" };
    } catch (err) {
      noteOutage(err instanceof Error ? err.message : String(err));
      return { state: "error" };
    }
  });
}

function imageType(bytes: Buffer): string | null {
  if (bytes.length >= 8 && bytes.readUInt32BE(0) === 0x89504e47) return "image/png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 12 &&
    bytes.toString("latin1", 0, 4) === "RIFF" &&
    bytes.toString("latin1", 8, 12) === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}

// A success that isn't the file (an error page served with a 200) must not be
// filed away as one: a patch's copy is never fetched again.
function isWellFormed(file: GameFile, bytes: Buffer): boolean {
  if (!file.path.endsWith(".json")) return imageType(bytes) !== null;
  try {
    JSON.parse(bytes.toString("utf8"));
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Disk

let root: string | null = null;
const cacheRoot = () => (root ??= getAssetCacheDir());

// Hashed rather than mirrored, so no game path can name a file outside the
// cache or run past Windows' path limit
function cacheFile(key: string, gamePath: string): string {
  const name = createHash("sha1").update(gamePath).digest("hex") + path.extname(gamePath);
  return path.join(cacheRoot(), key, name);
}

function byNewestPatch(a: string, b: string): number {
  const [aMajor, aMinor] = a.split(".").map(Number);
  const [bMajor, bMinor] = b.split(".").map(Number);
  return bMajor - aMajor || bMinor - aMinor;
}

// Patches with copies on disk, newest first
let patchesOnDisk: string[] | null = null;

function cachedPatches(): string[] {
  if (!patchesOnDisk) {
    try {
      patchesOnDisk = fs.readdirSync(cacheRoot()).filter(isPatchBranch).sort(byNewestPatch);
    } catch {
      patchesOnDisk = [];
    }
  }
  return patchesOnDisk;
}

async function readCached(file: string): Promise<Buffer | null> {
  try {
    const [bytes, stat] = await Promise.all([fs.promises.readFile(file), fs.promises.stat(file)]);
    if (Date.now() - stat.mtimeMs > TOUCH_INTERVAL_MS) {
      const now = new Date();
      fs.promises.utimes(file, now, now).catch(() => {});
    }
    return bytes;
  } catch {
    return null;
  }
}

async function store(key: string | null, gamePath: string, bytes: Buffer): Promise<void> {
  if (!key) return;
  const file = cacheFile(key, gamePath);
  // Written beside the copy and moved into place, so a write cut off partway
  // never leaves a truncated file where a reader would take it for the real one
  const temp = `${file}.${randomBytes(4).toString("hex")}.tmp`;
  try {
    await fs.promises.mkdir(path.dirname(file), { recursive: true });
    await fs.promises.writeFile(temp, bytes);
    await fs.promises.rename(temp, file);
    const patches = cachedPatches();
    if (!patches.includes(key)) patchesOnDisk = [...patches, key].sort(byNewestPatch);
  } catch (err) {
    fs.promises.rm(temp, { force: true }).catch(() => {});
    console.error(`Failed to cache ${key}/${gamePath}:`, err);
  }
}

// ---------------------------------------------------------------------------
// Which patch a copy belongs to

// The patch CommunityDragon's "latest" holds, by its own metadata rather than
// Riot's version list, since on patch day the two disagree for hours. Null
// until it has said, and nothing from "latest" is filed away before then.
let latestPatch: string | null = null;
let latestPending: Promise<string | null> | null = null;
let latestAskedAt = 0;

const majorMinor = (version: unknown) => {
  const match = String(version).match(/^(\d+)\.(\d+)\./);
  return match ? `${match[1]}.${match[2]}` : null;
};

function confirmLatestPatch(): Promise<string | null> {
  if (latestPatch) return Promise.resolve(latestPatch);
  if (latestPending) return latestPending;
  if (Date.now() - latestAskedAt < LATEST_RETRY_MS) return Promise.resolve(null);
  latestAskedAt = Date.now();
  latestPending = (async () => {
    const res = await fetchRemote(`${CDRAGON}/latest/content-metadata.json`);
    if (res.state === "ok") {
      try {
        latestPatch = majorMinor(JSON.parse(res.bytes.toString("utf8"))?.version);
      } catch {
        // Unreadable metadata says nothing; ask again later
      }
    }
    return latestPatch;
  })().finally(() => {
    latestPending = null;
  });
  return latestPending;
}

// The patch the running client is on, which is what its files are copies of.
// Forgotten whenever the client comes or goes, since it may have updated. A
// client still starting up can fail to say, so only an answer is remembered,
// and a failure is asked again after a pause rather than once per file.
const CLIENT_PATCH_RETRY_MS = 10_000;
let clientPatchKnown: string | null = null;
let clientPatchPending: Promise<string | null> | null = null;
let clientPatchAskedAt = 0;

function clientPatch(): Promise<string | null> {
  if (clientPatchKnown) return Promise.resolve(clientPatchKnown);
  if (clientPatchPending) return clientPatchPending;
  if (Date.now() - clientPatchAskedAt < CLIENT_PATCH_RETRY_MS) return Promise.resolve(null);
  clientPatchAskedAt = Date.now();
  clientPatchPending = lcuBytes("/lol-patch/v1/game-version")
    .then((bytes) => (bytes ? majorMinor(JSON.parse(bytes.toString("utf8"))) : null))
    .catch(() => null)
    .then((patch) => (clientPatchKnown = patch))
    .finally(() => {
      clientPatchPending = null;
    });
  return clientPatchPending;
}

// Where a branch's copies are read from. Until CommunityDragon says which
// patch "latest" holds, the newest one on disk stands in: right unless a patch
// has shipped since, and then out of date in the way that's still useful.
function readKey(branch: string): string | null {
  if (isPatchBranch(branch)) return branch;
  if (branch !== "latest") return null;
  return latestPatch ?? cachedPatches()[0] ?? null;
}

// Where a copy fresh from CommunityDragon is filed. "pbe" changes too often to
// be worth keeping.
async function remoteKey(branch: string): Promise<string | null> {
  if (isPatchBranch(branch)) return branch;
  return branch === "latest" ? confirmLatestPatch() : null;
}

// ---------------------------------------------------------------------------
// Loading

// Files a source said don't exist, for the rest of the session. The renderer
// steps through fallback paths on every remount, and each would otherwise ask
// again.
const missing = new Set<string>();
const inFlight = new Map<string, Promise<Fetched>>();

async function resolveFile(file: GameFile, mode: LoadMode): Promise<Fetched> {
  const key = readKey(file.branch);
  const copy = key ? cacheFile(key, file.path) : null;
  if (copy && !mode.networkFirst) {
    const bytes = await readCached(copy);
    if (bytes) return { state: "ok", bytes };
  }

  let remote = await fetchRemote(file.remote);
  if (remote.state === "ok") {
    if (isWellFormed(file, remote.bytes)) {
      const { bytes } = remote;
      void remoteKey(file.branch).then((target) => store(target, file.path, bytes));
      return remote;
    }
    remote = { state: "error" };
  }

  // The client only holds today's files. For "latest" those are the files
  // themselves. For a patch CommunityDragon couldn't be asked about, they are a
  // stand-in, which art can take but data can't; and a patch branch that
  // answered "missing" has the last word.
  if (file.branch === "latest" || (remote.state === "error" && mode.stale)) {
    const bytes = await file.local();
    if (bytes && isWellFormed(file, bytes)) {
      if (file.branch === "latest") {
        void clientPatch().then((target) => store(target, file.path, bytes));
      }
      return { state: "ok", bytes };
    }
  }

  if (copy && mode.networkFirst) {
    const bytes = await readCached(copy);
    if (bytes) return { state: "ok", bytes };
  }
  if (remote.state === "missing") return remote;

  if (mode.stale) {
    for (const other of cachedPatches()) {
      if (other === key) continue;
      const bytes = await readCached(cacheFile(other, file.path));
      if (bytes) return { state: "ok", bytes };
    }
  }
  return { state: "error" };
}

function load(file: GameFile, mode: LoadMode): Promise<Fetched> {
  const id = `${file.branch}|${file.path}`;
  if (missing.has(id)) return Promise.resolve({ state: "missing" });
  // Several icons on a page are often the same file
  const key = `${id}|${mode.networkFirst}|${mode.stale}`;
  let promise = inFlight.get(key);
  if (!promise) {
    promise = resolveFile(file, mode)
      .then((result) => {
        if (result.state === "missing") missing.add(id);
        return result;
      })
      .finally(() => inFlight.delete(key));
    inFlight.set(key, promise);
  }
  return promise;
}

// A path under /lol-game-data/assets/. The client serves its own data (v1/)
// and the game's files from that one root; CommunityDragon exports the two
// separately.
function gameDataFile(branch: string, gamePath: string): GameFile {
  return {
    branch,
    path: gamePath,
    remote: gamePath.startsWith("v1/")
      ? `${CDRAGON}/${branch}/plugins/rcp-be-lol-game-data/global/default/${gamePath}`
      : `${CDRAGON}/${branch}/game/${gamePath}`,
    local: () => lcuBytes(`/lol-game-data/assets/${gamePath}`),
  };
}

function splashFile(championId: number): GameFile {
  return {
    branch: "latest",
    path: `splash/${championId}.jpg`,
    // The cdn host looks up where the art is and redirects there
    remote: `https://cdn.communitydragon.org/latest/champion/${championId}/splash-art/centered`,
    local: async () => {
      const data = await lcuBytes(`/lol-game-data/assets/v1/champions/${championId}.json`);
      if (!data) return null;
      try {
        const skins: any[] = JSON.parse(data.toString("utf8"))?.skins ?? [];
        const base = skins.find((skin) => skin?.isBase) ?? skins[0];
        return typeof base?.splashPath === "string" ? await lcuBytes(base.splashPath) : null;
      } catch {
        return null;
      }
    },
  };
}

/**
 * JSON CommunityDragon serves outside the game data (its branch listing), not
 * kept on disk, but held to the same outage backoff and concurrency.
 */
export async function fetchCdragonJson(url: string): Promise<any> {
  const result = await fetchRemote(url);
  if (result.state !== "ok") throw new Error(`Request failed (${result.state}): ${url}`);
  return JSON.parse(result.bytes.toString("utf8"));
}

/** Art at a game-data path (see gameDataPath) as of a branch. */
export function loadGameImage(branch: string, gamePath: string): Promise<Fetched> {
  return load(gameDataFile(branch, gamePath), { networkFirst: false, stale: true });
}

/**
 * Parsed game data at a game-data path (such as "v1/items.json") as of a
 * branch. Throws when no source has it.
 */
export async function loadGameData(branch: string, gamePath: string): Promise<any> {
  const result = await load(gameDataFile(branch, gamePath), {
    networkFirst: !isPatchBranch(branch),
    // Another patch's data would misreport what this one shipped. Whether
    // "latest" may stand in for an archived patch is the caller's decision.
    stale: branch === "latest",
  });
  if (result.state !== "ok") throw new Error(`No ${gamePath} on ${branch} (${result.state})`);
  return JSON.parse(result.bytes.toString("utf8"));
}

// ---------------------------------------------------------------------------
// The asset: scheme

const IMAGE_PATH = /^[a-z0-9_.-]+(\/[a-z0-9_.-]+)*\.(png|jpe?g|webp)$/;

// The URLs src/shared/game-assets.ts builds, and nothing else: no segment that
// could climb out of /lol-game-data/assets/ on the client.
function parseAssetUrl(url: string): GameFile | null {
  let host: string;
  let segments: string[];
  try {
    const parsed = new URL(url);
    host = parsed.host;
    segments = parsed.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  } catch {
    return null;
  }

  if (host === "game-data") {
    const [branch, ...rest] = segments;
    if (!branch || !(isPatchBranch(branch) || branch === "latest" || branch === "pbe")) return null;
    const gamePath = rest.join("/").toLowerCase();
    if (!IMAGE_PATH.test(gamePath) || gamePath.split("/").some((s) => /^\.+$/.test(s))) {
      return null;
    }
    return gameDataFile(branch, gamePath);
  }
  if (host === "splash" && segments.length === 1 && /^\d+$/.test(segments[0])) {
    return splashFile(Number(segments[0]));
  }
  return null;
}

async function serve(request: Request): Promise<Response> {
  const file = request.method === "GET" ? parseAssetUrl(request.url) : null;
  if (!file) return new Response(null, { status: 400 });
  const result = await load(file, { networkFirst: false, stale: true });
  if (result.state !== "ok") {
    return new Response(null, { status: result.state === "missing" ? 404 : 503 });
  }
  return new Response(new Uint8Array(result.bytes), {
    headers: { "Content-Type": imageType(result.bytes) ?? "application/octet-stream" },
  });
}

// Before the app is ready: a scheme's privileges are fixed at startup
export function registerAssetScheme() {
  protocol.registerSchemesAsPrivileged([
    { scheme: ASSET_SCHEME, privileges: { standard: true, secure: true } },
  ]);
}

// Each session that renders the app needs the handler; the card window runs in
// one of its own.
export function serveGameAssets(target: Session) {
  if (!target.protocol.isProtocolHandled(ASSET_SCHEME)) {
    target.protocol.handle(ASSET_SCHEME, serve);
  }
}

export function startGameAssets() {
  serveGameAssets(session.defaultSession);
  onLcuStatusChange(() => {
    clientPatchKnown = null;
    clientPatchAskedAt = 0;
  });
  // Usually settled before the first icon is asked for, so that one already
  // reads from the right patch
  void confirmLatestPatch();
  setTimeout(() => void pruneGameAssetCache(), PRUNE_DELAY_MS);
  setInterval(() => void pruneGameAssetCache(), PRUNE_INTERVAL_MS);
}

const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

// Least recently used first, by the mtime readCached keeps current
async function pruneGameAssetCache(): Promise<void> {
  const base = cacheRoot();
  let dirs: string[];
  try {
    dirs = await fs.promises.readdir(base);
  } catch {
    return;
  }

  const files: { file: string; size: number; used: number }[] = [];
  let total = 0;
  for (const dir of dirs) {
    let names: string[];
    try {
      names = await fs.promises.readdir(path.join(base, dir));
    } catch {
      continue;
    }
    for (const name of names) {
      const file = path.join(base, dir, name);
      const stat = await fs.promises.stat(file).catch(() => null);
      if (!stat?.isFile()) continue;
      if (name.endsWith(".tmp")) {
        if (Date.now() - stat.mtimeMs > STRAY_TEMP_MS) {
          await fs.promises.rm(file, { force: true }).catch(() => {});
        }
        continue;
      }
      files.push({ file, size: stat.size, used: stat.mtimeMs });
      total += stat.size;
    }
  }
  if (total <= MAX_CACHE_BYTES) return;

  const before = total;
  files.sort((a, b) => a.used - b.used);
  for (const entry of files) {
    if (total <= TARGET_CACHE_BYTES) break;
    try {
      await fs.promises.rm(entry.file);
      total -= entry.size;
    } catch {
      // In use or already gone; the next prune gets another chance
    }
  }
  // rmdir only removes a directory that is already empty
  for (const dir of dirs) await fs.promises.rmdir(path.join(base, dir)).catch(() => {});
  patchesOnDisk = null;
  console.log(`Pruned the asset cache from ${mb(before)} to ${mb(total)}`);
}
