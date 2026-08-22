import { app } from "electron";
import { getSetting, setSetting } from "./db";

// Auto-start exists so the poller keeps recording games, not so a window lands
// in front of whatever the user signed in to do, so the login item always asks
// for the tray. Forwarded through the portable launcher, which passes its own
// command line on to the extracted exe.
export const HIDDEN_FLAG = "--hidden";

// The portable launcher runs the app from a temp copy it deletes on exit, so
// process.execPath — what setLoginItemSettings would register by default — is a
// path that no longer exists by the next sign-in. PORTABLE_EXECUTABLE_FILE is
// the exe the user actually keeps, the same one ensureStartMenuShortcut targets.
function portableExe(): string | null {
  if (process.platform !== "win32") return null;
  return process.env.PORTABLE_EXECUTABLE_FILE ?? null;
}

// False in dev and in any unpackaged run: there is no durable exe to register.
export function isAutoStartSupported(): boolean {
  return portableExe() !== null;
}

export function applyAutoStart(enabled: boolean): void {
  const exe = portableExe();
  if (!exe) return;

  // The registry entry is derived state: `auto_start` holds the user's answer
  // and `auto_start_path` records the exe last registered, so a launch can tell
  // whether the entry still points at where the exe lives now.
  const registered = getSetting("auto_start_path");
  // Deliberately narrow. setLoginItemSettings also resets the startup-approved
  // key, so rewriting an entry that is already correct would silently undo a
  // user who switched the app off in Task Manager's Startup tab.
  if (enabled ? registered === exe : !registered) return;

  try {
    app.setLoginItemSettings({
      openAtLogin: enabled,
      path: exe,
      args: [HIDDEN_FLAG],
      // Pinned rather than left to default to the AppUserModelId, so the value
      // name can't shift with the order startup happens to call things in.
      name: app.getName(),
    });
    setSetting("auto_start_path", enabled ? exe : "");
  } catch (err) {
    // Costs auto-start, never the launch. The recorded path stays stale, so the
    // next start tries again.
    console.error("Failed to update the login item:", err);
  }
}

// A portable exe gets moved and renamed, which leaves the registered path
// pointing at nothing. Re-registering on each launch keeps it current.
export function syncAutoStart(): void {
  applyAutoStart(getSetting("auto_start") === "true");
}
