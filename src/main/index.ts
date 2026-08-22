import { app, BrowserWindow, Tray, Menu, nativeImage } from "electron";
import path from "path";
import { closeDatabase, getSetting, checkScoreBackfill } from "./db";
import { initDatabaseWithRecovery, startBackupSchedule, stopBackupSchedule } from "./backup";
import { registerIpcHandlers } from "./ipc-handlers";
import { startPolling, stopPolling, isClientConnected, fetchNewGames } from "./lcu";
import { loadChampionData, loadAugmentData, waitForChampionData } from "./dragon";
import { applySecurityPolicy } from "./security";
import { ensureStartMenuShortcut } from "./shortcut";

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
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

const iconPath = path.join(app.getAppPath(), "assets/icon.png");

function createWindow(): BrowserWindow {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    icon: iconPath,
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
  mainWindow.on("maximize", () => mainWindow?.webContents.send("window:maximized-changed", true));
  mainWindow.on("unmaximize", () =>
    mainWindow?.webContents.send("window:maximized-changed", false),
  );

  return mainWindow;
}

function createTray() {
  const trayIcon = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });
  tray = new Tray(trayIcon);

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
  // Windows groups taskbar entries and attributes notifications by this id;
  // without it the app is identified by the Electron executable instead.
  app.setAppUserModelId("com.mayhem-tracker.app");

  // Pairs with that id: gives the taskbar a durable shortcut to pin in place of
  // the temp exe the portable launcher runs from.
  ensureStartMenuShortcut();

  // Before any window exists, so no web contents escapes the policy
  applySecurityPolicy();

  // Initialize the database first. Through the backup module rather than
  // directly: a database that has been deleted or damaged since the last launch
  // is restored from the newest good snapshot here, before anything reads it.
  initDatabaseWithRecovery();

  // Load assets in background
  loadChampionData();
  loadAugmentData();

  // Recompute stored scores once champion class data is available, so the
  // backfill uses the same class weights as insert-time scoring.
  waitForChampionData().then(() => {
    if (checkScoreBackfill()) {
      mainWindow?.webContents.send("lcu:games-updated");
    }
  });

  // Registered once, outside createWindow: ipcMain.handle throws if the same
  // channel is claimed twice, which a second createWindow would have done.
  registerIpcHandlers();

  const win = createWindow();
  createTray();

  startPolling(win);
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
