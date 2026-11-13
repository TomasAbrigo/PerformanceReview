import { describe, expect, it, vi } from "vitest";
import type { Database } from "@/db/client";
import {
  parseIngestArgs,
  runIngestCli,
  UsageError,
  type IngestCliDeps,
} from "./cli";
import { DEFAULT_FIXTURES_DIR, REGISTRY, type EntityEntry } from "./registry";
import * as goalsModule from "@/modules/goals";
import { entityHandlers } from "./handlers";
import * as runIngestModule from "./run-ingest";
import { IngestRunError } from "./run-ingest";
import type { SourceAdapter } from "./types";

const counts = {
  read: 3,
  inserted: 2,
  updated: 1,
  unchanged: 0,
  rejected: 0,
  deleted: 0,
};

const adapterOf = (name: string): SourceAdapter => ({
  source: "bamboo_api",
  name,
  entities: ["employee"],
  async *extract() {
    return;
  },
});

/** A registry entry whose runs are controlled by the test. */
function entry(
  run: EntityEntry["run"] = async () => ({ runId: "run-1", counts }),
): EntityEntry & { run: ReturnType<typeof vi.fn> } {
  return {
    adapters: {
      fixture: () => adapterOf("fixture"),
      bamboo: () => adapterOf("bamboo"),
    },
    run: vi.fn(run),
  };
}

function setup(
  entries: Record<string, EntityEntry>,
  overrides: Partial<IngestCliDeps> = {},
) {
  const out: string[] = [];
  const err: string[] = [];
  const deps: IngestCliDeps = {
    db: {} as Database,
    registry: new Map(Object.entries(entries)),
    env: {},
    stdout: (line) => out.push(line),
    stderr: (line) => err.push(line),
    ...overrides,
  };
  return {
    deps,
    out,
    err,
    stdout: () => out.join("\n"),
    stderr: () => err.join("\n"),
  };
}

const registry = new Map<string, EntityEntry>([
  ["employee", entry()],
  ["job_history", entry()],
]);

describe("parseIngestArgs", () => {
  it("parses an entity with a source", () => {
    expect(
      parseIngestArgs(["employee", "--source", "fixture"], registry),
    ).toEqual({
      entities: ["employee"],
      source: "fixture",
      dir: DEFAULT_FIXTURES_DIR,
      since: undefined,
    });
  });

  it("--all means every registered entity, in registry order", () => {
    expect(
      parseIngestArgs(["--all", "--source", "bamboo"], registry).entities,
    ).toEqual(["employee", "job_history"]);
  });

  it("takes --dir and normalizes --since to an ISO instant", () => {
    const parsed = parseIngestArgs(
      [
        "employee",
        "--source",
        "fixture",
        "--dir",
        "/tmp/x",
        "--since",
        "2026-11-01T10:00:00+02:00",
      ],
      registry,
    );
    expect(parsed).toMatchObject({
      dir: "/tmp/x",
      since: "2026-11-01T08:00:00.000Z",
    });
  });

  it.each([
    ["a date", "2026-11-01", "2026-11-01T00:00:00.000Z"],
    ["an instant in UTC", "2026-11-01T10:00Z", "2026-11-01T10:00:00.000Z"],
    [
      "an instant with fractions and an offset",
      "2026-11-01T10:00:00.5-03:00",
      "2026-11-01T13:00:00.500Z",
    ],
  ])("accepts --since as %s", (_name, value, iso) => {
    expect(
      parseIngestArgs(
        ["employee", "--source", "fixture", "--since", value],
        registry,
      ).since,
    ).toBe(iso);
  });

  it.each([
    ["a bare number", "5"],
    ["a year", "2026"],
    ["a timestamp in milliseconds", "1793000000000"],
    ["a word", "tomorrow"],
    ["a day that does not exist", "2026-02-30"],
    ["a month that does not exist", "2026-13-01"],
    ["an hour that does not exist", "2026-11-01T25:00:00Z"],
    ["a time without an offset (local time is ambiguous)", "2026-11-01T10:00"],
    ["a space instead of the T", "2026-11-01 10:00:00Z"],
    ["an empty value", ""],
  ])("rejects --since as %s", (_name, value) => {
    const argv = ["employee", "--source", "fixture", "--since", value];
    expect(() => parseIngestArgs(argv, registry)).toThrow(UsageError);
    expect(() => parseIngestArgs(argv, registry)).toThrow(/--since/);
  });

  it("accepts --since last to continue from the stored watermark", () => {
    expect(
      parseIngestArgs(
        ["employee", "--source", "fixture", "--since", "last"],
        registry,
      ).since,
    ).toBe("last");
  });

  it.each([
    ["no entity and no --all", ["--source", "fixture"], /entity/i],
    [
      "both an entity and --all",
      ["employee", "--all", "--source", "fixture"],
      /either/i,
    ],
    [
      "two entities",
      ["employee", "goal", "--source", "fixture"],
      /one entity/i,
    ],
    [
      "an unknown entity",
      ["salary", "--source", "fixture"],
      /salary[\s\S]*employee/,
    ],
    ["a missing source", ["employee"], /--source/],
    [
      "an unsupported source",
      ["employee", "--source", "file"],
      /fixture|bamboo/,
    ],
    [
      "an invalid --since",
      ["employee", "--source", "fixture", "--since", "yesterday"],
      /--since/,
    ],
    ["an unknown flag", ["employee", "--source", "fixture", "--nope"], /nope/],
  ])("rejects %s", (_name, argv, message) => {
    expect(() => parseIngestArgs(argv, registry)).toThrow(UsageError);
    expect(() => parseIngestArgs(argv, registry)).toThrow(message);
  });
});

describe("REGISTRY", () => {
  it("has the handler entities and goal, dependencies first", () => {
    expect([...REGISTRY.keys()]).toEqual([
      ...Object.keys(entityHandlers),
      "goal",
    ]);
    // job_history and goal resolve people through employee ingestion.
    expect([...REGISTRY.keys()]).toEqual(["employee", "job_history", "goal"]);
  });

  it("runs a handler entity through runIngest with the adapter's entity and since", async () => {
    const adapter = adapterOf("fixture");
    const ran = vi.spyOn(runIngestModule, "runIngest").mockResolvedValue({
      runId: "run-9",
      counts,
    });
    try {
      const result = await REGISTRY.get("job_history")!.run({
        adapter,
        db: {} as Database,
        params: { source: "fixture" },
        since: "2026-11-01T00:00:00.000Z",
      });

      expect(result.runId).toBe("run-9");
      expect(ran).toHaveBeenCalledWith({
        adapter,
        entity: "job_history",
        db: {},
        params: { source: "fixture" },
        extract: { since: "2026-11-01T00:00:00.000Z" },
      });
    } finally {
      ran.mockRestore();
    }
  });

  it("runs goal through its own pipeline (a full read, so no since)", async () => {
    const adapter = adapterOf("fixture");
    const ran = vi.spyOn(goalsModule, "runGoalIngest").mockResolvedValue({
      runId: "run-10",
      counts,
    });
    try {
      const result = await REGISTRY.get("goal")!.run({
        adapter,
        db: {} as Database,
        params: { source: "fixture" },
        since: "2026-11-01T00:00:00.000Z",
      });

      expect(result.runId).toBe("run-10");
      expect(ran).toHaveBeenCalledWith({
        adapter,
        db: {},
        params: { source: "fixture" },
      });
    } finally {
      ran.mockRestore();
    }
  });
});

describe("runIngestCli", () => {
  it("runs the entity with the chosen adapter and prints a summary table", async () => {
    const employee = entry();
    const t = setup({ employee });

    const code = await runIngestCli(
      ["employee", "--source", "fixture"],
      t.deps,
    );

    expect(code).toBe(0);
    expect(employee.run).toHaveBeenCalledTimes(1);
    const input = employee.run.mock.calls[0][0];
    expect(input.adapter.name).toBe("fixture");
    expect(input.params).toEqual({
      source: "fixture",
      dir: DEFAULT_FIXTURES_DIR,
    });
    expect(input.since).toBeUndefined();

    const [header, row] = t.stdout().split("\n");
    expect(header.split(/\s+/)).toEqual([
      "entity",
      "adapter",
      "status",
      "read",
      "inserted",
      "updated",
      "unchanged",
      "deleted",
      "rejected",
      "duration",
      "run",
    ]);
    expect(row.split(/\s+/).slice(0, 9)).toEqual([
      "employee",
      "fixture",
      "succeeded",
      "3",
      "2",
      "1",
      "0",
      "0",
      "0",
    ]);
    expect(row).toContain("run-1");
    expect(t.stderr()).toBe("");
  });

  it("--all runs every entity in registry order and keeps going after a failure", async () => {
    const order: string[] = [];
    const employee = entry(async () => {
      order.push("employee");
      throw new IngestRunError("connection reset", "run-bad", counts);
    });
    const jobHistory = entry(async () => {
      order.push("job_history");
      return { runId: "run-2", counts };
    });
    const t = setup({ employee, job_history: jobHistory });

    const code = await runIngestCli(["--all", "--source", "fixture"], t.deps);

    expect(order).toEqual(["employee", "job_history"]);
    expect(code).toBe(1);
    expect(t.stdout()).toMatch(/employee\s+fixture\s+error/);
    expect(t.stdout()).toMatch(/job_history\s+fixture\s+succeeded/);
    expect(t.stderr()).toContain("employee");
    expect(t.stderr()).toContain("connection reset");
    expect(t.stderr()).toContain("run-bad");
  });

  it("a source that cannot be configured exits 2 before running anything", async () => {
    const employee = entry();
    const jobHistory = {
      ...entry(),
      adapters: {
        fixture: () => {
          throw new Error("fixtures directory missing");
        },
        bamboo: () => adapterOf("bamboo"),
      },
    };
    const t = setup({ employee, job_history: jobHistory });

    const code = await runIngestCli(["--all", "--source", "fixture"], t.deps);

    expect(code).toBe(2);
    expect(t.stderr()).toContain("fixtures directory missing");
    // Not a "run failed": nothing was attempted, not even the entity whose
    // adapter was fine.
    expect(employee.run).not.toHaveBeenCalled();
    expect(t.stdout()).toBe("");
  });

  it("a missing required variable exits 2 and runs nothing", async () => {
    const employee = entry();
    const t = setup(
      { employee },
      { env: { OTHER: "x" }, requireEnv: ["DATABASE_URL"] },
    );

    const code = await runIngestCli(
      ["employee", "--source", "fixture"],
      t.deps,
    );

    expect(code).toBe(2);
    expect(t.stderr()).toContain("DATABASE_URL");
    expect(employee.run).not.toHaveBeenCalled();
  });

  it("--help does not need the environment", async () => {
    const t = setup({ employee: entry() }, { requireEnv: ["DATABASE_URL"] });
    expect(await runIngestCli(["--help"], t.deps)).toBe(0);
  });

  it("a usage error exits 2, prints the usage and runs nothing", async () => {
    const employee = entry();
    const t = setup({ employee });

    const code = await runIngestCli(["salary", "--source", "fixture"], t.deps);

    expect(code).toBe(2);
    expect(employee.run).not.toHaveBeenCalled();
    expect(t.stderr()).toContain("salary");
    expect(t.stderr()).toContain("Usage");
  });

  it("--help prints the usage and exits 0", async () => {
    const t = setup({ employee: entry() });
    expect(await runIngestCli(["--help"], t.deps)).toBe(0);
    expect(t.stdout()).toContain("Usage");
    expect(t.stdout()).toContain("employee");
  });

  it("bamboo needs credentials: without them it exits 2 and says which", async () => {
    const t = setup({}, { registry: REGISTRY, env: {} });

    const code = await runIngestCli(["employee", "--source", "bamboo"], t.deps);

    expect(code).toBe(2);
    expect(t.stderr()).toContain("BAMBOO_COMPANY_DOMAIN");
    expect(t.stderr()).toContain("BAMBOO_API_KEY");
    expect(t.stdout()).toBe("");
  });

  it("--since last continues from the stored watermark of that source and entity", async () => {
    const employee = entry();
    const readWatermark = vi.fn(async () => "2026-11-10T00:00:00.000Z");
    const t = setup({ employee }, { readWatermark });

    await runIngestCli(
      ["employee", "--source", "fixture", "--since", "last"],
      t.deps,
    );

    expect(readWatermark).toHaveBeenCalledWith({
      sourceSystem: "bamboo_api",
      adapter: "fixture",
      entity: "employee",
    });
    expect(employee.run.mock.calls[0][0].since).toBe(
      "2026-11-10T00:00:00.000Z",
    );
  });

  it("--since last without a stored watermark is a full run", async () => {
    const employee = entry();
    const t = setup({ employee }, { readWatermark: async () => null });

    await runIngestCli(
      ["employee", "--source", "fixture", "--since", "last"],
      t.deps,
    );

    expect(employee.run.mock.calls[0][0].since).toBeUndefined();
  });

  it("an explicit --since is passed through and kept in the run params", async () => {
    const employee = entry();
    const t = setup({ employee });

    await runIngestCli(
      ["employee", "--source", "fixture", "--since", "2026-11-01T00:00:00Z"],
      t.deps,
    );

    const input = employee.run.mock.calls[0][0];
    expect(input.since).toBe("2026-11-01T00:00:00.000Z");
  });

  it("serializes runs of the same entity through the lock", async () => {
    const events: string[] = [];
    const employee = entry(async () => {
      events.push("run");
      return { runId: "run-1", counts };
    });
    const lock = vi.fn(async (key: string, fn: () => Promise<unknown>) => {
      events.push(`lock ${key}`);
      const result = await fn();
      events.push(`unlock ${key}`);
      return result;
    });
    const t = setup({ employee }, { lock: lock as IngestCliDeps["lock"] });

    await runIngestCli(["employee", "--source", "fixture"], t.deps);

    expect(events).toEqual([
      "lock ingest:employee",
      "run",
      "unlock ingest:employee",
    ]);
  });
});
