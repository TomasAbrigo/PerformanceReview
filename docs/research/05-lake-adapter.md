# Lake adapter research (2026-11-13) — prototype tested in ../research-lake/smoke/

## Decisions

- Lake tech unknown → source-agnostic `LakeAdapter { listTables(); describeTable(t); readBatches(t, {keyColumns, watermarkColumn?, since?, batchSize?, columns?}): AsyncGenerator<{rows, watermark}>; close() }`.
- Dev/test implementation: `DuckDbFileLake` over a dir of <table>.{csv,parquet,json,ndjson} using `@duckdb/node-api@2.0.0-r.1` (DuckDB 2.0 LTS, Oct 2026). NOT `duckdb`/`duckdb-async` (deprecated). Pin exact versions (npm compromise CVE-2025-59037 in 2025). devDependency unless querying s3://gs:// in prod. Add to Next `serverExternalPackages` if bundled.
- Real adapters later, same contract + shared contract test suite, env-gated: BigQuery `@google-cloud/bigquery@9.6.1` (ADC/WIF, maximumBytesBilled, pageToken), Snowflake `snowflake-sdk@3.4.1` (key-pair JWT; passwords being blocked for service users), Databricks `@databricks/sql@3.0.0` (OAuth M2M; needs Node >=24.22.1 — this machine has 24.15; Delta CDF table_changes for incremental), S3/GCS via DuckDB httpfs or sdk + `hyparquet`, Redshift `pg` or Data API (UNLOAD for bulk), Postgres `pg` keyset paging.
- Watermark rules: keyset (watermark, pk) paging; re-read `>= since` (at-least-once); upsert `ON CONFLICT ... DO UPDATE WHERE old.ts < new.ts`; advance watermark only after commit; lookback for loader timestamps (_fivetran_synced); deletes via _fivetran_deleted or periodic key reconcile; UTC + zod coercion (BIGINT/DECIMAL come as strings).
- DuckDB gotchas: getRowObjectsJson() → BIGINT/DECIMAL as strings; TIMESTAMPTZ rendered in process TZ → CAST AS VARCHAR in SQL or TZ=UTC; tuple compare with bound params needs CAST to column types from DESCRIBE; httpfs needs network on first INSTALL.
- Run ingestion as CLI/worker, never in a request handler.

## How Bamboo lands in lakes (expected shapes)

- Fivetran BambooHR: 18 tables; performance = goal(title, percent_complete, status, due_date, completed_at), employee_goal(employee_id, goal_id), milestone(id, goal_id). employee(id, last_changed + dynamic snake_case fields). No reviews, no job/compensation history, no history mode. System cols _fivetran_synced, _fivetran_deleted, _fivetran_id.
- Airbyte source-bamboo-hr: employees, employees_directory_stream, custom_reports_stream, meta_fields_stream, time_off_requests_stream, timesheet_entries. No goals/performance. _airbyte_extracted_at as watermark.
- Review data will arrive by another route (support export / custom report CSV / other tool) → source "profiles" in config: {table, keys, watermark, softDelete} mapping lake names → canonical staging.

## Testing

1. Adapter contract tests (DuckDbFileLake now, real adapters later): batchSize=1 + watermark ties, since overlap, schema drift via describeTable, NULLs/BIGINT/timezones.
2. Ingest integration on PGlite `@electric-sql/pglite@0.5.16` (PG 18.6 WASM, ~1s/file; single connection; bigint → number vs string in pg; always close()). Drizzle: drizzle-orm/pglite.
3. Fidelity on real Postgres: `@testcontainers/postgresql@12.2.1` (Node >=22.22) in Vitest globalSetup (provide/inject pgUrl; snapshot/restore; ~6s start) — or our local Supabase DB. Run on PR/nightly.
   Fixtures: tests/fixtures/lake/<scenario>/<table>.csv|ndjson; scenarios initial, delta-1 (update/insert/soft-delete), schema-drift, messy (NULLs, dup keys, ties). Parquet generated via DuckDB COPY in `fixtures:build`. Synthetic only; gitignore real exports (PII).
   Key assertions: idempotent re-run; crash mid-batch leaves watermark; older never overwrites newer; soft deletes propagate.
