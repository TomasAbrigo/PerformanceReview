import { execFileSync } from "node:child_process";
import {
  cp,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test as setup } from "@playwright/test";
import { laterRehire } from "./seed-data";

const FIXTURES = "fixtures/bamboo/small";

/**
 * Queues a rehire that arrives in a LATER run (identity-later.spec.ts): one
 * more `pnpm ingest employee` over the seeded database, with someone who left
 * coming back under a new Bamboo id (same legajo and email). It runs once,
 * after every spec that only reads (project dependency), because the extra
 * run would change what they count.
 */
setup("a rehire arrives in a later run", async () => {
  setup.setTimeout(120_000);
  const { earlier, later } = laterRehire();
  const dir = await mkdtemp(path.join(tmpdir(), "identity-e2e-"));
  try {
    await cp(FIXTURES, dir, { recursive: true });

    // The record, as a get-employee file (the employee payload)...
    const get = JSON.parse(
      await readFile(
        path.join(dir, `employees/get/${earlier.id}.json`),
        "utf8",
      ),
    );
    const record = {
      ...get,
      id: later.id,
      status: "Active",
      hireDate: "2026-10-15",
      terminationDate: null,
    };
    await writeFile(
      path.join(dir, `employees/get/${later.id}.json`),
      JSON.stringify(record),
    );

    // ...and as a list item on the last page.
    const pages = (await readdir(path.join(dir, "employees/list"))).sort();
    const last = path.join(dir, "employees/list", pages.at(-1)!);
    const page = JSON.parse(await readFile(last, "utf8"));
    page.data.push({
      employeeId: later.id,
      firstName: record.firstName,
      lastName: record.lastName,
      status: "Active",
      workEmail: record.workEmail,
      employeeNumber: record.employeeNumber,
      hireDate: record.hireDate,
    });
    await writeFile(last, JSON.stringify(page));

    execFileSync(
      "pnpm",
      ["ingest", "employee", "--source", "fixture", "--dir", dir],
      { stdio: "inherit" },
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
