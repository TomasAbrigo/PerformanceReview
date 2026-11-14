import type { CycleDetail, CycleRow, ParticipantRow } from "./queries/cycles";
import type { GoalRow } from "./queries/goals";
import type { IssueRow } from "./queries/issues";
import type { OrgRow } from "./queries/org";
import type {
  CurrentJob,
  JobHistoryRow,
  PersonDetail,
  PersonRow,
} from "./queries/people";
import type { RunDetail, RunRow } from "./queries/runs";
import { sourceOf, type PersonRef } from "./queries/shared";

/**
 * Domain rows → the JSON of the API: snake_case keys; every object carries
 * its internal `id` and, where it came from a source, `source: { system, id }`
 * (null for rows created here). Timestamps are ISO 8601 UTC, dates YYYY-MM-DD.
 */

/** A person as another object points at it. */
export const serializePersonRef = (p: PersonRef) => ({
  id: p.id,
  source: sourceOf(p.sourceSystem, p.sourceId),
  display_name: p.displayName,
});

const ref = (p: PersonRef | null) => (p ? serializePersonRef(p) : null);

const serializeCurrentJob = (j: CurrentJob) => ({
  id: j.id,
  valid_from: j.validFrom,
  manager: ref(j.manager),
  manager_raw: j.managerRaw,
  department: j.department,
  division: j.division,
  job_title: j.jobTitle,
  location: j.location,
});

export const serializePerson = (p: PersonRow) => ({
  id: p.id,
  source: sourceOf(p.sourceSystem, p.bambooId),
  display_name: p.displayName,
  work_email: p.workEmail,
  employee_number: p.employeeNumber,
  status: p.status,
  active: p.active,
  hire_date: p.hireDate,
  termination_date: p.terminationDate,
  current_job: p.job ? serializeCurrentJob(p.job) : null,
  created_at: p.createdAt,
  updated_at: p.updatedAt,
});

const serializeJobHistory = (h: JobHistoryRow) => ({
  id: h.id,
  source: sourceOf(h.sourceSystem, h.sourceId),
  employment_id: h.employmentId,
  valid_from: h.validFrom,
  valid_to: h.validTo,
  manager: ref(h.manager),
  manager_raw: h.managerRaw,
  department: h.department,
  division: h.division,
  job_title: h.jobTitle,
  location: h.location,
  created_at: h.createdAt,
  updated_at: h.updatedAt,
});

export const serializePersonDetail = (p: PersonDetail) => ({
  ...serializePerson(p),
  source_identities: p.identities.map((i) => ({
    id: i.id,
    system: i.sourceSystem,
    kind: i.kind,
    value: i.value,
    valid_from: i.validFrom,
    valid_to: i.validTo,
  })),
  employments: p.employments.map((e) => ({
    id: e.id,
    source: sourceOf(e.sourceSystem, e.sourceId),
    hire_date: e.hireDate,
    termination_date: e.terminationDate,
    status: e.status,
    supervisor_source_id: e.supervisorSourceId,
    created_at: e.createdAt,
    updated_at: e.updatedAt,
  })),
  job_history: p.jobHistory.map(serializeJobHistory),
});

export const serializeOrgRow = (r: OrgRow) => ({
  id: r.id,
  source: sourceOf(r.sourceSystem, r.sourceId),
  person: serializePersonRef(r.person),
  employee_number: r.employeeNumber,
  manager: ref(r.manager),
  manager_raw: r.managerRaw,
  valid_from: r.validFrom,
  valid_to: r.validTo,
  department: r.department,
  division: r.division,
  job_title: r.jobTitle,
  location: r.location,
});

export const serializeGoal = (g: GoalRow) => ({
  id: g.id,
  source: sourceOf(g.sourceSystem, g.sourceId),
  person: serializePersonRef(g.person),
  title: g.title,
  description: g.description,
  percent_complete: g.percentComplete,
  status: g.status,
  due_date: g.dueDate,
  completion_date: g.completionDate,
  last_changed_at: g.lastChangedAt,
  aligns_with_source_id: g.alignsWithSourceId,
  comment_count: g.commentCount,
  milestones: g.milestones.map((m) => ({
    id: m.id,
    source: sourceOf(m.sourceSystem, m.sourceId),
    title: m.title,
    position: m.position,
    completed_at: m.completedAt,
    last_update_at: m.lastUpdateAt,
  })),
  shared_with: g.sharedWith.map(serializePersonRef),
  created_at: g.createdAt,
  updated_at: g.updatedAt,
});

export const serializeCycle = (c: CycleRow) => ({
  id: c.id,
  source: sourceOf(c.sourceSystem, c.sourceId),
  name: c.name,
  description: c.description,
  period_start: c.periodStart,
  period_end: c.periodEnd,
  snapshot_date: c.snapshotDate,
  status: c.status,
  components: c.components,
  anonymity: c.anonymity,
  template_id: c.templateId,
  final_scale_id: c.finalScaleId,
  due_dates: c.dueDates,
  schedule_kind: c.scheduleKind,
  participant_filter: c.participantFilter,
  launched_at: c.launchedAt,
  participant_count: c.participantCount,
  created_at: c.createdAt,
  updated_at: c.updatedAt,
});

const serializeParticipant = (p: ParticipantRow) => ({
  id: p.id,
  person: serializePersonRef(p.person),
  snapshot: {
    as_of: p.snapshotAsOf,
    manager: ref(p.snapManager),
    department: p.snapDepartment,
    division: p.snapDivision,
    job_title: p.snapJobTitle,
    location: p.snapLocation,
    job_history_id: p.snapJobHistoryId,
  },
  added_at: p.addedAt,
  removed_at: p.removedAt,
});

export const serializeCycleDetail = (c: CycleDetail) => ({
  ...serializeCycle(c),
  question_count: c.questionCount,
  participants: c.participants.map(serializeParticipant),
});

export const serializeRun = (r: RunRow) => ({
  id: r.id,
  source_system: r.sourceSystem,
  adapter: r.adapter,
  entity: r.entity,
  status: r.status,
  started_at: r.startedAt,
  finished_at: r.finishedAt,
  counts: r.counts,
  issue_count: r.issueCount,
  error: r.error,
});

export const serializeRunDetail = (r: RunDetail) => ({
  ...serializeRun(r),
  params: r.params,
  rejects: r.rejects,
  raw_record_count: r.rawRecordCount,
});

export const serializeIssue = (i: IssueRow) => ({
  id: i.id,
  source: sourceOf(i.sourceSystem, i.sourceId),
  entity: i.entity,
  reason: i.reason,
  status: i.status,
  ingest_run_id: i.ingestRunId,
  candidates: i.candidates.map((c) => ({
    person_id: c.personId,
    score: c.score,
    matched_on: c.matchedOn,
  })),
  payload: i.payload,
  resolution: i.resolution,
  created_at: i.createdAt,
  resolved_at: i.resolvedAt,
});
