// Pure: helpers of the Arturía export's anonymization.

/** Stable "<team> 1..N" labels for manager ids (sorted, so the same per report). */
export function teamLabels(
  ids: Iterable<string>,
  team = "Equipo",
): Map<string, string> {
  return new Map(
    [...new Set(ids)].sort().map((id, i) => [id, `${team} ${i + 1}`]),
  );
}

export const sumBy = <T>(xs: readonly T[], f: (x: T) => number) =>
  xs.reduce((s, x) => s + f(x), 0);
