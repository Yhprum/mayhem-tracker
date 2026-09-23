import { useState, useEffect } from "react";
import type { ChampionData, AugmentData, ItemData, SummonerSpellData } from "../lib/types";

let champCache: ChampionData | null = null;
let spellCache: SummonerSpellData | null = null;
const augCaches = new Map<string, AugmentData>();
const augPromises = new Map<string, Promise<AugmentData>>();
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

// Augment data is keyed by patch so a historical game reports the name, rarity
// and art it was played with — Riot reworks augments under the same id, so the
// live export is only correct for the current patch. Aggregate views that span
// patches pass nothing and get "latest", which is what they want anyway.
export function useAugmentData(patch?: string | null): AugmentData {
  const key = patch || "latest";
  const [data, setData] = useState<AugmentData>(() => augCaches.get(key) ?? {});
  // Another patch starts from whatever is already cached for it, and from
  // nothing while it loads
  const [dataFor, setDataFor] = useState(key);
  if (dataFor !== key) {
    setDataFor(key);
    setData(augCaches.get(key) ?? {});
  }

  useEffect(() => {
    const cached = augCaches.get(key);
    if (cached && Object.keys(cached).length > 0) return;
    let promise = augPromises.get(key);
    if (!promise) {
      // Derived from key rather than patch so the effect depends on one value.
      // "latest" is exactly what the main process substitutes for no patch.
      promise = window.api.getAugmentData(key === "latest" ? undefined : key);
      augPromises.set(key, promise);
    }
    let active = true;
    promise.then((d) => {
      if (Object.keys(d).length > 0) augCaches.set(key, d);
      else augPromises.delete(key);
      if (active) setData(d);
    });
    return () => {
      active = false;
    };
  }, [key]);

  return data;
}

export function useSummonerSpellData() {
  const [data, setData] = useState<SummonerSpellData>(spellCache || {});

  useEffect(() => {
    if (hasData(spellCache)) return;
    window.api.getSummonerSpellData().then((d) => {
      if (Object.keys(d).length > 0) spellCache = d;
      setData(d);
    });
  }, []);

  return data;
}

// Item data is keyed by patch so icons come from the same patch as the game.
// A patch still being fetched yields an empty record, which renders as the same
// placeholder as an item CommunityDragon has no entry for.
export function useItemData(patch?: string | null): ItemData {
  const key = patch || "latest";
  const [items, setItems] = useState<ItemData>(() => itemCaches.get(key) ?? {});
  // Another patch starts from whatever is already cached for it, and from
  // nothing while it loads
  const [itemsFor, setItemsFor] = useState(key);
  if (itemsFor !== key) {
    setItemsFor(key);
    setItems(itemCaches.get(key) ?? {});
  }

  useEffect(() => {
    const cached = itemCaches.get(key);
    if (cached && Object.keys(cached).length > 0) return;
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
      if (active) setItems(d);
    });
    return () => {
      active = false;
    };
  }, [key]);

  return items;
}

export function getChampionName(data: ChampionData, id: number): string {
  return data[id]?.name || `Champion ${id}`;
}

export function getAugmentName(data: AugmentData, id: number): string {
  return data[id]?.name || `Augment ${id}`;
}
