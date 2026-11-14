import { createTranslator } from "next-intl";
import { z, type ZodType } from "zod";
import type { DbOrTx } from "@/db/client";
import { INGEST_COUNT_KEYS } from "@/db/schema/ingest";
import { routing, type Locale } from "@/i18n/routing";
import en from "@/messages/en.json";
import es from "@/messages/es.json";
import { notFound } from "@/modules/api/errors";
import { parseQuery } from "@/modules/api/http";
import { allPages } from "@/modules/api/pagination";
import { bool, isoDate, uuid } from "@/modules/api/params";
import {
  listParticipantRows,
  type ParticipantRow,
} from "@/modules/api/queries/cycles";
import {
  goalStatuses,
  listGoalRows,
  type GoalRow,
} from "@/modules/api/queries/goals";
import { listOrgAsOf, type OrgRow } from "@/modules/api/queries/org";
import { listPeopleRows, type PersonRow } from "@/modules/api/queries/people";
import { listRunRows, type RunRow } from "@/modules/api/queries/runs";
import { RUN_STATUSES } from "@/modules/ingest/run-status";
import { todayLocal } from "@/modules/org-history/dates";
import { csvResponse, type CsvColumn } from "./csv";

/**
 * CSV exports (`/api/v1/export/<entity>.csv`). Every row carries the internal
 * ids AND the Bamboo ids (person, legajo, manager, source of the row), never
 * just names, so the file joins back to anything. The rows come from the same
 * keyset queries as the JSON API, page by page, so a big export streams. The
 * header is in the language of `?locale=` (default `es`); the data is the same
 * in both.
 */

/** Rows fetched per round trip while streaming. */
const PAGE_SIZE = 500;

const MESSAGES = { es, en } satisfies Record<Locale, unknown>;
const DEFAULT_LOCALE: Locale = "es";

const localeQuery = z.object({
  locale: z.enum(routing.locales).default(DEFAULT_LOCALE),
});

type ColumnKey = keyof (typeof es)["Exports"]["columns"];
/** Header text of a column in the file's language. */
type Header = (key: ColumnKey) => string;

const headerIn = (locale: Locale): Header => {
  const t = createTranslator({
    locale,
    messages: MESSAGES[locale],
    namespace: "Exports.columns",
  });
  return (key) => t(key);
};

type Export<Q, R> = {
  /** File name without extension, from the validated parameters. */
  file: (query: Q) => string;
  query: ZodType<Q>;
  rows: (db: DbOrTx, query: Q) => AsyncIterable<R>;
  columns: (header: Header) => CsvColumn<R>[];
};

function defineExport<Q, R>(def: Export<Q, R>) {
  return async (db: DbOrTx, request: Request): Promise<Response> => {
    const { locale } = parseQuery(request, localeQuery);
    const query = parseQuery(request, def.query);
    return csvResponse(
      `${def.file(query)}.csv`,
      def.rows(db, query),
      def.columns(headerIn(locale)),
    );
  };
}

// ---------------------------------------------------------------- people

const peopleExport = defineExport({
  file: () => "people",
  query: z.object({
    q: z.string().max(200).optional(),
    active: bool.optional(),
  }),
  rows: (db, query) =>
    allPages((cursor) =>
      listPeopleRows(db, { ...query, limit: PAGE_SIZE, cursor }),
    ),
  columns: (h) => [
    { header: h("person_id"), value: (p: PersonRow) => p.id },
    { header: h("bamboo_id"), value: (p) => p.bambooId },
    { header: h("employee_number"), value: (p) => p.employeeNumber },
    { header: h("email"), value: (p) => p.workEmail },
    { header: h("name"), value: (p) => p.displayName },
    { header: h("status"), value: (p) => p.status },
    { header: h("manager_id"), value: (p) => p.job?.manager?.id },
    { header: h("manager"), value: (p) => p.job?.manager?.displayName },
    { header: h("department"), value: (p) => p.job?.department },
    { header: h("division"), value: (p) => p.job?.division },
    { header: h("job_title"), value: (p) => p.job?.jobTitle },
    { header: h("location"), value: (p) => p.job?.location },
    { header: h("hire_date"), value: (p) => p.hireDate },
    { header: h("termination_date"), value: (p) => p.terminationDate },
  ],
});

// ------------------------------------------------------------------- org

const orgExport = defineExport({
  file: ({ date }) => `org-${date}`,
  query: z
    .object({ date: isoDate.optional() })
    .transform(({ date }) => ({ date: date ?? todayLocal() })),
  rows: async function* (db, { date }) {
    for await (const row of allPages((cursor) =>
      listOrgAsOf(db, { date, limit: PAGE_SIZE, cursor }),
    )) {
      yield { ...row, asOf: date };
    }
  },
  columns: (h) => [
    { header: h("as_of"), value: (r: OrgRow & { asOf: string }) => r.asOf },
    { header: h("job_history_id"), value: (r) => r.id },
    { header: h("person_id"), value: (r) => r.person.id },
    { header: h("bamboo_id"), value: (r) => r.person.sourceId },
    { header: h("employee_number"), value: (r) => r.employeeNumber },
    { header: h("name"), value: (r) => r.person.displayName },
    { header: h("manager_id"), value: (r) => r.manager?.id },
    { header: h("manager_bamboo_id"), value: (r) => r.manager?.sourceId },
    {
      header: h("manager"),
      value: (r) => r.manager?.displayName ?? r.managerRaw,
    },
    { header: h("department"), value: (r) => r.department },
    { header: h("division"), value: (r) => r.division },
    { header: h("job_title"), value: (r) => r.jobTitle },
    { header: h("location"), value: (r) => r.location },
    { header: h("valid_from"), value: (r) => r.validFrom },
    { header: h("valid_to"), value: (r) => r.validTo },
  ],
});

// ----------------------------------------------------------------- goals

const goalsExport = defineExport({
  file: () => "goals",
  query: z.object({
    person_id: uuid.optional(),
    manager_id: uuid.optional(),
    status: z.enum(goalStatuses).optional(),
  }),
  rows: (db, { person_id, manager_id, status }) =>
    allPages((cursor) =>
      listGoalRows(db, {
        limit: PAGE_SIZE,
        cursor,
        personId: person_id,
        managerId: manager_id,
        status,
      }),
    ),
  columns: (h) => [
    { header: h("goal_id"), value: (g: GoalRow) => g.id },
    { header: h("goal_bamboo_id"), value: (g) => g.sourceId },
    { header: h("person_id"), value: (g) => g.person.id },
    { header: h("bamboo_id"), value: (g) => g.person.sourceId },
    { header: h("employee_number"), value: (g) => g.employeeNumber },
    { header: h("name"), value: (g) => g.person.displayName },
    { header: h("manager_id"), value: (g) => g.manager?.id },
    { header: h("manager_bamboo_id"), value: (g) => g.manager?.sourceId },
    { header: h("manager"), value: (g) => g.manager?.displayName },
    { header: h("department"), value: (g) => g.department },
    { header: h("division"), value: (g) => g.division },
    { header: h("job_title"), value: (g) => g.jobTitle },
    { header: h("location"), value: (g) => g.location },
    { header: h("title"), value: (g) => g.title },
    { header: h("status"), value: (g) => g.status },
    { header: h("percent_complete"), value: (g) => g.percentComplete },
    { header: h("due_date"), value: (g) => g.dueDate },
    { header: h("completion_date"), value: (g) => g.completionDate },
    { header: h("last_changed_at"), value: (g) => g.lastChangedAt },
    { header: h("milestones"), value: (g) => g.milestones.length },
    { header: h("comments"), value: (g) => g.commentCount },
  ],
});

// ----------------------------------------------------------- ingest runs

const runsExport = defineExport({
  file: () => "ingest-runs",
  query: z.object({
    source: z.string().max(50).optional(),
    entity: z.string().max(50).optional(),
    status: z.enum(RUN_STATUSES).optional(),
  }),
  rows: (db, query) =>
    allPages((cursor) =>
      listRunRows(db, { ...query, limit: PAGE_SIZE, cursor }),
    ),
  columns: (h) => [
    { header: h("run_id"), value: (r: RunRow) => r.id },
    { header: h("source"), value: (r) => r.sourceSystem },
    { header: h("adapter"), value: (r) => r.adapter },
    { header: h("entity"), value: (r) => r.entity },
    { header: h("status"), value: (r) => r.status },
    { header: h("started_at"), value: (r) => r.startedAt },
    { header: h("finished_at"), value: (r) => r.finishedAt },
    ...INGEST_COUNT_KEYS.map((key) => ({
      header: h(key),
      value: (r: RunRow) => r.counts[key],
    })),
    { header: h("log_entries"), value: (r: RunRow) => r.issueCount },
    { header: h("error"), value: (r: RunRow) => r.error },
  ],
});

// ---------------------------------------------------- cycle participants

const participantsExport = defineExport({
  file: () => "cycle-participants",
  query: z.object({ cycle_id: uuid.optional() }),
  rows: (db, { cycle_id }) =>
    allPages((cursor) =>
      listParticipantRows(db, { limit: PAGE_SIZE, cursor, cycleId: cycle_id }),
    ),
  columns: (h) => [
    { header: h("cycle_id"), value: (p: ParticipantRow) => p.cycleId },
    { header: h("cycle_source_id"), value: (p) => p.cycleSourceId },
    { header: h("cycle_name"), value: (p) => p.cycleName },
    { header: h("snapshot_as_of"), value: (p) => p.snapshotAsOf },
    { header: h("participant_id"), value: (p) => p.id },
    { header: h("person_id"), value: (p) => p.person.id },
    { header: h("bamboo_id"), value: (p) => p.person.sourceId },
    { header: h("employee_number"), value: (p) => p.employeeNumber },
    { header: h("name"), value: (p) => p.person.displayName },
    { header: h("snapshot_manager_id"), value: (p) => p.snapManager?.id },
    {
      header: h("snapshot_manager_bamboo_id"),
      value: (p) => p.snapManager?.sourceId,
    },
    {
      header: h("snapshot_manager"),
      value: (p) => p.snapManager?.displayName,
    },
    { header: h("department"), value: (p) => p.snapDepartment },
    { header: h("division"), value: (p) => p.snapDivision },
    { header: h("job_title"), value: (p) => p.snapJobTitle },
    { header: h("location"), value: (p) => p.snapLocation },
    { header: h("added_at"), value: (p) => p.addedAt },
    { header: h("removed_at"), value: (p) => p.removedAt },
  ],
});

const EXPORTS = {
  people: peopleExport,
  org: orgExport,
  goals: goalsExport,
  "ingest-runs": runsExport,
  "cycle-participants": participantsExport,
} as const;

export type ExportEntity = keyof typeof EXPORTS;
export const EXPORT_ENTITIES = Object.keys(EXPORTS) as ExportEntity[];

/** The CSV for `file` ("people.csv", ...), streamed; 404 for anything else. */
export async function exportCsv(
  db: DbOrTx,
  file: string,
  request: Request,
): Promise<Response> {
  const match = /^([a-z-]+)\.csv$/.exec(file);
  const entity = match?.[1];
  if (!entity || !Object.hasOwn(EXPORTS, entity)) throw notFound("Export");
  return EXPORTS[entity as ExportEntity](db, request);
}
