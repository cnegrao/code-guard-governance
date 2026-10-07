-- Discovery Machine S2. Frozen ADR sections 7-9, 12-14, 16.
-- Persistence only: no LOGIN, intake, PROPOSE, worker, HUMAN/L14 change or activation.
BEGIN;
DO $preflight$
BEGIN
  IF current_user <> 'postgres' OR current_setting('server_version_num')::int < 170000
     OR current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'S2_PREFLIGHT: postgres / PG17+ / READ COMMITTED required';
  END IF;
  IF to_regclass('gov_repo.organisations') IS NULL OR NOT EXISTS (
    SELECT 1 FROM pg_proc WHERE oid = to_regprocedure('gov_repo.execution_field_valid(text)')
    AND proconfig = ARRAY['search_path=pg_catalog, pg_temp']) THEN
    RAISE EXCEPTION 'S2_PREFLIGHT: R3 baseline required';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname IN ('govia_discovery_control_owner',
    'govia_discovery_audit_owner','govia_discovery_provisioner','govia_discovery_machine_caller')) THEN
    RAISE EXCEPTION 'S2_PREFLIGHT: technical roles must not preexist';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles r WHERE r.rolname IN ('anon','authenticated','service_role')
      AND (r.rolsuper OR r.rolcreaterole OR has_schema_privilege(r.oid,'gov_repo','CREATE'))) THEN
    RAISE EXCEPTION 'S2_PREFLIGHT: unsafe application roles';
  END IF;
  IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='gov_repo' AND p.proname IN ('apply_review_transition','record_authorized_reconciliation',
      'materialize_object_reconciliation','materialize_relationship_reconciliation','record_technical_field_decision',
      'record_execution_field_decision','record_authorization_decision')) <> 7
    OR EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      CROSS JOIN pg_roles r WHERE n.nspname='gov_repo' AND r.rolname IN ('anon','authenticated','service_role')
      AND p.proname IN ('apply_review_transition','record_authorized_reconciliation','materialize_object_reconciliation',
        'materialize_relationship_reconciliation','record_technical_field_decision','record_execution_field_decision','record_authorization_decision')
      AND has_function_privilege(r.oid,p.oid,'EXECUTE')) THEN
    RAISE EXCEPTION 'S2_PREFLIGHT: raw RPC baseline required';
  END IF;
  IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='gov_repo' AND p.prosecdef AND (has_function_privilege('service_role',p.oid,'EXECUTE')
      OR has_function_privilege('anon',p.oid,'EXECUTE') OR has_function_privilege('authenticated',p.oid,'EXECUTE'))) <> 22 THEN
    RAISE EXCEPTION 'S2_PREFLIGHT: HUMAN surface required';
  END IF;
END;
$preflight$;

CREATE ROLE govia_discovery_control_owner NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT;
CREATE ROLE govia_discovery_audit_owner NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT;
CREATE ROLE govia_discovery_provisioner NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT;
CREATE ROLE govia_discovery_machine_caller NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT;
GRANT USAGE ON SCHEMA gov_repo TO govia_discovery_control_owner, govia_discovery_audit_owner,
  govia_discovery_provisioner, govia_discovery_machine_caller;
-- Temporary transfer rights only, removed before commit.
GRANT govia_discovery_control_owner, govia_discovery_audit_owner TO postgres WITH INHERIT TRUE, SET TRUE;
GRANT CREATE ON SCHEMA gov_repo TO govia_discovery_control_owner, govia_discovery_audit_owner;

CREATE FUNCTION gov_repo.machine_source_connection_id_v1(p_provider text, p_configured text)
RETURNS text LANGUAGE sql IMMUTABLE STRICT SET search_path = pg_catalog, pg_temp
RETURN 'source-connection:' || substr(encode(sha256(convert_to(p_provider || ':' || p_configured, 'UTF8')), 'hex'),1,32);

CREATE FUNCTION gov_repo.machine_normalized_locator_v1(p_configured text)
RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog, pg_temp AS $fn$
DECLARE v_owner text; v_repo text;
BEGIN
  v_owner := split_part(p_configured,'/',1); v_repo := split_part(p_configured,'/',2);
  IF p_configured IS NULL OR p_configured <> v_owner || '/' || v_repo
     OR v_owner COLLATE "C" !~ '^[A-Za-z0-9]([A-Za-z0-9-]{0,37}[A-Za-z0-9])?$'
     OR v_repo COLLATE "C" !~ '^[A-Za-z0-9._-]{1,100}$' OR v_repo IN ('.','..')
     OR translate(right(v_repo,4),'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz') = '.git' THEN
    RAISE EXCEPTION 'S2_SOURCE_INVALID' USING ERRCODE = '22023';
  END IF;
  RETURN translate(p_configured,'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz');
END;
$fn$;

CREATE TABLE gov_repo.machine_principals (
  principal_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  principal_code text COLLATE "C" NOT NULL UNIQUE CHECK (principal_code ~ '^[a-z][a-z0-9_-]{0,79}$'),
  workload_kind text NOT NULL DEFAULT 'GOVERNED_DISCOVERY' CHECK (workload_kind = 'GOVERNED_DISCOVERY'),
  environment text COLLATE "C" NOT NULL CHECK (length(btrim(environment)) > 0),
  state text NOT NULL DEFAULT 'ENABLED' CHECK (state IN ('ENABLED','DISABLED','RETIRED')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(), updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  administered_by text NOT NULL, reason text NOT NULL CHECK (length(btrim(reason)) > 0),
  reference text NOT NULL CHECK (length(btrim(reference)) > 0)
);
CREATE TABLE gov_repo.machine_credential_generations (
  generation_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  principal_id uuid NOT NULL REFERENCES gov_repo.machine_principals,
  generation_number bigint NOT NULL CHECK (generation_number > 0),
  role_oid oid NOT NULL UNIQUE, role_name text COLLATE "C" NOT NULL UNIQUE,
  state text NOT NULL DEFAULT 'PENDING' CHECK (state IN ('PENDING','CURRENT','RETIRED')),
  valid_from timestamptz NOT NULL, valid_until timestamptz NOT NULL CHECK (valid_until > valid_from),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(), updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  administered_by text NOT NULL, reason text NOT NULL CHECK (length(btrim(reason)) > 0),
  reference text NOT NULL CHECK (length(btrim(reference)) > 0),
  UNIQUE (principal_id, generation_number)
);
CREATE UNIQUE INDEX machine_one_current_generation ON gov_repo.machine_credential_generations(principal_id) WHERE state = 'CURRENT';
CREATE TABLE gov_repo.machine_execution_bindings (
  binding_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  principal_id uuid NOT NULL REFERENCES gov_repo.machine_principals,
  organisation_id uuid NOT NULL REFERENCES gov_repo.organisations,
  source_connection_id text COLLATE "C" NOT NULL,
  provider text COLLATE "C" NOT NULL CHECK (provider = 'github'),
  configured_locator text COLLATE "C" NOT NULL,
  normalized_locator text COLLATE "C" NOT NULL,
  provider_source_id text COLLATE "C" CHECK (provider_source_id ~ '^[1-9][0-9]*$'),
  authorized_ref text COLLATE "C" NOT NULL CHECK (length(authorized_ref) > 0
    AND authorized_ref !~ '[\x01-\x1f\x7f-\x9f]'
    AND btrim(authorized_ref, U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF') = authorized_ref),
  adapter_name text COLLATE "C" NOT NULL CHECK (length(btrim(adapter_name)) > 0),
  adapter_version text COLLATE "C" NOT NULL CHECK (length(btrim(adapter_version)) > 0),
  intake_enabled boolean NOT NULL DEFAULT false, propose_enabled boolean NOT NULL DEFAULT false,
  proposal_rule_code text NOT NULL DEFAULT 'PASS_THROUGH_V1' CHECK (proposal_rule_code = 'PASS_THROUGH_V1'),
  proposal_rule_version text NOT NULL DEFAULT '1.0' CHECK (proposal_rule_version = '1.0'),
  binding_revision bigint NOT NULL DEFAULT 1 CHECK (binding_revision BETWEEN 1 AND 9007199254740991),
  state text NOT NULL DEFAULT 'ENABLED' CHECK (state IN ('ENABLED','DISABLED','REVOKED')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(), updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  administered_by text NOT NULL, reason text NOT NULL CHECK (length(btrim(reason)) > 0),
  reference text NOT NULL CHECK (length(btrim(reference)) > 0),
  CHECK (normalized_locator = gov_repo.machine_normalized_locator_v1(configured_locator)),
  CHECK (source_connection_id = gov_repo.machine_source_connection_id_v1(provider,configured_locator))
);
CREATE UNIQUE INDEX machine_binding_connection_scope ON gov_repo.machine_execution_bindings
 (principal_id,organisation_id,source_connection_id,authorized_ref,adapter_name,adapter_version) WHERE state <> 'REVOKED';
CREATE UNIQUE INDEX machine_binding_locator_scope ON gov_repo.machine_execution_bindings
 (principal_id,organisation_id,provider,normalized_locator,authorized_ref,adapter_name,adapter_version) WHERE state <> 'REVOKED';
CREATE INDEX machine_binding_organisation ON gov_repo.machine_execution_bindings(organisation_id);
CREATE TABLE gov_repo.machine_binding_revisions (
  binding_id uuid NOT NULL REFERENCES gov_repo.machine_execution_bindings,
  binding_revision bigint NOT NULL, snapshot jsonb NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (binding_id,binding_revision)
);
CREATE TABLE gov_repo.machine_invocation_audit (
  invocation_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  principal_id uuid REFERENCES gov_repo.machine_principals,
  generation_id uuid REFERENCES gov_repo.machine_credential_generations,
  role_oid oid, role_name text,
  binding_id uuid, binding_revision bigint,
  organisation_id uuid, source_connection_id text,
  adapter_name text, adapter_version text,
  acquisition_run_id text, attempt_run_id text, finding_id text, subject_id text,
  command_id text, event_id text, source_version text,
  original_binding_id uuid, original_binding_revision bigint, original_generation_id uuid,
  outcome text NOT NULL CHECK (outcome IN ('APPLIED','REPLAYED','DENIED','CONTENT_CONFLICT','STATE_CONFLICT','READ')),
  denial_code text, recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK ((binding_id IS NULL) = (binding_revision IS NULL)),
  CHECK ((original_binding_id IS NULL) = (original_binding_revision IS NULL))
);
COMMENT ON TABLE gov_repo.machine_invocation_audit IS
 'S2 transactional audit foundation only. No application insert surface. Aborted transactions/rollbacks do not survive; operational attempt ingestion is future work. Unknown denied references may remain absent.';

CREATE FUNCTION gov_repo.machine_no_mutation_v1() RETURNS trigger LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp AS $fn$
BEGIN RAISE EXCEPTION 'S2_APPEND_ONLY' USING ERRCODE = '55000'; END;
$fn$;

-- Guards remain active even for ordinary DBA DML; DDL/superuser maintenance is an explicit trust boundary.
CREATE FUNCTION gov_repo.machine_control_guard_v1() RETURNS trigger LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp AS $fn$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF TG_TABLE_NAME = 'machine_principals' THEN NEW.principal_id := gen_random_uuid();
    ELSIF TG_TABLE_NAME = 'machine_credential_generations' THEN NEW.generation_id := gen_random_uuid();
    ELSE NEW.binding_id := gen_random_uuid(); NEW.binding_revision := 1; END IF;
    NEW.created_at := clock_timestamp();
  ELSE
    IF TG_TABLE_NAME = 'machine_principals' THEN
      IF (to_jsonb(NEW) - ARRAY['state','updated_at','administered_by','reason','reference']) IS DISTINCT FROM
         (to_jsonb(OLD) - ARRAY['state','updated_at','administered_by','reason','reference']) OR OLD.state = 'RETIRED' THEN
        RAISE EXCEPTION 'S2_PRINCIPAL_IMMUTABLE'; END IF;
    ELSIF TG_TABLE_NAME = 'machine_credential_generations' THEN
      IF (to_jsonb(NEW) - ARRAY['state','updated_at','administered_by','reason','reference']) IS DISTINCT FROM
         (to_jsonb(OLD) - ARRAY['state','updated_at','administered_by','reason','reference']) OR OLD.state = 'RETIRED'
         OR (OLD.state = 'CURRENT' AND NEW.state <> 'RETIRED') THEN
        RAISE EXCEPTION 'S2_GENERATION_IMMUTABLE'; END IF;
    ELSE
      IF (to_jsonb(NEW) - ARRAY['state','intake_enabled','propose_enabled','binding_revision','updated_at','administered_by','reason','reference']) IS DISTINCT FROM
         (to_jsonb(OLD) - ARRAY['state','intake_enabled','propose_enabled','binding_revision','updated_at','administered_by','reason','reference'])
         OR OLD.state = 'REVOKED' OR NEW.binding_revision <> OLD.binding_revision THEN
        RAISE EXCEPTION 'S2_BINDING_IMMUTABLE'; END IF;
      NEW.binding_revision := OLD.binding_revision + 1;
    END IF;
  END IF;
  NEW.updated_at := clock_timestamp(); NEW.administered_by := session_user;
  RETURN NEW;
END;
$fn$;
CREATE FUNCTION gov_repo.machine_record_revision_v1() RETURNS trigger LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp AS $fn$
BEGIN
  INSERT INTO gov_repo.machine_binding_revisions(binding_id,binding_revision,snapshot)
    VALUES (NEW.binding_id,NEW.binding_revision,to_jsonb(NEW));
  RETURN NEW;
END;
$fn$;

CREATE FUNCTION gov_repo.machine_require_provisioner_v1() RETURNS void LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp AS $fn$
DECLARE v_oid oid;
BEGIN
  SELECT oid INTO v_oid FROM pg_roles WHERE rolname = session_user;
  IF current_setting('transaction_isolation') <> 'read committed' OR v_oid IS NULL
    OR NOT (session_user = 'postgres' OR pg_has_role(v_oid,'govia_discovery_provisioner','MEMBER')) THEN
    RAISE EXCEPTION 'S2_TRUSTED_PROVISIONING_REQUIRED' USING ERRCODE = '42501';
  END IF;
END;
$fn$;

-- Catalog-only, exact-name identity. No regrole parsing of caller strings and no secret storage.
-- Future DBA provisioning must also certify the LOGIN has no broad grants outside this boundary.
CREATE FUNCTION gov_repo.machine_role_safe_v1(p_oid oid, p_name text) RETURNS boolean LANGUAGE sql STABLE
SET search_path = pg_catalog, pg_temp AS $fn$
 SELECT EXISTS (SELECT 1 FROM pg_roles r WHERE r.oid = p_oid AND r.rolname::text COLLATE "C" = p_name COLLATE "C"
   AND r.rolcanlogin AND NOT (r.rolsuper OR r.rolcreatedb OR r.rolcreaterole OR r.rolreplication OR r.rolbypassrls)
   AND (r.rolvaliduntil IS NULL OR r.rolvaliduntil > clock_timestamp())
   AND NOT EXISTS (SELECT 1 FROM pg_auth_members m WHERE m.member = r.oid
     AND (m.roleid <> (SELECT oid FROM pg_roles WHERE rolname = 'govia_discovery_machine_caller') OR m.admin_option))
   -- MEMBER follows the entire membership graph, regardless of INHERIT/SET options.
   -- Reject even dormant edges: ADMIN/SET-only paths must never enlarge the closed caller surface.
   AND NOT EXISTS (SELECT 1 FROM pg_roles target WHERE target.oid <> r.oid
     AND target.rolname <> 'govia_discovery_machine_caller' AND pg_has_role(r.oid,target.oid,'MEMBER'))
   AND NOT EXISTS (SELECT 1 FROM pg_namespace n WHERE n.nspname NOT LIKE 'pg_temp_%' AND n.nspname NOT LIKE 'pg_toast_temp_%'
     AND has_schema_privilege(r.oid,n.oid,'CREATE'))
   AND NOT has_database_privilege(r.oid,current_database(),'CREATE')
   AND NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
     WHERE n.nspname='gov_repo' AND c.relkind IN ('r','v','m','p') AND
       (has_table_privilege(r.oid,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN')
         OR has_any_column_privilege(r.oid,c.oid,'SELECT,INSERT,UPDATE,REFERENCES')))
   AND NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
     WHERE n.nspname='gov_repo' AND p.proowner <> (SELECT oid FROM pg_roles WHERE rolname='govia_discovery_control_owner')
       AND (p.prosecdef OR p.proname IN ('apply_review_transition','record_authorized_reconciliation','materialize_object_reconciliation',
         'materialize_relationship_reconciliation','record_technical_field_decision','record_execution_field_decision','record_authorization_decision'))
       AND has_function_privilege(r.oid,p.oid,'EXECUTE')));
$fn$;

CREATE FUNCTION gov_repo.machine_provision_principal_v1(p_code text,p_environment text,p_reason text,p_reference text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp SET lock_timeout = '5s' AS $fn$
DECLARE v_id uuid;
BEGIN
  PERFORM gov_repo.machine_require_provisioner_v1();
  INSERT INTO gov_repo.machine_principals(principal_code,environment,administered_by,reason,reference)
    VALUES(p_code,p_environment,session_user,p_reason,p_reference) RETURNING principal_id INTO v_id;
  RETURN v_id;
END;
$fn$;
CREATE FUNCTION gov_repo.machine_set_principal_state_v1(p_id uuid,p_state text,p_reason text,p_reference text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp SET lock_timeout = '5s' AS $fn$
BEGIN
  PERFORM gov_repo.machine_require_provisioner_v1();
  UPDATE gov_repo.machine_principals SET state=p_state,reason=p_reason,reference=p_reference WHERE principal_id=p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'S2_PRINCIPAL_UNKNOWN'; END IF;
END;
$fn$;
CREATE FUNCTION gov_repo.machine_register_generation_v1(p_principal uuid,p_role text,p_from timestamptz,p_until timestamptz,p_reason text,p_reference text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp SET lock_timeout = '5s' AS $fn$
DECLARE v_oid oid; v_id uuid; v_number bigint;
BEGIN
  PERFORM gov_repo.machine_require_provisioner_v1();
  PERFORM 1 FROM gov_repo.machine_principals WHERE principal_id=p_principal AND state <> 'RETIRED' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'S2_PRINCIPAL_UNKNOWN'; END IF;
  SELECT oid INTO v_oid FROM pg_roles WHERE rolname::text COLLATE "C" = p_role COLLATE "C";
  IF NOT gov_repo.machine_role_safe_v1(v_oid,p_role) THEN RAISE EXCEPTION 'S2_ROLE_UNSAFE'; END IF;
  SELECT coalesce(max(generation_number),0)+1 INTO v_number FROM gov_repo.machine_credential_generations WHERE principal_id=p_principal;
  INSERT INTO gov_repo.machine_credential_generations(principal_id,generation_number,role_oid,role_name,valid_from,valid_until,administered_by,reason,reference)
    VALUES(p_principal,v_number,v_oid,p_role,p_from,p_until,session_user,p_reason,p_reference) RETURNING generation_id INTO v_id;
  RETURN v_id;
END;
$fn$;
CREATE FUNCTION gov_repo.machine_set_generation_state_v1(p_id uuid,p_state text,p_reason text,p_reference text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp SET lock_timeout = '5s' AS $fn$
DECLARE v_principal uuid; v_generation gov_repo.machine_credential_generations;
BEGIN
  PERFORM gov_repo.machine_require_provisioner_v1();
  SELECT principal_id INTO v_principal FROM gov_repo.machine_credential_generations WHERE generation_id=p_id;
  PERFORM 1 FROM gov_repo.machine_principals WHERE principal_id=v_principal AND state <> 'RETIRED' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'S2_PRINCIPAL_UNKNOWN'; END IF;
  SELECT * INTO STRICT v_generation FROM gov_repo.machine_credential_generations WHERE generation_id=p_id;
  IF p_state = 'CURRENT' THEN
    IF v_generation.state <> 'PENDING' OR NOT gov_repo.machine_role_safe_v1(v_generation.role_oid,v_generation.role_name)
       OR clock_timestamp() < v_generation.valid_from OR clock_timestamp() >= v_generation.valid_until THEN
      RAISE EXCEPTION 'S2_CREDENTIAL_INELIGIBLE'; END IF;
    UPDATE gov_repo.machine_credential_generations SET state='RETIRED',reason=p_reason,reference=p_reference
      WHERE principal_id=v_principal AND state='CURRENT';
  ELSIF p_state IS DISTINCT FROM 'RETIRED' THEN RAISE EXCEPTION 'S2_GENERATION_STATE_INVALID'; END IF;
  UPDATE gov_repo.machine_credential_generations SET state=p_state,reason=p_reason,reference=p_reference WHERE generation_id=p_id;
END;
$fn$;
CREATE FUNCTION gov_repo.machine_provision_binding_v1(p_principal uuid,p_org uuid,p_provider text,p_configured text,p_normalized text,
 p_connection text,p_pin text,p_ref text,p_adapter text,p_version text,p_intake boolean,p_propose boolean,p_reason text,p_reference text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp SET lock_timeout = '5s' AS $fn$
DECLARE v_id uuid;
BEGIN
  PERFORM gov_repo.machine_require_provisioner_v1();
  PERFORM 1 FROM gov_repo.machine_principals WHERE principal_id=p_principal AND state <> 'RETIRED' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'S2_PRINCIPAL_UNKNOWN'; END IF;
  PERFORM 1 FROM gov_repo.organisations WHERE organisation_id=p_org AND is_active FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'S2_SCOPE_INELIGIBLE'; END IF;
  INSERT INTO gov_repo.machine_execution_bindings(principal_id,organisation_id,provider,configured_locator,normalized_locator,
    source_connection_id,provider_source_id,authorized_ref,adapter_name,adapter_version,intake_enabled,propose_enabled,administered_by,reason,reference)
  VALUES(p_principal,p_org,p_provider,p_configured,p_normalized,p_connection,p_pin,p_ref,p_adapter,p_version,p_intake,p_propose,session_user,p_reason,p_reference)
  RETURNING binding_id INTO v_id;
  RETURN v_id;
END;
$fn$;
CREATE FUNCTION gov_repo.machine_change_binding_v1(p_id uuid,p_revision bigint,p_state text,p_intake boolean,p_propose boolean,p_reason text,p_reference text)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp SET lock_timeout = '5s' AS $fn$
DECLARE v_binding gov_repo.machine_execution_bindings; v_revision bigint;
BEGIN
  PERFORM gov_repo.machine_require_provisioner_v1();
  SELECT * INTO STRICT v_binding FROM gov_repo.machine_execution_bindings WHERE binding_id=p_id;
  PERFORM 1 FROM gov_repo.machine_principals WHERE principal_id=v_binding.principal_id FOR UPDATE;
  PERFORM 1 FROM gov_repo.organisations WHERE organisation_id=v_binding.organisation_id FOR SHARE;
  UPDATE gov_repo.machine_execution_bindings SET state=p_state,intake_enabled=p_intake,propose_enabled=p_propose,reason=p_reason,reference=p_reference
    WHERE binding_id=p_id AND binding_revision=p_revision RETURNING binding_revision INTO v_revision;
  IF NOT FOUND THEN RAISE EXCEPTION 'S2_BINDING_REVISION_STALE'; END IF;
  RETURN v_revision;
END;
$fn$;

-- Internal primitive only. Future closed commands pick capability internally from these DB fields,
-- recheck before returning, and extend this lock order with run then subject. No machine grant in S2.
CREATE FUNCTION gov_repo.machine_lock_eligibility_v1(p_binding uuid,p_revision bigint)
RETURNS TABLE(principal_id uuid,generation_id uuid,binding gov_repo.machine_execution_bindings,checked_at timestamptz)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp SET lock_timeout = '5s' AS $fn$
DECLARE v_oid oid; v_principal uuid; v_generation gov_repo.machine_credential_generations;
 v_binding gov_repo.machine_execution_bindings; v_time timestamptz;
BEGIN
  IF current_setting('transaction_isolation') <> 'read committed' THEN RAISE EXCEPTION 'S2_READ_COMMITTED_REQUIRED'; END IF;
  SELECT oid INTO v_oid FROM pg_roles WHERE rolname = session_user;
  IF NOT gov_repo.machine_role_safe_v1(v_oid,session_user::text) THEN RAISE EXCEPTION 'S2_CREDENTIAL_INELIGIBLE' USING ERRCODE='42501'; END IF;
  SELECT g.principal_id INTO v_principal FROM gov_repo.machine_credential_generations g
    WHERE g.role_oid=v_oid AND g.role_name COLLATE "C"=session_user::text COLLATE "C";
  PERFORM 1 FROM gov_repo.machine_principals p WHERE p.principal_id=v_principal AND p.state='ENABLED' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'S2_CREDENTIAL_INELIGIBLE' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_generation FROM gov_repo.machine_credential_generations g
    WHERE g.principal_id=v_principal AND g.role_oid=v_oid AND g.role_name COLLATE "C"=session_user::text COLLATE "C" AND g.state='CURRENT';
  IF NOT FOUND THEN RAISE EXCEPTION 'S2_CREDENTIAL_INELIGIBLE' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_binding FROM gov_repo.machine_execution_bindings b WHERE b.binding_id=p_binding AND b.principal_id=v_principal;
  IF NOT FOUND THEN RAISE EXCEPTION 'S2_SCOPE_INELIGIBLE' USING ERRCODE='42501'; END IF;
  PERFORM 1 FROM gov_repo.organisations o WHERE o.organisation_id=v_binding.organisation_id AND o.is_active FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'S2_SCOPE_INELIGIBLE' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_binding FROM gov_repo.machine_execution_bindings b WHERE b.binding_id=p_binding AND b.principal_id=v_principal FOR SHARE;
  v_time := clock_timestamp();
  IF NOT FOUND OR v_binding.state <> 'ENABLED' OR v_binding.binding_revision IS DISTINCT FROM p_revision THEN
    RAISE EXCEPTION 'S2_SCOPE_INELIGIBLE' USING ERRCODE='42501'; END IF;
  IF v_time < v_generation.valid_from OR v_time >= v_generation.valid_until
     OR NOT gov_repo.machine_role_safe_v1(v_oid,session_user::text) THEN
    RAISE EXCEPTION 'S2_CREDENTIAL_INELIGIBLE' USING ERRCODE='42501'; END IF;
  RETURN QUERY SELECT v_principal,v_generation.generation_id,v_binding,v_time;
END;
$fn$;

-- Locking an organisation requires UPDATE privilege and a USING policy. WITH CHECK false
-- prevents new row versions, as in R1's ledger lock. No routine writes organisations.
GRANT SELECT(organisation_id,is_active), UPDATE(is_active) ON gov_repo.organisations TO govia_discovery_control_owner;
CREATE POLICY machine_control_organisation_read ON gov_repo.organisations FOR SELECT TO govia_discovery_control_owner USING (true);
CREATE POLICY machine_control_organisation_lock ON gov_repo.organisations FOR UPDATE TO govia_discovery_control_owner USING (true) WITH CHECK (false);

-- All dynamic SQL below is migration-time DDL over a fixed census, never runtime input.
DO $closure$
DECLARE v_table text; v_routine record;
BEGIN
  FOREACH v_table IN ARRAY ARRAY['machine_principals','machine_credential_generations','machine_execution_bindings','machine_binding_revisions','machine_invocation_audit'] LOOP
    EXECUTE format('REVOKE ALL ON TABLE gov_repo.%I FROM PUBLIC, anon, authenticated, service_role, govia_discovery_provisioner, govia_discovery_machine_caller',v_table);
    EXECUTE format('ALTER TABLE gov_repo.%I ENABLE ROW LEVEL SECURITY',v_table);
    EXECUTE format('ALTER TABLE gov_repo.%I OWNER TO %I',v_table,
      CASE WHEN v_table='machine_invocation_audit' THEN 'govia_discovery_audit_owner' ELSE 'govia_discovery_control_owner' END);
    EXECUTE format('CREATE TRIGGER machine_no_delete BEFORE DELETE ON gov_repo.%I FOR EACH ROW EXECUTE FUNCTION gov_repo.machine_no_mutation_v1()',v_table);
    EXECUTE format('CREATE TRIGGER machine_no_truncate BEFORE TRUNCATE ON gov_repo.%I FOR EACH STATEMENT EXECUTE FUNCTION gov_repo.machine_no_mutation_v1()',v_table);
    IF v_table IN ('machine_binding_revisions','machine_invocation_audit') THEN
      EXECUTE format('CREATE TRIGGER machine_no_update BEFORE UPDATE ON gov_repo.%I FOR EACH ROW EXECUTE FUNCTION gov_repo.machine_no_mutation_v1()',v_table);
    ELSE
      EXECUTE format('CREATE TRIGGER machine_control_guard BEFORE INSERT OR UPDATE ON gov_repo.%I FOR EACH ROW EXECUTE FUNCTION gov_repo.machine_control_guard_v1()',v_table);
    END IF;
  END LOOP;
  CREATE TRIGGER machine_record_revision AFTER INSERT OR UPDATE ON gov_repo.machine_execution_bindings
    FOR EACH ROW EXECUTE FUNCTION gov_repo.machine_record_revision_v1();
  FOR v_routine IN SELECT p.oid::regprocedure AS sig,p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='gov_repo' AND p.proname LIKE 'machine\_%' ESCAPE '\' LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated, service_role, govia_discovery_provisioner, govia_discovery_machine_caller',v_routine.sig);
    EXECUTE format('ALTER FUNCTION %s OWNER TO govia_discovery_control_owner',v_routine.sig);
    IF v_routine.proname IN ('machine_provision_principal_v1','machine_set_principal_state_v1','machine_register_generation_v1',
      'machine_set_generation_state_v1','machine_provision_binding_v1','machine_change_binding_v1') THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO govia_discovery_provisioner, postgres',v_routine.sig);
    END IF;
  END LOOP;
END;
$closure$;
GRANT EXECUTE ON FUNCTION gov_repo.machine_no_mutation_v1() TO govia_discovery_audit_owner;
REVOKE CREATE ON SCHEMA gov_repo FROM govia_discovery_control_owner, govia_discovery_audit_owner;
REVOKE govia_discovery_control_owner, govia_discovery_audit_owner FROM postgres;
-- Only postgres creator ADMIN membership remains (no SET or INHERIT), matching R1.
-- DBA explicitly grants provisioner to a trusted provisioning LOGIN out of band.
-- Local owner defaults are closed without changing the legacy postgres table defaults of unrelated migrations.
GRANT govia_discovery_control_owner, govia_discovery_audit_owner TO postgres WITH INHERIT TRUE, SET TRUE;
ALTER DEFAULT PRIVILEGES FOR ROLE govia_discovery_control_owner REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE govia_discovery_audit_owner REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE govia_discovery_control_owner IN SCHEMA gov_repo REVOKE ALL ON TABLES FROM PUBLIC,anon,authenticated,service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE govia_discovery_audit_owner IN SCHEMA gov_repo REVOKE ALL ON TABLES FROM PUBLIC,anon,authenticated,service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE govia_discovery_control_owner IN SCHEMA gov_repo REVOKE ALL ON SEQUENCES FROM PUBLIC,anon,authenticated,service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE govia_discovery_audit_owner IN SCHEMA gov_repo REVOKE ALL ON SEQUENCES FROM PUBLIC,anon,authenticated,service_role;
REVOKE govia_discovery_control_owner, govia_discovery_audit_owner FROM postgres;

DO $postflight$
DECLARE v_role record; v_table record; v_proc record;
BEGIN
  IF (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='gov_repo' AND c.relkind='r' AND c.relname LIKE 'machine\_%' ESCAPE '\') <> 5 THEN
    RAISE EXCEPTION 'S2_POSTFLIGHT: table census'; END IF;
  IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='gov_repo' AND p.proname LIKE 'machine\_%' ESCAPE '\') <> 14 THEN
    RAISE EXCEPTION 'S2_POSTFLIGHT: routine census'; END IF;
  FOR v_role IN SELECT * FROM pg_roles WHERE rolname IN ('govia_discovery_control_owner','govia_discovery_audit_owner','govia_discovery_provisioner','govia_discovery_machine_caller') LOOP
    IF v_role.rolcanlogin OR v_role.rolsuper OR v_role.rolcreatedb OR v_role.rolcreaterole OR v_role.rolreplication OR v_role.rolbypassrls
       OR has_schema_privilege(v_role.oid,'gov_repo','CREATE')
       OR EXISTS(SELECT 1 FROM pg_auth_members WHERE member=v_role.oid)
       OR EXISTS(SELECT 1 FROM pg_auth_members m WHERE m.roleid=v_role.oid AND
         (m.member <> (SELECT oid FROM pg_roles WHERE rolname='postgres') OR m.inherit_option OR m.set_option)) THEN
      RAISE EXCEPTION 'S2_POSTFLIGHT: unsafe technical role %',v_role.rolname; END IF;
  END LOOP;
  FOR v_table IN SELECT c.* FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='gov_repo' AND c.relkind IN ('r','S') AND c.relname LIKE 'machine\_%' ESCAPE '\' LOOP
    IF NOT v_table.relrowsecurity OR pg_get_userbyid(v_table.relowner) <>
      (CASE WHEN v_table.relname='machine_invocation_audit' THEN 'govia_discovery_audit_owner' ELSE 'govia_discovery_control_owner' END) THEN
      RAISE EXCEPTION 'S2_POSTFLIGHT: owner/RLS'; END IF;
    IF EXISTS(SELECT 1 FROM aclexplode(coalesce(v_table.relacl,acldefault('r',v_table.relowner))) WHERE grantee=0) THEN
      RAISE EXCEPTION 'S2_POSTFLIGHT: PUBLIC table ACL'; END IF;
    FOR v_role IN SELECT * FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role','govia_discovery_provisioner','govia_discovery_machine_caller',
      'govia_ledger_executor','govia_runtime_executor','govia_legacy_read_executor','govia_legacy_graph_executor') LOOP
      IF has_table_privilege(v_role.oid,v_table.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN')
         OR has_any_column_privilege(v_role.oid,v_table.oid,'SELECT,INSERT,UPDATE,REFERENCES') THEN
        RAISE EXCEPTION 'S2_POSTFLIGHT: effective table ACL % / %',v_role.rolname,v_table.relname; END IF;
    END LOOP;
  END LOOP;
  FOR v_proc IN SELECT p.* FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='gov_repo' AND p.proname LIKE 'machine\_%' ESCAPE '\' LOOP
    IF pg_get_userbyid(v_proc.proowner)<>'govia_discovery_control_owner'
      OR NOT ('search_path=pg_catalog, pg_temp'=ANY(v_proc.proconfig))
      OR EXISTS(SELECT 1 FROM aclexplode(coalesce(v_proc.proacl,acldefault('f',v_proc.proowner))) WHERE grantee=0) THEN
      RAISE EXCEPTION 'S2_POSTFLIGHT: routine owner/path/PUBLIC'; END IF;
    FOR v_role IN SELECT * FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role','govia_discovery_machine_caller') LOOP
      IF has_function_privilege(v_role.oid,v_proc.oid,'EXECUTE') THEN RAISE EXCEPTION 'S2_POSTFLIGHT: routine ACL'; END IF;
    END LOOP;
  END LOOP;
END;
$postflight$;
COMMIT;
