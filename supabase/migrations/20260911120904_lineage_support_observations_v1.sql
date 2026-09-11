-- Additive DERIVED_FROM provenance only. Original candidate/review/M7 support
-- remains immutable. Observation findings reuse existing assertion/evidence FKs.
begin;

create table gov_repo.lineage_candidate_observations (
  organisation_id uuid not null,
  candidate_id text not null,
  observation_finding_id text not null,
  source_candidate_id text not null,
  target_candidate_id text not null,
  primary key (organisation_id, candidate_id, observation_finding_id),
  unique (organisation_id, observation_finding_id),
  foreign key (organisation_id, candidate_id) references gov_repo.discovery_candidates (organisation_id, candidate_id),
  foreign key (organisation_id, observation_finding_id) references gov_repo.discovery_findings (organisation_id, finding_id),
  foreign key (organisation_id, source_candidate_id) references gov_repo.discovery_candidates (organisation_id, candidate_id),
  foreign key (organisation_id, target_candidate_id) references gov_repo.discovery_candidates (organisation_id, candidate_id)
);
comment on table gov_repo.lineage_candidate_observations is
  'Append-only SQL lineage observations attached to one immutable semantic candidate. Observation finding support is discovery provenance, not reviewed/approved support. Original candidate and ReviewSubject envelopes remain authoritative for M7.';
create index lineage_observation_source on gov_repo.lineage_candidate_observations (organisation_id, source_candidate_id);
create index lineage_observation_target on gov_repo.lineage_candidate_observations (organisation_id, target_candidate_id);
create rule lineage_observations_no_update as on update to gov_repo.lineage_candidate_observations do instead nothing;
create rule lineage_observations_no_delete as on delete to gov_repo.lineage_candidate_observations do instead nothing;
alter table gov_repo.lineage_candidate_observations enable row level security;
revoke all on gov_repo.lineage_candidate_observations from public, anon, authenticated;
grant select, insert on gov_repo.lineage_candidate_observations to service_role;
create policy lineage_observations_service on gov_repo.lineage_candidate_observations
  for all to service_role using (true) with check (true);

create function gov_repo.record_lineage_observation(
  p_organisation_id uuid, p_acquisition_run_id text,
  p_candidate jsonb, p_candidate_hash char(64), p_finding jsonb, p_finding_hash char(64),
  p_observation jsonb, p_observation_hash char(64)
) returns table (candidate jsonb, candidate_hash char(64), finding jsonb, finding_hash char(64))
language plpgsql volatile security invoker set search_path = 'gov_repo', 'pg_catalog' as $$
declare
  v_origin gov_repo.discovery_candidates%rowtype;
  v_origin_finding gov_repo.discovery_findings%rowtype;
  v_existing_observation gov_repo.discovery_findings%rowtype;
  v_endpoint gov_repo.discovery_candidates%rowtype;
  v_original_endpoint gov_repo.discovery_candidates%rowtype;
  v_side text;
  v_candidate_id text := p_candidate->>'candidateId';
  v_observation_id text := p_observation->>'findingId';
  v_assertions text[];
  v_evidence text[];
begin
  if p_organisation_id is null or v_candidate_id is null or v_candidate_id !~ '^candidate:relationship:[a-f0-9]{32}$'
    or p_candidate->>'candidateKind' is distinct from 'RELATIONSHIP'
    or p_candidate->>'relationshipTypeCode' is distinct from 'DERIVED_FROM'
    or p_candidate->>'requiresReconciliation' is distinct from 'true'
    or p_finding->>'candidateKind' is distinct from 'RELATIONSHIP'
    or p_finding->>'findingNature' is distinct from 'CANDIDATE'
    or p_finding->>'reviewStatus' is distinct from 'UNREVIEWED'
    or p_finding->>'requiresReview' is distinct from 'true'
    or p_finding->>'createsCanonicalObject' is distinct from 'false'
    or p_candidate->>'findingId' is distinct from p_finding->>'findingId'
    or p_candidate->'sourceObject' is distinct from p_finding->'sourceObject'
    or p_candidate->'assertionIds' is distinct from p_finding->'assertionIds'
    or p_candidate->'evidenceIds' is distinct from p_finding->'evidenceIds'
    or p_candidate#>>'{sourceObject,externalType}' is distinct from 'file'
    or p_candidate#>>'{sourceObject,externalId}' not like '%.sql'
    or v_observation_id is null or v_observation_id !~ '^discovery-finding:lineage-observation:[a-f0-9]{64}$'
    or (p_observation - 'findingId' - 'assertionIds' - 'evidenceIds') is distinct from
       (p_finding - 'findingId' - 'assertionIds' - 'evidenceIds') then
    raise exception using errcode = '23514', message = 'LINEAGE_OBSERVATION_CONTEXT_MISMATCH';
  end if;
  select array_agg(distinct value order by value) into v_assertions from jsonb_array_elements_text(p_candidate->'assertionIds');
  select array_agg(distinct value order by value) into v_evidence from jsonb_array_elements_text(p_candidate->'evidenceIds');
  if coalesce(cardinality(v_assertions), 0) = 0 or coalesce(cardinality(v_evidence), 0) = 0
    or p_observation->'assertionIds' is distinct from to_jsonb(v_assertions)
    or p_observation->'evidenceIds' is distinct from to_jsonb(v_evidence) then
    raise exception using errcode = '23514', message = 'LINEAGE_OBSERVATION_SUPPORT_MISSING';
  end if;
  perform 1 from gov_repo.acquisition_runs ar where ar.organisation_id = p_organisation_id
    and ar.run_id = p_acquisition_run_id and ar.source_connection_id = p_candidate#>>'{sourceObject,connectionId}';
  if not found then raise exception using errcode = '23503', message = 'LINEAGE_OBSERVATION_RUN_MISMATCH'; end if;
  -- Serialize initial candidate selection and observation attachment for this
  -- tenant/semantic candidate. No unlocked application check-then-write.
  perform pg_advisory_xact_lock(hashtextextended(p_organisation_id::text || ':' || v_candidate_id, 0));
  select * into v_origin from gov_repo.discovery_candidates dc
    where dc.organisation_id = p_organisation_id and dc.candidate_id = v_candidate_id;
  if found and (v_origin.candidate_kind <> 'RELATIONSHIP' or v_origin.relationship_type_code <> 'DERIVED_FROM'
    or v_origin.finding_id is distinct from p_candidate->>'findingId'
    or v_origin.envelope->'sourceObject' is distinct from p_candidate->'sourceObject') then
    raise exception using errcode = '23514', message = 'LINEAGE_OBSERVATION_SEMANTIC_CONFLICT';
  end if;
  foreach v_side in array array['sourceEndpoint', 'targetEndpoint'] loop
    if p_candidate->v_side->>'referenceKind' is distinct from 'CANDIDATE'
      or p_candidate->v_side->>'candidateKind' is distinct from 'DATA_ELEMENT' then
      raise exception using errcode = '23514', message = 'LINEAGE_OBSERVATION_ENDPOINT_KIND';
    end if;
    select * into v_endpoint from gov_repo.discovery_candidates dc where dc.organisation_id = p_organisation_id
      and dc.candidate_id = p_candidate->v_side->>'candidateId' and dc.candidate_kind = 'DATA_ELEMENT';
    if not found or v_endpoint.source_connection_id is distinct from p_candidate#>>'{sourceObject,connectionId}' then
      raise exception using errcode = '23503', message = 'LINEAGE_OBSERVATION_ENDPOINT_MISSING';
    end if;
    if not (p_candidate->'assertionIds' @> v_endpoint.envelope->'assertionIds')
      or not (p_candidate->'evidenceIds' @> v_endpoint.envelope->'evidenceIds') then
      raise exception using errcode = '23514', message = 'LINEAGE_OBSERVATION_ENDPOINT_SUPPORT_MISSING';
    end if;
    if v_origin.candidate_id is not null then
      select * into v_original_endpoint from gov_repo.discovery_candidates dc where dc.organisation_id = p_organisation_id
        and dc.candidate_id = v_origin.envelope->v_side->>'candidateId' and dc.candidate_kind = 'DATA_ELEMENT';
      if not found or gov_repo.frame_identity(array[v_endpoint.source_connection_id, v_endpoint.source_external_type,
          v_endpoint.source_external_id, gov_repo.normalized_object_identity(p_organisation_id, v_endpoint.envelope)])
        is distinct from gov_repo.frame_identity(array[v_original_endpoint.source_connection_id, v_original_endpoint.source_external_type,
          v_original_endpoint.source_external_id, gov_repo.normalized_object_identity(p_organisation_id, v_original_endpoint.envelope)]) then
        raise exception using errcode = '23514', message = 'LINEAGE_OBSERVATION_SEMANTIC_CONFLICT';
      end if;
    else
      perform gov_repo.normalized_object_identity(p_organisation_id, v_endpoint.envelope);
    end if;
  end loop;
  -- All support is durable under this tenant, including a direct SQL assertion
  -- in the transformation's source scope. No borrowed endpoint-only support.
  if exists (select 1 from unnest(v_assertions) a(id) where not exists
      (select 1 from gov_repo.source_assertions sa where sa.organisation_id = p_organisation_id and sa.assertion_id = a.id))
    or exists (select 1 from unnest(v_evidence) e(id) where not exists
      (select 1 from gov_repo.discovery_evidence de where de.organisation_id = p_organisation_id and de.evidence_id = e.id))
    or not exists (select 1 from gov_repo.source_assertions sa where sa.organisation_id = p_organisation_id
      and sa.assertion_id = any(v_assertions) and sa.method_code = 'sql-insert-select-column-lineage'
      and sa.method_version = '1.0.0' and sa.trust_state = 'DECLARED'
      and sa.source_connection_id = p_candidate#>>'{sourceObject,connectionId}'
      and sa.source_external_type = 'file' and sa.source_external_id = p_candidate#>>'{sourceObject,externalId}'
      and exists (select 1 from gov_repo.source_assertion_evidence se where se.organisation_id = p_organisation_id
        and se.assertion_id = sa.assertion_id and se.evidence_id = any(v_evidence))) then
    raise exception using errcode = '23503', message = 'LINEAGE_OBSERVATION_SUPPORT_MISSING';
  end if;

  if v_origin.candidate_id is null then
    perform gov_repo.record_discovery_finding(p_finding->>'findingId', p_organisation_id, 'CANDIDATE', 'RELATIONSHIP',
      p_candidate#>>'{sourceObject,connectionId}', p_candidate#>>'{sourceObject,externalType}', p_candidate#>>'{sourceObject,externalId}',
      (p_finding->>'confidence')::double precision, 'UNREVIEWED', true, false, (p_finding->>'detectedAt')::timestamptz,
      p_acquisition_run_id, v_assertions, v_evidence, '1.0', p_finding, p_finding_hash);
    -- Existing finding replay is first-insert-wins; require the actual origin
    -- support to agree before it can anchor a new immutable candidate.
    select * into strict v_origin_finding from gov_repo.discovery_findings df
      where df.organisation_id = p_organisation_id and df.finding_id = p_finding->>'findingId';
    if (v_origin_finding.envelope - 'detectedAt') is distinct from (p_finding - 'detectedAt') then
      raise exception using errcode = '23514', message = 'LINEAGE_ORIGIN_FINDING_CONFLICT';
    end if;
    perform gov_repo.record_discovery_candidate(v_candidate_id, p_organisation_id, 'RELATIONSHIP', 'RELATIONSHIP',
      p_candidate->>'findingId', p_candidate#>>'{sourceObject,connectionId}', p_candidate#>>'{sourceObject,externalType}',
      p_candidate#>>'{sourceObject,externalId}', (p_candidate->>'confidence')::double precision, true, null, 'DERIVED_FROM',
      p_candidate->'sourceEndpoint', p_candidate->'targetEndpoint', p_acquisition_run_id, v_assertions, v_evidence,
      '1.0', p_candidate, p_candidate_hash);
    select * into strict v_origin from gov_repo.discovery_candidates dc
      where dc.organisation_id = p_organisation_id and dc.candidate_id = v_candidate_id;
  end if;
  perform gov_repo.record_discovery_finding(v_observation_id, p_organisation_id, 'CANDIDATE', 'RELATIONSHIP',
    p_candidate#>>'{sourceObject,connectionId}', p_candidate#>>'{sourceObject,externalType}', p_candidate#>>'{sourceObject,externalId}',
    (p_observation->>'confidence')::double precision, 'UNREVIEWED', true, false, (p_observation->>'detectedAt')::timestamptz,
    p_acquisition_run_id, v_assertions, v_evidence, '1.0', p_observation, p_observation_hash);
  select * into strict v_existing_observation from gov_repo.discovery_findings df
    where df.organisation_id = p_organisation_id and df.finding_id = v_observation_id;
  if (v_existing_observation.envelope - 'detectedAt') is distinct from (p_observation - 'detectedAt') then
    raise exception using errcode = '23514', message = 'LINEAGE_OBSERVATION_CONFLICT';
  end if;
  -- RULE-protected immutable tables use insert/unique-violation handling,
  -- matching existing discovery persistence (not ON CONFLICT).
  begin
    insert into gov_repo.lineage_candidate_observations values (p_organisation_id, v_candidate_id, v_observation_id,
      p_candidate#>>'{sourceEndpoint,candidateId}', p_candidate#>>'{targetEndpoint,candidateId}');
  exception when unique_violation then
    perform 1 from gov_repo.lineage_candidate_observations o where o.organisation_id = p_organisation_id
      and o.candidate_id = v_candidate_id and o.observation_finding_id = v_observation_id
      and o.source_candidate_id = p_candidate#>>'{sourceEndpoint,candidateId}'
      and o.target_candidate_id = p_candidate#>>'{targetEndpoint,candidateId}';
    if not found then raise exception using errcode = '23514', message = 'LINEAGE_OBSERVATION_CONFLICT'; end if;
  end;
  select * into strict v_origin_finding from gov_repo.discovery_findings df
    where df.organisation_id = p_organisation_id and df.finding_id = v_origin.finding_id;
  return query select v_origin.envelope, v_origin.envelope_hash, v_origin_finding.envelope, v_origin_finding.envelope_hash;
end;
$$;
revoke all on function gov_repo.record_lineage_observation from public, anon, authenticated;
grant execute on function gov_repo.record_lineage_observation to service_role;
commit;
