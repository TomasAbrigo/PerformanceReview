// Pure and server-free: the one rule of a change against the previous cycle
// (#133), shared by every DeltaPill.

/**
 * The change `now - before` as a screen shows it: computed on the unrounded
 * values, rounded to the `decimals` the value is written with, and flat (0,
 * a dash) when it rounds to nothing or stays under `minChange`. None (null)
 * when a side is missing or, given `n` (people now, people before) and
 * `minN`, either side counts fewer people than that: a change over a handful
 * of people is noise.
 */
export function shownDelta(input: {
  now: number | null | undefined;
  before: number | null | undefined;
  decimals: number;
  minChange?: number;
  n?: readonly [number | null | undefined, number | null | undefined];
  minN?: number | null;
}): number | null {
  const { now, before, decimals } = input;
  if (now == null || before == null) return null;
  if (input.n && input.minN != null) {
    const [a, b] = input.n;
    if (a == null || b == null || a < input.minN || b < input.minN) return null;
  }
  const raw = now - before;
  if (input.minChange !== undefined && Math.abs(raw) < input.minChange)
    return 0;
  const unit = 10 ** decimals;
  const rounded = Math.round(raw * unit) / unit;
  // No signed zero: -0 would read as a fall.
  return rounded === 0 ? 0 : rounded;
}
