export type FixtureSize = "small" | "demo";

export interface SizeConfig {
  /** Total Bamboo employee records (a rehire counts as a new record). */
  records: number;
  divisions: readonly string[];
  departments: readonly string[];
  /** Team leads (level 4). */
  managers: number;
  /** Team leads that leave (their reports get reassigned). */
  managerTerminations: number;
  /** Records with a termination date, team leads included. */
  terminations: number;
  /** Terminated people who come back with a new Bamboo id. */
  rehires: number;
  /** Of those, how many come back with a different work email. */
  rehireEmailChanges: number;
  /** Planned reorg manager changes (forced reassignments come on top). */
  managerChanges: number;
  /** People whose last name (and email) changes after some cycles. */
  renames: number;
  /** People whose name is typed wrong in the CSV reports. */
  misspellings: number;
  /** Report rows per cycle that match nobody in the HRIS. */
  outsidersPerCycle: number;
  /** page[limit] used to paginate list-employees. */
  pageLimit: number;
}

export const SIZE_CONFIG: Record<FixtureSize, SizeConfig> = {
  small: {
    records: 40,
    divisions: ["Tecnología", "Comercial", "Corporativo"],
    departments: ["Ingeniería", "Datos", "Ventas", "People", "Finanzas"],
    managers: 6,
    managerTerminations: 1,
    terminations: 10,
    rehires: 4,
    rehireEmailChanges: 1,
    managerChanges: 24,
    renames: 2,
    misspellings: 3,
    outsidersPerCycle: 1,
    pageLimit: 15,
  },
  demo: {
    records: 400,
    divisions: ["Tecnología", "Comercial", "Operaciones", "Corporativo"],
    departments: [
      "Ingeniería",
      "Datos",
      "Infraestructura",
      "Ventas",
      "Marketing",
      "Customer Success",
      "Soporte",
      "Operaciones",
      "Calidad",
      "People",
      "Finanzas",
      "Legales",
    ],
    managers: 40,
    managerTerminations: 3,
    terminations: 30,
    rehires: 8,
    rehireEmailChanges: 2,
    managerChanges: 55,
    renames: 6,
    misspellings: 12,
    outsidersPerCycle: 3,
    pageLimit: 100,
  },
};
