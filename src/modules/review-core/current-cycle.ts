// Pure and server-free: which cycle a screen opens on (#119).

/** The cookie that remembers the cycle last chosen in any screen. */
export const CYCLE_COOKIE = "pr_cycle";

/** How long the choice is remembered, in seconds (30 days). */
export const CYCLE_COOKIE_MAX_AGE = 60 * 60 * 24 * 30;

/**
 * The cycles with the latest period first (by its end, then by name): the
 * order every cycle select and every default follows, whatever order the
 * cycles were created in.
 */
export function latestFirst<
  T extends { name: string; periodStart: string; periodEnd: string },
>(cycles: T[]): T[] {
  return [...cycles].sort(
    (a, b) =>
      b.periodEnd.localeCompare(a.periodEnd) ||
      b.periodStart.localeCompare(a.periodStart) ||
      a.name.localeCompare(b.name),
  );
}

/**
 * The cycle a screen shows: the one its URL asks for, else the one last
 * chosen anywhere in the app (`remembered`, the `CYCLE_COOKIE` value) when
 * this screen has it, else the first of its list.
 */
export function pickCycle<T extends { id: string }>(
  cycles: T[],
  requested: string | undefined,
  remembered: string | undefined,
): T | undefined {
  return (
    cycles.find((c) => c.id === requested) ??
    cycles.find((c) => c.id === remembered) ??
    cycles[0]
  );
}
