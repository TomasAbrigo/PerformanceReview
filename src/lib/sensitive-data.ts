/**
 * Guard against personal data reaching the repository (pure logic; the git
 * side lives in `sensitive-data-git.ts`). Real Bamboo exports belong in
 * `data/private/` (ignored by git); the repo only ever holds synthetic data.
 * Two rules over the files git tracks (or is about to commit):
 *
 *  1. No `.csv` / `.xlsx` / `.xls` / `.parquet` outside the folders of
 *     synthetic fixtures, and nothing at all under `data/private/`.
 *  2. No email address whose domain is not synthetic.
 *
 * Issues never carry the address itself (only file, line and domain), so a
 * failing run does not copy a real email into CI logs.
 */

/**
 * The one domain of every email the generator and the seed produce
 * (`src/fixtures/company/identity.ts`). The `.example` TLD is reserved
 * (RFC 2606): it can never be a real mailbox.
 */
export const SYNTHETIC_EMAIL_DOMAIN = "meridian-andina.example";

/** Folder real exports go in: ignored by git, never tracked. */
export const PRIVATE_DIR = "data/private/";

const DATA_FILE = /\.(csv|xlsx|xls|parquet)$/i;

/** Folders where data files are synthetic test inputs. */
const DATA_FILE_DIRS = [
  "fixtures/",
  "src/modules/lake/__fixtures__/",
  "src/modules/bamboo-client/__fixtures__/",
];

/** Domains (and their subdomains) that can never be a real mailbox, plus ours. */
const ALLOWED_DOMAINS = [
  SYNTHETIC_EMAIL_DOMAIN,
  "example.com",
  "example.org",
  "example.net",
];

/** Reserved TLDs (RFC 2606 / 6761): nothing under them is a real mailbox. */
const RESERVED_TLDS = ["test", "example", "invalid", "localhost"];

/** Not mailboxes of anyone: bot senders and the `git@` user of SSH remotes. */
const ALLOWED_ADDRESSES = [
  "noreply@github.com",
  "git@github.com",
  "git@gitlab.com",
  "git@bitbucket.org",
];

/** Generated or vendored: not worth scanning (and slow to). */
const SKIPPED = [
  /(^|\/)node_modules\//,
  /(^|\/)\.next\//,
  /(^|\/)pnpm-lock\.yaml$/,
  /^drizzle\/meta\//,
  /^\.claude\/worktrees\//,
  // Commented-out example values of the Supabase CLI's own template.
  /^supabase\/config\.toml$/,
];

export type SensitiveFile = {
  path: string;
  /** Text of the file; undefined when it is binary or was not read. */
  content?: string;
};

export type SensitiveIssue =
  | { kind: "data-file"; path: string }
  | { kind: "private-folder"; path: string }
  | {
      kind: "email";
      path: string;
      /** First line with an address of this domain (1-based). */
      line: number;
      domain: string;
      /** Addresses of this domain in the file. */
      count: number;
    };

const EMAIL =
  /[A-Za-z0-9._%+-]+@([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,})/g;
/**
 * `scheme://user:password@`: the credentials of a URL, not an address (the
 * password may hold an `@`; quotes and brackets end it, so a JSON line with
 * a URL and an address keeps the address).
 */
const URL_CREDENTIALS = /\b([a-z][a-z0-9+.-]*:\/\/)[^\s/"'`<>]*@/gi;

/**
 * `text` with every email address replaced by `[email]` and the credentials
 * of every URL (`postgresql://user:password@127.0.0.1/db`, any host, IPs and
 * localhost included) by `[credentials]`.
 */
export const redactEmails = (text: string): string =>
  text
    .replace(URL_CREDENTIALS, "$1[credentials]@")
    .replace(new RegExp(EMAIL.source, "g"), "[email]");

const isSkipped = (path: string) => SKIPPED.some((re) => re.test(path));

function isAllowedDomain(domain: string): boolean {
  const tld = domain.slice(domain.lastIndexOf(".") + 1);
  return (
    RESERVED_TLDS.includes(tld) ||
    ALLOWED_DOMAINS.some((d) => domain === d || domain.endsWith(`.${d}`))
  );
}

/** Domains of the addresses in `line` that are not allowed (one entry per address). */
function foreignDomains(line: string): string[] {
  const found: string[] = [];
  for (const m of line.replace(URL_CREDENTIALS, "$1").matchAll(EMAIL)) {
    const address = m[0].toLowerCase();
    const domain = m[1].toLowerCase();
    if (ALLOWED_ADDRESSES.includes(address) || isAllowedDomain(domain)) {
      continue;
    }
    found.push(domain);
  }
  return found;
}

function emailIssues({ path, content }: SensitiveFile): SensitiveIssue[] {
  if (content === undefined || isSkipped(path)) return [];
  const byDomain = new Map<string, { line: number; count: number }>();
  content.split("\n").forEach((text, i) => {
    for (const domain of foreignDomains(text)) {
      const seen = byDomain.get(domain);
      if (seen) seen.count += 1;
      else byDomain.set(domain, { line: i + 1, count: 1 });
    }
  });
  return [...byDomain].map(([domain, { line, count }]) => ({
    kind: "email",
    path,
    line,
    domain,
    count,
  }));
}

/** Everything in `files` that must not be in the repository. */
export function findSensitiveFiles(files: SensitiveFile[]): SensitiveIssue[] {
  const issues: SensitiveIssue[] = [];
  for (const file of files) {
    if (file.path.startsWith(PRIVATE_DIR)) {
      issues.push({ kind: "private-folder", path: file.path });
      continue;
    }
    if (
      DATA_FILE.test(file.path) &&
      !DATA_FILE_DIRS.some((dir) => file.path.startsWith(dir))
    ) {
      issues.push({ kind: "data-file", path: file.path });
    }
    issues.push(...emailIssues(file));
  }
  return issues;
}

/** One line per issue, for the test output and the pre-commit hook ("" when none). */
export function formatIssues(issues: SensitiveIssue[]): string {
  return issues
    .map((issue) => {
      switch (issue.kind) {
        case "data-file":
          return `${issue.path}: data file (.csv/.xlsx/.xls/.parquet) outside fixtures/; real exports go in ${PRIVATE_DIR}`;
        case "private-folder":
          return `${issue.path}: ${PRIVATE_DIR} must never be committed`;
        case "email":
          return `${issue.path}:${issue.line}: ${issue.count} email address(es) at ${issue.domain}; only ${SYNTHETIC_EMAIL_DOMAIN}, example.* and reserved test domains are allowed`;
      }
    })
    .join("\n");
}
