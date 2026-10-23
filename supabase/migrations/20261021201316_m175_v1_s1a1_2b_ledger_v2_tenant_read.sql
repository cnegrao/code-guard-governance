-- S1A1-2B: principal-bound reads only. No activation, source/write change or Audit switch.
BEGIN;

CREATE INDEX ledger_v2_read_order ON gov_repo.ledger_tenant_entries_v2 (organisation_id,tenant_sequence DESC);
CREATE INDEX ledger_v2_legacy_read_order ON gov_repo.ledger_tenant_legacy_refs_v2 (organisation_id,source_entry_sequence DESC);

CREATE FUNCTION gov_repo.ledger_tenant_verify_v2(
  p_verified_organisation_id uuid,p_verified_actor_user_id uuid,p_verified_session_iat bigint,
  p_verified_session_exp bigint,p_verified_credential_epoch timestamptz,p_organisation_id uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,pg_temp SET lock_timeout='5s' AS $verify$
DECLARE result jsonb;
BEGIN
  -- Authorization errors deliberately remain outside the acquisition exception block.
  PERFORM 1 FROM gov_repo.l14_session_basis_v1(p_verified_organisation_id,p_verified_actor_user_id,
    p_verified_session_iat,p_verified_session_exp,p_verified_credential_epoch);
  IF p_organisation_id IS DISTINCT FROM p_verified_organisation_id THEN
    RAISE EXCEPTION 'LEDGER_V2_READ_DENIED' USING ERRCODE='GV003';
  END IF;
  BEGIN
    -- ALL integrity state, including coverage and legacy existence, shares this
    -- ONE statement snapshot. No tenant write locks; never consult the global head/verifier.
    WITH epoch AS MATERIALIZED (
      SELECT activation_id,algorithm,algorithm_version,serialization_version,activated_at,
        migration_identifier,legacy_high_watermark
      FROM gov_repo.ledger_integrity_epochs_v2 WHERE is_active LIMIT 2
    ), genesis AS MATERIALIZED (
      SELECT * FROM gov_repo.ledger_tenant_genesis_v2 WHERE organisation_id=p_organisation_id LIMIT 2
    ), head AS MATERIALIZED (
      SELECT * FROM gov_repo.ledger_tenant_heads_v2 WHERE organisation_id=p_organisation_id LIMIT 2
    ), entries AS MATERIALIZED (
      SELECT * FROM gov_repo.ledger_tenant_entries_v2 WHERE organisation_id=p_organisation_id
      ORDER BY chain_id,tenant_sequence LIMIT 10001
    ), sources AS MATERIALIZED (
      SELECT l.entry_sequence,l.entry_id,l.organisation_id,l.event_type,l.event_description,l.subject_type,
        l.subject_id,l.actor_user_id,l.actor_ip,l.actor_session_id,l.event_timestamp,l.recorded_at,l.payload
      FROM gov_repo.governance_ledger l
      WHERE l.organisation_id=p_organisation_id AND l.entry_sequence>(SELECT legacy_high_watermark FROM epoch LIMIT 1)
      ORDER BY l.entry_sequence LIMIT 10001
    ), metadata AS MATERIALIZED (
      SELECT CASE
        WHEN (SELECT count(*) FROM epoch)<>1 THEN 'ACTIVATION_UNAVAILABLE'
        WHEN EXISTS (SELECT FROM epoch WHERE algorithm<>'SHA-256' OR algorithm_version<>2 OR serialization_version<>1
          OR NOT isfinite(activated_at) OR legacy_high_watermark<0 OR length(migration_identifier)=0) THEN 'UNSUPPORTED_EPOCH'
        WHEN (SELECT count(*) FROM entries)>10000 OR (SELECT count(*) FROM sources)>10000 THEN 'SCAN_BOUND'
        WHEN (SELECT count(*) FROM genesis)>1 OR (SELECT count(*) FROM head)>1 THEN 'UNEXPECTED_METADATA'
        WHEN EXISTS (SELECT FROM head WHERE octet_length(last_tenant_hash)<>32) THEN 'UNVERIFIABLE_HEAD'
        WHEN EXISTS (SELECT FROM genesis WHERE algorithm_version<>2 OR serialization_version<>1
          OR NOT isfinite(activated_at) OR NOT isfinite(first_entry_recorded_at) OR octet_length(genesis_hash)<>32)
          OR EXISTS (SELECT FROM entries WHERE algorithm_version<>2 OR serialization_version<>1
            OR NOT isfinite(event_timestamp) OR NOT isfinite(recorded_at)
            OR octet_length(previous_tenant_hash)<>32 OR octet_length(tenant_hash)<>32) THEN 'UNSUPPORTED_ENCODING'
        WHEN ((SELECT count(*) FROM entries)>0 OR (SELECT count(*) FROM sources)>0)
          AND ((SELECT count(*) FROM genesis)<>1 OR (SELECT count(*) FROM head)<>1) THEN 'METADATA_UNAVAILABLE'
        WHEN (SELECT count(*) FROM entries)=0 AND (SELECT count(*) FROM sources)=0
          AND ((SELECT count(*) FROM genesis)>0 OR (SELECT count(*) FROM head)>0) THEN 'UNEXPECTED_EMPTY_METADATA'
        ELSE NULL END AS uncertainty
    ), walked AS MATERIALIZED (
      SELECT v.*,row_number() OVER(ORDER BY tenant_sequence) AS expected_sequence,
        lag(tenant_hash) OVER(ORDER BY tenant_sequence) AS predecessor
      FROM entries v
    ), faults AS MATERIALIZED (
      SELECT 'GENESIS_IDENTITY_OR_HASH'::text AS reason,NULL::bigint AS sequence
      FROM genesis g CROSS JOIN epoch e,metadata m WHERE m.uncertainty IS NULL AND
        (ROW(g.activation_id,g.algorithm_version,g.serialization_version,g.activated_at) IS DISTINCT FROM
          ROW(e.activation_id,e.algorithm_version,e.serialization_version,e.activated_at)
        OR g.genesis_hash IS DISTINCT FROM sha256(gov_repo.ledger_v2_genesis_bytes(
          g.organisation_id,g.chain_id,g.activation_id,g.activated_at,g.algorithm_version,g.serialization_version)))
      UNION ALL
      SELECT 'ENTRY_IDENTITY_CHAIN_OR_HASH',v.tenant_sequence FROM walked v CROSS JOIN genesis g CROSS JOIN epoch e,
        metadata m WHERE m.uncertainty IS NULL AND
        (ROW(v.organisation_id,v.chain_id,v.activation_id,v.algorithm_version,v.serialization_version) IS DISTINCT FROM
          ROW(g.organisation_id,g.chain_id,e.activation_id,e.algorithm_version,e.serialization_version)
        OR v.tenant_sequence<>v.expected_sequence
        OR v.previous_tenant_hash IS DISTINCT FROM CASE WHEN v.expected_sequence=1 THEN g.genesis_hash ELSE v.predecessor END
        OR (v.expected_sequence=1 AND v.recorded_at IS DISTINCT FROM g.first_entry_recorded_at)
        OR v.tenant_hash IS DISTINCT FROM sha256(gov_repo.ledger_v2_entry_bytes(
          v.organisation_id,v.chain_id,v.activation_id,v.tenant_sequence,v.tenant_entry_id,v.previous_tenant_hash,
          v.source_entry_id,v.event_type,v.event_description,v.subject_type,v.subject_id,v.actor_user_id,v.actor_ip,
          v.actor_session_id,v.event_timestamp,v.recorded_at,v.payload,v.algorithm_version,v.serialization_version)))
      UNION ALL
      SELECT 'SOURCE_COVERAGE_OR_CONTENT',v.tenant_sequence FROM entries v FULL JOIN sources s
        ON s.entry_sequence=v.source_entry_sequence,metadata m WHERE m.uncertainty IS NULL AND
        (v.tenant_entry_id IS NULL OR s.entry_sequence IS NULL OR
          ROW(v.organisation_id,v.source_entry_id,v.event_type,v.event_description,v.subject_type,v.subject_id,
            v.actor_user_id,v.actor_ip,v.actor_session_id,v.event_timestamp,v.recorded_at,v.payload) IS DISTINCT FROM
          ROW(s.organisation_id,s.entry_id,s.event_type::text,s.event_description,s.subject_type::text,s.subject_id,
            s.actor_user_id,s.actor_ip,s.actor_session_id,s.event_timestamp,s.recorded_at,s.payload))
      UNION ALL
      SELECT 'DUPLICATE_CAPTURE',NULL::bigint FROM metadata m WHERE m.uncertainty IS NULL AND
        ((SELECT count(*) FROM entries)<>(SELECT count(DISTINCT source_entry_sequence) FROM entries)
          OR (SELECT count(*) FROM entries)<>(SELECT count(DISTINCT tenant_entry_id) FROM entries))
      UNION ALL
      SELECT 'HEAD_MISMATCH',h.last_tenant_sequence FROM head h CROSS JOIN genesis g,metadata m
      WHERE m.uncertainty IS NULL AND
        (h.chain_id IS DISTINCT FROM g.chain_id OR h.committed_count<>(SELECT count(*) FROM entries)
          OR h.last_tenant_sequence IS DISTINCT FROM (SELECT max(tenant_sequence) FROM entries)
          OR h.last_tenant_hash IS DISTINCT FROM (SELECT tenant_hash FROM entries ORDER BY tenant_sequence DESC LIMIT 1))
    ), outcome AS MATERIALIZED (
      SELECT CASE WHEN m.uncertainty IS NOT NULL THEN 'UNKNOWN'
        WHEN EXISTS (SELECT FROM faults) THEN 'BROKEN'
        WHEN NOT EXISTS (SELECT FROM entries) THEN 'EMPTY' ELSE 'VALID' END AS status,
        coalesce(m.uncertainty,(SELECT reason FROM faults ORDER BY sequence NULLS FIRST,reason LIMIT 1)) AS reason
      FROM metadata m
    )
    SELECT jsonb_build_object('organisation_id',p_organisation_id,'status',o.status,'reason',o.reason,
      'history',CASE WHEN (SELECT count(*) FROM epoch)<>1 THEN 'UNKNOWN'
        WHEN EXISTS (SELECT FROM gov_repo.governance_ledger l WHERE l.organisation_id=p_organisation_id
          AND l.entry_sequence<=(SELECT legacy_high_watermark FROM epoch LIMIT 1)) THEN 'LEGACY_GLOBAL_ONLY'
        ELSE 'NO_LEGACY_ENTRIES' END,
      'chain_id',(SELECT chain_id FROM genesis LIMIT 1),'activation_id',(SELECT activation_id FROM epoch LIMIT 1),
      'algorithm_version',(SELECT algorithm_version FROM epoch LIMIT 1),
      'serialization_version',(SELECT serialization_version FROM epoch LIMIT 1),
      'activated_at',(SELECT activated_at FROM epoch LIMIT 1),'scope','COMPLETE_CURRENT_TENANT_V2',
      'checked_entries',CASE WHEN o.status<>'UNKNOWN' THEN (SELECT count(*)::text FROM entries) END,
      'verified_through',CASE WHEN o.status='VALID' THEN (SELECT last_tenant_sequence::text FROM head LIMIT 1) END,
      'failure_tenant_sequence',CASE WHEN o.status='BROKEN' THEN
        (SELECT sequence::text FROM faults ORDER BY sequence NULLS FIRST,reason LIMIT 1) END,
      'max_entries',10000,'integrity_meaning','RETAINED_RECORD_INTEGRITY_ONLY',
      'legacy_payload_authority','LEGACY_NON_AUTHORITATIVE') INTO result FROM outcome o;
    RETURN result;
  EXCEPTION WHEN OTHERS OR query_canceled THEN
    -- An acquisition/encoding/dependency failure is uncertainty, never corruption.
    RETURN jsonb_build_object('organisation_id',p_organisation_id,'status','UNKNOWN','history','UNKNOWN',
      'reason','ACQUISITION_UNAVAILABLE','scope','COMPLETE_CURRENT_TENANT_V2','checked_entries',NULL,
      'verified_through',NULL,'failure_tenant_sequence',NULL,'chain_id',NULL,'activation_id',NULL,
      'algorithm_version',NULL,'serialization_version',NULL,'activated_at',NULL,'max_entries',10000,
      'integrity_meaning','RETAINED_RECORD_INTEGRITY_ONLY','legacy_payload_authority','LEGACY_NON_AUTHORITATIVE');
  END;
END $verify$;

-- Private shared projection, invoker/STABLE: no extra definer or application capability.
-- Explicit allowlist: no source/global identity, hash, predecessor or QES implication.
CREATE FUNCTION gov_repo.ledger_v2_event_document(p_org uuid,p_kind text,p_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog,pg_temp AS $document$
  SELECT jsonb_build_object('kind','V2','event_id',v.tenant_entry_id,'organisation_id',v.organisation_id,
    'tenant_sequence',v.tenant_sequence::text,'event_type',v.event_type,'description',v.event_description,
    'subject_type',v.subject_type,'subject_id',v.subject_id,'actor_user_id',v.actor_user_id,
    'actor_ip',v.actor_ip,'actor_session_id',v.actor_session_id,'event_timestamp',v.event_timestamp,
    'recorded_at',v.recorded_at,'payload',v.payload,'history','V2',
    'payload_authority','RETAINED_RECORD_ONLY','legacy_payload_authority','LEGACY_NON_AUTHORITATIVE')
  FROM gov_repo.ledger_tenant_entries_v2 v
  WHERE p_kind='V2' AND v.organisation_id=p_org AND v.tenant_entry_id=p_id
  UNION ALL
  SELECT jsonb_build_object('kind','LEGACY','event_id',r.legacy_ref_id,'organisation_id',r.organisation_id,
    'tenant_sequence',NULL,'event_type',l.event_type,'description',l.event_description,
    'subject_type',l.subject_type,'subject_id',l.subject_id,'actor_user_id',l.actor_user_id,
    'actor_ip',l.actor_ip,'actor_session_id',l.actor_session_id,'event_timestamp',l.event_timestamp,
    'recorded_at',l.recorded_at,'payload',l.payload,'history','LEGACY_GLOBAL_ONLY',
    'payload_authority','LEGACY_NON_AUTHORITATIVE','legacy_payload_authority','LEGACY_NON_AUTHORITATIVE')
  FROM gov_repo.ledger_tenant_legacy_refs_v2 r JOIN gov_repo.governance_ledger l
    ON l.organisation_id=r.organisation_id AND l.entry_sequence=r.source_entry_sequence
  WHERE p_kind='LEGACY' AND r.organisation_id=p_org AND r.legacy_ref_id=p_id
$document$;

CREATE FUNCTION gov_repo.ledger_tenant_events_v2(
  p_verified_organisation_id uuid,p_verified_actor_user_id uuid,p_verified_session_iat bigint,
  p_verified_session_exp bigint,p_verified_credential_epoch timestamptz,p_organisation_id uuid,
  p_limit integer DEFAULT 50,p_cursor text DEFAULT NULL,p_event_type text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,pg_temp SET lock_timeout='5s' AS $events$
DECLARE cursor_kind text; cursor_id uuid; cursor_order bigint; result jsonb;
BEGIN
  PERFORM 1 FROM gov_repo.l14_session_basis_v1(p_verified_organisation_id,p_verified_actor_user_id,
    p_verified_session_iat,p_verified_session_exp,p_verified_credential_epoch);
  IF p_organisation_id IS DISTINCT FROM p_verified_organisation_id THEN
    RAISE EXCEPTION 'LEDGER_V2_READ_DENIED' USING ERRCODE='GV003';
  END IF;
  IF p_limit IS NULL OR p_limit<1 OR p_limit>100 OR length(p_event_type)>120 THEN
    RAISE EXCEPTION 'LEDGER_V2_INVALID_PAGE' USING ERRCODE='22023';
  END IF;
  IF p_cursor IS NOT NULL THEN
    IF p_cursor !~ '^(V2|LEGACY):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      RAISE EXCEPTION 'LEDGER_V2_INVALID_CURSOR' USING ERRCODE='22023';
    END IF;
    cursor_kind:=split_part(p_cursor,':',1); cursor_id:=split_part(p_cursor,':',2)::uuid;
    IF cursor_kind='V2' THEN
      SELECT tenant_sequence INTO cursor_order FROM gov_repo.ledger_tenant_entries_v2
        WHERE organisation_id=p_organisation_id AND tenant_entry_id=cursor_id;
    ELSE
      SELECT source_entry_sequence INTO cursor_order FROM gov_repo.ledger_tenant_legacy_refs_v2
        WHERE organisation_id=p_organisation_id AND legacy_ref_id=cursor_id;
    END IF;
    IF cursor_order IS NULL THEN
      RAISE EXCEPTION 'LEDGER_V2_INVALID_CURSOR' USING ERRCODE='22023';
    END IF;
  END IF;
  WITH v2 AS MATERIALIZED (
    SELECT 'V2'::text AS kind,tenant_entry_id AS id,tenant_sequence AS ord,2 AS phase
    FROM gov_repo.ledger_tenant_entries_v2
    WHERE organisation_id=p_organisation_id AND (p_event_type IS NULL OR event_type=p_event_type)
      AND (p_cursor IS NULL OR (cursor_kind='V2' AND tenant_sequence<cursor_order))
    ORDER BY tenant_sequence DESC LIMIT p_limit+1
  ), legacy AS MATERIALIZED (
    SELECT 'LEGACY'::text AS kind,r.legacy_ref_id AS id,r.source_entry_sequence AS ord,1 AS phase
    FROM gov_repo.ledger_tenant_legacy_refs_v2 r JOIN gov_repo.governance_ledger l
      ON l.organisation_id=r.organisation_id AND l.entry_sequence=r.source_entry_sequence
    WHERE r.organisation_id=p_organisation_id AND (p_event_type IS NULL OR l.event_type=p_event_type)
      AND (p_cursor IS NULL OR cursor_kind='V2' OR r.source_entry_sequence<cursor_order)
    ORDER BY r.source_entry_sequence DESC LIMIT p_limit+1
  ), candidates AS MATERIALIZED (
    SELECT * FROM v2 UNION ALL SELECT * FROM legacy
  ), page AS MATERIALIZED (
    SELECT * FROM candidates ORDER BY phase DESC,ord DESC LIMIT p_limit
  )
  SELECT jsonb_build_object('organisation_id',p_organisation_id,
    'events',coalesce((SELECT jsonb_agg(gov_repo.ledger_v2_event_document(p_organisation_id,kind,id)
      ORDER BY phase DESC,ord DESC) FROM page),'[]'::jsonb),
    'next_cursor',CASE WHEN (SELECT count(*) FROM candidates)>p_limit THEN
      (SELECT kind||':'||id::text FROM page ORDER BY phase,ord LIMIT 1) END) INTO result;
  RETURN result;
END $events$;

CREATE FUNCTION gov_repo.ledger_tenant_event_v2(
  p_verified_organisation_id uuid,p_verified_actor_user_id uuid,p_verified_session_iat bigint,
  p_verified_session_exp bigint,p_verified_credential_epoch timestamptz,p_organisation_id uuid,
  p_kind text,p_event_id uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,pg_temp SET lock_timeout='5s' AS $event$
BEGIN
  PERFORM 1 FROM gov_repo.l14_session_basis_v1(p_verified_organisation_id,p_verified_actor_user_id,
    p_verified_session_iat,p_verified_session_exp,p_verified_credential_epoch);
  IF p_organisation_id IS DISTINCT FROM p_verified_organisation_id THEN
    RAISE EXCEPTION 'LEDGER_V2_READ_DENIED' USING ERRCODE='GV003';
  END IF;
  IF p_kind IS NULL OR p_kind NOT IN ('V2','LEGACY') OR p_event_id IS NULL THEN
    RAISE EXCEPTION 'LEDGER_V2_INVALID_IDENTITY' USING ERRCODE='22023';
  END IF;
  RETURN gov_repo.ledger_v2_event_document(p_organisation_id,p_kind,p_event_id);
END $event$;

ALTER FUNCTION gov_repo.ledger_tenant_verify_v2(uuid,uuid,bigint,bigint,timestamptz,uuid) OWNER TO postgres;
ALTER FUNCTION gov_repo.ledger_tenant_events_v2(uuid,uuid,bigint,bigint,timestamptz,uuid,integer,text,text) OWNER TO postgres;
ALTER FUNCTION gov_repo.ledger_tenant_event_v2(uuid,uuid,bigint,bigint,timestamptz,uuid,text,uuid) OWNER TO postgres;
ALTER FUNCTION gov_repo.ledger_v2_event_document(uuid,text,uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION gov_repo.ledger_tenant_verify_v2(uuid,uuid,bigint,bigint,timestamptz,uuid),
  gov_repo.ledger_tenant_events_v2(uuid,uuid,bigint,bigint,timestamptz,uuid,integer,text,text),
  gov_repo.ledger_tenant_event_v2(uuid,uuid,bigint,bigint,timestamptz,uuid,text,uuid),
  gov_repo.ledger_v2_event_document(uuid,text,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION gov_repo.ledger_tenant_verify_v2(uuid,uuid,bigint,bigint,timestamptz,uuid),
  gov_repo.ledger_tenant_events_v2(uuid,uuid,bigint,bigint,timestamptz,uuid,integer,text,text),
  gov_repo.ledger_tenant_event_v2(uuid,uuid,bigint,bigint,timestamptz,uuid,text,uuid) TO service_role;
-- No table/column/sequence/default ACL grants. Every existing write primitive is unchanged.
COMMIT;
