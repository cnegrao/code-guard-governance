-- C3-SR1. Exact successor to the CURRENT canonical M16/M17/V2 catalog.
-- Historical 22-routine evidence is unchanged. Owner exception: postgres has
-- broader rights; Carlos explicitly retained ADR section 12 and scoped 36-H
-- to the admitted static read/lock capability. No table grants/role changes.
-- Prior routine catalog manifest: tests/fixtures/semantic-retrieval-catalog-v1.json.
BEGIN;
SET LOCAL search_path=pg_catalog,public;
DO $preflight$
DECLARE v_hash text;
BEGIN
 SELECT encode(sha256(convert_to((SELECT coalesce(jsonb_agg(jsonb_build_object('identity',p.oid::regprocedure::text,
 'owner',pg_get_userbyid(p.proowner),'body_sha256',encode(sha256(convert_to(replace(p.prosrc,chr(13),''),'UTF8')),'hex'),
 'config',p.proconfig,'acl',p.proacl::text,'definer',p.prosecdef,'volatility',p.provolatile,'parallel',p.proparallel,
 'result',pg_get_function_result(p.oid),'language',l.lanname) ORDER BY p.oid::regprocedure::text COLLATE "C"),'[]')::text
 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_language l ON l.oid=p.prolang
 WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_%'
 AND NOT EXISTS(SELECT FROM pg_depend d WHERE d.classid='pg_proc'::regclass AND d.objid=p.oid AND d.deptype='e')),'UTF8')),'hex') INTO v_hash;
 IF v_hash<>'829230366d53be537efe3ddabab78fbe9e5ea8f2282c3e34e17f1110b4fd6e33' THEN RAISE EXCEPTION 'SR1_UNAPPROVED_STARTING_CATALOG' USING ERRCODE='55000'; END IF;
END $preflight$;
DO $create$
DECLARE v_ext name; v_definition text; v_sig text;
BEGIN
 SELECT n.nspname INTO STRICT v_ext FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace WHERE e.extname='vector';
 v_definition:=replace($definition$CREATE FUNCTION gov_repo.semantic_context_search_v1(
 p_verified_organisation_id uuid,p_verified_actor_user_id uuid,p_verified_session_iat bigint,
 p_verified_session_exp bigint,p_verified_credential_epoch timestamptz,p_query __vector__.vector,
 p_provider text,p_model text,p_version text,p_dimension integer,p_schema text,p_limit integer,p_threshold double precision)
 RETURNS jsonb LANGUAGE plpgsql VOLATILE PARALLEL UNSAFE SECURITY DEFINER
 SET search_path=pg_catalog,pg_temp SET lock_timeout='5s' AS $semantic$
DECLARE v_org uuid; v_result jsonb; v_space jsonb;
BEGIN
  SELECT u.organisation_id INTO v_org FROM gov_repo.governance_users u WHERE u.user_id=p_verified_actor_user_id;
  IF v_org IS NULL OR v_org IS DISTINCT FROM p_verified_organisation_id THEN
    RAISE EXCEPTION 'SEMANTIC_ACCESS_DENIED' USING ERRCODE='GV003';
  END IF;
  -- The preliminary lookup is not authority. This unchanged helper rechecks
  -- membership after ORG -> USER -> ROLES locks, held until transaction end.
  PERFORM 1 FROM gov_repo.l14_session_basis_v1(v_org,p_verified_actor_user_id,
    p_verified_session_iat,p_verified_session_exp,p_verified_credential_epoch);
  IF NOT FOUND THEN RAISE EXCEPTION 'SEMANTIC_ACCESS_DENIED' USING ERRCODE='GV003'; END IF;

  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 20 OR p_threshold IS NULL
    OR p_threshold NOT BETWEEN -1 AND 1 THEN
    RAISE EXCEPTION 'INVALID_SEMANTIC_OPTIONS' USING ERRCODE='22023';
  END IF;
  IF p_query IS NULL OR p_dimension IS NULL OR p_dimension NOT BETWEEN 1 AND 16000
    OR __vector__.vector_dims(p_query)<>p_dimension OR __vector__.vector_norm(p_query)=0
    OR __vector__.vector_norm(p_query) IN ('Infinity'::float8,'NaN'::float8)
    OR EXISTS (SELECT FROM unnest(ARRAY[p_provider,p_model,p_version,p_schema]) x
      WHERE x IS NULL OR btrim(x)='' OR octet_length(x)>512 OR lower(btrim(x)) IN ('latest','default','unknown')) THEN
    RAISE EXCEPTION 'INVALID_QUERY_EMBEDDING' USING ERRCODE='22023';
  END IF;
  v_space:=jsonb_build_object('projection_schema_version',p_schema,'provider_id',p_provider,
    'model_id',p_model,'model_version',p_version,'dimension',p_dimension);
  -- A function-local statement_timeout cannot guarantee an already running
  -- statement's deadline. Require a request/transaction deadline set BEFORE SELECT.
  IF current_setting('statement_timeout')::interval<=interval '0'
    OR current_setting('statement_timeout')::interval>interval '5 seconds' THEN
    RETURN jsonb_build_object('status','SEMANTIC_CONTEXT_UNAVAILABLE','reason','EXECUTION_BUDGET_REQUIRED',
      'embedding_space',v_space,'algorithm','EXACT_COSINE_V1','selection_policy','LATEST_RECORDED_IN_EXACT_SPACE_V1','coverage','BOUNDED_RECORDED_REPRESENTATIONS_ONLY','hits','[]'::jsonb);
  END IF;
  -- One data statement snapshot after persisted eligibility. No DML or hydration.
  WITH compatible AS MATERIALIZED (
    SELECT r.* FROM gov_repo.semantic_representations r
    WHERE r.organisation_id=v_org AND r.projection_schema_version COLLATE "C"=p_schema COLLATE "C"
      AND r.embedding_provider_id COLLATE "C"=p_provider COLLATE "C"
      AND r.embedding_model_id COLLATE "C"=p_model COLLATE "C"
      AND r.embedding_model_version COLLATE "C"=p_version COLLATE "C" AND r.embedding_dimension=p_dimension
    LIMIT 10001
  ), subjects AS MATERIALIZED (
    SELECT r.*, c.canonical_object_id AS subject_id,c.kind AS actual_kind,
      (r.subject_canonical_object_kind=c.kind AND r.subject_candidate_id IS NULL
       AND r.subject_candidate_kind IS NULL) AS valid_shape
    FROM compatible r LEFT JOIN gov_repo.canonical_objects c
      ON c.organisation_id=r.organisation_id AND c.organisation_id=v_org
      AND c.canonical_object_id=r.subject_canonical_object_id
    WHERE r.subject_kind='CANONICAL_OBJECT'
    UNION ALL
    SELECT r.*,c.candidate_id,c.candidate_kind,
      (r.subject_candidate_kind=c.candidate_kind AND r.subject_canonical_object_id IS NULL
       AND r.subject_canonical_object_kind IS NULL)
    FROM compatible r LEFT JOIN gov_repo.discovery_candidates c
      ON c.organisation_id=r.organisation_id AND c.organisation_id=v_org AND c.candidate_id=r.subject_candidate_id
    WHERE r.subject_kind='NORMALIZED_CANDIDATE'
  ), selected AS MATERIALIZED (
    SELECT DISTINCT ON (subject_kind,actual_kind,subject_id) * FROM subjects
    ORDER BY subject_kind,actual_kind,subject_id,generated_at DESC,created_at DESC,representation_id COLLATE "C" ASC
  ), supported AS MATERIALIZED (
    SELECT r.*,a.refs AS assertions,e.refs AS evidence,
      a.total+e.total AS support_count,a.invalid OR e.invalid AS invalid_support
    FROM selected r
    CROSS JOIN LATERAL (
      SELECT count(*) AS total,coalesce(bool_or(s.assertion_id IS NULL OR s.method_code IS NULL
        OR s.trust_state NOT IN ('INFERRED','DECLARED','IMPORTED','OBSERVED','VALIDATED')
        OR NOT isfinite(s.observed_at) OR NOT isfinite(s.recorded_at)
        OR octet_length(l.assertion_id)>512 OR octet_length(s.method_code)>512
        OR octet_length(s.method_version)>512),false) AS invalid,
        coalesce(jsonb_agg(jsonb_build_object('assertion_id',l.assertion_id,'method_code',s.method_code,
          'method_version',s.method_version,'trust_state',s.trust_state,'observed_at',s.observed_at,'recorded_at',s.recorded_at)
          ORDER BY l.assertion_id COLLATE "C"),'[]') AS refs
      FROM (SELECT * FROM gov_repo.semantic_representation_assertions l
        WHERE l.organisation_id=r.organisation_id AND l.organisation_id=v_org
          AND l.representation_id=r.representation_id LIMIT 101) l
      LEFT JOIN gov_repo.source_assertions s ON s.organisation_id=l.organisation_id
        AND s.organisation_id=v_org AND s.assertion_id=l.assertion_id
    ) a
    CROSS JOIN LATERAL (
      SELECT count(*) AS total,coalesce(bool_or(s.evidence_id IS NULL
        OR s.handling NOT IN ('HASH_ONLY','REDACTED','NON_SENSITIVE') OR NOT isfinite(s.captured_at)
        OR octet_length(l.evidence_id)>512 OR octet_length(s.content_hash)>512),false) AS invalid,
        coalesce(jsonb_agg(jsonb_build_object('evidence_id',l.evidence_id,'handling',s.handling,
          'content_hash',s.content_hash,'captured_at',s.captured_at) ORDER BY l.evidence_id COLLATE "C"),'[]') AS refs
      FROM (SELECT * FROM gov_repo.semantic_representation_evidence l
        WHERE l.organisation_id=r.organisation_id AND l.organisation_id=v_org
          AND l.representation_id=r.representation_id LIMIT 101) l
      LEFT JOIN gov_repo.discovery_evidence s ON s.organisation_id=l.organisation_id
        AND s.organisation_id=v_org AND s.evidence_id=l.evidence_id
    ) e
  ), fault AS MATERIALIZED (
    SELECT CASE WHEN (SELECT count(*) FROM compatible)>10000 THEN 'SCAN_BOUND'
      WHEN (SELECT count(*) FROM compatible)<>(SELECT count(*) FROM subjects)
        OR EXISTS (SELECT FROM subjects WHERE subject_id IS NULL OR actual_kind IS NULL OR valid_shape IS NOT TRUE
          OR NOT isfinite(generated_at) OR generated_at>statement_timestamp() OR NOT isfinite(created_at)
          OR created_at>statement_timestamp() OR __vector__.vector_dims(embedding)<>p_dimension
          OR __vector__.vector_norm(embedding)=0 OR __vector__.vector_norm(embedding) IN ('Infinity'::float8,'NaN'::float8)
          OR EXISTS (SELECT FROM unnest(ARRAY[representation_id,subject_id,actual_kind,content_fingerprint_algorithm,
            content_fingerprint_schema_version,content_fingerprint_value]) x WHERE x IS NULL OR btrim(x)='' OR octet_length(x)>512))
        OR EXISTS(SELECT FROM supported WHERE support_count=0 OR invalid_support) THEN 'INVALID_REPRESENTATION_SUPPORT'
      WHEN EXISTS(SELECT FROM supported WHERE support_count>100) THEN 'PROVENANCE_BOUND'
      WHEN NOT EXISTS(SELECT FROM compatible) THEN 'NO_COMPATIBLE_REPRESENTATIONS' END AS reason
  ), scoreable AS MATERIALIZED (
    -- This materialization is the arithmetic barrier: neither incompatible nor
    -- malformed/corrupt representations can reach the cosine operator.
    SELECT r.* FROM supported r WHERE (SELECT reason FROM fault) IS NULL
  ), scored AS MATERIALIZED (
    SELECT r.*,1-(embedding OPERATOR(__vector__.<=>) p_query) AS relevance FROM scoreable r
  ), ranked AS MATERIALIZED (
    SELECT *,row_number() OVER (ORDER BY relevance DESC,subject_kind COLLATE "C",actual_kind COLLATE "C",
      subject_id COLLATE "C",representation_id COLLATE "C") AS rank
    FROM scored WHERE relevance>=p_threshold
    ORDER BY relevance DESC,subject_kind COLLATE "C",actual_kind COLLATE "C",subject_id COLLATE "C",representation_id COLLATE "C"
    LIMIT p_limit
  ), documents AS (
    SELECT rank,jsonb_build_object('representation_id',representation_id,
      'subject',jsonb_build_object('family',subject_kind,'kind',actual_kind,'id',subject_id),
      'embedding_space',v_space,'fingerprint',jsonb_build_object('algorithm',content_fingerprint_algorithm,
        'schema_version',content_fingerprint_schema_version,'value',content_fingerprint_value),
      'generated_at',generated_at,'created_at',created_at,'selection_policy','LATEST_RECORDED_IN_EXACT_SPACE_V1',
      'source_freshness','UNKNOWN','retrieval_relevance',jsonb_build_object('kind','RETRIEVAL_RANK_ONLY',
        'rank',rank,'policy_version','EXACT_COSINE_V1'),
      'provenance',jsonb_build_object('assertions',assertions,'evidence',evidence),
      'source','SEMANTIC_GOVERNANCE_CONTEXT','authority','DERIVED_ANALYTICAL_NON_AUTHORITATIVE','derivation','SEMANTIC_MATCH',
      'canonical_decision',false,'governed_relationships',false,'assurance',false,
      'content_projection',jsonb_build_object('kind','SUBJECT_REFERENCE_ONLY_V1','subject_kind',subject_kind,
        'subject_kind_code',actual_kind,'subject_id',subject_id,'original_embedding_content','NOT_STORED'),
      'limitations',jsonb_build_array('NO_GOVERNANCE_CONCLUSION','SOURCE_FRESHNESS_UNKNOWN','ORIGINAL_EMBEDDING_DOCUMENT_UNAVAILABLE')) AS doc
    FROM ranked
  )
  SELECT jsonb_build_object('status',CASE WHEN f.reason IS NOT NULL THEN 'SEMANTIC_CONTEXT_UNAVAILABLE'
      WHEN NOT EXISTS(SELECT FROM ranked) THEN 'NO_MATCHES_IN_QUERIED_SEMANTIC_SPACE' ELSE 'SEMANTIC_CONTEXT_AVAILABLE' END,
    'reason',f.reason,'embedding_space',v_space,'algorithm','EXACT_COSINE_V1','selection_policy','LATEST_RECORDED_IN_EXACT_SPACE_V1','coverage','BOUNDED_RECORDED_REPRESENTATIONS_ONLY',
    'hits',coalesce((SELECT jsonb_agg(doc ORDER BY rank) FROM documents),'[]')) INTO v_result FROM fault f;
  IF octet_length(v_result::text)>262144 THEN
    RETURN jsonb_build_object('status','SEMANTIC_CONTEXT_UNAVAILABLE','reason','RESPONSE_BOUND',
      'embedding_space',v_space,'algorithm','EXACT_COSINE_V1','selection_policy','LATEST_RECORDED_IN_EXACT_SPACE_V1','coverage','BOUNDED_RECORDED_REPRESENTATIONS_ONLY','hits','[]'::jsonb);
  END IF;
  RETURN v_result;
END;
$semantic$;$definition$,'__vector__',quote_ident(v_ext));
 EXECUTE v_definition;
 v_sig:=format('gov_repo.semantic_context_search_v1(uuid,uuid,bigint,bigint,timestamptz,%I.vector,text,text,text,integer,text,integer,double precision)',v_ext);
 EXECUTE format('ALTER FUNCTION %s OWNER TO postgres',v_sig);
 EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role',v_sig);
 EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role',v_sig);
 EXECUTE format('COMMENT ON FUNCTION %s IS %L',v_sig,'C3-SR1 principal-bound reference-only analytical read; postgres owner exception; no governed write, no legacy fallback; exact cosine within complete space; request deadline <=5s required.');
END $create$;
DO $postflight$
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
END $postflight$;
COMMIT;
