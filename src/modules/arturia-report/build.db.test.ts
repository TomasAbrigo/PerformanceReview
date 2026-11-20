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
import { qualitativeUniverse } from "@/modules/qualitative-analysis";
import {
  agreementBySide,
  bestWorkOptions,
  managerFeedbackByGroup,
  readingProvenance,
  signalSummary,
  signalsByGroup,
  signalsVsIndicators,
  substanceByQuestion,
  themesBySide,
  toneByQuestion,
  valuedDistribution,
  yesNoByGroup,
  yesNoRates,
  yesNoTrend,
} from "@/modules/qualitative-analysis/reading";
import { runAnalysis } from "@/modules/qualitative-analysis/service";
import { ArturiaError, buildReport, resolveCycle } from "./build";
import { runExportCli } from "./cli";
import { solvable } from "@/modules/insights/suppression-attack";
import { likertLabel } from "@/modules/likert";
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
    expect(r.sections.qualitative?.themes.length).toBeGreaterThan(0);
    expect(r.sections.people?.length).toBe(r.sections.executive.participants);
    // Retention and engagement are labelled by value in the report's
    // language, never with Bamboo's text (which can name the person, #130).
    const scale = (role: "retention" | "engagement") =>
      [1, 2, 3, 4, 5].map((v) => likertLabel(role, v, "es"));
    for (const p of r.sections.people!) {
      if (p.retention !== null)
        expect(scale("retention")).toContain(p.retention);
      if (p.engagement !== null) {
        expect(scale("engagement")).toContain(p.engagement);
      }
    }
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
        // No group is hidden next to a public total (#130): what is shown
        // adds up to it.
        if (d.total) {
          expect(d.groups.reduce((n, g) => n + g.n, 0)).toBe(d.total.n);
        }
      }
      const m = s.indicators?.riskMatrix;
      if (m) {
        // riskCount is the risk cell itself, masked like any other cell
        expect(m.riskCount).toBe(m.cells.find((x) => x.risk)!.count);
        // Given the cells, the total and the bands' totals (public anyway),
        // try to solve for each masked cell (#130).
        const named = (
          await buildReport(db, { cycle: cycleId, anonymized: false })
        ).sections.indicators!.riskMatrix!;
        const table = (x: typeof m) =>
          ["low", "mid", "high"].map((rb) =>
            ["low", "mid", "high"].map(
              (eb) =>
                x.cells.find((c) => c.retention === rb && c.engagement === eb)!
                  .count,
            ),
          );
        const masked = table(m);
        if (masked.flat().some((c) => c !== null)) {
          expect(m.total).toBe(named.total);
          expect(solvable(masked, table(named) as number[][])).toEqual([]);
        }
      }
      const g = s.goals!;
      const hiddenGoals = g.suppressed.byDepartment + g.suppressed.byManager;
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
        // The minimum is measured on who has the data (#130).
        expect(row.peopleWithGoals === 0 || row.peopleWithGoals >= min).toBe(
          true,
        );
      }
      // Buckets: never a single one hidden next to the public total (#130).
      const hiddenBuckets = g.buckets.filter((b) => b.hidden).length;
      expect(hiddenBuckets).not.toBe(1);
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

  describe("qualitative section: the open-text reading (#129)", () => {
    const f = () => ({ cycleId });
    const direction = { personId: null, role: "direction" } as const;

    /**
     * The four Santex yes/no questions as an import stores them (a text
     * question with a slug + hash dimension, flagged yes/no), answered by
     * every submitted request of the side that gets them. Deterministic: a
     * quarter say No to security, a third to the environment, and exactly two
     * managers say No to frequent conversations (a figure under the minimum).
     */
    beforeAll(async () => {
      const world = async (cycle: string) => {
        const q = (prompt: string, dimension: string) =>
          db
            .execute<{ id: string }>(
              sql`insert into question_revision (cycle_id, section_title, prompt, kind, applies_to, visible_to_reviewee, required, sort, dimension, yes_no)
              values (${cycle}::uuid, ${JSON.stringify({ es: "S", en: "S" })}::jsonb,
                ${JSON.stringify({ es: prompt, en: prompt })}::jsonb, 'text',
                array['self','manager'], true, false, 900, ${dimension}, true)
              returning id`,
            )
            .then(([row]) => row.id);
        const answer = (
          questionId: string,
          side: "self" | "manager",
          no: string,
          yes: string,
        ) =>
          db.execute(sql`
          insert into answer (request_id, question_revision_id, text_value)
          select r.id, ${questionId}::uuid, ${sql.raw(`case when ${no} then 'No' else ${yes} end`)}
          from review_request r
          where r.cycle_id = ${cycle}::uuid and r.relationship = ${side}
            and r.status = 'submitted' and r.deleted_at is null`);
        const security = await q(
          "Am I following all Information Security Policies and Procedures of the Company?",
          "custom_am_i_following_all_information_security_02c50291",
        );
        await answer(
          security,
          "self",
          "abs(hashtext(r.id::text)) % 4 = 0",
          "'Yes'",
        );
        const social = await q(
          'Do I contribute with initiatives related to "Social impact"? How?',
          "custom_do_i_contribute_with_initiatives_related_097f5c06",
        );
        await answer(
          social,
          "self",
          "abs(hashtext(r.id::text)) % 5 = 0",
          "'Sí, con voluntariado en una escuela y donaciones'",
        );
        const environmental = await q(
          'Do I contribute with initiatives related to "Environmental impact"? How?',
          "custom_do_i_contribute_with_initiatives_related_80969923",
        );
        await answer(
          environmental,
          "self",
          "abs(hashtext(r.id::text)) % 3 = 0",
          "'Sí, reciclando y moviéndome en bici'",
        );
        const conversations = await q(
          "Do I speak with this employee frequently enough that I consider myself to be aware of his/her needs and current situation?",
          "custom_do_i_speak_with_this_employee_frequently_d2f1a686",
        );
        await answer(
          conversations,
          "manager",
          "r.id in (select id from review_request where cycle_id = '" +
            cycle +
            "' and relationship = 'manager' and status = 'submitted' and deleted_at is null order by id limit 2)",
          "'Yes'",
        );
        // The closed questions: "valued" (1-4, letter choices) and "best work" (one option).
        const closed = (
          prompt: string,
          dimension: string,
          role: string | null,
          choices: unknown,
        ) =>
          db
            .execute<{ id: string }>(
              sql`insert into question_revision (cycle_id, section_title, prompt, kind, applies_to, visible_to_reviewee, required, sort, role, dimension, choices)
              values (${cycle}::uuid, ${JSON.stringify({ es: "S", en: "S" })}::jsonb,
                ${JSON.stringify({ es: prompt, en: prompt })}::jsonb, 'single_choice',
                array['self'], true, false, 901, ${role}, ${dimension}, ${JSON.stringify(choices)}::jsonb)
              returning id`,
            )
            .then(([row]) => row.id);
        const valued = await closed(
          "How well does Meridian recognize my value?",
          "valued",
          "valued",
          [
            {
              value: "A",
              label: { es: "Me siento muy valorado", en: "Highly valued" },
            },
            {
              value: "B",
              label: {
                es: "A veces me siento valorado",
                en: "Sometimes valued",
              },
            },
            { value: "C", label: { es: "No estoy seguro", en: "Not sure" } },
            {
              value: "D",
              label: { es: "No me siento valorado", en: "Not valued" },
            },
          ],
        );
        await db.execute(sql`
        insert into answer (request_id, question_revision_id, option_label, option_value)
        select r.id, ${valued}::uuid, 'x', 1 + abs(hashtext(r.id::text)) % 4
        from review_request r
        where r.cycle_id = ${cycle}::uuid and r.relationship = 'self'
          and r.status = 'submitted' and r.deleted_at is null`);
        const best = await closed(
          "What would help me do my best work?",
          "best_work",
          null,
          [
            { value: "nothing", label: { es: "Nada", en: "Nothing" } },
            {
              value: "direction",
              label: { es: "Más rumbo", en: "Better direction" },
            },
            { value: "other", label: { es: "Otro", en: "Other" } },
          ],
        );
        await db.execute(sql`
        insert into answer (request_id, question_revision_id, option_label)
        select r.id, ${best}::uuid, (array['nothing', 'direction', 'other'])[1 + abs(hashtext(r.id::text)) % 3]
        from review_request r
        where r.cycle_id = ${cycle}::uuid and r.relationship = 'self'
          and r.status = 'submitted' and r.deleted_at is null`);
      };
      // The same questions in the cycle before, so there are series by cycle.
      const [previous] = await db.execute<{ id: string }>(sql`
        select id from review_cycle
        where status <> 'draft' and deleted_at is null and id <> ${cycleId}::uuid
          and period_end < (select period_end from review_cycle where id = ${cycleId}::uuid)
        order by period_end desc limit 1`);
      if (previous) await world(previous.id);
      await world(cycleId);
      await runAnalysis(db, { provider: new MockProvider() });
    }, 120_000);

    it("the named report says what /insights/qualitative says for that cycle: the readers' own numbers, in people", async () => {
      const r = await buildReport(db, { cycle: cycleId, anonymized: false });
      expect(r.schemaMinor).toBe(SCHEMA_MINOR);
      expect(SCHEMA_MINOR).toBe(6);
      const q = r.sections.qualitative!;
      expect(arturiaReportV1.safeParse(r).success).toBe(true);
      // The old sentiment-by-answer shape is gone.
      for (const old of [
        "totals",
        "sentimentByDimension",
        "trend",
        "topThemes",
        "bySide",
      ]) {
        expect(q).not.toHaveProperty(old);
      }
      // The unit is the person: distinct reviewees, never answers.
      const universe = await qualitativeUniverse(db, DEFAULT_ACTOR, f());
      expect(q.people).toBe(universe.people);
      const [{ n }] = await db.execute<{ n: number }>(sql`
        select count(distinct cp.reviewee_person_id)::int as n
        from answer a
        join review_request r on r.id = a.request_id
        join cycle_participant cp on cp.id = r.participant_id
        where r.cycle_id = ${cycleId}::uuid and r.status = 'submitted'
          and r.deleted_at is null and cp.removed_at is null`);
      expect(q.people).toBe(n);
      expect(q.provenance.labels).toBeGreaterThan(q.people);

      // Provenance: the seed read the answers with the mock, and the report says so.
      const prov = (await readingProvenance(db, DEFAULT_ACTOR, f()))!;
      expect(q.provenance).toMatchObject({
        labels: prov.labels,
        human: prov.human,
        imported: prov.imported,
        machine: prov.machine,
        demo: true,
        providers: prov.providers,
      });
      expect(q.provenance.demo).toBe(prov.demo);
      expect(q.provenance.correctedShare).toBeCloseTo(prov.human / prov.labels);
      expect(q.provenance.lastRun?.provider).toBe("mock");
      expect(q.provenance.lastRun?.finishedAt).toMatch(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/,
      );
      expect(renderHtml(r)).toContain("Lectura de demostración");

      // Substance, themes, agreement, tone: the readers' rows.
      expect(q.substance).toEqual(
        (await substanceByQuestion(db, DEFAULT_ACTOR, f())).map((x) => ({
          dimension: x.dimension,
          side: x.side,
          people: x.people,
          none: x.none,
          generic: x.generic,
          specific: x.specific,
        })),
      );
      expect(q.substance.length).toBeGreaterThan(0);
      for (const t of q.themes) {
        const read = await themesBySide(db, DEFAULT_ACTOR, {
          ...f(),
          dimension: t.dimension,
        });
        expect(t.people).toEqual(read.people);
        expect(t.rows).toEqual(
          read.rows.map((x) => ({
            theme: x.theme,
            self: x.self,
            manager: x.manager,
            quotes: x.quotes,
          })),
        );
        expect(t.rows.length).toBeGreaterThan(0);
      }
      expect(q.themes.map((t) => t.dimension)).toEqual([
        "strengths",
        "improvement",
      ]);
      const agreement = await agreementBySide(db, DEFAULT_ACTOR, f());
      expect(q.agreement).toEqual(agreement);
      expect(
        (await toneByQuestion(db, DEFAULT_ACTOR, f())).map((x) => [
          x.dimension,
          x.side,
          x.people,
        ]),
      ).toEqual(q.tone.map((x) => [x.dimension, x.side, x.people]));
      for (const x of q.tone) {
        expect(
          (x.positive ?? 0) +
            (x.constructive ?? 0) +
            (x.neutral ?? 0) +
            (x.mixed ?? 0) +
            (x.negative ?? 0),
        ).toBe(x.people);
      }
      // Self and manager are never added in one row.
      for (const x of [...q.substance, ...q.tone, ...q.yesNo.rows]) {
        expect(["self", "manager"]).toContain(x.side);
      }
    });

    it("signals, yes/no and closed questions are the readers' numbers; the named report has no hidden cell", async () => {
      const r = await buildReport(db, { cycle: cycleId, anonymized: false });
      const q = r.sections.qualitative!;
      const sig = (await signalSummary(db, DEFAULT_ACTOR, f()))!;
      expect(q.signals).toMatchObject({
        people: sig.people,
        withAny: sig.withAny,
        rows: sig.rows,
      });
      expect(sig.rows.length).toBeGreaterThan(0);
      // The cuts by group: the readers' groups, the people add up to the base.
      for (const [cut, groupBy] of [
        [q.signals!.byDepartment, "department"],
        [q.signals!.byAccount, "account"],
        [q.signals!.byDm, "dm"],
      ] as const) {
        const read = await signalsByGroup(db, DEFAULT_ACTOR, f(), groupBy);
        expect(cut.suppressed).toBe(0);
        expect(cut.groups.reduce((n, g) => n + g.people, 0)).toBe(sig.people);
        const byLabel = new Map(read.map((g) => [g.label ?? "Otros", g]));
        for (const g of cut.groups) {
          const row = byLabel.get(g.label)!;
          expect(row, g.label).toBeDefined();
          expect(g.people).toBe(row.people);
          expect(g.withAny).toBe(row.withAny);
          expect(g.counts).toEqual(row.counts);
        }
      }
      // Yes/no: the rates per question, the alerts where a No is one.
      const yn = await yesNoRates(db, DEFAULT_ACTOR, f());
      expect(q.yesNo.rows).toEqual(
        yn.map((x) => ({
          dimension: x.dimension,
          side: x.side,
          kind: x.kind,
          people: x.people,
          yes: x.yes,
          no: x.no,
          alert: ["security", "conversations"].includes(x.kind) && x.no > 0,
        })),
      );
      expect(q.yesNo.rows.map((x) => x.kind).sort()).toEqual([
        "conversations",
        "impact",
        "impact",
        "security",
      ]);
      for (const x of q.yesNo.rows) expect(x.yes! + x.no!).toBe(x.people);
      // Information security = No and frequent conversations = No are called out.
      expect(
        q.yesNo.rows
          .filter((x) => x.alert)
          .map((x) => x.kind)
          .sort(),
      ).toEqual(["conversations", "security"]);
      expect(
        q.yesNo.rows.find((x) => x.kind === "conversations"),
      ).toMatchObject({ side: "manager", no: 2, alert: true });
      expect(q.yesNo.initiatives.length).toBeGreaterThan(0);
      const html = renderHtml(r);
      expect(html).toContain("Seguridad de la información: ");
      expect(html).toContain("Conversaciones frecuentes: en 2 de ");
      // Closed questions: valued as a scale (never a sentiment), best work as options.
      const valued = (await valuedDistribution(db, DEFAULT_ACTOR, f())).total!;
      expect(q.closed.valued).toMatchObject({
        people: valued.people,
        counts: valued.counts,
        notValued: valued.notValued,
      });
      expect(q.closed.valued!.labels.every((l) => typeof l === "string")).toBe(
        true,
      );
      const best = (await bestWorkOptions(db, DEFAULT_ACTOR, f()))!;
      expect(q.closed.bestWork).toMatchObject({ people: best.people });
      expect(
        q.closed.bestWork!.options.map((o) => [o.option, o.people]),
      ).toEqual(best.options.map((o) => [o.option, o.people]));
      // The manager's feedback per group.
      const fb = await managerFeedbackByGroup(
        db,
        DEFAULT_ACTOR,
        f(),
        "department",
      );
      expect(
        q.managerFeedback.byDepartment.groups.map((g) => [g.label, g.people]),
      ).toEqual(fb.map((g) => [g.label ?? "Otros", g.people]));
    });

    it("signals by the manager's answer, Yes / No by group and by cycle, valued by group and by cycle: the readers' numbers, named", async () => {
      const r = await buildReport(db, { cycle: cycleId, anonymized: false });
      const q = r.sections.qualitative!;
      const input = f();
      // Signals crossed with retention / engagement: a row per person and answer value.
      const vs = await signalsVsIndicators(db, DEFAULT_ACTOR, input);
      expect(vs.length).toBeGreaterThan(0);
      expect(
        q.signals!.byIndicator.map((x) => [
          x.indicator,
          x.value,
          x.people,
          x.withSignal,
        ]),
      ).toEqual(vs.map((x) => [x.role, x.value, x.people, x.withSignal]));
      for (const x of q.signals!.byIndicator) {
        // labelled by value, in the report's language, never with a name
        expect(x.label, `${x.indicator} ${x.value}`).toBe(
          likertLabel(x.indicator, x.value, "es"),
        );
        for (const n of names) expect(x.label ?? "").not.toContain(n);
        expect(x.withSignal!).toBeLessThanOrEqual(x.people);
      }

      // Yes / No by group: the readers' groups, the people add up to the question's.
      const dims = q.yesNo.rows.map((x) => x.dimension);
      expect(q.yesNo.byGroup.map((x) => x.dimension)).toEqual(dims);
      for (const [cut, groupBy] of [
        ["byDepartment", "department"],
        ["byAccount", "account"],
        ["byDm", "dm"],
      ] as const) {
        const read = await yesNoByGroup(db, DEFAULT_ACTOR, input, groupBy);
        for (const d of q.yesNo.byGroup) {
          const row = q.yesNo.rows.find((x) => x.dimension === d.dimension)!;
          const groups = d[cut].groups;
          expect(d[cut].suppressed).toBe(0);
          expect(groups.reduce((n, g) => n + g.people, 0)).toBe(row.people);
          expect(groups.reduce((n, g) => n + (g.yes ?? 0), 0)).toBe(row.yes);
          expect(groups.reduce((n, g) => n + (g.no ?? 0), 0)).toBe(row.no);
          const byLabel = new Map(
            read
              .filter((x) => x.dimension === d.dimension)
              .map((x) => [x.label ?? "Otros", x]),
          );
          for (const g of groups) {
            expect(g.people).toBe(byLabel.get(g.label)!.people);
            expect(g.yes).toBe(byLabel.get(g.label)!.yes);
            expect(g.no).toBe(byLabel.get(g.label)!.no);
          }
        }
      }
      // By cycle: the readers' trend, oldest first; this cycle's point is the question's row.
      const trend = await yesNoTrend(db, DEFAULT_ACTOR, {});
      for (const d of q.yesNo.byCycle) {
        expect(d.cycles.map((c) => [c.cycleId, c.people, c.yes, c.no])).toEqual(
          trend
            .filter((x) => x.dimension === d.dimension)
            .map((x) => [x.cycleId, x.people, x.yes, x.no]),
        );
        const ends = d.cycles.map((c) => c.periodEnd);
        expect([...ends].sort()).toEqual(ends);
        const now = d.cycles.find((c) => c.cycleId === cycleId)!;
        const row = q.yesNo.rows.find((x) => x.dimension === d.dimension)!;
        expect([now.people, now.yes, now.no]).toEqual([
          row.people,
          row.yes,
          row.no,
        ]);
      }
      expect(
        q.yesNo.byCycle.find((d) => d.dimension === dims[0])!.cycles.length,
      ).toBeGreaterThanOrEqual(2);

      // Valued: by group and by cycle.
      const v = q.closed.valued!;
      for (const [cut, groupBy] of [
        ["byDepartment", "department"],
        ["byAccount", "account"],
        ["byDm", "dm"],
      ] as const) {
        const read = (
          await valuedDistribution(db, DEFAULT_ACTOR, input, groupBy)
        ).byGroup;
        expect(v[cut].suppressed).toBe(0);
        expect(v[cut].groups.map((g) => [g.label, g.people, g.counts])).toEqual(
          read.map((g) => [g.label ?? "Otros", g.people, g.counts]),
        );
        expect(v[cut].groups.reduce((n, g) => n + g.people, 0)).toBe(v.people);
        for (const g of v[cut].groups) {
          expect(g.notValued).toBe(g.counts[0]! + g.counts[1]!);
        }
      }
      const vt = (await valuedDistribution(db, DEFAULT_ACTOR, input)).trend;
      expect(
        v.byCycle.map((c) => [c.cycleId, c.people, c.counts, c.notValued]),
      ).toEqual(vt.map((c) => [c.cycleId, c.people, c.counts, c.notValued]));
      expect(v.byCycle.length).toBeGreaterThanOrEqual(2);
      expect(v.byCycle.at(-1)!.cycleId).toBe(cycleId);
      // the HTML draws them
      const html = renderHtml(r);
      for (const t of [
        "Señales según la respuesta del manager",
        "Sí y No por grupo",
        "Sí y No por ciclo",
        "Valoración por grupo",
        "Valoración por ciclo",
      ]) {
        expect(html).toContain(t);
      }
    });

    it("the named report keeps the representative quotes; no seed name survives in them", async () => {
      const r = await buildReport(db, { cycle: cycleId, anonymized: false });
      const quotes = r.sections
        .qualitative!.themes.flatMap((t) => t.rows)
        .flatMap((x) => [...x.quotes.self, ...x.quotes.manager]);
      expect(quotes.length).toBeGreaterThan(0);
      for (const text of quotes) {
        for (const n of names) expect(text).not.toContain(n);
      }
    });

    it.each(["es", "en"] as const)(
      "no raw key reaches the HTML (%s), the questions are named, the two impact questions told apart",
      async (locale) => {
        for (const anonymized of [false, true]) {
          const r = await buildReport(db, {
            cycle: cycleId,
            anonymized,
            minGroupSize: 2,
            locale,
          });
          const html = renderHtml(r);
          const section = html.match(
            /<section id="qualitative"[\s\S]*?<\/section>/,
          )![0];
          expect(
            // (the named report's quotes are the people's own words: leave them out)
            section
              .replace(/<ul class="quotes">[\s\S]*?<\/ul>/g, "")
              .match(
                /custom_|best_work|company_request|role_fit|\b(comunicacion|planificacion|proactividad|voluntariado|donaciones|reciclaje|aprendizaje|tecnica|negocio)\b/,
              )?.[0] ?? null,
          ).toBeNull();
          const labels = new Map(
            r.sections.qualitative!.questions.map((x) => [
              x.dimension,
              x.label,
            ]),
          );
          const names4 =
            locale === "es"
              ? [
                  "Seguridad de la información",
                  "Impacto social",
                  "Impacto ambiental",
                  "Conversaciones frecuentes",
                ]
              : [
                  "Information security",
                  "Social impact",
                  "Environmental impact",
                  "Frequent conversations",
                ];
          for (const name of names4) {
            expect([...labels.values()]).toContain(name);
            expect(section).toContain(name);
          }
          // every question key of the rows has a name, and no two share it
          for (const row of r.sections.qualitative!.yesNo.rows) {
            expect(labels.get(row.dimension)).toBeDefined();
          }
          expect(new Set(labels.values()).size).toBe(labels.size);
        }
      },
    );

    /** Every count of people of the section, with where it is and what it must hold. */
    function counts(q: NonNullable<ArturiaReport["sections"]["qualitative"]>) {
      const base: [string, number | null][] = [["people", q.people]];
      const cell: [string, number | null][] = [];
      const row = (where: string, x: Record<string, unknown>, keys: string[]) =>
        keys.forEach((k) =>
          cell.push([`${where}.${k}`, x[k] as number | null]),
        );
      q.substance.forEach((x, i) => {
        base.push([`substance[${i}]`, x.people]);
        row(`substance[${i}]`, x, ["none", "generic", "specific"]);
      });
      for (const [name, cut] of Object.entries(q.managerFeedback)) {
        cut.groups.forEach((g, i) => {
          base.push([`feedback.${name}[${i}]`, g.people]);
          row(`feedback.${name}[${i}]`, g, ["none", "generic", "specific"]);
        });
      }
      q.themes.forEach((t, i) => {
        for (const s of ["self", "manager"] as const) {
          if (t.people[s] !== null)
            base.push([`themes[${i}].${s}`, t.people[s]]);
        }
        t.rows.forEach((x, j) =>
          row(`themes[${i}][${j}]`, x, ["self", "manager"]),
        );
      });
      q.agreement.rows.forEach((x, i) => {
        base.push([`agreement[${i}]`, x.both]);
        row(`agreement[${i}]`, x, ["shared"]);
      });
      q.agreement.blindSpots.forEach((x, i) =>
        base.push([`blind[${i}]`, x.people]),
      );
      cell.push(["agreement.blindPeople", q.agreement.blindPeople]);
      if (q.agreement.improvementBoth !== null) {
        base.push(["agreement.improvementBoth", q.agreement.improvementBoth]);
      }
      if (q.signals) {
        base.push(["signals.people", q.signals.people]);
        cell.push(["signals.withAny", q.signals.withAny]);
        q.signals.rows.forEach((x, i) => {
          base.push([`signals.rows[${i}]`, x.people]);
          row(`signals.rows[${i}]`, x, ["self", "manager"]);
        });
        for (const [name, cut] of Object.entries({
          department: q.signals.byDepartment,
          account: q.signals.byAccount,
          dm: q.signals.byDm,
        })) {
          cut.groups.forEach((g, i) => {
            base.push([`signals.${name}[${i}]`, g.people]);
            cell.push([`signals.${name}[${i}].withAny`, g.withAny]);
            for (const [s, v] of Object.entries(g.counts)) {
              cell.push([`signals.${name}[${i}].${s}`, v]);
            }
          });
        }
      }
      q.yesNo.rows.forEach((x, i) => {
        base.push([`yesNo[${i}]`, x.people]);
        row(`yesNo[${i}]`, x, ["yes", "no"]);
      });
      q.yesNo.initiatives.forEach((x, i) => {
        base.push([`initiatives[${i}]`, x.people]);
        x.rows.forEach((y, j) =>
          base.push([`initiatives[${i}][${j}]`, y.people]),
        );
      });
      if (q.closed.valued) {
        base.push(["valued", q.closed.valued.people]);
        q.closed.valued.counts.forEach((c, i) =>
          cell.push([`valued[${i}]`, c]),
        );
        cell.push(["notValued", q.closed.valued.notValued]);
      }
      if (q.closed.bestWork) {
        base.push(["bestWork", q.closed.bestWork.people]);
        q.closed.bestWork.options.forEach((o, i) =>
          cell.push([`bestWork[${i}]`, o.people]),
        );
      }
      q.tone.forEach((x, i) => {
        base.push([`tone[${i}]`, x.people]);
        row(`tone[${i}]`, x, [
          "positive",
          "constructive",
          "neutral",
          "mixed",
          "negative",
        ]);
      });
      // signals by the manager's answer, Yes / No by group and cycle, valued by group and cycle
      q.signals?.byIndicator.forEach((x, i) => {
        base.push([`byIndicator[${i}]`, x.people]);
        row(`byIndicator[${i}]`, x, ["withSignal"]);
      });
      q.yesNo.byGroup.forEach((d, i) => {
        for (const [name, cut] of Object.entries({
          department: d.byDepartment,
          account: d.byAccount,
          dm: d.byDm,
        })) {
          cut.groups.forEach((g, j) => {
            base.push([`yesNo.byGroup[${i}].${name}[${j}]`, g.people]);
            row(`yesNo.byGroup[${i}].${name}[${j}]`, g, ["yes", "no"]);
          });
        }
      });
      q.yesNo.byCycle.forEach((d, i) =>
        d.cycles.forEach((c, j) => {
          base.push([`yesNo.byCycle[${i}][${j}]`, c.people]);
          row(`yesNo.byCycle[${i}][${j}]`, c, ["yes", "no"]);
        }),
      );
      const val = q.closed.valued;
      if (val) {
        for (const [name, cut] of Object.entries({
          department: val.byDepartment,
          account: val.byAccount,
          dm: val.byDm,
        })) {
          cut.groups.forEach((g, j) => {
            base.push([`valued.${name}[${j}]`, g.people]);
            g.counts.forEach((c, k) =>
              cell.push([`valued.${name}[${j}][${k}]`, c]),
            );
            cell.push([`valued.${name}[${j}].notValued`, g.notValued]);
          });
        }
        val.byCycle.forEach((c, j) => {
          base.push([`valued.byCycle[${j}]`, c.people]);
          c.counts.forEach((n, k) =>
            cell.push([`valued.byCycle[${j}][${k}]`, n]),
          );
          cell.push([`valued.byCycle[${j}].notValued`, c.notValued]);
        });
      }
      return { base, cell };
    }

    /** A list whose sum is public: no hidden cell can be solved for. */
    const unsolvable = (cells: (number | null)[], sum: number) => {
      const hidden = cells.filter((c) => c === null).length;
      if (!hidden) return true;
      const room = sum - cells.reduce<number>((a, c) => a + (c ?? 0), 0);
      return hidden >= 2 && room > hidden;
    };

    it.each([2, MIN, 8, 20])(
      "anonymized with minimum %i: aggregates only, no quote, no figure of fewer people than the minimum, no hidden cell solvable",
      async (min) => {
        const r = await buildReport(db, {
          cycle: cycleId,
          anonymized: true,
          minGroupSize: min,
        });
        const q = r.sections.qualitative;
        if (!q) return; // everyone is under the minimum: nothing to publish
        expect(arturiaReportV1.safeParse(r).success).toBe(true);
        expect(q.people).toBeGreaterThanOrEqual(min);
        // no verbatim quote
        for (const t of q.themes) {
          for (const x of t.rows) {
            expect(x.quotes).toEqual({ self: [], manager: [] });
          }
        }
        const { base, cell } = counts(q);
        for (const [where, v] of base) {
          expect(v === null || v >= min, `${where} = ${v}`).toBe(true);
        }
        for (const [where, v] of cell) {
          expect(v === null || v === 0 || v >= min, `${where} = ${v}`).toBe(
            true,
          );
        }
        // lists that add up to a public base
        for (const x of q.substance) {
          expect(unsolvable([x.none, x.generic, x.specific], x.people)).toBe(
            true,
          );
        }
        for (const x of q.tone) {
          expect(
            unsolvable(
              [x.positive, x.constructive, x.neutral, x.mixed, x.negative],
              x.people,
            ),
          ).toBe(true);
        }
        for (const x of q.yesNo.rows) {
          expect(unsolvable([x.yes, x.no], x.people)).toBe(true);
          // an alert needs its figure
          if (x.alert) expect(x.no).not.toBeNull();
        }
        if (q.closed.valued) {
          expect(
            unsolvable(q.closed.valued.counts, q.closed.valued.people),
          ).toBe(true);
        }
        if (q.closed.bestWork) {
          expect(
            unsolvable(
              q.closed.bestWork.options.map((o) => o.people),
              q.closed.bestWork.people,
            ),
          ).toBe(true);
        }
        for (const cut of Object.values(q.managerFeedback)) {
          for (const g of cut.groups) {
            expect(unsolvable([g.none, g.generic, g.specific], g.people)).toBe(
              true,
            );
          }
        }
        // a pair "n of base": neither the count nor its complement under the minimum
        for (const x of q.agreement.rows) {
          if (x.shared !== null) {
            expect(x.both - x.shared === 0 || x.both - x.shared >= min).toBe(
              true,
            );
          }
        }
        // the cuts by group: nobody hidden next to the public total, every column unsolvable
        const s = q.signals;
        if (s) {
          for (const cut of [s.byDepartment, s.byAccount, s.byDm]) {
            expect(
              cut.groups.reduce((n, g) => n + g.people, 0) + cut.suppressed,
            ).toBe(s.people);
            const column = (
              pick: (g: (typeof cut.groups)[number]) => number | null,
            ) => cut.groups.map(pick);
            const withAny = s.withAny;
            if (withAny !== null && cut.suppressed === 0) {
              expect(
                unsolvable(
                  column((g) => g.withAny),
                  withAny,
                ),
              ).toBe(true);
            }
            for (const row of s.rows) {
              if (cut.suppressed > 0) continue;
              expect(
                unsolvable(
                  column((g) => g.counts[row.signal] ?? 0),
                  row.people,
                ),
                `${row.signal} column`,
              ).toBe(true);
            }
          }
        }
        // the groups are folded, not dropped: DMs are numbered, accounts keep their name
        for (const g of s?.byDm.groups ?? []) {
          expect(g.label).toMatch(/^(DM \d+|Otros)$/);
        }

        // --- signals by the manager's answer: "n of people" pairs
        for (const x of s?.byIndicator ?? []) {
          if (x.withSignal !== null) {
            expect(
              x.people - x.withSignal === 0 || x.people - x.withSignal >= min,
            ).toBe(true);
          }
        }
        // --- Yes / No and valued by group (a table: rows are the groups, whose
        // people are public; columns are the answers, whose totals are public
        // when the question's own row publishes them). A hidden cell next to
        // none other in its row, or in a column with a public total, could be
        // solved for. (The unit test of maskTable attacks small tables fully.)
        const hiddenIn = (cells: (number | null)[]) =>
          cells.filter((c) => c === null).length;
        for (const d of q.yesNo.byGroup) {
          const total = q.yesNo.rows.find((x) => x.dimension === d.dimension);
          for (const cut of [d.byDepartment, d.byAccount, d.byDm]) {
            for (const g of cut.groups) {
              expect(hiddenIn([g.yes, g.no]), JSON.stringify(g)).not.toBe(1);
            }
            if (cut.suppressed > 0 || !total) continue;
            expect(cut.groups.reduce((n, g) => n + g.people, 0)).toBe(
              total.people,
            );
            for (const k of ["yes", "no"] as const) {
              if (total[k] === null) continue;
              expect(
                hiddenIn(cut.groups.map((g) => g[k])),
                `${d.dimension} ${k} column`,
              ).not.toBe(1);
            }
          }
        }
        // by cycle: each row adds up to its people
        for (const d of q.yesNo.byCycle) {
          for (const c of d.cycles) {
            expect(unsolvable([c.yes, c.no], c.people)).toBe(true);
          }
        }
        const v = q.closed.valued;
        if (v) {
          for (const cut of [v.byDepartment, v.byAccount, v.byDm]) {
            for (const g of cut.groups) {
              expect(hiddenIn(g.counts), JSON.stringify(g)).not.toBe(1);
              // the share at 1-2 is there only when it solves nothing
              if (g.notValued !== null) {
                const hid = (i: number) => g.counts[i] === null;
                const h12 = [0, 1].filter(hid).length;
                const h34 = [2, 3].filter(hid).length;
                expect(h12 === 0 || (h12 === 2 && h34 === 0)).toBe(true);
              }
            }
            if (cut.suppressed > 0) continue;
            expect(cut.groups.reduce((n, g) => n + g.people, 0)).toBe(v.people);
            for (const k of [0, 1, 2, 3]) {
              if (v.counts[k] === null) continue;
              expect(
                hiddenIn(cut.groups.map((g) => g.counts[k])),
                `value ${k + 1} column ${JSON.stringify([v.counts, v.people, cut.groups.map((g) => [g.people, g.counts])])}`,
              ).not.toBe(1);
            }
          }
          for (const c of v.byCycle) {
            expect(unsolvable(c.counts, c.people)).toBe(true);
          }
        }
      },
    );

    it("anonymized: not a word of any free-text answer, no name, no email, in the JSON or the HTML", async () => {
      const answers = await db.execute<{ t: string }>(sql`
        select distinct a.text_value as t
        from answer a join question_revision q on q.id = a.question_revision_id
        where q.kind = 'text' and length(btrim(a.text_value)) >= 25`);
      expect(answers.length).toBeGreaterThan(50);
      for (const locale of ["es", "en"] as const) {
        const r = await buildReport(db, {
          cycle: cycleId,
          anonymized: true,
          minGroupSize: MIN,
          locale,
        });
        const out = (renderJson(r) + renderHtml(r)).normalize("NFC");
        for (const { t } of answers) {
          expect(out, t).not.toContain(t.trim());
        }
        expect(out).not.toMatch(EMAIL);
        for (const n of names) expect(out).not.toContain(n);
      }
    });

    it("anonymized: a No under the minimum is not published (nor called out), and neither is the Yes that would give it away", async () => {
      const r = await buildReport(db, {
        cycle: cycleId,
        anonymized: true,
        minGroupSize: MIN,
      });
      const conv = r.sections.qualitative!.yesNo.rows.find(
        (x) => x.kind === "conversations",
      )!;
      expect(conv.people).toBeGreaterThanOrEqual(MIN);
      expect([conv.yes, conv.no, conv.alert]).toEqual([null, null, false]);
      expect(renderHtml(r)).not.toContain("Conversaciones frecuentes: en");
    });

    it("anonymized: the non-group blocks are the direction view's rows (the screens' rule), less what the cells hide", async () => {
      const r = await buildReport(db, {
        cycle: cycleId,
        anonymized: true,
        minGroupSize: MIN,
      });
      const q = r.sections.qualitative!;
      const input = { cycleId, minGroupSize: MIN };
      const sub = await substanceByQuestion(db, direction, input);
      const key = (x: { dimension: string; side: string }) =>
        `${x.dimension}/${x.side}`;
      for (const x of q.substance) {
        const row = sub.find((y) => key(y) === key(x))!;
        expect(row, key(x)).toBeDefined();
        expect(x.people).toBe(row.people);
      }
      const strengths = await themesBySide(db, direction, {
        ...input,
        dimension: "strengths",
      });
      expect(q.themes[0].rows.map((x) => x.theme)).toEqual(
        strengths.rows.map((x) => x.theme),
      );
      const universe = await qualitativeUniverse(db, direction, input);
      expect(q.people).toBe(universe.people);
      const tone = await toneByQuestion(db, direction, input);
      expect(q.tone.map(key)).toEqual(tone.map(key));
      // Direction filters cannot go under the minimum: a minimum above everybody says nothing.
      const none = await buildReport(db, {
        cycle: cycleId,
        anonymized: true,
        minGroupSize: 100_000,
      });
      expect(none.sections.qualitative).toBeNull();
      expect(arturiaReportV1.safeParse(none).success).toBe(true);
    });
  });

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
    // the numbering is per cut and random per report: compare the sizes
    const sizes = (rows: unknown[][]) => rows.map((x) => x[1]).sort();
    expect(sizes(selfRows(c.byManager))).toEqual(
      sizes(withOthers(team).map((g) => [g.label, g.participants])),
    );
    expect(new Set(selfRows(c.byManager).map((x) => x[0])).size).toBe(
      c.byManager.filter((x) => x.relationship === "self").length,
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

  it("a team does not keep its Equipo N between cuts or between exports, so two cuts cannot be joined by size (#144)", async () => {
    const build = (aliasSalt: string) =>
      buildReport(db, {
        cycle: cycleId,
        anonymized: true,
        minGroupSize: 2,
        aliasSalt,
      });
    // label -> n of the teams both cuts show, per report
    const join = (r: Awaited<ReturnType<typeof build>>) => {
      const people = new Map(
        r.sections
          .completion!.byManager.filter((x) => x.relationship === "self")
          .map((x) => [x.label, x.n]),
      );
      return r.sections
        .goals!.byManager.filter(
          (x) => !x.other && x.label.startsWith("Equipo"),
        )
        .map((x) => [x.label, x.n, people.get(x.label)] as const);
    };
    const one = await build("one");
    const sections = (r: typeof one) => [
      r.sections.completion!.byManager.map((x) => x.label),
      r.sections.goals!.byManager.map((x) => x.label),
    ];
    // never stable across exports
    expect(sections(await build("two"))).not.toEqual(sections(one));
    // and the alias of goals does not match the same-numbered team of completion
    const joined = join(one);
    expect(joined.length).toBeGreaterThan(1);
    expect(joined.some(([, n, other]) => other !== n)).toBe(true);
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
