# BambooHR Performance Management — verified feature inventory (2026-11-13)
Sources: help.bamboohr.com/s/article/<ID> (fetched live via headless browser; screenstepslive URLs now redirect to login), bamboohr.com/product-updates. Raw: scratchpad research-bamboo-features/{articles,updates,imgs}. Pro/Elite package only.

## Module map
Settings > Performance: Review Cycles, Goals, 1:1s. Employee profile > Performance tab: Goals, Feedback, Assessments, 1:1s.
Key releases: multiple cycles (2022-09), hire-date cycles (2022-12), 10 custom questions (2022-06), 360 peer+upward (2024-05), 1:1s (2024-12), duplicate cycle (2025-02), ratings on feedback Qs (2025-03), AI feedback summaries (2025-04), cascading goals (2025-11), performance data in custom report builder (2025-12-19), double-blind toggle (2026-06), 4-step flexible cycles with individual selection (2026-11-02), AI-suggested goals (2026-11).

## Review cycle setup (article 588033) — 4-step wizard
1 People: name; All / Some (Department, Division, Employee Status, Location, Job Title, Team) / Individual. Removed employees keep history.
2 Questions: toggles Peer Feedback, Upward Feedback, Assessment Questions (self+manager), File Uploads (optional/required). Double-blind toggle here (default ON). Peer+Upward+Assessments = 360.
3 Schedule (type locked after first save): Fixed Date (per-phase start/end/frequency: none, every 1/2/3/4/6 months, annually) or By Hire Date (30/60/90 days, 6 months, 1 year; window 1-4 weeks; feedback and assessment windows share due date).
4 Review & Launch (or Save & Finish Later draft).
Manage: list (name, schedule type, employee count, status); Duplicate (copies questions+ratings → draft "(Copy)"), Deactivate (reversible), Delete. Deactivating all cycles hides the standard reports.
Editing: name/participants/reminders anytime; fixed-date questions & settings lock while window open; hire-date cycles not locked.
Questions: assessment max 14 = 4 standard (removable only as a block) + 10 custom; each custom Q has separate employee and manager text; placeholders [Name], [Company]. Peer/Upward: 2 standard + 3 custom (or 5 custom). Per-department questions → separate cycles. Custom Qs translatable manually. No admin proofreading; admin can unlock submitted assessment.
Rating scales: optional per custom Q ("+ Add Rating"); default 5 Strongly Agree … 1 Strongly Disagree; rename/reorder/add/remove; LOCKED after launch; feedback-Q ratings 2-10 options. No overall performance rating in standard flow.
Reminders (assessment): by window length (0-1d: open; 2-3d: open+1d; 4-14d: open,3,1; 15-29d: open,10,3,1; ≥30d: open,30,10,3,1). Emails 7 AM company TZ. Admin "review your questions" email 10 days before fixed-date window.
Global: Goals access None/All/Some; Use Cascading Goals; AI-Suggested Goals (beta, on); 1:1s toggle; "Include Feedback Summaries" (AI, account-level).

## Employee flow (588039)
Entry via email or Performance > Assessments. Save & Finish Later + autosave 30 min. Mobile: in-order answering.
Default self Qs: (1) "How well does [Company] recognize my value?" 4 options (highly valued / sometimes / not sure others value / don't feel valued). (2) "What would have the greatest impact on my ability to do my best work more often?" options: company direction better defined / coworkers more committed / work fits strengths / nothing, I have all I need / Other (100 chars). (3) "What are some things I do well?" (4) "How could I improve?" Then custom Qs, optional file upload.
After submit: immutable (Full Admin unlock). Employee sees manager assessment only when both submitted and no future publish date. Employee NEVER sees manager Q1/Q2. Past assessments by date range. Only Reports-To manager can assess (no choice); skip removes both (irreversible); impromptu assessments allowed inside active cycle.
Goals are NOT embedded in the assessment form (independent module); AI goal suggestions draw on assessments/feedback/1:1s.

## Manager flow (588040)
Default manager Qs: (1) "If [Employee] got a job offer elsewhere, I would..." 5 options (do everything to keep / convince to stay / need to think / wish well / be relieved). (2) "How engaged is [Employee] at work?" 5 options (high … no engagement, checked out). (3) does well (4) could improve. Q1/Q2 labeled "WILL NOT SEE"; Q3/Q4 "WILL SEE". Q1/Q2 feed Employee Performance report.
Submit now or future-date publication up to 1 month (12 AM company time). Side-by-side self vs manager once visible; "Employee View" checkbox hides sensitive answers when screen-sharing. Follow-up notes: one per period, no history, visible to employee. Manager change mid-cycle: new manager sees/overwrites draft; only Reports-To at window close can complete.

## Feedback (peer / upward / 360)
Standard peer Qs: "What are some things [Name] does well?" / "How could [Name] improve?"; upward adds "as a manager". Up to 5 Qs/type, ratings allowed.
Manager requests (inbox task or Feedback tab); up to 10 people per employee, 10 open requests; any active user incl. contractors/external; Full Admin can pick if manager on leave; impromptu 30-day window; reviewer history last 2 periods + counter at ≥5 requests; upward auto-sent to direct reports; CEO can't receive feedback.
Visibility: recipient NEVER sees it; visible to admins, manager, manager's manager; not anonymous to manager (Bamboo rejects strict anonymity). Due last day of window; Past Due 30 more days then auto-dismiss. Reminders: manager halfway if no reviewers; reviewers 1 day before; manager notified on submit. AI summaries: needs ≥3 reviews in 6 months on standard Qs.

## Goals (588034/588036/1857678/588037)
Fields: Title*, Due Date*, Description, Use Milestones (≤10, 100 chars; progress proportional, slider locked), Attach files (PDF/XLS/DOCX/jpeg/png), Share (individuals with same rights as owner), AI Goal Assistant. Progress % slider; status In Progress / Completed / Closed; close with comment, reopen, delete; closed = read-only. Cards by due date; comments on goal. Cascading goals: type Cascading(public)/Individual(private); company-level toggle (admins); "Who's responsible"; parent goal; tree ≤5 levels; parent progress automatic; align only to company goals or own reporting line. OKRs: "Not currently" supported. ~12 notification types (monthly progress reminder, team digest, comments, due soon at 90% elapsed, due today, completed/closed, shared/unshared, sub-goals complete).

## 1:1s (1898823/1933494/1926842)
Per direct report: frequency, weekday, recurring agenda; both add/edit/reorder agenda; own notes autosaved + private notes; typing indicator; only manager+report see content (admins cannot); manager change → new manager re-adds, no history; old manager gets CSV export (30-day link); reminder emails + digest; notes feed AI goal suggestions. No templates.

## Reports (1862061) — Reports > Standard Reports > Performance and Culture (need ≥1 active cycle)
- Assessment Progress (588046): per group Complete/In Progress/Not Started; columns Assessed, Self status, Manager status, Follow-up notes; filters date range (default 6 months), Department/Division/Status/Title/Location/Manager/Teams/Review Cycle.
- Company Performance (932136): pie charts of self Q1 "Feels Valued", self Q2 "Best Work", manager Q2 "Engagement", manager Q1 "Contribution Value"; breakdown by dept/manager/location/title/status/division; aggregate only.
- Employee Performance (588047 gated): valued-vs-performance chart; per-person trendline of manager ratings; filter by cycle; export includes CUSTOM question answers (only place they appear). Exact columns unverified; no Employee ID column documented.
- Feedback Status (1252771): Receiving/Giving tabs; Employee Name, From/To, Date Completed, Due Date; status filters.
- Goals Status (984999): goal name, due date, progress, last comment, inline comments; filters by org + status (In Progress/Completed/Closed/No Goals Set/Past Due).
Custom report builder: performance data since 2025-12-19 (fields unverified). Exports Excel/CSV/PDF ("vary by report"). Removing standard Qs breaks Employee/Company Performance reports.

## Documented limits / complaints
No OKRs; no choice of assessor (Reports To only); no manager → can't be assessed (CEO); no admin proofreading; scales locked after launch; schedule type locked; questions locked during window; standard Qs removable only as block; different Qs per group = separate cycles; 1:1s invisible to HR; paid add-on. Reviews (FindStack/PeerSpot/SoftwareSuggest 2022-2025): "minimal", "limited customization", "no competency mapping", "reporting weak", "rigid". No overall rating, no self-vs-manager item analytics beyond Q1/Q2.

## Replicate (9) vs improve (6)
Replicate: cycle model w/ separate feedback+assessment windows & frequencies, fixed-date + hire-date; participant targeting (all/filter/individual); double-blind + future publish date + admin unlock; hidden manager Qs + "Employee view" toggle; feedback rules (recipient never sees; manager, skip-level, HR do; ≤10 reviewers; past-due grace); reminder cadence by window length; goals (individual + cascading, milestones, comments, close/reopen, attachments, share); 1:1s (agenda, notes, private notes, HR wall, manager-change export); skip/impromptu/manager-change rules.
Improve: question sets per group within one cycle + editable standard Qs; real rating/competency layer (scale library, numeric aggregation, calibration, self-vs-manager delta per item, overall rating); versioned edits after launch + admin review before submit; reporting with employee ID/manager ID/dept/cycle in every row, per-question answers, longitudinal trends, report designer; goals/OKRs with key results, weights, goals inside the assessment, company tree; multiple/dotted-line managers, delegated assessors, assess people with no manager.
