import * as db from "./db";
import { getCurrentSummoner } from "./lcu";
import { safeStorage } from "electron";
import type { RiotAccountConfig } from "../shared/api";

export type RiotRegionalRoute = "americas" | "europe" | "asia" | "sea";
export type RiotPlatformRoute =
  | "br1"
  | "eun1"
  | "euw1"
  | "jp1"
  | "kr"
  | "la1"
  | "la2"
  | "me1"
  | "na1"
  | "oc1"
  | "ph2"
  | "ru"
  | "sg2"
  | "th2"
  | "tr1"
  | "tw2"
  | "vn2";

export class RiotApiError extends Error {
  constructor(
    readonly status: number,
    readonly endpoint: string,
  ) {
    super(`Riot API returned ${status} for ${endpoint}`);
  }
}

const ROUTES: Record<string, RiotRegionalRoute> = {
  americas: "americas",
  na1: "americas",
  br1: "americas",
  la1: "americas",
  la2: "americas",
  oce: "americas",
  oc1: "americas",
  europe: "europe",
  euw1: "europe",
  eun1: "europe",
  tr1: "europe",
  ru: "europe",
  me1: "europe",
  asia: "asia",
  kr: "asia",
  jp1: "asia",
  sea: "sea",
  sg2: "sea",
  ph2: "sea",
  th2: "sea",
  tw2: "sea",
  vn2: "sea",
};

export function regionalRoute(platform: string): RiotRegionalRoute {
  const normalized = platform.trim().toLowerCase();
  return ROUTES[normalized] ?? "americas";
}

export function normalizeMatchId(value: string): number | null {
  const id = Number(value.includes("_") ? value.slice(value.lastIndexOf("_") + 1) : value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

export function normalizeMatchPayload(match: any, matchId: number, puuid: string) {
  const info = match?.info;
  if (!info || !Array.isArray(info.participants)) {
    throw new Error(`Riot match ${matchId} did not include participant data`);
  }

  return {
    gameId: matchId,
    queueId: Number(info.queueId) || 0,
    gameMode: String(info.gameMode ?? "UNKNOWN"),
    gameCreation: Number(info.gameCreation) || 0,
    gameDuration: Number(info.gameDuration) || 0,
    gameVersion: String(info.gameVersion ?? ""),
    participants: info.participants.map((participant: any, index: number) => ({
      ...participant,
      participantId: participant.participantId ?? index + 1,
      summonerName: participant.riotIdGameName ?? participant.summonerName ?? null,
      riotIdGameName: participant.riotIdGameName ?? null,
      riotIdTagline: participant.riotIdTagline ?? null,
      puuid: participant.puuid ?? null,
    })),
    participantIdentities: info.participants.map((participant: any) => ({
      player: {
        puuid: participant.puuid,
        gameName: participant.riotIdGameName,
        tagLine: participant.riotIdTagline,
        summonerName: participant.summonerName,
        profileIcon: participant.profileIcon,
      },
    })),
    ownerPuuid: puuid,
  };
}

function apiKey(): string {
  const key = process.env.RIOT_API_KEY?.trim();
  if (!key) throw new Error("RIOT_API_KEY is not configured");
  return key;
}

type StoredRiotAccount = RiotAccountConfig & { encryptedApiKey: string };

function readAccounts(): StoredRiotAccount[] {
  const raw = db.getSetting("riot_accounts");
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as StoredRiotAccount[];
    const unique = new Map<string, StoredRiotAccount>();
    for (const account of parsed) {
      const key = accountKey(account);
      if (!unique.has(key)) unique.set(key, account);
    }
    return [...unique.values()];
  } catch {
    return [];
  }
}

function writeAccounts(accounts: StoredRiotAccount[]) {
  db.setSetting("riot_accounts", JSON.stringify(accounts));
}

function accountKey(account: Pick<StoredRiotAccount, "gameName" | "tagLine" | "platform">): string {
  return [
    account.gameName.trim().toLocaleLowerCase(),
    account.tagLine.trim().toLocaleLowerCase(),
    account.platform.trim().toLocaleLowerCase(),
  ].join("\u0000");
}

export function getRiotAccounts(): RiotAccountConfig[] {
  return readAccounts().map(({ encryptedApiKey, ...account }) => ({
    ...account,
    hasApiKey: Boolean(encryptedApiKey),
  }));
}

export function saveRiotAccount(account: RiotAccountConfig & { apiKey?: string }): void {
  const stored = readAccounts();
  const key = accountKey(account);
  const previous = stored.find(
    (existing) => existing.id === account.id || accountKey(existing) === key,
  );
  const accounts = stored.filter(
    (existing) => existing.id !== account.id && accountKey(existing) !== key,
  );
  let encryptedApiKey = previous?.encryptedApiKey ?? "";
  if (account.apiKey?.trim()) {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error("Secure local credential storage is unavailable");
    }
    encryptedApiKey = safeStorage.encryptString(account.apiKey.trim()).toString("base64");
  }
  accounts.push({
    id: account.id,
    gameName: account.gameName.trim(),
    tagLine: account.tagLine.trim(),
    platform: account.platform.trim().toLowerCase(),
    hasApiKey: true,
    encryptedApiKey,
  });
  writeAccounts(accounts);
}

export function removeRiotAccount(id: string): void {
  writeAccounts(readAccounts().filter((account) => account.id !== id));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// A small gap between requests keeps a full history sync (which can issue
// thousands of calls) well under Riot's short per-second rate window instead
// of bursting and immediately drawing a 429.
const REQUEST_PACING_MS = 60;
const MAX_RATE_LIMIT_RETRIES = 5;
let lastRequestAt = 0;
let rateLimitPausedUntil = 0;
let requestLock = Promise.resolve();

async function acquireRequestSlot(): Promise<() => void> {
  const previous = requestLock;
  let release!: () => void;
  requestLock = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;
  const waitUntil = Math.max(lastRequestAt + REQUEST_PACING_MS, rateLimitPausedUntil);
  const waitMs = waitUntil - Date.now();
  if (waitMs > 0) await sleep(waitMs);
  return release;
}

async function riotFetch<T>(url: string, key = apiKey()): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    console.log(`Riot API request: ${url}`);
    const release = await acquireRequestSlot();
    let response: Response;
    try {
      response = await fetch(url, {
        headers: { "X-Riot-Token": key, Accept: "application/json" },
        signal: AbortSignal.timeout(30_000),
      });
      lastRequestAt = Date.now();
    } finally {
      release();
    }
    if (response.status === 429 && attempt < MAX_RATE_LIMIT_RETRIES) {
      const retryAfterHeader = Number(response.headers.get("Retry-After"));
      const retryAfterMs = Number.isFinite(retryAfterHeader) && retryAfterHeader > 0
        ? retryAfterHeader * 1000
        : 2 ** attempt * 1000;
      rateLimitPausedUntil = Math.max(rateLimitPausedUntil, Date.now() + retryAfterMs);
      continue;
    }
    const body = await response.text();
    if (!response.ok) {
      console.error(`Riot API error ${response.status} for ${url}: ${body || "<empty response>"}`);
      throw new RiotApiError(response.status, url);
    }
    return JSON.parse(body) as T;
  }
}

async function accountByRiotId(
  route: RiotRegionalRoute,
  gameName: string,
  tagLine: string,
  key: string,
): Promise<{ puuid: string; gameName: string; tagLine: string }> {
  return riotFetch(
    `https://${route}.api.riotgames.com/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`,
    key,
  );
}

async function configuredIdentity(
  key = apiKey(),
  configured?: Pick<StoredRiotAccount, "gameName" | "tagLine" | "platform">,
): Promise<{
  puuid: string;
  gameName: string | null;
  tagLine: string | null;
  platform: string;
}> {
  try {
    if (configured) throw new Error("use configured account");
    const current = await getCurrentSummoner();
    if (current?.puuid) {
      const gameName = current.gameName ?? current.displayName ?? current.internalName ?? null;
      const tagLine = current.tagLine ?? null;
      const platform = String(
        db.getSetting("riot_platform") ?? current.region ?? current.platform ?? "na1",
      );
      db.upsertSummoner({ ...current, gameName, tagLine });
      return { puuid: current.puuid, gameName, tagLine, platform };
    }
  } catch {
    // The Riot API path is intentionally independent of the running client.
  }

  const gameName = configured?.gameName.trim() || db.getSetting("riot_game_name")?.trim();
  const tagLine = configured?.tagLine.trim() || db.getSetting("riot_tag_line")?.trim();
  const platform = configured?.platform.trim() || db.getSetting("riot_platform")?.trim() || "na1";
  if (!gameName || !tagLine) {
    const savedPuuid = db.getSetting("riot_puuid")?.trim();
    if (savedPuuid) {
      return {
        puuid: savedPuuid,
        gameName: gameName || null,
        tagLine: tagLine || null,
        platform,
      };
    }
    throw new Error("Configure a Riot ID (game name and tag) or start the League client");
  }

  const account = await accountByRiotId(regionalRoute(platform), gameName, tagLine, key);
  db.setSetting("riot_puuid", account.puuid);
  db.upsertSummoner({ puuid: account.puuid, gameName: account.gameName, tagLine: account.tagLine });
  return { puuid: account.puuid, gameName: account.gameName, tagLine: account.tagLine, platform };
}

export type RiotSyncResult = {
  added: number;
  scanned: number;
  totalGames: number;
  complete: boolean;
};

export async function syncRiotHistory(): Promise<RiotSyncResult> {
  const stored = readAccounts();
  const identities = stored.length
    ? await Promise.all(
        stored.map(async (account) => {
          if (!account.encryptedApiKey)
            throw new Error(`No API key configured for ${account.gameName}`);
          const key = safeStorage.decryptString(Buffer.from(account.encryptedApiKey, "base64"));
          const identity = await configuredIdentity(key, account);
          return { identity, key };
        }),
      )
    : [{ identity: await configuredIdentity(), key: apiKey() }];
  let added = 0;
  let scanned = 0;
  let complete = true;
  for (const { identity, key } of identities) {
    const result = await syncRiotAccount(identity, key);
    added += result.added;
    scanned += result.scanned;
    complete &&= result.complete;
  }
  return { added, scanned, totalGames: db.getDashboardData().totalGames, complete };
}

async function syncRiotAccount(
  identity: Awaited<ReturnType<typeof configuredIdentity>>,
  key: string,
): Promise<RiotSyncResult> {
  const route = regionalRoute(identity.platform);
  // Per-account, not the global getKnownGameIds(): a game only counts as
  // known for *this* account once it shows up among its own participants,
  // so pagination doesn't stop early just because another tracked account
  // already synced a game this account also happened to play in.
  const known = db.getKnownGameIdsForPuuid(identity.puuid);
  const pageSize = 100;
  const configuredPage = Number(db.getSetting("riot_sync_page_size") ?? pageSize);
  const count = Math.min(
    100,
    Math.max(1, Number.isFinite(configuredPage) ? configuredPage : pageSize),
  );
  const ids: number[] = [];

  for (let start = 0; start < 10_000; start += count) {
    const page = await riotFetch<string[]>(
      `https://${route}.api.riotgames.com/lol/match/v5/matches/by-puuid/${encodeURIComponent(identity.puuid)}/ids?start=${start}&count=${count}`,
      key,
    );
    for (const raw of page) {
      const id = normalizeMatchId(raw);
      if (id !== null && !ids.includes(id)) ids.push(id);
    }
    if (page.length < count || page.some((id) => known.has(normalizeMatchId(id) ?? -1))) break;
  }

  let added = 0;
  for (const id of ids) {
    if (known.has(id)) continue;
    const payload = await riotFetch<any>(
      `https://${route}.api.riotgames.com/lol/match/v5/matches/${id}`,
      key,
    );
    const normalized = normalizeMatchPayload(payload, id, identity.puuid);
    if (db.insertGameFull(normalized, identity.puuid)) added++;
  }

  db.setRiotSyncState(identity.puuid, identity.platform, ids[0] ?? null, ids.length < 10_000);
  return {
    added,
    scanned: ids.length,
    totalGames: db.getDashboardData().totalGames,
    complete: ids.length < 10_000,
  };
}

export function friendlyRiotError(err: unknown): string {
  if (err instanceof RiotApiError) {
    if (err.status === 401 || err.status === 403)
      return "Riot API key is missing, invalid, or expired";
    if (err.status === 404) return "Riot account or match was not found";
    if (err.status === 429) return "Riot API rate limit reached — try again later";
    if (err.status >= 500) return "Riot API is temporarily unavailable";
  }
  return err instanceof Error ? err.message : String(err);
}
