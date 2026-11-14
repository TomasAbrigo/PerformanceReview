import { copyFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { employeeJobHistory, person } from "@/db/schema";
import { generateCompany, type CompanyFixture } from "@/fixtures/company";
import { runIngest } from "@/modules/ingest/run-ingest";
import { DuckDbFileLake } from "@/modules/lake/duckdb-file-lake";
import { FileSourceAdapter } from "@/modules/lake/file-source-adapter";
import { getBuiltinProfile } from "@/modules/lake/profiles";

/** Shared setup of the historical import DB tests. */

export const REPORTS = path.resolve("fixtures/bamboo-reports/small");

export async function resetDb() {
  await db.execute(
    sql`TRUNCATE person, source_identity, employment, employee_job_history, raw_record, ingest_run, identity_match_issue, review_cycle CASCADE`,
  );
}

export type SeededCompany = {
  company: CompanyFixture;
  /** Bamboo employee id -> our person id. */
  personOf: Map<string, string>;
};

const fullName = (e: { firstName: string; lastName: string }) =>
  `${e.firstName} ${e.lastName}`;

/**
 * People and job history of the `small` company (seed 1001, the one the
 * report fixtures were generated from), written straight to the tables: one
 * person per human (rehires share one), named as they are today.
 */
export async function seedSmallCompany(): Promise<SeededCompany> {
  const company = generateCompany({ size: "small", seed: 1001 });
  const byId = new Map(company.employees.map((e) => [e.id, e]));
  const personOf = new Map<string, string>();
  for (const group of company.identity.persons) {
    const latest = byId.get(group.employeeIds[group.employeeIds.length - 1])!;
    const [row] = await db
      .insert(person)
      .values({ displayName: fullName(latest), workEmail: latest.workEmail })
      .returning({ id: person.id });
    for (const id of group.employeeIds) personOf.set(id, row.id);
  }

  const rows = [...company.jobHistory].sort((a, b) =>
    a.employeeId === b.employeeId
      ? a.date.localeCompare(b.date)
      : a.employeeId.localeCompare(b.employeeId),
  );
  const values = rows.map((r, i) => {
    const next = rows[i + 1];
    const end =
      next && next.employeeId === r.employeeId
        ? next.date
        : (byId.get(r.employeeId)?.terminationDate ?? null);
    return {
      personId: personOf.get(r.employeeId)!,
      validFrom: r.date,
      validTo: end,
      managerPersonId: r.managerId ? personOf.get(r.managerId)! : null,
      department: r.department,
      division: r.division,
      jobTitle: r.jobTitle,
      location: r.location,
      sourceSystem: "bamboo_api" as const,
      sourceId: r.id,
    };
  });
  await db.insert(employeeJobHistory).values(values).onConflictDoNothing();
  return { company, personOf };
}

/** Imports one report CSV through its built-in profile, in domain mode. */
export async function importReport(
  file: string,
  profileName = "bamboo-employee-performance",
) {
  const profile = getBuiltinProfile(profileName)!;
  const dir = await mkdtemp(path.join(tmpdir(), "history-import-"));
  try {
    await copyFile(file, path.join(dir, `${profile.table}.csv`));
    const lake = await DuckDbFileLake.open(dir);
    try {
      return await runIngest({
        adapter: new FileSourceAdapter(profile, lake, profile.table, {
          source: "bamboo_export",
        }),
        entity: profile.entity,
        db,
      });
    } finally {
      await lake.close();
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Writes a CSV (header + rows, already quoted) to a scratch file. */
export async function writeCsv(lines: string[]): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "history-csv-"));
  const file = path.join(dir, "report.csv");
  await writeFile(file, `${lines.join("\n")}\n`);
  return file;
}
