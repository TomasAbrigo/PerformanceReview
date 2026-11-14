-- Current rating per participant (reference copy; applied in drizzle/0016_calibration.sql).
-- Precedence: override > calibrated > manager > computed; within a stage the latest row wins.
CREATE VIEW "v_current_rating" AS
SELECT DISTINCT ON ("participant_id")
  "id", "participant_id", "stage", "option_value", "option_label", "normalized",
  "actor_person_id", "reason", "flagged", "created_at"
FROM "final_rating"
ORDER BY "participant_id",
  CASE "stage" WHEN 'override' THEN 4 WHEN 'calibrated' THEN 3 WHEN 'manager' THEN 2 ELSE 1 END DESC,
  "created_at" DESC, "id" DESC;
