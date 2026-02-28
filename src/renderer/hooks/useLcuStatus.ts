import { useState, useEffect } from "react";
import type { LcuStatus } from "../lib/types";

export function useLcuStatus() {
  const [status, setStatus] = useState<LcuStatus>("disconnected");

  useEffect(() => {
    window.api.getLcuStatus().then(setStatus);
    const unsub = window.api.onStatusChanged((s) => setStatus(s as LcuStatus));
    return unsub;
  }, []);

  return status;
}
