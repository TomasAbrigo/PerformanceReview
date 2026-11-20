import { describe, expect, it } from "vitest";
import type { SentimentCounts } from "@/modules/qualitative-analysis/types";
import {
  buildDm360,
  type Dm360Cycle,
  type Dm360Facts,
  type Dm360Input,
  type Dm360Participant,
  insightsOf,
  treeKey,
} from "./derive";
import type { Dm360Card } from "./types";

const cycles: Dm360Cycle[] = [
  {
    id: "c1",
    name: "H1 2024",
    periodStart: "2024-01-01",
    periodEnd: "2024-06-30",
    createdAt: 1,
  },
  {
    id: "c2",
    name: "H2 2024",
    periodStart: "2024-07-01",
    periodEnd: "2024-12-31",
    createdAt: 2,
  },
  {
    id: "c3",
    name: "H1 2025",
    periodStart: "2025-01-01",
    periodEnd: "2025-06-30",
    createdAt: 3,
  },
];
const thresholds = {
  dropThreshold: 2,
  riskThreshold: 2,
  goodPct: 80,
  watchPct: 50,
};
/** A stand-in for the install's keyed hash: opaque, stable, distinct per name. */
const keyOf = (value: string) =>
  `g${[...value].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 1_000_003, 7)}`;

const sentiment = (o: Partial<SentimentCounts> = {}): SentimentCounts => ({
  positive: 0,
  constructive: 0,
  neutral: 0,
  mixed: 0,
  negative: 0,
  total: 0,
  ...o,
});

/** `p{n}` in `cycle` under `dm`, with retention / engagement / sentiment. */
type Spec = {
  who: string;
  cycle: string;
  dm: string | null;
  retention?: number;
  engagement?: number;
  self?: "submitted" | "not_started" | "not_applicable";
  manager?: "submitted" | "not_started" | "not_applicable";
  comments?: Partial<SentimentCounts>;
};

function world(specs: Spec[]) {
  const participants: Dm360Participant[] = [];
  const facts = {
    retention: new Map<string, number>(),
    engagement: new Map<string, number>(),
    sides: new Map<string, { self: never; manager: never }>(),
    signals: new Map<string, boolean>(),
  };
  for (const s of specs) {
    const participantId = `${s.who}@${s.cycle}`;
    participants.push({
      participantId,
      personId: s.who,
      cycleId: s.cycle,
      dm: s.dm,
    });
    if (s.retention !== undefined)
      facts.retention.set(participantId, s.retention);
    if (s.engagement !== undefined)
      facts.engagement.set(participantId, s.engagement);
    facts.sides.set(participantId, {
      self: (s.self ?? "submitted") as never,
      manager: (s.manager ?? "submitted") as never,
    });
    // A read answer; a "negative" one stands for an answer with a signal.
    if (s.comments) {
      facts.signals.set(
        participantId,
        (sentiment(s.comments).negative ?? 0) > 0,
      );
    }
  }
  return { participants, facts: facts as unknown as Dm360Facts };
}

const run = (
  specs: Spec[],
  over: Partial<Dm360Input> = {},
): ReturnType<typeof buildDm360> => {
  const { participants, facts } = world(specs);
  return buildDm360({
    cycles,
    cycleId: "c3",
    participants,
    scope: "direct",
    facts,
    thresholds,
    minGroupSize: null,
    keyOf,
    ...over,
  });
};

/** Diego: 4 people, retention falling 4 -> 4 -> 2 (mean); Dora: 2 people. */
const specs: Spec[] = [
  // Diego's people in each cycle.
  ...["a", "b", "c", "d"].flatMap((who, i) => [
    { who, cycle: "c1", dm: "Diego", retention: 4, engagement: 4 },
    { who, cycle: "c2", dm: "Diego", retention: 4, engagement: 3 },
    {
      who,
      cycle: "c3",
      dm: "Diego",
      retention: i < 2 ? 1 : 3,
      engagement: i < 2 ? 1 : 4,
      manager: i === 3 ? ("not_started" as const) : ("submitted" as const),
      self: "submitted" as const,
      comments: i < 2 ? { negative: 1, positive: 1 } : { positive: 1 },
    },
  ]),
  { who: "e", cycle: "c3", dm: "Dora", retention: 5, engagement: 5 },
  { who: "f", cycle: "c3", dm: "Dora", retention: 4, engagement: 5 },
  { who: "g", cycle: "c3", dm: null, retention: 3 },
];

describe("buildDm360", () => {
  it("one card per DM with its people, means, risk, sentiment and completion", () => {
    const { cards, withoutDm, suppressed } = run(specs);

    expect(cards.map((c) => [c.key, c.label, c.people])).toEqual([
      ["Diego", "Diego", 4],
      ["Dora", "Dora", 2],
    ]);
    expect(withoutDm).toBe(1);
    expect(suppressed).toBe(0);
    const diego = cards[0];
    expect(diego.retention).toEqual({ mean: 2, n: 4 });
    expect(diego.engagement?.mean).toBeCloseTo(2.5);
    // Two of four have both at 1.
    expect(diego.risk).toEqual({ people: 2, of: 4, share: 0.5 });
    // Two of the four people with read answers carry a signal.
    expect(diego.signals).toEqual({ people: 2, of: 4, share: 0.5 });
    expect(diego.selfRate).toBe(1);
    expect(diego.managerRate).toBe(0.75);
  });

  it("evolves cycle by cycle, up to the cycle asked for, oldest first", () => {
    const diego = run(specs).cards[0];

    expect(
      diego.trend.map((p) => [p.cycleName, p.people, p.retention]),
    ).toEqual([
      ["H1 2024", 4, 4],
      ["H2 2024", 4, 4],
      ["H1 2025", 4, 2],
    ]);
    const earlier = run(specs, { cycleId: "c2" }).cards[0];
    expect(earlier.trend.map((p) => p.cycleName)).toEqual([
      "H1 2024",
      "H2 2024",
    ]);
    // Dora has people only now: the earlier points are empty.
    const dora = run(specs).cards[1];
    expect(dora.trend.map((p) => [p.people, p.retention])).toEqual([
      [0, null],
      [0, null],
      [2, 4.5],
    ]);
  });

  it("says what the rules find: falls, signals, risk, pending assessments", () => {
    const diego = run(specs).cards[0];

    // Engagement fell by half a point: under the threshold. 3 of 4 manager
    // assessments are in: under the 80 % target the KPI tones (#133).
    expect(diego.insights.map((i) => i.code)).toEqual([
      "retentionDrop",
      "signals",
      "riskHigh",
      "completionLow",
    ]);
    expect(diego.insights[0]).toEqual({
      code: "retentionDrop",
      params: { previous: 4, current: 2, delta: 2, cycle: "H2 2024" },
    });
    expect(diego.insights.find((i) => i.code === "signals")).toEqual({
      code: "signals",
      params: { percent: 50, people: 2, of: 4 },
    });
    expect(diego.insights.find((i) => i.code === "riskHigh")).toEqual({
      code: "riskHigh",
      params: { percent: 50, people: 2 },
    });
  });

  it("is quiet when nothing applies, and says there is no data when there is none", () => {
    const dora = run(specs).cards[1];
    expect(dora.insights).toEqual([{ code: "stable" }]);
    const nothing = run([
      {
        who: "x",
        cycle: "c3",
        dm: "Nadie",
        self: "not_applicable",
        manager: "not_applicable",
      },
    ]);
    expect(nothing.cards[0].insights).toEqual([{ code: "noData" }]);
  });

  it("compares only with the cycle right before (#133): a gap is no fall", () => {
    const gap = run([
      ...["a", "b"].flatMap((who) => [
        { who, cycle: "c1", dm: "Diego", retention: 5 },
        { who, cycle: "c2", dm: "Diego" },
        { who, cycle: "c3", dm: "Diego", retention: 2 },
      ]),
    ]);

    expect(gap.cards[0].insights.map((i) => i.code)).not.toContain(
      "retentionDrop",
    );
  });

  it("a DM nobody reports to has no insight on a fall of less than the threshold", () => {
    const flat = run(
      ["a", "b"].flatMap((who) => [
        { who, cycle: "c2", dm: "Diego", retention: 4 },
        { who, cycle: "c3", dm: "Diego", retention: 3 },
      ]),
    );

    // No alert, but a mean of 3 is short of the target: never "stable".
    expect(flat.cards[0].insights).toEqual([
      { code: "belowTarget", params: { retention: 1, engagement: 0 } },
    ]);
  });

  it("tree: counts everybody below the DM in the chart as well as the people assigned to them", () => {
    const below = new Map([[treeKey("c3", "Dora"), new Set(["a@c3", "g@c3"])]]);

    const { cards } = run(specs, { scope: "tree", below });

    const dora = cards.find((c) => c.key === "Dora")!;
    // e and f are Dora's; a (also Diego's) and g (no DM) are below Dora.
    expect(dora.people).toBe(4);
    expect(cards.find((c) => c.key === "Diego")!.people).toBe(4);
    // Without the chart, direct only.
    expect(
      run(specs, { scope: "tree" }).cards.find((c) => c.key === "Dora")!.people,
    ).toBe(2);
    expect(
      run(specs, { below }).cards.find((c) => c.key === "Dora")!.people,
    ).toBe(2);
  });

  it("a manager reads only the DMs they are", () => {
    const { cards } = run(specs, { dms: new Set(["Dora"]) });

    expect(cards.map((c) => c.key)).toEqual(["Dora"]);
  });
});

describe("buildDm360, masked (direction)", () => {
  const big: Spec[] = [
    ...["a", "b", "c", "d", "e"].map((who) => ({
      who,
      cycle: "c3",
      dm: "Diego",
      retention: 2,
      engagement: 2,
      comments: { negative: 1 },
    })),
    ...["f", "g", "h"].map((who) => ({
      who,
      cycle: "c3",
      dm: "Dora",
      retention: 4,
      engagement: 4,
    })),
    ...["i", "j"].map((who) => ({
      who,
      cycle: "c3",
      dm: "Elisa",
      retention: 5,
      engagement: 5,
    })),
    { who: "k", cycle: "c3", dm: null, retention: 1 },
  ];

  it("gives teams with an opaque key and no name, DMs under the minimum folded into Otros", () => {
    const r = run(big, { minGroupSize: 5 });

    expect(r.minGroupSize).toBe(5);
    expect(r.cards.map((c) => [c.key, c.label, c.others, c.people])).toEqual([
      [keyOf("Diego"), null, false, 5],
      // Dora's 3 and Elisa's 2 together make 5.
      ["others", null, true, 5],
    ]);
    expect(JSON.stringify(r)).not.toMatch(/Diego|Dora|Elisa/);
    expect(r.withoutDm).toBeNull();
    expect(r.suppressed).toBe(0);
  });

  it("refuses to mask without a keyer: no key, no names", () => {
    expect(() => run(big, { minGroupSize: 5, keyOf: undefined })).toThrow(
      /keyer/,
    );
  });

  it("drops Otros, counting its people, when it is under the minimum too", () => {
    const small = big.filter((s) => s.dm !== "Diego");

    const r = run(small, { minGroupSize: 6 });

    expect(r.cards).toEqual([]);
    expect(r.suppressed).toBe(5);
    const four = run(big, { minGroupSize: 4 });
    expect(four.cards.map((c) => c.people)).toEqual([5, 5]);
  });

  it("leaves out every figure over fewer people than the minimum, and the sentences built on them", () => {
    const r = run(
      [
        ...["a", "b", "c", "d", "e"].map((who, i) => ({
          who,
          cycle: "c3",
          dm: "Diego",
          // Only two have indicators, only one wrote a comment, 1 side applies.
          ...(i < 2 ? { retention: 1, engagement: 1 } : {}),
          ...(i === 0 ? { comments: { negative: 4 } } : {}),
          self: i === 0 ? ("submitted" as const) : ("not_applicable" as const),
          manager: "submitted" as const,
        })),
      ],
      { minGroupSize: 5 },
    );

    const card = r.cards[0];
    expect(card.people).toBe(5);
    expect(card.retention).toBeNull();
    expect(card.engagement).toBeNull();
    expect(card.risk).toBeNull();
    expect(card.signals).toBeNull();
    expect(card.selfRate).toBeNull();
    expect(card.managerRate).toBe(1);
    expect(card.insights).toEqual([{ code: "noData" }]);
  });

  it("hides the points of the sparkline of cycles with fewer people than the minimum", () => {
    const r = run(
      [
        ...["a", "b", "c", "d", "e"].map((who) => ({
          who,
          cycle: "c3",
          dm: "Diego",
          retention: 2,
        })),
        ...["a", "b"].map((who) => ({
          who,
          cycle: "c2",
          dm: "Diego",
          retention: 5,
        })),
      ],
      { minGroupSize: 5 },
    );

    expect(r.cards[0].trend.map((p) => [p.people, p.retention])).toEqual([
      [null, null],
      [null, null],
      [5, 2],
    ]);
    // No fall can be told from a hidden cycle.
    expect(r.cards[0].insights.map((i) => i.code)).not.toContain(
      "retentionDrop",
    );
  });
});

describe("insightsOf", () => {
  const base: Pick<
    Dm360Card,
    "retention" | "engagement" | "risk" | "signals" | "managerRate" | "trend"
  > = {
    retention: null,
    engagement: null,
    risk: null,
    signals: null,
    managerRate: null,
    trend: [],
  };

  it("needs a minimum of comments and people before a share is said", () => {
    const share = (people: number, of: number): Dm360Card["signals"] => ({
      people,
      of,
      share: people / of,
    });

    expect(insightsOf({ ...base, signals: share(2, 2) }, thresholds)).toEqual([
      { code: "stable" },
    ]);
    expect(
      insightsOf({ ...base, signals: share(1, 3) }, thresholds)[0].code,
    ).toBe("signals");
    expect(
      insightsOf({ ...base, risk: { people: 2, of: 2, share: 1 } }, thresholds),
    ).toEqual([{ code: "stable" }]);
  });

  // #133: one definition of "alert", the tones of the card's own KPIs (the
  // targets.* settings), never fixed shares of its own.
  it("flags the manager assessments under the completion target the KPI tones", () => {
    expect(insightsOf({ ...base, managerRate: 0.7 }, thresholds)).toEqual([
      { code: "completionLow", params: { percent: 70 } },
    ]);
    expect(insightsOf({ ...base, managerRate: 0.8 }, thresholds)).toEqual([
      { code: "noData" },
    ]);
    expect(
      insightsOf({ ...base, managerRate: 0.7 }, { ...thresholds, goodPct: 70 }),
    ).toEqual([{ code: "noData" }]);
  });

  it("flags a share at risk the KPI tones as attention (24 % of 38)", () => {
    expect(
      insightsOf(
        { ...base, risk: { people: 9, of: 38, share: 9 / 38 } },
        thresholds,
      ),
    ).toEqual([{ code: "riskHigh", params: { percent: 24, people: 9 } }]);
    expect(
      insightsOf(
        { ...base, risk: { people: 0, of: 38, share: 0 } },
        thresholds,
      ),
    ).toEqual([{ code: "stable" }]);
  });

  it("says which means are under their target instead of 'stable'", () => {
    const mean = (m: number) => ({ mean: m, n: 10 });
    expect(
      insightsOf(
        { ...base, retention: mean(3.5), engagement: mean(4.2) },
        thresholds,
      ),
    ).toEqual([
      { code: "belowTarget", params: { retention: 1, engagement: 0 } },
    ]);
    expect(
      insightsOf(
        { ...base, retention: mean(4), engagement: mean(4.2) },
        thresholds,
      ),
    ).toEqual([{ code: "stable" }]);
  });

  it("measures a fall only against the cycle right before", () => {
    const point = (cycleId: string, retention: number | null) => ({
      cycleId,
      cycleName: cycleId,
      periodStart: "2025-01-01",
      people: 10,
      retention,
      engagement: null,
    });
    const card = {
      ...base,
      retention: { mean: 2, n: 10 },
      trend: [point("a", 4.5), point("b", null), point("c", 2)],
    };
    expect(insightsOf(card, thresholds).map((i) => i.code)).not.toContain(
      "retentionDrop",
    );
  });
});
