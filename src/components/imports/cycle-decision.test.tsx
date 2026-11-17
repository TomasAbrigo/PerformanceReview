import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import en from "@/messages/en.json";
import es from "@/messages/es.json";
import type { HistoryImportResult } from "@/modules/import-history/results";
import { CycleDecisionForm } from "./cycle-decision";

const messages = { es, en };

function renderIn(locale: "es" | "en", ui: ReactNode) {
  return render(
    <NextIntlClientProvider locale={locale} messages={messages[locale]}>
      {ui}
    </NextIntlClientProvider>,
  );
}

const decision: NonNullable<HistoryImportResult["decision"]> = {
  kind: "cycle",
  rows: 3,
  reasons: ["ambiguous_semester"],
  names: [],
  proposals: [
    { name: "2025-H2", periodStart: "2025-07-01", periodEnd: "2025-12-31" },
  ],
  options: [
    {
      id: "c-1",
      name: "Evaluación semestral 2025-H1",
      periodStart: "2025-01-01",
      periodEnd: "2025-06-30",
    },
  ],
};

describe.each(["es", "en"] as const)("CycleDecisionForm (%s)", (locale) => {
  const t = messages[locale].ImportHistory.decision;

  it("offers the existing cycles and the proposed semester, and resumes with the choice", async () => {
    const resume = vi.fn().mockResolvedValue({ ok: true });
    renderIn(
      locale,
      <CycleDecisionForm runId="run-1" decision={decision} resume={resume} />,
    );

    expect(screen.getByRole("heading", { name: t.title })).toBeInTheDocument();
    expect(screen.getByText(t.reasons.ambiguous_semester)).toBeInTheDocument();
    const submit = screen.getByRole("button", { name: t.submit });
    expect(submit).toBeDisabled();

    await userEvent.click(screen.getByRole("radio", { name: /2025-H2/ }));
    await userEvent.click(submit);
    expect(resume).toHaveBeenCalledWith("run-1", "create:2025-H2");

    await userEvent.click(
      screen.getByRole("radio", { name: /Evaluación semestral 2025-H1/ }),
    );
    await userEvent.click(submit);
    expect(resume).toHaveBeenLastCalledWith("run-1", "cycle:c-1");
  });

  it("says why the run could not resume", async () => {
    const resume = vi
      .fn()
      .mockResolvedValue({ ok: false, code: "not_waiting", issues: [] });
    renderIn(
      locale,
      <CycleDecisionForm runId="run-1" decision={decision} resume={resume} />,
    );
    await userEvent.click(screen.getByRole("radio", { name: /2025-H2/ }));
    await userEvent.click(screen.getByRole("button", { name: t.submit }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      t.errors.not_waiting,
    );
  });

  it("names the cycles the file gave that matched nothing", () => {
    renderIn(
      locale,
      <CycleDecisionForm
        runId="run-1"
        decision={{
          ...decision,
          reasons: ["unknown_cycle"],
          names: ["Primer semestre 2025"],
          proposals: [],
        }}
        resume={vi.fn()}
      />,
    );
    expect(screen.getByText(/Primer semestre 2025/)).toBeInTheDocument();
  });
});
