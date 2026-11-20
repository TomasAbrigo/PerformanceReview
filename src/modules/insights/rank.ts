// Pure and server-free: how the charts rank groups of very different sizes
// (#133). A raw share puts 4 of 12 above 8 of 41; the lower bound of its
// Wilson interval does not, and a headline names a group only when it clears
// the share of everyone.

/** Under this many people a group is "poca base": muted, last, never a headline. */
export const LOW_BASE_N = 15;

/** The 95 % Wilson score interval of `k` out of `n` (0-1). */
export function wilson(
  k: number,
  n: number,
  z = 1.96,
): {
  low: number;
  high: number;
} {
  if (n <= 0) return { low: 0, high: 1 };
  const p = k / n;
  const z2 = z * z;
  const centre = p + z2 / (2 * n);
  const spread = z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n));
  const denom = 1 + z2 / n;
  return {
    low: Math.max(0, (centre - spread) / denom),
    high: Math.min(1, (centre + spread) / denom),
  };
}

/**
 * Whether `k` of `n` is above `overall` (the share of everyone) beyond the
 * noise: at least `LOW_BASE_N` people and the interval's lower bound over it.
 */
export function standsOut(k: number, n: number, overall: number): boolean {
  return n >= LOW_BASE_N && wilson(k, n).low > overall;
}
