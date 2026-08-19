import {
  authenticate,
  ClientElevatedPermsError,
  ClientNotFoundError,
  createHttp1Request,
  createWebSocketConnection,
  Credentials,
  HttpRequestOptions,
  LeagueWebSocket,
} from "league-connect";
import { BrowserWindow } from "electron";
import * as db from "./db";
import { MAYHEM_QUEUE_IDS } from "../shared/queues";

let credentials: Credentials | null = null;
let status: "disconnected" | "connecting" | "connected" = "disconnected";
let pollTimer: ReturnType<typeof setInterval> | null = null;
let connectTimer: ReturnType<typeof setInterval> | null = null;

function setStatus(newStatus: typeof status, win?: BrowserWindow | null) {
  status = newStatus;
  if (win && !win.isDestroyed()) {
    win.webContents.send("lcu:status-changed", status);
  }
}

export function getStatus() {
  return status;
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

async function connect(): Promise<Credentials> {
  credentials = await authenticate({ windowsShell: "powershell" });
  return credentials;
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

const SGP_PAGE_SIZE = 100;
// Safety bound only. Paging normally ends when the service returns a short
// page; this just stops a runaway loop, and hitting it is reported rather than
// silently trimming someone's history.
const SGP_MAX_PAGES = 200;

// How many new games to accumulate before nudging the UI to re-query, so a long
// import fills the app in as it runs instead of landing all at once.
const GAMES_UPDATED_BATCH = 25;

// Wait this long before automatically retrying a backfill that errored, so a
// transient failure doesn't relaunch a full history walk every poll tick.
const AUTO_BACKFILL_RETRY_DELAY = 15 * 60 * 1000;

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

function sgpMatchIdsUrl(host: string, puuid: string, startIndex: number, count: number) {
  return (
    `${host}/match-history-query/v1/products/lol/player/${puuid}` +
    `?startIndex=${startIndex}&count=${count}&tagsQueryType=AND`
  );
}

async function fetchSgpToken(): Promise<string> {
  const token = await lcuRequest("/lol-league-session/v1/league-session-token");
  if (typeof token !== "string" || !token) {
    throw new Error("League client hasn't finished signing in — try again in a moment");
  }
  return token;
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

async function fetchAllMatchIds(
  host: string,
  puuid: string,
  token: string,
  stopAfterPage: (pageIds: number[]) => boolean,
): Promise<{ ids: number[]; truncated: boolean }> {
  const ids: number[] = [];

  for (let page = 0; page < SGP_MAX_PAGES; page++) {
    const response = await fetch(sgpMatchIdsUrl(host, puuid, page * SGP_PAGE_SIZE, SGP_PAGE_SIZE), {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(SGP_PAGE_TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new SgpHttpError(response.status);
    }

    const body = await response.json();
    if (!Array.isArray(body) || body.length === 0) return { ids, truncated: false };

    // Ids arrive platform-prefixed, e.g. "NA1_5616465966"
    const pageIds: number[] = [];
    for (const id of body) {
      const gameId = Number(String(id).split("_").pop());
      if (Number.isFinite(gameId)) pageIds.push(gameId);
    }
    ids.push(...pageIds);

    // A short page means we've reached the end of the account's history
    if (body.length < SGP_PAGE_SIZE) return { ids, truncated: false };
    if (stopAfterPage(pageIds)) return { ids, truncated: false };
  }

  return { ids, truncated: true };
}

export function cancelBackfill(): void {
  if (backfillRunning) backfillCancelled = true;
}

export function isBackfillRunning(): boolean {
  return backfillRunning;
}

export type BackfillResult = {
  added: number;
  scanned: number;
  checked: number;
  totalGames: number;
  truncated: boolean;
  cancelled: boolean;
};

export async function backfillHistory(win?: BrowserWindow | null): Promise<BackfillResult> {
  if (backfillRunning) {
    throw new Error("A backfill is already running");
  }
  backfillRunning = true;
  backfillCancelled = false;

  try {
    await connect();

    const summoner = await fetchCurrentSummoner();
    db.upsertSummoner(summoner);

    const token = await fetchSgpToken();
    const host = await resolveSgpHost(summoner.puuid, token);

    const known = db.getKnownGameIds();

    // Once an account has been walked all the way back, a later run only needs
    // the new games at the front. Results are newest-first, so the first page
    // we've already fully accounted for means everything older is accounted for
    // too. Tracked per account, since a newly added one still needs a full walk.
    const completedKey = `backfill_complete_${summoner.puuid}`;
    const walkedBefore = db.getSetting(completedKey) === "1";

    const walk = (from: string) =>
      fetchAllMatchIds(
        from,
        summoner.puuid,
        token,
        (pageIds) => walkedBefore && pageIds.every((id) => known.has(id)),
      );

    let walked: { ids: number[]; truncated: boolean };
    try {
      walked = await walk(host);
    } catch (err) {
      // The remembered shard may simply be the wrong one now. Find the right
      // one and restart the walk there; if none answers, the original failure
      // is the honest one to report.
      if (!(err instanceof SgpHttpError) || !SGP_REHOME_STATUSES.has(err.status)) throw err;
      const rehomed = await rehomeSgpHost(summoner.puuid, token, host);
      if (!rehomed) throw err;
      walked = await walk(rehomed);
    }
    const { ids, truncated } = walked;

    if (truncated) {
      console.warn(
        `Backfill stopped at the ${SGP_MAX_PAGES}-page limit (${ids.length} games); older games were not checked`,
      );
    }

    const pending = ids.filter((id) => !known.has(id));

    const progress = (current: number, added: number) => {
      if (win && !win.isDestroyed()) {
        win.webContents.send("lcu:backfill-progress", { current, total: pending.length, added });
      }
    };
    progress(0, 0);

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
    if (!truncated && !cancelled) {
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
      truncated,
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

export async function fetchNewGames(
  win?: BrowserWindow | null,
  knownSummoner?: any,
): Promise<{ newGames: number; totalGames: number }> {
  await connect();

  const summoner = knownSummoner ?? (await fetchCurrentSummoner());
  db.upsertSummoner(summoner);

  let newGamesCount = 0;

  let historyResponse: any;
  try {
    historyResponse = await fetchMatchHistoryByPuuid(summoner.puuid, 0, 19);
  } catch {
    try {
      historyResponse = await fetchMatchHistory(0, 19);
    } catch {
      return { newGames: 0, totalGames: 0 };
    }
  }

  const games = historyResponse.games?.games || historyResponse.games || [];

  for (const game of games) {
    if (db.gameExists(game.gameId)) continue;
    if (!MAYHEM_QUEUE_IDS.includes(game.queueId)) continue;

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
  return { newGames: newGamesCount, totalGames: dashboard.totalGames };
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

async function attachEogListener(win: BrowserWindow): Promise<void> {
  // The guard has to survive the await below, or a poll tick landing mid-attach
  // would open a second socket
  if (eogSocket || eogAttaching) return;
  eogAttaching = true;

  try {
    const socket = await createWebSocketConnection({
      authenticationOptions: { windowsShell: "powershell" },
      // The connect loop in startPolling is already the retry policy; a second
      // one inside the socket would stack reconnect attempts on top of it.
      maxRetries: 0,
    });

    // league-connect drops its own error handler once the socket is open, and
    // an emitter with no 'error' listener throws — which here would crash the
    // app every time the League client closes.
    socket.on("error", () => socket.close());
    socket.on("close", () => {
      if (eogSocket === socket) eogSocket = null;
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
  } finally {
    eogAttaching = false;
  }
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

async function isInGame(): Promise<boolean> {
  try {
    // The endpoint returns a bare JSON string, e.g. "InProgress"
    const phase = (await lcuRequest("/lol-gameflow/v1/gameflow-phase")) as unknown as string;
    return phase === "InProgress" || phase === "Reconnect";
  } catch {
    return false;
  }
}

// An account that has never been walked gets the full history on its first
// connect — that import is the whole point of the app, and it's a superset of
// the recent-games sync. Every later tick takes the cheap LCU path instead: the
// pvp.net service is only touched while an account still needs its first walk.
// Deferred while a game is in progress so we aren't hammering the client
// mid-match; a later poll picks it up.
async function syncGames(win: BrowserWindow) {
  let summoner: any = null;
  try {
    summoner = await fetchCurrentSummoner();
  } catch {
    // Fall through to the recent-games sync, which reports its own errors
  }

  const wantsBackfill =
    summoner &&
    Date.now() >= autoBackfillPausedUntil &&
    db.getSetting(`backfill_complete_${summoner.puuid}`) !== "1";

  if (wantsBackfill && !(await isInGame())) {
    try {
      await backfillHistory(win);
      return;
    } catch (err) {
      console.log("Automatic backfill failed, falling back to recent games:", err);
      autoBackfillPausedUntil = Date.now() + AUTO_BACKFILL_RETRY_DELAY;
    }
  }

  await fetchNewGames(win, summoner ?? undefined);
}

export function startPolling(win: BrowserWindow, firstAttempt = true) {
  // Show "connecting" only on the very first attempt after app launch
  setStatus(firstAttempt ? "connecting" : "disconnected", win);

  connectTimer = setInterval(async () => {
    try {
      await connect();
      setStatus("connected", win);
      if (connectTimer) {
        clearInterval(connectTimer);
        connectTimer = null;
      }

      // What actually makes a finished match show up right away. Not awaited:
      // the sync below shouldn't wait on it, and a client that refuses the
      // subscription should still get the polled path.
      attachEogListener(win).catch((err) => {
        console.log("Could not subscribe to post-game results:", err);
      });

      // Do initial fetch
      await syncGames(win);

      // Start polling for new games every 60s
      pollTimer = setInterval(async () => {
        // A socket that dropped on its own doesn't fail the poll, so without
        // this the instant capture would stay down for the rest of the session
        if (!eogSocket) {
          attachEogListener(win).catch(() => {
            // Next tick tries again
          });
        }

        // A manual backfill is already covering everything this would fetch
        if (backfillRunning) return;
        try {
          await syncGames(win);
        } catch (err) {
          console.log("Poll fetch error:", err);
          // Lost connection, restart connect loop
          if (pollTimer) {
            clearInterval(pollTimer);
            pollTimer = null;
          }
          startPolling(win, false);
        }
      }, 60000);
    } catch {
      // Client not found yet — after first attempt, show disconnected
      if (firstAttempt) {
        firstAttempt = false;
        setStatus("disconnected", win);
      }
    }
  }, 5000);
}

export function stopPolling() {
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
