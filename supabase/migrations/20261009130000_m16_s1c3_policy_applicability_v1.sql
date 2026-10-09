-- M16-S1C.3: POLICY_APPLICABILITY — the third authoritative M16 fact family (DB only, ADDITIVE on S1B.0..S1C.1R1).
-- Architecture: docs/architecture/ADR-GOVIA-OWNERSHIP-BUSINESS-POLICY-CONTROL-ENRICHMENT-v1.md
-- §§2-4, 6-9, 13, 16-18, 20, 22-23 (O20-O29, O35, O39, O47, O49, O54, O55) plus the frozen S1B decisions (D-1..D-14).
-- No historical migration is edited. Never run against a hosted DB from this slice.
--
-- Meaning: an exact VALIDATED policy version either APPLIES or DOES_NOT_APPLY to ONE exact governed target at a business
-- instant. Absence of a current governed fact is UNKNOWN (never DOES_NOT_APPLY).
--   * Target identity is a CLOSED typed union (never JSON):
--       CANONICAL_OBJECT   = organisation + target_canonical_kind (any of the 11 kinds) + target_canonical_object_id,
--                            resolved against gov_repo.canonical_objects (organisation, id, declared kind);
--       RELATIONSHIP_STATE = organisation + target_relationship_id + target_relationship_state_id, resolved by an EXACT
--                            read-only triple lookup that must yield exactly one row (0 = unresolved, >1 = ambiguous: fail
--                            closed). Never a bare state id, a relationship id alone, the latest / current state of a
--                            relationship, a successor, an endpoint or a relationship type. The relationship type is
--                            DB-resolved for Authority Policy scope matching only.
--     A hybrid / partial target is impossible (CHECK + RPC). Never a name / label / external id / scanner / similarity.
--   * Policy identity = the S1B.3-admitted policy_id; exact immutable version identity = organisation + policy_id +
--     version_id + content_hash (the DB-verified hash of the hardened version row, via the S1B.3 admission lineage).
--     Every state pins the exact S1B.4 VALIDATED POLICY_VERSION state of that tuple (composite FK onto the S1B.4 state,
--     which itself FK-pins the admission and the store key incl. hash): dependency lineage only, never an identity.
--   * Logical fact key = organisation + exact target + policy_id. version_id, content_hash, the pinned state and the
--     applicability outcome are NOT part of the key: P/V1/APPLIES -> P/V2/APPLIES, P/V1/APPLIES -> P/V1/DOES_NOT_APPLY,
--     P/V1/DOES_NOT_APPLY -> P/V2/APPLIES are lineage SUCCESSORS of the same key (append-only; the predecessor's closure is
--     DERIVED from the visible successor, never written onto it). One head per key; at most one active state per key.
--   * It is an L14 fact, NOT a canonical relationship / object, a policy current_version_id, a legacy status / approval, a
--     policy_mandate_mappings row, scanner / LLM inference or text similarity. F2 untouched: canonical_relationships is
--     only READ by one owner-only exact-triple helper (no DDL / DML / FK / uniqueness / trigger; no APPLIES_POLICY /
--     SUBJECT_TO_POLICY / GOVERNED_BY_POLICY type).
--
-- This migration, over the EXISTING S1B.0 framework and the EXISTING S1C.1 fact envelope (no parallel fact framework):
--   A. Preflight: the exact post-S1C.1R1 catalog, or it aborts with nothing applied.
--   B. Closed framework widening: governance-decision subject / reason codes; POLICY_APPLICABILITY authorizations are exact
--      CANONICAL_OBJECT or RELATIONSHIP_STATE requests; the command-result fact branch and the l14_fact_states subject
--      vocabulary gain exactly POLICY_APPLICABILITY (CONTROL_APPLICABILITY / CONTROL_ASSESSMENT stay unimplemented); the
--      fact guard accepts exactly the three families. Every historical row and shape is kept verbatim.
--   C. Owner-only IMMUTABLE target-key encoder; typed immutable proposal + state detail; RPC-maintained CAS head per key.
--   D. Structural guards (raising, ENABLE ALWAYS): LOCAL_HUMAN-only source, state mirrors envelope + deciding proposal +
--      authorization target (incl. the DB-resolved relationship type), exact target resolution, per-key interval lineage,
--      exact POLICY_VERSION dependency valid at the state's own coordinates, head lineage.
--   E. Owner-only helpers: exact relationship-state resolver, SHARED POLICY_VERSION dependency guard (the exact S1B.4
--      registry subject guard key, shared mode), relationship-state authority evaluator, durable result projection, exact
--      bitemporal resolver and the bounded current-applicability read.
--   F. Two NEW SECURITY DEFINER RPCs (service_role only), replay-first: SUBMIT (any verified ACTIVE member; proposal only)
--      and DECIDE (L14_POLICY_APPLICABILITY_VALIDATE, requested action = exact outcome).
--   G. Privileges, comments and a postflight over the EFFECTIVE post-S1C.3 catalog:
--      application SECURITY DEFINER surface 37 -> 39; canonical-owner (policy-store-capable) class 27 -> 29.
-- Lock order of DECIDE VALIDATE (deadlock-free against every existing M16 path): Authority Policy guard SHARED -> exact
-- POLICY_VERSION registry subject guard SHARED (the S1B.4 DECIDE takes it EXCLUSIVELY: AP -> registry subject -> command)
-- -> exact POLICY_APPLICABILITY fact KEY guard EXCLUSIVE -> command guard. Held to commit. REVOKE / REJECT / DEFER do not
-- take the dependency guard and never check dependency validity (an applicability whose pinned version later became invalid
-- can always be ended explicitly).
BEGIN;

-- ---------------------------------------------------------------------------------------
-- A. Preflight: the exact post-S1C.1R1 catalog, or abort with nothing applied.
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
    RAISE EXCEPTION 'M16_S1C3_PREFLIGHT: PostgreSQL 17 required' USING ERRCODE = '55000';
  END IF;
  IF v_crypto IS NULL OR v_vector IS NULL THEN
    RAISE EXCEPTION 'M16_S1C3_PREFLIGHT: pgcrypto / vector unresolved' USING ERRCODE = '55000';
  END IF;
  -- Exact S1C.2 / S1C.1R1 l14 relation set (tables only).
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
    RAISE EXCEPTION 'M16_S1C3_PREFLIGHT: unexpected l14 relation set (S1C.1R1 horizon expected)' USING ERRCODE = '55000';
  END IF;
  -- The fact framework / POLICY_VERSION keys this slice reuses or widens, in their exact post-S1C.1R1 form.
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint AS k WHERE k.conrelid = 'gov_repo.l14_fact_states'::regclass
                   AND k.conname = 'l14_fact_states_subject_kind_check'
                   AND pg_catalog.pg_get_constraintdef(k.oid) = 'CHECK ((subject_kind = ANY (ARRAY[''RESPONSIBILITY_ASSIGNMENT''::text, ''BUSINESS_CONTEXT_ASSIGNMENT''::text])))')
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint AS k WHERE k.conrelid = 'gov_repo.l14_fact_states'::regclass
                      AND k.conname = 'l14_fact_states_kind_unique' AND k.contype = 'u')
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint AS k WHERE k.conrelid = 'gov_repo.l14_governance_decisions'::regclass
                      AND k.conname = 'l14_governance_decisions_subject_kind_check'
                      AND pg_catalog.pg_get_constraintdef(k.oid) LIKE '%BUSINESS_CONTEXT_ASSIGNMENT%'
                      AND pg_catalog.pg_get_constraintdef(k.oid) NOT LIKE '%POLICY_APPLICABILITY%')
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint AS k WHERE k.conrelid = 'gov_repo.l14_command_results'::regclass
                      AND k.conname = 'l14_command_results_shape_check'
                      AND pg_catalog.pg_get_constraintdef(k.oid) LIKE '%BUSINESS_CONTEXT_ASSIGNMENT%'
                      AND pg_catalog.pg_get_constraintdef(k.oid) NOT LIKE '%POLICY_APPLICABILITY%')
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint AS k WHERE k.conrelid = 'gov_repo.l14_authorization_decisions'::regclass
                      AND k.conname = 'l14_authorization_decisions_request_target_check' AND k.contype = 'c'
                      AND pg_catalog.pg_get_constraintdef(k.oid) LIKE '%RELATIONSHIP_STATE%')
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_constraint AS k WHERE k.conrelid = 'gov_repo.l14_authorization_decisions'::regclass
                  AND k.conname = 'l14_authorization_decisions_policy_applicability_target_check')
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint AS k WHERE k.conrelid = 'gov_repo.l14_policy_version_states'::regclass
                      AND k.conname = 'l14_policy_version_states_kind_unique' AND k.contype = 'u')
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint AS k WHERE k.conrelid = 'gov_repo.l14_policy_admissions'::regclass
                      AND k.conname = 'l14_policy_admissions_pkey' AND k.contype = 'p')
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint AS k WHERE k.conrelid = 'gov_repo.canonical_objects'::regclass
                      AND k.conname = 'canonical_objects_org_id_kind_unique' AND k.contype = 'u')
     OR pg_catalog.to_regprocedure('gov_repo.l14_policy_version_valid_state_v1(uuid,uuid,uuid,text,timestamp with time zone,timestamp with time zone)') IS NULL
     OR pg_catalog.to_regprocedure('gov_repo.l14_evaluate_target_authority_rules_v1(uuid,uuid,uuid,uuid[],text,text,boolean,text,text,text)') IS NULL
     OR pg_catalog.to_regprocedure('gov_repo.l14_lock_party_dependency_guard_shared_v1(uuid,uuid)') IS NULL
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc AS p
                    WHERE p.oid = pg_catalog.to_regprocedure('gov_repo.l14_lock_registry_subject_guard_v1(uuid,text,text)')
                      AND p.prosrc LIKE '%pg_advisory_xact_lock(%'
                      AND p.prosrc LIKE '%ARRAY[p_organisation_id::text, ''l14-registry-subject-guard-v1'', p_subject_kind, p_subject_key]%')
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc AS p
                    WHERE p.oid = pg_catalog.to_regprocedure('gov_repo.l14_decide_policy_version_proposal_v1(uuid,uuid,bigint,bigint,timestamp with time zone,text,uuid,text,text,uuid,text,text[],text)')
                      AND p.prosrc LIKE '%''POLICY_VERSION_VALIDATION:'' || v_proposal.policy_id::text || '':'' || v_proposal.version_id::text || '':''%')
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc AS p
                    WHERE p.oid = pg_catalog.to_regprocedure('gov_repo.l14_lock_fact_subject_guard_v1(uuid,text,text[])')
                      AND p.prosrc LIKE '%p_subject_kind NOT IN (''RESPONSIBILITY_ASSIGNMENT'',''BUSINESS_CONTEXT_ASSIGNMENT'')%') THEN
    RAISE EXCEPTION 'M16_S1C3_PREFLIGHT: S1C.1R1 fact framework / S1B.4 POLICY_VERSION keys missing or already widened' USING ERRCODE = '55000';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_proc AS p WHERE p.pronamespace = 'gov_repo'::regnamespace
             AND (p.proname LIKE 'l14\_%policy\_applicab%' ESCAPE '\'
                  OR p.proname IN ('l14_lock_policy_version_dependency_guard_shared_v1','l14_resolve_relationship_state_target_v1',
                                   'l14_evaluate_relationship_state_authority_rules_v1'))) THEN
    RAISE EXCEPTION 'M16_S1C3_PREFLIGHT: an S1C.3 routine already exists' USING ERRCODE = '55000';
  END IF;
  -- The exact 37 approved application definers of the post-S1C.1R1 catalog (owner class, body, config).
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
      RAISE EXCEPTION 'M16_S1C3_PREFLIGHT: approved routine % missing', v_entry.sig USING ERRCODE = '55000';
    END IF;
    SELECT p.prosecdef, p.proowner, p.prosrc, p.proconfig INTO v_proc FROM pg_catalog.pg_proc AS p WHERE p.oid = v_oid;
    IF NOT v_proc.prosecdef OR pg_catalog.pg_get_userbyid(v_proc.proowner) <> v_entry.owner_role
       OR pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(v_proc.prosrc, 'UTF8')), 'hex') <> v_entry.sha
       OR COALESCE(pg_catalog.array_to_string(v_proc.proconfig, ';'), '-') <>
          pg_catalog.replace(pg_catalog.replace(v_entry.cfg, '{crypto}', pg_catalog.quote_ident(v_crypto)), '{vschema}', pg_catalog.quote_ident(v_vector)) THEN
      RAISE EXCEPTION 'M16_S1C3_PREFLIGHT: approved routine % differs from its post-S1C.1R1 owner/body/config', v_oid::regprocedure
        USING ERRCODE = '55000';
    END IF;
  END LOOP;
  -- The closed application surface is exactly those 37 (extension members excluded, any schema).
  IF (SELECT pg_catalog.count(*) FROM pg_catalog.pg_proc AS p
       WHERE p.prosecdef AND p.pronamespace NOT IN ('pg_catalog'::regnamespace, 'information_schema'::regnamespace)
         AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_depend AS d
                          WHERE d.classid = 'pg_catalog.pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e')
         AND (pg_catalog.has_function_privilege('service_role', p.oid, 'EXECUTE')
              OR pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE')
              OR pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE')
              OR EXISTS (SELECT 1 FROM pg_catalog.aclexplode(COALESCE(p.proacl, pg_catalog.acldefault('f', p.proowner))) AS a
                          WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE'))) <> 37 THEN
    RAISE EXCEPTION 'M16_S1C3_PREFLIGHT: application SECURITY DEFINER surface is not exactly the 37 post-S1C.1R1 baseline' USING ERRCODE = '55000';
  END IF;
  -- No POLICY_APPLICABILITY governance history may pre-exist (nothing before S1C.3 could write any).
  IF EXISTS (SELECT 1 FROM gov_repo.l14_proposals AS p WHERE p.subject_kind = 'POLICY_APPLICABILITY')
     OR EXISTS (SELECT 1 FROM gov_repo.l14_authorization_decisions AS a WHERE a.subject_kind = 'POLICY_APPLICABILITY') THEN
    RAISE EXCEPTION 'M16_S1C3_PREFLIGHT: policy applicability governance history already exists' USING ERRCODE = '55000';
  END IF;
END;
$preflight$;

-- ---------------------------------------------------------------------------------------
-- B. Closed framework widening required by the third fact family.
-- ---------------------------------------------------------------------------------------

-- B1. Governance decisions: the POLICY_APPLICABILITY subject and its four closed reason codes (the S1B.0 subject x outcome
--     reason rule yields exactly POLICY_APPLICABILITY_{VALIDATED,REJECTED,DEFERRED,REVOKED}). Existing rows satisfy it.
ALTER TABLE gov_repo.l14_governance_decisions
  DROP CONSTRAINT l14_governance_decisions_subject_kind_check,
  DROP CONSTRAINT l14_governance_decisions_reason_code_check;
ALTER TABLE gov_repo.l14_governance_decisions
  ADD CONSTRAINT l14_governance_decisions_subject_kind_check CHECK (subject_kind IN (
    'AUTHORITY_POLICY_VERSION','GOVERNANCE_PARTY','BUSINESS_DOMAIN','INFORMATION_DOMAIN','CONTROL_DEFINITION','POLICY_VERSION',
    'RESPONSIBILITY_ASSIGNMENT','BUSINESS_CONTEXT_ASSIGNMENT','POLICY_APPLICABILITY')),
  ADD CONSTRAINT l14_governance_decisions_reason_code_check CHECK (reason_code IN (
    'AUTHORITY_POLICY_VALIDATED','AUTHORITY_POLICY_REJECTED','AUTHORITY_POLICY_DEFERRED','AUTHORITY_POLICY_REVOKED',
    'GOVERNANCE_PARTY_VALIDATED','GOVERNANCE_PARTY_REJECTED','GOVERNANCE_PARTY_DEFERRED','GOVERNANCE_PARTY_REVOKED',
    'BUSINESS_DOMAIN_VALIDATED','BUSINESS_DOMAIN_REJECTED','BUSINESS_DOMAIN_DEFERRED','BUSINESS_DOMAIN_REVOKED',
    'INFORMATION_DOMAIN_VALIDATED','INFORMATION_DOMAIN_REJECTED','INFORMATION_DOMAIN_DEFERRED','INFORMATION_DOMAIN_REVOKED',
    'CONTROL_DEFINITION_VALIDATED','CONTROL_DEFINITION_REJECTED','CONTROL_DEFINITION_DEFERRED','CONTROL_DEFINITION_REVOKED',
    'POLICY_VERSION_VALIDATED','POLICY_VERSION_REJECTED','POLICY_VERSION_DEFERRED','POLICY_VERSION_REVOKED',
    'RESPONSIBILITY_ASSIGNMENT_VALIDATED','RESPONSIBILITY_ASSIGNMENT_REJECTED','RESPONSIBILITY_ASSIGNMENT_DEFERRED',
    'RESPONSIBILITY_ASSIGNMENT_REVOKED',
    'BUSINESS_CONTEXT_ASSIGNMENT_VALIDATED','BUSINESS_CONTEXT_ASSIGNMENT_REJECTED','BUSINESS_CONTEXT_ASSIGNMENT_DEFERRED',
    'BUSINESS_CONTEXT_ASSIGNMENT_REVOKED',
    'POLICY_APPLICABILITY_VALIDATED','POLICY_APPLICABILITY_REJECTED','POLICY_APPLICABILITY_DEFERRED',
    'POLICY_APPLICABILITY_REVOKED'));

-- B2. Authorization decisions: a POLICY_APPLICABILITY request target is ONE exact canonical object (the existing S1B.0 FK
--     pins organisation + id + declared kind) or ONE exact relationship state with its DB-resolved type (the existing
--     S1B.0 request-target shape; deliberately no FK onto the F2 table). Never organisation-wide. New CHECK only.
ALTER TABLE gov_repo.l14_authorization_decisions
  ADD CONSTRAINT l14_authorization_decisions_policy_applicability_target_check CHECK (
    subject_kind <> 'POLICY_APPLICABILITY'
    OR (scope_tag IN ('CANONICAL_OBJECT','RELATIONSHIP_STATE')
        AND attempted_content_hash IS NULL AND expected_latest_version_id IS NULL
        AND expectation_kind IN ('EXPECTED_NONE','EXPECTED_CURRENT')));

-- B3. The common fact-state envelope admits exactly the three implemented fact families (CONTROL_APPLICABILITY and
--     CONTROL_ASSESSMENT stay unimplemented). Every S1C.1 / S1C.2 row satisfies the widened CHECK.
ALTER TABLE gov_repo.l14_fact_states
  DROP CONSTRAINT l14_fact_states_subject_kind_check;
ALTER TABLE gov_repo.l14_fact_states
  ADD CONSTRAINT l14_fact_states_subject_kind_check CHECK (subject_kind IN (
    'RESPONSIBILITY_ASSIGNMENT','BUSINESS_CONTEXT_ASSIGNMENT','POLICY_APPLICABILITY'));

-- B4. Command results: the S1C.1 fact branch is reused verbatim for the third family. The S1A AUTHORITY_POLICY_VERSION
--     branch and the S1B registry branch are kept VERBATIM.
ALTER TABLE gov_repo.l14_command_results
  DROP CONSTRAINT l14_command_results_subject_kind_check,
  DROP CONSTRAINT l14_command_results_shape_check;
ALTER TABLE gov_repo.l14_command_results
  ADD CONSTRAINT l14_command_results_subject_kind_check CHECK (subject_kind IN (
    'AUTHORITY_POLICY_VERSION','GOVERNANCE_PARTY','BUSINESS_DOMAIN','INFORMATION_DOMAIN','CONTROL_DEFINITION','POLICY_VERSION',
    'RESPONSIBILITY_ASSIGNMENT','BUSINESS_CONTEXT_ASSIGNMENT','POLICY_APPLICABILITY')),
  ADD CONSTRAINT l14_command_results_shape_check CHECK (
    (subject_kind = 'AUTHORITY_POLICY_VERSION' AND registry_state_id IS NULL AND fact_state_id IS NULL AND (
      (command_kind = 'SUBMIT_PROPOSAL' AND outcome = 'SUBMITTED' AND authorization_decision_id IS NULL
        AND proposal_id IS NOT NULL AND governance_decision_id IS NULL AND state_id IS NULL AND version_id IS NOT NULL)
      OR (command_kind = 'ADMIT_AUTHORITY_POLICY_VERSION' AND outcome = 'ADMITTED' AND authorization_decision_id IS NOT NULL
        AND proposal_id IS NULL AND governance_decision_id IS NULL AND state_id IS NULL
        AND authority_policy_id IS NOT NULL AND version_id IS NOT NULL)
      OR (command_kind IN ('ADMIT_AUTHORITY_POLICY_VERSION','DECIDE_PROPOSAL') AND outcome = 'DENIED'
        AND authorization_decision_id IS NOT NULL AND governance_decision_id IS NULL AND state_id IS NULL)
      OR (command_kind = 'DECIDE_PROPOSAL' AND outcome IN ('VALIDATED','REVOKED') AND authorization_decision_id IS NOT NULL
        AND proposal_id IS NOT NULL AND governance_decision_id IS NOT NULL AND state_id IS NOT NULL)
      OR (command_kind = 'DECIDE_PROPOSAL' AND outcome IN ('REJECTED','DEFERRED') AND authorization_decision_id IS NOT NULL
        AND proposal_id IS NOT NULL AND governance_decision_id IS NOT NULL AND state_id IS NULL)))
    OR (subject_kind IN ('GOVERNANCE_PARTY','BUSINESS_DOMAIN','INFORMATION_DOMAIN','CONTROL_DEFINITION','POLICY_VERSION')
      AND fact_state_id IS NULL
      AND authority_policy_id IS NULL AND version_id IS NULL AND state_id IS NULL AND (
      (command_kind = 'SUBMIT_PROPOSAL' AND outcome = 'SUBMITTED' AND authorization_decision_id IS NULL
        AND proposal_id IS NOT NULL AND governance_decision_id IS NULL AND registry_state_id IS NULL)
      OR (command_kind LIKE 'ADMIT\_%' ESCAPE '\' AND outcome = 'ADMITTED' AND authorization_decision_id IS NOT NULL
        AND proposal_id IS NULL AND governance_decision_id IS NULL AND registry_state_id IS NULL)
      OR (command_kind LIKE 'ADMIT\_%' ESCAPE '\' AND outcome = 'DENIED' AND authorization_decision_id IS NOT NULL
        AND proposal_id IS NULL AND governance_decision_id IS NULL AND registry_state_id IS NULL)
      OR (command_kind = 'DECIDE_PROPOSAL' AND outcome = 'DENIED' AND authorization_decision_id IS NOT NULL
        AND proposal_id IS NOT NULL AND governance_decision_id IS NULL AND registry_state_id IS NULL)
      OR (command_kind = 'DECIDE_PROPOSAL' AND outcome IN ('VALIDATED','REVOKED') AND authorization_decision_id IS NOT NULL
        AND proposal_id IS NOT NULL AND governance_decision_id IS NOT NULL AND registry_state_id IS NOT NULL)
      OR (command_kind = 'DECIDE_PROPOSAL' AND outcome IN ('REJECTED','DEFERRED') AND authorization_decision_id IS NOT NULL
        AND proposal_id IS NOT NULL AND governance_decision_id IS NOT NULL AND registry_state_id IS NULL)))
    OR (subject_kind IN ('RESPONSIBILITY_ASSIGNMENT','BUSINESS_CONTEXT_ASSIGNMENT','POLICY_APPLICABILITY')
      AND authority_policy_id IS NULL AND version_id IS NULL AND state_id IS NULL AND registry_state_id IS NULL AND (
      (command_kind = 'SUBMIT_PROPOSAL' AND outcome = 'SUBMITTED' AND authorization_decision_id IS NULL
        AND proposal_id IS NOT NULL AND governance_decision_id IS NULL AND fact_state_id IS NULL)
      OR (command_kind = 'DECIDE_PROPOSAL' AND outcome = 'DENIED' AND authorization_decision_id IS NOT NULL
        AND proposal_id IS NOT NULL AND governance_decision_id IS NULL AND fact_state_id IS NULL)
      OR (command_kind = 'DECIDE_PROPOSAL' AND outcome IN ('VALIDATED','REVOKED') AND authorization_decision_id IS NOT NULL
        AND proposal_id IS NOT NULL AND governance_decision_id IS NOT NULL AND fact_state_id IS NOT NULL)
      OR (command_kind = 'DECIDE_PROPOSAL' AND outcome IN ('REJECTED','DEFERRED') AND authorization_decision_id IS NOT NULL
        AND proposal_id IS NOT NULL AND governance_decision_id IS NOT NULL AND fact_state_id IS NULL))));

-- B5. The S1C.1 EXCLUSIVE fact guard, reused (never a second guard framework): its closed subject vocabulary gains exactly
--     POLICY_APPLICABILITY. Same signature, owner, ACL (owner-only) and frame_identity key derivation; the existing key
--     spaces are unchanged (the subject kind is part of every key).
CREATE OR REPLACE FUNCTION gov_repo.l14_lock_fact_subject_guard_v1(p_organisation_id uuid, p_subject_kind text, p_key_parts text[])
RETURNS void
LANGUAGE plpgsql
VOLATILE
SET search_path = pg_catalog, pg_temp
AS $guard$
BEGIN
  IF p_organisation_id IS NULL OR p_subject_kind IS NULL
     OR p_subject_kind NOT IN ('RESPONSIBILITY_ASSIGNMENT','BUSINESS_CONTEXT_ASSIGNMENT','POLICY_APPLICABILITY')
     OR p_key_parts IS NULL OR pg_catalog.cardinality(p_key_parts) NOT BETWEEN 1 AND 8
     OR pg_catalog.array_position(p_key_parts, NULL::text) IS NOT NULL
     OR p_key_parts[1] NOT IN ('CARDINALITY','KEY') THEN
    RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'GUARD_KEY_INVALID';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    gov_repo.frame_identity(ARRAY[p_organisation_id::text, 'l14-fact-subject-guard-v1', p_subject_kind] || p_key_parts), 0));
END;
$guard$;

-- ---------------------------------------------------------------------------------------
-- C0. Owner-only IMMUTABLE exact target-key encoder of the closed target union. Injective (every operand is length-
--     prefixed and the branch is tagged); NULL for any hybrid / partial / unknown shape, so a hybrid target can never
--     obtain a key (the key columns below are NOT NULL). It is the generated key of every S1C.3 table and of the guard.
-- ---------------------------------------------------------------------------------------
CREATE FUNCTION gov_repo.l14_policy_applicability_target_key_v1(
  p_target_type text, p_target_canonical_kind text, p_target_canonical_object_id text,
  p_target_relationship_id text, p_target_relationship_state_id text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT CASE
    WHEN p_target_type = 'CANONICAL_OBJECT' AND p_target_canonical_kind IS NOT NULL AND p_target_canonical_object_id IS NOT NULL
         AND p_target_relationship_id IS NULL AND p_target_relationship_state_id IS NULL
      THEN 'CANONICAL_OBJECT|' || pg_catalog.length(p_target_canonical_kind)::text || ':' || p_target_canonical_kind
           || '|' || pg_catalog.length(p_target_canonical_object_id)::text || ':' || p_target_canonical_object_id
    WHEN p_target_type = 'RELATIONSHIP_STATE' AND p_target_canonical_kind IS NULL AND p_target_canonical_object_id IS NULL
         AND p_target_relationship_id IS NOT NULL AND p_target_relationship_state_id IS NOT NULL
      THEN 'RELATIONSHIP_STATE|' || pg_catalog.length(p_target_relationship_id)::text || ':' || p_target_relationship_id
           || '|' || pg_catalog.length(p_target_relationship_state_id)::text || ':' || p_target_relationship_state_id
  END
$$;

-- ---------------------------------------------------------------------------------------
-- C1. Typed immutable POLICY_APPLICABILITY state detail over the fact envelope. Exact target union + policy (the logical
--     key), the exact immutable version tuple, the pinned VALIDATED POLICY_VERSION state (dependency lineage only) and the
--     outcome. Linear per-key lineage: a successor may pin ANOTHER version / outcome of the same policy; a REVOKED state
--     revokes exactly its VALIDATED predecessor of the same key, tuple, dependency and outcome. No JSON, no rationale.
-- ---------------------------------------------------------------------------------------
CREATE TABLE gov_repo.l14_policy_applicability_states (
  organisation_id uuid NOT NULL,
  fact_state_id uuid NOT NULL,
  subject_kind text NOT NULL DEFAULT 'POLICY_APPLICABILITY' CHECK (subject_kind = 'POLICY_APPLICABILITY'),
  state_kind text NOT NULL CHECK (state_kind IN ('VALIDATED','REVOKED')),
  target_type text NOT NULL CHECK (target_type IN ('CANONICAL_OBJECT','RELATIONSHIP_STATE')),
  target_canonical_kind text CHECK (target_canonical_kind IN (
    'AGENT','AGENT_VERSION','MODEL','TOOL','MCP_SERVER','API','PROMPT','KNOWLEDGE_BASE','DATA_ASSET','DATA_ELEMENT','SKILL')),
  target_canonical_object_id text CHECK (pg_catalog.length(target_canonical_object_id) BETWEEN 1 AND 500
    AND target_canonical_object_id = pg_catalog.btrim(target_canonical_object_id)),
  target_relationship_id text CHECK (pg_catalog.length(target_relationship_id) BETWEEN 1 AND 500
    AND target_relationship_id = pg_catalog.btrim(target_relationship_id)),
  target_relationship_state_id text CHECK (pg_catalog.length(target_relationship_state_id) BETWEEN 1 AND 500
    AND target_relationship_state_id = pg_catalog.btrim(target_relationship_state_id)),
  target_key text NOT NULL GENERATED ALWAYS AS (gov_repo.l14_policy_applicability_target_key_v1(target_type,
    target_canonical_kind, target_canonical_object_id, target_relationship_id, target_relationship_state_id)) STORED
    CHECK (pg_catalog.length(target_key) BETWEEN 1 AND 1100),
  policy_id uuid NOT NULL,
  version_id uuid NOT NULL,
  content_hash character(64) NOT NULL CHECK (content_hash::text ~ '^[0-9a-f]{64}$'),
  policy_version_validated_state_id uuid NOT NULL,   -- dependency lineage ONLY (never a policy / version identity)
  policy_version_state_kind text NOT NULL DEFAULT 'VALIDATED' CHECK (policy_version_state_kind = 'VALIDATED'),
  applicability text NOT NULL CHECK (applicability IN ('APPLIES','DOES_NOT_APPLY')),
  predecessor_state_id uuid,                         -- copy of the envelope value (verified on insert)
  revokes_state_id uuid,                             -- copy of the envelope value (verified on insert)
  revoked_state_kind text GENERATED ALWAYS AS (
    CASE WHEN revokes_state_id IS NULL THEN NULL ELSE 'VALIDATED' END) STORED
    CHECK (revoked_state_kind IS NULL OR revoked_state_kind = 'VALIDATED'),
  CONSTRAINT l14_policy_applicability_states_pkey PRIMARY KEY (organisation_id, fact_state_id),
  CONSTRAINT l14_policy_applicability_states_key_unique UNIQUE (organisation_id, fact_state_id, target_key, policy_id),
  -- The exact pin a REVOKE (proposal or state) uses: same key, tuple, dependency, outcome, VALIDATED.
  CONSTRAINT l14_policy_applicability_states_kind_unique
    UNIQUE (organisation_id, fact_state_id, target_key, policy_id, version_id, content_hash, policy_version_validated_state_id,
            applicability, state_kind),
  -- The closed target union: exactly one branch populated (never hybrid, never partial).
  CONSTRAINT l14_policy_applicability_states_target_union_check CHECK (
    (target_type = 'CANONICAL_OBJECT' AND target_canonical_kind IS NOT NULL AND target_canonical_object_id IS NOT NULL
      AND target_relationship_id IS NULL AND target_relationship_state_id IS NULL)
    OR (target_type = 'RELATIONSHIP_STATE' AND target_canonical_kind IS NULL AND target_canonical_object_id IS NULL
      AND target_relationship_id IS NOT NULL AND target_relationship_state_id IS NOT NULL)),
  CONSTRAINT l14_policy_applicability_states_shape_check CHECK (
    (state_kind = 'VALIDATED' AND revokes_state_id IS NULL)
    OR (state_kind = 'REVOKED' AND revokes_state_id IS NOT NULL AND predecessor_state_id = revokes_state_id)),
  CONSTRAINT l14_policy_applicability_states_envelope_fkey
    FOREIGN KEY (organisation_id, fact_state_id, subject_kind, state_kind)
    REFERENCES gov_repo.l14_fact_states (organisation_id, fact_state_id, subject_kind, state_kind),
  -- CANONICAL_OBJECT branch: the exact same-tenant canonical object of its declared kind (the RELATIONSHIP_STATE branch has
  -- NULL object operands; it is resolved by the exact triple lookup — no FK / uniqueness onto the F2 table).
  CONSTRAINT l14_policy_applicability_states_target_object_fkey
    FOREIGN KEY (organisation_id, target_canonical_object_id, target_canonical_kind)
    REFERENCES gov_repo.canonical_objects (organisation_id, canonical_object_id, kind) ON UPDATE RESTRICT ON DELETE RESTRICT,
  -- The exact S1B.4 VALIDATED state of THIS policy + version + DB-verified hash in THIS organisation (which itself FK-pins
  -- the S1B.3 admission lineage and the hardened store key incl. the hash): a swapped / foreign / other-version /
  -- other-policy / unadmitted / legacy-only tuple has no such row.
  CONSTRAINT l14_policy_applicability_states_policy_version_fkey
    FOREIGN KEY (organisation_id, policy_version_validated_state_id, policy_id, version_id, content_hash, policy_version_state_kind)
    REFERENCES gov_repo.l14_policy_version_states (organisation_id, state_id, policy_id, version_id, content_hash, state_kind)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  -- Same logical key (the version / outcome may differ: supersession).
  CONSTRAINT l14_policy_applicability_states_predecessor_fkey
    FOREIGN KEY (organisation_id, predecessor_state_id, target_key, policy_id)
    REFERENCES gov_repo.l14_policy_applicability_states (organisation_id, fact_state_id, target_key, policy_id),
  CONSTRAINT l14_policy_applicability_states_revokes_fkey
    FOREIGN KEY (organisation_id, revokes_state_id, target_key, policy_id, version_id, content_hash,
                 policy_version_validated_state_id, applicability, revoked_state_kind)
    REFERENCES gov_repo.l14_policy_applicability_states (organisation_id, fact_state_id, target_key, policy_id, version_id,
                 content_hash, policy_version_validated_state_id, applicability, state_kind)
);
-- Exactly one lineage root per fact key, and one successor per state.
CREATE UNIQUE INDEX l14_policy_applicability_states_root_uidx
  ON gov_repo.l14_policy_applicability_states (organisation_id, target_key, policy_id) WHERE predecessor_state_id IS NULL;
CREATE UNIQUE INDEX l14_policy_applicability_states_successor_uidx
  ON gov_repo.l14_policy_applicability_states (organisation_id, predecessor_state_id) WHERE predecessor_state_id IS NOT NULL;
-- Bounded per-target lookups (resolver, current read).
CREATE INDEX l14_policy_applicability_states_target_idx
  ON gov_repo.l14_policy_applicability_states (organisation_id, target_key, policy_id);

-- ---------------------------------------------------------------------------------------
-- C2. Typed immutable POLICY_APPLICABILITY proposal detail over l14_proposals. Exact target union, exact policy version
--     tuple + pinned VALIDATED POLICY_VERSION state, outcome, temporal intent (requested_effective_from NULL = IMMEDIATE;
--     optional immutable requested_effective_to, VALIDATE only) and the exact REVOKE target. No JSON, no rationale.
-- ---------------------------------------------------------------------------------------
CREATE TABLE gov_repo.l14_policy_applicability_proposals (
  organisation_id uuid NOT NULL,
  proposal_id uuid NOT NULL,
  subject_kind text NOT NULL DEFAULT 'POLICY_APPLICABILITY' CHECK (subject_kind = 'POLICY_APPLICABILITY'),
  intent text NOT NULL CHECK (intent IN ('VALIDATE','REVOKE')),
  target_type text NOT NULL CHECK (target_type IN ('CANONICAL_OBJECT','RELATIONSHIP_STATE')),
  target_canonical_kind text CHECK (target_canonical_kind IN (
    'AGENT','AGENT_VERSION','MODEL','TOOL','MCP_SERVER','API','PROMPT','KNOWLEDGE_BASE','DATA_ASSET','DATA_ELEMENT','SKILL')),
  target_canonical_object_id text CHECK (pg_catalog.length(target_canonical_object_id) BETWEEN 1 AND 500
    AND target_canonical_object_id = pg_catalog.btrim(target_canonical_object_id)),
  target_relationship_id text CHECK (pg_catalog.length(target_relationship_id) BETWEEN 1 AND 500
    AND target_relationship_id = pg_catalog.btrim(target_relationship_id)),
  target_relationship_state_id text CHECK (pg_catalog.length(target_relationship_state_id) BETWEEN 1 AND 500
    AND target_relationship_state_id = pg_catalog.btrim(target_relationship_state_id)),
  target_key text NOT NULL GENERATED ALWAYS AS (gov_repo.l14_policy_applicability_target_key_v1(target_type,
    target_canonical_kind, target_canonical_object_id, target_relationship_id, target_relationship_state_id)) STORED
    CHECK (pg_catalog.length(target_key) BETWEEN 1 AND 1100),
  policy_id uuid NOT NULL,
  version_id uuid NOT NULL,
  content_hash character(64) NOT NULL CHECK (content_hash::text ~ '^[0-9a-f]{64}$'),
  policy_version_validated_state_id uuid NOT NULL,
  policy_version_state_kind text NOT NULL DEFAULT 'VALIDATED' CHECK (policy_version_state_kind = 'VALIDATED'),
  applicability text NOT NULL CHECK (applicability IN ('APPLIES','DOES_NOT_APPLY')),
  requested_effective_from timestamptz,              -- NULL = IMMEDIATE (DB transaction instant)
  requested_effective_to timestamptz,                -- NULL = open-ended; VALIDATE only; immutable
  target_state_id uuid,                              -- exact REVOKE target
  target_state_kind text GENERATED ALWAYS AS (
    CASE WHEN target_state_id IS NULL THEN NULL ELSE 'VALIDATED' END) STORED
    CHECK (target_state_kind IS NULL OR target_state_kind = 'VALIDATED'),
  CONSTRAINT l14_policy_applicability_proposals_pkey PRIMARY KEY (organisation_id, proposal_id),
  CONSTRAINT l14_policy_applicability_proposals_envelope_fkey
    FOREIGN KEY (organisation_id, proposal_id, subject_kind, intent)
    REFERENCES gov_repo.l14_proposals (organisation_id, proposal_id, subject_kind, intent),
  CONSTRAINT l14_policy_applicability_proposals_target_union_check CHECK (
    (target_type = 'CANONICAL_OBJECT' AND target_canonical_kind IS NOT NULL AND target_canonical_object_id IS NOT NULL
      AND target_relationship_id IS NULL AND target_relationship_state_id IS NULL)
    OR (target_type = 'RELATIONSHIP_STATE' AND target_canonical_kind IS NULL AND target_canonical_object_id IS NULL
      AND target_relationship_id IS NOT NULL AND target_relationship_state_id IS NOT NULL)),
  CONSTRAINT l14_policy_applicability_proposals_target_check CHECK (
    (intent = 'VALIDATE' AND target_state_id IS NULL)
    OR (intent = 'REVOKE' AND target_state_id IS NOT NULL AND requested_effective_to IS NULL)),
  CONSTRAINT l14_policy_applicability_proposals_interval_check CHECK (
    requested_effective_to IS NULL OR requested_effective_from IS NULL OR requested_effective_to > requested_effective_from),
  CONSTRAINT l14_policy_applicability_proposals_target_object_fkey
    FOREIGN KEY (organisation_id, target_canonical_object_id, target_canonical_kind)
    REFERENCES gov_repo.canonical_objects (organisation_id, canonical_object_id, kind) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT l14_policy_applicability_proposals_policy_version_fkey
    FOREIGN KEY (organisation_id, policy_version_validated_state_id, policy_id, version_id, content_hash, policy_version_state_kind)
    REFERENCES gov_repo.l14_policy_version_states (organisation_id, state_id, policy_id, version_id, content_hash, state_kind)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  -- A REVOKE pins an exact VALIDATED state of the SAME key, tuple, dependency and outcome.
  CONSTRAINT l14_policy_applicability_proposals_target_state_fkey
    FOREIGN KEY (organisation_id, target_state_id, target_key, policy_id, version_id, content_hash,
                 policy_version_validated_state_id, applicability, target_state_kind)
    REFERENCES gov_repo.l14_policy_applicability_states (organisation_id, fact_state_id, target_key, policy_id, version_id,
                 content_hash, policy_version_validated_state_id, applicability, state_kind)
);

-- ---------------------------------------------------------------------------------------
-- C3. Technical compare-and-set head per exact fact key = organisation + exact target (key) + policy_id. NEVER the
--     version id, the content hash, the pinned state or the outcome. Pointer only; never authority; reconstructible as
--     the lineage state without a successor. Created by the first state-appending decision of the key; RPC-maintained.
-- ---------------------------------------------------------------------------------------
CREATE TABLE gov_repo.l14_policy_applicability_heads (
  organisation_id uuid NOT NULL,
  target_type text NOT NULL CHECK (target_type IN ('CANONICAL_OBJECT','RELATIONSHIP_STATE')),
  target_canonical_kind text CHECK (target_canonical_kind IN (
    'AGENT','AGENT_VERSION','MODEL','TOOL','MCP_SERVER','API','PROMPT','KNOWLEDGE_BASE','DATA_ASSET','DATA_ELEMENT','SKILL')),
  target_canonical_object_id text CHECK (pg_catalog.length(target_canonical_object_id) BETWEEN 1 AND 500
    AND target_canonical_object_id = pg_catalog.btrim(target_canonical_object_id)),
  target_relationship_id text CHECK (pg_catalog.length(target_relationship_id) BETWEEN 1 AND 500
    AND target_relationship_id = pg_catalog.btrim(target_relationship_id)),
  target_relationship_state_id text CHECK (pg_catalog.length(target_relationship_state_id) BETWEEN 1 AND 500
    AND target_relationship_state_id = pg_catalog.btrim(target_relationship_state_id)),
  target_key text NOT NULL GENERATED ALWAYS AS (gov_repo.l14_policy_applicability_target_key_v1(target_type,
    target_canonical_kind, target_canonical_object_id, target_relationship_id, target_relationship_state_id)) STORED
    CHECK (pg_catalog.length(target_key) BETWEEN 1 AND 1100),
  policy_id uuid NOT NULL,
  latest_state_id uuid,
  CONSTRAINT l14_policy_applicability_heads_pkey PRIMARY KEY (organisation_id, target_key, policy_id),
  CONSTRAINT l14_policy_applicability_heads_target_union_check CHECK (
    (target_type = 'CANONICAL_OBJECT' AND target_canonical_kind IS NOT NULL AND target_canonical_object_id IS NOT NULL
      AND target_relationship_id IS NULL AND target_relationship_state_id IS NULL)
    OR (target_type = 'RELATIONSHIP_STATE' AND target_canonical_kind IS NULL AND target_canonical_object_id IS NULL
      AND target_relationship_id IS NOT NULL AND target_relationship_state_id IS NOT NULL)),
  CONSTRAINT l14_policy_applicability_heads_target_object_fkey
    FOREIGN KEY (organisation_id, target_canonical_object_id, target_canonical_kind)
    REFERENCES gov_repo.canonical_objects (organisation_id, canonical_object_id, kind) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT l14_policy_applicability_heads_policy_fkey
    FOREIGN KEY (organisation_id, policy_id)
    REFERENCES gov_repo.l14_policy_admissions (organisation_id, policy_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT l14_policy_applicability_heads_state_fkey
    FOREIGN KEY (organisation_id, latest_state_id, target_key, policy_id)
    REFERENCES gov_repo.l14_policy_applicability_states (organisation_id, fact_state_id, target_key, policy_id)
);

-- ---------------------------------------------------------------------------------------
-- D. Immutability + structural guards (raising, ENABLE ALWAYS, owner-only SECURITY INVOKER).
-- ---------------------------------------------------------------------------------------
DO $triggers$
DECLARE
  v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY['l14_policy_applicability_states','l14_policy_applicability_proposals'] LOOP
    EXECUTE pg_catalog.format(
      'CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON gov_repo.%I FOR EACH ROW EXECUTE FUNCTION gov_repo.l14_history_immutable_v1()',
      v_table || '_immutable', v_table);
    EXECUTE pg_catalog.format(
      'CREATE TRIGGER %I BEFORE TRUNCATE ON gov_repo.%I FOR EACH STATEMENT EXECUTE FUNCTION gov_repo.l14_history_immutable_v1()',
      v_table || '_no_truncate', v_table);
    EXECUTE pg_catalog.format('ALTER TABLE gov_repo.%I ENABLE ALWAYS TRIGGER %I', v_table, v_table || '_immutable');
    EXECUTE pg_catalog.format('ALTER TABLE gov_repo.%I ENABLE ALWAYS TRIGGER %I', v_table, v_table || '_no_truncate');
  END LOOP;
END;
$triggers$;

-- E1 (needed by the guards). Exact relationship-state target resolution: the ONLY S1C.3 routine that reads the F2 table,
--     read-only, by the exact organisation + relationship_id + relationship_state_id triple. Returns the match count and,
--     only when it is exactly one, the DB-resolved relationship type (authorization scope input only, never identity).
--     0 = unresolved; > 1 = ambiguous (callers fail closed). Never a bare state id, the latest / current state, a
--     successor, an endpoint or a type-based inference.
CREATE FUNCTION gov_repo.l14_resolve_relationship_state_target_v1(
  p_organisation_id uuid, p_relationship_id text, p_relationship_state_id text)
RETURNS TABLE (match_count bigint, relationship_type text)
LANGUAGE sql
STABLE
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT pg_catalog.count(*),
         CASE WHEN pg_catalog.count(*) = 1 THEN pg_catalog.min(cr.relationship_type) END
  FROM gov_repo.canonical_relationships AS cr
  WHERE cr.organisation_id = p_organisation_id AND cr.relationship_id = p_relationship_id
    AND cr.relationship_state_id = p_relationship_state_id
$$;

-- A proposal is LOCAL_HUMAN in this slice: SYSTEM_SEED / SOURCE_CONNECTION (mapping rows, legacy flags, scanner matches,
-- LLM analysis) have no trusted intake primitive here and can never masquerade as LOCAL_HUMAN.
CREATE FUNCTION gov_repo.l14_policy_applicability_proposal_guard_v1()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, pg_temp
AS $guard$
DECLARE
  v_envelope_source text;
BEGIN
  SELECT p.source_class INTO v_envelope_source
  FROM gov_repo.l14_proposals AS p
  WHERE p.organisation_id = NEW.organisation_id AND p.proposal_id = NEW.proposal_id
    AND p.subject_kind = 'POLICY_APPLICABILITY';
  IF v_envelope_source IS DISTINCT FROM 'LOCAL_HUMAN' THEN
    RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'POLICY_APPLICABILITY_PROPOSAL_SOURCE_INVALID';
  END IF;
  RETURN NEW;
END;
$guard$;
CREATE TRIGGER l14_policy_applicability_proposals_guard BEFORE INSERT ON gov_repo.l14_policy_applicability_proposals
  FOR EACH ROW EXECUTE FUNCTION gov_repo.l14_policy_applicability_proposal_guard_v1();
ALTER TABLE gov_repo.l14_policy_applicability_proposals ENABLE ALWAYS TRIGGER l14_policy_applicability_proposals_guard;

-- A state detail must mirror its envelope exactly (kind, lineage, LOCAL_HUMAN source), belong to the proposal the
-- envelope's governance decision decided (target, policy tuple, dependency, outcome, intent, REVOKE target, explicit end),
-- carry the exact target its authorization evaluated (object: kind + id; relationship state: id + state id + the
-- DB-resolved type of exactly one resolved row), respect the per-key interval lineage and, when VALIDATED, pin exactly the
-- POLICY_VERSION state the S1B.4 resolver returns at the state's OWN coordinates (defence in depth: the RPC checks the
-- same rules first, under the same guards, with the same closed errors).
CREATE FUNCTION gov_repo.l14_policy_applicability_state_guard_v1()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, pg_temp
AS $guard$
DECLARE
  v_envelope record;
  v_proposal record;
  v_authz record;
  v_predecessor record;
  v_rel record;
BEGIN
  SELECT s.state_kind, s.predecessor_state_id, s.revokes_state_id, s.effective_from, s.effective_to, s.recorded_at,
         s.governance_decision_id, s.authorization_decision_id, s.source_class
  INTO v_envelope
  FROM gov_repo.l14_fact_states AS s
  WHERE s.organisation_id = NEW.organisation_id AND s.fact_state_id = NEW.fact_state_id
    AND s.subject_kind = 'POLICY_APPLICABILITY';
  IF NOT FOUND OR v_envelope.state_kind IS DISTINCT FROM NEW.state_kind
     OR v_envelope.predecessor_state_id IS DISTINCT FROM NEW.predecessor_state_id
     OR v_envelope.revokes_state_id IS DISTINCT FROM NEW.revokes_state_id
     OR v_envelope.source_class IS DISTINCT FROM 'LOCAL_HUMAN' THEN
    RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'POLICY_APPLICABILITY_STATE_ENVELOPE_MISMATCH';
  END IF;
  SELECT p.source_class, t.intent, t.target_type, t.target_canonical_kind, t.target_canonical_object_id,
         t.target_relationship_id, t.target_relationship_state_id, t.policy_id, t.version_id, t.content_hash,
         t.policy_version_validated_state_id, t.applicability, t.requested_effective_to, t.target_state_id
  INTO v_proposal
  FROM gov_repo.l14_governance_decisions AS d
  JOIN gov_repo.l14_proposals AS p ON p.organisation_id = d.organisation_id AND p.proposal_id = d.proposal_id
  JOIN gov_repo.l14_policy_applicability_proposals AS t
    ON t.organisation_id = d.organisation_id AND t.proposal_id = d.proposal_id
  WHERE d.organisation_id = NEW.organisation_id AND d.governance_decision_id = v_envelope.governance_decision_id;
  IF NOT FOUND OR v_proposal.source_class IS DISTINCT FROM v_envelope.source_class
     OR v_proposal.target_type IS DISTINCT FROM NEW.target_type
     OR v_proposal.target_canonical_kind IS DISTINCT FROM NEW.target_canonical_kind
     OR v_proposal.target_canonical_object_id IS DISTINCT FROM NEW.target_canonical_object_id
     OR v_proposal.target_relationship_id IS DISTINCT FROM NEW.target_relationship_id
     OR v_proposal.target_relationship_state_id IS DISTINCT FROM NEW.target_relationship_state_id
     OR v_proposal.policy_id IS DISTINCT FROM NEW.policy_id
     OR v_proposal.version_id IS DISTINCT FROM NEW.version_id
     OR v_proposal.content_hash IS DISTINCT FROM NEW.content_hash
     OR v_proposal.policy_version_validated_state_id IS DISTINCT FROM NEW.policy_version_validated_state_id
     OR v_proposal.applicability IS DISTINCT FROM NEW.applicability
     OR v_proposal.intent IS DISTINCT FROM (CASE NEW.state_kind WHEN 'VALIDATED' THEN 'VALIDATE' ELSE 'REVOKE' END)
     OR v_proposal.target_state_id IS DISTINCT FROM NEW.revokes_state_id
     OR v_envelope.effective_to IS DISTINCT FROM (CASE WHEN NEW.state_kind = 'VALIDATED' THEN v_proposal.requested_effective_to END) THEN
    RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'POLICY_APPLICABILITY_STATE_PROPOSAL_MISMATCH';
  END IF;
  SELECT a.scope_tag, a.target_canonical_kind, a.target_canonical_object_id, a.target_relationship_type,
         a.target_relationship_id, a.target_relationship_state_id, a.source_class
  INTO v_authz
  FROM gov_repo.l14_authorization_decisions AS a
  WHERE a.organisation_id = NEW.organisation_id AND a.authorization_decision_id = v_envelope.authorization_decision_id;
  IF NOT FOUND OR v_authz.source_class IS DISTINCT FROM v_envelope.source_class
     OR v_authz.scope_tag IS DISTINCT FROM NEW.target_type
     OR v_authz.target_canonical_kind IS DISTINCT FROM NEW.target_canonical_kind
     OR v_authz.target_canonical_object_id IS DISTINCT FROM NEW.target_canonical_object_id
     OR v_authz.target_relationship_id IS DISTINCT FROM NEW.target_relationship_id
     OR v_authz.target_relationship_state_id IS DISTINCT FROM NEW.target_relationship_state_id THEN
    RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'POLICY_APPLICABILITY_STATE_AUTHORIZATION_TARGET_MISMATCH';
  END IF;
  IF NEW.target_type = 'RELATIONSHIP_STATE' THEN
    SELECT r.match_count, r.relationship_type INTO v_rel
    FROM gov_repo.l14_resolve_relationship_state_target_v1(NEW.organisation_id, NEW.target_relationship_id,
      NEW.target_relationship_state_id) AS r;
    IF v_rel.match_count = 0 THEN
      RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'TARGET_RELATIONSHIP_STATE_UNRESOLVED';
    END IF;
    IF v_rel.match_count <> 1 THEN
      RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'TARGET_RELATIONSHIP_STATE_AMBIGUOUS';
    END IF;
    IF v_authz.target_relationship_type IS DISTINCT FROM v_rel.relationship_type THEN
      RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'POLICY_APPLICABILITY_STATE_AUTHORIZATION_TARGET_MISMATCH';
    END IF;
  END IF;
  IF NEW.predecessor_state_id IS NOT NULL THEN
    SELECT s.state_kind, s.effective_from, s.effective_to INTO v_predecessor
    FROM gov_repo.l14_fact_states AS s
    WHERE s.organisation_id = NEW.organisation_id AND s.fact_state_id = NEW.predecessor_state_id;
    IF NEW.state_kind = 'REVOKED' THEN
      IF v_envelope.effective_from < v_predecessor.effective_from THEN
        RAISE EXCEPTION 'L14_CONTINUITY_VIOLATION' USING ERRCODE = 'GV011', DETAIL = 'REVOKE_BEFORE_TARGET_EFFECTIVE';
      END IF;
      IF v_predecessor.effective_to IS NOT NULL AND v_envelope.effective_from >= v_predecessor.effective_to THEN
        RAISE EXCEPTION 'L14_CONTINUITY_VIOLATION' USING ERRCODE = 'GV011', DETAIL = 'REVOKE_AFTER_TARGET_EXPIRY';
      END IF;
    ELSIF v_predecessor.state_kind = 'REVOKED' THEN
      IF NOT (v_envelope.effective_from >= v_predecessor.effective_from) THEN
        RAISE EXCEPTION 'L14_CONTINUITY_VIOLATION' USING ERRCODE = 'GV011', DETAIL = 'REVALIDATION_OVERLAPS_PRIOR_INTERVAL';
      END IF;
    ELSE
      IF v_envelope.effective_from < v_predecessor.effective_from THEN
        RAISE EXCEPTION 'L14_CONTINUITY_VIOLATION' USING ERRCODE = 'GV011', DETAIL = 'SUCCESSOR_BEFORE_PREDECESSOR_EFFECTIVE';
      END IF;
      IF v_predecessor.effective_to IS NOT NULL AND v_envelope.effective_from < v_predecessor.effective_to THEN
        RAISE EXCEPTION 'L14_CONTINUITY_VIOLATION' USING ERRCODE = 'GV011', DETAIL = 'SUCCESSOR_BEFORE_PREDECESSOR_END';
      END IF;
    END IF;
  END IF;
  IF NEW.state_kind = 'VALIDATED' AND NOT EXISTS (
       SELECT 1 FROM gov_repo.l14_policy_version_valid_state_v1(NEW.organisation_id, NEW.policy_id, NEW.version_id,
         NEW.content_hash::text, v_envelope.effective_from, v_envelope.recorded_at) AS pv
       WHERE pv.state_id = NEW.policy_version_validated_state_id) THEN
    RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'POLICY_VERSION_DEPENDENCY_NOT_VALID';
  END IF;
  RETURN NEW;
END;
$guard$;
CREATE TRIGGER l14_policy_applicability_states_guard BEFORE INSERT ON gov_repo.l14_policy_applicability_states
  FOR EACH ROW EXECUTE FUNCTION gov_repo.l14_policy_applicability_state_guard_v1();
ALTER TABLE gov_repo.l14_policy_applicability_states ENABLE ALWAYS TRIGGER l14_policy_applicability_states_guard;

-- The head is the only mutable S1C.3 table: created with no state, key fixed, never deleted/truncated, and only ever
-- advanced to the direct lineage successor of its current state.
CREATE FUNCTION gov_repo.l14_policy_applicability_head_guard_v1()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, pg_temp
AS $head$
BEGIN
  IF TG_OP IN ('DELETE', 'TRUNCATE') THEN
    RAISE EXCEPTION 'L14_HISTORY_IMMUTABLE' USING ERRCODE = '55000', DETAIL = 'l14_policy_applicability_heads:' || TG_OP;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.latest_state_id IS NOT NULL THEN
      RAISE EXCEPTION 'L14_HISTORY_IMMUTABLE' USING ERRCODE = '55000', DETAIL = 'l14_policy_applicability_heads:INSERT_WITH_STATE';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.organisation_id IS DISTINCT FROM OLD.organisation_id OR NEW.target_type IS DISTINCT FROM OLD.target_type
     OR NEW.target_canonical_kind IS DISTINCT FROM OLD.target_canonical_kind
     OR NEW.target_canonical_object_id IS DISTINCT FROM OLD.target_canonical_object_id
     OR NEW.target_relationship_id IS DISTINCT FROM OLD.target_relationship_id
     OR NEW.target_relationship_state_id IS DISTINCT FROM OLD.target_relationship_state_id
     OR NEW.policy_id IS DISTINCT FROM OLD.policy_id
     OR (OLD.latest_state_id IS NOT NULL AND NEW.latest_state_id IS NULL) THEN
    RAISE EXCEPTION 'L14_HISTORY_IMMUTABLE' USING ERRCODE = '55000', DETAIL = 'l14_policy_applicability_heads:IDENTITY';
  END IF;
  IF NEW.latest_state_id IS DISTINCT FROM OLD.latest_state_id AND NOT EXISTS (
       SELECT 1 FROM gov_repo.l14_policy_applicability_states AS s
       WHERE s.organisation_id = NEW.organisation_id AND s.fact_state_id = NEW.latest_state_id
         AND s.target_key = OLD.target_key AND s.policy_id = OLD.policy_id
         AND s.predecessor_state_id IS NOT DISTINCT FROM OLD.latest_state_id) THEN
    RAISE EXCEPTION 'L14_HISTORY_IMMUTABLE' USING ERRCODE = '55000', DETAIL = 'l14_policy_applicability_heads:LINEAGE';
  END IF;
  RETURN NEW;
END;
$head$;
CREATE TRIGGER l14_policy_applicability_heads_guard BEFORE INSERT OR UPDATE OR DELETE ON gov_repo.l14_policy_applicability_heads
  FOR EACH ROW EXECUTE FUNCTION gov_repo.l14_policy_applicability_head_guard_v1();
CREATE TRIGGER l14_policy_applicability_heads_no_truncate BEFORE TRUNCATE ON gov_repo.l14_policy_applicability_heads
  FOR EACH STATEMENT EXECUTE FUNCTION gov_repo.l14_policy_applicability_head_guard_v1();
ALTER TABLE gov_repo.l14_policy_applicability_heads ENABLE ALWAYS TRIGGER l14_policy_applicability_heads_guard;
ALTER TABLE gov_repo.l14_policy_applicability_heads ENABLE ALWAYS TRIGGER l14_policy_applicability_heads_no_truncate;

-- ---------------------------------------------------------------------------------------
-- E. Owner-only helpers.
-- ---------------------------------------------------------------------------------------

-- SHARED mode of the EXACT S1B.4 registry subject guard key of one governed POLICY_VERSION tuple:
-- frame_identity([organisation, 'l14-registry-subject-guard-v1', 'POLICY_VERSION',
--   'POLICY_VERSION_VALIDATION:' || policy_id || ':' || version_id || ':' || content_hash]) — byte-identical to the key
-- gov_repo.l14_lock_registry_subject_guard_v1 receives from the S1B.4 SUBMIT / DECIDE RPCs (which take it EXCLUSIVELY). No
-- new lock namespace. An applicability VALIDATE pinning that tuple therefore serializes deterministically with every
-- POLICY_VERSION decision on it (a revocation committed first is seen; a revocation waiting behind the applicability
-- commits after it and invalidates it through the resolver), while applicabilities pinning the same tuple never serialize
-- on each other. Transaction-scoped: held to commit.
CREATE FUNCTION gov_repo.l14_lock_policy_version_dependency_guard_shared_v1(
  p_organisation_id uuid, p_policy_id uuid, p_version_id uuid, p_content_hash text)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SET search_path = pg_catalog, pg_temp
AS $guard$
BEGIN
  IF p_organisation_id IS NULL OR p_policy_id IS NULL OR p_version_id IS NULL OR p_content_hash IS NULL
     OR p_content_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'GUARD_KEY_INVALID';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock_shared(pg_catalog.hashtextextended(
    gov_repo.frame_identity(ARRAY[p_organisation_id::text, 'l14-registry-subject-guard-v1', 'POLICY_VERSION',
      'POLICY_VERSION_VALIDATION:' || p_policy_id::text || ':' || p_version_id::text || ':' || p_content_hash]), 0));
END;
$guard$;

-- Closed rule evaluator over ONE basis version for an exact RELATIONSHIP_STATE request target (ADR §6). Identical to the
-- S1C.1 object evaluator (which stays unchanged and still serves CANONICAL_OBJECT targets) except the scope step: a rule
-- matches iff it is ALL_ALLOWED_TARGETS, RELATIONSHIP_TYPE of the DB-resolved type of the exact state, or
-- RELATIONSHIP_STATE of the exact relationship_id + relationship_state_id (organisation = the rule's own). CANONICAL_KIND /
-- CANONICAL_OBJECT rules never match a relationship-state target (and RELATIONSHIP_* rules never match an object target in
-- the S1C.1 evaluator). Authorization scope only: never fact inheritance.
CREATE FUNCTION gov_repo.l14_evaluate_relationship_state_authority_rules_v1(
  p_organisation_id uuid, p_authority_policy_id uuid, p_version_id uuid, p_role_ids uuid[],
  p_permission text, p_requested_action text, p_self_validation boolean, p_temporal text,
  p_relationship_type text, p_relationship_id text, p_relationship_state_id text)
RETURNS TABLE (deny_reason text, rule_ordinals integer[])
LANGUAGE plpgsql
STABLE
SET search_path = pg_catalog, pg_temp
AS $evaluate$
#variable_conflict use_column
DECLARE
  v_candidates integer[];
  v_source integer[];
  v_scope integer[];
  v_self integer[];
  v_temporal integer[];
BEGIN
  IF p_temporal IS NULL OR p_temporal NOT IN ('IMMEDIATE','BACKDATED','FUTURE_DATED') THEN
    RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'TEMPORAL_CLASS_INVALID';
  END IF;
  IF p_relationship_type IS NULL OR p_relationship_id IS NULL OR p_relationship_state_id IS NULL THEN
    RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'REQUEST_TARGET_MISSING';
  END IF;
  SELECT pg_catalog.array_agg(r.rule_ordinal ORDER BY r.rule_ordinal) INTO v_candidates
  FROM gov_repo.l14_authority_policy_rules AS r
  WHERE r.organisation_id = p_organisation_id AND r.authority_policy_id = p_authority_policy_id
    AND r.version_id = p_version_id AND r.role_id = ANY (p_role_ids)
    AND r.permission = p_permission AND r.requested_action = p_requested_action;
  IF v_candidates IS NULL THEN
    RETURN QUERY SELECT 'NO_MATCHING_AUTHORITY_RULE'::text, ARRAY[]::integer[];
    RETURN;
  END IF;
  -- Contradictory exact rule keys (both AUTHORITATIVE and NON_AUTHORITATIVE) fail closed; never resolved by row order.
  IF EXISTS (
    SELECT 1
    FROM gov_repo.l14_authority_policy_rules AS a
    JOIN gov_repo.l14_authority_policy_rules AS b
      ON b.organisation_id = a.organisation_id AND b.authority_policy_id = a.authority_policy_id
     AND b.version_id = a.version_id AND b.role_id = a.role_id AND b.permission = a.permission
     AND b.requested_action = a.requested_action AND b.source_class = a.source_class AND b.scope_tag = a.scope_tag
     AND b.scope_canonical_kind IS NOT DISTINCT FROM a.scope_canonical_kind
     AND b.scope_canonical_object_id IS NOT DISTINCT FROM a.scope_canonical_object_id
     AND b.scope_relationship_type IS NOT DISTINCT FROM a.scope_relationship_type
     AND b.scope_relationship_id IS NOT DISTINCT FROM a.scope_relationship_id
     AND b.scope_relationship_state_id IS NOT DISTINCT FROM a.scope_relationship_state_id
    WHERE a.organisation_id = p_organisation_id AND a.authority_policy_id = p_authority_policy_id
      AND a.version_id = p_version_id AND a.rule_ordinal = ANY (v_candidates) AND b.rule_ordinal = ANY (v_candidates)
      AND a.source_class = 'LOCAL_HUMAN' AND a.source_disposition = 'AUTHORITATIVE'
      AND b.source_disposition = 'NON_AUTHORITATIVE') THEN
    RETURN QUERY SELECT 'SOURCE_NOT_AUTHORIZED'::text, v_candidates;
    RETURN;
  END IF;
  -- Only an AUTHORITATIVE LOCAL_HUMAN rule can authorize (CONTRIBUTING / NON_AUTHORITATIVE never do).
  SELECT pg_catalog.array_agg(r.rule_ordinal ORDER BY r.rule_ordinal) INTO v_source
  FROM gov_repo.l14_authority_policy_rules AS r
  WHERE r.organisation_id = p_organisation_id AND r.authority_policy_id = p_authority_policy_id
    AND r.version_id = p_version_id AND r.rule_ordinal = ANY (v_candidates)
    AND r.source_class = 'LOCAL_HUMAN' AND r.source_disposition = 'AUTHORITATIVE';
  IF v_source IS NULL THEN
    RETURN QUERY SELECT 'SOURCE_NOT_AUTHORIZED'::text, v_candidates;
    RETURN;
  END IF;
  -- Exact typed relationship-state scope (the rule's own operands in the rule's own organisation).
  SELECT pg_catalog.array_agg(r.rule_ordinal ORDER BY r.rule_ordinal) INTO v_scope
  FROM gov_repo.l14_authority_policy_rules AS r
  WHERE r.organisation_id = p_organisation_id AND r.authority_policy_id = p_authority_policy_id
    AND r.version_id = p_version_id AND r.rule_ordinal = ANY (v_source)
    AND (r.scope_tag = 'ALL_ALLOWED_TARGETS'
         OR (r.scope_tag = 'RELATIONSHIP_TYPE' AND r.scope_relationship_type = p_relationship_type)
         OR (r.scope_tag = 'RELATIONSHIP_STATE' AND r.scope_relationship_id = p_relationship_id
             AND r.scope_relationship_state_id = p_relationship_state_id));
  IF v_scope IS NULL THEN
    RETURN QUERY SELECT 'SCOPE_NOT_AUTHORIZED'::text, v_source;
    RETURN;
  END IF;
  IF p_self_validation THEN
    SELECT pg_catalog.array_agg(r.rule_ordinal ORDER BY r.rule_ordinal) INTO v_self
    FROM gov_repo.l14_authority_policy_rules AS r
    WHERE r.organisation_id = p_organisation_id AND r.authority_policy_id = p_authority_policy_id
      AND r.version_id = p_version_id AND r.rule_ordinal = ANY (v_scope) AND r.allow_self_validation;
    IF v_self IS NULL THEN
      RETURN QUERY SELECT 'SELF_VALIDATION_NOT_PERMITTED'::text, v_scope;
      RETURN;
    END IF;
  ELSE
    v_self := v_scope;
  END IF;
  -- A dating grant must sit on a rule that already authorizes everything else about the command.
  IF p_temporal = 'IMMEDIATE' THEN
    v_temporal := v_self;
  ELSE
    SELECT pg_catalog.array_agg(r.rule_ordinal ORDER BY r.rule_ordinal) INTO v_temporal
    FROM gov_repo.l14_authority_policy_rules AS r
    WHERE r.organisation_id = p_organisation_id AND r.authority_policy_id = p_authority_policy_id
      AND r.version_id = p_version_id AND r.rule_ordinal = ANY (v_self)
      AND ((p_temporal = 'BACKDATED' AND r.allow_backdating) OR (p_temporal = 'FUTURE_DATED' AND r.allow_future_dating));
    IF v_temporal IS NULL THEN
      RETURN QUERY SELECT 'TEMPORAL_ACTION_NOT_AUTHORIZED'::text, v_self;
      RETURN;
    END IF;
  END IF;
  RETURN QUERY SELECT NULL::text, v_temporal;
END;
$evaluate$;

-- The ORIGINAL durable POLICY_APPLICABILITY result, exactly as stored (replay never recomputes it). SUBMIT / DECIDE
-- project the exact target + policy tuple + dependency + outcome their immutable typed proposal pins; VALIDATED / REVOKED
-- project the fact state (including its lineage predecessor, so a supersession is visible in the durable result).
CREATE FUNCTION gov_repo.l14_policy_applicability_command_result_v1(p_organisation_id uuid, p_command_id text, p_replay boolean)
RETURNS TABLE (
  replay boolean, command_id text, command_kind text, subject_kind text, outcome text, command_fingerprint text,
  authorization_decision_id uuid, authorization_result text, deny_reason text, expectation_kind text,
  expected_current_state_id uuid, proposal_id uuid, governance_decision_id uuid, target_type text,
  target_canonical_kind text, target_canonical_object_id text, target_relationship_id text, target_relationship_state_id text,
  policy_id uuid, version_id uuid, content_hash text, policy_version_validated_state_id uuid, applicability text,
  fact_state_id uuid, state_kind text, predecessor_state_id uuid, effective_from timestamptz, effective_to timestamptz,
  recorded_at timestamptz
)
LANGUAGE sql
STABLE
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT p_replay, c.command_id, c.command_kind, c.subject_kind, c.outcome, c.command_fingerprint,
         c.authorization_decision_id, a.result, a.deny_reason, a.expectation_kind, a.expected_current_state_id,
         c.proposal_id, c.governance_decision_id, t.target_type, t.target_canonical_kind, t.target_canonical_object_id,
         t.target_relationship_id, t.target_relationship_state_id, t.policy_id, t.version_id, t.content_hash::text,
         t.policy_version_validated_state_id, t.applicability, c.fact_state_id, s.state_kind, s.predecessor_state_id,
         s.effective_from, s.effective_to, c.recorded_at
  FROM gov_repo.l14_command_results AS c
  LEFT JOIN gov_repo.l14_authorization_decisions AS a
    ON a.organisation_id = c.organisation_id AND a.authorization_decision_id = c.authorization_decision_id
  LEFT JOIN gov_repo.l14_policy_applicability_proposals AS t
    ON t.organisation_id = c.organisation_id AND t.proposal_id = c.proposal_id
  LEFT JOIN gov_repo.l14_fact_states AS s
    ON s.organisation_id = c.organisation_id AND s.fact_state_id = c.fact_state_id
  WHERE c.organisation_id = p_organisation_id AND c.command_id = p_command_id AND c.subject_kind = 'POLICY_APPLICABILITY'
    AND c.command_kind IN ('SUBMIT_PROPOSAL','DECIDE_PROPOSAL')
$$;

-- Exact bitemporal resolver (ADR §17-§18.1, O29, O49). The exact VALIDATED applicability of the exact fact key (exact
-- target + policy_id; NEVER the version) valid at business instant p_effective_at as known at system cutoff
-- p_recorded_cutoff, returned ONLY when ALL hold at the SAME pair of coordinates:
--   * own state: recorded_at <= cutoff, effective_from <= instant, instant < explicit effective_to (if any), and no
--     VISIBLE lineage successor (superseding VALIDATED state or the exact REVOKED tombstone, recorded <= cutoff) with
--     effective_from <= instant — closure is DERIVED from that visible successor, never stored, so a later-recorded
--     successor never leaks into an earlier cutoff and a future successor never hides the current state; exactly one
--     candidate (ambiguity fails closed);
--   * target: the exact object still resolves (organisation + id + kind), or the exact relationship-state triple resolves
--     to exactly one row (never a rollup to the relationship id, a roll-forward to another state, an endpoint or a type);
--   * dependency: its pinned VALIDATED POLICY_VERSION state is EXACTLY the state gov_repo.l14_policy_version_valid_state_v1
--     returns for the same policy + version + content hash at the same instant and cutoff (a revoked dependency is never
--     auto-replaced by a re-validation state, another version, another hash, current_version_id or any inference).
-- No row otherwise = UNKNOWN (never DOES_NOT_APPLY). A VALIDATED DOES_NOT_APPLY is a positive governed row.
CREATE FUNCTION gov_repo.l14_policy_applicability_valid_state_v1(
  p_organisation_id uuid, p_target_type text, p_target_canonical_kind text, p_target_canonical_object_id text,
  p_target_relationship_id text, p_target_relationship_state_id text, p_policy_id uuid,
  p_effective_at timestamptz, p_recorded_cutoff timestamptz)
RETURNS TABLE (fact_state_id uuid, policy_id uuid, version_id uuid, content_hash text, policy_version_validated_state_id uuid,
               applicability text, effective_from timestamptz, effective_to timestamptz, recorded_at timestamptz)
LANGUAGE sql
STABLE
SET search_path = pg_catalog, pg_temp
AS $$
  WITH target AS (
    SELECT gov_repo.l14_policy_applicability_target_key_v1(p_target_type, p_target_canonical_kind,
             p_target_canonical_object_id, p_target_relationship_id, p_target_relationship_state_id) AS target_key
  ), visible AS (
    SELECT s.fact_state_id, s.state_kind, s.predecessor_state_id, s.effective_from, s.effective_to, s.recorded_at,
           d.policy_id, d.version_id, d.content_hash, d.policy_version_validated_state_id, d.applicability
    FROM gov_repo.l14_fact_states AS s
    JOIN gov_repo.l14_policy_applicability_states AS d
      ON d.organisation_id = s.organisation_id AND d.fact_state_id = s.fact_state_id AND d.state_kind = s.state_kind
    CROSS JOIN target AS k
    WHERE s.organisation_id = p_organisation_id AND s.subject_kind = 'POLICY_APPLICABILITY'
      AND d.target_key = k.target_key AND d.policy_id = p_policy_id
      AND s.recorded_at <= p_recorded_cutoff
  ), candidates AS (
    SELECT v.* FROM visible AS v
    WHERE v.state_kind = 'VALIDATED' AND v.effective_from <= p_effective_at
      AND (v.effective_to IS NULL OR p_effective_at < v.effective_to)
      AND NOT EXISTS (SELECT 1 FROM visible AS n
                      WHERE n.predecessor_state_id = v.fact_state_id AND n.effective_from <= p_effective_at)
  )
  SELECT c.fact_state_id, c.policy_id, c.version_id, c.content_hash::text, c.policy_version_validated_state_id,
         c.applicability, c.effective_from, c.effective_to, c.recorded_at
  FROM candidates AS c
  WHERE (SELECT pg_catalog.count(*) FROM candidates) = 1
    AND ((p_target_type = 'CANONICAL_OBJECT'
          AND EXISTS (SELECT 1 FROM gov_repo.canonical_objects AS o
                      WHERE o.organisation_id = p_organisation_id AND o.canonical_object_id = p_target_canonical_object_id
                        AND o.kind = p_target_canonical_kind))
      OR (p_target_type = 'RELATIONSHIP_STATE'
          AND EXISTS (SELECT 1 FROM gov_repo.l14_resolve_relationship_state_target_v1(p_organisation_id,
                        p_target_relationship_id, p_target_relationship_state_id) AS r
                      WHERE r.match_count = 1)))
    AND EXISTS (SELECT 1 FROM gov_repo.l14_policy_version_valid_state_v1(p_organisation_id, c.policy_id, c.version_id,
                  c.content_hash::text, p_effective_at, p_recorded_cutoff) AS pv
                WHERE pv.state_id = c.policy_version_validated_state_id)
$$;

-- Bounded current-applicability read of ONE exact target (the dependency primitive future control applicability /
-- projections consume): every policy of the exact target known at the cutoff for which the exact resolver returns a row
-- at the same coordinates. At most one row per policy. A policy with no row is UNKNOWN (never DOES_NOT_APPLY; a VALIDATED
-- DOES_NOT_APPLY is returned as such). Nothing is rolled up / forward / inherited from or to another relationship state,
-- the relationship id, an endpoint, a parent object or a relationship type.
CREATE FUNCTION gov_repo.l14_policy_applicabilities_current_v1(
  p_organisation_id uuid, p_target_type text, p_target_canonical_kind text, p_target_canonical_object_id text,
  p_target_relationship_id text, p_target_relationship_state_id text,
  p_effective_at timestamptz, p_recorded_cutoff timestamptz)
RETURNS TABLE (policy_id uuid, version_id uuid, content_hash text, applicability text, fact_state_id uuid,
               policy_version_validated_state_id uuid, effective_from timestamptz, effective_to timestamptz,
               recorded_at timestamptz)
LANGUAGE sql
STABLE
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT v.policy_id, v.version_id, v.content_hash, v.applicability, v.fact_state_id, v.policy_version_validated_state_id,
         v.effective_from, v.effective_to, v.recorded_at
  FROM (SELECT DISTINCT d.policy_id
        FROM gov_repo.l14_policy_applicability_states AS d
        JOIN gov_repo.l14_fact_states AS s ON s.organisation_id = d.organisation_id AND s.fact_state_id = d.fact_state_id
        WHERE d.organisation_id = p_organisation_id
          AND d.target_key = gov_repo.l14_policy_applicability_target_key_v1(p_target_type, p_target_canonical_kind,
                p_target_canonical_object_id, p_target_relationship_id, p_target_relationship_state_id)
          AND s.recorded_at <= p_recorded_cutoff) AS k
  CROSS JOIN LATERAL gov_repo.l14_policy_applicability_valid_state_v1(p_organisation_id, p_target_type,
    p_target_canonical_kind, p_target_canonical_object_id, p_target_relationship_id, p_target_relationship_state_id,
    k.policy_id, p_effective_at, p_recorded_cutoff) AS v
$$;

-- ---------------------------------------------------------------------------------------
-- F1. RPC — POLICY_APPLICABILITY proposal submission (any verified ACTIVE same-tenant member; no authority, no
--     authorization, no decision, no fact, no head mutation, no admission / validation, no trust promotion). LOCAL_HUMAN.
-- ---------------------------------------------------------------------------------------
CREATE FUNCTION gov_repo.l14_submit_policy_applicability_proposal_v1(
  p_verified_organisation_id uuid,
  p_verified_actor_user_id uuid,
  p_verified_session_iat bigint,
  p_verified_session_exp bigint,
  p_verified_credential_epoch timestamptz,
  p_command_id text,
  p_intent text,                                -- VALIDATE | REVOKE
  p_source_class text,                          -- LOCAL_HUMAN only in this slice
  p_target_type text,                           -- CANONICAL_OBJECT | RELATIONSHIP_STATE (closed union)
  p_target_canonical_kind text,                 -- CANONICAL_OBJECT only: one of the 11 kinds
  p_target_canonical_object_id text,            -- CANONICAL_OBJECT only: exact canonical object id
  p_target_relationship_id text,                -- RELATIONSHIP_STATE only: exact relationship id
  p_target_relationship_state_id text,          -- RELATIONSHIP_STATE only: exact relationship state id
  p_policy_id uuid,                             -- the S1B.3-admitted policy identity
  p_version_id uuid,                            -- the exact S1B.3-admitted immutable version
  p_content_hash text,                          -- that version's DB-verified content hash (resolved, never trusted)
  p_policy_version_validated_state_id uuid,     -- the exact pinned S1B.4 VALIDATED state (dependency lineage only)
  p_applicability text,                         -- APPLIES | DOES_NOT_APPLY
  p_requested_effective_from timestamptz,       -- NULL = IMMEDIATE intent
  p_requested_effective_to timestamptz,         -- NULL = open-ended; VALIDATE only; immutable
  p_target_state_id uuid,                       -- REVOKE only: the exact current VALIDATED state of the same key
  p_prior_proposal_id uuid,                     -- correction link (same key)
  p_support_status text,
  p_support_evidence_ids text[],
  p_caller_fingerprint text                     -- assertion only; PostgreSQL recomputes
)
RETURNS TABLE (
  replay boolean, command_id text, command_kind text, subject_kind text, outcome text, command_fingerprint text,
  authorization_decision_id uuid, authorization_result text, deny_reason text, expectation_kind text,
  expected_current_state_id uuid, proposal_id uuid, governance_decision_id uuid, target_type text,
  target_canonical_kind text, target_canonical_object_id text, target_relationship_id text, target_relationship_state_id text,
  policy_id uuid, version_id uuid, content_hash text, policy_version_validated_state_id uuid, applicability text,
  fact_state_id uuid, state_kind text, predecessor_state_id uuid, effective_from timestamptz, effective_to timestamptz,
  recorded_at timestamptz
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
SET lock_timeout = '5s'
AS $submit_policy_applicability$
#variable_conflict use_column
DECLARE
  v_org uuid := p_verified_organisation_id;
  v_actor uuid := p_verified_actor_user_id;
  v_support text[];
  v_fingerprint text;
  v_target_key text;
  v_rel record;
  v_target record;
  v_latest uuid;
  v_proposal uuid := pg_catalog.gen_random_uuid();
  v_now timestamptz;
BEGIN
  -- 1. Any verified ACTIVE same-tenant member (no L14 permission is required to submit). Tenant + actor come ONLY
  --    from here.
  PERFORM 1 FROM gov_repo.l14_session_basis_v1(v_org, v_actor, p_verified_session_iat,
    p_verified_session_exp, p_verified_credential_epoch);

  -- 2. Syntactic shape (no table read): closed vocabularies, the closed target union, the policy tuple shape, the
  --    interval shape.
  PERFORM gov_repo.l14_validate_command_id_v1(p_command_id, p_caller_fingerprint);
  IF p_intent IS NULL OR p_intent NOT IN ('VALIDATE','REVOKE')
     OR p_source_class IS NULL OR p_source_class NOT IN ('SYSTEM_SEED','LOCAL_HUMAN','SOURCE_CONNECTION') THEN
    RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'PROPOSAL_VOCABULARY_UNKNOWN';
  END IF;
  IF p_source_class <> 'LOCAL_HUMAN' THEN
    RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'SOURCE_CLASS_NOT_EXECUTABLE';
  END IF;
  IF p_target_type IS NULL OR p_target_type NOT IN ('CANONICAL_OBJECT','RELATIONSHIP_STATE') THEN
    RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'POLICY_APPLICABILITY_TARGET_TYPE_UNKNOWN';
  END IF;
  IF p_target_type = 'CANONICAL_OBJECT' THEN
    IF p_target_relationship_id IS NOT NULL OR p_target_relationship_state_id IS NOT NULL THEN
      RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'POLICY_APPLICABILITY_TARGET_UNION_INVALID';
    END IF;
    IF p_target_canonical_kind IS NULL OR p_target_canonical_kind NOT IN (
         'AGENT','AGENT_VERSION','MODEL','TOOL','MCP_SERVER','API','PROMPT','KNOWLEDGE_BASE','DATA_ASSET','DATA_ELEMENT','SKILL') THEN
      RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'TARGET_CANONICAL_KIND_UNKNOWN';
    END IF;
    IF p_target_canonical_object_id IS NULL OR pg_catalog.length(p_target_canonical_object_id) NOT BETWEEN 1 AND 500
       OR p_target_canonical_object_id <> pg_catalog.btrim(p_target_canonical_object_id) THEN
      RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'TARGET_OBJECT_ID_MALFORMED';
    END IF;
  ELSE
    IF p_target_canonical_kind IS NOT NULL OR p_target_canonical_object_id IS NOT NULL THEN
      RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'POLICY_APPLICABILITY_TARGET_UNION_INVALID';
    END IF;
    IF p_target_relationship_id IS NULL OR pg_catalog.length(p_target_relationship_id) NOT BETWEEN 1 AND 500
       OR p_target_relationship_id <> pg_catalog.btrim(p_target_relationship_id) THEN
      RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'TARGET_RELATIONSHIP_ID_MALFORMED';
    END IF;
    IF p_target_relationship_state_id IS NULL OR pg_catalog.length(p_target_relationship_state_id) NOT BETWEEN 1 AND 500
       OR p_target_relationship_state_id <> pg_catalog.btrim(p_target_relationship_state_id) THEN
      RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'TARGET_RELATIONSHIP_STATE_ID_MALFORMED';
    END IF;
  END IF;
  IF p_policy_id IS NULL OR p_version_id IS NULL THEN
    RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'POLICY_VERSION_REQUIRED';
  END IF;
  IF p_content_hash IS NULL OR p_content_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'CONTENT_HASH_MALFORMED';
  END IF;
  IF p_policy_version_validated_state_id IS NULL THEN
    RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'POLICY_VERSION_DEPENDENCY_REQUIRED';
  END IF;
  IF p_applicability IS NULL OR p_applicability NOT IN ('APPLIES','DOES_NOT_APPLY') THEN
    RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'POLICY_APPLICABILITY_OUTCOME_UNKNOWN';
  END IF;
  IF p_intent = 'VALIDATE' AND p_target_state_id IS NOT NULL THEN
    RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'TARGET_STATE_NOT_PERMITTED';
  END IF;
  IF p_intent = 'REVOKE' AND p_target_state_id IS NULL THEN
    RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'TARGET_STATE_REQUIRED';
  END IF;
  IF p_intent = 'REVOKE' AND p_requested_effective_to IS NOT NULL THEN
    RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'EFFECTIVE_TO_NOT_PERMITTED';
  END IF;
  IF p_requested_effective_to IS NOT NULL AND p_requested_effective_from IS NOT NULL
     AND NOT (p_requested_effective_to > p_requested_effective_from) THEN
    RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'EFFECTIVE_INTERVAL_INVALID';
  END IF;
  v_target_key := gov_repo.l14_policy_applicability_target_key_v1(p_target_type, p_target_canonical_kind,
    p_target_canonical_object_id, p_target_relationship_id, p_target_relationship_state_id);

  -- 3-4. Syntactic support, then the PostgreSQL-authoritative fingerprint over the exact target, policy tuple,
  --      dependency, outcome and temporal intent.
  v_support := gov_repo.l14_support_syntactic_parts_v1(p_support_status, p_support_evidence_ids);
  v_fingerprint := gov_repo.l14_sha256_frame_v1(
    ARRAY['L14_COMMAND_FINGERPRINT_V1', 'SUBMIT_PROPOSAL', v_org::text, v_actor::text, 'POLICY_APPLICABILITY', p_intent,
          p_source_class, p_target_type]
    || CASE WHEN p_target_type = 'CANONICAL_OBJECT' THEN ARRAY[p_target_canonical_kind, p_target_canonical_object_id]
            ELSE ARRAY[p_target_relationship_id, p_target_relationship_state_id] END
    || ARRAY[p_policy_id::text, p_version_id::text, p_content_hash, p_policy_version_validated_state_id::text, p_applicability]
    || CASE WHEN p_requested_effective_from IS NULL THEN ARRAY['IMMEDIATE']
            ELSE ARRAY['EXPLICIT', gov_repo.l14_canonical_instant_v1(p_requested_effective_from)] END
    || CASE WHEN p_requested_effective_to IS NULL THEN ARRAY['NO_EFFECTIVE_TO']
            ELSE ARRAY['EFFECTIVE_TO', gov_repo.l14_canonical_instant_v1(p_requested_effective_to)] END
    || CASE WHEN p_target_state_id IS NULL THEN ARRAY['NO_TARGET_STATE']
            ELSE ARRAY['TARGET_STATE', p_target_state_id::text] END
    || CASE WHEN p_prior_proposal_id IS NULL THEN ARRAY['NO_PRIOR_PROPOSAL']
            ELSE ARRAY['PRIOR_PROPOSAL', p_prior_proposal_id::text] END
    || v_support);
  IF v_fingerprint IS DISTINCT FROM p_caller_fingerprint THEN
    RAISE EXCEPTION 'L14_FINGERPRINT_MISMATCH' USING ERRCODE = 'GV008', DETAIL = 'CALLER_FINGERPRINT_DIFFERS';
  END IF;

  -- 5-7. Guards (AP shared, exact fact key, command), then replay arbitration BEFORE any resolution.
  PERFORM gov_repo.l14_lock_authority_policy_guard_shared_v1(v_org);
  PERFORM gov_repo.l14_lock_fact_subject_guard_v1(v_org, 'POLICY_APPLICABILITY', ARRAY['KEY', v_target_key, p_policy_id::text]);
  PERFORM gov_repo.l14_lock_command_guard_v1(v_org, p_command_id);
  IF gov_repo.l14_replay_arbitrate_v1(v_org, p_command_id, v_fingerprint) THEN
    PERFORM 1 FROM gov_repo.l14_session_basis_v1(v_org, v_actor, p_verified_session_iat,
      p_verified_session_exp, p_verified_credential_epoch);
    RETURN QUERY SELECT * FROM gov_repo.l14_policy_applicability_command_result_v1(v_org, p_command_id, true);
    RETURN;
  END IF;

  -- 8. Tenant / reference / support resolution. A foreign-tenant, wrong-kind or unknown object is indistinguishable; a
  --    relationship-state target resolves by the EXACT triple to exactly one row (0 = unresolved, > 1 = ambiguous). The
  --    policy is the S1B.3-admitted identity; the version tuple must be the S1B.3 admission lineage row of THIS policy
  --    carrying THIS DB-verified content hash (a swapped / other-version / other-policy / foreign / legacy-only tuple has
  --    none); the pinned dependency is an exact VALIDATED S1B.4 state of THIS tuple in THIS organisation.
  IF p_target_type = 'CANONICAL_OBJECT' THEN
    PERFORM 1 FROM gov_repo.canonical_objects AS o
    WHERE o.organisation_id = v_org AND o.canonical_object_id = p_target_canonical_object_id AND o.kind = p_target_canonical_kind;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'TARGET_OBJECT_UNRESOLVED';
    END IF;
  ELSE
    SELECT r.match_count, r.relationship_type INTO v_rel
    FROM gov_repo.l14_resolve_relationship_state_target_v1(v_org, p_target_relationship_id, p_target_relationship_state_id) AS r;
    IF v_rel.match_count = 0 THEN
      RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'TARGET_RELATIONSHIP_STATE_UNRESOLVED';
    END IF;
    IF v_rel.match_count <> 1 THEN
      RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'TARGET_RELATIONSHIP_STATE_AMBIGUOUS';
    END IF;
  END IF;
  PERFORM 1 FROM gov_repo.l14_policy_admissions AS pa WHERE pa.organisation_id = v_org AND pa.policy_id = p_policy_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'POLICY_UNRESOLVED';
  END IF;
  PERFORM 1 FROM gov_repo.l14_policy_version_admissions AS va
  WHERE va.organisation_id = v_org AND va.policy_id = p_policy_id AND va.version_id = p_version_id
    AND va.content_hash::text = p_content_hash;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'POLICY_VERSION_UNRESOLVED';
  END IF;
  PERFORM 1 FROM gov_repo.l14_policy_version_states AS ps
  WHERE ps.organisation_id = v_org AND ps.state_id = p_policy_version_validated_state_id AND ps.policy_id = p_policy_id
    AND ps.version_id = p_version_id AND ps.content_hash::text = p_content_hash AND ps.state_kind = 'VALIDATED';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'POLICY_VERSION_DEPENDENCY_UNRESOLVED';
  END IF;
  IF p_intent = 'REVOKE' THEN
    SELECT s.state_kind, s.target_key, s.policy_id, s.version_id, s.content_hash, s.policy_version_validated_state_id,
           s.applicability
    INTO v_target
    FROM gov_repo.l14_policy_applicability_states AS s
    WHERE s.organisation_id = v_org AND s.fact_state_id = p_target_state_id;
    IF NOT FOUND OR v_target.target_key <> v_target_key OR v_target.policy_id <> p_policy_id THEN
      RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'TARGET_STATE_UNRESOLVED';
    END IF;
    IF v_target.state_kind <> 'VALIDATED' THEN
      RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'TARGET_STATE_NOT_VALIDATED';
    END IF;
    IF v_target.version_id <> p_version_id OR v_target.content_hash::text <> p_content_hash
       OR v_target.policy_version_validated_state_id <> p_policy_version_validated_state_id
       OR v_target.applicability <> p_applicability THEN
      RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'POLICY_APPLICABILITY_TARGET_STATE_MISMATCH';
    END IF;
    PERFORM 1 FROM gov_repo.l14_fact_states AS r
    WHERE r.organisation_id = v_org AND r.state_kind = 'REVOKED' AND r.revokes_state_id = p_target_state_id;
    IF FOUND THEN
      RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'TARGET_ALREADY_REVOKED';
    END IF;
    SELECT h.latest_state_id INTO v_latest
    FROM gov_repo.l14_policy_applicability_heads AS h
    WHERE h.organisation_id = v_org AND h.target_key = v_target_key AND h.policy_id = p_policy_id;
    IF v_latest IS DISTINCT FROM p_target_state_id THEN
      RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'TARGET_STATE_NOT_CURRENT';
    END IF;
  END IF;
  IF p_prior_proposal_id IS NOT NULL THEN
    PERFORM 1 FROM gov_repo.l14_policy_applicability_proposals AS rp
    WHERE rp.organisation_id = v_org AND rp.proposal_id = p_prior_proposal_id
      AND rp.target_key = v_target_key AND rp.policy_id = p_policy_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'PRIOR_PROPOSAL_UNRESOLVED';
    END IF;
  END IF;
  PERFORM gov_repo.l14_resolve_support_v1(v_org, p_support_evidence_ids);

  -- 9. Envelope + typed detail + support + durable result. Nothing else.
  v_now := pg_catalog.clock_timestamp();
  INSERT INTO gov_repo.l14_proposals (organisation_id, proposal_id, subject_kind, intent, source_class,
    submitted_by_actor_user_id, prior_proposal_id, support_status, submitted_at)
  VALUES (v_org, v_proposal, 'POLICY_APPLICABILITY', p_intent, p_source_class, v_actor, p_prior_proposal_id,
    p_support_status, v_now);
  INSERT INTO gov_repo.l14_policy_applicability_proposals (organisation_id, proposal_id, subject_kind, intent,
    target_type, target_canonical_kind, target_canonical_object_id, target_relationship_id, target_relationship_state_id,
    policy_id, version_id, content_hash, policy_version_validated_state_id, applicability,
    requested_effective_from, requested_effective_to, target_state_id)
  VALUES (v_org, v_proposal, 'POLICY_APPLICABILITY', p_intent, p_target_type, p_target_canonical_kind,
    p_target_canonical_object_id, p_target_relationship_id, p_target_relationship_state_id, p_policy_id, p_version_id,
    p_content_hash, p_policy_version_validated_state_id, p_applicability, p_requested_effective_from,
    p_requested_effective_to, p_target_state_id);
  INSERT INTO gov_repo.l14_support_links (organisation_id, support_link_id, owner_kind, proposal_id, evidence_id)
  SELECT v_org, pg_catalog.gen_random_uuid(), 'PROPOSAL', v_proposal, i.id
  FROM pg_catalog.unnest(p_support_evidence_ids) AS i(id);
  INSERT INTO gov_repo.l14_command_results (organisation_id, command_id, command_kind, subject_kind,
    command_fingerprint, actor_user_id, outcome, proposal_id, recorded_at)
  VALUES (v_org, p_command_id, 'SUBMIT_PROPOSAL', 'POLICY_APPLICABILITY', v_fingerprint, v_actor, 'SUBMITTED',
    v_proposal, v_now);

  PERFORM 1 FROM gov_repo.l14_session_basis_v1(v_org, v_actor, p_verified_session_iat,
    p_verified_session_exp, p_verified_credential_epoch);
  RETURN QUERY SELECT * FROM gov_repo.l14_policy_applicability_command_result_v1(v_org, p_command_id, false);
END;
$submit_policy_applicability$;

-- ---------------------------------------------------------------------------------------
-- F2. RPC — governance decision on a POLICY_APPLICABILITY proposal. VALIDATE intent: VALIDATE / REJECT / DEFER. REVOKE
--     intent: REVOKE / REJECT / DEFER. DEFER is nonterminal. Authority = L14_POLICY_APPLICABILITY_VALIDATE with requested
--     action = the exact outcome, evaluated over the exact target (CANONICAL_OBJECT: the S1C.1 object evaluator, reused
--     unchanged; RELATIONSHIP_STATE: the bounded relationship-state evaluator). A VALIDATE whose key already has a VALIDATED
--     head is a SUPERSESSION (append a successor; the predecessor row is never touched).
-- ---------------------------------------------------------------------------------------
CREATE FUNCTION gov_repo.l14_decide_policy_applicability_proposal_v1(
  p_verified_organisation_id uuid,
  p_verified_actor_user_id uuid,
  p_verified_session_iat bigint,
  p_verified_session_exp bigint,
  p_verified_credential_epoch timestamptz,
  p_command_id text,
  p_proposal_id uuid,
  p_outcome text,
  p_reason_code text,
  p_expected_current_state_id uuid,             -- NULL = explicit expected-none (no state of the exact fact key yet)
  p_support_status text,
  p_support_evidence_ids text[],
  p_caller_fingerprint text                     -- assertion only; PostgreSQL recomputes
)
RETURNS TABLE (
  replay boolean, command_id text, command_kind text, subject_kind text, outcome text, command_fingerprint text,
  authorization_decision_id uuid, authorization_result text, deny_reason text, expectation_kind text,
  expected_current_state_id uuid, proposal_id uuid, governance_decision_id uuid, target_type text,
  target_canonical_kind text, target_canonical_object_id text, target_relationship_id text, target_relationship_state_id text,
  policy_id uuid, version_id uuid, content_hash text, policy_version_validated_state_id uuid, applicability text,
  fact_state_id uuid, state_kind text, predecessor_state_id uuid, effective_from timestamptz, effective_to timestamptz,
  recorded_at timestamptz
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
SET lock_timeout = '5s'
AS $decide_policy_applicability$
#variable_conflict use_column
DECLARE
  v_org uuid := p_verified_organisation_id;
  v_actor uuid := p_verified_actor_user_id;
  v_role_ids uuid[];
  v_support text[];
  v_fingerprint text;
  v_proposal record;
  v_rel record;
  v_relationship_type text;
  v_head_found boolean;
  v_head_latest uuid;
  v_latest_kind text;
  v_latest_from timestamptz;
  v_latest_to timestamptz;
  v_latest_version uuid;
  v_latest_hash text;
  v_latest_dependency uuid;
  v_latest_applicability text;
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
       'POLICY_APPLICABILITY_VALIDATED','POLICY_APPLICABILITY_REJECTED','POLICY_APPLICABILITY_DEFERRED',
       'POLICY_APPLICABILITY_REVOKED')
     OR NOT ((p_outcome = 'VALIDATE' AND p_reason_code = 'POLICY_APPLICABILITY_VALIDATED')
          OR (p_outcome = 'REJECT' AND p_reason_code = 'POLICY_APPLICABILITY_REJECTED')
          OR (p_outcome = 'DEFER' AND p_reason_code = 'POLICY_APPLICABILITY_DEFERRED')
          OR (p_outcome = 'REVOKE' AND p_reason_code = 'POLICY_APPLICABILITY_REVOKED')) THEN
    RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'DECISION_VOCABULARY_INVALID';
  END IF;
  -- The immutable proposal defines the command identity (fingerprint + guard keys); it is the only row read before
  -- replay arbitration, and it can never change or disappear.
  SELECT p.proposal_id, p.intent, p.source_class, p.submitted_by_actor_user_id,
         t.target_type, t.target_canonical_kind, t.target_canonical_object_id, t.target_relationship_id,
         t.target_relationship_state_id, t.target_key, t.policy_id, t.version_id, t.content_hash::text AS content_hash,
         t.policy_version_validated_state_id, t.applicability, t.requested_effective_from, t.requested_effective_to,
         t.target_state_id
  INTO v_proposal
  FROM gov_repo.l14_proposals AS p
  JOIN gov_repo.l14_policy_applicability_proposals AS t
    ON t.organisation_id = p.organisation_id AND t.proposal_id = p.proposal_id
  WHERE p.organisation_id = v_org AND p.proposal_id = p_proposal_id AND p.subject_kind = 'POLICY_APPLICABILITY';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'PROPOSAL_UNRESOLVED';
  END IF;
  IF (p_outcome = 'VALIDATE' AND v_proposal.intent <> 'VALIDATE')
     OR (p_outcome = 'REVOKE' AND v_proposal.intent <> 'REVOKE') THEN
    RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'OUTCOME_INTENT_INCOMPATIBLE';
  END IF;

  -- 3-4. Syntactic support, then the PostgreSQL-authoritative fingerprint.
  v_support := gov_repo.l14_support_syntactic_parts_v1(p_support_status, p_support_evidence_ids);
  v_fingerprint := gov_repo.l14_sha256_frame_v1(
    ARRAY['L14_COMMAND_FINGERPRINT_V1', 'DECIDE_PROPOSAL', v_org::text, v_actor::text, p_outcome, p_reason_code,
          v_proposal.proposal_id::text, 'POLICY_APPLICABILITY', v_proposal.intent, v_proposal.source_class,
          v_proposal.target_type]
    || CASE WHEN v_proposal.target_type = 'CANONICAL_OBJECT'
            THEN ARRAY[v_proposal.target_canonical_kind, v_proposal.target_canonical_object_id]
            ELSE ARRAY[v_proposal.target_relationship_id, v_proposal.target_relationship_state_id] END
    || ARRAY[v_proposal.policy_id::text, v_proposal.version_id::text, v_proposal.content_hash,
             v_proposal.policy_version_validated_state_id::text, v_proposal.applicability]
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

  -- 5-7. Guards in the fixed order: AP SHARED -> (VALIDATE only) exact POLICY_VERSION registry subject guard SHARED (the
  --      S1B.4 key, held to commit) -> exact POLICY_APPLICABILITY fact KEY -> command; then replay arbitration BEFORE any
  --      resolution. REVOKE / REJECT / DEFER never wait on the dependency (explicit cleanup stays possible).
  PERFORM gov_repo.l14_lock_authority_policy_guard_shared_v1(v_org);
  IF p_outcome = 'VALIDATE' THEN
    PERFORM gov_repo.l14_lock_policy_version_dependency_guard_shared_v1(v_org, v_proposal.policy_id, v_proposal.version_id,
      v_proposal.content_hash);
  END IF;
  PERFORM gov_repo.l14_lock_fact_subject_guard_v1(v_org, 'POLICY_APPLICABILITY',
    ARRAY['KEY', v_proposal.target_key, v_proposal.policy_id::text]);
  PERFORM gov_repo.l14_lock_command_guard_v1(v_org, p_command_id);
  IF gov_repo.l14_replay_arbitrate_v1(v_org, p_command_id, v_fingerprint) THEN
    PERFORM 1 FROM gov_repo.l14_session_basis_v1(v_org, v_actor, p_verified_session_iat,
      p_verified_session_exp, p_verified_credential_epoch);
    RETURN QUERY SELECT * FROM gov_repo.l14_policy_applicability_command_result_v1(v_org, p_command_id, true);
    RETURN;
  END IF;

  -- 8. Resolution (all under the guards): terminality, exact target, head expectation, per-key lineage rules.
  PERFORM 1 FROM gov_repo.l14_governance_decisions AS d
  WHERE d.organisation_id = v_org AND d.proposal_id = p_proposal_id AND d.outcome IN ('VALIDATE','REJECT','REVOKE');
  IF FOUND THEN
    RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'PROPOSAL_TERMINAL';
  END IF;
  IF v_proposal.target_type = 'CANONICAL_OBJECT' THEN
    PERFORM 1 FROM gov_repo.canonical_objects AS o
    WHERE o.organisation_id = v_org AND o.canonical_object_id = v_proposal.target_canonical_object_id
      AND o.kind = v_proposal.target_canonical_kind;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'TARGET_OBJECT_UNRESOLVED';
    END IF;
  ELSE
    SELECT r.match_count, r.relationship_type INTO v_rel
    FROM gov_repo.l14_resolve_relationship_state_target_v1(v_org, v_proposal.target_relationship_id,
      v_proposal.target_relationship_state_id) AS r;
    IF v_rel.match_count = 0 THEN
      RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'TARGET_RELATIONSHIP_STATE_UNRESOLVED';
    END IF;
    IF v_rel.match_count <> 1 THEN
      RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'TARGET_RELATIONSHIP_STATE_AMBIGUOUS';
    END IF;
    v_relationship_type := v_rel.relationship_type;
  END IF;
  -- No head row = no governed state of this exact fact key yet (created by the first state-appending decision).
  SELECT h.latest_state_id INTO v_head_latest
  FROM gov_repo.l14_policy_applicability_heads AS h
  WHERE h.organisation_id = v_org AND h.target_key = v_proposal.target_key AND h.policy_id = v_proposal.policy_id;
  v_head_found := FOUND;
  IF p_expected_current_state_id IS NULL AND v_head_latest IS NOT NULL THEN
    RAISE EXCEPTION 'L14_STALE_EXPECTATION' USING ERRCODE = 'GV009', DETAIL = 'POLICY_APPLICABILITY_STATE_EXISTS';
  END IF;
  IF p_expected_current_state_id IS DISTINCT FROM v_head_latest THEN
    RAISE EXCEPTION 'L14_STALE_EXPECTATION' USING ERRCODE = 'GV009', DETAIL = 'POLICY_APPLICABILITY_STATE_EXPECTATION_MISMATCH';
  END IF;
  IF v_head_latest IS NOT NULL THEN
    SELECT s.state_kind, s.effective_from, s.effective_to, d.version_id, d.content_hash::text,
           d.policy_version_validated_state_id, d.applicability
    INTO v_latest_kind, v_latest_from, v_latest_to, v_latest_version, v_latest_hash, v_latest_dependency,
         v_latest_applicability
    FROM gov_repo.l14_fact_states AS s
    JOIN gov_repo.l14_policy_applicability_states AS d
      ON d.organisation_id = s.organisation_id AND d.fact_state_id = s.fact_state_id
    WHERE s.organisation_id = v_org AND s.fact_state_id = v_head_latest;
  END IF;
  IF p_outcome = 'VALIDATE' AND v_latest_kind = 'VALIDATED' AND v_latest_to IS NULL
     AND v_latest_version = v_proposal.version_id AND v_latest_hash = v_proposal.content_hash
     AND v_latest_dependency = v_proposal.policy_version_validated_state_id
     AND v_latest_applicability = v_proposal.applicability THEN
    -- A successor must change something: another version / dependency, or another outcome.
    RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'POLICY_APPLICABILITY_ALREADY_VALIDATED';
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
  --    evaluated over the exact typed target.
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
  ELSIF v_proposal.target_type = 'CANONICAL_OBJECT' THEN
    SELECT e.deny_reason, e.rule_ordinals INTO v_deny, v_ordinals
    FROM gov_repo.l14_evaluate_target_authority_rules_v1(v_org, v_basis_policy, v_basis_version, v_role_ids,
      'L14_POLICY_APPLICABILITY_VALIDATE', p_outcome, p_outcome = 'VALIDATE' AND v_self, v_temporal,
      v_proposal.target_canonical_kind, v_proposal.target_canonical_object_id) AS e;
  ELSE
    SELECT e.deny_reason, e.rule_ordinals INTO v_deny, v_ordinals
    FROM gov_repo.l14_evaluate_relationship_state_authority_rules_v1(v_org, v_basis_policy, v_basis_version, v_role_ids,
      'L14_POLICY_APPLICABILITY_VALIDATE', p_outcome, p_outcome = 'VALIDATE' AND v_self, v_temporal,
      v_relationship_type, v_proposal.target_relationship_id, v_proposal.target_relationship_state_id) AS e;
  END IF;

  INSERT INTO gov_repo.l14_authorization_decisions (
    organisation_id, authorization_decision_id, command_id, command_fingerprint, actor_user_id,
    requested_action, subject_kind, scope_tag, target_canonical_kind, target_canonical_object_id,
    target_relationship_type, target_relationship_id, target_relationship_state_id, source_class,
    proposal_id, is_self_validation, authority_basis, basis_authority_policy_id, basis_version_id, basis_content_hash,
    result, deny_reason, evaluated_at, expectation_kind, expected_current_state_id)
  VALUES (
    v_org, v_authz, p_command_id, v_fingerprint, v_actor,
    p_outcome, 'POLICY_APPLICABILITY', v_proposal.target_type, v_proposal.target_canonical_kind,
    v_proposal.target_canonical_object_id, v_relationship_type, v_proposal.target_relationship_id,
    v_proposal.target_relationship_state_id, v_proposal.source_class, p_proposal_id, v_self,
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
    VALUES (v_org, p_command_id, 'DECIDE_PROPOSAL', 'POLICY_APPLICABILITY', v_fingerprint, v_actor, 'DENIED', v_authz,
      p_proposal_id, v_now);
  ELSE
    -- 10. Interval and dependency rules (authorized commands only; a violation raises and rolls back the WHOLE command:
    --     nothing is consumed).
    IF v_effective_to IS NOT NULL AND NOT (v_effective_to > v_effective_from) THEN
      RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'EFFECTIVE_INTERVAL_INVALID';
    END IF;
    IF p_outcome = 'REVOKE' AND v_effective_from < v_latest_from THEN
      RAISE EXCEPTION 'L14_CONTINUITY_VIOLATION' USING ERRCODE = 'GV011', DETAIL = 'REVOKE_BEFORE_TARGET_EFFECTIVE';
    END IF;
    IF p_outcome = 'REVOKE' AND v_latest_to IS NOT NULL AND v_effective_from >= v_latest_to THEN
      RAISE EXCEPTION 'L14_CONTINUITY_VIOLATION' USING ERRCODE = 'GV011', DETAIL = 'REVOKE_AFTER_TARGET_EXPIRY';
    END IF;
    IF p_outcome = 'VALIDATE' AND v_latest_kind = 'REVOKED' AND NOT (v_effective_from >= v_latest_from) THEN
      RAISE EXCEPTION 'L14_CONTINUITY_VIOLATION' USING ERRCODE = 'GV011', DETAIL = 'REVALIDATION_OVERLAPS_PRIOR_INTERVAL';
    END IF;
    -- Supersession (same key, another version / dependency / outcome): never before the predecessor's start, never
    -- before its explicit immutable end (exactly at it, or after it with an UNKNOWN gap, is legal).
    IF p_outcome = 'VALIDATE' AND v_latest_kind = 'VALIDATED' AND v_effective_from < v_latest_from THEN
      RAISE EXCEPTION 'L14_CONTINUITY_VIOLATION' USING ERRCODE = 'GV011', DETAIL = 'SUCCESSOR_BEFORE_PREDECESSOR_EFFECTIVE';
    END IF;
    IF p_outcome = 'VALIDATE' AND v_latest_kind = 'VALIDATED' AND v_latest_to IS NOT NULL AND v_effective_from < v_latest_to THEN
      RAISE EXCEPTION 'L14_CONTINUITY_VIOLATION' USING ERRCODE = 'GV011', DETAIL = 'SUCCESSOR_BEFORE_PREDECESSOR_END';
    END IF;
    IF p_outcome = 'VALIDATE' AND NOT EXISTS (
         SELECT 1 FROM gov_repo.l14_policy_version_valid_state_v1(v_org, v_proposal.policy_id, v_proposal.version_id,
           v_proposal.content_hash, v_effective_from, v_now) AS pv
         WHERE pv.state_id = v_proposal.policy_version_validated_state_id) THEN
      -- The exact pinned POLICY_VERSION state must be THE valid state of this exact tuple at the requested effective
      -- instant, as known now, under the shared dependency guard (an unvalidated, revoked, not-yet-effective or replaced
      -- dependency never validates an applicability; a concurrent revocation committed first is seen here).
      RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'POLICY_VERSION_DEPENDENCY_NOT_VALID';
    END IF;

    INSERT INTO gov_repo.l14_governance_decisions (organisation_id, governance_decision_id, proposal_id,
      subject_kind, outcome, reason_code, authorization_decision_id, actor_user_id, support_status, decided_at)
    VALUES (v_org, v_decision, p_proposal_id, 'POLICY_APPLICABILITY', p_outcome, p_reason_code, v_authz, v_actor,
      p_support_status, v_now);
    INSERT INTO gov_repo.l14_support_links (organisation_id, support_link_id, owner_kind, governance_decision_id, evidence_id)
    SELECT v_org, pg_catalog.gen_random_uuid(), 'GOVERNANCE_DECISION', v_decision, i.id
    FROM pg_catalog.unnest(p_support_evidence_ids) AS i(id);

    IF p_outcome IN ('VALIDATE','REVOKE') THEN
      v_state_kind := CASE WHEN p_outcome = 'VALIDATE' THEN 'VALIDATED' ELSE 'REVOKED' END;
      -- Append-only: predecessor = the expected head state (supersession, revalidation or revocation target); the
      -- predecessor row is never modified — its closure is derived from this successor by the resolver.
      INSERT INTO gov_repo.l14_fact_states (organisation_id, fact_state_id, subject_kind, state_kind,
        predecessor_state_id, revokes_state_id, effective_from, effective_to, recorded_at, governance_decision_id,
        authorization_decision_id, authority_policy_id, authority_policy_version_id, authority_policy_content_hash,
        trust_state, source_class, support_status)
      VALUES (v_org, v_state, 'POLICY_APPLICABILITY', v_state_kind, v_head_latest, v_target_state_id,
        v_effective_from, v_effective_to, v_now, v_decision, v_authz, v_basis_policy, v_basis_version, v_basis_hash,
        'VALIDATED', v_proposal.source_class, p_support_status);
      INSERT INTO gov_repo.l14_policy_applicability_states (organisation_id, fact_state_id, subject_kind, state_kind,
        target_type, target_canonical_kind, target_canonical_object_id, target_relationship_id, target_relationship_state_id,
        policy_id, version_id, content_hash, policy_version_validated_state_id, applicability,
        predecessor_state_id, revokes_state_id)
      VALUES (v_org, v_state, 'POLICY_APPLICABILITY', v_state_kind, v_proposal.target_type, v_proposal.target_canonical_kind,
        v_proposal.target_canonical_object_id, v_proposal.target_relationship_id, v_proposal.target_relationship_state_id,
        v_proposal.policy_id, v_proposal.version_id, v_proposal.content_hash, v_proposal.policy_version_validated_state_id,
        v_proposal.applicability, v_head_latest, v_target_state_id);
      -- Technical head: created empty on the first state of the key, then compare-and-set on the exact expectation.
      IF NOT v_head_found THEN
        INSERT INTO gov_repo.l14_policy_applicability_heads (organisation_id, target_type, target_canonical_kind,
          target_canonical_object_id, target_relationship_id, target_relationship_state_id, policy_id, latest_state_id)
        VALUES (v_org, v_proposal.target_type, v_proposal.target_canonical_kind, v_proposal.target_canonical_object_id,
          v_proposal.target_relationship_id, v_proposal.target_relationship_state_id, v_proposal.policy_id, NULL);
      END IF;
      UPDATE gov_repo.l14_policy_applicability_heads AS h SET latest_state_id = v_state
      WHERE h.organisation_id = v_org AND h.target_key = v_proposal.target_key AND h.policy_id = v_proposal.policy_id
        AND h.latest_state_id IS NOT DISTINCT FROM p_expected_current_state_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'L14_STALE_EXPECTATION' USING ERRCODE = 'GV009', DETAIL = 'POLICY_APPLICABILITY_STATE_EXPECTATION_MISMATCH';
      END IF;
      INSERT INTO gov_repo.l14_support_links (organisation_id, support_link_id, owner_kind, fact_state_id, evidence_id)
      SELECT v_org, pg_catalog.gen_random_uuid(), 'FACT_STATE', v_state, i.id
      FROM pg_catalog.unnest(p_support_evidence_ids) AS i(id);
      INSERT INTO gov_repo.l14_command_results (organisation_id, command_id, command_kind, subject_kind,
        command_fingerprint, actor_user_id, outcome, authorization_decision_id, proposal_id, governance_decision_id,
        fact_state_id, recorded_at)
      VALUES (v_org, p_command_id, 'DECIDE_PROPOSAL', 'POLICY_APPLICABILITY', v_fingerprint, v_actor, v_state_kind,
        v_authz, p_proposal_id, v_decision, v_state, v_now);
    ELSE
      -- REJECT / DEFER: governance decision only; no fact, no head change.
      INSERT INTO gov_repo.l14_command_results (organisation_id, command_id, command_kind, subject_kind,
        command_fingerprint, actor_user_id, outcome, authorization_decision_id, proposal_id, governance_decision_id,
        recorded_at)
      VALUES (v_org, p_command_id, 'DECIDE_PROPOSAL', 'POLICY_APPLICABILITY', v_fingerprint, v_actor,
        CASE WHEN p_outcome = 'REJECT' THEN 'REJECTED' ELSE 'DEFERRED' END, v_authz, p_proposal_id, v_decision, v_now);
    END IF;
  END IF;

  -- 11. Base session eligibility at commitment.
  PERFORM 1 FROM gov_repo.l14_session_basis_v1(v_org, v_actor, p_verified_session_iat,
    p_verified_session_exp, p_verified_credential_epoch);
  RETURN QUERY SELECT * FROM gov_repo.l14_policy_applicability_command_result_v1(v_org, p_command_id, false);
END;
$decide_policy_applicability$;

-- ---------------------------------------------------------------------------------------
-- G. Privileges. The hostile 20260818013113 defaults hand every new gov_repo table to service_role: removed. No
--    application role gets any privilege on the new tables. Exactly the two new RPCs are service_role-executable; every
--    helper / guard / encoder / evaluator / resolver / read primitive stays owner-only (the replaced fact guard keeps its
--    owner-only ACL).
-- ---------------------------------------------------------------------------------------
ALTER TABLE gov_repo.l14_policy_applicability_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE gov_repo.l14_policy_applicability_proposals ENABLE ROW LEVEL SECURITY;
ALTER TABLE gov_repo.l14_policy_applicability_heads ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE gov_repo.l14_policy_applicability_states, gov_repo.l14_policy_applicability_proposals,
  gov_repo.l14_policy_applicability_heads
FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION
  gov_repo.l14_lock_fact_subject_guard_v1(uuid, text, text[]),
  gov_repo.l14_policy_applicability_target_key_v1(text, text, text, text, text),
  gov_repo.l14_resolve_relationship_state_target_v1(uuid, text, text),
  gov_repo.l14_lock_policy_version_dependency_guard_shared_v1(uuid, uuid, uuid, text),
  gov_repo.l14_evaluate_relationship_state_authority_rules_v1(uuid, uuid, uuid, uuid[], text, text, boolean, text, text, text, text),
  gov_repo.l14_policy_applicability_proposal_guard_v1(),
  gov_repo.l14_policy_applicability_state_guard_v1(),
  gov_repo.l14_policy_applicability_head_guard_v1(),
  gov_repo.l14_policy_applicability_command_result_v1(uuid, text, boolean),
  gov_repo.l14_policy_applicability_valid_state_v1(uuid, text, text, text, text, text, uuid, timestamptz, timestamptz),
  gov_repo.l14_policy_applicabilities_current_v1(uuid, text, text, text, text, text, timestamptz, timestamptz),
  gov_repo.l14_submit_policy_applicability_proposal_v1(uuid, uuid, bigint, bigint, timestamptz, text, text, text, text, text, text, text, text, uuid, uuid, text, uuid, text, timestamptz, timestamptz, uuid, uuid, text, text[], text),
  gov_repo.l14_decide_policy_applicability_proposal_v1(uuid, uuid, bigint, bigint, timestamptz, text, uuid, text, text, uuid, text, text[], text)
FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION
  gov_repo.l14_submit_policy_applicability_proposal_v1(uuid, uuid, bigint, bigint, timestamptz, text, text, text, text, text, text, text, text, uuid, uuid, text, uuid, text, timestamptz, timestamptz, uuid, uuid, text, text[], text),
  gov_repo.l14_decide_policy_applicability_proposal_v1(uuid, uuid, bigint, bigint, timestamptz, text, uuid, text, text, uuid, text, text[], text)
TO service_role;

COMMENT ON TABLE gov_repo.l14_fact_states IS 'M16-S1C.1 common immutable governed FACT-state envelope (M16 fact families; RESPONSIBILITY_ASSIGNMENT since S1C.1, BUSINESS_CONTEXT_ASSIGNMENT since S1C.2 and POLICY_APPLICABILITY since S1C.3 are executable; CONTROL_APPLICABILITY and CONTROL_ASSESSMENT stay unimplemented): VALIDATED/REVOKED, lineage predecessor, exact revocation target, effective_from, optional immutable explicit effective_to fixed at creation (VALIDATED only; a REVOKE never invents a second end), DB recorded_at, decision + authorization + Authority Policy basis lineage, trust, source, support status. Holds NO subject content. Distinct from l14_registry_states.';
COMMENT ON TABLE gov_repo.l14_policy_applicability_states IS 'M16-S1C.3 immutable typed POLICY_APPLICABILITY detail of l14_fact_states: exact fact key (organisation, closed target union CANONICAL_OBJECT kind+id | RELATIONSHIP_STATE relationship_id+relationship_state_id, policy_id; never the version / hash / dependency / outcome), the exact immutable version tuple (policy_id, version_id, DB-verified content_hash), the pinned VALIDATED POLICY_VERSION state (dependency lineage only) and the outcome APPLIES | DOES_NOT_APPLY. A version / outcome change is a lineage successor of the same key; predecessor closure is derived, never stored. Not a canonical relationship / object, current_version_id, legacy status / approval, mapping row or inference.';
COMMENT ON TABLE gov_repo.l14_policy_applicability_proposals IS 'M16-S1C.3 immutable typed POLICY_APPLICABILITY proposal: exact target union, exact policy version tuple + pinned VALIDATED POLICY_VERSION state, outcome, requested_effective_from (NULL = IMMEDIATE), optional immutable requested_effective_to (VALIDATE only), target_state_id (REVOKE only, exact VALIDATED state of the same key + tuple + dependency + outcome). LOCAL_HUMAN only. No JSON, no rationale.';
COMMENT ON TABLE gov_repo.l14_policy_applicability_heads IS 'M16-S1C.3 technical compare-and-set pointer only (latest state of the exact fact key organisation + exact target + policy_id; never the version id, content hash, dependency or outcome); created by the first state-appending decision, RPC-maintained, advanced only to the direct lineage successor; reconstructible from history; never authoritative.';
COMMENT ON COLUMN gov_repo.l14_command_results.fact_state_id IS 'M16-S1C.1 durable reference to the fact state a VALIDATED/REVOKED fact-family decision (RESPONSIBILITY_ASSIGNMENT, BUSINESS_CONTEXT_ASSIGNMENT, POLICY_APPLICABILITY) produced (subject-exact FK); NULL for every S1A / S1B row and every other outcome.';
COMMENT ON FUNCTION gov_repo.l14_lock_fact_subject_guard_v1(uuid, text, text[]) IS 'M16-S1C.1 owner-only EXCLUSIVE fact guard keyed by frame_identity(organisation, fact subject kind, key parts); closed subjects RESPONSIBILITY_ASSIGNMENT (S1C.1: CARDINALITY then KEY), BUSINESS_CONTEXT_ASSIGNMENT (S1C.2: KEY = target + semantic kind) and POLICY_APPLICABILITY (S1C.3: KEY = exact target key + policy).';
COMMENT ON FUNCTION gov_repo.l14_policy_applicability_target_key_v1(text, text, text, text, text) IS 'M16-S1C.3 owner-only IMMUTABLE injective key of the closed POLICY_APPLICABILITY target union (length-prefixed, branch-tagged); NULL for any hybrid / partial / unknown shape.';
COMMENT ON FUNCTION gov_repo.l14_resolve_relationship_state_target_v1(uuid, text, text) IS 'M16-S1C.3 owner-only exact read-only relationship-state target resolution by organisation + relationship_id + relationship_state_id: match count and, only for exactly one row, the DB-resolved relationship type (authorization scope input only). No F2 DDL / DML / FK / uniqueness.';
COMMENT ON FUNCTION gov_repo.l14_lock_policy_version_dependency_guard_shared_v1(uuid, uuid, uuid, text) IS 'M16-S1C.3 owner-only SHARED mode of the exact S1B.4 POLICY_VERSION registry subject guard key (POLICY_VERSION_VALIDATION:policy:version:hash): an applicability VALIDATE pinning that tuple serializes with every POLICY_VERSION decision on it (exclusive) and never with other applicabilities pinning it (shared); held to commit; no new lock namespace.';
COMMENT ON FUNCTION gov_repo.l14_evaluate_relationship_state_authority_rules_v1(uuid, uuid, uuid, uuid[], text, text, boolean, text, text, text, text) IS 'M16-S1C.3 owner-only closed Authority Policy rule evaluator for an exact RELATIONSHIP_STATE request target: ALL_ALLOWED_TARGETS | RELATIONSHIP_TYPE (DB-resolved type) | RELATIONSHIP_STATE (exact id + state id); CANONICAL_KIND / CANONICAL_OBJECT never match. Authorization scope only, never fact inheritance.';
COMMENT ON FUNCTION gov_repo.l14_policy_applicability_valid_state_v1(uuid, text, text, text, text, text, uuid, timestamptz, timestamptz) IS 'M16-S1C.3 owner-only exact bitemporal POLICY_APPLICABILITY resolver: the exact VALIDATED fact of the exact key (target + policy) valid at a business instant as known at a recorded cutoff (closure derived from a VISIBLE successor), only when its own state, its exact target and its pinned VALIDATED POLICY_VERSION dependency all hold at the SAME coordinates; no row = UNKNOWN (never DOES_NOT_APPLY); never a substitute version, hash, current_version_id or inheritance.';
COMMENT ON FUNCTION gov_repo.l14_policy_applicabilities_current_v1(uuid, text, text, text, text, text, timestamptz, timestamptz) IS 'M16-S1C.3 owner-only bounded current-applicability read of ONE exact target: at most one row per policy the exact resolver returns at the same coordinates (APPLIES or DOES_NOT_APPLY); absence = UNKNOWN; never rolled up, forward or inherited.';
COMMENT ON FUNCTION gov_repo.l14_policy_applicability_command_result_v1(uuid, text, boolean) IS 'M16-S1C.3 owner-only durable POLICY_APPLICABILITY command result projection (replay returns the original).';
COMMENT ON FUNCTION gov_repo.l14_submit_policy_applicability_proposal_v1(uuid, uuid, bigint, bigint, timestamptz, text, text, text, text, text, text, text, text, uuid, uuid, text, uuid, text, timestamptz, timestamptz, uuid, uuid, text, text[], text) IS 'M16-S1C.3 service_role-only POLICY_APPLICABILITY proposal submission by any verified active member (LOCAL_HUMAN only) over an exact closed target union + admitted policy + exact admitted version tuple with its DB-verified hash + exact pinned VALIDATED POLICY_VERSION state + APPLIES | DOES_NOT_APPLY; grants no authority, writes no authorization / decision / fact / head.';
COMMENT ON FUNCTION gov_repo.l14_decide_policy_applicability_proposal_v1(uuid, uuid, bigint, bigint, timestamptz, text, uuid, text, text, uuid, text, text[], text) IS 'M16-S1C.3 service_role-only governance decision on a POLICY_APPLICABILITY proposal (L14_POLICY_APPLICABILITY_VALIDATE, requested action = exact outcome, exact typed target scope, current roles, current effective Authority Policy, temporal permission); POLICY_VERSION dependency valid at the effective instant under the shared dependency guard; same-key supersession appends a successor (never an UPDATE).';

-- ---------------------------------------------------------------------------------------
-- H. Postflight over the EFFECTIVE post-S1C.3 catalog (after ALL grants, including the broad legacy defaults).
--    Self-contained and re-executable. Historical postflights keep their own horizon and are not altered.
-- ---------------------------------------------------------------------------------------
DO $postflight$
DECLARE
  v_facts CONSTANT regclass := 'gov_repo.l14_fact_states'::regclass;
  v_states CONSTANT regclass := 'gov_repo.l14_policy_applicability_states'::regclass;
  v_proposals CONSTANT regclass := 'gov_repo.l14_policy_applicability_proposals'::regclass;
  v_heads CONSTANT regclass := 'gov_repo.l14_policy_applicability_heads'::regclass;
  v_new_tables CONSTANT oid[] := ARRAY['gov_repo.l14_policy_applicability_states'::regclass::oid,
    'gov_repo.l14_policy_applicability_proposals'::regclass::oid, 'gov_repo.l14_policy_applicability_heads'::regclass::oid];
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
    'gov_repo.l14_business_context_assignment_heads'::regclass::oid, 'gov_repo.l14_policy_applicability_states'::regclass::oid,
    'gov_repo.l14_policy_applicability_proposals'::regclass::oid, 'gov_repo.l14_policy_applicability_heads'::regclass::oid];
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
    'l14_policy_applicability_heads','l14_policy_applicability_proposals','l14_policy_applicability_states',
    'l14_policy_version_admissions','l14_policy_version_heads','l14_policy_version_proposals',
    'l14_policy_version_states','l14_proposals','l14_registry_states','l14_responsibility_assignment_heads',
    'l14_responsibility_assignment_proposals','l14_responsibility_assignment_states','l14_support_links'];
  v_mutable_heads CONSTANT text[] := ARRAY['l14_authority_policy_heads','l14_business_context_assignment_heads',
    'l14_control_definition_heads','l14_domain_heads','l14_governance_party_heads','l14_policy_applicability_heads',
    'l14_policy_version_heads','l14_responsibility_assignment_heads'];
  v_public_l14 CONSTANT text[] := ARRAY[
    'l14_admit_authority_policy_version_v1','l14_admit_control_definition_version_v1','l14_admit_domain_v1',
    'l14_admit_governance_party_v1','l14_admit_governance_policy_v1','l14_admit_policy_version_v1',
    'l14_decide_authority_policy_proposal_v1','l14_decide_business_context_assignment_proposal_v1',
    'l14_decide_control_definition_proposal_v1','l14_decide_domain_proposal_v1',
    'l14_decide_governance_party_proposal_v1','l14_decide_policy_applicability_proposal_v1',
    'l14_decide_policy_version_proposal_v1','l14_decide_responsibility_assignment_proposal_v1',
    'l14_read_policy_descriptors_v1','l14_submit_business_context_assignment_proposal_v1',
    'l14_submit_control_definition_proposal_v1','l14_submit_domain_proposal_v1',
    'l14_submit_governance_party_proposal_v1','l14_submit_policy_applicability_proposal_v1',
    'l14_submit_policy_version_proposal_v1','l14_submit_proposal_v1','l14_submit_responsibility_assignment_proposal_v1'];
  v_new_rpcs CONSTANT text[] := ARRAY['l14_decide_policy_applicability_proposal_v1','l14_submit_policy_applicability_proposal_v1'];
  -- The twelve new routines (the S1C.3 family) plus the widened S1C.1 fact guard.
  v_new_routines CONSTANT text[] := ARRAY[
    'l14_decide_policy_applicability_proposal_v1','l14_evaluate_relationship_state_authority_rules_v1',
    'l14_lock_policy_version_dependency_guard_shared_v1','l14_policy_applicabilities_current_v1',
    'l14_policy_applicability_command_result_v1','l14_policy_applicability_head_guard_v1',
    'l14_policy_applicability_proposal_guard_v1','l14_policy_applicability_state_guard_v1',
    'l14_policy_applicability_target_key_v1','l14_policy_applicability_valid_state_v1',
    'l14_resolve_relationship_state_target_v1','l14_submit_policy_applicability_proposal_v1'];
  v_privileges text[] := ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'];
  v_crypto name := (SELECT e.extnamespace::regnamespace::name FROM pg_catalog.pg_extension AS e WHERE e.extname = 'pgcrypto');
  v_vector name := (SELECT e.extnamespace::regnamespace::name FROM pg_catalog.pg_extension AS e WHERE e.extname = 'vector');
  v_union CONSTANT text := 'CHECK ((((target_type = ''CANONICAL_OBJECT''::text) AND (target_canonical_kind IS NOT NULL) AND (target_canonical_object_id IS NOT NULL) AND (target_relationship_id IS NULL) AND (target_relationship_state_id IS NULL)) OR ((target_type = ''RELATIONSHIP_STATE''::text) AND (target_canonical_kind IS NULL) AND (target_canonical_object_id IS NULL) AND (target_relationship_id IS NOT NULL) AND (target_relationship_state_id IS NOT NULL))))';
  v_target_cols CONSTANT text[] := ARRAY['target_type:text','target_canonical_kind:text','target_canonical_object_id:text',
    'target_relationship_id:text','target_relationship_state_id:text','target_key:text'];
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
    RAISE EXCEPTION 'M16_S1C3_POSTFLIGHT: unexpected l14 relation set';
  END IF;

  -- H2. Every l14 table + both reused stores: RLS-enabled ordinary table, zero non-owner / column / application
  --     privilege (incl. inherited), no JSON; immutable history; NO RLS policy on any guarded table (no permissive path).
  FOR v_rel IN
    SELECT c.oid, c.relname, c.relkind, c.relowner, c.relacl, c.relrowsecurity
    FROM pg_catalog.pg_class AS c
    WHERE c.relnamespace = 'gov_repo'::regnamespace AND (c.relname::text = ANY (v_expected_l14) OR c.oid = ANY (v_stores))
  LOOP
    IF v_rel.relkind <> 'r' OR NOT v_rel.relrowsecurity THEN
      RAISE EXCEPTION 'M16_S1C3_POSTFLIGHT: % must be an RLS-enabled ordinary table', v_rel.relname;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_catalog.aclexplode(COALESCE(v_rel.relacl, pg_catalog.acldefault('r', v_rel.relowner))) AS a
               WHERE a.grantee <> v_rel.relowner) THEN
      RAISE EXCEPTION 'M16_S1C3_POSTFLIGHT: % has a non-owner table grant', v_rel.relname;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_attribute AS att WHERE att.attrelid = v_rel.oid AND att.attacl IS NOT NULL) THEN
      RAISE EXCEPTION 'M16_S1C3_POSTFLIGHT: % has column-level grants', v_rel.relname;
    END IF;
    FOREACH v_role IN ARRAY v_app LOOP
      FOREACH v_privilege IN ARRAY v_privileges LOOP
        IF pg_catalog.has_table_privilege(v_role, v_rel.oid, v_privilege) THEN
          RAISE EXCEPTION 'M16_S1C3_POSTFLIGHT: % holds % on %', v_role, v_privilege, v_rel.relname;
        END IF;
      END LOOP;
      IF pg_catalog.has_any_column_privilege(v_role, v_rel.oid, 'SELECT, INSERT, UPDATE, REFERENCES') THEN
        RAISE EXCEPTION 'M16_S1C3_POSTFLIGHT: % holds a column privilege on %', v_role, v_rel.relname;
      END IF;
    END LOOP;
    IF v_rel.oid = ANY (v_guarded) AND EXISTS (SELECT 1 FROM pg_catalog.pg_policy AS pol WHERE pol.polrelid = v_rel.oid) THEN
      RAISE EXCEPTION 'M16_S1C3_POSTFLIGHT: % carries an RLS policy (no application access path may exist)', v_rel.relname;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_attribute AS att
               WHERE att.attrelid = v_rel.oid AND att.attnum > 0 AND NOT att.attisdropped
                 AND att.atttypid IN ('json'::regtype, 'jsonb'::regtype)) THEN
      RAISE EXCEPTION 'M16_S1C3_POSTFLIGHT: % has a JSON column', v_rel.relname;
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
      RAISE EXCEPTION 'M16_S1C3_POSTFLIGHT: % lacks ALWAYS raising BEFORE UPDATE/DELETE and TRUNCATE triggers', v_rel.relname;
    END IF;
  END LOOP;

  -- H3. New structures: exactly the pinned columns (no label / rationale / JSON / score); every text column a closed
  --     vocabulary or a pinned single-column bound CHECK; the exact closed target union on all three tables; the closed
  --     outcome; the head key EXACTLY organisation + target key + policy (never version / hash / dependency / outcome); the
  --     fact envelope subject EXACTLY the three implemented families; the structural guards ALWAYS; the exact
  --     non-cascading FK set (incl. the POLICY_VERSION dependency FK) and NO FK onto the F2 table; linear lineage keys.
  IF (SELECT pg_catalog.array_agg(att.attname::text || ':' || pg_catalog.format_type(att.atttypid, att.atttypmod) ORDER BY att.attnum)
      FROM pg_catalog.pg_attribute AS att WHERE att.attrelid = v_states AND att.attnum > 0 AND NOT att.attisdropped)
     IS DISTINCT FROM ARRAY['organisation_id:uuid','fact_state_id:uuid','subject_kind:text','state_kind:text']
       || v_target_cols || ARRAY['policy_id:uuid','version_id:uuid','content_hash:character(64)',
       'policy_version_validated_state_id:uuid','policy_version_state_kind:text','applicability:text',
       'predecessor_state_id:uuid','revokes_state_id:uuid','revoked_state_kind:text']
     OR (SELECT pg_catalog.array_agg(att.attname::text || ':' || pg_catalog.format_type(att.atttypid, att.atttypmod) ORDER BY att.attnum)
      FROM pg_catalog.pg_attribute AS att WHERE att.attrelid = v_proposals AND att.attnum > 0 AND NOT att.attisdropped)
     IS DISTINCT FROM ARRAY['organisation_id:uuid','proposal_id:uuid','subject_kind:text','intent:text']
       || v_target_cols || ARRAY['policy_id:uuid','version_id:uuid','content_hash:character(64)',
       'policy_version_validated_state_id:uuid','policy_version_state_kind:text','applicability:text',
       'requested_effective_from:timestamp with time zone','requested_effective_to:timestamp with time zone',
       'target_state_id:uuid','target_state_kind:text']
     OR (SELECT pg_catalog.array_agg(att.attname::text || ':' || pg_catalog.format_type(att.atttypid, att.atttypmod) ORDER BY att.attnum)
      FROM pg_catalog.pg_attribute AS att WHERE att.attrelid = v_heads AND att.attnum > 0 AND NOT att.attisdropped)
     IS DISTINCT FROM ARRAY['organisation_id:uuid'] || v_target_cols || ARRAY['policy_id:uuid','latest_state_id:uuid'] THEN
    RAISE EXCEPTION 'M16_S1C3_POSTFLIGHT: S1C.3 structure columns are not exactly the pinned set';
  END IF;
  -- target_key is the generated key on all three tables (never a caller-supplied value).
  IF (SELECT pg_catalog.count(*) FROM pg_catalog.pg_attribute AS att
      WHERE att.attrelid = ANY (v_new_tables) AND att.attname = 'target_key' AND att.attgenerated = 's' AND att.attnotnull
        AND pg_catalog.pg_get_expr((SELECT ad.adbin FROM pg_catalog.pg_attrdef AS ad
                                    WHERE ad.adrelid = att.attrelid AND ad.adnum = att.attnum), att.attrelid)
            = 'gov_repo.l14_policy_applicability_target_key_v1(target_type, target_canonical_kind, target_canonical_object_id, target_relationship_id, target_relationship_state_id)') <> 3
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc AS p
                    WHERE p.oid = 'gov_repo.l14_policy_applicability_target_key_v1(text,text,text,text,text)'::regprocedure
                      AND p.provolatile = 'i' AND NOT p.prosecdef
                      AND p.prosrc LIKE '%''CANONICAL_OBJECT|'' || pg_catalog.length(p_target_canonical_kind)::text || '':''%'
                      AND p.prosrc LIKE '%''RELATIONSHIP_STATE|'' || pg_catalog.length(p_target_relationship_id)::text || '':''%'
                      AND p.prosrc LIKE '%p_target_relationship_id IS NULL AND p_target_relationship_state_id IS NULL%'
                      AND p.prosrc LIKE '%p_target_canonical_kind IS NULL AND p_target_canonical_object_id IS NULL%'
                      AND p.prosrc !~* '(\mFROM\M|\mINSERT\M|\mUPDATE\M|\mDELETE\M)') THEN
    RAISE EXCEPTION 'M16_S1C3_POSTFLIGHT: the generated target key / its injective encoder drifted';
  END IF;
  IF (SELECT pg_catalog.array_agg(att.attname::text ORDER BY k.ord)
      FROM pg_catalog.pg_constraint AS c
      CROSS JOIN LATERAL pg_catalog.unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord)
      JOIN pg_catalog.pg_attribute AS att ON att.attrelid = c.conrelid AND att.attnum = k.attnum
      WHERE c.conrelid = v_heads AND c.contype = 'p') IS DISTINCT FROM ARRAY['organisation_id','target_key','policy_id']::text[]
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_index AS i JOIN pg_catalog.pg_attribute AS att
                  ON att.attrelid = i.indrelid AND att.attnum = ANY (i.indkey::int2[])
                WHERE i.indrelid = v_heads
                  AND att.attname IN ('version_id','content_hash','policy_version_validated_state_id','applicability'))
     OR (SELECT pg_catalog.count(*) FROM pg_catalog.pg_index AS i WHERE i.indrelid = v_heads) <> 1 THEN
    RAISE EXCEPTION 'M16_S1C3_POSTFLIGHT: the policy-applicability head key must be exactly organisation + target + policy';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_attribute AS att
             WHERE att.attrelid = ANY (v_new_tables) AND att.attnum > 0 AND NOT att.attisdropped
               AND att.atttypid IN ('text'::regtype, 'bpchar'::regtype, 'varchar'::regtype)
               AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint AS k
                               WHERE k.conrelid = att.attrelid AND k.contype = 'c' AND k.conkey = ARRAY[att.attnum]::int2[])) THEN
    RAISE EXCEPTION 'M16_S1C3_POSTFLIGHT: an S1C.3 text column is not a closed vocabulary / pinned bound';
  END IF;
  IF (SELECT pg_catalog.count(*) FROM pg_catalog.pg_constraint AS k
      WHERE k.contype = 'c' AND k.conrelid IN (v_states, v_proposals, v_heads) AND k.convalidated
        AND k.conname IN ('l14_policy_applicability_states_target_union_check','l14_policy_applicability_proposals_target_union_check',
                          'l14_policy_applicability_heads_target_union_check')
        AND pg_catalog.pg_get_constraintdef(k.oid) = v_union) <> 3
     OR (SELECT pg_catalog.count(*) FROM pg_catalog.pg_constraint AS k
      WHERE k.contype = 'c' AND k.conrelid IN (v_states, v_proposals, v_heads)
        AND k.conkey = ARRAY[(SELECT att.attnum FROM pg_catalog.pg_attribute AS att WHERE att.attrelid = k.conrelid AND att.attname = 'target_type')]::int2[]
        AND pg_catalog.pg_get_constraintdef(k.oid) = 'CHECK ((target_type = ANY (ARRAY[''CANONICAL_OBJECT''::text, ''RELATIONSHIP_STATE''::text])))') <> 3
     OR (SELECT pg_catalog.count(*) FROM pg_catalog.pg_constraint AS k
      WHERE k.contype = 'c' AND k.conrelid IN (v_states, v_proposals)
        AND k.conkey = ARRAY[(SELECT att.attnum FROM pg_catalog.pg_attribute AS att WHERE att.attrelid = k.conrelid AND att.attname = 'applicability')]::int2[]
        AND pg_catalog.pg_get_constraintdef(k.oid) = 'CHECK ((applicability = ANY (ARRAY[''APPLIES''::text, ''DOES_NOT_APPLY''::text])))') <> 2
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_constraint AS k
                WHERE k.contype = 'c' AND k.conrelid IN (v_states, v_proposals)
                  AND k.conkey = ARRAY[(SELECT att.attnum FROM pg_catalog.pg_attribute AS att WHERE att.attrelid = k.conrelid AND att.attname = 'applicability')]::int2[]
                  AND pg_catalog.pg_get_constraintdef(k.oid) <> 'CHECK ((applicability = ANY (ARRAY[''APPLIES''::text, ''DOES_NOT_APPLY''::text])))')
     OR (SELECT pg_catalog.count(*) FROM pg_catalog.pg_constraint AS k
      WHERE k.contype = 'c' AND k.conrelid IN (v_states, v_proposals)
        AND pg_catalog.pg_get_constraintdef(k.oid) = 'CHECK ((policy_version_state_kind = ''VALIDATED''::text))') <> 2
     OR (SELECT pg_catalog.count(*) FROM pg_catalog.pg_constraint AS k
      WHERE k.contype = 'c' AND k.conrelid IN (v_states, v_proposals)
        AND pg_catalog.pg_get_constraintdef(k.oid) = 'CHECK ((subject_kind = ''POLICY_APPLICABILITY''::text))') <> 2
     OR (SELECT pg_catalog.count(*) FROM pg_catalog.pg_constraint AS k WHERE k.conrelid = v_facts AND k.contype = 'c'
           AND k.conkey = ARRAY[(SELECT att.attnum FROM pg_catalog.pg_attribute AS att WHERE att.attrelid = v_facts AND att.attname = 'subject_kind')]::int2[])
         <> 1
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint AS k WHERE k.conrelid = v_facts AND k.contype = 'c'
                      AND k.conname = 'l14_fact_states_subject_kind_check'
                      AND pg_catalog.pg_get_constraintdef(k.oid) = 'CHECK ((subject_kind = ANY (ARRAY[''RESPONSIBILITY_ASSIGNMENT''::text, ''BUSINESS_CONTEXT_ASSIGNMENT''::text, ''POLICY_APPLICABILITY''::text])))')
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint AS k WHERE k.conrelid = v_facts AND k.contype = 'c'
                      AND k.conname = 'l14_fact_states_interval_check'
                      AND pg_catalog.pg_get_constraintdef(k.oid) = 'CHECK (((effective_to IS NULL) OR ((state_kind = ''VALIDATED''::text) AND (effective_to > effective_from))))')
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint AS k WHERE k.conrelid = 'gov_repo.l14_authorization_decisions'::regclass
                      AND k.contype = 'c' AND k.convalidated AND k.conname = 'l14_authorization_decisions_policy_applicability_target_check'
                      AND pg_catalog.pg_get_constraintdef(k.oid) LIKE '%scope_tag = ANY (ARRAY[''CANONICAL_OBJECT''::text, ''RELATIONSHIP_STATE''::text])%')
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint AS k WHERE k.conrelid = 'gov_repo.l14_authorization_decisions'::regclass
                      AND k.contype = 'c' AND k.convalidated AND k.conname = 'l14_authorization_decisions_business_context_target_check')
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint AS k WHERE k.conrelid = 'gov_repo.l14_authorization_decisions'::regclass
                      AND k.contype = 'c' AND k.convalidated AND k.conname = 'l14_authorization_decisions_responsibility_target_check') THEN
    RAISE EXCEPTION 'M16_S1C3_POSTFLIGHT: the closed target union, outcome, fact subject, interval or authorization target rule was relaxed';
  END IF;
  -- The widened fact guard admits exactly the three implemented families; the SHARED dependency guard uses the exact
  -- S1B.4 key (no new namespace, shared mode, no table access); the S1B.4 key producer is unchanged.
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc AS p
                 WHERE p.oid = 'gov_repo.l14_lock_fact_subject_guard_v1(uuid,text,text[])'::regprocedure
                   AND p.prosrc LIKE '%p_subject_kind NOT IN (''RESPONSIBILITY_ASSIGNMENT'',''BUSINESS_CONTEXT_ASSIGNMENT'',''POLICY_APPLICABILITY'')%'
                   AND p.prosrc NOT LIKE '%CONTROL_%')
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc AS p
                    WHERE p.oid = 'gov_repo.l14_lock_policy_version_dependency_guard_shared_v1(uuid,uuid,uuid,text)'::regprocedure
                      AND NOT p.prosecdef AND p.prosrc LIKE '%pg_advisory_xact_lock_shared(%'
                      AND p.prosrc NOT LIKE '%pg_advisory_xact_lock(%'
                      AND p.prosrc LIKE '%ARRAY[p_organisation_id::text, ''l14-registry-subject-guard-v1'', ''POLICY_VERSION'',
      ''POLICY_VERSION_VALIDATION:'' || p_policy_id::text || '':'' || p_version_id::text || '':'' || p_content_hash]%'
                      AND p.prosrc !~* '(\mFROM\M|\mINSERT\M|\mUPDATE\M|\mDELETE\M)')
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc AS p
                    WHERE p.oid = 'gov_repo.l14_lock_registry_subject_guard_v1(uuid,text,text)'::regprocedure
                      AND p.prosrc LIKE '%ARRAY[p_organisation_id::text, ''l14-registry-subject-guard-v1'', p_subject_kind, p_subject_key]%')
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc AS p
                    WHERE p.oid = 'gov_repo.l14_decide_policy_version_proposal_v1(uuid,uuid,bigint,bigint,timestamp with time zone,text,uuid,text,text,uuid,text,text[],text)'::regprocedure
                      AND p.prosrc LIKE '%''POLICY_VERSION_VALIDATION:'' || v_proposal.policy_id::text || '':'' || v_proposal.version_id::text || '':''%') THEN
    RAISE EXCEPTION 'M16_S1C3_POSTFLIGHT: the fact guard subject vocabulary or the shared POLICY_VERSION dependency guard key drifted';
  END IF;
  -- Lock order of DECIDE: AP SHARED -> (VALIDATE) POLICY_VERSION dependency SHARED -> fact KEY -> command.
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc AS p
                 WHERE p.oid = 'gov_repo.l14_decide_policy_applicability_proposal_v1(uuid,uuid,bigint,bigint,timestamp with time zone,text,uuid,text,text,uuid,text,text[],text)'::regprocedure
                   AND pg_catalog.strpos(p.prosrc, 'l14_lock_authority_policy_guard_shared_v1(v_org)') > 0
                   AND pg_catalog.strpos(p.prosrc, 'l14_lock_authority_policy_guard_shared_v1(v_org)')
                       < pg_catalog.strpos(p.prosrc, 'IF p_outcome = ''VALIDATE'' THEN
    PERFORM gov_repo.l14_lock_policy_version_dependency_guard_shared_v1(')
                   AND pg_catalog.strpos(p.prosrc, 'l14_lock_policy_version_dependency_guard_shared_v1(')
                       < pg_catalog.strpos(p.prosrc, 'l14_lock_fact_subject_guard_v1(v_org, ''POLICY_APPLICABILITY''')
                   AND pg_catalog.strpos(p.prosrc, 'l14_lock_fact_subject_guard_v1(v_org, ''POLICY_APPLICABILITY''')
                       < pg_catalog.strpos(p.prosrc, 'l14_lock_command_guard_v1(v_org, p_command_id)')
                   AND pg_catalog.strpos(p.prosrc, 'l14_lock_command_guard_v1(v_org, p_command_id)')
                       < pg_catalog.strpos(p.prosrc, 'l14_replay_arbitrate_v1')) THEN
    RAISE EXCEPTION 'M16_S1C3_POSTFLIGHT: policy applicability decide lock order drifted';
  END IF;
  IF (SELECT pg_catalog.count(*) FROM pg_catalog.pg_trigger AS t
      WHERE t.tgenabled = 'A' AND NOT t.tgisinternal AND (
        (t.tgrelid = v_states AND t.tgname = 'l14_policy_applicability_states_guard'
          AND t.tgfoid = 'gov_repo.l14_policy_applicability_state_guard_v1()'::regprocedure)
        OR (t.tgrelid = v_proposals AND t.tgname = 'l14_policy_applicability_proposals_guard'
          AND t.tgfoid = 'gov_repo.l14_policy_applicability_proposal_guard_v1()'::regprocedure)
        OR (t.tgrelid = v_heads AND t.tgname IN ('l14_policy_applicability_heads_guard','l14_policy_applicability_heads_no_truncate')
          AND t.tgfoid = 'gov_repo.l14_policy_applicability_head_guard_v1()'::regprocedure))) <> 4 THEN
    RAISE EXCEPTION 'M16_S1C3_POSTFLIGHT: S1C.3 structural guard missing or not ALWAYS';
  END IF;
  IF (SELECT pg_catalog.array_agg(k.conname::text ORDER BY k.conname::text COLLATE "C") FROM pg_catalog.pg_constraint AS k
      WHERE k.contype = 'f' AND k.conrelid = ANY (v_new_tables)
        AND k.confdeltype IN ('a','r') AND k.confupdtype IN ('a','r') AND k.convalidated
        AND NOT k.condeferrable AND NOT k.condeferred) IS DISTINCT FROM ARRAY[
       'l14_policy_applicability_heads_policy_fkey','l14_policy_applicability_heads_state_fkey',
       'l14_policy_applicability_heads_target_object_fkey',
       'l14_policy_applicability_proposals_envelope_fkey','l14_policy_applicability_proposals_policy_version_fkey',
       'l14_policy_applicability_proposals_target_object_fkey','l14_policy_applicability_proposals_target_state_fkey',
       'l14_policy_applicability_states_envelope_fkey','l14_policy_applicability_states_policy_version_fkey',
       'l14_policy_applicability_states_predecessor_fkey','l14_policy_applicability_states_revokes_fkey',
       'l14_policy_applicability_states_target_object_fkey']
     OR (SELECT pg_catalog.count(*) FROM pg_catalog.pg_constraint AS k WHERE k.contype = 'f' AND k.conrelid = ANY (v_new_tables)) <> 12
     OR (SELECT pg_catalog.count(*) FROM pg_catalog.pg_constraint AS k
         WHERE k.contype = 'f' AND k.conrelid IN (v_states, v_proposals) AND k.confmatchtype = 's'
           AND k.conname IN ('l14_policy_applicability_states_policy_version_fkey','l14_policy_applicability_proposals_policy_version_fkey')
           AND k.confrelid = 'gov_repo.l14_policy_version_states'::regclass AND pg_catalog.cardinality(k.conkey) = 6
           AND (SELECT pg_catalog.array_agg(att.attname::text ORDER BY u.ord)
                FROM pg_catalog.unnest(k.confkey) WITH ORDINALITY AS u(attnum, ord)
                JOIN pg_catalog.pg_attribute AS att ON att.attrelid = k.confrelid AND att.attnum = u.attnum)
               = ARRAY['organisation_id','state_id','policy_id','version_id','content_hash','state_kind']::text[]) <> 2
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_attribute AS att
                WHERE att.attrelid IN (v_states, v_proposals)
                  AND att.attname IN ('policy_id','version_id','content_hash','policy_version_validated_state_id','policy_version_state_kind')
                  AND NOT att.attnotnull)
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
    RAISE EXCEPTION 'M16_S1C3_POSTFLIGHT: S1C.3 FK set wrong (missing, weakened, deferred, cascading or dependency FK not exact)';
  END IF;
  IF (SELECT pg_catalog.count(*) FROM pg_catalog.pg_indexes AS i
      WHERE i.schemaname = 'gov_repo' AND i.indexname IN ('l14_fact_states_revocation_target_uidx',
        'l14_policy_applicability_states_root_uidx','l14_policy_applicability_states_successor_uidx',
        'l14_support_links_fact_state_uidx')) <> 4
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint AS k WHERE k.conrelid = v_facts AND k.contype = 'u'
                      AND k.conname = 'l14_fact_states_successor_unique') THEN
    RAISE EXCEPTION 'M16_S1C3_POSTFLIGHT: linear fact lineage keys missing';
  END IF;

  -- H4. Exact INPUT parameters: the caller can never choose organisation, actor, role, a relationship type, a free-text
  --     rationale, JSON or any value beyond the closed command shape.
  FOR v_entry IN
    SELECT m.sig, m.args FROM (VALUES
      ('gov_repo.l14_submit_policy_applicability_proposal_v1(uuid,uuid,bigint,bigint,timestamp with time zone,text,text,text,text,text,text,text,text,uuid,uuid,text,uuid,text,timestamp with time zone,timestamp with time zone,uuid,uuid,text,text[],text)',
       'p_verified_organisation_id,p_verified_actor_user_id,p_verified_session_iat,p_verified_session_exp,p_verified_credential_epoch,p_command_id,p_intent,p_source_class,p_target_type,p_target_canonical_kind,p_target_canonical_object_id,p_target_relationship_id,p_target_relationship_state_id,p_policy_id,p_version_id,p_content_hash,p_policy_version_validated_state_id,p_applicability,p_requested_effective_from,p_requested_effective_to,p_target_state_id,p_prior_proposal_id,p_support_status,p_support_evidence_ids,p_caller_fingerprint'),
      ('gov_repo.l14_decide_policy_applicability_proposal_v1(uuid,uuid,bigint,bigint,timestamp with time zone,text,uuid,text,text,uuid,text,text[],text)',
       'p_verified_organisation_id,p_verified_actor_user_id,p_verified_session_iat,p_verified_session_exp,p_verified_credential_epoch,p_command_id,p_proposal_id,p_outcome,p_reason_code,p_expected_current_state_id,p_support_status,p_support_evidence_ids,p_caller_fingerprint')
    ) AS m(sig, args)
  LOOP
    IF (SELECT pg_catalog.string_agg(a.name, ',' ORDER BY a.ord)
        FROM pg_catalog.pg_proc AS p
        CROSS JOIN LATERAL ROWS FROM (pg_catalog.unnest(p.proargnames), pg_catalog.unnest(p.proargmodes)) WITH ORDINALITY AS a(name, mode, ord)
        WHERE p.oid = pg_catalog.to_regprocedure(v_entry.sig) AND a.mode IN ('i','b','v')) IS DISTINCT FROM v_entry.args THEN
      RAISE EXCEPTION 'M16_S1C3_POSTFLIGHT: % input parameters are not exactly the closed command shape', v_entry.sig;
    END IF;
  END LOOP;

  -- H5. New SQL never touches the policy content stores directly (only the S1B.3 / S1B.4 admission + validation lineage
  --     and resolver, read-only), never current_version_id / legacy status / approval / mappings / scanner / LLM surfaces,
  --     never the Party / domain / control-definition registries or another fact family; canonical_relationships is read
  --     ONLY by the exact-triple resolver; no new routine mutates any registry / identity / policy / canonical surface.
  FOR v_fn IN
    SELECT p.oid, p.proname, p.prosrc FROM pg_catalog.pg_proc AS p
    WHERE p.pronamespace = 'gov_repo'::regnamespace
      AND (p.proname::text = ANY (v_new_routines) OR p.proname = 'l14_lock_fact_subject_guard_v1')
  LOOP
    IF v_fn.prosrc ~ '(^|[^A-Za-z0-9_$])(governance_policies|policy_versions)([^A-Za-z0-9_$]|$)'
       OR v_fn.prosrc ~* '(content_markdown|current_version_id|change_summary|version_number|version_label|policy_mandate_mappings|mandates)' THEN
      RAISE EXCEPTION 'M16_S1C3_POSTFLIGHT: % reaches a policy content store / legacy pointer / mapping surface', v_fn.proname;
    END IF;
    IF v_fn.prosrc ~ '(l14_control_definition|l14_domain_|l14_governance_part|l14_responsibility_|l14_business_context_|CONTROL_APPLICABILITY|CONTROL_ASSESSMENT)' THEN
      RAISE EXCEPTION 'M16_S1C3_POSTFLIGHT: % reaches another registry, another fact family or an unimplemented family', v_fn.proname;
    END IF;
    IF v_fn.prosrc ~* '(directory_profile|display_name|\memail\M|\mphone\M|profile_text|external_identity_ref|governance_users|full_name)' THEN
      RAISE EXCEPTION 'M16_S1C3_POSTFLIGHT: % reaches PII / a governance-user identity', v_fn.proname;
    END IF;
    IF v_fn.prosrc ~ '(\mlabel\M|\mdescription\M|classif|\mtags\M|semantic_representation)'
       OR v_fn.prosrc ~* '(owner_user_id|owner_email|\mowner_id\M|approved_by|approval_date|reviewed_by|approver_user_id|qes_signature_id|ledger_entry_seq|\mstatus\M|effective_date|expiry_date)' THEN
      RAISE EXCEPTION 'M16_S1C3_POSTFLIGHT: % references legacy label / classification / owner / status / approval fields', v_fn.proname;
    END IF;
    IF v_fn.prosrc ~* '(\mcg_|cg-ag|\magents\M|agent_resource_links|ai_systems|\mrisk|coverage|maturity|severity|\mweight|\mscore|waiver|confidence|scanner|\mllm\M|similarity|embedding)' THEN
      RAISE EXCEPTION 'M16_S1C3_POSTFLIGHT: % reaches a CG-AG flag / legacy registry / scanner / score / similarity surface', v_fn.proname;
    END IF;
    IF v_fn.prosrc ~ 'canonical_relationships' AND v_fn.proname <> 'l14_resolve_relationship_state_target_v1' THEN
      RAISE EXCEPTION 'M16_S1C3_POSTFLIGHT: % reads canonical relationships outside the exact-triple resolver', v_fn.proname;
    END IF;
    IF v_fn.prosrc ~* '(INSERT\s+INTO|UPDATE|DELETE\s+FROM|TRUNCATE|ALTER\s+TABLE)\s+(gov_repo\.)?(l14_policy_admissions|l14_policy_version_|l14_registry_states|l14_authority_policy|l14_governance_part|l14_domain_|l14_control_definition|l14_responsibility_|l14_business_context_|governance_policies|policy_versions|governance_users|governance_roles|organisations|discovery_evidence|canonical_objects|canonical_relationships)' THEN
      RAISE EXCEPTION 'M16_S1C3_POSTFLIGHT: % mutates a registry / policy / identity / evidence / canonical surface outside S1C.3', v_fn.proname;
    END IF;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc AS p
                 WHERE p.oid = 'gov_repo.l14_resolve_relationship_state_target_v1(uuid,text,text)'::regprocedure
                   AND p.provolatile = 's' AND NOT p.prosecdef
                   AND p.prosrc LIKE '%cr.organisation_id = p_organisation_id AND cr.relationship_id = p_relationship_id%'
                   AND p.prosrc LIKE '%cr.relationship_state_id = p_relationship_state_id%'
                   AND p.prosrc LIKE '%CASE WHEN pg_catalog.count(*) = 1 THEN%'
                   AND p.prosrc !~* '(\mINSERT\M|\mUPDATE\M|\mDELETE\M|\mORDER\M|\mLIMIT\M|valid_to|valid_from|recorded_at)') THEN
    RAISE EXCEPTION 'M16_S1C3_POSTFLIGHT: the exact relationship-state resolver drifted (latest / current inference or mutation)';
  END IF;

  -- H6. Every l14 routine: pinned search_path, no PUBLIC/anon/authenticated EXECUTE; the twenty-three public RPCs are
  --     SECURITY DEFINER + service_role-only; every other l14 routine is an owner-only SECURITY INVOKER helper.
  FOR v_fn IN
    SELECT p.oid, p.proname, p.proowner, p.proacl, p.prosecdef, p.proconfig
    FROM pg_catalog.pg_proc AS p
    WHERE p.pronamespace = 'gov_repo'::regnamespace AND p.proname LIKE 'l14\_%' ESCAPE '\'
  LOOP
    IF EXISTS (SELECT 1 FROM pg_catalog.aclexplode(COALESCE(v_fn.proacl, pg_catalog.acldefault('f', v_fn.proowner))) AS a
               WHERE a.privilege_type = 'EXECUTE' AND a.grantee = 0) THEN
      RAISE EXCEPTION 'M16_S1C3_POSTFLIGHT: % has PUBLIC EXECUTE', v_fn.proname;
    END IF;
    FOREACH v_role IN ARRAY ARRAY['anon','authenticated'] LOOP
      IF pg_catalog.has_function_privilege(v_role, v_fn.oid, 'EXECUTE') THEN
        RAISE EXCEPTION 'M16_S1C3_POSTFLIGHT: % executable by %', v_fn.proname, v_role;
      END IF;
    END LOOP;
    IF NOT COALESCE(v_fn.proconfig @> ARRAY['search_path=pg_catalog, pg_temp'], false) THEN
      RAISE EXCEPTION 'M16_S1C3_POSTFLIGHT: % search_path not pinned to pg_catalog, pg_temp', v_fn.proname;
    END IF;
    IF v_fn.proname::text = ANY (v_public_l14) THEN
      IF NOT v_fn.prosecdef OR NOT pg_catalog.has_function_privilege('service_role', v_fn.oid, 'EXECUTE')
         OR EXISTS (SELECT 1 FROM pg_catalog.aclexplode(v_fn.proacl) AS a
                    WHERE a.grantee NOT IN (v_fn.proowner, 'service_role'::regrole::oid)) THEN
        RAISE EXCEPTION 'M16_S1C3_POSTFLIGHT: public RPC % ACL/definer shape wrong', v_fn.proname;
      END IF;
    ELSIF v_fn.prosecdef OR EXISTS (SELECT 1 FROM pg_catalog.aclexplode(COALESCE(v_fn.proacl,
            pg_catalog.acldefault('f', v_fn.proowner))) AS a WHERE a.grantee <> v_fn.proowner) THEN
      RAISE EXCEPTION 'M16_S1C3_POSTFLIGHT: internal helper % must be owner-only SECURITY INVOKER', v_fn.proname;
    END IF;
  END LOOP;
  IF (SELECT pg_catalog.array_agg(p.proname::text ORDER BY p.proname::text COLLATE "C") FROM pg_catalog.pg_proc AS p
      WHERE p.pronamespace = 'gov_repo'::regnamespace AND p.proname LIKE 'l14\_%' ESCAPE '\'
        AND pg_catalog.has_function_privilege('service_role', p.oid, 'EXECUTE')) IS DISTINCT FROM v_public_l14
     OR (SELECT pg_catalog.count(*) FROM pg_catalog.pg_proc AS p
         WHERE p.pronamespace = 'gov_repo'::regnamespace AND p.proname LIKE 'l14\_%' ESCAPE '\' AND p.prosecdef) <> 23
     OR (SELECT pg_catalog.count(*) FROM pg_catalog.pg_proc AS p
         WHERE p.pronamespace = 'gov_repo'::regnamespace AND p.proname::text = ANY (v_new_routines)) <> 12
     OR (SELECT pg_catalog.count(*) FROM pg_catalog.pg_proc AS p
         WHERE p.pronamespace = 'gov_repo'::regnamespace AND p.proname = 'l14_lock_fact_subject_guard_v1') <> 1
     OR (SELECT pg_catalog.count(*) FROM pg_catalog.pg_proc AS p
         WHERE p.pronamespace = 'gov_repo'::regnamespace AND p.proname = 'l14_evaluate_target_authority_rules_v1') <> 1 THEN
    RAISE EXCEPTION 'M16_S1C3_POSTFLIGHT: the public L14 RPC surface must be exactly the twenty-one post-S1C.1R1 + two S1C.3 RPCs (no overloads)';
  END IF;

  -- H7. Closed application SECURITY DEFINER surface on the post-S1C.3 catalog: exactly 39 approved identities (exact owner
  --     class, body hash, config, service_role-only EXECUTE, no overload); exactly 29 canonical-owner (policy-store-
  --     capable) definers. The capability class reflects OWNER capability, not body-level need: the two S1C.3 bodies are
  --     proven above (H5) and below never to reach a policy store.
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
      ('gov_repo.l14_submit_policy_applicability_proposal_v1(uuid,uuid,bigint,bigint,timestamp with time zone,text,text,text,text,text,text,text,text,uuid,uuid,text,uuid,text,timestamp with time zone,timestamp with time zone,uuid,uuid,text,text[],text)', 'postgres', '6bc42426707202ac00d42046cd8905c999194c3d9c0f92c29357583d44903716', 'search_path=pg_catalog, pg_temp;lock_timeout=5s'),
      ('gov_repo.l14_decide_policy_applicability_proposal_v1(uuid,uuid,bigint,bigint,timestamp with time zone,text,uuid,text,text,uuid,text,text[],text)', 'postgres', 'd57f98a41d458e73597908308dcd246e78076d6d46af9001ab4114ce5865c327', 'search_path=pg_catalog, pg_temp;lock_timeout=5s'),
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
      RAISE EXCEPTION 'M16_S1C3_POSTFLIGHT: approved routine % missing', v_entry.sig;
    END IF;
    SELECT p.proname, p.pronamespace, p.prosecdef, p.proowner, p.prosrc, p.proconfig, p.proacl INTO v_proc
    FROM pg_catalog.pg_proc AS p WHERE p.oid = v_oid;
    IF NOT v_proc.prosecdef THEN
      RAISE EXCEPTION 'M16_S1C3_POSTFLIGHT: % is not SECURITY DEFINER', v_oid::regprocedure;
    END IF;
    IF pg_catalog.pg_get_userbyid(v_proc.proowner) <> v_entry.owner_role THEN
      RAISE EXCEPTION 'M16_S1C3_POSTFLIGHT: % owner % is not %', v_oid::regprocedure, pg_catalog.pg_get_userbyid(v_proc.proowner), v_entry.owner_role;
    END IF;
    IF pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(v_proc.prosrc, 'UTF8')), 'hex') <> v_entry.sha THEN
      RAISE EXCEPTION 'M16_S1C3_POSTFLIGHT: % body hash changed', v_oid::regprocedure;
    END IF;
    IF COALESCE(pg_catalog.array_to_string(v_proc.proconfig, ';'), '-') <>
       pg_catalog.replace(pg_catalog.replace(v_entry.cfg, '{crypto}', pg_catalog.quote_ident(v_crypto)), '{vschema}', pg_catalog.quote_ident(v_vector)) THEN
      RAISE EXCEPTION 'M16_S1C3_POSTFLIGHT: % config changed: %', v_oid::regprocedure, v_proc.proconfig;
    END IF;
    IF NOT pg_catalog.has_function_privilege('service_role', v_oid, 'EXECUTE')
       OR pg_catalog.has_function_privilege('anon', v_oid, 'EXECUTE')
       OR pg_catalog.has_function_privilege('authenticated', v_oid, 'EXECUTE')
       OR EXISTS (SELECT 1 FROM pg_catalog.aclexplode(COALESCE(v_proc.proacl, pg_catalog.acldefault('f', v_proc.proowner))) AS a
                  WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE') THEN
      RAISE EXCEPTION 'M16_S1C3_POSTFLIGHT: % application EXECUTE is not exactly service_role', v_oid::regprocedure;
    END IF;
    IF v_proc.proname::text = ANY (v_new_rpcs)
       AND EXISTS (SELECT 1 FROM pg_catalog.aclexplode(v_proc.proacl) AS a
                   WHERE a.grantee NOT IN (v_proc.proowner, 'service_role'::regrole::oid) OR (a.grantee = 'service_role'::regrole::oid AND a.privilege_type <> 'EXECUTE')) THEN
      RAISE EXCEPTION 'M16_S1C3_POSTFLIGHT: % EXECUTE ACL is not exactly owner + service_role', v_oid::regprocedure;
    END IF;
    IF (SELECT pg_catalog.count(*) FROM pg_catalog.pg_proc AS p WHERE p.pronamespace = v_proc.pronamespace AND p.proname = v_proc.proname) <> 1 THEN
      RAISE EXCEPTION 'M16_S1C3_POSTFLIGHT: overload of approved routine %', v_oid::regprocedure;
    END IF;
    v_approved := v_approved || v_oid;
    IF v_entry.owner_role = 'postgres' THEN
      IF v_proc.proowner <> ALL (v_capable) THEN
        RAISE EXCEPTION 'M16_S1C3_POSTFLIGHT: canonical L14/S0 owner of % unexpectedly lost policy-store capability', v_oid::regprocedure;
      END IF;
      v_frozen := v_frozen || v_oid;
    ELSIF v_proc.proowner = ANY (v_capable) THEN
      RAISE EXCEPTION 'M16_S1C3_POSTFLIGHT: owner of % has policy-store capability', v_oid::regprocedure;
    END IF;
  END LOOP;
  IF pg_catalog.cardinality(v_approved) <> 39 OR pg_catalog.cardinality(v_frozen) <> 29 THEN
    RAISE EXCEPTION 'M16_S1C3_POSTFLIGHT: approved surface is not exactly 39 (29 policy-store-capable)';
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
      RAISE EXCEPTION 'M16_S1C3_POSTFLIGHT: CLOSED_SURFACE unapproved application-executable SECURITY DEFINER %', v_row.oid::regprocedure;
    END IF;
    IF v_row.proowner = ANY (v_capable) AND v_row.oid <> ALL (v_frozen) THEN
      RAISE EXCEPTION 'M16_S1C3_POSTFLIGHT: POLICY_STORE_OWNER application definer % outside the approved 29', v_row.oid::regprocedure;
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
                          WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE'))) <> 39 THEN
    RAISE EXCEPTION 'M16_S1C3_POSTFLIGHT: application SECURITY DEFINER surface is not exactly 39';
  END IF;
  -- Every application definer that can reach a policy store is one of the 29 approved canonical-owner RPCs (no S1C.3
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
      RAISE EXCEPTION 'M16_S1C3_POSTFLIGHT: application definer % reaches a policy store outside the approved 29', v_fn.oid::regprocedure;
    END IF;
    IF v_fn.proname::text = ANY (v_new_rpcs) THEN
      RAISE EXCEPTION 'M16_S1C3_POSTFLIGHT: S1C.3 RPC % reaches a policy store', v_fn.oid::regprocedure;
    END IF;
  END LOOP;

  -- H8. Default privileges: postgres-created routines (global + gov_repo) grant EXECUTE to neither PUBLIC nor an
  --     application role.
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_default_acl AS d
                 WHERE d.defaclrole = 'postgres'::regrole AND d.defaclnamespace = 0 AND d.defaclobjtype = 'f')
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_default_acl AS d CROSS JOIN LATERAL pg_catalog.aclexplode(d.defaclacl) AS a
                WHERE d.defaclrole = 'postgres'::regrole AND d.defaclobjtype = 'f' AND a.privilege_type = 'EXECUTE'
                  AND d.defaclnamespace IN (0, 'gov_repo'::regnamespace)
                  AND (a.grantee = 0 OR a.grantee IN (SELECT r.oid FROM pg_catalog.pg_roles AS r WHERE r.rolname = ANY (v_app)))) THEN
    RAISE EXCEPTION 'M16_S1C3_POSTFLIGHT: postgres routine default privileges grant PUBLIC / application EXECUTE';
  END IF;

  -- H9. No inheritance, no readable/writable view leak and no sequence leak into the stores, the admission lineages, the
  --     S1B.4 / S1B.5 / S1B.6 history or the S1C.1 / S1C.2 / S1C.3 fact history (any schema, transitive).
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_inherits AS i WHERE i.inhrelid = ANY (v_guarded) OR i.inhparent = ANY (v_guarded)) THEN
    RAISE EXCEPTION 'M16_S1C3_POSTFLIGHT: inheritance involves a policy store, an admission lineage or guarded history';
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
      RAISE EXCEPTION 'M16_S1C3_POSTFLIGHT: view % reaching guarded history has a PUBLIC grant', v_rel.relname;
    END IF;
    FOREACH v_role IN ARRAY v_app LOOP
      FOREACH v_privilege IN ARRAY v_privileges LOOP
        IF pg_catalog.has_table_privilege(v_role, v_rel.oid, v_privilege) THEN
          RAISE EXCEPTION 'M16_S1C3_POSTFLIGHT: % holds % on view % reaching guarded history', v_role, v_privilege, v_rel.relname;
        END IF;
      END LOOP;
      IF pg_catalog.has_any_column_privilege(v_role, v_rel.oid, 'SELECT, INSERT, UPDATE, REFERENCES') THEN
        RAISE EXCEPTION 'M16_S1C3_POSTFLIGHT: % holds a column privilege on view % reaching guarded history', v_role, v_rel.relname;
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
        RAISE EXCEPTION 'M16_S1C3_POSTFLIGHT: % holds a privilege on sequence %', v_role, v_rel.relname;
      END IF;
    END LOOP;
  END LOOP;

  -- H10. Frozen enumerations: exactly 11 canonical object kinds and 12 governed relationship types; POLICY_APPLICABILITY is
  --      not canonical and no APPLIES_POLICY / SUBJECT_TO_POLICY / GOVERNED_BY_POLICY type exists.
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
    RAISE EXCEPTION 'M16_S1C3_POSTFLIGHT: canonical object kinds (11) / governed relationship types (12) changed';
  END IF;

  -- H11. F2: nothing on the L14 / policy surface references canonical_relationships by FK; no l14 routine is a trigger on
  --      it; no uniqueness / index involves relationship_state_id on it; it carries no trigger at all.
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_constraint AS k
             WHERE k.confrelid = 'gov_repo.canonical_relationships'::regclass
               AND (k.conrelid = ANY (v_stores)
                    OR k.conrelid IN (SELECT c.oid FROM pg_catalog.pg_class AS c
                                      WHERE c.relnamespace = 'gov_repo'::regnamespace AND c.relname LIKE 'l14\_%' ESCAPE '\')))
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_trigger AS t WHERE t.tgrelid = 'gov_repo.canonical_relationships'::regclass AND NOT t.tgisinternal)
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_index AS i JOIN pg_catalog.pg_attribute AS att
                  ON att.attrelid = i.indrelid AND att.attnum = ANY (i.indkey::int2[])
                WHERE i.indrelid = 'gov_repo.canonical_relationships'::regclass AND att.attname = 'relationship_state_id')
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_constraint AS k
                WHERE k.conrelid = 'gov_repo.canonical_relationships'::regclass
                  AND pg_catalog.pg_get_constraintdef(k.oid) LIKE '%relationship_state_id%') THEN
    RAISE EXCEPTION 'M16_S1C3_POSTFLIGHT: F2 boundary violated';
  END IF;

  -- H12. S0 wrapper/eligibility naming contracts stay intact.
  IF (SELECT pg_catalog.count(*) FROM pg_catalog.pg_proc AS p WHERE p.pronamespace = 'gov_repo'::regnamespace
        AND p.proname IN ('apply_review_transition_governed_v1','record_authorized_reconciliation_governed_v1',
                          'materialize_object_reconciliation_governed_v1','materialize_relationship_reconciliation_governed_v1',
                          'record_technical_field_decision_governed_v1','record_execution_field_decision_governed_v1')) <> 6
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_proc AS p WHERE p.pronamespace = 'gov_repo'::regnamespace
        AND p.proname LIKE 'l14\_%' ESCAPE '\' AND (p.proname LIKE '%eligibility%' OR p.proname LIKE '%governed%')) THEN
    RAISE EXCEPTION 'M16_S1C3_POSTFLIGHT: S0 naming contract disturbed';
  END IF;
END;
$postflight$;

COMMIT;
