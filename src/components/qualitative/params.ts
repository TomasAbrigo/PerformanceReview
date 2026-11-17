import {
  sentiments,
  type Sentiment,
} from "@/modules/qualitative-analysis/constants";

/** Which side wrote the comments: undefined is everybody. */
export type QualitativeSide = "self" | "manager";

export type QualitativeParams = {
  cycle?: string;
  department?: string;
  dimension?: string;
  sentiment?: Sentiment;
  theme?: string;
  side?: QualitativeSide;
  aggregate: boolean;
};

type Raw = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) =>
  (Array.isArray(v) ? v[0] : v)?.trim() || undefined;

export function parseQualitativeParams(raw: Raw): QualitativeParams {
  const sentiment = one(raw.sentiment);
  const side = one(raw.side);
  return {
    cycle: one(raw.cycle),
    department: one(raw.department),
    dimension: one(raw.dimension),
    sentiment: (sentiments as readonly string[]).includes(sentiment ?? "")
      ? (sentiment as Sentiment)
      : undefined,
    theme: one(raw.theme),
    side: side === "self" || side === "manager" ? side : undefined,
    aggregate: one(raw.aggregate) === "1",
  };
}

/** The page's query string for `params`, with the side replaced. */
export function withSide(
  params: QualitativeParams,
  side: QualitativeSide | undefined,
): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries({ ...params, side })) {
    if (value === undefined || value === false || value === "") continue;
    query.set(key, value === true ? "1" : String(value));
  }
  const qs = query.toString();
  return `/insights/qualitative${qs ? `?${qs}` : ""}`;
}
