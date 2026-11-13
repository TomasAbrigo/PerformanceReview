import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// Load DATABASE_URL & co. for the `db` project (CI provides real env vars).
try {
  process.loadEnvFile(".env.local");
} catch {
  // No .env.local: rely on the real environment.
}

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          environment: "jsdom",
          include: ["src/**/*.test.{ts,tsx}"],
          exclude: ["src/**/*.db.test.ts"],
          setupFiles: ["./vitest.setup.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "db",
          environment: "node",
          include: ["src/**/*.db.test.ts"],
          globalSetup: ["./vitest.db.global-setup.ts"],
          // Tests share one database: run files one at a time.
          fileParallelism: false,
        },
      },
    ],
  },
});
