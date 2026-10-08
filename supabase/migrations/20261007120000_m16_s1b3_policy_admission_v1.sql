-- M16-S1B.3: POLICY CONTENT ADMISSION on the REUSED policy stores (DB only, ADDITIVE).
-- Architecture: docs/architecture/ADR-GOVIA-OWNERSHIP-BUSINESS-POLICY-CONTROL-ENRICHMENT-v1.md §§4, 6-7, 13, 17
-- plus the frozen S1B decisions (D-3, D-4, D-5, D-13, D-14) and the S1B.3 ACP rulings:
--   * D-4: gov_repo.governance_policies.owner_user_id is LEGACY / NON-AUTHORITATIVE for M16. NOT NULL is dropped;
--     legacy rows are not rewritten; every M16-admitted policy has owner_user_id = NULL (never the actor, a
--     governance user, a JWT claim, a GovernanceParty, a default or an inference). created_by = verified actor.
--   * change_summary stays TEXT NOT NULL but is never caller input: PostgreSQL writes the legacy compatibility
--     filler 'M16_POLICY_VERSION_ADMISSION' (not authority, rationale, PII, evidence, validation or trust).
--   * Approved SECURITY DEFINER surface 22 -> 25; policy-store-capable definer surface 12 -> 15. The only three
--     new application-callable RPCs: l14_admit_governance_policy_v1, l14_admit_policy_version_v1,
--     l14_read_policy_descriptors_v1 (S1B2-I1 controlled descriptor read).
-- No historical migration is edited, no existing routine is replaced. Never run against a hosted DB from this slice.
--
-- This migration:
--   A. Preflight: the exact S1B.2 / S1B.2R1 / S1B.2R2 / S1B.2R3 baseline, or it aborts with nothing applied.
--   B. D-4 (owner_user_id DROP NOT NULL; no row rewritten).
--   C. Minimal immutable L14 admission lineage: l14_policy_admissions (M16-admitted policy identity) and
--      l14_policy_version_admissions (M16-admitted immutable version, linear per policy). A legacy row WITHOUT
--      lineage is never M16-admitted. No JSON, no free text, no PII, no mutable authority head.
--   D. Structural guards: lineage rows must mirror their exact ALLOW / POLICY_VERSION / ADMIT authorization and the
--      exact policy-store row (D-4 nullity, created_by, constant change_summary); the admitted policy descriptor is
--      frozen once admitted.
--   E. Owner-only helpers (identity content hash, durable result projection).
--   F. Three SECURITY DEFINER RPCs (service_role only). Commands are replay-first:
--      base session -> syntactic shape -> DB content hash -> syntactic support -> DB fingerprint -> AP guard SHARED ->
--      registry subject guard -> command guard -> replay arbitration -> tenant/reference/expectation resolution ->
--      effective Authority Policy -> L14_POLICY_CONTENT_ADMIT / ADMIT evaluation -> mutation -> final base-eligibility
--      recheck. ADMIT never creates a proposal, governance decision, registry state or trust promotion.
--   G. Privileges, comments, and a postflight over the EFFECTIVE post-S1B.3 catalog.
-- Authority: ONLY the CURRENT effective Authority Policy (exact immutable content hash) over the actor's CURRENT
-- locked persisted roles. Never JWT role/email, service_role, GovernanceParty, scanner, LLM or caller organisation.
-- Out of scope: POLICY_VERSION proposal/validation (S1B.4), applicability, responsibility, domains, controls,
-- legacy promotion, parent_policy_id hierarchy, policy_mandate_mappings, content-body read, current_version_id.
-- F2 untouched: no canonical_relationships DDL/DML/FK.
BEGIN;

-- Both reused stores are exclusively locked for the whole transaction (parent first).
LOCK TABLE gov_repo.governance_policies, gov_repo.policy_versions IN ACCESS EXCLUSIVE MODE;

-- ---------------------------------------------------------------------------------------
-- A. Preflight: the exact S1B.2/R1/R2/R3 baseline, or abort with nothing applied.
-- ---------------------------------------------------------------------------------------
DO $preflight$
DECLARE
  v_policies CONSTANT regclass := 'gov_repo.governance_policies'::regclass;
  v_versions CONSTANT regclass := 'gov_repo.policy_versions'::regclass;
  v_stores CONSTANT oid[] := ARRAY['gov_repo.governance_policies'::regclass::oid, 'gov_repo.policy_versions'::regclass::oid];
  v_crypto name := (SELECT e.extnamespace::regnamespace::name FROM pg_catalog.pg_extension AS e WHERE e.extname = 'pgcrypto');
  v_vector name := (SELECT e.extnamespace::regnamespace::name FROM pg_catalog.pg_extension AS e WHERE e.extname = 'vector');
  v_privileges CONSTANT text[] := ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN'];
  v_entry record;
  v_oid oid;
  v_proc record;
BEGIN
  IF pg_catalog.current_setting('server_version_num')::integer < 170000 THEN
    RAISE EXCEPTION 'M16_S1B3_PREFLIGHT: PostgreSQL 17 required' USING ERRCODE = '55000';
  END IF;
  IF v_crypto IS NULL OR v_vector IS NULL THEN
    RAISE EXCEPTION 'M16_S1B3_PREFLIGHT: pgcrypto / vector unresolved' USING ERRCODE = '55000';
  END IF;

  -- S1B.2 policy-store hardening is in place, exactly.
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attribute AS att WHERE att.attrelid = v_versions AND att.attname = 'organisation_id'
                   AND NOT att.attisdropped AND att.attnotnull)
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint AS k WHERE k.conrelid = v_versions
                      AND k.conname = 'policy_versions_organisation_policy_fkey' AND k.contype = 'f' AND k.confdeltype = 'r')
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint AS k WHERE k.conrelid = v_versions
                      AND k.conname = 'policy_versions_organisation_policy_version_hash_unique' AND k.contype = 'u')
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint AS k WHERE k.conrelid = v_policies
                      AND k.conname = 'governance_policies_organisation_policy_unique' AND k.contype = 'u')
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint AS k WHERE k.conrelid = v_policies
                      AND k.conname = 'governance_policies_code_org_unique' AND k.contype = 'u') THEN
    RAISE EXCEPTION 'M16_S1B3_PREFLIGHT: S1B.2 policy-store tenancy/identity keys missing' USING ERRCODE = '55000';
  END IF;
  IF (SELECT pg_catalog.array_agg(t.tgname::text || ':' || t.tgenabled::text || ':' || t.tgtype::text ORDER BY t.tgname::text)
      FROM pg_catalog.pg_trigger AS t WHERE t.tgrelid = v_versions AND NOT t.tgisinternal)
     IS DISTINCT FROM ARRAY['policy_versions_content_hash_guard:A:7', 'policy_versions_immutable:A:27', 'policy_versions_no_truncate:A:34']
     OR (SELECT pg_catalog.array_agg(t.tgname::text || ':' || t.tgenabled::text || ':' || t.tgtype::text ORDER BY t.tgname::text)
      FROM pg_catalog.pg_trigger AS t WHERE t.tgrelid = v_policies AND NOT t.tgisinternal)
     IS DISTINCT FROM ARRAY['governance_policies_identity_guard:A:19', 'governance_policies_no_delete:A:11',
                            'governance_policies_no_truncate:A:34', 'trg_governance_policies_updated_at:O:19'] THEN
    RAISE EXCEPTION 'M16_S1B3_PREFLIGHT: policy-store guard set is not the exact S1B.2 set' USING ERRCODE = '55000';
  END IF;
  -- D-4 is applied HERE and nowhere else.
  IF NOT (SELECT att.attnotnull FROM pg_catalog.pg_attribute AS att WHERE att.attrelid = v_policies AND att.attname = 'owner_user_id') THEN
    RAISE EXCEPTION 'M16_S1B3_PREFLIGHT: owner_user_id is already nullable (D-4 applied outside S1B.3)' USING ERRCODE = '55000';
  END IF;
  -- D-13: still zero application access and no RLS policy on either store.
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_policy AS pol WHERE pol.polrelid = ANY (v_stores))
     OR EXISTS (SELECT 1 FROM pg_catalog.unnest(v_stores) AS s(rel)
                CROSS JOIN pg_catalog.unnest(ARRAY['anon','authenticated','service_role']) AS r(role_name)
                CROSS JOIN pg_catalog.unnest(v_privileges) AS p(privilege)
                WHERE pg_catalog.has_table_privilege(r.role_name, s.rel, p.privilege)) THEN
    RAISE EXCEPTION 'M16_S1B3_PREFLIGHT: a policy store is application-accessible (D-13 broken)' USING ERRCODE = '55000';
  END IF;

  -- S1B.0 / S1B.1 framework: exact l14 relation set; reserved command kinds; D-14 guard.
  IF (SELECT pg_catalog.array_agg(c.relname::text ORDER BY c.relname::text COLLATE "C")
      FROM pg_catalog.pg_class AS c
      WHERE c.relnamespace = 'gov_repo'::regnamespace AND c.relname LIKE 'l14\_%' ESCAPE '\'
        AND c.relkind IN ('r','p','v','m','S','f')) IS DISTINCT FROM ARRAY[
    'l14_authority_policies','l14_authority_policy_heads','l14_authority_policy_rules',
    'l14_authority_policy_states','l14_authority_policy_version_proposals','l14_authority_policy_versions',
    'l14_authorization_decision_roles','l14_authorization_decision_rules','l14_authorization_decisions',
    'l14_command_results','l14_governance_decisions','l14_governance_parties','l14_governance_party_heads',
    'l14_governance_party_proposals','l14_governance_party_states','l14_proposals','l14_registry_states',
    'l14_support_links'] THEN
    RAISE EXCEPTION 'M16_S1B3_PREFLIGHT: unexpected l14 relation set (S1B.1 horizon expected)' USING ERRCODE = '55000';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint AS k
                 WHERE k.conrelid = 'gov_repo.l14_command_results'::regclass AND k.conname = 'l14_command_results_command_subject_check'
                   AND pg_catalog.pg_get_constraintdef(k.oid) LIKE '%ADMIT_GOVERNANCE_POLICY%'
                   AND pg_catalog.pg_get_constraintdef(k.oid) LIKE '%ADMIT_POLICY_VERSION%')
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger AS t
                    WHERE t.tgrelid = 'gov_repo.l14_authority_policy_rules'::regclass
                      AND t.tgname = 'l14_authority_policy_rules_registry_scope_guard' AND t.tgenabled = 'A') THEN
    RAISE EXCEPTION 'M16_S1B3_PREFLIGHT: S1B.0 reserved policy command kinds / D-14 guard missing' USING ERRCODE = '55000';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_proc AS p WHERE p.pronamespace = 'gov_repo'::regnamespace
             AND p.proname IN ('l14_admit_governance_policy_v1','l14_admit_policy_version_v1','l14_read_policy_descriptors_v1',
                               'l14_policy_identity_content_hash_v1','l14_policy_command_result_v1','l14_policy_admission_guard_v1',
                               'l14_policy_version_admission_guard_v1','l14_policy_admitted_descriptor_guard_v1')) THEN
    RAISE EXCEPTION 'M16_S1B3_PREFLIGHT: an S1B.3 routine already exists' USING ERRCODE = '55000';
  END IF;

  -- S1B.2R1 + R2 + R3: the exact 22 approved application definers (owner class, body, post-R3 config).
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
      RAISE EXCEPTION 'M16_S1B3_PREFLIGHT: approved routine % missing', v_entry.sig USING ERRCODE = '55000';
    END IF;
    SELECT p.prosecdef, p.proowner, p.prosrc, p.proconfig INTO v_proc FROM pg_catalog.pg_proc AS p WHERE p.oid = v_oid;
    IF NOT v_proc.prosecdef OR pg_catalog.pg_get_userbyid(v_proc.proowner) <> v_entry.owner_role
       OR pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(v_proc.prosrc, 'UTF8')), 'hex') <> v_entry.sha
       OR COALESCE(pg_catalog.array_to_string(v_proc.proconfig, ';'), '-') <>
          pg_catalog.replace(pg_catalog.replace(v_entry.cfg, '{crypto}', pg_catalog.quote_ident(v_crypto)), '{vschema}', pg_catalog.quote_ident(v_vector)) THEN
      RAISE EXCEPTION 'M16_S1B3_PREFLIGHT: approved routine % differs from its post-R3 owner/body/config', v_oid::regprocedure
        USING ERRCODE = '55000';
    END IF;
  END LOOP;
  -- The closed application surface is exactly those 22 (extension members excluded, any schema).
  IF (SELECT pg_catalog.count(*) FROM pg_catalog.pg_proc AS p
       WHERE p.prosecdef AND p.pronamespace NOT IN ('pg_catalog'::regnamespace, 'information_schema'::regnamespace)
         AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_depend AS d
                          WHERE d.classid = 'pg_catalog.pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e')
         AND (pg_catalog.has_function_privilege('service_role', p.oid, 'EXECUTE')
              OR pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE')
              OR pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE')
              OR EXISTS (SELECT 1 FROM pg_catalog.aclexplode(COALESCE(p.proacl, pg_catalog.acldefault('f', p.proowner))) AS a
                          WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE'))) <> 22 THEN
    RAISE EXCEPTION 'M16_S1B3_PREFLIGHT: application SECURITY DEFINER surface is not exactly the 22 baseline' USING ERRCODE = '55000';
  END IF;
  -- R3 marker: the S0 wrappers' inner closure already names pg_temp last.
  IF (SELECT COALESCE(pg_catalog.array_to_string(p.proconfig, ';'), '-') FROM pg_catalog.pg_proc AS p
      WHERE p.oid = 'gov_repo.technical_field_valid(text,text)'::regprocedure) <> 'search_path=pg_catalog, pg_temp' THEN
    RAISE EXCEPTION 'M16_S1B3_PREFLIGHT: S1B.2R3 execution-context closure not applied' USING ERRCODE = '55000';
  END IF;
END;
$preflight$;

-- ---------------------------------------------------------------------------------------
-- B. D-4: the legacy owner column stops being mandatory. No row is rewritten.
-- ---------------------------------------------------------------------------------------
ALTER TABLE gov_repo.governance_policies ALTER COLUMN owner_user_id DROP NOT NULL;

-- ---------------------------------------------------------------------------------------
-- C. Immutable admission lineage. A row here is the ONLY thing that makes a reused policy-store row
--    M16-admitted. No JSON, no free text, no PII. Pinned to its exact ALLOW / POLICY_VERSION / ADMIT authorization.
-- ---------------------------------------------------------------------------------------
CREATE TABLE gov_repo.l14_policy_admissions (
  organisation_id uuid NOT NULL REFERENCES gov_repo.organisations (organisation_id),
  policy_id uuid NOT NULL,
  admission_authorization_decision_id uuid NOT NULL,
  admission_authorization_result text NOT NULL DEFAULT 'ALLOW' CHECK (admission_authorization_result = 'ALLOW'),
  admission_subject_kind text NOT NULL DEFAULT 'POLICY_VERSION' CHECK (admission_subject_kind = 'POLICY_VERSION'),
  admission_requested_action text NOT NULL DEFAULT 'ADMIT' CHECK (admission_requested_action = 'ADMIT'),
  source_class text NOT NULL CHECK (source_class IN ('SYSTEM_SEED','LOCAL_HUMAN','SOURCE_CONNECTION')),
  support_status text NOT NULL CHECK (support_status IN ('NONE','PRESENT')),
  admitted_by_actor_user_id uuid NOT NULL REFERENCES gov_repo.governance_users (user_id),
  recorded_at timestamptz NOT NULL,
  CONSTRAINT l14_policy_admissions_pkey PRIMARY KEY (organisation_id, policy_id),
  -- One admitted policy per ALLOW ADMIT authorization (the durable result derives the policy id from it).
  CONSTRAINT l14_policy_admissions_authorization_unique UNIQUE (organisation_id, admission_authorization_decision_id),
  -- The exact same-tenant policy-store row; it can never be deleted or re-keyed underneath its admission.
  CONSTRAINT l14_policy_admissions_policy_fkey FOREIGN KEY (organisation_id, policy_id)
    REFERENCES gov_repo.governance_policies (organisation_id, policy_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT l14_policy_admissions_authorization_fkey
    FOREIGN KEY (organisation_id, admission_authorization_decision_id, admission_authorization_result,
                 admission_subject_kind, admission_requested_action)
    REFERENCES gov_repo.l14_authorization_decisions (organisation_id, authorization_decision_id, result,
                 subject_kind, requested_action)
);

CREATE TABLE gov_repo.l14_policy_version_admissions (
  organisation_id uuid NOT NULL,
  policy_id uuid NOT NULL,
  version_id uuid NOT NULL,
  content_hash character(64) NOT NULL CHECK (content_hash::text ~ '^[0-9a-f]{64}$'),
  predecessor_version_id uuid,                   -- the admitted version this one succeeds (NULL = first)
  admission_authorization_decision_id uuid NOT NULL,
  admission_authorization_result text NOT NULL DEFAULT 'ALLOW' CHECK (admission_authorization_result = 'ALLOW'),
  admission_subject_kind text NOT NULL DEFAULT 'POLICY_VERSION' CHECK (admission_subject_kind = 'POLICY_VERSION'),
  admission_requested_action text NOT NULL DEFAULT 'ADMIT' CHECK (admission_requested_action = 'ADMIT'),
  source_class text NOT NULL CHECK (source_class IN ('SYSTEM_SEED','LOCAL_HUMAN','SOURCE_CONNECTION')),
  support_status text NOT NULL CHECK (support_status IN ('NONE','PRESENT')),
  admitted_by_actor_user_id uuid NOT NULL REFERENCES gov_repo.governance_users (user_id),
  recorded_at timestamptz NOT NULL,
  CONSTRAINT l14_policy_version_admissions_pkey PRIMARY KEY (organisation_id, policy_id, version_id),
  CONSTRAINT l14_policy_version_admissions_version_unique UNIQUE (organisation_id, version_id),
  CONSTRAINT l14_policy_version_admissions_authorization_unique UNIQUE (organisation_id, admission_authorization_decision_id),
  -- Linear lineage per policy: one successor per admitted version (a concurrent loser can never fork it).
  CONSTRAINT l14_policy_version_admissions_successor_unique UNIQUE (organisation_id, policy_id, predecessor_version_id),
  CONSTRAINT l14_policy_version_admissions_self_check CHECK (predecessor_version_id IS NULL OR predecessor_version_id <> version_id),
  -- Exact tenant-safe policy + version + DB-verified content hash of the reused (immutable) version row.
  CONSTRAINT l14_policy_version_admissions_version_fkey FOREIGN KEY (organisation_id, policy_id, version_id, content_hash)
    REFERENCES gov_repo.policy_versions (organisation_id, policy_id, version_id, content_hash) ON UPDATE RESTRICT ON DELETE RESTRICT,
  -- A version is admissible only under an M16-admitted parent policy (never a legacy-only policy).
  CONSTRAINT l14_policy_version_admissions_policy_fkey FOREIGN KEY (organisation_id, policy_id)
    REFERENCES gov_repo.l14_policy_admissions (organisation_id, policy_id),
  CONSTRAINT l14_policy_version_admissions_predecessor_fkey FOREIGN KEY (organisation_id, policy_id, predecessor_version_id)
    REFERENCES gov_repo.l14_policy_version_admissions (organisation_id, policy_id, version_id),
  CONSTRAINT l14_policy_version_admissions_authorization_fkey
    FOREIGN KEY (organisation_id, admission_authorization_decision_id, admission_authorization_result,
                 admission_subject_kind, admission_requested_action)
    REFERENCES gov_repo.l14_authorization_decisions (organisation_id, authorization_decision_id, result,
                 subject_kind, requested_action)
);
-- Exactly one lineage root per policy.
CREATE UNIQUE INDEX l14_policy_version_admissions_root_uidx
  ON gov_repo.l14_policy_version_admissions (organisation_id, policy_id) WHERE predecessor_version_id IS NULL;

-- ---------------------------------------------------------------------------------------
-- D. Immutability + structural guards (raising, ENABLE ALWAYS, owner-only SECURITY INVOKER).
-- ---------------------------------------------------------------------------------------
DO $triggers$
DECLARE
  v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY['l14_policy_admissions','l14_policy_version_admissions'] LOOP
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

-- F-4 attempted-content evidence of a policy identity ADMIT: the exact admitted descriptor (code, title, type).
CREATE FUNCTION gov_repo.l14_policy_identity_content_hash_v1(p_policy_code text, p_title text, p_policy_type text)
RETURNS text
LANGUAGE sql
STABLE
STRICT
SET search_path = pg_catalog, pg_temp
AS $$ SELECT gov_repo.l14_sha256_frame_v1(ARRAY['L14_GOVERNANCE_POLICY_CONTENT_V1', p_policy_code, p_title, p_policy_type]) $$;

-- A policy admission must mirror its exact ALLOW / POLICY_VERSION / ADMIT authorization (actor, source, instant,
-- EXPECTED_NONE, attempted content) and the exact policy-store row it admits (D-4 nullity, provenance).
CREATE FUNCTION gov_repo.l14_policy_admission_guard_v1()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, pg_temp
AS $guard$
DECLARE
  v_authz record;
  v_policy record;
BEGIN
  SELECT a.actor_user_id, a.source_class, a.evaluated_at, a.attempted_content_hash, a.expectation_kind, a.expected_latest_version_id
  INTO v_authz
  FROM gov_repo.l14_authorization_decisions AS a
  WHERE a.organisation_id = NEW.organisation_id AND a.authorization_decision_id = NEW.admission_authorization_decision_id
    AND a.result = 'ALLOW' AND a.subject_kind = 'POLICY_VERSION' AND a.requested_action = 'ADMIT';
  IF NOT FOUND OR v_authz.actor_user_id IS DISTINCT FROM NEW.admitted_by_actor_user_id
     OR v_authz.source_class IS DISTINCT FROM NEW.source_class OR v_authz.evaluated_at IS DISTINCT FROM NEW.recorded_at
     OR v_authz.expectation_kind IS DISTINCT FROM 'EXPECTED_NONE' OR v_authz.expected_latest_version_id IS NOT NULL
     OR EXISTS (SELECT 1 FROM gov_repo.l14_policy_version_admissions AS va
                WHERE va.organisation_id = NEW.organisation_id
                  AND va.admission_authorization_decision_id = NEW.admission_authorization_decision_id) THEN
    RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'POLICY_ADMISSION_AUTHORIZATION_MISMATCH';
  END IF;
  SELECT gp.policy_code::text AS policy_code, gp.title::text AS title, gp.policy_type::text AS policy_type,
         gp.owner_user_id, gp.parent_policy_id, gp.created_by, gp.created_at
  INTO v_policy
  FROM gov_repo.governance_policies AS gp
  WHERE gp.organisation_id = NEW.organisation_id AND gp.policy_id = NEW.policy_id;
  IF NOT FOUND OR v_policy.owner_user_id IS NOT NULL OR v_policy.parent_policy_id IS NOT NULL
     OR v_policy.created_by IS DISTINCT FROM NEW.admitted_by_actor_user_id OR v_policy.created_at IS DISTINCT FROM NEW.recorded_at
     OR gov_repo.l14_policy_identity_content_hash_v1(v_policy.policy_code, v_policy.title, v_policy.policy_type)
        IS DISTINCT FROM v_authz.attempted_content_hash THEN
    RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'POLICY_ADMISSION_CONTENT_MISMATCH';
  END IF;
  RETURN NEW;
END;
$guard$;
CREATE TRIGGER l14_policy_admissions_guard BEFORE INSERT ON gov_repo.l14_policy_admissions
  FOR EACH ROW EXECUTE FUNCTION gov_repo.l14_policy_admission_guard_v1();
ALTER TABLE gov_repo.l14_policy_admissions ENABLE ALWAYS TRIGGER l14_policy_admissions_guard;

-- A version admission must mirror its exact authorization (actor, source, instant, attempted content hash, the
-- expected-latest it was decided under = its lineage predecessor) and the exact immutable version row (provenance
-- and the constant compatibility filler).
CREATE FUNCTION gov_repo.l14_policy_version_admission_guard_v1()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, pg_temp
AS $guard$
DECLARE
  v_authz record;
  v_version record;
BEGIN
  SELECT a.actor_user_id, a.source_class, a.evaluated_at, a.attempted_content_hash, a.expectation_kind, a.expected_latest_version_id
  INTO v_authz
  FROM gov_repo.l14_authorization_decisions AS a
  WHERE a.organisation_id = NEW.organisation_id AND a.authorization_decision_id = NEW.admission_authorization_decision_id
    AND a.result = 'ALLOW' AND a.subject_kind = 'POLICY_VERSION' AND a.requested_action = 'ADMIT';
  IF NOT FOUND OR v_authz.actor_user_id IS DISTINCT FROM NEW.admitted_by_actor_user_id
     OR v_authz.source_class IS DISTINCT FROM NEW.source_class OR v_authz.evaluated_at IS DISTINCT FROM NEW.recorded_at
     OR v_authz.attempted_content_hash IS DISTINCT FROM NEW.content_hash::text
     OR v_authz.expectation_kind IS DISTINCT FROM (CASE WHEN NEW.predecessor_version_id IS NULL THEN 'EXPECTED_NONE' ELSE 'EXPECTED_CURRENT' END)
     OR v_authz.expected_latest_version_id IS DISTINCT FROM NEW.predecessor_version_id
     OR EXISTS (SELECT 1 FROM gov_repo.l14_policy_admissions AS pa
                WHERE pa.organisation_id = NEW.organisation_id
                  AND pa.admission_authorization_decision_id = NEW.admission_authorization_decision_id) THEN
    RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'POLICY_VERSION_ADMISSION_AUTHORIZATION_MISMATCH';
  END IF;
  SELECT pv.change_summary, pv.created_by, pv.created_at INTO v_version
  FROM gov_repo.policy_versions AS pv
  WHERE pv.organisation_id = NEW.organisation_id AND pv.policy_id = NEW.policy_id AND pv.version_id = NEW.version_id;
  IF NOT FOUND OR v_version.change_summary IS DISTINCT FROM 'M16_POLICY_VERSION_ADMISSION'
     OR v_version.created_by IS DISTINCT FROM NEW.admitted_by_actor_user_id OR v_version.created_at IS DISTINCT FROM NEW.recorded_at THEN
    RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'POLICY_VERSION_ADMISSION_CONTENT_MISMATCH';
  END IF;
  RETURN NEW;
END;
$guard$;
CREATE TRIGGER l14_policy_version_admissions_guard BEFORE INSERT ON gov_repo.l14_policy_version_admissions
  FOR EACH ROW EXECUTE FUNCTION gov_repo.l14_policy_version_admission_guard_v1();
ALTER TABLE gov_repo.l14_policy_version_admissions ENABLE ALWAYS TRIGGER l14_policy_version_admissions_guard;

-- Once M16-admitted, the policy descriptor it was admitted with (code, title, type, description) and the D-4 / no-
-- hierarchy nullity can no longer drift underneath the admission. Legacy (never admitted) rows are unaffected.
CREATE FUNCTION gov_repo.l14_policy_admitted_descriptor_guard_v1()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, pg_temp
AS $guard$
BEGIN
  IF (NEW.policy_code IS DISTINCT FROM OLD.policy_code OR NEW.title IS DISTINCT FROM OLD.title
      OR NEW.policy_type IS DISTINCT FROM OLD.policy_type OR NEW.description IS DISTINCT FROM OLD.description
      OR NEW.owner_user_id IS DISTINCT FROM OLD.owner_user_id OR NEW.parent_policy_id IS DISTINCT FROM OLD.parent_policy_id)
     AND EXISTS (SELECT 1 FROM gov_repo.l14_policy_admissions AS pa
                 WHERE pa.organisation_id = OLD.organisation_id AND pa.policy_id = OLD.policy_id) THEN
    RAISE EXCEPTION 'L14_HISTORY_IMMUTABLE' USING ERRCODE = '55000', DETAIL = 'governance_policies:M16_ADMITTED_DESCRIPTOR';
  END IF;
  RETURN NEW;
END;
$guard$;
CREATE TRIGGER governance_policies_l14_admitted_descriptor_guard BEFORE UPDATE ON gov_repo.governance_policies
  FOR EACH ROW EXECUTE FUNCTION gov_repo.l14_policy_admitted_descriptor_guard_v1();
ALTER TABLE gov_repo.governance_policies ENABLE ALWAYS TRIGGER governance_policies_l14_admitted_descriptor_guard;

-- ---------------------------------------------------------------------------------------
-- E. Owner-only durable result projection (exactly as stored; replay never recomputes it).
-- ---------------------------------------------------------------------------------------
CREATE FUNCTION gov_repo.l14_policy_command_result_v1(p_organisation_id uuid, p_command_id text, p_replay boolean)
RETURNS TABLE (
  replay boolean, command_id text, command_kind text, subject_kind text, outcome text, command_fingerprint text,
  authorization_decision_id uuid, authorization_result text, deny_reason text, attempted_content_hash text,
  expectation_kind text, expected_latest_version_id uuid, policy_id uuid, version_id uuid, version_number integer,
  version_label text, content_hash text, recorded_at timestamptz
)
LANGUAGE sql
STABLE
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT p_replay, c.command_id, c.command_kind, c.subject_kind, c.outcome, c.command_fingerprint,
         c.authorization_decision_id, a.result, a.deny_reason, a.attempted_content_hash,
         a.expectation_kind, a.expected_latest_version_id, COALESCE(pa.policy_id, va.policy_id), va.version_id,
         pv.version_number, pv.version_label::text, va.content_hash::text, c.recorded_at
  FROM gov_repo.l14_command_results AS c
  LEFT JOIN gov_repo.l14_authorization_decisions AS a
    ON a.organisation_id = c.organisation_id AND a.authorization_decision_id = c.authorization_decision_id
  LEFT JOIN gov_repo.l14_policy_admissions AS pa
    ON c.command_kind = 'ADMIT_GOVERNANCE_POLICY' AND pa.organisation_id = c.organisation_id
   AND pa.admission_authorization_decision_id = c.authorization_decision_id
  LEFT JOIN gov_repo.l14_policy_version_admissions AS va
    ON c.command_kind = 'ADMIT_POLICY_VERSION' AND va.organisation_id = c.organisation_id
   AND va.admission_authorization_decision_id = c.authorization_decision_id
  LEFT JOIN gov_repo.policy_versions AS pv
    ON pv.organisation_id = va.organisation_id AND pv.policy_id = va.policy_id AND pv.version_id = va.version_id
  WHERE c.organisation_id = p_organisation_id AND c.command_id = p_command_id AND c.subject_kind = 'POLICY_VERSION'
    AND c.command_kind IN ('ADMIT_GOVERNANCE_POLICY','ADMIT_POLICY_VERSION')
$$;

-- ---------------------------------------------------------------------------------------
-- F1. RPC — ADMIT a governed policy identity (PostgreSQL mints policy_id; no decision, no state, no version).
-- ---------------------------------------------------------------------------------------
CREATE FUNCTION gov_repo.l14_admit_governance_policy_v1(
  p_verified_organisation_id uuid,
  p_verified_actor_user_id uuid,
  p_verified_session_iat bigint,
  p_verified_session_exp bigint,
  p_verified_credential_epoch timestamptz,
  p_command_id text,
  p_expectation_kind text,                 -- must be EXPECTED_NONE: a new identity is always minted
  p_policy_code text,
  p_title text,
  p_policy_type text,
  p_source_class text,
  p_support_status text,
  p_support_evidence_ids text[],
  p_caller_fingerprint text                -- assertion only; PostgreSQL recomputes
)
RETURNS TABLE (
  replay boolean, command_id text, command_kind text, subject_kind text, outcome text, command_fingerprint text,
  authorization_decision_id uuid, authorization_result text, deny_reason text, attempted_content_hash text,
  expectation_kind text, expected_latest_version_id uuid, policy_id uuid, version_id uuid, version_number integer,
  version_label text, content_hash text, recorded_at timestamptz
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
SET lock_timeout = '5s'
AS $admit_policy$
#variable_conflict use_column
DECLARE
  v_org uuid := p_verified_organisation_id;
  v_actor uuid := p_verified_actor_user_id;
  v_role_ids uuid[];
  v_support text[];
  v_content_hash text;
  v_fingerprint text;
  v_has_basis boolean := false;
  v_basis_policy uuid;
  v_basis_version uuid;
  v_basis_hash text;
  v_deny text;
  v_ordinals integer[];
  v_now timestamptz;
  v_authz uuid := pg_catalog.gen_random_uuid();
  v_policy uuid := pg_catalog.gen_random_uuid();
BEGIN
  -- 1. Base session eligibility (GV001-GV005/55P03 raise; nothing consumed). Tenant + actor come ONLY from here.
  SELECT b.role_ids INTO v_role_ids
  FROM gov_repo.l14_session_basis_v1(v_org, v_actor, p_verified_session_iat, p_verified_session_exp,
    p_verified_credential_epoch) AS b;

  -- 2. Syntactic shape (closed vocabularies, bounded descriptor; no table read).
  PERFORM gov_repo.l14_validate_command_id_v1(p_command_id, p_caller_fingerprint);
  IF p_expectation_kind IS DISTINCT FROM 'EXPECTED_NONE' THEN
    RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'EXPECTATION_MALFORMED';
  END IF;
  IF p_policy_code IS NULL OR p_policy_code !~ '^[A-Za-z0-9][A-Za-z0-9_.-]{0,19}$' THEN
    RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'POLICY_CODE_INVALID';
  END IF;
  IF p_title IS NULL OR pg_catalog.length(p_title) NOT BETWEEN 1 AND 255 OR p_title <> pg_catalog.btrim(p_title)
     OR p_title ~ '[[:cntrl:]]' THEN
    RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'POLICY_TITLE_INVALID';
  END IF;
  IF p_policy_type IS NULL OR p_policy_type NOT IN ('operational','risk','security','data','ethics','compliance') THEN
    RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'POLICY_TYPE_UNKNOWN';
  END IF;
  IF p_source_class IS NULL OR p_source_class NOT IN ('SYSTEM_SEED','LOCAL_HUMAN','SOURCE_CONNECTION') THEN
    RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'SOURCE_CLASS_UNKNOWN';
  END IF;
  IF p_source_class <> 'LOCAL_HUMAN' THEN
    RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'SOURCE_CLASS_NOT_EXECUTABLE';
  END IF;

  -- 3. Syntactic support canonicalization (existence is resolved only after replay arbitration).
  v_support := gov_repo.l14_support_syntactic_parts_v1(p_support_status, p_support_evidence_ids);

  -- 4. DB-authored descriptor hash + PostgreSQL-authoritative fingerprint.
  v_content_hash := gov_repo.l14_policy_identity_content_hash_v1(p_policy_code, p_title, p_policy_type);
  v_fingerprint := gov_repo.l14_sha256_frame_v1(
    ARRAY['L14_COMMAND_FINGERPRINT_V1', 'ADMIT_GOVERNANCE_POLICY', v_org::text, v_actor::text,
          'ADMIT', 'POLICY_VERSION', v_content_hash, p_source_class, 'EXPECTED_NONE']
    || v_support);
  IF v_fingerprint IS DISTINCT FROM p_caller_fingerprint THEN
    RAISE EXCEPTION 'L14_FINGERPRINT_MISMATCH' USING ERRCODE = 'GV008', DETAIL = 'CALLER_FINGERPRINT_DIFFERS';
  END IF;

  -- 5-6. Authority Policy guard SHARED, the per-code subject guard, then the command guard.
  PERFORM gov_repo.l14_lock_authority_policy_guard_shared_v1(v_org);
  PERFORM gov_repo.l14_lock_registry_subject_guard_v1(v_org, 'POLICY_VERSION', 'POLICY_CODE:' || p_policy_code);
  PERFORM gov_repo.l14_lock_command_guard_v1(v_org, p_command_id);

  -- 7. Replay arbitration BEFORE any L14 evaluation: the ORIGINAL result (same minted policy id).
  IF gov_repo.l14_replay_arbitrate_v1(v_org, p_command_id, v_fingerprint) THEN
    PERFORM 1 FROM gov_repo.l14_session_basis_v1(v_org, v_actor, p_verified_session_iat,
      p_verified_session_exp, p_verified_credential_epoch);
    RETURN QUERY SELECT * FROM gov_repo.l14_policy_command_result_v1(v_org, p_command_id, true);
    RETURN;
  END IF;

  -- 8. Tenant/support resolution; the code is unique per tenant (legacy or admitted).
  PERFORM gov_repo.l14_resolve_support_v1(v_org, p_support_evidence_ids);
  PERFORM 1 FROM gov_repo.governance_policies AS gp WHERE gp.organisation_id = v_org AND gp.policy_code = p_policy_code;
  IF FOUND THEN
    RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'POLICY_CODE_EXISTS';
  END IF;

  -- 9-10. The CURRENT effective Authority Policy (exact recomputed hash) is the ONLY basis.
  v_now := pg_catalog.clock_timestamp();
  SELECT b.authority_policy_id, b.version_id, b.content_hash INTO v_basis_policy, v_basis_version, v_basis_hash
  FROM gov_repo.l14_effective_authority_basis_v1(v_org, v_now) AS b;
  v_has_basis := FOUND;
  IF NOT v_has_basis THEN
    v_deny := 'NO_EFFECTIVE_AUTHORITY';
  ELSE
    SELECT e.deny_reason, e.rule_ordinals INTO v_deny, v_ordinals
    FROM gov_repo.l14_evaluate_authority_rules_v1(v_org, v_basis_policy, v_basis_version, v_role_ids,
      'L14_POLICY_CONTENT_ADMIT', 'ADMIT', false, 'IMMEDIATE') AS e;
  END IF;

  INSERT INTO gov_repo.l14_authorization_decisions (
    organisation_id, authorization_decision_id, command_id, command_fingerprint, actor_user_id,
    requested_action, subject_kind, scope_tag, source_class, proposal_id, is_self_validation,
    authority_basis, basis_authority_policy_id, basis_version_id, basis_content_hash, result, deny_reason,
    evaluated_at, attempted_content_hash, expectation_kind)
  VALUES (
    v_org, v_authz, p_command_id, v_fingerprint, v_actor,
    'ADMIT', 'POLICY_VERSION', 'ALL_ALLOWED_TARGETS', p_source_class, NULL, NULL,
    CASE WHEN v_has_basis THEN 'AUTHORITY_POLICY_VERSION' END,
    CASE WHEN v_has_basis THEN v_basis_policy END,
    CASE WHEN v_has_basis THEN v_basis_version END,
    CASE WHEN v_has_basis THEN v_basis_hash END,
    CASE WHEN v_deny IS NULL THEN 'ALLOW' ELSE 'DENY' END, v_deny, v_now,
    v_content_hash, 'EXPECTED_NONE');
  PERFORM gov_repo.l14_snapshot_roles_v1(v_org, v_authz, v_role_ids);
  IF v_has_basis THEN
    PERFORM gov_repo.l14_snapshot_policy_rules_v1(v_org, v_authz, v_basis_policy, v_basis_version, v_ordinals);
  END IF;

  IF v_deny IS NOT NULL THEN
    -- 11 (DENY). Durable authorization + result only: no policy identity, no lineage.
    INSERT INTO gov_repo.l14_command_results (organisation_id, command_id, command_kind, subject_kind,
      command_fingerprint, actor_user_id, outcome, authorization_decision_id, recorded_at)
    VALUES (v_org, p_command_id, 'ADMIT_GOVERNANCE_POLICY', 'POLICY_VERSION', v_fingerprint, v_actor, 'DENIED',
      v_authz, v_now);
  ELSE
    -- 11 (ALLOW). PostgreSQL mints the identity. D-4: owner_user_id NULL. No hierarchy. created_by = verified actor.
    INSERT INTO gov_repo.governance_policies (policy_id, policy_code, title, description, policy_type, owner_user_id,
      organisation_id, parent_policy_id, created_at, updated_at, created_by)
    VALUES (v_policy, p_policy_code, p_title, NULL, p_policy_type::gov_repo.policy_type, NULL,
      v_org, NULL, v_now, v_now, v_actor);
    INSERT INTO gov_repo.l14_policy_admissions (organisation_id, policy_id, admission_authorization_decision_id,
      source_class, support_status, admitted_by_actor_user_id, recorded_at)
    VALUES (v_org, v_policy, v_authz, p_source_class, p_support_status, v_actor, v_now);
    INSERT INTO gov_repo.l14_support_links (organisation_id, support_link_id, owner_kind,
      admission_authorization_decision_id, admission_authorization_result, admission_subject_kind,
      admission_requested_action, evidence_id)
    SELECT v_org, pg_catalog.gen_random_uuid(), 'ADMISSION', v_authz, 'ALLOW', 'POLICY_VERSION', 'ADMIT', i.id
    FROM pg_catalog.unnest(p_support_evidence_ids) AS i(id);
    INSERT INTO gov_repo.l14_command_results (organisation_id, command_id, command_kind, subject_kind,
      command_fingerprint, actor_user_id, outcome, authorization_decision_id, recorded_at)
    VALUES (v_org, p_command_id, 'ADMIT_GOVERNANCE_POLICY', 'POLICY_VERSION', v_fingerprint, v_actor, 'ADMITTED',
      v_authz, v_now);
  END IF;

  -- 12. Base session eligibility must still hold at commitment (fresh DB clock).
  PERFORM 1 FROM gov_repo.l14_session_basis_v1(v_org, v_actor, p_verified_session_iat,
    p_verified_session_exp, p_verified_credential_epoch);
  RETURN QUERY SELECT * FROM gov_repo.l14_policy_command_result_v1(v_org, p_command_id, false);
END;
$admit_policy$;

-- ---------------------------------------------------------------------------------------
-- F2. RPC — ADMIT an immutable policy version under an M16-admitted policy (expected-latest concurrency).
--     PostgreSQL mints version_id, version_number and version_label, computes content_hash over the exact
--     UTF-8 bytes, and writes the constant change_summary filler. No decision, no state, no validation.
-- ---------------------------------------------------------------------------------------
CREATE FUNCTION gov_repo.l14_admit_policy_version_v1(
  p_verified_organisation_id uuid,
  p_verified_actor_user_id uuid,
  p_verified_session_iat bigint,
  p_verified_session_exp bigint,
  p_verified_credential_epoch timestamptz,
  p_command_id text,
  p_policy_id uuid,
  p_expected_latest_version_id uuid,       -- NULL = expected-none (first admitted version)
  p_content_markdown text,
  p_content_hash text,                     -- assertion only; PostgreSQL recomputes over the exact UTF-8 bytes
  p_source_class text,
  p_support_status text,
  p_support_evidence_ids text[],
  p_caller_fingerprint text                -- assertion only; PostgreSQL recomputes
)
RETURNS TABLE (
  replay boolean, command_id text, command_kind text, subject_kind text, outcome text, command_fingerprint text,
  authorization_decision_id uuid, authorization_result text, deny_reason text, attempted_content_hash text,
  expectation_kind text, expected_latest_version_id uuid, policy_id uuid, version_id uuid, version_number integer,
  version_label text, content_hash text, recorded_at timestamptz
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
SET lock_timeout = '5s'
AS $admit_version$
#variable_conflict use_column
DECLARE
  v_org uuid := p_verified_organisation_id;
  v_actor uuid := p_verified_actor_user_id;
  v_role_ids uuid[];
  v_support text[];
  v_content_hash text;
  v_expectation text;
  v_fingerprint text;
  v_latest uuid;
  v_number integer;
  v_has_basis boolean := false;
  v_basis_policy uuid;
  v_basis_version uuid;
  v_basis_hash text;
  v_deny text;
  v_ordinals integer[];
  v_now timestamptz;
  v_authz uuid := pg_catalog.gen_random_uuid();
  v_version uuid := pg_catalog.gen_random_uuid();
BEGIN
  -- 1. Base session eligibility (GV001-GV005/55P03 raise; nothing consumed). Tenant + actor come ONLY from here.
  SELECT b.role_ids INTO v_role_ids
  FROM gov_repo.l14_session_basis_v1(v_org, v_actor, p_verified_session_iat, p_verified_session_exp,
    p_verified_credential_epoch) AS b;

  -- 2. Syntactic shape (no table read).
  PERFORM gov_repo.l14_validate_command_id_v1(p_command_id, p_caller_fingerprint);
  IF p_policy_id IS NULL THEN
    RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'POLICY_REQUIRED';
  END IF;
  IF p_content_markdown IS NULL OR pg_catalog.octet_length(p_content_markdown) NOT BETWEEN 1 AND 1048576 THEN
    RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'POLICY_CONTENT_INVALID';
  END IF;
  IF p_content_hash IS NULL OR p_content_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'CONTENT_HASH_MALFORMED';
  END IF;
  IF p_source_class IS NULL OR p_source_class NOT IN ('SYSTEM_SEED','LOCAL_HUMAN','SOURCE_CONNECTION') THEN
    RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'SOURCE_CLASS_UNKNOWN';
  END IF;
  IF p_source_class <> 'LOCAL_HUMAN' THEN
    RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'SOURCE_CLASS_NOT_EXECUTABLE';
  END IF;

  -- 3. D-3: lowercase hex SHA-256 of the exact UTF-8 bytes, no normalization. A caller hash alone is never trusted.
  v_content_hash := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p_content_markdown, 'UTF8')), 'hex');
  IF v_content_hash IS DISTINCT FROM p_content_hash THEN
    RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'CONTENT_HASH_MISMATCH';
  END IF;
  v_expectation := CASE WHEN p_expected_latest_version_id IS NULL THEN 'EXPECTED_NONE' ELSE 'EXPECTED_CURRENT' END;

  -- 4. Syntactic support, then the PostgreSQL-authoritative fingerprint.
  v_support := gov_repo.l14_support_syntactic_parts_v1(p_support_status, p_support_evidence_ids);
  v_fingerprint := gov_repo.l14_sha256_frame_v1(
    ARRAY['L14_COMMAND_FINGERPRINT_V1', 'ADMIT_POLICY_VERSION', v_org::text, v_actor::text,
          'ADMIT', 'POLICY_VERSION', p_policy_id::text, v_content_hash, p_source_class]
    || CASE WHEN p_expected_latest_version_id IS NULL THEN ARRAY['EXPECTED_NONE']
            ELSE ARRAY['EXPECTED_CURRENT', p_expected_latest_version_id::text] END
    || v_support);
  IF v_fingerprint IS DISTINCT FROM p_caller_fingerprint THEN
    RAISE EXCEPTION 'L14_FINGERPRINT_MISMATCH' USING ERRCODE = 'GV008', DETAIL = 'CALLER_FINGERPRINT_DIFFERS';
  END IF;

  -- 5-6. Authority Policy guard SHARED, the per-policy subject guard (serializes successors), the command guard.
  PERFORM gov_repo.l14_lock_authority_policy_guard_shared_v1(v_org);
  PERFORM gov_repo.l14_lock_registry_subject_guard_v1(v_org, 'POLICY_VERSION', 'POLICY:' || p_policy_id::text);
  PERFORM gov_repo.l14_lock_command_guard_v1(v_org, p_command_id);

  -- 7. Replay arbitration BEFORE any L14 evaluation: the ORIGINAL result (same minted version).
  IF gov_repo.l14_replay_arbitrate_v1(v_org, p_command_id, v_fingerprint) THEN
    PERFORM 1 FROM gov_repo.l14_session_basis_v1(v_org, v_actor, p_verified_session_iat,
      p_verified_session_exp, p_verified_credential_epoch);
    RETURN QUERY SELECT * FROM gov_repo.l14_policy_command_result_v1(v_org, p_command_id, true);
    RETURN;
  END IF;

  -- 8. Tenant/reference/support resolution: an M16-admitted parent policy of THIS organisation (a legacy-only or
  --    foreign policy is indistinguishable from an unknown id), then the exact expected-latest admitted version.
  PERFORM gov_repo.l14_resolve_support_v1(v_org, p_support_evidence_ids);
  PERFORM 1 FROM gov_repo.l14_policy_admissions AS pa WHERE pa.organisation_id = v_org AND pa.policy_id = p_policy_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'POLICY_NOT_ADMITTED';
  END IF;
  SELECT va.version_id INTO v_latest
  FROM gov_repo.l14_policy_version_admissions AS va
  WHERE va.organisation_id = v_org AND va.policy_id = p_policy_id
    AND NOT EXISTS (SELECT 1 FROM gov_repo.l14_policy_version_admissions AS s
                    WHERE s.organisation_id = va.organisation_id AND s.policy_id = va.policy_id
                      AND s.predecessor_version_id = va.version_id);
  IF p_expected_latest_version_id IS NULL AND v_latest IS NOT NULL THEN
    RAISE EXCEPTION 'L14_STALE_EXPECTATION' USING ERRCODE = 'GV009', DETAIL = 'POLICY_VERSION_EXISTS';
  END IF;
  IF p_expected_latest_version_id IS DISTINCT FROM v_latest THEN
    RAISE EXCEPTION 'L14_STALE_EXPECTATION' USING ERRCODE = 'GV009', DETAIL = 'POLICY_VERSION_EXPECTATION_MISMATCH';
  END IF;

  -- 9-10. The CURRENT effective Authority Policy (exact recomputed hash) is the ONLY basis.
  v_now := pg_catalog.clock_timestamp();
  SELECT b.authority_policy_id, b.version_id, b.content_hash INTO v_basis_policy, v_basis_version, v_basis_hash
  FROM gov_repo.l14_effective_authority_basis_v1(v_org, v_now) AS b;
  v_has_basis := FOUND;
  IF NOT v_has_basis THEN
    v_deny := 'NO_EFFECTIVE_AUTHORITY';
  ELSE
    SELECT e.deny_reason, e.rule_ordinals INTO v_deny, v_ordinals
    FROM gov_repo.l14_evaluate_authority_rules_v1(v_org, v_basis_policy, v_basis_version, v_role_ids,
      'L14_POLICY_CONTENT_ADMIT', 'ADMIT', false, 'IMMEDIATE') AS e;
  END IF;

  INSERT INTO gov_repo.l14_authorization_decisions (
    organisation_id, authorization_decision_id, command_id, command_fingerprint, actor_user_id,
    requested_action, subject_kind, scope_tag, source_class, proposal_id, is_self_validation,
    authority_basis, basis_authority_policy_id, basis_version_id, basis_content_hash, result, deny_reason,
    evaluated_at, attempted_content_hash, expectation_kind, expected_latest_version_id)
  VALUES (
    v_org, v_authz, p_command_id, v_fingerprint, v_actor,
    'ADMIT', 'POLICY_VERSION', 'ALL_ALLOWED_TARGETS', p_source_class, NULL, NULL,
    CASE WHEN v_has_basis THEN 'AUTHORITY_POLICY_VERSION' END,
    CASE WHEN v_has_basis THEN v_basis_policy END,
    CASE WHEN v_has_basis THEN v_basis_version END,
    CASE WHEN v_has_basis THEN v_basis_hash END,
    CASE WHEN v_deny IS NULL THEN 'ALLOW' ELSE 'DENY' END, v_deny, v_now,
    v_content_hash, v_expectation, p_expected_latest_version_id);
  PERFORM gov_repo.l14_snapshot_roles_v1(v_org, v_authz, v_role_ids);
  IF v_has_basis THEN
    PERFORM gov_repo.l14_snapshot_policy_rules_v1(v_org, v_authz, v_basis_policy, v_basis_version, v_ordinals);
  END IF;

  IF v_deny IS NOT NULL THEN
    -- 11 (DENY). Durable authorization + result only: no version row, no lineage.
    INSERT INTO gov_repo.l14_command_results (organisation_id, command_id, command_kind, subject_kind,
      command_fingerprint, actor_user_id, outcome, authorization_decision_id, recorded_at)
    VALUES (v_org, p_command_id, 'ADMIT_POLICY_VERSION', 'POLICY_VERSION', v_fingerprint, v_actor, 'DENIED',
      v_authz, v_now);
  ELSE
    -- 11 (ALLOW). The next number across every row of the policy (the legacy unique key stays satisfied).
    SELECT COALESCE(pg_catalog.max(pv.version_number), 0) + 1 INTO v_number
    FROM gov_repo.policy_versions AS pv
    WHERE pv.organisation_id = v_org AND pv.policy_id = p_policy_id;
    INSERT INTO gov_repo.policy_versions (version_id, organisation_id, policy_id, version_number, version_label,
      content_markdown, content_hash, change_summary, created_at, created_by)
    VALUES (v_version, v_org, p_policy_id, v_number, 'v' || v_number::text,
      p_content_markdown, v_content_hash, 'M16_POLICY_VERSION_ADMISSION', v_now, v_actor);
    INSERT INTO gov_repo.l14_policy_version_admissions (organisation_id, policy_id, version_id, content_hash,
      predecessor_version_id, admission_authorization_decision_id, source_class, support_status,
      admitted_by_actor_user_id, recorded_at)
    VALUES (v_org, p_policy_id, v_version, v_content_hash, v_latest, v_authz, p_source_class, p_support_status,
      v_actor, v_now);
    INSERT INTO gov_repo.l14_support_links (organisation_id, support_link_id, owner_kind,
      admission_authorization_decision_id, admission_authorization_result, admission_subject_kind,
      admission_requested_action, evidence_id)
    SELECT v_org, pg_catalog.gen_random_uuid(), 'ADMISSION', v_authz, 'ALLOW', 'POLICY_VERSION', 'ADMIT', i.id
    FROM pg_catalog.unnest(p_support_evidence_ids) AS i(id);
    INSERT INTO gov_repo.l14_command_results (organisation_id, command_id, command_kind, subject_kind,
      command_fingerprint, actor_user_id, outcome, authorization_decision_id, recorded_at)
    VALUES (v_org, p_command_id, 'ADMIT_POLICY_VERSION', 'POLICY_VERSION', v_fingerprint, v_actor, 'ADMITTED',
      v_authz, v_now);
  END IF;

  -- 12. Base session eligibility must still hold at commitment (fresh DB clock).
  PERFORM 1 FROM gov_repo.l14_session_basis_v1(v_org, v_actor, p_verified_session_iat,
    p_verified_session_exp, p_verified_credential_epoch);
  RETURN QUERY SELECT * FROM gov_repo.l14_policy_command_result_v1(v_org, p_command_id, false);
END;
$admit_version$;

-- ---------------------------------------------------------------------------------------
-- F3. RPC — S1B2-I1 controlled policy descriptor read. Read-only; M16-admitted policies and versions of the
--     session tenant ONLY; never content_markdown, legacy status/approval/QES, or any legacy version pointer.
--     Until S1B.4 every admitted version is NOT_VALIDATED (never inferred from legacy status).
-- ---------------------------------------------------------------------------------------
CREATE FUNCTION gov_repo.l14_read_policy_descriptors_v1(
  p_verified_organisation_id uuid,
  p_verified_actor_user_id uuid,
  p_verified_session_iat bigint,
  p_verified_session_exp bigint,
  p_verified_credential_epoch timestamptz,
  p_policy_id uuid                         -- NULL = every admitted policy of the session tenant
)
RETURNS TABLE (
  policy_id uuid, policy_code text, title text, policy_type text,
  policy_admission_authorization_decision_id uuid, policy_recorded_at timestamptz,
  version_id uuid, version_number integer, version_label text, content_hash text,
  version_admission_authorization_decision_id uuid, version_recorded_at timestamptz,
  validation_state text
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
SET lock_timeout = '5s'
AS $read_descriptors$
#variable_conflict use_column
BEGIN
  -- Base session eligibility is revalidated on every read; the tenant comes ONLY from the verified principal.
  PERFORM 1 FROM gov_repo.l14_session_basis_v1(p_verified_organisation_id, p_verified_actor_user_id,
    p_verified_session_iat, p_verified_session_exp, p_verified_credential_epoch);
  RETURN QUERY
  SELECT pa.policy_id, gp.policy_code::text, gp.title::text, gp.policy_type::text,
         pa.admission_authorization_decision_id, pa.recorded_at,
         va.version_id, pv.version_number, pv.version_label::text, va.content_hash::text,
         va.admission_authorization_decision_id, va.recorded_at,
         'NOT_VALIDATED'::text
  FROM gov_repo.l14_policy_admissions AS pa
  JOIN gov_repo.governance_policies AS gp
    ON gp.organisation_id = pa.organisation_id AND gp.policy_id = pa.policy_id
  LEFT JOIN gov_repo.l14_policy_version_admissions AS va
    ON va.organisation_id = pa.organisation_id AND va.policy_id = pa.policy_id
  LEFT JOIN gov_repo.policy_versions AS pv
    ON pv.organisation_id = va.organisation_id AND pv.policy_id = va.policy_id AND pv.version_id = va.version_id
   AND pv.content_hash = va.content_hash
  WHERE pa.organisation_id = p_verified_organisation_id
    AND (p_policy_id IS NULL OR pa.policy_id = p_policy_id)
  ORDER BY gp.policy_code::text COLLATE "C", pa.policy_id, pv.version_number;
END;
$read_descriptors$;

-- ---------------------------------------------------------------------------------------
-- G. Privileges. The hostile 20260818013113 defaults hand every new gov_repo table to service_role: removed. No
--    application role gets any privilege on the lineage tables. Exactly the three S1B.3 RPCs become
--    service_role-executable; every helper/guard stays owner-only.
-- ---------------------------------------------------------------------------------------
ALTER TABLE gov_repo.l14_policy_admissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE gov_repo.l14_policy_version_admissions ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE gov_repo.l14_policy_admissions, gov_repo.l14_policy_version_admissions
FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION
  gov_repo.l14_policy_identity_content_hash_v1(text, text, text),
  gov_repo.l14_policy_admission_guard_v1(),
  gov_repo.l14_policy_version_admission_guard_v1(),
  gov_repo.l14_policy_admitted_descriptor_guard_v1(),
  gov_repo.l14_policy_command_result_v1(uuid, text, boolean),
  gov_repo.l14_admit_governance_policy_v1(uuid, uuid, bigint, bigint, timestamptz, text, text, text, text, text, text, text, text[], text),
  gov_repo.l14_admit_policy_version_v1(uuid, uuid, bigint, bigint, timestamptz, text, uuid, uuid, text, text, text, text, text[], text),
  gov_repo.l14_read_policy_descriptors_v1(uuid, uuid, bigint, bigint, timestamptz, uuid)
FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION
  gov_repo.l14_admit_governance_policy_v1(uuid, uuid, bigint, bigint, timestamptz, text, text, text, text, text, text, text, text[], text),
  gov_repo.l14_admit_policy_version_v1(uuid, uuid, bigint, bigint, timestamptz, text, uuid, uuid, text, text, text, text, text[], text),
  gov_repo.l14_read_policy_descriptors_v1(uuid, uuid, bigint, bigint, timestamptz, uuid)
TO service_role;

COMMENT ON COLUMN gov_repo.governance_policies.owner_user_id IS 'LEGACY / NON-AUTHORITATIVE for M16 (D-4, M16-S1B.3): nullable; legacy rows are not rewritten. Every M16-admitted policy has owner_user_id = NULL and it is never filled from the actor, a governance user, a JWT claim, a GovernanceParty, a default or an inference. Future M16 ownership is a GovernanceParty + RESPONSIBILITY_ASSIGNMENT, never this column.';
COMMENT ON COLUMN gov_repo.policy_versions.change_summary IS 'LEGACY compatibility filler only. For every M16-admitted version PostgreSQL writes exactly M16_POLICY_VERSION_ADMISSION (never caller input). It is not authority, rationale, PII, evidence, validation, trust or user-authored semantics.';
COMMENT ON TABLE gov_repo.l14_policy_admissions IS 'M16-S1B.3 immutable admission lineage of a governed policy identity in the REUSED gov_repo.governance_policies store: organisation, PostgreSQL-minted policy_id, exact ALLOW POLICY_VERSION ADMIT authorization (L14_POLICY_CONTENT_ADMIT), source class, support status, actor, recorded_at. A policy row without this lineage is legacy and never M16-admitted. No JSON, no free text, no PII; ADMIT is not VALIDATE.';
COMMENT ON TABLE gov_repo.l14_policy_version_admissions IS 'M16-S1B.3 immutable admission lineage of an immutable policy version in the REUSED gov_repo.policy_versions store: exact tenant-safe policy + version + DB-verified content hash, linear predecessor (expected-latest concurrency), exact ALLOW POLICY_VERSION ADMIT authorization, source class, support status, actor, recorded_at. Requires an M16-admitted parent policy. Never a validation, governance decision or trust state.';
COMMENT ON FUNCTION gov_repo.l14_read_policy_descriptors_v1(uuid, uuid, bigint, bigint, timestamptz, uuid) IS 'M16-S1B.3 (S1B2-I1) controlled policy descriptor read: base session eligibility revalidated; M16-admitted policies/versions of the verified tenant only; descriptors + content hash + admission lineage ids; validation_state is NOT_VALIDATED until S1B.4. Never content_markdown, legacy status/approval/QES or any legacy version pointer.';
COMMENT ON FUNCTION gov_repo.l14_policy_command_result_v1(uuid, text, boolean) IS 'M16-S1B.3 owner-only durable policy admission result projection (replay returns the original).';
COMMENT ON FUNCTION gov_repo.l14_policy_admitted_descriptor_guard_v1() IS 'M16-S1B.3 owner-only guard: the descriptor (code, title, type, description) and the D-4 / no-hierarchy nullity of an M16-admitted policy are frozen.';

-- ---------------------------------------------------------------------------------------
-- H. Postflight over the EFFECTIVE post-S1B.3 catalog (after ALL grants, including the broad legacy defaults).
--    Self-contained and re-executable. Historical postflights keep their own horizon and are not altered.
-- ---------------------------------------------------------------------------------------
DO $postflight$
DECLARE
  v_policies CONSTANT regclass := 'gov_repo.governance_policies'::regclass;
  v_versions CONSTANT regclass := 'gov_repo.policy_versions'::regclass;
  v_admissions CONSTANT regclass := 'gov_repo.l14_policy_admissions'::regclass;
  v_version_admissions CONSTANT regclass := 'gov_repo.l14_policy_version_admissions'::regclass;
  v_stores CONSTANT oid[] := ARRAY['gov_repo.governance_policies'::regclass::oid, 'gov_repo.policy_versions'::regclass::oid];
  v_guarded CONSTANT oid[] := ARRAY['gov_repo.governance_policies'::regclass::oid, 'gov_repo.policy_versions'::regclass::oid,
                                    'gov_repo.l14_policy_admissions'::regclass::oid, 'gov_repo.l14_policy_version_admissions'::regclass::oid];
  v_app CONSTANT text[] := ARRAY['anon','authenticated','service_role'];
  v_expected_l14 CONSTANT text[] := ARRAY[
    'l14_authority_policies','l14_authority_policy_heads','l14_authority_policy_rules',
    'l14_authority_policy_states','l14_authority_policy_version_proposals','l14_authority_policy_versions',
    'l14_authorization_decision_roles','l14_authorization_decision_rules','l14_authorization_decisions',
    'l14_command_results','l14_governance_decisions','l14_governance_parties','l14_governance_party_heads',
    'l14_governance_party_proposals','l14_governance_party_states','l14_policy_admissions',
    'l14_policy_version_admissions','l14_proposals','l14_registry_states','l14_support_links'];
  v_mutable_heads CONSTANT text[] := ARRAY['l14_authority_policy_heads','l14_governance_party_heads'];
  v_public_l14 CONSTANT text[] := ARRAY[
    'l14_admit_authority_policy_version_v1','l14_admit_governance_party_v1','l14_admit_governance_policy_v1',
    'l14_admit_policy_version_v1','l14_decide_authority_policy_proposal_v1','l14_decide_governance_party_proposal_v1',
    'l14_read_policy_descriptors_v1','l14_submit_governance_party_proposal_v1','l14_submit_proposal_v1'];
  v_new_rpcs CONSTANT text[] := ARRAY['l14_admit_governance_policy_v1','l14_admit_policy_version_v1','l14_read_policy_descriptors_v1'];
  v_new_routines CONSTANT text[] := ARRAY[
    'l14_admit_governance_policy_v1','l14_admit_policy_version_v1','l14_policy_admission_guard_v1',
    'l14_policy_admitted_descriptor_guard_v1','l14_policy_command_result_v1','l14_policy_identity_content_hash_v1',
    'l14_policy_version_admission_guard_v1','l14_read_policy_descriptors_v1'];
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

  -- H1. Exact l14 relation set (tables only; no views/sequences).
  IF (SELECT pg_catalog.array_agg(c.relname::text ORDER BY c.relname::text COLLATE "C")
      FROM pg_catalog.pg_class AS c
      WHERE c.relnamespace = 'gov_repo'::regnamespace AND c.relname LIKE 'l14\_%' ESCAPE '\'
        AND c.relkind IN ('r','p','v','m','S','f')) IS DISTINCT FROM v_expected_l14 THEN
    RAISE EXCEPTION 'M16_S1B3_POSTFLIGHT: unexpected l14 relation set';
  END IF;

  -- H2. Every l14 table + both reused stores: RLS-enabled ordinary table, zero non-owner / column / application
  --     privilege (incl. inherited), NO RLS policy at all (no permissive path), no JSON; immutable history.
  FOR v_rel IN
    SELECT c.oid, c.relname, c.relkind, c.relowner, c.relacl, c.relrowsecurity
    FROM pg_catalog.pg_class AS c
    WHERE c.relnamespace = 'gov_repo'::regnamespace AND (c.relname::text = ANY (v_expected_l14) OR c.oid = ANY (v_stores))
  LOOP
    IF v_rel.relkind <> 'r' OR NOT v_rel.relrowsecurity THEN
      RAISE EXCEPTION 'M16_S1B3_POSTFLIGHT: % must be an RLS-enabled ordinary table', v_rel.relname;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_catalog.aclexplode(COALESCE(v_rel.relacl, pg_catalog.acldefault('r', v_rel.relowner))) AS a
               WHERE a.grantee <> v_rel.relowner) THEN
      RAISE EXCEPTION 'M16_S1B3_POSTFLIGHT: % has a non-owner table grant', v_rel.relname;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_attribute AS att WHERE att.attrelid = v_rel.oid AND att.attacl IS NOT NULL) THEN
      RAISE EXCEPTION 'M16_S1B3_POSTFLIGHT: % has column-level grants', v_rel.relname;
    END IF;
    FOREACH v_role IN ARRAY v_app LOOP
      FOREACH v_privilege IN ARRAY v_privileges LOOP
        IF pg_catalog.has_table_privilege(v_role, v_rel.oid, v_privilege) THEN
          RAISE EXCEPTION 'M16_S1B3_POSTFLIGHT: % holds % on %', v_role, v_privilege, v_rel.relname;
        END IF;
      END LOOP;
      IF pg_catalog.has_any_column_privilege(v_role, v_rel.oid, 'SELECT, INSERT, UPDATE, REFERENCES') THEN
        RAISE EXCEPTION 'M16_S1B3_POSTFLIGHT: % holds a column privilege on %', v_role, v_rel.relname;
      END IF;
    END LOOP;
    IF (v_rel.oid = ANY (v_stores) OR v_rel.oid IN (v_admissions, v_version_admissions))
       AND EXISTS (SELECT 1 FROM pg_catalog.pg_policy AS pol WHERE pol.polrelid = v_rel.oid) THEN
      RAISE EXCEPTION 'M16_S1B3_POSTFLIGHT: % carries an RLS policy (no application access path may exist)', v_rel.relname;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_attribute AS att
               WHERE att.attrelid = v_rel.oid AND att.attnum > 0 AND NOT att.attisdropped
                 AND att.atttypid IN ('json'::regtype, 'jsonb'::regtype)) THEN
      RAISE EXCEPTION 'M16_S1B3_POSTFLIGHT: % has a JSON column', v_rel.relname;
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
      RAISE EXCEPTION 'M16_S1B3_POSTFLIGHT: % lacks ALWAYS raising BEFORE UPDATE/DELETE and TRUNCATE triggers', v_rel.relname;
    END IF;
  END LOOP;

  -- H3. Lineage shape: exactly the pinned columns (no JSON, no free text, no PII), the structural guards ALWAYS.
  IF (SELECT pg_catalog.array_agg(att.attname::text || ':' || pg_catalog.format_type(att.atttypid, att.atttypmod) ORDER BY att.attnum)
      FROM pg_catalog.pg_attribute AS att WHERE att.attrelid = v_admissions AND att.attnum > 0 AND NOT att.attisdropped)
     IS DISTINCT FROM ARRAY['organisation_id:uuid','policy_id:uuid','admission_authorization_decision_id:uuid',
       'admission_authorization_result:text','admission_subject_kind:text','admission_requested_action:text',
       'source_class:text','support_status:text','admitted_by_actor_user_id:uuid','recorded_at:timestamp with time zone']
     OR (SELECT pg_catalog.array_agg(att.attname::text || ':' || pg_catalog.format_type(att.atttypid, att.atttypmod) ORDER BY att.attnum)
      FROM pg_catalog.pg_attribute AS att WHERE att.attrelid = v_version_admissions AND att.attnum > 0 AND NOT att.attisdropped)
     IS DISTINCT FROM ARRAY['organisation_id:uuid','policy_id:uuid','version_id:uuid','content_hash:character(64)',
       'predecessor_version_id:uuid','admission_authorization_decision_id:uuid','admission_authorization_result:text',
       'admission_subject_kind:text','admission_requested_action:text','source_class:text','support_status:text',
       'admitted_by_actor_user_id:uuid','recorded_at:timestamp with time zone'] THEN
    RAISE EXCEPTION 'M16_S1B3_POSTFLIGHT: admission lineage columns are not exactly the pinned set';
  END IF;
  -- Every text column of the lineage is a closed vocabulary (CHECK IN / =), never arbitrary text.
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_attribute AS att
             WHERE att.attrelid IN (v_admissions, v_version_admissions) AND att.attnum > 0 AND NOT att.attisdropped
               AND att.atttypid = 'text'::regtype
               AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint AS k
                               WHERE k.conrelid = att.attrelid AND k.contype = 'c' AND k.conkey = ARRAY[att.attnum]::int2[])) THEN
    RAISE EXCEPTION 'M16_S1B3_POSTFLIGHT: an admission lineage text column is not a closed vocabulary';
  END IF;
  IF (SELECT pg_catalog.count(*) FROM pg_catalog.pg_trigger AS t
      WHERE t.tgenabled = 'A' AND NOT t.tgisinternal AND (
        (t.tgrelid = v_admissions AND t.tgname = 'l14_policy_admissions_guard'
          AND t.tgfoid = 'gov_repo.l14_policy_admission_guard_v1()'::regprocedure)
        OR (t.tgrelid = v_version_admissions AND t.tgname = 'l14_policy_version_admissions_guard'
          AND t.tgfoid = 'gov_repo.l14_policy_version_admission_guard_v1()'::regprocedure))) <> 2 THEN
    RAISE EXCEPTION 'M16_S1B3_POSTFLIGHT: admission lineage structural guard missing or not ALWAYS';
  END IF;
  -- Exact FK shape: lineage -> exact store rows / authorization / parent admission; never a cascading path.
  IF (SELECT pg_catalog.array_agg(k.conname::text ORDER BY k.conname::text) FROM pg_catalog.pg_constraint AS k
      WHERE k.contype = 'f' AND k.conrelid IN (v_admissions, v_version_admissions)
        AND k.confdeltype IN ('a','r') AND k.confupdtype IN ('a','r') AND k.convalidated) IS DISTINCT FROM ARRAY[
       'l14_policy_admissions_admitted_by_actor_user_id_fkey','l14_policy_admissions_authorization_fkey',
       'l14_policy_admissions_organisation_id_fkey','l14_policy_admissions_policy_fkey',
       'l14_policy_version_admissions_admitted_by_actor_user_id_fkey','l14_policy_version_admissions_authorization_fkey',
       'l14_policy_version_admissions_policy_fkey','l14_policy_version_admissions_predecessor_fkey',
       'l14_policy_version_admissions_version_fkey']
     -- (Legacy policy_mandate_mappings -> governance_policies CASCADE is the open S1B2-I2 hold; the policy row
     -- itself can never be deleted.)
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_constraint AS k
                WHERE k.contype = 'f'
                  AND (k.conrelid IN (v_versions, v_admissions, v_version_admissions)
                       OR k.confrelid IN (v_versions, v_admissions, v_version_admissions))
                  AND (k.confdeltype NOT IN ('a','r') OR k.confupdtype NOT IN ('a','r'))) THEN
    RAISE EXCEPTION 'M16_S1B3_POSTFLIGHT: admission lineage FK set wrong or a cascading FK touches policy_versions / lineage';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_indexes AS i
                 WHERE i.schemaname = 'gov_repo' AND i.indexname = 'l14_policy_version_admissions_root_uidx')
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint AS k
                    WHERE k.conrelid = v_version_admissions AND k.conname = 'l14_policy_version_admissions_successor_unique') THEN
    RAISE EXCEPTION 'M16_S1B3_POSTFLIGHT: linear version lineage keys missing';
  END IF;

  -- H4. Reused stores: exact guard sets (the S1B.2 set + the admitted-descriptor guard), D-4, change_summary.
  IF (SELECT pg_catalog.array_agg(t.tgname::text || ':' || t.tgenabled::text || ':' || t.tgtype::text ORDER BY t.tgname::text)
      FROM pg_catalog.pg_trigger AS t WHERE t.tgrelid = v_versions AND NOT t.tgisinternal)
     IS DISTINCT FROM ARRAY['policy_versions_content_hash_guard:A:7', 'policy_versions_immutable:A:27', 'policy_versions_no_truncate:A:34']
     OR (SELECT pg_catalog.array_agg(t.tgname::text || ':' || t.tgenabled::text || ':' || t.tgtype::text ORDER BY t.tgname::text)
      FROM pg_catalog.pg_trigger AS t WHERE t.tgrelid = v_policies AND NOT t.tgisinternal)
     IS DISTINCT FROM ARRAY['governance_policies_identity_guard:A:19', 'governance_policies_l14_admitted_descriptor_guard:A:19',
                            'governance_policies_no_delete:A:11', 'governance_policies_no_truncate:A:34',
                            'trg_governance_policies_updated_at:O:19'] THEN
    RAISE EXCEPTION 'M16_S1B3_POSTFLIGHT: policy-store guard sets are not exactly S1B.2 + the S1B.3 admitted-descriptor guard';
  END IF;
  IF (SELECT att.attnotnull FROM pg_catalog.pg_attribute AS att WHERE att.attrelid = v_policies AND att.attname = 'owner_user_id')
     OR pg_catalog.col_description(v_policies, (SELECT att.attnum FROM pg_catalog.pg_attribute AS att
                                                WHERE att.attrelid = v_policies AND att.attname = 'owner_user_id')::integer)
        NOT LIKE 'LEGACY / NON-AUTHORITATIVE for M16 (D-4%' THEN
    RAISE EXCEPTION 'M16_S1B3_POSTFLIGHT: D-4 not resolved (owner_user_id nullable + LEGACY/NON-AUTHORITATIVE comment)';
  END IF;
  IF NOT (SELECT att.attnotnull AND att.atttypid = 'text'::regtype FROM pg_catalog.pg_attribute AS att
          WHERE att.attrelid = v_versions AND att.attname = 'change_summary')
     OR (SELECT pg_catalog.count(*) FROM pg_catalog.pg_proc AS p
         WHERE p.pronamespace = 'gov_repo'::regnamespace AND p.proname::text = ANY (v_new_routines)
           AND (p.prosrc LIKE '%change_summary%')) <> 2
     OR NOT (SELECT p.prosrc LIKE '%''M16_POLICY_VERSION_ADMISSION''%' FROM pg_catalog.pg_proc AS p
             WHERE p.oid = 'gov_repo.l14_admit_policy_version_v1(uuid,uuid,bigint,bigint,timestamp with time zone,text,uuid,uuid,text,text,text,text,text[],text)'::regprocedure)
     THEN
    RAISE EXCEPTION 'M16_S1B3_POSTFLIGHT: change_summary is not the DB-written constant';
  END IF;
  -- Exact INPUT parameters: the caller can never choose policy_id (identity), version_id / number / label,
  -- organisation, actor, owner, change_summary or the stored content hash.
  FOR v_entry IN
    SELECT m.sig, m.args FROM (VALUES
      ('gov_repo.l14_admit_governance_policy_v1(uuid,uuid,bigint,bigint,timestamp with time zone,text,text,text,text,text,text,text,text[],text)',
       'p_verified_organisation_id,p_verified_actor_user_id,p_verified_session_iat,p_verified_session_exp,p_verified_credential_epoch,p_command_id,p_expectation_kind,p_policy_code,p_title,p_policy_type,p_source_class,p_support_status,p_support_evidence_ids,p_caller_fingerprint'),
      ('gov_repo.l14_admit_policy_version_v1(uuid,uuid,bigint,bigint,timestamp with time zone,text,uuid,uuid,text,text,text,text,text[],text)',
       'p_verified_organisation_id,p_verified_actor_user_id,p_verified_session_iat,p_verified_session_exp,p_verified_credential_epoch,p_command_id,p_policy_id,p_expected_latest_version_id,p_content_markdown,p_content_hash,p_source_class,p_support_status,p_support_evidence_ids,p_caller_fingerprint'),
      ('gov_repo.l14_read_policy_descriptors_v1(uuid,uuid,bigint,bigint,timestamp with time zone,uuid)',
       'p_verified_organisation_id,p_verified_actor_user_id,p_verified_session_iat,p_verified_session_exp,p_verified_credential_epoch,p_policy_id')
    ) AS m(sig, args)
  LOOP
    IF (SELECT pg_catalog.string_agg(a.name, ',' ORDER BY a.ord)
        FROM pg_catalog.pg_proc AS p
        CROSS JOIN LATERAL ROWS FROM (pg_catalog.unnest(p.proargnames), pg_catalog.unnest(p.proargmodes)) WITH ORDINALITY AS a(name, mode, ord)
        WHERE p.oid = pg_catalog.to_regprocedure(v_entry.sig) AND a.mode IN ('i','b','v')) IS DISTINCT FROM v_entry.args THEN
      RAISE EXCEPTION 'M16_S1B3_POSTFLIGHT: % input parameters are not exactly the closed command shape', v_entry.sig;
    END IF;
  END LOOP;

  -- H5. New SQL never touches legacy authority, the legacy version pointer, governance/validation state or F2.
  FOR v_fn IN
    SELECT p.oid, p.proname, p.prosrc FROM pg_catalog.pg_proc AS p
    WHERE p.pronamespace = 'gov_repo'::regnamespace AND p.proname::text = ANY (v_new_routines)
  LOOP
    IF v_fn.prosrc ~ 'current_version_id' THEN
      RAISE EXCEPTION 'M16_S1B3_POSTFLIGHT: % references the legacy current_version_id', v_fn.proname;
    END IF;
    IF v_fn.prosrc ~ '(approved_by|approval_date|reviewed_by|approver_user_id|qes_signature_id|ledger_entry_seq|\mstatus\M|effective_date|expiry_date)' THEN
      RAISE EXCEPTION 'M16_S1B3_POSTFLIGHT: % references legacy status/approval/QES fields', v_fn.proname;
    END IF;
    IF v_fn.prosrc ~ '(l14_governance_decisions|l14_registry_states|l14_proposals|l14_governance_party|registry_state|canonical_relationships|policy_mandate_mappings)'
       OR (v_fn.proname <> 'l14_admit_policy_version_v1' AND v_fn.prosrc ~ 'content_markdown') THEN
      RAISE EXCEPTION 'M16_S1B3_POSTFLIGHT: % reaches governance-decision / validation state, F2, mappings or content bodies', v_fn.proname;
    END IF;
  END LOOP;

  -- H6. Every l14 routine: pinned search_path, no PUBLIC/anon/authenticated EXECUTE; the nine public RPCs are
  --     SECURITY DEFINER + service_role-only; every other l14 routine is an owner-only SECURITY INVOKER helper.
  FOR v_fn IN
    SELECT p.oid, p.proname, p.proowner, p.proacl, p.prosecdef, p.proconfig
    FROM pg_catalog.pg_proc AS p
    WHERE p.pronamespace = 'gov_repo'::regnamespace AND p.proname LIKE 'l14\_%' ESCAPE '\'
  LOOP
    IF EXISTS (SELECT 1 FROM pg_catalog.aclexplode(COALESCE(v_fn.proacl, pg_catalog.acldefault('f', v_fn.proowner))) AS a
               WHERE a.privilege_type = 'EXECUTE' AND a.grantee = 0) THEN
      RAISE EXCEPTION 'M16_S1B3_POSTFLIGHT: % has PUBLIC EXECUTE', v_fn.proname;
    END IF;
    FOREACH v_role IN ARRAY ARRAY['anon','authenticated'] LOOP
      IF pg_catalog.has_function_privilege(v_role, v_fn.oid, 'EXECUTE') THEN
        RAISE EXCEPTION 'M16_S1B3_POSTFLIGHT: % executable by %', v_fn.proname, v_role;
      END IF;
    END LOOP;
    IF NOT COALESCE(v_fn.proconfig @> ARRAY['search_path=pg_catalog, pg_temp'], false) THEN
      RAISE EXCEPTION 'M16_S1B3_POSTFLIGHT: % search_path not pinned to pg_catalog, pg_temp', v_fn.proname;
    END IF;
    IF v_fn.proname::text = ANY (v_public_l14) THEN
      IF NOT v_fn.prosecdef OR NOT pg_catalog.has_function_privilege('service_role', v_fn.oid, 'EXECUTE')
         OR EXISTS (SELECT 1 FROM pg_catalog.aclexplode(v_fn.proacl) AS a
                    WHERE a.grantee NOT IN (v_fn.proowner, 'service_role'::regrole::oid)) THEN
        RAISE EXCEPTION 'M16_S1B3_POSTFLIGHT: public RPC % ACL/definer shape wrong', v_fn.proname;
      END IF;
    ELSIF v_fn.prosecdef OR EXISTS (SELECT 1 FROM pg_catalog.aclexplode(COALESCE(v_fn.proacl,
            pg_catalog.acldefault('f', v_fn.proowner))) AS a WHERE a.grantee <> v_fn.proowner) THEN
      RAISE EXCEPTION 'M16_S1B3_POSTFLIGHT: internal helper % must be owner-only SECURITY INVOKER', v_fn.proname;
    END IF;
  END LOOP;
  IF (SELECT pg_catalog.array_agg(p.proname::text ORDER BY p.proname::text COLLATE "C") FROM pg_catalog.pg_proc AS p
      WHERE p.pronamespace = 'gov_repo'::regnamespace AND p.proname LIKE 'l14\_%' ESCAPE '\'
        AND pg_catalog.has_function_privilege('service_role', p.oid, 'EXECUTE')) IS DISTINCT FROM v_public_l14
     OR (SELECT pg_catalog.count(*) FROM pg_catalog.pg_proc AS p
         WHERE p.pronamespace = 'gov_repo'::regnamespace AND p.proname LIKE 'l14\_%' ESCAPE '\' AND p.prosecdef) <> 9
     OR (SELECT pg_catalog.count(*) FROM pg_catalog.pg_proc AS p
         WHERE p.pronamespace = 'gov_repo'::regnamespace AND p.proname::text = ANY (v_new_routines)) <> 8 THEN
    RAISE EXCEPTION 'M16_S1B3_POSTFLIGHT: the public L14 RPC surface must be exactly the six S1B.1 + three S1B.3 RPCs (no overloads)';
  END IF;

  -- H7. Closed application SECURITY DEFINER surface (S1B.2R1 Control A + B on the post-S1B.3 catalog):
  --     exactly 25 approved identities (exact owner class, body hash, config, service_role-only EXECUTE, no overload);
  --     exactly 15 of them policy-store-capable (postgres-owned).
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
      ('gov_repo.l14_read_policy_descriptors_v1(uuid,uuid,bigint,bigint,timestamp with time zone,uuid)', 'postgres', '83e1af08aadf8ff704483c4f36815fe84d09436593b92e691b549db11598451c', 'search_path=pg_catalog, pg_temp;lock_timeout=5s'),
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
      RAISE EXCEPTION 'M16_S1B3_POSTFLIGHT: approved routine % missing', v_entry.sig;
    END IF;
    SELECT p.proname, p.pronamespace, p.prosecdef, p.proowner, p.prosrc, p.proconfig, p.proacl INTO v_proc
    FROM pg_catalog.pg_proc AS p WHERE p.oid = v_oid;
    IF NOT v_proc.prosecdef THEN
      RAISE EXCEPTION 'M16_S1B3_POSTFLIGHT: % is not SECURITY DEFINER', v_oid::regprocedure;
    END IF;
    IF pg_catalog.pg_get_userbyid(v_proc.proowner) <> v_entry.owner_role THEN
      RAISE EXCEPTION 'M16_S1B3_POSTFLIGHT: % owner % is not %', v_oid::regprocedure, pg_catalog.pg_get_userbyid(v_proc.proowner), v_entry.owner_role;
    END IF;
    IF pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(v_proc.prosrc, 'UTF8')), 'hex') <> v_entry.sha THEN
      RAISE EXCEPTION 'M16_S1B3_POSTFLIGHT: % body hash changed', v_oid::regprocedure;
    END IF;
    IF COALESCE(pg_catalog.array_to_string(v_proc.proconfig, ';'), '-') <>
       pg_catalog.replace(pg_catalog.replace(v_entry.cfg, '{crypto}', pg_catalog.quote_ident(v_crypto)), '{vschema}', pg_catalog.quote_ident(v_vector)) THEN
      RAISE EXCEPTION 'M16_S1B3_POSTFLIGHT: % config changed: %', v_oid::regprocedure, v_proc.proconfig;
    END IF;
    IF NOT pg_catalog.has_function_privilege('service_role', v_oid, 'EXECUTE')
       OR pg_catalog.has_function_privilege('anon', v_oid, 'EXECUTE')
       OR pg_catalog.has_function_privilege('authenticated', v_oid, 'EXECUTE')
       OR EXISTS (SELECT 1 FROM pg_catalog.aclexplode(COALESCE(v_proc.proacl, pg_catalog.acldefault('f', v_proc.proowner))) AS a
                  WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE') THEN
      RAISE EXCEPTION 'M16_S1B3_POSTFLIGHT: % application EXECUTE is not exactly service_role', v_oid::regprocedure;
    END IF;
    IF v_proc.proname::text = ANY (v_new_rpcs)
       AND EXISTS (SELECT 1 FROM pg_catalog.aclexplode(v_proc.proacl) AS a
                   WHERE a.grantee NOT IN (v_proc.proowner, 'service_role'::regrole::oid) OR (a.grantee = 'service_role'::regrole::oid AND a.privilege_type <> 'EXECUTE')) THEN
      RAISE EXCEPTION 'M16_S1B3_POSTFLIGHT: % EXECUTE ACL is not exactly owner + service_role', v_oid::regprocedure;
    END IF;
    IF (SELECT pg_catalog.count(*) FROM pg_catalog.pg_proc AS p WHERE p.pronamespace = v_proc.pronamespace AND p.proname = v_proc.proname) <> 1 THEN
      RAISE EXCEPTION 'M16_S1B3_POSTFLIGHT: overload of approved routine %', v_oid::regprocedure;
    END IF;
    v_approved := v_approved || v_oid;
    IF v_entry.owner_role = 'postgres' THEN
      IF v_proc.proowner <> ALL (v_capable) THEN
        RAISE EXCEPTION 'M16_S1B3_POSTFLIGHT: canonical L14/S0 owner of % unexpectedly lost policy-store capability', v_oid::regprocedure;
      END IF;
      v_frozen := v_frozen || v_oid;
    ELSIF v_proc.proowner = ANY (v_capable) THEN
      RAISE EXCEPTION 'M16_S1B3_POSTFLIGHT: owner of % has policy-store capability', v_oid::regprocedure;
    END IF;
  END LOOP;
  IF pg_catalog.cardinality(v_approved) <> 25 OR pg_catalog.cardinality(v_frozen) <> 15 THEN
    RAISE EXCEPTION 'M16_S1B3_POSTFLIGHT: approved surface is not exactly 25 (15 policy-store-capable)';
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
      RAISE EXCEPTION 'M16_S1B3_POSTFLIGHT: CLOSED_SURFACE unapproved application-executable SECURITY DEFINER %', v_row.oid::regprocedure;
    END IF;
    IF v_row.proowner = ANY (v_capable) AND v_row.oid <> ALL (v_frozen) THEN
      RAISE EXCEPTION 'M16_S1B3_POSTFLIGHT: POLICY_STORE_OWNER application definer % outside the approved 15', v_row.oid::regprocedure;
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
                          WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE'))) <> 25 THEN
    RAISE EXCEPTION 'M16_S1B3_POSTFLIGHT: application SECURITY DEFINER surface is not exactly 25';
  END IF;
  -- Every application definer that can reach a policy store is one of the 15 approved policy-store-capable RPCs.
  FOR v_fn IN
    SELECT p.oid FROM pg_catalog.pg_proc AS p
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
      RAISE EXCEPTION 'M16_S1B3_POSTFLIGHT: application definer % reaches a policy store outside the approved 15', v_fn.oid::regprocedure;
    END IF;
  END LOOP;

  -- H8. Default privileges: postgres-created routines (global + gov_repo) grant EXECUTE to neither PUBLIC nor an
  --     application role. (Table/sequence defaults are the legacy 20260818013113 service_role grants; every S1B.3
  --     table carries an explicit REVOKE and its EFFECTIVE ACL is proven closed above.)
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_default_acl AS d
                 WHERE d.defaclrole = 'postgres'::regrole AND d.defaclnamespace = 0 AND d.defaclobjtype = 'f')
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_default_acl AS d CROSS JOIN LATERAL pg_catalog.aclexplode(d.defaclacl) AS a
                WHERE d.defaclrole = 'postgres'::regrole AND d.defaclobjtype = 'f' AND a.privilege_type = 'EXECUTE'
                  AND d.defaclnamespace IN (0, 'gov_repo'::regnamespace)
                  AND (a.grantee = 0 OR a.grantee IN (SELECT r.oid FROM pg_catalog.pg_roles AS r WHERE r.rolname = ANY (v_app)))) THEN
    RAISE EXCEPTION 'M16_S1B3_POSTFLIGHT: postgres routine default privileges grant PUBLIC / application EXECUTE';
  END IF;

  -- H9. No writable/readable view leak and no sequence leak into the stores or the lineage (any schema, transitive).
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_inherits AS i WHERE i.inhrelid = ANY (v_guarded) OR i.inhparent = ANY (v_guarded)) THEN
    RAISE EXCEPTION 'M16_S1B3_POSTFLIGHT: inheritance involves a policy store or the admission lineage';
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
      RAISE EXCEPTION 'M16_S1B3_POSTFLIGHT: view % reaching a policy store / lineage has a PUBLIC grant', v_rel.relname;
    END IF;
    FOREACH v_role IN ARRAY v_app LOOP
      FOREACH v_privilege IN ARRAY v_privileges LOOP
        IF pg_catalog.has_table_privilege(v_role, v_rel.oid, v_privilege) THEN
          RAISE EXCEPTION 'M16_S1B3_POSTFLIGHT: % holds % on view % reaching a policy store / lineage', v_role, v_privilege, v_rel.relname;
        END IF;
      END LOOP;
      IF pg_catalog.has_any_column_privilege(v_role, v_rel.oid, 'SELECT, INSERT, UPDATE, REFERENCES') THEN
        RAISE EXCEPTION 'M16_S1B3_POSTFLIGHT: % holds a column privilege on view % reaching a policy store / lineage', v_role, v_rel.relname;
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
        RAISE EXCEPTION 'M16_S1B3_POSTFLIGHT: % holds a privilege on sequence %', v_role, v_rel.relname;
      END IF;
    END LOOP;
  END LOOP;

  -- H10. Frozen enumerations: exactly 11 canonical object kinds and 12 governed relationship types; no POLICY /
  --      PARTY / DOMAIN / CONTROL kind and no OWNS / APPLIES_POLICY / CONTROLLED_BY relationship.
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
    RAISE EXCEPTION 'M16_S1B3_POSTFLIGHT: canonical object kinds (11) / governed relationship types (12) changed';
  END IF;

  -- H11. F2: nothing on the L14 / policy surface references canonical_relationships; no S1B.3 routine is a trigger
  --      on it.
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_constraint AS k
             WHERE k.confrelid = 'gov_repo.canonical_relationships'::regclass
               AND (k.conrelid = ANY (v_stores)
                    OR k.conrelid IN (SELECT c.oid FROM pg_catalog.pg_class AS c
                                      WHERE c.relnamespace = 'gov_repo'::regnamespace AND c.relname LIKE 'l14\_%' ESCAPE '\')))
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_trigger AS t JOIN pg_catalog.pg_proc AS p ON p.oid = t.tgfoid
                WHERE t.tgrelid = 'gov_repo.canonical_relationships'::regclass AND p.proname::text = ANY (v_new_routines)) THEN
    RAISE EXCEPTION 'M16_S1B3_POSTFLIGHT: F2 boundary violated';
  END IF;

  -- H12. S0 wrapper/eligibility naming contracts stay intact.
  IF (SELECT pg_catalog.count(*) FROM pg_catalog.pg_proc AS p WHERE p.pronamespace = 'gov_repo'::regnamespace
        AND p.proname IN ('apply_review_transition_governed_v1','record_authorized_reconciliation_governed_v1',
                          'materialize_object_reconciliation_governed_v1','materialize_relationship_reconciliation_governed_v1',
                          'record_technical_field_decision_governed_v1','record_execution_field_decision_governed_v1')) <> 6
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_proc AS p WHERE p.pronamespace = 'gov_repo'::regnamespace
        AND p.proname LIKE 'l14\_%' ESCAPE '\' AND (p.proname LIKE '%eligibility%' OR p.proname LIKE '%governed%')) THEN
    RAISE EXCEPTION 'M16_S1B3_POSTFLIGHT: S0 naming contract disturbed';
  END IF;
END;
$postflight$;

COMMIT;
