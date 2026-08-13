import { useState, useEffect } from "react";
import type { ChampionData, AugmentData, ItemData } from "../lib/types";

let champCache: ChampionData | null = null;
let augCache: AugmentData | null = null;
const itemCaches = new Map<string, ItemData>();
const itemPromises = new Map<string, Promise<ItemData>>();

function hasData<T extends object>(obj: T | null): obj is T {
  return obj !== null && Object.keys(obj).length > 0;
}

export function useChampionData() {
  const [data, setData] = useState<ChampionData>(champCache || {});

  useEffect(() => {
    if (hasData(champCache)) return;
    window.api.getChampionData().then((d) => {
      if (Object.keys(d).length > 0) champCache = d;
      setData(d);
    });
  }, []);

  return data;
}

export function useAugmentData() {
  const [data, setData] = useState<AugmentData>(augCache || {});

  useEffect(() => {
    if (hasData(augCache)) return;
    window.api.getAugmentData().then((d) => {
      if (Object.keys(d).length > 0) augCache = d;
      setData(d);
    });
  }, []);

  return data;
}

// Item data is keyed by patch so icons come from the same patch as the game.
// `loaded` matters to callers: a patch that hasn't been fetched yet looks
// exactly like one CommunityDragon has no entry for, and the two want opposite
// treatment. A cold patch takes a network round trip in the main process, so
// the gap is long enough to see.
export function useItemData(patch?: string | null): { items: ItemData; loaded: boolean } {
  const key = patch || "latest";
  const [state, setState] = useState<{ items: ItemData; loaded: boolean }>(() => {
    const cached = itemCaches.get(key);
    return cached ? { items: cached, loaded: true } : { items: {}, loaded: false };
  });

  useEffect(() => {
    const cached = itemCaches.get(key);
    if (cached && Object.keys(cached).length > 0) {
      setState({ items: cached, loaded: true });
      return;
    }
    setState({ items: {}, loaded: false });
    let promise = itemPromises.get(key);
    if (!promise) {
      // Derived from key rather than patch so the effect depends on one value.
      // "latest" is exactly what the main process substitutes for no patch.
      promise = window.api.getItemData(key === "latest" ? undefined : key);
      itemPromises.set(key, promise);
    }
    let active = true;
    promise.then((d) => {
      if (Object.keys(d).length > 0) itemCaches.set(key, d);
      else itemPromises.delete(key);
      // An empty result still counts as loaded — the lookup genuinely failed,
      // and the legacy icon host is the right fallback for that.
      if (active) setState({ items: d, loaded: true });
    });
    return () => {
      active = false;
    };
  }, [key]);

  return state;
}

export function getChampionName(data: ChampionData, id: number): string {
  return data[id]?.name || `Champion ${id}`;
}

export function getAugmentName(data: AugmentData, id: number): string {
  return data[id]?.name || `Augment ${id}`;
}
