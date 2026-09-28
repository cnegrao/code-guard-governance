-- M16-S0.3.1: DB-authored credential epoch. No transactional command helper yet.
-- One transaction retains the cutover lock through validation, backfill, trigger,
-- NOT NULL, signup recreation and final grants. Never run against hosted DB here.
BEGIN;

LOCK TABLE gov_repo.governance_users IN SHARE ROW EXCLUSIVE MODE;

DO $cutover$
DECLARE
  v_cutover timestamptz;
BEGIN
  -- Capture only AFTER the table lock has been acquired, not at transaction start.
  v_cutover := pg_catalog.clock_timestamp();
  IF EXISTS (SELECT 1 FROM gov_repo.governance_users
             WHERE password_changed_at > v_cutover) THEN
    RAISE EXCEPTION 'M16_CREDENTIAL_EPOCH_FUTURE_LEGACY_VALUE';
  END IF;
  -- Preserve every valid non-null legacy epoch, backfill only NULLs.
  UPDATE gov_repo.governance_users
  SET password_changed_at = v_cutover
  WHERE password_changed_at IS NULL;
END;
$cutover$;

CREATE FUNCTION gov_repo.enforce_credential_epoch_v1()
RETURNS trigger
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = pg_catalog
AS $trigger$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.password_changed_at := pg_catalog.clock_timestamp();
  ELSIF NEW.external_id IS DISTINCT FROM OLD.external_id THEN
    -- Any credential-material/IdP identifier change invalidates older sessions.
    -- external_id overloading/injection: PRODUCTION_SECURITY_GATE_RESIDUAL.
    NEW.password_changed_at := GREATEST(
      pg_catalog.clock_timestamp(),
      OLD.password_changed_at + interval '1 microsecond'
    );
  ELSE
    NEW.password_changed_at := OLD.password_changed_at;
  END IF;
  RETURN NEW;
END;
$trigger$;

REVOKE ALL ON FUNCTION gov_repo.enforce_credential_epoch_v1()
FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER trg_governance_users_credential_epoch_v1
BEFORE INSERT OR UPDATE ON gov_repo.governance_users
FOR EACH ROW EXECUTE FUNCTION gov_repo.enforce_credential_epoch_v1();

ALTER TABLE gov_repo.governance_users
ENABLE ALWAYS TRIGGER trg_governance_users_credential_epoch_v1;
-- ALWAYS includes replica-mode DML; owner DDL disabling/dropping it is outside
-- this guarantee and remains Production Security Gate scope.

DO $post_backfill$
BEGIN
  IF EXISTS (SELECT 1 FROM gov_repo.governance_users WHERE password_changed_at IS NULL) THEN
    RAISE EXCEPTION 'M16_CREDENTIAL_EPOCH_NULL_REMAINS';
  END IF;
END;
$post_backfill$;

ALTER TABLE gov_repo.governance_users ALTER COLUMN password_changed_at SET NOT NULL;

-- Recreate the established RPC without obsolete overloads. The base trigger
-- authors the epoch; organisation identity, role and bcrypt behavior is unchanged.
DROP FUNCTION IF EXISTS gov_repo.signup_legacy(
  p_email varchar,
  p_password_hash varchar,
  p_full_name varchar,
  p_org_name varchar,
  p_org_code varchar,
  p_industry_profile varchar
);

DROP FUNCTION IF EXISTS gov_repo.signup_legacy(
  p_email varchar,
  p_password_hash varchar,
  p_full_name varchar,
  p_org_name varchar,
  p_industry_profile varchar
);

DROP FUNCTION IF EXISTS gov_repo.signup_legacy(
  p_email varchar,
  p_password_hash varchar,
  p_full_name varchar,
  p_org_name varchar
);

-- -----------------------------------------------------------------------------
-- Create the function
--
-- SECURITY INVOKER: The caller already uses service_role capability.
-- We do NOT use SECURITY DEFINER because:
--   1. Caller is already privileged
--   2. SECURITY DEFINER increases attack surface unnecessarily
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION gov_repo.signup_legacy(
  p_email varchar,
  p_password_hash varchar,
  p_full_name varchar,
  p_org_name varchar
)
RETURNS TABLE (
  user_id uuid,
  email varchar,
  full_name varchar,
  organisation_id uuid,
  organisation_name varchar,
  role_id uuid,
  role_code varchar,
  password_changed_at timestamptz
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = 'gov_repo', 'pg_catalog'
AS $$
DECLARE
  v_org_id uuid;
  v_user_id uuid;
  v_admin_role_id uuid;
  v_admin_role_code varchar := 'GOVERNANCE_ADMIN';
  v_org_code_prefix varchar(8);
  v_org_code_suffix varchar(11);
  v_org_code varchar(20);
BEGIN
  -- ===========================================================================
  -- VALIDATION: Input preconditions
  -- ===========================================================================
  IF p_email IS NULL OR trim(p_email) = '' THEN
    RAISE EXCEPTION 'Email is required';
  END IF;

  IF p_password_hash IS NULL OR trim(p_password_hash) = '' THEN
    RAISE EXCEPTION 'Password hash is required';
  END IF;

  IF p_full_name IS NULL OR trim(p_full_name) = '' THEN
    RAISE EXCEPTION 'Full name is required';
  END IF;

  IF p_org_name IS NULL OR trim(p_org_name) = '' THEN
    RAISE EXCEPTION 'Organisation name is required';
  END IF;

  -- ===========================================================================
  -- ROLE LOOKUP: Resolve GOVERNANCE_ADMIN system role
  -- Must happen FIRST so we fail early if role is missing
  -- ===========================================================================
  SELECT gr.role_id, gr.role_code
  INTO v_admin_role_id, v_admin_role_code
  FROM gov_repo.governance_roles gr
  WHERE gr.role_code = v_admin_role_code
    AND gr.is_system_role = true
  LIMIT 1;

  IF v_admin_role_id IS NULL THEN
    RAISE EXCEPTION 'System role GOVERNANCE_ADMIN not found. Aborting signup.';
  END IF;

  -- ===========================================================================
  -- STEP 1: Create organisation
  --
  -- org_code generation (DATABASE-AUTHORITATIVE, single source of truth):
  --   1. Generate the organisation_id here, up front, so BOTH the primary
  --      key and the org_code suffix are derived from the same
  --      cryptographically-random pg_catalog.gen_random_uuid() value.
  --      (gen_random_uuid() is used instead of uuid_generate_v4() because it
  --      is a pg_catalog-native built-in on PostgreSQL 13+ and resolves
  --      correctly under this function's restricted
  --      SET search_path = 'gov_repo', 'pg_catalog' — uuid_generate_v4()
  --      lives in the uuid-ossp extension's schema, which is deliberately
  --      NOT on this search_path.)
  --   2. Prefix: readable, derived from p_org_name, uppercased, stripped to
  --      [A-Z0-9], truncated to 8 chars (falls back to 'ORG' if the name
  --      contains no alphanumeric characters).
  --   3. Suffix: first 11 hex characters of the generated organisation_id
  --      (44 bits of entropy) — materially stronger than a 32-bit/8-hex
  --      suffix (2^12 = 4096x the keyspace).
  --   4. prefix(<=8) + '_' + suffix(11) = <=20 chars, exactly the
  --      organisations.org_code varchar(20) limit.
  --   5. UNIQUE(org_code) is the final invariant. This function makes NO
  --      probabilistic uniqueness claim: on the astronomically unlikely
  --      event of a collision, the INSERT below raises and this entire
  --      transaction (organisation + user) rolls back atomically — no
  --      orphan state, no retry loop.
  -- ===========================================================================
  v_org_id := pg_catalog.gen_random_uuid();

  v_org_code_prefix := NULLIF(
    substr(regexp_replace(upper(p_org_name), '[^A-Z0-9]', '', 'g'), 1, 8),
    ''
  );
  IF v_org_code_prefix IS NULL THEN
    v_org_code_prefix := 'ORG';
  END IF;

  v_org_code_suffix := upper(substr(replace(v_org_id::text, '-', ''), 1, 11));
  v_org_code := v_org_code_prefix || '_' || v_org_code_suffix;

  -- Explicit table alias required: RETURNS TABLE declares an implicit
  -- plpgsql variable named organisation_id, which would otherwise make a
  -- bare "RETURNING organisation_id" ambiguous against that variable.
  INSERT INTO gov_repo.organisations AS inserted_org (
    organisation_id,
    org_code,
    legal_name,
    display_name,
    country_code,
    is_active
  ) VALUES (
    v_org_id,
    v_org_code,
    p_org_name,
    p_org_name,
    'PT',
    true
  )
  RETURNING inserted_org.organisation_id INTO v_org_id;

  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'Failed to create organisation';
  END IF;

  -- ===========================================================================
  -- STEP 2: Create governance user
  -- ===========================================================================
  -- Explicit table alias required: RETURNS TABLE declares an implicit
  -- plpgsql variable named user_id, which would otherwise make a bare
  -- "RETURNING user_id" ambiguous against that variable.
  INSERT INTO gov_repo.governance_users AS inserted_user (
    email,
    full_name,
    display_name,
    organisation_id,
    status,
    external_id,
    role_ids
  ) VALUES (
    p_email,
    p_full_name,
    p_full_name,
    v_org_id,
    'active',
    p_password_hash,
    ARRAY[v_admin_role_id]::uuid[]
  )
  RETURNING inserted_user.user_id INTO v_user_id;

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Failed to create user';
  END IF;

  -- ===========================================================================
  -- RETURN: Non-secret identity/session bootstrap data only
  -- ===========================================================================
  RETURN QUERY
  SELECT
    gu.user_id,
    gu.email,
    gu.full_name,
    go.organisation_id,
    go.legal_name as organisation_name,
    v_admin_role_id as role_id,
    v_admin_role_code::varchar as role_code,
    gu.password_changed_at
  FROM gov_repo.governance_users gu
  JOIN gov_repo.organisations go ON gu.organisation_id = go.organisation_id
  WHERE gu.user_id = v_user_id
  LIMIT 1;

  -- If we reach here, all steps succeeded.
  -- Caller COMMIT makes it durable; caller ROLLBACK on error atomically undoes everything.
END;
$$;

COMMENT ON FUNCTION gov_repo.signup_legacy(varchar, varchar, varchar, varchar) IS
'Atomic legacy signup; database-owned organisation identity and credential epoch. SECURITY INVOKER; service_role only.';
REVOKE ALL ON FUNCTION gov_repo.signup_legacy(varchar, varchar, varchar, varchar)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION gov_repo.signup_legacy(varchar, varchar, varchar, varchar) TO service_role;

COMMIT;
