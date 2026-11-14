import { z } from "zod";
import { isUuid } from "@/lib/uuid";
import { parseIsoDate } from "@/modules/org-history/dates";

/** Query-parameter schemas shared by the JSON endpoints and the CSV exports. */
export const uuid = z.string().refine(isUuid, "must be a uuid");

export const isoDate = z
  .string()
  .refine(
    (v) => parseIsoDate(v) !== null,
    "must be a calendar date, YYYY-MM-DD",
  );

export const bool = z.enum(["true", "false"]).transform((v) => v === "true");
