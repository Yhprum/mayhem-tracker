import fs from "fs";
import os from "os";
import path from "path";
import util from "util";
import { app, type WebContents } from "electron";
import { getLogDir } from "./paths";

// The main process logs to stdout, and a packaged app on Windows has no console
// for stdout to reach, so without this everything it says is lost. Every line
// still goes to the terminal as before and is appended to logs/main.log as
// well, which is the file a bug report can attach.
//
// Written synchronously, a line at a time. The app says little, so the cost is
// too small to measure, and the line that explains a crash is on disk before
// the crash rather than in a buffer that dies with the process.

// Weeks of ordinary use. Past it the file rolls over to main.old.log, so the
// log never holds much more than twice this.
const MAX_BYTES = 2 * 1024 * 1024;

const LEVELS = { log: "INFO", info: "INFO", warn: "WARN", error: "ERROR" } as const;

let fd: number | null = null;
let size = 0;
// A rollover that fails (the old file held open by something else) is not
// retried on every line; the log keeps growing until the next launch instead.
let canRollOver = true;

const logPath = () => path.join(getLogDir(), "main.log");

function open(): void {
  try {
    fd = fs.openSync(logPath(), "a");
    size = fs.fstatSync(fd).size;
  } catch {
    // A log that can't be written must never be the reason the app can't run
    fd = null;
  }
}

function rollOver(): void {
  if (fd != null) fs.closeSync(fd);
  fd = null;
  try {
    fs.renameSync(logPath(), path.join(getLogDir(), "main.old.log"));
  } catch {
    canRollOver = false;
  }
  open();
}

function stamp(date = new Date()): string {
  const p = (n: number, width = 2) => String(n).padStart(width, "0");
  return (
    `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())} ` +
    `${p(date.getHours())}:${p(date.getMinutes())}:${p(date.getSeconds())}.${p(date.getMilliseconds(), 3)}`
  );
}

function write(level: string, args: unknown[]): void {
  if (fd == null) return;
  const line = `${stamp()} ${level} ${util.format(...args)}\n`;
  const bytes = Buffer.byteLength(line);
  if (canRollOver && size + bytes > MAX_BYTES) rollOver();
  if (fd == null) return;
  try {
    fs.writeSync(fd, line);
    size += bytes;
  } catch {
    // Same rule as opening it: the log is never worth an exception
  }
}

// The page's warnings and errors, and a renderer that dies outright, none of
// which the main process otherwise hears about. DevTools shows the same
// messages, but only to someone who had it open at the time.
function watchRenderer(contents: WebContents): void {
  const label = () => (contents.getURL().includes("#/card/") ? "card" : "renderer");
  contents.on("console-message", (event) => {
    if (event.level !== "warning" && event.level !== "error") return;
    // The icon fallbacks walk candidate URLs on purpose, and every miss on the
    // way is a 404 the page reports as an error
    if (event.message.startsWith("Failed to load resource")) return;
    write(event.level === "error" ? "ERROR" : "WARN", [
      `[${label()}] ${event.message} (${event.sourceId}:${event.lineNumber})`,
    ]);
  });
  contents.on("render-process-gone", (_event, details) => {
    write("ERROR", [`[${label()}] process gone: ${details.reason}, exit code ${details.exitCode}`]);
  });
  contents.on("preload-error", (_event, preloadPath, error) => {
    write("ERROR", [`[${label()}] preload ${preloadPath} failed:`, error]);
  });
}

// Call once, as early as the process is sure to be the one instance that runs
export function startLogging(): void {
  open();

  for (const method of Object.keys(LEVELS) as (keyof typeof LEVELS)[]) {
    const original = console[method].bind(console);
    console[method] = (...args: unknown[]) => {
      original(...args);
      write(LEVELS[method], args);
    };
  }

  // A monitor rather than a handler: it only writes the error down, and leaves
  // Electron to report it and end the process exactly as it would have anyway
  process.on("uncaughtExceptionMonitor", (err, origin) => write("FATAL", [origin, err]));

  app.on("web-contents-created", (_event, contents) => watchRenderer(contents));

  write("INFO", [
    `Mayhem Tracker ${app.getVersion()}, Electron ${process.versions.electron}, ${os.type()} ${os.release()}`,
  ]);
}
