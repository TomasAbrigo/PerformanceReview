import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createBambooClient } from "@/modules/bamboo-client";
import { BambooApiAdapter } from "./bamboo-api-adapter";
import { FixtureAdapter } from "./fixture-adapter";
import { payloadHash } from "./run-ingest";
import type { ExtractedRecord, SourceAdapter } from "./types";

const FIXTURES = path.resolve("src/modules/bamboo-client/__fixtures__");

const readFixture = (file: string) =>
  readFileSync(path.join(FIXTURES, file), "utf8");

function apiServingFixtures() {
  const requested: URL[] = [];
  const fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    requested.push(url);
    const aggregate = url.pathname.match(
      /^\/api\/v1_2\/performance\/employees\/(\d+)\/goals\/aggregate$/,
    );
    const comments = url.pathname.match(
      /^\/api\/v1\/performance\/employees\/\d+\/goals\/(\d+)\/comments$/,
    );
    try {
      if (aggregate) {
        return new Response(readFixture(`goals/${aggregate[1]}.json`));
      }
      if (comments) {
        return new Response(readFixture(`goal-comments/${comments[1]}.json`));
      }
    } catch {
      // fall through to 404
    }
    return new Response(null, { status: 404 });
  }) as typeof globalThis.fetch;
  return {
    adapter: new BambooApiAdapter(
      createBambooClient({ companyDomain: "acme", apiKey: "k", fetch }),
    ),
    requested,
  };
}

async function extractGoals(adapter: SourceAdapter, employeeIds: string[]) {
  const out: ExtractedRecord[] = [];
  for await (const r of adapter.extract({ employeeIds }, "goal")) out.push(r);
  return out;
}

describe("goal extraction", () => {
  it("FixtureAdapter yields one record per goal of the requested employees, ids as strings", async () => {
    const adapter = new FixtureAdapter(FIXTURES);

    const records = await extractGoals(adapter, ["101", "102"]);

    expect(adapter.entities).toContain("goal");
    expect(records.map((r) => r.sourceId)).toEqual([
      "9001",
      "9002",
      "9101",
      "9102",
      "9103",
      "9001",
    ]);
    expect(records[0].payload).toMatchObject({
      employeeId: "101",
      commentCount: 2,
      goal: { id: "9001", sharedWithEmployeeIds: ["102"] },
    });
    // Goals the aggregate gives no comment count for have none.
    expect(records[1].payload).toMatchObject({ commentCount: 0 });
  });

  it("does not read employees that were not requested, nor ones without a goals file", async () => {
    const adapter = new FixtureAdapter(FIXTURES);

    expect(await extractGoals(adapter, ["103"])).toHaveLength(1);
    expect(await extractGoals(adapter, [])).toEqual([]);
    expect(await extractGoals(adapter, ["999"])).toEqual([]);
    expect(
      (await extractGoals(adapter, ["101"])).map((r) => r.sourceId),
    ).not.toContain("9201");
  });

  it("loads comments on demand, mapping each author's user id to an employee id", async () => {
    const adapter = new FixtureAdapter(FIXTURES);
    const [goal] = await extractGoals(adapter, ["101"]);

    const comments = await goal.loadComments!();

    expect(comments).toEqual([
      expect.objectContaining({
        id: "7001",
        authorUserId: "8101",
        authorEmployeeId: "101",
        createdAt: "2026-10-05T10:00:00Z",
      }),
      expect.objectContaining({
        id: "7002",
        authorUserId: "8102",
        authorEmployeeId: "102",
      }),
    ]);
  });

  it("a goal with no comments file has no comments", async () => {
    const adapter = new FixtureAdapter(FIXTURES);
    const records = await extractGoals(adapter, ["101"]);
    const closed = records.find((r) => r.sourceId === "9002")!;

    expect(await closed.loadComments!()).toEqual([]);
  });

  it("BambooApiAdapter produces the same payloads as the FixtureAdapter", async () => {
    const { adapter } = apiServingFixtures();

    const api = await extractGoals(adapter, ["101", "102"]);
    const fixture = await extractGoals(new FixtureAdapter(FIXTURES), [
      "101",
      "102",
    ]);

    expect(adapter.entities).toContain("goal");
    expect(api.map((r) => payloadHash(r.payload))).toEqual(
      fixture.map((r) => payloadHash(r.payload)),
    );
    expect(await api[0].loadComments!()).toEqual(
      await fixture[0].loadComments!(),
    );
  });

  it("makes the comments request only when loadComments is called", async () => {
    const { adapter, requested } = apiServingFixtures();

    const records = await extractGoals(adapter, ["102"]);

    expect(requested.every((u) => u.pathname.endsWith("/aggregate"))).toBe(
      true,
    );
    await records.find((r) => r.sourceId === "9101")!.loadComments!();
    const last = requested.at(-1)!;
    expect(last.pathname).toBe(
      "/api/v1/performance/employees/102/goals/9101/comments",
    );
  });
});
