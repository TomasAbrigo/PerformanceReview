import { defineConfig } from "drizzle-kit";

// drizzle-kit does not load .env files by itself.
try {
  process.loadEnvFile(".env.local");
} catch {
  // No .env.local (e.g. CI): rely on the real environment.
}

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema/*.ts",
  // Drizzle migrations live here; supabase/migrations is reserved for
  // Supabase-specific SQL (RLS policies, extensions, functions, ...).
  out: "./drizzle",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "",
  },
});
