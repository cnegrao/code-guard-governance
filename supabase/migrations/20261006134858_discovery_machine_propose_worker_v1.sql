-- Discovery-specific PROPOSE and transactional invocation audit. No HUMAN contract changes.
BEGIN;
CREATE ROLE govia_discovery_propose_owner NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT;
GRANT govia_discovery_control_owner,govia_discovery_intake_owner,govia_discovery_audit_owner,govia_discovery_propose_owner TO postgres WITH INHERIT TRUE, SET TRUE;
GRANT USAGE ON SCHEMA gov_repo,extensions TO govia_discovery_propose_owner;
GRANT CREATE ON SCHEMA gov_repo TO govia_discovery_propose_owner,govia_discovery_audit_owner;
ALTER DEFAULT PRIVILEGES FOR ROLE govia_discovery_propose_owner REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

-- Inaccessible helper: resolves identities itself, never accepts an actor/principal.
-- Exceptions and caller rollbacks still need the worker's fsync'd operational journal.
CREATE FUNCTION gov_repo.discovery_machine_audit_result_v1(p_command text,p_run text,p_result jsonb,p_finding text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $audit$
DECLARE g gov_repo.machine_credential_generations; r gov_repo.discovery_run_bindings;
 original gov_repo.machine_invocation_audit; login_oid oid;
BEGIN
 SELECT oid INTO login_oid FROM pg_catalog.pg_roles WHERE rolname=session_user;
 SELECT * INTO g FROM gov_repo.machine_credential_generations WHERE role_oid=login_oid AND role_name=session_user::text;
 SELECT * INTO r FROM gov_repo.discovery_run_bindings
 WHERE run_id=coalesce(p_run,p_result#>>'{provenance,run_id}') AND principal_id=g.principal_id;
 IF p_result->>'outcome'='REPLAYED' AND p_result ? 'eventId' THEN
  SELECT * INTO original FROM gov_repo.machine_invocation_audit WHERE event_id=p_result->>'eventId'
   AND organisation_id=r.organisation_id AND outcome='APPLIED' ORDER BY recorded_at,invocation_id LIMIT 1;
 END IF;
 INSERT INTO gov_repo.machine_invocation_audit(principal_id,generation_id,role_oid,role_name,binding_id,binding_revision,
 organisation_id,source_connection_id,adapter_name,adapter_version,acquisition_run_id,attempt_run_id,finding_id,subject_id,
 command_id,event_id,source_version,original_binding_id,original_binding_revision,original_generation_id,outcome,denial_code)
 VALUES(g.principal_id,g.generation_id,login_oid,session_user,r.binding_id,r.binding_revision,r.organisation_id,r.source_connection_id,
 r.adapter_name,r.adapter_version,coalesce(original.acquisition_run_id,r.run_id),r.run_id,p_finding,p_result->>'reviewSubjectId',
 coalesce(p_result->>'commandId',p_command),p_result->>'eventId',r.resolved_source_version,
 original.binding_id,original.binding_revision,original.generation_id,p_result->>'outcome',p_result->>'denial_code');
 RETURN p_result;
END;
$audit$;
ALTER FUNCTION gov_repo.discovery_machine_audit_result_v1(text,text,jsonb,text) OWNER TO govia_discovery_audit_owner;
REVOKE ALL ON FUNCTION gov_repo.discovery_machine_audit_result_v1(text,text,jsonb,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION gov_repo.discovery_machine_audit_result_v1(text,text,jsonb,text) TO govia_discovery_intake_owner,govia_discovery_propose_owner;
GRANT SELECT ON gov_repo.machine_credential_generations,gov_repo.discovery_run_bindings TO govia_discovery_audit_owner;
CREATE POLICY discovery_audit_read ON gov_repo.machine_credential_generations FOR SELECT TO govia_discovery_audit_owner USING(true);
CREATE POLICY discovery_audit_read ON gov_repo.discovery_run_bindings FOR SELECT TO govia_discovery_audit_owner USING(true);

CREATE FUNCTION gov_repo.propose_discovery_finding_v1(p_run text,p_finding text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp SET lock_timeout = '5s' AS $propose$
<<machine>>
DECLARE r gov_repo.discovery_run_bindings; auth record; f gov_repo.discovery_findings;
 s gov_repo.review_subjects; e gov_repo.review_audit_events;
 subject_id text; command_id text; event_id text; evidence_ids text[]; previous_evidence text[]; result jsonb;
BEGIN
 IF p_run IS NULL OR p_run COLLATE "C" !~ '^acquisition-run:[0-9a-f-]{36}$'
 OR p_finding IS NULL OR p_finding COLLATE "C" !~ '^discovery-finding:((agent-version|relationship):)?([0-9a-f]{32}|[0-9a-f]{64})$' THEN
  RAISE EXCEPTION 'DISCOVERY_MACHINE_MALFORMED_COMMAND' USING ERRCODE='22023'; END IF;
 SELECT * INTO r FROM gov_repo.discovery_run_bindings WHERE run_id=p_run;
 -- Principal -> organisation -> immutable binding -> run -> subject, including replay.
 SELECT * INTO auth FROM gov_repo.machine_lock_eligibility_v1(r.binding_id,r.binding_revision);
 IF NOT (auth.binding).propose_enabled OR (auth.binding).proposal_rule_code<>'PASS_THROUGH_V1'
 OR (auth.binding).proposal_rule_version<>'1.0' OR r.principal_id IS DISTINCT FROM auth.principal_id
 OR r.organisation_id IS DISTINCT FROM (auth.binding).organisation_id
 OR r.source_connection_id IS DISTINCT FROM (auth.binding).source_connection_id THEN
  RAISE EXCEPTION 'DISCOVERY_MACHINE_DENIED' USING ERRCODE='P0401'; END IF;
 SELECT * INTO r FROM gov_repo.discovery_run_bindings WHERE run_id=p_run FOR SHARE;
 SELECT * INTO f FROM gov_repo.discovery_findings WHERE organisation_id=r.organisation_id AND finding_id=p_finding;
 IF NOT FOUND OR f.source_connection_id IS DISTINCT FROM r.source_connection_id OR f.review_status<>'UNREVIEWED'
 OR NOT EXISTS(SELECT 1 FROM gov_repo.discovery_machine_admissions a WHERE a.run_id=p_run AND a.record_kind='DISCOVERY_FINDING'
  AND a.record_id=p_finding AND a.organisation_id=r.organisation_id AND a.binding_id=r.binding_id AND a.binding_revision=r.binding_revision
  AND a.semantic_digest=gov_repo.discovery_machine_semantic_digest_v1('DISCOVERY_FINDING',f.envelope)) THEN
  RAISE EXCEPTION 'DISCOVERY_MACHINE_DENIED' USING ERRCODE='P0401'; END IF;
 subject_id:='review-subject:discovery:'||pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
  gov_repo.discovery_machine_canonical_json_v1(pg_catalog.jsonb_build_array(r.organisation_id::text,p_finding)),'UTF8')),'hex');
 SELECT * INTO s FROM gov_repo.review_subjects WHERE review_subject_id=subject_id AND organisation_id=r.organisation_id FOR UPDATE;
 IF NOT FOUND OR s.finding_id IS DISTINCT FROM p_finding OR s.source_connection_id IS DISTINCT FROM r.source_connection_id
 OR NOT EXISTS(SELECT 1 FROM gov_repo.discovery_machine_admissions a WHERE a.run_id=p_run AND a.record_kind='REVIEW_SUBJECT' AND a.record_id=subject_id) THEN
  RAISE EXCEPTION 'DISCOVERY_MACHINE_DENIED' USING ERRCODE='P0401'; END IF;
 IF EXISTS(SELECT 1 FROM pg_catalog.jsonb_array_elements_text(f.envelope->'assertionIds') x WHERE NOT EXISTS(
  SELECT 1 FROM gov_repo.discovery_machine_admissions a JOIN gov_repo.review_subject_assertions sa
  ON sa.organisation_id=a.organisation_id AND sa.assertion_id=a.record_id
  WHERE a.run_id=p_run AND a.record_kind='SOURCE_ASSERTION' AND a.record_id=x AND sa.review_subject_id=subject_id))
 OR EXISTS(SELECT 1 FROM pg_catalog.jsonb_array_elements_text(f.envelope->'evidenceIds') x WHERE NOT EXISTS(
  SELECT 1 FROM gov_repo.discovery_machine_admissions a JOIN gov_repo.review_subject_evidence se
  ON se.organisation_id=a.organisation_id AND se.evidence_id=a.record_id
  WHERE a.run_id=p_run AND a.record_kind='EVIDENCE' AND a.record_id=x AND se.review_subject_id=subject_id)) THEN
  RAISE EXCEPTION 'DISCOVERY_MACHINE_DENIED' USING ERRCODE='P0401'; END IF;
 SELECT pg_catalog.array_agg(DISTINCT x ORDER BY x) INTO evidence_ids FROM pg_catalog.jsonb_array_elements_text(f.envelope->'evidenceIds') x;
 IF coalesce(pg_catalog.cardinality(evidence_ids),0)=0 THEN RAISE EXCEPTION 'DISCOVERY_MACHINE_DENIED' USING ERRCODE='P0401'; END IF;
 command_id:='cmd:discovery-intake:propose:'||pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
  gov_repo.discovery_machine_canonical_json_v1(pg_catalog.jsonb_build_array(subject_id,'PASS_THROUGH_V1')),'UTF8')),'hex');
 event_id:='review-transition:'||pg_catalog.substr(pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
  gov_repo.discovery_machine_canonical_json_v1(pg_catalog.jsonb_build_array(subject_id,command_id,'DETECTED','PROPOSED')),'UTF8')),'hex'),1,32);
 -- Entire history, not last_transition_id: HUMAN advancement is never regressed.
 SELECT a.* INTO e FROM gov_repo.review_audit_events a WHERE a.organisation_id=r.organisation_id
  AND a.review_subject_id=subject_id AND a.command_id=machine.command_id;
 IF FOUND THEN
  SELECT pg_catalog.array_agg(a.evidence_id ORDER BY a.evidence_id) INTO previous_evidence FROM gov_repo.review_audit_event_evidence a WHERE a.event_id=e.event_id;
  IF e.event_id IS DISTINCT FROM event_id OR e.finding_id IS DISTINCT FROM p_finding OR e.previous_state<>'DETECTED' OR e.new_state<>'PROPOSED'
   OR e.actor_kind<>'DETERMINISTIC_RULE' OR e.actor_reference IS NOT NULL OR e.actor_rule_code<>'PASS_THROUGH_V1'
   OR e.actor_rule_version<>'1.0' OR e.reason_code IS NOT NULL OR previous_evidence IS DISTINCT FROM evidence_ids THEN
   RAISE EXCEPTION 'DISCOVERY_MACHINE_CONTENT_CONFLICT' USING ERRCODE='P0402'; END IF;
  result:=pg_catalog.jsonb_build_object('outcome','REPLAYED','reviewSubjectId',subject_id,'eventId',event_id,'commandId',command_id,'currentState',s.state);
 ELSIF s.state<>'DETECTED' THEN
  result:=pg_catalog.jsonb_build_object('outcome','STATE_CONFLICT','currentState',s.state);
 ELSE
  PERFORM gov_repo.apply_review_transition(r.organisation_id,subject_id,p_finding,'DETECTED','PROPOSED','DETERMINISTIC_RULE',
   NULL::text,'PASS_THROUGH_V1','1.0',pg_catalog.clock_timestamp(),evidence_ids,NULL::text,command_id,event_id);
  result:=pg_catalog.jsonb_build_object('outcome','APPLIED','reviewSubjectId',subject_id,'eventId',event_id,'commandId',command_id,'currentState','PROPOSED');
 END IF;
 SELECT * INTO auth FROM gov_repo.machine_lock_eligibility_v1(r.binding_id,r.binding_revision);
 RETURN gov_repo.discovery_machine_audit_result_v1('PROPOSE',p_run,result,p_finding);
EXCEPTION WHEN SQLSTATE 'P0401' OR insufficient_privilege THEN
 IF SQLSTATE='42501' AND SQLERRM NOT IN ('S2_CREDENTIAL_INELIGIBLE','S2_SCOPE_INELIGIBLE') THEN RAISE; END IF;
 RETURN gov_repo.discovery_machine_audit_result_v1('PROPOSE',p_run,'{"outcome":"DENIED","denial_code":"SUPPORT_NOT_ADMITTED"}'::jsonb,NULL);
 WHEN SQLSTATE 'P0402' THEN
 RETURN gov_repo.discovery_machine_audit_result_v1('PROPOSE',p_run,'{"outcome":"CONTENT_CONFLICT"}'::jsonb,p_finding);
END;
$propose$;
ALTER FUNCTION gov_repo.propose_discovery_finding_v1(text,text) OWNER TO govia_discovery_propose_owner;
REVOKE ALL ON FUNCTION gov_repo.propose_discovery_finding_v1(text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION gov_repo.propose_discovery_finding_v1(text,text) TO govia_discovery_machine_caller;
GRANT EXECUTE ON FUNCTION gov_repo.machine_lock_eligibility_v1(uuid,bigint),
 gov_repo.discovery_machine_canonical_json_v1(jsonb),gov_repo.discovery_machine_semantic_digest_v1(text,jsonb),
 gov_repo.apply_review_transition(uuid,text,text,text,text,text,text,text,text,timestamptz,text[],text,text,text) TO govia_discovery_propose_owner;
DO $grants$
DECLARE t text;
BEGIN
 FOREACH t IN ARRAY ARRAY['discovery_run_bindings','discovery_machine_admissions','discovery_findings','review_subjects',
 'review_subject_assertions','review_subject_evidence','review_audit_events','review_audit_event_evidence'] LOOP
  EXECUTE pg_catalog.format('GRANT SELECT ON gov_repo.%I TO govia_discovery_propose_owner',t);
  EXECUTE pg_catalog.format('CREATE POLICY discovery_propose_read ON gov_repo.%I FOR SELECT TO govia_discovery_propose_owner USING(true)',t);
 END LOOP;
 FOREACH t IN ARRAY ARRAY['review_audit_events','review_audit_event_evidence','outbox_events'] LOOP
  EXECUTE pg_catalog.format('GRANT INSERT ON gov_repo.%I TO govia_discovery_propose_owner',t);
  EXECUTE pg_catalog.format('CREATE POLICY discovery_propose_insert ON gov_repo.%I FOR INSERT TO govia_discovery_propose_owner WITH CHECK(true)',t);
 END LOOP;
END;
$grants$;
GRANT UPDATE(state,last_transition_id,revision) ON gov_repo.review_subjects TO govia_discovery_propose_owner;
GRANT UPDATE(conclusion_status) ON gov_repo.discovery_run_bindings TO govia_discovery_propose_owner;
CREATE POLICY discovery_propose_run_lock ON gov_repo.discovery_run_bindings FOR UPDATE TO govia_discovery_propose_owner USING(true) WITH CHECK(false);
CREATE POLICY discovery_propose_update ON gov_repo.review_subjects FOR UPDATE TO govia_discovery_propose_owner USING(true)
 WITH CHECK(state='PROPOSED');

-- Add audit to the ten closed S3 commands, including successful restricted reads.
-- Fixed migration-time census only; no dynamic SQL is reachable by a machine.
GRANT SELECT ON gov_repo.machine_invocation_audit TO govia_discovery_intake_owner;
CREATE POLICY discovery_intake_audit_count ON gov_repo.machine_invocation_audit FOR SELECT TO govia_discovery_intake_owner USING(true);
DO $completion$
DECLARE body text;
BEGIN
 SELECT prosrc INTO body FROM pg_catalog.pg_proc WHERE oid='gov_repo.discovery_machine_complete_run_v1(text,text,jsonb,timestamptz,text)'::regprocedure;
 IF pg_catalog.strpos(body,'OR p_counts->>''proposalsCreated''<>''0''')=0 THEN RAISE EXCEPTION 'S4_COMPLETION_BASELINE_MISMATCH'; END IF;
 body:=pg_catalog.replace(body,'OR p_counts->>''proposalsCreated''<>''0''','');
 body:=pg_catalog.replace(body,'v_run:=gov_repo.discovery_machine_lock_run_v1(p_run,true);',$check$
 v_run:=gov_repo.discovery_machine_lock_run_v1(p_run,true);
 -- Report only committed machine proposals for this exact attempt, never a caller claim.
 IF (p_counts->>'proposalsCreated')::int IS DISTINCT FROM (SELECT count(*) FROM gov_repo.machine_invocation_audit a
  WHERE a.attempt_run_id=p_run AND a.organisation_id=v_run.organisation_id AND a.outcome='APPLIED' AND a.event_id IS NOT NULL) THEN
  RAISE EXCEPTION 'DISCOVERY_MACHINE_PROPOSAL_COUNT_MISMATCH' USING ERRCODE='22023'; END IF;
 $check$);
 body:=pg_catalog.replace(body,'proposals_created=0','proposals_created=(p_counts->>''proposalsCreated'')::int');
 EXECUTE pg_catalog.format('CREATE OR REPLACE FUNCTION gov_repo.discovery_machine_complete_run_v1(p_run text,p_status text,p_counts jsonb,p_completed timestamptz,p_failure text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET lock_timeout=''5s'' AS %L',body);
END;
$completion$;
DO $intake_audit$
DECLARE f record; body text; run_expression text;
BEGIN
 FOR f IN SELECT p.*,p.oid::regprocedure AS sig FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='gov_repo' AND p.prosecdef AND p.proowner='govia_discovery_intake_owner'::regrole LOOP
  run_expression:=CASE WHEN f.proname='discovery_machine_open_run_v1' THEN 'NULL::text' ELSE 'p_run' END;
  body:=pg_catalog.regexp_replace(f.prosrc,'RETURN ([^;]+);',
   'RETURN gov_repo.discovery_machine_audit_result_v1('||pg_catalog.quote_literal(f.proname)||','||run_expression||',\1,NULL::text);','g');
  EXECUTE pg_catalog.format('CREATE OR REPLACE FUNCTION %s(%s) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET lock_timeout=''5s'' AS %L',
   'gov_repo.'||pg_catalog.quote_ident(f.proname),pg_catalog.pg_get_function_arguments(f.oid),body);
 END LOOP;
END;
$intake_audit$;

-- Extend the machine-only attestation. Frozen HUMAN routine bodies/census are untouched.
DO $certify$
DECLARE cert text; body text; boundary integer;
BEGIN
 SELECT pg_catalog.string_agg(pg_catalog.format('(%s::oid,%L::name,%L::oidvector,%s::oid,%L::text)',p.oid,p.proname,p.proargtypes,p.proowner,
 pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.pg_get_functiondef(p.oid),'UTF8')),'hex')),',' ORDER BY p.proname)
 INTO cert FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='gov_repo' AND p.prosecdef AND p.proowner IN ('govia_discovery_intake_owner'::regrole,'govia_discovery_propose_owner'::regrole);
 SELECT p.prosrc INTO body FROM pg_catalog.pg_proc p WHERE p.oid='gov_repo.machine_role_safe_v1(oid,text)'::regprocedure;
 boundary:=pg_catalog.strpos(body,'   AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc');
 IF boundary=0 THEN RAISE EXCEPTION 'S4_ATTESTATION_BASELINE_MISMATCH'; END IF;
 body:=pg_catalog.substr(body,1,boundary-1)||pg_catalog.format($clause$
 AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname NOT IN ('pg_catalog','information_schema','gov_repo') AND n.nspname NOT LIKE 'pg_%%'
 AND c.relkind IN ('r','v','m','p') AND (pg_catalog.has_table_privilege(r.oid,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN')
 OR pg_catalog.has_any_column_privilege(r.oid,c.oid,'SELECT,INSERT,UPDATE,REFERENCES')))
 AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname NOT IN ('pg_catalog','information_schema','gov_repo') AND n.nspname NOT LIKE 'pg_%%'
 AND p.prosecdef AND pg_catalog.has_schema_privilege(r.oid,n.oid,'USAGE') AND pg_catalog.has_function_privilege(r.oid,p.oid,'EXECUTE'))
 AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='gov_repo' AND pg_catalog.has_function_privilege(r.oid,p.oid,'EXECUTE') AND NOT EXISTS(
 SELECT 1 FROM (VALUES %s) certified(proc_oid,proc_name,argtypes,owner_oid,definition_hash)
 WHERE p.oid=certified.proc_oid AND p.proname=certified.proc_name AND p.proargtypes=certified.argtypes AND p.proowner=certified.owner_oid AND p.prosecdef
 AND pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.pg_get_functiondef(p.oid),'UTF8')),'hex')=certified.definition_hash)));
 $clause$,cert);
 EXECUTE pg_catalog.format('CREATE OR REPLACE FUNCTION gov_repo.machine_role_safe_v1(p_oid oid,p_name text) RETURNS boolean LANGUAGE sql STABLE SET search_path=pg_catalog,pg_temp AS %L',body);
END;
$certify$;
REVOKE CREATE ON SCHEMA gov_repo FROM govia_discovery_propose_owner,govia_discovery_audit_owner;
REVOKE govia_discovery_control_owner,govia_discovery_intake_owner,govia_discovery_audit_owner,govia_discovery_propose_owner FROM postgres;
DO $postflight$
BEGIN
 IF pg_catalog.has_function_privilege('govia_discovery_machine_caller','gov_repo.apply_review_transition(uuid,text,text,text,text,text,text,text,text,timestamptz,text[],text,text,text)','EXECUTE')
 OR pg_catalog.has_function_privilege('service_role','gov_repo.apply_review_transition(uuid,text,text,text,text,text,text,text,text,timestamptz,text[],text,text,text)','EXECUTE')
 OR (SELECT count(*) FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='gov_repo'
  AND pg_catalog.has_function_privilege('govia_discovery_machine_caller',p.oid,'EXECUTE'))<>11 THEN RAISE EXCEPTION 'S4_CALLER_SURFACE'; END IF;
 IF (SELECT count(*) FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='gov_repo' AND p.prosecdef
  AND (pg_catalog.has_function_privilege('service_role',p.oid,'EXECUTE') OR pg_catalog.has_function_privilege('anon',p.oid,'EXECUTE')
   OR pg_catalog.has_function_privilege('authenticated',p.oid,'EXECUTE')))<>22 THEN RAISE EXCEPTION 'S4_HUMAN_SURFACE'; END IF;
END;
$postflight$;
COMMIT;
