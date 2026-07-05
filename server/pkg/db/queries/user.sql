-- name: GetUser :one
SELECT * FROM "user"
WHERE id = $1;

-- name: GetUserByEmail :one
SELECT * FROM "user"
WHERE email = $1;

-- name: CreateUser :one
INSERT INTO "user" (name, email, avatar_url)
VALUES ($1, $2, $3)
RETURNING *;

-- name: UpdateUser :one
-- Patches the user-controlled profile fields. Each parameter follows
-- COALESCE-on-NULL semantics so the handler can omit any field it
-- doesn't intend to write.
--
-- `timezone` (Viewing-tz preference) participates in
-- the same shape but uses sqlc.narg + a sentinel-string convention:
-- the handler passes the empty string "" to mean "clear back to NULL"
-- (browser-detected fallback), an IANA name like "Asia/Shanghai" to
-- pin a value, and `sqlc.narg('timezone') IS NULL` (no value at all)
-- to leave the existing column untouched. Folding it into UpdateUser
-- rather than carrying a dedicated UpdateUserTimezone keeps the
-- profile-patch shape uniform between Preferences fields.
UPDATE "user" SET
    name = COALESCE($2, name),
    avatar_url = COALESCE($3, avatar_url),
    language = COALESCE($4, language),
    profile_description = COALESCE(sqlc.narg('profile_description'), profile_description),
    timezone = CASE
        WHEN sqlc.narg('timezone')::text IS NULL THEN timezone
        WHEN sqlc.narg('timezone')::text = ''    THEN NULL
        ELSE sqlc.narg('timezone')::text
    END,
    updated_at = now()
WHERE id = $1
RETURNING *;

-- name: MarkUserOnboarded :one
UPDATE "user" SET
    onboarded_at = COALESCE(onboarded_at, now()),
    updated_at = now()
WHERE id = $1
RETURNING *;

-- name: PatchUserOnboarding :one
-- Partial update of the user's onboarding decision fields. Currently only the
-- questionnaire JSONB is patchable — the v2 attempt at persisting Step 3
-- runtime choice on the user row was reverted; that state now lives in a
-- frontend Zustand transient store.
UPDATE "user" SET
    onboarding_questionnaire = COALESCE(sqlc.narg('questionnaire'), onboarding_questionnaire),
    updated_at = now()
WHERE id = sqlc.arg('id')
RETURNING *;

-- name: JoinCloudWaitlist :one
-- Records interest in cloud runtimes. Does NOT mark onboarding
-- complete — the user still has to pick a real path (CLI / Skip)
-- in Step 3. Repeating the call overwrites email + reason.
UPDATE "user" SET
    cloud_waitlist_email = $2,
    cloud_waitlist_reason = $3,
    updated_at = now()
WHERE id = $1
RETURNING *;

-- name: SetStarterContentState :one
-- Atomically transition starter_content_state. The handler is
-- responsible for checking the current value first (to decide between
-- "transition NULL -> imported and run the seeding" vs "already
-- decided, short-circuit"). Using COALESCE here would swallow the
-- transition, so this is a straight assignment.
UPDATE "user" SET
    starter_content_state = $2,
    updated_at = now()
WHERE id = $1
RETURNING *;

-- =============================================================================
-- Enterprise fork (CUinspace233/multica): global superuser queries.
-- The `user.is_admin` and `user.disabled_at` columns are added by
-- migration 134. Upstream multica only has per-workspace admin roles
-- (see server/pkg/db/queries/member.sql) — these queries let a global
-- admin list/manage all users across workspaces.
-- =============================================================================

-- name: ListAllUsersAdmin :many
-- Lists every user in the database, newest first, paginated. The admin
-- UI uses this to render the users table. Caller passes an inclusive
-- LIMIT (defaults applied in the handler) and OFFSET (clamped to the
-- count). No filtering yet — search-by-email will land in a follow-up.
SELECT * FROM "user"
ORDER BY created_at DESC
LIMIT $1 OFFSET $2;

-- name: CountAllUsers :one
SELECT count(*)::bigint FROM "user";

-- name: SetUserAdmin :one
-- Promotes or demotes a user to/from the global superuser role. Used by
-- the admin UI "Make admin" / "Remove admin" buttons, and also kept
-- available for SQL-only one-off promotes during initial setup. The
-- handler additionally enforces that the *caller* is already an admin
-- (RequireSuperuser middleware) before reaching this query.
UPDATE "user" SET
    is_admin = $2,
    updated_at = now()
WHERE id = $1
RETURNING *;

-- name: SetUserDisabled :one
-- Soft-disables a user account. When $2 is true, sets disabled_at to
-- the current time; when false, clears it. The middleware reads
-- disabled_at and rejects requests with 403 if it's set, but disabling
-- does NOT delete the row — the user's workspaces, issues, comments,
-- and chat history stay intact. Revoking all session cookies is the
-- handler's job (it walks the auth_session table; see also the
-- `auth_session` cleanup hook in the admin handler).
UPDATE "user" SET
    disabled_at = CASE WHEN $2 THEN now() ELSE NULL END,
    updated_at = now()
WHERE id = $1
RETURNING *;

-- name: GetUserByIDAdmin :one
-- Single-row lookup, identical to GetUser but scoped to the admin
-- handler path so the call site signals intent. Same row shape.
SELECT * FROM "user"
WHERE id = $1;

-- name: AdminSearchUsers :many
-- Case-insensitive substring search across name and email. The admin
-- UI search box hits this with LIMIT 50 hard-capped.
SELECT * FROM "user"
WHERE name ILIKE '%' || $1 || '%' OR email ILIKE '%' || $1 || '%'
ORDER BY created_at DESC
LIMIT $2;
