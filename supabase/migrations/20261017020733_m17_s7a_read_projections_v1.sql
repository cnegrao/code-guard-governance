-- M17-S7A: deterministic read projections only (ADR §§13.1, 19, 20.1, 20.2; O45, O67, O68).
-- One verified-principal read surface composes the existing S3-S6 and M16 exact/current resolvers.
-- It creates no relation, column, truth state, transition, score, inferred coverage or write path.
BEGIN;

DO $preflight$
DECLARE v_sig text;
BEGIN
  IF pg_catalog.current_setting('server_version_num')::integer < 170000 THEN
    RAISE EXCEPTION 'M17_S7A_PREFLIGHT: PostgreSQL 17 required' USING ERRCODE='55000';
  END IF;
  IF pg_catalog.to_regprocedure('gov_repo.l15_read_risk_projections_v1(uuid,uuid,bigint,bigint,timestamp with time zone,text,text,text,text,text,uuid,timestamp with time zone,timestamp with time zone)') IS NOT NULL THEN
    RAISE EXCEPTION 'M17_S7A_PREFLIGHT: projection already exists' USING ERRCODE='55000';
  END IF;
  FOREACH v_sig IN ARRAY ARRAY[
    'gov_repo.l14_session_basis_v1(uuid,uuid,bigint,bigint,timestamp with time zone)',
    'gov_repo.l15_risk_subject_shape_v1(text,text,text,text,text)',
    'gov_repo.l15_governed_risk_resolution_v1(uuid,text,text,text,text,text,uuid,timestamp with time zone,timestamp with time zone)',
    'gov_repo.l15_risk_assessment_valid_state_v1(uuid,uuid,text,timestamp with time zone,timestamp with time zone)',
    'gov_repo.l15_risk_treatment_state_current_v1(uuid,uuid,timestamp with time zone,timestamp with time zone)',
    'gov_repo.l15_risk_acceptance_resolution_v1(uuid,uuid,timestamp with time zone,timestamp with time zone)',
    'gov_repo.l14_responsibility_assignments_current_v1(uuid,text,text,timestamp with time zone,timestamp with time zone)',
    'gov_repo.l14_control_applicabilities_current_v1(uuid,text,text,text,text,text,timestamp with time zone,timestamp with time zone)',
    'gov_repo.l14_control_assessments_current_v1(uuid,text,text,text,text,text,timestamp with time zone,timestamp with time zone)',
    'gov_repo.frame_identity(text[])'
  ] LOOP
    IF pg_catalog.to_regprocedure(v_sig) IS NULL THEN
      RAISE EXCEPTION 'M17_S7A_PREFLIGHT: dependency % missing',v_sig USING ERRCODE='55000';
    END IF;
  END LOOP;
END $preflight$;

CREATE FUNCTION gov_repo.l15_read_risk_projections_v1(
  p_verified_organisation_id uuid,
  p_verified_actor_user_id uuid,
  p_verified_session_iat bigint,
  p_verified_session_exp bigint,
  p_verified_credential_epoch timestamptz,
  p_subject_type text,
  p_subject_canonical_kind text,
  p_subject_canonical_object_id text,
  p_subject_relationship_id text,
  p_subject_relationship_state_id text,
  p_scenario_definition_id uuid,
  p_effective_at timestamptz,
  p_recorded_cutoff timestamptz
)
RETURNS TABLE(
  governed_risk_state_id uuid,
  lifecycle text,
  conflict_outcome text,
  live_proposal_count integer,
  distinct_content_count integer,
  accountable_party_status text,
  accountable_parties jsonb,
  control_coverage jsonb,
  effective_at timestamptz,
  recorded_cutoff timestamptz
)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,pg_temp SET lock_timeout='5s'
AS $read$
#variable_conflict use_column
DECLARE
  v_org uuid := p_verified_organisation_id;
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_at timestamptz := coalesce(p_effective_at,v_now);
  v_cutoff timestamptz := coalesce(p_recorded_cutoff,v_now);
  v_resolution record;
BEGIN
  PERFORM 1 FROM gov_repo.l14_session_basis_v1(v_org,p_verified_actor_user_id,p_verified_session_iat,
    p_verified_session_exp,p_verified_credential_epoch);
  IF (p_effective_at IS NULL) <> (p_recorded_cutoff IS NULL) OR p_scenario_definition_id IS NULL THEN
    RAISE EXCEPTION 'L15_READ_INVALID' USING ERRCODE='GV010',DETAIL='RISK_PROJECTION_KEY_INVALID';
  END IF;
  PERFORM gov_repo.l15_risk_subject_shape_v1(p_subject_type,p_subject_canonical_kind,p_subject_canonical_object_id,
    p_subject_relationship_id,p_subject_relationship_state_id);

  SELECT * INTO v_resolution FROM gov_repo.l15_governed_risk_resolution_v1(v_org,p_subject_type,
    p_subject_canonical_kind,p_subject_canonical_object_id,p_subject_relationship_id,p_subject_relationship_state_id,
    p_scenario_definition_id,v_at,v_cutoff);
  governed_risk_state_id := v_resolution.state_id;

  -- §20.2 first-match order. NULL means the exact key is not an identified governed risk at the coordinates.
  lifecycle := CASE
    WHEN v_resolution.resolution='REVOKED' THEN 'CLOSED'
    WHEN v_resolution.resolution<>'CURRENT' THEN NULL
    WHEN EXISTS(
      SELECT 1 FROM gov_repo.l15_risk_assessment_valid_state_v1(v_org,v_resolution.state_id,'RESIDUAL',v_at,v_cutoff) ra
      CROSS JOIN LATERAL gov_repo.l15_risk_acceptance_resolution_v1(v_org,ra.state_id,v_at,v_cutoff) ac
      WHERE ac.resolution='CURRENT') THEN 'RESIDUAL_ACCEPTED'
    WHEN EXISTS(SELECT 1 FROM gov_repo.l15_risk_assessment_valid_state_v1(v_org,v_resolution.state_id,'RESIDUAL',v_at,v_cutoff))
      THEN 'RESIDUAL_ASSESSED'
    WHEN EXISTS(SELECT 1 FROM gov_repo.l15_risk_treatment_states t
      WHERE t.organisation_id=v_org AND t.governed_risk_state_id=v_resolution.state_id
        AND t.state_kind='VALIDATED' AND t.implementation_status='IMPLEMENTED'
        AND gov_repo.l15_risk_treatment_state_current_v1(v_org,t.state_id,v_at,v_cutoff)) THEN 'TREATMENT_IMPLEMENTED'
    WHEN EXISTS(SELECT 1 FROM gov_repo.l15_risk_treatment_states t
      WHERE t.organisation_id=v_org AND t.governed_risk_state_id=v_resolution.state_id
        AND t.state_kind='VALIDATED' AND t.implementation_status='PLANNED'
        AND gov_repo.l15_risk_treatment_state_current_v1(v_org,t.state_id,v_at,v_cutoff)) THEN 'TREATMENT_APPROVED'
    WHEN EXISTS(SELECT 1 FROM gov_repo.l15_risk_assessment_valid_state_v1(v_org,v_resolution.state_id,'INHERENT',v_at,v_cutoff))
      THEN 'ASSESSED'
    ELSE 'IDENTIFIED' END;

  -- §19: exact key, exact current resolver first; proposal source/recency/support/generator never rank a winner.
  WITH live AS (
    SELECT p.proposal_id,
      pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(gov_repo.frame_identity(ARRAY[
        p.scenario_definition_version_id::text,p.scenario_content_hash::text,
        CASE WHEN p.requested_effective_from IS NULL THEN 'N' ELSE 'V'||pg_catalog.to_char(p.requested_effective_from AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') END,
        CASE WHEN p.requested_effective_to IS NULL THEN 'N' ELSE 'V'||pg_catalog.to_char(p.requested_effective_to AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') END
      ]),'UTF8')),'hex') digest
    FROM gov_repo.l15_governed_risk_proposals p
    JOIN gov_repo.l14_proposals e ON e.organisation_id=p.organisation_id AND e.proposal_id=p.proposal_id
      AND e.subject_kind='GOVERNED_RISK' AND e.intent='VALIDATE'
    WHERE p.organisation_id=v_org AND p.intent='VALIDATE'
      AND p.subject_key=gov_repo.l15_risk_subject_key_v1(p_subject_type,p_subject_canonical_kind,
        p_subject_canonical_object_id,p_subject_relationship_id,p_subject_relationship_state_id)
      AND p.scenario_definition_id=p_scenario_definition_id AND e.submitted_at<=v_cutoff
      AND NOT EXISTS(SELECT 1 FROM gov_repo.l14_governance_decisions d
        WHERE d.organisation_id=v_org AND d.proposal_id=p.proposal_id AND d.outcome IN ('VALIDATE','REJECT') AND d.decided_at<=v_cutoff)
  )
  SELECT pg_catalog.count(*)::integer,pg_catalog.count(DISTINCT digest)::integer
    INTO live_proposal_count,distinct_content_count FROM live;
  conflict_outcome := CASE WHEN v_resolution.resolution='CURRENT' THEN 'RESOLVED'
    WHEN distinct_content_count>=2 THEN 'CONFLICT' ELSE 'INSUFFICIENT_EVIDENCE' END;

  -- §13.1 / O45: exact M16 target only. No AGENT -> AGENT_VERSION or other inheritance.
  IF p_subject_type='CANONICAL_OBJECT' AND p_subject_canonical_kind IN ('AGENT','DATA_ASSET','DATA_ELEMENT') THEN
    SELECT coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'responsibilityRole',r.responsibility_role,'governancePartyId',r.governance_party_id,
      'factStateId',r.fact_state_id) ORDER BY r.responsibility_role,r.governance_party_id),'[]'::jsonb)
      INTO accountable_parties
    FROM gov_repo.l14_responsibility_assignments_current_v1(v_org,p_subject_canonical_kind,
      p_subject_canonical_object_id,v_at,v_cutoff) r;
  ELSE accountable_parties := '[]'::jsonb;
  END IF;
  accountable_party_status := CASE WHEN pg_catalog.jsonb_array_length(accountable_parties)>0 THEN 'CURRENT' ELSE 'UNKNOWN' END;

  -- Categorical only. DOES_NOT_APPLY remains explicit and can never acquire an assessment outcome.
  SELECT coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'controlDefinitionId',ca.control_definition_id,'controlDefinitionVersionId',ca.control_definition_version_id,
    'applicability',ca.applicability,'assessmentOutcome',CASE WHEN ca.applicability='APPLIES'
      THEN coalesce(ass.assessment_outcome,'UNKNOWN') ELSE 'UNKNOWN' END,
    'applicabilityFactStateId',ca.fact_state_id,'assessmentFactStateId',ass.fact_state_id)
    ORDER BY ca.control_definition_id),'[]'::jsonb) INTO control_coverage
  FROM gov_repo.l14_control_applicabilities_current_v1(v_org,p_subject_type,p_subject_canonical_kind,
    p_subject_canonical_object_id,p_subject_relationship_id,p_subject_relationship_state_id,v_at,v_cutoff) ca
  LEFT JOIN LATERAL (
    SELECT a.fact_state_id,a.assessment_outcome
    FROM gov_repo.l14_control_assessments_current_v1(v_org,p_subject_type,p_subject_canonical_kind,
      p_subject_canonical_object_id,p_subject_relationship_id,p_subject_relationship_state_id,v_at,v_cutoff) a
    WHERE a.control_definition_id=ca.control_definition_id
  ) ass ON ca.applicability='APPLIES';

  effective_at:=v_at; recorded_cutoff:=v_cutoff;
  PERFORM 1 FROM gov_repo.l14_session_basis_v1(v_org,p_verified_actor_user_id,p_verified_session_iat,
    p_verified_session_exp,p_verified_credential_epoch);
  RETURN NEXT;
END $read$;

ALTER FUNCTION gov_repo.l15_read_risk_projections_v1(uuid,uuid,bigint,bigint,timestamp with time zone,text,text,text,text,text,uuid,timestamp with time zone,timestamp with time zone) OWNER TO postgres;
REVOKE ALL ON FUNCTION gov_repo.l15_read_risk_projections_v1(uuid,uuid,bigint,bigint,timestamp with time zone,text,text,text,text,text,uuid,timestamp with time zone,timestamp with time zone) FROM PUBLIC,anon,authenticated,service_role,govia_l15_machine_intake_caller;
GRANT EXECUTE ON FUNCTION gov_repo.l15_read_risk_projections_v1(uuid,uuid,bigint,bigint,timestamp with time zone,text,text,text,text,text,uuid,timestamp with time zone,timestamp with time zone) TO service_role;
COMMENT ON FUNCTION gov_repo.l15_read_risk_projections_v1(uuid,uuid,bigint,bigint,timestamp with time zone,text,text,text,text,text,uuid,timestamp with time zone,timestamp with time zone) IS
  'M17-S7A read-only exact governed-risk projections: deterministic lifecycle, exact-key conflict, exact M16 accountable parties and categorical M16 control coverage. Persists nothing; never ranks or infers.';

DO $postflight$
BEGIN
  IF EXISTS(SELECT 1 FROM pg_catalog.pg_class c WHERE c.relnamespace='gov_repo'::regnamespace
    AND c.relname LIKE 'l15\_%projection%' ESCAPE '\') THEN
    RAISE EXCEPTION 'M17_S7A_POSTFLIGHT: projection relation forbidden' USING ERRCODE='55000';
  END IF;
  IF NOT pg_catalog.has_function_privilege('service_role',
      'gov_repo.l15_read_risk_projections_v1(uuid,uuid,bigint,bigint,timestamp with time zone,text,text,text,text,text,uuid,timestamp with time zone,timestamp with time zone)', 'EXECUTE')
     OR pg_catalog.has_function_privilege('anon',
      'gov_repo.l15_read_risk_projections_v1(uuid,uuid,bigint,bigint,timestamp with time zone,text,text,text,text,text,uuid,timestamp with time zone,timestamp with time zone)', 'EXECUTE')
     OR pg_catalog.has_function_privilege('authenticated',
      'gov_repo.l15_read_risk_projections_v1(uuid,uuid,bigint,bigint,timestamp with time zone,text,text,text,text,text,uuid,timestamp with time zone,timestamp with time zone)', 'EXECUTE') THEN
    RAISE EXCEPTION 'M17_S7A_POSTFLIGHT: projection ACL invalid' USING ERRCODE='55000';
  END IF;
END $postflight$;
COMMIT;
