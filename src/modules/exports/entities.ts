import { createTranslator } from "next-intl";
import { z, type ZodType } from "zod";
import type { DbOrTx } from "@/db/client";
import { INGEST_COUNT_KEYS } from "@/db/schema/ingest";
import { routing, type Locale } from "@/i18n/routing";
import en from "@/messages/en.json";
import es from "@/messages/es.json";
import { notFound } from "@/modules/api/errors";
import { parseQuery } from "@/modules/api/http";
import { allPages, pages } from "@/modules/api/pagination";
import { bool, flag, isoDate, uuid } from "@/modules/api/params";
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
import {
  answersByRequest,
  listRequestRows,
  type AnswerRow,
  type RequestRow,
} from "@/modules/api/queries/reviews";
import { listRunRows, type RunRow } from "@/modules/api/queries/runs";
import { checkScope, scopeActor, scopeFields } from "@/modules/api/scope";
import { DEFAULT_ACTOR } from "@/modules/actor/types";
import {
  cycleProgress,
  type CycleProgress,
  type DashboardFilters,
  type GapByPerson,
  goalsVsRating,
  type GoalsVsRatingRow,
  groupBys,
  hierarchies,
  ratingDistribution,
  ratingStages,
  selfManagerGap,
} from "@/modules/analytics/dashboards";
import { RUN_STATUSES } from "@/modules/ingest/run-status";
import { todayLocal } from "@/modules/org-history/dates";
import { requestStatuses } from "@/modules/review-core/request-status";
import { relationships } from "@/modules/templates/constants";
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
  columns: (header: Header, query: Q) => CsvColumn<R>[];
};

function defineExport<Q, R>(def: Export<Q, R>) {
  return async (db: DbOrTx, request: Request): Promise<Response> => {
    const { locale } = parseQuery(request, localeQuery);
    const query = parseQuery(request, def.query);
    return csvResponse(
      `${def.file(query)}.csv`,
      def.rows(db, query),
      def.columns(headerIn(locale), query),
    );
  };
}

// ---------------------------------------------------------------- people

const peopleExport = defineExport({
  file: () => "people",
  query: z.object({
    q: z.string().max(200).optional(),
    active: bool.optional(),
    // The email is personal data: out of the file unless asked for.
    include_email: flag,
  }),
  rows: (db, { q, active }) =>
    allPages((cursor) =>
      listPeopleRows(db, { q, active, limit: PAGE_SIZE, cursor }),
    ),
  columns: (h, { include_email }) => [
    { header: h("person_id"), value: (p: PersonRow) => p.id },
    { header: h("bamboo_id"), value: (p) => p.bambooId },
    { header: h("employee_number"), value: (p) => p.employeeNumber },
    ...(include_email
      ? [{ header: h("email"), value: (p: PersonRow) => p.workEmail }]
      : []),
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

// ------------------------------------------------ review requests, answers

/**
 * Same filters and same reading scope as the JSON endpoints (HR by default,
 * `as_person` to read as a person): see modules/api/scope.ts. Anonymity is
 * applied by the queries, so a fully anonymous reviewer is blank here too.
 */
const reviewExportQuery = z
  .object({
    cycle_id: uuid.optional(),
    relationship: z.enum(relationships).optional(),
    status: z.enum(requestStatuses).optional(),
    ...scopeFields,
  })
  .superRefine(checkScope);

type ReviewExportQuery = z.output<typeof reviewExportQuery>;

/** Requests per round trip of the answers export (each brings its answers). */
const ANSWER_REQUESTS_PAGE_SIZE = 200;

/** Cells every review export starts with: the cycle, the reviewee and their snapshot, the reviewer. */
function requestColumns<R>(
  h: Header,
  of: (row: R) => RequestRow,
): CsvColumn<R>[] {
  return [
    { header: h("cycle_id"), value: (r) => of(r).cycleId },
    { header: h("cycle_source_id"), value: (r) => of(r).cycleSourceId },
    { header: h("cycle_name"), value: (r) => of(r).cycleName },
    { header: h("participant_id"), value: (r) => of(r).participantId },
    { header: h("request_id"), value: (r) => of(r).id },
    { header: h("person_id"), value: (r) => of(r).reviewee.id },
    { header: h("bamboo_id"), value: (r) => of(r).reviewee.sourceId },
    {
      header: h("employee_number"),
      value: (r) => of(r).revieweeEmployeeNumber,
    },
    { header: h("name"), value: (r) => of(r).reviewee.displayName },
    { header: h("snapshot_as_of"), value: (r) => of(r).snapshotAsOf },
    { header: h("snapshot_manager_id"), value: (r) => of(r).snapManager?.id },
    {
      header: h("snapshot_manager_bamboo_id"),
      value: (r) => of(r).snapManager?.sourceId,
    },
    {
      header: h("snapshot_manager"),
      value: (r) => of(r).snapManager?.displayName,
    },
    { header: h("department"), value: (r) => of(r).snapDepartment },
    { header: h("division"), value: (r) => of(r).snapDivision },
    { header: h("job_title"), value: (r) => of(r).snapJobTitle },
    { header: h("location"), value: (r) => of(r).snapLocation },
    { header: h("relationship"), value: (r) => of(r).relationship },
    { header: h("status"), value: (r) => of(r).status },
    { header: h("reviewer_id"), value: (r) => of(r).reviewer?.id },
    {
      header: h("reviewer_bamboo_id"),
      value: (r) => of(r).reviewer?.sourceId,
    },
    { header: h("reviewer"), value: (r) => of(r).reviewer?.displayName },
    { header: h("reviewer_visible"), value: (r) => of(r).reviewerVisible },
    { header: h("additional"), value: (r) => of(r).additional },
    { header: h("assigned_by_hr"), value: (r) => of(r).assignedByHr },
    {
      header: h("submitted_on_behalf"),
      value: (r) => of(r).submittedOnBehalf,
    },
  ];
}

const requestsExport = defineExport({
  file: () => "requests",
  query: reviewExportQuery,
  rows: async function* (
    db,
    { cycle_id, relationship, status, ...scope }: ReviewExportQuery,
  ) {
    const actor = await scopeActor(db, scope);
    yield* allPages((cursor) =>
      listRequestRows(db, {
        limit: PAGE_SIZE,
        cursor,
        cycleId: cycle_id,
        relationship,
        status,
        actor,
      }),
    );
  },
  columns: (h) => [
    ...requestColumns<RequestRow>(h, (r) => r),
    {
      header: h("participant_removed_at"),
      value: (r: RequestRow) => r.participantRemovedAt,
    },
    { header: h("reviewer_missing"), value: (r) => r.reviewerMissing },
    { header: h("reviewer_mismatch"), value: (r) => r.reviewerMismatch },
    { header: h("rating_stage"), value: (r) => r.currentRating?.stage },
    { header: h("rating_value"), value: (r) => r.currentRating?.optionValue },
    { header: h("rating_label"), value: (r) => r.currentRating?.optionLabel },
    {
      header: h("rating_normalized"),
      value: (r) => r.currentRating?.normalized,
    },
    { header: h("requested_at"), value: (r) => r.requestedAt },
    { header: h("submitted_at"), value: (r) => r.submittedAt },
    { header: h("declined_at"), value: (r) => r.declinedAt },
    { header: h("shared_at"), value: (r) => r.sharedAt },
    { header: h("answer_count"), value: (r) => r.answerCount },
  ],
});

type AnswerExportRow = { request: RequestRow; answer: AnswerRow };

/**
 * One row per reviewer x question: the requests page by page, each page's
 * answers in one query (a request without answers has no row).
 */
const answersExport = defineExport({
  file: () => "answers",
  query: reviewExportQuery,
  rows: async function* (
    db,
    { cycle_id, relationship, status, ...scope }: ReviewExportQuery,
  ) {
    const actor = await scopeActor(db, scope);
    for await (const page of pages((cursor) =>
      listRequestRows(db, {
        limit: ANSWER_REQUESTS_PAGE_SIZE,
        cursor,
        cycleId: cycle_id,
        relationship,
        status,
        actor,
      }),
    )) {
      const answers = await answersByRequest(db, page.items, actor);
      for (const request of page.items) {
        for (const answer of answers.get(request.id) ?? []) {
          yield { request, answer };
        }
      }
    }
  },
  columns: (h) => [
    ...requestColumns<AnswerExportRow>(h, (r) => r.request),
    {
      header: h("question_revision_id"),
      value: (r: AnswerExportRow) => r.answer.question.id,
    },
    { header: h("question_role"), value: (r) => r.answer.question.role },
    { header: h("question_kind"), value: (r) => r.answer.question.kind },
    {
      header: h("question_prompt_es"),
      value: (r) => r.answer.question.prompt.es,
    },
    {
      header: h("question_prompt_en"),
      value: (r) => r.answer.question.prompt.en,
    },
    { header: h("answer_value"), value: (r) => r.answer.optionValue },
    { header: h("answer_label"), value: (r) => r.answer.optionLabel },
    { header: h("normalized"), value: (r) => r.answer.normalized },
    { header: h("answer_text"), value: (r) => r.answer.text },
    { header: h("submitted_at"), value: (r) => r.request.submittedAt },
    { header: h("shared_at"), value: (r) => r.request.sharedAt },
  ],
});

// ---------------------------------------------------------------- dashboards
// The API has no actor (it is the HR / system surface, like every export
// here): dashboards export with HR visibility; aggregateOnly is honored.

const dashboardQuery = z.object({
  cycle: uuid.optional(),
  hierarchy: z.enum(hierarchies).default("asOf"),
  department: z.string().optional(),
  manager: uuid.optional(),
  location: z.string().optional(),
  jobTitle: z.string().optional(),
  aggregateOnly: bool.optional(),
});
type DashboardQuery = z.infer<typeof dashboardQuery>;
const withCycle = dashboardQuery.extend({ cycle: uuid });

const filtersOf = (q: DashboardQuery): DashboardFilters => ({
  cycleId: q.cycle,
  hierarchy: q.hierarchy,
  department: q.department,
  managerId: q.manager,
  location: q.location,
  jobTitle: q.jobTitle,
  aggregateOnly: q.aggregateOnly,
});

async function* each<R>(rows: Promise<R[]>): AsyncIterable<R> {
  yield* await rows;
}

const progressExport = defineExport({
  file: ({ cycle }) => `dashboard-progress-${cycle}`,
  query: withCycle,
  rows: (db, q) =>
    each(cycleProgress(db, DEFAULT_ACTOR, filtersOf(q)).then((r) => r.rows)),
  columns: (h) => [
    {
      header: h("relationship"),
      value: (r: CycleProgress["rows"][number]) => r.relationship,
    },
    { header: h("department"), value: (r) => r.department },
    { header: h("manager_id"), value: (r) => r.managerId },
    { header: h("manager"), value: (r) => r.managerName },
    { header: h("total"), value: (r) => r.total },
    { header: h("submitted"), value: (r) => r.submitted },
    { header: h("draft"), value: (r) => r.draft },
    { header: h("declined"), value: (r) => r.declined },
  ],
});

type DistributionRow = {
  group: string | null;
  from: number;
  to: number;
  count: number;
  n: number;
  mean: number | null;
};
const distributionExport = defineExport({
  file: ({ cycle, stage }) =>
    `dashboard-distribution-${cycle ?? "all"}-${stage}`,
  query: dashboardQuery.extend({
    groupBy: z.enum(groupBys).default("department"),
    stage: z.enum(ratingStages).default("current"),
  }),
  rows: (db, q) =>
    each(
      ratingDistribution(db, DEFAULT_ACTOR, {
        ...filtersOf(q),
        groupBy: q.groupBy,
        stage: q.stage,
      }).then((d) =>
        d.series.flatMap((s) =>
          s.counts.map((count, i): DistributionRow => ({
            group: s.label,
            from: d.bins[i].from,
            to: d.bins[i].to,
            count,
            n: s.n,
            mean: s.mean,
          })),
        ),
      ),
    ),
  columns: (h) => [
    { header: h("group"), value: (r: DistributionRow) => r.group },
    { header: h("bin_from"), value: (r) => r.from },
    { header: h("bin_to"), value: (r) => r.to },
    { header: h("count"), value: (r) => r.count },
    { header: h("n"), value: (r) => r.n },
    { header: h("mean_normalized"), value: (r) => r.mean },
  ],
});

const goalsVsRatingExport = defineExport({
  file: ({ cycle }) => `dashboard-goals-vs-rating-${cycle}`,
  query: withCycle,
  rows: (db, q) =>
    each(goalsVsRating(db, DEFAULT_ACTOR, filtersOf(q)).then((r) => r.rows)),
  columns: (h) => [
    {
      header: h("participant_id"),
      value: (r: GoalsVsRatingRow) => r.participantId,
    },
    { header: h("person_id"), value: (r) => r.personId },
    { header: h("name"), value: (r) => r.name },
    { header: h("goals"), value: (r) => r.goals },
    { header: h("completed"), value: (r) => r.completed },
    { header: h("avg_progress"), value: (r) => r.avgProgress },
    { header: h("normalized"), value: (r) => r.normalized },
  ],
});

const gapExport = defineExport({
  file: ({ cycle }) => `dashboard-self-manager-gap-${cycle}`,
  query: withCycle,
  rows: (db, q) =>
    each(
      selfManagerGap(db, DEFAULT_ACTOR, filtersOf(q)).then((r) => r.byPerson),
    ),
  columns: (h) => [
    {
      header: h("participant_id"),
      value: (r: GapByPerson) => r.participantId,
    },
    { header: h("person_id"), value: (r) => r.personId },
    { header: h("name"), value: (r) => r.name },
    { header: h("answers"), value: (r) => r.n },
    { header: h("gap"), value: (r) => r.meanGap },
  ],
});

const EXPORTS = {
  people: peopleExport,
  org: orgExport,
  goals: goalsExport,
  "ingest-runs": runsExport,
  "cycle-participants": participantsExport,
  requests: requestsExport,
  answers: answersExport,
  "dashboard-progress": progressExport,
  "dashboard-distribution": distributionExport,
  "dashboard-goals-vs-rating": goalsVsRatingExport,
  "dashboard-self-manager-gap": gapExport,
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
