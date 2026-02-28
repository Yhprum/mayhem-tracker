import { useState, useEffect } from "react";
import type { ChampionData, AugmentData } from "../lib/types";

let champCache: ChampionData | null = null;
let augCache: AugmentData | null = null;

function hasData(obj: Record<string, unknown> | null): obj is Record<string, unknown> {
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

export function getChampionName(data: ChampionData, id: number): string {
  return data[id]?.name || `Champion ${id}`;
}

export function getAugmentName(data: AugmentData, id: number): string {
  return data[id]?.name || `Augment ${id}`;
}
