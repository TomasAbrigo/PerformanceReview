-- #130: the option label of an imported Likert answer (retention, engagement,
-- valued) held Bamboo's text as it came, which can name the reviewee
-- ("I would try to convince them to stay. <Name> would be difficult to
-- replace"). Mapped answers get the canonical label of their value instead
-- (`storedLikertLabel`, src/modules/likert): it maps back to the same value,
-- so re-applying the equivalences keeps working. Letters and numbers (the
-- legacy report) carry no names and stay as they are.
UPDATE "answer" AS a
SET "option_label" = CASE q."role"
    WHEN 'retention' THEN (ARRAY[
      'I would be relieved.',
      'I would wish them well.',
      'I would think about it, but I would be okay either way.',
      'I would try to convince them to stay.',
      'I would do everything I can to keep them.'
    ])[a."option_value"]
    WHEN 'engagement' THEN (ARRAY[
      'Not engaged at all and a negative attitude.',
      'Low engagement and a poor attitude.',
      'Medium engagement and an okay attitude.',
      'Engaged and a good attitude.',
      'Highly engaged and a great attitude.'
    ])[a."option_value"]
    WHEN 'valued' THEN (ARRAY[
      'I don''t feel valued.',
      'I''m not sure others value me.',
      'I sometimes feel valued.',
      'I feel I am highly valued.'
    ])[a."option_value"]
  END
FROM "question_revision" AS q
WHERE q."id" = a."question_revision_id"
  AND q."role" IN ('retention', 'engagement', 'valued')
  AND a."option_value" BETWEEN 1 AND (CASE WHEN q."role" = 'valued' THEN 4 ELSE 5 END)
  AND a."option_label" IS NOT NULL
  AND a."option_label" !~ '^[A-Za-z]$'
  AND a."option_label" !~ '^[0-9]+$';
