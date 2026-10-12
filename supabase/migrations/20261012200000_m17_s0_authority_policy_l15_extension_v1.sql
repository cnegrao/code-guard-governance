-- M17-S0: Authority / security / root contracts + legacy compatibility hardening (DB only, ADDITIVE).
-- Architecture: docs/architecture/ADR-GOVIA-RISK-INTELLIGENCE-v1.md (ACCEPTED / FROZEN) §§12, 16, 23-24, 26 (O01-O07,
-- O53-O62, O73-O78, O85-O91) and docs/architecture/ADR-GOVIA-M16-AUTHORITY-POLICY-M17-EXTENSION-v1.md (D-01, ACCEPTED /
-- FROZEN) §§4-7. Historical migrations are NOT edited. Never run against a hosted DB from this slice.
--
-- This slice:
--   A. Preflight: the exact post-M16 closed vocabularies, the 45-routine application SECURITY DEFINER surface, no L15
--      value anywhere; captures every gov_repo constraint definition and a row hash of every M16 governance table and
--      every legacy risk store, compared in the postflight.
--   B. D-01 single Authority Policy extension: permission vocabulary 15 -> 23 (+ the eight L15_* tags) on the policy
--      rules and the authorization rule snapshots; shared governance-envelope subject vocabulary 11 -> 17 (+ the six L15
--      governance subjects) on authorization decisions, proposals, governance decisions and command results; the 24 L15
--      reason codes produced by the UNCHANGED subject x outcome rule; exactly two new ADMIT command kinds; per-subject
--      request-target CHECKs; command-result L15 branch. RISK_SIGNAL / RISK_HYPOTHESIS are never governance subjects.
--      NOT widened: l14_fact_states (exactly five M16 families), l14_registry_states, l14_support_links, every M16 typed
--      table. Requested actions, source classes / dispositions, scope grammar and trust vocabulary are unchanged.
--   C. Fail-closed L14 <-> L15 authority isolation: an L15 rule snapshot must carry exactly the permission mapped to its
--      decision's subject x action, an L14 decision can never snapshot an L15 rule, and an L15 ALLOW is structurally
--      impossible without an effective-policy L15 rule, a verified ACTIVE same-tenant human actor and the policy basis.
--   D. No L15 bootstrap: SYSTEM_BOOTSTRAP_L14_AUTHORITY_V1 never authorizes an L15 subject (the unchanged S1B.0 CHECK)
--      nor an L15 permission (new snapshot CHECK); an L15 rule can only enter a successor Authority Policy version
--      admitted under the effective policy (never the bootstrap-admitted first version).
--   E. D-05 legacy write-freeze: service_role / authenticated / anon / PUBLIC lose INSERT, UPDATE, DELETE, TRUNCATE on
--      gov_repo.risk_entries and gov_repo.risk_treatments. No row, column, default or constraint of either changes.
--
-- SECURITY DEFINER: NO application SECURITY DEFINER routine is created or replaced; the closed 45-routine surface is
-- re-asserted byte-identically (owner, body hash, config, ACL) in the postflight. The only replaced routine is the
-- owner-only, SECURITY INVOKER rule parser gov_repo.l14_parse_authority_policy_rules_v1 (same signature, owner, ACL,
-- volatility and pinned search_path). New guard routines are SECURITY INVOKER, owner-only, search_path pinned.
-- Dependency-deferred (owned by later slices): the command-result VALIDATED / REVOKED branch for L15 subjects references
-- an L15 state id and lands with the L15 state stores (S2 registries, S3+ families); no L15 store is created here.
-- F2 untouched: no canonical_relationships DDL/DML.
BEGIN;

-- ---------------------------------------------------------------------------------------
-- A. Preflight + capture.
-- ---------------------------------------------------------------------------------------
CREATE TEMPORARY TABLE m17_s0_constraint_capture ON COMMIT DROP AS
  SELECT c.conrelid::regclass::text AS relation, c.conname::text AS conname, pg_catalog.pg_get_constraintdef(c.oid) AS def
  FROM pg_catalog.pg_constraint AS c
  JOIN pg_catalog.pg_class AS r ON r.oid = c.conrelid
  WHERE r.relnamespace = 'gov_repo'::regnamespace;

CREATE TEMPORARY TABLE m17_s0_row_capture (relation text PRIMARY KEY, row_count bigint NOT NULL, row_hash text NOT NULL)
  ON COMMIT DROP;

DO $preflight$
DECLARE
  v_rel text;
  v_count bigint;
  v_hash text;
  v_tables CONSTANT text[] := ARRAY[
    'l14_authority_policies','l14_authority_policy_versions','l14_authority_policy_rules',
    'l14_proposals','l14_authority_policy_version_proposals','l14_authorization_decisions',
    'l14_authorization_decision_roles','l14_authorization_decision_rules','l14_governance_decisions',
    'l14_authority_policy_states','l14_authority_policy_heads','l14_command_results',
    'l14_support_links','l14_fact_states','l14_registry_states',
    'risk_entries','risk_treatments'];
  v_def text;
BEGIN
  IF pg_catalog.current_setting('server_version_num')::integer NOT BETWEEN 170000 AND 179999 THEN
    RAISE EXCEPTION 'M17_S0_PREFLIGHT: PostgreSQL 17.x required' USING ERRCODE = '55000';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc AS p WHERE p.oid = pg_catalog.to_regprocedure(
       'gov_repo.l14_read_fact_conflict_v1(uuid,uuid,bigint,bigint,timestamp with time zone,text,text,text,text,text,text,text,uuid,text,uuid,uuid,uuid,timestamp with time zone,timestamp with time zone)')) THEN
    RAISE EXCEPTION 'M17_S0_PREFLIGHT: the M16 read-projection closure is not applied' USING ERRCODE = '55000';
  END IF;
  -- Exact closed M16 vocabularies (one literal set per constraint).
  FOR v_rel, v_def IN SELECT x.c, x.d FROM (VALUES
      ('l14_authority_policy_rules_permission_check', 'P'), ('l14_authorization_decision_rules_permission_check', 'P'),
      ('l14_authorization_decisions_subject_kind_check', 'S'), ('l14_proposals_subject_kind_check', 'S'),
      ('l14_governance_decisions_subject_kind_check', 'S'), ('l14_command_results_subject_kind_check', 'S'),
      ('l14_governance_decisions_reason_code_check', 'R'), ('l14_command_results_command_kind_check', 'C')) AS x(c, d)
  LOOP
    IF (SELECT pg_catalog.array_agg(DISTINCT m.v[1] ORDER BY m.v[1])
        FROM pg_catalog.pg_constraint AS k
        CROSS JOIN LATERAL pg_catalog.regexp_matches(pg_catalog.pg_get_constraintdef(k.oid), '''([A-Z0-9_]+)''', 'g') AS m(v)
        WHERE k.connamespace = 'gov_repo'::regnamespace AND k.conname = v_rel)
       IS DISTINCT FROM (SELECT pg_catalog.array_agg(u.v ORDER BY u.v) FROM pg_catalog.unnest(CASE v_def
         WHEN 'P' THEN ARRAY[
           'L14_AUTHORITY_POLICY_ADMIT','L14_PARTY_ADMIT','L14_DOMAIN_ADMIT','L14_CONTROL_DEFINITION_ADMIT',
           'L14_POLICY_CONTENT_ADMIT','L14_AUTHORITY_POLICY_ADMIN','L14_PARTY_VALIDATE','L14_DOMAIN_VALIDATE',
           'L14_CONTROL_DEFINITION_VALIDATE','L14_POLICY_VERSION_VALIDATE','L14_RESPONSIBILITY_VALIDATE','L14_BUSINESS_CONTEXT_VALIDATE',
           'L14_POLICY_APPLICABILITY_VALIDATE','L14_CONTROL_APPLICABILITY_VALIDATE','L14_CONTROL_ASSESSMENT_VALIDATE']
         WHEN 'S' THEN ARRAY[
           'AUTHORITY_POLICY_VERSION','GOVERNANCE_PARTY','BUSINESS_DOMAIN','INFORMATION_DOMAIN',
           'CONTROL_DEFINITION','POLICY_VERSION','RESPONSIBILITY_ASSIGNMENT','BUSINESS_CONTEXT_ASSIGNMENT',
           'POLICY_APPLICABILITY','CONTROL_APPLICABILITY','CONTROL_ASSESSMENT']
         WHEN 'R' THEN ARRAY[
           'AUTHORITY_POLICY_VALIDATED','AUTHORITY_POLICY_REJECTED','AUTHORITY_POLICY_DEFERRED','AUTHORITY_POLICY_REVOKED',
           'GOVERNANCE_PARTY_VALIDATED','GOVERNANCE_PARTY_REJECTED','GOVERNANCE_PARTY_DEFERRED','GOVERNANCE_PARTY_REVOKED',
           'BUSINESS_DOMAIN_VALIDATED','BUSINESS_DOMAIN_REJECTED','BUSINESS_DOMAIN_DEFERRED','BUSINESS_DOMAIN_REVOKED',
           'INFORMATION_DOMAIN_VALIDATED','INFORMATION_DOMAIN_REJECTED','INFORMATION_DOMAIN_DEFERRED','INFORMATION_DOMAIN_REVOKED',
           'CONTROL_DEFINITION_VALIDATED','CONTROL_DEFINITION_REJECTED','CONTROL_DEFINITION_DEFERRED','CONTROL_DEFINITION_REVOKED',
           'POLICY_VERSION_VALIDATED','POLICY_VERSION_REJECTED','POLICY_VERSION_DEFERRED','POLICY_VERSION_REVOKED',
           'RESPONSIBILITY_ASSIGNMENT_VALIDATED','RESPONSIBILITY_ASSIGNMENT_REJECTED','RESPONSIBILITY_ASSIGNMENT_DEFERRED','RESPONSIBILITY_ASSIGNMENT_REVOKED',
           'BUSINESS_CONTEXT_ASSIGNMENT_VALIDATED','BUSINESS_CONTEXT_ASSIGNMENT_REJECTED','BUSINESS_CONTEXT_ASSIGNMENT_DEFERRED','BUSINESS_CONTEXT_ASSIGNMENT_REVOKED',
           'POLICY_APPLICABILITY_VALIDATED','POLICY_APPLICABILITY_REJECTED','POLICY_APPLICABILITY_DEFERRED','POLICY_APPLICABILITY_REVOKED',
           'CONTROL_APPLICABILITY_VALIDATED','CONTROL_APPLICABILITY_REJECTED','CONTROL_APPLICABILITY_DEFERRED','CONTROL_APPLICABILITY_REVOKED',
           'CONTROL_ASSESSMENT_VALIDATED','CONTROL_ASSESSMENT_REJECTED','CONTROL_ASSESSMENT_DEFERRED','CONTROL_ASSESSMENT_REVOKED']
         ELSE ARRAY[
           'ADMIT_AUTHORITY_POLICY_VERSION','SUBMIT_PROPOSAL','DECIDE_PROPOSAL',
           'ADMIT_GOVERNANCE_PARTY','ADMIT_BUSINESS_DOMAIN','ADMIT_INFORMATION_DOMAIN',
           'ADMIT_CONTROL_DEFINITION_VERSION','ADMIT_GOVERNANCE_POLICY','ADMIT_POLICY_VERSION'] END) AS u(v)) THEN
      RAISE EXCEPTION 'M17_S0_PREFLIGHT: % is not the exact post-M16 closed vocabulary', v_rel USING ERRCODE = '55000';
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_class AS c WHERE c.relnamespace = 'gov_repo'::regnamespace AND c.relname LIKE 'l15\_%' ESCAPE '\')
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_proc AS p WHERE p.pronamespace = 'gov_repo'::regnamespace AND p.proname LIKE 'l15\_%' ESCAPE '\') THEN
    RAISE EXCEPTION 'M17_S0_PREFLIGHT: an L15 object already exists' USING ERRCODE = '55000';
  END IF;
  -- Capture an order-independent row hash of every M16 governance table and every legacy risk store.
  FOREACH v_rel IN ARRAY v_tables LOOP
    EXECUTE pg_catalog.format(
      'SELECT pg_catalog.count(*), COALESCE(pg_catalog.md5(pg_catalog.string_agg(t::text, %L ORDER BY t::text COLLATE "C")), %L) FROM gov_repo.%I AS t',
      E'\n', 'EMPTY', v_rel) INTO v_count, v_hash;
    INSERT INTO m17_s0_row_capture (relation, row_count, row_hash) VALUES (v_rel, v_count, v_hash);
  END LOOP;
  -- Legacy agent risk columns (the D-12 history that must never change).
  SELECT pg_catalog.count(*), COALESCE(pg_catalog.md5(pg_catalog.string_agg(
           a.agent_id::text || '|' || a.risk_level::text || '|' || a.ai_act_risk_class::text, E'\n' ORDER BY a.agent_id::text COLLATE "C")), 'EMPTY')
    INTO v_count, v_hash FROM gov_repo.agents AS a;
  INSERT INTO m17_s0_row_capture (relation, row_count, row_hash) VALUES ('agents.legacy_risk_columns', v_count, v_hash);
END;
$preflight$;

-- ---------------------------------------------------------------------------------------
-- B1. Permission vocabulary 15 -> 23 (policy rules + authorization rule snapshots). Existing rows satisfy it.
-- ---------------------------------------------------------------------------------------
ALTER TABLE gov_repo.l14_authority_policy_rules
  DROP CONSTRAINT l14_authority_policy_rules_permission_check;
ALTER TABLE gov_repo.l14_authority_policy_rules
  ADD CONSTRAINT l14_authority_policy_rules_permission_check CHECK (permission IN (
    'L14_AUTHORITY_POLICY_ADMIT','L14_PARTY_ADMIT','L14_DOMAIN_ADMIT','L14_CONTROL_DEFINITION_ADMIT',
    'L14_POLICY_CONTENT_ADMIT','L14_AUTHORITY_POLICY_ADMIN','L14_PARTY_VALIDATE','L14_DOMAIN_VALIDATE',
    'L14_CONTROL_DEFINITION_VALIDATE','L14_POLICY_VERSION_VALIDATE','L14_RESPONSIBILITY_VALIDATE','L14_BUSINESS_CONTEXT_VALIDATE',
    'L14_POLICY_APPLICABILITY_VALIDATE','L14_CONTROL_APPLICABILITY_VALIDATE','L14_CONTROL_ASSESSMENT_VALIDATE',
    'L15_RISK_SCENARIO_ADMIT','L15_RISK_SCENARIO_VALIDATE','L15_RISK_METHODOLOGY_ADMIT','L15_RISK_METHODOLOGY_VALIDATE',
    'L15_GOVERNED_RISK_VALIDATE','L15_RISK_ASSESSMENT_VALIDATE','L15_RISK_TREATMENT_VALIDATE','L15_RISK_ACCEPTANCE_VALIDATE')),
  -- L15 registry administration is organisation-local only (mirror of the M16 D-14 rule; no existing row can violate it).
  ADD CONSTRAINT l14_authority_policy_rules_l15_registry_scope_check CHECK (
    permission NOT IN ('L15_RISK_SCENARIO_ADMIT','L15_RISK_SCENARIO_VALIDATE','L15_RISK_METHODOLOGY_ADMIT',
                       'L15_RISK_METHODOLOGY_VALIDATE')
    OR scope_tag = 'ALL_ALLOWED_TARGETS');

ALTER TABLE gov_repo.l14_authorization_decision_rules
  DROP CONSTRAINT l14_authorization_decision_rules_permission_check;
ALTER TABLE gov_repo.l14_authorization_decision_rules
  ADD CONSTRAINT l14_authorization_decision_rules_permission_check CHECK (permission IN (
    'L14_AUTHORITY_POLICY_ADMIT','L14_PARTY_ADMIT','L14_DOMAIN_ADMIT','L14_CONTROL_DEFINITION_ADMIT',
    'L14_POLICY_CONTENT_ADMIT','L14_AUTHORITY_POLICY_ADMIN','L14_PARTY_VALIDATE','L14_DOMAIN_VALIDATE',
    'L14_CONTROL_DEFINITION_VALIDATE','L14_POLICY_VERSION_VALIDATE','L14_RESPONSIBILITY_VALIDATE','L14_BUSINESS_CONTEXT_VALIDATE',
    'L14_POLICY_APPLICABILITY_VALIDATE','L14_CONTROL_APPLICABILITY_VALIDATE','L14_CONTROL_ASSESSMENT_VALIDATE',
    'L15_RISK_SCENARIO_ADMIT','L15_RISK_SCENARIO_VALIDATE','L15_RISK_METHODOLOGY_ADMIT','L15_RISK_METHODOLOGY_VALIDATE',
    'L15_GOVERNED_RISK_VALIDATE','L15_RISK_ASSESSMENT_VALIDATE','L15_RISK_TREATMENT_VALIDATE','L15_RISK_ACCEPTANCE_VALIDATE')),
  -- No L15 bootstrap: the bounded SYSTEM_BOOTSTRAP grant can never carry an L15 permission.
  ADD CONSTRAINT l14_authorization_decision_rules_l15_no_bootstrap_check CHECK (
    permission_origin <> 'SYSTEM_BOOTSTRAP' OR permission LIKE 'L14\_%' ESCAPE '\');

-- ---------------------------------------------------------------------------------------
-- B2. Shared governance-envelope subjects 11 -> 17. RISK_SIGNAL / RISK_HYPOTHESIS are NOT admitted.
-- ---------------------------------------------------------------------------------------
ALTER TABLE gov_repo.l14_authorization_decisions
  DROP CONSTRAINT l14_authorization_decisions_subject_kind_check;
ALTER TABLE gov_repo.l14_authorization_decisions
  ADD CONSTRAINT l14_authorization_decisions_subject_kind_check CHECK (subject_kind IN (
    'AUTHORITY_POLICY_VERSION','GOVERNANCE_PARTY','BUSINESS_DOMAIN','INFORMATION_DOMAIN',
    'CONTROL_DEFINITION','POLICY_VERSION','RESPONSIBILITY_ASSIGNMENT','BUSINESS_CONTEXT_ASSIGNMENT',
    'POLICY_APPLICABILITY','CONTROL_APPLICABILITY','CONTROL_ASSESSMENT',
    'RISK_SCENARIO_DEFINITION','RISK_METHODOLOGY','GOVERNED_RISK',
    'RISK_ASSESSMENT','RISK_TREATMENT','RISK_ACCEPTANCE')),
  -- L15 registry subjects: organisation-local request target (mirror of the M16 registry organisation scope).
  ADD CONSTRAINT l14_authorization_decisions_l15_registry_target_check CHECK (
    subject_kind NOT IN ('RISK_SCENARIO_DEFINITION','RISK_METHODOLOGY') OR scope_tag = 'ALL_ALLOWED_TARGETS'),
  -- L15 risk subjects (governed risk and the assessment / treatment / acceptance of a pinned governed risk): never ADMIT;
  -- the request target is the exact risk subject - ONE exact canonical object of a legal V1 subject kind (ADR §8.2; the
  -- S1B.0 FK pins organisation + id + declared kind) or ONE exact relationship state (no FK onto the F2 table). Never
  -- organisation-wide; expectation explicit.
  ADD CONSTRAINT l14_authorization_decisions_l15_risk_target_check CHECK (
    subject_kind NOT IN ('GOVERNED_RISK','RISK_ASSESSMENT','RISK_TREATMENT','RISK_ACCEPTANCE')
    OR (requested_action <> 'ADMIT'
        AND ((scope_tag = 'CANONICAL_OBJECT' AND target_canonical_kind IN (
               'AGENT','AGENT_VERSION','MODEL','TOOL','MCP_SERVER','API','DATA_ASSET','DATA_ELEMENT'))
             OR scope_tag = 'RELATIONSHIP_STATE')
        AND attempted_content_hash IS NULL AND expected_latest_version_id IS NULL
        AND expectation_kind IN ('EXPECTED_NONE','EXPECTED_CURRENT')));

ALTER TABLE gov_repo.l14_proposals
  DROP CONSTRAINT l14_proposals_subject_kind_check;
ALTER TABLE gov_repo.l14_proposals
  ADD CONSTRAINT l14_proposals_subject_kind_check CHECK (subject_kind IN (
    'AUTHORITY_POLICY_VERSION','GOVERNANCE_PARTY','BUSINESS_DOMAIN','INFORMATION_DOMAIN',
    'CONTROL_DEFINITION','POLICY_VERSION','RESPONSIBILITY_ASSIGNMENT','BUSINESS_CONTEXT_ASSIGNMENT',
    'POLICY_APPLICABILITY','CONTROL_APPLICABILITY','CONTROL_ASSESSMENT',
    'RISK_SCENARIO_DEFINITION','RISK_METHODOLOGY','GOVERNED_RISK',
    'RISK_ASSESSMENT','RISK_TREATMENT','RISK_ACCEPTANCE'));

-- B3. Governance decisions: the six L15 subjects and exactly the 24 codes of the UNCHANGED subject x outcome rule
--     (l14_governance_decisions_reason_check is not touched). No free-form code.
ALTER TABLE gov_repo.l14_governance_decisions
  DROP CONSTRAINT l14_governance_decisions_subject_kind_check,
  DROP CONSTRAINT l14_governance_decisions_reason_code_check;
ALTER TABLE gov_repo.l14_governance_decisions
  ADD CONSTRAINT l14_governance_decisions_subject_kind_check CHECK (subject_kind IN (
    'AUTHORITY_POLICY_VERSION','GOVERNANCE_PARTY','BUSINESS_DOMAIN','INFORMATION_DOMAIN',
    'CONTROL_DEFINITION','POLICY_VERSION','RESPONSIBILITY_ASSIGNMENT','BUSINESS_CONTEXT_ASSIGNMENT',
    'POLICY_APPLICABILITY','CONTROL_APPLICABILITY','CONTROL_ASSESSMENT',
    'RISK_SCENARIO_DEFINITION','RISK_METHODOLOGY','GOVERNED_RISK',
    'RISK_ASSESSMENT','RISK_TREATMENT','RISK_ACCEPTANCE')),
  ADD CONSTRAINT l14_governance_decisions_reason_code_check CHECK (reason_code IN (
    'AUTHORITY_POLICY_VALIDATED','AUTHORITY_POLICY_REJECTED','AUTHORITY_POLICY_DEFERRED','AUTHORITY_POLICY_REVOKED',
    'GOVERNANCE_PARTY_VALIDATED','GOVERNANCE_PARTY_REJECTED','GOVERNANCE_PARTY_DEFERRED','GOVERNANCE_PARTY_REVOKED',
    'BUSINESS_DOMAIN_VALIDATED','BUSINESS_DOMAIN_REJECTED','BUSINESS_DOMAIN_DEFERRED','BUSINESS_DOMAIN_REVOKED',
    'INFORMATION_DOMAIN_VALIDATED','INFORMATION_DOMAIN_REJECTED','INFORMATION_DOMAIN_DEFERRED','INFORMATION_DOMAIN_REVOKED',
    'CONTROL_DEFINITION_VALIDATED','CONTROL_DEFINITION_REJECTED','CONTROL_DEFINITION_DEFERRED','CONTROL_DEFINITION_REVOKED',
    'POLICY_VERSION_VALIDATED','POLICY_VERSION_REJECTED','POLICY_VERSION_DEFERRED','POLICY_VERSION_REVOKED',
    'RESPONSIBILITY_ASSIGNMENT_VALIDATED','RESPONSIBILITY_ASSIGNMENT_REJECTED','RESPONSIBILITY_ASSIGNMENT_DEFERRED','RESPONSIBILITY_ASSIGNMENT_REVOKED',
    'BUSINESS_CONTEXT_ASSIGNMENT_VALIDATED','BUSINESS_CONTEXT_ASSIGNMENT_REJECTED','BUSINESS_CONTEXT_ASSIGNMENT_DEFERRED','BUSINESS_CONTEXT_ASSIGNMENT_REVOKED',
    'POLICY_APPLICABILITY_VALIDATED','POLICY_APPLICABILITY_REJECTED','POLICY_APPLICABILITY_DEFERRED','POLICY_APPLICABILITY_REVOKED',
    'CONTROL_APPLICABILITY_VALIDATED','CONTROL_APPLICABILITY_REJECTED','CONTROL_APPLICABILITY_DEFERRED','CONTROL_APPLICABILITY_REVOKED',
    'CONTROL_ASSESSMENT_VALIDATED','CONTROL_ASSESSMENT_REJECTED','CONTROL_ASSESSMENT_DEFERRED','CONTROL_ASSESSMENT_REVOKED',
    'RISK_SCENARIO_DEFINITION_VALIDATED','RISK_SCENARIO_DEFINITION_REJECTED','RISK_SCENARIO_DEFINITION_DEFERRED','RISK_SCENARIO_DEFINITION_REVOKED',
    'RISK_METHODOLOGY_VALIDATED','RISK_METHODOLOGY_REJECTED','RISK_METHODOLOGY_DEFERRED','RISK_METHODOLOGY_REVOKED',
    'GOVERNED_RISK_VALIDATED','GOVERNED_RISK_REJECTED','GOVERNED_RISK_DEFERRED','GOVERNED_RISK_REVOKED',
    'RISK_ASSESSMENT_VALIDATED','RISK_ASSESSMENT_REJECTED','RISK_ASSESSMENT_DEFERRED','RISK_ASSESSMENT_REVOKED',
    'RISK_TREATMENT_VALIDATED','RISK_TREATMENT_REJECTED','RISK_TREATMENT_DEFERRED','RISK_TREATMENT_REVOKED',
    'RISK_ACCEPTANCE_VALIDATED','RISK_ACCEPTANCE_REJECTED','RISK_ACCEPTANCE_DEFERRED','RISK_ACCEPTANCE_REVOKED'));

-- B4. Command results: the six L15 subjects, exactly two new ADMIT command kinds (SUBMIT_PROPOSAL / DECIDE_PROPOSAL
--     reused), and the L15 shape branch. The AP, registry and fact branches are kept VERBATIM. An L15 result never
--     carries an AP / registry / fact state; VALIDATED / REVOKED (which reference an L15 state) are dependency-deferred
--     to the slices that create the L15 state stores.
ALTER TABLE gov_repo.l14_command_results
  DROP CONSTRAINT l14_command_results_subject_kind_check,
  DROP CONSTRAINT l14_command_results_command_kind_check,
  DROP CONSTRAINT l14_command_results_command_subject_check,
  DROP CONSTRAINT l14_command_results_shape_check;
ALTER TABLE gov_repo.l14_command_results
  ADD CONSTRAINT l14_command_results_subject_kind_check CHECK (subject_kind IN (
    'AUTHORITY_POLICY_VERSION','GOVERNANCE_PARTY','BUSINESS_DOMAIN','INFORMATION_DOMAIN',
    'CONTROL_DEFINITION','POLICY_VERSION','RESPONSIBILITY_ASSIGNMENT','BUSINESS_CONTEXT_ASSIGNMENT',
    'POLICY_APPLICABILITY','CONTROL_APPLICABILITY','CONTROL_ASSESSMENT',
    'RISK_SCENARIO_DEFINITION','RISK_METHODOLOGY','GOVERNED_RISK',
    'RISK_ASSESSMENT','RISK_TREATMENT','RISK_ACCEPTANCE')),
  ADD CONSTRAINT l14_command_results_command_kind_check CHECK (command_kind IN (
    'ADMIT_AUTHORITY_POLICY_VERSION','SUBMIT_PROPOSAL','DECIDE_PROPOSAL',
    'ADMIT_GOVERNANCE_PARTY','ADMIT_BUSINESS_DOMAIN','ADMIT_INFORMATION_DOMAIN',
    'ADMIT_CONTROL_DEFINITION_VERSION','ADMIT_GOVERNANCE_POLICY','ADMIT_POLICY_VERSION',
    'ADMIT_RISK_SCENARIO_DEFINITION_VERSION','ADMIT_RISK_METHODOLOGY_VERSION')),
  ADD CONSTRAINT l14_command_results_command_subject_check CHECK (
    command_kind IN ('SUBMIT_PROPOSAL','DECIDE_PROPOSAL')
    OR (command_kind = 'ADMIT_AUTHORITY_POLICY_VERSION' AND subject_kind = 'AUTHORITY_POLICY_VERSION')
    OR (command_kind = 'ADMIT_GOVERNANCE_PARTY' AND subject_kind = 'GOVERNANCE_PARTY')
    OR (command_kind = 'ADMIT_BUSINESS_DOMAIN' AND subject_kind = 'BUSINESS_DOMAIN')
    OR (command_kind = 'ADMIT_INFORMATION_DOMAIN' AND subject_kind = 'INFORMATION_DOMAIN')
    OR (command_kind = 'ADMIT_CONTROL_DEFINITION_VERSION' AND subject_kind = 'CONTROL_DEFINITION')
    OR (command_kind IN ('ADMIT_GOVERNANCE_POLICY','ADMIT_POLICY_VERSION') AND subject_kind = 'POLICY_VERSION')
    OR (command_kind = 'ADMIT_RISK_SCENARIO_DEFINITION_VERSION' AND subject_kind = 'RISK_SCENARIO_DEFINITION')
    OR (command_kind = 'ADMIT_RISK_METHODOLOGY_VERSION' AND subject_kind = 'RISK_METHODOLOGY')),
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
        AND proposal_id IS NOT NULL AND governance_decision_id IS NOT NULL AND fact_state_id IS NULL)))
    OR (subject_kind IN ('RISK_SCENARIO_DEFINITION','RISK_METHODOLOGY','GOVERNED_RISK',
                         'RISK_ASSESSMENT','RISK_TREATMENT','RISK_ACCEPTANCE')
      AND authority_policy_id IS NULL AND version_id IS NULL AND state_id IS NULL AND registry_state_id IS NULL
      AND fact_state_id IS NULL AND (
      (command_kind = 'SUBMIT_PROPOSAL' AND outcome = 'SUBMITTED' AND authorization_decision_id IS NULL
        AND proposal_id IS NOT NULL AND governance_decision_id IS NULL)
      OR (command_kind IN ('ADMIT_RISK_SCENARIO_DEFINITION_VERSION','ADMIT_RISK_METHODOLOGY_VERSION')
        AND outcome IN ('ADMITTED','DENIED') AND authorization_decision_id IS NOT NULL
        AND proposal_id IS NULL AND governance_decision_id IS NULL)
      OR (command_kind = 'DECIDE_PROPOSAL' AND outcome = 'DENIED' AND authorization_decision_id IS NOT NULL
        AND proposal_id IS NOT NULL AND governance_decision_id IS NULL)
      OR (command_kind = 'DECIDE_PROPOSAL' AND outcome IN ('REJECTED','DEFERRED') AND authorization_decision_id IS NOT NULL
        AND proposal_id IS NOT NULL AND governance_decision_id IS NOT NULL))));

-- ---------------------------------------------------------------------------------------
-- B5. The shared rule parser: the closed permission vocabulary becomes exactly the 23 tags; L15 registry rules are
--     organisation-local. Same signature, owner, ACL (owner-only), volatility and pinned search_path. Every other branch,
--     the frame and the content hash are unchanged, so every stored Authority Policy version re-hashes identically.
-- ---------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION gov_repo.l14_parse_authority_policy_rules_v1(p_organisation_id uuid, p_rules jsonb)
RETURNS TABLE (
  rule_ordinal integer, role_id uuid, permission text, requested_action text, source_class text,
  source_disposition text, scope_tag text, scope_canonical_kind text, scope_canonical_object_id text,
  scope_relationship_type text, scope_relationship_id text, scope_relationship_state_id text,
  allow_self_validation boolean, allow_future_dating boolean, allow_backdating boolean, rule_frame text
)
LANGUAGE plpgsql
STABLE
SET search_path = pg_catalog, pg_temp
AS $parse$
#variable_conflict use_column
DECLARE
  c_keys CONSTANT text[] := ARRAY[
    'allowBackdating','allowFutureDating','allowSelfValidation','permission','requestedAction','roleId',
    'scopeCanonicalKind','scopeCanonicalObjectId','scopeRelationshipId','scopeRelationshipStateId',
    'scopeRelationshipType','scopeTag','sourceClass','sourceDisposition'];
  c_permissions CONSTANT text[] := ARRAY[
    'L14_AUTHORITY_POLICY_ADMIT','L14_PARTY_ADMIT','L14_DOMAIN_ADMIT','L14_CONTROL_DEFINITION_ADMIT',
    'L14_POLICY_CONTENT_ADMIT','L14_AUTHORITY_POLICY_ADMIN','L14_PARTY_VALIDATE','L14_DOMAIN_VALIDATE',
    'L14_CONTROL_DEFINITION_VALIDATE','L14_POLICY_VERSION_VALIDATE','L14_RESPONSIBILITY_VALIDATE','L14_BUSINESS_CONTEXT_VALIDATE',
    'L14_POLICY_APPLICABILITY_VALIDATE','L14_CONTROL_APPLICABILITY_VALIDATE','L14_CONTROL_ASSESSMENT_VALIDATE',
    -- M17-S0 (D-01): the eight L15 permissions; the closed vocabulary is exactly 23 tags.
    'L15_RISK_SCENARIO_ADMIT','L15_RISK_SCENARIO_VALIDATE','L15_RISK_METHODOLOGY_ADMIT','L15_RISK_METHODOLOGY_VALIDATE',
    'L15_GOVERNED_RISK_VALIDATE','L15_RISK_ASSESSMENT_VALIDATE','L15_RISK_TREATMENT_VALIDATE','L15_RISK_ACCEPTANCE_VALIDATE'];
  c_actions CONSTANT text[] := ARRAY['ADMIT','VALIDATE','REJECT','DEFER','REVOKE'];
  c_sources CONSTANT text[] := ARRAY['SYSTEM_SEED','LOCAL_HUMAN','SOURCE_CONNECTION'];
  c_dispositions CONSTANT text[] := ARRAY['AUTHORITATIVE','CONTRIBUTING','NON_AUTHORITATIVE'];
  c_scopes CONSTANT text[] := ARRAY['ALL_ALLOWED_TARGETS','CANONICAL_KIND','CANONICAL_OBJECT','RELATIONSHIP_TYPE','RELATIONSHIP_STATE'];
  c_kinds CONSTANT text[] := ARRAY['AGENT','AGENT_VERSION','MODEL','TOOL','MCP_SERVER','API','PROMPT',
    'KNOWLEDGE_BASE','DATA_ASSET','DATA_ELEMENT','SKILL'];
  c_relationship_types CONSTANT text[] := ARRAY['USES_MODEL','USES_TOOL','USES_MCP','INVOKES','USES_PROMPT',
    'USES_KNOWLEDGE_BASE','USES_SKILL','EXPOSES','HANDOFF_TO','READS_FROM','WRITES_TO','DERIVED_FROM'];
  v_element jsonb;
  v_key text;
  v_role text;
  v_permission text;
  v_action text;
  v_scope text;
  v_kind text;
  v_object text;
  v_relationship_type text;
  v_relationship_id text;
  v_relationship_state text;
BEGIN
  IF p_organisation_id IS NULL OR p_rules IS NULL OR pg_catalog.jsonb_typeof(p_rules) <> 'array'
     OR pg_catalog.jsonb_array_length(p_rules) > 500 THEN
    RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'RULES_MALFORMED';
  END IF;

  FOR v_element IN SELECT e.value FROM pg_catalog.jsonb_array_elements(p_rules) AS e(value) LOOP
    IF pg_catalog.jsonb_typeof(v_element) <> 'object'
       OR (SELECT pg_catalog.array_agg(k.key ORDER BY k.key COLLATE "C")
           FROM pg_catalog.jsonb_object_keys(v_element) AS k(key)) IS DISTINCT FROM c_keys THEN
      RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'RULE_SHAPE_INVALID';
    END IF;
    FOREACH v_key IN ARRAY ARRAY['roleId','permission','requestedAction','sourceClass','sourceDisposition','scopeTag'] LOOP
      IF pg_catalog.jsonb_typeof(v_element -> v_key) <> 'string' THEN
        RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'RULE_FIELD_TYPE_INVALID';
      END IF;
    END LOOP;
    FOREACH v_key IN ARRAY ARRAY['scopeCanonicalKind','scopeCanonicalObjectId','scopeRelationshipType',
                                 'scopeRelationshipId','scopeRelationshipStateId'] LOOP
      IF pg_catalog.jsonb_typeof(v_element -> v_key) NOT IN ('string','null')
         OR (pg_catalog.jsonb_typeof(v_element -> v_key) = 'string'
             AND (pg_catalog.length(v_element ->> v_key) NOT BETWEEN 1 AND 500
                  OR v_element ->> v_key <> pg_catalog.btrim(v_element ->> v_key))) THEN
        RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'RULE_OPERAND_INVALID';
      END IF;
    END LOOP;
    FOREACH v_key IN ARRAY ARRAY['allowSelfValidation','allowFutureDating','allowBackdating'] LOOP
      IF pg_catalog.jsonb_typeof(v_element -> v_key) <> 'boolean' THEN
        RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'RULE_FIELD_TYPE_INVALID';
      END IF;
    END LOOP;

    v_role := v_element ->> 'roleId';
    v_permission := v_element ->> 'permission';
    v_action := v_element ->> 'requestedAction';
    v_scope := v_element ->> 'scopeTag';
    v_kind := v_element ->> 'scopeCanonicalKind';
    v_object := v_element ->> 'scopeCanonicalObjectId';
    v_relationship_type := v_element ->> 'scopeRelationshipType';
    v_relationship_id := v_element ->> 'scopeRelationshipId';
    v_relationship_state := v_element ->> 'scopeRelationshipStateId';

    IF v_permission <> ALL (c_permissions) OR v_action <> ALL (c_actions)
       OR (v_element ->> 'sourceClass') <> ALL (c_sources)
       OR (v_element ->> 'sourceDisposition') <> ALL (c_dispositions)
       OR v_scope <> ALL (c_scopes)
       OR (v_kind IS NOT NULL AND v_kind <> ALL (c_kinds))
       OR (v_relationship_type IS NOT NULL AND v_relationship_type <> ALL (c_relationship_types)) THEN
      RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'RULE_VOCABULARY_UNKNOWN';
    END IF;
    IF v_role !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'RULE_ROLE_MALFORMED';
    END IF;
    PERFORM 1 FROM gov_repo.governance_roles AS gr WHERE gr.role_id = v_role::uuid;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'RULE_ROLE_UNRESOLVED';
    END IF;
    IF NOT (
      (v_scope = 'ALL_ALLOWED_TARGETS' AND v_kind IS NULL AND v_object IS NULL AND v_relationship_type IS NULL
        AND v_relationship_id IS NULL AND v_relationship_state IS NULL)
      OR (v_scope = 'CANONICAL_KIND' AND v_kind IS NOT NULL AND v_object IS NULL AND v_relationship_type IS NULL
        AND v_relationship_id IS NULL AND v_relationship_state IS NULL)
      OR (v_scope = 'CANONICAL_OBJECT' AND v_kind IS NOT NULL AND v_object IS NOT NULL AND v_relationship_type IS NULL
        AND v_relationship_id IS NULL AND v_relationship_state IS NULL)
      OR (v_scope = 'RELATIONSHIP_TYPE' AND v_relationship_type IS NOT NULL AND v_kind IS NULL AND v_object IS NULL
        AND v_relationship_id IS NULL AND v_relationship_state IS NULL)
      OR (v_scope = 'RELATIONSHIP_STATE' AND v_relationship_id IS NOT NULL AND v_relationship_state IS NOT NULL
        AND v_kind IS NULL AND v_object IS NULL AND v_relationship_type IS NULL)) THEN
      RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'RULE_SCOPE_OPERANDS_INVALID';
    END IF;
    IF (v_permission LIKE '%\_ADMIT' ESCAPE '\') <> (v_action = 'ADMIT') THEN
      RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'RULE_PERMISSION_ACTION_INCOMPATIBLE';
    END IF;
    IF v_permission IN ('L14_AUTHORITY_POLICY_ADMIT','L14_AUTHORITY_POLICY_ADMIN') AND v_scope <> 'ALL_ALLOWED_TARGETS' THEN
      RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'RULE_AUTHORITY_SCOPE_INVALID';
    END IF;
    -- M17-S0 (D-01): L15 registry administration is organisation-local only (mirror of the M16 D-14 registry rule).
    IF v_permission IN ('L15_RISK_SCENARIO_ADMIT','L15_RISK_SCENARIO_VALIDATE','L15_RISK_METHODOLOGY_ADMIT',
                        'L15_RISK_METHODOLOGY_VALIDATE') AND v_scope <> 'ALL_ALLOWED_TARGETS' THEN
      RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'RULE_REGISTRY_SCOPE_INVALID';
    END IF;
    IF v_action = 'ADMIT' AND ((v_element -> 'allowSelfValidation')::boolean
       OR (v_element -> 'allowFutureDating')::boolean OR (v_element -> 'allowBackdating')::boolean) THEN
      RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'RULE_ADMIT_FLAGS_INVALID';
    END IF;
    IF v_scope = 'CANONICAL_OBJECT' THEN
      PERFORM 1 FROM gov_repo.canonical_objects AS co
      WHERE co.organisation_id = p_organisation_id AND co.canonical_object_id = v_object AND co.kind = v_kind;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'RULE_SCOPE_REFERENCE_UNRESOLVED';
      END IF;
    ELSIF v_scope = 'RELATIONSHIP_STATE' THEN
      -- Exact read-only three-operand lookup (§16). No DDL/DML/uniqueness on this F2 table.
      PERFORM 1 FROM gov_repo.canonical_relationships AS cr
      WHERE cr.organisation_id = p_organisation_id AND cr.relationship_id = v_relationship_id
        AND cr.relationship_state_id = v_relationship_state;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'RULE_SCOPE_REFERENCE_UNRESOLVED';
      END IF;
    END IF;
  END LOOP;

  RETURN QUERY
  WITH typed AS (
    SELECT (e.value ->> 'roleId')::uuid AS t_role_id, e.value ->> 'permission' AS t_permission,
           e.value ->> 'requestedAction' AS t_action, e.value ->> 'sourceClass' AS t_source,
           e.value ->> 'sourceDisposition' AS t_disposition, e.value ->> 'scopeTag' AS t_scope,
           e.value ->> 'scopeCanonicalKind' AS t_kind, e.value ->> 'scopeCanonicalObjectId' AS t_object,
           e.value ->> 'scopeRelationshipType' AS t_relationship_type,
           e.value ->> 'scopeRelationshipId' AS t_relationship_id,
           e.value ->> 'scopeRelationshipStateId' AS t_relationship_state,
           (e.value -> 'allowSelfValidation')::boolean AS t_self,
           (e.value -> 'allowFutureDating')::boolean AS t_future,
           (e.value -> 'allowBackdating')::boolean AS t_back
    FROM pg_catalog.jsonb_array_elements(p_rules) AS e(value)
  ), framed AS (
    SELECT t.*, gov_repo.l14_authority_policy_rule_frame_v1(t.t_role_id, t.t_permission, t.t_action, t.t_source,
      t.t_disposition, t.t_scope, t.t_kind, t.t_object, t.t_relationship_type, t.t_relationship_id,
      t.t_relationship_state, t.t_self, t.t_future, t.t_back) AS t_frame
    FROM typed AS t
  )
  SELECT (pg_catalog.row_number() OVER (ORDER BY pg_catalog.convert_to(f.t_frame, 'UTF8')))::integer,
         f.t_role_id, f.t_permission, f.t_action, f.t_source, f.t_disposition, f.t_scope, f.t_kind, f.t_object,
         f.t_relationship_type, f.t_relationship_id, f.t_relationship_state, f.t_self, f.t_future, f.t_back, f.t_frame
  FROM framed AS f
  ORDER BY pg_catalog.convert_to(f.t_frame, 'UTF8');
END;
$parse$;

-- ---------------------------------------------------------------------------------------
-- C. Closed L15 subject x action -> permission mapping (ADR-GOVIA-M16-AUTHORITY-POLICY-M17-EXTENSION-v1 §4). NULL for
--    every L14 subject, RISK_SIGNAL / RISK_HYPOTHESIS, an unknown value and ADMIT on a non-registry L15 subject.
-- ---------------------------------------------------------------------------------------
CREATE FUNCTION gov_repo.l15_governance_permission_v1(p_subject_kind text, p_requested_action text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, pg_temp
AS $map$
  SELECT CASE
    WHEN p_requested_action IS NULL OR p_requested_action NOT IN ('ADMIT','VALIDATE','REJECT','DEFER','REVOKE') THEN NULL
    WHEN p_subject_kind = 'RISK_SCENARIO_DEFINITION' THEN
      CASE WHEN p_requested_action = 'ADMIT' THEN 'L15_RISK_SCENARIO_ADMIT' ELSE 'L15_RISK_SCENARIO_VALIDATE' END
    WHEN p_subject_kind = 'RISK_METHODOLOGY' THEN
      CASE WHEN p_requested_action = 'ADMIT' THEN 'L15_RISK_METHODOLOGY_ADMIT' ELSE 'L15_RISK_METHODOLOGY_VALIDATE' END
    WHEN p_requested_action = 'ADMIT' THEN NULL
    WHEN p_subject_kind = 'GOVERNED_RISK' THEN 'L15_GOVERNED_RISK_VALIDATE'
    WHEN p_subject_kind = 'RISK_ASSESSMENT' THEN 'L15_RISK_ASSESSMENT_VALIDATE'
    WHEN p_subject_kind = 'RISK_TREATMENT' THEN 'L15_RISK_TREATMENT_VALIDATE'
    WHEN p_subject_kind = 'RISK_ACCEPTANCE' THEN 'L15_RISK_ACCEPTANCE_VALIDATE'
  END
$map$;

-- C1. Every authorization rule snapshot is permission-exact for its decision: an L15 decision snapshots only the mapped
--     L15 permission for its exact action; an L14 decision never snapshots an L15 permission. (L14 permission alone never
--     authorizes L15; L15 permission never authorizes L14.)
CREATE FUNCTION gov_repo.l15_decision_rule_isolation_guard_v1()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, pg_temp
AS $guard$
DECLARE
  v_subject text;
  v_action text;
BEGIN
  SELECT a.subject_kind, a.requested_action INTO v_subject, v_action
  FROM gov_repo.l14_authorization_decisions AS a
  WHERE a.organisation_id = NEW.organisation_id AND a.authorization_decision_id = NEW.authorization_decision_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'RULE_SNAPSHOT_DECISION_UNRESOLVED';
  END IF;
  IF v_subject IN ('RISK_SCENARIO_DEFINITION','RISK_METHODOLOGY','GOVERNED_RISK',
                   'RISK_ASSESSMENT','RISK_TREATMENT','RISK_ACCEPTANCE') THEN
    IF NEW.permission IS DISTINCT FROM gov_repo.l15_governance_permission_v1(v_subject, v_action)
       OR NEW.requested_action IS DISTINCT FROM v_action THEN
      RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'L15_PERMISSION_SUBJECT_MISMATCH';
    END IF;
  ELSIF NEW.permission LIKE 'L15\_%' ESCAPE '\' THEN
    RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'L15_PERMISSION_SUBJECT_MISMATCH';
  END IF;
  RETURN NEW;
END;
$guard$;
CREATE TRIGGER l15_authorization_decision_rules_isolation_guard
  BEFORE INSERT ON gov_repo.l14_authorization_decision_rules
  FOR EACH ROW EXECUTE FUNCTION gov_repo.l15_decision_rule_isolation_guard_v1();
ALTER TABLE gov_repo.l14_authorization_decision_rules ENABLE ALWAYS TRIGGER l15_authorization_decision_rules_isolation_guard;

-- C2. An L15 ALLOW is structurally impossible without effective-policy L15 authority: at commit it must rest on an
--     AUTHORITY_POLICY_VERSION basis (never bootstrap, never basis-less), snapshot at least one AUTHORITY_POLICY_RULE of
--     that exact basis carrying the mapped permission and action, and be made by an ACTIVE human governance user of the
--     same ACTIVE organisation. A service_role / technical caller cannot satisfy this by construction.
CREATE FUNCTION gov_repo.l15_authorization_allow_guard_v1()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
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
CREATE CONSTRAINT TRIGGER l15_authorization_decisions_allow_guard
  AFTER INSERT ON gov_repo.l14_authorization_decisions
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  WHEN (NEW.result = 'ALLOW' AND NEW.subject_kind IN ('RISK_SCENARIO_DEFINITION','RISK_METHODOLOGY','GOVERNED_RISK',
        'RISK_ASSESSMENT','RISK_TREATMENT','RISK_ACCEPTANCE'))
  EXECUTE FUNCTION gov_repo.l15_authorization_allow_guard_v1();
ALTER TABLE gov_repo.l14_authorization_decisions ENABLE ALWAYS TRIGGER l15_authorization_decisions_allow_guard;

-- ---------------------------------------------------------------------------------------
-- D. No L15 bootstrap: an L15 rule may only enter an Authority Policy version admitted under the effective policy
--    (AUTHORITY_POLICY_VERSION basis). The bootstrap-admitted first version can never carry one, so
--    SYSTEM_BOOTSTRAP_L14_AUTHORITY_V1 never validates an L15 rule. Stored rules are never rewritten.
-- ---------------------------------------------------------------------------------------
CREATE FUNCTION gov_repo.l15_authority_policy_rule_admission_basis_guard_v1()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, pg_temp
AS $guard$
DECLARE
  v_basis text;
BEGIN
  IF NEW.permission LIKE 'L15\_%' ESCAPE '\' THEN
    SELECT a.authority_basis INTO v_basis
    FROM gov_repo.l14_authority_policy_versions AS v
    JOIN gov_repo.l14_authorization_decisions AS a
      ON a.organisation_id = v.organisation_id AND a.authorization_decision_id = v.admission_authorization_decision_id
    WHERE v.organisation_id = NEW.organisation_id AND v.authority_policy_id = NEW.authority_policy_id
      AND v.version_id = NEW.version_id;
    IF v_basis IS DISTINCT FROM 'AUTHORITY_POLICY_VERSION' THEN
      RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'RULE_L15_BOOTSTRAP_FORBIDDEN';
    END IF;
  END IF;
  RETURN NEW;
END;
$guard$;
CREATE TRIGGER l15_authority_policy_rules_admission_basis_guard
  BEFORE INSERT ON gov_repo.l14_authority_policy_rules
  FOR EACH ROW EXECUTE FUNCTION gov_repo.l15_authority_policy_rule_admission_basis_guard_v1();
ALTER TABLE gov_repo.l14_authority_policy_rules ENABLE ALWAYS TRIGGER l15_authority_policy_rules_admission_basis_guard;

-- New routines are owner-only (never application-executable).
REVOKE ALL ON FUNCTION
  gov_repo.l15_governance_permission_v1(text, text),
  gov_repo.l15_decision_rule_isolation_guard_v1(),
  gov_repo.l15_authorization_allow_guard_v1(),
  gov_repo.l15_authority_policy_rule_admission_basis_guard_v1()
FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------
-- E. D-05: legacy risk register write-freeze. Rows, columns, defaults, constraints, triggers and RLS are untouched;
--    the risk_treatments -> risk_entries ON DELETE CASCADE path is neutralized because no application role can DELETE.
--    SELECT stays (legacy consumers are labeled LEGACY / NON-AUTHORITATIVE; M17 never reads these stores).
-- ---------------------------------------------------------------------------------------
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON gov_repo.risk_entries FROM PUBLIC, anon, authenticated, service_role;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON gov_repo.risk_treatments FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON TABLE gov_repo.risk_entries IS 'LEGACY / NON-AUTHORITATIVE risk register (M17 ADR §23: QUARANTINED AS AUTHORITY). Application write-frozen by M17-S0 (D-05); history preserved; never an L15 input.';
COMMENT ON TABLE gov_repo.risk_treatments IS 'LEGACY / NON-AUTHORITATIVE risk treatments (M17 ADR §23: QUARANTINED AS AUTHORITY). Application write-frozen by M17-S0 (D-05); history preserved; never an L15 input.';

-- ---------------------------------------------------------------------------------------
-- F. Postflight.
-- ---------------------------------------------------------------------------------------
DO $postflight$
DECLARE
  v_crypto name := (SELECT e.extnamespace::regnamespace::name FROM pg_catalog.pg_extension AS e WHERE e.extname = 'pgcrypto');
  v_vector name := (SELECT e.extnamespace::regnamespace::name FROM pg_catalog.pg_extension AS e WHERE e.extname = 'vector');
  v_app CONSTANT text[] := ARRAY['service_role','authenticated','anon'];
  v_widened CONSTANT text[] := ARRAY[
    'l14_authority_policy_rules|l14_authority_policy_rules_permission_check',
    'l14_authorization_decision_rules|l14_authorization_decision_rules_permission_check',
    'l14_authorization_decisions|l14_authorization_decisions_subject_kind_check',
    'l14_proposals|l14_proposals_subject_kind_check',
    'l14_governance_decisions|l14_governance_decisions_subject_kind_check',
    'l14_governance_decisions|l14_governance_decisions_reason_code_check',
    'l14_command_results|l14_command_results_subject_kind_check',
    'l14_command_results|l14_command_results_command_kind_check',
    'l14_command_results|l14_command_results_command_subject_check',
    'l14_command_results|l14_command_results_shape_check']::text[];
  v_entry record;
  v_oid oid;
  v_proc record;
  v_rel text;
  v_role text;
  v_privilege text;
  v_count bigint;
  v_hash text;
  v_approved oid[] := ARRAY[]::oid[];
BEGIN
  -- P1. Exact widened vocabularies.
  FOR v_rel, v_hash IN SELECT x.c, x.d FROM (VALUES
      ('l14_authority_policy_rules_permission_check', 'P'), ('l14_authorization_decision_rules_permission_check', 'P'),
      ('l14_authorization_decisions_subject_kind_check', 'S'), ('l14_proposals_subject_kind_check', 'S'),
      ('l14_governance_decisions_subject_kind_check', 'S'), ('l14_command_results_subject_kind_check', 'S'),
      ('l14_governance_decisions_reason_code_check', 'R'), ('l14_command_results_command_kind_check', 'C')) AS x(c, d)
  LOOP
    IF (SELECT pg_catalog.array_agg(DISTINCT m.v[1] ORDER BY m.v[1])
        FROM pg_catalog.pg_constraint AS k
        CROSS JOIN LATERAL pg_catalog.regexp_matches(pg_catalog.pg_get_constraintdef(k.oid), '''([A-Z0-9_]+)''', 'g') AS m(v)
        WHERE k.connamespace = 'gov_repo'::regnamespace AND k.conname = v_rel)
       IS DISTINCT FROM (SELECT pg_catalog.array_agg(u.v ORDER BY u.v) FROM pg_catalog.unnest(CASE v_hash
         WHEN 'P' THEN ARRAY[
           'L14_AUTHORITY_POLICY_ADMIT','L14_PARTY_ADMIT','L14_DOMAIN_ADMIT','L14_CONTROL_DEFINITION_ADMIT',
           'L14_POLICY_CONTENT_ADMIT','L14_AUTHORITY_POLICY_ADMIN','L14_PARTY_VALIDATE','L14_DOMAIN_VALIDATE',
           'L14_CONTROL_DEFINITION_VALIDATE','L14_POLICY_VERSION_VALIDATE','L14_RESPONSIBILITY_VALIDATE','L14_BUSINESS_CONTEXT_VALIDATE',
           'L14_POLICY_APPLICABILITY_VALIDATE','L14_CONTROL_APPLICABILITY_VALIDATE','L14_CONTROL_ASSESSMENT_VALIDATE','L15_RISK_SCENARIO_ADMIT',
           'L15_RISK_SCENARIO_VALIDATE','L15_RISK_METHODOLOGY_ADMIT','L15_RISK_METHODOLOGY_VALIDATE','L15_GOVERNED_RISK_VALIDATE',
           'L15_RISK_ASSESSMENT_VALIDATE','L15_RISK_TREATMENT_VALIDATE','L15_RISK_ACCEPTANCE_VALIDATE']
         WHEN 'S' THEN ARRAY[
           'AUTHORITY_POLICY_VERSION','GOVERNANCE_PARTY','BUSINESS_DOMAIN','INFORMATION_DOMAIN',
           'CONTROL_DEFINITION','POLICY_VERSION','RESPONSIBILITY_ASSIGNMENT','BUSINESS_CONTEXT_ASSIGNMENT',
           'POLICY_APPLICABILITY','CONTROL_APPLICABILITY','CONTROL_ASSESSMENT','RISK_SCENARIO_DEFINITION',
           'RISK_METHODOLOGY','GOVERNED_RISK','RISK_ASSESSMENT','RISK_TREATMENT',
           'RISK_ACCEPTANCE']
         WHEN 'R' THEN ARRAY[
           'AUTHORITY_POLICY_VALIDATED','AUTHORITY_POLICY_REJECTED','AUTHORITY_POLICY_DEFERRED','AUTHORITY_POLICY_REVOKED',
           'GOVERNANCE_PARTY_VALIDATED','GOVERNANCE_PARTY_REJECTED','GOVERNANCE_PARTY_DEFERRED','GOVERNANCE_PARTY_REVOKED',
           'BUSINESS_DOMAIN_VALIDATED','BUSINESS_DOMAIN_REJECTED','BUSINESS_DOMAIN_DEFERRED','BUSINESS_DOMAIN_REVOKED',
           'INFORMATION_DOMAIN_VALIDATED','INFORMATION_DOMAIN_REJECTED','INFORMATION_DOMAIN_DEFERRED','INFORMATION_DOMAIN_REVOKED',
           'CONTROL_DEFINITION_VALIDATED','CONTROL_DEFINITION_REJECTED','CONTROL_DEFINITION_DEFERRED','CONTROL_DEFINITION_REVOKED',
           'POLICY_VERSION_VALIDATED','POLICY_VERSION_REJECTED','POLICY_VERSION_DEFERRED','POLICY_VERSION_REVOKED',
           'RESPONSIBILITY_ASSIGNMENT_VALIDATED','RESPONSIBILITY_ASSIGNMENT_REJECTED','RESPONSIBILITY_ASSIGNMENT_DEFERRED','RESPONSIBILITY_ASSIGNMENT_REVOKED',
           'BUSINESS_CONTEXT_ASSIGNMENT_VALIDATED','BUSINESS_CONTEXT_ASSIGNMENT_REJECTED','BUSINESS_CONTEXT_ASSIGNMENT_DEFERRED','BUSINESS_CONTEXT_ASSIGNMENT_REVOKED',
           'POLICY_APPLICABILITY_VALIDATED','POLICY_APPLICABILITY_REJECTED','POLICY_APPLICABILITY_DEFERRED','POLICY_APPLICABILITY_REVOKED',
           'CONTROL_APPLICABILITY_VALIDATED','CONTROL_APPLICABILITY_REJECTED','CONTROL_APPLICABILITY_DEFERRED','CONTROL_APPLICABILITY_REVOKED',
           'CONTROL_ASSESSMENT_VALIDATED','CONTROL_ASSESSMENT_REJECTED','CONTROL_ASSESSMENT_DEFERRED','CONTROL_ASSESSMENT_REVOKED',
           'RISK_SCENARIO_DEFINITION_VALIDATED','RISK_SCENARIO_DEFINITION_REJECTED','RISK_SCENARIO_DEFINITION_DEFERRED','RISK_SCENARIO_DEFINITION_REVOKED',
           'RISK_METHODOLOGY_VALIDATED','RISK_METHODOLOGY_REJECTED','RISK_METHODOLOGY_DEFERRED','RISK_METHODOLOGY_REVOKED',
           'GOVERNED_RISK_VALIDATED','GOVERNED_RISK_REJECTED','GOVERNED_RISK_DEFERRED','GOVERNED_RISK_REVOKED',
           'RISK_ASSESSMENT_VALIDATED','RISK_ASSESSMENT_REJECTED','RISK_ASSESSMENT_DEFERRED','RISK_ASSESSMENT_REVOKED',
           'RISK_TREATMENT_VALIDATED','RISK_TREATMENT_REJECTED','RISK_TREATMENT_DEFERRED','RISK_TREATMENT_REVOKED',
           'RISK_ACCEPTANCE_VALIDATED','RISK_ACCEPTANCE_REJECTED','RISK_ACCEPTANCE_DEFERRED','RISK_ACCEPTANCE_REVOKED']
         ELSE ARRAY[
           'ADMIT_AUTHORITY_POLICY_VERSION','SUBMIT_PROPOSAL','DECIDE_PROPOSAL',
           'ADMIT_GOVERNANCE_PARTY','ADMIT_BUSINESS_DOMAIN','ADMIT_INFORMATION_DOMAIN',
           'ADMIT_CONTROL_DEFINITION_VERSION','ADMIT_GOVERNANCE_POLICY','ADMIT_POLICY_VERSION',
           'ADMIT_RISK_SCENARIO_DEFINITION_VERSION','ADMIT_RISK_METHODOLOGY_VERSION'] END) AS u(v)) THEN
      RAISE EXCEPTION 'M17_S0_POSTFLIGHT: % is not the exact D-01 widened vocabulary', v_rel;
    END IF;
  END LOOP;
  -- P2. Only the enumerated widened constraints changed; the four new ones exist; nothing else (l14_fact_states,
  --     l14_registry_states, l14_support_links, every M16 typed table, canonical tables, risk stores) changed.
  IF EXISTS (
       SELECT 1 FROM m17_s0_constraint_capture AS b
       LEFT JOIN (SELECT c.conrelid::regclass::text AS relation, c.conname::text AS conname, pg_catalog.pg_get_constraintdef(c.oid) AS def
                  FROM pg_catalog.pg_constraint AS c JOIN pg_catalog.pg_class AS r ON r.oid = c.conrelid
                  WHERE r.relnamespace = 'gov_repo'::regnamespace) AS a
         ON a.relation = b.relation AND a.conname = b.conname
       WHERE (a.def IS DISTINCT FROM b.def) AND NOT (pg_catalog.replace(b.relation, 'gov_repo.', '') || '.' || b.conname = ANY (
         SELECT pg_catalog.split_part(w, '|', 1) || '.' || pg_catalog.split_part(w, '|', 2) FROM pg_catalog.unnest(v_widened) AS w)))
     OR (SELECT pg_catalog.array_agg(pg_catalog.replace(c.conrelid::regclass::text, 'gov_repo.', '') || '.' || c.conname::text
                                   ORDER BY pg_catalog.replace(c.conrelid::regclass::text, 'gov_repo.', '') || '.' || c.conname::text COLLATE "C")
         FROM pg_catalog.pg_constraint AS c JOIN pg_catalog.pg_class AS r ON r.oid = c.conrelid
         WHERE r.relnamespace = 'gov_repo'::regnamespace
           AND NOT EXISTS (SELECT 1 FROM m17_s0_constraint_capture AS b
                           WHERE b.relation = c.conrelid::regclass::text AND b.conname = c.conname::text))
        IS DISTINCT FROM ARRAY['l14_authority_policy_rules.l14_authority_policy_rules_l15_registry_scope_check', 'l14_authorization_decision_rules.l14_authorization_decision_rules_l15_no_bootstrap_check', 'l14_authorization_decisions.l14_authorization_decisions_l15_registry_target_check', 'l14_authorization_decisions.l14_authorization_decisions_l15_risk_target_check', 'l14_authorization_decisions.l15_authorization_decisions_allow_guard'] THEN
    RAISE EXCEPTION 'M17_S0_POSTFLIGHT: a constraint outside the D-01 amendment surfaces changed or was added';
  END IF;
  -- P3. Frozen: 11 canonical kinds, 12 relationship types, exactly the five M16 fact families; F2 has no trigger.
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
                            'RESPONSIBILITY_ASSIGNMENT']
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_trigger AS t WHERE t.tgrelid = 'gov_repo.canonical_relationships'::regclass AND NOT t.tgisinternal) THEN
    RAISE EXCEPTION 'M17_S0_POSTFLIGHT: canonical kinds (11) / relationship types (12) / fact families (5) / F2 changed';
  END IF;
  -- P4. RISK_SIGNAL / RISK_HYPOTHESIS are no governance subject anywhere; one Authority Policy identity per organisation;
  --     no L15 bootstrap routine; no L15 table / view / sequence exists (stores are created by later slices).
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_constraint AS k
             WHERE k.connamespace = 'gov_repo'::regnamespace AND k.conrelid IN (
               'gov_repo.l14_authorization_decisions'::regclass, 'gov_repo.l14_proposals'::regclass,
               'gov_repo.l14_governance_decisions'::regclass, 'gov_repo.l14_command_results'::regclass,
               'gov_repo.l14_fact_states'::regclass, 'gov_repo.l14_registry_states'::regclass)
               AND pg_catalog.pg_get_constraintdef(k.oid) ~ 'RISK_(SIGNAL|HYPOTHESIS)')
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint AS k
                    WHERE k.conrelid = 'gov_repo.l14_authority_policies'::regclass AND k.contype = 'u'
                      AND pg_catalog.pg_get_constraintdef(k.oid) = 'UNIQUE (organisation_id)')
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_proc AS p WHERE p.proname ~* 'l15.*bootstrap|bootstrap.*l15')
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_class AS c WHERE c.relnamespace = 'gov_repo'::regnamespace AND c.relname LIKE 'l15\_%' ESCAPE '\')
     OR (SELECT pg_catalog.count(*) FROM pg_catalog.pg_proc AS p WHERE p.pronamespace = 'gov_repo'::regnamespace AND p.proname LIKE 'l15\_%' ESCAPE '\') <> 4
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_proc AS p WHERE p.pronamespace = 'gov_repo'::regnamespace AND p.proname LIKE 'l15\_%' ESCAPE '\'
                AND (p.prosecdef OR p.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, pg_temp']
                     OR pg_catalog.has_function_privilege('service_role', p.oid, 'EXECUTE')
                     OR pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE')
                     OR pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE')
                     OR EXISTS (SELECT 1 FROM pg_catalog.aclexplode(COALESCE(p.proacl, pg_catalog.acldefault('f', p.proowner))) AS a
                                WHERE a.grantee = 0))) THEN
    RAISE EXCEPTION 'M17_S0_POSTFLIGHT: L15 envelope boundary / single Authority Policy / no-bootstrap / owner-only routine violated';
  END IF;
  -- P5. The replaced parser keeps its posture.
  SELECT p.prosecdef, p.proowner, p.proconfig, p.provolatile INTO v_proc FROM pg_catalog.pg_proc AS p
  WHERE p.oid = 'gov_repo.l14_parse_authority_policy_rules_v1(uuid,jsonb)'::regprocedure;
  IF v_proc.prosecdef OR pg_catalog.pg_get_userbyid(v_proc.proowner) <> 'postgres'
     OR v_proc.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, pg_temp'] OR v_proc.provolatile <> 's'
     OR pg_catalog.has_function_privilege('service_role', 'gov_repo.l14_parse_authority_policy_rules_v1(uuid,jsonb)'::regprocedure, 'EXECUTE')
     OR pg_catalog.has_function_privilege('anon', 'gov_repo.l14_parse_authority_policy_rules_v1(uuid,jsonb)'::regprocedure, 'EXECUTE')
     OR pg_catalog.has_function_privilege('authenticated', 'gov_repo.l14_parse_authority_policy_rules_v1(uuid,jsonb)'::regprocedure, 'EXECUTE') THEN
    RAISE EXCEPTION 'M17_S0_POSTFLIGHT: rule parser posture changed';
  END IF;
  -- P6. Definer-capability inventory: the closed application SECURITY DEFINER surface is byte-identical (45 routines;
  --     owner, body hash, config, service_role-only EXECUTE) - no definer was created or replaced by this slice.
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
      RAISE EXCEPTION 'M17_S0_POSTFLIGHT: approved routine % missing', v_entry.sig;
    END IF;
    SELECT p.prosecdef, p.proowner, p.prosrc, p.proconfig, p.proacl INTO v_proc FROM pg_catalog.pg_proc AS p WHERE p.oid = v_oid;
    IF NOT v_proc.prosecdef OR pg_catalog.pg_get_userbyid(v_proc.proowner) <> v_entry.owner_role
       OR pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(v_proc.prosrc, 'UTF8')), 'hex') <> v_entry.sha
       OR COALESCE(pg_catalog.array_to_string(v_proc.proconfig, ';'), '-') <>
          pg_catalog.replace(pg_catalog.replace(v_entry.cfg, '{crypto}', pg_catalog.quote_ident(v_crypto)), '{vschema}', pg_catalog.quote_ident(v_vector))
       OR NOT pg_catalog.has_function_privilege('service_role', v_oid, 'EXECUTE')
       OR pg_catalog.has_function_privilege('anon', v_oid, 'EXECUTE')
       OR pg_catalog.has_function_privilege('authenticated', v_oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'M17_S0_POSTFLIGHT: approved definer % differs from the post-M16 inventory', v_oid::regprocedure;
    END IF;
    v_approved := v_approved || v_oid;
  END LOOP;
  IF pg_catalog.cardinality(v_approved) <> 45
     OR (SELECT pg_catalog.count(*) FROM pg_catalog.pg_proc AS p
         WHERE p.prosecdef AND p.pronamespace NOT IN ('pg_catalog'::regnamespace, 'information_schema'::regnamespace)
           AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_depend AS d
                            WHERE d.classid = 'pg_catalog.pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e')
           AND (pg_catalog.has_function_privilege('service_role', p.oid, 'EXECUTE')
                OR pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE')
                OR pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE')
                OR EXISTS (SELECT 1 FROM pg_catalog.aclexplode(COALESCE(p.proacl, pg_catalog.acldefault('f', p.proowner))) AS a
                            WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE'))
           AND p.oid <> ALL (v_approved)) <> 0 THEN
    RAISE EXCEPTION 'M17_S0_POSTFLIGHT: application SECURITY DEFINER surface is not exactly the 45 post-M16 routines';
  END IF;
  -- P7. Every captured row is byte-identical (M16 governance history, legacy risk stores, legacy agent risk columns).
  FOR v_rel IN SELECT c.relation FROM m17_s0_row_capture AS c WHERE c.relation <> 'agents.legacy_risk_columns' LOOP
    EXECUTE pg_catalog.format(
      'SELECT pg_catalog.count(*), COALESCE(pg_catalog.md5(pg_catalog.string_agg(t::text, %L ORDER BY t::text COLLATE "C")), %L) FROM gov_repo.%I AS t',
      E'\n', 'EMPTY', v_rel) INTO v_count, v_hash;
    IF NOT EXISTS (SELECT 1 FROM m17_s0_row_capture AS c WHERE c.relation = v_rel AND c.row_count = v_count AND c.row_hash = v_hash) THEN
      RAISE EXCEPTION 'M17_S0_POSTFLIGHT: rows of % changed', v_rel;
    END IF;
  END LOOP;
  SELECT pg_catalog.count(*), COALESCE(pg_catalog.md5(pg_catalog.string_agg(
           a.agent_id::text || '|' || a.risk_level::text || '|' || a.ai_act_risk_class::text, E'\n' ORDER BY a.agent_id::text COLLATE "C")), 'EMPTY')
    INTO v_count, v_hash FROM gov_repo.agents AS a;
  IF NOT EXISTS (SELECT 1 FROM m17_s0_row_capture AS c
                 WHERE c.relation = 'agents.legacy_risk_columns' AND c.row_count = v_count AND c.row_hash = v_hash) THEN
    RAISE EXCEPTION 'M17_S0_POSTFLIGHT: legacy agent risk columns changed';
  END IF;
  -- P8. D-05: no application role (directly, by membership, by column grant or through PUBLIC) can write either legacy
  --     risk store; no auto-updatable view reaches them; no application-executable definer writes them.
  FOREACH v_rel IN ARRAY ARRAY['gov_repo.risk_entries','gov_repo.risk_treatments'] LOOP
    FOREACH v_role IN ARRAY v_app LOOP
      FOREACH v_privilege IN ARRAY ARRAY['INSERT','UPDATE','DELETE','TRUNCATE'] LOOP
        IF pg_catalog.has_table_privilege(v_role, v_rel, v_privilege) THEN
          RAISE EXCEPTION 'M17_S0_POSTFLIGHT: % still holds % on %', v_role, v_privilege, v_rel;
        END IF;
      END LOOP;
      IF pg_catalog.has_any_column_privilege(v_role, v_rel, 'INSERT, UPDATE') THEN
        RAISE EXCEPTION 'M17_S0_POSTFLIGHT: % holds a column write privilege on %', v_role, v_rel;
      END IF;
    END LOOP;
    IF EXISTS (SELECT 1 FROM pg_catalog.aclexplode(COALESCE((SELECT c.relacl FROM pg_catalog.pg_class AS c WHERE c.oid = v_rel::regclass),
                 pg_catalog.acldefault('r', (SELECT c.relowner FROM pg_catalog.pg_class AS c WHERE c.oid = v_rel::regclass)))) AS a
               WHERE a.grantee = 0 AND a.privilege_type IN ('INSERT','UPDATE','DELETE','TRUNCATE')) THEN
      RAISE EXCEPTION 'M17_S0_POSTFLIGHT: PUBLIC holds a write privilege on %', v_rel;
    END IF;
  END LOOP;
  IF EXISTS (
       SELECT 1 FROM pg_catalog.pg_rewrite AS w
       JOIN pg_catalog.pg_depend AS d ON d.classid = 'pg_catalog.pg_rewrite'::regclass AND d.objid = w.oid
       JOIN pg_catalog.pg_class AS v ON v.oid = w.ev_class
       WHERE d.refclassid = 'pg_catalog.pg_class'::regclass
         AND d.refobjid IN ('gov_repo.risk_entries'::regclass, 'gov_repo.risk_treatments'::regclass)
         AND w.ev_class NOT IN ('gov_repo.risk_entries'::regclass, 'gov_repo.risk_treatments'::regclass)
         AND (pg_catalog.pg_relation_is_updatable(v.oid, true) & 28) <> 0
         AND (pg_catalog.has_table_privilege('service_role', v.oid, 'INSERT') OR pg_catalog.has_table_privilege('service_role', v.oid, 'UPDATE')
              OR pg_catalog.has_table_privilege('service_role', v.oid, 'DELETE')
              OR pg_catalog.has_table_privilege('authenticated', v.oid, 'INSERT') OR pg_catalog.has_table_privilege('authenticated', v.oid, 'UPDATE')
              OR pg_catalog.has_table_privilege('authenticated', v.oid, 'DELETE')
              OR pg_catalog.has_table_privilege('anon', v.oid, 'INSERT') OR pg_catalog.has_table_privilege('anon', v.oid, 'UPDATE')
              OR pg_catalog.has_table_privilege('anon', v.oid, 'DELETE')))
     OR EXISTS (
       SELECT 1 FROM pg_catalog.pg_proc AS p
       WHERE p.prosecdef AND p.prosrc ~* '(insert\s+into|update|delete\s+from|truncate)\s+(gov_repo\.)?risk_(entries|treatments)'
         AND (pg_catalog.has_function_privilege('service_role', p.oid, 'EXECUTE')
              OR pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE')
              OR pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE'))) THEN
    RAISE EXCEPTION 'M17_S0_POSTFLIGHT: an application write path to the legacy risk register remains';
  END IF;
END;
$postflight$;

COMMIT;
