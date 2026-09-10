-- Accepted ADR: canonical endpoints and typed normalized object mappings.
-- Additive only: historical coarse mappings and all their constraints remain intact.
-- Governed decisions are authority; discovery and mapping lookup never create truth.
begin;

alter table gov_repo.canonical_objects add constraint canonical_objects_org_id_kind_unique
  unique (organisation_id, canonical_object_id, kind);

create table gov_repo.canonical_normalized_object_mappings (
  mapping_id text primary key,
  organisation_id uuid not null references gov_repo.organisations (organisation_id),
  canonical_object_id text not null,
  canonical_object_kind text not null,
  source_connection_id text not null,
  source_external_type text not null,
  source_external_id text not null,
  normalized_object_identity text not null check (length(btrim(normalized_object_identity)) > 0),
  candidate_id text not null,
  parent_canonical_object_id text,
  created_by_decision_id text not null,
  match_method text not null check (match_method = 'MANUAL'),
  valid_from timestamptz not null,
  constraint normalized_mapping_identity_unique unique
    (organisation_id, source_connection_id, source_external_type, source_external_id, canonical_object_kind, normalized_object_identity),
  constraint normalized_mapping_object_fkey foreign key (organisation_id, canonical_object_id, canonical_object_kind)
    references gov_repo.canonical_objects (organisation_id, canonical_object_id, kind),
  constraint normalized_mapping_candidate_fkey foreign key (organisation_id, candidate_id)
    references gov_repo.discovery_candidates (organisation_id, candidate_id),
  constraint normalized_mapping_parent_fkey foreign key (organisation_id, parent_canonical_object_id)
    references gov_repo.canonical_objects (organisation_id, canonical_object_id),
  constraint normalized_mapping_decision_fkey foreign key (organisation_id, created_by_decision_id)
    references gov_repo.reconciliation_decisions (organisation_id, decision_id)
);
comment on table gov_repo.canonical_normalized_object_mappings is
  'Exact typed normalized identity to governed canonical object. Source identity is provenance only. Legacy coarse mappings are never inferred or backfilled. Writes require authorized object materialization.';
create index normalized_mapping_object_idx on gov_repo.canonical_normalized_object_mappings (organisation_id, canonical_object_id);
create index normalized_mapping_decision_idx on gov_repo.canonical_normalized_object_mappings (organisation_id, created_by_decision_id);
alter table gov_repo.canonical_normalized_object_mappings enable row level security;
revoke all on gov_repo.canonical_normalized_object_mappings from public, anon, authenticated;
grant select, insert on gov_repo.canonical_normalized_object_mappings to service_role;
create policy normalized_mapping_service on gov_repo.canonical_normalized_object_mappings
  for all to service_role using (true) with check (true);
create rule normalized_mapping_no_update as on update to gov_repo.canonical_normalized_object_mappings do instead nothing;
create rule normalized_mapping_no_delete as on delete to gov_repo.canonical_normalized_object_mappings do instead nothing;

create function gov_repo.frame_identity(p_parts text[]) returns text
language sql immutable strict set search_path = 'pg_catalog' as $$
  select string_agg(octet_length(value)::text || ':' || value, '' order by ord)
  from unnest(p_parts) with ordinality as part(value, ord);
$$;

-- Reads only existing normalized identity fields. No version label or row UUID fallback.
create function gov_repo.normalized_object_identity(p_organisation_id uuid, p_candidate jsonb) returns text
language plpgsql stable strict security invoker set search_path = 'gov_repo', 'pg_catalog' as $$
declare v_kind text := p_candidate->>'candidateKind'; v_key text; v_parent jsonb; v_parent_keys text[];
begin
  if v_kind = 'AGENT_VERSION' then
    v_key := p_candidate->>'candidateId';
    if v_key is null or v_key !~ '^candidate:agent-version:[a-f0-9]{32}$' then
      raise exception using errcode = '22023', message = 'ENDPOINT_IDENTITY_MISSING';
    end if;
  elsif v_kind = 'DATA_ELEMENT' then
    v_parent := p_candidate#>'{proposedIdentity,parentDataAsset}';
    if v_parent->>'candidateKind' is distinct from 'DATA_ASSET' then
      raise exception using errcode = '22023', message = 'ENDPOINT_IDENTITY_MISSING';
    end if;
    select array_agg(distinct gov_repo.frame_identity(array[dc.source_connection_id, dc.source_external_type, dc.source_external_id, dc.envelope#>>'{proposedIdentity,sourceReference}']))
      into v_parent_keys from gov_repo.discovery_candidates dc
      where dc.organisation_id = p_organisation_id and dc.candidate_kind = 'DATA_ASSET'
        and length(btrim(dc.envelope#>>'{proposedIdentity,sourceReference}')) > 0
        and ((v_parent->>'referenceKind' = 'CANDIDATE' and dc.candidate_id = v_parent->>'candidateId') or
          (v_parent->>'referenceKind' = 'SOURCE_OBJECT' and dc.source_connection_id = v_parent#>>'{sourceObject,connectionId}'
           and dc.source_external_type = v_parent#>>'{sourceObject,externalType}' and dc.source_external_id = v_parent#>>'{sourceObject,externalId}'));
    if cardinality(v_parent_keys) is distinct from 1 or length(btrim(p_candidate#>>'{proposedIdentity,elementPath}')) is null or length(btrim(p_candidate#>>'{proposedIdentity,elementPath}')) = 0 then
      raise exception using errcode = '23514', message = 'ENDPOINT_IDENTITY_MISSING';
    end if;
    v_key := v_parent_keys[1] || gov_repo.frame_identity(array[p_candidate#>>'{proposedIdentity,elementPath}']);

  else
    v_key := p_candidate->'proposedIdentity'->>(case v_kind
      when 'AGENT' then 'agentCode' when 'MODEL' then 'modelReference'
      when 'TOOL' then 'declarationKey' when 'PROMPT' then 'declarationKey'
      when 'MCP_SERVER' then 'serverReference' when 'API' then 'apiReference'
      when 'KNOWLEDGE_BASE' then 'sourceReference' when 'SKILL' then 'declarationReference'
      when 'DATA_ASSET' then 'sourceReference' end);
  end if;
  if v_key is null or length(btrim(v_key)) = 0 then
    raise exception using errcode = '22023', message = 'ENDPOINT_IDENTITY_MISSING';
  end if;
  return v_key;
end;
$$;

-- Exact candidate resolution; source-only references must identify one normalized identity.
-- Never consult legacy coarse mappings, select newest, or create an endpoint.
create function gov_repo.resolve_canonical_endpoint(p_organisation_id uuid, p_reference jsonb)
returns table (canonical_object_id text, canonical_object_kind text, mapping_id text)
language plpgsql stable security invoker set search_path = 'gov_repo', 'pg_catalog' as $$
declare v_count integer; v_candidate record; v_identity text;
begin
  if p_reference->>'referenceKind' not in ('CANDIDATE','SOURCE_OBJECT') or p_reference->>'referenceKind' is null then
    raise exception using errcode = '22023', message = 'ENDPOINT_IDENTITY_MISSING';
  end if;
  select count(distinct gov_repo.frame_identity(array[dc.source_connection_id, dc.source_external_type, dc.source_external_id, gov_repo.normalized_object_identity(p_organisation_id, dc.envelope)]))
    into v_count from gov_repo.discovery_candidates dc
    where dc.organisation_id = p_organisation_id and dc.candidate_kind = p_reference->>'candidateKind'
      and dc.candidate_family = 'OBJECT' and
      ((p_reference->>'referenceKind' = 'CANDIDATE' and dc.candidate_id = p_reference->>'candidateId') or
       (p_reference->>'referenceKind' = 'SOURCE_OBJECT' and dc.source_connection_id = p_reference#>>'{sourceObject,connectionId}'
        and dc.source_external_type = p_reference#>>'{sourceObject,externalType}' and dc.source_external_id = p_reference#>>'{sourceObject,externalId}'));
  if v_count = 0 then raise exception using errcode = 'P0002', message = 'ENDPOINT_NOT_CANONICAL'; end if;
  if v_count <> 1 then raise exception using errcode = '23514', message = 'ENDPOINT_MAPPING_AMBIGUOUS'; end if;
  -- All rows now have the same proven semantic identity and source scope.
  select distinct dc.source_connection_id, dc.source_external_type, dc.source_external_id,
    gov_repo.normalized_object_identity(p_organisation_id, dc.envelope) as identity into strict v_candidate
    from gov_repo.discovery_candidates dc
    where dc.organisation_id = p_organisation_id and dc.candidate_kind = p_reference->>'candidateKind'
      and dc.candidate_family = 'OBJECT' and
      ((p_reference->>'referenceKind' = 'CANDIDATE' and dc.candidate_id = p_reference->>'candidateId') or
       (p_reference->>'referenceKind' = 'SOURCE_OBJECT' and dc.source_connection_id = p_reference#>>'{sourceObject,connectionId}'
        and dc.source_external_type = p_reference#>>'{sourceObject,externalType}' and dc.source_external_id = p_reference#>>'{sourceObject,externalId}'));
  v_identity := v_candidate.identity;
  return query select co.canonical_object_id, co.kind, m.mapping_id
    from gov_repo.canonical_normalized_object_mappings m
    join gov_repo.canonical_objects co on co.organisation_id = m.organisation_id
      and co.canonical_object_id = m.canonical_object_id and co.kind = m.canonical_object_kind
    where m.organisation_id = p_organisation_id and m.canonical_object_kind = p_reference->>'candidateKind'
      and m.source_connection_id = v_candidate.source_connection_id
      and m.source_external_type = v_candidate.source_external_type
      and m.source_external_id = v_candidate.source_external_id and m.normalized_object_identity = v_identity;
  if not found then raise exception using errcode = 'P0002', message = 'ENDPOINT_NOT_CANONICAL'; end if;
end;
$$;

-- Serialize final decisions per review without reinterpreting historical decisions.
create function gov_repo.guard_final_review_decision() returns trigger
language plpgsql security invoker set search_path = 'gov_repo', 'pg_catalog' as $$
begin
  if new.review_subject_id is not null then
    perform pg_advisory_xact_lock(hashtextextended(new.organisation_id::text || ':' || new.review_subject_id, 0));
    if exists (select 1 from gov_repo.reconciliation_invocations ri
      where ri.organisation_id = new.organisation_id and ri.review_subject_id = new.review_subject_id
        and ri.reconciliation_decision_id <> new.reconciliation_decision_id) then
      raise exception using errcode = '23514', message = 'FINALIZED_REVIEW_DECISION_CONFLICT';
    end if;
    if exists (select 1 from gov_repo.reconciliation_decisions rd
      where rd.organisation_id = new.organisation_id and rd.decision_id = new.reconciliation_decision_id
        and rd.family in ('OBJECT','RELATIONSHIP')) and not exists (
      select 1 from gov_repo.reconciliation_decisions rd
      join gov_repo.discovery_candidates dc on dc.organisation_id = rd.organisation_id
        and dc.candidate_id = coalesce(rd.subject_candidate_id, rd.relationship_candidate_id)
      join gov_repo.review_subjects rs on rs.organisation_id = dc.organisation_id and rs.finding_id = dc.finding_id
        and rs.candidate_kind = dc.candidate_kind and rs.state = 'CERTIFIED'
      where rd.organisation_id = new.organisation_id and rd.decision_id = new.reconciliation_decision_id
        and rs.review_subject_id = new.review_subject_id) then
      raise exception using errcode = '23514', message = 'FINALIZED_REVIEW_CANDIDATE_MISMATCH';
    end if;
  end if;
  return new;
end;
$$;
create trigger guard_final_review_decision before insert on gov_repo.reconciliation_invocations
  for each row execute function gov_repo.guard_final_review_decision();

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
  v_candidate gov_repo.discovery_candidates%rowtype;
  v_identity text;
  v_parent text;
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

    if v_mapping_id is null then
      select m.mapping_id into v_mapping_id from gov_repo.canonical_normalized_object_mappings m
      where m.organisation_id = p_organisation_id and m.canonical_object_id = v_existing_op.resulting_canonical_object_id
        and m.source_connection_id = p_source_connection_id and m.source_external_type = p_source_external_type
        and m.source_external_id = p_source_external_id and m.canonical_object_kind = p_canonical_object_kind
        and m.normalized_object_identity = (select gov_repo.normalized_object_identity(p_organisation_id, dc.envelope) from gov_repo.discovery_candidates dc
          where dc.organisation_id = p_organisation_id and dc.candidate_id = v_decision.subject_candidate_id);
    end if;
    return query select true, v_existing_op.status, v_existing_op.resulting_canonical_object_id, v_mapping_id;
    return;
  end if;

  select dc.* into v_candidate from gov_repo.discovery_candidates dc
    join gov_repo.review_subjects rs on rs.organisation_id = dc.organisation_id and rs.finding_id = dc.finding_id
    where dc.organisation_id = p_organisation_id and dc.candidate_id = v_decision.subject_candidate_id
      and dc.candidate_kind = p_canonical_object_kind and rs.review_subject_id = v_invocation.review_subject_id
      and rs.state = 'CERTIFIED' and dc.source_connection_id = p_source_connection_id
      and dc.source_external_type = p_source_external_type and dc.source_external_id = p_source_external_id;
  if not found then raise exception using errcode = '23514', message = 'OBJECT_CANDIDATE_BINDING_MISMATCH'; end if;
  if p_match_method <> 'MANUAL' then raise exception using errcode = '23514', message = 'HUMAN_MAPPING_REQUIRED'; end if;
  v_identity := gov_repo.normalized_object_identity(p_organisation_id, v_candidate.envelope);
  if p_canonical_object_kind in ('AGENT_VERSION','DATA_ELEMENT') then
    select ep.canonical_object_id into v_parent from gov_repo.resolve_canonical_endpoint(p_organisation_id,
      v_candidate.envelope->'proposedIdentity'->(case p_canonical_object_kind when 'AGENT_VERSION' then 'agent' else 'parentDataAsset' end)) ep
      where ep.canonical_object_kind = case p_canonical_object_kind when 'AGENT_VERSION' then 'AGENT' else 'DATA_ASSET' end;
    if not found then raise exception using errcode = 'P0002', message = 'PARENT_NOT_CANONICAL'; end if;
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
  insert into gov_repo.canonical_normalized_object_mappings (
    mapping_id, organisation_id, canonical_object_id, canonical_object_kind,
    source_connection_id, source_external_type, source_external_id, normalized_object_identity,
    candidate_id, parent_canonical_object_id, match_method, created_by_decision_id, valid_from
  ) values (v_mapping_id, p_organisation_id, p_canonical_object_id, p_canonical_object_kind,
    p_source_connection_id, p_source_external_type, p_source_external_id, v_identity,
    v_candidate.candidate_id, v_parent, p_match_method, p_reconciliation_decision_id, p_occurred_at)
  on conflict on constraint normalized_mapping_identity_unique do nothing
  returning mapping_id into v_mapping_id;
  if v_mapping_id is null then
    select m.mapping_id into v_mapping_id from gov_repo.canonical_normalized_object_mappings m
      where m.organisation_id = p_organisation_id and m.source_connection_id = p_source_connection_id
        and m.source_external_type = p_source_external_type and m.source_external_id = p_source_external_id
        and m.canonical_object_kind = p_canonical_object_kind and m.normalized_object_identity = v_identity
        and m.canonical_object_id = p_canonical_object_id and m.parent_canonical_object_id is not distinct from v_parent;
    if not found then raise exception using errcode = '23514', message = 'NORMALIZED_MAPPING_CONFLICT'; end if;
  end if;

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
  v_candidate gov_repo.discovery_candidates%rowtype;
  v_state jsonb;
  v_source record;
  v_target record;
  v_expected_id text;
  v_expected_source_kind text;
  v_expected_target_kinds text[];
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

  select dc.* into v_candidate from gov_repo.discovery_candidates dc
    join gov_repo.review_subjects rs on rs.organisation_id = dc.organisation_id and rs.finding_id = dc.finding_id
    where dc.organisation_id = p_organisation_id and dc.candidate_id = v_decision.relationship_candidate_id
      and dc.candidate_kind = 'RELATIONSHIP' and rs.candidate_kind = 'RELATIONSHIP'
      and rs.review_subject_id = v_invocation.review_subject_id and rs.state = 'CERTIFIED';
  if not found then raise exception using errcode = '23514', message = 'RELATIONSHIP_CANDIDATE_BINDING_MISMATCH'; end if;
  v_state := v_decision.envelope->(case p_outcome when 'CREATE_NEW' then 'authorizedState' else 'matchedState' end);
  if v_state is null or v_state->>'organisationId' is distinct from p_organisation_id::text
    or v_state->>'relationshipId' is distinct from p_relationship_id
    or v_state->>'relationshipStateId' is distinct from p_relationship_state_id
    or v_state->>'relationshipType' is distinct from p_relationship_type
    or v_candidate.relationship_type_code is distinct from p_relationship_type
    or v_state#>>'{source,canonicalObject,objectId}' is distinct from p_source_canonical_object_id
    or v_state#>>'{target,canonicalObject,objectId}' is distinct from p_target_canonical_object_id
    or v_state#>>'{source,canonicalObject,kind}' is distinct from p_source_kind
    or v_state#>>'{target,canonicalObject,kind}' is distinct from p_target_kind
    or v_state#>>'{source,canonicalObject,organisationId}' is distinct from p_organisation_id::text
    or v_state#>>'{target,canonicalObject,organisationId}' is distinct from p_organisation_id::text then
    raise exception using errcode = '23514', message = 'RELATIONSHIP_DECISION_STATE_MISMATCH';
  end if;
  if jsonb_array_length(coalesce(v_decision.envelope->'assertionIds','[]'::jsonb)) +
     jsonb_array_length(coalesce(v_decision.envelope->'evidenceIds','[]'::jsonb)) = 0
    or not (coalesce(v_candidate.envelope->'assertionIds','[]'::jsonb) @> coalesce(v_decision.envelope->'assertionIds','[]'::jsonb))
    or not (coalesce(v_candidate.envelope->'evidenceIds','[]'::jsonb) @> coalesce(v_decision.envelope->'evidenceIds','[]'::jsonb)) then
    raise exception using errcode = '23514', message = 'RELATIONSHIP_SUPPORT_MISMATCH';
  end if;
  select * into strict v_source from gov_repo.resolve_canonical_endpoint(p_organisation_id, v_candidate.source_endpoint);
  select * into strict v_target from gov_repo.resolve_canonical_endpoint(p_organisation_id, v_candidate.target_endpoint);
  if v_source.canonical_object_id is distinct from p_source_canonical_object_id or v_source.canonical_object_kind is distinct from p_source_kind
    or v_target.canonical_object_id is distinct from p_target_canonical_object_id or v_target.canonical_object_kind is distinct from p_target_kind then
    raise exception using errcode = '23514', message = 'RELATIONSHIP_ENDPOINT_MAPPING_MISMATCH';
  end if;
  v_expected_source_kind := case p_relationship_type when 'EXPOSES' then 'MCP_SERVER' when 'DERIVED_FROM' then 'DATA_ELEMENT'
    when 'USES_MODEL' then 'AGENT_VERSION' when 'USES_TOOL' then 'AGENT_VERSION' when 'USES_MCP' then 'AGENT_VERSION'
    when 'INVOKES' then 'AGENT_VERSION' when 'USES_PROMPT' then 'AGENT_VERSION' when 'USES_KNOWLEDGE_BASE' then 'AGENT_VERSION'
    when 'USES_SKILL' then 'AGENT_VERSION' when 'HANDOFF_TO' then 'AGENT_VERSION' when 'READS_FROM' then 'AGENT_VERSION' when 'WRITES_TO' then 'AGENT_VERSION' end;
  v_expected_target_kinds := case p_relationship_type when 'USES_MODEL' then array['MODEL'] when 'USES_TOOL' then array['TOOL']
    when 'USES_MCP' then array['MCP_SERVER'] when 'INVOKES' then array['API'] when 'USES_PROMPT' then array['PROMPT']
    when 'USES_KNOWLEDGE_BASE' then array['KNOWLEDGE_BASE'] when 'USES_SKILL' then array['SKILL'] when 'EXPOSES' then array['TOOL']
    when 'HANDOFF_TO' then array['AGENT'] when 'READS_FROM' then array['DATA_ASSET','DATA_ELEMENT'] when 'WRITES_TO' then array['DATA_ASSET','DATA_ELEMENT']
    when 'DERIVED_FROM' then array['DATA_ELEMENT'] end;
  if v_expected_source_kind is null or p_source_kind is distinct from v_expected_source_kind or not(p_target_kind = any(v_expected_target_kinds)) then
    raise exception using errcode = '23514', message = 'RELATIONSHIP_ENDPOINT_KIND_MISMATCH';
  end if;
  if p_outcome = 'CREATE_NEW' then
    v_expected_id := 'canonical-relationship:' || encode(extensions.digest(convert_to(gov_repo.frame_identity(array[
      p_organisation_id::text, p_relationship_type, p_source_canonical_object_id, p_target_canonical_object_id]),'UTF8'),'sha256'),'hex');
    if p_relationship_id is distinct from v_expected_id or p_relationship_state_id is distinct from v_expected_id || ':initial'
      or (v_state->>'validFrom')::timestamptz is distinct from p_valid_from
      or (v_state->>'recordedAt')::timestamptz is distinct from p_recorded_at then
      raise exception using errcode = '23514', message = 'RELATIONSHIP_SEMANTIC_IDENTITY_MISMATCH';
    end if;
    if p_relationship_type in ('USES_MODEL','USES_TOOL','USES_MCP','INVOKES','USES_PROMPT','USES_KNOWLEDGE_BASE','USES_SKILL') and not exists (
      select 1 from gov_repo.canonical_normalized_object_mappings m
      join gov_repo.agent_version_technical_profile_proposals profile on profile.organisation_id = m.organisation_id and profile.agent_version_candidate_id = m.candidate_id
      where m.organisation_id = p_organisation_id and m.mapping_id = v_source.mapping_id
        and profile.behavior_fingerprint_algorithm = v_state#>>'{boundTechnicalFingerprint,algorithm}'
        and profile.behavior_fingerprint_schema_version = v_state#>>'{boundTechnicalFingerprint,schemaVersion}'
        and profile.behavior_fingerprint_value = v_state#>>'{boundTechnicalFingerprint,value}') then
      raise exception using errcode = '23514', message = 'RELATIONSHIP_FINGERPRINT_SUPPORT_MISSING';
    end if;
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
        and cr.relationship_state_id = p_relationship_state_id
        and cr.valid_to is null
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


comment on function gov_repo.materialize_object_reconciliation is
  'Governed object materialization with exact typed normalized mappings. Existing APPLIED legacy operations replay; new writes never use coarse mappings. Object, mapping, operation and outbox commit atomically.';
comment on function gov_repo.materialize_relationship_reconciliation is
  'Governed exact relationship materialization. Revalidates persisted decision, candidate, support, endpoint mappings, canonical tuple and kind. Canonical edge, operation and outbox are atomic; no discovery authority.';
revoke all on function gov_repo.frame_identity, gov_repo.normalized_object_identity, gov_repo.resolve_canonical_endpoint, gov_repo.guard_final_review_decision from public, anon, authenticated;
grant execute on function gov_repo.frame_identity, gov_repo.normalized_object_identity, gov_repo.resolve_canonical_endpoint, gov_repo.guard_final_review_decision to service_role;
revoke all on function gov_repo.materialize_object_reconciliation, gov_repo.materialize_relationship_reconciliation from public, anon, authenticated;
grant execute on function gov_repo.materialize_object_reconciliation, gov_repo.materialize_relationship_reconciliation to service_role;
commit;
