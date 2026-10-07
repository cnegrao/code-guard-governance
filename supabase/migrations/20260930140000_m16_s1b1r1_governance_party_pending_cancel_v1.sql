-- M16-S1B.1R1: pending GovernanceParty validation cancellation — bitemporal corrective (DB only, ADDITIVE).
-- Closes S1B.1 audit finding S1B1-F1 (MEDIUM): a REVOKE required
-- revoke.effective_from > target.effective_from, so a pending future VALIDATED state could not be
-- cancelled at its own effective instant E, and an already-known state could not be corrected back to
-- its start. Frozen ruling: a Party REVOKE is legal iff revoke.effective_from >= target.effective_from.
--
-- Equal-instant meaning (bitemporal; no predecessor row is ever edited):
--   VALIDATED  effective_from = E, recorded_at = R1
--   REVOKED    effective_from = E, recorded_at = R2 > R1
--   recorded cutoff <  R2  -> the original knowledge (valid from E) stays visible;
--   recorded cutoff >= R2  -> the target is cancelled from business instant E (never valid).
-- Future E (pending cancellation) and past E (correction) are NOT special-cased: the existing temporal
-- authorization (IMMEDIATE / FUTURE_DATED / BACKDATED + the matched rule's flags) already governs them.
-- The only illegal case is revoke.effective_from < target.effective_from (GV011 DETAIL
-- REVOKE_BEFORE_TARGET_EFFECTIVE). Re-validation is unchanged (at or after the tombstone).
--
-- Both enforcement layers are replaced together and agree exactly:
--   A. gov_repo.l14_governance_party_state_guard_v1()  (trigger function; same signature)
--   B. gov_repo.l14_decide_governance_party_proposal_v1(uuid, uuid, bigint, bigint, timestamptz, text, uuid, text, text, uuid, text, text[], text) (same signature, same ACL)
-- Everything else in both bodies is byte-identical to 20260930130000 (which is NOT edited). No other
-- routine, table, fingerprint, guard order, Authority Policy evaluation, ACL or RPC signature changes;
-- no new public RPC. F2 untouched. Never run against a hosted DB from this slice.
BEGIN;

-- ---------------------------------------------------------------------------------------
-- A. State guard (defence in depth; same closed errors as the RPC).
-- ---------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION gov_repo.l14_governance_party_state_guard_v1()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, pg_temp
AS $guard$
DECLARE
  v_envelope record;
  v_proposal record;
  v_related_from timestamptz;
BEGIN
  SELECT s.state_kind, s.predecessor_state_id, s.revokes_state_id, s.effective_from, s.governance_decision_id
  INTO v_envelope
  FROM gov_repo.l14_registry_states AS s
  WHERE s.organisation_id = NEW.organisation_id AND s.state_id = NEW.state_id AND s.subject_kind = 'GOVERNANCE_PARTY';
  IF NOT FOUND OR v_envelope.state_kind IS DISTINCT FROM NEW.state_kind
     OR v_envelope.predecessor_state_id IS DISTINCT FROM NEW.predecessor_state_id
     OR v_envelope.revokes_state_id IS DISTINCT FROM NEW.revokes_state_id THEN
    RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'PARTY_STATE_ENVELOPE_MISMATCH';
  END IF;
  SELECT t.governance_party_id, t.party_kind, t.intent, t.target_state_id INTO v_proposal
  FROM gov_repo.l14_governance_decisions AS d
  JOIN gov_repo.l14_governance_party_proposals AS t
    ON t.organisation_id = d.organisation_id AND t.proposal_id = d.proposal_id
  WHERE d.organisation_id = NEW.organisation_id AND d.governance_decision_id = v_envelope.governance_decision_id;
  IF NOT FOUND OR v_proposal.governance_party_id IS DISTINCT FROM NEW.governance_party_id
     OR v_proposal.party_kind IS DISTINCT FROM NEW.party_kind
     OR v_proposal.intent IS DISTINCT FROM (CASE NEW.state_kind WHEN 'VALIDATED' THEN 'VALIDATE' ELSE 'REVOKE' END)
     OR v_proposal.target_state_id IS DISTINCT FROM NEW.revokes_state_id THEN
    RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'PARTY_STATE_PROPOSAL_MISMATCH';
  END IF;
  IF NEW.predecessor_state_id IS NOT NULL THEN
    SELECT s.effective_from INTO v_related_from
    FROM gov_repo.l14_registry_states AS s
    WHERE s.organisation_id = NEW.organisation_id AND s.state_id = NEW.predecessor_state_id;
    -- REVOKED: at or after the target's effective_from (equality = cancellation from that exact
    -- business instant; the recorded-time axis keeps the earlier knowledge). Never before it.
    -- Re-validation: never before the tombstone.
    IF NEW.state_kind = 'REVOKED' AND v_envelope.effective_from < v_related_from THEN
      RAISE EXCEPTION 'L14_CONTINUITY_VIOLATION' USING ERRCODE = 'GV011', DETAIL = 'REVOKE_BEFORE_TARGET_EFFECTIVE';
    END IF;
    IF NEW.state_kind = 'VALIDATED' AND NOT (v_envelope.effective_from >= v_related_from) THEN
      RAISE EXCEPTION 'L14_CONTINUITY_VIOLATION' USING ERRCODE = 'GV011', DETAIL = 'REVALIDATION_OVERLAPS_PRIOR_INTERVAL';
    END IF;
  END IF;
  RETURN NEW;
END;
$guard$;

-- ---------------------------------------------------------------------------------------
-- B. Decide RPC (identical signature; only the REVOKE interval rule changes).
-- ---------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION gov_repo.l14_decide_governance_party_proposal_v1(
  p_verified_organisation_id uuid,
  p_verified_actor_user_id uuid,
  p_verified_session_iat bigint,
  p_verified_session_exp bigint,
  p_verified_credential_epoch timestamptz,
  p_command_id text,
  p_proposal_id uuid,
  p_outcome text,
  p_reason_code text,
  p_expected_current_state_id uuid,         -- NULL = explicit expected-none
  p_support_status text,
  p_support_evidence_ids text[],
  p_caller_fingerprint text
)
RETURNS TABLE (
  replay boolean, command_id text, command_kind text, subject_kind text, outcome text, command_fingerprint text,
  authorization_decision_id uuid, authorization_result text, deny_reason text, proposal_id uuid,
  governance_decision_id uuid, governance_party_id uuid, party_kind text, registry_state_id uuid, state_kind text,
  effective_from timestamptz, recorded_at timestamptz
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
SET lock_timeout = '5s'
AS $decide$
#variable_conflict use_column
DECLARE
  v_org uuid := p_verified_organisation_id;
  v_actor uuid := p_verified_actor_user_id;
  v_role_ids uuid[];
  v_support text[];
  v_fingerprint text;
  v_proposal record;
  v_head record;
  v_latest_kind text;
  v_latest_from timestamptz;
  v_target_state_id uuid;
  v_has_basis boolean := false;
  v_basis_policy uuid;
  v_basis_version uuid;
  v_basis_hash text;
  v_deny text;
  v_ordinals integer[];
  v_self boolean;
  v_temporal text := 'IMMEDIATE';
  v_effective_from timestamptz;
  v_now timestamptz;
  v_authz uuid := pg_catalog.gen_random_uuid();
  v_decision uuid := pg_catalog.gen_random_uuid();
  v_state uuid := pg_catalog.gen_random_uuid();
  v_state_kind text;
BEGIN
  -- 1. Base session eligibility.
  SELECT b.role_ids INTO v_role_ids
  FROM gov_repo.l14_session_basis_v1(v_org, v_actor, p_verified_session_iat, p_verified_session_exp,
    p_verified_credential_epoch) AS b;

  -- 2. Syntactic shape.
  PERFORM gov_repo.l14_validate_command_id_v1(p_command_id, p_caller_fingerprint);
  IF p_outcome IS NULL OR p_outcome NOT IN ('VALIDATE','REJECT','DEFER','REVOKE')
     OR p_reason_code IS NULL OR p_reason_code NOT IN (
       'GOVERNANCE_PARTY_VALIDATED','GOVERNANCE_PARTY_REJECTED','GOVERNANCE_PARTY_DEFERRED','GOVERNANCE_PARTY_REVOKED')
     OR NOT ((p_outcome = 'VALIDATE' AND p_reason_code = 'GOVERNANCE_PARTY_VALIDATED')
          OR (p_outcome = 'REJECT' AND p_reason_code = 'GOVERNANCE_PARTY_REJECTED')
          OR (p_outcome = 'DEFER' AND p_reason_code = 'GOVERNANCE_PARTY_DEFERRED')
          OR (p_outcome = 'REVOKE' AND p_reason_code = 'GOVERNANCE_PARTY_REVOKED')) THEN
    RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'DECISION_VOCABULARY_INVALID';
  END IF;
  -- The immutable proposal defines the command identity (fingerprint + subject key); it is the only
  -- row read before replay arbitration, and it can never change or disappear.
  SELECT p.proposal_id, p.intent, p.source_class, p.submitted_by_actor_user_id,
         t.governance_party_id, t.party_kind, t.requested_effective_from, t.target_state_id
  INTO v_proposal
  FROM gov_repo.l14_proposals AS p
  JOIN gov_repo.l14_governance_party_proposals AS t
    ON t.organisation_id = p.organisation_id AND t.proposal_id = p.proposal_id
  WHERE p.organisation_id = v_org AND p.proposal_id = p_proposal_id AND p.subject_kind = 'GOVERNANCE_PARTY';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'PROPOSAL_UNRESOLVED';
  END IF;
  IF (p_outcome = 'VALIDATE' AND v_proposal.intent <> 'VALIDATE')
     OR (p_outcome = 'REVOKE' AND v_proposal.intent <> 'REVOKE') THEN
    RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'OUTCOME_INTENT_INCOMPATIBLE';
  END IF;

  -- 3-4. Syntactic support, then the PostgreSQL-authoritative fingerprint.
  v_support := gov_repo.l14_support_syntactic_parts_v1(p_support_status, p_support_evidence_ids);
  v_fingerprint := gov_repo.l14_sha256_frame_v1(
    ARRAY['L14_COMMAND_FINGERPRINT_V1', 'DECIDE_PROPOSAL', v_org::text, v_actor::text, p_outcome, p_reason_code,
          v_proposal.proposal_id::text, 'GOVERNANCE_PARTY', v_proposal.intent, v_proposal.source_class,
          v_proposal.governance_party_id::text, v_proposal.party_kind]
    || CASE WHEN v_proposal.requested_effective_from IS NULL THEN ARRAY['IMMEDIATE']
            ELSE ARRAY['EXPLICIT', gov_repo.l14_canonical_instant_v1(v_proposal.requested_effective_from)] END
    || CASE WHEN v_proposal.target_state_id IS NULL THEN ARRAY['NO_TARGET_STATE']
            ELSE ARRAY['TARGET_STATE', v_proposal.target_state_id::text] END
    || CASE WHEN p_expected_current_state_id IS NULL THEN ARRAY['EXPECTED_NONE']
            ELSE ARRAY['EXPECTED_CURRENT', p_expected_current_state_id::text] END
    || v_support);
  IF v_fingerprint IS DISTINCT FROM p_caller_fingerprint THEN
    RAISE EXCEPTION 'L14_FINGERPRINT_MISMATCH' USING ERRCODE = 'GV008', DETAIL = 'CALLER_FINGERPRINT_DIFFERS';
  END IF;

  -- 5-7. Guards (AP shared, subject, command), then replay arbitration.
  PERFORM gov_repo.l14_lock_authority_policy_guard_shared_v1(v_org);
  PERFORM gov_repo.l14_lock_registry_subject_guard_v1(v_org, 'GOVERNANCE_PARTY', v_proposal.governance_party_id::text);
  PERFORM gov_repo.l14_lock_command_guard_v1(v_org, p_command_id);
  IF gov_repo.l14_replay_arbitrate_v1(v_org, p_command_id, v_fingerprint) THEN
    PERFORM 1 FROM gov_repo.l14_session_basis_v1(v_org, v_actor, p_verified_session_iat,
      p_verified_session_exp, p_verified_credential_epoch);
    RETURN QUERY SELECT * FROM gov_repo.l14_governance_party_command_result_v1(v_org, p_command_id, true);
    RETURN;
  END IF;

  -- 8. Resolution (all under the subject guard): terminality, head expectation, subject rules.
  PERFORM 1 FROM gov_repo.l14_governance_decisions AS d
  WHERE d.organisation_id = v_org AND d.proposal_id = p_proposal_id AND d.outcome IN ('VALIDATE','REJECT','REVOKE');
  IF FOUND THEN
    RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'PROPOSAL_TERMINAL';
  END IF;
  SELECT h.latest_state_id INTO v_head
  FROM gov_repo.l14_governance_party_heads AS h
  WHERE h.organisation_id = v_org AND h.governance_party_id = v_proposal.governance_party_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'PARTY_UNRESOLVED';
  END IF;
  IF p_expected_current_state_id IS NULL AND v_head.latest_state_id IS NOT NULL THEN
    RAISE EXCEPTION 'L14_STALE_EXPECTATION' USING ERRCODE = 'GV009', DETAIL = 'PARTY_STATE_EXISTS';
  END IF;
  IF p_expected_current_state_id IS DISTINCT FROM v_head.latest_state_id THEN
    RAISE EXCEPTION 'L14_STALE_EXPECTATION' USING ERRCODE = 'GV009', DETAIL = 'PARTY_STATE_EXPECTATION_MISMATCH';
  END IF;
  IF v_head.latest_state_id IS NOT NULL THEN
    SELECT s.state_kind, s.effective_from INTO v_latest_kind, v_latest_from
    FROM gov_repo.l14_registry_states AS s
    WHERE s.organisation_id = v_org AND s.state_id = v_head.latest_state_id;
  END IF;
  IF p_outcome = 'VALIDATE' AND v_latest_kind = 'VALIDATED' THEN
    -- Never a second overlapping VALIDATED state: re-validation only after a tombstone.
    RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'PARTY_ALREADY_VALIDATED';
  END IF;
  IF p_outcome = 'REVOKE' THEN
    PERFORM 1 FROM gov_repo.l14_governance_party_states AS s
    WHERE s.organisation_id = v_org AND s.state_kind = 'REVOKED' AND s.revokes_state_id = v_proposal.target_state_id;
    IF FOUND THEN
      RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'TARGET_ALREADY_REVOKED';
    END IF;
    IF v_head.latest_state_id IS DISTINCT FROM v_proposal.target_state_id OR v_latest_kind IS DISTINCT FROM 'VALIDATED' THEN
      RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'TARGET_STATE_NOT_CURRENT';
    END IF;
    v_target_state_id := v_proposal.target_state_id;
  END IF;
  PERFORM gov_repo.l14_resolve_support_v1(v_org, p_support_evidence_ids);

  -- 9. One DB evaluation instant; temporal class; the CURRENT effective policy is the ONLY basis.
  v_now := pg_catalog.clock_timestamp();
  IF p_outcome IN ('VALIDATE','REVOKE') THEN
    IF v_proposal.requested_effective_from IS NULL OR v_proposal.requested_effective_from = v_now THEN
      v_effective_from := v_now;
    ELSIF v_proposal.requested_effective_from < v_now THEN
      v_effective_from := v_proposal.requested_effective_from;
      v_temporal := 'BACKDATED';
    ELSE
      v_effective_from := v_proposal.requested_effective_from;
      v_temporal := 'FUTURE_DATED';
    END IF;
  END IF;
  v_self := v_proposal.submitted_by_actor_user_id = v_actor;
  SELECT b.authority_policy_id, b.version_id, b.content_hash INTO v_basis_policy, v_basis_version, v_basis_hash
  FROM gov_repo.l14_effective_authority_basis_v1(v_org, v_now) AS b;
  v_has_basis := FOUND;
  IF NOT v_has_basis THEN
    v_deny := 'NO_EFFECTIVE_AUTHORITY';
  ELSE
    SELECT e.deny_reason, e.rule_ordinals INTO v_deny, v_ordinals
    FROM gov_repo.l14_evaluate_authority_rules_v1(v_org, v_basis_policy, v_basis_version, v_role_ids,
      'L14_PARTY_VALIDATE', p_outcome, p_outcome = 'VALIDATE' AND v_self, v_temporal) AS e;
  END IF;

  INSERT INTO gov_repo.l14_authorization_decisions (
    organisation_id, authorization_decision_id, command_id, command_fingerprint, actor_user_id,
    requested_action, subject_kind, scope_tag, source_class, proposal_id, is_self_validation,
    authority_basis, basis_authority_policy_id, basis_version_id, basis_content_hash, result, deny_reason,
    evaluated_at, expectation_kind, expected_current_state_id)
  VALUES (
    v_org, v_authz, p_command_id, v_fingerprint, v_actor,
    p_outcome, 'GOVERNANCE_PARTY', 'ALL_ALLOWED_TARGETS', v_proposal.source_class, p_proposal_id, v_self,
    CASE WHEN v_has_basis THEN 'AUTHORITY_POLICY_VERSION' END,
    CASE WHEN v_has_basis THEN v_basis_policy END,
    CASE WHEN v_has_basis THEN v_basis_version END,
    CASE WHEN v_has_basis THEN v_basis_hash END,
    CASE WHEN v_deny IS NULL THEN 'ALLOW' ELSE 'DENY' END, v_deny, v_now,
    CASE WHEN p_expected_current_state_id IS NULL THEN 'EXPECTED_NONE' ELSE 'EXPECTED_CURRENT' END,
    p_expected_current_state_id);
  PERFORM gov_repo.l14_snapshot_roles_v1(v_org, v_authz, v_role_ids);
  IF v_has_basis THEN
    PERFORM gov_repo.l14_snapshot_policy_rules_v1(v_org, v_authz, v_basis_policy, v_basis_version, v_ordinals);
  END IF;

  IF v_deny IS NOT NULL THEN
    INSERT INTO gov_repo.l14_command_results (organisation_id, command_id, command_kind, subject_kind,
      command_fingerprint, actor_user_id, outcome, authorization_decision_id, proposal_id, recorded_at)
    VALUES (v_org, p_command_id, 'DECIDE_PROPOSAL', 'GOVERNANCE_PARTY', v_fingerprint, v_actor, 'DENIED', v_authz,
      p_proposal_id, v_now);
  ELSE
    -- 10. Party interval rules (authorized commands only; a violation raises and rolls back).
    -- R1: equality is legal (cancellation / correction from the target's own start); only a
    -- revocation strictly BEFORE the target's effective_from is rejected. Same rule as the state guard.
    IF p_outcome = 'REVOKE' AND v_effective_from < v_latest_from THEN
      RAISE EXCEPTION 'L14_CONTINUITY_VIOLATION' USING ERRCODE = 'GV011', DETAIL = 'REVOKE_BEFORE_TARGET_EFFECTIVE';
    END IF;
    IF p_outcome = 'VALIDATE' AND v_latest_kind = 'REVOKED' AND NOT (v_effective_from >= v_latest_from) THEN
      RAISE EXCEPTION 'L14_CONTINUITY_VIOLATION' USING ERRCODE = 'GV011', DETAIL = 'REVALIDATION_OVERLAPS_PRIOR_INTERVAL';
    END IF;

    INSERT INTO gov_repo.l14_governance_decisions (organisation_id, governance_decision_id, proposal_id,
      subject_kind, outcome, reason_code, authorization_decision_id, actor_user_id, support_status, decided_at)
    VALUES (v_org, v_decision, p_proposal_id, 'GOVERNANCE_PARTY', p_outcome, p_reason_code, v_authz, v_actor,
      p_support_status, v_now);
    INSERT INTO gov_repo.l14_support_links (organisation_id, support_link_id, owner_kind, governance_decision_id, evidence_id)
    SELECT v_org, pg_catalog.gen_random_uuid(), 'GOVERNANCE_DECISION', v_decision, i.id
    FROM pg_catalog.unnest(p_support_evidence_ids) AS i(id);

    IF p_outcome IN ('VALIDATE','REVOKE') THEN
      v_state_kind := CASE WHEN p_outcome = 'VALIDATE' THEN 'VALIDATED' ELSE 'REVOKED' END;
      -- Append-only: predecessor = the expected head state; the target state is never modified.
      INSERT INTO gov_repo.l14_registry_states (organisation_id, state_id, subject_kind, state_kind,
        predecessor_state_id, revokes_state_id, effective_from, recorded_at, governance_decision_id,
        authorization_decision_id, authority_policy_id, authority_policy_version_id, authority_policy_content_hash,
        trust_state, source_class, support_status)
      VALUES (v_org, v_state, 'GOVERNANCE_PARTY', v_state_kind, v_head.latest_state_id, v_target_state_id,
        v_effective_from, v_now, v_decision, v_authz, v_basis_policy, v_basis_version, v_basis_hash,
        'VALIDATED', v_proposal.source_class, p_support_status);
      INSERT INTO gov_repo.l14_governance_party_states (organisation_id, state_id, subject_kind, state_kind,
        governance_party_id, party_kind, predecessor_state_id, revokes_state_id)
      VALUES (v_org, v_state, 'GOVERNANCE_PARTY', v_state_kind, v_proposal.governance_party_id, v_proposal.party_kind,
        v_head.latest_state_id, v_target_state_id);
      -- Technical head: compare-and-set on the exact expectation.
      UPDATE gov_repo.l14_governance_party_heads AS h SET latest_state_id = v_state
      WHERE h.organisation_id = v_org AND h.governance_party_id = v_proposal.governance_party_id
        AND h.latest_state_id IS NOT DISTINCT FROM p_expected_current_state_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'L14_STALE_EXPECTATION' USING ERRCODE = 'GV009', DETAIL = 'PARTY_STATE_EXPECTATION_MISMATCH';
      END IF;
      INSERT INTO gov_repo.l14_support_links (organisation_id, support_link_id, owner_kind, registry_state_id, evidence_id)
      SELECT v_org, pg_catalog.gen_random_uuid(), 'REGISTRY_STATE', v_state, i.id
      FROM pg_catalog.unnest(p_support_evidence_ids) AS i(id);
      INSERT INTO gov_repo.l14_command_results (organisation_id, command_id, command_kind, subject_kind,
        command_fingerprint, actor_user_id, outcome, authorization_decision_id, proposal_id, governance_decision_id,
        registry_state_id, recorded_at)
      VALUES (v_org, p_command_id, 'DECIDE_PROPOSAL', 'GOVERNANCE_PARTY', v_fingerprint, v_actor, v_state_kind,
        v_authz, p_proposal_id, v_decision, v_state, v_now);
    ELSE
      -- REJECT / DEFER: governance decision only; no state, no head change.
      INSERT INTO gov_repo.l14_command_results (organisation_id, command_id, command_kind, subject_kind,
        command_fingerprint, actor_user_id, outcome, authorization_decision_id, proposal_id, governance_decision_id,
        recorded_at)
      VALUES (v_org, p_command_id, 'DECIDE_PROPOSAL', 'GOVERNANCE_PARTY', v_fingerprint, v_actor,
        CASE WHEN p_outcome = 'REJECT' THEN 'REJECTED' ELSE 'DEFERRED' END, v_authz, p_proposal_id, v_decision, v_now);
    END IF;
  END IF;

  -- 11. Base session eligibility at commitment.
  PERFORM 1 FROM gov_repo.l14_session_basis_v1(v_org, v_actor, p_verified_session_iat,
    p_verified_session_exp, p_verified_credential_epoch);
  RETURN QUERY SELECT * FROM gov_repo.l14_governance_party_command_result_v1(v_org, p_command_id, false);
END;
$decide$;

-- CREATE OR REPLACE preserves ACLs; they are re-asserted explicitly anyway.
REVOKE ALL ON FUNCTION
  gov_repo.l14_governance_party_state_guard_v1(),
  gov_repo.l14_decide_governance_party_proposal_v1(uuid, uuid, bigint, bigint, timestamptz, text, uuid, text, text, uuid, text, text[], text)
FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION
  gov_repo.l14_decide_governance_party_proposal_v1(uuid, uuid, bigint, bigint, timestamptz, text, uuid, text, text, uuid, text, text[], text)
TO service_role;

-- ---------------------------------------------------------------------------------------
-- C. Postflight: both layers corrected and in agreement; the public surface is unchanged.
-- ---------------------------------------------------------------------------------------
DO $postflight$
DECLARE
  v_public_rpcs CONSTANT text[] := ARRAY[
    'l14_admit_authority_policy_version_v1','l14_admit_governance_party_v1','l14_decide_authority_policy_proposal_v1',
    'l14_decide_governance_party_proposal_v1','l14_submit_governance_party_proposal_v1','l14_submit_proposal_v1'];
  v_fn record;
  v_role text;
BEGIN
  FOR v_fn IN
    SELECT p.proname, p.prosrc FROM pg_catalog.pg_proc AS p
    WHERE p.oid IN ('gov_repo.l14_governance_party_state_guard_v1()'::regprocedure, 'gov_repo.l14_decide_governance_party_proposal_v1(uuid, uuid, bigint, bigint, timestamptz, text, uuid, text, text, uuid, text, text[], text)'::regprocedure)
  LOOP
    IF v_fn.prosrc LIKE '%REVOKE\_NOT\_AFTER\_TARGET\_EFFECTIVE%' ESCAPE '\'
       OR v_fn.prosrc NOT LIKE '%REVOKE\_BEFORE\_TARGET\_EFFECTIVE%' ESCAPE '\'
       OR v_fn.prosrc NOT LIKE '%REVALIDATION\_OVERLAPS\_PRIOR\_INTERVAL%' ESCAPE '\' THEN
      RAISE EXCEPTION 'M16_S1B1R1_POSTFLIGHT: % does not carry the corrected REVOKE interval rule', v_fn.proname;
    END IF;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger AS t
                 WHERE t.tgrelid = 'gov_repo.l14_governance_party_states'::regclass AND t.tgname = 'l14_governance_party_states_guard'
                   AND t.tgenabled = 'A' AND t.tgfoid = 'gov_repo.l14_governance_party_state_guard_v1()'::regprocedure) THEN
    RAISE EXCEPTION 'M16_S1B1R1_POSTFLIGHT: Party state guard trigger missing or not ALWAYS';
  END IF;
  FOR v_fn IN
    SELECT p.oid, p.proname, p.proowner, p.proacl, p.prosecdef, p.proconfig
    FROM pg_catalog.pg_proc AS p
    WHERE p.pronamespace = 'gov_repo'::regnamespace AND p.proname LIKE 'l14\_%' ESCAPE '\'
  LOOP
    IF NOT COALESCE(v_fn.proconfig @> ARRAY['search_path=pg_catalog, pg_temp'], false) THEN
      RAISE EXCEPTION 'M16_S1B1R1_POSTFLIGHT: % search_path not pinned', v_fn.proname;
    END IF;
    IF v_fn.proname::text = ANY (v_public_rpcs) THEN
      IF NOT v_fn.prosecdef OR NOT pg_catalog.has_function_privilege('service_role', v_fn.oid, 'EXECUTE')
         OR EXISTS (SELECT 1 FROM pg_catalog.aclexplode(v_fn.proacl) AS a
                    WHERE a.grantee NOT IN (v_fn.proowner, 'service_role'::regrole::oid)) THEN
        RAISE EXCEPTION 'M16_S1B1R1_POSTFLIGHT: public RPC % ACL/definer shape wrong', v_fn.proname;
      END IF;
    ELSIF v_fn.prosecdef OR EXISTS (SELECT 1 FROM pg_catalog.aclexplode(COALESCE(v_fn.proacl,
            pg_catalog.acldefault('f', v_fn.proowner))) AS a WHERE a.grantee <> v_fn.proowner) THEN
      RAISE EXCEPTION 'M16_S1B1R1_POSTFLIGHT: internal helper % must be owner-only SECURITY INVOKER', v_fn.proname;
    END IF;
    FOREACH v_role IN ARRAY ARRAY['anon','authenticated'] LOOP
      IF pg_catalog.has_function_privilege(v_role, v_fn.oid, 'EXECUTE') THEN
        RAISE EXCEPTION 'M16_S1B1R1_POSTFLIGHT: % executable by %', v_fn.proname, v_role;
      END IF;
    END LOOP;
  END LOOP;
  IF (SELECT pg_catalog.count(*) FROM pg_catalog.pg_proc AS p
      WHERE p.pronamespace = 'gov_repo'::regnamespace AND p.proname LIKE 'l14\_%' ESCAPE '\'
        AND pg_catalog.has_function_privilege('service_role', p.oid, 'EXECUTE')) <> 6
     OR (SELECT pg_catalog.count(*) FROM pg_catalog.pg_proc AS p
      WHERE p.pronamespace = 'gov_repo'::regnamespace AND p.proname::text = ANY (v_public_rpcs)) <> 6
     OR (SELECT pg_catalog.count(*) FROM pg_catalog.pg_proc AS p
      WHERE p.pronamespace = 'gov_repo'::regnamespace AND p.proname LIKE 'l14\_%' ESCAPE '\' AND p.prosecdef) <> 6 THEN
    RAISE EXCEPTION 'M16_S1B1R1_POSTFLIGHT: the public L14 RPC surface must remain exactly the six S1B.1 RPCs';
  END IF;
  IF (SELECT pg_catalog.count(*) FROM pg_catalog.pg_proc AS p WHERE p.pronamespace = 'gov_repo'::regnamespace
        AND p.proname LIKE '%\_governed\_v1' ESCAPE '\') <> 6 THEN
    RAISE EXCEPTION 'M16_S1B1R1_POSTFLIGHT: S0 naming contract disturbed';
  END IF;
END;
$postflight$;

COMMIT;
