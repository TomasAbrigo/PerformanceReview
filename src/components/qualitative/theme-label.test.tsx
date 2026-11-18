import { renderHook } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import en from "@/messages/en.json";
import es from "@/messages/es.json";
import { INITIAL_THEMES } from "@/modules/qualitative-analysis/themes";
import { humanizeTheme, useThemeLabel } from "./theme-label";

function wrap(locale: "es" | "en") {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <NextIntlClientProvider
        locale={locale}
        messages={locale === "es" ? es : en}
        timeZone="UTC"
      >
        {children}
      </NextIntlClientProvider>
    );
  };
}

describe("useThemeLabel", () => {
  it("names the themes with casing and accents", () => {
    const { result } = renderHook(() => useThemeLabel(), {
      wrapper: wrap("es"),
    });
    expect(result.current("planificacion")).toBe("Planificación");
    expect(result.current("comunicacion")).toBe("Comunicación");
    const { result: en } = renderHook(() => useThemeLabel(), {
      wrapper: wrap("en"),
    });
    expect(en.current("planificacion")).toBe("Planning");
  });
  it("has a message for every initial theme", () => {
    for (const key of INITIAL_THEMES) {
      expect(Object.keys(es.Themes)).toContain(key);
    }
  });
  it("humanizes a key without a message", () => {
    expect(humanizeTheme("salud_mental")).toBe("Salud mental");
  });
});
