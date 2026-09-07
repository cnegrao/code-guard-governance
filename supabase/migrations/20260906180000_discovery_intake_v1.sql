-- =============================================================================
-- CODEGUARD AI GOVERNANCE OS
-- Migration: 20260906180000_discovery_intake_v1
-- Domain:    Discovery Intake V1 — connects the existing Discovery Engine
--            (packages/scanner) to the existing Governance Review persistence
--            (Governance Persistence V1) with durable evidence/provenance.
--
-- This migration does NOT redesign packages/scanner, packages/governance-review,
-- or packages/canonical-contracts, and it does NOT alter either historical
-- migration (20260905060000_governance_persistence_v1.sql,
-- 20260906120000_canonical_materialization_v1.sql). It only fills the one gap
-- those milestones deliberately left open: DiscoveryFinding evidence
-- (Evidence / SourceAssertion / AcquisitionRun) existed only in TypeScript
-- memory before a ReviewSubject referencing it could be persisted.
--
-- Naming note: the new durable Evidence table is named
-- gov_repo.discovery_evidence, not gov_repo.evidence — this controlled
-- project's foundational schema (2026-08-18 migrations) already owns
-- gov_repo.evidence as an unrelated compliance/audit evidence-locker
-- concept (verification workflow, chain of custody, retention/
-- classification, referenced by conformity_assessments/ict_incidents/
-- ai_systems/evidence_files). Discovered only via this migration's own
-- fail-closed preflight check refusing to apply against the real database;
-- fixed by renaming the new table, never by touching the pre-existing one.
--
-- Hard gate enforced here: gov_repo.review_subject_assertions and
-- gov_repo.review_subject_evidence (Governance Persistence V1) gain composite
-- FKs into the new gov_repo.source_assertions / gov_repo.discovery_evidence
-- tables, so gov_repo.create_review_subject can never durably succeed for an
-- assertionId/evidenceId that was not itself already durably persisted.
--
-- Machine discovery authority ceiling is unchanged by this migration: it adds
-- no path from a DiscoveryFinding to CONFIRMED, CERTIFIED, canonical object
-- materialization, or canonical relationship materialization. It only makes
-- DETECTED/PROPOSED durable and evidence-backed.
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
      message = 'Cannot apply discovery intake migration.',
      hint = 'Schema gov_repo does not exist; foundation migrations must run first.';
  end if;

  if to_regclass('gov_repo.review_subjects') is null
     or to_regclass('gov_repo.review_subject_assertions') is null
     or to_regclass('gov_repo.review_subject_evidence') is null
  then
    raise exception using
      errcode = '3F000',
      message = 'Cannot apply discovery intake migration.',
      hint = 'Governance Persistence V1 tables are missing; that migration must run first.';
  end if;

  if to_regclass('gov_repo.acquisition_runs') is not null
     or to_regclass('gov_repo.discovery_evidence') is not null
     or to_regclass('gov_repo.source_assertions') is not null
     or to_regclass('gov_repo.source_assertion_evidence') is not null
  then
    raise exception using
      errcode = '42P07',
      message = 'Cannot apply discovery intake migration.',
      hint = 'One or more target tables already exist; resolve the naming collision before retrying.';
  end if;
end;
$preflight$;

-- -----------------------------------------------------------------------------
-- A. ACQUISITION RUNS — durable projection of one scanner AcquisitionRun
--    (packages/canonical-contracts AcquisitionRun), plus the executive scan
--    counts required by the Discovery Intake application service's result.
--    This is the one mutable table in this migration (mirrors
--    gov_repo.review_subjects' own role): started RUNNING, completed once
--    with its terminal status and final counts.
-- -----------------------------------------------------------------------------

create table gov_repo.acquisition_runs (
  run_id                   text        primary key,
  organisation_id          uuid        not null references gov_repo.organisations (organisation_id),
  source_connection_id     text        not null,
  source_system_id         text        not null,
  adapter_name             text        not null,
  adapter_version          text        not null,
  mode                     text        not null,
  status                   text        not null,
  source_version           text,
  checkpoint               text,
  started_at               timestamptz not null,
  completed_at             timestamptz,
  artifacts_scanned        integer     not null default 0,
  findings_detected        integer     not null default 0,
  object_candidates        integer     not null default 0,
  relationship_candidates  integer     not null default 0,
  review_subjects_created  integer     not null default 0,
  proposals_created        integer     not null default 0,
  already_governed         integer     not null default 0,
  item_failures            integer     not null default 0,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  constraint acquisition_runs_mode_check check (mode in ('FULL','INCREMENTAL')),
  constraint acquisition_runs_status_check
    check (status in ('PENDING','RUNNING','SUCCEEDED','PARTIAL','FAILED','CANCELLED')),
  constraint acquisition_runs_completed_at_check check (
    (status in ('SUCCEEDED','PARTIAL','FAILED','CANCELLED')) = (completed_at is not null)
  ),
  constraint acquisition_runs_counts_nonnegative check (
    artifacts_scanned >= 0 and findings_detected >= 0 and object_candidates >= 0
    and relationship_candidates >= 0 and review_subjects_created >= 0
    and proposals_created >= 0 and already_governed >= 0 and item_failures >= 0
  ),
  constraint acquisition_runs_organisation_id_unique unique (organisation_id, run_id)
);

comment on table gov_repo.acquisition_runs is
  'Durable projection of one scanner AcquisitionRun (packages/canonical-contracts AcquisitionRun, produced by packages/scanner/src/discovery/provenance.ts) plus the executive scan counts the Discovery Intake application service reports. Started RUNNING by gov_repo.start_acquisition_run, completed exactly once by gov_repo.complete_acquisition_run with a terminal status and final counts. Never invents scan identity: run_id is the domain-assigned AcquisitionRunId.';

create index idx_acquisition_runs_org on gov_repo.acquisition_runs (organisation_id);
create index idx_acquisition_runs_connection on gov_repo.acquisition_runs (organisation_id, source_connection_id);

create trigger trg_acquisition_runs_updated_at
  before update on gov_repo.acquisition_runs
  for each row execute function gov_repo.set_updated_at();

-- -----------------------------------------------------------------------------
-- B. DISCOVERY EVIDENCE — durable content for canonical-contracts' Evidence,
--    immutable once written. Closes the gap Governance Persistence V1 left
--    open: that migration persists only EvidenceId membership
--    (review_subject_evidence), never the Evidence content itself. Named
--    discovery_evidence (not evidence) because this controlled project's
--    foundational schema already owns gov_repo.evidence as an unrelated
--    compliance/audit evidence-locker concept.
-- -----------------------------------------------------------------------------

create table gov_repo.discovery_evidence (
  organisation_id   uuid        not null references gov_repo.organisations (organisation_id),
  evidence_id       text        not null,
  handling          text        not null,
  captured_at       timestamptz not null,
  content_hash      text        not null,
  contract_version  text        not null,
  envelope          jsonb       not null,
  envelope_hash     char(64)    not null,
  created_at        timestamptz not null default now(),
  constraint discovery_evidence_pkey primary key (organisation_id, evidence_id),
  constraint discovery_evidence_handling_check check (handling in ('HASH_ONLY','REDACTED','NON_SENSITIVE')),
  constraint discovery_evidence_envelope_hash_format_check check (envelope_hash ~ '^[0-9a-f]{64}$')
);

comment on table gov_repo.discovery_evidence is
  'IMMUTABLE durable content for one canonical-contracts Evidence (packages/canonical-contracts Evidence), scoped to Discovery Intake findings only — distinct from the pre-existing gov_repo.evidence compliance/audit evidence-locker table. Primary key is (organisation_id, evidence_id) rather than a bare evidence_id: evidenceId is a scanner-generated content hash with no tenant concept at all (packages/scanner is intentionally organisation-agnostic), so two different tenants scanning structurally identical content can legitimately produce the identical evidenceId — a bare global primary key would let one tenant''s write silently collide with another''s. envelope is the authoritative full Evidence object; the adapter recomputes envelope_hash on every read and rejects a mismatch, matching gov_repo.reconciliation_decisions'' own re-verification discipline. Never referenced by a ReviewSubject before this row exists (see review_subject_evidence_evidence_fkey below).';

create index idx_discovery_evidence_org on gov_repo.discovery_evidence (organisation_id);

-- -----------------------------------------------------------------------------
-- C. SOURCE ASSERTIONS — durable content for canonical-contracts'
--    SourceAssertion, immutable once written. Tenant/source/run identity is
--    kept relational (never buried only in JSON), mirroring
--    gov_repo.review_subjects' own source_connection_id/source_external_type/
--    source_external_id columns.
-- -----------------------------------------------------------------------------

create table gov_repo.source_assertions (
  organisation_id          uuid        not null references gov_repo.organisations (organisation_id),
  assertion_id             text        not null,
  run_id                   text        not null,
  source_connection_id     text        not null,
  source_external_type     text        not null,
  source_external_id       text        not null,
  snapshot_id              text,
  snapshot_content_hash    text,
  snapshot_observed_at     timestamptz,
  snapshot_source_version  text,
  method_code              text        not null,
  method_version           text,
  trust_state              text        not null,
  confidence               double precision,
  observed_at              timestamptz not null,
  synced_at                timestamptz,
  recorded_at              timestamptz not null,
  contract_version         text        not null,
  envelope                 jsonb       not null,
  envelope_hash            char(64)    not null,
  created_at               timestamptz not null default now(),
  constraint source_assertions_trust_state_check
    check (trust_state in ('INFERRED','DECLARED','IMPORTED','OBSERVED','VALIDATED')),
  constraint source_assertions_confidence_range_check
    check (confidence is null or (confidence >= 0 and confidence <= 1)),
  constraint source_assertions_envelope_hash_format_check check (envelope_hash ~ '^[0-9a-f]{64}$'),
  constraint source_assertions_pkey primary key (organisation_id, assertion_id),
  constraint source_assertions_run_fkey
    foreign key (organisation_id, run_id)
    references gov_repo.acquisition_runs (organisation_id, run_id)
);

comment on table gov_repo.source_assertions is
  'IMMUTABLE durable content for one canonical-contracts SourceAssertion (packages/canonical-contracts SourceAssertion). Primary key is (organisation_id, assertion_id) for the same reason as gov_repo.discovery_evidence: assertionId is a scanner-generated content hash with no tenant concept, so a bare global primary key would risk a cross-tenant collision. envelope is the authoritative full SourceAssertion object (including snapshot/effectivePeriod/sourceAttribute/validation where present); envelope_hash is independently reverified on every read. Every assertion belongs to exactly one already-durable gov_repo.acquisition_runs row, never a run that exists only in memory.';

create index idx_source_assertions_org on gov_repo.source_assertions (organisation_id);
create index idx_source_assertions_run on gov_repo.source_assertions (organisation_id, run_id);
create index idx_source_assertions_source
  on gov_repo.source_assertions (organisation_id, source_connection_id, source_external_type, source_external_id);

create table gov_repo.source_assertion_evidence (
  organisation_id uuid not null,
  assertion_id    text not null,
  evidence_id     text not null,
  -- organisation_id is part of the primary key (not just assertion_id +
  -- evidence_id) for the same tenant-collision reason as
  -- gov_repo.discovery_evidence / gov_repo.source_assertions: neither
  -- assertion_id nor evidence_id alone carries any tenant concept, so two
  -- different tenants could otherwise collide on the identical
  -- (assertion_id, evidence_id) membership pair.
  constraint source_assertion_evidence_pkey primary key (organisation_id, assertion_id, evidence_id),
  constraint source_assertion_evidence_assertion_fkey
    foreign key (organisation_id, assertion_id)
    references gov_repo.source_assertions (organisation_id, assertion_id),
  constraint source_assertion_evidence_evidence_fkey
    foreign key (organisation_id, evidence_id)
    references gov_repo.discovery_evidence (organisation_id, evidence_id)
);
comment on table gov_repo.source_assertion_evidence is
  'Normalized EvidenceId membership for one immutable SourceAssertion. The evidence_id FK means an assertion can never durably cite evidence that was not itself already durably persisted.';
create index idx_source_assertion_evidence_org on gov_repo.source_assertion_evidence (organisation_id);

-- -----------------------------------------------------------------------------
-- D. HARD GATE — a persisted ReviewSubject must never point to an EvidenceId
--    or SourceAssertionId that exists only in TypeScript memory. Adds
--    composite FKs to the two Governance Persistence V1 membership tables
--    (never editing that historical migration file); this is a pure ADD
--    CONSTRAINT, never a destructive statement of any kind.
--
--    Added NOT VALID: this controlled project already carries real
--    review_subject_assertions/review_subject_evidence rows from the prior
--    Governance Persistence V1 / Canonical Materialization V1 controlled
--    runtime validations, referencing synthetic test assertion/evidence ids
--    that predate this migration and were never meant to be durable
--    Evidence/SourceAssertion content. NOT VALID enforces this FK for every
--    row inserted or updated from this migration forward (a real,
--    unconditional hard gate for all new Discovery Intake activity) without
--    requiring that pre-existing, unrelated historical test data satisfy an
--    invariant introduced after it was written. Deleting that prior
--    milestones' test/audit data was deliberately avoided rather than done
--    silently as a side effect of this migration.
-- -----------------------------------------------------------------------------

alter table gov_repo.review_subject_assertions
  add constraint review_subject_assertions_assertion_fkey
  foreign key (organisation_id, assertion_id)
  references gov_repo.source_assertions (organisation_id, assertion_id)
  not valid;

alter table gov_repo.review_subject_evidence
  add constraint review_subject_evidence_evidence_fkey
  foreign key (organisation_id, evidence_id)
  references gov_repo.discovery_evidence (organisation_id, evidence_id)
  not valid;

comment on constraint review_subject_assertions_assertion_fkey on gov_repo.review_subject_assertions is
  'Discovery Intake V1 hard gate: gov_repo.create_review_subject can only durably succeed for an assertionId that is already a row in gov_repo.source_assertions. No assertion may exist only in TypeScript memory once referenced by a persisted ReviewSubject.';
comment on constraint review_subject_evidence_evidence_fkey on gov_repo.review_subject_evidence is
  'Discovery Intake V1 hard gate: gov_repo.create_review_subject can only durably succeed for an evidenceId that is already a row in gov_repo.discovery_evidence. No evidence may exist only in TypeScript memory once referenced by a persisted ReviewSubject.';

-- -----------------------------------------------------------------------------
-- E. IMMUTABILITY — Evidence, SourceAssertion, and their membership are
--    write-once, mirroring Governance Persistence V1's own pattern.
--    acquisition_runs is deliberately excluded (see comment on section A):
--    it is the one mutable projection this migration adds, exactly like
--    gov_repo.review_subjects itself.
-- -----------------------------------------------------------------------------

create or replace rule discovery_evidence_no_update as
  on update to gov_repo.discovery_evidence do instead nothing;
create or replace rule discovery_evidence_no_delete as
  on delete to gov_repo.discovery_evidence do instead nothing;

create or replace rule source_assertions_no_update as
  on update to gov_repo.source_assertions do instead nothing;
create or replace rule source_assertions_no_delete as
  on delete to gov_repo.source_assertions do instead nothing;

create or replace rule source_assertion_evidence_no_update as
  on update to gov_repo.source_assertion_evidence do instead nothing;
create or replace rule source_assertion_evidence_no_delete as
  on delete to gov_repo.source_assertion_evidence do instead nothing;

-- -----------------------------------------------------------------------------
-- F. ROW LEVEL SECURITY — server-side privileged persistence boundary only,
--    matching Governance Persistence V1 / Canonical Materialization V1
--    exactly: no authenticated-role policy in this milestone, service_role
--    only, never USING(true) for any future authenticated policy.
-- -----------------------------------------------------------------------------

alter table gov_repo.acquisition_runs enable row level security;
alter table gov_repo.discovery_evidence enable row level security;
alter table gov_repo.source_assertions enable row level security;
alter table gov_repo.source_assertion_evidence enable row level security;

revoke all on table
  gov_repo.acquisition_runs,
  gov_repo.discovery_evidence,
  gov_repo.source_assertions,
  gov_repo.source_assertion_evidence
from public, anon, authenticated;

create policy "Service role has full access to acquisition_runs" on gov_repo.acquisition_runs for all to service_role using (true) with check (true);
create policy "Service role has full access to discovery_evidence" on gov_repo.discovery_evidence for all to service_role using (true) with check (true);
create policy "Service role has full access to source_assertions" on gov_repo.source_assertions for all to service_role using (true) with check (true);
create policy "Service role access to source_assertion_evidence" on gov_repo.source_assertion_evidence for all to service_role using (true) with check (true);

-- -----------------------------------------------------------------------------
-- G. TRANSACTIONAL RPCs (Unit of Work). SECURITY INVOKER, explicit
--    search_path, EXECUTE revoked from PUBLIC/anon/authenticated and granted
--    only to service_role — mirrors Governance Persistence V1 exactly.
-- -----------------------------------------------------------------------------

-- G.1 — Idempotent start of one AcquisitionRun at RUNNING.
create or replace function gov_repo.start_acquisition_run(
  p_run_id               text,
  p_organisation_id      uuid,
  p_source_connection_id text,
  p_source_system_id     text,
  p_adapter_name         text,
  p_adapter_version      text,
  p_mode                 text,
  p_source_version       text,
  p_checkpoint           text,
  p_started_at           timestamptz
)
returns table (
  replay  boolean,
  run_id  text,
  status  text
)
language plpgsql
volatile
security invoker
set search_path = 'gov_repo', 'pg_catalog'
as $$
#variable_conflict use_column
declare
  v_inserted gov_repo.acquisition_runs%rowtype;
  v_existing gov_repo.acquisition_runs%rowtype;
begin
  if p_run_id is null or btrim(p_run_id) = '' then
    raise exception using errcode = '22004', message = 'run_id is required';
  end if;

  insert into gov_repo.acquisition_runs as ar (
    run_id, organisation_id, source_connection_id, source_system_id,
    adapter_name, adapter_version, mode, status, source_version, checkpoint, started_at
  ) values (
    p_run_id, p_organisation_id, p_source_connection_id, p_source_system_id,
    p_adapter_name, p_adapter_version, p_mode, 'RUNNING', p_source_version, p_checkpoint, p_started_at
  )
  on conflict (run_id) do nothing
  returning ar.* into v_inserted;

  if found then
    return query select false, v_inserted.run_id, v_inserted.status;
    return;
  end if;

  select * into v_existing from gov_repo.acquisition_runs as ar2 where ar2.run_id = p_run_id;
  if v_existing.organisation_id is distinct from p_organisation_id
     or v_existing.source_connection_id is distinct from p_source_connection_id
     or v_existing.source_system_id is distinct from p_source_system_id
     or v_existing.adapter_name is distinct from p_adapter_name
     or v_existing.adapter_version is distinct from p_adapter_version
     or v_existing.mode is distinct from p_mode
     or v_existing.started_at is distinct from p_started_at
  then
    raise exception using
      errcode = '23505',
      message = 'ACQUISITION_RUN_ID_CONFLICT',
      detail = format('run_id %s already exists with different content', p_run_id);
  end if;

  return query select true, v_existing.run_id, v_existing.status;
end;
$$;

comment on function gov_repo.start_acquisition_run is
  'Idempotent start of one AcquisitionRun at RUNNING. Same run_id with identical content replays (replay=true); same run_id with different content fails closed (23505). SECURITY INVOKER, service_role only.';

-- G.2 — Idempotent completion of one AcquisitionRun with its terminal status
-- and final executive counts. Only valid from RUNNING/PENDING; already-terminal
-- with identical content replays, with different content fails closed.
create or replace function gov_repo.complete_acquisition_run(
  p_run_id                  text,
  p_organisation_id         uuid,
  p_status                  text,
  p_completed_at            timestamptz,
  p_artifacts_scanned       integer,
  p_findings_detected       integer,
  p_object_candidates       integer,
  p_relationship_candidates integer,
  p_review_subjects_created integer,
  p_proposals_created       integer,
  p_already_governed        integer,
  p_item_failures           integer
)
returns table (
  replay  boolean,
  run_id  text,
  status  text
)
language plpgsql
volatile
security invoker
set search_path = 'gov_repo', 'pg_catalog'
as $$
#variable_conflict use_column
declare
  v_run gov_repo.acquisition_runs%rowtype;
begin
  if p_status not in ('SUCCEEDED','PARTIAL','FAILED','CANCELLED') then
    raise exception using errcode = '22023', message = 'UNSUPPORTED_ACQUISITION_RUN_TERMINAL_STATUS';
  end if;

  select * into v_run from gov_repo.acquisition_runs as ar where ar.run_id = p_run_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = format('Acquisition run %s not found', p_run_id);
  end if;
  if v_run.organisation_id is distinct from p_organisation_id then
    raise exception using errcode = '42501', message = 'Cross-tenant acquisition run completion rejected';
  end if;

  if v_run.status not in ('PENDING','RUNNING') then
    if v_run.status is distinct from p_status
       or v_run.completed_at is distinct from p_completed_at
       or v_run.artifacts_scanned is distinct from p_artifacts_scanned
       or v_run.findings_detected is distinct from p_findings_detected
       or v_run.object_candidates is distinct from p_object_candidates
       or v_run.relationship_candidates is distinct from p_relationship_candidates
       or v_run.review_subjects_created is distinct from p_review_subjects_created
       or v_run.proposals_created is distinct from p_proposals_created
       or v_run.already_governed is distinct from p_already_governed
       or v_run.item_failures is distinct from p_item_failures
    then
      raise exception using
        errcode = '23514',
        message = 'ACQUISITION_RUN_COMPLETION_CONFLICT',
        detail = format('run_id %s was already completed with different content', p_run_id);
    end if;

    return query select true, v_run.run_id, v_run.status;
    return;
  end if;

  update gov_repo.acquisition_runs as ar set
    status = p_status,
    completed_at = p_completed_at,
    artifacts_scanned = p_artifacts_scanned,
    findings_detected = p_findings_detected,
    object_candidates = p_object_candidates,
    relationship_candidates = p_relationship_candidates,
    review_subjects_created = p_review_subjects_created,
    proposals_created = p_proposals_created,
    already_governed = p_already_governed,
    item_failures = p_item_failures
  where ar.run_id = p_run_id;

  return query select false, p_run_id, p_status;
end;
$$;

comment on function gov_repo.complete_acquisition_run is
  'Idempotent completion of one AcquisitionRun (RUNNING/PENDING -> terminal status) with its final executive scan counts. An already-terminal run with identical content replays; different content fails closed (23514). SECURITY INVOKER, service_role only.';

-- G.3 — Idempotent durable persistence of one Evidence.
create or replace function gov_repo.record_discovery_evidence(
  p_evidence_id      text,
  p_organisation_id  uuid,
  p_handling         text,
  p_captured_at      timestamptz,
  p_content_hash     text,
  p_contract_version text,
  p_envelope         jsonb,
  p_envelope_hash    char(64)
)
returns table (
  replay       boolean,
  evidence_id  text
)
language plpgsql
volatile
security invoker
set search_path = 'gov_repo', 'pg_catalog'
as $$
begin
  if p_evidence_id is null or btrim(p_evidence_id) = '' then
    raise exception using errcode = '22004', message = 'evidence_id is required';
  end if;

  -- evidenceId is a scanner-generated content hash of exactly the fields
  -- that make two observations semantically the same match (source
  -- connection, locator, detection method, match position/content); it
  -- deliberately excludes the wall-clock moment the match was captured.
  -- Re-scanning byte-identical content at a later real time therefore
  -- legitimately reproduces the same evidence_id with a different
  -- captured_at/envelope, and that must be a plain idempotent replay, never
  -- a content conflict. First insert wins; a later call for the same
  -- (organisation_id, evidence_id) is always a no-op replay of the
  -- already-durable row, exactly as gov_repo.review_subjects treats
  -- detected_at as identity-bearing while this table does not.
  --
  -- gov_repo.discovery_evidence is immutable via a rewrite RULE
  -- (discovery_evidence_no_update), and PostgreSQL disallows
  -- INSERT ... ON CONFLICT on any table protected by a rewrite RULE. This
  -- uses the same check-then-insert-with-exception-handler pattern already
  -- established in this schema for exactly this situation (see
  -- gov_repo.record_authorization_decision), instead of ON CONFLICT.
  begin
    insert into gov_repo.discovery_evidence (
      organisation_id, evidence_id, handling, captured_at, content_hash, contract_version, envelope, envelope_hash
    ) values (
      p_organisation_id, p_evidence_id, p_handling, p_captured_at, p_content_hash, p_contract_version, p_envelope, p_envelope_hash
    );
    return query select false, p_evidence_id;
    return;
  exception
    when unique_violation then
      return query select true, p_evidence_id;
      return;
  end;
end;
$$;

comment on function gov_repo.record_discovery_evidence is
  'Idempotent durable persistence of one canonical-contracts Evidence, tenant-scoped by (organisation_id, evidence_id). A reused evidence_id for the same tenant always replays (first insert wins; the wall-clock captured_at is not identity-bearing) — a different tenant reusing the identical tenant-agnostic evidence_id gets its own independent row rather than any conflict or collision. Uses a check-then-insert-with-exception-handler (not ON CONFLICT) because the table is immutable via a rewrite RULE. SECURITY INVOKER, service_role only.';

-- G.4 — Idempotent durable persistence of one SourceAssertion plus its
-- normalized evidence membership. Every cited evidence_id must already exist
-- in gov_repo.discovery_evidence (source_assertion_evidence_evidence_fkey),
-- so this call must always follow gov_repo.record_discovery_evidence for the
-- same item, never precede or replace it.
create or replace function gov_repo.record_discovery_source_assertion(
  p_assertion_id            text,
  p_organisation_id         uuid,
  p_run_id                  text,
  p_source_connection_id    text,
  p_source_external_type    text,
  p_source_external_id      text,
  p_snapshot_id             text,
  p_snapshot_content_hash   text,
  p_snapshot_observed_at    timestamptz,
  p_snapshot_source_version text,
  p_method_code             text,
  p_method_version          text,
  p_trust_state             text,
  p_confidence              double precision,
  p_observed_at             timestamptz,
  p_synced_at               timestamptz,
  p_recorded_at             timestamptz,
  p_evidence_ids            text[],
  p_contract_version        text,
  p_envelope                jsonb,
  p_envelope_hash           char(64)
)
returns table (
  replay        boolean,
  assertion_id  text
)
language plpgsql
volatile
security invoker
set search_path = 'gov_repo', 'pg_catalog'
as $$
begin
  if p_assertion_id is null or btrim(p_assertion_id) = '' then
    raise exception using errcode = '22004', message = 'assertion_id is required';
  end if;

  -- Same replay posture as gov_repo.record_discovery_evidence and for the
  -- identical reason: assertionId excludes observedAt/recordedAt from its
  -- own identity, so a rescan of unchanged content reproduces the same
  -- assertion_id with different wall-clock fields — a plain replay, not a
  -- conflict. Tenant-scoped by (organisation_id, assertion_id).
  --
  -- gov_repo.source_assertions is immutable via a rewrite RULE
  -- (source_assertions_no_update), and PostgreSQL disallows
  -- INSERT ... ON CONFLICT on any table protected by a rewrite RULE. Uses
  -- the same check-then-insert-with-exception-handler pattern as
  -- gov_repo.record_discovery_evidence / gov_repo.record_authorization_decision
  -- instead of ON CONFLICT. The membership insert only ever runs alongside
  -- the winning (non-replayed) insert, inside the same nested block: on a
  -- genuine replay, unique_violation is raised by the assertion insert
  -- itself before the membership insert is ever reached.
  begin
    insert into gov_repo.source_assertions (
      organisation_id, assertion_id, run_id, source_connection_id, source_external_type, source_external_id,
      snapshot_id, snapshot_content_hash, snapshot_observed_at, snapshot_source_version,
      method_code, method_version, trust_state, confidence, observed_at, synced_at, recorded_at,
      contract_version, envelope, envelope_hash
    ) values (
      p_organisation_id, p_assertion_id, p_run_id, p_source_connection_id, p_source_external_type, p_source_external_id,
      p_snapshot_id, p_snapshot_content_hash, p_snapshot_observed_at, p_snapshot_source_version,
      p_method_code, p_method_version, p_trust_state, p_confidence, p_observed_at, p_synced_at, p_recorded_at,
      p_contract_version, p_envelope, p_envelope_hash
    );

    insert into gov_repo.source_assertion_evidence (organisation_id, assertion_id, evidence_id)
    select p_organisation_id, p_assertion_id, unnested.value
    from unnest(coalesce(p_evidence_ids, '{}')) as unnested(value);

    return query select false, p_assertion_id;
    return;
  exception
    when unique_violation then
      return query select true, p_assertion_id;
      return;
  end;
end;
$$;

comment on function gov_repo.record_discovery_source_assertion is
  'Idempotent durable persistence of one canonical-contracts SourceAssertion plus normalized evidence membership, tenant-scoped by (organisation_id, assertion_id). A reused assertion_id for the same tenant always replays (first insert wins, evidence membership is only ever inserted once, alongside the winning insert). Every evidence_id must already exist in gov_repo.discovery_evidence for this tenant. Uses a check-then-insert-with-exception-handler (not ON CONFLICT) because the table is immutable via a rewrite RULE. SECURITY INVOKER, service_role only.';

-- -----------------------------------------------------------------------------
-- H. PERMISSIONS — EXECUTE revoked from PUBLIC/anon/authenticated, granted
--    only to service_role. Postgres grants EXECUTE to PUBLIC by default on
--    new functions, so this revoke is mandatory, not optional.
-- -----------------------------------------------------------------------------

revoke all on function gov_repo.start_acquisition_run from public, anon, authenticated;
revoke all on function gov_repo.complete_acquisition_run from public, anon, authenticated;
revoke all on function gov_repo.record_discovery_evidence from public, anon, authenticated;
revoke all on function gov_repo.record_discovery_source_assertion from public, anon, authenticated;

grant execute on function gov_repo.start_acquisition_run to service_role;
grant execute on function gov_repo.complete_acquisition_run to service_role;
grant execute on function gov_repo.record_discovery_evidence to service_role;
grant execute on function gov_repo.record_discovery_source_assertion to service_role;

commit;
