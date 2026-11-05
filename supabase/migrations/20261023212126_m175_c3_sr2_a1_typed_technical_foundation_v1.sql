-- SR2-A1: owner-private DERIVED_ANALYTICAL_NON_AUTHORITATIVE technical foundation.
-- Approved redesign + final owner reduction: 24 tables / 11 private functions / 59 triggers.
-- No application reader/writer, provider activation, population or authority admission.
BEGIN;
DO $preflight$
BEGIN
 IF current_user <> 'postgres' OR current_setting('server_version_num')::integer NOT BETWEEN 170000 AND 179999

 OR NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname='vector' AND extversion='0.8.7') THEN
 RAISE EXCEPTION 'SR2_A1_BASELINE_REQUIRED'; END IF;
 IF EXISTS (SELECT 1 FROM pg_class WHERE relnamespace='gov_repo'::regnamespace AND relname LIKE 'sr2\_%' ESCAPE '\')
 OR EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace='gov_repo'::regnamespace AND proname LIKE 'sr2\_%' ESCAPE '\') THEN
 RAISE EXCEPTION 'SR2_A1_OBJECT_CONFLICT'; END IF;
END $preflight$;

DO $sr1_baseline$
DECLARE v_hash text; v_oid oid; v_ext name; v_proc record;
BEGIN
 SELECT encode(sha256(convert_to((SELECT coalesce(jsonb_agg(jsonb_build_object('identity',p.oid::regprocedure::text,
 'owner',pg_get_userbyid(p.proowner),'body_sha256',encode(sha256(convert_to(replace(p.prosrc,chr(13),''),'UTF8')),'hex'),
 'config',p.proconfig,'acl',p.proacl::text,'definer',p.prosecdef,'volatility',p.provolatile,'parallel',p.proparallel,
 'result',pg_get_function_result(p.oid),'language',l.lanname) ORDER BY p.oid::regprocedure::text COLLATE "C"),'[]')::text
 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_language l ON l.oid=p.prolang
 WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_%'
 AND NOT EXISTS(SELECT FROM pg_depend d WHERE d.classid='pg_proc'::regclass AND d.objid=p.oid AND d.deptype='e') AND NOT (n.nspname='gov_repo' AND p.proname='semantic_context_search_v1')),'UTF8')),'hex') INTO v_hash;
 IF v_hash<>'829230366d53be537efe3ddabab78fbe9e5ea8f2282c3e34e17f1110b4fd6e33' THEN RAISE EXCEPTION 'SR1_CLOSED_CATALOG_DRIFT' USING ERRCODE='55000'; END IF;
 SELECT n.nspname INTO v_ext FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace WHERE e.extname='vector';
 IF v_ext IS NULL OR EXISTS(SELECT FROM unnest(ARRAY['anon','authenticated','service_role']) r
   WHERE has_schema_privilege(r,v_ext,'CREATE')) THEN RAISE EXCEPTION 'SR1_UNTRUSTED_VECTOR_SCHEMA'; END IF;
 v_oid:=to_regprocedure(format('gov_repo.semantic_context_search_v1(uuid,uuid,bigint,bigint,timestamptz,%I.vector,text,text,text,integer,text,integer,double precision)',v_ext));
 IF v_oid IS NULL OR (SELECT count(*) FROM pg_proc WHERE pronamespace='gov_repo'::regnamespace AND proname='semantic_context_search_v1')<>1 THEN
   RAISE EXCEPTION 'SR1_EXACT_IDENTITY_REQUIRED' USING ERRCODE='55000'; END IF;
 SELECT * INTO v_proc FROM pg_proc WHERE oid=v_oid;
 IF pg_get_userbyid(v_proc.proowner)<>'postgres' OR NOT v_proc.prosecdef OR v_proc.provolatile<>'v'
   OR v_proc.proparallel<>'u' OR v_proc.prorettype<>'jsonb'::regtype OR v_proc.pronargdefaults<>0
   OR v_proc.prolang<>(SELECT oid FROM pg_language WHERE lanname='plpgsql') OR v_proc.proisstrict OR v_proc.proleakproof
   OR v_proc.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, pg_temp','lock_timeout=5s']
   OR encode(sha256(convert_to(replace(replace(v_proc.prosrc,chr(13),''),quote_ident(v_ext)||'.','__vector__.'),'UTF8')),'hex')<>'f01c0e4aedf049fb5a8aac886553d6f3e6b3207da9fc0c5f2d130229b7f6ab24'
   OR EXISTS(SELECT FROM aclexplode(coalesce(v_proc.proacl,acldefault('f',v_proc.proowner))) a
       WHERE a.privilege_type<>'EXECUTE' OR a.is_grantable OR a.grantee NOT IN ('postgres'::regrole,'service_role'::regrole))
   OR NOT has_function_privilege('service_role',v_oid,'EXECUTE')
   OR has_function_privilege('anon',v_oid,'EXECUTE') OR has_function_privilege('authenticated',v_oid,'EXECUTE') THEN
   RAISE EXCEPTION 'SR1_FROZEN_CAPABILITY_DRIFT' USING ERRCODE='55000'; END IF;
 -- Global and gov_repo routine defaults must never reintroduce app or PUBLIC execute.
 IF EXISTS(SELECT FROM pg_default_acl d CROSS JOIN LATERAL aclexplode(d.defaclacl) a
   WHERE d.defaclrole='postgres'::regrole AND d.defaclobjtype='f'
   AND d.defaclnamespace IN (0,'gov_repo'::regnamespace) AND a.grantee IN (0,'anon'::regrole,'authenticated'::regrole,'service_role'::regrole))
   OR NOT EXISTS(SELECT FROM pg_default_acl WHERE defaclrole='postgres'::regrole AND defaclobjtype='f' AND defaclnamespace=0)
 THEN RAISE EXCEPTION 'SR1_DEFAULT_PRIVILEGE_DRIFT' USING ERRCODE='55000'; END IF;
END $sr1_baseline$;
CREATE FUNCTION gov_repo.sr2_list_valid_v1(p_values text[], p_max integer) RETURNS boolean
LANGUAGE plpgsql SECURITY INVOKER IMMUTABLE PARALLEL SAFE CALLED ON NULL INPUT
SET search_path=pg_catalog,pg_temp AS $function$
DECLARE v text;
BEGIN
 IF p_values IS NULL OR p_max IS NULL OR p_max < 0 OR cardinality(p_values)>p_max THEN RETURN false; END IF;
 IF cardinality(p_values)=0 THEN RETURN array_ndims(p_values) IS NULL; END IF;
 IF array_ndims(p_values)<>1 OR array_lower(p_values,1)<>1 THEN RETURN false; END IF;
 FOREACH v IN ARRAY p_values LOOP
  IF v IS NULL OR NOT (octet_length(v) BETWEEN 1 AND 512 AND v ~ '[^[:space:]]') THEN RETURN false; END IF;
 END LOOP;
 RETURN true;
END
$function$;

CREATE TABLE gov_repo.sr2_repositories_v1 (
  organisation_id uuid NOT NULL,
  repository_id text COLLATE "C" NOT NULL,
  connection_id text COLLATE "C" NOT NULL,
  source_system_id text COLLATE "C" NOT NULL,
  provider_code text COLLATE "C" NOT NULL,
  provider_instance_id text COLLATE "C" NOT NULL,
  provider_repository_id text COLLATE "C" NOT NULL,
  display_label text COLLATE "C" NOT NULL,
  verification_method text COLLATE "C" NOT NULL,
  verifier_version text COLLATE "C" NOT NULL,
  verified_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL,
  CONSTRAINT sr2_repositories_v1_pkey PRIMARY KEY (organisation_id, repository_id),
  CONSTRAINT sr2_repositories_v1_f1 FOREIGN KEY (organisation_id) REFERENCES gov_repo.organisations (organisation_id) ON UPDATE NO ACTION ON DELETE NO ACTION,
  CONSTRAINT sr2_repositories_v1_f2 FOREIGN KEY (organisation_id, connection_id) REFERENCES gov_repo.technical_source_connections (organisation_id, connection_id) ON UPDATE NO ACTION ON DELETE NO ACTION,
  CONSTRAINT sr2_repositories_v1_c1 CHECK ((octet_length(connection_id) BETWEEN 1 AND 512 AND connection_id ~ '[^[:space:]]' AND octet_length(source_system_id) BETWEEN 1 AND 512 AND source_system_id ~ '[^[:space:]]' AND octet_length(provider_code) BETWEEN 1 AND 512 AND provider_code ~ '[^[:space:]]' AND octet_length(provider_instance_id) BETWEEN 1 AND 512 AND provider_instance_id ~ '[^[:space:]]' AND octet_length(provider_repository_id) BETWEEN 1 AND 512 AND provider_repository_id ~ '[^[:space:]]' AND octet_length(display_label) BETWEEN 1 AND 512 AND display_label ~ '[^[:space:]]' AND octet_length(verification_method) BETWEEN 1 AND 512 AND verification_method ~ '[^[:space:]]' AND octet_length(verifier_version) BETWEEN 1 AND 512 AND verifier_version ~ '[^[:space:]]') IS TRUE),
  CONSTRAINT sr2_repositories_v1_c2 CHECK ((repository_id=pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(gov_repo.frame_identity(ARRAY['GOVIA_SR2_ROOT_V1',organisation_id::text,connection_id::text,source_system_id::text,provider_code::text,provider_instance_id::text,provider_repository_id::text]::text[]), 'UTF8')), 'hex')) IS TRUE),
  CONSTRAINT sr2_repositories_v1_c3 CHECK ((verification_method='PROVIDER_REPOSITORY_ID_VERIFIED_V1' AND isfinite(verified_at) AND isfinite(recorded_at) AND verified_at<=recorded_at) IS TRUE)
);
ALTER TABLE gov_repo.sr2_repositories_v1 OWNER TO postgres;
ALTER TABLE gov_repo.sr2_repositories_v1 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE gov_repo.sr2_repositories_v1 FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON TABLE gov_repo.sr2_repositories_v1 IS 'DERIVED_ANALYTICAL_NON_AUTHORITATIVE; immutable SR2-A1 technical analytical storage; no application capability.';

CREATE TABLE gov_repo.sr2_snapshots_v1 (
  organisation_id uuid NOT NULL,
  repository_id text COLLATE "C" NOT NULL,
  snapshot_id text COLLATE "C" NOT NULL,
  revision_scheme text COLLATE "C" NOT NULL,
  full_revision text COLLATE "C" NOT NULL,
  manifest_schema_version text COLLATE "C" NOT NULL,
  manifest_fingerprint text COLLATE "C" NOT NULL,
  manifest_entry_count bigint NOT NULL,
  CONSTRAINT sr2_snapshots_v1_pkey PRIMARY KEY (organisation_id, repository_id, snapshot_id),
  CONSTRAINT sr2_snapshots_v1_u1 UNIQUE (organisation_id, repository_id, snapshot_id, manifest_fingerprint),
  CONSTRAINT sr2_snapshots_v1_f1 FOREIGN KEY (organisation_id, repository_id) REFERENCES gov_repo.sr2_repositories_v1 (organisation_id, repository_id) ON UPDATE NO ACTION ON DELETE NO ACTION,
  CONSTRAINT sr2_snapshots_v1_c1 CHECK (((revision_scheme='GIT_SHA1_V1' AND full_revision ~ '^[0-9a-f]{40}$' AND full_revision<>repeat('0',40)) OR (revision_scheme='GIT_SHA256_V1' AND full_revision ~ '^[0-9a-f]{64}$' AND full_revision<>repeat('0',64))) IS TRUE),
  CONSTRAINT sr2_snapshots_v1_c2 CHECK ((manifest_schema_version='GOVIA_SOURCE_MANIFEST_V1' AND manifest_fingerprint ~ '^[0-9a-f]{64}$' AND manifest_entry_count>=0) IS TRUE),
  CONSTRAINT sr2_snapshots_v1_c3 CHECK ((snapshot_id=pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(gov_repo.frame_identity(ARRAY['GOVIA_SR2_SNAPSHOT_V1',organisation_id::text,repository_id::text,revision_scheme::text,full_revision::text,manifest_fingerprint::text]::text[]), 'UTF8')), 'hex')) IS TRUE)
);
ALTER TABLE gov_repo.sr2_snapshots_v1 OWNER TO postgres;
ALTER TABLE gov_repo.sr2_snapshots_v1 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE gov_repo.sr2_snapshots_v1 FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON TABLE gov_repo.sr2_snapshots_v1 IS 'DERIVED_ANALYTICAL_NON_AUTHORITATIVE; immutable SR2-A1 technical analytical storage; no application capability.';

CREATE TABLE gov_repo.sr2_captures_v1 (
  organisation_id uuid NOT NULL,
  repository_id text COLLATE "C" NOT NULL,
  snapshot_id text COLLATE "C" NOT NULL,
  capture_id uuid NOT NULL,
  method_code text COLLATE "C" NOT NULL,
  method_version text COLLATE "C" NOT NULL,
  observed_provider_instance_id text COLLATE "C" NOT NULL,
  observed_provider_repository_id text COLLATE "C" NOT NULL,
  resolved_revision_scheme text COLLATE "C" NOT NULL,
  resolved_full_revision text COLLATE "C" NOT NULL,
  observed_manifest_fingerprint text COLLATE "C" NOT NULL,
  observed_at timestamptz NOT NULL,
  captured_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL,
  CONSTRAINT sr2_captures_v1_pkey PRIMARY KEY (organisation_id, repository_id, snapshot_id, capture_id),
  CONSTRAINT sr2_captures_v1_u1 UNIQUE (organisation_id, repository_id, snapshot_id, capture_id, observed_at),
  CONSTRAINT sr2_captures_v1_f1 FOREIGN KEY (organisation_id, repository_id, snapshot_id) REFERENCES gov_repo.sr2_snapshots_v1 (organisation_id, repository_id, snapshot_id) ON UPDATE NO ACTION ON DELETE NO ACTION,
  CONSTRAINT sr2_captures_v1_c1 CHECK ((method_code='CAPTURE_AT_IMMUTABLE_REVISION_V1' AND (octet_length(method_version) BETWEEN 1 AND 512 AND method_version ~ '[^[:space:]]' AND lower(btrim(method_version)) NOT IN ('latest','default','unknown')) AND octet_length(observed_provider_instance_id) BETWEEN 1 AND 512 AND observed_provider_instance_id ~ '[^[:space:]]' AND octet_length(observed_provider_repository_id) BETWEEN 1 AND 512 AND observed_provider_repository_id ~ '[^[:space:]]' AND octet_length(resolved_revision_scheme) BETWEEN 1 AND 512 AND resolved_revision_scheme ~ '[^[:space:]]' AND octet_length(resolved_full_revision) BETWEEN 1 AND 512 AND resolved_full_revision ~ '[^[:space:]]' AND observed_manifest_fingerprint ~ '^[0-9a-f]{64}$') IS TRUE),
  CONSTRAINT sr2_captures_v1_c2 CHECK ((isfinite(observed_at) AND isfinite(captured_at) AND isfinite(recorded_at) AND observed_at<=captured_at AND captured_at<=recorded_at) IS TRUE)
);
ALTER TABLE gov_repo.sr2_captures_v1 OWNER TO postgres;
ALTER TABLE gov_repo.sr2_captures_v1 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE gov_repo.sr2_captures_v1 FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON TABLE gov_repo.sr2_captures_v1 IS 'DERIVED_ANALYTICAL_NON_AUTHORITATIVE; immutable SR2-A1 technical analytical storage; no application capability.';

CREATE TABLE gov_repo.sr2_manifest_entries_v1 (
  organisation_id uuid NOT NULL,
  repository_id text COLLATE "C" NOT NULL,
  snapshot_id text COLLATE "C" NOT NULL,
  entry_id text COLLATE "C" NOT NULL,
  relative_path text COLLATE "C" NOT NULL,
  entry_kind text COLLATE "C" NOT NULL,
  payload_kind text COLLATE "C" NOT NULL,
  provider_object_id text COLLATE "C" NOT NULL,
  raw_sha256 text COLLATE "C" NOT NULL,
  source_fingerprint text COLLATE "C" NOT NULL,
  byte_length bigint NOT NULL,
  encoding_id text COLLATE "C" NOT NULL,
  line_count bigint NOT NULL,
  CONSTRAINT sr2_manifest_entries_v1_pkey PRIMARY KEY (organisation_id, repository_id, snapshot_id, entry_id),
  CONSTRAINT sr2_manifest_entries_v1_u1 UNIQUE (organisation_id, repository_id, snapshot_id, relative_path),
  CONSTRAINT sr2_manifest_entries_v1_u2 UNIQUE (organisation_id, repository_id, snapshot_id, entry_id, source_fingerprint, entry_kind, byte_length, encoding_id, line_count),
  CONSTRAINT sr2_manifest_entries_v1_f1 FOREIGN KEY (organisation_id, repository_id, snapshot_id) REFERENCES gov_repo.sr2_snapshots_v1 (organisation_id, repository_id, snapshot_id) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT sr2_manifest_entries_v1_c1 CHECK (((octet_length(relative_path) BETWEEN 1 AND 1024 AND relative_path ~ '[^[:space:]]' AND relative_path !~ '(^/|/$|//|(^|/)\.{1,2}(/|$)|[\\:?#[:cntrl:]])')) IS TRUE),
  CONSTRAINT sr2_manifest_entries_v1_c2 CHECK ((((entry_kind IN ('REGULAR_FILE','SYMLINK') AND payload_kind='BLOB_BYTES_V1') OR (entry_kind='SUBMODULE' AND payload_kind='SUBMODULE_OID_BYTES_V1')) AND encoding_id IN ('UTF8_STRICT_V1','NON_UTF8_BYTES_V1')) IS TRUE),
  CONSTRAINT sr2_manifest_entries_v1_c3 CHECK ((raw_sha256 ~ '^[0-9a-f]{64}$' AND source_fingerprint ~ '^[0-9a-f]{64}$' AND ((provider_object_id ~ '^[0-9a-f]{40}$' AND provider_object_id<>repeat('0',40)) OR (provider_object_id ~ '^[0-9a-f]{64}$' AND provider_object_id<>repeat('0',64))) AND source_fingerprint=pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(gov_repo.frame_identity(ARRAY['GOVIA_SR2_SOURCE_BLOB_V1',payload_kind::text,raw_sha256::text,byte_length::text]::text[]), 'UTF8')), 'hex') AND entry_id=pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(gov_repo.frame_identity(ARRAY['GOVIA_SR2_SOURCE_ENTRY_V1',organisation_id::text,repository_id::text,snapshot_id::text,relative_path::text,entry_kind::text,provider_object_id::text,source_fingerprint::text,encoding_id::text,line_count::text]::text[]), 'UTF8')), 'hex') AND (entry_kind<>'SUBMODULE' OR raw_sha256=encode(sha256(convert_to(provider_object_id,'UTF8')),'hex'))) IS TRUE),
  CONSTRAINT sr2_manifest_entries_v1_c4 CHECK ((byte_length>=0 AND line_count>=0 AND ((encoding_id='NON_UTF8_BYTES_V1' AND line_count=0) OR (encoding_id='UTF8_STRICT_V1' AND ((byte_length=0 AND line_count=0) OR (byte_length>0 AND line_count BETWEEN 1 AND byte_length)))) AND (entry_kind<>'SUBMODULE' OR (encoding_id='UTF8_STRICT_V1' AND line_count=1 AND byte_length=octet_length(provider_object_id)))) IS TRUE)
);
ALTER TABLE gov_repo.sr2_manifest_entries_v1 OWNER TO postgres;
ALTER TABLE gov_repo.sr2_manifest_entries_v1 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE gov_repo.sr2_manifest_entries_v1 FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON TABLE gov_repo.sr2_manifest_entries_v1 IS 'DERIVED_ANALYTICAL_NON_AUTHORITATIVE; immutable SR2-A1 technical analytical storage; no application capability.';

CREATE TABLE gov_repo.sr2_chunk_locators_v1 (
  organisation_id uuid NOT NULL,
  repository_id text COLLATE "C" NOT NULL,
  snapshot_id text COLLATE "C" NOT NULL,
  locator_id text COLLATE "C" NOT NULL,
  entry_id text COLLATE "C" NOT NULL,
  source_fingerprint text COLLATE "C" NOT NULL,
  entry_kind text COLLATE "C" NOT NULL,
  byte_length bigint NOT NULL,
  encoding_id text COLLATE "C" NOT NULL,
  line_count bigint NOT NULL,
  locator_class text COLLATE "C" NOT NULL,
  byte_start bigint,
  byte_end bigint,
  line_start bigint,
  line_end bigint,
  decoding_id text COLLATE "C" NOT NULL,
  chunker_id text COLLATE "C" NOT NULL,
  chunker_version text COLLATE "C" NOT NULL,
  CONSTRAINT sr2_chunk_locators_v1_pkey PRIMARY KEY (organisation_id, repository_id, snapshot_id, locator_id),
  CONSTRAINT sr2_chunk_locators_v1_u1 UNIQUE (organisation_id, repository_id, snapshot_id, locator_id, entry_id, source_fingerprint),
  CONSTRAINT sr2_chunk_locators_v1_f1 FOREIGN KEY (organisation_id, repository_id, snapshot_id, entry_id, source_fingerprint, entry_kind, byte_length, encoding_id, line_count) REFERENCES gov_repo.sr2_manifest_entries_v1 (organisation_id, repository_id, snapshot_id, entry_id, source_fingerprint, entry_kind, byte_length, encoding_id, line_count) ON UPDATE NO ACTION ON DELETE NO ACTION,
  CONSTRAINT sr2_chunk_locators_v1_c1 CHECK (((locator_class='FILE_DESCRIPTOR' AND byte_start IS NULL AND byte_end IS NULL AND line_start IS NULL AND line_end IS NULL) OR (locator_class IN ('CODE_REGION','DOCUMENTATION_REGION') AND entry_kind='REGULAR_FILE' AND encoding_id='UTF8_STRICT_V1' AND byte_length<=524288 AND byte_start IS NOT NULL AND byte_end IS NOT NULL AND line_start IS NOT NULL AND line_end IS NOT NULL AND byte_start>=0 AND byte_start<byte_end AND byte_end<=byte_length AND line_start>=1 AND line_start<=line_end AND line_end<=line_count)) IS TRUE),
  CONSTRAINT sr2_chunk_locators_v1_c2 CHECK (((locator_class='FILE_DESCRIPTOR' AND decoding_id='SOURCE_DESCRIPTOR_V1' AND chunker_id='FILE_DESCRIPTOR_V1' AND chunker_version='1') OR (locator_class IN ('CODE_REGION','DOCUMENTATION_REGION') AND decoding_id='UTF8_STRICT_V1' AND (octet_length(chunker_id) BETWEEN 1 AND 512 AND chunker_id ~ '[^[:space:]]' AND lower(btrim(chunker_id)) NOT IN ('latest','default','unknown')) AND (octet_length(chunker_version) BETWEEN 1 AND 512 AND chunker_version ~ '[^[:space:]]' AND lower(btrim(chunker_version)) NOT IN ('latest','default','unknown')))) IS TRUE),
  CONSTRAINT sr2_chunk_locators_v1_c3 CHECK ((locator_id=pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(gov_repo.frame_identity(ARRAY['GOVIA_SR2_CHUNK_LOCATOR_V1']::text[] || (ARRAY[organisation_id::text,repository_id::text,snapshot_id::text,entry_id::text,source_fingerprint::text,locator_class::text]::text[] || ARRAY[CASE WHEN byte_start IS NULL THEN '0' ELSE '1' END,coalesce(byte_start::text,'')]::text[] || ARRAY[CASE WHEN byte_end IS NULL THEN '0' ELSE '1' END,coalesce(byte_end::text,'')]::text[] || ARRAY[CASE WHEN line_start IS NULL THEN '0' ELSE '1' END,coalesce(line_start::text,'')]::text[] || ARRAY[CASE WHEN line_end IS NULL THEN '0' ELSE '1' END,coalesce(line_end::text,'')]::text[] || ARRAY[decoding_id::text,chunker_id::text,chunker_version::text]::text[])), 'UTF8')), 'hex')) IS TRUE)
);
ALTER TABLE gov_repo.sr2_chunk_locators_v1 OWNER TO postgres;
ALTER TABLE gov_repo.sr2_chunk_locators_v1 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE gov_repo.sr2_chunk_locators_v1 FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON TABLE gov_repo.sr2_chunk_locators_v1 IS 'DERIVED_ANALYTICAL_NON_AUTHORITATIVE; immutable SR2-A1 technical analytical storage; no application capability.';

CREATE TABLE gov_repo.sr2_symbol_locators_v1 (
  organisation_id uuid NOT NULL,
  repository_id text COLLATE "C" NOT NULL,
  snapshot_id text COLLATE "C" NOT NULL,
  locator_id text COLLATE "C" NOT NULL,
  entry_id text COLLATE "C" NOT NULL,
  source_fingerprint text COLLATE "C" NOT NULL,
  entry_kind text COLLATE "C" NOT NULL,
  byte_length bigint NOT NULL,
  encoding_id text COLLATE "C" NOT NULL,
  line_count bigint NOT NULL,
  language_id text COLLATE "C" NOT NULL,
  parser_id text COLLATE "C" NOT NULL,
  parser_version text COLLATE "C" NOT NULL,
  qualified_symbol_key text COLLATE "C" NOT NULL,
  byte_start bigint NOT NULL,
  byte_end bigint NOT NULL,
  line_start bigint NOT NULL,
  line_end bigint NOT NULL,
  decoding_id text COLLATE "C" NOT NULL,
  CONSTRAINT sr2_symbol_locators_v1_pkey PRIMARY KEY (organisation_id, repository_id, snapshot_id, locator_id),
  CONSTRAINT sr2_symbol_locators_v1_u1 UNIQUE (organisation_id, repository_id, snapshot_id, locator_id, entry_id, source_fingerprint),
  CONSTRAINT sr2_symbol_locators_v1_f1 FOREIGN KEY (organisation_id, repository_id, snapshot_id, entry_id, source_fingerprint, entry_kind, byte_length, encoding_id, line_count) REFERENCES gov_repo.sr2_manifest_entries_v1 (organisation_id, repository_id, snapshot_id, entry_id, source_fingerprint, entry_kind, byte_length, encoding_id, line_count) ON UPDATE NO ACTION ON DELETE NO ACTION,
  CONSTRAINT sr2_symbol_locators_v1_c1 CHECK (((octet_length(language_id) BETWEEN 1 AND 512 AND language_id ~ '[^[:space:]]' AND lower(btrim(language_id)) NOT IN ('latest','default','unknown')) AND (octet_length(parser_id) BETWEEN 1 AND 512 AND parser_id ~ '[^[:space:]]' AND lower(btrim(parser_id)) NOT IN ('latest','default','unknown')) AND (octet_length(parser_version) BETWEEN 1 AND 512 AND parser_version ~ '[^[:space:]]' AND lower(btrim(parser_version)) NOT IN ('latest','default','unknown')) AND octet_length(qualified_symbol_key) BETWEEN 1 AND 512 AND qualified_symbol_key ~ '[^[:space:]]') IS TRUE),
  CONSTRAINT sr2_symbol_locators_v1_c2 CHECK ((entry_kind='REGULAR_FILE' AND encoding_id='UTF8_STRICT_V1' AND byte_length<=524288 AND byte_start IS NOT NULL AND byte_end IS NOT NULL AND line_start IS NOT NULL AND line_end IS NOT NULL AND byte_start>=0 AND byte_start<byte_end AND byte_end<=byte_length AND line_start>=1 AND line_start<=line_end AND line_end<=line_count AND decoding_id='UTF8_STRICT_V1') IS TRUE),
  CONSTRAINT sr2_symbol_locators_v1_c3 CHECK ((locator_id=pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(gov_repo.frame_identity(ARRAY['GOVIA_SR2_SYMBOL_LOCATOR_V1',organisation_id::text,repository_id::text,snapshot_id::text,entry_id::text,source_fingerprint::text,language_id::text,parser_id::text,parser_version::text,qualified_symbol_key::text,byte_start::text,byte_end::text,line_start::text,line_end::text,decoding_id::text]::text[]), 'UTF8')), 'hex')) IS TRUE)
);
ALTER TABLE gov_repo.sr2_symbol_locators_v1 OWNER TO postgres;
ALTER TABLE gov_repo.sr2_symbol_locators_v1 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE gov_repo.sr2_symbol_locators_v1 FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON TABLE gov_repo.sr2_symbol_locators_v1 IS 'DERIVED_ANALYTICAL_NON_AUTHORITATIVE; immutable SR2-A1 technical analytical storage; no application capability.';

CREATE TABLE gov_repo.sr2_subjects_v1 (
  organisation_id uuid NOT NULL,
  repository_id text COLLATE "C" NOT NULL,
  snapshot_id text COLLATE "C" NOT NULL,
  subject_id text COLLATE "C" NOT NULL,
  subject_family text COLLATE "C" NOT NULL,
  source_fingerprint text COLLATE "C" NOT NULL,
  entry_id text COLLATE "C",
  snapshot_manifest_fingerprint text COLLATE "C",
  chunk_locator_id text COLLATE "C",
  symbol_locator_id text COLLATE "C",
  CONSTRAINT sr2_subjects_v1_pkey PRIMARY KEY (organisation_id, repository_id, snapshot_id, subject_id),
  CONSTRAINT sr2_subjects_v1_u1 UNIQUE (organisation_id, repository_id, snapshot_id, subject_id, entry_id, source_fingerprint),
  CONSTRAINT sr2_subjects_v1_u2 UNIQUE (organisation_id, repository_id, snapshot_id, subject_id, source_fingerprint),
  CONSTRAINT sr2_subjects_v1_f1 FOREIGN KEY (organisation_id, repository_id, snapshot_id, snapshot_manifest_fingerprint) REFERENCES gov_repo.sr2_snapshots_v1 (organisation_id, repository_id, snapshot_id, manifest_fingerprint) ON UPDATE NO ACTION ON DELETE NO ACTION,
  CONSTRAINT sr2_subjects_v1_f2 FOREIGN KEY (organisation_id, repository_id, snapshot_id, chunk_locator_id, entry_id, source_fingerprint) REFERENCES gov_repo.sr2_chunk_locators_v1 (organisation_id, repository_id, snapshot_id, locator_id, entry_id, source_fingerprint) ON UPDATE NO ACTION ON DELETE NO ACTION,
  CONSTRAINT sr2_subjects_v1_f3 FOREIGN KEY (organisation_id, repository_id, snapshot_id, symbol_locator_id, entry_id, source_fingerprint) REFERENCES gov_repo.sr2_symbol_locators_v1 (organisation_id, repository_id, snapshot_id, locator_id, entry_id, source_fingerprint) ON UPDATE NO ACTION ON DELETE NO ACTION,
  CONSTRAINT sr2_subjects_v1_c1 CHECK ((subject_family IN ('REPOSITORY_SNAPSHOT','CODE_SYMBOL','REPOSITORY_CHUNK')) IS TRUE),
  CONSTRAINT sr2_subjects_v1_c2 CHECK (((subject_family='REPOSITORY_SNAPSHOT' AND snapshot_manifest_fingerprint=source_fingerprint AND snapshot_manifest_fingerprint IS NOT NULL AND entry_id IS NULL AND chunk_locator_id IS NULL AND symbol_locator_id IS NULL) OR (subject_family='REPOSITORY_CHUNK' AND entry_id IS NOT NULL AND chunk_locator_id IS NOT NULL AND symbol_locator_id IS NULL AND snapshot_manifest_fingerprint IS NULL) OR (subject_family='CODE_SYMBOL' AND entry_id IS NOT NULL AND symbol_locator_id IS NOT NULL AND chunk_locator_id IS NULL AND snapshot_manifest_fingerprint IS NULL)) IS TRUE),
  CONSTRAINT sr2_subjects_v1_c3 CHECK ((subject_id=pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(gov_repo.frame_identity(ARRAY['GOVIA_SR2_SUBJECT_V1']::text[] || (ARRAY[organisation_id::text,repository_id::text,snapshot_id::text,subject_family::text,source_fingerprint::text]::text[] || ARRAY[CASE WHEN entry_id IS NULL THEN '0' ELSE '1' END,coalesce(entry_id::text,'')]::text[] || ARRAY[CASE WHEN snapshot_manifest_fingerprint IS NULL THEN '0' ELSE '1' END,coalesce(snapshot_manifest_fingerprint::text,'')]::text[] || ARRAY[CASE WHEN chunk_locator_id IS NULL THEN '0' ELSE '1' END,coalesce(chunk_locator_id::text,'')]::text[] || ARRAY[CASE WHEN symbol_locator_id IS NULL THEN '0' ELSE '1' END,coalesce(symbol_locator_id::text,'')]::text[])), 'UTF8')), 'hex')) IS TRUE)
);
ALTER TABLE gov_repo.sr2_subjects_v1 OWNER TO postgres;
ALTER TABLE gov_repo.sr2_subjects_v1 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE gov_repo.sr2_subjects_v1 FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON TABLE gov_repo.sr2_subjects_v1 IS 'DERIVED_ANALYTICAL_NON_AUTHORITATIVE; immutable SR2-A1 technical analytical storage; no application capability.';

CREATE TABLE gov_repo.sr2_source_admissions_v1 (
  organisation_id uuid NOT NULL,
  repository_id text COLLATE "C" NOT NULL,
  snapshot_id text COLLATE "C" NOT NULL,
  entry_id text COLLATE "C" NOT NULL,
  source_fingerprint text COLLATE "C" NOT NULL,
  entry_kind text COLLATE "C" NOT NULL,
  byte_length bigint NOT NULL,
  encoding_id text COLLATE "C" NOT NULL,
  line_count bigint NOT NULL,
  source_admission_id text COLLATE "C" NOT NULL,
  evaluation_id uuid NOT NULL,
  capture_id uuid NOT NULL,
  capture_observed_at timestamptz NOT NULL,
  admission_recipe_id text COLLATE "C" NOT NULL,
  admission_recipe_version text COLLATE "C" NOT NULL,
  policy_profile_id text COLLATE "C" NOT NULL,
  policy_profile_version text COLLATE "C" NOT NULL,
  outcome text COLLATE "C" NOT NULL,
  content_class text COLLATE "C",
  reason_code text COLLATE "C" NOT NULL,
  protected_eligible boolean NOT NULL,
  admission_basis_fingerprint text COLLATE "C" NOT NULL,
  evaluated_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL,
  CONSTRAINT sr2_source_admissions_v1_pkey PRIMARY KEY (organisation_id, repository_id, snapshot_id, entry_id, source_admission_id),
  CONSTRAINT sr2_source_admissions_v1_u1 UNIQUE (organisation_id, repository_id, snapshot_id, entry_id, source_admission_id, admission_basis_fingerprint, outcome),
  CONSTRAINT sr2_source_admissions_v1_u2 UNIQUE (organisation_id, repository_id, snapshot_id, entry_id, evaluation_id),
  CONSTRAINT sr2_source_admissions_v1_f1 FOREIGN KEY (organisation_id, repository_id, snapshot_id, entry_id, source_fingerprint, entry_kind, byte_length, encoding_id, line_count) REFERENCES gov_repo.sr2_manifest_entries_v1 (organisation_id, repository_id, snapshot_id, entry_id, source_fingerprint, entry_kind, byte_length, encoding_id, line_count) ON UPDATE NO ACTION ON DELETE NO ACTION,
  CONSTRAINT sr2_source_admissions_v1_f2 FOREIGN KEY (organisation_id, repository_id, snapshot_id, capture_id, capture_observed_at) REFERENCES gov_repo.sr2_captures_v1 (organisation_id, repository_id, snapshot_id, capture_id, observed_at) ON UPDATE NO ACTION ON DELETE NO ACTION,
  CONSTRAINT sr2_source_admissions_v1_c1 CHECK (((octet_length(admission_recipe_id) BETWEEN 1 AND 512 AND admission_recipe_id ~ '[^[:space:]]' AND lower(btrim(admission_recipe_id)) NOT IN ('latest','default','unknown')) AND (octet_length(admission_recipe_version) BETWEEN 1 AND 512 AND admission_recipe_version ~ '[^[:space:]]' AND lower(btrim(admission_recipe_version)) NOT IN ('latest','default','unknown')) AND (octet_length(policy_profile_id) BETWEEN 1 AND 512 AND policy_profile_id ~ '[^[:space:]]' AND lower(btrim(policy_profile_id)) NOT IN ('latest','default','unknown')) AND (octet_length(policy_profile_version) BETWEEN 1 AND 512 AND policy_profile_version ~ '[^[:space:]]' AND lower(btrim(policy_profile_version)) NOT IN ('latest','default','unknown'))) IS TRUE),
  CONSTRAINT sr2_source_admissions_v1_c2 CHECK (((outcome='PROTECTED_ELIGIBLE' AND content_class IS NOT NULL AND content_class='PROTECTED_CONTEXT_V1' AND protected_eligible AND reason_code='NONE' AND entry_kind='REGULAR_FILE' AND encoding_id='UTF8_STRICT_V1' AND byte_length<=524288) OR (outcome='METADATA_ONLY' AND content_class IS NOT NULL AND content_class='METADATA_ONLY_V1' AND NOT protected_eligible AND reason_code IN ('POLICY_WITHHELD','SECRET_SENSITIVE','UNSUPPORTED_ENCODING','BINARY','GENERATED','MINIFIED','LICENSE_RESTRICTED','EGRESS_RESTRICTED','OVERSIZED','UNQUALIFIED','SYMLINK','SUBMODULE')) OR (outcome='REJECTED' AND content_class IS NULL AND NOT protected_eligible AND reason_code IN ('POLICY_WITHHELD','SECRET_SENSITIVE','UNSUPPORTED_ENCODING','BINARY','GENERATED','MINIFIED','LICENSE_RESTRICTED','EGRESS_RESTRICTED','OVERSIZED','UNQUALIFIED','SYMLINK','SUBMODULE'))) IS TRUE),
  CONSTRAINT sr2_source_admissions_v1_c3 CHECK ((admission_basis_fingerprint=pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(gov_repo.frame_identity(ARRAY['GOVIA_SR2_ADMISSION_BASIS_V1']::text[] || (ARRAY[organisation_id::text,repository_id::text,snapshot_id::text,entry_id::text,admission_recipe_id::text,admission_recipe_version::text,policy_profile_id::text,policy_profile_version::text,outcome::text]::text[] || ARRAY[CASE WHEN content_class IS NULL THEN '0' ELSE '1' END,coalesce(content_class::text,'')]::text[] || ARRAY[reason_code,CASE WHEN protected_eligible THEN '1' ELSE '0' END])), 'UTF8')), 'hex')) IS TRUE),
  CONSTRAINT sr2_source_admissions_v1_c4 CHECK ((source_admission_id=pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(gov_repo.frame_identity(ARRAY['GOVIA_SR2_SOURCE_ADMISSION_V1',organisation_id::text,repository_id::text,snapshot_id::text,entry_id::text,evaluation_id::text,admission_basis_fingerprint::text]::text[]), 'UTF8')), 'hex')) IS TRUE),
  CONSTRAINT sr2_source_admissions_v1_c5 CHECK ((isfinite(capture_observed_at) AND isfinite(evaluated_at) AND isfinite(recorded_at) AND capture_observed_at<=evaluated_at AND evaluated_at<=recorded_at) IS TRUE)
);
ALTER TABLE gov_repo.sr2_source_admissions_v1 OWNER TO postgres;
ALTER TABLE gov_repo.sr2_source_admissions_v1 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE gov_repo.sr2_source_admissions_v1 FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON TABLE gov_repo.sr2_source_admissions_v1 IS 'DERIVED_ANALYTICAL_NON_AUTHORITATIVE; immutable SR2-A1 technical analytical storage; no application capability.';

CREATE TABLE gov_repo.sr2_source_sets_v1 (
  organisation_id uuid NOT NULL,
  repository_id text COLLATE "C" NOT NULL,
  snapshot_id text COLLATE "C" NOT NULL,
  source_set_id text COLLATE "C" NOT NULL,
  manifest_fingerprint text COLLATE "C" NOT NULL,
  scope_kind text COLLATE "C" NOT NULL,
  anchor_subject_id text COLLATE "C" NOT NULL,
  scope_key text COLLATE "C" NOT NULL,
  selector_id text COLLATE "C" NOT NULL,
  selector_version text COLLATE "C" NOT NULL,
  member_count bigint NOT NULL,
  membership_fingerprint text COLLATE "C" NOT NULL,
  coverage text COLLATE "C" NOT NULL,
  completeness text COLLATE "C" NOT NULL,
  limitations text[] NOT NULL,
  CONSTRAINT sr2_source_sets_v1_pkey PRIMARY KEY (organisation_id, repository_id, snapshot_id, source_set_id),
  CONSTRAINT sr2_source_sets_v1_u1 UNIQUE (organisation_id, repository_id, snapshot_id, source_set_id, scope_kind, anchor_subject_id),
  CONSTRAINT sr2_source_sets_v1_f1 FOREIGN KEY (organisation_id, repository_id, snapshot_id, manifest_fingerprint) REFERENCES gov_repo.sr2_snapshots_v1 (organisation_id, repository_id, snapshot_id, manifest_fingerprint) ON UPDATE NO ACTION ON DELETE NO ACTION,
  CONSTRAINT sr2_source_sets_v1_f2 FOREIGN KEY (organisation_id, repository_id, snapshot_id, anchor_subject_id) REFERENCES gov_repo.sr2_subjects_v1 (organisation_id, repository_id, snapshot_id, subject_id) ON UPDATE NO ACTION ON DELETE NO ACTION,
  CONSTRAINT sr2_source_sets_v1_c1 CHECK (((scope_kind='ITEM_GROUNDING_V1' AND selector_id='GOVIA_ITEM_SOURCE_MANIFEST_V1') OR (scope_kind='PACKAGE_MEMBERS_V1' AND selector_id='GOVIA_PACKAGE_SOURCE_MANIFEST_V1') OR (scope_kind='MODULE_MEMBERS_V1' AND selector_id='GOVIA_MODULE_SOURCE_MANIFEST_V1') OR (scope_kind='SERVICE_MEMBERS_V1' AND selector_id='GOVIA_SERVICE_SOURCE_MANIFEST_V1') OR (scope_kind='REPOSITORY_SELECTION_V1' AND selector_id='GOVIA_REPOSITORY_SOURCE_MANIFEST_V1')) IS TRUE),
  CONSTRAINT sr2_source_sets_v1_c2 CHECK ((member_count BETWEEN 1 AND 20 AND membership_fingerprint ~ '^[0-9a-f]{64}$' AND completeness='COMPLETE_DECLARED_SET_V1' AND coverage IN ('DECLARED_SET_ONLY','ENTIRE_SNAPSHOT_MANIFEST')) IS TRUE),
  CONSTRAINT sr2_source_sets_v1_c3 CHECK ((source_set_id=pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(gov_repo.frame_identity(ARRAY['GOVIA_SR2_SOURCE_SET_V1']::text[] || (ARRAY[organisation_id::text,repository_id::text,snapshot_id::text,manifest_fingerprint::text,scope_kind::text,anchor_subject_id::text,scope_key::text,selector_id::text,selector_version::text,member_count::text,membership_fingerprint::text,coverage::text,completeness::text]::text[] || ARRAY[cardinality(limitations)::text] || limitations)), 'UTF8')), 'hex')) IS TRUE),
  CONSTRAINT sr2_source_sets_v1_c4 CHECK ((octet_length(scope_key) BETWEEN 1 AND 512 AND scope_key ~ '[^[:space:]]' AND (octet_length(selector_version) BETWEEN 1 AND 512 AND selector_version ~ '[^[:space:]]' AND lower(btrim(selector_version)) NOT IN ('latest','default','unknown')) AND gov_repo.sr2_list_valid_v1(limitations,20)) IS TRUE)
);
ALTER TABLE gov_repo.sr2_source_sets_v1 OWNER TO postgres;
ALTER TABLE gov_repo.sr2_source_sets_v1 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE gov_repo.sr2_source_sets_v1 FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON TABLE gov_repo.sr2_source_sets_v1 IS 'DERIVED_ANALYTICAL_NON_AUTHORITATIVE; immutable SR2-A1 technical analytical storage; no application capability.';

CREATE TABLE gov_repo.sr2_source_set_members_v1 (
  organisation_id uuid NOT NULL,
  repository_id text COLLATE "C" NOT NULL,
  snapshot_id text COLLATE "C" NOT NULL,
  source_set_id text COLLATE "C" NOT NULL,
  source_subject_id text COLLATE "C" NOT NULL,
  entry_id text COLLATE "C" NOT NULL,
  source_fingerprint text COLLATE "C" NOT NULL,
  CONSTRAINT sr2_source_set_members_v1_pkey PRIMARY KEY (organisation_id, repository_id, snapshot_id, source_set_id, source_subject_id),
  CONSTRAINT sr2_source_set_members_v1_f1 FOREIGN KEY (organisation_id, repository_id, snapshot_id, source_set_id) REFERENCES gov_repo.sr2_source_sets_v1 (organisation_id, repository_id, snapshot_id, source_set_id) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT sr2_source_set_members_v1_f2 FOREIGN KEY (organisation_id, repository_id, snapshot_id, source_subject_id, entry_id, source_fingerprint) REFERENCES gov_repo.sr2_subjects_v1 (organisation_id, repository_id, snapshot_id, subject_id, entry_id, source_fingerprint) ON UPDATE NO ACTION ON DELETE NO ACTION
);
ALTER TABLE gov_repo.sr2_source_set_members_v1 OWNER TO postgres;
ALTER TABLE gov_repo.sr2_source_set_members_v1 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE gov_repo.sr2_source_set_members_v1 FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON TABLE gov_repo.sr2_source_set_members_v1 IS 'DERIVED_ANALYTICAL_NON_AUTHORITATIVE; immutable SR2-A1 technical analytical storage; no application capability.';

CREATE TABLE gov_repo.sr2_projections_v1 (
  organisation_id uuid NOT NULL,
  repository_id text COLLATE "C" NOT NULL,
  snapshot_id text COLLATE "C" NOT NULL,
  subject_id text COLLATE "C" NOT NULL,
  projection_id text COLLATE "C" NOT NULL,
  source_fingerprint text COLLATE "C" NOT NULL,
  primary_source_set_id text COLLATE "C" NOT NULL,
  projection_schema_version text COLLATE "C" NOT NULL,
  document_recipe text COLLATE "C" NOT NULL,
  record_contract text COLLATE "C" NOT NULL,
  extraction_recipe_id text COLLATE "C" NOT NULL,
  extraction_recipe_version text COLLATE "C" NOT NULL,
  handling_recipe_id text COLLATE "C" NOT NULL,
  handling_recipe_version text COLLATE "C" NOT NULL,
  content_class text COLLATE "C" NOT NULL,
  safe_label text COLLATE "C" NOT NULL,
  safe_description text COLLATE "C" NOT NULL,
  admission_basis_set_fingerprint text COLLATE "C" NOT NULL,
  admission_record_set_fingerprint text COLLATE "C" NOT NULL,
  projection_fingerprint text COLLATE "C" NOT NULL,
  admitted_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL,
  authority text COLLATE "C" NOT NULL,
  derivation text COLLATE "C" NOT NULL,
  canonical_decision boolean NOT NULL,
  governed_relationships boolean NOT NULL,
  assurance boolean NOT NULL,
  CONSTRAINT sr2_projections_v1_pkey PRIMARY KEY (organisation_id, repository_id, snapshot_id, subject_id, projection_id),
  CONSTRAINT sr2_projections_v1_u1 UNIQUE (organisation_id, repository_id, snapshot_id, subject_id, projection_id, content_class),
  CONSTRAINT sr2_projections_v1_u2 UNIQUE (organisation_id, repository_id, snapshot_id, subject_id, projection_id, projection_schema_version, projection_fingerprint, content_class, admitted_at),
  CONSTRAINT sr2_projections_v1_f1 FOREIGN KEY (organisation_id, repository_id, snapshot_id, subject_id, source_fingerprint) REFERENCES gov_repo.sr2_subjects_v1 (organisation_id, repository_id, snapshot_id, subject_id, source_fingerprint) ON UPDATE NO ACTION ON DELETE NO ACTION,
  CONSTRAINT sr2_projections_v1_f2 FOREIGN KEY (organisation_id, repository_id, snapshot_id, primary_source_set_id) REFERENCES gov_repo.sr2_source_sets_v1 (organisation_id, repository_id, snapshot_id, source_set_id) ON UPDATE NO ACTION ON DELETE NO ACTION,
  CONSTRAINT sr2_projections_v1_c1 CHECK (((octet_length(projection_schema_version) BETWEEN 1 AND 512 AND projection_schema_version ~ '[^[:space:]]' AND lower(btrim(projection_schema_version)) NOT IN ('latest','default','unknown')) AND (octet_length(extraction_recipe_id) BETWEEN 1 AND 512 AND extraction_recipe_id ~ '[^[:space:]]' AND lower(btrim(extraction_recipe_id)) NOT IN ('latest','default','unknown')) AND (octet_length(extraction_recipe_version) BETWEEN 1 AND 512 AND extraction_recipe_version ~ '[^[:space:]]' AND lower(btrim(extraction_recipe_version)) NOT IN ('latest','default','unknown')) AND document_recipe='GOVIA_TECHNICAL_CONTEXT_V1' AND record_contract='GOVIA_SR2_TYPED_PROJECTION_RECORD_V1') IS TRUE),
  CONSTRAINT sr2_projections_v1_c2 CHECK ((content_class IN ('METADATA_ONLY_V1','PROTECTED_CONTEXT_V1') AND (octet_length(handling_recipe_id) BETWEEN 1 AND 512 AND handling_recipe_id ~ '[^[:space:]]' AND lower(btrim(handling_recipe_id)) NOT IN ('latest','default','unknown')) AND (octet_length(handling_recipe_version) BETWEEN 1 AND 512 AND handling_recipe_version ~ '[^[:space:]]' AND lower(btrim(handling_recipe_version)) NOT IN ('latest','default','unknown'))) IS TRUE),
  CONSTRAINT sr2_projections_v1_c3 CHECK ((octet_length(safe_label) BETWEEN 1 AND 512 AND safe_label ~ '[^[:space:]]' AND octet_length(safe_description) BETWEEN 1 AND 1024 AND safe_description ~ '[^[:space:]]') IS TRUE),
  CONSTRAINT sr2_projections_v1_c4 CHECK ((source_fingerprint ~ '^[0-9a-f]{64}$' AND admission_basis_set_fingerprint ~ '^[0-9a-f]{64}$' AND admission_record_set_fingerprint ~ '^[0-9a-f]{64}$' AND projection_fingerprint ~ '^[0-9a-f]{64}$' AND source_fingerprint<>projection_fingerprint) IS TRUE),
  CONSTRAINT sr2_projections_v1_c5 CHECK ((isfinite(admitted_at) AND isfinite(recorded_at) AND admitted_at<=recorded_at) IS TRUE),
  CONSTRAINT sr2_projections_v1_c6 CHECK ((projection_id=pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(gov_repo.frame_identity(ARRAY['GOVIA_SR2_PROJECTION_V1',organisation_id::text,repository_id::text,snapshot_id::text,subject_id::text,projection_schema_version::text,projection_fingerprint::text]::text[]), 'UTF8')), 'hex')) IS TRUE),
  CONSTRAINT sr2_projections_v1_c7 CHECK ((authority='DERIVED_ANALYTICAL_NON_AUTHORITATIVE' AND derivation='SEMANTIC_MATCH' AND NOT canonical_decision AND NOT governed_relationships AND NOT assurance) IS TRUE)
);
ALTER TABLE gov_repo.sr2_projections_v1 OWNER TO postgres;
ALTER TABLE gov_repo.sr2_projections_v1 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE gov_repo.sr2_projections_v1 FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON TABLE gov_repo.sr2_projections_v1 IS 'DERIVED_ANALYTICAL_NON_AUTHORITATIVE; immutable SR2-A1 technical analytical storage; no application capability.';

CREATE TABLE gov_repo.sr2_protected_projections_v1 (
  organisation_id uuid NOT NULL,
  repository_id text COLLATE "C" NOT NULL,
  snapshot_id text COLLATE "C" NOT NULL,
  subject_id text COLLATE "C" NOT NULL,
  projection_id text COLLATE "C" NOT NULL,
  content_class text COLLATE "C" NOT NULL,
  structural_summary text COLLATE "C" NOT NULL,
  literal_handling text COLLATE "C" NOT NULL,
  projection_mark text COLLATE "C" NOT NULL,
  untrusted_source boolean NOT NULL,
  CONSTRAINT sr2_protected_projections_v1_pkey PRIMARY KEY (organisation_id, repository_id, snapshot_id, subject_id, projection_id),
  CONSTRAINT sr2_protected_projections_v1_f1 FOREIGN KEY (organisation_id, repository_id, snapshot_id, subject_id, projection_id, content_class) REFERENCES gov_repo.sr2_projections_v1 (organisation_id, repository_id, snapshot_id, subject_id, projection_id, content_class) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT sr2_protected_projections_v1_c1 CHECK ((content_class='PROTECTED_CONTEXT_V1' AND literal_handling='REMOVED_OR_TYPED_V1' AND projection_mark='CONTENT_PROJECTED' AND untrusted_source) IS TRUE),
  CONSTRAINT sr2_protected_projections_v1_c2 CHECK ((octet_length(structural_summary) BETWEEN 1 AND 1024 AND structural_summary ~ '[^[:space:]]') IS TRUE)
);
ALTER TABLE gov_repo.sr2_protected_projections_v1 OWNER TO postgres;
ALTER TABLE gov_repo.sr2_protected_projections_v1 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE gov_repo.sr2_protected_projections_v1 FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON TABLE gov_repo.sr2_protected_projections_v1 IS 'DERIVED_ANALYTICAL_NON_AUTHORITATIVE; immutable SR2-A1 technical analytical storage; no application capability.';

CREATE TABLE gov_repo.sr2_projection_sources_v1 (
  organisation_id uuid NOT NULL,
  repository_id text COLLATE "C" NOT NULL,
  snapshot_id text COLLATE "C" NOT NULL,
  subject_id text COLLATE "C" NOT NULL,
  projection_id text COLLATE "C" NOT NULL,
  entry_id text COLLATE "C" NOT NULL,
  content_class text COLLATE "C" NOT NULL,
  source_admission_id text COLLATE "C" NOT NULL,
  admission_basis_fingerprint text COLLATE "C" NOT NULL,
  outcome text COLLATE "C" NOT NULL,
  CONSTRAINT sr2_projection_sources_v1_pkey PRIMARY KEY (organisation_id, repository_id, snapshot_id, subject_id, projection_id, entry_id),
  CONSTRAINT sr2_projection_sources_v1_f1 FOREIGN KEY (organisation_id, repository_id, snapshot_id, subject_id, projection_id, content_class) REFERENCES gov_repo.sr2_projections_v1 (organisation_id, repository_id, snapshot_id, subject_id, projection_id, content_class) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT sr2_projection_sources_v1_f2 FOREIGN KEY (organisation_id, repository_id, snapshot_id, entry_id, source_admission_id, admission_basis_fingerprint, outcome) REFERENCES gov_repo.sr2_source_admissions_v1 (organisation_id, repository_id, snapshot_id, entry_id, source_admission_id, admission_basis_fingerprint, outcome) ON UPDATE NO ACTION ON DELETE NO ACTION,
  CONSTRAINT sr2_projection_sources_v1_c1 CHECK (((content_class='METADATA_ONLY_V1' AND outcome IN ('METADATA_ONLY','PROTECTED_ELIGIBLE')) OR (content_class='PROTECTED_CONTEXT_V1' AND outcome='PROTECTED_ELIGIBLE')) IS TRUE)
);
ALTER TABLE gov_repo.sr2_projection_sources_v1 OWNER TO postgres;
ALTER TABLE gov_repo.sr2_projection_sources_v1 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE gov_repo.sr2_projection_sources_v1 FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON TABLE gov_repo.sr2_projection_sources_v1 IS 'DERIVED_ANALYTICAL_NON_AUTHORITATIVE; immutable SR2-A1 technical analytical storage; no application capability.';

CREATE TABLE gov_repo.sr2_facet_collections_v1 (
  organisation_id uuid NOT NULL,
  repository_id text COLLATE "C" NOT NULL,
  snapshot_id text COLLATE "C" NOT NULL,
  subject_id text COLLATE "C" NOT NULL,
  projection_id text COLLATE "C" NOT NULL,
  facet_kind text COLLATE "C" NOT NULL,
  expected_item_count bigint NOT NULL,
  collection_fingerprint text COLLATE "C" NOT NULL,
  CONSTRAINT sr2_facet_collections_v1_pkey PRIMARY KEY (organisation_id, repository_id, snapshot_id, subject_id, projection_id, facet_kind),
  CONSTRAINT sr2_facet_collections_v1_f1 FOREIGN KEY (organisation_id, repository_id, snapshot_id, subject_id, projection_id) REFERENCES gov_repo.sr2_protected_projections_v1 (organisation_id, repository_id, snapshot_id, subject_id, projection_id) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT sr2_facet_collections_v1_c1 CHECK ((facet_kind IN ('MODULE_DESCRIPTOR','SERVICE_DESCRIPTOR','DEPENDENCY_DESCRIPTOR','CONFIGURATION_DESCRIPTOR','TECHNICAL_SUMMARY','DOMAIN_OBSERVATION','AGENT_DESCRIPTOR','ENTRYPOINT_DESCRIPTOR') AND ((facet_kind='TECHNICAL_SUMMARY' AND expected_item_count=1) OR (facet_kind<>'TECHNICAL_SUMMARY' AND expected_item_count BETWEEN 0 AND 20))) IS TRUE),
  CONSTRAINT sr2_facet_collections_v1_c2 CHECK ((collection_fingerprint ~ '^[0-9a-f]{64}$') IS TRUE)
);
ALTER TABLE gov_repo.sr2_facet_collections_v1 OWNER TO postgres;
ALTER TABLE gov_repo.sr2_facet_collections_v1 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE gov_repo.sr2_facet_collections_v1 FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON TABLE gov_repo.sr2_facet_collections_v1 IS 'DERIVED_ANALYTICAL_NON_AUTHORITATIVE; immutable SR2-A1 technical analytical storage; no application capability.';

CREATE TABLE gov_repo.sr2_module_facets_v1 (
  organisation_id uuid NOT NULL,
  repository_id text COLLATE "C" NOT NULL,
  snapshot_id text COLLATE "C" NOT NULL,
  subject_id text COLLATE "C" NOT NULL,
  projection_id text COLLATE "C" NOT NULL,
  item_key text COLLATE "C" NOT NULL,
  facet_kind text COLLATE "C" NOT NULL,
  grounding_set_id text COLLATE "C" NOT NULL,
  scope_kind text COLLATE "C" NOT NULL,
  anchor_subject_id text COLLATE "C" NOT NULL,
  method_code text COLLATE "C" NOT NULL,
  method_version text COLLATE "C" NOT NULL,
  limitations text[] NOT NULL,
  payload_fingerprint text COLLATE "C" NOT NULL,
  module_key text COLLATE "C" NOT NULL,
  module_kind text COLLATE "C" NOT NULL,
  directory_label text COLLATE "C" NOT NULL,
  module_name text COLLATE "C" NOT NULL,
  CONSTRAINT sr2_module_facets_v1_pkey PRIMARY KEY (organisation_id, repository_id, snapshot_id, subject_id, projection_id, item_key),
  CONSTRAINT sr2_module_facets_v1_f1 FOREIGN KEY (organisation_id, repository_id, snapshot_id, subject_id, projection_id, facet_kind) REFERENCES gov_repo.sr2_facet_collections_v1 (organisation_id, repository_id, snapshot_id, subject_id, projection_id, facet_kind) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT sr2_module_facets_v1_f2 FOREIGN KEY (organisation_id, repository_id, snapshot_id, grounding_set_id, scope_kind, anchor_subject_id) REFERENCES gov_repo.sr2_source_sets_v1 (organisation_id, repository_id, snapshot_id, source_set_id, scope_kind, anchor_subject_id) ON UPDATE NO ACTION ON DELETE NO ACTION,
  CONSTRAINT sr2_module_facets_v1_c1 CHECK ((facet_kind='MODULE_DESCRIPTOR' AND method_code IN ('PARSED','MANIFEST_OBSERVED','FILENAME_HEURISTIC') AND (octet_length(method_version) BETWEEN 1 AND 512 AND method_version ~ '[^[:space:]]' AND lower(btrim(method_version)) NOT IN ('latest','default','unknown')) AND gov_repo.sr2_list_valid_v1(limitations,20) AND scope_kind='ITEM_GROUNDING_V1') IS TRUE),
  CONSTRAINT sr2_module_facets_v1_c2 CHECK ((octet_length(module_key) BETWEEN 1 AND 512 AND module_key ~ '[^[:space:]]' AND module_kind IN ('PACKAGE','DIRECTORY','NAMESPACE') AND (directory_label='.' OR (octet_length(directory_label) BETWEEN 1 AND 1024 AND directory_label ~ '[^[:space:]]' AND directory_label !~ '(^/|/$|//|(^|/)\.{1,2}(/|$)|[\\:?#[:cntrl:]])')) AND octet_length(module_name) BETWEEN 1 AND 512 AND module_name ~ '[^[:space:]]') IS TRUE),
  CONSTRAINT sr2_module_facets_v1_c3 CHECK ((item_key=pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(gov_repo.frame_identity(ARRAY['GOVIA_SR2_FACET_ITEM_V1',organisation_id::text,repository_id::text,snapshot_id::text,subject_id::text,facet_kind::text,anchor_subject_id::text,module_kind::text,module_key::text]::text[]), 'UTF8')), 'hex') AND payload_fingerprint=pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(gov_repo.frame_identity(ARRAY['GOVIA_SR2_FACET_PAYLOAD_V1']::text[] || (ARRAY[facet_kind::text,item_key::text,grounding_set_id::text,scope_kind::text,anchor_subject_id::text,method_code::text,method_version::text]::text[] || ARRAY[cardinality(limitations)::text] || limitations || ARRAY[module_key::text]::text[] || ARRAY[module_kind::text]::text[] || ARRAY[directory_label::text]::text[] || ARRAY[module_name::text]::text[])), 'UTF8')), 'hex')) IS TRUE)
);
ALTER TABLE gov_repo.sr2_module_facets_v1 OWNER TO postgres;
ALTER TABLE gov_repo.sr2_module_facets_v1 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE gov_repo.sr2_module_facets_v1 FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON TABLE gov_repo.sr2_module_facets_v1 IS 'DERIVED_ANALYTICAL_NON_AUTHORITATIVE; immutable SR2-A1 technical analytical storage; no application capability.';

CREATE TABLE gov_repo.sr2_service_facets_v1 (
  organisation_id uuid NOT NULL,
  repository_id text COLLATE "C" NOT NULL,
  snapshot_id text COLLATE "C" NOT NULL,
  subject_id text COLLATE "C" NOT NULL,
  projection_id text COLLATE "C" NOT NULL,
  item_key text COLLATE "C" NOT NULL,
  facet_kind text COLLATE "C" NOT NULL,
  grounding_set_id text COLLATE "C" NOT NULL,
  scope_kind text COLLATE "C" NOT NULL,
  anchor_subject_id text COLLATE "C" NOT NULL,
  method_code text COLLATE "C" NOT NULL,
  method_version text COLLATE "C" NOT NULL,
  limitations text[] NOT NULL,
  payload_fingerprint text COLLATE "C" NOT NULL,
  service_key text COLLATE "C" NOT NULL,
  service_name text COLLATE "C" NOT NULL,
  service_kind text COLLATE "C" NOT NULL,
  capabilities text[] NOT NULL,
  CONSTRAINT sr2_service_facets_v1_pkey PRIMARY KEY (organisation_id, repository_id, snapshot_id, subject_id, projection_id, item_key),
  CONSTRAINT sr2_service_facets_v1_f1 FOREIGN KEY (organisation_id, repository_id, snapshot_id, subject_id, projection_id, facet_kind) REFERENCES gov_repo.sr2_facet_collections_v1 (organisation_id, repository_id, snapshot_id, subject_id, projection_id, facet_kind) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT sr2_service_facets_v1_f2 FOREIGN KEY (organisation_id, repository_id, snapshot_id, grounding_set_id, scope_kind, anchor_subject_id) REFERENCES gov_repo.sr2_source_sets_v1 (organisation_id, repository_id, snapshot_id, source_set_id, scope_kind, anchor_subject_id) ON UPDATE NO ACTION ON DELETE NO ACTION,
  CONSTRAINT sr2_service_facets_v1_c1 CHECK ((facet_kind='SERVICE_DESCRIPTOR' AND method_code IN ('PARSED','MANIFEST_OBSERVED','FILENAME_HEURISTIC') AND (octet_length(method_version) BETWEEN 1 AND 512 AND method_version ~ '[^[:space:]]' AND lower(btrim(method_version)) NOT IN ('latest','default','unknown')) AND gov_repo.sr2_list_valid_v1(limitations,20) AND scope_kind='ITEM_GROUNDING_V1') IS TRUE),
  CONSTRAINT sr2_service_facets_v1_c2 CHECK ((octet_length(service_key) BETWEEN 1 AND 512 AND service_key ~ '[^[:space:]]' AND octet_length(service_name) BETWEEN 1 AND 512 AND service_name ~ '[^[:space:]]' AND service_kind IN ('LIBRARY','APPLICATION','WORKER','API') AND gov_repo.sr2_list_valid_v1(capabilities,20)) IS TRUE),
  CONSTRAINT sr2_service_facets_v1_c3 CHECK ((item_key=pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(gov_repo.frame_identity(ARRAY['GOVIA_SR2_FACET_ITEM_V1',organisation_id::text,repository_id::text,snapshot_id::text,subject_id::text,facet_kind::text,anchor_subject_id::text,service_kind::text,service_key::text]::text[]), 'UTF8')), 'hex') AND payload_fingerprint=pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(gov_repo.frame_identity(ARRAY['GOVIA_SR2_FACET_PAYLOAD_V1']::text[] || (ARRAY[facet_kind::text,item_key::text,grounding_set_id::text,scope_kind::text,anchor_subject_id::text,method_code::text,method_version::text]::text[] || ARRAY[cardinality(limitations)::text] || limitations || ARRAY[service_key::text]::text[] || ARRAY[service_name::text]::text[] || ARRAY[service_kind::text]::text[] || ARRAY[cardinality(capabilities)::text] || capabilities)), 'UTF8')), 'hex')) IS TRUE)
);
ALTER TABLE gov_repo.sr2_service_facets_v1 OWNER TO postgres;
ALTER TABLE gov_repo.sr2_service_facets_v1 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE gov_repo.sr2_service_facets_v1 FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON TABLE gov_repo.sr2_service_facets_v1 IS 'DERIVED_ANALYTICAL_NON_AUTHORITATIVE; immutable SR2-A1 technical analytical storage; no application capability.';

CREATE TABLE gov_repo.sr2_dependency_facets_v1 (
  organisation_id uuid NOT NULL,
  repository_id text COLLATE "C" NOT NULL,
  snapshot_id text COLLATE "C" NOT NULL,
  subject_id text COLLATE "C" NOT NULL,
  projection_id text COLLATE "C" NOT NULL,
  item_key text COLLATE "C" NOT NULL,
  facet_kind text COLLATE "C" NOT NULL,
  grounding_set_id text COLLATE "C" NOT NULL,
  scope_kind text COLLATE "C" NOT NULL,
  anchor_subject_id text COLLATE "C" NOT NULL,
  method_code text COLLATE "C" NOT NULL,
  method_version text COLLATE "C" NOT NULL,
  limitations text[] NOT NULL,
  payload_fingerprint text COLLATE "C" NOT NULL,
  ecosystem text COLLATE "C" NOT NULL,
  dependency_name text COLLATE "C" NOT NULL,
  resolution_key text COLLATE "C" NOT NULL,
  dependency_role text COLLATE "C" NOT NULL,
  observed_specification text COLLATE "C",
  resolved_version text COLLATE "C",
  CONSTRAINT sr2_dependency_facets_v1_pkey PRIMARY KEY (organisation_id, repository_id, snapshot_id, subject_id, projection_id, item_key),
  CONSTRAINT sr2_dependency_facets_v1_f1 FOREIGN KEY (organisation_id, repository_id, snapshot_id, subject_id, projection_id, facet_kind) REFERENCES gov_repo.sr2_facet_collections_v1 (organisation_id, repository_id, snapshot_id, subject_id, projection_id, facet_kind) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT sr2_dependency_facets_v1_f2 FOREIGN KEY (organisation_id, repository_id, snapshot_id, grounding_set_id, scope_kind, anchor_subject_id) REFERENCES gov_repo.sr2_source_sets_v1 (organisation_id, repository_id, snapshot_id, source_set_id, scope_kind, anchor_subject_id) ON UPDATE NO ACTION ON DELETE NO ACTION,
  CONSTRAINT sr2_dependency_facets_v1_c1 CHECK ((facet_kind='DEPENDENCY_DESCRIPTOR' AND method_code IN ('MANIFEST_OBSERVED','LOCKFILE_OBSERVED','FILENAME_HEURISTIC') AND (octet_length(method_version) BETWEEN 1 AND 512 AND method_version ~ '[^[:space:]]' AND lower(btrim(method_version)) NOT IN ('latest','default','unknown')) AND gov_repo.sr2_list_valid_v1(limitations,20) AND scope_kind='ITEM_GROUNDING_V1') IS TRUE),
  CONSTRAINT sr2_dependency_facets_v1_c2 CHECK ((ecosystem IN ('NPM','PYPI','MAVEN','NUGET','CARGO','GO','UNAVAILABLE') AND octet_length(dependency_name) BETWEEN 1 AND 512 AND dependency_name ~ '[^[:space:]]' AND octet_length(resolution_key) BETWEEN 1 AND 512 AND resolution_key ~ '[^[:space:]]' AND dependency_role IN ('RUNTIME','DEVELOPMENT','PEER','OPTIONAL','BUILD') AND (observed_specification IS NULL OR (octet_length(observed_specification) BETWEEN 1 AND 512 AND observed_specification ~ '[^[:space:]]')) AND (resolved_version IS NULL OR (octet_length(resolved_version) BETWEEN 1 AND 512 AND resolved_version ~ '[^[:space:]]')) AND ((method_code='MANIFEST_OBSERVED' AND observed_specification IS NOT NULL AND resolved_version IS NULL AND ecosystem<>'UNAVAILABLE') OR (method_code='LOCKFILE_OBSERVED' AND resolved_version IS NOT NULL AND ecosystem<>'UNAVAILABLE') OR (method_code='FILENAME_HEURISTIC' AND observed_specification IS NULL AND resolved_version IS NULL AND resolution_key='UNRESOLVED'))) IS TRUE),
  CONSTRAINT sr2_dependency_facets_v1_c3 CHECK ((item_key=pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(gov_repo.frame_identity(ARRAY['GOVIA_SR2_FACET_ITEM_V1',organisation_id::text,repository_id::text,snapshot_id::text,subject_id::text,facet_kind::text,anchor_subject_id::text,ecosystem::text,dependency_name::text,dependency_role::text,resolution_key::text]::text[]), 'UTF8')), 'hex') AND payload_fingerprint=pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(gov_repo.frame_identity(ARRAY['GOVIA_SR2_FACET_PAYLOAD_V1']::text[] || (ARRAY[facet_kind::text,item_key::text,grounding_set_id::text,scope_kind::text,anchor_subject_id::text,method_code::text,method_version::text]::text[] || ARRAY[cardinality(limitations)::text] || limitations || ARRAY[ecosystem::text]::text[] || ARRAY[dependency_name::text]::text[] || ARRAY[resolution_key::text]::text[] || ARRAY[dependency_role::text]::text[] || ARRAY[CASE WHEN observed_specification IS NULL THEN '0' ELSE '1' END,coalesce(observed_specification::text,'')]::text[] || ARRAY[CASE WHEN resolved_version IS NULL THEN '0' ELSE '1' END,coalesce(resolved_version::text,'')]::text[])), 'UTF8')), 'hex')) IS TRUE)
);
ALTER TABLE gov_repo.sr2_dependency_facets_v1 OWNER TO postgres;
ALTER TABLE gov_repo.sr2_dependency_facets_v1 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE gov_repo.sr2_dependency_facets_v1 FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON TABLE gov_repo.sr2_dependency_facets_v1 IS 'DERIVED_ANALYTICAL_NON_AUTHORITATIVE; immutable SR2-A1 technical analytical storage; no application capability.';

CREATE TABLE gov_repo.sr2_configuration_facets_v1 (
  organisation_id uuid NOT NULL,
  repository_id text COLLATE "C" NOT NULL,
  snapshot_id text COLLATE "C" NOT NULL,
  subject_id text COLLATE "C" NOT NULL,
  projection_id text COLLATE "C" NOT NULL,
  item_key text COLLATE "C" NOT NULL,
  facet_kind text COLLATE "C" NOT NULL,
  grounding_set_id text COLLATE "C" NOT NULL,
  scope_kind text COLLATE "C" NOT NULL,
  anchor_subject_id text COLLATE "C" NOT NULL,
  method_code text COLLATE "C" NOT NULL,
  method_version text COLLATE "C" NOT NULL,
  limitations text[] NOT NULL,
  payload_fingerprint text COLLATE "C" NOT NULL,
  configuration_key text COLLATE "C" NOT NULL,
  value_type text COLLATE "C" NOT NULL,
  safe_value_code text COLLATE "C" NOT NULL,
  CONSTRAINT sr2_configuration_facets_v1_pkey PRIMARY KEY (organisation_id, repository_id, snapshot_id, subject_id, projection_id, item_key),
  CONSTRAINT sr2_configuration_facets_v1_f1 FOREIGN KEY (organisation_id, repository_id, snapshot_id, subject_id, projection_id, facet_kind) REFERENCES gov_repo.sr2_facet_collections_v1 (organisation_id, repository_id, snapshot_id, subject_id, projection_id, facet_kind) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT sr2_configuration_facets_v1_f2 FOREIGN KEY (organisation_id, repository_id, snapshot_id, grounding_set_id, scope_kind, anchor_subject_id) REFERENCES gov_repo.sr2_source_sets_v1 (organisation_id, repository_id, snapshot_id, source_set_id, scope_kind, anchor_subject_id) ON UPDATE NO ACTION ON DELETE NO ACTION,
  CONSTRAINT sr2_configuration_facets_v1_c1 CHECK ((facet_kind='CONFIGURATION_DESCRIPTOR' AND method_code IN ('PARSED','MANIFEST_OBSERVED') AND (octet_length(method_version) BETWEEN 1 AND 512 AND method_version ~ '[^[:space:]]' AND lower(btrim(method_version)) NOT IN ('latest','default','unknown')) AND gov_repo.sr2_list_valid_v1(limitations,20) AND scope_kind='ITEM_GROUNDING_V1') IS TRUE),
  CONSTRAINT sr2_configuration_facets_v1_c2 CHECK ((octet_length(configuration_key) BETWEEN 1 AND 512 AND configuration_key ~ '[^[:space:]]' AND value_type IN ('BOOLEAN','INTEGER','DECIMAL','STRING','LIST','MAP','NULL') AND safe_value_code IN ('ENABLED','DISABLED','REQUIRED','OPTIONAL','UNSPECIFIED')) IS TRUE),
  CONSTRAINT sr2_configuration_facets_v1_c3 CHECK ((item_key=pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(gov_repo.frame_identity(ARRAY['GOVIA_SR2_FACET_ITEM_V1',organisation_id::text,repository_id::text,snapshot_id::text,subject_id::text,facet_kind::text,anchor_subject_id::text,configuration_key::text]::text[]), 'UTF8')), 'hex') AND payload_fingerprint=pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(gov_repo.frame_identity(ARRAY['GOVIA_SR2_FACET_PAYLOAD_V1']::text[] || (ARRAY[facet_kind::text,item_key::text,grounding_set_id::text,scope_kind::text,anchor_subject_id::text,method_code::text,method_version::text]::text[] || ARRAY[cardinality(limitations)::text] || limitations || ARRAY[configuration_key::text]::text[] || ARRAY[value_type::text]::text[] || ARRAY[safe_value_code::text]::text[])), 'UTF8')), 'hex')) IS TRUE)
);
ALTER TABLE gov_repo.sr2_configuration_facets_v1 OWNER TO postgres;
ALTER TABLE gov_repo.sr2_configuration_facets_v1 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE gov_repo.sr2_configuration_facets_v1 FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON TABLE gov_repo.sr2_configuration_facets_v1 IS 'DERIVED_ANALYTICAL_NON_AUTHORITATIVE; immutable SR2-A1 technical analytical storage; no application capability.';

CREATE TABLE gov_repo.sr2_summary_facets_v1 (
  organisation_id uuid NOT NULL,
  repository_id text COLLATE "C" NOT NULL,
  snapshot_id text COLLATE "C" NOT NULL,
  subject_id text COLLATE "C" NOT NULL,
  projection_id text COLLATE "C" NOT NULL,
  item_key text COLLATE "C" NOT NULL,
  facet_kind text COLLATE "C" NOT NULL,
  grounding_set_id text COLLATE "C" NOT NULL,
  scope_kind text COLLATE "C" NOT NULL,
  anchor_subject_id text COLLATE "C" NOT NULL,
  method_code text COLLATE "C" NOT NULL,
  method_version text COLLATE "C" NOT NULL,
  limitations text[] NOT NULL,
  payload_fingerprint text COLLATE "C" NOT NULL,
  summary_text text COLLATE "C" NOT NULL,
  coverage text COLLATE "C" NOT NULL,
  CONSTRAINT sr2_summary_facets_v1_pkey PRIMARY KEY (organisation_id, repository_id, snapshot_id, subject_id, projection_id),
  CONSTRAINT sr2_summary_facets_v1_f1 FOREIGN KEY (organisation_id, repository_id, snapshot_id, subject_id, projection_id, facet_kind) REFERENCES gov_repo.sr2_facet_collections_v1 (organisation_id, repository_id, snapshot_id, subject_id, projection_id, facet_kind) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT sr2_summary_facets_v1_f2 FOREIGN KEY (organisation_id, repository_id, snapshot_id, grounding_set_id, scope_kind, anchor_subject_id) REFERENCES gov_repo.sr2_source_sets_v1 (organisation_id, repository_id, snapshot_id, source_set_id, scope_kind, anchor_subject_id) ON UPDATE NO ACTION ON DELETE NO ACTION,
  CONSTRAINT sr2_summary_facets_v1_c1 CHECK ((facet_kind='TECHNICAL_SUMMARY' AND method_code IN ('STRUCTURAL_SUMMARY') AND (octet_length(method_version) BETWEEN 1 AND 512 AND method_version ~ '[^[:space:]]' AND lower(btrim(method_version)) NOT IN ('latest','default','unknown')) AND gov_repo.sr2_list_valid_v1(limitations,20) AND scope_kind IN ('PACKAGE_MEMBERS_V1','MODULE_MEMBERS_V1','SERVICE_MEMBERS_V1','REPOSITORY_SELECTION_V1')) IS TRUE),
  CONSTRAINT sr2_summary_facets_v1_c2 CHECK ((octet_length(summary_text) BETWEEN 1 AND 1024 AND summary_text ~ '[^[:space:]]' AND coverage='COMPLETE_DECLARED_SOURCE_SET_V1') IS TRUE),
  CONSTRAINT sr2_summary_facets_v1_c3 CHECK ((item_key=pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(gov_repo.frame_identity(ARRAY['GOVIA_SR2_FACET_ITEM_V1',organisation_id::text,repository_id::text,snapshot_id::text,subject_id::text,facet_kind::text,anchor_subject_id::text,grounding_set_id::text]::text[]), 'UTF8')), 'hex') AND payload_fingerprint=pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(gov_repo.frame_identity(ARRAY['GOVIA_SR2_FACET_PAYLOAD_V1']::text[] || (ARRAY[facet_kind::text,item_key::text,grounding_set_id::text,scope_kind::text,anchor_subject_id::text,method_code::text,method_version::text]::text[] || ARRAY[cardinality(limitations)::text] || limitations || ARRAY[summary_text::text]::text[] || ARRAY[coverage::text]::text[])), 'UTF8')), 'hex')) IS TRUE)
);
ALTER TABLE gov_repo.sr2_summary_facets_v1 OWNER TO postgres;
ALTER TABLE gov_repo.sr2_summary_facets_v1 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE gov_repo.sr2_summary_facets_v1 FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON TABLE gov_repo.sr2_summary_facets_v1 IS 'DERIVED_ANALYTICAL_NON_AUTHORITATIVE; immutable SR2-A1 technical analytical storage; no application capability.';

CREATE TABLE gov_repo.sr2_domain_facets_v1 (
  organisation_id uuid NOT NULL,
  repository_id text COLLATE "C" NOT NULL,
  snapshot_id text COLLATE "C" NOT NULL,
  subject_id text COLLATE "C" NOT NULL,
  projection_id text COLLATE "C" NOT NULL,
  item_key text COLLATE "C" NOT NULL,
  facet_kind text COLLATE "C" NOT NULL,
  grounding_set_id text COLLATE "C" NOT NULL,
  scope_kind text COLLATE "C" NOT NULL,
  anchor_subject_id text COLLATE "C" NOT NULL,
  method_code text COLLATE "C" NOT NULL,
  method_version text COLLATE "C" NOT NULL,
  limitations text[] NOT NULL,
  payload_fingerprint text COLLATE "C" NOT NULL,
  domain_key text COLLATE "C" NOT NULL,
  label text COLLATE "C" NOT NULL,
  structural_description text COLLATE "C" NOT NULL,
  CONSTRAINT sr2_domain_facets_v1_pkey PRIMARY KEY (organisation_id, repository_id, snapshot_id, subject_id, projection_id, item_key),
  CONSTRAINT sr2_domain_facets_v1_f1 FOREIGN KEY (organisation_id, repository_id, snapshot_id, subject_id, projection_id, facet_kind) REFERENCES gov_repo.sr2_facet_collections_v1 (organisation_id, repository_id, snapshot_id, subject_id, projection_id, facet_kind) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT sr2_domain_facets_v1_f2 FOREIGN KEY (organisation_id, repository_id, snapshot_id, grounding_set_id, scope_kind, anchor_subject_id) REFERENCES gov_repo.sr2_source_sets_v1 (organisation_id, repository_id, snapshot_id, source_set_id, scope_kind, anchor_subject_id) ON UPDATE NO ACTION ON DELETE NO ACTION,
  CONSTRAINT sr2_domain_facets_v1_c1 CHECK ((facet_kind='DOMAIN_OBSERVATION' AND method_code IN ('PARSED','STRUCTURAL_SUMMARY','FILENAME_HEURISTIC') AND (octet_length(method_version) BETWEEN 1 AND 512 AND method_version ~ '[^[:space:]]' AND lower(btrim(method_version)) NOT IN ('latest','default','unknown')) AND gov_repo.sr2_list_valid_v1(limitations,20) AND scope_kind='ITEM_GROUNDING_V1') IS TRUE),
  CONSTRAINT sr2_domain_facets_v1_c2 CHECK ((octet_length(domain_key) BETWEEN 1 AND 512 AND domain_key ~ '[^[:space:]]' AND octet_length(label) BETWEEN 1 AND 512 AND label ~ '[^[:space:]]' AND octet_length(structural_description) BETWEEN 1 AND 512 AND structural_description ~ '[^[:space:]]') IS TRUE),
  CONSTRAINT sr2_domain_facets_v1_c3 CHECK ((item_key=pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(gov_repo.frame_identity(ARRAY['GOVIA_SR2_FACET_ITEM_V1',organisation_id::text,repository_id::text,snapshot_id::text,subject_id::text,facet_kind::text,anchor_subject_id::text,domain_key::text]::text[]), 'UTF8')), 'hex') AND payload_fingerprint=pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(gov_repo.frame_identity(ARRAY['GOVIA_SR2_FACET_PAYLOAD_V1']::text[] || (ARRAY[facet_kind::text,item_key::text,grounding_set_id::text,scope_kind::text,anchor_subject_id::text,method_code::text,method_version::text]::text[] || ARRAY[cardinality(limitations)::text] || limitations || ARRAY[domain_key::text]::text[] || ARRAY[label::text]::text[] || ARRAY[structural_description::text]::text[])), 'UTF8')), 'hex')) IS TRUE)
);
ALTER TABLE gov_repo.sr2_domain_facets_v1 OWNER TO postgres;
ALTER TABLE gov_repo.sr2_domain_facets_v1 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE gov_repo.sr2_domain_facets_v1 FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON TABLE gov_repo.sr2_domain_facets_v1 IS 'DERIVED_ANALYTICAL_NON_AUTHORITATIVE; immutable SR2-A1 technical analytical storage; no application capability.';

CREATE TABLE gov_repo.sr2_agent_facets_v1 (
  organisation_id uuid NOT NULL,
  repository_id text COLLATE "C" NOT NULL,
  snapshot_id text COLLATE "C" NOT NULL,
  subject_id text COLLATE "C" NOT NULL,
  projection_id text COLLATE "C" NOT NULL,
  item_key text COLLATE "C" NOT NULL,
  facet_kind text COLLATE "C" NOT NULL,
  grounding_set_id text COLLATE "C" NOT NULL,
  scope_kind text COLLATE "C" NOT NULL,
  anchor_subject_id text COLLATE "C" NOT NULL,
  method_code text COLLATE "C" NOT NULL,
  method_version text COLLATE "C" NOT NULL,
  limitations text[] NOT NULL,
  payload_fingerprint text COLLATE "C" NOT NULL,
  descriptor_key text COLLATE "C" NOT NULL,
  observed_role text COLLATE "C" NOT NULL,
  behaviors text[] NOT NULL,
  CONSTRAINT sr2_agent_facets_v1_pkey PRIMARY KEY (organisation_id, repository_id, snapshot_id, subject_id, projection_id, item_key),
  CONSTRAINT sr2_agent_facets_v1_f1 FOREIGN KEY (organisation_id, repository_id, snapshot_id, subject_id, projection_id, facet_kind) REFERENCES gov_repo.sr2_facet_collections_v1 (organisation_id, repository_id, snapshot_id, subject_id, projection_id, facet_kind) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT sr2_agent_facets_v1_f2 FOREIGN KEY (organisation_id, repository_id, snapshot_id, grounding_set_id, scope_kind, anchor_subject_id) REFERENCES gov_repo.sr2_source_sets_v1 (organisation_id, repository_id, snapshot_id, source_set_id, scope_kind, anchor_subject_id) ON UPDATE NO ACTION ON DELETE NO ACTION,
  CONSTRAINT sr2_agent_facets_v1_c1 CHECK ((facet_kind='AGENT_DESCRIPTOR' AND method_code IN ('PARSED','MANIFEST_OBSERVED','FILENAME_HEURISTIC') AND (octet_length(method_version) BETWEEN 1 AND 512 AND method_version ~ '[^[:space:]]' AND lower(btrim(method_version)) NOT IN ('latest','default','unknown')) AND gov_repo.sr2_list_valid_v1(limitations,20) AND scope_kind='ITEM_GROUNDING_V1') IS TRUE),
  CONSTRAINT sr2_agent_facets_v1_c2 CHECK ((octet_length(descriptor_key) BETWEEN 1 AND 512 AND descriptor_key ~ '[^[:space:]]' AND octet_length(observed_role) BETWEEN 1 AND 512 AND observed_role ~ '[^[:space:]]' AND gov_repo.sr2_list_valid_v1(behaviors,20)) IS TRUE),
  CONSTRAINT sr2_agent_facets_v1_c3 CHECK ((item_key=pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(gov_repo.frame_identity(ARRAY['GOVIA_SR2_FACET_ITEM_V1',organisation_id::text,repository_id::text,snapshot_id::text,subject_id::text,facet_kind::text,anchor_subject_id::text,descriptor_key::text]::text[]), 'UTF8')), 'hex') AND payload_fingerprint=pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(gov_repo.frame_identity(ARRAY['GOVIA_SR2_FACET_PAYLOAD_V1']::text[] || (ARRAY[facet_kind::text,item_key::text,grounding_set_id::text,scope_kind::text,anchor_subject_id::text,method_code::text,method_version::text]::text[] || ARRAY[cardinality(limitations)::text] || limitations || ARRAY[descriptor_key::text]::text[] || ARRAY[observed_role::text]::text[] || ARRAY[cardinality(behaviors)::text] || behaviors)), 'UTF8')), 'hex')) IS TRUE)
);
ALTER TABLE gov_repo.sr2_agent_facets_v1 OWNER TO postgres;
ALTER TABLE gov_repo.sr2_agent_facets_v1 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE gov_repo.sr2_agent_facets_v1 FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON TABLE gov_repo.sr2_agent_facets_v1 IS 'DERIVED_ANALYTICAL_NON_AUTHORITATIVE; immutable SR2-A1 technical analytical storage; no application capability.';

CREATE TABLE gov_repo.sr2_entrypoint_facets_v1 (
  organisation_id uuid NOT NULL,
  repository_id text COLLATE "C" NOT NULL,
  snapshot_id text COLLATE "C" NOT NULL,
  subject_id text COLLATE "C" NOT NULL,
  projection_id text COLLATE "C" NOT NULL,
  item_key text COLLATE "C" NOT NULL,
  facet_kind text COLLATE "C" NOT NULL,
  grounding_set_id text COLLATE "C" NOT NULL,
  scope_kind text COLLATE "C" NOT NULL,
  anchor_subject_id text COLLATE "C" NOT NULL,
  method_code text COLLATE "C" NOT NULL,
  method_version text COLLATE "C" NOT NULL,
  limitations text[] NOT NULL,
  payload_fingerprint text COLLATE "C" NOT NULL,
  entrypoint_key text COLLATE "C" NOT NULL,
  entrypoint_kind text COLLATE "C" NOT NULL,
  safe_signature text COLLATE "C",
  invocation_shape text[] NOT NULL,
  CONSTRAINT sr2_entrypoint_facets_v1_pkey PRIMARY KEY (organisation_id, repository_id, snapshot_id, subject_id, projection_id, item_key),
  CONSTRAINT sr2_entrypoint_facets_v1_f1 FOREIGN KEY (organisation_id, repository_id, snapshot_id, subject_id, projection_id, facet_kind) REFERENCES gov_repo.sr2_facet_collections_v1 (organisation_id, repository_id, snapshot_id, subject_id, projection_id, facet_kind) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT sr2_entrypoint_facets_v1_f2 FOREIGN KEY (organisation_id, repository_id, snapshot_id, grounding_set_id, scope_kind, anchor_subject_id) REFERENCES gov_repo.sr2_source_sets_v1 (organisation_id, repository_id, snapshot_id, source_set_id, scope_kind, anchor_subject_id) ON UPDATE NO ACTION ON DELETE NO ACTION,
  CONSTRAINT sr2_entrypoint_facets_v1_c1 CHECK ((facet_kind='ENTRYPOINT_DESCRIPTOR' AND method_code IN ('PARSED','MANIFEST_OBSERVED') AND (octet_length(method_version) BETWEEN 1 AND 512 AND method_version ~ '[^[:space:]]' AND lower(btrim(method_version)) NOT IN ('latest','default','unknown')) AND gov_repo.sr2_list_valid_v1(limitations,20) AND scope_kind='ITEM_GROUNDING_V1') IS TRUE),
  CONSTRAINT sr2_entrypoint_facets_v1_c2 CHECK ((octet_length(entrypoint_key) BETWEEN 1 AND 512 AND entrypoint_key ~ '[^[:space:]]' AND entrypoint_kind IN ('FUNCTION','COMMAND','HTTP_ROUTE','PROCESS','MODULE_INITIALIZER') AND (safe_signature IS NULL OR (octet_length(safe_signature) BETWEEN 1 AND 512 AND safe_signature ~ '[^[:space:]]')) AND gov_repo.sr2_list_valid_v1(invocation_shape,20)) IS TRUE),
  CONSTRAINT sr2_entrypoint_facets_v1_c3 CHECK ((item_key=pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(gov_repo.frame_identity(ARRAY['GOVIA_SR2_FACET_ITEM_V1',organisation_id::text,repository_id::text,snapshot_id::text,subject_id::text,facet_kind::text,anchor_subject_id::text,entrypoint_kind::text,entrypoint_key::text]::text[]), 'UTF8')), 'hex') AND payload_fingerprint=pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(gov_repo.frame_identity(ARRAY['GOVIA_SR2_FACET_PAYLOAD_V1']::text[] || (ARRAY[facet_kind::text,item_key::text,grounding_set_id::text,scope_kind::text,anchor_subject_id::text,method_code::text,method_version::text]::text[] || ARRAY[cardinality(limitations)::text] || limitations || ARRAY[entrypoint_key::text]::text[] || ARRAY[entrypoint_kind::text]::text[] || ARRAY[CASE WHEN safe_signature IS NULL THEN '0' ELSE '1' END,coalesce(safe_signature::text,'')]::text[] || ARRAY[cardinality(invocation_shape)::text] || invocation_shape)), 'UTF8')), 'hex')) IS TRUE)
);
ALTER TABLE gov_repo.sr2_entrypoint_facets_v1 OWNER TO postgres;
ALTER TABLE gov_repo.sr2_entrypoint_facets_v1 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE gov_repo.sr2_entrypoint_facets_v1 FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON TABLE gov_repo.sr2_entrypoint_facets_v1 IS 'DERIVED_ANALYTICAL_NON_AUTHORITATIVE; immutable SR2-A1 technical analytical storage; no application capability.';

CREATE TABLE gov_repo.sr2_fragments_v1 (
  organisation_id uuid NOT NULL,
  repository_id text COLLATE "C" NOT NULL,
  snapshot_id text COLLATE "C" NOT NULL,
  subject_id text COLLATE "C" NOT NULL,
  projection_id text COLLATE "C" NOT NULL,
  ordinal smallint NOT NULL,
  fragment_kind text COLLATE "C" NOT NULL,
  source_subject_id text COLLATE "C" NOT NULL,
  projected_text text COLLATE "C" NOT NULL,
  projection_mark text COLLATE "C" NOT NULL,
  untrusted_source boolean NOT NULL,
  CONSTRAINT sr2_fragments_v1_pkey PRIMARY KEY (organisation_id, repository_id, snapshot_id, subject_id, projection_id, ordinal),
  CONSTRAINT sr2_fragments_v1_f1 FOREIGN KEY (organisation_id, repository_id, snapshot_id, subject_id, projection_id) REFERENCES gov_repo.sr2_protected_projections_v1 (organisation_id, repository_id, snapshot_id, subject_id, projection_id) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT sr2_fragments_v1_f2 FOREIGN KEY (organisation_id, repository_id, snapshot_id, source_subject_id) REFERENCES gov_repo.sr2_subjects_v1 (organisation_id, repository_id, snapshot_id, subject_id) ON UPDATE NO ACTION ON DELETE NO ACTION,
  CONSTRAINT sr2_fragments_v1_c1 CHECK ((ordinal BETWEEN 1 AND 4 AND fragment_kind IN ('SIGNATURE','STRUCTURAL_STATEMENT','CALL_DESCRIPTOR','IMPORT_DESCRIPTOR','DOCUMENTATION_SUMMARY')) IS TRUE),
  CONSTRAINT sr2_fragments_v1_c2 CHECK ((octet_length(projected_text) BETWEEN 1 AND 1024 AND projected_text ~ '[^[:space:]]' AND projection_mark='CONTENT_PROJECTED' AND untrusted_source) IS TRUE)
);
ALTER TABLE gov_repo.sr2_fragments_v1 OWNER TO postgres;
ALTER TABLE gov_repo.sr2_fragments_v1 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE gov_repo.sr2_fragments_v1 FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON TABLE gov_repo.sr2_fragments_v1 IS 'DERIVED_ANALYTICAL_NON_AUTHORITATIVE; immutable SR2-A1 technical analytical storage; no application capability.';

DO $vector_storage$
DECLARE v_ext name;
BEGIN
 SELECT n.nspname INTO STRICT v_ext FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace WHERE e.extname='vector';
 EXECUTE replace($ddl$CREATE TABLE gov_repo.sr2_representations_v1 (
  organisation_id uuid NOT NULL,
  repository_id text COLLATE "C" NOT NULL,
  snapshot_id text COLLATE "C" NOT NULL,
  subject_id text COLLATE "C" NOT NULL,
  projection_id text COLLATE "C" NOT NULL,
  representation_id text COLLATE "C" NOT NULL,
  projection_schema_version text COLLATE "C" NOT NULL,
  projection_fingerprint text COLLATE "C" NOT NULL,
  content_class text COLLATE "C" NOT NULL,
  projection_admitted_at timestamptz NOT NULL,
  provider_id text COLLATE "C" NOT NULL,
  model_id text COLLATE "C" NOT NULL,
  model_version text COLLATE "C" NOT NULL,
  dimension integer NOT NULL,
  embedding __vector__.vector NOT NULL,
  capture_id uuid NOT NULL,
  capture_observed_at timestamptz NOT NULL,
  generated_at timestamptz NOT NULL,
  indexed_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL,
  CONSTRAINT sr2_representations_v1_pkey PRIMARY KEY (organisation_id, repository_id, snapshot_id, subject_id, projection_id, representation_id),
  CONSTRAINT sr2_representations_v1_f1 FOREIGN KEY (organisation_id, repository_id, snapshot_id, subject_id, projection_id, projection_schema_version, projection_fingerprint, content_class, projection_admitted_at) REFERENCES gov_repo.sr2_projections_v1 (organisation_id, repository_id, snapshot_id, subject_id, projection_id, projection_schema_version, projection_fingerprint, content_class, admitted_at) ON UPDATE NO ACTION ON DELETE NO ACTION,
  CONSTRAINT sr2_representations_v1_f2 FOREIGN KEY (organisation_id, repository_id, snapshot_id, capture_id, capture_observed_at) REFERENCES gov_repo.sr2_captures_v1 (organisation_id, repository_id, snapshot_id, capture_id, observed_at) ON UPDATE NO ACTION ON DELETE NO ACTION,
  CONSTRAINT sr2_representations_v1_c1 CHECK ((dimension BETWEEN 1 AND 16000) IS TRUE),
  CONSTRAINT sr2_representations_v1_c2 CHECK ((__vector__.vector_dims(embedding)=dimension) IS TRUE),
  CONSTRAINT sr2_representations_v1_c3 CHECK ((__vector__.vector_norm(embedding)>0 AND __vector__.vector_norm(embedding) NOT IN ('NaN'::float8,'Infinity'::float8)) IS TRUE),
  CONSTRAINT sr2_representations_v1_c4 CHECK (((octet_length(projection_schema_version) BETWEEN 1 AND 512 AND projection_schema_version ~ '[^[:space:]]' AND lower(btrim(projection_schema_version)) NOT IN ('latest','default','unknown')) AND (octet_length(provider_id) BETWEEN 1 AND 512 AND provider_id ~ '[^[:space:]]' AND lower(btrim(provider_id)) NOT IN ('latest','default','unknown')) AND (octet_length(model_id) BETWEEN 1 AND 512 AND model_id ~ '[^[:space:]]' AND lower(btrim(model_id)) NOT IN ('latest','default','unknown')) AND (octet_length(model_version) BETWEEN 1 AND 512 AND model_version ~ '[^[:space:]]' AND lower(btrim(model_version)) NOT IN ('latest','default','unknown')) AND content_class='PROTECTED_CONTEXT_V1') IS TRUE),
  CONSTRAINT sr2_representations_v1_c5 CHECK ((isfinite(capture_observed_at) AND isfinite(projection_admitted_at) AND isfinite(generated_at) AND isfinite(indexed_at) AND isfinite(recorded_at) AND greatest(capture_observed_at,projection_admitted_at)<=generated_at AND generated_at<=indexed_at AND indexed_at<=recorded_at) IS TRUE),
  CONSTRAINT sr2_representations_v1_c6 CHECK ((representation_id=pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(gov_repo.frame_identity(ARRAY['GOVIA_SR2_REPRESENTATION_V1',organisation_id::text,repository_id::text,snapshot_id::text,subject_id::text,projection_id::text,projection_schema_version::text,projection_fingerprint::text,provider_id::text,model_id::text,model_version::text,dimension::text]::text[]), 'UTF8')), 'hex')) IS TRUE)
);$ddl$,'__vector__',quote_ident(v_ext));
END $vector_storage$;
ALTER TABLE gov_repo.sr2_representations_v1 OWNER TO postgres;
ALTER TABLE gov_repo.sr2_representations_v1 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE gov_repo.sr2_representations_v1 FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON TABLE gov_repo.sr2_representations_v1 IS 'DERIVED_ANALYTICAL_NON_AUTHORITATIVE; immutable SR2-A1 technical analytical storage; no application capability.';

CREATE FUNCTION gov_repo.sr2_immutable_v1() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER VOLATILE PARALLEL UNSAFE CALLED ON NULL INPUT
SET search_path=pg_catalog,pg_temp AS $function$
BEGIN RAISE EXCEPTION 'SR2_IMMUTABLE' USING ERRCODE='55000'; END
$function$;

CREATE FUNCTION gov_repo.sr2_repository_guard_v1() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER VOLATILE PARALLEL UNSAFE CALLED ON NULL INPUT
SET search_path=pg_catalog,pg_temp AS $function$
BEGIN
 IF NEW.recorded_at>statement_timestamp() OR NOT EXISTS (
  SELECT FROM gov_repo.technical_source_connections c WHERE c.organisation_id=NEW.organisation_id
  AND c.connection_id=NEW.connection_id AND c.family='REPOSITORY'
  AND c.source_system_id COLLATE "C"=NEW.source_system_id AND c.provider_code COLLATE "C"=NEW.provider_code
 ) THEN RAISE EXCEPTION 'SR2_REPOSITORY_ATTESTATION' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END
$function$;

CREATE FUNCTION gov_repo.sr2_capture_guard_v1() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER VOLATILE PARALLEL UNSAFE CALLED ON NULL INPUT
SET search_path=pg_catalog,pg_temp AS $function$
BEGIN
 IF NEW.recorded_at>statement_timestamp() OR NOT EXISTS (
 SELECT FROM gov_repo.sr2_repositories_v1 r JOIN gov_repo.sr2_snapshots_v1 s ON r.organisation_id=s.organisation_id AND r.repository_id=s.repository_id
 WHERE s.organisation_id=NEW.organisation_id AND s.repository_id=NEW.repository_id AND s.snapshot_id=NEW.snapshot_id AND r.provider_instance_id=NEW.observed_provider_instance_id
 AND r.provider_repository_id=NEW.observed_provider_repository_id
 AND s.revision_scheme=NEW.resolved_revision_scheme AND s.full_revision=NEW.resolved_full_revision
 AND s.manifest_fingerprint=NEW.observed_manifest_fingerprint
 ) THEN RAISE EXCEPTION 'SR2_CAPTURE_ATTESTATION' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END
$function$;

CREATE FUNCTION gov_repo.sr2_record_time_guard_v1() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER VOLATILE PARALLEL UNSAFE CALLED ON NULL INPUT
SET search_path=pg_catalog,pg_temp AS $function$
BEGIN
 IF NEW.recorded_at>statement_timestamp() THEN RAISE EXCEPTION 'SR2_FUTURE_RECORD' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END
$function$;

CREATE FUNCTION gov_repo.sr2_manifest_lock_v1() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER VOLATILE PARALLEL UNSAFE CALLED ON NULL INPUT
SET search_path=pg_catalog,pg_temp AS $function$
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN
 RAISE EXCEPTION 'SR2_ASSEMBLY_READ_COMMITTED_REQUIRED' USING ERRCODE='25001'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(gov_repo.frame_identity(ARRAY['GOVIA_SR2_MANIFEST_LOCK_V1',NEW.organisation_id::text,NEW.repository_id::text,NEW.snapshot_id::text]::text[]),0));
 RETURN NEW;
END
$function$;

CREATE FUNCTION gov_repo.sr2_source_set_lock_v1() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER VOLATILE PARALLEL UNSAFE CALLED ON NULL INPUT
SET search_path=pg_catalog,pg_temp AS $function$
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN
 RAISE EXCEPTION 'SR2_ASSEMBLY_READ_COMMITTED_REQUIRED' USING ERRCODE='25001'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(gov_repo.frame_identity(ARRAY['GOVIA_SR2_SOURCE_SET_LOCK_V1',NEW.organisation_id::text,NEW.repository_id::text,NEW.snapshot_id::text,NEW.source_set_id::text]::text[]),0));
 RETURN NEW;
END
$function$;

CREATE FUNCTION gov_repo.sr2_projection_lock_v1() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER VOLATILE PARALLEL UNSAFE CALLED ON NULL INPUT
SET search_path=pg_catalog,pg_temp AS $function$
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN
 RAISE EXCEPTION 'SR2_ASSEMBLY_READ_COMMITTED_REQUIRED' USING ERRCODE='25001'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(gov_repo.frame_identity(ARRAY['GOVIA_SR2_PROJECTION_LOCK_V1',NEW.organisation_id::text,NEW.repository_id::text,NEW.snapshot_id::text,NEW.subject_id::text,NEW.projection_id::text]::text[]),0));
 RETURN NEW;
END
$function$;

CREATE FUNCTION gov_repo.sr2_manifest_integrity_v1() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER VOLATILE PARALLEL UNSAFE CALLED ON NULL INPUT
SET search_path=pg_catalog,pg_temp AS $function$
DECLARE v_root gov_repo.sr2_snapshots_v1%ROWTYPE; v_entry record; v_parts text[]; v_count bigint;
BEGIN
 SELECT * INTO v_root FROM gov_repo.sr2_snapshots_v1 s WHERE s.organisation_id=NEW.organisation_id AND s.repository_id=NEW.repository_id AND s.snapshot_id=NEW.snapshot_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'SR2_MANIFEST_PARENT' USING ERRCODE='23514'; END IF;
 SELECT count(*) INTO v_count FROM gov_repo.sr2_manifest_entries_v1 e WHERE e.organisation_id=NEW.organisation_id AND e.repository_id=NEW.repository_id AND e.snapshot_id=NEW.snapshot_id;
 IF v_count<>v_root.manifest_entry_count THEN RAISE EXCEPTION 'SR2_MANIFEST_COUNT' USING ERRCODE='23514'; END IF;
 v_parts:=ARRAY[v_root.revision_scheme,v_root.full_revision,v_count::text];
 FOR v_entry IN SELECT * FROM gov_repo.sr2_manifest_entries_v1 e WHERE e.organisation_id=NEW.organisation_id AND e.repository_id=NEW.repository_id AND e.snapshot_id=NEW.snapshot_id ORDER BY e.relative_path COLLATE "C" LOOP
  IF length(v_entry.provider_object_id)<>(CASE v_root.revision_scheme WHEN 'GIT_SHA1_V1' THEN 40 ELSE 64 END) THEN
   RAISE EXCEPTION 'SR2_MANIFEST_OID_SCHEME' USING ERRCODE='23514'; END IF;
  v_parts:=v_parts || ARRAY[v_entry.relative_path::text,v_entry.entry_kind::text,v_entry.payload_kind::text,v_entry.provider_object_id::text,v_entry.source_fingerprint::text,v_entry.byte_length::text,v_entry.encoding_id::text,v_entry.line_count::text];
 END LOOP;
 IF v_root.manifest_fingerprint<>pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(gov_repo.frame_identity(ARRAY['GOVIA_SR2_SOURCE_MANIFEST_V1']::text[] || (v_parts)), 'UTF8')), 'hex') THEN RAISE EXCEPTION 'SR2_MANIFEST_HASH' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END
$function$;

CREATE FUNCTION gov_repo.sr2_source_set_integrity_v1() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER VOLATILE PARALLEL UNSAFE CALLED ON NULL INPUT
SET search_path=pg_catalog,pg_temp AS $function$
DECLARE v_root gov_repo.sr2_source_sets_v1%ROWTYPE; v_member record; v_parts text[]; v_count bigint; v_family text; v_locator text;
BEGIN
 SELECT * INTO v_root FROM gov_repo.sr2_source_sets_v1 s WHERE s.organisation_id=NEW.organisation_id AND s.repository_id=NEW.repository_id AND s.snapshot_id=NEW.snapshot_id AND s.source_set_id=NEW.source_set_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'SR2_SOURCE_SET_PARENT' USING ERRCODE='23514'; END IF;
 SELECT count(*) INTO v_count FROM gov_repo.sr2_source_set_members_v1 m WHERE m.organisation_id=NEW.organisation_id AND m.repository_id=NEW.repository_id AND m.snapshot_id=NEW.snapshot_id AND m.source_set_id=NEW.source_set_id;
 IF v_count<>v_root.member_count OR v_count NOT BETWEEN 1 AND 20 THEN RAISE EXCEPTION 'SR2_SOURCE_SET_COUNT' USING ERRCODE='23514'; END IF;
 v_parts:=ARRAY[v_count::text];
 FOR v_member IN SELECT * FROM gov_repo.sr2_source_set_members_v1 m WHERE m.organisation_id=NEW.organisation_id AND m.repository_id=NEW.repository_id AND m.snapshot_id=NEW.snapshot_id AND m.source_set_id=NEW.source_set_id ORDER BY m.source_subject_id COLLATE "C" LOOP
  v_parts:=v_parts || ARRAY[v_member.source_subject_id,v_member.entry_id,v_member.source_fingerprint];
 END LOOP;
 IF v_root.membership_fingerprint<>pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(gov_repo.frame_identity(ARRAY['GOVIA_SR2_SOURCE_SET_MEMBERS_V1']::text[] || (v_parts)), 'UTF8')), 'hex') THEN RAISE EXCEPTION 'SR2_SOURCE_SET_HASH' USING ERRCODE='23514'; END IF;
 SELECT s.subject_family,l.locator_class INTO v_family,v_locator
 FROM gov_repo.sr2_subjects_v1 s LEFT JOIN gov_repo.sr2_chunk_locators_v1 l ON s.organisation_id=l.organisation_id AND s.repository_id=l.repository_id AND s.snapshot_id=l.snapshot_id AND s.chunk_locator_id=l.locator_id
 WHERE s.organisation_id=NEW.organisation_id AND s.repository_id=NEW.repository_id AND s.snapshot_id=NEW.snapshot_id AND s.subject_id=v_root.anchor_subject_id;
 IF v_root.scope_kind='REPOSITORY_SELECTION_V1' THEN
  IF v_family IS DISTINCT FROM 'REPOSITORY_SNAPSHOT' THEN RAISE EXCEPTION 'SR2_SET_SNAPSHOT_ANCHOR' USING ERRCODE='23514'; END IF;
 ELSE
  IF v_family NOT IN ('CODE_SYMBOL','REPOSITORY_CHUNK') OR v_family IS NULL
  OR NOT EXISTS (SELECT FROM gov_repo.sr2_source_set_members_v1 m WHERE m.organisation_id=NEW.organisation_id AND m.repository_id=NEW.repository_id AND m.snapshot_id=NEW.snapshot_id AND m.source_set_id=NEW.source_set_id AND m.source_subject_id=v_root.anchor_subject_id)
  OR (v_root.scope_kind='PACKAGE_MEMBERS_V1' AND v_locator IS DISTINCT FROM 'FILE_DESCRIPTOR') THEN
   RAISE EXCEPTION 'SR2_SET_LEAF_ANCHOR' USING ERRCODE='23514'; END IF;
 END IF;
 IF v_root.coverage='ENTIRE_SNAPSHOT_MANIFEST' AND (
  v_root.scope_kind<>'REPOSITORY_SELECTION_V1'
  OR v_count<>(SELECT s.manifest_entry_count FROM gov_repo.sr2_snapshots_v1 s WHERE s.organisation_id=NEW.organisation_id AND s.repository_id=NEW.repository_id AND s.snapshot_id=NEW.snapshot_id)
  OR EXISTS (SELECT FROM gov_repo.sr2_source_set_members_v1 m
   JOIN gov_repo.sr2_subjects_v1 s ON s.organisation_id=m.organisation_id AND s.repository_id=m.repository_id AND s.snapshot_id=m.snapshot_id AND s.subject_id=m.source_subject_id
   LEFT JOIN gov_repo.sr2_chunk_locators_v1 l ON s.organisation_id=l.organisation_id AND s.repository_id=l.repository_id AND s.snapshot_id=l.snapshot_id AND s.chunk_locator_id=l.locator_id
   WHERE m.organisation_id=NEW.organisation_id AND m.repository_id=NEW.repository_id AND m.snapshot_id=NEW.snapshot_id AND m.source_set_id=NEW.source_set_id AND l.locator_class IS DISTINCT FROM 'FILE_DESCRIPTOR')
  OR EXISTS (SELECT FROM gov_repo.sr2_manifest_entries_v1 e WHERE e.organisation_id=NEW.organisation_id AND e.repository_id=NEW.repository_id AND e.snapshot_id=NEW.snapshot_id AND NOT EXISTS (
   SELECT FROM gov_repo.sr2_source_set_members_v1 m WHERE m.organisation_id=NEW.organisation_id AND m.repository_id=NEW.repository_id AND m.snapshot_id=NEW.snapshot_id AND m.source_set_id=NEW.source_set_id AND m.entry_id=e.entry_id))
 ) THEN RAISE EXCEPTION 'SR2_SET_ENTIRE_MANIFEST' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END
$function$;

CREATE FUNCTION gov_repo.sr2_projection_integrity_v1() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER VOLATILE PARALLEL UNSAFE CALLED ON NULL INPUT
SET search_path=pg_catalog,pg_temp AS $function$
DECLARE
 v_root gov_repo.sr2_projections_v1%ROWTYPE; v_protected gov_repo.sr2_protected_projections_v1%ROWTYPE;
 v_collection record; v_item record; v_source record; v_fragment record;
 v_parts text[]; v_basis text[]; v_records text[]; v_collection_parts text[]; v_count bigint; v_kind text;
 v_family text; v_locator text; v_max timestamptz; v_bytes bigint; v_refs bigint; v_ordinal integer:=0;
BEGIN
 SELECT * INTO v_root FROM gov_repo.sr2_projections_v1 p WHERE p.organisation_id=NEW.organisation_id AND p.repository_id=NEW.repository_id AND p.snapshot_id=NEW.snapshot_id AND p.subject_id=NEW.subject_id AND p.projection_id=NEW.projection_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'SR2_PROJECTION_PARENT' USING ERRCODE='23514'; END IF;
 SELECT count(*) INTO v_count FROM gov_repo.sr2_projection_sources_v1 s WHERE s.organisation_id=NEW.organisation_id AND s.repository_id=NEW.repository_id AND s.snapshot_id=NEW.snapshot_id AND s.subject_id=NEW.subject_id AND s.projection_id=NEW.projection_id;
 IF v_count<>(SELECT count(DISTINCT m.entry_id) FROM gov_repo.sr2_source_set_members_v1 m WHERE m.organisation_id=NEW.organisation_id AND m.repository_id=NEW.repository_id AND m.snapshot_id=NEW.snapshot_id AND m.source_set_id=v_root.primary_source_set_id)
 OR EXISTS (SELECT FROM gov_repo.sr2_projection_sources_v1 s WHERE s.organisation_id=NEW.organisation_id AND s.repository_id=NEW.repository_id AND s.snapshot_id=NEW.snapshot_id AND s.subject_id=NEW.subject_id AND s.projection_id=NEW.projection_id AND NOT EXISTS (
  SELECT FROM gov_repo.sr2_source_set_members_v1 m WHERE m.organisation_id=NEW.organisation_id AND m.repository_id=NEW.repository_id AND m.snapshot_id=NEW.snapshot_id AND m.source_set_id=v_root.primary_source_set_id AND m.entry_id=s.entry_id)) THEN
  RAISE EXCEPTION 'SR2_PROJECTION_SOURCE_SET' USING ERRCODE='23514'; END IF;
 v_basis:=ARRAY[v_count::text]; v_records:=ARRAY[v_count::text];
 FOR v_source IN SELECT s.*,a.evaluated_at FROM gov_repo.sr2_projection_sources_v1 s JOIN gov_repo.sr2_source_admissions_v1 a
 ON s.organisation_id=a.organisation_id AND s.repository_id=a.repository_id AND s.snapshot_id=a.snapshot_id AND s.entry_id=a.entry_id AND s.source_admission_id=a.source_admission_id
 WHERE s.organisation_id=NEW.organisation_id AND s.repository_id=NEW.repository_id AND s.snapshot_id=NEW.snapshot_id AND s.subject_id=NEW.subject_id AND s.projection_id=NEW.projection_id ORDER BY s.entry_id COLLATE "C" LOOP
  v_basis:=v_basis || ARRAY[v_source.entry_id,v_source.admission_basis_fingerprint];
  v_records:=v_records || ARRAY[v_source.entry_id,v_source.source_admission_id,v_source.admission_basis_fingerprint,v_source.outcome];
  v_max:=greatest(v_max,v_source.evaluated_at);
 END LOOP;
 IF v_count=0 OR v_root.admitted_at IS DISTINCT FROM v_max
 OR v_root.admission_basis_set_fingerprint<>pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(gov_repo.frame_identity(ARRAY['GOVIA_SR2_ADMISSION_BASES_V1']::text[] || (v_basis)), 'UTF8')), 'hex')
 OR v_root.admission_record_set_fingerprint<>pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(gov_repo.frame_identity(ARRAY['GOVIA_SR2_ADMISSION_RECORDS_V1']::text[] || (v_records)), 'UTF8')), 'hex') THEN
  RAISE EXCEPTION 'SR2_PROJECTION_ADMISSION_SEAL' USING ERRCODE='23514'; END IF;
 SELECT * INTO v_protected FROM gov_repo.sr2_protected_projections_v1 p WHERE p.organisation_id=NEW.organisation_id AND p.repository_id=NEW.repository_id AND p.snapshot_id=NEW.snapshot_id AND p.subject_id=NEW.subject_id AND p.projection_id=NEW.projection_id;
 IF (v_root.content_class='PROTECTED_CONTEXT_V1') IS DISTINCT FROM FOUND THEN
  RAISE EXCEPTION 'SR2_PROTECTED_SINGLETON' USING ERRCODE='23514'; END IF;
 SELECT s.subject_family,l.locator_class INTO v_family,v_locator FROM gov_repo.sr2_subjects_v1 s
 LEFT JOIN gov_repo.sr2_chunk_locators_v1 l ON s.organisation_id=l.organisation_id AND s.repository_id=l.repository_id AND s.snapshot_id=l.snapshot_id AND s.chunk_locator_id=l.locator_id
 WHERE s.organisation_id=NEW.organisation_id AND s.repository_id=NEW.repository_id AND s.snapshot_id=NEW.snapshot_id AND s.subject_id=NEW.subject_id;
 v_parts:=ARRAY[v_root.record_contract,v_root.projection_schema_version,v_root.document_recipe,v_root.extraction_recipe_id,v_root.extraction_recipe_version,v_root.handling_recipe_id,v_root.handling_recipe_version,v_root.content_class,v_root.primary_source_set_id,v_root.admission_basis_set_fingerprint,v_root.safe_label,v_root.safe_description];
 v_bytes:=octet_length(v_root.safe_label)+octet_length(v_root.safe_description);
 IF v_root.content_class='PROTECTED_CONTEXT_V1' THEN
  v_parts:=v_parts || ARRAY['1',v_protected.structural_summary,v_protected.literal_handling,v_protected.projection_mark,CASE WHEN v_protected.untrusted_source THEN '1' ELSE '0' END];
  v_bytes:=v_bytes+octet_length(v_protected.structural_summary);
 ELSE v_parts:=v_parts || ARRAY['0']; END IF;
 FOREACH v_kind IN ARRAY ARRAY['MODULE_DESCRIPTOR','SERVICE_DESCRIPTOR','DEPENDENCY_DESCRIPTOR','CONFIGURATION_DESCRIPTOR','TECHNICAL_SUMMARY','DOMAIN_OBSERVATION','AGENT_DESCRIPTOR','ENTRYPOINT_DESCRIPTOR'] LOOP
  SELECT * INTO v_collection FROM gov_repo.sr2_facet_collections_v1 c WHERE c.organisation_id=NEW.organisation_id AND c.repository_id=NEW.repository_id AND c.snapshot_id=NEW.snapshot_id AND c.subject_id=NEW.subject_id AND c.projection_id=NEW.projection_id AND c.facet_kind=v_kind;
  IF NOT FOUND THEN v_parts:=v_parts || ARRAY['0']; CONTINUE; END IF;
  IF v_root.content_class<>'PROTECTED_CONTEXT_V1'
  OR (v_family='CODE_SYMBOL' AND v_kind IN ('DEPENDENCY_DESCRIPTOR','CONFIGURATION_DESCRIPTOR'))
  OR (v_locator='DOCUMENTATION_REGION' AND v_kind NOT IN ('DOMAIN_OBSERVATION','TECHNICAL_SUMMARY')) THEN
   RAISE EXCEPTION 'SR2_FACET_COMPATIBILITY' USING ERRCODE='23514'; END IF;
  SELECT count(*) INTO v_count FROM ( SELECT i.organisation_id,i.repository_id,i.snapshot_id,i.subject_id,i.projection_id,i.item_key,i.facet_kind,i.grounding_set_id,i.scope_kind,i.anchor_subject_id,i.method_code,i.payload_fingerprint,
 (coalesce((SELECT sum(octet_length(v)) FROM unnest(i.limitations) v),0)+coalesce(octet_length(i.module_key),0)+coalesce(octet_length(i.directory_label),0)+coalesce(octet_length(i.module_name),0))::bigint AS descriptive_bytes FROM gov_repo.sr2_module_facets_v1 i
 UNION ALL
 SELECT i.organisation_id,i.repository_id,i.snapshot_id,i.subject_id,i.projection_id,i.item_key,i.facet_kind,i.grounding_set_id,i.scope_kind,i.anchor_subject_id,i.method_code,i.payload_fingerprint,
 (coalesce((SELECT sum(octet_length(v)) FROM unnest(i.limitations) v),0)+coalesce(octet_length(i.service_key),0)+coalesce(octet_length(i.service_name),0)+coalesce((SELECT sum(octet_length(v)) FROM unnest(i.capabilities) v),0))::bigint AS descriptive_bytes FROM gov_repo.sr2_service_facets_v1 i
 UNION ALL
 SELECT i.organisation_id,i.repository_id,i.snapshot_id,i.subject_id,i.projection_id,i.item_key,i.facet_kind,i.grounding_set_id,i.scope_kind,i.anchor_subject_id,i.method_code,i.payload_fingerprint,
 (coalesce((SELECT sum(octet_length(v)) FROM unnest(i.limitations) v),0)+coalesce(octet_length(i.dependency_name),0)+coalesce(octet_length(i.resolution_key),0)+coalesce(octet_length(i.observed_specification),0)+coalesce(octet_length(i.resolved_version),0))::bigint AS descriptive_bytes FROM gov_repo.sr2_dependency_facets_v1 i
 UNION ALL
 SELECT i.organisation_id,i.repository_id,i.snapshot_id,i.subject_id,i.projection_id,i.item_key,i.facet_kind,i.grounding_set_id,i.scope_kind,i.anchor_subject_id,i.method_code,i.payload_fingerprint,
 (coalesce((SELECT sum(octet_length(v)) FROM unnest(i.limitations) v),0)+coalesce(octet_length(i.configuration_key),0))::bigint AS descriptive_bytes FROM gov_repo.sr2_configuration_facets_v1 i
 UNION ALL
 SELECT i.organisation_id,i.repository_id,i.snapshot_id,i.subject_id,i.projection_id,i.item_key,i.facet_kind,i.grounding_set_id,i.scope_kind,i.anchor_subject_id,i.method_code,i.payload_fingerprint,
 (coalesce((SELECT sum(octet_length(v)) FROM unnest(i.limitations) v),0)+coalesce(octet_length(i.summary_text),0))::bigint AS descriptive_bytes FROM gov_repo.sr2_summary_facets_v1 i
 UNION ALL
 SELECT i.organisation_id,i.repository_id,i.snapshot_id,i.subject_id,i.projection_id,i.item_key,i.facet_kind,i.grounding_set_id,i.scope_kind,i.anchor_subject_id,i.method_code,i.payload_fingerprint,
 (coalesce((SELECT sum(octet_length(v)) FROM unnest(i.limitations) v),0)+coalesce(octet_length(i.domain_key),0)+coalesce(octet_length(i.label),0)+coalesce(octet_length(i.structural_description),0))::bigint AS descriptive_bytes FROM gov_repo.sr2_domain_facets_v1 i
 UNION ALL
 SELECT i.organisation_id,i.repository_id,i.snapshot_id,i.subject_id,i.projection_id,i.item_key,i.facet_kind,i.grounding_set_id,i.scope_kind,i.anchor_subject_id,i.method_code,i.payload_fingerprint,
 (coalesce((SELECT sum(octet_length(v)) FROM unnest(i.limitations) v),0)+coalesce(octet_length(i.descriptor_key),0)+coalesce(octet_length(i.observed_role),0)+coalesce((SELECT sum(octet_length(v)) FROM unnest(i.behaviors) v),0))::bigint AS descriptive_bytes FROM gov_repo.sr2_agent_facets_v1 i
 UNION ALL
 SELECT i.organisation_id,i.repository_id,i.snapshot_id,i.subject_id,i.projection_id,i.item_key,i.facet_kind,i.grounding_set_id,i.scope_kind,i.anchor_subject_id,i.method_code,i.payload_fingerprint,
 (coalesce((SELECT sum(octet_length(v)) FROM unnest(i.limitations) v),0)+coalesce(octet_length(i.entrypoint_key),0)+coalesce(octet_length(i.safe_signature),0)+coalesce((SELECT sum(octet_length(v)) FROM unnest(i.invocation_shape) v),0))::bigint AS descriptive_bytes FROM gov_repo.sr2_entrypoint_facets_v1 i ) a WHERE a.organisation_id=NEW.organisation_id AND a.repository_id=NEW.repository_id AND a.snapshot_id=NEW.snapshot_id AND a.subject_id=NEW.subject_id AND a.projection_id=NEW.projection_id AND a.facet_kind=v_kind;
  IF v_count<>v_collection.expected_item_count THEN RAISE EXCEPTION 'SR2_FACET_COUNT' USING ERRCODE='23514'; END IF;
  v_collection_parts:=ARRAY[v_kind,v_count::text];
  FOR v_item IN SELECT a.* FROM ( SELECT i.organisation_id,i.repository_id,i.snapshot_id,i.subject_id,i.projection_id,i.item_key,i.facet_kind,i.grounding_set_id,i.scope_kind,i.anchor_subject_id,i.method_code,i.payload_fingerprint,
 (coalesce((SELECT sum(octet_length(v)) FROM unnest(i.limitations) v),0)+coalesce(octet_length(i.module_key),0)+coalesce(octet_length(i.directory_label),0)+coalesce(octet_length(i.module_name),0))::bigint AS descriptive_bytes FROM gov_repo.sr2_module_facets_v1 i
 UNION ALL
 SELECT i.organisation_id,i.repository_id,i.snapshot_id,i.subject_id,i.projection_id,i.item_key,i.facet_kind,i.grounding_set_id,i.scope_kind,i.anchor_subject_id,i.method_code,i.payload_fingerprint,
 (coalesce((SELECT sum(octet_length(v)) FROM unnest(i.limitations) v),0)+coalesce(octet_length(i.service_key),0)+coalesce(octet_length(i.service_name),0)+coalesce((SELECT sum(octet_length(v)) FROM unnest(i.capabilities) v),0))::bigint AS descriptive_bytes FROM gov_repo.sr2_service_facets_v1 i
 UNION ALL
 SELECT i.organisation_id,i.repository_id,i.snapshot_id,i.subject_id,i.projection_id,i.item_key,i.facet_kind,i.grounding_set_id,i.scope_kind,i.anchor_subject_id,i.method_code,i.payload_fingerprint,
 (coalesce((SELECT sum(octet_length(v)) FROM unnest(i.limitations) v),0)+coalesce(octet_length(i.dependency_name),0)+coalesce(octet_length(i.resolution_key),0)+coalesce(octet_length(i.observed_specification),0)+coalesce(octet_length(i.resolved_version),0))::bigint AS descriptive_bytes FROM gov_repo.sr2_dependency_facets_v1 i
 UNION ALL
 SELECT i.organisation_id,i.repository_id,i.snapshot_id,i.subject_id,i.projection_id,i.item_key,i.facet_kind,i.grounding_set_id,i.scope_kind,i.anchor_subject_id,i.method_code,i.payload_fingerprint,
 (coalesce((SELECT sum(octet_length(v)) FROM unnest(i.limitations) v),0)+coalesce(octet_length(i.configuration_key),0))::bigint AS descriptive_bytes FROM gov_repo.sr2_configuration_facets_v1 i
 UNION ALL
 SELECT i.organisation_id,i.repository_id,i.snapshot_id,i.subject_id,i.projection_id,i.item_key,i.facet_kind,i.grounding_set_id,i.scope_kind,i.anchor_subject_id,i.method_code,i.payload_fingerprint,
 (coalesce((SELECT sum(octet_length(v)) FROM unnest(i.limitations) v),0)+coalesce(octet_length(i.summary_text),0))::bigint AS descriptive_bytes FROM gov_repo.sr2_summary_facets_v1 i
 UNION ALL
 SELECT i.organisation_id,i.repository_id,i.snapshot_id,i.subject_id,i.projection_id,i.item_key,i.facet_kind,i.grounding_set_id,i.scope_kind,i.anchor_subject_id,i.method_code,i.payload_fingerprint,
 (coalesce((SELECT sum(octet_length(v)) FROM unnest(i.limitations) v),0)+coalesce(octet_length(i.domain_key),0)+coalesce(octet_length(i.label),0)+coalesce(octet_length(i.structural_description),0))::bigint AS descriptive_bytes FROM gov_repo.sr2_domain_facets_v1 i
 UNION ALL
 SELECT i.organisation_id,i.repository_id,i.snapshot_id,i.subject_id,i.projection_id,i.item_key,i.facet_kind,i.grounding_set_id,i.scope_kind,i.anchor_subject_id,i.method_code,i.payload_fingerprint,
 (coalesce((SELECT sum(octet_length(v)) FROM unnest(i.limitations) v),0)+coalesce(octet_length(i.descriptor_key),0)+coalesce(octet_length(i.observed_role),0)+coalesce((SELECT sum(octet_length(v)) FROM unnest(i.behaviors) v),0))::bigint AS descriptive_bytes FROM gov_repo.sr2_agent_facets_v1 i
 UNION ALL
 SELECT i.organisation_id,i.repository_id,i.snapshot_id,i.subject_id,i.projection_id,i.item_key,i.facet_kind,i.grounding_set_id,i.scope_kind,i.anchor_subject_id,i.method_code,i.payload_fingerprint,
 (coalesce((SELECT sum(octet_length(v)) FROM unnest(i.limitations) v),0)+coalesce(octet_length(i.entrypoint_key),0)+coalesce(octet_length(i.safe_signature),0)+coalesce((SELECT sum(octet_length(v)) FROM unnest(i.invocation_shape) v),0))::bigint AS descriptive_bytes FROM gov_repo.sr2_entrypoint_facets_v1 i ) a WHERE a.organisation_id=NEW.organisation_id AND a.repository_id=NEW.repository_id AND a.snapshot_id=NEW.snapshot_id AND a.subject_id=NEW.subject_id AND a.projection_id=NEW.projection_id AND a.facet_kind=v_kind ORDER BY a.item_key COLLATE "C" LOOP
   IF v_locator='DOCUMENTATION_REGION' AND v_item.method_code<>'STRUCTURAL_SUMMARY' THEN
    RAISE EXCEPTION 'SR2_DOCUMENTATION_METHOD' USING ERRCODE='23514'; END IF;
   IF EXISTS (SELECT FROM gov_repo.sr2_source_set_members_v1 g WHERE g.organisation_id=NEW.organisation_id AND g.repository_id=NEW.repository_id AND g.snapshot_id=NEW.snapshot_id AND g.source_set_id=v_item.grounding_set_id
    AND NOT EXISTS (SELECT FROM gov_repo.sr2_source_set_members_v1 m WHERE m.organisation_id=NEW.organisation_id AND m.repository_id=NEW.repository_id AND m.snapshot_id=NEW.snapshot_id AND m.source_set_id=v_root.primary_source_set_id AND m.source_subject_id=g.source_subject_id)) THEN
    RAISE EXCEPTION 'SR2_ITEM_GROUNDING_SUBSET' USING ERRCODE='23514'; END IF;
   v_collection_parts:=v_collection_parts || ARRAY[v_item.item_key,v_item.payload_fingerprint];
   v_bytes:=v_bytes+v_item.descriptive_bytes;
  END LOOP;
  IF v_collection.collection_fingerprint<>pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(gov_repo.frame_identity(ARRAY['GOVIA_SR2_FACET_COLLECTION_V1']::text[] || (v_collection_parts)), 'UTF8')), 'hex') THEN
   RAISE EXCEPTION 'SR2_COLLECTION_HASH' USING ERRCODE='23514'; END IF;
  v_parts:=v_parts || ARRAY['1',v_count::text,v_collection.collection_fingerprint];
 END LOOP;
 FOR v_fragment IN SELECT * FROM gov_repo.sr2_fragments_v1 f WHERE f.organisation_id=NEW.organisation_id AND f.repository_id=NEW.repository_id AND f.snapshot_id=NEW.snapshot_id AND f.subject_id=NEW.subject_id AND f.projection_id=NEW.projection_id ORDER BY ordinal LOOP
  v_ordinal:=v_ordinal+1;
  IF v_fragment.ordinal<>v_ordinal OR NOT EXISTS (SELECT FROM gov_repo.sr2_source_set_members_v1 m WHERE m.organisation_id=NEW.organisation_id AND m.repository_id=NEW.repository_id AND m.snapshot_id=NEW.snapshot_id AND m.source_set_id=v_root.primary_source_set_id AND m.source_subject_id=v_fragment.source_subject_id) THEN
   RAISE EXCEPTION 'SR2_FRAGMENT_GROUNDING_ORDER' USING ERRCODE='23514'; END IF;
  v_parts:=v_parts || ARRAY[v_fragment.ordinal::text,v_fragment.fragment_kind,v_fragment.source_subject_id,v_fragment.projected_text,v_fragment.projection_mark,CASE WHEN v_fragment.untrusted_source THEN '1' ELSE '0' END];
  v_bytes:=v_bytes+octet_length(v_fragment.projected_text);
 END LOOP;
 -- A typed reference record is framed before DISTINCT: an admission UUID/hash cannot alias a source or set.
 SELECT count(*) INTO v_refs FROM (
  SELECT gov_repo.frame_identity(ARRAY['SUBJECT',NEW.subject_id]) AS reference
  UNION SELECT gov_repo.frame_identity(ARRAY['SUBJECT',m.source_subject_id]) FROM gov_repo.sr2_source_set_members_v1 m WHERE m.organisation_id=NEW.organisation_id AND m.repository_id=NEW.repository_id AND m.snapshot_id=NEW.snapshot_id AND m.source_set_id=v_root.primary_source_set_id
  UNION SELECT gov_repo.frame_identity(ARRAY['SET',v_root.primary_source_set_id])
  UNION SELECT gov_repo.frame_identity(ARRAY['SET',a.grounding_set_id]) FROM ( SELECT i.organisation_id,i.repository_id,i.snapshot_id,i.subject_id,i.projection_id,i.item_key,i.facet_kind,i.grounding_set_id,i.scope_kind,i.anchor_subject_id,i.method_code,i.payload_fingerprint,
 (coalesce((SELECT sum(octet_length(v)) FROM unnest(i.limitations) v),0)+coalesce(octet_length(i.module_key),0)+coalesce(octet_length(i.directory_label),0)+coalesce(octet_length(i.module_name),0))::bigint AS descriptive_bytes FROM gov_repo.sr2_module_facets_v1 i
 UNION ALL
 SELECT i.organisation_id,i.repository_id,i.snapshot_id,i.subject_id,i.projection_id,i.item_key,i.facet_kind,i.grounding_set_id,i.scope_kind,i.anchor_subject_id,i.method_code,i.payload_fingerprint,
 (coalesce((SELECT sum(octet_length(v)) FROM unnest(i.limitations) v),0)+coalesce(octet_length(i.service_key),0)+coalesce(octet_length(i.service_name),0)+coalesce((SELECT sum(octet_length(v)) FROM unnest(i.capabilities) v),0))::bigint AS descriptive_bytes FROM gov_repo.sr2_service_facets_v1 i
 UNION ALL
 SELECT i.organisation_id,i.repository_id,i.snapshot_id,i.subject_id,i.projection_id,i.item_key,i.facet_kind,i.grounding_set_id,i.scope_kind,i.anchor_subject_id,i.method_code,i.payload_fingerprint,
 (coalesce((SELECT sum(octet_length(v)) FROM unnest(i.limitations) v),0)+coalesce(octet_length(i.dependency_name),0)+coalesce(octet_length(i.resolution_key),0)+coalesce(octet_length(i.observed_specification),0)+coalesce(octet_length(i.resolved_version),0))::bigint AS descriptive_bytes FROM gov_repo.sr2_dependency_facets_v1 i
 UNION ALL
 SELECT i.organisation_id,i.repository_id,i.snapshot_id,i.subject_id,i.projection_id,i.item_key,i.facet_kind,i.grounding_set_id,i.scope_kind,i.anchor_subject_id,i.method_code,i.payload_fingerprint,
 (coalesce((SELECT sum(octet_length(v)) FROM unnest(i.limitations) v),0)+coalesce(octet_length(i.configuration_key),0))::bigint AS descriptive_bytes FROM gov_repo.sr2_configuration_facets_v1 i
 UNION ALL
 SELECT i.organisation_id,i.repository_id,i.snapshot_id,i.subject_id,i.projection_id,i.item_key,i.facet_kind,i.grounding_set_id,i.scope_kind,i.anchor_subject_id,i.method_code,i.payload_fingerprint,
 (coalesce((SELECT sum(octet_length(v)) FROM unnest(i.limitations) v),0)+coalesce(octet_length(i.summary_text),0))::bigint AS descriptive_bytes FROM gov_repo.sr2_summary_facets_v1 i
 UNION ALL
 SELECT i.organisation_id,i.repository_id,i.snapshot_id,i.subject_id,i.projection_id,i.item_key,i.facet_kind,i.grounding_set_id,i.scope_kind,i.anchor_subject_id,i.method_code,i.payload_fingerprint,
 (coalesce((SELECT sum(octet_length(v)) FROM unnest(i.limitations) v),0)+coalesce(octet_length(i.domain_key),0)+coalesce(octet_length(i.label),0)+coalesce(octet_length(i.structural_description),0))::bigint AS descriptive_bytes FROM gov_repo.sr2_domain_facets_v1 i
 UNION ALL
 SELECT i.organisation_id,i.repository_id,i.snapshot_id,i.subject_id,i.projection_id,i.item_key,i.facet_kind,i.grounding_set_id,i.scope_kind,i.anchor_subject_id,i.method_code,i.payload_fingerprint,
 (coalesce((SELECT sum(octet_length(v)) FROM unnest(i.limitations) v),0)+coalesce(octet_length(i.descriptor_key),0)+coalesce(octet_length(i.observed_role),0)+coalesce((SELECT sum(octet_length(v)) FROM unnest(i.behaviors) v),0))::bigint AS descriptive_bytes FROM gov_repo.sr2_agent_facets_v1 i
 UNION ALL
 SELECT i.organisation_id,i.repository_id,i.snapshot_id,i.subject_id,i.projection_id,i.item_key,i.facet_kind,i.grounding_set_id,i.scope_kind,i.anchor_subject_id,i.method_code,i.payload_fingerprint,
 (coalesce((SELECT sum(octet_length(v)) FROM unnest(i.limitations) v),0)+coalesce(octet_length(i.entrypoint_key),0)+coalesce(octet_length(i.safe_signature),0)+coalesce((SELECT sum(octet_length(v)) FROM unnest(i.invocation_shape) v),0))::bigint AS descriptive_bytes FROM gov_repo.sr2_entrypoint_facets_v1 i ) a WHERE a.organisation_id=NEW.organisation_id AND a.repository_id=NEW.repository_id AND a.snapshot_id=NEW.snapshot_id AND a.subject_id=NEW.subject_id AND a.projection_id=NEW.projection_id
  UNION SELECT gov_repo.frame_identity(ARRAY['ADMISSION',s.entry_id,s.source_admission_id]) FROM gov_repo.sr2_projection_sources_v1 s WHERE s.organisation_id=NEW.organisation_id AND s.repository_id=NEW.repository_id AND s.snapshot_id=NEW.snapshot_id AND s.subject_id=NEW.subject_id AND s.projection_id=NEW.projection_id
  UNION SELECT gov_repo.frame_identity(ARRAY['CAPTURE',a.capture_id::text]) FROM gov_repo.sr2_projection_sources_v1 s JOIN gov_repo.sr2_source_admissions_v1 a
   ON s.organisation_id=a.organisation_id AND s.repository_id=a.repository_id AND s.snapshot_id=a.snapshot_id AND s.entry_id=a.entry_id AND s.source_admission_id=a.source_admission_id WHERE s.organisation_id=NEW.organisation_id AND s.repository_id=NEW.repository_id AND s.snapshot_id=NEW.snapshot_id AND s.subject_id=NEW.subject_id AND s.projection_id=NEW.projection_id
 ) dictionary;
 IF v_bytes>4096 OR v_refs>99 THEN RAISE EXCEPTION 'SR2_PROJECTION_BOUND' USING ERRCODE='23514'; END IF;
 IF v_root.projection_fingerprint<>pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(gov_repo.frame_identity(ARRAY['GOVIA_SR2_PROJECTION_CONTENT_V1']::text[] || (v_parts)), 'UTF8')), 'hex') THEN RAISE EXCEPTION 'SR2_PROJECTION_CONTENT_HASH' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END
$function$;
ALTER FUNCTION gov_repo.sr2_list_valid_v1(text[],integer) OWNER TO postgres;
REVOKE ALL ON FUNCTION gov_repo.sr2_list_valid_v1(text[],integer) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION gov_repo.sr2_immutable_v1() OWNER TO postgres;
REVOKE ALL ON FUNCTION gov_repo.sr2_immutable_v1() FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION gov_repo.sr2_repository_guard_v1() OWNER TO postgres;
REVOKE ALL ON FUNCTION gov_repo.sr2_repository_guard_v1() FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION gov_repo.sr2_capture_guard_v1() OWNER TO postgres;
REVOKE ALL ON FUNCTION gov_repo.sr2_capture_guard_v1() FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION gov_repo.sr2_record_time_guard_v1() OWNER TO postgres;
REVOKE ALL ON FUNCTION gov_repo.sr2_record_time_guard_v1() FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION gov_repo.sr2_manifest_lock_v1() OWNER TO postgres;
REVOKE ALL ON FUNCTION gov_repo.sr2_manifest_lock_v1() FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION gov_repo.sr2_source_set_lock_v1() OWNER TO postgres;
REVOKE ALL ON FUNCTION gov_repo.sr2_source_set_lock_v1() FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION gov_repo.sr2_projection_lock_v1() OWNER TO postgres;
REVOKE ALL ON FUNCTION gov_repo.sr2_projection_lock_v1() FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION gov_repo.sr2_manifest_integrity_v1() OWNER TO postgres;
REVOKE ALL ON FUNCTION gov_repo.sr2_manifest_integrity_v1() FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION gov_repo.sr2_source_set_integrity_v1() OWNER TO postgres;
REVOKE ALL ON FUNCTION gov_repo.sr2_source_set_integrity_v1() FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION gov_repo.sr2_projection_integrity_v1() OWNER TO postgres;
REVOKE ALL ON FUNCTION gov_repo.sr2_projection_integrity_v1() FROM PUBLIC,anon,authenticated,service_role;

CREATE TRIGGER sr2_repositories_v1_immutable
 BEFORE UPDATE OR DELETE OR TRUNCATE ON gov_repo.sr2_repositories_v1
 FOR EACH STATEMENT EXECUTE FUNCTION gov_repo.sr2_immutable_v1();
ALTER TABLE gov_repo.sr2_repositories_v1 ENABLE ALWAYS TRIGGER sr2_repositories_v1_immutable;

CREATE TRIGGER sr2_snapshots_v1_immutable
 BEFORE UPDATE OR DELETE OR TRUNCATE ON gov_repo.sr2_snapshots_v1
 FOR EACH STATEMENT EXECUTE FUNCTION gov_repo.sr2_immutable_v1();
ALTER TABLE gov_repo.sr2_snapshots_v1 ENABLE ALWAYS TRIGGER sr2_snapshots_v1_immutable;

CREATE TRIGGER sr2_captures_v1_immutable
 BEFORE UPDATE OR DELETE OR TRUNCATE ON gov_repo.sr2_captures_v1
 FOR EACH STATEMENT EXECUTE FUNCTION gov_repo.sr2_immutable_v1();
ALTER TABLE gov_repo.sr2_captures_v1 ENABLE ALWAYS TRIGGER sr2_captures_v1_immutable;

CREATE TRIGGER sr2_manifest_entries_v1_immutable
 BEFORE UPDATE OR DELETE OR TRUNCATE ON gov_repo.sr2_manifest_entries_v1
 FOR EACH STATEMENT EXECUTE FUNCTION gov_repo.sr2_immutable_v1();
ALTER TABLE gov_repo.sr2_manifest_entries_v1 ENABLE ALWAYS TRIGGER sr2_manifest_entries_v1_immutable;

CREATE TRIGGER sr2_chunk_locators_v1_immutable
 BEFORE UPDATE OR DELETE OR TRUNCATE ON gov_repo.sr2_chunk_locators_v1
 FOR EACH STATEMENT EXECUTE FUNCTION gov_repo.sr2_immutable_v1();
ALTER TABLE gov_repo.sr2_chunk_locators_v1 ENABLE ALWAYS TRIGGER sr2_chunk_locators_v1_immutable;

CREATE TRIGGER sr2_symbol_locators_v1_immutable
 BEFORE UPDATE OR DELETE OR TRUNCATE ON gov_repo.sr2_symbol_locators_v1
 FOR EACH STATEMENT EXECUTE FUNCTION gov_repo.sr2_immutable_v1();
ALTER TABLE gov_repo.sr2_symbol_locators_v1 ENABLE ALWAYS TRIGGER sr2_symbol_locators_v1_immutable;

CREATE TRIGGER sr2_subjects_v1_immutable
 BEFORE UPDATE OR DELETE OR TRUNCATE ON gov_repo.sr2_subjects_v1
 FOR EACH STATEMENT EXECUTE FUNCTION gov_repo.sr2_immutable_v1();
ALTER TABLE gov_repo.sr2_subjects_v1 ENABLE ALWAYS TRIGGER sr2_subjects_v1_immutable;

CREATE TRIGGER sr2_source_admissions_v1_immutable
 BEFORE UPDATE OR DELETE OR TRUNCATE ON gov_repo.sr2_source_admissions_v1
 FOR EACH STATEMENT EXECUTE FUNCTION gov_repo.sr2_immutable_v1();
ALTER TABLE gov_repo.sr2_source_admissions_v1 ENABLE ALWAYS TRIGGER sr2_source_admissions_v1_immutable;

CREATE TRIGGER sr2_source_sets_v1_immutable
 BEFORE UPDATE OR DELETE OR TRUNCATE ON gov_repo.sr2_source_sets_v1
 FOR EACH STATEMENT EXECUTE FUNCTION gov_repo.sr2_immutable_v1();
ALTER TABLE gov_repo.sr2_source_sets_v1 ENABLE ALWAYS TRIGGER sr2_source_sets_v1_immutable;

CREATE TRIGGER sr2_source_set_members_v1_immutable
 BEFORE UPDATE OR DELETE OR TRUNCATE ON gov_repo.sr2_source_set_members_v1
 FOR EACH STATEMENT EXECUTE FUNCTION gov_repo.sr2_immutable_v1();
ALTER TABLE gov_repo.sr2_source_set_members_v1 ENABLE ALWAYS TRIGGER sr2_source_set_members_v1_immutable;

CREATE TRIGGER sr2_projections_v1_immutable
 BEFORE UPDATE OR DELETE OR TRUNCATE ON gov_repo.sr2_projections_v1
 FOR EACH STATEMENT EXECUTE FUNCTION gov_repo.sr2_immutable_v1();
ALTER TABLE gov_repo.sr2_projections_v1 ENABLE ALWAYS TRIGGER sr2_projections_v1_immutable;

CREATE TRIGGER sr2_protected_projections_v1_immutable
 BEFORE UPDATE OR DELETE OR TRUNCATE ON gov_repo.sr2_protected_projections_v1
 FOR EACH STATEMENT EXECUTE FUNCTION gov_repo.sr2_immutable_v1();
ALTER TABLE gov_repo.sr2_protected_projections_v1 ENABLE ALWAYS TRIGGER sr2_protected_projections_v1_immutable;

CREATE TRIGGER sr2_projection_sources_v1_immutable
 BEFORE UPDATE OR DELETE OR TRUNCATE ON gov_repo.sr2_projection_sources_v1
 FOR EACH STATEMENT EXECUTE FUNCTION gov_repo.sr2_immutable_v1();
ALTER TABLE gov_repo.sr2_projection_sources_v1 ENABLE ALWAYS TRIGGER sr2_projection_sources_v1_immutable;

CREATE TRIGGER sr2_facet_collections_v1_immutable
 BEFORE UPDATE OR DELETE OR TRUNCATE ON gov_repo.sr2_facet_collections_v1
 FOR EACH STATEMENT EXECUTE FUNCTION gov_repo.sr2_immutable_v1();
ALTER TABLE gov_repo.sr2_facet_collections_v1 ENABLE ALWAYS TRIGGER sr2_facet_collections_v1_immutable;

CREATE TRIGGER sr2_module_facets_v1_immutable
 BEFORE UPDATE OR DELETE OR TRUNCATE ON gov_repo.sr2_module_facets_v1
 FOR EACH STATEMENT EXECUTE FUNCTION gov_repo.sr2_immutable_v1();
ALTER TABLE gov_repo.sr2_module_facets_v1 ENABLE ALWAYS TRIGGER sr2_module_facets_v1_immutable;

CREATE TRIGGER sr2_service_facets_v1_immutable
 BEFORE UPDATE OR DELETE OR TRUNCATE ON gov_repo.sr2_service_facets_v1
 FOR EACH STATEMENT EXECUTE FUNCTION gov_repo.sr2_immutable_v1();
ALTER TABLE gov_repo.sr2_service_facets_v1 ENABLE ALWAYS TRIGGER sr2_service_facets_v1_immutable;

CREATE TRIGGER sr2_dependency_facets_v1_immutable
 BEFORE UPDATE OR DELETE OR TRUNCATE ON gov_repo.sr2_dependency_facets_v1
 FOR EACH STATEMENT EXECUTE FUNCTION gov_repo.sr2_immutable_v1();
ALTER TABLE gov_repo.sr2_dependency_facets_v1 ENABLE ALWAYS TRIGGER sr2_dependency_facets_v1_immutable;

CREATE TRIGGER sr2_configuration_facets_v1_immutable
 BEFORE UPDATE OR DELETE OR TRUNCATE ON gov_repo.sr2_configuration_facets_v1
 FOR EACH STATEMENT EXECUTE FUNCTION gov_repo.sr2_immutable_v1();
ALTER TABLE gov_repo.sr2_configuration_facets_v1 ENABLE ALWAYS TRIGGER sr2_configuration_facets_v1_immutable;

CREATE TRIGGER sr2_summary_facets_v1_immutable
 BEFORE UPDATE OR DELETE OR TRUNCATE ON gov_repo.sr2_summary_facets_v1
 FOR EACH STATEMENT EXECUTE FUNCTION gov_repo.sr2_immutable_v1();
ALTER TABLE gov_repo.sr2_summary_facets_v1 ENABLE ALWAYS TRIGGER sr2_summary_facets_v1_immutable;

CREATE TRIGGER sr2_domain_facets_v1_immutable
 BEFORE UPDATE OR DELETE OR TRUNCATE ON gov_repo.sr2_domain_facets_v1
 FOR EACH STATEMENT EXECUTE FUNCTION gov_repo.sr2_immutable_v1();
ALTER TABLE gov_repo.sr2_domain_facets_v1 ENABLE ALWAYS TRIGGER sr2_domain_facets_v1_immutable;

CREATE TRIGGER sr2_agent_facets_v1_immutable
 BEFORE UPDATE OR DELETE OR TRUNCATE ON gov_repo.sr2_agent_facets_v1
 FOR EACH STATEMENT EXECUTE FUNCTION gov_repo.sr2_immutable_v1();
ALTER TABLE gov_repo.sr2_agent_facets_v1 ENABLE ALWAYS TRIGGER sr2_agent_facets_v1_immutable;

CREATE TRIGGER sr2_entrypoint_facets_v1_immutable
 BEFORE UPDATE OR DELETE OR TRUNCATE ON gov_repo.sr2_entrypoint_facets_v1
 FOR EACH STATEMENT EXECUTE FUNCTION gov_repo.sr2_immutable_v1();
ALTER TABLE gov_repo.sr2_entrypoint_facets_v1 ENABLE ALWAYS TRIGGER sr2_entrypoint_facets_v1_immutable;

CREATE TRIGGER sr2_fragments_v1_immutable
 BEFORE UPDATE OR DELETE OR TRUNCATE ON gov_repo.sr2_fragments_v1
 FOR EACH STATEMENT EXECUTE FUNCTION gov_repo.sr2_immutable_v1();
ALTER TABLE gov_repo.sr2_fragments_v1 ENABLE ALWAYS TRIGGER sr2_fragments_v1_immutable;

CREATE TRIGGER sr2_representations_v1_immutable
 BEFORE UPDATE OR DELETE OR TRUNCATE ON gov_repo.sr2_representations_v1
 FOR EACH STATEMENT EXECUTE FUNCTION gov_repo.sr2_immutable_v1();
ALTER TABLE gov_repo.sr2_representations_v1 ENABLE ALWAYS TRIGGER sr2_representations_v1_immutable;

CREATE TRIGGER sr2_snapshots_v1_manifest_lock
 BEFORE INSERT ON gov_repo.sr2_snapshots_v1
 FOR EACH ROW EXECUTE FUNCTION gov_repo.sr2_manifest_lock_v1();
ALTER TABLE gov_repo.sr2_snapshots_v1 ENABLE ALWAYS TRIGGER sr2_snapshots_v1_manifest_lock;

CREATE CONSTRAINT TRIGGER sr2_snapshots_v1_manifest_integrity
 AFTER INSERT ON gov_repo.sr2_snapshots_v1
 DEFERRABLE INITIALLY DEFERRED
 FOR EACH ROW EXECUTE FUNCTION gov_repo.sr2_manifest_integrity_v1();
ALTER TABLE gov_repo.sr2_snapshots_v1 ENABLE ALWAYS TRIGGER sr2_snapshots_v1_manifest_integrity;

CREATE TRIGGER sr2_manifest_entries_v1_manifest_lock
 BEFORE INSERT ON gov_repo.sr2_manifest_entries_v1
 FOR EACH ROW EXECUTE FUNCTION gov_repo.sr2_manifest_lock_v1();
ALTER TABLE gov_repo.sr2_manifest_entries_v1 ENABLE ALWAYS TRIGGER sr2_manifest_entries_v1_manifest_lock;

CREATE CONSTRAINT TRIGGER sr2_manifest_entries_v1_manifest_integrity
 AFTER INSERT ON gov_repo.sr2_manifest_entries_v1
 DEFERRABLE INITIALLY DEFERRED
 FOR EACH ROW EXECUTE FUNCTION gov_repo.sr2_manifest_integrity_v1();
ALTER TABLE gov_repo.sr2_manifest_entries_v1 ENABLE ALWAYS TRIGGER sr2_manifest_entries_v1_manifest_integrity;

CREATE TRIGGER sr2_source_sets_v1_source_set_lock
 BEFORE INSERT ON gov_repo.sr2_source_sets_v1
 FOR EACH ROW EXECUTE FUNCTION gov_repo.sr2_source_set_lock_v1();
ALTER TABLE gov_repo.sr2_source_sets_v1 ENABLE ALWAYS TRIGGER sr2_source_sets_v1_source_set_lock;

CREATE CONSTRAINT TRIGGER sr2_source_sets_v1_source_set_integrity
 AFTER INSERT ON gov_repo.sr2_source_sets_v1
 DEFERRABLE INITIALLY DEFERRED
 FOR EACH ROW EXECUTE FUNCTION gov_repo.sr2_source_set_integrity_v1();
ALTER TABLE gov_repo.sr2_source_sets_v1 ENABLE ALWAYS TRIGGER sr2_source_sets_v1_source_set_integrity;

CREATE TRIGGER sr2_source_set_members_v1_source_set_lock
 BEFORE INSERT ON gov_repo.sr2_source_set_members_v1
 FOR EACH ROW EXECUTE FUNCTION gov_repo.sr2_source_set_lock_v1();
ALTER TABLE gov_repo.sr2_source_set_members_v1 ENABLE ALWAYS TRIGGER sr2_source_set_members_v1_source_set_lock;

CREATE CONSTRAINT TRIGGER sr2_source_set_members_v1_source_set_integrity
 AFTER INSERT ON gov_repo.sr2_source_set_members_v1
 DEFERRABLE INITIALLY DEFERRED
 FOR EACH ROW EXECUTE FUNCTION gov_repo.sr2_source_set_integrity_v1();
ALTER TABLE gov_repo.sr2_source_set_members_v1 ENABLE ALWAYS TRIGGER sr2_source_set_members_v1_source_set_integrity;

CREATE TRIGGER sr2_projections_v1_projection_lock
 BEFORE INSERT ON gov_repo.sr2_projections_v1
 FOR EACH ROW EXECUTE FUNCTION gov_repo.sr2_projection_lock_v1();
ALTER TABLE gov_repo.sr2_projections_v1 ENABLE ALWAYS TRIGGER sr2_projections_v1_projection_lock;

CREATE CONSTRAINT TRIGGER sr2_projections_v1_projection_integrity
 AFTER INSERT ON gov_repo.sr2_projections_v1
 DEFERRABLE INITIALLY DEFERRED
 FOR EACH ROW EXECUTE FUNCTION gov_repo.sr2_projection_integrity_v1();
ALTER TABLE gov_repo.sr2_projections_v1 ENABLE ALWAYS TRIGGER sr2_projections_v1_projection_integrity;

CREATE TRIGGER sr2_projection_sources_v1_projection_lock
 BEFORE INSERT ON gov_repo.sr2_projection_sources_v1
 FOR EACH ROW EXECUTE FUNCTION gov_repo.sr2_projection_lock_v1();
ALTER TABLE gov_repo.sr2_projection_sources_v1 ENABLE ALWAYS TRIGGER sr2_projection_sources_v1_projection_lock;

CREATE CONSTRAINT TRIGGER sr2_projection_sources_v1_projection_integrity
 AFTER INSERT ON gov_repo.sr2_projection_sources_v1
 DEFERRABLE INITIALLY DEFERRED
 FOR EACH ROW EXECUTE FUNCTION gov_repo.sr2_projection_integrity_v1();
ALTER TABLE gov_repo.sr2_projection_sources_v1 ENABLE ALWAYS TRIGGER sr2_projection_sources_v1_projection_integrity;

CREATE TRIGGER sr2_facet_collections_v1_projection_lock
 BEFORE INSERT ON gov_repo.sr2_facet_collections_v1
 FOR EACH ROW EXECUTE FUNCTION gov_repo.sr2_projection_lock_v1();
ALTER TABLE gov_repo.sr2_facet_collections_v1 ENABLE ALWAYS TRIGGER sr2_facet_collections_v1_projection_lock;

CREATE CONSTRAINT TRIGGER sr2_facet_collections_v1_projection_integrity
 AFTER INSERT ON gov_repo.sr2_facet_collections_v1
 DEFERRABLE INITIALLY DEFERRED
 FOR EACH ROW EXECUTE FUNCTION gov_repo.sr2_projection_integrity_v1();
ALTER TABLE gov_repo.sr2_facet_collections_v1 ENABLE ALWAYS TRIGGER sr2_facet_collections_v1_projection_integrity;

CREATE TRIGGER sr2_module_facets_v1_projection_lock
 BEFORE INSERT ON gov_repo.sr2_module_facets_v1
 FOR EACH ROW EXECUTE FUNCTION gov_repo.sr2_projection_lock_v1();
ALTER TABLE gov_repo.sr2_module_facets_v1 ENABLE ALWAYS TRIGGER sr2_module_facets_v1_projection_lock;

CREATE CONSTRAINT TRIGGER sr2_module_facets_v1_projection_integrity
 AFTER INSERT ON gov_repo.sr2_module_facets_v1
 DEFERRABLE INITIALLY DEFERRED
 FOR EACH ROW EXECUTE FUNCTION gov_repo.sr2_projection_integrity_v1();
ALTER TABLE gov_repo.sr2_module_facets_v1 ENABLE ALWAYS TRIGGER sr2_module_facets_v1_projection_integrity;

CREATE TRIGGER sr2_service_facets_v1_projection_lock
 BEFORE INSERT ON gov_repo.sr2_service_facets_v1
 FOR EACH ROW EXECUTE FUNCTION gov_repo.sr2_projection_lock_v1();
ALTER TABLE gov_repo.sr2_service_facets_v1 ENABLE ALWAYS TRIGGER sr2_service_facets_v1_projection_lock;

CREATE CONSTRAINT TRIGGER sr2_service_facets_v1_projection_integrity
 AFTER INSERT ON gov_repo.sr2_service_facets_v1
 DEFERRABLE INITIALLY DEFERRED
 FOR EACH ROW EXECUTE FUNCTION gov_repo.sr2_projection_integrity_v1();
ALTER TABLE gov_repo.sr2_service_facets_v1 ENABLE ALWAYS TRIGGER sr2_service_facets_v1_projection_integrity;

CREATE TRIGGER sr2_dependency_facets_v1_projection_lock
 BEFORE INSERT ON gov_repo.sr2_dependency_facets_v1
 FOR EACH ROW EXECUTE FUNCTION gov_repo.sr2_projection_lock_v1();
ALTER TABLE gov_repo.sr2_dependency_facets_v1 ENABLE ALWAYS TRIGGER sr2_dependency_facets_v1_projection_lock;

CREATE CONSTRAINT TRIGGER sr2_dependency_facets_v1_projection_integrity
 AFTER INSERT ON gov_repo.sr2_dependency_facets_v1
 DEFERRABLE INITIALLY DEFERRED
 FOR EACH ROW EXECUTE FUNCTION gov_repo.sr2_projection_integrity_v1();
ALTER TABLE gov_repo.sr2_dependency_facets_v1 ENABLE ALWAYS TRIGGER sr2_dependency_facets_v1_projection_integrity;

CREATE TRIGGER sr2_configuration_facets_v1_projection_lock
 BEFORE INSERT ON gov_repo.sr2_configuration_facets_v1
 FOR EACH ROW EXECUTE FUNCTION gov_repo.sr2_projection_lock_v1();
ALTER TABLE gov_repo.sr2_configuration_facets_v1 ENABLE ALWAYS TRIGGER sr2_configuration_facets_v1_projection_lock;

CREATE CONSTRAINT TRIGGER sr2_configuration_facets_v1_projection_integrity
 AFTER INSERT ON gov_repo.sr2_configuration_facets_v1
 DEFERRABLE INITIALLY DEFERRED
 FOR EACH ROW EXECUTE FUNCTION gov_repo.sr2_projection_integrity_v1();
ALTER TABLE gov_repo.sr2_configuration_facets_v1 ENABLE ALWAYS TRIGGER sr2_configuration_facets_v1_projection_integrity;

CREATE TRIGGER sr2_domain_facets_v1_projection_lock
 BEFORE INSERT ON gov_repo.sr2_domain_facets_v1
 FOR EACH ROW EXECUTE FUNCTION gov_repo.sr2_projection_lock_v1();
ALTER TABLE gov_repo.sr2_domain_facets_v1 ENABLE ALWAYS TRIGGER sr2_domain_facets_v1_projection_lock;

CREATE CONSTRAINT TRIGGER sr2_domain_facets_v1_projection_integrity
 AFTER INSERT ON gov_repo.sr2_domain_facets_v1
 DEFERRABLE INITIALLY DEFERRED
 FOR EACH ROW EXECUTE FUNCTION gov_repo.sr2_projection_integrity_v1();
ALTER TABLE gov_repo.sr2_domain_facets_v1 ENABLE ALWAYS TRIGGER sr2_domain_facets_v1_projection_integrity;

CREATE TRIGGER sr2_agent_facets_v1_projection_lock
 BEFORE INSERT ON gov_repo.sr2_agent_facets_v1
 FOR EACH ROW EXECUTE FUNCTION gov_repo.sr2_projection_lock_v1();
ALTER TABLE gov_repo.sr2_agent_facets_v1 ENABLE ALWAYS TRIGGER sr2_agent_facets_v1_projection_lock;

CREATE CONSTRAINT TRIGGER sr2_agent_facets_v1_projection_integrity
 AFTER INSERT ON gov_repo.sr2_agent_facets_v1
 DEFERRABLE INITIALLY DEFERRED
 FOR EACH ROW EXECUTE FUNCTION gov_repo.sr2_projection_integrity_v1();
ALTER TABLE gov_repo.sr2_agent_facets_v1 ENABLE ALWAYS TRIGGER sr2_agent_facets_v1_projection_integrity;

CREATE TRIGGER sr2_entrypoint_facets_v1_projection_lock
 BEFORE INSERT ON gov_repo.sr2_entrypoint_facets_v1
 FOR EACH ROW EXECUTE FUNCTION gov_repo.sr2_projection_lock_v1();
ALTER TABLE gov_repo.sr2_entrypoint_facets_v1 ENABLE ALWAYS TRIGGER sr2_entrypoint_facets_v1_projection_lock;

CREATE CONSTRAINT TRIGGER sr2_entrypoint_facets_v1_projection_integrity
 AFTER INSERT ON gov_repo.sr2_entrypoint_facets_v1
 DEFERRABLE INITIALLY DEFERRED
 FOR EACH ROW EXECUTE FUNCTION gov_repo.sr2_projection_integrity_v1();
ALTER TABLE gov_repo.sr2_entrypoint_facets_v1 ENABLE ALWAYS TRIGGER sr2_entrypoint_facets_v1_projection_integrity;

CREATE TRIGGER sr2_fragments_v1_projection_lock
 BEFORE INSERT ON gov_repo.sr2_fragments_v1
 FOR EACH ROW EXECUTE FUNCTION gov_repo.sr2_projection_lock_v1();
ALTER TABLE gov_repo.sr2_fragments_v1 ENABLE ALWAYS TRIGGER sr2_fragments_v1_projection_lock;

CREATE CONSTRAINT TRIGGER sr2_fragments_v1_projection_integrity
 AFTER INSERT ON gov_repo.sr2_fragments_v1
 DEFERRABLE INITIALLY DEFERRED
 FOR EACH ROW EXECUTE FUNCTION gov_repo.sr2_projection_integrity_v1();
ALTER TABLE gov_repo.sr2_fragments_v1 ENABLE ALWAYS TRIGGER sr2_fragments_v1_projection_integrity;

CREATE TRIGGER sr2_repositories_v1_guard
 BEFORE INSERT ON gov_repo.sr2_repositories_v1
 FOR EACH ROW EXECUTE FUNCTION gov_repo.sr2_repository_guard_v1();
ALTER TABLE gov_repo.sr2_repositories_v1 ENABLE ALWAYS TRIGGER sr2_repositories_v1_guard;

CREATE TRIGGER sr2_captures_v1_guard
 BEFORE INSERT ON gov_repo.sr2_captures_v1
 FOR EACH ROW EXECUTE FUNCTION gov_repo.sr2_capture_guard_v1();
ALTER TABLE gov_repo.sr2_captures_v1 ENABLE ALWAYS TRIGGER sr2_captures_v1_guard;

CREATE TRIGGER sr2_source_admissions_v1_record_time
 BEFORE INSERT ON gov_repo.sr2_source_admissions_v1
 FOR EACH ROW EXECUTE FUNCTION gov_repo.sr2_record_time_guard_v1();
ALTER TABLE gov_repo.sr2_source_admissions_v1 ENABLE ALWAYS TRIGGER sr2_source_admissions_v1_record_time;

CREATE TRIGGER sr2_projections_v1_record_time
 BEFORE INSERT ON gov_repo.sr2_projections_v1
 FOR EACH ROW EXECUTE FUNCTION gov_repo.sr2_record_time_guard_v1();
ALTER TABLE gov_repo.sr2_projections_v1 ENABLE ALWAYS TRIGGER sr2_projections_v1_record_time;

CREATE TRIGGER sr2_representations_v1_record_time
 BEFORE INSERT ON gov_repo.sr2_representations_v1
 FOR EACH ROW EXECUTE FUNCTION gov_repo.sr2_record_time_guard_v1();
ALTER TABLE gov_repo.sr2_representations_v1 ENABLE ALWAYS TRIGGER sr2_representations_v1_record_time;

DO $prior_catalog_postflight$
DECLARE v_hash text; v_oid oid; v_ext name; v_proc record;
BEGIN
 SELECT encode(sha256(convert_to((SELECT coalesce(jsonb_agg(jsonb_build_object('identity',p.oid::regprocedure::text,
 'owner',pg_get_userbyid(p.proowner),'body_sha256',encode(sha256(convert_to(replace(p.prosrc,chr(13),''),'UTF8')),'hex'),
 'config',p.proconfig,'acl',p.proacl::text,'definer',p.prosecdef,'volatility',p.provolatile,'parallel',p.proparallel,
 'result',pg_get_function_result(p.oid),'language',l.lanname) ORDER BY p.oid::regprocedure::text COLLATE "C"),'[]')::text
 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_language l ON l.oid=p.prolang
 WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_%'
 AND NOT EXISTS(SELECT FROM pg_depend d WHERE d.classid='pg_proc'::regclass AND d.objid=p.oid AND d.deptype='e') AND NOT (n.nspname='gov_repo' AND p.proname IN ('semantic_context_search_v1','sr2_list_valid_v1','sr2_immutable_v1','sr2_repository_guard_v1','sr2_capture_guard_v1','sr2_record_time_guard_v1','sr2_manifest_lock_v1','sr2_source_set_lock_v1','sr2_projection_lock_v1','sr2_manifest_integrity_v1','sr2_source_set_integrity_v1','sr2_projection_integrity_v1'))),'UTF8')),'hex') INTO v_hash;
 IF v_hash<>'829230366d53be537efe3ddabab78fbe9e5ea8f2282c3e34e17f1110b4fd6e33' THEN RAISE EXCEPTION 'SR1_CLOSED_CATALOG_DRIFT' USING ERRCODE='55000'; END IF;
 SELECT n.nspname INTO v_ext FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace WHERE e.extname='vector';
 IF v_ext IS NULL OR EXISTS(SELECT FROM unnest(ARRAY['anon','authenticated','service_role']) r
   WHERE has_schema_privilege(r,v_ext,'CREATE')) THEN RAISE EXCEPTION 'SR1_UNTRUSTED_VECTOR_SCHEMA'; END IF;
 v_oid:=to_regprocedure(format('gov_repo.semantic_context_search_v1(uuid,uuid,bigint,bigint,timestamptz,%I.vector,text,text,text,integer,text,integer,double precision)',v_ext));
 IF v_oid IS NULL OR (SELECT count(*) FROM pg_proc WHERE pronamespace='gov_repo'::regnamespace AND proname='semantic_context_search_v1')<>1 THEN
   RAISE EXCEPTION 'SR1_EXACT_IDENTITY_REQUIRED' USING ERRCODE='55000'; END IF;
 SELECT * INTO v_proc FROM pg_proc WHERE oid=v_oid;
 IF pg_get_userbyid(v_proc.proowner)<>'postgres' OR NOT v_proc.prosecdef OR v_proc.provolatile<>'v'
   OR v_proc.proparallel<>'u' OR v_proc.prorettype<>'jsonb'::regtype OR v_proc.pronargdefaults<>0
   OR v_proc.prolang<>(SELECT oid FROM pg_language WHERE lanname='plpgsql') OR v_proc.proisstrict OR v_proc.proleakproof
   OR v_proc.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, pg_temp','lock_timeout=5s']
   OR encode(sha256(convert_to(replace(replace(v_proc.prosrc,chr(13),''),quote_ident(v_ext)||'.','__vector__.'),'UTF8')),'hex')<>'f01c0e4aedf049fb5a8aac886553d6f3e6b3207da9fc0c5f2d130229b7f6ab24'
   OR EXISTS(SELECT FROM aclexplode(coalesce(v_proc.proacl,acldefault('f',v_proc.proowner))) a
       WHERE a.privilege_type<>'EXECUTE' OR a.is_grantable OR a.grantee NOT IN ('postgres'::regrole,'service_role'::regrole))
   OR NOT has_function_privilege('service_role',v_oid,'EXECUTE')
   OR has_function_privilege('anon',v_oid,'EXECUTE') OR has_function_privilege('authenticated',v_oid,'EXECUTE') THEN
   RAISE EXCEPTION 'SR1_FROZEN_CAPABILITY_DRIFT' USING ERRCODE='55000'; END IF;
 -- Global and gov_repo routine defaults must never reintroduce app or PUBLIC execute.
 IF EXISTS(SELECT FROM pg_default_acl d CROSS JOIN LATERAL aclexplode(d.defaclacl) a
   WHERE d.defaclrole='postgres'::regrole AND d.defaclobjtype='f'
   AND d.defaclnamespace IN (0,'gov_repo'::regnamespace) AND a.grantee IN (0,'anon'::regrole,'authenticated'::regrole,'service_role'::regrole))
   OR NOT EXISTS(SELECT FROM pg_default_acl WHERE defaclrole='postgres'::regrole AND defaclobjtype='f' AND defaclnamespace=0)
 THEN RAISE EXCEPTION 'SR1_DEFAULT_PRIVILEGE_DRIFT' USING ERRCODE='55000'; END IF;
END $prior_catalog_postflight$;
DO $a1_postflight$
BEGIN
 IF (SELECT count(*) FROM pg_class WHERE relnamespace='gov_repo'::regnamespace AND relname LIKE 'sr2_%' AND relkind='r')<>24
 OR (SELECT count(*) FROM pg_class WHERE relnamespace='gov_repo'::regnamespace AND relname LIKE 'sr2_%' AND relkind='i')<>37
 OR (SELECT count(*) FROM pg_constraint WHERE connamespace='gov_repo'::regnamespace AND conname LIKE 'sr2_%' AND contype='c')<>74
 OR (SELECT count(*) FROM pg_constraint WHERE connamespace='gov_repo'::regnamespace AND conname LIKE 'sr2_%' AND contype='f')<>42
 OR (SELECT count(*) FROM pg_constraint WHERE connamespace='gov_repo'::regnamespace AND conname LIKE 'sr2_%' AND contype='u')<>13
 OR (SELECT count(*) FROM pg_proc WHERE pronamespace='gov_repo'::regnamespace AND proname LIKE 'sr2_%')<>11
 OR (SELECT count(*) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid WHERE c.relnamespace='gov_repo'::regnamespace AND c.relname LIKE 'sr2_%' AND NOT t.tgisinternal)<>59
 THEN RAISE EXCEPTION 'SR2_A1_CATALOG_BUDGET' USING ERRCODE='55000'; END IF;
 IF EXISTS (SELECT FROM pg_class c WHERE c.relnamespace='gov_repo'::regnamespace AND c.relname LIKE 'sr2_%' AND c.relkind='r' AND (NOT c.relrowsecurity OR c.relowner<>'postgres'::regrole))
 OR EXISTS (SELECT FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid WHERE c.relnamespace='gov_repo'::regnamespace AND c.relname LIKE 'sr2_%')
 OR EXISTS (SELECT FROM pg_class c CROSS JOIN LATERAL aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a WHERE c.relnamespace='gov_repo'::regnamespace AND c.relname LIKE 'sr2_%' AND c.relkind='r' AND a.grantee<>c.relowner)
 OR EXISTS (SELECT FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE p.pronamespace='gov_repo'::regnamespace AND p.proname LIKE 'sr2_%' AND a.grantee<>p.proowner)
 OR EXISTS (SELECT FROM pg_proc p WHERE p.pronamespace='gov_repo'::regnamespace AND p.proname LIKE 'sr2_%' AND (p.proowner<>'postgres'::regrole OR p.prosecdef OR p.proisstrict OR p.proleakproof OR p.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, pg_temp']))
 OR EXISTS (SELECT FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid WHERE c.relnamespace='gov_repo'::regnamespace AND c.relname LIKE 'sr2_%' AND NOT t.tgisinternal AND t.tgenabled<>'A')
 OR EXISTS (SELECT FROM pg_trigger WHERE tgname IN ('sr2_summary_facets_v1_projection_lock','sr2_summary_facets_v1_projection_integrity'))
 THEN RAISE EXCEPTION 'SR2_A1_PRIVATE_CONTAINMENT' USING ERRCODE='55000'; END IF;
END $a1_postflight$;
DO $function_pins$
DECLARE v_expected record; v_actual record;
BEGIN
 FOR v_expected IN SELECT * FROM (VALUES
 ('gov_repo.sr2_capture_guard_v1()','3d5d4fcfe3025c959335e0e19872c33a894996fba112b384b64250ad1da2b863','v','u'),
 ('gov_repo.sr2_immutable_v1()','c9b4dc880d08d26cd7c0d7d233193cc8c05472d94762e66bf3d79f8f74b3701e','v','u'),
 ('gov_repo.sr2_list_valid_v1(text[],integer)','5d07612ddb5c0f4e02446e3b69a7e6cc6ae5d6f79d7ae9d8031a897a1a044645','i','s'),
 ('gov_repo.sr2_manifest_integrity_v1()','3ae7d373f3bc78c936bde4319a6fb4680eec0ac6381759ac92aefd2d116a33bf','v','u'),
 ('gov_repo.sr2_manifest_lock_v1()','35bd3f0d5bf193cf4c51938854524e7f88544bdb23a53a5a0de749b12d55c00b','v','u'),
 ('gov_repo.sr2_projection_integrity_v1()','15984fb2a9a7a431a158a285ca66d486da14aef7218b9fcf38ddee2a15c953ea','v','u'),
 ('gov_repo.sr2_projection_lock_v1()','0e16cb78be1dd4215dffa5c5a43b1084feb73069e95890c7837e5614b5340144','v','u'),
 ('gov_repo.sr2_record_time_guard_v1()','6dc4e4db4fbfee4f94eb858b97dc073afcbf23a650294a22106f04c7f3b7689f','v','u'),
 ('gov_repo.sr2_repository_guard_v1()','be6da28c41eda2a1ef86b4be163080d7cbda00c0a42cdd447864d6a375107047','v','u'),
 ('gov_repo.sr2_source_set_integrity_v1()','678808cdb6857de36ff752acbdbfa9a3a2d9bef50991da1e0356b31fd2dcfa02','v','u'),
 ('gov_repo.sr2_source_set_lock_v1()','81f80e3030c8a90621d904b4649968f9b7bd5daca4591842453f63f9e1533928','v','u')
 ) AS pins(identity,body_sha256,volatility,parallel) LOOP
  SELECT p.* INTO v_actual FROM pg_proc p WHERE p.oid=to_regprocedure(v_expected.identity);
  IF NOT FOUND OR encode(sha256(convert_to(replace(v_actual.prosrc,chr(13),''),'UTF8')),'hex')<>v_expected.body_sha256
  OR v_actual.provolatile::text<>v_expected.volatility OR v_actual.proparallel::text<>v_expected.parallel
  OR v_actual.prolang<>(SELECT oid FROM pg_language WHERE lanname='plpgsql')
  OR v_actual.pronargdefaults<>0 THEN RAISE EXCEPTION 'SR2_A1_FUNCTION_PIN' USING ERRCODE='55000'; END IF;
 END LOOP;
END $function_pins$;
COMMIT;
