# BambooHR public API — mechanics (researched 2026-11-13, from official docs + OpenAPI spec)

Source of truth: https://openapi.bamboohr.io/main/latest/docs/openapi/public-openapi.yaml (copy in ../research-api/openapi.yaml)

## Headline

- NO performance-review / assessment / feedback endpoints. Only Goals under /performance. OAuth scopes `performance:assessments`, `performance:feedback`, `performance:settings`, `performance:one_on_ones` exist in securitySchemes but no public endpoint uses them (ask BambooHR partners/support).
- Goals are per employee only (no company-wide query, no change feed, no webhook).
- Rate limits not published; 429 + Retry-After since 2026-09 (503 before).
- Base URL: https://{companyDomain}.bamboohr.com/api/v1/... (legacy api.bamboohr.com/api/gateway.php/{co}/v1 still works). Versioned families: /api/v1_1, /api/v1_2, /api/v2/datasets.
- No official TS SDK → thin fetch client + zod + openapi-typescript.

## Auth

- API key: HTTP Basic, key as username, any password. Send preemptively. Runs with that user's permissions (use admin service user).
- OAuth2 auth code (recommended for new integrations): authorize.php?request=authorize, token.php?request=token; access 3600s; refresh needs `offline_access`. Scopes: goal, goal.write, report, field, employee, employee:job, employee_directory, public.integration, webhooks, openid.
- Always `Accept: application/json`. `POST /reports/custom` needs exact `Content-Type: application/json` (no charset).

## Errors

400 (X-BambooHR-Error-Message header), 401, 403, 404 (also bad report format), 406 (bad fields), 409, 429 (Retry-After), 5xx. Datasets v1.2/v2: RFC7807 problem+json + X-Request-ID; 422 INVALID_FILTER; UE-1001 orderBy not in fields; 413 too much data.

## Employees

- Internal immutable id = `id` / `employeeId` / `eeid` (string). `employeeNumber` is editable text — NEVER a key.
- Supervisor: `supervisorEId` (internal id of manager), `supervisorId` (= manager's employeeNumber!), `supervisor` (name), `reportsTo` (jobInfo table, name), list-employees `reportsToId`.
- GET /api/v1/employees?fields=...&page[limit]=2500&sort=employeeId&filter[status]=active — cursor pagination (meta.page.nextCursor / _links.next). Restricted fields → null + `_restrictedFields`. Employees failing a filter/sort permission are DROPPED silently.
- GET /api/v1/employees/{id}?fields=... (max 400 fields; id 0 = self; onlyCurrent=false for history).
- GET /employees/directory — whole company, no pagination, NOT authoritative (sharing settings, excludes inactive).
- Tables: GET /api/v1/employees/{id|all}/tables/{jobInfo|employmentStatus|compensation|...} → [{id,employeeId,...}]. jobInfo: date, location, department, division, jobTitle, reportsTo.
- Meta: /meta/fields, /meta/tables, /meta/lists. Custom fields: /api/v1/hris/custom-fields.
- Change tracking: GET /employees/changed?since=ISO&type=all → {latest, employees:{id:{action,lastChanged}}}; GET /employees/changed/tables/{table}?since= (returns ALL rows of that table for changed employees). Neither covers goals.

## Goals (employeeId = internal id)

- GET /api/v1/performance/employees/{id}/goals?filter=status-all|inProgress|completed|closed (omitted → excludes closed; CAP 50).
- GET /api/v1_2/performance/employees/{id}/goals/aggregate?filter=status-all → {canAlign, canCreateGoals, filters, goals[], persons[], comments[{goalId,commentCount}]} (includes milestone goals; current version).
- /goals/{goalId}/aggregate, /comments, /alignmentOptions, /shareOptions, /canCreateGoals; POST goals; PUT progress, milestones/{id}/progress, sharedWith; POST close/reopen; DELETE.
- Goal: {id(str), title, description, percentComplete, alignsWithOptionId, sharedWithEmployeeIds[int], dueDate, completionDate, lastChangedDateTime, status: in_progress|completed|closed, milestones[{id(int), employeeGoalId, title, currentValue, startValue, endValue, completedDateTime, lastUpdateDateTime, lastUpdateUserId}], actions{}}. Normalize ids to string.
- No reviewCycleId / no link to assessments.

## Datasets (scope report)

- GET /api/v1_2/datasets → {datasets:[{name,label}]}; GET /api/v1_2/datasets/{name}/fields?page=&page_size=500 (employee dataset > 450 fields).
- POST /api/v2/datasets/{name}/data {fields[], filter:"status in ('Active') and hireDate ge duration'-P30D'", orderBy, page, pageSize<=1000} → {data:[{fields:{...},_restrictedFields}], links.next, meta{totalPages,totalItems}}. OData-ish filters; no mixing and/or; no `not in`.
- Documented datasets: employee, benefit, applicants. UI report builder has a "Performance" dataset (goals, statuses, progress) — probably goals only. MUST verify with real key: list datasets + fields.

## Custom reports (scope report)

- GET /api/v1/custom-reports?page=&page_size= → saved custom reports; GET /api/v1/custom-reports/{id} executes (flat rows, strings/null, pagination). Fields fixed by the saved report.
- Legacy: GET /api/v1/reports/{id}?format=json|csv|xls|pdf (only here CSV/XLS); "Standard Reports are not available" → the 5 standard Performance reports can't be pulled by ID. POST /api/v1/reports/custom {title, fields[], filters} (max 400 fields).

## Webhooks

- Events: employee.created|updated|deleted (modern) or employee_with_fields.* (legacy; can't mix); company.*. NO goal/performance events.
- POST /api/v1/webhooks {name,url,format:"json",events[],monitorFields[]} → privateKey only at creation. Verify X-BambooHR-Signature = HMAC-SHA256(rawBody + X-BambooHR-Timestamp). Retries 5x (0,5,10,20,40 min). Use only as refetch hint.

## Client design recommendation

fetch + zod + openapi-typescript; modules: config, auth (ApiKey/OAuth single-flight refresh), http (Accept json, timeout, retry 429/5xx with Retry-After or jittered backoff max 6, token bucket ~4 concurrent), paginate (cursor / page+page_size / body page), endpoints/{employees,tables,changes,goals,datasets,reports,webhooks,meta}, webhook-receiver. Sync: full load → changed-feed every 5-15 min with 2-min overlap watermark → soft-delete → nightly reconcile; goals polled per active employee (aggregate v1_2) hashing lastChangedDateTime; datasets/reports snapshot + hash diff. Key everything on internal id (text), raw_* jsonb landing tables, sync_state(entity, watermark).
