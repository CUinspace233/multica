-- Multica self-host enterprise fork (CUinspace233/multica)
-- Adds a global superuser flag and a soft-disable timestamp on the user row.
--
-- Multica's `user` table previously had no global admin column — admin powers
-- were scoped per-workspace via the `member` table's role enum (Admin / Member
-- / Owner). For a self-hosted instance managed by a single operator we need a
-- global "is superuser" bit and a way to revoke a user's access without
-- destroying their account (which would cascade-delete their workspace
-- memberships, issues, comments, and chat history).
--
-- Migration conventions follow the upstream pattern in this directory:
--   - up / down are paired and named identically except for the suffix
--   - ALTER TABLE ... ADD COLUMN ... NOT NULL DEFAULT false is safe because
--     the default applies to existing rows on the fly
--   - Partial indexes (WHERE ...) keep the indexes small

ALTER TABLE "user"
    ADD COLUMN is_admin BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN disabled_at TIMESTAMPTZ;

-- Lookups of admin accounts and disabled accounts are rare but need to be
-- fast (the JWT middleware reads is_admin on every authenticated request,
-- the admin UI filters disabled users). Partial indexes keep these cheap.
CREATE INDEX IF NOT EXISTS user_is_admin_idx
    ON "user" (is_admin)
    WHERE is_admin = true;

CREATE INDEX IF NOT EXISTS user_disabled_at_idx
    ON "user" (disabled_at)
    WHERE disabled_at IS NOT NULL;
