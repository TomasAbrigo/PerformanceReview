/**
 * pnpm check:sensitive [--all]
 *
 * Fails (exit 1) when what is staged for the next commit would put personal
 * data in the repository: a .csv/.xlsx/.xls/.parquet outside fixtures/,
 * anything under data/private/, or an email whose domain is not synthetic.
 * It is the pre-commit hook (`pnpm hooks:install` turns it on; see README
 * "Datos sensibles"). `--all` checks every tracked file instead, like the
 * unit test CI runs (`src/lib/sensitive-data.test.ts`).
 */
import {
  findSensitiveFiles,
  formatIssues,
  PRIVATE_DIR,
} from "../src/lib/sensitive-data";
import {
  readStaged,
  readTracked,
  stagedPaths,
  trackedPaths,
} from "../src/lib/sensitive-data-git";

const all = process.argv.includes("--all");
const files = all ? readTracked(trackedPaths()) : readStaged(stagedPaths());
const issues = findSensitiveFiles(files);

if (issues.length === 0) {
  console.log(
    `check:sensitive: ${files.length} ${all ? "tracked" : "staged"} file(s) checked, nothing sensitive.`,
  );
} else {
  console.error(
    [
      `check:sensitive: ${issues.length} problem(s), the commit is blocked:`,
      formatIssues(issues),
      "",
      `Real exports go in ${PRIVATE_DIR} (ignored by git). Unstage the files with`,
      '`git restore --staged <file>`. See README, section "Datos sensibles".',
    ].join("\n"),
  );
  process.exitCode = 1;
}
