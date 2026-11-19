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
import {
  type IndicatorAlert,
  indicatorAlerts,
  indicatorDistribution,
  indicatorGroupBys,
  indicators,
} from "@/modules/analytics/indicators";
import {
  qualitativeGroupBys,
  readingSides,
  sentiments,
  signals,
  type QualitativeFilters,
} from "@/modules/qualitative-analysis";
import {
  selfAssessmentReport,
  type SelfAssessmentReport,
} from "@/modules/insights/self-assessment";
import {
  type GoalKpiGroup,
  type GoalOutlier,
  goalGroupBys,
  goalKpis,
  goalOutliers,
} from "@/modules/analytics/goals-insights";
import {
  type CompletionGroup,
  completionDelta,
  completionGroupBys,
  type CompletionDeltaRow,
  type MissingPerson,
  missingAssessments,
  missingStatuses,
  roundedPoints,
} from "@/modules/analytics/completion";
import {
  periodDetail,
  type PeriodDetailRow,
} from "@/modules/analytics/period-detail";
import { storedCycleName } from "@/modules/review-core/cycle-name";
import { RUN_STATUSES } from "@/modules/ingest/run-status";
import { todayLocal } from "@/modules/org-history/dates";
import { requestStatuses } from "@/modules/review-core/request-status";
import { ReviewError } from "@/modules/review-core/review-errors";
import { relationships } from "@/modules/templates/constants";
import { csvResponse, type CsvColumn } from "./csv";
import { readingHeaderIn } from "./reading-headers";
import {
  closedExportRows,
  type ClosedExportRow,
  type GroupRow,
  type QuestionSideRow,
  pctOf,
  readingByGroup,
  readingByQuestion,
  yesNoExportRows,
  type YesNoExportRow,
} from "./reading-rows";

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
  rows: (db: DbOrTx, query: Q, locale: Locale) => AsyncIterable<R>;
  /** The header texts in the file's language, the query and the language. */
  columns: (header: Header, query: Q, locale: Locale) => CsvColumn<R>[];
};

function defineExport<Q, R>(def: Export<Q, R>) {
  return async (db: DbOrTx, request: Request): Promise<Response> => {
    const { locale } = parseQuery(request, localeQuery);
    const query = parseQuery(request, def.query);
    try {
      return await csvResponse(
        `${def.file(query)}.csv`,
        def.rows(db, query, locale),
        def.columns(headerIn(locale), query, locale),
      );
    } catch (error) {
      // The first row is read before answering: a cycle (or anything else the
      // query was asked about) that does not exist is a 404, not a 500.
      if (error instanceof ReviewError && error.code === "not_found") {
        throw notFound("Resource");
      }
      throw error;
    }
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

/** The org cuts every insights export takes, as the pages' URL params. */
const orgQuery = {
  account: z.string().optional(),
  project: z.string().optional(),
  dm: z.string().optional(),
  santexLead: z.string().optional(),
};
const orgFiltersOf = (q: {
  account?: string;
  project?: string;
  dm?: string;
  santexLead?: string;
}) => ({
  account: q.account,
  project: q.project,
  dm: q.dm,
  santexLead: q.santexLead,
});

const dashboardQuery = z.object({
  ...orgQuery,
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
  ...orgFiltersOf(q),
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
    // The review REQUESTS that exist: a participant with no request at all
    // is in no row (their pending assessment is in the completion export).
    { header: h("requests"), value: (r) => r.total },
    { header: h("submitted"), value: (r) => r.submitted },
    // Requests in draft (started, not submitted), not "everything pending".
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

// ------------------------------------------------- insights: indicators
// Retention and engagement, with People's visibility like the dashboards.

const indicatorQuery = z.object({
  ...orgQuery,
  cycle: uuid,
  indicator: z.enum(indicators).default("retention"),
  groupBy: z.enum(indicatorGroupBys).default("department"),
  hierarchy: z.enum(hierarchies).default("asOf"),
  department: z.string().optional(),
  manager: uuid.optional(),
});

type IndicatorDistributionRow = {
  group: string | null;
  indicator: string;
  value: number;
  count: number;
  n: number;
  mean: number | null;
};

/** One row per group × value 1-5, with the group's n and mean. */
const indicatorDistributionExport = defineExport({
  file: ({ cycle, indicator }) =>
    `insights-indicator-distribution-${cycle}-${indicator}`,
  query: indicatorQuery,
  rows: (db, q) =>
    each(
      indicatorDistribution(db, DEFAULT_ACTOR, {
        cycleId: q.cycle,
        indicator: q.indicator,
        groupBy: q.groupBy,
        hierarchy: q.hierarchy,
        filters: {
          department: q.department,
          managerId: q.manager,
          ...orgFiltersOf(q),
        },
      }).then((d) =>
        d.series.flatMap((s) =>
          s.counts.map((count, i): IndicatorDistributionRow => ({
            group: s.label,
            indicator: d.indicator,
            value: i + 1,
            count,
            n: s.n,
            mean: s.mean,
          })),
        ),
      ),
    ),
  columns: (h) => [
    { header: h("group"), value: (r: IndicatorDistributionRow) => r.group },
    { header: h("indicator"), value: (r) => r.indicator },
    { header: h("value"), value: (r) => r.value },
    { header: h("count"), value: (r) => r.count },
    { header: h("n"), value: (r) => r.n },
    { header: h("mean"), value: (r) => r.mean },
  ],
});

/** One row per alert: a fall of an indicator, or a risk (both low). */
const indicatorAlertsExport = defineExport({
  file: ({ cycle }) => `insights-alerts-${cycle}`,
  query: indicatorQuery.pick({
    cycle: true,
    hierarchy: true,
    department: true,
    manager: true,
    account: true,
    project: true,
    dm: true,
    santexLead: true,
  }),
  rows: (db, q) =>
    each(
      indicatorAlerts(db, DEFAULT_ACTOR, {
        cycleId: q.cycle,
        hierarchy: q.hierarchy,
        filters: {
          department: q.department,
          managerId: q.manager,
          ...orgFiltersOf(q),
        },
      }).then((a) => a.alerts),
    ),
  columns: (h) => [
    { header: h("alert_kind"), value: (a: IndicatorAlert) => a.kind },
    {
      header: h("indicator"),
      value: (a) => (a.kind === "drop" ? a.indicator : null),
    },
    { header: h("person_id"), value: (a) => a.person.personId },
    { header: h("name"), value: (a) => a.person.name },
    { header: h("manager_id"), value: (a) => a.person.managerId },
    { header: h("manager"), value: (a) => a.person.managerName },
    { header: h("department"), value: (a) => a.person.department },
    {
      header: h("previous_cycle"),
      value: (a) => (a.kind === "drop" ? a.previousCycleName : null),
    },
    {
      header: h("previous_value"),
      value: (a) => (a.kind === "drop" ? a.previousValue : null),
    },
    { header: h("value"), value: (a) => (a.kind === "drop" ? a.value : null) },
    { header: h("fall"), value: (a) => (a.kind === "drop" ? a.delta : null) },
    {
      header: h("retention"),
      value: (a) => (a.kind === "risk" ? a.retention : null),
    },
    {
      header: h("engagement"),
      value: (a) => (a.kind === "risk" ? a.engagement : null),
    },
  ],
});

// ---------------------------------------------------------------- insights

// The open-text reading (#129): the CSVs of /insights/qualitative say the
// numbers of the screen because they call the same readers (reading-rows.ts)
// with the same filters. The unit is the PERSON, self and manager never share
// a row, no text, quotes or names; People's visibility (the API has no actor).

/** The filters of the reading screen, as the page's URL params. */
const readingQuery = z.object({
  ...orgQuery,
  cycle: uuid.optional(),
  department: z.string().optional(),
  relationship: z.enum(readingSides).optional(),
  dimension: z.string().optional(),
  sentiment: z.enum(sentiments).optional(),
  theme: z.string().optional(),
});
type ReadingQuery = z.infer<typeof readingQuery>;

const readingFiltersOf = (q: ReadingQuery): QualitativeFilters => ({
  cycleId: q.cycle,
  department: q.department,
  relationship: q.relationship,
  dimension: q.dimension,
  sentiment: q.sentiment,
  theme: q.theme,
  ...orgFiltersOf(q),
  aggregateOnly: true,
});

/**
 * The reading per question and side, in people: who has a read answer, the
 * share of specific / generic / empty answers, the people with each signal
 * and the tone of the free text (secondary: the question conditions it). One
 * row per question and side; `people` is each row's n.
 */
const insightsSentimentExport = defineExport({
  file: () => "insights-sentiment",
  query: readingQuery,
  rows: (db, q) =>
    each(readingByQuestion(db, DEFAULT_ACTOR, readingFiltersOf(q))),
  columns: (h, _q, locale) => {
    const r = readingHeaderIn(locale);
    return [
      { header: h("dimension"), value: (x: QuestionSideRow) => x.dimension },
      { header: r("side"), value: (x) => x.side },
      { header: h("people"), value: (x) => x.people },
      { header: r("substance_people"), value: (x) => x.substancePeople },
      { header: r("substance_none"), value: (x) => x.none },
      { header: r("substance_generic"), value: (x) => x.generic },
      { header: r("substance_specific"), value: (x) => x.specific },
      {
        header: r("substance_none_pct"),
        value: (x) => pctOf(x.none, x.substancePeople),
      },
      {
        header: r("substance_generic_pct"),
        value: (x) => pctOf(x.generic, x.substancePeople),
      },
      {
        header: r("substance_specific_pct"),
        value: (x) => pctOf(x.specific, x.substancePeople),
      },
      { header: r("signal_any"), value: (x) => x.withAny },
      ...signals.map((s) => ({
        header: r(`signal_${s}`),
        value: (x: QuestionSideRow) => x.signals[s],
      })),
      ...sentiments.map((s) => ({
        header: h(s),
        value: (x: QuestionSideRow) => x.tone[s],
      })),
    ];
  },
});

/**
 * The reading per group of people: area, account, project, DM or Santex Lead
 * (`groupBy`): the people with each signal and the quality of the managers'
 * feedback (each person by the weaker of their manager's two answers). One
 * row per group; `people` is its n (the manager feedback has its own).
 */
const insightsSentimentGroupsExport = defineExport({
  file: ({ groupBy }) => `insights-sentiment-by-${groupBy}`,
  query: readingQuery.extend({
    groupBy: z.enum(qualitativeGroupBys).default("account"),
  }),
  rows: (db, q) =>
    each(readingByGroup(db, DEFAULT_ACTOR, readingFiltersOf(q), q.groupBy)),
  columns: (h, _q, locale) => {
    const r = readingHeaderIn(locale);
    const feedback = [
      ["none", "manager_feedback_none", "manager_feedback_none_pct"],
      ["generic", "manager_feedback_generic", "manager_feedback_generic_pct"],
      [
        "specific",
        "manager_feedback_specific",
        "manager_feedback_specific_pct",
      ],
    ] as const;
    return [
      { header: h("group"), value: (x: GroupRow) => x.group },
      { header: h("people"), value: (x) => x.people },
      { header: r("signal_any"), value: (x) => x.withAny },
      ...signals.map((s) => ({
        header: r(`signal_${s}`),
        value: (x: GroupRow) => x.signals[s],
      })),
      {
        header: r("manager_feedback_people"),
        value: (x) => x.managerFeedback.people,
      },
      ...feedback.map(([k, count]) => ({
        header: r(count),
        value: (x: GroupRow) => x.managerFeedback[k],
      })),
      ...feedback.map(([k, , pct]) => ({
        header: r(pct),
        value: (x: GroupRow) =>
          pctOf(x.managerFeedback[k], x.managerFeedback.people),
      })),
    ];
  },
});

/**
 * Sí / No per yes/no question and side, in people (`groupBy=none`, the
 * default), or per question and group (`groupBy` area, account, project, DM
 * or Santex Lead). A bare Sí / No is never a comment: it is counted here.
 */
const insightsYesNoExport = defineExport({
  file: ({ groupBy }) =>
    groupBy === "none" ? "insights-yes-no" : `insights-yes-no-by-${groupBy}`,
  query: readingQuery.extend({
    groupBy: z.enum(["none", ...qualitativeGroupBys]).default("none"),
  }),
  rows: (db, q) =>
    each(
      yesNoExportRows(
        db,
        DEFAULT_ACTOR,
        readingFiltersOf(q),
        q.groupBy === "none" ? null : q.groupBy,
      ),
    ),
  columns: (h, q, locale) => {
    const r = readingHeaderIn(locale);
    return [
      ...(q.groupBy === "none"
        ? []
        : [{ header: h("group"), value: (x: YesNoExportRow) => x.group }]),
      { header: h("dimension"), value: (x: YesNoExportRow) => x.dimension },
      { header: h("question_prompt_es"), value: (x) => x.prompt.es },
      { header: h("question_prompt_en"), value: (x) => x.prompt.en },
      ...(q.groupBy === "none"
        ? [{ header: r("side"), value: (x: YesNoExportRow) => x.side }]
        : []),
      { header: r("yes"), value: (x) => x.yes },
      { header: r("no"), value: (x) => x.no },
      { header: h("people"), value: (x) => x.people },
      { header: r("yes_pct"), value: (x) => pctOf(x.yes, x.people) },
      { header: r("no_pct"), value: (x) => pctOf(x.no, x.people) },
    ];
  },
});

/**
 * The closed questions, as the screen reads them: "valued" (1-4) as a scale,
 * people per value and the ones at 1-2 ("not_valued"), for the whole
 * selection and, with `groupBy`, per group; "best work" as people per option.
 * Never a tone. `base_people` is each row's n.
 */
const insightsClosedExport = defineExport({
  file: () => "insights-closed-questions",
  query: readingQuery.extend({
    groupBy: z.enum(["none", ...qualitativeGroupBys]).default("none"),
  }),
  rows: (db, q, locale) =>
    each(
      closedExportRows(
        db,
        DEFAULT_ACTOR,
        readingFiltersOf(q),
        q.groupBy === "none" ? null : q.groupBy,
        locale,
      ),
    ),
  columns: (h, _q, locale) => {
    const r = readingHeaderIn(locale);
    return [
      { header: h("section"), value: (x: ClosedExportRow) => x.section },
      { header: h("group"), value: (x) => x.group },
      { header: h("value"), value: (x) => x.value },
      { header: r("choice_label"), value: (x) => x.label },
      { header: h("people"), value: (x) => x.people },
      { header: r("base_people"), value: (x) => x.base },
      { header: r("people_pct"), value: (x) => pctOf(x.people, x.base) },
    ];
  },
});

type SelfAssessmentRow = {
  section:
    | "completion"
    | "substance"
    | "valued"
    | "best_work"
    | "agreement"
    | "blind_spot"
    | "theme"
    | "gap";
  group: string | null;
  metric: string;
  value: number;
};

const completionRows = (
  group: string | null,
  g: CompletionGroup,
): SelfAssessmentRow[] =>
  (
    [
      ["n", g.participants],
      ["self_submitted", g.selfSubmitted],
      ["self_total", g.selfApplicable],
      ["manager_submitted", g.managerSubmitted],
      ["manager_total", g.managerApplicable],
    ] as const
  ).map(([metric, value]) => ({ section: "completion", group, metric, value }));

/**
 * The open-text reading of the self reviews (#129), in people, the same
 * fields the screen draws: substance per question (`substance`, self side),
 * "valued" 1-4 as a scale (`valued`: one metric per value, `not_valued` for
 * the people at 1-2, `n`), best work per option (`best_work`), and the
 * person-manager agreement per question (`agreement`: `both`, `shared`) with
 * the improvement blind spots (`blind_spot`: people per theme).
 */
const readingRows = (r: SelfAssessmentReport): SelfAssessmentRow[] => [
  ...r.substance.flatMap((s) =>
    (
      [
        ["none", s.none],
        ["generic", s.generic],
        ["specific", s.specific],
        ["people", s.people],
      ] as const
    ).map(([metric, value]) => ({
      section: "substance" as const,
      group: s.dimension,
      metric,
      value,
    })),
  ),
  ...(r.valued
    ? [
        ...r.valued.counts.map((value, i) => ({
          section: "valued" as const,
          group: null,
          metric: String(i + 1),
          value,
        })),
        {
          section: "valued" as const,
          group: null,
          metric: "not_valued",
          value: r.valued.notValued,
        },
        {
          section: "valued" as const,
          group: null,
          metric: "n",
          value: r.valued.people,
        },
      ]
    : []),
  ...(r.bestWork
    ? [
        ...r.bestWork.options.map((o) => ({
          section: "best_work" as const,
          group: o.option,
          metric: "people",
          value: o.people,
        })),
        {
          section: "best_work" as const,
          group: null,
          metric: "n",
          value: r.bestWork.people,
        },
      ]
    : []),
  ...r.agreement.rows.flatMap((a) =>
    (
      [
        ["both", a.both],
        ["shared", a.shared],
      ] as const
    ).map(([metric, value]) => ({
      section: "agreement" as const,
      group: a.dimension,
      metric,
      value,
    })),
  ),
  ...r.agreement.blindSpots.map((b) => ({
    section: "blind_spot" as const,
    group: b.theme,
    metric: "people",
    value: b.people,
  })),
];

/**
 * The self-assessment report (People's visibility) in long format: one row
 * per section × group × metric: completion per department (plus "Otros" and
 * the total), the open-text reading of the self reviews in people
 * (`readingRows`), theme counts and the gap per question. Group labels in the
 * file's language.
 */
const selfAssessmentExport = defineExport({
  file: () => "insights-self-assessment",
  query: z.object({ cycle: uuid, locale: localeQuery.shape.locale }),
  rows: (db, q) => {
    const t = createTranslator({
      locale: q.locale,
      messages: MESSAGES[q.locale],
      namespace: "Insights",
    });
    return each(
      selfAssessmentReport(db, DEFAULT_ACTOR, {
        cycleId: q.cycle,
        groupBy: "department",
      }).then((r): SelfAssessmentRow[] => [
        ...r.completion.groups.flatMap((g) =>
          completionRows(g.label ?? t("completion.noDepartment"), g),
        ),
        ...(r.completion.others
          ? completionRows(t("others"), r.completion.others)
          : []),
        ...(r.completion.total
          ? completionRows(t("completion.all"), r.completion.total)
          : []),
        ...readingRows(r),
        ...r.themes.map((th) => ({
          section: "theme" as const,
          group: th.theme,
          metric: "count",
          value: th.count,
        })),
        ...r.gap.flatMap((g) =>
          (
            [
              ["n", g.n],
              ["self", g.meanSelf],
              ["manager", g.meanManager],
              ["gap", g.meanGap],
            ] as const
          ).map(([metric, value]) => ({
            section: "gap" as const,
            group: g.prompt[q.locale],
            metric,
            value,
          })),
        ),
      ]),
    );
  },
  columns: (h) => [
    { header: h("section"), value: (r: SelfAssessmentRow) => r.section },
    { header: h("group"), value: (r) => r.group },
    { header: h("metric"), value: (r) => r.metric },
    { header: h("value"), value: (r) => r.value },
  ],
});

// ------------------------------------------------ insights: goals vs assessment
// Goal KPIs and the goals/indicators outliers, with People's visibility like
// the dashboards (the API has no actor). No emails.

const goalsInsightsQuery = z.object({
  ...orgQuery,
  cycle: uuid,
  hierarchy: z.enum(hierarchies).default("asOf"),
  department: z.string().optional(),
  manager: uuid.optional(),
});

/** A share with one decimal: 53.8, not 53.84615384615385. */
const oneDecimal = (n: number | null) =>
  n === null ? null : Math.round(n * 10) / 10;

/**
 * One row per group (person, manager or area): goals, shares and mean
 * progress. Overdue is measured at `as_of` (the cycle's reference date: today
 * while it runs, the end of its period once closed), the same on every row;
 * the states are a partition (in progress leaves the overdue out), and the
 * shares are of all the group's goals, also the ones not due yet.
 */
const goalKpisExport = defineExport({
  file: ({ cycle, groupBy }) => `insights-goal-kpis-${cycle}-${groupBy}`,
  query: goalsInsightsQuery.extend({
    groupBy: z.enum(goalGroupBys).default("department"),
  }),
  rows: (db, q) =>
    each(
      goalKpis(db, DEFAULT_ACTOR, {
        cycleId: q.cycle,
        groupBy: q.groupBy,
        hierarchy: q.hierarchy,
        filters: {
          department: q.department,
          managerId: q.manager,
          ...orgFiltersOf(q),
        },
      }).then((k) => k.groups.map((g) => ({ ...g, asOf: k.asOf }))),
    ),
  columns: (h) => [
    {
      header: h("group_id"),
      value: (g: GoalKpiGroup & { asOf: string }) => g.key,
    },
    { header: h("group"), value: (g) => g.label },
    { header: h("people"), value: (g) => g.people },
    { header: h("goals"), value: (g) => g.goals },
    { header: h("completed"), value: (g) => g.completed },
    { header: h("in_progress"), value: (g) => g.inProgress },
    { header: h("closed"), value: (g) => g.closed },
    { header: h("overdue"), value: (g) => g.overdue },
    { header: h("completed_pct"), value: (g) => oneDecimal(g.completedPct) },
    {
      header: h("in_progress_pct"),
      value: (g) => oneDecimal(g.inProgressPct),
    },
    { header: h("overdue_pct"), value: (g) => oneDecimal(g.overduePct) },
    { header: h("avg_progress"), value: (g) => oneDecimal(g.avgProgress) },
    { header: h("due"), value: (g) => g.due },
    { header: h("completed_due"), value: (g) => g.completedDue },
    {
      header: h("completed_due_pct"),
      value: (g) => oneDecimal(g.completedDuePct),
    },
    { header: h("as_of"), value: (g) => g.asOf },
  ],
});

type GoalOutlierRow = GoalOutlier & {
  kind: "done_but_low" | "behind_but_high";
};

/** One row per outlier: goals done with low indicators, or goals behind with high ones. */
const goalOutliersExport = defineExport({
  file: ({ cycle }) => `insights-goal-outliers-${cycle}`,
  query: goalsInsightsQuery,
  rows: (db, q) =>
    each(
      goalOutliers(db, DEFAULT_ACTOR, {
        cycleId: q.cycle,
        hierarchy: q.hierarchy,
        filters: {
          department: q.department,
          managerId: q.manager,
          ...orgFiltersOf(q),
        },
      }).then((o): GoalOutlierRow[] => [
        ...o.doneButLow.people.map((p) => ({
          ...p,
          kind: "done_but_low" as const,
        })),
        ...o.behindButHigh.people.map((p) => ({
          ...p,
          kind: "behind_but_high" as const,
        })),
      ]),
    ),
  columns: (h) => [
    { header: h("outlier_kind"), value: (p: GoalOutlierRow) => p.kind },
    { header: h("person_id"), value: (p) => p.personId },
    { header: h("name"), value: (p) => p.name },
    { header: h("manager_id"), value: (p) => p.managerId },
    { header: h("manager"), value: (p) => p.managerName },
    { header: h("department"), value: (p) => p.department },
    { header: h("goals"), value: (p) => p.goals },
    { header: h("completed"), value: (p) => p.completed },
    { header: h("completed_pct"), value: (p) => oneDecimal(p.completedPct) },
    { header: h("retention"), value: (p) => p.retention },
    { header: h("engagement"), value: (p) => p.engagement },
  ],
});

// ------------------------------------------------------------- completion
// The insights completion views (/insights/completion), read as People (like
// the dashboards above): a cycle (required) and the same filters as the page.

/** A group of the completion file, named in the language of the file. */
type CompletionRow = {
  cycle: string;
  previous: string | null;
  group: CompletionGroup;
  label: string | null;
  delta: Pick<CompletionDeltaRow, "selfDelta" | "managerDelta"> | null;
};

const completionExport = defineExport({
  file: () => "insights-completion",
  query: z.object({
    ...orgQuery,
    cycle: uuid,
    groupBy: z.enum(completionGroupBys).default("department"),
    hierarchy: z.enum(hierarchies).default("asOf"),
    department: z.string().optional(),
    manager: uuid.optional(),
  }),
  rows: (db, q, locale) =>
    each(
      completionDelta(db, DEFAULT_ACTOR, {
        cycleId: q.cycle,
        groupBy: q.groupBy,
        hierarchy: q.hierarchy,
        department: q.department,
        managerId: q.manager,
        ...orgFiltersOf(q),
      }).then((d): CompletionRow[] => {
        const t = createTranslator({
          locale,
          messages: MESSAGES[locale],
          namespace: "Completion.summary",
        });
        const base = {
          cycle: d.current.cycleName,
          previous: d.previous?.cycleName ?? null,
        };
        const row = (
          group: CompletionGroup,
          label: string,
          delta: CompletionRow["delta"],
        ): CompletionRow => ({ ...base, group, label, delta });
        // The whole cycle first, then each group and the folded ones.
        return [
          ...(d.current.total
            ? [row(d.current.total, t("total"), d.total)]
            : []),
          ...d.current.groups.map((g, i) =>
            row(g, g.label ?? t("unassigned"), d.groups[i]),
          ),
          ...(d.current.others
            ? [row(d.current.others, t("others"), d.others)]
            : []),
        ];
      }),
    ),
  columns: (h) => [
    { header: h("cycle_name"), value: (r: CompletionRow) => r.cycle },
    { header: h("previous_cycle"), value: (r) => r.previous },
    { header: h("group_id"), value: (r) => r.group.key },
    { header: h("group"), value: (r) => r.label },
    { header: h("participants"), value: (r) => r.group.participants },
    { header: h("self_submitted"), value: (r) => r.group.selfSubmitted },
    { header: h("self_applicable"), value: (r) => r.group.selfApplicable },
    { header: h("self_pct"), value: (r) => percent(r.group.selfRate) },
    { header: h("manager_submitted"), value: (r) => r.group.managerSubmitted },
    {
      header: h("manager_applicable"),
      value: (r) => r.group.managerApplicable,
    },
    { header: h("manager_pct"), value: (r) => percent(r.group.managerRate) },
    { header: h("self_delta_pp"), value: (r) => r.delta?.selfDelta },
    { header: h("manager_delta_pp"), value: (r) => r.delta?.managerDelta },
  ],
});

/** A 0-1 rate as a percentage with one decimal (the rounding of the deltas). */
function percent(rate: number | null) {
  return rate === null ? null : roundedPoints(rate);
}

/** A mean with two decimals; empty when there is nothing to average. */
const mean2 = (m: { mean: number } | null) =>
  m === null ? null : Math.round(m.mean * 100) / 100;

const periodDetailExport = defineExport({
  file: () => "insights-period-detail",
  query: z.object({
    ...orgQuery,
    department: z.string().optional(),
    manager: uuid.optional(),
  }),
  rows: (db, q, locale) =>
    each(
      periodDetail(db, DEFAULT_ACTOR, {
        department: q.department,
        managerId: q.manager,
        ...orgFiltersOf(q),
      }).then((d) =>
        d.rows.map((r) => ({
          ...r,
          cycleName: storedCycleName(
            { name: r.cycleName, localizedName: r.localizedName },
            locale,
          ),
        })),
      ),
    ),
  columns: (h) => [
    { header: h("cycle_name"), value: (r: PeriodDetailRow) => r.cycleName },
    { header: h("period_start"), value: (r) => r.periodStart },
    { header: h("period_end"), value: (r) => r.periodEnd },
    { header: h("participants"), value: (r) => r.participants },
    { header: h("self_pct"), value: (r) => percent(r.selfRate) },
    { header: h("manager_pct"), value: (r) => percent(r.managerRate) },
    { header: h("valued_mean"), value: (r) => mean2(r.valued) },
    { header: h("valued_n"), value: (r) => r.valued?.n ?? null },
    { header: h("retention_mean"), value: (r) => mean2(r.retention) },
    { header: h("retention_n"), value: (r) => r.retention?.n ?? null },
    { header: h("engagement_mean"), value: (r) => mean2(r.engagement) },
    { header: h("engagement_n"), value: (r) => r.engagement?.n ?? null },
    { header: h("goals_due"), value: (r) => r.goals },
    {
      header: h("goals_completed_pct"),
      value: (r) =>
        r.goalsCompletedPct === null
          ? null
          : Math.round(r.goalsCompletedPct * 10) / 10,
    },
  ],
});

const missingExport = defineExport({
  file: () => "insights-missing",
  query: z.object({
    ...orgQuery,
    cycle: uuid,
    department: z.string().optional(),
    manager: uuid.optional(),
    status: z.enum(missingStatuses).default("any"),
    hierarchy: z.enum(hierarchies).default("asOf"),
    // The email is personal data: out of the file unless asked for.
    include_email: flag,
  }),
  rows: (db, q) =>
    each(
      missingAssessments(db, DEFAULT_ACTOR, {
        cycleId: q.cycle,
        department: q.department,
        managerId: q.manager,
        status: q.status,
        hierarchy: q.hierarchy,
        includeEmail: q.include_email,
        ...orgFiltersOf(q),
      }),
    ),
  columns: (h, { include_email }) => [
    { header: h("cycle_name"), value: (r: MissingPerson) => r.cycleName },
    { header: h("person_id"), value: (r) => r.personId },
    { header: h("name"), value: (r) => r.name },
    ...(include_email
      ? [{ header: h("email"), value: (r: MissingPerson) => r.email }]
      : []),
    { header: h("department"), value: (r) => r.department },
    { header: h("manager_id"), value: (r) => r.managerId },
    { header: h("manager"), value: (r) => r.managerName },
    { header: h("self_status"), value: (r) => r.selfStatus },
    { header: h("manager_status"), value: (r) => r.managerStatus },
    { header: h("follow_up_notes"), value: (r) => r.hasFollowUpNotes },
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
  "insights-completion": completionExport,
  "insights-period-detail": periodDetailExport,
  "insights-missing": missingExport,
  "insights-indicator-distribution": indicatorDistributionExport,
  "insights-alerts": indicatorAlertsExport,
  "insights-sentiment": insightsSentimentExport,
  "insights-sentiment-by": insightsSentimentGroupsExport,
  "insights-yes-no": insightsYesNoExport,
  "insights-closed-questions": insightsClosedExport,
  "insights-self-assessment": selfAssessmentExport,
  "insights-goal-kpis": goalKpisExport,
  "insights-goal-outliers": goalOutliersExport,
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
