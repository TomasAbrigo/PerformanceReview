import { eq } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import { ingestRun } from "@/db/schema";
import {
  getBuiltinProfile,
  type QuestionMapping,
} from "@/modules/lake/profiles";
import { loadSavedProfile } from "@/modules/lake/upload-store";

/**
 * The question mapping of the profile a run imported with (built-in or saved
 * by name, `ingest_run.params.profile`), to re-process its stored rows the
 * way the run did (resuming it, settling an identity issue). None when the
 * run has no profile or it is gone: the header pattern still applies.
 */
export async function questionsOfRun(
  db: DbOrTx,
  runId: string | null,
): Promise<QuestionMapping[] | undefined> {
  if (!runId) return undefined;
  const [run] = await db
    .select({ params: ingestRun.params })
    .from(ingestRun)
    .where(eq(ingestRun.id, runId));
  const name = run?.params?.profile;
  if (typeof name !== "string") return undefined;
  const profile =
    getBuiltinProfile(name) ?? (await loadSavedProfile(name).catch(() => null));
  return profile?.questions;
}
