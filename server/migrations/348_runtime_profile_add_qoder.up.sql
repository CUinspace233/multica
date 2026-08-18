ALTER TABLE runtime_profile DROP CONSTRAINT IF EXISTS runtime_profile_protocol_family_check;

-- Widen the whitelist to include Qoder so Qoder CN (`qoderclicn`) users can base
-- a custom runtime profile on the existing Qoder backend (launches
-- `<command> --yolo --acp`) instead of misrouting through Kiro/ACP with
-- incompatible arguments (#4883). NOT VALID mirrors migration 126 so a
-- historical Gemini row it intentionally tolerated does not block the upgrade.
--
-- Renumbered from 163 → 224 → 272 → 348 across the four weekly upstream syncs
-- (2026-07-12, 2026-07-26, 2026-08-10, 2026-08-18) because each sync upstream
-- landed its own 224_agent_task_session_rollout_missing, 272_rollup_task_usage_
-- hourly_xact_lock, etc. that occupied the fork-owned slot. The prefix
-- changes the schema_migrations key, so the runner re-applies this on
-- databases that already applied it as 163 / 224 / 272; the EXCEPTION guard
-- makes that idempotent (mirrors upstream's 164_attachment_task_id IF NOT
-- EXISTS pattern used for the same self-heal reason — see comment in that
-- file).
DO $$
BEGIN
    ALTER TABLE runtime_profile ADD CONSTRAINT runtime_profile_protocol_family_check
        CHECK (protocol_family IN (
            'claude',
            'codebuddy',
            'codex',
            'copilot',
            'opencode',
            'openclaw',
            'hermes',
            'pi',
            'cursor',
            'kimi',
            'kiro',
            'antigravity',
            'qoder'
        )) NOT VALID;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;