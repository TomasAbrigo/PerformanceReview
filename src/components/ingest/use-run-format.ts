import { useFormatter } from "next-intl";

/** Locale-aware date and duration formatting for the run screens (UTC, deterministic). */
export function useRunFormat() {
  const format = useFormatter();

  const dateTime = (date: Date | null) =>
    date
      ? format.dateTime(date, {
          dateStyle: "medium",
          timeStyle: "long",
          timeZone: "UTC",
        })
      : "—";

  const unit = (value: number, unit: "millisecond" | "second" | "minute") =>
    format.number(value, {
      style: "unit",
      unit,
      unitDisplay: "short",
      maximumFractionDigits: unit === "second" ? 1 : 0,
    });

  /** "850 ms", "1.5 s", "2 min 5 s"; a dash while the run has not finished. */
  const duration = (start: Date | null, end: Date | null) => {
    if (!start || !end) return "—";
    const ms = Math.max(end.getTime() - start.getTime(), 0);
    if (ms < 1000) return unit(ms, "millisecond");
    // Below a minute show tenths of a second, unless they would round up to 60.
    if (ms < 59_950) return unit(ms / 1000, "second");
    // Round the total first, then split: rounding only the remainder gave "1 min 60 s".
    const totalSeconds = Math.round(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return seconds === 0
      ? unit(minutes, "minute")
      : `${unit(minutes, "minute")} ${unit(seconds, "second")}`;
  };

  return { dateTime, duration };
}
