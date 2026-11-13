# Performance Review

In-house performance review tool replacing BambooHR's performance module. Data is ingested from Bamboo; this app is the system of record afterwards.

@AGENTS.md

## Stack

- Next.js 16 (App Router, `src/` dir, TypeScript strict, Cache Components + Partial Prefetching enabled), React 19
- Tailwind CSS v4 + shadcn/ui (style `base-nova`, Base UI primitives; `Form` is replaced by `Field` in this shadcn version)
- next-intl: locales `es` (default) and `en`, routes under `/[locale]`, routing in `src/i18n/`, locale proxy in `src/proxy.ts` (Next 16 `proxy.ts` replaces `middleware.ts`)
- Supabase (local, via CLI + Docker) for Postgres/Auth/Storage
- Drizzle ORM + `postgres` (postgres-js); `drizzle-kit` for migrations
- Vitest (projects `unit` and `db`) + Testing Library; Playwright for e2e
- pnpm 12, Node 24

## Commands

| Command                            | What it does                                                                                        |
| ---------------------------------- | --------------------------------------------------------------------------------------------------- |
| `supabase start` / `supabase stop` | Start/stop the local stack (ports in `supabase/config.toml`)                                        |
| `pnpm dev`                         | Next dev server (http://localhost:3000, redirects to `/es`)                                         |
| `pnpm build` / `pnpm start`        | Production build / serve                                                                            |
| `pnpm typecheck`                   | `next typegen` + `tsc --noEmit`                                                                     |
| `pnpm lint` / `pnpm format`        | ESLint / Prettier (`format:check` for CI)                                                           |
| `pnpm check`                       | typecheck + lint + format:check + test:unit (same as the CI `checks` job)                           |
| `pnpm test`                        | All Vitest projects (unit + db)                                                                     |
| `pnpm test:unit`                   | jsdom unit/component tests (`src/**/*.test.{ts,tsx}`)                                               |
| `pnpm test:db`                     | Node tests against `DATABASE_URL` (`src/**/*.db.test.ts`); applies pending Drizzle migrations first |
| `pnpm test:e2e`                    | Playwright (starts `next dev` on :3100). First time: `pnpm exec playwright install chromium`        |
| `pnpm db:generate`                 | Generate a Drizzle migration into `drizzle/` from `src/db/schema/*.ts`                              |
| `pnpm db:migrate`                  | Apply Drizzle migrations to `DATABASE_URL`                                                          |
| `pnpm db:studio`                   | Drizzle Studio                                                                                      |
| `pnpm db:reset`                    | `supabase db reset` (wipes the DB; re-run `pnpm db:migrate` afterwards)                             |
| `pnpm ingest <entity> --source …`  | Run an ingest entity from the registry (`--all` for every one); see README "Ingesta"                |
| `pnpm fixtures:build`              | Regenerate the synthetic Bamboo fixtures in `fixtures/` (deterministic; commit the output)          |

## Local ports

Supabase: api 55321, db 55322, shadow 55320, studio 55323, inbucket 55324, analytics 55327, pooler 55329 (disabled). Next dev 3000, Playwright 3100. Ports 54320-54324, 54327 and 5433 belong to other local projects; do not use them.

## Conventions

- **TypeScript strict.** No `any`; prefer inferred Drizzle types (`$inferSelect` / `$inferInsert`).
- **Drizzle is SQL-first.** Schema lives in `src/db/schema/*.ts`; always change schema then `pnpm db:generate` and commit the generated SQL in `drizzle/`. Never edit applied migrations. `supabase/migrations/` is only for Supabase-specific SQL (RLS policies, extensions, functions).
- **DB access** goes through `src/db/client.ts` (`db` is lazy; use `closeDb()` in scripts/tests).
- **TDD: red, green, refactor.** Write a failing test first, make it pass, then refactor. Unit tests next to the code; DB tests are `*.db.test.ts`; e2e in `e2e/`.
- **i18n: every user-facing string is a message key** in `src/messages/{es,en}.json` (both files must have identical keys; a test enforces it). No hardcoded UI text. Use `Link`/`redirect` from `src/i18n/navigation.ts`, not `next/link`.
- **Source IDs from Bamboo are preserved** (store them as-is in dedicated source-id columns next to our own UUID primary keys) so re-ingestion is idempotent and traceable.
- Env vars: local values in `.env.local` (gitignored); keep `.env.example` in sync.
- shadcn components live in `src/components/ui` (excluded from Prettier); add more with `pnpm dlx shadcn@latest add <name>`.

## Hard rule: no deploy, local only

Do **not** deploy anywhere, do **not** run `vercel`, and do **not** link or modify a Vercel/Supabase cloud project. Everything runs locally against the Docker Supabase stack. (`.mcp.json` points to a Supabase MCP server; do not use it to modify remote projects.)

## Git and GitHub workflow

The owner asked that everything lives on GitHub (`TomasAbrigo/PerformanceReview`). Pushing is allowed and expected:

- One branch per issue, named `tomas/issue-<n>-<short-desc>`, based on `main`.
- Commit with conventional messages referencing the issue, push the branch (`git push -u origin <branch>`) and open a PR against `main` with `gh pr create` whose body contains `Closes #<n>` (or `Part of #<n>` for partial slices).
- The orchestrator merges PRs; do not merge your own PR, do not push to `main` directly, never force-push.
- CI (`.github/workflows/ci.yml`) runs on every PR and push to `main`: `checks` (typecheck, lint, format:check, unit), `db-tests` (postgres:17 service, `pnpm test:db`, `pnpm build`) and `e2e` (Playwright). Run `pnpm check` before pushing; PRs should be green before the orchestrator merges.
- Jira is not used for this repo for now.
