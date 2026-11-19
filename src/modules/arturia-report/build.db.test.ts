import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, db } from "@/db/client";
import { cycleParticipant, person, reviewCycle } from "@/db/schema";
import { generateCompany } from "@/fixtures/company";
import { DEFAULT_ACTOR } from "@/modules/actor/types";
import { completionSummary } from "@/modules/analytics/completion";
import { goalKpis, goalOutliers } from "@/modules/analytics/goals-insights";
import { goalAsOf } from "@/modules/goals/state";
import { todayLocal } from "@/modules/org-history/dates";
import {
  insertParticipant,
  insertPerson,
} from "@/modules/analytics/test-support";
import {
  importReport,
  REPORTS,
  resetDb,
} from "@/modules/import-history/test-support";
import { seedFromFixtures } from "@/modules/ingest/seed";
import { importReportFile } from "@/modules/lake/upload";
import { MockProvider } from "@/modules/qualitative-analysis/mock-provider";
import { runAnalysis } from "@/modules/qualitative-analysis/service";
import { ArturiaError, buildReport, resolveCycle } from "./build";
import { runExportCli } from "./cli";
import { cycleTeams } from "./collectors";
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
    ...(s.completion?.byAccount ?? []),
    ...(s.completion?.byDm ?? []),
    ...(s.indicators?.distribution.flatMap((d) => [
      ...d.groups,
      ...(d.byAccount ?? []),
      ...(d.byDm ?? []),
    ]) ?? []),
    ...(s.goals?.byDepartment ?? []),
    ...(s.goals?.byManager ?? []),
    ...(s.goals?.byAccount ?? []),
    ...(s.goals?.byDm ?? []),
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
  // People's org attributes file (accounts, projects, DMs, Santex Leads).
  await importReportFile(db, {
    path: path.resolve("fixtures/org/small/org-attributes.csv"),
    profile: "org-attributes",
  });
  // The monthly engagement file.
  await importReportFile(db, {
    path: path.resolve("fixtures/engagement/small/engagement-monthly.csv"),
    profile: "engagement-monthly",
  });
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

  it("the monthly engagement section lists the months of the cycle's period (named: everything)", async () => {
    const r = await buildReport(db, { cycle: cycleId, anonymized: false });
    const e = r.sections.engagementMonthly!;
    expect(e).not.toBeNull();
    expect(e.months.length).toBeGreaterThan(0);
    expect(e.suppressedMonths).toBe(0);
    for (const m of e.months) {
      expect(m.month).toMatch(/^\d{4}-\d{2}$/);
      expect(m.month >= r.cycle.periodStart.slice(0, 7)).toBe(true);
      expect(m.month <= r.cycle.periodEnd.slice(0, 7)).toBe(true);
      expect(m.hidden).toBe(false);
      expect(m.people).toBeGreaterThan(0);
      expect(m.segments).not.toBeNull();
      const s = m.segments!;
      expect(s.alto + s.medio + s.regular + s.bajo + s.falta).toBe(m.people);
      expect(m.participation).toBeCloseTo((m.people! - s.falta) / m.people!, 3);
    }
  });

  it("the anonymized engagement hides the months and the cells under the minimum", async () => {
    const r = await buildReport(db, { cycle: cycleId, anonymized: true });
    const e = r.sections.engagementMonthly!;
    expect(e.months.length).toBeGreaterThan(0);
    expect(e.suppressedMonths).toBe(e.months.filter((m) => m.hidden).length);
    for (const m of e.months) {
      if (m.hidden) {
        expect([
          m.people,
          m.respondents,
          m.participation,
          m.meanScore,
          m.segments,
        ]).toEqual([null, null, null, null, null]);
        continue;
      }
      expect(m.people).toBeGreaterThanOrEqual(MIN);
      if (m.segments) {
        for (const n of Object.values(m.segments)) {
          expect(n === 0 || n >= MIN).toBe(true);
        }
      }
    }
  });

  it("the qualitative section has five sentiments and the cut by side", async () => {
    const r = await buildReport(db, { cycle: cycleId, anonymized: false });
    const q = r.sections.qualitative!;
    expect(r.schemaMinor).toBe(SCHEMA_MINOR);
    const t = q.totals!;
    expect(t.positive + t.constructive + t.neutral + t.mixed + t.negative).toBe(
      t.total,
    );
    expect(t.total).toBe(
      q.sentimentByDimension.reduce((n, d) => n + d.total, 0),
    );
    // Every comment of the seed is from a self or a manager review.
    const { self, manager } = q.bySide!;
    expect((self?.totals?.total ?? 0) + (manager?.totals?.total ?? 0)).toBe(
      t.total,
    );
    for (const side of [self, manager]) {
      expect(side?.totals?.total ?? 0).toBeGreaterThan(0);
    }
    expect(q.topThemes[0].sentiment?.total).toBe(q.topThemes[0].count);
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
      const q = s.qualitative;
      if (q) {
        for (const slice of [q, q.bySide?.self, q.bySide?.manager]) {
          if (!slice) continue;
          if (slice.suppressed > 0) expect(slice.totals ?? null).toBeNull();
          for (const row of slice.sentimentByDimension) {
            expect(
              row.positive +
                row.constructive +
                row.neutral +
                row.mixed +
                row.negative,
            ).toBe(row.total);
          }
        }
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
        applicable: true,
        draft: null,
        declined: null,
      },
      {
        relationship: "manager",
        total: t.managerApplicable,
        submitted: t.managerSubmitted,
        applicable: true,
        draft: null,
        declined: null,
      },
    ]);
    const rows = (list: typeof c.byDepartment, rel: string) =>
      list
        .filter((x) => x.relationship === rel)
        .map((x) => [x.label, x.n, x.total, x.submitted]);
    // every group has a row per side, also where it applies to nobody
    const expected = (groups: typeof dept.groups, rel: "self" | "manager") =>
      groups.map((g) => [
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

  it("the executive progress is the completion's, not the requests that exist: pending participants are counted", async () => {
    const r = await buildReport(db, { cycle: cycleId, anonymized: false });
    const t = (
      await completionSummary(db, DEFAULT_ACTOR, {
        cycleId,
        groupBy: "none",
      })
    ).total!;
    const byRelationship = (rel: string) =>
      r.sections.executive.progress.find((p) => p.relationship === rel);
    expect(byRelationship("self")).toEqual({
      relationship: "self",
      total: t.selfApplicable,
      submitted: t.selfSubmitted,
    });
    expect(byRelationship("manager")).toEqual({
      relationship: "manager",
      total: t.managerApplicable,
      submitted: t.managerSubmitted,
    });
    // Same figures as the completion section of the same file.
    const c = r.sections.completion!.byRelationship!;
    for (const side of c) {
      expect(byRelationship(side.relationship)).toMatchObject({
        total: side.total,
        submitted: side.submitted,
      });
    }
    // Not "everybody who has a request submitted it": some do not.
    expect(t.selfSubmitted).toBeLessThan(t.selfApplicable);
    const anonymized = await buildReport(db, {
      cycle: cycleId,
      anonymized: true,
      minGroupSize: MIN,
    });
    expect(
      anonymized.sections.executive.progress.find(
        (p) => p.relationship === "self",
      ),
    ).toMatchObject({ total: t.selfApplicable, submitted: t.selfSubmitted });
  });

  it("people[] tells a pending assessment from a submitted one: a status for every participant, the completion module's", async () => {
    const r = await buildReport(db, { cycle: cycleId, anonymized: false });
    const people = r.sections.people!;
    const allowed = [
      "submitted",
      "in_progress",
      "not_started",
      "not_applicable",
    ];
    for (const p of people) {
      expect(allowed).toContain(p.selfStatus);
      expect(allowed).toContain(p.managerStatus);
    }
    const t = (
      await completionSummary(db, DEFAULT_ACTOR, { cycleId, groupBy: "none" })
    ).total!;
    const count = (side: "selfStatus" | "managerStatus", status: string) =>
      people.filter((p) => p[side] === status).length;
    // The rows add up to the completion section: submitted and pending (not
    // started or in progress) of the sides that apply.
    expect(count("selfStatus", "submitted")).toBe(t.selfSubmitted);
    expect(
      count("selfStatus", "not_started") + count("selfStatus", "in_progress"),
    ).toBe(t.selfApplicable - t.selfSubmitted);
    expect(count("managerStatus", "submitted")).toBe(t.managerSubmitted);
    expect(
      count("managerStatus", "not_started") +
        count("managerStatus", "in_progress"),
    ).toBe(t.managerApplicable - t.managerSubmitted);
    // Somebody has started and not submitted: it is not the same as not started.
    expect(people.some((p) => p.selfStatus === "in_progress")).toBe(true);
    expect(people.some((p) => p.selfStatus === "not_started")).toBe(true);
  });

  it("a cycle without final ratings says no data, not a row of zeros", async () => {
    const [{ n }] = await db.execute<{ n: number }>(
      sql`select count(*)::int as n from final_rating`,
    );
    expect(n).toBe(0);
    for (const anonymized of [false, true]) {
      const r = await buildReport(db, {
        cycle: cycleId,
        anonymized,
        minGroupSize: MIN,
      });
      const e = r.sections.executive;
      expect(e.distributionStatus).toBe("no_data");
      expect(e.distribution).toBeNull();
      expect(e.byDepartment).toEqual([]);
      expect(arturiaReportV1.safeParse(r).success).toBe(true);
      const html = renderHtml(r);
      const executive = html.match(
        /<section id="executive"[\s\S]*?<\/section>/,
      )![0];
      expect(executive).toContain(
        "Sin datos: el ciclo no tiene calificaciones",
      );
      // No bars of zeros under "Distribución de calificaciones".
      expect(executive).not.toContain("<svg");
    }
  });

  it("the goals carry the cut-off date overdue is measured at: the end of the period for a closed cycle", async () => {
    const r = await buildReport(db, { cycle: cycleId, anonymized: false });
    const [cycle] = await db
      .select()
      .from(reviewCycle)
      .where(eq(reviewCycle.id, cycleId));
    expect(r.sections.goals!.asOf).toBe(goalAsOf(cycle, todayLocal()));
    if (cycle.status === "closed" && cycle.periodEnd < todayLocal()) {
      expect(r.sections.goals!.asOf).toBe(r.cycle.periodEnd);
    }
    // The states are a partition: the parts of every group add up to its goals.
    for (const g of r.sections.goals!.byDepartment) {
      expect(g.completed + g.inProgress + g.overdue + g.closed).toBe(g.goals);
    }
    // The same figures as the goal analytics run as People for that date.
    const k = await goalKpis(db, DEFAULT_ACTOR, {
      cycleId,
      groupBy: "department",
    });
    expect(r.sections.goals!.asOf).toBe(k.asOf);
    expect(
      r.sections.goals!.byDepartment.reduce((n, g) => n + g.overdue, 0),
    ).toBe(k.groups.reduce((n, g) => n + g.overdue, 0));
  });

  it("completion anonymized: the direction view of areas and teams, teams as Equipo N, totals only when nothing is suppressed", async () => {
    const r = await buildReport(db, {
      cycle: cycleId,
      anonymized: true,
      minGroupSize: MIN,
    });
    const c = r.sections.completion!;
    const direction = { personId: null, role: "direction" } as const;
    const input = { cycleId, minGroupSize: MIN };
    const dir = await completionSummary(db, direction, {
      ...input,
      groupBy: "department",
    });
    const team = await completionSummary(db, direction, {
      ...input,
      groupBy: "manager",
    });
    const teams = await cycleTeams(db, cycleId, "Equipo");
    const selfRows = (rows: typeof c.byDepartment) =>
      rows.filter((x) => x.relationship === "self").map((x) => [x.label, x.n]);
    const withOthers = (s: typeof dir) => [
      ...s.groups,
      ...(s.others ? [s.others] : []),
    ];
    expect(c.participants).toBe(dir.participants);
    expect(selfRows(c.byDepartment)).toEqual(
      withOthers(dir).map((g) => [g.label ?? "Otros", g.participants]),
    );
    // the module gives direction no manager name: the export only numbers them
    expect(team.groups.every((g) => g.label === null)).toBe(true);
    expect(selfRows(c.byManager)).toEqual(
      withOthers(team).map((g) => [
        g.key === null ? "Otros" : teams.get(g.key),
        g.participants,
      ]),
    );
    for (const g of c.byManager)
      expect(g.label).toMatch(/^(Equipo \d+|Otros)$/);
    const account = await completionSummary(db, direction, {
      ...input,
      groupBy: "account",
    });
    const dm = await completionSummary(db, direction, {
      ...input,
      groupBy: "dm",
    });
    expect(c.suppressed).toEqual({
      byDepartment: dir.suppressed,
      byManager: team.suppressed,
      byAccount: account.suppressed,
      byDm: dm.suppressed,
    });
    // The totals above are the area and team cuts': account and DM have their own.
    const anySuppressed =
      c.suppressed.byDepartment + c.suppressed.byManager > 0;
    expect(c.byRelationship === null).toBe(
      anySuppressed || dir.total === null || team.total === null,
    );
    expect(c.byAccountTotal === null).toBe(
      account.suppressed > 0 || account.total === null,
    );
    expect(c.byDmTotal === null).toBe(dm.suppressed > 0 || dm.total === null);
  });

  it("org cuts: named, by account and by DM with their names, in completion, indicators and goals", async () => {
    const r = await buildReport(db, { cycle: cycleId, anonymized: false });
    const s = r.sections;
    const accounts = (rows: { label: string; n: number }[]) =>
      new Set(rows.map((x) => x.label));

    expect(s.completion?.byAccount?.length).toBeGreaterThan(0);
    expect(
      [...accounts(s.completion!.byAccount!)].every((l) =>
        /^(Cuenta [A-Z]|Otros)$/.test(l),
      ),
    ).toBe(true);
    // DMs are managers of the company, named as People wrote them.
    const dms = [...accounts(s.completion!.byDm!)].filter((l) => l !== "Otros");
    expect(dms.length).toBeGreaterThan(0);
    expect(dms.every((d) => names.includes(d))).toBe(true);
    // Every participant is in exactly one account group (self rows), one way or another.
    const selfN = (rows: NonNullable<typeof s.completion>["byAccount"]) =>
      rows!
        .filter((x) => x.relationship === "self")
        .reduce((n, x) => n + x.n, 0);
    expect(selfN(s.completion!.byAccount)).toBe(s.completion!.participants);
    expect(selfN(s.completion!.byDm)).toBe(s.completion!.participants);
    expect(s.completion!.suppressed).toMatchObject({ byAccount: 0, byDm: 0 });
    for (const d of s.indicators!.distribution) {
      expect(d.byAccount!.length).toBeGreaterThan(0);
      expect(d.byDm!.length).toBeGreaterThan(0);
      expect(d.suppressedBy).toEqual({ account: 0, dm: 0 });
    }
    const goalsN = (rows: NonNullable<typeof s.goals>["byAccount"]) =>
      rows!.reduce((n, x) => n + x.n, 0);
    expect(goalsN(s.goals!.byAccount)).toBe(s.executive.participants);
    expect(goalsN(s.goals!.byDm)).toBe(s.executive.participants);
    expect(renderHtml(r)).toContain("Por cuenta");
    expect(renderHtml(r)).toContain("Por DM");
  });

  it.each([2, MIN, 8])(
    "org cuts, anonymized (minimum %i): DMs are DM N, accounts keep their name, small groups folded, no total beside a suppressed one",
    async (min) => {
      const r = await buildReport(db, {
        cycle: cycleId,
        anonymized: true,
        minGroupSize: min,
      });
      const s = r.sections;
      const dmRows = [
        ...(s.completion?.byDm ?? []),
        ...(s.goals?.byDm ?? []),
        ...(s.indicators?.distribution.flatMap((d) => d.byDm ?? []) ?? []),
      ];
      for (const g of dmRows) expect(g.label).toMatch(/^(DM \d+|Otros)$/);
      for (const g of [
        ...(s.completion?.byAccount ?? []),
        ...(s.goals?.byAccount ?? []),
      ]) {
        expect(g.label).toMatch(/^(Cuenta [A-Z]|Otros)$/);
        expect(g.n).toBeGreaterThanOrEqual(min);
      }
      for (const g of groupSizes(r)) expect(g.n).toBeGreaterThanOrEqual(min);
      const c = s.completion!;
      const g = s.goals!;
      // No total next to a suppressed group, within each cut; one cut's
      // suppression never takes the totals of the others (the area and team
      // cuts decide the totals above, account and DM have their own).
      const cuts: [unknown, unknown, number | undefined][] = [
        [c.byAccount, c.byAccountTotal, c.suppressed.byAccount],
        [c.byDm, c.byDmTotal, c.suppressed.byDm],
        [g.byAccount, g.byAccountTotal, g.suppressed.byAccount],
        [g.byDm, g.byDmTotal, g.suppressed.byDm],
        ...s.indicators!.distribution.flatMap(
          (d): [unknown, unknown, number | undefined][] => [
            [d.byAccount, d.byAccountTotal, d.suppressedBy!.account],
            [d.byDm, d.byDmTotal, d.suppressedBy!.dm],
          ],
        ),
      ];
      for (const [rows, total, left] of cuts) {
        expect(rows).toBeDefined();
        if ((left ?? 0) > 0) expect(total).toBeNull();
      }
      if (c.suppressed.byDepartment + c.suppressed.byManager === 0) {
        expect(c.byRelationship).not.toBeNull();
      }
      if (
        g.suppressed.byDepartment +
          g.suppressed.byManager +
          g.suppressed.buckets ===
        0
      ) {
        expect(g.goals).not.toBeNull();
      }
      for (const d of s.indicators!.distribution) {
        if (d.suppressed === 0) expect(d.total).not.toBeNull();
      }
      // The same DM has the same number in every section.
      const numbered = new Map<string, number>();
      for (const rows of [
        c.byDm!.filter((x) => x.relationship === "self"),
        g.byDm!,
      ]) {
        for (const x of rows) {
          if (x.other) continue;
          expect(x.label).toMatch(/^DM \d+$/);
          numbered.set(x.label, (numbered.get(x.label) ?? 0) + 1);
        }
      }
      for (const text of [renderJson(r), renderHtml(r)]) {
        const folded = text.normalize("NFC");
        for (const n of names) expect(folded).not.toContain(n);
      }
    },
  );

  it("the same team has the same Equipo N in completion and goals", async () => {
    const r = await buildReport(db, {
      cycle: cycleId,
      anonymized: true,
      minGroupSize: 2,
    });
    const people = new Map(
      r.sections
        .completion!.byManager.filter((x) => x.relationship === "self")
        .map((x) => [x.label, x.n]),
    );
    const shared = r.sections.goals!.byManager.filter((x) =>
      people.has(x.label),
    );
    expect(shared.some((x) => x.label.startsWith("Equipo"))).toBe(true);
    for (const x of shared) expect(x.n).toBe(people.get(x.label));
  });

  it("completion is null when no assessment applies to anybody", async () => {
    const lead = await insertPerson({
      displayName: "Lía Prueba",
      noEmployment: true,
    });
    const [empty] = await db
      .insert(reviewCycle)
      .values({
        name: "Sin evaluaciones",
        periodStart: "2098-01-01",
        periodEnd: "2098-06-30",
        snapshotDate: "2098-06-30",
        status: "closed",
        components: {
          self: true,
          manager: true,
          peer: false,
          upward: false,
          calibration: false,
        },
        anonymity: { peer: "transparent", upward: "transparent" },
      })
      .returning({ id: reviewCycle.id });
    try {
      await insertParticipant({ cycleId: empty.id, personId: lead });
      const r = await buildReport(db, { cycle: empty.id, anonymized: false });
      expect(r.sections.executive.participants).toBe(1);
      expect(r.sections.completion).toBeNull();
    } finally {
      await db
        .delete(cycleParticipant)
        .where(eq(cycleParticipant.cycleId, empty.id));
      await db.delete(reviewCycle).where(eq(reviewCycle.id, empty.id));
      await db.delete(person).where(eq(person.id, lead));
    }
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
