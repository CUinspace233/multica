-- Multica self-host enterprise fork (CUinspace233/multica)
-- Runtime-mutable email / domain allowlist for the signup gate.
--
-- Multica's signup gate (server/internal/handler/auth.go:checkSignupAllowed)
-- previously read ALLOWED_EMAILS / ALLOWED_EMAIL_DOMAINS only at process
-- start from os.Getenv. Operators had to edit /opt/multica/.env and restart
-- the backend container to admit a new email. That's fine for a private
-- instance with one admin; it's intolerable once you're shipping the
-- enterprise fork and want to let the on-call admin hand out access without
-- a deploy.
--
-- We keep the env vars as the seed: on first boot the backend reads the
-- table; if it's empty, it copies the env entries into the table so the
-- current env-driven behavior is preserved across the upgrade. Operators
-- can then add / remove entries via the /admin Access tab.
--
-- Model: one row per (kind, value). `kind` is a CHECK enum so emails and
-- domains can't collide in the primary key, and so a future 'pattern' or
-- 'group' kind can extend the gate without a schema change. `value` is
-- stored lowercased; the admin handler normalizes before insert so case
-- differences never produce duplicate rows.

CREATE TABLE IF NOT EXISTS runtime_allowlist (
    kind        TEXT        NOT NULL CHECK (kind IN ('email', 'domain')),
    value       TEXT        NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by  UUID        REFERENCES "user"(id) ON DELETE SET NULL,
    PRIMARY KEY (kind, value)
);

-- `created_by` is nullable so seed-from-env rows (which have no human
-- attribution) fit. The index speeds the admin UI's "added by me" filter
-- once that exists; for now the table is small enough that the lookup is
-- sequential. Add it only if profiling justifies it.

COMMENT ON TABLE runtime_allowlist IS
    'Runtime-mutable signup allowlist. Cache-warmed into AdminAllowlistHandler on startup; mirrored back here on Add/Remove.';