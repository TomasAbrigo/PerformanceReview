import { connection } from "next/server";
import { db } from "@/db/client";
import { setActorAction } from "@/modules/actor/actions";
import { getActor } from "@/modules/actor/server";
import { listPeople } from "@/modules/people/queries";
import { personName } from "@/modules/review-core";
import { ActorSelector } from "./actor-selector";

/** Header bar with the "act as" selector (server part: loads people). */
export async function ActorBar() {
  await connection();
  const actor = await getActor();
  const [people, actorName] = await Promise.all([
    listPeople(db),
    personName(db, actor.personId),
  ]);
  return (
    <ActorSelector
      key={`${actor.personId}-${actor.role}`}
      actor={actor}
      actorName={actorName}
      people={people.map((p) => ({ id: p.id, displayName: p.displayName }))}
      setActor={setActorAction}
    />
  );
}
