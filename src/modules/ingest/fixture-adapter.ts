import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import {
  parseGoalComments,
  parseGoalsAggregate,
} from "@/modules/bamboo-client";
import { tableRowSchema } from "@/modules/bamboo-client/schemas";
import { extractGoals, type GoalSource } from "./goals-extract";
import type {
  Entity,
  ExtractContext,
  ExtractedRecord,
  JobHistoryPayload,
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
 * `job_history` reads `tables-jobInfo.json` and `tables-employmentStatus.json`
 * (responses of /employees/all/tables/{table}), grouped per employee.
 *
 * `goal`: `goals/<employeeId>.json` is the aggregate response of an employee
 * and `goal-comments/<goalId>.json` the comments of a goal; a missing file
 * means no goals / no comments.
 */
export class FixtureAdapter implements SourceAdapter {
  readonly source = "bamboo_api" as const;
  readonly name = "fixture";
  readonly entities = ["employee", "job_history", "goal"] as const;

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

  private async readTable(table: string): Promise<unknown[]> {
    let body: unknown;
    try {
      body = JSON.parse(
        await readFile(path.join(this.dir, `tables-${table}.json`), "utf8"),
      );
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw err;
    }
    return Array.isArray(body) ? body : [];
  }

  extract(ctx: ExtractContext, entity: Entity): AsyncIterable<ExtractedRecord> {
    if (entity === "job_history") return this.extractJobHistory();
    if (entity === "employee") return this.extractEmployees();
    if (entity === "goal") {
      return extractGoals(this.goalSource, ctx.employeeIds ?? [], ctx.onSkip);
    }
    throw new Error(`Unsupported entity ${String(entity)}`);
  }

  private async *extractJobHistory(): AsyncIterable<ExtractedRecord> {
    const extractedAt = new Date();
    for (const payload of groupTables(
      await this.readTable("jobInfo"),
      await this.readTable("employmentStatus"),
    )) {
      yield { sourceId: payload.employeeId, payload, extractedAt };
    }
  }

  private async *extractEmployees(): AsyncIterable<ExtractedRecord> {
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

/**
 * Table rows of all employees → one payload per employee, sorted by id. Rows
 * go through tableRowSchema (ids as strings, other fields untouched) so the
 * API and fixture adapters hash the same data identically; rows without an
 * id/employeeId are dropped.
 */
export function groupTables(
  jobInfo: unknown[],
  employmentStatus: unknown[],
): JobHistoryPayload[] {
  const byEmployee = new Map<string, JobHistoryPayload>();
  const get = (id: string) => {
    let p = byEmployee.get(id);
    if (!p) {
      p = { employeeId: id, jobInfo: [], employmentStatus: [] };
      byEmployee.set(id, p);
    }
    return p;
  };
  for (const raw of jobInfo) {
    const r = tableRowSchema.safeParse(raw);
    if (r.success) get(r.data.employeeId).jobInfo.push(r.data);
  }
  for (const raw of employmentStatus) {
    const r = tableRowSchema.safeParse(raw);
    if (r.success) get(r.data.employeeId).employmentStatus.push(r.data);
  }
  return [...byEmployee.values()].sort(
    (a, b) =>
      Number(a.employeeId) - Number(b.employeeId) ||
      a.employeeId.localeCompare(b.employeeId),
  );
}
