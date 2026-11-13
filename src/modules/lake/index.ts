/**
 * Lake adapter: read tables from a data lake (or a folder of files standing
 * in for one) and map them onto canonical records through source profiles.
 *
 * Server only (DuckDB is a native module). Client code that just needs the
 * profile schema should import "@/modules/lake/profiles" directly.
 * The shared contract suite lives in "@/modules/lake/contract" (tests only).
 */
export { DuckDbFileLake } from "./duckdb-file-lake";
export {
  applyProfile,
  builtinProfiles,
  getBuiltinProfile,
  PROFILE_ENTITIES,
  readOptionsFor,
  sourceProfileSchema,
  TYPE_FAMILIES,
  validateAgainstSchema,
  type CanonicalRecord,
  type ColumnRole,
  type ProfileEntity,
  type ProfileIssue,
  type ReadOverrides,
  type SourceProfile,
  type TypeFamily,
} from "./profiles";
export type {
  JsonValue,
  LakeAdapter,
  LakeBatch,
  LakeColumn,
  LakeRow,
  ReadOptions,
} from "./types";
