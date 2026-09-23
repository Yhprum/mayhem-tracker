import {
  authenticate,
  ClientElevatedPermsError,
  ClientNotFoundError,
  createHttp1Request,
  Credentials,
  HttpRequestOptions,
  LeagueWebSocket,
} from "league-connect";
import { BrowserWindow } from "electron";
import * as db from "./db";
import { findClient, installDirCandidates } from "./lockfile";
import { MAYHEM_QUEUE_IDS } from "../shared/queues";
import { SGP_HISTORY_CAP } from "../shared/api";
import type { BackfillLimit, BackfillResult, LcuStatus } from "../shared/api";

let credentials: Credentials | null = null;
let status: LcuStatus = "disconnected";
let pollTimer: ReturnType<typeof setInterval> | null = null;
let connectTimer: ReturnType<typeof setInterval> | null = null;
let pollingStopped = false;

// Anything in the main process that has to react to the client entering or
// leaving a match subscribes here. Registered once at startup and never
// removed, so there is nothing to unsubscribe.
type StatusListener = (status: LcuStatus) => void;
const statusListeners = new Set<StatusListener>();

export function onLcuStatusChange(listener: StatusListener) {
  statusListeners.add(listener);
}

function setStatus(newStatus: typeof status, win?: BrowserWindow | null) {
  const changed = status !== newStatus;
  status = newStatus;
  if (win && !win.isDestroyed()) {
    win.webContents.send("lcu:status-changed", status);
  }
  if (!changed) return;
  for (const listener of statusListeners) {
    try {
      listener(status);
    } catch (err) {
      console.log("Status listener failed:", err);
    }
  }
}

export function getStatus() {
  return status;
}

// Both of these mean the client is there and answering — only the phase differs
export function isClientConnected() {
  return status === "connected" || status === "ingame";
}

export function friendlyErrorMessage(err: unknown): string {
  if (err instanceof ClientNotFoundError) {
    return "League client is not running";
  }
  if (err instanceof ClientElevatedPermsError) {
    return "League client is running as administrator — run Mayhem Tracker as administrator to connect";
  }
  const message = err instanceof Error ? err.message : String(err);
  if (/ECONNREFUSED|ECONNRESET|socket hang up|EPIPE/i.test(message)) {
    return "Lost connection to the League client";
  }
  return message;
}

// Where the client said it was installed, the last time authenticate() had to
// find it. A client in a folder the Riot Client's records don't mention is then
// found by its lockfile, like any other, from the next lookup on.
const INSTALL_DIR_SETTING = "lcu_install_dir";

// authenticate() only runs when no lockfile can settle the question, and this
// spaces out the PowerShell launches it costs for as long as that stays true.
const AUTHENTICATE_INTERVAL_MS = 30_000;
let nextAuthenticateAt = 0;

async function connect(): Promise<Credentials> {
  const client = await findClient(installDirCandidates(db.getSetting(INSTALL_DIR_SETTING)));
  if (client.state === "running") {
    credentials = client.credentials;
    return credentials;
  }
  // An install with no live lockfile is a closed client, and asking PowerShell
  // would only say so more slowly
  if (client.state === "closed") {
    credentials = null;
    throw new ClientNotFoundError();
  }
  if (Date.now() < nextAuthenticateAt) throw new ClientNotFoundError();

  nextAuthenticateAt = Date.now() + AUTHENTICATE_INTERVAL_MS;
  credentials = await authenticate({ windowsShell: "powershell" });
  void rememberInstallDir();
  return credentials;
}

// The client knows where it runs from, and remembering its answer is what lets
// every later lookup read the lockfile instead of launching PowerShell again
async function rememberInstallDir(): Promise<void> {
  const dir = await lcuJson("/data-store/v1/install-dir");
  if (typeof dir === "string" && dir) db.setSetting(INSTALL_DIR_SETTING, dir);
}

async function lcuRequest(url: string, method: HttpRequestOptions["method"] = "GET") {
  if (!credentials) {
    await connect();
  }
  const response = await createHttp1Request({ url, method }, credentials!);
  if (!response.ok) {
    throw new Error(`LCU request failed: ${response.status} ${url}`);
  }
  return response.json();
}

// Same request, for callers that treat an unreachable client as "no answer"
// rather than as a failure worth reporting.
export async function lcuJson(url: string): Promise<any | null> {
  try {
    return await lcuRequest(url);
  } catch {
    return null;
  }
}

async function fetchCurrentSummoner(): Promise<any> {
  return lcuRequest("/lol-summoner/v1/current-summoner");
}

async function fetchMatchHistoryByPuuid(puuid: string, begIndex = 0, endIndex = 19): Promise<any> {
  return lcuRequest(
    `/lol-match-history/v1/products/lol/${puuid}/matches?begIndex=${begIndex}&endIndex=${endIndex}`,
  );
}

async function fetchMatchHistory(begIndex = 0, endIndex = 19): Promise<any> {
  return lcuRequest(
    `/lol-match-history/v1/products/lol/current-summoner/matches?begIndex=${begIndex}&endIndex=${endIndex}`,
  );
}

async function fetchGameDetails(gameId: number): Promise<any> {
  return lcuRequest(`/lol-match-history/v1/games/${gameId}`);
}

// --- Deep history (SGP) ---------------------------------------------------
//
// The LCU's match list is capped at 20 games: begIndex/endIndex are accepted
// but ignored by the backend, so paging it just returns the same 20 over and
// over. The client itself gets its ids from Riot's player-platform service
// instead, which does honour startIndex/count and reaches back years. We use
// the same endpoint to get ids, then hydrate each one through the LCU — that
// still returns full detail for arbitrary old games, in the shape we parse.

const SGP_HOSTS = [
  "https://usw2-red.pp.sgp.pvp.net",
  "https://euc1-red.pp.sgp.pvp.net",
  "https://apne1-red.pp.sgp.pvp.net",
  "https://apse1-red.pp.sgp.pvp.net",
];

const SGP_HOST_BY_REGION: Record<string, string> = {
  NA: SGP_HOSTS[0],
  BR: SGP_HOSTS[0],
  LAN: SGP_HOSTS[0],
  LAS: SGP_HOSTS[0],
  LA1: SGP_HOSTS[0],
  LA2: SGP_HOSTS[0],
  EUW: SGP_HOSTS[1],
  EUNE: SGP_HOSTS[1],
  EUN: SGP_HOSTS[1],
  TR: SGP_HOSTS[1],
  RU: SGP_HOSTS[1],
  ME: SGP_HOSTS[1],
  KR: SGP_HOSTS[2],
  JP: SGP_HOSTS[2],
  OCE: SGP_HOSTS[3],
  OC1: SGP_HOSTS[3],
  PH: SGP_HOSTS[3],
  SG: SGP_HOSTS[3],
  TH: SGP_HOSTS[3],
  TW: SGP_HOSTS[3],
  VN: SGP_HOSTS[3],
};

// The service clamps `count` to 200 rather than rejecting a larger one, so this
// is the biggest page it will actually serve — asking for 1000 still gets 200.
const SGP_PAGE_SIZE = 200;

// Whether an account has more history than Riot's window holds. Asking just
// inside the window costs one request and, unlike the walk itself, gives an
// unambiguous answer: anything at all coming back means the account fills the
// window. An account whose real history ends within a few games of the cap is
// indistinguishable from a capped one, which is a harmless way to be wrong —
// the message only says older games may not be available.
const SGP_CAP_PROBE_INDEX = SGP_HISTORY_CAP - 10;

// Safety bound only. Paging normally ends when the service returns a short
// page, and the window above puts that at five pages; this just stops a runaway
// loop, with enough headroom that a raised cap would still be walked in full.
// Hitting it is reported rather than silently trimming someone's history.
const SGP_MAX_PAGES = 25;

// Every match carries its queue in the service's own tag vocabulary, so the
// filtering can happen there instead of here. Worth doing even though it
// reaches no further back: without it the hydration loop below pays one LCU
// request per game the account played in some other queue, only to throw it
// away. OR because a game is in exactly one queue.
const SGP_MAYHEM_TAGS = `${MAYHEM_QUEUE_IDS.map((id) => `tag=q_${id}`).join("&")}&tagsQueryType=OR`;
const SGP_ALL_TAGS = "tagsQueryType=AND";

// How many new games to accumulate before nudging the UI to re-query, so a long
// import fills the app in as it runs instead of landing all at once.
const GAMES_UPDATED_BATCH = 25;

// Wait this long before automatically retrying a backfill that errored, so a
// transient failure doesn't relaunch a full history walk every poll tick.
const AUTO_BACKFILL_RETRY_DELAY = 15 * 60 * 1000;

// How many games the LCU's match list holds. Asking for more is accepted and
// ignored, so this is the whole window the recent-games sync gets to see.
const LCU_HISTORY_PAGE_SIZE = 20;

// Accounts whose history has been walked end to end this app session. Launch is
// where the games missed while the app was closed are, and a walk that reads
// ids only is five requests for Riot's whole window, so the app earns back
// every gap it could have at a cost it pays once. An account seen for the first
// time here gets its initial import from the same walk. Kept in memory
// deliberately: the point is one per launch, not one per interval.
const sweptThisLaunch = new Set<string>();

// Shard probing walks candidates in turn, so one unresponsive host must not
// stall the whole search. Paging gets longer, since those requests do real work.
const SGP_PROBE_TIMEOUT_MS = 8_000;
const SGP_PAGE_TIMEOUT_MS = 30_000;

let sgpHost: string | null = null;
let backfillRunning = false;
let backfillCancelled = false;
// Suppresses only the *automatic* backfill. Cleared on restart, and a manual
// run from Settings always ignores it.
let autoBackfillPausedUntil = 0;

function notifyGamesUpdated(win?: BrowserWindow | null) {
  if (win && !win.isDestroyed()) {
    win.webContents.send("lcu:games-updated");
  }
}

function sgpMatchIdsUrl(
  host: string,
  puuid: string,
  startIndex: number,
  count: number,
  tags: string = SGP_ALL_TAGS,
) {
  return (
    `${host}/match-history-query/v1/products/lol/player/${puuid}` +
    `?startIndex=${startIndex}&count=${count}&${tags}`
  );
}

// The LCU's league-session token used to be accepted here, but the service now
// answers it with 403 "RBAC: access denied". The RSO access token is what the
// entitlement follows, and it lives an hour instead of ten minutes. The old one
// stays as a fallback in case the requirement differs by region or flips back.
async function fetchSgpToken(): Promise<string> {
  try {
    const rso = (await lcuRequest("/lol-rso-auth/v1/authorization/access-token")) as any;
    const token = typeof rso === "string" ? rso : rso?.token;
    if (typeof token === "string" && token) return token;
  } catch {
    // Fall through to the legacy token
  }

  const legacy = (await lcuRequest("/lol-league-session/v1/league-session-token")) as any;
  if (typeof legacy !== "string" || !legacy) {
    throw new Error("League client hasn't finished signing in — try again in a moment");
  }
  return legacy;
}

// Carries the status through so a caller can tell a shard that has stopped
// serving this account apart from a service that is merely unhappy.
class SgpHttpError extends Error {
  constructor(readonly status: number) {
    super(`Match history service returned ${status}`);
  }
}

// A shard answers this way for a player it doesn't hold, which is what an
// account transfer or a Riot re-shard leaves us with: the remembered host is
// now the wrong one, and stays wrong until we go looking again.
const SGP_REHOME_STATUSES = new Set([401, 403, 404]);

// The service is sharded by geography, not by game region, so the region map is
// a first guess only. Probe candidates until one answers, then remember it.
async function probeSgpHost(puuid: string, token: string, skip?: string): Promise<string | null> {
  let guess: string | undefined;
  try {
    const regionLocale = await lcuRequest("/riotclient/region-locale");
    guess = SGP_HOST_BY_REGION[String(regionLocale?.region || "").toUpperCase()];
  } catch {
    // Fall through to probing every shard
  }

  const candidates = guess ? [guess, ...SGP_HOSTS.filter((h) => h !== guess)] : SGP_HOSTS;
  for (const host of candidates) {
    if (host === skip) continue;
    try {
      const response = await fetch(sgpMatchIdsUrl(host, puuid, 0, 1), {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(SGP_PROBE_TIMEOUT_MS),
      });
      if (response.ok) {
        sgpHost = host;
        db.setSetting("sgp_host", host);
        return host;
      }
    } catch {
      // Try the next shard
    }
  }

  return null;
}

async function resolveSgpHost(puuid: string, token: string): Promise<string> {
  if (sgpHost) return sgpHost;

  const cached = db.getSetting("sgp_host");
  if (cached && SGP_HOSTS.includes(cached)) {
    sgpHost = cached;
    return cached;
  }

  const host = await probeSgpHost(puuid, token);
  if (!host) {
    throw new Error("Could not reach Riot's match history service for your region");
  }
  return host;
}

// Nothing else ever rewrites the remembered host, so a stale one would fail the
// same way on every future run with no way out short of editing the database.
// Re-probe instead — but only replace what we have if another shard actually
// answers, since an expired token fails everywhere and is not the host's fault.
async function rehomeSgpHost(puuid: string, token: string, failed: string): Promise<string | null> {
  sgpHost = null;
  const host = await probeSgpHost(puuid, token, failed);
  if (!host) {
    sgpHost = failed;
    return null;
  }
  console.warn(`Match history shard ${failed} no longer serves this account; moved to ${host}`);
  return host;
}

// Why a walk stopped. "exhausted" is the ambiguous one: the service ran out of
// results, which is either the end of the account's history or the edge of
// Riot's window, and the responses are identical. Only that case needs the
// probe below to tell which.
type WalkStop = "exhausted" | "known" | "page-limit";

async function fetchAllMatchIds(
  host: string,
  puuid: string,
  token: string,
  tags: string,
  stopAfterPage: (pageIds: number[]) => boolean,
): Promise<{ ids: number[]; stoppedBy: WalkStop }> {
  const ids: number[] = [];

  for (let page = 0; page < SGP_MAX_PAGES; page++) {
    const response = await fetch(
      sgpMatchIdsUrl(host, puuid, page * SGP_PAGE_SIZE, SGP_PAGE_SIZE, tags),
      {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(SGP_PAGE_TIMEOUT_MS),
      },
    );
    if (!response.ok) {
      throw new SgpHttpError(response.status);
    }

    const body = await response.json();
    if (!Array.isArray(body) || body.length === 0) return { ids, stoppedBy: "exhausted" };

    // Ids arrive platform-prefixed, e.g. "NA1_5616465966"
    const pageIds: number[] = [];
    for (const id of body) {
      const gameId = Number(String(id).split("_").pop());
      if (Number.isFinite(gameId)) pageIds.push(gameId);
    }
    ids.push(...pageIds);

    // A short page means the service has no more to give
    if (body.length < SGP_PAGE_SIZE) return { ids, stoppedBy: "exhausted" };
    if (stopAfterPage(pageIds)) return { ids, stoppedBy: "known" };
  }

  return { ids, stoppedBy: "page-limit" };
}

async function sgpPageLength(
  host: string,
  puuid: string,
  token: string,
  startIndex: number,
): Promise<number | null> {
  try {
    const response = await fetch(sgpMatchIdsUrl(host, puuid, startIndex, SGP_PAGE_SIZE), {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(SGP_PAGE_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    const body = await response.json();
    return Array.isArray(body) ? body.length : null;
  } catch {
    return null;
  }
}

// Both probes are deliberately unfiltered: the window is applied to games of
// every queue before any tag filter narrows the result, so a filtered walk's
// own length says nothing about whether it was cut short.
//
// Rather than assume the wall is where it was last measured, this confirms it:
// history right up to the cap and nothing at all past it is the shape only a
// hard stop produces. Checking both sides matters if Riot ever moves the cap —
// finding games beyond it means the account was not truncated at 1000, and
// claiming otherwise would tell someone their history was lost when it wasn't.
// Either probe failing answers no, since a cap that could not be confirmed is
// not one worth reporting.
async function isHistoryWindowFull(host: string, puuid: string, token: string): Promise<boolean> {
  const insideWindow = await sgpPageLength(host, puuid, token, SGP_CAP_PROBE_INDEX);
  if (!insideWindow) return false;

  const pastWindow = await sgpPageLength(host, puuid, token, SGP_HISTORY_CAP);
  return pastWindow === 0;
}

export function cancelBackfill(): void {
  if (backfillRunning) backfillCancelled = true;
}

export function isBackfillRunning(): boolean {
  return backfillRunning;
}

export type BackfillOptions = {
  // Walk every page Riot will serve instead of stopping at the first one we
  // already know in full. The early exit only ever proves that the games in
  // front of it are accounted for, so a hole further back stays invisible to
  // every run that takes it. Ids are cheap: Riot's whole window is five
  // requests, and only the ids we don't have cost anything to hydrate, so the
  // runs that exist to find holes can afford to look everywhere.
  full?: boolean;
};

export async function backfillHistory(
  win?: BrowserWindow | null,
  { full = false }: BackfillOptions = {},
): Promise<BackfillResult> {
  if (backfillRunning) {
    throw new Error("A backfill is already running");
  }
  backfillRunning = true;
  backfillCancelled = false;

  try {
    const summoner = await fetchCurrentSummoner();
    db.upsertSummoner(summoner);

    const token = await fetchSgpToken();
    const host = await resolveSgpHost(summoner.puuid, token);

    const known = db.getKnownGameIds();

    // Once an account has been walked all the way back, a run that only wants
    // the new games at the front can stop early. Results are newest-first, so
    // the first page we've already fully accounted for means everything in
    // front of it is too. Tracked per account, since a newly added one has
    // nothing to stop on.
    const completedKey = `backfill_complete_${summoner.puuid}`;
    const walkedBefore = db.getSetting(completedKey) === "1";
    const stopAtKnownPage = walkedBefore && !full;

    const walk = (from: string, tags: string) =>
      fetchAllMatchIds(
        from,
        summoner.puuid,
        token,
        tags,
        (pageIds) => stopAtKnownPage && pageIds.every((id) => known.has(id)),
      );

    let activeHost = host;
    let walked: { ids: number[]; stoppedBy: WalkStop };
    try {
      walked = await walk(activeHost, SGP_MAYHEM_TAGS);
    } catch (err) {
      // The remembered shard may simply be the wrong one now. Find the right
      // one and restart the walk there; if none answers, the original failure
      // is the honest one to report.
      if (!(err instanceof SgpHttpError) || !SGP_REHOME_STATUSES.has(err.status)) throw err;
      const rehomed = await rehomeSgpHost(summoner.puuid, token, activeHost);
      if (!rehomed) throw err;
      activeHost = rehomed;
      walked = await walk(activeHost, SGP_MAYHEM_TAGS);
    }

    // The queue filter is Riot's vocabulary, not ours, and a filtered walk that
    // came back with nothing looks identical whether the account has no Mayhem
    // games or the tag names changed under us. Only one of those is worth
    // being wrong about, so confirm it the slow way before believing it.
    if (walked.ids.length === 0) {
      walked = await walk(activeHost, SGP_ALL_TAGS);
    }

    const { ids, stoppedBy } = walked;

    // A walk that stopped on known games or on our own page bound says nothing
    // about Riot's window, and probing for it would be a wasted request.
    let limit: BackfillLimit = null;
    if (stoppedBy === "page-limit") {
      limit = "paging";
    } else if (
      stoppedBy === "exhausted" &&
      (await isHistoryWindowFull(activeHost, summoner.puuid, token))
    ) {
      limit = "service";
    }

    if (limit === "paging") {
      console.warn(
        `Backfill stopped at the ${SGP_MAX_PAGES}-page limit (${ids.length} games); older games were not checked`,
      );
    } else if (limit === "service") {
      console.log(
        `Riot's ${SGP_HISTORY_CAP}-match window is full for this account; nothing older than the ${ids.length} games found can be fetched`,
      );
    }

    const pending = ids.filter((id) => !known.has(id));

    const progress = (current: number, added: number) => {
      if (win && !win.isDestroyed()) {
        win.webContents.send("lcu:backfill-progress", { current, total: pending.length, added });
      }
    };
    // A periodic check that finds nothing has no progress to report, and
    // announcing one anyway would flash an import bar at the user every few
    // hours for work that never happened.
    if (pending.length > 0) progress(0, 0);

    let added = 0;
    let announced = 0;
    for (let i = 0; i < pending.length; i++) {
      if (backfillCancelled) break;
      const gameId = pending[i];

      let game: any;
      try {
        game = await fetchGameDetails(gameId);
      } catch {
        // Leave it unrecorded so a later run retries it
        progress(i + 1, added);
        continue;
      }

      if (!MAYHEM_QUEUE_IDS.includes(game.queueId)) {
        db.markIgnoredGame(gameId);
      } else if (db.insertGameFull(game, summoner.puuid)) {
        added++;
        console.log(`Backfilled ARAM Mayhem game ${gameId}`);
      }

      // Let the app fill in as it goes rather than staying empty for minutes
      if (added - announced >= GAMES_UPDATED_BATCH) {
        announced = added;
        notifyGamesUpdated(win);
      }
      progress(i + 1, added);
    }

    const cancelled = backfillCancelled;

    // Only claim the account is fully walked once every id has actually been
    // resolved. Marking it earlier would let a later run early-exit on the first
    // fully-known page and never reach the older games we skipped.
    //
    // Running into Riot's window still counts as walked: it is as deep as the
    // account will ever go, so there is nothing to come back for, and refusing
    // to mark it would re-walk the same window on every launch forever.
    if (limit !== "paging" && !cancelled) {
      db.setSetting(completedKey, "1");
    } else {
      // Neither outcome sets the completion flag, so without this the poll would
      // relaunch the whole walk a minute later — including right after the user
      // deliberately cancelled it. Resumes on next launch, or from Settings.
      autoBackfillPausedUntil = Infinity;
    }

    if (added > announced) notifyGamesUpdated(win);

    const dashboard = db.getDashboardData();
    const result: BackfillResult = {
      added,
      scanned: ids.length,
      checked: pending.length,
      totalGames: dashboard.totalGames,
      limit,
      cancelled,
    };

    if (win && !win.isDestroyed()) {
      win.webContents.send("lcu:backfill-done", result);
    }
    return result;
  } catch (err) {
    if (win && !win.isDestroyed()) {
      win.webContents.send("lcu:backfill-done", { error: friendlyErrorMessage(err) });
    }
    throw err;
  } finally {
    backfillRunning = false;
    backfillCancelled = false;
  }
}

export type RecentSyncResult = {
  newGames: number;
  totalGames: number;
  // Whether the window came back with nothing we had already accounted for.
  // See syncRecentGames below for what that means and what it costs to ignore.
  rolledOver: boolean;
};

export async function fetchNewGames(
  win?: BrowserWindow | null,
  knownSummoner?: any,
): Promise<RecentSyncResult> {
  const summoner = knownSummoner ?? (await fetchCurrentSummoner());
  db.upsertSummoner(summoner);

  let newGamesCount = 0;

  let historyResponse: any;
  try {
    historyResponse = await fetchMatchHistoryByPuuid(summoner.puuid, 0, LCU_HISTORY_PAGE_SIZE - 1);
  } catch {
    try {
      historyResponse = await fetchMatchHistory(0, LCU_HISTORY_PAGE_SIZE - 1);
    } catch {
      return { newGames: 0, totalGames: 0, rolledOver: false };
    }
  }

  const games = historyResponse.games?.games || historyResponse.games || [];

  // A game we've already decided about anchors this window to the history we
  // hold: everything older than it was seen by an earlier sync. Without one,
  // the window may have rolled clean past games we never got.
  let sawKnownGame = false;

  for (const game of games) {
    if (db.isGameKnown(game.gameId)) {
      sawKnownGame = true;
      continue;
    }

    // Recorded rather than skipped, so the next window has this game as an
    // anchor too. Otherwise a run of games in other queues looks exactly like
    // the gap below and would send us off on a deep walk to rediscover that
    // they still aren't Mayhem games.
    if (!MAYHEM_QUEUE_IDS.includes(game.queueId)) {
      db.markIgnoredGame(game.gameId);
      continue;
    }

    let fullGame: any;
    try {
      fullGame = await fetchGameDetails(game.gameId);
    } catch {
      fullGame = game;
    }

    const inserted = db.insertGameFull(fullGame, summoner.puuid);
    if (inserted) {
      newGamesCount++;
      console.log(`Stored ARAM Mayhem game ${fullGame.gameId}`);
    }
  }

  if (newGamesCount > 0 && win && !win.isDestroyed()) {
    win.webContents.send("lcu:games-updated");
  }

  const dashboard = db.getDashboardData();
  return {
    newGames: newGamesCount,
    totalGames: dashboard.totalGames,
    // A window shorter than the cap is the account's whole recent history, so
    // there is nothing behind it to have missed.
    rolledOver: games.length >= LCU_HISTORY_PAGE_SIZE && !sawKnownGame,
  };
}

// The recent-games sync sees twenty games and no further, so a session where
// more than twenty were played while the app was closed leaves the older ones
// with nothing to find them: the window has rolled over completely, and every
// later poll sees only games it has already stored. The shape is recognisable,
// a full window without one game we had accounted for, and the deep walk is
// what can still reach behind it, so escalate instead of accepting the hole.
// On an account that has been walked before, the walk stops at the first page
// it recognises, so closing a small gap costs little more than the poll it
// follows.
export async function syncRecentGames(
  win?: BrowserWindow | null,
  knownSummoner?: any,
): Promise<{ newGames: number; totalGames: number }> {
  const recent = await fetchNewGames(win, knownSummoner);
  if (!recent.rolledOver || backfillRunning || Date.now() < autoBackfillPausedUntil) {
    return recent;
  }

  console.log("Recent games contained nothing already known; walking history for missed games");
  try {
    const deep = await backfillHistory(win);
    return { newGames: recent.newGames + deep.added, totalGames: deep.totalGames };
  } catch (err) {
    // The recent games did land, so this reports what it got rather than
    // failing the sync outright. backfillHistory has already told the UI why
    // the walk didn't finish.
    console.log("History walk after a rolled-over window failed:", err);
    autoBackfillPausedUntil = Date.now() + AUTO_BACKFILL_RETRY_DELAY;
    return recent;
  }
}

// --- Instant capture from the post-game screen ----------------------------
//
// The poll above is at the mercy of the client's match *list* cache, which is
// never invalidated when a game ends — the LCU can hand back the same stale
// twenty games for an entire client session, which is why a finished match
// could take hours to appear here. The end-of-game resource has no such delay:
// the client is pushed the stats within a second of the game terminating, and
// what it publishes carries the game id and queue id directly. We take the id
// from there and hydrate it through the by-id endpoint, which does not go
// through the list cache and answers in the same shape everything else parses.

// Compared without a leading slash: most LCU resources publish their uri with
// one, but not all of them do, and missing the event would put us straight back
// to waiting on the poll.
const EOG_STATS_PATHS = [
  // What the client actually publishes. The stats are pushed to it from Riot's
  // match-history ingest the moment the game terminates and land here. Carries
  // the game id, but no queue id.
  "lol-end-of-game/v1/eog-stats-block",
  // The endpoint the game client posts to itself. Not published during ordinary
  // play, but it carries the queue id on the occasions it is, which saves us a
  // request, so it stays in the list.
  "lol-end-of-game/v1/gameclient-eog-stats-block",
];

// The gameflow is the trigger that doesn't depend on the stats resource being
// published at all: the session carries the game id and queue id for the whole
// match, and the phase reliably reaches EndOfGame afterwards. Between the two
// sources, a finished game has to go out of its way not to be noticed.
const GAMEFLOW_SESSION_PATH = "lol-gameflow/v1/session";
const GAMEFLOW_PHASE_PATH = "lol-gameflow/v1/gameflow-phase";

// Game id and queue of the match currently being played, remembered from the
// gameflow session so the phase change has something to act on.
let liveGame: { gameId: number; queueId: number } | null = null;

// The match being played, or the last one played this client session. Never
// cleared, which is what lets the Live Game tab keep showing a game after it
// has ended.
export function getLiveGameRef(): { gameId: number; queueId: number } | null {
  return liveGame;
}

// Reconnect is the phase for rejoining a match already underway, so it counts
// as being in a game just as much as InProgress does.
const IN_GAME_PHASES = new Set(["InProgress", "Reconnect"]);

// The phase only decides between the two connected states. Whether the client
// is reachable at all is the connect loop's business, so a phase arriving late
// must never talk the status back up out of "disconnected".
function applyPhase(win: BrowserWindow | null | undefined, phase: string | null) {
  if (!isClientConnected()) return;
  setStatus(phase !== null && IN_GAME_PHASES.has(phase) ? "ingame" : "connected", win);
}

// The by-id endpoint can still miss for a moment while the match is being
// written, so a failure is retried on a widening schedule instead of being
// dropped. Roughly five and a half minutes in all; past that the poll is the
// safety net, and one missed capture only costs the delay we had before.
const EOG_RETRY_DELAYS_MS = [2_000, 5_000, 15_000, 60_000, 120_000, 120_000];

let eogSocket: LeagueWebSocket | null = null;
let eogAttaching = false;

// Games the capture path is already working on. The resource updates more than
// once while the screen is open, so without this every update would start its
// own chain of retries for the same match. A null value means an attempt is
// running right now; a timer means one is scheduled.
const eogPending = new Map<number, ReturnType<typeof setTimeout> | null>();

async function captureEogGame(
  win: BrowserWindow | null | undefined,
  gameId: number,
  attempt: number,
): Promise<void> {
  eogPending.set(gameId, null);

  // A retry can be scheduled minutes out, by which time the ordinary poll may
  // have picked the game up anyway
  if (db.gameExists(gameId)) {
    eogPending.delete(gameId);
    return;
  }

  try {
    // Cheap, and it keeps the stored identity current the same way the poll
    // does — the capture may well be the first thing to run after a switch.
    const summoner = await fetchCurrentSummoner();
    db.upsertSummoner(summoner);

    const game = await fetchGameDetails(gameId);

    if (!MAYHEM_QUEUE_IDS.includes(game.queueId)) {
      db.markIgnoredGame(gameId);
      eogPending.delete(gameId);
      return;
    }

    if (db.insertGameFull(game, summoner.puuid)) {
      console.log(`Stored ARAM Mayhem game ${gameId} from the post-game screen`);
      notifyGamesUpdated(win);
    }
    eogPending.delete(gameId);
  } catch (err) {
    const delay = EOG_RETRY_DELAYS_MS[attempt];
    if (delay === undefined) {
      console.log(`Gave up capturing game ${gameId} from the post-game screen:`, err);
      eogPending.delete(gameId);
      return;
    }

    const timer = setTimeout(() => {
      captureEogGame(win, gameId, attempt + 1);
    }, delay);
    // A scheduled retry must never be the reason the app can't exit
    timer.unref?.();
    eogPending.set(gameId, timer);
  }
}

function startCapture(win: BrowserWindow, gameId: number, queueId: number): void {
  if (!Number.isFinite(gameId) || gameId <= 0) return;
  if (eogPending.has(gameId) || db.gameExists(gameId)) return;

  // The queue id rides along whenever the source has one, so a game we don't
  // track is dismissed without a single request. Sources that omit it leave
  // this NaN, and the fetched game is what decides instead.
  if (Number.isFinite(queueId) && queueId > 0 && !MAYHEM_QUEUE_IDS.includes(queueId)) {
    db.markIgnoredGame(gameId);
    return;
  }

  captureEogGame(win, gameId, 0);
}

function handleFrame(win: BrowserWindow, payload: any): void {
  const raw = String(payload?.uri ?? "");
  const path = raw.startsWith("/") ? raw.slice(1) : raw;

  if (path === GAMEFLOW_SESSION_PATH) {
    // Only ever set, never cleared: the session drops back to an empty game
    // once the match is over, and by then this is what the phase change needs.
    const gameData = payload.data?.gameData;
    const gameId = Number(gameData?.gameId);
    if (Number.isFinite(gameId) && gameId > 0) {
      liveGame = { gameId, queueId: Number(gameData?.queue?.id) };
    }
    return;
  }

  if (path === GAMEFLOW_PHASE_PATH) {
    applyPhase(win, typeof payload.data === "string" ? payload.data : null);

    if (payload.data === "EndOfGame" && liveGame) {
      startCapture(win, liveGame.gameId, liveGame.queueId);
    }
    return;
  }

  if (EOG_STATS_PATHS.includes(path)) {
    // The resource is also cleared once the screen is dismissed
    if (payload.eventType === "Delete" || !payload.data) return;
    startCapture(win, Number(payload.data.gameId), Number(payload.data.queueId));
  }
}

// The connection has no timeout of its own, and one that never opens and never
// errors would leave the attach guard below set for the rest of the session —
// which would then refuse every later attempt, taking the post-game capture and
// the in-game status down with it.
const EOG_ATTACH_TIMEOUT_MS = 15_000;

// One attempt with no retry of its own: the poll is what tries again. Opened
// with the credentials connect() found, since league-connect's
// createWebSocketConnection runs an authenticate() of its own and so launches
// PowerShell on every attempt.
function connectEogSocket(creds: Credentials): Promise<LeagueWebSocket> {
  const socket = new LeagueWebSocket(`wss://127.0.0.1:${creds.port}`, {
    headers: {
      Authorization: `Basic ${Buffer.from(`riot:${creds.password}`).toString("base64")}`,
    },
    ca: creds.certificate,
  });

  return new Promise<LeagueWebSocket>((resolve, reject) => {
    const onOpen = () => {
      clearTimeout(timer);
      socket.off("error", onError);
      resolve(socket);
    };
    const onError = (err: Error) => {
      clearTimeout(timer);
      socket.off("open", onOpen);
      reject(err);
    };

    const timer = setTimeout(() => {
      socket.off("open", onOpen);
      // Still mid-handshake, so terminating it reports one more error, which
      // onError stays attached to absorb
      socket.terminate();
      reject(new Error("Timed out connecting to the League client event socket"));
    }, EOG_ATTACH_TIMEOUT_MS);
    timer.unref?.();

    socket.once("open", onOpen);
    socket.on("error", onError);
  });
}

async function attachEogListener(win: BrowserWindow): Promise<void> {
  // The guard has to survive the await below, or a poll tick landing mid-attach
  // would open a second socket
  if (eogSocket || eogAttaching) {
    // A socket outlives a poll that failed, and reconnecting puts the status
    // back to plain "connected". Nothing else would notice a match that was
    // already running, since the socket reports changes and misses none.
    if (eogSocket) applyPhase(win, await fetchGameflowPhase());
    return;
  }
  eogAttaching = true;

  try {
    const socket = await connectEogSocket(credentials ?? (await connect()));

    // connectEogSocket drops its own error handler once the socket is open, and
    // an emitter with no 'error' listener throws, which here would crash the
    // app every time the League client closes.
    socket.on("error", () => socket.close());
    socket.on("close", () => {
      // A socket the app replaced, or closed on the way out, isn't news
      if (eogSocket !== socket) return;
      eogSocket = null;

      // Nothing is left to report the match ending, so holding "in game" would
      // strand the indicator there until the next reconnect
      if (status === "ingame") setStatus("connected", win);

      handleSocketDrop(win);
    });

    // Read off the raw frames rather than through league-connect's subscribe(),
    // which matches the uri as an exact string in one spelling. The socket has
    // already asked for every event, so this only decides what to keep.
    socket.on("message", (content) => {
      let payload: any;
      try {
        [payload] = JSON.parse(String(content)).slice(2);
      } catch {
        // Includes the empty frame the client sends to acknowledge the request
        return;
      }

      try {
        handleFrame(win, payload);
      } catch (err) {
        console.log("Post-game capture failed:", err);
      }
    });

    eogSocket = socket;
    console.log("Listening for post-game results");

    // The socket only carries changes, so a client that was already in a match
    // when we attached needs the current phase read once.
    fetchGameflowPhase().then((phase) => applyPhase(win, phase));
  } finally {
    eogAttaching = false;
  }
}

// The client shutting down takes the socket with it, and that lands the moment
// it happens — the poll only finds out on its next tick, up to a minute later.
// The socket can also drop with the client still there, though, so the status
// isn't touched until a request confirms it: if one still answers, the poll
// tick puts the listener back and nothing else needs to change. A request that
// fails for some passing reason costs a reconnect the loop makes good within
// five seconds.
async function handleSocketDrop(win: BrowserWindow) {
  if ((await fetchGameflowPhase()) !== null) return;

  // Forces the loop to look for the client again, since one that comes back
  // comes back on a different port
  credentials = null;
  restartConnectLoop(win);
}

function stopEogListener() {
  if (eogSocket) {
    // Cleared first so the close handler, which checks identity, doesn't race
    // a listener attached by a later reconnect
    const socket = eogSocket;
    eogSocket = null;
    socket.close();
  }
  for (const timer of eogPending.values()) {
    if (timer) clearTimeout(timer);
  }
  eogPending.clear();
  liveGame = null;
}

async function fetchGameflowPhase(): Promise<string | null> {
  try {
    // The endpoint returns a bare JSON string, e.g. "InProgress"
    return (await lcuRequest("/lol-gameflow/v1/gameflow-phase")) as unknown as string;
  } catch {
    return null;
  }
}

async function isInGame(): Promise<boolean> {
  const phase = await fetchGameflowPhase();
  return phase !== null && IN_GAME_PHASES.has(phase);
}

// The first sync an account gets in a session walks its whole history, and
// every later tick takes the cheap LCU path. That first walk is the app's
// answer to everything the twenty-game window cannot see: the games played
// while it was closed, however many, and any hole an earlier version of it
// left behind. It is also the initial import for an account being seen for the
// first time, which is the same walk with nothing to skip.
//
// Marked only once the walk finishes, so a session that starts before the
// client has finished signing in retries on a later tick rather than going the
// rest of its life without one. Deferred while a game is in progress so we
// aren't hammering the client mid-match; a later poll picks it up.
async function syncGames(win: BrowserWindow) {
  let summoner: any = null;
  try {
    summoner = await fetchCurrentSummoner();
  } catch {
    // Fall through to the recent-games sync, which reports its own errors
  }

  const wantsSweep =
    summoner && Date.now() >= autoBackfillPausedUntil && !sweptThisLaunch.has(summoner.puuid);

  if (wantsSweep && !(await isInGame())) {
    try {
      await backfillHistory(win, { full: true });
      sweptThisLaunch.add(summoner.puuid);
      return;
    } catch (err) {
      console.log("Automatic backfill failed, falling back to recent games:", err);
      autoBackfillPausedUntil = Date.now() + AUTO_BACKFILL_RETRY_DELAY;
    }
  }

  await syncRecentGames(win, summoner ?? undefined);
}

// Both timers are cleared before the connect loop starts again, so a restart
// can come from the poll or from a dropped socket without either one stacking a
// second interval on top of the one already running.
function restartConnectLoop(win: BrowserWindow) {
  // A drop check can still be waiting on a request when the app shuts down, and
  // restarting the loop then would outlive the database it fetches into
  if (pollingStopped) return;
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  if (connectTimer) {
    clearInterval(connectTimer);
    connectTimer = null;
  }
  startPolling(win, false);
}

const CONNECT_INTERVAL_MS = 5_000;
const POLL_INTERVAL_MS = 60_000;

// A sync can outlast the tick that scheduled the next one — the first one after
// a connect walks a whole history — and two of them racing would fetch and
// insert the same games twice over.
let syncing = false;

// Everything the poll does on a tick, also used for the first pass right after
// connecting. Errors are handled here rather than by the caller, so a failure
// costs a reconnect instead of the timers that drive the app.
async function pollTick(win: BrowserWindow) {
  // A socket that dropped on its own doesn't fail the poll, so without this the
  // instant capture would stay down for the rest of the session
  if (!eogSocket) {
    attachEogListener(win).catch(() => {
      // Next tick tries again
    });
  }

  // A manual backfill is already covering everything this would fetch
  if (backfillRunning || syncing) return;

  syncing = true;
  try {
    await syncGames(win);
  } catch (err) {
    console.log("Poll fetch error:", err);
    // Lost connection, restart connect loop
    restartConnectLoop(win);
  } finally {
    syncing = false;
  }
}

export function startPolling(win: BrowserWindow, firstAttempt = true) {
  pollingStopped = false;

  // Show "connecting" only on the very first attempt after app launch
  setStatus(firstAttempt ? "connecting" : "disconnected", win);

  // connect() can take longer than a tick when it falls back to authenticate(),
  // which shells out to PowerShell. Without this, the slow tick and the one
  // behind it both go on to install a poll timer, and whichever loses the race
  // runs on with nothing left holding a handle to cancel it.
  let connecting = false;

  connectTimer = setInterval(async () => {
    if (connecting) return;
    connecting = true;
    try {
      await connect();
    } catch {
      // Client not found yet — after first attempt, show disconnected
      if (firstAttempt) {
        firstAttempt = false;
        setStatus("disconnected", win);
      }
      return;
    } finally {
      connecting = false;
    }

    setStatus("connected", win);
    if (connectTimer) {
      clearInterval(connectTimer);
      connectTimer = null;
    }

    // Installed before the first sync runs, never after. The client can be found
    // before it is ready to answer (authenticate() reads its command line the
    // moment it starts, seconds before its HTTP server is listening), so the
    // first sync of a session is the one most likely to fail. The connect timer
    // has already been cleared above, so this is the only thing left that will
    // retry it.
    pollTimer = setInterval(() => {
      void pollTick(win);
    }, POLL_INTERVAL_MS);

    // Subscribes to the post-game results and does the initial fetch
    void pollTick(win);
  }, CONNECT_INTERVAL_MS);
}

export function stopPolling() {
  pollingStopped = true;
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  if (connectTimer) {
    clearInterval(connectTimer);
    connectTimer = null;
  }
  stopEogListener();
}
