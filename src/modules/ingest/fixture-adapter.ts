import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import {
  parseGoalComments,
  parseGoalsAggregate,
} from "@/modules/bamboo-client";
import {
  listEmployeeSchema,
  tableRowSchema,
} from "@/modules/bamboo-client/schemas";
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
 * Where a directory of saved Bamboo responses keeps each one. Two layouts:
 *
 * - **generated** (`fixtures/bamboo/<size>/`, written by `pnpm fixtures:build`):
 *   the paths mirror the API (`employees/list/page-NNN.json`,
 *   `employees/get/<id>.json`, `employees/tables/<table>/all.json`,
 *   `performance/goals/<employeeId>.json`). Its list items are a summary
 *   (no supervisorEId, no terminationDate), so the employee payload is the
 *   get-employee file. It has no comment bodies, only the counts in each
 *   aggregate.
 * - **flat** (`src/modules/bamboo-client/__fixtures__`, hand-written for the
 *   edge cases of the tests): everything at the top level or one folder down.
 *   Its list items are complete; get-employee files only add what the pages
 *   lack.
 */
type Layout = {
  /** JSON files that may hold list pages or get-employee bodies, in reading order. */
  employeeFiles: (dir: string) => Promise<string[]>;
  /** Which one is the payload of an employee that has both a list item and a get file. */
  employeePayload: "list" | "get";
  table: (table: string) => string;
  goals: (employeeId: string) => string;
  /** Null: this layout has no comment bodies. */
  comments: ((goalId: string) => string) | null;
};

const jsonFilesIn = async (dir: string, ...sub: string[]) => {
  try {
    return (await readdir(path.join(dir, ...sub)))
      .filter((f) => f.endsWith(".json"))
      .sort()
      .map((f) => path.join(...sub, f));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
};

const GENERATED: Layout = {
  employeeFiles: async (dir) => [
    ...(await jsonFilesIn(dir, "employees", "list")),
    ...(await jsonFilesIn(dir, "employees", "get")),
  ],
  employeePayload: "get",
  table: (table) => path.join("employees", "tables", table, "all.json"),
  goals: (employeeId) =>
    path.join("performance", "goals", `${employeeId}.json`),
  comments: null,
};

const FLAT: Layout = {
  employeeFiles: (dir) => jsonFilesIn(dir),
  employeePayload: "list",
  table: (table) => `tables-${table}.json`,
  goals: (employeeId) => path.join("goals", `${employeeId}.json`),
  comments: (goalId) => path.join("goal-comments", `${goalId}.json`),
};

const isDirectory = (p: string) =>
  stat(p).then(
    (s) => s.isDirectory(),
    () => false,
  );

/**
 * Reads Bamboo API responses saved as JSON files in `dir` (see `Layout` for
 * the two layouts it understands; the generated one is detected by its
 * `employees/` directory).
 *
 * `employee`: list-employees pages (`{ data: [...] }`, items keyed by `id` or
 * `employeeId`) say which employees exist, in which order; get-employee files
 * (`{ id, ... }`) are the payload where the layout says so, and add the ids
 * the pages lack. Other shapes (e.g. the changed feed) are ignored.
 *
 * `job_history`: the jobInfo and employmentStatus tables (responses of
 * /employees/all/tables/{table}), grouped per employee.
 *
 * `goal`: the aggregate response of each employee in `ctx.employeeIds` and
 * the comments of a goal; a missing file means no goals / no comments.
 */
export class FixtureAdapter implements SourceAdapter {
  readonly source = "bamboo_api" as const;
  readonly name = "fixture";
  readonly entities = ["employee", "job_history", "goal"] as const;

  private layoutPromise?: Promise<Layout>;

  constructor(readonly dir: string) {}

  private layout(): Promise<Layout> {
    this.layoutPromise ??= isDirectory(path.join(this.dir, "employees")).then(
      (generated) => (generated ? GENERATED : FLAT),
    );
    return this.layoutPromise;
  }

  /** A saved response; `{}` when the file does not exist. */
  private async readJson(file: string): Promise<unknown> {
    try {
      return JSON.parse(await readFile(path.join(this.dir, file), "utf8"));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return {};
      throw err;
    }
  }

  private readonly goalSource: GoalSource = {
    getGoalsAggregate: async (employeeId) =>
      parseGoalsAggregate(
        await this.readJson((await this.layout()).goals(employeeId)),
      ),
    getGoalComments: async (_employeeId, goalId) => {
      const file = (await this.layout()).comments?.(goalId);
      return parseGoalComments(file ? await this.readJson(file) : {});
    },
  };

  private async readTable(table: string): Promise<unknown[]> {
    const body = await this.readJson((await this.layout()).table(table));
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
    const layout = await this.layout();
    const fromPages = new Map<string, Json>();
    const singles = new Map<string, Json>();
    for (const file of await layout.employeeFiles(this.dir)) {
      const body = await this.readJson(file);
      if (isObject(body) && Array.isArray(body.data)) {
        // Items go through the same schema as the API client's (employeeId
        // → id); one that has no id at all is skipped.
        for (const raw of body.data) {
          const item = listEmployeeSchema.safeParse(raw);
          // An item nobody can identify cannot be ingested or rejected by id;
          // skipping it would also leave that employee out of `seen`, and a
          // full run would soft-delete them. Fail the extraction instead.
          if (!item.success) {
            throw new Error(
              `${file}: employee list item has no id (neither id nor employeeId)`,
            );
          }
          fromPages.set(String(item.data.id), item.data);
        }
      } else if (isObject(body) && body.id != null && !("employees" in body)) {
        singles.set(String(body.id), body);
      }
    }

    const extractedAt = new Date();
    for (const [sourceId, item] of fromPages) {
      const payload =
        layout.employeePayload === "get"
          ? (singles.get(sourceId) ?? item)
          : item;
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
