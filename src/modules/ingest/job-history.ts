import { and, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import type { DbOrTx } from "@/db/client";
import {
  employeeJobHistory,
  employeeStatusHistory,
  employment,
  person,
  type SourceSystem,
} from "@/db/schema";
import { bambooId } from "@/modules/bamboo-client/schemas";
// Direct file import (not the identity barrel): see ./employee.ts.
import {
  nameWords,
  normalizeName,
  orderedName,
} from "@/modules/identity/normalize";
import {
  buildJobHistory,
  buildStatusHistory,
  isTermination,
} from "@/modules/org-history/build";
import { canonical } from "./canonical";
import { resolvePerson } from "./employee";
import { optionalDate, optionalText } from "./staging";

const jobInfoRow = z
  .looseObject({
    id: bambooId,
    date: optionalDate,
    location: optionalText,
    department: optionalText,
    division: optionalText,
    jobTitle: optionalText,
    reportsTo: optionalText,
  })
  .transform((r) => ({
    sourceId: r.id,
    date: r.date,
    location: r.location,
    department: r.department,
    division: r.division,
    jobTitle: r.jobTitle,
    reportsTo: r.reportsTo,
  }));

const statusRow = z
  .looseObject({
    id: bambooId,
    date: optionalDate,
    employmentStatus: optionalText,
    comment: optionalText,
  })
  .transform((r) => ({
    sourceId: r.id,
    date: r.date,
    status: r.employmentStatus,
    comment: r.comment,
    terminationRaw: Object.fromEntries(
      Object.entries(r).filter(([k]) => k.startsWith("termination")),
    ),
  }));

/** Validated `job_history` payload (one employee, all its table rows). */
export const stagedJobHistorySchema = z.looseObject({
  employeeId: bambooId,
  jobInfo: z.array(jobInfoRow),
  employmentStatus: z.array(statusRow),
});

export type StagedJobHistory = z.infer<typeof stagedJobHistorySchema>;

export type JobHistoryOutcome = {
  result: "inserted" | "updated" | "unchanged" | "rejected";
  reason?: string;
  managerUnresolved: number;
  /** Managers resolved only by the words of the name (any order): less sure. */
  managerResolvedFuzzy: number;
};

/** Dates a person was employed (ISO, both ends included); null = open end. */
export type EmployedPeriod = { from: string | null; to: string | null };

export type NamedPerson = {
  id: string;
  displayName: string;
  /** Without periods (unknown) the person is never "employed on a date". */
  employed?: readonly EmployedPeriod[];
};

type Candidate = { id: string; employed: readonly EmployedPeriod[] };

/**
 * People by name, for resolving the NAME Bamboo gives as a manager. Every
 * person is indexed twice: by the words in the order of the display name
 * ("María José López"), and by the same words in any order. All the people
 * with a name are kept (not only the unique ones): which of them a historical
 * row means depends on its date.
 */
export type NameIndex = {
  exact: Map<string, Candidate[]>;
  loose: Map<string, Candidate[]>;
};

export type ManagerMatch = {
  personId: string;
  /** Matched by the words in any order only (the exact order did not match). */
  fuzzy: boolean;
};

function addCandidate(
  into: Map<string, Candidate[]>,
  key: string,
  candidate: Candidate,
) {
  if (!key) return;
  const list = into.get(key);
  if (list) list.push(candidate);
  else into.set(key, [candidate]);
}

export function buildNameIndex(people: readonly NamedPerson[]): NameIndex {
  const index: NameIndex = { exact: new Map(), loose: new Map() };
  for (const p of people) {
    const candidate = { id: p.id, employed: p.employed ?? [] };
    addCandidate(index.exact, orderedName(p.displayName), candidate);
    addCandidate(index.loose, normalizeName(p.displayName), candidate);
  }
  return index;
}

/** "López, José María" as "First Last" words: "jose maria lopez". */
function reportsToKey(raw: string): string {
  const comma = raw.indexOf(",");
  if (comma < 0) return orderedName(raw);
  return nameWords(`${raw.slice(comma + 1)} ${raw.slice(0, comma)}`).join(" ");
}

const employedOn = (c: Candidate, date: string) =>
  c.employed.some(
    (p) =>
      (p.from === null || p.from <= date) && (p.to === null || p.to >= date),
  );

/**
 * The one person the name can be: its only holder, or else the only holder
 * employed on `date`. Namesakes that were both employed then stay ambiguous.
 */
function pickCandidate(
  candidates: readonly Candidate[] | undefined,
  date: string,
): string | null {
  if (!candidates) return null;
  if (candidates.length === 1) return candidates[0].id;
  const live = candidates.filter((c) => employedOn(c, date));
  return live.length === 1 ? live[0].id : null;
}

/**
 * The person Bamboo's `reportsTo` ("Last, First", or plain "First Last")
 * names in a job row that started on `onDate`, or null when it cannot be
 * told. The words must match in the order of the display name ("First Last"),
 * so "María José López" and "José María López" are not mixed up; only when no
 * person has the name in that order are the words tried in any order, and
 * that match is flagged `fuzzy`. A name with several holders that is not
 * settled by `onDate` is never guessed.
 */
export function resolveManagerName(
  index: NameIndex,
  raw: string,
  onDate: string,
): ManagerMatch | null {
  const key = reportsToKey(raw);
  if (!key) return null;
  const exact = index.exact.get(key);
  if (exact) {
    const personId = pickCandidate(exact, onDate);
    return personId ? { personId, fuzzy: false } : null;
  }
  const personId = pickCandidate(index.loose.get(normalizeName(raw)), onDate);
  return personId ? { personId, fuzzy: true } : null;
}

/** Every person with the periods they were employed (see `NameIndex`). */
export async function loadNameIndex(tx: DbOrTx): Promise<NameIndex> {
  const rows = await tx
    .select({
      id: person.id,
      displayName: person.displayName,
      employmentId: employment.id,
      from: employment.hireDate,
      to: employment.terminationDate,
    })
    .from(person)
    .leftJoin(
      employment,
      and(eq(employment.personId, person.id), isNull(employment.deletedAt)),
    );
  const people = new Map<
    string,
    NamedPerson & { employed: EmployedPeriod[] }
  >();
  for (const r of rows) {
    let p = people.get(r.id);
    if (!p) {
      p = { id: r.id, displayName: r.displayName, employed: [] };
      people.set(r.id, p);
    }
    if (r.employmentId) p.employed.push({ from: r.from, to: r.to });
  }
  return buildNameIndex([...people.values()]);
}

type JobValues = {
  validFrom: string;
  validTo: string | null;
  employmentId: string | null;
  managerPersonId: string | null;
  managerRaw: string | null;
  department: string | null;
  division: string | null;
  jobTitle: string | null;
  location: string | null;
  sourceId: string;
};

const jobKeys = [
  "validTo",
  "employmentId",
  "managerPersonId",
  "managerRaw",
  "department",
  "division",
  "jobTitle",
  "location",
  "sourceId",
] as const;

/**
 * Rebuilds the SCD2 history of one employee from all its Bamboo table rows.
 * The manager of the current row comes from the employee's supervisorEId;
 * older rows only have the reportsTo NAME ("Last, First"), matched against
 * the people's display names ("First Last", see `resolveManagerName`): the
 * one person with that name (among the namesakes, the one employed when the
 * row started); otherwise null, keeping manager_raw and counted in
 * managerUnresolved. Names matched only loosely count in managerResolvedFuzzy.
 */
export async function upsertJobHistory(
  tx: DbOrTx,
  source: SourceSystem,
  staged: StagedJobHistory,
  hash: string,
  runId: string,
  names?: NameIndex,
): Promise<JobHistoryOutcome> {
  const personId = await resolvePerson(tx, source, {
    bambooId: staged.employeeId,
  });
  if (!personId) {
    return {
      result: "rejected",
      reason: `unknown employee ${staged.employeeId}: ingest employees first`,
      managerUnresolved: 0,
      managerResolvedFuzzy: 0,
    };
  }

  const periods = await tx
    .select({
      id: employment.id,
      hireDate: employment.hireDate,
      terminationDate: employment.terminationDate,
      supervisorSourceId: employment.supervisorSourceId,
    })
    .from(employment)
    .where(
      and(
        eq(employment.sourceSystem, source),
        eq(employment.sourceId, staged.employeeId),
        isNull(employment.deletedAt),
      ),
    )
    .orderBy(sql`${employment.hireDate} desc nulls last`);

  // employment.terminationDate (from the employee record) is authoritative;
  // a "Terminated" status row only adds dates the record does not have.
  const terminations = [
    ...periods.flatMap((p) => (p.terminationDate ? [p.terminationDate] : [])),
    ...staged.employmentStatus
      .filter((s) => s.date && isTermination(s.status))
      .map((s) => s.date!),
  ];
  const built = buildJobHistory(staged.jobInfo, terminations);
  const nameIndex = names ?? (await loadNameIndex(tx));

  const employmentFor = (from: string) =>
    (
      periods.find((p) => p.hireDate !== null && p.hireDate <= from) ??
      periods[0]
    )?.id ?? null;

  let managerUnresolved = 0;
  let managerResolvedFuzzy = 0;
  const desired: JobValues[] = [];
  for (const [i, r] of built.entries()) {
    let managerPersonId: string | null = null;
    if (i === built.length - 1) {
      // Current supervisor as persisted by the latest employee ingest.
      const sup = periods[0]?.supervisorSourceId;
      if (sup)
        managerPersonId = await resolvePerson(tx, source, { bambooId: sup });
    }
    if (!managerPersonId && r.managerRaw) {
      const match = resolveManagerName(nameIndex, r.managerRaw, r.validFrom);
      if (!match) managerUnresolved++;
      else {
        managerPersonId = match.personId;
        if (match.fuzzy) managerResolvedFuzzy++;
      }
    }
    desired.push({
      validFrom: r.validFrom,
      validTo: r.validTo,
      employmentId: employmentFor(r.validFrom),
      managerPersonId,
      managerRaw: r.managerRaw,
      department: r.department,
      division: r.division,
      jobTitle: r.jobTitle,
      location: r.location,
      sourceId: r.sourceId,
    });
  }

  const existing = await tx
    .select()
    .from(employeeJobHistory)
    .where(
      and(
        eq(employeeJobHistory.personId, personId),
        eq(employeeJobHistory.sourceSystem, source),
      ),
    );
  const byFrom = new Map(existing.map((e) => [e.validFrom, e]));
  const wanted = new Set(desired.map((d) => d.validFrom));
  const unchanged =
    existing.length === desired.length &&
    desired.every((d) => {
      const e = byFrom.get(d.validFrom);
      return e && !e.deletedAt && jobKeys.every((k) => e[k] === d[k]);
    });

  const statuses = buildStatusHistory(staged.employmentStatus);
  const statusUnchanged = await syncStatusHistory(
    tx,
    source,
    personId,
    staged,
    statuses,
    hash,
    runId,
  );

  if (unchanged && statusUnchanged) {
    return { result: "unchanged", managerUnresolved, managerResolvedFuzzy };
  }

  const now = new Date();
  for (const e of existing) {
    if (!wanted.has(e.validFrom)) {
      await tx
        .delete(employeeJobHistory)
        .where(eq(employeeJobHistory.id, e.id));
    }
  }
  for (const d of desired) {
    const values = {
      ...d,
      ingestRunId: runId,
      payloadHash: hash,
      updatedAt: now,
      deletedAt: null,
    };
    await tx
      .insert(employeeJobHistory)
      .values({ ...values, personId, sourceSystem: source })
      .onConflictDoUpdate({
        target: [employeeJobHistory.personId, employeeJobHistory.validFrom],
        set: values,
      });
  }
  return {
    result: existing.length ? "updated" : "inserted",
    managerUnresolved,
    managerResolvedFuzzy,
  };
}

/** Rebuilds employee_status_history; true when nothing changed. */
async function syncStatusHistory(
  tx: DbOrTx,
  source: SourceSystem,
  personId: string,
  staged: StagedJobHistory,
  statuses: ReturnType<typeof buildStatusHistory>,
  hash: string,
  runId: string,
): Promise<boolean> {
  const rawById = new Map(staged.employmentStatus.map((s) => [s.sourceId, s]));
  const desired = statuses.map((s) => ({
    validFrom: s.validFrom,
    validTo: s.validTo,
    employmentStatus: s.employmentStatus,
    comment: s.comment,
    terminationRaw: rawById.get(s.sourceId)?.terminationRaw ?? {},
    sourceId: s.sourceId,
  }));
  const existing = await tx
    .select()
    .from(employeeStatusHistory)
    .where(
      and(
        eq(employeeStatusHistory.personId, personId),
        eq(employeeStatusHistory.sourceSystem, source),
      ),
    );
  const byFrom = new Map(existing.map((e) => [e.validFrom, e]));
  const same =
    existing.length === desired.length &&
    desired.every((d) => {
      const e = byFrom.get(d.validFrom);
      return (
        e &&
        e.validTo === d.validTo &&
        e.employmentStatus === d.employmentStatus &&
        e.comment === d.comment &&
        e.sourceId === d.sourceId &&
        canonical(e.terminationRaw ?? {}) === canonical(d.terminationRaw)
      );
    });
  if (same) return true;

  const wanted = new Set(desired.map((d) => d.validFrom));
  for (const e of existing) {
    if (!wanted.has(e.validFrom)) {
      await tx
        .delete(employeeStatusHistory)
        .where(eq(employeeStatusHistory.id, e.id));
    }
  }
  const now = new Date();
  for (const d of desired) {
    const values = {
      ...d,
      ingestRunId: runId,
      payloadHash: hash,
      updatedAt: now,
    };
    await tx
      .insert(employeeStatusHistory)
      .values({ ...values, personId, sourceSystem: source })
      .onConflictDoUpdate({
        target: [
          employeeStatusHistory.personId,
          employeeStatusHistory.validFrom,
        ],
        set: values,
      });
  }
  return false;
}
