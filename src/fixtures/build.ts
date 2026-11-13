/**
 * `pnpm fixtures:build`: regenerates fixtures/bamboo/{small,demo} (Bamboo API
 * responses) and fixtures/bamboo-reports/{small,demo} (Performance report
 * CSVs). Deterministic: same seeds, same files.
 */
import { fileURLToPath } from "node:url";
import { writeFixtures } from "./write";

const root = fileURLToPath(new URL("../../fixtures", import.meta.url));
const written = writeFixtures(root);

for (const [size, count] of Object.entries(written)) {
  console.log(`fixtures/${size}: ${count} files`);
}
