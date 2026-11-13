import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { FixtureAdapter, runIngest } from "@/modules/ingest";

/** Shared setup for the identity DB tests: a scratch copy of the fixtures. */
const FIXTURES = path.resolve("src/modules/bamboo-client/__fixtures__");

export type Page = { data: Record<string, unknown>[] };

export async function resetDb() {
  await db.execute(
    sql`TRUNCATE source_identity, employment, person, raw_record, ingest_run, identity_match_issue CASCADE`,
  );
}

export async function makeFixtureDir() {
  const dir = await mkdtemp(path.join(tmpdir(), "identity-"));
  await cp(FIXTURES, dir, { recursive: true });
  return dir;
}

export const removeDir = (dir: string) =>
  rm(dir, { recursive: true, force: true });

export async function editPage(
  dir: string,
  file: string,
  edit: (page: Page) => void,
) {
  const p = path.join(dir, file);
  const page = JSON.parse(await readFile(p, "utf8"));
  edit(page);
  await writeFile(p, JSON.stringify(page));
}

/** Adds an employee to the second fixture page. */
export const addEmployee = (dir: string, employee: Record<string, unknown>) =>
  editPage(dir, "employees-page-2.json", (page) => {
    page.data.push(employee);
  });

export const ingest = (
  dir: string,
  options: { unmatched?: "create" | "queue" } = {},
) =>
  runIngest({
    adapter: new FixtureAdapter(dir),
    entity: "employee",
    db,
    ...options,
  });

/** Carla (id 103, legajo 0003) coming back under a new Bamboo id. */
export const carlaRehire = (overrides: Record<string, unknown> = {}) => ({
  id: 201,
  employeeNumber: "0003",
  displayName: "Carla Romero",
  workEmail: "carla.romero@example.com",
  status: "Active",
  hireDate: "2025-03-01",
  terminationDate: null,
  ...overrides,
});
