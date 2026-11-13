import { defineConfig, devices } from "@playwright/test";

// Dedicated port so e2e never collides with other local projects on :3000.
const PORT = 3100;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  // The specs seed and mutate one shared database: run them one at a time.
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  // In CI also write the HTML report (playwright-report/) that the workflow uploads on failure.
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "on-first-retry",
  },
  projects: [
    // Seeds the shared database once before any spec (see e2e/identity.setup.ts).
    { name: "setup", testMatch: /.*\.setup\.ts/ },
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
      dependencies: ["setup"],
    },
  ],
  webServer: {
    command: `pnpm exec next dev -p ${PORT}`,
    url: `http://localhost:${PORT}/es`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
