ALTER TABLE runtime_profile DROP CONSTRAINT IF EXISTS runtime_profile_protocol_family_check;

-- Restore the pre-432 whitelist (migration 126 shape, without qoder). NOT VALID
-- keeps the historical Gemini tolerance so the rollback cannot fail on old rows.
--
-- Same renumber rationale as 432_runtime_profile_add_qoder.up.sql: the prefix
-- change makes the runner re-apply this down on databases that tracked the old
-- 163 / 224 / 272 prefix; the EXCEPTION guard makes that idempotent.
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
            'antigravity'
        )) NOT VALID;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;