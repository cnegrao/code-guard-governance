-- M17-S6 Phase A: RESIDUAL assessment, exact immutable dependencies, no M16 writes.
BEGIN;
DO $preflight$ BEGIN
 IF current_user <> 'postgres' OR current_setting('server_version_num')::int NOT BETWEEN 170000 AND 179999
 OR to_regclass('gov_repo.l15_risk_assessment_states') IS NULL
 OR to_regclass('gov_repo.l15_risk_treatment_states') IS NULL THEN
 RAISE EXCEPTION 'M17_S6_PREFLIGHT: postgres, PG17, S4 and S5 required'; END IF;
END $preflight$;
CREATE TEMP TABLE m17_s6_routine_snapshot ON COMMIT DROP AS
 SELECT oid,prosrc,proconfig,proacl,proowner,prosecdef FROM pg_proc WHERE pronamespace='gov_repo'::regnamespace;
ALTER TABLE gov_repo.l15_risk_assessment_proposals
 DROP CONSTRAINT l15_risk_assessment_proposals_basis_executable_check,
 ADD CONSTRAINT l15_risk_assessment_proposals_basis_executable_check CHECK(assessment_basis IN ('INHERENT','RESIDUAL'));
ALTER TABLE gov_repo.l15_risk_assessment_states
 DROP CONSTRAINT l15_risk_assessment_states_basis_executable_check,
 ADD CONSTRAINT l15_risk_assessment_states_basis_executable_check CHECK(assessment_basis IN ('INHERENT','RESIDUAL'));
ALTER TABLE gov_repo.l15_risk_assessment_heads
 DROP CONSTRAINT l15_risk_assessment_heads_basis_executable_check,
 ADD CONSTRAINT l15_risk_assessment_heads_basis_executable_check CHECK(assessment_basis IN ('INHERENT','RESIDUAL'));
ALTER TABLE gov_repo.l15_risk_assessment_proposals
 ADD COLUMN inherent_assessment_state_id uuid,
 ADD COLUMN inherent_methodology_id uuid,
 ADD COLUMN inherent_methodology_version_id uuid,
 ADD COLUMN inherent_methodology_content_hash text,
 ADD COLUMN inherent_methodology_validated_state_id uuid,
 ADD COLUMN inherent_basis text GENERATED ALWAYS AS (CASE WHEN assessment_basis='RESIDUAL' THEN 'INHERENT' END) STORED,
 ADD COLUMN inherent_state_kind text GENERATED ALWAYS AS (CASE WHEN assessment_basis='RESIDUAL' THEN 'VALIDATED' END) STORED,
 ADD COLUMN residual_methodology_validated_state_id uuid,
 ADD CONSTRAINT l15_ra_proposals_residual_shape CHECK (
 (assessment_basis='INHERENT' AND num_nonnulls(inherent_assessment_state_id,inherent_methodology_id,inherent_methodology_version_id,
 inherent_methodology_content_hash,inherent_methodology_validated_state_id,residual_methodology_validated_state_id)=0)
 OR (assessment_basis='RESIDUAL' AND num_nonnulls(inherent_assessment_state_id,inherent_methodology_id,inherent_methodology_version_id,
 inherent_methodology_content_hash,inherent_methodology_validated_state_id,residual_methodology_validated_state_id)=6)),
 ADD CONSTRAINT l15_ra_proposals_inherent_fk FOREIGN KEY(organisation_id,inherent_assessment_state_id,governed_risk_state_id,inherent_basis,
 inherent_methodology_id,inherent_methodology_version_id,inherent_methodology_content_hash,inherent_methodology_validated_state_id,inherent_state_kind)
 REFERENCES gov_repo.l15_risk_assessment_states(organisation_id,state_id,governed_risk_state_id,assessment_basis,
 methodology_id,methodology_version_id,methodology_content_hash,methodology_validated_state_id,state_kind),
 ADD CONSTRAINT l15_ra_proposals_residual_methodology_fk FOREIGN KEY(organisation_id,residual_methodology_validated_state_id,
 methodology_id,methodology_version_id,methodology_content_hash,inherent_state_kind)
 REFERENCES gov_repo.l15_risk_methodology_states(organisation_id,state_id,methodology_id,methodology_version_id,content_hash,state_kind);
ALTER TABLE gov_repo.l15_risk_assessment_states
 ADD COLUMN inherent_assessment_state_id uuid,
 ADD COLUMN inherent_methodology_id uuid,
 ADD COLUMN inherent_methodology_version_id uuid,
 ADD COLUMN inherent_methodology_content_hash text,
 ADD COLUMN inherent_methodology_validated_state_id uuid,
 ADD COLUMN inherent_basis text GENERATED ALWAYS AS (CASE WHEN assessment_basis='RESIDUAL' THEN 'INHERENT' END) STORED,
 ADD COLUMN inherent_state_kind text GENERATED ALWAYS AS (CASE WHEN assessment_basis='RESIDUAL' THEN 'VALIDATED' END) STORED,
 ADD COLUMN residual_methodology_validated_state_id uuid,
 ADD CONSTRAINT l15_ra_states_residual_shape CHECK (
 (assessment_basis='INHERENT' AND num_nonnulls(inherent_assessment_state_id,inherent_methodology_id,inherent_methodology_version_id,
 inherent_methodology_content_hash,inherent_methodology_validated_state_id,residual_methodology_validated_state_id)=0)
 OR (assessment_basis='RESIDUAL' AND num_nonnulls(inherent_assessment_state_id,inherent_methodology_id,inherent_methodology_version_id,
 inherent_methodology_content_hash,inherent_methodology_validated_state_id,residual_methodology_validated_state_id)=6)),
 ADD CONSTRAINT l15_ra_states_inherent_fk FOREIGN KEY(organisation_id,inherent_assessment_state_id,governed_risk_state_id,inherent_basis,
 inherent_methodology_id,inherent_methodology_version_id,inherent_methodology_content_hash,inherent_methodology_validated_state_id,inherent_state_kind)
 REFERENCES gov_repo.l15_risk_assessment_states(organisation_id,state_id,governed_risk_state_id,assessment_basis,
 methodology_id,methodology_version_id,methodology_content_hash,methodology_validated_state_id,state_kind),
 ADD CONSTRAINT l15_ra_states_residual_methodology_fk FOREIGN KEY(organisation_id,residual_methodology_validated_state_id,
 methodology_id,methodology_version_id,methodology_content_hash,inherent_state_kind)
 REFERENCES gov_repo.l15_risk_methodology_states(organisation_id,state_id,methodology_id,methodology_version_id,content_hash,state_kind);
CREATE TABLE gov_repo.l15_risk_assessment_proposal_treatment_pins (
 organisation_id uuid NOT NULL, proposal_id uuid NOT NULL, treatment_state_id uuid NOT NULL,
 governed_risk_state_id uuid NOT NULL, treatment_option text NOT NULL, treatment_ordinal_key text NOT NULL,
 PRIMARY KEY(organisation_id,proposal_id,treatment_state_id),
 FOREIGN KEY(organisation_id,proposal_id) REFERENCES gov_repo.l15_risk_assessment_proposals(organisation_id,proposal_id),
 FOREIGN KEY(organisation_id,treatment_state_id,governed_risk_state_id,treatment_option,treatment_ordinal_key)
 REFERENCES gov_repo.l15_risk_treatment_states(organisation_id,state_id,governed_risk_state_id,treatment_option,treatment_ordinal_key));
 CREATE TABLE gov_repo.l15_risk_assessment_proposal_control_assessment_pins (
 organisation_id uuid NOT NULL, proposal_id uuid NOT NULL, control_assessment_state_id uuid NOT NULL, control_applicability_state_id uuid NOT NULL,
 PRIMARY KEY(organisation_id,proposal_id,control_assessment_state_id),
 FOREIGN KEY(organisation_id,proposal_id) REFERENCES gov_repo.l15_risk_assessment_proposals(organisation_id,proposal_id),
 FOREIGN KEY(organisation_id,control_assessment_state_id,control_applicability_state_id)
 REFERENCES gov_repo.l14_control_assessment_states(organisation_id,fact_state_id,control_applicability_state_id));
 CREATE TABLE gov_repo.l15_risk_assessment_state_treatment_pins (
 organisation_id uuid NOT NULL, state_id uuid NOT NULL, treatment_state_id uuid NOT NULL,
 governed_risk_state_id uuid NOT NULL, treatment_option text NOT NULL, treatment_ordinal_key text NOT NULL,
 PRIMARY KEY(organisation_id,state_id,treatment_state_id),
 FOREIGN KEY(organisation_id,state_id) REFERENCES gov_repo.l15_risk_assessment_states(organisation_id,state_id),
 FOREIGN KEY(organisation_id,treatment_state_id,governed_risk_state_id,treatment_option,treatment_ordinal_key)
 REFERENCES gov_repo.l15_risk_treatment_states(organisation_id,state_id,governed_risk_state_id,treatment_option,treatment_ordinal_key));
 CREATE TABLE gov_repo.l15_risk_assessment_state_control_assessment_pins (
 organisation_id uuid NOT NULL, state_id uuid NOT NULL, control_assessment_state_id uuid NOT NULL, control_applicability_state_id uuid NOT NULL,
 PRIMARY KEY(organisation_id,state_id,control_assessment_state_id),
 FOREIGN KEY(organisation_id,state_id) REFERENCES gov_repo.l15_risk_assessment_states(organisation_id,state_id),
 FOREIGN KEY(organisation_id,control_assessment_state_id,control_applicability_state_id)
 REFERENCES gov_repo.l14_control_assessment_states(organisation_id,fact_state_id,control_applicability_state_id));
 -- Deterministic command framing; input arrays are sets of exact immutable state IDs.
CREATE FUNCTION gov_repo.l15_residual_pin_parts_v1(p_inherent uuid,p_methodology uuid,p_treatments uuid[],p_controls uuid[])
RETURNS text[] LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF p_inherent IS NULL OR p_methodology IS NULL THEN
 RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE='GV010',DETAIL='RESIDUAL_REQUIRED_PIN_MISSING'; END IF;
 IF p_treatments IS NULL OR p_controls IS NULL OR array_position(p_treatments,NULL::uuid) IS NOT NULL
 OR array_position(p_controls,NULL::uuid) IS NOT NULL
 OR cardinality(p_treatments)<>(SELECT count(DISTINCT x) FROM unnest(p_treatments) x)
 OR cardinality(p_controls)<>(SELECT count(DISTINCT x) FROM unnest(p_controls) x) THEN
 RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE='GV010',DETAIL='RESIDUAL_PIN_SET_MALFORMED'; END IF;
 RETURN ARRAY['RESIDUAL_PINS_V1',p_inherent::text,p_methodology::text,'TREATMENTS',cardinality(p_treatments)::text]
 || ARRAY(SELECT x::text FROM unnest(p_treatments) x ORDER BY x)
 || ARRAY['CONTROL_ASSESSMENTS',cardinality(p_controls)::text]
 || ARRAY(SELECT x::text FROM unnest(p_controls) x ORDER BY x);
END $$;
CREATE FUNCTION gov_repo.l15_residual_proposal_pin_parts_v1(p_org uuid,p_proposal uuid)
RETURNS text[] LANGUAGE sql STABLE SET search_path=pg_catalog,pg_temp AS $$
 SELECT gov_repo.l15_residual_pin_parts_v1(p.inherent_assessment_state_id,p.residual_methodology_validated_state_id,
 ARRAY(SELECT treatment_state_id FROM gov_repo.l15_risk_assessment_proposal_treatment_pins WHERE organisation_id=p_org AND proposal_id=p_proposal),
 ARRAY(SELECT control_assessment_state_id FROM gov_repo.l15_risk_assessment_proposal_control_assessment_pins WHERE organisation_id=p_org AND proposal_id=p_proposal))
 FROM gov_repo.l15_risk_assessment_proposals p WHERE p.organisation_id=p_org AND p.proposal_id=p_proposal
$$;

-- Exact transitive M16 read only. NOT_ASSESSED remains its actual outcome; it never produces coverage.
CREATE FUNCTION gov_repo.l15_residual_control_current_v1(p_org uuid,p_state uuid,p_at timestamptz,p_cutoff timestamptz)
RETURNS boolean LANGUAGE sql STABLE SET search_path=pg_catalog,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM gov_repo.l14_control_assessment_states a
 CROSS JOIN LATERAL gov_repo.l14_control_assessment_valid_state_v1(p_org,a.control_applicability_state_id,p_at,p_cutoff) v
 WHERE a.organisation_id=p_org AND a.fact_state_id=p_state AND a.state_kind='VALIDATED'
 AND a.applicability='APPLIES' AND v.fact_state_id=p_state)
$$;

CREATE FUNCTION gov_repo.l15_residual_proposal_dependency_failure_v1(p_org uuid,p_proposal uuid,p_at timestamptz,p_cutoff timestamptz)
RETURNS TABLE(dependency_kind text,dependency_id uuid) LANGUAGE sql STABLE SET search_path=pg_catalog,pg_temp AS $$
 SELECT f.kind,f.id FROM gov_repo.l15_risk_assessment_proposals p CROSS JOIN LATERAL (
 SELECT 1 priority,'GOVERNED_RISK'::text kind,p.governed_risk_state_id id
 WHERE NOT gov_repo.l15_governed_risk_state_current_v1(p_org,p.governed_risk_state_id,p_at,p_cutoff)
 UNION ALL SELECT 2,'INHERENT_RISK_ASSESSMENT',p.inherent_assessment_state_id
 WHERE NOT gov_repo.l15_risk_assessment_state_current_v1(p_org,p.inherent_assessment_state_id,p_at,p_cutoff)
 UNION ALL SELECT 3,'RISK_METHODOLOGY',p.residual_methodology_validated_state_id
 WHERE NOT EXISTS(SELECT 1 FROM gov_repo.l15_risk_methodology_valid_state_v1(p_org,p.methodology_id,p.methodology_version_id,p.methodology_content_hash::text,p_at,p_cutoff) v
 WHERE v.state_id=p.residual_methodology_validated_state_id)
 UNION ALL SELECT 4,'RISK_TREATMENT',t.treatment_state_id FROM gov_repo.l15_risk_assessment_proposal_treatment_pins t
 WHERE t.organisation_id=p_org AND t.proposal_id=p_proposal
 AND NOT gov_repo.l15_risk_treatment_state_current_v1(p_org,t.treatment_state_id,p_at,p_cutoff)
 UNION ALL SELECT 5,'CONTROL_ASSESSMENT',c.control_assessment_state_id FROM gov_repo.l15_risk_assessment_proposal_control_assessment_pins c
 WHERE c.organisation_id=p_org AND c.proposal_id=p_proposal
 AND NOT gov_repo.l15_residual_control_current_v1(p_org,c.control_assessment_state_id,p_at,p_cutoff)
 ) f WHERE p.organisation_id=p_org AND p.proposal_id=p_proposal AND p.assessment_basis='RESIDUAL'
 ORDER BY f.priority,f.id LIMIT 1
$$;
CREATE FUNCTION gov_repo.l15_residual_dependency_failure_v1(p_org uuid,p_state uuid,p_at timestamptz,p_cutoff timestamptz)
RETURNS TABLE(dependency_kind text,dependency_id uuid) LANGUAGE sql STABLE SET search_path=pg_catalog,pg_temp AS $$
 SELECT f.* FROM gov_repo.l15_risk_assessment_states s
 CROSS JOIN LATERAL gov_repo.l15_residual_proposal_dependency_failure_v1(p_org,s.proposal_id,p_at,p_cutoff) f
 WHERE s.organisation_id=p_org AND s.state_id=p_state AND s.assessment_basis='RESIDUAL'
$$;
CREATE FUNCTION gov_repo.l15_residual_assert_dependencies_v1(p_org uuid,p_proposal uuid,p_at timestamptz,p_cutoff timestamptz)
RETURNS void LANGUAGE plpgsql STABLE SET search_path=pg_catalog,pg_temp AS $$
DECLARE f record;
BEGIN
 SELECT * INTO f FROM gov_repo.l15_residual_proposal_dependency_failure_v1(p_org,p_proposal,p_at,p_cutoff);
 IF FOUND THEN RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE='GV010',DETAIL='RESIDUAL_DEPENDENCY_NOT_CURRENT:'||f.dependency_kind||':'||f.dependency_id; END IF;
END $$;

-- Copy only immutable identity tuples. Deferred guards prove proposal/state set equality in both directions.
CREATE FUNCTION gov_repo.l15_residual_tuple_guard_v1() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
DECLARE i record; p record;
BEGIN
 IF NEW.assessment_basis='INHERENT' THEN RETURN NEW; END IF;
 IF TG_TABLE_NAME='l15_risk_assessment_states' THEN
 SELECT * INTO STRICT p FROM gov_repo.l15_risk_assessment_proposals WHERE organisation_id=NEW.organisation_id AND proposal_id=NEW.proposal_id;
 NEW.inherent_assessment_state_id:=p.inherent_assessment_state_id;
 NEW.residual_methodology_validated_state_id:=p.residual_methodology_validated_state_id;
 IF NEW.methodology_validated_state_id IS DISTINCT FROM p.residual_methodology_validated_state_id THEN
 RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE='GV010',DETAIL='RESIDUAL_METHODOLOGY_PIN_MISMATCH'; END IF;
 IF NEW.state_kind='VALIDATED' THEN
 PERFORM gov_repo.l15_residual_assert_dependencies_v1(NEW.organisation_id,NEW.proposal_id,NEW.effective_from,NEW.recorded_at);
 END IF;
 END IF;
 SELECT * INTO i FROM gov_repo.l15_risk_assessment_states WHERE organisation_id=NEW.organisation_id AND state_id=NEW.inherent_assessment_state_id
 AND assessment_basis='INHERENT' AND state_kind='VALIDATED' AND governed_risk_state_id=NEW.governed_risk_state_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE='GV010',DETAIL='INHERENT_ASSESSMENT_PIN_INVALID'; END IF;
 NEW.inherent_methodology_id:=i.methodology_id;
 NEW.inherent_methodology_version_id:=i.methodology_version_id;
 NEW.inherent_methodology_content_hash:=i.methodology_content_hash;
 NEW.inherent_methodology_validated_state_id:=i.methodology_validated_state_id;
 RETURN NEW;
END $$;
CREATE TRIGGER l15_residual_tuple_guard BEFORE INSERT ON gov_repo.l15_risk_assessment_proposals FOR EACH ROW EXECUTE FUNCTION gov_repo.l15_residual_tuple_guard_v1();
CREATE TRIGGER l15_residual_tuple_guard BEFORE INSERT ON gov_repo.l15_risk_assessment_states FOR EACH ROW EXECUTE FUNCTION gov_repo.l15_residual_tuple_guard_v1();
ALTER TABLE gov_repo.l15_risk_assessment_proposals ENABLE ALWAYS TRIGGER l15_residual_tuple_guard;
ALTER TABLE gov_repo.l15_risk_assessment_states ENABLE ALWAYS TRIGGER l15_residual_tuple_guard;

CREATE FUNCTION gov_repo.l15_residual_pin_guard_v1() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
DECLARE owner_risk uuid; owner_id uuid; owner_table text;
BEGIN
 IF TG_TABLE_NAME LIKE '%_proposal_%' THEN owner_id:=NEW.proposal_id;owner_table:='l15_risk_assessment_proposals';
 ELSE owner_id:=NEW.state_id;owner_table:='l15_risk_assessment_states';END IF;
 EXECUTE format('SELECT governed_risk_state_id FROM gov_repo.%I WHERE organisation_id=$1 AND %I=$2 AND assessment_basis=''RESIDUAL'' AND xmin=pg_current_xact_id()::xid',
 owner_table,CASE WHEN owner_table LIKE '%proposals' THEN 'proposal_id' ELSE 'state_id' END)
 INTO owner_risk USING NEW.organisation_id,owner_id;
 IF owner_risk IS NULL THEN RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE='GV010',DETAIL='PIN_OWNER_NOT_IN_TRANSACTION'; END IF;
 IF TG_TABLE_NAME LIKE '%_treatment_pins' THEN
 IF NEW.governed_risk_state_id<>owner_risk OR NOT EXISTS(SELECT 1 FROM gov_repo.l15_risk_treatment_states t
 WHERE t.organisation_id=NEW.organisation_id AND t.state_id=NEW.treatment_state_id AND t.state_kind='VALIDATED') THEN
 RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE='GV010',DETAIL='TREATMENT_PIN_INVALID'; END IF;
 ELSE
 IF NOT EXISTS(SELECT 1 FROM gov_repo.l14_control_assessment_states a WHERE a.organisation_id=NEW.organisation_id
 AND a.fact_state_id=NEW.control_assessment_state_id AND a.control_applicability_state_id=NEW.control_applicability_state_id
 AND a.state_kind='VALIDATED' AND a.applicability='APPLIES') THEN
 RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE='GV010',DETAIL='CONTROL_ASSESSMENT_PIN_INVALID'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE FUNCTION gov_repo.l15_residual_write_proposal_pins_v1(p_org uuid,p_proposal uuid,p_treatments uuid[],p_controls uuid[])
RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
DECLARE n integer;
BEGIN
 INSERT INTO gov_repo.l15_risk_assessment_proposal_treatment_pins
 SELECT p_org,p_proposal,s.state_id,s.governed_risk_state_id,s.treatment_option,s.treatment_ordinal_key
 FROM gov_repo.l15_risk_treatment_states s WHERE s.organisation_id=p_org AND s.state_id=ANY(p_treatments) ORDER BY s.state_id;
 GET DIAGNOSTICS n=ROW_COUNT;
 IF n<>cardinality(p_treatments) THEN RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE='GV010',DETAIL='TREATMENT_PIN_UNRESOLVED'; END IF;
 INSERT INTO gov_repo.l15_risk_assessment_proposal_control_assessment_pins
 SELECT p_org,p_proposal,a.fact_state_id,a.control_applicability_state_id FROM gov_repo.l14_control_assessment_states a
 WHERE a.organisation_id=p_org AND a.fact_state_id=ANY(p_controls) ORDER BY a.fact_state_id;
 GET DIAGNOSTICS n=ROW_COUNT;
 IF n<>cardinality(p_controls) THEN RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE='GV010',DETAIL='CONTROL_ASSESSMENT_PIN_UNRESOLVED'; END IF;
END $$;

-- DEFERRABLE triggers execute as the committing service role, hence bounded owner-context read-only guard.
CREATE FUNCTION gov_repo.l15_residual_commit_guard_v1() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE mismatch boolean; target uuid;
BEGIN
 IF NEW.assessment_basis<>'RESIDUAL' THEN RETURN NULL; END IF;
 IF TG_TABLE_NAME='l15_risk_assessment_states' THEN
 SELECT EXISTS(
 (SELECT treatment_state_id,governed_risk_state_id,treatment_option,treatment_ordinal_key FROM gov_repo.l15_risk_assessment_proposal_treatment_pins WHERE organisation_id=NEW.organisation_id AND proposal_id=NEW.proposal_id
 EXCEPT SELECT treatment_state_id,governed_risk_state_id,treatment_option,treatment_ordinal_key FROM gov_repo.l15_risk_assessment_state_treatment_pins WHERE organisation_id=NEW.organisation_id AND state_id=NEW.state_id)
 UNION ALL
 (SELECT treatment_state_id,governed_risk_state_id,treatment_option,treatment_ordinal_key FROM gov_repo.l15_risk_assessment_state_treatment_pins WHERE organisation_id=NEW.organisation_id AND state_id=NEW.state_id
 EXCEPT SELECT treatment_state_id,governed_risk_state_id,treatment_option,treatment_ordinal_key FROM gov_repo.l15_risk_assessment_proposal_treatment_pins WHERE organisation_id=NEW.organisation_id AND proposal_id=NEW.proposal_id)
 UNION ALL
 (SELECT control_assessment_state_id,control_applicability_state_id,NULL::text,NULL::text FROM gov_repo.l15_risk_assessment_proposal_control_assessment_pins WHERE organisation_id=NEW.organisation_id AND proposal_id=NEW.proposal_id
 EXCEPT SELECT control_assessment_state_id,control_applicability_state_id,NULL::text,NULL::text FROM gov_repo.l15_risk_assessment_state_control_assessment_pins WHERE organisation_id=NEW.organisation_id AND state_id=NEW.state_id)
 UNION ALL
 (SELECT control_assessment_state_id,control_applicability_state_id,NULL::text,NULL::text FROM gov_repo.l15_risk_assessment_state_control_assessment_pins WHERE organisation_id=NEW.organisation_id AND state_id=NEW.state_id
 EXCEPT SELECT control_assessment_state_id,control_applicability_state_id,NULL::text,NULL::text FROM gov_repo.l15_risk_assessment_proposal_control_assessment_pins WHERE organisation_id=NEW.organisation_id AND proposal_id=NEW.proposal_id)) INTO mismatch;
 IF mismatch THEN RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE='GV010',DETAIL='RESIDUAL_PIN_SET_MISMATCH'; END IF;
 ELSE
 IF NEW.intent='REVOKE' THEN
 SELECT proposal_id INTO target FROM gov_repo.l15_risk_assessment_states WHERE organisation_id=NEW.organisation_id AND state_id=NEW.target_state_id;
 IF gov_repo.l15_residual_proposal_pin_parts_v1(NEW.organisation_id,NEW.proposal_id)
 IS DISTINCT FROM gov_repo.l15_residual_proposal_pin_parts_v1(NEW.organisation_id,target) THEN
 RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE='GV010',DETAIL='RESIDUAL_REVOKE_PINS_MISMATCH'; END IF;
 END IF;
 END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER l15_residual_complete AFTER INSERT ON gov_repo.l15_risk_assessment_states DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION gov_repo.l15_residual_commit_guard_v1();
CREATE CONSTRAINT TRIGGER l15_residual_complete AFTER INSERT ON gov_repo.l15_risk_assessment_proposals DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION gov_repo.l15_residual_commit_guard_v1();
ALTER TABLE gov_repo.l15_risk_assessment_states ENABLE ALWAYS TRIGGER l15_residual_complete;
ALTER TABLE gov_repo.l15_risk_assessment_proposals ENABLE ALWAYS TRIGGER l15_residual_complete;

-- Canonical dependency order matches existing writer namespaces: scenario -> risk -> methodologies -> parties ->
-- control definitions -> applicability -> control assessments -> inherent -> treatments -> residual (caller) -> command.
CREATE FUNCTION gov_repo.l15_residual_lock_dependencies_v1(p_org uuid,p_proposal uuid)
RETURNS void LANGUAGE plpgsql VOLATILE SET search_path=pg_catalog,pg_temp AS $$
DECLARE p record; d record;
BEGIN
 SELECT * INTO STRICT p FROM gov_repo.l15_risk_assessment_proposals WHERE organisation_id=p_org AND proposal_id=p_proposal;
 PERFORM gov_repo.l15_lock_scenario_dependency_guard_shared_v1(p_org,p.governed_risk_scenario_definition_id,p.governed_risk_scenario_definition_version_id,p.governed_risk_scenario_content_hash::text);
 PERFORM gov_repo.l15_lock_governed_risk_dependency_guard_shared_v1(p_org,p.governed_risk_subject_key,p.governed_risk_scenario_definition_id);
 FOR d IN SELECT * FROM (SELECT p.methodology_id id,p.methodology_version_id version,p.methodology_content_hash::text hash
 UNION SELECT p.inherent_methodology_id,p.inherent_methodology_version_id,p.inherent_methodology_content_hash) q ORDER BY id,version,hash LOOP
 PERFORM gov_repo.l15_lock_methodology_dependency_guard_shared_v1(p_org,d.id,d.version,d.hash); END LOOP;
 FOR d IN SELECT DISTINCT s.responsible_governance_party_id id FROM gov_repo.l15_risk_assessment_proposal_treatment_pins t
 JOIN gov_repo.l15_risk_treatment_states s ON s.organisation_id=t.organisation_id AND s.state_id=t.treatment_state_id
 WHERE t.organisation_id=p_org AND t.proposal_id=p_proposal ORDER BY id LOOP
 PERFORM gov_repo.l14_lock_party_dependency_guard_shared_v1(p_org,d.id); END LOOP;
 FOR d IN SELECT * FROM (
 SELECT c.control_definition_id id,c.control_definition_version_id version,c.content_hash::text hash
 FROM gov_repo.l15_risk_assessment_proposal_treatment_pins t JOIN gov_repo.l15_risk_treatment_state_control_pins c
 ON c.organisation_id=t.organisation_id AND c.state_id=t.treatment_state_id WHERE t.organisation_id=p_org AND t.proposal_id=p_proposal
 UNION SELECT a.control_definition_id,a.control_definition_version_id,a.content_hash::text
 FROM gov_repo.l15_risk_assessment_proposal_control_assessment_pins c JOIN gov_repo.l14_control_assessment_states a
 ON a.organisation_id=c.organisation_id AND a.fact_state_id=c.control_assessment_state_id WHERE c.organisation_id=p_org AND c.proposal_id=p_proposal
 ) q ORDER BY id,version,hash LOOP
 PERFORM gov_repo.l14_lock_control_definition_dependency_guard_shared_v1(p_org,d.id,d.version,d.hash); END LOOP;
 FOR d IN SELECT DISTINCT a.applicability_target_key key,a.control_definition_id id
 FROM gov_repo.l15_risk_assessment_proposal_control_assessment_pins c JOIN gov_repo.l14_control_assessment_states a
 ON a.organisation_id=c.organisation_id AND a.fact_state_id=c.control_assessment_state_id
 WHERE c.organisation_id=p_org AND c.proposal_id=p_proposal ORDER BY key,id LOOP
 PERFORM gov_repo.l14_lock_control_applicability_dependency_guard_shared_v1(p_org,d.key,d.id); END LOOP;
 FOR d IN SELECT DISTINCT control_applicability_state_id id FROM gov_repo.l15_risk_assessment_proposal_control_assessment_pins
 WHERE organisation_id=p_org AND proposal_id=p_proposal ORDER BY id LOOP
 PERFORM gov_repo.l14_lock_fact_subject_guard_v1(p_org,'CONTROL_ASSESSMENT',ARRAY['KEY',d.id::text]); END LOOP;
 PERFORM gov_repo.l15_lock_risk_assessment_key_guard_v1(p_org,p.governed_risk_state_id,'INHERENT');
 FOR d IN SELECT DISTINCT governed_risk_state_id risk,treatment_option opt,treatment_ordinal_key key FROM gov_repo.l15_risk_assessment_proposal_treatment_pins
 WHERE organisation_id=p_org AND proposal_id=p_proposal ORDER BY risk,opt,key LOOP
 PERFORM gov_repo.l15_lock_risk_treatment_key_guard_v1(p_org,d.risk,d.opt,d.key); END LOOP;
END $$;
CREATE FUNCTION gov_repo.l15_submit_risk_assessment_proposal_v2(
  p_verified_organisation_id uuid,
  p_verified_actor_user_id uuid,
  p_verified_session_iat bigint,
  p_verified_session_exp bigint,
  p_verified_credential_epoch timestamptz,
  p_command_id text,
  p_intent text,                            -- VALIDATE | REVOKE
  p_source_class text,                      -- LOCAL_HUMAN only (SYSTEM_SEED / SOURCE_CONNECTION: never for RISK_ASSESSMENT)
  p_governed_risk_state_id uuid,            -- the exact current VALIDATED GOVERNED_RISK state (dependency pin)
  p_assessment_basis text,                  -- INHERENT (RESIDUAL: S6)
  p_methodology_id uuid,                    -- the exact methodology identity ...
  p_methodology_version_id uuid,            -- ... the exact validated version ...
  p_methodology_content_hash text,          -- ... and its exact PostgreSQL content hash
  p_assessment_outcome text,                -- VALIDATE: RATED | INSUFFICIENT_EVIDENCE; REVOKE: NULL
  p_likelihood_level_code text,             -- RATED only: a level code of the pinned likelihood scale
  p_impact_level_code text,                 -- RATED only: a level code of the pinned impact scale
  p_requested_effective_from timestamptz,   -- NULL = IMMEDIATE intent
  p_requested_valid_until timestamptz,      -- VALIDATE: MANDATORY; REVOKE: NULL
  p_expected_current_state_id uuid,         -- NULL = explicit expected-none of the logical key
  p_target_state_id uuid,                   -- REVOKE only: the exact current VALIDATED assessment (= the expected current)
  p_prior_proposal_id uuid,                 -- correction link (same logical key)
  p_support_status text,
  p_support_tags text[],
  p_support_target_ids text[],
  p_inherent_assessment_state_id uuid,
  p_methodology_validated_state_id uuid,
  p_treatment_state_ids uuid[],
  p_control_assessment_state_ids uuid[],
  p_caller_fingerprint text                 -- assertion only; PostgreSQL recomputes
)
RETURNS TABLE (
  replay boolean, command_id text, command_kind text, subject_kind text, outcome text, command_fingerprint text,
  authorization_decision_id uuid, authorization_result text, deny_reason text, expectation_kind text,
  expected_current_state_id uuid, proposal_id uuid, governance_decision_id uuid, governed_risk_state_id uuid,
  assessment_basis text, methodology_id uuid, methodology_version_id uuid, methodology_content_hash text,
  assessment_outcome text, likelihood_level_code text, impact_level_code text, rating_band text,
  requested_valid_until timestamptz, state_id uuid, state_kind text, predecessor_state_id uuid,
  methodology_validated_state_id uuid, effective_from timestamptz, valid_until timestamptz, recorded_at timestamptz
)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp SET lock_timeout = '5s'
AS $submit$
#variable_conflict use_column
DECLARE
  v_org uuid := p_verified_organisation_id;
  v_actor uuid := p_verified_actor_user_id;
  v_support text[];
  v_fingerprint text;
  v_risk record;
  v_maximum interval;
  v_target record;
  v_head uuid;
  v_from timestamptz;
  v_proposal uuid := pg_catalog.gen_random_uuid();
  v_now timestamptz;
BEGIN
  -- 1. Any verified ACTIVE same-tenant human member. Tenant + actor come ONLY from here.
  PERFORM 1 FROM gov_repo.l14_session_basis_v1(v_org, v_actor, p_verified_session_iat,
    p_verified_session_exp, p_verified_credential_epoch);

  -- 2. Syntactic shape (no table read).
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
  IF p_assessment_basis IS NULL OR p_assessment_basis NOT IN ('INHERENT','RESIDUAL') THEN
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'ASSESSMENT_BASIS_UNKNOWN';
  END IF;
  IF p_assessment_basis <> 'RESIDUAL' THEN
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'ASSESSMENT_BASIS_NOT_EXECUTABLE';
  END IF;
  IF p_governed_risk_state_id IS NULL THEN
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'GOVERNED_RISK_STATE_REQUIRED';
  END IF;
  IF p_methodology_id IS NULL OR p_methodology_version_id IS NULL THEN
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'METHODOLOGY_IDS_REQUIRED';
  END IF;
  IF p_methodology_content_hash IS NULL OR p_methodology_content_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'CONTENT_HASH_MALFORMED';
  END IF;
  IF p_assessment_outcome IS NOT NULL AND p_assessment_outcome NOT IN ('RATED','INSUFFICIENT_EVIDENCE') THEN
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'ASSESSMENT_OUTCOME_UNKNOWN';
  END IF;
  IF p_intent = 'VALIDATE' AND p_target_state_id IS NOT NULL THEN
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'TARGET_STATE_NOT_PERMITTED';
  END IF;
  IF p_intent = 'VALIDATE' AND p_assessment_outcome IS NULL THEN
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'ASSESSMENT_OUTCOME_REQUIRED';
  END IF;
  IF p_intent = 'VALIDATE' AND p_requested_valid_until IS NULL THEN
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'VALID_UNTIL_REQUIRED';
  END IF;
  IF p_intent = 'REVOKE' AND p_target_state_id IS NULL THEN
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'TARGET_STATE_REQUIRED';
  END IF;
  IF p_intent = 'REVOKE' AND (p_assessment_outcome IS NOT NULL OR p_likelihood_level_code IS NOT NULL
       OR p_impact_level_code IS NOT NULL OR p_requested_valid_until IS NOT NULL) THEN
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'ASSESSMENT_CONTENT_NOT_PERMITTED';
  END IF;
  IF p_intent = 'REVOKE' AND p_expected_current_state_id IS DISTINCT FROM p_target_state_id THEN
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'EXPECTATION_MALFORMED';
  END IF;
  -- RATED: both level codes REQUIRED; INSUFFICIENT_EVIDENCE: no level (no default, no implicit LOW).
  IF p_assessment_outcome = 'RATED' AND p_likelihood_level_code IS NULL THEN
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'LIKELIHOOD_LEVEL_REQUIRED';
  END IF;
  IF p_assessment_outcome = 'RATED' AND p_impact_level_code IS NULL THEN
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'IMPACT_LEVEL_REQUIRED';
  END IF;
  IF p_assessment_outcome = 'INSUFFICIENT_EVIDENCE' AND p_likelihood_level_code IS NOT NULL THEN
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'LIKELIHOOD_LEVEL_NOT_PERMITTED';
  END IF;
  IF p_assessment_outcome = 'INSUFFICIENT_EVIDENCE' AND p_impact_level_code IS NOT NULL THEN
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'IMPACT_LEVEL_NOT_PERMITTED';
  END IF;
  IF p_requested_valid_until IS NOT NULL AND p_requested_effective_from IS NOT NULL
     AND NOT (p_requested_valid_until > p_requested_effective_from) THEN
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'EFFECTIVE_INTERVAL_INVALID';
  END IF;

  -- 3-4. Syntactic support (the rank-3 admissibility of RISK_ASSESSMENT equals GOVERNED_RISK's: RISK_HYPOTHESIS, RISK_SIGNAL,
  --      every rank-0 tag), then the PostgreSQL-authoritative fingerprint over the exact key, pins, content and intent.
  v_support := gov_repo.l15_governed_risk_support_parts_v1(p_support_status, p_support_tags, p_support_target_ids);
  v_fingerprint := gov_repo.l14_sha256_frame_v1(
    ARRAY['L15_COMMAND_FINGERPRINT_V1', 'SUBMIT_PROPOSAL', v_org::text, v_actor::text, 'RISK_ASSESSMENT', p_intent,
          p_source_class, p_governed_risk_state_id::text, p_assessment_basis, p_methodology_id::text,
          p_methodology_version_id::text, p_methodology_content_hash]
    || CASE WHEN p_assessment_outcome IS NULL THEN ARRAY['NO_ASSESSMENT_OUTCOME'] ELSE ARRAY['ASSESSMENT_OUTCOME', p_assessment_outcome] END
    || CASE WHEN p_likelihood_level_code IS NULL THEN ARRAY['NO_LIKELIHOOD_LEVEL'] ELSE ARRAY['LIKELIHOOD_LEVEL', p_likelihood_level_code] END
    || CASE WHEN p_impact_level_code IS NULL THEN ARRAY['NO_IMPACT_LEVEL'] ELSE ARRAY['IMPACT_LEVEL', p_impact_level_code] END
    || CASE WHEN p_requested_effective_from IS NULL THEN ARRAY['IMMEDIATE']
            ELSE ARRAY['EXPLICIT', gov_repo.l14_canonical_instant_v1(p_requested_effective_from)] END
    || CASE WHEN p_requested_valid_until IS NULL THEN ARRAY['NO_VALID_UNTIL']
            ELSE ARRAY['VALID_UNTIL', gov_repo.l14_canonical_instant_v1(p_requested_valid_until)] END
    || CASE WHEN p_expected_current_state_id IS NULL THEN ARRAY['EXPECTED_NONE']
            ELSE ARRAY['EXPECTED_CURRENT', p_expected_current_state_id::text] END
    || CASE WHEN p_target_state_id IS NULL THEN ARRAY['NO_TARGET_STATE'] ELSE ARRAY['TARGET_STATE', p_target_state_id::text] END
    || CASE WHEN p_prior_proposal_id IS NULL THEN ARRAY['NO_PRIOR_PROPOSAL'] ELSE ARRAY['PRIOR_PROPOSAL', p_prior_proposal_id::text] END
    || gov_repo.l15_residual_pin_parts_v1(p_inherent_assessment_state_id,p_methodology_validated_state_id,p_treatment_state_ids,p_control_assessment_state_ids)
    || v_support);
  IF v_fingerprint IS DISTINCT FROM p_caller_fingerprint THEN
    RAISE EXCEPTION 'L14_FINGERPRINT_MISMATCH' USING ERRCODE = 'GV008', DETAIL = 'CALLER_FINGERPRINT_DIFFERS';
  END IF;

  -- 5-7. Guards (AP shared, exact logical key, command), then replay arbitration BEFORE any resolution.
  PERFORM gov_repo.l14_lock_authority_policy_guard_shared_v1(v_org);
  PERFORM gov_repo.l15_lock_risk_assessment_key_guard_v1(v_org, p_governed_risk_state_id, p_assessment_basis);
  PERFORM gov_repo.l14_lock_command_guard_v1(v_org, p_command_id);
  IF gov_repo.l14_replay_arbitrate_v1(v_org, p_command_id, v_fingerprint) THEN
    PERFORM 1 FROM gov_repo.l14_session_basis_v1(v_org, v_actor, p_verified_session_iat,
      p_verified_session_exp, p_verified_credential_epoch);
    RETURN QUERY SELECT * FROM gov_repo.l15_risk_assessment_command_result_v1(v_org, p_command_id, true);
    RETURN;
  END IF;

  -- 8. Resolution: the exact GOVERNED_RISK state of THIS organisation (a foreign / unknown id is indistinguishable), its
  --    currency (VALIDATE), the exact admitted methodology tuple of THIS organisation and its validity (VALIDATE), level
  --    membership in the PINNED scales and the pinned cell (RATED), the validity maximum (explicit start), the expectation,
  --    the exact REVOKE target.
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
  SELECT v.assessment_validity_maximum INTO v_maximum
  FROM gov_repo.l15_risk_methodology_versions AS v
  WHERE v.organisation_id = v_org AND v.methodology_id = p_methodology_id
    AND v.methodology_version_id = p_methodology_version_id AND v.content_hash = p_methodology_content_hash;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'METHODOLOGY_VERSION_NOT_ADMITTED';
  END IF;
  IF p_intent = 'VALIDATE' AND NOT EXISTS (
       SELECT 1 FROM gov_repo.l15_risk_methodology_valid_state_v1(v_org, p_methodology_id, p_methodology_version_id,
         p_methodology_content_hash, v_from, v_now)) THEN
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'METHODOLOGY_VERSION_NOT_VALID';
  END IF;
  IF p_assessment_outcome = 'RATED' THEN
    PERFORM 1 FROM gov_repo.l15_risk_methodology_likelihood_levels AS l
    WHERE l.organisation_id = v_org AND l.methodology_version_id = p_methodology_version_id
      AND l.level_code = p_likelihood_level_code;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'LIKELIHOOD_LEVEL_NOT_IN_METHODOLOGY';
    END IF;
    PERFORM 1 FROM gov_repo.l15_risk_methodology_impact_levels AS l
    WHERE l.organisation_id = v_org AND l.methodology_version_id = p_methodology_version_id
      AND l.level_code = p_impact_level_code;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'IMPACT_LEVEL_NOT_IN_METHODOLOGY';
    END IF;
    PERFORM gov_repo.l15_risk_assessment_rating_band_v1(v_org, p_methodology_version_id, p_likelihood_level_code,
      p_impact_level_code);
  END IF;
  IF p_intent = 'VALIDATE' AND NOT (p_requested_valid_until > v_from) THEN
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'EFFECTIVE_INTERVAL_INVALID';
  END IF;
  IF p_intent = 'VALIDATE' AND p_requested_effective_from IS NOT NULL
     AND NOT (p_requested_valid_until <= gov_repo.l15_assessment_validity_limit_v1(p_requested_effective_from, v_maximum)) THEN
    -- An IMMEDIATE start is fixed only by the decision (which re-checks authoritatively); an explicit start is final here.
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'VALIDITY_EXCEEDS_METHODOLOGY_MAXIMUM';
  END IF;
  SELECT h.latest_state_id INTO v_head FROM gov_repo.l15_risk_assessment_heads AS h
  WHERE h.organisation_id = v_org AND h.governed_risk_state_id = p_governed_risk_state_id AND h.assessment_basis = p_assessment_basis;
  IF p_expected_current_state_id IS NULL AND v_head IS NOT NULL THEN
    RAISE EXCEPTION 'L15_STALE_EXPECTATION' USING ERRCODE = 'GV009', DETAIL = 'RISK_ASSESSMENT_STATE_EXISTS';
  END IF;
  IF p_expected_current_state_id IS DISTINCT FROM v_head THEN
    RAISE EXCEPTION 'L15_STALE_EXPECTATION' USING ERRCODE = 'GV009', DETAIL = 'RISK_ASSESSMENT_STATE_EXPECTATION_MISMATCH';
  END IF;
  IF p_intent = 'REVOKE' THEN
    SELECT s.state_kind, s.governed_risk_state_id, s.assessment_basis, s.methodology_id, s.methodology_version_id,
           s.methodology_content_hash INTO v_target
    FROM gov_repo.l15_risk_assessment_states AS s WHERE s.organisation_id = v_org AND s.state_id = p_target_state_id;
    IF NOT FOUND OR v_target.governed_risk_state_id <> p_governed_risk_state_id OR v_target.assessment_basis <> p_assessment_basis
       OR v_target.methodology_id <> p_methodology_id OR v_target.methodology_version_id <> p_methodology_version_id
       OR v_target.methodology_content_hash::text <> p_methodology_content_hash THEN
      RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'TARGET_STATE_UNRESOLVED';
    END IF;
    IF v_target.state_kind <> 'VALIDATED' THEN
      RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'TARGET_STATE_NOT_VALIDATED';
    END IF;
    PERFORM 1 FROM gov_repo.l15_risk_assessment_states AS s
    WHERE s.organisation_id = v_org AND s.state_kind = 'REVOKED' AND s.revokes_state_id = p_target_state_id;
    IF FOUND THEN
      RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'TARGET_ALREADY_REVOKED';
    END IF;
  END IF;
  IF p_prior_proposal_id IS NOT NULL THEN
    PERFORM 1 FROM gov_repo.l15_risk_assessment_proposals AS cp
    WHERE cp.organisation_id = v_org AND cp.proposal_id = p_prior_proposal_id
      AND cp.governed_risk_state_id = p_governed_risk_state_id AND cp.assessment_basis = p_assessment_basis;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'PRIOR_PROPOSAL_UNRESOLVED';
    END IF;
  END IF;
  PERFORM 1 FROM gov_repo.l15_normalize_support_v1(v_org, p_support_tags, p_support_target_ids);

  -- 9. Envelope + typed detail + support + durable result. Nothing else.
  INSERT INTO gov_repo.l14_proposals (organisation_id, proposal_id, subject_kind, intent, source_class,
    submitted_by_actor_user_id, prior_proposal_id, support_status, submitted_at)
  VALUES (v_org, v_proposal, 'RISK_ASSESSMENT', p_intent, p_source_class, v_actor, p_prior_proposal_id, p_support_status, v_now);
  INSERT INTO gov_repo.l15_risk_assessment_proposals (organisation_id, proposal_id, intent, assessment_basis,
    governed_risk_state_id, governed_risk_subject_key, governed_risk_scenario_definition_id,
    governed_risk_scenario_definition_version_id, governed_risk_scenario_content_hash, governed_risk_scenario_validated_state_id,
    methodology_id, methodology_version_id, methodology_content_hash, assessment_outcome, likelihood_level_code,
    impact_level_code, requested_effective_from, requested_valid_until, expected_current_state_id, target_state_id,
    inherent_assessment_state_id,residual_methodology_validated_state_id)
  VALUES (v_org, v_proposal, p_intent, p_assessment_basis, p_governed_risk_state_id, v_risk.subject_key,
    v_risk.scenario_definition_id, v_risk.scenario_definition_version_id, v_risk.scenario_content_hash,
    v_risk.scenario_validated_state_id, p_methodology_id, p_methodology_version_id, p_methodology_content_hash,
    p_assessment_outcome, p_likelihood_level_code, p_impact_level_code, p_requested_effective_from, p_requested_valid_until,
    p_expected_current_state_id, p_target_state_id,p_inherent_assessment_state_id,p_methodology_validated_state_id);
  PERFORM gov_repo.l15_residual_write_proposal_pins_v1(v_org,v_proposal,p_treatment_state_ids,p_control_assessment_state_ids);
  IF p_intent='VALIDATE' THEN
    PERFORM gov_repo.l15_residual_assert_dependencies_v1(v_org,v_proposal,v_from,v_now);
  END IF;
  PERFORM gov_repo.l15_write_risk_assessment_support_links_v1(v_org, 'PROPOSAL', v_proposal, NULL, NULL,
    p_support_tags, p_support_target_ids);
  INSERT INTO gov_repo.l14_command_results (organisation_id, command_id, command_kind, subject_kind,
    command_fingerprint, actor_user_id, outcome, proposal_id, recorded_at)
  VALUES (v_org, p_command_id, 'SUBMIT_PROPOSAL', 'RISK_ASSESSMENT', v_fingerprint, v_actor, 'SUBMITTED', v_proposal, v_now);

  PERFORM 1 FROM gov_repo.l14_session_basis_v1(v_org, v_actor, p_verified_session_iat,
    p_verified_session_exp, p_verified_credential_epoch);
  RETURN QUERY SELECT * FROM gov_repo.l15_risk_assessment_command_result_v1(v_org, p_command_id, false);
END;
$submit$;
CREATE OR REPLACE FUNCTION gov_repo.l15_decide_risk_assessment_proposal_v1(
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
  p_support_tags text[],
  p_support_target_ids text[],
  p_caller_fingerprint text                 -- assertion only; PostgreSQL recomputes
)
RETURNS TABLE (
  replay boolean, command_id text, command_kind text, subject_kind text, outcome text, command_fingerprint text,
  authorization_decision_id uuid, authorization_result text, deny_reason text, expectation_kind text,
  expected_current_state_id uuid, proposal_id uuid, governance_decision_id uuid, governed_risk_state_id uuid,
  assessment_basis text, methodology_id uuid, methodology_version_id uuid, methodology_content_hash text,
  assessment_outcome text, likelihood_level_code text, impact_level_code text, rating_band text,
  requested_valid_until timestamptz, state_id uuid, state_kind text, predecessor_state_id uuid,
  methodology_validated_state_id uuid, effective_from timestamptz, valid_until timestamptz, recorded_at timestamptz
)
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
  v_latest_until timestamptz;
  v_latest_methodology_id uuid;
  v_latest_methodology_version uuid;
  v_latest_methodology_hash text;
  v_latest_methodology_state uuid;
  v_latest_outcome text;
  v_latest_likelihood text;
  v_latest_impact text;
  v_target_state_id uuid;
  v_methodology_state uuid;
  v_maximum interval;
  v_band text;
  v_has_basis boolean := false;
  v_basis_policy uuid;
  v_basis_version uuid;
  v_basis_hash text;
  v_deny text;
  v_ordinals integer[];
  v_self boolean;
  v_temporal text := 'IMMEDIATE';
  v_effective_from timestamptz;
  v_valid_until timestamptz;
  v_now timestamptz;
  v_authz uuid := pg_catalog.gen_random_uuid();
  v_decision uuid := pg_catalog.gen_random_uuid();
  v_state uuid := pg_catalog.gen_random_uuid();
  v_state_kind text;
BEGIN
  -- 1. Base session eligibility. Tenant + actor + CURRENT locked persisted roles come ONLY from here.
  SELECT b.role_ids INTO v_role_ids
  FROM gov_repo.l14_session_basis_v1(v_org, v_actor, p_verified_session_iat, p_verified_session_exp,
    p_verified_credential_epoch) AS b;

  -- 2. Syntactic shape: the unchanged subject x outcome reason rule (no per-band / per-outcome code exists).
  PERFORM gov_repo.l14_validate_command_id_v1(p_command_id, p_caller_fingerprint);
  IF p_outcome IS NULL OR p_outcome NOT IN ('VALIDATE','REJECT','DEFER','REVOKE')
     OR p_reason_code IS NULL OR p_reason_code NOT IN (
       'RISK_ASSESSMENT_VALIDATED','RISK_ASSESSMENT_REJECTED','RISK_ASSESSMENT_DEFERRED','RISK_ASSESSMENT_REVOKED')
     OR NOT ((p_outcome = 'VALIDATE' AND p_reason_code = 'RISK_ASSESSMENT_VALIDATED')
          OR (p_outcome = 'REJECT' AND p_reason_code = 'RISK_ASSESSMENT_REJECTED')
          OR (p_outcome = 'DEFER' AND p_reason_code = 'RISK_ASSESSMENT_DEFERRED')
          OR (p_outcome = 'REVOKE' AND p_reason_code = 'RISK_ASSESSMENT_REVOKED')) THEN
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'DECISION_VOCABULARY_INVALID';
  END IF;
  -- The immutable proposal defines the command identity; it is the only row read before replay arbitration.
  SELECT p.proposal_id, p.intent, p.source_class, p.submitted_by_actor_user_id, t.assessment_basis, t.governed_risk_state_id,
         t.governed_risk_subject_key, t.governed_risk_scenario_definition_id, t.governed_risk_scenario_definition_version_id,
         t.governed_risk_scenario_content_hash::text AS governed_risk_scenario_content_hash, t.methodology_id,
         t.methodology_version_id, t.methodology_content_hash::text AS methodology_content_hash, t.assessment_outcome,
         t.likelihood_level_code, t.impact_level_code, t.requested_effective_from, t.requested_valid_until,
         t.expected_current_state_id, t.target_state_id,t.inherent_assessment_state_id,t.residual_methodology_validated_state_id
  INTO v_proposal
  FROM gov_repo.l14_proposals AS p
  JOIN gov_repo.l15_risk_assessment_proposals AS t ON t.organisation_id = p.organisation_id AND t.proposal_id = p.proposal_id
  WHERE p.organisation_id = v_org AND p.proposal_id = p_proposal_id AND p.subject_kind = 'RISK_ASSESSMENT';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'PROPOSAL_UNRESOLVED';
  END IF;
  IF (p_outcome = 'VALIDATE' AND v_proposal.intent <> 'VALIDATE') OR (p_outcome = 'REVOKE' AND v_proposal.intent <> 'REVOKE') THEN
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'OUTCOME_INTENT_INCOMPATIBLE';
  END IF;

  -- 3-4. Syntactic support, then the PostgreSQL-authoritative fingerprint.
  v_support := gov_repo.l15_governed_risk_support_parts_v1(p_support_status, p_support_tags, p_support_target_ids);
  v_fingerprint := gov_repo.l14_sha256_frame_v1(
    ARRAY['L15_COMMAND_FINGERPRINT_V1', 'DECIDE_PROPOSAL', v_org::text, v_actor::text, p_outcome, p_reason_code,
          v_proposal.proposal_id::text, 'RISK_ASSESSMENT', v_proposal.intent, v_proposal.source_class,
          v_proposal.governed_risk_state_id::text, v_proposal.assessment_basis, v_proposal.methodology_id::text,
          v_proposal.methodology_version_id::text, v_proposal.methodology_content_hash]
    || CASE WHEN v_proposal.assessment_outcome IS NULL THEN ARRAY['NO_ASSESSMENT_OUTCOME']
            ELSE ARRAY['ASSESSMENT_OUTCOME', v_proposal.assessment_outcome] END
    || CASE WHEN v_proposal.likelihood_level_code IS NULL THEN ARRAY['NO_LIKELIHOOD_LEVEL']
            ELSE ARRAY['LIKELIHOOD_LEVEL', v_proposal.likelihood_level_code] END
    || CASE WHEN v_proposal.impact_level_code IS NULL THEN ARRAY['NO_IMPACT_LEVEL']
            ELSE ARRAY['IMPACT_LEVEL', v_proposal.impact_level_code] END
    || CASE WHEN v_proposal.requested_effective_from IS NULL THEN ARRAY['IMMEDIATE']
            ELSE ARRAY['EXPLICIT', gov_repo.l14_canonical_instant_v1(v_proposal.requested_effective_from)] END
    || CASE WHEN v_proposal.requested_valid_until IS NULL THEN ARRAY['NO_VALID_UNTIL']
            ELSE ARRAY['VALID_UNTIL', gov_repo.l14_canonical_instant_v1(v_proposal.requested_valid_until)] END
    || CASE WHEN v_proposal.target_state_id IS NULL THEN ARRAY['NO_TARGET_STATE']
            ELSE ARRAY['TARGET_STATE', v_proposal.target_state_id::text] END
    || CASE WHEN p_expected_current_state_id IS NULL THEN ARRAY['EXPECTED_NONE']
            ELSE ARRAY['EXPECTED_CURRENT', p_expected_current_state_id::text] END
    || CASE WHEN v_proposal.assessment_basis='RESIDUAL' THEN gov_repo.l15_residual_proposal_pin_parts_v1(v_org,p_proposal_id) ELSE '{}'::text[] END
    || v_support);
  IF v_fingerprint IS DISTINCT FROM p_caller_fingerprint THEN
    RAISE EXCEPTION 'L14_FINGERPRINT_MISMATCH' USING ERRCODE = 'GV008', DETAIL = 'CALLER_FINGERPRINT_DIFFERS';
  END IF;

  -- 5-7. Guards in the fixed order: AP SHARED -> (VALIDATE only) the pinned risk's scenario dependency SHARED (S2 registry key)
  --      -> the pinned GOVERNED_RISK key SHARED (S3 key) -> the pinned methodology dependency SHARED (S2 registry key) -> exact
  --      assessment KEY -> command; then replay arbitration BEFORE any resolution. Every dependency guard is a SHARED mode of
  --      the exact key its own family's decisions take EXCLUSIVELY (no new lock namespace). REVOKE / REJECT / DEFER never wait
  --      on a dependency (explicit cleanup stays possible).
  PERFORM gov_repo.l14_lock_authority_policy_guard_shared_v1(v_org);
  IF p_outcome='VALIDATE' AND v_proposal.assessment_basis='RESIDUAL' THEN
    PERFORM gov_repo.l15_residual_lock_dependencies_v1(v_org,p_proposal_id);
  END IF;
  IF p_outcome = 'VALIDATE' THEN
    PERFORM gov_repo.l15_lock_scenario_dependency_guard_shared_v1(v_org, v_proposal.governed_risk_scenario_definition_id,
      v_proposal.governed_risk_scenario_definition_version_id, v_proposal.governed_risk_scenario_content_hash);
    PERFORM gov_repo.l15_lock_governed_risk_dependency_guard_shared_v1(v_org, v_proposal.governed_risk_subject_key,
      v_proposal.governed_risk_scenario_definition_id);
    PERFORM gov_repo.l15_lock_methodology_dependency_guard_shared_v1(v_org, v_proposal.methodology_id,
      v_proposal.methodology_version_id, v_proposal.methodology_content_hash);
  END IF;
  PERFORM gov_repo.l15_lock_risk_assessment_key_guard_v1(v_org, v_proposal.governed_risk_state_id, v_proposal.assessment_basis);
  PERFORM gov_repo.l14_lock_command_guard_v1(v_org, p_command_id);
  IF gov_repo.l14_replay_arbitrate_v1(v_org, p_command_id, v_fingerprint) THEN
    PERFORM 1 FROM gov_repo.l14_session_basis_v1(v_org, v_actor, p_verified_session_iat,
      p_verified_session_exp, p_verified_credential_epoch);
    RETURN QUERY SELECT * FROM gov_repo.l15_risk_assessment_command_result_v1(v_org, p_command_id, true);
    RETURN;
  END IF;

  -- 8. Resolution under the guards: terminality, the pinned risk state's exact subject (the authority target), head
  --    expectation (= the proposal's own explicit expectation), latest lineage state, the exact REVOKE target, support.
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
  SELECT h.latest_state_id INTO v_head_latest FROM gov_repo.l15_risk_assessment_heads AS h
  WHERE h.organisation_id = v_org AND h.governed_risk_state_id = v_proposal.governed_risk_state_id
    AND h.assessment_basis = v_proposal.assessment_basis;
  v_head_found := FOUND;
  IF p_expected_current_state_id IS NULL AND v_head_latest IS NOT NULL THEN
    RAISE EXCEPTION 'L15_STALE_EXPECTATION' USING ERRCODE = 'GV009', DETAIL = 'RISK_ASSESSMENT_STATE_EXISTS';
  END IF;
  IF p_expected_current_state_id IS DISTINCT FROM v_head_latest
     OR p_expected_current_state_id IS DISTINCT FROM v_proposal.expected_current_state_id THEN
    RAISE EXCEPTION 'L15_STALE_EXPECTATION' USING ERRCODE = 'GV009', DETAIL = 'RISK_ASSESSMENT_STATE_EXPECTATION_MISMATCH';
  END IF;
  IF v_head_latest IS NOT NULL THEN
    SELECT s.state_kind, s.effective_from, s.valid_until, s.methodology_id, s.methodology_version_id,
           s.methodology_content_hash::text, s.methodology_validated_state_id, s.assessment_outcome, s.likelihood_level_code,
           s.impact_level_code
    INTO v_latest_kind, v_latest_from, v_latest_until, v_latest_methodology_id, v_latest_methodology_version,
         v_latest_methodology_hash, v_latest_methodology_state, v_latest_outcome, v_latest_likelihood, v_latest_impact
    FROM gov_repo.l15_risk_assessment_states AS s WHERE s.organisation_id = v_org AND s.state_id = v_head_latest;
  END IF;
  IF p_outcome = 'VALIDATE' AND v_latest_kind = 'VALIDATED'
     AND v_latest_methodology_id = v_proposal.methodology_id AND v_latest_methodology_version = v_proposal.methodology_version_id
     AND v_latest_methodology_hash = v_proposal.methodology_content_hash
     AND v_latest_outcome = v_proposal.assessment_outcome
     AND v_latest_likelihood IS NOT DISTINCT FROM v_proposal.likelihood_level_code
     AND v_latest_impact IS NOT DISTINCT FROM v_proposal.impact_level_code
     AND v_latest_until = v_proposal.requested_valid_until THEN
    -- A renewal / correction must change something: another methodology pin, outcome, level or valid_until.
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'RISK_ASSESSMENT_ALREADY_VALIDATED';
  END IF;
  IF p_outcome = 'REVOKE' THEN
    PERFORM 1 FROM gov_repo.l15_risk_assessment_states AS r
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

  -- 9. One DB evaluation instant; temporal class (M16 §17 verbatim, no skew tolerance); the CURRENT effective policy is the
  --    ONLY basis, evaluated over the exact typed subject of the PINNED GOVERNED_RISK state. Never L14_*, another L15
  --    permission, service_role, machine capability, source class, band, level, domain, confidence, severity or count.
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
      v_valid_until := v_proposal.requested_valid_until;
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
      gov_repo.l15_governance_permission_v1('RISK_ASSESSMENT', p_outcome), p_outcome, p_outcome = 'VALIDATE' AND v_self, v_temporal,
      v_risk.subject_canonical_kind, v_risk.subject_canonical_object_id) AS e;
  ELSE
    SELECT e.deny_reason, e.rule_ordinals INTO v_deny, v_ordinals
    FROM gov_repo.l14_evaluate_relationship_state_authority_rules_v1(v_org, v_basis_policy, v_basis_version, v_role_ids,
      gov_repo.l15_governance_permission_v1('RISK_ASSESSMENT', p_outcome), p_outcome, p_outcome = 'VALIDATE' AND v_self, v_temporal,
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
    p_outcome, 'RISK_ASSESSMENT', v_risk.subject_type, v_risk.subject_canonical_kind,
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
  -- The S2R1 root L15 ALLOW guard (owner-only SECURITY DEFINER, DEFERRABLE INITIALLY DEFERRED) is NOT forced here: it fires
  -- naturally at COMMIT in the committing (service_role) session with its full check.

  IF v_deny IS NOT NULL THEN
    -- Durable DENY: authorization + result only; consumes the command id; no decision, no state, no head change.
    INSERT INTO gov_repo.l14_command_results (organisation_id, command_id, command_kind, subject_kind,
      command_fingerprint, actor_user_id, outcome, authorization_decision_id, proposal_id, recorded_at)
    VALUES (v_org, p_command_id, 'DECIDE_PROPOSAL', 'RISK_ASSESSMENT', v_fingerprint, v_actor, 'DENIED', v_authz, p_proposal_id, v_now);
  ELSE
    -- 10. Interval and dependency rules (authorized commands only; a violation raises and rolls back the WHOLE command:
    --     nothing is consumed).
    IF p_outcome = 'VALIDATE' AND NOT (v_valid_until > v_effective_from) THEN
      -- valid_until is mandatory and strictly later than the effective start (incl. an IMMEDIATE start).
      RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'EFFECTIVE_INTERVAL_INVALID';
    END IF;
    IF p_outcome = 'REVOKE' AND v_effective_from < v_latest_from THEN
      RAISE EXCEPTION 'L15_CONTINUITY_VIOLATION' USING ERRCODE = 'GV011', DETAIL = 'REVOKE_BEFORE_TARGET_EFFECTIVE';
    END IF;
    IF p_outcome = 'REVOKE' AND v_effective_from >= v_latest_until THEN
      RAISE EXCEPTION 'L15_CONTINUITY_VIOLATION' USING ERRCODE = 'GV011', DETAIL = 'REVOKE_AFTER_TARGET_EXPIRY';
    END IF;
    IF p_outcome = 'VALIDATE' AND v_latest_kind = 'REVOKED' AND NOT (v_effective_from >= v_latest_from) THEN
      RAISE EXCEPTION 'L15_CONTINUITY_VIOLATION' USING ERRCODE = 'GV011', DETAIL = 'REVALIDATION_OVERLAPS_PRIOR_INTERVAL';
    END IF;
    -- Renewal / correction (another pin / outcome / level / valid_until): never before the predecessor's start; it may begin
    -- before the predecessor's valid_until (the predecessor's closure is derived from it).
    IF p_outcome = 'VALIDATE' AND v_latest_kind = 'VALIDATED' AND v_effective_from < v_latest_from THEN
      RAISE EXCEPTION 'L15_CONTINUITY_VIOLATION' USING ERRCODE = 'GV011', DETAIL = 'SUCCESSOR_BEFORE_PREDECESSOR_EFFECTIVE';
    END IF;
    IF p_outcome = 'VALIDATE' THEN
      -- The exact pinned GOVERNED_RISK state must be THE current risk state of its own key at the effective instant as known
      -- now, under the shared dependency guards (a revoked / superseded / expired / subject- or scenario-invalid risk state
      -- never validates an assessment; no successor risk state is ever selected instead).
      IF NOT gov_repo.l15_governed_risk_state_current_v1(v_org, v_proposal.governed_risk_state_id, v_effective_from, v_now) THEN
        RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'GOVERNED_RISK_DEPENDENCY_NOT_VALID';
      END IF;
      -- The exact pinned methodology version must be THE VALIDATED, non-revoked, effective methodology state of that exact
      -- tuple at the effective instant as known now (never latest, never a successor version, never a default).
      SELECT mv.state_id INTO v_methodology_state
      FROM gov_repo.l15_risk_methodology_valid_state_v1(v_org, v_proposal.methodology_id, v_proposal.methodology_version_id,
        v_proposal.methodology_content_hash, v_effective_from, v_now) AS mv;
      IF v_methodology_state IS NULL THEN
        RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'METHODOLOGY_DEPENDENCY_NOT_VALID';
      END IF;
      SELECT v.assessment_validity_maximum INTO v_maximum
      FROM gov_repo.l15_risk_methodology_versions AS v
      WHERE v.organisation_id = v_org AND v.methodology_id = v_proposal.methodology_id
        AND v.methodology_version_id = v_proposal.methodology_version_id
        AND v.content_hash = v_proposal.methodology_content_hash;
      IF NOT (v_valid_until <= gov_repo.l15_assessment_validity_limit_v1(v_effective_from, v_maximum)) THEN
        RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'VALIDITY_EXCEEDS_METHODOLOGY_MAXIMUM';
      END IF;
      IF v_proposal.assessment_outcome = 'RATED' THEN
        v_band := gov_repo.l15_risk_assessment_rating_band_v1(v_org, v_proposal.methodology_version_id,
          v_proposal.likelihood_level_code, v_proposal.impact_level_code);
      END IF;
      IF v_proposal.assessment_basis='RESIDUAL' THEN
        PERFORM gov_repo.l15_residual_assert_dependencies_v1(v_org,p_proposal_id,v_effective_from,v_now);
        IF v_methodology_state IS DISTINCT FROM v_proposal.residual_methodology_validated_state_id THEN
          RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE='GV010',DETAIL='RESIDUAL_METHODOLOGY_PIN_NOT_CURRENT';
        END IF;
      END IF;
    ELSIF p_outcome = 'REVOKE' THEN
      v_methodology_state := v_latest_methodology_state;
    END IF;

    INSERT INTO gov_repo.l14_governance_decisions (organisation_id, governance_decision_id, proposal_id,
      subject_kind, outcome, reason_code, authorization_decision_id, actor_user_id, support_status, decided_at)
    VALUES (v_org, v_decision, p_proposal_id, 'RISK_ASSESSMENT', p_outcome, p_reason_code, v_authz, v_actor, p_support_status, v_now);
    PERFORM gov_repo.l15_write_risk_assessment_support_links_v1(v_org, 'DECISION', NULL, v_decision, NULL,
      p_support_tags, p_support_target_ids);
    IF p_outcome IN ('VALIDATE','REVOKE') THEN
      v_state_kind := CASE WHEN p_outcome = 'VALIDATE' THEN 'VALIDATED' ELSE 'REVOKED' END;
      -- Append-only: predecessor = the expected head state; the predecessor row is never modified (its closure is derived).
      INSERT INTO gov_repo.l15_risk_assessment_states (organisation_id, state_id, state_kind, assessment_basis,
        governed_risk_state_id, governed_risk_subject_key, governed_risk_scenario_definition_id,
        governed_risk_scenario_definition_version_id, governed_risk_scenario_content_hash,
        governed_risk_scenario_validated_state_id, methodology_id, methodology_version_id, methodology_content_hash,
        methodology_validated_state_id, assessment_outcome, likelihood_level_code, impact_level_code, rating_band,
        predecessor_state_id, revokes_state_id, effective_from, valid_until, recorded_at, proposal_id, governance_decision_id,
        authorization_decision_id, authority_policy_id, authority_policy_version_id, authority_policy_content_hash,
        source_class, support_status)
      SELECT v_org, v_state, v_state_kind, t.assessment_basis, t.governed_risk_state_id, t.governed_risk_subject_key,
        t.governed_risk_scenario_definition_id, t.governed_risk_scenario_definition_version_id,
        t.governed_risk_scenario_content_hash, t.governed_risk_scenario_validated_state_id, t.methodology_id,
        t.methodology_version_id, t.methodology_content_hash, v_methodology_state, t.assessment_outcome,
        t.likelihood_level_code, t.impact_level_code, v_band, v_head_latest, v_target_state_id, v_effective_from,
        v_valid_until, v_now, p_proposal_id, v_decision, v_authz, v_basis_policy, v_basis_version, v_basis_hash,
        v_proposal.source_class, p_support_status
      FROM gov_repo.l15_risk_assessment_proposals AS t
      WHERE t.organisation_id = v_org AND t.proposal_id = p_proposal_id;
      IF NOT v_head_found THEN
        INSERT INTO gov_repo.l15_risk_assessment_heads (organisation_id, governed_risk_state_id, assessment_basis, latest_state_id)
        VALUES (v_org, v_proposal.governed_risk_state_id, v_proposal.assessment_basis, NULL);
      END IF;
      UPDATE gov_repo.l15_risk_assessment_heads AS h SET latest_state_id = v_state
      WHERE h.organisation_id = v_org AND h.governed_risk_state_id = v_proposal.governed_risk_state_id
        AND h.assessment_basis = v_proposal.assessment_basis
        AND h.latest_state_id IS NOT DISTINCT FROM p_expected_current_state_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'L15_STALE_EXPECTATION' USING ERRCODE = 'GV009', DETAIL = 'RISK_ASSESSMENT_STATE_EXPECTATION_MISMATCH';
      END IF;
      IF v_proposal.assessment_basis='RESIDUAL' THEN
        INSERT INTO gov_repo.l15_risk_assessment_state_treatment_pins
          SELECT organisation_id,v_state,treatment_state_id,governed_risk_state_id,treatment_option,treatment_ordinal_key
          FROM gov_repo.l15_risk_assessment_proposal_treatment_pins WHERE organisation_id=v_org AND proposal_id=p_proposal_id;
        INSERT INTO gov_repo.l15_risk_assessment_state_control_assessment_pins
          SELECT organisation_id,v_state,control_assessment_state_id,control_applicability_state_id
          FROM gov_repo.l15_risk_assessment_proposal_control_assessment_pins WHERE organisation_id=v_org AND proposal_id=p_proposal_id;
      END IF;
      PERFORM gov_repo.l15_write_risk_assessment_support_links_v1(v_org, 'STATE', NULL, NULL, v_state,
        p_support_tags, p_support_target_ids);
      INSERT INTO gov_repo.l14_command_results (organisation_id, command_id, command_kind, subject_kind,
        command_fingerprint, actor_user_id, outcome, authorization_decision_id, proposal_id, governance_decision_id,
        l15_state_id, recorded_at)
      VALUES (v_org, p_command_id, 'DECIDE_PROPOSAL', 'RISK_ASSESSMENT', v_fingerprint, v_actor, v_state_kind,
        v_authz, p_proposal_id, v_decision, v_state, v_now);
    ELSE
      -- REJECT / DEFER: governance decision only; no state, no head change.
      INSERT INTO gov_repo.l14_command_results (organisation_id, command_id, command_kind, subject_kind,
        command_fingerprint, actor_user_id, outcome, authorization_decision_id, proposal_id, governance_decision_id, recorded_at)
      VALUES (v_org, p_command_id, 'DECIDE_PROPOSAL', 'RISK_ASSESSMENT', v_fingerprint, v_actor,
        CASE WHEN p_outcome = 'REJECT' THEN 'REJECTED' ELSE 'DEFERRED' END, v_authz, p_proposal_id, v_decision, v_now);
    END IF;
  END IF;

  -- 11. Base session eligibility at commitment (same-transaction final recheck).
  PERFORM 1 FROM gov_repo.l14_session_basis_v1(v_org, v_actor, p_verified_session_iat,
    p_verified_session_exp, p_verified_credential_epoch);
  RETURN QUERY SELECT * FROM gov_repo.l15_risk_assessment_command_result_v1(v_org, p_command_id, false);
END;
$decide$;
CREATE OR REPLACE FUNCTION gov_repo.l15_risk_assessment_valid_state_v1(
  p_organisation_id uuid, p_governed_risk_state_id uuid, p_assessment_basis text,
  p_effective_at timestamptz, p_recorded_cutoff timestamptz)
RETURNS TABLE (state_id uuid, assessment_outcome text, likelihood_level_code text, impact_level_code text, rating_band text,
               methodology_id uuid, methodology_version_id uuid, methodology_content_hash text,
               methodology_validated_state_id uuid, effective_from timestamptz, valid_until timestamptz, recorded_at timestamptz)
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  WITH visible AS (
    SELECT s.state_id, s.state_kind, s.predecessor_state_id, s.effective_from, s.valid_until, s.recorded_at,
           s.assessment_outcome, s.likelihood_level_code, s.impact_level_code, s.rating_band, s.methodology_id,
           s.methodology_version_id, s.methodology_content_hash, s.methodology_validated_state_id
    FROM gov_repo.l15_risk_assessment_states AS s
    WHERE s.organisation_id = p_organisation_id AND s.governed_risk_state_id = p_governed_risk_state_id
      AND s.assessment_basis = p_assessment_basis AND s.recorded_at <= p_recorded_cutoff
  ), candidates AS (
    SELECT v.* FROM visible AS v
    WHERE v.state_kind = 'VALIDATED' AND v.effective_from <= p_effective_at
      AND v.valid_until IS NOT NULL AND p_effective_at < v.valid_until
      AND NOT EXISTS (SELECT 1 FROM visible AS n WHERE n.predecessor_state_id = v.state_id AND n.effective_from <= p_effective_at)
  )
  SELECT c.state_id, c.assessment_outcome, c.likelihood_level_code, c.impact_level_code, c.rating_band, c.methodology_id,
         c.methodology_version_id, c.methodology_content_hash::text, c.methodology_validated_state_id, c.effective_from,
         c.valid_until, c.recorded_at
  FROM candidates AS c
  WHERE (SELECT pg_catalog.count(*) FROM candidates) = 1
    AND (p_assessment_basis='INHERENT' OR NOT EXISTS (SELECT 1 FROM gov_repo.l15_residual_dependency_failure_v1(p_organisation_id,c.state_id,p_effective_at,p_recorded_cutoff)))
    AND gov_repo.l15_governed_risk_state_current_v1(p_organisation_id, p_governed_risk_state_id, p_effective_at, p_recorded_cutoff)
    AND EXISTS (SELECT 1 FROM gov_repo.l15_risk_methodology_valid_state_v1(p_organisation_id, c.methodology_id,
                  c.methodology_version_id, c.methodology_content_hash::text, p_effective_at, p_recorded_cutoff) AS mv
                WHERE mv.state_id = c.methodology_validated_state_id)
$$;
CREATE OR REPLACE FUNCTION gov_repo.l15_risk_assessment_resolution_v1(
  p_organisation_id uuid, p_governed_risk_state_id uuid, p_assessment_basis text,
  p_effective_at timestamptz, p_recorded_cutoff timestamptz)
RETURNS TABLE (resolution text, state_id uuid, state_kind text)
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  WITH visible AS (
    SELECT s.* FROM gov_repo.l15_risk_assessment_states AS s
    WHERE s.organisation_id = p_organisation_id AND s.governed_risk_state_id = p_governed_risk_state_id
      AND s.assessment_basis = p_assessment_basis AND s.recorded_at <= p_recorded_cutoff
  ), latest AS (
    SELECT v.* FROM visible AS v
    WHERE (v.effective_from <= p_effective_at OR v.predecessor_state_id IS NULL)
      AND NOT EXISTS (SELECT 1 FROM visible AS n WHERE n.predecessor_state_id = v.state_id AND n.effective_from <= p_effective_at)
  ), current AS (
    SELECT c.state_id FROM gov_repo.l15_risk_assessment_valid_state_v1(p_organisation_id, p_governed_risk_state_id,
      p_assessment_basis, p_effective_at, p_recorded_cutoff) AS c
  )
  SELECT CASE
           WHEN EXISTS (SELECT 1 FROM current) THEN 'CURRENT'
           WHEN l.state_id IS NULL THEN 'NO_STATE'
           WHEN l.state_kind = 'REVOKED' THEN 'REVOKED'
           WHEN l.effective_from > p_effective_at THEN 'NOT_YET_EFFECTIVE'
           WHEN p_effective_at >= l.valid_until THEN 'EXPIRED'
           WHEN p_assessment_basis='RESIDUAL' THEN 'DEPENDENCY_INVALID'
           WHEN NOT gov_repo.l15_governed_risk_state_current_v1(p_organisation_id, p_governed_risk_state_id, p_effective_at,
                  p_recorded_cutoff) THEN 'GOVERNED_RISK_DEPENDENCY_INVALID'
           ELSE 'METHODOLOGY_DEPENDENCY_INVALID' END,
         COALESCE((SELECT c.state_id FROM current AS c), l.state_id),
         CASE WHEN EXISTS (SELECT 1 FROM current) THEN 'VALIDATED' ELSE l.state_kind END
  FROM (SELECT 1) AS one
  LEFT JOIN LATERAL (SELECT * FROM latest ORDER BY latest.effective_from DESC, latest.recorded_at DESC LIMIT 1) AS l ON true
$$;
CREATE FUNCTION gov_repo.l15_read_risk_assessment_v2(
 p_verified_organisation_id uuid,p_verified_actor_user_id uuid,p_verified_session_iat bigint,p_verified_session_exp bigint,
 p_verified_credential_epoch timestamptz,p_governed_risk_state_id uuid,p_assessment_basis text,p_effective_at timestamptz,p_recorded_cutoff timestamptz)
RETURNS TABLE(assessment_status text,resolution text,dependency_kind text,dependency_id uuid,effective_at timestamptz,recorded_cutoff timestamptz,current_state jsonb)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET lock_timeout='5s' AS $$
DECLARE v_now timestamptz:=clock_timestamp();v_at timestamptz:=coalesce(p_effective_at,v_now);v_cutoff timestamptz:=coalesce(p_recorded_cutoff,v_now);r record;d record;s record;
BEGIN
 PERFORM 1 FROM gov_repo.l14_session_basis_v1(p_verified_organisation_id,p_verified_actor_user_id,p_verified_session_iat,p_verified_session_exp,p_verified_credential_epoch);
 IF p_governed_risk_state_id IS NULL OR p_assessment_basis IS NULL OR p_assessment_basis NOT IN ('INHERENT','RESIDUAL') THEN
 RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE='GV010',DETAIL='ASSESSMENT_READ_KEY_INVALID'; END IF;
 SELECT * INTO r FROM gov_repo.l15_risk_assessment_resolution_v1(p_verified_organisation_id,p_governed_risk_state_id,p_assessment_basis,v_at,v_cutoff);
 SELECT * INTO d FROM gov_repo.l15_residual_dependency_failure_v1(p_verified_organisation_id,r.state_id,v_at,v_cutoff);
 SELECT * INTO s FROM gov_repo.l15_risk_assessment_states WHERE organisation_id=p_verified_organisation_id AND state_id=r.state_id;
 assessment_status:=CASE WHEN r.resolution='CURRENT' THEN s.assessment_outcome ELSE 'UNKNOWN' END;
 resolution:=CASE WHEN r.resolution='CURRENT' THEN 'CURRENT' WHEN r.resolution='EXPIRED' THEN 'EXPIRED'
 WHEN r.resolution LIKE '%DEPENDENCY_INVALID' THEN 'DEPENDENCY_INVALID' ELSE 'ABSENT' END;
 dependency_kind:=CASE WHEN resolution='DEPENDENCY_INVALID' THEN coalesce(d.dependency_kind,
 CASE WHEN r.resolution='GOVERNED_RISK_DEPENDENCY_INVALID' THEN 'GOVERNED_RISK' ELSE 'RISK_METHODOLOGY' END) END;
 dependency_id:=CASE WHEN resolution='DEPENDENCY_INVALID' THEN coalesce(d.dependency_id,
 CASE WHEN r.resolution='GOVERNED_RISK_DEPENDENCY_INVALID' THEN s.governed_risk_state_id ELSE s.methodology_validated_state_id END) END;
 effective_at:=v_at;recorded_cutoff:=v_cutoff;
 IF resolution='CURRENT' THEN current_state:=to_jsonb(s)||jsonb_build_object(
 'treatment_state_ids',ARRAY(SELECT treatment_state_id FROM gov_repo.l15_risk_assessment_state_treatment_pins WHERE organisation_id=p_verified_organisation_id AND state_id=s.state_id ORDER BY treatment_state_id),
 'control_assessment_state_ids',ARRAY(SELECT control_assessment_state_id FROM gov_repo.l15_risk_assessment_state_control_assessment_pins WHERE organisation_id=p_verified_organisation_id AND state_id=s.state_id ORDER BY control_assessment_state_id)); END IF;
 PERFORM 1 FROM gov_repo.l14_session_basis_v1(p_verified_organisation_id,p_verified_actor_user_id,p_verified_session_iat,p_verified_session_exp,p_verified_credential_epoch);
 RETURN NEXT;
END $$;
DO $security$
DECLARE t text;r record;
BEGIN
 FOREACH t IN ARRAY ARRAY['l15_risk_assessment_proposal_treatment_pins','l15_risk_assessment_state_treatment_pins',
 'l15_risk_assessment_proposal_control_assessment_pins','l15_risk_assessment_state_control_assessment_pins'] LOOP
 EXECUTE format('CREATE TRIGGER residual_pin_guard BEFORE INSERT ON gov_repo.%I FOR EACH ROW EXECUTE FUNCTION gov_repo.l15_residual_pin_guard_v1()',t);
 EXECUTE format('CREATE TRIGGER residual_immutable BEFORE UPDATE OR DELETE ON gov_repo.%I FOR EACH ROW EXECUTE FUNCTION gov_repo.l15_history_immutable_v1()',t);
 EXECUTE format('CREATE TRIGGER residual_no_truncate BEFORE TRUNCATE ON gov_repo.%I FOR EACH STATEMENT EXECUTE FUNCTION gov_repo.l15_history_immutable_v1()',t);
 EXECUTE format('ALTER TABLE gov_repo.%I ENABLE ALWAYS TRIGGER residual_pin_guard',t);
 EXECUTE format('ALTER TABLE gov_repo.%I ENABLE ALWAYS TRIGGER residual_immutable',t);
 EXECUTE format('ALTER TABLE gov_repo.%I ENABLE ALWAYS TRIGGER residual_no_truncate',t);
 EXECUTE format('ALTER TABLE gov_repo.%I ENABLE ROW LEVEL SECURITY',t);
 EXECUTE format('REVOKE ALL ON gov_repo.%I FROM PUBLIC,anon,authenticated,service_role,govia_l15_machine_intake_caller',t);
 END LOOP;
 FOR r IN SELECT p.oid::regprocedure sig,p.proname FROM pg_proc p WHERE p.pronamespace='gov_repo'::regnamespace
 AND NOT EXISTS(SELECT 1 FROM m17_s6_routine_snapshot old WHERE old.oid=p.oid) LOOP
 EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role,govia_l15_machine_intake_caller',r.sig);
 IF r.proname IN ('l15_submit_risk_assessment_proposal_v2','l15_read_risk_assessment_v2') THEN EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role',r.sig);END IF;
 END LOOP;
END $security$;
DO $postflight$
BEGIN
 IF EXISTS(SELECT 1 FROM m17_s6_routine_snapshot s JOIN pg_proc p USING(oid)
 WHERE p.proname NOT IN ('l15_decide_risk_assessment_proposal_v1','l15_risk_assessment_valid_state_v1','l15_risk_assessment_resolution_v1')
 AND (s.prosrc,s.proconfig,s.proacl,s.proowner,s.prosecdef) IS DISTINCT FROM (p.prosrc,p.proconfig,p.proacl,p.proowner,p.prosecdef)) THEN
 RAISE EXCEPTION 'M17_S6_POSTFLIGHT: existing authority/M16/v1 surface changed';END IF;
 IF EXISTS(SELECT 1 FROM pg_class c WHERE c.relnamespace='gov_repo'::regnamespace AND c.relname LIKE 'l15_risk_assessment%pins'
 AND (has_table_privilege('service_role',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') OR NOT c.relrowsecurity)) THEN
 RAISE EXCEPTION 'M17_S6_POSTFLIGHT: pin table exposure';END IF;
END $postflight$;
COMMIT;
