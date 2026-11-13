import { SIZE_CONFIG } from "./config";
import { IdentityPool } from "./identity";
import { createRng } from "./rng";
import type {
  FixtureEmployee,
  FixtureEmploymentRow,
  FixtureJobRow,
  FixtureSize,
  GenerateCompanyOptions,
  IdentityGroundTruth,
} from "./types";
import { buildWorkforce } from "./workforce";

export type {
  FixtureEmployee,
  FixtureEmploymentRow,
  FixtureJobRow,
  FixtureSize,
  GenerateCompanyOptions,
};

export interface CompanyFixture {
  size: FixtureSize;
  seed: number;
  employees: FixtureEmployee[];
  jobHistory: FixtureJobRow[];
  employmentHistory: FixtureEmploymentRow[];
  identity: IdentityGroundTruth;
}

export function generateCompany(
  options: GenerateCompanyOptions,
): CompanyFixture {
  const rng = createRng(options.seed);
  const identities = new IdentityPool(rng);
  const workforce = buildWorkforce(rng, identities, SIZE_CONFIG[options.size]);
  return { size: options.size, seed: options.seed, ...workforce };
}
