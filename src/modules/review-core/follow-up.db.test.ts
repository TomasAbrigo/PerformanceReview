import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, db } from "@/db/client";
import { followUpNote } from "@/db/schema";
import { addFollowUpNote, listFollowUpNotes, shareReview, unshare } from ".";
import {
  as,
  collectingCycle,
  hr,
  loadPeople,
  outsider,
  participantOf,
  people,
  resetDb,
  sharedCycle,
  submitManager,
  submitSelf,
  systemTemplateId,
} from "./compare-ack.fixtures";

let templateId: string;

beforeAll(async () => {
  templateId = await systemTemplateId();
});
beforeEach(loadPeople);
afterAll(async () => {
  await resetDb();
  await closeDb();
});

const carla = () => as(people.carla, "manager");

describe("follow-up notes", () => {
  it("adds notes append-only and lists them newest first", async () => {
    const { participantId } = await sharedCycle(templateId);
    const first = await addFollowUpNote(
      db,
      carla(),
      participantId,
      "  Acordamos revisar en un mes.  ",
    );
    const second = await addFollowUpNote(
      db,
      carla(),
      participantId,
      "Seguimiento del plan de desarrollo.",
    );
    expect(first).toMatchObject({
      participantId,
      authorPersonId: people.carla,
      authorName: "Carla Romero",
      body: "Acordamos revisar en un mes.",
    });

    const notes = await listFollowUpNotes(db, carla(), participantId);
    expect(notes.map((n) => n.id)).toEqual([second.id, first.id]);
    expect(notes[0].createdAt.getTime()).toBeGreaterThanOrEqual(
      notes[1].createdAt.getTime(),
    );

    // Adding never touches earlier notes.
    const [stored] = await db
      .select()
      .from(followUpNote)
      .where(eq(followUpNote.id, first.id));
    expect(stored.body).toBe("Acordamos revisar en un mes.");
    expect(stored.createdAt).toEqual(first.createdAt);
    expect(await db.select().from(followUpNote)).toHaveLength(2);
  });

  it("lets HR write notes (no author person)", async () => {
    const { participantId } = await sharedCycle(templateId);
    const note = await addFollowUpNote(db, hr, participantId, "Nota de People");
    expect(note.authorPersonId).toBeNull();
    expect(note.authorName).toBeNull();
    expect(await listFollowUpNotes(db, hr, participantId)).toHaveLength(1);
  });

  it("only the manager or HR write, and only after the manager review is submitted", async () => {
    const cycle = await collectingCycle(templateId);
    await submitSelf(cycle.id);
    const p = await participantOf(cycle.id, people.bruno);
    await expect(
      addFollowUpNote(db, carla(), p.id, "demasiado pronto"),
    ).rejects.toMatchObject({ code: "not_submitted" });
    const { requestId } = await submitManager(cycle.id);
    await expect(
      addFollowUpNote(db, as(people.bruno), p.id, "yo"),
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      addFollowUpNote(db, as(people.ana, "manager"), p.id, "skip"),
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      addFollowUpNote(db, outsider(), p.id, "ajeno"),
    ).rejects.toMatchObject({ code: "forbidden" });
    // Not shared yet: the manager may already write (the conversation is next).
    await expect(
      addFollowUpNote(db, carla(), p.id, "ok"),
    ).resolves.toBeDefined();
    await shareReview(db, carla(), requestId);
  });

  it("validates the body", async () => {
    const { participantId } = await sharedCycle(templateId);
    await expect(
      addFollowUpNote(db, carla(), participantId, "   "),
    ).rejects.toMatchObject({
      code: "validation",
      issues: [{ path: "body", message: "required" }],
    });
    await expect(
      addFollowUpNote(db, carla(), participantId, "x".repeat(4001)),
    ).rejects.toMatchObject({
      code: "validation",
      issues: [{ path: "body", message: "too_long" }],
    });
    expect(await db.select().from(followUpNote)).toHaveLength(0);
  });

  it("the employee reads the notes only while the review is shared", async () => {
    const { participantId, requestId } = await sharedCycle(templateId);
    await addFollowUpNote(db, carla(), participantId, "Acuerdo 1");
    const bruno = as(people.bruno);
    expect(
      (await listFollowUpNotes(db, bruno, participantId)).map((n) => n.body),
    ).toEqual(["Acuerdo 1"]);

    await unshare(db, hr, requestId);
    await expect(
      listFollowUpNotes(db, bruno, participantId),
    ).rejects.toMatchObject({ code: "forbidden" });
    // The manager still reads and writes while it is hidden.
    expect(await listFollowUpNotes(db, carla(), participantId)).toHaveLength(1);
  });

  it("refuses to list for people who are not involved", async () => {
    const { participantId } = await sharedCycle(templateId);
    await expect(
      listFollowUpNotes(db, outsider(), participantId),
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      listFollowUpNotes(db, as(people.ana, "manager"), participantId),
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      listFollowUpNotes(db, hr, "00000000-0000-4000-8000-000000000001"),
    ).rejects.toMatchObject({ code: "not_found" });
  });
});
