-- M16-S1B.0: L14 governed-registry framework + typed target-scope authorization evidence (DB only).
-- Architecture: docs/architecture/ADR-GOVIA-OWNERSHIP-BUSINESS-POLICY-CONTROL-ENRICHMENT-v1.md
-- §§4, 6-7, 10, 13-14, 16-18, 20-21 plus the S1B architecture-owner decisions D-1..D-14.
-- ADDITIVE ONLY: the audited S0 / S1A.1 / S1A.2 / S1A.2R1 migrations are NOT edited and the three
-- public Authority Policy RPC bodies are NOT replaced. Never run against a hosted DB from this slice.
--
-- FRAMEWORK ONLY. No registry subject (GOVERNANCE_PARTY, BUSINESS_DOMAIN, INFORMATION_DOMAIN,
-- CONTROL_DEFINITION, POLICY_VERSION) becomes executable here and no public RPC is added. This slice:
--   A. l14_authorization_decisions: typed REQUEST target (ALL_ALLOWED_TARGETS | CANONICAL_OBJECT |
--      RELATIONSHIP_STATE only, D-7), organisation-local scope for AP + registry subjects, no
--      bootstrap basis for registry subjects, and FK-less F-4 audit evidence (attempted content hash,
--      expectation kind, expected ids). Historical S1A rows stay valid as ALL_ALLOWED_TARGETS with
--      NULL audit evidence under an explicit AP-only compatibility CHECK (D-11: the AP ADMIT RPC is
--      NOT modified to populate them).
--   B. l14_authorization_decision_rules: typed scope operands mirroring the frozen five-tag rule
--      union, verified on INSERT against the exact immutable rule row; the internal snapshot helper
--      is CREATE OR REPLACEd (same signature) to copy them.
--   C. l14_governance_decisions widened to the five registry subjects (same table; AP target
--      columns conditionally populated; closed subject x outcome reason-code matrix).
--   D. l14_registry_states: ONE common immutable state envelope (no subject content, no JSON).
--      Per-subject typed detail tables pin the subject in later slices (D-2).
--   E. l14_command_results widened (subject_kind with an AP constant default = metadata-only
--      logical backfill, registry_state_id) without weakening the AP shape.
--   F. l14_support_links widened with ADMISSION (keyed to the exact ALLOW ADMIT authorization) and
--      REGISTRY_STATE owners; the only evidence target remains gov_repo.discovery_evidence.
--   G. D-14: NEW Authority Policy rules for the eight registry permissions must use
--      ALL_ALLOWED_TARGETS (raising insertion guard + NOT VALID CHECK; stored rules are never
--      rewritten; the audited parser is untouched so historical commands still replay exactly).
--      Fact permissions keep all five legal scopes.
--   H. Owner-only helpers: SHARED Authority Policy guard (same advisory key as the S1A exclusive
--      guard), registry subject guard, replay-first syntactic support canonicalization and the
--      post-replay support resolution it defers (the S1B fix for the F-3 class).
--
-- Future S1B command order: base session -> syntactic shape/canonicalization -> DB fingerprint ->
-- guards (ORG -> USER -> ROLES FOR SHARE, AP guard SHARED, registry subject guard EXCLUSIVE) ->
-- replay arbitration -> mutable/reference resolution -> authority -> mutation.
-- F2 untouched: no canonical_relationships DDL/DML; relationship-state target operands carry NO FK and
-- NO uniqueness (future resolution is an exact read-only organisation + relationship + state lookup).
BEGIN;

-- ---------------------------------------------------------------------------------------
-- A. Authorization decisions: typed request target, subject coherence, F-4 audit evidence.
-- ---------------------------------------------------------------------------------------
ALTER TABLE gov_repo.l14_authorization_decisions
  ADD COLUMN target_canonical_kind text,
  ADD COLUMN target_canonical_object_id text,
  ADD COLUMN target_relationship_type text,
  ADD COLUMN target_relationship_id text,
  ADD COLUMN target_relationship_state_id text,
  ADD COLUMN attempted_content_hash text,
  ADD COLUMN expectation_kind text,
  ADD COLUMN expected_latest_version_id uuid,     -- audit value only: deliberately no FK
  ADD COLUMN expected_current_state_id uuid;      -- audit value only: deliberately no FK

ALTER TABLE gov_repo.l14_authorization_decisions
  ADD CONSTRAINT l14_authorization_decisions_target_vocabulary_check CHECK (
    (target_canonical_kind IS NULL OR target_canonical_kind IN (
      'AGENT','AGENT_VERSION','MODEL','TOOL','MCP_SERVER','API','PROMPT','KNOWLEDGE_BASE','DATA_ASSET','DATA_ELEMENT','SKILL'))
    AND (target_relationship_type IS NULL OR target_relationship_type IN (
      'USES_MODEL','USES_TOOL','USES_MCP','INVOKES','USES_PROMPT','USES_KNOWLEDGE_BASE','USES_SKILL',
      'EXPOSES','HANDOFF_TO','READS_FROM','WRITES_TO','DERIVED_FROM'))),
  ADD CONSTRAINT l14_authorization_decisions_target_operand_check CHECK (
    (target_canonical_object_id IS NULL
      OR (pg_catalog.length(target_canonical_object_id) BETWEEN 1 AND 500 AND target_canonical_object_id = pg_catalog.btrim(target_canonical_object_id)))
    AND (target_relationship_id IS NULL
      OR (pg_catalog.length(target_relationship_id) BETWEEN 1 AND 500 AND target_relationship_id = pg_catalog.btrim(target_relationship_id)))
    AND (target_relationship_state_id IS NULL
      OR (pg_catalog.length(target_relationship_state_id) BETWEEN 1 AND 500
          AND target_relationship_state_id = pg_catalog.btrim(target_relationship_state_id)))),
  -- D-7: a REQUEST target is only organisation-local, one exact canonical object, or one exact
  -- relationship state (with its resolved type). CANONICAL_KIND / RELATIONSHIP_TYPE are rule
  -- selectors and are never a standalone request shape.
  ADD CONSTRAINT l14_authorization_decisions_request_target_check CHECK (
    (scope_tag = 'ALL_ALLOWED_TARGETS'
      AND target_canonical_kind IS NULL AND target_canonical_object_id IS NULL AND target_relationship_type IS NULL
      AND target_relationship_id IS NULL AND target_relationship_state_id IS NULL)
    OR (scope_tag = 'CANONICAL_OBJECT'
      AND target_canonical_kind IS NOT NULL AND target_canonical_object_id IS NOT NULL
      AND target_relationship_type IS NULL AND target_relationship_id IS NULL AND target_relationship_state_id IS NULL)
    OR (scope_tag = 'RELATIONSHIP_STATE'
      AND target_relationship_type IS NOT NULL AND target_relationship_id IS NOT NULL AND target_relationship_state_id IS NOT NULL
      AND target_canonical_kind IS NULL AND target_canonical_object_id IS NULL)),
  -- Exact same-tenant canonical object + declared kind. No relationship-state FK/uniqueness (F2).
  ADD CONSTRAINT l14_authorization_decisions_target_object_fkey
    FOREIGN KEY (organisation_id, target_canonical_object_id, target_canonical_kind)
    REFERENCES gov_repo.canonical_objects (organisation_id, canonical_object_id, kind) ON DELETE RESTRICT,
  -- Authority Policy administration and registry administration have no canonical target.
  ADD CONSTRAINT l14_authorization_decisions_organisation_scope_check CHECK (
    subject_kind NOT IN ('AUTHORITY_POLICY_VERSION','GOVERNANCE_PARTY','BUSINESS_DOMAIN','INFORMATION_DOMAIN',
      'CONTROL_DEFINITION','POLICY_VERSION')
    OR scope_tag = 'ALL_ALLOWED_TARGETS'),
  -- The AP subject columns (and their deferred AP-version FK) belong to AUTHORITY_POLICY_VERSION only.
  ADD CONSTRAINT l14_authorization_decisions_ap_subject_check CHECK (
    subject_kind = 'AUTHORITY_POLICY_VERSION' OR (subject_authority_policy_id IS NULL AND subject_version_id IS NULL)),
  -- The bounded first-policy bootstrap never applies to any other subject (ADR §5).
  ADD CONSTRAINT l14_authorization_decisions_bootstrap_subject_check CHECK (
    subject_kind = 'AUTHORITY_POLICY_VERSION'
    OR (authority_basis IS DISTINCT FROM 'SYSTEM_BOOTSTRAP_L14_AUTHORITY_V1'
        AND (deny_reason IS NULL OR deny_reason NOT IN (
          'BOOTSTRAP_ROLE_REQUIRED','BOOTSTRAP_ACTION_NOT_PERMITTED','SUCCESSOR_SELF_AUTHORIZATION_FORBIDDEN')))),
  -- F-4 audit evidence (FK-less by design: a stale or unknown expectation stays recordable).
  ADD CONSTRAINT l14_authorization_decisions_audit_vocabulary_check CHECK (
    (expectation_kind IS NULL OR expectation_kind IN ('EXPECTED_NONE','EXPECTED_CURRENT','NOT_APPLICABLE'))
    AND (attempted_content_hash IS NULL OR (attempted_content_hash ~ '^[0-9a-f]{64}$' AND requested_action = 'ADMIT'))),
  -- Compatibility: ONLY the unmodified S1A Authority Policy path may leave the evidence absent
  -- (legacy-shaped, all NULL). Every other subject must state its expectation explicitly.
  -- COALESCE: a NULL expectation_kind must evaluate FALSE, never pass as an unknown CHECK result.
  ADD CONSTRAINT l14_authorization_decisions_audit_shape_check CHECK (COALESCE(
    (expectation_kind IS NULL AND subject_kind = 'AUTHORITY_POLICY_VERSION' AND attempted_content_hash IS NULL
      AND expected_latest_version_id IS NULL AND expected_current_state_id IS NULL)
    OR (expectation_kind = 'EXPECTED_NONE' AND expected_latest_version_id IS NULL AND expected_current_state_id IS NULL)
    OR (expectation_kind = 'EXPECTED_CURRENT'
      AND (expected_latest_version_id IS NOT NULL OR expected_current_state_id IS NOT NULL))
    OR (expectation_kind = 'NOT_APPLICABLE' AND expected_latest_version_id IS NULL AND expected_current_state_id IS NULL), false)),
  -- Composite candidate keys (each a superset of the PK) for subject/result/action-exact references.
  ADD CONSTRAINT l14_authorization_decisions_subject_unique UNIQUE (organisation_id, authorization_decision_id, subject_kind),
  ADD CONSTRAINT l14_authorization_decisions_action_unique
    UNIQUE (organisation_id, authorization_decision_id, result, subject_kind, requested_action),
  ADD CONSTRAINT l14_authorization_decisions_basis_unique
    UNIQUE (organisation_id, authorization_decision_id, result, subject_kind, requested_action,
            basis_authority_policy_id, basis_version_id, basis_content_hash);

-- ---------------------------------------------------------------------------------------
-- B. Rule snapshot: typed scope operands (mirror of the frozen five-tag rule union).
-- ---------------------------------------------------------------------------------------
ALTER TABLE gov_repo.l14_authorization_decision_rules
  ADD COLUMN scope_canonical_kind text,
  ADD COLUMN scope_canonical_object_id text,
  ADD COLUMN scope_relationship_type text,
  ADD COLUMN scope_relationship_id text,
  ADD COLUMN scope_relationship_state_id text;

ALTER TABLE gov_repo.l14_authorization_decision_rules
  ADD CONSTRAINT l14_authorization_decision_rules_scope_vocabulary_check CHECK (
    (scope_canonical_kind IS NULL OR scope_canonical_kind IN (
      'AGENT','AGENT_VERSION','MODEL','TOOL','MCP_SERVER','API','PROMPT','KNOWLEDGE_BASE','DATA_ASSET','DATA_ELEMENT','SKILL'))
    AND (scope_relationship_type IS NULL OR scope_relationship_type IN (
      'USES_MODEL','USES_TOOL','USES_MCP','INVOKES','USES_PROMPT','USES_KNOWLEDGE_BASE','USES_SKILL',
      'EXPOSES','HANDOFF_TO','READS_FROM','WRITES_TO','DERIVED_FROM'))),
  ADD CONSTRAINT l14_authorization_decision_rules_scope_shape_check CHECK (
    (scope_tag = 'ALL_ALLOWED_TARGETS' AND scope_canonical_kind IS NULL AND scope_canonical_object_id IS NULL
      AND scope_relationship_type IS NULL AND scope_relationship_id IS NULL AND scope_relationship_state_id IS NULL)
    OR (scope_tag = 'CANONICAL_KIND' AND scope_canonical_kind IS NOT NULL AND scope_canonical_object_id IS NULL
      AND scope_relationship_type IS NULL AND scope_relationship_id IS NULL AND scope_relationship_state_id IS NULL)
    OR (scope_tag = 'CANONICAL_OBJECT' AND scope_canonical_kind IS NOT NULL AND scope_canonical_object_id IS NOT NULL
      AND scope_relationship_type IS NULL AND scope_relationship_id IS NULL AND scope_relationship_state_id IS NULL)
    OR (scope_tag = 'RELATIONSHIP_TYPE' AND scope_relationship_type IS NOT NULL AND scope_canonical_kind IS NULL
      AND scope_canonical_object_id IS NULL AND scope_relationship_id IS NULL AND scope_relationship_state_id IS NULL)
    OR (scope_tag = 'RELATIONSHIP_STATE' AND scope_relationship_id IS NOT NULL AND scope_relationship_state_id IS NOT NULL
      AND scope_canonical_kind IS NULL AND scope_canonical_object_id IS NULL AND scope_relationship_type IS NULL)),
  -- The bounded bootstrap grant is organisation-local only.
  ADD CONSTRAINT l14_authorization_decision_rules_bootstrap_scope_check CHECK (
    permission_origin <> 'SYSTEM_BOOTSTRAP' OR scope_tag = 'ALL_ALLOWED_TARGETS');

-- A policy-rule snapshot must be an exact copy of its immutable rule row (never a mutable label).
CREATE FUNCTION gov_repo.l14_decision_rule_snapshot_guard_v1()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, pg_temp
AS $guard$
DECLARE
  v_rule gov_repo.l14_authority_policy_rules%ROWTYPE;
BEGIN
  IF NEW.permission_origin = 'AUTHORITY_POLICY_RULE' THEN
    SELECT r.* INTO v_rule
    FROM gov_repo.l14_authority_policy_rules AS r
    WHERE r.organisation_id = NEW.organisation_id AND r.authority_policy_id = NEW.basis_authority_policy_id
      AND r.version_id = NEW.basis_version_id AND r.rule_ordinal = NEW.basis_rule_ordinal;
    IF NOT FOUND
       OR v_rule.permission IS DISTINCT FROM NEW.permission
       OR v_rule.requested_action IS DISTINCT FROM NEW.requested_action
       OR v_rule.source_class IS DISTINCT FROM NEW.source_class
       OR v_rule.source_disposition IS DISTINCT FROM NEW.source_disposition
       OR v_rule.scope_tag IS DISTINCT FROM NEW.scope_tag
       OR v_rule.scope_canonical_kind IS DISTINCT FROM NEW.scope_canonical_kind
       OR v_rule.scope_canonical_object_id IS DISTINCT FROM NEW.scope_canonical_object_id
       OR v_rule.scope_relationship_type IS DISTINCT FROM NEW.scope_relationship_type
       OR v_rule.scope_relationship_id IS DISTINCT FROM NEW.scope_relationship_id
       OR v_rule.scope_relationship_state_id IS DISTINCT FROM NEW.scope_relationship_state_id
       OR v_rule.allow_self_validation IS DISTINCT FROM NEW.allow_self_validation
       OR v_rule.allow_future_dating IS DISTINCT FROM NEW.allow_future_dating
       OR v_rule.allow_backdating IS DISTINCT FROM NEW.allow_backdating THEN
      RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'RULE_SNAPSHOT_MISMATCH';
    END IF;
  END IF;
  RETURN NEW;
END;
$guard$;
CREATE TRIGGER l14_authorization_decision_rules_snapshot_guard
  BEFORE INSERT ON gov_repo.l14_authorization_decision_rules
  FOR EACH ROW EXECUTE FUNCTION gov_repo.l14_decision_rule_snapshot_guard_v1();
ALTER TABLE gov_repo.l14_authorization_decision_rules ENABLE ALWAYS TRIGGER l14_authorization_decision_rules_snapshot_guard;

-- Same signature as S1A.2; now also copies the exact immutable scope operands.
CREATE OR REPLACE FUNCTION gov_repo.l14_snapshot_policy_rules_v1(
  p_organisation_id uuid, p_authorization_decision_id uuid, p_authority_policy_id uuid, p_version_id uuid,
  p_rule_ordinals integer[])
RETURNS void
LANGUAGE sql
VOLATILE
SET search_path = pg_catalog, pg_temp
AS $$
  INSERT INTO gov_repo.l14_authorization_decision_rules (organisation_id, authorization_decision_id, snapshot_ordinal,
    permission_origin, permission, requested_action, source_class, source_disposition, scope_tag,
    scope_canonical_kind, scope_canonical_object_id, scope_relationship_type, scope_relationship_id,
    scope_relationship_state_id, allow_self_validation, allow_future_dating, allow_backdating,
    basis_authority_policy_id, basis_version_id, basis_rule_ordinal)
  SELECT p_organisation_id, p_authorization_decision_id,
         (pg_catalog.row_number() OVER (ORDER BY r.rule_ordinal))::integer, 'AUTHORITY_POLICY_RULE',
         r.permission, r.requested_action, r.source_class, r.source_disposition, r.scope_tag,
         r.scope_canonical_kind, r.scope_canonical_object_id, r.scope_relationship_type, r.scope_relationship_id,
         r.scope_relationship_state_id, r.allow_self_validation, r.allow_future_dating, r.allow_backdating,
         p_authority_policy_id, p_version_id, r.rule_ordinal
  FROM gov_repo.l14_authority_policy_rules AS r
  WHERE r.organisation_id = p_organisation_id AND r.authority_policy_id = p_authority_policy_id
    AND r.version_id = p_version_id AND r.rule_ordinal = ANY (COALESCE(p_rule_ordinals, ARRAY[]::integer[]))
$$;

-- ---------------------------------------------------------------------------------------
-- C. Proposals + governance decisions: subject-exact references; registry subject widening.
-- ---------------------------------------------------------------------------------------
ALTER TABLE gov_repo.l14_proposals
  ADD CONSTRAINT l14_proposals_subject_kind_unique UNIQUE (organisation_id, proposal_id, subject_kind);

ALTER TABLE gov_repo.l14_governance_decisions
  DROP CONSTRAINT l14_governance_decisions_subject_kind_check,
  DROP CONSTRAINT l14_governance_decisions_reason_code_check,
  DROP CONSTRAINT l14_governance_decisions_reason_check,
  ALTER COLUMN target_authority_policy_id DROP NOT NULL,
  ALTER COLUMN target_version_id DROP NOT NULL,
  ALTER COLUMN target_content_hash DROP NOT NULL;

ALTER TABLE gov_repo.l14_governance_decisions
  ADD CONSTRAINT l14_governance_decisions_subject_kind_check CHECK (subject_kind IN (
    'AUTHORITY_POLICY_VERSION','GOVERNANCE_PARTY','BUSINESS_DOMAIN','INFORMATION_DOMAIN','CONTROL_DEFINITION','POLICY_VERSION')),
  ADD CONSTRAINT l14_governance_decisions_reason_code_check CHECK (reason_code IN (
    'AUTHORITY_POLICY_VALIDATED','AUTHORITY_POLICY_REJECTED','AUTHORITY_POLICY_DEFERRED','AUTHORITY_POLICY_REVOKED',
    'GOVERNANCE_PARTY_VALIDATED','GOVERNANCE_PARTY_REJECTED','GOVERNANCE_PARTY_DEFERRED','GOVERNANCE_PARTY_REVOKED',
    'BUSINESS_DOMAIN_VALIDATED','BUSINESS_DOMAIN_REJECTED','BUSINESS_DOMAIN_DEFERRED','BUSINESS_DOMAIN_REVOKED',
    'INFORMATION_DOMAIN_VALIDATED','INFORMATION_DOMAIN_REJECTED','INFORMATION_DOMAIN_DEFERRED','INFORMATION_DOMAIN_REVOKED',
    'CONTROL_DEFINITION_VALIDATED','CONTROL_DEFINITION_REJECTED','CONTROL_DEFINITION_DEFERRED','CONTROL_DEFINITION_REVOKED',
    'POLICY_VERSION_VALIDATED','POLICY_VERSION_REJECTED','POLICY_VERSION_DEFERRED','POLICY_VERSION_REVOKED')),
  -- Exactly one closed reason code per subject x outcome; never free text.
  ADD CONSTRAINT l14_governance_decisions_reason_check CHECK (
    reason_code = (CASE WHEN subject_kind = 'AUTHORITY_POLICY_VERSION' THEN 'AUTHORITY_POLICY' ELSE subject_kind END)
      || '_' || (CASE outcome WHEN 'VALIDATE' THEN 'VALIDATED' WHEN 'REJECT' THEN 'REJECTED'
                              WHEN 'DEFER' THEN 'DEFERRED' WHEN 'REVOKE' THEN 'REVOKED' END)),
  -- AP target pins exist exactly for AUTHORITY_POLICY_VERSION; registry subjects are pinned by
  -- their typed proposal / typed state detail in later slices.
  ADD CONSTRAINT l14_governance_decisions_target_shape_check CHECK (
    (subject_kind = 'AUTHORITY_POLICY_VERSION' AND target_authority_policy_id IS NOT NULL
      AND target_version_id IS NOT NULL AND target_content_hash IS NOT NULL)
    OR (subject_kind <> 'AUTHORITY_POLICY_VERSION' AND target_authority_policy_id IS NULL
      AND target_version_id IS NULL AND target_content_hash IS NULL)),
  -- The decision outcome is exactly the ALLOWed requested action, for the same subject.
  ADD CONSTRAINT l14_governance_decisions_authorization_action_fkey
    FOREIGN KEY (organisation_id, authorization_decision_id, authorization_result, subject_kind, outcome)
    REFERENCES gov_repo.l14_authorization_decisions (organisation_id, authorization_decision_id, result, subject_kind, requested_action),
  ADD CONSTRAINT l14_governance_decisions_proposal_subject_fkey
    FOREIGN KEY (organisation_id, proposal_id, subject_kind)
    REFERENCES gov_repo.l14_proposals (organisation_id, proposal_id, subject_kind),
  ADD CONSTRAINT l14_governance_decisions_state_link_unique
    UNIQUE (organisation_id, governance_decision_id, subject_kind, outcome, authorization_decision_id);

-- ---------------------------------------------------------------------------------------
-- D. Common immutable registry-state envelope (D-2). No subject content; no JSON/EAV.
-- ---------------------------------------------------------------------------------------
CREATE TABLE gov_repo.l14_registry_states (
  organisation_id uuid NOT NULL REFERENCES gov_repo.organisations (organisation_id),
  state_id uuid NOT NULL,
  subject_kind text NOT NULL CHECK (subject_kind IN (
    'GOVERNANCE_PARTY','BUSINESS_DOMAIN','INFORMATION_DOMAIN','CONTROL_DEFINITION','POLICY_VERSION')),
  state_kind text NOT NULL CHECK (state_kind IN ('VALIDATED','REVOKED')),
  -- The governance outcome that produced this state kind (derived, never supplied).
  decision_outcome text GENERATED ALWAYS AS (
    CASE state_kind WHEN 'VALIDATED' THEN 'VALIDATE' WHEN 'REVOKED' THEN 'REVOKE' END) STORED,
  predecessor_state_id uuid,                     -- lineage predecessor of the same subject key
  revokes_state_id uuid,                         -- exact REVOKE target (never overloaded)
  -- A revocation may only target a VALIDATED state (derived, never supplied).
  revoked_state_kind text GENERATED ALWAYS AS (
    CASE WHEN revokes_state_id IS NULL THEN NULL ELSE 'VALIDATED' END) STORED,
  effective_from timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL,
  governance_decision_id uuid NOT NULL,
  authorization_decision_id uuid NOT NULL,
  authorization_result text NOT NULL DEFAULT 'ALLOW' CHECK (authorization_result = 'ALLOW'),
  authority_policy_id uuid NOT NULL,
  authority_policy_version_id uuid NOT NULL,
  authority_policy_content_hash text NOT NULL CHECK (authority_policy_content_hash ~ '^[0-9a-f]{64}$'),
  trust_state text NOT NULL CHECK (trust_state = 'VALIDATED'),
  source_class text NOT NULL CHECK (source_class IN ('SYSTEM_SEED','LOCAL_HUMAN','SOURCE_CONNECTION')),
  support_status text NOT NULL CHECK (support_status IN ('NONE','PRESENT')),
  CONSTRAINT l14_registry_states_pkey PRIMARY KEY (organisation_id, state_id),
  CONSTRAINT l14_registry_states_subject_unique UNIQUE (organisation_id, state_id, subject_kind),
  CONSTRAINT l14_registry_states_kind_unique UNIQUE (organisation_id, state_id, subject_kind, state_kind),
  CONSTRAINT l14_registry_states_decision_unique UNIQUE (organisation_id, governance_decision_id),
  CONSTRAINT l14_registry_states_authorization_unique UNIQUE (organisation_id, authorization_decision_id),
  -- Lineage is linear for every registry subject key: one successor per predecessor.
  CONSTRAINT l14_registry_states_successor_unique UNIQUE (organisation_id, predecessor_state_id),
  CONSTRAINT l14_registry_states_kind_check CHECK (
    (state_kind = 'VALIDATED' AND revokes_state_id IS NULL)
    OR (state_kind = 'REVOKED' AND revokes_state_id IS NOT NULL)),
  CONSTRAINT l14_registry_states_first_check CHECK (predecessor_state_id IS NOT NULL OR state_kind = 'VALIDATED'),
  CONSTRAINT l14_registry_states_self_check CHECK (
    (predecessor_state_id IS NULL OR predecessor_state_id <> state_id)
    AND (revokes_state_id IS NULL OR revokes_state_id <> state_id)),
  CONSTRAINT l14_registry_states_predecessor_fkey FOREIGN KEY (organisation_id, predecessor_state_id, subject_kind)
    REFERENCES gov_repo.l14_registry_states (organisation_id, state_id, subject_kind),
  CONSTRAINT l14_registry_states_revokes_fkey FOREIGN KEY (organisation_id, revokes_state_id, subject_kind, revoked_state_kind)
    REFERENCES gov_repo.l14_registry_states (organisation_id, state_id, subject_kind, state_kind),
  -- Same subject, outcome-exact, and bound to the same authorization as its governance decision.
  CONSTRAINT l14_registry_states_decision_fkey
    FOREIGN KEY (organisation_id, governance_decision_id, subject_kind, decision_outcome, authorization_decision_id)
    REFERENCES gov_repo.l14_governance_decisions (organisation_id, governance_decision_id, subject_kind, outcome, authorization_decision_id),
  -- ALLOW for the same subject + action, and the recorded Authority Policy basis is exactly the
  -- basis that authorization evaluated (a basis-less or bootstrap decision can never match).
  CONSTRAINT l14_registry_states_authorization_fkey
    FOREIGN KEY (organisation_id, authorization_decision_id, authorization_result, subject_kind, decision_outcome,
                 authority_policy_id, authority_policy_version_id, authority_policy_content_hash)
    REFERENCES gov_repo.l14_authorization_decisions (organisation_id, authorization_decision_id, result, subject_kind,
                 requested_action, basis_authority_policy_id, basis_version_id, basis_content_hash),
  CONSTRAINT l14_registry_states_basis_fkey
    FOREIGN KEY (organisation_id, authority_policy_id, authority_policy_version_id, authority_policy_content_hash)
    REFERENCES gov_repo.l14_authority_policy_versions (organisation_id, authority_policy_id, version_id, content_hash)
);
-- A state is revoked at most once (every registry subject).
CREATE UNIQUE INDEX l14_registry_states_revocation_target_uidx
  ON gov_repo.l14_registry_states (organisation_id, revokes_state_id) WHERE state_kind = 'REVOKED';

CREATE TRIGGER l14_registry_states_immutable BEFORE UPDATE OR DELETE ON gov_repo.l14_registry_states
  FOR EACH ROW EXECUTE FUNCTION gov_repo.l14_history_immutable_v1();
CREATE TRIGGER l14_registry_states_no_truncate BEFORE TRUNCATE ON gov_repo.l14_registry_states
  FOR EACH STATEMENT EXECUTE FUNCTION gov_repo.l14_history_immutable_v1();
ALTER TABLE gov_repo.l14_registry_states ENABLE ALWAYS TRIGGER l14_registry_states_immutable;
ALTER TABLE gov_repo.l14_registry_states ENABLE ALWAYS TRIGGER l14_registry_states_no_truncate;

-- ---------------------------------------------------------------------------------------
-- E. Command results: same durable replay framework for registry subjects.
-- ---------------------------------------------------------------------------------------
-- Constant non-volatile default: a catalog-only logical backfill of every existing row as
-- AUTHORITY_POLICY_VERSION (no table rewrite, no row UPDATE, so no immutability trigger fires).
-- It stays the default so the unmodified S1A RPCs keep writing AP rows unchanged; a registry
-- row can never inherit it silently (command-kind, proposal and authorization references below).
ALTER TABLE gov_repo.l14_command_results
  ADD COLUMN subject_kind text NOT NULL DEFAULT 'AUTHORITY_POLICY_VERSION',
  ADD COLUMN registry_state_id uuid;

ALTER TABLE gov_repo.l14_command_results
  DROP CONSTRAINT l14_command_results_command_kind_check,
  DROP CONSTRAINT l14_command_results_shape_check;

ALTER TABLE gov_repo.l14_command_results
  ADD CONSTRAINT l14_command_results_command_kind_check CHECK (command_kind IN (
    'ADMIT_AUTHORITY_POLICY_VERSION','SUBMIT_PROPOSAL','DECIDE_PROPOSAL',
    'ADMIT_GOVERNANCE_PARTY','ADMIT_BUSINESS_DOMAIN','ADMIT_INFORMATION_DOMAIN',
    'ADMIT_CONTROL_DEFINITION_VERSION','ADMIT_GOVERNANCE_POLICY','ADMIT_POLICY_VERSION')),
  ADD CONSTRAINT l14_command_results_subject_kind_check CHECK (subject_kind IN (
    'AUTHORITY_POLICY_VERSION','GOVERNANCE_PARTY','BUSINESS_DOMAIN','INFORMATION_DOMAIN','CONTROL_DEFINITION','POLICY_VERSION')),
  -- Each admission command kind belongs to exactly one subject kind.
  ADD CONSTRAINT l14_command_results_command_subject_check CHECK (
    command_kind IN ('SUBMIT_PROPOSAL','DECIDE_PROPOSAL')
    OR (command_kind = 'ADMIT_AUTHORITY_POLICY_VERSION' AND subject_kind = 'AUTHORITY_POLICY_VERSION')
    OR (command_kind = 'ADMIT_GOVERNANCE_PARTY' AND subject_kind = 'GOVERNANCE_PARTY')
    OR (command_kind = 'ADMIT_BUSINESS_DOMAIN' AND subject_kind = 'BUSINESS_DOMAIN')
    OR (command_kind = 'ADMIT_INFORMATION_DOMAIN' AND subject_kind = 'INFORMATION_DOMAIN')
    OR (command_kind = 'ADMIT_CONTROL_DEFINITION_VERSION' AND subject_kind = 'CONTROL_DEFINITION')
    OR (command_kind IN ('ADMIT_GOVERNANCE_POLICY','ADMIT_POLICY_VERSION') AND subject_kind = 'POLICY_VERSION')),
  -- AUTHORITY_POLICY_VERSION rows: the S1A shape VERBATIM (plus: never a registry state).
  -- Registry rows: never AP pins; registry_state_id exactly for VALIDATED / REVOKED.
  ADD CONSTRAINT l14_command_results_shape_check CHECK (
    (subject_kind = 'AUTHORITY_POLICY_VERSION' AND registry_state_id IS NULL AND (
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
    OR (subject_kind <> 'AUTHORITY_POLICY_VERSION' AND authority_policy_id IS NULL AND version_id IS NULL AND state_id IS NULL AND (
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
        AND proposal_id IS NOT NULL AND governance_decision_id IS NOT NULL AND registry_state_id IS NULL)))),
  -- A result's subject is exactly its authorization's and its proposal's subject.
  ADD CONSTRAINT l14_command_results_authorization_subject_fkey
    FOREIGN KEY (organisation_id, authorization_decision_id, subject_kind)
    REFERENCES gov_repo.l14_authorization_decisions (organisation_id, authorization_decision_id, subject_kind),
  ADD CONSTRAINT l14_command_results_proposal_subject_fkey
    FOREIGN KEY (organisation_id, proposal_id, subject_kind)
    REFERENCES gov_repo.l14_proposals (organisation_id, proposal_id, subject_kind),
  ADD CONSTRAINT l14_command_results_registry_state_fkey
    FOREIGN KEY (organisation_id, registry_state_id, subject_kind)
    REFERENCES gov_repo.l14_registry_states (organisation_id, state_id, subject_kind);

-- ---------------------------------------------------------------------------------------
-- F. Support links: ADMISSION (exact ALLOW ADMIT authorization of a registry subject) and
--    REGISTRY_STATE owners. The evidence target is unchanged: gov_repo.discovery_evidence.
-- ---------------------------------------------------------------------------------------
ALTER TABLE gov_repo.l14_support_links
  ADD COLUMN admission_authorization_decision_id uuid,
  ADD COLUMN admission_authorization_result text,
  ADD COLUMN admission_subject_kind text,
  ADD COLUMN admission_requested_action text,
  ADD COLUMN registry_state_id uuid;

ALTER TABLE gov_repo.l14_support_links
  DROP CONSTRAINT l14_support_links_owner_kind_check,
  DROP CONSTRAINT l14_support_links_owner_check;

ALTER TABLE gov_repo.l14_support_links
  ADD CONSTRAINT l14_support_links_owner_kind_check CHECK (owner_kind IN (
    'AUTHORITY_POLICY_VERSION_ADMISSION','PROPOSAL','GOVERNANCE_DECISION','AUTHORITY_POLICY_STATE',
    'ADMISSION','REGISTRY_STATE')),
  -- COALESCE: a partially NULL admission key must fail (never pass as unknown, never skip the FK).
  ADD CONSTRAINT l14_support_links_admission_shape_check CHECK (COALESCE(
    (admission_authorization_decision_id IS NULL AND admission_authorization_result IS NULL
      AND admission_subject_kind IS NULL AND admission_requested_action IS NULL)
    OR (admission_authorization_decision_id IS NOT NULL AND admission_authorization_result = 'ALLOW'
      AND admission_requested_action = 'ADMIT' AND admission_subject_kind IN (
        'GOVERNANCE_PARTY','BUSINESS_DOMAIN','INFORMATION_DOMAIN','CONTROL_DEFINITION','POLICY_VERSION')), false)),
  -- The four S1A branches VERBATIM (plus: the new owner columns absent), then the two new owners.
  ADD CONSTRAINT l14_support_links_owner_check CHECK (
    (((owner_kind = 'AUTHORITY_POLICY_VERSION_ADMISSION' AND authority_policy_id IS NOT NULL AND version_id IS NOT NULL
        AND proposal_id IS NULL AND governance_decision_id IS NULL AND state_id IS NULL)
      OR (owner_kind = 'PROPOSAL' AND proposal_id IS NOT NULL AND authority_policy_id IS NULL AND version_id IS NULL
        AND governance_decision_id IS NULL AND state_id IS NULL)
      OR (owner_kind = 'GOVERNANCE_DECISION' AND governance_decision_id IS NOT NULL AND authority_policy_id IS NULL
        AND version_id IS NULL AND proposal_id IS NULL AND state_id IS NULL)
      OR (owner_kind = 'AUTHORITY_POLICY_STATE' AND state_id IS NOT NULL AND authority_policy_id IS NULL
        AND version_id IS NULL AND proposal_id IS NULL AND governance_decision_id IS NULL))
      AND admission_authorization_decision_id IS NULL AND registry_state_id IS NULL)
    OR (owner_kind = 'ADMISSION' AND admission_authorization_decision_id IS NOT NULL AND registry_state_id IS NULL
      AND authority_policy_id IS NULL AND version_id IS NULL AND proposal_id IS NULL
      AND governance_decision_id IS NULL AND state_id IS NULL)
    OR (owner_kind = 'REGISTRY_STATE' AND registry_state_id IS NOT NULL AND admission_authorization_decision_id IS NULL
      AND authority_policy_id IS NULL AND version_id IS NULL AND proposal_id IS NULL
      AND governance_decision_id IS NULL AND state_id IS NULL)),
  ADD CONSTRAINT l14_support_links_admission_fkey
    FOREIGN KEY (organisation_id, admission_authorization_decision_id, admission_authorization_result,
                 admission_subject_kind, admission_requested_action)
    REFERENCES gov_repo.l14_authorization_decisions (organisation_id, authorization_decision_id, result,
                 subject_kind, requested_action),
  ADD CONSTRAINT l14_support_links_registry_state_fkey FOREIGN KEY (organisation_id, registry_state_id)
    REFERENCES gov_repo.l14_registry_states (organisation_id, state_id);
CREATE UNIQUE INDEX l14_support_links_admission_uidx ON gov_repo.l14_support_links
  (organisation_id, admission_authorization_decision_id, evidence_id) WHERE owner_kind = 'ADMISSION';
CREATE UNIQUE INDEX l14_support_links_registry_state_uidx ON gov_repo.l14_support_links
  (organisation_id, registry_state_id, evidence_id) WHERE owner_kind = 'REGISTRY_STATE';

-- ---------------------------------------------------------------------------------------
-- G. D-14: registry-administration permissions are organisation-local only, for NEW rules.
--    NOT VALID: existing (immutable) rule rows are neither rewritten nor revalidated; every new
--    row is checked. The evaluator already fails closed (SCOPE_NOT_AUTHORIZED) on any legacy
--    non-ALL registry rule. Fact-validation permissions keep all five legal scopes.
-- ---------------------------------------------------------------------------------------
ALTER TABLE gov_repo.l14_authority_policy_rules
  ADD CONSTRAINT l14_authority_policy_rules_registry_scope_check CHECK (
    permission NOT IN ('L14_PARTY_ADMIT','L14_DOMAIN_ADMIT','L14_CONTROL_DEFINITION_ADMIT','L14_POLICY_CONTENT_ADMIT',
      'L14_PARTY_VALIDATE','L14_DOMAIN_VALIDATE','L14_CONTROL_DEFINITION_VALIDATE','L14_POLICY_VERSION_VALIDATE')
    OR scope_tag = 'ALL_ALLOWED_TARGETS') NOT VALID;

-- Enforced at rule INSERTION (never in the parser): the audited S1A.1 parser runs BEFORE replay
-- arbitration inside the unchanged Authority Policy ADMIT RPC, so a parser-level check would make a
-- historical ADMIT whose payload was legal under S1A fail GV010 on replay instead of returning its
-- ORIGINAL durable result (§17 / O20). At insertion, a NEW non-ALL registry rule fails closed with
-- GV010 before anything commits (the whole ADMIT rolls back); the parser stays byte-identical.
CREATE FUNCTION gov_repo.l14_authority_policy_rule_registry_scope_guard_v1()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, pg_temp
AS $guard$
BEGIN
  IF NEW.permission IN ('L14_PARTY_ADMIT','L14_DOMAIN_ADMIT','L14_CONTROL_DEFINITION_ADMIT','L14_POLICY_CONTENT_ADMIT',
       'L14_PARTY_VALIDATE','L14_DOMAIN_VALIDATE','L14_CONTROL_DEFINITION_VALIDATE','L14_POLICY_VERSION_VALIDATE')
     AND NEW.scope_tag IS DISTINCT FROM 'ALL_ALLOWED_TARGETS' THEN
    RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'RULE_REGISTRY_SCOPE_INVALID';
  END IF;
  RETURN NEW;
END;
$guard$;
CREATE TRIGGER l14_authority_policy_rules_registry_scope_guard
  BEFORE INSERT ON gov_repo.l14_authority_policy_rules
  FOR EACH ROW EXECUTE FUNCTION gov_repo.l14_authority_policy_rule_registry_scope_guard_v1();
ALTER TABLE gov_repo.l14_authority_policy_rules ENABLE ALWAYS TRIGGER l14_authority_policy_rules_registry_scope_guard;

-- ---------------------------------------------------------------------------------------
-- H. Owner-only helpers for future registry commands.
-- ---------------------------------------------------------------------------------------

-- SHARED Authority Policy guard: the SAME advisory key as gov_repo.l14_lock_authority_policy_guard_v1
-- (exclusive, used by every Authority Policy mutation). Registry commands hold it shared, so an
-- Authority Policy change can never interleave with a registry authorization, while registry
-- commands do not serialize each other on it.
CREATE FUNCTION gov_repo.l14_lock_authority_policy_guard_shared_v1(p_organisation_id uuid)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SET search_path = pg_catalog, pg_temp
AS $guard$
BEGIN
  IF p_organisation_id IS NULL THEN
    RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'GUARD_KEY_MISSING';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock_shared(pg_catalog.hashtextextended(
    gov_repo.frame_identity(ARRAY[p_organisation_id::text, 'l14-authority-policy-guard-v1']), 0));
END;
$guard$;

-- EXCLUSIVE per-subject guard: organisation + registry subject kind + stable subject key, framed
-- with the repository's length-prefixed frame_identity (no ad hoc concatenation).
CREATE FUNCTION gov_repo.l14_lock_registry_subject_guard_v1(p_organisation_id uuid, p_subject_kind text, p_subject_key text)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SET search_path = pg_catalog, pg_temp
AS $guard$
BEGIN
  IF p_organisation_id IS NULL OR p_subject_kind IS NULL OR p_subject_kind NOT IN (
       'GOVERNANCE_PARTY','BUSINESS_DOMAIN','INFORMATION_DOMAIN','CONTROL_DEFINITION','POLICY_VERSION')
     OR p_subject_key IS NULL OR pg_catalog.length(p_subject_key) NOT BETWEEN 1 AND 500
     OR p_subject_key <> pg_catalog.btrim(p_subject_key) THEN
    RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'GUARD_KEY_INVALID';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    gov_repo.frame_identity(ARRAY[p_organisation_id::text, 'l14-registry-subject-guard-v1', p_subject_kind, p_subject_key]), 0));
END;
$guard$;

-- Replay-first support canonicalization (the S1B fix for the F-3 class): validates and frames the
-- EXACT asserted support syntactically — NONE = zero ids; PRESENT = 1..200 distinct trimmed ids —
-- and returns the same parts as gov_repo.l14_support_parts_v1 (ids in UTF-8 byte order), WITHOUT
-- reading any table. Existence is resolved only after replay arbitration.
CREATE FUNCTION gov_repo.l14_support_syntactic_parts_v1(p_support_status text, p_evidence_ids text[])
RETURNS text[]
LANGUAGE plpgsql
STABLE
SET search_path = pg_catalog, pg_temp
AS $support$
DECLARE
  v_count integer;
BEGIN
  IF p_support_status IS NULL OR p_support_status NOT IN ('NONE','PRESENT') OR p_evidence_ids IS NULL
     OR pg_catalog.array_ndims(p_evidence_ids) > 1
     OR pg_catalog.array_position(p_evidence_ids, NULL::text) IS NOT NULL THEN
    RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'SUPPORT_MALFORMED';
  END IF;
  v_count := pg_catalog.cardinality(p_evidence_ids);
  IF (p_support_status = 'NONE') <> (v_count = 0) OR v_count > 200
     OR v_count <> (SELECT pg_catalog.count(DISTINCT i.id) FROM pg_catalog.unnest(p_evidence_ids) AS i(id))
     OR EXISTS (SELECT 1 FROM pg_catalog.unnest(p_evidence_ids) AS i(id)
                WHERE pg_catalog.length(i.id) NOT BETWEEN 1 AND 500 OR i.id <> pg_catalog.btrim(i.id)) THEN
    RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'SUPPORT_MALFORMED';
  END IF;
  RETURN ARRAY[p_support_status, v_count::text]
    || COALESCE((SELECT pg_catalog.array_agg(i.id ORDER BY pg_catalog.convert_to(i.id, 'UTF8'))
                 FROM pg_catalog.unnest(p_evidence_ids) AS i(id)), ARRAY[]::text[]);
END;
$support$;

-- Post-replay support resolution: every syntactically canonical id must be an exact
-- gov_repo.discovery_evidence row of THIS organisation. Call only after the syntactic helper.
CREATE FUNCTION gov_repo.l14_resolve_support_v1(p_organisation_id uuid, p_evidence_ids text[])
RETURNS void
LANGUAGE plpgsql
STABLE
SET search_path = pg_catalog, pg_temp
AS $resolve$
DECLARE
  v_resolved integer;
BEGIN
  IF p_organisation_id IS NULL OR p_evidence_ids IS NULL THEN
    RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'SUPPORT_MALFORMED';
  END IF;
  SELECT pg_catalog.count(DISTINCT de.evidence_id) INTO v_resolved
  FROM gov_repo.discovery_evidence AS de
  WHERE de.organisation_id = p_organisation_id AND de.evidence_id = ANY (p_evidence_ids);
  IF v_resolved <> pg_catalog.cardinality(p_evidence_ids) THEN
    RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'SUPPORT_REFERENCE_UNRESOLVED';
  END IF;
END;
$resolve$;

-- ---------------------------------------------------------------------------------------
-- I. Privileges. The hostile 20260818013113 defaults hand every new gov_repo table/routine to
--    service_role and PostgreSQL grants PUBLIC EXECUTE on new functions: both are removed. No
--    application role gets any privilege on anything created or replaced here. No new public RPC.
-- ---------------------------------------------------------------------------------------
ALTER TABLE gov_repo.l14_registry_states ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE gov_repo.l14_registry_states FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION
  gov_repo.l14_decision_rule_snapshot_guard_v1(),
  gov_repo.l14_snapshot_policy_rules_v1(uuid, uuid, uuid, uuid, integer[]),
  gov_repo.l14_authority_policy_rule_registry_scope_guard_v1(),
  gov_repo.l14_lock_authority_policy_guard_shared_v1(uuid),
  gov_repo.l14_lock_registry_subject_guard_v1(uuid, text, text),
  gov_repo.l14_support_syntactic_parts_v1(text, text[]),
  gov_repo.l14_resolve_support_v1(uuid, text[])
FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON TABLE gov_repo.l14_registry_states IS 'M16-S1B.0 common immutable governed-state envelope for the five registry subjects (VALIDATED/REVOKED, lineage predecessor, exact revocation target, decision + authorization + Authority Policy basis lineage, trust, source, support status). Holds NO subject content: per-subject typed detail tables pin the subject identity/version in later slices.';
COMMENT ON COLUMN gov_repo.l14_command_results.subject_kind IS 'M16-S1B.0 subject of the durable command. The constant AUTHORITY_POLICY_VERSION default is the metadata-only logical backfill of all S1A rows and the value the unmodified S1A RPCs keep writing.';
COMMENT ON COLUMN gov_repo.l14_authorization_decisions.expectation_kind IS 'M16-S1B.0 F-4 audit evidence (EXPECTED_NONE | EXPECTED_CURRENT | NOT_APPLICABLE). NULL only on legacy-shaped AUTHORITY_POLICY_VERSION rows (the S1A ADMIT RPC is intentionally not modified, D-11).';
COMMENT ON COLUMN gov_repo.l14_authorization_decisions.expected_latest_version_id IS 'M16-S1B.0 F-4 audit value as asserted by the command; deliberately no FK so a stale/unknown expectation stays recordable.';
COMMENT ON COLUMN gov_repo.l14_authorization_decisions.expected_current_state_id IS 'M16-S1B.0 F-4 audit value as asserted by the command; deliberately no FK so a stale/unknown expectation stays recordable.';
COMMENT ON COLUMN gov_repo.l14_authorization_decisions.target_relationship_state_id IS 'M16-S1B.0 request-target operand; NO FK and NO uniqueness (F2 deferred). Resolution is an exact read-only organisation + relationship + state lookup.';
COMMENT ON FUNCTION gov_repo.l14_lock_authority_policy_guard_shared_v1(uuid) IS 'M16-S1B.0 owner-only SHARED Authority Policy guard (same advisory key as the S1A exclusive guard).';
COMMENT ON FUNCTION gov_repo.l14_lock_registry_subject_guard_v1(uuid, text, text) IS 'M16-S1B.0 owner-only EXCLUSIVE registry subject guard keyed by frame_identity(organisation, subject kind, stable subject key).';
COMMENT ON FUNCTION gov_repo.l14_support_syntactic_parts_v1(text, text[]) IS 'M16-S1B.0 owner-only replay-first support canonicalization: no table access; resolution is deferred to gov_repo.l14_resolve_support_v1 after replay arbitration.';

-- ---------------------------------------------------------------------------------------
-- J. ACL / structure postflight (after ALL grants, including the broad legacy defaults).
-- ---------------------------------------------------------------------------------------
DO $postflight$
DECLARE
  v_expected_tables CONSTANT text[] := ARRAY[
    'l14_authority_policies','l14_authority_policy_heads','l14_authority_policy_rules',
    'l14_authority_policy_states','l14_authority_policy_version_proposals','l14_authority_policy_versions',
    'l14_authorization_decision_roles','l14_authorization_decision_rules','l14_authorization_decisions',
    'l14_command_results','l14_governance_decisions','l14_proposals','l14_registry_states','l14_support_links'];
  v_public_rpcs CONSTANT text[] := ARRAY[
    'l14_admit_authority_policy_version_v1','l14_decide_authority_policy_proposal_v1','l14_submit_proposal_v1'];
  v_privileges text[] := ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'];
  v_rel record;
  v_fn record;
  v_role text;
  v_privilege text;
BEGIN
  IF pg_catalog.current_setting('server_version_num')::integer >= 170000 THEN
    v_privileges := pg_catalog.array_append(v_privileges, 'MAINTAIN'::text);
  END IF;
  IF (SELECT pg_catalog.array_agg(c.relname::text ORDER BY c.relname::text COLLATE "C")
      FROM pg_catalog.pg_class AS c
      WHERE c.relnamespace = 'gov_repo'::regnamespace AND c.relname LIKE 'l14\_%' ESCAPE '\'
        AND c.relkind IN ('r','p','v','m','S','f')) IS DISTINCT FROM v_expected_tables THEN
    RAISE EXCEPTION 'M16_S1B0_POSTFLIGHT: unexpected l14 relation set (tables only; no views/sequences)';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_rewrite AS w
             JOIN pg_catalog.pg_depend AS d ON d.classid = 'pg_catalog.pg_rewrite'::regclass AND d.objid = w.oid
             JOIN pg_catalog.pg_class AS t ON t.oid = d.refobjid
             WHERE t.relnamespace = 'gov_repo'::regnamespace AND t.relname LIKE 'l14\_%' ESCAPE '\'
               AND w.ev_class <> t.oid) THEN
    RAISE EXCEPTION 'M16_S1B0_POSTFLIGHT: a view exposes an l14 table';
  END IF;
  FOR v_rel IN
    SELECT c.oid, c.relname, c.relkind, c.relowner, c.relacl, c.relrowsecurity
    FROM pg_catalog.pg_class AS c
    WHERE c.relnamespace = 'gov_repo'::regnamespace AND c.relname::text = ANY (v_expected_tables)
  LOOP
    IF v_rel.relkind <> 'r' OR NOT v_rel.relrowsecurity THEN
      RAISE EXCEPTION 'M16_S1B0_POSTFLIGHT: % must be an RLS-enabled ordinary table', v_rel.relname;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_catalog.aclexplode(COALESCE(v_rel.relacl, pg_catalog.acldefault('r', v_rel.relowner))) AS a
               WHERE a.grantee <> v_rel.relowner) THEN
      RAISE EXCEPTION 'M16_S1B0_POSTFLIGHT: % has a non-owner table grant', v_rel.relname;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_attribute AS att WHERE att.attrelid = v_rel.oid AND att.attacl IS NOT NULL) THEN
      RAISE EXCEPTION 'M16_S1B0_POSTFLIGHT: % has column-level grants', v_rel.relname;
    END IF;
    FOREACH v_role IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
      FOREACH v_privilege IN ARRAY v_privileges LOOP
        IF pg_catalog.has_table_privilege(v_role, v_rel.oid, v_privilege) THEN
          RAISE EXCEPTION 'M16_S1B0_POSTFLIGHT: % holds % on %', v_role, v_privilege, v_rel.relname;
        END IF;
      END LOOP;
      IF pg_catalog.has_any_column_privilege(v_role, v_rel.oid, 'SELECT, INSERT, UPDATE, REFERENCES') THEN
        RAISE EXCEPTION 'M16_S1B0_POSTFLIGHT: % holds a column privilege on %', v_role, v_rel.relname;
      END IF;
    END LOOP;
    -- Every table except the RPC-maintained head carries ALWAYS raising UPDATE/DELETE + TRUNCATE triggers.
    IF v_rel.relname::text <> 'l14_authority_policy_heads' AND (
       NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger AS t
                   WHERE t.tgrelid = v_rel.oid AND NOT t.tgisinternal AND t.tgenabled = 'A'
                     AND t.tgfoid = 'gov_repo.l14_history_immutable_v1()'::regprocedure
                     AND (t.tgtype & 1) <> 0 AND (t.tgtype & 2) <> 0 AND (t.tgtype & 8) <> 0 AND (t.tgtype & 16) <> 0)
       OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger AS t
                   WHERE t.tgrelid = v_rel.oid AND NOT t.tgisinternal AND t.tgenabled = 'A'
                     AND t.tgfoid = 'gov_repo.l14_history_immutable_v1()'::regprocedure
                     AND (t.tgtype & 2) <> 0 AND (t.tgtype & 32) <> 0)) THEN
      RAISE EXCEPTION 'M16_S1B0_POSTFLIGHT: % lacks ALWAYS raising BEFORE UPDATE/DELETE and TRUNCATE triggers', v_rel.relname;
    END IF;
    -- No JSON/EAV authority storage anywhere in the L14 surface.
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_attribute AS att
               WHERE att.attrelid = v_rel.oid AND att.attnum > 0 AND NOT att.attisdropped
                 AND att.atttypid IN ('json'::regtype, 'jsonb'::regtype)) THEN
      RAISE EXCEPTION 'M16_S1B0_POSTFLIGHT: % has a JSON column', v_rel.relname;
    END IF;
  END LOOP;
  FOR v_fn IN
    SELECT p.oid, p.proname, p.proowner, p.proacl, p.prosecdef, p.proconfig
    FROM pg_catalog.pg_proc AS p
    WHERE p.pronamespace = 'gov_repo'::regnamespace AND p.proname LIKE 'l14\_%' ESCAPE '\'
  LOOP
    IF EXISTS (SELECT 1 FROM pg_catalog.aclexplode(COALESCE(v_fn.proacl, pg_catalog.acldefault('f', v_fn.proowner))) AS a
               WHERE a.privilege_type = 'EXECUTE' AND a.grantee = 0) THEN
      RAISE EXCEPTION 'M16_S1B0_POSTFLIGHT: % has PUBLIC EXECUTE', v_fn.proname;
    END IF;
    FOREACH v_role IN ARRAY ARRAY['anon','authenticated'] LOOP
      IF pg_catalog.has_function_privilege(v_role, v_fn.oid, 'EXECUTE') THEN
        RAISE EXCEPTION 'M16_S1B0_POSTFLIGHT: % executable by %', v_fn.proname, v_role;
      END IF;
    END LOOP;
    IF NOT COALESCE(v_fn.proconfig @> ARRAY['search_path=pg_catalog, pg_temp'], false) THEN
      RAISE EXCEPTION 'M16_S1B0_POSTFLIGHT: % search_path not pinned', v_fn.proname;
    END IF;
    IF v_fn.proname::text = ANY (v_public_rpcs) THEN
      IF NOT v_fn.prosecdef OR NOT pg_catalog.has_function_privilege('service_role', v_fn.oid, 'EXECUTE')
         OR EXISTS (SELECT 1 FROM pg_catalog.aclexplode(v_fn.proacl) AS a
                    WHERE a.grantee NOT IN (v_fn.proowner, 'service_role'::regrole::oid)) THEN
        RAISE EXCEPTION 'M16_S1B0_POSTFLIGHT: public RPC % ACL/definer shape wrong', v_fn.proname;
      END IF;
    ELSIF v_fn.prosecdef OR EXISTS (SELECT 1 FROM pg_catalog.aclexplode(COALESCE(v_fn.proacl,
            pg_catalog.acldefault('f', v_fn.proowner))) AS a WHERE a.grantee <> v_fn.proowner) THEN
      RAISE EXCEPTION 'M16_S1B0_POSTFLIGHT: internal helper % must be owner-only SECURITY INVOKER', v_fn.proname;
    END IF;
  END LOOP;
  -- Exactly the three S1A public RPCs (no overloads, no new public surface).
  IF (SELECT pg_catalog.count(*) FROM pg_catalog.pg_proc AS p
      WHERE p.pronamespace = 'gov_repo'::regnamespace AND p.proname LIKE 'l14\_%' ESCAPE '\' AND p.prosecdef) <> 3
     OR (SELECT pg_catalog.count(*) FROM pg_catalog.pg_proc AS p
      WHERE p.pronamespace = 'gov_repo'::regnamespace AND p.proname::text = ANY (v_public_rpcs)) <> 3
     OR (SELECT pg_catalog.count(*) FROM pg_catalog.pg_proc AS p
      WHERE p.pronamespace = 'gov_repo'::regnamespace AND p.proname LIKE 'l14\_%' ESCAPE '\'
        AND pg_catalog.has_function_privilege('service_role', p.oid, 'EXECUTE')) <> 3 THEN
    RAISE EXCEPTION 'M16_S1B0_POSTFLIGHT: the public L14 RPC surface must remain exactly the three S1A RPCs';
  END IF;
  -- S0 wrapper/eligibility naming contracts stay intact.
  IF (SELECT pg_catalog.count(*) FROM pg_catalog.pg_proc AS p WHERE p.pronamespace = 'gov_repo'::regnamespace
        AND p.proname LIKE '%\_governed\_v1' ESCAPE '\') <> 6
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_proc AS p WHERE p.pronamespace = 'gov_repo'::regnamespace
        AND p.proname LIKE 'l14\_%' ESCAPE '\' AND (p.proname LIKE '%eligibility%' OR p.proname LIKE '%governed%')) THEN
    RAISE EXCEPTION 'M16_S1B0_POSTFLIGHT: S0 naming contract disturbed';
  END IF;
  -- The snapshot guard trigger is ALWAYS enabled; D-14 CHECK exists (NOT VALID by design).
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger AS t
                 WHERE t.tgrelid = 'gov_repo.l14_authorization_decision_rules'::regclass
                   AND t.tgname = 'l14_authorization_decision_rules_snapshot_guard' AND t.tgenabled = 'A')
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger AS t
                 WHERE t.tgrelid = 'gov_repo.l14_authority_policy_rules'::regclass
                   AND t.tgname = 'l14_authority_policy_rules_registry_scope_guard' AND t.tgenabled = 'A')
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint AS k
                    WHERE k.conrelid = 'gov_repo.l14_authority_policy_rules'::regclass
                      AND k.conname = 'l14_authority_policy_rules_registry_scope_check' AND NOT k.convalidated) THEN
    RAISE EXCEPTION 'M16_S1B0_POSTFLIGHT: snapshot guard / D-14 guard or constraint missing';
  END IF;
  -- F2: nothing here references the relationship-state operands with a FK or uniqueness.
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_constraint AS k
             JOIN pg_catalog.pg_attribute AS att ON att.attrelid = k.conrelid AND att.attnum = ANY (k.conkey)
             WHERE k.conrelid IN ('gov_repo.l14_authorization_decisions'::regclass, 'gov_repo.l14_authorization_decision_rules'::regclass)
               AND k.contype IN ('f','u','p','x')
               AND att.attname IN ('target_relationship_state_id','scope_relationship_state_id','target_relationship_id','scope_relationship_id'))
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_constraint AS k
                WHERE k.confrelid = 'gov_repo.canonical_relationships'::regclass
                  AND k.conrelid IN (SELECT c.oid FROM pg_catalog.pg_class AS c
                                     WHERE c.relnamespace = 'gov_repo'::regnamespace AND c.relname LIKE 'l14\_%' ESCAPE '\')) THEN
    RAISE EXCEPTION 'M16_S1B0_POSTFLIGHT: F2 boundary violated (relationship-state FK/uniqueness)';
  END IF;
END;
$postflight$;

COMMIT;
