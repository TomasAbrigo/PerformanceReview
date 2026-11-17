import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DbOrTx } from "@/db/client";

const jobsAsOf = vi.fn();
const managerAsOf = vi.fn();
vi.mock("@/modules/org-history/queries", () => ({
  jobAsOf: vi.fn(),
  jobsAsOf: (...args: unknown[]) => jobsAsOf(...args),
  managerAsOf: (...args: unknown[]) => managerAsOf(...args),
}));

const { currentManagerOf, isCurrentManager } = await import("./org-relations");

const db = {} as DbOrTx;
const ana = { personId: "ana", role: "manager" as const };
// 22:30 on 2024-06-30 in Buenos Aires is already 2024-07-01 in UTC.
const lateEvening = new Date("2024-07-01T01:30:00Z");

beforeEach(() => {
  jobsAsOf
    .mockReset()
    .mockResolvedValue(new Map([["bruno", { managerPersonId: "ana" }]]));
  managerAsOf.mockReset().mockResolvedValue("ana");
});

describe("today in the company's time zone", () => {
  it("currentManagerOf looks the org up on the local date, not the UTC one", async () => {
    const found = await currentManagerOf(db, ana, ["bruno"], lateEvening);
    expect(found).toEqual(new Set(["bruno"]));
    expect(jobsAsOf).toHaveBeenCalledWith(db, ["bruno"], "2024-06-30");
  });

  it("isCurrentManager does too", async () => {
    expect(await isCurrentManager(db, ana, "bruno", lateEvening)).toBe(true);
    expect(managerAsOf).toHaveBeenCalledWith(db, "bruno", "2024-06-30");
  });
});
