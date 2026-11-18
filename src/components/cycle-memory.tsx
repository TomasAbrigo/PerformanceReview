"use client";

import { useSearchParams } from "next/navigation";
import { useEffect } from "react";
import {
  CYCLE_COOKIE,
  CYCLE_COOKIE_MAX_AGE,
} from "@/modules/review-core/current-cycle";

/** `cycle=all` (every cycle, in Goals) is a filter of that list, not a cycle. */
const NOT_A_CYCLE = new Set(["", "all"]);

/**
 * Remembers the cycle the reader chose: whenever the URL carries `cycle`,
 * its value goes to `CYCLE_COOKIE`, and the next screen opened without one
 * starts on it (`pickCycle`). Renders nothing.
 */
export function CycleMemory() {
  const cycle = useSearchParams().get("cycle");
  useEffect(() => {
    if (cycle === null || NOT_A_CYCLE.has(cycle)) return;
    document.cookie = `${CYCLE_COOKIE}=${encodeURIComponent(cycle)}; path=/; max-age=${CYCLE_COOKIE_MAX_AGE}; samesite=lax`;
  }, [cycle]);
  return null;
}
