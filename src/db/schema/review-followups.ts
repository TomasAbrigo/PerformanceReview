import { index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { person } from "./people";
import { cycleParticipant } from "./review-cycles";

/**
 * Follow-up notes a manager (or People) writes about a participant after the
 * review conversation (agreements, next steps). Append-only: the domain has
 * no edit or delete; they are listed newest first and are visible to the
 * reviewee once their manager review is shared.
 */
export const followUpNote = pgTable(
  "follow_up_note",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    participantId: uuid("participant_id")
      .notNull()
      .references(() => cycleParticipant.id, { onDelete: "cascade" }),
    /** Null when People wrote it without acting as a person. */
    authorPersonId: uuid("author_person_id").references(() => person.id),
    body: text("body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("follow_up_note_participant_idx").on(t.participantId, t.createdAt),
  ],
);

export type FollowUpNoteRow = typeof followUpNote.$inferSelect;
