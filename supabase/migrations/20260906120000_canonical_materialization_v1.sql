-- =============================================================================
-- CODEGUARD AI GOVERNANCE OS
-- Migration: 20260906120000_canonical_materialization_v1
-- Domain:    Canonical Materialization V1 — turns an already-persisted, valid
--            canonical ReconciliationDecision (Governance Persistence V1) into
--            governed canonical truth: canonical objects, governed
--            relationships, and object/source identity mappings.
--
-- This migration does NOT redesign packages/governance-review or
-- packages/canonical-contracts, and it does NOT alter the historical
-- 20260905060000_governance_persistence_v1.sql migration. It only extends the
-- schema that milestone deliberately left open (see its comment: "Persisting
-- a canonical reconciliation decision is NOT the same as materialization of a
-- governed canonical object").
--
-- Critical invariant enforced by every function below: ONLY an already
-- persisted, valid canonical reconciliation decision (gov_repo.
-- reconciliation_decisions) with a matching gov_repo.reconciliation_invocations
-- row may cause canonical materialization. No candidate, review subject, or
-- authorization decision may create governed truth directly.
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
      message = 'Cannot apply canonical materialization migration.',
      hint = 'Schema gov_repo does not exist; foundation migrations must run first.';
  end if;

  if to_regclass('gov_repo.reconciliation_decisions') is null
     or to_regclass('gov_repo.reconciliation_invocations') is null
     or to_regclass('gov_repo.outbox_events') is null
  then
    raise exception using
      errcode = '3F000',
      message = 'Cannot apply canonical materialization migration.',
      hint = 'Governance Persistence V1 tables are missing; that migration must run first.';
  end if;

  if to_regclass('gov_repo.canonical_objects') is not null
     or to_regclass('gov_repo.canonical_object_source_mappings') is not null
     or to_regclass('gov_repo.canonical_relationships') is not null
     or to_regclass('gov_repo.materialization_operations') is not null
     or to_regclass('gov_repo.materialization_locks') is not null
  then
    raise exception using
      errcode = '42P07',
      message = 'Cannot apply canonical materialization migration.',
      hint = 'One or more target tables already exist; resolve the naming collision before retrying.';
  end if;
end;
$preflight$;

-- -----------------------------------------------------------------------------
-- A. CANONICAL OBJECTS — governed identity for the 11 canonical-contracts
--    object kinds. Mirrors CanonicalObjectIdentity (organisationId, objectId,
--    kind) exactly; canonical-contracts carries no wider materialized payload
--    for object identity (kind-specific attributes such as
--    DataAssetTechnicalProfile are explicitly separate, mutable, and out of
--    scope for this milestone). created_by_decision_id is the sole
--    provenance link back to the authorizing reconciliation decision.
-- -----------------------------------------------------------------------------

create table gov_repo.canonical_objects (
  canonical_object_id  text        primary key,
  organisation_id      uuid        not null references gov_repo.organisations (organisation_id),
  kind                 text        not null,
  created_by_decision_id text      not null,
  revision             bigint      not null default 0,
  created_at           timestamptz not null default now(),
  constraint canonical_objects_kind_check check (kind in (
    'AGENT','AGENT_VERSION','MODEL','TOOL','MCP_SERVER','API','PROMPT',
    'KNOWLEDGE_BASE','DATA_ASSET','DATA_ELEMENT','SKILL'
  )),
  constraint canonical_objects_revision_nonnegative check (revision >= 0),
  constraint canonical_objects_organisation_id_unique unique (organisation_id, canonical_object_id),
  constraint canonical_objects_decision_fkey
    foreign key (organisation_id, created_by_decision_id)
    references gov_repo.reconciliation_decisions (organisation_id, decision_id)
);

comment on table gov_repo.canonical_objects is
  'Governed canonical object identity (packages/canonical-contracts CanonicalObjectIdentity), materialized exclusively by gov_repo.materialize_object_reconciliation from an already-persisted CREATE_NEW OBJECT-family reconciliation decision. canonical_object_id is the domain-assigned CanonicalObjectId; this table never invents identity. No kind-specific attribute payload lives here by design.';
comment on column gov_repo.canonical_objects.created_by_decision_id is
  'The exact reconciliation decision whose CREATE_NEW outcome authorized this object. A MATCH_EXISTING decision binds a new source to an existing row here without ever inserting a second one.';

create index idx_canonical_objects_org on gov_repo.canonical_objects (organisation_id);
create index idx_canonical_objects_kind on gov_repo.canonical_objects (organisation_id, kind);

-- -----------------------------------------------------------------------------
-- B. CANONICAL OBJECT SOURCE MAPPINGS — durable binding between a discovered
--    SourceObjectIdentity and a governed canonical object, mirroring
--    canonical-contracts' ReconciledObjectSourceMapping (always CONFIRMED;
--    "Created by trusted reconciliation, never accepted from an adapter
--    payload"). This is what lets a future scan recognize "this discovered
--    thing is already this governed object" instead of proposing a duplicate.
-- -----------------------------------------------------------------------------

create table gov_repo.canonical_object_source_mappings (
  mapping_id            text        primary key,
  organisation_id       uuid        not null references gov_repo.organisations (organisation_id),
  canonical_object_id   text        not null,
  canonical_object_kind text        not null,
  source_connection_id  text        not null,
  source_external_type  text        not null,
  source_external_id    text        not null,
  match_method          text        not null,
  status                text        not null default 'CONFIRMED',
  created_by_decision_id text       not null,
  valid_from            timestamptz not null,
  valid_to              timestamptz,
  created_at            timestamptz not null default now(),
  constraint canonical_object_source_mappings_match_method_check
    check (match_method in ('MANUAL','EXTERNAL_ID','DETERMINISTIC','HEURISTIC')),
  constraint canonical_object_source_mappings_status_check
    check (status = 'CONFIRMED'),
  constraint canonical_object_source_mappings_organisation_id_unique
    unique (organisation_id, mapping_id),
  constraint canonical_object_source_mappings_decision_unique
    unique (organisation_id, created_by_decision_id),
  constraint canonical_object_source_mappings_object_fkey
    foreign key (organisation_id, canonical_object_id)
    references gov_repo.canonical_objects (organisation_id, canonical_object_id),
  constraint canonical_object_source_mappings_decision_fkey
    foreign key (organisation_id, created_by_decision_id)
    references gov_repo.reconciliation_decisions (organisation_id, decision_id)
);

comment on table gov_repo.canonical_object_source_mappings is
  'Tenant-safe binding of (organisation_id, source_connection_id, source_external_type, source_external_id) to a governed canonical_object_id, materialized alongside every CREATE_NEW or MATCH_EXISTING object reconciliation. The source identity itself is never accepted from a caller: gov_repo.materialize_object_reconciliation derives it server-side from the certified gov_repo.review_subjects row reached through the decision''s own gov_repo.reconciliation_invocations.review_subject_id.';
comment on constraint canonical_object_source_mappings_decision_unique on gov_repo.canonical_object_source_mappings is
  'At most one mapping per reconciliation decision — the idempotency anchor for a replayed materialization call.';

create index idx_canonical_object_source_mappings_org on gov_repo.canonical_object_source_mappings (organisation_id);
create index idx_canonical_object_source_mappings_object on gov_repo.canonical_object_source_mappings (organisation_id, canonical_object_id);

-- Enforces "no one source identity mapping simultaneously to contradictory
-- canonical objects": at most one currently-active (valid_to is null) mapping
-- per tenant-scoped source identity. The canonical-contracts model does not
-- yet define mapping supersession/versioning, so this milestone never closes
-- an existing mapping (valid_to stays null forever); a second, different
-- canonical target for the same source identity therefore fails closed.
create unique index canonical_object_source_mappings_active_source_uidx
  on gov_repo.canonical_object_source_mappings (organisation_id, source_connection_id, source_external_type, source_external_id)
  where valid_to is null;

-- -----------------------------------------------------------------------------
-- C. CANONICAL RELATIONSHIPS — governed edges materialized from a CREATE_NEW
--    RELATIONSHIP-family reconciliation decision, mirroring the identity
--    fields of GovernedRelationshipBase (relationshipId, relationshipStateId,
--    organisationId, relationshipType, source/target endpoint identity,
--    validFrom/validTo, recordedAt). Support (assertionIds/evidenceIds) and
--    behavior-binding/lineage specifics already live durably in the decision
--    envelope (gov_repo.reconciliation_decisions.envelope) and are not
--    duplicated here.
-- -----------------------------------------------------------------------------

create table gov_repo.canonical_relationships (
  relationship_id             text        primary key,
  organisation_id             uuid        not null references gov_repo.organisations (organisation_id),
  relationship_state_id       text        not null,
  relationship_type           text        not null,
  source_canonical_object_id  text        not null,
  source_kind                 text        not null,
  target_canonical_object_id  text        not null,
  target_kind                 text        not null,
  valid_from                  timestamptz not null,
  valid_to                    timestamptz,
  recorded_at                 timestamptz not null,
  created_by_decision_id      text        not null,
  revision                    bigint      not null default 0,
  created_at                  timestamptz not null default now(),
  constraint canonical_relationships_type_check check (relationship_type in (
    'USES_MODEL','USES_TOOL','USES_MCP','INVOKES','USES_PROMPT',
    'USES_KNOWLEDGE_BASE','USES_SKILL','EXPOSES','HANDOFF_TO',
    'READS_FROM','WRITES_TO','DERIVED_FROM'
  )),
  constraint canonical_relationships_revision_nonnegative check (revision >= 0),
  constraint canonical_relationships_organisation_id_unique unique (organisation_id, relationship_id),
  constraint canonical_relationships_source_fkey
    foreign key (organisation_id, source_canonical_object_id)
    references gov_repo.canonical_objects (organisation_id, canonical_object_id),
  constraint canonical_relationships_target_fkey
    foreign key (organisation_id, target_canonical_object_id)
    references gov_repo.canonical_objects (organisation_id, canonical_object_id),
  constraint canonical_relationships_decision_fkey
    foreign key (organisation_id, created_by_decision_id)
    references gov_repo.reconciliation_decisions (organisation_id, decision_id)
);

comment on table gov_repo.canonical_relationships is
  'Governed relationship edge (packages/canonical-contracts GovernedRelationship), materialized exclusively by gov_repo.materialize_relationship_reconciliation from an already-persisted CREATE_NEW RELATIONSHIP-family reconciliation decision. Both endpoints must already exist in gov_repo.canonical_objects for the same organisation — a relationship can never be materialized ahead of, or across, its endpoints.';

create index idx_canonical_relationships_org on gov_repo.canonical_relationships (organisation_id);
create index idx_canonical_relationships_source on gov_repo.canonical_relationships (organisation_id, source_canonical_object_id);
create index idx_canonical_relationships_target on gov_repo.canonical_relationships (organisation_id, target_canonical_object_id);

-- Enforces "duplicate logical relationship handling must follow existing
-- canonical rules": at most one currently-active (valid_to is null) edge of a
-- given type between the same ordered endpoint pair. canonical-contracts'
-- comment on GovernedRelationshipBase notes type+source+target is only a
-- duplicate-detection signal at the in-memory-contract layer; this index is
-- the governed-persistence-layer invariant this milestone adds on top of it.
create unique index canonical_relationships_active_edge_uidx
  on gov_repo.canonical_relationships (organisation_id, relationship_type, source_canonical_object_id, target_canonical_object_id)
  where valid_to is null;

-- -----------------------------------------------------------------------------
-- D. MATERIALIZATION OPERATIONS — append-only tracking of whether one
--    reconciliation decision's materialization attempt is PENDING, APPLIED,
--    or FAILED. This status belongs to the application/persistence process,
--    never to the immutable ReconciliationDecision contract itself,
--    per Phase 4. Only outcomes that canonical-contracts itself calls
--    "materializing" (CREATE_NEW, MATCH_EXISTING — see contracts.ts
--    rehydrateObjectReconciliationDecision's `materializes` flag) ever
--    produce a row here; REJECT/DEFER/MERGE_CANDIDATES never do, because
--    they create no canonical truth to track.
--
--    FAILED is a reserved, currently-unreachable status value (parallel to
--    outbox_events.delivery_status's own unreachable FAILED today): every
--    materialization attempt here runs inside one Postgres function
--    transaction, so a failure anywhere aborts the whole transaction and
--    leaves no row at all — not even a FAILED one — matching the "failure
--    anywhere leaves no partial canonical truth" requirement. A future
--    milestone that introduces genuinely asynchronous materialization may
--    populate FAILED; this one does not need to.
-- -----------------------------------------------------------------------------

create table gov_repo.materialization_operations (
  materialization_operation_id text        primary key,
  organisation_id               uuid        not null references gov_repo.organisations (organisation_id),
  reconciliation_decision_id    text        not null,
  invocation_id                 text        not null,
  decision_family                text        not null,
  outcome                        text        not null,
  status                         text        not null,
  idempotency_fingerprint        char(64)    not null,
  resulting_canonical_object_id  text,
  resulting_relationship_id      text,
  failure_classification         text,
  applied_at                     timestamptz,
  created_at                     timestamptz not null default now(),
  constraint materialization_operations_family_check check (decision_family in ('OBJECT','RELATIONSHIP')),
  constraint materialization_operations_outcome_check check (outcome in ('CREATE_NEW','MATCH_EXISTING')),
  constraint materialization_operations_status_check check (status in ('PENDING','APPLIED','FAILED')),
  constraint materialization_operations_status_applied_check check (
    (status = 'APPLIED') = (applied_at is not null)
  ),
  constraint materialization_operations_result_exclusive_check check (
    not (resulting_canonical_object_id is not null and resulting_relationship_id is not null)
  ),
  constraint materialization_operations_family_result_check check (
    (decision_family = 'OBJECT' and resulting_relationship_id is null)
    or (decision_family = 'RELATIONSHIP' and resulting_canonical_object_id is null)
  ),
  constraint materialization_operations_fingerprint_format_check
    check (idempotency_fingerprint ~ '^[0-9a-f]{64}$'),
  constraint materialization_operations_organisation_id_unique unique (organisation_id, materialization_operation_id),
  constraint materialization_operations_decision_unique unique (organisation_id, reconciliation_decision_id),
  constraint materialization_operations_decision_fkey
    foreign key (organisation_id, reconciliation_decision_id)
    references gov_repo.reconciliation_decisions (organisation_id, decision_id),
  -- reconciliation_invocations carries no composite (organisation_id,
  -- invocation_id) unique constraint (only a global PK on invocation_id and
  -- a separate unique on (organisation_id, command_id)), so this FK targets
  -- invocation_id alone; tenant match is independently enforced by
  -- gov_repo.materialize_object_reconciliation / _relationship_reconciliation
  -- explicitly checking ri.organisation_id = p_organisation_id before use.
  constraint materialization_operations_invocation_fkey
    foreign key (invocation_id)
    references gov_repo.reconciliation_invocations (invocation_id),
  constraint materialization_operations_object_result_fkey
    foreign key (organisation_id, resulting_canonical_object_id)
    references gov_repo.canonical_objects (organisation_id, canonical_object_id),
  constraint materialization_operations_relationship_result_fkey
    foreign key (organisation_id, resulting_relationship_id)
    references gov_repo.canonical_relationships (organisation_id, relationship_id)
);

comment on table gov_repo.materialization_operations is
  'IMMUTABLE append-only materialization tracking, one row per reconciliation decision that was ever materialized. constraint materialization_operations_decision_unique is the idempotency anchor: gov_repo.materialize_object_reconciliation / gov_repo.materialize_relationship_reconciliation treat a matching (organisation_id, reconciliation_decision_id) as a replay, never a second materialization.';

create index idx_materialization_operations_org on gov_repo.materialization_operations (organisation_id);

-- -----------------------------------------------------------------------------
-- E. MATERIALIZATION LOCKS — private technical concurrency primitive, exactly
--    mirroring gov_repo.reconciliation_command_locks' role: no independent
--    tenant ownership or governance authority. Gates idempotency BEFORE the
--    authoritative materialization_operations row exists, so it carries no FK
--    to it (insert-ordering deadlock) and is intentionally left mutable
--    (no immutability rule) so INSERT ... ON CONFLICT DO NOTHING keeps working.
-- -----------------------------------------------------------------------------

create table gov_repo.materialization_locks (
  organisation_id            uuid        not null references gov_repo.organisations (organisation_id),
  reconciliation_decision_id text        not null,
  idempotency_fingerprint    char(64)    not null,
  created_at                 timestamptz not null default now(),
  constraint materialization_locks_pkey primary key (organisation_id, reconciliation_decision_id)
);
comment on table gov_repo.materialization_locks is
  'Private technical concurrency primitive only: atomically gates one (organisation_id, reconciliation_decision_id) so concurrent materialize_*_reconciliation calls for the same decision produce one logical result. Carries no independent tenant ownership or governance authority beyond that serialization; the authoritative audit trail is gov_repo.materialization_operations.';

-- -----------------------------------------------------------------------------
-- F. OUTBOX EVENT TYPES — extend the closed enum from Governance Persistence
--    V1 with the two materialization event types. This alters a CHECK
--    constraint on an existing table, never the historical migration file.
-- -----------------------------------------------------------------------------

alter table gov_repo.outbox_events drop constraint outbox_events_event_type_check;
alter table gov_repo.outbox_events add constraint outbox_events_event_type_check check (
  event_type in (
    'GOVERNANCE_REVIEW_TRANSITIONED',
    'GOVERNANCE_AUTHORIZATION_EVALUATED',
    'GOVERNANCE_RECONCILIATION_DECIDED',
    'GOVERNANCE_CANONICAL_OBJECT_MATERIALIZED',
    'GOVERNANCE_CANONICAL_RELATIONSHIP_MATERIALIZED'
  )
);

-- -----------------------------------------------------------------------------
-- G. IMMUTABILITY — enforced at the PostgreSQL level, mirroring Governance
--    Persistence V1's own pattern. materialization_locks is deliberately
--    excluded (see comment above).
-- -----------------------------------------------------------------------------

create or replace rule canonical_objects_no_update as
  on update to gov_repo.canonical_objects do instead nothing;
create or replace rule canonical_objects_no_delete as
  on delete to gov_repo.canonical_objects do instead nothing;

create or replace rule canonical_object_source_mappings_no_update as
  on update to gov_repo.canonical_object_source_mappings do instead nothing;
create or replace rule canonical_object_source_mappings_no_delete as
  on delete to gov_repo.canonical_object_source_mappings do instead nothing;

create or replace rule canonical_relationships_no_update as
  on update to gov_repo.canonical_relationships do instead nothing;
create or replace rule canonical_relationships_no_delete as
  on delete to gov_repo.canonical_relationships do instead nothing;

create or replace rule materialization_operations_no_update as
  on update to gov_repo.materialization_operations do instead nothing;
create or replace rule materialization_operations_no_delete as
  on delete to gov_repo.materialization_operations do instead nothing;

-- -----------------------------------------------------------------------------
-- H. ROW LEVEL SECURITY — server-side privileged persistence boundary only,
--    matching Governance Persistence V1 exactly: no authenticated-role
--    policy in this milestone, service_role only, never USING(true) for any
--    future authenticated policy.
-- -----------------------------------------------------------------------------

alter table gov_repo.canonical_objects enable row level security;
alter table gov_repo.canonical_object_source_mappings enable row level security;
alter table gov_repo.canonical_relationships enable row level security;
alter table gov_repo.materialization_operations enable row level security;
alter table gov_repo.materialization_locks enable row level security;

revoke all on table
  gov_repo.canonical_objects,
  gov_repo.canonical_object_source_mappings,
  gov_repo.canonical_relationships,
  gov_repo.materialization_operations,
  gov_repo.materialization_locks
from public, anon, authenticated;

create policy "Service role has full access to canonical_objects" on gov_repo.canonical_objects for all to service_role using (true) with check (true);
create policy "Service role access to canonical_object_source_mappings" on gov_repo.canonical_object_source_mappings for all to service_role using (true) with check (true);
create policy "Service role has full access to canonical_relationships" on gov_repo.canonical_relationships for all to service_role using (true) with check (true);
create policy "Service role has full access to materialization_operations" on gov_repo.materialization_operations for all to service_role using (true) with check (true);
create policy "Service role has full access to materialization_locks" on gov_repo.materialization_locks for all to service_role using (true) with check (true);

-- -----------------------------------------------------------------------------
-- I. TRANSACTIONAL RPCs (Unit of Work). SECURITY INVOKER, explicit
--    search_path, EXECUTE revoked from PUBLIC/anon/authenticated and granted
--    only to service_role — mirrors Governance Persistence V1 exactly.
--
--    Both functions independently re-verify, against gov_repo.
--    reconciliation_decisions / gov_repo.reconciliation_invocations, that:
--      * the decision exists, belongs to the claimed organisation, and its
--        family/outcome match what the caller is asking to materialize;
--      * a matching invocation row exists and actually points back at this
--        decision (defends "decision without matching invocation").
--    The TypeScript adapter is expected to have already independently
--    verified envelope_hash and rehydrated the decision through
--    canonical-contracts before calling either function (defense in depth
--    against a forged/altered decision envelope), but these functions never
--    rely on that alone.
-- -----------------------------------------------------------------------------

create or replace function gov_repo.materialize_object_reconciliation(
  p_organisation_id            uuid,
  p_reconciliation_decision_id text,
  p_invocation_id              text,
  p_outcome                    text,
  p_canonical_object_id        text,
  p_canonical_object_kind      text,
  p_source_connection_id       text,
  p_source_external_type       text,
  p_source_external_id         text,
  p_match_method               text,
  p_idempotency_fingerprint    char(64),
  p_occurred_at                timestamptz
)
returns table (
  replay              boolean,
  status              text,
  canonical_object_id text,
  mapping_id          text
)
language plpgsql
volatile
security invoker
set search_path = 'gov_repo', 'pg_catalog'
as $$
#variable_conflict use_column
declare
  v_won          text;
  v_decision     gov_repo.reconciliation_decisions%rowtype;
  v_invocation   gov_repo.reconciliation_invocations%rowtype;
  v_existing_fp  text;
  v_existing_op  gov_repo.materialization_operations%rowtype;
  v_mapping_id   text;
  v_operation_id text;
  v_payload      jsonb;
begin
  if p_outcome not in ('CREATE_NEW', 'MATCH_EXISTING') then
    raise exception using errcode = '22023', message = 'UNSUPPORTED_MATERIALIZATION_OUTCOME';
  end if;

  select * into v_decision from gov_repo.reconciliation_decisions as rd
    where rd.organisation_id = p_organisation_id and rd.decision_id = p_reconciliation_decision_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'RECONCILIATION_DECISION_NOT_FOUND';
  end if;
  if v_decision.family <> 'OBJECT' or v_decision.outcome <> p_outcome then
    raise exception using errcode = '22023', message = 'DECISION_FAMILY_OR_OUTCOME_MISMATCH';
  end if;
  if v_decision.canonical_object_id is distinct from p_canonical_object_id
     or v_decision.canonical_object_kind is distinct from p_canonical_object_kind then
    raise exception using errcode = '22023', message = 'CANONICAL_IDENTITY_MISMATCH';
  end if;

  select * into v_invocation from gov_repo.reconciliation_invocations as ri
    where ri.organisation_id = p_organisation_id and ri.invocation_id = p_invocation_id;
  if not found or v_invocation.reconciliation_decision_id <> p_reconciliation_decision_id then
    raise exception using errcode = 'P0002', message = 'INVOCATION_DECISION_MISMATCH';
  end if;

  insert into gov_repo.materialization_locks (organisation_id, reconciliation_decision_id, idempotency_fingerprint)
  values (p_organisation_id, p_reconciliation_decision_id, p_idempotency_fingerprint)
  on conflict (organisation_id, reconciliation_decision_id) do nothing
  returning reconciliation_decision_id into v_won;

  if v_won is null then
    -- Another call already claimed this decision. Wait for it to finish
    -- (row lock blocks until the winner commits or aborts), then read the
    -- outcome it produced rather than racing it.
    perform 1 from gov_repo.materialization_locks as ml
      where ml.organisation_id = p_organisation_id and ml.reconciliation_decision_id = p_reconciliation_decision_id
      for share;

    select ml.idempotency_fingerprint into v_existing_fp
      from gov_repo.materialization_locks as ml
      where ml.organisation_id = p_organisation_id and ml.reconciliation_decision_id = p_reconciliation_decision_id;
    if v_existing_fp is distinct from p_idempotency_fingerprint then
      raise exception using
        errcode = '23514',
        message = 'MATERIALIZATION_IDEMPOTENCY_CONFLICT',
        detail = format('reconciliation_decision_id %s already materialized with a different fingerprint', p_reconciliation_decision_id);
    end if;

    select * into v_existing_op from gov_repo.materialization_operations as mo
      where mo.organisation_id = p_organisation_id and mo.reconciliation_decision_id = p_reconciliation_decision_id;
    if not found then
      -- The winner's transaction aborted after taking the lock (which is
      -- itself part of that aborted transaction and was rolled back with
      -- it) yet ours observed a conflict before the abort was visible; this
      -- is a narrow race the caller should simply retry.
      raise exception using errcode = '40001', message = 'MATERIALIZATION_CONCURRENT_ATTEMPT_FAILED';
    end if;

    select csm.mapping_id into v_mapping_id from gov_repo.canonical_object_source_mappings as csm
      where csm.organisation_id = p_organisation_id and csm.created_by_decision_id = p_reconciliation_decision_id;

    return query select true, v_existing_op.status, v_existing_op.resulting_canonical_object_id, v_mapping_id;
    return;
  end if;

  -- We hold the lock uncontested for this decision: perform materialization.
  if p_outcome = 'CREATE_NEW' then
    begin
      insert into gov_repo.canonical_objects (canonical_object_id, organisation_id, kind, created_by_decision_id)
      values (p_canonical_object_id, p_organisation_id, p_canonical_object_kind, p_reconciliation_decision_id);
    exception when unique_violation then
      raise exception using
        errcode = '23505',
        message = 'CANONICAL_OBJECT_IDENTITY_CONFLICT',
        detail = format('canonical_object_id %s already exists under a different decision', p_canonical_object_id);
    end;
  else
    perform 1 from gov_repo.canonical_objects as co
      where co.organisation_id = p_organisation_id
        and co.canonical_object_id = p_canonical_object_id
        and co.kind = p_canonical_object_kind;
    if not found then
      raise exception using errcode = 'P0002', message = 'MATCH_EXISTING_TARGET_NOT_FOUND';
    end if;
  end if;

  v_mapping_id := gen_random_uuid()::text;
  begin
    insert into gov_repo.canonical_object_source_mappings (
      mapping_id, organisation_id, canonical_object_id, canonical_object_kind,
      source_connection_id, source_external_type, source_external_id,
      match_method, created_by_decision_id, valid_from
    ) values (
      v_mapping_id, p_organisation_id, p_canonical_object_id, p_canonical_object_kind,
      p_source_connection_id, p_source_external_type, p_source_external_id,
      p_match_method, p_reconciliation_decision_id, p_occurred_at
    );
  exception when unique_violation then
    raise exception using
      errcode = '23505',
      message = 'SOURCE_IDENTITY_ALREADY_MAPPED',
      detail = 'This source identity is already actively mapped to a different canonical object';
  end;

  v_operation_id := gen_random_uuid()::text;
  insert into gov_repo.materialization_operations (
    materialization_operation_id, organisation_id, reconciliation_decision_id, invocation_id,
    decision_family, outcome, status, idempotency_fingerprint, resulting_canonical_object_id, applied_at
  ) values (
    v_operation_id, p_organisation_id, p_reconciliation_decision_id, p_invocation_id,
    'OBJECT', p_outcome, 'APPLIED', p_idempotency_fingerprint, p_canonical_object_id, p_occurred_at
  );

  v_payload := jsonb_build_object(
    'organisationId', p_organisation_id,
    'reconciliationDecisionId', p_reconciliation_decision_id,
    'materializationOperationId', v_operation_id,
    'canonicalObjectId', p_canonical_object_id,
    'canonicalObjectKind', p_canonical_object_kind,
    'outcome', p_outcome,
    'mappingId', v_mapping_id
  );
  insert into gov_repo.outbox_events (organisation_id, event_type, payload, payload_hash, occurred_at)
  values (
    p_organisation_id, 'GOVERNANCE_CANONICAL_OBJECT_MATERIALIZED', v_payload,
    encode(extensions.digest(convert_to(v_payload::text, 'UTF8'), 'sha256'), 'hex'),
    p_occurred_at
  );

  return query select false, 'APPLIED'::text, p_canonical_object_id, v_mapping_id;
end;
$$;

comment on function gov_repo.materialize_object_reconciliation is
  'Materializes a governed canonical object (CREATE_NEW) or binds a new source to an existing one (MATCH_EXISTING) from an already-persisted, matching-invocation-backed OBJECT-family reconciliation decision, plus its ObjectSourceMapping and a GOVERNANCE_CANONICAL_OBJECT_MATERIALIZED outbox event, atomically. Idempotency is arbitrated first via gov_repo.materialization_locks, mirroring record_authorized_reconciliation''s own pattern. SECURITY INVOKER, service_role only.';

create or replace function gov_repo.materialize_relationship_reconciliation(
  p_organisation_id            uuid,
  p_reconciliation_decision_id text,
  p_invocation_id              text,
  p_outcome                    text,
  p_relationship_id            text,
  p_relationship_state_id      text,
  p_relationship_type          text,
  p_source_canonical_object_id text,
  p_source_kind                text,
  p_target_canonical_object_id text,
  p_target_kind                text,
  p_valid_from                 timestamptz,
  p_recorded_at                timestamptz,
  p_idempotency_fingerprint    char(64)
)
returns table (
  replay          boolean,
  status          text,
  relationship_id text
)
language plpgsql
volatile
security invoker
set search_path = 'gov_repo', 'pg_catalog'
as $$
#variable_conflict use_column
declare
  v_won          text;
  v_decision     gov_repo.reconciliation_decisions%rowtype;
  v_invocation   gov_repo.reconciliation_invocations%rowtype;
  v_existing_fp  text;
  v_existing_op  gov_repo.materialization_operations%rowtype;
  v_operation_id text;
  v_payload      jsonb;
begin
  if p_outcome not in ('CREATE_NEW', 'MATCH_EXISTING') then
    raise exception using errcode = '22023', message = 'UNSUPPORTED_MATERIALIZATION_OUTCOME';
  end if;

  select * into v_decision from gov_repo.reconciliation_decisions as rd
    where rd.organisation_id = p_organisation_id and rd.decision_id = p_reconciliation_decision_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'RECONCILIATION_DECISION_NOT_FOUND';
  end if;
  if v_decision.family <> 'RELATIONSHIP' or v_decision.outcome <> p_outcome then
    raise exception using errcode = '22023', message = 'DECISION_FAMILY_OR_OUTCOME_MISMATCH';
  end if;

  select * into v_invocation from gov_repo.reconciliation_invocations as ri
    where ri.organisation_id = p_organisation_id and ri.invocation_id = p_invocation_id;
  if not found or v_invocation.reconciliation_decision_id <> p_reconciliation_decision_id then
    raise exception using errcode = 'P0002', message = 'INVOCATION_DECISION_MISMATCH';
  end if;

  insert into gov_repo.materialization_locks (organisation_id, reconciliation_decision_id, idempotency_fingerprint)
  values (p_organisation_id, p_reconciliation_decision_id, p_idempotency_fingerprint)
  on conflict (organisation_id, reconciliation_decision_id) do nothing
  returning reconciliation_decision_id into v_won;

  if v_won is null then
    perform 1 from gov_repo.materialization_locks as ml
      where ml.organisation_id = p_organisation_id and ml.reconciliation_decision_id = p_reconciliation_decision_id
      for share;

    select ml.idempotency_fingerprint into v_existing_fp
      from gov_repo.materialization_locks as ml
      where ml.organisation_id = p_organisation_id and ml.reconciliation_decision_id = p_reconciliation_decision_id;
    if v_existing_fp is distinct from p_idempotency_fingerprint then
      raise exception using
        errcode = '23514',
        message = 'MATERIALIZATION_IDEMPOTENCY_CONFLICT',
        detail = format('reconciliation_decision_id %s already materialized with a different fingerprint', p_reconciliation_decision_id);
    end if;

    select * into v_existing_op from gov_repo.materialization_operations as mo
      where mo.organisation_id = p_organisation_id and mo.reconciliation_decision_id = p_reconciliation_decision_id;
    if not found then
      raise exception using errcode = '40001', message = 'MATERIALIZATION_CONCURRENT_ATTEMPT_FAILED';
    end if;

    return query select true, v_existing_op.status, v_existing_op.resulting_relationship_id;
    return;
  end if;

  if p_outcome = 'CREATE_NEW' then
    perform 1 from gov_repo.canonical_objects as src
      where src.organisation_id = p_organisation_id
        and src.canonical_object_id = p_source_canonical_object_id
        and src.kind = p_source_kind;
    if not found then
      raise exception using errcode = 'P0002', message = 'RELATIONSHIP_SOURCE_ENDPOINT_NOT_FOUND';
    end if;

    perform 1 from gov_repo.canonical_objects as tgt
      where tgt.organisation_id = p_organisation_id
        and tgt.canonical_object_id = p_target_canonical_object_id
        and tgt.kind = p_target_kind;
    if not found then
      raise exception using errcode = 'P0002', message = 'RELATIONSHIP_TARGET_ENDPOINT_NOT_FOUND';
    end if;

    begin
      insert into gov_repo.canonical_relationships (
        relationship_id, organisation_id, relationship_state_id, relationship_type,
        source_canonical_object_id, source_kind, target_canonical_object_id, target_kind,
        valid_from, recorded_at, created_by_decision_id
      ) values (
        p_relationship_id, p_organisation_id, p_relationship_state_id, p_relationship_type,
        p_source_canonical_object_id, p_source_kind, p_target_canonical_object_id, p_target_kind,
        p_valid_from, p_recorded_at, p_reconciliation_decision_id
      );
    exception when unique_violation then
      raise exception using
        errcode = '23505',
        message = 'DUPLICATE_GOVERNED_RELATIONSHIP_EDGE',
        detail = 'An active relationship of this type already exists between these endpoints, or this relationship_id already exists under a different decision';
    end;
  else
    perform 1 from gov_repo.canonical_relationships as cr
      where cr.organisation_id = p_organisation_id
        and cr.relationship_id = p_relationship_id
        and cr.relationship_type = p_relationship_type
        and cr.source_canonical_object_id = p_source_canonical_object_id
        and cr.source_kind = p_source_kind
        and cr.target_canonical_object_id = p_target_canonical_object_id
        and cr.target_kind = p_target_kind;
    if not found then
      raise exception using errcode = 'P0002', message = 'MATCH_EXISTING_RELATIONSHIP_NOT_FOUND';
    end if;
  end if;

  v_operation_id := gen_random_uuid()::text;
  insert into gov_repo.materialization_operations (
    materialization_operation_id, organisation_id, reconciliation_decision_id, invocation_id,
    decision_family, outcome, status, idempotency_fingerprint, resulting_relationship_id, applied_at
  ) values (
    v_operation_id, p_organisation_id, p_reconciliation_decision_id, p_invocation_id,
    'RELATIONSHIP', p_outcome, 'APPLIED', p_idempotency_fingerprint, p_relationship_id, p_recorded_at
  );

  v_payload := jsonb_build_object(
    'organisationId', p_organisation_id,
    'reconciliationDecisionId', p_reconciliation_decision_id,
    'materializationOperationId', v_operation_id,
    'relationshipId', p_relationship_id,
    'relationshipType', p_relationship_type,
    'outcome', p_outcome
  );
  insert into gov_repo.outbox_events (organisation_id, event_type, payload, payload_hash, occurred_at)
  values (
    p_organisation_id, 'GOVERNANCE_CANONICAL_RELATIONSHIP_MATERIALIZED', v_payload,
    encode(extensions.digest(convert_to(v_payload::text, 'UTF8'), 'sha256'), 'hex'),
    p_recorded_at
  );

  return query select false, 'APPLIED'::text, p_relationship_id;
end;
$$;

comment on function gov_repo.materialize_relationship_reconciliation is
  'Materializes a governed relationship edge (CREATE_NEW) or acknowledges a bind to an existing one (MATCH_EXISTING) from an already-persisted, matching-invocation-backed RELATIONSHIP-family reconciliation decision, plus a GOVERNANCE_CANONICAL_RELATIONSHIP_MATERIALIZED outbox event, atomically. Both endpoints must already exist in gov_repo.canonical_objects for the same organisation. Idempotency is arbitrated first via gov_repo.materialization_locks. SECURITY INVOKER, service_role only.';

-- -----------------------------------------------------------------------------
-- J. PERMISSIONS — EXECUTE revoked from PUBLIC/anon/authenticated, granted
--    only to service_role. Postgres grants EXECUTE to PUBLIC by default on
--    new functions, so this revoke is mandatory, not optional.
-- -----------------------------------------------------------------------------

revoke all on function gov_repo.materialize_object_reconciliation from public, anon, authenticated;
revoke all on function gov_repo.materialize_relationship_reconciliation from public, anon, authenticated;

grant execute on function gov_repo.materialize_object_reconciliation to service_role;
grant execute on function gov_repo.materialize_relationship_reconciliation to service_role;

commit;
