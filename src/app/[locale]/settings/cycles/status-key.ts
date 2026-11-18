import type { CycleStatus } from "@/modules/review-core/status";

/** The three states People see: the in-between phases are all "open". */
export const statusKey = (status: CycleStatus) =>
  status === "draft" ? "draft" : status === "closed" ? "closed" : "open";
