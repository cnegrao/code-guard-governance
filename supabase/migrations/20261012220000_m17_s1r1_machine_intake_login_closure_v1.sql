-- M17-S1R1: closed privilege surface of the ACTUAL machine intake LOGIN (ACP delta review of M17-S1, F-S1-4 hardening).
-- Additive corrective on top of 20261012210000_m17_s1_signals_hypotheses_support_v1.sql. No historical migration is edited;
-- no store, matrix, FK, adapter, replay rule, M16 object, F2 object or Discovery Machine object is changed.
--
-- Problem: gov_repo.l15_require_machine_intake_identity_v1() bounded the NOLOGIN capability role but not the LOGIN that uses
-- it: a LOGIN holding govia_l15_machine_intake_caller could also hold unrelated memberships / grants and still pass.
--
-- Fix: an L15-specific closed machine-login safety predicate gov_repo.l15_machine_role_safe_v1(oid, text), modelled on the
-- Discovery Machine machine_role_safe_v1 pattern (that frozen function and its roles are NOT touched or reused), evaluated on
-- session_user inside every machine intake call. The LOGIN must:
--   * be a LOGIN, not postgres / service_role / authenticated / anon, not SUPERUSER / BYPASSRLS / CREATEDB / CREATEROLE /
--     REPLICATION, and not expired (rolvaliduntil);
--   * have exactly one membership edge — govia_l15_machine_intake_caller, without ADMIN — and be a member (directly or
--     transitively, through ANY edge: INHERIT / SET / dormant) of no other role; the capability itself holds no membership;
--   * hold no CREATE on the database and no CREATE on any non-temporary schema;
--   * hold no table / column / sequence privilege on any relation outside pg_catalog / information_schema;
--   * be able to EXECUTE no SECURITY DEFINER routine outside pg_catalog / information_schema and no gov_repo routine at all,
--     except exactly l15_admit_machine_signal_v1 and l15_admit_machine_hypothesis_v1 (so no L14 RPC, no L15 member / read RPC
--     and no future propose / decide / admit-registry surface).
-- Effective application surface: USAGE on gov_repo + EXECUTE on the two intake RPCs (+ inherent catalog access).
--
-- Tenancy (ACP decision): the machine caller is a PLATFORM technical capability, not a tenant principal. Platform-wide technical
-- capability != tenant / business authority. Tenancy stays enforced per call: caller-supplied organisation must be active; subject,
-- relationship-state triple, every support target and every cited signal must be same-tenant by exact composite identity; no
-- governance authority is created. Hosted activation / provisioning of an actual machine LOGIN is outside this branch and remains
-- subject to the production security gates.
BEGIN;

DO $preflight$
BEGIN
  IF pg_catalog.current_setting('server_version_num')::integer < 170000 OR current_user <> 'postgres' THEN
    RAISE EXCEPTION 'M17_S1R1_PREFLIGHT: PostgreSQL 17 / postgres required' USING ERRCODE = '55000';
  END IF;
  IF pg_catalog.to_regprocedure('gov_repo.l15_require_machine_intake_identity_v1()') IS NULL
     OR pg_catalog.to_regprocedure('gov_repo.l15_admit_machine_signal_v1(uuid,text,text,text,text,text,text,text,text,text,text,text,text,text,numeric,timestamp with time zone,text,text,text,uuid,text[],text[])') IS NULL
     OR pg_catalog.to_regprocedure('gov_repo.l15_admit_machine_hypothesis_v1(uuid,text,text,text,text,text,text,text,text,text,text,text,text,text,text,numeric,uuid[])') IS NULL
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'govia_l15_machine_intake_caller' AND NOT rolcanlogin)
     OR pg_catalog.to_regprocedure('gov_repo.l15_machine_role_safe_v1(oid,text)') IS NOT NULL THEN
    RAISE EXCEPTION 'M17_S1R1_PREFLIGHT: exact post-M17-S1 catalog required (and S1R1 not yet applied)' USING ERRCODE = '55000';
  END IF;
END;
$preflight$;

-- Owner-only, catalog-only, exact-name identity. No regrole parsing of caller strings; no secret storage.
CREATE FUNCTION gov_repo.l15_machine_role_safe_v1(p_oid oid, p_name text) RETURNS boolean
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $fn$
  SELECT EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles AS r
    WHERE r.oid = p_oid AND r.rolname::text COLLATE "C" = p_name COLLATE "C"
      AND r.rolcanlogin
      AND NOT (r.rolsuper OR r.rolbypassrls OR r.rolcreatedb OR r.rolcreaterole OR r.rolreplication)
      AND (r.rolvaliduntil IS NULL OR r.rolvaliduntil > pg_catalog.clock_timestamp())
      AND r.rolname NOT IN ('postgres','service_role','authenticated','anon')
      -- Membership graph: exactly one edge, to the capability, without ADMIN; nothing else reachable through ANY edge.
      AND EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members AS m
                  WHERE m.member = r.oid AND m.roleid = 'govia_l15_machine_intake_caller'::regrole AND NOT m.admin_option)
      AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members AS m
                      WHERE m.member = r.oid AND (m.roleid <> 'govia_l15_machine_intake_caller'::regrole OR m.admin_option))
      AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members AS m WHERE m.member = 'govia_l15_machine_intake_caller'::regrole)
      AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles AS t
                      WHERE t.oid NOT IN (r.oid, 'govia_l15_machine_intake_caller'::regrole)
                        AND pg_catalog.pg_has_role(r.oid, t.oid, 'MEMBER'))
      -- No CREATE on the database or on any non-temporary schema.
      AND NOT pg_catalog.has_database_privilege(r.oid, pg_catalog.current_database(), 'CREATE')
      AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_namespace AS n
                      WHERE n.nspname NOT LIKE 'pg\_temp\_%' ESCAPE '\' AND n.nspname NOT LIKE 'pg\_toast\_temp\_%' ESCAPE '\'
                        AND pg_catalog.has_schema_privilege(r.oid, n.oid, 'CREATE'))
      -- No relation privilege outside the system catalogs (tables, views, matviews, partitions, foreign tables, sequences).
      AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_class AS c JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
                      WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg\_toast%' ESCAPE '\'
                        AND ((c.relkind IN ('r','v','m','p','f')
                              AND (pg_catalog.has_table_privilege(r.oid, c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN')
                                   OR pg_catalog.has_any_column_privilege(r.oid, c.oid, 'SELECT,INSERT,UPDATE,REFERENCES')))
                          OR (c.relkind = 'S' AND pg_catalog.has_sequence_privilege(r.oid, c.oid, 'USAGE,SELECT,UPDATE'))))
      -- Routines: no SECURITY DEFINER outside the system catalogs and no gov_repo routine at all, except the two intake RPCs.
      AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc AS p JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
                      WHERE n.nspname NOT IN ('pg_catalog','information_schema')
                        AND (p.prosecdef OR n.nspname = 'gov_repo')
                        AND pg_catalog.has_function_privilege(r.oid, p.oid, 'EXECUTE')
                        AND p.oid NOT IN (
                          'gov_repo.l15_admit_machine_signal_v1(uuid,text,text,text,text,text,text,text,text,text,text,text,text,text,numeric,timestamp with time zone,text,text,text,uuid,text[],text[])'::regprocedure,
                          'gov_repo.l15_admit_machine_hypothesis_v1(uuid,text,text,text,text,text,text,text,text,text,text,text,text,text,text,numeric,uuid[])'::regprocedure)))
$fn$;
REVOKE ALL ON FUNCTION gov_repo.l15_machine_role_safe_v1(oid,text) FROM PUBLIC, anon, authenticated, service_role, govia_l15_machine_intake_caller;

-- The runtime identity check now validates the actual session_user against the closed surface. Same signature, owner, ACL,
-- volatility and pinned search_path; the two intake RPC bodies (and their inventory hashes) are unchanged.
CREATE OR REPLACE FUNCTION gov_repo.l15_require_machine_intake_identity_v1() RETURNS text
LANGUAGE plpgsql STABLE SET search_path = pg_catalog, pg_temp AS $fn$
DECLARE
  v_oid oid;
BEGIN
  SELECT r.oid INTO v_oid FROM pg_catalog.pg_roles AS r WHERE r.rolname = session_user;
  IF v_oid IS NULL OR NOT gov_repo.l15_machine_role_safe_v1(v_oid, session_user::text) THEN
    RAISE EXCEPTION 'L15_INTAKE_IDENTITY_INELIGIBLE' USING ERRCODE = '42501';
  END IF;
  RETURN session_user::text;
END;
$fn$;
REVOKE ALL ON FUNCTION gov_repo.l15_require_machine_intake_identity_v1() FROM PUBLIC, anon, authenticated, service_role, govia_l15_machine_intake_caller;

COMMENT ON ROLE govia_l15_machine_intake_caller IS
  'M17-S1 PLATFORM technical intake CAPABILITY (not tenant / business authority): EXECUTE on the two L15 machine intake RPCs only; no table privilege; never service_role; never a governance decision actor. The LOGIN using it must pass gov_repo.l15_machine_role_safe_v1 (closed surface: this membership only, no other role / privilege).';

DO $postflight$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_proc AS p WHERE p.oid IN ('gov_repo.l15_machine_role_safe_v1(oid,text)'::regprocedure,
               'gov_repo.l15_require_machine_intake_identity_v1()'::regprocedure)
               AND (p.prosecdef OR p.proowner <> 'postgres'::regrole OR NOT ('search_path=pg_catalog, pg_temp' = ANY (p.proconfig))
                    OR EXISTS (SELECT 1 FROM pg_catalog.aclexplode(COALESCE(p.proacl, pg_catalog.acldefault('f', p.proowner))) AS a
                               WHERE a.grantee <> p.proowner))) THEN
    RAISE EXCEPTION 'M17_S1R1_POSTFLIGHT: identity helpers must be owner-only SECURITY INVOKER with a pinned search_path';
  END IF;
  IF (SELECT pg_catalog.count(*) FROM pg_catalog.pg_proc WHERE pronamespace = 'gov_repo'::regnamespace
        AND proname LIKE 'l15\_%' ESCAPE '\' AND prosecdef) <> 7
     OR (SELECT pg_catalog.count(*) FROM pg_catalog.pg_proc AS p
         WHERE p.prosecdef AND p.pronamespace NOT IN ('pg_catalog'::regnamespace, 'information_schema'::regnamespace)
           AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_depend AS d
                            WHERE d.classid = 'pg_catalog.pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e')
           AND (pg_catalog.has_function_privilege('service_role', p.oid, 'EXECUTE')
                OR pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE')
                OR pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE'))) <> 49
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members AS m WHERE m.member = 'govia_l15_machine_intake_caller'::regrole) THEN
    RAISE EXCEPTION 'M17_S1R1_POSTFLIGHT: definer surface / capability membership changed';
  END IF;
  -- No pre-existing machine LOGIN may silently keep an enlarged surface: report (fail) any current member that is unsafe. The
  -- creating owner's automatic PG16+ ADMIN grant (postgres, never an intake identity: the helper refuses it) is excluded.
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members AS m JOIN pg_catalog.pg_roles AS r ON r.oid = m.member
             WHERE m.roleid = 'govia_l15_machine_intake_caller'::regrole AND r.rolcanlogin AND r.rolname <> 'postgres'
               AND NOT gov_repo.l15_machine_role_safe_v1(r.oid, r.rolname::text)) THEN
    RAISE EXCEPTION 'M17_S1R1_POSTFLIGHT: an existing machine intake LOGIN has an enlarged privilege surface';
  END IF;
END;
$postflight$;

COMMIT;
