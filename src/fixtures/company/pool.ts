/**
 * The generator draws people and rows from limited pools. A pool that is too
 * small for the size config is a configuration bug: fail loudly instead of
 * silently producing fewer records than the config promises.
 */
export function requireAtLeast(
  available: number,
  needed: number,
  what: string,
): void {
  if (available < needed) {
    throw new Error(
      `Fixture config too ambitious: need ${needed} ${what}, only ${available} available`,
    );
  }
}

export function requirePool(
  pool: readonly unknown[],
  needed: number,
  what: string,
): void {
  requireAtLeast(pool.length, needed, what);
}
