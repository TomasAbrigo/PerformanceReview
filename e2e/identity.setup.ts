import { execFileSync } from "node:child_process";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test as setup } from "@playwright/test";
import { REHIRE_ID } from "./identity-case";

const FIXTURES = "src/modules/bamboo-client/__fixtures__";

/**
 * Queues the rehire case for identity.spec.ts: one more employee run, with
 * Carla coming back as id 201. It runs once, after every spec that only reads
 * (project dependency), because the extra run would change what they count and
 * resolving the case changes Carla.
 */
setup("queue the rehire case", async () => {
  setup.setTimeout(120_000);
  const dir = await mkdtemp(path.join(tmpdir(), "identity-e2e-"));
  try {
    await cp(FIXTURES, dir, { recursive: true });
    const file = path.join(dir, "employees-page-2.json");
    const page = JSON.parse(await readFile(file, "utf8"));
    page.data.push({
      id: Number(REHIRE_ID),
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

    execFileSync(
      "pnpm",
      ["ingest", "employee", "--source", "fixture", "--dir", dir],
      { stdio: "inherit" },
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
