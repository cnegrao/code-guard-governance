-- M16-S1A.1: L14 Authority Policy foundation + FIRST-policy bootstrap (DB only).
-- Architecture: docs/architecture/ADR-GOVIA-OWNERSHIP-BUSINESS-POLICY-CONTROL-ENRICHMENT-v1.md
-- (ACCEPTED / FROZEN) §§4-7, 9, 16-17, 20-21, plus the S1A architecture-owner decisions
-- U1-U9. Never run against a hosted DB from this slice.
--
-- Scope: stable organisation-local Authority Policy identity, immutable versions and typed
-- rules, proposal envelope + AUTHORITY_POLICY_VERSION typed proposal, authorization and
-- governance decisions, append-only governed states (VALIDATED/REVOKED, revocation target
-- distinct from lineage predecessor), technical head, durable command results, normalized
-- support links to gov_repo.discovery_evidence, the bitemporal effective resolver, and three
-- RPCs executing ONLY first-policy ADMIT, first-version proposal submission and first-policy
-- VALIDATE under SYSTEM_BOOTSTRAP_L14_AUTHORITY_V1. Every non-first Authority Policy command
-- fails closed (GV010) until S1A.2. No successor evaluator, no fact family, no route.
--
-- Reused, unchanged: gov_repo.lock_and_resolve_governance_session_eligibility_v1 (S0.3.2R),
-- gov_repo.frame_identity. NOT reused: gov_repo.require_governed_write_eligibility_v1 (its
-- GV006 would make legacy admin the L14 authority and make durable DENY impossible) and
-- gov_repo.authorization_decisions (ADR §7.2). No canonical_relationships DDL/DML (F2):
-- RELATIONSHIP_STATE operands are validated by an exact read-only triple lookup.
--
-- Lock order (all L14 commands): ORGANISATION -> GOVERNANCE_USER -> GOVERNANCE_ROLE(asc)
-- (FOR SHARE, inside the canonical helper) -> organisation Authority Policy advisory guard
-- (exclusive, transaction scoped). SQLSTATEs: GV001-GV005 from the helper (raise, nothing
-- consumed), GV007 L14_REPLAY_CONFLICT, GV008 L14_FINGERPRINT_MISMATCH, GV009
-- L14_STALE_EXPECTATION, GV010 L14_INVALID_COMMAND; GV011 L14_CONTINUITY_VIOLATION is
-- reserved for S1A.2. An L14 authority DENY is a durable result, never an exception.
BEGIN;

-- ---------------------------------------------------------------------------------------
-- A. Tables (cross-table cycles are closed with ALTER TABLE in section B).
-- ---------------------------------------------------------------------------------------

-- Exactly one stable organisation-local Authority Policy identity per organisation.
CREATE TABLE gov_repo.l14_authority_policies (
  organisation_id uuid NOT NULL REFERENCES gov_repo.organisations (organisation_id),
  authority_policy_id uuid NOT NULL,
  established_at timestamptz NOT NULL,
  CONSTRAINT l14_authority_policies_pkey PRIMARY KEY (organisation_id, authority_policy_id),
  CONSTRAINT l14_authority_policies_one_per_organisation UNIQUE (organisation_id)
);

CREATE TABLE gov_repo.l14_authorization_decisions (
  organisation_id uuid NOT NULL REFERENCES gov_repo.organisations (organisation_id),
  authorization_decision_id uuid NOT NULL,
  command_id text NOT NULL,
  command_fingerprint text NOT NULL CHECK (command_fingerprint ~ '^[0-9a-f]{64}$'),
  actor_user_id uuid NOT NULL REFERENCES gov_repo.governance_users (user_id),
  requested_action text NOT NULL
    CHECK (requested_action IN ('ADMIT','VALIDATE','REJECT','DEFER','REVOKE')),
  subject_kind text NOT NULL CHECK (subject_kind IN (
    'AUTHORITY_POLICY_VERSION','GOVERNANCE_PARTY','BUSINESS_DOMAIN','INFORMATION_DOMAIN',
    'CONTROL_DEFINITION','POLICY_VERSION','RESPONSIBILITY_ASSIGNMENT','BUSINESS_CONTEXT_ASSIGNMENT',
    'POLICY_APPLICABILITY','CONTROL_APPLICABILITY','CONTROL_ASSESSMENT')),
  scope_tag text NOT NULL CHECK (scope_tag IN (
    'ALL_ALLOWED_TARGETS','CANONICAL_KIND','CANONICAL_OBJECT','RELATIONSHIP_TYPE','RELATIONSHIP_STATE')),
  source_class text NOT NULL CHECK (source_class IN ('SYSTEM_SEED','LOCAL_HUMAN','SOURCE_CONNECTION')),
  proposal_id uuid,
  is_self_validation boolean,
  subject_authority_policy_id uuid,
  subject_version_id uuid,
  authority_basis text NOT NULL
    CHECK (authority_basis IN ('SYSTEM_BOOTSTRAP_L14_AUTHORITY_V1','AUTHORITY_POLICY_VERSION')),
  basis_authority_policy_id uuid,
  basis_version_id uuid,
  basis_content_hash text,
  result text NOT NULL CHECK (result IN ('ALLOW','DENY')),
  deny_reason text CHECK (deny_reason IN (
    'BOOTSTRAP_ROLE_REQUIRED','BOOTSTRAP_ACTION_NOT_PERMITTED','NO_EFFECTIVE_AUTHORITY',
    'NO_MATCHING_AUTHORITY_RULE','SELF_VALIDATION_NOT_PERMITTED','SOURCE_NOT_AUTHORIZED',
    'SCOPE_NOT_AUTHORIZED','TEMPORAL_ACTION_NOT_AUTHORIZED','SUCCESSOR_SELF_AUTHORIZATION_FORBIDDEN')),
  evaluated_at timestamptz NOT NULL,
  CONSTRAINT l14_authorization_decisions_pkey PRIMARY KEY (organisation_id, authorization_decision_id),
  CONSTRAINT l14_authorization_decisions_command_unique UNIQUE (organisation_id, command_id),
  CONSTRAINT l14_authorization_decisions_result_unique UNIQUE (organisation_id, authorization_decision_id, result),
  CONSTRAINT l14_authorization_decisions_result_reason_check CHECK ((result = 'ALLOW') = (deny_reason IS NULL)),
  CONSTRAINT l14_authorization_decisions_basis_shape_check CHECK (
    (authority_basis = 'SYSTEM_BOOTSTRAP_L14_AUTHORITY_V1'
      AND basis_authority_policy_id IS NULL AND basis_version_id IS NULL AND basis_content_hash IS NULL)
    OR (authority_basis = 'AUTHORITY_POLICY_VERSION'
      AND basis_authority_policy_id IS NOT NULL AND basis_version_id IS NOT NULL
      AND basis_content_hash ~ '^[0-9a-f]{64}$')),
  -- A policy version can never be the authority basis of a decision about itself (§5).
  CONSTRAINT l14_authorization_decisions_no_self_basis_check CHECK (
    basis_version_id IS NULL OR subject_version_id IS NULL OR basis_version_id <> subject_version_id),
  CONSTRAINT l14_authorization_decisions_subject_shape_check CHECK (
    (subject_authority_policy_id IS NULL) = (subject_version_id IS NULL)),
  CONSTRAINT l14_authorization_decisions_self_validation_check CHECK (
    (proposal_id IS NULL) = (is_self_validation IS NULL))
);

CREATE TABLE gov_repo.l14_authority_policy_versions (
  organisation_id uuid NOT NULL,
  authority_policy_id uuid NOT NULL,
  version_id uuid NOT NULL,
  version_number integer NOT NULL CHECK (version_number >= 1),
  predecessor_version_id uuid,
  content_hash text NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  rule_count integer NOT NULL CHECK (rule_count >= 0),
  source_class text NOT NULL CHECK (source_class IN ('SYSTEM_SEED','LOCAL_HUMAN','SOURCE_CONNECTION')),
  admitted_by_actor_user_id uuid NOT NULL REFERENCES gov_repo.governance_users (user_id),
  admission_authorization_decision_id uuid NOT NULL,
  admission_authorization_result text NOT NULL DEFAULT 'ALLOW' CHECK (admission_authorization_result = 'ALLOW'),
  support_status text NOT NULL CHECK (support_status IN ('NONE','PRESENT')),
  admitted_at timestamptz NOT NULL,
  CONSTRAINT l14_authority_policy_versions_pkey PRIMARY KEY (organisation_id, authority_policy_id, version_id),
  CONSTRAINT l14_authority_policy_versions_version_unique UNIQUE (organisation_id, version_id),
  CONSTRAINT l14_authority_policy_versions_hash_unique UNIQUE (organisation_id, authority_policy_id, version_id, content_hash),
  CONSTRAINT l14_authority_policy_versions_number_unique UNIQUE (organisation_id, authority_policy_id, version_number),
  CONSTRAINT l14_authority_policy_versions_successor_unique UNIQUE (organisation_id, authority_policy_id, predecessor_version_id),
  CONSTRAINT l14_authority_policy_versions_first_check CHECK ((version_number = 1) = (predecessor_version_id IS NULL)),
  CONSTRAINT l14_authority_policy_versions_policy_fkey FOREIGN KEY (organisation_id, authority_policy_id)
    REFERENCES gov_repo.l14_authority_policies (organisation_id, authority_policy_id),
  CONSTRAINT l14_authority_policy_versions_predecessor_fkey FOREIGN KEY (organisation_id, authority_policy_id, predecessor_version_id)
    REFERENCES gov_repo.l14_authority_policy_versions (organisation_id, authority_policy_id, version_id),
  CONSTRAINT l14_authority_policy_versions_admission_fkey
    FOREIGN KEY (organisation_id, admission_authorization_decision_id, admission_authorization_result)
    REFERENCES gov_repo.l14_authorization_decisions (organisation_id, authorization_decision_id, result)
);
CREATE UNIQUE INDEX l14_authority_policy_versions_first_uidx
  ON gov_repo.l14_authority_policy_versions (organisation_id, authority_policy_id)
  WHERE predecessor_version_id IS NULL;

-- Typed ordered rule set: the ENTIRE authoritative content of a version. No JSON/EAV; no
-- legacy governance_roles.permissions expansion; ordinal is the DB canonical sort position.
CREATE TABLE gov_repo.l14_authority_policy_rules (
  organisation_id uuid NOT NULL,
  authority_policy_id uuid NOT NULL,
  version_id uuid NOT NULL,
  rule_ordinal integer NOT NULL CHECK (rule_ordinal >= 1),
  role_id uuid NOT NULL,
  permission text NOT NULL CHECK (permission IN (
    'L14_AUTHORITY_POLICY_ADMIT','L14_PARTY_ADMIT','L14_DOMAIN_ADMIT','L14_CONTROL_DEFINITION_ADMIT',
    'L14_POLICY_CONTENT_ADMIT','L14_AUTHORITY_POLICY_ADMIN','L14_PARTY_VALIDATE','L14_DOMAIN_VALIDATE',
    'L14_CONTROL_DEFINITION_VALIDATE','L14_POLICY_VERSION_VALIDATE','L14_RESPONSIBILITY_VALIDATE',
    'L14_BUSINESS_CONTEXT_VALIDATE','L14_POLICY_APPLICABILITY_VALIDATE','L14_CONTROL_APPLICABILITY_VALIDATE',
    'L14_CONTROL_ASSESSMENT_VALIDATE')),
  requested_action text NOT NULL CHECK (requested_action IN ('ADMIT','VALIDATE','REJECT','DEFER','REVOKE')),
  source_class text NOT NULL CHECK (source_class IN ('SYSTEM_SEED','LOCAL_HUMAN','SOURCE_CONNECTION')),
  source_disposition text NOT NULL CHECK (source_disposition IN ('AUTHORITATIVE','CONTRIBUTING','NON_AUTHORITATIVE')),
  scope_tag text NOT NULL CHECK (scope_tag IN (
    'ALL_ALLOWED_TARGETS','CANONICAL_KIND','CANONICAL_OBJECT','RELATIONSHIP_TYPE','RELATIONSHIP_STATE')),
  scope_canonical_kind text CHECK (scope_canonical_kind IN (
    'AGENT','AGENT_VERSION','MODEL','TOOL','MCP_SERVER','API','PROMPT','KNOWLEDGE_BASE','DATA_ASSET','DATA_ELEMENT','SKILL')),
  scope_canonical_object_id text,
  scope_relationship_type text CHECK (scope_relationship_type IN (
    'USES_MODEL','USES_TOOL','USES_MCP','INVOKES','USES_PROMPT','USES_KNOWLEDGE_BASE','USES_SKILL',
    'EXPOSES','HANDOFF_TO','READS_FROM','WRITES_TO','DERIVED_FROM')),
  scope_relationship_id text,
  scope_relationship_state_id text,
  allow_self_validation boolean NOT NULL,
  allow_future_dating boolean NOT NULL,
  allow_backdating boolean NOT NULL,
  CONSTRAINT l14_authority_policy_rules_pkey PRIMARY KEY (organisation_id, authority_policy_id, version_id, rule_ordinal),
  CONSTRAINT l14_authority_policy_rules_version_fkey FOREIGN KEY (organisation_id, authority_policy_id, version_id)
    REFERENCES gov_repo.l14_authority_policy_versions (organisation_id, authority_policy_id, version_id),
  CONSTRAINT l14_authority_policy_rules_role_fkey FOREIGN KEY (role_id)
    REFERENCES gov_repo.governance_roles (role_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  -- Exact organisation + canonical object identity + declared kind (§2, §6). No F2 table touched.
  CONSTRAINT l14_authority_policy_rules_canonical_object_fkey
    FOREIGN KEY (organisation_id, scope_canonical_object_id, scope_canonical_kind)
    REFERENCES gov_repo.canonical_objects (organisation_id, canonical_object_id, kind) ON DELETE RESTRICT,
  CONSTRAINT l14_authority_policy_rules_scope_shape_check CHECK (
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
  -- *_ADMIT permissions grant only ADMIT; every other permission never grants ADMIT.
  CONSTRAINT l14_authority_policy_rules_action_check CHECK (
    (permission LIKE '%\_ADMIT' ESCAPE '\') = (requested_action = 'ADMIT')),
  -- Authority Policy administration has no canonical target: organisation-local scope only.
  CONSTRAINT l14_authority_policy_rules_authority_scope_check CHECK (
    permission NOT IN ('L14_AUTHORITY_POLICY_ADMIT','L14_AUTHORITY_POLICY_ADMIN') OR scope_tag = 'ALL_ALLOWED_TARGETS'),
  -- ADMIT has no proposal and no effective time: no self-validation/dating grant can attach.
  CONSTRAINT l14_authority_policy_rules_admit_flags_check CHECK (
    requested_action <> 'ADMIT' OR NOT (allow_self_validation OR allow_future_dating OR allow_backdating))
);

CREATE TABLE gov_repo.l14_proposals (
  organisation_id uuid NOT NULL REFERENCES gov_repo.organisations (organisation_id),
  proposal_id uuid NOT NULL,
  subject_kind text NOT NULL CHECK (subject_kind IN (
    'AUTHORITY_POLICY_VERSION','GOVERNANCE_PARTY','BUSINESS_DOMAIN','INFORMATION_DOMAIN',
    'CONTROL_DEFINITION','POLICY_VERSION','RESPONSIBILITY_ASSIGNMENT','BUSINESS_CONTEXT_ASSIGNMENT',
    'POLICY_APPLICABILITY','CONTROL_APPLICABILITY','CONTROL_ASSESSMENT')),
  intent text NOT NULL CHECK (intent IN ('VALIDATE','REVOKE')),
  source_class text NOT NULL CHECK (source_class IN ('SYSTEM_SEED','LOCAL_HUMAN','SOURCE_CONNECTION')),
  submitted_by_actor_user_id uuid NOT NULL REFERENCES gov_repo.governance_users (user_id),
  prior_proposal_id uuid,
  support_status text NOT NULL CHECK (support_status IN ('NONE','PRESENT')),
  submitted_at timestamptz NOT NULL,
  CONSTRAINT l14_proposals_pkey PRIMARY KEY (organisation_id, proposal_id),
  CONSTRAINT l14_proposals_subject_unique UNIQUE (organisation_id, proposal_id, subject_kind, intent),
  CONSTRAINT l14_proposals_prior_fkey FOREIGN KEY (organisation_id, prior_proposal_id)
    REFERENCES gov_repo.l14_proposals (organisation_id, proposal_id),
  CONSTRAINT l14_proposals_prior_check CHECK (prior_proposal_id IS NULL OR prior_proposal_id <> proposal_id)
);

CREATE TABLE gov_repo.l14_authority_policy_version_proposals (
  organisation_id uuid NOT NULL,
  proposal_id uuid NOT NULL,
  subject_kind text NOT NULL DEFAULT 'AUTHORITY_POLICY_VERSION' CHECK (subject_kind = 'AUTHORITY_POLICY_VERSION'),
  intent text NOT NULL CHECK (intent IN ('VALIDATE','REVOKE')),
  authority_policy_id uuid NOT NULL,
  version_id uuid NOT NULL,
  content_hash text NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  requested_effective_from timestamptz,          -- NULL = IMMEDIATE (DB transaction instant)
  target_state_id uuid,                          -- exact REVOKE target (§7.1)
  CONSTRAINT l14_authority_policy_version_proposals_pkey PRIMARY KEY (organisation_id, proposal_id),
  CONSTRAINT l14_authority_policy_version_proposals_envelope_fkey
    FOREIGN KEY (organisation_id, proposal_id, subject_kind, intent)
    REFERENCES gov_repo.l14_proposals (organisation_id, proposal_id, subject_kind, intent),
  CONSTRAINT l14_authority_policy_version_proposals_version_fkey
    FOREIGN KEY (organisation_id, authority_policy_id, version_id, content_hash)
    REFERENCES gov_repo.l14_authority_policy_versions (organisation_id, authority_policy_id, version_id, content_hash),
  CONSTRAINT l14_authority_policy_version_proposals_target_check CHECK (
    (intent = 'VALIDATE' AND target_state_id IS NULL) OR (intent = 'REVOKE' AND target_state_id IS NOT NULL))
);

CREATE TABLE gov_repo.l14_governance_decisions (
  organisation_id uuid NOT NULL,
  governance_decision_id uuid NOT NULL,
  proposal_id uuid NOT NULL,
  subject_kind text NOT NULL CHECK (subject_kind = 'AUTHORITY_POLICY_VERSION'),
  outcome text NOT NULL CHECK (outcome IN ('VALIDATE','REJECT','DEFER','REVOKE')),
  reason_code text NOT NULL CHECK (reason_code IN (
    'AUTHORITY_POLICY_VALIDATED','AUTHORITY_POLICY_REJECTED','AUTHORITY_POLICY_DEFERRED','AUTHORITY_POLICY_REVOKED')),
  authorization_decision_id uuid NOT NULL,
  authorization_result text NOT NULL DEFAULT 'ALLOW' CHECK (authorization_result = 'ALLOW'),
  actor_user_id uuid NOT NULL REFERENCES gov_repo.governance_users (user_id),
  target_authority_policy_id uuid NOT NULL,
  target_version_id uuid NOT NULL,
  target_content_hash text NOT NULL,
  support_status text NOT NULL CHECK (support_status IN ('NONE','PRESENT')),
  decided_at timestamptz NOT NULL,
  CONSTRAINT l14_governance_decisions_pkey PRIMARY KEY (organisation_id, governance_decision_id),
  CONSTRAINT l14_governance_decisions_authorization_unique UNIQUE (organisation_id, authorization_decision_id),
  CONSTRAINT l14_governance_decisions_reason_check CHECK (
    (outcome = 'VALIDATE' AND reason_code = 'AUTHORITY_POLICY_VALIDATED')
    OR (outcome = 'REJECT' AND reason_code = 'AUTHORITY_POLICY_REJECTED')
    OR (outcome = 'DEFER' AND reason_code = 'AUTHORITY_POLICY_DEFERRED')
    OR (outcome = 'REVOKE' AND reason_code = 'AUTHORITY_POLICY_REVOKED')),
  CONSTRAINT l14_governance_decisions_proposal_fkey FOREIGN KEY (organisation_id, proposal_id)
    REFERENCES gov_repo.l14_proposals (organisation_id, proposal_id),
  -- Only an ALLOW authorization can back a governance decision; DENY never can.
  CONSTRAINT l14_governance_decisions_authorization_fkey
    FOREIGN KEY (organisation_id, authorization_decision_id, authorization_result)
    REFERENCES gov_repo.l14_authorization_decisions (organisation_id, authorization_decision_id, result),
  CONSTRAINT l14_governance_decisions_target_fkey
    FOREIGN KEY (organisation_id, target_authority_policy_id, target_version_id, target_content_hash)
    REFERENCES gov_repo.l14_authority_policy_versions (organisation_id, authority_policy_id, version_id, content_hash)
);
-- VALIDATE/REJECT/REVOKE terminate a proposal; DEFER does not. Concurrent terminals cannot both win.
CREATE UNIQUE INDEX l14_governance_decisions_terminal_uidx
  ON gov_repo.l14_governance_decisions (organisation_id, proposal_id)
  WHERE outcome IN ('VALIDATE','REJECT','REVOKE');

-- Append-only governed Authority Policy states. predecessor_state_id is temporal/lineage
-- predecessor; revokes_state_id is the exact REVOKE target. Neither is ever overloaded.
CREATE TABLE gov_repo.l14_authority_policy_states (
  organisation_id uuid NOT NULL,
  state_id uuid NOT NULL,
  authority_policy_id uuid NOT NULL,
  version_id uuid NOT NULL,
  content_hash text NOT NULL,
  state_kind text NOT NULL CHECK (state_kind IN ('VALIDATED','REVOKED')),
  predecessor_state_id uuid,
  revokes_state_id uuid,
  effective_from timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL,
  governance_decision_id uuid NOT NULL,
  authority_basis text NOT NULL
    CHECK (authority_basis IN ('SYSTEM_BOOTSTRAP_L14_AUTHORITY_V1','AUTHORITY_POLICY_VERSION')),
  basis_authority_policy_id uuid,
  basis_version_id uuid,
  basis_content_hash text,
  trust_state text NOT NULL CHECK (trust_state = 'VALIDATED'),
  CONSTRAINT l14_authority_policy_states_pkey PRIMARY KEY (organisation_id, state_id),
  CONSTRAINT l14_authority_policy_states_decision_unique UNIQUE (organisation_id, governance_decision_id),
  CONSTRAINT l14_authority_policy_states_successor_unique UNIQUE (organisation_id, predecessor_state_id),
  CONSTRAINT l14_authority_policy_states_kind_check CHECK (
    (state_kind = 'VALIDATED' AND revokes_state_id IS NULL)
    OR (state_kind = 'REVOKED' AND revokes_state_id IS NOT NULL)),
  CONSTRAINT l14_authority_policy_states_first_check CHECK (predecessor_state_id IS NOT NULL OR state_kind = 'VALIDATED'),
  CONSTRAINT l14_authority_policy_states_self_check CHECK (
    (predecessor_state_id IS NULL OR predecessor_state_id <> state_id)
    AND (revokes_state_id IS NULL OR revokes_state_id <> state_id)),
  CONSTRAINT l14_authority_policy_states_basis_shape_check CHECK (
    (authority_basis = 'SYSTEM_BOOTSTRAP_L14_AUTHORITY_V1'
      AND basis_authority_policy_id IS NULL AND basis_version_id IS NULL AND basis_content_hash IS NULL)
    OR (authority_basis = 'AUTHORITY_POLICY_VERSION'
      AND basis_authority_policy_id IS NOT NULL AND basis_version_id IS NOT NULL AND basis_content_hash IS NOT NULL)),
  CONSTRAINT l14_authority_policy_states_no_self_basis_check CHECK (
    basis_version_id IS NULL OR basis_version_id <> version_id),
  CONSTRAINT l14_authority_policy_states_version_fkey
    FOREIGN KEY (organisation_id, authority_policy_id, version_id, content_hash)
    REFERENCES gov_repo.l14_authority_policy_versions (organisation_id, authority_policy_id, version_id, content_hash),
  CONSTRAINT l14_authority_policy_states_basis_fkey
    FOREIGN KEY (organisation_id, basis_authority_policy_id, basis_version_id, basis_content_hash)
    REFERENCES gov_repo.l14_authority_policy_versions (organisation_id, authority_policy_id, version_id, content_hash),
  CONSTRAINT l14_authority_policy_states_decision_fkey FOREIGN KEY (organisation_id, governance_decision_id)
    REFERENCES gov_repo.l14_governance_decisions (organisation_id, governance_decision_id),
  CONSTRAINT l14_authority_policy_states_predecessor_fkey FOREIGN KEY (organisation_id, predecessor_state_id)
    REFERENCES gov_repo.l14_authority_policy_states (organisation_id, state_id),
  CONSTRAINT l14_authority_policy_states_revokes_fkey FOREIGN KEY (organisation_id, revokes_state_id)
    REFERENCES gov_repo.l14_authority_policy_states (organisation_id, state_id)
);
CREATE UNIQUE INDEX l14_authority_policy_states_first_uidx
  ON gov_repo.l14_authority_policy_states (organisation_id)
  WHERE predecessor_state_id IS NULL;

-- Technical pointers only (§4, §17): RPC-maintained, reconstructible from history.
CREATE TABLE gov_repo.l14_authority_policy_heads (
  organisation_id uuid NOT NULL,
  authority_policy_id uuid NOT NULL,
  latest_version_id uuid NOT NULL,
  latest_state_id uuid,
  CONSTRAINT l14_authority_policy_heads_pkey PRIMARY KEY (organisation_id),
  CONSTRAINT l14_authority_policy_heads_policy_fkey FOREIGN KEY (organisation_id, authority_policy_id)
    REFERENCES gov_repo.l14_authority_policies (organisation_id, authority_policy_id),
  CONSTRAINT l14_authority_policy_heads_version_fkey FOREIGN KEY (organisation_id, authority_policy_id, latest_version_id)
    REFERENCES gov_repo.l14_authority_policy_versions (organisation_id, authority_policy_id, version_id),
  CONSTRAINT l14_authority_policy_heads_state_fkey FOREIGN KEY (organisation_id, latest_state_id)
    REFERENCES gov_repo.l14_authority_policy_states (organisation_id, state_id)
);

-- Durable command identity (organisation_id + command_id) and ORIGINAL result.
CREATE TABLE gov_repo.l14_command_results (
  organisation_id uuid NOT NULL REFERENCES gov_repo.organisations (organisation_id),
  command_id text NOT NULL CHECK (length(command_id) BETWEEN 1 AND 200 AND command_id = btrim(command_id)),
  command_kind text NOT NULL CHECK (command_kind IN (
    'ADMIT_AUTHORITY_POLICY_VERSION','SUBMIT_PROPOSAL','DECIDE_PROPOSAL')),
  command_fingerprint text NOT NULL CHECK (command_fingerprint ~ '^[0-9a-f]{64}$'),
  actor_user_id uuid NOT NULL REFERENCES gov_repo.governance_users (user_id),
  outcome text NOT NULL CHECK (outcome IN (
    'ADMITTED','SUBMITTED','VALIDATED','REJECTED','DEFERRED','REVOKED','DENIED')),
  authorization_decision_id uuid,
  proposal_id uuid,
  governance_decision_id uuid,
  authority_policy_id uuid,
  version_id uuid,
  state_id uuid,
  recorded_at timestamptz NOT NULL,
  CONSTRAINT l14_command_results_pkey PRIMARY KEY (organisation_id, command_id),
  CONSTRAINT l14_command_results_shape_check CHECK (
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
      AND proposal_id IS NOT NULL AND governance_decision_id IS NOT NULL AND state_id IS NULL)),
  CONSTRAINT l14_command_results_authorization_fkey FOREIGN KEY (organisation_id, authorization_decision_id)
    REFERENCES gov_repo.l14_authorization_decisions (organisation_id, authorization_decision_id),
  CONSTRAINT l14_command_results_proposal_fkey FOREIGN KEY (organisation_id, proposal_id)
    REFERENCES gov_repo.l14_proposals (organisation_id, proposal_id),
  CONSTRAINT l14_command_results_decision_fkey FOREIGN KEY (organisation_id, governance_decision_id)
    REFERENCES gov_repo.l14_governance_decisions (organisation_id, governance_decision_id),
  CONSTRAINT l14_command_results_version_fkey FOREIGN KEY (organisation_id, authority_policy_id, version_id)
    REFERENCES gov_repo.l14_authority_policy_versions (organisation_id, authority_policy_id, version_id),
  CONSTRAINT l14_command_results_state_fkey FOREIGN KEY (organisation_id, state_id)
    REFERENCES gov_repo.l14_authority_policy_states (organisation_id, state_id)
);

-- Normalized support links (U1): ONLY gov_repo.discovery_evidence(organisation_id, evidence_id).
-- Zero links = support_status NONE on the owning record; nothing is fabricated.
CREATE TABLE gov_repo.l14_support_links (
  organisation_id uuid NOT NULL,
  support_link_id uuid NOT NULL,
  owner_kind text NOT NULL CHECK (owner_kind IN (
    'AUTHORITY_POLICY_VERSION_ADMISSION','PROPOSAL','GOVERNANCE_DECISION','AUTHORITY_POLICY_STATE')),
  authority_policy_id uuid,
  version_id uuid,
  proposal_id uuid,
  governance_decision_id uuid,
  state_id uuid,
  evidence_id text NOT NULL,
  CONSTRAINT l14_support_links_pkey PRIMARY KEY (organisation_id, support_link_id),
  CONSTRAINT l14_support_links_owner_check CHECK (
    (owner_kind = 'AUTHORITY_POLICY_VERSION_ADMISSION' AND authority_policy_id IS NOT NULL AND version_id IS NOT NULL
      AND proposal_id IS NULL AND governance_decision_id IS NULL AND state_id IS NULL)
    OR (owner_kind = 'PROPOSAL' AND proposal_id IS NOT NULL AND authority_policy_id IS NULL AND version_id IS NULL
      AND governance_decision_id IS NULL AND state_id IS NULL)
    OR (owner_kind = 'GOVERNANCE_DECISION' AND governance_decision_id IS NOT NULL AND authority_policy_id IS NULL
      AND version_id IS NULL AND proposal_id IS NULL AND state_id IS NULL)
    OR (owner_kind = 'AUTHORITY_POLICY_STATE' AND state_id IS NOT NULL AND authority_policy_id IS NULL
      AND version_id IS NULL AND proposal_id IS NULL AND governance_decision_id IS NULL)),
  CONSTRAINT l14_support_links_evidence_fkey FOREIGN KEY (organisation_id, evidence_id)
    REFERENCES gov_repo.discovery_evidence (organisation_id, evidence_id),
  CONSTRAINT l14_support_links_version_fkey FOREIGN KEY (organisation_id, authority_policy_id, version_id)
    REFERENCES gov_repo.l14_authority_policy_versions (organisation_id, authority_policy_id, version_id),
  CONSTRAINT l14_support_links_proposal_fkey FOREIGN KEY (organisation_id, proposal_id)
    REFERENCES gov_repo.l14_proposals (organisation_id, proposal_id),
  CONSTRAINT l14_support_links_decision_fkey FOREIGN KEY (organisation_id, governance_decision_id)
    REFERENCES gov_repo.l14_governance_decisions (organisation_id, governance_decision_id),
  CONSTRAINT l14_support_links_state_fkey FOREIGN KEY (organisation_id, state_id)
    REFERENCES gov_repo.l14_authority_policy_states (organisation_id, state_id)
);
CREATE UNIQUE INDEX l14_support_links_version_uidx ON gov_repo.l14_support_links
  (organisation_id, authority_policy_id, version_id, evidence_id) WHERE owner_kind = 'AUTHORITY_POLICY_VERSION_ADMISSION';
CREATE UNIQUE INDEX l14_support_links_proposal_uidx ON gov_repo.l14_support_links
  (organisation_id, proposal_id, evidence_id) WHERE owner_kind = 'PROPOSAL';
CREATE UNIQUE INDEX l14_support_links_decision_uidx ON gov_repo.l14_support_links
  (organisation_id, governance_decision_id, evidence_id) WHERE owner_kind = 'GOVERNANCE_DECISION';
CREATE UNIQUE INDEX l14_support_links_state_uidx ON gov_repo.l14_support_links
  (organisation_id, state_id, evidence_id) WHERE owner_kind = 'AUTHORITY_POLICY_STATE';

-- Snapshot of the actual LOCKED persisted role basis (never JWT role/email).
CREATE TABLE gov_repo.l14_authorization_decision_roles (
  organisation_id uuid NOT NULL,
  authorization_decision_id uuid NOT NULL,
  role_id uuid NOT NULL,
  role_code text NOT NULL,
  is_system_role boolean NOT NULL,
  CONSTRAINT l14_authorization_decision_roles_pkey PRIMARY KEY (organisation_id, authorization_decision_id, role_id),
  CONSTRAINT l14_authorization_decision_roles_decision_fkey FOREIGN KEY (organisation_id, authorization_decision_id)
    REFERENCES gov_repo.l14_authorization_decisions (organisation_id, authorization_decision_id)
);

-- Effective permission snapshot: the bounded bootstrap grant, or (S1A.2+) matched policy rules.
CREATE TABLE gov_repo.l14_authorization_decision_rules (
  organisation_id uuid NOT NULL,
  authorization_decision_id uuid NOT NULL,
  snapshot_ordinal integer NOT NULL CHECK (snapshot_ordinal >= 1),
  permission_origin text NOT NULL CHECK (permission_origin IN ('SYSTEM_BOOTSTRAP','AUTHORITY_POLICY_RULE')),
  permission text NOT NULL CHECK (permission IN (
    'L14_AUTHORITY_POLICY_ADMIT','L14_PARTY_ADMIT','L14_DOMAIN_ADMIT','L14_CONTROL_DEFINITION_ADMIT',
    'L14_POLICY_CONTENT_ADMIT','L14_AUTHORITY_POLICY_ADMIN','L14_PARTY_VALIDATE','L14_DOMAIN_VALIDATE',
    'L14_CONTROL_DEFINITION_VALIDATE','L14_POLICY_VERSION_VALIDATE','L14_RESPONSIBILITY_VALIDATE',
    'L14_BUSINESS_CONTEXT_VALIDATE','L14_POLICY_APPLICABILITY_VALIDATE','L14_CONTROL_APPLICABILITY_VALIDATE',
    'L14_CONTROL_ASSESSMENT_VALIDATE')),
  requested_action text NOT NULL CHECK (requested_action IN ('ADMIT','VALIDATE','REJECT','DEFER','REVOKE')),
  source_class text NOT NULL CHECK (source_class IN ('SYSTEM_SEED','LOCAL_HUMAN','SOURCE_CONNECTION')),
  source_disposition text NOT NULL CHECK (source_disposition IN ('AUTHORITATIVE','CONTRIBUTING','NON_AUTHORITATIVE')),
  scope_tag text NOT NULL CHECK (scope_tag IN (
    'ALL_ALLOWED_TARGETS','CANONICAL_KIND','CANONICAL_OBJECT','RELATIONSHIP_TYPE','RELATIONSHIP_STATE')),
  allow_self_validation boolean NOT NULL,
  allow_future_dating boolean NOT NULL,
  allow_backdating boolean NOT NULL,
  basis_authority_policy_id uuid,
  basis_version_id uuid,
  basis_rule_ordinal integer,
  CONSTRAINT l14_authorization_decision_rules_pkey PRIMARY KEY (organisation_id, authorization_decision_id, snapshot_ordinal),
  CONSTRAINT l14_authorization_decision_rules_decision_fkey FOREIGN KEY (organisation_id, authorization_decision_id)
    REFERENCES gov_repo.l14_authorization_decisions (organisation_id, authorization_decision_id),
  CONSTRAINT l14_authorization_decision_rules_rule_fkey
    FOREIGN KEY (organisation_id, basis_authority_policy_id, basis_version_id, basis_rule_ordinal)
    REFERENCES gov_repo.l14_authority_policy_rules (organisation_id, authority_policy_id, version_id, rule_ordinal),
  CONSTRAINT l14_authorization_decision_rules_origin_check CHECK (
    (permission_origin = 'SYSTEM_BOOTSTRAP' AND basis_authority_policy_id IS NULL AND basis_version_id IS NULL
      AND basis_rule_ordinal IS NULL)
    OR (permission_origin = 'AUTHORITY_POLICY_RULE' AND basis_authority_policy_id IS NOT NULL
      AND basis_version_id IS NOT NULL AND basis_rule_ordinal IS NOT NULL))
);

-- ---------------------------------------------------------------------------------------
-- B. Cross-table references closing the insertion cycles.
-- ---------------------------------------------------------------------------------------
ALTER TABLE gov_repo.l14_authorization_decisions
  ADD CONSTRAINT l14_authorization_decisions_proposal_fkey FOREIGN KEY (organisation_id, proposal_id)
    REFERENCES gov_repo.l14_proposals (organisation_id, proposal_id),
  -- The ADMIT subject version is created AFTER its authorization in the same transaction.
  ADD CONSTRAINT l14_authorization_decisions_subject_fkey
    FOREIGN KEY (organisation_id, subject_authority_policy_id, subject_version_id)
    REFERENCES gov_repo.l14_authority_policy_versions (organisation_id, authority_policy_id, version_id)
    DEFERRABLE INITIALLY DEFERRED,
  ADD CONSTRAINT l14_authorization_decisions_basis_fkey
    FOREIGN KEY (organisation_id, basis_authority_policy_id, basis_version_id, basis_content_hash)
    REFERENCES gov_repo.l14_authority_policy_versions (organisation_id, authority_policy_id, version_id, content_hash),
  -- Every authorization belongs to exactly one durable command result, committed atomically.
  ADD CONSTRAINT l14_authorization_decisions_command_fkey FOREIGN KEY (organisation_id, command_id)
    REFERENCES gov_repo.l14_command_results (organisation_id, command_id)
    DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE gov_repo.l14_authority_policy_version_proposals
  ADD CONSTRAINT l14_authority_policy_version_proposals_target_fkey FOREIGN KEY (organisation_id, target_state_id)
    REFERENCES gov_repo.l14_authority_policy_states (organisation_id, state_id);

-- ---------------------------------------------------------------------------------------
-- C. Raising immutability (§17, §20). Never DO INSTEAD NOTHING; TRUNCATE also raises.
-- ---------------------------------------------------------------------------------------
CREATE FUNCTION gov_repo.l14_history_immutable_v1()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, pg_temp
AS $immutable$
BEGIN
  RAISE EXCEPTION 'L14_HISTORY_IMMUTABLE'
    USING ERRCODE = '55000', DETAIL = TG_TABLE_NAME || ':' || TG_OP;
END;
$immutable$;

DO $triggers$
DECLARE
  v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'l14_authority_policies','l14_authority_policy_versions','l14_authority_policy_rules',
    'l14_proposals','l14_authority_policy_version_proposals','l14_authorization_decisions',
    'l14_authorization_decision_roles','l14_authorization_decision_rules','l14_governance_decisions',
    'l14_authority_policy_states','l14_command_results','l14_support_links'
  ] LOOP
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

-- The head is the only mutable S1A table: identity is fixed, never deleted/truncated, and
-- only ever advanced by the RPCs (no application privilege exists on it).
CREATE FUNCTION gov_repo.l14_authority_policy_head_guard_v1()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, pg_temp
AS $head$
BEGIN
  IF TG_OP IN ('DELETE', 'TRUNCATE') THEN
    RAISE EXCEPTION 'L14_HISTORY_IMMUTABLE' USING ERRCODE = '55000', DETAIL = 'l14_authority_policy_heads:' || TG_OP;
  END IF;
  IF NEW.organisation_id IS DISTINCT FROM OLD.organisation_id
     OR NEW.authority_policy_id IS DISTINCT FROM OLD.authority_policy_id
     OR (OLD.latest_state_id IS NOT NULL AND NEW.latest_state_id IS NULL) THEN
    RAISE EXCEPTION 'L14_HISTORY_IMMUTABLE' USING ERRCODE = '55000', DETAIL = 'l14_authority_policy_heads:IDENTITY';
  END IF;
  RETURN NEW;
END;
$head$;
CREATE TRIGGER l14_authority_policy_heads_guard BEFORE UPDATE OR DELETE ON gov_repo.l14_authority_policy_heads
  FOR EACH ROW EXECUTE FUNCTION gov_repo.l14_authority_policy_head_guard_v1();
CREATE TRIGGER l14_authority_policy_heads_no_truncate BEFORE TRUNCATE ON gov_repo.l14_authority_policy_heads
  FOR EACH STATEMENT EXECUTE FUNCTION gov_repo.l14_authority_policy_head_guard_v1();
ALTER TABLE gov_repo.l14_authority_policy_heads ENABLE ALWAYS TRIGGER l14_authority_policy_heads_guard;
ALTER TABLE gov_repo.l14_authority_policy_heads ENABLE ALWAYS TRIGGER l14_authority_policy_heads_no_truncate;

-- ---------------------------------------------------------------------------------------
-- D. Internal owner-only helpers: canonical framing, hashing, validation, resolution.
-- ---------------------------------------------------------------------------------------

-- Optional operand framing: absent ('N') and present ('V' || value) never collide.
CREATE FUNCTION gov_repo.l14_frame_optional_v1(p_value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, pg_temp
AS $$ SELECT CASE WHEN p_value IS NULL THEN 'N' ELSE 'V' || p_value END $$;

-- Canonical UTC microsecond rendering of an explicit instant (temporal intent).
CREATE FUNCTION gov_repo.l14_canonical_instant_v1(p_value timestamptz)
RETURNS text
LANGUAGE sql
STABLE
STRICT
SET search_path = pg_catalog, pg_temp
AS $$ SELECT pg_catalog.to_char(p_value AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') $$;

-- sha256 over length-framed parts. A NULL part would be silently dropped by the framing
-- aggregate, so it is rejected instead: absence must always be an explicit marker.
CREATE FUNCTION gov_repo.l14_sha256_frame_v1(p_parts text[])
RETURNS text
LANGUAGE plpgsql
STABLE
SET search_path = pg_catalog, pg_temp
AS $sha$
BEGIN
  IF p_parts IS NULL OR pg_catalog.array_position(p_parts, NULL::text) IS NOT NULL THEN
    RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'FINGERPRINT_PART_MISSING';
  END IF;
  RETURN pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(gov_repo.frame_identity(p_parts), 'UTF8')), 'hex');
END;
$sha$;

-- One rule's canonical frame. Single source of truth for admission and stored recomputation.
CREATE FUNCTION gov_repo.l14_authority_policy_rule_frame_v1(
  p_role_id uuid, p_permission text, p_requested_action text, p_source_class text, p_source_disposition text,
  p_scope_tag text, p_scope_canonical_kind text, p_scope_canonical_object_id text, p_scope_relationship_type text,
  p_scope_relationship_id text, p_scope_relationship_state_id text,
  p_allow_self_validation boolean, p_allow_future_dating boolean, p_allow_backdating boolean
)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT gov_repo.frame_identity(ARRAY[
    'L14_AUTHORITY_POLICY_RULE_V1', p_role_id::text, p_permission, p_requested_action, p_source_class,
    p_source_disposition, p_scope_tag,
    gov_repo.l14_frame_optional_v1(p_scope_canonical_kind),
    gov_repo.l14_frame_optional_v1(p_scope_canonical_object_id),
    gov_repo.l14_frame_optional_v1(p_scope_relationship_type),
    gov_repo.l14_frame_optional_v1(p_scope_relationship_id),
    gov_repo.l14_frame_optional_v1(p_scope_relationship_state_id),
    CASE WHEN p_allow_self_validation THEN 'T' ELSE 'F' END,
    CASE WHEN p_allow_future_dating THEN 'T' ELSE 'F' END,
    CASE WHEN p_allow_backdating THEN 'T' ELSE 'F' END])
$$;

-- Content hash of the complete typed rule set: frames in UTF-8 byte order (never caller
-- order, never collation), preceded by the rule count.
CREATE FUNCTION gov_repo.l14_authority_policy_content_hash_v1(p_rule_frames text[])
RETURNS text
LANGUAGE sql
STABLE
STRICT
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT gov_repo.l14_sha256_frame_v1(
    ARRAY['L14_AUTHORITY_POLICY_CONTENT_V1', pg_catalog.cardinality(p_rule_frames)::text]
    || COALESCE((SELECT pg_catalog.array_agg(f ORDER BY pg_catalog.convert_to(f, 'UTF8'))
                 FROM pg_catalog.unnest(p_rule_frames) AS u(f)), ARRAY[]::text[]))
$$;

-- Recompute a stored version's hash from its immutable typed rules (never trusts the column).
CREATE FUNCTION gov_repo.l14_stored_authority_policy_content_hash_v1(
  p_organisation_id uuid, p_authority_policy_id uuid, p_version_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT gov_repo.l14_authority_policy_content_hash_v1(COALESCE(pg_catalog.array_agg(
    gov_repo.l14_authority_policy_rule_frame_v1(r.role_id, r.permission, r.requested_action, r.source_class,
      r.source_disposition, r.scope_tag, r.scope_canonical_kind, r.scope_canonical_object_id,
      r.scope_relationship_type, r.scope_relationship_id, r.scope_relationship_state_id,
      r.allow_self_validation, r.allow_future_dating, r.allow_backdating)), ARRAY[]::text[]))
  FROM gov_repo.l14_authority_policy_rules AS r
  WHERE r.organisation_id = p_organisation_id AND r.authority_policy_id = p_authority_policy_id
    AND r.version_id = p_version_id
$$;

-- Transport → typed rules. The JSON array is ONLY transport: every element must be an object
-- with exactly the closed key set, closed vocabularies, legal operand shapes, and tenant-resolved
-- references. Returns canonical rows in byte order of their frames with DB-assigned ordinals.
CREATE FUNCTION gov_repo.l14_parse_authority_policy_rules_v1(p_organisation_id uuid, p_rules jsonb)
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
    'L14_CONTROL_DEFINITION_VALIDATE','L14_POLICY_VERSION_VALIDATE','L14_RESPONSIBILITY_VALIDATE',
    'L14_BUSINESS_CONTEXT_VALIDATE','L14_POLICY_APPLICABILITY_VALIDATE','L14_CONTROL_APPLICABILITY_VALIDATE',
    'L14_CONTROL_ASSESSMENT_VALIDATE'];
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

-- Support: NONE = exactly zero ids; PRESENT = >=1 distinct ids resolving in THIS tenant's
-- gov_repo.discovery_evidence. Returns the canonical framing parts (ids in UTF-8 byte order).
CREATE FUNCTION gov_repo.l14_support_parts_v1(p_organisation_id uuid, p_support_status text, p_evidence_ids text[])
RETURNS text[]
LANGUAGE plpgsql
STABLE
SET search_path = pg_catalog, pg_temp
AS $support$
DECLARE
  v_count integer;
  v_resolved integer;
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
  SELECT pg_catalog.count(*) INTO v_resolved
  FROM gov_repo.discovery_evidence AS de
  WHERE de.organisation_id = p_organisation_id AND de.evidence_id = ANY (p_evidence_ids);
  IF v_resolved <> v_count THEN
    RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'SUPPORT_REFERENCE_UNRESOLVED';
  END IF;
  RETURN ARRAY[p_support_status, v_count::text]
    || COALESCE((SELECT pg_catalog.array_agg(i.id ORDER BY pg_catalog.convert_to(i.id, 'UTF8'))
                 FROM pg_catalog.unnest(p_evidence_ids) AS i(id)), ARRAY[]::text[]);
END;
$support$;

CREATE FUNCTION gov_repo.l14_validate_command_id_v1(p_command_id text, p_caller_fingerprint text)
RETURNS void
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog, pg_temp
AS $cmd$
BEGIN
  IF p_command_id IS NULL OR pg_catalog.length(p_command_id) NOT BETWEEN 1 AND 200
     OR p_command_id <> pg_catalog.btrim(p_command_id) THEN
    RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'COMMAND_ID_INVALID';
  END IF;
  IF p_caller_fingerprint IS NULL OR p_caller_fingerprint !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'CALLER_FINGERPRINT_MALFORMED';
  END IF;
END;
$cmd$;

-- Base session eligibility through the ONE canonical S0 helper (locks ORG -> USER -> ROLES).
-- Errors GV001-GV005/55P03 propagate unchanged; nothing has been written at that point.
CREATE FUNCTION gov_repo.l14_session_basis_v1(
  p_organisation_id uuid, p_actor_user_id uuid, p_iat bigint, p_exp bigint, p_credential_epoch timestamptz)
RETURNS TABLE (role_ids uuid[], has_bootstrap_role boolean)
LANGUAGE plpgsql
VOLATILE
SET search_path = pg_catalog, pg_temp
AS $basis$
#variable_conflict use_column
DECLARE
  v_org uuid;
  v_actor uuid;
  v_role_ids uuid[];
  v_admin boolean;
BEGIN
  SELECT e.organisation_id, e.actor_user_id, e.role_ids, e.has_governance_admin
  INTO v_org, v_actor, v_role_ids, v_admin
  FROM gov_repo.lock_and_resolve_governance_session_eligibility_v1(
    p_organisation_id, p_actor_user_id, p_iat, p_exp, p_credential_epoch) AS e;
  IF NOT FOUND OR v_org IS DISTINCT FROM p_organisation_id OR v_actor IS DISTINCT FROM p_actor_user_id THEN
    RAISE EXCEPTION 'M16_ELIGIBILITY_ACTOR_OR_ORGANISATION_INELIGIBLE'
      USING ERRCODE = 'GV003', DETAIL = 'ELIGIBILITY_RESULT_MISMATCH';
  END IF;
  -- has_governance_admin is exactly role_code = 'GOVERNANCE_ADMIN' AND is_system_role = true,
  -- resolved from the role rows the helper holds FOR SHARE until commit.
  RETURN QUERY SELECT v_role_ids, v_admin IS TRUE;
END;
$basis$;

CREATE FUNCTION gov_repo.l14_lock_authority_policy_guard_v1(p_organisation_id uuid)
RETURNS void
LANGUAGE sql
VOLATILE
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    gov_repo.frame_identity(ARRAY[p_organisation_id::text, 'l14-authority-policy-guard-v1']), 0))
$$;

-- Persist the role snapshot of the LOCKED persisted roles (never JWT role/email).
CREATE FUNCTION gov_repo.l14_snapshot_roles_v1(p_organisation_id uuid, p_authorization_decision_id uuid, p_role_ids uuid[])
RETURNS void
LANGUAGE sql
VOLATILE
SET search_path = pg_catalog, pg_temp
AS $$
  INSERT INTO gov_repo.l14_authorization_decision_roles
    (organisation_id, authorization_decision_id, role_id, role_code, is_system_role)
  SELECT p_organisation_id, p_authorization_decision_id, gr.role_id, gr.role_code::text, gr.is_system_role
  FROM gov_repo.governance_roles AS gr
  WHERE gr.role_id = ANY (p_role_ids)
$$;

-- The ORIGINAL durable result, exactly as stored (replay never recomputes it).
CREATE FUNCTION gov_repo.l14_command_result_v1(p_organisation_id uuid, p_command_id text, p_replay boolean)
RETURNS TABLE (
  replay boolean, command_id text, command_kind text, outcome text, command_fingerprint text,
  authorization_decision_id uuid, authorization_result text, deny_reason text, proposal_id uuid,
  governance_decision_id uuid, authority_policy_id uuid, version_id uuid, content_hash text,
  state_id uuid, effective_from timestamptz, recorded_at timestamptz
)
LANGUAGE sql
STABLE
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT p_replay, c.command_id, c.command_kind, c.outcome, c.command_fingerprint,
         c.authorization_decision_id, a.result, a.deny_reason, c.proposal_id,
         c.governance_decision_id, c.authority_policy_id, c.version_id, v.content_hash,
         c.state_id, s.effective_from, c.recorded_at
  FROM gov_repo.l14_command_results AS c
  LEFT JOIN gov_repo.l14_authorization_decisions AS a
    ON a.organisation_id = c.organisation_id AND a.authorization_decision_id = c.authorization_decision_id
  LEFT JOIN gov_repo.l14_authority_policy_versions AS v
    ON v.organisation_id = c.organisation_id AND v.authority_policy_id = c.authority_policy_id
   AND v.version_id = c.version_id
  LEFT JOIN gov_repo.l14_authority_policy_states AS s
    ON s.organisation_id = c.organisation_id AND s.state_id = c.state_id
  WHERE c.organisation_id = p_organisation_id AND c.command_id = p_command_id
$$;

-- Replay arbitration (U4): same command + same DB fingerprint → true (return the original);
-- same command + different fingerprint → GV007; unknown command → false.
CREATE FUNCTION gov_repo.l14_replay_arbitrate_v1(p_organisation_id uuid, p_command_id text, p_fingerprint text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SET search_path = pg_catalog, pg_temp
AS $replay$
DECLARE
  v_existing text;
BEGIN
  SELECT c.command_fingerprint INTO v_existing
  FROM gov_repo.l14_command_results AS c
  WHERE c.organisation_id = p_organisation_id AND c.command_id = p_command_id;
  IF NOT FOUND THEN
    RETURN false;
  END IF;
  IF v_existing IS DISTINCT FROM p_fingerprint THEN
    RAISE EXCEPTION 'L14_REPLAY_CONFLICT' USING ERRCODE = 'GV007', DETAIL = 'COMMAND_ID_REUSED_WITH_DIFFERENT_SEMANTICS';
  END IF;
  RETURN true;
END;
$replay$;

-- Bitemporal effective resolver (§17): the Authority Policy version effective at business
-- instant p_effective_at, as known at system cutoff p_recorded_cutoff. States recorded after
-- the cutoff are invisible; states effective after p_effective_at never hide the current one;
-- a VALIDATED state stops counting only from the effective_from of a visible REVOKED state
-- that targets it EXACTLY (revokes_state_id). Ambiguity (a tie) fails closed with no row.
-- No predecessor row is ever edited: closure is derived, never stored.
CREATE FUNCTION gov_repo.l14_effective_authority_policy_version_v1(
  p_organisation_id uuid, p_effective_at timestamptz, p_recorded_cutoff timestamptz)
RETURNS TABLE (
  authority_policy_id uuid, version_id uuid, content_hash text, state_id uuid,
  effective_from timestamptz, recorded_at timestamptz
)
LANGUAGE sql
STABLE
STRICT
SET search_path = pg_catalog, pg_temp
AS $$
  WITH visible AS (
    SELECT s.* FROM gov_repo.l14_authority_policy_states AS s
    WHERE s.organisation_id = p_organisation_id AND s.recorded_at <= p_recorded_cutoff
  ), candidates AS (
    SELECT v.* FROM visible AS v
    WHERE v.state_kind = 'VALIDATED' AND v.effective_from <= p_effective_at
      AND NOT EXISTS (SELECT 1 FROM visible AS r
                      WHERE r.state_kind = 'REVOKED' AND r.revokes_state_id = v.state_id
                        AND r.effective_from <= p_effective_at)
  ), ranked AS (
    SELECT c.*, pg_catalog.max(c.effective_from) OVER () AS top_effective_from,
           pg_catalog.count(*) OVER (PARTITION BY c.effective_from) AS ties
    FROM candidates AS c
  )
  SELECT r.authority_policy_id, r.version_id, r.content_hash, r.state_id, r.effective_from, r.recorded_at
  FROM ranked AS r
  WHERE r.effective_from = r.top_effective_from AND r.ties = 1
$$;

-- ---------------------------------------------------------------------------------------
-- E. RPC 1 — ADMIT of the FIRST Authority Policy version (bootstrap).
-- ---------------------------------------------------------------------------------------
CREATE FUNCTION gov_repo.l14_admit_authority_policy_version_v1(
  p_verified_organisation_id uuid,
  p_verified_actor_user_id uuid,
  p_verified_session_iat bigint,
  p_verified_session_exp bigint,
  p_verified_credential_epoch timestamptz,
  p_command_id text,
  p_expected_authority_policy_id uuid,     -- NULL with NULL version = explicit expected-none
  p_expected_latest_version_id uuid,
  p_source_class text,
  p_rules jsonb,                           -- transport only; parsed into typed rows
  p_support_status text,
  p_support_evidence_ids text[],
  p_caller_fingerprint text                -- assertion only; PostgreSQL recomputes
)
RETURNS TABLE (
  replay boolean, command_id text, command_kind text, outcome text, command_fingerprint text,
  authorization_decision_id uuid, authorization_result text, deny_reason text, proposal_id uuid,
  governance_decision_id uuid, authority_policy_id uuid, version_id uuid, content_hash text,
  state_id uuid, effective_from timestamptz, recorded_at timestamptz
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
SET lock_timeout = '5s'
AS $admit$
#variable_conflict use_column
DECLARE
  v_org uuid := p_verified_organisation_id;
  v_actor uuid := p_verified_actor_user_id;
  v_role_ids uuid[];
  v_bootstrap_role boolean;
  v_frames text[];
  v_rule_count integer;
  v_content_hash text;
  v_support text[];
  v_fingerprint text;
  v_existing_policy uuid;
  v_now timestamptz;
  v_authz uuid := pg_catalog.gen_random_uuid();
  v_policy uuid := pg_catalog.gen_random_uuid();
  v_version uuid := pg_catalog.gen_random_uuid();
  v_allow boolean;
BEGIN
  -- A. Base session eligibility (raises GV001-GV005/55P03; nothing consumed).
  SELECT b.role_ids, b.has_bootstrap_role INTO v_role_ids, v_bootstrap_role
  FROM gov_repo.l14_session_basis_v1(v_org, v_actor, p_verified_session_iat, p_verified_session_exp,
    p_verified_credential_epoch) AS b;

  -- B. Closed command contract and tenant-resolved references.
  PERFORM gov_repo.l14_validate_command_id_v1(p_command_id, p_caller_fingerprint);
  IF p_source_class IS NULL OR p_source_class NOT IN ('SYSTEM_SEED','LOCAL_HUMAN','SOURCE_CONNECTION') THEN
    RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'SOURCE_CLASS_UNKNOWN';
  END IF;
  IF p_source_class <> 'LOCAL_HUMAN' THEN
    RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'SOURCE_CLASS_NOT_EXECUTABLE';
  END IF;
  IF (p_expected_authority_policy_id IS NULL) <> (p_expected_latest_version_id IS NULL) THEN
    RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'EXPECTATION_MALFORMED';
  END IF;
  SELECT pg_catalog.array_agg(r.rule_frame ORDER BY r.rule_ordinal), pg_catalog.count(*)
  INTO v_frames, v_rule_count
  FROM gov_repo.l14_parse_authority_policy_rules_v1(v_org, p_rules) AS r;
  v_frames := COALESCE(v_frames, ARRAY[]::text[]);
  IF v_rule_count <> (SELECT pg_catalog.count(DISTINCT f) FROM pg_catalog.unnest(v_frames) AS u(f)) THEN
    RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'RULE_DUPLICATE';
  END IF;
  v_support := gov_repo.l14_support_parts_v1(v_org, p_support_status, p_support_evidence_ids);

  -- C. PostgreSQL-authoritative content hash and command fingerprint.
  v_content_hash := gov_repo.l14_authority_policy_content_hash_v1(v_frames);
  v_fingerprint := gov_repo.l14_sha256_frame_v1(
    ARRAY['L14_COMMAND_FINGERPRINT_V1', 'ADMIT_AUTHORITY_POLICY_VERSION', v_org::text, v_actor::text,
          'ADMIT', 'AUTHORITY_POLICY_VERSION']
    || CASE WHEN p_expected_authority_policy_id IS NULL THEN ARRAY['EXPECTED_NONE']
            ELSE ARRAY['EXPECTED_CURRENT', p_expected_authority_policy_id::text, p_expected_latest_version_id::text] END
    || ARRAY[p_source_class, v_content_hash]
    || v_support);
  IF v_fingerprint IS DISTINCT FROM p_caller_fingerprint THEN
    RAISE EXCEPTION 'L14_FINGERPRINT_MISMATCH' USING ERRCODE = 'GV008', DETAIL = 'CALLER_FINGERPRINT_DIFFERS';
  END IF;

  -- D. Organisation Authority Policy guard (the §5 bootstrap guard).
  PERFORM gov_repo.l14_lock_authority_policy_guard_v1(v_org);

  -- E. Replay arbitration: the ORIGINAL result, never a re-evaluation (U4).
  IF gov_repo.l14_replay_arbitrate_v1(v_org, p_command_id, v_fingerprint) THEN
    PERFORM 1 FROM gov_repo.l14_session_basis_v1(v_org, v_actor, p_verified_session_iat,
      p_verified_session_exp, p_verified_credential_epoch);
    RETURN QUERY SELECT * FROM gov_repo.l14_command_result_v1(v_org, p_command_id, true);
    RETURN;
  END IF;

  -- F. Expected-none / non-first.
  SELECT ap.authority_policy_id INTO v_existing_policy
  FROM gov_repo.l14_authority_policies AS ap WHERE ap.organisation_id = v_org;
  IF p_expected_authority_policy_id IS NOT NULL THEN
    -- Successor ADMIT is S1A.2. Never a second bootstrap.
    RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'SUCCESSOR_LIFECYCLE_NOT_AVAILABLE';
  END IF;
  IF v_existing_policy IS NOT NULL THEN
    RAISE EXCEPTION 'L14_STALE_EXPECTATION' USING ERRCODE = 'GV009', DETAIL = 'AUTHORITY_POLICY_ALREADY_ESTABLISHED';
  END IF;

  -- G. Bootstrap: identity absent (monotone durable condition) + locked system GOVERNANCE_ADMIN.
  v_allow := v_bootstrap_role;
  v_now := pg_catalog.clock_timestamp();

  -- H. Durable authorization decision (+ locked role basis, + bounded bootstrap grant).
  INSERT INTO gov_repo.l14_authorization_decisions (
    organisation_id, authorization_decision_id, command_id, command_fingerprint, actor_user_id,
    requested_action, subject_kind, scope_tag, source_class, proposal_id, is_self_validation,
    subject_authority_policy_id, subject_version_id, authority_basis, result, deny_reason, evaluated_at)
  VALUES (
    v_org, v_authz, p_command_id, v_fingerprint, v_actor,
    'ADMIT', 'AUTHORITY_POLICY_VERSION', 'ALL_ALLOWED_TARGETS', p_source_class, NULL, NULL,
    CASE WHEN v_allow THEN v_policy END, CASE WHEN v_allow THEN v_version END,
    'SYSTEM_BOOTSTRAP_L14_AUTHORITY_V1',
    CASE WHEN v_allow THEN 'ALLOW' ELSE 'DENY' END,
    CASE WHEN v_allow THEN NULL ELSE 'BOOTSTRAP_ROLE_REQUIRED' END, v_now);
  PERFORM gov_repo.l14_snapshot_roles_v1(v_org, v_authz, v_role_ids);

  IF NOT v_allow THEN
    -- I (DENY). Authorization + command result only.
    INSERT INTO gov_repo.l14_command_results (organisation_id, command_id, command_kind, command_fingerprint,
      actor_user_id, outcome, authorization_decision_id, recorded_at)
    VALUES (v_org, p_command_id, 'ADMIT_AUTHORITY_POLICY_VERSION', v_fingerprint, v_actor, 'DENIED', v_authz, v_now);
  ELSE
    INSERT INTO gov_repo.l14_authorization_decision_rules (organisation_id, authorization_decision_id,
      snapshot_ordinal, permission_origin, permission, requested_action, source_class, source_disposition,
      scope_tag, allow_self_validation, allow_future_dating, allow_backdating)
    VALUES (v_org, v_authz, 1, 'SYSTEM_BOOTSTRAP', 'L14_AUTHORITY_POLICY_ADMIT', 'ADMIT', 'LOCAL_HUMAN',
      'AUTHORITATIVE', 'ALL_ALLOWED_TARGETS', false, false, false);
    -- I (ALLOW). Stable identity + version 1 + typed rules + support + head + admission result.
    -- No governance decision and no VALIDATED state: ADMIT != VALIDATE.
    INSERT INTO gov_repo.l14_authority_policies (organisation_id, authority_policy_id, established_at)
    VALUES (v_org, v_policy, v_now);
    INSERT INTO gov_repo.l14_authority_policy_versions (organisation_id, authority_policy_id, version_id,
      version_number, predecessor_version_id, content_hash, rule_count, source_class, admitted_by_actor_user_id,
      admission_authorization_decision_id, support_status, admitted_at)
    VALUES (v_org, v_policy, v_version, 1, NULL, v_content_hash, v_rule_count, p_source_class, v_actor,
      v_authz, p_support_status, v_now);
    INSERT INTO gov_repo.l14_authority_policy_rules (organisation_id, authority_policy_id, version_id, rule_ordinal,
      role_id, permission, requested_action, source_class, source_disposition, scope_tag, scope_canonical_kind,
      scope_canonical_object_id, scope_relationship_type, scope_relationship_id, scope_relationship_state_id,
      allow_self_validation, allow_future_dating, allow_backdating)
    SELECT v_org, v_policy, v_version, r.rule_ordinal, r.role_id, r.permission, r.requested_action, r.source_class,
      r.source_disposition, r.scope_tag, r.scope_canonical_kind, r.scope_canonical_object_id,
      r.scope_relationship_type, r.scope_relationship_id, r.scope_relationship_state_id,
      r.allow_self_validation, r.allow_future_dating, r.allow_backdating
    FROM gov_repo.l14_parse_authority_policy_rules_v1(v_org, p_rules) AS r;
    IF gov_repo.l14_stored_authority_policy_content_hash_v1(v_org, v_policy, v_version) IS DISTINCT FROM v_content_hash THEN
      RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'CONTENT_HASH_RECOMPUTATION_FAILED';
    END IF;
    INSERT INTO gov_repo.l14_support_links (organisation_id, support_link_id, owner_kind, authority_policy_id,
      version_id, evidence_id)
    SELECT v_org, pg_catalog.gen_random_uuid(), 'AUTHORITY_POLICY_VERSION_ADMISSION', v_policy, v_version, i.id
    FROM pg_catalog.unnest(p_support_evidence_ids) AS i(id);
    INSERT INTO gov_repo.l14_authority_policy_heads (organisation_id, authority_policy_id, latest_version_id, latest_state_id)
    VALUES (v_org, v_policy, v_version, NULL);
    INSERT INTO gov_repo.l14_command_results (organisation_id, command_id, command_kind, command_fingerprint,
      actor_user_id, outcome, authorization_decision_id, authority_policy_id, version_id, recorded_at)
    VALUES (v_org, p_command_id, 'ADMIT_AUTHORITY_POLICY_VERSION', v_fingerprint, v_actor, 'ADMITTED', v_authz,
      v_policy, v_version, v_now);
  END IF;

  -- J. Base session eligibility must still hold at commitment (fresh DB clock).
  PERFORM 1 FROM gov_repo.l14_session_basis_v1(v_org, v_actor, p_verified_session_iat,
    p_verified_session_exp, p_verified_credential_epoch);
  RETURN QUERY SELECT * FROM gov_repo.l14_command_result_v1(v_org, p_command_id, false);
END;
$admit$;

-- ---------------------------------------------------------------------------------------
-- F. RPC 2 — proposal submission (no authority, no decision, no head mutation).
-- ---------------------------------------------------------------------------------------
CREATE FUNCTION gov_repo.l14_submit_proposal_v1(
  p_verified_organisation_id uuid,
  p_verified_actor_user_id uuid,
  p_verified_session_iat bigint,
  p_verified_session_exp bigint,
  p_verified_credential_epoch timestamptz,
  p_command_id text,
  p_subject_kind text,
  p_intent text,
  p_source_class text,
  p_authority_policy_id uuid,
  p_version_id uuid,
  p_content_hash text,
  p_requested_effective_from timestamptz,   -- NULL = IMMEDIATE intent
  p_target_state_id uuid,
  p_prior_proposal_id uuid,
  p_support_status text,
  p_support_evidence_ids text[],
  p_caller_fingerprint text
)
RETURNS TABLE (
  replay boolean, command_id text, command_kind text, outcome text, command_fingerprint text,
  authorization_decision_id uuid, authorization_result text, deny_reason text, proposal_id uuid,
  governance_decision_id uuid, authority_policy_id uuid, version_id uuid, content_hash text,
  state_id uuid, effective_from timestamptz, recorded_at timestamptz
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
SET lock_timeout = '5s'
AS $submit$
#variable_conflict use_column
DECLARE
  v_org uuid := p_verified_organisation_id;
  v_actor uuid := p_verified_actor_user_id;
  v_version_number integer;
  v_support text[];
  v_fingerprint text;
  v_proposal uuid := pg_catalog.gen_random_uuid();
  v_now timestamptz;
BEGIN
  -- Any verified ACTIVE same-tenant member (no L14 permission is required to submit).
  PERFORM 1 FROM gov_repo.l14_session_basis_v1(v_org, v_actor, p_verified_session_iat,
    p_verified_session_exp, p_verified_credential_epoch);

  PERFORM gov_repo.l14_validate_command_id_v1(p_command_id, p_caller_fingerprint);
  IF p_subject_kind IS NULL OR p_subject_kind NOT IN (
       'AUTHORITY_POLICY_VERSION','GOVERNANCE_PARTY','BUSINESS_DOMAIN','INFORMATION_DOMAIN',
       'CONTROL_DEFINITION','POLICY_VERSION','RESPONSIBILITY_ASSIGNMENT','BUSINESS_CONTEXT_ASSIGNMENT',
       'POLICY_APPLICABILITY','CONTROL_APPLICABILITY','CONTROL_ASSESSMENT')
     OR p_intent IS NULL OR p_intent NOT IN ('VALIDATE','REVOKE')
     OR p_source_class IS NULL OR p_source_class NOT IN ('SYSTEM_SEED','LOCAL_HUMAN','SOURCE_CONNECTION') THEN
    RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'PROPOSAL_VOCABULARY_UNKNOWN';
  END IF;
  IF p_subject_kind <> 'AUTHORITY_POLICY_VERSION' THEN
    RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'SUBJECT_KIND_NOT_EXECUTABLE';
  END IF;
  IF p_source_class <> 'LOCAL_HUMAN' THEN
    RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'SOURCE_CLASS_NOT_EXECUTABLE';
  END IF;
  IF p_intent <> 'VALIDATE' OR p_target_state_id IS NOT NULL THEN
    -- REVOKE intent (exact target_state_id) is S1A.2.
    RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'SUCCESSOR_LIFECYCLE_NOT_AVAILABLE';
  END IF;
  -- Exact organisation + policy + version + hash; a foreign tenant's version never resolves.
  SELECT v.version_number INTO v_version_number
  FROM gov_repo.l14_authority_policy_versions AS v
  WHERE v.organisation_id = v_org AND v.authority_policy_id = p_authority_policy_id
    AND v.version_id = p_version_id AND v.content_hash = p_content_hash;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'PINNED_VERSION_UNRESOLVED';
  END IF;
  -- The first version can only ever be validated by the bootstrap, which is immediate only (U7).
  IF v_version_number = 1 AND p_requested_effective_from IS NOT NULL THEN
    RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'BOOTSTRAP_EFFECTIVE_FROM_NOT_PERMITTED';
  END IF;
  IF p_prior_proposal_id IS NOT NULL THEN
    PERFORM 1 FROM gov_repo.l14_proposals AS p
    WHERE p.organisation_id = v_org AND p.proposal_id = p_prior_proposal_id AND p.subject_kind = p_subject_kind;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'PRIOR_PROPOSAL_UNRESOLVED';
    END IF;
  END IF;
  v_support := gov_repo.l14_support_parts_v1(v_org, p_support_status, p_support_evidence_ids);

  v_fingerprint := gov_repo.l14_sha256_frame_v1(
    ARRAY['L14_COMMAND_FINGERPRINT_V1', 'SUBMIT_PROPOSAL', v_org::text, v_actor::text, p_subject_kind, p_intent,
          p_source_class, p_authority_policy_id::text, p_version_id::text, p_content_hash]
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

  PERFORM gov_repo.l14_lock_authority_policy_guard_v1(v_org);
  IF gov_repo.l14_replay_arbitrate_v1(v_org, p_command_id, v_fingerprint) THEN
    PERFORM 1 FROM gov_repo.l14_session_basis_v1(v_org, v_actor, p_verified_session_iat,
      p_verified_session_exp, p_verified_credential_epoch);
    RETURN QUERY SELECT * FROM gov_repo.l14_command_result_v1(v_org, p_command_id, true);
    RETURN;
  END IF;

  v_now := pg_catalog.clock_timestamp();
  INSERT INTO gov_repo.l14_proposals (organisation_id, proposal_id, subject_kind, intent, source_class,
    submitted_by_actor_user_id, prior_proposal_id, support_status, submitted_at)
  VALUES (v_org, v_proposal, p_subject_kind, p_intent, p_source_class, v_actor, p_prior_proposal_id,
    p_support_status, v_now);
  INSERT INTO gov_repo.l14_authority_policy_version_proposals (organisation_id, proposal_id, subject_kind, intent,
    authority_policy_id, version_id, content_hash, requested_effective_from, target_state_id)
  VALUES (v_org, v_proposal, p_subject_kind, p_intent, p_authority_policy_id, p_version_id, p_content_hash,
    p_requested_effective_from, p_target_state_id);
  INSERT INTO gov_repo.l14_support_links (organisation_id, support_link_id, owner_kind, proposal_id, evidence_id)
  SELECT v_org, pg_catalog.gen_random_uuid(), 'PROPOSAL', v_proposal, i.id
  FROM pg_catalog.unnest(p_support_evidence_ids) AS i(id);
  INSERT INTO gov_repo.l14_command_results (organisation_id, command_id, command_kind, command_fingerprint,
    actor_user_id, outcome, proposal_id, authority_policy_id, version_id, recorded_at)
  VALUES (v_org, p_command_id, 'SUBMIT_PROPOSAL', v_fingerprint, v_actor, 'SUBMITTED', v_proposal,
    p_authority_policy_id, p_version_id, v_now);

  PERFORM 1 FROM gov_repo.l14_session_basis_v1(v_org, v_actor, p_verified_session_iat,
    p_verified_session_exp, p_verified_credential_epoch);
  RETURN QUERY SELECT * FROM gov_repo.l14_command_result_v1(v_org, p_command_id, false);
END;
$submit$;

-- ---------------------------------------------------------------------------------------
-- G. RPC 3 — governance decision on an Authority Policy proposal. S1A.1 executes ONLY the
--    first-policy VALIDATE under the bootstrap; everything else is a bounded DENY or GV010.
-- ---------------------------------------------------------------------------------------
CREATE FUNCTION gov_repo.l14_decide_authority_policy_proposal_v1(
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
  p_caller_fingerprint text
)
RETURNS TABLE (
  replay boolean, command_id text, command_kind text, outcome text, command_fingerprint text,
  authorization_decision_id uuid, authorization_result text, deny_reason text, proposal_id uuid,
  governance_decision_id uuid, authority_policy_id uuid, version_id uuid, content_hash text,
  state_id uuid, effective_from timestamptz, recorded_at timestamptz
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
SET lock_timeout = '5s'
AS $decide$
#variable_conflict use_column
DECLARE
  v_org uuid := p_verified_organisation_id;
  v_actor uuid := p_verified_actor_user_id;
  v_role_ids uuid[];
  v_bootstrap_role boolean;
  v_support text[];
  v_fingerprint text;
  v_proposal record;
  v_version_number integer;
  v_version_hash text;
  v_head record;
  v_deny text;
  v_now timestamptz;
  v_authz uuid := pg_catalog.gen_random_uuid();
  v_decision uuid := pg_catalog.gen_random_uuid();
  v_state uuid := pg_catalog.gen_random_uuid();
BEGIN
  -- A. Base session eligibility.
  SELECT b.role_ids, b.has_bootstrap_role INTO v_role_ids, v_bootstrap_role
  FROM gov_repo.l14_session_basis_v1(v_org, v_actor, p_verified_session_iat, p_verified_session_exp,
    p_verified_credential_epoch) AS b;

  PERFORM gov_repo.l14_validate_command_id_v1(p_command_id, p_caller_fingerprint);
  IF p_outcome IS NULL OR p_outcome NOT IN ('VALIDATE','REJECT','DEFER','REVOKE')
     OR p_reason_code IS NULL OR p_reason_code NOT IN (
       'AUTHORITY_POLICY_VALIDATED','AUTHORITY_POLICY_REJECTED','AUTHORITY_POLICY_DEFERRED','AUTHORITY_POLICY_REVOKED')
     OR NOT ((p_outcome = 'VALIDATE' AND p_reason_code = 'AUTHORITY_POLICY_VALIDATED')
          OR (p_outcome = 'REJECT' AND p_reason_code = 'AUTHORITY_POLICY_REJECTED')
          OR (p_outcome = 'DEFER' AND p_reason_code = 'AUTHORITY_POLICY_DEFERRED')
          OR (p_outcome = 'REVOKE' AND p_reason_code = 'AUTHORITY_POLICY_REVOKED')) THEN
    RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'DECISION_VOCABULARY_INVALID';
  END IF;

  -- E (resolution, immutable rows). Exact proposal in THIS tenant, its typed pin, the version.
  SELECT p.proposal_id, p.subject_kind, p.intent, p.source_class, p.submitted_by_actor_user_id,
         t.authority_policy_id, t.version_id, t.content_hash, t.requested_effective_from, t.target_state_id
  INTO v_proposal
  FROM gov_repo.l14_proposals AS p
  JOIN gov_repo.l14_authority_policy_version_proposals AS t
    ON t.organisation_id = p.organisation_id AND t.proposal_id = p.proposal_id
  WHERE p.organisation_id = v_org AND p.proposal_id = p_proposal_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'PROPOSAL_UNRESOLVED';
  END IF;
  IF (p_outcome = 'VALIDATE' AND v_proposal.intent <> 'VALIDATE')
     OR (p_outcome = 'REVOKE' AND v_proposal.intent <> 'REVOKE') THEN
    RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'OUTCOME_INTENT_INCOMPATIBLE';
  END IF;
  SELECT v.version_number, v.content_hash INTO v_version_number, v_version_hash
  FROM gov_repo.l14_authority_policy_versions AS v
  WHERE v.organisation_id = v_org AND v.authority_policy_id = v_proposal.authority_policy_id
    AND v.version_id = v_proposal.version_id;
  IF NOT FOUND OR v_version_hash IS DISTINCT FROM v_proposal.content_hash
     OR gov_repo.l14_stored_authority_policy_content_hash_v1(v_org, v_proposal.authority_policy_id,
          v_proposal.version_id) IS DISTINCT FROM v_proposal.content_hash THEN
    RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'PINNED_CONTENT_HASH_MISMATCH';
  END IF;
  v_support := gov_repo.l14_support_parts_v1(v_org, p_support_status, p_support_evidence_ids);

  -- B. PostgreSQL-authoritative fingerprint (proposal semantics read from immutable rows).
  v_fingerprint := gov_repo.l14_sha256_frame_v1(
    ARRAY['L14_COMMAND_FINGERPRINT_V1', 'DECIDE_PROPOSAL', v_org::text, v_actor::text, p_outcome, p_reason_code,
          v_proposal.proposal_id::text, v_proposal.subject_kind, v_proposal.intent, v_proposal.source_class,
          v_proposal.authority_policy_id::text, v_proposal.version_id::text, v_proposal.content_hash]
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

  -- C/D. Same organisation guard, then replay arbitration.
  PERFORM gov_repo.l14_lock_authority_policy_guard_v1(v_org);
  IF gov_repo.l14_replay_arbitrate_v1(v_org, p_command_id, v_fingerprint) THEN
    PERFORM 1 FROM gov_repo.l14_session_basis_v1(v_org, v_actor, p_verified_session_iat,
      p_verified_session_exp, p_verified_credential_epoch);
    RETURN QUERY SELECT * FROM gov_repo.l14_command_result_v1(v_org, p_command_id, true);
    RETURN;
  END IF;

  -- F. Proposal terminality (VALIDATE/REJECT/REVOKE are terminal).
  PERFORM 1 FROM gov_repo.l14_governance_decisions AS d
  WHERE d.organisation_id = v_org AND d.proposal_id = p_proposal_id AND d.outcome IN ('VALIDATE','REJECT','REVOKE');
  IF FOUND THEN
    RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'PROPOSAL_TERMINAL';
  END IF;

  -- G/H. Expected-none against the technical head; only the admitted FIRST version qualifies.
  SELECT h.authority_policy_id, h.latest_state_id INTO v_head
  FROM gov_repo.l14_authority_policy_heads AS h WHERE h.organisation_id = v_org;
  IF NOT FOUND OR v_head.authority_policy_id IS DISTINCT FROM v_proposal.authority_policy_id THEN
    RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'AUTHORITY_POLICY_UNRESOLVED';
  END IF;
  IF p_expected_current_state_id IS NOT NULL THEN
    -- Any decision against an existing governed state is the successor lifecycle (S1A.2).
    RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'SUCCESSOR_LIFECYCLE_NOT_AVAILABLE';
  END IF;
  IF v_head.latest_state_id IS NOT NULL THEN
    RAISE EXCEPTION 'L14_STALE_EXPECTATION' USING ERRCODE = 'GV009', DETAIL = 'AUTHORITY_POLICY_STATE_EXISTS';
  END IF;
  IF v_version_number <> 1 THEN
    RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'SUCCESSOR_LIFECYCLE_NOT_AVAILABLE';
  END IF;

  -- I/J. Bounded bootstrap: ONLY VALIDATE of the exact first version, immediate only, by a
  -- locked system GOVERNANCE_ADMIN. Self-validation is permitted here and nowhere else.
  IF NOT v_bootstrap_role THEN
    v_deny := 'BOOTSTRAP_ROLE_REQUIRED';
  ELSIF p_outcome <> 'VALIDATE' THEN
    v_deny := 'BOOTSTRAP_ACTION_NOT_PERMITTED';
  ELSIF v_proposal.requested_effective_from IS NOT NULL THEN
    v_deny := 'TEMPORAL_ACTION_NOT_AUTHORIZED';
  END IF;
  v_now := pg_catalog.clock_timestamp();

  -- K. Durable authorization decision.
  INSERT INTO gov_repo.l14_authorization_decisions (
    organisation_id, authorization_decision_id, command_id, command_fingerprint, actor_user_id,
    requested_action, subject_kind, scope_tag, source_class, proposal_id, is_self_validation,
    subject_authority_policy_id, subject_version_id, authority_basis, result, deny_reason, evaluated_at)
  VALUES (
    v_org, v_authz, p_command_id, v_fingerprint, v_actor,
    p_outcome, 'AUTHORITY_POLICY_VERSION', 'ALL_ALLOWED_TARGETS', v_proposal.source_class, p_proposal_id,
    v_proposal.submitted_by_actor_user_id = v_actor,
    v_proposal.authority_policy_id, v_proposal.version_id, 'SYSTEM_BOOTSTRAP_L14_AUTHORITY_V1',
    CASE WHEN v_deny IS NULL THEN 'ALLOW' ELSE 'DENY' END, v_deny, v_now);
  PERFORM gov_repo.l14_snapshot_roles_v1(v_org, v_authz, v_role_ids);
  IF v_bootstrap_role THEN
    -- The bounded bootstrap grant the actor actually holds (VALIDATE of the first version).
    INSERT INTO gov_repo.l14_authorization_decision_rules (organisation_id, authorization_decision_id,
      snapshot_ordinal, permission_origin, permission, requested_action, source_class, source_disposition,
      scope_tag, allow_self_validation, allow_future_dating, allow_backdating)
    VALUES (v_org, v_authz, 1, 'SYSTEM_BOOTSTRAP', 'L14_AUTHORITY_POLICY_ADMIN', 'VALIDATE', 'LOCAL_HUMAN',
      'AUTHORITATIVE', 'ALL_ALLOWED_TARGETS', true, false, false);
  END IF;

  IF v_deny IS NOT NULL THEN
    INSERT INTO gov_repo.l14_command_results (organisation_id, command_id, command_kind, command_fingerprint,
      actor_user_id, outcome, authorization_decision_id, proposal_id, authority_policy_id, version_id, recorded_at)
    VALUES (v_org, p_command_id, 'DECIDE_PROPOSAL', v_fingerprint, v_actor, 'DENIED', v_authz, p_proposal_id,
      v_proposal.authority_policy_id, v_proposal.version_id, v_now);
  ELSE
    -- L. Governance decision. M/N. First VALIDATED state, DB-authored immediate instant.
    INSERT INTO gov_repo.l14_governance_decisions (organisation_id, governance_decision_id, proposal_id,
      subject_kind, outcome, reason_code, authorization_decision_id, actor_user_id, target_authority_policy_id,
      target_version_id, target_content_hash, support_status, decided_at)
    VALUES (v_org, v_decision, p_proposal_id, 'AUTHORITY_POLICY_VERSION', 'VALIDATE', 'AUTHORITY_POLICY_VALIDATED',
      v_authz, v_actor, v_proposal.authority_policy_id, v_proposal.version_id, v_proposal.content_hash,
      p_support_status, v_now);
    INSERT INTO gov_repo.l14_authority_policy_states (organisation_id, state_id, authority_policy_id, version_id,
      content_hash, state_kind, predecessor_state_id, revokes_state_id, effective_from, recorded_at,
      governance_decision_id, authority_basis, trust_state)
    VALUES (v_org, v_state, v_proposal.authority_policy_id, v_proposal.version_id, v_proposal.content_hash,
      'VALIDATED', NULL, NULL, v_now, v_now, v_decision, 'SYSTEM_BOOTSTRAP_L14_AUTHORITY_V1', 'VALIDATED');
    -- O. Technical head (compare-and-set on expected-none).
    UPDATE gov_repo.l14_authority_policy_heads AS h SET latest_state_id = v_state
    WHERE h.organisation_id = v_org AND h.latest_state_id IS NULL;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'L14_STALE_EXPECTATION' USING ERRCODE = 'GV009', DETAIL = 'AUTHORITY_POLICY_STATE_EXISTS';
    END IF;
    -- P. Support links on the decision and the resulting state.
    INSERT INTO gov_repo.l14_support_links (organisation_id, support_link_id, owner_kind, governance_decision_id, evidence_id)
    SELECT v_org, pg_catalog.gen_random_uuid(), 'GOVERNANCE_DECISION', v_decision, i.id
    FROM pg_catalog.unnest(p_support_evidence_ids) AS i(id);
    INSERT INTO gov_repo.l14_support_links (organisation_id, support_link_id, owner_kind, state_id, evidence_id)
    SELECT v_org, pg_catalog.gen_random_uuid(), 'AUTHORITY_POLICY_STATE', v_state, i.id
    FROM pg_catalog.unnest(p_support_evidence_ids) AS i(id);
    -- Q. ORIGINAL durable result.
    INSERT INTO gov_repo.l14_command_results (organisation_id, command_id, command_kind, command_fingerprint,
      actor_user_id, outcome, authorization_decision_id, proposal_id, governance_decision_id, authority_policy_id,
      version_id, state_id, recorded_at)
    VALUES (v_org, p_command_id, 'DECIDE_PROPOSAL', v_fingerprint, v_actor, 'VALIDATED', v_authz, p_proposal_id,
      v_decision, v_proposal.authority_policy_id, v_proposal.version_id, v_state, v_now);
  END IF;

  -- R. Base session eligibility at commitment.
  PERFORM 1 FROM gov_repo.l14_session_basis_v1(v_org, v_actor, p_verified_session_iat,
    p_verified_session_exp, p_verified_credential_epoch);
  RETURN QUERY SELECT * FROM gov_repo.l14_command_result_v1(v_org, p_command_id, false);
END;
$decide$;

-- ---------------------------------------------------------------------------------------
-- H. Privileges. Legacy default privileges (20260818013113) hand every new gov_repo table,
--    sequence and routine to service_role, and PostgreSQL grants PUBLIC EXECUTE on new
--    functions: both are removed explicitly. No application role gets any table privilege
--    (no direct read, no DML, no TRUNCATE/REFERENCES/TRIGGER/MAINTAIN). Only the three
--    public RPCs are executable, by service_role only.
-- ---------------------------------------------------------------------------------------
ALTER TABLE gov_repo.l14_authority_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE gov_repo.l14_authority_policy_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE gov_repo.l14_authority_policy_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE gov_repo.l14_proposals ENABLE ROW LEVEL SECURITY;
ALTER TABLE gov_repo.l14_authority_policy_version_proposals ENABLE ROW LEVEL SECURITY;
ALTER TABLE gov_repo.l14_authorization_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE gov_repo.l14_authorization_decision_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE gov_repo.l14_authorization_decision_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE gov_repo.l14_governance_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE gov_repo.l14_authority_policy_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE gov_repo.l14_authority_policy_heads ENABLE ROW LEVEL SECURITY;
ALTER TABLE gov_repo.l14_command_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE gov_repo.l14_support_links ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE
  gov_repo.l14_authority_policies, gov_repo.l14_authority_policy_versions, gov_repo.l14_authority_policy_rules,
  gov_repo.l14_proposals, gov_repo.l14_authority_policy_version_proposals, gov_repo.l14_authorization_decisions,
  gov_repo.l14_authorization_decision_roles, gov_repo.l14_authorization_decision_rules,
  gov_repo.l14_governance_decisions, gov_repo.l14_authority_policy_states, gov_repo.l14_authority_policy_heads,
  gov_repo.l14_command_results, gov_repo.l14_support_links
FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION
  gov_repo.l14_history_immutable_v1(),
  gov_repo.l14_authority_policy_head_guard_v1(),
  gov_repo.l14_frame_optional_v1(text),
  gov_repo.l14_canonical_instant_v1(timestamptz),
  gov_repo.l14_sha256_frame_v1(text[]),
  gov_repo.l14_authority_policy_rule_frame_v1(uuid, text, text, text, text, text, text, text, text, text, text, boolean, boolean, boolean),
  gov_repo.l14_authority_policy_content_hash_v1(text[]),
  gov_repo.l14_stored_authority_policy_content_hash_v1(uuid, uuid, uuid),
  gov_repo.l14_parse_authority_policy_rules_v1(uuid, jsonb),
  gov_repo.l14_support_parts_v1(uuid, text, text[]),
  gov_repo.l14_validate_command_id_v1(text, text),
  gov_repo.l14_session_basis_v1(uuid, uuid, bigint, bigint, timestamptz),
  gov_repo.l14_lock_authority_policy_guard_v1(uuid),
  gov_repo.l14_snapshot_roles_v1(uuid, uuid, uuid[]),
  gov_repo.l14_command_result_v1(uuid, text, boolean),
  gov_repo.l14_replay_arbitrate_v1(uuid, text, text),
  gov_repo.l14_effective_authority_policy_version_v1(uuid, timestamptz, timestamptz),
  gov_repo.l14_admit_authority_policy_version_v1(uuid, uuid, bigint, bigint, timestamptz, text, uuid, uuid, text, jsonb, text, text[], text),
  gov_repo.l14_submit_proposal_v1(uuid, uuid, bigint, bigint, timestamptz, text, text, text, text, uuid, uuid, text, timestamptz, uuid, uuid, text, text[], text),
  gov_repo.l14_decide_authority_policy_proposal_v1(uuid, uuid, bigint, bigint, timestamptz, text, uuid, text, text, uuid, text, text[], text)
FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION
  gov_repo.l14_admit_authority_policy_version_v1(uuid, uuid, bigint, bigint, timestamptz, text, uuid, uuid, text, jsonb, text, text[], text),
  gov_repo.l14_submit_proposal_v1(uuid, uuid, bigint, bigint, timestamptz, text, text, text, text, uuid, uuid, text, timestamptz, uuid, uuid, text, text[], text),
  gov_repo.l14_decide_authority_policy_proposal_v1(uuid, uuid, bigint, bigint, timestamptz, text, uuid, text, text, uuid, text, text[], text)
TO service_role;

COMMENT ON TABLE gov_repo.l14_authority_policies IS 'M16-S1A L14AuthorityPolicy stable identity: exactly one per organisation (UNIQUE organisation_id). Established only by the first successful bootstrap ADMIT. Immutable.';
COMMENT ON TABLE gov_repo.l14_authority_policy_versions IS 'M16-S1A immutable Authority Policy versions; content_hash is computed by PostgreSQL from the complete typed rule set. Linear admission chain (unique predecessor).';
COMMENT ON TABLE gov_repo.l14_authority_policy_rules IS 'M16-S1A typed Authority Policy rules (closed permission/action/source/disposition/scope vocabularies). Never JSON/EAV; never expanded from governance_roles.permissions.';
COMMENT ON TABLE gov_repo.l14_proposals IS 'M16-S1A immutable L14Proposal envelope (closed 11 subject kinds, VALIDATE/REVOKE intent). Submission grants no authority.';
COMMENT ON TABLE gov_repo.l14_authority_policy_version_proposals IS 'M16-S1A typed AUTHORITY_POLICY_VERSION proposal pinned to organisation + policy + version + content_hash; NULL requested_effective_from = IMMEDIATE.';
COMMENT ON TABLE gov_repo.l14_authorization_decisions IS 'M16-S1A immutable L14AuthorizationDecision (ALLOW and durable DENY), bound to its command and DB fingerprint. Never gov_repo.authorization_decisions.';
COMMENT ON TABLE gov_repo.l14_authorization_decision_roles IS 'M16-S1A snapshot of the locked persisted role basis used by an authorization decision.';
COMMENT ON TABLE gov_repo.l14_authorization_decision_rules IS 'M16-S1A effective permission snapshot: bounded SYSTEM_BOOTSTRAP grant or matched Authority Policy rules.';
COMMENT ON TABLE gov_repo.l14_governance_decisions IS 'M16-S1A immutable L14GovernanceDecision (closed outcome + closed reason_code, no free text); backed only by an ALLOW authorization.';
COMMENT ON TABLE gov_repo.l14_authority_policy_states IS 'M16-S1A append-only Authority Policy governed states. predecessor_state_id = lineage predecessor; revokes_state_id = exact REVOKE target. Effective closure is derived, never stored.';
COMMENT ON TABLE gov_repo.l14_authority_policy_heads IS 'M16-S1A technical pointer only (latest admitted version / latest state); RPC-maintained, reconstructible from history.';
COMMENT ON TABLE gov_repo.l14_command_results IS 'M16-S1A durable (organisation_id, command_id) identity with its DB fingerprint and ORIGINAL result; DENY consumes the command.';
COMMENT ON TABLE gov_repo.l14_support_links IS 'M16-S1A normalized support links; the only admissible target is gov_repo.discovery_evidence(organisation_id, evidence_id).';
COMMENT ON FUNCTION gov_repo.l14_effective_authority_policy_version_v1(uuid, timestamptz, timestamptz) IS 'M16-S1A owner-only bitemporal resolver: version effective at a business instant as known at a recorded cutoff; ties fail closed.';

-- ---------------------------------------------------------------------------------------
-- I. ACL / structure postflight (after ALL grants, including the broad legacy defaults).
-- ---------------------------------------------------------------------------------------
DO $postflight$
DECLARE
  v_expected_tables CONSTANT text[] := ARRAY[
    'l14_authority_policies','l14_authority_policy_heads','l14_authority_policy_rules',
    'l14_authority_policy_states','l14_authority_policy_version_proposals','l14_authority_policy_versions',
    'l14_authorization_decision_roles','l14_authorization_decision_rules','l14_authorization_decisions',
    'l14_command_results','l14_governance_decisions','l14_proposals','l14_support_links'];
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
    RAISE EXCEPTION 'M16_S1A_POSTFLIGHT: unexpected l14 relation set (tables only; no views/sequences)';
  END IF;
  -- No view/materialized view anywhere may expose an L14 table (writable-view bypass class).
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_rewrite AS w
             JOIN pg_catalog.pg_depend AS d ON d.classid = 'pg_catalog.pg_rewrite'::regclass AND d.objid = w.oid
             JOIN pg_catalog.pg_class AS t ON t.oid = d.refobjid
             WHERE t.relnamespace = 'gov_repo'::regnamespace AND t.relname LIKE 'l14\_%' ESCAPE '\'
               AND w.ev_class <> t.oid) THEN
    RAISE EXCEPTION 'M16_S1A_POSTFLIGHT: a view exposes an l14 table';
  END IF;
  FOR v_rel IN
    SELECT c.oid, c.relname, c.relkind, c.relowner, c.relacl, c.relrowsecurity
    FROM pg_catalog.pg_class AS c
    WHERE c.relnamespace = 'gov_repo'::regnamespace AND c.relname::text = ANY (v_expected_tables)
  LOOP
    IF v_rel.relkind <> 'r' OR NOT v_rel.relrowsecurity THEN
      RAISE EXCEPTION 'M16_S1A_POSTFLIGHT: % must be an RLS-enabled ordinary table', v_rel.relname;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_catalog.aclexplode(COALESCE(v_rel.relacl, pg_catalog.acldefault('r', v_rel.relowner))) AS a
               WHERE a.grantee <> v_rel.relowner) THEN
      RAISE EXCEPTION 'M16_S1A_POSTFLIGHT: % has a non-owner table grant', v_rel.relname;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_attribute AS att WHERE att.attrelid = v_rel.oid AND att.attacl IS NOT NULL) THEN
      RAISE EXCEPTION 'M16_S1A_POSTFLIGHT: % has column-level grants', v_rel.relname;
    END IF;
    FOREACH v_role IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
      FOREACH v_privilege IN ARRAY v_privileges LOOP
        IF pg_catalog.has_table_privilege(v_role, v_rel.oid, v_privilege) THEN
          RAISE EXCEPTION 'M16_S1A_POSTFLIGHT: % holds % on %', v_role, v_privilege, v_rel.relname;
        END IF;
      END LOOP;
      IF pg_catalog.has_any_column_privilege(v_role, v_rel.oid, 'SELECT, INSERT, UPDATE, REFERENCES') THEN
        RAISE EXCEPTION 'M16_S1A_POSTFLIGHT: % holds a column privilege on %', v_role, v_rel.relname;
      END IF;
    END LOOP;
    -- tgtype bits: ROW=1, BEFORE=2, DELETE=8, UPDATE=16, TRUNCATE=32.
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger AS t
                   WHERE t.tgrelid = v_rel.oid AND NOT t.tgisinternal AND t.tgenabled = 'A'
                     AND (t.tgtype & 1) <> 0 AND (t.tgtype & 2) <> 0 AND (t.tgtype & 8) <> 0 AND (t.tgtype & 16) <> 0)
       OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger AS t
                   WHERE t.tgrelid = v_rel.oid AND NOT t.tgisinternal AND t.tgenabled = 'A'
                     AND (t.tgtype & 2) <> 0 AND (t.tgtype & 32) <> 0) THEN
      RAISE EXCEPTION 'M16_S1A_POSTFLIGHT: % lacks ALWAYS raising BEFORE UPDATE/DELETE and TRUNCATE triggers', v_rel.relname;
    END IF;
  END LOOP;
  FOR v_fn IN
    SELECT p.oid, p.proname, p.proowner, p.proacl, p.prosecdef, p.proconfig
    FROM pg_catalog.pg_proc AS p
    WHERE p.pronamespace = 'gov_repo'::regnamespace AND p.proname LIKE 'l14\_%' ESCAPE '\'
  LOOP
    IF EXISTS (SELECT 1 FROM pg_catalog.aclexplode(COALESCE(v_fn.proacl, pg_catalog.acldefault('f', v_fn.proowner))) AS a
               WHERE a.privilege_type = 'EXECUTE' AND a.grantee = 0) THEN
      RAISE EXCEPTION 'M16_S1A_POSTFLIGHT: % has PUBLIC EXECUTE', v_fn.proname;
    END IF;
    FOREACH v_role IN ARRAY ARRAY['anon','authenticated'] LOOP
      IF pg_catalog.has_function_privilege(v_role, v_fn.oid, 'EXECUTE') THEN
        RAISE EXCEPTION 'M16_S1A_POSTFLIGHT: % executable by %', v_fn.proname, v_role;
      END IF;
    END LOOP;
    IF NOT (v_fn.proconfig @> ARRAY['search_path=pg_catalog, pg_temp']) THEN
      RAISE EXCEPTION 'M16_S1A_POSTFLIGHT: % search_path not pinned', v_fn.proname;
    END IF;
    IF v_fn.proname::text = ANY (v_public_rpcs) THEN
      IF NOT v_fn.prosecdef OR NOT pg_catalog.has_function_privilege('service_role', v_fn.oid, 'EXECUTE')
         OR EXISTS (SELECT 1 FROM pg_catalog.aclexplode(v_fn.proacl) AS a
                    WHERE a.grantee NOT IN (v_fn.proowner, 'service_role'::regrole::oid)) THEN
        RAISE EXCEPTION 'M16_S1A_POSTFLIGHT: public RPC % ACL/definer shape wrong', v_fn.proname;
      END IF;
    ELSE
      IF v_fn.prosecdef OR EXISTS (SELECT 1 FROM pg_catalog.aclexplode(COALESCE(v_fn.proacl,
             pg_catalog.acldefault('f', v_fn.proowner))) AS a WHERE a.grantee <> v_fn.proowner) THEN
        RAISE EXCEPTION 'M16_S1A_POSTFLIGHT: internal helper % must be owner-only SECURITY INVOKER', v_fn.proname;
      END IF;
    END IF;
  END LOOP;
  IF (SELECT pg_catalog.count(*) FROM pg_catalog.pg_proc AS p
      WHERE p.pronamespace = 'gov_repo'::regnamespace AND p.proname::text = ANY (v_public_rpcs)) <> 3 THEN
    RAISE EXCEPTION 'M16_S1A_POSTFLIGHT: expected exactly three public L14 RPCs';
  END IF;
  -- S0 wrapper/eligibility naming contracts stay intact.
  IF (SELECT pg_catalog.count(*) FROM pg_catalog.pg_proc AS p WHERE p.pronamespace = 'gov_repo'::regnamespace
        AND p.proname LIKE '%\_governed\_v1' ESCAPE '\') <> 6
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_proc AS p WHERE p.pronamespace = 'gov_repo'::regnamespace
        AND p.proname LIKE 'l14\_%' ESCAPE '\' AND (p.proname LIKE '%eligibility%' OR p.proname LIKE '%governed%')) THEN
    RAISE EXCEPTION 'M16_S1A_POSTFLIGHT: S0 naming contract disturbed';
  END IF;
END;
$postflight$;

COMMIT;
