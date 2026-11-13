import { defineConfig, devices } from "@playwright/test";

// Dedicated port so e2e never collides with other local projects on :3000.
const PORT = 3100;

export default defineConfig({
  testDir: "./e2e",
  // Seeds the DB once (employees, then goals) before any spec runs.
  globalSetup: "./e2e/global-setup.ts",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  // In CI also write the HTML report (playwright-report/) that the workflow uploads on failure.
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `pnpm exec next dev -p ${PORT}`,
    url: `http://localhost:${PORT}/es`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
