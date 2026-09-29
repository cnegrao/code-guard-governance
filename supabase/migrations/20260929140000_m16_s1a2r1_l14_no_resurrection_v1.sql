-- M16-S1A.2R1: L14 Authority Policy no-resurrection corrective (DB only, ADDITIVE).
-- Closes adversarial finding F-1 (BLOCKER): the S1A.2 continuity helper classified a VALIDATED
-- state as "cancelled" whenever revocation.effective_from <= target.effective_from, without
-- regard to whether the target had ALREADY become effective when the tombstone was RECORDED.
-- A backdated REVOKE of an already-effective version could therefore erase its reign and make a
-- superseded predecessor authoritative again. Also closes F-2 (LOW): reusing a cancelled
-- state's VALIDATED instant surfaced as raw 23505 instead of a closed governance error.
--
-- Frozen model (architecture-owner S1A.2R1 instruction):
--   PENDING CANCELLATION  target.effective_from > tombstone.recorded_at
--                         AND tombstone.effective_from <= target.effective_from
--                         → the target never becomes effective as known after the tombstone.
--   ORDINARY REVOCATION   every other tombstone → the target is/was in the schedule; an already
--                         VALIDATED successor must own the schedule at the revocation cutover.
--   An already-effective target (target.effective_from <= DB instant) revoked at or before its
--   own effective_from fails GV011 DETAIL BACKDATED_REVOKE_WOULD_RESURRECT.
--
-- The audited S1A.1 (20260929120000) and S1A.2 (20260929130000) migrations are NOT edited.
-- Public RPC signatures are unchanged: only the body of
-- gov_repo.l14_decide_authority_policy_proposal_v1 is replaced (CREATE OR REPLACE, identical
-- signature and ACL). The obsolete gov_repo.l14_authority_policy_schedule_continuous_v1 is
-- dropped so no incorrect continuity implementation stays live. The bitemporal resolver is
-- unchanged: with the corrected continuity enforced on every append, every accepted history has,
-- at every instant from the first validation onward, a latest non-cancelled VALIDATED state that
-- is not revoked, which is exactly the resolver's answer — it never falls back to a superseded
-- predecessor. No canonical_relationships DDL/DML (F2 untouched). Never run against a hosted DB.
BEGIN;

-- Recorded-time-aware continuity. With the recorded states plus ONE hypothetical appended state
-- (its effective_from AND recorded_at), from the organisation's first validated instant onward,
-- at every breakpoint the latest non-cancelled VALIDATED state must exist, be unique, and not be
-- revoked by then. Only a PENDING target may be cancelled; a superseded predecessor is never a
-- successor, so a revocation can neither open a gap nor resurrect it.
CREATE FUNCTION gov_repo.l14_authority_policy_schedule_continuous_v2(
  p_organisation_id uuid, p_new_state_kind text, p_new_state_id uuid, p_new_effective_from timestamptz,
  p_new_recorded_at timestamptz, p_new_revokes_state_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = pg_catalog, pg_temp
AS $$
  WITH states AS (
    SELECT s.state_id, s.state_kind, s.effective_from, s.recorded_at, s.revokes_state_id
    FROM gov_repo.l14_authority_policy_states AS s WHERE s.organisation_id = p_organisation_id
    UNION ALL
    SELECT p_new_state_id, p_new_state_kind, p_new_effective_from, p_new_recorded_at, p_new_revokes_state_id
    WHERE p_new_state_kind IS NOT NULL
  ), revocations AS (
    SELECT s.revokes_state_id AS target_state_id, s.effective_from AS revoked_from, s.recorded_at AS revoked_recorded_at
    FROM states AS s WHERE s.state_kind = 'REVOKED'
  ), active AS (
    SELECT v.state_id, v.effective_from FROM states AS v
    WHERE v.state_kind = 'VALIDATED'
      AND NOT EXISTS (SELECT 1 FROM revocations AS r
                      WHERE r.target_state_id = v.state_id
                        AND v.effective_from > r.revoked_recorded_at      -- still PENDING when recorded
                        AND r.revoked_from <= v.effective_from)            -- revoked before its start
  ), origin AS (
    SELECT pg_catalog.min(s.effective_from) AS first_from FROM states AS s WHERE s.state_kind = 'VALIDATED'
  ), breakpoints AS (
    SELECT DISTINCT s.effective_from AS instant FROM states AS s, origin AS o WHERE s.effective_from >= o.first_from
  ), evaluated AS (
    SELECT b.instant,
           (SELECT pg_catalog.count(*) FROM active AS a
            WHERE a.effective_from = (SELECT pg_catalog.max(a2.effective_from) FROM active AS a2 WHERE a2.effective_from <= b.instant)) AS latest_count,
           (SELECT a.state_id FROM active AS a WHERE a.effective_from <= b.instant ORDER BY a.effective_from DESC LIMIT 1) AS latest_state_id
    FROM breakpoints AS b
  )
  SELECT (SELECT o.first_from FROM origin AS o) IS NOT NULL
     AND (p_new_state_kind IS NULL OR p_new_recorded_at IS NOT NULL)
     AND EXISTS (SELECT 1 FROM active)
     AND NOT EXISTS (
       SELECT 1 FROM evaluated AS e
       WHERE e.latest_count <> 1 OR e.latest_state_id IS NULL
          OR EXISTS (SELECT 1 FROM revocations AS r WHERE r.target_state_id = e.latest_state_id AND r.revoked_from <= e.instant))
$$;

-- Replace ONLY the body of the decide RPC (identical signature; ACL re-asserted below).
CREATE OR REPLACE FUNCTION gov_repo.l14_decide_authority_policy_proposal_v1(
  p_verified_organisation_id uuid,
  p_verified_actor_user_id uuid,
  p_verified_session_iat bigint,
  p_verified_session_exp bigint,
  p_verified_credential_epoch timestamptz,
  p_command_id text,
  p_proposal_id uuid,
  p_outcome text,
  p_reason_code text,
  p_expected_current_state_id uuid,
  p_support_status text,
  p_support_evidence_ids text[],
  p_caller_fingerprint text
)
RETURNS TABLE (
  replay boolean, command_id text, command_kind text, outcome text, command_fingerprint text,
  authorization_decision_id uuid, authorization_result text, deny_reason text, proposal_id uuid,
  governance_decision_id uuid, authority_policy_id uuid, version_id uuid, content_hash text,
  state_id uuid, effective_from timestamptz, recorded_at timestamptz
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
  v_bootstrap_role boolean;
  v_support text[];
  v_fingerprint text;
  v_proposal record;
  v_version_number integer;
  v_version_hash text;
  v_head record;
  v_target record;
  v_target_state_id uuid;
  v_target_effective_from timestamptz;
  v_has_basis boolean := false;
  v_basis_policy uuid;
  v_basis_version uuid;
  v_basis_hash text;
  v_bootstrap boolean;
  v_deny text;
  v_ordinals integer[];
  v_self boolean;
  v_temporal text := 'IMMEDIATE';
  v_effective_from timestamptz;
  v_latest_active_from timestamptz;
  v_now timestamptz;
  v_authz uuid := pg_catalog.gen_random_uuid();
  v_decision uuid := pg_catalog.gen_random_uuid();
  v_state uuid := pg_catalog.gen_random_uuid();
  v_state_kind text;
BEGIN
  SELECT b.role_ids, b.has_bootstrap_role INTO v_role_ids, v_bootstrap_role
  FROM gov_repo.l14_session_basis_v1(v_org, v_actor, p_verified_session_iat, p_verified_session_exp,
    p_verified_credential_epoch) AS b;

  PERFORM gov_repo.l14_validate_command_id_v1(p_command_id, p_caller_fingerprint);
  IF p_outcome IS NULL OR p_outcome NOT IN ('VALIDATE','REJECT','DEFER','REVOKE')
     OR p_reason_code IS NULL OR p_reason_code NOT IN (
       'AUTHORITY_POLICY_VALIDATED','AUTHORITY_POLICY_REJECTED','AUTHORITY_POLICY_DEFERRED','AUTHORITY_POLICY_REVOKED')
     OR NOT ((p_outcome = 'VALIDATE' AND p_reason_code = 'AUTHORITY_POLICY_VALIDATED')
          OR (p_outcome = 'REJECT' AND p_reason_code = 'AUTHORITY_POLICY_REJECTED')
          OR (p_outcome = 'DEFER' AND p_reason_code = 'AUTHORITY_POLICY_DEFERRED')
          OR (p_outcome = 'REVOKE' AND p_reason_code = 'AUTHORITY_POLICY_REVOKED')) THEN
    RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'DECISION_VOCABULARY_INVALID';
  END IF;

  SELECT p.proposal_id, p.subject_kind, p.intent, p.source_class, p.submitted_by_actor_user_id,
         t.authority_policy_id, t.version_id, t.content_hash, t.requested_effective_from, t.target_state_id
  INTO v_proposal
  FROM gov_repo.l14_proposals AS p
  JOIN gov_repo.l14_authority_policy_version_proposals AS t
    ON t.organisation_id = p.organisation_id AND t.proposal_id = p.proposal_id
  WHERE p.organisation_id = v_org AND p.proposal_id = p_proposal_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'PROPOSAL_UNRESOLVED';
  END IF;
  -- VALIDATE intent: VALIDATE/REJECT/DEFER. REVOKE intent: REVOKE/REJECT/DEFER only; a REVOKE
  -- proposal can never VALIDATE a replacement.
  IF (p_outcome = 'VALIDATE' AND v_proposal.intent <> 'VALIDATE')
     OR (p_outcome = 'REVOKE' AND v_proposal.intent <> 'REVOKE') THEN
    RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'OUTCOME_INTENT_INCOMPATIBLE';
  END IF;
  SELECT v.version_number, v.content_hash INTO v_version_number, v_version_hash
  FROM gov_repo.l14_authority_policy_versions AS v
  WHERE v.organisation_id = v_org AND v.authority_policy_id = v_proposal.authority_policy_id
    AND v.version_id = v_proposal.version_id;
  IF NOT FOUND OR v_version_hash IS DISTINCT FROM v_proposal.content_hash
     OR gov_repo.l14_stored_authority_policy_content_hash_v1(v_org, v_proposal.authority_policy_id,
          v_proposal.version_id) IS DISTINCT FROM v_proposal.content_hash THEN
    RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'PINNED_CONTENT_HASH_MISMATCH';
  END IF;
  v_support := gov_repo.l14_support_parts_v1(v_org, p_support_status, p_support_evidence_ids);

  v_fingerprint := gov_repo.l14_sha256_frame_v1(
    ARRAY['L14_COMMAND_FINGERPRINT_V1', 'DECIDE_PROPOSAL', v_org::text, v_actor::text, p_outcome, p_reason_code,
          v_proposal.proposal_id::text, v_proposal.subject_kind, v_proposal.intent, v_proposal.source_class,
          v_proposal.authority_policy_id::text, v_proposal.version_id::text, v_proposal.content_hash]
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

  PERFORM gov_repo.l14_lock_authority_policy_guard_v1(v_org);
  IF gov_repo.l14_replay_arbitrate_v1(v_org, p_command_id, v_fingerprint) THEN
    PERFORM 1 FROM gov_repo.l14_session_basis_v1(v_org, v_actor, p_verified_session_iat,
      p_verified_session_exp, p_verified_credential_epoch);
    RETURN QUERY SELECT * FROM gov_repo.l14_command_result_v1(v_org, p_command_id, true);
    RETURN;
  END IF;

  PERFORM 1 FROM gov_repo.l14_governance_decisions AS d
  WHERE d.organisation_id = v_org AND d.proposal_id = p_proposal_id AND d.outcome IN ('VALIDATE','REJECT','REVOKE');
  IF FOUND THEN
    RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'PROPOSAL_TERMINAL';
  END IF;

  SELECT h.authority_policy_id, h.latest_state_id INTO v_head
  FROM gov_repo.l14_authority_policy_heads AS h WHERE h.organisation_id = v_org;
  IF NOT FOUND OR v_head.authority_policy_id IS DISTINCT FROM v_proposal.authority_policy_id THEN
    RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'AUTHORITY_POLICY_UNRESOLVED';
  END IF;
  -- Exact expected-current / expected-none against the technical head.
  IF p_expected_current_state_id IS NULL AND v_head.latest_state_id IS NOT NULL THEN
    RAISE EXCEPTION 'L14_STALE_EXPECTATION' USING ERRCODE = 'GV009', DETAIL = 'AUTHORITY_POLICY_STATE_EXISTS';
  END IF;
  IF p_expected_current_state_id IS DISTINCT FROM v_head.latest_state_id THEN
    RAISE EXCEPTION 'L14_STALE_EXPECTATION' USING ERRCODE = 'GV009', DETAIL = 'AUTHORITY_POLICY_STATE_EXPECTATION_MISMATCH';
  END IF;

  v_self := v_proposal.submitted_by_actor_user_id = v_actor;
  v_bootstrap := v_head.latest_state_id IS NULL;

  IF v_bootstrap THEN
    -- Bounded bootstrap: ONLY VALIDATE of the exact first version, immediate only (S1A.1).
    IF v_version_number <> 1 THEN
      RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'BOOTSTRAP_VERSION_MISMATCH';
    END IF;
    IF NOT v_bootstrap_role THEN
      v_deny := 'BOOTSTRAP_ROLE_REQUIRED';
    ELSIF p_outcome <> 'VALIDATE' THEN
      v_deny := 'BOOTSTRAP_ACTION_NOT_PERMITTED';
    ELSIF v_proposal.requested_effective_from IS NOT NULL THEN
      v_deny := 'TEMPORAL_ACTION_NOT_AUTHORIZED';
    END IF;
    v_now := pg_catalog.clock_timestamp();
    v_effective_from := v_now;
  ELSE
    -- Subject checks for the successor lifecycle (never rewrite history).
    IF p_outcome = 'VALIDATE' THEN
      PERFORM 1 FROM gov_repo.l14_authority_policy_states AS s
      WHERE s.organisation_id = v_org AND s.version_id = v_proposal.version_id AND s.state_kind = 'VALIDATED';
      IF FOUND THEN
        RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'VERSION_ALREADY_VALIDATED';
      END IF;
    ELSIF p_outcome = 'REVOKE' THEN
      SELECT s.state_id, s.state_kind, s.authority_policy_id, s.version_id, s.content_hash, s.effective_from INTO v_target
      FROM gov_repo.l14_authority_policy_states AS s
      WHERE s.organisation_id = v_org AND s.state_id = v_proposal.target_state_id;
      IF NOT FOUND OR v_target.state_kind <> 'VALIDATED'
         OR v_target.authority_policy_id <> v_proposal.authority_policy_id
         OR v_target.version_id <> v_proposal.version_id OR v_target.content_hash <> v_proposal.content_hash THEN
        RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'TARGET_STATE_INVALID';
      END IF;
      PERFORM 1 FROM gov_repo.l14_authority_policy_states AS s
      WHERE s.organisation_id = v_org AND s.state_kind = 'REVOKED' AND s.revokes_state_id = v_target.state_id;
      IF FOUND THEN
        RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'TARGET_ALREADY_REVOKED';
      END IF;
      v_target_state_id := v_target.state_id;
      v_target_effective_from := v_target.effective_from;
    END IF;

    -- One DB evaluation instant after all locks; the CURRENT effective version is the ONLY basis.
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
    SELECT b.authority_policy_id, b.version_id, b.content_hash INTO v_basis_policy, v_basis_version, v_basis_hash
    FROM gov_repo.l14_effective_authority_basis_v1(v_org, v_now) AS b;
    v_has_basis := FOUND;
    IF NOT v_has_basis THEN
      v_deny := 'NO_EFFECTIVE_AUTHORITY';
    ELSIF p_outcome = 'VALIDATE' AND v_basis_version = v_proposal.version_id THEN
      v_deny := 'SUCCESSOR_SELF_AUTHORIZATION_FORBIDDEN';
    ELSE
      SELECT e.deny_reason, e.rule_ordinals INTO v_deny, v_ordinals
      FROM gov_repo.l14_evaluate_authority_rules_v1(v_org, v_basis_policy, v_basis_version, v_role_ids,
        'L14_AUTHORITY_POLICY_ADMIN', p_outcome, p_outcome = 'VALIDATE' AND v_self, v_temporal) AS e;
    END IF;
  END IF;

  INSERT INTO gov_repo.l14_authorization_decisions (
    organisation_id, authorization_decision_id, command_id, command_fingerprint, actor_user_id,
    requested_action, subject_kind, scope_tag, source_class, proposal_id, is_self_validation,
    subject_authority_policy_id, subject_version_id, authority_basis, basis_authority_policy_id,
    basis_version_id, basis_content_hash, result, deny_reason, evaluated_at)
  VALUES (
    v_org, v_authz, p_command_id, v_fingerprint, v_actor,
    p_outcome, 'AUTHORITY_POLICY_VERSION', 'ALL_ALLOWED_TARGETS', v_proposal.source_class, p_proposal_id, v_self,
    v_proposal.authority_policy_id, v_proposal.version_id,
    CASE WHEN v_bootstrap THEN 'SYSTEM_BOOTSTRAP_L14_AUTHORITY_V1'
         WHEN v_has_basis THEN 'AUTHORITY_POLICY_VERSION' END,
    CASE WHEN v_has_basis THEN v_basis_policy END,
    CASE WHEN v_has_basis THEN v_basis_version END,
    CASE WHEN v_has_basis THEN v_basis_hash END,
    CASE WHEN v_deny IS NULL THEN 'ALLOW' ELSE 'DENY' END, v_deny, v_now);
  PERFORM gov_repo.l14_snapshot_roles_v1(v_org, v_authz, v_role_ids);
  IF v_bootstrap AND v_bootstrap_role THEN
    INSERT INTO gov_repo.l14_authorization_decision_rules (organisation_id, authorization_decision_id,
      snapshot_ordinal, permission_origin, permission, requested_action, source_class, source_disposition,
      scope_tag, allow_self_validation, allow_future_dating, allow_backdating)
    VALUES (v_org, v_authz, 1, 'SYSTEM_BOOTSTRAP', 'L14_AUTHORITY_POLICY_ADMIN', 'VALIDATE', 'LOCAL_HUMAN',
      'AUTHORITATIVE', 'ALL_ALLOWED_TARGETS', true, false, false);
  ELSIF v_has_basis THEN
    PERFORM gov_repo.l14_snapshot_policy_rules_v1(v_org, v_authz, v_basis_policy, v_basis_version, v_ordinals);
  END IF;

  IF v_deny IS NOT NULL THEN
    INSERT INTO gov_repo.l14_command_results (organisation_id, command_id, command_kind, command_fingerprint,
      actor_user_id, outcome, authorization_decision_id, proposal_id, authority_policy_id, version_id, recorded_at)
    VALUES (v_org, p_command_id, 'DECIDE_PROPOSAL', v_fingerprint, v_actor, 'DENIED', v_authz, p_proposal_id,
      v_proposal.authority_policy_id, v_proposal.version_id, v_now);
  ELSE
    -- Continuity (authorized commands only; a violation raises and rolls back everything).
    IF NOT v_bootstrap AND p_outcome = 'VALIDATE' THEN
      -- F-2: an instant already used by ANY VALIDATED state (including a cancelled one) is a
      -- closed governance error, never raw 23505 (the unique index stays as defence in depth).
      PERFORM 1 FROM gov_repo.l14_authority_policy_states AS s
      WHERE s.organisation_id = v_org AND s.state_kind = 'VALIDATED' AND s.effective_from = v_effective_from;
      IF FOUND THEN
        RAISE EXCEPTION 'L14_CONTINUITY_VIOLATION' USING ERRCODE = 'GV011', DETAIL = 'EFFECTIVE_INSTANT_ALREADY_USED';
      END IF;
      -- Latest non-cancelled VALIDATED instant (recorded-time-aware cancellation).
      SELECT pg_catalog.max(s.effective_from) INTO v_latest_active_from
      FROM gov_repo.l14_authority_policy_states AS s
      WHERE s.organisation_id = v_org AND s.state_kind = 'VALIDATED'
        AND NOT EXISTS (SELECT 1 FROM gov_repo.l14_authority_policy_states AS r
                        WHERE r.organisation_id = s.organisation_id AND r.state_kind = 'REVOKED'
                          AND r.revokes_state_id = s.state_id
                          AND s.effective_from > r.recorded_at AND r.effective_from <= s.effective_from);
      IF v_latest_active_from IS NULL OR v_effective_from <= v_latest_active_from THEN
        RAISE EXCEPTION 'L14_CONTINUITY_VIOLATION' USING ERRCODE = 'GV011', DETAIL = 'EFFECTIVE_FROM_NOT_STRICTLY_AFTER_SCHEDULE';
      END IF;
    END IF;
    IF NOT v_bootstrap AND p_outcome = 'REVOKE' THEN
      -- F-1: an already-effective target can never be turned into a "pending cancellation" by
      -- choosing a revocation instant at or before its own effective_from.
      IF v_target_effective_from <= v_now AND v_effective_from <= v_target_effective_from THEN
        RAISE EXCEPTION 'L14_CONTINUITY_VIOLATION' USING ERRCODE = 'GV011', DETAIL = 'BACKDATED_REVOKE_WOULD_RESURRECT';
      END IF;
    END IF;
    IF NOT v_bootstrap AND p_outcome IN ('VALIDATE','REVOKE') THEN
      v_state_kind := CASE WHEN p_outcome = 'VALIDATE' THEN 'VALIDATED' ELSE 'REVOKED' END;
      IF NOT gov_repo.l14_authority_policy_schedule_continuous_v2(v_org, v_state_kind, v_state, v_effective_from,
           v_now, v_target_state_id) THEN
        RAISE EXCEPTION 'L14_CONTINUITY_VIOLATION' USING ERRCODE = 'GV011', DETAIL = 'NO_EFFECTIVE_AUTHORITY_AT_CUTOVER';
      END IF;
    END IF;

    INSERT INTO gov_repo.l14_governance_decisions (organisation_id, governance_decision_id, proposal_id,
      subject_kind, outcome, reason_code, authorization_decision_id, actor_user_id, target_authority_policy_id,
      target_version_id, target_content_hash, support_status, decided_at)
    VALUES (v_org, v_decision, p_proposal_id, 'AUTHORITY_POLICY_VERSION', p_outcome, p_reason_code,
      v_authz, v_actor, v_proposal.authority_policy_id, v_proposal.version_id, v_proposal.content_hash,
      p_support_status, v_now);
    INSERT INTO gov_repo.l14_support_links (organisation_id, support_link_id, owner_kind, governance_decision_id, evidence_id)
    SELECT v_org, pg_catalog.gen_random_uuid(), 'GOVERNANCE_DECISION', v_decision, i.id
    FROM pg_catalog.unnest(p_support_evidence_ids) AS i(id);

    IF p_outcome IN ('VALIDATE','REVOKE') THEN
      -- Append-only: predecessor = expected head state; closure of earlier states is derived.
      INSERT INTO gov_repo.l14_authority_policy_states (organisation_id, state_id, authority_policy_id, version_id,
        content_hash, state_kind, predecessor_state_id, revokes_state_id, effective_from, recorded_at,
        governance_decision_id, authority_basis, basis_authority_policy_id, basis_version_id, basis_content_hash,
        trust_state)
      VALUES (v_org, v_state, v_proposal.authority_policy_id, v_proposal.version_id, v_proposal.content_hash,
        CASE WHEN p_outcome = 'VALIDATE' THEN 'VALIDATED' ELSE 'REVOKED' END,
        v_head.latest_state_id, v_target_state_id,
        v_effective_from, v_now, v_decision,
        CASE WHEN v_bootstrap THEN 'SYSTEM_BOOTSTRAP_L14_AUTHORITY_V1' ELSE 'AUTHORITY_POLICY_VERSION' END,
        CASE WHEN v_has_basis THEN v_basis_policy END,
        CASE WHEN v_has_basis THEN v_basis_version END,
        CASE WHEN v_has_basis THEN v_basis_hash END,
        'VALIDATED');
      UPDATE gov_repo.l14_authority_policy_heads AS h SET latest_state_id = v_state
      WHERE h.organisation_id = v_org AND h.latest_state_id IS NOT DISTINCT FROM p_expected_current_state_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'L14_STALE_EXPECTATION' USING ERRCODE = 'GV009', DETAIL = 'AUTHORITY_POLICY_STATE_EXPECTATION_MISMATCH';
      END IF;
      INSERT INTO gov_repo.l14_support_links (organisation_id, support_link_id, owner_kind, state_id, evidence_id)
      SELECT v_org, pg_catalog.gen_random_uuid(), 'AUTHORITY_POLICY_STATE', v_state, i.id
      FROM pg_catalog.unnest(p_support_evidence_ids) AS i(id);
      INSERT INTO gov_repo.l14_command_results (organisation_id, command_id, command_kind, command_fingerprint,
        actor_user_id, outcome, authorization_decision_id, proposal_id, governance_decision_id, authority_policy_id,
        version_id, state_id, recorded_at)
      VALUES (v_org, p_command_id, 'DECIDE_PROPOSAL', v_fingerprint, v_actor,
        CASE WHEN p_outcome = 'VALIDATE' THEN 'VALIDATED' ELSE 'REVOKED' END, v_authz, p_proposal_id,
        v_decision, v_proposal.authority_policy_id, v_proposal.version_id, v_state, v_now);
    ELSE
      -- REJECT / DEFER: governance decision only, no Authority Policy state.
      INSERT INTO gov_repo.l14_command_results (organisation_id, command_id, command_kind, command_fingerprint,
        actor_user_id, outcome, authorization_decision_id, proposal_id, governance_decision_id, authority_policy_id,
        version_id, recorded_at)
      VALUES (v_org, p_command_id, 'DECIDE_PROPOSAL', v_fingerprint, v_actor,
        CASE WHEN p_outcome = 'REJECT' THEN 'REJECTED' ELSE 'DEFERRED' END, v_authz, p_proposal_id,
        v_decision, v_proposal.authority_policy_id, v_proposal.version_id, v_now);
    END IF;
  END IF;

  PERFORM 1 FROM gov_repo.l14_session_basis_v1(v_org, v_actor, p_verified_session_iat,
    p_verified_session_exp, p_verified_credential_epoch);
  RETURN QUERY SELECT * FROM gov_repo.l14_command_result_v1(v_org, p_command_id, false);
END;
$decide$;

-- The incorrect S1A.2 helper must not remain as a live continuity implementation.
DROP FUNCTION gov_repo.l14_authority_policy_schedule_continuous_v1(uuid, text, uuid, timestamptz, uuid);

REVOKE ALL ON FUNCTION
  gov_repo.l14_authority_policy_schedule_continuous_v2(uuid, text, uuid, timestamptz, timestamptz, uuid),
  gov_repo.l14_decide_authority_policy_proposal_v1(uuid, uuid, bigint, bigint, timestamptz, text, uuid, text, text, uuid, text, text[], text)
FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION
  gov_repo.l14_decide_authority_policy_proposal_v1(uuid, uuid, bigint, bigint, timestamptz, text, uuid, text, text, uuid, text, text[], text)
TO service_role;

COMMENT ON FUNCTION gov_repo.l14_authority_policy_schedule_continuous_v2(uuid, text, uuid, timestamptz, timestamptz, uuid) IS
'M16-S1A.2R1 owner-only continuity check: recorded-time-aware cancellation (only a target still pending when the tombstone was recorded can be cancelled); exactly one effective Authority Policy at every instant from the first validation onward; no gap, no overlap, no resurrection.';

DO $postflight$
DECLARE
  v_public_rpcs CONSTANT text[] := ARRAY[
    'l14_admit_authority_policy_version_v1','l14_decide_authority_policy_proposal_v1','l14_submit_proposal_v1'];
  v_fn record;
  v_role text;
BEGIN
  IF to_regprocedure('gov_repo.l14_authority_policy_schedule_continuous_v1(uuid, text, uuid, timestamptz, uuid)') IS NOT NULL THEN
    RAISE EXCEPTION 'M16_S1A2R1_POSTFLIGHT: obsolete continuity helper still present';
  END IF;
  IF (SELECT pg_catalog.count(*) FROM pg_catalog.pg_proc AS p
      WHERE p.pronamespace = 'gov_repo'::regnamespace AND p.proname LIKE 'l14\_authority\_policy\_schedule\_continuous%' ESCAPE '\') <> 1 THEN
    RAISE EXCEPTION 'M16_S1A2R1_POSTFLIGHT: expected exactly one continuity helper';
  END IF;
  FOR v_fn IN
    SELECT p.oid, p.proname, p.proowner, p.proacl, p.prosecdef, p.proconfig
    FROM pg_catalog.pg_proc AS p
    WHERE p.pronamespace = 'gov_repo'::regnamespace AND p.proname LIKE 'l14\_%' ESCAPE '\'
  LOOP
    IF NOT (v_fn.proconfig @> ARRAY['search_path=pg_catalog, pg_temp']) THEN
      RAISE EXCEPTION 'M16_S1A2R1_POSTFLIGHT: % search_path not pinned', v_fn.proname;
    END IF;
    IF v_fn.proname::text = ANY (v_public_rpcs) THEN
      IF NOT v_fn.prosecdef OR NOT pg_catalog.has_function_privilege('service_role', v_fn.oid, 'EXECUTE')
         OR EXISTS (SELECT 1 FROM pg_catalog.aclexplode(v_fn.proacl) AS a
                    WHERE a.grantee NOT IN (v_fn.proowner, 'service_role'::regrole::oid)) THEN
        RAISE EXCEPTION 'M16_S1A2R1_POSTFLIGHT: public RPC % ACL/definer shape wrong', v_fn.proname;
      END IF;
    ELSIF v_fn.prosecdef OR EXISTS (SELECT 1 FROM pg_catalog.aclexplode(COALESCE(v_fn.proacl,
            pg_catalog.acldefault('f', v_fn.proowner))) AS a WHERE a.grantee <> v_fn.proowner) THEN
      RAISE EXCEPTION 'M16_S1A2R1_POSTFLIGHT: internal helper % must be owner-only SECURITY INVOKER', v_fn.proname;
    END IF;
    FOREACH v_role IN ARRAY ARRAY['anon','authenticated'] LOOP
      IF pg_catalog.has_function_privilege(v_role, v_fn.oid, 'EXECUTE') THEN
        RAISE EXCEPTION 'M16_S1A2R1_POSTFLIGHT: % executable by %', v_fn.proname, v_role;
      END IF;
    END LOOP;
  END LOOP;
  IF (SELECT pg_catalog.count(*) FROM pg_catalog.pg_proc AS p
      WHERE p.pronamespace = 'gov_repo'::regnamespace AND p.proname::text = ANY (v_public_rpcs)) <> 3
     OR (SELECT pg_catalog.count(*) FROM pg_catalog.pg_proc AS p
      WHERE p.pronamespace = 'gov_repo'::regnamespace AND p.proname LIKE 'l14\_%' ESCAPE '\'
        AND pg_catalog.has_function_privilege('service_role', p.oid, 'EXECUTE')) <> 3 THEN
    RAISE EXCEPTION 'M16_S1A2R1_POSTFLIGHT: exactly three service_role-executable L14 RPCs required';
  END IF;
  IF (SELECT pg_catalog.count(*) FROM pg_catalog.pg_proc AS p WHERE p.pronamespace = 'gov_repo'::regnamespace
        AND p.proname LIKE '%\_governed\_v1' ESCAPE '\') <> 6 THEN
    RAISE EXCEPTION 'M16_S1A2R1_POSTFLIGHT: S0 naming contract disturbed';
  END IF;
END;
$postflight$;

COMMIT;
