import { describe, expect, it } from "vitest";
import type { BankEntry } from "@/fixtures/company/text-bank";
import { evalCli, evalInput, evaluateProvider, formatEvalReport } from "./eval";
import type { AnalysisProvider } from "./provider";

const entry = (
  text: string,
  expected: BankEntry["expected"],
  question: BankEntry["question"] = "improvement",
): BankEntry => ({ question, side: "self", lang: "es", text, expected });

/** A provider that answers what it is told for each text. */
const oracle = (
  read: (text: string) => Partial<{
    substance: "none" | "generic" | "specific";
    themes: string[];
    signals: string[];
    sentiment: "positive" | "negative" | "neutral";
  }>,
): AnalysisProvider => ({
  name: "oracle",
  promptVersion: "t",
  analyze: async (batch) =>
    batch.map((b) => ({
      token: b.token,
      substance: "generic",
      themes: [],
      signals: [],
      sentiment: "neutral",
      confidence: null,
      ...read(b.text),
    })) as never,
});

describe("analysis eval", () => {
  it("sends the 'how' of a yes/no answer and nothing for a bare one", () => {
    const yes = entry(
      "Sí, con el voluntariado del banco de alimentos.",
      { substance: "specific", themes: [], signals: [], tone: "positive" },
      "social_impact",
    );
    expect(evalInput(yes, 0)).toMatchObject({
      rubric: "yes_no_detail",
      yesNo: "yes",
      text: "con el voluntariado del banco de alimentos.",
    });
    const bare = entry(
      "No.",
      { substance: "none", themes: [], signals: [], tone: "neutral" },
      "social_impact",
    );
    expect(evalInput(bare, 1)).toBeNull();
  });

  it("scores each field: accuracy, signal precision/recall, theme overlap", async () => {
    const bank = [
      entry("a", {
        substance: "specific",
        themes: ["calidad", "equipo"],
        signals: ["workload"],
        tone: "negative",
      }),
      entry("b", {
        substance: "generic",
        themes: [],
        signals: [],
        tone: "neutral",
      }),
    ];
    const r = await evaluateProvider(
      oracle((t) =>
        t === "a"
          ? {
              substance: "specific",
              themes: ["calidad"],
              signals: ["workload", "conflict"],
              sentiment: "positive",
            }
          : { substance: "none" },
      ),
      bank,
    );
    expect(r.substance).toEqual({ n: 2, value: 0.5 });
    expect(r.tone).toEqual({ n: 2, value: 0.5 });
    expect(r.signalsPrecision).toEqual({ n: 2, value: 0.5 });
    expect(r.signalsRecall).toEqual({ n: 1, value: 1 });
    // a: {calidad}/{calidad, equipo} = 0.5; b: both empty = 1.
    expect(r.themes.value).toBeCloseTo(0.75);
    expect(formatEvalReport(r)).toContain("substance accuracy");
  });

  it("rejects an unknown provider with exit code 2", async () => {
    const lines: string[] = [];
    const code = await evalCli(["--provider", "gpt"], {
      env: {},
      stderr: (l) => lines.push(l),
    });
    expect(code).toBe(2);
    expect(lines.join("\n")).toContain("Usage: pnpm analysis:eval");
  });

  it("scores the mock against the whole bank", async () => {
    const lines: string[] = [];
    expect(
      await evalCli(["--provider", "mock"], {
        env: {},
        stdout: (l) => lines.push(l),
      }),
    ).toBe(0);
    expect(lines.join("\n")).toMatch(/provider mock/);
  });
});
