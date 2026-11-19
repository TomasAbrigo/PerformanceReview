// Test support: the reader who tries to solve for masked counts (#130).

/**
 * Every value each masked cell (null) can take in a table whose visible
 * cells, row totals and column totals are known, with masked cells holding
 * at least `floor` (an empty cell is shown as 0, so a masked one holds 1+).
 * A masked cell with a single possible value can be solved for.
 */
export function solveMasked(
  table: readonly (readonly (number | null)[])[],
  rowSums: readonly number[],
  colSums: readonly number[],
  floor = 1,
): Map<string, Set<number>> {
  const masked: [number, number][] = [];
  table.forEach((row, r) =>
    row.forEach((v, c) => {
      if (v === null) masked.push([r, c]);
    }),
  );
  const found = new Map(
    masked.map(([r, c]) => [`${r}:${c}`, new Set<number>()]),
  );
  const rows = rowSums.map(
    (s, r) => s - table[r].reduce<number>((a, v) => a + (v ?? 0), 0),
  );
  const cols = colSums.map(
    (s, c) => s - table.reduce<number>((a, row) => a + (row[c] ?? 0), 0),
  );
  const values: number[] = [];
  const walk = (i: number) => {
    if (i === masked.length) {
      if (rows.every((x) => x === 0) && cols.every((x) => x === 0)) {
        masked.forEach(([r, c], j) => found.get(`${r}:${c}`)!.add(values[j]));
      }
      return;
    }
    const [r, c] = masked[i];
    // The last masked cell of a row or column is forced by its total.
    const lastInRow = !masked.slice(i + 1).some(([r2]) => r2 === r);
    const lastInCol = !masked.slice(i + 1).some(([, c2]) => c2 === c);
    const hi = Math.min(rows[r], cols[c]);
    const lo = lastInRow ? rows[r] : lastInCol ? cols[c] : floor;
    for (
      let v = Math.max(lo, floor);
      v <= (lastInRow || lastInCol ? lo : hi);
      v++
    ) {
      if (v > hi) break;
      rows[r] -= v;
      cols[c] -= v;
      values.push(v);
      walk(i + 1);
      values.pop();
      rows[r] += v;
      cols[c] += v;
    }
  };
  walk(0);
  return found;
}

/** The masked cells a reader can solve for (one possible value only). */
export function solvable(
  table: readonly (readonly (number | null)[])[],
  truth: readonly (readonly number[])[],
): string[] {
  const rowSums = truth.map((row) => row.reduce((a, b) => a + b, 0));
  const colSums = truth[0].map((_, c) =>
    truth.reduce((a, row) => a + row[c], 0),
  );
  return [...solveMasked(table, rowSums, colSums)].flatMap(([key, set]) =>
    set.size <= 1 ? [key] : [],
  );
}
