-- M17-S5 RISK_TREATMENT. Additive implementation of frozen §§15.1,15.2,17,18; O46/O47/O48.
-- Dependency: S3 only. S4 is preserved but is not read by treatment. Authority Policy root is unchanged.
-- The target date is planning metadata. Controls are dependency pins, never M16 applicability/assessment assertions.
BEGIN;
DO $preflight$ BEGIN
 IF current_user <> 'postgres' OR current_setting('server_version_num')::int NOT BETWEEN 170000 AND 179999
 OR to_regprocedure('gov_repo.l15_governed_risk_state_current_v1(uuid,uuid,timestamptz,timestamptz)') IS NULL
 OR to_regprocedure('gov_repo.l14_governance_party_valid_state_v1(uuid,uuid,timestamptz,timestamptz)') IS NULL
 OR to_regprocedure('gov_repo.l14_control_definition_valid_state_v1(uuid,uuid,uuid,text,timestamptz,timestamptz)') IS NULL
 OR to_regclass('gov_repo.l15_risk_treatment_states') IS NOT NULL THEN
 RAISE EXCEPTION 'M17_S5_PREFLIGHT: PG17, postgres, S3 and M16 registries required, S5 absent'; END IF;
END $preflight$;
CREATE TEMP TABLE m17_s5_root_snapshot ON COMMIT DROP AS SELECT oid,prosrc,proconfig,proacl,proowner,prosecdef FROM pg_proc
 WHERE oid='gov_repo.l15_authorization_allow_guard_v1()'::regprocedure;

CREATE TABLE gov_repo.l15_risk_treatment_proposals (
 organisation_id uuid NOT NULL, proposal_id uuid NOT NULL,
 subject_kind text GENERATED ALWAYS AS ('RISK_TREATMENT') STORED,
 intent text NOT NULL CHECK(intent IN ('VALIDATE','REVOKE')),
 governed_risk_state_id uuid NOT NULL,
 treatment_option text NOT NULL CHECK (treatment_option IN ('MITIGATE','AVOID','TRANSFER')),
 treatment_ordinal_key text NOT NULL CHECK (length(treatment_ordinal_key) BETWEEN 1 AND 500 AND treatment_ordinal_key=btrim(treatment_ordinal_key)), governed_risk_subject_key text NOT NULL,
 governed_risk_scenario_definition_id uuid NOT NULL,
 governed_risk_scenario_definition_version_id uuid NOT NULL,
 governed_risk_scenario_content_hash text NOT NULL,
 governed_risk_scenario_validated_state_id uuid NOT NULL,
 governed_risk_state_kind text GENERATED ALWAYS AS ('VALIDATED') STORED, responsible_governance_party_id uuid NOT NULL,
 party_validated_state_id uuid NOT NULL,
 implementation_status text CHECK (implementation_status IN ('PLANNED','IMPLEMENTED')),
 target_implementation_date date,
 treatment_revocation_reason text CHECK (treatment_revocation_reason IN ('TREATMENT_FAILED','TREATMENT_WITHDRAWN','RECORDED_IN_ERROR')),
 requested_effective_from timestamptz, requested_effective_to timestamptz,
 expected_current_state_id uuid, target_state_id uuid,
 PRIMARY KEY(organisation_id,proposal_id),
 UNIQUE(organisation_id,proposal_id,governed_risk_state_id, treatment_option, treatment_ordinal_key,intent),
 CHECK((intent='VALIDATE' AND implementation_status IS NOT NULL AND target_state_id IS NULL AND treatment_revocation_reason IS NULL)
 OR (intent='REVOKE' AND implementation_status IS NULL AND target_implementation_date IS NULL AND requested_effective_to IS NULL
 AND target_state_id IS NOT NULL AND expected_current_state_id IS NOT NULL AND expected_current_state_id=target_state_id AND treatment_revocation_reason IS NOT NULL)),
 CHECK(requested_effective_to IS NULL OR requested_effective_from IS NULL OR requested_effective_to>requested_effective_from),
 FOREIGN KEY(organisation_id,proposal_id,subject_kind,intent) REFERENCES gov_repo.l14_proposals(organisation_id,proposal_id,subject_kind,intent) ON UPDATE RESTRICT ON DELETE RESTRICT,
 FOREIGN KEY (organisation_id, governed_risk_state_id, governed_risk_subject_key, governed_risk_scenario_definition_id,
 governed_risk_scenario_definition_version_id, governed_risk_scenario_content_hash, governed_risk_scenario_validated_state_id, governed_risk_state_kind)
 REFERENCES gov_repo.l15_governed_risk_states (organisation_id,state_id,subject_key,scenario_definition_id,scenario_definition_version_id,
 scenario_content_hash,scenario_validated_state_id,state_kind) ON UPDATE RESTRICT ON DELETE RESTRICT,
 FOREIGN KEY(organisation_id,party_validated_state_id) REFERENCES gov_repo.l14_governance_party_states(organisation_id,state_id) ON UPDATE RESTRICT ON DELETE RESTRICT
);
CREATE TABLE gov_repo.l15_risk_treatment_states (
 organisation_id uuid NOT NULL, state_id uuid NOT NULL,
 subject_kind text GENERATED ALWAYS AS ('RISK_TREATMENT') STORED,
 state_kind text NOT NULL CHECK(state_kind IN ('VALIDATED','REVOKED')),
 governed_risk_state_id uuid NOT NULL,
 treatment_option text NOT NULL CHECK (treatment_option IN ('MITIGATE','AVOID','TRANSFER')),
 treatment_ordinal_key text NOT NULL CHECK (length(treatment_ordinal_key) BETWEEN 1 AND 500 AND treatment_ordinal_key=btrim(treatment_ordinal_key)), governed_risk_subject_key text NOT NULL,
 governed_risk_scenario_definition_id uuid NOT NULL,
 governed_risk_scenario_definition_version_id uuid NOT NULL,
 governed_risk_scenario_content_hash text NOT NULL,
 governed_risk_scenario_validated_state_id uuid NOT NULL,
 governed_risk_state_kind text GENERATED ALWAYS AS ('VALIDATED') STORED, responsible_governance_party_id uuid NOT NULL,
 party_validated_state_id uuid NOT NULL,
 implementation_status text CHECK (implementation_status IN ('PLANNED','IMPLEMENTED')),
 target_implementation_date date,
 treatment_revocation_reason text CHECK (treatment_revocation_reason IN ('TREATMENT_FAILED','TREATMENT_WITHDRAWN','RECORDED_IN_ERROR')),
 predecessor_state_id uuid, revokes_state_id uuid,
 effective_from timestamptz NOT NULL, effective_to timestamptz, recorded_at timestamptz NOT NULL,
 proposal_id uuid NOT NULL, governance_decision_id uuid NOT NULL, authorization_decision_id uuid NOT NULL,
 decision_outcome text GENERATED ALWAYS AS (CASE WHEN state_kind='VALIDATED' THEN 'VALIDATE' ELSE 'REVOKE' END) STORED,
 authorization_result text GENERATED ALWAYS AS ('ALLOW') STORED,
 authority_policy_id uuid NOT NULL, authority_policy_version_id uuid NOT NULL, authority_policy_content_hash text NOT NULL,
 source_class text NOT NULL CHECK(source_class='LOCAL_HUMAN'), support_status text NOT NULL CHECK(support_status IN ('NONE','PRESENT')),
 PRIMARY KEY(organisation_id,state_id), UNIQUE(organisation_id,governance_decision_id),
 UNIQUE(organisation_id,state_id,governed_risk_state_id, treatment_option, treatment_ordinal_key),
 CHECK((state_kind='VALIDATED' AND implementation_status IS NOT NULL AND revokes_state_id IS NULL AND treatment_revocation_reason IS NULL)
 OR (state_kind='REVOKED' AND implementation_status IS NULL AND revokes_state_id IS NOT NULL AND predecessor_state_id IS NOT NULL
 AND predecessor_state_id=revokes_state_id AND treatment_revocation_reason IS NOT NULL AND effective_to IS NULL)),
 CHECK(effective_to IS NULL OR effective_to>effective_from),
 CHECK(predecessor_state_id IS NULL OR predecessor_state_id<>state_id),
 CHECK(predecessor_state_id IS NOT NULL OR state_kind='VALIDATED'),
 CONSTRAINT l15_risk_treatment_implementation_predecessor_check
 CHECK(implementation_status IS DISTINCT FROM 'IMPLEMENTED' OR predecessor_state_id IS NOT NULL),
 FOREIGN KEY (organisation_id, governed_risk_state_id, governed_risk_subject_key, governed_risk_scenario_definition_id,
 governed_risk_scenario_definition_version_id, governed_risk_scenario_content_hash, governed_risk_scenario_validated_state_id, governed_risk_state_kind)
 REFERENCES gov_repo.l15_governed_risk_states (organisation_id,state_id,subject_key,scenario_definition_id,scenario_definition_version_id,
 scenario_content_hash,scenario_validated_state_id,state_kind) ON UPDATE RESTRICT ON DELETE RESTRICT,
 FOREIGN KEY(organisation_id,party_validated_state_id) REFERENCES gov_repo.l14_governance_party_states(organisation_id,state_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
 FOREIGN KEY(organisation_id,predecessor_state_id,governed_risk_state_id, treatment_option, treatment_ordinal_key) REFERENCES gov_repo.l15_risk_treatment_states(organisation_id,state_id,governed_risk_state_id, treatment_option, treatment_ordinal_key) ON UPDATE RESTRICT ON DELETE RESTRICT,
 FOREIGN KEY(organisation_id,revokes_state_id,governed_risk_state_id, treatment_option, treatment_ordinal_key) REFERENCES gov_repo.l15_risk_treatment_states(organisation_id,state_id,governed_risk_state_id, treatment_option, treatment_ordinal_key) ON UPDATE RESTRICT ON DELETE RESTRICT,
 FOREIGN KEY(organisation_id,proposal_id,governed_risk_state_id, treatment_option, treatment_ordinal_key,decision_outcome) REFERENCES gov_repo.l15_risk_treatment_proposals(organisation_id,proposal_id,governed_risk_state_id, treatment_option, treatment_ordinal_key,intent) ON UPDATE RESTRICT ON DELETE RESTRICT,
 FOREIGN KEY(organisation_id,governance_decision_id,subject_kind,decision_outcome,authorization_decision_id)
 REFERENCES gov_repo.l14_governance_decisions(organisation_id,governance_decision_id,subject_kind,outcome,authorization_decision_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
 FOREIGN KEY(organisation_id,authorization_decision_id,authorization_result,subject_kind,decision_outcome,authority_policy_id,authority_policy_version_id,authority_policy_content_hash)
 REFERENCES gov_repo.l14_authorization_decisions(organisation_id,authorization_decision_id,result,subject_kind,requested_action,basis_authority_policy_id,basis_version_id,basis_content_hash) ON UPDATE RESTRICT ON DELETE RESTRICT
);
CREATE UNIQUE INDEX l15_risk_treatment_root_idx ON gov_repo.l15_risk_treatment_states(organisation_id,governed_risk_state_id, treatment_option, treatment_ordinal_key) WHERE predecessor_state_id IS NULL;
CREATE UNIQUE INDEX l15_risk_treatment_successor_idx ON gov_repo.l15_risk_treatment_states(organisation_id,predecessor_state_id) WHERE predecessor_state_id IS NOT NULL;
CREATE UNIQUE INDEX l15_risk_treatment_revoke_idx ON gov_repo.l15_risk_treatment_states(organisation_id,revokes_state_id) WHERE revokes_state_id IS NOT NULL;
CREATE INDEX l15_risk_treatment_key_idx ON gov_repo.l15_risk_treatment_states(organisation_id,governed_risk_state_id, treatment_option, treatment_ordinal_key);
ALTER TABLE gov_repo.l15_risk_treatment_proposals
 ADD FOREIGN KEY(organisation_id,expected_current_state_id,governed_risk_state_id, treatment_option, treatment_ordinal_key) REFERENCES gov_repo.l15_risk_treatment_states(organisation_id,state_id,governed_risk_state_id, treatment_option, treatment_ordinal_key) ON UPDATE RESTRICT ON DELETE RESTRICT,
 ADD FOREIGN KEY(organisation_id,target_state_id,governed_risk_state_id, treatment_option, treatment_ordinal_key) REFERENCES gov_repo.l15_risk_treatment_states(organisation_id,state_id,governed_risk_state_id, treatment_option, treatment_ordinal_key) ON UPDATE RESTRICT ON DELETE RESTRICT;
CREATE TABLE gov_repo.l15_risk_treatment_heads (
 organisation_id uuid NOT NULL, governed_risk_state_id uuid NOT NULL,
 treatment_option text NOT NULL CHECK (treatment_option IN ('MITIGATE','AVOID','TRANSFER')),
 treatment_ordinal_key text NOT NULL CHECK (length(treatment_ordinal_key) BETWEEN 1 AND 500 AND treatment_ordinal_key=btrim(treatment_ordinal_key)), latest_state_id uuid,
 PRIMARY KEY(organisation_id,governed_risk_state_id, treatment_option, treatment_ordinal_key),
 FOREIGN KEY(organisation_id,governed_risk_state_id) REFERENCES gov_repo.l15_governed_risk_states(organisation_id,state_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
 FOREIGN KEY(organisation_id,latest_state_id,governed_risk_state_id, treatment_option, treatment_ordinal_key) REFERENCES gov_repo.l15_risk_treatment_states(organisation_id,state_id,governed_risk_state_id, treatment_option, treatment_ordinal_key) ON UPDATE RESTRICT ON DELETE RESTRICT
);

CREATE TABLE gov_repo.l15_risk_treatment_proposal_control_pins (
 organisation_id uuid NOT NULL, proposal_id uuid NOT NULL,
 control_definition_id uuid NOT NULL, control_definition_version_id uuid NOT NULL, content_hash text NOT NULL,
 control_validated_state_id uuid NOT NULL, control_state_kind text GENERATED ALWAYS AS ('VALIDATED') STORED,
 PRIMARY KEY(organisation_id,proposal_id,control_definition_version_id),
 FOREIGN KEY(organisation_id,proposal_id) REFERENCES gov_repo.l15_risk_treatment_proposals(organisation_id,proposal_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
 FOREIGN KEY(organisation_id,control_validated_state_id,control_definition_id,control_definition_version_id,content_hash,control_state_kind)
 REFERENCES gov_repo.l14_control_definition_states(organisation_id,state_id,control_definition_id,control_definition_version_id,content_hash,state_kind) ON UPDATE RESTRICT ON DELETE RESTRICT
);

CREATE TABLE gov_repo.l15_risk_treatment_state_control_pins (
 organisation_id uuid NOT NULL, state_id uuid NOT NULL,
 control_definition_id uuid NOT NULL, control_definition_version_id uuid NOT NULL, content_hash text NOT NULL,
 control_validated_state_id uuid NOT NULL, control_state_kind text GENERATED ALWAYS AS ('VALIDATED') STORED,
 PRIMARY KEY(organisation_id,state_id,control_definition_version_id),
 FOREIGN KEY(organisation_id,state_id) REFERENCES gov_repo.l15_risk_treatment_states(organisation_id,state_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
 FOREIGN KEY(organisation_id,control_validated_state_id,control_definition_id,control_definition_version_id,content_hash,control_state_kind)
 REFERENCES gov_repo.l14_control_definition_states(organisation_id,state_id,control_definition_id,control_definition_version_id,content_hash,state_kind) ON UPDATE RESTRICT ON DELETE RESTRICT
);
CREATE FUNCTION gov_repo.l15_lock_risk_treatment_key_guard_v1(p_organisation_id uuid, p_governed_risk_state_id uuid,
  p_treatment_option text, p_treatment_ordinal_key text)
RETURNS void LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, pg_temp AS $guard$
BEGIN
  IF p_organisation_id IS NULL OR p_governed_risk_state_id IS NULL OR p_treatment_option IS NULL
     OR p_treatment_option NOT IN ('MITIGATE','AVOID','TRANSFER') OR p_treatment_ordinal_key IS NULL THEN
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'GUARD_KEY_INVALID';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    gov_repo.frame_identity(ARRAY[p_organisation_id::text, 'l15-risk-treatment-key-guard-v1', p_governed_risk_state_id::text,
                                  p_treatment_option, p_treatment_ordinal_key]), 0));
END;
$guard$;
CREATE FUNCTION gov_repo.l15_risk_treatment_lock_risk_dependency_v1(
  p_organisation_id uuid, p_subject_key text, p_scenario_definition_id uuid)
RETURNS void LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, pg_temp AS $guard$
BEGIN
  IF p_organisation_id IS NULL OR p_subject_key IS NULL OR pg_catalog.length(p_subject_key) NOT BETWEEN 1 AND 1100
     OR p_scenario_definition_id IS NULL THEN
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'GUARD_KEY_INVALID';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock_shared(pg_catalog.hashtextextended(
    gov_repo.frame_identity(ARRAY[p_organisation_id::text, 'l15-governed-risk-key-guard-v1', p_subject_key,
                                  p_scenario_definition_id::text]), 0));
END;
$guard$;
ALTER TABLE gov_repo.l15_support_links
 ADD COLUMN owner_risk_treatment_artifact text CHECK(owner_risk_treatment_artifact IN ('PROPOSAL','DECISION','STATE')),
 ADD COLUMN owner_risk_treatment_proposal_id uuid,
 ADD COLUMN owner_risk_treatment_state_id uuid,
 ADD FOREIGN KEY(organisation_id,owner_risk_treatment_proposal_id) REFERENCES gov_repo.l15_risk_treatment_proposals(organisation_id,proposal_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
 ADD FOREIGN KEY(organisation_id,owner_risk_treatment_state_id) REFERENCES gov_repo.l15_risk_treatment_states(organisation_id,state_id) ON UPDATE RESTRICT ON DELETE RESTRICT;
DO $widen$
DECLARE v text; old_shape text; treatment_shape text; guard text; branch text;
BEGIN
 SELECT pg_get_expr(conbin,conrelid) INTO v FROM pg_constraint WHERE conrelid='gov_repo.l15_support_links'::regclass AND conname='l15_support_links_owner_kind_check';
 ALTER TABLE gov_repo.l15_support_links DROP CONSTRAINT l15_support_links_owner_kind_check;
 EXECUTE 'ALTER TABLE gov_repo.l15_support_links ADD CONSTRAINT l15_support_links_owner_kind_check CHECK (('||v||') OR owner_kind=''RISK_TREATMENT'')';
 SELECT pg_get_expr(conbin,conrelid) INTO old_shape FROM pg_constraint WHERE conrelid='gov_repo.l15_support_links'::regclass AND conname='l15_support_links_owner_shape_check';
 treatment_shape := 'owner_kind=''RISK_TREATMENT'' AND owner_signal_id IS NULL AND owner_signal_kind IS NULL AND owner_hypothesis_id IS NULL AND owner_registry_artifact IS NULL
 AND num_nonnulls(owner_scenario_proposal_id,owner_methodology_proposal_id,owner_scenario_state_id,owner_methodology_state_id,
 owner_governed_risk_artifact,owner_governed_risk_proposal_id,owner_governed_risk_state_id)=0
 AND owner_risk_treatment_artifact IS NOT NULL AND num_nonnulls(owner_risk_treatment_proposal_id,owner_governance_decision_id,owner_risk_treatment_state_id)=1
 AND ((owner_risk_treatment_artifact=''PROPOSAL'')=(owner_risk_treatment_proposal_id IS NOT NULL))
 AND ((owner_risk_treatment_artifact=''DECISION'')=(owner_governance_decision_id IS NOT NULL))
 AND ((owner_risk_treatment_artifact=''STATE'')=(owner_risk_treatment_state_id IS NOT NULL))';
 IF EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid='gov_repo.l15_support_links'::regclass AND attname='owner_risk_assessment_artifact') THEN
 treatment_shape:=treatment_shape||' AND num_nonnulls(owner_risk_assessment_artifact,owner_risk_assessment_proposal_id,owner_risk_assessment_state_id)=0'; END IF;
 ALTER TABLE gov_repo.l15_support_links DROP CONSTRAINT l15_support_links_owner_shape_check;
 EXECUTE 'ALTER TABLE gov_repo.l15_support_links ADD CONSTRAINT l15_support_links_owner_shape_check CHECK ((('||old_shape||') AND num_nonnulls(owner_risk_treatment_artifact,owner_risk_treatment_proposal_id,owner_risk_treatment_state_id)=0) OR ('||treatment_shape||'))';
 SELECT pg_get_expr(conbin,conrelid) INTO v FROM pg_constraint WHERE conrelid='gov_repo.l15_support_links'::regclass AND conname='l15_support_links_owner_target_matrix_check';
 ALTER TABLE gov_repo.l15_support_links DROP CONSTRAINT l15_support_links_owner_target_matrix_check;
 EXECUTE 'ALTER TABLE gov_repo.l15_support_links ADD CONSTRAINT l15_support_links_owner_target_matrix_check CHECK (('||v||') OR owner_kind=''RISK_TREATMENT'')';
 -- Existing target-tag CHECK already closes the rank-3 target vocabulary.
 SELECT pg_get_functiondef('gov_repo.l15_support_link_insert_guard_v1()'::regprocedure) INTO guard;
 branch := $branch$
 ELSIF NEW.owner_kind='RISK_TREATMENT' THEN
 IF NOT (CASE NEW.owner_risk_treatment_artifact
 WHEN 'PROPOSAL' THEN EXISTS(SELECT 1 FROM gov_repo.l15_risk_treatment_proposals p WHERE p.organisation_id=NEW.organisation_id AND p.proposal_id=NEW.owner_risk_treatment_proposal_id AND p.xmin=pg_current_xact_id()::xid)
 WHEN 'DECISION' THEN EXISTS(SELECT 1 FROM gov_repo.l14_governance_decisions d WHERE d.organisation_id=NEW.organisation_id AND d.governance_decision_id=NEW.owner_governance_decision_id AND d.subject_kind='RISK_TREATMENT' AND d.xmin=pg_current_xact_id()::xid)
 WHEN 'STATE' THEN EXISTS(SELECT 1 FROM gov_repo.l15_risk_treatment_states s WHERE s.organisation_id=NEW.organisation_id AND s.state_id=NEW.owner_risk_treatment_state_id AND s.xmin=pg_current_xact_id()::xid)
 ELSE false END) THEN RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE='GV010',DETAIL='SUPPORT_OWNER_NOT_IN_TRANSACTION'; END IF;
 IF NEW.target_tag='CROSS_SIGNAL_RESULT' AND NOT EXISTS(SELECT 1 FROM gov_repo.cross_signal_comparison_results r WHERE r.organisation_id=NEW.organisation_id AND r.comparison_id=NEW.target_cross_signal_comparison_id AND r.outcome IN ('CONFLICT_CANDIDATE','INSUFFICIENT_EVIDENCE','DRIFT_CANDIDATE')) THEN
 RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE='GV010',DETAIL='CROSS_SIGNAL_RESULT_NOT_ADMISSIBLE'; END IF;
 RETURN NEW;
 $branch$;
 IF position('ELSIF NEW.owner_kind = ''GOVERNED_RISK'' THEN' in guard)=0 THEN RAISE EXCEPTION 'S5 support guard shape unexpected'; END IF;
 EXECUTE replace(guard,'ELSIF NEW.owner_kind = ''GOVERNED_RISK'' THEN',branch||'ELSIF NEW.owner_kind = ''GOVERNED_RISK'' THEN');
 FOREACH v IN ARRAY ARRAY['l14_command_results_shape_check','l14_command_results_l15_state_check'] LOOP
 SELECT pg_get_expr(conbin,conrelid) INTO old_shape FROM pg_constraint WHERE conrelid='gov_repo.l14_command_results'::regclass AND conname=v;
 -- Add RISK_TREATMENT beside GOVERNED_RISK in every existing L15 branch, preserving all other predicates.
 old_shape:=replace(old_shape,'''GOVERNED_RISK''::text','''GOVERNED_RISK''::text, ''RISK_TREATMENT''::text');
 EXECUTE format('ALTER TABLE gov_repo.l14_command_results DROP CONSTRAINT %I',v);
 EXECUTE format('ALTER TABLE gov_repo.l14_command_results ADD CONSTRAINT %I CHECK (%s)',v,old_shape);
 END LOOP;
 SELECT pg_get_functiondef('gov_repo.l15_command_result_state_guard_v1()'::regprocedure) INTO guard;
 branch:=$branch$ WHEN 'RISK_TREATMENT' THEN EXISTS(SELECT 1 FROM gov_repo.l15_risk_treatment_states s WHERE s.organisation_id=NEW.organisation_id AND s.state_id=NEW.l15_state_id AND s.governance_decision_id=NEW.governance_decision_id AND s.proposal_id=NEW.proposal_id AND s.authorization_decision_id=NEW.authorization_decision_id AND s.state_kind=NEW.outcome AND s.recorded_at=NEW.recorded_at) $branch$;
 EXECUTE replace(guard,'ELSE false END)',branch||'ELSE false END)');
END $widen$;
CREATE FUNCTION gov_repo.l15_write_risk_treatment_support_links_v1(p_organisation_id uuid, p_artifact text,
  p_proposal_id uuid, p_governance_decision_id uuid, p_state_id uuid, p_tags text[], p_ids text[])
RETURNS integer LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $fn$
DECLARE
  v_row record;
  v_count integer := 0;
BEGIN
  IF p_artifact IS NULL OR p_artifact NOT IN ('PROPOSAL','DECISION','STATE') THEN
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'SUPPORT_OWNER_INVALID';
  END IF;
  FOR v_row IN SELECT * FROM gov_repo.l15_normalize_support_v1(p_organisation_id, p_tags, p_ids) LOOP
    INSERT INTO gov_repo.l15_support_links (organisation_id, link_id, owner_kind, owner_risk_treatment_artifact,
      owner_risk_treatment_proposal_id, owner_governance_decision_id, owner_risk_treatment_state_id, target_tag,
      target_discovery_evidence_id, target_source_assertion_id, target_runtime_observation_id, target_cross_signal_comparison_id,
      target_execution_field_state_id, target_technical_field_state_id, target_lineage_observation_finding_id,
      target_l14_fact_state_id, target_l14_fact_subject_kind, target_risk_signal_id, target_risk_hypothesis_id, recorded_at)
    VALUES (p_organisation_id, pg_catalog.gen_random_uuid(), 'RISK_TREATMENT', p_artifact,
      CASE WHEN p_artifact = 'PROPOSAL' THEN p_proposal_id END,
      CASE WHEN p_artifact = 'DECISION' THEN p_governance_decision_id END,
      CASE WHEN p_artifact = 'STATE' THEN p_state_id END,
      v_row.tag,
      CASE WHEN v_row.tag = 'DISCOVERY_EVIDENCE' THEN v_row.target_id END,
      CASE WHEN v_row.tag = 'SOURCE_ASSERTION' THEN v_row.target_id END,
      CASE WHEN v_row.tag = 'RUNTIME_OBSERVATION' THEN v_row.target_id::uuid END,
      CASE WHEN v_row.tag = 'CROSS_SIGNAL_RESULT' THEN v_row.target_id END,
      CASE WHEN v_row.tag = 'EXECUTION_FIELD_STATE' THEN v_row.target_id END,
      CASE WHEN v_row.tag = 'TECHNICAL_FIELD_STATE' THEN v_row.target_id END,
      CASE WHEN v_row.tag = 'LINEAGE_OBSERVATION' THEN v_row.target_id END,
      CASE WHEN v_row.tag = 'L14_FACT_STATE' THEN v_row.target_id::uuid END,
      v_row.l14_subject_kind,
      CASE WHEN v_row.tag = 'RISK_SIGNAL' THEN v_row.target_id::uuid END,
      CASE WHEN v_row.tag = 'RISK_HYPOTHESIS' THEN v_row.target_id::uuid END,
      pg_catalog.now());
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$fn$;
ALTER TABLE gov_repo.l15_risk_treatment_proposals ADD COLUMN control_pin_count integer NOT NULL CHECK(control_pin_count>=0);
CREATE FUNCTION gov_repo.l15_risk_treatment_content_parts_v1(p_governed_risk_state_id uuid, p_treatment_option text, p_treatment_ordinal_key text, p_responsible_governance_party_id uuid, p_party_validated_state_id uuid, p_implementation_status text, p_target_implementation_date date, p_treatment_revocation_reason text, p_control_definition_version_ids uuid[], p_requested_effective_from timestamptz, p_requested_effective_to timestamptz)
RETURNS text[] LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $$
 SELECT ARRAY[p_governed_risk_state_id::text,p_treatment_option,p_treatment_ordinal_key,p_responsible_governance_party_id::text,p_party_validated_state_id::text,
 COALESCE(p_implementation_status,'NO_IMPLEMENTATION_STATUS'),COALESCE(to_char(p_target_implementation_date,'YYYY-MM-DD'),'NO_TARGET_DATE'),COALESCE(p_treatment_revocation_reason,'NO_REVOCATION_REASON'),
 cardinality(p_control_definition_version_ids)::text]
 || ARRAY(SELECT x::text FROM unnest(p_control_definition_version_ids) x ORDER BY x)
 || CASE WHEN p_requested_effective_from IS NULL THEN ARRAY['IMMEDIATE'] ELSE ARRAY['EXPLICIT',gov_repo.l14_canonical_instant_v1(p_requested_effective_from)] END
 || CASE WHEN p_requested_effective_to IS NULL THEN ARRAY['NO_EFFECTIVE_TO'] ELSE ARRAY['EFFECTIVE_TO',gov_repo.l14_canonical_instant_v1(p_requested_effective_to)] END
$$;
CREATE FUNCTION gov_repo.l15_risk_treatment_party_valid_v1(p_org uuid,p_party uuid,p_state uuid,p_at timestamptz,p_cutoff timestamptz)
RETURNS boolean LANGUAGE sql STABLE SET search_path=pg_catalog,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM gov_repo.l14_governance_party_valid_state_v1(p_org,p_party,p_at,p_cutoff) v WHERE v.state_id=p_state)
$$;
CREATE FUNCTION gov_repo.l15_risk_treatment_command_result_v1(p_organisation_id uuid,p_command_id text,p_replay boolean)
RETURNS TABLE(replay boolean, command_id text, command_kind text, subject_kind text, outcome text, command_fingerprint text,
 authorization_decision_id uuid, authorization_result text, deny_reason text, expectation_kind text, expected_current_state_id uuid,
 proposal_id uuid, governance_decision_id uuid, governed_risk_state_id uuid, treatment_option text, treatment_ordinal_key text,
 responsible_governance_party_id uuid, party_validated_state_id uuid, implementation_status text, target_implementation_date date,
 treatment_revocation_reason text, control_pins jsonb, state_id uuid, state_kind text, predecessor_state_id uuid,
 effective_from timestamptz, effective_to timestamptz, recorded_at timestamptz) LANGUAGE sql STABLE SET search_path=pg_catalog,pg_temp AS $$
 SELECT p_replay,c.command_id,c.command_kind,c.subject_kind,c.outcome,c.command_fingerprint,a.authorization_decision_id,a.result,a.deny_reason,a.expectation_kind,a.expected_current_state_id,
 c.proposal_id,c.governance_decision_id,p.governed_risk_state_id,p.treatment_option,p.treatment_ordinal_key,
 p.responsible_governance_party_id,p.party_validated_state_id,p.implementation_status,p.target_implementation_date,p.treatment_revocation_reason,
 COALESCE((SELECT jsonb_agg(jsonb_build_object('controlDefinitionId',x.control_definition_id,'controlDefinitionVersionId',x.control_definition_version_id,'contentHash',x.content_hash,'validatedStateId',x.control_validated_state_id) ORDER BY x.control_definition_version_id)
 FROM gov_repo.l15_risk_treatment_proposal_control_pins x WHERE x.organisation_id=c.organisation_id AND x.proposal_id=c.proposal_id),'[]'::jsonb),
 s.state_id,s.state_kind,s.predecessor_state_id,s.effective_from,s.effective_to,c.recorded_at
 FROM gov_repo.l14_command_results c LEFT JOIN gov_repo.l14_authorization_decisions a USING(organisation_id,authorization_decision_id)
 LEFT JOIN gov_repo.l15_risk_treatment_proposals p ON p.organisation_id=c.organisation_id AND p.proposal_id=c.proposal_id
 LEFT JOIN gov_repo.l15_risk_treatment_states s ON s.organisation_id=c.organisation_id AND s.state_id=c.l15_state_id
 WHERE c.organisation_id=p_organisation_id AND c.command_id=p_command_id AND c.subject_kind='RISK_TREATMENT'
$$;
CREATE FUNCTION gov_repo.l15_submit_risk_treatment_proposal_v1(
  p_verified_organisation_id uuid,
  p_verified_actor_user_id uuid,
  p_verified_session_iat bigint,
  p_verified_session_exp bigint,
  p_verified_credential_epoch timestamptz,
  p_command_id text,
  p_intent text,
  p_source_class text,
  p_governed_risk_state_id uuid,
  p_treatment_option text,
  p_treatment_ordinal_key text,
  p_responsible_governance_party_id uuid,
  p_party_validated_state_id uuid,
  p_implementation_status text,
  p_target_implementation_date date,
  p_treatment_revocation_reason text,
  p_control_definition_version_ids uuid[],
  p_requested_effective_from timestamptz,
  p_requested_effective_to timestamptz,
  p_expected_current_state_id uuid,
  p_target_state_id uuid,
  p_prior_proposal_id uuid,
  p_support_status text,
  p_support_tags text[],
  p_support_target_ids text[],
  p_caller_fingerprint text
)
RETURNS TABLE (replay boolean, command_id text, command_kind text, subject_kind text, outcome text, command_fingerprint text,
 authorization_decision_id uuid, authorization_result text, deny_reason text, expectation_kind text, expected_current_state_id uuid,
 proposal_id uuid, governance_decision_id uuid, governed_risk_state_id uuid, treatment_option text, treatment_ordinal_key text,
 responsible_governance_party_id uuid, party_validated_state_id uuid, implementation_status text, target_implementation_date date,
 treatment_revocation_reason text, control_pins jsonb, state_id uuid, state_kind text, predecessor_state_id uuid,
 effective_from timestamptz, effective_to timestamptz, recorded_at timestamptz)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp SET lock_timeout = '5s'
AS $submit$
#variable_conflict use_column
DECLARE
  v_org uuid := p_verified_organisation_id;
  v_actor uuid := p_verified_actor_user_id;
  v_support text[];
  v_fingerprint text;
  v_risk record;
  v_pin record;
  v_target record;
  v_head uuid;
  v_from timestamptz;
  v_proposal uuid := pg_catalog.gen_random_uuid();
  v_now timestamptz;
BEGIN
  PERFORM 1 FROM gov_repo.l14_session_basis_v1(v_org, v_actor, p_verified_session_iat,
    p_verified_session_exp, p_verified_credential_epoch);
  PERFORM gov_repo.l14_validate_command_id_v1(p_command_id, p_caller_fingerprint);
  IF p_intent IS NULL OR p_intent NOT IN ('VALIDATE','REVOKE')
     OR p_source_class IS NULL OR p_source_class NOT IN ('SYSTEM_SEED','LOCAL_HUMAN','SOURCE_CONNECTION') THEN
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'PROPOSAL_VOCABULARY_UNKNOWN';
  END IF;
  IF p_source_class = 'SYSTEM_SEED' THEN
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'SYSTEM_SEED_NOT_ADMISSIBLE';
  END IF;
  IF p_source_class = 'SOURCE_CONNECTION' THEN
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'SOURCE_CONNECTION_NOT_ADMISSIBLE';
  END IF;

 IF p_treatment_option IS NULL OR p_treatment_option NOT IN ('MITIGATE','AVOID','TRANSFER') THEN RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE='GV010', DETAIL='TREATMENT_OPTION_UNKNOWN'; END IF;
 IF p_treatment_ordinal_key IS NULL OR length(p_treatment_ordinal_key) NOT BETWEEN 1 AND 500 OR p_treatment_ordinal_key<>btrim(p_treatment_ordinal_key) THEN RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE='GV010', DETAIL='TREATMENT_ORDINAL_KEY_INVALID'; END IF;
 IF p_governed_risk_state_id IS NULL OR p_responsible_governance_party_id IS NULL OR p_party_validated_state_id IS NULL THEN RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE='GV010', DETAIL='DEPENDENCY_PIN_REQUIRED'; END IF;
 IF p_implementation_status IS NOT NULL AND p_implementation_status NOT IN ('PLANNED','IMPLEMENTED') THEN RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE='GV010', DETAIL='IMPLEMENTATION_STATUS_UNKNOWN'; END IF;
 IF p_treatment_revocation_reason IS NOT NULL AND p_treatment_revocation_reason NOT IN ('TREATMENT_FAILED','TREATMENT_WITHDRAWN','RECORDED_IN_ERROR') THEN RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE='GV010', DETAIL='TREATMENT_REVOCATION_REASON_UNKNOWN'; END IF;
 IF p_intent='VALIDATE' AND (p_implementation_status IS NULL OR p_treatment_revocation_reason IS NOT NULL OR p_target_state_id IS NOT NULL) THEN RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE='GV010', DETAIL='TREATMENT_CONTENT_INVALID'; END IF;
 IF p_intent='VALIDATE' AND p_implementation_status='IMPLEMENTED' AND p_expected_current_state_id IS NULL THEN
   RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE='GV010', DETAIL='IMPLEMENTATION_PREDECESSOR_REQUIRED';
 END IF;
 IF p_intent='REVOKE' AND (p_implementation_status IS NOT NULL OR p_target_implementation_date IS NOT NULL OR p_requested_effective_to IS NOT NULL OR p_treatment_revocation_reason IS NULL OR p_target_state_id IS NULL OR p_expected_current_state_id IS DISTINCT FROM p_target_state_id) THEN RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE='GV010', DETAIL='REVOCATION_CONTENT_INVALID'; END IF;
 IF p_control_definition_version_ids IS NULL OR array_position(p_control_definition_version_ids,NULL) IS NOT NULL OR cardinality(p_control_definition_version_ids)<> (SELECT count(DISTINCT x) FROM unnest(p_control_definition_version_ids) x) THEN RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE='GV010', DETAIL='CONTROL_PINS_MALFORMED'; END IF;
 IF p_treatment_option<>'MITIGATE' AND cardinality(p_control_definition_version_ids)>0 THEN RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE='GV010', DETAIL='CONTROL_PINS_NOT_PERMITTED'; END IF;
 IF p_requested_effective_to IS NOT NULL AND p_requested_effective_from IS NOT NULL AND p_requested_effective_to<=p_requested_effective_from THEN RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE='GV010', DETAIL='EFFECTIVE_INTERVAL_INVALID'; END IF;
  v_support := gov_repo.l15_governed_risk_support_parts_v1(p_support_status, p_support_tags, p_support_target_ids);
  v_fingerprint := gov_repo.l14_sha256_frame_v1(
    ARRAY['L15_COMMAND_FINGERPRINT_V1', 'SUBMIT_PROPOSAL', v_org::text, v_actor::text, 'RISK_TREATMENT', p_intent,
          p_source_class] || gov_repo.l15_risk_treatment_content_parts_v1(p_governed_risk_state_id, p_treatment_option, p_treatment_ordinal_key, p_responsible_governance_party_id, p_party_validated_state_id, p_implementation_status, p_target_implementation_date, p_treatment_revocation_reason, p_control_definition_version_ids, p_requested_effective_from, p_requested_effective_to)
    || CASE WHEN p_expected_current_state_id IS NULL THEN ARRAY['EXPECTED_NONE']
            ELSE ARRAY['EXPECTED_CURRENT', p_expected_current_state_id::text] END
    || CASE WHEN p_target_state_id IS NULL THEN ARRAY['NO_TARGET_STATE'] ELSE ARRAY['TARGET_STATE', p_target_state_id::text] END
    || CASE WHEN p_prior_proposal_id IS NULL THEN ARRAY['NO_PRIOR_PROPOSAL'] ELSE ARRAY['PRIOR_PROPOSAL', p_prior_proposal_id::text] END
    || v_support);
  IF v_fingerprint IS DISTINCT FROM p_caller_fingerprint THEN
    RAISE EXCEPTION 'L14_FINGERPRINT_MISMATCH' USING ERRCODE = 'GV008', DETAIL = 'CALLER_FINGERPRINT_DIFFERS';
  END IF;
  PERFORM gov_repo.l14_lock_authority_policy_guard_shared_v1(v_org);
  PERFORM gov_repo.l15_lock_risk_treatment_key_guard_v1(v_org, p_governed_risk_state_id, p_treatment_option, p_treatment_ordinal_key);
  PERFORM gov_repo.l14_lock_command_guard_v1(v_org, p_command_id);
  IF gov_repo.l14_replay_arbitrate_v1(v_org, p_command_id, v_fingerprint) THEN
    PERFORM 1 FROM gov_repo.l14_session_basis_v1(v_org, v_actor, p_verified_session_iat,
      p_verified_session_exp, p_verified_credential_epoch);
    RETURN QUERY SELECT * FROM gov_repo.l15_risk_treatment_command_result_v1(v_org, p_command_id, true);
    RETURN;
  END IF;
  SELECT s.state_kind, s.subject_key, s.scenario_definition_id, s.scenario_definition_version_id,
         s.scenario_content_hash, s.scenario_validated_state_id INTO v_risk
  FROM gov_repo.l15_governed_risk_states AS s WHERE s.organisation_id = v_org AND s.state_id = p_governed_risk_state_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'GOVERNED_RISK_STATE_UNRESOLVED';
  END IF;
  IF v_risk.state_kind <> 'VALIDATED' THEN
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'GOVERNED_RISK_STATE_NOT_VALIDATED';
  END IF;
  v_now := pg_catalog.clock_timestamp();
  v_from := COALESCE(p_requested_effective_from, v_now);
  IF p_intent = 'VALIDATE' AND NOT gov_repo.l15_governed_risk_state_current_v1(v_org, p_governed_risk_state_id, v_from, v_now) THEN
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'GOVERNED_RISK_STATE_NOT_CURRENT';
  END IF;

 IF NOT EXISTS(SELECT 1 FROM gov_repo.l14_governance_party_states ps WHERE ps.organisation_id=v_org AND ps.state_id=p_party_validated_state_id AND ps.governance_party_id=p_responsible_governance_party_id AND ps.state_kind='VALIDATED') THEN RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE='GV010', DETAIL='PARTY_PIN_UNRESOLVED'; END IF;
 IF p_intent='VALIDATE' AND NOT gov_repo.l15_risk_treatment_party_valid_v1(v_org,p_responsible_governance_party_id,p_party_validated_state_id,v_from,v_now) THEN RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE='GV010', DETAIL='PARTY_DEPENDENCY_NOT_VALID'; END IF;
  SELECT h.latest_state_id INTO v_head FROM gov_repo.l15_risk_treatment_heads AS h
  WHERE h.organisation_id = v_org AND h.governed_risk_state_id = p_governed_risk_state_id AND h.treatment_option = p_treatment_option AND h.treatment_ordinal_key = p_treatment_ordinal_key;
  IF p_expected_current_state_id IS NULL AND v_head IS NOT NULL THEN
    RAISE EXCEPTION 'L15_STALE_EXPECTATION' USING ERRCODE = 'GV009', DETAIL = 'RISK_TREATMENT_STATE_EXISTS';
  END IF;
  IF p_expected_current_state_id IS DISTINCT FROM v_head THEN
    RAISE EXCEPTION 'L15_STALE_EXPECTATION' USING ERRCODE = 'GV009', DETAIL = 'RISK_TREATMENT_STATE_EXPECTATION_MISMATCH';
  END IF;
  IF p_intent = 'REVOKE' THEN

    SELECT s.* INTO v_target FROM gov_repo.l15_risk_treatment_states s WHERE s.organisation_id=v_org AND s.state_id=p_target_state_id;
    IF NOT FOUND OR v_target.governed_risk_state_id<>p_governed_risk_state_id OR v_target.treatment_option<>p_treatment_option OR v_target.treatment_ordinal_key<>p_treatment_ordinal_key
    OR v_target.responsible_governance_party_id<>p_responsible_governance_party_id OR v_target.party_validated_state_id<>p_party_validated_state_id
    OR (SELECT COALESCE(array_agg(x.control_definition_version_id ORDER BY x.control_definition_version_id),'{}'::uuid[]) FROM gov_repo.l15_risk_treatment_state_control_pins x WHERE x.organisation_id=v_org AND x.state_id=p_target_state_id)
       IS DISTINCT FROM ARRAY(SELECT x FROM unnest(p_control_definition_version_ids) x ORDER BY x) THEN RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE='GV010', DETAIL='TARGET_STATE_UNRESOLVED'; END IF;
    IF v_target.state_kind <> 'VALIDATED' THEN
      RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'TARGET_STATE_NOT_VALIDATED';
    END IF;
    PERFORM 1 FROM gov_repo.l15_risk_treatment_states AS s
    WHERE s.organisation_id = v_org AND s.state_kind = 'REVOKED' AND s.revokes_state_id = p_target_state_id;
    IF FOUND THEN
      RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'TARGET_ALREADY_REVOKED';
    END IF;
  END IF;
  IF p_prior_proposal_id IS NOT NULL THEN
    PERFORM 1 FROM gov_repo.l15_risk_treatment_proposals AS cp
    WHERE cp.organisation_id = v_org AND cp.proposal_id = p_prior_proposal_id
      AND cp.governed_risk_state_id = p_governed_risk_state_id AND cp.treatment_option = p_treatment_option AND cp.treatment_ordinal_key = p_treatment_ordinal_key;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'PRIOR_PROPOSAL_UNRESOLVED';
    END IF;
  END IF;
  PERFORM 1 FROM gov_repo.l15_normalize_support_v1(v_org, p_support_tags, p_support_target_ids);
  INSERT INTO gov_repo.l14_proposals (organisation_id, proposal_id, subject_kind, intent, source_class,
    submitted_by_actor_user_id, prior_proposal_id, support_status, submitted_at)
  VALUES (v_org, v_proposal, 'RISK_TREATMENT', p_intent, p_source_class, v_actor, p_prior_proposal_id, p_support_status, v_now);

 INSERT INTO gov_repo.l15_risk_treatment_proposals(organisation_id,proposal_id,intent,governed_risk_state_id,treatment_option,treatment_ordinal_key,
 governed_risk_subject_key,governed_risk_scenario_definition_id,governed_risk_scenario_definition_version_id,governed_risk_scenario_content_hash,governed_risk_scenario_validated_state_id,
 responsible_governance_party_id,party_validated_state_id,implementation_status,target_implementation_date,treatment_revocation_reason,requested_effective_from,requested_effective_to,expected_current_state_id,target_state_id,control_pin_count)
 VALUES(v_org,v_proposal,p_intent,p_governed_risk_state_id,p_treatment_option,p_treatment_ordinal_key,
 v_risk.subject_key,v_risk.scenario_definition_id,v_risk.scenario_definition_version_id,v_risk.scenario_content_hash,v_risk.scenario_validated_state_id,
 p_responsible_governance_party_id,p_party_validated_state_id,p_implementation_status,p_target_implementation_date,p_treatment_revocation_reason,p_requested_effective_from,p_requested_effective_to,p_expected_current_state_id,p_target_state_id,cardinality(p_control_definition_version_ids));
 IF p_intent='REVOKE' THEN
 INSERT INTO gov_repo.l15_risk_treatment_proposal_control_pins(organisation_id,proposal_id,control_definition_id,control_definition_version_id,content_hash,control_validated_state_id) SELECT organisation_id,v_proposal,control_definition_id,control_definition_version_id,content_hash,control_validated_state_id FROM gov_repo.l15_risk_treatment_state_control_pins WHERE organisation_id=v_org AND state_id=p_target_state_id;
 ELSE
 FOR v_pin IN SELECT v.*, s.state_id FROM gov_repo.l14_control_definition_versions v CROSS JOIN LATERAL gov_repo.l14_control_definition_valid_state_v1(v_org,v.control_definition_id,v.control_definition_version_id,v.content_hash::text,v_from,v_now) s
 WHERE v.organisation_id=v_org AND v.control_definition_version_id=ANY(p_control_definition_version_ids) LOOP
 INSERT INTO gov_repo.l15_risk_treatment_proposal_control_pins(organisation_id,proposal_id,control_definition_id,control_definition_version_id,content_hash,control_validated_state_id)
 VALUES(v_org,v_proposal,v_pin.control_definition_id,v_pin.control_definition_version_id,v_pin.content_hash,v_pin.state_id);
 END LOOP;
 IF (SELECT count(*) FROM gov_repo.l15_risk_treatment_proposal_control_pins WHERE organisation_id=v_org AND proposal_id=v_proposal)<>cardinality(p_control_definition_version_ids) THEN RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE='GV010', DETAIL='CONTROL_DEPENDENCY_NOT_VALID'; END IF;
 END IF;
  PERFORM gov_repo.l15_write_risk_treatment_support_links_v1(v_org, 'PROPOSAL', v_proposal, NULL, NULL,
    p_support_tags, p_support_target_ids);
  INSERT INTO gov_repo.l14_command_results (organisation_id, command_id, command_kind, subject_kind,
    command_fingerprint, actor_user_id, outcome, proposal_id, recorded_at)
  VALUES (v_org, p_command_id, 'SUBMIT_PROPOSAL', 'RISK_TREATMENT', v_fingerprint, v_actor, 'SUBMITTED', v_proposal, v_now);

  PERFORM 1 FROM gov_repo.l14_session_basis_v1(v_org, v_actor, p_verified_session_iat,
    p_verified_session_exp, p_verified_credential_epoch);
  RETURN QUERY SELECT * FROM gov_repo.l15_risk_treatment_command_result_v1(v_org, p_command_id, false);
END;
$submit$;
CREATE FUNCTION gov_repo.l15_decide_risk_treatment_proposal_v1(
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
  p_support_tags text[],
  p_support_target_ids text[],
  p_caller_fingerprint text
)
RETURNS TABLE (replay boolean, command_id text, command_kind text, subject_kind text, outcome text, command_fingerprint text,
 authorization_decision_id uuid, authorization_result text, deny_reason text, expectation_kind text, expected_current_state_id uuid,
 proposal_id uuid, governance_decision_id uuid, governed_risk_state_id uuid, treatment_option text, treatment_ordinal_key text,
 responsible_governance_party_id uuid, party_validated_state_id uuid, implementation_status text, target_implementation_date date,
 treatment_revocation_reason text, control_pins jsonb, state_id uuid, state_kind text, predecessor_state_id uuid,
 effective_from timestamptz, effective_to timestamptz, recorded_at timestamptz)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp SET lock_timeout = '5s'
AS $decide$
#variable_conflict use_column
DECLARE
  v_org uuid := p_verified_organisation_id;
  v_actor uuid := p_verified_actor_user_id;
  v_role_ids uuid[];
  v_support text[];
  v_fingerprint text;
  v_proposal record;
  v_risk record;
  v_head_found boolean;
  v_head_latest uuid;
  v_latest_kind text;
  v_latest_from timestamptz;
  v_latest_to timestamptz;
  v_target_state_id uuid;
  v_pin record;
  v_controls uuid[];
  v_has_basis boolean := false;
  v_basis_policy uuid;
  v_basis_version uuid;
  v_basis_hash text;
  v_deny text;
  v_ordinals integer[];
  v_self boolean;
  v_temporal text := 'IMMEDIATE';
  v_effective_from timestamptz;
  v_effective_to timestamptz;
  v_now timestamptz;
  v_authz uuid := pg_catalog.gen_random_uuid();
  v_decision uuid := pg_catalog.gen_random_uuid();
  v_state uuid := pg_catalog.gen_random_uuid();
  v_state_kind text;
BEGIN
  SELECT b.role_ids INTO v_role_ids
  FROM gov_repo.l14_session_basis_v1(v_org, v_actor, p_verified_session_iat, p_verified_session_exp,
    p_verified_credential_epoch) AS b;
  PERFORM gov_repo.l14_validate_command_id_v1(p_command_id, p_caller_fingerprint);
  IF p_outcome IS NULL OR p_outcome NOT IN ('VALIDATE','REJECT','DEFER','REVOKE')
     OR p_reason_code IS NULL OR p_reason_code NOT IN (
       'RISK_TREATMENT_VALIDATED','RISK_TREATMENT_REJECTED','RISK_TREATMENT_DEFERRED','RISK_TREATMENT_REVOKED')
     OR NOT ((p_outcome = 'VALIDATE' AND p_reason_code = 'RISK_TREATMENT_VALIDATED')
          OR (p_outcome = 'REJECT' AND p_reason_code = 'RISK_TREATMENT_REJECTED')
          OR (p_outcome = 'DEFER' AND p_reason_code = 'RISK_TREATMENT_DEFERRED')
          OR (p_outcome = 'REVOKE' AND p_reason_code = 'RISK_TREATMENT_REVOKED')) THEN
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'DECISION_VOCABULARY_INVALID';
  END IF;

 SELECT p.source_class,p.submitted_by_actor_user_id,t.* INTO v_proposal FROM gov_repo.l14_proposals p
 JOIN gov_repo.l15_risk_treatment_proposals t USING(organisation_id,proposal_id)
 WHERE p.organisation_id=v_org AND p.proposal_id=p_proposal_id AND p.subject_kind='RISK_TREATMENT';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'PROPOSAL_UNRESOLVED';
  END IF;
  IF (p_outcome = 'VALIDATE' AND v_proposal.intent <> 'VALIDATE') OR (p_outcome = 'REVOKE' AND v_proposal.intent <> 'REVOKE') THEN
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'OUTCOME_INTENT_INCOMPATIBLE';
  END IF;
  SELECT COALESCE(array_agg(control_definition_version_id ORDER BY control_definition_version_id),'{}'::uuid[]) INTO v_controls FROM gov_repo.l15_risk_treatment_proposal_control_pins WHERE organisation_id=v_org AND proposal_id=p_proposal_id;
  v_support := gov_repo.l15_governed_risk_support_parts_v1(p_support_status, p_support_tags, p_support_target_ids);
  v_fingerprint := gov_repo.l14_sha256_frame_v1(
    ARRAY['L15_COMMAND_FINGERPRINT_V1', 'DECIDE_PROPOSAL', v_org::text, v_actor::text, p_outcome, p_reason_code,
          v_proposal.proposal_id::text, 'RISK_TREATMENT', v_proposal.intent, v_proposal.source_class]
 || gov_repo.l15_risk_treatment_content_parts_v1(v_proposal.governed_risk_state_id, v_proposal.treatment_option, v_proposal.treatment_ordinal_key, v_proposal.responsible_governance_party_id, v_proposal.party_validated_state_id, v_proposal.implementation_status, v_proposal.target_implementation_date, v_proposal.treatment_revocation_reason, v_controls, v_proposal.requested_effective_from, v_proposal.requested_effective_to)
    || CASE WHEN v_proposal.target_state_id IS NULL THEN ARRAY['NO_TARGET_STATE']
            ELSE ARRAY['TARGET_STATE', v_proposal.target_state_id::text] END
    || CASE WHEN p_expected_current_state_id IS NULL THEN ARRAY['EXPECTED_NONE']
            ELSE ARRAY['EXPECTED_CURRENT', p_expected_current_state_id::text] END
    || v_support);
  IF v_fingerprint IS DISTINCT FROM p_caller_fingerprint THEN
    RAISE EXCEPTION 'L14_FINGERPRINT_MISMATCH' USING ERRCODE = 'GV008', DETAIL = 'CALLER_FINGERPRINT_DIFFERS';
  END IF;
  PERFORM gov_repo.l14_lock_authority_policy_guard_shared_v1(v_org);
  IF p_outcome = 'VALIDATE' THEN
    PERFORM gov_repo.l15_lock_scenario_dependency_guard_shared_v1(v_org, v_proposal.governed_risk_scenario_definition_id,
      v_proposal.governed_risk_scenario_definition_version_id, v_proposal.governed_risk_scenario_content_hash);
    PERFORM gov_repo.l15_risk_treatment_lock_risk_dependency_v1(v_org, v_proposal.governed_risk_subject_key,
      v_proposal.governed_risk_scenario_definition_id);

    PERFORM gov_repo.l14_lock_party_dependency_guard_shared_v1(v_org,v_proposal.responsible_governance_party_id);
    FOR v_pin IN SELECT * FROM gov_repo.l15_risk_treatment_proposal_control_pins WHERE organisation_id=v_org AND proposal_id=p_proposal_id ORDER BY control_definition_id,control_definition_version_id LOOP
    PERFORM gov_repo.l14_lock_control_definition_dependency_guard_shared_v1(v_org,v_pin.control_definition_id,v_pin.control_definition_version_id,v_pin.content_hash); END LOOP;
  END IF;
  PERFORM gov_repo.l15_lock_risk_treatment_key_guard_v1(v_org, v_proposal.governed_risk_state_id, v_proposal.treatment_option, v_proposal.treatment_ordinal_key);
  PERFORM gov_repo.l14_lock_command_guard_v1(v_org, p_command_id);
  IF gov_repo.l14_replay_arbitrate_v1(v_org, p_command_id, v_fingerprint) THEN
    PERFORM 1 FROM gov_repo.l14_session_basis_v1(v_org, v_actor, p_verified_session_iat,
      p_verified_session_exp, p_verified_credential_epoch);
    RETURN QUERY SELECT * FROM gov_repo.l15_risk_treatment_command_result_v1(v_org, p_command_id, true);
    RETURN;
  END IF;
  PERFORM 1 FROM gov_repo.l14_governance_decisions AS d
  WHERE d.organisation_id = v_org AND d.proposal_id = p_proposal_id AND d.outcome IN ('VALIDATE','REJECT','REVOKE');
  IF FOUND THEN
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'PROPOSAL_TERMINAL';
  END IF;
  SELECT s.subject_type, s.subject_canonical_kind, s.subject_canonical_object_id, s.subject_relationship_type,
         s.subject_relationship_id, s.subject_relationship_state_id INTO v_risk
  FROM gov_repo.l15_governed_risk_states AS s
  WHERE s.organisation_id = v_org AND s.state_id = v_proposal.governed_risk_state_id AND s.state_kind = 'VALIDATED';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'GOVERNED_RISK_STATE_UNRESOLVED';
  END IF;
  SELECT h.latest_state_id INTO v_head_latest FROM gov_repo.l15_risk_treatment_heads AS h
  WHERE h.organisation_id = v_org AND h.governed_risk_state_id = v_proposal.governed_risk_state_id
    AND h.treatment_option = v_proposal.treatment_option AND h.treatment_ordinal_key = v_proposal.treatment_ordinal_key;
  v_head_found := FOUND;
  IF p_expected_current_state_id IS NULL AND v_head_latest IS NOT NULL THEN
    RAISE EXCEPTION 'L15_STALE_EXPECTATION' USING ERRCODE = 'GV009', DETAIL = 'RISK_TREATMENT_STATE_EXISTS';
  END IF;
  IF p_expected_current_state_id IS DISTINCT FROM v_head_latest
     OR p_expected_current_state_id IS DISTINCT FROM v_proposal.expected_current_state_id THEN
    RAISE EXCEPTION 'L15_STALE_EXPECTATION' USING ERRCODE = 'GV009', DETAIL = 'RISK_TREATMENT_STATE_EXPECTATION_MISMATCH';
  END IF;
  IF v_head_latest IS NOT NULL THEN

    SELECT s.state_kind,s.effective_from,s.effective_to INTO v_latest_kind,v_latest_from,v_latest_to FROM gov_repo.l15_risk_treatment_states s WHERE s.organisation_id=v_org AND s.state_id=v_head_latest;
  END IF;
  IF p_outcome = 'REVOKE' THEN
    PERFORM 1 FROM gov_repo.l15_risk_treatment_states AS r
    WHERE r.organisation_id = v_org AND r.state_kind = 'REVOKED' AND r.revokes_state_id = v_proposal.target_state_id;
    IF FOUND THEN
      RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'TARGET_ALREADY_REVOKED';
    END IF;
    IF v_head_latest IS DISTINCT FROM v_proposal.target_state_id OR v_latest_kind IS DISTINCT FROM 'VALIDATED' THEN
      RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'TARGET_STATE_NOT_CURRENT';
    END IF;
    v_target_state_id := v_proposal.target_state_id;
  END IF;
  PERFORM 1 FROM gov_repo.l15_normalize_support_v1(v_org, p_support_tags, p_support_target_ids);
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
    IF p_outcome = 'VALIDATE' THEN
      v_effective_to := v_proposal.requested_effective_to;
    END IF;
  END IF;
  v_self := v_proposal.submitted_by_actor_user_id = v_actor;
  SELECT b.authority_policy_id, b.version_id, b.content_hash INTO v_basis_policy, v_basis_version, v_basis_hash
  FROM gov_repo.l14_effective_authority_basis_v1(v_org, v_now) AS b;
  v_has_basis := FOUND;
  IF NOT v_has_basis THEN
    v_deny := 'NO_EFFECTIVE_AUTHORITY';
  ELSIF v_risk.subject_type = 'CANONICAL_OBJECT' THEN
    SELECT e.deny_reason, e.rule_ordinals INTO v_deny, v_ordinals
    FROM gov_repo.l14_evaluate_target_authority_rules_v1(v_org, v_basis_policy, v_basis_version, v_role_ids,
      gov_repo.l15_governance_permission_v1('RISK_TREATMENT', p_outcome), p_outcome, p_outcome = 'VALIDATE' AND v_self, v_temporal,
      v_risk.subject_canonical_kind, v_risk.subject_canonical_object_id) AS e;
  ELSE
    SELECT e.deny_reason, e.rule_ordinals INTO v_deny, v_ordinals
    FROM gov_repo.l14_evaluate_relationship_state_authority_rules_v1(v_org, v_basis_policy, v_basis_version, v_role_ids,
      gov_repo.l15_governance_permission_v1('RISK_TREATMENT', p_outcome), p_outcome, p_outcome = 'VALIDATE' AND v_self, v_temporal,
      v_risk.subject_relationship_type, v_risk.subject_relationship_id, v_risk.subject_relationship_state_id) AS e;
  END IF;

  INSERT INTO gov_repo.l14_authorization_decisions (
    organisation_id, authorization_decision_id, command_id, command_fingerprint, actor_user_id,
    requested_action, subject_kind, scope_tag, target_canonical_kind, target_canonical_object_id,
    target_relationship_type, target_relationship_id, target_relationship_state_id, source_class,
    proposal_id, is_self_validation, authority_basis, basis_authority_policy_id, basis_version_id, basis_content_hash,
    result, deny_reason, evaluated_at, expectation_kind, expected_current_state_id)
  VALUES (
    v_org, v_authz, p_command_id, v_fingerprint, v_actor,
    p_outcome, 'RISK_TREATMENT', v_risk.subject_type, v_risk.subject_canonical_kind,
    v_risk.subject_canonical_object_id, v_risk.subject_relationship_type, v_risk.subject_relationship_id,
    v_risk.subject_relationship_state_id, v_proposal.source_class, p_proposal_id, v_self,
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
    VALUES (v_org, p_command_id, 'DECIDE_PROPOSAL', 'RISK_TREATMENT', v_fingerprint, v_actor, 'DENIED', v_authz, p_proposal_id, v_now);
  ELSE
    IF p_outcome = 'VALIDATE' AND v_effective_to IS NOT NULL AND NOT (v_effective_to > v_effective_from) THEN
      RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'EFFECTIVE_INTERVAL_INVALID';
    END IF;
    IF p_outcome = 'REVOKE' AND v_effective_from < v_latest_from THEN
      RAISE EXCEPTION 'L15_CONTINUITY_VIOLATION' USING ERRCODE = 'GV011', DETAIL = 'REVOKE_BEFORE_TARGET_EFFECTIVE';
    END IF;
    IF p_outcome = 'REVOKE' AND v_effective_from >= v_latest_to THEN
      RAISE EXCEPTION 'L15_CONTINUITY_VIOLATION' USING ERRCODE = 'GV011', DETAIL = 'REVOKE_AFTER_TARGET_EXPIRY';
    END IF;
    IF p_outcome = 'VALIDATE' AND v_latest_kind = 'REVOKED' AND NOT (v_effective_from >= v_latest_from) THEN
      RAISE EXCEPTION 'L15_CONTINUITY_VIOLATION' USING ERRCODE = 'GV011', DETAIL = 'REVALIDATION_OVERLAPS_PRIOR_INTERVAL';
    END IF;
    IF p_outcome = 'VALIDATE' AND v_latest_kind = 'VALIDATED' AND v_effective_from < v_latest_from THEN
      RAISE EXCEPTION 'L15_CONTINUITY_VIOLATION' USING ERRCODE = 'GV011', DETAIL = 'SUCCESSOR_BEFORE_PREDECESSOR_EFFECTIVE';
    END IF;
    IF p_outcome = 'VALIDATE' THEN
      IF NOT gov_repo.l15_governed_risk_state_current_v1(v_org, v_proposal.governed_risk_state_id, v_effective_from, v_now) THEN
        RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'GOVERNED_RISK_DEPENDENCY_NOT_VALID';
      END IF;

      IF NOT gov_repo.l15_risk_treatment_party_valid_v1(v_org,v_proposal.responsible_governance_party_id,v_proposal.party_validated_state_id,v_effective_from,v_now) THEN RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE='GV010', DETAIL='PARTY_DEPENDENCY_NOT_VALID'; END IF;
      FOR v_pin IN SELECT * FROM gov_repo.l15_risk_treatment_proposal_control_pins WHERE organisation_id=v_org AND proposal_id=p_proposal_id LOOP
      IF NOT EXISTS(SELECT 1 FROM gov_repo.l14_control_definition_valid_state_v1(v_org,v_pin.control_definition_id,v_pin.control_definition_version_id,v_pin.content_hash,v_effective_from,v_now) v WHERE v.state_id=v_pin.control_validated_state_id) THEN RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE='GV010', DETAIL='CONTROL_DEPENDENCY_NOT_VALID'; END IF; END LOOP;
      IF v_proposal.implementation_status='IMPLEMENTED' AND NOT EXISTS(SELECT 1 FROM unnest(p_support_tags) tag WHERE tag NOT IN ('RISK_HYPOTHESIS','RISK_SIGNAL')) THEN RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE='GV010', DETAIL='IMPLEMENTATION_EVIDENCE_REQUIRED'; END IF;
    END IF;

    INSERT INTO gov_repo.l14_governance_decisions (organisation_id, governance_decision_id, proposal_id,
      subject_kind, outcome, reason_code, authorization_decision_id, actor_user_id, support_status, decided_at)
    VALUES (v_org, v_decision, p_proposal_id, 'RISK_TREATMENT', p_outcome, p_reason_code, v_authz, v_actor, p_support_status, v_now);
    PERFORM gov_repo.l15_write_risk_treatment_support_links_v1(v_org, 'DECISION', NULL, v_decision, NULL,
      p_support_tags, p_support_target_ids);
    IF p_outcome IN ('VALIDATE','REVOKE') THEN
      v_state_kind := CASE WHEN p_outcome = 'VALIDATE' THEN 'VALIDATED' ELSE 'REVOKED' END;

      INSERT INTO gov_repo.l15_risk_treatment_states(organisation_id,state_id,state_kind,governed_risk_state_id,treatment_option,treatment_ordinal_key,
       governed_risk_subject_key,governed_risk_scenario_definition_id,governed_risk_scenario_definition_version_id,governed_risk_scenario_content_hash,governed_risk_scenario_validated_state_id,
       responsible_governance_party_id,party_validated_state_id,implementation_status,target_implementation_date,treatment_revocation_reason,predecessor_state_id,revokes_state_id,effective_from,effective_to,recorded_at,proposal_id,governance_decision_id,authorization_decision_id,authority_policy_id,authority_policy_version_id,authority_policy_content_hash,source_class,support_status)
      SELECT v_org,v_state,v_state_kind,t.governed_risk_state_id,t.treatment_option,t.treatment_ordinal_key,
       t.governed_risk_subject_key,t.governed_risk_scenario_definition_id,t.governed_risk_scenario_definition_version_id,t.governed_risk_scenario_content_hash,t.governed_risk_scenario_validated_state_id,
       t.responsible_governance_party_id,t.party_validated_state_id,t.implementation_status,t.target_implementation_date,t.treatment_revocation_reason,v_head_latest,v_target_state_id,v_effective_from,v_effective_to,v_now,p_proposal_id,v_decision,v_authz,v_basis_policy,v_basis_version,v_basis_hash,v_proposal.source_class,p_support_status
      FROM gov_repo.l15_risk_treatment_proposals t WHERE t.organisation_id=v_org AND t.proposal_id=p_proposal_id;
      INSERT INTO gov_repo.l15_risk_treatment_state_control_pins(organisation_id,state_id,control_definition_id,control_definition_version_id,content_hash,control_validated_state_id)
      SELECT organisation_id,v_state,control_definition_id,control_definition_version_id,content_hash,control_validated_state_id FROM gov_repo.l15_risk_treatment_proposal_control_pins WHERE organisation_id=v_org AND proposal_id=p_proposal_id;
      IF NOT v_head_found THEN
        INSERT INTO gov_repo.l15_risk_treatment_heads (organisation_id, governed_risk_state_id, treatment_option, treatment_ordinal_key, latest_state_id)
        VALUES (v_org, v_proposal.governed_risk_state_id, v_proposal.treatment_option, v_proposal.treatment_ordinal_key, NULL);
      END IF;
      UPDATE gov_repo.l15_risk_treatment_heads AS h SET latest_state_id = v_state
      WHERE h.organisation_id = v_org AND h.governed_risk_state_id = v_proposal.governed_risk_state_id
        AND h.treatment_option = v_proposal.treatment_option AND h.treatment_ordinal_key = v_proposal.treatment_ordinal_key
        AND h.latest_state_id IS NOT DISTINCT FROM p_expected_current_state_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'L15_STALE_EXPECTATION' USING ERRCODE = 'GV009', DETAIL = 'RISK_TREATMENT_STATE_EXPECTATION_MISMATCH';
      END IF;
      PERFORM gov_repo.l15_write_risk_treatment_support_links_v1(v_org, 'STATE', NULL, NULL, v_state,
        p_support_tags, p_support_target_ids);
      INSERT INTO gov_repo.l14_command_results (organisation_id, command_id, command_kind, subject_kind,
        command_fingerprint, actor_user_id, outcome, authorization_decision_id, proposal_id, governance_decision_id,
        l15_state_id, recorded_at)
      VALUES (v_org, p_command_id, 'DECIDE_PROPOSAL', 'RISK_TREATMENT', v_fingerprint, v_actor, v_state_kind,
        v_authz, p_proposal_id, v_decision, v_state, v_now);
    ELSE
      INSERT INTO gov_repo.l14_command_results (organisation_id, command_id, command_kind, subject_kind,
        command_fingerprint, actor_user_id, outcome, authorization_decision_id, proposal_id, governance_decision_id, recorded_at)
      VALUES (v_org, p_command_id, 'DECIDE_PROPOSAL', 'RISK_TREATMENT', v_fingerprint, v_actor,
        CASE WHEN p_outcome = 'REJECT' THEN 'REJECTED' ELSE 'DEFERRED' END, v_authz, p_proposal_id, v_decision, v_now);
    END IF;
  END IF;
  PERFORM 1 FROM gov_repo.l14_session_basis_v1(v_org, v_actor, p_verified_session_iat,
    p_verified_session_exp, p_verified_credential_epoch);
  RETURN QUERY SELECT * FROM gov_repo.l15_risk_treatment_command_result_v1(v_org, p_command_id, false);
END;
$decide$;
CREATE FUNCTION gov_repo.l15_risk_treatment_proposal_guard_v1() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $guard$
DECLARE
  v_envelope_source text;
BEGIN
  SELECT p.source_class INTO v_envelope_source
  FROM gov_repo.l14_proposals AS p
  WHERE p.organisation_id = NEW.organisation_id AND p.proposal_id = NEW.proposal_id AND p.subject_kind = 'RISK_TREATMENT';
  IF v_envelope_source IS DISTINCT FROM 'LOCAL_HUMAN' THEN
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'RISK_TREATMENT_PROPOSAL_SOURCE_INVALID';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM gov_repo.l14_governance_party_states p
    WHERE p.organisation_id=NEW.organisation_id AND p.state_id=NEW.party_validated_state_id
      AND p.governance_party_id=NEW.responsible_governance_party_id AND p.state_kind='VALIDATED') THEN
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE='GV010',DETAIL='PARTY_PIN_UNRESOLVED';
  END IF;
  RETURN NEW;
END;
$guard$;
CREATE TRIGGER l15_risk_treatment_proposals_guard BEFORE INSERT ON gov_repo.l15_risk_treatment_proposals FOR EACH ROW EXECUTE FUNCTION gov_repo.l15_risk_treatment_proposal_guard_v1();
CREATE FUNCTION gov_repo.l15_risk_treatment_state_guard_v1() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $guard$
DECLARE
  v_decision record;
  v_proposal record;
  v_authz record;
  v_risk record;
  v_predecessor record;

BEGIN
  -- Frozen §15.1 / O47: implementation is a successor of approved, planned treatment.
  IF NEW.implementation_status = 'IMPLEMENTED' AND NOT EXISTS (
    SELECT 1 FROM gov_repo.l15_risk_treatment_states s
    WHERE s.organisation_id = NEW.organisation_id AND s.state_id = NEW.predecessor_state_id
      AND s.governed_risk_state_id = NEW.governed_risk_state_id
      AND s.treatment_option = NEW.treatment_option AND s.treatment_ordinal_key = NEW.treatment_ordinal_key
      AND s.state_kind = 'VALIDATED' AND s.implementation_status = 'PLANNED'
  ) THEN
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE='GV010', DETAIL='IMPLEMENTATION_PREDECESSOR_NOT_PLANNED';
  END IF;
  SELECT d.proposal_id, d.decided_at, d.support_status, d.actor_user_id INTO v_decision
  FROM gov_repo.l14_governance_decisions AS d
  WHERE d.organisation_id = NEW.organisation_id AND d.governance_decision_id = NEW.governance_decision_id
    AND d.subject_kind = 'RISK_TREATMENT';
  SELECT p.source_class, t.* INTO v_proposal
  FROM gov_repo.l14_proposals AS p
  JOIN gov_repo.l15_risk_treatment_proposals AS t ON t.organisation_id = p.organisation_id AND t.proposal_id = p.proposal_id
  WHERE p.organisation_id = NEW.organisation_id AND p.proposal_id = NEW.proposal_id;
  IF v_decision.proposal_id IS DISTINCT FROM NEW.proposal_id OR v_decision.decided_at IS DISTINCT FROM NEW.recorded_at
     OR v_decision.support_status IS DISTINCT FROM NEW.support_status
     OR v_proposal.source_class IS DISTINCT FROM NEW.source_class
     OR v_proposal.governed_risk_state_id IS DISTINCT FROM NEW.governed_risk_state_id
     OR v_proposal.treatment_option IS DISTINCT FROM NEW.treatment_option
     OR v_proposal.treatment_ordinal_key IS DISTINCT FROM NEW.treatment_ordinal_key
     OR v_proposal.responsible_governance_party_id IS DISTINCT FROM NEW.responsible_governance_party_id
     OR v_proposal.party_validated_state_id IS DISTINCT FROM NEW.party_validated_state_id
     OR v_proposal.implementation_status IS DISTINCT FROM NEW.implementation_status
     OR v_proposal.target_implementation_date IS DISTINCT FROM NEW.target_implementation_date
     OR v_proposal.treatment_revocation_reason IS DISTINCT FROM NEW.treatment_revocation_reason
     OR v_proposal.target_state_id IS DISTINCT FROM NEW.revokes_state_id
     OR v_proposal.expected_current_state_id IS DISTINCT FROM NEW.predecessor_state_id
     OR NEW.effective_from IS DISTINCT FROM COALESCE(v_proposal.requested_effective_from, NEW.recorded_at)
     OR NEW.effective_to IS DISTINCT FROM (CASE WHEN NEW.state_kind = 'VALIDATED' THEN v_proposal.requested_effective_to END) THEN
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'RISK_TREATMENT_STATE_ENVELOPE_MISMATCH';
  END IF;
  SELECT s.subject_type, s.subject_canonical_kind, s.subject_canonical_object_id, s.subject_relationship_type,
         s.subject_relationship_id, s.subject_relationship_state_id INTO v_risk
  FROM gov_repo.l15_governed_risk_states AS s
  WHERE s.organisation_id = NEW.organisation_id AND s.state_id = NEW.governed_risk_state_id;
  SELECT a.scope_tag, a.target_canonical_kind, a.target_canonical_object_id, a.target_relationship_type,
         a.target_relationship_id, a.target_relationship_state_id, a.source_class, a.evaluated_at, a.actor_user_id
  INTO v_authz
  FROM gov_repo.l14_authorization_decisions AS a
  WHERE a.organisation_id = NEW.organisation_id AND a.authorization_decision_id = NEW.authorization_decision_id;
  IF NOT FOUND OR v_risk.subject_type IS NULL OR v_authz.source_class IS DISTINCT FROM NEW.source_class
     OR v_authz.scope_tag IS DISTINCT FROM v_risk.subject_type
     OR v_authz.target_canonical_kind IS DISTINCT FROM v_risk.subject_canonical_kind
     OR v_authz.target_canonical_object_id IS DISTINCT FROM v_risk.subject_canonical_object_id
     OR v_authz.target_relationship_type IS DISTINCT FROM v_risk.subject_relationship_type
     OR v_authz.target_relationship_id IS DISTINCT FROM v_risk.subject_relationship_id
     OR v_authz.target_relationship_state_id IS DISTINCT FROM v_risk.subject_relationship_state_id
     OR v_authz.evaluated_at IS DISTINCT FROM NEW.recorded_at OR v_authz.actor_user_id IS DISTINCT FROM v_decision.actor_user_id THEN
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'RISK_TREATMENT_STATE_AUTHORIZATION_TARGET_MISMATCH';
  END IF;
  IF NEW.predecessor_state_id IS NOT NULL THEN
    SELECT s.state_kind, s.effective_from, s.effective_to INTO v_predecessor
    FROM gov_repo.l15_risk_treatment_states AS s
    WHERE s.organisation_id = NEW.organisation_id AND s.state_id = NEW.predecessor_state_id;
    IF NEW.state_kind = 'REVOKED' THEN
      IF NEW.effective_from < v_predecessor.effective_from THEN
        RAISE EXCEPTION 'L15_CONTINUITY_VIOLATION' USING ERRCODE = 'GV011', DETAIL = 'REVOKE_BEFORE_TARGET_EFFECTIVE';
      END IF;
      IF v_predecessor.effective_to IS NOT NULL AND NEW.effective_from >= v_predecessor.effective_to THEN
        RAISE EXCEPTION 'L15_CONTINUITY_VIOLATION' USING ERRCODE = 'GV011', DETAIL = 'REVOKE_AFTER_TARGET_EXPIRY';
      END IF;
    ELSIF v_predecessor.state_kind = 'REVOKED' THEN
      IF NOT (NEW.effective_from >= v_predecessor.effective_from) THEN
        RAISE EXCEPTION 'L15_CONTINUITY_VIOLATION' USING ERRCODE = 'GV011', DETAIL = 'REVALIDATION_OVERLAPS_PRIOR_INTERVAL';
      END IF;
    ELSIF NEW.effective_from < v_predecessor.effective_from THEN
      RAISE EXCEPTION 'L15_CONTINUITY_VIOLATION' USING ERRCODE = 'GV011', DETAIL = 'SUCCESSOR_BEFORE_PREDECESSOR_EFFECTIVE';
    END IF;
  END IF;
  IF NEW.state_kind = 'VALIDATED' THEN
    IF NOT gov_repo.l15_governed_risk_state_current_v1(NEW.organisation_id, NEW.governed_risk_state_id, NEW.effective_from,
         NEW.recorded_at) THEN
      RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'GOVERNED_RISK_DEPENDENCY_NOT_VALID';
    END IF;

    IF NOT gov_repo.l15_risk_treatment_party_valid_v1(NEW.organisation_id,NEW.responsible_governance_party_id,NEW.party_validated_state_id,NEW.effective_from,NEW.recorded_at) THEN RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE='GV010', DETAIL='PARTY_DEPENDENCY_NOT_VALID'; END IF;
  ELSE
    IF NOT EXISTS(SELECT 1 FROM gov_repo.l15_risk_treatment_states s WHERE s.organisation_id=NEW.organisation_id AND s.state_id=NEW.revokes_state_id AND s.state_kind='VALIDATED' AND s.responsible_governance_party_id=NEW.responsible_governance_party_id AND s.party_validated_state_id=NEW.party_validated_state_id) THEN RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE='GV010', DETAIL='REVOCATION_PIN_MISMATCH'; END IF;
  END IF;
  RETURN NEW;
END;
$guard$;
CREATE TRIGGER l15_risk_treatment_states_guard BEFORE INSERT ON gov_repo.l15_risk_treatment_states FOR EACH ROW EXECUTE FUNCTION gov_repo.l15_risk_treatment_state_guard_v1();
CREATE FUNCTION gov_repo.l15_risk_treatment_head_guard_v1() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $head$
BEGIN
  IF TG_OP IN ('DELETE','TRUNCATE') THEN
    RAISE EXCEPTION 'L15_HISTORY_IMMUTABLE' USING ERRCODE = '55000', DETAIL = 'l15_risk_treatment_heads:' || TG_OP;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.latest_state_id IS NOT NULL THEN
      RAISE EXCEPTION 'L15_HISTORY_IMMUTABLE' USING ERRCODE = '55000', DETAIL = 'l15_risk_treatment_heads:INSERT_WITH_STATE';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.organisation_id IS DISTINCT FROM OLD.organisation_id OR NEW.governed_risk_state_id IS DISTINCT FROM OLD.governed_risk_state_id
     OR NEW.treatment_option IS DISTINCT FROM OLD.treatment_option OR NEW.treatment_ordinal_key IS DISTINCT FROM OLD.treatment_ordinal_key
     OR (OLD.latest_state_id IS NOT NULL AND NEW.latest_state_id IS NULL) THEN
    RAISE EXCEPTION 'L15_HISTORY_IMMUTABLE' USING ERRCODE = '55000', DETAIL = 'l15_risk_treatment_heads:IDENTITY';
  END IF;
  IF NEW.latest_state_id IS DISTINCT FROM OLD.latest_state_id AND NOT EXISTS (
       SELECT 1 FROM gov_repo.l15_risk_treatment_states AS s
       WHERE s.organisation_id = NEW.organisation_id AND s.state_id = NEW.latest_state_id
         AND s.governed_risk_state_id = OLD.governed_risk_state_id AND s.treatment_option = OLD.treatment_option AND s.treatment_ordinal_key = OLD.treatment_ordinal_key
         AND s.predecessor_state_id IS NOT DISTINCT FROM OLD.latest_state_id) THEN
    RAISE EXCEPTION 'L15_HISTORY_IMMUTABLE' USING ERRCODE = '55000', DETAIL = 'l15_risk_treatment_heads:LINEAGE';
  END IF;
  RETURN NEW;
END;
$head$;
CREATE TRIGGER l15_risk_treatment_heads_guard BEFORE INSERT OR UPDATE OR DELETE ON gov_repo.l15_risk_treatment_heads FOR EACH ROW EXECUTE FUNCTION gov_repo.l15_risk_treatment_head_guard_v1();
CREATE TRIGGER l15_risk_treatment_heads_no_truncate BEFORE TRUNCATE ON gov_repo.l15_risk_treatment_heads FOR EACH STATEMENT EXECUTE FUNCTION gov_repo.l15_risk_treatment_head_guard_v1();
CREATE FUNCTION gov_repo.l15_risk_treatment_support_set_v1(p_org uuid,p_artifact text,p_id uuid) RETURNS TABLE(target_tag text,target_id text)
 LANGUAGE sql STABLE SET search_path=pg_catalog,pg_temp AS $$ SELECT l.target_tag,COALESCE(target_discovery_evidence_id,target_source_assertion_id,target_runtime_observation_id::text,target_cross_signal_comparison_id,target_execution_field_state_id,target_technical_field_state_id,target_lineage_observation_finding_id,target_l14_fact_state_id::text,target_risk_signal_id::text,target_risk_hypothesis_id::text)
 FROM gov_repo.l15_support_links l WHERE organisation_id=p_org AND owner_kind='RISK_TREATMENT' AND owner_risk_treatment_artifact=p_artifact AND COALESCE(owner_risk_treatment_proposal_id,owner_governance_decision_id,owner_risk_treatment_state_id)=p_id $$;
CREATE FUNCTION gov_repo.l15_risk_treatment_commit_guard_v1() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $fn$
DECLARE
  v_a bigint;
  v_b bigint;
  v_status text; v_pin record;
BEGIN
  IF TG_TABLE_NAME = 'l15_risk_treatment_proposals' THEN
    SELECT p.support_status INTO v_status FROM gov_repo.l14_proposals AS p
    WHERE p.organisation_id = NEW.organisation_id AND p.proposal_id = NEW.proposal_id;
    SELECT pg_catalog.count(*) INTO v_a FROM gov_repo.l15_support_links AS l
    WHERE l.organisation_id = NEW.organisation_id AND l.owner_kind = 'RISK_TREATMENT'
      AND l.owner_risk_treatment_artifact = 'PROPOSAL' AND l.owner_risk_treatment_proposal_id = NEW.proposal_id;
    IF v_status IS NULL OR (v_status = 'PRESENT') <> (v_a > 0) THEN
      RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'RISK_TREATMENT_PROPOSAL_SUPPORT_INCOMPLETE';
    END IF;

    IF (SELECT count(*) FROM gov_repo.l15_risk_treatment_proposal_control_pins WHERE organisation_id=NEW.organisation_id AND proposal_id=NEW.proposal_id)<>NEW.control_pin_count THEN RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE='GV010', DETAIL='CONTROL_PINS_INCOMPLETE'; END IF;
  ELSIF TG_TABLE_NAME = 'l15_risk_treatment_states' THEN
    SELECT pg_catalog.count(*) INTO v_a FROM gov_repo.l15_support_links AS l
    WHERE l.organisation_id = NEW.organisation_id AND l.owner_kind = 'RISK_TREATMENT'
      AND l.owner_risk_treatment_artifact = 'STATE' AND l.owner_risk_treatment_state_id = NEW.state_id;
    SELECT pg_catalog.count(*) INTO v_b FROM gov_repo.l15_support_links AS l
    WHERE l.organisation_id = NEW.organisation_id AND l.owner_kind = 'RISK_TREATMENT'
      AND l.owner_risk_treatment_artifact = 'DECISION' AND l.owner_governance_decision_id = NEW.governance_decision_id;
    IF (NEW.support_status = 'PRESENT') <> (v_a > 0) OR v_a <> v_b THEN
      RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'RISK_TREATMENT_STATE_SUPPORT_INCOMPLETE';
    END IF;

    IF EXISTS((SELECT target_tag,target_id FROM gov_repo.l15_risk_treatment_support_set_v1(NEW.organisation_id,'STATE',NEW.state_id) EXCEPT SELECT target_tag,target_id FROM gov_repo.l15_risk_treatment_support_set_v1(NEW.organisation_id,'DECISION',NEW.governance_decision_id))) THEN RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE='GV010', DETAIL='TREATMENT_SUPPORT_MISMATCH'; END IF;
    IF EXISTS((SELECT control_definition_id,control_definition_version_id,content_hash,control_validated_state_id FROM gov_repo.l15_risk_treatment_state_control_pins WHERE organisation_id=NEW.organisation_id AND state_id=NEW.state_id
    EXCEPT SELECT control_definition_id,control_definition_version_id,content_hash,control_validated_state_id FROM gov_repo.l15_risk_treatment_proposal_control_pins WHERE organisation_id=NEW.organisation_id AND proposal_id=NEW.proposal_id))
    OR (SELECT count(*) FROM gov_repo.l15_risk_treatment_state_control_pins WHERE organisation_id=NEW.organisation_id AND state_id=NEW.state_id)<>(SELECT control_pin_count FROM gov_repo.l15_risk_treatment_proposals WHERE organisation_id=NEW.organisation_id AND proposal_id=NEW.proposal_id) THEN RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE='GV010', DETAIL='CONTROL_PINS_INCOMPLETE'; END IF;
    IF NEW.state_kind='REVOKED' AND (
      EXISTS (SELECT control_definition_id,control_definition_version_id,content_hash,control_validated_state_id
        FROM gov_repo.l15_risk_treatment_state_control_pins WHERE organisation_id=NEW.organisation_id AND state_id=NEW.state_id
        EXCEPT SELECT control_definition_id,control_definition_version_id,content_hash,control_validated_state_id
        FROM gov_repo.l15_risk_treatment_state_control_pins WHERE organisation_id=NEW.organisation_id AND state_id=NEW.revokes_state_id)
      OR (SELECT count(*) FROM gov_repo.l15_risk_treatment_state_control_pins WHERE organisation_id=NEW.organisation_id AND state_id=NEW.state_id)
        <> (SELECT count(*) FROM gov_repo.l15_risk_treatment_state_control_pins WHERE organisation_id=NEW.organisation_id AND state_id=NEW.revokes_state_id)) THEN
      RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE='GV010',DETAIL='REVOCATION_PIN_MISMATCH';
    END IF;
    IF NEW.state_kind='VALIDATED' THEN
    IF NEW.implementation_status='IMPLEMENTED' AND NOT EXISTS(SELECT 1 FROM gov_repo.l15_support_links WHERE organisation_id=NEW.organisation_id AND owner_kind='RISK_TREATMENT' AND owner_risk_treatment_state_id=NEW.state_id AND target_tag NOT IN ('RISK_HYPOTHESIS','RISK_SIGNAL')) THEN RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE='GV010', DETAIL='IMPLEMENTATION_EVIDENCE_REQUIRED'; END IF;
    FOR v_pin IN SELECT * FROM gov_repo.l15_risk_treatment_state_control_pins WHERE organisation_id=NEW.organisation_id AND state_id=NEW.state_id LOOP
    IF NEW.treatment_option<>'MITIGATE' OR NOT EXISTS(SELECT 1 FROM gov_repo.l14_control_definition_valid_state_v1(NEW.organisation_id,v_pin.control_definition_id,v_pin.control_definition_version_id,v_pin.content_hash,NEW.effective_from,NEW.recorded_at) v WHERE v.state_id=v_pin.control_validated_state_id) THEN RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE='GV010', DETAIL='CONTROL_DEPENDENCY_NOT_VALID'; END IF; END LOOP;
    END IF;
  ELSE
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'UNEXPECTED_STORE';
  END IF;
  RETURN NULL;
END;
$fn$;
CREATE CONSTRAINT TRIGGER l15_risk_treatment_proposals_complete AFTER INSERT ON gov_repo.l15_risk_treatment_proposals DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION gov_repo.l15_risk_treatment_commit_guard_v1();
CREATE CONSTRAINT TRIGGER l15_risk_treatment_states_complete AFTER INSERT ON gov_repo.l15_risk_treatment_states DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION gov_repo.l15_risk_treatment_commit_guard_v1();
-- Pins can only be attached in their owner's creating transaction; no later historical enrichment.
CREATE FUNCTION gov_repo.l15_risk_treatment_pin_guard_v1() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF TG_TABLE_NAME='l15_risk_treatment_proposal_control_pins' THEN
 IF NOT EXISTS(SELECT 1 FROM gov_repo.l15_risk_treatment_proposals p WHERE p.organisation_id=NEW.organisation_id AND p.proposal_id=NEW.proposal_id AND p.treatment_option='MITIGATE' AND p.xmin=pg_current_xact_id()::xid) THEN RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE='GV010', DETAIL='PIN_OWNER_NOT_IN_TRANSACTION'; END IF;
 ELSE
 IF NOT EXISTS(SELECT 1 FROM gov_repo.l15_risk_treatment_states s WHERE s.organisation_id=NEW.organisation_id AND s.state_id=NEW.state_id AND s.treatment_option='MITIGATE' AND s.xmin=pg_current_xact_id()::xid) THEN RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE='GV010', DETAIL='PIN_OWNER_NOT_IN_TRANSACTION'; END IF;
 END IF; RETURN NEW;
END $$;
CREATE TRIGGER l15_risk_treatment_proposal_pins_guard BEFORE INSERT ON gov_repo.l15_risk_treatment_proposal_control_pins FOR EACH ROW EXECUTE FUNCTION gov_repo.l15_risk_treatment_pin_guard_v1();
CREATE TRIGGER l15_risk_treatment_state_pins_guard BEFORE INSERT ON gov_repo.l15_risk_treatment_state_control_pins FOR EACH ROW EXECUTE FUNCTION gov_repo.l15_risk_treatment_pin_guard_v1();

-- All dependency checks use the SAME business instant and recorded cutoff. No resolver selects a replacement pin.
CREATE FUNCTION gov_repo.l15_risk_treatment_dependency_failure_v1(p_org uuid,p_state uuid,p_at timestamptz,p_cutoff timestamptz)
RETURNS TABLE(dependency_kind text,dependency_id uuid) LANGUAGE sql STABLE SET search_path=pg_catalog,pg_temp AS $$
 SELECT f.kind,f.id FROM gov_repo.l15_risk_treatment_states s CROSS JOIN LATERAL (
 SELECT 1 priority,'GOVERNED_RISK'::text kind,s.governed_risk_state_id id WHERE NOT gov_repo.l15_governed_risk_state_current_v1(p_org,s.governed_risk_state_id,p_at,p_cutoff)
 UNION ALL SELECT 2,'GOVERNANCE_PARTY',s.party_validated_state_id WHERE NOT gov_repo.l15_risk_treatment_party_valid_v1(p_org,s.responsible_governance_party_id,s.party_validated_state_id,p_at,p_cutoff)
 UNION ALL SELECT 3,'CONTROL_DEFINITION',p.control_validated_state_id FROM gov_repo.l15_risk_treatment_state_control_pins p
 WHERE p.organisation_id=p_org AND p.state_id=p_state AND NOT EXISTS(SELECT 1 FROM gov_repo.l14_control_definition_valid_state_v1(p_org,p.control_definition_id,p.control_definition_version_id,p.content_hash,p_at,p_cutoff) v WHERE v.state_id=p.control_validated_state_id)
 ) f WHERE s.organisation_id=p_org AND s.state_id=p_state ORDER BY f.priority,f.id LIMIT 1
$$;
CREATE FUNCTION gov_repo.l15_risk_treatment_resolution_v1(p_organisation_id uuid,p_governed_risk_state_id uuid,p_treatment_option text,p_treatment_ordinal_key text,p_effective_at timestamptz,p_recorded_cutoff timestamptz)
RETURNS TABLE(resolution text,state_id uuid,state_kind text,dependency_kind text,dependency_id uuid)
LANGUAGE sql STABLE SET search_path=pg_catalog,pg_temp AS $$
 WITH visible AS (SELECT s.* FROM gov_repo.l15_risk_treatment_states s WHERE s.organisation_id=p_organisation_id AND s.governed_risk_state_id=p_governed_risk_state_id AND s.treatment_option=p_treatment_option AND s.treatment_ordinal_key=p_treatment_ordinal_key AND s.recorded_at<=p_recorded_cutoff),
 latest AS (SELECT v.* FROM visible v WHERE (v.effective_from<=p_effective_at OR v.predecessor_state_id IS NULL) AND NOT EXISTS(SELECT 1 FROM visible n WHERE n.predecessor_state_id=v.state_id AND n.effective_from<=p_effective_at))
 SELECT CASE WHEN s.state_id IS NULL THEN 'NO_STATE' WHEN s.state_kind='REVOKED' THEN 'REVOKED'
 WHEN s.effective_from>p_effective_at THEN 'NOT_YET_EFFECTIVE' WHEN s.effective_to<=p_effective_at THEN 'EXPIRED'
 WHEN d.dependency_kind IS NOT NULL THEN d.dependency_kind||'_DEPENDENCY_INVALID' ELSE 'CURRENT' END,
 s.state_id,s.state_kind,
 CASE WHEN s.state_kind='VALIDATED' AND s.effective_from<=p_effective_at AND (s.effective_to IS NULL OR p_effective_at<s.effective_to) THEN d.dependency_kind END,
 CASE WHEN s.state_kind='VALIDATED' AND s.effective_from<=p_effective_at AND (s.effective_to IS NULL OR p_effective_at<s.effective_to) THEN d.dependency_id END
 FROM (SELECT 1) one LEFT JOIN LATERAL(SELECT * FROM latest ORDER BY effective_from DESC,recorded_at DESC LIMIT 1) s ON true
 LEFT JOIN LATERAL gov_repo.l15_risk_treatment_dependency_failure_v1(p_organisation_id,s.state_id,p_effective_at,p_recorded_cutoff) d ON true
$$;
CREATE FUNCTION gov_repo.l15_risk_treatment_valid_state_v1(p_organisation_id uuid,p_governed_risk_state_id uuid,p_treatment_option text,p_treatment_ordinal_key text,p_effective_at timestamptz,p_recorded_cutoff timestamptz)
RETURNS SETOF gov_repo.l15_risk_treatment_states LANGUAGE sql STABLE SET search_path=pg_catalog,pg_temp AS $$
 SELECT s.* FROM gov_repo.l15_risk_treatment_resolution_v1(p_organisation_id,p_governed_risk_state_id,p_treatment_option,p_treatment_ordinal_key,p_effective_at,p_recorded_cutoff) r
 JOIN gov_repo.l15_risk_treatment_states s ON s.organisation_id=p_organisation_id AND s.state_id=r.state_id WHERE r.resolution='CURRENT'
$$;
CREATE FUNCTION gov_repo.l15_risk_treatment_state_current_v1(p_organisation_id uuid,p_state_id uuid,p_effective_at timestamptz,p_recorded_cutoff timestamptz)
RETURNS boolean LANGUAGE sql STABLE SET search_path=pg_catalog,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM gov_repo.l15_risk_treatment_states s CROSS JOIN LATERAL gov_repo.l15_risk_treatment_valid_state_v1(p_organisation_id,s.governed_risk_state_id,s.treatment_option,s.treatment_ordinal_key,p_effective_at,p_recorded_cutoff) v
 WHERE s.organisation_id=p_organisation_id AND s.state_id=p_state_id AND v.state_id=p_state_id)
$$;
-- Three bounded SECURITY DEFINER RPCs are the only application surface; owner-only stores require this boundary.
CREATE FUNCTION gov_repo.l15_read_risk_treatment_v1(p_verified_organisation_id uuid,p_verified_actor_user_id uuid,p_verified_session_iat bigint,p_verified_session_exp bigint,p_verified_credential_epoch timestamptz,
 p_governed_risk_state_id uuid,p_treatment_option text,p_treatment_ordinal_key text,p_effective_at timestamptz,p_recorded_cutoff timestamptz)
RETURNS TABLE(treatment_status text,resolution text,dependency_kind text,dependency_id uuid,effective_at timestamptz,recorded_cutoff timestamptz,current_state jsonb)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET lock_timeout='5s' AS $read$
DECLARE v_now timestamptz:=clock_timestamp();v_at timestamptz:=COALESCE(p_effective_at,v_now);v_cutoff timestamptz:=COALESCE(p_recorded_cutoff,v_now);
BEGIN
 PERFORM 1 FROM gov_repo.l14_session_basis_v1(p_verified_organisation_id,p_verified_actor_user_id,p_verified_session_iat,p_verified_session_exp,p_verified_credential_epoch);
 IF p_governed_risk_state_id IS NULL OR p_treatment_option IS NULL OR p_treatment_option NOT IN ('MITIGATE','AVOID','TRANSFER') OR p_treatment_ordinal_key IS NULL OR length(p_treatment_ordinal_key) NOT BETWEEN 1 AND 500 OR p_treatment_ordinal_key<>btrim(p_treatment_ordinal_key) THEN RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE='GV010', DETAIL='TREATMENT_KEY_INVALID'; END IF;
 RETURN QUERY SELECT CASE WHEN r.resolution='CURRENT' THEN s.implementation_status ELSE 'UNKNOWN' END,r.resolution,r.dependency_kind,r.dependency_id,v_at,v_cutoff,
 CASE WHEN r.resolution='CURRENT' THEN to_jsonb(s)||jsonb_build_object('control_pins',COALESCE((SELECT jsonb_agg(jsonb_build_object('controlDefinitionId',x.control_definition_id,'controlDefinitionVersionId',x.control_definition_version_id,'contentHash',x.content_hash,'validatedStateId',x.control_validated_state_id) ORDER BY x.control_definition_version_id) FROM gov_repo.l15_risk_treatment_state_control_pins x WHERE x.organisation_id=p_verified_organisation_id AND x.state_id=s.state_id),'[]'::jsonb)) END
 FROM gov_repo.l15_risk_treatment_resolution_v1(p_verified_organisation_id,p_governed_risk_state_id,p_treatment_option,p_treatment_ordinal_key,v_at,v_cutoff) r
 LEFT JOIN gov_repo.l15_risk_treatment_states s ON s.organisation_id=p_verified_organisation_id AND s.state_id=r.state_id;
 PERFORM 1 FROM gov_repo.l14_session_basis_v1(p_verified_organisation_id,p_verified_actor_user_id,p_verified_session_iat,p_verified_session_exp,p_verified_credential_epoch);
END $read$;

CREATE UNIQUE INDEX l15_support_links_treatment_target_unique ON gov_repo.l15_support_links(organisation_id,owner_risk_treatment_artifact,
 (COALESCE(owner_risk_treatment_proposal_id,owner_governance_decision_id,owner_risk_treatment_state_id)),target_tag,
 (COALESCE(target_discovery_evidence_id,target_source_assertion_id,target_runtime_observation_id::text,target_cross_signal_comparison_id,target_execution_field_state_id,target_technical_field_state_id,target_lineage_observation_finding_id,target_l14_fact_state_id::text,target_risk_signal_id::text,target_risk_hypothesis_id::text))) WHERE owner_kind='RISK_TREATMENT';
CREATE INDEX l15_support_links_treatment_state_idx ON gov_repo.l15_support_links(organisation_id,owner_risk_treatment_state_id) WHERE owner_risk_treatment_state_id IS NOT NULL;

DO $security$ DECLARE t text;r record; BEGIN
 FOREACH t IN ARRAY ARRAY['l15_risk_treatment_proposals','l15_risk_treatment_states','l15_risk_treatment_proposal_control_pins','l15_risk_treatment_state_control_pins','l15_risk_treatment_heads'] LOOP
 IF t<>'l15_risk_treatment_heads' THEN
 EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON gov_repo.%I FOR EACH ROW EXECUTE FUNCTION gov_repo.l15_history_immutable_v1()',t||'_immutable',t);
 EXECUTE format('CREATE TRIGGER %I BEFORE TRUNCATE ON gov_repo.%I FOR EACH STATEMENT EXECUTE FUNCTION gov_repo.l15_history_immutable_v1()',t||'_truncate',t);
 END IF;
 EXECUTE format('ALTER TABLE gov_repo.%I ENABLE ROW LEVEL SECURITY',t);
 EXECUTE format('REVOKE ALL ON gov_repo.%I FROM PUBLIC,anon,authenticated,service_role,govia_l15_machine_intake_caller',t);
 FOR r IN SELECT tgname FROM pg_trigger WHERE tgrelid=('gov_repo.'||t)::regclass AND NOT tgisinternal LOOP EXECUTE format('ALTER TABLE gov_repo.%I ENABLE ALWAYS TRIGGER %I',t,r.tgname); END LOOP;
 END LOOP;
 FOR r IN SELECT oid::regprocedure sig,proname FROM pg_proc WHERE pronamespace='gov_repo'::regnamespace AND proname LIKE 'l15%risk_treatment%v1' LOOP
 EXECUTE format('ALTER FUNCTION %s OWNER TO postgres',r.sig);
 EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role,govia_l15_machine_intake_caller',r.sig);
 IF r.proname IN ('l15_submit_risk_treatment_proposal_v1','l15_decide_risk_treatment_proposal_v1','l15_read_risk_treatment_v1') THEN EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role',r.sig); END IF;
 END LOOP;
END $security$;
DO $postflight$ BEGIN
 IF EXISTS(SELECT 1 FROM m17_s5_root_snapshot s JOIN pg_proc p USING(oid) WHERE ROW(s.prosrc,s.proconfig,s.proacl,s.proowner,s.prosecdef) IS DISTINCT FROM ROW(p.prosrc,p.proconfig,p.proacl,p.proowner,p.prosecdef)) THEN RAISE EXCEPTION 'M17_S5: Authority Policy root changed'; END IF;
 IF (SELECT count(*) FROM pg_proc WHERE pronamespace='gov_repo'::regnamespace AND proname LIKE 'l15%risk_treatment%v1' AND has_function_privilege('service_role',oid,'EXECUTE'))<>3 THEN RAISE EXCEPTION 'M17_S5: unexpected application surface'; END IF;
END $postflight$;
COMMIT;
