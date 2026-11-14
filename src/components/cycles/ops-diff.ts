// Drizzle-free helpers for the audit log's before/after view (#17).

export type DiffEntry = { path: string; before: unknown; after: unknown };

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** Leaves of a snapshot by dotted path; arrays and scalars are leaves. */
function flatten(
  value: Record<string, unknown> | null,
  prefix = "",
): Map<string, unknown> {
  const out = new Map<string, unknown>();
  for (const [key, v] of Object.entries(value ?? {})) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (isPlainObject(v)) {
      for (const [p, leaf] of flatten(v, path)) out.set(p, leaf);
    } else {
      out.set(path, v);
    }
  }
  return out;
}

/** The fields that differ between two audit snapshots (missing = undefined). */
export function diffSnapshots(
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
): DiffEntry[] {
  const b = flatten(before);
  const a = flatten(after);
  // Order of the "after" state, then what only existed before.
  const paths = [...new Set([...a.keys(), ...b.keys()])];
  return paths
    .filter((p) => JSON.stringify(b.get(p)) !== JSON.stringify(a.get(p)))
    .map((path) => ({ path, before: b.get(path), after: a.get(path) }));
}

/** A leaf as text for the diff table. */
export function formatDiffValue(value: unknown): string {
  if (value === undefined || value === null) return "—";
  if (typeof value === "string") return value;
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}
