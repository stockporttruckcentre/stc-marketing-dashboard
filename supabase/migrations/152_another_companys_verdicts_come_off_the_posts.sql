-- =============================================================
-- 152. Another company's compliance verdicts come off the posts.
--
-- From the business, with a screenshot of a scheduled post still
-- reading "US English. STC and Frame use American spelling throughout."
--
--   why does the app still say this, you put 6 agents on finding all
--   traces of Frame and removing it then confirmed it was done. Did you
--   never commit it?
--
-- It was committed. `lib/platform/compliance/copy-lint.ts` went on 16
-- September and `npm run check:not-ours` has guarded the repository
-- ever since. 783 files, no hits.
--
-- What was missed is that the thing had already RUN. Its verdicts were
-- sitting in `social_posts.lint_findings`, which is what the post
-- detail draws. Removing the producer and leaving its output on the
-- screen is not removing it, and the check could not have caught it
-- because a check that reads the repository cannot see the database.
--
-- Four posts carried verdicts, written on 1 and 16 September. One, a
-- scheduled post about the O-Licence, said it twice and offered to
-- change Licence to license and surprises to surprizes, which is not a
-- word in any English.
--
-- NOTHING IS LOST. `social_posts_lint_before_removal` keeps the four
-- rows. No post's own words are touched: caption, images, channels and
-- schedule are exactly as they were. Only the verdict is cleared.
-- =============================================================

CREATE TABLE IF NOT EXISTS social_posts_lint_before_removal AS
  SELECT id, status, lint_severity, lint_findings, lint_hash, lint_checked_at, now() AS saved_at
    FROM social_posts
   WHERE lint_findings IS NOT NULL OR lint_severity IS NOT NULL
      OR lint_hash IS NOT NULL OR lint_checked_at IS NOT NULL;

UPDATE social_posts
   SET lint_findings   = NULL,
       lint_severity   = NULL,
       lint_hash       = NULL,
       lint_checked_at = NULL
 WHERE lint_findings IS NOT NULL
    OR lint_severity IS NOT NULL
    OR lint_hash IS NOT NULL
    OR lint_checked_at IS NOT NULL;

COMMENT ON COLUMN social_posts.lint_findings IS
  'Dead. Held the findings of another company''s compliance policy, which was '
  'removed from the application on 16 September. Nothing writes this. The last '
  'values are kept in social_posts_lint_before_removal.';
