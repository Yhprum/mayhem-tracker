import { app, BrowserWindow } from "electron";
import { spawn } from "child_process";
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";

const CHECK_TIMEOUT_MS = 10_000;
// Applied per chunk rather than to the whole download: the asset is ~90 MB, so
// a total-duration cap would abort a slow but perfectly healthy connection.
// What we actually want to catch is a transfer that has stopped moving.
const DOWNLOAD_STALL_TIMEOUT_MS = 30_000;

export interface UpdateInfo {
  hasUpdate: boolean;
  latest?: string;
  current?: string;
  url?: string;
  assetUrl?: string;
  assetSize?: number;
  error?: string;
}

// The expected hash never leaves the main process: the renderer only echoes
// back an asset URL, so trusting a digest it supplied would verify nothing.
type CachedAsset = { assetUrl: string; sha256: string | null };
let lastCheckedAsset: CachedAsset | null = null;

// GitHub reports asset digests as "sha256:<hex>"
function parseDigest(digest: unknown): string | null {
  if (typeof digest !== "string") return null;
  const m = digest.match(/^sha256:([0-9a-f]{64})$/i);
  return m ? m[1].toLowerCase() : null;
}

export async function checkForUpdate(): Promise<UpdateInfo> {
  try {
    const res = await fetch("https://api.github.com/repos/Yhprum/mayhem-tracker/releases/latest", {
      headers: { "User-Agent": "mayhem-tracker" },
      signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
    });
    if (!res.ok) return { hasUpdate: false, error: "No releases found" };
    const data = (await res.json()) as any;
    const latest = (data.tag_name as string).replace(/^v/, "");
    const current = app.getVersion();
    const asset = (data.assets as any[])?.find((a) => a.name?.endsWith(".exe"));
    if (asset?.browser_download_url) {
      lastCheckedAsset = {
        assetUrl: asset.browser_download_url,
        sha256: parseDigest(asset.digest),
      };
    }
    return {
      hasUpdate: latest !== current,
      latest,
      current,
      url: data.html_url as string,
      assetUrl: asset?.browser_download_url,
      assetSize: asset?.size,
    };
  } catch {
    return { hasUpdate: false, error: "Failed to check for updates" };
  }
}

export async function downloadAndInstall(
  win: BrowserWindow,
  assetUrl: string,
): Promise<{ success: boolean; error?: string }> {
  // Set by electron-builder's portable launcher; absent in dev and non-portable builds
  const portableExe = process.env.PORTABLE_EXECUTABLE_FILE;
  if (!portableExe) {
    return { success: false, error: "In-app update only works in the portable exe build" };
  }
  if (!assetUrl.startsWith("https://github.com/Yhprum/mayhem-tracker/")) {
    return { success: false, error: "Unexpected download URL" };
  }

  // Re-resolve the release if this URL isn't the one we last saw, so the hash
  // we check against always comes from GitHub rather than from the caller.
  if (lastCheckedAsset?.assetUrl !== assetUrl) {
    await checkForUpdate();
    if (lastCheckedAsset?.assetUrl !== assetUrl) {
      return { success: false, error: "That download is no longer the latest release" };
    }
  }
  const expectedSha256 = lastCheckedAsset.sha256;

  let tmpDir: string;
  try {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mayhem-update-"));
  } catch (err: any) {
    return { success: false, error: `Failed to create temp dir: ${err.message}` };
  }

  const newExe = path.join(tmpDir, "mayhem-tracker-update.exe");
  // Rearmed on every chunk, so the download is only abandoned once it has
  // genuinely stopped rather than merely being slow.
  const controller = new AbortController();
  let stallTimer: ReturnType<typeof setTimeout> | undefined;
  const armStallTimer = () => {
    clearTimeout(stallTimer);
    stallTimer = setTimeout(() => controller.abort(), DOWNLOAD_STALL_TIMEOUT_MS);
  };

  try {
    armStallTimer();
    const res = await fetch(assetUrl, {
      headers: { "User-Agent": "mayhem-tracker" },
      signal: controller.signal,
    });
    if (!res.ok || !res.body) {
      clearTimeout(stallTimer);
      fs.rmSync(tmpDir, { recursive: true, force: true });
      return { success: false, error: `Download failed (HTTP ${res.status})` };
    }
    const total = Number(res.headers.get("content-length")) || 0;
    const out = fs.createWriteStream(newExe);
    const reader = res.body.getReader();
    const hash = crypto.createHash("sha256");
    let received = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      armStallTimer();
      received += value.length;
      hash.update(value);
      if (!out.write(Buffer.from(value))) {
        await new Promise((resolve) => out.once("drain", resolve));
      }
      if (total) {
        win.webContents.send("update:progress", Math.round((received / total) * 100));
      }
    }
    clearTimeout(stallTimer);
    await new Promise<void>((resolve, reject) => {
      out.end(() => resolve());
      out.on("error", reject);
    });
    if (total && received !== total) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
      return { success: false, error: "Download incomplete, please try again" };
    }

    // A release published before GitHub reported digests has nothing to check
    // against; HTTPS and the pinned host still stand on their own.
    if (expectedSha256) {
      const actual = hash.digest("hex");
      if (actual !== expectedSha256) {
        fs.rmSync(tmpDir, { recursive: true, force: true });
        console.error(`Update hash mismatch: expected ${expectedSha256}, got ${actual}`);
        return { success: false, error: "Downloaded file failed its integrity check" };
      }
    } else {
      console.warn("Release asset has no digest; skipping hash verification");
    }
  } catch (err: any) {
    clearTimeout(stallTimer);
    fs.rmSync(tmpDir, { recursive: true, force: true });
    if (err?.name === "AbortError" || err?.name === "TimeoutError") {
      return { success: false, error: "Download stalled, please try again" };
    }
    return { success: false, error: `Download failed: ${err.message}` };
  }

  // Install under the artifact name (productName minus spaces) regardless of the
  // current filename, so exes downloaded before the version was dropped from the
  // artifact name get migrated.
  const targetExe = path.join(path.dirname(portableExe), `${app.getName().replace(/ /g, "")}.exe`);
  const stagedExe = `${targetExe}.new`;

  // The running portable exe is locked by the OS until the app fully exits, so a
  // detached script stages the new exe next to the old one, waits for the lock to
  // release, swaps them, and relaunches. The old exe is only deleted once the
  // staged copy is in place, and ping is used as the delay because timeout errors
  // out when stdin is redirected.
  const script = path.join(tmpDir, "update.cmd");
  fs.writeFileSync(
    script,
    [
      "@echo off",
      `copy /y "${newExe}" "${stagedExe}" >nul 2>&1`,
      "if errorlevel 1 goto fail",
      "set tries=0",
      ":wait",
      "set /a tries+=1",
      "if %tries% gtr 120 goto fail",
      "ping -n 2 127.0.0.1 >nul",
      `del /f "${portableExe}" >nul 2>&1`,
      `if exist "${portableExe}" goto wait`,
      `move /y "${stagedExe}" "${targetExe}" >nul 2>&1`,
      `start "" "${targetExe}"`,
      "goto cleanup",
      ":fail",
      `del /f "${stagedExe}" >nul 2>&1`,
      `start "" "${portableExe}"`,
      ":cleanup",
      `rd /s /q "${tmpDir}"`,
      "",
    ].join("\r\n"),
  );

  spawn("cmd.exe", ["/c", script], { detached: true, stdio: "ignore", windowsHide: true }).unref();
  // Let the IPC response reach the renderer before quitting
  setTimeout(() => app.quit(), 200);
  return { success: true };
}
