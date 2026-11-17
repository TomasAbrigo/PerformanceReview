// Pure and server-free: minimum-group-size rules for aggregate views.

/** A group of people in an aggregate view: its n, mean and rating bins. */
export type GroupCell = {
  /** Null: people without that dimension (no department). */
  key: string | null;
  n: number;
  mean: number | null;
  counts: number[];
};

export type FoldedGroups<G extends GroupCell> = {
  /** Named groups with at least the minimum, as they came. */
  shown: G[];
  /** The rest together ("Otros"); null when empty or still under the minimum. */
  others: Pick<GroupCell, "n" | "mean" | "counts"> | null;
  /** People left out of the breakdown altogether (Otros is under the minimum). */
  suppressed: number;
};

/**
 * Groups of fewer than `minGroupSize` people (and the unnamed one) are folded
 * into one "Otros" cell; if that is still under the minimum it is hidden and
 * its people are only counted, so no cell with fewer people than the minimum
 * is ever shown. With a minimum of 1 only the unnamed group is folded.
 */
export function foldSmallGroups<G extends GroupCell>(
  groups: readonly G[],
  minGroupSize: number,
): FoldedGroups<G> {
  const shown: G[] = [];
  const rest: G[] = [];
  for (const g of groups) {
    (g.key !== null && g.n >= minGroupSize ? shown : rest).push(g);
  }
  const n = rest.reduce((sum, g) => sum + g.n, 0);
  if (n === 0) return { shown, others: null, suppressed: 0 };
  if (n < minGroupSize) return { shown, others: null, suppressed: n };

  const counts = rest[0].counts.map((_, bin) =>
    rest.reduce((sum, g) => sum + g.counts[bin], 0),
  );
  const withMean = rest.filter((g) => g.mean !== null);
  const meanN = withMean.reduce((sum, g) => sum + g.n, 0);
  const mean = meanN
    ? withMean.reduce((sum, g) => sum + g.n * g.mean!, 0) / meanN
    : null;
  return { shown, others: { n, mean, counts }, suppressed: 0 };
}
