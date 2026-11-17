import { and, eq, inArray, isNull } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import {
  answer,
  answerQualityIssue,
  importedQuestion,
  questionRevision,
  reviewRequest,
} from "@/db/schema";
import { likertRoles, mapLikert } from "@/modules/likert";
import { loadLikertOverrides } from "@/modules/likert/store";

/**
 * How many options a Likert question had, from the letters actually answered:
 * a column whose letters never go past D is the 4-option variant (A-D);
 * otherwise the revision's choices (5 for Bamboo's Q1/Q2).
 */
export function optionCountOf(
  labels: (string | null)[],
  choices: number | undefined,
): number {
  const letters = labels.filter((l): l is string => !!l && /^[A-Z]$/.test(l));
  if (letters.length === 0) return choices ?? 5;
  const highest = Math.max(...letters.map((l) => l.charCodeAt(0) - 64));
  return highest <= 4 ? 4 : (choices ?? 5);
}

/**
 * Recomputes the 1-5 value of every retention/engagement answer (of the given
 * cycles, or all) from its stored option label with the current
 * likert_mapping table and the option count seen in the column. Answers that
 * now map get their value and their open `answer_quality_issue` resolved;
 * answers that no longer map lose their value and get an issue. Used after
 * each historical import (finish) and from /data-quality ("Reaplicar
 * equivalencias"), so a table change reaches answers whose row is unchanged.
 */
export async function reapplyLikertMappings(
  db: DbOrTx,
  { cycleIds }: { cycleIds?: string[] } = {},
): Promise<{ remapped: number; resolved: number; unmapped: number }> {
  if (cycleIds && cycleIds.length === 0) {
    return { remapped: 0, resolved: 0, unmapped: 0 };
  }
  const overrides = await loadLikertOverrides(db);
  const revisions = await db
    .select({
      id: questionRevision.id,
      cycleId: questionRevision.cycleId,
      role: questionRevision.role,
      choices: questionRevision.choices,
      scale: questionRevision.scale,
      columnKey: importedQuestion.columnKey,
    })
    .from(questionRevision)
    .leftJoin(
      importedQuestion,
      eq(importedQuestion.questionRevisionId, questionRevision.id),
    )
    .where(
      and(
        inArray(questionRevision.role, [...likertRoles]),
        cycleIds ? inArray(questionRevision.cycleId, cycleIds) : undefined,
      ),
    );
  let remapped = 0;
  let resolved = 0;
  let unmapped = 0;
  for (const revision of revisions) {
    const role = revision.role as (typeof likertRoles)[number];
    const answers = await db
      .select({
        id: answer.id,
        requestId: answer.requestId,
        optionLabel: answer.optionLabel,
        optionValue: answer.optionValue,
        normalized: answer.normalized,
      })
      .from(answer)
      .innerJoin(reviewRequest, eq(reviewRequest.id, answer.requestId))
      .where(eq(answer.questionRevisionId, revision.id));
    const optionCount = optionCountOf(
      answers.map((a) => a.optionLabel),
      revision.choices?.length ?? revision.scale?.options.length,
    );
    const open = new Set(
      (
        await db
          .select({ requestId: answerQualityIssue.requestId })
          .from(answerQualityIssue)
          .where(
            and(
              eq(answerQualityIssue.questionRevisionId, revision.id),
              isNull(answerQualityIssue.resolvedAt),
            ),
          )
      ).map((r) => r.requestId),
    );
    const toResolve: string[] = [];
    for (const a of answers) {
      if (a.optionLabel === null) continue;
      const mapped = mapLikert(
        { role, optionCount, raw: a.optionLabel },
        overrides,
      );
      if ("unmapped" in mapped) {
        if (a.optionValue !== null || !open.has(a.requestId)) {
          await db
            .update(answer)
            .set({ optionValue: null, normalized: null })
            .where(eq(answer.id, a.id));
          const issue = {
            answerId: a.id,
            cycleId: revision.cycleId,
            columnKey: revision.columnKey ?? revision.id,
            rawValue: a.optionLabel,
            reason: "unmapped_option" as const,
            resolvedAt: null,
          };
          await db
            .insert(answerQualityIssue)
            .values({
              requestId: a.requestId,
              questionRevisionId: revision.id,
              ...issue,
            })
            .onConflictDoUpdate({
              target: [
                answerQualityIssue.requestId,
                answerQualityIssue.questionRevisionId,
              ],
              set: issue,
            });
          unmapped++;
        }
        continue;
      }
      if (
        a.optionValue !== mapped.value ||
        a.normalized !== mapped.normalized
      ) {
        await db
          .update(answer)
          .set({ optionValue: mapped.value, normalized: mapped.normalized })
          .where(eq(answer.id, a.id));
        remapped++;
      }
      if (open.has(a.requestId)) toResolve.push(a.requestId);
    }
    if (toResolve.length) {
      await db
        .update(answerQualityIssue)
        .set({ resolvedAt: new Date() })
        .where(
          and(
            eq(answerQualityIssue.questionRevisionId, revision.id),
            inArray(answerQualityIssue.requestId, toResolve),
            isNull(answerQualityIssue.resolvedAt),
          ),
        );
      resolved += toResolve.length;
    }
  }
  return { remapped, resolved, unmapped };
}
