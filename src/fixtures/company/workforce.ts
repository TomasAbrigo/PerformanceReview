import {
  DIVISIONS,
  LOCATIONS,
  NICKNAMES,
  SENIORITY,
  TERMINATION_COMMENTS,
  TERMINATION_TYPES,
} from "./catalog";
import type { DepartmentDef } from "./catalog";
import type { SizeConfig } from "./config";
import { addDays, dateBetween, daysBetween, maxDate, minDate } from "./dates";
import { fullName } from "./identity";
import type { IdentityPool, PersonName } from "./identity";
import type { Rng } from "./rng";
import type {
  FixtureEmployee,
  FixtureEmploymentRow,
  FixtureJobRow,
  IdentityGroundTruth,
} from "./types";

/** The fictional "today": everything in the fixtures happened before it. */
export const AS_OF = "2026-11-01";

type Level = 1 | 2 | 3 | 4 | 5;

interface Row {
  date: string;
  location: string;
  department: string;
  division: string;
  jobTitle: string;
  managerKey: number | null;
}

interface TerminationInfo {
  typeId: string;
  reasonId: string;
  comment: string | null;
}

interface WorkRecord {
  /** Index in the records list; only used while simulating. */
  key: number;
  /** Same for every record of one human (a rehire has a new `key`). */
  personKey: number;
  level: Level;
  name: PersonName;
  preferredName: string | null;
  workEmail: string;
  hireDate: string;
  terminationDate: string | null;
  termination: TerminationInfo | null;
  /** employmentStatus of the hire row. */
  employmentStatus: string;
  department: string;
  division: string;
  jobTitle: string;
  location: string;
  /** Fixed manager of levels 2-4 (ICs get theirs from whoever is active). */
  parentKey: number | null;
  rows: Row[];
}

export interface Workforce {
  employees: FixtureEmployee[];
  jobHistory: FixtureJobRow[];
  employmentHistory: FixtureEmploymentRow[];
  identity: IdentityGroundTruth;
}

interface DepartmentInSim extends DepartmentDef {
  division: string;
  weight: number;
}

function departmentsFor(config: SizeConfig, rng: Rng): DepartmentInSim[] {
  const result: DepartmentInSim[] = [];
  for (const division of DIVISIONS) {
    if (!config.divisions.includes(division.name)) continue;
    for (const department of division.departments) {
      if (!config.departments.includes(department.name)) continue;
      result.push({
        ...department,
        division: division.name,
        weight: rng.int(2, 8),
      });
    }
  }
  return result;
}

const IC_HIRE_YEARS: ReadonlyArray<readonly [number, number]> = [
  [2019, 5],
  [2020, 6],
  [2021, 10],
  [2022, 14],
  [2023, 16],
  [2024, 20],
  [2025, 18],
];

export function buildWorkforce(
  rng: Rng,
  identities: IdentityPool,
  config: SizeConfig,
): Workforce {
  const records: WorkRecord[] = [];
  const departments = departmentsFor(config, rng);
  const deptByName = new Map(departments.map((d) => [d.name, d]));

  const location = (): string => rng.weighted(LOCATIONS);
  const add = (
    fields: Omit<
      WorkRecord,
      | "key"
      | "rows"
      | "preferredName"
      | "workEmail"
      | "termination"
      | "employmentStatus"
      | "personKey"
    > & {
      name?: PersonName;
      employmentStatus?: string;
      /** Set for rehires: the person's earlier record. */
      rehireOf?: WorkRecord;
      /** Rehires may keep the old email (default) or get a new one. */
      keepEmail?: boolean;
    },
  ): WorkRecord => {
    const { rehireOf, keepEmail, ...own } = fields;
    const name = rehireOf?.name ?? fields.name ?? identities.newName();
    const nickname = NICKNAMES[name.firstName];
    const record: WorkRecord = {
      ...own,
      name,
      termination: null,
      employmentStatus: fields.employmentStatus ?? "Full-Time",
      key: records.length,
      personKey: rehireOf?.personKey ?? records.length,
      preferredName: rehireOf
        ? rehireOf.preferredName
        : nickname && rng.chance(0.5)
          ? nickname
          : null,
      workEmail:
        rehireOf && keepEmail !== false
          ? rehireOf.workEmail
          : identities.newEmail(name),
      rows: [],
    };
    records.push(record);
    return record;
  };

  // Levels 1-4: the management skeleton, hired early.
  const ceo = add({
    level: 1,
    hireDate: "2013-02-01",
    terminationDate: null,
    department: "Dirección General",
    division: "Corporativo",
    jobTitle: "CEO",
    location: "Buenos Aires",
    parentKey: null,
  });
  const divisionHeads = new Map<string, WorkRecord>();
  for (const division of config.divisions) {
    divisionHeads.set(
      division,
      add({
        level: 2,
        hireDate: dateBetween("2014-01-01", "2016-12-31", rng.int),
        terminationDate: null,
        department: `Dirección de ${division}`,
        division,
        jobTitle: `VP de ${division}`,
        location: "Buenos Aires",
        parentKey: ceo.key,
      }),
    );
  }
  const deptHeads = new Map<string, WorkRecord>();
  for (const department of departments) {
    const boss = divisionHeads.get(department.division)!;
    deptHeads.set(
      department.name,
      add({
        level: 3,
        hireDate: dateBetween(
          maxDate(addDays(boss.hireDate, 60), "2015-06-01"),
          "2018-06-30",
          rng.int,
        ),
        terminationDate: null,
        department: department.name,
        division: department.division,
        jobTitle: `Gerente de ${department.name}`,
        location: location(),
        parentKey: boss.key,
      }),
    );
  }
  const leadsPerDept = new Map(departments.map((d) => [d.name, 0]));
  for (let i = 0; i < config.managers; i++) {
    const department =
      i < departments.length
        ? departments[i]
        : rng.weighted(departments.map((d) => [d, d.weight] as const));
    const head = deptHeads.get(department.name)!;
    const isFirstOfDept = leadsPerDept.get(department.name) === 0;
    leadsPerDept.set(department.name, leadsPerDept.get(department.name)! + 1);
    add({
      level: 4,
      hireDate: isFirstOfDept
        ? dateBetween(
            maxDate(addDays(head.hireDate, 60), "2017-01-01"),
            "2018-12-31",
            rng.int,
          )
        : dateBetween(
            maxDate(addDays(head.hireDate, 60), "2019-01-01"),
            "2022-12-31",
            rng.int,
          ),
      terminationDate: null,
      department: department.name,
      division: department.division,
      jobTitle: `Líder de ${department.name}`,
      location: location(),
      parentKey: head.key,
    });
  }

  // Level 5: individual contributors.
  const icCount = config.records - config.rehires - records.length;
  for (let i = 0; i < icCount; i++) {
    const department = rng.weighted(
      departments.map((d) => [d, d.weight] as const),
    );
    const year = rng.weighted(IC_HIRE_YEARS);
    const seniority = rng.weighted([
      [SENIORITY[0], 4],
      [SENIORITY[1], 4],
      [SENIORITY[2], 2],
    ] as const);
    add({
      level: 5,
      employmentStatus: rng.weighted([
        ["Full-Time", 88],
        ["Part-Time", 8],
        ["Contractor", 4],
      ] as const),
      hireDate: dateBetween(
        `${year}-01-01`,
        year === 2025 ? "2025-08-31" : `${year}-12-31`,
        rng.int,
      ),
      terminationDate: null,
      department: department.name,
      division: department.division,
      jobTitle: `${rng.pick(department.titles)} ${seniority}`,
      location: location(),
      parentKey: null,
    });
  }

  // Terminations: some team leads (their reports get reassigned later) and ICs.
  const terminate = (r: WorkRecord, date: string): void => {
    const type = rng.pick(TERMINATION_TYPES);
    r.terminationDate = date;
    r.termination = {
      typeId: type.id,
      reasonId: rng.pick(type.reasons).id,
      comment: rng.chance(0.5) ? rng.pick(TERMINATION_COMMENTS) : null,
    };
  };
  const leadsPerDeptNow = new Map<string, number>();
  for (const r of records) {
    if (r.level === 4) {
      leadsPerDeptNow.set(
        r.department,
        (leadsPerDeptNow.get(r.department) ?? 0) + 1,
      );
    }
  }
  const replaceableLeads = rng.shuffle(
    records.filter(
      (r) => r.level === 4 && (leadsPerDeptNow.get(r.department) ?? 0) > 1,
    ),
  );
  for (const lead of replaceableLeads.slice(0, config.managerTerminations)) {
    terminate(lead, dateBetween("2024-02-01", "2025-09-30", rng.int));
  }
  const leavingICs = rng
    .shuffle(records.filter((r) => r.level === 5 && r.hireDate <= "2025-06-30"))
    .slice(0, config.terminations - config.managerTerminations);
  leavingICs.forEach((ic) => {
    terminate(
      ic,
      dateBetween(
        maxDate(addDays(ic.hireDate, 180), "2023-03-01"),
        "2026-06-30",
        rng.int,
      ),
    );
  });

  // Rehires: back with the same legajo and a NEW Bamboo record.
  leavingICs.slice(0, config.rehires).forEach((previous, index) => {
    add({
      level: 5,
      rehireOf: previous,
      keepEmail: index < config.rehires - config.rehireEmailChanges,
      hireDate: dateBetween(
        addDays(previous.terminationDate!, 90),
        minDate(addDays(previous.terminationDate!, 400), "2026-09-30"),
        rng.int,
      ),
      terminationDate: null,
      department: previous.department,
      division: previous.division,
      jobTitle: previous.jobTitle,
      location: previous.location,
      parentKey: null,
    });
  });

  // Initial job row: who manages them on their first day.
  const isActiveOn = (r: WorkRecord, date: string): boolean =>
    r.hireDate <= date &&
    (r.terminationDate === null || date < r.terminationDate);
  for (const r of records) {
    let managerKey = r.parentKey;
    if (r.level === 5) {
      const leads = records.filter(
        (m) =>
          m.level === 4 &&
          m.department === r.department &&
          isActiveOn(m, r.hireDate),
      );
      managerKey =
        leads.length > 0
          ? rng.pick(leads).key
          : deptByName.has(r.department)
            ? deptHeads.get(r.department)!.key
            : null;
    }
    r.rows.push({
      date: r.hireDate,
      location: r.location,
      department: r.department,
      division: r.division,
      jobTitle: r.jobTitle,
      managerKey,
    });
  }

  // Timeline: reorgs, managers leaving, promotions and relocations.
  type EventKind = "leave" | "change" | "promote" | "relocate";
  interface TimelineEvent {
    date: string;
    kind: EventKind;
    record?: WorkRecord;
  }
  const events: TimelineEvent[] = [];
  const reorgsIn2026 = Math.round(config.managerChanges * 0.12);
  for (let i = 0; i < config.managerChanges; i++) {
    const inCycleYears = i < config.managerChanges - reorgsIn2026;
    const year = inCycleYears ? 2023 + (i % 3) : 2026;
    events.push({
      kind: "change",
      date: dateBetween(
        `${year}-01-15`,
        year === 2026 ? "2026-09-15" : `${year}-12-15`,
        rng.int,
      ),
    });
  }
  for (const r of records) {
    if (r.level === 4 && r.terminationDate !== null) {
      events.push({ kind: "leave", date: r.terminationDate, record: r });
    }
    if (r.level !== 5) continue;
    const end = r.terminationDate ?? AS_OF;
    if (rng.chance(0.3) && addDays(r.hireDate, 540) < addDays(end, -30)) {
      events.push({
        kind: "promote",
        record: r,
        date: dateBetween(addDays(r.hireDate, 540), addDays(end, -30), rng.int),
      });
    }
    if (rng.chance(0.06) && addDays(r.hireDate, 200) < addDays(end, -30)) {
      events.push({
        kind: "relocate",
        record: r,
        date: dateBetween(addDays(r.hireDate, 200), addDays(end, -30), rng.int),
      });
    }
  }
  const order: Record<EventKind, number> = {
    leave: 0,
    change: 1,
    promote: 2,
    relocate: 3,
  };
  events.sort((a, b) =>
    a.date !== b.date
      ? a.date < b.date
        ? -1
        : 1
      : order[a.kind] - order[b.kind],
  );

  const current = (r: WorkRecord): Row => r.rows[r.rows.length - 1];
  const pushRow = (r: WorkRecord, date: string, patch: Partial<Row>): void => {
    const last = current(r);
    if (last.date === date) Object.assign(last, patch);
    else r.rows.push({ ...last, ...patch, date });
  };
  const activeLeads = (date: string): WorkRecord[] =>
    records.filter((r) => r.level === 4 && isActiveOn(r, date));

  for (const event of events) {
    const { date } = event;
    if (event.kind === "leave") {
      const lead = event.record!;
      const others = activeLeads(date).filter(
        (m) => m.department === lead.department,
      );
      const successors =
        others.length > 0 ? others : [deptHeads.get(lead.department)!];
      for (const report of records) {
        if (
          report.level === 5 &&
          isActiveOn(report, date) &&
          current(report).managerKey === lead.key
        ) {
          pushRow(report, date, { managerKey: rng.pick(successors).key });
        }
      }
    } else if (event.kind === "change") {
      const eligible = records.filter(
        (r) =>
          r.level === 5 &&
          isActiveOn(r, date) &&
          daysBetween(r.hireDate, date) >= 90 &&
          daysBetween(current(r).date, date) >= 60,
      );
      if (eligible.length === 0) continue;
      const actor = rng.pick(eligible);
      const now = current(actor);
      const leads = activeLeads(date).filter((m) => m.key !== now.managerKey);
      const groups = [
        [leads.filter((m) => m.department === now.department), 60],
        [
          leads.filter(
            (m) =>
              m.department !== now.department && m.division === now.division,
          ),
          30,
        ],
        [leads.filter((m) => m.division !== now.division), 10],
      ] as const;
      const usable = groups.filter(([group]) => group.length > 0);
      if (usable.length === 0) continue;
      const newManager = rng.pick(rng.weighted(usable));
      const transferred = newManager.department !== now.department;
      pushRow(actor, date, {
        managerKey: newManager.key,
        department: newManager.department,
        division: newManager.division,
        jobTitle: transferred
          ? retitle(now.jobTitle, deptByName.get(newManager.department)!, rng)
          : now.jobTitle,
      });
    } else if (event.kind === "promote") {
      const parts = current(event.record!).jobTitle.split(" ");
      const level = SENIORITY.indexOf(
        parts.pop() as (typeof SENIORITY)[number],
      );
      if (level >= 0 && level < SENIORITY.length - 1) {
        pushRow(event.record!, date, {
          jobTitle: `${parts.join(" ")} ${SENIORITY[level + 1]}`,
        });
      }
    } else {
      const now = current(event.record!);
      const options = LOCATIONS.map(([name]) => name).filter(
        (name) => name !== now.location,
      );
      pushRow(event.record!, date, { location: rng.pick(options) });
    }
  }

  // Identity noise: renames (new last name + email) and one pair of namesakes.
  const recordsPerPerson = new Map<number, number>();
  for (const r of records) {
    recordsPerPerson.set(
      r.personKey,
      (recordsPerPerson.get(r.personKey) ?? 0) + 1,
    );
  }
  const stableICs = (hiredBy: string): WorkRecord[] =>
    rng.shuffle(
      records.filter(
        (r) =>
          r.level === 5 &&
          r.terminationDate === null &&
          r.hireDate <= hiredBy &&
          recordsPerPerson.get(r.personKey) === 1,
      ),
    );
  // Namesakes first (they must appear in the early cycles), then renames.
  let namesakes: WorkRecord[] = [];
  for (const hiredBy of ["2023-06-30", "2024-06-30", "2025-08-31"]) {
    namesakes = stableICs(hiredBy);
    if (namesakes.length >= 2) break;
  }
  const original = namesakes[0];
  const clone =
    namesakes.find((r) => r.department !== original.department) ?? namesakes[1];
  clone.name = { ...original.name };
  clone.workEmail = identities.newEmail(clone.name);

  const renames: RenameInSim[] = [];
  const renameCandidates = stableICs("2024-12-31").filter(
    (r) => r !== original && r !== clone,
  );
  for (const r of renameCandidates.slice(0, config.renames)) {
    renames.push({
      record: r,
      previousName: r.name,
      previousWorkEmail: r.workEmail,
      renamedOn: dateBetween("2025-03-01", "2026-03-31", rng.int),
    });
    r.name = {
      firstName: r.name.firstName,
      lastName: identities.newLastName(r.name.firstName),
    };
    r.workEmail = identities.newEmail(r.name);
  }

  return finalize(records, identities, renames, [original, clone]);
}

/** Same seniority, base title from the new department. */
function retitle(
  jobTitle: string,
  department: DepartmentDef,
  rng: Rng,
): string {
  const seniority = jobTitle.split(" ").pop()!;
  return `${rng.pick(department.titles)} ${seniority}`;
}

interface RenameInSim {
  record: WorkRecord;
  previousName: PersonName;
  previousWorkEmail: string;
  renamedOn: string;
}

function finalize(
  records: WorkRecord[],
  identities: IdentityPool,
  renames: RenameInSim[],
  namesakes: [WorkRecord, WorkRecord],
): Workforce {
  const ordered = [...records].sort((a, b) =>
    a.hireDate < b.hireDate ? -1 : a.hireDate > b.hireDate ? 1 : a.key - b.key,
  );
  const idByKey = new Map<number, string>();
  ordered.forEach((r, index) => idByKey.set(r.key, String(11 + index * 2)));

  const employeeNumbers = new Map<number, string>();
  const employees: FixtureEmployee[] = ordered.map((r) => {
    if (!employeeNumbers.has(r.personKey)) {
      employeeNumbers.set(r.personKey, identities.newEmployeeNumber());
    }
    const current = r.rows[r.rows.length - 1];
    return {
      id: idByKey.get(r.key)!,
      employeeNumber: employeeNumbers.get(r.personKey)!,
      firstName: r.name.firstName,
      lastName: r.name.lastName,
      preferredName: r.preferredName,
      workEmail: r.workEmail,
      hireDate: r.hireDate,
      terminationDate: r.terminationDate,
      status: r.terminationDate === null ? "Active" : "Inactive",
      department: current.department,
      division: current.division,
      location: current.location,
      jobTitle: current.jobTitle,
      managerId:
        current.managerKey === null ? null : idByKey.get(current.managerKey)!,
    };
  });

  const jobHistory: FixtureJobRow[] = ordered
    .flatMap((r) =>
      r.rows.map((row) => ({
        id: "",
        employeeId: idByKey.get(r.key)!,
        date: row.date,
        location: row.location,
        department: row.department,
        division: row.division,
        jobTitle: row.jobTitle,
        managerId:
          row.managerKey === null ? null : idByKey.get(row.managerKey)!,
      })),
    )
    .sort((a, b) =>
      a.date < b.date
        ? -1
        : a.date > b.date
          ? 1
          : Number(a.employeeId) - Number(b.employeeId),
    )
    .map((row, index) => ({ ...row, id: String(1001 + index) }));

  const employmentHistory: FixtureEmploymentRow[] = ordered
    .flatMap((r) => {
      const employeeId = idByKey.get(r.key)!;
      const rows: FixtureEmploymentRow[] = [
        {
          id: "",
          employeeId,
          date: r.hireDate,
          employmentStatus: r.employmentStatus,
          comment: null,
          terminationTypeId: null,
          terminationReasonId: null,
        },
      ];
      if (r.terminationDate !== null && r.termination !== null) {
        rows.push({
          id: "",
          employeeId,
          date: r.terminationDate,
          employmentStatus: "Terminated",
          comment: r.termination.comment,
          terminationTypeId: r.termination.typeId,
          terminationReasonId: r.termination.reasonId,
        });
      }
      return rows;
    })
    .sort((a, b) =>
      a.date < b.date
        ? -1
        : a.date > b.date
          ? 1
          : Number(a.employeeId) - Number(b.employeeId),
    )
    .map((row, index) => ({ ...row, id: String(5001 + index) }));

  const idsByPerson = new Map<number, string[]>();
  for (const r of ordered) {
    idsByPerson.set(r.personKey, [
      ...(idsByPerson.get(r.personKey) ?? []),
      idByKey.get(r.key)!,
    ]);
  }
  const identity: IdentityGroundTruth = {
    persons: [...idsByPerson.values()].map((employeeIds) => ({ employeeIds })),
    renames: renames.map((r) => ({
      employeeId: idByKey.get(r.record.key)!,
      previousFirstName: r.previousName.firstName,
      previousLastName: r.previousName.lastName,
      previousWorkEmail: r.previousWorkEmail,
      renamedOn: r.renamedOn,
    })),
    duplicateNames: [
      {
        name: fullName(namesakes[0].name),
        employeeIds: namesakes.map((r) => idByKey.get(r.key)!),
      },
    ],
  };

  return { employees, jobHistory, employmentHistory, identity };
}
