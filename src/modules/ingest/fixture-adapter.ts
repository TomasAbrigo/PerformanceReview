import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type {
  Entity,
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
 */
export class FixtureAdapter implements SourceAdapter {
  readonly source = "bamboo_api" as const;
  readonly name = "fixture";
  readonly entities = ["employee", "job_history"] as const;

  constructor(readonly dir: string) {}

  private async readTable(table: string): Promise<Json[]> {
    let body: unknown;
    try {
      body = JSON.parse(
        await readFile(path.join(this.dir, `tables-${table}.json`), "utf8"),
      );
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw err;
    }
    return Array.isArray(body) ? body.filter(isObject) : [];
  }

  extract(_ctx: unknown, entity: Entity): AsyncIterable<ExtractedRecord> {
    if (entity === "job_history") return this.extractJobHistory();
    if (entity === "employee") return this.extractEmployees();
    throw new Error(`Unsupported entity ${entity}`);
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

/** Table rows of all employees → one payload per employee, sorted by id. */
export function groupTables(
  jobInfo: Json[],
  employmentStatus: Json[],
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
  for (const r of jobInfo) {
    if (r.employeeId != null) get(String(r.employeeId)).jobInfo.push(r);
  }
  for (const r of employmentStatus) {
    if (r.employeeId != null) {
      get(String(r.employeeId)).employmentStatus.push(r);
    }
  }
  return [...byEmployee.values()].sort(
    (a, b) =>
      Number(a.employeeId) - Number(b.employeeId) ||
      a.employeeId.localeCompare(b.employeeId),
  );
}
