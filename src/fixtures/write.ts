import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { generateCompany, type CompanyFixture, type FixtureSize } from "./company";
import { SIZE_CONFIG } from "./company/config";
import { serializeBambooApi } from "./serialize/bamboo-api";
import { serializeBambooReports } from "./serialize/bamboo-reports";
import { jsonFile, type FixtureFile } from "./serialize/files";

/** Fixed seeds: the committed fixtures are the output of exactly these. */
export const FIXTURE_SEEDS: Record<FixtureSize, number> = {
  small: 1001,
  demo: 2002,
};

export const FIXTURE_SIZES: readonly FixtureSize[] = ["small", "demo"];

function managerChangeCount(company: CompanyFixture): number {
  const rowsByEmployee = new Map<string, CompanyFixture["jobHistory"]>();
  for (const row of company.jobHistory) {
    rowsByEmployee.set(row.employeeId, [
      ...(rowsByEmployee.get(row.employeeId) ?? []),
      row,
    ]);
  }
  let changes = 0;
  for (const rows of rowsByEmployee.values()) {
    const ordered = [...rows].sort((a, b) => (a.date < b.date ? -1 : 1));
    for (let i = 1; i < ordered.length; i++) {
      if (ordered[i].managerId !== ordered[i - 1].managerId) changes++;
    }
  }
  return changes;
}

function manifest(company: CompanyFixture, apiFileCount: number): FixtureFile {
  const participants = company.assessments.filter((a) => a.employeeId !== null);
  return jsonFile(`bamboo/${company.size}/manifest.json`, {
    size: company.size,
    seed: company.seed,
    asOf: company.asOf,
    cycles: company.cycles.map((c) => c.name),
    pageLimit: SIZE_CONFIG[company.size].pageLimit,
    counts: {
      employees: company.employees.length,
      terminations: company.employees.filter((e) => e.terminationDate !== null).length,
      rehires: company.identity.persons.filter((p) => p.employeeIds.length > 1).length,
      managerChanges: managerChangeCount(company),
      jobInfoRows: company.jobHistory.length,
      employmentStatusRows: company.employmentHistory.length,
      goals: company.goals.length,
      assessments: participants.length,
      feedbackRequests: company.feedback.length,
      renames: company.identity.renames.length,
      misspelledNames: company.identity.misspellings.length,
      namesakePairs: company.identity.duplicateNames.length,
      outsiderRows: company.identity.outsiders.length,
      apiFiles: apiFileCount,
    },
  });
}

/** Every file of one size, with paths relative to the `fixtures/` root. */
export function fixtureFiles(
  size: FixtureSize,
  seed: number = FIXTURE_SEEDS[size],
): FixtureFile[] {
  const company = generateCompany({ size, seed });
  const api = serializeBambooApi(company);
  const reports = serializeBambooReports(company);
  return [
    ...api.map((f) => ({ ...f, path: `bamboo/${size}/${f.path}` })),
    manifest(company, api.length),
    ...reports.map((f) => ({ ...f, path: `bamboo-reports/${size}/${f.path}` })),
  ];
}

/**
 * Regenerates the fixtures of the given sizes under `rootDir`, deleting
 * whatever was there for those sizes first so no stale file survives.
 */
export function writeFixtures(
  rootDir: string,
  sizes: readonly FixtureSize[] = FIXTURE_SIZES,
): Record<string, number> {
  const written: Record<string, number> = {};
  for (const size of sizes) {
    rmSync(join(rootDir, "bamboo", size), { recursive: true, force: true });
    rmSync(join(rootDir, "bamboo-reports", size), { recursive: true, force: true });
    const files = fixtureFiles(size);
    for (const file of files) {
      const target = join(rootDir, file.path);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, file.content);
    }
    written[size] = files.length;
  }
  return written;
}
