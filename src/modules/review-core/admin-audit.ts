import { aliasedTable, and, desc, eq, sql } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import { adminAuditLog, person } from "@/db/schema";
import type { ActorContext } from "@/modules/actor/types";
import { isUuid } from "@/lib/uuid";
import {
  type AdminAction,
  adminActions,
  type AdminTargetType,
  type AuditSnapshot,
} from "./ops-constants";
import { OpsError } from "./ops-errors";

export type AuditEntry = {
  actorPersonId: string | null;
  action: AdminAction;
  targetType: AdminTargetType;
  targetId: string;
  cycleId: string;
  before?: AuditSnapshot | null;
  after?: AuditSnapshot | null;
  note?: string | null;
};

/**
 * Writes one admin_audit_log row. Call it with the transaction that makes
 * the change, so the action and its record commit (or roll back) together.
 */
export async function audit(tx: DbOrTx, entry: AuditEntry): Promise<void> {
  await tx.insert(adminAuditLog).values({
    actorPersonId: entry.actorPersonId,
    action: entry.action,
    targetType: entry.targetType,
    targetId: entry.targetId,
    cycleId: entry.cycleId,
    before: entry.before ?? null,
    after: entry.after ?? null,
    note: entry.note?.trim() || null,
  });
}

export type AuditLogItem = {
  id: string;
  action: AdminAction;
  targetType: AdminTargetType;
  targetId: string;
  actorPersonId: string | null;
  actorName: string | null;
  /** The reviewee the target is about (participant/request targets). */
  targetLabel: string | null;
  before: AuditSnapshot | null;
  after: AuditSnapshot | null;
  note: string | null;
  createdAt: Date;
};

/** The audit log of a cycle, newest first (HR only), optionally by action. */
export async function listAuditLog(
  db: DbOrTx,
  actor: ActorContext,
  cycleId: string,
  filter: { action?: AdminAction } = {},
): Promise<AuditLogItem[]> {
  if (actor.role !== "hr") throw new OpsError("forbidden");
  if (!isUuid(cycleId)) return [];
  if (filter.action && !adminActions.includes(filter.action)) {
    throw new OpsError("validation", [{ path: "action", message: "invalid" }]);
  }
  const who = aliasedTable(person, "actor");
  return db
    .select({
      id: adminAuditLog.id,
      action: adminAuditLog.action,
      targetType: adminAuditLog.targetType,
      targetId: adminAuditLog.targetId,
      actorPersonId: adminAuditLog.actorPersonId,
      actorName: who.displayName,
      targetLabel: sql<string | null>`case ${adminAuditLog.targetType}
        when 'participant' then (select p.display_name
          from cycle_participant cp join person p on p.id = cp.reviewee_person_id
          where cp.id = ${adminAuditLog.targetId})
        when 'request' then (select p.display_name
          from review_request rr
          join cycle_participant cp on cp.id = rr.participant_id
          join person p on p.id = cp.reviewee_person_id
          where rr.id = ${adminAuditLog.targetId})
        else null end`,
      before: adminAuditLog.before,
      after: adminAuditLog.after,
      note: adminAuditLog.note,
      createdAt: adminAuditLog.createdAt,
    })
    .from(adminAuditLog)
    .leftJoin(who, eq(who.id, adminAuditLog.actorPersonId))
    .where(
      and(
        eq(adminAuditLog.cycleId, cycleId),
        filter.action ? eq(adminAuditLog.action, filter.action) : undefined,
      ),
    )
    .orderBy(desc(adminAuditLog.createdAt), desc(adminAuditLog.id));
}
