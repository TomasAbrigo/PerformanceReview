import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, db } from "@/db/client";
import { employeeJobHistory, person } from "@/db/schema";
import { getHistoryImportResult } from "./results";
import { importReport, resetDb, writeCsv } from "./test-support";

const HEADER =
  "Employee Name,Manager,Department,Review Cycle,Assessment Date,Employee Q3: What are some things I do well?,Manager Q3: What are some things [Employee] does well?";

async function addPerson(displayName: string) {
  const [row] = await db
    .insert(person)
    .values({ displayName })
    .returning({ id: person.id });
  return row.id;
}

beforeEach(resetDb);
afterAll(async () => {
  await resetDb();
  await closeDb();
});

describe("getHistoryImportResult", () => {
  it("counts per detected cycle what the run created, left unchanged, sent to the queue and flagged", async () => {
    const ana = await addPerson("Ana García");
    const carla = await addPerson("Carla Romero");
    const bruno = await addPerson("Bruno Pérez");
    await db.insert(employeeJobHistory).values({
      personId: bruno,
      validFrom: "2020-01-01",
      managerPersonId: ana,
    });
    const file = await writeCsv([
      HEADER,
      "Bruno Pérez,Carla Romero,Ingeniería,Ciclo 2023,2023-12-01,Cumplo,Ok",
      "Zoe Nadie,Ana García,Ingeniería,Ciclo 2023,2023-12-02,Cumplo,Ok",
      "Bruno Pérez,Ana García,Ingeniería,Ciclo 2024,2024-12-01,Cumplo,",
    ]);
    const { runId } = await importReport(file);

    const result = await getHistoryImportResult(db, runId);

    expect(result).toMatchObject({ runId, entity: "assessment" });
    expect(result?.cycles).toEqual([
      expect.objectContaining({
        name: "Ciclo 2023",
        periodStart: "2023-12-01",
        periodEnd: "2023-12-02",
        rows: 2,
        participantsCreated: 1,
        requestsCreated: 2,
        requestsUnchanged: 0,
        answersCreated: 2,
        answersUnchanged: 0,
        issues: 1,
        mismatches: 1,
      }),
      expect.objectContaining({
        name: "Ciclo 2024",
        rows: 1,
        participantsCreated: 1,
        requestsCreated: 2,
        answersCreated: 1,
        issues: 0,
        mismatches: 0,
      }),
    ]);
    expect(carla).toBeTruthy();

    const again = await importReport(file);
    const second = await getHistoryImportResult(db, again.runId);
    expect(second?.cycles[0]).toMatchObject({
      participantsCreated: 0,
      requestsCreated: 0,
      requestsUnchanged: 2,
      answersCreated: 0,
      answersUnchanged: 2,
      issues: 1,
    });
  });

  it("is null for a run that imported no report rows", async () => {
    expect(
      await getHistoryImportResult(db, "00000000-0000-0000-0000-000000000000"),
    ).toBeNull();
    expect(await getHistoryImportResult(db, "nope")).toBeNull();
  });
});
