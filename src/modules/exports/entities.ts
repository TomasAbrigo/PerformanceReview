import { z, type ZodType } from "zod";
import type { DbOrTx } from "@/db/client";
import { INGEST_COUNT_KEYS } from "@/db/schema/ingest";
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
 * keyset queries as the JSON API, page by page, so a big export streams.
 */

/** Rows fetched per round trip while streaming. */
const PAGE_SIZE = 500;

type Export<Q, R> = {
  /** File name without extension, from the validated parameters. */
  file: (query: Q) => string;
  query: ZodType<Q>;
  rows: (db: DbOrTx, query: Q) => AsyncIterable<R>;
  columns: CsvColumn<R>[];
};

function defineExport<Q, R>(def: Export<Q, R>) {
  return (db: DbOrTx, request: Request): Response => {
    const query = parseQuery(request, def.query);
    return csvResponse(
      `${def.file(query)}.csv`,
      def.rows(db, query),
      def.columns,
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
  columns: [
    { header: "person_id", value: (p: PersonRow) => p.id },
    { header: "bamboo_id", value: (p) => p.bambooId },
    { header: "legajo", value: (p) => p.employeeNumber },
    { header: "email", value: (p) => p.workEmail },
    { header: "nombre", value: (p) => p.displayName },
    { header: "estado", value: (p) => p.status },
    { header: "manager_id", value: (p) => p.job?.manager?.id },
    { header: "manager", value: (p) => p.job?.manager?.displayName },
    { header: "área", value: (p) => p.job?.department },
    { header: "división", value: (p) => p.job?.division },
    { header: "puesto", value: (p) => p.job?.jobTitle },
    { header: "ubicación", value: (p) => p.job?.location },
    { header: "fecha ingreso", value: (p) => p.hireDate },
    { header: "fecha baja", value: (p) => p.terminationDate },
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
  columns: [
    { header: "as_of", value: (r: OrgRow & { asOf: string }) => r.asOf },
    { header: "job_history_id", value: (r) => r.id },
    { header: "person_id", value: (r) => r.person.id },
    { header: "bamboo_id", value: (r) => r.person.sourceId },
    { header: "legajo", value: (r) => r.employeeNumber },
    { header: "nombre", value: (r) => r.person.displayName },
    { header: "manager_id", value: (r) => r.manager?.id },
    { header: "manager_bamboo_id", value: (r) => r.manager?.sourceId },
    { header: "manager", value: (r) => r.manager?.displayName ?? r.managerRaw },
    { header: "área", value: (r) => r.department },
    { header: "división", value: (r) => r.division },
    { header: "puesto", value: (r) => r.jobTitle },
    { header: "ubicación", value: (r) => r.location },
    { header: "vigente desde", value: (r) => r.validFrom },
    { header: "vigente hasta", value: (r) => r.validTo },
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
  columns: [
    { header: "goal_id", value: (g: GoalRow) => g.id },
    { header: "goal_bamboo_id", value: (g) => g.sourceId },
    { header: "person_id", value: (g) => g.person.id },
    { header: "bamboo_id", value: (g) => g.person.sourceId },
    { header: "legajo", value: (g) => g.employeeNumber },
    { header: "nombre", value: (g) => g.person.displayName },
    { header: "manager_id", value: (g) => g.manager?.id },
    { header: "manager_bamboo_id", value: (g) => g.manager?.sourceId },
    { header: "manager", value: (g) => g.manager?.displayName },
    { header: "área", value: (g) => g.department },
    { header: "división", value: (g) => g.division },
    { header: "puesto", value: (g) => g.jobTitle },
    { header: "ubicación", value: (g) => g.location },
    { header: "título", value: (g) => g.title },
    { header: "estado", value: (g) => g.status },
    { header: "porcentaje completado", value: (g) => g.percentComplete },
    { header: "vencimiento", value: (g) => g.dueDate },
    { header: "fecha cierre", value: (g) => g.completionDate },
    { header: "última modificación", value: (g) => g.lastChangedAt },
    { header: "hitos", value: (g) => g.milestones.length },
    { header: "comentarios", value: (g) => g.commentCount },
  ],
});

// ----------------------------------------------------------- ingest runs

const COUNT_HEADERS: Record<(typeof INGEST_COUNT_KEYS)[number], string> = {
  read: "leídos",
  inserted: "insertados",
  updated: "actualizados",
  unchanged: "sin cambios",
  deleted: "eliminados",
  rejected: "rechazados",
  issues: "en cola",
  ignored: "ignorados",
};

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
  columns: [
    { header: "run_id", value: (r: RunRow) => r.id },
    { header: "fuente", value: (r) => r.sourceSystem },
    { header: "adaptador", value: (r) => r.adapter },
    { header: "entidad", value: (r) => r.entity },
    { header: "estado", value: (r) => r.status },
    { header: "inicio", value: (r) => r.startedAt },
    { header: "fin", value: (r) => r.finishedAt },
    ...INGEST_COUNT_KEYS.map((key) => ({
      header: COUNT_HEADERS[key],
      value: (r: RunRow) => r.counts[key],
    })),
    { header: "entradas del log", value: (r: RunRow) => r.issueCount },
    { header: "error", value: (r: RunRow) => r.error },
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
  columns: [
    { header: "cycle_id", value: (p: ParticipantRow) => p.cycleId },
    { header: "cycle_source_id", value: (p) => p.cycleSourceId },
    { header: "ciclo", value: (p) => p.cycleName },
    { header: "snapshot_as_of", value: (p) => p.snapshotAsOf },
    { header: "participant_id", value: (p) => p.id },
    { header: "person_id", value: (p) => p.person.id },
    { header: "bamboo_id", value: (p) => p.person.sourceId },
    { header: "legajo", value: (p) => p.employeeNumber },
    { header: "nombre", value: (p) => p.person.displayName },
    { header: "snapshot_manager_id", value: (p) => p.snapManager?.id },
    {
      header: "snapshot_manager_bamboo_id",
      value: (p) => p.snapManager?.sourceId,
    },
    { header: "snapshot_manager", value: (p) => p.snapManager?.displayName },
    { header: "área", value: (p) => p.snapDepartment },
    { header: "división", value: (p) => p.snapDivision },
    { header: "puesto", value: (p) => p.snapJobTitle },
    { header: "ubicación", value: (p) => p.snapLocation },
    { header: "agregado", value: (p) => p.addedAt },
    { header: "removido", value: (p) => p.removedAt },
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
export function exportCsv(
  db: DbOrTx,
  file: string,
  request: Request,
): Response {
  const match = /^([a-z-]+)\.csv$/.exec(file);
  const entity = match?.[1];
  if (!entity || !Object.hasOwn(EXPORTS, entity)) throw notFound("Export");
  return EXPORTS[entity as ExportEntity](db, request);
}
