import { expect, test } from "@playwright/test";

test("person detail lists goals by due date with progress and milestones", async ({
  page,
}) => {
  await page.goto("/es/people");
  await page.getByRole("link", { name: "Bruno Pérez" }).click();

  await expect(
    page.getByRole("heading", { level: 2, name: "Objetivos" }),
  ).toBeVisible();
  const cards = page.getByRole("article");
  await expect(cards).toHaveCount(3);
  await expect(cards.getByRole("heading")).toHaveText([
    "Obtener la certificación AWS",
    "Reducir el tiempo de primera respuesta de soporte",
    "Documentar los runbooks de guardia",
  ]);

  const support = cards.filter({
    hasText: "Reducir el tiempo de primera respuesta de soporte",
  });
  await expect(support.getByText("En curso")).toBeVisible();
  await expect(support.getByRole("progressbar")).toHaveAttribute(
    "aria-valuenow",
    "55",
  );
  await expect(support.getByText("2 de 3 hitos")).toBeVisible();
  const milestones = support.getByRole("list", { name: "Hitos" });
  await expect(milestones.getByRole("listitem")).toHaveCount(3);
  await expect(milestones).toContainText("Cubrir el turno noche");
  await expect(support.getByText("1 comentario")).toBeVisible();

  await expect(
    cards
      .filter({ hasText: "Obtener la certificación AWS" })
      .getByText("Completado", { exact: true }),
  ).toBeVisible();
});

test("closed and shared goals show up on the owner's page", async ({
  page,
}) => {
  await page.goto("/en/people");
  await page.getByRole("link", { name: "Ana García" }).click();

  await expect(
    page.getByRole("heading", { level: 2, name: "Goals" }),
  ).toBeVisible();
  const closed = page
    .getByRole("article")
    .filter({ hasText: "Migrar legajos al nuevo sistema" });
  await expect(closed.getByText("Closed", { exact: true })).toBeVisible();
  const plan = page
    .getByRole("article")
    .filter({ hasText: "Definir el plan de carrera del área" });
  await expect(plan.getByText("Shared with Bruno Pérez")).toBeVisible();
  await expect(plan.getByText("2 comments")).toBeVisible();
  await expect(plan.getByText("1 of 2 milestones")).toBeVisible();
});

test("a person without goals shows the empty state", async ({ page }) => {
  await page.goto("/es/people");
  await page.getByRole("link", { name: "Carla Romero" }).click();

  await expect(
    page.getByText("Todavía no hay objetivos importados."),
  ).toBeVisible();
});

test("team view groups the goals of the manager's direct reports", async ({
  page,
}) => {
  await page.goto("/es");
  await page.getByRole("link", { name: "Objetivos del equipo" }).click();
  await expect(page).toHaveURL(/\/es\/team\/goals$/);
  await page.getByRole("link", { name: "Ana García" }).click();
  await expect(page).toHaveURL(/team\/goals\?manager=/);

  await expect(
    page.getByRole("heading", { level: 1, name: "Objetivos del equipo" }),
  ).toBeVisible();
  await expect(
    page.getByText("Objetivos de los reportes directos de Ana García."),
  ).toBeVisible();

  // Bruno is Ana's only current report: Carla was terminated in 2024.
  const groups = page.getByRole("region");
  await expect(groups).toHaveCount(1);
  const bruno = page.getByRole("region", { name: "Bruno Pérez" });
  await expect(bruno.getByText("3 objetivos")).toBeVisible();
  await expect(bruno.getByRole("article")).toHaveCount(3);
  await expect(
    bruno.getByRole("article").first().getByRole("heading"),
  ).toHaveText("Obtener la certificación AWS");
  await expect(page.getByText("Carla Romero")).toHaveCount(0);

  await bruno.getByRole("link", { name: "Bruno Pérez" }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: "Bruno Pérez" }),
  ).toBeVisible();
});

test("manager picker lists managers; an unknown manager is not found", async ({
  page,
}) => {
  await page.goto("/en/team/goals");
  await expect(
    page.getByText("Choose a manager to see their team's goals."),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Bruno Pérez" })).toHaveCount(0);

  // Streamed pages answer 200 before not-found is known: check the content.
  await page.goto(
    "/en/team/goals?manager=00000000-0000-4000-8000-000000000000",
  );
  await expect(page.getByText("This page could not be found.")).toBeVisible();
});
