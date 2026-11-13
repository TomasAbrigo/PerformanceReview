import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { TemplateEditor } from "@/components/templates/template-editor";
import { db } from "@/db/client";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { getTemplate, listScales } from "@/modules/templates";
import {
  addQuestionAction,
  addSectionAction,
  cloneTemplateAction,
  deleteQuestionAction,
  deleteSectionAction,
  reorderAction,
  updateQuestionAction,
  updateSectionAction,
  updateTemplateAction,
} from "../../actions";

type Params = PageProps<"/[locale]/settings/templates/[id]">["params"];

export default function TemplatePage({ params }: { params: Params }) {
  return (
    <Suspense fallback={<div aria-busy="true" className="h-40" />}>
      <Editor params={params} />
    </Suspense>
  );
}

const UUID = /^[0-9a-f-]{36}$/i;

async function Editor({ params }: { params: Params }) {
  const { locale, id } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  await connection();
  const t = await getTranslations("Templates");

  const [template, scales] = await Promise.all([
    UUID.test(id) ? getTemplate(db, id) : null,
    listScales(db),
  ]);
  if (!template) {
    return <p role="alert">{t("notFound")}</p>;
  }
  const name = locale === "en" ? template.name.en : template.name.es;

  return (
    <>
      <header className="flex flex-col gap-1">
        <Link
          href="/settings/templates"
          className="text-sm text-muted-foreground hover:underline"
        >
          {t("back")}
        </Link>
        <h1 className="text-2xl font-semibold">{name}</h1>
      </header>
      <TemplateEditor
        template={{
          id: template.id,
          name: template.name,
          description: template.description,
          isSystem: template.isSystem,
          sections: template.sections.map((s) => ({
            id: s.id,
            title: s.title,
            questions: s.questions.map((q) => ({
              id: q.id,
              kind: q.kind,
              appliesTo: q.appliesTo,
              visibleToReviewee: q.visibleToReviewee,
              required: q.required,
              scaleId: q.scaleId,
              prompt: q.prompt,
              choices: q.choices,
            })),
          })),
        }}
        scales={scales.map((s) => ({ id: s.id, name: s.name }))}
        actions={{
          updateTemplate: updateTemplateAction,
          addSection: addSectionAction,
          updateSection: updateSectionAction,
          deleteSection: deleteSectionAction,
          addQuestion: addQuestionAction,
          updateQuestion: updateQuestionAction,
          deleteQuestion: deleteQuestionAction,
          reorder: reorderAction,
          clone: cloneTemplateAction,
        }}
      />
    </>
  );
}
