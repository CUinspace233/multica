-- Multica self-host enterprise fork (CUinspace233/multica)
-- SQL for runtime_allowlist. Mirrors the cache in AdminAllowlistHandler.

-- name: ListAllowlistEntries :many
SELECT kind, value, created_at, created_by
FROM runtime_allowlist
ORDER BY kind, value;

-- name: UpsertAllowlistEntry :one
INSERT INTO runtime_allowlist (kind, value, created_by)
VALUES ($1, $2, $3)
ON CONFLICT (kind, value) DO NOTHING
RETURNING kind, value, created_at, created_by;

-- name: DeleteAllowlistEntry :one
DELETE FROM runtime_allowlist
WHERE kind = $1 AND value = $2
RETURNING kind, value;

-- name: SeedAllowlistFromEnv :exec
-- Idempotent: inserts each (kind, value) pair, skipping on conflict.
-- Used at process startup if the runtime_allowlist table is empty so the
-- previous env-driven behavior carries forward across the upgrade.
INSERT INTO runtime_allowlist (kind, value, created_by)
VALUES ($1, $2, NULL)
ON CONFLICT (kind, value) DO NOTHING;

-- name: CountAllowlistByKind :many
SELECT kind, count(*) AS n
FROM runtime_allowlist
GROUP BY kind;