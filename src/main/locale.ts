import { app } from "electron";
import { LOCALE_SWITCH } from "../shared/api";

// Dates and numbers follow Windows' regional format, which a page can't read
// for itself. Its default locale is the display language, and even that only
// when Chromium has strings for it: the packaged app ships en-US strings alone,
// so every other display language falls back to en-US. Each window is created
// with the regional format on its command line instead, and the preload hands
// it to the page. Text the main process writes for the page, like recap
// milestones, formats with systemLocale() for the same reason.
export function systemLocale(): string | undefined {
  try {
    return Intl.getCanonicalLocales(app.getSystemLocale())[0];
  } catch {
    // Not a well-formed locale tag. Passed on, it would make every formatting
    // call that names it throw, so callers keep their own default instead.
    return undefined;
  }
}

export function localeArguments(): string[] {
  const locale = systemLocale();
  return locale ? [`${LOCALE_SWITCH}=${locale}`] : [];
}
