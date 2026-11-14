import { connection } from "next/server";
import { db } from "@/db/client";
import { getActor } from "@/modules/actor/server";
import { unreadCount } from "@/modules/notifications";
import { NotificationBadge } from "./notification-badge";

/** Header bell of the acting person (server part: loads the unread count). */
export async function NotificationBell() {
  await connection();
  const actor = await getActor();
  return <NotificationBadge count={await unreadCount(db, actor)} />;
}
