import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, db } from "@/db/client";
import {
  addQuestion,
  addSection,
  cloneTemplate,
  createScale,
  createTemplate,
  deleteScale,
  deleteTemplate,
  getTemplate,
  listScales,
  listTemplates,
  reorder,
  seedSystemTemplates,
  TemplatesError,
  updateQuestion,
  updateTemplate,
} from ".";

const t = (es: string, en: string) => ({ es, en });

async function systemTemplate(key: string) {
  const found = (await listTemplates(db)).find((x) => x.systemKey === key);
  if (!found) throw new Error(`missing ${key}`);
  return found;
}

async function customTemplateWithSection() {
  const template = await createTemplate(db, { name: t("Prueba", "Test") });
  const section = await addSection(db, template.id, {
    title: t("Sección", "Section"),
  });
  return { template, section };
}

describe("templates module", () => {
  beforeAll(async () => {
    await seedSystemTemplates(db);
  });

  afterAll(async () => {
    await closeDb();
  });

  it("seeds the three system scales once, even when run twice", async () => {
    await seedSystemTemplates(db);
    const system = (await listScales(db)).filter((s) => s.isSystem);
    expect(system.map((s) => s.name.en).sort()).toEqual([
      "4-point descriptive",
      "5-point agreement",
      "Never…Always",
    ]);
  });

  it("seeds the four system templates; upward is disabled", async () => {
    const system = (await listTemplates(db)).filter((x) => x.isSystem);
    expect(system.map((x) => x.name.es).sort()).toEqual([
      "Ciclo de desarrollo de mitad de año",
      "Evaluación de fin de año",
      "Feedback de pares",
      "Upward",
    ]);
    expect((await systemTemplate("upward")).enabled).toBe(false);
  });

  it("year-end template has the default self/manager/peer questions", async () => {
    const detail = await getTemplate(db, (await systemTemplate("year_end")).id);
    const counts = detail!.sections.map((s) => s.questions.length);
    expect(counts).toEqual([4, 6, 3]);
    const ratings = detail!.sections[1].questions.filter(
      (q) => q.kind === "rating",
    );
    expect(ratings).toHaveLength(2);
  });

  it("mid-year template has no rating questions", async () => {
    const detail = await getTemplate(
      db,
      (await systemTemplate("mid_year_development")).id,
    );
    const kinds = detail!.sections.flatMap((s) =>
      s.questions.map((q) => q.kind),
    );
    expect(kinds.length).toBeGreaterThan(0);
    expect(kinds).not.toContain("rating");
  });

  it("system templates and scales cannot be deleted or edited", async () => {
    const year = await systemTemplate("year_end");
    await expect(deleteTemplate(db, year.id)).rejects.toMatchObject({
      code: "system_readonly",
    });
    await expect(
      addSection(db, year.id, { title: t("x", "x") }),
    ).rejects.toBeInstanceOf(TemplatesError);
    const scale = (await listScales(db)).find((s) => s.isSystem)!;
    await expect(deleteScale(db, scale.id)).rejects.toMatchObject({
      code: "system_readonly",
    });
  });

  it("cloning copies sections, questions and scale references", async () => {
    const source = await getTemplate(db, (await systemTemplate("year_end")).id);
    const clone = await cloneTemplate(db, source!.id, {
      name: t("Mi fin de año", "My year-end"),
    });
    const copy = await getTemplate(db, clone.id);

    expect(copy!.isSystem).toBe(false);
    expect(copy!.clonedFromId).toBe(source!.id);
    expect(copy!.name).toEqual(t("Mi fin de año", "My year-end"));
    const shape = (d: typeof source) =>
      d!.sections.map((s) => ({
        title: s.title,
        questions: s.questions.map((q) => [q.kind, q.prompt.en, q.scaleId]),
      }));
    expect(shape(copy)).toEqual(shape(source));
    expect(copy!.sections[0].id).not.toBe(source!.sections[0].id);

    await deleteTemplate(db, clone.id);
    expect(await getTemplate(db, clone.id)).toBeNull();
  });

  it("rejects a question missing a locale and reports which one", async () => {
    const { template, section } = await customTemplateWithSection();
    const error = await addQuestion(db, section.id, {
      kind: "text",
      appliesTo: ["self"],
      prompt: t("¿Qué lograste?", " "),
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TemplatesError);
    expect((error as TemplatesError).issues).toEqual([
      { path: "prompt.en", message: "required" },
    ]);
    await deleteTemplate(db, template.id);
  });

  it("allows a scale only on rating questions and choices only on single choice", async () => {
    const { template, section } = await customTemplateWithSection();
    const scale = (await listScales(db)).find((s) => s.isSystem)!;
    const base = { appliesTo: ["manager" as const], prompt: t("P", "P") };
    await expect(
      addQuestion(db, section.id, { ...base, kind: "rating" }),
    ).rejects.toMatchObject({ issues: [{ path: "scaleId" }] });
    await expect(
      addQuestion(db, section.id, { ...base, kind: "text", scaleId: scale.id }),
    ).rejects.toMatchObject({ issues: [{ path: "scaleId" }] });
    await expect(
      addQuestion(db, section.id, {
        ...base,
        kind: "text",
        choices: [{ value: "a", label: t("A", "A") }],
      }),
    ).rejects.toMatchObject({ issues: [{ path: "choices" }] });

    const choice = await addQuestion(db, section.id, {
      ...base,
      kind: "single_choice",
      choices: [
        { value: "yes", label: t("Sí", "Yes") },
        { value: "no", label: t("No", "No") },
      ],
    });
    expect(choice.choices).toHaveLength(2);
    const updated = await updateQuestion(db, choice.id, {
      ...base,
      kind: "rating",
      scaleId: scale.id,
    });
    expect(updated).toMatchObject({
      kind: "rating",
      scaleId: scale.id,
      choices: null,
    });
    await deleteTemplate(db, template.id);
  });

  it("computes normalized values comparable across 4 and 5 point scales", async () => {
    const scales = await listScales(db);
    const four = scales.find((s) => s.name.en === "4-point descriptive")!;
    const five = scales.find((s) => s.name.en === "5-point agreement")!;
    expect(four.options.map((o) => o.normalized)).toEqual(
      [0, 1 / 3, 2 / 3, 1].map((n) => expect.closeTo(n, 5)),
    );
    expect(five.options.map((o) => o.normalized)).toEqual([
      0, 0.25, 0.5, 0.75, 1,
    ]);
    // "Meets expectations" (2/4) sits below "Agree" (4/5) on the common 0..1 axis.
    expect(four.options[1].normalized).toBeLessThan(five.options[3].normalized);

    const custom = await createScale(db, {
      name: t("Tres", "Three"),
      options: [
        { value: 10, label: t("Alto", "High") },
        { value: 0, label: t("Bajo", "Low") },
        { value: 5, label: t("Medio", "Mid") },
      ],
    });
    expect(custom.options.map((o) => [o.value, o.normalized])).toEqual([
      [0, 0],
      [5, 0.5],
      [10, 1],
    ]);
    await deleteScale(db, custom.id);
  });

  it("rejects a scale option missing a locale", async () => {
    await expect(
      createScale(db, {
        name: t("X", "X"),
        options: [
          { value: 1, label: t("Uno", "") },
          { value: 2, label: t("Dos", "Two") },
        ],
      }),
    ).rejects.toMatchObject({ issues: [{ path: "options.0.label.en" }] });
  });

  it("reorders sections and questions", async () => {
    const { template, section } = await customTemplateWithSection();
    const second = await addSection(db, template.id, { title: t("B", "B") });
    const q = (en: string) =>
      addQuestion(db, section.id, {
        kind: "text",
        appliesTo: ["self"],
        prompt: t(en, en),
      });
    const [a, b, c] = [await q("a"), await q("b"), await q("c")];

    await reorder(db, {
      kind: "questions",
      parentId: section.id,
      ids: [c.id, a.id, b.id],
    });
    await reorder(db, {
      kind: "sections",
      parentId: template.id,
      ids: [second.id, section.id],
    });

    const detail = await getTemplate(db, template.id);
    expect(detail!.sections.map((s) => s.id)).toEqual([second.id, section.id]);
    expect(detail!.sections[1].questions.map((x) => x.prompt.en)).toEqual([
      "c",
      "a",
      "b",
    ]);
    await expect(
      reorder(db, { kind: "questions", parentId: section.id, ids: [a.id] }),
    ).rejects.toMatchObject({ code: "validation" });
    await deleteTemplate(db, template.id);
  });

  it("renaming a template keeps its description", async () => {
    const clone = await cloneTemplate(
      db,
      (await systemTemplate("year_end")).id,
    );
    await updateTemplate(db, clone.id, { name: t("Renombrado", "Renamed") });
    const after = await getTemplate(db, clone.id);
    expect(after!.name).toEqual(t("Renombrado", "Renamed"));
    expect(after!.description?.en).toBe(
      "Self-reflection, manager review and peer feedback.",
    );
    await deleteTemplate(db, clone.id);
  });

  it("rejects a reorder that repeats an id", async () => {
    const { template, section } = await customTemplateWithSection();
    const q = (en: string) =>
      addQuestion(db, section.id, {
        kind: "text",
        appliesTo: ["self"],
        prompt: t(en, en),
      });
    const a = await q("a");
    await q("b");
    await expect(
      reorder(db, {
        kind: "questions",
        parentId: section.id,
        ids: [a.id, a.id],
      }),
    ).rejects.toMatchObject({ code: "validation" });
    await deleteTemplate(db, template.id);
  });

  it("cloning a disabled template keeps it disabled", async () => {
    const clone = await cloneTemplate(db, (await systemTemplate("upward")).id);
    expect(clone.enabled).toBe(false);
    await deleteTemplate(db, clone.id);
  });
});

describe("question roles", () => {
  beforeAll(async () => {
    await seedSystemTemplates(db);
  });

  afterAll(async () => {
    await closeDb();
  });

  const rolesOf = async (templateId: string) =>
    Object.fromEntries(
      (await getTemplate(db, templateId))!.sections
        .flatMap((sec) => sec.questions)
        .filter((q) => q.role)
        .map((q) => [q.prompt.en, q.role]),
    );

  it("marks the goals rating, its comment and the overall rating of the year-end template", async () => {
    expect(await rolesOf((await systemTemplate("year_end")).id)).toEqual({
      "How would you rate their progress on goals?": "goals_rating",
      "Comment on their progress on goals.": "goals_comment",
      "Overall performance rating": "overall_rating",
    });
  });

  it("keeps the roles when cloning", async () => {
    const source = await systemTemplate("year_end");
    const clone = await cloneTemplate(db, source.id);
    expect(await rolesOf(clone.id)).toEqual(await rolesOf(source.id));
    await deleteTemplate(db, clone.id);
  });

  it("sets, keeps and clears the role from the editor", async () => {
    const { template, section } = await customTemplateWithSection();
    const scale = (await listScales(db)).find((x) => x.isSystem)!;
    const base = {
      appliesTo: ["manager" as const],
      prompt: t("Calificación", "Rating"),
      kind: "rating" as const,
      scaleId: scale.id,
    };
    const created = await addQuestion(db, section.id, {
      ...base,
      role: "overall_rating",
    });
    expect(created.role).toBe("overall_rating");
    // Not sending a role leaves it alone.
    expect((await updateQuestion(db, created.id, base)).role).toBe(
      "overall_rating",
    );
    expect(
      (await updateQuestion(db, created.id, { ...base, role: null })).role,
    ).toBeNull();
    await deleteTemplate(db, template.id);
  });

  it("only allows rating roles on rating questions and the comment on text", async () => {
    const { template, section } = await customTemplateWithSection();
    const base = { appliesTo: ["manager" as const], prompt: t("P", "P") };
    for (const role of ["goals_rating", "overall_rating"] as const) {
      await expect(
        addQuestion(db, section.id, { ...base, kind: "text", role }),
      ).rejects.toMatchObject({
        issues: [{ path: "role", message: "only_for_rating" }],
      });
    }
    const scale = (await listScales(db)).find((x) => x.isSystem)!;
    await expect(
      addQuestion(db, section.id, {
        ...base,
        kind: "rating",
        scaleId: scale.id,
        role: "goals_comment",
      }),
    ).rejects.toMatchObject({
      issues: [{ path: "role", message: "only_for_text" }],
    });
    await expect(
      addQuestion(db, section.id, {
        ...base,
        kind: "text",
        role: "bogus" as never,
      }),
    ).rejects.toBeInstanceOf(TemplatesError);
    await deleteTemplate(db, template.id);
  });

  it("rejects changing the kind of a question that keeps a rating role", async () => {
    const { template, section } = await customTemplateWithSection();
    const scale = (await listScales(db)).find((x) => x.isSystem)!;
    const base = { appliesTo: ["manager" as const], prompt: t("P", "P") };
    const q = await addQuestion(db, section.id, {
      ...base,
      kind: "rating",
      scaleId: scale.id,
      role: "goals_rating",
    });
    await expect(
      updateQuestion(db, q.id, { ...base, kind: "text" }),
    ).rejects.toMatchObject({
      issues: [{ path: "role", message: "only_for_rating" }],
    });
    await deleteTemplate(db, template.id);
  });

  it("allows one overall rating and one goals rating per template", async () => {
    const { template, section } = await customTemplateWithSection();
    const other = await addSection(db, template.id, {
      title: t("Otra", "Other"),
    });
    const scale = (await listScales(db)).find((x) => x.isSystem)!;
    const rating = {
      appliesTo: ["manager" as const],
      prompt: t("R", "R"),
      kind: "rating" as const,
      scaleId: scale.id,
    };
    for (const role of ["overall_rating", "goals_rating"] as const) {
      const first = await addQuestion(db, section.id, { ...rating, role });
      // Another section of the same template counts too.
      await expect(
        addQuestion(db, other.id, { ...rating, role }),
      ).rejects.toMatchObject({
        issues: [{ path: "role", message: "duplicate_role" }],
      });
      // Editing the one that has it is fine; so is moving the role on.
      await updateQuestion(db, first.id, { ...rating, role });
      const second = await addQuestion(db, other.id, rating);
      await expect(
        updateQuestion(db, second.id, { ...rating, role }),
      ).rejects.toMatchObject({
        issues: [{ path: "role", message: "duplicate_role" }],
      });
    }
    // Other templates are not affected.
    const { template: elsewhere, section: elsewhereSection } =
      await customTemplateWithSection();
    await expect(
      addQuestion(db, elsewhereSection.id, {
        ...rating,
        role: "overall_rating",
      }),
    ).resolves.toMatchObject({ role: "overall_rating" });
    await deleteTemplate(db, template.id);
    await deleteTemplate(db, elsewhere.id);
  });
});
