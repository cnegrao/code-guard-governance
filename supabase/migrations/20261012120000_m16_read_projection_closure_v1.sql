-- M16 read-projection closure (corrective slice; DB only, ADDITIVE on the merged S1C.5 catalog).
-- Architecture: docs/architecture/ADR-GOVIA-OWNERSHIP-BUSINESS-POLICY-CONTROL-ENRICHMENT-v1.md §§3, 7, 15, 18.1, 18.2, 20, 22
-- (O32, O41). No historical migration is edited. Never run against a hosted DB from this slice.
--
-- Closes two formal-closure conformance blockers WITHOUT a new fact family, a second truth store, a direct authority-table
-- grant or any write path:
--   * O32 / ADR §22 — Passport families 3 / 4 / 12 / 14 must consume CURRENT VALID M16 governed facts. The S1C.1 .. S1C.5
--     exact bitemporal resolvers / bounded current reads are owner-only and service_role holds no privilege on any L14 table;
--     that stays so. ONE read-only, tenant-scoped SECURITY DEFINER projection (l14_read_passport_governance_v1) composes the
--     EXISTING owner-only bounded current reads for the exact AGENT (families 3, 4, 12) and, when selected, the exact
--     AGENT_VERSION (family 12 only), at ONE pair of effective / recorded coordinates, and returns each rendered fact with its
--     exact M16 lineage (fact state, governance decision, authorization decision, Authority Policy basis, exact pinned
--     dependency, normalized support evidence ids, temporal coordinates) for family 14. Absence of a row = UNKNOWN.
--   * O41 / ADR §18.2 — ONE read-only, tenant-scoped SECURITY DEFINER conflict projection (l14_read_fact_conflict_v1) over ONE
--     exact logical fact key of ONE of the five closed fact families. Closed outcomes exactly RESOLVED | CONFLICT |
--     INSUFFICIENT_EVIDENCE:
--       RESOLVED              the family's EXISTING exact resolver returns the current governed fact at the coordinates;
--       CONFLICT              no such fact, and the LIVE VALIDATE-intent proposals of the exact key carry >= 2 distinct typed
--                             asserted contents;
--       INSUFFICIENT_EVIDENCE otherwise (no fact and < 2 distinct typed asserted contents).
--     LIVE = typed VALIDATE-intent proposal of the exact key, submitted_at <= recorded cutoff, without a terminal (VALIDATE /
--     REJECT) governance decision decided_at <= recorded cutoff (ADR §7.2: DEFER is non-terminal). Typed asserted content =
--     every typed proposal field other than the logical key, the intent and process metadata (the same closed typed columns
--     the family's proposal table models), compared by exact typed equality through a length-framed digest — never free
--     text, never a ranking: confidence, recency, source class, support status or submitter never select a winner.
--
-- Both projections: postgres-owned, SECURITY DEFINER, search_path pinned to pg_catalog, pg_temp, fully qualified objects,
-- EXECUTE revoked from PUBLIC / anon / authenticated and granted ONLY to service_role; the tenant is ONLY the verified
-- principal (base session eligibility revalidated through the one canonical S1A helper on every call); no INSERT / UPDATE /
-- DELETE / head / history / state / proposal / decision write; no new table, view, sequence, type, trigger or column; no
-- reused routine is replaced. Application SECURITY DEFINER surface 43 -> 45; canonical-owner class 33 -> 35.
-- F2 untouched: no canonical_relationships DDL / DML / FK / trigger.
BEGIN;

-- ---------------------------------------------------------------------------------------
-- A. Preflight: the exact merged S1C.5 catalog, or abort with nothing applied.
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
    RAISE EXCEPTION 'M16_RP_PREFLIGHT: PostgreSQL 17 required' USING ERRCODE = '55000';
  END IF;
  IF v_crypto IS NULL OR v_vector IS NULL THEN
    RAISE EXCEPTION 'M16_RP_PREFLIGHT: pgcrypto / vector unresolved' USING ERRCODE = '55000';
  END IF;
  -- Exact post-S1C.5 l14 relation set (no relation is added by this slice).
  IF (SELECT pg_catalog.array_agg(c.relname::text ORDER BY c.relname::text COLLATE "C")
      FROM pg_catalog.pg_class AS c
      WHERE c.relnamespace = 'gov_repo'::regnamespace AND c.relname LIKE 'l14\_%' ESCAPE '\'
        AND c.relkind IN ('r','p','v','m','S','f')) IS DISTINCT FROM ARRAY[
    'l14_authority_policies','l14_authority_policy_heads','l14_authority_policy_rules',
    'l14_authority_policy_states','l14_authority_policy_version_proposals','l14_authority_policy_versions',
    'l14_authorization_decision_roles','l14_authorization_decision_rules','l14_authorization_decisions',
    'l14_business_context_assignment_heads','l14_business_context_assignment_proposals',
    'l14_business_context_assignment_states','l14_command_results','l14_control_applicability_heads',
    'l14_control_applicability_proposals','l14_control_applicability_states','l14_control_assessment_heads',
    'l14_control_assessment_proposals','l14_control_assessment_states','l14_control_definition_heads',
    'l14_control_definition_proposals','l14_control_definition_states','l14_control_definition_versions',
    'l14_control_definitions','l14_domain_admissions','l14_domain_heads','l14_domain_proposals','l14_domain_states',
    'l14_fact_states','l14_governance_decisions','l14_governance_parties','l14_governance_party_heads',
    'l14_governance_party_proposals','l14_governance_party_states','l14_policy_admissions',
    'l14_policy_applicability_heads','l14_policy_applicability_proposals','l14_policy_applicability_states',
    'l14_policy_version_admissions','l14_policy_version_heads','l14_policy_version_proposals',
    'l14_policy_version_states','l14_proposals','l14_registry_states','l14_responsibility_assignment_heads',
    'l14_responsibility_assignment_proposals','l14_responsibility_assignment_states','l14_support_links'] THEN
    RAISE EXCEPTION 'M16_RP_PREFLIGHT: unexpected l14 relation set (post-S1C.5 horizon expected)' USING ERRCODE = '55000';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_proc AS p WHERE p.pronamespace = 'gov_repo'::regnamespace
             AND p.proname IN ('l14_read_passport_governance_v1','l14_read_fact_conflict_v1')) THEN
    RAISE EXCEPTION 'M16_RP_PREFLIGHT: a read-projection routine already exists' USING ERRCODE = '55000';
  END IF;
  -- The reused exact resolvers / bounded current reads exist as owner-only SECURITY INVOKER helpers.
  FOR v_entry IN
    SELECT s.sig FROM (VALUES
      ('gov_repo.l14_session_basis_v1(uuid,uuid,bigint,bigint,timestamp with time zone)'),
      ('gov_repo.l14_responsibility_assignment_valid_state_v1(uuid,text,text,text,uuid,timestamp with time zone,timestamp with time zone)'),
      ('gov_repo.l14_responsibility_assignments_current_v1(uuid,text,text,timestamp with time zone,timestamp with time zone)'),
      ('gov_repo.l14_business_context_assignment_valid_state_v1(uuid,text,text,text,timestamp with time zone,timestamp with time zone)'),
      ('gov_repo.l14_business_context_assignments_current_v1(uuid,text,text,timestamp with time zone,timestamp with time zone)'),
      ('gov_repo.l14_policy_applicability_valid_state_v1(uuid,text,text,text,text,text,uuid,timestamp with time zone,timestamp with time zone)'),
      ('gov_repo.l14_policy_applicabilities_current_v1(uuid,text,text,text,text,text,timestamp with time zone,timestamp with time zone)'),
      ('gov_repo.l14_control_applicability_valid_state_v1(uuid,text,text,text,text,text,uuid,timestamp with time zone,timestamp with time zone)'),
      ('gov_repo.l14_control_applicabilities_current_v1(uuid,text,text,text,text,text,timestamp with time zone,timestamp with time zone)'),
      ('gov_repo.l14_control_assessment_valid_state_v1(uuid,uuid,timestamp with time zone,timestamp with time zone)'),
      ('gov_repo.l14_control_assessments_current_v1(uuid,text,text,text,text,text,timestamp with time zone,timestamp with time zone)'),
      ('gov_repo.l14_policy_applicability_target_key_v1(text,text,text,text,text)'),
      ('gov_repo.l14_control_applicability_target_key_v1(text,text,text,text,text)'),
      ('gov_repo.frame_identity(text[])')
    ) AS s(sig)
  LOOP
    v_oid := pg_catalog.to_regprocedure(v_entry.sig);
    IF v_oid IS NULL THEN
      RAISE EXCEPTION 'M16_RP_PREFLIGHT: reused routine % missing', v_entry.sig USING ERRCODE = '55000';
    END IF;
    SELECT p.prosecdef, p.proowner, p.proacl INTO v_proc FROM pg_catalog.pg_proc AS p WHERE p.oid = v_oid;
    IF v_proc.prosecdef OR pg_catalog.pg_get_userbyid(v_proc.proowner) <> 'postgres'
       OR pg_catalog.has_function_privilege('service_role', v_oid, 'EXECUTE')
       OR pg_catalog.has_function_privilege('anon', v_oid, 'EXECUTE')
       OR pg_catalog.has_function_privilege('authenticated', v_oid, 'EXECUTE') THEN
      IF v_entry.sig <> 'gov_repo.frame_identity(text[])' THEN
        RAISE EXCEPTION 'M16_RP_PREFLIGHT: reused routine % is not an owner-only postgres SECURITY INVOKER helper', v_entry.sig
          USING ERRCODE = '55000';
      END IF;
    END IF;
  END LOOP;
  -- The exact 43 approved application definers of the merged S1C.5 catalog (owner class, body, config).
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
      ('gov_repo.l14_submit_control_applicability_proposal_v1(uuid,uuid,bigint,bigint,timestamp with time zone,text,text,text,text,text,text,text,text,uuid,uuid,text,uuid,text,timestamp with time zone,timestamp with time zone,uuid,uuid,text,text[],text)', 'postgres', 'f8dbc5f51742c015cd29bd361dae67c2abd43f66866c5199c46afdf02abcd844', 'search_path=pg_catalog, pg_temp;lock_timeout=5s'),
      ('gov_repo.l14_decide_control_applicability_proposal_v1(uuid,uuid,bigint,bigint,timestamp with time zone,text,uuid,text,text,uuid,text,text[],text)', 'postgres', '28f1855d9599d8f204dd7123469f0d1fe1661458b16f95bbac8df53458c72b3a', 'search_path=pg_catalog, pg_temp;lock_timeout=5s'),
      ('gov_repo.l14_submit_control_assessment_proposal_v1(uuid,uuid,bigint,bigint,timestamp with time zone,text,text,text,uuid,text,timestamp with time zone,timestamp with time zone,uuid,uuid,text,text[],text)', 'postgres', 'de9363e0dae5988faedfeb8cb31ff4af99a739624df92b611bf078c8f5346ea1', 'search_path=pg_catalog, pg_temp;lock_timeout=5s'),
      ('gov_repo.l14_decide_control_assessment_proposal_v1(uuid,uuid,bigint,bigint,timestamp with time zone,text,uuid,text,text,uuid,text,text[],text)', 'postgres', 'c782bf86dc1de2d6ddba5c4c9c916ecf42587df8f1e668816da36fc89831e030', 'search_path=pg_catalog, pg_temp;lock_timeout=5s'),
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
      RAISE EXCEPTION 'M16_RP_PREFLIGHT: approved routine % missing', v_entry.sig USING ERRCODE = '55000';
    END IF;
    SELECT p.prosecdef, p.proowner, p.prosrc, p.proconfig INTO v_proc FROM pg_catalog.pg_proc AS p WHERE p.oid = v_oid;
    IF NOT v_proc.prosecdef OR pg_catalog.pg_get_userbyid(v_proc.proowner) <> v_entry.owner_role
       OR pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(v_proc.prosrc, 'UTF8')), 'hex') <> v_entry.sha
       OR COALESCE(pg_catalog.array_to_string(v_proc.proconfig, ';'), '-') <>
          pg_catalog.replace(pg_catalog.replace(v_entry.cfg, '{crypto}', pg_catalog.quote_ident(v_crypto)), '{vschema}', pg_catalog.quote_ident(v_vector)) THEN
      RAISE EXCEPTION 'M16_RP_PREFLIGHT: approved routine % differs from its merged S1C.5 owner/body/config', v_oid::regprocedure
        USING ERRCODE = '55000';
    END IF;
  END LOOP;
  -- The closed application surface is exactly those 43 (extension members excluded, any schema).
  IF (SELECT pg_catalog.count(*) FROM pg_catalog.pg_proc AS p
       WHERE p.prosecdef AND p.pronamespace NOT IN ('pg_catalog'::regnamespace, 'information_schema'::regnamespace)
         AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_depend AS d
                          WHERE d.classid = 'pg_catalog.pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e')
         AND (pg_catalog.has_function_privilege('service_role', p.oid, 'EXECUTE')
              OR pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE')
              OR pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE')
              OR EXISTS (SELECT 1 FROM pg_catalog.aclexplode(COALESCE(p.proacl, pg_catalog.acldefault('f', p.proowner))) AS a
                          WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE'))) <> 43 THEN
    RAISE EXCEPTION 'M16_RP_PREFLIGHT: application SECURITY DEFINER surface is not exactly the 43 post-S1C.5 baseline' USING ERRCODE = '55000';
  END IF;
END;
$preflight$;

-- ---------------------------------------------------------------------------------------
-- B. O32 — Passport governed projection. Read-only; the verified tenant only; one pair of coordinates for every row.
--    Rows (absence = UNKNOWN; nothing is defaulted, inherited, legacy-sourced or scored):
--      RESPONSIBILITY_ASSIGNMENT    current assignments of the exact AGENT (never the AgentVersion)
--      BUSINESS_CONTEXT_ASSIGNMENT  the current BUSINESS_DOMAIN assignment of the exact AGENT (the one legal AGENT binding)
--      POLICY_APPLICABILITY         current applicability (APPLIES | DOES_NOT_APPLY) of the exact AGENT and, separately, of
--                                   the exact selected AGENT_VERSION
--      CONTROL_APPLICABILITY        idem for control definitions
--      CONTROL_ASSESSMENT           for each control whose CURRENT applicability of that exact target is APPLIES, the current
--                                   valid assessment of EXACTLY that applicability state (never carried across states)
--    Each row: the exact pinned dependency, the fact envelope (state, predecessor, interval, recorded_at, trust, source,
--    support status), the deciding proposal, the governance decision, the ALLOW authorization decision, the Authority Policy
--    basis and the normalized support evidence ids of the state / decision / proposal (ids only; never content).
-- ---------------------------------------------------------------------------------------
CREATE FUNCTION gov_repo.l14_read_passport_governance_v1(
  p_verified_organisation_id uuid,
  p_verified_actor_user_id uuid,
  p_verified_session_iat bigint,
  p_verified_session_exp bigint,
  p_verified_credential_epoch timestamptz,
  p_agent_canonical_object_id text,            -- the exact canonical AGENT id of the verified tenant
  p_agent_version_canonical_object_id text,    -- NULL = no selected AgentVersion; else the exact AGENT_VERSION id
  p_effective_at timestamptz,                  -- NULL together with p_recorded_cutoff = ONE DB instant for both
  p_recorded_cutoff timestamptz
)
RETURNS TABLE (
  fact_family text, target_kind text, target_canonical_object_id text,
  responsibility_role text, governance_party_id uuid, party_validated_state_id uuid,
  semantic_kind text, domain_id text, domain_validated_state_id uuid,
  policy_id uuid, policy_version_id uuid, policy_content_hash text, policy_version_validated_state_id uuid,
  control_definition_id uuid, control_definition_version_id uuid, control_content_hash text,
  control_definition_validated_state_id uuid, applicability text, control_applicability_state_id uuid, assessment_outcome text,
  fact_state_id uuid, predecessor_state_id uuid, effective_from timestamptz, effective_to timestamptz, recorded_at timestamptz,
  trust_state text, source_class text, support_status text, proposal_id uuid, proposal_submitted_at timestamptz,
  governance_decision_id uuid, decision_outcome text, decision_reason_code text, decided_at timestamptz,
  authorization_decision_id uuid, authorization_result text, authorization_evaluated_at timestamptz,
  authority_policy_id uuid, authority_policy_version_id uuid, authority_policy_content_hash text,
  fact_support_evidence_ids text[], decision_support_evidence_ids text[], proposal_support_evidence_ids text[],
  read_effective_at timestamptz, read_recorded_cutoff timestamptz
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
SET lock_timeout = '5s'
AS $read_passport$
#variable_conflict use_column
DECLARE
  v_org uuid;
  v_at timestamptz;
  v_cutoff timestamptz;
BEGIN
  -- Base session eligibility is revalidated on every read; the tenant comes ONLY from the verified principal.
  PERFORM 1 FROM gov_repo.l14_session_basis_v1(p_verified_organisation_id, p_verified_actor_user_id,
    p_verified_session_iat, p_verified_session_exp, p_verified_credential_epoch);
  v_org := p_verified_organisation_id;
  IF p_agent_canonical_object_id IS NULL OR pg_catalog.length(p_agent_canonical_object_id) NOT BETWEEN 1 AND 500
     OR (p_agent_version_canonical_object_id IS NOT NULL
         AND pg_catalog.length(p_agent_version_canonical_object_id) NOT BETWEEN 1 AND 500)
     OR ((p_effective_at IS NULL) <> (p_recorded_cutoff IS NULL)) THEN
    RAISE EXCEPTION 'L14_READ_INVALID' USING ERRCODE = 'GV010', DETAIL = 'PASSPORT_READ_SHAPE_INVALID';
  END IF;
  -- One instant is both coordinates unless the caller pins both explicitly (historical as-of readback).
  v_at := COALESCE(p_effective_at, pg_catalog.clock_timestamp());
  v_cutoff := COALESCE(p_recorded_cutoff, v_at);
  RETURN QUERY
  WITH targets AS (
    SELECT o.kind::text AS t_kind, o.canonical_object_id::text AS t_id
    FROM gov_repo.canonical_objects AS o
    WHERE o.organisation_id = v_org AND o.canonical_object_id = p_agent_canonical_object_id AND o.kind = 'AGENT'
    UNION ALL
    SELECT o.kind::text, o.canonical_object_id::text
    FROM gov_repo.canonical_objects AS o
    WHERE p_agent_version_canonical_object_id IS NOT NULL
      AND o.organisation_id = v_org AND o.canonical_object_id = p_agent_version_canonical_object_id AND o.kind = 'AGENT_VERSION'
  ), facts AS (
    -- Family 3: the exact AGENT only (AGENT_VERSION is illegal for responsibility; nothing is inherited).
    SELECT 1 AS ord, 'RESPONSIBILITY_ASSIGNMENT'::text AS fam, t.t_kind, t.t_id,
           r.responsibility_role AS f_role, r.governance_party_id AS f_party, r.party_validated_state_id AS f_party_state,
           NULL::text AS f_semantic, NULL::text AS f_domain, NULL::uuid AS f_domain_state,
           NULL::uuid AS f_policy, NULL::uuid AS f_policy_version, NULL::text AS f_policy_hash, NULL::uuid AS f_policy_state,
           NULL::uuid AS f_control, NULL::uuid AS f_control_version, NULL::text AS f_control_hash, NULL::uuid AS f_control_state,
           NULL::text AS f_applicability, NULL::uuid AS f_applicability_state, NULL::text AS f_outcome, r.fact_state_id AS f_state
    FROM targets AS t
    CROSS JOIN LATERAL gov_repo.l14_responsibility_assignments_current_v1(v_org, t.t_kind, t.t_id, v_at, v_cutoff) AS r
    WHERE t.t_kind = 'AGENT'
    UNION ALL
    -- Family 4: the exact AGENT BUSINESS_DOMAIN binding only (the one legal AGENT semantic kind).
    SELECT 2, 'BUSINESS_CONTEXT_ASSIGNMENT', t.t_kind, t.t_id, NULL, NULL, NULL, b.semantic_kind, b.domain_id,
           b.domain_validated_state_id, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, b.fact_state_id
    FROM targets AS t
    CROSS JOIN LATERAL gov_repo.l14_business_context_assignments_current_v1(v_org, t.t_kind, t.t_id, v_at, v_cutoff) AS b
    WHERE t.t_kind = 'AGENT' AND b.semantic_kind = 'BUSINESS_DOMAIN'
    UNION ALL
    -- Family 12: policy applicability of each exact object target (APPLIES and DOES_NOT_APPLY are both positive rows).
    SELECT 3, 'POLICY_APPLICABILITY', t.t_kind, t.t_id, NULL, NULL, NULL, NULL, NULL, NULL,
           pa.policy_id, pa.version_id, pa.content_hash, pa.policy_version_validated_state_id, NULL, NULL, NULL, NULL,
           pa.applicability, NULL, NULL, pa.fact_state_id
    FROM targets AS t
    CROSS JOIN LATERAL gov_repo.l14_policy_applicabilities_current_v1(v_org, 'CANONICAL_OBJECT', t.t_kind, t.t_id,
      NULL::text, NULL::text, v_at, v_cutoff) AS pa
    UNION ALL
    SELECT 4, 'CONTROL_APPLICABILITY', t.t_kind, t.t_id, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
           ca.control_definition_id, ca.control_definition_version_id, ca.content_hash, ca.control_definition_validated_state_id,
           ca.applicability, NULL, NULL, ca.fact_state_id
    FROM targets AS t
    CROSS JOIN LATERAL gov_repo.l14_control_applicabilities_current_v1(v_org, 'CANONICAL_OBJECT', t.t_kind, t.t_id,
      NULL::text, NULL::text, v_at, v_cutoff) AS ca
    UNION ALL
    -- Family 12: assessments of exactly the CURRENT APPLIES applicability state of each exact target.
    SELECT 5, 'CONTROL_ASSESSMENT', t.t_kind, t.t_id, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
           cs.control_definition_id, cs.control_definition_version_id, cs.content_hash, NULL, 'APPLIES',
           cs.control_applicability_state_id, cs.assessment_outcome, cs.fact_state_id
    FROM targets AS t
    CROSS JOIN LATERAL gov_repo.l14_control_assessments_current_v1(v_org, 'CANONICAL_OBJECT', t.t_kind, t.t_id,
      NULL::text, NULL::text, v_at, v_cutoff) AS cs
  )
  SELECT f.fam, f.t_kind, f.t_id, f.f_role, f.f_party, f.f_party_state, f.f_semantic, f.f_domain, f.f_domain_state,
         f.f_policy, f.f_policy_version, f.f_policy_hash, f.f_policy_state, f.f_control, f.f_control_version, f.f_control_hash,
         f.f_control_state, f.f_applicability, f.f_applicability_state, f.f_outcome,
         s.fact_state_id, s.predecessor_state_id, s.effective_from, s.effective_to, s.recorded_at,
         s.trust_state, s.source_class, s.support_status, g.proposal_id, pr.submitted_at,
         g.governance_decision_id, g.outcome, g.reason_code, g.decided_at,
         a.authorization_decision_id, a.result, a.evaluated_at,
         s.authority_policy_id, s.authority_policy_version_id, s.authority_policy_content_hash,
         ARRAY(SELECT l.evidence_id FROM gov_repo.l14_support_links AS l
               WHERE l.organisation_id = v_org AND l.owner_kind = 'FACT_STATE' AND l.fact_state_id = s.fact_state_id
               ORDER BY l.evidence_id COLLATE "C"),
         ARRAY(SELECT l.evidence_id FROM gov_repo.l14_support_links AS l
               WHERE l.organisation_id = v_org AND l.owner_kind = 'GOVERNANCE_DECISION'
                 AND l.governance_decision_id = g.governance_decision_id
               ORDER BY l.evidence_id COLLATE "C"),
         ARRAY(SELECT l.evidence_id FROM gov_repo.l14_support_links AS l
               WHERE l.organisation_id = v_org AND l.owner_kind = 'PROPOSAL' AND l.proposal_id = g.proposal_id
               ORDER BY l.evidence_id COLLATE "C"),
         v_at, v_cutoff
  FROM facts AS f
  JOIN gov_repo.l14_fact_states AS s
    ON s.organisation_id = v_org AND s.fact_state_id = f.f_state AND s.subject_kind = f.fam AND s.state_kind = 'VALIDATED'
  JOIN gov_repo.l14_governance_decisions AS g
    ON g.organisation_id = v_org AND g.governance_decision_id = s.governance_decision_id AND g.subject_kind = f.fam
   AND g.outcome = 'VALIDATE'
  JOIN gov_repo.l14_authorization_decisions AS a
    ON a.organisation_id = v_org AND a.authorization_decision_id = s.authorization_decision_id AND a.result = 'ALLOW'
  JOIN gov_repo.l14_proposals AS pr
    ON pr.organisation_id = v_org AND pr.proposal_id = g.proposal_id AND pr.subject_kind = f.fam AND pr.intent = 'VALIDATE'
  ORDER BY f.ord, f.t_kind COLLATE "C", f.f_role COLLATE "C", f.f_party, f.f_policy, f.f_control, s.fact_state_id;
END;
$read_passport$;

-- ---------------------------------------------------------------------------------------
-- C. O41 — conflict read projection over ONE exact logical fact key (ADR §3 keys, never collapsed):
--      RESPONSIBILITY_ASSIGNMENT    CANONICAL_OBJECT target (kind + id) + responsibility_role + governance_party_id
--      BUSINESS_CONTEXT_ASSIGNMENT  CANONICAL_OBJECT target (kind + id) + semantic_kind
--      POLICY_APPLICABILITY         exact target union (object, or relationship id + state id) + policy_id
--      CONTROL_APPLICABILITY        exact target union + control_definition_id
--      CONTROL_ASSESSMENT           control_applicability_state_id
--    Rows: exactly one OUTCOME row (closed outcome + live proposal / distinct asserted content counts), then the
--    GOVERNED_FACT row (RESOLVED only) or every LIVE_PROPOSAL row (CONFLICT / INSUFFICIENT_EVIDENCE), ordered by proposal id
--    (an opaque random identifier — never a ranking). Nothing is written; no proposal / decision is touched.
-- ---------------------------------------------------------------------------------------
CREATE FUNCTION gov_repo.l14_read_fact_conflict_v1(
  p_verified_organisation_id uuid,
  p_verified_actor_user_id uuid,
  p_verified_session_iat bigint,
  p_verified_session_exp bigint,
  p_verified_credential_epoch timestamptz,
  p_subject_kind text,                         -- one of the five closed fact families
  p_target_type text,                          -- CANONICAL_OBJECT | RELATIONSHIP_STATE (NULL for CONTROL_ASSESSMENT)
  p_target_canonical_kind text,
  p_target_canonical_object_id text,
  p_target_relationship_id text,
  p_target_relationship_state_id text,
  p_responsibility_role text,                  -- RESPONSIBILITY_ASSIGNMENT only
  p_governance_party_id uuid,                  -- RESPONSIBILITY_ASSIGNMENT only
  p_semantic_kind text,                        -- BUSINESS_CONTEXT_ASSIGNMENT only
  p_policy_id uuid,                            -- POLICY_APPLICABILITY only
  p_control_definition_id uuid,                -- CONTROL_APPLICABILITY only
  p_control_applicability_state_id uuid,       -- CONTROL_ASSESSMENT only
  p_effective_at timestamptz,                  -- NULL together with p_recorded_cutoff = ONE DB instant for both
  p_recorded_cutoff timestamptz
)
RETURNS TABLE (
  conflict_outcome text, row_kind text, subject_kind text, live_proposal_count integer, distinct_content_count integer,
  fact_state_id uuid, governance_decision_id uuid, fact_effective_from timestamptz, fact_effective_to timestamptz,
  fact_recorded_at timestamptz, proposal_id uuid, proposal_submitted_at timestamptz, proposal_source_class text,
  proposal_support_status text, proposal_support_evidence_ids text[], proposal_deferred boolean, asserted_content_digest text,
  party_validated_state_id uuid, domain_id text, domain_validated_state_id uuid,
  policy_version_id uuid, policy_content_hash text, policy_version_validated_state_id uuid,
  control_definition_version_id uuid, control_content_hash text, control_definition_validated_state_id uuid,
  applicability text, assessment_outcome text, requested_effective_from timestamptz, requested_effective_to timestamptz,
  read_effective_at timestamptz, read_recorded_cutoff timestamptz
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
SET lock_timeout = '5s'
AS $read_conflict$
#variable_conflict use_column
DECLARE
  v_org uuid;
  v_at timestamptz;
  v_cutoff timestamptz;
  v_object boolean := COALESCE(p_target_type = 'CANONICAL_OBJECT', false) AND p_target_canonical_kind IS NOT NULL
    AND p_target_canonical_object_id IS NOT NULL AND p_target_relationship_id IS NULL AND p_target_relationship_state_id IS NULL;
  v_relationship boolean := COALESCE(p_target_type = 'RELATIONSHIP_STATE', false) AND p_target_canonical_kind IS NULL
    AND p_target_canonical_object_id IS NULL AND p_target_relationship_id IS NOT NULL AND p_target_relationship_state_id IS NOT NULL;
  v_no_target boolean := p_target_type IS NULL AND p_target_canonical_kind IS NULL AND p_target_canonical_object_id IS NULL
    AND p_target_relationship_id IS NULL AND p_target_relationship_state_id IS NULL;
  v_policy_key text;
  v_control_key text;
BEGIN
  PERFORM 1 FROM gov_repo.l14_session_basis_v1(p_verified_organisation_id, p_verified_actor_user_id,
    p_verified_session_iat, p_verified_session_exp, p_verified_credential_epoch);
  v_org := p_verified_organisation_id;
  IF p_subject_kind IS NULL OR p_subject_kind NOT IN ('RESPONSIBILITY_ASSIGNMENT','BUSINESS_CONTEXT_ASSIGNMENT',
       'POLICY_APPLICABILITY','CONTROL_APPLICABILITY','CONTROL_ASSESSMENT') THEN
    RAISE EXCEPTION 'L14_READ_INVALID' USING ERRCODE = 'GV010', DETAIL = 'FACT_SUBJECT_KIND_UNKNOWN';
  END IF;
  IF (p_effective_at IS NULL) <> (p_recorded_cutoff IS NULL)
     OR (p_target_canonical_kind IS NOT NULL AND p_target_canonical_kind NOT IN ('AGENT','AGENT_VERSION','MODEL','TOOL',
           'MCP_SERVER','API','PROMPT','KNOWLEDGE_BASE','DATA_ASSET','DATA_ELEMENT','SKILL'))
     OR (p_responsibility_role IS NOT NULL
         AND p_responsibility_role NOT IN ('BUSINESS_OWNER','TECHNICAL_OWNER','DATA_OWNER','DATA_STEWARD'))
     OR (p_semantic_kind IS NOT NULL AND p_semantic_kind NOT IN ('BUSINESS_DOMAIN','INFORMATION_DOMAIN'))
     OR NOT COALESCE(CASE p_subject_kind
       WHEN 'RESPONSIBILITY_ASSIGNMENT' THEN v_object AND p_responsibility_role IS NOT NULL AND p_governance_party_id IS NOT NULL
         AND p_semantic_kind IS NULL AND p_policy_id IS NULL AND p_control_definition_id IS NULL
         AND p_control_applicability_state_id IS NULL
       WHEN 'BUSINESS_CONTEXT_ASSIGNMENT' THEN v_object AND p_semantic_kind IS NOT NULL AND p_responsibility_role IS NULL
         AND p_governance_party_id IS NULL AND p_policy_id IS NULL AND p_control_definition_id IS NULL
         AND p_control_applicability_state_id IS NULL
       WHEN 'POLICY_APPLICABILITY' THEN (v_object OR v_relationship) AND p_policy_id IS NOT NULL
         AND p_responsibility_role IS NULL AND p_governance_party_id IS NULL AND p_semantic_kind IS NULL
         AND p_control_definition_id IS NULL AND p_control_applicability_state_id IS NULL
       WHEN 'CONTROL_APPLICABILITY' THEN (v_object OR v_relationship) AND p_control_definition_id IS NOT NULL
         AND p_responsibility_role IS NULL AND p_governance_party_id IS NULL AND p_semantic_kind IS NULL
         AND p_policy_id IS NULL AND p_control_applicability_state_id IS NULL
       ELSE v_no_target AND p_control_applicability_state_id IS NOT NULL AND p_responsibility_role IS NULL
         AND p_governance_party_id IS NULL AND p_semantic_kind IS NULL AND p_policy_id IS NULL AND p_control_definition_id IS NULL
     END, false) THEN
    RAISE EXCEPTION 'L14_READ_INVALID' USING ERRCODE = 'GV010', DETAIL = 'FACT_KEY_SHAPE_INVALID';
  END IF;
  v_at := COALESCE(p_effective_at, pg_catalog.clock_timestamp());
  v_cutoff := COALESCE(p_recorded_cutoff, v_at);
  v_policy_key := gov_repo.l14_policy_applicability_target_key_v1(p_target_type, p_target_canonical_kind,
    p_target_canonical_object_id, p_target_relationship_id, p_target_relationship_state_id);
  v_control_key := gov_repo.l14_control_applicability_target_key_v1(p_target_type, p_target_canonical_kind,
    p_target_canonical_object_id, p_target_relationship_id, p_target_relationship_state_id);
  RETURN QUERY
  WITH fact AS (
    -- The family's EXISTING exact resolver at the requested coordinates (own state + target + every pinned dependency).
    SELECT r.fact_state_id AS c_state, r.effective_from AS c_from, r.effective_to AS c_to, r.recorded_at AS c_recorded,
           r.party_validated_state_id AS c_party_state, NULL::text AS c_domain, NULL::uuid AS c_domain_state,
           NULL::uuid AS c_policy_version, NULL::text AS c_policy_hash, NULL::uuid AS c_policy_state,
           NULL::uuid AS c_control_version, NULL::text AS c_control_hash, NULL::uuid AS c_control_state,
           NULL::text AS c_applicability, NULL::text AS c_outcome
    FROM gov_repo.l14_responsibility_assignment_valid_state_v1(v_org, p_target_canonical_kind, p_target_canonical_object_id,
      p_responsibility_role, p_governance_party_id, v_at, v_cutoff) AS r
    WHERE p_subject_kind = 'RESPONSIBILITY_ASSIGNMENT'
    UNION ALL
    SELECT b.fact_state_id, b.effective_from, b.effective_to, b.recorded_at, NULL, b.domain_id, b.domain_validated_state_id,
           NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL
    FROM gov_repo.l14_business_context_assignment_valid_state_v1(v_org, p_target_canonical_kind, p_target_canonical_object_id,
      p_semantic_kind, v_at, v_cutoff) AS b
    WHERE p_subject_kind = 'BUSINESS_CONTEXT_ASSIGNMENT'
    UNION ALL
    SELECT pa.fact_state_id, pa.effective_from, pa.effective_to, pa.recorded_at, NULL, NULL, NULL,
           pa.version_id, pa.content_hash, pa.policy_version_validated_state_id, NULL, NULL, NULL, pa.applicability, NULL
    FROM gov_repo.l14_policy_applicability_valid_state_v1(v_org, p_target_type, p_target_canonical_kind,
      p_target_canonical_object_id, p_target_relationship_id, p_target_relationship_state_id, p_policy_id, v_at, v_cutoff) AS pa
    WHERE p_subject_kind = 'POLICY_APPLICABILITY'
    UNION ALL
    SELECT ca.fact_state_id, ca.effective_from, ca.effective_to, ca.recorded_at, NULL, NULL, NULL, NULL, NULL, NULL,
           ca.control_definition_version_id, ca.content_hash, ca.control_definition_validated_state_id, ca.applicability, NULL
    FROM gov_repo.l14_control_applicability_valid_state_v1(v_org, p_target_type, p_target_canonical_kind,
      p_target_canonical_object_id, p_target_relationship_id, p_target_relationship_state_id, p_control_definition_id,
      v_at, v_cutoff) AS ca
    WHERE p_subject_kind = 'CONTROL_APPLICABILITY'
    UNION ALL
    SELECT cs.fact_state_id, cs.effective_from, cs.valid_until, cs.recorded_at, NULL, NULL, NULL, NULL, NULL, NULL,
           cs.control_definition_version_id, cs.content_hash, NULL, 'APPLIES', cs.assessment_outcome
    FROM gov_repo.l14_control_assessment_valid_state_v1(v_org, p_control_applicability_state_id, v_at, v_cutoff) AS cs
    WHERE p_subject_kind = 'CONTROL_ASSESSMENT'
  ), typed AS (
    -- Every typed VALIDATE-intent proposal of the EXACT key (typed columns only; never a label or free text).
    SELECT t.proposal_id AS c_proposal, t.party_validated_state_id AS c_party_state, NULL::text AS c_domain,
           NULL::uuid AS c_domain_state, NULL::uuid AS c_policy_version, NULL::text AS c_policy_hash, NULL::uuid AS c_policy_state,
           NULL::uuid AS c_control_version, NULL::text AS c_control_hash, NULL::uuid AS c_control_state,
           NULL::text AS c_applicability, NULL::text AS c_outcome,
           t.requested_effective_from AS c_req_from, t.requested_effective_to AS c_req_to
    FROM gov_repo.l14_responsibility_assignment_proposals AS t
    WHERE p_subject_kind = 'RESPONSIBILITY_ASSIGNMENT' AND t.organisation_id = v_org AND t.intent = 'VALIDATE'
      AND t.target_kind = p_target_canonical_kind AND t.target_canonical_object_id = p_target_canonical_object_id
      AND t.responsibility_role = p_responsibility_role AND t.governance_party_id = p_governance_party_id
    UNION ALL
    SELECT t.proposal_id, NULL, t.domain_id, t.domain_validated_state_id, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
           t.requested_effective_from, t.requested_effective_to
    FROM gov_repo.l14_business_context_assignment_proposals AS t
    WHERE p_subject_kind = 'BUSINESS_CONTEXT_ASSIGNMENT' AND t.organisation_id = v_org AND t.intent = 'VALIDATE'
      AND t.target_kind = p_target_canonical_kind AND t.target_canonical_object_id = p_target_canonical_object_id
      AND t.semantic_kind = p_semantic_kind
    UNION ALL
    SELECT t.proposal_id, NULL, NULL, NULL, t.version_id, t.content_hash::text, t.policy_version_validated_state_id,
           NULL, NULL, NULL, t.applicability, NULL, t.requested_effective_from, t.requested_effective_to
    FROM gov_repo.l14_policy_applicability_proposals AS t
    WHERE p_subject_kind = 'POLICY_APPLICABILITY' AND t.organisation_id = v_org AND t.intent = 'VALIDATE'
      AND t.target_key = v_policy_key AND t.policy_id = p_policy_id
    UNION ALL
    SELECT t.proposal_id, NULL, NULL, NULL, NULL, NULL, NULL, t.control_definition_version_id, t.content_hash::text,
           t.control_definition_validated_state_id, t.applicability, NULL, t.requested_effective_from, t.requested_effective_to
    FROM gov_repo.l14_control_applicability_proposals AS t
    WHERE p_subject_kind = 'CONTROL_APPLICABILITY' AND t.organisation_id = v_org AND t.intent = 'VALIDATE'
      AND t.target_key = v_control_key AND t.control_definition_id = p_control_definition_id
    UNION ALL
    SELECT t.proposal_id, NULL, NULL, NULL, NULL, NULL, NULL, t.control_definition_version_id, t.content_hash::text,
           t.control_definition_validated_state_id, t.applicability, t.assessment_outcome, t.requested_effective_from,
           t.requested_valid_until
    FROM gov_repo.l14_control_assessment_proposals AS t
    WHERE p_subject_kind = 'CONTROL_ASSESSMENT' AND t.organisation_id = v_org AND t.intent = 'VALIDATE'
      AND t.control_applicability_state_id = p_control_applicability_state_id
  ), live AS (
    -- LIVE at the recorded cutoff: submitted, and no terminal VALIDATE / REJECT decision recorded (DEFER is non-terminal).
    SELECT y.*, pr.submitted_at AS c_submitted, pr.source_class AS c_source, pr.support_status AS c_support,
           EXISTS (SELECT 1 FROM gov_repo.l14_governance_decisions AS d
                   WHERE d.organisation_id = v_org AND d.proposal_id = y.c_proposal AND d.outcome = 'DEFER'
                     AND d.decided_at <= v_cutoff) AS c_deferred,
           pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(gov_repo.frame_identity(ARRAY[
             p_subject_kind,
             CASE WHEN y.c_party_state IS NULL THEN 'N' ELSE 'V' || y.c_party_state::text END,
             CASE WHEN y.c_domain IS NULL THEN 'N' ELSE 'V' || y.c_domain END,
             CASE WHEN y.c_domain_state IS NULL THEN 'N' ELSE 'V' || y.c_domain_state::text END,
             CASE WHEN y.c_policy_version IS NULL THEN 'N' ELSE 'V' || y.c_policy_version::text END,
             CASE WHEN y.c_policy_hash IS NULL THEN 'N' ELSE 'V' || y.c_policy_hash END,
             CASE WHEN y.c_policy_state IS NULL THEN 'N' ELSE 'V' || y.c_policy_state::text END,
             CASE WHEN y.c_control_version IS NULL THEN 'N' ELSE 'V' || y.c_control_version::text END,
             CASE WHEN y.c_control_hash IS NULL THEN 'N' ELSE 'V' || y.c_control_hash END,
             CASE WHEN y.c_control_state IS NULL THEN 'N' ELSE 'V' || y.c_control_state::text END,
             CASE WHEN y.c_applicability IS NULL THEN 'N' ELSE 'V' || y.c_applicability END,
             CASE WHEN y.c_outcome IS NULL THEN 'N' ELSE 'V' || y.c_outcome END,
             CASE WHEN y.c_req_from IS NULL THEN 'N'
                  ELSE 'V' || pg_catalog.to_char(y.c_req_from AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') END,
             CASE WHEN y.c_req_to IS NULL THEN 'N'
                  ELSE 'V' || pg_catalog.to_char(y.c_req_to AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') END
           ]), 'UTF8')), 'hex') AS c_digest
    FROM typed AS y
    JOIN gov_repo.l14_proposals AS pr
      ON pr.organisation_id = v_org AND pr.proposal_id = y.c_proposal AND pr.subject_kind = p_subject_kind
     AND pr.intent = 'VALIDATE'
    WHERE pr.submitted_at <= v_cutoff
      AND NOT EXISTS (SELECT 1 FROM gov_repo.l14_governance_decisions AS d
                      WHERE d.organisation_id = v_org AND d.proposal_id = y.c_proposal AND d.outcome IN ('VALIDATE','REJECT')
                        AND d.decided_at <= v_cutoff)
  ), summary AS (
    SELECT (SELECT pg_catalog.count(*) FROM fact) AS n_facts, (SELECT pg_catalog.count(*) FROM live) AS n_live,
           (SELECT pg_catalog.count(DISTINCT l.c_digest) FROM live AS l) AS n_distinct
  ), verdict AS (
    SELECT CASE WHEN s.n_facts = 1 THEN 'RESOLVED' WHEN s.n_distinct >= 2 THEN 'CONFLICT' ELSE 'INSUFFICIENT_EVIDENCE' END AS v,
           s.n_live::integer AS n_live, s.n_distinct::integer AS n_distinct
    FROM summary AS s
  )
  SELECT x.c_verdict, x.c_kind, p_subject_kind, x.c_live, x.c_distinct, x.c_state, x.c_decision, x.c_from, x.c_to, x.c_recorded,
         x.c_proposal, x.c_submitted, x.c_source, x.c_support, x.c_evidence, x.c_deferred, x.c_digest, x.c_party_state, x.c_domain,
         x.c_domain_state, x.c_policy_version, x.c_policy_hash, x.c_policy_state, x.c_control_version, x.c_control_hash,
         x.c_control_state, x.c_applicability, x.c_outcome, x.c_req_from, x.c_req_to, v_at, v_cutoff
  FROM (
    SELECT 0 AS c_ord, v.v AS c_verdict, 'OUTCOME'::text AS c_kind, v.n_live AS c_live, v.n_distinct AS c_distinct,
           NULL::uuid AS c_state, NULL::uuid AS c_decision, NULL::timestamptz AS c_from, NULL::timestamptz AS c_to,
           NULL::timestamptz AS c_recorded, NULL::uuid AS c_proposal, NULL::timestamptz AS c_submitted, NULL::text AS c_source,
           NULL::text AS c_support, NULL::text[] AS c_evidence, NULL::boolean AS c_deferred, NULL::text AS c_digest,
           NULL::uuid AS c_party_state, NULL::text AS c_domain, NULL::uuid AS c_domain_state, NULL::uuid AS c_policy_version,
           NULL::text AS c_policy_hash, NULL::uuid AS c_policy_state, NULL::uuid AS c_control_version, NULL::text AS c_control_hash,
           NULL::uuid AS c_control_state, NULL::text AS c_applicability, NULL::text AS c_outcome,
           NULL::timestamptz AS c_req_from, NULL::timestamptz AS c_req_to
    FROM verdict AS v
    UNION ALL
    SELECT 1, v.v, 'GOVERNED_FACT', v.n_live, v.n_distinct, f.c_state, s.governance_decision_id, f.c_from, f.c_to, f.c_recorded,
           NULL, NULL, NULL, NULL, NULL, NULL, NULL, f.c_party_state, f.c_domain, f.c_domain_state, f.c_policy_version,
           f.c_policy_hash, f.c_policy_state, f.c_control_version, f.c_control_hash, f.c_control_state, f.c_applicability,
           f.c_outcome, NULL, NULL
    FROM verdict AS v
    CROSS JOIN fact AS f
    JOIN gov_repo.l14_fact_states AS s
      ON s.organisation_id = v_org AND s.fact_state_id = f.c_state AND s.subject_kind = p_subject_kind
    WHERE v.v = 'RESOLVED'
    UNION ALL
    SELECT 2, v.v, 'LIVE_PROPOSAL', v.n_live, v.n_distinct, NULL, NULL, NULL, NULL, NULL, l.c_proposal, l.c_submitted,
           l.c_source, l.c_support,
           ARRAY(SELECT k.evidence_id FROM gov_repo.l14_support_links AS k
                 WHERE k.organisation_id = v_org AND k.owner_kind = 'PROPOSAL' AND k.proposal_id = l.c_proposal
                 ORDER BY k.evidence_id COLLATE "C"),
           l.c_deferred, l.c_digest, l.c_party_state, l.c_domain, l.c_domain_state, l.c_policy_version, l.c_policy_hash,
           l.c_policy_state, l.c_control_version, l.c_control_hash, l.c_control_state, l.c_applicability, l.c_outcome,
           l.c_req_from, l.c_req_to
    FROM verdict AS v
    CROSS JOIN live AS l
    WHERE v.v <> 'RESOLVED'
  ) AS x
  ORDER BY x.c_ord, x.c_proposal;
END;
$read_conflict$;

-- ---------------------------------------------------------------------------------------
-- D. Privileges. Both projections are service_role-executable ONLY; no table / view / sequence privilege changes (service_role
--    keeps ZERO privilege on every L14 table); every reused resolver stays owner-only.
-- ---------------------------------------------------------------------------------------
REVOKE ALL ON FUNCTION
  gov_repo.l14_read_passport_governance_v1(uuid, uuid, bigint, bigint, timestamptz, text, text, timestamptz, timestamptz),
  gov_repo.l14_read_fact_conflict_v1(uuid, uuid, bigint, bigint, timestamptz, text, text, text, text, text, text, text, uuid, text, uuid, uuid, uuid, timestamptz, timestamptz)
FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION
  gov_repo.l14_read_passport_governance_v1(uuid, uuid, bigint, bigint, timestamptz, text, text, timestamptz, timestamptz),
  gov_repo.l14_read_fact_conflict_v1(uuid, uuid, bigint, bigint, timestamptz, text, text, text, text, text, text, text, uuid, text, uuid, uuid, uuid, timestamptz, timestamptz)
TO service_role;

COMMENT ON FUNCTION gov_repo.l14_read_passport_governance_v1(uuid, uuid, bigint, bigint, timestamptz, text, text, timestamptz, timestamptz) IS 'M16 read-projection closure (O32 / ADR §22): read-only tenant-scoped Passport projection of the CURRENT VALID M16 governed facts of the exact AGENT (families 3, 4, 12) and the exact selected AGENT_VERSION (family 12 only) at one pair of effective / recorded coordinates, through the existing owner-only bounded current reads, with exact M16 lineage (state, governance + authorization decision, Authority Policy basis, pinned dependency, normalized support evidence ids) for family 14. No row = UNKNOWN. Never legacy owner / business_domain / cg_* values, never inheritance, never a score.';
COMMENT ON FUNCTION gov_repo.l14_read_fact_conflict_v1(uuid, uuid, bigint, bigint, timestamptz, text, text, text, text, text, text, text, uuid, text, uuid, uuid, uuid, timestamptz, timestamptz) IS 'M16 read-projection closure (O41 / ADR §18.2): read-only tenant-scoped conflict projection of ONE exact logical fact key of ONE of the five fact families. Closed outcomes RESOLVED (the existing exact resolver returns the current governed fact) | CONFLICT (no fact; live VALIDATE-intent proposals of the exact key with >= 2 distinct typed asserted contents) | INSUFFICIENT_EVIDENCE (otherwise). Never ranks by confidence / recency / source / support; never writes; not a truth store.';

-- ---------------------------------------------------------------------------------------
-- E. Postflight over the EFFECTIVE post-closure catalog.
-- ---------------------------------------------------------------------------------------
DO $postflight$
DECLARE
  v_stores CONSTANT oid[] := ARRAY['gov_repo.governance_policies'::regclass::oid, 'gov_repo.policy_versions'::regclass::oid];
  v_app CONSTANT text[] := ARRAY['anon','authenticated','service_role'];
  v_expected_l14 CONSTANT text[] := ARRAY[
    'l14_authority_policies','l14_authority_policy_heads','l14_authority_policy_rules',
    'l14_authority_policy_states','l14_authority_policy_version_proposals','l14_authority_policy_versions',
    'l14_authorization_decision_roles','l14_authorization_decision_rules','l14_authorization_decisions',
    'l14_business_context_assignment_heads','l14_business_context_assignment_proposals',
    'l14_business_context_assignment_states','l14_command_results','l14_control_applicability_heads',
    'l14_control_applicability_proposals','l14_control_applicability_states','l14_control_assessment_heads',
    'l14_control_assessment_proposals','l14_control_assessment_states','l14_control_definition_heads',
    'l14_control_definition_proposals','l14_control_definition_states','l14_control_definition_versions',
    'l14_control_definitions','l14_domain_admissions','l14_domain_heads','l14_domain_proposals','l14_domain_states',
    'l14_fact_states','l14_governance_decisions','l14_governance_parties','l14_governance_party_heads',
    'l14_governance_party_proposals','l14_governance_party_states','l14_policy_admissions',
    'l14_policy_applicability_heads','l14_policy_applicability_proposals','l14_policy_applicability_states',
    'l14_policy_version_admissions','l14_policy_version_heads','l14_policy_version_proposals',
    'l14_policy_version_states','l14_proposals','l14_registry_states','l14_responsibility_assignment_heads',
    'l14_responsibility_assignment_proposals','l14_responsibility_assignment_states','l14_support_links'];
  v_public_l14 CONSTANT text[] := ARRAY[
    'l14_admit_authority_policy_version_v1','l14_admit_control_definition_version_v1','l14_admit_domain_v1',
    'l14_admit_governance_party_v1','l14_admit_governance_policy_v1','l14_admit_policy_version_v1',
    'l14_decide_authority_policy_proposal_v1','l14_decide_business_context_assignment_proposal_v1',
    'l14_decide_control_applicability_proposal_v1','l14_decide_control_assessment_proposal_v1',
    'l14_decide_control_definition_proposal_v1',
    'l14_decide_domain_proposal_v1','l14_decide_governance_party_proposal_v1','l14_decide_policy_applicability_proposal_v1',
    'l14_decide_policy_version_proposal_v1','l14_decide_responsibility_assignment_proposal_v1',
    'l14_read_fact_conflict_v1','l14_read_passport_governance_v1',
    'l14_read_policy_descriptors_v1','l14_submit_business_context_assignment_proposal_v1',
    'l14_submit_control_applicability_proposal_v1','l14_submit_control_assessment_proposal_v1',
    'l14_submit_control_definition_proposal_v1',
    'l14_submit_domain_proposal_v1','l14_submit_governance_party_proposal_v1','l14_submit_policy_applicability_proposal_v1',
    'l14_submit_policy_version_proposal_v1','l14_submit_proposal_v1','l14_submit_responsibility_assignment_proposal_v1'];
  v_new_rpcs CONSTANT text[] := ARRAY['l14_read_fact_conflict_v1','l14_read_passport_governance_v1'];
  v_privileges text[] := ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'];
  v_crypto name := (SELECT e.extnamespace::regnamespace::name FROM pg_catalog.pg_extension AS e WHERE e.extname = 'pgcrypto');
  v_vector name := (SELECT e.extnamespace::regnamespace::name FROM pg_catalog.pg_extension AS e WHERE e.extname = 'vector');
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

  -- P1. Exact l14 relation set: NO relation (table / view / sequence / matview / foreign table) is added by this slice.
  IF (SELECT pg_catalog.array_agg(c.relname::text ORDER BY c.relname::text COLLATE "C")
      FROM pg_catalog.pg_class AS c
      WHERE c.relnamespace = 'gov_repo'::regnamespace AND c.relname LIKE 'l14\_%' ESCAPE '\'
        AND c.relkind IN ('r','p','v','m','S','f')) IS DISTINCT FROM v_expected_l14 THEN
    RAISE EXCEPTION 'M16_RP_POSTFLIGHT: unexpected l14 relation set (a read projection must not create a store)';
  END IF;

  -- P2. Every l14 table + both reused stores: RLS-enabled ordinary table with ZERO non-owner / column / application
  --     privilege (incl. inherited). In particular service_role holds NO direct SELECT on any authoritative history / state.
  FOR v_rel IN
    SELECT c.oid, c.relname, c.relkind, c.relowner, c.relacl, c.relrowsecurity
    FROM pg_catalog.pg_class AS c
    WHERE c.relnamespace = 'gov_repo'::regnamespace AND (c.relname::text = ANY (v_expected_l14) OR c.oid = ANY (v_stores))
  LOOP
    IF v_rel.relkind <> 'r' OR NOT v_rel.relrowsecurity THEN
      RAISE EXCEPTION 'M16_RP_POSTFLIGHT: % must be an RLS-enabled ordinary table', v_rel.relname;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_catalog.aclexplode(COALESCE(v_rel.relacl, pg_catalog.acldefault('r', v_rel.relowner))) AS a
               WHERE a.grantee <> v_rel.relowner) THEN
      RAISE EXCEPTION 'M16_RP_POSTFLIGHT: % has a non-owner table grant', v_rel.relname;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_attribute AS att WHERE att.attrelid = v_rel.oid AND att.attacl IS NOT NULL) THEN
      RAISE EXCEPTION 'M16_RP_POSTFLIGHT: % has column-level grants', v_rel.relname;
    END IF;
    FOREACH v_role IN ARRAY v_app LOOP
      FOREACH v_privilege IN ARRAY v_privileges LOOP
        IF pg_catalog.has_table_privilege(v_role, v_rel.oid, v_privilege) THEN
          RAISE EXCEPTION 'M16_RP_POSTFLIGHT: % holds % on %', v_role, v_privilege, v_rel.relname;
        END IF;
      END LOOP;
      IF pg_catalog.has_any_column_privilege(v_role, v_rel.oid, 'SELECT, INSERT, UPDATE, REFERENCES') THEN
        RAISE EXCEPTION 'M16_RP_POSTFLIGHT: % holds a column privilege on %', v_role, v_rel.relname;
      END IF;
    END LOOP;
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_policy AS pol WHERE pol.polrelid = v_rel.oid)
       AND v_rel.relname::text = ANY (v_expected_l14) THEN
      RAISE EXCEPTION 'M16_RP_POSTFLIGHT: % carries an RLS policy (no application access path may exist)', v_rel.relname;
    END IF;
  END LOOP;

  -- P3. The two projections are exactly the closed read shape: input parameters, VOLATILE (session basis locks only),
  --     SECURITY DEFINER, postgres-owned, pinned config; their bodies revalidate the session first, reach ONLY the reused
  --     exact resolvers / bounded current reads and lineage tables, and contain no write, dynamic SQL, lock, head read,
  --     policy content store, legacy owner / business_domain / cg_* / risk / score / waiver surface.
  FOR v_entry IN
    SELECT e.sig, e.params, e.needles FROM (VALUES
      ('gov_repo.l14_read_passport_governance_v1(uuid,uuid,bigint,bigint,timestamp with time zone,text,text,timestamp with time zone,timestamp with time zone)',
       'p_verified_organisation_id,p_verified_actor_user_id,p_verified_session_iat,p_verified_session_exp,p_verified_credential_epoch,p_agent_canonical_object_id,p_agent_version_canonical_object_id,p_effective_at,p_recorded_cutoff',
       ARRAY['gov_repo.l14_responsibility_assignments_current_v1(','gov_repo.l14_business_context_assignments_current_v1(',
             'gov_repo.l14_policy_applicabilities_current_v1(','gov_repo.l14_control_applicabilities_current_v1(',
             'gov_repo.l14_control_assessments_current_v1(']),
      ('gov_repo.l14_read_fact_conflict_v1(uuid,uuid,bigint,bigint,timestamp with time zone,text,text,text,text,text,text,text,uuid,text,uuid,uuid,uuid,timestamp with time zone,timestamp with time zone)',
       'p_verified_organisation_id,p_verified_actor_user_id,p_verified_session_iat,p_verified_session_exp,p_verified_credential_epoch,p_subject_kind,p_target_type,p_target_canonical_kind,p_target_canonical_object_id,p_target_relationship_id,p_target_relationship_state_id,p_responsibility_role,p_governance_party_id,p_semantic_kind,p_policy_id,p_control_definition_id,p_control_applicability_state_id,p_effective_at,p_recorded_cutoff',
       ARRAY['gov_repo.l14_responsibility_assignment_valid_state_v1(','gov_repo.l14_business_context_assignment_valid_state_v1(',
             'gov_repo.l14_policy_applicability_valid_state_v1(','gov_repo.l14_control_applicability_valid_state_v1(',
             'gov_repo.l14_control_assessment_valid_state_v1('])
    ) AS e(sig, params, needles)
  LOOP
    v_oid := pg_catalog.to_regprocedure(v_entry.sig);
    IF v_oid IS NULL THEN
      RAISE EXCEPTION 'M16_RP_POSTFLIGHT: projection % missing', v_entry.sig;
    END IF;
    SELECT p.prosrc, p.provolatile, p.prosecdef, p.proowner, p.proconfig, p.proargnames, p.proargmodes, p.pronargs
    INTO v_proc FROM pg_catalog.pg_proc AS p WHERE p.oid = v_oid;
    IF NOT v_proc.prosecdef OR v_proc.provolatile <> 'v' OR pg_catalog.pg_get_userbyid(v_proc.proowner) <> 'postgres'
       OR COALESCE(pg_catalog.array_to_string(v_proc.proconfig, ';'), '-') <> 'search_path=pg_catalog, pg_temp;lock_timeout=5s'
       OR pg_catalog.array_to_string(v_proc.proargnames[1:v_proc.pronargs], ',') <> v_entry.params THEN
      RAISE EXCEPTION 'M16_RP_POSTFLIGHT: projection % shape / owner / config drifted', v_oid::regprocedure;
    END IF;
    IF pg_catalog.strpos(v_proc.prosrc, 'PERFORM 1 FROM gov_repo.l14_session_basis_v1(p_verified_organisation_id') = 0
       OR pg_catalog.strpos(v_proc.prosrc, 'PERFORM 1 FROM gov_repo.l14_session_basis_v1(p_verified_organisation_id')
          > pg_catalog.strpos(v_proc.prosrc, 'RETURN QUERY')
       OR EXISTS (SELECT 1 FROM pg_catalog.unnest(v_entry.needles) AS n(x) WHERE pg_catalog.strpos(v_proc.prosrc, n.x) = 0) THEN
      RAISE EXCEPTION 'M16_RP_POSTFLIGHT: projection % does not revalidate the session first or bypasses a reused resolver', v_oid::regprocedure;
    END IF;
    IF v_proc.prosrc ~* '(\mINSERT\M|\mUPDATE\M|\mDELETE\M|\mTRUNCATE\M|\mMERGE\M|\mCOPY\M|\mEXECUTE\M|\mCREATE\M|\mALTER\M|\mDROP\M|\mGRANT\M|\mREVOKE\M|nextval|setval|advisory|FOR\s+(NO\s+KEY\s+)?(UPDATE|SHARE)|\mLOCK\M)'
       OR v_proc.prosrc ~ '(^|[^A-Za-z0-9_$])(governance_policies|policy_versions|governance_party_directory_profiles)([^A-Za-z0-9_$]|$)'
       OR v_proc.prosrc ~ '(_heads\M|\magents\M|\mbusiness_domain\M|\mowner_(user_id|name|email|id)\M|\mcg_(ag|sys)_|\mcontrol_assessments\M)'
       OR v_proc.prosrc ~* '(risk|score|coverage|maturity|waiv|confidence|finding|llm|scanner)' THEN
      RAISE EXCEPTION 'M16_RP_POSTFLIGHT: projection % writes, locks, reads a head / legacy / content / directory / score surface', v_oid::regprocedure;
    END IF;
  END LOOP;

  -- P4. Every l14 routine: pinned search_path, no PUBLIC/anon/authenticated EXECUTE; the twenty-nine public RPCs are
  --     SECURITY DEFINER + service_role-only; every other l14 routine (incl. every reused resolver) is an owner-only
  --     SECURITY INVOKER helper.
  FOR v_fn IN
    SELECT p.oid, p.proname, p.proowner, p.proacl, p.prosecdef, p.proconfig
    FROM pg_catalog.pg_proc AS p
    WHERE p.pronamespace = 'gov_repo'::regnamespace AND p.proname LIKE 'l14\_%' ESCAPE '\'
  LOOP
    IF EXISTS (SELECT 1 FROM pg_catalog.aclexplode(COALESCE(v_fn.proacl, pg_catalog.acldefault('f', v_fn.proowner))) AS a
               WHERE a.privilege_type = 'EXECUTE' AND a.grantee = 0) THEN
      RAISE EXCEPTION 'M16_RP_POSTFLIGHT: % has PUBLIC EXECUTE', v_fn.proname;
    END IF;
    FOREACH v_role IN ARRAY ARRAY['anon','authenticated'] LOOP
      IF pg_catalog.has_function_privilege(v_role, v_fn.oid, 'EXECUTE') THEN
        RAISE EXCEPTION 'M16_RP_POSTFLIGHT: % executable by %', v_fn.proname, v_role;
      END IF;
    END LOOP;
    IF NOT COALESCE(v_fn.proconfig @> ARRAY['search_path=pg_catalog, pg_temp'], false) THEN
      RAISE EXCEPTION 'M16_RP_POSTFLIGHT: % search_path not pinned to pg_catalog, pg_temp', v_fn.proname;
    END IF;
    IF v_fn.proname::text = ANY (v_public_l14) THEN
      IF NOT v_fn.prosecdef OR NOT pg_catalog.has_function_privilege('service_role', v_fn.oid, 'EXECUTE')
         OR EXISTS (SELECT 1 FROM pg_catalog.aclexplode(v_fn.proacl) AS a
                    WHERE a.grantee NOT IN (v_fn.proowner, 'service_role'::regrole::oid)
                       OR (a.grantee = 'service_role'::regrole::oid AND a.privilege_type <> 'EXECUTE')) THEN
        RAISE EXCEPTION 'M16_RP_POSTFLIGHT: public RPC % ACL/definer shape wrong', v_fn.proname;
      END IF;
    ELSIF v_fn.prosecdef OR EXISTS (SELECT 1 FROM pg_catalog.aclexplode(COALESCE(v_fn.proacl,
            pg_catalog.acldefault('f', v_fn.proowner))) AS a WHERE a.grantee <> v_fn.proowner) THEN
      RAISE EXCEPTION 'M16_RP_POSTFLIGHT: internal helper % must be owner-only SECURITY INVOKER', v_fn.proname;
    END IF;
  END LOOP;
  IF (SELECT pg_catalog.array_agg(p.proname::text ORDER BY p.proname::text COLLATE "C") FROM pg_catalog.pg_proc AS p
      WHERE p.pronamespace = 'gov_repo'::regnamespace AND p.proname LIKE 'l14\_%' ESCAPE '\'
        AND pg_catalog.has_function_privilege('service_role', p.oid, 'EXECUTE')) IS DISTINCT FROM v_public_l14
     OR (SELECT pg_catalog.count(*) FROM pg_catalog.pg_proc AS p
         WHERE p.pronamespace = 'gov_repo'::regnamespace AND p.proname LIKE 'l14\_%' ESCAPE '\' AND p.prosecdef) <> 29
     OR (SELECT pg_catalog.count(*) FROM pg_catalog.pg_proc AS p
         WHERE p.pronamespace = 'gov_repo'::regnamespace AND p.proname::text = ANY (v_new_rpcs)) <> 2 THEN
    RAISE EXCEPTION 'M16_RP_POSTFLIGHT: the public L14 RPC surface must be exactly the twenty-seven post-S1C.5 + two read-projection RPCs (no overloads)';
  END IF;

  -- P5. Closed application SECURITY DEFINER surface: exactly 45 approved identities (exact owner class, body hash, config,
  --     service_role-only EXECUTE, no overload); exactly 35 canonical-owner (policy-store-capable) definers. The capability
  --     class reflects OWNER capability: the two projections are proven (P3, below) never to reach a policy store.
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
      ('gov_repo.l14_submit_control_applicability_proposal_v1(uuid,uuid,bigint,bigint,timestamp with time zone,text,text,text,text,text,text,text,text,uuid,uuid,text,uuid,text,timestamp with time zone,timestamp with time zone,uuid,uuid,text,text[],text)', 'postgres', 'f8dbc5f51742c015cd29bd361dae67c2abd43f66866c5199c46afdf02abcd844', 'search_path=pg_catalog, pg_temp;lock_timeout=5s'),
      ('gov_repo.l14_decide_control_applicability_proposal_v1(uuid,uuid,bigint,bigint,timestamp with time zone,text,uuid,text,text,uuid,text,text[],text)', 'postgres', '28f1855d9599d8f204dd7123469f0d1fe1661458b16f95bbac8df53458c72b3a', 'search_path=pg_catalog, pg_temp;lock_timeout=5s'),
      ('gov_repo.l14_submit_control_assessment_proposal_v1(uuid,uuid,bigint,bigint,timestamp with time zone,text,text,text,uuid,text,timestamp with time zone,timestamp with time zone,uuid,uuid,text,text[],text)', 'postgres', 'de9363e0dae5988faedfeb8cb31ff4af99a739624df92b611bf078c8f5346ea1', 'search_path=pg_catalog, pg_temp;lock_timeout=5s'),
      ('gov_repo.l14_decide_control_assessment_proposal_v1(uuid,uuid,bigint,bigint,timestamp with time zone,text,uuid,text,text,uuid,text,text[],text)', 'postgres', 'c782bf86dc1de2d6ddba5c4c9c916ecf42587df8f1e668816da36fc89831e030', 'search_path=pg_catalog, pg_temp;lock_timeout=5s'),
      ('gov_repo.ledger_append(character varying,text,character varying,uuid,uuid,inet,uuid,jsonb)', 'govia_ledger_executor', '8137f591bdd717ef18cbdc8b6146aab349626903aa9d080cebe55806190ae830', 'search_path=pg_catalog, {crypto}, pg_temp'),
      ('gov_repo.ledger_verify(bigint,bigint)', 'govia_ledger_executor', 'd52b7bc1d274cb11dd7ef4d3424d4056deba1df9846eb1195007f3695e091ec4', 'search_path=pg_catalog, {crypto}, pg_temp'),
      ('gov_repo.record_execution_snapshot(uuid,jsonb,text)', 'govia_runtime_executor', '882431691b588cedab4a7b6c2c947d834e48a3a9a7f9a94e43dc3782d6786f29', 'search_path=pg_catalog, pg_temp'),
      ('gov_repo.admit_runtime_observation(uuid,text,gov_repo.runtime_observations)', 'govia_runtime_executor', '9b6284dd7ca92f092fa567ff48e9ac3eae33f906c9653e9c4b204c04f1c51a18', 'search_path=pg_catalog, pg_temp'),
      ('gov_repo.read_runtime_observation_exact(uuid,gov_repo.runtime_reference,uuid)', 'govia_runtime_executor', 'eebbe4336fe8e5349d73c46d84c32c832bf6c283ac65dc7ddb062da0b73ffae0', 'search_path=pg_catalog, pg_temp'),
      ('gov_repo.record_cross_signal_comparison_result(uuid,text,jsonb)', 'govia_runtime_executor', '3771019f3c6291e866837703f2af100609f85c37603f8e2d82161436c713e84c', 'search_path=pg_catalog, pg_temp'),
      ('gov_repo.agent_compliance_gaps(uuid)', 'govia_legacy_read_executor', '2e27745223cfdd30f1ba41ffd6b0d0cb8fb61d1edf6cd5776be9915709d140a6', 'search_path=pg_catalog, pg_temp'),
      ('gov_repo.agent_graph_traverse(uuid,integer,gov_repo.edge_relationship[],boolean)', 'govia_legacy_read_executor', '568376c6d24590874162cc7e2db555219d501eb0f60168c30e7963cf8996c555', 'search_path=pg_catalog, pg_temp'),
      ('gov_repo.agent_semantic_search({vector},uuid,character varying,integer,numeric)', 'govia_legacy_read_executor', '0a53e2a91844531902963aa4ca55f6eaa375b15d09898f46ebbe3bbe19213f4f', 'search_path=pg_catalog, {vschema}, pg_temp'),
      ('gov_repo.recompute_risk_propagation(uuid,uuid)', 'govia_legacy_graph_executor', 'b5f6edac53c2c5acdda60729e5ad9de0956e407c829aaedbea3f4002e793b96c', 'search_path=pg_catalog, pg_temp'),
      ('gov_repo.l14_read_passport_governance_v1(uuid,uuid,bigint,bigint,timestamp with time zone,text,text,timestamp with time zone,timestamp with time zone)', 'postgres', '1d99930bd7569148637d137387410b774c221f48770f1d77a3080004e8ceca47', 'search_path=pg_catalog, pg_temp;lock_timeout=5s'),
      ('gov_repo.l14_read_fact_conflict_v1(uuid,uuid,bigint,bigint,timestamp with time zone,text,text,text,text,text,text,text,uuid,text,uuid,uuid,uuid,timestamp with time zone,timestamp with time zone)', 'postgres', 'c63485ed0e6a6be770f12e93a4d8eae010e324b341f214f748eae3e59a5ff9ca', 'search_path=pg_catalog, pg_temp;lock_timeout=5s')
    ) AS m(sig, owner_role, sha, cfg)
  LOOP
    v_oid := pg_catalog.to_regprocedure(pg_catalog.replace(v_entry.sig, '{vector}', pg_catalog.quote_ident(v_vector) || '.vector'));
    IF v_oid IS NULL THEN
      RAISE EXCEPTION 'M16_RP_POSTFLIGHT: approved routine % missing', v_entry.sig;
    END IF;
    SELECT p.proname, p.pronamespace, p.prosecdef, p.proowner, p.prosrc, p.proconfig, p.proacl INTO v_proc
    FROM pg_catalog.pg_proc AS p WHERE p.oid = v_oid;
    IF NOT v_proc.prosecdef THEN
      RAISE EXCEPTION 'M16_RP_POSTFLIGHT: % is not SECURITY DEFINER', v_oid::regprocedure;
    END IF;
    IF pg_catalog.pg_get_userbyid(v_proc.proowner) <> v_entry.owner_role THEN
      RAISE EXCEPTION 'M16_RP_POSTFLIGHT: % owner % is not %', v_oid::regprocedure, pg_catalog.pg_get_userbyid(v_proc.proowner), v_entry.owner_role;
    END IF;
    IF pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(v_proc.prosrc, 'UTF8')), 'hex') <> v_entry.sha THEN
      RAISE EXCEPTION 'M16_RP_POSTFLIGHT: % body hash changed', v_oid::regprocedure;
    END IF;
    IF COALESCE(pg_catalog.array_to_string(v_proc.proconfig, ';'), '-') <>
       pg_catalog.replace(pg_catalog.replace(v_entry.cfg, '{crypto}', pg_catalog.quote_ident(v_crypto)), '{vschema}', pg_catalog.quote_ident(v_vector)) THEN
      RAISE EXCEPTION 'M16_RP_POSTFLIGHT: % config changed: %', v_oid::regprocedure, v_proc.proconfig;
    END IF;
    IF NOT pg_catalog.has_function_privilege('service_role', v_oid, 'EXECUTE')
       OR pg_catalog.has_function_privilege('anon', v_oid, 'EXECUTE')
       OR pg_catalog.has_function_privilege('authenticated', v_oid, 'EXECUTE')
       OR EXISTS (SELECT 1 FROM pg_catalog.aclexplode(COALESCE(v_proc.proacl, pg_catalog.acldefault('f', v_proc.proowner))) AS a
                  WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE') THEN
      RAISE EXCEPTION 'M16_RP_POSTFLIGHT: % application EXECUTE is not exactly service_role', v_oid::regprocedure;
    END IF;
    IF v_proc.proname::text = ANY (v_new_rpcs)
       AND EXISTS (SELECT 1 FROM pg_catalog.aclexplode(v_proc.proacl) AS a
                   WHERE a.grantee NOT IN (v_proc.proowner, 'service_role'::regrole::oid) OR (a.grantee = 'service_role'::regrole::oid AND a.privilege_type <> 'EXECUTE')) THEN
      RAISE EXCEPTION 'M16_RP_POSTFLIGHT: % EXECUTE ACL is not exactly owner + service_role', v_oid::regprocedure;
    END IF;
    IF (SELECT pg_catalog.count(*) FROM pg_catalog.pg_proc AS p WHERE p.pronamespace = v_proc.pronamespace AND p.proname = v_proc.proname) <> 1 THEN
      RAISE EXCEPTION 'M16_RP_POSTFLIGHT: overload of approved routine %', v_oid::regprocedure;
    END IF;
    v_approved := v_approved || v_oid;
    IF v_entry.owner_role = 'postgres' THEN
      IF v_proc.proowner <> ALL (v_capable) THEN
        RAISE EXCEPTION 'M16_RP_POSTFLIGHT: canonical L14/S0 owner of % unexpectedly lost policy-store capability', v_oid::regprocedure;
      END IF;
      v_frozen := v_frozen || v_oid;
    ELSIF v_proc.proowner = ANY (v_capable) THEN
      RAISE EXCEPTION 'M16_RP_POSTFLIGHT: owner of % has policy-store capability', v_oid::regprocedure;
    END IF;
  END LOOP;
  IF pg_catalog.cardinality(v_approved) <> 45 OR pg_catalog.cardinality(v_frozen) <> 35 THEN
    RAISE EXCEPTION 'M16_RP_POSTFLIGHT: approved surface is not exactly 45 (35 policy-store-capable)';
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
      RAISE EXCEPTION 'M16_RP_POSTFLIGHT: CLOSED_SURFACE unapproved application-executable SECURITY DEFINER %', v_row.oid::regprocedure;
    END IF;
    IF v_row.proowner = ANY (v_capable) AND v_row.oid <> ALL (v_frozen) THEN
      RAISE EXCEPTION 'M16_RP_POSTFLIGHT: POLICY_STORE_OWNER application definer % outside the approved 35', v_row.oid::regprocedure;
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
                          WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE'))) <> 45 THEN
    RAISE EXCEPTION 'M16_RP_POSTFLIGHT: application SECURITY DEFINER surface is not exactly 45';
  END IF;
  -- Every application definer that can reach a policy store is one of the 35 approved canonical-owner RPCs (neither
  -- projection reaches one: neither by body text nor by a catalog dependency).
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
      RAISE EXCEPTION 'M16_RP_POSTFLIGHT: application definer % reaches a policy store outside the approved 35', v_fn.oid::regprocedure;
    END IF;
    IF v_fn.proname::text = ANY (v_new_rpcs) THEN
      RAISE EXCEPTION 'M16_RP_POSTFLIGHT: read projection % reaches a policy store', v_fn.oid::regprocedure;
    END IF;
  END LOOP;

  -- P6. Default privileges: postgres-created routines (global + gov_repo) grant EXECUTE to neither PUBLIC nor an
  --     application role.
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_default_acl AS d
                 WHERE d.defaclrole = 'postgres'::regrole AND d.defaclnamespace = 0 AND d.defaclobjtype = 'f')
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_default_acl AS d CROSS JOIN LATERAL pg_catalog.aclexplode(d.defaclacl) AS a
                WHERE d.defaclrole = 'postgres'::regrole AND d.defaclobjtype = 'f' AND a.privilege_type = 'EXECUTE'
                  AND d.defaclnamespace IN (0, 'gov_repo'::regnamespace)
                  AND (a.grantee = 0 OR a.grantee IN (SELECT r.oid FROM pg_catalog.pg_roles AS r WHERE r.rolname = ANY (v_app)))) THEN
    RAISE EXCEPTION 'M16_RP_POSTFLIGHT: postgres routine default privileges grant PUBLIC / application EXECUTE';
  END IF;

  -- P7. No view (any schema, transitive) and no sequence exposes L14 history to an application role; no inheritance.
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_inherits AS i JOIN pg_catalog.pg_class AS c ON c.oid IN (i.inhrelid, i.inhparent)
             WHERE c.relnamespace = 'gov_repo'::regnamespace AND c.relname::text = ANY (v_expected_l14)) THEN
    RAISE EXCEPTION 'M16_RP_POSTFLIGHT: inheritance involves L14 history';
  END IF;
  FOR v_rel IN
    WITH RECURSIVE l14(oid) AS (
      SELECT c.oid FROM pg_catalog.pg_class AS c
      WHERE c.relnamespace = 'gov_repo'::regnamespace AND c.relname::text = ANY (v_expected_l14)
    ), reach(oid) AS (
      SELECT w.ev_class FROM pg_catalog.pg_rewrite AS w
      JOIN pg_catalog.pg_depend AS d ON d.classid = 'pg_catalog.pg_rewrite'::regclass AND d.objid = w.oid
      WHERE d.refclassid = 'pg_catalog.pg_class'::regclass AND d.refobjid IN (SELECT l14.oid FROM l14)
        AND w.ev_class NOT IN (SELECT l14.oid FROM l14)
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
      RAISE EXCEPTION 'M16_RP_POSTFLIGHT: view % reaching L14 history has a PUBLIC grant', v_rel.relname;
    END IF;
    FOREACH v_role IN ARRAY v_app LOOP
      FOREACH v_privilege IN ARRAY v_privileges LOOP
        IF pg_catalog.has_table_privilege(v_role, v_rel.oid, v_privilege) THEN
          RAISE EXCEPTION 'M16_RP_POSTFLIGHT: % holds % on view % reaching L14 history', v_role, v_privilege, v_rel.relname;
        END IF;
      END LOOP;
      IF pg_catalog.has_any_column_privilege(v_role, v_rel.oid, 'SELECT, INSERT, UPDATE, REFERENCES') THEN
        RAISE EXCEPTION 'M16_RP_POSTFLIGHT: % holds a column privilege on view % reaching L14 history', v_role, v_rel.relname;
      END IF;
    END LOOP;
  END LOOP;
  FOR v_rel IN
    SELECT DISTINCT s.oid, s.relname FROM pg_catalog.pg_class AS s
    JOIN pg_catalog.pg_depend AS d ON d.classid = 'pg_catalog.pg_class'::regclass AND d.objid = s.oid
    JOIN pg_catalog.pg_class AS t ON t.oid = d.refobjid
    WHERE s.relkind = 'S' AND d.refclassid = 'pg_catalog.pg_class'::regclass
      AND t.relnamespace = 'gov_repo'::regnamespace AND t.relname::text = ANY (v_expected_l14)
  LOOP
    FOREACH v_role IN ARRAY v_app LOOP
      IF pg_catalog.has_sequence_privilege(v_role, v_rel.oid, 'USAGE') OR pg_catalog.has_sequence_privilege(v_role, v_rel.oid, 'SELECT')
         OR pg_catalog.has_sequence_privilege(v_role, v_rel.oid, 'UPDATE') THEN
        RAISE EXCEPTION 'M16_RP_POSTFLIGHT: % holds a privilege on sequence %', v_role, v_rel.relname;
      END IF;
    END LOOP;
  END LOOP;

  -- P8. Frozen enumerations: exactly 11 canonical object kinds, 12 governed relationship types, five fact families.
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
                            'USES_MODEL','USES_PROMPT','USES_SKILL','USES_TOOL','WRITES_TO']
     OR (SELECT pg_catalog.array_agg(m.v[1] ORDER BY m.v[1] COLLATE "C")
      FROM pg_catalog.pg_constraint AS k
      CROSS JOIN LATERAL pg_catalog.regexp_matches(pg_catalog.pg_get_constraintdef(k.oid), '''([A-Z_]+)''', 'g') AS m(v)
      WHERE k.conrelid = 'gov_repo.l14_fact_states'::regclass AND k.conname = 'l14_fact_states_subject_kind_check')
     IS DISTINCT FROM ARRAY['BUSINESS_CONTEXT_ASSIGNMENT','CONTROL_APPLICABILITY','CONTROL_ASSESSMENT','POLICY_APPLICABILITY',
                            'RESPONSIBILITY_ASSIGNMENT'] THEN
    RAISE EXCEPTION 'M16_RP_POSTFLIGHT: canonical kinds (11) / relationship types (12) / fact families (5) changed';
  END IF;

  -- P9. F2: nothing on the L14 / policy surface references canonical_relationships by FK; it carries no trigger; no
  --     uniqueness / index / constraint involves relationship_state_id on it.
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
    RAISE EXCEPTION 'M16_RP_POSTFLIGHT: F2 boundary violated';
  END IF;
END;
$postflight$;

COMMIT;
