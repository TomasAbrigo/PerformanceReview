import { describe, expect, it } from "vitest";
import {
  cycleGroupsInput,
  cycleInput,
  hireDateScheduleInput,
} from "./validation";

const TEMPLATE = "00000000-0000-4000-8000-0000000000aa";

const base = {
  name: "Onboarding",
  periodStart: "2026-01-01",
  periodEnd: "2026-12-31",
  snapshotDate: "2026-01-01",
  components: {
    self: true,
    manager: true,
    peer: false,
    upward: false,
    calibration: false,
  },
  anonymity: { peer: "transparent", upward: "transparent" },
} as const;

describe("hireDateScheduleInput", () => {
  it.each([30, 60, 90, 180, 365])("accepts the %s day milestone", (days) => {
    expect(
      hireDateScheduleInput.safeParse({ milestoneDays: days, windowWeeks: 2 })
        .success,
    ).toBe(true);
  });

  it.each([0, 15, 45, 91, 366, -30, 30.5])(
    "rejects the %s day milestone",
    (days) => {
      expect(
        hireDateScheduleInput.safeParse({ milestoneDays: days, windowWeeks: 1 })
          .success,
      ).toBe(false);
    },
  );

  it.each([1, 2, 3, 4])("accepts a %s week window", (weeks) => {
    expect(
      hireDateScheduleInput.safeParse({ milestoneDays: 30, windowWeeks: weeks })
        .success,
    ).toBe(true);
  });

  it.each([0, 5, 1.5, -1])("rejects a %s week window", (weeks) => {
    expect(
      hireDateScheduleInput.safeParse({ milestoneDays: 30, windowWeeks: weeks })
        .success,
    ).toBe(false);
  });
});

describe("cycleInput schedule", () => {
  it("requires a schedule for hire-date cycles", () => {
    const result = cycleInput.safeParse({ ...base, scheduleKind: "hire_date" });
    expect(result.success).toBe(false);
    expect(
      result.error?.issues.map((i) => [i.path.join("."), i.message]),
    ).toEqual([["hireDateSchedule", "required"]]);
  });

  it("accepts a hire-date cycle with its schedule", () => {
    const result = cycleInput.safeParse({
      ...base,
      scheduleKind: "hire_date",
      hireDateSchedule: { milestoneDays: 90, windowWeeks: 3 },
    });
    expect(result.success).toBe(true);
  });

  it("keeps fixed-date cycles unchanged", () => {
    const result = cycleInput.safeParse({ ...base });
    expect(result.success).toBe(true);
    expect(result.data?.scheduleKind).toBe("fixed");
  });
});

describe("cycleGroupsInput", () => {
  const group = {
    name: "Ingeniería",
    templateId: TEMPLATE,
    filter: { kind: "filter", departments: ["Ingeniería"] },
  } as const;

  it("accepts groups with a name, template and filter", () => {
    expect(cycleGroupsInput.safeParse([group]).success).toBe(true);
    expect(cycleGroupsInput.safeParse([]).success).toBe(true);
  });

  it("requires a name and a template id", () => {
    const result = cycleGroupsInput.safeParse([
      { ...group, name: " ", templateId: "nope" },
    ]);
    expect(
      result.error?.issues.map((i) => [i.path.join("."), i.message]),
    ).toEqual([
      ["0.name", "required"],
      ["0.templateId", "invalid"],
    ]);
  });

  it("rejects duplicated names, ignoring case", () => {
    const result = cycleGroupsInput.safeParse([
      group,
      { ...group, name: "ingeniería " },
    ]);
    expect(
      result.error?.issues.map((i) => [i.path.join("."), i.message]),
    ).toEqual([["1.name", "duplicate_name"]]);
  });
});
