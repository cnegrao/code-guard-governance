-- M17.5-V1-S1A1-2A. Preparation ONLY: this transaction never activates V2.
-- Applying it quarantines old application writes; explicit owner cutover follows.
BEGIN;
LOCK TABLE gov_repo.governance_ledger IN ACCESS EXCLUSIVE MODE;

DO $preflight$
BEGIN
  IF (SELECT count(*) FROM pg_proc WHERE pronamespace='gov_repo'::regnamespace AND proname='ledger_append') <> 1
    OR (SELECT encode(sha256(convert_to(replace(prosrc,chr(13),''),'UTF8')),'hex') FROM pg_proc
        WHERE oid='gov_repo.ledger_append(character varying,text,character varying,uuid,uuid,inet,uuid,jsonb)'::regprocedure)
       IS DISTINCT FROM '8137f591bdd717ef18cbdc8b6146aab349626903aa9d080cebe55806190ae830'
    OR EXISTS (SELECT FROM gov_repo.ledger_integrity_epochs_v2)
    OR EXISTS (SELECT FROM gov_repo.ledger_global_append_head_v2) THEN
    RAISE EXCEPTION 'LEDGER_V2_PREPARATION_CONTRACT' USING ERRCODE='55000';
  END IF;
END $preflight$;
-- Temporary owner membership only for replacing the existing technical-owner
-- body and its ACL; removed before commit, as in the historical R1 transfer.
GRANT govia_ledger_executor TO postgres WITH INHERIT TRUE, SET TRUE;

-- Internal primitive. Its original signature/owner/global text preimage survive.
-- No application EXECUTE, including before activation. No inactive fallback.
CREATE OR REPLACE FUNCTION gov_repo.ledger_append(
  p_event_type varchar,p_event_desc text,p_subject_type varchar,p_subject_id uuid,
  p_actor_user_id uuid,p_actor_ip inet,p_organisation_id uuid,p_payload jsonb)
RETURNS bigint LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,pg_temp SET lock_timeout='5s' AS $append$
DECLARE h gov_repo.ledger_global_append_head_v2; s bigint; n timestamptz := now(); prev text; hash text;
BEGIN
  -- Shared cutover guard; no table-level DML privilege is added to the executor.
  -- The stable row head below is still the authoritative predecessor lock.
  PERFORM pg_advisory_xact_lock(175,2);
  SELECT * INTO h FROM gov_repo.ledger_global_append_head_v2 WHERE singleton FOR UPDATE;
  IF NOT FOUND OR NOT EXISTS (SELECT FROM gov_repo.ledger_integrity_epochs_v2
      WHERE activation_id=h.activation_id AND is_active) THEN
    RAISE EXCEPTION 'LEDGER_V2_INACTIVE' USING ERRCODE='55000';
  END IF;
  prev := encode(h.last_global_hash,'hex');
  -- Frozen V1 text concatenation, including timestamptz/jsonb text semantics.
  hash := encode(sha256(convert_to(prev || p_event_type || p_subject_id::text ||
    p_actor_user_id::text || n::text || p_payload::text,'UTF8')),'hex');
  INSERT INTO gov_repo.governance_ledger(event_type,event_description,subject_type,subject_id,
    actor_user_id,actor_ip,organisation_id,event_timestamp,recorded_at,previous_hash,entry_hash,payload)
  VALUES(p_event_type,p_event_desc,p_subject_type,p_subject_id,p_actor_user_id,p_actor_ip,
    p_organisation_id,n,n,prev,hash,p_payload) RETURNING entry_sequence INTO s;
  RETURN s;
END $append$;

CREATE FUNCTION gov_repo.ledger_v2_capture()
RETURNS trigger LANGUAGE plpgsql VOLATILE SECURITY INVOKER
SET search_path=pg_catalog,pg_temp AS $capture$
DECLARE e gov_repo.ledger_integrity_epochs_v2; g gov_repo.ledger_tenant_genesis_v2;
  h gov_repo.ledger_tenant_heads_v2; global_head gov_repo.ledger_global_append_head_v2;
  c uuid := gen_random_uuid(); id uuid := gen_random_uuid(); digest bytea;
BEGIN
  SELECT * INTO e FROM gov_repo.ledger_integrity_epochs_v2 WHERE is_active;
  IF NOT FOUND THEN RAISE EXCEPTION 'LEDGER_V2_INACTIVE' USING ERRCODE='55000'; END IF;
  IF NEW.entry_sequence <= e.legacy_high_watermark THEN
    RAISE EXCEPTION 'LEDGER_V2_CUTOVER_BOUNDARY' USING ERRCODE='23514';
  END IF;
  SELECT * INTO STRICT global_head FROM gov_repo.ledger_global_append_head_v2 WHERE singleton FOR UPDATE;
  IF NEW.previous_hash::text IS DISTINCT FROM encode(global_head.last_global_hash,'hex')
      OR NEW.entry_sequence <= global_head.last_global_sequence THEN
    RAISE EXCEPTION 'LEDGER_V2_GLOBAL_HEAD' USING ERRCODE='23514';
  END IF;
  -- Unique organisation arbitrates lazy genesis; global guard serializes all writers.
  INSERT INTO gov_repo.ledger_tenant_genesis_v2 VALUES(NEW.organisation_id,c,e.activation_id,
    e.algorithm_version,e.serialization_version,e.activated_at,NEW.recorded_at,
    sha256(gov_repo.ledger_v2_genesis_bytes(NEW.organisation_id,c,e.activation_id,e.activated_at)))
    ON CONFLICT(organisation_id) DO NOTHING;
  SELECT * INTO STRICT g FROM gov_repo.ledger_tenant_genesis_v2 WHERE organisation_id=NEW.organisation_id;
  INSERT INTO gov_repo.ledger_tenant_heads_v2 VALUES(g.organisation_id,g.chain_id,0,g.genesis_hash,0)
    ON CONFLICT(organisation_id,chain_id) DO NOTHING;
  SELECT * INTO STRICT h FROM gov_repo.ledger_tenant_heads_v2
    WHERE organisation_id=g.organisation_id AND chain_id=g.chain_id FOR UPDATE;
  digest := sha256(gov_repo.ledger_v2_entry_bytes(NEW.organisation_id,g.chain_id,e.activation_id,
    h.last_tenant_sequence+1,id,h.last_tenant_hash,NEW.entry_id,NEW.event_type::text,NEW.event_description,
    NEW.subject_type::text,NEW.subject_id,NEW.actor_user_id,NEW.actor_ip,NEW.actor_session_id,
    NEW.event_timestamp,NEW.recorded_at,NEW.payload));
  INSERT INTO gov_repo.ledger_tenant_entries_v2 VALUES(NEW.organisation_id,g.chain_id,e.activation_id,
    2,1,h.last_tenant_sequence+1,id,NEW.entry_sequence,NEW.entry_id,h.last_tenant_hash,digest,
    NEW.event_type,NEW.event_description,NEW.subject_type,NEW.subject_id,NEW.actor_user_id,
    NEW.actor_ip,NEW.actor_session_id,NEW.event_timestamp,NEW.recorded_at,NEW.payload);
  UPDATE gov_repo.ledger_tenant_heads_v2 SET last_tenant_sequence=h.last_tenant_sequence+1,
    last_tenant_hash=digest,committed_count=h.committed_count+1
    WHERE organisation_id=h.organisation_id AND chain_id=h.chain_id;
  UPDATE gov_repo.ledger_global_append_head_v2 SET last_global_sequence=NEW.entry_sequence,
    last_global_hash=decode(NEW.entry_hash,'hex') WHERE singleton;
  RETURN NULL;
END $capture$;
CREATE TRIGGER ledger_v2_capture AFTER INSERT ON gov_repo.governance_ledger
  FOR EACH ROW EXECUTE FUNCTION gov_repo.ledger_v2_capture();
ALTER TABLE gov_repo.governance_ledger ENABLE ALWAYS TRIGGER ledger_v2_capture;

-- Guard only V2 source rows. QES anchor fields deliberately remain mutable.
CREATE FUNCTION gov_repo.ledger_v2_source_immutable()
RETURNS trigger LANGUAGE plpgsql VOLATILE SECURITY INVOKER
SET search_path=pg_catalog,pg_temp AS $guard$
BEGIN
  IF EXISTS (SELECT FROM gov_repo.ledger_integrity_epochs_v2 WHERE is_active
      AND OLD.entry_sequence > legacy_high_watermark)
    AND (to_jsonb(NEW)-ARRAY['qes_anchor','qes_anchor_at']) IS DISTINCT FROM
        (to_jsonb(OLD)-ARRAY['qes_anchor','qes_anchor_at']) THEN
    RAISE EXCEPTION 'LEDGER_V2_SOURCE_IMMUTABLE' USING ERRCODE='55000';
  END IF;
  RETURN NEW;
END $guard$;
CREATE TRIGGER ledger_v2_source_immutable BEFORE UPDATE ON gov_repo.governance_ledger
  FOR EACH ROW EXECUTE FUNCTION gov_repo.ledger_v2_source_immutable();
ALTER TABLE gov_repo.governance_ledger ENABLE ALWAYS TRIGGER ledger_v2_source_immutable;

-- Deferred check uses current rows/heads, including when SET CONSTRAINTS is IMMEDIATE.
-- It runs in the invoker context; the checked public wrapper is postgres, the
-- internal writer is govia_ledger_executor, and both have exact read capabilities.
CREATE FUNCTION gov_repo.ledger_v2_coverage()
RETURNS trigger LANGUAGE plpgsql VOLATILE SECURITY INVOKER
SET search_path=pg_catalog,pg_temp AS $coverage$
DECLARE h gov_repo.ledger_global_append_head_v2; tail record;
BEGIN
  SELECT * INTO STRICT h FROM gov_repo.ledger_global_append_head_v2 WHERE singleton;
  SELECT entry_sequence,entry_hash INTO STRICT tail FROM gov_repo.governance_ledger ORDER BY entry_sequence DESC LIMIT 1;
  IF h.last_global_sequence <> tail.entry_sequence OR h.last_global_hash <> decode(tail.entry_hash,'hex')
    OR NOT EXISTS (SELECT FROM gov_repo.governance_ledger l JOIN gov_repo.ledger_tenant_entries_v2 v
      ON v.source_entry_sequence=l.entry_sequence
      WHERE l.entry_sequence=NEW.entry_sequence AND
      ROW(v.organisation_id,v.source_entry_id,v.event_type,v.event_description,v.subject_type,v.subject_id,
        v.actor_user_id,v.actor_ip,v.actor_session_id,v.event_timestamp,v.recorded_at,v.payload)
      IS NOT DISTINCT FROM ROW(l.organisation_id,l.entry_id,l.event_type::text,l.event_description,l.subject_type::text,
        l.subject_id,l.actor_user_id,l.actor_ip,l.actor_session_id,l.event_timestamp,l.recorded_at,l.payload))
    OR EXISTS (SELECT FROM gov_repo.ledger_tenant_heads_v2 th
      WHERE th.organisation_id=NEW.organisation_id AND
      (th.last_tenant_sequence,th.last_tenant_hash,th.committed_count) IS DISTINCT FROM
      (SELECT ROW(v.tenant_sequence,v.tenant_hash,v.tenant_sequence) FROM gov_repo.ledger_tenant_entries_v2 v
       WHERE v.organisation_id=th.organisation_id ORDER BY v.tenant_sequence DESC LIMIT 1)) THEN
    RAISE EXCEPTION 'LEDGER_V2_ATOMIC_COVERAGE' USING ERRCODE='23514';
  END IF;
  RETURN NULL;
END $coverage$;
CREATE CONSTRAINT TRIGGER ledger_v2_coverage AFTER INSERT ON gov_repo.governance_ledger
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION gov_repo.ledger_v2_coverage();
ALTER TABLE gov_repo.governance_ledger ENABLE ALWAYS TRIGGER ledger_v2_coverage;

CREATE FUNCTION gov_repo.ledger_append_v2(
  p_verified_organisation_id uuid,p_verified_actor_user_id uuid,p_verified_session_iat bigint,
  p_verified_session_exp bigint,p_verified_credential_epoch timestamptz,
  p_event_type varchar,p_event_desc text,p_subject_type varchar,p_subject_id uuid,
  p_organisation_id uuid,p_payload jsonb,p_actor_ip inet DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,pg_temp SET lock_timeout='5s' AS $boundary$
DECLARE s bigint; id uuid;
BEGIN
  PERFORM 1 FROM gov_repo.l14_session_basis_v1(p_verified_organisation_id,p_verified_actor_user_id,
    p_verified_session_iat,p_verified_session_exp,p_verified_credential_epoch);
  IF p_organisation_id IS DISTINCT FROM p_verified_organisation_id THEN
    RAISE EXCEPTION 'LEDGER_V2_PRINCIPAL_MISMATCH' USING ERRCODE='GV003';
  END IF;
  s := gov_repo.ledger_append(p_event_type,p_event_desc,p_subject_type,p_subject_id,
    p_verified_actor_user_id,p_actor_ip,p_verified_organisation_id,p_payload);
  SELECT tenant_entry_id INTO STRICT id FROM gov_repo.ledger_tenant_entries_v2 WHERE source_entry_sequence=s;
  -- Deferred invoker triggers otherwise execute at service_role COMMIT, after
  -- definer authority has ended. Flush just these checks while still postgres;
  -- never grant table reads or add a definer helper to solve that boundary.
  SET CONSTRAINTS gov_repo.ledger_v2_entry_structure,gov_repo.ledger_v2_coverage IMMEDIATE;
  SET CONSTRAINTS gov_repo.ledger_v2_entry_structure,gov_repo.ledger_v2_coverage DEFERRED;
  RETURN id;
END $boundary$;

-- Technical role, no application membership: source/sidecar writes only.
GRANT SELECT ON gov_repo.ledger_integrity_epochs_v2 TO govia_ledger_executor;
GRANT SELECT,INSERT ON gov_repo.ledger_tenant_genesis_v2,gov_repo.ledger_tenant_heads_v2,
  gov_repo.ledger_tenant_entries_v2 TO govia_ledger_executor;
GRANT SELECT ON gov_repo.ledger_global_append_head_v2 TO govia_ledger_executor;
GRANT UPDATE(last_global_sequence,last_global_hash) ON gov_repo.ledger_global_append_head_v2 TO govia_ledger_executor;
GRANT UPDATE(last_tenant_sequence,last_tenant_hash,committed_count) ON gov_repo.ledger_tenant_heads_v2 TO govia_ledger_executor;
GRANT SELECT(entry_sequence,entry_id,organisation_id,event_type,event_description,subject_type,subject_id,
  actor_user_id,actor_ip,actor_session_id,event_timestamp,recorded_at,previous_hash,entry_hash,payload)
  ON gov_repo.governance_ledger TO govia_ledger_executor;
REVOKE UPDATE(entry_sequence) ON gov_repo.governance_ledger FROM govia_ledger_executor;
DO $policies$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['ledger_integrity_epochs_v2','ledger_global_append_head_v2',
    'ledger_tenant_genesis_v2','ledger_tenant_heads_v2','ledger_tenant_entries_v2'] LOOP
    EXECUTE format('CREATE POLICY ledger_v2_executor_select ON gov_repo.%I FOR SELECT TO govia_ledger_executor USING(true)',t);
  END LOOP;
  FOREACH t IN ARRAY ARRAY['ledger_tenant_genesis_v2','ledger_tenant_heads_v2','ledger_tenant_entries_v2'] LOOP
    EXECUTE format('CREATE POLICY ledger_v2_executor_insert ON gov_repo.%I FOR INSERT TO govia_ledger_executor WITH CHECK(true)',t);
  END LOOP;
  FOREACH t IN ARRAY ARRAY['ledger_global_append_head_v2','ledger_tenant_heads_v2'] LOOP
    EXECUTE format('CREATE POLICY ledger_v2_executor_update ON gov_repo.%I FOR UPDATE TO govia_ledger_executor USING(true) WITH CHECK(true)',t);
  END LOOP;
END $policies$;

REVOKE ALL ON FUNCTION gov_repo.ledger_append(varchar,text,varchar,uuid,uuid,inet,uuid,jsonb),
  gov_repo.ledger_verify(bigint,bigint) FROM PUBLIC,anon,authenticated,service_role;
-- Existing administrative owner boundary, never a tenant/global verifier RPC.
GRANT EXECUTE ON FUNCTION gov_repo.ledger_append(varchar,text,varchar,uuid,uuid,inet,uuid,jsonb),
  gov_repo.ledger_verify(bigint,bigint) TO postgres;
REVOKE INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER ON gov_repo.governance_ledger FROM PUBLIC,anon,authenticated,service_role;
DO $columns$
DECLARE c name;
BEGIN
  FOR c IN SELECT attname FROM pg_attribute WHERE attrelid='gov_repo.governance_ledger'::regclass
      AND attnum>0 AND NOT attisdropped LOOP
    EXECUTE format('REVOKE INSERT(%I),UPDATE(%I),REFERENCES(%I) ON gov_repo.governance_ledger FROM PUBLIC,anon,authenticated,service_role',c,c,c);
  END LOOP;
END $columns$;
REVOKE ALL ON SEQUENCE gov_repo.governance_ledger_entry_sequence_seq FROM PUBLIC,anon,authenticated,service_role;

-- Owner/operator-only invoker procedure; no new SECURITY DEFINER/operator RPC.
CREATE PROCEDURE gov_repo.ledger_v2_activate(p_expected_writers text[])
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,pg_temp SET lock_timeout='5s' AS $activation$
DECLARE tip bigint; hash bytea; id uuid := gen_random_uuid(); n timestamptz;
BEGIN
  PERFORM pg_advisory_xact_lock(175,2);
  LOCK TABLE gov_repo.governance_ledger IN ACCESS EXCLUSIVE MODE;
  LOCK TABLE gov_repo.ledger_integrity_epochs_v2,gov_repo.ledger_global_append_head_v2 IN ACCESS EXCLUSIVE MODE;
  IF EXISTS (SELECT FROM gov_repo.ledger_integrity_epochs_v2) THEN
    RAISE EXCEPTION 'LEDGER_V2_ALREADY_ACTIVATED' USING ERRCODE='55000';
  END IF;
  IF p_expected_writers IS DISTINCT FROM ARRAY['discovery_scan','talk_governance_logging']::text[]
    OR EXISTS (SELECT FROM gov_repo.ledger_tenant_genesis_v2)
    OR EXISTS (SELECT FROM gov_repo.ledger_tenant_heads_v2)
    OR EXISTS (SELECT FROM gov_repo.ledger_tenant_entries_v2)
    OR EXISTS (SELECT FROM gov_repo.ledger_global_append_head_v2)
    OR EXISTS (SELECT FROM gov_repo.ledger_tenant_legacy_refs_v2)
    OR EXISTS (SELECT FROM pg_roles r WHERE rolname IN ('anon','authenticated','service_role') AND
      (has_function_privilege(r.oid,'gov_repo.ledger_append(character varying,text,character varying,uuid,uuid,inet,uuid,jsonb)','EXECUTE')
       OR has_function_privilege(r.oid,'gov_repo.ledger_verify(bigint,bigint)','EXECUTE')
       OR has_any_column_privilege(r.oid,'gov_repo.governance_ledger','INSERT,UPDATE')
       OR has_table_privilege(r.oid,'gov_repo.governance_ledger','DELETE,TRUNCATE,TRIGGER')))
    OR (SELECT count(*) FROM pg_trigger WHERE tgrelid='gov_repo.governance_ledger'::regclass
      AND tgname IN ('ledger_v2_capture','ledger_v2_coverage','ledger_v2_source_immutable') AND tgenabled='A'
      AND tgfoid=to_regprocedure('gov_repo.'||tgname||'()')) <> 3
    -- PINNED_WRITE_CONTRACT: body/owner/definer fingerprints, including frozen serializers.
    OR EXISTS (SELECT FROM (VALUES
      ('ledger_v2_frame','73a08921d579a39f4ad26fccccc849aafc7385389ff43488c5f82d8557a93f3d','postgres',false),
      ('ledger_v2_decimal','91c5bcc8f5f85bb1965815569a710b156d424fa8379b8a038ef946240ec3a9bd','postgres',false),
      ('ledger_v2_integer','610e51612ef2ece3853a57d00f8959740bbe9e6ebd67de3e93cba977e5f1faff','postgres',false),
      ('ledger_v2_timestamp','420c2bc0c845925f335bcd3ab9f653de1317ee3581006dfbe60aacb399e2f983','postgres',false),
      ('ledger_v2_ip','211beaf5cd0c0631047b2c3d2ad5c07ab2ee0c2b94716c79e751bceb984615c7','postgres',false),
      ('ledger_v2_json','c62b1be7a92d90d1bc07b4b176d7f07d0df9f98ff78838128d91d379673680fc','postgres',false),
      ('ledger_v2_genesis_bytes','3cb2a60aa64dbd65edf83a1216ddc0aea013b05264aa4b4c13771a2e34db70f4','postgres',false),
      ('ledger_v2_entry_bytes','dbaf0f61e064e3231243be1de2b78e0fef8ebe81a1420da12f22faf821d55778','postgres',false),
      ('ledger_v2_immutable','3153eff1cb073f7055f471911323bff739afed38cb429b3d55453878a07e5716','postgres',false),
      ('ledger_v2_entry_structure','be012dfbd01be391901b1cd5eab6a545dce65cc87f4f6c2ab10a01dda193b567','postgres',false),
      ('ledger_v2_head_identity','f440024a0771dfb3cf47fe7abca0fe3eb3ecfa20f8fab8624dcfcd9f7702bea9','postgres',false),
      ('ledger_append','cbbae64a240966fa61c4d182d7b56e49c1570ae4ba393642f053ffe9029e8252','govia_ledger_executor',true),
      ('ledger_v2_capture','9b340a37ae81e1054dfdad99506318446e7c9db31eb53db9d7668f850a16ec6b','postgres',false),
      ('ledger_v2_source_immutable','38c5d97abe20d6f433912e7c7099d085d2e67f1b44bbf1d9b76ed2ce38ac8312','postgres',false),
      ('ledger_v2_coverage','6196dec9c478d8f513f8231246228b08679e0b3072a9274798cb6a3ddc10a336','postgres',false),
      ('ledger_append_v2','545dd508a7c9f6bf57d00533f9e8e7c4cf7602c429bfa19070a548263cb64310','postgres',true)
    ) expected(name,hash,owner,definer)
      LEFT JOIN pg_proc p ON p.pronamespace='gov_repo'::regnamespace AND p.proname=expected.name
      WHERE p.oid IS NULL OR encode(sha256(convert_to(replace(p.prosrc,chr(13),''),'UTF8')),'hex') <> expected.hash
        OR pg_get_userbyid(p.proowner)::text <> expected.owner OR p.prosecdef <> expected.definer
        OR NOT coalesce(p.proconfig @> ARRAY['search_path=pg_catalog, pg_temp'],false)
        OR p.provolatile <> CASE WHEN expected.name IN ('ledger_v2_frame','ledger_v2_decimal','ledger_v2_integer',
          'ledger_v2_timestamp','ledger_v2_ip','ledger_v2_json','ledger_v2_genesis_bytes','ledger_v2_entry_bytes') THEN 'i'::"char" ELSE 'v'::"char" END)
    OR EXISTS (SELECT FROM pg_roles r CROSS JOIN pg_class c
      WHERE r.rolname IN ('anon','authenticated','service_role') AND c.relnamespace='gov_repo'::regnamespace
        AND c.relname IN ('ledger_integrity_epochs_v2','ledger_global_append_head_v2','ledger_tenant_genesis_v2',
          'ledger_tenant_heads_v2','ledger_tenant_entries_v2','ledger_tenant_legacy_refs_v2')
        AND (NOT c.relrowsecurity OR has_any_column_privilege(r.oid,c.oid,'SELECT,INSERT,UPDATE,REFERENCES')
          OR has_table_privilege(r.oid,c.oid,'DELETE,TRUNCATE,TRIGGER')))
    OR NOT EXISTS (SELECT FROM pg_proc WHERE oid='gov_repo.ledger_append_v2(uuid,uuid,bigint,bigint,timestamp with time zone,character varying,text,character varying,uuid,uuid,jsonb,inet)'::regprocedure
      AND proowner='postgres'::regrole AND prosecdef AND proconfig @> ARRAY['search_path=pg_catalog, pg_temp']) THEN
    RAISE EXCEPTION 'LEDGER_V2_ACTIVATION_CONTRACT' USING ERRCODE='55000';
  END IF;
  -- Strictly preserve the actual tip, even if legacy verification is broken.
  -- Malformed/non-32-byte tip is unsupported and aborts; never rehash history.
  SELECT entry_sequence,decode(entry_hash,'hex') INTO tip,hash FROM gov_repo.governance_ledger ORDER BY entry_sequence DESC LIMIT 1;
  IF NOT FOUND THEN tip:=0; hash:=sha256(convert_to('CODEGUARD-GENESIS-2026','UTF8')); END IF;
  n:=clock_timestamp();
  INSERT INTO gov_repo.ledger_integrity_epochs_v2 VALUES(id,'SHA-256',2,1,
    '20261021134359_m175_v1_s1a1_2a_ledger_v2_write_cutover',n,tip,hash,true);
  INSERT INTO gov_repo.ledger_global_append_head_v2 VALUES(true,id,tip,hash);
  INSERT INTO gov_repo.ledger_tenant_legacy_refs_v2(organisation_id,source_entry_sequence)
    SELECT organisation_id,entry_sequence FROM gov_repo.governance_ledger WHERE entry_sequence<=tip;
END $activation$;

DO $acl$
DECLARE f regprocedure;
BEGIN
  FOR f IN SELECT oid::regprocedure FROM pg_proc WHERE pronamespace='gov_repo'::regnamespace
    AND (proname LIKE 'ledger_v2_%' OR proname='ledger_append_v2') LOOP
    EXECUTE format('REVOKE ALL ON ROUTINE %s FROM PUBLIC,anon,authenticated,service_role',f);
    IF f::text NOT LIKE '%ledger_v2_activate(%' AND f::text NOT LIKE '%ledger_append_v2(%' THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO govia_ledger_executor',f);
    END IF;
  END LOOP;
END $acl$;
GRANT EXECUTE ON FUNCTION gov_repo.ledger_append_v2(uuid,uuid,bigint,bigint,timestamptz,varchar,text,varchar,uuid,uuid,jsonb,inet) TO service_role;
COMMENT ON PROCEDURE gov_repo.ledger_v2_activate(text[]) IS 'Owner-only explicit atomic cutover. No hosted authorization. Legacy validity is not a tenant precondition; malformed tips abort. Forward-only after first committed V2 entry.';
REVOKE govia_ledger_executor FROM postgres;
COMMIT;
