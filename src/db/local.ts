const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

/**
 * Destructive local tooling (`pnpm db:seed --reset`, the e2e database) is for
 * the local stack only: refuse any database that is not on this machine.
 * No dependencies on purpose, so the e2e setup can use it too.
 */
export function assertLocalDatabase(databaseUrl: string | undefined): void {
  let host: string | null = null;
  try {
    host = databaseUrl ? new URL(databaseUrl).hostname : null;
  } catch {
    // not a URL: refused below
  }
  if (!host || !LOCAL_HOSTS.has(host)) {
    throw new Error(
      `Refusing to reset a database that is not local (DATABASE_URL host: ${host ?? "unset or invalid"})`,
    );
  }
}

/**
 * The e2e run empties and reseeds its database (`pnpm db:seed --reset`), so it
 * never touches the one you develop on: `E2E_DATABASE_URL`, or by default
 * `DATABASE_URL` with `_e2e` appended to the database name.
 */
export function e2eDatabaseUrl(
  env: Record<string, string | undefined> = process.env,
): string {
  if (env.E2E_DATABASE_URL) return env.E2E_DATABASE_URL;
  if (!env.DATABASE_URL) {
    throw new Error("Set DATABASE_URL (or E2E_DATABASE_URL) to run the e2e");
  }
  const url = new URL(env.DATABASE_URL);
  url.pathname = `/${url.pathname.replace(/^\//, "") || "postgres"}_e2e`;
  return url.toString();
}
