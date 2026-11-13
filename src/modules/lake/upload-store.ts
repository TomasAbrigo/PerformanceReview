import { createHash } from "node:crypto";
import {
  mkdir,
  readdir,
  readFile,
  rename,
  stat,
  writeFile,
} from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import {
  builtinProfiles,
  getBuiltinProfile,
  sourceProfileSchema,
  type ProfileIssue,
  type SourceProfile,
} from "./profiles";
import {
  PROFILE_NAME,
  UPLOAD_EXTENSIONS,
  UPLOAD_MAX_BYTES,
  type UploadErrorCode,
} from "./upload-shared";

/**
 * Where uploaded files and custom profiles live, and how they are stored.
 * Plain files only (no DuckDB), so the app's server actions can use it
 * directly; reading the files is the worker's job (see upload.ts).
 */

/** A failure the user can act on; `code` maps to a UI message. */
export class UploadError extends Error {
  constructor(
    readonly code: UploadErrorCode,
    message: string,
    /** For `invalid_profile`: what is wrong, column by column. */
    readonly issues: ProfileIssue[] = [],
  ) {
    super(message);
    this.name = "UploadError";
  }
}

/** Where uploads and custom profiles live (defaults: `var/` in the project). */
export type UploadStore = {
  uploadsDir?: string;
  profilesDir?: string;
  /** Size limit in bytes, default {@link UPLOAD_MAX_BYTES}. */
  maxBytes?: number;
};

const uploadsDirOf = (store: UploadStore) =>
  store.uploadsDir ?? process.env.UPLOADS_DIR ?? resolve("var/uploads");
const profilesDirOf = (store: UploadStore) =>
  store.profilesDir ?? process.env.PROFILES_DIR ?? resolve("var/profiles");

export type StoredUpload = {
  /** `<sha256><ext>`: the file name in the uploads folder, and the id the UI keeps. */
  id: string;
  sha256: string;
  ext: string;
  size: number;
  path: string;
  /** Already stored (same content uploaded before). */
  existed: boolean;
};

const UPLOAD_ID = /^([0-9a-f]{64})(\.[a-z]+)$/;

async function exists(path: string): Promise<boolean> {
  return stat(path).then(
    (s) => s.isFile(),
    () => false,
  );
}

/**
 * Store an uploaded file as `<sha256>.<ext>`: the same content is stored once
 * whatever it was called. Checks type and size before writing anything.
 */
export async function storeUpload(
  file: { name: string; bytes: Uint8Array },
  store: UploadStore = {},
): Promise<StoredUpload> {
  const ext = extname(file.name).toLowerCase();
  if (!UPLOAD_EXTENSIONS.includes(ext)) {
    throw new UploadError(
      "unsupported_type",
      `Unsupported file type "${ext || file.name}": use ${UPLOAD_EXTENSIONS.join(", ")}`,
    );
  }
  if (file.bytes.length === 0) {
    throw new UploadError("empty_file", "The file is empty");
  }
  const maxBytes = store.maxBytes ?? UPLOAD_MAX_BYTES;
  if (file.bytes.length > maxBytes) {
    throw new UploadError(
      "file_too_large",
      `The file is ${file.bytes.length} bytes; the limit is ${maxBytes}`,
    );
  }

  const sha256 = createHash("sha256").update(file.bytes).digest("hex");
  const id = `${sha256}${ext}`;
  const dir = uploadsDirOf(store);
  const path = join(dir, id);
  const stored = {
    id,
    sha256,
    ext,
    size: file.bytes.length,
    path,
  };
  if (await exists(path)) return { ...stored, existed: true };

  await mkdir(dir, { recursive: true });
  // Write aside and rename, so a reader never sees a half-written upload.
  const partial = `${path}.${process.pid}.partial`;
  await writeFile(partial, file.bytes);
  await rename(partial, path);
  return { ...stored, existed: false };
}

/** The stored upload an id refers to. Ids that are not ours never touch the disk. */
export async function resolveUpload(
  id: string,
  store: UploadStore = {},
): Promise<StoredUpload> {
  const match = UPLOAD_ID.exec(id);
  if (!match || !UPLOAD_EXTENSIONS.includes(match[2])) {
    throw new UploadError("unknown_upload", "Unknown upload");
  }
  const path = join(uploadsDirOf(store), id);
  const info = await stat(path).catch(() => null);
  if (!info?.isFile()) {
    throw new UploadError("unknown_upload", "Unknown upload");
  }
  return {
    id,
    sha256: match[1],
    ext: match[2],
    size: info.size,
    path,
    existed: true,
  };
}

// --- Profiles --------------------------------------------------------------

/** Parse a profile definition coming from the UI. */
export function parseCustomProfile(input: unknown): SourceProfile {
  const parsed = sourceProfileSchema.safeParse(input);
  if (!parsed.success) {
    throw new UploadError(
      "invalid_profile_definition",
      `Invalid profile: ${parsed.error.issues
        .map((i) => `${i.path.join(".") || "profile"}: ${i.message}`)
        .join("; ")}`,
    );
  }
  const profile = parsed.data;
  if (!PROFILE_NAME.test(profile.name)) {
    throw new UploadError(
      "invalid_profile_definition",
      `Invalid profile name "${profile.name}": use lowercase letters, digits, "-" and "_" (up to 64)`,
    );
  }
  if (getBuiltinProfile(profile.name)) {
    throw new UploadError(
      "profile_exists",
      `"${profile.name}" is a built-in profile: choose another name`,
    );
  }
  return profile;
}

/** Save a custom profile (replacing one with the same name) under `var/profiles/`. */
export async function saveProfile(
  input: SourceProfile,
  store: UploadStore = {},
): Promise<SourceProfile> {
  const profile = parseCustomProfile(input);
  const dir = profilesDirOf(store);
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, `${profile.name}.json`),
    `${JSON.stringify(profile, null, 2)}\n`,
  );
  return profile;
}

/** Built-in profiles followed by the custom ones saved so far. */
export async function listProfiles(
  store: UploadStore = {},
): Promise<SourceProfile[]> {
  const custom: SourceProfile[] = [];
  const files = await readdir(profilesDirOf(store)).catch(() => []);
  for (const file of files.filter((f) => f.endsWith(".json")).sort()) {
    try {
      const raw: unknown = JSON.parse(
        await readFile(join(profilesDirOf(store), file), "utf8"),
      );
      // The file name is the profile name, as saveProfile wrote it.
      const profile = parseCustomProfile(raw);
      if (`${profile.name}.json` === file) custom.push(profile);
    } catch {
      // Not a profile (hand-edited, half-written): skip it.
    }
  }
  return [...builtinProfiles, ...custom];
}

