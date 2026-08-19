import { app, shell } from "electron";
import path from "path";

// Must match the id passed to app.setAppUserModelId: the taskbar only
// substitutes the shortcut for the running exe when the two agree.
const APP_USER_MODEL_ID = "com.mayhem-tracker.app";

// The portable build runs from a temp copy that its launcher extracts on start
// and deletes on exit, so pinning the running window would pin a path that no
// longer exists by the time it is clicked. Windows resolves a pin against the
// Start Menu shortcut carrying the same AppUserModelID when there is one, so
// keeping this shortcut current is what makes the pin point at the real exe.
export function ensureStartMenuShortcut() {
  const exe = process.env.PORTABLE_EXECUTABLE_FILE;
  if (process.platform !== "win32" || !exe) return;

  const link = path.join(
    app.getPath("appData"),
    "Microsoft",
    "Windows",
    "Start Menu",
    "Programs",
    `${app.getName()}.lnk`,
  );

  try {
    const existing = shell.readShortcutLink(link);
    if (existing.target === exe && existing.appUserModelId === APP_USER_MODEL_ID) return;
  } catch {
    // No shortcut yet, or it is unreadable — either way it gets written below.
  }

  try {
    shell.writeShortcutLink(link, "create", {
      target: exe,
      cwd: path.dirname(exe),
      description: app.getName(),
      appUserModelId: APP_USER_MODEL_ID,
    });
  } catch (err) {
    // A missing shortcut only costs pinning, so it is never worth failing startup.
    console.error("Failed to write Start Menu shortcut:", err);
  }
}
