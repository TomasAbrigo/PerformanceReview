/**
 * pnpm analysis:run [--cycle <id>] [--provider mock|anthropic]
 *
 * Reads the free-text answers (substance, themes, signals, sentiment) with the configured
 * provider (ANALYSIS_PROVIDER, default mock). Exit 0 ok, 1 failed, 2 usage.
 */
import {
  cliMain,
  runAnalysisCli,
} from "../src/modules/qualitative-analysis/cli";

await cliMain(runAnalysisCli, process.argv.slice(2));
