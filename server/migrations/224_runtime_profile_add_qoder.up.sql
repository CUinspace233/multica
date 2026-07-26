ALTER TABLE runtime_profile DROP CONSTRAINT IF EXISTS runtime_profile_protocol_family_check;

-- Widen the whitelist to include Qoder so Qoder CN (`qoderclicn`) users can base
-- a custom runtime profile on the existing Qoder backend (launches
-- `<command> --yolo --acp`) instead of misrouting through Kiro/ACP with
-- incompatible arguments (#4883). NOT VALID mirrors migration 126 so a
-- historical Gemini row it intentionally tolerated does not block the upgrade.
--
-- Renumbered from 163 to 224 in the 2026-07-26 upstream sync: 163_agent_builder
-- already existed upstream, so this fork-owned migration had to move. The new
-- prefix changes the schema_migrations key, so the runner will re-apply this on
-- databases that already applied it as 163; the EXCEPTION guard makes that
-- idempotent (mirrors upstream's 164_attachment_task_id IF NOT EXISTS pattern
-- used for the same self-heal reason — see comment in that file).
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