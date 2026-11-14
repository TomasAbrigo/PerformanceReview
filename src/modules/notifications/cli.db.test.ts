import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, db } from "@/db/client";
import { notification, reviewCycle } from "@/db/schema";
import { runNotificationsCli } from "./cli";
import {
  collectingCycle,
  resetAll,
  seedPeople,
  type Seed,
} from "./test-support";

let seed: Seed;

beforeAll(async () => {
  await resetAll();
  seed = await seedPeople();
});

afterAll(async () => {
  await resetAll();
  await closeDb();
});

beforeEach(async () => {
  await db.delete(reviewCycle);
  await db.delete(notification);
});

function run(
  argv: string[],
  env: Record<string, string | undefined> = { DATABASE_URL: "x" },
) {
  const out: string[] = [];
  const err: string[] = [];
  return runNotificationsCli(argv, {
    db,
    env,
    requireEnv: ["DATABASE_URL"],
    stdout: (l) => out.push(l),
    stderr: (l) => err.push(l),
  }).then((code) => ({ code, out: out.join("\n"), err: err.join("\n") }));
}

describe("runNotificationsCli", () => {
  it("creates the reminders due on --as-of and reports them", async () => {
    await collectingCycle(seed, [seed.ana, seed.bruno]);
    await db.delete(notification);
    const result = await run(["--as-of", "2022-07-08"]);
    expect(result.code).toBe(0);
    expect(result.out).toContain("2022-07-08");
    expect(result.out).toMatch(/created\s*[=:]?\s*2/);
    expect(await db.select().from(notification)).toHaveLength(2);
  });

  it("is idempotent: the second run the same day creates nothing", async () => {
    await collectingCycle(seed, [seed.ana, seed.bruno]);
    await db.delete(notification);
    await run(["--as-of", "2022-07-08"]);
    const second = await run(["--as-of", "2022-07-08"]);
    expect(second.code).toBe(0);
    expect(second.out).toMatch(/created\s*[=:]?\s*0/);
    expect(await db.select().from(notification)).toHaveLength(2);
  });

  it("exits 2 with the usage on bad arguments, creating nothing", async () => {
    await collectingCycle(seed, [seed.ana]);
    await db.delete(notification);
    const result = await run(["--as-of", "2022-02-30"]);
    expect(result.code).toBe(2);
    expect(result.err).toContain("--as-of");
    expect(result.err).toContain("Usage");
    expect(await db.select().from(notification)).toHaveLength(0);
  });

  it("exits 2 when DATABASE_URL is missing", async () => {
    const result = await run([], {});
    expect(result.code).toBe(2);
    expect(result.err).toContain("DATABASE_URL");
  });

  it("prints the usage for --help", async () => {
    const result = await run(["--help"]);
    expect(result.code).toBe(0);
    expect(result.out).toContain("pnpm notifications:run");
  });
});
