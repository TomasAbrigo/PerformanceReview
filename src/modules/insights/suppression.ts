// Pure and server-free: complementary suppression for aggregate views.
//
// The rule (#130): a reader that sees what is shown and every total around it
// (the grand total and, for a table, its row and column totals, which other
// charts of the same view publish anyway) must not be able to solve for a
// hidden count. A count under the minimum is hidden; then more counts are
// hidden until each hidden one can move without breaking any visible number.
// An empty cell is shown as 0, so the reader knows a hidden one holds at
// least one person: a hidden count can only move if what it gives to or takes
// from another hidden count keeps that one at one or more.

/**
 * Which entries of a list to hide when the sum of the list is public: those
 * under `min` (and over 0), and, while a single entry is hidden or the hidden
 * ones hold one person each, the smallest of the shown ones. Null when not
 * even hiding every non-empty entry protects them (the whole is under the
 * minimum): then the caller hides the list and its total.
 */
export function suppressList(
  counts: readonly number[],
  min: number,
): boolean[] | null {
  const hidden = counts.map((c) => c > 0 && c < min);
  for (;;) {
    const shut = counts.filter((_, i) => hidden[i]);
    const sum = shut.reduce((a, b) => a + b, 0);
    if (shut.length === 0 || (shut.length >= 2 && sum > shut.length)) {
      return hidden;
    }
    const next = counts
      .map((c, i) => ({ c, i }))
      .filter(({ c, i }) => !hidden[i] && c > 0)
      .sort((a, b) => a.c - b.c || a.i - b.i)[0];
    if (!next) return null;
    hidden[next.i] = true;
  }
}

type Cell = readonly [row: number, col: number];

/**
 * Whether the hidden cell (r0, c0) lies on a cycle of hidden cells (+ - + -
 * alternating along rows and columns) along which one person can be moved
 * without leaving any hidden cell empty: then another table with the same
 * visible cells and margins gives that cell another value.
 */
function canMove(
  counts: readonly (readonly number[])[],
  hidden: readonly (readonly boolean[])[],
  r0: number,
  c0: number,
): boolean {
  const R = counts.length;
  const C = counts[0]?.length ?? 0;
  const feasible = (cells: Cell[]) =>
    [1, -1].some((d) =>
      cells.every(
        ([r, c], i) => (i % 2 === 0 ? d : -d) > 0 || counts[r][c] >= 2,
      ),
    );
  const search = (rows: number[], cols: number[]): boolean => {
    const k = rows.length;
    const last = cols[k - 1];
    if (k >= 2 && hidden[r0][last]) {
      const cells: Cell[] = [];
      for (let i = 0; i < k; i++) {
        cells.push([rows[i], cols[i]], [rows[(i + 1) % k], cols[i]]);
      }
      if (feasible(cells)) return true;
    }
    for (let r = 0; r < R; r++) {
      if (rows.includes(r) || !hidden[r][last]) continue;
      for (let c = 0; c < C; c++) {
        if (cols.includes(c) || !hidden[r][c]) continue;
        if (search([...rows, r], [...cols, c])) return true;
      }
    }
    return false;
  };
  return search([r0], [c0]);
}

/**
 * Which cells of a table to hide when its row, column and grand totals are
 * public: those under `min` (and over 0), and then, while one of them can be
 * solved for, the smallest shown cell (one in the same row or column first).
 * Null when not even hiding every non-empty cell protects them: then the
 * caller hides the table and its total.
 */
export function suppressTable(
  counts: readonly (readonly number[])[],
  min: number,
): boolean[][] | null {
  const hidden = counts.map((row) => row.map((c) => c > 0 && c < min));
  for (;;) {
    const exposed: Cell[] = [];
    counts.forEach((row, r) =>
      row.forEach((_, c) => {
        if (hidden[r][c] && !canMove(counts, hidden, r, c)) {
          exposed.push([r, c]);
        }
      }),
    );
    if (exposed.length === 0) return hidden;
    const [er, ec] = exposed[0];
    const next = counts
      .flatMap((row, r) => row.map((count, c) => ({ count, r, c })))
      .filter(({ count, r, c }) => !hidden[r][c] && count > 0)
      .sort(
        (a, b) =>
          Number(a.r !== er && a.c !== ec) - Number(b.r !== er && b.c !== ec) ||
          a.count - b.count ||
          a.r - b.r ||
          a.c - b.c,
      )[0];
    if (!next) return null;
    hidden[next.r][next.c] = true;
  }
}
