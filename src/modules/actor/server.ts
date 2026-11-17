import { cookies } from "next/headers";
import { isHr } from "./access";
import { ACTOR_COOKIE, type ActorContext, parseActor } from "./types";

/** The current actor (server components and actions); defaults to HR. */
export async function getActor(): Promise<ActorContext> {
  return parseActor((await cookies()).get(ACTOR_COOKIE)?.value);
}

/** Whether the current actor is People (HR). */
export async function actorIsHr(): Promise<boolean> {
  return isHr(await getActor());
}

/**
 * Runs a server action of a People-only screen (imports, data quality,
 * settings) for HR; anyone else gets a `forbidden` outcome and `run` never
 * starts. The page is gated too (`HrOnly`), this covers the action itself,
 * which can be called without opening the page.
 */
export async function onlyHr<R>(run: () => Promise<R>): Promise<
  | R
  | {
      ok: false;
      code: "forbidden";
      message: string;
      issues: never[];
    }
> {
  if (!(await actorIsHr())) {
    return {
      ok: false,
      code: "forbidden",
      message: "Only People (HR) may do this",
      issues: [],
    };
  }
  return run();
}
