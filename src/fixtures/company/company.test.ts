import { describe, expect, it } from "vitest";
import { addDays } from "./dates";
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

describe("review cycles", () => {
  it.each([
    ["small", small],
    ["demo", demo],
  ])("%s has three consecutive historical cycles with ordered windows", (_, c) => {
    expect(c.cycles).toHaveLength(3);
    c.cycles.forEach((cycle, i) => {
      expect(cycle.name.length).toBeGreaterThan(0);
      const dates = [
        cycle.periodStart,
        cycle.feedbackOpen,
        cycle.feedbackDue,
        cycle.assessmentOpen,
        cycle.assessmentDue,
        cycle.periodEnd,
      ];
      expect([...dates].sort()).toEqual(dates);
      expect(cycle.periodEnd < c.asOf).toBe(true);
      if (i > 0) expect(c.cycles[i - 1].periodEnd < cycle.periodStart).toBe(true);
    });
  });
});

function managerAsOf(c: typeof small, employeeId: string, date: string) {
  const rows = rowsOf(c, employeeId).filter((r) => r.date <= date);
  return rows[rows.length - 1].managerId;
}

describe("assessments", () => {
  it.each([
    ["small", small],
    ["demo", demo],
  ])("%s has one assessment per participant in each of the 3 cycles", (_, c) => {
    c.cycles.forEach((cycle, index) => {
      const rows = c.assessments.filter(
        (a) => a.cycle === index && a.employeeId !== null,
      );
      const expected = c.employees.filter(
        (e) =>
          e.hireDate <= addDays(cycle.assessmentOpen, -60) &&
          (e.terminationDate === null || e.terminationDate > cycle.assessmentDue),
      );
      expect(rows.map((a) => a.employeeId).sort()).toEqual(
        expected.map((e) => e.id).sort(),
      );
    });
  });

  it.each([
    ["small", small],
    ["demo", demo],
  ])("%s records the manager at the window close (the CEO has none)", (_, c) => {
    for (const a of c.assessments.filter((x) => x.employeeId !== null)) {
      const close = c.cycles[a.cycle].assessmentDue;
      expect(a.managerIdAtReview).toBe(managerAsOf(c, a.employeeId!, close));
    }
    const ceo = c.employees.find((e) => e.managerId === null)!;
    const ceoRows = c.assessments.filter((a) => a.employeeId === ceo.id);
    expect(ceoRows).toHaveLength(3);
    expect(ceoRows.every((a) => a.managerIdAtReview === null)).toBe(true);
    expect(ceoRows.every((a) => a.selfStatus === "Not Started" && a.managerStatus === "Not Started")).toBe(true);
  });

  it.each([
    ["small", small],
    ["demo", demo],
  ])("%s has assessments whose reviewer is no longer the current manager", (_, c) => {
    const byId = new Map(c.employees.map((e) => [e.id, e]));
    const stale = c.assessments.filter(
      (a) =>
        a.employeeId !== null &&
        a.managerIdAtReview !== null &&
        a.managerIdAtReview !== byId.get(a.employeeId)!.managerId,
    );
    expect(stale.length).toBeGreaterThanOrEqual(3);
  });

  it.each([
    ["small", small],
    ["demo", demo],
  ])("%s mixes complete, in-progress and not-started assessments", (_, c) => {
    const done = c.assessments.filter(
      (a) => a.selfStatus === "Submitted" && a.managerStatus === "Submitted",
    );
    const started = c.assessments.filter(
      (a) => a.selfStatus === "Not Started" && a.managerStatus === "Not Started",
    );
    expect(done.length).toBeGreaterThan(c.assessments.length / 2);
    expect(started.length).toBeGreaterThanOrEqual(2);
    expect(done.length + started.length).toBeLessThan(c.assessments.length);
  });

  it.each([
    ["small", small],
    ["demo", demo],
  ])("%s submissions fall inside the window with valid letter-coded answers", (_, c) => {
    for (const a of c.assessments) {
      const cycle = c.cycles[a.cycle];
      for (const [status, on, answers, q1Letters] of [
        [a.selfStatus, a.selfSubmittedOn, a.selfAnswers, "ABCD"],
        [a.managerStatus, a.managerSubmittedOn, a.managerAnswers, "ABCDE"],
      ] as const) {
        if (status !== "Submitted") {
          expect(on).toBeNull();
          expect(answers).toBeNull();
          continue;
        }
        expect(on! >= cycle.assessmentOpen && on! <= cycle.assessmentDue).toBe(true);
        expect(q1Letters).toContain(answers!.q1);
        expect("ABCDE").toContain(answers!.q2);
        expect(answers!.q3.length).toBeGreaterThan(0);
        expect(answers!.q4.length).toBeGreaterThan(0);
        for (const rating of [answers!.custom1, answers!.custom2]) {
          expect(Number.isInteger(rating) && rating >= 1 && rating <= 5).toBe(true);
        }
      }
      if (a.managerSubmittedOn && a.selfSubmittedOn) {
        expect(a.managerSubmittedOn >= a.selfSubmittedOn).toBe(true);
      }
    }
  });
});

describe("peer feedback requests", () => {
  it.each([
    ["small", small],
    ["demo", demo],
  ])("%s asks 2-4 colleagues per person per cycle, never the CEO or oneself", (_, c) => {
    const byId = new Map(c.employees.map((e) => [e.id, e]));
    const ceo = c.employees.find((e) => e.managerId === null)!;
    c.cycles.forEach((cycle, index) => {
      const requests = c.feedback.filter((f) => f.cycle === index && f.reviewerId !== null);
      const perEmployee = new Map<string, number>();
      for (const f of requests) {
        perEmployee.set(f.employeeId, (perEmployee.get(f.employeeId) ?? 0) + 1);
        expect(f.employeeId).not.toBe(ceo.id);
        expect(f.reviewerId).not.toBe(f.employeeId);
        expect(f.dueDate).toBe(cycle.feedbackDue);
        const reviewer = byId.get(f.reviewerId!)!;
        expect(reviewer.hireDate < cycle.feedbackOpen).toBe(true);
        expect(
          reviewer.terminationDate === null || reviewer.terminationDate > cycle.feedbackDue,
        ).toBe(true);
        if (f.completedOn !== null) {
          expect(f.completedOn >= cycle.feedbackOpen && f.completedOn <= cycle.feedbackDue).toBe(true);
        }
      }
      expect(perEmployee.size).toBeGreaterThan(0);
      for (const count of perEmployee.values()) {
        expect(count >= 2 && count <= 4).toBe(true);
      }
    });
  });

  it.each([
    ["small", small],
    ["demo", demo],
  ])("%s has requests that were completed and requests left past due", (_, c) => {
    expect(c.feedback.some((f) => f.completedOn !== null)).toBe(true);
    expect(c.feedback.some((f) => f.completedOn === null)).toBe(true);
  });
});

describe("goals", () => {
  it.each([
    ["small", small],
    ["demo", demo],
  ])("%s goals have unique string ids and stay inside the owner's employment", (_, c) => {
    const byId = new Map(c.employees.map((e) => [e.id, e]));
    expect(new Set(c.goals.map((g) => g.id)).size).toBe(c.goals.length);
    for (const g of c.goals) {
      expect(g.id).toMatch(/^\d+$/);
      const owner = byId.get(g.employeeId)!;
      expect(owner, `owner of goal ${g.id}`).toBeDefined();
      const lastDay = owner.terminationDate ?? c.asOf;
      expect(g.lastChangedDateTime.slice(0, 10) >= owner.hireDate).toBe(true);
      expect(g.lastChangedDateTime.slice(0, 10) <= lastDay).toBe(true);
      expect(g.dueDate >= owner.hireDate).toBe(true);
      for (const shared of g.sharedWithEmployeeIds) {
        expect(byId.has(shared)).toBe(true);
      }
    }
  });

  it.each([
    ["small", small],
    ["demo", demo],
  ])("%s goal status, progress and completion date agree", (_, c) => {
    expect(new Set(c.goals.map((g) => g.status))).toEqual(
      new Set(["in_progress", "completed", "closed"]),
    );
    for (const g of c.goals) {
      expect(g.percentComplete >= 0 && g.percentComplete <= 100).toBe(true);
      if (g.status === "completed") {
        expect(g.percentComplete).toBe(100);
        expect(g.completionDate).not.toBeNull();
      } else {
        expect(g.completionDate).toBeNull();
      }
      if (g.status === "in_progress") expect(g.percentComplete).toBeLessThan(100);
    }
  });

  it.each([
    ["small", small],
    ["demo", demo],
  ])("%s milestone goals derive progress from their milestones", (_, c) => {
    const withMilestones = c.goals.filter((g) => g.milestones !== null);
    expect(withMilestones.length).toBeGreaterThan(0);
    expect(c.goals.some((g) => g.milestones === null)).toBe(true);
    const milestoneIds = withMilestones.flatMap((g) => g.milestones!.map((m) => m.id));
    expect(new Set(milestoneIds).size).toBe(milestoneIds.length);
    for (const g of withMilestones) {
      const done = g.milestones!.filter((m) => m.completedDateTime !== null).length;
      expect(g.percentComplete).toBe(Math.round((100 * done) / g.milestones!.length));
      for (const m of g.milestones!) {
        expect(m.employeeGoalId).toBe(Number(g.id));
        expect(m.currentValue === m.endValue).toBe(m.completedDateTime !== null);
      }
    }
  });

  it.each([
    ["small", small],
    ["demo", demo],
  ])("%s has goals due in every cycle year and employees without goals", (_, c) => {
    for (const year of [2023, 2024, 2025]) {
      expect(c.goals.some((g) => g.dueDate.startsWith(String(year)))).toBe(true);
    }
    const owners = new Set(c.goals.map((g) => g.employeeId));
    expect(c.employees.some((e) => e.status === "Active" && !owners.has(e.id))).toBe(true);
    expect(c.goals.some((g) => g.commentCount > 0)).toBe(true);
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
