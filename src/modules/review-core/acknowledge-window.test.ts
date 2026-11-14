import { describe, expect, it } from "vitest";
import {
  ackStatus,
  acknowledgeDeadline,
  DEFAULT_ACK_WINDOW_DAYS,
} from "./acknowledge-window";

const shared = new Date("2026-03-10T15:30:00.000Z");
const DAY = 24 * 60 * 60 * 1000;

describe("acknowledgeDeadline", () => {
  it("is 7 days after sharing by default", () => {
    expect(DEFAULT_ACK_WINDOW_DAYS).toBe(7);
    expect(acknowledgeDeadline({ sharedAt: shared })).toEqual(
      new Date(shared.getTime() + 7 * DAY),
    );
  });

  it("takes a configurable window", () => {
    expect(acknowledgeDeadline({ sharedAt: shared, windowDays: 3 })).toEqual(
      new Date(shared.getTime() + 3 * DAY),
    );
  });

  it("uses the cycle's acknowledge due date (to the end of that day) when set", () => {
    expect(
      acknowledgeDeadline({ sharedAt: shared, dueDate: "2026-04-01" }),
    ).toEqual(new Date("2026-04-01T23:59:59.999Z"));
  });
});

describe("ackStatus", () => {
  const deadline = new Date(shared.getTime() + 7 * DAY);
  const base = { sharedAt: shared, acknowledgedAt: null, deadline };

  it("is not_shared before the manager shares", () => {
    expect(
      ackStatus({ ...base, sharedAt: null, now: shared, deadline: null }),
    ).toBe("not_shared");
  });

  it("is open until the deadline, inclusive, then expired", () => {
    expect(ackStatus({ ...base, now: shared })).toBe("open");
    expect(ackStatus({ ...base, now: deadline })).toBe("open");
    expect(ackStatus({ ...base, now: new Date(deadline.getTime() + 1) })).toBe(
      "expired",
    );
  });

  it("is acknowledged whatever the date", () => {
    expect(
      ackStatus({
        ...base,
        acknowledgedAt: shared,
        now: new Date(deadline.getTime() + DAY),
      }),
    ).toBe("acknowledged");
  });
});
