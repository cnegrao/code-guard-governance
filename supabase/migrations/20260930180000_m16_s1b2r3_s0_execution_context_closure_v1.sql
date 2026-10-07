-- M16-S1B.2R3 — S0 governed-wrapper execution-context closure (additive corrective; no historical migration edited).
--
-- Defect (I6, reproduced on disposable PostgreSQL 17, full primary chain + R1 + R2): the six frozen S0 governed wrappers
-- (and their guard / eligibility helper) are pinned to `search_path = pg_catalog, pg_temp`, but the inner routines they
-- execute carry their OWN `SET search_path` that omits pg_temp (`gov_repo, pg_catalog` or `pg_catalog`). While such a
-- routine runs, PostgreSQL searches the caller's temporary schema FIRST for relations and types, so the same call resolves
-- `text` / `jsonb` to pg_catalog in the wrapper frame and to a caller-created `pg_temp` domain in the inner frame:
--   * a caller domain CHECK (caller-written function) executes inside the inner routine as the wrapper owner (postgres);
--   * five of the six wrappers fail with 42804 (the inner RETURN QUERY row no longer matches the wrapper's result type).
-- This is the S0 counterpart of the S1B.2R2 runtime closure; R2 already corrected the shared helpers.
--
-- Correction: every still-affected routine in the S0 wrappers' execution closure keeps its EXISTING path with pg_temp named
-- explicitly LAST. Only proconfig changes: no body, signature, owner, ACL, return shape, replay, identity derivation,
-- tenant or canonical write behaviour changes; the frozen S0 wrappers are not touched; the application surface stays 22.
-- "Application surface" here is the S1B.2R1 closed surface: every SECURITY DEFINER routine outside pg_catalog /
-- information_schema that PUBLIC, anon, authenticated or service_role can EXECUTE, EXCLUDING only PostgreSQL
-- extension members (pg_depend classid = pg_proc, deptype = 'e'); i.e. exactly 22 GOV IA-controlled,
-- non-extension-member identities, in any schema.
-- Only postgres can CREATE in gov_repo, so the existing schema order is kept unchanged.
--
-- The closure, measured from the catalog (call graph + trigger / CHECK functions of every table the closure writes) and
-- confirmed by an exhaustive dynamic probe:
--   frozen S0 definers (already `pg_catalog, pg_temp`)  — the six *_governed_v1 wrappers,
--                                                          require_governed_write_eligibility_v1,
--                                                          lock_and_resolve_governance_session_eligibility_v1;
--   shared helpers corrected by R2 (unchanged here)     — frame_identity, normalized_object_identity,
--                                                          execution_field_valid (CHECK), execution_immutable (trigger);
--   inherits the caller's path (no SET, unchanged)      — set_updated_at (review_subjects trigger);
--   corrected here (10)                                 — apply_review_transition, record_authorized_reconciliation,
--                                                          guard_final_review_decision (reconciliation_invocations trigger),
--                                                          materialize_object_reconciliation, legacy_canonical_object_for_candidate,
--                                                          materialize_relationship_reconciliation, resolve_canonical_endpoint,
--                                                          record_technical_field_decision, record_execution_field_decision,
--                                                          technical_field_valid (technical_field_decisions / _states CHECK).
-- Not in the closure (their tables are never written by it): enforce_credential_epoch_v1, execution_policy_lock,
-- lock_technical_field_policy_head.
BEGIN;

-- ---------------------------------------------------------------------------------------
-- A. Preflight: R2 is in place and the closure is exactly as audited (owner, SECURITY DEFINER flag, body hash, config).
-- ---------------------------------------------------------------------------------------
DO $preflight$
DECLARE
  v_entry record;
  v_oid oid;
  v_proc record;
BEGIN
  IF pg_catalog.current_setting('server_version_num')::integer < 170000 THEN
    RAISE EXCEPTION 'M16_S1B2R3_PREFLIGHT: PostgreSQL 17 required' USING ERRCODE = '55000';
  END IF;
  FOR v_entry IN
    SELECT * FROM (VALUES
      ('gov_repo.apply_review_transition(uuid,text,text,text,text,text,text,text,text,timestamp with time zone,text[],text,text,text)', false, 'e6263b36e1917295ba2c464b90ae3d86ff7b0d62e0eec6b99330107d4add4518', 'search_path=gov_repo, pg_catalog'),
      ('gov_repo.record_authorized_reconciliation(uuid,text,text,text,text,text,text,text,timestamp with time zone,text,text,text,text,timestamp with time zone,text,text,text,text,text,text,timestamp with time zone,text,text,text,text,text,text,text,text[],text[],text[],text,jsonb,character)', false, '1b78728128941e5122f0bafd1b887723ed95501b5a9327a717ce5195cfb0aa59', 'search_path=gov_repo, pg_catalog'),
      ('gov_repo.guard_final_review_decision()', false, '848d87a58ddb0dc4124448b2929981808e10c60874af9f341dd9f851c51eac0b', 'search_path=gov_repo, pg_catalog'),
      ('gov_repo.materialize_object_reconciliation(uuid,text,text,text,text,text,text,text,text,text,character,timestamp with time zone)', false, '18981d6174c460fe0af8f09c4c2e7c2748a88d7223707afbdc77a0f9df2c9b9a', 'search_path=gov_repo, pg_catalog'),
      ('gov_repo.legacy_canonical_object_for_candidate(uuid,jsonb)', false, '7913275b1f3f407951779b4280e6757d09a0f4031fefc1e896ef8dbcef11f73a', 'search_path=gov_repo, pg_catalog'),
      ('gov_repo.materialize_relationship_reconciliation(uuid,text,text,text,text,text,text,text,text,text,text,timestamp with time zone,timestamp with time zone,character)', false, '37964c6315202fcc842c0692b8c235da2b05b957fe97df26c4c1dd51a98537e7', 'search_path=gov_repo, pg_catalog'),
      ('gov_repo.resolve_canonical_endpoint(uuid,jsonb)', false, '73dfd08de793fa79e7663fd11395aaec34fd1e8ca134072589c9e807347bf70e', 'search_path=gov_repo, pg_catalog'),
      ('gov_repo.record_technical_field_decision(uuid,jsonb)', false, 'eff98e7dd0b5e44b7e6bc122b9d6af7c9611f47fbf0cfe01d8c9a8a7d5575ebc', 'search_path=gov_repo, pg_catalog'),
      ('gov_repo.record_execution_field_decision(uuid,jsonb)', true, '3abc854a87d5c6a9f079f626942685bb867081cbd2c0e2313014ebc6e7b63059', 'search_path=pg_catalog'),
      ('gov_repo.technical_field_valid(text,text)', false, '2a0f0689c7185d59d83e6e5e4ce931f2443edeca4d32a45c5cffa4eeb4d96d7a', 'search_path=pg_catalog'),
      -- Shared helpers: R2 must already have pinned them (R3 is layered on R2, never instead of it).
      ('gov_repo.frame_identity(text[])', false, '81291ec2aa5912a6a084e9f1bd279744b58a14d67eafccbf85e3bf12b72a69c9', 'search_path=pg_catalog, pg_temp'),
      ('gov_repo.normalized_object_identity(uuid,jsonb)', false, '897fbd57cab5421dc2274aea0a48af031b983ab3c01e6be0e91bd18b45e147c9', 'search_path=gov_repo, pg_catalog, pg_temp'),
      ('gov_repo.execution_field_valid(text)', false, 'c7a548c0f1250f32e15090b0136aadb4a8585d2410521c20027b7ec7d5e2879d', 'search_path=pg_catalog, pg_temp'),
      ('gov_repo.execution_immutable()', false, '63648cb5dee27e3b39ddf34e15fa75837577ac3f71443bee0702cfbd2de68ecd', 'search_path=pg_catalog, pg_temp')
    ) AS t(sig, secdef, sha, cfg)
  LOOP
    v_oid := pg_catalog.to_regprocedure(v_entry.sig);
    IF v_oid IS NULL THEN
      RAISE EXCEPTION 'M16_S1B2R3_PREFLIGHT: closure routine % missing', v_entry.sig USING ERRCODE = '55000';
    END IF;
    SELECT p.prosecdef, p.proowner, p.prosrc, p.proconfig INTO v_proc FROM pg_catalog.pg_proc AS p WHERE p.oid = v_oid;
    IF v_proc.prosecdef <> v_entry.secdef OR pg_catalog.pg_get_userbyid(v_proc.proowner) <> 'postgres'
       OR pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(v_proc.prosrc, 'UTF8')), 'hex') <> v_entry.sha
       OR COALESCE(pg_catalog.array_to_string(v_proc.proconfig, ';'), '-') <> v_entry.cfg THEN
      RAISE EXCEPTION 'M16_S1B2R3_PREFLIGHT: closure routine % differs from its audited owner/definer/body/config', v_oid::regprocedure
        USING ERRCODE = '55000';
    END IF;
  END LOOP;
END;
$preflight$;

-- ---------------------------------------------------------------------------------------
-- B. Existing path + pg_temp named last (all ten are postgres-owned; the runner is their owner).
-- ---------------------------------------------------------------------------------------
ALTER FUNCTION gov_repo.apply_review_transition(uuid, text, text, text, text, text, text, text, text, timestamptz, text[], text, text, text)
  SET search_path = gov_repo, pg_catalog, pg_temp;
ALTER FUNCTION gov_repo.record_authorized_reconciliation(uuid, text, text, text, text, text, text, text, timestamptz, text, text, text, text, timestamptz,
    text, text, text, text, text, text, timestamptz, text, text, text, text, text, text, text, text[], text[], text[], text, jsonb, char)
  SET search_path = gov_repo, pg_catalog, pg_temp;
ALTER FUNCTION gov_repo.guard_final_review_decision() SET search_path = gov_repo, pg_catalog, pg_temp;
ALTER FUNCTION gov_repo.materialize_object_reconciliation(uuid, text, text, text, text, text, text, text, text, text, char, timestamptz)
  SET search_path = gov_repo, pg_catalog, pg_temp;
ALTER FUNCTION gov_repo.legacy_canonical_object_for_candidate(uuid, jsonb) SET search_path = gov_repo, pg_catalog, pg_temp;
ALTER FUNCTION gov_repo.materialize_relationship_reconciliation(uuid, text, text, text, text, text, text, text, text, text, text, timestamptz, timestamptz, char)
  SET search_path = gov_repo, pg_catalog, pg_temp;
ALTER FUNCTION gov_repo.resolve_canonical_endpoint(uuid, jsonb) SET search_path = gov_repo, pg_catalog, pg_temp;
ALTER FUNCTION gov_repo.record_technical_field_decision(uuid, jsonb) SET search_path = gov_repo, pg_catalog, pg_temp;
ALTER FUNCTION gov_repo.record_execution_field_decision(uuid, jsonb) SET search_path = pg_catalog, pg_temp;
ALTER FUNCTION gov_repo.technical_field_valid(text, text) SET search_path = pg_catalog, pg_temp;

-- ---------------------------------------------------------------------------------------
-- C. Postflight (re-executable; the regression suite re-runs it after every hostile change).
-- ---------------------------------------------------------------------------------------
DO $postflight$
DECLARE
  v_entry record;
  v_oid oid;
  v_proc record;
  v_row record;
  v_closure integer;
BEGIN
  -- C1. The exact closure: same owner, definer flag and body; config = existing path with pg_temp named last. The frozen S0
  --     definers are listed with their unchanged audited config (they are never altered by R3).
  FOR v_entry IN
    SELECT * FROM (VALUES
      ('gov_repo.apply_review_transition_governed_v1(uuid,uuid,bigint,bigint,timestamp with time zone,text,text,text,text,timestamp with time zone,text[],text,text,text)', true, 'b47d560eed2d1e2239351bd3767a6c600ef43e251ac0f13e807a2cb7a89f665f', 'search_path=pg_catalog, pg_temp'),
      ('gov_repo.record_authorized_reconciliation_governed_v1(uuid,uuid,bigint,bigint,timestamp with time zone,text,text,text,text,text,text,timestamp with time zone,text,text,text,text,timestamp with time zone,text,text,text,text,text,timestamp with time zone,text,text,text,text,text,text,text,text[],text[],text[],text,jsonb,character)', true, '9ea6a32aa6b0c8da368f5ccd51b3c50fe5c7be466c3ff124653101f8a4575ae5', 'search_path=pg_catalog, pg_temp'),
      ('gov_repo.materialize_object_reconciliation_governed_v1(uuid,uuid,bigint,bigint,timestamp with time zone,text,text,text,text,text,text,text,text,text,character,timestamp with time zone)', true, 'ad76acbb25928f7e99c43bc37555c8a1f63209b2e9f8a4dc8951590d63964bca', 'search_path=pg_catalog, pg_temp'),
      ('gov_repo.materialize_relationship_reconciliation_governed_v1(uuid,uuid,bigint,bigint,timestamp with time zone,text,text,text,text,text,text,text,text,text,text,timestamp with time zone,timestamp with time zone,character)', true, '674f7e599e0f62548c780c3d6bbe4072cd6b75916f5c2b10a9426e69da861ad2', 'search_path=pg_catalog, pg_temp'),
      ('gov_repo.record_technical_field_decision_governed_v1(uuid,uuid,bigint,bigint,timestamp with time zone,jsonb)', true, 'dfe58ec4f8f1389d282e9f439a94b58716395901eb2a460da9ad0e2ca1184b7c', 'search_path=pg_catalog, pg_temp'),
      ('gov_repo.record_execution_field_decision_governed_v1(uuid,uuid,bigint,bigint,timestamp with time zone,jsonb)', true, 'dcb2d3a0b10a179b1506a12475dddcd3fbf486e266aa53af2cdaccddc8fb2994', 'search_path=pg_catalog, pg_temp'),
      ('gov_repo.require_governed_write_eligibility_v1(uuid,uuid,bigint,bigint,timestamp with time zone)', true, '80d33b7198006c48069b82cdaf00d8bc468bb31f997e6fe42ed02e552341063e', 'search_path=pg_catalog, pg_temp'),
      ('gov_repo.lock_and_resolve_governance_session_eligibility_v1(uuid,uuid,bigint,bigint,timestamp with time zone)', true, '7a930a27a64ae675b622949dad9599642c7dadc4e0e35dfc6e14469056d2002e', 'search_path=pg_catalog, pg_temp;lock_timeout=5s'),
      ('gov_repo.apply_review_transition(uuid,text,text,text,text,text,text,text,text,timestamp with time zone,text[],text,text,text)', false, 'e6263b36e1917295ba2c464b90ae3d86ff7b0d62e0eec6b99330107d4add4518', 'search_path=gov_repo, pg_catalog, pg_temp'),
      ('gov_repo.record_authorized_reconciliation(uuid,text,text,text,text,text,text,text,timestamp with time zone,text,text,text,text,timestamp with time zone,text,text,text,text,text,text,timestamp with time zone,text,text,text,text,text,text,text,text[],text[],text[],text,jsonb,character)', false, '1b78728128941e5122f0bafd1b887723ed95501b5a9327a717ce5195cfb0aa59', 'search_path=gov_repo, pg_catalog, pg_temp'),
      ('gov_repo.guard_final_review_decision()', false, '848d87a58ddb0dc4124448b2929981808e10c60874af9f341dd9f851c51eac0b', 'search_path=gov_repo, pg_catalog, pg_temp'),
      ('gov_repo.materialize_object_reconciliation(uuid,text,text,text,text,text,text,text,text,text,character,timestamp with time zone)', false, '18981d6174c460fe0af8f09c4c2e7c2748a88d7223707afbdc77a0f9df2c9b9a', 'search_path=gov_repo, pg_catalog, pg_temp'),
      ('gov_repo.legacy_canonical_object_for_candidate(uuid,jsonb)', false, '7913275b1f3f407951779b4280e6757d09a0f4031fefc1e896ef8dbcef11f73a', 'search_path=gov_repo, pg_catalog, pg_temp'),
      ('gov_repo.materialize_relationship_reconciliation(uuid,text,text,text,text,text,text,text,text,text,text,timestamp with time zone,timestamp with time zone,character)', false, '37964c6315202fcc842c0692b8c235da2b05b957fe97df26c4c1dd51a98537e7', 'search_path=gov_repo, pg_catalog, pg_temp'),
      ('gov_repo.resolve_canonical_endpoint(uuid,jsonb)', false, '73dfd08de793fa79e7663fd11395aaec34fd1e8ca134072589c9e807347bf70e', 'search_path=gov_repo, pg_catalog, pg_temp'),
      ('gov_repo.record_technical_field_decision(uuid,jsonb)', false, 'eff98e7dd0b5e44b7e6bc122b9d6af7c9611f47fbf0cfe01d8c9a8a7d5575ebc', 'search_path=gov_repo, pg_catalog, pg_temp'),
      ('gov_repo.record_execution_field_decision(uuid,jsonb)', true, '3abc854a87d5c6a9f079f626942685bb867081cbd2c0e2313014ebc6e7b63059', 'search_path=pg_catalog, pg_temp'),
      ('gov_repo.technical_field_valid(text,text)', false, '2a0f0689c7185d59d83e6e5e4ce931f2443edeca4d32a45c5cffa4eeb4d96d7a', 'search_path=pg_catalog, pg_temp')
    ) AS t(sig, secdef, sha, cfg)
  LOOP
    v_oid := pg_catalog.to_regprocedure(v_entry.sig);
    IF v_oid IS NULL THEN
      RAISE EXCEPTION 'M16_S1B2R3_POSTFLIGHT: closure routine % missing', v_entry.sig;
    END IF;
    SELECT p.prosecdef, p.proowner, p.prosrc, p.proconfig INTO v_proc FROM pg_catalog.pg_proc AS p WHERE p.oid = v_oid;
    IF v_proc.prosecdef <> v_entry.secdef OR pg_catalog.pg_get_userbyid(v_proc.proowner) <> 'postgres' THEN
      RAISE EXCEPTION 'M16_S1B2R3_POSTFLIGHT: % owner/definer changed', v_oid::regprocedure;
    END IF;
    IF pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(v_proc.prosrc, 'UTF8')), 'hex') <> v_entry.sha THEN
      RAISE EXCEPTION 'M16_S1B2R3_POSTFLIGHT: % body hash changed', v_oid::regprocedure;
    END IF;
    IF COALESCE(pg_catalog.array_to_string(v_proc.proconfig, ';'), '-') <> v_entry.cfg THEN
      RAISE EXCEPTION 'M16_S1B2R3_POSTFLIGHT: % config is not its pinned path with pg_temp last: %', v_oid::regprocedure, v_proc.proconfig;
    END IF;
  END LOOP;

  -- C2. Generic closure rule, measured from the catalog: starting at the six S0 wrappers, follow every gov_repo routine a
  --     closure body calls by name, and every trigger / CHECK function of every gov_repo table a closure body writes. Each
  --     reached routine either pins search_path with pg_temp named LAST, or has no SET (and is not SECURITY DEFINER), so it
  --     runs under its caller's already-pinned path.
  FOR v_row IN
    WITH RECURSIVE closure(oid) AS (
      SELECT p.oid FROM pg_catalog.pg_proc AS p
       WHERE p.pronamespace = 'gov_repo'::regnamespace AND p.proname OPERATOR(pg_catalog.~~) '%\_governed\_v1'
      UNION
      SELECT n.oid FROM closure AS c
        JOIN pg_catalog.pg_proc AS cp ON cp.oid = c.oid
        CROSS JOIN LATERAL (
          SELECT p.oid FROM pg_catalog.pg_proc AS p
           WHERE p.pronamespace = 'gov_repo'::regnamespace
             AND cp.prosrc OPERATOR(pg_catalog.~*) ('\m' OPERATOR(pg_catalog.||) p.proname OPERATOR(pg_catalog.||) '\s*\(')
          UNION
          SELECT f.fn FROM pg_catalog.regexp_matches(cp.prosrc, '(?:insert\s+into|update|delete\s+from)\s+(?:gov_repo\.)?([a-z_][a-z0-9_]*)', 'gi') AS m(parts)
            CROSS JOIN LATERAL (SELECT pg_catalog.to_regclass('gov_repo.' OPERATOR(pg_catalog.||) m.parts[1]) AS rel) AS w
            CROSS JOIN LATERAL (
              SELECT tg.tgfoid AS fn FROM pg_catalog.pg_trigger AS tg WHERE tg.tgrelid = w.rel AND NOT tg.tgisinternal
              UNION
              SELECT d.refobjid FROM pg_catalog.pg_constraint AS k
                JOIN pg_catalog.pg_depend AS d ON d.classid = 'pg_catalog.pg_constraint'::regclass AND d.objid = k.oid
                 AND d.refclassid = 'pg_catalog.pg_proc'::regclass
               WHERE k.conrelid = w.rel AND k.contype = 'c') AS f
           WHERE w.rel IS NOT NULL
        ) AS n
    )
    SELECT p.oid, p.prosecdef, p.proconfig FROM closure AS c JOIN pg_catalog.pg_proc AS p ON p.oid = c.oid
     WHERE p.pronamespace NOT IN ('pg_catalog'::regnamespace, 'information_schema'::regnamespace)
  LOOP
    IF v_row.proconfig IS NULL AND NOT v_row.prosecdef THEN
      CONTINUE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.unnest(v_row.proconfig) AS s(setting)
                    WHERE s.setting OPERATOR(pg_catalog.~~) 'search_path=%' AND s.setting OPERATOR(pg_catalog.~) ', pg_temp$') THEN
      RAISE EXCEPTION 'M16_S1B2R3_POSTFLIGHT: S0 wrapper-reachable routine % does not pin pg_temp last: %', v_row.oid::regprocedure, v_row.proconfig;
    END IF;
  END LOOP;

  -- C3. Surface and grants untouched: the six wrappers stay service_role-only, the guard owner-only, and the application
  --     SECURITY DEFINER surface is still exactly 22 non-extension-member identities. As in S1B.2R1, only extension
  --     members (pg_depend deptype = 'e', e.g. provider-managed extension routines) are excluded; every other
  --     application-executable definer, in any schema, still counts.
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc AS p
     WHERE p.pronamespace = 'gov_repo'::regnamespace AND p.proname OPERATOR(pg_catalog.~~) '%\_governed\_v1'
       AND (NOT pg_catalog.has_function_privilege('service_role', p.oid, 'EXECUTE')
            OR pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE')
            OR pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE')
            OR EXISTS (SELECT 1 FROM pg_catalog.aclexplode(COALESCE(p.proacl, pg_catalog.acldefault('f', p.proowner))) AS a
                        WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE'))) THEN
    RAISE EXCEPTION 'M16_S1B2R3_POSTFLIGHT: S0 wrapper EXECUTE is not exactly service_role';
  END IF;
  IF (SELECT pg_catalog.count(*) FROM pg_catalog.pg_proc AS p
       WHERE p.pronamespace = 'gov_repo'::regnamespace AND p.proname OPERATOR(pg_catalog.~~) '%\_governed\_v1') <> 6 THEN
    RAISE EXCEPTION 'M16_S1B2R3_POSTFLIGHT: S0 wrapper set is not exactly six';
  END IF;
  SELECT pg_catalog.count(*) INTO v_closure FROM pg_catalog.pg_proc AS p
   WHERE p.oid = 'gov_repo.require_governed_write_eligibility_v1(uuid,uuid,bigint,bigint,timestamp with time zone)'::regprocedure
     AND (pg_catalog.has_function_privilege('service_role', p.oid, 'EXECUTE')
          OR pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE')
          OR pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE'));
  IF v_closure <> 0 THEN
    RAISE EXCEPTION 'M16_S1B2R3_POSTFLIGHT: governed-write guard is application-executable';
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
    RAISE EXCEPTION 'M16_S1B2R3_POSTFLIGHT: application SECURITY DEFINER surface is not exactly 22';
  END IF;
END;
$postflight$;

COMMIT;
