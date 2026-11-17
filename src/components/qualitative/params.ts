import {
  sentiments,
  type Sentiment,
} from "@/modules/qualitative-analysis/constants";

export type QualitativeParams = {
  cycle?: string;
  department?: string;
  dimension?: string;
  sentiment?: Sentiment;
  theme?: string;
  aggregate: boolean;
};

type Raw = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) =>
  (Array.isArray(v) ? v[0] : v)?.trim() || undefined;

export function parseQualitativeParams(raw: Raw): QualitativeParams {
  const sentiment = one(raw.sentiment);
  return {
    cycle: one(raw.cycle),
    department: one(raw.department),
    dimension: one(raw.dimension),
    sentiment: (sentiments as readonly string[]).includes(sentiment ?? "")
      ? (sentiment as Sentiment)
      : undefined,
    theme: one(raw.theme),
    aggregate: one(raw.aggregate) === "1",
  };
}
