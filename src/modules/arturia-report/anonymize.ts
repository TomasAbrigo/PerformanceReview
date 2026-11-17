// Pure: the anonymization rules of the Arturía export.
import { labels } from "./labels";

export const OTHERS = labels.others;

/**
 * Generic minimum-group-size fold: items under `min` are merged into one
 * "Otros" item (`merge`), dropped (and counted in `suppressed`) when that one
 * is still under the minimum. `size` of the merged item is computed by the
 * caller's merge: sum for disjoint groups, max for overlapping ones
 * (conservative: a person can be in several dimensions or themes).
 */
export function foldGroups<T>(
  items: readonly T[],
  min: number,
  size: (item: T) => number,
  merge: (rest: T[]) => T,
  isNamed: (item: T) => boolean = () => true,
): { shown: T[]; others: T | null; suppressed: number } {
  const shown: T[] = [];
  const rest: T[] = [];
  for (const it of items) {
    (isNamed(it) && size(it) >= min ? shown : rest).push(it);
  }
  if (!rest.length) return { shown, others: null, suppressed: 0 };
  const merged = merge(rest);
  if (size(merged) < min) {
    return {
      shown,
      others: null,
      suppressed: rest.reduce((s, r) => s + size(r), 0),
    };
  }
  return { shown, others: merged, suppressed: 0 };
}

/** Stable "Equipo 1..N" labels for manager ids (sorted, so the same per report). */
export function teamLabels(ids: Iterable<string>): Map<string, string> {
  return new Map(
    [...new Set(ids)].sort().map((id, i) => [id, `${labels.team} ${i + 1}`]),
  );
}

export const EMAIL_PATTERN =
  /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.[\p{L}]{2,}/gu;

export const sumBy = <T>(xs: readonly T[], f: (x: T) => number) =>
  xs.reduce((s, x) => s + f(x), 0);
