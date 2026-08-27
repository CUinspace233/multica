-- Drop the comment.workspace_id supporting btree index (MUL-4059).
-- The search handler's WHERE clause will still work without it — the
-- planner will just fall back to a Seq Scan on `comment` filtered by
-- workspace_id, which is the pre-migration-135 behavior. Only run this
-- down migration if operating below the query-rewrite change; otherwise
-- expect search latency to regress.
--
-- Renumbered alongside 434_comment_workspace_index.up.sql
-- (135 → 226 → 274 → 434 across the 2026-07-26, 2026-08-10 and
-- 2026-08-25 upstream syncs).

DROP INDEX CONCURRENTLY IF EXISTS idx_comment_workspace;
