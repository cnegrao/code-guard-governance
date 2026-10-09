-- M16-S1C.1R1: surgical commit-boundary closure of the S1C.1 RESPONSIBILITY_ASSIGNMENT Party dependency (DB only, ADDITIVE
-- on S1C.2). Architecture: docs/architecture/ADR-GOVIA-OWNERSHIP-BUSINESS-POLICY-CONTROL-ENRICHMENT-v1.md §§17-18 (O49).
-- No historical migration is edited (20261008220000 stays byte-identical). Never run against a hosted DB from this slice.
--
-- Defect (found during S1C.2): the S1C.1 decide RPC checked the pinned VALIDATED Party state through
-- l14_governance_party_valid_state_v1 without holding the GovernanceParty registry subject guard, which the S1B.1 Party
-- RPCs take EXCLUSIVELY. A Party REVOKE could therefore commit between the dependency check and the responsibility fact's
-- commit. The resolver failed closed afterwards (UNKNOWN), but dependency validity was not protected at the commitment
-- boundary (§17).
--
-- Fix:
--   A. Preflight: the exact S1C.2 catalog (37 approved definers, the merged S1C.1 decide body), or abort.
--   B. gov_repo.l14_lock_party_dependency_guard_shared_v1(org, party): owner-only SECURITY INVOKER; SHARED advisory lock on
--      the EXACT key of gov_repo.l14_lock_registry_subject_guard_v1(org, 'GOVERNANCE_PARTY', party::text):
--      frame_identity([org, 'l14-registry-subject-guard-v1', 'GOVERNANCE_PARTY', party]). No new lock namespace.
--   C. CREATE OR REPLACE of gov_repo.l14_decide_responsibility_assignment_proposal_v1 only (same signature, SECURITY DEFINER,
--      owner postgres, ACL, search_path, lock_timeout); the body is the merged S1C.1 body plus, for VALIDATE only, the shared
--      Party dependency guard. Lock order: AP SHARED -> Party dependency SHARED -> CARDINALITY (single-owner roles) -> fact
--      KEY -> command. The Party RPCs take AP SHARED -> Party registry subject EXCLUSIVE -> command: no cycle. The lock is a
--      transaction-scoped advisory lock, held to commit. REVOKE / REJECT / DEFER are unchanged (a dependency-invalid
--      assignment can still be ended explicitly). Party identity, lineage-only state pin, no PII, no auto-repin unchanged.
--   D. Postflight over the EFFECTIVE catalog: the S1C.2 postflight with the new decide body hash pinned (surface stays 37,
--      canonical-owner class stays 27), plus the guard key / mode / lock-order contract.
-- F2 untouched; 11 canonical kinds / 12 relationship types.
BEGIN;

-- ---------------------------------------------------------------------------------------
-- A. Preflight: the exact S1C.2 catalog, or abort with nothing applied.
-- ---------------------------------------------------------------------------------------
DO $preflight$
DECLARE
  v_crypto name := (SELECT e.extnamespace::regnamespace::name FROM pg_catalog.pg_extension AS e WHERE e.extname = 'pgcrypto');
  v_vector name := (SELECT e.extnamespace::regnamespace::name FROM pg_catalog.pg_extension AS e WHERE e.extname = 'vector');
  v_entry record;
  v_oid oid;
  v_proc record;
BEGIN
  IF pg_catalog.current_setting('server_version_num')::integer < 170000 THEN
    RAISE EXCEPTION 'M16_S1C1R1_PREFLIGHT: PostgreSQL 17 required' USING ERRCODE = '55000';
  END IF;
  IF v_crypto IS NULL OR v_vector IS NULL THEN
    RAISE EXCEPTION 'M16_S1C1R1_PREFLIGHT: pgcrypto / vector unresolved' USING ERRCODE = '55000';
  END IF;
  -- Exact S1C.2 l14 relation set (tables only).
  IF (SELECT pg_catalog.array_agg(c.relname::text ORDER BY c.relname::text COLLATE "C")
      FROM pg_catalog.pg_class AS c
      WHERE c.relnamespace = 'gov_repo'::regnamespace AND c.relname LIKE 'l14\_%' ESCAPE '\'
        AND c.relkind IN ('r','p','v','m','S','f')) IS DISTINCT FROM ARRAY[
    'l14_authority_policies','l14_authority_policy_heads','l14_authority_policy_rules',
    'l14_authority_policy_states','l14_authority_policy_version_proposals','l14_authority_policy_versions',
    'l14_authorization_decision_roles','l14_authorization_decision_rules','l14_authorization_decisions',
    'l14_business_context_assignment_heads','l14_business_context_assignment_proposals',
    'l14_business_context_assignment_states','l14_command_results','l14_control_definition_heads',
    'l14_control_definition_proposals','l14_control_definition_states','l14_control_definition_versions',
    'l14_control_definitions','l14_domain_admissions','l14_domain_heads','l14_domain_proposals','l14_domain_states',
    'l14_fact_states','l14_governance_decisions','l14_governance_parties','l14_governance_party_heads',
    'l14_governance_party_proposals','l14_governance_party_states','l14_policy_admissions',
    'l14_policy_version_admissions','l14_policy_version_heads','l14_policy_version_proposals',
    'l14_policy_version_states','l14_proposals','l14_registry_states','l14_responsibility_assignment_heads',
    'l14_responsibility_assignment_proposals','l14_responsibility_assignment_states','l14_support_links'] THEN
    RAISE EXCEPTION 'M16_S1C1R1_PREFLIGHT: unexpected l14 relation set (S1C.2 horizon expected)' USING ERRCODE = '55000';
  END IF;
  -- The exact S1B.1 Party registry subject guard key this slice shares, and no S1C.1R1 helper yet.
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc AS p
                 WHERE p.oid = pg_catalog.to_regprocedure('gov_repo.l14_lock_registry_subject_guard_v1(uuid,text,text)')
                   AND p.prosrc LIKE '%pg_advisory_xact_lock(%'
                   AND p.prosrc LIKE '%ARRAY[p_organisation_id::text, ''l14-registry-subject-guard-v1'', p_subject_kind, p_subject_key]%')
     OR pg_catalog.to_regprocedure('gov_repo.l14_governance_party_valid_state_v1(uuid,uuid,timestamp with time zone,timestamp with time zone)') IS NULL
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_proc AS p WHERE p.pronamespace = 'gov_repo'::regnamespace
                  AND p.proname = 'l14_lock_party_dependency_guard_shared_v1') THEN
    RAISE EXCEPTION 'M16_S1C1R1_PREFLIGHT: Party registry guard key missing or S1C.1R1 already applied' USING ERRCODE = '55000';
  END IF;
  -- The exact 37 approved application definers of the S1C.2 catalog (owner class, body, config): the RESPONSIBILITY decide
  -- RPC must still be the merged S1C.1 body.
  FOR v_entry IN
    SELECT m.sig, m.owner_role, m.sha, m.cfg FROM (VALUES
      ('gov_repo.apply_review_transition_governed_v1(uuid,uuid,bigint,bigint,timestamp with time zone,text,text,text,text,timestamp with time zone,text[],text,text,text)', 'postgres', 'b47d560eed2d1e2239351bd3767a6c600ef43e251ac0f13e807a2cb7a89f665f', 'search_path=pg_catalog, pg_temp'),
      ('gov_repo.materialize_object_reconciliation_governed_v1(uuid,uuid,bigint,bigint,timestamp with time zone,text,text,text,text,text,text,text,text,text,character,timestamp with time zone)', 'postgres', 'ad76acbb25928f7e99c43bc37555c8a1f63209b2e9f8a4dc8951590d63964bca', 'search_path=pg_catalog, pg_temp'),
      ('gov_repo.materialize_relationship_reconciliation_governed_v1(uuid,uuid,bigint,bigint,timestamp with time zone,text,text,text,text,text,text,text,text,text,text,timestamp with time zone,timestamp with time zone,character)', 'postgres', '674f7e599e0f62548c780c3d6bbe4072cd6b75916f5c2b10a9426e69da861ad2', 'search_path=pg_catalog, pg_temp'),
      ('gov_repo.record_authorized_reconciliation_governed_v1(uuid,uuid,bigint,bigint,timestamp with time zone,text,text,text,text,text,text,timestamp with time zone,text,text,text,text,timestamp with time zone,text,text,text,text,text,timestamp with time zone,text,text,text,text,text,text,text,text[],text[],text[],text,jsonb,character)', 'postgres', '9ea6a32aa6b0c8da368f5ccd51b3c50fe5c7be466c3ff124653101f8a4575ae5', 'search_path=pg_catalog, pg_temp'),
      ('gov_repo.record_execution_field_decision_governed_v1(uuid,uuid,bigint,bigint,timestamp with time zone,jsonb)', 'postgres', 'dcb2d3a0b10a179b1506a12475dddcd3fbf486e266aa53af2cdaccddc8fb2994', 'search_path=pg_catalog, pg_temp'),
      ('gov_repo.record_technical_field_decision_governed_v1(uuid,uuid,bigint,bigint,timestamp with time zone,jsonb)', 'postgres', 'dfe58ec4f8f1389d282e9f439a94b58716395901eb2a460da9ad0e2ca1184b7c', 'search_path=pg_catalog, pg_temp'),
      ('gov_repo.l14_admit_authority_policy_version_v1(uuid,uuid,bigint,bigint,timestamp with time zone,text,uuid,uuid,text,jsonb,text,text[],text)', 'postgres', '3d732c3bb2615648bc333eb1b5c3c7971541b882b4745a388f737d1ac40b249e', 'search_path=pg_catalog, pg_temp;lock_timeout=5s'),
      ('gov_repo.l14_submit_proposal_v1(uuid,uuid,bigint,bigint,timestamp with time zone,text,text,text,text,uuid,uuid,text,timestamp with time zone,uuid,uuid,text,text[],text)', 'postgres', '28d1cace2a21401721c8e090f1d21864d7e3fcc51a8ff5e0574444c4f963e1c1', 'search_path=pg_catalog, pg_temp;lock_timeout=5s'),
      ('gov_repo.l14_decide_authority_policy_proposal_v1(uuid,uuid,bigint,bigint,timestamp with time zone,text,uuid,text,text,uuid,text,text[],text)', 'postgres', 'ac02a255a31a4e1c3da6cdba12ff9515ecb36d9362a79547aa8d140edb95cf94', 'search_path=pg_catalog, pg_temp;lock_timeout=5s'),
      ('gov_repo.l14_admit_governance_party_v1(uuid,uuid,bigint,bigint,timestamp with time zone,text,text,text,text,text,text[],text)', 'postgres', 'ca1e2ddf0342352993d07583c65a9f1be8b0779807aca39637e63ad62e977ac0', 'search_path=pg_catalog, pg_temp;lock_timeout=5s'),
      ('gov_repo.l14_submit_governance_party_proposal_v1(uuid,uuid,bigint,bigint,timestamp with time zone,text,text,text,uuid,text,timestamp with time zone,uuid,uuid,text,text[],text)', 'postgres', '6e9edcd7d85a9fc4c65cd4da8c96953e95798ab1b75e6356c00c348d1827cc5f', 'search_path=pg_catalog, pg_temp;lock_timeout=5s'),
      ('gov_repo.l14_decide_governance_party_proposal_v1(uuid,uuid,bigint,bigint,timestamp with time zone,text,uuid,text,text,uuid,text,text[],text)', 'postgres', '9cdf1725acbd78be30124efd1bb8e5852dcc419f479685404bde309b99bf90b3', 'search_path=pg_catalog, pg_temp;lock_timeout=5s'),
      ('gov_repo.l14_admit_governance_policy_v1(uuid,uuid,bigint,bigint,timestamp with time zone,text,text,text,text,text,text,text,text[],text)', 'postgres', 'f839e64c08421c460da352c1da18072713398a33c4e737a18c0584956f0b45f7', 'search_path=pg_catalog, pg_temp;lock_timeout=5s'),
      ('gov_repo.l14_admit_policy_version_v1(uuid,uuid,bigint,bigint,timestamp with time zone,text,uuid,uuid,text,text,text,text,text[],text)', 'postgres', '51ef06ec273da9bc69e5f7e72e41b6f383d102eadff5abf5f98ad2aec802dab3', 'search_path=pg_catalog, pg_temp;lock_timeout=5s'),
      ('gov_repo.l14_read_policy_descriptors_v1(uuid,uuid,bigint,bigint,timestamp with time zone,uuid)', 'postgres', '1704ba7d75fe6024c13f534f2b1f844d26d4ef3b3c3f1bf6c9444a974ba9b285', 'search_path=pg_catalog, pg_temp;lock_timeout=5s'),
      ('gov_repo.l14_submit_policy_version_proposal_v1(uuid,uuid,bigint,bigint,timestamp with time zone,text,text,text,uuid,uuid,text,timestamp with time zone,uuid,uuid,text,text[],text)', 'postgres', '949991c697678fac776936fd1910f3a32a0df010bfdb46b85ba117817f638a0c', 'search_path=pg_catalog, pg_temp;lock_timeout=5s'),
      ('gov_repo.l14_decide_policy_version_proposal_v1(uuid,uuid,bigint,bigint,timestamp with time zone,text,uuid,text,text,uuid,text,text[],text)', 'postgres', '198fe481b3f057a42cb6a583fe8cbbb11facc660679bb3381e2d7476efec9d99', 'search_path=pg_catalog, pg_temp;lock_timeout=5s'),
      ('gov_repo.l14_admit_domain_v1(uuid,uuid,bigint,bigint,timestamp with time zone,text,text,text,text,text,text,text[],text)', 'postgres', '333c32d4393ffc87a8df82bd1bd619fbbb2e34390fe95b779ced0920a7bb4f28', 'search_path=pg_catalog, pg_temp;lock_timeout=5s'),
      ('gov_repo.l14_submit_domain_proposal_v1(uuid,uuid,bigint,bigint,timestamp with time zone,text,text,text,text,text,timestamp with time zone,uuid,uuid,text,text[],text)', 'postgres', '7c2a80b56275e61e49a0dec96daf772363ad24e576a90d11e98377f7696fdf63', 'search_path=pg_catalog, pg_temp;lock_timeout=5s'),
      ('gov_repo.l14_decide_domain_proposal_v1(uuid,uuid,bigint,bigint,timestamp with time zone,text,uuid,text,text,uuid,text,text[],text)', 'postgres', '4d99534b4bfe2400a8db30b13ada0f1fadc71477efc2f94e09890a23cba9aa27', 'search_path=pg_catalog, pg_temp;lock_timeout=5s'),
      ('gov_repo.l14_admit_control_definition_version_v1(uuid,uuid,bigint,bigint,timestamp with time zone,text,uuid,uuid,text,uuid,text,text,text,text,text,text,text[],text)', 'postgres', '0486d46fa5f2c7fc5fd996bbef096e52602c6aeccd07a7c5c608952e5ee8fe4e', 'search_path=pg_catalog, pg_temp;lock_timeout=5s'),
      ('gov_repo.l14_submit_control_definition_proposal_v1(uuid,uuid,bigint,bigint,timestamp with time zone,text,text,text,uuid,uuid,text,timestamp with time zone,uuid,uuid,text,text[],text)', 'postgres', '8acea9a25d2c90ca9b732f9972cf458dcc41ec009f1bc79a8cee31f8e0b16063', 'search_path=pg_catalog, pg_temp;lock_timeout=5s'),
      ('gov_repo.l14_decide_control_definition_proposal_v1(uuid,uuid,bigint,bigint,timestamp with time zone,text,uuid,text,text,uuid,text,text[],text)', 'postgres', '2a71aa16e1aa43a4f916506afb8e682c689d6c5d78945ea5ebddb589a523587a', 'search_path=pg_catalog, pg_temp;lock_timeout=5s'),
      ('gov_repo.l14_submit_responsibility_assignment_proposal_v1(uuid,uuid,bigint,bigint,timestamp with time zone,text,text,text,text,text,text,uuid,uuid,timestamp with time zone,timestamp with time zone,uuid,uuid,text,text[],text)', 'postgres', '6cef279e89f21ac1aa8bab5b1605811cb4e9e5ca2cadf566263d371204800b53', 'search_path=pg_catalog, pg_temp;lock_timeout=5s'),
      ('gov_repo.l14_decide_responsibility_assignment_proposal_v1(uuid,uuid,bigint,bigint,timestamp with time zone,text,uuid,text,text,uuid,text,text[],text)', 'postgres', '78fd7cf5aa854a7ca00f70d79ae718a9f6d71de84b9d912008aad43e7c73acb4', 'search_path=pg_catalog, pg_temp;lock_timeout=5s'),
      ('gov_repo.l14_submit_business_context_assignment_proposal_v1(uuid,uuid,bigint,bigint,timestamp with time zone,text,text,text,text,text,text,text,uuid,timestamp with time zone,timestamp with time zone,uuid,uuid,text,text[],text)', 'postgres', '394b272b29caab3d1638ec49614616f9bbc207739581430e06a7846824a80244', 'search_path=pg_catalog, pg_temp;lock_timeout=5s'),
      ('gov_repo.l14_decide_business_context_assignment_proposal_v1(uuid,uuid,bigint,bigint,timestamp with time zone,text,uuid,text,text,uuid,text,text[],text)', 'postgres', 'e6370ee81510635c38ea359d4a328669e2d813a175c0618a3896e9024b82f656', 'search_path=pg_catalog, pg_temp;lock_timeout=5s'),
      ('gov_repo.ledger_append(character varying,text,character varying,uuid,uuid,inet,uuid,jsonb)', 'govia_ledger_executor', '8137f591bdd717ef18cbdc8b6146aab349626903aa9d080cebe55806190ae830', 'search_path=pg_catalog, {crypto}, pg_temp'),
      ('gov_repo.ledger_verify(bigint,bigint)', 'govia_ledger_executor', 'd52b7bc1d274cb11dd7ef4d3424d4056deba1df9846eb1195007f3695e091ec4', 'search_path=pg_catalog, {crypto}, pg_temp'),
      ('gov_repo.record_execution_snapshot(uuid,jsonb,text)', 'govia_runtime_executor', '882431691b588cedab4a7b6c2c947d834e48a3a9a7f9a94e43dc3782d6786f29', 'search_path=pg_catalog, pg_temp'),
      ('gov_repo.admit_runtime_observation(uuid,text,gov_repo.runtime_observations)', 'govia_runtime_executor', '9b6284dd7ca92f092fa567ff48e9ac3eae33f906c9653e9c4b204c04f1c51a18', 'search_path=pg_catalog, pg_temp'),
      ('gov_repo.read_runtime_observation_exact(uuid,gov_repo.runtime_reference,uuid)', 'govia_runtime_executor', 'eebbe4336fe8e5349d73c46d84c32c832bf6c283ac65dc7ddb062da0b73ffae0', 'search_path=pg_catalog, pg_temp'),
      ('gov_repo.record_cross_signal_comparison_result(uuid,text,jsonb)', 'govia_runtime_executor', '3771019f3c6291e866837703f2af100609f85c37603f8e2d82161436c713e84c', 'search_path=pg_catalog, pg_temp'),
      ('gov_repo.agent_compliance_gaps(uuid)', 'govia_legacy_read_executor', '2e27745223cfdd30f1ba41ffd6b0d0cb8fb61d1edf6cd5776be9915709d140a6', 'search_path=pg_catalog, pg_temp'),
      ('gov_repo.agent_graph_traverse(uuid,integer,gov_repo.edge_relationship[],boolean)', 'govia_legacy_read_executor', '568376c6d24590874162cc7e2db555219d501eb0f60168c30e7963cf8996c555', 'search_path=pg_catalog, pg_temp'),
      ('gov_repo.agent_semantic_search({vector},uuid,character varying,integer,numeric)', 'govia_legacy_read_executor', '0a53e2a91844531902963aa4ca55f6eaa375b15d09898f46ebbe3bbe19213f4f', 'search_path=pg_catalog, {vschema}, pg_temp'),
      ('gov_repo.recompute_risk_propagation(uuid,uuid)', 'govia_legacy_graph_executor', 'b5f6edac53c2c5acdda60729e5ad9de0956e407c829aaedbea3f4002e793b96c', 'search_path=pg_catalog, pg_temp')
    ) AS m(sig, owner_role, sha, cfg)
  LOOP
    v_oid := pg_catalog.to_regprocedure(pg_catalog.replace(v_entry.sig, '{vector}', pg_catalog.quote_ident(v_vector) || '.vector'));
    IF v_oid IS NULL THEN
      RAISE EXCEPTION 'M16_S1C1R1_PREFLIGHT: approved routine % missing', v_entry.sig USING ERRCODE = '55000';
    END IF;
    SELECT p.prosecdef, p.proowner, p.prosrc, p.proconfig INTO v_proc FROM pg_catalog.pg_proc AS p WHERE p.oid = v_oid;
    IF NOT v_proc.prosecdef OR pg_catalog.pg_get_userbyid(v_proc.proowner) <> v_entry.owner_role
       OR pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(v_proc.prosrc, 'UTF8')), 'hex') <> v_entry.sha
       OR COALESCE(pg_catalog.array_to_string(v_proc.proconfig, ';'), '-') <>
          pg_catalog.replace(pg_catalog.replace(v_entry.cfg, '{crypto}', pg_catalog.quote_ident(v_crypto)), '{vschema}', pg_catalog.quote_ident(v_vector)) THEN
      RAISE EXCEPTION 'M16_S1C1R1_PREFLIGHT: approved routine % differs from its S1C.2 owner/body/config', v_oid::regprocedure
        USING ERRCODE = '55000';
    END IF;
  END LOOP;
  IF (SELECT pg_catalog.count(*) FROM pg_catalog.pg_proc AS p
       WHERE p.prosecdef AND p.pronamespace NOT IN ('pg_catalog'::regnamespace, 'information_schema'::regnamespace)
         AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_depend AS d
                          WHERE d.classid = 'pg_catalog.pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e')
         AND (pg_catalog.has_function_privilege('service_role', p.oid, 'EXECUTE')
              OR pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE')
              OR pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE')
              OR EXISTS (SELECT 1 FROM pg_catalog.aclexplode(COALESCE(p.proacl, pg_catalog.acldefault('f', p.proowner))) AS a
                          WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE'))) <> 37 THEN
    RAISE EXCEPTION 'M16_S1C1R1_PREFLIGHT: application SECURITY DEFINER surface is not exactly the 37 S1C.2 baseline' USING ERRCODE = '55000';
  END IF;
END;
$preflight$;

-- ---------------------------------------------------------------------------------------
-- B. Owner-only SHARED Party dependency guard (the exact S1B.1 registry subject key, shared mode). Held to commit.
-- ---------------------------------------------------------------------------------------
CREATE FUNCTION gov_repo.l14_lock_party_dependency_guard_shared_v1(p_organisation_id uuid, p_governance_party_id uuid)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SET search_path = pg_catalog, pg_temp
AS $guard$
BEGIN
  IF p_organisation_id IS NULL OR p_governance_party_id IS NULL THEN
    RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'GUARD_KEY_INVALID';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock_shared(pg_catalog.hashtextextended(
    gov_repo.frame_identity(ARRAY[p_organisation_id::text, 'l14-registry-subject-guard-v1', 'GOVERNANCE_PARTY', p_governance_party_id::text]), 0));
END;
$guard$;

-- ---------------------------------------------------------------------------------------
-- C. The RESPONSIBILITY decide RPC, replaced in place (merged S1C.1 body + the VALIDATE-only shared Party dependency guard).
-- ---------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION gov_repo.l14_decide_responsibility_assignment_proposal_v1(
  p_verified_organisation_id uuid,
  p_verified_actor_user_id uuid,
  p_verified_session_iat bigint,
  p_verified_session_exp bigint,
  p_verified_credential_epoch timestamptz,
  p_command_id text,
  p_proposal_id uuid,
  p_outcome text,
  p_reason_code text,
  p_expected_current_state_id uuid,         -- NULL = explicit expected-none (no state of the exact fact key yet)
  p_support_status text,
  p_support_evidence_ids text[],
  p_caller_fingerprint text                 -- assertion only; PostgreSQL recomputes
)
RETURNS TABLE (
  replay boolean, command_id text, command_kind text, subject_kind text, outcome text, command_fingerprint text,
  authorization_decision_id uuid, authorization_result text, deny_reason text, expectation_kind text,
  expected_current_state_id uuid, proposal_id uuid, governance_decision_id uuid, target_kind text,
  target_canonical_object_id text, responsibility_role text, governance_party_id uuid, party_validated_state_id uuid,
  fact_state_id uuid, state_kind text, effective_from timestamptz, effective_to timestamptz, recorded_at timestamptz
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
SET lock_timeout = '5s'
AS $decide_responsibility$
#variable_conflict use_column
DECLARE
  v_org uuid := p_verified_organisation_id;
  v_actor uuid := p_verified_actor_user_id;
  v_role_ids uuid[];
  v_support text[];
  v_fingerprint text;
  v_proposal record;
  v_single_owner boolean;
  v_head_found boolean;
  v_head_latest uuid;
  v_latest_kind text;
  v_latest_from timestamptz;
  v_latest_to timestamptz;
  v_target_state_id uuid;
  v_has_basis boolean := false;
  v_basis_policy uuid;
  v_basis_version uuid;
  v_basis_hash text;
  v_deny text;
  v_ordinals integer[];
  v_self boolean;
  v_temporal text := 'IMMEDIATE';
  v_effective_from timestamptz;
  v_effective_to timestamptz;
  v_now timestamptz;
  v_authz uuid := pg_catalog.gen_random_uuid();
  v_decision uuid := pg_catalog.gen_random_uuid();
  v_state uuid := pg_catalog.gen_random_uuid();
  v_state_kind text;
BEGIN
  -- 1. Base session eligibility. Tenant + actor + CURRENT locked persisted roles come ONLY from here.
  SELECT b.role_ids INTO v_role_ids
  FROM gov_repo.l14_session_basis_v1(v_org, v_actor, p_verified_session_iat, p_verified_session_exp,
    p_verified_credential_epoch) AS b;

  -- 2. Syntactic shape.
  PERFORM gov_repo.l14_validate_command_id_v1(p_command_id, p_caller_fingerprint);
  IF p_outcome IS NULL OR p_outcome NOT IN ('VALIDATE','REJECT','DEFER','REVOKE')
     OR p_reason_code IS NULL OR p_reason_code NOT IN (
       'RESPONSIBILITY_ASSIGNMENT_VALIDATED','RESPONSIBILITY_ASSIGNMENT_REJECTED','RESPONSIBILITY_ASSIGNMENT_DEFERRED',
       'RESPONSIBILITY_ASSIGNMENT_REVOKED')
     OR NOT ((p_outcome = 'VALIDATE' AND p_reason_code = 'RESPONSIBILITY_ASSIGNMENT_VALIDATED')
          OR (p_outcome = 'REJECT' AND p_reason_code = 'RESPONSIBILITY_ASSIGNMENT_REJECTED')
          OR (p_outcome = 'DEFER' AND p_reason_code = 'RESPONSIBILITY_ASSIGNMENT_DEFERRED')
          OR (p_outcome = 'REVOKE' AND p_reason_code = 'RESPONSIBILITY_ASSIGNMENT_REVOKED')) THEN
    RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'DECISION_VOCABULARY_INVALID';
  END IF;
  -- The immutable proposal defines the command identity (fingerprint + guard keys); it is the only row read before
  -- replay arbitration, and it can never change or disappear.
  SELECT p.proposal_id, p.intent, p.source_class, p.submitted_by_actor_user_id,
         t.target_kind, t.target_canonical_object_id, t.responsibility_role, t.governance_party_id, t.party_kind,
         t.party_validated_state_id, t.requested_effective_from, t.requested_effective_to, t.target_state_id
  INTO v_proposal
  FROM gov_repo.l14_proposals AS p
  JOIN gov_repo.l14_responsibility_assignment_proposals AS t
    ON t.organisation_id = p.organisation_id AND t.proposal_id = p.proposal_id
  WHERE p.organisation_id = v_org AND p.proposal_id = p_proposal_id AND p.subject_kind = 'RESPONSIBILITY_ASSIGNMENT';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'PROPOSAL_UNRESOLVED';
  END IF;
  IF (p_outcome = 'VALIDATE' AND v_proposal.intent <> 'VALIDATE')
     OR (p_outcome = 'REVOKE' AND v_proposal.intent <> 'REVOKE') THEN
    RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'OUTCOME_INTENT_INCOMPATIBLE';
  END IF;
  v_single_owner := v_proposal.responsibility_role IN ('BUSINESS_OWNER','TECHNICAL_OWNER','DATA_OWNER');

  -- 3-4. Syntactic support, then the PostgreSQL-authoritative fingerprint.
  v_support := gov_repo.l14_support_syntactic_parts_v1(p_support_status, p_support_evidence_ids);
  v_fingerprint := gov_repo.l14_sha256_frame_v1(
    ARRAY['L14_COMMAND_FINGERPRINT_V1', 'DECIDE_PROPOSAL', v_org::text, v_actor::text, p_outcome, p_reason_code,
          v_proposal.proposal_id::text, 'RESPONSIBILITY_ASSIGNMENT', v_proposal.intent, v_proposal.source_class,
          v_proposal.target_kind, v_proposal.target_canonical_object_id, v_proposal.responsibility_role,
          v_proposal.governance_party_id::text, v_proposal.party_validated_state_id::text]
    || CASE WHEN v_proposal.requested_effective_from IS NULL THEN ARRAY['IMMEDIATE']
            ELSE ARRAY['EXPLICIT', gov_repo.l14_canonical_instant_v1(v_proposal.requested_effective_from)] END
    || CASE WHEN v_proposal.requested_effective_to IS NULL THEN ARRAY['NO_EFFECTIVE_TO']
            ELSE ARRAY['EFFECTIVE_TO', gov_repo.l14_canonical_instant_v1(v_proposal.requested_effective_to)] END
    || CASE WHEN v_proposal.target_state_id IS NULL THEN ARRAY['NO_TARGET_STATE']
            ELSE ARRAY['TARGET_STATE', v_proposal.target_state_id::text] END
    || CASE WHEN p_expected_current_state_id IS NULL THEN ARRAY['EXPECTED_NONE']
            ELSE ARRAY['EXPECTED_CURRENT', p_expected_current_state_id::text] END
    || v_support);
  IF v_fingerprint IS DISTINCT FROM p_caller_fingerprint THEN
    RAISE EXCEPTION 'L14_FINGERPRINT_MISMATCH' USING ERRCODE = 'GV008', DETAIL = 'CALLER_FINGERPRINT_DIFFERS';
  END IF;

  -- 5-7. Guards in the fixed order: AP SHARED -> Party dependency SHARED (VALIDATE only; the exact S1B.1 registry subject
  --      key, held to commit) -> target + single-owner role CARDINALITY -> exact fact KEY -> command; then replay
  --      arbitration BEFORE any resolution.
  PERFORM gov_repo.l14_lock_authority_policy_guard_shared_v1(v_org);
  IF p_outcome = 'VALIDATE' THEN
    PERFORM gov_repo.l14_lock_party_dependency_guard_shared_v1(v_org, v_proposal.governance_party_id);
  END IF;
  IF v_single_owner THEN
    PERFORM gov_repo.l14_lock_fact_subject_guard_v1(v_org, 'RESPONSIBILITY_ASSIGNMENT',
      ARRAY['CARDINALITY', v_proposal.target_kind, v_proposal.target_canonical_object_id, v_proposal.responsibility_role]);
  END IF;
  PERFORM gov_repo.l14_lock_fact_subject_guard_v1(v_org, 'RESPONSIBILITY_ASSIGNMENT',
    ARRAY['KEY', v_proposal.target_kind, v_proposal.target_canonical_object_id, v_proposal.responsibility_role,
          v_proposal.governance_party_id::text]);
  PERFORM gov_repo.l14_lock_command_guard_v1(v_org, p_command_id);
  IF gov_repo.l14_replay_arbitrate_v1(v_org, p_command_id, v_fingerprint) THEN
    PERFORM 1 FROM gov_repo.l14_session_basis_v1(v_org, v_actor, p_verified_session_iat,
      p_verified_session_exp, p_verified_credential_epoch);
    RETURN QUERY SELECT * FROM gov_repo.l14_responsibility_assignment_command_result_v1(v_org, p_command_id, true);
    RETURN;
  END IF;

  -- 8. Resolution (all under the guards): terminality, exact target, head expectation, per-key lineage rules.
  PERFORM 1 FROM gov_repo.l14_governance_decisions AS d
  WHERE d.organisation_id = v_org AND d.proposal_id = p_proposal_id AND d.outcome IN ('VALIDATE','REJECT','REVOKE');
  IF FOUND THEN
    RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'PROPOSAL_TERMINAL';
  END IF;
  PERFORM 1 FROM gov_repo.canonical_objects AS o
  WHERE o.organisation_id = v_org AND o.canonical_object_id = v_proposal.target_canonical_object_id
    AND o.kind = v_proposal.target_kind;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'TARGET_OBJECT_UNRESOLVED';
  END IF;
  -- No head row = no governed state of this exact fact key yet (created by the first state-appending decision).
  SELECT h.latest_state_id INTO v_head_latest
  FROM gov_repo.l14_responsibility_assignment_heads AS h
  WHERE h.organisation_id = v_org AND h.target_kind = v_proposal.target_kind
    AND h.target_canonical_object_id = v_proposal.target_canonical_object_id
    AND h.responsibility_role = v_proposal.responsibility_role AND h.governance_party_id = v_proposal.governance_party_id;
  v_head_found := FOUND;
  IF p_expected_current_state_id IS NULL AND v_head_latest IS NOT NULL THEN
    RAISE EXCEPTION 'L14_STALE_EXPECTATION' USING ERRCODE = 'GV009', DETAIL = 'RESPONSIBILITY_ASSIGNMENT_STATE_EXISTS';
  END IF;
  IF p_expected_current_state_id IS DISTINCT FROM v_head_latest THEN
    RAISE EXCEPTION 'L14_STALE_EXPECTATION' USING ERRCODE = 'GV009', DETAIL = 'RESPONSIBILITY_ASSIGNMENT_STATE_EXPECTATION_MISMATCH';
  END IF;
  IF v_head_latest IS NOT NULL THEN
    SELECT s.state_kind, s.effective_from, s.effective_to INTO v_latest_kind, v_latest_from, v_latest_to
    FROM gov_repo.l14_fact_states AS s
    WHERE s.organisation_id = v_org AND s.fact_state_id = v_head_latest;
  END IF;
  IF p_outcome = 'VALIDATE' AND v_latest_kind = 'VALIDATED' AND v_latest_to IS NULL THEN
    -- Never a second VALIDATED state of one open-ended key (one active state per key; a duplicate steward included).
    RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'RESPONSIBILITY_ASSIGNMENT_ALREADY_VALIDATED';
  END IF;
  IF p_outcome = 'REVOKE' THEN
    PERFORM 1 FROM gov_repo.l14_fact_states AS r
    WHERE r.organisation_id = v_org AND r.state_kind = 'REVOKED' AND r.revokes_state_id = v_proposal.target_state_id;
    IF FOUND THEN
      RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'TARGET_ALREADY_REVOKED';
    END IF;
    IF v_head_latest IS DISTINCT FROM v_proposal.target_state_id OR v_latest_kind IS DISTINCT FROM 'VALIDATED' THEN
      RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'TARGET_STATE_NOT_CURRENT';
    END IF;
    v_target_state_id := v_proposal.target_state_id;
  END IF;
  PERFORM gov_repo.l14_resolve_support_v1(v_org, p_support_evidence_ids);

  -- 9. One DB evaluation instant; temporal class (no skew tolerance); the CURRENT effective policy is the ONLY basis,
  --    evaluated over the exact CANONICAL_OBJECT target.
  v_now := pg_catalog.clock_timestamp();
  IF p_outcome IN ('VALIDATE','REVOKE') THEN
    IF v_proposal.requested_effective_from IS NULL OR v_proposal.requested_effective_from = v_now THEN
      v_effective_from := v_now;
    ELSIF v_proposal.requested_effective_from < v_now THEN
      v_effective_from := v_proposal.requested_effective_from;
      v_temporal := 'BACKDATED';
    ELSE
      v_effective_from := v_proposal.requested_effective_from;
      v_temporal := 'FUTURE_DATED';
    END IF;
    IF p_outcome = 'VALIDATE' THEN
      v_effective_to := v_proposal.requested_effective_to;
    END IF;
  END IF;
  v_self := v_proposal.submitted_by_actor_user_id = v_actor;
  SELECT b.authority_policy_id, b.version_id, b.content_hash INTO v_basis_policy, v_basis_version, v_basis_hash
  FROM gov_repo.l14_effective_authority_basis_v1(v_org, v_now) AS b;
  v_has_basis := FOUND;
  IF NOT v_has_basis THEN
    v_deny := 'NO_EFFECTIVE_AUTHORITY';
  ELSE
    SELECT e.deny_reason, e.rule_ordinals INTO v_deny, v_ordinals
    FROM gov_repo.l14_evaluate_target_authority_rules_v1(v_org, v_basis_policy, v_basis_version, v_role_ids,
      'L14_RESPONSIBILITY_VALIDATE', p_outcome, p_outcome = 'VALIDATE' AND v_self, v_temporal,
      v_proposal.target_kind, v_proposal.target_canonical_object_id) AS e;
  END IF;

  INSERT INTO gov_repo.l14_authorization_decisions (
    organisation_id, authorization_decision_id, command_id, command_fingerprint, actor_user_id,
    requested_action, subject_kind, scope_tag, target_canonical_kind, target_canonical_object_id, source_class,
    proposal_id, is_self_validation, authority_basis, basis_authority_policy_id, basis_version_id, basis_content_hash,
    result, deny_reason, evaluated_at, expectation_kind, expected_current_state_id)
  VALUES (
    v_org, v_authz, p_command_id, v_fingerprint, v_actor,
    p_outcome, 'RESPONSIBILITY_ASSIGNMENT', 'CANONICAL_OBJECT', v_proposal.target_kind, v_proposal.target_canonical_object_id,
    v_proposal.source_class, p_proposal_id, v_self,
    CASE WHEN v_has_basis THEN 'AUTHORITY_POLICY_VERSION' END,
    CASE WHEN v_has_basis THEN v_basis_policy END,
    CASE WHEN v_has_basis THEN v_basis_version END,
    CASE WHEN v_has_basis THEN v_basis_hash END,
    CASE WHEN v_deny IS NULL THEN 'ALLOW' ELSE 'DENY' END, v_deny, v_now,
    CASE WHEN p_expected_current_state_id IS NULL THEN 'EXPECTED_NONE' ELSE 'EXPECTED_CURRENT' END,
    p_expected_current_state_id);
  PERFORM gov_repo.l14_snapshot_roles_v1(v_org, v_authz, v_role_ids);
  IF v_has_basis THEN
    PERFORM gov_repo.l14_snapshot_policy_rules_v1(v_org, v_authz, v_basis_policy, v_basis_version, v_ordinals);
  END IF;

  IF v_deny IS NOT NULL THEN
    -- DENY: durable authorization + result only. No governance decision, no fact, no head.
    INSERT INTO gov_repo.l14_command_results (organisation_id, command_id, command_kind, subject_kind,
      command_fingerprint, actor_user_id, outcome, authorization_decision_id, proposal_id, recorded_at)
    VALUES (v_org, p_command_id, 'DECIDE_PROPOSAL', 'RESPONSIBILITY_ASSIGNMENT', v_fingerprint, v_actor, 'DENIED', v_authz,
      p_proposal_id, v_now);
  ELSE
    -- 10. Interval, dependency and cardinality rules (authorized commands only; a violation raises and rolls back the
    --     WHOLE command: nothing is consumed).
    IF v_effective_to IS NOT NULL AND NOT (v_effective_to > v_effective_from) THEN
      RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'EFFECTIVE_INTERVAL_INVALID';
    END IF;
    IF p_outcome = 'REVOKE' AND v_effective_from < v_latest_from THEN
      RAISE EXCEPTION 'L14_CONTINUITY_VIOLATION' USING ERRCODE = 'GV011', DETAIL = 'REVOKE_BEFORE_TARGET_EFFECTIVE';
    END IF;
    IF p_outcome = 'REVOKE' AND v_latest_to IS NOT NULL AND v_effective_from >= v_latest_to THEN
      RAISE EXCEPTION 'L14_CONTINUITY_VIOLATION' USING ERRCODE = 'GV011', DETAIL = 'REVOKE_AFTER_TARGET_EXPIRY';
    END IF;
    IF p_outcome = 'VALIDATE'
       AND ((v_latest_kind = 'REVOKED' AND NOT (v_effective_from >= v_latest_from))
            OR (v_latest_kind = 'VALIDATED' AND v_effective_from < v_latest_to)) THEN
      RAISE EXCEPTION 'L14_CONTINUITY_VIOLATION' USING ERRCODE = 'GV011', DETAIL = 'REVALIDATION_OVERLAPS_PRIOR_INTERVAL';
    END IF;
    IF p_outcome = 'VALIDATE' AND NOT EXISTS (
         SELECT 1 FROM gov_repo.l14_governance_party_valid_state_v1(v_org, v_proposal.governance_party_id,
           v_effective_from, v_now) AS ps
         WHERE ps.state_id = v_proposal.party_validated_state_id) THEN
      -- The exact pinned Party state must be THE valid state of this Party at the requested effective instant, as known
      -- now (an unvalidated, revoked, not-yet-effective or superseded dependency never validates an assignment).
      RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'PARTY_DEPENDENCY_NOT_VALID';
    END IF;
    IF p_outcome = 'VALIDATE' AND v_single_owner
       AND gov_repo.l14_responsibility_single_owner_conflict_v1(v_org, v_proposal.target_kind,
             v_proposal.target_canonical_object_id, v_proposal.responsibility_role, v_effective_from, v_effective_to) THEN
      -- Another assignment of this target + single-owner role (any Party) overlaps: it must be explicitly ended first.
      RAISE EXCEPTION 'L14_STALE_EXPECTATION' USING ERRCODE = 'GV009', DETAIL = 'RESPONSIBILITY_SINGLE_OWNER_CONFLICT';
    END IF;

    INSERT INTO gov_repo.l14_governance_decisions (organisation_id, governance_decision_id, proposal_id,
      subject_kind, outcome, reason_code, authorization_decision_id, actor_user_id, support_status, decided_at)
    VALUES (v_org, v_decision, p_proposal_id, 'RESPONSIBILITY_ASSIGNMENT', p_outcome, p_reason_code, v_authz, v_actor,
      p_support_status, v_now);
    INSERT INTO gov_repo.l14_support_links (organisation_id, support_link_id, owner_kind, governance_decision_id, evidence_id)
    SELECT v_org, pg_catalog.gen_random_uuid(), 'GOVERNANCE_DECISION', v_decision, i.id
    FROM pg_catalog.unnest(p_support_evidence_ids) AS i(id);

    IF p_outcome IN ('VALIDATE','REVOKE') THEN
      v_state_kind := CASE WHEN p_outcome = 'VALIDATE' THEN 'VALIDATED' ELSE 'REVOKED' END;
      -- Append-only: predecessor = the expected head state; the target state is never modified.
      INSERT INTO gov_repo.l14_fact_states (organisation_id, fact_state_id, subject_kind, state_kind,
        predecessor_state_id, revokes_state_id, effective_from, effective_to, recorded_at, governance_decision_id,
        authorization_decision_id, authority_policy_id, authority_policy_version_id, authority_policy_content_hash,
        trust_state, source_class, support_status)
      VALUES (v_org, v_state, 'RESPONSIBILITY_ASSIGNMENT', v_state_kind, v_head_latest, v_target_state_id,
        v_effective_from, v_effective_to, v_now, v_decision, v_authz, v_basis_policy, v_basis_version, v_basis_hash,
        'VALIDATED', v_proposal.source_class, p_support_status);
      INSERT INTO gov_repo.l14_responsibility_assignment_states (organisation_id, fact_state_id, subject_kind, state_kind,
        target_kind, target_canonical_object_id, responsibility_role, governance_party_id, party_kind,
        party_validated_state_id, predecessor_state_id, revokes_state_id)
      VALUES (v_org, v_state, 'RESPONSIBILITY_ASSIGNMENT', v_state_kind, v_proposal.target_kind,
        v_proposal.target_canonical_object_id, v_proposal.responsibility_role, v_proposal.governance_party_id,
        v_proposal.party_kind, v_proposal.party_validated_state_id, v_head_latest, v_target_state_id);
      -- Technical head: created empty on the first state of the key, then compare-and-set on the exact expectation.
      IF NOT v_head_found THEN
        INSERT INTO gov_repo.l14_responsibility_assignment_heads (organisation_id, target_kind, target_canonical_object_id,
          responsibility_role, governance_party_id, latest_state_id)
        VALUES (v_org, v_proposal.target_kind, v_proposal.target_canonical_object_id, v_proposal.responsibility_role,
          v_proposal.governance_party_id, NULL);
      END IF;
      UPDATE gov_repo.l14_responsibility_assignment_heads AS h SET latest_state_id = v_state
      WHERE h.organisation_id = v_org AND h.target_kind = v_proposal.target_kind
        AND h.target_canonical_object_id = v_proposal.target_canonical_object_id
        AND h.responsibility_role = v_proposal.responsibility_role
        AND h.governance_party_id = v_proposal.governance_party_id
        AND h.latest_state_id IS NOT DISTINCT FROM p_expected_current_state_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'L14_STALE_EXPECTATION' USING ERRCODE = 'GV009', DETAIL = 'RESPONSIBILITY_ASSIGNMENT_STATE_EXPECTATION_MISMATCH';
      END IF;
      INSERT INTO gov_repo.l14_support_links (organisation_id, support_link_id, owner_kind, fact_state_id, evidence_id)
      SELECT v_org, pg_catalog.gen_random_uuid(), 'FACT_STATE', v_state, i.id
      FROM pg_catalog.unnest(p_support_evidence_ids) AS i(id);
      INSERT INTO gov_repo.l14_command_results (organisation_id, command_id, command_kind, subject_kind,
        command_fingerprint, actor_user_id, outcome, authorization_decision_id, proposal_id, governance_decision_id,
        fact_state_id, recorded_at)
      VALUES (v_org, p_command_id, 'DECIDE_PROPOSAL', 'RESPONSIBILITY_ASSIGNMENT', v_fingerprint, v_actor, v_state_kind,
        v_authz, p_proposal_id, v_decision, v_state, v_now);
    ELSE
      -- REJECT / DEFER: governance decision only; no fact, no head change.
      INSERT INTO gov_repo.l14_command_results (organisation_id, command_id, command_kind, subject_kind,
        command_fingerprint, actor_user_id, outcome, authorization_decision_id, proposal_id, governance_decision_id,
        recorded_at)
      VALUES (v_org, p_command_id, 'DECIDE_PROPOSAL', 'RESPONSIBILITY_ASSIGNMENT', v_fingerprint, v_actor,
        CASE WHEN p_outcome = 'REJECT' THEN 'REJECTED' ELSE 'DEFERRED' END, v_authz, p_proposal_id, v_decision, v_now);
    END IF;
  END IF;

  -- 11. Base session eligibility at commitment.
  PERFORM 1 FROM gov_repo.l14_session_basis_v1(v_org, v_actor, p_verified_session_iat,
    p_verified_session_exp, p_verified_credential_epoch);
  RETURN QUERY SELECT * FROM gov_repo.l14_responsibility_assignment_command_result_v1(v_org, p_command_id, false);
END;
$decide_responsibility$;

-- Privileges: the new helper is owner-only; CREATE OR REPLACE keeps the decide RPC's owner + service_role-only ACL.
REVOKE ALL ON FUNCTION gov_repo.l14_lock_party_dependency_guard_shared_v1(uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION gov_repo.l14_lock_party_dependency_guard_shared_v1(uuid, uuid) IS 'M16-S1C.1R1 owner-only SHARED mode of the exact S1B.1 GovernanceParty registry subject guard key: a RESPONSIBILITY_ASSIGNMENT VALIDATE pinning that Party serializes with every Party decision (exclusive) and never with other assignments pinning the same Party (shared); held to commit.';

-- ---------------------------------------------------------------------------------------
-- D. Postflight over the EFFECTIVE post-S1C.1R1 catalog.
-- ---------------------------------------------------------------------------------------
DO $postflight$
DECLARE
  v_facts CONSTANT regclass := 'gov_repo.l14_fact_states'::regclass;
  v_states CONSTANT regclass := 'gov_repo.l14_business_context_assignment_states'::regclass;
  v_proposals CONSTANT regclass := 'gov_repo.l14_business_context_assignment_proposals'::regclass;
  v_heads CONSTANT regclass := 'gov_repo.l14_business_context_assignment_heads'::regclass;
  v_new_tables CONSTANT oid[] := ARRAY['gov_repo.l14_business_context_assignment_states'::regclass::oid,
    'gov_repo.l14_business_context_assignment_proposals'::regclass::oid, 'gov_repo.l14_business_context_assignment_heads'::regclass::oid];
  v_stores CONSTANT oid[] := ARRAY['gov_repo.governance_policies'::regclass::oid, 'gov_repo.policy_versions'::regclass::oid];
  v_guarded CONSTANT oid[] := ARRAY['gov_repo.governance_policies'::regclass::oid, 'gov_repo.policy_versions'::regclass::oid,
    'gov_repo.l14_policy_admissions'::regclass::oid, 'gov_repo.l14_policy_version_admissions'::regclass::oid,
    'gov_repo.l14_policy_version_states'::regclass::oid, 'gov_repo.l14_policy_version_proposals'::regclass::oid,
    'gov_repo.l14_policy_version_heads'::regclass::oid, 'gov_repo.l14_domain_admissions'::regclass::oid,
    'gov_repo.l14_domain_states'::regclass::oid, 'gov_repo.l14_domain_proposals'::regclass::oid,
    'gov_repo.l14_domain_heads'::regclass::oid, 'gov_repo.l14_control_definitions'::regclass::oid,
    'gov_repo.l14_control_definition_versions'::regclass::oid, 'gov_repo.l14_control_definition_states'::regclass::oid,
    'gov_repo.l14_control_definition_proposals'::regclass::oid, 'gov_repo.l14_control_definition_heads'::regclass::oid,
    'gov_repo.l14_fact_states'::regclass::oid, 'gov_repo.l14_responsibility_assignment_states'::regclass::oid,
    'gov_repo.l14_responsibility_assignment_proposals'::regclass::oid, 'gov_repo.l14_responsibility_assignment_heads'::regclass::oid,
    'gov_repo.l14_business_context_assignment_states'::regclass::oid, 'gov_repo.l14_business_context_assignment_proposals'::regclass::oid,
    'gov_repo.l14_business_context_assignment_heads'::regclass::oid];
  v_app CONSTANT text[] := ARRAY['anon','authenticated','service_role'];
  v_expected_l14 CONSTANT text[] := ARRAY[
    'l14_authority_policies','l14_authority_policy_heads','l14_authority_policy_rules',
    'l14_authority_policy_states','l14_authority_policy_version_proposals','l14_authority_policy_versions',
    'l14_authorization_decision_roles','l14_authorization_decision_rules','l14_authorization_decisions',
    'l14_business_context_assignment_heads','l14_business_context_assignment_proposals',
    'l14_business_context_assignment_states','l14_command_results','l14_control_definition_heads',
    'l14_control_definition_proposals','l14_control_definition_states','l14_control_definition_versions',
    'l14_control_definitions','l14_domain_admissions','l14_domain_heads','l14_domain_proposals','l14_domain_states',
    'l14_fact_states','l14_governance_decisions','l14_governance_parties','l14_governance_party_heads',
    'l14_governance_party_proposals','l14_governance_party_states','l14_policy_admissions',
    'l14_policy_version_admissions','l14_policy_version_heads','l14_policy_version_proposals',
    'l14_policy_version_states','l14_proposals','l14_registry_states','l14_responsibility_assignment_heads',
    'l14_responsibility_assignment_proposals','l14_responsibility_assignment_states','l14_support_links'];
  v_mutable_heads CONSTANT text[] := ARRAY['l14_authority_policy_heads','l14_business_context_assignment_heads',
    'l14_control_definition_heads','l14_domain_heads','l14_governance_party_heads','l14_policy_version_heads',
    'l14_responsibility_assignment_heads'];
  v_public_l14 CONSTANT text[] := ARRAY[
    'l14_admit_authority_policy_version_v1','l14_admit_control_definition_version_v1','l14_admit_domain_v1',
    'l14_admit_governance_party_v1','l14_admit_governance_policy_v1','l14_admit_policy_version_v1',
    'l14_decide_authority_policy_proposal_v1','l14_decide_business_context_assignment_proposal_v1',
    'l14_decide_control_definition_proposal_v1','l14_decide_domain_proposal_v1',
    'l14_decide_governance_party_proposal_v1','l14_decide_policy_version_proposal_v1',
    'l14_decide_responsibility_assignment_proposal_v1','l14_read_policy_descriptors_v1',
    'l14_submit_business_context_assignment_proposal_v1','l14_submit_control_definition_proposal_v1',
    'l14_submit_domain_proposal_v1','l14_submit_governance_party_proposal_v1',
    'l14_submit_policy_version_proposal_v1','l14_submit_proposal_v1','l14_submit_responsibility_assignment_proposal_v1'];
  v_new_rpcs CONSTANT text[] := ARRAY['l14_decide_business_context_assignment_proposal_v1',
    'l14_submit_business_context_assignment_proposal_v1'];
  -- The nine new routines (the S1C.2 family) plus the widened S1C.1 fact guard.
  v_new_routines CONSTANT text[] := ARRAY[
    'l14_business_context_assignment_command_result_v1','l14_business_context_assignment_head_guard_v1',
    'l14_business_context_assignment_proposal_guard_v1','l14_business_context_assignment_state_guard_v1',
    'l14_business_context_assignment_valid_state_v1','l14_business_context_assignments_current_v1',
    'l14_decide_business_context_assignment_proposal_v1','l14_lock_domain_dependency_guard_shared_v1',
    'l14_submit_business_context_assignment_proposal_v1'];
  v_privileges text[] := ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'];
  v_crypto name := (SELECT e.extnamespace::regnamespace::name FROM pg_catalog.pg_extension AS e WHERE e.extname = 'pgcrypto');
  v_vector name := (SELECT e.extnamespace::regnamespace::name FROM pg_catalog.pg_extension AS e WHERE e.extname = 'vector');
  v_matrix CONSTANT text := 'CHECK ((((target_kind = ''AGENT''::text) AND (semantic_kind = ''BUSINESS_DOMAIN''::text)) OR ((target_kind = ''DATA_ASSET''::text) AND (semantic_kind = ANY (ARRAY[''BUSINESS_DOMAIN''::text, ''INFORMATION_DOMAIN''::text]))) OR ((target_kind = ''DATA_ELEMENT''::text) AND (semantic_kind = ''INFORMATION_DOMAIN''::text))))';
  v_capable oid[];
  v_approved oid[] := '{}';
  v_frozen oid[] := '{}';
  v_entry record;
  v_proc record;
  v_rel record;
  v_fn record;
  v_row record;
  v_oid oid;
  v_role text;
  v_privilege text;
BEGIN
  IF pg_catalog.current_setting('server_version_num')::integer >= 170000 THEN
    v_privileges := pg_catalog.array_append(v_privileges, 'MAINTAIN'::text);
  END IF;

  -- H1. Exact l14 relation set (tables only; no views/sequences).
  IF (SELECT pg_catalog.array_agg(c.relname::text ORDER BY c.relname::text COLLATE "C")
      FROM pg_catalog.pg_class AS c
      WHERE c.relnamespace = 'gov_repo'::regnamespace AND c.relname LIKE 'l14\_%' ESCAPE '\'
        AND c.relkind IN ('r','p','v','m','S','f')) IS DISTINCT FROM v_expected_l14 THEN
    RAISE EXCEPTION 'M16_S1C1R1_POSTFLIGHT: unexpected l14 relation set';
  END IF;

  -- H2. Every l14 table + both reused stores: RLS-enabled ordinary table, zero non-owner / column / application
  --     privilege (incl. inherited), no JSON; immutable history; NO RLS policy on any guarded table (no permissive path).
  FOR v_rel IN
    SELECT c.oid, c.relname, c.relkind, c.relowner, c.relacl, c.relrowsecurity
    FROM pg_catalog.pg_class AS c
    WHERE c.relnamespace = 'gov_repo'::regnamespace AND (c.relname::text = ANY (v_expected_l14) OR c.oid = ANY (v_stores))
  LOOP
    IF v_rel.relkind <> 'r' OR NOT v_rel.relrowsecurity THEN
      RAISE EXCEPTION 'M16_S1C1R1_POSTFLIGHT: % must be an RLS-enabled ordinary table', v_rel.relname;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_catalog.aclexplode(COALESCE(v_rel.relacl, pg_catalog.acldefault('r', v_rel.relowner))) AS a
               WHERE a.grantee <> v_rel.relowner) THEN
      RAISE EXCEPTION 'M16_S1C1R1_POSTFLIGHT: % has a non-owner table grant', v_rel.relname;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_attribute AS att WHERE att.attrelid = v_rel.oid AND att.attacl IS NOT NULL) THEN
      RAISE EXCEPTION 'M16_S1C1R1_POSTFLIGHT: % has column-level grants', v_rel.relname;
    END IF;
    FOREACH v_role IN ARRAY v_app LOOP
      FOREACH v_privilege IN ARRAY v_privileges LOOP
        IF pg_catalog.has_table_privilege(v_role, v_rel.oid, v_privilege) THEN
          RAISE EXCEPTION 'M16_S1C1R1_POSTFLIGHT: % holds % on %', v_role, v_privilege, v_rel.relname;
        END IF;
      END LOOP;
      IF pg_catalog.has_any_column_privilege(v_role, v_rel.oid, 'SELECT, INSERT, UPDATE, REFERENCES') THEN
        RAISE EXCEPTION 'M16_S1C1R1_POSTFLIGHT: % holds a column privilege on %', v_role, v_rel.relname;
      END IF;
    END LOOP;
    IF v_rel.oid = ANY (v_guarded) AND EXISTS (SELECT 1 FROM pg_catalog.pg_policy AS pol WHERE pol.polrelid = v_rel.oid) THEN
      RAISE EXCEPTION 'M16_S1C1R1_POSTFLIGHT: % carries an RLS policy (no application access path may exist)', v_rel.relname;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_attribute AS att
               WHERE att.attrelid = v_rel.oid AND att.attnum > 0 AND NOT att.attisdropped
                 AND att.atttypid IN ('json'::regtype, 'jsonb'::regtype)) THEN
      RAISE EXCEPTION 'M16_S1C1R1_POSTFLIGHT: % has a JSON column', v_rel.relname;
    END IF;
    IF v_rel.relname::text = ANY (v_expected_l14) AND v_rel.relname::text <> ALL (v_mutable_heads) AND (
       NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger AS t
                   WHERE t.tgrelid = v_rel.oid AND NOT t.tgisinternal AND t.tgenabled = 'A'
                     AND t.tgfoid = 'gov_repo.l14_history_immutable_v1()'::regprocedure
                     AND (t.tgtype & 1) <> 0 AND (t.tgtype & 2) <> 0 AND (t.tgtype & 8) <> 0 AND (t.tgtype & 16) <> 0)
       OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger AS t
                   WHERE t.tgrelid = v_rel.oid AND NOT t.tgisinternal AND t.tgenabled = 'A'
                     AND t.tgfoid = 'gov_repo.l14_history_immutable_v1()'::regprocedure
                     AND (t.tgtype & 2) <> 0 AND (t.tgtype & 32) <> 0)) THEN
      RAISE EXCEPTION 'M16_S1C1R1_POSTFLIGHT: % lacks ALWAYS raising BEFORE UPDATE/DELETE and TRUNCATE triggers', v_rel.relname;
    END IF;
  END LOOP;

  -- H3. New structures: exactly the pinned columns (no label / description / rationale / JSON / score); every text column
  --     a closed vocabulary or a pinned single-column bound CHECK; the exact closed matrix; the head key EXACTLY target +
  --     semantic kind (never the domain id); the fact envelope subject EXACTLY the two implemented families; the structural
  --     guards ALWAYS; the exact non-cascading FK shape (incl. the domain dependency FK); linear lineage keys.
  IF (SELECT pg_catalog.array_agg(att.attname::text || ':' || pg_catalog.format_type(att.atttypid, att.atttypmod) ORDER BY att.attnum)
      FROM pg_catalog.pg_attribute AS att WHERE att.attrelid = v_states AND att.attnum > 0 AND NOT att.attisdropped)
     IS DISTINCT FROM ARRAY['organisation_id:uuid','fact_state_id:uuid','subject_kind:text','state_kind:text','target_kind:text',
       'target_canonical_object_id:text','semantic_kind:text','domain_id:text','domain_validated_state_id:uuid',
       'domain_state_kind:text','predecessor_state_id:uuid','revokes_state_id:uuid','revoked_state_kind:text']
     OR (SELECT pg_catalog.array_agg(att.attname::text || ':' || pg_catalog.format_type(att.atttypid, att.atttypmod) ORDER BY att.attnum)
      FROM pg_catalog.pg_attribute AS att WHERE att.attrelid = v_proposals AND att.attnum > 0 AND NOT att.attisdropped)
     IS DISTINCT FROM ARRAY['organisation_id:uuid','proposal_id:uuid','subject_kind:text','intent:text','target_kind:text',
       'target_canonical_object_id:text','semantic_kind:text','domain_id:text','domain_validated_state_id:uuid',
       'domain_state_kind:text','requested_effective_from:timestamp with time zone',
       'requested_effective_to:timestamp with time zone','target_state_id:uuid','target_state_kind:text']
     OR (SELECT pg_catalog.array_agg(att.attname::text || ':' || pg_catalog.format_type(att.atttypid, att.atttypmod) ORDER BY att.attnum)
      FROM pg_catalog.pg_attribute AS att WHERE att.attrelid = v_heads AND att.attnum > 0 AND NOT att.attisdropped)
     IS DISTINCT FROM ARRAY['organisation_id:uuid','target_kind:text','target_canonical_object_id:text','semantic_kind:text',
       'latest_state_id:uuid'] THEN
    RAISE EXCEPTION 'M16_S1C1R1_POSTFLIGHT: S1C.2 structure columns are not exactly the pinned set';
  END IF;
  IF (SELECT pg_catalog.array_agg(att.attname::text ORDER BY k.ord)
      FROM pg_catalog.pg_constraint AS c
      CROSS JOIN LATERAL pg_catalog.unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord)
      JOIN pg_catalog.pg_attribute AS att ON att.attrelid = c.conrelid AND att.attnum = k.attnum
      WHERE c.conrelid = v_heads AND c.contype = 'p') IS DISTINCT FROM
       ARRAY['organisation_id','target_kind','target_canonical_object_id','semantic_kind']::text[]
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_index AS i JOIN pg_catalog.pg_attribute AS att
                  ON att.attrelid = i.indrelid AND att.attnum = ANY (i.indkey::int2[])
                WHERE i.indrelid = v_heads AND att.attname = 'domain_id') THEN
    RAISE EXCEPTION 'M16_S1C1R1_POSTFLIGHT: the business-context head key must be exactly target + semantic kind (never the domain)';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_attribute AS att
             WHERE att.attrelid = ANY (v_new_tables) AND att.attnum > 0 AND NOT att.attisdropped
               AND att.atttypid IN ('text'::regtype, 'bpchar'::regtype, 'varchar'::regtype)
               AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint AS k
                               WHERE k.conrelid = att.attrelid AND k.contype = 'c' AND k.conkey = ARRAY[att.attnum]::int2[])) THEN
    RAISE EXCEPTION 'M16_S1C1R1_POSTFLIGHT: an S1C.2 text column is not a closed vocabulary / pinned bound';
  END IF;
  -- The closed target kinds / semantic kinds / matrix, verbatim on the typed tables (any relaxation fails); the fact
  -- envelope admits exactly the two implemented families; the authorization target rule is present.
  IF (SELECT pg_catalog.count(*) FROM pg_catalog.pg_constraint AS k
      WHERE k.contype = 'c' AND k.conrelid IN (v_states, v_proposals, v_heads)
        AND k.conkey = ARRAY[(SELECT att.attnum FROM pg_catalog.pg_attribute AS att WHERE att.attrelid = k.conrelid AND att.attname = 'target_kind')]::int2[]
        AND pg_catalog.pg_get_constraintdef(k.oid) = 'CHECK ((target_kind = ANY (ARRAY[''AGENT''::text, ''DATA_ASSET''::text, ''DATA_ELEMENT''::text])))') <> 3
     OR (SELECT pg_catalog.count(*) FROM pg_catalog.pg_constraint AS k
      WHERE k.contype = 'c' AND k.conrelid IN (v_states, v_proposals, v_heads)
        AND k.conkey = ARRAY[(SELECT att.attnum FROM pg_catalog.pg_attribute AS att WHERE att.attrelid = k.conrelid AND att.attname = 'semantic_kind')]::int2[]
        AND pg_catalog.pg_get_constraintdef(k.oid) = 'CHECK ((semantic_kind = ANY (ARRAY[''BUSINESS_DOMAIN''::text, ''INFORMATION_DOMAIN''::text])))') <> 3
     OR (SELECT pg_catalog.count(*) FROM pg_catalog.pg_constraint AS k
      WHERE k.contype = 'c' AND k.conrelid IN (v_states, v_proposals)
        AND pg_catalog.pg_get_constraintdef(k.oid) = 'CHECK ((domain_state_kind = ''VALIDATED''::text))') <> 2
     OR (SELECT pg_catalog.count(*) FROM pg_catalog.pg_constraint AS k
      WHERE k.contype = 'c' AND k.conrelid IN (v_states, v_proposals) AND pg_catalog.pg_get_constraintdef(k.oid) = v_matrix
        AND k.conname IN ('l14_business_context_assignment_states_matrix_check','l14_business_context_assignment_proposals_matrix_check')) <> 2
     OR (SELECT pg_catalog.count(*) FROM pg_catalog.pg_constraint AS k WHERE k.conrelid = v_facts AND k.contype = 'c'
           AND k.conkey = ARRAY[(SELECT att.attnum FROM pg_catalog.pg_attribute AS att WHERE att.attrelid = v_facts AND att.attname = 'subject_kind')]::int2[])
         <> 1
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint AS k WHERE k.conrelid = v_facts AND k.contype = 'c'
                      AND k.conname = 'l14_fact_states_subject_kind_check'
                      AND pg_catalog.pg_get_constraintdef(k.oid) = 'CHECK ((subject_kind = ANY (ARRAY[''RESPONSIBILITY_ASSIGNMENT''::text, ''BUSINESS_CONTEXT_ASSIGNMENT''::text])))')
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint AS k WHERE k.conrelid = v_facts AND k.contype = 'c'
                      AND k.conname = 'l14_fact_states_interval_check'
                      AND pg_catalog.pg_get_constraintdef(k.oid) = 'CHECK (((effective_to IS NULL) OR ((state_kind = ''VALIDATED''::text) AND (effective_to > effective_from))))')
     OR (SELECT pg_catalog.count(*) FROM pg_catalog.pg_constraint AS k
      WHERE k.contype = 'c' AND k.conrelid IN (v_states, v_proposals)
        AND pg_catalog.pg_get_constraintdef(k.oid) = 'CHECK ((subject_kind = ''BUSINESS_CONTEXT_ASSIGNMENT''::text))') <> 2
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint AS k WHERE k.conrelid = 'gov_repo.l14_authorization_decisions'::regclass
                      AND k.contype = 'c' AND k.convalidated AND k.conname = 'l14_authorization_decisions_business_context_target_check'
                      AND pg_catalog.pg_get_constraintdef(k.oid) LIKE '%target_canonical_kind = ANY (ARRAY[''AGENT''::text, ''DATA_ASSET''::text, ''DATA_ELEMENT''::text])%')
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint AS k WHERE k.conrelid = 'gov_repo.l14_authorization_decisions'::regclass
                      AND k.contype = 'c' AND k.convalidated AND k.conname = 'l14_authorization_decisions_responsibility_target_check') THEN
    RAISE EXCEPTION 'M16_S1C1R1_POSTFLIGHT: the closed business-context target / semantic-kind matrix, fact subject or interval rule was relaxed';
  END IF;
  -- The widened fact guard admits exactly the two implemented families; the shared domain guard uses the exact S1B.5 key.
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc AS p
                 WHERE p.oid = 'gov_repo.l14_lock_fact_subject_guard_v1(uuid,text,text[])'::regprocedure
                   AND p.prosrc LIKE '%p_subject_kind NOT IN (''RESPONSIBILITY_ASSIGNMENT'',''BUSINESS_CONTEXT_ASSIGNMENT'')%'
                   AND (SELECT pg_catalog.count(*) FROM pg_catalog.regexp_matches(p.prosrc, '''[A-Z_]+_ASSIGNMENT''', 'g')) = 2)
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc AS p
                    WHERE p.oid = 'gov_repo.l14_lock_domain_dependency_guard_shared_v1(uuid,text,text)'::regprocedure
                      AND p.prosrc LIKE '%pg_advisory_xact_lock_shared%'
                      AND p.prosrc LIKE '%ARRAY[p_organisation_id::text, ''l14-registry-subject-guard-v1'', p_semantic_kind, p_domain_id]%')
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc AS p
                    WHERE p.oid = 'gov_repo.l14_lock_registry_subject_guard_v1(uuid,text,text)'::regprocedure
                      AND p.prosrc LIKE '%ARRAY[p_organisation_id::text, ''l14-registry-subject-guard-v1'', p_subject_kind, p_subject_key]%') THEN
    RAISE EXCEPTION 'M16_S1C1R1_POSTFLIGHT: the fact guard subject vocabulary or the shared domain guard key drifted';
  END IF;
  IF (SELECT pg_catalog.count(*) FROM pg_catalog.pg_trigger AS t
      WHERE t.tgenabled = 'A' AND NOT t.tgisinternal AND (
        (t.tgrelid = v_states AND t.tgname = 'l14_business_context_assignment_states_guard'
          AND t.tgfoid = 'gov_repo.l14_business_context_assignment_state_guard_v1()'::regprocedure)
        OR (t.tgrelid = v_proposals AND t.tgname = 'l14_business_context_assignment_proposals_guard'
          AND t.tgfoid = 'gov_repo.l14_business_context_assignment_proposal_guard_v1()'::regprocedure)
        OR (t.tgrelid = v_heads AND t.tgname IN ('l14_business_context_assignment_heads_guard','l14_business_context_assignment_heads_no_truncate')
          AND t.tgfoid = 'gov_repo.l14_business_context_assignment_head_guard_v1()'::regprocedure))) <> 4 THEN
    RAISE EXCEPTION 'M16_S1C1R1_POSTFLIGHT: S1C.2 structural guard missing or not ALWAYS';
  END IF;
  IF (SELECT pg_catalog.array_agg(k.conname::text ORDER BY k.conname::text COLLATE "C") FROM pg_catalog.pg_constraint AS k
      WHERE k.contype = 'f' AND (k.conrelid = ANY (v_new_tables) OR k.conrelid = v_facts)
        AND k.confdeltype IN ('a','r') AND k.confupdtype IN ('a','r') AND k.convalidated
        AND NOT k.condeferrable AND NOT k.condeferred) IS DISTINCT FROM ARRAY[
       'l14_business_context_assignment_heads_state_fkey','l14_business_context_assignment_heads_target_fkey',
       'l14_business_context_assignment_proposals_domain_fkey','l14_business_context_assignment_proposals_envelope_fkey',
       'l14_business_context_assignment_proposals_target_object_fkey','l14_business_context_assignment_proposals_target_state_fkey',
       'l14_business_context_assignment_states_domain_fkey','l14_business_context_assignment_states_envelope_fkey',
       'l14_business_context_assignment_states_predecessor_fkey','l14_business_context_assignment_states_revokes_fkey',
       'l14_business_context_assignment_states_target_fkey',
       'l14_fact_states_authorization_fkey','l14_fact_states_basis_fkey','l14_fact_states_decision_fkey',
       'l14_fact_states_organisation_id_fkey','l14_fact_states_predecessor_fkey','l14_fact_states_revokes_fkey']
     OR (SELECT pg_catalog.count(*) FROM pg_catalog.pg_constraint AS k
         WHERE k.contype = 'f' AND (k.conrelid = ANY (v_new_tables) OR k.conrelid = v_facts)) <> 17
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint AS k
                    WHERE k.contype = 'f' AND k.conrelid = v_states AND k.conname = 'l14_business_context_assignment_states_domain_fkey'
                      AND k.confrelid = 'gov_repo.l14_domain_states'::regclass AND pg_catalog.cardinality(k.conkey) = 5)
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint AS k
                    WHERE k.contype = 'f' AND k.conrelid = v_proposals AND k.conname = 'l14_business_context_assignment_proposals_domain_fkey'
                      AND k.confrelid = 'gov_repo.l14_domain_states'::regclass AND pg_catalog.cardinality(k.conkey) = 5)
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint AS k WHERE k.conrelid = 'gov_repo.l14_command_results'::regclass
                      AND k.contype = 'f' AND k.conname = 'l14_command_results_fact_state_fkey' AND k.convalidated
                      AND NOT k.condeferrable AND k.confrelid = v_facts)
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint AS k WHERE k.conrelid = 'gov_repo.l14_support_links'::regclass
                      AND k.contype = 'f' AND k.conname = 'l14_support_links_fact_state_fkey' AND k.convalidated
                      AND NOT k.condeferrable AND k.confrelid = v_facts)
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_constraint AS k
                WHERE k.contype = 'f' AND (k.conrelid = ANY (v_guarded) OR k.confrelid = ANY (v_guarded))
                  AND k.conrelid <> 'gov_repo.governance_policies'::regclass AND k.confrelid <> 'gov_repo.governance_policies'::regclass
                  AND (k.confdeltype NOT IN ('a','r') OR k.confupdtype NOT IN ('a','r'))) THEN
    RAISE EXCEPTION 'M16_S1C1R1_POSTFLIGHT: S1C.2 FK set wrong (missing, weakened, deferred or cascading)';
  END IF;
  IF (SELECT pg_catalog.count(*) FROM pg_catalog.pg_indexes AS i
      WHERE i.schemaname = 'gov_repo' AND i.indexname IN ('l14_fact_states_revocation_target_uidx',
        'l14_business_context_assignment_states_root_uidx','l14_business_context_assignment_states_successor_uidx',
        'l14_support_links_fact_state_uidx')) <> 4
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint AS k WHERE k.conrelid = v_facts AND k.contype = 'u'
                      AND k.conname = 'l14_fact_states_successor_unique') THEN
    RAISE EXCEPTION 'M16_S1C1R1_POSTFLIGHT: linear fact lineage keys missing';
  END IF;

  -- H4. Exact INPUT parameters: the caller can never choose organisation, actor, role, a label / description, a free-text
  --     rationale or any value beyond the closed command shape.
  FOR v_entry IN
    SELECT m.sig, m.args FROM (VALUES
      ('gov_repo.l14_submit_business_context_assignment_proposal_v1(uuid,uuid,bigint,bigint,timestamp with time zone,text,text,text,text,text,text,text,uuid,timestamp with time zone,timestamp with time zone,uuid,uuid,text,text[],text)',
       'p_verified_organisation_id,p_verified_actor_user_id,p_verified_session_iat,p_verified_session_exp,p_verified_credential_epoch,p_command_id,p_intent,p_source_class,p_target_kind,p_target_canonical_object_id,p_semantic_kind,p_domain_id,p_domain_validated_state_id,p_requested_effective_from,p_requested_effective_to,p_target_state_id,p_prior_proposal_id,p_support_status,p_support_evidence_ids,p_caller_fingerprint'),
      ('gov_repo.l14_decide_business_context_assignment_proposal_v1(uuid,uuid,bigint,bigint,timestamp with time zone,text,uuid,text,text,uuid,text,text[],text)',
       'p_verified_organisation_id,p_verified_actor_user_id,p_verified_session_iat,p_verified_session_exp,p_verified_credential_epoch,p_command_id,p_proposal_id,p_outcome,p_reason_code,p_expected_current_state_id,p_support_status,p_support_evidence_ids,p_caller_fingerprint')
    ) AS m(sig, args)
  LOOP
    IF (SELECT pg_catalog.string_agg(a.name, ',' ORDER BY a.ord)
        FROM pg_catalog.pg_proc AS p
        CROSS JOIN LATERAL ROWS FROM (pg_catalog.unnest(p.proargnames), pg_catalog.unnest(p.proargmodes)) WITH ORDINALITY AS a(name, mode, ord)
        WHERE p.oid = pg_catalog.to_regprocedure(v_entry.sig) AND a.mode IN ('i','b','v')) IS DISTINCT FROM v_entry.args THEN
      RAISE EXCEPTION 'M16_S1C1R1_POSTFLIGHT: % input parameters are not exactly the closed command shape', v_entry.sig;
    END IF;
  END LOOP;

  -- H5. New SQL never touches the policy content stores / lineage, the control-definition registry, the Party directory /
  --     profile (PII), legacy domain / owner / authority fields, scanner classifications, canonical relationships or another
  --     fact family; it never mutates an identity / registry / domain / evidence / canonical surface. Domain registry READS
  --     (admission, state, resolver, guard key) are required and allowed.
  FOR v_fn IN
    SELECT p.oid, p.proname, p.prosrc FROM pg_catalog.pg_proc AS p
    WHERE p.pronamespace = 'gov_repo'::regnamespace
      AND (p.proname::text = ANY (v_new_routines) OR p.proname = 'l14_lock_fact_subject_guard_v1')
  LOOP
    IF v_fn.prosrc ~ '(governance_policies|policy_versions|l14_policy_admissions|l14_policy_version_|current_version_id|l14_control_definition|l14_domain_proposals|l14_domain_heads)' THEN
      RAISE EXCEPTION 'M16_S1C1R1_POSTFLIGHT: % reaches a policy / control-definition store or the domain proposal / head surface', v_fn.proname;
    END IF;
    IF v_fn.prosrc ~* '(directory_profile|display_name|\memail\M|\mphone\M|profile_text|external_identity_ref|governance_users|full_name|l14_governance_part)' THEN
      RAISE EXCEPTION 'M16_S1C1R1_POSTFLIGHT: % reaches Party profile / directory PII, the Party registry or a governance-user identity', v_fn.proname;
    END IF;
    IF v_fn.prosrc ~ '(\mbusiness_domain\M|\minformation_domain\M|\mdepartment\M|\mindustry_sector\M|\mlabel\M|\mdescription\M|classif|\mtags\M)'
       OR v_fn.prosrc ~* '(owner_user_id|owner_email|\mowner_id\M|approved_by|approval_date|reviewed_by|approver_user_id|qes_signature_id|ledger_entry_seq|\mstatus\M|effective_date|expiry_date)' THEN
      RAISE EXCEPTION 'M16_S1C1R1_POSTFLIGHT: % references legacy domain / label / classification / owner / status fields', v_fn.proname;
    END IF;
    IF v_fn.prosrc ~ '(canonical_relationships|policy_mandate_mappings|semantic_representation|_APPLICABILITY|_ASSESSMENT)' THEN
      RAISE EXCEPTION 'M16_S1C1R1_POSTFLIGHT: % reaches canonical relationships, an unimplemented fact family or mappings', v_fn.proname;
    END IF;
    IF v_fn.proname::text = ANY (v_new_routines) AND v_fn.prosrc ~ '(RESPONSIBILITY|l14_responsibility_)' THEN
      RAISE EXCEPTION 'M16_S1C1R1_POSTFLIGHT: % reaches the responsibility fact family', v_fn.proname;
    END IF;
    IF v_fn.prosrc ~* '(\mcg_|cg-ag|\magents\M|agent_resource_links|ai_systems|\mrisk|coverage|maturity|severity|\mweight|\mscore|waiver|confidence|scanner|\mllm\M)' THEN
      RAISE EXCEPTION 'M16_S1C1R1_POSTFLIGHT: % reaches a CG-AG flag / legacy registry / scanner / score / risk / confidence surface', v_fn.proname;
    END IF;
    IF v_fn.prosrc ~* '(INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+gov_repo\.(l14_governance_part|l14_authority_policy|l14_registry_states|l14_domain_|l14_responsibility_|governance_users|governance_roles|organisations|discovery_evidence|canonical_objects)' THEN
      RAISE EXCEPTION 'M16_S1C1R1_POSTFLIGHT: % mutates a registry / identity / domain / evidence / canonical surface outside S1C.2', v_fn.proname;
    END IF;
  END LOOP;

  -- H6. Every l14 routine: pinned search_path, no PUBLIC/anon/authenticated EXECUTE; the twenty-one public RPCs are
  --     SECURITY DEFINER + service_role-only; every other l14 routine is an owner-only SECURITY INVOKER helper.
  FOR v_fn IN
    SELECT p.oid, p.proname, p.proowner, p.proacl, p.prosecdef, p.proconfig
    FROM pg_catalog.pg_proc AS p
    WHERE p.pronamespace = 'gov_repo'::regnamespace AND p.proname LIKE 'l14\_%' ESCAPE '\'
  LOOP
    IF EXISTS (SELECT 1 FROM pg_catalog.aclexplode(COALESCE(v_fn.proacl, pg_catalog.acldefault('f', v_fn.proowner))) AS a
               WHERE a.privilege_type = 'EXECUTE' AND a.grantee = 0) THEN
      RAISE EXCEPTION 'M16_S1C1R1_POSTFLIGHT: % has PUBLIC EXECUTE', v_fn.proname;
    END IF;
    FOREACH v_role IN ARRAY ARRAY['anon','authenticated'] LOOP
      IF pg_catalog.has_function_privilege(v_role, v_fn.oid, 'EXECUTE') THEN
        RAISE EXCEPTION 'M16_S1C1R1_POSTFLIGHT: % executable by %', v_fn.proname, v_role;
      END IF;
    END LOOP;
    IF NOT COALESCE(v_fn.proconfig @> ARRAY['search_path=pg_catalog, pg_temp'], false) THEN
      RAISE EXCEPTION 'M16_S1C1R1_POSTFLIGHT: % search_path not pinned to pg_catalog, pg_temp', v_fn.proname;
    END IF;
    IF v_fn.proname::text = ANY (v_public_l14) THEN
      IF NOT v_fn.prosecdef OR NOT pg_catalog.has_function_privilege('service_role', v_fn.oid, 'EXECUTE')
         OR EXISTS (SELECT 1 FROM pg_catalog.aclexplode(v_fn.proacl) AS a
                    WHERE a.grantee NOT IN (v_fn.proowner, 'service_role'::regrole::oid)) THEN
        RAISE EXCEPTION 'M16_S1C1R1_POSTFLIGHT: public RPC % ACL/definer shape wrong', v_fn.proname;
      END IF;
    ELSIF v_fn.prosecdef OR EXISTS (SELECT 1 FROM pg_catalog.aclexplode(COALESCE(v_fn.proacl,
            pg_catalog.acldefault('f', v_fn.proowner))) AS a WHERE a.grantee <> v_fn.proowner) THEN
      RAISE EXCEPTION 'M16_S1C1R1_POSTFLIGHT: internal helper % must be owner-only SECURITY INVOKER', v_fn.proname;
    END IF;
  END LOOP;
  IF (SELECT pg_catalog.array_agg(p.proname::text ORDER BY p.proname::text COLLATE "C") FROM pg_catalog.pg_proc AS p
      WHERE p.pronamespace = 'gov_repo'::regnamespace AND p.proname LIKE 'l14\_%' ESCAPE '\'
        AND pg_catalog.has_function_privilege('service_role', p.oid, 'EXECUTE')) IS DISTINCT FROM v_public_l14
     OR (SELECT pg_catalog.count(*) FROM pg_catalog.pg_proc AS p
         WHERE p.pronamespace = 'gov_repo'::regnamespace AND p.proname LIKE 'l14\_%' ESCAPE '\' AND p.prosecdef) <> 21
     OR (SELECT pg_catalog.count(*) FROM pg_catalog.pg_proc AS p
         WHERE p.pronamespace = 'gov_repo'::regnamespace AND p.proname::text = ANY (v_new_routines)) <> 9
     OR (SELECT pg_catalog.count(*) FROM pg_catalog.pg_proc AS p
         WHERE p.pronamespace = 'gov_repo'::regnamespace AND p.proname = 'l14_lock_fact_subject_guard_v1') <> 1 THEN
    RAISE EXCEPTION 'M16_S1C1R1_POSTFLIGHT: the public L14 RPC surface must be exactly the nineteen S1C.1 + two S1C.2 RPCs (no overloads)';
  END IF;

  -- H7. Closed application SECURITY DEFINER surface on the post-S1C.2 catalog: exactly 37 approved identities (exact
  --     owner class, body hash, config, service_role-only EXECUTE, no overload); exactly 27 canonical-owner
  --     (policy-store-capable) definers. The capability class reflects OWNER capability, not body-level need: the two
  --     S1C.2 bodies are proven above (H5) never to reach a policy store.
  v_capable := ARRAY(
    SELECT r.oid FROM pg_catalog.pg_roles AS r
    WHERE r.rolsuper OR r.rolbypassrls
       OR EXISTS (SELECT 1 FROM pg_catalog.pg_class AS c WHERE c.oid = ANY (v_stores) AND pg_catalog.pg_has_role(r.oid, c.relowner, 'MEMBER'))
       OR EXISTS (SELECT 1 FROM pg_catalog.unnest(v_stores) AS s(rel) CROSS JOIN pg_catalog.unnest(v_privileges) AS pr(privilege)
                  WHERE pg_catalog.has_table_privilege(r.oid, s.rel, pr.privilege))
       OR EXISTS (SELECT 1 FROM pg_catalog.unnest(v_stores) AS s(rel)
                  WHERE pg_catalog.has_any_column_privilege(r.oid, s.rel, 'SELECT, INSERT, UPDATE, REFERENCES')));
  FOR v_entry IN
    SELECT m.sig, m.owner_role, m.sha, m.cfg FROM (VALUES
      ('gov_repo.apply_review_transition_governed_v1(uuid,uuid,bigint,bigint,timestamp with time zone,text,text,text,text,timestamp with time zone,text[],text,text,text)', 'postgres', 'b47d560eed2d1e2239351bd3767a6c600ef43e251ac0f13e807a2cb7a89f665f', 'search_path=pg_catalog, pg_temp'),
      ('gov_repo.materialize_object_reconciliation_governed_v1(uuid,uuid,bigint,bigint,timestamp with time zone,text,text,text,text,text,text,text,text,text,character,timestamp with time zone)', 'postgres', 'ad76acbb25928f7e99c43bc37555c8a1f63209b2e9f8a4dc8951590d63964bca', 'search_path=pg_catalog, pg_temp'),
      ('gov_repo.materialize_relationship_reconciliation_governed_v1(uuid,uuid,bigint,bigint,timestamp with time zone,text,text,text,text,text,text,text,text,text,text,timestamp with time zone,timestamp with time zone,character)', 'postgres', '674f7e599e0f62548c780c3d6bbe4072cd6b75916f5c2b10a9426e69da861ad2', 'search_path=pg_catalog, pg_temp'),
      ('gov_repo.record_authorized_reconciliation_governed_v1(uuid,uuid,bigint,bigint,timestamp with time zone,text,text,text,text,text,text,timestamp with time zone,text,text,text,text,timestamp with time zone,text,text,text,text,text,timestamp with time zone,text,text,text,text,text,text,text,text[],text[],text[],text,jsonb,character)', 'postgres', '9ea6a32aa6b0c8da368f5ccd51b3c50fe5c7be466c3ff124653101f8a4575ae5', 'search_path=pg_catalog, pg_temp'),
      ('gov_repo.record_execution_field_decision_governed_v1(uuid,uuid,bigint,bigint,timestamp with time zone,jsonb)', 'postgres', 'dcb2d3a0b10a179b1506a12475dddcd3fbf486e266aa53af2cdaccddc8fb2994', 'search_path=pg_catalog, pg_temp'),
      ('gov_repo.record_technical_field_decision_governed_v1(uuid,uuid,bigint,bigint,timestamp with time zone,jsonb)', 'postgres', 'dfe58ec4f8f1389d282e9f439a94b58716395901eb2a460da9ad0e2ca1184b7c', 'search_path=pg_catalog, pg_temp'),
      ('gov_repo.l14_admit_authority_policy_version_v1(uuid,uuid,bigint,bigint,timestamp with time zone,text,uuid,uuid,text,jsonb,text,text[],text)', 'postgres', '3d732c3bb2615648bc333eb1b5c3c7971541b882b4745a388f737d1ac40b249e', 'search_path=pg_catalog, pg_temp;lock_timeout=5s'),
      ('gov_repo.l14_submit_proposal_v1(uuid,uuid,bigint,bigint,timestamp with time zone,text,text,text,text,uuid,uuid,text,timestamp with time zone,uuid,uuid,text,text[],text)', 'postgres', '28d1cace2a21401721c8e090f1d21864d7e3fcc51a8ff5e0574444c4f963e1c1', 'search_path=pg_catalog, pg_temp;lock_timeout=5s'),
      ('gov_repo.l14_decide_authority_policy_proposal_v1(uuid,uuid,bigint,bigint,timestamp with time zone,text,uuid,text,text,uuid,text,text[],text)', 'postgres', 'ac02a255a31a4e1c3da6cdba12ff9515ecb36d9362a79547aa8d140edb95cf94', 'search_path=pg_catalog, pg_temp;lock_timeout=5s'),
      ('gov_repo.l14_admit_governance_party_v1(uuid,uuid,bigint,bigint,timestamp with time zone,text,text,text,text,text,text[],text)', 'postgres', 'ca1e2ddf0342352993d07583c65a9f1be8b0779807aca39637e63ad62e977ac0', 'search_path=pg_catalog, pg_temp;lock_timeout=5s'),
      ('gov_repo.l14_submit_governance_party_proposal_v1(uuid,uuid,bigint,bigint,timestamp with time zone,text,text,text,uuid,text,timestamp with time zone,uuid,uuid,text,text[],text)', 'postgres', '6e9edcd7d85a9fc4c65cd4da8c96953e95798ab1b75e6356c00c348d1827cc5f', 'search_path=pg_catalog, pg_temp;lock_timeout=5s'),
      ('gov_repo.l14_decide_governance_party_proposal_v1(uuid,uuid,bigint,bigint,timestamp with time zone,text,uuid,text,text,uuid,text,text[],text)', 'postgres', '9cdf1725acbd78be30124efd1bb8e5852dcc419f479685404bde309b99bf90b3', 'search_path=pg_catalog, pg_temp;lock_timeout=5s'),
      ('gov_repo.l14_admit_governance_policy_v1(uuid,uuid,bigint,bigint,timestamp with time zone,text,text,text,text,text,text,text,text[],text)', 'postgres', 'f839e64c08421c460da352c1da18072713398a33c4e737a18c0584956f0b45f7', 'search_path=pg_catalog, pg_temp;lock_timeout=5s'),
      ('gov_repo.l14_admit_policy_version_v1(uuid,uuid,bigint,bigint,timestamp with time zone,text,uuid,uuid,text,text,text,text,text[],text)', 'postgres', '51ef06ec273da9bc69e5f7e72e41b6f383d102eadff5abf5f98ad2aec802dab3', 'search_path=pg_catalog, pg_temp;lock_timeout=5s'),
      ('gov_repo.l14_read_policy_descriptors_v1(uuid,uuid,bigint,bigint,timestamp with time zone,uuid)', 'postgres', '1704ba7d75fe6024c13f534f2b1f844d26d4ef3b3c3f1bf6c9444a974ba9b285', 'search_path=pg_catalog, pg_temp;lock_timeout=5s'),
      ('gov_repo.l14_submit_policy_version_proposal_v1(uuid,uuid,bigint,bigint,timestamp with time zone,text,text,text,uuid,uuid,text,timestamp with time zone,uuid,uuid,text,text[],text)', 'postgres', '949991c697678fac776936fd1910f3a32a0df010bfdb46b85ba117817f638a0c', 'search_path=pg_catalog, pg_temp;lock_timeout=5s'),
      ('gov_repo.l14_decide_policy_version_proposal_v1(uuid,uuid,bigint,bigint,timestamp with time zone,text,uuid,text,text,uuid,text,text[],text)', 'postgres', '198fe481b3f057a42cb6a583fe8cbbb11facc660679bb3381e2d7476efec9d99', 'search_path=pg_catalog, pg_temp;lock_timeout=5s'),
      ('gov_repo.l14_admit_domain_v1(uuid,uuid,bigint,bigint,timestamp with time zone,text,text,text,text,text,text,text[],text)', 'postgres', '333c32d4393ffc87a8df82bd1bd619fbbb2e34390fe95b779ced0920a7bb4f28', 'search_path=pg_catalog, pg_temp;lock_timeout=5s'),
      ('gov_repo.l14_submit_domain_proposal_v1(uuid,uuid,bigint,bigint,timestamp with time zone,text,text,text,text,text,timestamp with time zone,uuid,uuid,text,text[],text)', 'postgres', '7c2a80b56275e61e49a0dec96daf772363ad24e576a90d11e98377f7696fdf63', 'search_path=pg_catalog, pg_temp;lock_timeout=5s'),
      ('gov_repo.l14_decide_domain_proposal_v1(uuid,uuid,bigint,bigint,timestamp with time zone,text,uuid,text,text,uuid,text,text[],text)', 'postgres', '4d99534b4bfe2400a8db30b13ada0f1fadc71477efc2f94e09890a23cba9aa27', 'search_path=pg_catalog, pg_temp;lock_timeout=5s'),
      ('gov_repo.l14_admit_control_definition_version_v1(uuid,uuid,bigint,bigint,timestamp with time zone,text,uuid,uuid,text,uuid,text,text,text,text,text,text,text[],text)', 'postgres', '0486d46fa5f2c7fc5fd996bbef096e52602c6aeccd07a7c5c608952e5ee8fe4e', 'search_path=pg_catalog, pg_temp;lock_timeout=5s'),
      ('gov_repo.l14_submit_control_definition_proposal_v1(uuid,uuid,bigint,bigint,timestamp with time zone,text,text,text,uuid,uuid,text,timestamp with time zone,uuid,uuid,text,text[],text)', 'postgres', '8acea9a25d2c90ca9b732f9972cf458dcc41ec009f1bc79a8cee31f8e0b16063', 'search_path=pg_catalog, pg_temp;lock_timeout=5s'),
      ('gov_repo.l14_decide_control_definition_proposal_v1(uuid,uuid,bigint,bigint,timestamp with time zone,text,uuid,text,text,uuid,text,text[],text)', 'postgres', '2a71aa16e1aa43a4f916506afb8e682c689d6c5d78945ea5ebddb589a523587a', 'search_path=pg_catalog, pg_temp;lock_timeout=5s'),
      ('gov_repo.l14_submit_responsibility_assignment_proposal_v1(uuid,uuid,bigint,bigint,timestamp with time zone,text,text,text,text,text,text,uuid,uuid,timestamp with time zone,timestamp with time zone,uuid,uuid,text,text[],text)', 'postgres', '6cef279e89f21ac1aa8bab5b1605811cb4e9e5ca2cadf566263d371204800b53', 'search_path=pg_catalog, pg_temp;lock_timeout=5s'),
      ('gov_repo.l14_decide_responsibility_assignment_proposal_v1(uuid,uuid,bigint,bigint,timestamp with time zone,text,uuid,text,text,uuid,text,text[],text)', 'postgres', '5c506338903375e88f9f21a61a7d65cd116f1fba8aefc399e87966eb9e8c3e0a', 'search_path=pg_catalog, pg_temp;lock_timeout=5s'),
      ('gov_repo.l14_submit_business_context_assignment_proposal_v1(uuid,uuid,bigint,bigint,timestamp with time zone,text,text,text,text,text,text,text,uuid,timestamp with time zone,timestamp with time zone,uuid,uuid,text,text[],text)', 'postgres', '394b272b29caab3d1638ec49614616f9bbc207739581430e06a7846824a80244', 'search_path=pg_catalog, pg_temp;lock_timeout=5s'),
      ('gov_repo.l14_decide_business_context_assignment_proposal_v1(uuid,uuid,bigint,bigint,timestamp with time zone,text,uuid,text,text,uuid,text,text[],text)', 'postgres', 'e6370ee81510635c38ea359d4a328669e2d813a175c0618a3896e9024b82f656', 'search_path=pg_catalog, pg_temp;lock_timeout=5s'),
      ('gov_repo.ledger_append(character varying,text,character varying,uuid,uuid,inet,uuid,jsonb)', 'govia_ledger_executor', '8137f591bdd717ef18cbdc8b6146aab349626903aa9d080cebe55806190ae830', 'search_path=pg_catalog, {crypto}, pg_temp'),
      ('gov_repo.ledger_verify(bigint,bigint)', 'govia_ledger_executor', 'd52b7bc1d274cb11dd7ef4d3424d4056deba1df9846eb1195007f3695e091ec4', 'search_path=pg_catalog, {crypto}, pg_temp'),
      ('gov_repo.record_execution_snapshot(uuid,jsonb,text)', 'govia_runtime_executor', '882431691b588cedab4a7b6c2c947d834e48a3a9a7f9a94e43dc3782d6786f29', 'search_path=pg_catalog, pg_temp'),
      ('gov_repo.admit_runtime_observation(uuid,text,gov_repo.runtime_observations)', 'govia_runtime_executor', '9b6284dd7ca92f092fa567ff48e9ac3eae33f906c9653e9c4b204c04f1c51a18', 'search_path=pg_catalog, pg_temp'),
      ('gov_repo.read_runtime_observation_exact(uuid,gov_repo.runtime_reference,uuid)', 'govia_runtime_executor', 'eebbe4336fe8e5349d73c46d84c32c832bf6c283ac65dc7ddb062da0b73ffae0', 'search_path=pg_catalog, pg_temp'),
      ('gov_repo.record_cross_signal_comparison_result(uuid,text,jsonb)', 'govia_runtime_executor', '3771019f3c6291e866837703f2af100609f85c37603f8e2d82161436c713e84c', 'search_path=pg_catalog, pg_temp'),
      ('gov_repo.agent_compliance_gaps(uuid)', 'govia_legacy_read_executor', '2e27745223cfdd30f1ba41ffd6b0d0cb8fb61d1edf6cd5776be9915709d140a6', 'search_path=pg_catalog, pg_temp'),
      ('gov_repo.agent_graph_traverse(uuid,integer,gov_repo.edge_relationship[],boolean)', 'govia_legacy_read_executor', '568376c6d24590874162cc7e2db555219d501eb0f60168c30e7963cf8996c555', 'search_path=pg_catalog, pg_temp'),
      ('gov_repo.agent_semantic_search({vector},uuid,character varying,integer,numeric)', 'govia_legacy_read_executor', '0a53e2a91844531902963aa4ca55f6eaa375b15d09898f46ebbe3bbe19213f4f', 'search_path=pg_catalog, {vschema}, pg_temp'),
      ('gov_repo.recompute_risk_propagation(uuid,uuid)', 'govia_legacy_graph_executor', 'b5f6edac53c2c5acdda60729e5ad9de0956e407c829aaedbea3f4002e793b96c', 'search_path=pg_catalog, pg_temp')
    ) AS m(sig, owner_role, sha, cfg)
  LOOP
    v_oid := pg_catalog.to_regprocedure(pg_catalog.replace(v_entry.sig, '{vector}', pg_catalog.quote_ident(v_vector) || '.vector'));
    IF v_oid IS NULL THEN
      RAISE EXCEPTION 'M16_S1C1R1_POSTFLIGHT: approved routine % missing', v_entry.sig;
    END IF;
    SELECT p.proname, p.pronamespace, p.prosecdef, p.proowner, p.prosrc, p.proconfig, p.proacl INTO v_proc
    FROM pg_catalog.pg_proc AS p WHERE p.oid = v_oid;
    IF NOT v_proc.prosecdef THEN
      RAISE EXCEPTION 'M16_S1C1R1_POSTFLIGHT: % is not SECURITY DEFINER', v_oid::regprocedure;
    END IF;
    IF pg_catalog.pg_get_userbyid(v_proc.proowner) <> v_entry.owner_role THEN
      RAISE EXCEPTION 'M16_S1C1R1_POSTFLIGHT: % owner % is not %', v_oid::regprocedure, pg_catalog.pg_get_userbyid(v_proc.proowner), v_entry.owner_role;
    END IF;
    IF pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(v_proc.prosrc, 'UTF8')), 'hex') <> v_entry.sha THEN
      RAISE EXCEPTION 'M16_S1C1R1_POSTFLIGHT: % body hash changed', v_oid::regprocedure;
    END IF;
    IF COALESCE(pg_catalog.array_to_string(v_proc.proconfig, ';'), '-') <>
       pg_catalog.replace(pg_catalog.replace(v_entry.cfg, '{crypto}', pg_catalog.quote_ident(v_crypto)), '{vschema}', pg_catalog.quote_ident(v_vector)) THEN
      RAISE EXCEPTION 'M16_S1C1R1_POSTFLIGHT: % config changed: %', v_oid::regprocedure, v_proc.proconfig;
    END IF;
    IF NOT pg_catalog.has_function_privilege('service_role', v_oid, 'EXECUTE')
       OR pg_catalog.has_function_privilege('anon', v_oid, 'EXECUTE')
       OR pg_catalog.has_function_privilege('authenticated', v_oid, 'EXECUTE')
       OR EXISTS (SELECT 1 FROM pg_catalog.aclexplode(COALESCE(v_proc.proacl, pg_catalog.acldefault('f', v_proc.proowner))) AS a
                  WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE') THEN
      RAISE EXCEPTION 'M16_S1C1R1_POSTFLIGHT: % application EXECUTE is not exactly service_role', v_oid::regprocedure;
    END IF;
    IF v_proc.proname::text = ANY (v_new_rpcs)
       AND EXISTS (SELECT 1 FROM pg_catalog.aclexplode(v_proc.proacl) AS a
                   WHERE a.grantee NOT IN (v_proc.proowner, 'service_role'::regrole::oid) OR (a.grantee = 'service_role'::regrole::oid AND a.privilege_type <> 'EXECUTE')) THEN
      RAISE EXCEPTION 'M16_S1C1R1_POSTFLIGHT: % EXECUTE ACL is not exactly owner + service_role', v_oid::regprocedure;
    END IF;
    IF (SELECT pg_catalog.count(*) FROM pg_catalog.pg_proc AS p WHERE p.pronamespace = v_proc.pronamespace AND p.proname = v_proc.proname) <> 1 THEN
      RAISE EXCEPTION 'M16_S1C1R1_POSTFLIGHT: overload of approved routine %', v_oid::regprocedure;
    END IF;
    v_approved := v_approved || v_oid;
    IF v_entry.owner_role = 'postgres' THEN
      IF v_proc.proowner <> ALL (v_capable) THEN
        RAISE EXCEPTION 'M16_S1C1R1_POSTFLIGHT: canonical L14/S0 owner of % unexpectedly lost policy-store capability', v_oid::regprocedure;
      END IF;
      v_frozen := v_frozen || v_oid;
    ELSIF v_proc.proowner = ANY (v_capable) THEN
      RAISE EXCEPTION 'M16_S1C1R1_POSTFLIGHT: owner of % has policy-store capability', v_oid::regprocedure;
    END IF;
  END LOOP;
  IF pg_catalog.cardinality(v_approved) <> 37 OR pg_catalog.cardinality(v_frozen) <> 27 THEN
    RAISE EXCEPTION 'M16_S1C1R1_POSTFLIGHT: approved surface is not exactly 37 (27 policy-store-capable)';
  END IF;
  -- Control A + B over EVERY non-system, non-extension-member application-executable SECURITY DEFINER routine.
  FOR v_row IN
    SELECT p.oid, p.proowner FROM pg_catalog.pg_proc AS p
    WHERE p.prosecdef
      AND p.pronamespace NOT IN ('pg_catalog'::regnamespace, 'information_schema'::regnamespace)
      AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_depend AS d
                      WHERE d.classid = 'pg_catalog.pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e')
      AND (EXISTS (SELECT 1 FROM pg_catalog.aclexplode(COALESCE(p.proacl, pg_catalog.acldefault('f', p.proowner))) AS a
                   WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE')
           OR pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE')
           OR pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE')
           OR pg_catalog.has_function_privilege('service_role', p.oid, 'EXECUTE'))
  LOOP
    IF v_row.oid <> ALL (v_approved) THEN
      RAISE EXCEPTION 'M16_S1C1R1_POSTFLIGHT: CLOSED_SURFACE unapproved application-executable SECURITY DEFINER %', v_row.oid::regprocedure;
    END IF;
    IF v_row.proowner = ANY (v_capable) AND v_row.oid <> ALL (v_frozen) THEN
      RAISE EXCEPTION 'M16_S1C1R1_POSTFLIGHT: POLICY_STORE_OWNER application definer % outside the approved 27', v_row.oid::regprocedure;
    END IF;
  END LOOP;
  IF (SELECT pg_catalog.count(*) FROM pg_catalog.pg_proc AS p
       WHERE p.prosecdef AND p.pronamespace NOT IN ('pg_catalog'::regnamespace, 'information_schema'::regnamespace)
         AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_depend AS d
                          WHERE d.classid = 'pg_catalog.pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e')
         AND (pg_catalog.has_function_privilege('service_role', p.oid, 'EXECUTE')
              OR pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE')
              OR pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE')
              OR EXISTS (SELECT 1 FROM pg_catalog.aclexplode(COALESCE(p.proacl, pg_catalog.acldefault('f', p.proowner))) AS a
                          WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE'))) <> 37 THEN
    RAISE EXCEPTION 'M16_S1C1R1_POSTFLIGHT: application SECURITY DEFINER surface is not exactly 37';
  END IF;
  -- Every application definer that can reach a policy store is one of the 27 approved canonical-owner RPCs (no S1C.2
  -- RPC reaches one: neither by body text nor by a catalog dependency).
  FOR v_fn IN
    SELECT p.oid, p.proname FROM pg_catalog.pg_proc AS p
    WHERE p.prosecdef AND p.pronamespace NOT IN ('pg_catalog'::regnamespace, 'information_schema'::regnamespace)
      AND (p.prosrc ~ '(^|[^A-Za-z0-9_$])(governance_policies|policy_versions)([^A-Za-z0-9_$]|$)'
           OR EXISTS (SELECT 1 FROM pg_catalog.pg_depend AS d
                      WHERE d.classid = 'pg_catalog.pg_proc'::regclass AND d.objid = p.oid
                        AND d.refclassid = 'pg_catalog.pg_class'::regclass AND d.refobjid = ANY (v_stores)))
      AND (pg_catalog.has_function_privilege('service_role', p.oid, 'EXECUTE')
           OR pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE')
           OR pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE'))
  LOOP
    IF v_fn.oid <> ALL (v_frozen) THEN
      RAISE EXCEPTION 'M16_S1C1R1_POSTFLIGHT: application definer % reaches a policy store outside the approved 27', v_fn.oid::regprocedure;
    END IF;
    IF v_fn.proname::text = ANY (v_new_rpcs) THEN
      RAISE EXCEPTION 'M16_S1C1R1_POSTFLIGHT: S1C.2 RPC % reaches a policy store', v_fn.oid::regprocedure;
    END IF;
  END LOOP;

  -- H8. Default privileges: postgres-created routines (global + gov_repo) grant EXECUTE to neither PUBLIC nor an
  --     application role. (Table/sequence defaults are the legacy 20260818013113 service_role grants; every S1C.2
  --     table carries an explicit REVOKE and its EFFECTIVE ACL is proven closed above.)
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_default_acl AS d
                 WHERE d.defaclrole = 'postgres'::regrole AND d.defaclnamespace = 0 AND d.defaclobjtype = 'f')
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_default_acl AS d CROSS JOIN LATERAL pg_catalog.aclexplode(d.defaclacl) AS a
                WHERE d.defaclrole = 'postgres'::regrole AND d.defaclobjtype = 'f' AND a.privilege_type = 'EXECUTE'
                  AND d.defaclnamespace IN (0, 'gov_repo'::regnamespace)
                  AND (a.grantee = 0 OR a.grantee IN (SELECT r.oid FROM pg_catalog.pg_roles AS r WHERE r.rolname = ANY (v_app)))) THEN
    RAISE EXCEPTION 'M16_S1C1R1_POSTFLIGHT: postgres routine default privileges grant PUBLIC / application EXECUTE';
  END IF;

  -- H9. No inheritance, no readable/writable view leak and no sequence leak into the stores, the admission lineages, the
  --     S1B.4 / S1B.5 / S1B.6 history or the S1C.1 / S1C.2 fact history (any schema, transitive).
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_inherits AS i WHERE i.inhrelid = ANY (v_guarded) OR i.inhparent = ANY (v_guarded)) THEN
    RAISE EXCEPTION 'M16_S1C1R1_POSTFLIGHT: inheritance involves a policy store, an admission lineage or guarded history';
  END IF;
  FOR v_rel IN
    WITH RECURSIVE reach(oid) AS (
      SELECT w.ev_class FROM pg_catalog.pg_rewrite AS w
      JOIN pg_catalog.pg_depend AS d ON d.classid = 'pg_catalog.pg_rewrite'::regclass AND d.objid = w.oid
      WHERE d.refclassid = 'pg_catalog.pg_class'::regclass AND d.refobjid = ANY (v_guarded) AND w.ev_class <> ALL (v_guarded)
      UNION
      SELECT w.ev_class FROM reach
      JOIN pg_catalog.pg_depend AS d ON d.refclassid = 'pg_catalog.pg_class'::regclass AND d.refobjid = reach.oid
        AND d.classid = 'pg_catalog.pg_rewrite'::regclass
      JOIN pg_catalog.pg_rewrite AS w ON w.oid = d.objid
      WHERE w.ev_class <> reach.oid)
    SELECT DISTINCT c.oid, c.relname, c.relowner, c.relacl FROM reach JOIN pg_catalog.pg_class AS c ON c.oid = reach.oid
  LOOP
    IF EXISTS (SELECT 1 FROM pg_catalog.aclexplode(COALESCE(v_rel.relacl, pg_catalog.acldefault('r', v_rel.relowner))) AS a
               WHERE a.grantee = 0) THEN
      RAISE EXCEPTION 'M16_S1C1R1_POSTFLIGHT: view % reaching guarded history has a PUBLIC grant', v_rel.relname;
    END IF;
    FOREACH v_role IN ARRAY v_app LOOP
      FOREACH v_privilege IN ARRAY v_privileges LOOP
        IF pg_catalog.has_table_privilege(v_role, v_rel.oid, v_privilege) THEN
          RAISE EXCEPTION 'M16_S1C1R1_POSTFLIGHT: % holds % on view % reaching guarded history', v_role, v_privilege, v_rel.relname;
        END IF;
      END LOOP;
      IF pg_catalog.has_any_column_privilege(v_role, v_rel.oid, 'SELECT, INSERT, UPDATE, REFERENCES') THEN
        RAISE EXCEPTION 'M16_S1C1R1_POSTFLIGHT: % holds a column privilege on view % reaching guarded history', v_role, v_rel.relname;
      END IF;
    END LOOP;
  END LOOP;
  FOR v_rel IN
    SELECT DISTINCT s.oid, s.relname FROM pg_catalog.pg_class AS s
    JOIN pg_catalog.pg_depend AS d ON d.classid = 'pg_catalog.pg_class'::regclass AND d.objid = s.oid
    WHERE s.relkind = 'S' AND d.refclassid = 'pg_catalog.pg_class'::regclass AND d.refobjid = ANY (v_guarded)
    UNION
    SELECT DISTINCT s.oid, s.relname FROM pg_catalog.pg_attrdef AS ad
    JOIN pg_catalog.pg_depend AS d ON d.classid = 'pg_catalog.pg_attrdef'::regclass AND d.objid = ad.oid
    JOIN pg_catalog.pg_class AS s ON s.oid = d.refobjid AND s.relkind = 'S'
    WHERE ad.adrelid = ANY (v_guarded)
  LOOP
    FOREACH v_role IN ARRAY v_app LOOP
      IF pg_catalog.has_sequence_privilege(v_role, v_rel.oid, 'USAGE') OR pg_catalog.has_sequence_privilege(v_role, v_rel.oid, 'SELECT')
         OR pg_catalog.has_sequence_privilege(v_role, v_rel.oid, 'UPDATE') THEN
        RAISE EXCEPTION 'M16_S1C1R1_POSTFLIGHT: % holds a privilege on sequence %', v_role, v_rel.relname;
      END IF;
    END LOOP;
  END LOOP;

  -- H10. Frozen enumerations: exactly 11 canonical object kinds and 12 governed relationship types; neither
  --      BUSINESS_CONTEXT_ASSIGNMENT nor a domain is canonical and no BELONGS_TO_DOMAIN / IN_DOMAIN / HAS_*_DOMAIN type exists.
  IF (SELECT pg_catalog.array_agg(m.v[1] ORDER BY m.v[1] COLLATE "C")
      FROM pg_catalog.pg_constraint AS k
      CROSS JOIN LATERAL pg_catalog.regexp_matches(pg_catalog.pg_get_constraintdef(k.oid), '''([A-Z_]+)''', 'g') AS m(v)
      WHERE k.conrelid = 'gov_repo.canonical_objects'::regclass AND k.conname = 'canonical_objects_kind_check')
     IS DISTINCT FROM ARRAY['AGENT','AGENT_VERSION','API','DATA_ASSET','DATA_ELEMENT','KNOWLEDGE_BASE','MCP_SERVER',
                            'MODEL','PROMPT','SKILL','TOOL']
     OR (SELECT pg_catalog.array_agg(m.v[1] ORDER BY m.v[1] COLLATE "C")
      FROM pg_catalog.pg_constraint AS k
      CROSS JOIN LATERAL pg_catalog.regexp_matches(pg_catalog.pg_get_constraintdef(k.oid), '''([A-Z_]+)''', 'g') AS m(v)
      WHERE k.conrelid = 'gov_repo.canonical_relationships'::regclass AND k.conname = 'canonical_relationships_type_check')
     IS DISTINCT FROM ARRAY['DERIVED_FROM','EXPOSES','HANDOFF_TO','INVOKES','READS_FROM','USES_KNOWLEDGE_BASE','USES_MCP',
                            'USES_MODEL','USES_PROMPT','USES_SKILL','USES_TOOL','WRITES_TO'] THEN
    RAISE EXCEPTION 'M16_S1C1R1_POSTFLIGHT: canonical object kinds (11) / governed relationship types (12) changed';
  END IF;

  -- H11. F2: nothing on the L14 / policy surface references canonical_relationships; no l14 routine is a trigger on it; no
  --      l14 relation is attached to it by a trigger.
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_constraint AS k
             WHERE k.confrelid = 'gov_repo.canonical_relationships'::regclass
               AND (k.conrelid = ANY (v_stores)
                    OR k.conrelid IN (SELECT c.oid FROM pg_catalog.pg_class AS c
                                      WHERE c.relnamespace = 'gov_repo'::regnamespace AND c.relname LIKE 'l14\_%' ESCAPE '\')))
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_trigger AS t JOIN pg_catalog.pg_proc AS p ON p.oid = t.tgfoid
                WHERE t.tgrelid = 'gov_repo.canonical_relationships'::regclass
                  AND (p.proname::text = ANY (v_new_routines) OR p.proname LIKE 'l14\_%' ESCAPE '\')) THEN
    RAISE EXCEPTION 'M16_S1C1R1_POSTFLIGHT: F2 boundary violated';
  END IF;

  -- H12. S0 wrapper/eligibility naming contracts stay intact.
  IF (SELECT pg_catalog.count(*) FROM pg_catalog.pg_proc AS p WHERE p.pronamespace = 'gov_repo'::regnamespace
        AND p.proname IN ('apply_review_transition_governed_v1','record_authorized_reconciliation_governed_v1',
                          'materialize_object_reconciliation_governed_v1','materialize_relationship_reconciliation_governed_v1',
                          'record_technical_field_decision_governed_v1','record_execution_field_decision_governed_v1')) <> 6
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_proc AS p WHERE p.pronamespace = 'gov_repo'::regnamespace
        AND p.proname LIKE 'l14\_%' ESCAPE '\' AND (p.proname LIKE '%eligibility%' OR p.proname LIKE '%governed%')) THEN
    RAISE EXCEPTION 'M16_S1C1R1_POSTFLIGHT: S0 naming contract disturbed';
  END IF;
  -- H13. S1C.1R1: the owner-only SHARED Party dependency guard uses the EXACT S1B.1 GovernanceParty registry subject key
  --      (shared mode, no table access), and the RESPONSIBILITY decide RPC takes it for VALIDATE after the Authority Policy
  --      guard and before the cardinality / key / command guards.
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc AS p
                 WHERE p.oid = 'gov_repo.l14_lock_party_dependency_guard_shared_v1(uuid,uuid)'::regprocedure
                   AND NOT p.prosecdef AND p.prosrc LIKE '%pg_advisory_xact_lock_shared(%'
                   AND p.prosrc NOT LIKE '%pg_advisory_xact_lock(%'
                   AND p.prosrc LIKE '%ARRAY[p_organisation_id::text, ''l14-registry-subject-guard-v1'', ''GOVERNANCE_PARTY'', p_governance_party_id::text]%'
                   AND p.prosrc !~* '(\mFROM\M|\mINSERT\M|\mUPDATE\M|\mDELETE\M)')
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc AS p
                    WHERE p.oid = 'gov_repo.l14_decide_responsibility_assignment_proposal_v1(uuid,uuid,bigint,bigint,timestamp with time zone,text,uuid,text,text,uuid,text,text[],text)'::regprocedure
                      AND pg_catalog.strpos(p.prosrc, 'l14_lock_authority_policy_guard_shared_v1(v_org)') > 0
                      AND pg_catalog.strpos(p.prosrc, 'l14_lock_authority_policy_guard_shared_v1(v_org)')
                          < pg_catalog.strpos(p.prosrc, 'IF p_outcome = ''VALIDATE'' THEN
    PERFORM gov_repo.l14_lock_party_dependency_guard_shared_v1(v_org, v_proposal.governance_party_id);')
                      AND pg_catalog.strpos(p.prosrc, 'l14_lock_party_dependency_guard_shared_v1(v_org, v_proposal.governance_party_id)')
                          < pg_catalog.strpos(p.prosrc, 'ARRAY[''CARDINALITY''')
                      AND pg_catalog.strpos(p.prosrc, 'ARRAY[''CARDINALITY''') < pg_catalog.strpos(p.prosrc, 'l14_lock_command_guard_v1')) THEN
    RAISE EXCEPTION 'M16_S1C1R1_POSTFLIGHT: Party dependency guard key / mode / lock order drifted';
  END IF;
END;
$postflight$;

COMMIT;
