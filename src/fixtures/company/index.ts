import { SIZE_CONFIG } from "./config";
import { buildGoals } from "./goals";
import { IdentityPool } from "./identity";
import { buildReviews } from "./reviews";
import { createRng } from "./rng";
import type {
  FixtureAssessment,
  FixtureCycle,
  FixtureEmployee,
  FixtureEmploymentRow,
  FixtureFeedback,
  FixtureGoal,
  FixtureJobRow,
  FixtureSize,
  GenerateCompanyOptions,
  IdentityGroundTruth,
} from "./types";
import { AS_OF, buildWorkforce } from "./workforce";

export type {
  FixtureAssessment,
  FixtureCycle,
  FixtureEmployee,
  FixtureEmploymentRow,
  FixtureFeedback,
  FixtureGoal,
  FixtureJobRow,
  FixtureSize,
  GenerateCompanyOptions,
  IdentityGroundTruth,
};

export interface CompanyFixture {
  size: FixtureSize;
  seed: number;
  /** The fictional "today" of the dataset. */
  asOf: string;
  cycles: FixtureCycle[];
  employees: FixtureEmployee[];
  jobHistory: FixtureJobRow[];
  employmentHistory: FixtureEmploymentRow[];
  assessments: FixtureAssessment[];
  feedback: FixtureFeedback[];
  goals: FixtureGoal[];
  identity: IdentityGroundTruth;
}

export function generateCompany(
  options: GenerateCompanyOptions,
): CompanyFixture {
  const rng = createRng(options.seed);
  const identities = new IdentityPool(rng);
  const workforce = buildWorkforce(rng, identities, SIZE_CONFIG[options.size]);
  const reviews = buildReviews(rng, workforce);
  const goals = buildGoals(rng, { ...workforce, asOf: AS_OF });
  return {
    size: options.size,
    seed: options.seed,
    asOf: AS_OF,
    ...workforce,
    ...reviews,
    goals,
  };
}
