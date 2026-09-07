-- =============================================================================
-- CODEGUARD AI GOVERNANCE OS
-- Migration: 20260907120000_discovery_governance_input_persistence_v1
-- Domain:    Discovery Governance Input Persistence V1 — the durability
--            contract between the existing, closed Discovery Intake V1
--            (20260906180000_discovery_intake_v1.sql) and the existing,
--            closed Reconciliation Factory (packages/governance-review
--            invokeObjectReconciliation / invokeRelationshipReconciliation).
--
-- Architectural gap this migration closes: invokeObjectReconciliation /
-- invokeRelationshipReconciliation require the exact original
-- DiscoveryFinding + NormalizedCandidate that produced a CERTIFIED
-- ReviewSubject. gov_repo.review_subjects (Governance Persistence V1)
-- intentionally stores only governance references (finding_id, candidate_kind,
-- source_*, assertion/evidence membership) — never the finding's or
-- candidate's own governed content (confidence, reviewStatus, proposedIdentity,
-- relationship endpoints). Before this migration, that content existed only in
-- the TypeScript memory of the original Discovery Intake call and was
-- unrecoverable once that call returned.
--
-- This migration does NOT redesign packages/scanner, packages/governance-review,
-- packages/canonical-contracts, or any prior migration (governance_persistence_v1,
-- canonical_materialization_v1, discovery_intake_v1, governance_workspace_queue_v1
-- are all byte-for-byte untouched). It only adds durable storage for exactly
-- the DiscoveryFinding / NormalizedCandidate shapes those closed packages
-- already produce.
--
-- Real cardinality (never assumed 1:1 — see governance-review's own
-- reconciliation-input-recovery.ts doc comment): a DiscoveryFinding always
-- exists; a NormalizedCandidate exists for it 0 or 1 times. RELATIONSHIP
-- findings always have exactly one co-generated candidate
-- (packages/scanner/src/discovery/relationship-correlation.ts). OBJECT-kind
-- findings (AGENT/MODEL/TOOL/...) have zero today — no NormalizedObjectCandidate
-- producer exists anywhere in this repository yet (object identity
-- normalization is a distinct, out-of-scope future milestone;
-- apps/dashboard/lib/governance/discovery-intake.ts always passes
-- candidate: undefined for object findings). gov_repo.discovery_candidates
-- therefore carries a real UNIQUE (organisation_id, finding_id) constraint,
-- not a fabricated one.
--
-- Hard gate enforced here: gov_repo.review_subjects gains a composite FK into
-- the new gov_repo.discovery_findings table (added NOT VALID — this
-- controlled project already carries real historical review_subjects rows
-- from prior milestones' runtime validations, predating this migration; the
-- FK is enforced unconditionally for every future write without requiring
-- that pre-existing data retroactively satisfy an invariant introduced after
-- it was written). A ReviewSubject created after this migration can never
-- durably exist without its durable DiscoveryFinding already recorded.
--
-- Legacy policy: pre-existing ReviewSubjects have no durable Finding/Candidate
-- and this migration fabricates none for them. A reconciliation-input read
-- for one of those subjects is expected to, and must, come back
-- INPUT_UNAVAILABLE (see governance-review's recoverReconciliationInput) —
-- that is correct, honest behavior, not a defect.
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
      message = 'Cannot apply discovery governance input persistence migration.',
      hint = 'Schema gov_repo does not exist; foundation migrations must run first.';
  end if;

  if to_regclass('gov_repo.review_subjects') is null
     or to_regclass('gov_repo.acquisition_runs') is null
     or to_regclass('gov_repo.source_assertions') is null
     or to_regclass('gov_repo.discovery_evidence') is null
  then
    raise exception using
      errcode = '3F000',
      message = 'Cannot apply discovery governance input persistence migration.',
      hint = 'Governance Persistence V1 / Discovery Intake V1 tables are missing; those migrations must run first.';
  end if;

  if to_regclass('gov_repo.discovery_findings') is not null
     or to_regclass('gov_repo.discovery_finding_assertions') is not null
     or to_regclass('gov_repo.discovery_finding_evidence') is not null
     or to_regclass('gov_repo.discovery_candidates') is not null
     or to_regclass('gov_repo.discovery_candidate_assertions') is not null
     or to_regclass('gov_repo.discovery_candidate_evidence') is not null
  then
    raise exception using
      errcode = '42P07',
      message = 'Cannot apply discovery governance input persistence migration.',
      hint = 'One or more target tables already exist; resolve the naming collision before retrying.';
  end if;
end;
$preflight$;

-- -----------------------------------------------------------------------------
-- A. DISCOVERY FINDINGS — durable content for the exact canonical-contracts
--    DiscoveryFinding (packages/canonical-contracts DiscoveryFinding<Kind>),
--    immutable once written. candidate_kind covers every DiscoveryCandidateKind
--    (11 CanonicalObjectKind values plus the discovery-only RELATIONSHIP kind).
-- -----------------------------------------------------------------------------

create table gov_repo.discovery_findings (
  organisation_id            uuid        not null references gov_repo.organisations (organisation_id),
  finding_id                 text        not null,
  finding_nature             text        not null,
  candidate_kind             text        not null,
  source_connection_id       text        not null,
  source_external_type       text        not null,
  source_external_id         text        not null,
  confidence                 double precision not null,
  review_status              text        not null,
  requires_review            boolean     not null,
  creates_canonical_object   boolean     not null,
  detected_at                timestamptz not null,
  acquisition_run_id         text        not null,
  contract_version           text        not null,
  envelope                   jsonb       not null,
  envelope_hash              char(64)    not null,
  created_at                 timestamptz not null default now(),
  constraint discovery_findings_pkey primary key (organisation_id, finding_id),
  constraint discovery_findings_finding_nature_check check (finding_nature = 'CANDIDATE'),
  constraint discovery_findings_candidate_kind_check check (candidate_kind in (
    'AGENT','AGENT_VERSION','MODEL','TOOL','MCP_SERVER','API','PROMPT',
    'KNOWLEDGE_BASE','DATA_ASSET','DATA_ELEMENT','SKILL','RELATIONSHIP'
  )),
  constraint discovery_findings_confidence_range_check check (confidence >= 0 and confidence <= 1),
  constraint discovery_findings_review_status_check
    check (review_status in ('UNREVIEWED','ACCEPTED','REJECTED','DUPLICATE','SUPERSEDED')),
  constraint discovery_findings_requires_review_check check (requires_review = true),
  constraint discovery_findings_creates_canonical_object_check check (creates_canonical_object = false),
  constraint discovery_findings_envelope_hash_format_check check (envelope_hash ~ '^[0-9a-f]{64}$'),
  constraint discovery_findings_run_fkey
    foreign key (organisation_id, acquisition_run_id)
    references gov_repo.acquisition_runs (organisation_id, run_id)
);

comment on table gov_repo.discovery_findings is
  'IMMUTABLE durable content for one canonical-contracts DiscoveryFinding (packages/canonical-contracts DiscoveryFinding<DiscoveryCandidateKind>). Primary key is (organisation_id, finding_id): findingId is a scanner-generated content hash with no tenant concept, so a bare global primary key would risk a cross-tenant collision. envelope is the authoritative full DiscoveryFinding object; the adapter recomputes envelope_hash on every read and rejects a mismatch. Every ReviewSubject created after this migration must reference a finding already durable here (see review_subjects_finding_fkey below) — this is the exact input invokeObjectReconciliation/invokeRelationshipReconciliation require once a subject reaches CERTIFIED, and it is otherwise unrecoverable once the original intake call returns.';

create index idx_discovery_findings_org on gov_repo.discovery_findings (organisation_id);
create index idx_discovery_findings_run on gov_repo.discovery_findings (organisation_id, acquisition_run_id);

create table gov_repo.discovery_finding_assertions (
  organisation_id uuid not null,
  finding_id      text not null,
  assertion_id    text not null,
  constraint discovery_finding_assertions_pkey primary key (organisation_id, finding_id, assertion_id),
  constraint discovery_finding_assertions_finding_fkey
    foreign key (organisation_id, finding_id)
    references gov_repo.discovery_findings (organisation_id, finding_id),
  constraint discovery_finding_assertions_assertion_fkey
    foreign key (organisation_id, assertion_id)
    references gov_repo.source_assertions (organisation_id, assertion_id)
);
comment on table gov_repo.discovery_finding_assertions is
  'Normalized SourceAssertionId membership for one immutable DiscoveryFinding. The assertion_id FK means a finding can never durably cite an assertion that was not itself already durably persisted.';
create index idx_discovery_finding_assertions_org on gov_repo.discovery_finding_assertions (organisation_id);

create table gov_repo.discovery_finding_evidence (
  organisation_id uuid not null,
  finding_id      text not null,
  evidence_id     text not null,
  constraint discovery_finding_evidence_pkey primary key (organisation_id, finding_id, evidence_id),
  constraint discovery_finding_evidence_finding_fkey
    foreign key (organisation_id, finding_id)
    references gov_repo.discovery_findings (organisation_id, finding_id),
  constraint discovery_finding_evidence_evidence_fkey
    foreign key (organisation_id, evidence_id)
    references gov_repo.discovery_evidence (organisation_id, evidence_id)
);
comment on table gov_repo.discovery_finding_evidence is
  'Normalized EvidenceId membership for one immutable DiscoveryFinding. The evidence_id FK means a finding can never durably cite evidence that was not itself already durably persisted.';
create index idx_discovery_finding_evidence_org on gov_repo.discovery_finding_evidence (organisation_id);

-- -----------------------------------------------------------------------------
-- B. DISCOVERY CANDIDATES — durable content for the exact canonical-contracts
--    NormalizedCandidate (NormalizedObjectCandidate | NormalizedRelationshipCandidate),
--    immutable once written. UNIQUE (organisation_id, finding_id) encodes the
--    real current cardinality (a finding has at most one candidate today) —
--    never assumed, established by reading relationship-correlation.ts and
--    discovery-intake.ts (see migration header).
-- -----------------------------------------------------------------------------

create table gov_repo.discovery_candidates (
  organisation_id          uuid        not null references gov_repo.organisations (organisation_id),
  candidate_id             text        not null,
  candidate_kind           text        not null,
  candidate_family         text        not null,
  finding_id               text        not null,
  source_connection_id     text        not null,
  source_external_type     text        not null,
  source_external_id       text        not null,
  confidence               double precision not null,
  requires_reconciliation  boolean     not null,
  proposed_identity        jsonb,
  relationship_type_code   text,
  source_endpoint          jsonb,
  target_endpoint          jsonb,
  acquisition_run_id       text        not null,
  contract_version         text        not null,
  envelope                 jsonb       not null,
  envelope_hash            char(64)    not null,
  created_at               timestamptz not null default now(),
  constraint discovery_candidates_pkey primary key (organisation_id, candidate_id),
  constraint discovery_candidates_candidate_kind_check check (candidate_kind in (
    'AGENT','AGENT_VERSION','MODEL','TOOL','MCP_SERVER','API','PROMPT',
    'KNOWLEDGE_BASE','DATA_ASSET','DATA_ELEMENT','SKILL','RELATIONSHIP'
  )),
  constraint discovery_candidates_family_check check (candidate_family in ('OBJECT','RELATIONSHIP')),
  constraint discovery_candidates_family_kind_check
    check ((candidate_family = 'RELATIONSHIP') = (candidate_kind = 'RELATIONSHIP')),
  constraint discovery_candidates_family_fields_check check (
    (candidate_family = 'RELATIONSHIP'
      and relationship_type_code is not null
      and source_endpoint is not null
      and target_endpoint is not null
      and proposed_identity is null)
    or
    (candidate_family = 'OBJECT'
      and relationship_type_code is null
      and source_endpoint is null
      and target_endpoint is null)
  ),
  constraint discovery_candidates_confidence_range_check check (confidence >= 0 and confidence <= 1),
  constraint discovery_candidates_requires_reconciliation_check check (requires_reconciliation = true),
  constraint discovery_candidates_envelope_hash_format_check check (envelope_hash ~ '^[0-9a-f]{64}$'),
  constraint discovery_candidates_finding_fkey
    foreign key (organisation_id, finding_id)
    references gov_repo.discovery_findings (organisation_id, finding_id),
  constraint discovery_candidates_run_fkey
    foreign key (organisation_id, acquisition_run_id)
    references gov_repo.acquisition_runs (organisation_id, run_id),
  -- Real current cardinality: at most one durable candidate per finding. Not
  -- a design assumption — this is what packages/scanner and
  -- apps/dashboard/lib/governance/discovery-intake.ts actually produce today
  -- (see migration header). A future multi-candidate-per-finding producer
  -- would require a deliberate schema change here, never a silent violation.
  constraint discovery_candidates_finding_unique unique (organisation_id, finding_id)
);

comment on table gov_repo.discovery_candidates is
  'IMMUTABLE durable content for one canonical-contracts NormalizedCandidate (NormalizedObjectCandidate | NormalizedRelationshipCandidate). Primary key is (organisation_id, candidate_id) for the same cross-tenant-collision reason as gov_repo.discovery_findings. envelope is the authoritative full candidate object (proposedIdentity / relationship endpoints and all); the relational proposed_identity/relationship_type_code/source_endpoint/target_endpoint columns exist for query/integrity-check convenience only and are never trusted over envelope on read. UNIQUE (organisation_id, finding_id) encodes the real current 1-finding-to-0-or-1-candidate cardinality: RELATIONSHIP candidates are always produced 1:1 with their finding (packages/scanner relationship-correlation.ts); no NormalizedObjectCandidate producer exists anywhere in this repository yet, so no OBJECT-kind finding has a durable candidate today — this table stores none for them rather than fabricating one.';

create index idx_discovery_candidates_org on gov_repo.discovery_candidates (organisation_id);
create index idx_discovery_candidates_run on gov_repo.discovery_candidates (organisation_id, acquisition_run_id);

create table gov_repo.discovery_candidate_assertions (
  organisation_id uuid not null,
  candidate_id    text not null,
  assertion_id    text not null,
  constraint discovery_candidate_assertions_pkey primary key (organisation_id, candidate_id, assertion_id),
  constraint discovery_candidate_assertions_candidate_fkey
    foreign key (organisation_id, candidate_id)
    references gov_repo.discovery_candidates (organisation_id, candidate_id),
  constraint discovery_candidate_assertions_assertion_fkey
    foreign key (organisation_id, assertion_id)
    references gov_repo.source_assertions (organisation_id, assertion_id)
);
comment on table gov_repo.discovery_candidate_assertions is
  'Normalized SourceAssertionId membership for one immutable NormalizedCandidate.';
create index idx_discovery_candidate_assertions_org on gov_repo.discovery_candidate_assertions (organisation_id);

create table gov_repo.discovery_candidate_evidence (
  organisation_id uuid not null,
  candidate_id    text not null,
  evidence_id     text not null,
  constraint discovery_candidate_evidence_pkey primary key (organisation_id, candidate_id, evidence_id),
  constraint discovery_candidate_evidence_candidate_fkey
    foreign key (organisation_id, candidate_id)
    references gov_repo.discovery_candidates (organisation_id, candidate_id),
  constraint discovery_candidate_evidence_evidence_fkey
    foreign key (organisation_id, evidence_id)
    references gov_repo.discovery_evidence (organisation_id, evidence_id)
);
comment on table gov_repo.discovery_candidate_evidence is
  'Normalized EvidenceId membership for one immutable NormalizedCandidate.';
create index idx_discovery_candidate_evidence_org on gov_repo.discovery_candidate_evidence (organisation_id);

-- -----------------------------------------------------------------------------
-- C. HARD GATE — a ReviewSubject created after this migration must never
--    point to a findingId that exists only in TypeScript memory. Pure ADD
--    CONSTRAINT against the existing gov_repo.review_subjects table, never
--    editing that historical migration file.
--
--    Added NOT VALID for the same reason as discovery_intake_v1's own hard
--    gates: this controlled project already carries real review_subjects
--    rows from prior milestones' controlled runtime validations, referencing
--    findingIds that predate this migration and were never meant to be
--    durable DiscoveryFinding content. NOT VALID enforces this FK for every
--    row inserted or updated from this migration forward without requiring
--    that pre-existing historical data satisfy an invariant introduced after
--    it was written.
-- -----------------------------------------------------------------------------

alter table gov_repo.review_subjects
  add constraint review_subjects_finding_fkey
  foreign key (organisation_id, finding_id)
  references gov_repo.discovery_findings (organisation_id, finding_id)
  not valid;

comment on constraint review_subjects_finding_fkey on gov_repo.review_subjects is
  'Discovery Governance Input Persistence V1 hard gate: gov_repo.create_review_subject can only durably succeed for a findingId that is already a row in gov_repo.discovery_findings. No DiscoveryFinding may exist only in TypeScript memory once referenced by a persisted ReviewSubject. Pre-existing ReviewSubjects predating this migration are intentionally left unvalidated (NOT VALID) and their reconciliation input correctly reads back as unavailable, never fabricated.';

-- -----------------------------------------------------------------------------
-- D. IMMUTABILITY — DiscoveryFinding, NormalizedCandidate, and their
--    membership are write-once, mirroring every prior migration's pattern.
-- -----------------------------------------------------------------------------

create or replace rule discovery_findings_no_update as
  on update to gov_repo.discovery_findings do instead nothing;
create or replace rule discovery_findings_no_delete as
  on delete to gov_repo.discovery_findings do instead nothing;

create or replace rule discovery_finding_assertions_no_update as
  on update to gov_repo.discovery_finding_assertions do instead nothing;
create or replace rule discovery_finding_assertions_no_delete as
  on delete to gov_repo.discovery_finding_assertions do instead nothing;

create or replace rule discovery_finding_evidence_no_update as
  on update to gov_repo.discovery_finding_evidence do instead nothing;
create or replace rule discovery_finding_evidence_no_delete as
  on delete to gov_repo.discovery_finding_evidence do instead nothing;

create or replace rule discovery_candidates_no_update as
  on update to gov_repo.discovery_candidates do instead nothing;
create or replace rule discovery_candidates_no_delete as
  on delete to gov_repo.discovery_candidates do instead nothing;

create or replace rule discovery_candidate_assertions_no_update as
  on update to gov_repo.discovery_candidate_assertions do instead nothing;
create or replace rule discovery_candidate_assertions_no_delete as
  on delete to gov_repo.discovery_candidate_assertions do instead nothing;

create or replace rule discovery_candidate_evidence_no_update as
  on update to gov_repo.discovery_candidate_evidence do instead nothing;
create or replace rule discovery_candidate_evidence_no_delete as
  on delete to gov_repo.discovery_candidate_evidence do instead nothing;

-- -----------------------------------------------------------------------------
-- E. ROW LEVEL SECURITY — server-side privileged persistence boundary only,
--    matching every prior migration exactly: no authenticated-role policy in
--    this milestone, service_role only, never USING(true) for any future
--    authenticated policy.
-- -----------------------------------------------------------------------------

alter table gov_repo.discovery_findings enable row level security;
alter table gov_repo.discovery_finding_assertions enable row level security;
alter table gov_repo.discovery_finding_evidence enable row level security;
alter table gov_repo.discovery_candidates enable row level security;
alter table gov_repo.discovery_candidate_assertions enable row level security;
alter table gov_repo.discovery_candidate_evidence enable row level security;

revoke all on table
  gov_repo.discovery_findings,
  gov_repo.discovery_finding_assertions,
  gov_repo.discovery_finding_evidence,
  gov_repo.discovery_candidates,
  gov_repo.discovery_candidate_assertions,
  gov_repo.discovery_candidate_evidence
from public, anon, authenticated;

create policy "Service role has full access to discovery_findings" on gov_repo.discovery_findings for all to service_role using (true) with check (true);
create policy "Service role access to discovery_finding_assertions" on gov_repo.discovery_finding_assertions for all to service_role using (true) with check (true);
create policy "Service role access to discovery_finding_evidence" on gov_repo.discovery_finding_evidence for all to service_role using (true) with check (true);
create policy "Service role has full access to discovery_candidates" on gov_repo.discovery_candidates for all to service_role using (true) with check (true);
create policy "Service role access to discovery_candidate_assertions" on gov_repo.discovery_candidate_assertions for all to service_role using (true) with check (true);
create policy "Service role access to discovery_candidate_evidence" on gov_repo.discovery_candidate_evidence for all to service_role using (true) with check (true);

-- -----------------------------------------------------------------------------
-- F. TRANSACTIONAL RPCs (Unit of Work). SECURITY INVOKER, explicit
--    search_path, EXECUTE revoked from PUBLIC/anon/authenticated and granted
--    only to service_role — mirrors every prior migration exactly.
-- -----------------------------------------------------------------------------

-- F.1 — Idempotent durable persistence of one DiscoveryFinding plus its
-- normalized assertion/evidence membership. Exactly like
-- record_discovery_evidence / record_discovery_source_assertion, a reused
-- finding_id for the same tenant is always treated as a pure replay with no
-- content comparison: findingId is a content hash of the fields that make
-- two observations semantically the same (source connection, locator,
-- detection method/version, match position/content, candidateKind) and
-- deliberately EXCLUDES detectedAt — a rescan of unchanged content legitimately
-- reproduces the identical finding_id with a different (real, later)
-- detectedAt, and that must be a plain replay, never a conflict. First insert
-- wins (its envelope, detectedAt included, is what stays durable).
create or replace function gov_repo.record_discovery_finding(
  p_finding_id               text,
  p_organisation_id          uuid,
  p_finding_nature           text,
  p_candidate_kind           text,
  p_source_connection_id     text,
  p_source_external_type     text,
  p_source_external_id       text,
  p_confidence               double precision,
  p_review_status            text,
  p_requires_review          boolean,
  p_creates_canonical_object boolean,
  p_detected_at              timestamptz,
  p_acquisition_run_id       text,
  p_assertion_ids            text[],
  p_evidence_ids             text[],
  p_contract_version         text,
  p_envelope                 jsonb,
  p_envelope_hash            char(64)
)
returns table (
  replay      boolean,
  finding_id  text
)
language plpgsql
volatile
security invoker
set search_path = 'gov_repo', 'pg_catalog'
as $$
begin
  if p_finding_id is null or btrim(p_finding_id) = '' then
    raise exception using errcode = '22004', message = 'finding_id is required';
  end if;

  begin
    insert into gov_repo.discovery_findings (
      organisation_id, finding_id, finding_nature, candidate_kind,
      source_connection_id, source_external_type, source_external_id,
      confidence, review_status, requires_review, creates_canonical_object,
      detected_at, acquisition_run_id, contract_version, envelope, envelope_hash
    ) values (
      p_organisation_id, p_finding_id, p_finding_nature, p_candidate_kind,
      p_source_connection_id, p_source_external_type, p_source_external_id,
      p_confidence, p_review_status, p_requires_review, p_creates_canonical_object,
      p_detected_at, p_acquisition_run_id, p_contract_version, p_envelope, p_envelope_hash
    );

    insert into gov_repo.discovery_finding_assertions (organisation_id, finding_id, assertion_id)
    select p_organisation_id, p_finding_id, unnested.value
    from unnest(coalesce(p_assertion_ids, '{}')) as unnested(value);

    insert into gov_repo.discovery_finding_evidence (organisation_id, finding_id, evidence_id)
    select p_organisation_id, p_finding_id, unnested.value
    from unnest(coalesce(p_evidence_ids, '{}')) as unnested(value);

    return query select false, p_finding_id;
    return;
  exception
    when unique_violation then
      return query select true, p_finding_id;
      return;
  end;
end;
$$;

comment on function gov_repo.record_discovery_finding is
  'Idempotent durable persistence of one canonical-contracts DiscoveryFinding plus normalized assertion/evidence membership, tenant-scoped by (organisation_id, finding_id). A reused finding_id for the same tenant always replays (first insert wins; findingId already excludes detectedAt — the only field expected to vary across a rescan of unchanged content, exactly like discovery_evidence/source_assertions exclude their own wall-clock fields) — no content comparison is performed, matching that established precedent. Uses a check-then-insert-with-exception-handler (not ON CONFLICT) because the table is immutable via a rewrite RULE. SECURITY INVOKER, service_role only.';

-- F.2 — Idempotent durable persistence of one NormalizedCandidate plus its
-- normalized assertion/evidence membership. Validates the candidate/finding
-- association (kind + source object) against the already-durable parent
-- finding before ever attempting to insert — mirrors governance-review's own
-- createReviewSubject / recoverReconciliationInput consistency checks at the
-- database layer as defense in depth.
create or replace function gov_repo.record_discovery_candidate(
  p_candidate_id             text,
  p_organisation_id          uuid,
  p_candidate_kind           text,
  p_candidate_family         text,
  p_finding_id               text,
  p_source_connection_id     text,
  p_source_external_type     text,
  p_source_external_id       text,
  p_confidence               double precision,
  p_requires_reconciliation  boolean,
  p_proposed_identity        jsonb,
  p_relationship_type_code   text,
  p_source_endpoint          jsonb,
  p_target_endpoint          jsonb,
  p_acquisition_run_id       text,
  p_assertion_ids            text[],
  p_evidence_ids             text[],
  p_contract_version         text,
  p_envelope                 jsonb,
  p_envelope_hash            char(64)
)
returns table (
  replay        boolean,
  candidate_id  text
)
language plpgsql
volatile
security invoker
set search_path = 'gov_repo', 'pg_catalog'
as $$
declare
  v_finding gov_repo.discovery_findings%rowtype;
  v_existing_hash char(64);
begin
  if p_candidate_id is null or btrim(p_candidate_id) = '' then
    raise exception using errcode = '22004', message = 'candidate_id is required';
  end if;

  select * into v_finding
  from gov_repo.discovery_findings as df
  where df.organisation_id = p_organisation_id and df.finding_id = p_finding_id;

  if not found then
    raise exception using
      errcode = '23503',
      message = 'DISCOVERY_CANDIDATE_FINDING_NOT_FOUND',
      detail = format('finding_id %s is not durable for this tenant', p_finding_id);
  end if;
  if v_finding.candidate_kind is distinct from p_candidate_kind then
    raise exception using errcode = '23514', message = 'DISCOVERY_CANDIDATE_KIND_MISMATCH';
  end if;
  if v_finding.source_connection_id is distinct from p_source_connection_id
     or v_finding.source_external_type is distinct from p_source_external_type
     or v_finding.source_external_id is distinct from p_source_external_id
  then
    raise exception using errcode = '23514', message = 'DISCOVERY_CANDIDATE_SOURCE_MISMATCH';
  end if;

  begin
    insert into gov_repo.discovery_candidates (
      organisation_id, candidate_id, candidate_kind, candidate_family, finding_id,
      source_connection_id, source_external_type, source_external_id,
      confidence, requires_reconciliation, proposed_identity,
      relationship_type_code, source_endpoint, target_endpoint,
      acquisition_run_id, contract_version, envelope, envelope_hash
    ) values (
      p_organisation_id, p_candidate_id, p_candidate_kind, p_candidate_family, p_finding_id,
      p_source_connection_id, p_source_external_type, p_source_external_id,
      p_confidence, p_requires_reconciliation, p_proposed_identity,
      p_relationship_type_code, p_source_endpoint, p_target_endpoint,
      p_acquisition_run_id, p_contract_version, p_envelope, p_envelope_hash
    );

    insert into gov_repo.discovery_candidate_assertions (organisation_id, candidate_id, assertion_id)
    select p_organisation_id, p_candidate_id, unnested.value
    from unnest(coalesce(p_assertion_ids, '{}')) as unnested(value);

    insert into gov_repo.discovery_candidate_evidence (organisation_id, candidate_id, evidence_id)
    select p_organisation_id, p_candidate_id, unnested.value
    from unnest(coalesce(p_evidence_ids, '{}')) as unnested(value);

    return query select false, p_candidate_id;
    return;
  exception
    when unique_violation then
      select dc.envelope_hash into v_existing_hash
      from gov_repo.discovery_candidates as dc
      where dc.organisation_id = p_organisation_id and dc.candidate_id = p_candidate_id;

      if v_existing_hash is null then
        -- The unique_violation was raised by discovery_candidates_finding_unique
        -- (a second, different candidate_id for a finding that already has
        -- one) rather than by the candidate_id primary key itself — this is a
        -- genuine conflict, never a replay of this specific candidate_id.
        raise exception using
          errcode = '23514',
          message = 'DISCOVERY_CANDIDATE_FINDING_ALREADY_HAS_CANDIDATE',
          detail = format('finding_id %s already has a different durable candidate', p_finding_id);
      end if;

      if v_existing_hash is distinct from p_envelope_hash then
        raise exception using
          errcode = '23514',
          message = 'DISCOVERY_CANDIDATE_CONFLICT',
          detail = format('candidate_id %s already exists with a different envelope_hash', p_candidate_id);
      end if;

      return query select true, p_candidate_id;
      return;
  end;
end;
$$;

comment on function gov_repo.record_discovery_candidate is
  'Idempotent durable persistence of one canonical-contracts NormalizedCandidate plus normalized assertion/evidence membership, tenant-scoped by (organisation_id, candidate_id). Validates candidate_kind/source object against the already-durable parent gov_repo.discovery_findings row before inserting (23503 if the finding is not durable yet, 23514 on a kind/source mismatch). A reused candidate_id with an identical envelope_hash replays; a different envelope_hash fails closed (23514, DISCOVERY_CANDIDATE_CONFLICT). A second distinct candidate_id for a finding that already has one durable candidate also fails closed (23514, DISCOVERY_CANDIDATE_FINDING_ALREADY_HAS_CANDIDATE) via discovery_candidates_finding_unique — the real current cardinality is at most one candidate per finding. Uses a check-then-insert-with-exception-handler (not ON CONFLICT) because the table is immutable via a rewrite RULE. SECURITY INVOKER, service_role only.';

-- -----------------------------------------------------------------------------
-- G. PERMISSIONS — EXECUTE revoked from PUBLIC/anon/authenticated, granted
--    only to service_role. Postgres grants EXECUTE to PUBLIC by default on
--    new functions, so this revoke is mandatory, not optional.
-- -----------------------------------------------------------------------------

revoke all on function gov_repo.record_discovery_finding from public, anon, authenticated;
revoke all on function gov_repo.record_discovery_candidate from public, anon, authenticated;

grant execute on function gov_repo.record_discovery_finding to service_role;
grant execute on function gov_repo.record_discovery_candidate to service_role;

commit;
