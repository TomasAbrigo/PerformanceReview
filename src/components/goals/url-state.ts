import { firstParam, pageParam } from "@/components/query-string";
import { parseOrgParams, type OrgParams } from "@/components/org/params";
import { type GoalState, isGoalStateFilter } from "@/modules/goals/state";

type Raw = Record<string, string | string[] | undefined>;

/** The filters of the goals list, as they live in the URL. */
export type GoalsParams = OrgParams & {
  cycle?: string;
  state?: GoalState;
  q?: string;
  department?: string;
  page: number;
};

export function parseGoalsParams(sp: Raw): GoalsParams {
  const state = firstParam(sp, "state");
  return {
    ...parseOrgParams(sp),
    cycle: firstParam(sp, "cycle"),
    state: isGoalStateFilter(state) ? state : undefined,
    q: firstParam(sp, "q"),
    department: firstParam(sp, "department"),
    page: pageParam(sp),
  };
}
