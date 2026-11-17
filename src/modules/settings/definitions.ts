// Drizzle- and server-free: shared by the service, the authorization module
// and the settings screen.
import { z } from "zod";
import type { FieldIssue } from "@/lib/domain-error";

/** The allowed range (inclusive) of each numeric setting; the form shows it. */
export const settingRanges = {
  "alerts.dropThreshold": { min: 1, max: 4 },
  "alerts.riskThreshold": { min: 1, max: 4 },
  "aggregation.minGroupSize": { min: 2, max: 100 },
  "semester.ambiguityDays": { min: 0, max: 60 },
} as const;

/** An integer in the key's range; issue codes the UI translates. */
const int = (key: keyof typeof settingRanges) =>
  z
    .number({ error: "invalid_number" })
    .int({ error: "invalid_number" })
    .min(settingRanges[key].min, { error: "out_of_range" })
    .max(settingRanges[key].max, { error: "out_of_range" });

/**
 * A day of the year as "MM-DD" that exists every year: 29 February is out,
 * a semester cannot start on a day that is missing in most years.
 */
const monthDay = z
  .string({ error: "invalid_day" })
  .regex(/^\d{2}-\d{2}$/, { error: "invalid_day" })
  .refine(
    (value) => {
      const [month, day] = value.split("-").map(Number);
      const date = new Date(Date.UTC(2023, month - 1, day));
      return date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
    },
    { error: "invalid_day" },
  );

export const analysisProviders = ["mock", "anthropic"] as const;

/**
 * Every setting of the insights module: its validation and its default. The
 * defaults live here, in code: `app_setting` only stores what People changed.
 */
export const settingDefinitions = {
  /** An alert fires when an indicator drops this many points between cycles. */
  "alerts.dropThreshold": { schema: int("alerts.dropThreshold"), default: 2 },
  /** Risk: retention and engagement both at or under this value (Likert 1-5). */
  "alerts.riskThreshold": { schema: int("alerts.riskThreshold"), default: 2 },
  /** Smallest group (n) a Direction view may show; smaller ones are folded. */
  "aggregation.minGroupSize": {
    schema: int("aggregation.minGroupSize"),
    default: 5,
  },
  /** First semester starts on this day of the year ("MM-DD"). */
  "semester.h1Start": { schema: monthDay, default: "03-29" },
  /** Second semester starts on this day of the year ("MM-DD"). */
  "semester.h2Start": { schema: monthDay, default: "09-29" },
  /** An assessment this many days from a semester cut is ambiguous. */
  "semester.ambiguityDays": {
    schema: int("semester.ambiguityDays"),
    default: 15,
  },
  /** Which qualitative-analysis provider runs. */
  "analysis.provider": {
    schema: z.enum(analysisProviders, { error: "invalid_choice" }),
    default: "mock",
  },
  /**
   * Also label the answers to closed questions that belong to a dimension
   * (their chosen option's label), not only the open-text comments.
   */
  "analysis.includeClosed": {
    schema: z.boolean({ error: "invalid_choice" }),
    default: true,
  },
} as const;

export type SettingDefinitions = typeof settingDefinitions;
export type SettingKey = keyof SettingDefinitions;
export type SettingValue<K extends SettingKey> = z.infer<
  SettingDefinitions[K]["schema"]
>;
export type Settings = { [K in SettingKey]: SettingValue<K> };

export const settingKeys = Object.keys(settingDefinitions) as SettingKey[];

export const isSettingKey = (key: string): key is SettingKey =>
  Object.hasOwn(settingDefinitions, key);

export const DEFAULT_SETTINGS = Object.fromEntries(
  settingKeys.map((key) => [key, settingDefinitions[key].default]),
) as Settings;

export type ParsedSetting<K extends SettingKey> =
  | { success: true; data: SettingValue<K> }
  | { success: false; issues: { message: string }[] };

/** Validates one value against its key's schema. */
export function parseSettingValue<K extends SettingKey>(
  key: K,
  value: unknown,
): ParsedSetting<K> {
  const result = settingDefinitions[key].schema.safeParse(value);
  if (result.success) {
    return { success: true, data: result.data as SettingValue<K> };
  }
  return {
    success: false,
    issues: result.error.issues.map((issue) => ({ message: issue.message })),
  };
}

/** Rules between settings (each value is valid alone, together they may not be). */
export function checkSettings(settings: Settings): FieldIssue[] {
  const issues: FieldIssue[] = [];
  if (settings["semester.h1Start"] >= settings["semester.h2Start"]) {
    issues.push({ path: "semester.h2Start", message: "semester_order" });
  }
  return issues;
}
