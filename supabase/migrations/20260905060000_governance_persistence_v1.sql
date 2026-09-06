-- =============================================================================
-- CODEGUARD AI GOVERNANCE OS
-- Migration: 20260905060000_governance_persistence_v1
-- Domain:    Governance Repository — HITL Review / Authorization /
--            Reconciliation Persistence (Governance Persistence V1)
--
-- Persists, durably and tenant-isolated, the CURRENT canonical flow:
--   DISCOVERY -> REVIEW SUBJECT -> REVIEW AUDIT EVENTS -> CERTIFIED
--   -> AUTHORIZATION DECISION -> RECONCILIATION INVOCATION
--   -> CANONICAL RECONCILIATION DECISION
--
-- This migration does NOT redesign packages/governance-review or
-- packages/canonical-contracts. It persists their existing domain shapes
-- exactly. Persistence of a canonical reconciliation decision is NOT the same
-- as materialization of a governed canonical object: this migration never
-- creates a governed object as a side effect of storing a decision.
--
-- No production deployment is authorized by this migration. Controlled
-- runtime validation is performed only against the disposable project
-- zkqfvqwqdypgpzauzinw ("ov-ia-g2-test"); gov-ia-dev (bbisimozudihadfozyfz)
-- is never touched.
-- =============================================================================

begin;

do $preflight$
begin
  if to_regnamespace('gov_repo') is null then
    raise exception using
      errcode = '3F000',
      message = 'Cannot apply governance persistence migration.',
      hint = 'Schema gov_repo does not exist; foundation migrations must run first.';
  end if;

  if to_regclass('gov_repo.review_subjects') is not null
     or to_regclass('gov_repo.review_audit_events') is not null
     or to_regclass('gov_repo.authorization_decisions') is not null
     or to_regclass('gov_repo.reconciliation_decisions') is not null
     or to_regclass('gov_repo.reconciliation_invocations') is not null
     or to_regclass('gov_repo.outbox_events') is not null
  then
    raise exception using
      errcode = '42P07',
      message = 'Cannot apply governance persistence migration.',
      hint = 'One or more target tables already exist; resolve the naming collision before retrying.';
  end if;
end;
$preflight$;

-- -----------------------------------------------------------------------------
-- A. REVIEW SUBJECT (current projection) + normalized evidence/assertion
--    membership. Mirrors packages/governance-review/src/review-subject.ts
--    exactly; ReviewState values mirror review-state.ts.
-- -----------------------------------------------------------------------------

create table gov_repo.review_subjects (
  review_subject_id    text        primary key,
  organisation_id      uuid        not null references gov_repo.organisations (organisation_id),
  finding_id           text        not null,
  candidate_kind       text        not null,
  source_connection_id text        not null,
  source_external_type text        not null,
  source_external_id   text        not null,
  state                text        not null default 'DETECTED',
  detected_at          timestamptz not null,
  last_transition_id   text,
  revision             bigint      not null default 0,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint review_subjects_state_check
    check (state in ('DETECTED','PROPOSED','CONFIRMED','CERTIFIED','REJECTED')),
  constraint review_subjects_revision_nonnegative check (revision >= 0),
  constraint review_subjects_organisation_id_unique unique (organisation_id, review_subject_id)
);

comment on table gov_repo.review_subjects is
  'Current-state projection of one governance-review ReviewSubject (packages/governance-review/src/review-subject.ts). Mutable only through gov_repo.create_review_subject / gov_repo.apply_review_transition. Full lifecycle history lives in gov_repo.review_audit_events; this table never invents state the domain package did not compute.';
comment on column gov_repo.review_subjects.source_connection_id is
  'SourceObjectIdentity.connectionId — kept relational, never buried in JSON, per the identity/query surface required for this table.';
comment on column gov_repo.review_subjects.revision is
  'Technical optimistic-concurrency counter, incremented on every applied transition. The domain package itself guards staleness via (expectedState, lastTransition.commandId); this column is a DB-level belt-and-suspenders guard, not an independent business version.';
comment on column gov_repo.review_subjects.last_transition_id is
  'FK added below once gov_repo.review_audit_events exists (the two tables reference each other).';

create index idx_review_subjects_org on gov_repo.review_subjects (organisation_id);
create index idx_review_subjects_finding on gov_repo.review_subjects (organisation_id, finding_id);
create index idx_review_subjects_state on gov_repo.review_subjects (organisation_id, state);

create trigger trg_review_subjects_updated_at
  before update on gov_repo.review_subjects
  for each row execute function gov_repo.set_updated_at();

create table gov_repo.review_subject_assertions (
  review_subject_id text        not null,
  organisation_id   uuid        not null,
  assertion_id      text        not null,
  created_at        timestamptz not null default now(),
  constraint review_subject_assertions_pkey primary key (review_subject_id, assertion_id),
  constraint review_subject_assertions_subject_fkey
    foreign key (organisation_id, review_subject_id)
    references gov_repo.review_subjects (organisation_id, review_subject_id)
    on delete cascade
);
comment on table gov_repo.review_subject_assertions is
  'Normalized SourceAssertionId membership for one ReviewSubject (never an unvalidated JSON/CSV list).';
create index idx_review_subject_assertions_org on gov_repo.review_subject_assertions (organisation_id);

create table gov_repo.review_subject_evidence (
  review_subject_id text        not null,
  organisation_id   uuid        not null,
  evidence_id       text        not null,
  created_at        timestamptz not null default now(),
  constraint review_subject_evidence_pkey primary key (review_subject_id, evidence_id),
  constraint review_subject_evidence_subject_fkey
    foreign key (organisation_id, review_subject_id)
    references gov_repo.review_subjects (organisation_id, review_subject_id)
    on delete cascade
);
comment on table gov_repo.review_subject_evidence is
  'Normalized EvidenceId membership for one ReviewSubject (never an unvalidated JSON/CSV list).';
create index idx_review_subject_evidence_org on gov_repo.review_subject_evidence (organisation_id);

-- -----------------------------------------------------------------------------
-- B. REVIEW AUDIT EVENTS — append-only immutable history. Mirrors
--    ReviewAuditEvent (review-subject.ts) exactly.
-- -----------------------------------------------------------------------------

create table gov_repo.review_audit_events (
  event_id            text        primary key,
  review_subject_id   text        not null,
  organisation_id     uuid        not null,
  finding_id          text        not null,
  previous_state      text        not null,
  new_state           text        not null,
  actor_kind          text        not null,
  actor_reference     text,
  actor_rule_code     text,
  actor_rule_version  text,
  occurred_at         timestamptz not null,
  reason_code         text,
  command_id          text        not null,
  recorded_at         timestamptz not null default now(),
  constraint review_audit_events_previous_state_check
    check (previous_state in ('DETECTED','PROPOSED','CONFIRMED','CERTIFIED','REJECTED')),
  constraint review_audit_events_new_state_check
    check (new_state in ('DETECTED','PROPOSED','CONFIRMED','CERTIFIED','REJECTED')),
  constraint review_audit_events_actor_check check (
    (actor_kind = 'HUMAN' and actor_reference is not null and actor_rule_code is null and actor_rule_version is null)
    or (actor_kind = 'DETERMINISTIC_RULE' and actor_rule_code is not null and actor_rule_version is not null and actor_reference is null)
  ),
  constraint review_audit_events_command_unique unique (review_subject_id, command_id),
  constraint review_audit_events_organisation_id_unique unique (organisation_id, event_id),
  constraint review_audit_events_subject_fkey
    foreign key (organisation_id, review_subject_id)
    references gov_repo.review_subjects (organisation_id, review_subject_id)
);

comment on table gov_repo.review_audit_events is
  'IMMUTABLE append-only history of ReviewSubject transitions (propose/confirm/certify/reject). Actor may be HUMAN or DETERMINISTIC_RULE because propose.ts permits machine-assisted proposals; confirm/certify/reject remain HUMAN-only at the domain layer (governance-review), enforced again nowhere here because this column intentionally mirrors the domain union rather than narrowing it.';
comment on constraint review_audit_events_command_unique on gov_repo.review_audit_events is
  'Idempotency: a transition command is uniquely identified per subject by commandId. gov_repo.apply_review_transition treats a matching (review_subject_id, commandId) as a replay, never a second transition.';

create index idx_review_audit_events_subject on gov_repo.review_audit_events (review_subject_id, recorded_at);
create index idx_review_audit_events_org on gov_repo.review_audit_events (organisation_id);

alter table gov_repo.review_subjects
  add constraint review_subjects_last_transition_fkey
  foreign key (organisation_id, last_transition_id)
  references gov_repo.review_audit_events (organisation_id, event_id);

create table gov_repo.review_audit_event_evidence (
  event_id        text not null,
  organisation_id uuid not null,
  evidence_id     text not null,
  constraint review_audit_event_evidence_pkey primary key (event_id, evidence_id),
  constraint review_audit_event_evidence_event_fkey
    foreign key (organisation_id, event_id)
    references gov_repo.review_audit_events (organisation_id, event_id)
);
comment on table gov_repo.review_audit_event_evidence is
  'Normalized evidenceIds cited on one immutable ReviewAuditEvent.';
create index idx_review_audit_event_evidence_org on gov_repo.review_audit_event_evidence (organisation_id);

-- -----------------------------------------------------------------------------
-- C. AUTHORIZATION DECISIONS — append-only immutable. Mirrors
--    ReconciliationAuthorizationResult (reconciliation-authorization.ts). A
--    DENY is still auditable data and is persisted the same as an ALLOW.
-- -----------------------------------------------------------------------------

create table gov_repo.authorization_decisions (
  authorization_decision_id  text        primary key,
  organisation_id            uuid        not null references gov_repo.organisations (organisation_id),
  review_subject_id          text,
  actor_reference            text        not null,
  subject_kind               text        not null,
  subject_candidate_id       text,
  subject_candidate_merge_id text,
  requested_action           text        not null,
  result                     text        not null,
  evaluated_at               timestamptz not null,
  policy_reference           text,
  recorded_at                timestamptz not null default now(),
  constraint authorization_decisions_result_check check (result in ('ALLOW','DENY')),
  constraint authorization_decisions_subject_kind_check check (subject_kind in ('CANDIDATE','CANDIDATE_MERGE')),
  constraint authorization_decisions_subject_exclusive_check check (
    (subject_kind = 'CANDIDATE' and subject_candidate_id is not null and subject_candidate_merge_id is null)
    or (subject_kind = 'CANDIDATE_MERGE' and subject_candidate_merge_id is not null and subject_candidate_id is null)
  ),
  constraint authorization_decisions_requested_action_check check (
    requested_action in ('CREATE_NEW','MATCH_EXISTING','MERGE_CANDIDATES','REJECT','DEFER')
  ),
  constraint authorization_decisions_organisation_id_unique unique (organisation_id, authorization_decision_id),
  constraint authorization_decisions_subject_fkey
    foreign key (organisation_id, review_subject_id)
    references gov_repo.review_subjects (organisation_id, review_subject_id)
);

comment on table gov_repo.authorization_decisions is
  'IMMUTABLE append-only record of every ReconciliationAuthorizationResult (ALLOW and DENY alike). review_subject_id is nullable and, when present, composite-FK-checked against review_subjects for the same organisation; a NULL leaves the composite FK unchecked (Postgres MATCH SIMPLE), never a cross-tenant bypass, since organisation_id itself is always NOT NULL and independently FK-checked against organisations.';

create index idx_authorization_decisions_org on gov_repo.authorization_decisions (organisation_id);
create index idx_authorization_decisions_subject on gov_repo.authorization_decisions (review_subject_id);

-- -----------------------------------------------------------------------------
-- D. RECONCILIATION COMMAND LOCKS — private technical concurrency primitive
--    (mirrors gov_repo.mandate_mapping_guards' role: no independent tenant
--    ownership or governance authority). Gates reconciliation idempotency
--    BEFORE the authoritative rows it will point to exist, so it cannot carry
--    FKs to them without an insert-ordering deadlock.
-- -----------------------------------------------------------------------------

create table gov_repo.reconciliation_command_locks (
  organisation_id     uuid        not null references gov_repo.organisations (organisation_id),
  command_id          text        not null,
  command_fingerprint text        not null,
  invocation_id       text        not null,
  created_at          timestamptz not null default now(),
  constraint reconciliation_command_locks_pkey primary key (organisation_id, command_id)
);
comment on table gov_repo.reconciliation_command_locks is
  'Private technical concurrency primitive only: atomically gates one (organisation_id, command_id) so concurrent gov_repo.record_authorized_reconciliation calls for the same command produce one logical result. Carries no independent tenant ownership or governance authority beyond that serialization; the authoritative audit trail is gov_repo.reconciliation_invocations.';

-- -----------------------------------------------------------------------------
-- E. CANONICAL RECONCILIATION DECISIONS — append-only immutable envelope for
--    all three current families (object / relationship / candidate merge).
--    Relational columns carry tenant/identity/lifecycle/authority/outcome;
--    JSONB carries only the versioned canonical envelope itself, per Phase 3.
-- -----------------------------------------------------------------------------

create table gov_repo.reconciliation_decisions (
  decision_id                text         primary key,
  organisation_id            uuid         not null references gov_repo.organisations (organisation_id),
  family                     text         not null,
  outcome                    text         not null,
  candidate_kind             text         not null,
  authority_kind             text         not null,
  authority_reference        text,
  authority_rule_code        text,
  authority_rule_version     text,
  reason_code                text         not null,
  decided_at                 timestamptz  not null,
  subject_candidate_id       text,
  subject_candidate_merge_id text,
  canonical_object_id        text,
  canonical_object_kind      text,
  relationship_candidate_id  text,
  relationship_type_code     text,
  candidate_merge_id         text,
  contract_version           text         not null,
  envelope                   jsonb        not null,
  envelope_hash              char(64)     not null,
  recorded_at                timestamptz  not null default now(),
  constraint reconciliation_decisions_family_check
    check (family in ('OBJECT','RELATIONSHIP','CANDIDATE_MERGE')),
  constraint reconciliation_decisions_outcome_check
    check (outcome in ('CREATE_NEW','MATCH_EXISTING','MERGE_CANDIDATES','REJECT','DEFER')),
  constraint reconciliation_decisions_family_outcome_check check (
    (family = 'CANDIDATE_MERGE' and outcome = 'MERGE_CANDIDATES')
    or (family in ('OBJECT','RELATIONSHIP') and outcome in ('CREATE_NEW','MATCH_EXISTING','REJECT','DEFER'))
  ),
  constraint reconciliation_decisions_authority_human_only_check check (
    authority_kind = 'HUMAN' and authority_reference is not null
    and authority_rule_code is null and authority_rule_version is null
  ),
  constraint reconciliation_decisions_object_materialization_check check (
    family <> 'OBJECT'
    or ((outcome in ('CREATE_NEW','MATCH_EXISTING')) = (canonical_object_id is not null and canonical_object_kind is not null))
  ),
  constraint reconciliation_decisions_object_subject_check check (
    family <> 'OBJECT' or ((subject_candidate_id is not null) <> (subject_candidate_merge_id is not null))
  ),
  constraint reconciliation_decisions_non_object_subject_null_check check (
    family = 'OBJECT' or (subject_candidate_id is null and subject_candidate_merge_id is null)
  ),
  constraint reconciliation_decisions_canonical_object_exclusive_check check (
    family = 'OBJECT' or (canonical_object_id is null and canonical_object_kind is null)
  ),
  constraint reconciliation_decisions_relationship_fields_check check (
    (family = 'RELATIONSHIP') = (relationship_candidate_id is not null and relationship_type_code is not null)
  ),
  constraint reconciliation_decisions_merge_fields_check check (
    (family = 'CANDIDATE_MERGE') = (candidate_merge_id is not null)
  ),
  constraint reconciliation_decisions_contract_version_check
    check (contract_version in ('1.0','1.1')),
  constraint reconciliation_decisions_envelope_hash_format_check
    check (envelope_hash ~ '^[0-9a-f]{64}$'),
  constraint reconciliation_decisions_organisation_id_unique unique (organisation_id, decision_id)
);

comment on table gov_repo.reconciliation_decisions is
  'IMMUTABLE append-only canonical ReconciliationDecision / RelationshipReconciliationDecision / MergeCandidatesReconciliationDecision envelope (packages/canonical-contracts). "family" distinguishes which of the three current invocation gates in packages/governance-review/src/reconciliation-invocation.ts produced the row; it is derived dispatch metadata, not part of the canonical envelope itself. The envelope column is the authoritative content and MUST be revalidated through canonical-contracts rehydrateObjectReconciliationDecision / rehydrateRelationshipReconciliationDecision (or the adapter''s own allowlisted validator for MERGE_CANDIDATES) on every read — this table never trusts previously-written JSON merely because this application wrote it.';
comment on constraint reconciliation_decisions_authority_human_only_check on gov_repo.reconciliation_decisions is
  'governance-review calls assertHumanActor() before every invoke*Reconciliation path (MachineAuthorityForbiddenError otherwise); this CHECK enforces that proven domain invariant again at the DB boundary. Loosening it requires an explicit future migration, never a silent default.';
comment on column gov_repo.reconciliation_decisions.envelope_hash is
  'SHA-256 hex digest of the exact canonical JSON the application serialized for `envelope`, computed and independently reverified by the TypeScript adapter (not by this database) so a stored-but-altered envelope is detected on read.';
comment on column gov_repo.reconciliation_decisions.contract_version is
  'Mirrors packages/canonical-contracts SUPPORTED_CANONICAL_CONTRACT_VERSIONS. Update this CHECK in lockstep with that constant if a new contract version is ever added.';

create index idx_reconciliation_decisions_org on gov_repo.reconciliation_decisions (organisation_id);
create index idx_reconciliation_decisions_family on gov_repo.reconciliation_decisions (organisation_id, family);

create table gov_repo.reconciliation_decision_assertions (
  decision_id     text not null,
  organisation_id uuid not null,
  assertion_id    text not null,
  constraint reconciliation_decision_assertions_pkey primary key (decision_id, assertion_id),
  constraint reconciliation_decision_assertions_decision_fkey
    foreign key (organisation_id, decision_id)
    references gov_repo.reconciliation_decisions (organisation_id, decision_id)
);
comment on table gov_repo.reconciliation_decision_assertions is 'Normalized assertionIds for one immutable reconciliation decision.';
create index idx_reconciliation_decision_assertions_org on gov_repo.reconciliation_decision_assertions (organisation_id);

create table gov_repo.reconciliation_decision_evidence (
  decision_id     text not null,
  organisation_id uuid not null,
  evidence_id     text not null,
  constraint reconciliation_decision_evidence_pkey primary key (decision_id, evidence_id),
  constraint reconciliation_decision_evidence_decision_fkey
    foreign key (organisation_id, decision_id)
    references gov_repo.reconciliation_decisions (organisation_id, decision_id)
);
comment on table gov_repo.reconciliation_decision_evidence is 'Normalized evidenceIds for one immutable reconciliation decision.';
create index idx_reconciliation_decision_evidence_org on gov_repo.reconciliation_decision_evidence (organisation_id);

create table gov_repo.reconciliation_decision_merge_members (
  decision_id     text not null,
  organisation_id uuid not null,
  candidate_id    text not null,
  constraint reconciliation_decision_merge_members_pkey primary key (decision_id, candidate_id),
  constraint reconciliation_decision_merge_members_decision_fkey
    foreign key (organisation_id, decision_id)
    references gov_repo.reconciliation_decisions (organisation_id, decision_id)
);
comment on table gov_repo.reconciliation_decision_merge_members is
  'Normalized contributingCandidateIds (CandidateMergeRecord) for a CANDIDATE_MERGE family reconciliation decision.';
create index idx_reconciliation_decision_merge_members_org on gov_repo.reconciliation_decision_merge_members (organisation_id);

-- -----------------------------------------------------------------------------
-- F. RECONCILIATION INVOCATIONS — append-only immutable audit envelope.
--    Mirrors ReconciliationInvocationAuditEvent (reconciliation-invocation.ts).
-- -----------------------------------------------------------------------------

create table gov_repo.reconciliation_invocations (
  invocation_id               text        primary key,
  command_id                  text        not null,
  command_fingerprint         text        not null,
  organisation_id             uuid        not null references gov_repo.organisations (organisation_id),
  review_subject_id           text,
  authorization_decision_id   text        not null,
  reconciliation_decision_id  text        not null,
  requested_action            text        not null,
  actor_kind                  text        not null,
  actor_reference             text,
  actor_rule_code             text,
  actor_rule_version          text,
  requested_at                timestamptz not null,
  reason_code                 text        not null,
  recorded_at                 timestamptz not null default now(),
  constraint reconciliation_invocations_requested_action_check check (
    requested_action in ('CREATE_NEW','MATCH_EXISTING','MERGE_CANDIDATES','REJECT','DEFER')
  ),
  constraint reconciliation_invocations_actor_human_only_check check (
    actor_kind = 'HUMAN' and actor_reference is not null
    and actor_rule_code is null and actor_rule_version is null
  ),
  constraint reconciliation_invocations_command_unique unique (organisation_id, command_id),
  constraint reconciliation_invocations_subject_fkey
    foreign key (organisation_id, review_subject_id)
    references gov_repo.review_subjects (organisation_id, review_subject_id),
  constraint reconciliation_invocations_authorization_fkey
    foreign key (organisation_id, authorization_decision_id)
    references gov_repo.authorization_decisions (organisation_id, authorization_decision_id),
  constraint reconciliation_invocations_decision_fkey
    foreign key (organisation_id, reconciliation_decision_id)
    references gov_repo.reconciliation_decisions (organisation_id, decision_id)
);

comment on table gov_repo.reconciliation_invocations is
  'IMMUTABLE append-only ReconciliationInvocationAuditEvent. actor_kind is HUMAN-only here (same assertHumanActor invariant as reconciliation_decisions.authority_kind) because this row is only ever written alongside an authorized reconciliation decision.';
comment on constraint reconciliation_invocations_command_unique on gov_repo.reconciliation_invocations is
  'Authoritative audit uniqueness per commandId. Concurrency/idempotency arbitration itself happens earlier, against gov_repo.reconciliation_command_locks, inside gov_repo.record_authorized_reconciliation.';

create index idx_reconciliation_invocations_org on gov_repo.reconciliation_invocations (organisation_id);
create index idx_reconciliation_invocations_command on gov_repo.reconciliation_invocations (organisation_id, command_id);

-- -----------------------------------------------------------------------------
-- G. TRANSACTIONAL OUTBOX — inserted only inside the same transaction as the
--    authoritative persistence it describes. No worker/consumer is built by
--    this milestone; nothing is published externally yet.
-- -----------------------------------------------------------------------------

create table gov_repo.outbox_events (
  outbox_event_id      uuid        primary key default gen_random_uuid(),
  organisation_id      uuid        not null references gov_repo.organisations (organisation_id),
  event_type           text        not null,
  payload              jsonb       not null,
  payload_hash         char(64)    not null,
  occurred_at          timestamptz not null,
  created_at           timestamptz not null default now(),
  delivery_status      text        not null default 'PENDING',
  delivered_at         timestamptz,
  delivery_attempts    integer     not null default 0,
  last_delivery_error  text,
  constraint outbox_events_event_type_check check (
    event_type in ('GOVERNANCE_REVIEW_TRANSITIONED','GOVERNANCE_AUTHORIZATION_EVALUATED','GOVERNANCE_RECONCILIATION_DECIDED')
  ),
  constraint outbox_events_delivery_status_check check (delivery_status in ('PENDING','DELIVERED','FAILED')),
  constraint outbox_events_delivery_attempts_nonnegative check (delivery_attempts >= 0),
  constraint outbox_events_payload_hash_format_check check (payload_hash ~ '^[0-9a-f]{64}$')
);

comment on table gov_repo.outbox_events is
  'Transactional outbox. payload carries only IDs/references (never duplicated uncontrolled governed content) and, together with event_type/organisation_id/payload_hash/occurred_at/created_at/outbox_event_id, is immutable after insert — only delivery_status/delivered_at/delivery_attempts/last_delivery_error may change, for a future delivery worker this milestone does not build.';

create index idx_outbox_events_org on gov_repo.outbox_events (organisation_id);
create index idx_outbox_events_pending on gov_repo.outbox_events (delivery_status, created_at) where delivery_status = 'PENDING';

-- -----------------------------------------------------------------------------
-- H. IMMUTABILITY — enforced at the PostgreSQL level via unconditional
--    ON UPDATE / ON DELETE rules, mirroring gov_repo.governance_ledger's
--    existing pattern. Never rely on TypeScript alone for this.
-- -----------------------------------------------------------------------------

create or replace rule review_audit_events_no_update as
  on update to gov_repo.review_audit_events do instead nothing;
create or replace rule review_audit_events_no_delete as
  on delete to gov_repo.review_audit_events do instead nothing;

create or replace rule review_audit_event_evidence_no_update as
  on update to gov_repo.review_audit_event_evidence do instead nothing;
create or replace rule review_audit_event_evidence_no_delete as
  on delete to gov_repo.review_audit_event_evidence do instead nothing;

create or replace rule authorization_decisions_no_update as
  on update to gov_repo.authorization_decisions do instead nothing;
create or replace rule authorization_decisions_no_delete as
  on delete to gov_repo.authorization_decisions do instead nothing;

-- reconciliation_command_locks intentionally carries NO immutability rule:
-- (1) it is not one of the four tables Phase 5 requires to be immutable
-- (ReviewAuditEvent, AuthorizationDecision, ReconciliationInvocation,
-- canonical ReconciliationDecision) — it is a private technical concurrency
-- primitive with no independent governance authority, the same role
-- gov_repo.mandate_mapping_guards plays (and that table is likewise mutable);
-- (2) PostgreSQL does not allow INSERT ... ON CONFLICT on a table that has
-- any rewrite RULE, and gov_repo.record_authorized_reconciliation's
-- idempotency gate depends on exactly that ON CONFLICT DO NOTHING pattern.

create or replace rule reconciliation_decisions_no_update as
  on update to gov_repo.reconciliation_decisions do instead nothing;
create or replace rule reconciliation_decisions_no_delete as
  on delete to gov_repo.reconciliation_decisions do instead nothing;

create or replace rule reconciliation_decision_assertions_no_update as
  on update to gov_repo.reconciliation_decision_assertions do instead nothing;
create or replace rule reconciliation_decision_assertions_no_delete as
  on delete to gov_repo.reconciliation_decision_assertions do instead nothing;

create or replace rule reconciliation_decision_evidence_no_update as
  on update to gov_repo.reconciliation_decision_evidence do instead nothing;
create or replace rule reconciliation_decision_evidence_no_delete as
  on delete to gov_repo.reconciliation_decision_evidence do instead nothing;

create or replace rule reconciliation_decision_merge_members_no_update as
  on update to gov_repo.reconciliation_decision_merge_members do instead nothing;
create or replace rule reconciliation_decision_merge_members_no_delete as
  on delete to gov_repo.reconciliation_decision_merge_members do instead nothing;

create or replace rule reconciliation_invocations_no_update as
  on update to gov_repo.reconciliation_invocations do instead nothing;
create or replace rule reconciliation_invocations_no_delete as
  on delete to gov_repo.reconciliation_invocations do instead nothing;

-- Outbox: identity + payload are immutable; delivery metadata may still change.
create or replace rule outbox_events_immutable_core as
  on update to gov_repo.outbox_events
  where (
    old.outbox_event_id is distinct from new.outbox_event_id
    or old.organisation_id is distinct from new.organisation_id
    or old.event_type is distinct from new.event_type
    or old.payload is distinct from new.payload
    or old.payload_hash is distinct from new.payload_hash
    or old.occurred_at is distinct from new.occurred_at
    or old.created_at is distinct from new.created_at
  )
  do instead nothing;
create or replace rule outbox_events_no_delete as
  on delete to gov_repo.outbox_events do instead nothing;

-- -----------------------------------------------------------------------------
-- I. ROW LEVEL SECURITY — server-side privileged persistence boundary only.
--    No UI consumes this data in this milestone, so (per Phase 6) no
--    authenticated-role read policy is created; only service_role has access.
--    A future milestone adding dashboard access should add a narrowly-scoped
--    authenticated SELECT policy then, matching the governance_users
--    email-join pattern used elsewhere in gov_repo — never USING(true).
-- -----------------------------------------------------------------------------

alter table gov_repo.review_subjects enable row level security;
alter table gov_repo.review_subject_assertions enable row level security;
alter table gov_repo.review_subject_evidence enable row level security;
alter table gov_repo.review_audit_events enable row level security;
alter table gov_repo.review_audit_event_evidence enable row level security;
alter table gov_repo.authorization_decisions enable row level security;
alter table gov_repo.reconciliation_command_locks enable row level security;
alter table gov_repo.reconciliation_decisions enable row level security;
alter table gov_repo.reconciliation_decision_assertions enable row level security;
alter table gov_repo.reconciliation_decision_evidence enable row level security;
alter table gov_repo.reconciliation_decision_merge_members enable row level security;
alter table gov_repo.reconciliation_invocations enable row level security;
alter table gov_repo.outbox_events enable row level security;

revoke all on table
  gov_repo.review_subjects,
  gov_repo.review_subject_assertions,
  gov_repo.review_subject_evidence,
  gov_repo.review_audit_events,
  gov_repo.review_audit_event_evidence,
  gov_repo.authorization_decisions,
  gov_repo.reconciliation_command_locks,
  gov_repo.reconciliation_decisions,
  gov_repo.reconciliation_decision_assertions,
  gov_repo.reconciliation_decision_evidence,
  gov_repo.reconciliation_decision_merge_members,
  gov_repo.reconciliation_invocations,
  gov_repo.outbox_events
from public, anon, authenticated;

create policy "Service role has full access to review_subjects" on gov_repo.review_subjects for all to service_role using (true) with check (true);
create policy "Service role has full access to review_subject_assertions" on gov_repo.review_subject_assertions for all to service_role using (true) with check (true);
create policy "Service role has full access to review_subject_evidence" on gov_repo.review_subject_evidence for all to service_role using (true) with check (true);
create policy "Service role has full access to review_audit_events" on gov_repo.review_audit_events for all to service_role using (true) with check (true);
create policy "Service role has full access to review_audit_event_evidence" on gov_repo.review_audit_event_evidence for all to service_role using (true) with check (true);
create policy "Service role has full access to authorization_decisions" on gov_repo.authorization_decisions for all to service_role using (true) with check (true);
create policy "Service role has full access to reconciliation_command_locks" on gov_repo.reconciliation_command_locks for all to service_role using (true) with check (true);
create policy "Service role has full access to reconciliation_decisions" on gov_repo.reconciliation_decisions for all to service_role using (true) with check (true);
create policy "Service role access to reconciliation_decision_assertions" on gov_repo.reconciliation_decision_assertions for all to service_role using (true) with check (true);
create policy "Service role access to reconciliation_decision_evidence" on gov_repo.reconciliation_decision_evidence for all to service_role using (true) with check (true);
create policy "Service role access to reconciliation_decision_merge_members" on gov_repo.reconciliation_decision_merge_members for all to service_role using (true) with check (true);
create policy "Service role has full access to reconciliation_invocations" on gov_repo.reconciliation_invocations for all to service_role using (true) with check (true);
create policy "Service role has full access to outbox_events" on gov_repo.outbox_events for all to service_role using (true) with check (true);

-- -----------------------------------------------------------------------------
-- J. TRANSACTIONAL RPCs (Unit of Work). SECURITY INVOKER, explicit
--    search_path, EXECUTE revoked from PUBLIC/anon/authenticated and granted
--    only to service_role — mirrors gov_repo.signup_legacy exactly.
-- -----------------------------------------------------------------------------

-- J.1 — Idempotent creation of a new ReviewSubject at DETECTED. Not a
-- "transition" (createReviewSubject never produces a ReviewAuditEvent), so
-- this is deliberately separate from apply_review_transition below.
create or replace function gov_repo.create_review_subject(
  p_review_subject_id    text,
  p_organisation_id      uuid,
  p_finding_id           text,
  p_candidate_kind       text,
  p_source_connection_id text,
  p_source_external_type text,
  p_source_external_id   text,
  p_detected_at          timestamptz,
  p_assertion_ids        text[],
  p_evidence_ids         text[]
)
returns table (
  replay               boolean,
  review_subject_id    text,
  organisation_id      uuid,
  finding_id           text,
  candidate_kind       text,
  source_connection_id text,
  source_external_type text,
  source_external_id   text,
  state                text,
  detected_at          timestamptz,
  revision             bigint
)
language plpgsql
volatile
security invoker
set search_path = 'gov_repo', 'pg_catalog'
as $$
-- ON CONFLICT (review_subject_id) below resolves its target through general
-- expression parsing (unlike an INSERT column list or an aliased WHERE
-- clause), so it is NOT protected by table-qualification and remains
-- ambiguous against this function's own RETURNS TABLE output column of the
-- same name unless variable/column resolution is pinned explicitly.
#variable_conflict use_column
declare
  v_inserted gov_repo.review_subjects%rowtype;
  v_existing gov_repo.review_subjects%rowtype;
  v_existing_assertions text[];
  v_existing_evidence text[];
  v_wanted_assertions text[];
  v_wanted_evidence text[];
begin
  if p_review_subject_id is null or btrim(p_review_subject_id) = '' then
    raise exception using errcode = '22004', message = 'review_subject_id is required';
  end if;
  if p_finding_id is null or btrim(p_finding_id) = '' then
    raise exception using errcode = '22004', message = 'finding_id is required';
  end if;

  insert into gov_repo.review_subjects as rs (
    review_subject_id, organisation_id, finding_id, candidate_kind,
    source_connection_id, source_external_type, source_external_id,
    state, detected_at
  ) values (
    p_review_subject_id, p_organisation_id, p_finding_id, p_candidate_kind,
    p_source_connection_id, p_source_external_type, p_source_external_id,
    'DETECTED', p_detected_at
  )
  on conflict (review_subject_id) do nothing
  returning rs.* into v_inserted;

  if found then
    insert into gov_repo.review_subject_assertions (review_subject_id, organisation_id, assertion_id)
    select p_review_subject_id, p_organisation_id, unnested.value
    from unnest(coalesce(p_assertion_ids, '{}')) as unnested(value);

    insert into gov_repo.review_subject_evidence (review_subject_id, organisation_id, evidence_id)
    select p_review_subject_id, p_organisation_id, unnested.value
    from unnest(coalesce(p_evidence_ids, '{}')) as unnested(value);

    return query select
      false, v_inserted.review_subject_id, v_inserted.organisation_id, v_inserted.finding_id,
      v_inserted.candidate_kind, v_inserted.source_connection_id, v_inserted.source_external_type,
      v_inserted.source_external_id, v_inserted.state, v_inserted.detected_at, v_inserted.revision;
    return;
  end if;

  -- Bare "review_subject_id" below would be ambiguous against this function's
  -- own RETURNS TABLE output column of the same name (PL/pgSQL implicit-
  -- variable ambiguity class — see gov_repo.signup_legacy for precedent), so
  -- every reference is qualified through an explicit table alias.
  select * into v_existing from gov_repo.review_subjects as rs where rs.review_subject_id = p_review_subject_id;

  select coalesce(array_agg(rsa.assertion_id order by rsa.assertion_id), '{}') into v_existing_assertions
    from gov_repo.review_subject_assertions as rsa where rsa.review_subject_id = p_review_subject_id;
  select coalesce(array_agg(rse.evidence_id order by rse.evidence_id), '{}') into v_existing_evidence
    from gov_repo.review_subject_evidence as rse where rse.review_subject_id = p_review_subject_id;
  select coalesce(array_agg(value order by value), '{}') into v_wanted_assertions
    from unnest(coalesce(p_assertion_ids, '{}')) as value;
  select coalesce(array_agg(value order by value), '{}') into v_wanted_evidence
    from unnest(coalesce(p_evidence_ids, '{}')) as value;

  if v_existing.organisation_id is distinct from p_organisation_id
     or v_existing.finding_id is distinct from p_finding_id
     or v_existing.candidate_kind is distinct from p_candidate_kind
     or v_existing.source_connection_id is distinct from p_source_connection_id
     or v_existing.source_external_type is distinct from p_source_external_type
     or v_existing.source_external_id is distinct from p_source_external_id
     or v_existing.detected_at is distinct from p_detected_at
     or v_existing_assertions is distinct from v_wanted_assertions
     or v_existing_evidence is distinct from v_wanted_evidence
  then
    raise exception using
      errcode = '23505',
      message = 'REVIEW_SUBJECT_ID_CONFLICT',
      detail = format('review_subject_id %s already exists with different content', p_review_subject_id);
  end if;

  return query select
    true, v_existing.review_subject_id, v_existing.organisation_id, v_existing.finding_id,
    v_existing.candidate_kind, v_existing.source_connection_id, v_existing.source_external_type,
    v_existing.source_external_id, v_existing.state, v_existing.detected_at, v_existing.revision;
end;
$$;

comment on function gov_repo.create_review_subject is
  'Idempotent creation of a DETECTED ReviewSubject plus normalized assertion/evidence membership. Same reviewSubjectId with identical content replays (replay=true); same reviewSubjectId with different content fails closed (23505). SECURITY INVOKER, service_role only.';

-- J.2 — Transaction A: ReviewSubject transition + ReviewAuditEvent + evidence
-- links + Outbox event, all-or-nothing. The caller (a server-side adapter
-- wrapping packages/governance-review's pure propose/confirm/certify/reject)
-- has already computed the full TransitionResult; this RPC durably records it
-- with its own independent tenant/concurrency/idempotency guards.
create or replace function gov_repo.apply_review_transition(
  p_organisation_id    uuid,
  p_review_subject_id  text,
  p_finding_id         text,
  p_previous_state     text,
  p_new_state          text,
  p_actor_kind         text,
  p_actor_reference    text,
  p_actor_rule_code    text,
  p_actor_rule_version text,
  p_occurred_at        timestamptz,
  p_evidence_ids       text[],
  p_reason_code        text,
  p_command_id         text,
  p_event_id           text
)
returns table (
  replay             boolean,
  event_id           text,
  review_subject_id  text,
  previous_state     text,
  new_state          text,
  occurred_at        timestamptz,
  revision           bigint,
  state              text
)
language plpgsql
volatile
security invoker
set search_path = 'gov_repo', 'pg_catalog'
as $$
declare
  v_subject gov_repo.review_subjects%rowtype;
  v_last_event gov_repo.review_audit_events%rowtype;
  v_last_event_evidence text[];
  v_wanted_evidence text[];
  v_payload jsonb;
begin
  -- Bare column names below would be ambiguous against this function's own
  -- RETURNS TABLE output columns of the same name (PL/pgSQL implicit-variable
  -- ambiguity class — see gov_repo.signup_legacy for precedent), so every
  -- reference is qualified through an explicit table alias.
  select * into v_subject from gov_repo.review_subjects as rs
    where rs.review_subject_id = p_review_subject_id
    for update;

  if not found then
    raise exception using errcode = 'P0002', message = format('Review subject %s not found', p_review_subject_id);
  end if;

  if v_subject.organisation_id is distinct from p_organisation_id then
    raise exception using errcode = '42501', message = 'Cross-tenant review subject transition rejected';
  end if;

  if v_subject.finding_id is distinct from p_finding_id then
    raise exception using errcode = '23514', message = 'finding_id does not match review subject';
  end if;

  if v_subject.last_transition_id is not null then
    select * into v_last_event from gov_repo.review_audit_events as rae where rae.event_id = v_subject.last_transition_id;
    if v_last_event.command_id = p_command_id then
      -- Replay candidate: a reused commandId must reproduce IDENTICAL content,
      -- never silently return stale data for a materially different request
      -- (the same class of check create_review_subject and
      -- record_authorization_decision already apply to their own conflicts).
      select coalesce(array_agg(raee.evidence_id order by raee.evidence_id), '{}') into v_last_event_evidence
        from gov_repo.review_audit_event_evidence as raee where raee.event_id = v_last_event.event_id;
      select coalesce(array_agg(value order by value), '{}') into v_wanted_evidence
        from unnest(coalesce(p_evidence_ids, '{}')) as value;

      if v_last_event.event_id is distinct from p_event_id
         or v_last_event.previous_state is distinct from p_previous_state
         or v_last_event.new_state is distinct from p_new_state
         or v_last_event.actor_kind is distinct from p_actor_kind
         or v_last_event.actor_reference is distinct from p_actor_reference
         or v_last_event.actor_rule_code is distinct from p_actor_rule_code
         or v_last_event.actor_rule_version is distinct from p_actor_rule_version
         or v_last_event.reason_code is distinct from p_reason_code
         or v_last_event_evidence is distinct from v_wanted_evidence
      then
        raise exception using
          errcode = '23514',
          message = 'IDEMPOTENCY_CONFLICT',
          detail = format(
            'commandId %s was already used for review subject %s with different content',
            p_command_id, p_review_subject_id
          );
      end if;

      return query select
        true, v_last_event.event_id, v_subject.review_subject_id, v_last_event.previous_state,
        v_last_event.new_state, v_last_event.occurred_at, v_subject.revision, v_subject.state;
      return;
    end if;
  end if;

  if v_subject.state is distinct from p_previous_state then
    raise exception using errcode = '40001', message = format(
      'Stale review state: expected %s but found %s', p_previous_state, v_subject.state
    );
  end if;

  insert into gov_repo.review_audit_events (
    event_id, review_subject_id, organisation_id, finding_id,
    previous_state, new_state, actor_kind, actor_reference, actor_rule_code, actor_rule_version,
    occurred_at, reason_code, command_id
  ) values (
    p_event_id, p_review_subject_id, p_organisation_id, p_finding_id,
    p_previous_state, p_new_state, p_actor_kind, p_actor_reference, p_actor_rule_code, p_actor_rule_version,
    p_occurred_at, p_reason_code, p_command_id
  );

  insert into gov_repo.review_audit_event_evidence (event_id, organisation_id, evidence_id)
  select p_event_id, p_organisation_id, unnested.value
  from unnest(coalesce(p_evidence_ids, '{}')) as unnested(value);

  update gov_repo.review_subjects as rs
    set state = p_new_state, last_transition_id = p_event_id, revision = rs.revision + 1
    where rs.review_subject_id = p_review_subject_id;

  v_payload := jsonb_build_object(
    'reviewSubjectId', p_review_subject_id,
    'eventId', p_event_id,
    'findingId', p_finding_id,
    'previousState', p_previous_state,
    'newState', p_new_state,
    'commandId', p_command_id
  );

  insert into gov_repo.outbox_events (organisation_id, event_type, payload, payload_hash, occurred_at)
  values (
    p_organisation_id, 'GOVERNANCE_REVIEW_TRANSITIONED', v_payload,
    encode(extensions.digest(convert_to(v_payload::text, 'UTF8'), 'sha256'), 'hex'),
    p_occurred_at
  );

  return query select
    false, p_event_id, p_review_subject_id, p_previous_state, p_new_state,
    p_occurred_at, v_subject.revision + 1, p_new_state;
end;
$$;

comment on function gov_repo.apply_review_transition is
  'Transaction A: atomically persists one ReviewSubject transition + its ReviewAuditEvent + cited evidence + a GOVERNANCE_REVIEW_TRANSITIONED outbox event. SELECT ... FOR UPDATE on the subject row serializes concurrent calls for the same reviewSubjectId, so a repeated commandId is detected as a true replay and a genuinely conflicting concurrent transition fails closed (40001) rather than racing. A replayed commandId whose content differs from what is already stored fails closed (23514, IDEMPOTENCY_CONFLICT) instead of silently returning stale data. SECURITY INVOKER, service_role only.';

-- J.3 — Standalone AuthorizationDecision recording (covers a DENY, which
-- governance-review's authorize() helper never returns to its caller as a
-- value — only ALLOW flows into Transaction B below). Also idempotently
-- covers a repeated ALLOW recorded outside of Transaction B, if ever needed.
create or replace function gov_repo.record_authorization_decision(
  p_authorization_decision_id  text,
  p_organisation_id            uuid,
  p_review_subject_id          text,
  p_actor_reference            text,
  p_subject_kind               text,
  p_subject_candidate_id       text,
  p_subject_candidate_merge_id text,
  p_requested_action           text,
  p_result                     text,
  p_evaluated_at               timestamptz,
  p_policy_reference           text
)
returns table (
  replay                      boolean,
  authorization_decision_id   text,
  result                      text
)
language plpgsql
volatile
security invoker
set search_path = 'gov_repo', 'pg_catalog'
as $$
declare
  v_existing gov_repo.authorization_decisions%rowtype;
  v_payload jsonb;
begin
  -- authorization_decisions must remain immutable (Phase 5), and PostgreSQL
  -- disallows INSERT ... ON CONFLICT on any table protected by a rewrite
  -- RULE. This uses the same check-then-insert-with-exception-handler
  -- pattern already established in this schema for exactly this situation
  -- (see gov_repo.create_mandate_mapping_guard()'s "exception when
  -- unique_violation" handler), instead of ON CONFLICT.
  begin
    insert into gov_repo.authorization_decisions as ad (
      authorization_decision_id, organisation_id, review_subject_id, actor_reference,
      subject_kind, subject_candidate_id, subject_candidate_merge_id,
      requested_action, result, evaluated_at, policy_reference
    ) values (
      p_authorization_decision_id, p_organisation_id, p_review_subject_id, p_actor_reference,
      p_subject_kind, p_subject_candidate_id, p_subject_candidate_merge_id,
      p_requested_action, p_result, p_evaluated_at, p_policy_reference
    );

    v_payload := jsonb_build_object(
      'authorizationDecisionId', p_authorization_decision_id,
      'organisationId', p_organisation_id,
      'reviewSubjectId', p_review_subject_id,
      'requestedAction', p_requested_action,
      'result', p_result
    );
    insert into gov_repo.outbox_events (organisation_id, event_type, payload, payload_hash, occurred_at)
    values (
      p_organisation_id, 'GOVERNANCE_AUTHORIZATION_EVALUATED', v_payload,
      encode(extensions.digest(convert_to(v_payload::text, 'UTF8'), 'sha256'), 'hex'),
      p_evaluated_at
    );

    return query select false, p_authorization_decision_id, p_result;
    return;
  exception
    when unique_violation then
      -- Fall through to the replay/conflict check below.
      null;
  end;

  -- Bare "authorization_decision_id" would be ambiguous against this
  -- function's own RETURNS TABLE output column of the same name (PL/pgSQL
  -- implicit-variable ambiguity class), so it is qualified via an alias.
  select * into v_existing from gov_repo.authorization_decisions as ad2 where ad2.authorization_decision_id = p_authorization_decision_id;

  if v_existing.organisation_id is distinct from p_organisation_id
     or v_existing.review_subject_id is distinct from p_review_subject_id
     or v_existing.actor_reference is distinct from p_actor_reference
     or v_existing.subject_kind is distinct from p_subject_kind
     or v_existing.subject_candidate_id is distinct from p_subject_candidate_id
     or v_existing.subject_candidate_merge_id is distinct from p_subject_candidate_merge_id
     or v_existing.requested_action is distinct from p_requested_action
     or v_existing.result is distinct from p_result
     or v_existing.evaluated_at is distinct from p_evaluated_at
  then
    raise exception using
      errcode = '23505',
      message = 'AUTHORIZATION_DECISION_ID_CONFLICT',
      detail = format('authorization_decision_id %s already exists with different content', p_authorization_decision_id);
  end if;

  return query select true, v_existing.authorization_decision_id, v_existing.result;
end;
$$;

comment on function gov_repo.record_authorization_decision is
  'Idempotent standalone AuthorizationDecision recording (ALLOW or DENY) plus a GOVERNANCE_AUTHORIZATION_EVALUATED outbox event. Used for a DENY, which never reaches Transaction B. SECURITY INVOKER, service_role only.';

-- J.4 — Transaction B: AuthorizationDecision (ALLOW) + canonical
-- ReconciliationDecision + ReconciliationInvocation + Outbox event, all inside
-- one atomically-gated Unit of Work. Idempotency is arbitrated first, via
-- gov_repo.reconciliation_command_locks, before any authoritative row exists.
create or replace function gov_repo.record_authorized_reconciliation(
  p_organisation_id                          uuid,
  p_review_subject_id                        text,
  p_authorization_decision_id                text,
  p_authorization_actor_reference            text,
  p_authorization_subject_kind               text,
  p_authorization_subject_candidate_id       text,
  p_authorization_subject_candidate_merge_id text,
  p_requested_action                         text,
  p_authorization_evaluated_at               timestamptz,
  p_policy_reference                         text,
  p_invocation_id                            text,
  p_command_id                               text,
  p_command_fingerprint                      text,
  p_requested_at                             timestamptz,
  p_reason_code                              text,
  p_decision_id                              text,
  p_family                                   text,
  p_outcome                                  text,
  p_candidate_kind                           text,
  p_authority_reference                      text,
  p_decided_at                               timestamptz,
  p_subject_candidate_id                     text,
  p_subject_candidate_merge_id               text,
  p_canonical_object_id                      text,
  p_canonical_object_kind                    text,
  p_relationship_candidate_id                text,
  p_relationship_type_code                   text,
  p_candidate_merge_id                       text,
  p_merge_member_candidate_ids               text[],
  p_assertion_ids                            text[],
  p_evidence_ids                             text[],
  p_contract_version                         text,
  p_envelope                                 jsonb,
  p_envelope_hash                            char(64)
)
returns table (
  replay                        boolean,
  authorization_decision_id     text,
  invocation_id                 text,
  reconciliation_decision_id    text
)
language plpgsql
volatile
security invoker
set search_path = 'gov_repo', 'pg_catalog'
as $$
-- ON CONFLICT (organisation_id, command_id) below resolves its target through
-- general expression parsing (unlike an INSERT column list or an aliased
-- WHERE clause), so it remains ambiguous against this function's own
-- RETURNS TABLE output columns of the same name unless pinned explicitly.
#variable_conflict use_column
declare
  v_won text;
  v_existing_fp text;
  v_existing_invocation_id text;
  v_existing_decision_id text;
  v_payload jsonb;
begin
  insert into gov_repo.reconciliation_command_locks (organisation_id, command_id, command_fingerprint, invocation_id)
  values (p_organisation_id, p_command_id, p_command_fingerprint, p_invocation_id)
  on conflict (organisation_id, command_id) do nothing
  returning command_id into v_won;

  if v_won is null then
    -- Bare "invocation_id" / "reconciliation_decision_id" below would be
    -- ambiguous against this function's own RETURNS TABLE output columns of
    -- the same name (PL/pgSQL implicit-variable ambiguity class), so every
    -- reference is qualified through an explicit table alias.
    select rcl.command_fingerprint, rcl.invocation_id into v_existing_fp, v_existing_invocation_id
      from gov_repo.reconciliation_command_locks as rcl
      where rcl.organisation_id = p_organisation_id and rcl.command_id = p_command_id;

    if v_existing_fp is distinct from p_command_fingerprint then
      raise exception using
        errcode = '23514',
        message = 'IDEMPOTENCY_CONFLICT',
        detail = format('commandId %s already used with a different fingerprint', p_command_id);
    end if;

    select ri.reconciliation_decision_id into v_existing_decision_id
      from gov_repo.reconciliation_invocations as ri
      where ri.invocation_id = v_existing_invocation_id;

    return query select true, p_authorization_decision_id, v_existing_invocation_id, v_existing_decision_id;
    return;
  end if;

  insert into gov_repo.authorization_decisions (
    authorization_decision_id, organisation_id, review_subject_id, actor_reference,
    subject_kind, subject_candidate_id, subject_candidate_merge_id,
    requested_action, result, evaluated_at, policy_reference
  ) values (
    p_authorization_decision_id, p_organisation_id, p_review_subject_id, p_authorization_actor_reference,
    p_authorization_subject_kind, p_authorization_subject_candidate_id, p_authorization_subject_candidate_merge_id,
    p_requested_action, 'ALLOW', p_authorization_evaluated_at, p_policy_reference
  );

  insert into gov_repo.reconciliation_decisions (
    decision_id, organisation_id, family, outcome, candidate_kind,
    authority_kind, authority_reference, reason_code, decided_at,
    subject_candidate_id, subject_candidate_merge_id,
    canonical_object_id, canonical_object_kind,
    relationship_candidate_id, relationship_type_code,
    candidate_merge_id, contract_version, envelope, envelope_hash
  ) values (
    p_decision_id, p_organisation_id, p_family, p_outcome, p_candidate_kind,
    'HUMAN', p_authority_reference, p_reason_code, p_decided_at,
    p_subject_candidate_id, p_subject_candidate_merge_id,
    p_canonical_object_id, p_canonical_object_kind,
    p_relationship_candidate_id, p_relationship_type_code,
    p_candidate_merge_id, p_contract_version, p_envelope, p_envelope_hash
  );

  insert into gov_repo.reconciliation_decision_assertions (decision_id, organisation_id, assertion_id)
  select p_decision_id, p_organisation_id, unnested.value
  from unnest(coalesce(p_assertion_ids, '{}')) as unnested(value);

  insert into gov_repo.reconciliation_decision_evidence (decision_id, organisation_id, evidence_id)
  select p_decision_id, p_organisation_id, unnested.value
  from unnest(coalesce(p_evidence_ids, '{}')) as unnested(value);

  insert into gov_repo.reconciliation_decision_merge_members (decision_id, organisation_id, candidate_id)
  select p_decision_id, p_organisation_id, unnested.value
  from unnest(coalesce(p_merge_member_candidate_ids, '{}')) as unnested(value);

  insert into gov_repo.reconciliation_invocations (
    invocation_id, command_id, command_fingerprint, organisation_id, review_subject_id,
    authorization_decision_id, reconciliation_decision_id, requested_action,
    actor_kind, actor_reference, requested_at, reason_code
  ) values (
    p_invocation_id, p_command_id, p_command_fingerprint, p_organisation_id, p_review_subject_id,
    p_authorization_decision_id, p_decision_id, p_requested_action,
    'HUMAN', p_authority_reference, p_requested_at, p_reason_code
  );

  v_payload := jsonb_build_object(
    'organisationId', p_organisation_id,
    'reconciliationDecisionId', p_decision_id,
    'authorizationDecisionId', p_authorization_decision_id,
    'invocationId', p_invocation_id,
    'commandId', p_command_id,
    'family', p_family,
    'outcome', p_outcome
  );
  insert into gov_repo.outbox_events (organisation_id, event_type, payload, payload_hash, occurred_at)
  values (
    p_organisation_id, 'GOVERNANCE_RECONCILIATION_DECIDED', v_payload,
    encode(extensions.digest(convert_to(v_payload::text, 'UTF8'), 'sha256'), 'hex'),
    p_decided_at
  );

  return query select false, p_authorization_decision_id, p_invocation_id, p_decision_id;
end;
$$;

comment on function gov_repo.record_authorized_reconciliation is
  'Transaction B: atomically persists AuthorizationDecision(ALLOW) + canonical ReconciliationDecision + ReconciliationInvocation + a GOVERNANCE_RECONCILIATION_DECIDED outbox event. Idempotency is arbitrated up front against gov_repo.reconciliation_command_locks via INSERT ... ON CONFLICT DO NOTHING, which blocks a concurrent caller for the same (organisation_id, command_id) until the winner commits or aborts, so concurrent identical calls produce exactly one logical result. Any failure after the lock insert aborts the whole calling transaction, including that lock row, leaving no partial governance truth. authority_reference is the single HUMAN actorReference shared by both the reconciliation decision''s authority and the invocation''s actor, matching governance-review''s own invariant that they are literally the same ReconciliationAuthority object. SECURITY INVOKER, service_role only.';

-- -----------------------------------------------------------------------------
-- K. PERMISSIONS — EXECUTE revoked from PUBLIC/anon/authenticated, granted
--    only to service_role. Postgres grants EXECUTE to PUBLIC by default on
--    every newly created function, so this revoke is required, not optional.
-- -----------------------------------------------------------------------------

revoke all on function gov_repo.create_review_subject from public, anon, authenticated;
revoke all on function gov_repo.apply_review_transition from public, anon, authenticated;
revoke all on function gov_repo.record_authorization_decision from public, anon, authenticated;
revoke all on function gov_repo.record_authorized_reconciliation from public, anon, authenticated;

grant execute on function gov_repo.create_review_subject to service_role;
grant execute on function gov_repo.apply_review_transition to service_role;
grant execute on function gov_repo.record_authorization_decision to service_role;
grant execute on function gov_repo.record_authorized_reconciliation to service_role;

commit;
