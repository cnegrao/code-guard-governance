-- M3 / D2 + D3 only. No population, application writer, hosted access or authority.
-- Identities/document recipe remain unchanged. Existing observations are never rewritten.
BEGIN;
SET LOCAL search_path=pg_catalog,pg_temp;

DO $baseline$
BEGIN
 IF current_user<>'postgres' OR current_setting('server_encoding')<>'UTF8'
  OR current_setting('server_version_num')::integer NOT BETWEEN 170000 AND 179999
  OR to_regclass('gov_repo.sr2_operational_disclosure_heads_v1') IS NOT NULL
 THEN RAISE EXCEPTION 'SR2_M3_UNTRUSTED_BASELINE' USING ERRCODE='55000'; END IF;
END
$baseline$;

-- Exact owner-approved SAFE corpus. PostgreSQL UTF8 text already excludes malformed
-- encodings and U+0000. No collation classes, normalization, trimming or substitution.
CREATE FUNCTION gov_repo.sr2_operational_safe_v1(value text,max_bytes integer) RETURNS boolean
LANGUAGE plpgsql SECURITY INVOKER IMMUTABLE PARALLEL SAFE CALLED ON NULL INPUT
SET search_path=pg_catalog,pg_temp AS $safe$
DECLARE cp integer; i integer; has_content boolean:=false;
BEGIN
 IF value IS NULL OR max_bytes IS NULL OR max_bytes NOT IN (512,1024)
  OR octet_length(value) NOT BETWEEN 1 AND max_bytes THEN RETURN false; END IF;
 FOR i IN 1..char_length(value) LOOP
  cp:=ascii(substr(value,i,1));
  IF cp BETWEEN 1 AND 31 OR cp BETWEEN 127 AND 159 OR cp IN (173,1564,6158,65279)
   OR cp BETWEEN 8203 AND 8207 OR cp BETWEEN 8232 AND 8238
   OR cp BETWEEN 8288 AND 8292 OR cp BETWEEN 8294 AND 8297 THEN RETURN false; END IF;
  IF NOT (cp IN (9,10,11,12,13,32,160,5760,8239,8287,12288) OR cp BETWEEN 8192 AND 8202)
   THEN has_content:=true; END IF;
 END LOOP;
 RETURN has_content;
END
$safe$;

-- Conservative M3 writer serialization: one global A3 barrier, acquired by BEFORE
-- STATEMENT triggers, before any D/O row lock, including empty/absent scopes.
-- Future A4 writers must preserve this order. Legacy tables acquire no SR2 locks.
CREATE FUNCTION gov_repo.sr2_operational_scope_lock_v1() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER VOLATILE PARALLEL UNSAFE CALLED ON NULL INPUT
SET search_path=pg_catalog,pg_temp AS $scope$
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN
  RAISE EXCEPTION 'SR2_OPERATIONAL_READ_COMMITTED_REQUIRED' USING ERRCODE='25001'; END IF;
 PERFORM pg_advisory_xact_lock(175003,1);
 RETURN NULL;
END
$scope$;

CREATE TABLE gov_repo.sr2_operational_disclosure_admissions_v1 (
 organisation_id uuid NOT NULL REFERENCES gov_repo.organisations(organisation_id),
 purpose_code text COLLATE "C" NOT NULL,
 scope_kind text COLLATE "C" NOT NULL,
 source_record_id uuid NOT NULL,
 disclosure_admission_id uuid NOT NULL,
 handling_recipe_id text COLLATE "C" NOT NULL,
 handling_recipe_version text COLLATE "C" NOT NULL,
 document_recipe text COLLATE "C" NOT NULL,
 policy_basis_reference text COLLATE "C" NOT NULL,
 admitted_after_revision bigint NOT NULL CHECK(admitted_after_revision>=0),
 recorded_at timestamptz NOT NULL,
 PRIMARY KEY(organisation_id,purpose_code,scope_kind,source_record_id,disclosure_admission_id),
 CHECK (purpose_code='OPERATIONAL_AGENT_CONTEXT_V1'),
 CHECK ((scope_kind='ORGANISATION' AND source_record_id='00000000-0000-0000-0000-000000000000'::uuid) OR scope_kind='SOURCE'),
 CHECK (handling_recipe_id='GOVIA_SR2_OPERATIONAL_HANDLING_V1' AND handling_recipe_version='1' AND document_recipe='GOVIA_OPERATIONAL_CONTEXT_V1'),
 CHECK (gov_repo.sr2_operational_safe_v1(policy_basis_reference,512)),
 CHECK (isfinite(recorded_at))
);
CREATE TABLE gov_repo.sr2_operational_disclosure_heads_v1 (
 organisation_id uuid NOT NULL REFERENCES gov_repo.organisations(organisation_id),
 purpose_code text COLLATE "C" NOT NULL,
 scope_kind text COLLATE "C" NOT NULL,
 source_record_id uuid NOT NULL,
 disclosure_admission_id uuid,
 enabled boolean NOT NULL,
 head_revision bigint NOT NULL,
 changed_at timestamptz NOT NULL,
 PRIMARY KEY(organisation_id,purpose_code,scope_kind,source_record_id),
 FOREIGN KEY(organisation_id,purpose_code,scope_kind,source_record_id,disclosure_admission_id)
  REFERENCES gov_repo.sr2_operational_disclosure_admissions_v1
   (organisation_id,purpose_code,scope_kind,source_record_id,disclosure_admission_id),
 CHECK (purpose_code='OPERATIONAL_AGENT_CONTEXT_V1'),
 CHECK ((scope_kind='ORGANISATION' AND source_record_id='00000000-0000-0000-0000-000000000000'::uuid) OR scope_kind='SOURCE'),
 CHECK (NOT enabled OR disclosure_admission_id IS NOT NULL),
 CHECK (head_revision>=1),
 CHECK (isfinite(changed_at))
);
ALTER TABLE gov_repo.sr2_operational_disclosure_admissions_v1 ENABLE ROW LEVEL SECURITY;
ALTER TABLE gov_repo.sr2_operational_disclosure_heads_v1 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON gov_repo.sr2_operational_disclosure_admissions_v1,gov_repo.sr2_operational_disclosure_heads_v1 FROM PUBLIC,anon,authenticated,service_role;
COMMENT ON TABLE gov_repo.sr2_operational_disclosure_admissions_v1 IS 'Owner-recorded disclosure basis only; not governance authority or semantic truth.';
COMMENT ON TABLE gov_repo.sr2_operational_disclosure_heads_v1 IS 'Durable disclosure denial, independently committable before dependent-head repair. Organisation permission required; optional SOURCE restriction intersects it.';

CREATE FUNCTION gov_repo.sr2_operational_disclosure_guard_v1() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER VOLATILE PARALLEL UNSAFE CALLED ON NULL INPUT
SET search_path=pg_catalog,pg_temp AS $disclosure$
DECLARE admitted_at timestamptz; admitted_revision bigint;
BEGIN
 IF TG_TABLE_NAME='sr2_operational_disclosure_admissions_v1' THEN
  SELECT h.head_revision INTO admitted_revision FROM gov_repo.sr2_operational_disclosure_heads_v1 h
   WHERE h.organisation_id=NEW.organisation_id AND h.purpose_code=NEW.purpose_code
    AND h.scope_kind=NEW.scope_kind AND h.source_record_id=NEW.source_record_id FOR SHARE;
  NEW.admitted_after_revision:=coalesce(admitted_revision,0);
  NEW.recorded_at:=clock_timestamp(); RETURN NEW;
 END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.head_revision<>1 THEN RAISE EXCEPTION 'SR2_DISCLOSURE_INITIAL_REVISION' USING ERRCODE='23514'; END IF;
 ELSE
  IF ROW(NEW.organisation_id,NEW.purpose_code,NEW.scope_kind,NEW.source_record_id)
   IS DISTINCT FROM ROW(OLD.organisation_id,OLD.purpose_code,OLD.scope_kind,OLD.source_record_id) THEN
   RAISE EXCEPTION 'SR2_DISCLOSURE_IMMUTABLE_KEY' USING ERRCODE='23514'; END IF;
  IF OLD.head_revision=9223372036854775807 OR NEW.head_revision IS DISTINCT FROM OLD.head_revision+1 THEN
   RAISE EXCEPTION 'SR2_DISCLOSURE_REVISION_TRANSITION' USING ERRCODE='23514'; END IF;
  IF ROW(NEW.disclosure_admission_id,NEW.enabled) IS NOT DISTINCT FROM ROW(OLD.disclosure_admission_id,OLD.enabled) THEN
   RAISE EXCEPTION 'SR2_DISCLOSURE_NO_OP' USING ERRCODE='23514'; END IF;
 END IF;
 IF NEW.enabled THEN
  SELECT a.recorded_at,a.admitted_after_revision INTO admitted_at,admitted_revision FROM gov_repo.sr2_operational_disclosure_admissions_v1 a
   WHERE a.organisation_id=NEW.organisation_id AND a.purpose_code=NEW.purpose_code
    AND a.scope_kind=NEW.scope_kind AND a.source_record_id=NEW.source_record_id
    AND a.disclosure_admission_id=NEW.disclosure_admission_id FOR SHARE;
  IF admitted_at IS NULL THEN RAISE EXCEPTION 'SR2_DISCLOSURE_ADMISSION_REQUIRED' USING ERRCODE='23514'; END IF;
  IF (TG_OP='INSERT' AND admitted_revision<>0) OR (TG_OP='UPDATE' AND admitted_revision<>OLD.head_revision) THEN
   RAISE EXCEPTION 'SR2_DISCLOSURE_FRESH_ADMISSION_REQUIRED' USING ERRCODE='23514'; END IF;
  IF TG_OP='UPDATE' AND (NOT OLD.enabled OR NEW.disclosure_admission_id IS DISTINCT FROM OLD.disclosure_admission_id)
   AND NEW.disclosure_admission_id IS NOT DISTINCT FROM OLD.disclosure_admission_id THEN
   RAISE EXCEPTION 'SR2_DISCLOSURE_FRESH_ADMISSION_REQUIRED' USING ERRCODE='23514'; END IF;
 END IF;
 NEW.changed_at:=clock_timestamp();
 RETURN NEW;
END
$disclosure$;

-- Admission lock order: global A3 statement barrier -> broad D -> optional SOURCE D
-- -> live agent -> its related system. Source rows are SHARE-locked until commit.
CREATE FUNCTION gov_repo.sr2_operational_binding_v1(o gov_repo.sr2_operational_agent_observations_v1) RETURNS void
LANGUAGE plpgsql SECURITY INVOKER VOLATILE PARALLEL UNSAFE CALLED ON NULL INPUT
SET search_path=pg_catalog,pg_temp AS $binding$
DECLARE a gov_repo.agents; s gov_repo.ai_systems; d gov_repo.sr2_operational_disclosure_heads_v1; fingerprint text;
BEGIN
 SELECT h.* INTO d FROM gov_repo.sr2_operational_disclosure_heads_v1 h
  WHERE h.organisation_id=o.organisation_id AND h.purpose_code='OPERATIONAL_AGENT_CONTEXT_V1'
   AND h.scope_kind='ORGANISATION' AND h.source_record_id='00000000-0000-0000-0000-000000000000'::uuid FOR SHARE;
 IF NOT FOUND OR NOT d.enabled THEN RAISE EXCEPTION 'SR2_OPERATIONAL_DISCLOSURE_DENIED' USING ERRCODE='23514'; END IF;
 PERFORM 1 FROM gov_repo.sr2_operational_disclosure_admissions_v1 b
  WHERE b.organisation_id=d.organisation_id AND b.purpose_code=d.purpose_code AND b.scope_kind=d.scope_kind
   AND b.source_record_id=d.source_record_id AND b.disclosure_admission_id=d.disclosure_admission_id
   AND b.admitted_after_revision=d.head_revision-1 AND b.handling_recipe_id=o.handling_recipe_id
   AND b.handling_recipe_version=o.handling_recipe_version AND b.document_recipe=o.document_recipe;
 IF NOT FOUND THEN RAISE EXCEPTION 'SR2_OPERATIONAL_DISCLOSURE_DENIED' USING ERRCODE='23514'; END IF;
 SELECT h.* INTO d FROM gov_repo.sr2_operational_disclosure_heads_v1 h
  WHERE h.organisation_id=o.organisation_id AND h.purpose_code='OPERATIONAL_AGENT_CONTEXT_V1'
   AND h.scope_kind='SOURCE' AND h.source_record_id=o.source_record_id FOR SHARE;
 IF FOUND THEN
  IF NOT d.enabled THEN RAISE EXCEPTION 'SR2_OPERATIONAL_DISCLOSURE_DENIED' USING ERRCODE='23514'; END IF;
  PERFORM 1 FROM gov_repo.sr2_operational_disclosure_admissions_v1 b
   WHERE b.organisation_id=d.organisation_id AND b.purpose_code=d.purpose_code AND b.scope_kind=d.scope_kind
    AND b.source_record_id=d.source_record_id AND b.disclosure_admission_id=d.disclosure_admission_id
    AND b.admitted_after_revision=d.head_revision-1 AND b.handling_recipe_id=o.handling_recipe_id
    AND b.handling_recipe_version=o.handling_recipe_version AND b.document_recipe=o.document_recipe;
  IF NOT FOUND THEN RAISE EXCEPTION 'SR2_OPERATIONAL_DISCLOSURE_DENIED' USING ERRCODE='23514'; END IF;
 END IF;
 SELECT live.* INTO a FROM gov_repo.agents live
  WHERE live.organisation_id=o.organisation_id AND live.agent_id=o.source_record_id FOR SHARE;
 IF NOT FOUND OR a.status NOT IN ('active','approved') THEN
  RAISE EXCEPTION 'SR2_OPERATIONAL_SOURCE_UNAVAILABLE' USING ERRCODE='23514'; END IF;
 IF a.ai_system_id IS NOT NULL THEN
  SELECT live.* INTO s FROM gov_repo.ai_systems live
   WHERE live.organisation_id=o.organisation_id AND live.system_id=a.ai_system_id FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'SR2_OPERATIONAL_SOURCE_UNAVAILABLE' USING ERRCODE='23514'; END IF;
 END IF;
 -- BINDING_PREDICATE is expanded below from the same frozen expression as the read.
 IF (o.handling_recipe_id='GOVIA_SR2_OPERATIONAL_HANDLING_V1' AND o.handling_recipe_version='1'
  AND o.projection_recipe_id='GOVIA_SR2_OPERATIONAL_AGENT_PROJECTION_V1' AND o.projection_recipe_version='1' AND o.document_recipe='GOVIA_OPERATIONAL_CONTEXT_V1'
  AND o.agent_code_label IS NOT DISTINCT FROM a.agent_code::text COLLATE "C"
  AND o.agent_name_label IS NOT DISTINCT FROM a.name::text COLLATE "C" AND o.agent_type IS NOT DISTINCT FROM a.agent_type
  AND o.business_domain_label IS NOT DISTINCT FROM a.business_domain::text COLLATE "C"
  AND gov_repo.sr2_operational_safe_v1(o.agent_code_label,512) AND gov_repo.sr2_operational_safe_v1(o.agent_name_label,512)
  AND gov_repo.sr2_operational_safe_v1(o.agent_type::text,512)
  AND (o.business_domain_label IS NULL OR gov_repo.sr2_operational_safe_v1(o.business_domain_label,512))
  AND gov_repo.sr2_operational_safe_v1(o.acquisition_method_code,512) AND gov_repo.sr2_operational_safe_v1(o.acquisition_method_version,512)
  AND gov_repo.sr2_operational_safe_v1(o.projection_schema_version,512)
  AND ((o.description_disposition='WITHHELD' AND o.description_text IS NULL) OR
   (o.description_disposition='PROJECTED' AND o.description_text IS NOT DISTINCT FROM a.description COLLATE "C" AND gov_repo.sr2_operational_safe_v1(o.description_text,1024)))
  AND ((a.ai_system_id IS NULL AND o.related_system_state='ABSENT' AND o.related_system_record_id IS NULL
   AND o.related_system_code_label IS NULL AND o.related_system_name_label IS NULL) OR
   (a.ai_system_id IS NOT NULL AND s.organisation_id=o.organisation_id AND o.related_system_state='PRESENT_SAME_TENANT'
   AND o.related_system_record_id=a.ai_system_id AND o.related_system_record_id=s.system_id
   AND o.related_system_code_label IS NOT DISTINCT FROM s.system_code::text COLLATE "C"
   AND o.related_system_name_label IS NOT DISTINCT FROM s.name::text COLLATE "C"
   AND gov_repo.sr2_operational_safe_v1(o.related_system_code_label,512) AND gov_repo.sr2_operational_safe_v1(o.related_system_name_label,512)))) IS NOT TRUE THEN
  RAISE EXCEPTION 'SR2_OPERATIONAL_SOURCE_BINDING' USING ERRCODE='23514'; END IF;
 fingerprint:=encode(sha256(convert_to(gov_repo.frame_identity(ARRAY[
  'GOVIA_SR2_OPERATIONAL_AGENT_SOURCE_DESCRIPTOR_V1',o.organisation_id::text,'LEGACY_AGENT_RECORD',a.agent_id::text,a.agent_code::text,a.name::text,a.description,a.agent_type::text,
  CASE WHEN a.business_domain IS NULL THEN 'BUSINESS_DOMAIN_ABSENT' ELSE 'BUSINESS_DOMAIN_PRESENT' END,coalesce(a.business_domain::text,''),
  CASE WHEN a.ai_system_id IS NULL THEN 'RELATED_SYSTEM_ABSENT' ELSE 'RELATED_SYSTEM_PRESENT_SAME_TENANT' END,coalesce(a.ai_system_id::text,''),
  CASE WHEN a.ai_system_id IS NULL THEN '' ELSE s.organisation_id::text END,coalesce(s.system_code::text,''),coalesce(s.name::text,'')]),'UTF8')),'hex');
 IF fingerprint IS DISTINCT FROM o.source_descriptor_fingerprint THEN
  RAISE EXCEPTION 'SR2_OPERATIONAL_SOURCE_CHANGED' USING ERRCODE='23514'; END IF;
END
$binding$;
CREATE FUNCTION gov_repo.sr2_operational_observation_admit_v1() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER VOLATILE PARALLEL UNSAFE CALLED ON NULL INPUT
SET search_path=pg_catalog,pg_temp AS $admit$
BEGIN
 PERFORM gov_repo.sr2_operational_binding_v1(NEW);
 RETURN NEW;
END
$admit$;

-- Successor routines, triggers, exact ACLs and postflight are appended below.

DO $routines$
DECLARE v_ext name; v_oid oid; v_before jsonb; v_head_before jsonb;
BEGIN
 SELECT n.nspname INTO STRICT v_ext FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace WHERE e.extname='vector' AND e.extversion='0.8.7';
 SELECT p.oid,to_jsonb(p)-'prosrc' INTO STRICT v_oid,v_before FROM pg_proc p WHERE p.pronamespace='gov_repo'::regnamespace AND p.proname='operational_agent_semantic_context_search_v1';
 SELECT to_jsonb(p)-'prosrc' INTO STRICT v_head_before FROM pg_proc p WHERE p.oid='gov_repo.sr2_operational_agent_head_guard_v1()'::regprocedure;
 IF (SELECT pg_get_userbyid(proowner)<>'postgres' OR NOT prosecdef OR provolatile<>'v' OR proparallel<>'u'
   OR prorettype<>'jsonb'::regtype OR proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, pg_temp','lock_timeout=5s']
   FROM pg_proc WHERE oid=v_oid)
  OR EXISTS(SELECT FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
   WHERE p.oid=v_oid AND (a.privilege_type<>'EXECUTE' OR a.is_grantable OR a.grantee NOT IN ('postgres'::regrole,'service_role'::regrole)))
  OR NOT has_function_privilege('service_role',v_oid,'EXECUTE')
  OR has_function_privilege('anon',v_oid,'EXECUTE') OR has_function_privilege('authenticated',v_oid,'EXECUTE')
  OR (SELECT pg_get_userbyid(proowner)<>'postgres' OR prosecdef OR provolatile<>'v' OR proparallel<>'u'
   OR proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, pg_temp']
   FROM pg_proc WHERE oid='gov_repo.sr2_operational_agent_head_guard_v1()'::regprocedure)
  OR EXISTS(SELECT FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
   WHERE p.oid='gov_repo.sr2_operational_agent_head_guard_v1()'::regprocedure AND a.grantee<>'postgres'::regrole)
  OR EXISTS(SELECT FROM unnest(ARRAY['anon','authenticated','service_role']) r WHERE has_schema_privilege(r,v_ext,'CREATE'))
 THEN RAISE EXCEPTION 'SR2_M3_STARTING_CAPABILITY_DRIFT' USING ERRCODE='55000'; END IF;
 IF (SELECT encode(sha256(convert_to(replace(replace(prosrc,chr(13),''),quote_ident(v_ext)||'.','__vector__.'),'UTF8')),'hex') FROM pg_proc WHERE oid=v_oid)<>'3a72fbf08fb9fb220ff4e090c6c9e7807729c75ebca8604f6d4331dbf70567da'
  OR (SELECT encode(sha256(convert_to(replace(prosrc,chr(13),''),'UTF8')),'hex') FROM pg_proc WHERE oid='gov_repo.sr2_operational_agent_head_guard_v1()'::regprocedure)<>'ba6470402d053f4c0a0fdea614a9a38acc3b51ed620475042cb46c2bf9770944'
 THEN RAISE EXCEPTION 'SR2_M3_STARTING_BODY_DRIFT' USING ERRCODE='55000'; END IF;
 EXECUTE $head$CREATE OR REPLACE FUNCTION gov_repo.sr2_operational_agent_head_guard_v1() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER VOLATILE PARALLEL UNSAFE CALLED ON NULL INPUT
SET search_path=pg_catalog,pg_temp AS $guard$
DECLARE o gov_repo.sr2_operational_agent_observations_v1;
BEGIN
 IF TG_OP='INSERT' THEN
  IF NEW.head_revision<>1 THEN RAISE EXCEPTION 'SR2_OPERATIONAL_HEAD_INITIAL_REVISION' USING ERRCODE='23514'; END IF;
 ELSE
  IF NEW.organisation_id IS DISTINCT FROM OLD.organisation_id OR NEW.source_record_id IS DISTINCT FROM OLD.source_record_id
   OR NEW.purpose_code IS DISTINCT FROM OLD.purpose_code THEN
   RAISE EXCEPTION 'SR2_OPERATIONAL_HEAD_IMMUTABLE_KEY' USING ERRCODE='23514'; END IF;
  IF OLD.head_revision=9223372036854775807 OR NEW.head_revision IS DISTINCT FROM OLD.head_revision+1 THEN
   RAISE EXCEPTION 'SR2_OPERATIONAL_HEAD_REVISION_TRANSITION' USING ERRCODE='23514'; END IF;
  IF ROW(NEW.observation_id,NEW.enabled) IS NOT DISTINCT FROM ROW(OLD.observation_id,OLD.enabled) THEN
   RAISE EXCEPTION 'SR2_OPERATIONAL_HEAD_NO_OP' USING ERRCODE='23514'; END IF;
 END IF;
 IF NEW.enabled OR (TG_OP='UPDATE' AND NEW.observation_id IS DISTINCT FROM OLD.observation_id) THEN
  SELECT observed.* INTO o FROM gov_repo.sr2_operational_agent_observations_v1 observed
   WHERE observed.organisation_id=NEW.organisation_id AND observed.source_record_id=NEW.source_record_id AND observed.observation_id=NEW.observation_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'SR2_OPERATIONAL_OBSERVATION_REQUIRED' USING ERRCODE='23514'; END IF;
  PERFORM gov_repo.sr2_operational_binding_v1(o);
 END IF;
 RETURN NEW;
END
$guard$;$head$;
 EXECUTE replace($definition$CREATE OR REPLACE FUNCTION gov_repo.operational_agent_semantic_context_search_v1(
  p_verified_organisation_id uuid,p_verified_actor_user_id uuid,p_verified_session_iat bigint,p_verified_session_exp bigint,p_verified_credential_epoch timestamptz,
  p_query __vector__.vector,p_provider text,p_model text,p_version text,p_dimension integer,p_schema text,p_query_recipe text,p_limit integer,p_threshold double precision)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER VOLATILE PARALLEL UNSAFE CALLED ON NULL INPUT
 SET search_path=pg_catalog,pg_temp SET lock_timeout='5s' AS $operational$
DECLARE v_org uuid; v_space jsonb; v_result jsonb; v_query_unit __vector__.vector; v_numeric_invalid boolean;
BEGIN
 SELECT u.organisation_id INTO v_org FROM gov_repo.governance_users u WHERE u.user_id=p_verified_actor_user_id;
 IF v_org IS NULL OR v_org IS DISTINCT FROM p_verified_organisation_id THEN
  RAISE EXCEPTION 'OPERATIONAL_ACCESS_DENIED' USING ERRCODE='GV003'; END IF;
 PERFORM 1 FROM gov_repo.l14_session_basis_v1(v_org,p_verified_actor_user_id,p_verified_session_iat,p_verified_session_exp,p_verified_credential_epoch);
 IF NOT FOUND THEN RAISE EXCEPTION 'OPERATIONAL_ACCESS_DENIED' USING ERRCODE='GV003'; END IF;
 IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 20 OR p_threshold IS NULL OR p_threshold NOT BETWEEN -1 AND 1 THEN
  RAISE EXCEPTION 'INVALID_OPERATIONAL_OPTIONS' USING ERRCODE='22023'; END IF;
 IF p_query_recipe IS DISTINCT FROM 'OPERATIONAL_CONTEXT_QUERY_V1' OR p_query IS NULL OR p_dimension IS NULL OR p_dimension NOT BETWEEN 1 AND 16000
  OR __vector__.vector_dims(p_query)<>p_dimension OR __vector__.vector_norm(p_query)<=0
  OR __vector__.vector_norm(p_query) IN ('NaN'::float8,'Infinity'::float8)
  OR EXISTS(SELECT FROM unnest(ARRAY[p_schema,p_provider,p_model,p_version]) v
   WHERE v IS NULL OR NOT(v~'[^[:space:]]') OR v~'[[:cntrl:]]' OR octet_length(v)>512 OR lower(btrim(v)) IN ('latest','default','unknown'))
 THEN RAISE EXCEPTION 'INVALID_OPERATIONAL_QUERY' USING ERRCODE='22023'; END IF;
 v_query_unit:=__vector__.l2_normalize(p_query);
 v_space:=jsonb_build_object('projection_schema_version',p_schema,'provider_id',p_provider,'model_id',p_model,'model_version',p_version,'dimension',p_dimension);
 IF current_setting('statement_timeout')::interval<=interval '0' OR current_setting('statement_timeout')::interval>interval '5 seconds' THEN
  RETURN jsonb_build_object('contract_version','GOVIA_SR2_OPERATIONAL_CONTEXT_READ_V1','observed_at',to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
   'embedding_space',v_space,'record_family','LEGACY_AGENT_RECORD','algorithm','EXACT_COSINE_V1','selection_policy','EXPLICIT_ADMITTED_HEAD_IN_EXACT_SPACE_V1',
   'authorization_semantics','AUTHORIZATION_AS_OF_ACQUISITION_SNAPSHOT','coverage','BOUNDED_CURRENT_OPERATIONAL_HEADS','authority','DERIVED_ANALYTICAL_NON_AUTHORITATIVE',
   'source_classification','LEGACY_OPERATIONAL_RECORD_NON_CANONICAL','canonical_decision',false,'governed_relationships',false,'assurance',false,
   'status','SEMANTIC_CONTEXT_UNAVAILABLE','reason','EXECUTION_BUDGET_REQUIRED','hits','[]'::jsonb);
 END IF;
 WITH acquired_clock AS MATERIALIZED (SELECT clock_timestamp() AS at),
 disclosure AS MATERIALIZED (
  SELECT h.* FROM gov_repo.sr2_operational_disclosure_heads_v1 h
  JOIN gov_repo.sr2_operational_disclosure_admissions_v1 a USING(organisation_id,purpose_code,scope_kind,source_record_id,disclosure_admission_id)
  WHERE h.organisation_id=v_org AND h.purpose_code='OPERATIONAL_AGENT_CONTEXT_V1' AND h.scope_kind='ORGANISATION'
   AND h.source_record_id='00000000-0000-0000-0000-000000000000'::uuid AND h.enabled
   AND h.head_revision>=1 AND a.admitted_after_revision=h.head_revision-1
   AND a.handling_recipe_id='GOVIA_SR2_OPERATIONAL_HANDLING_V1' AND a.handling_recipe_version='1' AND a.document_recipe='GOVIA_OPERATIONAL_CONTEXT_V1'
 ), heads AS MATERIALIZED (
  SELECT h.* FROM gov_repo.sr2_operational_agent_heads_v1 h
  WHERE h.organisation_id=v_org AND h.purpose_code='OPERATIONAL_AGENT_CONTEXT_V1' AND h.enabled AND EXISTS(SELECT FROM disclosure) ORDER BY h.source_record_id LIMIT 10001
 ), head_bound AS MATERIALIZED (SELECT count(*) AS n FROM heads),
 compatible AS MATERIALIZED (
  SELECT h.head_revision,o.*,r.representation_id,r.provider_id,r.model_id,r.model_version,r.dimension,r.embedding,r.generated_at AS representation_generated_at,r.recorded_at AS representation_recorded_at
  FROM heads h JOIN gov_repo.sr2_operational_agent_observations_v1 o
   ON o.organisation_id=v_org AND o.organisation_id=h.organisation_id AND o.source_record_id=h.source_record_id AND o.observation_id=h.observation_id
  JOIN gov_repo.sr2_operational_agent_representations_v1 r
   ON r.organisation_id=v_org AND r.organisation_id=o.organisation_id AND r.source_record_id=o.source_record_id AND r.observation_id=o.observation_id
   AND r.projection_schema_version=p_schema COLLATE "C" AND r.provider_id=p_provider COLLATE "C" AND r.model_id=p_model COLLATE "C"
   AND r.model_version=p_version COLLATE "C" AND r.dimension=p_dimension AND r.document_recipe='GOVIA_OPERATIONAL_CONTEXT_V1'
  WHERE (SELECT n FROM head_bound)<=10000
 ), scored AS MATERIALIZED (
  SELECT c.*,1-(__vector__.l2_normalize(c.embedding) OPERATOR(__vector__.<=>) v_query_unit) AS relevance FROM compatible c
 ), numeric_invariant AS MATERIALIZED (
  SELECT coalesce(bool_or((relevance BETWEEN -1 AND 1) IS NOT TRUE),false) AS invalid FROM scored
 ), ranked AS MATERIALIZED (
  SELECT *,row_number() OVER(ORDER BY relevance DESC,source_record_id::text COLLATE "C",observation_id COLLATE "C",representation_id COLLATE "C") AS rank
  FROM scored WHERE relevance>=p_threshold ORDER BY relevance DESC,source_record_id::text COLLATE "C",observation_id COLLATE "C",representation_id COLLATE "C" LIMIT p_limit
 ), checked AS MATERIALIZED (
  SELECT r.*,a.agent_id AS live_agent_id,a.status AS live_agent_status,a.ai_system_id AS live_system_id,
   s.status AS live_system_status,s.lifecycle AS live_system_lifecycle,
   CASE WHEN a.agent_id IS NULL OR a.status NOT IN ('active','approved') THEN true
    WHEN a.ai_system_id IS NOT NULL AND s.system_id IS NULL THEN true ELSE false END AS source_unavailable,
   CASE WHEN a.agent_id IS NULL OR (a.ai_system_id IS NOT NULL AND s.system_id IS NULL) THEN NULL
    ELSE encode(sha256(convert_to(gov_repo.frame_identity(ARRAY[
     'GOVIA_SR2_OPERATIONAL_AGENT_SOURCE_DESCRIPTOR_V1',v_org::text,'LEGACY_AGENT_RECORD',a.agent_id::text,a.agent_code::text,a.name::text,a.description,a.agent_type::text,
     CASE WHEN a.business_domain IS NULL THEN 'BUSINESS_DOMAIN_ABSENT' ELSE 'BUSINESS_DOMAIN_PRESENT' END,coalesce(a.business_domain::text,''),
     CASE WHEN a.ai_system_id IS NULL THEN 'RELATED_SYSTEM_ABSENT' ELSE 'RELATED_SYSTEM_PRESENT_SAME_TENANT' END,coalesce(a.ai_system_id::text,''),
     CASE WHEN a.ai_system_id IS NULL THEN '' ELSE s.organisation_id::text END,coalesce(s.system_code::text,''),coalesce(s.name::text,'')]),'UTF8')),'hex') END AS live_descriptor_fingerprint,
   NOT EXISTS(SELECT FROM gov_repo.sr2_operational_disclosure_heads_v1 d
    LEFT JOIN LATERAL (SELECT b.* FROM gov_repo.sr2_operational_disclosure_admissions_v1 b
     WHERE b.organisation_id=d.organisation_id AND b.purpose_code=d.purpose_code AND b.scope_kind=d.scope_kind
      AND b.source_record_id=d.source_record_id AND b.disclosure_admission_id=d.disclosure_admission_id OFFSET 0) b ON true
    WHERE d.organisation_id=v_org AND d.purpose_code='OPERATIONAL_AGENT_CONTEXT_V1' AND d.scope_kind='SOURCE' AND d.source_record_id=r.source_record_id
     AND (NOT d.enabled OR b.disclosure_admission_id IS NULL OR b.handling_recipe_id<>'GOVIA_SR2_OPERATIONAL_HANDLING_V1'
      OR d.head_revision<1 OR b.admitted_after_revision<>d.head_revision-1
      OR b.handling_recipe_version<>'1' OR b.document_recipe<>'GOVIA_OPERATIONAL_CONTEXT_V1') OFFSET 0) AS source_disclosure_valid,
   (r.handling_recipe_id='GOVIA_SR2_OPERATIONAL_HANDLING_V1' AND r.handling_recipe_version='1'
  AND r.projection_recipe_id='GOVIA_SR2_OPERATIONAL_AGENT_PROJECTION_V1' AND r.projection_recipe_version='1' AND r.document_recipe='GOVIA_OPERATIONAL_CONTEXT_V1'
  AND r.agent_code_label IS NOT DISTINCT FROM a.agent_code::text COLLATE "C"
  AND r.agent_name_label IS NOT DISTINCT FROM a.name::text COLLATE "C" AND r.agent_type IS NOT DISTINCT FROM a.agent_type
  AND r.business_domain_label IS NOT DISTINCT FROM a.business_domain::text COLLATE "C"
  AND gov_repo.sr2_operational_safe_v1(r.agent_code_label,512) AND gov_repo.sr2_operational_safe_v1(r.agent_name_label,512)
  AND gov_repo.sr2_operational_safe_v1(r.agent_type::text,512)
  AND (r.business_domain_label IS NULL OR gov_repo.sr2_operational_safe_v1(r.business_domain_label,512))
  AND gov_repo.sr2_operational_safe_v1(r.acquisition_method_code,512) AND gov_repo.sr2_operational_safe_v1(r.acquisition_method_version,512)
  AND gov_repo.sr2_operational_safe_v1(r.projection_schema_version,512)
  AND ((r.description_disposition='WITHHELD' AND r.description_text IS NULL) OR
   (r.description_disposition='PROJECTED' AND r.description_text IS NOT DISTINCT FROM a.description COLLATE "C" AND gov_repo.sr2_operational_safe_v1(r.description_text,1024)))
  AND ((a.ai_system_id IS NULL AND r.related_system_state='ABSENT' AND r.related_system_record_id IS NULL
   AND r.related_system_code_label IS NULL AND r.related_system_name_label IS NULL) OR
   (a.ai_system_id IS NOT NULL AND s.organisation_id=r.organisation_id AND r.related_system_state='PRESENT_SAME_TENANT'
   AND r.related_system_record_id=a.ai_system_id AND r.related_system_record_id=s.system_id
   AND r.related_system_code_label IS NOT DISTINCT FROM s.system_code::text COLLATE "C"
   AND r.related_system_name_label IS NOT DISTINCT FROM s.name::text COLLATE "C"
   AND gov_repo.sr2_operational_safe_v1(r.related_system_code_label,512) AND gov_repo.sr2_operational_safe_v1(r.related_system_name_label,512)))) IS TRUE AS source_binding_valid,
   (r.subject_id=encode(sha256(convert_to(gov_repo.frame_identity(ARRAY['GOVIA_SR2_OPERATIONAL_SUBJECT_V1',r.organisation_id::text,'LEGACY_AGENT_RECORD',r.source_record_id::text]),'UTF8')),'hex')) IS TRUE AS subject_valid,
   (r.projection_id=encode(sha256(convert_to(gov_repo.frame_identity(ARRAY[
    'GOVIA_SR2_OPERATIONAL_AGENT_PROJECTION_V1','1',r.organisation_id::text,r.source_record_id::text,r.subject_id,r.projection_schema_version,
    r.handling_recipe_id,r.handling_recipe_version,r.document_recipe,r.agent_code_label,r.agent_name_label,r.agent_type::text,
    CASE WHEN r.business_domain_label IS NULL THEN 'BUSINESS_DOMAIN_ABSENT' ELSE 'BUSINESS_DOMAIN_PRESENT' END,coalesce(r.business_domain_label,''),
    r.description_disposition,coalesce(r.description_text,''),r.related_system_state,coalesce(r.related_system_record_id::text,''),
    coalesce(r.related_system_code_label,''),coalesce(r.related_system_name_label,'')]),'UTF8')),'hex')) IS TRUE AS projection_valid,
   (r.observation_id=encode(sha256(convert_to(gov_repo.frame_identity(ARRAY[
    'GOVIA_SR2_OPERATIONAL_AGENT_OBSERVATION_V1',r.organisation_id::text,r.source_record_id::text,r.subject_id,
    r.source_descriptor_recipe,r.source_descriptor_fingerprint,r.acquisition_method_code,r.acquisition_method_version,
    r.projection_recipe_id,r.projection_recipe_version,r.projection_schema_version,r.projection_id,
    r.handling_recipe_id,r.handling_recipe_version,r.document_recipe]),'UTF8')),'hex')) IS TRUE AS observation_valid,
   (r.representation_id=encode(sha256(convert_to(gov_repo.frame_identity(ARRAY['GOVIA_SR2_OPERATIONAL_AGENT_REPRESENTATION_V1',r.organisation_id::text,r.source_record_id::text,r.observation_id,
    r.projection_schema_version,r.provider_id,r.model_id,r.model_version,r.dimension::text]),'UTF8')),'hex')) IS TRUE AS representation_valid,
   (r.observed_at<=r.recorded_at AND r.representation_generated_at<=r.representation_recorded_at AND r.recorded_at<=(SELECT at FROM acquired_clock)
    AND r.representation_recorded_at<=(SELECT at FROM acquired_clock)) IS TRUE AS time_valid,
   (octet_length(r.agent_code_label)+octet_length(r.agent_name_label)+coalesce(octet_length(r.business_domain_label),0)+coalesce(octet_length(r.description_text),0)
    +coalesce(octet_length(r.related_system_code_label),0)+coalesce(octet_length(r.related_system_name_label),0)<=4096) IS TRUE AS content_valid
  FROM ranked r
  LEFT JOIN gov_repo.agents a ON a.organisation_id=v_org AND a.agent_id=r.source_record_id
  LEFT JOIN gov_repo.ai_systems s ON s.organisation_id=v_org AND s.system_id=a.ai_system_id
 ), fault AS MATERIALIZED (SELECT CASE
  WHEN NOT EXISTS(SELECT FROM disclosure) OR EXISTS(SELECT FROM checked WHERE NOT source_disclosure_valid) THEN 'CONTENT_WITHHELD'
  WHEN (SELECT n FROM head_bound)>10000 THEN 'SCAN_BOUND'
  WHEN NOT EXISTS(SELECT FROM compatible) THEN 'NO_COMPATIBLE_REPRESENTATIONS'
  WHEN EXISTS(SELECT FROM checked WHERE source_unavailable) THEN 'SOURCE_UNAVAILABLE'
  WHEN EXISTS(SELECT FROM checked WHERE live_descriptor_fingerprint IS DISTINCT FROM source_descriptor_fingerprint) THEN 'SOURCE_CHANGED'
  WHEN EXISTS(SELECT FROM checked WHERE NOT source_binding_valid OR NOT subject_valid OR NOT projection_valid OR NOT observation_valid OR NOT representation_valid OR NOT time_valid) THEN 'INVALID_SOURCE_SUPPORT'
  WHEN EXISTS(SELECT FROM checked WHERE NOT content_valid) OR coalesce((SELECT sum(octet_length(coalesce(description_text,''))+octet_length(agent_code_label)+octet_length(agent_name_label)) FROM checked),0)>16384 THEN 'CONTENT_BOUND'
  END AS reason),
 hit_json AS MATERIALIZED (
  SELECT rank,jsonb_build_object(
   'subject_id',subject_id,'source_record_id',source_record_id,'observation',jsonb_build_object('observation_id',observation_id,'source_descriptor_recipe',source_descriptor_recipe,
    'source_descriptor_fingerprint',source_descriptor_fingerprint,'acquisition_method',jsonb_build_object('code',acquisition_method_code,'version',acquisition_method_version),
    'observed_at',to_char(observed_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'recorded_at',to_char(recorded_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')),
   'projection',jsonb_build_object('projection_id',projection_id,'projection_schema_version',projection_schema_version,'document_recipe',document_recipe,
    'handling_recipe',jsonb_build_object('id',handling_recipe_id,'version',handling_recipe_version),'agent_code_label',agent_code_label,'agent_name_label',agent_name_label,
    'agent_type',agent_type::text,'business_domain_label',business_domain_label,'description_disposition',description_disposition,'description_text',description_text,
    'related_system_state',related_system_state,'related_system_record_id',related_system_record_id,'related_system_code_label',related_system_code_label,'related_system_name_label',related_system_name_label,
    'source_data_classification','UNTRUSTED_SOURCE_DATA'),
   'current_source',jsonb_build_object('agent_status',live_agent_status::text,'status_authority','LEGACY_NON_AUTHORITATIVE','related_system_decommissioned',
    CASE WHEN live_system_id IS NULL THEN NULL ELSE live_system_status='decommissioned'::gov_repo.system_status OR live_system_lifecycle='decommissioned'::gov_repo.ai_system_lifecycle END,
    'related_system_state_authority','LEGACY_NON_AUTHORITATIVE'),
   'representation_id',representation_id,'embedding_space',v_space,'authority','DERIVED_ANALYTICAL_NON_AUTHORITATIVE',
   'source_classification','LEGACY_OPERATIONAL_RECORD_NON_CANONICAL','canonical_decision',false,'governed_relationships',false,'assurance',false,
   'retrieval_relevance',jsonb_build_object('kind','RETRIEVAL_RANK_ONLY','rank',rank,'policy_version','EXACT_COSINE_V1')) AS doc
  FROM checked WHERE (SELECT reason FROM fault) IS NULL
 ), basis AS MATERIALIZED (SELECT jsonb_build_object(
   'contract_version','GOVIA_SR2_OPERATIONAL_CONTEXT_READ_V1','observed_at',to_char((SELECT at FROM acquired_clock) AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
   'embedding_space',v_space,'record_family','LEGACY_AGENT_RECORD','algorithm','EXACT_COSINE_V1','selection_policy','EXPLICIT_ADMITTED_HEAD_IN_EXACT_SPACE_V1',
   'authorization_semantics','AUTHORIZATION_AS_OF_ACQUISITION_SNAPSHOT','coverage','BOUNDED_CURRENT_OPERATIONAL_HEADS','authority','DERIVED_ANALYTICAL_NON_AUTHORITATIVE',
   'source_classification','LEGACY_OPERATIONAL_RECORD_NON_CANONICAL','canonical_decision',false,'governed_relationships',false,'assurance',false) AS doc)
 SELECT b.doc||jsonb_build_object('status',CASE WHEN f.reason IS NOT NULL THEN 'SEMANTIC_CONTEXT_UNAVAILABLE' WHEN NOT EXISTS(SELECT FROM hit_json) THEN 'NO_MATCHES_IN_QUERIED_SEMANTIC_SPACE' ELSE 'SEMANTIC_CONTEXT_AVAILABLE' END,
  'reason',f.reason,'hits',coalesce((SELECT jsonb_agg(doc ORDER BY rank) FROM hit_json),'[]'::jsonb)),n.invalid
 INTO v_result,v_numeric_invalid FROM basis b CROSS JOIN fault f CROSS JOIN numeric_invariant n;
 IF v_numeric_invalid THEN RAISE EXCEPTION 'OPERATIONAL_NUMERIC_INVARIANT' USING ERRCODE='XX000'; END IF;
 IF octet_length(v_result::text)>262144 THEN
  v_result=(v_result-'status'-'reason'-'hits')||jsonb_build_object('status','SEMANTIC_CONTEXT_UNAVAILABLE','reason','RESPONSE_BOUND','hits','[]'::jsonb);
 END IF;
 RETURN v_result;
END
$operational$;$definition$,'__vector__',quote_ident(v_ext));
 IF (SELECT to_jsonb(p)-'prosrc' FROM pg_proc p WHERE p.oid=v_oid) IS DISTINCT FROM v_before
  OR (SELECT to_jsonb(p)-'prosrc' FROM pg_proc p WHERE p.oid='gov_repo.sr2_operational_agent_head_guard_v1()'::regprocedure) IS DISTINCT FROM v_head_before
 THEN RAISE EXCEPTION 'SR2_M3_CAPABILITY_DRIFT' USING ERRCODE='55000'; END IF;
END
$routines$;
CREATE TRIGGER sr2_operational_disclosure_admissions_v1_scope_lock BEFORE INSERT ON gov_repo.sr2_operational_disclosure_admissions_v1 FOR EACH STATEMENT EXECUTE FUNCTION gov_repo.sr2_operational_scope_lock_v1();
ALTER TABLE gov_repo.sr2_operational_disclosure_admissions_v1 ENABLE ALWAYS TRIGGER sr2_operational_disclosure_admissions_v1_scope_lock;
CREATE TRIGGER sr2_operational_disclosure_heads_v1_scope_lock BEFORE INSERT OR UPDATE ON gov_repo.sr2_operational_disclosure_heads_v1 FOR EACH STATEMENT EXECUTE FUNCTION gov_repo.sr2_operational_scope_lock_v1();
ALTER TABLE gov_repo.sr2_operational_disclosure_heads_v1 ENABLE ALWAYS TRIGGER sr2_operational_disclosure_heads_v1_scope_lock;
CREATE TRIGGER sr2_operational_agent_observations_v1_scope_lock BEFORE INSERT ON gov_repo.sr2_operational_agent_observations_v1 FOR EACH STATEMENT EXECUTE FUNCTION gov_repo.sr2_operational_scope_lock_v1();
ALTER TABLE gov_repo.sr2_operational_agent_observations_v1 ENABLE ALWAYS TRIGGER sr2_operational_agent_observations_v1_scope_lock;
CREATE TRIGGER sr2_operational_agent_heads_v1_scope_lock BEFORE INSERT OR UPDATE ON gov_repo.sr2_operational_agent_heads_v1 FOR EACH STATEMENT EXECUTE FUNCTION gov_repo.sr2_operational_scope_lock_v1();
ALTER TABLE gov_repo.sr2_operational_agent_heads_v1 ENABLE ALWAYS TRIGGER sr2_operational_agent_heads_v1_scope_lock;
CREATE TRIGGER sr2_operational_disclosure_admissions_v1_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON gov_repo.sr2_operational_disclosure_admissions_v1 FOR EACH STATEMENT EXECUTE FUNCTION gov_repo.sr2_immutable_v1();
ALTER TABLE gov_repo.sr2_operational_disclosure_admissions_v1 ENABLE ALWAYS TRIGGER sr2_operational_disclosure_admissions_v1_immutable;
CREATE TRIGGER sr2_operational_disclosure_admissions_v1_admit BEFORE INSERT ON gov_repo.sr2_operational_disclosure_admissions_v1 FOR EACH ROW EXECUTE FUNCTION gov_repo.sr2_operational_disclosure_guard_v1();
ALTER TABLE gov_repo.sr2_operational_disclosure_admissions_v1 ENABLE ALWAYS TRIGGER sr2_operational_disclosure_admissions_v1_admit;
CREATE TRIGGER sr2_operational_disclosure_heads_v1_no_remove BEFORE DELETE OR TRUNCATE ON gov_repo.sr2_operational_disclosure_heads_v1 FOR EACH STATEMENT EXECUTE FUNCTION gov_repo.sr2_immutable_v1();
ALTER TABLE gov_repo.sr2_operational_disclosure_heads_v1 ENABLE ALWAYS TRIGGER sr2_operational_disclosure_heads_v1_no_remove;
CREATE TRIGGER sr2_operational_disclosure_heads_v1_transition BEFORE INSERT OR UPDATE ON gov_repo.sr2_operational_disclosure_heads_v1 FOR EACH ROW EXECUTE FUNCTION gov_repo.sr2_operational_disclosure_guard_v1();
ALTER TABLE gov_repo.sr2_operational_disclosure_heads_v1 ENABLE ALWAYS TRIGGER sr2_operational_disclosure_heads_v1_transition;
CREATE TRIGGER sr2_operational_agent_observations_v1_admit BEFORE INSERT ON gov_repo.sr2_operational_agent_observations_v1 FOR EACH ROW EXECUTE FUNCTION gov_repo.sr2_operational_observation_admit_v1();
ALTER TABLE gov_repo.sr2_operational_agent_observations_v1 ENABLE ALWAYS TRIGGER sr2_operational_agent_observations_v1_admit;
ALTER FUNCTION gov_repo.sr2_operational_safe_v1(text,integer) OWNER TO postgres;
REVOKE ALL ON FUNCTION gov_repo.sr2_operational_safe_v1(text,integer) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION gov_repo.sr2_operational_scope_lock_v1() OWNER TO postgres;
REVOKE ALL ON FUNCTION gov_repo.sr2_operational_scope_lock_v1() FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION gov_repo.sr2_operational_disclosure_guard_v1() OWNER TO postgres;
REVOKE ALL ON FUNCTION gov_repo.sr2_operational_disclosure_guard_v1() FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION gov_repo.sr2_operational_binding_v1(gov_repo.sr2_operational_agent_observations_v1) OWNER TO postgres;
REVOKE ALL ON FUNCTION gov_repo.sr2_operational_binding_v1(gov_repo.sr2_operational_agent_observations_v1) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION gov_repo.sr2_operational_observation_admit_v1() OWNER TO postgres;
REVOKE ALL ON FUNCTION gov_repo.sr2_operational_observation_admit_v1() FROM PUBLIC,anon,authenticated,service_role;
DO $postflight$
BEGIN
 IF (SELECT count(*) FROM pg_trigger WHERE tgname IN (
'sr2_operational_disclosure_admissions_v1_scope_lock','sr2_operational_disclosure_heads_v1_scope_lock',
'sr2_operational_agent_observations_v1_scope_lock','sr2_operational_agent_heads_v1_scope_lock',
'sr2_operational_disclosure_admissions_v1_immutable','sr2_operational_disclosure_admissions_v1_admit',
'sr2_operational_disclosure_heads_v1_no_remove','sr2_operational_disclosure_heads_v1_transition','sr2_operational_agent_observations_v1_admit')
 AND tgenabled='A' AND NOT tgisinternal)<>9 THEN RAISE EXCEPTION 'SR2_M3_TRIGGER_BUDGET' USING ERRCODE='55000'; END IF;
END
$postflight$;
COMMIT;
