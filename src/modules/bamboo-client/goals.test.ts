import { describe, expect, it, vi } from "vitest";
import comments9001 from "./__fixtures__/goal-comments/9001.json";
import aggregate101 from "./__fixtures__/goals/101.json";
import aggregate102 from "./__fixtures__/goals/102.json";
import { BambooError, createBambooClient } from "./index";

type Handler = (url: URL) => Response | Promise<Response>;

function fakeFetch(handler: Handler) {
  const calls: URL[] = [];
  const fn = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    calls.push(url);
    return handler(url);
  });
  return { fetch: fn as unknown as typeof fetch, calls };
}

const json = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });

const config = { companyDomain: "acme", apiKey: "secret-key" };

describe("getGoalsAggregate", () => {
  it("calls the v1_2 aggregate with filter=status-all", async () => {
    const { fetch, calls } = fakeFetch(() => json(aggregate101));
    const client = createBambooClient({ ...config, fetch });

    await client.getGoalsAggregate("101");

    expect(calls).toHaveLength(1);
    expect(calls[0].pathname).toBe(
      "/api/v1_2/performance/employees/101/goals/aggregate",
    );
    expect(calls[0].searchParams.get("filter")).toBe("status-all");
  });

  it("normalizes numeric ids to strings everywhere", async () => {
    const { fetch } = fakeFetch(() => json(aggregate101));
    const client = createBambooClient({ ...config, fetch });

    const { goals, comments, persons } = await client.getGoalsAggregate("101");

    const goal = goals.find((g) => g.title.startsWith("Definir"))!;
    // 9001 is numeric in the payload, 9002 a string: both come out as strings.
    expect(goals.map((g) => g.id)).toEqual(["9001", "9002"]);
    expect(goal.sharedWithEmployeeIds).toEqual(["102"]);
    expect(goal.alignsWithOptionId).toBe("12");
    expect(goal.milestones.map((m) => [m.id, m.employeeGoalId])).toEqual([
      ["5001", "9001"],
      ["5002", "9001"],
    ]);
    expect(goal.milestones[0].lastUpdateUserId).toBe("8101");
    expect(comments).toEqual([{ goalId: "9001", commentCount: 2 }]);
    expect(persons[0]).toMatchObject({ employeeId: "101", userId: "8101" });
  });

  it("returns goals without milestones (null, [] or absent) as an empty list", async () => {
    const { fetch } = fakeFetch(() => json(aggregate102));
    const client = createBambooClient({ ...config, fetch });

    const { goals } = await client.getGoalsAggregate("102");

    const byId = Object.fromEntries(goals.map((g) => [g.id, g]));
    expect(byId["9103"].milestones).toEqual([]); // null in the payload
    expect(byId["9102"].milestones).toEqual([]); // [] in the payload
    expect(byId["9103"].description).toBeNull();
  });

  it("accepts a goal whose milestones key is missing", async () => {
    const { fetch } = fakeFetch(() =>
      json({
        goals: [
          {
            id: 1,
            title: "No milestones key",
            percentComplete: 10,
            status: "in_progress",
          },
        ],
        persons: [],
        comments: [],
      }),
    );
    const client = createBambooClient({ ...config, fetch });

    const { goals } = await client.getGoalsAggregate("5");

    expect(goals[0]).toMatchObject({ id: "1", milestones: [] });
  });

  it("keeps the goal status, including closed goals, and unknown fields", async () => {
    const { fetch } = fakeFetch(() => json(aggregate101));
    const client = createBambooClient({ ...config, fetch });

    const { goals } = await client.getGoalsAggregate("101");

    expect(goals.find((g) => g.id === "9002")).toMatchObject({
      status: "closed",
      percentComplete: 60,
      lastChangedDateTime: "2026-07-01T09:00:00Z",
    });
    expect(goals[0]).toHaveProperty("actions");
  });

  it("treats a response without goals as an empty aggregate", async () => {
    const { fetch } = fakeFetch(() => json({ canAlign: false }));
    const client = createBambooClient({ ...config, fetch });

    expect(await client.getGoalsAggregate("7")).toMatchObject({
      goals: [],
      persons: [],
      comments: [],
    });
  });

  it("encodes the employee id and surfaces API errors", async () => {
    const { fetch, calls } = fakeFetch(
      () =>
        new Response(null, {
          status: 403,
          headers: { "X-BambooHR-Error-Message": "No goals access" },
        }),
    );
    const client = createBambooClient({ ...config, fetch });

    const error = await client.getGoalsAggregate("a/b").catch((e) => e);

    expect(calls[0].pathname).toBe(
      "/api/v1_2/performance/employees/a%2Fb/goals/aggregate",
    );
    expect(error).toBeInstanceOf(BambooError);
    expect(error).toMatchObject({ status: 403 });
  });

  it("rejects a goal with no id", async () => {
    const { fetch } = fakeFetch(() =>
      json({ goals: [{ title: "x", status: "closed" }] }),
    );
    const client = createBambooClient({ ...config, fetch });

    await expect(client.getGoalsAggregate("1")).rejects.toThrow();
  });
});

describe("getGoalComments", () => {
  it("reads the comments of a goal with normalized ids", async () => {
    const { fetch, calls } = fakeFetch(() => json(comments9001));
    const client = createBambooClient({ ...config, fetch });

    const comments = await client.getGoalComments("101", "9001");

    expect(calls[0].pathname).toBe(
      "/api/v1/performance/employees/101/goals/9001/comments",
    );
    expect(comments).toHaveLength(2);
    // 7002 is numeric in the payload.
    expect(comments.map((c) => c.id)).toEqual(["7001", "7002"]);
    expect(comments[0]).toMatchObject({
      authorUserId: "8101",
      text: "Avance del mapeo listo, falta validarlo con People.",
      createdAt: "2026-10-05T10:00:00Z",
    });
  });

  it("also accepts a bare array", async () => {
    const { fetch } = fakeFetch(() =>
      json([{ id: 1, authorUserId: 2, text: "hola", createdAt: null }]),
    );
    const client = createBambooClient({ ...config, fetch });

    expect(await client.getGoalComments("1", "2")).toEqual([
      { id: "1", authorUserId: "2", text: "hola", createdAt: null },
    ]);
  });

  it("returns [] when Bamboo sends no comments", async () => {
    const { fetch } = fakeFetch(() => json({}));
    const client = createBambooClient({ ...config, fetch });

    expect(await client.getGoalComments("1", "2")).toEqual([]);
  });
});
