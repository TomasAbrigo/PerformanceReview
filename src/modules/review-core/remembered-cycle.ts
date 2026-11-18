import { cookies } from "next/headers";
import { CYCLE_COOKIE } from "./current-cycle";

/**
 * The cycle last chosen in any screen (server components): what a screen
 * opens on when its URL names none (`pickCycle`). The cookie is written by
 * `CycleMemory` in the layout.
 */
export async function rememberedCycle(): Promise<string | undefined> {
  return (await cookies()).get(CYCLE_COOKIE)?.value || undefined;
}
