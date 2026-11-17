import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, db } from "@/db/client";
import { reviewCycle } from "@/db/schema";
import { generateCompany } from "@/fixtures/company";
import { DEFAULT_ACTOR } from "@/modules/actor/types";
import { completionSummary } from "@/modules/analytics/completion";
import { goalKpis, goalOutliers } from "@/modules/analytics/goals-insights";
import {
  importReport,
  REPORTS,
  resetDb,
} from "@/modules/import-history/test-support";
import { seedFromFixtures } from "@/modules/ingest/seed";
import { MockProvider } from "@/modules/qualitative-analysis/mock-provider";
import { runAnalysis } from "@/modules/qualitative-analysis/service";
import { ArturiaError, buildReport, resolveCycle } from "./build";
import { runExportCli } from "./cli";
import { renderHtml, renderJson } from "./render";
import { arturiaReportV1, type ArturiaReport, SCHEMA_MINOR } from "./schema";

const EMAIL = /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.[\p{L}]{2,}/u;
/** Any http(s) URL, and src/href/url() that are not "#..." anchors or data: URIs. */
const EXTERNAL =
  /https?:\/\/|(?:src|href)\s*=\s*["']?(?!#|data:)[^"'\s>]|url\(\s*["']?(?!#|data:)/i;
const MIN = 5;

/** Display names (and their parts of 4+ letters) of the seed company. */
const company = generateCompany({ size: "small", seed: 1001 });
const names = company.employees.map((e) => `${e.firstName} ${e.lastName}`);

/** Every group of every series of the report, with its n. */
function groupSizes(r: ArturiaReport): { label: string; n: number }[] {
  const s = r.sections;
  return [
    ...s.executive.byDepartment,
    ...(s.completion?.byDepartment ?? []),
    ...(s.completion?.byManager ?? []),
    ...(s.indicators?.distribution.flatMap((d) => d.groups) ?? []),
    ...(s.goals?.byDepartment ?? []),
    ...(s.goals?.byManager ?? []),
  ];
}

let cycleId: string;

beforeAll(async () => {
  await resetDb();
  await db.execute(sql`TRUNCATE analysis_run, theme, app_setting CASCADE`);
  // People, job history and goals as `pnpm db:seed --size small` leaves them,
  // then the Bamboo reports (the cycles take their goal snapshot as they are
  // created, so the goals come first).
  await seedFromFixtures({ size: "small", db });
  await importReport(path.join(REPORTS, "employee-performance.csv"));
  await importReport(
    path.join(REPORTS, "assessment-progress.csv"),
    "bamboo-assessment-progress",
  );
  await importReport(
    path.join(REPORTS, "feedback-status.csv"),
    "bamboo-feedback-status",
  );
  await runAnalysis(db, { provider: new MockProvider() });
  cycleId = (await resolveCycle(db, "latest")).id;
}, 120_000);
afterAll(async () => {
  await resetDb();
  await closeDb();
});

describe("buildReport over the seed small company", () => {
  it("builds a valid named report with people, emails and all base sections", async () => {
    const r = await buildReport(db, { cycle: cycleId, anonymized: false });
    expect(arturiaReportV1.safeParse(r).success).toBe(true);
    expect(r.schemaVersion).toBe("arturia-report.v1");
    expect(r.anonymized).toBe(false);
    expect(r.sections.executive.participants).toBeGreaterThan(0);
    expect(r.schemaMinor).toBe(SCHEMA_MINOR);
    expect(r.sections.completion).not.toBeNull();
    expect(r.sections.goals).not.toBeNull();
    expect(r.sections.indicators?.distribution).toHaveLength(2);
    expect(r.sections.indicators?.riskMatrix?.cells).toHaveLength(9);
    expect(r.sections.qualitative?.topThemes.length).toBeGreaterThan(0);
    expect(r.sections.people?.length).toBe(r.sections.executive.participants);
    // The named report carries personal data: emails and names.
    expect(renderJson(r)).toMatch(EMAIL);
    expect(names.some((n) => renderJson(r).includes(n))).toBe(true);
  });

  it("the anonymized report has no emails, no seed names and no group under the minimum", async () => {
    const r = await buildReport(db, {
      cycle: cycleId,
      anonymized: true,
      minGroupSize: MIN,
    });
    expect(arturiaReportV1.safeParse(r).success).toBe(true);
    expect(r.sections.people).toBeNull();
    for (const text of [renderJson(r), renderHtml(r)]) {
      expect(text).not.toMatch(EMAIL);
      const folded = text.normalize("NFC");
      for (const n of names) expect(folded).not.toContain(n);
      // last names alone (the quotes are pseudonymized: no surname survives)
      for (const e of company.employees) {
        if (e.lastName.length >= 5) {
          expect(folded).not.toMatch(
            new RegExp(`(?<![\\p{L}])${e.lastName}(?![\\p{L}])`, "u"),
          );
        }
      }
    }
    const sizes = groupSizes(r);
    expect(sizes.length).toBeGreaterThan(0);
    for (const g of sizes) expect(g.n).toBeGreaterThanOrEqual(MIN);
    for (const g of r.sections.completion?.byManager ?? []) {
      expect(g.label).toMatch(/^(Equipo \d+|Otros)$/);
    }
  });

  it.each([2, MIN, 8, 40])(
    "with minimum %i no total sits next to a suppressed group (no differencing)",
    async (min) => {
      const r = await buildReport(db, {
        cycle: cycleId,
        anonymized: true,
        minGroupSize: min,
      });
      const s = r.sections;
      if (s.executive.suppressed > 0)
        expect(s.executive.distribution).toBeNull();
      const c = s.completion!;
      if (c.suppressed.byDepartment + c.suppressed.byManager > 0) {
        expect(c.byRelationship).toBeNull();
        expect(c.delta?.total ?? null).toBeNull();
      }
      for (const g of [...c.byDepartment, ...c.byManager]) {
        expect(g.n).toBeGreaterThanOrEqual(min);
        expect(g.n).toBeLessThanOrEqual(s.executive.participants);
      }
      for (const d of s.indicators?.distribution ?? []) {
        if (d.suppressed > 0) expect(d.total).toBeNull();
        for (const g of d.groups) expect(g.n).toBeGreaterThanOrEqual(min);
      }
      const m = s.indicators?.riskMatrix;
      if (m?.cells.some((x) => x.count === null)) {
        expect(m.total).toBeNull();
        // riskCount is the risk cell itself, masked like any other cell
        expect(m.riskCount).toBe(m.cells.find((x) => x.risk)!.count);
      }
      const g = s.goals!;
      const hiddenGoals =
        g.suppressed.byDepartment +
        g.suppressed.byManager +
        g.suppressed.buckets;
      if (hiddenGoals > 0) {
        expect([
          g.participantsWithGoals,
          g.goals,
          g.completed,
          g.avgProgress,
        ]).toEqual([null, null, null, null]);
      }
      for (const row of [...g.byDepartment, ...g.byManager]) {
        expect(row.n).toBeGreaterThanOrEqual(min);
      }
      for (const b of g.buckets) {
        expect(b.people === null || b.people === 0 || b.people >= min).toBe(
          true,
        );
      }
      for (const o of [g.outliers.doneButLow, g.outliers.behindButHigh]) {
        expect(o.people).toEqual([]);
        expect(o.count === null || o.count >= min).toBe(true);
      }
      expect(g.withoutGoals).toBeNull();
      if (min === 40) {
        // everything is under 40: the suppression path is really exercised
        expect(c.byRelationship).toBeNull();
        expect(c.byDepartment).toEqual([]);
        expect(g.byDepartment).toEqual([]);
        expect(g.byManager).toEqual([]);
        expect(g.participantsWithGoals).toBeNull();
        expect(
          g.buckets.every((b) => b.people === null || b.people === 0),
        ).toBe(true);
      }
    },
  );

  it("completion: the named report is the completion module run as People", async () => {
    const r = await buildReport(db, { cycle: cycleId, anonymized: false });
    const c = r.sections.completion!;
    const input = { cycleId };
    const dept = await completionSummary(db, DEFAULT_ACTOR, {
      ...input,
      groupBy: "department",
    });
    const team = await completionSummary(db, DEFAULT_ACTOR, {
      ...input,
      groupBy: "manager",
    });
    const t = dept.total!;
    expect(c.participants).toBe(dept.participants);
    expect(c.byRelationship).toEqual([
      {
        relationship: "self",
        total: t.selfApplicable,
        submitted: t.selfSubmitted,
        draft: null,
        declined: null,
      },
      {
        relationship: "manager",
        total: t.managerApplicable,
        submitted: t.managerSubmitted,
        draft: null,
        declined: null,
      },
    ]);
    const rows = (list: typeof c.byDepartment, rel: string) =>
      list
        .filter((x) => x.relationship === rel)
        .map((x) => [x.label, x.n, x.total, x.submitted]);
    const expected = (groups: typeof dept.groups, rel: "self" | "manager") =>
      groups
        .filter((g) =>
          rel === "self" ? g.selfApplicable : g.managerApplicable,
        )
        .map((g) => [
          g.label ?? "Otros",
          g.participants,
          rel === "self" ? g.selfApplicable : g.managerApplicable,
          rel === "self" ? g.selfSubmitted : g.managerSubmitted,
        ]);
    for (const rel of ["self", "manager"] as const) {
      expect(rows(c.byDepartment, rel)).toEqual(expected(dept.groups, rel));
      expect(rows(c.byManager, rel)).toEqual(expected(team.groups, rel));
    }
    expect(c.byDepartment.length).toBeGreaterThan(0);
    // the named report carries the manager's name, unlike the anonymized one
    expect(c.byManager.some((x) => !x.label.startsWith("Equipo"))).toBe(true);
    // compared with the semester before it
    expect(c.delta?.previousCycleName).toMatch(/2025-H2/);
    expect(c.delta?.total).not.toBeNull();
  });

  it("completion anonymized: departments by the direction view, teams as Equipo N, totals only when nothing is suppressed", async () => {
    const r = await buildReport(db, {
      cycle: cycleId,
      anonymized: true,
      minGroupSize: MIN,
    });
    const c = r.sections.completion!;
    const dir = await completionSummary(
      db,
      { personId: null, role: "direction" },
      { cycleId, groupBy: "department", minGroupSize: MIN },
    );
    expect(c.participants).toBe(dir.participants);
    expect(
      c.byDepartment
        .filter((x) => x.relationship === "self")
        .map((x) => [x.label, x.n]),
    ).toEqual(
      [...dir.groups, ...(dir.others ? [dir.others] : [])]
        .filter((g) => g.selfApplicable)
        .map((g) => [g.label ?? "Otros", g.participants]),
    );
    expect(c.suppressed.byDepartment).toBe(dir.suppressed);
    for (const g of c.byManager)
      expect(g.label).toMatch(/^(Equipo \d+|Otros)$/);
    const anySuppressed =
      c.suppressed.byDepartment + c.suppressed.byManager > 0;
    expect(c.byRelationship === null).toBe(anySuppressed || dir.total === null);
  });

  it("goals: the named report is goals-insights run as People, outliers by name", async () => {
    const r = await buildReport(db, { cycle: cycleId, anonymized: false });
    const g = r.sections.goals!;
    const input = { cycleId };
    const dept = await goalKpis(db, DEFAULT_ACTOR, {
      ...input,
      groupBy: "department",
    });
    const team = await goalKpis(db, DEFAULT_ACTOR, {
      ...input,
      groupBy: "manager",
    });
    expect(g.goals).toBeGreaterThan(0);
    expect(g.goals).toBe(dept.total!.goals);
    expect(g.completed).toBe(dept.total!.completed);
    expect(g.participantsWithGoals).toBe(dept.total!.peopleWithGoals);
    expect(
      g.byDepartment.map((x) => [x.label, x.n, x.goals, x.completed]),
    ).toEqual(
      dept.groups.map((x) => [
        x.label ?? "Otros",
        x.people,
        x.goals,
        x.completed,
      ]),
    );
    expect(g.byManager.map((x) => [x.label, x.n, x.goals])).toEqual(
      team.groups.map((x) => [x.label ?? "Otros", x.people, x.goals]),
    );
    expect(g.byManager.some((x) => !x.label.startsWith("Equipo"))).toBe(true);
    expect(g.buckets).toHaveLength(5);
    expect(g.buckets.reduce((n, b) => n + (b.people ?? 0), 0)).toBe(
      dept.total!.peopleWithGoals,
    );
    expect(g.withoutGoals).not.toBeNull();
    const out = await goalOutliers(db, DEFAULT_ACTOR, input);
    for (const key of ["doneButLow", "behindButHigh"] as const) {
      expect(g.outliers[key].count).toBe(out[key].count);
      expect(g.outliers[key].people.map((p) => [p.personId, p.name])).toEqual(
        out[key].people.map((p) => [p.personId, p.name]),
      );
    }
    expect(g.outliers.thresholds).toEqual(out.thresholds);
  });

  it("goals anonymized: groups over the minimum, teams as Equipo N, outliers only counted", async () => {
    const r = await buildReport(db, {
      cycle: cycleId,
      anonymized: true,
      minGroupSize: MIN,
    });
    const g = r.sections.goals!;
    expect(g).not.toBeNull();
    expect(g.goals ?? 1).toBeGreaterThan(0);
    for (const row of g.byManager)
      expect(row.label).toMatch(/^(Equipo \d+|Otros)$/);
    for (const row of g.byDepartment) expect(row.n).toBeGreaterThanOrEqual(MIN);
    expect(g.withoutGoals).toBeNull();
    for (const o of [g.outliers.doneButLow, g.outliers.behindButHigh]) {
      expect(o.people).toEqual([]);
      expect(o.count === null || o.count >= MIN).toBe(true);
    }
    // the report's minimum rules, not the setting's (which is the default here)
    const min2 = await buildReport(db, {
      cycle: cycleId,
      anonymized: true,
      minGroupSize: 40,
    });
    expect(min2.sections.goals!.byDepartment).toEqual([]);
  });

  it.each(["es", "en"] as const)(
    "the HTML (%s) of both versions is self-contained and draws the goals",
    async (locale) => {
      for (const anonymized of [false, true]) {
        const r = await buildReport(db, {
          cycle: cycleId,
          anonymized,
          minGroupSize: MIN,
          locale,
        });
        const html = renderHtml(r);
        expect(html).not.toMatch(EXTERNAL);
        expect(html).not.toMatch(/<link\b|<img\b|<iframe\b/i);
        const goals = html.match(/<section id="goals"[\s\S]*?<\/section>/)![0];
        expect(goals).toContain("<svg");
        expect(goals).toContain("<table");
        expect(goals).not.toContain("No disponible");
        expect(goals).not.toContain("Not available");
      }
    },
  );

  it("a deleted cycle is neither the latest nor found", async () => {
    const [deleted] = await db
      .insert(reviewCycle)
      .values({
        name: "Borrado",
        periodStart: "2099-01-01",
        periodEnd: "2099-06-30",
        snapshotDate: "2099-06-30",
        status: "closed",
        components: {
          self: true,
          manager: true,
          peer: false,
          upward: false,
          calibration: false,
        },
        anonymity: { peer: "transparent", upward: "transparent" },
        deletedAt: new Date(),
      })
      .returning({ id: reviewCycle.id });
    try {
      expect((await resolveCycle(db, "latest")).id).toBe(cycleId);
      await expect(resolveCycle(db, deleted.id)).rejects.toBeInstanceOf(
        ArturiaError,
      );
    } finally {
      await db.delete(reviewCycle).where(eq(reviewCycle.id, deleted.id));
    }
  });

  it("the CLI writes both files (named and anonymized) and prints no names", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "arturia-"));
    try {
      const out: string[] = [];
      for (const extra of [[], ["--anonymized"]]) {
        const code = await runExportCli(
          ["--cycle", "latest", "--out", dir, ...extra],
          { db, stdout: (l) => out.push(l) },
        );
        expect(code).toBe(0);
      }
      const json = JSON.parse(
        await readFile(path.join(dir, "report.anonymized.json"), "utf8"),
      );
      expect(arturiaReportV1.safeParse(json).success).toBe(true);
      await readFile(path.join(dir, "report.html"), "utf8");
      const printed = out.join("\n");
      for (const n of names) expect(printed).not.toContain(n);
      expect(printed).not.toMatch(EMAIL);

      const errors: string[] = [];
      expect(
        await runExportCli(["--cycle", "nope"], {
          db,
          stderr: (l) => errors.push(l),
        }),
      ).toBe(1);
      expect(await runExportCli([], { db, stderr: () => {} })).toBe(2);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("defaults to data/private/arturia/<cycle-slug>/ under the working directory", async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "arturia-cwd-"));
    try {
      const out: string[] = [];
      expect(
        await runExportCli(["--cycle", cycleId], {
          db,
          cwd,
          stdout: (l) => out.push(l),
        }),
      ).toBe(0);
      expect(out[1].trim()).toMatch(
        new RegExp(`^${cwd}/data/private/arturia/[a-z0-9-]+/report\\.json$`),
      );
      await readFile(out[1].trim(), "utf8");
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });
});
