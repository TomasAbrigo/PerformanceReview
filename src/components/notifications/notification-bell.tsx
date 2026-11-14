import { connection } from "next/server";
import { getActor } from "@/modules/actor/server";
import { getUnreadCount } from "@/modules/notifications/server";
import { NotificationBadge } from "./notification-badge";

/** Header bell of the acting person (server part: loads the unread count). */
export async function NotificationBell() {
  await connection();
  const actor = await getActor();
  return <NotificationBadge count={await getUnreadCount(actor.personId)} />;
}
