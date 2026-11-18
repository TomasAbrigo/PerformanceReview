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
const orgColumns = [
  "EEID",
  "Cuenta",
  "Proyecto",
  "DM",
  "Santex Lead",
  "Desde",
  "Hasta",
].map(col);
const performanceColumns = [
  "Employee Name",
  "Manager",
  "Department",
  "Review Cycle",
  "Assessment Date",
].map(col);

async function preview(
  locale: "es" | "en",
  fileName: string,
  columns: ReturnType<typeof col>[],
) {
  const importFile = vi.fn(async (): Promise<ImportResult> => ({
    ok: true,
    runId: "run-7",
    counts: {
      read: 40,
      inserted: 40,
      updated: 0,
      unchanged: 0,
      rejected: 0,
      deleted: 0,
      issues: 0,
    },
    rejects: [],
    mode: "attributes",
  }));
  const actions = {
    inspect: vi.fn(async () => ({
      ok: true as const,
      uploadId: `${"c".repeat(64)}.csv`,
      fileName,
      size: 512,
      existed: false,
      columns,
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
    new File(["x"], fileName, { type: "text/csv" }),
  );
  await userEvent.click(screen.getByRole("button", { name: t.choose.submit }));
  await screen.findByRole("heading", { name: t.preview.title });
  return { importFile, t };
}

describe.each(["es", "en"] as const)("org attributes upload (%s)", (locale) => {
  it("offers the partial-file toggle for the org attributes profile, off by default: the file is the whole list", async () => {
    push.mockClear();
    const { importFile, t } = await preview(
      locale,
      "org-attributes.csv",
      orgColumns,
    );

    expect(screen.getByLabelText(t.preview.profile)).toHaveValue(
      "org-attributes",
    );
    const toggle = screen.getByRole("checkbox", {
      name: t.preview.partialFile,
    });
    expect(toggle).not.toBeChecked();
    expect(screen.getByText(t.preview.completeHint)).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("button", { name: t.preview.import }),
    );

    expect(importFile).toHaveBeenCalledWith({
      uploadId: `${"c".repeat(64)}.csv`,
      fileName: "org-attributes.csv",
      profile: { builtin: "org-attributes" },
    });
    await waitFor(() =>
      expect(push).toHaveBeenCalledWith("/imports/runs/run-7"),
    );
  });

  it("sends partial for this import when it is checked", async () => {
    const { importFile, t } = await preview(
      locale,
      "org-attributes.csv",
      orgColumns,
    );

    await userEvent.click(
      screen.getByRole("checkbox", { name: t.preview.partialFile }),
    );
    expect(screen.getByText(t.preview.partialHint)).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("button", { name: t.preview.import }),
    );

    expect(importFile).toHaveBeenCalledWith(
      expect.objectContaining({
        profile: { builtin: "org-attributes" },
        partial: true,
      }),
    );
  });

  it("is not offered for any other profile", async () => {
    const { t } = await preview(
      locale,
      "employee-performance.csv",
      performanceColumns,
    );

    expect(
      screen.queryByRole("checkbox", { name: t.preview.partialFile }),
    ).toBeNull();
  });
});

describe("the partial toggle's wording", () => {
  it("says what it does in both languages", () => {
    expect(es.Upload.preview.partialFile).toBe(
      "Archivo parcial (no dar de baja lo que no viene en el archivo)",
    );
    expect(en.Upload.preview.partialFile).toMatch(/^Partial file/);
  });
});
