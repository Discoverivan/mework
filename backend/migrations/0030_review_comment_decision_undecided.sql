-- Each saved user turn and AI response advances revision once; a decision adds
-- another revision. Preserve explicit choices and correct only implicit defaults.
UPDATE review_comment_discussions
SET payload_json = json_set(payload_json, '$.decision', 'undecided')
WHERE json_extract(payload_json, '$.decision') = 'original'
  AND json_extract(payload_json, '$.revision') = (
      SELECT COUNT(*) + COALESCE(SUM(json_type(value, '$.assessment') != 'null'), 0)
      FROM json_each(review_comment_discussions.payload_json, '$.turns')
  );
