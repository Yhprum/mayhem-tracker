import { app, BrowserWindow, Tray, Menu, nativeImage } from "electron";
import path from "path";
import { closeDatabase, getSetting, checkScoreBackfill } from "./db";
import { initDatabaseWithRecovery, startBackupSchedule, stopBackupSchedule } from "./backup";
import { registerIpcHandlers } from "./ipc-handlers";
import { sendToRenderer } from "./ipc";
import { startLogging } from "./log";
import { startPolling, stopPolling, isClientConnected, fetchNewGames } from "./lcu";
import { startLiveTracking, stopLiveTracking } from "./live";
import { startChallengeTracking } from "./challenges";
import { loadChampionData, loadAugmentData, waitForChampionData } from "./dragon";
import { applySecurityPolicy } from "./security";
import { APP_USER_MODEL_ID, ensureStartMenuShortcut } from "./shortcut";
import { syncAutoStart, HIDDEN_FLAG } from "./autostart";

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;
let didFinalFetch = false;

// How long quitting will wait on the last sync before giving up and exiting
const FINAL_FETCH_TIMEOUT_MS = 5_000;

const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  // exit, not quit: quit() before "ready" is advisory, so this process could still
  // reach whenReady and stand up a second window, tray, database handle and poller
  // on its way out. requestSingleInstanceLock has already handed our argv to the
  // instance that owns the app, leaving nothing here worth shutting down cleanly.
  app.exit(0);
} else {
  // Only the instance that holds the lock writes the log
  startLogging();

  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

const asset = (name: string) => path.join(app.getAppPath(), "assets", name);
const iconPath = asset("icon.png");

// Set by the login item when auto-start is on: come up in the tray only.
const launchedHidden = process.argv.includes(HIDDEN_FLAG);

function createWindow(): BrowserWindow {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    icon: iconPath,
    show: !launchedHidden,
    frame: false,
    backgroundColor: "#0b0e14",
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      // The preload only touches contextBridge and ipcRenderer, so it runs
      // fine sandboxed. These are all Electron defaults; stated explicitly so
      // a future default change can't quietly relax them.
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: false,
      spellcheck: false,
    },
  });

  // Load renderer
  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
  }

  // A frameless window carries no menu bar, so Electron's default
  // View > Toggle Developer Tools accelerator never reaches it. Bind the usual
  // keys directly instead — in the packaged build too, since a user reporting a
  // problem needs some way to read the console.
  mainWindow.webContents.on("before-input-event", (_event, input) => {
    if (input.type !== "keyDown") return;
    const toggle =
      input.key === "F12" || (input.control && input.shift && input.key.toLowerCase() === "i");
    if (toggle) mainWindow?.webContents.toggleDevTools();
  });

  // Close behavior: minimize to tray (default) or quit
  mainWindow.on("close", (event) => {
    if (!isQuitting) {
      const minimizeToTray = getSetting("minimize_to_tray");
      if (minimizeToTray !== "false") {
        event.preventDefault();
        mainWindow?.hide();
      } else {
        isQuitting = true;
        app.quit();
      }
    }
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  // Paired with the window:is-maximized handler so the custom title bar can
  // track state it can't observe from the renderer
  mainWindow.on("maximize", () => sendToRenderer(mainWindow, "window:maximized-changed", true));
  mainWindow.on("unmaximize", () => sendToRenderer(mainWindow, "window:maximized-changed", false));

  return mainWindow;
}

function createTray() {
  // Drawn at tray sizes rather than scaled down from the window icon. Electron
  // picks up the @2x file beside it on a HiDPI display.
  tray = new Tray(nativeImage.createFromPath(asset("tray.png")));

  const contextMenu = Menu.buildFromTemplate([
    {
      label: "Show Window",
      click: () => {
        mainWindow?.show();
        mainWindow?.focus();
      },
    },
    { type: "separator" },
    {
      label: "Quit",
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);

  tray.setToolTip("Mayhem Tracker");
  tray.setContextMenu(contextMenu);
  tray.on("double-click", () => {
    mainWindow?.show();
    mainWindow?.focus();
  });
}

app.whenReady().then(async () => {
  // Without this the app is identified by the Electron executable instead.
  app.setAppUserModelId(APP_USER_MODEL_ID);

  // Pairs with that id: gives the taskbar a durable shortcut to pin in place of
  // the temp exe the portable launcher runs from.
  ensureStartMenuShortcut();

  // Before any window exists, so no web contents escapes the policy
  applySecurityPolicy();

  // Initialize the database first. Through the backup module rather than
  // directly: a database that has been deleted or damaged since the last launch
  // is restored from the newest good snapshot here, before anything reads it.
  initDatabaseWithRecovery();

  // Needs the database, which holds the answer. Keeps the login item pointing at
  // the portable exe wherever it has been moved to since the last launch.
  syncAutoStart();

  // Load assets in background
  loadChampionData();
  loadAugmentData().catch((err) => console.error("Failed to load augment data:", err));

  // Recompute stored scores once champion class data is available, so the
  // backfill uses the same class weights as insert-time scoring.
  waitForChampionData().then(() => {
    if (checkScoreBackfill()) sendToRenderer(mainWindow, "lcu:games-updated");
  });

  // Registered once, outside createWindow: ipcMain.handle throws if the same
  // channel is claimed twice, which a second createWindow would have done.
  registerIpcHandlers();

  const win = createWindow();
  createTray();

  startPolling(win);
  // Follows the client into and out of matches, so the Live Game tab has a
  // snapshot to show and the map a game was rolled onto gets written down
  startLiveTracking(win);
  // Records where the ARAM challenges stand each day the client is up. The
  // client keeps no history of its own, so a day nobody writes down is gone.
  startChallengeTracking(win);
  startBackupSchedule();
});

app.on("before-quit", async (event) => {
  isQuitting = true;

  if (!didFinalFetch && isClientConnected()) {
    event.preventDefault();
    didFinalFetch = true;
    try {
      console.log("Fetching games before quit...");
      // Bounded: the LCU request has no timeout of its own, and a client that
      // stops answering would otherwise leave the app unable to exit at all.
      // Losing one last sync is a far better outcome than a process that has
      // to be killed.
      await Promise.race([
        fetchNewGames(mainWindow),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("timed out")), FINAL_FETCH_TIMEOUT_MS),
        ),
      ]);
    } catch (err) {
      console.log("Final fetch on quit failed:", err);
    }
    stopPolling();
    app.quit();
  } else {
    stopPolling();
  }
});

// Runs after before-quit has settled, so the final fetch has already written
// whatever it found by the time the database closes.
app.on("will-quit", () => {
  // A clean exit ends the log on this line, so a log that stops anywhere else
  // stopped in a crash
  console.log("Shutting down");
  stopLiveTracking();
  stopBackupSchedule();
  closeDatabase();
});

// Registering this at all is what keeps the app alive once the window closes —
// the default behaviour is to quit. Closing the window means minimise to tray;
// leaving for good goes through the tray's Quit. The empty body is the point,
// and it applies on every platform, so there is no darwin check to make.
app.on("window-all-closed", () => {});

app.on("activate", () => {
  if (mainWindow === null) {
    createWindow();
  } else {
    mainWindow.show();
  }
});
