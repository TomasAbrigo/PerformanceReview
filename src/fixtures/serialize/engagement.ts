import {
  DEFAULT_CUTOFFS,
  monthRange,
  segmentOfScore,
  shiftMonth,
} from "@/modules/engagement/kinds";
import type { CompanyFixture } from "../company";
import { createRng } from "../company/rng";
import { toCsv } from "./csv";
import type { FixtureFile } from "./files";

export const ENGAGEMENT_HEADER = [
  "EEID",
  "Nombre",
  "Mes",
  "Score",
  "Segmento",
] as const;

/** Months of history before the as-of month, by size. */
const WINDOW = { small: 12, demo: 18 } as const;

const LABEL = {
  alto: "Alto",
  medio: "Medio",
  regular: "Regular",
  bajo: "Bajo",
} as const;

const clamp = (n: number) => Math.min(1, Math.max(0, n));

/**
 * The monthly engagement file (docs/engagement-monthly.md) for the synthetic
 * company, deterministic from its seed: from the hire month (or the start of
 * the window) to the termination month (or the last full month before the
 * as-of date), one row per person and month. A person's score hovers around
 * their own level with a company-wide drift and noise; some months nobody
 * answers (`Falta`, no score), some people answer rarely. As with the org
 * attributes file, each person is listed once, under the id that became them
 * (a rehire's later ids wait in the identity queue).
 */
export function serializeEngagement(company: CompanyFixture): FixtureFile[] {
  const rng = createRng(company.seed ^ 0x3a6e);
  const last = shiftMonth(`${company.asOf.slice(0, 7)}-01`, -1);
  const first = shiftMonth(last, -(WINDOW[company.size] - 1));
  const months = monthRange(first, last);
  // One drift per month, shared by everybody: engagement moves together.
  let level = 0;
  const drift = new Map(
    months.map((m) => {
      level = clamp(level + (rng.next() - 0.5) * 0.06 + 0.002);
      return [m, level - 0.05] as const;
    }),
  );

  const later = new Set(
    company.identity.persons.flatMap((p) => p.employeeIds.slice(1)),
  );
  const employees = company.employees
    .filter((e) => !later.has(e.id))
    .sort((a, b) => a.id.localeCompare(b.id, "en", { numeric: true }));
  const rows: string[][] = [];
  for (const e of employees) {
    const from = `${e.hireDate.slice(0, 7)}-01`;
    const to = e.terminationDate ? `${e.terminationDate.slice(0, 7)}-01` : last;
    const baseline = 0.4 + 0.5 * rng.next();
    const silent = 0.05 + 0.3 * rng.next() * rng.next();
    const name = `${e.firstName} ${e.lastName}`;
    for (const month of months) {
      if (month < from || month > to) continue;
      const mes = month.slice(0, 7);
      if (rng.chance(silent)) {
        rows.push([e.id, name, mes, "", "Falta"]);
        continue;
      }
      const score =
        Math.round(
          clamp(baseline + (drift.get(month) ?? 0) + (rng.next() - 0.5) * 0.3) *
            100,
        ) / 100;
      rows.push([
        e.id,
        name,
        mes,
        score.toFixed(2),
        LABEL[segmentOfScore(score, DEFAULT_CUTOFFS)],
      ]);
    }
  }
  return [
    {
      path: "engagement-monthly.csv",
      content: toCsv(ENGAGEMENT_HEADER, rows),
    },
  ];
}
