-- Accepted field/fact authority ADR. No changes to historical identity or lineage.
begin;

create function gov_repo.technical_field_valid(k text, f text) returns boolean
language sql immutable strict set search_path = 'pg_catalog' as $$
  select (k = 'DATA_ASSET' and f in ('structuralKind','technicalName','qualifiedTechnicalLocator','technicalDescription'))
    or (k = 'DATA_ELEMENT' and f in ('technicalName','dataType.nativeType'));
$$;

-- Trusted server configuration, not an inbound registration endpoint.
create table gov_repo.technical_source_connections (
  connection_id text primary key,
  organisation_id uuid not null references gov_repo.organisations(organisation_id),
  source_system_id text not null,
  provider_code text not null,
  family text not null check (family in ('CATALOG','REPOSITORY')),
  display_name text not null,
  unique (organisation_id, connection_id)
);
create table gov_repo.technical_field_policies (
  organisation_id uuid not null,
  policy_id text not null,
  version text not null check (length(btrim(version)) > 0),
  object_kind text not null,
  field_key text not null,
  source_system_id text not null,
  provider_code text not null,
  connection_id text,
  disposition text not null check (disposition in ('AUTHORITATIVE','CONTRIBUTING','NON_AUTHORITATIVE')),
  rule_code text,
  rule_version text,
  primary key (organisation_id, policy_id, version),
  foreign key (organisation_id) references gov_repo.organisations(organisation_id),
  foreign key (organisation_id, connection_id) references gov_repo.technical_source_connections(organisation_id, connection_id),
  check (gov_repo.technical_field_valid(object_kind, field_key)),
  check ((rule_code is null and rule_version is null) or
    (rule_code is not null and rule_version is not null and length(btrim(rule_code)) > 0 and length(btrim(rule_version)) > 0 and disposition = 'AUTHORITATIVE'))
);
-- Reuse the repository's immutable versions + explicit current pointer pattern.
-- Trusted server configuration inserts a version, then explicitly inserts/updates
-- its head. Deleting a head deactivates the policy, never its version history.
create table gov_repo.technical_field_policy_heads (
  organisation_id uuid not null,
  policy_id text not null,
  version text not null,
  primary key (organisation_id, policy_id),
  foreign key (organisation_id, policy_id, version)
    references gov_repo.technical_field_policies(organisation_id, policy_id, version)
);
-- Serialize all applicability changes within the tenant, including first heads
-- and deactivation, with decision validation. No inferred version ordering.
create function gov_repo.lock_technical_field_policy_head() returns trigger
language plpgsql security invoker set search_path = 'gov_repo', 'pg_catalog' as $$
declare tenant uuid;
begin
  if TG_OP = 'UPDATE' and (new.organisation_id is distinct from old.organisation_id
    or new.policy_id is distinct from old.policy_id) then raise exception 'FIELD_POLICY_HEAD_IDENTITY_IMMUTABLE'; end if;
  if TG_OP = 'DELETE' then tenant := old.organisation_id; else tenant := new.organisation_id; end if;
  perform pg_advisory_xact_lock(hashtextextended(gov_repo.frame_identity(array[tenant::text,'technical-field-policy-heads']),0));
  if TG_OP = 'DELETE' then return old; else return new; end if;
end;
$$;
create trigger technical_field_policy_head_lock before insert or update or delete
  on gov_repo.technical_field_policy_heads for each row execute function gov_repo.lock_technical_field_policy_head();
-- Closed typed columns, no arbitrary field/value JSON. Exactly the selected
-- existing profile leaf has a value. Origin candidate and support never change.
create table gov_repo.technical_fact_proposals (
  organisation_id uuid not null,
  proposal_id text not null,
  candidate_id text not null,
  object_kind text not null,
  field_key text not null,
  structural_kind text check (structural_kind in ('TABLE','VIEW','MATERIALIZED_VIEW','DATASET','FILE','STREAM','COLLECTION','OTHER')),
  technical_name text,
  qualified_technical_locator text,
  technical_description text,
  native_type text,
  connection_id text not null,
  source_system_id text not null,
  external_type text not null,
  external_id text not null,
  normalized_object_identity text not null,
  trust_state text not null check (trust_state in ('IMPORTED','DECLARED')),
  attribute_code text not null,
  attribute_path text not null,
  primary key (organisation_id, proposal_id),
  foreign key (organisation_id, candidate_id) references gov_repo.discovery_candidates(organisation_id, candidate_id),
  foreign key (organisation_id, connection_id) references gov_repo.technical_source_connections(organisation_id, connection_id),
  check (gov_repo.technical_field_valid(object_kind, field_key)),
  check (num_nonnulls(structural_kind,technical_name,qualified_technical_locator,technical_description,native_type) = 1),
  check (case field_key when 'structuralKind' then structural_kind is not null
    when 'technicalName' then technical_name is not null when 'qualifiedTechnicalLocator' then qualified_technical_locator is not null
    when 'technicalDescription' then technical_description is not null when 'dataType.nativeType' then native_type is not null else false end),
  check (length(btrim(coalesce(structural_kind,technical_name,qualified_technical_locator,technical_description,native_type))) between 1 and 2048)
);
create table gov_repo.technical_fact_observations (
  organisation_id uuid not null,
  observation_id text not null,
  proposal_id text not null,
  candidate_id text not null,
  observed_at timestamptz not null,
  snapshot_id text not null,
  primary key (organisation_id, observation_id),
  unique (organisation_id, proposal_id, observation_id),
  foreign key (organisation_id, proposal_id) references gov_repo.technical_fact_proposals(organisation_id, proposal_id),
  foreign key (organisation_id, candidate_id) references gov_repo.discovery_candidates(organisation_id, candidate_id)
);
create table gov_repo.technical_fact_observation_assertions (
  organisation_id uuid not null, observation_id text not null, assertion_id text not null,
  primary key (organisation_id, observation_id, assertion_id),
  foreign key (organisation_id, observation_id) references gov_repo.technical_fact_observations(organisation_id, observation_id),
  foreign key (organisation_id, assertion_id) references gov_repo.source_assertions(organisation_id, assertion_id)
);
-- Current received source observation; never current canonical truth. An exact
-- old observation replay cannot move this head backwards. Updated under the
-- same source/field lock used by decisions, before the canonical-state lock.
create table gov_repo.technical_fact_source_heads (
  organisation_id uuid not null, connection_id text not null, external_type text not null,
  external_id text not null, object_kind text not null, field_key text not null,
  observation_id text not null,
  primary key (organisation_id, connection_id, external_type, external_id, object_kind, field_key),
  foreign key (organisation_id, connection_id) references gov_repo.technical_source_connections(organisation_id, connection_id),
  foreign key (organisation_id, observation_id) references gov_repo.technical_fact_observations(organisation_id, observation_id),
  check (gov_repo.technical_field_valid(object_kind, field_key))
);
create table gov_repo.technical_fact_observation_evidence (
  organisation_id uuid not null, observation_id text not null, evidence_id text not null,
  primary key (organisation_id, observation_id, evidence_id),
  foreign key (organisation_id, observation_id) references gov_repo.technical_fact_observations(organisation_id, observation_id),
  foreign key (organisation_id, evidence_id) references gov_repo.discovery_evidence(organisation_id, evidence_id)
);
create table gov_repo.technical_field_decisions (
  organisation_id uuid not null, decision_id text not null,
  canonical_object_id text not null, object_kind text not null, field_key text not null,
  proposal_id text not null, expected_current_state_id text,
  expected_source_observation_id text not null,
  expected_source_snapshot_id text not null,
  policy_id text, policy_version text,
  outcome text not null check (outcome in ('ACCEPT_PROPOSED','KEEP_CURRENT','DEFER','REJECT_PROPOSED')),
  actor_kind text not null check (actor_kind in ('HUMAN','DETERMINISTIC_RULE')),
  actor_reference text not null check (length(btrim(actor_reference)) > 0), rule_version text,
  decided_at timestamptz not null,
  primary key (organisation_id, decision_id),
  foreign key (organisation_id, canonical_object_id, object_kind) references gov_repo.canonical_objects(organisation_id, canonical_object_id, kind),
  foreign key (organisation_id, proposal_id) references gov_repo.technical_fact_proposals(organisation_id, proposal_id),
  foreign key (organisation_id, expected_source_observation_id) references gov_repo.technical_fact_observations(organisation_id, observation_id),
  foreign key (organisation_id, policy_id, policy_version) references gov_repo.technical_field_policies(organisation_id, policy_id, version),
  check (gov_repo.technical_field_valid(object_kind, field_key)),
  check ((policy_id is null) = (policy_version is null)),
  check ((actor_kind = 'HUMAN' and rule_version is null) or (actor_kind = 'DETERMINISTIC_RULE' and rule_version is not null and length(btrim(rule_version)) > 0))
);
create table gov_repo.technical_field_decision_observations (
  organisation_id uuid not null, decision_id text not null, observation_id text not null,
  primary key (organisation_id, decision_id, observation_id),
  foreign key (organisation_id, decision_id) references gov_repo.technical_field_decisions(organisation_id, decision_id),
  foreign key (organisation_id, observation_id) references gov_repo.technical_fact_observations(organisation_id, observation_id)
);
create table gov_repo.technical_field_states (
  organisation_id uuid not null, state_id text not null, canonical_object_id text not null,
  object_kind text not null, field_key text not null, proposal_id text not null,
  decision_id text not null, previous_state_id text, recorded_at timestamptz not null,
  primary key (organisation_id, state_id),
  unique (organisation_id, decision_id),
  unique (organisation_id, previous_state_id),
  foreign key (organisation_id, canonical_object_id, object_kind) references gov_repo.canonical_objects(organisation_id, canonical_object_id, kind),
  foreign key (organisation_id, proposal_id) references gov_repo.technical_fact_proposals(organisation_id, proposal_id),
  foreign key (organisation_id, decision_id) references gov_repo.technical_field_decisions(organisation_id, decision_id),
  foreign key (organisation_id, previous_state_id) references gov_repo.technical_field_states(organisation_id, state_id),
  check (gov_repo.technical_field_valid(object_kind, field_key))
);
create unique index technical_field_initial_state on gov_repo.technical_field_states
  (organisation_id, canonical_object_id, field_key) where previous_state_id is null;

-- Snapshot membership/current source guard reuses snapshot identity from durable
-- SourceAssertion. No copied payload or canonical values. A new capture with an
-- absent leaf invalidates old reviews; it does not delete a governed field.
create table gov_repo.technical_source_snapshots (
  organisation_id uuid not null, connection_id text not null, external_type text not null,
  external_id text not null, snapshot_id text not null,
  primary key (organisation_id,connection_id,external_type,external_id,snapshot_id),
  foreign key (organisation_id,connection_id) references gov_repo.technical_source_connections(organisation_id,connection_id)
);
create table gov_repo.technical_source_snapshot_heads (
  organisation_id uuid not null, connection_id text not null, external_type text not null,
  external_id text not null, snapshot_id text not null,
  primary key (organisation_id,connection_id,external_type,external_id),
  foreign key (organisation_id,connection_id,external_type,external_id,snapshot_id)
    references gov_repo.technical_source_snapshots(organisation_id,connection_id,external_type,external_id,snapshot_id)
);

-- Adapter run identity is content-addressed. Preserve the first acquisition
-- timestamp on a later exact replay instead of weakening the generic run RPC.
create function gov_repo.start_exchange_acquisition_run(p_organisation_id uuid,p_run jsonb)
returns table(replay boolean,run_id text,status text)
language plpgsql security invoker set search_path = 'gov_repo', 'pg_catalog' as $$
declare original gov_repo.acquisition_runs%rowtype; started timestamptz;
begin
  perform 1 from gov_repo.technical_source_connections cfg where cfg.organisation_id=p_organisation_id
    and cfg.connection_id=p_run#>>'{connection,connectionId}' and cfg.source_system_id=p_run#>>'{connection,sourceSystemId}';
  if not found then raise exception 'EXCHANGE_CONNECTION_MISMATCH'; end if;
  perform pg_advisory_xact_lock(hashtextextended(gov_repo.frame_identity(array[p_organisation_id::text,p_run->>'runId']),0));
  select ar.* into original from gov_repo.acquisition_runs ar where ar.run_id=p_run->>'runId';
  started := coalesce(original.started_at,(p_run->>'startedAt')::timestamptz);
  return query select * from gov_repo.start_acquisition_run(p_run->>'runId',p_organisation_id,
    p_run#>>'{connection,connectionId}',p_run#>>'{connection,sourceSystemId}',p_run->>'adapterName',p_run->>'adapterVersion',
    p_run->>'mode',p_run->>'sourceVersion',p_run->>'checkpoint',started);
end;
$$;

create function gov_repo.record_technical_fact(p_organisation_id uuid, p_proposal jsonb, p_observation jsonb)
returns void language plpgsql security invoker set search_path = 'gov_repo', 'pg_catalog' as $$
declare
  p gov_repo.technical_fact_proposals%rowtype;
  existing gov_repo.technical_fact_proposals%rowtype;
  c gov_repo.discovery_candidates%rowtype;
  cfg gov_repo.technical_source_connections%rowtype;
  aid text; eid text; sa gov_repo.source_assertions%rowtype;
  obs text := p_observation->>'observationId'; snapshot text;
  aids text[]; eids text[]; old_aids text[]; old_eids text[];
begin
  if p_proposal->>'organisationId' is distinct from p_organisation_id::text
    or p_observation->>'organisationId' is distinct from p_organisation_id::text
    or p_observation->>'proposalId' is distinct from p_proposal->>'proposalId'
    or p_observation->>'candidateId' is distinct from p_proposal->>'candidateId'
    or jsonb_typeof(p_proposal#>'{fact,value}') is distinct from 'string'
  then raise exception 'FACT_CONTEXT_MISMATCH'; end if;
  select * into strict cfg from gov_repo.technical_source_connections
    where organisation_id = p_organisation_id and connection_id = p_proposal#>>'{sourceObject,connectionId}';
  if cfg.source_system_id is distinct from p_proposal#>>'{sourceSystem,sourceSystemId}'
    or cfg.provider_code is distinct from p_proposal#>>'{sourceSystem,provider,providerCode}'
    or cfg.family is distinct from p_proposal#>>'{sourceSystem,family}' then raise exception 'FACT_SOURCE_MISMATCH'; end if;
  select * into strict c from gov_repo.discovery_candidates where organisation_id = p_organisation_id and candidate_id = p_proposal->>'candidateId';
  if c.candidate_kind is distinct from p_proposal#>>'{fact,objectKind}' or c.source_connection_id <> cfg.connection_id
    or c.source_external_type is distinct from p_proposal#>>'{sourceObject,externalType}'
    or c.source_external_id is distinct from p_proposal#>>'{sourceObject,externalId}'
    or gov_repo.normalized_object_identity(p_organisation_id,c.envelope) is distinct from p_proposal->>'normalizedObjectIdentity'
  then raise exception 'FACT_CANDIDATE_SUBSTITUTION'; end if;
  p.organisation_id := p_organisation_id; p.proposal_id := p_proposal->>'proposalId'; p.candidate_id := c.candidate_id;
  p.object_kind := c.candidate_kind; p.field_key := p_proposal#>>'{fact,field}';
  p.structural_kind := case when p.field_key = 'structuralKind' then p_proposal#>>'{fact,value}' end;
  p.technical_name := case when p.field_key = 'technicalName' then p_proposal#>>'{fact,value}' end;
  p.qualified_technical_locator := case when p.field_key = 'qualifiedTechnicalLocator' then p_proposal#>>'{fact,value}' end;
  p.technical_description := case when p.field_key = 'technicalDescription' then p_proposal#>>'{fact,value}' end;
  p.native_type := case when p.field_key = 'dataType.nativeType' then p_proposal#>>'{fact,value}' end;
  p.connection_id := cfg.connection_id; p.source_system_id := cfg.source_system_id;
  p.external_type := c.source_external_type; p.external_id := c.source_external_id;
  p.normalized_object_identity := p_proposal->>'normalizedObjectIdentity'; p.trust_state := p_proposal->>'trustState';
  p.attribute_code := p_proposal#>>'{sourceAttribute,code}'; p.attribute_path := p_proposal#>>'{sourceAttribute,path}';
  select array_agg(distinct value order by value) into aids from jsonb_array_elements_text(p_observation#>'{support,assertionIds}');
  select array_agg(distinct value order by value) into eids from jsonb_array_elements_text(p_observation#>'{support,evidenceIds}');
  if coalesce(cardinality(aids),0) = 0 or coalesce(cardinality(eids),0) = 0 or obs is null then raise exception 'FACT_SUPPORT_REQUIRED'; end if;
  foreach aid in array aids loop
    select * into strict sa from gov_repo.source_assertions where organisation_id = p_organisation_id and assertion_id = aid;
    if sa.snapshot_id is null or (snapshot is not null and snapshot <> sa.snapshot_id) then raise exception 'FACT_SNAPSHOT_MISMATCH'; end if;
    snapshot := sa.snapshot_id;
    if sa.trust_state <> p.trust_state or sa.source_connection_id <> p.connection_id
      or sa.source_external_type <> p.external_type or sa.source_external_id <> p.external_id
      or sa.envelope#>>'{sourceAttribute,path}' is distinct from p.attribute_path
      or not (c.envelope->'assertionIds' ? aid)
      or exists (select 1 from gov_repo.source_assertion_evidence s where s.organisation_id = p_organisation_id and s.assertion_id = aid and not (s.evidence_id = any(eids)))
    then raise exception 'FACT_ASSERTION_SUBSTITUTION'; end if;
    perform 1 from gov_repo.acquisition_runs ar where ar.organisation_id = p_organisation_id and ar.run_id = sa.run_id
      and ar.source_connection_id = cfg.connection_id and ar.source_system_id = cfg.source_system_id;
    if not found then raise exception 'FACT_ACQUISITION_MISMATCH'; end if;
  end loop;
  foreach eid in array eids loop
    if not (c.envelope->'evidenceIds' ? eid) then raise exception 'FACT_EVIDENCE_SUBSTITUTION'; end if;
    perform 1 from gov_repo.source_assertion_evidence s where s.organisation_id = p_organisation_id and s.assertion_id = any(aids) and s.evidence_id = eid;
    if not found then raise exception 'FACT_EVIDENCE_UNSUPPORTED'; end if;
  end loop;
  perform pg_advisory_xact_lock(hashtextextended(gov_repo.frame_identity(array[p_organisation_id::text,p.connection_id,p.external_type,p.external_id]),0));
  if not exists (select 1 from gov_repo.technical_source_snapshots s where s.organisation_id = p_organisation_id
    and s.connection_id = p.connection_id and s.external_type = p.external_type and s.external_id = p.external_id and s.snapshot_id = snapshot) then
    insert into gov_repo.technical_source_snapshots values (p_organisation_id,p.connection_id,p.external_type,p.external_id,snapshot);
    insert into gov_repo.technical_source_snapshot_heads values (p_organisation_id,p.connection_id,p.external_type,p.external_id,snapshot)
      on conflict (organisation_id,connection_id,external_type,external_id) do update set snapshot_id = excluded.snapshot_id;
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_organisation_id::text || ':' || p.proposal_id,0));
  select * into existing from gov_repo.technical_fact_proposals where organisation_id = p_organisation_id and proposal_id = p.proposal_id;
  if found then
    -- Observations may have new snapshot candidate IDs; semantic origin stays immutable.
    if (to_jsonb(existing) - 'candidate_id') is distinct from (to_jsonb(p) - 'candidate_id') then raise exception 'FACT_PROPOSAL_CONFLICT'; end if;
  else insert into gov_repo.technical_fact_proposals select p.*; end if;
  if exists (select 1 from gov_repo.technical_fact_observations o where o.organisation_id = p_organisation_id and o.observation_id = obs) then
    perform 1 from gov_repo.technical_fact_observations o where o.organisation_id = p_organisation_id and o.observation_id = obs and o.proposal_id = p.proposal_id and o.candidate_id = c.candidate_id;
    if not found then raise exception 'FACT_OBSERVATION_CONFLICT'; end if;
    select array_agg(assertion_id order by assertion_id) into old_aids from gov_repo.technical_fact_observation_assertions where organisation_id = p_organisation_id and observation_id = obs;
    select array_agg(evidence_id order by evidence_id) into old_eids from gov_repo.technical_fact_observation_evidence where organisation_id = p_organisation_id and observation_id = obs;
    if old_aids is distinct from aids or old_eids is distinct from eids then raise exception 'FACT_OBSERVATION_CONFLICT'; end if;
    return;
  end if;
  insert into gov_repo.technical_fact_observations values (p_organisation_id,obs,p.proposal_id,c.candidate_id,(p_observation->>'observedAt')::timestamptz,snapshot);
  insert into gov_repo.technical_fact_observation_assertions select p_organisation_id,obs,unnest(aids);
  insert into gov_repo.technical_fact_observation_evidence select p_organisation_id,obs,unnest(eids);
  if exists (select 1 from gov_repo.technical_source_snapshot_heads h where h.organisation_id=p_organisation_id
    and h.connection_id=p.connection_id and h.external_type=p.external_type and h.external_id=p.external_id and h.snapshot_id=snapshot) then
    insert into gov_repo.technical_fact_source_heads values (p_organisation_id,p.connection_id,p.external_type,p.external_id,p.object_kind,p.field_key,obs)
      on conflict (organisation_id,connection_id,external_type,external_id,object_kind,field_key)
      do update set observation_id = excluded.observation_id;
  end if;
end;
$$;

create function gov_repo.record_technical_field_decision(p_organisation_id uuid, p_decision jsonb)
returns table (replay boolean, state_id text)
language plpgsql security invoker set search_path = 'gov_repo', 'pg_catalog' as $$
declare
  d gov_repo.technical_field_decisions%rowtype;
  old_d gov_repo.technical_field_decisions%rowtype;
  p gov_repo.technical_fact_proposals%rowtype;
  current_state gov_repo.technical_field_states%rowtype;
  current_p gov_repo.technical_fact_proposals%rowtype;
  policy gov_repo.technical_field_policies%rowtype;
  mapped record; observations text[]; old_observations text[]; policy_count integer; new_state text;
begin
  if p_decision->>'organisationId' is distinct from p_organisation_id::text or
     p_decision#>>'{canonicalObject,organisationId}' is distinct from p_organisation_id::text then raise exception 'FIELD_TENANT_MISMATCH'; end if;
  select * into strict p from gov_repo.technical_fact_proposals where organisation_id = p_organisation_id and proposal_id = p_decision->>'proposalId';
  perform pg_advisory_xact_lock(hashtextextended(gov_repo.frame_identity(array[p_organisation_id::text,p.connection_id,p.external_type,p.external_id]),0));
  select * into strict mapped from gov_repo.resolve_canonical_endpoint(p_organisation_id,
    jsonb_build_object('referenceKind','CANDIDATE','candidateKind',p.object_kind,'candidateId',p.candidate_id));
  if mapped.canonical_object_id is distinct from p_decision#>>'{canonicalObject,objectId}' or
     mapped.canonical_object_kind is distinct from p_decision#>>'{canonicalObject,kind}' or p.field_key is distinct from p_decision->>'field'
     then raise exception 'FIELD_SUBJECT_SUBSTITUTION'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_organisation_id::text || ':' || mapped.canonical_object_id || ':' || p.field_key,0));
  d.organisation_id := p_organisation_id; d.decision_id := p_decision->>'decisionId';
  d.canonical_object_id := mapped.canonical_object_id; d.object_kind := p.object_kind; d.field_key := p.field_key;
  d.proposal_id := p.proposal_id; d.expected_current_state_id := p_decision->>'expectedCurrentStateId';
  d.expected_source_observation_id := p_decision->>'expectedSourceObservationId';
  d.expected_source_snapshot_id := p_decision->>'expectedSourceSnapshotId';
  d.policy_id := p_decision->>'policyId'; d.policy_version := p_decision->>'policyVersion';
  d.outcome := p_decision->>'outcome'; d.actor_kind := p_decision#>>'{actor,authorityKind}';
  d.actor_reference := case d.actor_kind when 'HUMAN' then p_decision#>>'{actor,actorReference}' when 'DETERMINISTIC_RULE' then p_decision#>>'{actor,ruleCode}' end;
  d.rule_version := p_decision#>>'{actor,ruleVersion}'; d.decided_at := (p_decision->>'decidedAt')::timestamptz;
  select array_agg(distinct value order by value) into observations from jsonb_array_elements_text(p_decision->'observationIds');
  if coalesce(cardinality(observations),0) = 0 then raise exception 'FIELD_REVIEWED_SUPPORT_REQUIRED'; end if;
  if exists (select 1 from unnest(observations) id where not exists (select 1 from gov_repo.technical_fact_observations o
    where o.organisation_id = p_organisation_id and o.observation_id = id and o.proposal_id = p.proposal_id))
    then raise exception 'FIELD_OBSERVATION_SUBSTITUTION'; end if;
  select * into old_d from gov_repo.technical_field_decisions where organisation_id = p_organisation_id and decision_id = d.decision_id;
  if found then
    select array_agg(observation_id order by observation_id) into old_observations from gov_repo.technical_field_decision_observations where organisation_id = p_organisation_id and decision_id = d.decision_id;
    if old_d is distinct from d or old_observations is distinct from observations then raise exception 'FIELD_DECISION_REPLAY_CONFLICT'; end if;
    return query select true, s.state_id from (select 1) dummy left join gov_repo.technical_field_states s on s.organisation_id = p_organisation_id and s.decision_id = d.decision_id;
    return;
  end if;
  perform 1 from gov_repo.technical_fact_source_heads h where h.organisation_id = p_organisation_id
    and h.connection_id = p.connection_id and h.external_type = p.external_type and h.external_id = p.external_id
    and h.object_kind = p.object_kind and h.field_key = p.field_key and h.observation_id = d.expected_source_observation_id
    and h.observation_id = any(observations);
  if not found then raise exception 'FIELD_STALE_SOURCE'; end if;
  perform 1 from gov_repo.technical_source_snapshot_heads h where h.organisation_id = p_organisation_id
    and h.connection_id = p.connection_id and h.external_type = p.external_type and h.external_id = p.external_id
    and h.snapshot_id = d.expected_source_snapshot_id;
  if not found then raise exception 'FIELD_STALE_SOURCE'; end if;
  -- The current snapshot must actually support this reviewed leaf; callers
  -- cannot attach an absent-field snapshot to a historical value decision.
  perform 1 from gov_repo.technical_fact_observation_assertions oa join gov_repo.source_assertions sa
    on sa.organisation_id = oa.organisation_id and sa.assertion_id = oa.assertion_id
    where oa.organisation_id = p_organisation_id and oa.observation_id = d.expected_source_observation_id
    and sa.snapshot_id = d.expected_source_snapshot_id;
  if not found then raise exception 'FIELD_STALE_SOURCE'; end if;
  select * into current_state from gov_repo.technical_field_states s
    where s.organisation_id = p_organisation_id and s.canonical_object_id = d.canonical_object_id and s.field_key = p.field_key
    and not exists (select 1 from gov_repo.technical_field_states successor where successor.organisation_id = p_organisation_id and successor.previous_state_id = s.state_id);
  if current_state.state_id is distinct from d.expected_current_state_id then raise exception 'FIELD_STALE_STATE'; end if;
  perform pg_advisory_xact_lock(hashtextextended(gov_repo.frame_identity(array[p_organisation_id::text,'technical-field-policy-heads']),0));
  select count(*) into policy_count from gov_repo.technical_field_policies pol
    join gov_repo.technical_field_policy_heads ph on ph.organisation_id = pol.organisation_id and ph.policy_id = pol.policy_id and ph.version = pol.version
    join gov_repo.technical_source_connections cfg on cfg.organisation_id = pol.organisation_id and cfg.connection_id = p.connection_id
    where pol.organisation_id = p_organisation_id and pol.object_kind = p.object_kind and pol.field_key = p.field_key
    and pol.source_system_id = p.source_system_id and pol.provider_code = cfg.provider_code
    and (pol.connection_id is null or pol.connection_id = p.connection_id);
  if policy_count > 1 then raise exception 'FIELD_POLICY_AMBIGUOUS'; end if;
  if policy_count = 1 then
    select pol.* into strict policy from gov_repo.technical_field_policies pol
      join gov_repo.technical_field_policy_heads ph on ph.organisation_id = pol.organisation_id and ph.policy_id = pol.policy_id and ph.version = pol.version
      join gov_repo.technical_source_connections cfg on cfg.organisation_id = pol.organisation_id and cfg.connection_id = p.connection_id
      where pol.organisation_id = p_organisation_id and pol.object_kind = p.object_kind and pol.field_key = p.field_key
      and pol.source_system_id = p.source_system_id and pol.provider_code = cfg.provider_code
      and (pol.connection_id is null or pol.connection_id = p.connection_id);
  end if;
  if policy.policy_id is distinct from d.policy_id or policy.version is distinct from d.policy_version then raise exception 'FIELD_STALE_POLICY'; end if;
  if d.outcome = 'ACCEPT_PROPOSED' and (policy_count = 0 or policy.disposition = 'NON_AUTHORITATIVE') then raise exception 'FIELD_AUTHORITY_DENIED'; end if;
  if d.outcome = 'KEEP_CURRENT' and current_state.state_id is null then raise exception 'FIELD_CURRENT_REQUIRED'; end if;
  if d.actor_kind = 'DETERMINISTIC_RULE' then
    if d.outcome <> 'ACCEPT_PROPOSED' or policy.disposition is distinct from 'AUTHORITATIVE' or
      policy.rule_code is distinct from d.actor_reference or policy.rule_version is distinct from d.rule_version or policy.rule_code is null
      then raise exception 'FIELD_MACHINE_AUTHORITY_FORBIDDEN'; end if;
    if current_state.state_id is not null then
      select * into strict current_p from gov_repo.technical_fact_proposals where organisation_id = p_organisation_id and proposal_id = current_state.proposal_id;
      if row(current_p.structural_kind,current_p.technical_name,current_p.qualified_technical_locator,current_p.technical_description,current_p.native_type)
        is distinct from row(p.structural_kind,p.technical_name,p.qualified_technical_locator,p.technical_description,p.native_type)
        then raise exception 'FIELD_CONFLICT_REQUIRES_HUMAN'; end if;
    end if;
  end if;
  insert into gov_repo.technical_field_decisions select d.*;
  insert into gov_repo.technical_field_decision_observations select p_organisation_id,d.decision_id,unnest(observations);
  if d.outcome = 'ACCEPT_PROPOSED' then
    new_state := 'field-state:' || d.decision_id;
    insert into gov_repo.technical_field_states values (p_organisation_id,new_state,d.canonical_object_id,p.object_kind,p.field_key,
      p.proposal_id,d.decision_id,current_state.state_id,d.decided_at);
  end if;
  return query select false,new_state;
end;
$$;

alter table gov_repo.technical_source_connections enable row level security;
revoke all on gov_repo.technical_source_connections from public, anon, authenticated;
grant select, insert on gov_repo.technical_source_connections to service_role;
create policy technical_source_connections_service on gov_repo.technical_source_connections for all to service_role using (true) with check (true);
create rule technical_source_connections_no_update as on update to gov_repo.technical_source_connections do instead nothing;
create rule technical_source_connections_no_delete as on delete to gov_repo.technical_source_connections do instead nothing;

alter table gov_repo.technical_field_policies enable row level security;
revoke all on gov_repo.technical_field_policies from public, anon, authenticated;
grant select, insert on gov_repo.technical_field_policies to service_role;
create policy technical_field_policies_service on gov_repo.technical_field_policies for all to service_role using (true) with check (true);
create rule technical_field_policies_no_update as on update to gov_repo.technical_field_policies do instead nothing;
create rule technical_field_policies_no_delete as on delete to gov_repo.technical_field_policies do instead nothing;

alter table gov_repo.technical_field_policy_heads enable row level security;
revoke all on gov_repo.technical_field_policy_heads from public, anon, authenticated;
grant select, insert, update, delete on gov_repo.technical_field_policy_heads to service_role;
create policy technical_field_policy_heads_service on gov_repo.technical_field_policy_heads for all to service_role using (true) with check (true);
revoke all on function gov_repo.lock_technical_field_policy_head from public, anon, authenticated;
grant execute on function gov_repo.lock_technical_field_policy_head to service_role;

alter table gov_repo.technical_fact_proposals enable row level security;
revoke all on gov_repo.technical_fact_proposals from public, anon, authenticated;
grant select, insert on gov_repo.technical_fact_proposals to service_role;
create policy technical_fact_proposals_service on gov_repo.technical_fact_proposals for all to service_role using (true) with check (true);
create rule technical_fact_proposals_no_update as on update to gov_repo.technical_fact_proposals do instead nothing;
create rule technical_fact_proposals_no_delete as on delete to gov_repo.technical_fact_proposals do instead nothing;

alter table gov_repo.technical_fact_observations enable row level security;
revoke all on gov_repo.technical_fact_observations from public, anon, authenticated;
grant select, insert on gov_repo.technical_fact_observations to service_role;
create policy technical_fact_observations_service on gov_repo.technical_fact_observations for all to service_role using (true) with check (true);
create rule technical_fact_observations_no_update as on update to gov_repo.technical_fact_observations do instead nothing;
create rule technical_fact_observations_no_delete as on delete to gov_repo.technical_fact_observations do instead nothing;

alter table gov_repo.technical_fact_observation_assertions enable row level security;
revoke all on gov_repo.technical_fact_observation_assertions from public, anon, authenticated;
grant select, insert on gov_repo.technical_fact_observation_assertions to service_role;
create policy technical_fact_observation_assertions_service on gov_repo.technical_fact_observation_assertions for all to service_role using (true) with check (true);
create rule technical_fact_observation_assertions_no_update as on update to gov_repo.technical_fact_observation_assertions do instead nothing;
create rule technical_fact_observation_assertions_no_delete as on delete to gov_repo.technical_fact_observation_assertions do instead nothing;

alter table gov_repo.technical_fact_observation_evidence enable row level security;
revoke all on gov_repo.technical_fact_observation_evidence from public, anon, authenticated;
grant select, insert on gov_repo.technical_fact_observation_evidence to service_role;
create policy technical_fact_observation_evidence_service on gov_repo.technical_fact_observation_evidence for all to service_role using (true) with check (true);
create rule technical_fact_observation_evidence_no_update as on update to gov_repo.technical_fact_observation_evidence do instead nothing;
create rule technical_fact_observation_evidence_no_delete as on delete to gov_repo.technical_fact_observation_evidence do instead nothing;

alter table gov_repo.technical_field_decisions enable row level security;
revoke all on gov_repo.technical_field_decisions from public, anon, authenticated;
grant select, insert on gov_repo.technical_field_decisions to service_role;
create policy technical_field_decisions_service on gov_repo.technical_field_decisions for all to service_role using (true) with check (true);
create rule technical_field_decisions_no_update as on update to gov_repo.technical_field_decisions do instead nothing;
create rule technical_field_decisions_no_delete as on delete to gov_repo.technical_field_decisions do instead nothing;

alter table gov_repo.technical_field_decision_observations enable row level security;
revoke all on gov_repo.technical_field_decision_observations from public, anon, authenticated;
grant select, insert on gov_repo.technical_field_decision_observations to service_role;
create policy technical_field_decision_observations_service on gov_repo.technical_field_decision_observations for all to service_role using (true) with check (true);
create rule technical_field_decision_observations_no_update as on update to gov_repo.technical_field_decision_observations do instead nothing;
create rule technical_field_decision_observations_no_delete as on delete to gov_repo.technical_field_decision_observations do instead nothing;

alter table gov_repo.technical_field_states enable row level security;
revoke all on gov_repo.technical_field_states from public, anon, authenticated;
grant select, insert on gov_repo.technical_field_states to service_role;
create policy technical_field_states_service on gov_repo.technical_field_states for all to service_role using (true) with check (true);
create rule technical_field_states_no_update as on update to gov_repo.technical_field_states do instead nothing;
create rule technical_field_states_no_delete as on delete to gov_repo.technical_field_states do instead nothing;

alter table gov_repo.technical_fact_source_heads enable row level security;
revoke all on gov_repo.technical_fact_source_heads from public, anon, authenticated;
grant select, insert, update on gov_repo.technical_fact_source_heads to service_role;
create policy technical_fact_source_heads_service on gov_repo.technical_fact_source_heads for all to service_role using (true) with check (true);
alter table gov_repo.technical_source_snapshots enable row level security;
revoke all on gov_repo.technical_source_snapshots from public, anon, authenticated;
grant select, insert on gov_repo.technical_source_snapshots to service_role;
create policy technical_source_snapshots_service on gov_repo.technical_source_snapshots for all to service_role using (true) with check (true);
create rule technical_source_snapshots_no_update as on update to gov_repo.technical_source_snapshots do instead nothing;
create rule technical_source_snapshots_no_delete as on delete to gov_repo.technical_source_snapshots do instead nothing;
alter table gov_repo.technical_source_snapshot_heads enable row level security;
revoke all on gov_repo.technical_source_snapshot_heads from public, anon, authenticated;
grant select, insert, update on gov_repo.technical_source_snapshot_heads to service_role;
create policy technical_source_snapshot_heads_service on gov_repo.technical_source_snapshot_heads for all to service_role using (true) with check (true);
revoke all on function gov_repo.technical_field_valid, gov_repo.record_technical_fact, gov_repo.record_technical_field_decision from public, anon, authenticated;
grant execute on function gov_repo.technical_field_valid, gov_repo.record_technical_fact, gov_repo.record_technical_field_decision to service_role;
revoke all on function gov_repo.start_exchange_acquisition_run from public, anon, authenticated;
grant execute on function gov_repo.start_exchange_acquisition_run to service_role;
commit;
