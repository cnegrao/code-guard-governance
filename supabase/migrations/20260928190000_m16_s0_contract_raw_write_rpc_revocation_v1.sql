-- M16-S0.3.3D: expand/contract CONTRACT phase (DB only, additive/append-only).
-- S0.3.3C cut every active HUMAN write path (review transitions, reconciliation
-- decisions, materialization, technical/execution field decisions) over to the six
-- *_governed_v1 wrappers added in S0.3.3B. This migration revokes service_role's
-- (and, defensively, PUBLIC/anon/authenticated's) EXECUTE on the seven now-unused
-- raw functions those wrappers call internally, closing the direct-RPC bypass that
-- S0.3.3B deliberately left open during the EXPAND phase:
--   1 gov_repo.apply_review_transition
--   2 gov_repo.record_authorized_reconciliation
--   3 gov_repo.materialize_object_reconciliation
--   4 gov_repo.materialize_relationship_reconciliation
--   5 gov_repo.record_technical_field_decision
--   6 gov_repo.record_execution_field_decision
--   7 gov_repo.record_authorization_decision (S0.3.3A: no active production caller)
--
-- Nothing else changes: the six governed wrappers, the owner-only guard
-- (gov_repo.require_governed_write_eligibility_v1) and the canonical eligibility
-- helper (gov_repo.lock_and_resolve_governance_session_eligibility_v1) keep their
-- already-frozen ACLs untouched by this migration — this file only removes
-- privileges, it grants none. No prior migration is modified. No table/sequence
-- privilege changes (the broad service_role table-DML grant from
-- 20260818013113_grant_service_role_gov_repo_access.sql remains
-- PRODUCTION_SECURITY_GATE_RESIDUAL; out of scope here). Never run against a
-- hosted DB from this slice.
--
-- The seven functions remain fully defined and owned by postgres: a SECURITY
-- DEFINER wrapper's internal call to its underlying function runs as the
-- wrapper's owner (postgres), which always retains implicit owner privileges
-- regardless of this REVOKE — only the DIRECT-callable ACL entries for
-- PUBLIC/anon/authenticated/service_role are removed here, so the governed
-- wrappers keep working unchanged.
--
-- The dormant DETERMINISTIC_RULE (machine) producers that still bind to the
-- ungoverned gov_repo.apply_review_transition port method
-- (apps/dashboard/lib/governance/discovery-intake.ts's runGovernanceDiscoveryScan,
-- and apps/dashboard/lib/governance/multivendor-exchange.ts's importAzureSqlCatalog,
-- via packages/governance-review/src/inbound-exchange.ts) have ZERO active
-- production callers (S0.3.3A/D static inventory) and remain intentionally
-- DORMANT / NOT ACTIVATABLE through the current service_role DB boundary after
-- this revocation. This migration deliberately does NOT create a machine
-- wrapper, does NOT activate them, and does NOT redirect them through a HUMAN
-- wrapper. A future explicit, owner-controlled machine write boundary is a
-- separate, not-yet-designed slice.
BEGIN;

REVOKE ALL ON FUNCTION gov_repo.apply_review_transition(
  uuid, text, text, text, text, text, text, text, text, timestamptz, text[], text, text, text
) FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION gov_repo.record_authorization_decision(
  text, uuid, text, text, text, text, text, text, text, timestamptz, text
) FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION gov_repo.record_authorized_reconciliation(
  uuid, text, text, text, text, text, text, text, timestamptz, text, text, text, text, timestamptz,
  text, text, text, text, text, text, timestamptz, text, text, text, text, text, text, text,
  text[], text[], text[], text, jsonb, char
) FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION gov_repo.materialize_object_reconciliation(
  uuid, text, text, text, text, text, text, text, text, text, char, timestamptz
) FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION gov_repo.materialize_relationship_reconciliation(
  uuid, text, text, text, text, text, text, text, text, text, text, timestamptz, timestamptz, char
) FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION gov_repo.record_technical_field_decision(uuid, jsonb)
FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION gov_repo.record_execution_field_decision(uuid, jsonb)
FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------
-- ACL postflight. Fails closed (raises, aborting this entire migration transaction) if the
-- final ACL shape is wrong for ANY of: the seven contracted raw functions, the six governed
-- wrappers (must be UNCHANGED by this migration), or the owner-only guard (also unchanged).
-- ---------------------------------------------------------------------------------------
DO $postflight$
DECLARE
  v_raw oid;
  v_wrapper oid;
  v_guard oid := 'gov_repo.require_governed_write_eligibility_v1(uuid, uuid, bigint, bigint, timestamptz)'::regprocedure;
  v_role text;
  v_raw_sigs text[] := ARRAY[
    'gov_repo.apply_review_transition(uuid, text, text, text, text, text, text, text, text, timestamptz, text[], text, text, text)',
    'gov_repo.record_authorization_decision(text, uuid, text, text, text, text, text, text, text, timestamptz, text)',
    'gov_repo.record_authorized_reconciliation(uuid, text, text, text, text, text, text, text, timestamptz, text, text, text, text, timestamptz, text, text, text, text, text, text, timestamptz, text, text, text, text, text, text, text, text[], text[], text[], text, jsonb, char)',
    'gov_repo.materialize_object_reconciliation(uuid, text, text, text, text, text, text, text, text, text, char, timestamptz)',
    'gov_repo.materialize_relationship_reconciliation(uuid, text, text, text, text, text, text, text, text, text, text, timestamptz, timestamptz, char)',
    'gov_repo.record_technical_field_decision(uuid, jsonb)',
    'gov_repo.record_execution_field_decision(uuid, jsonb)'
  ];
  v_sig text;
BEGIN
  IF array_length(v_raw_sigs, 1) <> 7 THEN
    RAISE EXCEPTION 'M16_CONTRACT_POSTFLIGHT: expected exactly seven raw signatures to check';
  END IF;

  FOREACH v_sig IN ARRAY v_raw_sigs LOOP
    v_raw := v_sig::regprocedure;
    FOREACH v_role IN ARRAY ARRAY['service_role', 'anon', 'authenticated'] LOOP
      IF has_function_privilege(v_role, v_raw, 'EXECUTE') THEN
        RAISE EXCEPTION 'M16_CONTRACT_POSTFLIGHT: raw function % still executable by %', v_raw::regprocedure, v_role;
      END IF;
    END LOOP;
    IF EXISTS (SELECT 1 FROM pg_proc p, LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
               WHERE p.oid = v_raw AND a.privilege_type = 'EXECUTE' AND a.grantee = 0) THEN
      RAISE EXCEPTION 'M16_CONTRACT_POSTFLIGHT: raw function % has PUBLIC EXECUTE', v_raw::regprocedure;
    END IF;
  END LOOP;

  -- Guard remains owner-only, exactly as S0.3.3B left it.
  IF EXISTS (SELECT 1 FROM pg_proc p, LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
             WHERE p.oid = v_guard AND a.privilege_type = 'EXECUTE' AND a.grantee <> p.proowner) THEN
    RAISE EXCEPTION 'M16_CONTRACT_POSTFLIGHT: guard has EXECUTE for a non-owner';
  END IF;
  FOREACH v_role IN ARRAY ARRAY['service_role', 'anon', 'authenticated'] LOOP
    IF has_function_privilege(v_role, v_guard, 'EXECUTE') THEN
      RAISE EXCEPTION 'M16_CONTRACT_POSTFLIGHT: guard executable by %', v_role;
    END IF;
  END LOOP;

  -- The six governed wrappers must remain exactly as S0.3.3B left them:
  -- service_role EXECUTE, nothing for PUBLIC/anon/authenticated.
  FOR v_wrapper IN
    SELECT p.oid FROM pg_proc p
    WHERE p.pronamespace = 'gov_repo'::regnamespace AND p.proname LIKE '%\_governed\_v1' ESCAPE '\'
  LOOP
    IF EXISTS (SELECT 1 FROM pg_proc p, LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
               WHERE p.oid = v_wrapper AND a.privilege_type = 'EXECUTE' AND a.grantee = 0) THEN
      RAISE EXCEPTION 'M16_CONTRACT_POSTFLIGHT: wrapper % has PUBLIC EXECUTE', v_wrapper::regprocedure;
    END IF;
    FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
      IF has_function_privilege(v_role, v_wrapper, 'EXECUTE') THEN
        RAISE EXCEPTION 'M16_CONTRACT_POSTFLIGHT: wrapper % executable by %', v_wrapper::regprocedure, v_role;
      END IF;
    END LOOP;
    IF NOT has_function_privilege('service_role', v_wrapper, 'EXECUTE') THEN
      RAISE EXCEPTION 'M16_CONTRACT_POSTFLIGHT: wrapper % not executable by service_role', v_wrapper::regprocedure;
    END IF;
  END LOOP;
  IF (SELECT count(*) FROM pg_proc p WHERE p.pronamespace = 'gov_repo'::regnamespace
        AND p.proname LIKE '%\_governed\_v1' ESCAPE '\') <> 6 THEN
    RAISE EXCEPTION 'M16_CONTRACT_POSTFLIGHT: expected exactly six governed wrappers to remain';
  END IF;
END;
$postflight$;

COMMIT;
