import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import en from "@/messages/en.json";
import es from "@/messages/es.json";
import { builtinProfiles, type SourceProfile } from "@/modules/lake/profiles";
import type { ImportResult, InspectResult } from "@/modules/lake/upload-shared";
import { UploadForm, type UploadActions } from "./upload-form";

const push = vi.fn();
vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
  useRouter: () => ({ push }),
}));

const messages = { es, en };

function renderIn(locale: "es" | "en", ui: ReactNode) {
  return render(
    <NextIntlClientProvider locale={locale} messages={messages[locale]}>
      {ui}
    </NextIntlClientProvider>,
  );
}

const col = (name: string, type = "VARCHAR") => ({
  name,
  type,
  nullable: true,
});

const goalColumns = [
  col("Employee Name"),
  col("Manager"),
  col("Department"),
  col("Goal"),
  col("Due Date", "DATE"),
  col("Progress"),
  col("Status"),
  col("Last Comment"),
];

const goalRows = [
  {
    "Employee Name": "Adrián Bustos",
    Manager: "Silvana Molina",
    Department: "Ingeniería",
    Goal: "Migrar los reportes al nuevo tablero",
    "Due Date": "2023-08-25",
    Progress: "33%",
    Status: "Past Due",
    "Last Comment": null,
  },
  {
    "Employee Name": "Adrián Cabrera",
    Manager: "Federico Rivas",
    Department: "Finanzas",
    Goal: "Documentar los procesos críticos",
    "Due Date": "2025-10-31",
    Progress: "100%",
    Status: "Completed",
    "Last Comment": "Listo.",
  },
];

function inspected(
  overrides: Partial<Extract<InspectResult, { ok: true }>> = {},
): InspectResult {
  return {
    ok: true,
    uploadId: `${"a".repeat(64)}.csv`,
    fileName: "goal-status.csv",
    size: 2048,
    existed: false,
    columns: goalColumns,
    rows: goalRows,
    ...overrides,
  };
}

const counts = {
  read: 119,
  inserted: 117,
  updated: 0,
  unchanged: 0,
  rejected: 2,
  deleted: 0,
};

function setup(
  locale: "es" | "en",
  {
    inspect = inspected(),
    importResult = {
      ok: true,
      runId: "run-1",
      counts,
      rejects: [
        {
          sourceId: null,
          reason: 'Profile "bamboo-goal-status": key column "Goal" is empty',
          code: "empty_key",
          column: "Goal",
          values: { "Employee Name": "Ana López", Goal: null },
        },
      ],
    },
    saved = [],
  }: {
    inspect?: InspectResult;
    importResult?: ImportResult;
    /** Custom profiles saved before, listed after the built-in ones. */
    saved?: SourceProfile[];
  } = {},
) {
  const actions = {
    inspect: vi.fn<UploadActions["inspect"]>(async () => inspect),
    importFile: vi.fn<UploadActions["importFile"]>(async () => importResult),
  };
  renderIn(
    locale,
    <UploadForm profiles={[...builtinProfiles, ...saved]} actions={actions} />,
  );
  return actions;
}

const csv = (name = "goal-status.csv") =>
  new File(["a,b\n1,2\n"], name, { type: "text/csv" });

async function previewFile(
  locale: "es" | "en",
  file = csv(),
  options: Parameters<typeof setup>[1] = {},
) {
  const actions = setup(locale, options);
  const t = messages[locale].Upload;
  await userEvent.upload(screen.getByLabelText(t.choose.fileLabel), file);
  await userEvent.click(screen.getByRole("button", { name: t.choose.submit }));
  await screen.findByRole("heading", { name: t.preview.title });
  return actions;
}

describe.each(["es", "en"] as const)("UploadForm (%s)", (locale) => {
  const t = messages[locale].Upload;

  describe("empty state", () => {
    it("asks for a file and says what is accepted", () => {
      setup(locale);

      expect(screen.getByLabelText(t.choose.fileLabel)).toHaveAttribute(
        "type",
        "file",
      );
      expect(
        screen.getByText(t.choose.hint.replace("{max}", "50")),
      ).toBeInTheDocument();
      expect(screen.getByText(t.choose.empty)).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: t.choose.submit }),
      ).toBeEnabled();
      expect(screen.queryByRole("table")).toBeNull();
    });

    it("asks for a file when submitting without one", async () => {
      const actions = setup(locale);

      await userEvent.click(
        screen.getByRole("button", { name: t.choose.submit }),
      );

      expect(await screen.findByRole("alert")).toHaveTextContent(
        t.errors.no_file,
      );
      expect(actions.inspect).not.toHaveBeenCalled();
    });

    it("refuses an unsupported or oversized file without sending it", async () => {
      const actions = setup(locale);
      const input = screen.getByLabelText(t.choose.fileLabel);
      const huge = csv("big.csv");
      Object.defineProperty(huge, "size", { value: 51 * 1024 * 1024 });

      await userEvent.upload(input, huge);
      await userEvent.click(
        screen.getByRole("button", { name: t.choose.submit }),
      );

      expect(await screen.findByRole("alert")).toHaveTextContent(
        t.errors.file_too_large.replace("{max}", "50"),
      );
      expect(actions.inspect).not.toHaveBeenCalled();
    });

    it("shows the message of a failed preview", async () => {
      const actions = setup(locale, {
        inspect: {
          ok: false,
          code: "unreadable_file",
          message: "boom",
          issues: [],
        },
      });

      await userEvent.upload(screen.getByLabelText(t.choose.fileLabel), csv());
      await userEvent.click(
        screen.getByRole("button", { name: t.choose.submit }),
      );

      expect(await screen.findByRole("alert")).toHaveTextContent(
        t.errors.unreadable_file,
      );
      expect(actions.inspect).toHaveBeenCalledOnce();
      expect(screen.queryByRole("table")).toBeNull();
    });
  });

  describe("preview", () => {
    it("sends the chosen file and shows detected columns and the first rows", async () => {
      const actions = await previewFile(locale);

      const sent = actions.inspect.mock.calls[0][0];
      expect((sent.get("file") as File).name).toBe("goal-status.csv");

      const columns = screen.getByRole("table", { name: t.preview.columns });
      expect(within(columns).getByText("Due Date")).toBeInTheDocument();
      expect(within(columns).getByText("DATE")).toBeInTheDocument();
      const rows = screen.getByRole("table", { name: t.preview.rows });
      expect(
        within(rows).getByText("Migrar los reportes al nuevo tablero"),
      ).toBeInTheDocument();
      // 1 header row + 2 data rows.
      expect(within(rows).getAllByRole("row")).toHaveLength(3);
    });

    it("preselects the profile that matches the file and shows what each column is for", async () => {
      await previewFile(locale);

      const select = screen.getByLabelText(t.preview.profile);
      expect(select).toHaveValue("bamboo-goal-status");
      expect(screen.getByText(t.preview.matches)).toBeInTheDocument();
      expect(screen.queryByText(t.issues.title)).toBeNull();
      const columns = screen.getByRole("table", { name: t.preview.columns });
      const goal = within(columns).getByRole("row", { name: /^Goal\b/ });
      expect(within(goal).getByText(t.roles.key)).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: t.preview.import }),
      ).toBeEnabled();
    });

    it("highlights missing columns and blocks the import", async () => {
      await previewFile(locale);

      await userEvent.selectOptions(
        screen.getByLabelText(t.preview.profile),
        "bamboo-employee-performance",
      );

      const alert = screen.getByRole("alert");
      expect(alert).toHaveTextContent(t.issues.title);
      expect(alert).toHaveTextContent(/Review Cycle/);
      expect(alert).toHaveTextContent(/Assessment Date/);
      const columns = screen.getByRole("table", { name: t.preview.columns });
      const missing = within(columns).getByRole("row", {
        name: new RegExp(`Review Cycle.*${t.preview.missingInFile}`),
      });
      expect(missing).toHaveAttribute("data-issue", "missing_column");
      // Columns the file does have are not flagged.
      expect(
        within(columns).getByRole("row", { name: /^Employee Name\b/ }),
      ).not.toHaveAttribute("data-issue");
      expect(
        screen.getByRole("button", { name: t.preview.import }),
      ).toBeDisabled();
      expect(screen.getByText(t.preview.blocked)).toBeInTheDocument();
    });

    it("suggests the column that only differs in case", async () => {
      await previewFile(locale, csv(), {
        inspect: inspected({
          columns: goalColumns.map((c) =>
            c.name === "Goal" ? col("goal") : c,
          ),
        }),
      });

      await userEvent.selectOptions(
        screen.getByLabelText(t.preview.profile),
        "bamboo-goal-status",
      );

      expect(screen.getByRole("alert")).toHaveTextContent(
        t.issues.suggestion.replace("{suggestion}", "goal"),
      );
    });

    it("highlights a column whose type does not fit the profile", async () => {
      const employeeColumns = [
        "id",
        "employee_number",
        "first_name",
        "last_name",
        "work_email",
        "department",
        "job_title",
        "hire_date",
        "last_changed",
        "_fivetran_synced",
        "_fivetran_deleted",
      ].map((name) => col(name));
      await previewFile(locale, csv(), {
        inspect: inspected({ columns: employeeColumns, rows: [] }),
      });

      await userEvent.selectOptions(
        screen.getByLabelText(t.preview.profile),
        "fivetran-bamboohr-employee",
      );

      expect(screen.getByRole("alert")).toHaveTextContent(
        /_fivetran_synced.*VARCHAR/,
      );
      const columns = screen.getByRole("table", { name: t.preview.columns });
      expect(
        within(columns).getByRole("row", { name: /^_fivetran_synced\b/ }),
      ).toHaveAttribute("data-issue", "type_mismatch");
      const header = screen.getByRole("columnheader", {
        name: "_fivetran_synced",
      });
      expect(header).toHaveAttribute("data-issue", "type_mismatch");
      expect(
        screen.getByRole("button", { name: t.preview.import }),
      ).toBeDisabled();
    });

    it("says so when the same content was uploaded before, and when there are no rows", async () => {
      await previewFile(locale, csv(), {
        inspect: inspected({ existed: true, rows: [] }),
      });

      expect(screen.getByText(t.preview.existed)).toBeInTheDocument();
      expect(screen.getByText(t.preview.noRows)).toBeInTheDocument();
    });

    it("goes back to choosing a file", async () => {
      await previewFile(locale);

      await userEvent.click(
        screen.getByRole("button", { name: t.preview.another }),
      );

      expect(screen.getByLabelText(t.choose.fileLabel)).toBeInTheDocument();
      expect(screen.queryByRole("table")).toBeNull();
    });
  });

  describe("import", () => {
    it("sends the upload and the chosen profile, then shows the result", async () => {
      const actions = await previewFile(locale);

      await userEvent.click(
        screen.getByRole("button", { name: t.preview.import }),
      );

      expect(
        await screen.findByRole("heading", { name: t.result.title }),
      ).toBeInTheDocument();
      expect(actions.importFile).toHaveBeenCalledWith({
        uploadId: `${"a".repeat(64)}.csv`,
        fileName: "goal-status.csv",
        profile: { builtin: "bamboo-goal-status" },
      });
      const read = screen.getByText(t.result.read).closest("div");
      expect(read).toHaveTextContent("119");
      expect(
        screen.getByText(t.result.inserted).closest("div"),
      ).toHaveTextContent("117");
      expect(
        screen.getByText(t.result.rejected).closest("div"),
      ).toHaveTextContent("2");
      // The reject is worded by the UI, in its language, from structured data.
      expect(
        screen.getByText(
          t.result.rejectReasons.empty_key
            .replace("{column}", "Goal")
            .replace("{row}", 'Employee Name="Ana López", Goal=∅'),
        ),
      ).toBeInTheDocument();
      expect(screen.queryByText(/Profile "bamboo-goal-status"/)).toBeNull();
      expect(
        screen.getByRole("link", { name: t.result.viewRun }),
      ).toHaveAttribute("href", "/imports/runs/run-1");
      expect(screen.queryByText(t.result.noNew)).toBeNull();
    });

    it("opens the run's page once the import is done", async () => {
      push.mockClear();
      await previewFile(locale);

      await userEvent.click(
        screen.getByRole("button", { name: t.preview.import }),
      );

      await waitFor(() =>
        expect(push).toHaveBeenCalledWith("/imports/runs/run-1"),
      );
    });

    it("says nothing new was created when the file had already been imported", async () => {
      await previewFile(locale, csv(), {
        importResult: {
          ok: true,
          runId: "run-2",
          counts: { ...counts, inserted: 0, unchanged: 117 },
          rejects: [],
        },
      });

      await userEvent.click(
        screen.getByRole("button", { name: t.preview.import }),
      );

      expect(await screen.findByText(t.result.noNew)).toBeInTheDocument();
    });

    it("does not claim the file was imported before when every row was rejected", async () => {
      await previewFile(locale, csv(), {
        importResult: {
          ok: true,
          runId: "run-3",
          counts: {
            ...counts,
            read: 2,
            inserted: 0,
            unchanged: 0,
            rejected: 2,
          },
          rejects: [],
        },
      });

      await userEvent.click(
        screen.getByRole("button", { name: t.preview.import }),
      );

      await screen.findByRole("heading", { name: t.result.title });
      expect(screen.queryByText(t.result.noNew)).toBeNull();
    });

    it("starts over after a result", async () => {
      await previewFile(locale);
      await userEvent.click(
        screen.getByRole("button", { name: t.preview.import }),
      );
      await screen.findByRole("heading", { name: t.result.title });

      await userEvent.click(
        screen.getByRole("button", { name: t.result.another }),
      );

      expect(screen.getByLabelText(t.choose.fileLabel)).toBeInTheDocument();
    });

    it("shows why the server rejected the file, and stays on the preview", async () => {
      await previewFile(locale, csv(), {
        importResult: {
          ok: false,
          code: "invalid_profile",
          message: "does not match",
          issues: [],
        },
      });

      await userEvent.click(
        screen.getByRole("button", { name: t.preview.import }),
      );

      expect(await screen.findByRole("alert")).toHaveTextContent(
        t.errors.invalid_profile,
      );
      expect(
        screen.getByRole("heading", { name: t.preview.title }),
      ).toBeInTheDocument();
    });
  });

  describe("saved profiles", () => {
    const saved: SourceProfile = {
      name: "mis-metas",
      table: "mis-metas",
      keyColumns: ["Employee Name", "Goal"],
      entity: "goal",
      columnMap: { Goal: "title" },
    };

    it("imports with a saved profile by name: the server has its definition", async () => {
      const actions = await previewFile(locale, csv(), { saved: [saved] });
      await userEvent.selectOptions(
        screen.getByLabelText(t.preview.profile),
        "mis-metas",
      );

      await userEvent.click(
        screen.getByRole("button", { name: t.preview.import }),
      );

      await waitFor(() => expect(actions.importFile).toHaveBeenCalledOnce());
      expect(actions.importFile.mock.calls[0][0].profile).toEqual({
        saved: "mis-metas",
      });
    });

    async function defineNew(name: string) {
      await userEvent.selectOptions(
        screen.getByLabelText(t.preview.profile),
        t.preview.newProfile,
      );
      await userEvent.type(screen.getByLabelText(t.custom.name), name);
      await userEvent.click(
        screen.getByLabelText(t.custom.keyLabel.replace("{column}", "Goal")),
      );
    }

    it("a new profile cannot take the name of a built-in one", async () => {
      await previewFile(locale);

      await defineNew("bamboo-goal-status");

      expect(screen.getByText(t.custom.errors.builtinName)).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: t.preview.import }),
      ).toBeDisabled();
    });

    it("replacing a saved profile has to be asked for, and is sent as such", async () => {
      const actions = await previewFile(locale, csv(), { saved: [saved] });
      await defineNew("mis-metas");
      const importButton = screen.getByRole("button", {
        name: t.preview.import,
      });

      expect(screen.getByText(t.custom.errors.savedName)).toBeInTheDocument();
      expect(importButton).toBeDisabled();

      await userEvent.click(
        screen.getByLabelText(t.custom.replace.replace("{name}", "mis-metas")),
      );
      expect(importButton).toBeEnabled();
      await userEvent.click(importButton);

      await waitFor(() => expect(actions.importFile).toHaveBeenCalledOnce());
      expect(actions.importFile.mock.calls[0][0].profile).toMatchObject({
        custom: { name: "mis-metas", keyColumns: ["Goal"] },
        replace: true,
      });
    });

    it("a profile saved by an import shows up once in the list, and a replaced one is not duplicated", async () => {
      await previewFile(locale, csv(), { saved: [saved] });
      await defineNew("mis-metas");
      await userEvent.click(
        screen.getByLabelText(t.custom.replace.replace("{name}", "mis-metas")),
      );
      await userEvent.click(
        screen.getByRole("button", { name: t.preview.import }),
      );
      await screen.findByRole("heading", { name: t.result.title });

      // Another file, same list.
      await userEvent.click(
        screen.getByRole("button", { name: t.result.another }),
      );
      await userEvent.upload(screen.getByLabelText(t.choose.fileLabel), csv());
      await userEvent.click(
        screen.getByRole("button", { name: t.choose.submit }),
      );
      await screen.findByRole("heading", { name: t.preview.title });

      const options = within(screen.getByLabelText(t.preview.profile))
        .getAllByRole("option")
        .filter((o) => (o as HTMLOptionElement).value === "mis-metas");
      expect(options).toHaveLength(1);
    });
  });

  describe("custom profile", () => {
    it("defines a profile from the detected columns and imports with it", async () => {
      const actions = await previewFile(locale);
      await userEvent.selectOptions(
        screen.getByLabelText(t.preview.profile),
        t.preview.newProfile,
      );
      const importButton = screen.getByRole("button", {
        name: t.preview.import,
      });
      expect(importButton).toBeDisabled();

      await userEvent.type(screen.getByLabelText(t.custom.name), "mis-metas");
      await userEvent.selectOptions(
        screen.getByLabelText(t.custom.entity),
        "goal",
      );
      await userEvent.click(
        screen.getByLabelText(t.custom.keyLabel.replace("{column}", "Goal")),
      );
      await userEvent.click(
        screen.getByLabelText(
          t.custom.keyLabel.replace("{column}", "Employee Name"),
        ),
      );
      await userEvent.type(
        screen.getByLabelText(t.custom.fieldLabel.replace("{column}", "Goal")),
        "title",
      );
      await userEvent.click(
        screen.getByLabelText(
          t.custom.watermarkLabel.replace("{column}", "Due Date"),
        ),
      );

      expect(importButton).toBeEnabled();
      await userEvent.click(importButton);

      await waitFor(() => expect(actions.importFile).toHaveBeenCalledOnce());
      expect(actions.importFile.mock.calls[0][0]).toEqual({
        uploadId: `${"a".repeat(64)}.csv`,
        fileName: "goal-status.csv",
        profile: {
          custom: {
            name: "mis-metas",
            table: "mis-metas",
            entity: "goal",
            keyColumns: ["Employee Name", "Goal"],
            watermarkColumn: "Due Date",
            columnMap: { Goal: "title" },
          },
        },
      });
    });

    it("explains what is missing in the definition", async () => {
      await previewFile(locale);
      await userEvent.selectOptions(
        screen.getByLabelText(t.preview.profile),
        t.preview.newProfile,
      );

      await userEvent.type(screen.getByLabelText(t.custom.name), "Mal Nombre");

      expect(screen.getByText(t.custom.errors.name)).toBeInTheDocument();
      expect(screen.getByText(t.custom.errors.key)).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: t.preview.import }),
      ).toBeDisabled();
    });
  });
});
