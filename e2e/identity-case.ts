import postgres from "postgres";

/**
 * The identity e2e case: Carla (Bamboo id 103, legajo 0003, terminated) comes
 * back as id 201 with the same legajo and email, so the import must ask before
 * linking it to her (see identity.setup.ts and identity.spec.ts).
 */
export const REHIRE_ID = "201";

/**
 * Forgets everything a previous run of the case left behind (the linked
 * employment and its Bamboo id, the issue, the raw record), so every other
 * spec sees Carla as the plain fixtures describe her. Runs in global setup.
 */
export async function resetIdentityCase() {
  try {
    process.loadEnvFile(".env.local");
  } catch {
    // rely on the real environment (CI)
  }
  const sql = postgres(process.env.DATABASE_URL ?? "", { max: 1 });
  try {
    await sql`DELETE FROM identity_match_issue WHERE source_id = ${REHIRE_ID}`;
    await sql`DELETE FROM employment WHERE source_id = ${REHIRE_ID}`;
    await sql`DELETE FROM source_identity WHERE kind = 'bamboo_id' AND value = ${REHIRE_ID}`;
    await sql`DELETE FROM raw_record WHERE entity = 'employee' AND source_id = ${REHIRE_ID}`;
  } finally {
    await sql.end();
  }
}
