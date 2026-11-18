import { useFormatter } from "next-intl";
import { COMPANY_TIME_ZONE } from "@/modules/org-history/dates";

/** Dates as the screens show them: medium, in the reader's language. */
export function useDates() {
  const format = useFormatter();
  return {
    /** "2026-11-18" (a calendar day): shown as that day, never shifted by a time zone. */
    day: (date: string) =>
      format.dateTime(new Date(`${date}T00:00:00Z`), {
        dateStyle: "medium",
        timeZone: "UTC",
      }),
    /** An instant (ISO text): the day it was on the company's calendar. */
    moment: (iso: string) =>
      format.dateTime(new Date(iso), {
        dateStyle: "medium",
        timeZone: COMPANY_TIME_ZONE,
      }),
  };
}
