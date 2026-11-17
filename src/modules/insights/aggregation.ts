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
 * The generic fold: items under `minGroupSize` (and the unnamed ones) are
 * merged into one "Otros" item by `merge`; if that one is still under the
 * minimum it is dropped and the size of what it held is `suppressed`.
 */
export function foldGroups<T>(
  items: readonly T[],
  minGroupSize: number,
  opts: {
    size: (item: T) => number;
    merge: (rest: T[]) => T;
    named?: (item: T) => boolean;
  },
): { shown: T[]; others: T | null; suppressed: number } {
  const named = opts.named ?? (() => true);
  const shown: T[] = [];
  const rest: T[] = [];
  for (const it of items) {
    (named(it) && opts.size(it) >= minGroupSize ? shown : rest).push(it);
  }
  if (!rest.length) return { shown, others: null, suppressed: 0 };
  const merged = opts.merge(rest);
  const n = opts.size(merged);
  if (n === 0) return { shown, others: null, suppressed: 0 };
  if (n < minGroupSize) return { shown, others: null, suppressed: n };
  return { shown, others: merged, suppressed: 0 };
}

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
  type Cell = Pick<GroupCell, "n" | "mean" | "counts"> & { group?: G };
  const { shown, others, suppressed } = foldGroups<Cell>(
    groups.map((g) => ({ n: g.n, mean: g.mean, counts: g.counts, group: g })),
    minGroupSize,
    {
      size: (c) => c.n,
      named: (c) => c.group?.key != null,
      merge: (rest) => {
        const counts = rest[0].counts.map((_, bin) =>
          rest.reduce((sum, g) => sum + g.counts[bin], 0),
        );
        const withMean = rest.filter((g) => g.mean !== null);
        const meanN = withMean.reduce((sum, g) => sum + g.n, 0);
        return {
          n: rest.reduce((sum, g) => sum + g.n, 0),
          mean: meanN
            ? withMean.reduce((sum, g) => sum + g.n * g.mean!, 0) / meanN
            : null,
          counts,
        };
      },
    },
  );
  return {
    shown: shown.map((c) => c.group!),
    others: others && { n: others.n, mean: others.mean, counts: others.counts },
    suppressed,
  };
}
