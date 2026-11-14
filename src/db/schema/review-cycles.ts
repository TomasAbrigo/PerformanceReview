import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import {
  type CycleAnonymity,
  type CycleComponents,
  type CycleDueDates,
  cycleStatuses,
  scheduleKinds,
} from "../../modules/review-core/status";
import { employeeJobHistory } from "./org-history";
import { person } from "./people";
import { type LocalizedText, ratingScale } from "./rating-scales";
import { sourceColumns } from "./source";
import {
  question,
  type QuestionKind,
  type QuestionRole,
  type Relationship,
  reviewTemplate,
} from "./templates";

export const cycleStatus = pgEnum("cycle_status", cycleStatuses);
export const scheduleKind = pgEnum("schedule_kind", scheduleKinds);

/** Who a cycle reviews; stored as chosen in the wizard. */
export type ParticipantFilter =
  | { kind: "all" }
  | {
      kind: "filter";
      departments?: string[];
      divisions?: string[];
      locations?: string[];
      jobTitles?: string[];
      statuses?: string[];
    }
  | { kind: "people"; personIds: string[] };

/** hire_date schedules (stored, not implemented yet): days after hire. */
export type HireDateSchedule = { offsetsDays: number[] };

export const reviewCycle = pgTable(
  "review_cycle",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    description: text("description"),
    periodStart: date("period_start").notNull(),
    periodEnd: date("period_end").notNull(),
    /** Org snapshot date: participants' manager/area are frozen as of it. */
    snapshotDate: date("snapshot_date").notNull(),
    status: cycleStatus("status").notNull().default("draft"),
    components: jsonb("components").$type<CycleComponents>().notNull(),
    anonymity: jsonb("anonymity").$type<CycleAnonymity>().notNull(),
    finalScaleId: uuid("final_scale_id").references(() => ratingScale.id, {
      onDelete: "restrict",
    }),
    templateId: uuid("template_id").references(() => reviewTemplate.id, {
      onDelete: "restrict",
    }),
    dueDates: jsonb("due_dates").$type<CycleDueDates>().notNull().default({}),
    scheduleKind: scheduleKind("schedule_kind").notNull().default("fixed"),
    hireDateSchedule: jsonb("hire_date_schedule").$type<HireDateSchedule>(),
    participantFilter: jsonb("participant_filter")
      .$type<ParticipantFilter>()
      .notNull()
      .default({ kind: "all" }),
    launchedAt: timestamp("launched_at", { withTimezone: true }),
    /** Calibration published (#16): employees see the current rating; sharing waits for it. */
    calibrationPublishedAt: timestamp("calibration_published_at", {
      withTimezone: true,
    }),
    ...sourceColumns,
  },
  (t) => [unique().on(t.sourceSystem, t.sourceId)],
);

/** A reviewee of a cycle, with their org data frozen at the snapshot date. */
export const cycleParticipant = pgTable(
  "cycle_participant",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    cycleId: uuid("cycle_id")
      .notNull()
      .references(() => reviewCycle.id, { onDelete: "cascade" }),
    revieweePersonId: uuid("reviewee_person_id")
      .notNull()
      .references(() => person.id),
    /** Date the snapshot was taken (snapshot_date, or the add date mid-cycle). */
    snapshotAsOf: date("snapshot_as_of").notNull(),
    snapManagerPersonId: uuid("snap_manager_person_id").references(
      () => person.id,
    ),
    snapDepartment: text("snap_department"),
    snapDivision: text("snap_division"),
    snapJobTitle: text("snap_job_title"),
    snapLocation: text("snap_location"),
    /** Set null when job-history re-ingest rebuilds rows (snap_* stay). */
    snapJobHistoryId: uuid("snap_job_history_id").references(
      () => employeeJobHistory.id,
      { onDelete: "set null" },
    ),
    addedAt: timestamp("added_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    removedAt: timestamp("removed_at", { withTimezone: true }),
  },
  (t) => [
    unique("cycle_participant_cycle_reviewee_uq").on(
      t.cycleId,
      t.revieweePersonId,
    ),
  ],
);

export type ScaleSnapshot = {
  options: { value: number; label: LocalizedText; normalized: number }[];
};

/** Immutable copy of a template question, taken when the cycle launches. */
export const questionRevision = pgTable(
  "question_revision",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    cycleId: uuid("cycle_id")
      .notNull()
      .references(() => reviewCycle.id, { onDelete: "cascade" }),
    /** Template question it was copied from (kept even if that is deleted). */
    questionId: uuid("question_id").references(() => question.id, {
      onDelete: "set null",
    }),
    sectionTitle: jsonb("section_title").$type<LocalizedText>().notNull(),
    prompt: jsonb("prompt").$type<LocalizedText>().notNull(),
    kind: text("kind").$type<QuestionKind>().notNull(),
    appliesTo: text("applies_to").array().$type<Relationship[]>().notNull(),
    visibleToReviewee: boolean("visible_to_reviewee").notNull(),
    required: boolean("required").notNull(),
    scale: jsonb("scale").$type<ScaleSnapshot>(),
    choices:
      jsonb("choices").$type<{ value: string; label: LocalizedText }[]>(),
    sort: integer("sort").notNull(),
    /**
     * Special meaning copied from the template question. `goals_rating` and
     * `goals_comment` are the goals rating and its comment: stored apart from
     * the overall rating, they never feed the final rating or the calibration
     * (see countsTowardOverall).
     */
    role: text("role").$type<QuestionRole>(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("question_revision_cycle_idx").on(t.cycleId, t.sort)],
);

/** Audit log of status changes (launch included). */
export const cycleTransition = pgTable(
  "cycle_transition",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    cycleId: uuid("cycle_id")
      .notNull()
      .references(() => reviewCycle.id, { onDelete: "cascade" }),
    fromStatus: cycleStatus("from_status").notNull(),
    toStatus: cycleStatus("to_status").notNull(),
    actorPersonId: uuid("actor_person_id").references(() => person.id),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("cycle_transition_cycle_idx").on(t.cycleId, t.createdAt)],
);

export type ReviewCycle = typeof reviewCycle.$inferSelect;
export type CycleParticipant = typeof cycleParticipant.$inferSelect;
export type QuestionRevision = typeof questionRevision.$inferSelect;
export type CycleTransition = typeof cycleTransition.$inferSelect;
