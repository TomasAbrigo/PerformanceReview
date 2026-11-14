import { describe, expect, it } from "vitest";
import { parseNotificationsArgs, UsageError } from "./cli";

describe("parseNotificationsArgs", () => {
  it("has no options by default (today, offsets 7/1/0)", () => {
    expect(parseNotificationsArgs([])).toEqual({
      asOf: undefined,
      offsets: undefined,
    });
  });

  it("reads --as-of and --offsets", () => {
    expect(
      parseNotificationsArgs(["--as-of", "2026-07-08", "--offsets", "3,1"]),
    ).toEqual({ asOf: "2026-07-08", offsets: [3, 1] });
    expect(parseNotificationsArgs(["--as-of=2026-07-08"]).asOf).toBe(
      "2026-07-08",
    );
  });

  it.each(["2026-02-30", "07/08/2026", "2026-7-8", ""])(
    "rejects the invalid date %j",
    (value) => {
      expect(() => parseNotificationsArgs(["--as-of", value])).toThrow(
        UsageError,
      );
    },
  );

  it.each(["", "7,x", "-1", "1.5", "7,,1", "400"])(
    "rejects the invalid offsets %j",
    (value) => {
      expect(() => parseNotificationsArgs(["--offsets", value])).toThrow(
        UsageError,
      );
    },
  );

  it("rejects unknown options and positionals", () => {
    expect(() => parseNotificationsArgs(["--nope"])).toThrow(UsageError);
    expect(() => parseNotificationsArgs(["extra"])).toThrow(UsageError);
  });
});
