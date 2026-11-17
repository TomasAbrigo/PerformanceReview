import { logError } from "@/lib/log";

/**
 * Runs once per server start: makes sure the system scales/templates and the
 * default Likert equivalences exist.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || !process.env.DATABASE_URL) {
    return;
  }
  try {
    const { db } = await import("@/db/client");
    const { seedSystemTemplates } = await import("@/modules/templates");
    await seedSystemTemplates(db);
    const { seedLikertMappings } = await import("@/modules/likert/store");
    await seedLikertMappings(db);
  } catch (error) {
    // A missing/unmigrated DB must not prevent the server from starting.
    logError(error, "Could not seed system templates");
  }
}
