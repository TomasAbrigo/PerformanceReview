// URL params of the completion view (filters live in the URL, never in state).
import {
  type CompletionGroupBy,
  completionGroupBys,
  type MissingStatus,
  missingStatuses,
} from "@/modules/analytics/completion/types";
import {
  type Hierarchy,
  hierarchies,
} from "@/modules/analytics/dashboards/types";
import { type OrgParams, parseOrgParams } from "@/components/org/params";

export const COMPLETION_PATH = "/insights/completion";

export type CompletionParams = OrgParams & {
  cycle?: string;
  groupBy: CompletionGroupBy;
  hierarchy: Hierarchy;
  department?: string;
  manager?: string;
  status: MissingStatus;
};

type Raw = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) =>
  (Array.isArray(v) ? v[0] : v) || undefined;
const pick = <T extends string>(
  v: string | undefined,
  allowed: readonly T[],
  fallback: T,
): T => (allowed.includes(v as T) ? (v as T) : fallback);

export function parseCompletionParams(sp: Raw): CompletionParams {
  return {
    ...parseOrgParams(sp),
    cycle: one(sp.cycle),
    groupBy: pick(one(sp.groupBy), completionGroupBys, "department"),
    hierarchy: pick(one(sp.hierarchy), hierarchies, "asOf"),
    department: one(sp.department),
    manager: one(sp.manager),
    status: pick(one(sp.status), missingStatuses, "any"),
  };
}

/** `path?…` with the params (overrides applied, empty values dropped). */
export function completionHref(
  p: Partial<CompletionParams>,
  overrides: Partial<CompletionParams> = {},
): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...p, ...overrides })) {
    if (v) q.set(k, v);
  }
  const s = q.toString();
  return s ? `${COMPLETION_PATH}?${s}` : COMPLETION_PATH;
}
