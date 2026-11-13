import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import en from "@/messages/en.json";
import es from "@/messages/es.json";
import {
  type TemplateRow,
  type TemplatesActions,
  TemplatesView,
} from "./templates-view";

vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  Link: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

const actions: TemplatesActions = {
  create: vi.fn().mockResolvedValue({ ok: true, id: "x" }),
  clone: vi.fn().mockResolvedValue({ ok: true, id: "y" }),
  remove: vi.fn().mockResolvedValue({ ok: true }),
};

const rows: TemplateRow[] = [
  {
    id: "a",
    name: { es: "Evaluación de fin de año", en: "Year-end review" },
    isSystem: true,
    enabled: true,
  },
  {
    id: "b",
    name: { es: "Mi copia", en: "My copy" },
    isSystem: false,
    enabled: true,
  },
];

function renderIn(locale: "es" | "en", templates: TemplateRow[]) {
  return render(
    <NextIntlClientProvider
      locale={locale}
      messages={locale === "es" ? es : en}
    >
      <TemplatesView templates={templates} actions={actions} />
    </NextIntlClientProvider>,
  );
}

describe("TemplatesView", () => {
  it("shows an empty state", () => {
    renderIn("en", []);
    expect(screen.getByText("There are no templates yet.")).toBeVisible();
  });

  it("only offers delete for non-system templates", () => {
    renderIn("es", rows);
    expect(
      screen.getByRole("link", { name: "Evaluación de fin de año" }),
    ).toHaveAttribute("href", "/settings/templates/a");
    expect(
      screen.getAllByRole("button", { name: "Clonar template" }),
    ).toHaveLength(2);
    expect(
      screen.getAllByRole("button", { name: "Borrar template" }),
    ).toHaveLength(1);
  });
});
