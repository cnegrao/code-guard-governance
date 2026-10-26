-- SR2-A3: immutable, principal-bound operational agent semantic context.
-- No writer, provider, population, Talk integration, legacy-table mutation or hosted effect.
BEGIN;
SET LOCAL search_path=pg_catalog,public;

DO $preflight$
DECLARE v_ext name;
BEGIN
 SELECT n.nspname INTO STRICT v_ext FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace
 WHERE e.extname='vector' AND e.extversion='0.8.7';
 IF current_user<>'postgres' OR current_setting('server_version_num')::integer NOT BETWEEN 170000 AND 179999
  OR EXISTS(SELECT FROM unnest(ARRAY['anon','authenticated','service_role']) r WHERE has_schema_privilege(r,v_ext,'CREATE'))
  OR EXISTS(SELECT FROM pg_class c WHERE c.relnamespace='gov_repo'::regnamespace AND c.relname IN
   ('sr2_operational_agent_observations_v1','sr2_operational_agent_representations_v1','sr2_operational_agent_heads_v1'))
  OR EXISTS(SELECT FROM pg_proc p WHERE p.pronamespace='gov_repo'::regnamespace AND p.proname IN
   ('sr2_operational_agent_head_guard_v1','operational_agent_semantic_context_search_v1'))
  OR EXISTS(SELECT FROM unnest(ARRAY[
   'gov_repo.frame_identity(text[])','gov_repo.sr2_list_valid_v1(text[],integer)','gov_repo.sr2_immutable_v1()','gov_repo.sr2_record_time_guard_v1()',
   'gov_repo.l14_session_basis_v1(uuid,uuid,bigint,bigint,timestamptz)']::text[]) r WHERE to_regprocedure(r) IS NULL)
 THEN RAISE EXCEPTION 'SR2_A3_UNTRUSTED_BASELINE' USING ERRCODE='55000'; END IF;
END
$preflight$;

CREATE TABLE gov_repo.sr2_operational_agent_observations_v1 (
 organisation_id uuid NOT NULL,
 source_record_id uuid NOT NULL,
 subject_id text COLLATE "C" NOT NULL,
 observation_id text COLLATE "C" NOT NULL,
 source_descriptor_recipe text COLLATE "C" NOT NULL,
 source_descriptor_fingerprint text COLLATE "C" NOT NULL,
 acquisition_method_code text COLLATE "C" NOT NULL,
 acquisition_method_version text COLLATE "C" NOT NULL,
 projection_recipe_id text COLLATE "C" NOT NULL,
 projection_recipe_version text COLLATE "C" NOT NULL,
 projection_schema_version text COLLATE "C" NOT NULL,
 handling_recipe_id text COLLATE "C" NOT NULL,
 handling_recipe_version text COLLATE "C" NOT NULL,
 document_recipe text COLLATE "C" NOT NULL,
 agent_code_label text COLLATE "C" NOT NULL,
 agent_name_label text COLLATE "C" NOT NULL,
 agent_type gov_repo.agent_type NOT NULL,
 business_domain_label text COLLATE "C",
 description_disposition text COLLATE "C" NOT NULL,
 description_text text COLLATE "C",
 related_system_state text COLLATE "C" NOT NULL,
 related_system_record_id uuid,
 related_system_code_label text COLLATE "C",
 related_system_name_label text COLLATE "C",
 projection_id text COLLATE "C" NOT NULL,
 observed_at timestamptz NOT NULL,
 recorded_at timestamptz NOT NULL,
 CONSTRAINT sr2_operational_agent_observations_v1_pkey PRIMARY KEY (organisation_id,source_record_id,observation_id),
 CONSTRAINT sr2_operational_agent_observations_v1_f1 FOREIGN KEY (organisation_id) REFERENCES gov_repo.organisations(organisation_id),
 CONSTRAINT sr2_operational_agent_observations_v1_c1 CHECK ((
  subject_id=encode(sha256(convert_to(gov_repo.frame_identity(ARRAY['GOVIA_SR2_OPERATIONAL_SUBJECT_V1',organisation_id::text,'LEGACY_AGENT_RECORD',source_record_id::text]),'UTF8')),'hex')
 ) IS TRUE),
 CONSTRAINT sr2_operational_agent_observations_v1_c2 CHECK ((
  source_descriptor_recipe='GOVIA_SR2_OPERATIONAL_AGENT_SOURCE_DESCRIPTOR_V1' AND source_descriptor_fingerprint~'^[0-9a-f]{64}$'
 ) IS TRUE),
 CONSTRAINT sr2_operational_agent_observations_v1_c3 CHECK ((
  octet_length(acquisition_method_code) BETWEEN 1 AND 512 AND acquisition_method_code~'[^[:space:]]' AND acquisition_method_code!~'[[:cntrl:]]'
  AND octet_length(acquisition_method_version) BETWEEN 1 AND 512 AND acquisition_method_version~'[^[:space:]]' AND acquisition_method_version!~'[[:cntrl:]]'
  AND lower(btrim(acquisition_method_version))<>ALL(ARRAY['latest','default','unknown'])
 ) IS TRUE),
 CONSTRAINT sr2_operational_agent_observations_v1_c4 CHECK ((
  projection_recipe_id='GOVIA_SR2_OPERATIONAL_AGENT_PROJECTION_V1' AND projection_recipe_version='1'
  AND handling_recipe_id='GOVIA_SR2_OPERATIONAL_HANDLING_V1' AND handling_recipe_version='1'
  AND document_recipe='GOVIA_OPERATIONAL_CONTEXT_V1'
  AND octet_length(projection_schema_version) BETWEEN 1 AND 512 AND projection_schema_version~'[^[:space:]]'
  AND projection_schema_version!~'[[:cntrl:]]' AND lower(btrim(projection_schema_version))<>ALL(ARRAY['latest','default','unknown'])
 ) IS TRUE),
 CONSTRAINT sr2_operational_agent_observations_v1_c5 CHECK ((
  octet_length(agent_code_label) BETWEEN 1 AND 512 AND agent_code_label~'[^[:space:]]' AND agent_code_label!~'[[:cntrl:]]'
  AND octet_length(agent_name_label) BETWEEN 1 AND 512 AND agent_name_label~'[^[:space:]]' AND agent_name_label!~'[[:cntrl:]]'
 ) IS TRUE),
 CONSTRAINT sr2_operational_agent_observations_v1_c6 CHECK ((
  business_domain_label IS NULL OR (octet_length(business_domain_label) BETWEEN 1 AND 512 AND business_domain_label~'[^[:space:]]' AND business_domain_label!~'[[:cntrl:]]')
 ) IS TRUE),
 CONSTRAINT sr2_operational_agent_observations_v1_c7 CHECK ((
  (description_disposition='WITHHELD' AND description_text IS NULL) OR
  (description_disposition='PROJECTED' AND octet_length(description_text) BETWEEN 1 AND 1024 AND description_text~'[^[:space:]]' AND description_text!~'[[:cntrl:]]')
 ) IS TRUE),
 CONSTRAINT sr2_operational_agent_observations_v1_c8 CHECK ((
  (related_system_state='ABSENT' AND related_system_record_id IS NULL AND related_system_code_label IS NULL AND related_system_name_label IS NULL) OR
  (related_system_state='PRESENT_SAME_TENANT' AND related_system_record_id IS NOT NULL
   AND octet_length(related_system_code_label) BETWEEN 1 AND 512 AND related_system_code_label~'[^[:space:]]' AND related_system_code_label!~'[[:cntrl:]]'
   AND octet_length(related_system_name_label) BETWEEN 1 AND 512 AND related_system_name_label~'[^[:space:]]' AND related_system_name_label!~'[[:cntrl:]]')
 ) IS TRUE),
 CONSTRAINT sr2_operational_agent_observations_v1_c9 CHECK ((
  projection_id=encode(sha256(convert_to(gov_repo.frame_identity(ARRAY[
   'GOVIA_SR2_OPERATIONAL_AGENT_PROJECTION_V1','1',organisation_id::text,source_record_id::text,subject_id,projection_schema_version,
   handling_recipe_id,handling_recipe_version,document_recipe,agent_code_label,agent_name_label,agent_type::text,
   CASE WHEN business_domain_label IS NULL THEN 'BUSINESS_DOMAIN_ABSENT' ELSE 'BUSINESS_DOMAIN_PRESENT' END,coalesce(business_domain_label,''),
   description_disposition,coalesce(description_text,''),related_system_state,coalesce(related_system_record_id::text,''),
   coalesce(related_system_code_label,''),coalesce(related_system_name_label,'')]),'UTF8')),'hex')
 ) IS TRUE),
 CONSTRAINT sr2_operational_agent_observations_v1_c10 CHECK ((
  observation_id=encode(sha256(convert_to(gov_repo.frame_identity(ARRAY[
   'GOVIA_SR2_OPERATIONAL_AGENT_OBSERVATION_V1',organisation_id::text,source_record_id::text,subject_id,
   source_descriptor_recipe,source_descriptor_fingerprint,acquisition_method_code,acquisition_method_version,
   projection_recipe_id,projection_recipe_version,projection_schema_version,projection_id,
   handling_recipe_id,handling_recipe_version,document_recipe]),'UTF8')),'hex')
 ) IS TRUE),
 CONSTRAINT sr2_operational_agent_observations_v1_c11 CHECK ((
  isfinite(observed_at) AND isfinite(recorded_at) AND observed_at<=recorded_at
 ) IS TRUE)
);

DO $representation$
DECLARE v_ext name;
BEGIN
 SELECT n.nspname INTO STRICT v_ext FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace WHERE e.extname='vector';
 EXECUTE replace($ddl$CREATE TABLE gov_repo.sr2_operational_agent_representations_v1 (
  organisation_id uuid NOT NULL, source_record_id uuid NOT NULL, observation_id text COLLATE "C" NOT NULL,
  representation_id text COLLATE "C" NOT NULL, projection_schema_version text COLLATE "C" NOT NULL,
  provider_id text COLLATE "C" NOT NULL, model_id text COLLATE "C" NOT NULL, model_version text COLLATE "C" NOT NULL,
  dimension integer NOT NULL, document_recipe text COLLATE "C" NOT NULL, embedding __vector__.vector NOT NULL,
  generated_at timestamptz NOT NULL, recorded_at timestamptz NOT NULL,
  CONSTRAINT sr2_operational_agent_representations_v1_pkey PRIMARY KEY
   (organisation_id,source_record_id,observation_id,projection_schema_version,provider_id,model_id,model_version,dimension,representation_id),
  CONSTRAINT sr2_operational_agent_representations_v1_f1 FOREIGN KEY (organisation_id,source_record_id,observation_id)
   REFERENCES gov_repo.sr2_operational_agent_observations_v1(organisation_id,source_record_id,observation_id),
  CONSTRAINT sr2_operational_agent_representations_v1_c1 CHECK ((
   document_recipe='GOVIA_OPERATIONAL_CONTEXT_V1' AND octet_length(projection_schema_version) BETWEEN 1 AND 512
   AND projection_schema_version~'[^[:space:]]' AND projection_schema_version!~'[[:cntrl:]]'
   AND lower(btrim(projection_schema_version))<>ALL(ARRAY['latest','default','unknown'])
   AND gov_repo.sr2_list_valid_v1(ARRAY[provider_id,model_id,model_version],3)
   AND lower(btrim(provider_id))<>ALL(ARRAY['latest','default','unknown'])
   AND lower(btrim(model_id))<>ALL(ARRAY['latest','default','unknown'])
   AND lower(btrim(model_version))<>ALL(ARRAY['latest','default','unknown'])
  ) IS TRUE),
  CONSTRAINT sr2_operational_agent_representations_v1_c2 CHECK ((dimension BETWEEN 1 AND 16000 AND __vector__.vector_dims(embedding)=dimension) IS TRUE),
  CONSTRAINT sr2_operational_agent_representations_v1_c3 CHECK ((__vector__.vector_norm(embedding)>0 AND __vector__.vector_norm(embedding) NOT IN ('NaN'::float8,'Infinity'::float8)) IS TRUE),
  CONSTRAINT sr2_operational_agent_representations_v1_c4 CHECK ((
   representation_id=encode(sha256(convert_to(gov_repo.frame_identity(ARRAY[
    'GOVIA_SR2_OPERATIONAL_AGENT_REPRESENTATION_V1',organisation_id::text,source_record_id::text,observation_id,
    projection_schema_version,provider_id,model_id,model_version,dimension::text]),'UTF8')),'hex')
  ) IS TRUE),
  CONSTRAINT sr2_operational_agent_representations_v1_c5 CHECK ((isfinite(generated_at) AND isfinite(recorded_at) AND generated_at<=recorded_at) IS TRUE)
 )$ddl$,'__vector__',quote_ident(v_ext));
END
$representation$;

CREATE TABLE gov_repo.sr2_operational_agent_heads_v1 (
 organisation_id uuid NOT NULL, source_record_id uuid NOT NULL, purpose_code text COLLATE "C" NOT NULL,
 observation_id text COLLATE "C" NOT NULL, enabled boolean NOT NULL, head_revision bigint NOT NULL,
 CONSTRAINT sr2_operational_agent_heads_v1_pkey PRIMARY KEY (organisation_id,source_record_id,purpose_code),
 CONSTRAINT sr2_operational_agent_heads_v1_f1 FOREIGN KEY (organisation_id,source_record_id,observation_id)
  REFERENCES gov_repo.sr2_operational_agent_observations_v1(organisation_id,source_record_id,observation_id),
 CONSTRAINT sr2_operational_agent_heads_v1_c1 CHECK ((purpose_code='OPERATIONAL_AGENT_CONTEXT_V1') IS TRUE),
 CONSTRAINT sr2_operational_agent_heads_v1_c2 CHECK ((head_revision>=1) IS TRUE)
);

ALTER TABLE gov_repo.sr2_operational_agent_observations_v1 ENABLE ROW LEVEL SECURITY;
ALTER TABLE gov_repo.sr2_operational_agent_representations_v1 ENABLE ROW LEVEL SECURITY;
ALTER TABLE gov_repo.sr2_operational_agent_heads_v1 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE gov_repo.sr2_operational_agent_observations_v1 FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON TABLE gov_repo.sr2_operational_agent_representations_v1 FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON TABLE gov_repo.sr2_operational_agent_heads_v1 FROM PUBLIC,anon,authenticated,service_role;
COMMENT ON TABLE gov_repo.sr2_operational_agent_observations_v1 IS 'DERIVED_ANALYTICAL_NON_AUTHORITATIVE; immutable legacy agent observation; source data is untrusted.';
COMMENT ON TABLE gov_repo.sr2_operational_agent_representations_v1 IS 'DERIVED_ANALYTICAL_NON_AUTHORITATIVE; immutable exact-space operational representation.';
COMMENT ON TABLE gov_repo.sr2_operational_agent_heads_v1 IS 'DERIVED_ANALYTICAL_NON_AUTHORITATIVE; explicit operational observation admission head.';

CREATE FUNCTION gov_repo.sr2_operational_agent_head_guard_v1() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER VOLATILE PARALLEL UNSAFE CALLED ON NULL INPUT
SET search_path=pg_catalog,pg_temp AS $guard$
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
 RETURN NEW;
END
$guard$;
ALTER FUNCTION gov_repo.sr2_operational_agent_head_guard_v1() OWNER TO postgres;
REVOKE ALL ON FUNCTION gov_repo.sr2_operational_agent_head_guard_v1() FROM PUBLIC,anon,authenticated,service_role;

CREATE TRIGGER sr2_operational_agent_observations_v1_immutable BEFORE UPDATE OR DELETE OR TRUNCATE
 ON gov_repo.sr2_operational_agent_observations_v1 FOR EACH STATEMENT EXECUTE FUNCTION gov_repo.sr2_immutable_v1();
ALTER TABLE gov_repo.sr2_operational_agent_observations_v1 ENABLE ALWAYS TRIGGER sr2_operational_agent_observations_v1_immutable;
CREATE TRIGGER sr2_operational_agent_observations_v1_record_time BEFORE INSERT
 ON gov_repo.sr2_operational_agent_observations_v1 FOR EACH ROW EXECUTE FUNCTION gov_repo.sr2_record_time_guard_v1();
ALTER TABLE gov_repo.sr2_operational_agent_observations_v1 ENABLE ALWAYS TRIGGER sr2_operational_agent_observations_v1_record_time;
CREATE TRIGGER sr2_operational_agent_representations_v1_immutable BEFORE UPDATE OR DELETE OR TRUNCATE
 ON gov_repo.sr2_operational_agent_representations_v1 FOR EACH STATEMENT EXECUTE FUNCTION gov_repo.sr2_immutable_v1();
ALTER TABLE gov_repo.sr2_operational_agent_representations_v1 ENABLE ALWAYS TRIGGER sr2_operational_agent_representations_v1_immutable;
CREATE TRIGGER sr2_operational_agent_representations_v1_record_time BEFORE INSERT
 ON gov_repo.sr2_operational_agent_representations_v1 FOR EACH ROW EXECUTE FUNCTION gov_repo.sr2_record_time_guard_v1();
ALTER TABLE gov_repo.sr2_operational_agent_representations_v1 ENABLE ALWAYS TRIGGER sr2_operational_agent_representations_v1_record_time;
CREATE TRIGGER sr2_operational_agent_heads_v1_transition BEFORE INSERT OR UPDATE
 ON gov_repo.sr2_operational_agent_heads_v1 FOR EACH ROW EXECUTE FUNCTION gov_repo.sr2_operational_agent_head_guard_v1();
ALTER TABLE gov_repo.sr2_operational_agent_heads_v1 ENABLE ALWAYS TRIGGER sr2_operational_agent_heads_v1_transition;
CREATE TRIGGER sr2_operational_agent_heads_v1_no_remove BEFORE DELETE OR TRUNCATE
 ON gov_repo.sr2_operational_agent_heads_v1 FOR EACH STATEMENT EXECUTE FUNCTION gov_repo.sr2_immutable_v1();
ALTER TABLE gov_repo.sr2_operational_agent_heads_v1 ENABLE ALWAYS TRIGGER sr2_operational_agent_heads_v1_no_remove;

DO $rpc$
DECLARE v_ext name;
BEGIN
 SELECT n.nspname INTO STRICT v_ext FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace WHERE e.extname='vector';
 EXECUTE replace($definition$CREATE FUNCTION gov_repo.operational_agent_semantic_context_search_v1(
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
 heads AS MATERIALIZED (
  SELECT h.* FROM gov_repo.sr2_operational_agent_heads_v1 h
  WHERE h.organisation_id=v_org AND h.purpose_code='OPERATIONAL_AGENT_CONTEXT_V1' AND h.enabled ORDER BY h.source_record_id LIMIT 10001
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
  WHEN (SELECT n FROM head_bound)>10000 THEN 'SCAN_BOUND'
  WHEN NOT EXISTS(SELECT FROM compatible) THEN 'NO_COMPATIBLE_REPRESENTATIONS'
  WHEN EXISTS(SELECT FROM checked WHERE source_unavailable) THEN 'SOURCE_UNAVAILABLE'
  WHEN EXISTS(SELECT FROM checked WHERE live_descriptor_fingerprint IS DISTINCT FROM source_descriptor_fingerprint) THEN 'SOURCE_CHANGED'
  WHEN EXISTS(SELECT FROM checked WHERE NOT subject_valid OR NOT projection_valid OR NOT observation_valid OR NOT representation_valid OR NOT time_valid) THEN 'INVALID_SOURCE_SUPPORT'
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
END
$rpc$;

-- The dynamic vector type makes the signature schema-dependent; ownership/ACL are applied by discovered OID.
DO $acl$
DECLARE p oid;
BEGIN
 SELECT p0.oid INTO STRICT p FROM pg_proc p0 WHERE p0.pronamespace='gov_repo'::regnamespace AND p0.proname='operational_agent_semantic_context_search_v1';
 EXECUTE format('ALTER FUNCTION %s OWNER TO postgres',p::regprocedure);
 EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role',p::regprocedure);
 EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role',p::regprocedure);
END
$acl$;

DO $postflight$
DECLARE v_tables integer; v_checks integer; v_fks integer; v_pks integer; v_triggers integer; v_policies integer;
BEGIN
 SELECT count(*) INTO v_tables FROM pg_class c WHERE c.relnamespace='gov_repo'::regnamespace AND c.relname IN
  ('sr2_operational_agent_observations_v1','sr2_operational_agent_representations_v1','sr2_operational_agent_heads_v1');
 SELECT count(*) FILTER(WHERE con.contype='c'),count(*) FILTER(WHERE con.contype='f'),count(*) FILTER(WHERE con.contype='p')
  INTO v_checks,v_fks,v_pks FROM pg_constraint con WHERE con.conrelid IN
  ('gov_repo.sr2_operational_agent_observations_v1'::regclass,'gov_repo.sr2_operational_agent_representations_v1'::regclass,'gov_repo.sr2_operational_agent_heads_v1'::regclass);
 SELECT count(*) INTO v_triggers FROM pg_trigger t WHERE t.tgrelid IN
  ('gov_repo.sr2_operational_agent_observations_v1'::regclass,'gov_repo.sr2_operational_agent_representations_v1'::regclass,'gov_repo.sr2_operational_agent_heads_v1'::regclass) AND NOT t.tgisinternal;
 SELECT count(*) INTO v_policies FROM pg_policy p WHERE p.polrelid IN
  ('gov_repo.sr2_operational_agent_observations_v1'::regclass,'gov_repo.sr2_operational_agent_representations_v1'::regclass,'gov_repo.sr2_operational_agent_heads_v1'::regclass);
 IF ROW(v_tables,v_pks,v_fks,v_checks,v_triggers,v_policies) IS DISTINCT FROM ROW(3,3,3,18,6,0)
 THEN RAISE EXCEPTION 'SR2_A3_OBJECT_BUDGET' USING ERRCODE='55000'; END IF;
END
$postflight$;
COMMIT;
