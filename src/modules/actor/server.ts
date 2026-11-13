import { cookies } from "next/headers";
import { ACTOR_COOKIE, type ActorContext, parseActor } from "./types";

/** The current actor (server components and actions); defaults to HR. */
export async function getActor(): Promise<ActorContext> {
  return parseActor((await cookies()).get(ACTOR_COOKIE)?.value);
}
