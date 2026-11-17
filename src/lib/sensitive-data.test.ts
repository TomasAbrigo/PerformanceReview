import { describe, expect, it } from "vitest";
import {
  findSensitiveFiles,
  formatIssues,
  SYNTHETIC_EMAIL_DOMAIN,
} from "./sensitive-data";
import { readTracked, trackedPaths } from "./sensitive-data-git";

// Addresses that must NOT be in the source as literals (this very file is
// scanned by the repo-wide test below): they are assembled at run time.
const realish = (user: string) => [user, ["gmail", "com"].join(".")].join("@");

describe("findSensitiveFiles: data files", () => {
  it.each(["csv", "xlsx", "xls", "parquet", "CSV"])(
    "flags a .%s outside the allowed folders",
    (ext) => {
      const issues = findSensitiveFiles([
        { path: `reports/export.${ext}`, content: "a,b\n1,2\n" },
      ]);
      expect(issues).toEqual([
        { kind: "data-file", path: `reports/export.${ext}` },
      ]);
    },
  );

  it("flags a data file even when its content was not read (binary)", () => {
    expect(findSensitiveFiles([{ path: "export.xlsx" }])).toEqual([
      { kind: "data-file", path: "export.xlsx" },
    ]);
  });

  it.each([
    "fixtures/bamboo/small/employees.csv",
    "fixtures/bamboo-reports/demo/assessment-progress.csv",
    "src/modules/lake/__fixtures__/initial/employee.csv",
    "src/modules/bamboo-client/__fixtures__/export.csv",
  ])("allows %s", (path) => {
    expect(findSensitiveFiles([{ path, content: "a,b\n" }])).toEqual([]);
  });

  it("does not let a look-alike folder through", () => {
    expect(
      findSensitiveFiles([{ path: "docs/fixtures/export.csv", content: "" }]),
    ).toEqual([{ kind: "data-file", path: "docs/fixtures/export.csv" }]);
  });

  it("flags anything tracked under data/private/", () => {
    expect(
      findSensitiveFiles([{ path: "data/private/notes.txt", content: "x" }]),
    ).toEqual([{ kind: "private-folder", path: "data/private/notes.txt" }]);
  });
});

describe("findSensitiveFiles: emails", () => {
  it("flags an email whose domain is not the synthetic one, naming file, line and domain but not the address", () => {
    const address = realish("jane.roe");
    const issues = findSensitiveFiles([
      { path: "docs/notes.md", content: `first line\ncontact: ${address}\n` },
    ]);
    expect(issues).toEqual([
      {
        kind: "email",
        path: "docs/notes.md",
        line: 2,
        domain: "gmail.com",
        count: 1,
      },
    ]);
    expect(formatIssues(issues)).not.toContain("jane.roe");
    expect(formatIssues(issues)).toContain("docs/notes.md:2");
  });

  it("counts every address of a domain in a file but reports the first line", () => {
    const content = [
      realish("a.b"),
      "ok",
      realish("c.d"),
      `x@${SYNTHETIC_EMAIL_DOMAIN}`,
    ].join("\n");
    expect(findSensitiveFiles([{ path: "a.txt", content }])).toEqual([
      { kind: "email", path: "a.txt", line: 1, domain: "gmail.com", count: 2 },
    ]);
  });

  it("compares domains case-insensitively", () => {
    const content = `Ana.Garcia@${SYNTHETIC_EMAIL_DOMAIN.toUpperCase()}`;
    expect(findSensitiveFiles([{ path: "a.txt", content }])).toEqual([]);
  });

  it.each([
    `ana@${SYNTHETIC_EMAIL_DOMAIN}`,
    "ana@example.com",
    "ana@example.org",
    "ana@mail.example.com",
    "ana@example.test",
    "ana@corp.invalid",
    "noreply@github.com",
    "git@github.com",
    "git@gitlab.com",
    "git@bitbucket.org",
  ])("allows %s", (address) => {
    expect(
      findSensitiveFiles([{ path: "a.txt", content: `mail ${address}.` }]),
    ).toEqual([]);
  });

  it("does not mistake a look-alike domain for an allowed one", () => {
    const content = `ana@not${"example"}.com\nana@example.com.${"evil"}.io`;
    const issues = findSensitiveFiles([{ path: "a.txt", content }]);
    expect(issues.map((i) => i.kind === "email" && i.domain)).toEqual([
      "notexample.com",
      "example.com.evil.io",
    ]);
  });

  it("allows SSH remotes", () => {
    const content = [
      "git clone git@github.com:TomasAbrigo/PerformanceReview.git",
      "url = git@gitlab.com:group/repo.git",
    ].join("\n");
    expect(findSensitiveFiles([{ path: "docs/a.md", content }])).toEqual([]);
  });

  it("still finds an address on a line that also holds a connection URL", () => {
    const content = `{"url":"postgres://a:b@host.internal/db","owner":"${realish("jane.roe")}"}`;
    expect(findSensitiveFiles([{ path: "a.json", content }])).toEqual([
      { kind: "email", path: "a.json", line: 1, domain: "gmail.com", count: 1 },
    ]);
  });

  it("ignores credentials in connection URLs and package specs", () => {
    const content = [
      "postgresql://postgres:postgres@127.0.0.1:55322/db",
      "postgresql://u:p@db.abcdefgh.supabase.co:5432/postgres",
      "react@19.3.0 @types/node@25.0.0 pnpm@12.10.1",
    ].join("\n");
    expect(findSensitiveFiles([{ path: "a.ts", content }])).toEqual([]);
  });

  it("skips files without content (binary) and generated files", () => {
    const address = realish("jane.roe");
    expect(
      findSensitiveFiles([
        { path: "public/logo.png" },
        { path: "pnpm-lock.yaml", content: address },
        { path: "drizzle/meta/0001_snapshot.json", content: address },
        { path: "node_modules/x/index.js", content: address },
      ]),
    ).toEqual([]);
  });

  it("finds nothing in clean files", () => {
    expect(
      findSensitiveFiles([
        { path: "src/a.ts", content: "export const a = 1;\n" },
        { path: "README.md", content: "# Title\n" },
      ]),
    ).toEqual([]);
  });
});

describe("the repository", () => {
  it("tracks no data file outside fixtures and no email outside the synthetic domain", () => {
    const files = readTracked(trackedPaths());
    expect(files.length).toBeGreaterThan(100);
    const issues = findSensitiveFiles(files);
    expect(formatIssues(issues)).toBe("");
    expect(issues).toEqual([]);
  });
});
