# Hand-maintained SQL in Drizzle migrations

drizzle-kit does not generate views. They are appended by hand to the
generated migration that introduces them (after a `--> statement-breakpoint`):

| View               | Migration                  | Reference copy                     | Query declaration  |
| ------------------ | -------------------------- | ---------------------------------- | ------------------ |
| `v_current_rating` | `drizzle/0016_calibration.sql` | `src/db/sql/v_current_rating.sql` | `src/db/views.ts` |

To change a view, write a new migration (`pnpm db:generate --custom`) with
`CREATE OR REPLACE VIEW`, update the reference copy, and keep the DB test in
`src/modules/review-core/calibration.db.test.ts` (columns of the view) green.
