import { readFile } from "node:fs/promises";
import path from "node:path";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { closeDb, db } from "@/db/client";
import {
  answer,
  answerQualityIssue,
  employeeJobHistory,
  person,
  questionRevision,
} from "@/db/schema";
import { getIndicator } from "@/modules/analytics/data-quality";
import { likertMapping } from "@/db/schema";
import { seedLikertMappings } from "@/modules/likert/store";
import { reapplyLikertMappings } from "./likert-reapply";
import {
  importReport,
  REPORTS,
  resetDb,
  seedSmallCompany,
  writeCsv,
} from "./test-support";

afterAll(async () => {
  await resetDb();
  await closeDb();
});

const likertAnswers = async () =>
  db
    .select({
      role: questionRevision.role,
      optionLabel: answer.optionLabel,
      optionValue: answer.optionValue,
      normalized: answer.normalized,
    })
    .from(answer)
    .innerJoin(
      questionRevision,
      eq(questionRevision.id, answer.questionRevisionId),
    )
    .where(inArray(questionRevision.role, ["retention", "engagement"]));

describe("importing the small Employee Performance report with roles and dimensions", () => {
  it("gives retention and engagement a role and a 1-5 value; open questions a dimension", async () => {
    await resetDb();
    await seedLikertMappings(db);
    await seedSmallCompany();
    const file = path.join(REPORTS, "employee-performance.csv");
    await importReport(file);
    const second = await importReport(file);
    expect(second.counts.rejected).toBe(0);

    const answers = await likertAnswers();
    expect(answers.length).toBeGreaterThan(20);
    expect(new Set(answers.map((a) => a.role))).toEqual(
      new Set(["retention", "engagement"]),
    );
    for (const a of answers) {
      expect(a.normalized).not.toBeNull();
      expect(a.optionValue).toBeGreaterThanOrEqual(1);
      expect(a.optionValue).toBeLessThanOrEqual(5);
    }
    const sample = answers.find((a) => a.optionLabel === "A")!;
    expect(sample).toMatchObject({ optionValue: 5, normalized: 1 });

    const dims = await db
      .selectDistinct({ dimension: questionRevision.dimension })
      .from(questionRevision);
    expect(dims.map((d) => d.dimension).sort()).toEqual(
      ["custom_1", "custom_2", "improvement", "strengths", null].sort(),
    );
    expect(await db.$count(answerQualityIssue)).toBe(0);
  }, 60_000);
});

const HEADER = [
  "Employee Name",
  "Manager",
  "Department",
  "Review Cycle",
  "Assessment Date",
  '"Manager Q1: If [Employee] got a job offer elsewhere, I would..."',
  "Manager Q2: How engaged is [Employee] at work?",
].join(",");

describe("a label that names the reviewee (#130)", () => {
  const NAMED =
    "I would try to convince them to stay. Bruno Pérez would be difficult to replace";

  it("is stored as the canonical label, the migration rewrites old rows, and re-applying still maps them", async () => {
    await resetDb();
    await seedLikertMappings(db);
    const [ana] = await db
      .insert(person)
      .values({ displayName: "Ana García" })
      .returning();
    const [bruno] = await db
      .insert(person)
      .values({ displayName: "Bruno Pérez" })
      .returning();
    await db.insert(employeeJobHistory).values({
      personId: bruno.id,
      validFrom: "2020-01-01",
      managerPersonId: ana.id,
    });
    const file = await writeCsv([
      HEADER,
      `Bruno Pérez,Ana García,Ingeniería,Ciclo 2023,2023-12-01,"${NAMED}",Engaged and a good attitude.`,
    ]);
    await importReport(file);
    const stored = await likertAnswers();
    expect(stored).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: "retention",
          optionLabel: "I would try to convince them to stay.",
          optionValue: 4,
        }),
        expect.objectContaining({
          role: "engagement",
          optionLabel: "Engaged and a good attitude.",
          optionValue: 4,
        }),
      ]),
    );

    // A row imported before the fix: the migration rewrites it.
    await db
      .update(answer)
      .set({ optionLabel: NAMED })
      .where(
        inArray(
          answer.questionRevisionId,
          db
            .select({ id: questionRevision.id })
            .from(questionRevision)
            .where(eq(questionRevision.role, "retention")),
        ),
      );
    const migration = await readFile(
      path.join(process.cwd(), "drizzle/0029_likert_canonical_labels.sql"),
      "utf8",
    );
    await db.execute(sql.raw(migration));
    const after = await likertAnswers();
    expect(after.some((a) => a.optionLabel?.includes("Bruno"))).toBe(false);
    expect(after.find((a) => a.role === "retention")).toMatchObject({
      optionLabel: "I would try to convince them to stay.",
      optionValue: 4,
    });
    const reapplied = await reapplyLikertMappings(db);
    expect(reapplied).toMatchObject({ remapped: 0, unmapped: 0 });
  });
});

describe("a letter outside the equivalence table", () => {
  it("keeps the answer with the raw label, records an issue and lists it in data quality", async () => {
    await resetDb();
    const [ana] = await db
      .insert(person)
      .values({ displayName: "Ana García" })
      .returning();
    const [bruno] = await db
      .insert(person)
      .values({ displayName: "Bruno Pérez" })
      .returning();
    await db.insert(employeeJobHistory).values({
      personId: bruno.id,
      validFrom: "2020-01-01",
      managerPersonId: ana.id,
    });
    const file = await writeCsv([
      HEADER,
      "Bruno Pérez,Ana García,Ingeniería,Ciclo 2023,2023-12-01,Z,B",
    ]);

    const { counts } = await importReport(file);

    expect(counts).toMatchObject({ read: 1, inserted: 1, rejected: 0 });
    const answers = await likertAnswers();
    expect(answers).toEqual(
      expect.arrayContaining([
        {
          role: "retention",
          optionLabel: "Z",
          optionValue: null,
          normalized: null,
        },
        {
          role: "engagement",
          optionLabel: "B",
          optionValue: 4,
          normalized: 0.75,
        },
      ]),
    );
    const issues = await db.select().from(answerQualityIssue);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      columnKey: "manager:q1",
      rawValue: "Z",
      reason: "unmapped_option",
      resolvedAt: null,
    });
    expect(issues[0].answerId).not.toBeNull();

    const indicator = await getIndicator(db, "unmapped_answers");
    expect(indicator).toMatchObject({ key: "unmapped_answers", count: 1 });
    expect(indicator!.items[0]).toMatchObject({
      cycleName: "Ciclo 2023",
      columnKey: "manager:q1",
      rawValue: "Z",
      reason: "unmapped_option",
    });
    expect(JSON.stringify(indicator)).not.toMatch(/Bruno|Ana/);

    // A corrected file maps the answer and resolves the issue.
    const fixed = await writeCsv([
      HEADER,
      "Bruno Pérez,Ana García,Ingeniería,Ciclo 2023,2023-12-01,E,B",
    ]);
    await importReport(fixed);
    expect(
      await db.$count(
        answerQualityIssue,
        isNull(answerQualityIssue.resolvedAt),
      ),
    ).toBe(0);
    expect((await getIndicator(db, "unmapped_answers"))!.count).toBe(0);
    const [retention] = (await likertAnswers()).filter(
      (a) => a.role === "retention",
    );
    expect(retention).toMatchObject({ optionValue: 1, normalized: 0 });
    expect(
      await db.$count(
        answerQualityIssue,
        and(eq(answerQualityIssue.rawValue, "Z")),
      ),
    ).toBe(1);
  });
});

async function twoPeople() {
  await resetDb();
  const [ana] = await db
    .insert(person)
    .values({ displayName: "Ana García" })
    .returning();
  const names = ["Bruno Pérez", "Carla Romero", "Diego Sosa"];
  for (const name of names) {
    const [p] = await db
      .insert(person)
      .values({ displayName: name })
      .returning();
    await db.insert(employeeJobHistory).values({
      personId: p.id,
      validFrom: "2020-01-01",
      managerPersonId: ana.id,
    });
  }
}

describe("a file whose letters only go A-D", () => {
  it("keeps the declared 5-option table: no E answered is not a 4-option question (#132)", async () => {
    await twoPeople();
    await seedLikertMappings(db);
    const file = await writeCsv([
      HEADER,
      "Bruno Pérez,Ana García,Ingeniería,Ciclo 2024,2024-06-01,C,D",
      "Carla Romero,Ana García,Ingeniería,Ciclo 2024,2024-06-02,A,B",
      "Diego Sosa,Ana García,Ingeniería,Ciclo 2024,2024-06-03,D,C",
    ]);
    await importReport(file);
    const answers = await likertAnswers();
    const value = (role: string, label: string) =>
      answers.find((a) => a.role === role && a.optionLabel === label)
        ?.optionValue;
    expect(value("retention", "C")).toBe(3);
    expect(value("retention", "D")).toBe(2);
    expect(value("retention", "A")).toBe(5);
    expect(value("engagement", "B")).toBe(4);
    expect(value("engagement", "C")).toBe(3);
  });
});

describe("reapplyLikertMappings", () => {
  it("remaps an unmapped answer after the table changes and resolves its issue", async () => {
    await twoPeople();
    await seedLikertMappings(db);
    const file = await writeCsv([
      HEADER,
      "Bruno Pérez,Ana García,Ingeniería,Ciclo 2023,2023-12-01,X,A",
    ]);
    await importReport(file);
    expect((await getIndicator(db, "unmapped_answers"))!.count).toBe(1);

    // People adds the missing equivalence; no new file is needed.
    await db.delete(likertMapping).where(eq(likertMapping.source, "custom"));
    await db.insert(likertMapping).values({
      role: "retention",
      sourceOption: "X",
      optionCount: 5,
      value: 1,
      source: "custom",
      updatedBy: "people",
    });
    expect((await getIndicator(db, "unmapped_answers"))!.count).toBe(1);

    const outcome = await reapplyLikertMappings(db);

    expect(outcome).toMatchObject({ remapped: 1, resolved: 1 });
    expect((await getIndicator(db, "unmapped_answers"))!.count).toBe(0);
    const retention = (await likertAnswers()).find(
      (a) => a.role === "retention",
    );
    expect(retention).toMatchObject({
      optionLabel: "X",
      optionValue: 1,
      normalized: 0,
    });
    await db.delete(likertMapping).where(eq(likertMapping.source, "custom"));
  });
});

describe("an invalid cell", () => {
  it("is reported on the run and also recorded as an invalid_value issue", async () => {
    await twoPeople();
    const file = await writeCsv([
      `${HEADER},Manager Custom Q1: Claridad.`,
      "Bruno Pérez,Ana García,Ingeniería,Ciclo 2023,2023-12-01,A,A,7",
    ]);
    await importReport(file);
    const [issue] = await db.select().from(answerQualityIssue);
    expect(issue).toMatchObject({
      reason: "invalid_value",
      rawValue: "7",
      answerId: null,
    });
  });
});
