import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import {
  parseGoalComments,
  parseGoalsAggregate,
} from "@/modules/bamboo-client";
import { extractGoals, type GoalSource } from "./goals-extract";
import type {
  Entity,
  ExtractContext,
  ExtractedRecord,
  SourceAdapter,
} from "./types";

type Json = Record<string, unknown>;

const isObject = (v: unknown): v is Json =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Reads Bamboo API responses saved as JSON files in `dir` (top level).
 * List-employees pages (`{ data: [...] }`) are authoritative; single
 * get-employee files (`{ id, ... }`) only add ids missing from the pages.
 * Other shapes (e.g. the changed feed) are ignored.
 *
 * Goals: `goals/<employeeId>.json` is the aggregate response of an employee
 * and `goal-comments/<goalId>.json` the comments of a goal; a missing file
 * means no goals / no comments.
 */
export class FixtureAdapter implements SourceAdapter {
  readonly source = "bamboo_api" as const;
  readonly name = "fixture";
  readonly entities = ["employee", "goal"] as const;

  constructor(readonly dir: string) {}

  private async readJson(...parts: string[]): Promise<unknown> {
    try {
      return JSON.parse(await readFile(path.join(this.dir, ...parts), "utf8"));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return {};
      throw err;
    }
  }

  private readonly goalSource: GoalSource = {
    getGoalsAggregate: async (employeeId) =>
      parseGoalsAggregate(await this.readJson("goals", `${employeeId}.json`)),
    getGoalComments: async (_employeeId, goalId) =>
      parseGoalComments(await this.readJson("goal-comments", `${goalId}.json`)),
  };

  async *extract(
    ctx: ExtractContext,
    entity: Entity,
  ): AsyncIterable<ExtractedRecord> {
    if (entity === "goal") {
      yield* extractGoals(this.goalSource, ctx.employeeIds ?? []);
      return;
    }
    const files = (await readdir(this.dir))
      .filter((f) => f.endsWith(".json"))
      .sort();

    const fromPages = new Map<string, Json>();
    const singles = new Map<string, Json>();
    for (const file of files) {
      const body: unknown = JSON.parse(
        await readFile(path.join(this.dir, file), "utf8"),
      );
      if (isObject(body) && Array.isArray(body.data)) {
        for (const e of body.data) {
          if (isObject(e) && e.id != null) fromPages.set(String(e.id), e);
        }
      } else if (isObject(body) && body.id != null && !("employees" in body)) {
        singles.set(String(body.id), body);
      }
    }

    const extractedAt = new Date();
    for (const [sourceId, payload] of fromPages) {
      yield { sourceId, payload, extractedAt };
    }
    for (const [sourceId, payload] of singles) {
      if (!fromPages.has(sourceId)) yield { sourceId, payload, extractedAt };
    }
  }
}
