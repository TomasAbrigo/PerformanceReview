import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import en from "@/messages/en.json";
import es from "@/messages/es.json";
import { builtinProfiles } from "@/modules/lake/profiles";
import type { ImportResult } from "@/modules/lake/upload-shared";
import { UploadForm } from "./upload-form";

const push = vi.fn();
vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
  useRouter: () => ({ push }),
}));

const messages = { es, en };
const col = (name: string) => ({ name, type: "VARCHAR", nullable: true });
const performanceColumns = [
  "Employee Name",
  "Manager",
  "Department",
  "Review Cycle",
  "Assessment Date",
].map(col);

const counts = {
  read: 69,
  inserted: 60,
  updated: 0,
  unchanged: 0,
  rejected: 0,
  deleted: 0,
  issues: 9,
};

async function previewPerformance(
  locale: "es" | "en",
  mode: "domain" | "landing",
) {
  const importFile = vi.fn(async (): Promise<ImportResult> => ({
    ok: true,
    runId: "run-9",
    counts,
    rejects: [],
    mode,
  }));
  const actions = {
    inspect: vi.fn(async () => ({
      ok: true as const,
      uploadId: `${"b".repeat(64)}.csv`,
      fileName: "employee-performance.csv",
      size: 1024,
      existed: false,
      columns: performanceColumns,
      rows: [],
    })),
    importFile,
  };
  render(
    <NextIntlClientProvider locale={locale} messages={messages[locale]}>
      <UploadForm profiles={builtinProfiles} actions={actions} />
    </NextIntlClientProvider>,
  );
  const t = messages[locale].Upload;
  await userEvent.upload(
    screen.getByLabelText(t.choose.fileLabel),
    new File(["x"], "employee-performance.csv", { type: "text/csv" }),
  );
  await userEvent.click(screen.getByRole("button", { name: t.choose.submit }));
  await screen.findByRole("heading", { name: t.preview.title });
  return { importFile, t };
}

describe.each(["es", "en"] as const)(
  "historical import upload (%s)",
  (locale) => {
    it("imports a Bamboo performance report as historical cycles and opens its result", async () => {
      push.mockClear();
      const { importFile, t } = await previewPerformance(locale, "domain");

      const toggle = screen.getByRole("checkbox", {
        name: t.preview.landingOnly,
      });
      expect(toggle).not.toBeChecked();
      await userEvent.click(
        screen.getByRole("button", { name: t.preview.import }),
      );

      expect(importFile).toHaveBeenCalledWith({
        uploadId: `${"b".repeat(64)}.csv`,
        fileName: "employee-performance.csv",
        profile: { builtin: "bamboo-employee-performance" },
        landing: false,
      });
      await waitFor(() =>
        expect(push).toHaveBeenCalledWith("/imports/history/run-9"),
      );
    });

    it("can only land the rows instead", async () => {
      push.mockClear();
      const { importFile, t } = await previewPerformance(locale, "landing");

      await userEvent.click(
        screen.getByRole("checkbox", { name: t.preview.landingOnly }),
      );
      await userEvent.click(
        screen.getByRole("button", { name: t.preview.import }),
      );

      expect(importFile).toHaveBeenCalledWith(
        expect.objectContaining({ landing: true }),
      );
      await waitFor(() =>
        expect(push).toHaveBeenCalledWith("/imports/runs/run-9"),
      );
    });
  },
);
