import {
  index,
  pgEnum,
  pgTable,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { nominationStatuses } from "../../modules/review-core/peer-settings";
import { person } from "./people";
import { cycleParticipant, reviewCycle } from "./review-cycles";

export const peerNominationStatus = pgEnum(
  "peer_nomination_status",
  nominationStatuses,
);

/** A peer nominated to give feedback to a participant (#14). */
export const peerNomination = pgTable(
  "peer_nomination",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    cycleId: uuid("cycle_id")
      .notNull()
      .references(() => reviewCycle.id, { onDelete: "cascade" }),
    participantId: uuid("participant_id")
      .notNull()
      .references(() => cycleParticipant.id, { onDelete: "cascade" }),
    nomineePersonId: uuid("nominee_person_id")
      .notNull()
      .references(() => person.id),
    /** Null when HR (People, no person) nominated. */
    nominatedByPersonId: uuid("nominated_by_person_id").references(
      () => person.id,
    ),
    status: peerNominationStatus("status").notNull().default("pending"),
    decidedBy: uuid("decided_by").references(() => person.id),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique("peer_nomination_participant_nominee_uq").on(
      t.participantId,
      t.nomineePersonId,
    ),
    index("peer_nomination_cycle_idx").on(t.cycleId, t.status),
  ],
);

export type PeerNomination = typeof peerNomination.$inferSelect;
