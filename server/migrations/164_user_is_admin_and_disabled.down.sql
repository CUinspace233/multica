-- Reverse 164_user_is_admin_and_disabled

DROP INDEX IF EXISTS user_disabled_at_idx;
DROP INDEX IF EXISTS user_is_admin_idx;

ALTER TABLE "user"
    DROP COLUMN IF EXISTS disabled_at,
    DROP COLUMN IF EXISTS is_admin;
