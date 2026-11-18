import { useLocale, useTranslations } from "next-intl";
import { type AssessmentQuestion, answerDisplay } from "@/modules/assessments";

/**
 * The answer to a question as the Bamboo form shows it: open answers as
 * text; closed ones as the value on its scale (`4/5`) with the option's code
 * and label in the reader's language.
 */
export function AnswerValue({ question }: { question: AssessmentQuestion }) {
  const t = useTranslations("Assessments.detail");
  const locale = useLocale();
  const shown = answerDisplay(question, question.answer ?? undefined, locale);
  if (shown.kind === "none") {
    return <span className="text-muted-foreground">{t("noAnswer")}</span>;
  }
  if (shown.kind === "text") {
    return <p className="max-w-prose whitespace-pre-line">{shown.text}</p>;
  }
  return (
    <span className="flex flex-wrap items-baseline gap-2">
      {shown.value !== null ? (
        <span
          className="rounded-md bg-brand-fog px-2 py-0.5 font-medium text-brand-700 tabular-nums"
          aria-label={
            shown.max !== null
              ? t("scaleOf", { value: shown.value, max: shown.max })
              : String(shown.value)
          }
        >
          {shown.value}
          {shown.max !== null ? `/${shown.max}` : null}
        </span>
      ) : null}
      {shown.code ? (
        <span className="font-medium text-muted-foreground">{shown.code}</span>
      ) : null}
      {shown.label ? <span>{shown.label}</span> : null}
    </span>
  );
}
