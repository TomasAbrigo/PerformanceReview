import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, db } from "@/db/client";
import {
  employeeJobHistory,
  questionRevision,
  reviewRequest,
} from "@/db/schema";
import {
  bothSubmitted,
  compareReviews,
  getReview,
  loadParticipantScope,
  removeParticipant,
  shareReview,
} from ".";
import {
  as,
  askBoth,
  collectingCycle,
  fillAndSubmit,
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
  toSharing,
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

describe("compareReviews", () => {
  it("lines up self and manager per question with a delta only on ratings", async () => {
    const cycle = await collectingCycle(templateId);
    // The overall rating and one text question are asked to both.
    const both = await askBoth(
      cycle.id,
      (q) =>
        q.appliesTo.includes("manager") &&
        (q.kind === "rating" || q.prompt.es.startsWith("Comenta")),
    );
    const rating = both.filter((q) => q.kind === "rating").at(-1)!;
    const text = both.find((q) => q.kind === "text")!;
    await submitSelf(cycle.id, (q) =>
      q.id === rating.id ? q.scale!.options[0].value : undefined,
    );
    const { participantId } = await submitManager(cycle.id, (q) =>
      q.id === rating.id ? q.scale!.options[2].value : undefined,
    );

    const result = await compareReviews(
      db,
      as(people.carla, "manager"),
      participantId,
    );
    expect(result).toMatchObject({
      participantId,
      cycleId: cycle.id,
      cycleName: "H1 2022",
      revieweeName: "Bruno Pérez",
      employeeView: false,
    });

    const row = (id: string) => result.rows.find((r) => r.question.id === id)!;
    const options = rating.scale!.options;
    expect(row(rating.id).self).toMatchObject({
      value: options[0].value,
      normalized: options[0].normalized,
    });
    expect(row(rating.id).manager).toMatchObject({
      value: options[2].value,
      normalized: options[2].normalized,
    });
    expect(row(rating.id).delta?.numeric).toBe(
      options[2].value - options[0].value,
    );
    expect(row(rating.id).delta?.normalized).toBeCloseTo(
      options[2].normalized - options[0].normalized,
    );

    // Text asked to both: both sides, no delta.
    expect(row(text.id).self?.value).toMatch(/^Respuesta/);
    expect(row(text.id).manager?.value).toMatch(/^Respuesta/);
    expect(row(text.id).delta).toBeNull();

    // Every other question belongs to one side only: the other is "n/a".
    const bothIds = both.map((q) => q.id);
    const others = result.rows.filter((r) => !bothIds.includes(r.question.id));
    expect(others.length).toBeGreaterThan(0);
    expect(
      others.every((r) => (r.self === null) !== (r.manager === null)),
    ).toBe(true);
    expect(others.every((r) => r.delta === null)).toBe(true);
    // Rows follow the template order.
    const sorts = result.rows.map((r) => r.question.sort);
    expect(sorts).toEqual([...sorts].sort((a, b) => a - b));
  });

  it("gives no delta when a side left the rating unanswered", async () => {
    const cycle = await collectingCycle(templateId);
    const [rating] = await askBoth(
      cycle.id,
      (q) => q.kind === "rating" && q.appliesTo.includes("manager"),
    );
    // Not required: Bruno can submit without answering it.
    await db
      .update(questionRevision)
      .set({ required: false })
      .where(eq(questionRevision.id, rating.id));
    await submitSelf(cycle.id, (q) => (q.id === rating.id ? null : undefined));
    const { participantId } = await submitManager(cycle.id);
    const result = await compareReviews(db, hr, participantId);
    const row = result.rows.find((r) => r.question.id === rating.id)!;
    expect(row.self).toEqual({ value: null, normalized: null });
    expect(row.manager?.value).toBe(rating.scale!.options[0].value);
    expect(row.delta).toBeNull();
  });

  it("employee view keeps only the questions visible to the employee", async () => {
    const cycle = await collectingCycle(templateId);
    const [hidden] = await askBoth(
      cycle.id,
      (q) => q.kind === "text" && q.appliesTo.includes("manager"),
    ).then((qs) => qs.slice(0, 1));
    await db
      .update(questionRevision)
      .set({ visibleToReviewee: false })
      .where(eq(questionRevision.id, hidden.id));
    await submitSelf(cycle.id);
    const { participantId } = await submitManager(cycle.id);
    const carla = as(people.carla, "manager");

    const full = await compareReviews(db, carla, participantId);
    const fullRow = full.rows.find((r) => r.question.id === hidden.id)!;
    expect(fullRow.question.visibleToReviewee).toBe(false);

    const employeeView = await compareReviews(db, carla, participantId, {
      employeeView: true,
    });
    expect(employeeView.employeeView).toBe(true);
    expect(employeeView.rows.some((r) => r.question.id === hidden.id)).toBe(
      false,
    );
    expect(employeeView.rows.length).toBe(full.rows.length - 1);
    expect(employeeView.rows.every((r) => r.question.visibleToReviewee)).toBe(
      true,
    );
  });

  it("is not available until both reviews are submitted", async () => {
    const cycle = await collectingCycle(templateId);
    const p = await participantOf(cycle.id, people.bruno);
    const carla = as(people.carla, "manager");
    await expect(compareReviews(db, carla, p.id)).rejects.toMatchObject({
      code: "not_submitted",
    });
    await submitSelf(cycle.id);
    // Double blind: the manager has not submitted hers yet.
    await expect(compareReviews(db, carla, p.id)).rejects.toMatchObject({
      code: "not_submitted",
    });
    await expect(compareReviews(db, hr, p.id)).rejects.toMatchObject({
      code: "not_submitted",
    });
    await submitManager(cycle.id);
    await expect(compareReviews(db, carla, p.id)).resolves.toBeDefined();
  });

  it("is not available with only the manager review submitted", async () => {
    const cycle = await collectingCycle(templateId);
    const { participantId } = await submitManager(cycle.id);
    await expect(
      compareReviews(db, as(people.carla, "manager"), participantId),
    ).rejects.toMatchObject({ code: "not_submitted" });
  });

  it("refuses people who are not involved and the employee before sharing", async () => {
    const cycle = await collectingCycle(templateId);
    await submitSelf(cycle.id);
    const { participantId, requestId } = await submitManager(cycle.id);
    await expect(
      compareReviews(db, outsider(), participantId),
    ).rejects.toMatchObject({ code: "forbidden" });
    // The employee only compares once the manager review is shared; never
    // learns whether the manager has submitted.
    await expect(
      compareReviews(db, as(people.bruno), participantId),
    ).rejects.toMatchObject({ code: "forbidden" });
    await toSharing(cycle.id);
    await shareReview(db, as(people.carla), requestId);
    await expect(
      compareReviews(db, as(people.bruno), participantId),
    ).resolves.toBeDefined();
  });

  it("limits the employee to the questions visible to them", async () => {
    const { cycle, participantId } = await sharedCycle(templateId);
    const hidden = (
      await askBoth(
        cycle.id,
        (q) => q.kind === "text" && q.appliesTo.includes("manager"),
      )
    )[0];
    await db
      .update(questionRevision)
      .set({ visibleToReviewee: false })
      .where(eq(questionRevision.id, hidden.id));
    const result = await compareReviews(db, as(people.bruno), participantId);
    expect(result.rows.some((r) => r.question.id === hidden.id)).toBe(false);
    expect(result.rows.every((r) => r.question.visibleToReviewee)).toBe(true);
    expect(result.employeeView).toBe(true);
  });

  it("lets the skip-level manager and HR compare, not a stranger", async () => {
    const { participantId } = await sharedCycle(templateId);
    await expect(
      compareReviews(db, as(people.ana, "manager"), participantId),
    ).resolves.toBeDefined();
    await expect(compareReviews(db, hr, participantId)).resolves.toBeDefined();
    await expect(
      compareReviews(db, outsider(), participantId),
    ).rejects.toMatchObject({ code: "forbidden" });
  });

  it("a removed participant is compared by HR only", async () => {
    const { cycle, participantId } = await sharedCycle(templateId);
    await removeParticipant(db, cycle.id, people.bruno);
    for (const actor of [as(people.carla, "manager"), as(people.bruno)]) {
      await expect(
        compareReviews(db, actor, participantId),
      ).rejects.toMatchObject({ code: "forbidden" });
    }
    await expect(compareReviews(db, hr, participantId)).resolves.toBeDefined();
  });

  describe("with Carla reporting to nobody (Ana only manages Bruno today)", () => {
    beforeEach(async () => {
      await db
        .update(employeeJobHistory)
        .set({ managerPersonId: null })
        .where(eq(employeeJobHistory.personId, people.carla));
    });
    const ana = () => as(people.ana, "manager");

    it("an alternate reviewer of the manager request compares under the same double blind", async () => {
      const cycle = await collectingCycle(templateId);
      const p = await participantOf(cycle.id, people.bruno);
      // The manager review was reassigned from Carla to Ana.
      await db
        .update(reviewRequest)
        .set({ reviewerPersonId: people.ana })
        .where(
          and(
            eq(reviewRequest.participantId, p.id),
            eq(reviewRequest.relationship, "manager"),
          ),
        );
      const selfId = await submitSelf(cycle.id);
      // Double blind: no self review, nor a comparison, before hers.
      expect(await getReview(db, ana(), selfId)).toBeNull();
      await expect(compareReviews(db, ana(), p.id)).rejects.toMatchObject({
        code: "not_submitted",
      });
      const [manager] = await db
        .select()
        .from(reviewRequest)
        .where(
          and(
            eq(reviewRequest.participantId, p.id),
            eq(reviewRequest.relationship, "manager"),
          ),
        );
      await fillAndSubmit(ana(), manager.id);
      expect(await getReview(db, ana(), selfId)).not.toBeNull();
      await expect(compareReviews(db, ana(), p.id)).resolves.toBeDefined();
      // The snapshot manager (no longer the reviewer) still compares too.
      await expect(
        compareReviews(db, as(people.carla, "manager"), p.id),
      ).resolves.toBeDefined();
    });

    it("the current manager compares only once the manager review was shared", async () => {
      const cycle = await collectingCycle(templateId);
      await submitSelf(cycle.id);
      const { participantId, requestId } = await submitManager(cycle.id);
      await expect(
        compareReviews(db, ana(), participantId),
      ).rejects.toMatchObject({ code: "forbidden" });
      await toSharing(cycle.id);
      await shareReview(db, as(people.carla), requestId);
      await expect(
        compareReviews(db, ana(), participantId),
      ).resolves.toBeDefined();
    });
  });

  it("is not available to the employee while their own self assessment is a draft", async () => {
    // The manager review is shared without a self assessment: no comparison
    // (and bothSubmitted, which the result page gates its link on, says so).
    const cycle = await collectingCycle(templateId);
    const { participantId, requestId } = await submitManager(cycle.id);
    await toSharing(cycle.id);
    await shareReview(db, as(people.carla), requestId);
    const scope = await loadParticipantScope(db, participantId);
    expect(bothSubmitted(scope)).toBe(false);
    await expect(
      compareReviews(db, as(people.bruno), scope),
    ).rejects.toMatchObject({ code: "not_submitted" });
  });

  it("not_found for an unknown or malformed participant", async () => {
    await expect(
      compareReviews(db, hr, "00000000-0000-4000-8000-000000000001"),
    ).rejects.toMatchObject({ code: "not_found" });
    await expect(compareReviews(db, hr, "nope")).rejects.toMatchObject({
      code: "not_found",
    });
  });
});
