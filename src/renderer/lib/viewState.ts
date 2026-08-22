// The filters and sorting the user has picked, kept in localStorage so a
// relaunch can open on the same view instead of resetting to defaults. Values
// are only stored while the remember_filters setting is on; that setting itself
// lives in the database with the others.
const PREFIX = "view:";

let remembering = false;

// Set from main.tsx before the first render: pages read their stored values
// synchronously while mounting, so the answer has to be in hand by then.
export function initViewState(enabled: boolean): void {
  remembering = enabled;
}

export function setRemembering(enabled: boolean): void {
  remembering = enabled;
  // Turning it off means every page opens on its defaults from now on, rather
  // than reviving whatever happened to be stored the last time it was on.
  if (!enabled) clearViewState();
}

export function readViewState<T>(key: string, fallback: T): T {
  if (!remembering) return fallback;
  const raw = localStorage.getItem(PREFIX + key);
  if (raw === null) return fallback;
  try {
    const parsed = JSON.parse(raw);
    // An "All"-style filter holds undefined, which only survives JSON as null
    return parsed === null ? (undefined as T) : (parsed as T);
  } catch {
    return fallback;
  }
}

export function writeViewState(key: string, value: unknown): void {
  if (!remembering) return;
  localStorage.setItem(PREFIX + key, JSON.stringify(value ?? null));
}

function clearViewState(): void {
  for (const key of Object.keys(localStorage)) {
    if (key.startsWith(PREFIX)) localStorage.removeItem(key);
  }
}
