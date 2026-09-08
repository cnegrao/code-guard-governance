-- =============================================================================
-- CODEGUARD AI GOVERNANCE OS
-- Migration: 20260908120000_agent_version_technical_profile_persistence_v1
-- Domain:    Technical Profile Persistence V1 (ADR-GOVIA-TECHNICAL-PROFILE-
--            PERSISTENCE-v1) — the FIRST instance of the global typed,
--            normalized, per-canonical-object-kind TechnicalProfile
--            persistence pattern, implemented here only for
--            AgentVersionTechnicalProfile (packages/canonical-contracts
--            contracts.ts:1096-1112). The other seven frozen *TechnicalProfile
--            contracts (Model/Tool/MCP/API/Prompt/KnowledgeBase/Skill) are
--            NOT implemented by this migration — they follow the identical
--            pattern established here only when their own roadmap milestones
--            require it (see the ADR).
--
-- This migration does NOT alter canonical_objects, canonical_relationships,
-- materialization_operations, materialization_locks, discovery_findings, or
-- discovery_candidates (all from prior, historical migrations). It is purely
-- additive: two new table families (pre-canonical proposal, canonical
-- profile) plus one new narrowly-scoped materialization RPC.
--
-- Architectural boundary enforced throughout: CANONICAL IDENTITY (gov_repo.
-- canonical_objects) != CANONICAL TECHNICAL PROFILE (this migration). No
-- table here ever mutates canonical_objects, and no function here can ever
-- create a canonical object or relationship of any kind.
--
-- Every semantic value column below is a direct, unrenamed mapping of the
-- frozen AgentVersionTechnicalProfile / AgentVersionTechnicalProfileSupport
-- contract fields — never a generic JSONB/EAV value store (GOVIA-L0L16-
-- CIA-v1.0.md §4: "Generic JSON/EAV never replaces modeled enterprise
-- semantics").
--
-- No production deployment is authorized by this migration. Controlled
-- runtime validation, if any, follows the same disposable-project
-- convention as prior migrations in this history.
-- =============================================================================

begin;

do $preflight$
begin
  if to_regnamespace('gov_repo') is null then
    raise exception using
      errcode = '3F000',
      message = 'Cannot apply agent version technical profile persistence migration.',
      hint = 'Schema gov_repo does not exist; foundation migrations must run first.';
  end if;

  if to_regclass('gov_repo.canonical_objects') is null
     or to_regclass('gov_repo.canonical_object_source_mappings') is null
     or to_regclass('gov_repo.discovery_candidates') is null
     or to_regclass('gov_repo.discovery_evidence') is null
     or to_regclass('gov_repo.source_assertions') is null
     or to_regclass('gov_repo.outbox_events') is null
  then
    raise exception using
      errcode = '3F000',
      message = 'Cannot apply agent version technical profile persistence migration.',
      hint = 'Canonical Materialization V1 / Discovery Governance Input Persistence V1 tables are missing; those migrations must run first.';
  end if;

  if to_regclass('gov_repo.agent_version_technical_profile_proposals') is not null
     or to_regclass('gov_repo.agent_version_technical_profiles') is not null
  then
    raise exception using
      errcode = '42P07',
      message = 'Cannot apply agent version technical profile persistence migration.',
      hint = 'One or more target tables already exist; resolve the naming collision before retrying.';
  end if;
end;
$preflight$;

-- Shared CHECK vocabulary for both proposal and canonical field-support
-- tables: the exact five AgentVersionTechnicalProfileSupport keys, spelled
-- identically to the frozen TypeScript contract field names (never renamed
-- for database convenience — ADR Decision D). No arbitrary field name can
-- ever be inserted into either support table.
--
--   'behaviorFingerprint' | 'buildReference' | 'runtimeFrameworkReference'
--   | 'entrypointReference' | 'configurationReference'

-- -----------------------------------------------------------------------------
-- A. PRE-CANONICAL PROPOSAL — durable, typed, content-addressed
--    AgentVersionTechnicalProfile proposal, associated with an already-durable
--    NormalizedAgentVersionCandidate (gov_repo.discovery_candidates, candidate_kind
--    = 'AGENT_VERSION'). This is NOT a new CanonicalObjectKind and never
--    creates canonical truth by itself (ADR Decision C).
-- -----------------------------------------------------------------------------

create table gov_repo.agent_version_technical_profile_proposals (
  organisation_id                     uuid        not null references gov_repo.organisations (organisation_id),
  proposal_id                         text        not null,
  agent_version_candidate_id          text        not null,
  behavior_fingerprint_algorithm      text        not null,
  behavior_fingerprint_schema_version text        not null,
  behavior_fingerprint_value          text        not null,
  build_reference                     text,
  runtime_framework_reference         text,
  entrypoint_reference                text,
  configuration_reference             text,
  contract_version                    text        not null,
  created_at                          timestamptz not null default now(),
  constraint agent_version_technical_profile_proposals_pkey primary key (organisation_id, proposal_id),
  constraint agent_version_technical_profile_proposals_candidate_fkey
    foreign key (organisation_id, agent_version_candidate_id)
    references gov_repo.discovery_candidates (organisation_id, candidate_id)
);

comment on table gov_repo.agent_version_technical_profile_proposals is
  'IMMUTABLE durable content for one typed AgentVersionTechnicalProfile proposal (packages/canonical-contracts AgentVersionTechnicalProfile, contracts.ts:1104-1112), content-addressed by proposal_id so an identical rescan always replays the same row. Never a canonical object, never certified by its own existence, never governance authority — see gov_repo.materialize_agent_version_technical_profile for the only path from here to a governed canonical profile. build_reference/entrypoint_reference/configuration_reference are nullable: absence means UNKNOWN (no evidence observed for this L4 Round 1 scanner), never FALSE.';

comment on constraint agent_version_technical_profile_proposals_candidate_fkey on gov_repo.agent_version_technical_profile_proposals is
  'The proposal must reference an already-durable NormalizedAgentVersionCandidate row. The FK does not itself constrain candidate_kind = AGENT_VERSION (checked explicitly by gov_repo.record_agent_version_technical_profile_proposal below, mirroring gov_repo.record_discovery_candidate''s own finding/candidate consistency check).';

create index idx_agent_version_technical_profile_proposals_org
  on gov_repo.agent_version_technical_profile_proposals (organisation_id);
create index idx_agent_version_technical_profile_proposals_candidate
  on gov_repo.agent_version_technical_profile_proposals (organisation_id, agent_version_candidate_id);

-- Constraint/index names on these two tables use the "avtp_proposal_field_*"
-- abbreviation (AgentVersionTechnicalProfile) instead of the full table name
-- as their prefix: the full table name is already 57/55 bytes, leaving too
-- little room under PostgreSQL's 63-byte NAMEDATALEN limit for a
-- self-documenting suffix (_field_check/_proposal_fkey/_assertion_fkey/
-- _evidence_fkey). The table names themselves are unaffected and remain
-- fully spelled out.
create table gov_repo.agent_version_technical_profile_proposal_field_assertions (
  organisation_id uuid not null,
  proposal_id     text not null,
  field_name      text not null,
  assertion_id    text not null,
  constraint avtp_proposal_field_assertions_pkey
    primary key (organisation_id, proposal_id, field_name, assertion_id),
  constraint avtp_proposal_field_assertions_field_check
    check (field_name in (
      'behaviorFingerprint', 'buildReference', 'runtimeFrameworkReference',
      'entrypointReference', 'configurationReference'
    )),
  constraint avtp_proposal_field_assertions_proposal_fkey
    foreign key (organisation_id, proposal_id)
    references gov_repo.agent_version_technical_profile_proposals (organisation_id, proposal_id),
  constraint avtp_proposal_field_assertions_assertion_fkey
    foreign key (organisation_id, assertion_id)
    references gov_repo.source_assertions (organisation_id, assertion_id)
);
comment on table gov_repo.agent_version_technical_profile_proposal_field_assertions is
  'Per-field SourceAssertionId membership for one proposal, constrained to the exact five frozen AgentVersionTechnicalProfileSupport field names. Provenance only — never a semantic value, never a generic EAV store.';
create index idx_avtp_proposal_field_assertions_org
  on gov_repo.agent_version_technical_profile_proposal_field_assertions (organisation_id);

create table gov_repo.agent_version_technical_profile_proposal_field_evidence (
  organisation_id uuid not null,
  proposal_id     text not null,
  field_name      text not null,
  evidence_id     text not null,
  constraint avtp_proposal_field_evidence_pkey
    primary key (organisation_id, proposal_id, field_name, evidence_id),
  constraint avtp_proposal_field_evidence_field_check
    check (field_name in (
      'behaviorFingerprint', 'buildReference', 'runtimeFrameworkReference',
      'entrypointReference', 'configurationReference'
    )),
  constraint avtp_proposal_field_evidence_proposal_fkey
    foreign key (organisation_id, proposal_id)
    references gov_repo.agent_version_technical_profile_proposals (organisation_id, proposal_id),
  constraint avtp_proposal_field_evidence_evidence_fkey
    foreign key (organisation_id, evidence_id)
    references gov_repo.discovery_evidence (organisation_id, evidence_id)
);
comment on table gov_repo.agent_version_technical_profile_proposal_field_evidence is
  'Per-field EvidenceId membership for one proposal, constrained to the exact five frozen AgentVersionTechnicalProfileSupport field names.';
create index idx_avtp_proposal_field_evidence_org
  on gov_repo.agent_version_technical_profile_proposal_field_evidence (organisation_id);

-- -----------------------------------------------------------------------------
-- B. CANONICAL AGENT VERSION TECHNICAL PROFILE — a governed projection
--    associated with an existing canonical AGENT_VERSION object
--    (gov_repo.canonical_objects). Distinct lifecycle from canonical object
--    identity (ADR Decision F): this row MAY be updated (profile enrichment)
--    without ever creating a new canonical AgentVersion and without ever
--    mutating canonical_objects itself. Exactly one current profile
--    projection per canonical AgentVersion (primary key on canonical_object_id
--    alone, not appended per materialization call).
-- -----------------------------------------------------------------------------

create table gov_repo.agent_version_technical_profiles (
  organisation_id                     uuid        not null references gov_repo.organisations (organisation_id),
  canonical_object_id                 text        not null,
  source_proposal_id                  text        not null,
  behavior_fingerprint_algorithm      text        not null,
  behavior_fingerprint_schema_version text        not null,
  behavior_fingerprint_value          text        not null,
  build_reference                     text,
  runtime_framework_reference         text,
  entrypoint_reference                text,
  configuration_reference             text,
  revision                            bigint      not null default 0,
  created_at                          timestamptz not null default now(),
  updated_at                          timestamptz not null default now(),
  constraint agent_version_technical_profiles_pkey primary key (organisation_id, canonical_object_id),
  constraint agent_version_technical_profiles_revision_nonnegative check (revision >= 0),
  constraint agent_version_technical_profiles_object_fkey
    foreign key (organisation_id, canonical_object_id)
    references gov_repo.canonical_objects (organisation_id, canonical_object_id),
  constraint agent_version_technical_profiles_proposal_fkey
    foreign key (organisation_id, source_proposal_id)
    references gov_repo.agent_version_technical_profile_proposals (organisation_id, proposal_id)
);

comment on table gov_repo.agent_version_technical_profiles is
  'Governed canonical projection of AgentVersionTechnicalProfile (packages/canonical-contracts contracts.ts:1104-1112), one row per canonical AGENT_VERSION object, materialized exclusively by gov_repo.materialize_agent_version_technical_profile from an already-durable, already-verified proposal. kind = AGENT_VERSION for canonical_object_id is verified by the materialization function (not a DB CHECK, since CHECK cannot reference another table); never trust this table''s existence as proof of kind without that function''s own gate. UPDATEs are permitted (profile enrichment) and do not, by themselves, imply or create a new AgentVersion technicalRevisionFingerprint — that remains the exclusive responsibility of packages/scanner/src/discovery/agent-version-correlation.ts, computed before this table is ever written to.';

create index idx_agent_version_technical_profiles_org
  on gov_repo.agent_version_technical_profiles (organisation_id);

create table gov_repo.agent_version_technical_profile_field_assertions (
  organisation_id     uuid not null,
  canonical_object_id text not null,
  field_name          text not null,
  assertion_id        text not null,
  constraint agent_version_technical_profile_field_assertions_pkey
    primary key (organisation_id, canonical_object_id, field_name, assertion_id),
  constraint agent_version_technical_profile_field_assertions_field_check
    check (field_name in (
      'behaviorFingerprint', 'buildReference', 'runtimeFrameworkReference',
      'entrypointReference', 'configurationReference'
    )),
  constraint agent_version_technical_profile_field_assertions_profile_fkey
    foreign key (organisation_id, canonical_object_id)
    references gov_repo.agent_version_technical_profiles (organisation_id, canonical_object_id),
  constraint agent_version_technical_profile_field_assertions_assertion_fkey
    foreign key (organisation_id, assertion_id)
    references gov_repo.source_assertions (organisation_id, assertion_id)
);
comment on table gov_repo.agent_version_technical_profile_field_assertions is
  'Per-field SourceAssertionId membership for one canonical AgentVersionTechnicalProfile, constrained to the exact five frozen field names. Provenance only.';
create index idx_agent_version_technical_profile_field_assertions_org
  on gov_repo.agent_version_technical_profile_field_assertions (organisation_id);

create table gov_repo.agent_version_technical_profile_field_evidence (
  organisation_id     uuid not null,
  canonical_object_id text not null,
  field_name          text not null,
  evidence_id         text not null,
  constraint agent_version_technical_profile_field_evidence_pkey
    primary key (organisation_id, canonical_object_id, field_name, evidence_id),
  constraint agent_version_technical_profile_field_evidence_field_check
    check (field_name in (
      'behaviorFingerprint', 'buildReference', 'runtimeFrameworkReference',
      'entrypointReference', 'configurationReference'
    )),
  constraint agent_version_technical_profile_field_evidence_profile_fkey
    foreign key (organisation_id, canonical_object_id)
    references gov_repo.agent_version_technical_profiles (organisation_id, canonical_object_id),
  constraint agent_version_technical_profile_field_evidence_evidence_fkey
    foreign key (organisation_id, evidence_id)
    references gov_repo.discovery_evidence (organisation_id, evidence_id)
);
comment on table gov_repo.agent_version_technical_profile_field_evidence is
  'Per-field EvidenceId membership for one canonical AgentVersionTechnicalProfile, constrained to the exact five frozen field names.';
create index idx_agent_version_technical_profile_field_evidence_org
  on gov_repo.agent_version_technical_profile_field_evidence (organisation_id);

-- -----------------------------------------------------------------------------
-- C. MATERIALIZATION AUDIT TRAIL — append-only, one row per successful
--    gov_repo.materialize_agent_version_technical_profile call, mirroring
--    gov_repo.materialization_operations' own idempotency-anchor role for
--    canonical objects/relationships, scoped to this narrower operation.
-- -----------------------------------------------------------------------------

create table gov_repo.agent_version_technical_profile_materializations (
  materialization_id  text        not null,
  organisation_id     uuid        not null references gov_repo.organisations (organisation_id),
  canonical_object_id text        not null,
  proposal_id         text        not null,
  status              text        not null,
  applied_at          timestamptz not null,
  created_at          timestamptz not null default now(),
  constraint agent_version_technical_profile_materializations_pkey primary key (organisation_id, materialization_id),
  constraint agent_version_technical_profile_materializations_status_check
    check (status = 'APPLIED'),
  -- Idempotency anchor: at most one materialization row per (organisation,
  -- canonical object, proposal) triple — a replay of the identical proposal
  -- against the identical canonical target always reuses this row rather
  -- than appending a second one.
  constraint agent_version_technical_profile_materializations_unique
    unique (organisation_id, canonical_object_id, proposal_id),
  constraint agent_version_technical_profile_materializations_object_fkey
    foreign key (organisation_id, canonical_object_id)
    references gov_repo.canonical_objects (organisation_id, canonical_object_id),
  constraint agent_version_technical_profile_materializations_proposal_fkey
    foreign key (organisation_id, proposal_id)
    references gov_repo.agent_version_technical_profile_proposals (organisation_id, proposal_id)
);
comment on table gov_repo.agent_version_technical_profile_materializations is
  'IMMUTABLE append-only audit trail, one row per successfully applied gov_repo.materialize_agent_version_technical_profile call. constraint agent_version_technical_profile_materializations_unique is the idempotency anchor.';

create index idx_agent_version_technical_profile_materializations_org
  on gov_repo.agent_version_technical_profile_materializations (organisation_id);

-- -----------------------------------------------------------------------------
-- D. OUTBOX EVENT TYPE — extend the closed enum from Governance Persistence
--    V1 / Canonical Materialization V1 with one new event type. Alters the
--    existing CHECK constraint only, never a historical migration file.
-- -----------------------------------------------------------------------------

alter table gov_repo.outbox_events drop constraint outbox_events_event_type_check;
alter table gov_repo.outbox_events add constraint outbox_events_event_type_check check (
  event_type in (
    'GOVERNANCE_REVIEW_TRANSITIONED',
    'GOVERNANCE_AUTHORIZATION_EVALUATED',
    'GOVERNANCE_RECONCILIATION_DECIDED',
    'GOVERNANCE_CANONICAL_OBJECT_MATERIALIZED',
    'GOVERNANCE_CANONICAL_RELATIONSHIP_MATERIALIZED',
    'GOVERNANCE_AGENT_VERSION_TECHNICAL_PROFILE_MATERIALIZED'
  )
);

-- -----------------------------------------------------------------------------
-- E. IMMUTABILITY — the proposal and materialization-audit tables are
--    immutable, mirroring Governance Persistence V1's own pattern.
--    gov_repo.agent_version_technical_profiles is deliberately NOT made
--    immutable: ADR Decision F explicitly anticipates profile enrichment
--    (stronger provenance, additional evidence) via UPDATE, without that
--    enrichment ever implying a new canonical AgentVersion.
-- -----------------------------------------------------------------------------

create or replace rule agent_version_technical_profile_proposals_no_update as
  on update to gov_repo.agent_version_technical_profile_proposals do instead nothing;
create or replace rule agent_version_technical_profile_proposals_no_delete as
  on delete to gov_repo.agent_version_technical_profile_proposals do instead nothing;

create or replace rule agent_version_technical_profile_materializations_no_update as
  on update to gov_repo.agent_version_technical_profile_materializations do instead nothing;
create or replace rule agent_version_technical_profile_materializations_no_delete as
  on delete to gov_repo.agent_version_technical_profile_materializations do instead nothing;

-- -----------------------------------------------------------------------------
-- F. ROW LEVEL SECURITY — matches every adjacent Decision-to-Truth table in
--    this history exactly (gov_repo.canonical_objects, discovery_findings,
--    discovery_candidates, review_subjects, reconciliation_decisions, ...):
--    service_role only, no authenticated-role policy for this table family.
--    Tenant isolation is enforced by (organisation_id, ...) composite
--    primary keys/FKs throughout plus explicit organisation_id parameter
--    verification inside every SECURITY INVOKER function below — the same
--    convention this entire pipeline already established, not a new,
--    weaker one.
-- -----------------------------------------------------------------------------

alter table gov_repo.agent_version_technical_profile_proposals enable row level security;
alter table gov_repo.agent_version_technical_profile_proposal_field_assertions enable row level security;
alter table gov_repo.agent_version_technical_profile_proposal_field_evidence enable row level security;
alter table gov_repo.agent_version_technical_profiles enable row level security;
alter table gov_repo.agent_version_technical_profile_field_assertions enable row level security;
alter table gov_repo.agent_version_technical_profile_field_evidence enable row level security;
alter table gov_repo.agent_version_technical_profile_materializations enable row level security;

revoke all on table
  gov_repo.agent_version_technical_profile_proposals,
  gov_repo.agent_version_technical_profile_proposal_field_assertions,
  gov_repo.agent_version_technical_profile_proposal_field_evidence,
  gov_repo.agent_version_technical_profiles,
  gov_repo.agent_version_technical_profile_field_assertions,
  gov_repo.agent_version_technical_profile_field_evidence,
  gov_repo.agent_version_technical_profile_materializations
from public, anon, authenticated;

-- Policy names use the "avtp_*" abbreviation (AgentVersionTechnicalProfile):
-- "Service role has full access to " + the full table name exceeds
-- PostgreSQL's 63-byte NAMEDATALEN limit for every one of these seven
-- tables (silently truncated otherwise) — the table names themselves are
-- unaffected and remain fully spelled out in the `on gov_repo.<table>` clause.
create policy "Service role access to avtp_proposals" on gov_repo.agent_version_technical_profile_proposals for all to service_role using (true) with check (true);
create policy "Service role access to avtp_proposal_field_assertions" on gov_repo.agent_version_technical_profile_proposal_field_assertions for all to service_role using (true) with check (true);
create policy "Service role access to avtp_proposal_field_evidence" on gov_repo.agent_version_technical_profile_proposal_field_evidence for all to service_role using (true) with check (true);
create policy "Service role access to avtp_profiles" on gov_repo.agent_version_technical_profiles for all to service_role using (true) with check (true);
create policy "Service role access to avtp_field_assertions" on gov_repo.agent_version_technical_profile_field_assertions for all to service_role using (true) with check (true);
create policy "Service role access to avtp_field_evidence" on gov_repo.agent_version_technical_profile_field_evidence for all to service_role using (true) with check (true);
create policy "Service role access to avtp_materializations" on gov_repo.agent_version_technical_profile_materializations for all to service_role using (true) with check (true);

-- -----------------------------------------------------------------------------
-- G. RECORD PROPOSAL — idempotent durable persistence of one typed
--    AgentVersionTechnicalProfile proposal plus its per-field assertion/
--    evidence support. Mirrors gov_repo.record_discovery_candidate's own
--    parent-consistency check (verifies the referenced discovery_candidates
--    row is itself candidate_kind = 'AGENT_VERSION' before ever inserting).
-- -----------------------------------------------------------------------------

create or replace function gov_repo.record_agent_version_technical_profile_proposal(
  p_organisation_id                     uuid,
  p_proposal_id                         text,
  p_agent_version_candidate_id          text,
  p_behavior_fingerprint_algorithm      text,
  p_behavior_fingerprint_schema_version text,
  p_behavior_fingerprint_value          text,
  p_build_reference                     text,
  p_runtime_framework_reference         text,
  p_entrypoint_reference                text,
  p_configuration_reference             text,
  p_behavior_fingerprint_assertion_ids  text[],
  p_behavior_fingerprint_evidence_ids   text[],
  p_build_reference_assertion_ids       text[],
  p_build_reference_evidence_ids        text[],
  p_runtime_framework_reference_assertion_ids text[],
  p_runtime_framework_reference_evidence_ids  text[],
  p_entrypoint_reference_assertion_ids  text[],
  p_entrypoint_reference_evidence_ids   text[],
  p_configuration_reference_assertion_ids text[],
  p_configuration_reference_evidence_ids  text[],
  p_contract_version                    text
)
returns table (
  replay      boolean,
  proposal_id text
)
language plpgsql
volatile
security invoker
set search_path = 'gov_repo', 'pg_catalog'
as $$
declare
  v_candidate gov_repo.discovery_candidates%rowtype;
  v_existing  gov_repo.agent_version_technical_profile_proposals%rowtype;
begin
  if p_proposal_id is null or btrim(p_proposal_id) = '' then
    raise exception using errcode = '22004', message = 'proposal_id is required';
  end if;

  select * into v_candidate
  from gov_repo.discovery_candidates as dc
  where dc.organisation_id = p_organisation_id and dc.candidate_id = p_agent_version_candidate_id;

  if not found then
    raise exception using
      errcode = '23503',
      message = 'AGENT_VERSION_CANDIDATE_NOT_FOUND',
      detail = format('No durable discovery_candidates row for candidate_id %s in this organisation', p_agent_version_candidate_id);
  end if;
  if v_candidate.candidate_kind <> 'AGENT_VERSION' then
    raise exception using
      errcode = '22023',
      message = 'CANDIDATE_KIND_MISMATCH',
      detail = format('candidate_id %s is kind %s, not AGENT_VERSION', p_agent_version_candidate_id, v_candidate.candidate_kind);
  end if;

  -- Idempotency + collision detection: proposal_id is expected to be
  -- content-addressed by the caller, but this function never trusts that
  -- assumption alone. A reused proposal_id whose stored semantic content
  -- exactly matches the new call is a safe replay (first insert wins,
  -- exactly like gov_repo.record_discovery_finding). A reused proposal_id
  -- whose stored content DIFFERS from the new call fails closed instead of
  -- silently discarding the new (or old) semantic value.
  select * into v_existing
  from gov_repo.agent_version_technical_profile_proposals as p
  where p.organisation_id = p_organisation_id and p.proposal_id = p_proposal_id;

  if found then
    if v_existing.agent_version_candidate_id is distinct from p_agent_version_candidate_id
       or v_existing.behavior_fingerprint_algorithm is distinct from p_behavior_fingerprint_algorithm
       or v_existing.behavior_fingerprint_schema_version is distinct from p_behavior_fingerprint_schema_version
       or v_existing.behavior_fingerprint_value is distinct from p_behavior_fingerprint_value
       or v_existing.build_reference is distinct from p_build_reference
       or v_existing.runtime_framework_reference is distinct from p_runtime_framework_reference
       or v_existing.entrypoint_reference is distinct from p_entrypoint_reference
       or v_existing.configuration_reference is distinct from p_configuration_reference
    then
      raise exception using
        errcode = '23514',
        message = 'PROPOSAL_IDEMPOTENCY_CONFLICT',
        detail = format('proposal_id %s already exists with different semantic content', p_proposal_id);
    end if;
    return query select true, p_proposal_id;
    return;
  end if;

  begin
    insert into gov_repo.agent_version_technical_profile_proposals (
      organisation_id, proposal_id, agent_version_candidate_id,
      behavior_fingerprint_algorithm, behavior_fingerprint_schema_version, behavior_fingerprint_value,
      build_reference, runtime_framework_reference, entrypoint_reference, configuration_reference,
      contract_version
    ) values (
      p_organisation_id, p_proposal_id, p_agent_version_candidate_id,
      p_behavior_fingerprint_algorithm, p_behavior_fingerprint_schema_version, p_behavior_fingerprint_value,
      p_build_reference, p_runtime_framework_reference, p_entrypoint_reference, p_configuration_reference,
      p_contract_version
    );

    insert into gov_repo.agent_version_technical_profile_proposal_field_assertions (organisation_id, proposal_id, field_name, assertion_id)
    select p_organisation_id, p_proposal_id, field_name, assertion_id from (
      select 'behaviorFingerprint' as field_name, unnest(coalesce(p_behavior_fingerprint_assertion_ids, '{}')) as assertion_id
      union all
      select 'buildReference', unnest(coalesce(p_build_reference_assertion_ids, '{}'))
      union all
      select 'runtimeFrameworkReference', unnest(coalesce(p_runtime_framework_reference_assertion_ids, '{}'))
      union all
      select 'entrypointReference', unnest(coalesce(p_entrypoint_reference_assertion_ids, '{}'))
      union all
      select 'configurationReference', unnest(coalesce(p_configuration_reference_assertion_ids, '{}'))
    ) as field_assertions;

    insert into gov_repo.agent_version_technical_profile_proposal_field_evidence (organisation_id, proposal_id, field_name, evidence_id)
    select p_organisation_id, p_proposal_id, field_name, evidence_id from (
      select 'behaviorFingerprint' as field_name, unnest(coalesce(p_behavior_fingerprint_evidence_ids, '{}')) as evidence_id
      union all
      select 'buildReference', unnest(coalesce(p_build_reference_evidence_ids, '{}'))
      union all
      select 'runtimeFrameworkReference', unnest(coalesce(p_runtime_framework_reference_evidence_ids, '{}'))
      union all
      select 'entrypointReference', unnest(coalesce(p_entrypoint_reference_evidence_ids, '{}'))
      union all
      select 'configurationReference', unnest(coalesce(p_configuration_reference_evidence_ids, '{}'))
    ) as field_evidence;

    return query select false, p_proposal_id;
    return;
  exception
    when unique_violation then
      -- A concurrent racing call won the insert first. Re-select and apply
      -- the identical content-match rule as above rather than assuming the
      -- race winner's content matches ours.
      select * into v_existing
      from gov_repo.agent_version_technical_profile_proposals as p
      where p.organisation_id = p_organisation_id and p.proposal_id = p_proposal_id;

      if v_existing.agent_version_candidate_id is distinct from p_agent_version_candidate_id
         or v_existing.behavior_fingerprint_algorithm is distinct from p_behavior_fingerprint_algorithm
         or v_existing.behavior_fingerprint_schema_version is distinct from p_behavior_fingerprint_schema_version
         or v_existing.behavior_fingerprint_value is distinct from p_behavior_fingerprint_value
         or v_existing.build_reference is distinct from p_build_reference
         or v_existing.runtime_framework_reference is distinct from p_runtime_framework_reference
         or v_existing.entrypoint_reference is distinct from p_entrypoint_reference
         or v_existing.configuration_reference is distinct from p_configuration_reference
      then
        raise exception using
          errcode = '23514',
          message = 'PROPOSAL_IDEMPOTENCY_CONFLICT',
          detail = format('proposal_id %s already exists with different semantic content', p_proposal_id);
      end if;
      return query select true, p_proposal_id;
      return;
  end;
end;
$$;

comment on function gov_repo.record_agent_version_technical_profile_proposal is
  'Idempotent durable persistence of one typed AgentVersionTechnicalProfile proposal plus per-field assertion/evidence support, tenant-scoped by (organisation_id, proposal_id). proposal_id is expected to be content-addressed by the caller (identical semantic input always reproduces the identical id), so a reused proposal_id normally replays (first insert wins) exactly like gov_repo.record_discovery_finding — but this function never trusts that assumption alone: a reused proposal_id whose stored content differs from the new call raises PROPOSAL_IDEMPOTENCY_CONFLICT instead of silently discarding either value. Never creates a canonical object; never implies certification. SECURITY INVOKER, service_role only.';

-- -----------------------------------------------------------------------------
-- H. MATERIALIZE PROFILE — the only path from a durable proposal to a
--    governed canonical AgentVersionTechnicalProfile row. Verifies, before
--    any write: organisation scope: canonical target exists and is kind
--    AGENT_VERSION; the proposal exists and belongs to this organisation;
--    the proposal's own source candidate's SourceObjectIdentity is actively
--    mapped (gov_repo.canonical_object_source_mappings) to this exact
--    canonical_object_id — i.e. the proposal genuinely originates from the
--    same governed AgentVersion this call targets, never a different one.
--    Idempotent: a replay of the identical (canonical_object_id,
--    proposal_id) pair is detected and returned BEFORE any write — no
--    revision bump, no duplicate audit row, no duplicate outbox event.
--
--    CANONICAL AGENT_VERSION = ONE technical/behavioral revision (external
--    review correction): an incoming proposal whose behaviorFingerprint
--    differs from the already-governed canonical profile's own fingerprint
--    fails closed with AGENT_VERSION_TECHNICAL_REVISION_MISMATCH — a
--    different technical revision requires a different canonical
--    AGENT_VERSION, never an UPDATE of this profile. behaviorFingerprint is
--    therefore semantically IMMUTABLE for an existing canonical profile;
--    the fingerprint columns are never written by the UPDATE branch below
--    (only by the initial INSERT), enforcing that immutability structurally,
--    not merely by convention.
--
--    For the SAME behaviorFingerprint, enrichment of the four optional
--    fields (buildReference/runtimeFrameworkReference/entrypointReference/
--    configurationReference) is monotonic: UNKNOWN -> known is enrichment;
--    known -> the SAME known value is a compatible no-op; a known value
--    conflicting with a different known value fails closed with
--    AGENT_VERSION_PROFILE_SEMANTIC_CONFLICT (never last-write-wins); and an
--    already-known value is never erased merely because a newer proposal
--    does not carry that fact (known -> UNKNOWN is not applied).
--
--    Field-level assertion/evidence support is a monotonic UNION across
--    every compatible proposal ever materialized against this canonical
--    profile (INSERT ... ON CONFLICT DO NOTHING on the existing per-field
--    junction-table primary key), never a delete-then-replace — enrichment
--    must never destroy previously governed provenance.
--
--    revision increments only for an actual governed change: the first-ever
--    profile for this AgentVersion, a newly-filled previously-UNKNOWN
--    optional field, or newly added assertion/evidence support rows. A
--    compatible proposal that adds no new field value and no new support is
--    accepted (proposal_id-distinct, audited) but leaves revision untouched.
--
--    source_proposal_id records the ORIGIN proposal only (the one that
--    first materialized this canonical profile) — it is deliberately never
--    overwritten by a later compatible enrichment, so it never falsely
--    implies that all of this profile's provenance came from only the most
--    recent proposal. Full provenance for a field is the union recorded in
--    gov_repo.agent_version_technical_profile_field_assertions/_evidence;
--    the sequence of every proposal ever applied is the audit trail in
--    gov_repo.agent_version_technical_profile_materializations.
-- -----------------------------------------------------------------------------

create or replace function gov_repo.materialize_agent_version_technical_profile(
  p_organisation_id     uuid,
  p_canonical_object_id text,
  p_proposal_id         text,
  p_occurred_at         timestamptz
)
returns table (
  replay              boolean,
  status              text,
  canonical_object_id text
)
language plpgsql
volatile
security invoker
set search_path = 'gov_repo', 'pg_catalog'
as $$
declare
  v_object          gov_repo.canonical_objects%rowtype;
  v_proposal        gov_repo.agent_version_technical_profile_proposals%rowtype;
  v_candidate       gov_repo.discovery_candidates%rowtype;
  v_mapped          boolean;
  v_existing        gov_repo.agent_version_technical_profile_materializations%rowtype;
  v_existing_profile gov_repo.agent_version_technical_profiles%rowtype;
  v_materialization_id text;
  v_payload         jsonb;
  v_final_build_reference             text;
  v_final_runtime_framework_reference text;
  v_final_entrypoint_reference        text;
  v_final_configuration_reference     text;
  v_changed         boolean;
  v_assertions_inserted integer;
  v_evidence_inserted   integer;
begin
  -- (1) organisation scope + (2)(3) canonical target exists and is AGENT_VERSION.
  select * into v_object
  from gov_repo.canonical_objects as co
  where co.organisation_id = p_organisation_id and co.canonical_object_id = p_canonical_object_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'CANONICAL_OBJECT_NOT_FOUND';
  end if;
  if v_object.kind <> 'AGENT_VERSION' then
    raise exception using
      errcode = '22023',
      message = 'CANONICAL_TARGET_KIND_MISMATCH',
      detail = format('canonical_object_id %s is kind %s, not AGENT_VERSION', p_canonical_object_id, v_object.kind);
  end if;

  -- (4) proposal exists, same organisation.
  select * into v_proposal
  from gov_repo.agent_version_technical_profile_proposals as p
  where p.organisation_id = p_organisation_id and p.proposal_id = p_proposal_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'PROPOSAL_NOT_FOUND';
  end if;

  -- (7) the proposal's own source candidate exists and is genuinely mapped
  -- to THIS canonical AgentVersion (never a different one) via the already-
  -- governed canonical_object_source_mappings row created when the
  -- AGENT_VERSION reconciliation itself was materialized (item 6 — object
  -- materialization already applied — is proven by v_object existing above,
  -- since canonical_objects rows are only ever created there).
  select * into v_candidate
  from gov_repo.discovery_candidates as dc
  where dc.organisation_id = p_organisation_id and dc.candidate_id = v_proposal.agent_version_candidate_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'PROPOSAL_CANDIDATE_NOT_FOUND';
  end if;

  select true into v_mapped
  from gov_repo.canonical_object_source_mappings as csm
  where csm.organisation_id = p_organisation_id
    and csm.canonical_object_id = p_canonical_object_id
    and csm.canonical_object_kind = 'AGENT_VERSION'
    and csm.source_connection_id = v_candidate.source_connection_id
    and csm.source_external_type = v_candidate.source_external_type
    and csm.source_external_id = v_candidate.source_external_id
    and csm.valid_to is null
  limit 1;
  if v_mapped is distinct from true then
    raise exception using
      errcode = '22023',
      message = 'PROPOSAL_NOT_MAPPED_TO_TARGET',
      detail = 'This proposal''s source candidate is not actively mapped to the given canonical AGENT_VERSION object';
  end if;

  -- (9) idempotency, checked and returned BEFORE any write: a replay of the
  -- identical (canonical_object_id, proposal_id) pair must be a pure no-op
  -- — same request, same effective state, no revision bump, no duplicate
  -- audit row, no duplicate outbox event. This is deliberately the very
  -- first thing checked after validation, not merely deduplicated by an
  -- ON CONFLICT after the fact (an ON CONFLICT DO UPDATE would otherwise
  -- unconditionally increment revision even for an exact replay, which
  -- would falsely signal profile enrichment that never happened).
  select * into v_existing
  from gov_repo.agent_version_technical_profile_materializations as m
  where m.organisation_id = p_organisation_id
    and m.canonical_object_id = p_canonical_object_id
    and m.proposal_id = p_proposal_id;

  if v_existing.materialization_id is not null then
    return query select true, v_existing.status, v_existing.canonical_object_id;
    return;
  end if;

  -- Load the current canonical profile, if any, BEFORE any write. Its
  -- absence means this is the first-ever profile for this AgentVersion
  -- (always a real governed change); its presence means this materialize
  -- call must be checked for compatibility with it before anything is
  -- written.
  select * into v_existing_profile
  from gov_repo.agent_version_technical_profiles as p
  where p.organisation_id = p_organisation_id and p.canonical_object_id = p_canonical_object_id;

  if found then
    -- TECHNICAL REVISION IMMUTABILITY: a different behaviorFingerprint for
    -- an already-governed canonical AgentVersion is never a profile update
    -- — it is a different technical/behavioral revision, which must be a
    -- different canonical AgentVersion (a Discovery/reconciliation-stage
    -- concern this function has no authority over). Fail closed rather
    -- than silently overwrite the fingerprint, bump revision, or replace
    -- support for what would actually be a different AgentVersion's data.
    if v_existing_profile.behavior_fingerprint_algorithm is distinct from v_proposal.behavior_fingerprint_algorithm
       or v_existing_profile.behavior_fingerprint_schema_version is distinct from v_proposal.behavior_fingerprint_schema_version
       or v_existing_profile.behavior_fingerprint_value is distinct from v_proposal.behavior_fingerprint_value
    then
      raise exception using
        errcode = '23514',
        message = 'AGENT_VERSION_TECHNICAL_REVISION_MISMATCH',
        detail = format('canonical_object_id %s already has a governed AgentVersionTechnicalProfile with a different behaviorFingerprint; a different technical revision requires a different canonical AGENT_VERSION, never an update of this profile', p_canonical_object_id);
    end if;

    -- OPTIONAL FIELD COMPATIBILITY: monotonic enrichment only. A known
    -- value conflicting with a different known value fails closed instead
    -- of silently mutating already-governed technical semantics
    -- (last-write-wins is explicitly forbidden). Field identification only
    -- — never the conflicting values themselves — is included in the error
    -- detail.
    if v_existing_profile.build_reference is not null
       and v_proposal.build_reference is not null
       and v_existing_profile.build_reference is distinct from v_proposal.build_reference
    then
      raise exception using
        errcode = '23514', message = 'AGENT_VERSION_PROFILE_SEMANTIC_CONFLICT',
        detail = format('canonical_object_id %s: incoming buildReference conflicts with an already-governed, different buildReference', p_canonical_object_id);
    end if;
    if v_existing_profile.runtime_framework_reference is not null
       and v_proposal.runtime_framework_reference is not null
       and v_existing_profile.runtime_framework_reference is distinct from v_proposal.runtime_framework_reference
    then
      raise exception using
        errcode = '23514', message = 'AGENT_VERSION_PROFILE_SEMANTIC_CONFLICT',
        detail = format('canonical_object_id %s: incoming runtimeFrameworkReference conflicts with an already-governed, different runtimeFrameworkReference', p_canonical_object_id);
    end if;
    if v_existing_profile.entrypoint_reference is not null
       and v_proposal.entrypoint_reference is not null
       and v_existing_profile.entrypoint_reference is distinct from v_proposal.entrypoint_reference
    then
      raise exception using
        errcode = '23514', message = 'AGENT_VERSION_PROFILE_SEMANTIC_CONFLICT',
        detail = format('canonical_object_id %s: incoming entrypointReference conflicts with an already-governed, different entrypointReference', p_canonical_object_id);
    end if;
    if v_existing_profile.configuration_reference is not null
       and v_proposal.configuration_reference is not null
       and v_existing_profile.configuration_reference is distinct from v_proposal.configuration_reference
    then
      raise exception using
        errcode = '23514', message = 'AGENT_VERSION_PROFILE_SEMANTIC_CONFLICT',
        detail = format('canonical_object_id %s: incoming configurationReference conflicts with an already-governed, different configurationReference', p_canonical_object_id);
    end if;

    -- Compatible: existing non-null value wins over incoming NULL (already-
    -- governed knowledge is never erased by a less-informative proposal);
    -- an existing NULL is enriched by an incoming non-null value.
    v_final_build_reference             := coalesce(v_existing_profile.build_reference, v_proposal.build_reference);
    v_final_runtime_framework_reference := coalesce(v_existing_profile.runtime_framework_reference, v_proposal.runtime_framework_reference);
    v_final_entrypoint_reference        := coalesce(v_existing_profile.entrypoint_reference, v_proposal.entrypoint_reference);
    v_final_configuration_reference     := coalesce(v_existing_profile.configuration_reference, v_proposal.configuration_reference);

    v_changed :=
      v_final_build_reference is distinct from v_existing_profile.build_reference
      or v_final_runtime_framework_reference is distinct from v_existing_profile.runtime_framework_reference
      or v_final_entrypoint_reference is distinct from v_existing_profile.entrypoint_reference
      or v_final_configuration_reference is distinct from v_existing_profile.configuration_reference;
  else
    -- First-ever canonical profile for this AgentVersion: always a real
    -- governed change, and there is no existing state to be compatible with.
    v_final_build_reference             := v_proposal.build_reference;
    v_final_runtime_framework_reference := v_proposal.runtime_framework_reference;
    v_final_entrypoint_reference        := v_proposal.entrypoint_reference;
    v_final_configuration_reference     := v_proposal.configuration_reference;
    v_changed := true;
  end if;

  -- Field-level support: UNION, never delete-then-replace. Existing
  -- provenance rows are preserved; only rows that are not already present
  -- (per the junction tables' own primary keys) are newly inserted. A
  -- proposal materialized purely to add support to an already-governed
  -- field never destroys prior assertion/evidence membership.
  insert into gov_repo.agent_version_technical_profile_field_assertions (organisation_id, canonical_object_id, field_name, assertion_id)
  select p_organisation_id, p_canonical_object_id, field_name, assertion_id
  from gov_repo.agent_version_technical_profile_proposal_field_assertions
  where organisation_id = p_organisation_id and proposal_id = p_proposal_id
  on conflict do nothing;
  get diagnostics v_assertions_inserted = row_count;

  insert into gov_repo.agent_version_technical_profile_field_evidence (organisation_id, canonical_object_id, field_name, evidence_id)
  select p_organisation_id, p_canonical_object_id, field_name, evidence_id
  from gov_repo.agent_version_technical_profile_proposal_field_evidence
  where organisation_id = p_organisation_id and proposal_id = p_proposal_id
  on conflict do nothing;
  get diagnostics v_evidence_inserted = row_count;

  if v_assertions_inserted > 0 or v_evidence_inserted > 0 then
    v_changed := true;
  end if;

  -- Canonical profile upsert. Deliberately never writes
  -- behavior_fingerprint_algorithm/_schema_version/_value or
  -- source_proposal_id in the UPDATE branch: the fingerprint is immutable
  -- once governed (enforced above, and structurally reinforced here by
  -- omission), and source_proposal_id preserves the ORIGIN proposal rather
  -- than being overwritten by every later compatible enrichment. revision/
  -- updated_at only advance when v_changed is true, so a compatible-but-
  -- uninformative proposal is accepted (and audited below) without
  -- fabricating an enrichment that did not happen.
  insert into gov_repo.agent_version_technical_profiles (
    organisation_id, canonical_object_id, source_proposal_id,
    behavior_fingerprint_algorithm, behavior_fingerprint_schema_version, behavior_fingerprint_value,
    build_reference, runtime_framework_reference, entrypoint_reference, configuration_reference,
    updated_at
  ) values (
    p_organisation_id, p_canonical_object_id, p_proposal_id,
    v_proposal.behavior_fingerprint_algorithm, v_proposal.behavior_fingerprint_schema_version, v_proposal.behavior_fingerprint_value,
    v_final_build_reference, v_final_runtime_framework_reference, v_final_entrypoint_reference, v_final_configuration_reference,
    p_occurred_at
  )
  on conflict (organisation_id, canonical_object_id) do update set
    build_reference = excluded.build_reference,
    runtime_framework_reference = excluded.runtime_framework_reference,
    entrypoint_reference = excluded.entrypoint_reference,
    configuration_reference = excluded.configuration_reference,
    revision = case when v_changed then gov_repo.agent_version_technical_profiles.revision + 1 else gov_repo.agent_version_technical_profiles.revision end,
    updated_at = case when v_changed then excluded.updated_at else gov_repo.agent_version_technical_profiles.updated_at end;

  v_materialization_id := gen_random_uuid()::text;
  insert into gov_repo.agent_version_technical_profile_materializations (
    materialization_id, organisation_id, canonical_object_id, proposal_id, status, applied_at
  ) values (
    v_materialization_id, p_organisation_id, p_canonical_object_id, p_proposal_id, 'APPLIED', p_occurred_at
  );

  v_payload := jsonb_build_object(
    'organisationId', p_organisation_id,
    'canonicalObjectId', p_canonical_object_id,
    'proposalId', p_proposal_id,
    'materializationId', v_materialization_id
  );
  insert into gov_repo.outbox_events (organisation_id, event_type, payload, payload_hash, occurred_at)
  values (
    p_organisation_id, 'GOVERNANCE_AGENT_VERSION_TECHNICAL_PROFILE_MATERIALIZED', v_payload,
    encode(extensions.digest(convert_to(v_payload::text, 'UTF8'), 'sha256'), 'hex'),
    p_occurred_at
  );

  return query select false, 'APPLIED'::text, p_canonical_object_id;
end;
$$;

comment on function gov_repo.materialize_agent_version_technical_profile is
  'The only path from a durable AgentVersionTechnicalProfile proposal to a governed canonical profile row. Verifies canonical target exists and is kind AGENT_VERSION, the proposal exists, and the proposal''s own source candidate is actively mapped to the exact canonical target (never a different AgentVersion''s proposal applied to this one) before any write. Idempotent on (organisation_id, canonical_object_id, proposal_id) via gov_repo.agent_version_technical_profile_materializations, checked and returned BEFORE any write. CANONICAL AGENT_VERSION = ONE technical revision: a behaviorFingerprint mismatch against an already-governed profile fails closed with AGENT_VERSION_TECHNICAL_REVISION_MISMATCH rather than overwriting it. Optional fields (buildReference/runtimeFrameworkReference/entrypointReference/configurationReference) enrich monotonically (UNKNOWN->known allowed, known->same allowed, known->different fails closed with AGENT_VERSION_PROFILE_SEMANTIC_CONFLICT, known->UNKNOWN never erases known state). Field-level assertion/evidence support is a monotonic UNION (INSERT ... ON CONFLICT DO NOTHING), never delete-then-replace. revision increments only for an actual governed change (first profile, a newly-filled optional field, or newly added support) — a compatible no-op enrichment is accepted and audited but leaves revision untouched. source_proposal_id records only the ORIGIN proposal, never overwritten by later compatible enrichments. SECURITY INVOKER, service_role only. Scanner Discovery has zero access to this function; only a governed, human-triggered materialization path may call it.';

-- -----------------------------------------------------------------------------
-- I. PERMISSIONS — EXECUTE revoked from PUBLIC/anon/authenticated, granted
--    only to service_role. Postgres grants EXECUTE to PUBLIC by default on
--    new functions, so this revoke is mandatory, not optional (identical
--    convention to every prior migration in this history).
-- -----------------------------------------------------------------------------

revoke all on function gov_repo.record_agent_version_technical_profile_proposal from public, anon, authenticated;
revoke all on function gov_repo.materialize_agent_version_technical_profile from public, anon, authenticated;

grant execute on function gov_repo.record_agent_version_technical_profile_proposal to service_role;
grant execute on function gov_repo.materialize_agent_version_technical_profile to service_role;

commit;
