// Pure: helpers of the Arturía export's anonymization.
import { createHash } from "node:crypto";

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

/**
 * The "Equipo N" / "DM N" aliases of an anonymized report. Numbered the same
 * in every cut, an alias is a join key: someone holding two cuts (completion
 * by team and goals by team) can match the groups of equal size and read both
 * measures of the same team, so the numbering is NOT stable across cuts. Each
 * scope (a section and its cut) numbers the entities in the order of
 * `sha256(salt | scope | id)`; the salt is random per report, so it is not
 * stable between two exports either. Inside one scope the alias is stable
 * (the rows of one cut read as one group). Without a salt (the named report)
 * the plain stable labels.
 */
export class AliasBook {
  private readonly scopes = new Map<string, Map<string, string>>();

  constructor(
    private readonly base: ReadonlyMap<string, string>,
    private readonly salt: string | null,
  ) {}

  label(scope: string, id: string): string | undefined {
    if (this.salt === null) return this.base.get(id);
    let labels = this.scopes.get(scope);
    if (!labels) {
      const prefix = (label: string) => label.replace(/ \d+$/, "");
      const hash = (key: string) =>
        createHash("sha256")
          .update(`${this.salt}|${scope}|${key}`)
          .digest("hex");
      labels = new Map(
        [...this.base.keys()]
          .sort((a, b) => hash(a).localeCompare(hash(b)))
          .map((key, i) => [key, `${prefix(this.base.get(key)!)} ${i + 1}`]),
      );
      this.scopes.set(scope, labels);
    }
    return labels.get(id);
  }
}
