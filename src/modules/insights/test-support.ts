/**
 * Test-only: the indicators scenario (analytics/indicators/test-support) plus
 * self reviews, an open-text question answered by both sides and labeled by
 * the Mock provider, for the self-assessment and executive reports.
 *
 * C2 (H2 2024), question "What are some things I do well?" (strengths):
 *   self     Ana   "Gran trabajo en equipo."           positive  colaboracion
 *            Bruno "Ayuda al equipo con calidad."      positive  calidad, colaboracion
 *            Carla "Llego tarde, es un problema."      negative  -
 *            Dario  a draft self review (not submitted)
 *   manager  Ana   "Excelente calidad."                positive  calidad
 *            Bruno "Podría mejorar."                   constructive
 * Self ratings on the retention question: Ana 5, Bruno 2 (manager: 2 and 2).
 */
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { answer, questionRevision, reviewRequest } from "@/db/schema";
import {
  buildScenario,
  insertIndicatorReview,
  type Scenario,
} from "@/modules/analytics/indicators/test-support";
import { MockProvider } from "@/modules/qualitative-analysis/mock-provider";
import { runAnalysis } from "@/modules/qualitative-analysis/service";

export async function buildReportScenario(): Promise<Scenario> {
  const s = await buildScenario();
  await db.execute(
    sql`TRUNCATE analysis_correction, qualitative_analysis, analysis_run, theme CASCADE`,
  );
  const [q] = await db
    .insert(questionRevision)
    .values({
      cycleId: s.c2.cycleId,
      sectionTitle: { es: "S", en: "S" },
      prompt: {
        es: "What are some things I do well?",
        en: "What are some things I do well?",
      },
      kind: "text",
      appliesTo: ["self", "manager"],
      visibleToReviewee: true,
      required: false,
      sort: 5,
    })
    .returning({ id: questionRevision.id });
  const self: Record<string, { text?: string; rating?: number }> = {
    ana: { text: "Gran trabajo en equipo.", rating: 5 },
    bruno: { text: "Ayuda al equipo con calidad.", rating: 2 },
    carla: { text: "Llego tarde, es un problema." },
  };
  for (const who of ["ana", "bruno", "carla", "dario"] as const) {
    const requestId = await insertIndicatorReview({
      cycle: s.c2,
      participantId: s.participant(s.c2, who),
      reviewerPersonId: s.id[who],
      relationship: "self",
      status: who === "dario" ? "draft" : "submitted",
      retention: self[who]?.rating ?? null,
    });
    if (self[who]?.text) {
      await db.insert(answer).values({
        requestId,
        questionRevisionId: q.id,
        textValue: self[who].text,
      });
    }
  }
  const manager = { ana: "Excelente calidad.", bruno: "Podría mejorar." };
  for (const [who, text] of Object.entries(manager) as [
    "ana" | "bruno",
    string,
  ][]) {
    const [request] = await db
      .select({ id: reviewRequest.id })
      .from(reviewRequest)
      .where(
        and(
          eq(reviewRequest.participantId, s.participant(s.c2, who)),
          eq(reviewRequest.relationship, "manager"),
        ),
      );
    await db.insert(answer).values({
      requestId: request.id,
      questionRevisionId: q.id,
      textValue: text,
    });
  }
  await runAnalysis(db, { provider: new MockProvider() });
  return s;
}
