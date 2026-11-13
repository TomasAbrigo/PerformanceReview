import { addDays, dateBetween, maxDate, minDate } from "./dates";
import { groupJobRows, rowOnDate } from "./job-history";
import type { Rng } from "./rng";
import type {
  FixtureEmployee,
  FixtureGoal,
  FixtureJobRow,
  FixtureMilestone,
  GoalStatus,
} from "./types";

const GOAL_TITLES = [
  "Reducir el tiempo de primera respuesta un 20%",
  "Completar la certificación del área",
  "Lanzar el nuevo flujo de onboarding",
  "Migrar los reportes al nuevo tablero",
  "Mejorar el NPS interno del equipo",
  "Documentar los procesos críticos",
  "Cerrar el plan de capacitación anual",
  "Automatizar la conciliación mensual",
  "Aumentar la cobertura de pruebas al 80%",
  "Reducir los incidentes recurrentes a la mitad",
  "Mentorear a dos personas nuevas",
  "Entregar el proyecto Norte sin desvíos",
  "Renovar las cuentas clave del trimestre",
  "Implementar el calendario editorial",
] as const;

const GOAL_DESCRIPTIONS = [
  "Alineado con el plan del área para el año.",
  "Pedido por el equipo directivo en la planificación.",
  "Sirve de base para el próximo ciclo de evaluación.",
  "Meta compartida con otra área; coordinar avances mensuales.",
] as const;

const GOAL_COMMENTS = [
  "Buen avance este mes.",
  "Quedamos en revisar el alcance la semana próxima.",
  "Hay un bloqueo con otra área; lo escalo.",
  "Cerrado con el equipo, gracias por el apoyo.",
  "Lo muevo de fecha por cambio de prioridades.",
] as const;

export const GOAL_YEARS = [2023, 2024, 2025, 2026] as const;

interface Counters {
  goal: number;
  milestone: number;
}

/** Latest of several UTC timestamps (same fixed-width format, so string order works). */
function latest(stamps: ReadonlyArray<string | null>): string {
  return stamps.reduce<string>((a, b) => (b !== null && b > a ? b : a), "");
}

function dateTime(date: string, rng: Rng): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date}T${pad(rng.int(8, 19))}:${pad(rng.int(0, 59))}:${pad(rng.int(0, 59))}Z`;
}

export function buildGoals(
  rng: Rng,
  input: {
    employees: FixtureEmployee[];
    jobHistory: FixtureJobRow[];
    asOf: string;
  },
): FixtureGoal[] {
  const rowsByEmployee = groupJobRows(input.jobHistory);
  const counters: Counters = { goal: 5000, milestone: 700 };
  const goals: FixtureGoal[] = [];

  // A few active people never set goals ("No Goals Set" in Bamboo's report).
  const active = input.employees.filter((e) => e.status === "Active");
  const noGoals = new Set(
    rng
      .shuffle(active)
      .slice(0, Math.max(2, Math.round(active.length * 0.08)))
      .map((e) => e.id),
  );

  for (const employee of input.employees) {
    if (noGoals.has(employee.id)) continue;
    const lastDay = minDate(employee.terminationDate ?? input.asOf, input.asOf);
    for (const year of GOAL_YEARS) {
      if (employee.hireDate > `${year}-09-30`) continue;
      if (
        employee.terminationDate !== null &&
        employee.terminationDate < `${year}-03-01`
      ) {
        continue;
      }
      const count = rng.weighted([
        [0, 25],
        [1, 35],
        [2, 30],
        [3, 10],
      ] as const);
      for (let k = 0; k < count; k++) {
        const dueLow = maxDate(addDays(employee.hireDate, 60), `${year}-02-01`);
        const dueHigh = year === 2026 ? "2027-03-31" : `${year}-12-31`;
        if (dueLow > dueHigh) continue;
        const dueDate = dateBetween(dueLow, dueHigh, rng.int);
        const created = maxDate(
          employee.hireDate,
          addDays(dueDate, -rng.int(60, 240)),
        );
        if (created >= lastDay) continue;

        let status: GoalStatus;
        if (employee.terminationDate !== null && dueDate > lastDay) {
          status = "closed";
        } else if (dueDate < input.asOf) {
          status = rng.weighted([
            ["completed", 58],
            ["closed", 10],
            ["in_progress", 32],
          ] as const);
        } else {
          status = rng.weighted([
            ["in_progress", 90],
            ["completed", 7],
            ["closed", 3],
          ] as const);
        }

        let completionDate: string | null = null;
        let changedOn = dateBetween(created, lastDay, rng.int);
        if (status === "completed") {
          const low = minDate(addDays(created, 7), lastDay);
          const high = maxDate(low, minDate(addDays(dueDate, 20), lastDay));
          completionDate = dateBetween(low, high, rng.int);
          changedOn = completionDate;
        }

        counters.goal += rng.int(1, 3);
        const id = String(counters.goal);
        const milestones = rng.chance(0.3)
          ? buildMilestones(rng, counters, {
              goalId: id,
              ownerId: employee.id,
              status,
              created,
              changedOn,
            })
          : null;
        const percentComplete =
          milestones !== null
            ? Math.round(
                (100 *
                  milestones.filter((m) => m.completedDateTime !== null)
                    .length) /
                  milestones.length,
              )
            : status === "completed"
              ? 100
              : status === "closed"
                ? rng.int(0, 14) * 5
                : rng.int(0, 18) * 5;
        const manager =
          rowOnDate(rowsByEmployee, employee.id, created)?.managerId ?? null;
        const comments = rng.chance(0.4) ? rng.int(1, 4) : 0;
        goals.push({
          id,
          employeeId: employee.id,
          title: rng.pick(GOAL_TITLES),
          description: rng.pick(GOAL_DESCRIPTIONS),
          percentComplete,
          alignsWithOptionId: rng.chance(0.3) ? rng.int(9001, 9004) : null,
          sharedWithEmployeeIds:
            manager !== null && rng.chance(0.2) ? [manager] : [],
          dueDate,
          completionDate,
          lastChangedDateTime: latest([
            dateTime(changedOn, rng),
            ...(milestones ?? []).flatMap((m) => [
              m.completedDateTime,
              m.lastUpdateDateTime,
            ]),
          ]),
          status,
          milestones,
          commentCount: comments,
          lastComment: comments > 0 ? rng.pick(GOAL_COMMENTS) : null,
        });
      }
    }
  }
  return goals;
}

function buildMilestones(
  rng: Rng,
  counters: Counters,
  goal: {
    goalId: string;
    ownerId: string;
    status: GoalStatus;
    created: string;
    changedOn: string;
  },
): FixtureMilestone[] {
  const total = rng.int(2, 4);
  const done = goal.status === "completed" ? total : rng.int(0, total - 1);
  return Array.from({ length: total }, (_, index) => {
    const completed = index < done;
    const completedOn = completed
      ? dateBetween(goal.created, goal.changedOn, rng.int)
      : null;
    const completedAt =
      completedOn === null ? null : dateTime(completedOn, rng);
    return {
      id: ++counters.milestone,
      employeeGoalId: Number(goal.goalId),
      title: `Hito ${index + 1}`,
      startValue: 0,
      endValue: 1,
      currentValue: completed ? 1 : 0,
      completedDateTime: completedAt,
      lastUpdateDateTime: completedAt ?? dateTime(goal.created, rng),
      lastUpdateUserId: Number(goal.ownerId),
    };
  });
}

/** Goals grouped by owner, in generation order. */
export function groupGoalsByEmployee(
  goals: readonly FixtureGoal[],
): Map<string, FixtureGoal[]> {
  const byEmployee = new Map<string, FixtureGoal[]>();
  for (const goal of goals) {
    const owned = byEmployee.get(goal.employeeId);
    if (owned) owned.push(goal);
    else byEmployee.set(goal.employeeId, [goal]);
  }
  return byEmployee;
}
