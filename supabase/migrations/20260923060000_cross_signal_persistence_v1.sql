-- =============================================================================
-- CODEGUARD AI GOVERNANCE OS
-- Migration: 20260923060000_cross_signal_persistence_v1
-- Domain:    GOV IA M15.3A — Cross-Signal Reconciliation & Drift persistence
--            foundation + a narrow runtime-observation read boundary.
-- Frozen architecture: docs/architecture/ADR-GOVIA-CROSS-SIGNAL-RECONCILIATION-AND-DRIFT-v1.md
--            (esp. §7, §8, §11, §12, §13, §15, §18, §19)
--
-- This migration is purely additive. It does NOT modify, drop or rewrite any
-- historical migration, including 20260917021203_runtime_observability_v1.sql
-- and 20260917192615_runtime_observability_v1_review_fixes.sql. It does not
-- grant broad SELECT on gov_repo.runtime_observations (still revoked from
-- every role, including service_role) — it adds one narrowly scoped,
-- tenant-bound, exact-lookup SECURITY DEFINER read RPC instead.
--
-- Two frozen durable structures only (ADR §15): cross_signal_comparison_results
-- and its normalized child cross_signal_comparison_left_relationship_states.
-- No third DriftHypothesis table, no arbitrary metadata/JSON/EAV table.
--
-- No production deployment is authorized by this migration. It is a migration
-- SOURCE FILE only — it is not applied to any hosted Supabase/Postgres
-- environment as part of this task (GOV IA M15.3A, persistence-foundation
-- slice). Real controlled DB acceptance is a later, explicit, owner-authorized
-- step.
-- =============================================================================

begin;

do $preflight$
begin
  if to_regnamespace('gov_repo') is null then
    raise exception using errcode = '3F000',
      message = 'Cannot apply cross-signal persistence migration.',
      hint = 'Schema gov_repo does not exist; foundation migrations must run first.';
  end if;
  if to_regclass('gov_repo.runtime_observations') is null
     or to_regclass('gov_repo.execution_field_states') is null
     or to_regclass('gov_repo.canonical_relationships') is null
     or to_regclass('gov_repo.canonical_objects') is null then
    raise exception using errcode = '3F000',
      message = 'Cannot apply cross-signal persistence migration.',
      hint = 'M13/M14/L9 foundation tables are missing; prerequisite migrations must run first.';
  end if;
end;
$preflight$;

-- -----------------------------------------------------------------------------
-- A. RUNTIME OBSERVATION READ BOUNDARY (ADR §3, §8-9, §11, §15's "resolved back
--    to ... the runtime table at read time"; M14 ADR §10 tenant discipline).
--
--    gov_repo.runtime_observations keeps its M14 "revoke all ... including
--    service_role" posture untouched. This function is the ONLY read path
--    M15 is granted: tenant-scoped, requires organisationId + observationId +
--    connectionId together, returns zero or one exact row, performs no writes,
--    never searches by traceId/spanId/time proximity/sourceEventKey, never
--    infers a different observation, and confers no governance authority —
--    it hands back trusted-admission evidence, nothing more (ADR §3, §9).
--
--    Reuses gov_repo.runtime_readback(o) (defined in the M14 migration) for
--    the jsonb transport encoding, so the exposed shape is exactly the closed,
--    typed column set runtime-row.ts's runtimeColumns allowlist already
--    consumes, plus the identity/readback columns
--    (organisation_id/observation_id/connection_id/recorded_at) that
--    allowlist itself does not carry — never SELECT *, never an arbitrary
--    JSON/EAV payload, never a wider surface than the M14 table itself.
-- -----------------------------------------------------------------------------

create function gov_repo.read_runtime_observation_exact(
  p_organisation_id uuid,
  p_connection_id gov_repo.runtime_reference,
  p_observation_id uuid
) returns table(observation jsonb)
language plpgsql security definer set search_path=pg_catalog as $$
begin
  if p_organisation_id is null or p_connection_id is null or p_observation_id is null then
    raise exception 'CROSS_SIGNAL_RUNTIME_READ_INVALID';
  end if;
  -- organisation_id+observation_id is already the table's own primary key;
  -- adding connection_id as a further exact equality filter can only ever
  -- narrow that single row to zero rows, never widen it to more than one —
  -- no ORDER BY, no LIMIT, no trace/span/time-proximity fallback exists here.
  return query
    select gov_repo.runtime_readback(o)
    from gov_repo.runtime_observations o
    where o.organisation_id = p_organisation_id
      and o.observation_id = p_observation_id
      and o.connection_id = p_connection_id;
end;
$$;

revoke all on function gov_repo.read_runtime_observation_exact(uuid,gov_repo.runtime_reference,uuid) from public,anon,authenticated,service_role;
grant execute on function gov_repo.read_runtime_observation_exact(uuid,gov_repo.runtime_reference,uuid) to service_role;

-- -----------------------------------------------------------------------------
-- B. M15 PERSISTENCE SCHEMA (ADR §14-§15)
--
--    Parent: gov_repo.cross_signal_comparison_results — one immutable row per
--    closed CrossSignalComparisonResult (canonical-contracts
--    cross-signal-comparison.ts). left/right are evidence REFERENCES only
--    (ids), never copied source values (ADR §11, §15 "Evidence references,
--    not copies").
--
--    Child: gov_repo.cross_signal_comparison_left_relationship_states — one
--    row per DEPENDENCY_TARGET_IDENTITY effective-set member (ADR §15's exact
--    minimum shape: comparison_id, relationship_id, relationship_state_id,
--    nullable decision_id). validFrom/validTo are never duplicated here —
--    canonical_relationships rows are inserted once and never updated
--    (verified: no `update gov_repo.canonical_relationships` statement exists
--    anywhere in this repository), so they remain safely resolvable, exactly
--    as originally recorded, via a read-time join back to that table.
--
--    comparison_id is the deterministic §13 identity itself
--    (packages/governance-review's crossSignalComparisonIdentity: a sha256 of
--    the content-addressed (organisationId, subject, dimension, pairingMode,
--    left, right, method) tuple — never evaluatedAt, never a database row id,
--    never receipt order). Using it directly as the primary key turns the
--    unique constraint on that key into replay/conflict enforcement at the
--    database layer for free, exactly as ADR §15 requires.
-- -----------------------------------------------------------------------------

create table gov_repo.cross_signal_comparison_results (
  organisation_id uuid not null references gov_repo.organisations(organisation_id),
  comparison_id text not null,
  subject_object_id text not null,
  dimension text not null,
  pairing_mode text not null,
  method_code text not null,
  method_version text not null,
  -- Discriminated left evidence reference (ADR §11). RELATIONSHIP_STATE_SET's
  -- own content lives entirely in the child table below, including when the
  -- resolved effective set is empty (left_kind is still set; zero child rows).
  left_kind text,
  left_execution_field_state_id text,
  left_execution_field_state_decision_id text,
  left_execution_field_state_snapshot_id text,
  -- Right evidence reference: always RUNTIME_OBSERVATION in V1 (ADR §7.2, §11).
  right_observation_id uuid,
  right_connection_id gov_repo.runtime_reference,
  -- Closed, boundary-tagged temporal-basis tags (ADR §11-§12). Values are
  -- never copied here: NOT_AVAILABLE/RELATIONSHIP_VALID_FROM_TO_SET carry no
  -- value at all, and RUNTIME_EVENT_TIME's value is always re-derived at read
  -- time from the referenced RuntimeObservation's own startedAtUnixNano —
  -- storing a second, redundant copy would risk exactly the kind of silent
  -- precision truncation (nanosecond -> timestamptz microsecond) this ADR
  -- forbids (§12), so this table never attempts it.
  left_temporal_basis text not null,
  right_temporal_basis text not null,
  outcome text not null,
  reason text,
  evaluated_at timestamptz not null,
  recorded_at timestamptz not null default clock_timestamp(),
  primary key (organisation_id, comparison_id),
  constraint cross_signal_dimension_check check (dimension in ('PRINCIPAL_IDENTITY','DEPENDENCY_TARGET_IDENTITY')),
  constraint cross_signal_pairing_mode_check check (pairing_mode = 'DESIGN_TIME_VS_RUNTIME'),
  constraint cross_signal_method_code_check check (method_code in ('CROSS_SIGNAL_PRINCIPAL_DESIGN_RUNTIME_V1','CROSS_SIGNAL_DEPENDENCY_TARGET_DESIGN_RUNTIME_V1')),
  constraint cross_signal_method_dimension_check check (
    (dimension = 'PRINCIPAL_IDENTITY' and method_code = 'CROSS_SIGNAL_PRINCIPAL_DESIGN_RUNTIME_V1') or
    (dimension = 'DEPENDENCY_TARGET_IDENTITY' and method_code = 'CROSS_SIGNAL_DEPENDENCY_TARGET_DESIGN_RUNTIME_V1')
  ),
  constraint cross_signal_left_kind_check check (left_kind is null or left_kind in ('EXECUTION_FIELD_STATE','RELATIONSHIP_STATE_SET')),
  constraint cross_signal_left_kind_dimension_check check (
    left_kind is null or
    (dimension = 'PRINCIPAL_IDENTITY' and left_kind = 'EXECUTION_FIELD_STATE') or
    (dimension = 'DEPENDENCY_TARGET_IDENTITY' and left_kind = 'RELATIONSHIP_STATE_SET')
  ),
  constraint cross_signal_left_efs_triplet_check check (
    (left_execution_field_state_id is null) = (left_execution_field_state_decision_id is null) and
    (left_execution_field_state_id is null) = (left_execution_field_state_snapshot_id is null)
  ),
  constraint cross_signal_left_efs_kind_check check (left_execution_field_state_id is null or left_kind = 'EXECUTION_FIELD_STATE'),
  constraint cross_signal_right_pair_check check ((right_observation_id is null) = (right_connection_id is null)),
  constraint cross_signal_left_temporal_basis_check check (
    (dimension = 'PRINCIPAL_IDENTITY' and left_temporal_basis = 'NOT_AVAILABLE') or
    (dimension = 'DEPENDENCY_TARGET_IDENTITY' and left_temporal_basis = 'RELATIONSHIP_VALID_FROM_TO_SET')
  ),
  constraint cross_signal_right_temporal_basis_check check (right_temporal_basis = 'RUNTIME_EVENT_TIME'),
  -- ADR §4/§7.1a, defense-in-depth: no V1 method ever reaches DRIFT_CANDIDATE.
  -- Enforced twice — TS's createCrossSignalComparisonResult and this CHECK —
  -- mirroring this repository's existing "human-authority-enforced twice
  -- (TS + DB CHECK)" L13 pattern (ADR §1).
  constraint cross_signal_outcome_check check (outcome in ('CONSISTENT','CONFLICT_CANDIDATE','INSUFFICIENT_EVIDENCE')),
  constraint cross_signal_reason_required_check check ((outcome = 'INSUFFICIENT_EVIDENCE') = (reason is not null)),
  constraint cross_signal_reason_check check (reason is null or reason in (
    'RUNTIME_BINDING_UNRESOLVED','DESIGN_TIME_BASELINE_MISSING','DESIGN_TIME_BASELINE_NOT_EFFECTIVE',
    'RUNTIME_TARGET_NOT_PROVEN','RUNTIME_PRINCIPAL_NOT_PROVEN','SUBJECT_AMBIGUOUS','CLOCK_UNCERTAIN'
  )),
  -- Evidence required on both sides unless the outcome explains the gap
  -- (mirrors createCrossSignalComparisonResult's evidenceRequired = !reasonRequired).
  constraint cross_signal_evidence_required_check check (
    outcome = 'INSUFFICIENT_EVIDENCE' or (left_kind is not null and right_observation_id is not null)
  ),
  constraint cross_signal_subject_fkey
    foreign key (organisation_id, subject_object_id)
    references gov_repo.canonical_objects (organisation_id, canonical_object_id),
  constraint cross_signal_left_efs_fkey
    foreign key (organisation_id, left_execution_field_state_id)
    references gov_repo.execution_field_states (organisation_id, state_id),
  constraint cross_signal_right_observation_fkey
    foreign key (organisation_id, right_observation_id)
    references gov_repo.runtime_observations (organisation_id, observation_id)
);

comment on table gov_repo.cross_signal_comparison_results is
  'GOV IA M15 V1 — one immutable row per closed CrossSignalComparisonResult (ADR-GOVIA-CROSS-SIGNAL-RECONCILIATION-AND-DRIFT-v1.md). Insert-only: no UPDATE/DELETE path exists for outcome/left/right/temporal-basis once recorded. comparison_id is the deterministic §13 identity (crossSignalComparisonIdentity), never evaluatedAt or a row id.';

create index idx_cross_signal_subject on gov_repo.cross_signal_comparison_results (organisation_id, subject_object_id, dimension);
create index idx_cross_signal_right_observation on gov_repo.cross_signal_comparison_results (organisation_id, right_observation_id);

create table gov_repo.cross_signal_comparison_left_relationship_states (
  organisation_id uuid not null,
  comparison_id text not null,
  relationship_id text not null,
  relationship_state_id text not null,
  decision_id text,
  primary key (organisation_id, comparison_id, relationship_state_id),
  constraint cross_signal_left_state_parent_fkey
    foreign key (organisation_id, comparison_id)
    references gov_repo.cross_signal_comparison_results (organisation_id, comparison_id),
  constraint cross_signal_left_state_relationship_fkey
    foreign key (organisation_id, relationship_id)
    references gov_repo.canonical_relationships (organisation_id, relationship_id)
);

comment on table gov_repo.cross_signal_comparison_left_relationship_states is
  'GOV IA M15 V1 — normalized child of cross_signal_comparison_results (ADR §15): one row per DEPENDENCY_TARGET_IDENTITY effective relationship-state-set member. Never a JSON/array escape hatch. validFrom/validTo are resolved at read time from the referenced immutable canonical_relationships row, never duplicated here.';

create index idx_cross_signal_left_state_relationship on gov_repo.cross_signal_comparison_left_relationship_states (organisation_id, relationship_id);

-- -----------------------------------------------------------------------------
-- C/D. ATOMIC WRITE + IDEMPOTENCY/REPLAY (ADR §13, §15).
--
--    One SECURITY DEFINER function inserts the parent row and every child row
--    in the same statement-list, inside the single implicit transaction every
--    plpgsql function body already runs in — never two independent
--    application-level inserts that could leave a partial parent or partial
--    child set. An unhandled exception anywhere below aborts the whole
--    function (and, unless the caller wraps it in its own savepoint, the
--    whole enclosing transaction), leaving no partial row of either table —
--    the same "failure anywhere leaves no partial canonical truth" guarantee
--    documented for gov_repo.materialize_relationship_reconciliation.
--
--    p_result is the exact closed CrossSignalComparisonResult (canonical-
--    contracts createCrossSignalComparisonResult output) as jsonb transport
--    only — the durable schema itself stays typed columns + a normalized
--    child table, never a JSON/EAV escape hatch (mirrors this repository's
--    existing record_technical_fact/record_technical_field_decision
--    convention of jsonb-in, typed-columns-out). There is exactly ONE
--    transport representation for RELATIONSHIP_STATE_SET evidence:
--    p_result #> '{left,states}'. No second parameter exists that a caller
--    invoking this SECURITY DEFINER RPC directly could ever supply
--    inconsistently with p_result.left.states — for DEPENDENCY_TARGET_IDENTITY
--    it is required to exist and be an array (possibly empty); for every
--    other dimension it must be entirely absent.
--
--    SUBJECT PROOF: the parent FK below only proves subject_object_id exists
--    for this tenant, never that its canonical kind is actually AGENT_VERSION
--    — a caller's subject.kind string alone is never trusted. This function
--    independently requires exactly one gov_repo.canonical_objects row with
--    (organisation_id, canonical_object_id, kind = 'AGENT_VERSION') before
--    any identity construction or persistence, failing closed with
--    CROSS_SIGNAL_RESULT_SUBJECT_INVALID otherwise.
--
--    DEPENDENCY EVIDENCE PROOF: each claimed RELATIONSHIP_STATE_SET member is
--    independently re-verified against canonical_relationships on exact
--    tenant + relationship_id + relationship_state_id + source_canonical_object_id
--    (= the comparison subject) + source_kind = 'AGENT_VERSION' + a closed M15
--    V1 dependency relationship_type (USES_MODEL/USES_TOOL/USES_MCP/INVOKES)
--    + (when supplied) an exact decisionId match — never accepted merely
--    because a relationshipId/relationshipStateId/source id happens to exist.
--    When the paired RuntimeObservation is available, its own kind
--    (MODEL_CALL/TOOL_CALL/MCP_CALL/API_CALL) is additionally cross-checked
--    against the same closed relationship_type mapping the pure comparison
--    functions use — a narrow evidence-reference check only; this function
--    never recomputes a CONSISTENT/CONFLICT_CANDIDATE/INSUFFICIENT_EVIDENCE
--    outcome, and never rebuilds the comparison algorithm itself.
--
--    IDENTITY AUTHORITY (ADR §13/§15): the database, not the caller, owns the
--    deterministic comparison identity. p_comparison_id is at most a
--    consistency ASSERTION — it is never trusted as the persistence key. This
--    function independently re-derives the canonical identity material from
--    its OWN validated evidence lookups (v_efs / v_ro / the verified
--    relationship-state rows below — never the caller's raw jsonb claims) and
--    computes v_expected_comparison_id = 'cross-signal-comparison:' ||
--    sha256(gov_repo.frame_identity(material)), using the exact same
--    frameIdentity + sha256 convention packages/governance-review's
--    crossSignalComparisonIdentity() uses in TypeScript (see
--    canonicalRelationshipId's own identical 'prefix:' || encode(
--    extensions.digest(...),'hex') pattern earlier in this repository, e.g.
--    20260909210640_relationship_decision_to_truth_v1.sql's v_expected_id). A
--    caller-supplied p_comparison_id that disagrees with this DB-computed
--    value fails closed with CROSS_SIGNAL_COMPARISON_IDENTITY_MISMATCH before
--    any row is read or written — it can never select, create, or collide
--    with a different durable row under an arbitrary chosen key.
--
--    The identity material is exactly (format-version tag, organisationId,
--    subject.organisationId, subject.objectId, subject.kind, dimension,
--    pairingMode, method.code, method.version, left-evidence parts,
--    right-evidence parts) — never evaluatedAt, outcome, an
--    INSUFFICIENT_EVIDENCE reason, a database row id, insertion order, or
--    receipt order. RELATIONSHIP_STATE_SET members are each framed
--    independently (relationshipId, relationshipStateId, an explicit
--    decisionId-presence flag, and the decisionId value or '' when absent)
--    and then sorted by the LEXICOGRAPHIC ORDER OF THE UTF-8 BYTES of that
--    per-member frame — order-independent of caller input order. This is
--    computed explicitly via `order by convert_to(member_frame,'UTF8')`
--    (a bytea comparison, never database/session collation-dependent text
--    comparison — PostgreSQL's own default "C" collation is byte-oriented
--    for the database encoding, and this repository never relies on that
--    encoding assumption holding as an accidental equivalence). This is
--    identical to the explicit `Buffer.compare(Buffer.from(a,'utf8'),
--    Buffer.from(b,'utf8'))` ordering packages/governance-review's
--    crossSignalComparisonIdentity() applies in TypeScript (never
--    JavaScript's default UTF-16 code-unit sort, never localeCompare), so
--    both languages compare the identical byte sequence for every
--    identifier, including non-ASCII and supplementary-plane characters,
--    regardless of either side's default collation/locale/ICU
--    configuration. A present RELATIONSHIP_STATE_SET with zero members is
--    framed distinctly from an entirely absent left reference
--    (LEFT_RELATIONSHIP_STATE_SET + count "0" vs. LEFT_ABSENT) — the two can
--    never collide.
--
--    Replay: an existing row with the same (organisation_id,
--    v_expected_comparison_id) is compared field-by-field (including its
--    child set) against the new request. Identical content returns the
--    ORIGINAL row unchanged (replay = true, original evaluated_at preserved)
--    — nothing is recomputed or overwritten. Any difference fails closed with
--    CROSS_SIGNAL_COMPARISON_REPLAY_CONFLICT, mirroring
--    RUNTIME_REPLAY_CONFLICT/EXECUTION_REPLAY_CONFLICT elsewhere in this
--    repository. Every referenced evidence id is independently re-verified
--    against its own source-of-truth table before any row is written, and
--    the identity itself is built from those same verified rows — never
--    trusted merely because the caller's jsonb claims it.
-- -----------------------------------------------------------------------------

create function gov_repo.record_cross_signal_comparison_result(
  p_organisation_id uuid,
  p_comparison_id text,
  p_result jsonb
) returns table(replay boolean, comparison_id text, evaluated_at timestamptz)
language plpgsql security definer set search_path=pg_catalog as $$
declare
  existing gov_repo.cross_signal_comparison_results%rowtype;
  r gov_repo.cross_signal_comparison_results%rowtype;
  v_dimension text := p_result->>'dimension';
  v_left_kind text := p_result#>>'{left,kind}';
  v_right_kind text := p_result#>>'{right,kind}';
  v_method_code text := p_result#>>'{method,code}';
  v_states_raw jsonb := p_result#>'{left,states}';
  v_states jsonb;
  v_existing_states jsonb;
  v_new_states jsonb;
  v_efs gov_repo.execution_field_states%rowtype;
  v_ro gov_repo.runtime_observations%rowtype;
  v_expected_relationship_type text;
  v_relationship_mismatch boolean;
  v_left_member_frames text[];
  v_left_parts text[];
  v_right_parts text[];
  v_identity_parts text[];
  v_expected_comparison_id text;
begin
  if p_organisation_id is null or p_result is null then
    raise exception 'CROSS_SIGNAL_RESULT_INVALID';
  end if;
  if p_result->>'organisationId' is distinct from p_organisation_id::text then raise exception 'CROSS_SIGNAL_RESULT_TENANT_MISMATCH'; end if;
  if p_result#>>'{subject,organisationId}' is distinct from p_organisation_id::text
    or p_result#>>'{subject,kind}' is distinct from 'AGENT_VERSION'
    or p_result#>>'{subject,objectId}' is null then raise exception 'CROSS_SIGNAL_RESULT_SUBJECT_INVALID'; end if;
  -- Independently prove the persisted canonical object's ACTUAL kind is
  -- AGENT_VERSION - the parent FK below only proves the object id exists for
  -- this tenant, never its kind. A caller's subject.kind string is never
  -- trusted on its own.
  perform 1 from gov_repo.canonical_objects
    where organisation_id = p_organisation_id
      and canonical_object_id = p_result#>>'{subject,objectId}'
      and kind = 'AGENT_VERSION';
  if not found then raise exception 'CROSS_SIGNAL_RESULT_SUBJECT_INVALID'; end if;
  if p_result->>'pairingMode' is distinct from 'DESIGN_TIME_VS_RUNTIME' then raise exception 'CROSS_SIGNAL_RESULT_PAIRING_INVALID'; end if;
  if p_result->>'outcome' = 'DRIFT_CANDIDATE' then raise exception 'CROSS_SIGNAL_RESULT_OUTCOME_INVALID'; end if;
  if v_dimension is distinct from 'PRINCIPAL_IDENTITY' and v_dimension is distinct from 'DEPENDENCY_TARGET_IDENTITY' then
    raise exception 'CROSS_SIGNAL_RESULT_DIMENSION_INVALID';
  end if;

  -- ONE authoritative transport representation for RELATIONSHIP_STATE_SET
  -- evidence: p_result #> '{left,states}' only. There is no second parameter
  -- a caller invoking this SECURITY DEFINER RPC directly could ever supply
  -- inconsistently with p_result.left.states.
  if v_left_kind = 'RELATIONSHIP_STATE_SET' then
    if v_states_raw is null or jsonb_typeof(v_states_raw) <> 'array' then
      raise exception 'CROSS_SIGNAL_RESULT_INVALID';
    end if;
    v_states := v_states_raw;
  elsif v_states_raw is not null then
    raise exception 'CROSS_SIGNAL_RESULT_INVALID';
  else
    v_states := '[]'::jsonb;
  end if;

  -- Independently re-prove every referenced evidence id, never trusting the
  -- caller's jsonb claim on its own (mirrors register_runtime_binding /
  -- record_technical_fact's own cross-check discipline). The resolved rows
  -- (v_ro / v_efs / the verified relationship rows below) are also the ONLY
  -- source the identity material below is built from.
  if v_right_kind is not null then
    if v_right_kind is distinct from 'RUNTIME_OBSERVATION' then raise exception 'CROSS_SIGNAL_RESULT_RIGHT_KIND_INVALID'; end if;
    select * into v_ro from gov_repo.runtime_observations o
      where o.organisation_id = p_organisation_id
        and o.observation_id = (p_result#>>'{right,observationId}')::uuid
        and o.connection_id = p_result#>>'{right,connectionId}';
    if not found then raise exception 'CROSS_SIGNAL_RUNTIME_EVIDENCE_NOT_FOUND'; end if;
    -- Narrow evidence-reference cross-check only - never a recomputed
    -- outcome: the same closed runtime-kind -> dependency relationship_type
    -- mapping the pure comparison functions use (compareDependencyTargetIdentityDesignTimeVsRuntime).
    v_expected_relationship_type := case v_ro.kind
      when 'MODEL_CALL' then 'USES_MODEL' when 'TOOL_CALL' then 'USES_TOOL'
      when 'MCP_CALL' then 'USES_MCP' when 'API_CALL' then 'INVOKES' else null end;
  end if;

  if v_left_kind = 'EXECUTION_FIELD_STATE' then
    select * into v_efs from gov_repo.execution_field_states
      where organisation_id = p_organisation_id and state_id = p_result#>>'{left,executionFieldStateId}';
    if not found
      or v_efs.canonical_object_id is distinct from p_result#>>'{subject,objectId}'
      or v_efs.field_key is distinct from 'PRINCIPAL'
      or v_efs.decision_id is distinct from p_result#>>'{left,decisionId}'
      or v_efs.snapshot_id is distinct from p_result#>>'{left,snapshotId}'
    then raise exception 'CROSS_SIGNAL_PRINCIPAL_EVIDENCE_MISMATCH'; end if;
  elsif v_left_kind = 'RELATIONSHIP_STATE_SET' then
    -- Verifies every member against canonical_relationships on exact tenant +
    -- relationship_id + relationship_state_id + source_canonical_object_id
    -- (= the comparison subject) + source_kind = AGENT_VERSION + a closed M15
    -- V1 dependency relationship_type + (when the paired RuntimeObservation
    -- is available) that type matching the observation's own kind + (when
    -- supplied) an exact decisionId match - never accepted merely because a
    -- relationshipId/relationshipStateId/source id happens to exist. This is
    -- a narrow evidence-reference check: it never recomputes an outcome.
    -- In the same pass, frames each verified member (relationshipId,
    -- relationshipStateId, an explicit decisionId-presence flag,
    -- decisionId-or-'') for identity purposes - the frames are then sorted
    -- by the lexicographic order of their own explicit UTF-8 bytes
    -- (convert_to(...,'UTF8'), a bytea comparison — never database/session
    -- collation, never caller input order), matching TypeScript's explicit
    -- Buffer.compare(...,'utf8') rule byte-for-byte, including for
    -- non-ASCII/supplementary-plane identifiers.
    with input_states as (
      select
        value->>'relationshipId' as relationship_id,
        value->>'relationshipStateId' as relationship_state_id,
        (value ? 'decisionId' and value->>'decisionId' is not null) as decision_present,
        value->>'decisionId' as decision_id
      from jsonb_array_elements(v_states) value
    ), verified as (
      select i.*, r.relationship_id as db_relationship_id, r.relationship_state_id as db_state_id,
        r.source_canonical_object_id as db_source, r.source_kind as db_source_kind,
        r.relationship_type as db_relationship_type, r.created_by_decision_id as db_decision,
        gov_repo.frame_identity(array[i.relationship_id, i.relationship_state_id,
          case when i.decision_present then '1' else '0' end, coalesce(i.decision_id,'')]) as member_frame
      from input_states i
      left join gov_repo.canonical_relationships r
        on r.organisation_id = p_organisation_id and r.relationship_id = i.relationship_id
    )
    select
      bool_or(db_relationship_id is null or db_state_id is distinct from relationship_state_id
        or db_source is distinct from (p_result#>>'{subject,objectId}')
        or db_source_kind is distinct from 'AGENT_VERSION'
        or db_relationship_type not in ('USES_MODEL','USES_TOOL','USES_MCP','INVOKES')
        or (v_expected_relationship_type is not null and db_relationship_type is distinct from v_expected_relationship_type)
        or (decision_present and db_decision is distinct from decision_id)),
      array_agg(member_frame order by convert_to(member_frame,'UTF8'))
    into v_relationship_mismatch, v_left_member_frames
    from verified;
    if coalesce(v_relationship_mismatch, false) then raise exception 'CROSS_SIGNAL_RELATIONSHIP_EVIDENCE_MISMATCH'; end if;
    v_left_member_frames := coalesce(v_left_member_frames, array[]::text[]);
  elsif v_left_kind is not null then
    raise exception 'CROSS_SIGNAL_RESULT_LEFT_KIND_INVALID';
  end if;

  -- Database-authoritative identity (ADR §13/§15) — built exclusively from the
  -- validated rows above, never from unverified caller jsonb.
  if v_left_kind is null then
    v_left_parts := array['LEFT_ABSENT'];
  elsif v_left_kind = 'EXECUTION_FIELD_STATE' then
    v_left_parts := array['LEFT_EXECUTION_FIELD_STATE', v_efs.state_id, v_efs.decision_id, v_efs.snapshot_id];
  else
    v_left_parts := array['LEFT_RELATIONSHIP_STATE_SET', coalesce(array_length(v_left_member_frames,1),0)::text] || v_left_member_frames;
  end if;
  if v_right_kind is null then
    v_right_parts := array['RIGHT_ABSENT'];
  else
    v_right_parts := array['RIGHT_RUNTIME_OBSERVATION', v_ro.observation_id::text, v_ro.connection_id];
  end if;
  v_identity_parts := array['CROSS_SIGNAL_COMPARISON_V1', p_organisation_id::text,
    p_result#>>'{subject,organisationId}', p_result#>>'{subject,objectId}', p_result#>>'{subject,kind}',
    v_dimension, p_result->>'pairingMode', v_method_code, p_result#>>'{method,version}']
    || v_left_parts || v_right_parts;
  v_expected_comparison_id := 'cross-signal-comparison:' ||
    encode(extensions.digest(convert_to(gov_repo.frame_identity(v_identity_parts),'UTF8'),'sha256'),'hex');

  -- A caller-supplied comparison_id is never the authority: it is at most a
  -- consistency assertion, verified against — never used in place of — the
  -- DB-computed value below.
  if p_comparison_id is not null and p_comparison_id is distinct from v_expected_comparison_id then
    raise exception 'CROSS_SIGNAL_COMPARISON_IDENTITY_MISMATCH';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_organisation_id::text||':cross-signal-comparison:'||v_expected_comparison_id,0));

  select * into existing from gov_repo.cross_signal_comparison_results
    where organisation_id = p_organisation_id and comparison_id = v_expected_comparison_id;

  if found then
    select coalesce(jsonb_agg(jsonb_build_object('relationshipId',relationship_id,'relationshipStateId',relationship_state_id,'decisionId',decision_id) order by relationship_state_id),'[]'::jsonb)
      into v_existing_states
      from gov_repo.cross_signal_comparison_left_relationship_states
      where organisation_id = p_organisation_id and comparison_id = v_expected_comparison_id;
    select coalesce(jsonb_agg(jsonb_build_object('relationshipId',value->>'relationshipId','relationshipStateId',value->>'relationshipStateId','decisionId',value->>'decisionId') order by value->>'relationshipStateId'),'[]'::jsonb)
      into v_new_states
      from jsonb_array_elements(v_states) value;
    if existing.dimension is distinct from v_dimension
      or existing.pairing_mode is distinct from p_result->>'pairingMode'
      or existing.subject_object_id is distinct from p_result#>>'{subject,objectId}'
      or existing.method_code is distinct from v_method_code
      or existing.method_version is distinct from p_result#>>'{method,version}'
      or existing.outcome is distinct from p_result->>'outcome'
      or existing.reason is distinct from p_result->>'reason'
      or existing.left_kind is distinct from v_left_kind
      or existing.left_execution_field_state_id is distinct from p_result#>>'{left,executionFieldStateId}'
      or existing.left_execution_field_state_decision_id is distinct from p_result#>>'{left,decisionId}'
      or existing.left_execution_field_state_snapshot_id is distinct from p_result#>>'{left,snapshotId}'
      or existing.right_observation_id is distinct from nullif(p_result#>>'{right,observationId}','')::uuid
      or existing.right_connection_id is distinct from p_result#>>'{right,connectionId}'
      or existing.left_temporal_basis is distinct from p_result#>>'{leftTemporalBasis,basis}'
      or existing.right_temporal_basis is distinct from p_result#>>'{rightTemporalBasis,basis}'
      or v_existing_states is distinct from v_new_states
    then raise exception 'CROSS_SIGNAL_COMPARISON_REPLAY_CONFLICT'; end if;
    return query select true, existing.comparison_id, existing.evaluated_at;
    return;
  end if;

  r.organisation_id := p_organisation_id;
  r.comparison_id := v_expected_comparison_id;
  r.subject_object_id := p_result#>>'{subject,objectId}';
  r.dimension := v_dimension;
  r.pairing_mode := p_result->>'pairingMode';
  r.method_code := v_method_code;
  r.method_version := p_result#>>'{method,version}';
  r.left_kind := v_left_kind;
  r.left_execution_field_state_id := p_result#>>'{left,executionFieldStateId}';
  r.left_execution_field_state_decision_id := p_result#>>'{left,decisionId}';
  r.left_execution_field_state_snapshot_id := p_result#>>'{left,snapshotId}';
  r.right_observation_id := nullif(p_result#>>'{right,observationId}','')::uuid;
  r.right_connection_id := p_result#>>'{right,connectionId}';
  r.left_temporal_basis := p_result#>>'{leftTemporalBasis,basis}';
  r.right_temporal_basis := p_result#>>'{rightTemporalBasis,basis}';
  r.outcome := p_result->>'outcome';
  r.reason := p_result->>'reason';
  r.evaluated_at := (p_result->>'evaluatedAt')::timestamptz;

  -- Explicit column list, never `insert ... select r.*`: recorded_at is
  -- deliberately OMITTED here so the table's own `default clock_timestamp()`
  -- assigns it. r.recorded_at is never assigned above (it stays NULL on the
  -- composite variable, since recorded_at is a server-assigned audit
  -- timestamp, not a caller-supplied field) - selecting r.* positionally
  -- would have inserted that NULL directly into a NOT NULL column, failing
  -- every first insert. An explicit list also means a future column added to
  -- this table can never silently change this RPC's insert contract.
  insert into gov_repo.cross_signal_comparison_results (
    organisation_id, comparison_id, subject_object_id, dimension, pairing_mode, method_code, method_version,
    left_kind, left_execution_field_state_id, left_execution_field_state_decision_id, left_execution_field_state_snapshot_id,
    right_observation_id, right_connection_id, left_temporal_basis, right_temporal_basis, outcome, reason, evaluated_at
  ) values (
    r.organisation_id, r.comparison_id, r.subject_object_id, r.dimension, r.pairing_mode, r.method_code, r.method_version,
    r.left_kind, r.left_execution_field_state_id, r.left_execution_field_state_decision_id, r.left_execution_field_state_snapshot_id,
    r.right_observation_id, r.right_connection_id, r.left_temporal_basis, r.right_temporal_basis, r.outcome, r.reason, r.evaluated_at
  );

  if v_left_kind = 'RELATIONSHIP_STATE_SET' then
    insert into gov_repo.cross_signal_comparison_left_relationship_states (organisation_id,comparison_id,relationship_id,relationship_state_id,decision_id)
      select p_organisation_id, v_expected_comparison_id, value->>'relationshipId', value->>'relationshipStateId', value->>'decisionId'
      from jsonb_array_elements(v_states) value;
  end if;

  return query select false, r.comparison_id, r.evaluated_at;
end;
$$;

comment on function gov_repo.record_cross_signal_comparison_result(uuid,text,jsonb) is
  'GOV IA M15 V1 write boundary. The DATABASE derives and owns the deterministic comparison identity (ADR §13/§15) from its own validated evidence lookups, using gov_repo.frame_identity + extensions.digest(...,''sha256''); p_comparison_id is at most a caller consistency assertion, verified and rejected on mismatch (CROSS_SIGNAL_COMPARISON_IDENTITY_MISMATCH), never the authority. Persists parent + child rows atomically in one transaction; identical replay returns the original row (original evaluated_at preserved); any semantic mismatch under the same DB-computed identity fails closed with CROSS_SIGNAL_COMPARISON_REPLAY_CONFLICT. No canonical_objects/canonical_relationships/execution_field_states/runtime_observations write ever occurs here — every reference is independently re-verified, never written.';

-- -----------------------------------------------------------------------------
-- E. TENANCY / AUTHORITY / GRANTS
-- -----------------------------------------------------------------------------

alter table gov_repo.cross_signal_comparison_results enable row level security;
alter table gov_repo.cross_signal_comparison_left_relationship_states enable row level security;

create function gov_repo.cross_signal_immutable() returns trigger
language plpgsql security invoker set search_path=pg_catalog as $$
begin raise exception 'CROSS_SIGNAL_COMPARISON_HISTORY_IMMUTABLE'; end;
$$;
create trigger cross_signal_comparison_results_immutable before update or delete on gov_repo.cross_signal_comparison_results for each row execute function gov_repo.cross_signal_immutable();
create trigger cross_signal_comparison_left_states_immutable before update or delete on gov_repo.cross_signal_comparison_left_relationship_states for each row execute function gov_repo.cross_signal_immutable();

grant usage on schema gov_repo to service_role;

-- Direct table grants: SELECT only (typed readback, ADR §15's read model).
-- INSERT never granted directly — the only write path is the SECURITY
-- DEFINER RPC above, so atomicity/replay/conflict logic can never be
-- bypassed by a raw insert. No UPDATE/DELETE grant exists at all (insert-only,
-- also enforced redundantly by the immutability triggers above).
revoke all on gov_repo.cross_signal_comparison_results, gov_repo.cross_signal_comparison_left_relationship_states from public,anon,authenticated,service_role;
grant select on gov_repo.cross_signal_comparison_results, gov_repo.cross_signal_comparison_left_relationship_states to service_role;

revoke all on function gov_repo.cross_signal_immutable() from public,anon,authenticated,service_role;
revoke all on function gov_repo.record_cross_signal_comparison_result(uuid,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function gov_repo.record_cross_signal_comparison_result(uuid,text,jsonb) to service_role;

commit;
