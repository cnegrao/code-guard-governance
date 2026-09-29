-- M16-S1A.2: L14 Authority Policy successor lifecycle (DB only, ADDITIVE on S1A.1).
-- Architecture: docs/architecture/ADR-GOVIA-OWNERSHIP-BUSINESS-POLICY-CONTROL-ENRICHMENT-v1.md
-- §§5-7, 17 + the S1A.2 architecture-owner instructions. The audited S1A.1 migration
-- (20260929120000) is NOT edited. Never run against a hosted DB from this slice.
--
-- This migration:
--   A. replaces the over-broad S1A.1 self-basis checks with action/state-sensitive ones
--      (a successor may never authorize its own ADMIT/VALIDATE; the CURRENT effective policy
--      may authorize REJECT/DEFER/REVOKE of itself);
--   B. permits an explicit NULL authority basis ONLY for a durable DENY NO_EFFECTIVE_AUTHORITY;
--   C. adds state uniqueness: one VALIDATED state per version, one REVOKED tombstone per
--      revokes_state_id, no two VALIDATED states with the same effective_from per organisation;
--   D. adds owner-only helpers: effective basis with content-hash recomputation, the closed
--      rule evaluator, the rule snapshot, and the schedule continuity check;
--   E. CREATE OR REPLACEs the same three public RPC signatures with successor ADMIT, successor
--      proposals (VALIDATE / REVOKE), successor VALIDATE / REJECT / DEFER / REVOKE.
-- The bootstrap path is byte-for-byte the S1A.1 semantics. The bitemporal resolver
-- gov_repo.l14_effective_authority_policy_version_v1 is unchanged: with continuity enforced
-- at every append (section D), it never resurrects a superseded or revoked version.
-- No canonical_relationships DDL/DML (F2 untouched).
BEGIN;

-- ---------------------------------------------------------------------------------------
-- A/B. Authorization decision basis and self-basis corrections.
-- ---------------------------------------------------------------------------------------
ALTER TABLE gov_repo.l14_authorization_decisions
  DROP CONSTRAINT l14_authorization_decisions_no_self_basis_check,
  DROP CONSTRAINT l14_authorization_decisions_basis_shape_check,
  ALTER COLUMN authority_basis DROP NOT NULL;

ALTER TABLE gov_repo.l14_authorization_decisions
  -- A proposed successor never authorizes its own ADMIT or VALIDATE (§5). REJECT/DEFER/REVOKE
  -- of the currently effective version by that same version is legitimate (§5 replacement/revocation).
  ADD CONSTRAINT l14_authorization_decisions_no_self_basis_check CHECK (
    basis_version_id IS NULL OR subject_version_id IS NULL
    OR requested_action NOT IN ('ADMIT','VALIDATE') OR basis_version_id <> subject_version_id),
  ADD CONSTRAINT l14_authorization_decisions_basis_shape_check CHECK (COALESCE(
    (authority_basis IS NULL AND result = 'DENY' AND deny_reason = 'NO_EFFECTIVE_AUTHORITY'
      AND basis_authority_policy_id IS NULL AND basis_version_id IS NULL AND basis_content_hash IS NULL)
    OR (authority_basis = 'SYSTEM_BOOTSTRAP_L14_AUTHORITY_V1'
      AND basis_authority_policy_id IS NULL AND basis_version_id IS NULL AND basis_content_hash IS NULL)
    OR (authority_basis = 'AUTHORITY_POLICY_VERSION'
      AND basis_authority_policy_id IS NOT NULL AND basis_version_id IS NOT NULL
      AND basis_content_hash ~ '^[0-9a-f]{64}$'), false)),
  -- NO_EFFECTIVE_AUTHORITY is exactly the basis-less DENY; it can never cite a basis.
  ADD CONSTRAINT l14_authorization_decisions_no_effective_basis_check CHECK (
    deny_reason IS DISTINCT FROM 'NO_EFFECTIVE_AUTHORITY' OR authority_basis IS NULL);

ALTER TABLE gov_repo.l14_authority_policy_states
  DROP CONSTRAINT l14_authority_policy_states_no_self_basis_check;
ALTER TABLE gov_repo.l14_authority_policy_states
  -- VALIDATED: the basis is never the subject version. REVOKED: the current policy may revoke itself.
  ADD CONSTRAINT l14_authority_policy_states_no_self_basis_check CHECK (
    state_kind = 'REVOKED' OR basis_version_id IS NULL OR basis_version_id <> version_id);

-- ---------------------------------------------------------------------------------------
-- C. State uniqueness (bounded partial unique indexes; history is never edited).
-- ---------------------------------------------------------------------------------------
CREATE UNIQUE INDEX l14_authority_policy_states_validated_version_uidx
  ON gov_repo.l14_authority_policy_states (organisation_id, version_id) WHERE state_kind = 'VALIDATED';
CREATE UNIQUE INDEX l14_authority_policy_states_revocation_target_uidx
  ON gov_repo.l14_authority_policy_states (organisation_id, revokes_state_id) WHERE state_kind = 'REVOKED';
CREATE UNIQUE INDEX l14_authority_policy_states_validated_instant_uidx
  ON gov_repo.l14_authority_policy_states (organisation_id, effective_from) WHERE state_kind = 'VALIDATED';

-- ---------------------------------------------------------------------------------------
-- D. Owner-only helpers.
-- ---------------------------------------------------------------------------------------

-- The ONLY L14 authority basis for a non-bootstrap command: the version effective at the DB
-- evaluation instant as known at that same instant, with its content hash recomputed from the
-- immutable typed rules and required to equal both the state and version hashes.
CREATE FUNCTION gov_repo.l14_effective_authority_basis_v1(p_organisation_id uuid, p_at timestamptz)
RETURNS TABLE (authority_policy_id uuid, version_id uuid, content_hash text, state_id uuid)
LANGUAGE plpgsql
STABLE
SET search_path = pg_catalog, pg_temp
AS $basis$
#variable_conflict use_column
DECLARE
  v_effective record;
  v_version_hash text;
BEGIN
  SELECT e.authority_policy_id, e.version_id, e.content_hash, e.state_id INTO v_effective
  FROM gov_repo.l14_effective_authority_policy_version_v1(p_organisation_id, p_at, p_at) AS e;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  SELECT v.content_hash INTO v_version_hash
  FROM gov_repo.l14_authority_policy_versions AS v
  WHERE v.organisation_id = p_organisation_id AND v.authority_policy_id = v_effective.authority_policy_id
    AND v.version_id = v_effective.version_id;
  IF v_version_hash IS DISTINCT FROM v_effective.content_hash
     OR gov_repo.l14_stored_authority_policy_content_hash_v1(p_organisation_id, v_effective.authority_policy_id,
          v_effective.version_id) IS DISTINCT FROM v_effective.content_hash THEN
    RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'EFFECTIVE_BASIS_INTEGRITY_FAILED';
  END IF;
  RETURN QUERY SELECT v_effective.authority_policy_id, v_effective.version_id, v_effective.content_hash, v_effective.state_id;
END;
$basis$;

-- Closed rule evaluator over ONE basis version (§6, S1A.2 §7). Positive grants OR across the
-- actor's CURRENT locked roles. Returns NULL deny_reason + the authorizing rule ordinals, or a
-- closed deny reason + the ordinals actually evaluated at the failing step.
CREATE FUNCTION gov_repo.l14_evaluate_authority_rules_v1(
  p_organisation_id uuid, p_authority_policy_id uuid, p_version_id uuid, p_role_ids uuid[],
  p_permission text, p_requested_action text, p_self_validation boolean, p_temporal text)
RETURNS TABLE (deny_reason text, rule_ordinals integer[])
LANGUAGE plpgsql
STABLE
SET search_path = pg_catalog, pg_temp
AS $evaluate$
#variable_conflict use_column
DECLARE
  v_candidates integer[];
  v_source integer[];
  v_scope integer[];
  v_self integer[];
  v_temporal integer[];
BEGIN
  IF p_temporal IS NULL OR p_temporal NOT IN ('IMMEDIATE','BACKDATED','FUTURE_DATED') THEN
    RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'TEMPORAL_CLASS_INVALID';
  END IF;
  SELECT pg_catalog.array_agg(r.rule_ordinal ORDER BY r.rule_ordinal) INTO v_candidates
  FROM gov_repo.l14_authority_policy_rules AS r
  WHERE r.organisation_id = p_organisation_id AND r.authority_policy_id = p_authority_policy_id
    AND r.version_id = p_version_id AND r.role_id = ANY (p_role_ids)
    AND r.permission = p_permission AND r.requested_action = p_requested_action;
  IF v_candidates IS NULL THEN
    RETURN QUERY SELECT 'NO_MATCHING_AUTHORITY_RULE'::text, ARRAY[]::integer[];
    RETURN;
  END IF;
  -- Contradictory exact rule keys (same role/permission/action/source/scope operands, both
  -- AUTHORITATIVE and NON_AUTHORITATIVE) fail closed; never resolved by row order.
  IF EXISTS (
    SELECT 1
    FROM gov_repo.l14_authority_policy_rules AS a
    JOIN gov_repo.l14_authority_policy_rules AS b
      ON b.organisation_id = a.organisation_id AND b.authority_policy_id = a.authority_policy_id
     AND b.version_id = a.version_id AND b.role_id = a.role_id AND b.permission = a.permission
     AND b.requested_action = a.requested_action AND b.source_class = a.source_class AND b.scope_tag = a.scope_tag
     AND b.scope_canonical_kind IS NOT DISTINCT FROM a.scope_canonical_kind
     AND b.scope_canonical_object_id IS NOT DISTINCT FROM a.scope_canonical_object_id
     AND b.scope_relationship_type IS NOT DISTINCT FROM a.scope_relationship_type
     AND b.scope_relationship_id IS NOT DISTINCT FROM a.scope_relationship_id
     AND b.scope_relationship_state_id IS NOT DISTINCT FROM a.scope_relationship_state_id
    WHERE a.organisation_id = p_organisation_id AND a.authority_policy_id = p_authority_policy_id
      AND a.version_id = p_version_id AND a.rule_ordinal = ANY (v_candidates) AND b.rule_ordinal = ANY (v_candidates)
      AND a.source_class = 'LOCAL_HUMAN' AND a.source_disposition = 'AUTHORITATIVE'
      AND b.source_disposition = 'NON_AUTHORITATIVE') THEN
    RETURN QUERY SELECT 'SOURCE_NOT_AUTHORIZED'::text, v_candidates;
    RETURN;
  END IF;
  -- Only an AUTHORITATIVE LOCAL_HUMAN rule can authorize (CONTRIBUTING / NON_AUTHORITATIVE never do).
  SELECT pg_catalog.array_agg(r.rule_ordinal ORDER BY r.rule_ordinal) INTO v_source
  FROM gov_repo.l14_authority_policy_rules AS r
  WHERE r.organisation_id = p_organisation_id AND r.authority_policy_id = p_authority_policy_id
    AND r.version_id = p_version_id AND r.rule_ordinal = ANY (v_candidates)
    AND r.source_class = 'LOCAL_HUMAN' AND r.source_disposition = 'AUTHORITATIVE';
  IF v_source IS NULL THEN
    RETURN QUERY SELECT 'SOURCE_NOT_AUTHORIZED'::text, v_candidates;
    RETURN;
  END IF;
  -- Authority Policy administration targets the organisation-local scope only.
  SELECT pg_catalog.array_agg(r.rule_ordinal ORDER BY r.rule_ordinal) INTO v_scope
  FROM gov_repo.l14_authority_policy_rules AS r
  WHERE r.organisation_id = p_organisation_id AND r.authority_policy_id = p_authority_policy_id
    AND r.version_id = p_version_id AND r.rule_ordinal = ANY (v_source) AND r.scope_tag = 'ALL_ALLOWED_TARGETS';
  IF v_scope IS NULL THEN
    RETURN QUERY SELECT 'SCOPE_NOT_AUTHORIZED'::text, v_source;
    RETURN;
  END IF;
  IF p_self_validation THEN
    SELECT pg_catalog.array_agg(r.rule_ordinal ORDER BY r.rule_ordinal) INTO v_self
    FROM gov_repo.l14_authority_policy_rules AS r
    WHERE r.organisation_id = p_organisation_id AND r.authority_policy_id = p_authority_policy_id
      AND r.version_id = p_version_id AND r.rule_ordinal = ANY (v_scope) AND r.allow_self_validation;
    IF v_self IS NULL THEN
      RETURN QUERY SELECT 'SELF_VALIDATION_NOT_PERMITTED'::text, v_scope;
      RETURN;
    END IF;
  ELSE
    v_self := v_scope;
  END IF;
  -- A dating grant must sit on a rule that already authorizes everything else about the command.
  IF p_temporal = 'IMMEDIATE' THEN
    v_temporal := v_self;
  ELSE
    SELECT pg_catalog.array_agg(r.rule_ordinal ORDER BY r.rule_ordinal) INTO v_temporal
    FROM gov_repo.l14_authority_policy_rules AS r
    WHERE r.organisation_id = p_organisation_id AND r.authority_policy_id = p_authority_policy_id
      AND r.version_id = p_version_id AND r.rule_ordinal = ANY (v_self)
      AND ((p_temporal = 'BACKDATED' AND r.allow_backdating) OR (p_temporal = 'FUTURE_DATED' AND r.allow_future_dating));
    IF v_temporal IS NULL THEN
      RETURN QUERY SELECT 'TEMPORAL_ACTION_NOT_AUTHORIZED'::text, v_self;
      RETURN;
    END IF;
  END IF;
  RETURN QUERY SELECT NULL::text, v_temporal;
END;
$evaluate$;

-- Snapshot of the actual rule rows used (ALLOW) or evaluated (DENY).
CREATE FUNCTION gov_repo.l14_snapshot_policy_rules_v1(
  p_organisation_id uuid, p_authorization_decision_id uuid, p_authority_policy_id uuid, p_version_id uuid,
  p_rule_ordinals integer[])
RETURNS void
LANGUAGE sql
VOLATILE
SET search_path = pg_catalog, pg_temp
AS $$
  INSERT INTO gov_repo.l14_authorization_decision_rules (organisation_id, authorization_decision_id, snapshot_ordinal,
    permission_origin, permission, requested_action, source_class, source_disposition, scope_tag,
    allow_self_validation, allow_future_dating, allow_backdating, basis_authority_policy_id, basis_version_id,
    basis_rule_ordinal)
  SELECT p_organisation_id, p_authorization_decision_id,
         (pg_catalog.row_number() OVER (ORDER BY r.rule_ordinal))::integer, 'AUTHORITY_POLICY_RULE',
         r.permission, r.requested_action, r.source_class, r.source_disposition, r.scope_tag,
         r.allow_self_validation, r.allow_future_dating, r.allow_backdating, p_authority_policy_id, p_version_id,
         r.rule_ordinal
  FROM gov_repo.l14_authority_policy_rules AS r
  WHERE r.organisation_id = p_organisation_id AND r.authority_policy_id = p_authority_policy_id
    AND r.version_id = p_version_id AND r.rule_ordinal = ANY (COALESCE(p_rule_ordinals, ARRAY[]::integer[]))
$$;

-- Continuity (§5, §17): with the recorded states plus ONE hypothetical appended state, from the
-- organisation's first validated instant onward there must be EXACTLY ONE effective Authority
-- Policy at every instant. A VALIDATED state is "cancelled" when revoked at or before its own
-- effective_from (it never becomes effective). At every breakpoint the latest non-cancelled
-- VALIDATED state must exist, be unique, and not be revoked by then — so a revocation can never
-- open a gap and can never resurrect a superseded predecessor (no fabricated fallback authority).
CREATE FUNCTION gov_repo.l14_authority_policy_schedule_continuous_v1(
  p_organisation_id uuid, p_new_state_kind text, p_new_state_id uuid, p_new_effective_from timestamptz,
  p_new_revokes_state_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = pg_catalog, pg_temp
AS $$
  WITH states AS (
    SELECT s.state_id, s.state_kind, s.effective_from, s.revokes_state_id
    FROM gov_repo.l14_authority_policy_states AS s WHERE s.organisation_id = p_organisation_id
    UNION ALL
    SELECT p_new_state_id, p_new_state_kind, p_new_effective_from, p_new_revokes_state_id
    WHERE p_new_state_kind IS NOT NULL
  ), revocations AS (
    SELECT s.revokes_state_id AS target_state_id, s.effective_from AS revoked_from FROM states AS s WHERE s.state_kind = 'REVOKED'
  ), active AS (
    SELECT v.state_id, v.effective_from FROM states AS v
    WHERE v.state_kind = 'VALIDATED'
      AND NOT EXISTS (SELECT 1 FROM revocations AS r WHERE r.target_state_id = v.state_id AND r.revoked_from <= v.effective_from)
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
     AND EXISTS (SELECT 1 FROM active)
     AND NOT EXISTS (
       SELECT 1 FROM evaluated AS e
       WHERE e.latest_count <> 1 OR e.latest_state_id IS NULL
          OR EXISTS (SELECT 1 FROM revocations AS r WHERE r.target_state_id = e.latest_state_id AND r.revoked_from <= e.instant))
$$;

-- ---------------------------------------------------------------------------------------
-- E1. RPC — ADMIT: first version (bootstrap, unchanged) or successor version (effective policy).
-- ---------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION gov_repo.l14_admit_authority_policy_version_v1(
  p_verified_organisation_id uuid,
  p_verified_actor_user_id uuid,
  p_verified_session_iat bigint,
  p_verified_session_exp bigint,
  p_verified_credential_epoch timestamptz,
  p_command_id text,
  p_expected_authority_policy_id uuid,
  p_expected_latest_version_id uuid,
  p_source_class text,
  p_rules jsonb,
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
AS $admit$
#variable_conflict use_column
DECLARE
  v_org uuid := p_verified_organisation_id;
  v_actor uuid := p_verified_actor_user_id;
  v_role_ids uuid[];
  v_bootstrap_role boolean;
  v_frames text[];
  v_rule_count integer;
  v_content_hash text;
  v_support text[];
  v_fingerprint text;
  v_existing_policy uuid;
  v_head_version uuid;
  v_head_version_number integer;
  v_has_basis boolean := false;
  v_basis_policy uuid;
  v_basis_version uuid;
  v_basis_hash text;
  v_deny text;
  v_ordinals integer[];
  v_now timestamptz;
  v_authz uuid := pg_catalog.gen_random_uuid();
  v_policy uuid;
  v_version uuid := pg_catalog.gen_random_uuid();
  v_version_number integer;
  v_predecessor uuid;
  v_bootstrap boolean;
BEGIN
  -- Base session eligibility (GV001-GV005/55P03 raise; nothing consumed).
  SELECT b.role_ids, b.has_bootstrap_role INTO v_role_ids, v_bootstrap_role
  FROM gov_repo.l14_session_basis_v1(v_org, v_actor, p_verified_session_iat, p_verified_session_exp,
    p_verified_credential_epoch) AS b;

  -- Structural / reference validation.
  PERFORM gov_repo.l14_validate_command_id_v1(p_command_id, p_caller_fingerprint);
  IF p_source_class IS NULL OR p_source_class NOT IN ('SYSTEM_SEED','LOCAL_HUMAN','SOURCE_CONNECTION') THEN
    RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'SOURCE_CLASS_UNKNOWN';
  END IF;
  IF p_source_class <> 'LOCAL_HUMAN' THEN
    RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'SOURCE_CLASS_NOT_EXECUTABLE';
  END IF;
  IF (p_expected_authority_policy_id IS NULL) <> (p_expected_latest_version_id IS NULL) THEN
    RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'EXPECTATION_MALFORMED';
  END IF;
  SELECT pg_catalog.array_agg(r.rule_frame ORDER BY r.rule_ordinal), pg_catalog.count(*)
  INTO v_frames, v_rule_count
  FROM gov_repo.l14_parse_authority_policy_rules_v1(v_org, p_rules) AS r;
  v_frames := COALESCE(v_frames, ARRAY[]::text[]);
  IF v_rule_count <> (SELECT pg_catalog.count(DISTINCT f) FROM pg_catalog.unnest(v_frames) AS u(f)) THEN
    RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'RULE_DUPLICATE';
  END IF;
  v_support := gov_repo.l14_support_parts_v1(v_org, p_support_status, p_support_evidence_ids);

  -- PostgreSQL-authoritative content hash and fingerprint (unchanged S1A.1 framing).
  v_content_hash := gov_repo.l14_authority_policy_content_hash_v1(v_frames);
  v_fingerprint := gov_repo.l14_sha256_frame_v1(
    ARRAY['L14_COMMAND_FINGERPRINT_V1', 'ADMIT_AUTHORITY_POLICY_VERSION', v_org::text, v_actor::text,
          'ADMIT', 'AUTHORITY_POLICY_VERSION']
    || CASE WHEN p_expected_authority_policy_id IS NULL THEN ARRAY['EXPECTED_NONE']
            ELSE ARRAY['EXPECTED_CURRENT', p_expected_authority_policy_id::text, p_expected_latest_version_id::text] END
    || ARRAY[p_source_class, v_content_hash]
    || v_support);
  IF v_fingerprint IS DISTINCT FROM p_caller_fingerprint THEN
    RAISE EXCEPTION 'L14_FINGERPRINT_MISMATCH' USING ERRCODE = 'GV008', DETAIL = 'CALLER_FINGERPRINT_DIFFERS';
  END IF;

  PERFORM gov_repo.l14_lock_authority_policy_guard_v1(v_org);

  -- Replay BEFORE any L14 evaluation: the original result, never a re-evaluation.
  IF gov_repo.l14_replay_arbitrate_v1(v_org, p_command_id, v_fingerprint) THEN
    PERFORM 1 FROM gov_repo.l14_session_basis_v1(v_org, v_actor, p_verified_session_iat,
      p_verified_session_exp, p_verified_credential_epoch);
    RETURN QUERY SELECT * FROM gov_repo.l14_command_result_v1(v_org, p_command_id, true);
    RETURN;
  END IF;

  SELECT ap.authority_policy_id INTO v_existing_policy
  FROM gov_repo.l14_authority_policies AS ap WHERE ap.organisation_id = v_org;

  IF p_expected_authority_policy_id IS NULL THEN
    -- FIRST version: bootstrap only (S1A.1 semantics).
    IF v_existing_policy IS NOT NULL THEN
      RAISE EXCEPTION 'L14_STALE_EXPECTATION' USING ERRCODE = 'GV009', DETAIL = 'AUTHORITY_POLICY_ALREADY_ESTABLISHED';
    END IF;
    v_bootstrap := true;
    v_policy := pg_catalog.gen_random_uuid();
    v_version_number := 1;
    v_predecessor := NULL;
    v_now := pg_catalog.clock_timestamp();
    IF NOT v_bootstrap_role THEN
      v_deny := 'BOOTSTRAP_ROLE_REQUIRED';
    END IF;
  ELSE
    -- SUCCESSOR version: never bootstrap; the CURRENT effective policy authorizes.
    v_bootstrap := false;
    SELECT h.latest_version_id, v.version_number INTO v_head_version, v_head_version_number
    FROM gov_repo.l14_authority_policy_heads AS h
    JOIN gov_repo.l14_authority_policy_versions AS v
      ON v.organisation_id = h.organisation_id AND v.authority_policy_id = h.authority_policy_id
     AND v.version_id = h.latest_version_id
    WHERE h.organisation_id = v_org;
    IF v_existing_policy IS DISTINCT FROM p_expected_authority_policy_id
       OR v_head_version IS DISTINCT FROM p_expected_latest_version_id THEN
      RAISE EXCEPTION 'L14_STALE_EXPECTATION' USING ERRCODE = 'GV009', DETAIL = 'EXPECTED_HEAD_MISMATCH';
    END IF;
    v_policy := v_existing_policy;
    v_version_number := v_head_version_number + 1;
    v_predecessor := v_head_version;
    v_now := pg_catalog.clock_timestamp();
    SELECT b.authority_policy_id, b.version_id, b.content_hash INTO v_basis_policy, v_basis_version, v_basis_hash
    FROM gov_repo.l14_effective_authority_basis_v1(v_org, v_now) AS b;
    v_has_basis := FOUND;
    IF NOT v_has_basis THEN
      v_deny := 'NO_EFFECTIVE_AUTHORITY';
    ELSIF v_basis_version = v_version THEN
      v_deny := 'SUCCESSOR_SELF_AUTHORIZATION_FORBIDDEN';
    ELSE
      SELECT e.deny_reason, e.rule_ordinals INTO v_deny, v_ordinals
      FROM gov_repo.l14_evaluate_authority_rules_v1(v_org, v_basis_policy, v_basis_version, v_role_ids,
        'L14_AUTHORITY_POLICY_ADMIT', 'ADMIT', false, 'IMMEDIATE') AS e;
    END IF;
  END IF;

  INSERT INTO gov_repo.l14_authorization_decisions (
    organisation_id, authorization_decision_id, command_id, command_fingerprint, actor_user_id,
    requested_action, subject_kind, scope_tag, source_class, proposal_id, is_self_validation,
    subject_authority_policy_id, subject_version_id, authority_basis, basis_authority_policy_id,
    basis_version_id, basis_content_hash, result, deny_reason, evaluated_at)
  VALUES (
    v_org, v_authz, p_command_id, v_fingerprint, v_actor,
    'ADMIT', 'AUTHORITY_POLICY_VERSION', 'ALL_ALLOWED_TARGETS', p_source_class, NULL, NULL,
    CASE WHEN v_deny IS NULL THEN v_policy END, CASE WHEN v_deny IS NULL THEN v_version END,
    CASE WHEN v_bootstrap THEN 'SYSTEM_BOOTSTRAP_L14_AUTHORITY_V1'
         WHEN v_has_basis THEN 'AUTHORITY_POLICY_VERSION' END,
    CASE WHEN v_has_basis THEN v_basis_policy END,
    CASE WHEN v_has_basis THEN v_basis_version END,
    CASE WHEN v_has_basis THEN v_basis_hash END,
    CASE WHEN v_deny IS NULL THEN 'ALLOW' ELSE 'DENY' END, v_deny, v_now);
  PERFORM gov_repo.l14_snapshot_roles_v1(v_org, v_authz, v_role_ids);
  IF v_bootstrap AND v_deny IS NULL THEN
    INSERT INTO gov_repo.l14_authorization_decision_rules (organisation_id, authorization_decision_id,
      snapshot_ordinal, permission_origin, permission, requested_action, source_class, source_disposition,
      scope_tag, allow_self_validation, allow_future_dating, allow_backdating)
    VALUES (v_org, v_authz, 1, 'SYSTEM_BOOTSTRAP', 'L14_AUTHORITY_POLICY_ADMIT', 'ADMIT', 'LOCAL_HUMAN',
      'AUTHORITATIVE', 'ALL_ALLOWED_TARGETS', false, false, false);
  ELSIF v_has_basis THEN
    PERFORM gov_repo.l14_snapshot_policy_rules_v1(v_org, v_authz, v_basis_policy, v_basis_version, v_ordinals);
  END IF;

  IF v_deny IS NOT NULL THEN
    INSERT INTO gov_repo.l14_command_results (organisation_id, command_id, command_kind, command_fingerprint,
      actor_user_id, outcome, authorization_decision_id, recorded_at)
    VALUES (v_org, p_command_id, 'ADMIT_AUTHORITY_POLICY_VERSION', v_fingerprint, v_actor, 'DENIED', v_authz, v_now);
  ELSE
    IF v_bootstrap THEN
      INSERT INTO gov_repo.l14_authority_policies (organisation_id, authority_policy_id, established_at)
      VALUES (v_org, v_policy, v_now);
    END IF;
    INSERT INTO gov_repo.l14_authority_policy_versions (organisation_id, authority_policy_id, version_id,
      version_number, predecessor_version_id, content_hash, rule_count, source_class, admitted_by_actor_user_id,
      admission_authorization_decision_id, support_status, admitted_at)
    VALUES (v_org, v_policy, v_version, v_version_number, v_predecessor, v_content_hash, v_rule_count, p_source_class,
      v_actor, v_authz, p_support_status, v_now);
    INSERT INTO gov_repo.l14_authority_policy_rules (organisation_id, authority_policy_id, version_id, rule_ordinal,
      role_id, permission, requested_action, source_class, source_disposition, scope_tag, scope_canonical_kind,
      scope_canonical_object_id, scope_relationship_type, scope_relationship_id, scope_relationship_state_id,
      allow_self_validation, allow_future_dating, allow_backdating)
    SELECT v_org, v_policy, v_version, r.rule_ordinal, r.role_id, r.permission, r.requested_action, r.source_class,
      r.source_disposition, r.scope_tag, r.scope_canonical_kind, r.scope_canonical_object_id,
      r.scope_relationship_type, r.scope_relationship_id, r.scope_relationship_state_id,
      r.allow_self_validation, r.allow_future_dating, r.allow_backdating
    FROM gov_repo.l14_parse_authority_policy_rules_v1(v_org, p_rules) AS r;
    IF gov_repo.l14_stored_authority_policy_content_hash_v1(v_org, v_policy, v_version) IS DISTINCT FROM v_content_hash THEN
      RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'CONTENT_HASH_RECOMPUTATION_FAILED';
    END IF;
    INSERT INTO gov_repo.l14_support_links (organisation_id, support_link_id, owner_kind, authority_policy_id,
      version_id, evidence_id)
    SELECT v_org, pg_catalog.gen_random_uuid(), 'AUTHORITY_POLICY_VERSION_ADMISSION', v_policy, v_version, i.id
    FROM pg_catalog.unnest(p_support_evidence_ids) AS i(id);
    IF v_bootstrap THEN
      INSERT INTO gov_repo.l14_authority_policy_heads (organisation_id, authority_policy_id, latest_version_id, latest_state_id)
      VALUES (v_org, v_policy, v_version, NULL);
    ELSE
      UPDATE gov_repo.l14_authority_policy_heads AS h SET latest_version_id = v_version
      WHERE h.organisation_id = v_org AND h.latest_version_id = p_expected_latest_version_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'L14_STALE_EXPECTATION' USING ERRCODE = 'GV009', DETAIL = 'EXPECTED_HEAD_MISMATCH';
      END IF;
    END IF;
    INSERT INTO gov_repo.l14_command_results (organisation_id, command_id, command_kind, command_fingerprint,
      actor_user_id, outcome, authorization_decision_id, authority_policy_id, version_id, recorded_at)
    VALUES (v_org, p_command_id, 'ADMIT_AUTHORITY_POLICY_VERSION', v_fingerprint, v_actor, 'ADMITTED', v_authz,
      v_policy, v_version, v_now);
  END IF;

  PERFORM 1 FROM gov_repo.l14_session_basis_v1(v_org, v_actor, p_verified_session_iat,
    p_verified_session_exp, p_verified_credential_epoch);
  RETURN QUERY SELECT * FROM gov_repo.l14_command_result_v1(v_org, p_command_id, false);
END;
$admit$;

-- ---------------------------------------------------------------------------------------
-- E2. RPC — proposal submission: VALIDATE (any admitted version) or REVOKE (exact VALIDATED
--     target state). Still no authority, no decision, no state/head mutation.
-- ---------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION gov_repo.l14_submit_proposal_v1(
  p_verified_organisation_id uuid,
  p_verified_actor_user_id uuid,
  p_verified_session_iat bigint,
  p_verified_session_exp bigint,
  p_verified_credential_epoch timestamptz,
  p_command_id text,
  p_subject_kind text,
  p_intent text,
  p_source_class text,
  p_authority_policy_id uuid,
  p_version_id uuid,
  p_content_hash text,
  p_requested_effective_from timestamptz,
  p_target_state_id uuid,
  p_prior_proposal_id uuid,
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
AS $submit$
#variable_conflict use_column
DECLARE
  v_org uuid := p_verified_organisation_id;
  v_actor uuid := p_verified_actor_user_id;
  v_version_number integer;
  v_target record;
  v_support text[];
  v_fingerprint text;
  v_proposal uuid := pg_catalog.gen_random_uuid();
  v_now timestamptz;
BEGIN
  PERFORM 1 FROM gov_repo.l14_session_basis_v1(v_org, v_actor, p_verified_session_iat,
    p_verified_session_exp, p_verified_credential_epoch);

  PERFORM gov_repo.l14_validate_command_id_v1(p_command_id, p_caller_fingerprint);
  IF p_subject_kind IS NULL OR p_subject_kind NOT IN (
       'AUTHORITY_POLICY_VERSION','GOVERNANCE_PARTY','BUSINESS_DOMAIN','INFORMATION_DOMAIN',
       'CONTROL_DEFINITION','POLICY_VERSION','RESPONSIBILITY_ASSIGNMENT','BUSINESS_CONTEXT_ASSIGNMENT',
       'POLICY_APPLICABILITY','CONTROL_APPLICABILITY','CONTROL_ASSESSMENT')
     OR p_intent IS NULL OR p_intent NOT IN ('VALIDATE','REVOKE')
     OR p_source_class IS NULL OR p_source_class NOT IN ('SYSTEM_SEED','LOCAL_HUMAN','SOURCE_CONNECTION') THEN
    RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'PROPOSAL_VOCABULARY_UNKNOWN';
  END IF;
  IF p_subject_kind <> 'AUTHORITY_POLICY_VERSION' THEN
    RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'SUBJECT_KIND_NOT_EXECUTABLE';
  END IF;
  IF p_source_class <> 'LOCAL_HUMAN' THEN
    RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'SOURCE_CLASS_NOT_EXECUTABLE';
  END IF;
  SELECT v.version_number INTO v_version_number
  FROM gov_repo.l14_authority_policy_versions AS v
  WHERE v.organisation_id = v_org AND v.authority_policy_id = p_authority_policy_id
    AND v.version_id = p_version_id AND v.content_hash = p_content_hash;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'PINNED_VERSION_UNRESOLVED';
  END IF;
  IF p_intent = 'VALIDATE' THEN
    IF p_target_state_id IS NOT NULL THEN
      RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'TARGET_STATE_NOT_PERMITTED';
    END IF;
    -- The first version can only ever be validated by the bootstrap, which is immediate only.
    IF v_version_number = 1 AND p_requested_effective_from IS NOT NULL THEN
      RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'BOOTSTRAP_EFFECTIVE_FROM_NOT_PERMITTED';
    END IF;
  ELSE
    -- REVOKE pins the exact VALIDATED target state of this tenant; the typed pin must equal it.
    IF p_target_state_id IS NULL THEN
      RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'TARGET_STATE_REQUIRED';
    END IF;
    SELECT s.state_kind, s.authority_policy_id, s.version_id, s.content_hash INTO v_target
    FROM gov_repo.l14_authority_policy_states AS s
    WHERE s.organisation_id = v_org AND s.state_id = p_target_state_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'TARGET_STATE_UNRESOLVED';
    END IF;
    IF v_target.state_kind <> 'VALIDATED' THEN
      RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'TARGET_STATE_NOT_VALIDATED';
    END IF;
    IF v_target.authority_policy_id <> p_authority_policy_id OR v_target.version_id <> p_version_id
       OR v_target.content_hash <> p_content_hash THEN
      RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'TARGET_STATE_PIN_MISMATCH';
    END IF;
  END IF;
  IF p_prior_proposal_id IS NOT NULL THEN
    PERFORM 1 FROM gov_repo.l14_proposals AS p
    WHERE p.organisation_id = v_org AND p.proposal_id = p_prior_proposal_id AND p.subject_kind = p_subject_kind;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'PRIOR_PROPOSAL_UNRESOLVED';
    END IF;
  END IF;
  v_support := gov_repo.l14_support_parts_v1(v_org, p_support_status, p_support_evidence_ids);

  v_fingerprint := gov_repo.l14_sha256_frame_v1(
    ARRAY['L14_COMMAND_FINGERPRINT_V1', 'SUBMIT_PROPOSAL', v_org::text, v_actor::text, p_subject_kind, p_intent,
          p_source_class, p_authority_policy_id::text, p_version_id::text, p_content_hash]
    || CASE WHEN p_requested_effective_from IS NULL THEN ARRAY['IMMEDIATE']
            ELSE ARRAY['EXPLICIT', gov_repo.l14_canonical_instant_v1(p_requested_effective_from)] END
    || CASE WHEN p_target_state_id IS NULL THEN ARRAY['NO_TARGET_STATE']
            ELSE ARRAY['TARGET_STATE', p_target_state_id::text] END
    || CASE WHEN p_prior_proposal_id IS NULL THEN ARRAY['NO_PRIOR_PROPOSAL']
            ELSE ARRAY['PRIOR_PROPOSAL', p_prior_proposal_id::text] END
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

  v_now := pg_catalog.clock_timestamp();
  INSERT INTO gov_repo.l14_proposals (organisation_id, proposal_id, subject_kind, intent, source_class,
    submitted_by_actor_user_id, prior_proposal_id, support_status, submitted_at)
  VALUES (v_org, v_proposal, p_subject_kind, p_intent, p_source_class, v_actor, p_prior_proposal_id,
    p_support_status, v_now);
  INSERT INTO gov_repo.l14_authority_policy_version_proposals (organisation_id, proposal_id, subject_kind, intent,
    authority_policy_id, version_id, content_hash, requested_effective_from, target_state_id)
  VALUES (v_org, v_proposal, p_subject_kind, p_intent, p_authority_policy_id, p_version_id, p_content_hash,
    p_requested_effective_from, p_target_state_id);
  INSERT INTO gov_repo.l14_support_links (organisation_id, support_link_id, owner_kind, proposal_id, evidence_id)
  SELECT v_org, pg_catalog.gen_random_uuid(), 'PROPOSAL', v_proposal, i.id
  FROM pg_catalog.unnest(p_support_evidence_ids) AS i(id);
  INSERT INTO gov_repo.l14_command_results (organisation_id, command_id, command_kind, command_fingerprint,
    actor_user_id, outcome, proposal_id, authority_policy_id, version_id, recorded_at)
  VALUES (v_org, p_command_id, 'SUBMIT_PROPOSAL', v_fingerprint, v_actor, 'SUBMITTED', v_proposal,
    p_authority_policy_id, p_version_id, v_now);

  PERFORM 1 FROM gov_repo.l14_session_basis_v1(v_org, v_actor, p_verified_session_iat,
    p_verified_session_exp, p_verified_credential_epoch);
  RETURN QUERY SELECT * FROM gov_repo.l14_command_result_v1(v_org, p_command_id, false);
END;
$submit$;

-- ---------------------------------------------------------------------------------------
-- E3. RPC — governance decision. No state yet: bounded bootstrap (S1A.1, unchanged).
--     States exist: the CURRENT effective policy authorizes VALIDATE / REJECT / DEFER / REVOKE.
-- ---------------------------------------------------------------------------------------
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
      SELECT pg_catalog.max(s.effective_from) INTO v_latest_active_from
      FROM gov_repo.l14_authority_policy_states AS s
      WHERE s.organisation_id = v_org AND s.state_kind = 'VALIDATED'
        AND NOT EXISTS (SELECT 1 FROM gov_repo.l14_authority_policy_states AS r
                        WHERE r.organisation_id = s.organisation_id AND r.state_kind = 'REVOKED'
                          AND r.revokes_state_id = s.state_id AND r.effective_from <= s.effective_from);
      IF v_latest_active_from IS NULL OR v_effective_from <= v_latest_active_from THEN
        RAISE EXCEPTION 'L14_CONTINUITY_VIOLATION' USING ERRCODE = 'GV011', DETAIL = 'EFFECTIVE_FROM_NOT_STRICTLY_AFTER_SCHEDULE';
      END IF;
    END IF;
    IF NOT v_bootstrap AND p_outcome IN ('VALIDATE','REVOKE') THEN
      v_state_kind := CASE WHEN p_outcome = 'VALIDATE' THEN 'VALIDATED' ELSE 'REVOKED' END;
      IF NOT gov_repo.l14_authority_policy_schedule_continuous_v1(v_org, v_state_kind, v_state, v_effective_from,
           v_target_state_id) THEN
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

-- ---------------------------------------------------------------------------------------
-- F. Privileges: new helpers owner-only (legacy defaults + PUBLIC removed). CREATE OR REPLACE
--    preserves the three public RPC ACLs; they are re-asserted explicitly anyway.
-- ---------------------------------------------------------------------------------------
REVOKE ALL ON FUNCTION
  gov_repo.l14_effective_authority_basis_v1(uuid, timestamptz),
  gov_repo.l14_evaluate_authority_rules_v1(uuid, uuid, uuid, uuid[], text, text, boolean, text),
  gov_repo.l14_snapshot_policy_rules_v1(uuid, uuid, uuid, uuid, integer[]),
  gov_repo.l14_authority_policy_schedule_continuous_v1(uuid, text, uuid, timestamptz, uuid),
  gov_repo.l14_admit_authority_policy_version_v1(uuid, uuid, bigint, bigint, timestamptz, text, uuid, uuid, text, jsonb, text, text[], text),
  gov_repo.l14_submit_proposal_v1(uuid, uuid, bigint, bigint, timestamptz, text, text, text, text, uuid, uuid, text, timestamptz, uuid, uuid, text, text[], text),
  gov_repo.l14_decide_authority_policy_proposal_v1(uuid, uuid, bigint, bigint, timestamptz, text, uuid, text, text, uuid, text, text[], text)
FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION
  gov_repo.l14_admit_authority_policy_version_v1(uuid, uuid, bigint, bigint, timestamptz, text, uuid, uuid, text, jsonb, text, text[], text),
  gov_repo.l14_submit_proposal_v1(uuid, uuid, bigint, bigint, timestamptz, text, text, text, text, uuid, uuid, text, timestamptz, uuid, uuid, text, text[], text),
  gov_repo.l14_decide_authority_policy_proposal_v1(uuid, uuid, bigint, bigint, timestamptz, text, uuid, text, text, uuid, text, text[], text)
TO service_role;

COMMENT ON FUNCTION gov_repo.l14_authority_policy_schedule_continuous_v1(uuid, text, uuid, timestamptz, uuid) IS
'M16-S1A.2 owner-only continuity check: exactly one effective Authority Policy at every instant from the first validation onward, including one hypothetical appended state; no gap, no overlap, no resurrection.';

-- ---------------------------------------------------------------------------------------
-- G. Postflight (after ALL grants, including the broad legacy defaults).
-- ---------------------------------------------------------------------------------------
DO $postflight$
DECLARE
  v_public_rpcs CONSTANT text[] := ARRAY[
    'l14_admit_authority_policy_version_v1','l14_decide_authority_policy_proposal_v1','l14_submit_proposal_v1'];
  v_fn record;
  v_role text;
BEGIN
  FOR v_fn IN
    SELECT p.oid, p.proname, p.proowner, p.proacl, p.prosecdef, p.proconfig
    FROM pg_catalog.pg_proc AS p
    WHERE p.pronamespace = 'gov_repo'::regnamespace AND p.proname LIKE 'l14\_%' ESCAPE '\'
  LOOP
    IF NOT (v_fn.proconfig @> ARRAY['search_path=pg_catalog, pg_temp']) THEN
      RAISE EXCEPTION 'M16_S1A2_POSTFLIGHT: % search_path not pinned', v_fn.proname;
    END IF;
    IF v_fn.proname::text = ANY (v_public_rpcs) THEN
      IF NOT v_fn.prosecdef OR NOT pg_catalog.has_function_privilege('service_role', v_fn.oid, 'EXECUTE')
         OR EXISTS (SELECT 1 FROM pg_catalog.aclexplode(v_fn.proacl) AS a
                    WHERE a.grantee NOT IN (v_fn.proowner, 'service_role'::regrole::oid)) THEN
        RAISE EXCEPTION 'M16_S1A2_POSTFLIGHT: public RPC % ACL/definer shape wrong', v_fn.proname;
      END IF;
    ELSIF v_fn.prosecdef OR EXISTS (SELECT 1 FROM pg_catalog.aclexplode(COALESCE(v_fn.proacl,
            pg_catalog.acldefault('f', v_fn.proowner))) AS a WHERE a.grantee <> v_fn.proowner) THEN
      RAISE EXCEPTION 'M16_S1A2_POSTFLIGHT: internal helper % must be owner-only SECURITY INVOKER', v_fn.proname;
    END IF;
    FOREACH v_role IN ARRAY ARRAY['anon','authenticated'] LOOP
      IF pg_catalog.has_function_privilege(v_role, v_fn.oid, 'EXECUTE') THEN
        RAISE EXCEPTION 'M16_S1A2_POSTFLIGHT: % executable by %', v_fn.proname, v_role;
      END IF;
    END LOOP;
  END LOOP;
  IF (SELECT pg_catalog.count(*) FROM pg_catalog.pg_proc AS p
      WHERE p.pronamespace = 'gov_repo'::regnamespace AND p.proname::text = ANY (v_public_rpcs)) <> 3 THEN
    RAISE EXCEPTION 'M16_S1A2_POSTFLIGHT: expected exactly three public L14 RPCs (no new overloads)';
  END IF;
  IF (SELECT pg_catalog.count(*) FROM pg_catalog.pg_class AS c
      WHERE c.relnamespace = 'gov_repo'::regnamespace AND c.relname LIKE 'l14\_%' ESCAPE '\'
        AND c.relkind IN ('r','p','v','m','S','f')) <> 13
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_class AS c
      WHERE c.relnamespace = 'gov_repo'::regnamespace AND c.relname LIKE 'l14\_%' ESCAPE '\' AND c.relkind = 'r'
        AND (EXISTS (SELECT 1 FROM pg_catalog.aclexplode(COALESCE(c.relacl, pg_catalog.acldefault('r', c.relowner))) AS a
                     WHERE a.grantee <> c.relowner)
             OR NOT c.relrowsecurity)) THEN
    RAISE EXCEPTION 'M16_S1A2_POSTFLIGHT: L14 table surface/ACL changed';
  END IF;
  IF (SELECT pg_catalog.count(*) FROM pg_catalog.pg_indexes
      WHERE schemaname = 'gov_repo' AND indexname IN ('l14_authority_policy_states_validated_version_uidx',
        'l14_authority_policy_states_revocation_target_uidx','l14_authority_policy_states_validated_instant_uidx')) <> 3
     OR (SELECT pg_catalog.count(*) FROM pg_catalog.pg_constraint
      WHERE conname IN ('l14_authorization_decisions_no_self_basis_check','l14_authorization_decisions_basis_shape_check',
        'l14_authorization_decisions_no_effective_basis_check','l14_authority_policy_states_no_self_basis_check')) <> 4 THEN
    RAISE EXCEPTION 'M16_S1A2_POSTFLIGHT: S1A.2 constraints/indexes missing';
  END IF;
  IF (SELECT pg_catalog.count(*) FROM pg_catalog.pg_proc AS p WHERE p.pronamespace = 'gov_repo'::regnamespace
        AND p.proname LIKE '%\_governed\_v1' ESCAPE '\') <> 6 THEN
    RAISE EXCEPTION 'M16_S1A2_POSTFLIGHT: S0 naming contract disturbed';
  END IF;
END;
$postflight$;

COMMIT;
