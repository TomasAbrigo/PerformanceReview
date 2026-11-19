/**
 * pnpm analysis:eval [--provider mock|anthropic]
 *
 * Scores a provider's reading against the hand-labelled text bank of the
 * fixtures, per field. No database. Exit 0 ok, 1 failed, 2 usage.
 */
import { evalCli } from "../src/modules/qualitative-analysis/eval";

try {
  process.loadEnvFile(".env.local");
} catch {
  // rely on the real environment
}
process.exitCode = await evalCli(process.argv.slice(2), { env: process.env });
