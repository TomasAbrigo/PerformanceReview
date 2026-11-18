import { type OrgParams, parseOrgParams } from "@/components/org/params";
import {
  sentiments,
  type Sentiment,
} from "@/modules/qualitative-analysis/constants";
import {
  type QualitativeGroupBy,
  qualitativeGroupBys,
} from "@/modules/qualitative-analysis/types";

/** Which side wrote the comments: undefined is everybody. */
export type QualitativeSide = "self" | "manager";

export type QualitativeParams = OrgParams & {
  /** What the sentiment-by-group panel cuts by (default: the account). */
  groupBy?: QualitativeGroupBy;
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
  const groupBy = one(raw.groupBy);
  return {
    ...parseOrgParams(raw),
    groupBy: (qualitativeGroupBys as readonly string[]).includes(groupBy ?? "")
      ? (groupBy as QualitativeGroupBy)
      : undefined,
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

/** The page's query string for `params`, with the grouping of the by-group panel replaced. */
export function withGroupBy(
  params: QualitativeParams,
  groupBy: QualitativeGroupBy,
): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries({ ...params, groupBy })) {
    if (value === undefined || value === false || value === "") continue;
    query.set(key, value === true ? "1" : String(value));
  }
  return `/insights/qualitative?${query.toString()}`;
}
