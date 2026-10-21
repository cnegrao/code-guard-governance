-- M17.5-V1-S1A1-1: V2_AVAILABLE_AS_SCHEMA / V2_INACTIVE.
-- No epoch, head, genesis, entry or legacy reference is populated here.
-- Global V1 remains the legacy/platform chain. No historical tenant proof is
-- created. Tenant V2 requires separately authorized atomic activation.
BEGIN;

-- Serialization v1 is frozen in docs/trust-assurance/tenant-ledger-v2-serialization-v1.md.
-- These pure helpers are owner-only SECURITY INVOKER, never application RPCs.
CREATE FUNCTION gov_repo.ledger_v2_frame(p_tag integer, p_value bytea)
RETURNS bytea LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER
SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF p_tag IS NULL OR p_tag < 0 OR p_tag > 11 THEN
    RAISE EXCEPTION 'LEDGER_V2_UNSUPPORTED_TAG' USING ERRCODE = '22023';
  END IF;
  IF p_value IS NULL THEN
    RETURN decode('00', 'hex') || int8send(0);
  END IF;
  IF p_tag = 0 THEN
    RAISE EXCEPTION 'LEDGER_V2_NONCANONICAL_NULL' USING ERRCODE = '22023';
  END IF;
  RETURN set_byte(decode('00','hex'), 0, p_tag)
    || int8send(octet_length(p_value)::bigint) || p_value;
END $$;

-- Decimal digits are produced by exact numeric arithmetic, without numeric/text
-- casts, floating point, locale, exponent output or server formatting settings.
CREATE FUNCTION gov_repo.ledger_v2_decimal(p_value numeric)
RETURNS bytea LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER
SET search_path = pg_catalog, pg_temp AS $$
DECLARE n numeric; s integer; digits text := ''; digit integer; negative boolean;
BEGIN
  IF p_value IS NULL OR p_value IN ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric) THEN
    RAISE EXCEPTION 'LEDGER_V2_NONFINITE_NUMBER' USING ERRCODE = '22023';
  END IF;
  IF p_value = 0 THEN RETURN convert_to('0','UTF8'); END IF;
  negative := p_value < 0;
  n := trim_scale(abs(p_value));
  s := scale(n);
  n := n * power(10::numeric, s::numeric);
  WHILE n > 0 LOOP
    digit := mod(n, 10)::integer;
    digits := substr('0123456789', digit + 1, 1) || digits;
    n := div(n, 10);
  END LOOP;
  IF s > 0 THEN
    digits := lpad(digits, greatest(length(digits), s + 1), '0');
    digits := substr(digits, 1, length(digits) - s) || '.' || right(digits, s);
  END IF;
  IF negative THEN digits := '-' || digits; END IF;
  RETURN convert_to(digits, 'UTF8');
END $$;

CREATE FUNCTION gov_repo.ledger_v2_integer(p_value bigint)
RETURNS bytea LANGUAGE sql IMMUTABLE SECURITY INVOKER
SET search_path = pg_catalog, pg_temp AS $$
  SELECT gov_repo.ledger_v2_frame(3, CASE WHEN p_value IS NULL THEN NULL
    ELSE gov_repo.ledger_v2_decimal(p_value::numeric) END)
$$;

CREATE FUNCTION gov_repo.ledger_v2_timestamp(p_value timestamptz)
RETURNS bytea LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER
SET search_path = pg_catalog, pg_temp AS $$
DECLARE micros numeric;
BEGIN
  IF p_value IS NULL THEN RETURN gov_repo.ledger_v2_frame(4, NULL); END IF;
  IF NOT isfinite(p_value) THEN
    RAISE EXCEPTION 'LEDGER_V2_NONFINITE_TIMESTAMP' USING ERRCODE = '22023';
  END IF;
  micros := extract(epoch FROM p_value) * 1000000;
  IF micros < -9223372036854775808::numeric OR micros > 9223372036854775807::numeric THEN
    RAISE EXCEPTION 'LEDGER_V2_TIMESTAMP_RANGE' USING ERRCODE = '22023';
  END IF;
  RETURN gov_repo.ledger_v2_frame(4, gov_repo.ledger_v2_decimal(micros));
END $$;

CREATE FUNCTION gov_repo.ledger_v2_ip(p_value inet)
RETURNS bytea LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER
SET search_path = pg_catalog, pg_temp AS $$
DECLARE packed bytea;
BEGIN
  IF p_value IS NULL THEN RETURN gov_repo.ledger_v2_frame(11, NULL); END IF;
  packed := set_byte(decode('00','hex'),0,family(p_value))
    || substring(inet_send(p_value) FROM 5)
    || set_byte(decode('00','hex'),0,masklen(p_value));
  RETURN gov_repo.ledger_v2_frame(11, packed);
END $$;

CREATE FUNCTION gov_repo.ledger_v2_json(p_value jsonb)
RETURNS bytea LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER
SET search_path = pg_catalog, pg_temp AS $$
DECLARE kind text; body bytea; item record; element jsonb; n bigint;
BEGIN
  kind := jsonb_typeof(p_value);
  IF kind IS NULL OR kind = 'null' THEN RETURN gov_repo.ledger_v2_frame(0,NULL); END IF;
  CASE kind
    WHEN 'string' THEN RETURN gov_repo.ledger_v2_frame(1,convert_to(p_value #>> '{}','UTF8'));
    WHEN 'number' THEN RETURN gov_repo.ledger_v2_frame(6,gov_repo.ledger_v2_decimal((p_value #>> '{}')::numeric));
    WHEN 'boolean' THEN RETURN gov_repo.ledger_v2_frame(CASE WHEN p_value = 'true'::jsonb THEN 8 ELSE 7 END, ''::bytea);
    WHEN 'object' THEN
      SELECT count(*) INTO n FROM jsonb_each(p_value);
      body := gov_repo.ledger_v2_integer(n);
      FOR item IN SELECT key,value FROM jsonb_each(p_value) ORDER BY convert_to(key,'UTF8') LOOP
        body := body || gov_repo.ledger_v2_frame(1,convert_to(item.key,'UTF8')) || gov_repo.ledger_v2_json(item.value);
      END LOOP;
      RETURN gov_repo.ledger_v2_frame(9,body);
    WHEN 'array' THEN
      body := gov_repo.ledger_v2_integer(jsonb_array_length(p_value)::bigint);
      FOR element IN SELECT value FROM jsonb_array_elements(p_value) LOOP
        body := body || gov_repo.ledger_v2_json(element);
      END LOOP;
      RETURN gov_repo.ledger_v2_frame(10,body);
    ELSE RAISE EXCEPTION 'LEDGER_V2_UNSUPPORTED_JSON' USING ERRCODE = '22023';
  END CASE;
END $$;

CREATE FUNCTION gov_repo.ledger_v2_genesis_bytes(
  p_organisation uuid, p_chain uuid, p_activation uuid, p_activated_at timestamptz,
  p_algorithm integer DEFAULT 2, p_serialization integer DEFAULT 1)
RETURNS bytea LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER
SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF p_algorithm IS DISTINCT FROM 2 OR p_serialization IS DISTINCT FROM 1
    OR p_organisation IS NULL OR p_chain IS NULL OR p_activation IS NULL OR p_activated_at IS NULL THEN
    RAISE EXCEPTION 'LEDGER_V2_UNSUPPORTED_GENESIS' USING ERRCODE = '22023';
  END IF;
  RETURN gov_repo.ledger_v2_frame(1,convert_to('GOVIA_LEDGER_TENANT_GENESIS_V2','UTF8'))
    || gov_repo.ledger_v2_integer(p_algorithm) || gov_repo.ledger_v2_integer(p_serialization)
    || gov_repo.ledger_v2_frame(2,uuid_send(p_organisation))
    || gov_repo.ledger_v2_frame(2,uuid_send(p_chain)) || gov_repo.ledger_v2_frame(2,uuid_send(p_activation))
    || gov_repo.ledger_v2_timestamp(p_activated_at);
END $$;

CREATE FUNCTION gov_repo.ledger_v2_entry_bytes(
  p_organisation uuid, p_chain uuid, p_activation uuid, p_sequence bigint,
  p_entry uuid, p_previous bytea, p_source_entry uuid,
  p_event_type text, p_description text, p_subject_type text, p_subject uuid,
  p_actor uuid, p_ip inet, p_session uuid, p_event_at timestamptz,
  p_recorded_at timestamptz, p_payload jsonb,
  p_algorithm integer DEFAULT 2, p_serialization integer DEFAULT 1)
RETURNS bytea LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER
SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF p_algorithm IS DISTINCT FROM 2 OR p_serialization IS DISTINCT FROM 1
    OR p_organisation IS NULL OR p_chain IS NULL OR p_activation IS NULL
    OR p_sequence IS NULL OR p_sequence <= 0 OR p_entry IS NULL OR p_source_entry IS NULL
    OR p_previous IS NULL OR octet_length(p_previous) <> 32 OR p_event_type IS NULL
    OR p_description IS NULL OR p_subject_type IS NULL OR p_subject IS NULL
    OR p_event_at IS NULL OR p_recorded_at IS NULL OR p_payload IS NULL THEN
    RAISE EXCEPTION 'LEDGER_V2_UNSUPPORTED_ENTRY' USING ERRCODE = '22023';
  END IF;
  RETURN gov_repo.ledger_v2_frame(1,convert_to('GOVIA_LEDGER_TENANT_V2','UTF8'))
    || gov_repo.ledger_v2_integer(p_algorithm) || gov_repo.ledger_v2_integer(p_serialization)
    || gov_repo.ledger_v2_frame(2,uuid_send(p_organisation)) || gov_repo.ledger_v2_frame(2,uuid_send(p_chain))
    || gov_repo.ledger_v2_frame(2,uuid_send(p_activation)) || gov_repo.ledger_v2_integer(p_sequence)
    || gov_repo.ledger_v2_frame(2,uuid_send(p_entry)) || gov_repo.ledger_v2_frame(5,p_previous)
    || gov_repo.ledger_v2_frame(2,uuid_send(p_source_entry))
    || gov_repo.ledger_v2_frame(1,convert_to(p_event_type,'UTF8'))
    || gov_repo.ledger_v2_frame(1,convert_to(p_description,'UTF8'))
    || gov_repo.ledger_v2_frame(1,convert_to(p_subject_type,'UTF8'))
    || gov_repo.ledger_v2_frame(2,uuid_send(p_subject)) || gov_repo.ledger_v2_frame(2,uuid_send(p_actor))
    || gov_repo.ledger_v2_ip(p_ip) || gov_repo.ledger_v2_frame(2,uuid_send(p_session))
    || gov_repo.ledger_v2_timestamp(p_event_at) || gov_repo.ledger_v2_timestamp(p_recorded_at)
    || gov_repo.ledger_v2_json(p_payload);
END $$;

-- Safe additive source key. entry_sequence is already a global PK: no new
-- historical uniqueness assumption about entry_id (which remains non-unique).
ALTER TABLE gov_repo.governance_ledger ADD CONSTRAINT ledger_v2_source_org_sequence_key
  UNIQUE (organisation_id, entry_sequence);

CREATE TABLE gov_repo.ledger_integrity_epochs_v2 (
  activation_id uuid PRIMARY KEY,
  algorithm text NOT NULL CHECK (algorithm = 'SHA-256'),
  algorithm_version integer NOT NULL CHECK (algorithm_version = 2),
  serialization_version integer NOT NULL CHECK (serialization_version = 1),
  migration_identifier text NOT NULL CHECK (length(migration_identifier) > 0),
  activated_at timestamptz NOT NULL CHECK (isfinite(activated_at)),
  legacy_high_watermark bigint NOT NULL CHECK (legacy_high_watermark >= 0),
  legacy_tip_hash bytea NOT NULL CHECK (octet_length(legacy_tip_hash) = 32),
  is_active boolean NOT NULL,
  UNIQUE (activation_id, algorithm_version, serialization_version, activated_at)
);
CREATE UNIQUE INDEX ledger_v2_one_active_epoch ON gov_repo.ledger_integrity_epochs_v2 ((true)) WHERE is_active;

CREATE TABLE gov_repo.ledger_global_append_head_v2 (
  singleton boolean PRIMARY KEY CHECK (singleton),
  activation_id uuid NOT NULL REFERENCES gov_repo.ledger_integrity_epochs_v2,
  last_global_sequence bigint NOT NULL CHECK (last_global_sequence >= 0),
  last_global_hash bytea NOT NULL CHECK (octet_length(last_global_hash) = 32)
);

CREATE TABLE gov_repo.ledger_tenant_genesis_v2 (
  organisation_id uuid NOT NULL REFERENCES gov_repo.organisations,
  chain_id uuid NOT NULL,
  activation_id uuid NOT NULL,
  algorithm_version integer NOT NULL,
  serialization_version integer NOT NULL,
  activated_at timestamptz NOT NULL,
  first_entry_recorded_at timestamptz NOT NULL CHECK (isfinite(first_entry_recorded_at)),
  genesis_hash bytea NOT NULL CHECK (octet_length(genesis_hash) = 32),
  PRIMARY KEY (organisation_id, chain_id),
  UNIQUE (organisation_id),
  UNIQUE (organisation_id, chain_id, activation_id, algorithm_version, serialization_version),
  FOREIGN KEY (activation_id, algorithm_version, serialization_version, activated_at)
    REFERENCES gov_repo.ledger_integrity_epochs_v2 (activation_id, algorithm_version, serialization_version, activated_at),
  CHECK (genesis_hash = sha256(gov_repo.ledger_v2_genesis_bytes(
    organisation_id,chain_id,activation_id,activated_at,algorithm_version,serialization_version)))
);

CREATE TABLE gov_repo.ledger_tenant_heads_v2 (
  organisation_id uuid NOT NULL,
  chain_id uuid NOT NULL,
  last_tenant_sequence bigint NOT NULL CHECK (last_tenant_sequence >= 0),
  last_tenant_hash bytea NOT NULL CHECK (octet_length(last_tenant_hash) = 32),
  committed_count bigint NOT NULL CHECK (committed_count = last_tenant_sequence),
  PRIMARY KEY (organisation_id, chain_id),
  FOREIGN KEY (organisation_id, chain_id) REFERENCES gov_repo.ledger_tenant_genesis_v2
);

CREATE TABLE gov_repo.ledger_tenant_entries_v2 (
  organisation_id uuid NOT NULL,
  chain_id uuid NOT NULL,
  activation_id uuid NOT NULL,
  algorithm_version integer NOT NULL,
  serialization_version integer NOT NULL,
  tenant_sequence bigint NOT NULL CHECK (tenant_sequence > 0),
  tenant_entry_id uuid NOT NULL,
  source_entry_sequence bigint NOT NULL UNIQUE,
  source_entry_id uuid NOT NULL,
  previous_tenant_hash bytea NOT NULL CHECK (octet_length(previous_tenant_hash) = 32),
  tenant_hash bytea NOT NULL CHECK (octet_length(tenant_hash) = 32),
  event_type text NOT NULL,
  event_description text NOT NULL,
  subject_type text NOT NULL,
  subject_id uuid NOT NULL,
  actor_user_id uuid,
  actor_ip inet,
  actor_session_id uuid,
  event_timestamp timestamptz NOT NULL CHECK (isfinite(event_timestamp)),
  recorded_at timestamptz NOT NULL CHECK (isfinite(recorded_at)),
  payload jsonb NOT NULL,
  PRIMARY KEY (organisation_id, chain_id, tenant_sequence),
  UNIQUE (organisation_id, tenant_entry_id),
  FOREIGN KEY (organisation_id, chain_id, activation_id, algorithm_version, serialization_version)
    REFERENCES gov_repo.ledger_tenant_genesis_v2 (organisation_id, chain_id, activation_id, algorithm_version, serialization_version),
  FOREIGN KEY (organisation_id, source_entry_sequence)
    REFERENCES gov_repo.governance_ledger (organisation_id, entry_sequence),
  CHECK (tenant_hash = sha256(gov_repo.ledger_v2_entry_bytes(
    organisation_id,chain_id,activation_id,tenant_sequence,tenant_entry_id,previous_tenant_hash,source_entry_id,
    event_type,event_description,subject_type,subject_id,actor_user_id,actor_ip,actor_session_id,
    event_timestamp,recorded_at,payload,algorithm_version,serialization_version)))
);
CREATE INDEX ledger_v2_tenant_browse ON gov_repo.ledger_tenant_entries_v2 (organisation_id, recorded_at, tenant_sequence);

CREATE TABLE gov_repo.ledger_tenant_legacy_refs_v2 (
  legacy_ref_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES gov_repo.organisations,
  source_entry_sequence bigint NOT NULL UNIQUE,
  FOREIGN KEY (organisation_id, source_entry_sequence)
    REFERENCES gov_repo.governance_ledger (organisation_id, entry_sequence)
);
CREATE INDEX ledger_v2_legacy_own_detail ON gov_repo.ledger_tenant_legacy_refs_v2 (organisation_id, legacy_ref_id);

CREATE FUNCTION gov_repo.ledger_v2_immutable()
RETURNS trigger LANGUAGE plpgsql VOLATILE SECURITY INVOKER
SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  RAISE EXCEPTION 'LEDGER_V2_IMMUTABLE' USING ERRCODE = '55000';
END $$;

-- A structural contract only, attached to the NEW table, never to the source.
-- Future atomic capture/head advancement and source-field guards are S1A1-2.
CREATE FUNCTION gov_repo.ledger_v2_entry_structure()
RETURNS trigger LANGUAGE plpgsql VOLATILE SECURITY INVOKER
SET search_path = pg_catalog, pg_temp AS $$
DECLARE expected bytea; first_recorded timestamptz;
BEGIN
  IF NEW.tenant_sequence = 1 THEN
    SELECT genesis_hash, first_entry_recorded_at INTO expected, first_recorded
      FROM gov_repo.ledger_tenant_genesis_v2
      WHERE organisation_id = NEW.organisation_id AND chain_id = NEW.chain_id;
    IF NEW.recorded_at IS DISTINCT FROM first_recorded THEN
      RAISE EXCEPTION 'LEDGER_V2_FIRST_RECORDED_MISMATCH' USING ERRCODE = '23514';
    END IF;
  ELSE
    SELECT tenant_hash INTO expected FROM gov_repo.ledger_tenant_entries_v2
      WHERE organisation_id = NEW.organisation_id AND chain_id = NEW.chain_id
      AND tenant_sequence = NEW.tenant_sequence - 1;
  END IF;
  IF expected IS NULL OR expected IS DISTINCT FROM NEW.previous_tenant_hash THEN
    RAISE EXCEPTION 'LEDGER_V2_SEQUENCE_OR_PREDECESSOR' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM gov_repo.governance_ledger
      WHERE organisation_id = NEW.organisation_id AND entry_sequence = NEW.source_entry_sequence
      AND entry_id = NEW.source_entry_id) THEN
    RAISE EXCEPTION 'LEDGER_V2_SOURCE_IDENTITY' USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER ledger_v2_entry_structure
  AFTER INSERT ON gov_repo.ledger_tenant_entries_v2 DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION gov_repo.ledger_v2_entry_structure();
ALTER TABLE gov_repo.ledger_tenant_entries_v2 ENABLE ALWAYS TRIGGER ledger_v2_entry_structure;

CREATE FUNCTION gov_repo.ledger_v2_head_identity()
RETURNS trigger LANGUAGE plpgsql VOLATILE SECURITY INVOKER
SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF TG_OP <> 'UPDATE' THEN
    RAISE EXCEPTION 'LEDGER_V2_HEAD_IDENTITY_IMMUTABLE' USING ERRCODE = '55000';
  END IF;
  IF TG_TABLE_NAME = 'ledger_tenant_heads_v2' THEN
    IF NEW.organisation_id IS DISTINCT FROM OLD.organisation_id OR NEW.chain_id IS DISTINCT FROM OLD.chain_id THEN
      RAISE EXCEPTION 'LEDGER_V2_HEAD_IDENTITY_IMMUTABLE' USING ERRCODE = '55000';
    END IF;
  ELSE
    IF NEW.singleton IS DISTINCT FROM OLD.singleton OR NEW.activation_id IS DISTINCT FROM OLD.activation_id THEN
      RAISE EXCEPTION 'LEDGER_V2_HEAD_IDENTITY_IMMUTABLE' USING ERRCODE = '55000';
    END IF;
  END IF;
  RETURN NEW;
END $$;

DO $close$
DECLARE t text; f regprocedure;
BEGIN
  FOREACH t IN ARRAY ARRAY['ledger_integrity_epochs_v2','ledger_global_append_head_v2',
    'ledger_tenant_genesis_v2','ledger_tenant_heads_v2','ledger_tenant_entries_v2','ledger_tenant_legacy_refs_v2'] LOOP
    EXECUTE format('ALTER TABLE gov_repo.%I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('REVOKE ALL ON TABLE gov_repo.%I FROM PUBLIC, anon, authenticated, service_role',t);
  END LOOP;
  FOREACH t IN ARRAY ARRAY['ledger_integrity_epochs_v2','ledger_tenant_genesis_v2',
    'ledger_tenant_entries_v2','ledger_tenant_legacy_refs_v2'] LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON gov_repo.%I FOR EACH ROW EXECUTE FUNCTION gov_repo.ledger_v2_immutable()',t || '_immutable',t);
    EXECUTE format('CREATE TRIGGER %I BEFORE TRUNCATE ON gov_repo.%I FOR EACH STATEMENT EXECUTE FUNCTION gov_repo.ledger_v2_immutable()',t || '_no_truncate',t);
    EXECUTE format('ALTER TABLE gov_repo.%I ENABLE ALWAYS TRIGGER %I',t,t || '_immutable');
    EXECUTE format('ALTER TABLE gov_repo.%I ENABLE ALWAYS TRIGGER %I',t,t || '_no_truncate');
  END LOOP;
  FOREACH t IN ARRAY ARRAY['ledger_global_append_head_v2','ledger_tenant_heads_v2'] LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON gov_repo.%I FOR EACH ROW EXECUTE FUNCTION gov_repo.ledger_v2_head_identity()',t || '_identity',t);
    EXECUTE format('CREATE TRIGGER %I BEFORE TRUNCATE ON gov_repo.%I FOR EACH STATEMENT EXECUTE FUNCTION gov_repo.ledger_v2_head_identity()',t || '_no_truncate',t);
    EXECUTE format('ALTER TABLE gov_repo.%I ENABLE ALWAYS TRIGGER %I',t,t || '_identity');
    EXECUTE format('ALTER TABLE gov_repo.%I ENABLE ALWAYS TRIGGER %I',t,t || '_no_truncate');
  END LOOP;
  FOR f IN SELECT oid::regprocedure FROM pg_proc WHERE pronamespace = 'gov_repo'::regnamespace AND proname LIKE 'ledger_v2_%' LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated, service_role',f);
  END LOOP;
END $close$;

COMMENT ON TABLE gov_repo.ledger_integrity_epochs_v2 IS 'V2 INACTIVE foundation: no activation row. Separately authorized atomic cutover required; global V1 retained as platform/legacy evidence.';
COMMENT ON TABLE gov_repo.ledger_tenant_entries_v2 IS 'Post-cutover tenant integrity evidence only. No historical backfill, no governance truth, no application capability in S1A1-1.';
COMMENT ON TABLE gov_repo.ledger_tenant_legacy_refs_v2 IS 'Unpopulated opaque own-tenant legacy identity map, not historical tenant cryptographic proof.';
COMMIT;
