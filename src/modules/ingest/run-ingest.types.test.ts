import { describe, expect, it } from "vitest";
import { db } from "@/db/client";
import type { BambooApiAdapter } from "./bamboo-api-adapter";
import type { FixtureAdapter } from "./fixture-adapter";
import { runIngest } from "./run-ingest";
import type { Entity, SourceAdapter } from "./types";

/**
 * Compile-time checks (`pnpm typecheck` fails if an expectation is wrong): an
 * adapter can only be run for an entity it reads.
 */
describe("runIngest typing", () => {
  it("takes an adapter and an entity that agree, and refuses the rest", () => {
    // Never called: it is only type-checked.
    const compileOnly = async (
      fixture: FixtureAdapter,
      bamboo: BambooApiAdapter,
      generic: SourceAdapter,
      entity: Entity,
    ) => {
      await runIngest({ adapter: fixture, entity: "employee", db });
      await runIngest({ adapter: bamboo, entity: "job_history", db });
      await runIngest({ adapter: generic, entity, db });
      // @ts-expect-error a Bamboo adapter does not read assessments
      await runIngest({ adapter: bamboo, entity: "assessment", db });
      await runIngest({
        adapter: bamboo,
        // @ts-expect-error not even in landing mode
        entity: "feedback",
        landing: true,
        db,
      });
      // @ts-expect-error the fixture adapter neither
      await runIngest({ adapter: fixture, entity: "assessment", db });
    };
    expect(compileOnly).toBeTypeOf("function");
  });
});
