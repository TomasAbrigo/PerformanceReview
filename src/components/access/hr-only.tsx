import type { ReactNode } from "react";
import { isHr } from "@/modules/actor/access";
import { getActor } from "@/modules/actor/server";
import { NoAccess } from "./no-access";

/**
 * Gate of the People-only screens (imports, data quality, settings): its
 * children only render, and so only load their data, for HR. Reads the actor
 * (cookie), so it goes inside the page's Suspense.
 */
export async function HrOnly({ children }: { children: ReactNode }) {
  return isHr(await getActor()) ? children : <NoAccess />;
}
