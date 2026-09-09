-- =============================================================================
-- CODEGUARD AI GOVERNANCE OS
-- Migration: 20260909120000_semantic_representation_persistence_v1
-- Domain:    Semantic Intelligence Foundation V1 (roadmap milestone 4, L6/L7)
--            — the first typed, tenant-scoped, provider-independent
--            persistence for SemanticRepresentation (packages/canonical-
--            contracts semantic-representation.ts). This is DERIVED
--            ANALYTICAL STATE only: it is never a CanonicalObjectKind, never
--            canonical identity, never governance authority, and it never
--            creates, mutates, certifies, or reconciles a canonical object
--            or relationship of any kind.
--
-- This migration does NOT alter canonical_objects, canonical_relationships,
-- materialization_operations, discovery_findings, discovery_candidates,
-- review_subjects, reconciliation_decisions, outbox_events, or any table
-- from the Technical Profile Persistence V1 migration. It is purely
-- additive: one representation table, two support (provenance) tables.
--
-- L8 (Similarity & Entity Resolution) is explicitly out of scope: no
-- nearest-neighbor index (HNSW/IVFFlat), no similarity RPC, no
-- possible-match/clustering logic is introduced here. Foundation only.
--
-- No production deployment is authorized by this migration. No live
-- Supabase/production access was used to author or verify it — internal
-- consistency was verified by full re-read and the accompanying static
-- structural test file (apps/dashboard/tests/
-- semantic-representation-persistence-migration.test.ts), not by execution
-- against a running database.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- A. PGVECTOR — already enabled by supabase/migrations/
--    20260818004009_agent_registry_graph_part_1.sql ("create extension if not
--    exists \"vector\""). Re-declared here, idempotently, only so this
--    migration is self-sufficient if ever replayed against a fresh database
--    in a different order; this is not a new architectural dependency.
-- -----------------------------------------------------------------------------

create extension if not exists "vector";

do $preflight$
begin
  if to_regnamespace('gov_repo') is null then
    raise exception using
      errcode = '3F000',
      message = 'Cannot apply semantic representation persistence migration.',
      hint = 'Schema gov_repo does not exist; foundation migrations must run first.';
  end if;

  if to_regclass('gov_repo.organisations') is null
     or to_regclass('gov_repo.canonical_objects') is null
     or to_regclass('gov_repo.discovery_candidates') is null
     or to_regclass('gov_repo.source_assertions') is null
     or to_regclass('gov_repo.discovery_evidence') is null
  then
    raise exception using
      errcode = '3F000',
      message = 'Cannot apply semantic representation persistence migration.',
      hint = 'Canonical Materialization V1 / Discovery Governance Input Persistence V1 tables are missing; those migrations must run first.';
  end if;

  if to_regclass('gov_repo.semantic_representations') is not null
     or to_regclass('gov_repo.semantic_representation_assertions') is not null
     or to_regclass('gov_repo.semantic_representation_evidence') is not null
  then
    raise exception using
      errcode = '42P07',
      message = 'Cannot apply semantic representation persistence migration.',
      hint = 'One or more target tables already exist; resolve the naming collision before retrying.';
  end if;
end;
$preflight$;

-- -----------------------------------------------------------------------------
-- B. SEMANTIC REPRESENTATIONS — one immutable row per generated
--    SemanticRepresentation snapshot. A subject may have zero, one, or many
--    coexisting representations (different embedding provider/model/
--    version, different dimension, or different content fingerprint each
--    produce a distinct representation_id — see the record function below).
--    There is deliberately no mutable "current"/supersession pointer in
--    this V1 foundation: every row is a permanent, independently auditable
--    fact, never destructively overwritten. A CANONICAL_OBJECT subject and
--    a NORMALIZED_CANDIDATE subject are mutually exclusive on the same row
--    (enforced by the CHECK below) and are never silently converted into
--    one another.
--
--    embedding has no fixed dimension typmod: different representations in
--    this same table may legitimately carry different embedding
--    dimensions (different provider/model), so a single fixed-width vector
--    column would either force premature truncation/padding or forbid
--    multiple embedding spaces from coexisting — both forbidden by roadmap
--    milestone 4 §12/§14. embedding_dimension is the explicit, declared
--    dimension and is CHECK-verified against the actual stored vector's own
--    length via pgvector's vector_dims(), so a mismatch fails at the
--    database layer even if an application-level check were ever bypassed.
--    No HNSW/IVFFlat index is created — nearest-neighbor search belongs to
--    a future milestone (L8), never this one.
-- -----------------------------------------------------------------------------

create table gov_repo.semantic_representations (
  organisation_id                    uuid        not null references gov_repo.organisations (organisation_id),
  representation_id                  text        not null,
  subject_kind                       text        not null,
  subject_canonical_object_id        text,
  subject_canonical_object_kind      text,
  subject_candidate_id               text,
  subject_candidate_kind             text,
  projection_schema_version          text        not null,
  content_fingerprint_algorithm      text        not null,
  content_fingerprint_schema_version text        not null,
  content_fingerprint_value          text        not null,
  embedding_provider_id              text        not null,
  embedding_model_id                 text        not null,
  embedding_model_version            text        not null,
  embedding_dimension                integer     not null,
  embedding                          vector      not null,
  generated_at                       timestamptz not null,
  created_at                         timestamptz not null default now(),
  constraint semantic_representations_pkey primary key (organisation_id, representation_id),
  constraint semantic_representations_subject_kind_check
    check (subject_kind in ('CANONICAL_OBJECT', 'NORMALIZED_CANDIDATE')),
  constraint semantic_representations_subject_shape_check check (
    (
      subject_kind = 'CANONICAL_OBJECT'
      and subject_canonical_object_id is not null
      and subject_canonical_object_kind is not null
      and subject_candidate_id is null
      and subject_candidate_kind is null
    ) or (
      subject_kind = 'NORMALIZED_CANDIDATE'
      and subject_candidate_id is not null
      and subject_candidate_kind is not null
      and subject_canonical_object_id is null
      and subject_canonical_object_kind is null
    )
  ),
  constraint semantic_representations_dimension_positive check (embedding_dimension > 0),
  constraint semantic_representations_dimension_matches_vector check (vector_dims(embedding) = embedding_dimension),
  constraint semantic_representations_canonical_object_fkey
    foreign key (organisation_id, subject_canonical_object_id)
    references gov_repo.canonical_objects (organisation_id, canonical_object_id),
  constraint semantic_representations_candidate_fkey
    foreign key (organisation_id, subject_candidate_id)
    references gov_repo.discovery_candidates (organisation_id, candidate_id)
);

comment on table gov_repo.semantic_representations is
  'IMMUTABLE derived analytical snapshot of one SemanticRepresentation (packages/canonical-contracts semantic-representation.ts). Never canonical identity, never governance authority, never a CanonicalObjectKind. subject_canonical_object_kind/subject_candidate_kind are verified against the referenced row''s own kind by gov_repo.record_semantic_representation (a CHECK cannot reference another table) — never trust this table''s existence as proof of kind without that function''s own gate. No UPDATE is permitted (see immutability rules below); a changed subject, provider, model, version, dimension, or content fingerprint always produces a new representation_id and therefore a new row, coexisting with prior representations rather than replacing them.';

comment on constraint semantic_representations_canonical_object_fkey on gov_repo.semantic_representations is
  'Only enforced when subject_kind = CANONICAL_OBJECT (both subject_canonical_object_id and subject_candidate_id are nullable, and the shape CHECK above guarantees at most one of the two FKs is ever populated on a given row).';
comment on constraint semantic_representations_candidate_fkey on gov_repo.semantic_representations is
  'Only enforced when subject_kind = NORMALIZED_CANDIDATE. See semantic_representations_canonical_object_fkey.';

create index idx_semantic_representations_org
  on gov_repo.semantic_representations (organisation_id);
create index idx_semantic_representations_canonical_object
  on gov_repo.semantic_representations (organisation_id, subject_canonical_object_id)
  where subject_canonical_object_id is not null;
create index idx_semantic_representations_candidate
  on gov_repo.semantic_representations (organisation_id, subject_candidate_id)
  where subject_candidate_id is not null;

-- -----------------------------------------------------------------------------
-- C. PROVENANCE — representation-level (not per-field: unlike
--    AgentVersionTechnicalProfile, a SemanticRepresentation is one atomic
--    projection, not several independently-enrichable fields) SourceAssertion/
--    Evidence membership. Provenance identity never contaminates the content
--    fingerprint (contracts.ts's SemanticContentFingerprint is computed
--    exclusively from the projection, never from assertion/evidence ids).
-- -----------------------------------------------------------------------------

create table gov_repo.semantic_representation_assertions (
  organisation_id     uuid not null,
  representation_id   text not null,
  assertion_id        text not null,
  constraint semantic_representation_assertions_pkey
    primary key (organisation_id, representation_id, assertion_id),
  constraint semantic_representation_assertions_representation_fkey
    foreign key (organisation_id, representation_id)
    references gov_repo.semantic_representations (organisation_id, representation_id),
  constraint semantic_representation_assertions_assertion_fkey
    foreign key (organisation_id, assertion_id)
    references gov_repo.source_assertions (organisation_id, assertion_id)
);
comment on table gov_repo.semantic_representation_assertions is
  'SourceAssertionId membership supporting one SemanticRepresentation. Provenance only — never a semantic value, never a generic EAV store.';
create index idx_semantic_representation_assertions_org
  on gov_repo.semantic_representation_assertions (organisation_id);

create table gov_repo.semantic_representation_evidence (
  organisation_id     uuid not null,
  representation_id   text not null,
  evidence_id         text not null,
  constraint semantic_representation_evidence_pkey
    primary key (organisation_id, representation_id, evidence_id),
  constraint semantic_representation_evidence_representation_fkey
    foreign key (organisation_id, representation_id)
    references gov_repo.semantic_representations (organisation_id, representation_id),
  constraint semantic_representation_evidence_evidence_fkey
    foreign key (organisation_id, evidence_id)
    references gov_repo.discovery_evidence (organisation_id, evidence_id)
);
comment on table gov_repo.semantic_representation_evidence is
  'EvidenceId membership supporting one SemanticRepresentation.';
create index idx_semantic_representation_evidence_org
  on gov_repo.semantic_representation_evidence (organisation_id);

-- -----------------------------------------------------------------------------
-- D. IMMUTABILITY — every table in this migration is append-only. A
--    SemanticRepresentation is a permanent analytical fact: a changed input
--    always produces a new representation_id (and therefore a new row),
--    never an UPDATE of an existing one.
-- -----------------------------------------------------------------------------

create or replace rule semantic_representations_no_update as
  on update to gov_repo.semantic_representations do instead nothing;
create or replace rule semantic_representations_no_delete as
  on delete to gov_repo.semantic_representations do instead nothing;
create or replace rule semantic_representation_assertions_no_update as
  on update to gov_repo.semantic_representation_assertions do instead nothing;
create or replace rule semantic_representation_assertions_no_delete as
  on delete to gov_repo.semantic_representation_assertions do instead nothing;
create or replace rule semantic_representation_evidence_no_update as
  on update to gov_repo.semantic_representation_evidence do instead nothing;
create or replace rule semantic_representation_evidence_no_delete as
  on delete to gov_repo.semantic_representation_evidence do instead nothing;

-- -----------------------------------------------------------------------------
-- E. ROW LEVEL SECURITY — matches every adjacent Decision-to-Truth table in
--    this history exactly: service_role only, no authenticated-role policy.
--    Tenant isolation is enforced by (organisation_id, ...) composite
--    primary keys/FKs throughout plus explicit organisation_id parameter
--    verification inside the function below.
-- -----------------------------------------------------------------------------

alter table gov_repo.semantic_representations enable row level security;
alter table gov_repo.semantic_representation_assertions enable row level security;
alter table gov_repo.semantic_representation_evidence enable row level security;

revoke all on table
  gov_repo.semantic_representations,
  gov_repo.semantic_representation_assertions,
  gov_repo.semantic_representation_evidence
from public, anon, authenticated;

create policy "Service role access to semantic_representations" on gov_repo.semantic_representations for all to service_role using (true) with check (true);
create policy "Service role access to semantic_representation_assertions" on gov_repo.semantic_representation_assertions for all to service_role using (true) with check (true);
create policy "Service role access to semantic_representation_evidence" on gov_repo.semantic_representation_evidence for all to service_role using (true) with check (true);

-- -----------------------------------------------------------------------------
-- F. RECORD REPRESENTATION — the only write path. Verifies, before any
--    write: the subject (CanonicalObject or NormalizedCandidate) exists in
--    this organisation and its actual kind matches the declared subject
--    kind; the declared embedding_dimension matches the actual vector
--    length. Idempotent on (organisation_id, representation_id): a replay
--    of an identical id is detected and returned before any write; a reused
--    id whose stored scalar identity fields differ fails closed rather than
--    silently discarding either value. Never creates, mutates, certifies,
--    or reconciles a canonical object or relationship — there is no
--    governance gate here because a SemanticRepresentation carries zero
--    canonical authority, unlike AgentVersionTechnicalProfile.
--
--    Known limitation: exact numeric equality of the stored embedding
--    vector itself is not part of the idempotency-conflict check (only the
--    scalar identity fields — content fingerprint, provider/model/version,
--    dimension — are compared). Because representation_id is expected to be
--    content-addressed over exactly those same scalar fields plus the
--    subject and projection schema version, and because the current
--    round's embedding-provider is a deterministic test-only function
--    (never a live external API), this is sufficient for this milestone;
--    a future round wiring a live, potentially non-bit-exact provider
--    should revisit this before relying on it for anything beyond
--    replay detection.
-- -----------------------------------------------------------------------------

create or replace function gov_repo.record_semantic_representation(
  p_organisation_id                    uuid,
  p_representation_id                  text,
  p_subject_kind                       text,
  p_subject_canonical_object_id        text,
  p_subject_canonical_object_kind      text,
  p_subject_candidate_id               text,
  p_subject_candidate_kind             text,
  p_projection_schema_version          text,
  p_content_fingerprint_algorithm      text,
  p_content_fingerprint_schema_version text,
  p_content_fingerprint_value          text,
  p_embedding_provider_id              text,
  p_embedding_model_id                 text,
  p_embedding_model_version            text,
  p_embedding_dimension                integer,
  p_embedding                          vector,
  p_assertion_ids                      text[],
  p_evidence_ids                       text[],
  p_generated_at                       timestamptz
)
returns table (
  replay            boolean,
  representation_id text
)
language plpgsql
volatile
security invoker
set search_path = 'gov_repo', 'pg_catalog'
as $$
declare
  v_existing  gov_repo.semantic_representations%rowtype;
  v_object    gov_repo.canonical_objects%rowtype;
  v_candidate gov_repo.discovery_candidates%rowtype;
begin
  if p_representation_id is null or btrim(p_representation_id) = '' then
    raise exception using errcode = '22004', message = 'representation_id is required';
  end if;

  if p_subject_kind = 'CANONICAL_OBJECT' then
    if p_subject_canonical_object_id is null or p_subject_canonical_object_kind is null
       or p_subject_candidate_id is not null or p_subject_candidate_kind is not null
    then
      raise exception using
        errcode = '22023', message = 'SUBJECT_REFERENCE_MALFORMED',
        detail = 'CANONICAL_OBJECT subject requires canonical_object_id/kind and forbids candidate fields';
    end if;

    select * into v_object
    from gov_repo.canonical_objects as co
    where co.organisation_id = p_organisation_id and co.canonical_object_id = p_subject_canonical_object_id;
    if not found then
      raise exception using errcode = 'P0002', message = 'SUBJECT_CANONICAL_OBJECT_NOT_FOUND';
    end if;
    if v_object.kind <> p_subject_canonical_object_kind then
      raise exception using
        errcode = '22023', message = 'SUBJECT_KIND_MISMATCH',
        detail = format('canonical_object_id %s is kind %s, not %s', p_subject_canonical_object_id, v_object.kind, p_subject_canonical_object_kind);
    end if;
  elsif p_subject_kind = 'NORMALIZED_CANDIDATE' then
    if p_subject_candidate_id is null or p_subject_candidate_kind is null
       or p_subject_canonical_object_id is not null or p_subject_canonical_object_kind is not null
    then
      raise exception using
        errcode = '22023', message = 'SUBJECT_REFERENCE_MALFORMED',
        detail = 'NORMALIZED_CANDIDATE subject requires candidate_id/kind and forbids canonical object fields';
    end if;

    select * into v_candidate
    from gov_repo.discovery_candidates as dc
    where dc.organisation_id = p_organisation_id and dc.candidate_id = p_subject_candidate_id;
    if not found then
      raise exception using errcode = 'P0002', message = 'SUBJECT_CANDIDATE_NOT_FOUND';
    end if;
    if v_candidate.candidate_kind <> p_subject_candidate_kind then
      raise exception using
        errcode = '22023', message = 'SUBJECT_KIND_MISMATCH',
        detail = format('candidate_id %s is kind %s, not %s', p_subject_candidate_id, v_candidate.candidate_kind, p_subject_candidate_kind);
    end if;
  else
    raise exception using errcode = '22023', message = 'SUBJECT_KIND_INVALID', detail = coalesce(p_subject_kind, '<null>');
  end if;

  if p_embedding_dimension is null or p_embedding_dimension <= 0 then
    raise exception using errcode = '22023', message = 'EMBEDDING_DIMENSION_INVALID';
  end if;
  if vector_dims(p_embedding) <> p_embedding_dimension then
    raise exception using
      errcode = '22023', message = 'EMBEDDING_DIMENSION_MISMATCH',
      detail = format('declared dimension %s does not match actual vector length %s', p_embedding_dimension, vector_dims(p_embedding));
  end if;

  select * into v_existing
  from gov_repo.semantic_representations as r
  where r.organisation_id = p_organisation_id and r.representation_id = p_representation_id;

  if found then
    if v_existing.subject_kind is distinct from p_subject_kind
       or v_existing.subject_canonical_object_id is distinct from p_subject_canonical_object_id
       or v_existing.subject_canonical_object_kind is distinct from p_subject_canonical_object_kind
       or v_existing.subject_candidate_id is distinct from p_subject_candidate_id
       or v_existing.subject_candidate_kind is distinct from p_subject_candidate_kind
       or v_existing.projection_schema_version is distinct from p_projection_schema_version
       or v_existing.content_fingerprint_algorithm is distinct from p_content_fingerprint_algorithm
       or v_existing.content_fingerprint_schema_version is distinct from p_content_fingerprint_schema_version
       or v_existing.content_fingerprint_value is distinct from p_content_fingerprint_value
       or v_existing.embedding_provider_id is distinct from p_embedding_provider_id
       or v_existing.embedding_model_id is distinct from p_embedding_model_id
       or v_existing.embedding_model_version is distinct from p_embedding_model_version
       or v_existing.embedding_dimension is distinct from p_embedding_dimension
    then
      raise exception using
        errcode = '23514', message = 'SEMANTIC_REPRESENTATION_IDEMPOTENCY_CONFLICT',
        detail = format('representation_id %s already exists with different content', p_representation_id);
    end if;
    return query select true, p_representation_id;
    return;
  end if;

  begin
    insert into gov_repo.semantic_representations (
      organisation_id, representation_id, subject_kind,
      subject_canonical_object_id, subject_canonical_object_kind,
      subject_candidate_id, subject_candidate_kind,
      projection_schema_version,
      content_fingerprint_algorithm, content_fingerprint_schema_version, content_fingerprint_value,
      embedding_provider_id, embedding_model_id, embedding_model_version, embedding_dimension,
      embedding, generated_at
    ) values (
      p_organisation_id, p_representation_id, p_subject_kind,
      p_subject_canonical_object_id, p_subject_canonical_object_kind,
      p_subject_candidate_id, p_subject_candidate_kind,
      p_projection_schema_version,
      p_content_fingerprint_algorithm, p_content_fingerprint_schema_version, p_content_fingerprint_value,
      p_embedding_provider_id, p_embedding_model_id, p_embedding_model_version, p_embedding_dimension,
      p_embedding, p_generated_at
    );

    insert into gov_repo.semantic_representation_assertions (organisation_id, representation_id, assertion_id)
    select p_organisation_id, p_representation_id, unnest(coalesce(p_assertion_ids, '{}'))
    on conflict do nothing;

    insert into gov_repo.semantic_representation_evidence (organisation_id, representation_id, evidence_id)
    select p_organisation_id, p_representation_id, unnest(coalesce(p_evidence_ids, '{}'))
    on conflict do nothing;

    return query select false, p_representation_id;
    return;
  exception
    when unique_violation then
      -- A concurrent racing call won the insert first. Re-select and apply
      -- the identical content-match rule as above rather than assuming the
      -- race winner's content matches ours.
      select * into v_existing
      from gov_repo.semantic_representations as r
      where r.organisation_id = p_organisation_id and r.representation_id = p_representation_id;

      if v_existing.content_fingerprint_value is distinct from p_content_fingerprint_value
         or v_existing.embedding_provider_id is distinct from p_embedding_provider_id
         or v_existing.embedding_model_id is distinct from p_embedding_model_id
         or v_existing.embedding_model_version is distinct from p_embedding_model_version
         or v_existing.embedding_dimension is distinct from p_embedding_dimension
      then
        raise exception using
          errcode = '23514', message = 'SEMANTIC_REPRESENTATION_IDEMPOTENCY_CONFLICT',
          detail = format('representation_id %s already exists with different content', p_representation_id);
      end if;
      return query select true, p_representation_id;
      return;
  end;
end;
$$;

comment on function gov_repo.record_semantic_representation is
  'The only write path for a SemanticRepresentation. Verifies the subject (CanonicalObject or NormalizedCandidate) exists in this organisation and that its actual kind matches the declared subject kind, and that the declared embedding_dimension matches the actual vector length, before any write. Idempotent on (organisation_id, representation_id), checked and returned before any write. Never creates, mutates, certifies, or reconciles a canonical object or relationship — a SemanticRepresentation carries zero canonical authority. SECURITY INVOKER, service_role only.';

-- -----------------------------------------------------------------------------
-- G. PERMISSIONS — EXECUTE revoked from PUBLIC/anon/authenticated, granted
--    only to service_role. Postgres grants EXECUTE to PUBLIC by default on
--    new functions, so this revoke is mandatory, not optional.
-- -----------------------------------------------------------------------------

revoke all on function gov_repo.record_semantic_representation from public, anon, authenticated;
grant execute on function gov_repo.record_semantic_representation to service_role;

commit;
