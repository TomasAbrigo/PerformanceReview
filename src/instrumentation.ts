/** Runs once per server start: makes sure the system scales/templates exist. */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || !process.env.DATABASE_URL) {
    return;
  }
  try {
    const { db } = await import("@/db/client");
    const { seedSystemTemplates } = await import("@/modules/templates");
    await seedSystemTemplates(db);
  } catch (error) {
    // A missing/unmigrated DB must not prevent the server from starting.
    console.error("Could not seed system templates", error);
  }
}
