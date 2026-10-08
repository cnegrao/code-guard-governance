-- M16-S1B.4: POLICY_VERSION governance validation (DB only, ADDITIVE on S1B.0 / S1B.1 / S1B.3).
-- Architecture: docs/architecture/ADR-GOVIA-OWNERSHIP-BUSINESS-POLICY-CONTROL-ENRICHMENT-v1.md
-- §§4, 6-7, 9, 13, 16-18, 20-21, 23 plus the frozen S1B decisions (D-1..D-14) and the S1B.1R1 interval ruling.
-- No historical migration is edited. Never run against a hosted DB from this slice.
--
-- S1B.3 established POLICY IDENTITY + IMMUTABLE POLICY VERSION + M16 ADMISSION LINEAGE. Admission is not validation.
-- S1B.4 establishes, over the EXISTING S1B.0 framework (no second governance framework):
--   POLICY_VERSION PROPOSAL -> AUTHORIZATION -> GOVERNANCE DECISION -> IMMUTABLE VALIDATED / REVOKED STATE
--   -> BITEMPORAL RESOLUTION.
-- The governed subject is the exact S1B.3-admitted tuple organisation_id + policy_id + version_id + content_hash.
-- Never a version id alone, a policy id alone, a version number / label, a legacy version pointer, legacy
-- status / approval / QES, or a mutable label. A legacy-only (never admitted) version is never a subject.
--
-- This migration:
--   A. Preflight: the exact merged S1B.3 baseline, or it aborts with nothing applied.
--   B. Typed immutable POLICY_VERSION proposal detail over l14_proposals (VALIDATE: no target; REVOKE: the exact
--      VALIDATED state of the same tuple) and typed immutable POLICY_VERSION state detail over l14_registry_states
--      (linear, same-tuple, alternating VALIDATED -> REVOKED -> VALIDATED lineage), both pinned to the exact S1B.3
--      admission lineage row AND the exact (organisation, policy, version, content hash) store key.
--   C. Technical compare-and-set head per governed tuple (pointer only; RPC-maintained; reconstructible).
--   D. Structural guards: state / proposal detail mirror their envelopes; the proposal / state source class is the
--      S1B.3 admission lineage source class (no source laundering); the S1B.1R1 interval rule.
--   E. Owner-only helpers: durable result projection, exact bitemporal resolver, current validation condition.
--   F. Two NEW SECURITY DEFINER RPCs (service_role only): SUBMIT and DECIDE, replay-first:
--      base session -> syntactic shape -> syntactic support -> DB fingerprint -> AP guard SHARED -> registry subject
--      guard -> command guard -> replay arbitration -> tenant/reference/support resolution -> effective Authority
--      Policy -> L14_POLICY_VERSION_VALIDATE evaluation -> mutation -> final base-eligibility recheck.
--   G. The EXISTING controlled descriptor read gov_repo.l14_read_policy_descriptors_v1 is REPLACED in place (same
--      identity / arguments; return shape extended), now projecting the CURRENT governed validation condition.
--   H. Privileges, comments, and a postflight over the EFFECTIVE post-S1B.4 catalog:
--      approved application SECURITY DEFINER surface 25 -> 27; policy-store-capable 15 -> 17.
-- Authority: ONLY the CURRENT effective Authority Policy (exact immutable content hash) over the actor's CURRENT
-- locked persisted roles, permission L14_POLICY_VERSION_VALIDATE, requested action = the exact outcome. Never JWT
-- role/email, service_role, bootstrap, GovernanceParty, scanner, LLM, legacy status/approval or caller organisation.
-- VALIDATE never modifies a policy store row, the S1B.3 admission lineage, a legacy pointer / status / approval / QES
-- field, and never creates POLICY_APPLICABILITY. F2 untouched: no canonical_relationships DDL/DML/FK.
BEGIN;

-- ---------------------------------------------------------------------------------------
-- A. Preflight: the exact merged S1B.3 baseline, or abort with nothing applied.
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
    RAISE EXCEPTION 'M16_S1B4_PREFLIGHT: PostgreSQL 17 required' USING ERRCODE = '55000';
  END IF;
  IF v_crypto IS NULL OR v_vector IS NULL THEN
    RAISE EXCEPTION 'M16_S1B4_PREFLIGHT: pgcrypto / vector unresolved' USING ERRCODE = '55000';
  END IF;
  -- Exact S1B.3 l14 relation set (tables only).
  IF (SELECT pg_catalog.array_agg(c.relname::text ORDER BY c.relname::text COLLATE "C")
      FROM pg_catalog.pg_class AS c
      WHERE c.relnamespace = 'gov_repo'::regnamespace AND c.relname LIKE 'l14\_%' ESCAPE '\'
        AND c.relkind IN ('r','p','v','m','S','f')) IS DISTINCT FROM ARRAY[
    'l14_authority_policies','l14_authority_policy_heads','l14_authority_policy_rules',
    'l14_authority_policy_states','l14_authority_policy_version_proposals','l14_authority_policy_versions',
    'l14_authorization_decision_roles','l14_authorization_decision_rules','l14_authorization_decisions',
    'l14_command_results','l14_governance_decisions','l14_governance_parties','l14_governance_party_heads',
    'l14_governance_party_proposals','l14_governance_party_states','l14_policy_admissions',
    'l14_policy_version_admissions','l14_proposals','l14_registry_states','l14_support_links'] THEN
    RAISE EXCEPTION 'M16_S1B4_PREFLIGHT: unexpected l14 relation set (S1B.3 horizon expected)' USING ERRCODE = '55000';
  END IF;
  -- The S1B.3 admission lineage keys and the store hash key this slice pins to.
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint AS k WHERE k.conrelid = 'gov_repo.l14_policy_version_admissions'::regclass
                   AND k.conname = 'l14_policy_version_admissions_pkey' AND k.contype = 'p')
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint AS k WHERE k.conrelid = 'gov_repo.policy_versions'::regclass
                      AND k.conname = 'policy_versions_organisation_policy_version_hash_unique' AND k.contype = 'u')
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger AS t WHERE t.tgrelid = 'gov_repo.l14_policy_version_admissions'::regclass
                      AND t.tgname = 'l14_policy_version_admissions_guard' AND t.tgenabled = 'A') THEN
    RAISE EXCEPTION 'M16_S1B4_PREFLIGHT: S1B.3 admission lineage / store hash key missing' USING ERRCODE = '55000';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_proc AS p WHERE p.pronamespace = 'gov_repo'::regnamespace
             AND p.proname IN ('l14_submit_policy_version_proposal_v1','l14_decide_policy_version_proposal_v1',
                               'l14_policy_version_command_result_v1','l14_policy_version_valid_state_v1',
                               'l14_policy_version_validation_condition_v1','l14_policy_version_state_guard_v1',
                               'l14_policy_version_proposal_guard_v1','l14_policy_version_head_guard_v1')) THEN
    RAISE EXCEPTION 'M16_S1B4_PREFLIGHT: an S1B.4 routine already exists' USING ERRCODE = '55000';
  END IF;
  -- The exact 25 approved application definers of the merged S1B.3 catalog (owner class, body, config).
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
      RAISE EXCEPTION 'M16_S1B4_PREFLIGHT: approved routine % missing', v_entry.sig USING ERRCODE = '55000';
    END IF;
    SELECT p.prosecdef, p.proowner, p.prosrc, p.proconfig INTO v_proc FROM pg_catalog.pg_proc AS p WHERE p.oid = v_oid;
    IF NOT v_proc.prosecdef OR pg_catalog.pg_get_userbyid(v_proc.proowner) <> v_entry.owner_role
       OR pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(v_proc.prosrc, 'UTF8')), 'hex') <> v_entry.sha
       OR COALESCE(pg_catalog.array_to_string(v_proc.proconfig, ';'), '-') <>
          pg_catalog.replace(pg_catalog.replace(v_entry.cfg, '{crypto}', pg_catalog.quote_ident(v_crypto)), '{vschema}', pg_catalog.quote_ident(v_vector)) THEN
      RAISE EXCEPTION 'M16_S1B4_PREFLIGHT: approved routine % differs from its merged S1B.3 owner/body/config', v_oid::regprocedure
        USING ERRCODE = '55000';
    END IF;
  END LOOP;
  -- The closed application surface is exactly those 25 (extension members excluded, any schema).
  IF (SELECT pg_catalog.count(*) FROM pg_catalog.pg_proc AS p
       WHERE p.prosecdef AND p.pronamespace NOT IN ('pg_catalog'::regnamespace, 'information_schema'::regnamespace)
         AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_depend AS d
                          WHERE d.classid = 'pg_catalog.pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e')
         AND (pg_catalog.has_function_privilege('service_role', p.oid, 'EXECUTE')
              OR pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE')
              OR pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE')
              OR EXISTS (SELECT 1 FROM pg_catalog.aclexplode(COALESCE(p.proacl, pg_catalog.acldefault('f', p.proowner))) AS a
                          WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE'))) <> 25 THEN
    RAISE EXCEPTION 'M16_S1B4_PREFLIGHT: application SECURITY DEFINER surface is not exactly the 25 S1B.3 baseline' USING ERRCODE = '55000';
  END IF;
  -- No POLICY_VERSION governance history may pre-exist (S1B.3 never wrote any).
  IF EXISTS (SELECT 1 FROM gov_repo.l14_proposals AS p WHERE p.subject_kind = 'POLICY_VERSION')
     OR EXISTS (SELECT 1 FROM gov_repo.l14_registry_states AS s WHERE s.subject_kind = 'POLICY_VERSION')
     OR EXISTS (SELECT 1 FROM gov_repo.l14_governance_decisions AS d WHERE d.subject_kind = 'POLICY_VERSION') THEN
    RAISE EXCEPTION 'M16_S1B4_PREFLIGHT: POLICY_VERSION governance history already exists' USING ERRCODE = '55000';
  END IF;
END;
$preflight$;

-- ---------------------------------------------------------------------------------------
-- B1. Typed immutable POLICY_VERSION state detail over the common envelope. No content, no legacy field.
--     Lineage per governed tuple is linear and alternating: the first state is VALIDATED; a REVOKED state follows
--     (and revokes) exactly its VALIDATED predecessor; a re-validation follows a tombstone.
-- ---------------------------------------------------------------------------------------
CREATE TABLE gov_repo.l14_policy_version_states (
  organisation_id uuid NOT NULL,
  state_id uuid NOT NULL,
  subject_kind text NOT NULL DEFAULT 'POLICY_VERSION' CHECK (subject_kind = 'POLICY_VERSION'),
  state_kind text NOT NULL CHECK (state_kind IN ('VALIDATED','REVOKED')),
  policy_id uuid NOT NULL,
  version_id uuid NOT NULL,
  content_hash character(64) NOT NULL CHECK (content_hash::text ~ '^[0-9a-f]{64}$'),
  predecessor_state_id uuid,                     -- copy of the envelope value (verified on insert)
  predecessor_state_kind text GENERATED ALWAYS AS (
    CASE WHEN predecessor_state_id IS NULL THEN NULL
         WHEN state_kind = 'VALIDATED' THEN 'REVOKED' ELSE 'VALIDATED' END) STORED
    CHECK (predecessor_state_kind IS NULL OR predecessor_state_kind IN ('VALIDATED','REVOKED')),
  revokes_state_id uuid,                         -- copy of the envelope value (verified on insert)
  revoked_state_kind text GENERATED ALWAYS AS (
    CASE WHEN revokes_state_id IS NULL THEN NULL ELSE 'VALIDATED' END) STORED
    CHECK (revoked_state_kind IS NULL OR revoked_state_kind = 'VALIDATED'),
  CONSTRAINT l14_policy_version_states_pkey PRIMARY KEY (organisation_id, state_id),
  CONSTRAINT l14_policy_version_states_subject_unique
    UNIQUE (organisation_id, state_id, policy_id, version_id, content_hash),
  CONSTRAINT l14_policy_version_states_kind_unique
    UNIQUE (organisation_id, state_id, policy_id, version_id, content_hash, state_kind),
  CONSTRAINT l14_policy_version_states_shape_check CHECK (
    (state_kind = 'VALIDATED' AND revokes_state_id IS NULL)
    OR (state_kind = 'REVOKED' AND revokes_state_id IS NOT NULL AND predecessor_state_id = revokes_state_id)),
  -- The envelope row of exactly this subject kind and state kind.
  CONSTRAINT l14_policy_version_states_envelope_fkey
    FOREIGN KEY (organisation_id, state_id, subject_kind, state_kind)
    REFERENCES gov_repo.l14_registry_states (organisation_id, state_id, subject_kind, state_kind),
  -- The exact S1B.3 admission lineage row (a legacy-only version has none) ...
  CONSTRAINT l14_policy_version_states_admission_fkey FOREIGN KEY (organisation_id, policy_id, version_id)
    REFERENCES gov_repo.l14_policy_version_admissions (organisation_id, policy_id, version_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  -- ... AND the exact tenant-safe store key including the DB-verified content hash.
  CONSTRAINT l14_policy_version_states_version_fkey FOREIGN KEY (organisation_id, policy_id, version_id, content_hash)
    REFERENCES gov_repo.policy_versions (organisation_id, policy_id, version_id, content_hash) ON UPDATE RESTRICT ON DELETE RESTRICT,
  -- Same tuple, alternating kinds (never VALIDATED -> VALIDATED: no overlapping validity).
  CONSTRAINT l14_policy_version_states_predecessor_fkey
    FOREIGN KEY (organisation_id, predecessor_state_id, policy_id, version_id, content_hash, predecessor_state_kind)
    REFERENCES gov_repo.l14_policy_version_states (organisation_id, state_id, policy_id, version_id, content_hash, state_kind),
  CONSTRAINT l14_policy_version_states_revokes_fkey
    FOREIGN KEY (organisation_id, revokes_state_id, policy_id, version_id, content_hash, revoked_state_kind)
    REFERENCES gov_repo.l14_policy_version_states (organisation_id, state_id, policy_id, version_id, content_hash, state_kind)
);
-- Exactly one lineage root per governed tuple, and one successor per state.
CREATE UNIQUE INDEX l14_policy_version_states_root_uidx
  ON gov_repo.l14_policy_version_states (organisation_id, policy_id, version_id, content_hash) WHERE predecessor_state_id IS NULL;
CREATE UNIQUE INDEX l14_policy_version_states_successor_uidx
  ON gov_repo.l14_policy_version_states (organisation_id, predecessor_state_id) WHERE predecessor_state_id IS NOT NULL;

-- ---------------------------------------------------------------------------------------
-- B2. Typed immutable POLICY_VERSION proposal detail over l14_proposals. No content copy, no rationale.
-- ---------------------------------------------------------------------------------------
CREATE TABLE gov_repo.l14_policy_version_proposals (
  organisation_id uuid NOT NULL,
  proposal_id uuid NOT NULL,
  subject_kind text NOT NULL DEFAULT 'POLICY_VERSION' CHECK (subject_kind = 'POLICY_VERSION'),
  intent text NOT NULL CHECK (intent IN ('VALIDATE','REVOKE')),
  policy_id uuid NOT NULL,
  version_id uuid NOT NULL,
  content_hash character(64) NOT NULL CHECK (content_hash::text ~ '^[0-9a-f]{64}$'),
  requested_effective_from timestamptz,          -- NULL = IMMEDIATE (DB transaction instant)
  target_state_id uuid,                          -- exact REVOKE target
  target_state_kind text GENERATED ALWAYS AS (
    CASE WHEN target_state_id IS NULL THEN NULL ELSE 'VALIDATED' END) STORED
    CHECK (target_state_kind IS NULL OR target_state_kind = 'VALIDATED'),
  CONSTRAINT l14_policy_version_proposals_pkey PRIMARY KEY (organisation_id, proposal_id),
  CONSTRAINT l14_policy_version_proposals_envelope_fkey
    FOREIGN KEY (organisation_id, proposal_id, subject_kind, intent)
    REFERENCES gov_repo.l14_proposals (organisation_id, proposal_id, subject_kind, intent),
  CONSTRAINT l14_policy_version_proposals_admission_fkey FOREIGN KEY (organisation_id, policy_id, version_id)
    REFERENCES gov_repo.l14_policy_version_admissions (organisation_id, policy_id, version_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT l14_policy_version_proposals_version_fkey FOREIGN KEY (organisation_id, policy_id, version_id, content_hash)
    REFERENCES gov_repo.policy_versions (organisation_id, policy_id, version_id, content_hash) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT l14_policy_version_proposals_target_check CHECK (
    (intent = 'VALIDATE' AND target_state_id IS NULL) OR (intent = 'REVOKE' AND target_state_id IS NOT NULL)),
  -- A REVOKE pins an exact VALIDATED state of the SAME governed tuple.
  CONSTRAINT l14_policy_version_proposals_target_fkey
    FOREIGN KEY (organisation_id, target_state_id, policy_id, version_id, content_hash, target_state_kind)
    REFERENCES gov_repo.l14_policy_version_states (organisation_id, state_id, policy_id, version_id, content_hash, state_kind)
);

-- ---------------------------------------------------------------------------------------
-- C. Technical head per governed tuple (pointer only; never authoritative on its own; reconstructible as the
--    lineage state without a successor). Created by the first state-appending decision, never by a proposal.
-- ---------------------------------------------------------------------------------------
CREATE TABLE gov_repo.l14_policy_version_heads (
  organisation_id uuid NOT NULL,
  policy_id uuid NOT NULL,
  version_id uuid NOT NULL,
  content_hash character(64) NOT NULL CHECK (content_hash::text ~ '^[0-9a-f]{64}$'),
  latest_state_id uuid,
  CONSTRAINT l14_policy_version_heads_pkey PRIMARY KEY (organisation_id, policy_id, version_id),
  CONSTRAINT l14_policy_version_heads_admission_fkey FOREIGN KEY (organisation_id, policy_id, version_id)
    REFERENCES gov_repo.l14_policy_version_admissions (organisation_id, policy_id, version_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT l14_policy_version_heads_version_fkey FOREIGN KEY (organisation_id, policy_id, version_id, content_hash)
    REFERENCES gov_repo.policy_versions (organisation_id, policy_id, version_id, content_hash) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT l14_policy_version_heads_state_fkey
    FOREIGN KEY (organisation_id, latest_state_id, policy_id, version_id, content_hash)
    REFERENCES gov_repo.l14_policy_version_states (organisation_id, state_id, policy_id, version_id, content_hash)
);

-- ---------------------------------------------------------------------------------------
-- D. Immutability + structural guards (raising, ENABLE ALWAYS, owner-only SECURITY INVOKER).
-- ---------------------------------------------------------------------------------------
DO $triggers$
DECLARE
  v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY['l14_policy_version_states','l14_policy_version_proposals'] LOOP
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

-- A proposal's source class is the S1B.3 admission lineage source class of its exact tuple (no laundering).
CREATE FUNCTION gov_repo.l14_policy_version_proposal_guard_v1()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, pg_temp
AS $guard$
DECLARE
  v_envelope_source text;
  v_lineage_source text;
BEGIN
  SELECT p.source_class INTO v_envelope_source
  FROM gov_repo.l14_proposals AS p
  WHERE p.organisation_id = NEW.organisation_id AND p.proposal_id = NEW.proposal_id AND p.subject_kind = 'POLICY_VERSION';
  SELECT va.source_class INTO v_lineage_source
  FROM gov_repo.l14_policy_version_admissions AS va
  WHERE va.organisation_id = NEW.organisation_id AND va.policy_id = NEW.policy_id AND va.version_id = NEW.version_id
    AND va.content_hash = NEW.content_hash;
  IF v_envelope_source IS NULL OR v_lineage_source IS NULL OR v_envelope_source IS DISTINCT FROM v_lineage_source THEN
    RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'POLICY_VERSION_PROPOSAL_SOURCE_MISMATCH';
  END IF;
  RETURN NEW;
END;
$guard$;
CREATE TRIGGER l14_policy_version_proposals_guard BEFORE INSERT ON gov_repo.l14_policy_version_proposals
  FOR EACH ROW EXECUTE FUNCTION gov_repo.l14_policy_version_proposal_guard_v1();
ALTER TABLE gov_repo.l14_policy_version_proposals ENABLE ALWAYS TRIGGER l14_policy_version_proposals_guard;

-- A state detail must mirror its envelope exactly (kind, lineage, lineage source class), belong to the proposal the
-- envelope's governance decision decided, and respect the S1B.1R1 interval rules (defence in depth: the RPC checks
-- the same rules first with the same closed errors).
CREATE FUNCTION gov_repo.l14_policy_version_state_guard_v1()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, pg_temp
AS $guard$
DECLARE
  v_envelope record;
  v_proposal record;
  v_lineage_source text;
  v_related_from timestamptz;
BEGIN
  SELECT s.state_kind, s.predecessor_state_id, s.revokes_state_id, s.effective_from, s.governance_decision_id, s.source_class
  INTO v_envelope
  FROM gov_repo.l14_registry_states AS s
  WHERE s.organisation_id = NEW.organisation_id AND s.state_id = NEW.state_id AND s.subject_kind = 'POLICY_VERSION';
  SELECT va.source_class INTO v_lineage_source
  FROM gov_repo.l14_policy_version_admissions AS va
  WHERE va.organisation_id = NEW.organisation_id AND va.policy_id = NEW.policy_id AND va.version_id = NEW.version_id
    AND va.content_hash = NEW.content_hash;
  IF NOT FOUND OR v_envelope.state_kind IS DISTINCT FROM NEW.state_kind
     OR v_envelope.predecessor_state_id IS DISTINCT FROM NEW.predecessor_state_id
     OR v_envelope.revokes_state_id IS DISTINCT FROM NEW.revokes_state_id
     OR v_envelope.source_class IS DISTINCT FROM v_lineage_source THEN
    RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'POLICY_VERSION_STATE_ENVELOPE_MISMATCH';
  END IF;
  SELECT t.policy_id, t.version_id, t.content_hash, t.intent, t.target_state_id INTO v_proposal
  FROM gov_repo.l14_governance_decisions AS d
  JOIN gov_repo.l14_policy_version_proposals AS t
    ON t.organisation_id = d.organisation_id AND t.proposal_id = d.proposal_id
  WHERE d.organisation_id = NEW.organisation_id AND d.governance_decision_id = v_envelope.governance_decision_id;
  IF NOT FOUND OR v_proposal.policy_id IS DISTINCT FROM NEW.policy_id OR v_proposal.version_id IS DISTINCT FROM NEW.version_id
     OR v_proposal.content_hash IS DISTINCT FROM NEW.content_hash
     OR v_proposal.intent IS DISTINCT FROM (CASE NEW.state_kind WHEN 'VALIDATED' THEN 'VALIDATE' ELSE 'REVOKE' END)
     OR v_proposal.target_state_id IS DISTINCT FROM NEW.revokes_state_id THEN
    RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'POLICY_VERSION_STATE_PROPOSAL_MISMATCH';
  END IF;
  IF NEW.predecessor_state_id IS NOT NULL THEN
    SELECT s.effective_from INTO v_related_from
    FROM gov_repo.l14_registry_states AS s
    WHERE s.organisation_id = NEW.organisation_id AND s.state_id = NEW.predecessor_state_id;
    -- REVOKED: at or after the target's effective_from (equality = cancellation from that exact business instant;
    -- the recorded-time axis keeps the earlier knowledge). Never before it. Re-validation: never before the tombstone.
    IF NEW.state_kind = 'REVOKED' AND v_envelope.effective_from < v_related_from THEN
      RAISE EXCEPTION 'L14_CONTINUITY_VIOLATION' USING ERRCODE = 'GV011', DETAIL = 'REVOKE_BEFORE_TARGET_EFFECTIVE';
    END IF;
    IF NEW.state_kind = 'VALIDATED' AND NOT (v_envelope.effective_from >= v_related_from) THEN
      RAISE EXCEPTION 'L14_CONTINUITY_VIOLATION' USING ERRCODE = 'GV011', DETAIL = 'REVALIDATION_OVERLAPS_PRIOR_INTERVAL';
    END IF;
  END IF;
  RETURN NEW;
END;
$guard$;
CREATE TRIGGER l14_policy_version_states_guard BEFORE INSERT ON gov_repo.l14_policy_version_states
  FOR EACH ROW EXECUTE FUNCTION gov_repo.l14_policy_version_state_guard_v1();
ALTER TABLE gov_repo.l14_policy_version_states ENABLE ALWAYS TRIGGER l14_policy_version_states_guard;

-- The head is the only mutable S1B.4 table: created with no state, identity fixed, never deleted/truncated, and only
-- ever advanced to the direct lineage successor of its current state.
CREATE FUNCTION gov_repo.l14_policy_version_head_guard_v1()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, pg_temp
AS $head$
BEGIN
  IF TG_OP IN ('DELETE', 'TRUNCATE') THEN
    RAISE EXCEPTION 'L14_HISTORY_IMMUTABLE' USING ERRCODE = '55000', DETAIL = 'l14_policy_version_heads:' || TG_OP;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.latest_state_id IS NOT NULL THEN
      RAISE EXCEPTION 'L14_HISTORY_IMMUTABLE' USING ERRCODE = '55000', DETAIL = 'l14_policy_version_heads:INSERT_WITH_STATE';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.organisation_id IS DISTINCT FROM OLD.organisation_id OR NEW.policy_id IS DISTINCT FROM OLD.policy_id
     OR NEW.version_id IS DISTINCT FROM OLD.version_id OR NEW.content_hash IS DISTINCT FROM OLD.content_hash
     OR (OLD.latest_state_id IS NOT NULL AND NEW.latest_state_id IS NULL) THEN
    RAISE EXCEPTION 'L14_HISTORY_IMMUTABLE' USING ERRCODE = '55000', DETAIL = 'l14_policy_version_heads:IDENTITY';
  END IF;
  IF NEW.latest_state_id IS DISTINCT FROM OLD.latest_state_id AND NOT EXISTS (
       SELECT 1 FROM gov_repo.l14_policy_version_states AS s
       WHERE s.organisation_id = NEW.organisation_id AND s.state_id = NEW.latest_state_id
         AND s.policy_id = NEW.policy_id AND s.version_id = NEW.version_id AND s.content_hash = NEW.content_hash
         AND s.predecessor_state_id IS NOT DISTINCT FROM OLD.latest_state_id) THEN
    RAISE EXCEPTION 'L14_HISTORY_IMMUTABLE' USING ERRCODE = '55000', DETAIL = 'l14_policy_version_heads:LINEAGE';
  END IF;
  RETURN NEW;
END;
$head$;
CREATE TRIGGER l14_policy_version_heads_guard BEFORE INSERT OR UPDATE OR DELETE ON gov_repo.l14_policy_version_heads
  FOR EACH ROW EXECUTE FUNCTION gov_repo.l14_policy_version_head_guard_v1();
CREATE TRIGGER l14_policy_version_heads_no_truncate BEFORE TRUNCATE ON gov_repo.l14_policy_version_heads
  FOR EACH STATEMENT EXECUTE FUNCTION gov_repo.l14_policy_version_head_guard_v1();
ALTER TABLE gov_repo.l14_policy_version_heads ENABLE ALWAYS TRIGGER l14_policy_version_heads_guard;
ALTER TABLE gov_repo.l14_policy_version_heads ENABLE ALWAYS TRIGGER l14_policy_version_heads_no_truncate;

-- ---------------------------------------------------------------------------------------
-- E. Owner-only helpers.
-- ---------------------------------------------------------------------------------------

-- The ORIGINAL durable POLICY_VERSION governance result, exactly as stored (replay never recomputes it).
CREATE FUNCTION gov_repo.l14_policy_version_command_result_v1(p_organisation_id uuid, p_command_id text, p_replay boolean)
RETURNS TABLE (
  replay boolean, command_id text, command_kind text, subject_kind text, outcome text, command_fingerprint text,
  authorization_decision_id uuid, authorization_result text, deny_reason text, proposal_id uuid,
  governance_decision_id uuid, policy_id uuid, version_id uuid, content_hash text, registry_state_id uuid, state_kind text,
  effective_from timestamptz, recorded_at timestamptz
)
LANGUAGE sql
STABLE
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT p_replay, c.command_id, c.command_kind, c.subject_kind, c.outcome, c.command_fingerprint,
         c.authorization_decision_id, a.result, a.deny_reason, c.proposal_id, c.governance_decision_id,
         pp.policy_id, pp.version_id, pp.content_hash::text, c.registry_state_id, s.state_kind, s.effective_from, c.recorded_at
  FROM gov_repo.l14_command_results AS c
  LEFT JOIN gov_repo.l14_authorization_decisions AS a
    ON a.organisation_id = c.organisation_id AND a.authorization_decision_id = c.authorization_decision_id
  LEFT JOIN gov_repo.l14_policy_version_proposals AS pp
    ON pp.organisation_id = c.organisation_id AND pp.proposal_id = c.proposal_id
  LEFT JOIN gov_repo.l14_registry_states AS s
    ON s.organisation_id = c.organisation_id AND s.state_id = c.registry_state_id
  WHERE c.organisation_id = p_organisation_id AND c.command_id = p_command_id AND c.subject_kind = 'POLICY_VERSION'
    AND c.command_kind IN ('SUBMIT_PROPOSAL','DECIDE_PROPOSAL')
$$;

-- Dependency contract. The exact VALIDATED state of the exact governed tuple valid at business instant
-- p_effective_at as known at system cutoff p_recorded_cutoff: recorded_at <= cutoff, effective_from <= instant, and no
-- visible REVOKED tombstone targeting it EXACTLY with effective_from <= instant. No row otherwise (never validated,
-- revoked, not yet effective, recorded after the cutoff, tuple mismatch, legacy-only version); ambiguity fails
-- closed. Never selects another version, the latest version or any legacy version pointer.
CREATE FUNCTION gov_repo.l14_policy_version_valid_state_v1(
  p_organisation_id uuid, p_policy_id uuid, p_version_id uuid, p_content_hash text,
  p_effective_at timestamptz, p_recorded_cutoff timestamptz)
RETURNS TABLE (state_id uuid, effective_from timestamptz, recorded_at timestamptz)
LANGUAGE sql
STABLE
STRICT
SET search_path = pg_catalog, pg_temp
AS $$
  WITH visible AS (
    SELECT s.state_id, s.state_kind, s.revokes_state_id, s.effective_from, s.recorded_at
    FROM gov_repo.l14_registry_states AS s
    JOIN gov_repo.l14_policy_version_states AS d
      ON d.organisation_id = s.organisation_id AND d.state_id = s.state_id AND d.state_kind = s.state_kind
    JOIN gov_repo.l14_policy_version_admissions AS va
      ON va.organisation_id = d.organisation_id AND va.policy_id = d.policy_id AND va.version_id = d.version_id
     AND va.content_hash = d.content_hash
    WHERE s.organisation_id = p_organisation_id AND s.subject_kind = 'POLICY_VERSION'
      AND d.policy_id = p_policy_id AND d.version_id = p_version_id AND d.content_hash::text = p_content_hash
      AND s.recorded_at <= p_recorded_cutoff
  ), candidates AS (
    SELECT v.state_id, v.effective_from, v.recorded_at FROM visible AS v
    WHERE v.state_kind = 'VALIDATED' AND v.effective_from <= p_effective_at
      AND NOT EXISTS (SELECT 1 FROM visible AS r
                      WHERE r.state_kind = 'REVOKED' AND r.revokes_state_id = v.state_id
                        AND r.effective_from <= p_effective_at)
  )
  SELECT c.state_id, c.effective_from, c.recorded_at FROM candidates AS c
  WHERE (SELECT pg_catalog.count(*) FROM candidates) = 1
$$;

-- The governed validation condition of the exact tuple at one instant used as BOTH the business instant and the
-- recorded cutoff: VALIDATED (the resolver's exact state), REVOKED (the lineage's latest effective state is the
-- tombstone), otherwise NOT_VALIDATED. latest_state_id is the lineage tail (the head, reconstructed from history).
-- A not-yet-effective (future-dated) VALIDATED state is never reported as VALIDATED.
CREATE FUNCTION gov_repo.l14_policy_version_validation_condition_v1(
  p_organisation_id uuid, p_policy_id uuid, p_version_id uuid, p_content_hash text, p_at timestamptz)
RETURNS TABLE (validation_state text, validation_state_id uuid, validation_effective_from timestamptz, latest_state_id uuid)
LANGUAGE sql
STABLE
STRICT
SET search_path = pg_catalog, pg_temp
AS $$
  WITH lineage AS (
    SELECT s.state_id, s.state_kind, s.effective_from, s.recorded_at, d.predecessor_state_id
    FROM gov_repo.l14_registry_states AS s
    JOIN gov_repo.l14_policy_version_states AS d
      ON d.organisation_id = s.organisation_id AND d.state_id = s.state_id AND d.state_kind = s.state_kind
    WHERE s.organisation_id = p_organisation_id AND s.subject_kind = 'POLICY_VERSION'
      AND d.policy_id = p_policy_id AND d.version_id = p_version_id AND d.content_hash::text = p_content_hash
      AND s.recorded_at <= p_at
  ), valid AS (
    SELECT r.state_id, r.effective_from
    FROM gov_repo.l14_policy_version_valid_state_v1(p_organisation_id, p_policy_id, p_version_id, p_content_hash, p_at, p_at) AS r
  ), effective_last AS (
    -- Lineage effective instants never decrease (REVOKE >= target, re-validation >= tombstone), so the states
    -- effective at p_at are a lineage prefix; its last element has no successor effective at p_at.
    SELECT l.state_id, l.state_kind, l.effective_from FROM lineage AS l
    WHERE l.effective_from <= p_at
      AND NOT EXISTS (SELECT 1 FROM lineage AS n WHERE n.predecessor_state_id = l.state_id AND n.effective_from <= p_at)
  ), tombstone AS (
    SELECT e.state_id, e.effective_from FROM effective_last AS e
    WHERE e.state_kind = 'REVOKED' AND (SELECT pg_catalog.count(*) FROM effective_last) = 1
  ), tail AS (
    SELECT l.state_id FROM lineage AS l
    WHERE NOT EXISTS (SELECT 1 FROM lineage AS n WHERE n.predecessor_state_id = l.state_id)
  )
  SELECT CASE WHEN v.state_id IS NOT NULL THEN 'VALIDATED' WHEN t.state_id IS NOT NULL THEN 'REVOKED'
              ELSE 'NOT_VALIDATED' END,
         COALESCE(v.state_id, t.state_id),
         CASE WHEN v.state_id IS NOT NULL THEN v.effective_from ELSE t.effective_from END,
         (SELECT tl.state_id FROM tail AS tl WHERE (SELECT pg_catalog.count(*) FROM tail) = 1)
  FROM (SELECT 1) AS one
  LEFT JOIN valid AS v ON true
  LEFT JOIN tombstone AS t ON true
$$;

-- ---------------------------------------------------------------------------------------
-- F1. RPC — POLICY_VERSION proposal submission (any ACTIVE same-tenant member; no authority, no decision, no
--     state, no head mutation, no content change, no trust promotion).
-- ---------------------------------------------------------------------------------------
CREATE FUNCTION gov_repo.l14_submit_policy_version_proposal_v1(
  p_verified_organisation_id uuid,
  p_verified_actor_user_id uuid,
  p_verified_session_iat bigint,
  p_verified_session_exp bigint,
  p_verified_credential_epoch timestamptz,
  p_command_id text,
  p_intent text,
  p_source_class text,                      -- must equal the exact tuple's S1B.3 admission lineage source class
  p_policy_id uuid,
  p_version_id uuid,
  p_content_hash text,
  p_requested_effective_from timestamptz,   -- NULL = IMMEDIATE intent
  p_target_state_id uuid,                   -- REVOKE only: the exact current VALIDATED state of the same tuple
  p_prior_proposal_id uuid,                 -- correction link (same tuple)
  p_support_status text,
  p_support_evidence_ids text[],
  p_caller_fingerprint text                 -- assertion only; PostgreSQL recomputes
)
RETURNS TABLE (
  replay boolean, command_id text, command_kind text, subject_kind text, outcome text, command_fingerprint text,
  authorization_decision_id uuid, authorization_result text, deny_reason text, proposal_id uuid,
  governance_decision_id uuid, policy_id uuid, version_id uuid, content_hash text, registry_state_id uuid, state_kind text,
  effective_from timestamptz, recorded_at timestamptz
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
SET lock_timeout = '5s'
AS $submit_version$
#variable_conflict use_column
DECLARE
  v_org uuid := p_verified_organisation_id;
  v_actor uuid := p_verified_actor_user_id;
  v_support text[];
  v_fingerprint text;
  v_lineage_source text;
  v_target record;
  v_latest uuid;
  v_proposal uuid := pg_catalog.gen_random_uuid();
  v_now timestamptz;
BEGIN
  -- 1. Any verified ACTIVE same-tenant member (no L14 permission is required to submit). Tenant + actor come ONLY
  --    from here.
  PERFORM 1 FROM gov_repo.l14_session_basis_v1(v_org, v_actor, p_verified_session_iat,
    p_verified_session_exp, p_verified_credential_epoch);

  -- 2. Syntactic shape (no table read).
  PERFORM gov_repo.l14_validate_command_id_v1(p_command_id, p_caller_fingerprint);
  IF p_intent IS NULL OR p_intent NOT IN ('VALIDATE','REVOKE')
     OR p_source_class IS NULL OR p_source_class NOT IN ('SYSTEM_SEED','LOCAL_HUMAN','SOURCE_CONNECTION') THEN
    RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'PROPOSAL_VOCABULARY_UNKNOWN';
  END IF;
  IF p_policy_id IS NULL OR p_version_id IS NULL THEN
    RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'POLICY_VERSION_REQUIRED';
  END IF;
  IF p_content_hash IS NULL OR p_content_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'CONTENT_HASH_MALFORMED';
  END IF;
  IF p_intent = 'VALIDATE' AND p_target_state_id IS NOT NULL THEN
    RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'TARGET_STATE_NOT_PERMITTED';
  END IF;
  IF p_intent = 'REVOKE' AND p_target_state_id IS NULL THEN
    RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'TARGET_STATE_REQUIRED';
  END IF;

  -- 3-4. Syntactic support, then the PostgreSQL-authoritative fingerprint over the exact governed tuple.
  v_support := gov_repo.l14_support_syntactic_parts_v1(p_support_status, p_support_evidence_ids);
  v_fingerprint := gov_repo.l14_sha256_frame_v1(
    ARRAY['L14_COMMAND_FINGERPRINT_V1', 'SUBMIT_PROPOSAL', v_org::text, v_actor::text, 'POLICY_VERSION', p_intent,
          p_source_class, p_policy_id::text, p_version_id::text, p_content_hash]
    || CASE WHEN p_requested_effective_from IS NULL THEN ARRAY['IMMEDIATE']
            ELSE ARRAY['EXPLICIT', gov_repo.l14_canonical_instant_v1(p_requested_effective_from)] END
    || CASE WHEN p_target_state_id IS NULL THEN ARRAY['NO_TARGET_STATE']
            ELSE ARRAY['TARGET_STATE', p_target_state_id::text] END
    || CASE WHEN p_prior_proposal_id IS NULL THEN ARRAY['NO_PRIOR_PROPOSAL']
            ELSE ARRAY['PRIOR_PROPOSAL', p_prior_proposal_id::text] END
    || v_support);
  IF v_fingerprint IS DISTINCT FROM p_caller_fingerprint THEN
    RAISE EXCEPTION 'L14_FINGERPRINT_MISMATCH' USING ERRCODE = 'GV008', DETAIL = 'CALLER_FINGERPRINT_DIFFERS';
  END IF;

  -- 5-7. Guards (AP shared, exact-tuple subject, command), then replay arbitration.
  PERFORM gov_repo.l14_lock_authority_policy_guard_shared_v1(v_org);
  PERFORM gov_repo.l14_lock_registry_subject_guard_v1(v_org, 'POLICY_VERSION',
    'POLICY_VERSION_VALIDATION:' || p_policy_id::text || ':' || p_version_id::text || ':' || p_content_hash);
  PERFORM gov_repo.l14_lock_command_guard_v1(v_org, p_command_id);
  IF gov_repo.l14_replay_arbitrate_v1(v_org, p_command_id, v_fingerprint) THEN
    PERFORM 1 FROM gov_repo.l14_session_basis_v1(v_org, v_actor, p_verified_session_iat,
      p_verified_session_exp, p_verified_credential_epoch);
    RETURN QUERY SELECT * FROM gov_repo.l14_policy_version_command_result_v1(v_org, p_command_id, true);
    RETURN;
  END IF;

  -- 8. Tenant/reference/support resolution: the exact S1B.3-admitted tuple of THIS organisation (a legacy-only,
  --    foreign or mismatched tuple is indistinguishable from an unknown one), its lineage source class, the exact
  --    REVOKE target, the correction link.
  SELECT va.source_class INTO v_lineage_source
  FROM gov_repo.l14_policy_version_admissions AS va
  WHERE va.organisation_id = v_org AND va.policy_id = p_policy_id AND va.version_id = p_version_id
    AND va.content_hash = p_content_hash;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'POLICY_VERSION_NOT_ADMITTED';
  END IF;
  IF v_lineage_source IS DISTINCT FROM p_source_class THEN
    RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'SOURCE_CLASS_LINEAGE_MISMATCH';
  END IF;
  IF p_intent = 'REVOKE' THEN
    SELECT s.state_kind, s.policy_id, s.version_id, s.content_hash INTO v_target
    FROM gov_repo.l14_policy_version_states AS s
    WHERE s.organisation_id = v_org AND s.state_id = p_target_state_id;
    IF NOT FOUND OR v_target.policy_id <> p_policy_id OR v_target.version_id <> p_version_id
       OR v_target.content_hash::text <> p_content_hash THEN
      RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'TARGET_STATE_UNRESOLVED';
    END IF;
    IF v_target.state_kind <> 'VALIDATED' THEN
      RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'TARGET_STATE_NOT_VALIDATED';
    END IF;
    PERFORM 1 FROM gov_repo.l14_policy_version_states AS s
    WHERE s.organisation_id = v_org AND s.state_kind = 'REVOKED' AND s.revokes_state_id = p_target_state_id;
    IF FOUND THEN
      RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'TARGET_ALREADY_REVOKED';
    END IF;
    SELECT h.latest_state_id INTO v_latest
    FROM gov_repo.l14_policy_version_heads AS h
    WHERE h.organisation_id = v_org AND h.policy_id = p_policy_id AND h.version_id = p_version_id;
    IF v_latest IS DISTINCT FROM p_target_state_id THEN
      RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'TARGET_STATE_NOT_CURRENT';
    END IF;
  END IF;
  IF p_prior_proposal_id IS NOT NULL THEN
    PERFORM 1 FROM gov_repo.l14_policy_version_proposals AS pp
    WHERE pp.organisation_id = v_org AND pp.proposal_id = p_prior_proposal_id
      AND pp.policy_id = p_policy_id AND pp.version_id = p_version_id AND pp.content_hash = p_content_hash;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'PRIOR_PROPOSAL_UNRESOLVED';
    END IF;
  END IF;
  PERFORM gov_repo.l14_resolve_support_v1(v_org, p_support_evidence_ids);

  -- 9. Envelope + typed detail + support + durable result. Nothing else.
  v_now := pg_catalog.clock_timestamp();
  INSERT INTO gov_repo.l14_proposals (organisation_id, proposal_id, subject_kind, intent, source_class,
    submitted_by_actor_user_id, prior_proposal_id, support_status, submitted_at)
  VALUES (v_org, v_proposal, 'POLICY_VERSION', p_intent, p_source_class, v_actor, p_prior_proposal_id,
    p_support_status, v_now);
  INSERT INTO gov_repo.l14_policy_version_proposals (organisation_id, proposal_id, subject_kind, intent,
    policy_id, version_id, content_hash, requested_effective_from, target_state_id)
  VALUES (v_org, v_proposal, 'POLICY_VERSION', p_intent, p_policy_id, p_version_id, p_content_hash,
    p_requested_effective_from, p_target_state_id);
  INSERT INTO gov_repo.l14_support_links (organisation_id, support_link_id, owner_kind, proposal_id, evidence_id)
  SELECT v_org, pg_catalog.gen_random_uuid(), 'PROPOSAL', v_proposal, i.id
  FROM pg_catalog.unnest(p_support_evidence_ids) AS i(id);
  INSERT INTO gov_repo.l14_command_results (organisation_id, command_id, command_kind, subject_kind,
    command_fingerprint, actor_user_id, outcome, proposal_id, recorded_at)
  VALUES (v_org, p_command_id, 'SUBMIT_PROPOSAL', 'POLICY_VERSION', v_fingerprint, v_actor, 'SUBMITTED',
    v_proposal, v_now);

  PERFORM 1 FROM gov_repo.l14_session_basis_v1(v_org, v_actor, p_verified_session_iat,
    p_verified_session_exp, p_verified_credential_epoch);
  RETURN QUERY SELECT * FROM gov_repo.l14_policy_version_command_result_v1(v_org, p_command_id, false);
END;
$submit_version$;

-- ---------------------------------------------------------------------------------------
-- F2. RPC — governance decision on a POLICY_VERSION proposal. VALIDATE intent: VALIDATE / REJECT / DEFER.
--     REVOKE intent: REVOKE / REJECT / DEFER. DEFER is nonterminal.
-- ---------------------------------------------------------------------------------------
CREATE FUNCTION gov_repo.l14_decide_policy_version_proposal_v1(
  p_verified_organisation_id uuid,
  p_verified_actor_user_id uuid,
  p_verified_session_iat bigint,
  p_verified_session_exp bigint,
  p_verified_credential_epoch timestamptz,
  p_command_id text,
  p_proposal_id uuid,
  p_outcome text,
  p_reason_code text,
  p_expected_current_state_id uuid,         -- NULL = explicit expected-none
  p_support_status text,
  p_support_evidence_ids text[],
  p_caller_fingerprint text                 -- assertion only; PostgreSQL recomputes
)
RETURNS TABLE (
  replay boolean, command_id text, command_kind text, subject_kind text, outcome text, command_fingerprint text,
  authorization_decision_id uuid, authorization_result text, deny_reason text, proposal_id uuid,
  governance_decision_id uuid, policy_id uuid, version_id uuid, content_hash text, registry_state_id uuid, state_kind text,
  effective_from timestamptz, recorded_at timestamptz
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
SET lock_timeout = '5s'
AS $decide_version$
#variable_conflict use_column
DECLARE
  v_org uuid := p_verified_organisation_id;
  v_actor uuid := p_verified_actor_user_id;
  v_role_ids uuid[];
  v_support text[];
  v_fingerprint text;
  v_proposal record;
  v_head_found boolean;
  v_head_latest uuid;
  v_latest_kind text;
  v_latest_from timestamptz;
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
       'POLICY_VERSION_VALIDATED','POLICY_VERSION_REJECTED','POLICY_VERSION_DEFERRED','POLICY_VERSION_REVOKED')
     OR NOT ((p_outcome = 'VALIDATE' AND p_reason_code = 'POLICY_VERSION_VALIDATED')
          OR (p_outcome = 'REJECT' AND p_reason_code = 'POLICY_VERSION_REJECTED')
          OR (p_outcome = 'DEFER' AND p_reason_code = 'POLICY_VERSION_DEFERRED')
          OR (p_outcome = 'REVOKE' AND p_reason_code = 'POLICY_VERSION_REVOKED')) THEN
    RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'DECISION_VOCABULARY_INVALID';
  END IF;
  -- The immutable proposal defines the command identity (fingerprint + subject key); it is the only row read before
  -- replay arbitration, and it can never change or disappear.
  SELECT p.proposal_id, p.intent, p.source_class, p.submitted_by_actor_user_id,
         t.policy_id, t.version_id, t.content_hash::text AS content_hash, t.requested_effective_from, t.target_state_id
  INTO v_proposal
  FROM gov_repo.l14_proposals AS p
  JOIN gov_repo.l14_policy_version_proposals AS t
    ON t.organisation_id = p.organisation_id AND t.proposal_id = p.proposal_id
  WHERE p.organisation_id = v_org AND p.proposal_id = p_proposal_id AND p.subject_kind = 'POLICY_VERSION';
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
          v_proposal.proposal_id::text, 'POLICY_VERSION', v_proposal.intent, v_proposal.source_class,
          v_proposal.policy_id::text, v_proposal.version_id::text, v_proposal.content_hash]
    || CASE WHEN v_proposal.requested_effective_from IS NULL THEN ARRAY['IMMEDIATE']
            ELSE ARRAY['EXPLICIT', gov_repo.l14_canonical_instant_v1(v_proposal.requested_effective_from)] END
    || CASE WHEN v_proposal.target_state_id IS NULL THEN ARRAY['NO_TARGET_STATE']
            ELSE ARRAY['TARGET_STATE', v_proposal.target_state_id::text] END
    || CASE WHEN p_expected_current_state_id IS NULL THEN ARRAY['EXPECTED_NONE']
            ELSE ARRAY['EXPECTED_CURRENT', p_expected_current_state_id::text] END
    || v_support);
  IF v_fingerprint IS DISTINCT FROM p_caller_fingerprint THEN
    RAISE EXCEPTION 'L14_FINGERPRINT_MISMATCH' USING ERRCODE = 'GV008', DETAIL = 'CALLER_FINGERPRINT_DIFFERS';
  END IF;

  -- 5-7. Guards (AP shared, exact-tuple subject, command), then replay arbitration.
  PERFORM gov_repo.l14_lock_authority_policy_guard_shared_v1(v_org);
  PERFORM gov_repo.l14_lock_registry_subject_guard_v1(v_org, 'POLICY_VERSION',
    'POLICY_VERSION_VALIDATION:' || v_proposal.policy_id::text || ':' || v_proposal.version_id::text || ':'
    || v_proposal.content_hash);
  PERFORM gov_repo.l14_lock_command_guard_v1(v_org, p_command_id);
  IF gov_repo.l14_replay_arbitrate_v1(v_org, p_command_id, v_fingerprint) THEN
    PERFORM 1 FROM gov_repo.l14_session_basis_v1(v_org, v_actor, p_verified_session_iat,
      p_verified_session_exp, p_verified_credential_epoch);
    RETURN QUERY SELECT * FROM gov_repo.l14_policy_version_command_result_v1(v_org, p_command_id, true);
    RETURN;
  END IF;

  -- 8. Resolution (all under the subject guard): terminality, head expectation, subject rules.
  PERFORM 1 FROM gov_repo.l14_governance_decisions AS d
  WHERE d.organisation_id = v_org AND d.proposal_id = p_proposal_id AND d.outcome IN ('VALIDATE','REJECT','REVOKE');
  IF FOUND THEN
    RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'PROPOSAL_TERMINAL';
  END IF;
  -- No head row = no governed state yet (the head is created by the first state-appending decision).
  SELECT h.latest_state_id INTO v_head_latest
  FROM gov_repo.l14_policy_version_heads AS h
  WHERE h.organisation_id = v_org AND h.policy_id = v_proposal.policy_id AND h.version_id = v_proposal.version_id;
  v_head_found := FOUND;
  IF p_expected_current_state_id IS NULL AND v_head_latest IS NOT NULL THEN
    RAISE EXCEPTION 'L14_STALE_EXPECTATION' USING ERRCODE = 'GV009', DETAIL = 'POLICY_VERSION_STATE_EXISTS';
  END IF;
  IF p_expected_current_state_id IS DISTINCT FROM v_head_latest THEN
    RAISE EXCEPTION 'L14_STALE_EXPECTATION' USING ERRCODE = 'GV009', DETAIL = 'POLICY_VERSION_STATE_EXPECTATION_MISMATCH';
  END IF;
  IF v_head_latest IS NOT NULL THEN
    SELECT s.state_kind, s.effective_from INTO v_latest_kind, v_latest_from
    FROM gov_repo.l14_registry_states AS s
    WHERE s.organisation_id = v_org AND s.state_id = v_head_latest;
  END IF;
  IF p_outcome = 'VALIDATE' AND v_latest_kind = 'VALIDATED' THEN
    -- Never a second overlapping VALIDATED state: re-validation only after a tombstone.
    RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'POLICY_VERSION_ALREADY_VALIDATED';
  END IF;
  IF p_outcome = 'REVOKE' THEN
    PERFORM 1 FROM gov_repo.l14_policy_version_states AS s
    WHERE s.organisation_id = v_org AND s.state_kind = 'REVOKED' AND s.revokes_state_id = v_proposal.target_state_id;
    IF FOUND THEN
      RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'TARGET_ALREADY_REVOKED';
    END IF;
    IF v_head_latest IS DISTINCT FROM v_proposal.target_state_id OR v_latest_kind IS DISTINCT FROM 'VALIDATED' THEN
      RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'TARGET_STATE_NOT_CURRENT';
    END IF;
    v_target_state_id := v_proposal.target_state_id;
  END IF;
  PERFORM gov_repo.l14_resolve_support_v1(v_org, p_support_evidence_ids);

  -- 9. One DB evaluation instant; temporal class; the CURRENT effective policy is the ONLY basis.
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
  END IF;
  v_self := v_proposal.submitted_by_actor_user_id = v_actor;
  SELECT b.authority_policy_id, b.version_id, b.content_hash INTO v_basis_policy, v_basis_version, v_basis_hash
  FROM gov_repo.l14_effective_authority_basis_v1(v_org, v_now) AS b;
  v_has_basis := FOUND;
  IF NOT v_has_basis THEN
    v_deny := 'NO_EFFECTIVE_AUTHORITY';
  ELSE
    SELECT e.deny_reason, e.rule_ordinals INTO v_deny, v_ordinals
    FROM gov_repo.l14_evaluate_authority_rules_v1(v_org, v_basis_policy, v_basis_version, v_role_ids,
      'L14_POLICY_VERSION_VALIDATE', p_outcome, p_outcome = 'VALIDATE' AND v_self, v_temporal) AS e;
  END IF;

  INSERT INTO gov_repo.l14_authorization_decisions (
    organisation_id, authorization_decision_id, command_id, command_fingerprint, actor_user_id,
    requested_action, subject_kind, scope_tag, source_class, proposal_id, is_self_validation,
    authority_basis, basis_authority_policy_id, basis_version_id, basis_content_hash, result, deny_reason,
    evaluated_at, expectation_kind, expected_current_state_id)
  VALUES (
    v_org, v_authz, p_command_id, v_fingerprint, v_actor,
    p_outcome, 'POLICY_VERSION', 'ALL_ALLOWED_TARGETS', v_proposal.source_class, p_proposal_id, v_self,
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
    INSERT INTO gov_repo.l14_command_results (organisation_id, command_id, command_kind, subject_kind,
      command_fingerprint, actor_user_id, outcome, authorization_decision_id, proposal_id, recorded_at)
    VALUES (v_org, p_command_id, 'DECIDE_PROPOSAL', 'POLICY_VERSION', v_fingerprint, v_actor, 'DENIED', v_authz,
      p_proposal_id, v_now);
  ELSE
    -- 10. S1B.1R1 interval rules (authorized commands only; a violation raises and rolls back).
    IF p_outcome = 'REVOKE' AND v_effective_from < v_latest_from THEN
      RAISE EXCEPTION 'L14_CONTINUITY_VIOLATION' USING ERRCODE = 'GV011', DETAIL = 'REVOKE_BEFORE_TARGET_EFFECTIVE';
    END IF;
    IF p_outcome = 'VALIDATE' AND v_latest_kind = 'REVOKED' AND NOT (v_effective_from >= v_latest_from) THEN
      RAISE EXCEPTION 'L14_CONTINUITY_VIOLATION' USING ERRCODE = 'GV011', DETAIL = 'REVALIDATION_OVERLAPS_PRIOR_INTERVAL';
    END IF;

    INSERT INTO gov_repo.l14_governance_decisions (organisation_id, governance_decision_id, proposal_id,
      subject_kind, outcome, reason_code, authorization_decision_id, actor_user_id, support_status, decided_at)
    VALUES (v_org, v_decision, p_proposal_id, 'POLICY_VERSION', p_outcome, p_reason_code, v_authz, v_actor,
      p_support_status, v_now);
    INSERT INTO gov_repo.l14_support_links (organisation_id, support_link_id, owner_kind, governance_decision_id, evidence_id)
    SELECT v_org, pg_catalog.gen_random_uuid(), 'GOVERNANCE_DECISION', v_decision, i.id
    FROM pg_catalog.unnest(p_support_evidence_ids) AS i(id);

    IF p_outcome IN ('VALIDATE','REVOKE') THEN
      v_state_kind := CASE WHEN p_outcome = 'VALIDATE' THEN 'VALIDATED' ELSE 'REVOKED' END;
      -- Append-only: predecessor = the expected head state; the target state is never modified.
      INSERT INTO gov_repo.l14_registry_states (organisation_id, state_id, subject_kind, state_kind,
        predecessor_state_id, revokes_state_id, effective_from, recorded_at, governance_decision_id,
        authorization_decision_id, authority_policy_id, authority_policy_version_id, authority_policy_content_hash,
        trust_state, source_class, support_status)
      VALUES (v_org, v_state, 'POLICY_VERSION', v_state_kind, v_head_latest, v_target_state_id,
        v_effective_from, v_now, v_decision, v_authz, v_basis_policy, v_basis_version, v_basis_hash,
        'VALIDATED', v_proposal.source_class, p_support_status);
      INSERT INTO gov_repo.l14_policy_version_states (organisation_id, state_id, subject_kind, state_kind,
        policy_id, version_id, content_hash, predecessor_state_id, revokes_state_id)
      VALUES (v_org, v_state, 'POLICY_VERSION', v_state_kind, v_proposal.policy_id, v_proposal.version_id,
        v_proposal.content_hash, v_head_latest, v_target_state_id);
      -- Technical head: created empty on the first state, then compare-and-set on the exact expectation.
      IF NOT v_head_found THEN
        INSERT INTO gov_repo.l14_policy_version_heads (organisation_id, policy_id, version_id, content_hash, latest_state_id)
        VALUES (v_org, v_proposal.policy_id, v_proposal.version_id, v_proposal.content_hash, NULL);
      END IF;
      UPDATE gov_repo.l14_policy_version_heads AS h SET latest_state_id = v_state
      WHERE h.organisation_id = v_org AND h.policy_id = v_proposal.policy_id AND h.version_id = v_proposal.version_id
        AND h.content_hash = v_proposal.content_hash
        AND h.latest_state_id IS NOT DISTINCT FROM p_expected_current_state_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'L14_STALE_EXPECTATION' USING ERRCODE = 'GV009', DETAIL = 'POLICY_VERSION_STATE_EXPECTATION_MISMATCH';
      END IF;
      INSERT INTO gov_repo.l14_support_links (organisation_id, support_link_id, owner_kind, registry_state_id, evidence_id)
      SELECT v_org, pg_catalog.gen_random_uuid(), 'REGISTRY_STATE', v_state, i.id
      FROM pg_catalog.unnest(p_support_evidence_ids) AS i(id);
      INSERT INTO gov_repo.l14_command_results (organisation_id, command_id, command_kind, subject_kind,
        command_fingerprint, actor_user_id, outcome, authorization_decision_id, proposal_id, governance_decision_id,
        registry_state_id, recorded_at)
      VALUES (v_org, p_command_id, 'DECIDE_PROPOSAL', 'POLICY_VERSION', v_fingerprint, v_actor, v_state_kind,
        v_authz, p_proposal_id, v_decision, v_state, v_now);
    ELSE
      -- REJECT / DEFER: governance decision only; no state, no head change.
      INSERT INTO gov_repo.l14_command_results (organisation_id, command_id, command_kind, subject_kind,
        command_fingerprint, actor_user_id, outcome, authorization_decision_id, proposal_id, governance_decision_id,
        recorded_at)
      VALUES (v_org, p_command_id, 'DECIDE_PROPOSAL', 'POLICY_VERSION', v_fingerprint, v_actor,
        CASE WHEN p_outcome = 'REJECT' THEN 'REJECTED' ELSE 'DEFERRED' END, v_authz, p_proposal_id, v_decision, v_now);
    END IF;
  END IF;

  -- 11. Base session eligibility at commitment.
  PERFORM 1 FROM gov_repo.l14_session_basis_v1(v_org, v_actor, p_verified_session_iat,
    p_verified_session_exp, p_verified_credential_epoch);
  RETURN QUERY SELECT * FROM gov_repo.l14_policy_version_command_result_v1(v_org, p_command_id, false);
END;
$decide_version$;

-- ---------------------------------------------------------------------------------------
-- G. The EXISTING controlled descriptor read, REPLACED in place (same identity and arguments; the return shape gains
--    the exact current validation state id / effective instant and the lineage tail, so the change of return type
--    requires DROP + CREATE inside this one transaction; no second descriptor RPC exists). Read-only; M16-admitted
--    policies and versions of the session tenant ONLY; never content bodies, legacy authority fields or pointers.
-- ---------------------------------------------------------------------------------------
DROP FUNCTION gov_repo.l14_read_policy_descriptors_v1(uuid, uuid, bigint, bigint, timestamptz, uuid);
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
  validation_state text, validation_state_id uuid, validation_effective_from timestamptz, latest_validation_state_id uuid
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
SET lock_timeout = '5s'
AS $read_descriptors$
#variable_conflict use_column
DECLARE
  v_at timestamptz;
BEGIN
  -- Base session eligibility is revalidated on every read; the tenant comes ONLY from the verified principal.
  PERFORM 1 FROM gov_repo.l14_session_basis_v1(p_verified_organisation_id, p_verified_actor_user_id,
    p_verified_session_iat, p_verified_session_exp, p_verified_credential_epoch);
  -- One DB instant is both the business instant and the recorded cutoff of the projected condition.
  v_at := pg_catalog.clock_timestamp();
  RETURN QUERY
  SELECT pa.policy_id, gp.policy_code::text, gp.title::text, gp.policy_type::text,
         pa.admission_authorization_decision_id, pa.recorded_at,
         va.version_id, pv.version_number, pv.version_label::text, va.content_hash::text,
         va.admission_authorization_decision_id, va.recorded_at,
         CASE WHEN va.version_id IS NULL THEN 'NOT_VALIDATED' ELSE vc.validation_state END,
         vc.validation_state_id, vc.validation_effective_from, vc.latest_state_id
  FROM gov_repo.l14_policy_admissions AS pa
  JOIN gov_repo.governance_policies AS gp
    ON gp.organisation_id = pa.organisation_id AND gp.policy_id = pa.policy_id
  LEFT JOIN gov_repo.l14_policy_version_admissions AS va
    ON va.organisation_id = pa.organisation_id AND va.policy_id = pa.policy_id
  LEFT JOIN gov_repo.policy_versions AS pv
    ON pv.organisation_id = va.organisation_id AND pv.policy_id = va.policy_id AND pv.version_id = va.version_id
   AND pv.content_hash = va.content_hash
  LEFT JOIN LATERAL gov_repo.l14_policy_version_validation_condition_v1(
      va.organisation_id, va.policy_id, va.version_id, va.content_hash::text, v_at) AS vc ON va.version_id IS NOT NULL
  WHERE pa.organisation_id = p_verified_organisation_id
    AND (p_policy_id IS NULL OR pa.policy_id = p_policy_id)
  ORDER BY gp.policy_code::text COLLATE "C", pa.policy_id, pv.version_number;
END;
$read_descriptors$;

-- ---------------------------------------------------------------------------------------
-- H. Privileges. The hostile 20260818013113 defaults hand every new gov_repo table to service_role: removed. No
--    application role gets any privilege on the new tables. Exactly the two new RPCs + the replaced descriptor read
--    are service_role-executable; every helper/guard stays owner-only.
-- ---------------------------------------------------------------------------------------
ALTER TABLE gov_repo.l14_policy_version_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE gov_repo.l14_policy_version_proposals ENABLE ROW LEVEL SECURITY;
ALTER TABLE gov_repo.l14_policy_version_heads ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE gov_repo.l14_policy_version_states, gov_repo.l14_policy_version_proposals, gov_repo.l14_policy_version_heads
FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION
  gov_repo.l14_policy_version_proposal_guard_v1(),
  gov_repo.l14_policy_version_state_guard_v1(),
  gov_repo.l14_policy_version_head_guard_v1(),
  gov_repo.l14_policy_version_command_result_v1(uuid, text, boolean),
  gov_repo.l14_policy_version_valid_state_v1(uuid, uuid, uuid, text, timestamptz, timestamptz),
  gov_repo.l14_policy_version_validation_condition_v1(uuid, uuid, uuid, text, timestamptz),
  gov_repo.l14_submit_policy_version_proposal_v1(uuid, uuid, bigint, bigint, timestamptz, text, text, text, uuid, uuid, text, timestamptz, uuid, uuid, text, text[], text),
  gov_repo.l14_decide_policy_version_proposal_v1(uuid, uuid, bigint, bigint, timestamptz, text, uuid, text, text, uuid, text, text[], text),
  gov_repo.l14_read_policy_descriptors_v1(uuid, uuid, bigint, bigint, timestamptz, uuid)
FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION
  gov_repo.l14_submit_policy_version_proposal_v1(uuid, uuid, bigint, bigint, timestamptz, text, text, text, uuid, uuid, text, timestamptz, uuid, uuid, text, text[], text),
  gov_repo.l14_decide_policy_version_proposal_v1(uuid, uuid, bigint, bigint, timestamptz, text, uuid, text, text, uuid, text, text[], text),
  gov_repo.l14_read_policy_descriptors_v1(uuid, uuid, bigint, bigint, timestamptz, uuid)
TO service_role;

COMMENT ON TABLE gov_repo.l14_policy_version_states IS 'M16-S1B.4 immutable typed POLICY_VERSION detail of l14_registry_states: the exact S1B.3-admitted tuple (organisation, policy_id, version_id, content_hash) pinned to its admission lineage AND the exact store hash key; linear, same-tuple, alternating VALIDATED/REVOKED lineage (lineage copies and source class verified against the envelope). No content, no legacy authority field. VALIDATED trust exists ONLY here.';
COMMENT ON TABLE gov_repo.l14_policy_version_proposals IS 'M16-S1B.4 immutable typed POLICY_VERSION proposal: the exact admitted tuple, requested_effective_from (NULL = IMMEDIATE), target_state_id (REVOKE only, exact VALIDATED state of the same tuple). The envelope source class must equal the admission lineage source class. No content copy, no rationale.';
COMMENT ON TABLE gov_repo.l14_policy_version_heads IS 'M16-S1B.4 technical compare-and-set pointer only (latest POLICY_VERSION state of the exact tuple); created empty by the first state-appending decision, RPC-maintained, advanced only to the direct lineage successor; reconstructible from history; never authoritative on its own.';
COMMENT ON FUNCTION gov_repo.l14_policy_version_valid_state_v1(uuid, uuid, uuid, text, timestamptz, timestamptz) IS 'M16-S1B.4 owner-only bitemporal POLICY_VERSION dependency resolver: exact VALIDATED state of the exact admitted tuple valid at a business instant as known at a recorded cutoff; no row otherwise; ambiguity fails closed; never another version, the latest version or a legacy pointer.';
COMMENT ON FUNCTION gov_repo.l14_policy_version_validation_condition_v1(uuid, uuid, uuid, text, timestamptz) IS 'M16-S1B.4 owner-only current validation condition (NOT_VALIDATED | VALIDATED | REVOKED) of the exact admitted tuple at one instant used as business instant and recorded cutoff, with the exact state id / effective instant and the lineage tail.';
COMMENT ON FUNCTION gov_repo.l14_policy_version_command_result_v1(uuid, text, boolean) IS 'M16-S1B.4 owner-only durable POLICY_VERSION governance result projection (replay returns the original).';
COMMENT ON FUNCTION gov_repo.l14_read_policy_descriptors_v1(uuid, uuid, bigint, bigint, timestamptz, uuid) IS 'M16-S1B.3 (S1B2-I1) controlled policy descriptor read, replaced in place by M16-S1B.4: base session eligibility revalidated; M16-admitted policies/versions of the verified tenant only; descriptors + content hash + admission lineage ids; validation_state is the CURRENT governed POLICY_VERSION condition (NOT_VALIDATED | VALIDATED | REVOKED) with its exact state id / effective instant and the lineage tail. Never content bodies, legacy status/approval/QES or any legacy version pointer.';

-- ---------------------------------------------------------------------------------------
-- I. Postflight over the EFFECTIVE post-S1B.4 catalog (after ALL grants, including the broad legacy defaults).
--    Self-contained and re-executable. Historical postflights keep their own horizon and are not altered.
-- ---------------------------------------------------------------------------------------
DO $postflight$
DECLARE
  v_states CONSTANT regclass := 'gov_repo.l14_policy_version_states'::regclass;
  v_proposals CONSTANT regclass := 'gov_repo.l14_policy_version_proposals'::regclass;
  v_heads CONSTANT regclass := 'gov_repo.l14_policy_version_heads'::regclass;
  v_new_tables CONSTANT oid[] := ARRAY['gov_repo.l14_policy_version_states'::regclass::oid,
    'gov_repo.l14_policy_version_proposals'::regclass::oid, 'gov_repo.l14_policy_version_heads'::regclass::oid];
  v_stores CONSTANT oid[] := ARRAY['gov_repo.governance_policies'::regclass::oid, 'gov_repo.policy_versions'::regclass::oid];
  v_guarded CONSTANT oid[] := ARRAY['gov_repo.governance_policies'::regclass::oid, 'gov_repo.policy_versions'::regclass::oid,
    'gov_repo.l14_policy_admissions'::regclass::oid, 'gov_repo.l14_policy_version_admissions'::regclass::oid,
    'gov_repo.l14_policy_version_states'::regclass::oid, 'gov_repo.l14_policy_version_proposals'::regclass::oid,
    'gov_repo.l14_policy_version_heads'::regclass::oid];
  v_app CONSTANT text[] := ARRAY['anon','authenticated','service_role'];
  v_expected_l14 CONSTANT text[] := ARRAY[
    'l14_authority_policies','l14_authority_policy_heads','l14_authority_policy_rules',
    'l14_authority_policy_states','l14_authority_policy_version_proposals','l14_authority_policy_versions',
    'l14_authorization_decision_roles','l14_authorization_decision_rules','l14_authorization_decisions',
    'l14_command_results','l14_governance_decisions','l14_governance_parties','l14_governance_party_heads',
    'l14_governance_party_proposals','l14_governance_party_states','l14_policy_admissions',
    'l14_policy_version_admissions','l14_policy_version_heads','l14_policy_version_proposals',
    'l14_policy_version_states','l14_proposals','l14_registry_states','l14_support_links'];
  v_mutable_heads CONSTANT text[] := ARRAY['l14_authority_policy_heads','l14_governance_party_heads','l14_policy_version_heads'];
  v_public_l14 CONSTANT text[] := ARRAY[
    'l14_admit_authority_policy_version_v1','l14_admit_governance_party_v1','l14_admit_governance_policy_v1',
    'l14_admit_policy_version_v1','l14_decide_authority_policy_proposal_v1','l14_decide_governance_party_proposal_v1',
    'l14_decide_policy_version_proposal_v1','l14_read_policy_descriptors_v1','l14_submit_governance_party_proposal_v1',
    'l14_submit_policy_version_proposal_v1','l14_submit_proposal_v1'];
  v_new_rpcs CONSTANT text[] := ARRAY['l14_decide_policy_version_proposal_v1','l14_read_policy_descriptors_v1',
    'l14_submit_policy_version_proposal_v1'];
  v_new_routines CONSTANT text[] := ARRAY[
    'l14_decide_policy_version_proposal_v1','l14_policy_version_command_result_v1','l14_policy_version_head_guard_v1',
    'l14_policy_version_proposal_guard_v1','l14_policy_version_state_guard_v1','l14_policy_version_valid_state_v1',
    'l14_policy_version_validation_condition_v1','l14_read_policy_descriptors_v1','l14_submit_policy_version_proposal_v1'];
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

  -- I1. Exact l14 relation set (tables only; no views/sequences).
  IF (SELECT pg_catalog.array_agg(c.relname::text ORDER BY c.relname::text COLLATE "C")
      FROM pg_catalog.pg_class AS c
      WHERE c.relnamespace = 'gov_repo'::regnamespace AND c.relname LIKE 'l14\_%' ESCAPE '\'
        AND c.relkind IN ('r','p','v','m','S','f')) IS DISTINCT FROM v_expected_l14 THEN
    RAISE EXCEPTION 'M16_S1B4_POSTFLIGHT: unexpected l14 relation set';
  END IF;

  -- I2. Every l14 table + both reused stores: RLS-enabled ordinary table, zero non-owner / column / application
  --     privilege (incl. inherited), no JSON; immutable history; NO RLS policy on the new tables, the stores or the
  --     admission lineage (no permissive path).
  FOR v_rel IN
    SELECT c.oid, c.relname, c.relkind, c.relowner, c.relacl, c.relrowsecurity
    FROM pg_catalog.pg_class AS c
    WHERE c.relnamespace = 'gov_repo'::regnamespace AND (c.relname::text = ANY (v_expected_l14) OR c.oid = ANY (v_stores))
  LOOP
    IF v_rel.relkind <> 'r' OR NOT v_rel.relrowsecurity THEN
      RAISE EXCEPTION 'M16_S1B4_POSTFLIGHT: % must be an RLS-enabled ordinary table', v_rel.relname;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_catalog.aclexplode(COALESCE(v_rel.relacl, pg_catalog.acldefault('r', v_rel.relowner))) AS a
               WHERE a.grantee <> v_rel.relowner) THEN
      RAISE EXCEPTION 'M16_S1B4_POSTFLIGHT: % has a non-owner table grant', v_rel.relname;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_attribute AS att WHERE att.attrelid = v_rel.oid AND att.attacl IS NOT NULL) THEN
      RAISE EXCEPTION 'M16_S1B4_POSTFLIGHT: % has column-level grants', v_rel.relname;
    END IF;
    FOREACH v_role IN ARRAY v_app LOOP
      FOREACH v_privilege IN ARRAY v_privileges LOOP
        IF pg_catalog.has_table_privilege(v_role, v_rel.oid, v_privilege) THEN
          RAISE EXCEPTION 'M16_S1B4_POSTFLIGHT: % holds % on %', v_role, v_privilege, v_rel.relname;
        END IF;
      END LOOP;
      IF pg_catalog.has_any_column_privilege(v_role, v_rel.oid, 'SELECT, INSERT, UPDATE, REFERENCES') THEN
        RAISE EXCEPTION 'M16_S1B4_POSTFLIGHT: % holds a column privilege on %', v_role, v_rel.relname;
      END IF;
    END LOOP;
    IF v_rel.oid = ANY (v_guarded) AND EXISTS (SELECT 1 FROM pg_catalog.pg_policy AS pol WHERE pol.polrelid = v_rel.oid) THEN
      RAISE EXCEPTION 'M16_S1B4_POSTFLIGHT: % carries an RLS policy (no application access path may exist)', v_rel.relname;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_attribute AS att
               WHERE att.attrelid = v_rel.oid AND att.attnum > 0 AND NOT att.attisdropped
                 AND att.atttypid IN ('json'::regtype, 'jsonb'::regtype)) THEN
      RAISE EXCEPTION 'M16_S1B4_POSTFLIGHT: % has a JSON column', v_rel.relname;
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
      RAISE EXCEPTION 'M16_S1B4_POSTFLIGHT: % lacks ALWAYS raising BEFORE UPDATE/DELETE and TRUNCATE triggers', v_rel.relname;
    END IF;
  END LOOP;

  -- I3. New structures: exactly the pinned columns (no JSON, no content, no free text, no legacy authority field);
  --     every text column a closed vocabulary; the structural guards ALWAYS; exact non-cascading FK shape.
  IF (SELECT pg_catalog.array_agg(att.attname::text || ':' || pg_catalog.format_type(att.atttypid, att.atttypmod) ORDER BY att.attnum)
      FROM pg_catalog.pg_attribute AS att WHERE att.attrelid = v_states AND att.attnum > 0 AND NOT att.attisdropped)
     IS DISTINCT FROM ARRAY['organisation_id:uuid','state_id:uuid','subject_kind:text','state_kind:text','policy_id:uuid',
       'version_id:uuid','content_hash:character(64)','predecessor_state_id:uuid','predecessor_state_kind:text',
       'revokes_state_id:uuid','revoked_state_kind:text']
     OR (SELECT pg_catalog.array_agg(att.attname::text || ':' || pg_catalog.format_type(att.atttypid, att.atttypmod) ORDER BY att.attnum)
      FROM pg_catalog.pg_attribute AS att WHERE att.attrelid = v_proposals AND att.attnum > 0 AND NOT att.attisdropped)
     IS DISTINCT FROM ARRAY['organisation_id:uuid','proposal_id:uuid','subject_kind:text','intent:text','policy_id:uuid',
       'version_id:uuid','content_hash:character(64)','requested_effective_from:timestamp with time zone',
       'target_state_id:uuid','target_state_kind:text']
     OR (SELECT pg_catalog.array_agg(att.attname::text || ':' || pg_catalog.format_type(att.atttypid, att.atttypmod) ORDER BY att.attnum)
      FROM pg_catalog.pg_attribute AS att WHERE att.attrelid = v_heads AND att.attnum > 0 AND NOT att.attisdropped)
     IS DISTINCT FROM ARRAY['organisation_id:uuid','policy_id:uuid','version_id:uuid','content_hash:character(64)',
       'latest_state_id:uuid'] THEN
    RAISE EXCEPTION 'M16_S1B4_POSTFLIGHT: S1B.4 structure columns are not exactly the pinned set';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_attribute AS att
             WHERE att.attrelid = ANY (v_new_tables) AND att.attnum > 0 AND NOT att.attisdropped
               AND att.atttypid IN ('text'::regtype, 'bpchar'::regtype, 'varchar'::regtype)
               AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint AS k
                               WHERE k.conrelid = att.attrelid AND k.contype = 'c' AND k.conkey = ARRAY[att.attnum]::int2[])) THEN
    RAISE EXCEPTION 'M16_S1B4_POSTFLIGHT: an S1B.4 text column is not a closed vocabulary / pinned hash';
  END IF;
  IF (SELECT pg_catalog.count(*) FROM pg_catalog.pg_trigger AS t
      WHERE t.tgenabled = 'A' AND NOT t.tgisinternal AND (
        (t.tgrelid = v_states AND t.tgname = 'l14_policy_version_states_guard'
          AND t.tgfoid = 'gov_repo.l14_policy_version_state_guard_v1()'::regprocedure)
        OR (t.tgrelid = v_proposals AND t.tgname = 'l14_policy_version_proposals_guard'
          AND t.tgfoid = 'gov_repo.l14_policy_version_proposal_guard_v1()'::regprocedure)
        OR (t.tgrelid = v_heads AND t.tgname IN ('l14_policy_version_heads_guard','l14_policy_version_heads_no_truncate')
          AND t.tgfoid = 'gov_repo.l14_policy_version_head_guard_v1()'::regprocedure))) <> 4 THEN
    RAISE EXCEPTION 'M16_S1B4_POSTFLIGHT: S1B.4 structural guard missing or not ALWAYS';
  END IF;
  IF (SELECT pg_catalog.array_agg(k.conname::text ORDER BY k.conname::text) FROM pg_catalog.pg_constraint AS k
      WHERE k.contype = 'f' AND k.conrelid = ANY (v_new_tables)
        AND k.confdeltype IN ('a','r') AND k.confupdtype IN ('a','r') AND k.convalidated) IS DISTINCT FROM ARRAY[
       'l14_policy_version_heads_admission_fkey','l14_policy_version_heads_state_fkey','l14_policy_version_heads_version_fkey',
       'l14_policy_version_proposals_admission_fkey','l14_policy_version_proposals_envelope_fkey',
       'l14_policy_version_proposals_target_fkey','l14_policy_version_proposals_version_fkey',
       'l14_policy_version_states_admission_fkey','l14_policy_version_states_envelope_fkey',
       'l14_policy_version_states_predecessor_fkey','l14_policy_version_states_revokes_fkey',
       'l14_policy_version_states_version_fkey']
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_constraint AS k
                WHERE k.contype = 'f' AND (k.conrelid = ANY (v_guarded) OR k.confrelid = ANY (v_guarded))
                  AND k.conrelid <> 'gov_repo.governance_policies'::regclass AND k.confrelid <> 'gov_repo.governance_policies'::regclass
                  AND (k.confdeltype NOT IN ('a','r') OR k.confupdtype NOT IN ('a','r'))) THEN
    RAISE EXCEPTION 'M16_S1B4_POSTFLIGHT: S1B.4 FK set wrong or a cascading FK touches policy_versions / lineage / S1B.4 history';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_indexes AS i
                 WHERE i.schemaname = 'gov_repo' AND i.indexname = 'l14_policy_version_states_root_uidx')
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_indexes AS i
                    WHERE i.schemaname = 'gov_repo' AND i.indexname = 'l14_policy_version_states_successor_uidx') THEN
    RAISE EXCEPTION 'M16_S1B4_POSTFLIGHT: linear state lineage keys missing';
  END IF;

  -- I4. Exact INPUT parameters: the caller can never choose organisation, actor, role, state ids it does not pin,
  --     version number / label, content, rationale or a legacy field.
  FOR v_entry IN
    SELECT m.sig, m.args FROM (VALUES
      ('gov_repo.l14_submit_policy_version_proposal_v1(uuid,uuid,bigint,bigint,timestamp with time zone,text,text,text,uuid,uuid,text,timestamp with time zone,uuid,uuid,text,text[],text)',
       'p_verified_organisation_id,p_verified_actor_user_id,p_verified_session_iat,p_verified_session_exp,p_verified_credential_epoch,p_command_id,p_intent,p_source_class,p_policy_id,p_version_id,p_content_hash,p_requested_effective_from,p_target_state_id,p_prior_proposal_id,p_support_status,p_support_evidence_ids,p_caller_fingerprint'),
      ('gov_repo.l14_decide_policy_version_proposal_v1(uuid,uuid,bigint,bigint,timestamp with time zone,text,uuid,text,text,uuid,text,text[],text)',
       'p_verified_organisation_id,p_verified_actor_user_id,p_verified_session_iat,p_verified_session_exp,p_verified_credential_epoch,p_command_id,p_proposal_id,p_outcome,p_reason_code,p_expected_current_state_id,p_support_status,p_support_evidence_ids,p_caller_fingerprint'),
      ('gov_repo.l14_read_policy_descriptors_v1(uuid,uuid,bigint,bigint,timestamp with time zone,uuid)',
       'p_verified_organisation_id,p_verified_actor_user_id,p_verified_session_iat,p_verified_session_exp,p_verified_credential_epoch,p_policy_id')
    ) AS m(sig, args)
  LOOP
    IF (SELECT pg_catalog.string_agg(a.name, ',' ORDER BY a.ord)
        FROM pg_catalog.pg_proc AS p
        CROSS JOIN LATERAL ROWS FROM (pg_catalog.unnest(p.proargnames), pg_catalog.unnest(p.proargmodes)) WITH ORDINALITY AS a(name, mode, ord)
        WHERE p.oid = pg_catalog.to_regprocedure(v_entry.sig) AND a.mode IN ('i','b','v')) IS DISTINCT FROM v_entry.args THEN
      RAISE EXCEPTION 'M16_S1B4_POSTFLIGHT: % input parameters are not exactly the closed command shape', v_entry.sig;
    END IF;
  END LOOP;

  -- I5. New SQL never touches the legacy version pointer, legacy authority fields, policy store mutation, content
  --     bodies, applicability, mappings or F2; only the descriptor read reads the stores (descriptors, never bodies).
  FOR v_fn IN
    SELECT p.oid, p.proname, p.prosrc FROM pg_catalog.pg_proc AS p
    WHERE p.pronamespace = 'gov_repo'::regnamespace AND p.proname::text = ANY (v_new_routines)
  LOOP
    IF v_fn.prosrc ~ 'current_version_id' THEN
      RAISE EXCEPTION 'M16_S1B4_POSTFLIGHT: % references the legacy current_version_id', v_fn.proname;
    END IF;
    IF v_fn.prosrc ~ '(approved_by|approval_date|reviewed_by|approver_user_id|qes_signature_id|ledger_entry_seq|\mstatus\M|effective_date|expiry_date)' THEN
      RAISE EXCEPTION 'M16_S1B4_POSTFLIGHT: % references legacy status/approval/QES fields', v_fn.proname;
    END IF;
    IF v_fn.prosrc ~ '(content_markdown|canonical_relationships|policy_mandate_mappings|POLICY_APPLICABILITY|change_summary)' THEN
      RAISE EXCEPTION 'M16_S1B4_POSTFLIGHT: % reaches content bodies, applicability, mappings or F2', v_fn.proname;
    END IF;
    IF v_fn.prosrc ~* '(INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+gov_repo\.(governance_policies|policy_versions|l14_policy_admissions|l14_policy_version_admissions)\M' THEN
      RAISE EXCEPTION 'M16_S1B4_POSTFLIGHT: % mutates a policy store or the S1B.3 admission lineage', v_fn.proname;
    END IF;
    IF v_fn.proname <> 'l14_read_policy_descriptors_v1' AND v_fn.prosrc ~ '(governance_policies|gov_repo\.policy_versions)' THEN
      RAISE EXCEPTION 'M16_S1B4_POSTFLIGHT: % reads a policy store', v_fn.proname;
    END IF;
  END LOOP;

  -- I6. Every l14 routine: pinned search_path, no PUBLIC/anon/authenticated EXECUTE; the eleven public RPCs are
  --     SECURITY DEFINER + service_role-only; every other l14 routine is an owner-only SECURITY INVOKER helper.
  FOR v_fn IN
    SELECT p.oid, p.proname, p.proowner, p.proacl, p.prosecdef, p.proconfig
    FROM pg_catalog.pg_proc AS p
    WHERE p.pronamespace = 'gov_repo'::regnamespace AND p.proname LIKE 'l14\_%' ESCAPE '\'
  LOOP
    IF EXISTS (SELECT 1 FROM pg_catalog.aclexplode(COALESCE(v_fn.proacl, pg_catalog.acldefault('f', v_fn.proowner))) AS a
               WHERE a.privilege_type = 'EXECUTE' AND a.grantee = 0) THEN
      RAISE EXCEPTION 'M16_S1B4_POSTFLIGHT: % has PUBLIC EXECUTE', v_fn.proname;
    END IF;
    FOREACH v_role IN ARRAY ARRAY['anon','authenticated'] LOOP
      IF pg_catalog.has_function_privilege(v_role, v_fn.oid, 'EXECUTE') THEN
        RAISE EXCEPTION 'M16_S1B4_POSTFLIGHT: % executable by %', v_fn.proname, v_role;
      END IF;
    END LOOP;
    IF NOT COALESCE(v_fn.proconfig @> ARRAY['search_path=pg_catalog, pg_temp'], false) THEN
      RAISE EXCEPTION 'M16_S1B4_POSTFLIGHT: % search_path not pinned to pg_catalog, pg_temp', v_fn.proname;
    END IF;
    IF v_fn.proname::text = ANY (v_public_l14) THEN
      IF NOT v_fn.prosecdef OR NOT pg_catalog.has_function_privilege('service_role', v_fn.oid, 'EXECUTE')
         OR EXISTS (SELECT 1 FROM pg_catalog.aclexplode(v_fn.proacl) AS a
                    WHERE a.grantee NOT IN (v_fn.proowner, 'service_role'::regrole::oid)) THEN
        RAISE EXCEPTION 'M16_S1B4_POSTFLIGHT: public RPC % ACL/definer shape wrong', v_fn.proname;
      END IF;
    ELSIF v_fn.prosecdef OR EXISTS (SELECT 1 FROM pg_catalog.aclexplode(COALESCE(v_fn.proacl,
            pg_catalog.acldefault('f', v_fn.proowner))) AS a WHERE a.grantee <> v_fn.proowner) THEN
      RAISE EXCEPTION 'M16_S1B4_POSTFLIGHT: internal helper % must be owner-only SECURITY INVOKER', v_fn.proname;
    END IF;
  END LOOP;
  IF (SELECT pg_catalog.array_agg(p.proname::text ORDER BY p.proname::text COLLATE "C") FROM pg_catalog.pg_proc AS p
      WHERE p.pronamespace = 'gov_repo'::regnamespace AND p.proname LIKE 'l14\_%' ESCAPE '\'
        AND pg_catalog.has_function_privilege('service_role', p.oid, 'EXECUTE')) IS DISTINCT FROM v_public_l14
     OR (SELECT pg_catalog.count(*) FROM pg_catalog.pg_proc AS p
         WHERE p.pronamespace = 'gov_repo'::regnamespace AND p.proname LIKE 'l14\_%' ESCAPE '\' AND p.prosecdef) <> 11
     OR (SELECT pg_catalog.count(*) FROM pg_catalog.pg_proc AS p
         WHERE p.pronamespace = 'gov_repo'::regnamespace AND p.proname::text = ANY (v_new_routines)) <> 9 THEN
    RAISE EXCEPTION 'M16_S1B4_POSTFLIGHT: the public L14 RPC surface must be exactly the nine S1B.3 + two S1B.4 RPCs (no overloads)';
  END IF;

  -- I7. Closed application SECURITY DEFINER surface on the post-S1B.4 catalog: exactly 27 approved identities (exact
  --     owner class, body hash, config, service_role-only EXECUTE, no overload); exactly 17 policy-store-capable.
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
      RAISE EXCEPTION 'M16_S1B4_POSTFLIGHT: approved routine % missing', v_entry.sig;
    END IF;
    SELECT p.proname, p.pronamespace, p.prosecdef, p.proowner, p.prosrc, p.proconfig, p.proacl INTO v_proc
    FROM pg_catalog.pg_proc AS p WHERE p.oid = v_oid;
    IF NOT v_proc.prosecdef THEN
      RAISE EXCEPTION 'M16_S1B4_POSTFLIGHT: % is not SECURITY DEFINER', v_oid::regprocedure;
    END IF;
    IF pg_catalog.pg_get_userbyid(v_proc.proowner) <> v_entry.owner_role THEN
      RAISE EXCEPTION 'M16_S1B4_POSTFLIGHT: % owner % is not %', v_oid::regprocedure, pg_catalog.pg_get_userbyid(v_proc.proowner), v_entry.owner_role;
    END IF;
    IF pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(v_proc.prosrc, 'UTF8')), 'hex') <> v_entry.sha THEN
      RAISE EXCEPTION 'M16_S1B4_POSTFLIGHT: % body hash changed', v_oid::regprocedure;
    END IF;
    IF COALESCE(pg_catalog.array_to_string(v_proc.proconfig, ';'), '-') <>
       pg_catalog.replace(pg_catalog.replace(v_entry.cfg, '{crypto}', pg_catalog.quote_ident(v_crypto)), '{vschema}', pg_catalog.quote_ident(v_vector)) THEN
      RAISE EXCEPTION 'M16_S1B4_POSTFLIGHT: % config changed: %', v_oid::regprocedure, v_proc.proconfig;
    END IF;
    IF NOT pg_catalog.has_function_privilege('service_role', v_oid, 'EXECUTE')
       OR pg_catalog.has_function_privilege('anon', v_oid, 'EXECUTE')
       OR pg_catalog.has_function_privilege('authenticated', v_oid, 'EXECUTE')
       OR EXISTS (SELECT 1 FROM pg_catalog.aclexplode(COALESCE(v_proc.proacl, pg_catalog.acldefault('f', v_proc.proowner))) AS a
                  WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE') THEN
      RAISE EXCEPTION 'M16_S1B4_POSTFLIGHT: % application EXECUTE is not exactly service_role', v_oid::regprocedure;
    END IF;
    IF v_proc.proname::text = ANY (v_new_rpcs)
       AND EXISTS (SELECT 1 FROM pg_catalog.aclexplode(v_proc.proacl) AS a
                   WHERE a.grantee NOT IN (v_proc.proowner, 'service_role'::regrole::oid) OR (a.grantee = 'service_role'::regrole::oid AND a.privilege_type <> 'EXECUTE')) THEN
      RAISE EXCEPTION 'M16_S1B4_POSTFLIGHT: % EXECUTE ACL is not exactly owner + service_role', v_oid::regprocedure;
    END IF;
    IF (SELECT pg_catalog.count(*) FROM pg_catalog.pg_proc AS p WHERE p.pronamespace = v_proc.pronamespace AND p.proname = v_proc.proname) <> 1 THEN
      RAISE EXCEPTION 'M16_S1B4_POSTFLIGHT: overload of approved routine %', v_oid::regprocedure;
    END IF;
    v_approved := v_approved || v_oid;
    IF v_entry.owner_role = 'postgres' THEN
      IF v_proc.proowner <> ALL (v_capable) THEN
        RAISE EXCEPTION 'M16_S1B4_POSTFLIGHT: canonical L14/S0 owner of % unexpectedly lost policy-store capability', v_oid::regprocedure;
      END IF;
      v_frozen := v_frozen || v_oid;
    ELSIF v_proc.proowner = ANY (v_capable) THEN
      RAISE EXCEPTION 'M16_S1B4_POSTFLIGHT: owner of % has policy-store capability', v_oid::regprocedure;
    END IF;
  END LOOP;
  IF pg_catalog.cardinality(v_approved) <> 27 OR pg_catalog.cardinality(v_frozen) <> 17 THEN
    RAISE EXCEPTION 'M16_S1B4_POSTFLIGHT: approved surface is not exactly 27 (17 policy-store-capable)';
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
      RAISE EXCEPTION 'M16_S1B4_POSTFLIGHT: CLOSED_SURFACE unapproved application-executable SECURITY DEFINER %', v_row.oid::regprocedure;
    END IF;
    IF v_row.proowner = ANY (v_capable) AND v_row.oid <> ALL (v_frozen) THEN
      RAISE EXCEPTION 'M16_S1B4_POSTFLIGHT: POLICY_STORE_OWNER application definer % outside the approved 17', v_row.oid::regprocedure;
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
                          WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE'))) <> 27 THEN
    RAISE EXCEPTION 'M16_S1B4_POSTFLIGHT: application SECURITY DEFINER surface is not exactly 27';
  END IF;
  -- Every application definer that can reach a policy store is one of the 17 approved policy-store-capable RPCs.
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
      RAISE EXCEPTION 'M16_S1B4_POSTFLIGHT: application definer % reaches a policy store outside the approved 17', v_fn.oid::regprocedure;
    END IF;
  END LOOP;

  -- I8. Default privileges: postgres-created routines (global + gov_repo) grant EXECUTE to neither PUBLIC nor an
  --     application role. (Table/sequence defaults are the legacy 20260818013113 service_role grants; every S1B.4
  --     table carries an explicit REVOKE and its EFFECTIVE ACL is proven closed above.)
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_default_acl AS d
                 WHERE d.defaclrole = 'postgres'::regrole AND d.defaclnamespace = 0 AND d.defaclobjtype = 'f')
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_default_acl AS d CROSS JOIN LATERAL pg_catalog.aclexplode(d.defaclacl) AS a
                WHERE d.defaclrole = 'postgres'::regrole AND d.defaclobjtype = 'f' AND a.privilege_type = 'EXECUTE'
                  AND d.defaclnamespace IN (0, 'gov_repo'::regnamespace)
                  AND (a.grantee = 0 OR a.grantee IN (SELECT r.oid FROM pg_catalog.pg_roles AS r WHERE r.rolname = ANY (v_app)))) THEN
    RAISE EXCEPTION 'M16_S1B4_POSTFLIGHT: postgres routine default privileges grant PUBLIC / application EXECUTE';
  END IF;

  -- I9. No inheritance, no readable/writable view leak and no sequence leak into the stores, the admission lineage or
  --     the S1B.4 history (any schema, transitive).
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_inherits AS i WHERE i.inhrelid = ANY (v_guarded) OR i.inhparent = ANY (v_guarded)) THEN
    RAISE EXCEPTION 'M16_S1B4_POSTFLIGHT: inheritance involves a policy store, the admission lineage or S1B.4 history';
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
      RAISE EXCEPTION 'M16_S1B4_POSTFLIGHT: view % reaching guarded history has a PUBLIC grant', v_rel.relname;
    END IF;
    FOREACH v_role IN ARRAY v_app LOOP
      FOREACH v_privilege IN ARRAY v_privileges LOOP
        IF pg_catalog.has_table_privilege(v_role, v_rel.oid, v_privilege) THEN
          RAISE EXCEPTION 'M16_S1B4_POSTFLIGHT: % holds % on view % reaching guarded history', v_role, v_privilege, v_rel.relname;
        END IF;
      END LOOP;
      IF pg_catalog.has_any_column_privilege(v_role, v_rel.oid, 'SELECT, INSERT, UPDATE, REFERENCES') THEN
        RAISE EXCEPTION 'M16_S1B4_POSTFLIGHT: % holds a column privilege on view % reaching guarded history', v_role, v_rel.relname;
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
        RAISE EXCEPTION 'M16_S1B4_POSTFLIGHT: % holds a privilege on sequence %', v_role, v_rel.relname;
      END IF;
    END LOOP;
  END LOOP;

  -- I10. Frozen enumerations: exactly 11 canonical object kinds and 12 governed relationship types; no POLICY kind and
  --      no APPLIES_POLICY relationship.
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
    RAISE EXCEPTION 'M16_S1B4_POSTFLIGHT: canonical object kinds (11) / governed relationship types (12) changed';
  END IF;

  -- I11. F2: nothing on the L14 / policy surface references canonical_relationships; no S1B.4 routine is a trigger on it.
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_constraint AS k
             WHERE k.confrelid = 'gov_repo.canonical_relationships'::regclass
               AND (k.conrelid = ANY (v_stores)
                    OR k.conrelid IN (SELECT c.oid FROM pg_catalog.pg_class AS c
                                      WHERE c.relnamespace = 'gov_repo'::regnamespace AND c.relname LIKE 'l14\_%' ESCAPE '\')))
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_trigger AS t JOIN pg_catalog.pg_proc AS p ON p.oid = t.tgfoid
                WHERE t.tgrelid = 'gov_repo.canonical_relationships'::regclass AND p.proname::text = ANY (v_new_routines)) THEN
    RAISE EXCEPTION 'M16_S1B4_POSTFLIGHT: F2 boundary violated';
  END IF;

  -- I12. S0 wrapper/eligibility naming contracts stay intact.
  IF (SELECT pg_catalog.count(*) FROM pg_catalog.pg_proc AS p WHERE p.pronamespace = 'gov_repo'::regnamespace
        AND p.proname IN ('apply_review_transition_governed_v1','record_authorized_reconciliation_governed_v1',
                          'materialize_object_reconciliation_governed_v1','materialize_relationship_reconciliation_governed_v1',
                          'record_technical_field_decision_governed_v1','record_execution_field_decision_governed_v1')) <> 6
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_proc AS p WHERE p.pronamespace = 'gov_repo'::regnamespace
        AND p.proname LIKE 'l14\_%' ESCAPE '\' AND (p.proname LIKE '%eligibility%' OR p.proname LIKE '%governed%')) THEN
    RAISE EXCEPTION 'M16_S1B4_POSTFLIGHT: S0 naming contract disturbed';
  END IF;
END;
$postflight$;

COMMIT;
