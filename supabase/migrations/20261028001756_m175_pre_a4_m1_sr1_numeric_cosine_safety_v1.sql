-- M17.5 PRE-A4 M1: SR1 numerical hardening only. No persisted data/identity change.
-- Accepted body transition: frozen SR1 -> M1; a second application is a no-op.
BEGIN;
SET LOCAL search_path=pg_catalog,pg_temp;
DO $m1$
DECLARE v_ext name; v_oid oid; v_hash text; v_before jsonb; v_after jsonb; v_definition text;
BEGIN
 SELECT n.nspname INTO STRICT v_ext FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace WHERE e.extname='vector';
 IF EXISTS(SELECT FROM unnest(ARRAY['anon','authenticated','service_role']) r WHERE has_schema_privilege(r,v_ext,'CREATE')) THEN
   RAISE EXCEPTION 'SR1_M1_UNTRUSTED_VECTOR_SCHEMA' USING ERRCODE='55000'; END IF;
 IF NOT EXISTS(SELECT FROM pg_proc p JOIN pg_depend d ON d.classid='pg_proc'::regclass AND d.objid=p.oid AND d.deptype='e'
   JOIN pg_extension e ON e.oid=d.refobjid AND e.extname='vector'
   WHERE p.oid=to_regprocedure(format('%I.l2_normalize(%I.vector)',v_ext,v_ext))) THEN
   RAISE EXCEPTION 'SR1_M1_NORMALIZATION_DEPENDENCY' USING ERRCODE='55000'; END IF;
 v_oid:=to_regprocedure(format('gov_repo.semantic_context_search_v1(uuid,uuid,bigint,bigint,timestamptz,%I.vector,text,text,text,integer,text,integer,double precision)',v_ext));
 IF v_oid IS NULL OR (SELECT count(*) FROM pg_proc WHERE pronamespace='gov_repo'::regnamespace AND proname='semantic_context_search_v1')<>1 THEN
   RAISE EXCEPTION 'SR1_M1_EXACT_IDENTITY_REQUIRED' USING ERRCODE='55000'; END IF;
 SELECT to_jsonb(p)-'prosrc',encode(sha256(convert_to(replace(replace(p.prosrc,chr(13),''),quote_ident(v_ext)||'.','__vector__.'),'UTF8')),'hex')
 INTO v_before,v_hash FROM pg_proc p WHERE p.oid=v_oid;
 IF v_hash NOT IN ('f01c0e4aedf049fb5a8aac886553d6f3e6b3207da9fc0c5f2d130229b7f6ab24','311e2ceaef5088e4dc61dc78d91f2e6643298701f22fc84f0a1bc5e630a1ac87')
   OR (SELECT pg_get_userbyid(proowner)<>'postgres' OR NOT prosecdef OR provolatile<>'v' OR proparallel<>'u'
     OR prorettype<>'jsonb'::regtype OR proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, pg_temp','lock_timeout=5s']
     FROM pg_proc WHERE oid=v_oid)
   OR EXISTS(SELECT FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
     WHERE p.oid=v_oid AND (a.privilege_type<>'EXECUTE' OR a.is_grantable OR a.grantee NOT IN ('postgres'::regrole,'service_role'::regrole)))
   OR NOT has_function_privilege('service_role',v_oid,'EXECUTE')
   OR has_function_privilege('anon',v_oid,'EXECUTE') OR has_function_privilege('authenticated',v_oid,'EXECUTE') THEN
   RAISE EXCEPTION 'SR1_M1_STARTING_CAPABILITY_DRIFT' USING ERRCODE='55000'; END IF;
 v_definition:=replace($definition$CREATE OR REPLACE FUNCTION gov_repo.semantic_context_search_v1(
 p_verified_organisation_id uuid,p_verified_actor_user_id uuid,p_verified_session_iat bigint,
 p_verified_session_exp bigint,p_verified_credential_epoch timestamptz,p_query __vector__.vector,
 p_provider text,p_model text,p_version text,p_dimension integer,p_schema text,p_limit integer,p_threshold double precision)
 RETURNS jsonb LANGUAGE plpgsql VOLATILE PARALLEL UNSAFE SECURITY DEFINER
 SET search_path=pg_catalog,pg_temp SET lock_timeout='5s' AS $semantic$
DECLARE v_org uuid; v_result jsonb; v_space jsonb; v_query_unit __vector__.vector; v_numeric_invalid boolean;
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
  -- M1: normalize the admitted query once; never change persisted embeddings.
  v_query_unit := __vector__.l2_normalize(p_query);
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
    SELECT r.*,1-(__vector__.l2_normalize(embedding) OPERATOR(__vector__.<=>) v_query_unit) AS relevance FROM scoreable r
  ), numeric_invariant AS MATERIALIZED (
    -- BETWEEN also rejects PostgreSQL NaN and both infinities. Check every scored
    -- row before threshold/limit: invalid values must not disappear from the result.
    SELECT coalesce(bool_or((relevance BETWEEN -1.0 AND 1.0) IS NOT TRUE),false) AS invalid FROM scored
  ), ranked AS MATERIALIZED (
    SELECT *,row_number() OVER (ORDER BY relevance DESC,subject_kind COLLATE "C",actual_kind COLLATE "C",
      subject_id COLLATE "C",representation_id COLLATE "C") AS rank
    FROM scored WHERE NOT (SELECT invalid FROM numeric_invariant) AND relevance>=p_threshold
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
    'hits',coalesce((SELECT jsonb_agg(doc ORDER BY rank) FROM documents),'[]')), (SELECT invalid FROM numeric_invariant) INTO v_result,v_numeric_invalid FROM fault f;
  IF v_numeric_invalid THEN
    RAISE EXCEPTION 'SR1_NUMERIC_INVARIANT' USING ERRCODE='XX000';
  END IF;
  IF octet_length(v_result::text)>262144 THEN
    RETURN jsonb_build_object('status','SEMANTIC_CONTEXT_UNAVAILABLE','reason','RESPONSE_BOUND',
      'embedding_space',v_space,'algorithm','EXACT_COSINE_V1','selection_policy','LATEST_RECORDED_IN_EXACT_SPACE_V1','coverage','BOUNDED_RECORDED_REPRESENTATIONS_ONLY','hits','[]'::jsonb);
  END IF;
  RETURN v_result;
END;
$semantic$;$definition$,'__vector__',quote_ident(v_ext));
 EXECUTE v_definition;
 SELECT to_jsonb(p)-'prosrc',encode(sha256(convert_to(replace(replace(p.prosrc,chr(13),''),quote_ident(v_ext)||'.','__vector__.'),'UTF8')),'hex')
 INTO v_after,v_hash FROM pg_proc p WHERE p.oid=v_oid;
 IF v_before IS DISTINCT FROM v_after OR v_hash<>'311e2ceaef5088e4dc61dc78d91f2e6643298701f22fc84f0a1bc5e630a1ac87' THEN
   RAISE EXCEPTION 'SR1_M1_POSTFLIGHT_DRIFT' USING ERRCODE='55000'; END IF;
END $m1$;
COMMIT;
