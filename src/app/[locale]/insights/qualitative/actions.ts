"use server";

import { refresh } from "next/cache";
import type {
  CorrectOutcome,
  CorrectPayload,
  ImportOutcome,
  RunOutcome,
} from "@/components/qualitative/actions-types";
import { db } from "@/db/client";
import { DomainError } from "@/lib/domain-error";
import { getActor } from "@/modules/actor/server";
import {
  correctLabel,
  createProvider,
  importLabels,
  runAnalysis,
} from "@/modules/qualitative-analysis";

const MAX_CSV_BYTES = 5 * 1024 * 1024;

/** Domain errors become their code; anything else is logged (no content) as unknown. */
const failure = (error: unknown) => {
  if (error instanceof DomainError)
    return { ok: false as const, code: error.code };
  console.error(error instanceof Error ? error.name : "error");
  return { ok: false as const, code: "unknown" };
};

const requireHr = async () => {
  const actor = await getActor();
  if (actor.role !== "hr") throw new DomainError("forbidden");
  return actor;
};

export async function runAnalysisAction(
  cycleId: string | undefined,
): Promise<RunOutcome> {
  try {
    const actor = await requireHr();
    const provider = createProvider(process.env);
    const r = await runAnalysis(db, {
      cycleId,
      provider,
      actorPersonId: actor.personId,
    });
    refresh();
    return { ok: true, provider: provider.name, ...r };
  } catch (error) {
    return failure(error);
  }
}

export async function importLabelsAction(
  form: FormData,
): Promise<ImportOutcome> {
  try {
    const actor = await requireHr();
    const file = form.get("file");
    if (!(file instanceof File) || file.name === "")
      return { ok: false, code: "no_file" };
    if (file.size > MAX_CSV_BYTES) return { ok: false, code: "invalid_csv" };
    const r = await importLabels(
      db,
      { csv: await file.text() },
      { actorPersonId: actor.personId },
    );
    refresh();
    return {
      ok: true,
      total: r.total,
      matched: r.matched,
      unmatched: r.unmatched,
    };
  } catch (error) {
    return failure(error);
  }
}

export async function correctLabelAction(
  answerId: string,
  input: CorrectPayload,
): Promise<CorrectOutcome> {
  try {
    await correctLabel(db, await getActor(), answerId, input);
    refresh();
    return { ok: true };
  } catch (error) {
    return failure(error);
  }
}
