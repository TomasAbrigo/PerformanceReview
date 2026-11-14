/**
 * Bamboo renders `reportsTo` as "Last, First", and the hand-written fixtures
 * have "First Last": rewrites the jobInfo rows (in place) the way Bamboo does.
 * Only for names with a one-word first name, which is what the fixtures use.
 */
export function writeAsLastFirst(rows: { reportsTo: string | null }[]) {
  for (const r of rows) {
    if (!r.reportsTo) continue;
    const [first, ...rest] = r.reportsTo.split(" ");
    r.reportsTo = `${rest.join(" ")}, ${first}`;
  }
}
