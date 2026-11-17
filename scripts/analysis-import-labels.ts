/**
 * pnpm analysis:import-labels <file.csv>
 *
 * Imports qualitative labels from a CSV (docs/qualitative-labels.md).
 */
import {
  cliMain,
  importLabelsCli,
} from "../src/modules/qualitative-analysis/cli";

await cliMain(importLabelsCli, process.argv.slice(2));
