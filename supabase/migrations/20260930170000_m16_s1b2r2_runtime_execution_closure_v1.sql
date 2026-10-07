-- M16-S1B.2R2 — runtime routine execution closure (additive corrective; no historical migration edited).
--
-- Defect (reproduced on disposable PostgreSQL 17): the four govia_runtime_executor routines
--   gov_repo.record_execution_snapshot, gov_repo.admit_runtime_observation,
--   gov_repo.read_runtime_observation_exact, gov_repo.record_cross_signal_comparison_result
-- were pinned to `search_path = pg_catalog`. When pg_temp is NOT named in search_path, PostgreSQL searches the
-- caller's temporary schema FIRST for relations and types (functions and operators are never looked up there
-- implicitly). A caller can therefore create `pg_temp.text` (or any other unqualified type name the body resolves)
-- as a domain whose CHECK calls a caller-written function; the domain is resolved inside the routine and the CHECK
-- runs as govia_runtime_executor, with its INSERT capability on the M13/M15 stores (a forged cross-tenant
-- cross_signal_comparison_results row was persisted this way).
--
-- Pinning only the routine to `pg_catalog, pg_temp` is NOT sufficient: every non-inlined helper, CHECK-constraint
-- function and trigger function the routines execute carries its OWN `SET search_path` (pg_catalog, or
-- gov_repo, pg_catalog) — which again omits pg_temp and re-opens the temporary schema first while that helper runs
-- (reproduced: gov_repo.frame_identity, statement 1, still escalated after the routine-only pin).
--
-- Correction: every function in the runtime routines' execution closure is pinned to its EXISTING path with pg_temp
-- named explicitly LAST. Only proconfig changes: no body, signature, owner, ACL, return shape, identity derivation,
-- replay, tenant or canonical_relationships behaviour changes; the application surface stays exactly 22.
-- "Application surface" here is the S1B.2R1 closed surface: every SECURITY DEFINER routine outside pg_catalog /
-- information_schema that PUBLIC, anon, authenticated or service_role can EXECUTE, EXCLUDING only PostgreSQL
-- extension members (pg_depend classid = pg_proc, deptype = 'e'); i.e. exactly 22 GOV IA-controlled,
-- non-extension-member identities, in any schema.
-- Only postgres can CREATE in gov_repo, and no gov_repo type/relation name collides with pg_catalog, so the
-- existing schema order is kept unchanged.
--
-- The closure (15), measured from the catalog on the full primary chain:
--   runtime definers (owner govia_runtime_executor)  — the four above;
--   invoker helpers (owner postgres)                  — execution_field_valid, frame_identity, normalized_object_identity,
--                                                       runtime_iso, runtime_lock, runtime_readback, runtime_round_cost,
--                                                       runtime_same_observation, runtime_valid_observation;
--   CHECK constraint functions                        — execution_field_valid (execution_source_facts),
--                                                       runtime_valid_observation (runtime_observations);
--   trigger functions on the runtime-written tables   — execution_immutable, runtime_immutable, cross_signal_immutable.
-- frame_identity / normalized_object_identity / execution_field_valid are shared with frozen postgres-owned routines;
-- appending pg_temp last only removes the temporary-schema shadowing for those callers as well.
BEGIN;

-- ---------------------------------------------------------------------------------------
-- A. Preflight: the closure is exactly as audited (owner, SECURITY DEFINER flag, body hash, current config).
-- ---------------------------------------------------------------------------------------
DO $preflight$
DECLARE
  v_entry record;
  v_oid oid;
  v_proc record;
BEGIN
  IF pg_catalog.current_setting('server_version_num')::integer < 170000 THEN
    RAISE EXCEPTION 'M16_S1B2R2_PREFLIGHT: PostgreSQL 17 required' USING ERRCODE = '55000';
  END IF;
  FOR v_entry IN
    SELECT * FROM (VALUES
      ('gov_repo.record_execution_snapshot(uuid,jsonb,text)', 'govia_runtime_executor', true, '882431691b588cedab4a7b6c2c947d834e48a3a9a7f9a94e43dc3782d6786f29', 'search_path=pg_catalog'),
      ('gov_repo.admit_runtime_observation(uuid,text,gov_repo.runtime_observations)', 'govia_runtime_executor', true, '9b6284dd7ca92f092fa567ff48e9ac3eae33f906c9653e9c4b204c04f1c51a18', 'search_path=pg_catalog'),
      ('gov_repo.read_runtime_observation_exact(uuid,gov_repo.runtime_reference,uuid)', 'govia_runtime_executor', true, 'eebbe4336fe8e5349d73c46d84c32c832bf6c283ac65dc7ddb062da0b73ffae0', 'search_path=pg_catalog'),
      ('gov_repo.record_cross_signal_comparison_result(uuid,text,jsonb)', 'govia_runtime_executor', true, '3771019f3c6291e866837703f2af100609f85c37603f8e2d82161436c713e84c', 'search_path=pg_catalog'),
      ('gov_repo.execution_field_valid(text)', 'postgres', false, 'c7a548c0f1250f32e15090b0136aadb4a8585d2410521c20027b7ec7d5e2879d', 'search_path=pg_catalog'),
      ('gov_repo.frame_identity(text[])', 'postgres', false, '81291ec2aa5912a6a084e9f1bd279744b58a14d67eafccbf85e3bf12b72a69c9', 'search_path=pg_catalog'),
      ('gov_repo.normalized_object_identity(uuid,jsonb)', 'postgres', false, '897fbd57cab5421dc2274aea0a48af031b983ab3c01e6be0e91bd18b45e147c9', 'search_path=gov_repo, pg_catalog'),
      ('gov_repo.runtime_iso(timestamp with time zone)', 'postgres', false, '17ffdcbfa9fa140b522dc7278f1a645345dbc797753753c1def550199fd07934', 'search_path=pg_catalog'),
      ('gov_repo.runtime_lock(uuid,text)', 'postgres', false, '4c1e13e1dfb7a456040d42d68b4c743c63188fcd1f03a3f97ca4be822e81de2d', 'search_path=pg_catalog'),
      ('gov_repo.runtime_readback(gov_repo.runtime_observations)', 'postgres', false, '68d76e12655e836f40aec1e6b28a33ee5d3384d8e2b9275c29a5c99600334308', 'search_path=pg_catalog'),
      ('gov_repo.runtime_round_cost(numeric)', 'postgres', false, 'b568cbe0786e025fb051a6c65e60945cba64aee87caae8b1caef3ef197921c5e', 'search_path=pg_catalog'),
      ('gov_repo.runtime_same_observation(gov_repo.runtime_observations,gov_repo.runtime_observations)', 'postgres', false, '835185b20f98599ed7c762d1e22c58d1428457e774fcfa50cbaeecbaea4c0eed', 'search_path=pg_catalog'),
      ('gov_repo.runtime_valid_observation(gov_repo.runtime_observations)', 'postgres', false, 'e7b51812cfe04a2122ea86d24eef921905620f1f5b526cf78b1e5112a2cca852', 'search_path=pg_catalog'),
      ('gov_repo.execution_immutable()', 'postgres', false, '63648cb5dee27e3b39ddf34e15fa75837577ac3f71443bee0702cfbd2de68ecd', 'search_path=pg_catalog'),
      ('gov_repo.runtime_immutable()', 'postgres', false, 'c45520cb9f1e1ed19dbc4b0d1c4114ccaa92aa3ed8456cb314b9b3295332a0e8', 'search_path=pg_catalog'),
      ('gov_repo.cross_signal_immutable()', 'postgres', false, '305b0c8e05b8a3282a4ff45a1c8b0a4291f7754e0a5943dfbcd583f71f570747', 'search_path=pg_catalog')
    ) AS t(sig, owner_role, secdef, sha, cfg)
  LOOP
    v_oid := pg_catalog.to_regprocedure(v_entry.sig);
    IF v_oid IS NULL THEN
      RAISE EXCEPTION 'M16_S1B2R2_PREFLIGHT: closure routine % missing', v_entry.sig USING ERRCODE = '55000';
    END IF;
    SELECT p.prosecdef, p.proowner, p.prosrc, p.proconfig INTO v_proc FROM pg_catalog.pg_proc AS p WHERE p.oid = v_oid;
    IF v_proc.prosecdef <> v_entry.secdef OR pg_catalog.pg_get_userbyid(v_proc.proowner) <> v_entry.owner_role
       OR pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(v_proc.prosrc, 'UTF8')), 'hex') <> v_entry.sha
       OR COALESCE(pg_catalog.array_to_string(v_proc.proconfig, ';'), '-') <> v_entry.cfg THEN
      RAISE EXCEPTION 'M16_S1B2R2_PREFLIGHT: closure routine % differs from its audited owner/definer/body/config', v_oid::regprocedure
        USING ERRCODE = '55000';
    END IF;
  END LOOP;
  -- The migration runner holds only the ADMIN membership R1 left behind on the runtime owner.
  IF (SELECT pg_catalog.string_agg(m.member::regrole::text || ':' || m.admin_option || m.inherit_option || m.set_option, ',')
        FROM pg_catalog.pg_auth_members AS m WHERE m.roleid = 'govia_runtime_executor'::regrole) IS DISTINCT FROM 'postgres:truefalsefalse' THEN
    RAISE EXCEPTION 'M16_S1B2R2_PREFLIGHT: govia_runtime_executor membership is not exactly the runner ADMIN grant' USING ERRCODE = '55000';
  END IF;
END;
$preflight$;

-- ---------------------------------------------------------------------------------------
-- B. postgres-owned helpers, CHECK functions and trigger functions: existing path + pg_temp last.
-- ---------------------------------------------------------------------------------------
ALTER FUNCTION gov_repo.execution_field_valid(text) SET search_path = pg_catalog, pg_temp;
ALTER FUNCTION gov_repo.frame_identity(text[]) SET search_path = pg_catalog, pg_temp;
ALTER FUNCTION gov_repo.normalized_object_identity(uuid, jsonb) SET search_path = gov_repo, pg_catalog, pg_temp;
ALTER FUNCTION gov_repo.runtime_iso(timestamp with time zone) SET search_path = pg_catalog, pg_temp;
ALTER FUNCTION gov_repo.runtime_lock(uuid, text) SET search_path = pg_catalog, pg_temp;
ALTER FUNCTION gov_repo.runtime_readback(gov_repo.runtime_observations) SET search_path = pg_catalog, pg_temp;
ALTER FUNCTION gov_repo.runtime_round_cost(numeric) SET search_path = pg_catalog, pg_temp;
ALTER FUNCTION gov_repo.runtime_same_observation(gov_repo.runtime_observations, gov_repo.runtime_observations) SET search_path = pg_catalog, pg_temp;
ALTER FUNCTION gov_repo.runtime_valid_observation(gov_repo.runtime_observations) SET search_path = pg_catalog, pg_temp;
ALTER FUNCTION gov_repo.execution_immutable() SET search_path = pg_catalog, pg_temp;
ALTER FUNCTION gov_repo.runtime_immutable() SET search_path = pg_catalog, pg_temp;
ALTER FUNCTION gov_repo.cross_signal_immutable() SET search_path = pg_catalog, pg_temp;

-- ---------------------------------------------------------------------------------------
-- C. The four runtime definers stay owned by govia_runtime_executor. ALTER FUNCTION requires acting as the owner:
--    the runner takes SET (never INHERIT) on the owner only for these four statements — the same transient grant
--    shape R1 used for the ownership transfer — and gives it back immediately.
-- ---------------------------------------------------------------------------------------
GRANT govia_runtime_executor TO CURRENT_USER WITH INHERIT FALSE, SET TRUE;
SET LOCAL ROLE govia_runtime_executor;
ALTER FUNCTION gov_repo.record_execution_snapshot(uuid, jsonb, text) SET search_path = pg_catalog, pg_temp;
ALTER FUNCTION gov_repo.admit_runtime_observation(uuid, text, gov_repo.runtime_observations) SET search_path = pg_catalog, pg_temp;
ALTER FUNCTION gov_repo.read_runtime_observation_exact(uuid, gov_repo.runtime_reference, uuid) SET search_path = pg_catalog, pg_temp;
ALTER FUNCTION gov_repo.record_cross_signal_comparison_result(uuid, text, jsonb) SET search_path = pg_catalog, pg_temp;
RESET ROLE;
REVOKE govia_runtime_executor FROM CURRENT_USER;

-- ---------------------------------------------------------------------------------------
-- D. Postflight (re-executable; the regression suite re-runs it after every hostile change).
-- ---------------------------------------------------------------------------------------
DO $postflight$
DECLARE
  v_entry record;
  v_oid oid;
  v_proc record;
  v_row record;
BEGIN
  -- D1. The exact closure: same owner, definer flag and body; config = existing path with pg_temp named last.
  FOR v_entry IN
    SELECT * FROM (VALUES
      ('gov_repo.record_execution_snapshot(uuid,jsonb,text)', 'govia_runtime_executor', true, '882431691b588cedab4a7b6c2c947d834e48a3a9a7f9a94e43dc3782d6786f29', 'search_path=pg_catalog, pg_temp'),
      ('gov_repo.admit_runtime_observation(uuid,text,gov_repo.runtime_observations)', 'govia_runtime_executor', true, '9b6284dd7ca92f092fa567ff48e9ac3eae33f906c9653e9c4b204c04f1c51a18', 'search_path=pg_catalog, pg_temp'),
      ('gov_repo.read_runtime_observation_exact(uuid,gov_repo.runtime_reference,uuid)', 'govia_runtime_executor', true, 'eebbe4336fe8e5349d73c46d84c32c832bf6c283ac65dc7ddb062da0b73ffae0', 'search_path=pg_catalog, pg_temp'),
      ('gov_repo.record_cross_signal_comparison_result(uuid,text,jsonb)', 'govia_runtime_executor', true, '3771019f3c6291e866837703f2af100609f85c37603f8e2d82161436c713e84c', 'search_path=pg_catalog, pg_temp'),
      ('gov_repo.execution_field_valid(text)', 'postgres', false, 'c7a548c0f1250f32e15090b0136aadb4a8585d2410521c20027b7ec7d5e2879d', 'search_path=pg_catalog, pg_temp'),
      ('gov_repo.frame_identity(text[])', 'postgres', false, '81291ec2aa5912a6a084e9f1bd279744b58a14d67eafccbf85e3bf12b72a69c9', 'search_path=pg_catalog, pg_temp'),
      ('gov_repo.normalized_object_identity(uuid,jsonb)', 'postgres', false, '897fbd57cab5421dc2274aea0a48af031b983ab3c01e6be0e91bd18b45e147c9', 'search_path=gov_repo, pg_catalog, pg_temp'),
      ('gov_repo.runtime_iso(timestamp with time zone)', 'postgres', false, '17ffdcbfa9fa140b522dc7278f1a645345dbc797753753c1def550199fd07934', 'search_path=pg_catalog, pg_temp'),
      ('gov_repo.runtime_lock(uuid,text)', 'postgres', false, '4c1e13e1dfb7a456040d42d68b4c743c63188fcd1f03a3f97ca4be822e81de2d', 'search_path=pg_catalog, pg_temp'),
      ('gov_repo.runtime_readback(gov_repo.runtime_observations)', 'postgres', false, '68d76e12655e836f40aec1e6b28a33ee5d3384d8e2b9275c29a5c99600334308', 'search_path=pg_catalog, pg_temp'),
      ('gov_repo.runtime_round_cost(numeric)', 'postgres', false, 'b568cbe0786e025fb051a6c65e60945cba64aee87caae8b1caef3ef197921c5e', 'search_path=pg_catalog, pg_temp'),
      ('gov_repo.runtime_same_observation(gov_repo.runtime_observations,gov_repo.runtime_observations)', 'postgres', false, '835185b20f98599ed7c762d1e22c58d1428457e774fcfa50cbaeecbaea4c0eed', 'search_path=pg_catalog, pg_temp'),
      ('gov_repo.runtime_valid_observation(gov_repo.runtime_observations)', 'postgres', false, 'e7b51812cfe04a2122ea86d24eef921905620f1f5b526cf78b1e5112a2cca852', 'search_path=pg_catalog, pg_temp'),
      ('gov_repo.execution_immutable()', 'postgres', false, '63648cb5dee27e3b39ddf34e15fa75837577ac3f71443bee0702cfbd2de68ecd', 'search_path=pg_catalog, pg_temp'),
      ('gov_repo.runtime_immutable()', 'postgres', false, 'c45520cb9f1e1ed19dbc4b0d1c4114ccaa92aa3ed8456cb314b9b3295332a0e8', 'search_path=pg_catalog, pg_temp'),
      ('gov_repo.cross_signal_immutable()', 'postgres', false, '305b0c8e05b8a3282a4ff45a1c8b0a4291f7754e0a5943dfbcd583f71f570747', 'search_path=pg_catalog, pg_temp')
    ) AS t(sig, owner_role, secdef, sha, cfg)
  LOOP
    v_oid := pg_catalog.to_regprocedure(v_entry.sig);
    IF v_oid IS NULL THEN
      RAISE EXCEPTION 'M16_S1B2R2_POSTFLIGHT: closure routine % missing', v_entry.sig;
    END IF;
    SELECT p.prosecdef, p.proowner, p.prosrc, p.proconfig INTO v_proc FROM pg_catalog.pg_proc AS p WHERE p.oid = v_oid;
    IF v_proc.prosecdef <> v_entry.secdef OR pg_catalog.pg_get_userbyid(v_proc.proowner) <> v_entry.owner_role THEN
      RAISE EXCEPTION 'M16_S1B2R2_POSTFLIGHT: % owner/definer changed', v_oid::regprocedure;
    END IF;
    IF pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(v_proc.prosrc, 'UTF8')), 'hex') <> v_entry.sha THEN
      RAISE EXCEPTION 'M16_S1B2R2_POSTFLIGHT: % body hash changed', v_oid::regprocedure;
    END IF;
    IF COALESCE(pg_catalog.array_to_string(v_proc.proconfig, ';'), '-') <> v_entry.cfg THEN
      RAISE EXCEPTION 'M16_S1B2R2_POSTFLIGHT: % config is not its pinned path with pg_temp last: %', v_oid::regprocedure, v_proc.proconfig;
    END IF;
  END LOOP;

  -- D2. Generic closure rule: every routine the runtime owner owns, and every trigger / CHECK function on a table the
  --     runtime owner can write, names pg_temp explicitly as the LAST search_path entry (never implicitly first).
  FOR v_row IN
    SELECT p.oid, p.proconfig FROM pg_catalog.pg_proc AS p WHERE p.proowner = 'govia_runtime_executor'::regrole
    UNION
    SELECT p.oid, p.proconfig FROM pg_catalog.pg_trigger AS tg JOIN pg_catalog.pg_proc AS p ON p.oid = tg.tgfoid
     WHERE NOT tg.tgisinternal
       AND (pg_catalog.has_table_privilege('govia_runtime_executor', tg.tgrelid, 'INSERT')
            OR pg_catalog.has_table_privilege('govia_runtime_executor', tg.tgrelid, 'UPDATE')
            OR pg_catalog.has_table_privilege('govia_runtime_executor', tg.tgrelid, 'DELETE'))
    UNION
    SELECT p.oid, p.proconfig FROM pg_catalog.pg_constraint AS c
      JOIN pg_catalog.pg_depend AS d ON d.classid = 'pg_catalog.pg_constraint'::regclass AND d.objid = c.oid
       AND d.refclassid = 'pg_catalog.pg_proc'::regclass
      JOIN pg_catalog.pg_proc AS p ON p.oid = d.refobjid
     WHERE c.contype = 'c' AND c.conrelid <> 0
       AND p.pronamespace NOT IN ('pg_catalog'::regnamespace, 'information_schema'::regnamespace)
       AND (pg_catalog.has_table_privilege('govia_runtime_executor', c.conrelid, 'INSERT')
            OR pg_catalog.has_table_privilege('govia_runtime_executor', c.conrelid, 'UPDATE'))
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.unnest(v_row.proconfig) AS s(setting)
                    WHERE s.setting LIKE 'search_path=%' AND s.setting ~ ', pg_temp$') THEN
      RAISE EXCEPTION 'M16_S1B2R2_POSTFLIGHT: runtime-reachable routine % does not pin pg_temp last: %', v_row.oid::regprocedure, v_row.proconfig;
    END IF;
  END LOOP;

  -- D3. Owners, grants and surface are untouched: service_role-only EXECUTE on the four, runner back to ADMIN only,
  --     application SECURITY DEFINER surface still exactly 22 non-extension-member identities. As in S1B.2R1, only
  --     extension members (pg_depend deptype = 'e', e.g. provider-managed extension routines) are excluded; every
  --     other application-executable definer, in any schema, still counts.
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc AS p
     WHERE p.proowner = 'govia_runtime_executor'::regrole
       AND (NOT pg_catalog.has_function_privilege('service_role', p.oid, 'EXECUTE')
            OR pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE')
            OR pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE')
            OR EXISTS (SELECT 1 FROM pg_catalog.aclexplode(COALESCE(p.proacl, pg_catalog.acldefault('f', p.proowner))) AS a
                        WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE'))) THEN
    RAISE EXCEPTION 'M16_S1B2R2_POSTFLIGHT: runtime routine EXECUTE is not exactly service_role';
  END IF;
  IF (SELECT pg_catalog.count(*) FROM pg_catalog.pg_proc AS p WHERE p.proowner = 'govia_runtime_executor'::regrole) <> 4 THEN
    RAISE EXCEPTION 'M16_S1B2R2_POSTFLIGHT: govia_runtime_executor does not own exactly the four runtime routines';
  END IF;
  IF (SELECT pg_catalog.string_agg(m.member::regrole::text || ':' || m.admin_option || m.inherit_option || m.set_option, ',')
        FROM pg_catalog.pg_auth_members AS m WHERE m.roleid = 'govia_runtime_executor'::regrole) IS DISTINCT FROM 'postgres:truefalsefalse' THEN
    RAISE EXCEPTION 'M16_S1B2R2_POSTFLIGHT: govia_runtime_executor membership is not exactly the runner ADMIN grant';
  END IF;
  IF (SELECT pg_catalog.count(*) FROM pg_catalog.pg_proc AS p
       WHERE p.prosecdef AND p.pronamespace NOT IN ('pg_catalog'::regnamespace, 'information_schema'::regnamespace)
         AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_depend AS d
                          WHERE d.classid = 'pg_catalog.pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e')
         AND (pg_catalog.has_function_privilege('service_role', p.oid, 'EXECUTE')
              OR pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE')
              OR pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE')
              OR EXISTS (SELECT 1 FROM pg_catalog.aclexplode(COALESCE(p.proacl, pg_catalog.acldefault('f', p.proowner))) AS a
                          WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE'))) <> 22 THEN
    RAISE EXCEPTION 'M16_S1B2R2_POSTFLIGHT: application SECURITY DEFINER surface is not exactly 22';
  END IF;
END;
$postflight$;

COMMIT;
