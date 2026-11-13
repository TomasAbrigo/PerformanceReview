/** A fixture file to write, with a path relative to its size directory. */
export interface FixtureFile {
  path: string;
  content: string;
}

/** Stable pretty-printed JSON with a trailing newline (diff-friendly). */
export function jsonFile(path: string, value: unknown): FixtureFile {
  return { path, content: `${JSON.stringify(value, null, 2)}\n` };
}
