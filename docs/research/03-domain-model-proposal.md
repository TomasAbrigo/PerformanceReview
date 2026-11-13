# Domain model proposal (Opus, 2026-11-13) — NOT fetched from live docs; items marked [verify]

Adopt the generic model used by Lattice / Culture Amp / 15Five:
Cycle → Template (sections → questions: rating/text/choice/competency) → Participant (reviewee + SNAPSHOT of manager/dept/title/location at cycle launch) → ReviewRequest (reviewer, relationship: self|manager|peer|upward, status, anonymous) → Answers; plus append-only final_rating (stages computed|manager|calibrated|override) for calibration audit; goals linked by period overlap + optional explicit link.

Join traps that cause "cruza mal": reportsTo is a name not an id [verify]; exports show CURRENT manager/dept, not as-of-review; mix of internal id vs employeeNumber vs names; rehires may get new ids; rating labels change between scale versions.

Entities (B=Bamboo, N=native):
person (N golden) 1-* employment (B/N hire→term) 1-* employee_job_history (B jobInfo SCD2: valid_from/valid_to, manager_person_id, manager_raw, dept, division, title, location)
person 1-* source_identity (kind: bamboo_id | employee_number | work_email | lake_key; valid_from/to; unique(source_system,kind,value))
review_cycle (B/N: name, period_start/end, snapshot_date, status draft|active|calibration|closed, final_scale_id)
rating_scale 1-* rating_scale_option (value, label, normalized 0..1, sort) — versioned
question (cycle_id or template_id, relationship, section, prompt, kind rating|text|choice, scale_id, sort)
cycle_participant (cycle_id, reviewee_person_id, snap_manager_person_id, snap_department, snap_division, snap_job_title, snap_location, snap_job_history_id; unique(cycle, reviewee))
review_request (participant_id, reviewer_person_id, relationship, status, anonymous, requested_at, submitted_at, reviewer_mismatch bool)
answer (request_id, question_id, option_id, numeric_value, text_value; unique(request, question))
final_rating (participant_id, stage, option_id, actor_person_id, reason, created_at) append-only; view v_current_rating (override > calibrated > manager > computed)
goal (owner_person_id, title, description, percent_complete, status, due_date, completed_at, aligns_with_goal_id) 1-* goal_milestone, goal_comment, goal_share
Ingestion: ingest_run (source_system, adapter, params, status, started/finished, counts, error), raw_record (run_id, source_system, entity, source_id, payload jsonb, payload_hash, extracted_at; unique(source,entity,source_id,hash)), identity_match_issue.
Every domain table: source_system enum (bamboo_api|bamboo_export|lake|native), source_id, ingest_run_id, payload_hash, created/updated_at; unique(source_system, source_id). Internal UUID PK is the only join key.

Identity matching order: bamboo_id → employee_number → lower(work_email) → (name_norm + hire_date → manual queue only). Unmatched → identity_match_issue, never dropped.
Manager-at-review: SCD2 job history; freeze snapshot at cycle launch (native) or as of period_end / assessment created date (imported); store actual reviewer separately; flag mismatch; reports choose "as of review" (default) vs "current".

Ingestion: SourceAdapter { source; entities[]; extract(ctx, entity): AsyncIterable<{sourceId, payload, extractedAt}> } → raw_record → stg_* (zod) → domain upsert ON CONFLICT (source_system, source_id) DO UPDATE WHERE payload_hash IS DISTINCT FROM; SCD2 keyed (employment_id, valid_from); soft deletes (deleted_at) when missing from full extract; run counts read/inserted/updated/unchanged/rejected.

Key queries: cycle completion by dept × relationship; employee review history (manager_at_review, final rating + normalized); manager team view (as_of_review vs current, recursive CTE for subtree); rating distribution pre/post calibration; goals vs rating (goals due in period); data-quality panel (unmatched, reviewer_mismatch, no_snapshot_manager).

Decisions: generic model; snapshot + SCD2; person/source_identity split; append-only final_rating; normalized scale values; Drizzle over Prisma (SQL-first, CTEs, views).

Open business questions: how assessment results reach the lake + sample file; reliable employee key; historical scales; default hierarchy for reports; calibration today (spreadsheets?); formal goal↔cycle link; years of history / 1:1s; system of record for org data after Bamboo.
