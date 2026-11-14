import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { generateCompany } from "@/fixtures/company";
import { FixtureAdapter } from "./fixture-adapter";
import type { Entity, ExtractedRecord } from "./types";

const SMALL = path.resolve("fixtures/bamboo/small");
const HAND_WRITTEN = path.resolve("src/modules/bamboo-client/__fixtures__");
const company = generateCompany({ size: "small", seed: 1001 });

async function extract(
  adapter: FixtureAdapter,
  entity: Entity,
  employeeIds?: string[],
) {
  const out: ExtractedRecord[] = [];
  for await (const r of adapter.extract({ employeeIds }, entity)) out.push(r);
  return out;
}

describe("FixtureAdapter on the generated layout (fixtures/bamboo/<size>)", () => {
  const adapter = new FixtureAdapter(SMALL);

  it("employees: one record per list entry, in list order, with the full record", async () => {
    const out = await extract(adapter, "employee");

    const ids = company.employees
      .map((e) => e.id)
      .sort((a, b) => Number(a) - Number(b));
    expect(out.map((r) => r.sourceId)).toEqual(ids);
    // The list item only has a summary: the payload is the get-employee file,
    // which has what the employee pipeline needs (supervisor, termination).
    const terminated = company.employees.find((e) => e.terminationDate)!;
    const payload = out.find((r) => r.sourceId === terminated.id)!.payload;
    expect(payload).toMatchObject({
      id: terminated.id,
      terminationDate: terminated.terminationDate,
      supervisorEId: terminated.managerId,
      status: "Inactive",
    });
  });

  it("employees: an employee without a get file falls back to its list item", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "fixture-adapter-"));
    try {
      await cp(SMALL, dir, { recursive: true });
      await rm(path.join(dir, "employees/get/11.json"));

      const out = await extract(new FixtureAdapter(dir), "employee");

      expect(out).toHaveLength(company.employees.length);
      expect(out.find((r) => r.sourceId === "11")!.payload).toMatchObject({
        employeeId: "11",
        id: "11",
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("employees: an off-type field in a list item does not drop the employee", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "fixture-adapter-"));
    try {
      await cp(SMALL, dir, { recursive: true });
      const file = path.join(dir, "employees/list/page-001.json");
      const page = JSON.parse(await readFile(file, "utf8"));
      page.data[0].firstName = { nested: true };
      await writeFile(file, JSON.stringify(page));

      const out = await extract(new FixtureAdapter(dir), "employee");

      expect(out.map((r) => r.sourceId)).toContain(page.data[0].employeeId);
      expect(out).toHaveLength(company.employees.length);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("employees: a list item with no id fails the extraction instead of vanishing", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "fixture-adapter-"));
    try {
      await cp(SMALL, dir, { recursive: true });
      const file = path.join(dir, "employees/list/page-001.json");
      const page = JSON.parse(await readFile(file, "utf8"));
      // No id here and no get-employee file to say who it is.
      await rm(path.join(dir, `employees/get/${page.data[1].employeeId}.json`));
      delete page.data[1].employeeId;
      await writeFile(file, JSON.stringify(page));

      await expect(
        extract(new FixtureAdapter(dir), "employee"),
      ).rejects.toThrow(/page-001\.json.*no id/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("job_history: the tables of all employees, grouped per employee", async () => {
    const out = await extract(adapter, "job_history");

    expect(out).toHaveLength(company.employees.length);
    const payloads = out.map(
      (r) => r.payload as { jobInfo: unknown[]; employmentStatus: unknown[] },
    );
    expect(payloads.flatMap((p) => p.jobInfo)).toHaveLength(
      company.jobHistory.length,
    );
    expect(payloads.flatMap((p) => p.employmentStatus)).toHaveLength(
      company.employmentHistory.length,
    );
  });

  it("goals: the aggregate of each employee; comments are counted but have no bodies", async () => {
    const owner = company.goals.find((g) => g.commentCount > 0)!;
    const mine = company.goals.filter((g) => g.employeeId === owner.employeeId);

    const out = await extract(adapter, "goal", [owner.employeeId]);

    expect(out.map((r) => r.sourceId).sort()).toEqual(
      mine.map((g) => g.id).sort(),
    );
    const withComments = out.find((r) => r.sourceId === owner.id)!;
    expect(withComments.payload).toMatchObject({
      employeeId: owner.employeeId,
      commentCount: owner.commentCount,
    });
    await expect(withComments.loadComments!()).resolves.toEqual([]);
  });

  it("goals: an employee without a file has no goals", async () => {
    expect(await extract(adapter, "goal", ["999999"])).toEqual([]);
  });
});

describe("FixtureAdapter on the hand-written flat layout", () => {
  let dir: string | undefined;
  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it("still reads employees, tables and goals from a directory of loose files", async () => {
    const adapter = new FixtureAdapter(HAND_WRITTEN);

    expect((await extract(adapter, "employee")).map((r) => r.sourceId)).toEqual(
      ["101", "102", "103"],
    );
    expect(
      (await extract(adapter, "job_history")).map((r) => r.sourceId),
    ).toEqual(["101", "102", "103"]);
    expect(
      (await extract(adapter, "goal", ["101"])).map((r) => r.sourceId).sort(),
    ).toEqual(["9001", "9002"]);
  });

  it("an empty directory has no employees", async () => {
    dir = await mkdtemp(path.join(tmpdir(), "fixture-adapter-empty-"));
    expect(await extract(new FixtureAdapter(dir), "employee")).toEqual([]);
  });
});
