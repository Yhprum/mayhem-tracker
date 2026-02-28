import { authenticate, createHttp1Request, Credentials, HttpRequestOptions } from "league-connect";
import { BrowserWindow } from "electron";
import * as db from "./db";

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

export async function fetchNewGames(
  win?: BrowserWindow | null,
): Promise<{ newGames: number; totalGames: number }> {
  await connect();

  const summoner = await fetchCurrentSummoner();
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
    if (game.queueId !== 2400) continue;

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

      // Do initial fetch
      await fetchNewGames(win);

      // Start polling for new games every 60s
      pollTimer = setInterval(async () => {
        try {
          await fetchNewGames(win);
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
}
