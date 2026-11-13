// @vitest-environment node
import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { csvDirToParquet } from "./fixtures";
import { getBuiltinProfile, type SourceProfile } from "./profiles";
import {
  inspectUpload,
  listProfiles,
  resolveUpload,
  saveProfile,
  storeUpload,
  UploadError,
  UPLOAD_MAX_BYTES,
  type UploadStore,
} from "./upload";

const EMPLOYEE_PERFORMANCE = resolve(
  "fixtures/bamboo-reports/small/employee-performance.csv",
);

/** An UploadStore with both folders set. */
type TestStore = UploadStore & { uploadsDir: string; profilesDir: string };

let root: string;
let store: TestStore;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "upload-test-"));
  store = {
    uploadsDir: join(root, "uploads"),
    profilesDir: join(root, "profiles"),
  };
});
afterEach(() => rm(root, { recursive: true, force: true }));

const text = (content: string) => new TextEncoder().encode(content);
const sha256 = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof UploadError) return error.code;
    throw error;
  }
  throw new Error("expected an UploadError");
}

describe("storeUpload", () => {
  it("stores the file as <sha256>.<ext> and reports hash and size", async () => {
    const bytes = await readFile(EMPLOYEE_PERFORMANCE);

    const stored = await storeUpload({ name: "Reporte.CSV", bytes }, store);

    expect(stored).toMatchObject({
      sha256: sha256(bytes),
      ext: ".csv",
      size: bytes.length,
      existed: false,
      id: `${sha256(bytes)}.csv`,
    });
    expect(await readdir(store.uploadsDir)).toEqual([`${sha256(bytes)}.csv`]);
    expect(await readFile(stored.path)).toEqual(bytes);
  });

  it("dedupes by content: the same bytes under another name are stored once", async () => {
    const bytes = text("a,b\n1,2\n");

    const first = await storeUpload({ name: "one.csv", bytes }, store);
    const second = await storeUpload({ name: "copia de one.csv", bytes }, store);

    expect(second.existed).toBe(true);
    expect(second.id).toBe(first.id);
    expect(await readdir(store.uploadsDir)).toHaveLength(1);
  });

  it("keeps different content apart, even for the same file name", async () => {
    const first = await storeUpload(
      { name: "r.csv", bytes: text("a\n1\n") },
      store,
    );
    const second = await storeUpload(
      { name: "r.csv", bytes: text("a\n2\n") },
      store,
    );

    expect(second.id).not.toBe(first.id);
    expect(await readdir(store.uploadsDir)).toHaveLength(2);
  });

  it.each([
    ["report.pdf", "unsupported_type"],
    ["report", "unsupported_type"],
    ["../../evil.sh", "unsupported_type"],
  ])("rejects %s", async (name, code) => {
    expect(await codeOf(storeUpload({ name, bytes: text("x") }, store))).toBe(
      code,
    );
  });

  it("accepts csv, xlsx, parquet and ndjson", async () => {
    for (const name of ["a.csv", "b.xlsx", "c.parquet", "d.ndjson"]) {
      await storeUpload({ name, bytes: text(name) }, store);
    }
    expect(await readdir(store.uploadsDir)).toHaveLength(4);
  });

  it("rejects an empty file and one over the limit, writing nothing", async () => {
    expect(
      await codeOf(storeUpload({ name: "a.csv", bytes: text("") }, store)),
    ).toBe("empty_file");
    expect(
      await codeOf(
        storeUpload({ name: "a.csv", bytes: text("abcdef") }, {
          ...store,
          maxBytes: 5,
        }),
      ),
    ).toBe("file_too_large");
    expect(UPLOAD_MAX_BYTES).toBe(50 * 1024 * 1024);
    await expect(readdir(store.uploadsDir)).rejects.toThrow();
  });
});

describe("resolveUpload", () => {
  it("finds a stored upload by id", async () => {
    const stored = await storeUpload(
      { name: "a.csv", bytes: text("a\n1\n") },
      store,
    );

    expect(await resolveUpload(stored.id, store)).toMatchObject({
      id: stored.id,
      path: stored.path,
      existed: true,
    });
  });

  it("refuses ids that are not a stored upload, including path tricks", async () => {
    for (const id of [
      "../../etc/passwd",
      "../x.csv",
      `${"a".repeat(64)}.sh`,
      "abc.csv",
      `${"a".repeat(64)}.csv`, // well formed but never stored
    ]) {
      expect(await codeOf(resolveUpload(id, store))).toBe("unknown_upload");
    }
  });
});

describe("inspectUpload", () => {
  it("returns the detected columns and the first 20 rows", async () => {
    const stored = await storeUpload(
      { name: "ep.csv", bytes: await readFile(EMPLOYEE_PERFORMANCE) },
      store,
    );

    const inspection = await inspectUpload(stored.id, store);

    expect(inspection.columns.slice(0, 5)).toEqual([
      { name: "Employee Name", type: "VARCHAR", nullable: true },
      { name: "Manager", type: "VARCHAR", nullable: true },
      { name: "Department", type: "VARCHAR", nullable: true },
      { name: "Review Cycle", type: "VARCHAR", nullable: true },
      { name: "Assessment Date", type: "DATE", nullable: true },
    ]);
    expect(inspection.rows).toHaveLength(20);
    expect(inspection.rows[0]).toHaveProperty("Employee Name");
    expect(inspection.rows[0]).toHaveProperty("Assessment Date");
  });

  it("returns fewer rows for a short file, and none for a header-only one", async () => {
    const short = await storeUpload(
      { name: "s.csv", bytes: text("id,name\n1,Ana\n2,Beto\n") },
      store,
    );
    const empty = await storeUpload(
      { name: "e.csv", bytes: text("id,name\n") },
      store,
    );

    expect((await inspectUpload(short.id, store)).rows).toEqual([
      { id: "1", name: "Ana" },
      { id: "2", name: "Beto" },
    ]);
    const none = await inspectUpload(empty.id, store);
    expect(none.rows).toEqual([]);
    expect(none.columns.map((c) => c.name)).toEqual(["id", "name"]);
  });

  it("reads ndjson and parquet like csv", async () => {
    const ndjson = await storeUpload(
      {
        name: "r.ndjson",
        bytes: text('{"id":1,"name":"Ana"}\n{"id":2,"name":"Beto"}\n'),
      },
      store,
    );
    const csvDir = join(root, "csv");
    await mkdir(csvDir);
    await writeFile(join(csvDir, "p.csv"), "id,name\n1,Ana\n2,Beto\n3,Carla\n");
    const [parquetPath] = await csvDirToParquet(csvDir, join(root, "pq"));
    const parquet = await storeUpload(
      { name: "p.parquet", bytes: await readFile(parquetPath) },
      store,
    );

    expect((await inspectUpload(ndjson.id, store)).rows).toHaveLength(2);
    const fromParquet = await inspectUpload(parquet.id, store);
    expect(fromParquet.rows).toHaveLength(3);
    expect(fromParquet.columns.map((c) => c.name)).toEqual(["id", "name"]);
  });

  it("explains a file that cannot be read, and leaves no temporary folder", async () => {
    const bad = await storeUpload(
      { name: "bad.parquet", bytes: text("this is not parquet") },
      store,
    );
    const before = (await readdir(tmpdir())).filter((f) =>
      f.startsWith("upload-lake-"),
    );

    expect(await codeOf(inspectUpload(bad.id, store))).toBe("unreadable_file");

    const after = (await readdir(tmpdir())).filter((f) =>
      f.startsWith("upload-lake-"),
    );
    expect(after).toEqual(before);
  });
});

describe("profiles", () => {
  const custom: SourceProfile = {
    name: "mis-ventas",
    table: "mis-ventas",
    keyColumns: ["id"],
    watermarkColumn: "updated_at",
    entity: "goal",
    columnMap: { id: "bamboo_goal_id", title: "title" },
  };

  it("lists the built-in profiles when there are no custom ones", async () => {
    const profiles = await listProfiles(store);

    expect(profiles.map((p) => p.name)).toContain("bamboo-employee-performance");
    expect(profiles).toHaveLength(9);
  });

  it("saves a custom profile as JSON under the profiles folder and lists it", async () => {
    await saveProfile(custom, store);

    expect(JSON.parse(await readFile(join(store.profilesDir, "mis-ventas.json"), "utf8"))).toEqual(custom);
    const profiles = await listProfiles(store);
    expect(profiles.at(-1)).toEqual(custom);
    expect(profiles).toHaveLength(10);
  });

  it("overwrites a custom profile with the same name", async () => {
    await saveProfile(custom, store);
    await saveProfile({ ...custom, keyColumns: ["id", "title"] }, store);

    const saved = (await listProfiles(store)).filter(
      (p) => p.name === "mis-ventas",
    );
    expect(saved).toHaveLength(1);
    expect(saved[0].keyColumns).toEqual(["id", "title"]);
  });

  it("does not shadow a built-in profile", async () => {
    const builtin = getBuiltinProfile("bamboo-goal-status")!;

    expect(await codeOf(saveProfile({ ...builtin, keyColumns: ["Goal"] }, store))).toBe(
      "profile_exists",
    );
  });

  it.each(["../escape", "con espacios", "Mayusculas", "", "a/b", ".hidden"])(
    "refuses the name %j",
    async (name) => {
      expect(
        await codeOf(saveProfile({ ...custom, name, table: "t" }, store)),
      ).toBe("invalid_profile_definition");
    },
  );

  it("refuses a definition without key columns", async () => {
    expect(await codeOf(saveProfile({ ...custom, keyColumns: [] }, store))).toBe(
      "invalid_profile_definition",
    );
  });

  it("ignores saved files that are not valid profiles", async () => {
    await saveProfile(custom, store);
    await writeFile(join(store.profilesDir, "roto.json"), "{not json");
    await writeFile(join(store.profilesDir, "raro.json"), '{"name":"raro"}');

    const names = (await listProfiles(store)).map((p) => p.name);

    expect(names).toContain("mis-ventas");
    expect(names).not.toContain("roto");
    expect(names).not.toContain("raro");
  });
});
