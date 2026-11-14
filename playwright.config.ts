import { defineConfig, devices } from "@playwright/test";

// Dedicated port so e2e never collides with other local projects on :3000.
const PORT = Number(process.env.E2E_PORT ?? 3100);

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
      testIgnore: /(identity|notifications)\.spec\.ts/,
    },
    // Phase changes notify every participant, so counting a person's unread
    // notifications needs a quiet system: this spec runs alone, once the
    // specs that launch cycles are done and before the identity chain (the
    // projects form one line: chromium, notifications, identity-setup,
    // identity).
    {
      name: "notifications",
      use: { ...devices["Desktop Chrome"] },
      testMatch: /notifications\.spec\.ts/,
      dependencies: ["chromium"],
    },
    // The identity spec resolves a case (it links a rehire to Carla), so it
    // runs on its own, once every spec that only reads is done.
    {
      name: "identity-setup",
      testMatch: /identity\.setup\.ts/,
      dependencies: ["notifications"],
    },
    {
      name: "identity",
      use: { ...devices["Desktop Chrome"] },
      testMatch: /identity\.spec\.ts/,
      dependencies: ["identity-setup"],
    },
  ],
  webServer: {
    command: `pnpm exec next dev -p ${PORT}`,
    url: `http://localhost:${PORT}/es`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
