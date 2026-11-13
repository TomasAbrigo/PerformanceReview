import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { sql } from "drizzle-orm";
import { db } from "@/db/client";

/** Shapes of the fixture files the goal DB tests edit in place. */
export type MilestoneJson = {
  id: number;
  employeeGoalId?: number;
  title: string;
  completedDateTime: string | null;
  lastUpdateDateTime?: string;
};

export type GoalJson = {
  id: string | number;
  title?: string;
  percentComplete?: number;
  status?: string;
  dueDate?: string | null;
  completionDate?: string | null;
  lastChangedDateTime?: string;
  sharedWithEmployeeIds?: number[];
  milestones?: MilestoneJson[] | null;
};

export type AggregateJson = {
  goals: GoalJson[];
  comments: { goalId: string | number; commentCount: number }[];
};

export type CommentsJson = {
  comments: {
    id: string | number;
    authorUserId: number;
    createdAt: string;
    text: string;
  }[];
};

export type EmployeesPageJson = { data: Record<string, unknown>[] };

/** Reads a JSON file of the fixture copy in `dir`, edits it and writes it back. */
export async function editJson<T>(
  dir: string,
  file: string,
  edit: (json: T) => void,
): Promise<void> {
  const p = path.join(dir, file);
  const json = JSON.parse(await readFile(p, "utf8")) as T;
  edit(json);
  await writeFile(p, JSON.stringify(json));
}

/** The goal with `id` in an aggregate file (throws if the fixture lacks it). */
export function goalOf(json: AggregateJson, id: string | number): GoalJson {
  const found = json.goals.find((g) => g.id === id);
  if (!found) throw new Error(`fixture has no goal ${id}`);
  return found;
}

/** Empties everything the goal tests touch (they share one database). */
export async function resetGoalTables(): Promise<void> {
  await db.execute(
    sql`TRUNCATE goal_share, goal_comment, goal_milestone, goal, source_identity, employment, person, raw_record, ingest_run CASCADE`,
  );
}
