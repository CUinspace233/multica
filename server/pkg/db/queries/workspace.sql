-- name: ListWorkspaces :many
SELECT w.id, w.name, w.slug, w.description, w.settings,
       w.created_at, w.updated_at, w.context, w.repos,
       w.issue_prefix, w.issue_counter, w.avatar_url
FROM member m
JOIN workspace w ON w.id = m.workspace_id
WHERE m.user_id = $1
ORDER BY w.created_at ASC;

-- name: GetWorkspace :one
SELECT * FROM workspace
WHERE id = $1;

-- name: GetWorkspaceBySlug :one
SELECT * FROM workspace
WHERE slug = $1;

-- name: CreateWorkspace :one
INSERT INTO workspace (name, slug, description, context, issue_prefix)
VALUES ($1, $2, $3, $4, $5)
RETURNING *;

-- name: UpdateWorkspace :one
UPDATE workspace SET
    name = COALESCE(sqlc.narg('name'), name),
    description = COALESCE(sqlc.narg('description'), description),
    context = COALESCE(sqlc.narg('context'), context),
    settings = COALESCE(sqlc.narg('settings'), settings),
    repos = COALESCE(sqlc.narg('repos'), repos),
    issue_prefix = COALESCE(sqlc.narg('issue_prefix'), issue_prefix),
    avatar_url = COALESCE(sqlc.narg('avatar_url'), avatar_url),
    updated_at = now()
WHERE id = $1
RETURNING *;

-- name: ListWorkspacesWithRepos :many
-- Workspaces with a non-empty repo registry, to route a webhook to the repo's
-- owning workspace. ORDER BY id keeps the resolver's tie-break stable on replay.
SELECT id, repos FROM workspace
WHERE repos IS NOT NULL AND repos <> '[]'::jsonb
ORDER BY id;

-- name: IncrementIssueCounter :one
UPDATE workspace SET issue_counter = issue_counter + 1
WHERE id = $1
RETURNING issue_counter;

-- name: DeleteWorkspace :exec
WITH deleted_pending_check_suites AS (
    DELETE FROM github_pending_check_suite WHERE workspace_id = $1
)
DELETE FROM workspace WHERE id = $1;

-- =============================================================================
-- Enterprise fork (CUinspace233/multica): global admin queries.
-- =============================================================================

-- name: ListAllWorkspacesAdmin :many
-- Lists every workspace across all users for the admin dashboard,
-- newest first, plus the member count for each. The admin UI uses
-- this to render the workspaces table. Pagination handled in the
-- handler.
SELECT
    w.id, w.name, w.slug, w.description, w.created_at, w.updated_at,
    w.issue_prefix, w.issue_counter, w.avatar_url,
    (SELECT count(*)::bigint FROM member m WHERE m.workspace_id = w.id) AS member_count
FROM workspace w
ORDER BY w.created_at DESC
LIMIT $1 OFFSET $2;

-- name: CountAllWorkspaces :one
SELECT count(*)::bigint FROM workspace;
