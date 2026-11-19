// Drizzle- and server-free: shared by the queries and client components.
import type { LocalizedText } from "@/db/schema/rating-scales";
import type { Sentiment, Signal } from "./constants";

/**
 * What the open-text reading screens show (#129). The unit is the PERSON:
 * each person counts once per question and side, read at their latest cycle
 * in the selection (within one cycle, the participant); `people` always
 * counts distinct people. Self and manager are never mixed in one row.
 */
export type Side = "self" | "manager";
export const readingSides = ["self", "manager"] as const;

/** Where the labels come from and how fresh they are. */
export type Provenance = {
  /** Effective labels in scope. */
  labels: number;
  /** Of them: corrected by a person, imported, read by a machine. */
  human: number;
  imported: number;
  machine: number;
  /** The machine labels are the demo heuristic (mock), not an analysis. */
  demo: boolean;
  /** Providers of the machine labels, most labels first. */
  providers: { provider: string; model: string | null; labels: number }[];
  /** The latest succeeded run of a provider (not an import), if any. */
  lastRun: {
    provider: string;
    model: string | null;
    finishedAt: string;
  } | null;
};

/** People per substance of their answer to one question, one side. */
export type SubstanceRow = {
  dimension: string;
  side: Side;
  none: number;
  generic: number;
  specific: number;
  /** People whose answer has a substance (imported labels have none). */
  people: number;
};

/**
 * The manager's feedback of the people of a group: each person by the
 * weaker of the manager's two answers (strengths, improvement), so
 * "specific" means both carry an anchor.
 */
export type GroupSubstance = {
  key: string | null;
  label: string | null;
  none: number;
  generic: number;
  specific: number;
  people: number;
};

/** One theme of a question: people who cite it on each side. */
export type ThemeSideRow = {
  theme: string;
  self: number;
  manager: number;
  /** Up to 2 representative quotes per side (pseudonymized); none for aggregates. */
  quotes: Record<Side, string[]>;
};

export type ThemesBySide = {
  dimension: string;
  /** People with a read answer to the question, per side (the denominators). */
  people: Record<Side, number>;
  rows: ThemeSideRow[];
};

/** Person–manager agreement on one question: both sides of one participant. */
export type AgreementRow = {
  dimension: "strengths" | "improvement";
  /** People whose two answers (self and manager) have themes. */
  both: number;
  /** Of them, people where both name at least one same theme. */
  shared: number;
};

/** An improvement theme the manager names and the person does not. */
export type BlindSpot = { theme: string; people: number };

export type Agreement = {
  rows: AgreementRow[];
  blindSpots: BlindSpot[];
  /** People with both improvement answers and at least one blind spot. */
  blindPeople: number;
  /** People with both improvement answers themed (the base of blindPeople). */
  improvementBoth: number;
};

export type SignalRow = {
  signal: Signal;
  /** People with the signal in any answer (either side). */
  people: number;
  /** People with it in their own answers / in their manager's. */
  self: number;
  manager: number;
};

export type SignalSummary = {
  /** People with at least one read answer (the base). */
  people: number;
  /** People with at least one signal. */
  withAny: number;
  rows: SignalRow[];
};

export type GroupSignals = {
  key: string | null;
  label: string | null;
  people: number;
  withAny: number;
  counts: Record<Signal, number>;
};

/** People with a read answer by the manager's indicator answer, and how many carry a signal. */
export type SignalIndicatorRow = {
  role: "retention" | "engagement";
  value: number;
  /** The question's choice for the value, never the raw answer text. */
  label: LocalizedText | null;
  people: number;
  withSignal: number;
};

/** What a yes/no question is about, for its alert. */
export type YesNoKind = "security" | "conversations" | "impact" | "other";

export type YesNoRow = {
  dimension: string;
  prompt: LocalizedText;
  side: Side;
  kind: YesNoKind;
  yes: number;
  no: number;
  /** People who answered yes or no. */
  people: number;
};

export type YesNoGroupRow = {
  dimension: string;
  key: string | null;
  label: string | null;
  yes: number;
  no: number;
  people: number;
};

export type YesNoTrendRow = {
  dimension: string;
  cycleId: string;
  cycleName: string;
  periodEnd: string;
  yes: number;
  no: number;
  people: number;
};

/** Themes (initiative types) of the "how" of a yes/no question. */
export type YesNoThemes = {
  dimension: string;
  /** People with a "how" read. */
  people: number;
  rows: { theme: string; people: number }[];
};

/** "How well does the company recognize my value?" (1-4), people per value. */
export type ValuedDistribution = {
  /** People per value 1..4 (index 0 = value 1). */
  counts: number[];
  people: number;
  /** People at 1-2: they do not feel valued (or are not sure). */
  notValued: number;
  /** The question's choice per value 1..4 (choiceOfValue). */
  labels: (LocalizedText | null)[];
};

export type ValuedGroupRow = ValuedDistribution & {
  key: string | null;
  label: string | null;
};

export type ValuedTrendRow = ValuedDistribution & {
  cycleId: string;
  cycleName: string;
  periodEnd: string;
};

/** "What would help me do my best work?": people per option. */
export type BestWork = {
  people: number;
  options: { option: string; label: LocalizedText | null; people: number }[];
};

/** The tone of the free text of one question and side (people per tone). */
export type ToneRow = Record<Sentiment, number> & {
  dimension: string;
  side: Side;
  people: number;
};
