-- M17-S7B O72: exact-subject, read-only risk overlay for the existing 16 Passport families.
BEGIN;

DO $preflight$
DECLARE v_sig text;
BEGIN
  IF pg_catalog.current_setting('server_version_num')::integer < 170000 THEN
    RAISE EXCEPTION 'M17_S7B_PREFLIGHT: PostgreSQL 17 required' USING ERRCODE='55000';
  END IF;
  IF pg_catalog.to_regprocedure('gov_repo.l15_read_passport_risk_overlay_v1(uuid,uuid,bigint,bigint,timestamp with time zone,text,text,timestamp with time zone,timestamp with time zone)') IS NOT NULL THEN
    RAISE EXCEPTION 'M17_S7B_PREFLIGHT: overlay already exists' USING ERRCODE='55000';
  END IF;
  FOREACH v_sig IN ARRAY ARRAY[
    'gov_repo.l14_session_basis_v1(uuid,uuid,bigint,bigint,timestamp with time zone)',
    'gov_repo.l15_governed_risk_resolution_v1(uuid,text,text,text,text,text,uuid,timestamp with time zone,timestamp with time zone)',
    'gov_repo.l15_read_risk_projections_v1(uuid,uuid,bigint,bigint,timestamp with time zone,text,text,text,text,text,uuid,timestamp with time zone,timestamp with time zone)',
    'gov_repo.l15_risk_assessment_valid_state_v1(uuid,uuid,text,timestamp with time zone,timestamp with time zone)',
    'gov_repo.l15_risk_acceptance_resolution_v1(uuid,uuid,timestamp with time zone,timestamp with time zone)',
    'gov_repo.l15_governed_risk_support_summary_v1(uuid,uuid,timestamp with time zone,timestamp with time zone)'
  ] LOOP
    IF pg_catalog.to_regprocedure(v_sig) IS NULL THEN
      RAISE EXCEPTION 'M17_S7B_PREFLIGHT: dependency % missing',v_sig USING ERRCODE='55000';
    END IF;
  END LOOP;
END $preflight$;

CREATE FUNCTION gov_repo.l15_read_passport_risk_overlay_v1(
  p_verified_organisation_id uuid,
  p_verified_actor_user_id uuid,
  p_verified_session_iat bigint,
  p_verified_session_exp bigint,
  p_verified_credential_epoch timestamptz,
  p_subject_canonical_kind text,
  p_subject_canonical_object_id text,
  p_effective_at timestamptz,
  p_recorded_cutoff timestamptz
)
RETURNS TABLE(overlay_status text,items jsonb,effective_at timestamptz,recorded_cutoff timestamptz)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,pg_temp SET lock_timeout='5s'
AS $read$
#variable_conflict use_column
DECLARE
  v_now timestamptz:=pg_catalog.clock_timestamp();
  v_at timestamptz:=coalesce(p_effective_at,v_now);
  v_cutoff timestamptz:=coalesce(p_recorded_cutoff,v_now);
BEGIN
  PERFORM 1 FROM gov_repo.l14_session_basis_v1(p_verified_organisation_id,p_verified_actor_user_id,
    p_verified_session_iat,p_verified_session_exp,p_verified_credential_epoch);
  IF (p_effective_at IS NULL)<>(p_recorded_cutoff IS NULL)
     OR p_subject_canonical_kind NOT IN ('AGENT','AGENT_VERSION')
     OR p_subject_canonical_object_id IS NULL OR p_subject_canonical_object_id<>pg_catalog.btrim(p_subject_canonical_object_id)
     OR pg_catalog.length(p_subject_canonical_object_id) NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'L15_READ_INVALID' USING ERRCODE='GV010',DETAIL='PASSPORT_RISK_OVERLAY_KEY_INVALID';
  END IF;

  WITH scenario_keys AS (
    SELECT DISTINCT s.scenario_definition_id
    FROM gov_repo.l15_governed_risk_states s
    WHERE s.organisation_id=p_verified_organisation_id AND s.subject_type='CANONICAL_OBJECT'
      AND s.subject_canonical_kind=p_subject_canonical_kind
      AND s.subject_canonical_object_id=p_subject_canonical_object_id AND s.recorded_at<=v_cutoff
  ), exact_risks AS (
    SELECT s.*,p.lifecycle,p.accountable_parties,sc.support_currency,
      i.rating_band inherent_band,ra.state_id residual_state_id,ra.rating_band residual_band,
      ac.resolution acceptance_resolution,
      ARRAY(SELECT pin.control_assessment_state_id::text
        FROM gov_repo.l15_risk_assessment_state_control_assessment_pins pin
        WHERE pin.organisation_id=p_verified_organisation_id AND pin.state_id=ra.state_id
        ORDER BY pin.control_assessment_state_id) control_assessment_state_ids
    FROM scenario_keys k
    CROSS JOIN LATERAL gov_repo.l15_governed_risk_resolution_v1(p_verified_organisation_id,'CANONICAL_OBJECT',
      p_subject_canonical_kind,p_subject_canonical_object_id,NULL,NULL,k.scenario_definition_id,v_at,v_cutoff) r
    JOIN gov_repo.l15_governed_risk_states s ON s.organisation_id=p_verified_organisation_id AND s.state_id=r.state_id
    CROSS JOIN LATERAL gov_repo.l15_read_risk_projections_v1(p_verified_organisation_id,p_verified_actor_user_id,
      p_verified_session_iat,p_verified_session_exp,p_verified_credential_epoch,'CANONICAL_OBJECT',
      p_subject_canonical_kind,p_subject_canonical_object_id,NULL,NULL,k.scenario_definition_id,v_at,v_cutoff) p
    LEFT JOIN LATERAL gov_repo.l15_governed_risk_support_summary_v1(p_verified_organisation_id,s.state_id,v_at,v_cutoff) sc ON true
    LEFT JOIN LATERAL gov_repo.l15_risk_assessment_valid_state_v1(p_verified_organisation_id,s.state_id,'INHERENT',v_at,v_cutoff) i ON true
    LEFT JOIN LATERAL gov_repo.l15_risk_assessment_valid_state_v1(p_verified_organisation_id,s.state_id,'RESIDUAL',v_at,v_cutoff) ra ON true
    LEFT JOIN LATERAL gov_repo.l15_risk_acceptance_resolution_v1(p_verified_organisation_id,ra.state_id,v_at,v_cutoff) ac ON ra.state_id IS NOT NULL
    WHERE p.lifecycle IS NOT NULL
  )
  SELECT coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'governedRiskStateId',r.state_id,'scenarioDefinitionId',r.scenario_definition_id,'riskDomain',r.risk_domain,
    'subjectKind',r.subject_canonical_kind,'subjectCanonicalObjectId',r.subject_canonical_object_id,
    'familyId',CASE r.risk_domain
      WHEN 'PRIVACY' THEN 'privacy' WHEN 'DATA' THEN 'data'
      WHEN 'CYBERSECURITY' THEN CASE WHEN r.subject_canonical_kind='AGENT_VERSION' THEN 'behavior' ELSE 'tools' END
      WHEN 'AUTHORIZATION' THEN 'authorization' WHEN 'AUTONOMY' THEN 'behavior' WHEN 'MODEL' THEN 'model'
      WHEN 'CONNECTIVITY' THEN 'connectivity' WHEN 'OPERATIONAL' THEN 'runtime' WHEN 'FINOPS' THEN 'runtime' END,
    'lifecycle',r.lifecycle,
    'inherentBand',CASE WHEN r.inherent_band IN ('LOW','MODERATE','HIGH','CRITICAL') THEN r.inherent_band ELSE 'UNKNOWN' END,
    'residualBand',CASE WHEN r.residual_band IN ('LOW','MODERATE','HIGH','CRITICAL') THEN r.residual_band ELSE 'UNKNOWN' END,
    'acceptanceStatus',CASE WHEN r.acceptance_resolution='CURRENT' THEN 'ACCEPTED' ELSE 'UNKNOWN' END,
    'acceptanceValidity',coalesce(r.acceptance_resolution,'UNKNOWN'),
    'supportCurrency',coalesce(r.support_currency,'SUPPORT_NONE'),
    'accountableParties',r.accountable_parties,'controlAssessmentStateIds',r.control_assessment_state_ids,
    'lineage',pg_catalog.jsonb_build_object('proposalId',r.proposal_id,'governanceDecisionId',r.governance_decision_id,
      'authorizationDecisionId',r.authorization_decision_id,'authorityPolicyId',r.authority_policy_id,
      'authorityPolicyVersionId',r.authority_policy_version_id,'recordedAt',r.recorded_at)
    ) ORDER BY r.risk_domain,r.scenario_definition_id),'[]'::jsonb) INTO items
  FROM exact_risks r;

  overlay_status:=CASE WHEN pg_catalog.jsonb_array_length(items)=0 THEN 'UNKNOWN' ELSE 'PRESENT' END;
  effective_at:=v_at;recorded_cutoff:=v_cutoff;
  PERFORM 1 FROM gov_repo.l14_session_basis_v1(p_verified_organisation_id,p_verified_actor_user_id,
    p_verified_session_iat,p_verified_session_exp,p_verified_credential_epoch);
  RETURN NEXT;
END $read$;

ALTER FUNCTION gov_repo.l15_read_passport_risk_overlay_v1(uuid,uuid,bigint,bigint,timestamp with time zone,text,text,timestamp with time zone,timestamp with time zone) OWNER TO postgres;
REVOKE ALL ON FUNCTION gov_repo.l15_read_passport_risk_overlay_v1(uuid,uuid,bigint,bigint,timestamp with time zone,text,text,timestamp with time zone,timestamp with time zone) FROM PUBLIC,anon,authenticated,service_role,govia_l15_machine_intake_caller;
GRANT EXECUTE ON FUNCTION gov_repo.l15_read_passport_risk_overlay_v1(uuid,uuid,bigint,bigint,timestamp with time zone,text,text,timestamp with time zone,timestamp with time zone) TO service_role;
COMMENT ON FUNCTION gov_repo.l15_read_passport_risk_overlay_v1(uuid,uuid,bigint,bigint,timestamp with time zone,text,text,timestamp with time zone,timestamp with time zone) IS
  'M17-S7B exact-subject read-only overlay for the existing Passport families. UNKNOWN on absence; no inheritance, authority writes or family status changes.';

DO $postflight$
BEGIN
  IF EXISTS(SELECT 1 FROM pg_catalog.pg_class c WHERE c.relnamespace='gov_repo'::regnamespace
    AND c.relname LIKE 'l15\_%overlay%' ESCAPE '\') THEN
    RAISE EXCEPTION 'M17_S7B_POSTFLIGHT: overlay relation forbidden' USING ERRCODE='55000';
  END IF;
  IF NOT pg_catalog.has_function_privilege('service_role',
      'gov_repo.l15_read_passport_risk_overlay_v1(uuid,uuid,bigint,bigint,timestamp with time zone,text,text,timestamp with time zone,timestamp with time zone)','EXECUTE')
     OR pg_catalog.has_function_privilege('anon',
      'gov_repo.l15_read_passport_risk_overlay_v1(uuid,uuid,bigint,bigint,timestamp with time zone,text,text,timestamp with time zone,timestamp with time zone)','EXECUTE')
     OR pg_catalog.has_function_privilege('authenticated',
      'gov_repo.l15_read_passport_risk_overlay_v1(uuid,uuid,bigint,bigint,timestamp with time zone,text,text,timestamp with time zone,timestamp with time zone)','EXECUTE') THEN
    RAISE EXCEPTION 'M17_S7B_POSTFLIGHT: overlay ACL invalid' USING ERRCODE='55000';
  END IF;
END $postflight$;
COMMIT;
