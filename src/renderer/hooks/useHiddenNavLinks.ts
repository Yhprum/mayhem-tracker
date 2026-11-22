import { useEffect, useSyncExternalStore } from "react";
import { getHiddenNavLinks, loadHiddenNavLinks, subscribeHiddenNavLinks } from "../lib/navLinks";

/** The header links the user has switched off in Settings, kept current */
export function useHiddenNavLinks(): ReadonlySet<string> {
  useEffect(() => {
    loadHiddenNavLinks().catch(() => {});
  }, []);
  return useSyncExternalStore(subscribeHiddenNavLinks, getHiddenNavLinks);
}
