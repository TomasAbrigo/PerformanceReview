import { defineConfig, devices } from "@playwright/test";
import { e2eDatabaseUrl } from "./e2e/database";

try {
  process.loadEnvFile(".env.local");
} catch {
  // rely on the real environment (CI)
}

// Dedicated port so e2e never collides with other local projects on :3000.
const PORT = Number(process.env.E2E_PORT ?? 3100);

// The e2e empties and reseeds its own database, never the one you develop on
// (see e2e/database.ts); the dev server below talks to it too.
let databaseUrl: string | undefined;
try {
  databaseUrl = e2eDatabaseUrl();
} catch {
  // global setup reports the missing DATABASE_URL
}

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  fullyParallel: true,
  // `next dev` compiles routes on first hit; give assertions room on a cold or busy machine.
  expect: { timeout: 10_000 },
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  // In CI also write the HTML report (playwright-report/) that the workflow uploads on failure.
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
      testIgnore: /identity(-later)?\.spec\.ts/,
    },
    // The identity specs resolve and queue cases (they link a seeded rehire to
    // the person who left, and one more run brings a rehire in), so they run on
    // their own, once every spec that only reads is done.
    {
      name: "identity-setup",
      testMatch: /identity\.setup\.ts/,
      dependencies: ["chromium"],
    },
    {
      name: "identity",
      use: { ...devices["Desktop Chrome"] },
      testMatch: /identity(-later)?\.spec\.ts/,
      dependencies: ["identity-setup"],
    },
  ],
  webServer: {
    command: `pnpm exec next dev -p ${PORT}`,
    url: `http://localhost:${PORT}/es`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: databaseUrl ? { DATABASE_URL: databaseUrl } : undefined,
  },
});
