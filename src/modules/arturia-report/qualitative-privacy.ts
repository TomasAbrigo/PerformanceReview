// Pure: what the anonymized report may publish of the open-text reading
// (#129). Every figure counts distinct people; a figure under the minimum is
// not published, and neither is one that the figures around it give away
// (complementary suppression, #130: `suppressList`, `foldGroups` with
// `absorb`). The readers already leave out the rows (a theme, a signal, a
// group) with fewer people than the minimum; these helpers cover what is
// inside a row (its cells add up to a public base) and what a cut by group
// would let a reader subtract.
import { foldGroups } from "@/modules/insights/aggregation";
import { suppressList, suppressTable } from "@/modules/insights/suppression";

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

/**
 * The cells of a table of groups whose row totals (the people of each group)
 * and column totals (the people of the whole per answer) are public, as
 * `maskCells` for a list: those under `min` (and over 0) are hidden, and more
 * until no hidden cell can be solved for from the rows, the columns and the
 * grand total (`suppressTable`, #130). null when not even hiding every
 * non-empty cell protects them (the whole is under the minimum, or the small
 * cells are all it has): the caller leaves the table out, since a hidden cell
 * next to a shown 0, or a column whose total is public, would give it away.
 * Nothing is hidden with a minimum of 1.
 */
export function maskTable(
  table: readonly (readonly number[])[],
  min: number,
): (number | null)[][] | null {
  if (min <= 1) return table.map((row) => [...row]);
  const hidden = suppressTable(table, min);
  if (hidden === null) return null;
  return table.map((row, r) =>
    row.map((c, k) => (c > 0 && hidden[r][k] ? null : c)),
  );
}

/**
 * The share who do not feel valued (the first two of the four values of the
 * "valued" scale) of a row whose cells may be hidden: published only when it
 * gives no hidden cell away. The sum of values 1 and 2 next to a hidden value 1
 * and a shown value 2 would solve the first one; next to a hidden value 3 it
 * would solve that one from the hidden total. So: when none of the four
 * is hidden, or when only 1 and 2 are (the sum is then the sum of what is
 * hidden anyway), or when neither of them is.
 */
export function notValuedOf(
  cells: readonly (number | null)[],
  notValued: number,
): number | null {
  const hidden = (i: number) => cells[i] === null;
  const h12 = [0, 1].filter(hidden).length;
  const h34 = [2, 3].filter(hidden).length;
  return h12 === 0 || (h12 === 2 && h34 === 0) ? notValued : null;
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
 * protected (`unprotected`) is hidden entirely and its total must go too: the
 * caller leaves out the row whose total it is.
 */
export function maskColumns(
  table: readonly (readonly number[])[],
  min: number,
): { cells: (number | null)[][]; unprotected: boolean[] } {
  const columns = table[0]?.length ?? 0;
  const cells: (number | null)[][] = table.map(() => []);
  const unprotected: boolean[] = [];
  for (let c = 0; c < columns; c++) {
    const column = table.map((row) => row[c]);
    const masked = maskCells(column, min);
    unprotected.push(masked === null);
    (masked ?? column.map(() => null)).forEach((v, r) => cells[r].push(v));
  }
  return { cells, unprotected };
}
