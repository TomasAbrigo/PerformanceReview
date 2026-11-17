import path from "node:path";
import { and, eq, inArray, isNull } from "drizzle-orm";
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
import { seedLikertMappings } from "@/modules/likert/store";
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
      "Bruno Pérez,Ana García,Ingeniería,Ciclo 2023,2023-12-01,C,B",
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
    expect(retention).toMatchObject({ optionValue: 3, normalized: 0.5 });
    expect(
      await db.$count(
        answerQualityIssue,
        and(eq(answerQualityIssue.rawValue, "Z")),
      ),
    ).toBe(1);
  });
});
