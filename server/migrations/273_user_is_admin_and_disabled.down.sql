-- Reverse 273_user_is_admin_and_disabled (renumbered 164 → 225 → 273 across
-- the 2026-07-26 and 2026-08-10 upstream syncs; see 273_user_is_admin_and_disabled.up.sql)

DROP INDEX IF EXISTS user_disabled_at_idx;
DROP INDEX IF EXISTS user_is_admin_idx;

ALTER TABLE "user"
    DROP COLUMN IF EXISTS disabled_at,
    DROP COLUMN IF EXISTS is_admin;
