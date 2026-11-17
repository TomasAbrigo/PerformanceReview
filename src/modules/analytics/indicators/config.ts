import type { DbOrTx } from "@/db/client";
import { getSettings } from "@/modules/settings";
import type { IndicatorConfig } from "./types";

/**
 * The thresholds the indicators use, from the settings (`/settings/insights`):
 * `alerts.dropThreshold`, `alerts.riskThreshold` and
 * `aggregation.minGroupSize`; defaults in `src/modules/settings`. `override`
 * replaces some of them for one call (tests, previews).
 */
export async function indicatorConfig(
  db: DbOrTx,
  override: Partial<IndicatorConfig> = {},
): Promise<IndicatorConfig> {
  const settings = await getSettings(db);
  return {
    dropThreshold: settings["alerts.dropThreshold"],
    riskThreshold: settings["alerts.riskThreshold"],
    minGroupSize: settings["aggregation.minGroupSize"],
    ...override,
  };
}
