-- M17-S7D additive corrective. Owner-approved C-M17-01; O56 all decision outcomes.
-- No history rewrites, new stores, grants, roles or authority roots.
BEGIN;

DO $preflight$
BEGIN
  IF (SELECT count(*) FROM pg_catalog.pg_proc WHERE pronamespace='gov_repo'::regnamespace AND proname LIKE 'l15\_%' ESCAPE '\' AND prosecdef) <> 36
    OR (SELECT pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(prosrc,'UTF8')),'hex') FROM pg_catalog.pg_proc
        WHERE oid='gov_repo.l15_authorization_allow_guard_v1()'::regprocedure) IS DISTINCT FROM 'ee7885662da87a4946ad06596dbcd9f1af9bbb52de0e86fb7b16fd17731b5236'
    OR (SELECT pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(prosrc,'UTF8')),'hex') FROM pg_catalog.pg_proc
        WHERE oid='gov_repo.l15_read_hypothesis_dispositions_v1(uuid,uuid,bigint,bigint,timestamptz,text,text,text,text,text)'::regprocedure)
        IS DISTINCT FROM '759086fea06b757f854963ffd9fa507606aeb3c4ead241f02d194e44adc3b487' THEN
    RAISE EXCEPTION 'M17_S7D_PREFLIGHT: unexpected final S7C catalog' USING ERRCODE='55000';
  END IF;
END;
$preflight$;

CREATE TEMPORARY TABLE m17_s7d_routine_baseline ON COMMIT DROP AS
  SELECT p.oid, p.proname, p.prosrc, p.proowner, p.proacl, p.proconfig, p.prosecdef, p.provolatile,
    p.proargtypes, p.prorettype FROM pg_catalog.pg_proc p WHERE p.pronamespace='gov_repo'::regnamespace;

-- Pin the exact six final routine bodies before applying the single operand correction.
-- pg_get_functiondef preserves signatures, configuration and SECURITY DEFINER posture;
-- CREATE OR REPLACE preserves ownership and existing ACLs.
DO $correct_decisions$
DECLARE
  r record;
  v_oid oid;
  v_src text;
  v_def text;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('l15_decide_scenario_proposal_v1', '8897b4cbc05f526bcbd244d09caaa5babf054829368dd4f9224c0bf9e1e1867f', 1),
    ('l15_decide_methodology_proposal_v1', 'cfaa6eef826731d44d2f53aab7273c544d508c08d21fd4f252ddd6c3732f0e7f', 1),
    ('l15_decide_governed_risk_proposal_v1', '73e0d2401cf073e67d27cc6510d05b7ce0f556dbe397ff6baa8ae07128f60038', 2),
    ('l15_decide_risk_assessment_proposal_v1', 'b58e557c16a4bc8a5423204a0563566a497dc04642710771725ae4c9881cd892', 2),
    ('l15_decide_risk_treatment_proposal_v1', 'ac3125f883eb86b69829e9fff0ec2751cccf62011c3a715b0da84aadf32a46b0', 2),
    ('l15_decide_risk_acceptance_proposal_v1', '4585134e8d3a65731d669fbc1c878ee84f6b8925fa1155cdd367ab36dbe03084', 2)
  ) x(name, sha, occurrences) LOOP
    IF (SELECT count(*) FROM pg_catalog.pg_proc p WHERE p.pronamespace='gov_repo'::regnamespace AND p.proname=r.name) <> 1 THEN
      RAISE EXCEPTION 'M17_S7D_PREFLIGHT: unexpected decision overload %', r.name;
    END IF;
    SELECT p.oid, p.prosrc, pg_catalog.pg_get_functiondef(p.oid) INTO v_oid, v_src, v_def
    FROM pg_catalog.pg_proc p WHERE p.pronamespace='gov_repo'::regnamespace AND p.proname=r.name;
    IF pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(v_src,'UTF8')),'hex') <> r.sha
       OR (length(v_src)-length(replace(v_src, 'p_outcome = ''VALIDATE'' AND v_self', '')))
          / length('p_outcome = ''VALIDATE'' AND v_self') <> r.occurrences THEN
      RAISE EXCEPTION 'M17_S7D_PREFLIGHT: unexpected decision body %', r.name;
    END IF;
    EXECUTE replace(v_def, 'p_outcome = ''VALIDATE'' AND v_self', 'v_self');
  END LOOP;
END;
$correct_decisions$;

-- Deferred central backstop: the self grant must belong to an actual matched
-- permission/action/source/scope/basis snapshot, never an unrelated policy rule.
CREATE OR REPLACE FUNCTION gov_repo.l15_authorization_allow_guard_v1()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $guard$
DECLARE
  v_permission text := gov_repo.l15_governance_permission_v1(NEW.subject_kind, NEW.requested_action);
BEGIN
  IF v_permission IS NULL
     OR NEW.authority_basis IS DISTINCT FROM 'AUTHORITY_POLICY_VERSION'
     OR NEW.basis_authority_policy_id IS NULL OR NEW.basis_version_id IS NULL
     OR NOT EXISTS (
       SELECT 1 FROM gov_repo.l14_authorization_decision_rules AS r
       WHERE r.organisation_id = NEW.organisation_id AND r.authorization_decision_id = NEW.authorization_decision_id
         AND r.permission_origin = 'AUTHORITY_POLICY_RULE' AND r.permission = v_permission
         AND r.requested_action = NEW.requested_action
         AND r.basis_authority_policy_id = NEW.basis_authority_policy_id AND r.basis_version_id = NEW.basis_version_id
         AND (NEW.is_self_validation IS NOT TRUE OR (
           r.allow_self_validation AND r.source_class = NEW.source_class AND r.source_disposition = 'AUTHORITATIVE'
           AND (r.scope_tag = 'ALL_ALLOWED_TARGETS'
             OR (r.scope_tag = 'CANONICAL_KIND' AND NEW.scope_tag = 'CANONICAL_OBJECT'
               AND r.scope_canonical_kind = NEW.target_canonical_kind)
             OR (r.scope_tag = 'CANONICAL_OBJECT' AND NEW.scope_tag = 'CANONICAL_OBJECT'
               AND r.scope_canonical_kind = NEW.target_canonical_kind
               AND r.scope_canonical_object_id = NEW.target_canonical_object_id)
             OR (r.scope_tag = 'RELATIONSHIP_TYPE' AND NEW.scope_tag = 'RELATIONSHIP_STATE'
               AND r.scope_relationship_type = NEW.target_relationship_type)
             OR (r.scope_tag = 'RELATIONSHIP_STATE' AND NEW.scope_tag = 'RELATIONSHIP_STATE'
               AND r.scope_relationship_id = NEW.target_relationship_id
               AND r.scope_relationship_state_id = NEW.target_relationship_state_id)))))
     OR NOT EXISTS (
       SELECT 1 FROM gov_repo.governance_users AS u
       JOIN gov_repo.organisations AS o ON o.organisation_id = u.organisation_id
       WHERE u.user_id = NEW.actor_user_id AND u.organisation_id = NEW.organisation_id
         AND u.status::text = 'active' AND o.is_active) THEN
    RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'L15_ALLOW_WITHOUT_L15_AUTHORITY';
  END IF;
  RETURN NULL;
END;
$guard$;

-- C-M17-01. Select exact hypotheses first; every citation is then joined through
-- its exact typed same-tenant GOVERNED_RISK proposal path only. A support link
-- records use of that exact hypothesis, regardless of the citing risk's subject.
CREATE OR REPLACE FUNCTION gov_repo.l15_read_hypothesis_dispositions_v1(p_verified_organisation_id uuid, p_verified_actor_user_id uuid,
  p_verified_session_iat bigint, p_verified_session_exp bigint, p_verified_credential_epoch timestamptz,
  p_subject_mode text, p_subject_canonical_kind text, p_subject_canonical_object_id text, p_subject_relationship_id text,
  p_subject_relationship_state_id text)
RETURNS TABLE(hypothesis_id uuid, generator_kind text, trust_state text, hint_confidence numeric, recorded_at timestamptz,
  cited_signal_count bigint, disposition text, authority text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp SET lock_timeout = '5s' AS $fn$
BEGIN
  PERFORM gov_repo.l15_require_member_v1(p_verified_organisation_id, p_verified_actor_user_id, p_verified_session_iat,
    p_verified_session_exp, p_verified_credential_epoch);
  PERFORM gov_repo.l15_require_subject_v1(p_verified_organisation_id, p_subject_mode, p_subject_canonical_kind,
    p_subject_canonical_object_id, p_subject_relationship_id, p_subject_relationship_state_id, NULL, false);
  RETURN QUERY
  SELECT h.hypothesis_id, h.generator_kind, h.trust_state, h.hint_confidence, h.recorded_at,
    (SELECT pg_catalog.count(*) FROM gov_repo.l15_support_links AS sl
      WHERE sl.organisation_id = h.organisation_id AND sl.owner_kind = 'RISK_HYPOTHESIS'
        AND sl.owner_hypothesis_id = h.hypothesis_id),
    CASE WHEN use_stage.governed THEN 'CITED_BY_GOVERNED_RISK'
         WHEN use_stage.live THEN 'CITED_BY_LIVE_PROPOSAL'
         WHEN use_stage.rejected THEN 'CITED_BY_REJECTED_PROPOSAL'
         ELSE 'UNREVIEWED' END::text,
    'NON_AUTHORITATIVE'::text
  FROM gov_repo.l15_risk_hypotheses AS h
  CROSS JOIN LATERAL (
    SELECT coalesce(bool_or(EXISTS (
      SELECT 1 FROM gov_repo.l15_governed_risk_states s
      JOIN gov_repo.l14_governance_decisions d ON d.organisation_id = s.organisation_id
        AND d.governance_decision_id = s.governance_decision_id AND d.proposal_id = p.proposal_id
        AND d.subject_kind = 'GOVERNED_RISK' AND d.outcome = 'VALIDATE'
      WHERE s.organisation_id = p.organisation_id AND s.proposal_id = p.proposal_id
        AND s.state_kind = 'VALIDATED')), false) AS governed,
      coalesce(bool_or(NOT EXISTS (
        SELECT 1 FROM gov_repo.l14_governance_decisions d WHERE d.organisation_id = p.organisation_id
          AND d.proposal_id = p.proposal_id AND d.subject_kind = 'GOVERNED_RISK'
          AND d.outcome IN ('VALIDATE','REJECT'))), false) AS live,
      coalesce(bool_or(EXISTS (
        SELECT 1 FROM gov_repo.l14_governance_decisions d WHERE d.organisation_id = p.organisation_id
          AND d.proposal_id = p.proposal_id AND d.subject_kind = 'GOVERNED_RISK'
          AND d.outcome = 'REJECT')), false) AS rejected
    FROM gov_repo.l15_support_links l
    JOIN gov_repo.l15_governed_risk_proposals p ON p.organisation_id = l.organisation_id
      AND p.proposal_id = l.owner_governed_risk_proposal_id AND p.intent = 'VALIDATE'
    WHERE l.organisation_id = h.organisation_id AND l.target_tag = 'RISK_HYPOTHESIS'
      AND l.target_risk_hypothesis_id = h.hypothesis_id AND l.owner_kind = 'GOVERNED_RISK'
      AND l.owner_governed_risk_artifact = 'PROPOSAL'
  ) AS use_stage
  WHERE h.organisation_id = p_verified_organisation_id AND h.subject_mode = p_subject_mode
    AND h.subject_canonical_kind IS NOT DISTINCT FROM p_subject_canonical_kind
    AND h.subject_canonical_object_id IS NOT DISTINCT FROM p_subject_canonical_object_id
    AND h.subject_relationship_id IS NOT DISTINCT FROM p_subject_relationship_id
    AND h.subject_relationship_state_id IS NOT DISTINCT FROM p_subject_relationship_state_id
  ORDER BY h.recorded_at, h.hypothesis_id
  LIMIT 1000;
END;
$fn$;

DO $postflight$
DECLARE
  v_changed text[];
BEGIN
  SELECT array_agg(p.proname::text ORDER BY p.proname::text COLLATE "C") INTO v_changed
  FROM pg_catalog.pg_proc p JOIN m17_s7d_routine_baseline b ON b.oid=p.oid WHERE p.prosrc IS DISTINCT FROM b.prosrc;
  IF v_changed IS DISTINCT FROM ARRAY['l15_authorization_allow_guard_v1','l15_decide_governed_risk_proposal_v1',
    'l15_decide_methodology_proposal_v1','l15_decide_risk_acceptance_proposal_v1','l15_decide_risk_assessment_proposal_v1',
    'l15_decide_risk_treatment_proposal_v1','l15_decide_scenario_proposal_v1','l15_read_hypothesis_dispositions_v1']::text[]
    OR EXISTS (
      SELECT 1 FROM m17_s7d_routine_baseline b FULL JOIN
        (SELECT * FROM pg_catalog.pg_proc WHERE pronamespace='gov_repo'::regnamespace) p ON p.oid=b.oid
      WHERE b.oid IS NULL OR p.oid IS NULL OR
        (p.proowner,p.proacl,p.proconfig,p.prosecdef,p.provolatile,p.proargtypes,p.prorettype)
        IS DISTINCT FROM (b.proowner,b.proacl,b.proconfig,b.prosecdef,b.provolatile,b.proargtypes,b.prorettype)) THEN
    RAISE EXCEPTION 'M17_S7D_POSTFLIGHT: unexpected body, signature, owner, ACL, config or capability delta' USING ERRCODE='55000';
  END IF;
END;
$postflight$;

COMMIT;
