-- M16-S0.3.2: transactional governance-session eligibility primitive.
-- Internal infrastructure only: no application EXECUTE grant, no routes, no write
-- wrappers (S0.3.3), no L14 Authority Policy, no permissions interpretation.
-- Never run against a hosted DB from this slice.
BEGIN;

-- CANONICAL LOCK HIERARCHY (future multi-object eligibility writers MUST reuse it):
--
--   ORGANISATION  ->  GOVERNANCE_USER  ->  GOVERNANCE_ROLE (ascending role_id)
--
-- All three are row locks taken with FOR SHARE. FOR SHARE conflicts with ordinary
-- UPDATE / DELETE (FOR NO KEY UPDATE / FOR UPDATE); FOR KEY SHARE would not block
-- updates of is_active, status, organisation_id, role_ids or role definitions and
-- is therefore never used here.
--
-- CURRENT LEGACY ACTOR-AUTHORITY GUARD: the gov_repo.governance_users row lock.
-- Role assignment is exclusively the array column governance_users.role_ids (there
-- is no normalized grant relation), so locking that one row serializes membership,
-- status, credential epoch, role revocation AND the addition of a previously absent
-- role id. This guard is specific to the array-based legacy model.
--
-- The helper is VOLATILE and requires READ COMMITTED: every statement takes a fresh
-- snapshot and FOR SHARE re-reads the latest committed row version after waiting.
-- It does not swallow errors: lock_timeout (55P03), catalog and permission errors
-- propagate to the caller and can never surface as eligibility.
CREATE FUNCTION gov_repo.lock_and_resolve_governance_session_eligibility_v1(
  p_organisation_id uuid,
  p_actor_user_id uuid,
  p_verified_session_iat bigint,
  p_verified_session_exp bigint
)
RETURNS TABLE (
  actor_user_id uuid,
  organisation_id uuid,
  role_ids uuid[],
  role_codes text[],
  has_governance_admin boolean,
  checked_at timestamptz
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog
SET lock_timeout = '5s'
AS $eligibility$
DECLARE
  -- Fixed, closed contract constants.
  c_max_age_seconds CONSTANT bigint := 28800;  -- 8h, GOVERNANCE_SESSION_MAX_AGE_SECONDS
  c_max_future_iat_seconds CONSTANT bigint := 5; -- backend-vs-DB clock allowance ONLY
  v_org_active boolean;
  v_user_id uuid;
  v_user_org uuid;
  v_user_status gov_repo.user_status;
  v_user_changed_at timestamptz;
  v_user_roles uuid[];
  v_role_id uuid;
  v_role_code text;
  v_role_is_system boolean;
  v_locked_role_ids uuid[] := ARRAY[]::uuid[];
  v_locked_role_codes text[] := ARRAY[]::text[];
  v_admin boolean := false;
  v_checked_at timestamptz;
  v_now_seconds bigint;
BEGIN
  -- 1. Isolation gate. No silent downgrade/upgrade inside the helper.
  IF pg_catalog.current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'M16_ELIGIBILITY_UNSUPPORTED_TRANSACTION_ISOLATION'
      USING ERRCODE = 'GV005', DETAIL = 'READ_COMMITTED_REQUIRED';
  END IF;

  -- 2. Backend-attested claim shape (no JWT signature/role/email is accepted here).
  IF p_verified_session_iat IS NULL OR p_verified_session_exp IS NULL
     OR p_verified_session_iat <= 0 OR p_verified_session_exp <= 0
     OR p_verified_session_exp <= p_verified_session_iat THEN
    RAISE EXCEPTION 'M16_ELIGIBILITY_SESSION_TEMPORALLY_INVALID'
      USING ERRCODE = 'GV001', DETAIL = 'MALFORMED_SESSION_TIMESTAMPS';
  END IF;
  IF p_organisation_id IS NULL OR p_actor_user_id IS NULL THEN
    RAISE EXCEPTION 'M16_ELIGIBILITY_ACTOR_OR_ORGANISATION_INELIGIBLE'
      USING ERRCODE = 'GV003', DETAIL = 'IDENTITY_REQUIRED';
  END IF;

  -- 3. LOCK 1: organisation (tenant taken only from the argument).
  SELECT o.is_active
  INTO v_org_active
  FROM gov_repo.organisations AS o
  WHERE o.organisation_id = p_organisation_id
  FOR SHARE OF o;
  IF NOT FOUND OR v_org_active IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'M16_ELIGIBILITY_ACTOR_OR_ORGANISATION_INELIGIBLE'
      USING ERRCODE = 'GV003', DETAIL = 'ORGANISATION_UNAVAILABLE';
  END IF;

  -- 4. LOCK 2: governance user; the locked row is the actor-authority guard.
  SELECT u.user_id, u.organisation_id, u.status, u.password_changed_at, u.role_ids
  INTO v_user_id, v_user_org, v_user_status, v_user_changed_at, v_user_roles
  FROM gov_repo.governance_users AS u
  WHERE u.user_id = p_actor_user_id
  FOR SHARE OF u;
  IF NOT FOUND
     OR v_user_id IS DISTINCT FROM p_actor_user_id
     OR v_user_org IS DISTINCT FROM p_organisation_id
     OR v_user_status IS DISTINCT FROM 'active'::gov_repo.user_status
     OR v_user_changed_at IS NULL THEN
    RAISE EXCEPTION 'M16_ELIGIBILITY_ACTOR_OR_ORGANISATION_INELIGIBLE'
      USING ERRCODE = 'GV003', DETAIL = 'ACTOR_UNAVAILABLE_OR_NOT_MEMBER';
  END IF;

  -- 5. Structural validity of the authoritative role assignment.
  --    An empty non-null array is valid (no admin); nothing is fabricated.
  IF v_user_roles IS NULL
     OR pg_catalog.array_ndims(v_user_roles) > 1
     OR pg_catalog.array_position(v_user_roles, NULL::uuid) IS NOT NULL
     OR pg_catalog.cardinality(v_user_roles) <> (
          SELECT pg_catalog.count(DISTINCT r.assigned_role_id)
          FROM pg_catalog.unnest(v_user_roles) AS r(assigned_role_id)
        ) THEN
    RAISE EXCEPTION 'M16_ELIGIBILITY_ROLE_SET_INVALID'
      USING ERRCODE = 'GV004', DETAIL = 'MALFORMED_ROLE_ASSIGNMENT';
  END IF;

  -- 6. LOCK 3: each assigned role definition, one by one, ascending role_id,
  --    independent of stored array order and of any executor lock ordering.
  FOR v_role_id IN
    SELECT r.assigned_role_id
    FROM pg_catalog.unnest(v_user_roles) AS r(assigned_role_id)
    ORDER BY r.assigned_role_id
  LOOP
    SELECT gr.role_code::text, gr.is_system_role
    INTO v_role_code, v_role_is_system
    FROM gov_repo.governance_roles AS gr
    WHERE gr.role_id = v_role_id
    FOR SHARE OF gr;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'M16_ELIGIBILITY_ROLE_SET_INVALID'
        USING ERRCODE = 'GV004', DETAIL = 'ASSIGNED_ROLE_UNRESOLVED';
    END IF;
    v_locked_role_ids := pg_catalog.array_append(v_locked_role_ids, v_role_id);
    v_locked_role_codes := pg_catalog.array_append(v_locked_role_codes, v_role_code);
    -- Exact pre-M16 privileged-route ceiling. NOT an L14 permission; the
    -- permissions column is neither read nor returned.
    IF v_role_code = 'GOVERNANCE_ADMIN' AND v_role_is_system IS TRUE THEN
      v_admin := true;
    END IF;
  END LOOP;

  -- 7. Fresh DB clock AFTER all locks (lock waits may have consumed time).
  --    Never transaction_timestamp()/now()/statement_timestamp().
  v_checked_at := pg_catalog.clock_timestamp();
  v_now_seconds := pg_catalog.floor(extract(epoch FROM v_checked_at))::bigint;

  -- 8. Temporal rules against the database clock.
  IF p_verified_session_iat > v_now_seconds + c_max_future_iat_seconds THEN
    RAISE EXCEPTION 'M16_ELIGIBILITY_SESSION_TEMPORALLY_INVALID'
      USING ERRCODE = 'GV001', DETAIL = 'IAT_AHEAD_OF_DATABASE_CLOCK';
  END IF;
  IF p_verified_session_exp <= v_now_seconds THEN
    RAISE EXCEPTION 'M16_ELIGIBILITY_SESSION_TEMPORALLY_INVALID'
      USING ERRCODE = 'GV001', DETAIL = 'SESSION_EXPIRED';
  END IF;
  IF v_now_seconds - p_verified_session_iat > c_max_age_seconds THEN
    RAISE EXCEPTION 'M16_ELIGIBILITY_SESSION_TEMPORALLY_INVALID'
      USING ERRCODE = 'GV001', DETAIL = 'SESSION_MAX_AGE_EXCEEDED';
  END IF;

  -- 9. Credential freshness: iat must be STRICTLY greater than the epoch second
  --    (no future allowance applies here) using the locked row's epoch.
  IF p_verified_session_iat <=
     pg_catalog.floor(extract(epoch FROM v_user_changed_at))::bigint THEN
    RAISE EXCEPTION 'M16_ELIGIBILITY_CREDENTIAL_STALE'
      USING ERRCODE = 'GV002', DETAIL = 'SESSION_NOT_AFTER_CREDENTIAL_EPOCH';
  END IF;

  RETURN QUERY SELECT
    v_user_id,
    v_user_org,
    v_locked_role_ids,
    v_locked_role_codes,
    v_admin,
    v_checked_at;
END;
$eligibility$;

COMMENT ON FUNCTION gov_repo.lock_and_resolve_governance_session_eligibility_v1(uuid, uuid, bigint, bigint) IS
'M16-S0.3.2 internal eligibility primitive. Lock order ORGANISATION -> GOVERNANCE_USER -> GOVERNANCE_ROLE(role_id asc), all FOR SHARE, READ COMMITTED only, lock_timeout 5s. No application EXECUTE; invoked only by owner-owned SECURITY DEFINER wrappers (S0.3.3). Not L14 Authority Policy; returns no permissions.';

-- Legacy default privileges grant future routines to service_role: revoke explicitly.
REVOKE ALL ON FUNCTION gov_repo.lock_and_resolve_governance_session_eligibility_v1(uuid, uuid, bigint, bigint)
FROM PUBLIC, anon, authenticated, service_role;

COMMIT;
