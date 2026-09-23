import {
  BrowserWindow,
  ClipboardItem,
  clipboard,
  dialog,
  session,
  type NativeImage,
} from "electron";
import fs from "fs";
import path from "path";
import * as db from "./db";
import * as dragon from "./dragon";
import { hardenSession } from "./security";
import { CARD_STATUS_KEY, cardRoute, type CardStatus } from "../shared/card";

// The card is drawn by a second window running the same renderer at a fixed
// width, rather than by a drawing routine of its own: the image is then the
// app's own markup, it stays in step with the page for free, and it looks the
// same whatever size the visible window has been dragged to.
const CARD_WIDTH = 1200;
// Rasterised a little above the layout size, so the small text holds up where
// the image is scaled up a bit rather than pinned at 1:1. Past this the file
// grows faster than it reads any better.
const CARD_SCALE = 1.5;
// The card gets a session of its own: Chromium keeps the zoom level per origin
// per session, and the app's window is served from the same origin, so sharing
// one would mean the card's zoom applies to the app as well. Persistent, so the
// icon cache survives between exports.
const CARD_PARTITION = "persist:game-card";
// Something to lay the card out in before it has said how tall it really is
const INITIAL_HEIGHT = 1200;

// The card page reports itself ready once its data and icons have settled. Past
// this it isn't coming, and an error says more than a half-drawn image would.
const READY_TIMEOUT_MS = 30_000;
const POLL_MS = 100;
// A resize to the full height has to be painted before it can be captured. The
// paint normally lands in a frame or two; the wait is bounded in case the
// compositor decides the new area needs no repaint.
const REPAINT_TIMEOUT_MS = 1_500;

// Window sizes are in whole pixels, which a fractional scale is not obliged to
// land on
const scaled = (cssPixels: number) => Math.ceil(cssPixels * CARD_SCALE);

export interface ExportImageResult {
  success: boolean;
  path?: string;
  error?: string;
}

// Champion names carry spaces, apostrophes and ampersands ("Nunu & Willump"),
// none of which belong in a filename offered to a save dialog.
function slug(name: string): string {
  return name.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function defaultFileName(gameId: number): string {
  const detail = db.getMatchDetail(gameId);
  if (!detail) return `mayhem-game-${gameId}.png`;
  const champion = dragon.getChampionData()[detail.stats?.champion_id]?.name;
  const date = new Date(detail.game.game_creation);
  const day = [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
  // The game id rides along so two games on the same champion on the same day
  // are offered different names rather than one overwriting the other
  return `mayhem-${champion ? `${slug(champion)}-` : ""}${day}-${gameId}.png`;
}

function createCardWindow(): BrowserWindow {
  hardenSession(session.fromPartition(CARD_PARTITION));

  const win = new BrowserWindow({
    width: scaled(CARD_WIDTH),
    height: scaled(INITIAL_HEIGHT),
    // The sizes above are the page's, not the frame's, so the card's width is
    // exactly the width of the image it ends up in
    useContentSize: true,
    show: false,
    backgroundColor: "#0b0e14",
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      // Renders into a bitmap instead of onto the screen: a hidden on-screen
      // window is not guaranteed to paint at all, and this one exists only to
      // be photographed.
      offscreen: true,
      // Layout stays in CSS pixels while the bitmap behind it is CARD_SCALE
      // times the size
      zoomFactor: CARD_SCALE,
      partition: CARD_PARTITION,
      // Same posture as the main window: the card runs the same renderer and
      // reaches the database through the same preload.
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: false,
      spellcheck: false,
    },
  });

  // Windows shrinks a window created larger than the screen to fit it, and a
  // card laid out at the wrong width measures the wrong height. Resizing after
  // the fact is not clamped, so the size asked for above is claimed here.
  win.setContentSize(scaled(CARD_WIDTH), scaled(INITIAL_HEIGHT));
  return win;
}

async function loadCard(win: BrowserWindow, gameId: number): Promise<void> {
  const hash = cardRoute(gameId);
  if (process.env.ELECTRON_RENDERER_URL) {
    await win.loadURL(`${process.env.ELECTRON_RENDERER_URL}#${hash}`);
  } else {
    await win.loadFile(path.join(__dirname, "../renderer/index.html"), { hash });
  }
}

// Resolves once the page has drawn everything it is going to draw, or throws
// with whatever it has to say about why it can't.
async function waitForCard(win: BrowserWindow): Promise<CardStatus> {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  for (;;) {
    if (win.isDestroyed()) throw new Error("The card window closed before the image was taken");
    const status: CardStatus | null = await win.webContents.executeJavaScript(
      `window[${JSON.stringify(CARD_STATUS_KEY)}] ?? null`,
    );
    if (status?.state === "error") throw new Error(status.error || "The card could not be drawn");
    if (status?.state === "ready") return status;
    if (Date.now() > deadline) throw new Error("Timed out waiting for the card to finish drawing");
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
}

function nextPaint(win: BrowserWindow): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(finish, REPAINT_TIMEOUT_MS);
    function finish() {
      clearTimeout(timer);
      if (!win.isDestroyed()) win.webContents.off("paint", finish);
      resolve();
    }
    win.webContents.once("paint", finish);
  });
}

async function renderCard(gameId: number): Promise<NativeImage> {
  const win = createCardWindow();
  try {
    await loadCard(win, gameId);
    const status = await waitForCard(win);
    // The window was only ever tall enough to lay the card out in; a capture is
    // of what is on screen, so the screen has to become the whole card first.
    win.setContentSize(scaled(CARD_WIDTH), scaled(status.height));
    await nextPaint(win);
    const image = await win.webContents.capturePage();
    if (image.isEmpty()) throw new Error("The card came back blank");
    return image;
  } finally {
    win.destroy();
  }
}

export async function exportGameImage(
  parent: BrowserWindow | null,
  gameId: number,
): Promise<ExportImageResult> {
  const options = {
    title: "Export Game Image",
    defaultPath: defaultFileName(gameId),
    filters: [{ name: "PNG Image", extensions: ["png"] }],
  };
  // Parented to the window when there is one, so the dialog is modal
  const chosen = parent
    ? await dialog.showSaveDialog(parent, options)
    : await dialog.showSaveDialog(options);
  // No error either: a dismissed dialog is an answer, not a failure
  if (chosen.canceled || !chosen.filePath) return { success: false };

  try {
    const image = await renderCard(gameId);
    await fs.promises.writeFile(chosen.filePath, image.toPNG());
    return { success: true, path: chosen.filePath };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

// The same card, straight onto the clipboard: no dialog, no file, nothing to
// clean up afterwards when all you wanted was to paste it into a chat.
export async function copyGameImage(gameId: number): Promise<ExportImageResult> {
  try {
    const png = (await renderCard(gameId)).toPNG();
    await clipboard.write([
      new ClipboardItem({ "image/png": new Blob([png], { type: "image/png" }) }),
    ]);
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}
