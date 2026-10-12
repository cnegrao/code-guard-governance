-- M16-S1C.5: CONTROL_ASSESSMENT — the fifth and final authoritative M16 fact family (DB only, ADDITIVE on S1B.0..S1C.4).
-- Architecture: docs/architecture/ADR-GOVIA-OWNERSHIP-BUSINESS-POLICY-CONTROL-ENRICHMENT-v1.md
-- §§2-4, 6-9, 15-18, 20, 22-23 (O20-O31, O38, O40, O49, O55) plus the frozen S1B decisions (D-1..D-14).
-- No historical migration is edited. Never run against a hosted DB from this slice.
--
-- Meaning: a governed assessment of ONE exact VALIDATED CONTROL_APPLICABILITY state whose outcome is APPLIES. The closed
-- stored outcomes are exactly SATISFIED | PARTIALLY_SATISFIED | NOT_SATISFIED | NOT_ASSESSED | INSUFFICIENT_EVIDENCE
-- (WAIVED is unsupported in M16 V1 and refused; no score / coverage / maturity / residual computation exists). An explicit
-- NOT_ASSESSED is a positive governed row; absence of a current valid assessment is UNKNOWN (never stored).
--   * Target identity = the exact S1C.4 control_applicability_state_id (never a target / control pair, a successor, the
--     current / latest applicability, another version or any heuristic). Every row additionally mirrors the exact immutable
--     S1C.4 tuple of that state (target key, control definition id + version id + DB content hash, pinned VALIDATED
--     CONTROL_DEFINITION state, APPLIES, VALIDATED) and carries a composite FK onto the S1C.4 published pin key
--     l14_control_applicability_states_kind_unique: a DOES_NOT_APPLY, REVOKED, foreign or swapped tuple has no such row.
--     The tuple is resolved by PostgreSQL from the immutable state, never supplied by the caller.
--   * Logical fact key = organisation + control_applicability_state_id. Renewals and corrections (another outcome, another
--     valid_until) are append-only lineage SUCCESSORS of the same key; the predecessor's closure is DERIVED from the
--     visible successor, never written onto it. One head per key; at most one current assessment per applicability state.
--   * valid_until is MANDATORY on every VALIDATED assessment, strictly later than effective_from, and IS the envelope
--     effective_to (never a second independent end date): validity is [effective_from, valid_until). Expiry needs no row
--     update; a head alone never overrides expiry.
--   * No carry-over: an assessment never transfers to a successor applicability state (even with the same target, control
--     and content). A superseded / revoked / dependency-invalid applicability makes its assessments historical; the new
--     applicability starts without a current assessment. Reads jointly re-check the assessment, the exact applicability
--     state (S1C.4 resolver, which itself re-checks the target and the CONTROL_DEFINITION dependency) at the SAME coordinates.
--   * CONTROL_FINDING is NOT a fact family: no envelope subject, no head, no table, no routine (ADR §3 / O38 / O40).
--   * It is an L14 fact, NOT a canonical relationship / object, a waiver / exception, a score, a coverage aggregate, a risk
--     decision, a cg_* flag, scanner / LLM inference or text similarity. F2 untouched: canonical_relationships is only READ
--     by the existing S1C.3 exact-triple helper (no DDL / DML / FK / uniqueness / trigger).
--
-- This migration, over the EXISTING S1B.0 framework and the EXISTING S1C.1 fact envelope (no parallel fact framework):
--   A. Preflight: the exact post-S1C.4 catalog, or it aborts with nothing applied.
--   B. Closed framework widening: governance-decision subject / reason codes; CONTROL_ASSESSMENT authorizations are exact
--      CANONICAL_OBJECT or RELATIONSHIP_STATE requests (the target of the pinned applicability state); the command-result
--      fact branch and the l14_fact_states subject vocabulary gain exactly CONTROL_ASSESSMENT (exactly five families); the
--      fact guard accepts exactly the five families. Every historical row and shape is kept verbatim. No S1C.4 structure
--      or routine is altered.
--   C. Typed immutable proposal + state detail; RPC-maintained CAS head per applicability state.
--   D. Structural guards (raising, ENABLE ALWAYS): LOCAL_HUMAN-only source, pinned applicability is APPLIES, state mirrors
--      envelope + deciding proposal + authorization target (the pinned applicability's target, incl. the DB-resolved
--      relationship type), mandatory valid_until = effective_to, per-key interval lineage, exact applicability valid at the
--      state's own coordinates, head lineage.
--   E. Owner-only helpers: SHARED CONTROL_APPLICABILITY dependency guard (the exact S1C.4 fact KEY guard key, shared mode),
--      durable result projection, exact bitemporal resolver and the bounded current-assessment read of one exact target.
--   F. Two NEW SECURITY DEFINER RPCs (service_role only), replay-first: SUBMIT (any verified ACTIVE member; proposal only)
--      and DECIDE (L14_CONTROL_ASSESSMENT_VALIDATE, requested action = the exact governance outcome, scope = the pinned
--      applicability target).
--   G. Privileges, comments and a postflight over the EFFECTIVE post-S1C.5 catalog:
--      application SECURITY DEFINER surface 41 -> 43; canonical-owner (policy-store-capable) class 31 -> 33.
-- Lock order of DECIDE VALIDATE (deadlock-free against every existing M16 path): Authority Policy guard SHARED -> exact
-- CONTROL_DEFINITION registry subject guard SHARED (S1B.6 key, as S1C.4) -> exact CONTROL_APPLICABILITY fact KEY guard
-- SHARED (the S1C.4 SUBMIT / DECIDE take it EXCLUSIVELY: AP -> [CD shared] -> applicability KEY -> command) -> exact
-- CONTROL_ASSESSMENT fact KEY guard EXCLUSIVE -> command guard. Held to commit. REVOKE / REJECT / DEFER take no dependency
-- guard and never check dependency validity (an assessment whose applicability later became invalid can always be ended).
BEGIN;

-- ---------------------------------------------------------------------------------------
-- A. Preflight: the exact post-S1C.4 catalog, or abort with nothing applied.
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
    RAISE EXCEPTION 'M16_S1C5_PREFLIGHT: PostgreSQL 17 required' USING ERRCODE = '55000';
  END IF;
  IF v_crypto IS NULL OR v_vector IS NULL THEN
    RAISE EXCEPTION 'M16_S1C5_PREFLIGHT: pgcrypto / vector unresolved' USING ERRCODE = '55000';
  END IF;
  -- Exact S1C.4 l14 relation set (tables only).
  IF (SELECT pg_catalog.array_agg(c.relname::text ORDER BY c.relname::text COLLATE "C")
      FROM pg_catalog.pg_class AS c
      WHERE c.relnamespace = 'gov_repo'::regnamespace AND c.relname LIKE 'l14\_%' ESCAPE '\'
        AND c.relkind IN ('r','p','v','m','S','f')) IS DISTINCT FROM ARRAY[
    'l14_authority_policies','l14_authority_policy_heads','l14_authority_policy_rules',
    'l14_authority_policy_states','l14_authority_policy_version_proposals','l14_authority_policy_versions',
    'l14_authorization_decision_roles','l14_authorization_decision_rules','l14_authorization_decisions',
    'l14_business_context_assignment_heads','l14_business_context_assignment_proposals',
    'l14_business_context_assignment_states','l14_command_results','l14_control_applicability_heads',
    'l14_control_applicability_proposals','l14_control_applicability_states','l14_control_definition_heads',
    'l14_control_definition_proposals','l14_control_definition_states','l14_control_definition_versions',
    'l14_control_definitions','l14_domain_admissions','l14_domain_heads','l14_domain_proposals','l14_domain_states',
    'l14_fact_states','l14_governance_decisions','l14_governance_parties','l14_governance_party_heads',
    'l14_governance_party_proposals','l14_governance_party_states','l14_policy_admissions',
    'l14_policy_applicability_heads','l14_policy_applicability_proposals','l14_policy_applicability_states',
    'l14_policy_version_admissions','l14_policy_version_heads','l14_policy_version_proposals',
    'l14_policy_version_states','l14_proposals','l14_registry_states','l14_responsibility_assignment_heads',
    'l14_responsibility_assignment_proposals','l14_responsibility_assignment_states','l14_support_links'] THEN
    RAISE EXCEPTION 'M16_S1C5_PREFLIGHT: unexpected l14 relation set (S1C.4 horizon expected)' USING ERRCODE = '55000';
  END IF;
  -- The fact framework / CONTROL_APPLICABILITY keys this slice reuses or widens, in their exact post-S1C.4 form.
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint AS k WHERE k.conrelid = 'gov_repo.l14_fact_states'::regclass
                   AND k.conname = 'l14_fact_states_subject_kind_check'
                   AND pg_catalog.pg_get_constraintdef(k.oid) = 'CHECK ((subject_kind = ANY (ARRAY[''RESPONSIBILITY_ASSIGNMENT''::text, ''BUSINESS_CONTEXT_ASSIGNMENT''::text, ''POLICY_APPLICABILITY''::text, ''CONTROL_APPLICABILITY''::text])))')
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint AS k WHERE k.conrelid = 'gov_repo.l14_fact_states'::regclass
                      AND k.conname = 'l14_fact_states_kind_unique' AND k.contype = 'u')
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint AS k WHERE k.conrelid = 'gov_repo.l14_fact_states'::regclass
                      AND k.conname = 'l14_fact_states_interval_check'
                      AND pg_catalog.pg_get_constraintdef(k.oid) = 'CHECK (((effective_to IS NULL) OR ((state_kind = ''VALIDATED''::text) AND (effective_to > effective_from))))')
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint AS k WHERE k.conrelid = 'gov_repo.l14_governance_decisions'::regclass
                      AND k.conname = 'l14_governance_decisions_subject_kind_check'
                      AND pg_catalog.pg_get_constraintdef(k.oid) LIKE '%CONTROL_APPLICABILITY%'
                      AND pg_catalog.pg_get_constraintdef(k.oid) NOT LIKE '%CONTROL_ASSESSMENT%')
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint AS k WHERE k.conrelid = 'gov_repo.l14_command_results'::regclass
                      AND k.conname = 'l14_command_results_shape_check'
                      AND pg_catalog.pg_get_constraintdef(k.oid) LIKE '%CONTROL_APPLICABILITY%'
                      AND pg_catalog.pg_get_constraintdef(k.oid) NOT LIKE '%CONTROL_ASSESSMENT%')
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint AS k WHERE k.conrelid = 'gov_repo.l14_authorization_decisions'::regclass
                      AND k.conname = 'l14_authorization_decisions_request_target_check' AND k.contype = 'c'
                      AND pg_catalog.pg_get_constraintdef(k.oid) LIKE '%RELATIONSHIP_STATE%')
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint AS k WHERE k.conrelid = 'gov_repo.l14_authorization_decisions'::regclass
                      AND k.conname = 'l14_authorization_decisions_control_applicability_target_check' AND k.contype = 'c')
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_constraint AS k WHERE k.conrelid = 'gov_repo.l14_authorization_decisions'::regclass
                  AND k.conname = 'l14_authorization_decisions_control_assessment_target_check')
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint AS k WHERE k.conrelid = 'gov_repo.l14_control_applicability_states'::regclass
                      AND k.conname = 'l14_control_applicability_states_kind_unique' AND k.contype = 'u'
                      AND pg_catalog.pg_get_constraintdef(k.oid) = 'UNIQUE (organisation_id, fact_state_id, target_key, control_definition_id, control_definition_version_id, content_hash, control_definition_validated_state_id, applicability, state_kind)')
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint AS k WHERE k.conrelid = 'gov_repo.l14_control_applicability_states'::regclass
                      AND k.conname = 'l14_control_applicability_states_pkey' AND k.contype = 'p')
     OR pg_catalog.to_regprocedure('gov_repo.l14_control_applicability_valid_state_v1(uuid,text,text,text,text,text,uuid,timestamp with time zone,timestamp with time zone)') IS NULL
     OR pg_catalog.to_regprocedure('gov_repo.l14_control_applicabilities_current_v1(uuid,text,text,text,text,text,timestamp with time zone,timestamp with time zone)') IS NULL
     OR pg_catalog.to_regprocedure('gov_repo.l14_control_applicability_target_key_v1(text,text,text,text,text)') IS NULL
     OR pg_catalog.to_regprocedure('gov_repo.l14_lock_control_definition_dependency_guard_shared_v1(uuid,uuid,uuid,text)') IS NULL
     OR pg_catalog.to_regprocedure('gov_repo.l14_evaluate_target_authority_rules_v1(uuid,uuid,uuid,uuid[],text,text,boolean,text,text,text)') IS NULL
     OR pg_catalog.to_regprocedure('gov_repo.l14_evaluate_relationship_state_authority_rules_v1(uuid,uuid,uuid,uuid[],text,text,boolean,text,text,text,text)') IS NULL
     OR pg_catalog.to_regprocedure('gov_repo.l14_resolve_relationship_state_target_v1(uuid,text,text)') IS NULL
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc AS p
                    WHERE p.oid = pg_catalog.to_regprocedure('gov_repo.l14_lock_fact_subject_guard_v1(uuid,text,text[])')
                      AND p.prosrc LIKE '%p_subject_kind NOT IN (''RESPONSIBILITY_ASSIGNMENT'',''BUSINESS_CONTEXT_ASSIGNMENT'',''POLICY_APPLICABILITY'',''CONTROL_APPLICABILITY'')%'
                      AND p.prosrc LIKE '%gov_repo.frame_identity(ARRAY[p_organisation_id::text, ''l14-fact-subject-guard-v1'', p_subject_kind] || p_key_parts)%'
                      AND p.prosrc LIKE '%pg_advisory_xact_lock(%')
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc AS p
                    WHERE p.oid = pg_catalog.to_regprocedure('gov_repo.l14_decide_control_applicability_proposal_v1(uuid,uuid,bigint,bigint,timestamp with time zone,text,uuid,text,text,uuid,text,text[],text)')
                      AND p.prosrc LIKE '%l14_lock_fact_subject_guard_v1(v_org, ''CONTROL_APPLICABILITY'',
    ARRAY[''KEY'', v_proposal.target_key, v_proposal.control_definition_id::text])%') THEN
    RAISE EXCEPTION 'M16_S1C5_PREFLIGHT: S1C.4 fact framework / CONTROL_APPLICABILITY keys missing or already widened' USING ERRCODE = '55000';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_proc AS p WHERE p.pronamespace = 'gov_repo'::regnamespace
             AND (p.proname LIKE 'l14\_%control\_assessment%' ESCAPE '\'
                  OR p.proname = 'l14_lock_control_applicability_dependency_guard_shared_v1'))
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_class AS c WHERE c.relnamespace = 'gov_repo'::regnamespace
                AND (c.relname LIKE 'l14\_control\_assessment%' ESCAPE '\' OR c.relname LIKE 'l14\_%finding%' ESCAPE '\')) THEN
    RAISE EXCEPTION 'M16_S1C5_PREFLIGHT: an S1C.5 object already exists' USING ERRCODE = '55000';
  END IF;
  -- The exact 41 approved application definers of the post-S1C.4 catalog (owner class, body, config).
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
      RAISE EXCEPTION 'M16_S1C5_PREFLIGHT: approved routine % missing', v_entry.sig USING ERRCODE = '55000';
    END IF;
    SELECT p.prosecdef, p.proowner, p.prosrc, p.proconfig INTO v_proc FROM pg_catalog.pg_proc AS p WHERE p.oid = v_oid;
    IF NOT v_proc.prosecdef OR pg_catalog.pg_get_userbyid(v_proc.proowner) <> v_entry.owner_role
       OR pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(v_proc.prosrc, 'UTF8')), 'hex') <> v_entry.sha
       OR COALESCE(pg_catalog.array_to_string(v_proc.proconfig, ';'), '-') <>
          pg_catalog.replace(pg_catalog.replace(v_entry.cfg, '{crypto}', pg_catalog.quote_ident(v_crypto)), '{vschema}', pg_catalog.quote_ident(v_vector)) THEN
      RAISE EXCEPTION 'M16_S1C5_PREFLIGHT: approved routine % differs from its post-S1C.4 owner/body/config', v_oid::regprocedure
        USING ERRCODE = '55000';
    END IF;
  END LOOP;
  -- The closed application surface is exactly those 41 (extension members excluded, any schema).
  IF (SELECT pg_catalog.count(*) FROM pg_catalog.pg_proc AS p
       WHERE p.prosecdef AND p.pronamespace NOT IN ('pg_catalog'::regnamespace, 'information_schema'::regnamespace)
         AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_depend AS d
                          WHERE d.classid = 'pg_catalog.pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e')
         AND (pg_catalog.has_function_privilege('service_role', p.oid, 'EXECUTE')
              OR pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE')
              OR pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE')
              OR EXISTS (SELECT 1 FROM pg_catalog.aclexplode(COALESCE(p.proacl, pg_catalog.acldefault('f', p.proowner))) AS a
                          WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE'))) <> 41 THEN
    RAISE EXCEPTION 'M16_S1C5_PREFLIGHT: application SECURITY DEFINER surface is not exactly the 41 post-S1C.4 baseline' USING ERRCODE = '55000';
  END IF;
  -- No CONTROL_ASSESSMENT governance history may pre-exist (nothing before S1C.5 could write any).
  IF EXISTS (SELECT 1 FROM gov_repo.l14_proposals AS p WHERE p.subject_kind = 'CONTROL_ASSESSMENT')
     OR EXISTS (SELECT 1 FROM gov_repo.l14_authorization_decisions AS a WHERE a.subject_kind = 'CONTROL_ASSESSMENT') THEN
    RAISE EXCEPTION 'M16_S1C5_PREFLIGHT: control assessment governance history already exists' USING ERRCODE = '55000';
  END IF;
END;
$preflight$;

-- ---------------------------------------------------------------------------------------
-- B. Closed framework widening required by the fifth (final) fact family.
-- ---------------------------------------------------------------------------------------

-- B1. Governance decisions: the CONTROL_ASSESSMENT subject and its four closed reason codes (the S1B.0 subject x outcome
--     reason rule yields exactly CONTROL_ASSESSMENT_{VALIDATED,REJECTED,DEFERRED,REVOKED}). Existing rows satisfy it.
ALTER TABLE gov_repo.l14_governance_decisions
  DROP CONSTRAINT l14_governance_decisions_subject_kind_check,
  DROP CONSTRAINT l14_governance_decisions_reason_code_check;
ALTER TABLE gov_repo.l14_governance_decisions
  ADD CONSTRAINT l14_governance_decisions_subject_kind_check CHECK (subject_kind IN (
    'AUTHORITY_POLICY_VERSION','GOVERNANCE_PARTY','BUSINESS_DOMAIN','INFORMATION_DOMAIN','CONTROL_DEFINITION','POLICY_VERSION',
    'RESPONSIBILITY_ASSIGNMENT','BUSINESS_CONTEXT_ASSIGNMENT','POLICY_APPLICABILITY','CONTROL_APPLICABILITY',
    'CONTROL_ASSESSMENT')),
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
    'POLICY_APPLICABILITY_REVOKED',
    'CONTROL_APPLICABILITY_VALIDATED','CONTROL_APPLICABILITY_REJECTED','CONTROL_APPLICABILITY_DEFERRED',
    'CONTROL_APPLICABILITY_REVOKED',
    'CONTROL_ASSESSMENT_VALIDATED','CONTROL_ASSESSMENT_REJECTED','CONTROL_ASSESSMENT_DEFERRED',
    'CONTROL_ASSESSMENT_REVOKED'));

-- B2. Authorization decisions: a CONTROL_ASSESSMENT request target is the exact target of the pinned applicability state:
--     ONE exact canonical object (the existing S1B.0 FK pins organisation + id + declared kind) or ONE exact relationship
--     state with its DB-resolved type (the existing S1B.0 request-target shape; deliberately no FK onto the F2 table).
--     Never organisation-wide. New CHECK only.
ALTER TABLE gov_repo.l14_authorization_decisions
  ADD CONSTRAINT l14_authorization_decisions_control_assessment_target_check CHECK (
    subject_kind <> 'CONTROL_ASSESSMENT'
    OR (scope_tag IN ('CANONICAL_OBJECT','RELATIONSHIP_STATE')
        AND attempted_content_hash IS NULL AND expected_latest_version_id IS NULL
        AND expectation_kind IN ('EXPECTED_NONE','EXPECTED_CURRENT')));

-- B3. The common fact-state envelope admits exactly the five M16 fact families. Every S1C.1 .. S1C.4 row satisfies the
--     widened CHECK. CONTROL_FINDING is never a subject.
ALTER TABLE gov_repo.l14_fact_states
  DROP CONSTRAINT l14_fact_states_subject_kind_check;
ALTER TABLE gov_repo.l14_fact_states
  ADD CONSTRAINT l14_fact_states_subject_kind_check CHECK (subject_kind IN (
    'RESPONSIBILITY_ASSIGNMENT','BUSINESS_CONTEXT_ASSIGNMENT','POLICY_APPLICABILITY','CONTROL_APPLICABILITY',
    'CONTROL_ASSESSMENT'));

-- B4. Command results: the S1C.1 fact branch is reused verbatim for the fifth family. The S1A AUTHORITY_POLICY_VERSION
--     branch and the S1B registry branch are kept VERBATIM.
ALTER TABLE gov_repo.l14_command_results
  DROP CONSTRAINT l14_command_results_subject_kind_check,
  DROP CONSTRAINT l14_command_results_shape_check;
ALTER TABLE gov_repo.l14_command_results
  ADD CONSTRAINT l14_command_results_subject_kind_check CHECK (subject_kind IN (
    'AUTHORITY_POLICY_VERSION','GOVERNANCE_PARTY','BUSINESS_DOMAIN','INFORMATION_DOMAIN','CONTROL_DEFINITION','POLICY_VERSION',
    'RESPONSIBILITY_ASSIGNMENT','BUSINESS_CONTEXT_ASSIGNMENT','POLICY_APPLICABILITY','CONTROL_APPLICABILITY',
    'CONTROL_ASSESSMENT')),
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
    OR (subject_kind IN ('RESPONSIBILITY_ASSIGNMENT','BUSINESS_CONTEXT_ASSIGNMENT','POLICY_APPLICABILITY',
                         'CONTROL_APPLICABILITY','CONTROL_ASSESSMENT')
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
--     CONTROL_ASSESSMENT. Same signature, owner, ACL (owner-only) and frame_identity key derivation; the existing key
--     spaces are unchanged (the subject kind is part of every key).
CREATE OR REPLACE FUNCTION gov_repo.l14_lock_fact_subject_guard_v1(p_organisation_id uuid, p_subject_kind text, p_key_parts text[])
RETURNS void
LANGUAGE plpgsql
VOLATILE
SET search_path = pg_catalog, pg_temp
AS $guard$
BEGIN
  IF p_organisation_id IS NULL OR p_subject_kind IS NULL
     OR p_subject_kind NOT IN ('RESPONSIBILITY_ASSIGNMENT','BUSINESS_CONTEXT_ASSIGNMENT','POLICY_APPLICABILITY','CONTROL_APPLICABILITY','CONTROL_ASSESSMENT')
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
-- C1. Typed immutable CONTROL_ASSESSMENT state detail over the fact envelope. Logical key = the exact pinned applicability
--     state; the mirrored immutable S1C.4 tuple of that state (composite FK onto the S1C.4 pin key: APPLIES + VALIDATED
--     only); the closed outcome. Linear per-key lineage: a successor (renewal / correction) may carry ANOTHER outcome /
--     valid_until for the SAME applicability state; a REVOKED state revokes exactly its VALIDATED predecessor of the same
--     key and outcome. No valid_until column: the envelope effective_to IS valid_until. No JSON, no rationale, no score.
-- ---------------------------------------------------------------------------------------
CREATE TABLE gov_repo.l14_control_assessment_states (
  organisation_id uuid NOT NULL,
  fact_state_id uuid NOT NULL,
  subject_kind text NOT NULL DEFAULT 'CONTROL_ASSESSMENT' CHECK (subject_kind = 'CONTROL_ASSESSMENT'),
  state_kind text NOT NULL CHECK (state_kind IN ('VALIDATED','REVOKED')),
  control_applicability_state_id uuid NOT NULL,            -- the exact assessed S1C.4 state (the logical key)
  applicability_target_key text NOT NULL CHECK (pg_catalog.length(applicability_target_key) BETWEEN 1 AND 1100),
  control_definition_id uuid NOT NULL,
  control_definition_version_id uuid NOT NULL,
  content_hash character(64) NOT NULL CHECK (content_hash::text ~ '^[0-9a-f]{64}$'),
  control_definition_validated_state_id uuid NOT NULL,
  applicability text NOT NULL DEFAULT 'APPLIES' CHECK (applicability = 'APPLIES'),
  applicability_state_kind text NOT NULL DEFAULT 'VALIDATED' CHECK (applicability_state_kind = 'VALIDATED'),
  assessment_outcome text NOT NULL CHECK (assessment_outcome IN (
    'SATISFIED','PARTIALLY_SATISFIED','NOT_SATISFIED','NOT_ASSESSED','INSUFFICIENT_EVIDENCE')),
  predecessor_state_id uuid,                         -- copy of the envelope value (verified on insert)
  revokes_state_id uuid,                             -- copy of the envelope value (verified on insert)
  revoked_state_kind text GENERATED ALWAYS AS (
    CASE WHEN revokes_state_id IS NULL THEN NULL ELSE 'VALIDATED' END) STORED
    CHECK (revoked_state_kind IS NULL OR revoked_state_kind = 'VALIDATED'),
  CONSTRAINT l14_control_assessment_states_pkey PRIMARY KEY (organisation_id, fact_state_id),
  CONSTRAINT l14_control_assessment_states_key_unique
    UNIQUE (organisation_id, fact_state_id, control_applicability_state_id),
  -- The exact pin a REVOKE (proposal or state) uses: same key, outcome, VALIDATED.
  CONSTRAINT l14_control_assessment_states_kind_unique
    UNIQUE (organisation_id, fact_state_id, control_applicability_state_id, assessment_outcome, state_kind),
  CONSTRAINT l14_control_assessment_states_shape_check CHECK (
    (state_kind = 'VALIDATED' AND revokes_state_id IS NULL)
    OR (state_kind = 'REVOKED' AND revokes_state_id IS NOT NULL AND predecessor_state_id = revokes_state_id)),
  CONSTRAINT l14_control_assessment_states_envelope_fkey
    FOREIGN KEY (organisation_id, fact_state_id, subject_kind, state_kind)
    REFERENCES gov_repo.l14_fact_states (organisation_id, fact_state_id, subject_kind, state_kind),
  -- The exact S1C.4 VALIDATED APPLIES state with THIS mirrored immutable tuple in THIS organisation
  -- (l14_control_applicability_states_kind_unique): a DOES_NOT_APPLY / REVOKED / foreign / swapped tuple has no such row.
  CONSTRAINT l14_control_assessment_states_applicability_fkey
    FOREIGN KEY (organisation_id, control_applicability_state_id, applicability_target_key, control_definition_id,
                 control_definition_version_id, content_hash, control_definition_validated_state_id, applicability,
                 applicability_state_kind)
    REFERENCES gov_repo.l14_control_applicability_states (organisation_id, fact_state_id, target_key, control_definition_id,
                 control_definition_version_id, content_hash, control_definition_validated_state_id, applicability, state_kind)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  -- Same logical key (the outcome / valid_until may differ: renewal or correction).
  CONSTRAINT l14_control_assessment_states_predecessor_fkey
    FOREIGN KEY (organisation_id, predecessor_state_id, control_applicability_state_id)
    REFERENCES gov_repo.l14_control_assessment_states (organisation_id, fact_state_id, control_applicability_state_id),
  CONSTRAINT l14_control_assessment_states_revokes_fkey
    FOREIGN KEY (organisation_id, revokes_state_id, control_applicability_state_id, assessment_outcome, revoked_state_kind)
    REFERENCES gov_repo.l14_control_assessment_states (organisation_id, fact_state_id, control_applicability_state_id,
                 assessment_outcome, state_kind)
);
-- Exactly one lineage root per fact key, and one successor per state.
CREATE UNIQUE INDEX l14_control_assessment_states_root_uidx
  ON gov_repo.l14_control_assessment_states (organisation_id, control_applicability_state_id)
  WHERE predecessor_state_id IS NULL;
CREATE UNIQUE INDEX l14_control_assessment_states_successor_uidx
  ON gov_repo.l14_control_assessment_states (organisation_id, predecessor_state_id) WHERE predecessor_state_id IS NOT NULL;
-- Bounded per-key lookups (resolver, current read).
CREATE INDEX l14_control_assessment_states_key_idx
  ON gov_repo.l14_control_assessment_states (organisation_id, control_applicability_state_id);

-- ---------------------------------------------------------------------------------------
-- C2. Typed immutable CONTROL_ASSESSMENT proposal detail over l14_proposals. Exact pinned applicability state + its
--     mirrored immutable S1C.4 tuple (DB-resolved), closed outcome, temporal intent (requested_effective_from NULL =
--     IMMEDIATE; MANDATORY requested_valid_until on VALIDATE, absent on REVOKE) and the exact REVOKE target.
-- ---------------------------------------------------------------------------------------
CREATE TABLE gov_repo.l14_control_assessment_proposals (
  organisation_id uuid NOT NULL,
  proposal_id uuid NOT NULL,
  subject_kind text NOT NULL DEFAULT 'CONTROL_ASSESSMENT' CHECK (subject_kind = 'CONTROL_ASSESSMENT'),
  intent text NOT NULL CHECK (intent IN ('VALIDATE','REVOKE')),
  control_applicability_state_id uuid NOT NULL,
  applicability_target_key text NOT NULL CHECK (pg_catalog.length(applicability_target_key) BETWEEN 1 AND 1100),
  control_definition_id uuid NOT NULL,
  control_definition_version_id uuid NOT NULL,
  content_hash character(64) NOT NULL CHECK (content_hash::text ~ '^[0-9a-f]{64}$'),
  control_definition_validated_state_id uuid NOT NULL,
  applicability text NOT NULL DEFAULT 'APPLIES' CHECK (applicability = 'APPLIES'),
  applicability_state_kind text NOT NULL DEFAULT 'VALIDATED' CHECK (applicability_state_kind = 'VALIDATED'),
  assessment_outcome text NOT NULL CHECK (assessment_outcome IN (
    'SATISFIED','PARTIALLY_SATISFIED','NOT_SATISFIED','NOT_ASSESSED','INSUFFICIENT_EVIDENCE')),
  requested_effective_from timestamptz,              -- NULL = IMMEDIATE (DB transaction instant)
  requested_valid_until timestamptz,                 -- MANDATORY on VALIDATE (becomes effective_to); NULL on REVOKE
  target_state_id uuid,                              -- exact REVOKE target
  target_state_kind text GENERATED ALWAYS AS (
    CASE WHEN target_state_id IS NULL THEN NULL ELSE 'VALIDATED' END) STORED
    CHECK (target_state_kind IS NULL OR target_state_kind = 'VALIDATED'),
  CONSTRAINT l14_control_assessment_proposals_pkey PRIMARY KEY (organisation_id, proposal_id),
  CONSTRAINT l14_control_assessment_proposals_envelope_fkey
    FOREIGN KEY (organisation_id, proposal_id, subject_kind, intent)
    REFERENCES gov_repo.l14_proposals (organisation_id, proposal_id, subject_kind, intent),
  CONSTRAINT l14_control_assessment_proposals_target_check CHECK (
    (intent = 'VALIDATE' AND target_state_id IS NULL AND requested_valid_until IS NOT NULL)
    OR (intent = 'REVOKE' AND target_state_id IS NOT NULL AND requested_valid_until IS NULL)),
  CONSTRAINT l14_control_assessment_proposals_interval_check CHECK (
    requested_valid_until IS NULL OR requested_effective_from IS NULL OR requested_valid_until > requested_effective_from),
  CONSTRAINT l14_control_assessment_proposals_applicability_fkey
    FOREIGN KEY (organisation_id, control_applicability_state_id, applicability_target_key, control_definition_id,
                 control_definition_version_id, content_hash, control_definition_validated_state_id, applicability,
                 applicability_state_kind)
    REFERENCES gov_repo.l14_control_applicability_states (organisation_id, fact_state_id, target_key, control_definition_id,
                 control_definition_version_id, content_hash, control_definition_validated_state_id, applicability, state_kind)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  -- A REVOKE pins an exact VALIDATED state of the SAME key and outcome.
  CONSTRAINT l14_control_assessment_proposals_target_state_fkey
    FOREIGN KEY (organisation_id, target_state_id, control_applicability_state_id, assessment_outcome, target_state_kind)
    REFERENCES gov_repo.l14_control_assessment_states (organisation_id, fact_state_id, control_applicability_state_id,
                 assessment_outcome, state_kind)
);

-- ---------------------------------------------------------------------------------------
-- C3. Technical compare-and-set head per exact fact key = organisation + control_applicability_state_id. NEVER the
--     target / control pair, the outcome or valid_until. Pointer only; never authority; reconstructible as the lineage
--     state without a successor. Created by the first state-appending decision of the key; RPC-maintained.
-- ---------------------------------------------------------------------------------------
CREATE TABLE gov_repo.l14_control_assessment_heads (
  organisation_id uuid NOT NULL,
  control_applicability_state_id uuid NOT NULL,
  latest_state_id uuid,
  CONSTRAINT l14_control_assessment_heads_pkey PRIMARY KEY (organisation_id, control_applicability_state_id),
  CONSTRAINT l14_control_assessment_heads_applicability_fkey
    FOREIGN KEY (organisation_id, control_applicability_state_id)
    REFERENCES gov_repo.l14_control_applicability_states (organisation_id, fact_state_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT l14_control_assessment_heads_state_fkey
    FOREIGN KEY (organisation_id, latest_state_id, control_applicability_state_id)
    REFERENCES gov_repo.l14_control_assessment_states (organisation_id, fact_state_id, control_applicability_state_id)
);

-- ---------------------------------------------------------------------------------------
-- D. Immutability + structural guards (raising, ENABLE ALWAYS, owner-only SECURITY INVOKER).
-- ---------------------------------------------------------------------------------------
DO $triggers$
DECLARE
  v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY['l14_control_assessment_states','l14_control_assessment_proposals'] LOOP
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

-- A proposal is LOCAL_HUMAN in this slice: SYSTEM_SEED / SOURCE_CONNECTION (scanner results, legacy flags, LLM analysis)
-- have no trusted intake primitive here and can never masquerade as LOCAL_HUMAN. The pinned applicability must be the
-- exact VALIDATED APPLIES state whose immutable tuple the row mirrors (the FK already guarantees it; defence in depth).
CREATE FUNCTION gov_repo.l14_control_assessment_proposal_guard_v1()
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
    AND p.subject_kind = 'CONTROL_ASSESSMENT';
  IF v_envelope_source IS DISTINCT FROM 'LOCAL_HUMAN' THEN
    RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'CONTROL_ASSESSMENT_PROPOSAL_SOURCE_INVALID';
  END IF;
  PERFORM 1 FROM gov_repo.l14_control_applicability_states AS a
  WHERE a.organisation_id = NEW.organisation_id AND a.fact_state_id = NEW.control_applicability_state_id
    AND a.state_kind = 'VALIDATED' AND a.applicability = 'APPLIES' AND a.target_key = NEW.applicability_target_key
    AND a.control_definition_id = NEW.control_definition_id
    AND a.control_definition_version_id = NEW.control_definition_version_id AND a.content_hash = NEW.content_hash
    AND a.control_definition_validated_state_id = NEW.control_definition_validated_state_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'CONTROL_ASSESSMENT_APPLICABILITY_MISMATCH';
  END IF;
  RETURN NEW;
END;
$guard$;
CREATE TRIGGER l14_control_assessment_proposals_guard BEFORE INSERT ON gov_repo.l14_control_assessment_proposals
  FOR EACH ROW EXECUTE FUNCTION gov_repo.l14_control_assessment_proposal_guard_v1();
ALTER TABLE gov_repo.l14_control_assessment_proposals ENABLE ALWAYS TRIGGER l14_control_assessment_proposals_guard;

-- A state detail must mirror its envelope exactly (kind, lineage, LOCAL_HUMAN source), belong to the proposal the
-- envelope's governance decision decided (applicability state, mirrored tuple, outcome, intent, REVOKE target, mandatory
-- valid_until = effective_to), carry the exact target its authorization evaluated (the pinned applicability's target:
-- object kind + id, or relationship id + state id + the DB-resolved type of exactly one resolved row), respect the per-key
-- interval lineage and, when VALIDATED, pin exactly the applicability state the S1C.4 resolver returns (APPLIES) at the
-- state's OWN coordinates (defence in depth: the RPC checks the same rules first, under the same guards, same errors).
CREATE FUNCTION gov_repo.l14_control_assessment_state_guard_v1()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, pg_temp
AS $guard$
DECLARE
  v_envelope record;
  v_proposal record;
  v_authz record;
  v_applicability record;
  v_predecessor record;
  v_rel record;
BEGIN
  SELECT s.state_kind, s.predecessor_state_id, s.revokes_state_id, s.effective_from, s.effective_to, s.recorded_at,
         s.governance_decision_id, s.authorization_decision_id, s.source_class
  INTO v_envelope
  FROM gov_repo.l14_fact_states AS s
  WHERE s.organisation_id = NEW.organisation_id AND s.fact_state_id = NEW.fact_state_id
    AND s.subject_kind = 'CONTROL_ASSESSMENT';
  IF NOT FOUND OR v_envelope.state_kind IS DISTINCT FROM NEW.state_kind
     OR v_envelope.predecessor_state_id IS DISTINCT FROM NEW.predecessor_state_id
     OR v_envelope.revokes_state_id IS DISTINCT FROM NEW.revokes_state_id
     OR v_envelope.source_class IS DISTINCT FROM 'LOCAL_HUMAN' THEN
    RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'CONTROL_ASSESSMENT_STATE_ENVELOPE_MISMATCH';
  END IF;
  -- valid_until IS effective_to: mandatory on every VALIDATED assessment, never on a REVOKE.
  IF (NEW.state_kind = 'VALIDATED') IS DISTINCT FROM (v_envelope.effective_to IS NOT NULL) THEN
    RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'VALID_UNTIL_REQUIRED';
  END IF;
  SELECT p.source_class, t.intent, t.control_applicability_state_id, t.applicability_target_key, t.control_definition_id,
         t.control_definition_version_id, t.content_hash, t.control_definition_validated_state_id, t.assessment_outcome,
         t.requested_valid_until, t.target_state_id
  INTO v_proposal
  FROM gov_repo.l14_governance_decisions AS d
  JOIN gov_repo.l14_proposals AS p ON p.organisation_id = d.organisation_id AND p.proposal_id = d.proposal_id
  JOIN gov_repo.l14_control_assessment_proposals AS t
    ON t.organisation_id = d.organisation_id AND t.proposal_id = d.proposal_id
  WHERE d.organisation_id = NEW.organisation_id AND d.governance_decision_id = v_envelope.governance_decision_id;
  IF NOT FOUND OR v_proposal.source_class IS DISTINCT FROM v_envelope.source_class
     OR v_proposal.control_applicability_state_id IS DISTINCT FROM NEW.control_applicability_state_id
     OR v_proposal.applicability_target_key IS DISTINCT FROM NEW.applicability_target_key
     OR v_proposal.control_definition_id IS DISTINCT FROM NEW.control_definition_id
     OR v_proposal.control_definition_version_id IS DISTINCT FROM NEW.control_definition_version_id
     OR v_proposal.content_hash IS DISTINCT FROM NEW.content_hash
     OR v_proposal.control_definition_validated_state_id IS DISTINCT FROM NEW.control_definition_validated_state_id
     OR v_proposal.assessment_outcome IS DISTINCT FROM NEW.assessment_outcome
     OR v_proposal.intent IS DISTINCT FROM (CASE NEW.state_kind WHEN 'VALIDATED' THEN 'VALIDATE' ELSE 'REVOKE' END)
     OR v_proposal.target_state_id IS DISTINCT FROM NEW.revokes_state_id
     OR v_envelope.effective_to IS DISTINCT FROM (CASE WHEN NEW.state_kind = 'VALIDATED' THEN v_proposal.requested_valid_until END) THEN
    RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'CONTROL_ASSESSMENT_STATE_PROPOSAL_MISMATCH';
  END IF;
  SELECT a.target_type, a.target_canonical_kind, a.target_canonical_object_id, a.target_relationship_id,
         a.target_relationship_state_id
  INTO v_applicability
  FROM gov_repo.l14_control_applicability_states AS a
  WHERE a.organisation_id = NEW.organisation_id AND a.fact_state_id = NEW.control_applicability_state_id;
  SELECT a.scope_tag, a.target_canonical_kind, a.target_canonical_object_id, a.target_relationship_type,
         a.target_relationship_id, a.target_relationship_state_id, a.source_class
  INTO v_authz
  FROM gov_repo.l14_authorization_decisions AS a
  WHERE a.organisation_id = NEW.organisation_id AND a.authorization_decision_id = v_envelope.authorization_decision_id;
  IF NOT FOUND OR v_authz.source_class IS DISTINCT FROM v_envelope.source_class
     OR v_authz.scope_tag IS DISTINCT FROM v_applicability.target_type
     OR v_authz.target_canonical_kind IS DISTINCT FROM v_applicability.target_canonical_kind
     OR v_authz.target_canonical_object_id IS DISTINCT FROM v_applicability.target_canonical_object_id
     OR v_authz.target_relationship_id IS DISTINCT FROM v_applicability.target_relationship_id
     OR v_authz.target_relationship_state_id IS DISTINCT FROM v_applicability.target_relationship_state_id THEN
    RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'CONTROL_ASSESSMENT_STATE_AUTHORIZATION_TARGET_MISMATCH';
  END IF;
  IF v_applicability.target_type = 'RELATIONSHIP_STATE' THEN
    SELECT r.match_count, r.relationship_type INTO v_rel
    FROM gov_repo.l14_resolve_relationship_state_target_v1(NEW.organisation_id, v_applicability.target_relationship_id,
      v_applicability.target_relationship_state_id) AS r;
    IF v_rel.match_count = 0 THEN
      RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'TARGET_RELATIONSHIP_STATE_UNRESOLVED';
    END IF;
    IF v_rel.match_count <> 1 THEN
      RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'TARGET_RELATIONSHIP_STATE_AMBIGUOUS';
    END IF;
    IF v_authz.target_relationship_type IS DISTINCT FROM v_rel.relationship_type THEN
      RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'CONTROL_ASSESSMENT_STATE_AUTHORIZATION_TARGET_MISMATCH';
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
    ELSIF v_envelope.effective_from < v_predecessor.effective_from THEN
      -- Renewal / correction: never before the predecessor's start (its closure is derived from this successor).
      RAISE EXCEPTION 'L14_CONTINUITY_VIOLATION' USING ERRCODE = 'GV011', DETAIL = 'SUCCESSOR_BEFORE_PREDECESSOR_EFFECTIVE';
    END IF;
  END IF;
  IF NEW.state_kind = 'VALIDATED' AND NOT EXISTS (
       SELECT 1 FROM gov_repo.l14_control_applicability_valid_state_v1(NEW.organisation_id, v_applicability.target_type,
         v_applicability.target_canonical_kind, v_applicability.target_canonical_object_id,
         v_applicability.target_relationship_id, v_applicability.target_relationship_state_id, NEW.control_definition_id,
         v_envelope.effective_from, v_envelope.recorded_at) AS ca
       WHERE ca.fact_state_id = NEW.control_applicability_state_id AND ca.applicability = 'APPLIES') THEN
    RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'CONTROL_APPLICABILITY_DEPENDENCY_NOT_VALID';
  END IF;
  RETURN NEW;
END;
$guard$;
CREATE TRIGGER l14_control_assessment_states_guard BEFORE INSERT ON gov_repo.l14_control_assessment_states
  FOR EACH ROW EXECUTE FUNCTION gov_repo.l14_control_assessment_state_guard_v1();
ALTER TABLE gov_repo.l14_control_assessment_states ENABLE ALWAYS TRIGGER l14_control_assessment_states_guard;

-- The head is the only mutable S1C.5 table: created with no state, key fixed, never deleted/truncated, and only ever
-- advanced to the direct lineage successor of its current state.
CREATE FUNCTION gov_repo.l14_control_assessment_head_guard_v1()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, pg_temp
AS $head$
BEGIN
  IF TG_OP IN ('DELETE', 'TRUNCATE') THEN
    RAISE EXCEPTION 'L14_HISTORY_IMMUTABLE' USING ERRCODE = '55000', DETAIL = 'l14_control_assessment_heads:' || TG_OP;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.latest_state_id IS NOT NULL THEN
      RAISE EXCEPTION 'L14_HISTORY_IMMUTABLE' USING ERRCODE = '55000', DETAIL = 'l14_control_assessment_heads:INSERT_WITH_STATE';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.organisation_id IS DISTINCT FROM OLD.organisation_id
     OR NEW.control_applicability_state_id IS DISTINCT FROM OLD.control_applicability_state_id
     OR (OLD.latest_state_id IS NOT NULL AND NEW.latest_state_id IS NULL) THEN
    RAISE EXCEPTION 'L14_HISTORY_IMMUTABLE' USING ERRCODE = '55000', DETAIL = 'l14_control_assessment_heads:IDENTITY';
  END IF;
  IF NEW.latest_state_id IS DISTINCT FROM OLD.latest_state_id AND NOT EXISTS (
       SELECT 1 FROM gov_repo.l14_control_assessment_states AS s
       WHERE s.organisation_id = NEW.organisation_id AND s.fact_state_id = NEW.latest_state_id
         AND s.control_applicability_state_id = OLD.control_applicability_state_id
         AND s.predecessor_state_id IS NOT DISTINCT FROM OLD.latest_state_id) THEN
    RAISE EXCEPTION 'L14_HISTORY_IMMUTABLE' USING ERRCODE = '55000', DETAIL = 'l14_control_assessment_heads:LINEAGE';
  END IF;
  RETURN NEW;
END;
$head$;
CREATE TRIGGER l14_control_assessment_heads_guard BEFORE INSERT OR UPDATE OR DELETE ON gov_repo.l14_control_assessment_heads
  FOR EACH ROW EXECUTE FUNCTION gov_repo.l14_control_assessment_head_guard_v1();
CREATE TRIGGER l14_control_assessment_heads_no_truncate BEFORE TRUNCATE ON gov_repo.l14_control_assessment_heads
  FOR EACH STATEMENT EXECUTE FUNCTION gov_repo.l14_control_assessment_head_guard_v1();
ALTER TABLE gov_repo.l14_control_assessment_heads ENABLE ALWAYS TRIGGER l14_control_assessment_heads_guard;
ALTER TABLE gov_repo.l14_control_assessment_heads ENABLE ALWAYS TRIGGER l14_control_assessment_heads_no_truncate;

-- ---------------------------------------------------------------------------------------
-- E. Owner-only helpers.
-- ---------------------------------------------------------------------------------------

-- SHARED mode of the EXACT S1C.4 CONTROL_APPLICABILITY fact KEY guard key of one applicability fact key:
-- frame_identity([organisation, 'l14-fact-subject-guard-v1', 'CONTROL_APPLICABILITY', 'KEY', target_key,
--   control_definition_id]) — byte-identical to the key gov_repo.l14_lock_fact_subject_guard_v1 derives for the S1C.4 SUBMIT /
-- DECIDE RPCs (which take it EXCLUSIVELY). No new lock namespace. An assessment VALIDATE pinning a state of that key
-- therefore serializes deterministically with every applicability decision on the key (a revocation / supersession
-- committed first is seen by the resolver; one waiting behind the assessment commits after it and makes it historical
-- through the joint read check), while assessments of the same key never serialize on each other. Held to commit.
CREATE FUNCTION gov_repo.l14_lock_control_applicability_dependency_guard_shared_v1(
  p_organisation_id uuid, p_target_key text, p_control_definition_id uuid)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SET search_path = pg_catalog, pg_temp
AS $guard$
BEGIN
  IF p_organisation_id IS NULL OR p_target_key IS NULL OR pg_catalog.length(p_target_key) NOT BETWEEN 1 AND 1100
     OR p_control_definition_id IS NULL THEN
    RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'GUARD_KEY_INVALID';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock_shared(pg_catalog.hashtextextended(
    gov_repo.frame_identity(ARRAY[p_organisation_id::text, 'l14-fact-subject-guard-v1', 'CONTROL_APPLICABILITY', 'KEY',
      p_target_key, p_control_definition_id::text]), 0));
END;
$guard$;

-- The ORIGINAL durable CONTROL_ASSESSMENT result, exactly as stored (replay never recomputes it). SUBMIT / DECIDE project
-- the exact applicability state + mirrored control version tuple + outcome their immutable typed proposal pins; VALIDATED /
-- REVOKED project the fact state (incl. its lineage predecessor and valid_until = the envelope effective_to).
CREATE FUNCTION gov_repo.l14_control_assessment_command_result_v1(p_organisation_id uuid, p_command_id text, p_replay boolean)
RETURNS TABLE (
  replay boolean, command_id text, command_kind text, subject_kind text, outcome text, command_fingerprint text,
  authorization_decision_id uuid, authorization_result text, deny_reason text, expectation_kind text,
  expected_current_state_id uuid, proposal_id uuid, governance_decision_id uuid, control_applicability_state_id uuid,
  control_definition_id uuid, control_definition_version_id uuid, content_hash text, assessment_outcome text,
  fact_state_id uuid, state_kind text, predecessor_state_id uuid, effective_from timestamptz, valid_until timestamptz,
  recorded_at timestamptz
)
LANGUAGE sql
STABLE
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT p_replay, c.command_id, c.command_kind, c.subject_kind, c.outcome, c.command_fingerprint,
         c.authorization_decision_id, a.result, a.deny_reason, a.expectation_kind, a.expected_current_state_id,
         c.proposal_id, c.governance_decision_id, t.control_applicability_state_id, t.control_definition_id,
         t.control_definition_version_id, t.content_hash::text, t.assessment_outcome, c.fact_state_id, s.state_kind,
         s.predecessor_state_id, s.effective_from, s.effective_to, c.recorded_at
  FROM gov_repo.l14_command_results AS c
  LEFT JOIN gov_repo.l14_authorization_decisions AS a
    ON a.organisation_id = c.organisation_id AND a.authorization_decision_id = c.authorization_decision_id
  LEFT JOIN gov_repo.l14_control_assessment_proposals AS t
    ON t.organisation_id = c.organisation_id AND t.proposal_id = c.proposal_id
  LEFT JOIN gov_repo.l14_fact_states AS s
    ON s.organisation_id = c.organisation_id AND s.fact_state_id = c.fact_state_id
  WHERE c.organisation_id = p_organisation_id AND c.command_id = p_command_id AND c.subject_kind = 'CONTROL_ASSESSMENT'
    AND c.command_kind IN ('SUBMIT_PROPOSAL','DECIDE_PROPOSAL')
$$;

-- Exact bitemporal resolver (ADR §15, §17-§18.1, O31, O40, O55). The exact VALIDATED assessment of the exact fact key (the
-- exact applicability state) valid at business instant p_effective_at as known at system cutoff p_recorded_cutoff,
-- returned ONLY when ALL hold at the SAME pair of coordinates:
--   * own state: recorded_at <= cutoff, effective_from <= instant < valid_until (the mandatory effective_to: expiry needs no
--     row update and a head never overrides it), and no VISIBLE lineage successor (renewal / correction or the exact REVOKED
--     tombstone, recorded <= cutoff) with effective_from <= instant — closure is DERIVED, never stored; exactly one
--     candidate (ambiguity fails closed);
--   * applicability: the pinned state is EXACTLY the state gov_repo.l14_control_applicability_valid_state_v1 returns (with
--     APPLIES) for its own exact target + control definition at the same instant and cutoff — which itself re-checks the
--     exact target and the pinned CONTROL_DEFINITION dependency. A superseded / revoked / expired / dependency-invalid
--     applicability makes the assessment historical; it is never transferred to a successor applicability state.
-- No row otherwise = UNKNOWN (never NOT_ASSESSED). A VALIDATED NOT_ASSESSED is a positive governed row.
CREATE FUNCTION gov_repo.l14_control_assessment_valid_state_v1(
  p_organisation_id uuid, p_control_applicability_state_id uuid, p_effective_at timestamptz, p_recorded_cutoff timestamptz)
RETURNS TABLE (fact_state_id uuid, control_applicability_state_id uuid, control_definition_id uuid,
               control_definition_version_id uuid, content_hash text, assessment_outcome text, effective_from timestamptz,
               valid_until timestamptz, recorded_at timestamptz)
LANGUAGE sql
STABLE
SET search_path = pg_catalog, pg_temp
AS $$
  WITH visible AS (
    SELECT s.fact_state_id, s.state_kind, s.predecessor_state_id, s.effective_from, s.effective_to, s.recorded_at,
           d.control_applicability_state_id, d.control_definition_id, d.control_definition_version_id, d.content_hash,
           d.assessment_outcome
    FROM gov_repo.l14_fact_states AS s
    JOIN gov_repo.l14_control_assessment_states AS d
      ON d.organisation_id = s.organisation_id AND d.fact_state_id = s.fact_state_id AND d.state_kind = s.state_kind
    WHERE s.organisation_id = p_organisation_id AND s.subject_kind = 'CONTROL_ASSESSMENT'
      AND d.control_applicability_state_id = p_control_applicability_state_id
      AND s.recorded_at <= p_recorded_cutoff
  ), candidates AS (
    SELECT v.* FROM visible AS v
    WHERE v.state_kind = 'VALIDATED' AND v.effective_from <= p_effective_at
      AND v.effective_to IS NOT NULL AND p_effective_at < v.effective_to
      AND NOT EXISTS (SELECT 1 FROM visible AS n
                      WHERE n.predecessor_state_id = v.fact_state_id AND n.effective_from <= p_effective_at)
  )
  SELECT c.fact_state_id, c.control_applicability_state_id, c.control_definition_id, c.control_definition_version_id,
         c.content_hash::text, c.assessment_outcome, c.effective_from, c.effective_to, c.recorded_at
  FROM candidates AS c
  JOIN gov_repo.l14_control_applicability_states AS a
    ON a.organisation_id = p_organisation_id AND a.fact_state_id = c.control_applicability_state_id
  WHERE (SELECT pg_catalog.count(*) FROM candidates) = 1
    AND EXISTS (SELECT 1 FROM gov_repo.l14_control_applicability_valid_state_v1(p_organisation_id, a.target_type,
                  a.target_canonical_kind, a.target_canonical_object_id, a.target_relationship_id,
                  a.target_relationship_state_id, a.control_definition_id, p_effective_at, p_recorded_cutoff) AS ca
                WHERE ca.fact_state_id = c.control_applicability_state_id AND ca.applicability = 'APPLIES')
$$;

-- Bounded current-assessment read of ONE exact target: for every control definition whose CURRENT applicability of that
-- exact target (S1C.4 bounded read, same coordinates) is APPLIES, the current valid assessment of EXACTLY that current
-- applicability state. At most one row per control definition. An applicable control with no row is UNKNOWN (never
-- NOT_ASSESSED; a VALIDATED NOT_ASSESSED is returned as such); a DOES_NOT_APPLY / UNKNOWN applicability never yields a row
-- (never positive satisfaction by aggregation). An assessment of a superseded applicability is never carried forward.
CREATE FUNCTION gov_repo.l14_control_assessments_current_v1(
  p_organisation_id uuid, p_target_type text, p_target_canonical_kind text, p_target_canonical_object_id text,
  p_target_relationship_id text, p_target_relationship_state_id text,
  p_effective_at timestamptz, p_recorded_cutoff timestamptz)
RETURNS TABLE (control_definition_id uuid, control_definition_version_id uuid, content_hash text,
               control_applicability_state_id uuid, fact_state_id uuid, assessment_outcome text, effective_from timestamptz,
               valid_until timestamptz, recorded_at timestamptz)
LANGUAGE sql
STABLE
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT v.control_definition_id, v.control_definition_version_id, v.content_hash, v.control_applicability_state_id,
         v.fact_state_id, v.assessment_outcome, v.effective_from, v.valid_until, v.recorded_at
  FROM gov_repo.l14_control_applicabilities_current_v1(p_organisation_id, p_target_type, p_target_canonical_kind,
         p_target_canonical_object_id, p_target_relationship_id, p_target_relationship_state_id,
         p_effective_at, p_recorded_cutoff) AS ca
  CROSS JOIN LATERAL gov_repo.l14_control_assessment_valid_state_v1(p_organisation_id, ca.fact_state_id,
    p_effective_at, p_recorded_cutoff) AS v
  WHERE ca.applicability = 'APPLIES'
$$;

-- ---------------------------------------------------------------------------------------
-- F1. RPC — CONTROL_ASSESSMENT proposal submission (any verified ACTIVE same-tenant member; no authority, no
--     authorization, no decision, no fact, no head mutation, no admission / validation, no trust promotion). LOCAL_HUMAN.
-- ---------------------------------------------------------------------------------------
CREATE FUNCTION gov_repo.l14_submit_control_assessment_proposal_v1(
  p_verified_organisation_id uuid,
  p_verified_actor_user_id uuid,
  p_verified_session_iat bigint,
  p_verified_session_exp bigint,
  p_verified_credential_epoch timestamptz,
  p_command_id text,
  p_intent text,                                -- VALIDATE | REVOKE
  p_source_class text,                          -- LOCAL_HUMAN only in this slice
  p_control_applicability_state_id uuid,        -- the exact S1C.4 VALIDATED APPLIES state being assessed (the key)
  p_assessment_outcome text,                    -- SATISFIED | PARTIALLY_SATISFIED | NOT_SATISFIED | NOT_ASSESSED | INSUFFICIENT_EVIDENCE
  p_requested_effective_from timestamptz,       -- NULL = IMMEDIATE intent
  p_requested_valid_until timestamptz,          -- VALIDATE: MANDATORY (becomes effective_to); REVOKE: NULL
  p_target_state_id uuid,                       -- REVOKE only: the exact current VALIDATED assessment of the same key
  p_prior_proposal_id uuid,                     -- correction link (same key)
  p_support_status text,
  p_support_evidence_ids text[],
  p_caller_fingerprint text                     -- assertion only; PostgreSQL recomputes
)
RETURNS TABLE (
  replay boolean, command_id text, command_kind text, subject_kind text, outcome text, command_fingerprint text,
  authorization_decision_id uuid, authorization_result text, deny_reason text, expectation_kind text,
  expected_current_state_id uuid, proposal_id uuid, governance_decision_id uuid, control_applicability_state_id uuid,
  control_definition_id uuid, control_definition_version_id uuid, content_hash text, assessment_outcome text,
  fact_state_id uuid, state_kind text, predecessor_state_id uuid, effective_from timestamptz, valid_until timestamptz,
  recorded_at timestamptz
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
SET lock_timeout = '5s'
AS $submit_control_assessment$
#variable_conflict use_column
DECLARE
  v_org uuid := p_verified_organisation_id;
  v_actor uuid := p_verified_actor_user_id;
  v_support text[];
  v_fingerprint text;
  v_applicability record;
  v_target record;
  v_latest uuid;
  v_proposal uuid := pg_catalog.gen_random_uuid();
  v_now timestamptz;
BEGIN
  -- 1. Any verified ACTIVE same-tenant member (no L14 permission is required to submit). Tenant + actor come ONLY
  --    from here.
  PERFORM 1 FROM gov_repo.l14_session_basis_v1(v_org, v_actor, p_verified_session_iat,
    p_verified_session_exp, p_verified_credential_epoch);

  -- 2. Syntactic shape (no table read): closed vocabularies, the exact applicability pin, the closed outcome vocabulary
  --    (an unsupported M16 V1 outcome is refused explicitly), the mandatory valid_until and the interval shape.
  PERFORM gov_repo.l14_validate_command_id_v1(p_command_id, p_caller_fingerprint);
  IF p_intent IS NULL OR p_intent NOT IN ('VALIDATE','REVOKE')
     OR p_source_class IS NULL OR p_source_class NOT IN ('SYSTEM_SEED','LOCAL_HUMAN','SOURCE_CONNECTION') THEN
    RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'PROPOSAL_VOCABULARY_UNKNOWN';
  END IF;
  IF p_source_class <> 'LOCAL_HUMAN' THEN
    RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'SOURCE_CLASS_NOT_EXECUTABLE';
  END IF;
  IF p_control_applicability_state_id IS NULL THEN
    RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'CONTROL_APPLICABILITY_STATE_REQUIRED';
  END IF;
  IF p_assessment_outcome = 'WAIVED' THEN
    RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'CONTROL_ASSESSMENT_WAIVED_UNSUPPORTED';
  END IF;
  IF p_assessment_outcome IS NULL OR p_assessment_outcome NOT IN (
       'SATISFIED','PARTIALLY_SATISFIED','NOT_SATISFIED','NOT_ASSESSED','INSUFFICIENT_EVIDENCE') THEN
    RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'CONTROL_ASSESSMENT_OUTCOME_UNKNOWN';
  END IF;
  IF p_intent = 'VALIDATE' AND p_target_state_id IS NOT NULL THEN
    RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'TARGET_STATE_NOT_PERMITTED';
  END IF;
  IF p_intent = 'REVOKE' AND p_target_state_id IS NULL THEN
    RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'TARGET_STATE_REQUIRED';
  END IF;
  IF p_intent = 'VALIDATE' AND p_requested_valid_until IS NULL THEN
    RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'VALID_UNTIL_REQUIRED';
  END IF;
  IF p_intent = 'REVOKE' AND p_requested_valid_until IS NOT NULL THEN
    RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'VALID_UNTIL_NOT_PERMITTED';
  END IF;
  IF p_requested_valid_until IS NOT NULL AND p_requested_effective_from IS NOT NULL
     AND NOT (p_requested_valid_until > p_requested_effective_from) THEN
    RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'EFFECTIVE_INTERVAL_INVALID';
  END IF;

  -- 3-4. Syntactic support, then the PostgreSQL-authoritative fingerprint over the exact applicability pin, outcome and
  --      temporal intent (the mirrored tuple is a function of the immutable pinned state and is not re-framed).
  v_support := gov_repo.l14_support_syntactic_parts_v1(p_support_status, p_support_evidence_ids);
  v_fingerprint := gov_repo.l14_sha256_frame_v1(
    ARRAY['L14_COMMAND_FINGERPRINT_V1', 'SUBMIT_PROPOSAL', v_org::text, v_actor::text, 'CONTROL_ASSESSMENT', p_intent,
          p_source_class, p_control_applicability_state_id::text, p_assessment_outcome]
    || CASE WHEN p_requested_effective_from IS NULL THEN ARRAY['IMMEDIATE']
            ELSE ARRAY['EXPLICIT', gov_repo.l14_canonical_instant_v1(p_requested_effective_from)] END
    || CASE WHEN p_requested_valid_until IS NULL THEN ARRAY['NO_VALID_UNTIL']
            ELSE ARRAY['VALID_UNTIL', gov_repo.l14_canonical_instant_v1(p_requested_valid_until)] END
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
  PERFORM gov_repo.l14_lock_fact_subject_guard_v1(v_org, 'CONTROL_ASSESSMENT',
    ARRAY['KEY', p_control_applicability_state_id::text]);
  PERFORM gov_repo.l14_lock_command_guard_v1(v_org, p_command_id);
  IF gov_repo.l14_replay_arbitrate_v1(v_org, p_command_id, v_fingerprint) THEN
    PERFORM 1 FROM gov_repo.l14_session_basis_v1(v_org, v_actor, p_verified_session_iat,
      p_verified_session_exp, p_verified_credential_epoch);
    RETURN QUERY SELECT * FROM gov_repo.l14_control_assessment_command_result_v1(v_org, p_command_id, true);
    RETURN;
  END IF;

  -- 8. Tenant / reference / support resolution. The pinned applicability is an exact S1C.4 state of THIS organisation (a
  --    foreign or unknown state is indistinguishable); it must be a VALIDATED APPLIES state (never DOES_NOT_APPLY, never a
  --    REVOKED tombstone). Whether it is still the valid applicability is decided ONLY at DECIDE VALIDATE, under the shared
  --    dependency guards. Its immutable tuple is copied, never supplied.
  SELECT a.state_kind, a.applicability, a.target_key, a.control_definition_id, a.control_definition_version_id,
         a.content_hash, a.control_definition_validated_state_id
  INTO v_applicability
  FROM gov_repo.l14_control_applicability_states AS a
  WHERE a.organisation_id = v_org AND a.fact_state_id = p_control_applicability_state_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'CONTROL_APPLICABILITY_STATE_UNRESOLVED';
  END IF;
  IF v_applicability.state_kind <> 'VALIDATED' THEN
    RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'CONTROL_APPLICABILITY_STATE_NOT_VALIDATED';
  END IF;
  IF v_applicability.applicability <> 'APPLIES' THEN
    RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'CONTROL_APPLICABILITY_DOES_NOT_APPLY';
  END IF;
  IF p_intent = 'REVOKE' THEN
    SELECT s.state_kind, s.control_applicability_state_id, s.assessment_outcome
    INTO v_target
    FROM gov_repo.l14_control_assessment_states AS s
    WHERE s.organisation_id = v_org AND s.fact_state_id = p_target_state_id;
    IF NOT FOUND OR v_target.control_applicability_state_id <> p_control_applicability_state_id THEN
      RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'TARGET_STATE_UNRESOLVED';
    END IF;
    IF v_target.state_kind <> 'VALIDATED' THEN
      RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'TARGET_STATE_NOT_VALIDATED';
    END IF;
    IF v_target.assessment_outcome <> p_assessment_outcome THEN
      RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'CONTROL_ASSESSMENT_TARGET_STATE_MISMATCH';
    END IF;
    PERFORM 1 FROM gov_repo.l14_fact_states AS r
    WHERE r.organisation_id = v_org AND r.state_kind = 'REVOKED' AND r.revokes_state_id = p_target_state_id;
    IF FOUND THEN
      RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'TARGET_ALREADY_REVOKED';
    END IF;
    SELECT h.latest_state_id INTO v_latest
    FROM gov_repo.l14_control_assessment_heads AS h
    WHERE h.organisation_id = v_org AND h.control_applicability_state_id = p_control_applicability_state_id;
    IF v_latest IS DISTINCT FROM p_target_state_id THEN
      RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'TARGET_STATE_NOT_CURRENT';
    END IF;
  END IF;
  IF p_prior_proposal_id IS NOT NULL THEN
    PERFORM 1 FROM gov_repo.l14_control_assessment_proposals AS rp
    WHERE rp.organisation_id = v_org AND rp.proposal_id = p_prior_proposal_id
      AND rp.control_applicability_state_id = p_control_applicability_state_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'PRIOR_PROPOSAL_UNRESOLVED';
    END IF;
  END IF;
  PERFORM gov_repo.l14_resolve_support_v1(v_org, p_support_evidence_ids);

  -- 9. Envelope + typed detail + support + durable result. Nothing else.
  v_now := pg_catalog.clock_timestamp();
  INSERT INTO gov_repo.l14_proposals (organisation_id, proposal_id, subject_kind, intent, source_class,
    submitted_by_actor_user_id, prior_proposal_id, support_status, submitted_at)
  VALUES (v_org, v_proposal, 'CONTROL_ASSESSMENT', p_intent, p_source_class, v_actor, p_prior_proposal_id,
    p_support_status, v_now);
  INSERT INTO gov_repo.l14_control_assessment_proposals (organisation_id, proposal_id, subject_kind, intent,
    control_applicability_state_id, applicability_target_key, control_definition_id, control_definition_version_id,
    content_hash, control_definition_validated_state_id, applicability, applicability_state_kind, assessment_outcome,
    requested_effective_from, requested_valid_until, target_state_id)
  VALUES (v_org, v_proposal, 'CONTROL_ASSESSMENT', p_intent, p_control_applicability_state_id, v_applicability.target_key,
    v_applicability.control_definition_id, v_applicability.control_definition_version_id, v_applicability.content_hash,
    v_applicability.control_definition_validated_state_id, 'APPLIES', 'VALIDATED', p_assessment_outcome,
    p_requested_effective_from, p_requested_valid_until, p_target_state_id);
  INSERT INTO gov_repo.l14_support_links (organisation_id, support_link_id, owner_kind, proposal_id, evidence_id)
  SELECT v_org, pg_catalog.gen_random_uuid(), 'PROPOSAL', v_proposal, i.id
  FROM pg_catalog.unnest(p_support_evidence_ids) AS i(id);
  INSERT INTO gov_repo.l14_command_results (organisation_id, command_id, command_kind, subject_kind,
    command_fingerprint, actor_user_id, outcome, proposal_id, recorded_at)
  VALUES (v_org, p_command_id, 'SUBMIT_PROPOSAL', 'CONTROL_ASSESSMENT', v_fingerprint, v_actor, 'SUBMITTED',
    v_proposal, v_now);

  PERFORM 1 FROM gov_repo.l14_session_basis_v1(v_org, v_actor, p_verified_session_iat,
    p_verified_session_exp, p_verified_credential_epoch);
  RETURN QUERY SELECT * FROM gov_repo.l14_control_assessment_command_result_v1(v_org, p_command_id, false);
END;
$submit_control_assessment$;

-- ---------------------------------------------------------------------------------------
-- F2. RPC — governance decision on a CONTROL_ASSESSMENT proposal. VALIDATE intent: VALIDATE / REJECT / DEFER. REVOKE
--     intent: REVOKE / REJECT / DEFER. DEFER is nonterminal. Authority = L14_CONTROL_ASSESSMENT_VALIDATE with requested
--     action = the exact outcome, evaluated over the exact target OF THE PINNED APPLICABILITY STATE (never changing the
--     pin; CANONICAL_OBJECT: the S1C.1 object evaluator; RELATIONSHIP_STATE: the S1C.3 relationship-state evaluator; both
--     reused unchanged). A VALIDATE whose key already has a head is a renewal / correction (append a successor; the
--     predecessor row is never touched).
-- ---------------------------------------------------------------------------------------
CREATE FUNCTION gov_repo.l14_decide_control_assessment_proposal_v1(
  p_verified_organisation_id uuid,
  p_verified_actor_user_id uuid,
  p_verified_session_iat bigint,
  p_verified_session_exp bigint,
  p_verified_credential_epoch timestamptz,
  p_command_id text,
  p_proposal_id uuid,
  p_outcome text,
  p_reason_code text,
  p_expected_current_state_id uuid,             -- NULL = explicit expected-none (no assessment of the applicability state yet)
  p_support_status text,
  p_support_evidence_ids text[],
  p_caller_fingerprint text                     -- assertion only; PostgreSQL recomputes
)
RETURNS TABLE (
  replay boolean, command_id text, command_kind text, subject_kind text, outcome text, command_fingerprint text,
  authorization_decision_id uuid, authorization_result text, deny_reason text, expectation_kind text,
  expected_current_state_id uuid, proposal_id uuid, governance_decision_id uuid, control_applicability_state_id uuid,
  control_definition_id uuid, control_definition_version_id uuid, content_hash text, assessment_outcome text,
  fact_state_id uuid, state_kind text, predecessor_state_id uuid, effective_from timestamptz, valid_until timestamptz,
  recorded_at timestamptz
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
SET lock_timeout = '5s'
AS $decide_control_assessment$
#variable_conflict use_column
DECLARE
  v_org uuid := p_verified_organisation_id;
  v_actor uuid := p_verified_actor_user_id;
  v_role_ids uuid[];
  v_support text[];
  v_fingerprint text;
  v_proposal record;
  v_applicability record;
  v_rel record;
  v_relationship_type text;
  v_head_found boolean;
  v_head_latest uuid;
  v_latest_kind text;
  v_latest_from timestamptz;
  v_latest_to timestamptz;
  v_latest_outcome text;
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
       'CONTROL_ASSESSMENT_VALIDATED','CONTROL_ASSESSMENT_REJECTED','CONTROL_ASSESSMENT_DEFERRED',
       'CONTROL_ASSESSMENT_REVOKED')
     OR NOT ((p_outcome = 'VALIDATE' AND p_reason_code = 'CONTROL_ASSESSMENT_VALIDATED')
          OR (p_outcome = 'REJECT' AND p_reason_code = 'CONTROL_ASSESSMENT_REJECTED')
          OR (p_outcome = 'DEFER' AND p_reason_code = 'CONTROL_ASSESSMENT_DEFERRED')
          OR (p_outcome = 'REVOKE' AND p_reason_code = 'CONTROL_ASSESSMENT_REVOKED')) THEN
    RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'DECISION_VOCABULARY_INVALID';
  END IF;
  -- The immutable proposal defines the command identity (fingerprint + guard keys); it is the only row read before
  -- replay arbitration, and it can never change or disappear.
  SELECT p.proposal_id, p.intent, p.source_class, p.submitted_by_actor_user_id,
         t.control_applicability_state_id, t.applicability_target_key, t.control_definition_id,
         t.control_definition_version_id, t.content_hash::text AS content_hash, t.control_definition_validated_state_id,
         t.assessment_outcome, t.requested_effective_from, t.requested_valid_until, t.target_state_id
  INTO v_proposal
  FROM gov_repo.l14_proposals AS p
  JOIN gov_repo.l14_control_assessment_proposals AS t
    ON t.organisation_id = p.organisation_id AND t.proposal_id = p.proposal_id
  WHERE p.organisation_id = v_org AND p.proposal_id = p_proposal_id AND p.subject_kind = 'CONTROL_ASSESSMENT';
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
          v_proposal.proposal_id::text, 'CONTROL_ASSESSMENT', v_proposal.intent, v_proposal.source_class,
          v_proposal.control_applicability_state_id::text, v_proposal.assessment_outcome]
    || CASE WHEN v_proposal.requested_effective_from IS NULL THEN ARRAY['IMMEDIATE']
            ELSE ARRAY['EXPLICIT', gov_repo.l14_canonical_instant_v1(v_proposal.requested_effective_from)] END
    || CASE WHEN v_proposal.requested_valid_until IS NULL THEN ARRAY['NO_VALID_UNTIL']
            ELSE ARRAY['VALID_UNTIL', gov_repo.l14_canonical_instant_v1(v_proposal.requested_valid_until)] END
    || CASE WHEN v_proposal.target_state_id IS NULL THEN ARRAY['NO_TARGET_STATE']
            ELSE ARRAY['TARGET_STATE', v_proposal.target_state_id::text] END
    || CASE WHEN p_expected_current_state_id IS NULL THEN ARRAY['EXPECTED_NONE']
            ELSE ARRAY['EXPECTED_CURRENT', p_expected_current_state_id::text] END
    || v_support);
  IF v_fingerprint IS DISTINCT FROM p_caller_fingerprint THEN
    RAISE EXCEPTION 'L14_FINGERPRINT_MISMATCH' USING ERRCODE = 'GV008', DETAIL = 'CALLER_FINGERPRINT_DIFFERS';
  END IF;

  -- 5-7. Guards in the fixed order: AP SHARED -> (VALIDATE only) exact CONTROL_DEFINITION registry subject guard SHARED
  --      (S1B.6 key) -> exact CONTROL_APPLICABILITY fact KEY guard SHARED (S1C.4 key) -> exact CONTROL_ASSESSMENT fact
  --      KEY -> command; then replay arbitration BEFORE any resolution. REVOKE / REJECT / DEFER never wait on a dependency
  --      (explicit cleanup stays possible).
  PERFORM gov_repo.l14_lock_authority_policy_guard_shared_v1(v_org);
  IF p_outcome = 'VALIDATE' THEN
    PERFORM gov_repo.l14_lock_control_definition_dependency_guard_shared_v1(v_org, v_proposal.control_definition_id,
      v_proposal.control_definition_version_id, v_proposal.content_hash);
    PERFORM gov_repo.l14_lock_control_applicability_dependency_guard_shared_v1(v_org, v_proposal.applicability_target_key,
      v_proposal.control_definition_id);
  END IF;
  PERFORM gov_repo.l14_lock_fact_subject_guard_v1(v_org, 'CONTROL_ASSESSMENT',
    ARRAY['KEY', v_proposal.control_applicability_state_id::text]);
  PERFORM gov_repo.l14_lock_command_guard_v1(v_org, p_command_id);
  IF gov_repo.l14_replay_arbitrate_v1(v_org, p_command_id, v_fingerprint) THEN
    PERFORM 1 FROM gov_repo.l14_session_basis_v1(v_org, v_actor, p_verified_session_iat,
      p_verified_session_exp, p_verified_credential_epoch);
    RETURN QUERY SELECT * FROM gov_repo.l14_control_assessment_command_result_v1(v_org, p_command_id, true);
    RETURN;
  END IF;

  -- 8. Resolution (all under the guards): terminality, the pinned applicability's exact target (authority scope only;
  --    never re-pinned), head expectation, per-key lineage rules.
  PERFORM 1 FROM gov_repo.l14_governance_decisions AS d
  WHERE d.organisation_id = v_org AND d.proposal_id = p_proposal_id AND d.outcome IN ('VALIDATE','REJECT','REVOKE');
  IF FOUND THEN
    RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'PROPOSAL_TERMINAL';
  END IF;
  SELECT a.target_type, a.target_canonical_kind, a.target_canonical_object_id, a.target_relationship_id,
         a.target_relationship_state_id
  INTO v_applicability
  FROM gov_repo.l14_control_applicability_states AS a
  WHERE a.organisation_id = v_org AND a.fact_state_id = v_proposal.control_applicability_state_id;
  IF v_applicability.target_type = 'CANONICAL_OBJECT' THEN
    PERFORM 1 FROM gov_repo.canonical_objects AS o
    WHERE o.organisation_id = v_org AND o.canonical_object_id = v_applicability.target_canonical_object_id
      AND o.kind = v_applicability.target_canonical_kind;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'TARGET_OBJECT_UNRESOLVED';
    END IF;
  ELSE
    SELECT r.match_count, r.relationship_type INTO v_rel
    FROM gov_repo.l14_resolve_relationship_state_target_v1(v_org, v_applicability.target_relationship_id,
      v_applicability.target_relationship_state_id) AS r;
    IF v_rel.match_count = 0 THEN
      RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'TARGET_RELATIONSHIP_STATE_UNRESOLVED';
    END IF;
    IF v_rel.match_count <> 1 THEN
      RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'TARGET_RELATIONSHIP_STATE_AMBIGUOUS';
    END IF;
    v_relationship_type := v_rel.relationship_type;
  END IF;
  -- No head row = no assessment of this exact applicability state yet (created by the first state-appending decision).
  SELECT h.latest_state_id INTO v_head_latest
  FROM gov_repo.l14_control_assessment_heads AS h
  WHERE h.organisation_id = v_org AND h.control_applicability_state_id = v_proposal.control_applicability_state_id;
  v_head_found := FOUND;
  IF p_expected_current_state_id IS NULL AND v_head_latest IS NOT NULL THEN
    RAISE EXCEPTION 'L14_STALE_EXPECTATION' USING ERRCODE = 'GV009', DETAIL = 'CONTROL_ASSESSMENT_STATE_EXISTS';
  END IF;
  IF p_expected_current_state_id IS DISTINCT FROM v_head_latest THEN
    RAISE EXCEPTION 'L14_STALE_EXPECTATION' USING ERRCODE = 'GV009', DETAIL = 'CONTROL_ASSESSMENT_STATE_EXPECTATION_MISMATCH';
  END IF;
  IF v_head_latest IS NOT NULL THEN
    SELECT s.state_kind, s.effective_from, s.effective_to, d.assessment_outcome
    INTO v_latest_kind, v_latest_from, v_latest_to, v_latest_outcome
    FROM gov_repo.l14_fact_states AS s
    JOIN gov_repo.l14_control_assessment_states AS d
      ON d.organisation_id = s.organisation_id AND d.fact_state_id = s.fact_state_id
    WHERE s.organisation_id = v_org AND s.fact_state_id = v_head_latest;
  END IF;
  IF p_outcome = 'VALIDATE' AND v_latest_kind = 'VALIDATED' AND v_latest_outcome = v_proposal.assessment_outcome
     AND v_latest_to = v_proposal.requested_valid_until THEN
    -- A renewal / correction must change something: another outcome or another valid_until.
    RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'CONTROL_ASSESSMENT_ALREADY_VALIDATED';
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
  --    evaluated over the exact typed target of the pinned applicability state.
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
      v_effective_to := v_proposal.requested_valid_until;
    END IF;
  END IF;
  v_self := v_proposal.submitted_by_actor_user_id = v_actor;
  SELECT b.authority_policy_id, b.version_id, b.content_hash INTO v_basis_policy, v_basis_version, v_basis_hash
  FROM gov_repo.l14_effective_authority_basis_v1(v_org, v_now) AS b;
  v_has_basis := FOUND;
  IF NOT v_has_basis THEN
    v_deny := 'NO_EFFECTIVE_AUTHORITY';
  ELSIF v_applicability.target_type = 'CANONICAL_OBJECT' THEN
    SELECT e.deny_reason, e.rule_ordinals INTO v_deny, v_ordinals
    FROM gov_repo.l14_evaluate_target_authority_rules_v1(v_org, v_basis_policy, v_basis_version, v_role_ids,
      'L14_CONTROL_ASSESSMENT_VALIDATE', p_outcome, p_outcome = 'VALIDATE' AND v_self, v_temporal,
      v_applicability.target_canonical_kind, v_applicability.target_canonical_object_id) AS e;
  ELSE
    SELECT e.deny_reason, e.rule_ordinals INTO v_deny, v_ordinals
    FROM gov_repo.l14_evaluate_relationship_state_authority_rules_v1(v_org, v_basis_policy, v_basis_version, v_role_ids,
      'L14_CONTROL_ASSESSMENT_VALIDATE', p_outcome, p_outcome = 'VALIDATE' AND v_self, v_temporal,
      v_relationship_type, v_applicability.target_relationship_id, v_applicability.target_relationship_state_id) AS e;
  END IF;

  INSERT INTO gov_repo.l14_authorization_decisions (
    organisation_id, authorization_decision_id, command_id, command_fingerprint, actor_user_id,
    requested_action, subject_kind, scope_tag, target_canonical_kind, target_canonical_object_id,
    target_relationship_type, target_relationship_id, target_relationship_state_id, source_class,
    proposal_id, is_self_validation, authority_basis, basis_authority_policy_id, basis_version_id, basis_content_hash,
    result, deny_reason, evaluated_at, expectation_kind, expected_current_state_id)
  VALUES (
    v_org, v_authz, p_command_id, v_fingerprint, v_actor,
    p_outcome, 'CONTROL_ASSESSMENT', v_applicability.target_type, v_applicability.target_canonical_kind,
    v_applicability.target_canonical_object_id, v_relationship_type, v_applicability.target_relationship_id,
    v_applicability.target_relationship_state_id, v_proposal.source_class, p_proposal_id, v_self,
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
    VALUES (v_org, p_command_id, 'DECIDE_PROPOSAL', 'CONTROL_ASSESSMENT', v_fingerprint, v_actor, 'DENIED', v_authz,
      p_proposal_id, v_now);
  ELSE
    -- 10. Interval and dependency rules (authorized commands only; a violation raises and rolls back the WHOLE command:
    --     nothing is consumed).
    IF p_outcome = 'VALIDATE' AND NOT (v_effective_to > v_effective_from) THEN
      -- valid_until is mandatory and strictly later than the effective start (incl. an IMMEDIATE start).
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
    -- Renewal / correction (same applicability state, another outcome / valid_until): never before the predecessor's
    -- start; it may begin before the predecessor's valid_until (the predecessor's closure is derived from it).
    IF p_outcome = 'VALIDATE' AND v_latest_kind = 'VALIDATED' AND v_effective_from < v_latest_from THEN
      RAISE EXCEPTION 'L14_CONTINUITY_VIOLATION' USING ERRCODE = 'GV011', DETAIL = 'SUCCESSOR_BEFORE_PREDECESSOR_EFFECTIVE';
    END IF;
    IF p_outcome = 'VALIDATE' AND NOT EXISTS (
         SELECT 1 FROM gov_repo.l14_control_applicability_valid_state_v1(v_org, v_applicability.target_type,
           v_applicability.target_canonical_kind, v_applicability.target_canonical_object_id,
           v_applicability.target_relationship_id, v_applicability.target_relationship_state_id,
           v_proposal.control_definition_id, v_effective_from, v_now) AS ca
         WHERE ca.fact_state_id = v_proposal.control_applicability_state_id AND ca.applicability = 'APPLIES') THEN
      -- The exact pinned applicability must be THE valid APPLIES state of its own key at the requested effective instant,
      -- as known now, under the shared dependency guards (a revoked, superseded, expired, not-yet-effective, target- or
      -- CONTROL_DEFINITION-invalid applicability never validates an assessment; no successor is ever selected instead).
      RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'CONTROL_APPLICABILITY_DEPENDENCY_NOT_VALID';
    END IF;

    INSERT INTO gov_repo.l14_governance_decisions (organisation_id, governance_decision_id, proposal_id,
      subject_kind, outcome, reason_code, authorization_decision_id, actor_user_id, support_status, decided_at)
    VALUES (v_org, v_decision, p_proposal_id, 'CONTROL_ASSESSMENT', p_outcome, p_reason_code, v_authz, v_actor,
      p_support_status, v_now);
    INSERT INTO gov_repo.l14_support_links (organisation_id, support_link_id, owner_kind, governance_decision_id, evidence_id)
    SELECT v_org, pg_catalog.gen_random_uuid(), 'GOVERNANCE_DECISION', v_decision, i.id
    FROM pg_catalog.unnest(p_support_evidence_ids) AS i(id);

    IF p_outcome IN ('VALIDATE','REVOKE') THEN
      v_state_kind := CASE WHEN p_outcome = 'VALIDATE' THEN 'VALIDATED' ELSE 'REVOKED' END;
      -- Append-only: predecessor = the expected head state (renewal, correction, revalidation or revocation target);
      -- the predecessor row is never modified — its closure is derived from this successor by the resolver.
      INSERT INTO gov_repo.l14_fact_states (organisation_id, fact_state_id, subject_kind, state_kind,
        predecessor_state_id, revokes_state_id, effective_from, effective_to, recorded_at, governance_decision_id,
        authorization_decision_id, authority_policy_id, authority_policy_version_id, authority_policy_content_hash,
        trust_state, source_class, support_status)
      VALUES (v_org, v_state, 'CONTROL_ASSESSMENT', v_state_kind, v_head_latest, v_target_state_id,
        v_effective_from, v_effective_to, v_now, v_decision, v_authz, v_basis_policy, v_basis_version, v_basis_hash,
        'VALIDATED', v_proposal.source_class, p_support_status);
      INSERT INTO gov_repo.l14_control_assessment_states (organisation_id, fact_state_id, subject_kind, state_kind,
        control_applicability_state_id, applicability_target_key, control_definition_id, control_definition_version_id,
        content_hash, control_definition_validated_state_id, applicability, applicability_state_kind, assessment_outcome,
        predecessor_state_id, revokes_state_id)
      VALUES (v_org, v_state, 'CONTROL_ASSESSMENT', v_state_kind, v_proposal.control_applicability_state_id,
        v_proposal.applicability_target_key, v_proposal.control_definition_id, v_proposal.control_definition_version_id,
        v_proposal.content_hash, v_proposal.control_definition_validated_state_id, 'APPLIES', 'VALIDATED',
        v_proposal.assessment_outcome, v_head_latest, v_target_state_id);
      -- Technical head: created empty on the first state of the key, then compare-and-set on the exact expectation.
      IF NOT v_head_found THEN
        INSERT INTO gov_repo.l14_control_assessment_heads (organisation_id, control_applicability_state_id, latest_state_id)
        VALUES (v_org, v_proposal.control_applicability_state_id, NULL);
      END IF;
      UPDATE gov_repo.l14_control_assessment_heads AS h SET latest_state_id = v_state
      WHERE h.organisation_id = v_org AND h.control_applicability_state_id = v_proposal.control_applicability_state_id
        AND h.latest_state_id IS NOT DISTINCT FROM p_expected_current_state_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'L14_STALE_EXPECTATION' USING ERRCODE = 'GV009', DETAIL = 'CONTROL_ASSESSMENT_STATE_EXPECTATION_MISMATCH';
      END IF;
      INSERT INTO gov_repo.l14_support_links (organisation_id, support_link_id, owner_kind, fact_state_id, evidence_id)
      SELECT v_org, pg_catalog.gen_random_uuid(), 'FACT_STATE', v_state, i.id
      FROM pg_catalog.unnest(p_support_evidence_ids) AS i(id);
      INSERT INTO gov_repo.l14_command_results (organisation_id, command_id, command_kind, subject_kind,
        command_fingerprint, actor_user_id, outcome, authorization_decision_id, proposal_id, governance_decision_id,
        fact_state_id, recorded_at)
      VALUES (v_org, p_command_id, 'DECIDE_PROPOSAL', 'CONTROL_ASSESSMENT', v_fingerprint, v_actor, v_state_kind,
        v_authz, p_proposal_id, v_decision, v_state, v_now);
    ELSE
      -- REJECT / DEFER: governance decision only; no fact, no head change.
      INSERT INTO gov_repo.l14_command_results (organisation_id, command_id, command_kind, subject_kind,
        command_fingerprint, actor_user_id, outcome, authorization_decision_id, proposal_id, governance_decision_id,
        recorded_at)
      VALUES (v_org, p_command_id, 'DECIDE_PROPOSAL', 'CONTROL_ASSESSMENT', v_fingerprint, v_actor,
        CASE WHEN p_outcome = 'REJECT' THEN 'REJECTED' ELSE 'DEFERRED' END, v_authz, p_proposal_id, v_decision, v_now);
    END IF;
  END IF;

  -- 11. Base session eligibility at commitment.
  PERFORM 1 FROM gov_repo.l14_session_basis_v1(v_org, v_actor, p_verified_session_iat,
    p_verified_session_exp, p_verified_credential_epoch);
  RETURN QUERY SELECT * FROM gov_repo.l14_control_assessment_command_result_v1(v_org, p_command_id, false);
END;
$decide_control_assessment$;

-- ---------------------------------------------------------------------------------------
-- G. Privileges. The hostile 20260818013113 defaults hand every new gov_repo table to service_role: removed. No
--    application role gets any privilege on the new tables. Exactly the two new RPCs are service_role-executable; every
--    helper / guard / resolver / read primitive stays owner-only (the replaced fact guard keeps its owner-only ACL; the
--    reused S1C.3 / S1C.4 helpers are untouched).
-- ---------------------------------------------------------------------------------------
ALTER TABLE gov_repo.l14_control_assessment_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE gov_repo.l14_control_assessment_proposals ENABLE ROW LEVEL SECURITY;
ALTER TABLE gov_repo.l14_control_assessment_heads ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE gov_repo.l14_control_assessment_states, gov_repo.l14_control_assessment_proposals,
  gov_repo.l14_control_assessment_heads
FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION
  gov_repo.l14_lock_fact_subject_guard_v1(uuid, text, text[]),
  gov_repo.l14_lock_control_applicability_dependency_guard_shared_v1(uuid, text, uuid),
  gov_repo.l14_control_assessment_proposal_guard_v1(),
  gov_repo.l14_control_assessment_state_guard_v1(),
  gov_repo.l14_control_assessment_head_guard_v1(),
  gov_repo.l14_control_assessment_command_result_v1(uuid, text, boolean),
  gov_repo.l14_control_assessment_valid_state_v1(uuid, uuid, timestamptz, timestamptz),
  gov_repo.l14_control_assessments_current_v1(uuid, text, text, text, text, text, timestamptz, timestamptz),
  gov_repo.l14_submit_control_assessment_proposal_v1(uuid, uuid, bigint, bigint, timestamptz, text, text, text, uuid, text, timestamptz, timestamptz, uuid, uuid, text, text[], text),
  gov_repo.l14_decide_control_assessment_proposal_v1(uuid, uuid, bigint, bigint, timestamptz, text, uuid, text, text, uuid, text, text[], text)
FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION
  gov_repo.l14_submit_control_assessment_proposal_v1(uuid, uuid, bigint, bigint, timestamptz, text, text, text, uuid, text, timestamptz, timestamptz, uuid, uuid, text, text[], text),
  gov_repo.l14_decide_control_assessment_proposal_v1(uuid, uuid, bigint, bigint, timestamptz, text, uuid, text, text, uuid, text, text[], text)
TO service_role;

COMMENT ON TABLE gov_repo.l14_fact_states IS 'M16-S1C.1 common immutable governed FACT-state envelope of exactly the five M16 fact families (RESPONSIBILITY_ASSIGNMENT since S1C.1, BUSINESS_CONTEXT_ASSIGNMENT since S1C.2, POLICY_APPLICABILITY since S1C.3, CONTROL_APPLICABILITY since S1C.4 and CONTROL_ASSESSMENT since S1C.5; CONTROL_FINDING is never a family): VALIDATED/REVOKED, lineage predecessor, exact revocation target, effective_from, immutable explicit effective_to fixed at creation (VALIDATED only; MANDATORY for CONTROL_ASSESSMENT, where it IS valid_until; a REVOKE never invents a second end), DB recorded_at, decision + authorization + Authority Policy basis lineage, trust, source, support status. Holds NO subject content. Distinct from l14_registry_states.';
COMMENT ON TABLE gov_repo.l14_control_assessment_states IS 'M16-S1C.5 immutable typed CONTROL_ASSESSMENT detail of l14_fact_states: exact fact key (organisation, control_applicability_state_id = one exact VALIDATED APPLIES S1C.4 state), the mirrored immutable S1C.4 tuple of that state (target key, control definition id + version id + DB content hash, pinned VALIDATED CONTROL_DEFINITION state; composite FK onto l14_control_applicability_states_kind_unique) and the closed outcome SATISFIED | PARTIALLY_SATISFIED | NOT_SATISFIED | NOT_ASSESSED | INSUFFICIENT_EVIDENCE (no WAIVED). valid_until is the envelope effective_to (mandatory). Renewals / corrections are lineage successors of the same key; predecessor closure is derived, never stored; never transferred to another applicability state. Not a waiver, score, coverage, risk decision, cg_* flag or inference.';
COMMENT ON TABLE gov_repo.l14_control_assessment_proposals IS 'M16-S1C.5 immutable typed CONTROL_ASSESSMENT proposal: exact pinned VALIDATED APPLIES applicability state + its DB-resolved mirrored S1C.4 tuple, closed outcome, requested_effective_from (NULL = IMMEDIATE), MANDATORY requested_valid_until (VALIDATE only; becomes effective_to), target_state_id (REVOKE only, exact VALIDATED assessment of the same key + outcome). LOCAL_HUMAN only. No JSON, no rationale, no finding / score.';
COMMENT ON TABLE gov_repo.l14_control_assessment_heads IS 'M16-S1C.5 technical compare-and-set pointer only (latest assessment state of the exact fact key organisation + control_applicability_state_id; never a target / control pair, outcome or valid_until); created by the first state-appending decision, RPC-maintained, advanced only to the direct lineage successor; reconstructible from history; never authoritative and never overriding expiry.';
COMMENT ON COLUMN gov_repo.l14_command_results.fact_state_id IS 'M16-S1C.1 durable reference to the fact state a VALIDATED/REVOKED fact-family decision (RESPONSIBILITY_ASSIGNMENT, BUSINESS_CONTEXT_ASSIGNMENT, POLICY_APPLICABILITY, CONTROL_APPLICABILITY, CONTROL_ASSESSMENT) produced (subject-exact FK); NULL for every S1A / S1B row and every other outcome.';
COMMENT ON FUNCTION gov_repo.l14_lock_fact_subject_guard_v1(uuid, text, text[]) IS 'M16-S1C.1 owner-only EXCLUSIVE fact guard keyed by frame_identity(organisation, fact subject kind, key parts); closed subjects = exactly the five fact families: RESPONSIBILITY_ASSIGNMENT (S1C.1: CARDINALITY then KEY), BUSINESS_CONTEXT_ASSIGNMENT (S1C.2: KEY = target + semantic kind), POLICY_APPLICABILITY (S1C.3: KEY = exact target key + policy), CONTROL_APPLICABILITY (S1C.4: KEY = exact target key + control definition) and CONTROL_ASSESSMENT (S1C.5: KEY = exact applicability state).';
COMMENT ON FUNCTION gov_repo.l14_lock_control_applicability_dependency_guard_shared_v1(uuid, text, uuid) IS 'M16-S1C.5 owner-only SHARED mode of the exact S1C.4 CONTROL_APPLICABILITY fact KEY guard key (l14-fact-subject-guard-v1 / CONTROL_APPLICABILITY / KEY / target key / control definition): an assessment VALIDATE serializes with every applicability decision on the pinned key (exclusive) and never with other assessments of it (shared); held to commit; no new lock namespace.';
COMMENT ON FUNCTION gov_repo.l14_control_assessment_valid_state_v1(uuid, uuid, timestamptz, timestamptz) IS 'M16-S1C.5 owner-only exact bitemporal CONTROL_ASSESSMENT resolver: the exact VALIDATED assessment of the exact applicability state valid at a business instant as known at a recorded cutoff (instant < mandatory valid_until; closure derived from a VISIBLE successor), only when the pinned applicability is exactly the valid APPLIES state of the S1C.4 resolver at the SAME coordinates; no row = UNKNOWN (never NOT_ASSESSED); never transferred to a successor applicability (O31, O40, O55).';
COMMENT ON FUNCTION gov_repo.l14_control_assessments_current_v1(uuid, text, text, text, text, text, timestamptz, timestamptz) IS 'M16-S1C.5 owner-only bounded current-assessment read of ONE exact target: for each control definition whose current applicability (S1C.4 read) is APPLIES, the current valid assessment of exactly that applicability state; absence = UNKNOWN; DOES_NOT_APPLY never yields a row; no aggregation, no score.';
COMMENT ON FUNCTION gov_repo.l14_control_assessment_command_result_v1(uuid, text, boolean) IS 'M16-S1C.5 owner-only durable CONTROL_ASSESSMENT command result projection (replay returns the original).';
COMMENT ON FUNCTION gov_repo.l14_submit_control_assessment_proposal_v1(uuid, uuid, bigint, bigint, timestamptz, text, text, text, uuid, text, timestamptz, timestamptz, uuid, uuid, text, text[], text) IS 'M16-S1C.5 service_role-only CONTROL_ASSESSMENT proposal submission by any verified active member (LOCAL_HUMAN only) over one exact VALIDATED APPLIES control applicability state + closed outcome (WAIVED refused) + mandatory valid_until; grants no authority, writes no authorization / decision / fact / head.';
COMMENT ON FUNCTION gov_repo.l14_decide_control_assessment_proposal_v1(uuid, uuid, bigint, bigint, timestamptz, text, uuid, text, text, uuid, text, text[], text) IS 'M16-S1C.5 service_role-only governance decision on a CONTROL_ASSESSMENT proposal (L14_CONTROL_ASSESSMENT_VALIDATE, requested action = exact governance outcome, scope = the exact target of the pinned applicability state, current roles, current effective Authority Policy, temporal permission); the pinned applicability must be the valid APPLIES state at the effective instant under the shared dependency guards; renewals / corrections append a successor (never an UPDATE).';

-- ---------------------------------------------------------------------------------------
-- H. Postflight over the EFFECTIVE post-S1C.5 catalog (after ALL grants, including the broad legacy defaults).
--    Self-contained and re-executable. Historical postflights keep their own horizon and are not altered.
-- ---------------------------------------------------------------------------------------
DO $postflight$
DECLARE
  v_facts CONSTANT regclass := 'gov_repo.l14_fact_states'::regclass;
  v_states CONSTANT regclass := 'gov_repo.l14_control_assessment_states'::regclass;
  v_proposals CONSTANT regclass := 'gov_repo.l14_control_assessment_proposals'::regclass;
  v_heads CONSTANT regclass := 'gov_repo.l14_control_assessment_heads'::regclass;
  v_new_tables CONSTANT oid[] := ARRAY['gov_repo.l14_control_assessment_states'::regclass::oid,
    'gov_repo.l14_control_assessment_proposals'::regclass::oid, 'gov_repo.l14_control_assessment_heads'::regclass::oid];
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
    'gov_repo.l14_policy_applicability_proposals'::regclass::oid, 'gov_repo.l14_policy_applicability_heads'::regclass::oid,
    'gov_repo.l14_control_applicability_states'::regclass::oid, 'gov_repo.l14_control_applicability_proposals'::regclass::oid,
    'gov_repo.l14_control_applicability_heads'::regclass::oid, 'gov_repo.l14_control_assessment_states'::regclass::oid,
    'gov_repo.l14_control_assessment_proposals'::regclass::oid, 'gov_repo.l14_control_assessment_heads'::regclass::oid];
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
  v_mutable_heads CONSTANT text[] := ARRAY['l14_authority_policy_heads','l14_business_context_assignment_heads',
    'l14_control_applicability_heads','l14_control_assessment_heads','l14_control_definition_heads','l14_domain_heads',
    'l14_governance_party_heads','l14_policy_applicability_heads','l14_policy_version_heads','l14_responsibility_assignment_heads'];
  v_public_l14 CONSTANT text[] := ARRAY[
    'l14_admit_authority_policy_version_v1','l14_admit_control_definition_version_v1','l14_admit_domain_v1',
    'l14_admit_governance_party_v1','l14_admit_governance_policy_v1','l14_admit_policy_version_v1',
    'l14_decide_authority_policy_proposal_v1','l14_decide_business_context_assignment_proposal_v1',
    'l14_decide_control_applicability_proposal_v1','l14_decide_control_assessment_proposal_v1',
    'l14_decide_control_definition_proposal_v1',
    'l14_decide_domain_proposal_v1','l14_decide_governance_party_proposal_v1','l14_decide_policy_applicability_proposal_v1',
    'l14_decide_policy_version_proposal_v1','l14_decide_responsibility_assignment_proposal_v1',
    'l14_read_policy_descriptors_v1','l14_submit_business_context_assignment_proposal_v1',
    'l14_submit_control_applicability_proposal_v1','l14_submit_control_assessment_proposal_v1',
    'l14_submit_control_definition_proposal_v1',
    'l14_submit_domain_proposal_v1','l14_submit_governance_party_proposal_v1','l14_submit_policy_applicability_proposal_v1',
    'l14_submit_policy_version_proposal_v1','l14_submit_proposal_v1','l14_submit_responsibility_assignment_proposal_v1'];
  v_new_rpcs CONSTANT text[] := ARRAY['l14_decide_control_assessment_proposal_v1','l14_submit_control_assessment_proposal_v1'];
  -- The nine new routines (the S1C.5 family) plus the widened S1C.1 fact guard.
  v_new_routines CONSTANT text[] := ARRAY[
    'l14_control_assessment_command_result_v1','l14_control_assessment_head_guard_v1',
    'l14_control_assessment_proposal_guard_v1','l14_control_assessment_state_guard_v1',
    'l14_control_assessment_valid_state_v1','l14_control_assessments_current_v1',
    'l14_decide_control_assessment_proposal_v1','l14_lock_control_applicability_dependency_guard_shared_v1',
    'l14_submit_control_assessment_proposal_v1'];
  v_privileges text[] := ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'];
  v_crypto name := (SELECT e.extnamespace::regnamespace::name FROM pg_catalog.pg_extension AS e WHERE e.extname = 'pgcrypto');
  v_vector name := (SELECT e.extnamespace::regnamespace::name FROM pg_catalog.pg_extension AS e WHERE e.extname = 'vector');
  v_outcomes CONSTANT text := 'CHECK ((assessment_outcome = ANY (ARRAY[''SATISFIED''::text, ''PARTIALLY_SATISFIED''::text, ''NOT_SATISFIED''::text, ''NOT_ASSESSED''::text, ''INSUFFICIENT_EVIDENCE''::text])))';
  v_pin_cols CONSTANT text[] := ARRAY['control_applicability_state_id:uuid','applicability_target_key:text',
    'control_definition_id:uuid','control_definition_version_id:uuid','content_hash:character(64)',
    'control_definition_validated_state_id:uuid','applicability:text','applicability_state_kind:text',
    'assessment_outcome:text'];
  v_dependency_key CONSTANT text := 'ARRAY[p_organisation_id::text, ''l14-fact-subject-guard-v1'', ''CONTROL_APPLICABILITY'', ''KEY'', p_target_key, p_control_definition_id::text]';
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

  -- H1. Exact l14 relation set (tables only; no views/sequences). No CONTROL_FINDING relation anywhere in gov_repo.
  IF (SELECT pg_catalog.array_agg(c.relname::text ORDER BY c.relname::text COLLATE "C")
      FROM pg_catalog.pg_class AS c
      WHERE c.relnamespace = 'gov_repo'::regnamespace AND c.relname LIKE 'l14\_%' ESCAPE '\'
        AND c.relkind IN ('r','p','v','m','S','f')) IS DISTINCT FROM v_expected_l14
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_class AS c WHERE c.relnamespace = 'gov_repo'::regnamespace
                AND c.relname LIKE 'l14\_%finding%' ESCAPE '\') THEN
    RAISE EXCEPTION 'M16_S1C5_POSTFLIGHT: unexpected l14 relation set';
  END IF;

  -- H2. Every l14 table + both reused stores: RLS-enabled ordinary table, zero non-owner / column / application
  --     privilege (incl. inherited), no JSON; immutable history; NO RLS policy on any guarded table (no permissive path).
  FOR v_rel IN
    SELECT c.oid, c.relname, c.relkind, c.relowner, c.relacl, c.relrowsecurity
    FROM pg_catalog.pg_class AS c
    WHERE c.relnamespace = 'gov_repo'::regnamespace AND (c.relname::text = ANY (v_expected_l14) OR c.oid = ANY (v_stores))
  LOOP
    IF v_rel.relkind <> 'r' OR NOT v_rel.relrowsecurity THEN
      RAISE EXCEPTION 'M16_S1C5_POSTFLIGHT: % must be an RLS-enabled ordinary table', v_rel.relname;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_catalog.aclexplode(COALESCE(v_rel.relacl, pg_catalog.acldefault('r', v_rel.relowner))) AS a
               WHERE a.grantee <> v_rel.relowner) THEN
      RAISE EXCEPTION 'M16_S1C5_POSTFLIGHT: % has a non-owner table grant', v_rel.relname;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_attribute AS att WHERE att.attrelid = v_rel.oid AND att.attacl IS NOT NULL) THEN
      RAISE EXCEPTION 'M16_S1C5_POSTFLIGHT: % has column-level grants', v_rel.relname;
    END IF;
    FOREACH v_role IN ARRAY v_app LOOP
      FOREACH v_privilege IN ARRAY v_privileges LOOP
        IF pg_catalog.has_table_privilege(v_role, v_rel.oid, v_privilege) THEN
          RAISE EXCEPTION 'M16_S1C5_POSTFLIGHT: % holds % on %', v_role, v_privilege, v_rel.relname;
        END IF;
      END LOOP;
      IF pg_catalog.has_any_column_privilege(v_role, v_rel.oid, 'SELECT, INSERT, UPDATE, REFERENCES') THEN
        RAISE EXCEPTION 'M16_S1C5_POSTFLIGHT: % holds a column privilege on %', v_role, v_rel.relname;
      END IF;
    END LOOP;
    IF v_rel.oid = ANY (v_guarded) AND EXISTS (SELECT 1 FROM pg_catalog.pg_policy AS pol WHERE pol.polrelid = v_rel.oid) THEN
      RAISE EXCEPTION 'M16_S1C5_POSTFLIGHT: % carries an RLS policy (no application access path may exist)', v_rel.relname;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_attribute AS att
               WHERE att.attrelid = v_rel.oid AND att.attnum > 0 AND NOT att.attisdropped
                 AND att.atttypid IN ('json'::regtype, 'jsonb'::regtype)) THEN
      RAISE EXCEPTION 'M16_S1C5_POSTFLIGHT: % has a JSON column', v_rel.relname;
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
      RAISE EXCEPTION 'M16_S1C5_POSTFLIGHT: % lacks ALWAYS raising BEFORE UPDATE/DELETE and TRUNCATE triggers', v_rel.relname;
    END IF;
  END LOOP;

  -- H3. New structures: exactly the pinned columns (no valid_until column besides the envelope effective_to, no rationale /
  --     finding / waiver / score / JSON / cg_*); every text column a closed vocabulary or a pinned single-column bound
  --     CHECK; the exact closed outcome (no WAIVED); the pinned applicability is APPLIES + VALIDATED; the head key EXACTLY
  --     organisation + applicability state; the fact envelope subject EXACTLY the five families; the structural guards
  --     ALWAYS; the exact non-cascading FK set (incl. the applicability FK onto the S1C.4 pin key) and NO FK onto F2.
  IF (SELECT pg_catalog.array_agg(att.attname::text || ':' || pg_catalog.format_type(att.atttypid, att.atttypmod) ORDER BY att.attnum)
      FROM pg_catalog.pg_attribute AS att WHERE att.attrelid = v_states AND att.attnum > 0 AND NOT att.attisdropped)
     IS DISTINCT FROM ARRAY['organisation_id:uuid','fact_state_id:uuid','subject_kind:text','state_kind:text']
       || v_pin_cols || ARRAY['predecessor_state_id:uuid','revokes_state_id:uuid','revoked_state_kind:text']
     OR (SELECT pg_catalog.array_agg(att.attname::text || ':' || pg_catalog.format_type(att.atttypid, att.atttypmod) ORDER BY att.attnum)
      FROM pg_catalog.pg_attribute AS att WHERE att.attrelid = v_proposals AND att.attnum > 0 AND NOT att.attisdropped)
     IS DISTINCT FROM ARRAY['organisation_id:uuid','proposal_id:uuid','subject_kind:text','intent:text']
       || v_pin_cols || ARRAY['requested_effective_from:timestamp with time zone',
       'requested_valid_until:timestamp with time zone','target_state_id:uuid','target_state_kind:text']
     OR (SELECT pg_catalog.array_agg(att.attname::text || ':' || pg_catalog.format_type(att.atttypid, att.atttypmod) ORDER BY att.attnum)
      FROM pg_catalog.pg_attribute AS att WHERE att.attrelid = v_heads AND att.attnum > 0 AND NOT att.attisdropped)
     IS DISTINCT FROM ARRAY['organisation_id:uuid','control_applicability_state_id:uuid','latest_state_id:uuid'] THEN
    RAISE EXCEPTION 'M16_S1C5_POSTFLIGHT: S1C.5 structure columns are not exactly the pinned set';
  END IF;
  IF (SELECT pg_catalog.array_agg(att.attname::text ORDER BY k.ord)
      FROM pg_catalog.pg_constraint AS c
      CROSS JOIN LATERAL pg_catalog.unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord)
      JOIN pg_catalog.pg_attribute AS att ON att.attrelid = c.conrelid AND att.attnum = k.attnum
      WHERE c.conrelid = v_heads AND c.contype = 'p') IS DISTINCT FROM ARRAY['organisation_id','control_applicability_state_id']::text[]
     OR (SELECT pg_catalog.count(*) FROM pg_catalog.pg_index AS i WHERE i.indrelid = v_heads) <> 1 THEN
    RAISE EXCEPTION 'M16_S1C5_POSTFLIGHT: the control-assessment head key must be exactly organisation + applicability state';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_attribute AS att
             WHERE att.attrelid = ANY (v_new_tables) AND att.attnum > 0 AND NOT att.attisdropped
               AND att.atttypid IN ('text'::regtype, 'bpchar'::regtype, 'varchar'::regtype)
               AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint AS k
                               WHERE k.conrelid = att.attrelid AND k.contype = 'c' AND k.conkey = ARRAY[att.attnum]::int2[])) THEN
    RAISE EXCEPTION 'M16_S1C5_POSTFLIGHT: an S1C.5 text column is not a closed vocabulary / pinned bound';
  END IF;
  IF (SELECT pg_catalog.count(*) FROM pg_catalog.pg_constraint AS k
      WHERE k.contype = 'c' AND k.conrelid IN (v_states, v_proposals)
        AND k.conkey = ARRAY[(SELECT att.attnum FROM pg_catalog.pg_attribute AS att WHERE att.attrelid = k.conrelid AND att.attname = 'assessment_outcome')]::int2[]
        AND pg_catalog.pg_get_constraintdef(k.oid) = v_outcomes) <> 2
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_constraint AS k
                WHERE k.contype = 'c' AND k.conrelid IN (v_states, v_proposals)
                  AND k.conkey = ARRAY[(SELECT att.attnum FROM pg_catalog.pg_attribute AS att WHERE att.attrelid = k.conrelid AND att.attname = 'assessment_outcome')]::int2[]
                  AND pg_catalog.pg_get_constraintdef(k.oid) <> v_outcomes)
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_constraint AS k
                WHERE k.contype = 'c' AND (k.conrelid = ANY (v_new_tables) OR k.conrelid = v_facts)
                  AND pg_catalog.pg_get_constraintdef(k.oid) ~ '(WAIVED|CONTROL_FINDING)')
     OR (SELECT pg_catalog.count(*) FROM pg_catalog.pg_constraint AS k
      WHERE k.contype = 'c' AND k.conrelid IN (v_states, v_proposals)
        AND pg_catalog.pg_get_constraintdef(k.oid) = 'CHECK ((applicability = ''APPLIES''::text))') <> 2
     OR (SELECT pg_catalog.count(*) FROM pg_catalog.pg_constraint AS k
      WHERE k.contype = 'c' AND k.conrelid IN (v_states, v_proposals)
        AND pg_catalog.pg_get_constraintdef(k.oid) = 'CHECK ((applicability_state_kind = ''VALIDATED''::text))') <> 2
     OR (SELECT pg_catalog.count(*) FROM pg_catalog.pg_constraint AS k
      WHERE k.contype = 'c' AND k.conrelid IN (v_states, v_proposals)
        AND pg_catalog.pg_get_constraintdef(k.oid) = 'CHECK ((subject_kind = ''CONTROL_ASSESSMENT''::text))') <> 2
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint AS k WHERE k.conrelid = v_proposals AND k.contype = 'c'
                      AND k.conname = 'l14_control_assessment_proposals_target_check'
                      AND pg_catalog.pg_get_constraintdef(k.oid) = 'CHECK ((((intent = ''VALIDATE''::text) AND (target_state_id IS NULL) AND (requested_valid_until IS NOT NULL)) OR ((intent = ''REVOKE''::text) AND (target_state_id IS NOT NULL) AND (requested_valid_until IS NULL))))')
     OR (SELECT pg_catalog.count(*) FROM pg_catalog.pg_constraint AS k WHERE k.conrelid = v_facts AND k.contype = 'c'
           AND k.conkey = ARRAY[(SELECT att.attnum FROM pg_catalog.pg_attribute AS att WHERE att.attrelid = v_facts AND att.attname = 'subject_kind')]::int2[])
         <> 1
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint AS k WHERE k.conrelid = v_facts AND k.contype = 'c'
                      AND k.conname = 'l14_fact_states_subject_kind_check'
                      AND pg_catalog.pg_get_constraintdef(k.oid) = 'CHECK ((subject_kind = ANY (ARRAY[''RESPONSIBILITY_ASSIGNMENT''::text, ''BUSINESS_CONTEXT_ASSIGNMENT''::text, ''POLICY_APPLICABILITY''::text, ''CONTROL_APPLICABILITY''::text, ''CONTROL_ASSESSMENT''::text])))')
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint AS k WHERE k.conrelid = v_facts AND k.contype = 'c'
                      AND k.conname = 'l14_fact_states_interval_check'
                      AND pg_catalog.pg_get_constraintdef(k.oid) = 'CHECK (((effective_to IS NULL) OR ((state_kind = ''VALIDATED''::text) AND (effective_to > effective_from))))')
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint AS k WHERE k.conrelid = 'gov_repo.l14_authorization_decisions'::regclass
                      AND k.contype = 'c' AND k.convalidated AND k.conname = 'l14_authorization_decisions_control_assessment_target_check'
                      AND pg_catalog.pg_get_constraintdef(k.oid) LIKE '%scope_tag = ANY (ARRAY[''CANONICAL_OBJECT''::text, ''RELATIONSHIP_STATE''::text])%')
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint AS k WHERE k.conrelid = 'gov_repo.l14_authorization_decisions'::regclass
                      AND k.contype = 'c' AND k.convalidated AND k.conname = 'l14_authorization_decisions_control_applicability_target_check')
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint AS k WHERE k.conrelid = 'gov_repo.l14_authorization_decisions'::regclass
                      AND k.contype = 'c' AND k.convalidated AND k.conname = 'l14_authorization_decisions_policy_applicability_target_check')
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint AS k WHERE k.conrelid = 'gov_repo.l14_authorization_decisions'::regclass
                      AND k.contype = 'c' AND k.convalidated AND k.conname = 'l14_authorization_decisions_business_context_target_check')
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint AS k WHERE k.conrelid = 'gov_repo.l14_authorization_decisions'::regclass
                      AND k.contype = 'c' AND k.convalidated AND k.conname = 'l14_authorization_decisions_responsibility_target_check')
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_constraint AS k
                WHERE k.conrelid IN (v_facts, 'gov_repo.l14_governance_decisions'::regclass, 'gov_repo.l14_command_results'::regclass,
                                     'gov_repo.l14_proposals'::regclass, 'gov_repo.l14_authorization_decisions'::regclass)
                  AND k.contype = 'c' AND pg_catalog.pg_get_constraintdef(k.oid) LIKE '%FINDING%') THEN
    RAISE EXCEPTION 'M16_S1C5_POSTFLIGHT: the closed outcome, applicability pin, fact subject, interval, valid_until or authorization target rule was relaxed';
  END IF;
  -- The widened fact guard admits exactly the five families; the SHARED applicability dependency guard uses the exact
  -- S1C.4 fact KEY derivation (no new namespace, shared mode, no table access); the S1C.4 key producers are unchanged.
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc AS p
                 WHERE p.oid = 'gov_repo.l14_lock_fact_subject_guard_v1(uuid,text,text[])'::regprocedure
                   AND p.prosrc LIKE '%p_subject_kind NOT IN (''RESPONSIBILITY_ASSIGNMENT'',''BUSINESS_CONTEXT_ASSIGNMENT'',''POLICY_APPLICABILITY'',''CONTROL_APPLICABILITY'',''CONTROL_ASSESSMENT'')%'
                   AND p.prosrc LIKE '%gov_repo.frame_identity(ARRAY[p_organisation_id::text, ''l14-fact-subject-guard-v1'', p_subject_kind] || p_key_parts)%'
                   AND p.prosrc LIKE '%pg_advisory_xact_lock(%' AND p.prosrc NOT LIKE '%FINDING%')
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc AS p
                    WHERE p.oid = 'gov_repo.l14_lock_control_applicability_dependency_guard_shared_v1(uuid,text,uuid)'::regprocedure
                      AND NOT p.prosecdef AND p.prosrc LIKE '%pg_advisory_xact_lock_shared(%'
                      AND p.prosrc NOT LIKE '%pg_advisory_xact_lock(%'
                      AND pg_catalog.strpos(pg_catalog.regexp_replace(p.prosrc, '\s+', ' ', 'g'), v_dependency_key) > 0
                      AND p.prosrc !~* '(\mFROM\M|\mINSERT\M|\mUPDATE\M|\mDELETE\M|state_id)')
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc AS p
                    WHERE p.oid = 'gov_repo.l14_decide_control_applicability_proposal_v1(uuid,uuid,bigint,bigint,timestamp with time zone,text,uuid,text,text,uuid,text,text[],text)'::regprocedure
                      AND p.prosrc LIKE '%l14_lock_fact_subject_guard_v1(v_org, ''CONTROL_APPLICABILITY'',
    ARRAY[''KEY'', v_proposal.target_key, v_proposal.control_definition_id::text])%')
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc AS p
                    WHERE p.oid = 'gov_repo.l14_submit_control_applicability_proposal_v1(uuid,uuid,bigint,bigint,timestamp with time zone,text,text,text,text,text,text,text,text,uuid,uuid,text,uuid,text,timestamp with time zone,timestamp with time zone,uuid,uuid,text,text[],text)'::regprocedure
                      AND p.prosrc LIKE '%l14_lock_fact_subject_guard_v1(v_org, ''CONTROL_APPLICABILITY'',
    ARRAY[''KEY'', v_target_key, p_control_definition_id::text])%') THEN
    RAISE EXCEPTION 'M16_S1C5_POSTFLIGHT: the fact guard subject vocabulary or the shared CONTROL_APPLICABILITY dependency guard key drifted';
  END IF;
  -- Lock order of DECIDE: AP SHARED -> (VALIDATE) CD SHARED -> applicability KEY SHARED -> assessment KEY -> command.
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc AS p
                 WHERE p.oid = 'gov_repo.l14_decide_control_assessment_proposal_v1(uuid,uuid,bigint,bigint,timestamp with time zone,text,uuid,text,text,uuid,text,text[],text)'::regprocedure
                   AND pg_catalog.strpos(p.prosrc, 'l14_lock_authority_policy_guard_shared_v1(v_org)') > 0
                   AND pg_catalog.strpos(p.prosrc, 'l14_lock_authority_policy_guard_shared_v1(v_org)')
                       < pg_catalog.strpos(p.prosrc, 'IF p_outcome = ''VALIDATE'' THEN
    PERFORM gov_repo.l14_lock_control_definition_dependency_guard_shared_v1(')
                   AND pg_catalog.strpos(p.prosrc, 'l14_lock_control_definition_dependency_guard_shared_v1(')
                       < pg_catalog.strpos(p.prosrc, 'l14_lock_control_applicability_dependency_guard_shared_v1(')
                   AND pg_catalog.strpos(p.prosrc, 'l14_lock_control_applicability_dependency_guard_shared_v1(')
                       < pg_catalog.strpos(p.prosrc, 'l14_lock_fact_subject_guard_v1(v_org, ''CONTROL_ASSESSMENT''')
                   AND pg_catalog.strpos(p.prosrc, 'l14_lock_fact_subject_guard_v1(v_org, ''CONTROL_ASSESSMENT''')
                       < pg_catalog.strpos(p.prosrc, 'l14_lock_command_guard_v1(v_org, p_command_id)')
                   AND pg_catalog.strpos(p.prosrc, 'l14_lock_command_guard_v1(v_org, p_command_id)')
                       < pg_catalog.strpos(p.prosrc, 'l14_replay_arbitrate_v1')) THEN
    RAISE EXCEPTION 'M16_S1C5_POSTFLIGHT: control assessment decide lock order drifted';
  END IF;
  IF (SELECT pg_catalog.count(*) FROM pg_catalog.pg_trigger AS t
      WHERE t.tgenabled = 'A' AND NOT t.tgisinternal AND (
        (t.tgrelid = v_states AND t.tgname = 'l14_control_assessment_states_guard'
          AND t.tgfoid = 'gov_repo.l14_control_assessment_state_guard_v1()'::regprocedure)
        OR (t.tgrelid = v_proposals AND t.tgname = 'l14_control_assessment_proposals_guard'
          AND t.tgfoid = 'gov_repo.l14_control_assessment_proposal_guard_v1()'::regprocedure)
        OR (t.tgrelid = v_heads AND t.tgname IN ('l14_control_assessment_heads_guard','l14_control_assessment_heads_no_truncate')
          AND t.tgfoid = 'gov_repo.l14_control_assessment_head_guard_v1()'::regprocedure))) <> 4 THEN
    RAISE EXCEPTION 'M16_S1C5_POSTFLIGHT: S1C.5 structural guard missing or not ALWAYS';
  END IF;
  IF (SELECT pg_catalog.array_agg(k.conname::text ORDER BY k.conname::text COLLATE "C") FROM pg_catalog.pg_constraint AS k
      WHERE k.contype = 'f' AND k.conrelid = ANY (v_new_tables)
        AND k.confdeltype IN ('a','r') AND k.confupdtype IN ('a','r') AND k.convalidated
        AND NOT k.condeferrable AND NOT k.condeferred) IS DISTINCT FROM ARRAY[
       'l14_control_assessment_heads_applicability_fkey','l14_control_assessment_heads_state_fkey',
       'l14_control_assessment_proposals_applicability_fkey','l14_control_assessment_proposals_envelope_fkey',
       'l14_control_assessment_proposals_target_state_fkey',
       'l14_control_assessment_states_applicability_fkey','l14_control_assessment_states_envelope_fkey',
       'l14_control_assessment_states_predecessor_fkey','l14_control_assessment_states_revokes_fkey']
     OR (SELECT pg_catalog.count(*) FROM pg_catalog.pg_constraint AS k WHERE k.contype = 'f' AND k.conrelid = ANY (v_new_tables)) <> 9
     OR (SELECT pg_catalog.count(*) FROM pg_catalog.pg_constraint AS k
         WHERE k.contype = 'f' AND k.conrelid IN (v_states, v_proposals) AND k.confmatchtype = 's'
           AND k.conname IN ('l14_control_assessment_states_applicability_fkey','l14_control_assessment_proposals_applicability_fkey')
           AND k.confrelid = 'gov_repo.l14_control_applicability_states'::regclass AND pg_catalog.cardinality(k.conkey) = 9
           AND (SELECT pg_catalog.array_agg(att.attname::text ORDER BY u.ord)
                FROM pg_catalog.unnest(k.confkey) WITH ORDINALITY AS u(attnum, ord)
                JOIN pg_catalog.pg_attribute AS att ON att.attrelid = k.confrelid AND att.attnum = u.attnum)
               = ARRAY['organisation_id','fact_state_id','target_key','control_definition_id','control_definition_version_id',
                       'content_hash','control_definition_validated_state_id','applicability','state_kind']::text[]) <> 2
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint AS k
                    WHERE k.contype = 'f' AND k.conrelid = v_heads AND k.conname = 'l14_control_assessment_heads_applicability_fkey'
                      AND k.confrelid = 'gov_repo.l14_control_applicability_states'::regclass)
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_attribute AS att
                WHERE att.attrelid IN (v_states, v_proposals) AND att.attname = ANY (ARRAY['control_applicability_state_id',
                  'applicability_target_key','control_definition_id','control_definition_version_id','content_hash',
                  'control_definition_validated_state_id','applicability','applicability_state_kind','assessment_outcome'])
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
    RAISE EXCEPTION 'M16_S1C5_POSTFLIGHT: S1C.5 FK set wrong (missing, weakened, deferred, cascading or applicability FK not exact)';
  END IF;
  IF (SELECT pg_catalog.count(*) FROM pg_catalog.pg_indexes AS i
      WHERE i.schemaname = 'gov_repo' AND i.indexname IN ('l14_fact_states_revocation_target_uidx',
        'l14_control_assessment_states_root_uidx','l14_control_assessment_states_successor_uidx',
        'l14_support_links_fact_state_uidx')) <> 4
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint AS k WHERE k.conrelid = v_facts AND k.contype = 'u'
                      AND k.conname = 'l14_fact_states_successor_unique') THEN
    RAISE EXCEPTION 'M16_S1C5_POSTFLIGHT: linear fact lineage keys missing';
  END IF;

  -- H4. Exact INPUT parameters: the caller can never choose organisation, actor, role, a target, a control version, a
  --     relationship type, a free-text rationale, a finding, a waiver, a score, JSON or any value beyond the closed shape.
  FOR v_entry IN
    SELECT m.sig, m.args FROM (VALUES
      ('gov_repo.l14_submit_control_assessment_proposal_v1(uuid,uuid,bigint,bigint,timestamp with time zone,text,text,text,uuid,text,timestamp with time zone,timestamp with time zone,uuid,uuid,text,text[],text)',
       'p_verified_organisation_id,p_verified_actor_user_id,p_verified_session_iat,p_verified_session_exp,p_verified_credential_epoch,p_command_id,p_intent,p_source_class,p_control_applicability_state_id,p_assessment_outcome,p_requested_effective_from,p_requested_valid_until,p_target_state_id,p_prior_proposal_id,p_support_status,p_support_evidence_ids,p_caller_fingerprint'),
      ('gov_repo.l14_decide_control_assessment_proposal_v1(uuid,uuid,bigint,bigint,timestamp with time zone,text,uuid,text,text,uuid,text,text[],text)',
       'p_verified_organisation_id,p_verified_actor_user_id,p_verified_session_iat,p_verified_session_exp,p_verified_credential_epoch,p_command_id,p_proposal_id,p_outcome,p_reason_code,p_expected_current_state_id,p_support_status,p_support_evidence_ids,p_caller_fingerprint')
    ) AS m(sig, args)
  LOOP
    IF (SELECT pg_catalog.string_agg(a.name, ',' ORDER BY a.ord)
        FROM pg_catalog.pg_proc AS p
        CROSS JOIN LATERAL ROWS FROM (pg_catalog.unnest(p.proargnames), pg_catalog.unnest(p.proargmodes)) WITH ORDINALITY AS a(name, mode, ord)
        WHERE p.oid = pg_catalog.to_regprocedure(v_entry.sig) AND a.mode IN ('i','b','v')) IS DISTINCT FROM v_entry.args THEN
      RAISE EXCEPTION 'M16_S1C5_POSTFLIGHT: % input parameters are not exactly the closed command shape', v_entry.sig;
    END IF;
  END LOOP;

  -- H5. New SQL never touches the policy content stores or the policy registries, never reads the control definition
  --     registry / CONTENT (code / title / description) directly, a cg_* flag / CG-AG material, scanner / LLM / score /
  --     coverage / waiver surfaces, never another fact family's tables except the S1C.4 applicability surface it depends on
  --     (read only); never reads canonical_relationships (only the reused S1C.3 exact-triple resolver does); no new routine
  --     mutates any registry / identity / policy / canonical surface or the S1C.4 applicability history.
  FOR v_fn IN
    SELECT p.oid, p.proname, p.prosrc FROM pg_catalog.pg_proc AS p
    WHERE p.pronamespace = 'gov_repo'::regnamespace
      AND (p.proname::text = ANY (v_new_routines) OR p.proname = 'l14_lock_fact_subject_guard_v1')
  LOOP
    IF v_fn.prosrc ~ '(^|[^A-Za-z0-9_$])(governance_policies|policy_versions)([^A-Za-z0-9_$]|$)'
       OR v_fn.prosrc ~* '(content_markdown|current_version_id|change_summary|version_number|version_label|policy_mandate_mappings|mandates)' THEN
      RAISE EXCEPTION 'M16_S1C5_POSTFLIGHT: % reaches a policy content store / legacy pointer / mapping surface', v_fn.proname;
    END IF;
    IF v_fn.prosrc ~ '(l14_policy_|l14_domain_|l14_governance_part|l14_responsibility_|l14_business_context_|l14_control_definition)' THEN
      RAISE EXCEPTION 'M16_S1C5_POSTFLIGHT: % reaches another registry or another fact family', v_fn.proname;
    END IF;
    IF v_fn.prosrc ~* '(control_code|\mtitle\M|\mdescription\M)' THEN
      RAISE EXCEPTION 'M16_S1C5_POSTFLIGHT: % reads control definition content (code / title / description) as authority', v_fn.proname;
    END IF;
    IF v_fn.prosrc ~* '(directory_profile|display_name|\memail\M|\mphone\M|profile_text|external_identity_ref|governance_users|full_name)' THEN
      RAISE EXCEPTION 'M16_S1C5_POSTFLIGHT: % reaches PII / a governance-user identity', v_fn.proname;
    END IF;
    IF v_fn.prosrc ~ '(\mlabel\M|classif|\mtags\M|semantic_representation)'
       OR v_fn.prosrc ~* '(owner_user_id|owner_email|\mowner_id\M|approved_by|approval_date|reviewed_by|approver_user_id|qes_signature_id|ledger_entry_seq|\mstatus\M|effective_date|expiry_date)' THEN
      RAISE EXCEPTION 'M16_S1C5_POSTFLIGHT: % references legacy label / classification / owner / status / approval fields', v_fn.proname;
    END IF;
    IF v_fn.prosrc ~* '(\mcg_|cg-ag|\magents\M|agent_resource_links|ai_systems|\mrisk|coverage|maturity|severity|\mweight|\mscore|waiver|exception_|confidence|scanner|\mllm\M|similarity|embedding|finding)' THEN
      RAISE EXCEPTION 'M16_S1C5_POSTFLIGHT: % reaches a CG-AG flag / legacy registry / scanner / score / waiver / finding surface', v_fn.proname;
    END IF;
    IF v_fn.prosrc ~ 'WAIVED' AND v_fn.proname <> 'l14_submit_control_assessment_proposal_v1' THEN
      RAISE EXCEPTION 'M16_S1C5_POSTFLIGHT: % names WAIVED outside the explicit submission refusal', v_fn.proname;
    END IF;
    IF v_fn.prosrc ~ 'canonical_relationships' THEN
      RAISE EXCEPTION 'M16_S1C5_POSTFLIGHT: % reads canonical relationships outside the reused exact-triple resolver', v_fn.proname;
    END IF;
    IF v_fn.prosrc ~ '(^|[^A-Za-z0-9_$])(control_assessments|control_findings|conformity_assessments|assessment_status)([^A-Za-z0-9_$]|$)' THEN
      RAISE EXCEPTION 'M16_S1C5_POSTFLIGHT: % reaches the quarantined legacy assessment surface (never M16 authority)', v_fn.proname;
    END IF;
    IF v_fn.prosrc ~* '(INSERT\s+INTO|UPDATE|DELETE\s+FROM|TRUNCATE|ALTER\s+TABLE)\s+(gov_repo\.)?(l14_policy_|l14_registry_states|l14_authority_policy|l14_governance_part|l14_domain_|l14_control_definition|l14_control_applicability|l14_responsibility_|l14_business_context_|governance_policies|policy_versions|governance_users|governance_roles|organisations|discovery_evidence|canonical_objects|canonical_relationships)' THEN
      RAISE EXCEPTION 'M16_S1C5_POSTFLIGHT: % mutates a registry / policy / identity / evidence / canonical / applicability surface outside S1C.5', v_fn.proname;
    END IF;
  END LOOP;
  -- The submission refuses WAIVED explicitly (and only refuses it).
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc AS p
                 WHERE p.oid = 'gov_repo.l14_submit_control_assessment_proposal_v1(uuid,uuid,bigint,bigint,timestamp with time zone,text,text,text,uuid,text,timestamp with time zone,timestamp with time zone,uuid,uuid,text,text[],text)'::regprocedure
                   AND p.prosrc LIKE '%IF p_assessment_outcome = ''WAIVED'' THEN
    RAISE EXCEPTION ''L14_INVALID_COMMAND'' USING ERRCODE = ''GV010'', DETAIL = ''CONTROL_ASSESSMENT_WAIVED_UNSUPPORTED'';%'
                   AND (SELECT pg_catalog.count(*) FROM pg_catalog.regexp_matches(p.prosrc, 'WAIVED', 'g')) = 2) THEN
    RAISE EXCEPTION 'M16_S1C5_POSTFLIGHT: the explicit WAIVED refusal drifted';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc AS p
                 WHERE p.oid = 'gov_repo.l14_resolve_relationship_state_target_v1(uuid,text,text)'::regprocedure
                   AND p.provolatile = 's' AND NOT p.prosecdef
                   AND p.prosrc LIKE '%cr.organisation_id = p_organisation_id AND cr.relationship_id = p_relationship_id%'
                   AND p.prosrc LIKE '%cr.relationship_state_id = p_relationship_state_id%'
                   AND p.prosrc LIKE '%CASE WHEN pg_catalog.count(*) = 1 THEN%'
                   AND p.prosrc !~* '(\mINSERT\M|\mUPDATE\M|\mDELETE\M|\mORDER\M|\mLIMIT\M|valid_to|valid_from|recorded_at)')
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc AS p
                    WHERE p.oid = 'gov_repo.l14_control_applicability_valid_state_v1(uuid,text,text,text,text,text,uuid,timestamp with time zone,timestamp with time zone)'::regprocedure
                      AND p.provolatile = 's' AND NOT p.prosecdef
                      AND p.prosrc LIKE '%WHERE (SELECT pg_catalog.count(*) FROM candidates) = 1%'
                      AND p.prosrc LIKE '%gov_repo.l14_control_definition_valid_state_v1(%'
                      AND p.prosrc !~* '(\mINSERT\M|\mUPDATE\M|\mDELETE\M|\mORDER\M|\mLIMIT\M|assessment)') THEN
    RAISE EXCEPTION 'M16_S1C5_POSTFLIGHT: a reused exact resolver drifted (latest / current inference or mutation)';
  END IF;

  -- H6. Every l14 routine: pinned search_path, no PUBLIC/anon/authenticated EXECUTE; the twenty-seven public RPCs are
  --     SECURITY DEFINER + service_role-only; every other l14 routine is an owner-only SECURITY INVOKER helper.
  FOR v_fn IN
    SELECT p.oid, p.proname, p.proowner, p.proacl, p.prosecdef, p.proconfig
    FROM pg_catalog.pg_proc AS p
    WHERE p.pronamespace = 'gov_repo'::regnamespace AND p.proname LIKE 'l14\_%' ESCAPE '\'
  LOOP
    IF EXISTS (SELECT 1 FROM pg_catalog.aclexplode(COALESCE(v_fn.proacl, pg_catalog.acldefault('f', v_fn.proowner))) AS a
               WHERE a.privilege_type = 'EXECUTE' AND a.grantee = 0) THEN
      RAISE EXCEPTION 'M16_S1C5_POSTFLIGHT: % has PUBLIC EXECUTE', v_fn.proname;
    END IF;
    FOREACH v_role IN ARRAY ARRAY['anon','authenticated'] LOOP
      IF pg_catalog.has_function_privilege(v_role, v_fn.oid, 'EXECUTE') THEN
        RAISE EXCEPTION 'M16_S1C5_POSTFLIGHT: % executable by %', v_fn.proname, v_role;
      END IF;
    END LOOP;
    IF NOT COALESCE(v_fn.proconfig @> ARRAY['search_path=pg_catalog, pg_temp'], false) THEN
      RAISE EXCEPTION 'M16_S1C5_POSTFLIGHT: % search_path not pinned to pg_catalog, pg_temp', v_fn.proname;
    END IF;
    IF v_fn.proname::text = ANY (v_public_l14) THEN
      IF NOT v_fn.prosecdef OR NOT pg_catalog.has_function_privilege('service_role', v_fn.oid, 'EXECUTE')
         OR EXISTS (SELECT 1 FROM pg_catalog.aclexplode(v_fn.proacl) AS a
                    WHERE a.grantee NOT IN (v_fn.proowner, 'service_role'::regrole::oid)) THEN
        RAISE EXCEPTION 'M16_S1C5_POSTFLIGHT: public RPC % ACL/definer shape wrong', v_fn.proname;
      END IF;
    ELSIF v_fn.prosecdef OR EXISTS (SELECT 1 FROM pg_catalog.aclexplode(COALESCE(v_fn.proacl,
            pg_catalog.acldefault('f', v_fn.proowner))) AS a WHERE a.grantee <> v_fn.proowner) THEN
      RAISE EXCEPTION 'M16_S1C5_POSTFLIGHT: internal helper % must be owner-only SECURITY INVOKER', v_fn.proname;
    END IF;
  END LOOP;
  IF (SELECT pg_catalog.array_agg(p.proname::text ORDER BY p.proname::text COLLATE "C") FROM pg_catalog.pg_proc AS p
      WHERE p.pronamespace = 'gov_repo'::regnamespace AND p.proname LIKE 'l14\_%' ESCAPE '\'
        AND pg_catalog.has_function_privilege('service_role', p.oid, 'EXECUTE')) IS DISTINCT FROM v_public_l14
     OR (SELECT pg_catalog.count(*) FROM pg_catalog.pg_proc AS p
         WHERE p.pronamespace = 'gov_repo'::regnamespace AND p.proname LIKE 'l14\_%' ESCAPE '\' AND p.prosecdef) <> 27
     OR (SELECT pg_catalog.count(*) FROM pg_catalog.pg_proc AS p
         WHERE p.pronamespace = 'gov_repo'::regnamespace AND p.proname::text = ANY (v_new_routines)) <> 9
     OR (SELECT pg_catalog.count(*) FROM pg_catalog.pg_proc AS p
         WHERE p.pronamespace = 'gov_repo'::regnamespace AND p.proname = 'l14_lock_fact_subject_guard_v1') <> 1
     OR (SELECT pg_catalog.count(*) FROM pg_catalog.pg_proc AS p
         WHERE p.pronamespace = 'gov_repo'::regnamespace AND p.proname IN ('l14_evaluate_target_authority_rules_v1',
           'l14_evaluate_relationship_state_authority_rules_v1','l14_resolve_relationship_state_target_v1',
           'l14_control_applicability_valid_state_v1','l14_control_applicabilities_current_v1',
           'l14_lock_control_definition_dependency_guard_shared_v1')) <> 6
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_proc AS p
                WHERE p.pronamespace = 'gov_repo'::regnamespace AND p.proname LIKE 'l14\_%finding%' ESCAPE '\') THEN
    RAISE EXCEPTION 'M16_S1C5_POSTFLIGHT: the public L14 RPC surface must be exactly the twenty-five post-S1C.4 + two S1C.5 RPCs (no overloads)';
  END IF;

  -- H7. Closed application SECURITY DEFINER surface on the post-S1C.5 catalog: exactly 43 approved identities (exact owner
  --     class, body hash, config, service_role-only EXECUTE, no overload); exactly 33 canonical-owner (policy-store-
  --     capable) definers. The capability class reflects OWNER capability, not body-level need: the two S1C.5 bodies are
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
      RAISE EXCEPTION 'M16_S1C5_POSTFLIGHT: approved routine % missing', v_entry.sig;
    END IF;
    SELECT p.proname, p.pronamespace, p.prosecdef, p.proowner, p.prosrc, p.proconfig, p.proacl INTO v_proc
    FROM pg_catalog.pg_proc AS p WHERE p.oid = v_oid;
    IF NOT v_proc.prosecdef THEN
      RAISE EXCEPTION 'M16_S1C5_POSTFLIGHT: % is not SECURITY DEFINER', v_oid::regprocedure;
    END IF;
    IF pg_catalog.pg_get_userbyid(v_proc.proowner) <> v_entry.owner_role THEN
      RAISE EXCEPTION 'M16_S1C5_POSTFLIGHT: % owner % is not %', v_oid::regprocedure, pg_catalog.pg_get_userbyid(v_proc.proowner), v_entry.owner_role;
    END IF;
    IF pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(v_proc.prosrc, 'UTF8')), 'hex') <> v_entry.sha THEN
      RAISE EXCEPTION 'M16_S1C5_POSTFLIGHT: % body hash changed', v_oid::regprocedure;
    END IF;
    IF COALESCE(pg_catalog.array_to_string(v_proc.proconfig, ';'), '-') <>
       pg_catalog.replace(pg_catalog.replace(v_entry.cfg, '{crypto}', pg_catalog.quote_ident(v_crypto)), '{vschema}', pg_catalog.quote_ident(v_vector)) THEN
      RAISE EXCEPTION 'M16_S1C5_POSTFLIGHT: % config changed: %', v_oid::regprocedure, v_proc.proconfig;
    END IF;
    IF NOT pg_catalog.has_function_privilege('service_role', v_oid, 'EXECUTE')
       OR pg_catalog.has_function_privilege('anon', v_oid, 'EXECUTE')
       OR pg_catalog.has_function_privilege('authenticated', v_oid, 'EXECUTE')
       OR EXISTS (SELECT 1 FROM pg_catalog.aclexplode(COALESCE(v_proc.proacl, pg_catalog.acldefault('f', v_proc.proowner))) AS a
                  WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE') THEN
      RAISE EXCEPTION 'M16_S1C5_POSTFLIGHT: % application EXECUTE is not exactly service_role', v_oid::regprocedure;
    END IF;
    IF v_proc.proname::text = ANY (v_new_rpcs)
       AND EXISTS (SELECT 1 FROM pg_catalog.aclexplode(v_proc.proacl) AS a
                   WHERE a.grantee NOT IN (v_proc.proowner, 'service_role'::regrole::oid) OR (a.grantee = 'service_role'::regrole::oid AND a.privilege_type <> 'EXECUTE')) THEN
      RAISE EXCEPTION 'M16_S1C5_POSTFLIGHT: % EXECUTE ACL is not exactly owner + service_role', v_oid::regprocedure;
    END IF;
    IF (SELECT pg_catalog.count(*) FROM pg_catalog.pg_proc AS p WHERE p.pronamespace = v_proc.pronamespace AND p.proname = v_proc.proname) <> 1 THEN
      RAISE EXCEPTION 'M16_S1C5_POSTFLIGHT: overload of approved routine %', v_oid::regprocedure;
    END IF;
    v_approved := v_approved || v_oid;
    IF v_entry.owner_role = 'postgres' THEN
      IF v_proc.proowner <> ALL (v_capable) THEN
        RAISE EXCEPTION 'M16_S1C5_POSTFLIGHT: canonical L14/S0 owner of % unexpectedly lost policy-store capability', v_oid::regprocedure;
      END IF;
      v_frozen := v_frozen || v_oid;
    ELSIF v_proc.proowner = ANY (v_capable) THEN
      RAISE EXCEPTION 'M16_S1C5_POSTFLIGHT: owner of % has policy-store capability', v_oid::regprocedure;
    END IF;
  END LOOP;
  IF pg_catalog.cardinality(v_approved) <> 43 OR pg_catalog.cardinality(v_frozen) <> 33 THEN
    RAISE EXCEPTION 'M16_S1C5_POSTFLIGHT: approved surface is not exactly 43 (33 policy-store-capable)';
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
      RAISE EXCEPTION 'M16_S1C5_POSTFLIGHT: CLOSED_SURFACE unapproved application-executable SECURITY DEFINER %', v_row.oid::regprocedure;
    END IF;
    IF v_row.proowner = ANY (v_capable) AND v_row.oid <> ALL (v_frozen) THEN
      RAISE EXCEPTION 'M16_S1C5_POSTFLIGHT: POLICY_STORE_OWNER application definer % outside the approved 33', v_row.oid::regprocedure;
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
                          WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE'))) <> 43 THEN
    RAISE EXCEPTION 'M16_S1C5_POSTFLIGHT: application SECURITY DEFINER surface is not exactly 43';
  END IF;
  -- Every application definer that can reach a policy store is one of the 33 approved canonical-owner RPCs (no S1C.5
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
      RAISE EXCEPTION 'M16_S1C5_POSTFLIGHT: application definer % reaches a policy store outside the approved 33', v_fn.oid::regprocedure;
    END IF;
    IF v_fn.proname::text = ANY (v_new_rpcs) THEN
      RAISE EXCEPTION 'M16_S1C5_POSTFLIGHT: S1C.5 RPC % reaches a policy store', v_fn.oid::regprocedure;
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
    RAISE EXCEPTION 'M16_S1C5_POSTFLIGHT: postgres routine default privileges grant PUBLIC / application EXECUTE';
  END IF;

  -- H9. No inheritance, no readable/writable view leak and no sequence leak into the stores, the admission lineages, the
  --     S1B.4 / S1B.5 / S1B.6 history or the S1C.1 .. S1C.5 fact history (any schema, transitive).
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_inherits AS i WHERE i.inhrelid = ANY (v_guarded) OR i.inhparent = ANY (v_guarded)) THEN
    RAISE EXCEPTION 'M16_S1C5_POSTFLIGHT: inheritance involves a policy store, an admission lineage or guarded history';
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
      RAISE EXCEPTION 'M16_S1C5_POSTFLIGHT: view % reaching guarded history has a PUBLIC grant', v_rel.relname;
    END IF;
    FOREACH v_role IN ARRAY v_app LOOP
      FOREACH v_privilege IN ARRAY v_privileges LOOP
        IF pg_catalog.has_table_privilege(v_role, v_rel.oid, v_privilege) THEN
          RAISE EXCEPTION 'M16_S1C5_POSTFLIGHT: % holds % on view % reaching guarded history', v_role, v_privilege, v_rel.relname;
        END IF;
      END LOOP;
      IF pg_catalog.has_any_column_privilege(v_role, v_rel.oid, 'SELECT, INSERT, UPDATE, REFERENCES') THEN
        RAISE EXCEPTION 'M16_S1C5_POSTFLIGHT: % holds a column privilege on view % reaching guarded history', v_role, v_rel.relname;
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
        RAISE EXCEPTION 'M16_S1C5_POSTFLIGHT: % holds a privilege on sequence %', v_role, v_rel.relname;
      END IF;
    END LOOP;
  END LOOP;

  -- H10. Frozen enumerations: exactly 11 canonical object kinds and 12 governed relationship types; CONTROL_ASSESSMENT is
  --      not canonical and no ASSESSED_BY / SATISFIES / CONTROL_FINDING kind or type exists.
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
    RAISE EXCEPTION 'M16_S1C5_POSTFLIGHT: canonical object kinds (11) / governed relationship types (12) changed';
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
    RAISE EXCEPTION 'M16_S1C5_POSTFLIGHT: F2 boundary violated';
  END IF;

  -- H12. S0 wrapper/eligibility naming contracts stay intact.
  IF (SELECT pg_catalog.count(*) FROM pg_catalog.pg_proc AS p WHERE p.pronamespace = 'gov_repo'::regnamespace
        AND p.proname IN ('apply_review_transition_governed_v1','record_authorized_reconciliation_governed_v1',
                          'materialize_object_reconciliation_governed_v1','materialize_relationship_reconciliation_governed_v1',
                          'record_technical_field_decision_governed_v1','record_execution_field_decision_governed_v1')) <> 6
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_proc AS p WHERE p.pronamespace = 'gov_repo'::regnamespace
        AND p.proname LIKE 'l14\_%' ESCAPE '\' AND (p.proname LIKE '%eligibility%' OR p.proname LIKE '%governed%')) THEN
    RAISE EXCEPTION 'M16_S1C5_POSTFLIGHT: S0 naming contract disturbed';
  END IF;
END;
$postflight$;

COMMIT;
