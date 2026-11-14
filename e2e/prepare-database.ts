/** Run by playwright.config.ts before `next dev`: see prepareDatabase. */
import { prepareDatabase } from "./database";

try {
  process.loadEnvFile(".env.local");
} catch {
  // rely on the real environment (CI)
}

await prepareDatabase();
