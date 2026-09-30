-- M16-S1B.2R1: capability-based closure of the application SECURITY DEFINER surface (DB only, ADDITIVE).
-- Architecture-owner rulings for M16-S1B.2R1 (capability ownership, expanded surface, noncanonical-root
-- quarantine). supabase/migrations is the ONLY canonical Governance Core migration authority; the
-- noncanonical roots (apps/dashboard/supabase-setup-8.2.sql, apps/extension/supabase/migrations,
-- graphos-complete/supabase/migrations) never expand the approved surface. No historical migration is
-- edited, no routine body is changed, no policy-store ACL/semantics change. Never run against a hosted DB
-- from this slice.
--
-- The authority boundary is EFFECTIVE CAPABILITY, not source text:
--   Control A (closed surface): every SECURITY DEFINER routine that PUBLIC/anon/authenticated/service_role
--     can execute (effective privilege, incl. inherited roles and defaults) must be one of EXACTLY 22
--     approved identities, each with its exact owner class, body hash, config and service_role-only EXECUTE.
--   Control B (least-privilege owner): only the frozen 12 (six S0 *_governed_v1 wrappers + six L14 RPCs,
--     bodies untouched) may run as an owner with ANY effective access to gov_repo.governance_policies /
--     gov_repo.policy_versions. The other 10 run as dedicated NOLOGIN / NOBYPASSRLS technical owners with
--     exact grants, role-specific RLS policies and zero policy-store capability:
--       govia_ledger_executor       ledger_append, ledger_verify
--       govia_runtime_executor      record_execution_snapshot, admit_runtime_observation,
--                                   read_runtime_observation_exact, record_cross_signal_comparison_result
--       govia_legacy_read_executor  agent_compliance_gaps, agent_graph_traverse, agent_semantic_search
--       govia_legacy_graph_executor recompute_risk_propagation (may execute exactly agent_graph_traverse)
-- Also: public.gov_exec / public.gov_exec_dml (any overload) lose application EXECUTE (never approvable);
-- the five consumer-less legacy definers and the GraphOS trigger functions lose application EXECUTE; the
-- obsolete setup-8.2 ledger_append(text,...) overload is dropped (no CASCADE); M008E / coding-memory drift
-- fails closed; new postgres-created routines no longer default to PUBLIC / service_role EXECUTE.
-- canonical_relationships: READ ONLY (one SELECT policy for the runtime owner); no DML, no structural DDL.
BEGIN;

-- ---------------------------------------------------------------------------------------
-- A. Preflight: the exact audited canonical surface, or abort with nothing applied.
-- ---------------------------------------------------------------------------------------
DO $preflight$
DECLARE
  v_crypto name;
  v_vector name;
  v_entry record;
  v_proc record;
  v_oid oid;
  v_role text;
BEGIN
  IF pg_catalog.current_setting('server_version_num')::integer < 160000 THEN
    RAISE EXCEPTION 'M16_S1B2R1_PREFLIGHT: PostgreSQL 16+ required (role SET option)' USING ERRCODE = '55000';
  END IF;
  SELECT e.extnamespace::regnamespace::name INTO v_crypto FROM pg_catalog.pg_extension AS e WHERE e.extname = 'pgcrypto';
  IF v_crypto IS NULL OR pg_catalog.to_regprocedure(pg_catalog.format('%I.digest(text,text)', v_crypto)) IS NULL
     OR pg_catalog.to_regprocedure(pg_catalog.format('%I.digest(bytea,text)', v_crypto)) IS NULL THEN
    RAISE EXCEPTION 'M16_S1B2R1_PREFLIGHT: pgcrypto digest() unresolved' USING ERRCODE = '55000';
  END IF;
  SELECT e.extnamespace::regnamespace::name INTO v_vector FROM pg_catalog.pg_extension AS e WHERE e.extname = 'vector';
  IF v_vector IS NULL THEN
    RAISE EXCEPTION 'M16_S1B2R1_PREFLIGHT: vector extension unresolved' USING ERRCODE = '55000';
  END IF;

  -- Noncanonical roots (quarantined; never auto-adopted, re-owned or rewritten).
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_proc AS p
             WHERE p.pronamespace = 'gov_repo'::regnamespace AND p.proname IN ('log_agent_event', 'compute_cg_ag_008'))
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_proc AS p
                WHERE p.pronamespace = 'gov_repo'::regnamespace AND p.proname = 'update_agent_compliance_flags' AND p.prosecdef) THEN
    RAISE EXCEPTION 'NONCANONICAL_GOVERNANCE_ROOT_CONFLICT'
      USING ERRCODE = '55000', DETAIL = 'apps/extension M008E governance objects present in the target catalog';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_proc AS p WHERE p.pronamespace = 'gov_repo'::regnamespace AND p.proname = 'coding_memory_search') THEN
    RAISE EXCEPTION 'NONCANONICAL_TARGET_DRIFT'
      USING ERRCODE = '55000', DETAIL = 'gov_repo.coding_memory_search present (S1B2-I4 CODING_MEMORY_CONTROLLED_READ)';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_proc AS p
             WHERE p.pronamespace = 'gov_repo'::regnamespace AND p.proname = 'ledger_append'
               AND p.oid <> ALL (ARRAY[
                 pg_catalog.to_regprocedure('gov_repo.ledger_append(character varying,text,character varying,uuid,uuid,inet,uuid,jsonb)'),
                 pg_catalog.to_regprocedure('gov_repo.ledger_append(text,text,text,uuid,uuid,text,uuid,jsonb)')]::oid[])) THEN
    RAISE EXCEPTION 'NONCANONICAL_GOVERNANCE_ROOT_CONFLICT' USING ERRCODE = '55000', DETAIL = 'unexpected gov_repo.ledger_append overload';
  END IF;

  -- The 22 approved identities exist exactly as audited (owner postgres before R1, exact body/config, no overload).
  FOR v_entry IN
    SELECT m.sig, m.frozen, m.sha, m.cfg FROM (VALUES
      ('gov_repo.apply_review_transition_governed_v1(uuid,uuid,bigint,bigint,timestamp with time zone,text,text,text,text,timestamp with time zone,text[],text,text,text)', true, 'b47d560eed2d1e2239351bd3767a6c600ef43e251ac0f13e807a2cb7a89f665f', 'search_path=pg_catalog, pg_temp'),
      ('gov_repo.materialize_object_reconciliation_governed_v1(uuid,uuid,bigint,bigint,timestamp with time zone,text,text,text,text,text,text,text,text,text,character,timestamp with time zone)', true, 'ad76acbb25928f7e99c43bc37555c8a1f63209b2e9f8a4dc8951590d63964bca', 'search_path=pg_catalog, pg_temp'),
      ('gov_repo.materialize_relationship_reconciliation_governed_v1(uuid,uuid,bigint,bigint,timestamp with time zone,text,text,text,text,text,text,text,text,text,text,timestamp with time zone,timestamp with time zone,character)', true, '674f7e599e0f62548c780c3d6bbe4072cd6b75916f5c2b10a9426e69da861ad2', 'search_path=pg_catalog, pg_temp'),
      ('gov_repo.record_authorized_reconciliation_governed_v1(uuid,uuid,bigint,bigint,timestamp with time zone,text,text,text,text,text,text,timestamp with time zone,text,text,text,text,timestamp with time zone,text,text,text,text,text,timestamp with time zone,text,text,text,text,text,text,text,text[],text[],text[],text,jsonb,character)', true, '9ea6a32aa6b0c8da368f5ccd51b3c50fe5c7be466c3ff124653101f8a4575ae5', 'search_path=pg_catalog, pg_temp'),
      ('gov_repo.record_execution_field_decision_governed_v1(uuid,uuid,bigint,bigint,timestamp with time zone,jsonb)', true, 'dcb2d3a0b10a179b1506a12475dddcd3fbf486e266aa53af2cdaccddc8fb2994', 'search_path=pg_catalog, pg_temp'),
      ('gov_repo.record_technical_field_decision_governed_v1(uuid,uuid,bigint,bigint,timestamp with time zone,jsonb)', true, 'dfe58ec4f8f1389d282e9f439a94b58716395901eb2a460da9ad0e2ca1184b7c', 'search_path=pg_catalog, pg_temp'),
      ('gov_repo.l14_admit_authority_policy_version_v1(uuid,uuid,bigint,bigint,timestamp with time zone,text,uuid,uuid,text,jsonb,text,text[],text)', true, '3d732c3bb2615648bc333eb1b5c3c7971541b882b4745a388f737d1ac40b249e', 'search_path=pg_catalog, pg_temp;lock_timeout=5s'),
      ('gov_repo.l14_submit_proposal_v1(uuid,uuid,bigint,bigint,timestamp with time zone,text,text,text,text,uuid,uuid,text,timestamp with time zone,uuid,uuid,text,text[],text)', true, '28d1cace2a21401721c8e090f1d21864d7e3fcc51a8ff5e0574444c4f963e1c1', 'search_path=pg_catalog, pg_temp;lock_timeout=5s'),
      ('gov_repo.l14_decide_authority_policy_proposal_v1(uuid,uuid,bigint,bigint,timestamp with time zone,text,uuid,text,text,uuid,text,text[],text)', true, 'ac02a255a31a4e1c3da6cdba12ff9515ecb36d9362a79547aa8d140edb95cf94', 'search_path=pg_catalog, pg_temp;lock_timeout=5s'),
      ('gov_repo.l14_admit_governance_party_v1(uuid,uuid,bigint,bigint,timestamp with time zone,text,text,text,text,text,text[],text)', true, 'ca1e2ddf0342352993d07583c65a9f1be8b0779807aca39637e63ad62e977ac0', 'search_path=pg_catalog, pg_temp;lock_timeout=5s'),
      ('gov_repo.l14_submit_governance_party_proposal_v1(uuid,uuid,bigint,bigint,timestamp with time zone,text,text,text,uuid,text,timestamp with time zone,uuid,uuid,text,text[],text)', true, '6e9edcd7d85a9fc4c65cd4da8c96953e95798ab1b75e6356c00c348d1827cc5f', 'search_path=pg_catalog, pg_temp;lock_timeout=5s'),
      ('gov_repo.l14_decide_governance_party_proposal_v1(uuid,uuid,bigint,bigint,timestamp with time zone,text,uuid,text,text,uuid,text,text[],text)', true, '9cdf1725acbd78be30124efd1bb8e5852dcc419f479685404bde309b99bf90b3', 'search_path=pg_catalog, pg_temp;lock_timeout=5s'),
      ('gov_repo.ledger_append(character varying,text,character varying,uuid,uuid,inet,uuid,jsonb)', false, '8137f591bdd717ef18cbdc8b6146aab349626903aa9d080cebe55806190ae830', '-'),
      ('gov_repo.ledger_verify(bigint,bigint)', false, 'd52b7bc1d274cb11dd7ef4d3424d4056deba1df9846eb1195007f3695e091ec4', '-'),
      ('gov_repo.record_execution_snapshot(uuid,jsonb,text)', false, '882431691b588cedab4a7b6c2c947d834e48a3a9a7f9a94e43dc3782d6786f29', 'search_path=pg_catalog'),
      ('gov_repo.admit_runtime_observation(uuid,text,gov_repo.runtime_observations)', false, '9b6284dd7ca92f092fa567ff48e9ac3eae33f906c9653e9c4b204c04f1c51a18', 'search_path=pg_catalog'),
      ('gov_repo.read_runtime_observation_exact(uuid,gov_repo.runtime_reference,uuid)', false, 'eebbe4336fe8e5349d73c46d84c32c832bf6c283ac65dc7ddb062da0b73ffae0', 'search_path=pg_catalog'),
      ('gov_repo.record_cross_signal_comparison_result(uuid,text,jsonb)', false, '3771019f3c6291e866837703f2af100609f85c37603f8e2d82161436c713e84c', 'search_path=pg_catalog'),
      ('gov_repo.agent_compliance_gaps(uuid)', false, '2e27745223cfdd30f1ba41ffd6b0d0cb8fb61d1edf6cd5776be9915709d140a6', '-'),
      ('gov_repo.agent_graph_traverse(uuid,integer,gov_repo.edge_relationship[],boolean)', false, '568376c6d24590874162cc7e2db555219d501eb0f60168c30e7963cf8996c555', '-'),
      ('gov_repo.agent_semantic_search({vector},uuid,character varying,integer,numeric)', false, '0a53e2a91844531902963aa4ca55f6eaa375b15d09898f46ebbe3bbe19213f4f', '-'),
      ('gov_repo.recompute_risk_propagation(uuid,uuid)', false, 'b5f6edac53c2c5acdda60729e5ad9de0956e407c829aaedbea3f4002e793b96c', '-')
    ) AS m(sig, frozen, sha, cfg)
  LOOP
    v_oid := pg_catalog.to_regprocedure(pg_catalog.replace(v_entry.sig, '{vector}', pg_catalog.quote_ident(v_vector) || '.vector'));
    IF v_oid IS NULL THEN
      RAISE EXCEPTION 'M16_S1B2R1_PREFLIGHT: approved routine % missing', v_entry.sig USING ERRCODE = '55000';
    END IF;
    SELECT p.proname, p.pronamespace, p.prosecdef, p.proowner, p.prosrc, p.proconfig INTO v_proc FROM pg_catalog.pg_proc AS p WHERE p.oid = v_oid;
    IF NOT v_proc.prosecdef OR v_proc.proowner <> 'postgres'::regrole
       OR pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(v_proc.prosrc, 'UTF8')), 'hex') <> v_entry.sha
       OR COALESCE(pg_catalog.array_to_string(v_proc.proconfig, ';'), '-') <> v_entry.cfg THEN
      IF v_entry.frozen THEN
        RAISE EXCEPTION 'M16_S1B2R1_PREFLIGHT: frozen routine % differs from its audited owner/body/config', v_oid::regprocedure USING ERRCODE = '55000';
      END IF;
      RAISE EXCEPTION 'NONCANONICAL_GOVERNANCE_ROOT_CONFLICT'
        USING ERRCODE = '55000', DETAIL = pg_catalog.format('%s differs from its canonical owner/body/config', v_oid::regprocedure);
    END IF;
    IF v_proc.proname <> 'ledger_append'
       AND (SELECT pg_catalog.count(*) FROM pg_catalog.pg_proc AS p WHERE p.pronamespace = v_proc.pronamespace AND p.proname = v_proc.proname) <> 1 THEN
      RAISE EXCEPTION 'M16_S1B2R1_PREFLIGHT: overload of approved routine %', v_oid::regprocedure USING ERRCODE = '55000';
    END IF;
  END LOOP;

  -- A pre-existing technical role must already be exactly the least-privilege shape, or this migration stops.
  FOREACH v_role IN ARRAY ARRAY['govia_ledger_executor', 'govia_runtime_executor', 'govia_legacy_read_executor', 'govia_legacy_graph_executor'] LOOP
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles AS r WHERE r.rolname = v_role
               AND (r.rolcanlogin OR r.rolsuper OR r.rolcreatedb OR r.rolcreaterole OR r.rolreplication OR r.rolbypassrls OR r.rolinherit
                    OR EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members AS m WHERE m.member = r.oid))) THEN
      RAISE EXCEPTION 'M16_S1B2R1_PREFLIGHT: role % exists with different attributes or memberships', v_role USING ERRCODE = '55000';
    END IF;
  END LOOP;
END;
$preflight$;

-- ---------------------------------------------------------------------------------------
-- B. Noncanonical / forbidden surfaces.
-- ---------------------------------------------------------------------------------------
-- The obsolete apps/dashboard/supabase-setup-8.2.sql overload must not coexist with the canonical ledger
-- API. Exact identity only, no CASCADE: a dependent object aborts this migration.
DROP FUNCTION IF EXISTS gov_repo.ledger_append(text, text, text, uuid, uuid, text, uuid, jsonb);

-- Arbitrary-SQL executors are never approvable: every overload, in any schema, loses application EXECUTE.
DO $gov_exec$
DECLARE
  v_fn regprocedure;
BEGIN
  FOR v_fn IN
    SELECT p.oid::regprocedure FROM pg_catalog.pg_proc AS p
    WHERE p.proname IN ('gov_exec', 'gov_exec_dml')
      AND p.pronamespace NOT IN ('pg_catalog'::regnamespace, 'information_schema'::regnamespace)
  LOOP
    RAISE NOTICE 'M16_S1B2R1: revoking application EXECUTE on forbidden executor %', v_fn;
    EXECUTE pg_catalog.format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated, service_role', v_fn);
  END LOOP;
  -- GraphOS trigger functions: direct application EXECUTE is never needed to fire a trigger.
  FOR v_fn IN
    SELECT p.oid::regprocedure FROM pg_catalog.pg_proc AS p
    WHERE p.oid IN (pg_catalog.to_regprocedure('public.handle_new_user()'), pg_catalog.to_regprocedure('public.set_graphos_updated_at()'))
  LOOP
    RAISE NOTICE 'M16_S1B2R1: revoking application EXECUTE on GraphOS trigger function %', v_fn;
    EXECUTE pg_catalog.format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated, service_role', v_fn);
  END LOOP;
END;
$gov_exec$;

-- Legacy definers without a tracked consumer: application-inaccessible (not dropped).
REVOKE ALL ON FUNCTION
  gov_repo.ai_system_compliance_gaps(uuid),
  gov_repo.ai_system_evidence_report(uuid),
  gov_repo.ict_dora_sla_status(uuid),
  gov_repo.ict_incident_classify_major(uuid),
  gov_repo.ict_incident_impact_summary(uuid),
  gov_repo.compute_governance_score(uuid)
FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------
-- C. Dedicated technical owners: SECURITY DEFINER execution principals only.
-- ---------------------------------------------------------------------------------------
DO $roles$
DECLARE
  v_role text;
BEGIN
  FOREACH v_role IN ARRAY ARRAY['govia_ledger_executor', 'govia_runtime_executor', 'govia_legacy_read_executor', 'govia_legacy_graph_executor'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles AS r WHERE r.rolname = v_role) THEN
      EXECUTE pg_catalog.format('CREATE ROLE %I NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT', v_role);
    END IF;
  END LOOP;
END;
$roles$;
COMMENT ON ROLE govia_ledger_executor IS 'M16-S1B.2R1 NOLOGIN owner of gov_repo.ledger_append / ledger_verify only; exact governance_ledger grants; zero policy-store capability.';
COMMENT ON ROLE govia_runtime_executor IS 'M16-S1B.2R1 NOLOGIN owner of the four M13/M15 runtime RPCs only; exact grants; canonical_relationships read-only; zero policy-store capability.';
COMMENT ON ROLE govia_legacy_read_executor IS 'M16-S1B.2R1 NOLOGIN owner of agent_compliance_gaps / agent_graph_traverse / agent_semantic_search only; SELECT-only; zero policy-store capability.';
COMMENT ON ROLE govia_legacy_graph_executor IS 'M16-S1B.2R1 NOLOGIN owner of recompute_risk_propagation only; may execute exactly agent_graph_traverse; zero policy-store capability.';

GRANT USAGE ON SCHEMA gov_repo TO govia_ledger_executor, govia_runtime_executor, govia_legacy_read_executor, govia_legacy_graph_executor;

-- Ledger: exactly the columns the two bodies read/write; UPDATE on entry_sequence only because
-- ledger_append's SELECT ... FOR UPDATE row lock requires an UPDATE privilege (the immutable-core rule
-- neutralizes any change to it and the RLS UPDATE policy below rejects every new row version).
GRANT SELECT (entry_sequence, previous_hash, entry_hash, event_type, subject_id, actor_user_id, recorded_at, payload)
  ON gov_repo.governance_ledger TO govia_ledger_executor;
GRANT INSERT (event_type, event_description, subject_type, subject_id, actor_user_id, actor_ip, organisation_id,
              event_timestamp, recorded_at, previous_hash, entry_hash, payload)
  ON gov_repo.governance_ledger TO govia_ledger_executor;
GRANT UPDATE (entry_sequence) ON gov_repo.governance_ledger TO govia_ledger_executor;
GRANT USAGE ON SEQUENCE gov_repo.governance_ledger_entry_sequence_seq TO govia_ledger_executor;
CREATE POLICY m16_r1_ledger_executor_select ON gov_repo.governance_ledger FOR SELECT TO govia_ledger_executor USING (true);
CREATE POLICY m16_r1_ledger_executor_insert ON gov_repo.governance_ledger FOR INSERT TO govia_ledger_executor WITH CHECK (true);
CREATE POLICY m16_r1_ledger_executor_lock ON gov_repo.governance_ledger FOR UPDATE TO govia_ledger_executor USING (true) WITH CHECK (false);

-- Runtime: exact M13/M15 read set, append-only writes, and the single head move of record_execution_snapshot.
GRANT SELECT ON
  gov_repo.acquisition_runs, gov_repo.agent_version_technical_profile_proposals, gov_repo.canonical_normalized_object_mappings,
  gov_repo.canonical_objects, gov_repo.canonical_relationships, gov_repo.cross_signal_comparison_left_relationship_states,
  gov_repo.cross_signal_comparison_results, gov_repo.discovery_candidates, gov_repo.discovery_evidence, gov_repo.execution_field_states,
  gov_repo.execution_source_heads, gov_repo.execution_source_snapshots, gov_repo.reconciliation_decisions,
  gov_repo.runtime_deployment_bindings, gov_repo.runtime_observations, gov_repo.runtime_source_configurations,
  gov_repo.runtime_source_heads, gov_repo.source_assertion_evidence, gov_repo.source_assertions
TO govia_runtime_executor;
GRANT INSERT ON
  gov_repo.cross_signal_comparison_left_relationship_states, gov_repo.cross_signal_comparison_results,
  gov_repo.execution_source_facts, gov_repo.execution_source_heads, gov_repo.execution_source_snapshots, gov_repo.runtime_observations
TO govia_runtime_executor;
GRANT UPDATE (snapshot_id) ON gov_repo.execution_source_heads TO govia_runtime_executor;
GRANT EXECUTE ON FUNCTION
  gov_repo.execution_field_valid(text), gov_repo.frame_identity(text[]), gov_repo.normalized_object_identity(uuid, jsonb),
  gov_repo.runtime_iso(timestamp with time zone), gov_repo.runtime_lock(uuid, text), gov_repo.runtime_round_cost(numeric),
  gov_repo.runtime_readback(gov_repo.runtime_observations), gov_repo.runtime_valid_observation(gov_repo.runtime_observations),
  gov_repo.runtime_same_observation(gov_repo.runtime_observations, gov_repo.runtime_observations)
TO govia_runtime_executor;
DO $runtime_policies$
DECLARE
  v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'acquisition_runs', 'agent_version_technical_profile_proposals', 'canonical_normalized_object_mappings', 'canonical_objects',
    'canonical_relationships', 'cross_signal_comparison_left_relationship_states', 'cross_signal_comparison_results',
    'discovery_candidates', 'discovery_evidence', 'execution_field_states', 'execution_source_heads', 'execution_source_snapshots',
    'reconciliation_decisions', 'runtime_deployment_bindings', 'runtime_observations', 'runtime_source_configurations',
    'runtime_source_heads', 'source_assertion_evidence', 'source_assertions'] LOOP
    EXECUTE pg_catalog.format('CREATE POLICY m16_r1_runtime_executor_select ON gov_repo.%I FOR SELECT TO govia_runtime_executor USING (true)', v_table);
  END LOOP;
  FOREACH v_table IN ARRAY ARRAY[
    'cross_signal_comparison_left_relationship_states', 'cross_signal_comparison_results', 'execution_source_facts',
    'execution_source_heads', 'execution_source_snapshots', 'runtime_observations'] LOOP
    EXECUTE pg_catalog.format('CREATE POLICY m16_r1_runtime_executor_insert ON gov_repo.%I FOR INSERT TO govia_runtime_executor WITH CHECK (true)', v_table);
  END LOOP;
END;
$runtime_policies$;
CREATE POLICY m16_r1_runtime_executor_head_move ON gov_repo.execution_source_heads FOR UPDATE TO govia_runtime_executor USING (true) WITH CHECK (true);

-- Legacy read: SELECT only; governance_users restricted to the three columns the bodies read.
GRANT SELECT ON gov_repo.agents, gov_repo.agent_edges, gov_repo.agent_embeddings TO govia_legacy_read_executor;
GRANT SELECT (user_id, full_name, email) ON gov_repo.governance_users TO govia_legacy_read_executor;
CREATE POLICY m16_r1_legacy_read_executor_select ON gov_repo.agents FOR SELECT TO govia_legacy_read_executor USING (true);
CREATE POLICY m16_r1_legacy_read_executor_select ON gov_repo.agent_edges FOR SELECT TO govia_legacy_read_executor USING (true);
CREATE POLICY m16_r1_legacy_read_executor_select ON gov_repo.agent_embeddings FOR SELECT TO govia_legacy_read_executor USING (true);
CREATE POLICY m16_r1_legacy_read_executor_select ON gov_repo.governance_users FOR SELECT TO govia_legacy_read_executor USING (true);

-- Legacy graph: the agent columns it reads, propagation upsert columns, and exactly agent_graph_traverse.
GRANT SELECT (agent_id, organisation_id, status, risk_level) ON gov_repo.agents TO govia_legacy_graph_executor;
GRANT SELECT ON gov_repo.agent_risk_propagation TO govia_legacy_graph_executor;
GRANT INSERT (risk_source_agent_id, affected_agent_id, propagation_path, propagation_type, impact_score, agents_in_chain,
              is_active, computed_at, organisation_id)
  ON gov_repo.agent_risk_propagation TO govia_legacy_graph_executor;
GRANT UPDATE (is_active, invalidated_reason, propagation_path, propagation_type, impact_score, agents_in_chain, computed_at)
  ON gov_repo.agent_risk_propagation TO govia_legacy_graph_executor;
CREATE POLICY m16_r1_legacy_graph_executor_select ON gov_repo.agents FOR SELECT TO govia_legacy_graph_executor USING (true);
CREATE POLICY m16_r1_legacy_graph_executor_select ON gov_repo.agent_risk_propagation FOR SELECT TO govia_legacy_graph_executor USING (true);
CREATE POLICY m16_r1_legacy_graph_executor_insert ON gov_repo.agent_risk_propagation FOR INSERT TO govia_legacy_graph_executor WITH CHECK (true);
CREATE POLICY m16_r1_legacy_graph_executor_update ON gov_repo.agent_risk_propagation FOR UPDATE TO govia_legacy_graph_executor USING (true) WITH CHECK (true);
GRANT EXECUTE ON FUNCTION gov_repo.agent_graph_traverse(uuid, integer, gov_repo.edge_relationship[], boolean) TO govia_legacy_graph_executor;

-- Extension schemas resolved from the catalog (never assumed). The primitives themselves (pgcrypto digest,
-- uuid-ossp uuid_generate_v4, pgvector <=>) are extension-owned and PUBLIC-executable; the postflight proves
-- each technical owner's EFFECTIVE schema USAGE + EXECUTE on exactly what its bodies resolve.
DO $extensions$
BEGIN
  EXECUTE pg_catalog.format('GRANT USAGE ON SCHEMA %I TO govia_ledger_executor, govia_runtime_executor',
    (SELECT e.extnamespace::regnamespace::name FROM pg_catalog.pg_extension AS e WHERE e.extname = 'pgcrypto'));
  EXECUTE pg_catalog.format('GRANT USAGE ON SCHEMA %I TO govia_legacy_read_executor',
    (SELECT e.extnamespace::regnamespace::name FROM pg_catalog.pg_extension AS e WHERE e.extname = 'vector'));
END;
$extensions$;

-- ---------------------------------------------------------------------------------------
-- D. The 10 re-owned routines: bodies untouched; EXECUTE = service_role only; deterministic search_path
--    for the definers that had none (the runtime four keep their existing pinned pg_catalog path).
-- ---------------------------------------------------------------------------------------
REVOKE ALL ON FUNCTION
  gov_repo.ledger_append(character varying, text, character varying, uuid, uuid, inet, uuid, jsonb),
  gov_repo.ledger_verify(bigint, bigint),
  gov_repo.record_execution_snapshot(uuid, jsonb, text),
  gov_repo.admit_runtime_observation(uuid, text, gov_repo.runtime_observations),
  gov_repo.read_runtime_observation_exact(uuid, gov_repo.runtime_reference, uuid),
  gov_repo.record_cross_signal_comparison_result(uuid, text, jsonb),
  gov_repo.agent_compliance_gaps(uuid),
  gov_repo.agent_graph_traverse(uuid, integer, gov_repo.edge_relationship[], boolean),
  gov_repo.recompute_risk_propagation(uuid, uuid)
FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION
  gov_repo.ledger_append(character varying, text, character varying, uuid, uuid, inet, uuid, jsonb),
  gov_repo.ledger_verify(bigint, bigint),
  gov_repo.record_execution_snapshot(uuid, jsonb, text),
  gov_repo.admit_runtime_observation(uuid, text, gov_repo.runtime_observations),
  gov_repo.read_runtime_observation_exact(uuid, gov_repo.runtime_reference, uuid),
  gov_repo.record_cross_signal_comparison_result(uuid, text, jsonb),
  gov_repo.agent_compliance_gaps(uuid),
  gov_repo.agent_graph_traverse(uuid, integer, gov_repo.edge_relationship[], boolean),
  gov_repo.recompute_risk_propagation(uuid, uuid)
TO service_role;
ALTER FUNCTION gov_repo.agent_compliance_gaps(uuid) SET search_path = pg_catalog, pg_temp;
ALTER FUNCTION gov_repo.agent_graph_traverse(uuid, integer, gov_repo.edge_relationship[], boolean) SET search_path = pg_catalog, pg_temp;
ALTER FUNCTION gov_repo.recompute_risk_propagation(uuid, uuid) SET search_path = pg_catalog, pg_temp;

DO $reown$
DECLARE
  v_crypto name := (SELECT e.extnamespace::regnamespace::name FROM pg_catalog.pg_extension AS e WHERE e.extname = 'pgcrypto');
  v_vector name := (SELECT e.extnamespace::regnamespace::name FROM pg_catalog.pg_extension AS e WHERE e.extname = 'vector');
  v_search regprocedure := pg_catalog.to_regprocedure(pg_catalog.format('gov_repo.agent_semantic_search(%I.vector,uuid,character varying,integer,numeric)', v_vector));
  v_role text;
BEGIN
  -- pgcrypto's actual schema, after pg_catalog, before pg_temp: digest() resolves deterministically.
  EXECUTE pg_catalog.format('ALTER FUNCTION gov_repo.ledger_append(character varying, text, character varying, uuid, uuid, inet, uuid, jsonb) SET search_path = pg_catalog, %I, pg_temp', v_crypto);
  EXECUTE pg_catalog.format('ALTER FUNCTION gov_repo.ledger_verify(bigint, bigint) SET search_path = pg_catalog, %I, pg_temp', v_crypto);
  -- pgvector's actual schema resolves <=> ; every relation in the body is schema-qualified.
  EXECUTE pg_catalog.format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated, service_role', v_search);
  EXECUTE pg_catalog.format('GRANT EXECUTE ON FUNCTION %s TO service_role', v_search);
  EXECUTE pg_catalog.format('ALTER FUNCTION %s SET search_path = pg_catalog, %I, pg_temp', v_search, v_vector);

  -- ALTER ... OWNER TO needs SET on the new owner and the new owner's CREATE on the schema. Both are
  -- granted only for the transfer and revoked immediately after; the migration runner keeps only the
  -- ADMIN membership PostgreSQL gives the creator of a role.
  FOREACH v_role IN ARRAY ARRAY['govia_ledger_executor', 'govia_runtime_executor', 'govia_legacy_read_executor', 'govia_legacy_graph_executor'] LOOP
    EXECUTE pg_catalog.format('GRANT CREATE ON SCHEMA gov_repo TO %I', v_role);
    EXECUTE pg_catalog.format('GRANT %I TO CURRENT_USER WITH INHERIT FALSE, SET TRUE', v_role);
  END LOOP;
  ALTER FUNCTION gov_repo.ledger_append(character varying, text, character varying, uuid, uuid, inet, uuid, jsonb) OWNER TO govia_ledger_executor;
  ALTER FUNCTION gov_repo.ledger_verify(bigint, bigint) OWNER TO govia_ledger_executor;
  ALTER FUNCTION gov_repo.record_execution_snapshot(uuid, jsonb, text) OWNER TO govia_runtime_executor;
  ALTER FUNCTION gov_repo.admit_runtime_observation(uuid, text, gov_repo.runtime_observations) OWNER TO govia_runtime_executor;
  ALTER FUNCTION gov_repo.read_runtime_observation_exact(uuid, gov_repo.runtime_reference, uuid) OWNER TO govia_runtime_executor;
  ALTER FUNCTION gov_repo.record_cross_signal_comparison_result(uuid, text, jsonb) OWNER TO govia_runtime_executor;
  ALTER FUNCTION gov_repo.agent_compliance_gaps(uuid) OWNER TO govia_legacy_read_executor;
  ALTER FUNCTION gov_repo.agent_graph_traverse(uuid, integer, gov_repo.edge_relationship[], boolean) OWNER TO govia_legacy_read_executor;
  EXECUTE pg_catalog.format('ALTER FUNCTION %s OWNER TO govia_legacy_read_executor', v_search);
  ALTER FUNCTION gov_repo.recompute_risk_propagation(uuid, uuid) OWNER TO govia_legacy_graph_executor;
  FOREACH v_role IN ARRAY ARRAY['govia_ledger_executor', 'govia_runtime_executor', 'govia_legacy_read_executor', 'govia_legacy_graph_executor'] LOOP
    EXECUTE pg_catalog.format('REVOKE %I FROM CURRENT_USER', v_role);
    EXECUTE pg_catalog.format('REVOKE CREATE ON SCHEMA gov_repo FROM %I', v_role);
  END LOOP;
END;
$reown$;

-- ---------------------------------------------------------------------------------------
-- E. Default privileges (prospective only; 20260818013113 is not edited). New postgres-created gov_repo
--    routines get neither the schema-level service_role default nor PostgreSQL's built-in PUBLIC EXECUTE
--    (the built-in default is global per creating role; existing objects are unaffected). Approved routines
--    carry explicit grants above.
-- ---------------------------------------------------------------------------------------
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA gov_repo REVOKE EXECUTE ON ROUTINES FROM service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres REVOKE EXECUTE ON ROUTINES FROM PUBLIC;

-- ---------------------------------------------------------------------------------------
-- F. Postflight over the EFFECTIVE catalog. Self-contained and re-executable.
-- ---------------------------------------------------------------------------------------
DO $postflight$
DECLARE
  v_app CONSTANT text[] := ARRAY['anon', 'authenticated', 'service_role'];
  v_executors CONSTANT text[] := ARRAY['govia_ledger_executor', 'govia_runtime_executor', 'govia_legacy_read_executor', 'govia_legacy_graph_executor'];
  v_stores CONSTANT oid[] := ARRAY['gov_repo.governance_policies'::regclass::oid, 'gov_repo.policy_versions'::regclass::oid];
  v_privileges text[] := ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'];
  v_crypto name := (SELECT e.extnamespace::regnamespace::name FROM pg_catalog.pg_extension AS e WHERE e.extname = 'pgcrypto');
  v_vector name := (SELECT e.extnamespace::regnamespace::name FROM pg_catalog.pg_extension AS e WHERE e.extname = 'vector');
  v_uuid name := (SELECT e.extnamespace::regnamespace::name FROM pg_catalog.pg_extension AS e WHERE e.extname = 'uuid-ossp');
  v_vector_type regtype;
  v_capable oid[];
  v_approved oid[] := '{}';
  v_frozen oid[] := '{}';
  v_traverse oid := pg_catalog.to_regprocedure('gov_repo.agent_graph_traverse(uuid,integer,gov_repo.edge_relationship[],boolean)');
  v_entry record;
  v_proc record;
  v_row record;
  v_oid oid;
  v_role text;
  v_role_oid oid;
  v_actual text[];
  v_expected text[];
BEGIN
  IF pg_catalog.current_setting('server_version_num')::integer >= 170000 THEN
    v_privileges := pg_catalog.array_append(v_privileges, 'MAINTAIN'::text);
  END IF;
  SELECT t.oid::regtype INTO v_vector_type FROM pg_catalog.pg_type AS t
  WHERE t.typname = 'vector' AND t.typnamespace = pg_catalog.to_regnamespace(v_vector);
  IF v_crypto IS NULL OR v_vector_type IS NULL OR v_uuid IS NULL THEN
    RAISE EXCEPTION 'M16_S1B2R1_POSTFLIGHT: pgcrypto / vector / uuid-ossp unresolved';
  END IF;

  -- Roles with ANY effective policy-store capability (ownership or membership in the owner, any table or
  -- column privilege incl. MAINTAIN, BYPASSRLS, superuser).
  v_capable := ARRAY(
    SELECT r.oid FROM pg_catalog.pg_roles AS r
    WHERE r.rolsuper OR r.rolbypassrls
       OR EXISTS (SELECT 1 FROM pg_catalog.pg_class AS c WHERE c.oid = ANY (v_stores) AND pg_catalog.pg_has_role(r.oid, c.relowner, 'MEMBER'))
       OR EXISTS (SELECT 1 FROM pg_catalog.unnest(v_stores) AS s(rel) CROSS JOIN pg_catalog.unnest(v_privileges) AS pr(privilege)
                  WHERE pg_catalog.has_table_privilege(r.oid, s.rel, pr.privilege))
       OR EXISTS (SELECT 1 FROM pg_catalog.unnest(v_stores) AS s(rel)
                  WHERE pg_catalog.has_any_column_privilege(r.oid, s.rel, 'SELECT, INSERT, UPDATE, REFERENCES')));

  -- The exact 22: identity, owner class, body hash, config, EXECUTE = service_role only, no overload.
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
      ('gov_repo.ledger_append(character varying,text,character varying,uuid,uuid,inet,uuid,jsonb)', 'govia_ledger_executor', '8137f591bdd717ef18cbdc8b6146aab349626903aa9d080cebe55806190ae830', 'search_path=pg_catalog, {crypto}, pg_temp'),
      ('gov_repo.ledger_verify(bigint,bigint)', 'govia_ledger_executor', 'd52b7bc1d274cb11dd7ef4d3424d4056deba1df9846eb1195007f3695e091ec4', 'search_path=pg_catalog, {crypto}, pg_temp'),
      ('gov_repo.record_execution_snapshot(uuid,jsonb,text)', 'govia_runtime_executor', '882431691b588cedab4a7b6c2c947d834e48a3a9a7f9a94e43dc3782d6786f29', 'search_path=pg_catalog'),
      ('gov_repo.admit_runtime_observation(uuid,text,gov_repo.runtime_observations)', 'govia_runtime_executor', '9b6284dd7ca92f092fa567ff48e9ac3eae33f906c9653e9c4b204c04f1c51a18', 'search_path=pg_catalog'),
      ('gov_repo.read_runtime_observation_exact(uuid,gov_repo.runtime_reference,uuid)', 'govia_runtime_executor', 'eebbe4336fe8e5349d73c46d84c32c832bf6c283ac65dc7ddb062da0b73ffae0', 'search_path=pg_catalog'),
      ('gov_repo.record_cross_signal_comparison_result(uuid,text,jsonb)', 'govia_runtime_executor', '3771019f3c6291e866837703f2af100609f85c37603f8e2d82161436c713e84c', 'search_path=pg_catalog'),
      ('gov_repo.agent_compliance_gaps(uuid)', 'govia_legacy_read_executor', '2e27745223cfdd30f1ba41ffd6b0d0cb8fb61d1edf6cd5776be9915709d140a6', 'search_path=pg_catalog, pg_temp'),
      ('gov_repo.agent_graph_traverse(uuid,integer,gov_repo.edge_relationship[],boolean)', 'govia_legacy_read_executor', '568376c6d24590874162cc7e2db555219d501eb0f60168c30e7963cf8996c555', 'search_path=pg_catalog, pg_temp'),
      ('gov_repo.agent_semantic_search({vector},uuid,character varying,integer,numeric)', 'govia_legacy_read_executor', '0a53e2a91844531902963aa4ca55f6eaa375b15d09898f46ebbe3bbe19213f4f', 'search_path=pg_catalog, {vschema}, pg_temp'),
      ('gov_repo.recompute_risk_propagation(uuid,uuid)', 'govia_legacy_graph_executor', 'b5f6edac53c2c5acdda60729e5ad9de0956e407c829aaedbea3f4002e793b96c', 'search_path=pg_catalog, pg_temp')
    ) AS m(sig, owner_role, sha, cfg)
  LOOP
    v_oid := pg_catalog.to_regprocedure(pg_catalog.replace(v_entry.sig, '{vector}', pg_catalog.quote_ident(v_vector) || '.vector'));
    IF v_oid IS NULL THEN
      RAISE EXCEPTION 'M16_S1B2R1_POSTFLIGHT: approved routine % missing', v_entry.sig;
    END IF;
    SELECT p.proname, p.pronamespace, p.prosecdef, p.proowner, p.prosrc, p.proconfig, p.proacl INTO v_proc FROM pg_catalog.pg_proc AS p WHERE p.oid = v_oid;
    IF NOT v_proc.prosecdef THEN
      RAISE EXCEPTION 'M16_S1B2R1_POSTFLIGHT: % is not SECURITY DEFINER', v_oid::regprocedure;
    END IF;
    IF pg_catalog.pg_get_userbyid(v_proc.proowner) <> v_entry.owner_role THEN
      RAISE EXCEPTION 'M16_S1B2R1_POSTFLIGHT: % owner % is not %', v_oid::regprocedure, pg_catalog.pg_get_userbyid(v_proc.proowner), v_entry.owner_role;
    END IF;
    IF pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(v_proc.prosrc, 'UTF8')), 'hex') <> v_entry.sha THEN
      RAISE EXCEPTION 'M16_S1B2R1_POSTFLIGHT: % body hash changed', v_oid::regprocedure;
    END IF;
    IF COALESCE(pg_catalog.array_to_string(v_proc.proconfig, ';'), '-') <>
       pg_catalog.replace(pg_catalog.replace(v_entry.cfg, '{crypto}', pg_catalog.quote_ident(v_crypto)), '{vschema}', pg_catalog.quote_ident(v_vector)) THEN
      RAISE EXCEPTION 'M16_S1B2R1_POSTFLIGHT: % config changed: %', v_oid::regprocedure, v_proc.proconfig;
    END IF;
    IF NOT pg_catalog.has_function_privilege('service_role', v_oid, 'EXECUTE')
       OR pg_catalog.has_function_privilege('anon', v_oid, 'EXECUTE')
       OR pg_catalog.has_function_privilege('authenticated', v_oid, 'EXECUTE')
       OR EXISTS (SELECT 1 FROM pg_catalog.aclexplode(COALESCE(v_proc.proacl, pg_catalog.acldefault('f', v_proc.proowner))) AS a
                  WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE') THEN
      RAISE EXCEPTION 'M16_S1B2R1_POSTFLIGHT: % application EXECUTE is not exactly service_role', v_oid::regprocedure;
    END IF;
    IF (SELECT pg_catalog.count(*) FROM pg_catalog.pg_proc AS p WHERE p.pronamespace = v_proc.pronamespace AND p.proname = v_proc.proname) <> 1 THEN
      RAISE EXCEPTION 'M16_S1B2R1_POSTFLIGHT: overload of approved routine %', v_oid::regprocedure;
    END IF;
    v_approved := v_approved || v_oid;
    IF v_entry.owner_role = 'postgres' THEN
      v_frozen := v_frozen || v_oid;
    ELSIF v_proc.proowner = ANY (v_capable) THEN
      RAISE EXCEPTION 'M16_S1B2R1_POSTFLIGHT: owner of % has policy-store capability', v_oid::regprocedure;
    END IF;
  END LOOP;
  IF pg_catalog.cardinality(v_approved) <> 22 OR pg_catalog.cardinality(v_frozen) <> 12 THEN
    RAISE EXCEPTION 'M16_S1B2R1_POSTFLIGHT: approved surface is not exactly 22 (12 frozen)';
  END IF;

  -- Control A + B over EVERY non-system, non-extension-member SECURITY DEFINER routine.
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
      RAISE EXCEPTION 'M16_S1B2R1_POSTFLIGHT: CLOSED_SURFACE unapproved application-executable SECURITY DEFINER %', v_row.oid::regprocedure;
    END IF;
    IF v_row.proowner = ANY (v_capable) AND v_row.oid <> ALL (v_frozen) THEN
      RAISE EXCEPTION 'M16_S1B2R1_POSTFLIGHT: POLICY_STORE_OWNER application definer % outside the frozen 12', v_row.oid::regprocedure;
    END IF;
  END LOOP;

  -- Forbidden executors: never executable by an application role or a technical owner.
  FOR v_row IN
    SELECT p.oid, p.proowner, p.proacl FROM pg_catalog.pg_proc AS p
    WHERE p.proname IN ('gov_exec', 'gov_exec_dml') AND p.pronamespace NOT IN ('pg_catalog'::regnamespace, 'information_schema'::regnamespace)
  LOOP
    IF EXISTS (SELECT 1 FROM pg_catalog.aclexplode(COALESCE(v_row.proacl, pg_catalog.acldefault('f', v_row.proowner))) AS a
               WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE')
       OR EXISTS (SELECT 1 FROM pg_catalog.unnest(v_app || v_executors) AS g(role_name)
                  WHERE EXISTS (SELECT 1 FROM pg_catalog.pg_roles AS r WHERE r.rolname = g.role_name)
                    AND pg_catalog.has_function_privilege(g.role_name, v_row.oid, 'EXECUTE')) THEN
      RAISE EXCEPTION 'M16_S1B2R1_POSTFLIGHT: forbidden arbitrary-SQL executor % is executable', v_row.oid::regprocedure;
    END IF;
  END LOOP;

  -- Noncanonical drift (quarantined roots) and the single canonical ledger API.
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_proc AS p WHERE p.pronamespace = 'gov_repo'::regnamespace
             AND (p.proname IN ('coding_memory_search', 'log_agent_event', 'compute_cg_ag_008')
                  OR (p.proname = 'update_agent_compliance_flags' AND p.prosecdef)))
     OR (SELECT pg_catalog.count(*) FROM pg_catalog.pg_proc AS p WHERE p.pronamespace = 'gov_repo'::regnamespace AND p.proname = 'ledger_append') <> 1 THEN
    RAISE EXCEPTION 'M16_S1B2R1_POSTFLIGHT: NONCANONICAL_GOVERNANCE_ROOT_CONFLICT in target catalog';
  END IF;

  -- Technical owners: exact attributes, no memberships, zero policy-store capability, no escalation path,
  -- no CREATE anywhere, and exactly the audited privilege / policy map.
  FOREACH v_role IN ARRAY v_executors LOOP
    SELECT r.oid INTO v_role_oid FROM pg_catalog.pg_roles AS r
    WHERE r.rolname = v_role AND NOT (r.rolcanlogin OR r.rolsuper OR r.rolcreatedb OR r.rolcreaterole OR r.rolreplication OR r.rolbypassrls OR r.rolinherit);
    IF v_role_oid IS NULL THEN
      RAISE EXCEPTION 'M16_S1B2R1_POSTFLIGHT: technical owner % missing or not NOLOGIN/NOSUPERUSER/NOCREATEDB/NOCREATEROLE/NOREPLICATION/NOBYPASSRLS/NOINHERIT', v_role;
    END IF;
    IF v_role_oid = ANY (v_capable) THEN
      RAISE EXCEPTION 'M16_S1B2R1_POSTFLIGHT: technical owner % has policy-store capability', v_role;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members AS m WHERE m.member = v_role_oid)
       OR EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members AS m
                  WHERE m.roleid = v_role_oid AND (m.member <> 'postgres'::regrole OR m.inherit_option OR m.set_option)) THEN
      RAISE EXCEPTION 'M16_S1B2R1_POSTFLIGHT: technical owner % has a role membership path', v_role;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_namespace AS n WHERE pg_catalog.has_schema_privilege(v_role_oid, n.oid, 'CREATE')) THEN
      RAISE EXCEPTION 'M16_S1B2R1_POSTFLIGHT: technical owner % can CREATE in a schema', v_role;
    END IF;
    FOR v_row IN
      SELECT p.oid FROM pg_catalog.pg_proc AS p
      WHERE p.prosecdef AND p.proowner <> v_role_oid
        AND p.pronamespace NOT IN ('pg_catalog'::regnamespace, 'information_schema'::regnamespace)
        AND pg_catalog.has_function_privilege(v_role_oid, p.oid, 'EXECUTE')
    LOOP
      IF NOT (v_role = 'govia_legacy_graph_executor' AND v_row.oid = v_traverse) THEN
        RAISE EXCEPTION 'M16_S1B2R1_POSTFLIGHT: technical owner % can execute elevated routine %', v_role, v_row.oid::regprocedure;
      END IF;
    END LOOP;

    -- Relation / column / sequence grants.
    v_actual := ARRAY(
      SELECT x FROM (
        SELECT n.nspname || '.' || c.relname || ':' || a.privilege_type AS x
        FROM pg_catalog.pg_class AS c JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
        CROSS JOIN LATERAL pg_catalog.aclexplode(c.relacl) AS a WHERE a.grantee = v_role_oid
        UNION ALL
        SELECT n.nspname || '.' || c.relname || '.' || att.attname || ':' || a.privilege_type
        FROM pg_catalog.pg_attribute AS att JOIN pg_catalog.pg_class AS c ON c.oid = att.attrelid
        JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
        CROSS JOIN LATERAL pg_catalog.aclexplode(att.attacl) AS a WHERE a.grantee = v_role_oid) AS g
      ORDER BY x COLLATE "C");
    v_expected := ARRAY(SELECT x FROM pg_catalog.unnest(CASE v_role
      WHEN 'govia_ledger_executor' THEN ARRAY[
        'gov_repo.governance_ledger_entry_sequence_seq:USAGE',
        'gov_repo.governance_ledger.actor_ip:INSERT', 'gov_repo.governance_ledger.actor_user_id:INSERT', 'gov_repo.governance_ledger.actor_user_id:SELECT',
        'gov_repo.governance_ledger.entry_hash:INSERT', 'gov_repo.governance_ledger.entry_hash:SELECT', 'gov_repo.governance_ledger.entry_sequence:SELECT',
        'gov_repo.governance_ledger.entry_sequence:UPDATE', 'gov_repo.governance_ledger.event_description:INSERT', 'gov_repo.governance_ledger.event_timestamp:INSERT',
        'gov_repo.governance_ledger.event_type:INSERT', 'gov_repo.governance_ledger.event_type:SELECT', 'gov_repo.governance_ledger.organisation_id:INSERT',
        'gov_repo.governance_ledger.payload:INSERT', 'gov_repo.governance_ledger.payload:SELECT', 'gov_repo.governance_ledger.previous_hash:INSERT',
        'gov_repo.governance_ledger.previous_hash:SELECT', 'gov_repo.governance_ledger.recorded_at:INSERT', 'gov_repo.governance_ledger.recorded_at:SELECT',
        'gov_repo.governance_ledger.subject_id:INSERT', 'gov_repo.governance_ledger.subject_id:SELECT', 'gov_repo.governance_ledger.subject_type:INSERT']
      WHEN 'govia_runtime_executor' THEN ARRAY[
        'gov_repo.acquisition_runs:SELECT', 'gov_repo.agent_version_technical_profile_proposals:SELECT', 'gov_repo.canonical_normalized_object_mappings:SELECT',
        'gov_repo.canonical_objects:SELECT', 'gov_repo.canonical_relationships:SELECT', 'gov_repo.cross_signal_comparison_left_relationship_states:INSERT',
        'gov_repo.cross_signal_comparison_left_relationship_states:SELECT', 'gov_repo.cross_signal_comparison_results:INSERT',
        'gov_repo.cross_signal_comparison_results:SELECT', 'gov_repo.discovery_candidates:SELECT', 'gov_repo.discovery_evidence:SELECT',
        'gov_repo.execution_field_states:SELECT', 'gov_repo.execution_source_facts:INSERT', 'gov_repo.execution_source_heads.snapshot_id:UPDATE',
        'gov_repo.execution_source_heads:INSERT', 'gov_repo.execution_source_heads:SELECT', 'gov_repo.execution_source_snapshots:INSERT',
        'gov_repo.execution_source_snapshots:SELECT', 'gov_repo.reconciliation_decisions:SELECT', 'gov_repo.runtime_deployment_bindings:SELECT',
        'gov_repo.runtime_observations:INSERT', 'gov_repo.runtime_observations:SELECT', 'gov_repo.runtime_source_configurations:SELECT',
        'gov_repo.runtime_source_heads:SELECT', 'gov_repo.source_assertion_evidence:SELECT', 'gov_repo.source_assertions:SELECT']
      WHEN 'govia_legacy_read_executor' THEN ARRAY[
        'gov_repo.agent_edges:SELECT', 'gov_repo.agent_embeddings:SELECT', 'gov_repo.agents:SELECT',
        'gov_repo.governance_users.email:SELECT', 'gov_repo.governance_users.full_name:SELECT', 'gov_repo.governance_users.user_id:SELECT']
      ELSE ARRAY[
        'gov_repo.agent_risk_propagation.affected_agent_id:INSERT', 'gov_repo.agent_risk_propagation.agents_in_chain:INSERT',
        'gov_repo.agent_risk_propagation.agents_in_chain:UPDATE', 'gov_repo.agent_risk_propagation.computed_at:INSERT',
        'gov_repo.agent_risk_propagation.computed_at:UPDATE', 'gov_repo.agent_risk_propagation.impact_score:INSERT',
        'gov_repo.agent_risk_propagation.impact_score:UPDATE', 'gov_repo.agent_risk_propagation.invalidated_reason:UPDATE',
        'gov_repo.agent_risk_propagation.is_active:INSERT', 'gov_repo.agent_risk_propagation.is_active:UPDATE',
        'gov_repo.agent_risk_propagation.organisation_id:INSERT', 'gov_repo.agent_risk_propagation.propagation_path:INSERT',
        'gov_repo.agent_risk_propagation.propagation_path:UPDATE', 'gov_repo.agent_risk_propagation.propagation_type:INSERT',
        'gov_repo.agent_risk_propagation.propagation_type:UPDATE', 'gov_repo.agent_risk_propagation.risk_source_agent_id:INSERT',
        'gov_repo.agent_risk_propagation:SELECT', 'gov_repo.agents.agent_id:SELECT', 'gov_repo.agents.organisation_id:SELECT',
        'gov_repo.agents.risk_level:SELECT', 'gov_repo.agents.status:SELECT']
      END) AS e(x) ORDER BY x COLLATE "C");
    IF v_actual IS DISTINCT FROM v_expected THEN
      RAISE EXCEPTION 'M16_S1B2R1_POSTFLIGHT: technical owner % relation grants % differ from %', v_role, v_actual, v_expected;
    END IF;

    -- Routine grants (explicit, not owned) and schema grants.
    v_actual := ARRAY(
      SELECT p.oid::text FROM pg_catalog.pg_proc AS p CROSS JOIN LATERAL pg_catalog.aclexplode(p.proacl) AS a
      WHERE a.grantee = v_role_oid AND p.proowner <> v_role_oid ORDER BY p.oid::text COLLATE "C");
    v_expected := ARRAY(SELECT x FROM pg_catalog.unnest(CASE v_role
      WHEN 'govia_runtime_executor' THEN ARRAY[
        'gov_repo.execution_field_valid(text)'::regprocedure::oid::text, 'gov_repo.frame_identity(text[])'::regprocedure::oid::text,
        'gov_repo.normalized_object_identity(uuid,jsonb)'::regprocedure::oid::text, 'gov_repo.runtime_iso(timestamp with time zone)'::regprocedure::oid::text,
        'gov_repo.runtime_lock(uuid,text)'::regprocedure::oid::text, 'gov_repo.runtime_round_cost(numeric)'::regprocedure::oid::text,
        'gov_repo.runtime_readback(gov_repo.runtime_observations)'::regprocedure::oid::text,
        'gov_repo.runtime_valid_observation(gov_repo.runtime_observations)'::regprocedure::oid::text,
        'gov_repo.runtime_same_observation(gov_repo.runtime_observations,gov_repo.runtime_observations)'::regprocedure::oid::text]
      WHEN 'govia_legacy_graph_executor' THEN ARRAY[v_traverse::text]
      ELSE '{}'::text[] END) AS e(x) ORDER BY x COLLATE "C");
    IF v_actual IS DISTINCT FROM v_expected THEN
      RAISE EXCEPTION 'M16_S1B2R1_POSTFLIGHT: technical owner % routine grants % differ from %', v_role, v_actual, v_expected;
    END IF;
    -- Extension primitives the bodies resolve must be effectively executable (schema USAGE + EXECUTE).
    IF EXISTS (SELECT 1 FROM pg_catalog.unnest(CASE v_role
                 WHEN 'govia_ledger_executor' THEN ARRAY[
                   pg_catalog.to_regprocedure(pg_catalog.format('%I.digest(text,text)', v_crypto))::oid,
                   pg_catalog.to_regprocedure(pg_catalog.format('%I.uuid_generate_v4()', v_uuid))::oid]
                 WHEN 'govia_runtime_executor' THEN ARRAY[pg_catalog.to_regprocedure(pg_catalog.format('%I.digest(bytea,text)', v_crypto))::oid]
                 WHEN 'govia_legacy_read_executor' THEN ARRAY[(SELECT o.oprcode::oid FROM pg_catalog.pg_operator AS o
                   WHERE o.oprname = '<=>' AND o.oprleft = v_vector_type AND o.oprright = v_vector_type)]
                 ELSE ARRAY[pg_catalog.to_regprocedure(pg_catalog.format('%I.uuid_generate_v4()', v_uuid))::oid] END) AS f(fn)
               WHERE f.fn IS NULL OR NOT pg_catalog.has_function_privilege(v_role_oid, f.fn, 'EXECUTE'))
       OR (v_role IN ('govia_ledger_executor', 'govia_runtime_executor') AND NOT pg_catalog.has_schema_privilege(v_role_oid, v_crypto, 'USAGE'))
       OR (v_role = 'govia_legacy_read_executor' AND NOT pg_catalog.has_schema_privilege(v_role_oid, v_vector, 'USAGE')) THEN
      RAISE EXCEPTION 'M16_S1B2R1_POSTFLIGHT: technical owner % cannot resolve its extension primitives', v_role;
    END IF;
    v_actual := ARRAY(
      SELECT g.x FROM (SELECT n.nspname || ':' || a.privilege_type AS x FROM pg_catalog.pg_namespace AS n
        CROSS JOIN LATERAL pg_catalog.aclexplode(n.nspacl) AS a WHERE a.grantee = v_role_oid) AS g ORDER BY g.x COLLATE "C");
    v_expected := ARRAY(SELECT DISTINCT x COLLATE "C" FROM pg_catalog.unnest(CASE v_role
      WHEN 'govia_ledger_executor' THEN ARRAY['gov_repo:USAGE', v_crypto || ':USAGE']
      WHEN 'govia_runtime_executor' THEN ARRAY['gov_repo:USAGE', v_crypto || ':USAGE']
      WHEN 'govia_legacy_read_executor' THEN ARRAY['gov_repo:USAGE', v_vector || ':USAGE']
      ELSE ARRAY['gov_repo:USAGE'] END) AS e(x) ORDER BY x COLLATE "C");
    IF v_actual IS DISTINCT FROM v_expected THEN
      RAISE EXCEPTION 'M16_S1B2R1_POSTFLIGHT: technical owner % schema grants % differ from %', v_role, v_actual, v_expected;
    END IF;

    -- Role-specific RLS policies: exactly the audited table/command set, never on a policy store.
    v_actual := ARRAY(
      SELECT g.x FROM (SELECT n.nspname || '.' || c.relname || ':' || pol.polcmd::text AS x FROM pg_catalog.pg_policy AS pol
        JOIN pg_catalog.pg_class AS c ON c.oid = pol.polrelid JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
        WHERE v_role_oid = ANY (pol.polroles)) AS g ORDER BY g.x COLLATE "C");
    v_expected := ARRAY(SELECT x FROM pg_catalog.unnest(CASE v_role
      WHEN 'govia_ledger_executor' THEN ARRAY['gov_repo.governance_ledger:a', 'gov_repo.governance_ledger:r', 'gov_repo.governance_ledger:w']
      WHEN 'govia_runtime_executor' THEN ARRAY[
        'gov_repo.acquisition_runs:r', 'gov_repo.agent_version_technical_profile_proposals:r', 'gov_repo.canonical_normalized_object_mappings:r',
        'gov_repo.canonical_objects:r', 'gov_repo.canonical_relationships:r', 'gov_repo.cross_signal_comparison_left_relationship_states:a',
        'gov_repo.cross_signal_comparison_left_relationship_states:r', 'gov_repo.cross_signal_comparison_results:a',
        'gov_repo.cross_signal_comparison_results:r', 'gov_repo.discovery_candidates:r', 'gov_repo.discovery_evidence:r',
        'gov_repo.execution_field_states:r', 'gov_repo.execution_source_facts:a', 'gov_repo.execution_source_heads:a',
        'gov_repo.execution_source_heads:r', 'gov_repo.execution_source_heads:w', 'gov_repo.execution_source_snapshots:a',
        'gov_repo.execution_source_snapshots:r', 'gov_repo.reconciliation_decisions:r', 'gov_repo.runtime_deployment_bindings:r',
        'gov_repo.runtime_observations:a', 'gov_repo.runtime_observations:r', 'gov_repo.runtime_source_configurations:r',
        'gov_repo.runtime_source_heads:r', 'gov_repo.source_assertion_evidence:r', 'gov_repo.source_assertions:r']
      WHEN 'govia_legacy_read_executor' THEN ARRAY[
        'gov_repo.agent_edges:r', 'gov_repo.agent_embeddings:r', 'gov_repo.agents:r', 'gov_repo.governance_users:r']
      ELSE ARRAY['gov_repo.agent_risk_propagation:a', 'gov_repo.agent_risk_propagation:r', 'gov_repo.agent_risk_propagation:w', 'gov_repo.agents:r']
      END) AS e(x) ORDER BY x COLLATE "C");
    IF v_actual IS DISTINCT FROM v_expected THEN
      RAISE EXCEPTION 'M16_S1B2R1_POSTFLIGHT: technical owner % RLS policies % differ from %', v_role, v_actual, v_expected;
    END IF;
  END LOOP;

  -- The ledger's pinned pgcrypto schema is trusted: nobody but its owner can create objects there.
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_namespace AS n CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(n.nspacl, pg_catalog.acldefault('n', n.nspowner))) AS a
             WHERE n.nspname = v_crypto AND a.privilege_type = 'CREATE' AND a.grantee <> n.nspowner)
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_namespace AS n JOIN pg_catalog.pg_roles AS r ON r.oid = n.nspowner
                WHERE n.nspname = v_crypto AND r.rolname = ANY (v_app || v_executors)) THEN
    RAISE EXCEPTION 'M16_S1B2R1_POSTFLIGHT: pinned pgcrypto schema % is writable by a non-owner', v_crypto;
  END IF;

  -- Default privileges: postgres-created routines default to neither PUBLIC nor any application role.
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_default_acl AS d
                 WHERE d.defaclrole = 'postgres'::regrole AND d.defaclnamespace = 0 AND d.defaclobjtype = 'f')
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_default_acl AS d CROSS JOIN LATERAL pg_catalog.aclexplode(d.defaclacl) AS a
                WHERE d.defaclrole = 'postgres'::regrole AND d.defaclobjtype = 'f' AND a.privilege_type = 'EXECUTE'
                  AND (a.grantee = 0 OR a.grantee IN (SELECT r.oid FROM pg_catalog.pg_roles AS r WHERE r.rolname = ANY (v_app)))) THEN
    RAISE EXCEPTION 'M16_S1B2R1_POSTFLIGHT: postgres routine default privileges still grant PUBLIC / application EXECUTE';
  END IF;
END;
$postflight$;

COMMIT;
