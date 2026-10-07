-- Discovery Machine S3: restricted pre-canonical intake, maximum DETECTED.
-- No worker, proposal transition, orchestration cutover or hosted activation.
BEGIN;
DO $s3_preflight$
BEGIN
 IF current_user<>'postgres' OR pg_catalog.current_setting('server_version_num')::int<170000
  OR pg_catalog.current_setting('transaction_isolation')<>'read committed'
  OR pg_catalog.to_regprocedure('gov_repo.machine_lock_eligibility_v1(uuid,bigint)') IS NULL
  OR EXISTS(SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='gov_repo' AND p.proname LIKE 'discovery_machine\_%' ESCAPE '\') THEN
  RAISE EXCEPTION 'S3_PREFLIGHT: PG17/postgres/READ COMMITTED/S2 required; S3 must not preexist'; END IF;
 IF (SELECT count(*) FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='gov_repo' AND p.prosecdef AND (pg_catalog.has_function_privilege('service_role',p.oid,'EXECUTE')
   OR pg_catalog.has_function_privilege('anon',p.oid,'EXECUTE') OR pg_catalog.has_function_privilege('authenticated',p.oid,'EXECUTE')))<>22 THEN
  RAISE EXCEPTION 'S3_PREFLIGHT: HUMAN census'; END IF;
END;
$s3_preflight$;

CREATE ROLE govia_discovery_intake_owner NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT;
GRANT govia_discovery_control_owner TO postgres WITH INHERIT TRUE, SET TRUE;
GRANT CREATE ON SCHEMA gov_repo TO govia_discovery_control_owner;
GRANT USAGE ON SCHEMA gov_repo TO govia_discovery_intake_owner;
GRANT govia_discovery_intake_owner TO postgres WITH INHERIT TRUE, SET TRUE;
GRANT CREATE ON SCHEMA gov_repo TO govia_discovery_intake_owner;

-- Strict reviewed JSON domain; caller hashes never establish authority.
CREATE FUNCTION gov_repo.discovery_machine_canonical_json_v1(p_value jsonb)
RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog, pg_temp AS $fn$
DECLARE v_kind text; v_result text; v_text text; v_key text; v_child jsonb; v_deep boolean;
BEGIN
  IF p_value IS NULL OR pg_catalog.octet_length(p_value::text) > 65536 THEN
    RAISE EXCEPTION 'DISCOVERY_MACHINE_MALFORMED_COMMAND' USING ERRCODE='22023';
  END IF;
  WITH RECURSIVE nodes(v,depth) AS (
    VALUES (p_value,0)
    UNION ALL
    SELECT child.v,n.depth+1 FROM nodes n CROSS JOIN LATERAL (
      SELECT e.value AS v FROM pg_catalog.jsonb_each(CASE WHEN pg_catalog.jsonb_typeof(n.v)='object' THEN n.v ELSE '{}'::jsonb END) e
      UNION ALL
      SELECT a.value FROM pg_catalog.jsonb_array_elements(CASE WHEN pg_catalog.jsonb_typeof(n.v)='array' THEN n.v ELSE '[]'::jsonb END) a
    ) child WHERE n.depth <= 8
  ) SELECT pg_catalog.bool_or(depth>8) INTO v_deep FROM nodes;
  IF v_deep THEN RAISE EXCEPTION 'DISCOVERY_MACHINE_MALFORMED_COMMAND' USING ERRCODE='22023'; END IF;
  v_kind := pg_catalog.jsonb_typeof(p_value);
  IF v_kind='object' THEN
    v_result := '';
    FOR v_key,v_child IN SELECT e.key,e.value FROM pg_catalog.jsonb_each(p_value) e ORDER BY e.key COLLATE "C" LOOP
      IF v_key COLLATE "C" !~ '^[\x01-\x7f]*$' THEN
        RAISE EXCEPTION 'DISCOVERY_MACHINE_MALFORMED_COMMAND' USING ERRCODE='22023';
      END IF;
      v_result := v_result || CASE WHEN v_result='' THEN '' ELSE ',' END || pg_catalog.to_jsonb(v_key)::text || ':' ||
        gov_repo.discovery_machine_canonical_json_v1(v_child);
    END LOOP;
    RETURN '{' || v_result || '}';
  ELSIF v_kind='array' THEN
    SELECT pg_catalog.string_agg(gov_repo.discovery_machine_canonical_json_v1(a.value),',' ORDER BY a.ordinality)
      INTO v_result FROM pg_catalog.jsonb_array_elements(p_value) WITH ORDINALITY a;
    RETURN '[' || coalesce(v_result,'') || ']';
  ELSIF v_kind='number' THEN
    v_text := p_value::text;
    IF v_text COLLATE "C" !~ '^-?(0|[1-9][0-9]*)(\.[0-9]*[1-9])?$'
       OR pg_catalog.abs(v_text::numeric) >= 1e21
       OR (v_text::numeric <> 0 AND pg_catalog.abs(v_text::numeric)<1e-6)
       OR v_text::numeric IS DISTINCT FROM (v_text::double precision)::text::numeric THEN
      RAISE EXCEPTION 'DISCOVERY_MACHINE_MALFORMED_COMMAND' USING ERRCODE='22023';
    END IF;
    RETURN v_text;
  ELSE
    RETURN p_value::text;
  END IF;
END;
$fn$;
REVOKE ALL ON FUNCTION gov_repo.discovery_machine_canonical_json_v1(jsonb) FROM PUBLIC,anon,authenticated,service_role,
  govia_discovery_provisioner,govia_discovery_machine_caller,govia_ledger_executor,govia_runtime_executor,
  govia_legacy_read_executor,govia_legacy_graph_executor;
ALTER FUNCTION gov_repo.discovery_machine_canonical_json_v1(jsonb) OWNER TO govia_discovery_intake_owner;
ALTER DEFAULT PRIVILEGES FOR ROLE govia_discovery_intake_owner REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE govia_discovery_intake_owner IN SCHEMA gov_repo REVOKE ALL ON TABLES FROM PUBLIC,anon,authenticated,service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE govia_discovery_intake_owner IN SCHEMA gov_repo REVOKE ALL ON SEQUENCES FROM PUBLIC,anon,authenticated,service_role;
-- Authoritative run provenance and one-time conclusion; legacy acquisition_runs is only a projection.
CREATE TABLE gov_repo.discovery_run_bindings (
 run_id text COLLATE "C" PRIMARY KEY,
 organisation_id uuid NOT NULL REFERENCES gov_repo.organisations,
 binding_id uuid NOT NULL,
 binding_revision bigint NOT NULL,
 principal_id uuid NOT NULL,
 admission_generation_id uuid NOT NULL,
 source_connection_id text COLLATE "C" NOT NULL,
 source_system_id text COLLATE "C" NOT NULL,
 provider text COLLATE "C" NOT NULL,
 configured_locator text COLLATE "C" NOT NULL,
 normalized_locator text COLLATE "C" NOT NULL,
 authorized_ref text COLLATE "C" NOT NULL,
 adapter_name text COLLATE "C" NOT NULL,
 adapter_version text COLLATE "C" NOT NULL,
 provider_source_id_pinned text COLLATE "C",
 provider_source_id_observed text COLLATE "C",
 provider_identity_state text NOT NULL CHECK(provider_identity_state IN ('PINNED_MATCH','UNPINNED_OBSERVED','UNPINNED_UNAVAILABLE')),
 resolved_source_version text COLLATE "C",
 observation_started_at timestamptz NOT NULL,
 admitted_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
 conclusion_status text CHECK(conclusion_status IN ('SUCCEEDED','PARTIAL','FAILED')),
 conclusion_failure_code text CHECK(conclusion_failure_code IN ('PROVIDER_REDIRECT','PROVIDER_IDENTITY_MISMATCH','ACQUISITION_FAILED')),
 conclusion_counts jsonb,
 concluded_at timestamptz,
 conclusion_generation_id uuid,
 CHECK (conclusion_failure_code IS NULL OR conclusion_status='FAILED'),
 CHECK ((conclusion_status IS NULL AND concluded_at IS NULL AND conclusion_counts IS NULL AND conclusion_generation_id IS NULL)
     OR (conclusion_status IS NOT NULL AND concluded_at IS NOT NULL AND conclusion_counts IS NOT NULL AND conclusion_generation_id IS NOT NULL)),
 UNIQUE(organisation_id,run_id),
 FOREIGN KEY(binding_id,binding_revision) REFERENCES gov_repo.machine_binding_revisions,
 FOREIGN KEY(principal_id) REFERENCES gov_repo.machine_principals,
 FOREIGN KEY(admission_generation_id) REFERENCES gov_repo.machine_credential_generations
);
CREATE TABLE gov_repo.discovery_machine_admissions (
 run_id text COLLATE "C" NOT NULL,
 organisation_id uuid NOT NULL,
 binding_id uuid NOT NULL,
 binding_revision bigint NOT NULL,
 invocation_generation_id uuid NOT NULL REFERENCES gov_repo.machine_credential_generations,
 record_kind text NOT NULL CHECK(record_kind IN ('EVIDENCE','SOURCE_ASSERTION','DISCOVERY_FINDING','NORMALIZED_CANDIDATE',
 'LINEAGE_OBSERVATION','TECHNICAL_PROFILE_PROPOSAL','EXECUTION_SNAPSHOT','REVIEW_SUBJECT')),
 record_id text COLLATE "C" NOT NULL,
 semantic_digest char(64) NOT NULL CHECK(semantic_digest ~ '^[0-9a-f]{64}$'),
 admitted_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
 PRIMARY KEY(run_id,record_kind,record_id),
 FOREIGN KEY(organisation_id,run_id) REFERENCES gov_repo.discovery_run_bindings(organisation_id,run_id),
 FOREIGN KEY(binding_id,binding_revision) REFERENCES gov_repo.machine_binding_revisions
);
CREATE INDEX discovery_machine_admission_identity ON gov_repo.discovery_machine_admissions(organisation_id,record_kind,record_id);

CREATE FUNCTION gov_repo.discovery_machine_run_binding_guard_v1() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $fn$
BEGIN
 IF TG_OP IN ('DELETE','TRUNCATE') OR TG_TABLE_NAME='discovery_machine_admissions' THEN
   RAISE EXCEPTION 'S3_IMMUTABLE'; END IF;
 IF (pg_catalog.to_jsonb(NEW)-ARRAY['conclusion_status','conclusion_failure_code','conclusion_counts','concluded_at','conclusion_generation_id'])
   IS DISTINCT FROM (pg_catalog.to_jsonb(OLD)-ARRAY['conclusion_status','conclusion_failure_code','conclusion_counts','concluded_at','conclusion_generation_id'])
   OR OLD.conclusion_status IS NOT NULL OR NEW.conclusion_status IS NULL THEN RAISE EXCEPTION 'S3_IMMUTABLE'; END IF;
 RETURN NEW;
END;
$fn$;
CREATE TRIGGER discovery_run_immutable BEFORE UPDATE OR DELETE ON gov_repo.discovery_run_bindings
 FOR EACH ROW EXECUTE FUNCTION gov_repo.discovery_machine_run_binding_guard_v1();
CREATE TRIGGER discovery_run_no_truncate BEFORE TRUNCATE ON gov_repo.discovery_run_bindings
 FOR EACH STATEMENT EXECUTE FUNCTION gov_repo.discovery_machine_run_binding_guard_v1();
CREATE TRIGGER discovery_admission_immutable BEFORE UPDATE OR DELETE ON gov_repo.discovery_machine_admissions
 FOR EACH ROW EXECUTE FUNCTION gov_repo.discovery_machine_run_binding_guard_v1();
CREATE TRIGGER discovery_admission_no_truncate BEFORE TRUNCATE ON gov_repo.discovery_machine_admissions
 FOR EACH STATEMENT EXECUTE FUNCTION gov_repo.discovery_machine_run_binding_guard_v1();

-- The only S3 -> S2 bridge. Nothing from the control plane escapes before S2 eligibility succeeds.
CREATE FUNCTION gov_repo.discovery_machine_authorize_v1(p_binding uuid,p_expected_revision bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp SET lock_timeout = '5s' AS $fn$
DECLARE v_revision bigint; v_auth record;
BEGIN
 v_revision := p_expected_revision;
 IF v_revision IS NULL THEN
   SELECT b.binding_revision INTO v_revision FROM gov_repo.machine_execution_bindings b WHERE b.binding_id=p_binding;
 END IF;
 SELECT * INTO v_auth FROM gov_repo.machine_lock_eligibility_v1(p_binding,v_revision);
 RETURN pg_catalog.jsonb_build_object('principal_id',v_auth.principal_id,'credential_generation_id',v_auth.generation_id,
   'binding_id',(v_auth.binding).binding_id,'binding_revision',(v_auth.binding).binding_revision,
   'organisation_id',(v_auth.binding).organisation_id,'source_connection_id',(v_auth.binding).source_connection_id,
   'provider',(v_auth.binding).provider,'configured_locator',(v_auth.binding).configured_locator,
   'normalized_locator',(v_auth.binding).normalized_locator,'provider_source_id',(v_auth.binding).provider_source_id,
   'authorized_ref',(v_auth.binding).authorized_ref,'adapter_name',(v_auth.binding).adapter_name,
   'adapter_version',(v_auth.binding).adapter_version,'intake_enabled',(v_auth.binding).intake_enabled);
EXCEPTION WHEN insufficient_privilege THEN
 IF SQLERRM IN ('S2_CREDENTIAL_INELIGIBLE','S2_SCOPE_INELIGIBLE') THEN
   RAISE EXCEPTION 'S3_DENIED' USING ERRCODE='P0301';
 END IF;
 RAISE;
END;
$fn$;

CREATE FUNCTION gov_repo.discovery_machine_lock_run_v1(p_run text,p_complete boolean)
RETURNS gov_repo.discovery_run_bindings LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $fn$
DECLARE v_run gov_repo.discovery_run_bindings; v_auth jsonb;
BEGIN
 IF p_run IS NULL OR p_run COLLATE "C" !~ '^acquisition-run:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
   RAISE EXCEPTION 'DISCOVERY_MACHINE_MALFORMED_COMMAND' USING ERRCODE='22023'; END IF;
 SELECT * INTO v_run FROM gov_repo.discovery_run_bindings WHERE run_id=p_run;
 v_auth := gov_repo.discovery_machine_authorize_v1(coalesce(v_run.binding_id,'00000000-0000-0000-0000-000000000000'::uuid),v_run.binding_revision);
 IF v_auth->>'intake_enabled' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'S3_DENIED' USING ERRCODE='P0301'; END IF;
 IF p_complete THEN SELECT * INTO v_run FROM gov_repo.discovery_run_bindings WHERE run_id=p_run FOR UPDATE;
 ELSE SELECT * INTO v_run FROM gov_repo.discovery_run_bindings WHERE run_id=p_run FOR SHARE; END IF;
 RETURN v_run;
END;
$fn$;

CREATE FUNCTION gov_repo.discovery_machine_open_run_v1(p_binding uuid,p_configured text,p_ref text,p_adapter text,p_version text,
 p_provider_id text,p_source_version text,p_started timestamptz)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp SET lock_timeout = '5s' AS $fn$
DECLARE v_auth jsonb; v_run text; v_state text; v_provenance jsonb;
BEGIN
 IF p_binding IS NULL OR p_started IS NULL OR NOT pg_catalog.isfinite(p_started) OR p_started>pg_catalog.clock_timestamp()+interval '5 minutes'
   OR EXISTS(SELECT 1 FROM pg_catalog.unnest(ARRAY[p_configured,p_ref,p_adapter,p_version]) v
     WHERE v IS NULL OR pg_catalog.length(v) NOT BETWEEN 1 AND 4096 OR v COLLATE "C" ~ '[\x01-\x1f\x7f-\x9f]')
   OR (p_provider_id IS NOT NULL AND p_provider_id COLLATE "C" !~ '^[1-9][0-9]{0,19}$')
   OR (p_source_version IS NOT NULL AND p_source_version COLLATE "C" !~ '^commit:[0-9a-f]{40}$') THEN
   RAISE EXCEPTION 'DISCOVERY_MACHINE_MALFORMED_COMMAND' USING ERRCODE='22023'; END IF;
 v_auth := gov_repo.discovery_machine_authorize_v1(p_binding,NULL);
 IF v_auth->>'intake_enabled' IS DISTINCT FROM 'true'
   OR (v_auth->>'configured_locator') COLLATE "C" IS DISTINCT FROM p_configured COLLATE "C"
   OR (v_auth->>'authorized_ref') COLLATE "C" IS DISTINCT FROM p_ref COLLATE "C"
   OR (v_auth->>'adapter_name') COLLATE "C" IS DISTINCT FROM p_adapter COLLATE "C"
   OR (v_auth->>'adapter_version') COLLATE "C" IS DISTINCT FROM p_version COLLATE "C"
   OR (v_auth->>'provider_source_id' IS NOT NULL AND (v_auth->>'provider_source_id') COLLATE "C" IS DISTINCT FROM p_provider_id COLLATE "C")
 THEN RAISE EXCEPTION 'S3_DENIED' USING ERRCODE='P0301'; END IF;
 v_state := CASE WHEN v_auth->>'provider_source_id' IS NOT NULL THEN 'PINNED_MATCH'
   WHEN p_provider_id IS NOT NULL THEN 'UNPINNED_OBSERVED' ELSE 'UNPINNED_UNAVAILABLE' END;
 v_run := 'acquisition-run:'||pg_catalog.gen_random_uuid()::text;
 INSERT INTO gov_repo.acquisition_runs(run_id,organisation_id,source_connection_id,source_system_id,adapter_name,adapter_version,
 mode,status,source_version,started_at) VALUES(v_run,(v_auth->>'organisation_id')::uuid,v_auth->>'source_connection_id',
 'source-system:'||(v_auth->>'provider'),v_auth->>'adapter_name',v_auth->>'adapter_version','FULL','RUNNING',p_source_version,p_started);
 INSERT INTO gov_repo.discovery_run_bindings(run_id,organisation_id,binding_id,binding_revision,principal_id,admission_generation_id,
 source_connection_id,source_system_id,provider,configured_locator,normalized_locator,authorized_ref,adapter_name,adapter_version,
 provider_source_id_pinned,provider_source_id_observed,provider_identity_state,resolved_source_version,observation_started_at)
 VALUES(v_run,(v_auth->>'organisation_id')::uuid,p_binding,(v_auth->>'binding_revision')::bigint,(v_auth->>'principal_id')::uuid,
 (v_auth->>'credential_generation_id')::uuid,v_auth->>'source_connection_id','source-system:'||(v_auth->>'provider'),v_auth->>'provider',
 v_auth->>'configured_locator',v_auth->>'normalized_locator',v_auth->>'authorized_ref',v_auth->>'adapter_name',v_auth->>'adapter_version',
 v_auth->>'provider_source_id',p_provider_id,v_state,p_source_version,p_started);
 PERFORM gov_repo.discovery_machine_authorize_v1(p_binding,(v_auth->>'binding_revision')::bigint);
 SELECT pg_catalog.to_jsonb(r)-ARRAY['conclusion_status','conclusion_failure_code','conclusion_counts','concluded_at','conclusion_generation_id']
 INTO v_provenance FROM gov_repo.discovery_run_bindings r WHERE run_id=v_run;
 RETURN pg_catalog.jsonb_build_object('outcome','APPLIED','provenance',v_provenance);
EXCEPTION WHEN SQLSTATE 'P0301' THEN RETURN '{"outcome":"DENIED","denial_code":"BINDING_NOT_ELIGIBLE"}'::jsonb;
END;
$fn$;

CREATE FUNCTION gov_repo.discovery_machine_complete_run_v1(p_run text,p_status text,p_counts jsonb,p_completed timestamptz,p_failure text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp SET lock_timeout = '5s' AS $fn$
DECLARE v_run gov_repo.discovery_run_bindings; v_auth jsonb; v_replay boolean;
BEGIN
 IF p_status IS NULL OR p_status NOT IN ('SUCCEEDED','PARTIAL','FAILED')
 OR p_completed IS NULL OR NOT pg_catalog.isfinite(p_completed)
 OR p_completed>pg_catalog.clock_timestamp()+interval '5 minutes'
 OR (p_failure IS NOT NULL AND (p_status<>'FAILED' OR p_failure NOT IN ('PROVIDER_REDIRECT','PROVIDER_IDENTITY_MISMATCH','ACQUISITION_FAILED')))
 OR pg_catalog.jsonb_typeof(p_counts) IS DISTINCT FROM 'object' THEN
  RAISE EXCEPTION 'DISCOVERY_MACHINE_MALFORMED_COMMAND' USING ERRCODE='22023'; END IF;
 IF NOT (p_counts ?& ARRAY['artifactsScanned','findingsDetected','objectCandidates','relationshipCandidates','reviewSubjectsCreated','proposalsCreated','alreadyGoverned','itemFailures'])
 OR p_counts-ARRAY['artifactsScanned','findingsDetected','objectCandidates','relationshipCandidates','reviewSubjectsCreated','proposalsCreated','alreadyGoverned','itemFailures']<>'{}'::jsonb
 OR EXISTS(SELECT 1 FROM pg_catalog.jsonb_each(p_counts) e WHERE pg_catalog.jsonb_typeof(e.value)<>'number'
 OR e.value::text !~ '^(0|[1-9][0-9]{0,9})$' OR e.value::numeric>2147483647)
 OR p_counts->>'proposalsCreated'<>'0' THEN
  RAISE EXCEPTION 'DISCOVERY_MACHINE_MALFORMED_COMMAND' USING ERRCODE='22023'; END IF;
 v_run:=gov_repo.discovery_machine_lock_run_v1(p_run,true);
 IF p_completed<v_run.observation_started_at THEN RAISE EXCEPTION 'DISCOVERY_MACHINE_MALFORMED_COMMAND' USING ERRCODE='22023'; END IF;
 v_auth:=gov_repo.discovery_machine_authorize_v1(v_run.binding_id,v_run.binding_revision);
 v_replay:=v_run.conclusion_status IS NOT NULL;
 IF v_replay THEN
  IF v_run.conclusion_status IS DISTINCT FROM p_status OR v_run.conclusion_failure_code IS DISTINCT FROM p_failure
   OR v_run.conclusion_counts IS DISTINCT FROM p_counts OR v_run.concluded_at IS DISTINCT FROM p_completed THEN
   RETURN '{"outcome":"CONTENT_CONFLICT"}'::jsonb; END IF;
 ELSE
  UPDATE gov_repo.discovery_run_bindings SET conclusion_status=p_status,conclusion_failure_code=p_failure,conclusion_counts=p_counts,
   concluded_at=p_completed,conclusion_generation_id=(v_auth->>'credential_generation_id')::uuid WHERE run_id=p_run;
  UPDATE gov_repo.acquisition_runs SET status=p_status,completed_at=p_completed,
   artifacts_scanned=(p_counts->>'artifactsScanned')::int,findings_detected=(p_counts->>'findingsDetected')::int,
   object_candidates=(p_counts->>'objectCandidates')::int,relationship_candidates=(p_counts->>'relationshipCandidates')::int,
   review_subjects_created=(p_counts->>'reviewSubjectsCreated')::int,proposals_created=0,
   already_governed=(p_counts->>'alreadyGoverned')::int,item_failures=(p_counts->>'itemFailures')::int
   WHERE run_id=p_run AND organisation_id=v_run.organisation_id;
 END IF;
 PERFORM gov_repo.discovery_machine_authorize_v1(v_run.binding_id,v_run.binding_revision);
 RETURN pg_catalog.jsonb_build_object('outcome',CASE WHEN v_replay THEN 'REPLAYED' ELSE 'APPLIED' END,'acquisitionRunId',p_run);
EXCEPTION WHEN SQLSTATE 'P0301' THEN RETURN '{"outcome":"DENIED","denial_code":"BINDING_NOT_ELIGIBLE"}'::jsonb;
END;
$fn$;

CREATE FUNCTION gov_repo.discovery_machine_semantic_digest_v1(p_kind text,p_envelope jsonb)
RETURNS char(64) LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog, pg_temp AS $fn$
DECLARE v jsonb:=p_envelope;
BEGIN
 IF p_kind='EVIDENCE' THEN v:=v-'capturedAt';
 ELSIF p_kind='SOURCE_ASSERTION' THEN v:=(v-ARRAY['runId','observedAt','recordedAt','syncedAt'])#-'{snapshot,observedAt}';
 ELSIF p_kind IN ('DISCOVERY_FINDING','LINEAGE_OBSERVATION') THEN v:=v-'detectedAt';
 ELSIF p_kind='EXECUTION_SNAPSHOT' THEN v:=v-'recordedAt';
 ELSIF p_kind NOT IN ('NORMALIZED_CANDIDATE','TECHNICAL_PROFILE_PROPOSAL','REVIEW_SUBJECT') THEN
  RAISE EXCEPTION 'DISCOVERY_MACHINE_MALFORMED_COMMAND' USING ERRCODE='22023'; END IF;
 RETURN pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(gov_repo.discovery_machine_canonical_json_v1(v),'UTF8')),'hex');
END;
$fn$;

CREATE FUNCTION gov_repo.discovery_machine_record_admission_v1(p_run text,p_kind text,p_id text,p_digest char(64),p_created boolean,p_generation uuid)
RETURNS boolean LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $fn$
DECLARE v_run gov_repo.discovery_run_bindings; v_new boolean;
BEGIN
 SELECT * INTO STRICT v_run FROM gov_repo.discovery_run_bindings WHERE run_id=p_run;
 -- Commands acquire every record lock in a sorted order before reaching this helper.
 IF EXISTS(SELECT 1 FROM gov_repo.discovery_machine_admissions a WHERE a.organisation_id=v_run.organisation_id
  AND a.record_kind=p_kind AND a.record_id=p_id AND a.semantic_digest<>p_digest) THEN
  RAISE EXCEPTION 'S3_CONTENT_CONFLICT' USING ERRCODE='P0302'; END IF;
 INSERT INTO gov_repo.discovery_machine_admissions(run_id,organisation_id,binding_id,binding_revision,invocation_generation_id,record_kind,record_id,semantic_digest)
 VALUES(p_run,v_run.organisation_id,v_run.binding_id,v_run.binding_revision,p_generation,p_kind,p_id,p_digest)
 ON CONFLICT DO NOTHING;
 v_new:=FOUND;
 IF NOT EXISTS(SELECT 1 FROM gov_repo.discovery_machine_admissions a WHERE a.run_id=p_run AND a.record_kind=p_kind
  AND a.record_id=p_id AND a.semantic_digest=p_digest) THEN RAISE EXCEPTION 'S3_CONTENT_CONFLICT' USING ERRCODE='P0302'; END IF;
 RETURN v_new OR p_created;
END;
$fn$;

CREATE FUNCTION gov_repo.discovery_machine_admit_observation_v1(p_run text,p_evidence jsonb,p_assertion jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp SET lock_timeout = '5s' AS $fn$
DECLARE v_run gov_repo.discovery_run_bindings; v_auth jsonb; e jsonb; loc jsonb; h jsonb; v_old jsonb; v_digest char(64);
 v_hash char(64); v_new boolean:=false; v_created boolean; v_id text; v_execution boolean; v_ids text[]; v_asserted text[];
BEGIN
 IF pg_catalog.jsonb_typeof(p_evidence) IS DISTINCT FROM 'array' OR pg_catalog.jsonb_typeof(p_assertion) IS DISTINCT FROM 'object' THEN
  RAISE EXCEPTION 'DISCOVERY_MACHINE_MALFORMED_COMMAND' USING ERRCODE='22023'; END IF;
 IF pg_catalog.jsonb_array_length(p_evidence) NOT BETWEEN 1 AND 64
 OR NOT(p_assertion ?& ARRAY['assertionId','sourceObject','runId','snapshot','method','trustState','observedAt','recordedAt','evidenceIds'])
 OR p_assertion-ARRAY['assertionId','sourceObject','runId','snapshot','method','trustState','confidence','observedAt','recordedAt','syncedAt','evidenceIds']<>'{}'::jsonb
 OR pg_catalog.jsonb_typeof(p_assertion->'evidenceIds') IS DISTINCT FROM 'array'
 OR pg_catalog.jsonb_typeof(p_assertion->'sourceObject') IS DISTINCT FROM 'object'
 OR pg_catalog.jsonb_typeof(p_assertion->'snapshot') IS DISTINCT FROM 'object'
 OR pg_catalog.jsonb_typeof(p_assertion->'method') IS DISTINCT FROM 'object'
 OR p_assertion->>'trustState' NOT IN ('INFERRED','DECLARED','OBSERVED') THEN
  RAISE EXCEPTION 'DISCOVERY_MACHINE_MALFORMED_COMMAND' USING ERRCODE='22023'; END IF;
 PERFORM gov_repo.discovery_machine_canonical_json_v1(p_assertion);
 v_execution:=(p_assertion->>'assertionId') COLLATE "C" ~ '^execution-assertion:[0-9a-f]{64}$';
 IF NOT v_execution AND (p_assertion->>'assertionId') COLLATE "C" !~ '^source-assertion:[0-9a-f]{32}$' THEN
  RAISE EXCEPTION 'DISCOVERY_MACHINE_MALFORMED_COMMAND' USING ERRCODE='22023'; END IF;
 IF (p_assertion->'sourceObject')-ARRAY['connectionId','externalType','externalId']<>'{}'::jsonb
 OR NOT((p_assertion->'sourceObject') ?& ARRAY['connectionId','externalType','externalId'])
 OR (p_assertion->'snapshot')-ARRAY['snapshotId','sourceObject','observedAt','sourceVersion','contentHash','locator']<>'{}'::jsonb
 OR NOT((p_assertion->'snapshot') ?& ARRAY['snapshotId','sourceObject','observedAt','sourceVersion','contentHash','locator'])
 OR (p_assertion->'method')-ARRAY['code','version']<>'{}'::jsonb
 OR NOT((p_assertion->'method') ?& ARRAY['code','version'])
 OR p_assertion#>>'{snapshot,snapshotId}' !~ '^source-snapshot:[0-9a-f]{32}$'
 OR p_assertion#>>'{snapshot,contentHash,algorithm}' IS DISTINCT FROM 'sha256'
 OR coalesce(p_assertion#>>'{snapshot,contentHash,value}','') !~ '^[0-9a-f]{64}$'
 OR (p_assertion#>'{snapshot,contentHash}')-ARRAY['algorithm','value']<>'{}'::jsonb
 OR EXISTS(SELECT 1 FROM pg_catalog.jsonb_each(p_assertion->'sourceObject') x WHERE pg_catalog.jsonb_typeof(x.value)<>'string' OR pg_catalog.length(x.value#>>'{}') NOT BETWEEN 1 AND 4096)
 OR (p_assertion ? 'confidence' AND (pg_catalog.jsonb_typeof(p_assertion->'confidence')<>'number' OR (p_assertion->>'confidence')::numeric NOT BETWEEN 0 AND 1))
 THEN RAISE EXCEPTION 'DISCOVERY_MACHINE_MALFORMED_COMMAND' USING ERRCODE='22023'; END IF;
 IF v_execution AND (p_assertion#>>'{method,code}' IS DISTINCT FROM 'DIRECT_AGENT_EXECUTION_V1'
 OR p_assertion#>>'{method,version}' IS DISTINCT FROM '1.0' OR p_assertion->>'trustState' IS DISTINCT FROM 'DECLARED') THEN
  RAISE EXCEPTION 'DISCOVERY_MACHINE_MALFORMED_COMMAND' USING ERRCODE='22023'; END IF;
 v_run:=gov_repo.discovery_machine_lock_run_v1(p_run,false);
 IF v_run.conclusion_status IS NOT NULL THEN RETURN '{"outcome":"STATE_CONFLICT"}'::jsonb; END IF;
 v_auth:=gov_repo.discovery_machine_authorize_v1(v_run.binding_id,v_run.binding_revision);
 IF p_assertion->>'runId' IS DISTINCT FROM p_run
 OR p_assertion#>>'{sourceObject,connectionId}' IS DISTINCT FROM v_run.source_connection_id
 OR p_assertion#>>'{sourceObject,externalType}' IS DISTINCT FROM 'file'
 OR p_assertion#>'{snapshot,sourceObject}' IS DISTINCT FROM p_assertion->'sourceObject'
 OR p_assertion#>>'{snapshot,sourceVersion}' IS DISTINCT FROM v_run.resolved_source_version
 OR coalesce(p_assertion#>>'{snapshot,sourceVersion}','') !~ '^commit:[0-9a-f]{40}$' THEN
  RAISE EXCEPTION 'S3_DENIED' USING ERRCODE='P0301'; END IF;
 SELECT pg_catalog.array_agg(x->>'evidenceId' ORDER BY x->>'evidenceId') INTO v_ids FROM pg_catalog.jsonb_array_elements(p_evidence) x;
 SELECT pg_catalog.array_agg(x ORDER BY x) INTO v_asserted FROM pg_catalog.jsonb_array_elements_text(p_assertion->'evidenceIds') x;
 IF v_ids IS DISTINCT FROM v_asserted OR pg_catalog.cardinality(v_ids)<>(SELECT count(DISTINCT x) FROM pg_catalog.unnest(v_ids) x) THEN
  RAISE EXCEPTION 'S3_DENIED' USING ERRCODE='P0301'; END IF;
 FOR e IN SELECT value FROM pg_catalog.jsonb_array_elements(p_evidence) LOOP
  PERFORM gov_repo.discovery_machine_canonical_json_v1(e);
  IF pg_catalog.jsonb_typeof(e)<>'object' OR NOT(e ?& ARRAY['evidenceId','handling','locations','hashes','capturedAt'])
  OR e-ARRAY['evidenceId','handling','locations','hashes','capturedAt','redactedExcerpt']<>'{}'::jsonb
  OR coalesce(e->>'evidenceId','') !~ (CASE WHEN v_execution THEN '^execution-evidence:[0-9a-f]{64}$' ELSE '^evidence:[0-9a-f]{32}$' END)
  OR coalesce(e->>'handling','') NOT IN ('HASH_ONLY','REDACTED','NON_SENSITIVE')
  OR pg_catalog.jsonb_typeof(e->'locations') IS DISTINCT FROM 'array' OR pg_catalog.jsonb_typeof(e->'hashes') IS DISTINCT FROM 'array'
  OR (e ? 'redactedExcerpt' AND (pg_catalog.jsonb_typeof(e->'redactedExcerpt')<>'string' OR pg_catalog.octet_length(e->>'redactedExcerpt')>16384)) THEN
   RAISE EXCEPTION 'DISCOVERY_MACHINE_MALFORMED_COMMAND' USING ERRCODE='22023'; END IF;
  IF v_execution AND (pg_catalog.cardinality(v_ids)<>1 OR pg_catalog.substr(e->>'evidenceId',20)<>pg_catalog.substr(p_assertion->>'assertionId',21)
   OR e->>'handling'<>'HASH_ONLY' OR e ? 'redactedExcerpt') THEN RAISE EXCEPTION 'DISCOVERY_MACHINE_MALFORMED_COMMAND' USING ERRCODE='22023'; END IF;
  IF pg_catalog.jsonb_array_length(e->'locations') NOT BETWEEN 1 AND 64 OR pg_catalog.jsonb_array_length(e->'hashes') NOT BETWEEN 1 AND 64 THEN
   RAISE EXCEPTION 'DISCOVERY_MACHINE_MALFORMED_COMMAND' USING ERRCODE='22023'; END IF;
  FOR loc IN SELECT value FROM pg_catalog.jsonb_array_elements(e->'locations') LOOP
   IF pg_catalog.jsonb_typeof(loc)<>'object' OR loc-ARRAY['kind','locator','path','commit','lineStart','lineEnd']<>'{}'::jsonb
    OR NOT(loc ?& ARRAY['kind','locator','path']) OR loc->>'kind' IS DISTINCT FROM 'REPOSITORY' THEN
    RAISE EXCEPTION 'DISCOVERY_MACHINE_MALFORMED_COMMAND' USING ERRCODE='22023'; END IF;
   IF loc->>'path' IS DISTINCT FROM p_assertion#>>'{sourceObject,externalId}'
    OR loc->>'locator' IS DISTINCT FROM p_assertion#>>'{snapshot,locator}'
    OR ((NOT v_execution OR loc ? 'commit') AND loc->>'commit' IS DISTINCT FROM pg_catalog.substr(v_run.resolved_source_version,8)) THEN
    RAISE EXCEPTION 'S3_DENIED' USING ERRCODE='P0301'; END IF;
   IF EXISTS(SELECT 1 FROM pg_catalog.jsonb_each(loc) l WHERE l.key IN ('lineStart','lineEnd')
    AND (pg_catalog.jsonb_typeof(l.value)<>'number' OR l.value::text !~ '^[1-9][0-9]{0,8}$'))
    OR (loc ?& ARRAY['lineStart','lineEnd'] AND (loc->>'lineEnd')::int<(loc->>'lineStart')::int) THEN
    RAISE EXCEPTION 'DISCOVERY_MACHINE_MALFORMED_COMMAND' USING ERRCODE='22023'; END IF;
  END LOOP;
  FOR h IN SELECT value FROM pg_catalog.jsonb_array_elements(e->'hashes') LOOP
   IF pg_catalog.jsonb_typeof(h)<>'object' OR h-ARRAY['algorithm','value']<>'{}'::jsonb OR h->>'algorithm' IS DISTINCT FROM 'sha256'
    OR coalesce(h->>'value','') !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'DISCOVERY_MACHINE_MALFORMED_COMMAND' USING ERRCODE='22023'; END IF;
  END LOOP;
 END LOOP;
 -- A single sorted lock list covers evidence and assertion records before any insert.
 FOR v_id IN SELECT x FROM (SELECT 'EVIDENCE:'||(item.value->>'evidenceId') x FROM pg_catalog.jsonb_array_elements(p_evidence) item
  UNION ALL SELECT 'SOURCE_ASSERTION:'||(p_assertion->>'assertionId')) ids ORDER BY x COLLATE "C" LOOP
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_run.organisation_id::text||':discovery-machine:'||v_id,0));
 END LOOP;
 FOR e IN SELECT value FROM pg_catalog.jsonb_array_elements(p_evidence) LOOP
  v_digest:=gov_repo.discovery_machine_semantic_digest_v1('EVIDENCE',e);
  v_hash:=pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(gov_repo.discovery_machine_canonical_json_v1(e),'UTF8')),'hex');
  v_created:=true;
  BEGIN
   INSERT INTO gov_repo.discovery_evidence(organisation_id,evidence_id,handling,captured_at,content_hash,contract_version,envelope,envelope_hash)
   VALUES(v_run.organisation_id,e->>'evidenceId',e->>'handling',(e->>'capturedAt')::timestamptz,e#>>'{hashes,0,value}','1.0',e,v_hash);
  EXCEPTION WHEN unique_violation THEN v_created:=false; END;
  SELECT envelope INTO STRICT v_old FROM gov_repo.discovery_evidence WHERE organisation_id=v_run.organisation_id AND evidence_id=e->>'evidenceId';
  IF gov_repo.discovery_machine_semantic_digest_v1('EVIDENCE',v_old)<>v_digest THEN RAISE EXCEPTION 'S3_CONTENT_CONFLICT' USING ERRCODE='P0302'; END IF;
  v_new:=gov_repo.discovery_machine_record_admission_v1(p_run,'EVIDENCE',e->>'evidenceId',v_digest,v_created,(v_auth->>'credential_generation_id')::uuid) OR v_new;
 END LOOP;
 v_digest:=gov_repo.discovery_machine_semantic_digest_v1('SOURCE_ASSERTION',p_assertion);
 v_hash:=pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(gov_repo.discovery_machine_canonical_json_v1(p_assertion),'UTF8')),'hex');
 v_created:=true;
 BEGIN
 INSERT INTO gov_repo.source_assertions(organisation_id,assertion_id,run_id,source_connection_id,source_external_type,source_external_id,
 snapshot_id,snapshot_content_hash,snapshot_observed_at,snapshot_source_version,method_code,method_version,trust_state,confidence,
 observed_at,synced_at,recorded_at,contract_version,envelope,envelope_hash)
 VALUES(v_run.organisation_id,p_assertion->>'assertionId',p_run,v_run.source_connection_id,'file',p_assertion#>>'{sourceObject,externalId}',
 p_assertion#>>'{snapshot,snapshotId}',p_assertion#>>'{snapshot,contentHash,value}',(p_assertion#>>'{snapshot,observedAt}')::timestamptz,
 v_run.resolved_source_version,p_assertion#>>'{method,code}',p_assertion#>>'{method,version}',p_assertion->>'trustState',
 (p_assertion->>'confidence')::double precision,(p_assertion->>'observedAt')::timestamptz,(p_assertion->>'syncedAt')::timestamptz,
 (p_assertion->>'recordedAt')::timestamptz,'1.0',p_assertion,v_hash);
 EXCEPTION WHEN unique_violation THEN v_created:=false; END;
 SELECT envelope INTO STRICT v_old FROM gov_repo.source_assertions WHERE organisation_id=v_run.organisation_id AND assertion_id=p_assertion->>'assertionId';
 IF gov_repo.discovery_machine_semantic_digest_v1('SOURCE_ASSERTION',v_old)<>v_digest THEN RAISE EXCEPTION 'S3_CONTENT_CONFLICT' USING ERRCODE='P0302'; END IF;
 FOR v_id IN SELECT x FROM pg_catalog.unnest(v_ids) x LOOP
  BEGIN
   INSERT INTO gov_repo.source_assertion_evidence(organisation_id,assertion_id,evidence_id)
   VALUES(v_run.organisation_id,p_assertion->>'assertionId',v_id);
  EXCEPTION WHEN unique_violation THEN NULL; END;
 END LOOP;
 v_new:=gov_repo.discovery_machine_record_admission_v1(p_run,'SOURCE_ASSERTION',p_assertion->>'assertionId',v_digest,v_created,(v_auth->>'credential_generation_id')::uuid) OR v_new;
 PERFORM gov_repo.discovery_machine_authorize_v1(v_run.binding_id,v_run.binding_revision);
 RETURN pg_catalog.jsonb_build_object('outcome',CASE WHEN v_new THEN 'APPLIED' ELSE 'REPLAYED' END,'assertionId',p_assertion->>'assertionId');
EXCEPTION WHEN SQLSTATE 'P0301' THEN RETURN '{"outcome":"DENIED","denial_code":"BINDING_NOT_ELIGIBLE"}'::jsonb;
 WHEN SQLSTATE 'P0302' THEN RETURN '{"outcome":"CONTENT_CONFLICT"}'::jsonb;
END;
$fn$;

CREATE FUNCTION gov_repo.discovery_machine_write_finding_v1(p_run gov_repo.discovery_run_bindings,p_finding jsonb,p_lineage boolean)
RETURNS boolean LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $fn$
DECLARE v_id text:=p_finding->>'findingId'; v_old jsonb; v_digest char(64); v_created boolean:=true; v_support text; v_generation uuid;
BEGIN
 PERFORM gov_repo.discovery_machine_canonical_json_v1(p_finding);
 IF pg_catalog.jsonb_typeof(p_finding) IS DISTINCT FROM 'object'
 OR NOT(p_finding ?& ARRAY['findingId','findingNature','candidateKind','sourceObject','assertionIds','evidenceIds','confidence','reviewStatus','requiresReview','createsCanonicalObject','detectedAt'])
 OR p_finding-ARRAY['findingId','findingNature','candidateKind','sourceObject','assertionIds','evidenceIds','confidence','reviewStatus','requiresReview','createsCanonicalObject','detectedAt']<>'{}'::jsonb
 OR p_finding->>'findingNature' IS DISTINCT FROM 'CANDIDATE' OR p_finding->>'reviewStatus' IS DISTINCT FROM 'UNREVIEWED'
 OR p_finding->'requiresReview' IS DISTINCT FROM 'true'::jsonb OR p_finding->'createsCanonicalObject' IS DISTINCT FROM 'false'::jsonb
 OR coalesce(p_finding->>'candidateKind','') NOT IN ('AGENT','AGENT_VERSION','MODEL','TOOL','MCP_SERVER','API','PROMPT','KNOWLEDGE_BASE','DATA_ASSET','DATA_ELEMENT','SKILL','RELATIONSHIP')
 OR coalesce(v_id,'') !~ '^discovery-finding:((agent-version|relationship|lineage-observation):)?([0-9a-f]{32}|[0-9a-f]{64})$'
 OR (v_id LIKE 'discovery-finding:lineage-observation:%' AND NOT p_lineage)
 OR (v_id LIKE 'discovery-finding:agent-version:%') IS DISTINCT FROM (p_finding->>'candidateKind'='AGENT_VERSION')
 OR (v_id LIKE 'discovery-finding:relationship:%' OR v_id LIKE 'discovery-finding:lineage-observation:%') IS DISTINCT FROM (p_finding->>'candidateKind'='RELATIONSHIP')
 OR pg_catalog.jsonb_typeof(p_finding->'assertionIds') IS DISTINCT FROM 'array'
 OR pg_catalog.jsonb_typeof(p_finding->'evidenceIds') IS DISTINCT FROM 'array'
 OR pg_catalog.jsonb_typeof(p_finding->'confidence') IS DISTINCT FROM 'number'
 OR (p_finding->>'confidence')::numeric NOT BETWEEN 0 AND 1
 OR pg_catalog.jsonb_typeof(p_finding->'sourceObject') IS DISTINCT FROM 'object'
 OR (p_finding->'sourceObject')-ARRAY['connectionId','externalType','externalId']<>'{}'::jsonb THEN
  RAISE EXCEPTION 'DISCOVERY_MACHINE_MALFORMED_COMMAND' USING ERRCODE='22023'; END IF;
 IF p_finding#>>'{sourceObject,connectionId}' IS DISTINCT FROM p_run.source_connection_id
 OR p_finding#>>'{sourceObject,externalType}' IS DISTINCT FROM 'file'
 OR coalesce(pg_catalog.length(p_finding#>>'{sourceObject,externalId}'),0) NOT BETWEEN 1 AND 4096 THEN
  RAISE EXCEPTION 'S3_DENIED' USING ERRCODE='P0301'; END IF;
 IF pg_catalog.jsonb_array_length(p_finding->'assertionIds') NOT BETWEEN 1 AND 256 OR pg_catalog.jsonb_array_length(p_finding->'evidenceIds') NOT BETWEEN 1 AND 256 THEN
  RAISE EXCEPTION 'DISCOVERY_MACHINE_MALFORMED_COMMAND' USING ERRCODE='22023'; END IF;
 IF EXISTS(SELECT 1 FROM pg_catalog.jsonb_array_elements_text(p_finding->'assertionIds') x WHERE NOT EXISTS(
  SELECT 1 FROM gov_repo.discovery_machine_admissions a JOIN gov_repo.source_assertions s ON s.organisation_id=a.organisation_id AND s.assertion_id=a.record_id
  WHERE a.run_id=p_run.run_id AND a.organisation_id=p_run.organisation_id AND a.record_kind='SOURCE_ASSERTION' AND a.record_id=x
   AND s.source_connection_id=p_run.source_connection_id))
 OR EXISTS(SELECT 1 FROM pg_catalog.jsonb_array_elements_text(p_finding->'evidenceIds') x WHERE NOT EXISTS(
  SELECT 1 FROM gov_repo.discovery_machine_admissions a JOIN gov_repo.discovery_evidence e ON e.organisation_id=a.organisation_id AND e.evidence_id=a.record_id
  WHERE a.run_id=p_run.run_id AND a.organisation_id=p_run.organisation_id AND a.record_kind='EVIDENCE' AND a.record_id=x)) THEN
  RAISE EXCEPTION 'S3_DENIED' USING ERRCODE='P0301'; END IF;
 v_digest:=gov_repo.discovery_machine_semantic_digest_v1('DISCOVERY_FINDING',p_finding);
 BEGIN
  INSERT INTO gov_repo.discovery_findings(organisation_id,finding_id,finding_nature,candidate_kind,source_connection_id,source_external_type,source_external_id,
  confidence,review_status,requires_review,creates_canonical_object,detected_at,acquisition_run_id,contract_version,envelope,envelope_hash)
  VALUES(p_run.organisation_id,v_id,'CANDIDATE',p_finding->>'candidateKind',p_run.source_connection_id,'file',p_finding#>>'{sourceObject,externalId}',
  (p_finding->>'confidence')::double precision,'UNREVIEWED',true,false,(p_finding->>'detectedAt')::timestamptz,p_run.run_id,'1.0',p_finding,
  pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(gov_repo.discovery_machine_canonical_json_v1(p_finding),'UTF8')),'hex'));
 EXCEPTION WHEN unique_violation THEN v_created:=false; END;
 SELECT envelope INTO STRICT v_old FROM gov_repo.discovery_findings WHERE organisation_id=p_run.organisation_id AND finding_id=v_id;
 IF gov_repo.discovery_machine_semantic_digest_v1('DISCOVERY_FINDING',v_old)<>v_digest THEN RAISE EXCEPTION 'S3_CONTENT_CONFLICT' USING ERRCODE='P0302'; END IF;
 FOR v_support IN SELECT value FROM pg_catalog.jsonb_array_elements_text(p_finding->'assertionIds') LOOP
  BEGIN INSERT INTO gov_repo.discovery_finding_assertions VALUES(p_run.organisation_id,v_id,v_support); EXCEPTION WHEN unique_violation THEN NULL; END;
 END LOOP;
 FOR v_support IN SELECT value FROM pg_catalog.jsonb_array_elements_text(p_finding->'evidenceIds') LOOP
  BEGIN INSERT INTO gov_repo.discovery_finding_evidence VALUES(p_run.organisation_id,v_id,v_support); EXCEPTION WHEN unique_violation THEN NULL; END;
 END LOOP;
 v_generation:=(gov_repo.discovery_machine_authorize_v1(p_run.binding_id,p_run.binding_revision)->>'credential_generation_id')::uuid;
 RETURN gov_repo.discovery_machine_record_admission_v1(p_run.run_id,CASE WHEN p_lineage THEN 'LINEAGE_OBSERVATION' ELSE 'DISCOVERY_FINDING' END,v_id,v_digest,v_created,v_generation);
END;
$fn$;

CREATE FUNCTION gov_repo.discovery_machine_write_candidate_v1(p_run gov_repo.discovery_run_bindings,p_candidate jsonb)
RETURNS boolean LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $fn$
DECLARE v_kind text:=p_candidate->>'candidateKind'; v_id text:=p_candidate->>'candidateId'; v_finding jsonb; v_old jsonb;
 v_ref jsonb; v_identity jsonb; v_keys text[]; v_digest char(64); v_created boolean:=true; v_support text; v_generation uuid;
BEGIN
 PERFORM gov_repo.discovery_machine_canonical_json_v1(p_candidate);
 IF pg_catalog.jsonb_typeof(p_candidate) IS DISTINCT FROM 'object'
 OR NOT(p_candidate ?& ARRAY['candidateId','candidateKind','findingId','sourceObject','assertionIds','evidenceIds','confidence','requiresReconciliation'])
 OR p_candidate-ARRAY['candidateId','candidateKind','findingId','sourceObject','assertionIds','evidenceIds','confidence','requiresReconciliation','proposedIdentity','relationshipTypeCode','sourceEndpoint','targetEndpoint']<>'{}'::jsonb
 OR p_candidate->'requiresReconciliation' IS DISTINCT FROM 'true'::jsonb
 OR coalesce(v_id,'') !~ '^candidate:(agent|agent-version|model|tool|mcp_server|api|prompt|knowledge_base|data_asset|data_element|skill|relationship):[0-9a-f]{32}$'
 OR pg_catalog.split_part(v_id,':',2) IS DISTINCT FROM (CASE WHEN v_kind='AGENT_VERSION' THEN 'agent-version' ELSE pg_catalog.lower(v_kind) END) THEN
  RAISE EXCEPTION 'DISCOVERY_MACHINE_MALFORMED_COMMAND' USING ERRCODE='22023'; END IF;
 SELECT f.envelope INTO v_finding FROM gov_repo.discovery_findings f JOIN gov_repo.discovery_machine_admissions a
  ON a.organisation_id=f.organisation_id AND a.record_id=f.finding_id AND a.record_kind='DISCOVERY_FINDING' AND a.run_id=p_run.run_id
  WHERE f.organisation_id=p_run.organisation_id AND f.finding_id=p_candidate->>'findingId';
 IF v_finding IS NULL OR v_finding->>'candidateKind' IS DISTINCT FROM v_kind
  OR v_finding->'sourceObject' IS DISTINCT FROM p_candidate->'sourceObject'
  OR v_finding->'assertionIds' IS DISTINCT FROM p_candidate->'assertionIds'
  OR v_finding->'evidenceIds' IS DISTINCT FROM p_candidate->'evidenceIds'
  OR v_finding->'confidence' IS DISTINCT FROM p_candidate->'confidence' THEN RAISE EXCEPTION 'S3_DENIED' USING ERRCODE='P0301'; END IF;
 IF v_kind='RELATIONSHIP' THEN
  IF p_candidate ? 'proposedIdentity' OR NOT(p_candidate ?& ARRAY['relationshipTypeCode','sourceEndpoint','targetEndpoint'])
  OR coalesce(pg_catalog.length(p_candidate->>'relationshipTypeCode'),0) NOT BETWEEN 1 AND 100 THEN
   RAISE EXCEPTION 'DISCOVERY_MACHINE_MALFORMED_COMMAND' USING ERRCODE='22023'; END IF;
 ELSE
  IF p_candidate ?| ARRAY['relationshipTypeCode','sourceEndpoint','targetEndpoint'] OR pg_catalog.jsonb_typeof(p_candidate->'proposedIdentity') IS DISTINCT FROM 'object' THEN
   RAISE EXCEPTION 'DISCOVERY_MACHINE_MALFORMED_COMMAND' USING ERRCODE='22023'; END IF;
  v_identity:=p_candidate->'proposedIdentity';
  v_keys:=CASE v_kind WHEN 'AGENT' THEN ARRAY['agentCode','displayName','versionCode'] WHEN 'AGENT_VERSION' THEN ARRAY['agent','versionCode']
    WHEN 'MODEL' THEN ARRAY['modelReference','displayName'] WHEN 'TOOL' THEN ARRAY['declarationKey','displayName']
    WHEN 'PROMPT' THEN ARRAY['declarationKey','displayName'] WHEN 'MCP_SERVER' THEN ARRAY['serverReference','displayName']
    WHEN 'API' THEN ARRAY['apiReference','displayName'] WHEN 'KNOWLEDGE_BASE' THEN ARRAY['sourceReference','displayName']
    WHEN 'SKILL' THEN ARRAY['declarationReference','displayName'] WHEN 'DATA_ASSET' THEN ARRAY['sourceReference','displayName']
    WHEN 'DATA_ELEMENT' THEN ARRAY['parentDataAsset','elementPath','displayName'] END;
  IF v_keys IS NULL OR v_identity-v_keys<>'{}'::jsonb
   OR EXISTS(SELECT 1 FROM pg_catalog.jsonb_each(v_identity) e WHERE e.key NOT IN ('agent','parentDataAsset')
      AND (pg_catalog.jsonb_typeof(e.value)<>'string' OR pg_catalog.length(e.value#>>'{}') NOT BETWEEN 1 AND 4096)) THEN
   RAISE EXCEPTION 'DISCOVERY_MACHINE_MALFORMED_COMMAND' USING ERRCODE='22023'; END IF;
  IF (v_kind='DATA_ELEMENT' AND (NOT(v_identity ?& ARRAY['parentDataAsset','elementPath']) OR v_identity#>>'{parentDataAsset,candidateKind}' IS DISTINCT FROM 'DATA_ASSET'))
   OR (v_kind='AGENT_VERSION' AND v_identity#>>'{agent,candidateKind}' IS DISTINCT FROM 'AGENT') THEN
   RAISE EXCEPTION 'DISCOVERY_MACHINE_MALFORMED_COMMAND' USING ERRCODE='22023'; END IF;
 END IF;
 FOR v_ref IN SELECT value FROM pg_catalog.jsonb_array_elements(pg_catalog.jsonb_build_array(
  p_candidate->'sourceEndpoint',p_candidate->'targetEndpoint',p_candidate#>'{proposedIdentity,agent}',p_candidate#>'{proposedIdentity,parentDataAsset}'))
  WHERE value<>'null'::jsonb LOOP
  IF pg_catalog.jsonb_typeof(v_ref)<>'object' OR coalesce(v_ref->>'candidateKind','') NOT IN ('AGENT','AGENT_VERSION','MODEL','TOOL','MCP_SERVER','API','PROMPT','KNOWLEDGE_BASE','DATA_ASSET','DATA_ELEMENT','SKILL') THEN
   RAISE EXCEPTION 'DISCOVERY_MACHINE_MALFORMED_COMMAND' USING ERRCODE='22023'; END IF;
  IF v_ref->>'referenceKind'='CANDIDATE' THEN
   IF v_ref-ARRAY['referenceKind','candidateKind','candidateId']<>'{}'::jsonb OR NOT EXISTS(
    SELECT 1 FROM gov_repo.discovery_candidates c JOIN gov_repo.discovery_machine_admissions a ON a.organisation_id=c.organisation_id
    AND a.record_id=c.candidate_id AND a.record_kind='NORMALIZED_CANDIDATE' AND a.run_id=p_run.run_id
    WHERE c.organisation_id=p_run.organisation_id AND c.candidate_id=v_ref->>'candidateId' AND c.candidate_kind=v_ref->>'candidateKind'
     AND c.source_connection_id=p_run.source_connection_id) THEN RAISE EXCEPTION 'S3_DENIED' USING ERRCODE='P0301'; END IF;
  ELSIF v_ref->>'referenceKind'='SOURCE_OBJECT' THEN
   IF v_ref-ARRAY['referenceKind','candidateKind','sourceObject']<>'{}'::jsonb OR v_ref#>>'{sourceObject,connectionId}' IS DISTINCT FROM p_run.source_connection_id
    OR NOT EXISTS(SELECT 1 FROM gov_repo.discovery_candidates c JOIN gov_repo.discovery_machine_admissions a ON a.organisation_id=c.organisation_id
     AND a.record_id=c.candidate_id AND a.record_kind='NORMALIZED_CANDIDATE' AND a.run_id=p_run.run_id WHERE c.organisation_id=p_run.organisation_id
     AND c.envelope->'sourceObject'=v_ref->'sourceObject' AND c.candidate_kind=v_ref->>'candidateKind') THEN RAISE EXCEPTION 'S3_DENIED' USING ERRCODE='P0301'; END IF;
  ELSE RAISE EXCEPTION 'DISCOVERY_MACHINE_MALFORMED_COMMAND' USING ERRCODE='22023'; END IF;
 END LOOP;
 v_digest:=gov_repo.discovery_machine_semantic_digest_v1('NORMALIZED_CANDIDATE',p_candidate);
 BEGIN
  INSERT INTO gov_repo.discovery_candidates(organisation_id,candidate_id,candidate_kind,candidate_family,finding_id,source_connection_id,source_external_type,
  source_external_id,confidence,requires_reconciliation,proposed_identity,relationship_type_code,source_endpoint,target_endpoint,acquisition_run_id,contract_version,envelope,envelope_hash)
  VALUES(p_run.organisation_id,v_id,v_kind,CASE WHEN v_kind='RELATIONSHIP' THEN 'RELATIONSHIP' ELSE 'OBJECT' END,p_candidate->>'findingId',p_run.source_connection_id,
  'file',p_candidate#>>'{sourceObject,externalId}',(p_candidate->>'confidence')::double precision,true,p_candidate->'proposedIdentity',p_candidate->>'relationshipTypeCode',
  p_candidate->'sourceEndpoint',p_candidate->'targetEndpoint',p_run.run_id,'1.0',p_candidate,
  pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(gov_repo.discovery_machine_canonical_json_v1(p_candidate),'UTF8')),'hex'));
 EXCEPTION WHEN unique_violation THEN v_created:=false; END;
 SELECT envelope INTO v_old FROM gov_repo.discovery_candidates WHERE organisation_id=p_run.organisation_id AND candidate_id=v_id;
 IF v_old IS NULL OR gov_repo.discovery_machine_semantic_digest_v1('NORMALIZED_CANDIDATE',v_old)<>v_digest THEN
  RAISE EXCEPTION 'S3_CONTENT_CONFLICT' USING ERRCODE='P0302'; END IF;
 FOR v_support IN SELECT value FROM pg_catalog.jsonb_array_elements_text(p_candidate->'assertionIds') LOOP
  BEGIN INSERT INTO gov_repo.discovery_candidate_assertions VALUES(p_run.organisation_id,v_id,v_support); EXCEPTION WHEN unique_violation THEN NULL; END;
 END LOOP;
 FOR v_support IN SELECT value FROM pg_catalog.jsonb_array_elements_text(p_candidate->'evidenceIds') LOOP
  BEGIN INSERT INTO gov_repo.discovery_candidate_evidence VALUES(p_run.organisation_id,v_id,v_support); EXCEPTION WHEN unique_violation THEN NULL; END;
 END LOOP;
 v_generation:=(gov_repo.discovery_machine_authorize_v1(p_run.binding_id,p_run.binding_revision)->>'credential_generation_id')::uuid;
 RETURN gov_repo.discovery_machine_record_admission_v1(p_run.run_id,'NORMALIZED_CANDIDATE',v_id,v_digest,v_created,v_generation);
END;
$fn$;

CREATE FUNCTION gov_repo.discovery_machine_admit_finding_v1(p_run text,p_finding jsonb,p_candidate jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp SET lock_timeout = '5s' AS $fn$
DECLARE v_run gov_repo.discovery_run_bindings; v_id text; v_new boolean;
BEGIN
 PERFORM gov_repo.discovery_machine_canonical_json_v1(p_finding);
 IF p_candidate IS NULL AND p_finding->>'candidateKind' IN ('DATA_ASSET','DATA_ELEMENT','RELATIONSHIP','AGENT_VERSION') THEN
  RAISE EXCEPTION 'DISCOVERY_MACHINE_MALFORMED_COMMAND' USING ERRCODE='22023'; END IF;
 IF p_candidate IS NOT NULL AND p_candidate->>'findingId' IS DISTINCT FROM p_finding->>'findingId' THEN
  RAISE EXCEPTION 'DISCOVERY_MACHINE_MALFORMED_COMMAND' USING ERRCODE='22023'; END IF;
 v_run:=gov_repo.discovery_machine_lock_run_v1(p_run,false);
 IF v_run.conclusion_status IS NOT NULL THEN RETURN '{"outcome":"STATE_CONFLICT"}'::jsonb; END IF;
 IF p_candidate->>'relationshipTypeCode'='DERIVED_FROM' AND NOT EXISTS(
  SELECT 1 FROM gov_repo.lineage_candidate_observations l JOIN gov_repo.discovery_machine_admissions a ON a.organisation_id=l.organisation_id
  AND a.record_id=l.observation_finding_id AND a.record_kind='LINEAGE_OBSERVATION' AND a.run_id=p_run
  WHERE l.organisation_id=v_run.organisation_id AND l.candidate_id=p_candidate->>'candidateId') THEN
  RAISE EXCEPTION 'S3_DENIED' USING ERRCODE='P0301'; END IF;
 FOR v_id IN SELECT x FROM pg_catalog.unnest(ARRAY['DISCOVERY_FINDING:'||(p_finding->>'findingId'),'NORMALIZED_CANDIDATE:'||(p_candidate->>'candidateId')]) x
  WHERE x IS NOT NULL ORDER BY x COLLATE "C" LOOP
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_run.organisation_id::text||':discovery-machine:'||v_id,0));
 END LOOP;
 v_new:=gov_repo.discovery_machine_write_finding_v1(v_run,p_finding,false);
 IF p_candidate IS NOT NULL THEN v_new:=gov_repo.discovery_machine_write_candidate_v1(v_run,p_candidate) OR v_new; END IF;
 PERFORM gov_repo.discovery_machine_authorize_v1(v_run.binding_id,v_run.binding_revision);
 RETURN pg_catalog.jsonb_build_object('outcome',CASE WHEN v_new THEN 'APPLIED' ELSE 'REPLAYED' END,'findingId',p_finding->>'findingId');
EXCEPTION WHEN SQLSTATE 'P0301' THEN RETURN '{"outcome":"DENIED","denial_code":"SUPPORT_NOT_ADMITTED"}'::jsonb;
 WHEN SQLSTATE 'P0302' THEN RETURN '{"outcome":"CONTENT_CONFLICT"}'::jsonb;
END;
$fn$;

CREATE FUNCTION gov_repo.discovery_machine_admit_lineage_v1(p_run text,p_finding jsonb,p_candidate jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp SET lock_timeout = '5s' AS $fn$
DECLARE v_run gov_repo.discovery_run_bindings; p_organisation_id uuid; p_observation jsonb;
 v_origin gov_repo.discovery_candidates; v_origin_finding gov_repo.discovery_findings;
 v_endpoint gov_repo.discovery_candidates; v_original_endpoint gov_repo.discovery_candidates;
 v_side text; v_candidate_id text:=p_candidate->>'candidateId'; v_observation_id text;
 v_assertions text[]; v_evidence text[]; v_new boolean:=false; v_id text;
BEGIN
 PERFORM gov_repo.discovery_machine_canonical_json_v1(p_finding);
 PERFORM gov_repo.discovery_machine_canonical_json_v1(p_candidate);
 v_run:=gov_repo.discovery_machine_lock_run_v1(p_run,false);
 IF v_run.conclusion_status IS NOT NULL THEN RETURN '{"outcome":"STATE_CONFLICT"}'::jsonb; END IF;
 p_organisation_id:=v_run.organisation_id;
 IF p_candidate#>>'{sourceObject,connectionId}' IS DISTINCT FROM v_run.source_connection_id THEN RAISE EXCEPTION 'S3_DENIED' USING ERRCODE='P0301'; END IF;
 SELECT array_agg(DISTINCT value ORDER BY value) INTO v_assertions FROM pg_catalog.jsonb_array_elements_text(p_candidate->'assertionIds');
 SELECT array_agg(DISTINCT value ORDER BY value) INTO v_evidence FROM pg_catalog.jsonb_array_elements_text(p_candidate->'evidenceIds');
 v_observation_id:='discovery-finding:lineage-observation:'||pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
 gov_repo.discovery_machine_canonical_json_v1(pg_catalog.jsonb_build_array('lineage-observation-v1',v_candidate_id,
 pg_catalog.jsonb_build_array(p_candidate#>>'{sourceEndpoint,referenceKind}',p_candidate#>>'{sourceEndpoint,candidateKind}',p_candidate#>>'{sourceEndpoint,candidateId}'),
 pg_catalog.jsonb_build_array(p_candidate#>>'{targetEndpoint,referenceKind}',p_candidate#>>'{targetEndpoint,candidateKind}',p_candidate#>>'{targetEndpoint,candidateId}'),v_assertions,v_evidence)),'UTF8')),'hex');
 p_observation:=p_finding||pg_catalog.jsonb_build_object('findingId',v_observation_id,'assertionIds',v_assertions,'evidenceIds',v_evidence);
  if p_organisation_id is null or v_candidate_id is null or v_candidate_id !~ '^candidate:relationship:[a-f0-9]{32}$'
    or p_candidate->>'candidateKind' is distinct from 'RELATIONSHIP'
    or p_candidate->>'relationshipTypeCode' is distinct from 'DERIVED_FROM'
    or p_candidate->>'requiresReconciliation' is distinct from 'true'
    or p_finding->>'candidateKind' is distinct from 'RELATIONSHIP'
    or p_finding->>'findingNature' is distinct from 'CANDIDATE'
    or p_finding->>'reviewStatus' is distinct from 'UNREVIEWED'
    or p_finding->>'requiresReview' is distinct from 'true'
    or p_finding->>'createsCanonicalObject' is distinct from 'false'
    or p_candidate->>'findingId' is distinct from p_finding->>'findingId'
    or p_candidate->'sourceObject' is distinct from p_finding->'sourceObject'
    or p_candidate->'assertionIds' is distinct from p_finding->'assertionIds'
    or p_candidate->'evidenceIds' is distinct from p_finding->'evidenceIds'
    or p_candidate#>>'{sourceObject,externalType}' is distinct from 'file'
    or p_candidate#>>'{sourceObject,externalId}' not like '%.sql'
    or v_observation_id is null or v_observation_id !~ '^discovery-finding:lineage-observation:[a-f0-9]{64}$'
    or (p_observation - 'findingId' - 'assertionIds' - 'evidenceIds') is distinct from
       (p_finding - 'findingId' - 'assertionIds' - 'evidenceIds') then
    raise exception using errcode = '23514', message = 'LINEAGE_OBSERVATION_CONTEXT_MISMATCH';
  end if;
  select array_agg(distinct value order by value) into v_assertions from jsonb_array_elements_text(p_candidate->'assertionIds');
  select array_agg(distinct value order by value) into v_evidence from jsonb_array_elements_text(p_candidate->'evidenceIds');
  if coalesce(cardinality(v_assertions), 0) = 0 or coalesce(cardinality(v_evidence), 0) = 0
    or p_observation->'assertionIds' is distinct from to_jsonb(v_assertions)
    or p_observation->'evidenceIds' is distinct from to_jsonb(v_evidence) then
    raise exception using errcode = '23514', message = 'LINEAGE_OBSERVATION_SUPPORT_MISSING';
  end if;

  -- Serialize initial candidate selection and observation attachment for this
  -- tenant/semantic candidate. No unlocked application check-then-write.
  perform pg_advisory_xact_lock(hashtextextended(p_organisation_id::text || ':' || v_candidate_id, 0));
  select * into v_origin from gov_repo.discovery_candidates dc
    where dc.organisation_id = p_organisation_id and dc.candidate_id = v_candidate_id;
  if found and (v_origin.candidate_kind <> 'RELATIONSHIP' or v_origin.relationship_type_code <> 'DERIVED_FROM'
    or v_origin.finding_id is distinct from p_candidate->>'findingId'
    or v_origin.envelope->'sourceObject' is distinct from p_candidate->'sourceObject') then
    raise exception using errcode = '23514', message = 'LINEAGE_OBSERVATION_SEMANTIC_CONFLICT';
  end if;
  foreach v_side in array array['sourceEndpoint', 'targetEndpoint'] loop
    if p_candidate->v_side->>'referenceKind' is distinct from 'CANDIDATE'
      or p_candidate->v_side->>'candidateKind' is distinct from 'DATA_ELEMENT' then
      raise exception using errcode = '23514', message = 'LINEAGE_OBSERVATION_ENDPOINT_KIND';
    end if;
    select * into v_endpoint from gov_repo.discovery_candidates dc where dc.organisation_id = p_organisation_id
      and dc.candidate_id = p_candidate->v_side->>'candidateId' and dc.candidate_kind = 'DATA_ELEMENT';
    if not found or NOT EXISTS(SELECT 1 FROM gov_repo.discovery_machine_admissions a WHERE a.run_id=p_run AND a.record_kind='NORMALIZED_CANDIDATE' AND a.record_id=v_endpoint.candidate_id) or v_endpoint.source_connection_id is distinct from p_candidate#>>'{sourceObject,connectionId}' then
      raise exception using errcode = '23503', message = 'LINEAGE_OBSERVATION_ENDPOINT_MISSING';
    end if;
    if not ((p_candidate->'assertionIds') @> (v_endpoint.envelope->'assertionIds'))
      or not ((p_candidate->'evidenceIds') @> (v_endpoint.envelope->'evidenceIds')) then
      raise exception using errcode = '23514', message = 'LINEAGE_OBSERVATION_ENDPOINT_SUPPORT_MISSING';
    end if;
    if v_origin.candidate_id is not null then
      select * into v_original_endpoint from gov_repo.discovery_candidates dc where dc.organisation_id = p_organisation_id
        and dc.candidate_id = v_origin.envelope->v_side->>'candidateId' and dc.candidate_kind = 'DATA_ELEMENT';
      if not found or gov_repo.frame_identity(array[v_endpoint.source_connection_id, v_endpoint.source_external_type,
          v_endpoint.source_external_id, gov_repo.normalized_object_identity(p_organisation_id, v_endpoint.envelope)])
        is distinct from gov_repo.frame_identity(array[v_original_endpoint.source_connection_id, v_original_endpoint.source_external_type,
          v_original_endpoint.source_external_id, gov_repo.normalized_object_identity(p_organisation_id, v_original_endpoint.envelope)]) then
        raise exception using errcode = '23514', message = 'LINEAGE_OBSERVATION_SEMANTIC_CONFLICT';
      end if;
    else
      perform gov_repo.normalized_object_identity(p_organisation_id, v_endpoint.envelope);
    end if;
  end loop;
  -- All support is durable under this tenant, including a direct SQL assertion
  -- in the transformation's source scope. No borrowed endpoint-only support.
  if exists (select 1 from unnest(v_assertions) a(id) where not exists
      (select 1 from gov_repo.source_assertions sa where sa.organisation_id = p_organisation_id and sa.assertion_id = a.id AND EXISTS(SELECT 1 FROM gov_repo.discovery_machine_admissions adm WHERE adm.run_id=p_run AND adm.record_kind='SOURCE_ASSERTION' AND adm.record_id=a.id)))
    or exists (select 1 from unnest(v_evidence) e(id) where not exists
      (select 1 from gov_repo.discovery_evidence de where de.organisation_id = p_organisation_id and de.evidence_id = e.id AND EXISTS(SELECT 1 FROM gov_repo.discovery_machine_admissions adm WHERE adm.run_id=p_run AND adm.record_kind='EVIDENCE' AND adm.record_id=e.id)))
    or not exists (select 1 from gov_repo.source_assertions sa where sa.organisation_id = p_organisation_id
      and sa.assertion_id = any(v_assertions) and sa.method_code = 'sql-insert-select-column-lineage'
      and sa.method_version = '1.0.0' and sa.trust_state = 'DECLARED'
      and sa.source_connection_id = p_candidate#>>'{sourceObject,connectionId}'
      and sa.source_external_type = 'file' and sa.source_external_id = p_candidate#>>'{sourceObject,externalId}'
      and exists (select 1 from gov_repo.source_assertion_evidence se where se.organisation_id = p_organisation_id
        and se.assertion_id = sa.assertion_id and se.evidence_id = any(v_evidence))) then
    raise exception using errcode = '23503', message = 'LINEAGE_OBSERVATION_SUPPORT_MISSING';
  end if;


 FOR v_id IN SELECT x FROM pg_catalog.unnest(ARRAY['DISCOVERY_FINDING:'||(p_finding->>'findingId'),
 'LINEAGE_OBSERVATION:'||v_observation_id,'NORMALIZED_CANDIDATE:'||v_candidate_id]) x ORDER BY x COLLATE "C" LOOP
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_organisation_id::text||':discovery-machine:'||v_id,0));
 END LOOP;
 IF v_origin.candidate_id IS NULL THEN
  v_new:=gov_repo.discovery_machine_write_finding_v1(v_run,p_finding,false);
  v_new:=gov_repo.discovery_machine_write_candidate_v1(v_run,p_candidate) OR v_new;
  SELECT * INTO STRICT v_origin FROM gov_repo.discovery_candidates WHERE organisation_id=p_organisation_id AND candidate_id=v_candidate_id;
 ELSE
  SELECT * INTO STRICT v_origin_finding FROM gov_repo.discovery_findings WHERE organisation_id=p_organisation_id AND finding_id=v_origin.finding_id;
  -- An observation may attach to an immutable older origin. It never replaces its support.
  IF NOT EXISTS(SELECT 1 FROM pg_catalog.jsonb_array_elements_text(v_origin.envelope->'assertionIds') x WHERE NOT EXISTS(
   SELECT 1 FROM gov_repo.discovery_machine_admissions a WHERE a.run_id=p_run AND a.record_kind='SOURCE_ASSERTION' AND a.record_id=x))
   AND NOT EXISTS(SELECT 1 FROM pg_catalog.jsonb_array_elements_text(v_origin.envelope->'evidenceIds') x WHERE NOT EXISTS(
   SELECT 1 FROM gov_repo.discovery_machine_admissions a WHERE a.run_id=p_run AND a.record_kind='EVIDENCE' AND a.record_id=x)) THEN
   v_new:=gov_repo.discovery_machine_write_finding_v1(v_run,v_origin_finding.envelope,false);
   v_new:=gov_repo.discovery_machine_write_candidate_v1(v_run,v_origin.envelope) OR v_new;
  END IF;
 END IF;
 v_new:=gov_repo.discovery_machine_write_finding_v1(v_run,p_observation,true) OR v_new;
 BEGIN
  INSERT INTO gov_repo.lineage_candidate_observations VALUES(p_organisation_id,v_candidate_id,v_observation_id,
   p_candidate#>>'{sourceEndpoint,candidateId}',p_candidate#>>'{targetEndpoint,candidateId}');
 EXCEPTION WHEN unique_violation THEN
  IF NOT EXISTS(SELECT 1 FROM gov_repo.lineage_candidate_observations l WHERE l.organisation_id=p_organisation_id
   AND l.candidate_id=v_candidate_id AND l.observation_finding_id=v_observation_id
   AND l.source_candidate_id=p_candidate#>>'{sourceEndpoint,candidateId}' AND l.target_candidate_id=p_candidate#>>'{targetEndpoint,candidateId}') THEN
   RAISE EXCEPTION 'S3_CONTENT_CONFLICT' USING ERRCODE='P0302'; END IF;
 END;
 SELECT * INTO STRICT v_origin_finding FROM gov_repo.discovery_findings WHERE organisation_id=p_organisation_id AND finding_id=v_origin.finding_id;
 PERFORM gov_repo.discovery_machine_authorize_v1(v_run.binding_id,v_run.binding_revision);
 RETURN pg_catalog.jsonb_build_object('outcome',CASE WHEN v_new THEN 'APPLIED' ELSE 'REPLAYED' END,'finding',v_origin_finding.envelope,'candidate',v_origin.envelope);
EXCEPTION WHEN SQLSTATE 'P0301' OR foreign_key_violation THEN RETURN '{"outcome":"DENIED","denial_code":"SUPPORT_NOT_ADMITTED"}'::jsonb;
 WHEN SQLSTATE 'P0302' THEN RETURN '{"outcome":"CONTENT_CONFLICT"}'::jsonb;
 WHEN check_violation THEN
  IF SQLERRM IN ('LINEAGE_OBSERVATION_SEMANTIC_CONFLICT','LINEAGE_ORIGIN_FINDING_CONFLICT','LINEAGE_OBSERVATION_CONFLICT') THEN RETURN '{"outcome":"CONTENT_CONFLICT"}'::jsonb; END IF;
  RAISE;
END;
$fn$;

CREATE FUNCTION gov_repo.discovery_machine_create_subject_v1(p_run text,p_finding text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp SET lock_timeout = '5s' AS $fn$
DECLARE v_run gov_repo.discovery_run_bindings; v_finding gov_repo.discovery_findings; v_subject gov_repo.review_subjects;
 v_id text; v_support text; v_created boolean:=true; v_new boolean; v_generation uuid; v_digest char(64);
BEGIN
 IF p_finding IS NULL OR p_finding !~ '^discovery-finding:((agent-version|relationship):)?([0-9a-f]{32}|[0-9a-f]{64})$' THEN
  RAISE EXCEPTION 'DISCOVERY_MACHINE_MALFORMED_COMMAND' USING ERRCODE='22023'; END IF;
 v_run:=gov_repo.discovery_machine_lock_run_v1(p_run,false);
 IF v_run.conclusion_status IS NOT NULL THEN RETURN '{"outcome":"STATE_CONFLICT"}'::jsonb; END IF;
 SELECT f.* INTO v_finding FROM gov_repo.discovery_findings f JOIN gov_repo.discovery_machine_admissions a
 ON a.organisation_id=f.organisation_id AND a.record_id=f.finding_id AND a.record_kind='DISCOVERY_FINDING' AND a.run_id=p_run
 WHERE f.organisation_id=v_run.organisation_id AND f.finding_id=p_finding AND f.source_connection_id=v_run.source_connection_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'S3_DENIED' USING ERRCODE='P0301'; END IF;
 v_id:='review-subject:discovery:'||pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
  gov_repo.discovery_machine_canonical_json_v1(pg_catalog.jsonb_build_array(v_run.organisation_id::text,p_finding)),'UTF8')),'hex');
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_run.organisation_id::text||':discovery-machine:REVIEW_SUBJECT:'||v_id,0));
 BEGIN
  INSERT INTO gov_repo.review_subjects(review_subject_id,organisation_id,finding_id,candidate_kind,source_connection_id,source_external_type,source_external_id,state,detected_at,revision,last_transition_id)
  VALUES(v_id,v_run.organisation_id,p_finding,v_finding.candidate_kind,v_run.source_connection_id,v_finding.source_external_type,v_finding.source_external_id,'DETECTED',v_finding.detected_at,0,NULL);
 EXCEPTION WHEN unique_violation THEN v_created:=false; END;
 SELECT * INTO STRICT v_subject FROM gov_repo.review_subjects WHERE review_subject_id=v_id;
 IF v_subject.organisation_id IS DISTINCT FROM v_run.organisation_id OR v_subject.finding_id IS DISTINCT FROM p_finding
 OR v_subject.candidate_kind IS DISTINCT FROM v_finding.candidate_kind OR v_subject.source_connection_id IS DISTINCT FROM v_run.source_connection_id
 OR v_subject.source_external_type IS DISTINCT FROM v_finding.source_external_type OR v_subject.source_external_id IS DISTINCT FROM v_finding.source_external_id THEN
  RAISE EXCEPTION 'S3_CONTENT_CONFLICT' USING ERRCODE='P0302'; END IF;
 IF v_created THEN
  FOR v_support IN SELECT value FROM pg_catalog.jsonb_array_elements_text(v_finding.envelope->'assertionIds') LOOP
   INSERT INTO gov_repo.review_subject_assertions(review_subject_id,organisation_id,assertion_id) VALUES(v_id,v_run.organisation_id,v_support);
  END LOOP;
  FOR v_support IN SELECT value FROM pg_catalog.jsonb_array_elements_text(v_finding.envelope->'evidenceIds') LOOP
   INSERT INTO gov_repo.review_subject_evidence(review_subject_id,organisation_id,evidence_id) VALUES(v_id,v_run.organisation_id,v_support);
  END LOOP;
 ELSE
  IF (SELECT pg_catalog.jsonb_agg(assertion_id ORDER BY assertion_id) FROM gov_repo.review_subject_assertions WHERE review_subject_id=v_id AND organisation_id=v_run.organisation_id)
    IS DISTINCT FROM (SELECT pg_catalog.jsonb_agg(DISTINCT value ORDER BY value) FROM pg_catalog.jsonb_array_elements_text(v_finding.envelope->'assertionIds'))
   OR (SELECT pg_catalog.jsonb_agg(evidence_id ORDER BY evidence_id) FROM gov_repo.review_subject_evidence WHERE review_subject_id=v_id AND organisation_id=v_run.organisation_id)
    IS DISTINCT FROM (SELECT pg_catalog.jsonb_agg(DISTINCT value ORDER BY value) FROM pg_catalog.jsonb_array_elements_text(v_finding.envelope->'evidenceIds')) THEN
    RAISE EXCEPTION 'S3_CONTENT_CONFLICT' USING ERRCODE='P0302'; END IF;
 END IF;
 v_generation:=(gov_repo.discovery_machine_authorize_v1(v_run.binding_id,v_run.binding_revision)->>'credential_generation_id')::uuid;
 v_digest:=gov_repo.discovery_machine_semantic_digest_v1('REVIEW_SUBJECT',pg_catalog.jsonb_build_object('subjectId',v_id,'finding',v_finding.envelope-'detectedAt'));
 v_new:=gov_repo.discovery_machine_record_admission_v1(p_run,'REVIEW_SUBJECT',v_id,v_digest,v_created,v_generation);
 PERFORM gov_repo.discovery_machine_authorize_v1(v_run.binding_id,v_run.binding_revision);
 RETURN pg_catalog.jsonb_build_object('outcome',CASE WHEN v_new THEN 'APPLIED' ELSE 'REPLAYED' END,'reviewSubjectId',v_id,'currentState',v_subject.state);
EXCEPTION WHEN SQLSTATE 'P0301' THEN RETURN '{"outcome":"DENIED","denial_code":"SUPPORT_NOT_ADMITTED"}'::jsonb;
 WHEN SQLSTATE 'P0302' THEN RETURN '{"outcome":"CONTENT_CONFLICT"}'::jsonb;
END;
$fn$;

CREATE FUNCTION gov_repo.discovery_machine_record_technical_profile_v1(p_run text,p_proposal jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp SET lock_timeout = '5s' AS $fn$
DECLARE v_run gov_repo.discovery_run_bindings; v_row gov_repo.agent_version_technical_profile_proposals; v_old jsonb;
 v_id text; v_field text; v_support jsonb; v_a jsonb; v_e jsonb; v_ref text; v_created boolean:=true; v_new boolean; v_generation uuid;
BEGIN
 PERFORM gov_repo.discovery_machine_canonical_json_v1(p_proposal);
 IF pg_catalog.jsonb_typeof(p_proposal) IS DISTINCT FROM 'object'
 OR NOT(p_proposal ?& ARRAY['proposalId','agentVersionCandidateId','behaviorFingerprintAlgorithm','behaviorFingerprintSchemaVersion','behaviorFingerprintValue','support','contractVersion'])
 OR p_proposal-ARRAY['proposalId','agentVersionCandidateId','behaviorFingerprintAlgorithm','behaviorFingerprintSchemaVersion','behaviorFingerprintValue','buildReference','runtimeFrameworkReference','entrypointReference','configurationReference','support','contractVersion']<>'{}'::jsonb
 OR p_proposal->>'behaviorFingerprintAlgorithm' IS DISTINCT FROM 'sha256'
 OR coalesce(p_proposal->>'behaviorFingerprintSchemaVersion','') NOT IN ('1.0','1.1')
 OR coalesce(p_proposal->>'behaviorFingerprintValue','') !~ '^[a-f0-9]{32}$'
 OR p_proposal->>'contractVersion' IS DISTINCT FROM '1.0'
 OR pg_catalog.jsonb_typeof(p_proposal->'support') IS DISTINCT FROM 'object'
 OR NOT((p_proposal->'support') ?& ARRAY['behaviorFingerprint','buildReference','runtimeFrameworkReference','entrypointReference','configurationReference'])
 OR (p_proposal->'support')-ARRAY['behaviorFingerprint','buildReference','runtimeFrameworkReference','entrypointReference','configurationReference']<>'{}'::jsonb THEN
  RAISE EXCEPTION 'DISCOVERY_MACHINE_MALFORMED_COMMAND' USING ERRCODE='22023'; END IF;
 v_id:='agent-version-technical-profile-proposal:'||pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
 gov_repo.discovery_machine_canonical_json_v1(pg_catalog.jsonb_build_array('agent-version-technical-profile-proposal',p_proposal->>'agentVersionCandidateId')),'UTF8')),'hex');
 IF p_proposal->>'proposalId' IS DISTINCT FROM v_id THEN RAISE EXCEPTION 'DISCOVERY_MACHINE_MALFORMED_COMMAND' USING ERRCODE='22023'; END IF;
 v_run:=gov_repo.discovery_machine_lock_run_v1(p_run,false);
 IF v_run.conclusion_status IS NOT NULL THEN RETURN '{"outcome":"STATE_CONFLICT"}'::jsonb; END IF;
 IF NOT EXISTS(SELECT 1 FROM gov_repo.discovery_candidates c JOIN gov_repo.discovery_machine_admissions a ON a.organisation_id=c.organisation_id AND a.record_id=c.candidate_id
  AND a.record_kind='NORMALIZED_CANDIDATE' AND a.run_id=p_run WHERE c.organisation_id=v_run.organisation_id AND c.candidate_id=p_proposal->>'agentVersionCandidateId'
  AND c.candidate_kind='AGENT_VERSION' AND c.source_connection_id=v_run.source_connection_id) THEN RAISE EXCEPTION 'S3_DENIED' USING ERRCODE='P0301'; END IF;
 FOR v_field,v_support IN SELECT key,value FROM pg_catalog.jsonb_each(p_proposal->'support') LOOP
  IF pg_catalog.jsonb_typeof(v_support)<>'object' OR NOT(v_support ?& ARRAY['assertionIds','evidenceIds']) OR v_support-ARRAY['assertionIds','evidenceIds']<>'{}'::jsonb
   OR pg_catalog.jsonb_typeof(v_support->'assertionIds') IS DISTINCT FROM 'array' OR pg_catalog.jsonb_typeof(v_support->'evidenceIds') IS DISTINCT FROM 'array' THEN
   RAISE EXCEPTION 'DISCOVERY_MACHINE_MALFORMED_COMMAND' USING ERRCODE='22023'; END IF;
  IF pg_catalog.jsonb_array_length(v_support->'assertionIds')>256 OR pg_catalog.jsonb_array_length(v_support->'evidenceIds')>256
   OR (v_field='behaviorFingerprint' AND (v_support->'assertionIds'='[]'::jsonb OR v_support->'evidenceIds'='[]'::jsonb)) THEN
   RAISE EXCEPTION 'DISCOVERY_MACHINE_MALFORMED_COMMAND' USING ERRCODE='22023'; END IF;
  IF EXISTS(SELECT 1 FROM pg_catalog.jsonb_array_elements_text(v_support->'assertionIds') x WHERE NOT EXISTS(
   SELECT 1 FROM gov_repo.discovery_machine_admissions a WHERE a.run_id=p_run AND a.record_kind='SOURCE_ASSERTION' AND a.record_id=x))
   OR EXISTS(SELECT 1 FROM pg_catalog.jsonb_array_elements_text(v_support->'evidenceIds') x WHERE NOT EXISTS(
   SELECT 1 FROM gov_repo.discovery_machine_admissions a WHERE a.run_id=p_run AND a.record_kind='EVIDENCE' AND a.record_id=x)) THEN
   RAISE EXCEPTION 'S3_DENIED' USING ERRCODE='P0301'; END IF;
  SELECT coalesce(pg_catalog.jsonb_agg(DISTINCT value ORDER BY value),'[]'::jsonb) INTO v_a FROM pg_catalog.jsonb_array_elements_text(v_support->'assertionIds');
  SELECT coalesce(pg_catalog.jsonb_agg(DISTINCT value ORDER BY value),'[]'::jsonb) INTO v_e FROM pg_catalog.jsonb_array_elements_text(v_support->'evidenceIds');
  p_proposal:=pg_catalog.jsonb_set(p_proposal,ARRAY['support',v_field],pg_catalog.jsonb_build_object('assertionIds',v_a,'evidenceIds',v_e));
 END LOOP;
 IF EXISTS(SELECT 1 FROM pg_catalog.jsonb_each(p_proposal) e WHERE e.key IN ('buildReference','runtimeFrameworkReference','entrypointReference','configurationReference')
  AND (pg_catalog.jsonb_typeof(e.value)<>'string' OR pg_catalog.length(e.value#>>'{}') NOT BETWEEN 1 AND 4096)) THEN
  RAISE EXCEPTION 'DISCOVERY_MACHINE_MALFORMED_COMMAND' USING ERRCODE='22023'; END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_run.organisation_id::text||':discovery-machine:TECHNICAL_PROFILE_PROPOSAL:'||v_id,0));
 BEGIN
  INSERT INTO gov_repo.agent_version_technical_profile_proposals(organisation_id,proposal_id,agent_version_candidate_id,behavior_fingerprint_algorithm,
  behavior_fingerprint_schema_version,behavior_fingerprint_value,build_reference,runtime_framework_reference,entrypoint_reference,configuration_reference,contract_version)
  VALUES(v_run.organisation_id,v_id,p_proposal->>'agentVersionCandidateId','sha256',p_proposal->>'behaviorFingerprintSchemaVersion',p_proposal->>'behaviorFingerprintValue',
  p_proposal->>'buildReference',p_proposal->>'runtimeFrameworkReference',p_proposal->>'entrypointReference',p_proposal->>'configurationReference','1.0');
 EXCEPTION WHEN unique_violation THEN v_created:=false; END;
 IF v_created THEN
  FOR v_field,v_support IN SELECT key,value FROM pg_catalog.jsonb_each(p_proposal->'support') LOOP
   FOR v_ref IN SELECT value FROM pg_catalog.jsonb_array_elements_text(v_support->'assertionIds') LOOP
    INSERT INTO gov_repo.agent_version_technical_profile_proposal_field_assertions VALUES(v_run.organisation_id,v_id,v_field,v_ref);
   END LOOP;
   FOR v_ref IN SELECT value FROM pg_catalog.jsonb_array_elements_text(v_support->'evidenceIds') LOOP
    INSERT INTO gov_repo.agent_version_technical_profile_proposal_field_evidence VALUES(v_run.organisation_id,v_id,v_field,v_ref);
   END LOOP;
  END LOOP;
 END IF;
 SELECT * INTO STRICT v_row FROM gov_repo.agent_version_technical_profile_proposals WHERE organisation_id=v_run.organisation_id AND proposal_id=v_id;
 v_old:=pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object('proposalId',v_row.proposal_id,'agentVersionCandidateId',v_row.agent_version_candidate_id,
 'behaviorFingerprintAlgorithm',v_row.behavior_fingerprint_algorithm,'behaviorFingerprintSchemaVersion',v_row.behavior_fingerprint_schema_version,
 'behaviorFingerprintValue',v_row.behavior_fingerprint_value,'buildReference',v_row.build_reference,'runtimeFrameworkReference',v_row.runtime_framework_reference,
 'entrypointReference',v_row.entrypoint_reference,'configurationReference',v_row.configuration_reference,'contractVersion',v_row.contract_version,'support','{}'::jsonb));
 FOR v_field IN SELECT pg_catalog.unnest(ARRAY['behaviorFingerprint','buildReference','runtimeFrameworkReference','entrypointReference','configurationReference']) LOOP
  SELECT coalesce(pg_catalog.jsonb_agg(assertion_id ORDER BY assertion_id),'[]'::jsonb) INTO v_a FROM gov_repo.agent_version_technical_profile_proposal_field_assertions
   WHERE organisation_id=v_run.organisation_id AND proposal_id=v_id AND field_name=v_field;
  SELECT coalesce(pg_catalog.jsonb_agg(evidence_id ORDER BY evidence_id),'[]'::jsonb) INTO v_e FROM gov_repo.agent_version_technical_profile_proposal_field_evidence
   WHERE organisation_id=v_run.organisation_id AND proposal_id=v_id AND field_name=v_field;
  v_old:=pg_catalog.jsonb_set(v_old,ARRAY['support',v_field],pg_catalog.jsonb_build_object('assertionIds',v_a,'evidenceIds',v_e));
 END LOOP;
 IF v_old IS DISTINCT FROM p_proposal THEN RAISE EXCEPTION 'S3_CONTENT_CONFLICT' USING ERRCODE='P0302'; END IF;
 v_generation:=(gov_repo.discovery_machine_authorize_v1(v_run.binding_id,v_run.binding_revision)->>'credential_generation_id')::uuid;
 v_new:=gov_repo.discovery_machine_record_admission_v1(p_run,'TECHNICAL_PROFILE_PROPOSAL',v_id,gov_repo.discovery_machine_semantic_digest_v1('TECHNICAL_PROFILE_PROPOSAL',p_proposal),v_created,v_generation);
 PERFORM gov_repo.discovery_machine_authorize_v1(v_run.binding_id,v_run.binding_revision);
 RETURN pg_catalog.jsonb_build_object('outcome',CASE WHEN v_new THEN 'APPLIED' ELSE 'REPLAYED' END,'proposalId',v_id);
EXCEPTION WHEN SQLSTATE 'P0301' THEN RETURN '{"outcome":"DENIED","denial_code":"SUPPORT_NOT_ADMITTED"}'::jsonb;
 WHEN SQLSTATE 'P0302' THEN RETURN '{"outcome":"CONTENT_CONFLICT"}'::jsonb;
END;
$fn$;

CREATE FUNCTION gov_repo.discovery_machine_execution_identity_v1(p_org uuid,p_snapshot jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog, pg_temp AS $fn$
DECLARE v_scope text; v_id text; v_source text;
BEGIN
 v_source:=gov_repo.discovery_machine_canonical_json_v1(pg_catalog.jsonb_build_array(p_snapshot#>>'{sourceObject,connectionId}',
  p_snapshot#>>'{sourceObject,externalType}',p_snapshot#>>'{sourceObject,externalId}'));
 v_scope:=pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(gov_repo.discovery_machine_canonical_json_v1(
  pg_catalog.jsonb_build_array(v_source,p_snapshot->>'declarationKey')),'UTF8')),'hex');
 v_id:='execution-snapshot:'||pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(gov_repo.discovery_machine_canonical_json_v1(
  pg_catalog.jsonb_build_array(p_org::text,v_scope,p_snapshot->>'agentVersionCandidateId',p_snapshot->>'sourceSnapshotId',p_snapshot->'facts')),'UTF8')),'hex');
 RETURN pg_catalog.jsonb_build_object('sourceScope',v_scope,'snapshotId',v_id);
END;
$fn$;

CREATE FUNCTION gov_repo.discovery_machine_record_execution_snapshot_v1(p_run text,p_snapshot jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp SET lock_timeout = '5s' AS $fn$
DECLARE v_run gov_repo.discovery_run_bindings; v_identity jsonb; v_built jsonb; item jsonb; f jsonb; v_keys text[];
 v_row gov_repo.execution_source_snapshots; v_head text; v_digest char(64); v_generation uuid; v_created boolean:=false; v_new boolean;
BEGIN
 PERFORM gov_repo.discovery_machine_canonical_json_v1(p_snapshot);
 IF pg_catalog.jsonb_typeof(p_snapshot) IS DISTINCT FROM 'object'
 OR NOT(p_snapshot ?& ARRAY['snapshotId','agentVersionCandidateId','sourceObject','declarationKey','sourceSnapshotId','behaviorFingerprint','recordedAt','authorizationState','facts'])
 OR p_snapshot-ARRAY['snapshotId','agentVersionCandidateId','sourceObject','declarationKey','sourceSnapshotId','behaviorFingerprint','recordedAt','authorizationState','facts']<>'{}'::jsonb
 OR p_snapshot->>'authorizationState' IS DISTINCT FROM 'UNKNOWN'
 OR pg_catalog.jsonb_typeof(p_snapshot->'facts') IS DISTINCT FROM 'array'
 OR pg_catalog.jsonb_typeof(p_snapshot->'behaviorFingerprint') IS DISTINCT FROM 'object'
 OR (p_snapshot->'behaviorFingerprint')-ARRAY['algorithm','schemaVersion','value']<>'{}'::jsonb
 OR p_snapshot#>>'{behaviorFingerprint,algorithm}' IS DISTINCT FROM 'sha256'
 OR coalesce(p_snapshot#>>'{behaviorFingerprint,schemaVersion}','') NOT IN ('1.0','1.1')
 OR coalesce(p_snapshot#>>'{behaviorFingerprint,value}','') !~ '^[0-9a-f]{32}$'
 OR coalesce(pg_catalog.length(p_snapshot->>'declarationKey'),0) NOT BETWEEN 1 AND 4096 THEN
  RAISE EXCEPTION 'DISCOVERY_MACHINE_MALFORMED_COMMAND' USING ERRCODE='22023'; END IF;
 IF pg_catalog.jsonb_array_length(p_snapshot->'facts')>193 THEN RAISE EXCEPTION 'DISCOVERY_MACHINE_MALFORMED_COMMAND' USING ERRCODE='22023'; END IF;
 FOR item IN SELECT value FROM pg_catalog.jsonb_array_elements(p_snapshot->'facts') LOOP
  IF pg_catalog.jsonb_typeof(item)<>'object' OR NOT(item ?& ARRAY['fact','assertionId','evidenceId'])
  OR item-ARRAY['fact','assertionId','evidenceId','toolCandidateId']<>'{}'::jsonb OR pg_catalog.jsonb_typeof(item->'fact') IS DISTINCT FROM 'object' THEN
   RAISE EXCEPTION 'DISCOVERY_MACHINE_MALFORMED_COMMAND' USING ERRCODE='22023'; END IF;
  f:=item->'fact';
  v_keys:=CASE f->>'field' WHEN 'CAPABILITY' THEN ARRAY['field','capabilityReference'] WHEN 'PRINCIPAL' THEN ARRAY['field','principal']
    WHEN 'REQUESTED_SCOPE' THEN ARRAY['field','scopeReference','resourceReference'] WHEN 'DECLARED_CONNECTIVITY' THEN ARRAY['field','endpoint','protocol'] END;
  IF v_keys IS NULL OR NOT(f ?& v_keys) OR f-v_keys<>'{}'::jsonb
   OR ((f->>'field'='CAPABILITY') IS DISTINCT FROM (item ? 'toolCandidateId')) THEN
   RAISE EXCEPTION 'DISCOVERY_MACHINE_MALFORMED_COMMAND' USING ERRCODE='22023'; END IF;
  IF f->>'field'='PRINCIPAL' AND (pg_catalog.jsonb_typeof(f->'principal') IS DISTINCT FROM 'object'
   OR NOT((f->'principal') ?& ARRAY['kind','providerCode','authorityReference','principalReference'])
   OR (f->'principal')-ARRAY['kind','providerCode','authorityReference','principalReference']<>'{}'::jsonb
   OR coalesce(f#>>'{principal,kind}','') NOT IN ('SERVICE_ACCOUNT','OAUTH_CLIENT','MANAGED_IDENTITY','WORKLOAD_IDENTITY','USER_DELEGATED')) THEN
   RAISE EXCEPTION 'DISCOVERY_MACHINE_MALFORMED_COMMAND' USING ERRCODE='22023'; END IF;
  IF f->>'field'='DECLARED_CONNECTIVITY' THEN
   IF coalesce(f->>'endpoint','') !~ '^(http|https|ws|wss)://[^/@?#%[:space:]]+([/:][^?#%[:space:]]*)?$'
    OR NOT ((f#>>'{protocol,kind}'='API' AND (f->'protocol')-ARRAY['kind','family']='{}'::jsonb
        AND coalesce(f#>>'{protocol,family}','') IN ('UNKNOWN','HTTP','GRPC','GRAPHQL','WEBSOCKET','EVENT','OTHER'))
     OR (f#>>'{protocol,kind}'='MCP' AND (f->'protocol')-ARRAY['kind','transport']='{}'::jsonb
        AND coalesce(f#>>'{protocol,transport}','') IN ('UNKNOWN','STDIO','STREAMABLE_HTTP','SERVER_SENT_EVENTS','OTHER'))) THEN
    RAISE EXCEPTION 'DISCOVERY_MACHINE_MALFORMED_COMMAND' USING ERRCODE='22023'; END IF;
  END IF;
  IF EXISTS(WITH RECURSIVE nodes(v) AS (VALUES(f) UNION ALL SELECT e.value FROM nodes n CROSS JOIN LATERAL
   pg_catalog.jsonb_each(CASE WHEN pg_catalog.jsonb_typeof(n.v)='object' THEN n.v ELSE '{}'::jsonb END) e)
   SELECT 1 FROM nodes WHERE pg_catalog.jsonb_typeof(v)<>'object' AND (pg_catalog.jsonb_typeof(v)<>'string'
    OR pg_catalog.length(v#>>'{}') NOT BETWEEN 1 AND 512 OR (v#>>'{}') ~ '[[:space:]?#%\x01-\x1f\x7f]'
    OR (v#>>'{}') ~* '(bearer|basic|password|passwd|client[_-]?secret|api[_-]?key|access[_-]?token|refresh[_-]?token|authorization|cookie|private[_-]?key)[=:]|-----BEGIN|eyJ[A-Za-z0-9_-]+\.|sk[-_][A-Za-z0-9_-]{8,}|gh[pousr]_[A-Za-z0-9]+|AKIA[A-Z0-9]{16}|://[^/]*@')) THEN
   RAISE EXCEPTION 'DISCOVERY_MACHINE_MALFORMED_COMMAND' USING ERRCODE='22023'; END IF;
 END LOOP;
 IF (SELECT count(*) FROM pg_catalog.jsonb_array_elements(p_snapshot->'facts') x WHERE x#>>'{fact,field}'='PRINCIPAL')>1 THEN
  RAISE EXCEPTION 'DISCOVERY_MACHINE_MALFORMED_COMMAND' USING ERRCODE='22023'; END IF;
 v_run:=gov_repo.discovery_machine_lock_run_v1(p_run,false);
 IF v_run.conclusion_status IS NOT NULL THEN RETURN '{"outcome":"STATE_CONFLICT"}'::jsonb; END IF;
 IF NOT EXISTS(SELECT 1 FROM gov_repo.discovery_candidates c JOIN gov_repo.discovery_machine_admissions a ON a.organisation_id=c.organisation_id
  AND a.record_id=c.candidate_id AND a.record_kind='NORMALIZED_CANDIDATE' AND a.run_id=p_run WHERE c.organisation_id=v_run.organisation_id
  AND c.candidate_id=p_snapshot->>'agentVersionCandidateId' AND c.candidate_kind='AGENT_VERSION' AND c.source_connection_id=v_run.source_connection_id
  AND c.envelope->'sourceObject'=p_snapshot->'sourceObject')
 OR NOT EXISTS(SELECT 1 FROM gov_repo.agent_version_technical_profile_proposals p JOIN gov_repo.discovery_machine_admissions a ON a.organisation_id=p.organisation_id
  AND a.record_id=p.proposal_id AND a.record_kind='TECHNICAL_PROFILE_PROPOSAL' AND a.run_id=p_run WHERE p.organisation_id=v_run.organisation_id
  AND p.agent_version_candidate_id=p_snapshot->>'agentVersionCandidateId' AND p.behavior_fingerprint_value=p_snapshot#>>'{behaviorFingerprint,value}'
  AND p.behavior_fingerprint_schema_version=p_snapshot#>>'{behaviorFingerprint,schemaVersion}' AND p.behavior_fingerprint_algorithm='sha256')
 OR NOT EXISTS(SELECT 1 FROM gov_repo.source_assertions s JOIN gov_repo.discovery_machine_admissions a ON a.organisation_id=s.organisation_id AND a.record_id=s.assertion_id
  AND a.record_kind='SOURCE_ASSERTION' AND a.run_id=p_run WHERE s.organisation_id=v_run.organisation_id AND s.snapshot_id=p_snapshot->>'sourceSnapshotId'
  AND s.envelope->'sourceObject'=p_snapshot->'sourceObject') THEN RAISE EXCEPTION 'S3_DENIED' USING ERRCODE='P0301'; END IF;
 FOR item IN SELECT value FROM pg_catalog.jsonb_array_elements(p_snapshot->'facts') LOOP
  IF NOT EXISTS(SELECT 1 FROM gov_repo.discovery_machine_admissions a WHERE a.run_id=p_run AND a.record_kind='SOURCE_ASSERTION' AND a.record_id=item->>'assertionId')
   OR NOT EXISTS(SELECT 1 FROM gov_repo.discovery_machine_admissions a WHERE a.run_id=p_run AND a.record_kind='EVIDENCE' AND a.record_id=item->>'evidenceId')
   OR (item ? 'toolCandidateId' AND NOT EXISTS(SELECT 1 FROM gov_repo.discovery_machine_admissions a WHERE a.run_id=p_run AND a.record_kind='NORMALIZED_CANDIDATE' AND a.record_id=item->>'toolCandidateId')) THEN
   RAISE EXCEPTION 'S3_DENIED' USING ERRCODE='P0301'; END IF;
 END LOOP;
 v_identity:=gov_repo.discovery_machine_execution_identity_v1(v_run.organisation_id,p_snapshot);
 IF p_snapshot->>'snapshotId' IS DISTINCT FROM v_identity->>'snapshotId' THEN RAISE EXCEPTION 'DISCOVERY_MACHINE_MALFORMED_COMMAND' USING ERRCODE='22023'; END IF;
 v_built:=p_snapshot||pg_catalog.jsonb_build_object('organisationId',v_run.organisation_id,'sourceScope',v_identity->>'sourceScope',
  'sourceSystemId',v_run.source_system_id,'providerCode',v_run.provider);
 -- Preserve the inner writer's digest and advisory-lock namespace exactly.
 v_digest:=pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to((v_built-'recordedAt')::text,'UTF8')),'hex');
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_run.organisation_id::text||':execution-source:'||(v_identity->>'sourceScope'),0));
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_run.organisation_id::text||':discovery-machine:EXECUTION_SNAPSHOT:'||(v_identity->>'snapshotId'),0));
 SELECT * INTO v_row FROM gov_repo.execution_source_snapshots WHERE organisation_id=v_run.organisation_id AND snapshot_id=v_identity->>'snapshotId';
 IF FOUND THEN
  IF v_row.content_digest<>v_digest THEN RAISE EXCEPTION 'S3_CONTENT_CONFLICT' USING ERRCODE='P0302'; END IF;
 ELSE
  SELECT snapshot_id INTO v_head FROM gov_repo.execution_source_heads WHERE organisation_id=v_run.organisation_id AND source_scope=v_identity->>'sourceScope';
  PERFORM gov_repo.record_execution_snapshot(v_run.organisation_id,v_built,v_head);
  v_created:=true;
 END IF;
 v_generation:=(gov_repo.discovery_machine_authorize_v1(v_run.binding_id,v_run.binding_revision)->>'credential_generation_id')::uuid;
 v_new:=gov_repo.discovery_machine_record_admission_v1(p_run,'EXECUTION_SNAPSHOT',v_identity->>'snapshotId',v_digest,v_created,v_generation);
 PERFORM gov_repo.discovery_machine_authorize_v1(v_run.binding_id,v_run.binding_revision);
 RETURN pg_catalog.jsonb_build_object('outcome',CASE WHEN v_new THEN 'APPLIED' ELSE 'REPLAYED' END,'snapshotId',v_identity->>'snapshotId');
EXCEPTION WHEN SQLSTATE 'P0301' THEN RETURN '{"outcome":"DENIED","denial_code":"SUPPORT_NOT_ADMITTED"}'::jsonb;
 WHEN SQLSTATE 'P0302' THEN RETURN '{"outcome":"CONTENT_CONFLICT"}'::jsonb;
END;
$fn$;

CREATE FUNCTION gov_repo.discovery_machine_get_candidate_v1(p_run text,p_finding text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp SET lock_timeout = '5s' AS $fn$
DECLARE v_run gov_repo.discovery_run_bindings; v_candidate jsonb;
BEGIN
 IF p_finding IS NULL OR p_finding !~ '^discovery-finding:((agent-version|relationship):)?([0-9a-f]{32}|[0-9a-f]{64})$' THEN
  RAISE EXCEPTION 'DISCOVERY_MACHINE_MALFORMED_COMMAND' USING ERRCODE='22023'; END IF;
 v_run:=gov_repo.discovery_machine_lock_run_v1(p_run,false);
 IF v_run.conclusion_status IS NOT NULL THEN RAISE EXCEPTION 'S3_DENIED' USING ERRCODE='P0301'; END IF;
 SELECT c.envelope INTO v_candidate FROM gov_repo.discovery_candidates c JOIN gov_repo.discovery_machine_admissions a
 ON a.organisation_id=c.organisation_id AND a.record_id=c.candidate_id AND a.record_kind='NORMALIZED_CANDIDATE' AND a.run_id=p_run
 WHERE c.organisation_id=v_run.organisation_id AND c.finding_id=p_finding AND c.source_connection_id=v_run.source_connection_id;
 PERFORM gov_repo.discovery_machine_authorize_v1(v_run.binding_id,v_run.binding_revision);
 RETURN pg_catalog.jsonb_build_object('outcome','READ','candidate',v_candidate);
EXCEPTION WHEN SQLSTATE 'P0301' THEN RETURN '{"outcome":"DENIED","denial_code":"BINDING_NOT_ELIGIBLE"}'::jsonb;
END;
$fn$;

CREATE FUNCTION gov_repo.discovery_machine_is_governed_v1(p_run text,p_type text,p_external text,p_kind text,p_identity text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp SET lock_timeout = '5s' AS $fn$
DECLARE v_run gov_repo.discovery_run_bindings; v_governed boolean;
BEGIN
 IF EXISTS(SELECT 1 FROM pg_catalog.unnest(ARRAY[p_type,p_external,p_kind,p_identity]) x WHERE x IS NULL
  OR pg_catalog.length(x) NOT BETWEEN 1 AND 4096 OR x ~ '[\x01-\x1f\x7f-\x9f]')
 OR p_kind NOT IN ('AGENT','AGENT_VERSION','MODEL','TOOL','MCP_SERVER','API','PROMPT','KNOWLEDGE_BASE','DATA_ASSET','DATA_ELEMENT','SKILL') THEN
  RAISE EXCEPTION 'DISCOVERY_MACHINE_MALFORMED_COMMAND' USING ERRCODE='22023'; END IF;
 v_run:=gov_repo.discovery_machine_lock_run_v1(p_run,false);
 IF v_run.conclusion_status IS NOT NULL THEN RAISE EXCEPTION 'S3_DENIED' USING ERRCODE='P0301'; END IF;
 SELECT EXISTS(SELECT 1 FROM gov_repo.canonical_normalized_object_mappings m WHERE m.organisation_id=v_run.organisation_id
  AND m.source_connection_id COLLATE "C"=v_run.source_connection_id COLLATE "C"
  AND m.source_external_type COLLATE "C"=p_type COLLATE "C" AND m.source_external_id COLLATE "C"=p_external COLLATE "C"
  AND m.canonical_object_kind COLLATE "C"=p_kind COLLATE "C" AND m.normalized_object_identity COLLATE "C"=p_identity COLLATE "C") INTO v_governed;
 PERFORM gov_repo.discovery_machine_authorize_v1(v_run.binding_id,v_run.binding_revision);
 RETURN pg_catalog.jsonb_build_object('outcome','READ','isGoverned',v_governed);
EXCEPTION WHEN SQLSTATE 'P0301' THEN RETURN '{"outcome":"DENIED","denial_code":"BINDING_NOT_ELIGIBLE"}'::jsonb;
END;
$fn$;

-- Explicit closure also removes hostile historical creator default grants.
-- Historical trigger helpers cannot be invoked as SQL commands, but PUBLIC EXECUTE
-- still violates the exact effective routine surface. Preserve legacy application ACLs.
REVOKE EXECUTE ON FUNCTION gov_repo.set_updated_at(),gov_repo.compute_retention_until(),
 gov_repo.update_agent_compliance_flags(),gov_repo.set_propagation_criticality(),
 gov_repo.compute_dora_reporting_deadlines(),gov_repo.update_ai_system_compliance_flags(),
 gov_repo.sync_ai_system_incident_count() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION gov_repo.set_updated_at(),gov_repo.compute_retention_until(),
 gov_repo.update_agent_compliance_flags(),gov_repo.set_propagation_criticality(),
 gov_repo.compute_dora_reporting_deadlines(),gov_repo.update_ai_system_compliance_flags(),
 gov_repo.sync_ai_system_incident_count() TO anon,authenticated,service_role;
DO $closure$
DECLARE t text; v_proc record;
BEGIN
 FOREACH t IN ARRAY ARRAY['discovery_run_bindings','discovery_machine_admissions'] LOOP
  EXECUTE pg_catalog.format('REVOKE ALL ON gov_repo.%I FROM PUBLIC,anon,authenticated,service_role,govia_discovery_provisioner,govia_discovery_machine_caller,govia_ledger_executor,govia_runtime_executor,govia_legacy_read_executor,govia_legacy_graph_executor',t);
  EXECUTE pg_catalog.format('ALTER TABLE gov_repo.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE pg_catalog.format('ALTER TABLE gov_repo.%I OWNER TO govia_discovery_control_owner',t);
  EXECUTE pg_catalog.format('GRANT SELECT,INSERT ON gov_repo.%I TO govia_discovery_intake_owner',t);
  EXECUTE pg_catalog.format('CREATE POLICY discovery_intake_read ON gov_repo.%I FOR SELECT TO govia_discovery_intake_owner USING(true)',t);
  EXECUTE pg_catalog.format('CREATE POLICY discovery_intake_insert ON gov_repo.%I FOR INSERT TO govia_discovery_intake_owner WITH CHECK(true)',t);
 END LOOP;
 FOR v_proc IN SELECT p.oid,p.proname,pg_catalog.pg_get_function_identity_arguments(p.oid) args FROM pg_catalog.pg_proc p
 JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='gov_repo' AND p.proname LIKE 'discovery_machine\_%' ESCAPE '\' LOOP
  EXECUTE pg_catalog.format('REVOKE ALL ON FUNCTION gov_repo.%I(%s) FROM PUBLIC,anon,authenticated,service_role,govia_discovery_provisioner,govia_discovery_machine_caller,govia_ledger_executor,govia_runtime_executor,govia_legacy_read_executor,govia_legacy_graph_executor',v_proc.proname,v_proc.args);
  EXECUTE pg_catalog.format('ALTER FUNCTION gov_repo.%I(%s) OWNER TO %I',v_proc.proname,v_proc.args,
    CASE WHEN v_proc.proname IN ('discovery_machine_authorize_v1','discovery_machine_run_binding_guard_v1') THEN 'govia_discovery_control_owner' ELSE 'govia_discovery_intake_owner' END);
 END LOOP;
END;
$closure$;
GRANT EXECUTE ON FUNCTION gov_repo.discovery_machine_authorize_v1(uuid,bigint),gov_repo.discovery_machine_run_binding_guard_v1() TO govia_discovery_intake_owner;
GRANT UPDATE(conclusion_status,conclusion_failure_code,conclusion_counts,concluded_at,conclusion_generation_id)
 ON gov_repo.discovery_run_bindings TO govia_discovery_intake_owner;
CREATE POLICY discovery_run_conclude ON gov_repo.discovery_run_bindings FOR UPDATE TO govia_discovery_intake_owner USING(true) WITH CHECK(true);
GRANT SELECT,INSERT,UPDATE ON gov_repo.acquisition_runs TO govia_discovery_intake_owner;
CREATE POLICY discovery_intake_read ON gov_repo.acquisition_runs FOR SELECT TO govia_discovery_intake_owner USING(true);
CREATE POLICY discovery_intake_insert ON gov_repo.acquisition_runs FOR INSERT TO govia_discovery_intake_owner WITH CHECK(true);
CREATE POLICY discovery_intake_update ON gov_repo.acquisition_runs FOR UPDATE TO govia_discovery_intake_owner USING(true) WITH CHECK(true);
GRANT EXECUTE ON FUNCTION gov_repo.set_updated_at() TO govia_discovery_intake_owner;
GRANT EXECUTE ON FUNCTION gov_repo.discovery_machine_open_run_v1(uuid,text,text,text,text,text,text,timestamptz) TO govia_discovery_machine_caller;
GRANT EXECUTE ON FUNCTION gov_repo.discovery_machine_complete_run_v1(text,text,jsonb,timestamptz,text) TO govia_discovery_machine_caller;
GRANT EXECUTE ON FUNCTION gov_repo.discovery_machine_admit_observation_v1(text,jsonb,jsonb) TO govia_discovery_machine_caller;
GRANT EXECUTE ON FUNCTION gov_repo.discovery_machine_admit_finding_v1(text,jsonb,jsonb),gov_repo.discovery_machine_admit_lineage_v1(text,jsonb,jsonb) TO govia_discovery_machine_caller;
GRANT EXECUTE ON FUNCTION gov_repo.discovery_machine_create_subject_v1(text,text) TO govia_discovery_machine_caller;
GRANT EXECUTE ON FUNCTION gov_repo.discovery_machine_record_technical_profile_v1(text,jsonb),gov_repo.discovery_machine_record_execution_snapshot_v1(text,jsonb) TO govia_discovery_machine_caller;
GRANT EXECUTE ON FUNCTION gov_repo.discovery_machine_get_candidate_v1(text,text),gov_repo.discovery_machine_is_governed_v1(text,text,text,text,text) TO govia_discovery_machine_caller;
GRANT SELECT(organisation_id,source_connection_id,source_external_type,source_external_id,canonical_object_kind,normalized_object_identity)
 ON gov_repo.canonical_normalized_object_mappings TO govia_discovery_intake_owner;
CREATE POLICY discovery_intake_read ON gov_repo.canonical_normalized_object_mappings FOR SELECT TO govia_discovery_intake_owner USING(true);
-- Existing postgres ADMIN-only membership is temporarily usable for this single grant;
-- restore the frozen ADMIN=true/INHERIT=false/SET=false edge immediately.
GRANT govia_runtime_executor TO postgres WITH INHERIT FALSE, SET TRUE;
SET LOCAL ROLE govia_runtime_executor;
GRANT EXECUTE ON FUNCTION gov_repo.record_execution_snapshot(uuid,jsonb,text) TO govia_discovery_intake_owner;
RESET ROLE;
REVOKE govia_runtime_executor FROM postgres;
GRANT SELECT ON gov_repo.execution_source_snapshots,gov_repo.execution_source_heads TO govia_discovery_intake_owner;
CREATE POLICY discovery_intake_read ON gov_repo.execution_source_snapshots FOR SELECT TO govia_discovery_intake_owner USING(true);
CREATE POLICY discovery_intake_read ON gov_repo.execution_source_heads FOR SELECT TO govia_discovery_intake_owner USING(true);
GRANT EXECUTE ON FUNCTION gov_repo.normalized_object_identity(uuid,jsonb),gov_repo.frame_identity(text[]) TO govia_discovery_intake_owner;
DO $observation_acl$
DECLARE t text;
BEGIN
 FOREACH t IN ARRAY ARRAY['discovery_evidence','source_assertions','source_assertion_evidence',
 'discovery_findings','discovery_finding_assertions','discovery_finding_evidence','discovery_candidates','discovery_candidate_assertions','discovery_candidate_evidence','lineage_candidate_observations',
 'review_subjects','review_subject_assertions','review_subject_evidence','agent_version_technical_profile_proposals',
 'agent_version_technical_profile_proposal_field_assertions','agent_version_technical_profile_proposal_field_evidence'] LOOP
  EXECUTE pg_catalog.format('GRANT SELECT,INSERT ON gov_repo.%I TO govia_discovery_intake_owner',t);
  EXECUTE pg_catalog.format('CREATE POLICY discovery_intake_read ON gov_repo.%I FOR SELECT TO govia_discovery_intake_owner USING(true)',t);
  EXECUTE pg_catalog.format('CREATE POLICY discovery_intake_insert ON gov_repo.%I FOR INSERT TO govia_discovery_intake_owner WITH CHECK(true)',t);
 END LOOP;
END;
$observation_acl$;

-- Attest the exact actual pg_proc identities at installation, without deployment-specific OID constants in source.
-- The attestation lives in this existing S2 predicate, not in another registry or caller-controlled setting.
DO $certify$
DECLARE v_cert text; v_body text;
BEGIN
 SELECT pg_catalog.string_agg(pg_catalog.format('(%s::oid,%L::name,%L::oidvector,%s::oid,%L::text)',p.oid,p.proname,p.proargtypes,p.proowner,
 pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.pg_get_functiondef(p.oid),'UTF8')),'hex')),',' ORDER BY p.proname)
 INTO v_cert FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='gov_repo' AND p.prosecdef AND p.proowner='govia_discovery_intake_owner'::regrole;
 SELECT p.prosrc INTO v_body FROM pg_catalog.pg_proc p WHERE p.oid='gov_repo.machine_role_safe_v1(oid,text)'::regprocedure;
 v_body := pg_catalog.substr(v_body,1,pg_catalog.strpos(v_body,'   AND NOT EXISTS (SELECT 1 FROM pg_proc')) || pg_catalog.format($body$
   AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
     WHERE n.nspname='gov_repo' AND pg_catalog.has_function_privilege(r.oid,p.oid,'EXECUTE')
       AND NOT EXISTS(SELECT 1 FROM (VALUES %s) certified(proc_oid,proc_name,argtypes,owner_oid,definition_hash)
         WHERE p.oid=certified.proc_oid AND p.proname=certified.proc_name AND p.proargtypes=certified.argtypes
         AND p.proowner=certified.owner_oid AND p.prosecdef
         AND pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.pg_get_functiondef(p.oid),'UTF8')),'hex')=certified.definition_hash)));
 $body$,v_cert);
 -- Remove the start of the replaced predicate retained by substr.
 v_body := pg_catalog.replace(v_body,'   AND NOT EXISTS (SELECT 1 FROM pg_proc' || chr(10),chr(10));
 EXECUTE pg_catalog.format('CREATE OR REPLACE FUNCTION gov_repo.machine_role_safe_v1(p_oid oid,p_name text) RETURNS boolean LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS %L',v_body);
END;
$certify$;
REVOKE CREATE ON SCHEMA gov_repo FROM govia_discovery_intake_owner,govia_discovery_control_owner;
REVOKE govia_discovery_intake_owner,govia_discovery_control_owner FROM postgres;
DO $s3_postflight$
DECLARE v_proc record; v_role record; v_table record;
BEGIN
 IF (SELECT count(*) FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='gov_repo' AND p.proname LIKE 'discovery_machine\_%' ESCAPE '\')<>19
 OR (SELECT count(*) FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='gov_repo' AND c.relkind='r' AND c.relname IN ('discovery_run_bindings','discovery_machine_admissions'))<>2 THEN
  RAISE EXCEPTION 'S3_POSTFLIGHT: census'; END IF;
 IF EXISTS(SELECT 1 FROM pg_catalog.pg_roles r WHERE r.rolname='govia_discovery_intake_owner' AND (r.rolcanlogin OR r.rolsuper OR r.rolcreatedb OR r.rolcreaterole OR r.rolreplication OR r.rolbypassrls OR r.rolinherit
  OR pg_catalog.has_schema_privilege(r.oid,'gov_repo','CREATE') OR EXISTS(SELECT 1 FROM pg_catalog.pg_auth_members m WHERE m.member=r.oid)
  OR EXISTS(SELECT 1 FROM pg_catalog.pg_auth_members m WHERE m.roleid=r.oid AND (m.member<>'postgres'::regrole OR m.inherit_option OR m.set_option)))) THEN
  RAISE EXCEPTION 'S3_POSTFLIGHT: unsafe intake owner'; END IF;
 FOR v_proc IN SELECT p.* FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='gov_repo' AND p.proname LIKE 'discovery_machine\_%' ESCAPE '\' LOOP
  IF NOT('search_path=pg_catalog, pg_temp'=ANY(v_proc.proconfig))
   OR pg_catalog.pg_get_userbyid(v_proc.proowner)<>(CASE WHEN v_proc.proname IN ('discovery_machine_authorize_v1','discovery_machine_run_binding_guard_v1') THEN 'govia_discovery_control_owner' ELSE 'govia_discovery_intake_owner' END)
   OR EXISTS(SELECT 1 FROM pg_catalog.aclexplode(coalesce(v_proc.proacl,pg_catalog.acldefault('f',v_proc.proowner))) a WHERE a.grantee=0)
   OR v_proc.prosecdef IS DISTINCT FROM (v_proc.proname IN ('discovery_machine_authorize_v1','discovery_machine_open_run_v1','discovery_machine_complete_run_v1','discovery_machine_admit_observation_v1','discovery_machine_admit_finding_v1','discovery_machine_admit_lineage_v1','discovery_machine_create_subject_v1','discovery_machine_record_technical_profile_v1','discovery_machine_record_execution_snapshot_v1','discovery_machine_get_candidate_v1','discovery_machine_is_governed_v1')) THEN
   RAISE EXCEPTION 'S3_POSTFLIGHT: routine owner/path/mode/PUBLIC'; END IF;
  FOR v_role IN SELECT * FROM pg_catalog.pg_roles WHERE rolname IN ('anon','authenticated','service_role','govia_discovery_provisioner','govia_ledger_executor','govia_runtime_executor','govia_legacy_read_executor','govia_legacy_graph_executor') LOOP
   IF pg_catalog.has_function_privilege(v_role.oid,v_proc.oid,'EXECUTE') THEN RAISE EXCEPTION 'S3_POSTFLIGHT: routine ACL'; END IF;
  END LOOP;
  IF pg_catalog.has_function_privilege('govia_discovery_machine_caller',v_proc.oid,'EXECUTE') IS DISTINCT FROM
   (v_proc.prosecdef AND v_proc.proowner='govia_discovery_intake_owner'::regrole) THEN RAISE EXCEPTION 'S3_POSTFLIGHT: caller surface'; END IF;
 END LOOP;
 IF (SELECT count(*) FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='gov_repo'
  AND pg_catalog.has_function_privilege('govia_discovery_machine_caller',p.oid,'EXECUTE'))<>10 THEN RAISE EXCEPTION 'S3_POSTFLIGHT: effective command census'; END IF;
 FOR v_table IN SELECT c.* FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='gov_repo' AND c.relname IN ('discovery_run_bindings','discovery_machine_admissions') LOOP
  IF NOT v_table.relrowsecurity OR v_table.relowner<>'govia_discovery_control_owner'::regrole
   OR EXISTS(SELECT 1 FROM pg_catalog.aclexplode(v_table.relacl) a WHERE a.grantee=0) THEN RAISE EXCEPTION 'S3_POSTFLIGHT: table owner/RLS/PUBLIC'; END IF;
  FOR v_role IN SELECT * FROM pg_catalog.pg_roles WHERE rolname IN ('anon','authenticated','service_role','govia_discovery_machine_caller','govia_discovery_provisioner','govia_ledger_executor','govia_runtime_executor','govia_legacy_read_executor','govia_legacy_graph_executor') LOOP
   IF pg_catalog.has_table_privilege(v_role.oid,v_table.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN') OR pg_catalog.has_any_column_privilege(v_role.oid,v_table.oid,'SELECT,INSERT,UPDATE,REFERENCES') THEN
    RAISE EXCEPTION 'S3_POSTFLIGHT: effective table privilege'; END IF;
  END LOOP;
 END LOOP;
 IF EXISTS(SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='gov_repo' AND c.relname LIKE 'machine\_%' ESCAPE '\'
  AND (pg_catalog.has_table_privilege('govia_discovery_intake_owner',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
   OR pg_catalog.has_any_column_privilege('govia_discovery_intake_owner',c.oid,'SELECT,INSERT,UPDATE,REFERENCES'))) THEN
  RAISE EXCEPTION 'S3_POSTFLIGHT: direct S2 access'; END IF;
 IF pg_catalog.has_function_privilege('govia_discovery_intake_owner','gov_repo.machine_lock_eligibility_v1(uuid,bigint)','EXECUTE')
  OR pg_catalog.has_function_privilege('govia_discovery_machine_caller','gov_repo.record_execution_snapshot(uuid,jsonb,text)','EXECUTE') THEN
  RAISE EXCEPTION 'S3_POSTFLIGHT: hidden execute path'; END IF;
END;
$s3_postflight$;

COMMIT;
