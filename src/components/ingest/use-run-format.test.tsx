import { renderHook } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import en from "@/messages/en.json";
import es from "@/messages/es.json";
import { useRunFormat } from "./use-run-format";

const messages = { es, en };

function durationIn(locale: "es" | "en", ms: number) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <NextIntlClientProvider locale={locale} messages={messages[locale]}>
      {children}
    </NextIntlClientProvider>
  );
  const { result } = renderHook(() => useRunFormat(), { wrapper });
  const start = new Date("2026-11-12T10:00:00Z");
  return result.current.duration(start, new Date(start.getTime() + ms));
}

describe("useRunFormat().duration", () => {
  it.each([
    [0, "0 ms"],
    [850, "850 ms"],
    [1_500, "1.5 sec"],
    [45_000, "45 sec"],
    [60_000, "1 min"],
    [125_000, "2 min 5 sec"],
    [3_600_000, "60 min"],
  ])("%i ms reads %s", (ms, expected) => {
    expect(durationIn("en", ms)).toBe(expected);
  });

  it.each([
    // Rounding the seconds up must carry into the minutes, never "1 min 60 s".
    [119_600, "2 min"],
    [119_499, "1 min 59 sec"],
    [179_999, "3 min"],
    [59_949, "59.9 sec"],
    [59_950, "1 min"],
    [59_999, "1 min"],
    [60_400, "1 min"],
    [60_600, "1 min 1 sec"],
  ])("%i ms never shows 60 seconds next to the minutes", (ms, expected) => {
    const text = durationIn("en", ms);
    expect(text).toBe(expected);
    expect(text).not.toMatch(/\b60 sec\b/);
  });

  it("is locale-aware", () => {
    expect(durationIn("es", 125_000)).toMatch(/2\s?min\s5\s?s/);
  });

  it("is a dash while the run has not finished", () => {
    const wrapper = ({ children }: { children: ReactNode }) => (
      <NextIntlClientProvider locale="en" messages={en}>
        {children}
      </NextIntlClientProvider>
    );
    const { result } = renderHook(() => useRunFormat(), { wrapper });
    expect(result.current.duration(new Date(), null)).toBe("—");
  });
});
