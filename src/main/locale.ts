import { app } from "electron";
import { LOCALE_SWITCH } from "../shared/api";

// Dates and numbers follow Windows' regional format, which a page can't read
// for itself. Its default locale is the display language, and even that only
// when Chromium has strings for it: the packaged app ships en-US strings alone,
// so every other display language falls back to en-US. Each window is created
// with the regional format on its command line instead, and the preload hands
// it to the page.
export function localeArguments(): string[] {
  try {
    const [locale] = Intl.getCanonicalLocales(app.getSystemLocale());
    return locale ? [`${LOCALE_SWITCH}=${locale}`] : [];
  } catch {
    // Not a well-formed locale tag. Passed on, it would make every formatting
    // call in the page throw, so the page keeps its own default instead.
    return [];
  }
}
