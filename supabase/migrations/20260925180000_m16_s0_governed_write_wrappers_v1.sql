-- M16-S0.3.3B: governed write wrapper foundation (EXPAND phase; DB only).
-- Adds an owner-only eligibility/admin guard and six SECURITY DEFINER wrappers, one per
-- existing authoritative write function. Each wrapper runs, in ONE transaction:
--   require_governed_write_eligibility_v1  ->  existing authoritative write
--   ->  require_governed_write_eligibility_v1 (fresh DB clock)  ->  return.
-- The legacy underlying functions are NOT modified and their service_role EXECUTE is NOT
-- revoked here: the current application still calls them (revocation is the S0.3.3D
-- contract phase). No route, adapter, table-privilege or L14 change. Never run against a
-- hosted DB from this slice. Prior migrations are not modified.
--
-- Contract reused from S0.3.2R (unchanged):
--   lock order ORGANISATION -> GOVERNANCE_USER -> GOVERNANCE_ROLE(role_id asc), FOR SHARE,
--   READ COMMITTED only, lock_timeout 5s (function-local to the canonical helper),
--   GV001 temporal / GV002 credential / GV003 actor-org / GV004 role set / GV005 isolation.
-- New here: GV006 M16_WRITE_AUTHORITY_DENIED (eligible principal without governance admin).
--
-- Governance admin remains EXACTLY the legacy ceiling resolved by the helper:
--   role_code = 'GOVERNANCE_ADMIN' AND is_system_role = true. Not L14; no permissions read.
--
-- Identity binding: the first five parameters of every wrapper are the ONLY identity/session
-- authority. Flat actor columns are DERIVED (HUMAN + p_verified_actor_user_id::text) and the
-- organisation is injected from p_verified_organisation_id. Identity embedded in JSON
-- (decision/envelope) is ASSERTED, never rewritten, because its exact representation
-- participates in existing digests/fingerprints. Mismatch -> GV003 (non-sensitive DETAIL).
--
-- No wrapper has an EXCEPTION block, dynamic SQL, COMMIT or procedure: any failure of either
-- eligibility check, or of the nested write, aborts the statement and rolls back the whole
-- transaction including the nested authoritative mutation.
BEGIN;

-- ---------------------------------------------------------------------------------------
-- Internal guard (owner-only): canonical helper + governance-admin requirement.
-- ---------------------------------------------------------------------------------------
CREATE FUNCTION gov_repo.require_governed_write_eligibility_v1(
  p_verified_organisation_id uuid,
  p_verified_actor_user_id uuid,
  p_verified_session_iat bigint,
  p_verified_session_exp bigint,
  p_verified_credential_epoch timestamptz
)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $guard$
DECLARE
  v_admin boolean;
  v_organisation_id uuid;
  v_actor_user_id uuid;
BEGIN
  -- Locks, validates and resolves through the single canonical helper (errors propagate).
  SELECT e.has_governance_admin, e.organisation_id, e.actor_user_id
  INTO v_admin, v_organisation_id, v_actor_user_id
  FROM gov_repo.lock_and_resolve_governance_session_eligibility_v1(
    p_verified_organisation_id,
    p_verified_actor_user_id,
    p_verified_session_iat,
    p_verified_session_exp,
    p_verified_credential_epoch
  ) AS e;

  -- Defensive: the helper is authoritative, but never trust an unexpected shape.
  IF NOT FOUND
     OR v_organisation_id IS DISTINCT FROM p_verified_organisation_id
     OR v_actor_user_id IS DISTINCT FROM p_verified_actor_user_id THEN
    RAISE EXCEPTION 'M16_ELIGIBILITY_ACTOR_OR_ORGANISATION_INELIGIBLE'
      USING ERRCODE = 'GV003', DETAIL = 'ELIGIBILITY_RESULT_MISMATCH';
  END IF;

  IF v_admin IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'M16_WRITE_AUTHORITY_DENIED'
      USING ERRCODE = 'GV006', DETAIL = 'GOVERNANCE_ADMIN_REQUIRED';
  END IF;
END;
$guard$;

COMMENT ON FUNCTION gov_repo.require_governed_write_eligibility_v1(uuid, uuid, bigint, bigint, timestamptz) IS
'M16-S0.3.3B internal guard. Calls the canonical five-argument eligibility helper and requires has_governance_admin (legacy GOVERNANCE_ADMIN + is_system_role ceiling, not L14). GV006 M16_WRITE_AUTHORITY_DENIED otherwise. Owner-only; invoked only by the governed write wrappers.';

REVOKE ALL ON FUNCTION gov_repo.require_governed_write_eligibility_v1(uuid, uuid, bigint, bigint, timestamptz)
FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------
-- 1. apply_review_transition
-- ---------------------------------------------------------------------------------------
CREATE FUNCTION gov_repo.apply_review_transition_governed_v1(
  p_verified_organisation_id uuid,
  p_verified_actor_user_id uuid,
  p_verified_session_iat bigint,
  p_verified_session_exp bigint,
  p_verified_credential_epoch timestamptz,
  p_review_subject_id text,
  p_finding_id text,
  p_previous_state text,
  p_new_state text,
  p_occurred_at timestamptz,
  p_evidence_ids text[],
  p_reason_code text,
  p_command_id text,
  p_event_id text
)
RETURNS TABLE (
  replay boolean,
  event_id text,
  review_subject_id text,
  previous_state text,
  new_state text,
  occurred_at timestamptz,
  revision bigint,
  state text
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $wrapper$
BEGIN
  PERFORM gov_repo.require_governed_write_eligibility_v1(
    p_verified_organisation_id, p_verified_actor_user_id,
    p_verified_session_iat, p_verified_session_exp, p_verified_credential_epoch);

  -- Human-only: actor kind/reference are derived from the verified principal.
  RETURN QUERY
  SELECT u.replay, u.event_id, u.review_subject_id, u.previous_state, u.new_state,
         u.occurred_at, u.revision, u.state
  FROM gov_repo.apply_review_transition(
    p_organisation_id => p_verified_organisation_id,
    p_review_subject_id => p_review_subject_id,
    p_finding_id => p_finding_id,
    p_previous_state => p_previous_state,
    p_new_state => p_new_state,
    p_actor_kind => 'HUMAN',
    p_actor_reference => p_verified_actor_user_id::text,
    p_actor_rule_code => NULL::text,
    p_actor_rule_version => NULL::text,
    p_occurred_at => p_occurred_at,
    p_evidence_ids => p_evidence_ids,
    p_reason_code => p_reason_code,
    p_command_id => p_command_id,
    p_event_id => p_event_id
  ) AS u;

  PERFORM gov_repo.require_governed_write_eligibility_v1(
    p_verified_organisation_id, p_verified_actor_user_id,
    p_verified_session_iat, p_verified_session_exp, p_verified_credential_epoch);
  RETURN;
END;
$wrapper$;

-- ---------------------------------------------------------------------------------------
-- 2. record_authorized_reconciliation
-- ---------------------------------------------------------------------------------------
CREATE FUNCTION gov_repo.record_authorized_reconciliation_governed_v1(
  p_verified_organisation_id uuid,
  p_verified_actor_user_id uuid,
  p_verified_session_iat bigint,
  p_verified_session_exp bigint,
  p_verified_credential_epoch timestamptz,
  p_review_subject_id text,
  p_authorization_decision_id text,
  p_authorization_subject_kind text,
  p_authorization_subject_candidate_id text,
  p_authorization_subject_candidate_merge_id text,
  p_requested_action text,
  p_authorization_evaluated_at timestamptz,
  p_policy_reference text,
  p_invocation_id text,
  p_command_id text,
  p_command_fingerprint text,
  p_requested_at timestamptz,
  p_reason_code text,
  p_decision_id text,
  p_family text,
  p_outcome text,
  p_candidate_kind text,
  p_decided_at timestamptz,
  p_subject_candidate_id text,
  p_subject_candidate_merge_id text,
  p_canonical_object_id text,
  p_canonical_object_kind text,
  p_relationship_candidate_id text,
  p_relationship_type_code text,
  p_candidate_merge_id text,
  p_merge_member_candidate_ids text[],
  p_assertion_ids text[],
  p_evidence_ids text[],
  p_contract_version text,
  p_envelope jsonb,
  p_envelope_hash char(64)
)
RETURNS TABLE (
  replay boolean,
  authorization_decision_id text,
  invocation_id text,
  reconciliation_decision_id text
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $wrapper$
DECLARE
  v_organisation_text text := p_verified_organisation_id::text;
  v_actor_text text := p_verified_actor_user_id::text;
BEGIN
  PERFORM gov_repo.require_governed_write_eligibility_v1(
    p_verified_organisation_id, p_verified_actor_user_id,
    p_verified_session_iat, p_verified_session_exp, p_verified_credential_epoch);

  -- The envelope's exact JSON participates in its digest: assert, never rewrite.
  IF p_envelope->>'organisationId' IS DISTINCT FROM v_organisation_text THEN
    RAISE EXCEPTION 'M16_ELIGIBILITY_ACTOR_OR_ORGANISATION_INELIGIBLE'
      USING ERRCODE = 'GV003', DETAIL = 'EMBEDDED_ORGANISATION_MISMATCH';
  END IF;
  IF p_envelope#>>'{authority,authorityKind}' IS DISTINCT FROM 'HUMAN' THEN
    RAISE EXCEPTION 'M16_ELIGIBILITY_ACTOR_OR_ORGANISATION_INELIGIBLE'
      USING ERRCODE = 'GV003', DETAIL = 'EMBEDDED_ACTOR_NOT_HUMAN';
  END IF;
  IF p_envelope#>>'{authority,actorReference}' IS DISTINCT FROM v_actor_text THEN
    RAISE EXCEPTION 'M16_ELIGIBILITY_ACTOR_OR_ORGANISATION_INELIGIBLE'
      USING ERRCODE = 'GV003', DETAIL = 'EMBEDDED_ACTOR_MISMATCH';
  END IF;

  RETURN QUERY
  SELECT u.replay, u.authorization_decision_id, u.invocation_id, u.reconciliation_decision_id
  FROM gov_repo.record_authorized_reconciliation(
    p_organisation_id => p_verified_organisation_id,
    p_review_subject_id => p_review_subject_id,
    p_authorization_decision_id => p_authorization_decision_id,
    p_authorization_actor_reference => v_actor_text,
    p_authorization_subject_kind => p_authorization_subject_kind,
    p_authorization_subject_candidate_id => p_authorization_subject_candidate_id,
    p_authorization_subject_candidate_merge_id => p_authorization_subject_candidate_merge_id,
    p_requested_action => p_requested_action,
    p_authorization_evaluated_at => p_authorization_evaluated_at,
    p_policy_reference => p_policy_reference,
    p_invocation_id => p_invocation_id,
    p_command_id => p_command_id,
    p_command_fingerprint => p_command_fingerprint,
    p_requested_at => p_requested_at,
    p_reason_code => p_reason_code,
    p_decision_id => p_decision_id,
    p_family => p_family,
    p_outcome => p_outcome,
    p_candidate_kind => p_candidate_kind,
    p_authority_reference => v_actor_text,
    p_decided_at => p_decided_at,
    p_subject_candidate_id => p_subject_candidate_id,
    p_subject_candidate_merge_id => p_subject_candidate_merge_id,
    p_canonical_object_id => p_canonical_object_id,
    p_canonical_object_kind => p_canonical_object_kind,
    p_relationship_candidate_id => p_relationship_candidate_id,
    p_relationship_type_code => p_relationship_type_code,
    p_candidate_merge_id => p_candidate_merge_id,
    p_merge_member_candidate_ids => p_merge_member_candidate_ids,
    p_assertion_ids => p_assertion_ids,
    p_evidence_ids => p_evidence_ids,
    p_contract_version => p_contract_version,
    p_envelope => p_envelope,
    p_envelope_hash => p_envelope_hash
  ) AS u;

  PERFORM gov_repo.require_governed_write_eligibility_v1(
    p_verified_organisation_id, p_verified_actor_user_id,
    p_verified_session_iat, p_verified_session_exp, p_verified_credential_epoch);
  RETURN;
END;
$wrapper$;

-- ---------------------------------------------------------------------------------------
-- 3. materialize_object_reconciliation
-- ---------------------------------------------------------------------------------------
CREATE FUNCTION gov_repo.materialize_object_reconciliation_governed_v1(
  p_verified_organisation_id uuid,
  p_verified_actor_user_id uuid,
  p_verified_session_iat bigint,
  p_verified_session_exp bigint,
  p_verified_credential_epoch timestamptz,
  p_reconciliation_decision_id text,
  p_invocation_id text,
  p_outcome text,
  p_canonical_object_id text,
  p_canonical_object_kind text,
  p_source_connection_id text,
  p_source_external_type text,
  p_source_external_id text,
  p_match_method text,
  p_idempotency_fingerprint char(64),
  p_occurred_at timestamptz
)
RETURNS TABLE (
  replay boolean,
  status text,
  canonical_object_id text,
  mapping_id text
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $wrapper$
BEGIN
  PERFORM gov_repo.require_governed_write_eligibility_v1(
    p_verified_organisation_id, p_verified_actor_user_id,
    p_verified_session_iat, p_verified_session_exp, p_verified_credential_epoch);

  RETURN QUERY
  SELECT u.replay, u.status, u.canonical_object_id, u.mapping_id
  FROM gov_repo.materialize_object_reconciliation(
    p_organisation_id => p_verified_organisation_id,
    p_reconciliation_decision_id => p_reconciliation_decision_id,
    p_invocation_id => p_invocation_id,
    p_outcome => p_outcome,
    p_canonical_object_id => p_canonical_object_id,
    p_canonical_object_kind => p_canonical_object_kind,
    p_source_connection_id => p_source_connection_id,
    p_source_external_type => p_source_external_type,
    p_source_external_id => p_source_external_id,
    p_match_method => p_match_method,
    p_idempotency_fingerprint => p_idempotency_fingerprint,
    p_occurred_at => p_occurred_at
  ) AS u;

  PERFORM gov_repo.require_governed_write_eligibility_v1(
    p_verified_organisation_id, p_verified_actor_user_id,
    p_verified_session_iat, p_verified_session_exp, p_verified_credential_epoch);
  RETURN;
END;
$wrapper$;

-- ---------------------------------------------------------------------------------------
-- 4. materialize_relationship_reconciliation
-- ---------------------------------------------------------------------------------------
CREATE FUNCTION gov_repo.materialize_relationship_reconciliation_governed_v1(
  p_verified_organisation_id uuid,
  p_verified_actor_user_id uuid,
  p_verified_session_iat bigint,
  p_verified_session_exp bigint,
  p_verified_credential_epoch timestamptz,
  p_reconciliation_decision_id text,
  p_invocation_id text,
  p_outcome text,
  p_relationship_id text,
  p_relationship_state_id text,
  p_relationship_type text,
  p_source_canonical_object_id text,
  p_source_kind text,
  p_target_canonical_object_id text,
  p_target_kind text,
  p_valid_from timestamptz,
  p_recorded_at timestamptz,
  p_idempotency_fingerprint char(64)
)
RETURNS TABLE (
  replay boolean,
  status text,
  relationship_id text
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $wrapper$
BEGIN
  PERFORM gov_repo.require_governed_write_eligibility_v1(
    p_verified_organisation_id, p_verified_actor_user_id,
    p_verified_session_iat, p_verified_session_exp, p_verified_credential_epoch);

  RETURN QUERY
  SELECT u.replay, u.status, u.relationship_id
  FROM gov_repo.materialize_relationship_reconciliation(
    p_organisation_id => p_verified_organisation_id,
    p_reconciliation_decision_id => p_reconciliation_decision_id,
    p_invocation_id => p_invocation_id,
    p_outcome => p_outcome,
    p_relationship_id => p_relationship_id,
    p_relationship_state_id => p_relationship_state_id,
    p_relationship_type => p_relationship_type,
    p_source_canonical_object_id => p_source_canonical_object_id,
    p_source_kind => p_source_kind,
    p_target_canonical_object_id => p_target_canonical_object_id,
    p_target_kind => p_target_kind,
    p_valid_from => p_valid_from,
    p_recorded_at => p_recorded_at,
    p_idempotency_fingerprint => p_idempotency_fingerprint
  ) AS u;

  PERFORM gov_repo.require_governed_write_eligibility_v1(
    p_verified_organisation_id, p_verified_actor_user_id,
    p_verified_session_iat, p_verified_session_exp, p_verified_credential_epoch);
  RETURN;
END;
$wrapper$;

-- ---------------------------------------------------------------------------------------
-- 5. record_technical_field_decision
-- ---------------------------------------------------------------------------------------
CREATE FUNCTION gov_repo.record_technical_field_decision_governed_v1(
  p_verified_organisation_id uuid,
  p_verified_actor_user_id uuid,
  p_verified_session_iat bigint,
  p_verified_session_exp bigint,
  p_verified_credential_epoch timestamptz,
  p_decision jsonb
)
RETURNS TABLE (
  replay boolean,
  state_id text
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $wrapper$
DECLARE
  v_organisation_text text := p_verified_organisation_id::text;
  v_actor_text text := p_verified_actor_user_id::text;
BEGIN
  PERFORM gov_repo.require_governed_write_eligibility_v1(
    p_verified_organisation_id, p_verified_actor_user_id,
    p_verified_session_iat, p_verified_session_exp, p_verified_credential_epoch);

  -- The decision JSON is passed through unchanged; embedded identity is asserted only.
  IF p_decision->>'organisationId' IS DISTINCT FROM v_organisation_text
     OR p_decision#>>'{canonicalObject,organisationId}' IS DISTINCT FROM v_organisation_text THEN
    RAISE EXCEPTION 'M16_ELIGIBILITY_ACTOR_OR_ORGANISATION_INELIGIBLE'
      USING ERRCODE = 'GV003', DETAIL = 'EMBEDDED_ORGANISATION_MISMATCH';
  END IF;
  IF p_decision#>>'{actor,authorityKind}' IS DISTINCT FROM 'HUMAN' THEN
    RAISE EXCEPTION 'M16_ELIGIBILITY_ACTOR_OR_ORGANISATION_INELIGIBLE'
      USING ERRCODE = 'GV003', DETAIL = 'EMBEDDED_ACTOR_NOT_HUMAN';
  END IF;
  IF p_decision#>>'{actor,actorReference}' IS DISTINCT FROM v_actor_text THEN
    RAISE EXCEPTION 'M16_ELIGIBILITY_ACTOR_OR_ORGANISATION_INELIGIBLE'
      USING ERRCODE = 'GV003', DETAIL = 'EMBEDDED_ACTOR_MISMATCH';
  END IF;

  RETURN QUERY
  SELECT u.replay, u.state_id
  FROM gov_repo.record_technical_field_decision(
    p_organisation_id => p_verified_organisation_id,
    p_decision => p_decision
  ) AS u;

  PERFORM gov_repo.require_governed_write_eligibility_v1(
    p_verified_organisation_id, p_verified_actor_user_id,
    p_verified_session_iat, p_verified_session_exp, p_verified_credential_epoch);
  RETURN;
END;
$wrapper$;

-- ---------------------------------------------------------------------------------------
-- 6. record_execution_field_decision
-- ---------------------------------------------------------------------------------------
CREATE FUNCTION gov_repo.record_execution_field_decision_governed_v1(
  p_verified_organisation_id uuid,
  p_verified_actor_user_id uuid,
  p_verified_session_iat bigint,
  p_verified_session_exp bigint,
  p_verified_credential_epoch timestamptz,
  p_decision jsonb
)
RETURNS TABLE (
  replay boolean,
  state_id text
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $wrapper$
DECLARE
  v_organisation_text text := p_verified_organisation_id::text;
  v_actor_text text := p_verified_actor_user_id::text;
BEGIN
  PERFORM gov_repo.require_governed_write_eligibility_v1(
    p_verified_organisation_id, p_verified_actor_user_id,
    p_verified_session_iat, p_verified_session_exp, p_verified_credential_epoch);

  -- The underlying function digests p_decision::text: pass it through unchanged.
  IF p_decision->>'organisationId' IS DISTINCT FROM v_organisation_text
     OR p_decision#>>'{canonicalObject,organisationId}' IS DISTINCT FROM v_organisation_text THEN
    RAISE EXCEPTION 'M16_ELIGIBILITY_ACTOR_OR_ORGANISATION_INELIGIBLE'
      USING ERRCODE = 'GV003', DETAIL = 'EMBEDDED_ORGANISATION_MISMATCH';
  END IF;
  IF p_decision#>>'{actor,authorityKind}' IS DISTINCT FROM 'HUMAN' THEN
    RAISE EXCEPTION 'M16_ELIGIBILITY_ACTOR_OR_ORGANISATION_INELIGIBLE'
      USING ERRCODE = 'GV003', DETAIL = 'EMBEDDED_ACTOR_NOT_HUMAN';
  END IF;
  IF p_decision#>>'{actor,actorReference}' IS DISTINCT FROM v_actor_text THEN
    RAISE EXCEPTION 'M16_ELIGIBILITY_ACTOR_OR_ORGANISATION_INELIGIBLE'
      USING ERRCODE = 'GV003', DETAIL = 'EMBEDDED_ACTOR_MISMATCH';
  END IF;

  RETURN QUERY
  SELECT u.replay, u.state_id
  FROM gov_repo.record_execution_field_decision(
    p_organisation_id => p_verified_organisation_id,
    p_decision => p_decision
  ) AS u;

  PERFORM gov_repo.require_governed_write_eligibility_v1(
    p_verified_organisation_id, p_verified_actor_user_id,
    p_verified_session_iat, p_verified_session_exp, p_verified_credential_epoch);
  RETURN;
END;
$wrapper$;

-- ---------------------------------------------------------------------------------------
-- Comments and FINAL wrapper ACL (legacy default privileges already grant service_role;
-- the explicit revoke/grant below makes the intended ACL deterministic).
-- ---------------------------------------------------------------------------------------
COMMENT ON FUNCTION gov_repo.apply_review_transition_governed_v1(uuid, uuid, bigint, bigint, timestamptz, text, text, text, text, timestamptz, text[], text, text, text) IS
'M16-S0.3.3B governed wrapper: eligibility+admin -> apply_review_transition (actor HUMAN derived from the verified principal) -> eligibility+admin. One transaction; no exception handling.';
COMMENT ON FUNCTION gov_repo.record_authorized_reconciliation_governed_v1(uuid, uuid, bigint, bigint, timestamptz, text, text, text, text, text, text, timestamptz, text, text, text, text, timestamptz, text, text, text, text, text, timestamptz, text, text, text, text, text, text, text, text[], text[], text[], text, jsonb, char) IS
'M16-S0.3.3B governed wrapper: eligibility+admin -> record_authorized_reconciliation (authorization/authority actor derived; envelope organisation and HUMAN authority asserted) -> eligibility+admin.';
COMMENT ON FUNCTION gov_repo.materialize_object_reconciliation_governed_v1(uuid, uuid, bigint, bigint, timestamptz, text, text, text, text, text, text, text, text, text, char, timestamptz) IS
'M16-S0.3.3B governed wrapper: eligibility+admin -> materialize_object_reconciliation -> eligibility+admin.';
COMMENT ON FUNCTION gov_repo.materialize_relationship_reconciliation_governed_v1(uuid, uuid, bigint, bigint, timestamptz, text, text, text, text, text, text, text, text, text, text, timestamptz, timestamptz, char) IS
'M16-S0.3.3B governed wrapper: eligibility+admin -> materialize_relationship_reconciliation -> eligibility+admin.';
COMMENT ON FUNCTION gov_repo.record_technical_field_decision_governed_v1(uuid, uuid, bigint, bigint, timestamptz, jsonb) IS
'M16-S0.3.3B governed wrapper: eligibility+admin -> record_technical_field_decision (embedded organisation and HUMAN actor asserted, JSON unchanged) -> eligibility+admin.';
COMMENT ON FUNCTION gov_repo.record_execution_field_decision_governed_v1(uuid, uuid, bigint, bigint, timestamptz, jsonb) IS
'M16-S0.3.3B governed wrapper: eligibility+admin -> record_execution_field_decision (embedded organisation and HUMAN actor asserted, JSON unchanged) -> eligibility+admin.';

REVOKE ALL ON FUNCTION gov_repo.apply_review_transition_governed_v1(uuid, uuid, bigint, bigint, timestamptz, text, text, text, text, timestamptz, text[], text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION gov_repo.record_authorized_reconciliation_governed_v1(uuid, uuid, bigint, bigint, timestamptz, text, text, text, text, text, text, timestamptz, text, text, text, text, timestamptz, text, text, text, text, text, timestamptz, text, text, text, text, text, text, text, text[], text[], text[], text, jsonb, char) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION gov_repo.materialize_object_reconciliation_governed_v1(uuid, uuid, bigint, bigint, timestamptz, text, text, text, text, text, text, text, text, text, char, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION gov_repo.materialize_relationship_reconciliation_governed_v1(uuid, uuid, bigint, bigint, timestamptz, text, text, text, text, text, text, text, text, text, text, timestamptz, timestamptz, char) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION gov_repo.record_technical_field_decision_governed_v1(uuid, uuid, bigint, bigint, timestamptz, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION gov_repo.record_execution_field_decision_governed_v1(uuid, uuid, bigint, bigint, timestamptz, jsonb) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION gov_repo.apply_review_transition_governed_v1(uuid, uuid, bigint, bigint, timestamptz, text, text, text, text, timestamptz, text[], text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION gov_repo.record_authorized_reconciliation_governed_v1(uuid, uuid, bigint, bigint, timestamptz, text, text, text, text, text, text, timestamptz, text, text, text, text, timestamptz, text, text, text, text, text, timestamptz, text, text, text, text, text, text, text, text[], text[], text[], text, jsonb, char) TO service_role;
GRANT EXECUTE ON FUNCTION gov_repo.materialize_object_reconciliation_governed_v1(uuid, uuid, bigint, bigint, timestamptz, text, text, text, text, text, text, text, text, text, char, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION gov_repo.materialize_relationship_reconciliation_governed_v1(uuid, uuid, bigint, bigint, timestamptz, text, text, text, text, text, text, text, text, text, text, timestamptz, timestamptz, char) TO service_role;
GRANT EXECUTE ON FUNCTION gov_repo.record_technical_field_decision_governed_v1(uuid, uuid, bigint, bigint, timestamptz, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION gov_repo.record_execution_field_decision_governed_v1(uuid, uuid, bigint, bigint, timestamptz, jsonb) TO service_role;

-- ---------------------------------------------------------------------------------------
-- ACL postflight (after ALL grants, including the broad legacy defaults). The migration
-- fails closed if the internal guard is executable by anyone but its owner, or if a
-- wrapper is executable by PUBLIC/anon/authenticated or NOT by service_role.
-- ---------------------------------------------------------------------------------------
DO $postflight$
DECLARE
  v_guard oid := 'gov_repo.require_governed_write_eligibility_v1(uuid, uuid, bigint, bigint, timestamptz)'::regprocedure;
  v_wrapper oid;
  v_role text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc p, LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
             WHERE p.oid = v_guard AND a.privilege_type = 'EXECUTE' AND a.grantee <> p.proowner) THEN
    RAISE EXCEPTION 'M16_WRAPPER_POSTFLIGHT: guard has EXECUTE for a non-owner';
  END IF;
  FOR v_wrapper IN
    SELECT p.oid FROM pg_proc p
    WHERE p.pronamespace = 'gov_repo'::regnamespace AND p.proname LIKE '%\_governed\_v1' ESCAPE '\'
  LOOP
    IF EXISTS (SELECT 1 FROM pg_proc p, LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
               WHERE p.oid = v_wrapper AND a.privilege_type = 'EXECUTE' AND a.grantee = 0) THEN
      RAISE EXCEPTION 'M16_WRAPPER_POSTFLIGHT: wrapper % has PUBLIC EXECUTE', v_wrapper::regprocedure;
    END IF;
    FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
      IF has_function_privilege(v_role, v_wrapper, 'EXECUTE') THEN
        RAISE EXCEPTION 'M16_WRAPPER_POSTFLIGHT: wrapper % executable by %', v_wrapper::regprocedure, v_role;
      END IF;
    END LOOP;
    IF NOT has_function_privilege('service_role', v_wrapper, 'EXECUTE') THEN
      RAISE EXCEPTION 'M16_WRAPPER_POSTFLIGHT: wrapper % not executable by service_role', v_wrapper::regprocedure;
    END IF;
  END LOOP;
  IF (SELECT count(*) FROM pg_proc p WHERE p.pronamespace = 'gov_repo'::regnamespace
        AND p.proname LIKE '%\_governed\_v1' ESCAPE '\') <> 6 THEN
    RAISE EXCEPTION 'M16_WRAPPER_POSTFLIGHT: expected exactly six governed wrappers';
  END IF;
END;
$postflight$;

COMMIT;
