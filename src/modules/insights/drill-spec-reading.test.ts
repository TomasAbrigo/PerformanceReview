import { describe, expect, it } from "vitest";
import { type Drill, formatDrill, parseDrill } from "./drill-spec";

describe("open-text reading drills (#129)", () => {
  it.each<Drill>([
    {
      kind: "yesno",
      dimension: "custom_security",
      answer: "no",
      side: "self",
      cycle: "11111111-1111-4111-8111-111111111111",
    },
    {
      kind: "yesno",
      dimension: "custom_talk",
      answer: "yes",
      side: null,
      cycle: null,
    },
    {
      kind: "yesno",
      dimension: "custom_talk",
      answer: "no",
      side: null,
      cycle: "11111111-1111-4111-8111-111111111111",
    },
    {
      kind: "comments",
      scope: { side: "manager", substance: "none", dimension: "improvement" },
    },
    { kind: "comments", scope: { signal: "workload" } },
  ])("round-trips %o", (d) => {
    expect(parseDrill(formatDrill(d))).toEqual(d);
  });

  it.each([
    "yesno:custom_x:maybe",
    "yesno:custom_x:no:peer",
    "yesno:custom_x:no:self:not-a-uuid",
    "comments:substance=vague",
    "comments:signal=boredom",
  ])("rejects %o", (raw) => {
    expect(parseDrill(raw)).toBeNull();
  });
});
