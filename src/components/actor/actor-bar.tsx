import { connection } from "next/server";
import { db } from "@/db/client";
import { setActorAction } from "@/modules/actor/actions";
import { listActorOptions } from "@/modules/actor/queries";
import { getActor } from "@/modules/actor/server";
import { personName } from "@/modules/review-core";
import { ActorSelector } from "./actor-selector";

/** Header bar with the "act as" selector (server part: loads people). */
export async function ActorBar() {
  await connection();
  const actor = await getActor();
  const [people, actorName] = await Promise.all([
    listActorOptions(db),
    personName(db, actor.personId),
  ]);
  return (
    <ActorSelector
      key={`${actor.personId}-${actor.role}`}
      actor={actor}
      actorName={actorName}
      people={people}
      setActor={setActorAction}
    />
  );
}
