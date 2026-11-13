import { describe, expect, it } from "vitest";
import { generateCompany } from "./index";

const small = generateCompany({ size: "small", seed: 1001 });
const demo = generateCompany({ size: "demo", seed: 2002 });

describe("generateCompany size", () => {
  it("produces 40 Bamboo employee records for small and 400 for demo", () => {
    expect(small.employees).toHaveLength(40);
    expect(demo.employees).toHaveLength(400);
  });
});

describe("employee identity", () => {
  it.each([
    ["small", small],
    ["demo", demo],
  ])("gives every %s employee string ids, names and a work email", (_, c) => {
    for (const e of c.employees) {
      expect(e.id).toMatch(/^\d+$/);
      expect(e.employeeNumber).toMatch(/^\d{5}$/);
      expect(e.firstName.length).toBeGreaterThan(0);
      expect(e.lastName.length).toBeGreaterThan(0);
      expect(e.workEmail).toMatch(/^[a-z0-9.]+@meridian-andina\.example$/);
    }
    expect(new Set(c.employees.map((e) => e.id)).size).toBe(c.employees.length);
  });
});

function depthOf(
  c: typeof small,
  employeeId: string,
  seen = new Set<string>(),
): number {
  const byId = new Map(c.employees.map((e) => [e.id, e]));
  const manager = byId.get(employeeId)?.managerId ?? null;
  if (manager === null) return 1;
  if (seen.has(employeeId)) throw new Error("manager cycle");
  seen.add(employeeId);
  return 1 + depthOf(c, manager, seen);
}

describe("organisation", () => {
  it.each([
    ["small", small],
    ["demo", demo],
  ])("%s has exactly one employee without a manager: the CEO", (_, c) => {
    const roots = c.employees.filter((e) => e.managerId === null);
    expect(roots).toHaveLength(1);
    expect(roots[0].jobTitle).toBe("CEO");
  });

  it.each([
    ["small", small],
    ["demo", demo],
  ])("%s has five hierarchy levels", (_, c) => {
    const depths = new Set(c.employees.map((e) => depthOf(c, e.id)));
    expect([...depths].sort()).toEqual([1, 2, 3, 4, 5]);
  });

  it.each([
    ["small", small, { divisions: 3, departments: 5, locations: 4 }],
    ["demo", demo, { divisions: 4, departments: 12, locations: 5 }],
  ])("%s spans several divisions, departments and locations", (_, c, min) => {
    const distinct = (pick: (e: (typeof c.employees)[number]) => string) =>
      new Set(c.employees.map(pick)).size;
    expect(distinct((e) => e.division)).toBeGreaterThanOrEqual(min.divisions);
    expect(distinct((e) => e.department)).toBeGreaterThanOrEqual(
      min.departments,
    );
    expect(distinct((e) => e.location)).toBeGreaterThanOrEqual(min.locations);
  });

  it.each([
    ["small", small],
    ["demo", demo],
  ])("%s managers are real employees", (_, c) => {
    const ids = new Set(c.employees.map((e) => e.id));
    for (const e of c.employees) {
      if (e.managerId !== null) expect(ids.has(e.managerId)).toBe(true);
    }
  });
});

describe("terminations", () => {
  it.each([
    ["small", small],
    ["demo", demo],
  ])("%s has at least 10 terminated employees, flagged Inactive", (_, c) => {
    const terminated = c.employees.filter((e) => e.terminationDate !== null);
    expect(terminated.length).toBeGreaterThanOrEqual(10);
    for (const e of c.employees) {
      expect(e.status).toBe(e.terminationDate === null ? "Active" : "Inactive");
      if (e.terminationDate !== null) {
        expect(e.terminationDate > e.hireDate).toBe(true);
        expect(e.terminationDate <= "2026-11-01").toBe(true);
      }
    }
  });

  it.each([
    ["small", small],
    ["demo", demo],
  ])("%s keeps employmentStatus history from hire to termination", (_, c) => {
    for (const e of c.employees) {
      const rows = c.employmentHistory
        .filter((r) => r.employeeId === e.id)
        .sort((a, b) => a.date.localeCompare(b.date));
      expect(rows[0].date).toBe(e.hireDate);
      expect(rows[0].employmentStatus).not.toBe("Terminated");
      const last = rows[rows.length - 1];
      if (e.terminationDate === null) {
        expect(last.employmentStatus).not.toBe("Terminated");
      } else {
        expect(last.employmentStatus).toBe("Terminated");
        expect(last.date).toBe(e.terminationDate);
        expect(last.terminationTypeId).toMatch(/^\d+$/);
        expect(last.terminationReasonId).toMatch(/^\d+$/);
      }
    }
  });
});

function rehirePairs(c: typeof small) {
  const byNumber = new Map<string, typeof c.employees>();
  for (const e of c.employees) {
    byNumber.set(e.employeeNumber, [
      ...(byNumber.get(e.employeeNumber) ?? []),
      e,
    ]);
  }
  return [...byNumber.values()]
    .filter((group) => group.length > 1)
    .map((group) => {
      expect(group).toHaveLength(2);
      const [before, after] = [...group].sort((a, b) =>
        a.hireDate.localeCompare(b.hireDate),
      );
      return { before, after };
    });
}

describe("rehires", () => {
  it.each([
    ["small", small],
    ["demo", demo],
  ])(
    "%s has rehires: same legajo, new Bamboo id, back after leaving",
    (_, c) => {
      const pairs = rehirePairs(c);
      expect(pairs.length).toBeGreaterThanOrEqual(3);
      for (const { before, after } of pairs) {
        expect(after.id).not.toBe(before.id);
        expect(Number(after.id)).toBeGreaterThan(Number(before.id));
        expect(before.terminationDate).not.toBeNull();
        expect(after.hireDate > before.terminationDate!).toBe(true);
        expect(after.firstName).toBe(before.firstName);
        expect(after.lastName).toBe(before.lastName);
      }
    },
  );

  it.each([
    ["small", small],
    ["demo", demo],
  ])("%s has at least 3 rehires that keep the same work email", (_, c) => {
    const same = rehirePairs(c).filter(
      ({ before, after }) => before.workEmail === after.workEmail,
    );
    expect(same.length).toBeGreaterThanOrEqual(3);
  });

  it.each([
    ["small", small],
    ["demo", demo],
  ])("%s has a rehire that came back with a new work email", (_, c) => {
    const changed = rehirePairs(c).filter(
      ({ before, after }) => before.workEmail !== after.workEmail,
    );
    expect(changed.length).toBeGreaterThanOrEqual(1);
  });

  it.each([
    ["small", small],
    ["demo", demo],
  ])("%s never shares an email between different people", (_, c) => {
    const reusedEmail = new Set(
      rehirePairs(c)
        .filter(({ before, after }) => before.workEmail === after.workEmail)
        .map(({ after }) => after.id),
    );
    const emails = c.employees
      .filter((e) => !reusedEmail.has(e.id))
      .map((e) => e.workEmail);
    expect(new Set(emails).size).toBe(emails.length);
  });
});

function rowsOf(c: typeof small, employeeId: string) {
  return c.jobHistory
    .filter((r) => r.employeeId === employeeId)
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** Manager changes = consecutive jobInfo rows whose manager differs. */
function managerChanges(c: typeof small) {
  return c.employees.flatMap((e) => {
    const rows = rowsOf(c, e.id);
    return rows
      .slice(1)
      .flatMap((row, i) =>
        row.managerId !== rows[i].managerId
          ? [
              {
                employeeId: e.id,
                date: row.date,
                from: rows[i].managerId,
                to: row.managerId,
              },
            ]
          : [],
      );
  });
}

describe("jobInfo history", () => {
  it.each([
    ["small", small],
    ["demo", demo],
  ])(
    "%s rows are strictly dated from hire and end in the current state",
    (_, c) => {
      for (const e of c.employees) {
        const rows = rowsOf(c, e.id);
        expect(rows[0].date).toBe(e.hireDate);
        expect(new Set(rows.map((r) => r.date)).size).toBe(rows.length);
        const last = rows[rows.length - 1];
        expect(last).toMatchObject({
          department: e.department,
          division: e.division,
          location: e.location,
          jobTitle: e.jobTitle,
          managerId: e.managerId,
        });
        if (e.terminationDate !== null) {
          expect(last.date < e.terminationDate).toBe(true);
        }
      }
      expect(new Set(c.jobHistory.map((r) => r.id)).size).toBe(
        c.jobHistory.length,
      );
    },
  );

  it.each([
    ["small", small],
    ["demo", demo],
  ])("%s only assigns managers who are employed on that date", (_, c) => {
    const byId = new Map(c.employees.map((e) => [e.id, e]));
    for (const row of c.jobHistory) {
      if (row.managerId === null) continue;
      expect(row.managerId).not.toBe(row.employeeId);
      const manager = byId.get(row.managerId)!;
      expect(manager.hireDate <= row.date).toBe(true);
      expect(
        manager.terminationDate === null || row.date < manager.terminationDate,
      ).toBe(true);
    }
  });

  it.each([
    ["small", small],
    ["demo", demo],
  ])("%s has 20+ manager changes spread over the three cycle years", (_, c) => {
    const changes = managerChanges(c);
    const inYear = (year: number) =>
      changes.filter((m) => m.date.startsWith(String(year))).length;
    expect(
      changes.filter((m) => m.date >= "2023-01-01" && m.date <= "2025-12-31")
        .length,
    ).toBeGreaterThanOrEqual(20);
    for (const year of [2023, 2024, 2025]) {
      expect(inYear(year), `changes in ${year}`).toBeGreaterThanOrEqual(4);
    }
  });

  it.each([
    ["small", small],
    ["demo", demo],
  ])("%s reassigns the reports of managers who leave", (_, c) => {
    const leftManagers = c.employees.filter(
      (m) =>
        m.terminationDate !== null &&
        c.jobHistory.some((r) => r.managerId === m.id),
    );
    expect(leftManagers.length).toBeGreaterThanOrEqual(1);
    for (const m of leftManagers) {
      const stillReporting = c.employees.filter(
        (e) => e.status === "Active" && e.managerId === m.id,
      );
      expect(stillReporting).toEqual([]);
    }
  });

  it.each([
    ["small", small],
    ["demo", demo],
  ])("%s also has job changes that are not manager changes", (_, c) => {
    const promotions = c.employees.flatMap((e) => {
      const rows = rowsOf(c, e.id);
      return rows
        .slice(1)
        .filter((row, i) => row.managerId === rows[i].managerId);
    });
    expect(promotions.length).toBeGreaterThanOrEqual(2);
  });
});

describe("identity ground truth", () => {
  it.each([
    ["small", small],
    ["demo", demo],
  ])(
    "%s groups every Bamboo id under one person; rehires share a person",
    (_, c) => {
      const ids = c.identity.persons.flatMap((p) => p.employeeIds);
      expect(new Set(ids).size).toBe(c.employees.length);
      expect(ids.slice().sort()).toEqual(c.employees.map((e) => e.id).sort());
      const multi = c.identity.persons.filter((p) => p.employeeIds.length > 1);
      expect(multi.length).toBe(rehirePairs(c).length);
      for (const person of multi) {
        const numbers = person.employeeIds.map(
          (id) => c.employees.find((e) => e.id === id)!.employeeNumber,
        );
        expect(new Set(numbers).size).toBe(1);
      }
    },
  );

  it.each([
    ["small", small, 2],
    ["demo", demo, 6],
  ])(
    "%s has people renamed after earlier cycles, with a new email",
    (_, c, count) => {
      expect(c.identity.renames).toHaveLength(count);
      for (const r of c.identity.renames) {
        const e = c.employees.find((x) => x.id === r.employeeId)!;
        expect(e.status).toBe("Active");
        expect(e.lastName).not.toBe(r.previousLastName);
        expect(e.firstName).toBe(r.previousFirstName);
        expect(e.workEmail).not.toBe(r.previousWorkEmail);
        expect(r.renamedOn >= "2025-03-01" && r.renamedOn <= "2026-03-31").toBe(
          true,
        );
      }
    },
  );

  it.each([
    ["small", small],
    ["demo", demo],
  ])("%s has two different people with exactly the same name", (_, c) => {
    const names = new Map<string, string[]>();
    for (const e of c.employees) {
      const key = `${e.firstName} ${e.lastName}`;
      names.set(key, [...(names.get(key) ?? []), e.id]);
    }
    const personOf = new Map(
      c.identity.persons.flatMap((p) =>
        p.employeeIds.map((id) => [id, p] as const),
      ),
    );
    const clashes = [...names.values()].filter(
      (ids) => new Set(ids.map((id) => personOf.get(id))).size > 1,
    );
    expect(clashes).toHaveLength(1);
    expect(c.identity.duplicateNames).toHaveLength(1);
    expect(new Set(c.identity.duplicateNames[0].employeeIds)).toEqual(
      new Set(clashes[0]),
    );
  });
});

describe("headline counts hold for any seed", () => {
  it.each(
    [3, 4, 5, 6, 7, 8, 9, 10].flatMap((seed) => [
      ["small", seed] as const,
      ["demo", seed] as const,
    ]),
  )("%s with seed %i", (size, seed) => {
    const c = generateCompany({ size, seed });
    expect(c.employees).toHaveLength(size === "small" ? 40 : 400);
    expect(
      c.employees.filter((e) => e.terminationDate !== null).length,
    ).toBeGreaterThanOrEqual(10);
    expect(rehirePairs(c).length).toBeGreaterThanOrEqual(3);
    expect(
      managerChanges(c).filter(
        (m) => m.date >= "2023-01-01" && m.date <= "2025-12-31",
      ).length,
    ).toBeGreaterThanOrEqual(20);
    expect(c.employees.filter((e) => e.managerId === null)).toHaveLength(1);
    expect(c.identity.renames.length).toBe(size === "small" ? 2 : 6);
    expect(c.identity.duplicateNames).toHaveLength(1);
  });
});

describe("generateCompany determinism", () => {
  it("returns identical data for the same seed", () => {
    expect(generateCompany({ size: "small", seed: 1001 })).toEqual(small);
  });

  it("returns different data for a different seed", () => {
    const other = generateCompany({ size: "small", seed: 1002 });
    expect(other.employees).not.toEqual(small.employees);
    expect(other.employees).toHaveLength(small.employees.length);
  });
});
