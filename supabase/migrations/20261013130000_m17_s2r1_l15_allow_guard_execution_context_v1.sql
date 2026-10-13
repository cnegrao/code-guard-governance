-- M17-S2R1: execution context of the D-01 root L15 ALLOW guard (DB only, ADDITIVE corrective; ACP F-S2-1).
-- Architecture (ACCEPTED / FROZEN, not modified): docs/architecture/ADR-GOVIA-RISK-INTELLIGENCE-v1.md §§12.2, 12.4, 24;
-- docs/architecture/ADR-GOVIA-M16-AUTHORITY-POLICY-M17-EXTENSION-v1.md (D-01). No historical migration is edited (S0, S1, S1R1
-- and S2 are untouched). Never run against a hosted DB from this slice.
--
-- Defect (introduced by M17-S0, found by M17-S2): gov_repo.l15_authorization_allow_guard_v1() backs the deferred constraint
-- trigger gov_repo.l15_authorization_decisions_allow_guard (AFTER INSERT ON l14_authorization_decisions, DEFERRABLE INITIALLY
-- DEFERRED, ENABLE ALWAYS). It was SECURITY INVOKER, so at the natural COMMIT of an application transaction it ran as the
-- committing role (service_role), which by design has no privilege on l14_authorization_decision_rules / governance_users /
-- organisations nor EXECUTE on gov_repo.l15_governance_permission_v1: every legitimate L15 ALLOW failed at COMMIT with
-- "permission denied" (fail-closed; never a false ALLOW). S2 worked around it by forcing the trigger IMMEDIATE inside its
-- owner-pinned definer RPCs.
--
-- Correction (ROOT, central): the guard function becomes SECURITY DEFINER, owner postgres, search_path = pg_catalog, pg_temp.
-- Its body is BYTE-IDENTICAL to the S0 body (SHA-256 asserted before and after): the subject x action -> L15 permission
-- mapping, the AUTHORITY_POLICY_VERSION basis, the exact basis policy id / version, the exact AUTHORITY_POLICY_RULE snapshot
-- with the mapped permission and requested action, the ACTIVE human of the same ACTIVE organisation and the failure
-- L14_INVALID_COMMAND / GV010 / L15_ALLOW_WITHOUT_L15_AUTHORITY are unchanged. It is read-only (no write, no dynamic SQL,
-- fully qualified references, pinned search_path; it reads only the decision's rule snapshots, governance_users and
-- organisations and calls the IMMUTABLE mapping). The trigger definition, its WHEN clause, DEFERRABLE INITIALLY DEFERRED and
-- ENABLE ALWAYS are NOT altered. EXECUTE stays owner-only (it is only the function behind the trigger).
-- SECURITY DEFINER necessity: a deferred trigger fires at COMMIT as the committing role, which by design holds no privilege on
-- the envelope stores it must verify (same rationale as the S1 / S2 deferred completeness guards).
--
-- After S2R1 the root deferred guard is independently correct at natural COMMIT. The S2 RPCs keep their (now redundant,
-- already reviewed) SET CONSTRAINTS ... IMMEDIATE; future L15 writers (S3+) MUST NOT rely on it.
BEGIN;

-- ---------------------------------------------------------------------------------------------------------------------
-- A. Preflight: exactly the post-M17-S2 catalog and the exact S0 guard, or abort with nothing applied.
-- ---------------------------------------------------------------------------------------------------------------------
DO $preflight$
DECLARE
  v_proc record;
BEGIN
  IF pg_catalog.current_setting('server_version_num')::integer NOT BETWEEN 170000 AND 179999 OR current_user <> 'postgres'
     OR pg_catalog.current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'M17_S2R1_PREFLIGHT: PostgreSQL 17 / postgres / READ COMMITTED required' USING ERRCODE = '55000';
  END IF;
  IF pg_catalog.to_regprocedure('gov_repo.l15_admit_scenario_version_v1(uuid,uuid,bigint,bigint,timestamp with time zone,text,uuid,uuid,text,uuid,text,text[],text[],text[],text,text,text)') IS NULL
     OR pg_catalog.to_regclass('gov_repo.l15_risk_methodology_states') IS NULL THEN
    RAISE EXCEPTION 'M17_S2R1_PREFLIGHT: the M17-S2 catalog is required' USING ERRCODE = '55000';
  END IF;
  SELECT p.prosecdef, pg_catalog.pg_get_userbyid(p.proowner) AS owner_role, p.proconfig,
         pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p.prosrc, 'UTF8')), 'hex') AS sha
  INTO v_proc FROM pg_catalog.pg_proc AS p WHERE p.oid = 'gov_repo.l15_authorization_allow_guard_v1()'::regprocedure;
  IF v_proc.prosecdef OR v_proc.owner_role <> 'postgres' OR v_proc.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, pg_temp']
     OR v_proc.sha <> 'ee7885662da87a4946ad06596dbcd9f1af9bbb52de0e86fb7b16fd17731b5236' THEN
    RAISE EXCEPTION 'M17_S2R1_PREFLIGHT: l15_authorization_allow_guard_v1 is not the exact S0 SECURITY INVOKER guard' USING ERRCODE = '55000';
  END IF;
  IF (SELECT pg_catalog.count(*) FROM pg_catalog.pg_proc AS p WHERE p.pronamespace = 'gov_repo'::regnamespace
      AND p.proname LIKE 'l15\_%' ESCAPE '\' AND p.prosecdef) <> 14 THEN
    RAISE EXCEPTION 'M17_S2R1_PREFLIGHT: L15 definer inventory is not the post-S2 14' USING ERRCODE = '55000';
  END IF;
END;
$preflight$;

-- Snapshot of every gov_repo constraint, every non-internal trigger (with its full definition) and every routine other than
-- the corrected guard (body / owner / config / security / ACL): the postflight proves nothing else changed.
CREATE TEMPORARY TABLE m17_s2r1_constraint_snapshot ON COMMIT DROP AS
  SELECT k.conrelid::regclass::text AS rel, k.conname::text AS conname, pg_catalog.pg_get_constraintdef(k.oid) AS def
  FROM pg_catalog.pg_constraint AS k JOIN pg_catalog.pg_class AS c ON c.oid = k.conrelid
  WHERE c.relnamespace = 'gov_repo'::regnamespace;
CREATE TEMPORARY TABLE m17_s2r1_trigger_snapshot ON COMMIT DROP AS
  SELECT t.tgrelid::regclass::text AS rel, t.tgname::text AS tgname, t.tgenabled::text AS enabled,
         pg_catalog.pg_get_triggerdef(t.oid) AS def
  FROM pg_catalog.pg_trigger AS t JOIN pg_catalog.pg_class AS c ON c.oid = t.tgrelid
  WHERE c.relnamespace = 'gov_repo'::regnamespace AND NOT t.tgisinternal;
CREATE TEMPORARY TABLE m17_s2r1_routine_snapshot ON COMMIT DROP AS
  SELECT p.oid::regprocedure::text AS sig, p.prosecdef AS secdef, pg_catalog.pg_get_userbyid(p.proowner)::text AS owner_role,
         COALESCE(pg_catalog.array_to_string(p.proconfig, ';'), '-') AS cfg, COALESCE(p.proacl::text, '-') AS acl,
         pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p.prosrc, 'UTF8')), 'hex') AS sha
  FROM pg_catalog.pg_proc AS p
  WHERE p.pronamespace = 'gov_repo'::regnamespace AND p.oid <> 'gov_repo.l15_authorization_allow_guard_v1()'::regprocedure;

-- ---------------------------------------------------------------------------------------------------------------------
-- B. The root guard: same signature, same body (verbatim from M17-S0), SECURITY DEFINER, owner postgres, pinned search_path.
-- ---------------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION gov_repo.l15_authorization_allow_guard_v1()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $guard$
DECLARE
  v_permission text := gov_repo.l15_governance_permission_v1(NEW.subject_kind, NEW.requested_action);
BEGIN
  IF v_permission IS NULL
     OR NEW.authority_basis IS DISTINCT FROM 'AUTHORITY_POLICY_VERSION'
     OR NEW.basis_authority_policy_id IS NULL OR NEW.basis_version_id IS NULL
     OR NOT EXISTS (
       SELECT 1 FROM gov_repo.l14_authorization_decision_rules AS r
       WHERE r.organisation_id = NEW.organisation_id AND r.authorization_decision_id = NEW.authorization_decision_id
         AND r.permission_origin = 'AUTHORITY_POLICY_RULE' AND r.permission = v_permission
         AND r.requested_action = NEW.requested_action
         AND r.basis_authority_policy_id = NEW.basis_authority_policy_id AND r.basis_version_id = NEW.basis_version_id)
     OR NOT EXISTS (
       SELECT 1 FROM gov_repo.governance_users AS u
       JOIN gov_repo.organisations AS o ON o.organisation_id = u.organisation_id
       WHERE u.user_id = NEW.actor_user_id AND u.organisation_id = NEW.organisation_id
         AND u.status::text = 'active' AND o.is_active) THEN
    RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'L15_ALLOW_WITHOUT_L15_AUTHORITY';
  END IF;
  RETURN NULL;
END;
$guard$;
ALTER FUNCTION gov_repo.l15_authorization_allow_guard_v1() OWNER TO postgres;

-- C. Owner-only: it exists exclusively as the function behind the existing ENABLE ALWAYS deferred constraint trigger.
REVOKE ALL ON FUNCTION gov_repo.l15_authorization_allow_guard_v1()
  FROM PUBLIC, anon, authenticated, service_role, govia_l15_machine_intake_caller;

COMMENT ON FUNCTION gov_repo.l15_authorization_allow_guard_v1() IS 'M17-S0 D-01 root L15 ALLOW guard (body unchanged); M17-S2R1: owner-only SECURITY DEFINER so the deferred constraint trigger l15_authorization_decisions_allow_guard is independently correct at the natural COMMIT of an application (service_role) transaction. Read-only. Future L15 writers MUST NOT rely on SET CONSTRAINTS ... IMMEDIATE for it.';

-- ---------------------------------------------------------------------------------------------------------------------
-- D. Postflight over the effective post-S2R1 catalog.
-- ---------------------------------------------------------------------------------------------------------------------
DO $postflight$
DECLARE
  v_proc record;
BEGIN
  -- P1. The corrected guard: SECURITY DEFINER, owner postgres, exact pinned config, byte-identical S0 body, owner-only ACL.
  SELECT p.prosecdef, pg_catalog.pg_get_userbyid(p.proowner) AS owner_role, p.proconfig, p.provolatile,
         pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p.prosrc, 'UTF8')), 'hex') AS sha, p.oid
  INTO v_proc FROM pg_catalog.pg_proc AS p WHERE p.oid = 'gov_repo.l15_authorization_allow_guard_v1()'::regprocedure;
  IF NOT v_proc.prosecdef OR v_proc.owner_role <> 'postgres' OR v_proc.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, pg_temp']
     OR v_proc.sha <> 'ee7885662da87a4946ad06596dbcd9f1af9bbb52de0e86fb7b16fd17731b5236'
     OR EXISTS (SELECT 1 FROM pg_catalog.aclexplode(COALESCE((SELECT p.proacl FROM pg_catalog.pg_proc AS p WHERE p.oid = v_proc.oid),
                  pg_catalog.acldefault('f', (SELECT p.proowner FROM pg_catalog.pg_proc AS p WHERE p.oid = v_proc.oid)))) AS a
                WHERE a.grantee <> 'postgres'::regrole)
     OR pg_catalog.has_function_privilege('service_role', v_proc.oid, 'EXECUTE')
     OR pg_catalog.has_function_privilege('anon', v_proc.oid, 'EXECUTE')
     OR pg_catalog.has_function_privilege('authenticated', v_proc.oid, 'EXECUTE')
     OR pg_catalog.has_function_privilege('govia_l15_machine_intake_caller', v_proc.oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'M17_S2R1_POSTFLIGHT: the root ALLOW guard is not the exact owner-only SECURITY DEFINER correction';
  END IF;
  -- P2. Nothing else changed: every constraint, every trigger (definition, WHEN clause, deferrability, ENABLE ALWAYS) and every
  --     other gov_repo routine (body, owner, config, security, ACL) is byte-identical; no routine / relation was added.
  IF EXISTS (SELECT 1 FROM m17_s2r1_constraint_snapshot AS b
             FULL JOIN (SELECT k.conrelid::regclass::text AS rel, k.conname::text AS conname, pg_catalog.pg_get_constraintdef(k.oid) AS def
                        FROM pg_catalog.pg_constraint AS k JOIN pg_catalog.pg_class AS c ON c.oid = k.conrelid
                        WHERE c.relnamespace = 'gov_repo'::regnamespace) AS a ON a.rel = b.rel AND a.conname = b.conname
             WHERE a.def IS DISTINCT FROM b.def)
     OR EXISTS (SELECT 1 FROM m17_s2r1_trigger_snapshot AS b
                FULL JOIN (SELECT t.tgrelid::regclass::text AS rel, t.tgname::text AS tgname, t.tgenabled::text AS enabled,
                                  pg_catalog.pg_get_triggerdef(t.oid) AS def
                           FROM pg_catalog.pg_trigger AS t JOIN pg_catalog.pg_class AS c ON c.oid = t.tgrelid
                           WHERE c.relnamespace = 'gov_repo'::regnamespace AND NOT t.tgisinternal) AS a
                  ON a.rel = b.rel AND a.tgname = b.tgname
                WHERE a.def IS DISTINCT FROM b.def OR a.enabled IS DISTINCT FROM b.enabled)
     OR EXISTS (SELECT 1 FROM m17_s2r1_routine_snapshot AS b
                FULL JOIN (SELECT p.oid::regprocedure::text AS sig, p.prosecdef AS secdef, pg_catalog.pg_get_userbyid(p.proowner)::text AS owner_role,
                                  COALESCE(pg_catalog.array_to_string(p.proconfig, ';'), '-') AS cfg, COALESCE(p.proacl::text, '-') AS acl,
                                  pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p.prosrc, 'UTF8')), 'hex') AS sha
                           FROM pg_catalog.pg_proc AS p
                           WHERE p.pronamespace = 'gov_repo'::regnamespace
                             AND p.oid <> 'gov_repo.l15_authorization_allow_guard_v1()'::regprocedure) AS a ON a.sig = b.sig
                WHERE (a.secdef, a.owner_role, a.cfg, a.acl, a.sha) IS DISTINCT FROM (b.secdef, b.owner_role, b.cfg, b.acl, b.sha)) THEN
    RAISE EXCEPTION 'M17_S2R1_POSTFLIGHT: a constraint / trigger / routine other than the root guard changed';
  END IF;
  -- P3. The trigger still invokes exactly the corrected guard, AFTER INSERT, DEFERRABLE INITIALLY DEFERRED, ENABLE ALWAYS.
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger AS t
                 WHERE t.tgrelid = 'gov_repo.l14_authorization_decisions'::regclass AND t.tgname = 'l15_authorization_decisions_allow_guard'
                   AND t.tgfoid = 'gov_repo.l15_authorization_allow_guard_v1()'::regprocedure AND t.tgenabled = 'A'
                   AND t.tgdeferrable AND t.tginitdeferred AND t.tgconstraint <> 0) THEN
    RAISE EXCEPTION 'M17_S2R1_POSTFLIGHT: the root deferred ALLOW trigger changed';
  END IF;
  -- P4. Surface: L15 definers 14 -> 15 (the owner-only guard); the application definer surface (EXECUTE by service_role / anon /
  --     authenticated / PUBLIC) is unchanged at 55; the machine intake surface is exactly the two S1 RPCs and every machine
  --     LOGIN still satisfies the closed S1R1 surface; service_role holds no L15 table privilege.
  IF (SELECT pg_catalog.count(*) FROM pg_catalog.pg_proc AS p WHERE p.pronamespace = 'gov_repo'::regnamespace
      AND p.proname LIKE 'l15\_%' ESCAPE '\' AND p.prosecdef) <> 15
     OR (SELECT pg_catalog.count(*) FROM pg_catalog.pg_proc AS p
         WHERE p.prosecdef AND p.pronamespace NOT IN ('pg_catalog'::regnamespace, 'information_schema'::regnamespace)
           AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_depend AS d WHERE d.classid = 'pg_catalog.pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e')
           AND (pg_catalog.has_function_privilege('service_role', p.oid, 'EXECUTE')
                OR pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE')
                OR pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE')
                OR EXISTS (SELECT 1 FROM pg_catalog.aclexplode(COALESCE(p.proacl, pg_catalog.acldefault('f', p.proowner))) AS a
                            WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE'))) <> 55
     OR (SELECT pg_catalog.array_agg(p.proname::text ORDER BY p.proname::text COLLATE "C") FROM pg_catalog.pg_proc AS p
         WHERE p.pronamespace = 'gov_repo'::regnamespace AND pg_catalog.has_function_privilege('govia_l15_machine_intake_caller', p.oid, 'EXECUTE'))
        IS DISTINCT FROM ARRAY['l15_admit_machine_hypothesis_v1','l15_admit_machine_signal_v1']
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members AS m JOIN pg_catalog.pg_roles AS r ON r.oid = m.member
                WHERE m.roleid = 'govia_l15_machine_intake_caller'::regrole AND r.rolcanlogin AND r.rolname <> 'postgres'
                  AND NOT gov_repo.l15_machine_role_safe_v1(r.oid, r.rolname::text))
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_class AS c
                CROSS JOIN pg_catalog.unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN']) AS pr(p)
                WHERE c.relnamespace = 'gov_repo'::regnamespace AND c.relname LIKE 'l15\_%' ESCAPE '\' AND c.relkind = 'r'
                  AND pg_catalog.has_table_privilege('service_role', c.oid, pr.p)) THEN
    RAISE EXCEPTION 'M17_S2R1_POSTFLIGHT: definer / machine / ACL surface violated';
  END IF;
END;
$postflight$;

COMMIT;
