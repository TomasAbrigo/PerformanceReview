// URL params of /insights/360 (filters live in the URL, never in state).
import { type Dm360Scope, dm360Scopes } from "@/modules/analytics/dm-360/types";

export type Dm360Params = { cycle?: string; scope: Dm360Scope };

type Raw = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) =>
  (Array.isArray(v) ? v[0] : v)?.trim() || undefined;

export function parseDm360Params(sp: Raw): Dm360Params {
  const scope = one(sp.scope);
  return {
    cycle: one(sp.cycle),
    scope: (dm360Scopes as readonly string[]).includes(scope ?? "")
      ? (scope as Dm360Scope)
      : "direct",
  };
}
