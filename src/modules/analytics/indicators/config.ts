import type { DbOrTx } from "@/db/client";
import type { IndicatorConfig } from "./types";

/** Defaults of the thresholds (PRD): a fall of 2, a risk at 2, groups of 5. */
export const DEFAULT_INDICATOR_CONFIG: IndicatorConfig = {
  dropThreshold: 2,
  riskThreshold: 2,
  minGroupSize: 5,
};

/**
 * The thresholds the indicators use. `override` replaces some of them for one
 * call (tests, previews).
 *
 * TODO(#56): read `alerts.dropThreshold`, `alerts.riskThreshold` and
 * `aggregation.minGroupSize` with `getSetting(db, key)` (src/modules/settings)
 * once the settings module lands; until then these are the constants above.
 */
export async function indicatorConfig(
  _db: DbOrTx,
  override: Partial<IndicatorConfig> = {},
): Promise<IndicatorConfig> {
  return { ...DEFAULT_INDICATOR_CONFIG, ...override };
}
