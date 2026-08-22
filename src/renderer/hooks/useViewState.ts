import { useState, useEffect, type Dispatch, type SetStateAction } from "react";
import { readViewState, writeViewState } from "../lib/viewState";

// A drop-in for useState that restores the last value and stores every new one,
// for filter and sort controls that should survive a relaunch. Both halves are
// no-ops unless the user has turned remembering on, so callers get plain
// useState behaviour by default.
export function useViewState<T>(key: string, initial: T): [T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState<T>(() => readViewState(key, initial));

  useEffect(() => {
    writeViewState(key, value);
  }, [key, value]);

  return [value, setValue];
}
