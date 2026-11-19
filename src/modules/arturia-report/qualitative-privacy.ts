// Pure: what the anonymized report may publish of the open-text reading
// (#129). Every figure counts distinct people; a figure under the minimum is
// not published, and neither is one that the figures around it give away
// (complementary suppression, #130: `suppressList`, `foldGroups` with
// `absorb`). The readers already leave out the rows (a theme, a signal, a
// group) with fewer people than the minimum; these helpers cover what is
// inside a row (its cells add up to a public base) and what a cut by group
// would let a reader subtract.
import { foldGroups } from "@/modules/insights/aggregation";
import { suppressList } from "@/modules/insights/suppression";

/**
 * The cells of one distribution whose sum is public (the people of the row):
 * those under `min` (and over 0) are hidden (null), and the smallest shown
 * ones with them until no hidden cell can be solved for. null when not even
 * that protects them: the caller leaves the row out. With a minimum of 1
 * (the named report) nothing is hidden.
 */
export function maskCells(
  counts: readonly number[],
  min: number,
): (number | null)[] | null {
  if (min <= 1) return [...counts];
  const hidden = suppressList(counts, min);
  if (hidden === null) return null;
  return counts.map((c, i) => (hidden[i] ? null : c));
}

/** A count that is not part of a distribution (people who cite a theme): hidden when under the minimum. */
export const hideSmall = (count: number, min: number): number | null =>
  count > 0 && count < min ? null : count;

/**
 * "Of `base` people, `count` have it": both figures are public, so the
 * complement is too. The count is published only when neither it nor its
 * complement is under the minimum (a hidden complement gives the count away).
 */
export function maskPair(
  count: number,
  base: number,
  min: number,
): number | null {
  const [shown] = maskCells([count, base - count], min) ?? [null];
  return shown;
}

/** One group of a cut: a label, its people and what it counts. */
export type CutGroup<C> = {
  key: string | null;
  label: string;
  people: number;
  cells: C;
};

/**
 * A cut by group (area, account, DM): the groups under the minimum, and the
 * ones without a value, are folded into one "Otros" group; while that is still
 * under the minimum the smallest groups join it (#130), so no group is hidden
 * next to the public total. `merge` adds up the cells of the folded groups.
 * What is left out altogether (the whole is under the minimum) is `suppressed`
 * people.
 */
export function foldCut<C>(
  groups: readonly CutGroup<C>[],
  min: number,
  merge: (rest: readonly CutGroup<C>[]) => CutGroup<C>,
): { shown: CutGroup<C>[]; others: CutGroup<C> | null; suppressed: number } {
  return foldGroups<CutGroup<C>>(groups, min, {
    size: (g) => g.people,
    named: (g) => g.key !== null,
    absorb: true,
    merge: (rest) => merge(rest),
  });
}

/**
 * Hides, column by column, the counts of a table of groups whose column
 * totals are public (the people with each signal of the whole cycle): the
 * cells under the minimum, and the complementary ones. A column that cannot be
 * protected has all its non-empty cells hidden.
 */
export function maskColumns(
  table: readonly (readonly number[])[],
  min: number,
): (number | null)[][] {
  const columns = table[0]?.length ?? 0;
  const out: (number | null)[][] = table.map(() => []);
  for (let c = 0; c < columns; c++) {
    const column = table.map((row) => row[c]);
    const masked =
      maskCells(column, min) ?? column.map((n) => (n > 0 ? null : n));
    masked.forEach((v, r) => out[r].push(v));
  }
  return out;
}
