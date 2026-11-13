import { execFileSync } from "node:child_process";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test as setup } from "@playwright/test";
import postgres from "postgres";

try {
  process.loadEnvFile(".env.local");
} catch {
  // rely on the real environment (CI)
}

const FIXTURES = "src/modules/bamboo-client/__fixtures__";

const ingest = (from: string) =>
  execFileSync(
    "pnpm",
    ["ingest:employees", "--source", "fixture", "--dir", from],
    { stdio: "inherit" },
  );

/**
 * Runs once per `playwright test`, before any spec (project dependency), so the
 * specs never race each other over the shared database.
 *
 * Carla (Bamboo id 103, legajo 0003, terminated) comes back as id 201 with the
 * same legajo and email: the import must ask before linking it to her.
 */
setup("seed the rehire case for the identity queue", async () => {
  setup.setTimeout(180_000);

  const sql = postgres(process.env.DATABASE_URL ?? "", { max: 1 });
  try {
    // Leftovers from a previous run against this database.
    await sql`DELETE FROM identity_match_issue WHERE source_id = '201'`;
    await sql`DELETE FROM employment WHERE source_id = '201'`;
    await sql`DELETE FROM source_identity WHERE kind = 'bamboo_id' AND value = '201'`;
    await sql`DELETE FROM raw_record WHERE source_id = '201'`;
  } finally {
    await sql.end();
  }

  const dir = await mkdtemp(path.join(tmpdir(), "identity-e2e-"));
  try {
    await cp(FIXTURES, dir, { recursive: true });
    const file = path.join(dir, "employees-page-2.json");
    const page = JSON.parse(await readFile(file, "utf8"));
    page.data.push({
      id: 201,
      employeeNumber: "0003",
      firstName: "Carla",
      lastName: "Romero",
      displayName: "Carla Romero",
      workEmail: "carla.romero@example.com",
      status: "Active",
      hireDate: "2025-03-01",
      terminationDate: null,
    });
    await writeFile(file, JSON.stringify(page));

    ingest(FIXTURES);
    ingest(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
