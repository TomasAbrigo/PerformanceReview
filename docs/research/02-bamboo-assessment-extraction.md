# Extracting Performance Management (assessment) data from BambooHR — findings 2026-11-13

## Verdict
No documented API surface for assessments / feedback / review cycles (high confidence). Help-center articles (screenstepslive) require login; facts below marked (search-summary) are medium confidence.

## Official surfaces
- OpenAPI: /performance/* = goals + comments only. "Assessments" = shift/break scheduling (unrelated).
- OAuth scopes performance:assessments(.write), performance:feedback(.write), performance:settings, performance:one_on_ones exist but unused by any public endpoint → ask BambooHR support/partner program.
- Datasets API: documented datasets employee/benefit/applicants; UI Custom Report Builder has a "Performance" data source described as goals/status/progress (https://www.bamboohr.com/product-updates/new-data-sources-in-custom-report-builder, .../performance-data-in-custom-report-builder). Likely goals only. Verify: GET /api/v1_2/datasets with real key.
- Custom Reports API: standard reports (incl. 5 Performance standard reports) NOT available by ID (legacy endpoint says so explicitly). Only saved custom reports.
- GraphQL: false positive (disabled ReadMe module).
- Webhooks: no performance events. ETL connectors (Fivetran, Airbyte, PostHog, Workato, Merge, Knit, StackOne, Unified.to): at most goals tables; none expose reviews.

## UI exports (search-summary, medium confidence)
Standard reports under Reports > Performance and Culture:
| Report | Content | Grain |
|---|---|---|
| Assessment Progress | completed / in progress / not started, employees without access | individual |
| Employee Performance | completed manager+employee assessments ("valued vs performance"); exports Excel/CSV, includes custom questions + answers of cycles in date range | individual |
| Feedback Status | who completed / received / from whom / overdue | individual |
| Goal Status | goal name, due date, % progress | individual |
| Company Performance | ratings by department/team/manager/location, no individuals | aggregate |
Unconfirmed: exact columns, whether employee ID / assessment ID is included, row grain. → do a test export.

## Most valuable: official "Export Services" Performance Export (medium-high confidence)
Requested via Support → professional services. Includes assessment data, peer feedback, goals, attachments. USD 150 per export (free on cancellation). Only Account Owner / Full Admin. Package expires 28 days. File format NOT documented → ask before buying. Source: https://bamboohr.screenstepslive.com/m/53907/l/1891039-export-services (login).

## Bamboo PM data model (from product updates + Whitman PDFs)
- Review Cycle: name, employee groups (dept/division/status/title/location), schedule (frequency, start dates), feedback forms and/or assessments, draft/active, multiple parallel cycles, double-blind toggle default ON (neither sees the other's answers until both submit), custom questions (3-10), Duplicate copies questions+ratings.
- Assessment: self + manager per employee per cycle (+ impromptu). Manager defaults: Q1 "If this employee got a job offer elsewhere, I would…" (4 options A-D), Q2 engagement (5 levels), Q3 "What are some things this employee does well?", Q4 "How could this employee improve?". Employee defaults: Q1 "How well does [company] recognize my value?" (4 options), Q2 "What would have the greatest impact…" (5 options incl. Other), Q3 "What are some things I do well?", Q4 "How could I improve?". Employee does NOT see manager's Q1/Q2. Manager sets a visibility date on submit; submitted assessments are immutable. Q1/Q2 feed "Employee Performance" report + misalignment alerts; removing defaults disables those reports. Answers are letter-coded single select or free text (no numeric rating by default); custom questions may use a custom rating scale (2-10 options).
- Feedback (peer/upward): formal cycle + ad hoc; manager picks peers (e.g. 1-10), anonymous, visible to supervisor only; warning at 5 requests per person; custom questions with rating scale.
- Goals: see API doc; no reviewCycleId; relation to cycle only via employee + dates.
- 1:1s: newer module (agenda + notes).

## Recommended extraction paths (ranked)
1. Official Performance Export via Support (full history, one-off, ask for format + IDs first; request before cancelling module).
2. UI CSV/Excel exports of standard reports (Employee Performance per cycle/date range + Feedback Status + Goal Status + Assessment Progress) + Goals via API. Validate IDs with a test export.
3. Datasets v2 / saved custom report on "Performance" dataset — cheap to test, likely goals only. Ask Bamboo whether performance:assessments scopes are usable.
Not recommended: undocumented UI endpoints (ToS/fragile), ETL connectors, GraphQL, webhooks.
