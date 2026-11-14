import { cache } from "react";
import { db } from "@/db/client";
import { unreadCount } from "./service";

/**
 * The unread count of a person, computed once per request: the header bell
 * and the pages that show it (/me) share the result of the same render.
 */
export const getUnreadCount = cache((personId: string | null) =>
  unreadCount(db, { personId }),
);
