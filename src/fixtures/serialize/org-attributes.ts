import type { CompanyFixture, FixtureEmployee } from "../company";
import { createRng } from "../company/rng";
import { toCsv } from "./csv";
import type { FixtureFile } from "./files";

export const ORG_ATTRIBUTES_HEADER = [
  "EEID",
  "Nombre",
  "Cuenta",
  "Proyecto",
  "DM",
  "Santex Lead",
  "Desde",
  "Hasta",
] as const;

const SHAPE = {
  small: { accounts: 3, leads: 2 },
  demo: { accounts: 8, leads: 3 },
} as const;

const fullName = (e: Pick<FixtureEmployee, "firstName" | "lastName">) =>
  `${e.firstName} ${e.lastName}`;

const addDays = (iso: string, days: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

type Account = {
  name: string;
  projects: string[];
  dm: string;
  lead: string;
  leadId: string;
};

/**
 * People's org attributes file (docs/org-attributes.md) for the synthetic
 * company, deterministic from its seed: a few accounts, each with two
 * projects, one DM (a manager of the company) and a Santex Lead (one of the
 * managers' managers). People work on their DM's account when their manager
 * is a DM, else on any account; about one in six moves to another account
 * (and project) at the start of a cycle, so the same EEID has two rows with a
 * `Hasta`. The DM and the Santex
 * Lead are written by name ("First Last"), as People type them.
 */
export function serializeOrgAttributes(company: CompanyFixture): FixtureFile[] {
  const rng = createRng(company.seed ^ 0x0a77);
  const shape = SHAPE[company.size];
  const byId = new Map(company.employees.map((e) => [e.id, e]));
  const managerIds = [
    ...new Set(
      company.employees.flatMap((e) => (e.managerId ? [e.managerId] : [])),
    ),
  ].sort();
  const dms = rng.shuffle(managerIds).slice(0, shape.accounts);
  const dmSet = new Set(dms);
  // Leads: whoever manages the managers (the DMs' own managers first).
  const upper = [
    ...new Set(
      managerIds.flatMap((id) => {
        const boss = byId.get(id)?.managerId;
        return boss ? [boss] : [];
      }),
    ),
  ].sort();
  const leads = (upper.length >= shape.leads ? upper : managerIds).slice(
    0,
    shape.leads,
  );
  const accounts: Account[] = dms.map((dmId, i) => {
    const letter = String.fromCharCode(65 + i);
    return {
      name: `Cuenta ${letter}`,
      projects: [`Proyecto ${letter}1`, `Proyecto ${letter}2`],
      dm: fullName(byId.get(dmId)!),
      lead: fullName(byId.get(leads[i % leads.length])!),
      leadId: leads[i % leads.length],
    };
  });

  // A rehire's later Bamboo ids wait in the identity queue (nobody links them
  // on their own): the file lists each person once, under the id that became
  // them, so importing it leaves nothing unmatched.
  const later = new Set(
    company.identity.persons.flatMap((p) => p.employeeIds.slice(1)),
  );
  const employees = company.employees
    .filter((e) => !later.has(e.id))
    .sort((a, b) => a.id.localeCompare(b.id, "en", { numeric: true }));
  const row = (
    e: FixtureEmployee,
    account: Account,
    project: string,
    from: string,
    to: string,
  ) => {
    // A DM is never their own DM: they answer to the next account's.
    const dm =
      account.dm === fullName(e)
        ? accounts[(accounts.indexOf(account) + 1) % accounts.length].dm
        : account.dm;
    // Nor their own Santex Lead.
    const lead =
      account.leadId === e.id
        ? accounts[(accounts.indexOf(account) + 1) % accounts.length].lead
        : account.lead;
    return [e.id, fullName(e), account.name, project, dm, lead, from, to];
  };
  const rows: string[][] = [];
  employees.forEach((e, i) => {
    const dmIndex = dms.indexOf(e.managerId ?? "");
    const home = dmSet.has(e.id)
      ? accounts[dms.indexOf(e.id)]
      : dmIndex >= 0
        ? accounts[dmIndex]
        : accounts[(i + rng.int(0, accounts.length - 1)) % accounts.length];
    const project = rng.pick(home.projects);
    const moves = !dmSet.has(e.id) && accounts.length > 1 && rng.chance(0.17);
    if (!moves) {
      rows.push(row(e, home, project, e.hireDate, ""));
      return;
    }
    const cycle = company.cycles[rng.int(1, company.cycles.length - 1)];
    const from = addDays(cycle.periodStart, 20);
    const next = accounts[(accounts.indexOf(home) + 1) % accounts.length];
    const nextProject = rng.pick(next.projects);
    // Somebody hired after that cycle started has nothing to move from: one
    // row from their hire date (the draws above are kept, so everyone else's
    // rows are the same as ever).
    if (from <= e.hireDate) {
      rows.push(row(e, home, project, e.hireDate, ""));
      return;
    }
    rows.push(row(e, home, project, e.hireDate, addDays(from, -1)));
    rows.push(row(e, next, nextProject, from, ""));
  });
  return [
    {
      path: "org-attributes.csv",
      content: toCsv(ORG_ATTRIBUTES_HEADER, rows),
    },
  ];
}
