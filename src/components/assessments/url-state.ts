import { parseOrgParams, type OrgParams } from "@/components/org/params";
import { firstParam, pageParam } from "@/components/query-string";
import { isProgressFilter, type Progress } from "@/modules/assessments/state";

type Raw = Record<string, string | string[] | undefined>;

/** The filters of the participants list, as they live in the URL. */
export type AssessmentsParams = OrgParams & {
  cycle?: string;
  progress?: Progress;
  q?: string;
  department?: string;
  page: number;
};

export function parseAssessmentsParams(sp: Raw): AssessmentsParams {
  const progress = firstParam(sp, "progress");
  return {
    ...parseOrgParams(sp),
    cycle: firstParam(sp, "cycle"),
    progress: isProgressFilter(progress) ? progress : undefined,
    q: firstParam(sp, "q"),
    department: firstParam(sp, "department"),
    page: pageParam(sp),
  };
}

/** The detail page's view: what the actor reads (`full`) or what the employee would (`employee`). */
export const parseAssessmentView = (sp: Raw): "full" | "employee" =>
  firstParam(sp, "view") === "employee" ? "employee" : "full";
