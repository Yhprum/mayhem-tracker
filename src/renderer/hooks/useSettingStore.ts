import { useSyncExternalStore } from "react";
import type { SettingStore } from "../lib/settingStore";

/** A shared setting's current value, re-rendering when Settings changes it */
export function useSettingStore<T>(store: SettingStore<T>): T {
  return useSyncExternalStore(store.subscribe, store.get);
}
