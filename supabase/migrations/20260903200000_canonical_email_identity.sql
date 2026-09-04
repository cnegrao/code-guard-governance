-- =============================================================================
-- CODEGUARD AI GOVERNANCE OS
-- Migration: Email Canonical Identity Enforcement
-- Purpose: Establish fail-closed canonical email identity: lower(btrim(email))
-- Sequence:
--   A. PREFLIGHT: Detect duplicate canonical identities; RAISE if collision exists
--   B. NORMALIZE: Update existing non-canonical values (only if collision-free)
--   C. INVARIANT: Enforce future canonical storage via CHECK constraint
--
-- FAIL CLOSED: If any preflight check fails, migration aborts completely.
-- NO automatic merge. NO winner selection. NO silent repair.
-- =============================================================================

DO $$
DECLARE
  collision_count INTEGER;
  collision_record RECORD;
BEGIN
  -- ===========================================================================
  -- A. PREFLIGHT: Detect duplicate canonical identities
  -- ===========================================================================
  RAISE NOTICE '[Canonical Email] Phase A: Preflight collision detection';

  SELECT COUNT(*) INTO collision_count
  FROM (
    SELECT lower(trim(both from email)) as canonical_email
    FROM gov_repo.governance_users
    WHERE email IS NOT NULL
    GROUP BY lower(trim(both from email))
    HAVING count(*) > 1
  ) duplicates;

  IF collision_count > 0 THEN
    RAISE NOTICE '[Canonical Email] Found % canonical collision(s). ABORTING migration.', collision_count;

    FOR collision_record IN
      SELECT
        lower(trim(both from email)) as canonical_email,
        array_agg(email) as conflicting_emails,
        count(*) as conflict_count
      FROM gov_repo.governance_users
      WHERE email IS NOT NULL
      GROUP BY lower(trim(both from email))
      HAVING count(*) > 1
    LOOP
      RAISE NOTICE '[Canonical Email] Collision: % -> % values: %',
        collision_record.canonical_email,
        collision_record.conflict_count,
        collision_record.conflicting_emails;
    END LOOP;

    RAISE EXCEPTION 'Canonical email preflight failed: % collision(s) detected. Manual resolution required BEFORE this migration can run.', collision_count;
  END IF;

  RAISE NOTICE '[Canonical Email] Phase A: PASSED - No canonical collisions detected';

  -- ===========================================================================
  -- B. NORMALIZE: Update existing non-canonical values
  -- ===========================================================================
  RAISE NOTICE '[Canonical Email] Phase B: Normalizing existing non-canonical emails';

  UPDATE gov_repo.governance_users
  SET email = lower(trim(both from email))
  WHERE email IS DISTINCT FROM lower(trim(both from email));

  GET DIAGNOSTICS collision_count = ROW_COUNT;
  RAISE NOTICE '[Canonical Email] Phase B: Normalized % row(s) to canonical form', collision_count;

  -- ===========================================================================
  -- C. DATABASE INVARIANT: CHECK constraint for future canonical storage
  -- ===========================================================================
  RAISE NOTICE '[Canonical Email] Phase C: Adding CHECK constraint for canonical identity invariant';

  -- First check if constraint already exists to avoid errors in idempotent scripts
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'governance_users_email_canonical_check'
  ) THEN
    ALTER TABLE gov_repo.governance_users
    ADD CONSTRAINT governance_users_email_canonical_check
    CHECK (email = lower(trim(both from email)));

    RAISE NOTICE '[Canonical Email] Phase C: Added CHECK constraint governance_users_email_canonical_check';
  ELSE
    RAISE NOTICE '[Canonical Email] Phase C: CHECK constraint already exists, skipping';
  END IF;

  RAISE NOTICE '[Canonical Email] Migration completed SUCCESSFULLY';
END $$;

-- =============================================================================
-- Validation: Verify constraint and uniqueness together ensure canonical identity
-- =============================================================================
-- After this migration:
--   1. UNIQUE(email) on canonical values = canonical uniqueness
--   2. CHECK(email = lower(btrim(email))) = future writes must be canonical
--   3. Preflight prevented mixed-case duplicates from coexisting after normalize
--
-- Test cases proven by architecture:
--   'USER@EXAMPLE.COM'  -> constraint violation (unless already canonical)
--   'User@Example.Com'   -> constraint violation (unless already canonical)
--   ' user@example.com'  -> constraint violation (unless already canonical)
--   'user@example.com'   -> valid, unique via existing UNIQUE constraint
-- =============================================================================
