-- Proposed only. No hosted application authorized by this file.
-- Additive correction; canonical identities, evidence, trust and prior migrations remain unchanged.
BEGIN;

SET LOCAL application_name='govia-technical-profile-v1';
SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('govia:technical-profile-v1',0));
DO $deployment_guard$ BEGIN
 IF current_database()<>'postgres' OR (SELECT org_code FROM gov_repo.organisations
   WHERE organisation_id='082ef694-e016-4893-908c-1eef373f53af') IS DISTINCT FROM 'GOVIA_DEMO' THEN
   RAISE EXCEPTION 'PROFILE_DEPLOYMENT_TARGET_MISMATCH'; END IF;
 IF EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='20261109191942') THEN
   RAISE EXCEPTION 'PROFILE_MIGRATION_ALREADY_REGISTERED'; END IF;
END $deployment_guard$;
DO $preflight$
BEGIN
 IF current_user<>'postgres' THEN RAISE EXCEPTION 'PROFILE_OWNER_REQUIRED' USING ERRCODE='42501'; END IF;
 IF to_regprocedure('gov_repo.require_governed_write_eligibility_v1(uuid,uuid,bigint,bigint,timestamptz)') IS NULL
  OR to_regclass('gov_repo.canonical_normalized_object_mappings') IS NULL
  OR to_regprocedure('gov_repo.materialize_agent_version_technical_profile_governed_v1(uuid,uuid,bigint,bigint,timestamptz,text,text,timestamptz)') IS NOT NULL THEN
  RAISE EXCEPTION 'PROFILE_CORRECTION_DEPENDENCY_OR_ALREADY_APPLIED';
 END IF;
 IF (SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') FROM pg_proc
   WHERE oid=to_regprocedure('gov_repo.materialize_agent_version_technical_profile(uuid,text,text,timestamptz)'))
   IS DISTINCT FROM '8754262bf27e47c7b5e502d8f2f9bcd1e18aeb482b3930b30e9f7d8c6759ecdd' THEN
   RAISE EXCEPTION 'PROFILE_ORIGINAL_FUNCTION_DRIFT';
 END IF;
END $preflight$;
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
  v_mapped boolean;
  v_mapping gov_repo.canonical_normalized_object_mappings%rowtype;
  v_count integer;
  v_parent_ids text[];
  v_authorizing_decision text;
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
  if p_occurred_at is null or not isfinite(p_occurred_at) or p_occurred_at>clock_timestamp() then
    raise exception 'PROFILE_TIME_INVALID' using errcode='22023';
  end if;
  -- (1) organisation scope + (2)(3) canonical target exists and is AGENT_VERSION.
  select * into v_object
  from gov_repo.canonical_objects as co
  where co.organisation_id = p_organisation_id and co.canonical_object_id = p_canonical_object_id FOR UPDATE;
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

  -- The exact candidate is locked before testing append-only mappings. FK
  -- inserts referencing it cannot race the ambiguity check.
  select * into v_candidate from gov_repo.discovery_candidates c
  where c.organisation_id=p_organisation_id and c.candidate_id=v_proposal.agent_version_candidate_id FOR UPDATE;
  if not found or v_candidate.candidate_kind<>'AGENT_VERSION'
     or v_candidate.envelope->>'candidateId' is distinct from v_candidate.candidate_id
     or v_candidate.envelope->>'candidateKind' is distinct from 'AGENT_VERSION'
     or v_candidate.envelope#>>'{proposedIdentity,agent,candidateKind}' is distinct from 'AGENT'
     or v_candidate.envelope#>>'{sourceObject,connectionId}' is distinct from v_candidate.source_connection_id
     or v_candidate.envelope#>>'{sourceObject,externalType}' is distinct from v_candidate.source_external_type
     or v_candidate.envelope#>>'{sourceObject,externalId}' is distinct from v_candidate.source_external_id then
    raise exception 'PROFILE_CANDIDATE_INVALID' using errcode='22023';
  end if;

  -- Existing certification authorizes only support already in its exact human
  -- reconciliation chain, never a later or unrelated proposal using the same path.
  select min(d.decision_id),count(distinct d.decision_id) into v_authorizing_decision,v_count
  from gov_repo.reconciliation_decisions d
  join gov_repo.reconciliation_invocations i on i.organisation_id=d.organisation_id and i.reconciliation_decision_id=d.decision_id
  join gov_repo.review_subjects s on s.organisation_id=i.organisation_id and s.review_subject_id=i.review_subject_id
  join gov_repo.review_audit_events a on a.organisation_id=s.organisation_id and a.event_id=s.last_transition_id
  join gov_repo.materialization_operations m on m.organisation_id=d.organisation_id and m.reconciliation_decision_id=d.decision_id
  where d.organisation_id=p_organisation_id and d.family='OBJECT' and d.authority_kind='HUMAN'
    and d.subject_candidate_id=v_candidate.candidate_id and d.canonical_object_id=p_canonical_object_id
    and d.canonical_object_kind='AGENT_VERSION' and d.outcome in ('CREATE_NEW','MATCH_EXISTING')
    and i.actor_kind='HUMAN' and i.actor_reference=d.authority_reference
    and s.finding_id=v_candidate.finding_id and s.candidate_kind='AGENT_VERSION' and s.state='CERTIFIED'
    and a.review_subject_id=s.review_subject_id and a.new_state='CERTIFIED' and a.actor_kind='HUMAN'
    and v_proposal.created_at<=a.occurred_at and a.occurred_at<=d.decided_at and d.decided_at<=p_occurred_at
    and m.status='APPLIED' and m.resulting_canonical_object_id=p_canonical_object_id
    and not exists(select 1 from gov_repo.agent_version_technical_profile_proposal_field_assertions f
      where f.organisation_id=p_organisation_id and f.proposal_id=p_proposal_id and not exists(
        select 1 from gov_repo.reconciliation_decision_assertions x where x.organisation_id=f.organisation_id
          and x.decision_id=d.decision_id and x.assertion_id=f.assertion_id))
    and not exists(select 1 from gov_repo.agent_version_technical_profile_proposal_field_evidence f
      where f.organisation_id=p_organisation_id and f.proposal_id=p_proposal_id and not exists(
        select 1 from gov_repo.reconciliation_decision_evidence x where x.organisation_id=f.organisation_id
          and x.decision_id=d.decision_id and x.evidence_id=f.evidence_id))
  ;
  if v_authorizing_decision is null or v_count<>1 then
    raise exception 'PROFILE_AUTHORIZATION_REQUIRED' using errcode='42501';
  end if;

  -- Resolve the candidate's declared AGENT parent by exact typed source/candidate
  -- reference; never by display name, path suffix or inferred formal relationship.
  select array_agg(distinct parent_id) into v_parent_ids from (
    select n.canonical_object_id as parent_id from gov_repo.canonical_normalized_object_mappings n
    join gov_repo.canonical_objects o on o.organisation_id=n.organisation_id and o.canonical_object_id=n.canonical_object_id and o.kind='AGENT'
    where n.organisation_id=p_organisation_id and n.canonical_object_kind='AGENT' and n.valid_from<=p_occurred_at
      and ((v_candidate.envelope#>>'{proposedIdentity,agent,referenceKind}'='CANDIDATE' and n.candidate_id=v_candidate.envelope#>>'{proposedIdentity,agent,candidateId}')
        or (v_candidate.envelope#>>'{proposedIdentity,agent,referenceKind}'='SOURCE_OBJECT'
          and n.source_connection_id=v_candidate.envelope#>>'{proposedIdentity,agent,sourceObject,connectionId}'
          and n.source_external_type=v_candidate.envelope#>>'{proposedIdentity,agent,sourceObject,externalType}'
          and n.source_external_id=v_candidate.envelope#>>'{proposedIdentity,agent,sourceObject,externalId}'))
    union all
    select c.canonical_object_id from gov_repo.canonical_object_source_mappings c
    join gov_repo.canonical_objects o on o.organisation_id=c.organisation_id and o.canonical_object_id=c.canonical_object_id and o.kind='AGENT'
    join gov_repo.reconciliation_decisions parent_decision on parent_decision.organisation_id=c.organisation_id
      and parent_decision.decision_id=c.created_by_decision_id and parent_decision.canonical_object_id=c.canonical_object_id
      and parent_decision.canonical_object_kind='AGENT' and parent_decision.outcome in ('CREATE_NEW','MATCH_EXISTING')
    where c.organisation_id=p_organisation_id and c.canonical_object_kind='AGENT' and c.valid_from<=p_occurred_at and c.valid_to is null
      and ((v_candidate.envelope#>>'{proposedIdentity,agent,referenceKind}'='SOURCE_OBJECT'
      and c.source_connection_id=v_candidate.envelope#>>'{proposedIdentity,agent,sourceObject,connectionId}'
      and c.source_external_type=v_candidate.envelope#>>'{proposedIdentity,agent,sourceObject,externalType}'
      and c.source_external_id=v_candidate.envelope#>>'{proposedIdentity,agent,sourceObject,externalId}')
      or (v_candidate.envelope#>>'{proposedIdentity,agent,referenceKind}'='CANDIDATE'
        and parent_decision.subject_candidate_id=v_candidate.envelope#>>'{proposedIdentity,agent,candidateId}'))
  ) parents;
  if cardinality(v_parent_ids) is distinct from 1 then
    raise exception 'PROFILE_PARENT_MISSING_OR_AMBIGUOUS' using errcode='22023';
  end if;
  select count(*) into v_count from gov_repo.canonical_normalized_object_mappings n
  where n.organisation_id=p_organisation_id and n.candidate_id=v_candidate.candidate_id;
  if v_count>0 then
    -- Presence of a normalized mapping forbids falling back around a mismatch.
    if v_count<>1 then raise exception 'PROFILE_MAPPING_AMBIGUOUS' using errcode='22023'; end if;
    select * into v_mapping from gov_repo.canonical_normalized_object_mappings n
    where n.organisation_id=p_organisation_id and n.candidate_id=v_candidate.candidate_id;
    if v_mapping.canonical_object_id is distinct from p_canonical_object_id
      or v_mapping.canonical_object_kind<>'AGENT_VERSION'
      or v_mapping.normalized_object_identity is distinct from v_candidate.candidate_id
      or v_mapping.parent_canonical_object_id is distinct from v_parent_ids[1]
      or v_mapping.source_connection_id is distinct from v_candidate.source_connection_id
      or v_mapping.source_external_type is distinct from v_candidate.source_external_type
      or v_mapping.source_external_id is distinct from v_candidate.source_external_id
      or v_mapping.valid_from>p_occurred_at
      or v_mapping.created_by_decision_id is distinct from v_authorizing_decision then
      raise exception 'PROPOSAL_NOT_MAPPED_TO_TARGET' using errcode='22023';
    end if;
  else
    -- Historical mapping has no candidate_id: prove it through its authoring
    -- human decision for THIS candidate and THIS exact canonical target.
    select count(*) into v_count from gov_repo.canonical_object_source_mappings c
    where c.organisation_id=p_organisation_id and c.source_connection_id=v_candidate.source_connection_id
      and c.source_external_type=v_candidate.source_external_type and c.source_external_id=v_candidate.source_external_id
      and c.canonical_object_kind='AGENT_VERSION' and c.valid_to is null;
    select count(*)=1 into v_mapped from gov_repo.canonical_object_source_mappings c
    where c.organisation_id=p_organisation_id and c.canonical_object_id=p_canonical_object_id
      and c.canonical_object_kind='AGENT_VERSION' and c.source_connection_id=v_candidate.source_connection_id
      and c.source_external_type=v_candidate.source_external_type and c.source_external_id=v_candidate.source_external_id
      and c.valid_from<=p_occurred_at and c.valid_to is null and c.created_by_decision_id=v_authorizing_decision;
    if v_count<>1 or not v_mapped then raise exception 'PROPOSAL_NOT_MAPPED_TO_TARGET' using errcode='22023'; end if;
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
  -- First materialization must create the referenced profile BEFORE field support.
  -- The object row lock serializes concurrent applications; all writes remain atomic.
  if v_existing_profile.canonical_object_id is null then
    insert into gov_repo.agent_version_technical_profiles(
      organisation_id,canonical_object_id,source_proposal_id,
      behavior_fingerprint_algorithm,behavior_fingerprint_schema_version,behavior_fingerprint_value,
      build_reference,runtime_framework_reference,entrypoint_reference,configuration_reference,updated_at)
    values(p_organisation_id,p_canonical_object_id,p_proposal_id,
      v_proposal.behavior_fingerprint_algorithm,v_proposal.behavior_fingerprint_schema_version,v_proposal.behavior_fingerprint_value,
      v_final_build_reference,v_final_runtime_framework_reference,v_final_entrypoint_reference,v_final_configuration_reference,p_occurred_at);
  end if;

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
  on conflict on constraint agent_version_technical_profiles_pkey do update set
    build_reference = excluded.build_reference,
    runtime_framework_reference = excluded.runtime_framework_reference,
    entrypoint_reference = excluded.entrypoint_reference,
    configuration_reference = excluded.configuration_reference,
    revision = case when v_existing_profile.canonical_object_id is null then gov_repo.agent_version_technical_profiles.revision when v_changed then gov_repo.agent_version_technical_profiles.revision + 1 else gov_repo.agent_version_technical_profiles.revision end,
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

-- Same principal-bound M16 guard as canonical identity materialization.
CREATE FUNCTION gov_repo.materialize_agent_version_technical_profile_governed_v1(
 p_verified_organisation_id uuid,p_verified_actor_user_id uuid,p_verified_session_iat bigint,
 p_verified_session_exp bigint,p_verified_credential_epoch timestamptz,
 p_canonical_object_id text,p_proposal_id text,p_occurred_at timestamptz
) RETURNS TABLE(replay boolean,status text,canonical_object_id text)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,pg_temp SET lock_timeout='5s'
AS $wrapper$
BEGIN
 PERFORM gov_repo.require_governed_write_eligibility_v1(p_verified_organisation_id,p_verified_actor_user_id,
   p_verified_session_iat,p_verified_session_exp,p_verified_credential_epoch);
 RETURN QUERY SELECT * FROM gov_repo.materialize_agent_version_technical_profile(
   p_verified_organisation_id,p_canonical_object_id,p_proposal_id,p_occurred_at);
END;
$wrapper$;
ALTER FUNCTION gov_repo.materialize_agent_version_technical_profile_governed_v1(uuid,uuid,bigint,bigint,timestamptz,text,text,timestamptz) OWNER TO postgres;
REVOKE ALL ON FUNCTION gov_repo.materialize_agent_version_technical_profile(uuid,text,text,timestamptz) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION gov_repo.materialize_agent_version_technical_profile_governed_v1(uuid,uuid,bigint,bigint,timestamptz,text,text,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION gov_repo.materialize_agent_version_technical_profile_governed_v1(uuid,uuid,bigint,bigint,timestamptz,text,text,timestamptz) TO service_role;
-- These legacy invoker stores no longer need direct application DML.
REVOKE INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN ON TABLE
 gov_repo.agent_version_technical_profiles,gov_repo.agent_version_technical_profile_field_assertions,
 gov_repo.agent_version_technical_profile_field_evidence,gov_repo.agent_version_technical_profile_materializations
 FROM PUBLIC,anon,authenticated,service_role;
DO $postflight$
BEGIN
 IF has_function_privilege('service_role','gov_repo.materialize_agent_version_technical_profile(uuid,text,text,timestamptz)','EXECUTE')
   OR has_function_privilege('anon','gov_repo.materialize_agent_version_technical_profile_governed_v1(uuid,uuid,bigint,bigint,timestamptz,text,text,timestamptz)','EXECUTE')
   OR has_function_privilege('authenticated','gov_repo.materialize_agent_version_technical_profile_governed_v1(uuid,uuid,bigint,bigint,timestamptz,text,text,timestamptz)','EXECUTE') THEN
   RAISE EXCEPTION 'PROFILE_RPC_ACL_INVALID';
 END IF;
 IF EXISTS(SELECT 1 FROM pg_proc p,LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
    WHERE p.oid='gov_repo.materialize_agent_version_technical_profile_governed_v1(uuid,uuid,bigint,bigint,timestamptz,text,text,timestamptz)'::regprocedure
    AND (a.grantee NOT IN ('postgres'::regrole,'service_role'::regrole) OR a.privilege_type<>'EXECUTE' OR a.is_grantable))
 OR EXISTS(SELECT 1 FROM pg_class c WHERE c.relnamespace='gov_repo'::regnamespace
    AND c.relname IN ('agent_version_technical_profiles','agent_version_technical_profile_field_assertions','agent_version_technical_profile_field_evidence','agent_version_technical_profile_materializations')
    AND has_table_privilege('service_role',c.oid,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN')) THEN
   RAISE EXCEPTION 'PROFILE_CLOSED_WRITE_SURFACE_INVALID';
 END IF;
END $postflight$;
NOTIFY pgrst, 'reload schema';
-- Exact proposed migration and metadata committed atomically with DDL.
INSERT INTO supabase_migrations.schema_migrations(version,name,statements)
VALUES('20261109191942','agent_version_technical_profile_governed_mapping_v1',ARRAY[$govia_profile_9c22c983eb1cd9cd4832$-- Proposed only. No hosted application authorized by this file.
-- Additive correction; canonical identities, evidence, trust and prior migrations remain unchanged.
BEGIN;
DO $preflight$
BEGIN
 IF current_user<>'postgres' THEN RAISE EXCEPTION 'PROFILE_OWNER_REQUIRED' USING ERRCODE='42501'; END IF;
 IF to_regprocedure('gov_repo.require_governed_write_eligibility_v1(uuid,uuid,bigint,bigint,timestamptz)') IS NULL
  OR to_regclass('gov_repo.canonical_normalized_object_mappings') IS NULL
  OR to_regprocedure('gov_repo.materialize_agent_version_technical_profile_governed_v1(uuid,uuid,bigint,bigint,timestamptz,text,text,timestamptz)') IS NOT NULL THEN
  RAISE EXCEPTION 'PROFILE_CORRECTION_DEPENDENCY_OR_ALREADY_APPLIED';
 END IF;
 IF (SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') FROM pg_proc
   WHERE oid=to_regprocedure('gov_repo.materialize_agent_version_technical_profile(uuid,text,text,timestamptz)'))
   IS DISTINCT FROM '8754262bf27e47c7b5e502d8f2f9bcd1e18aeb482b3930b30e9f7d8c6759ecdd' THEN
   RAISE EXCEPTION 'PROFILE_ORIGINAL_FUNCTION_DRIFT';
 END IF;
END $preflight$;
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
  v_mapped boolean;
  v_mapping gov_repo.canonical_normalized_object_mappings%rowtype;
  v_count integer;
  v_parent_ids text[];
  v_authorizing_decision text;
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
  if p_occurred_at is null or not isfinite(p_occurred_at) or p_occurred_at>clock_timestamp() then
    raise exception 'PROFILE_TIME_INVALID' using errcode='22023';
  end if;
  -- (1) organisation scope + (2)(3) canonical target exists and is AGENT_VERSION.
  select * into v_object
  from gov_repo.canonical_objects as co
  where co.organisation_id = p_organisation_id and co.canonical_object_id = p_canonical_object_id FOR UPDATE;
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

  -- The exact candidate is locked before testing append-only mappings. FK
  -- inserts referencing it cannot race the ambiguity check.
  select * into v_candidate from gov_repo.discovery_candidates c
  where c.organisation_id=p_organisation_id and c.candidate_id=v_proposal.agent_version_candidate_id FOR UPDATE;
  if not found or v_candidate.candidate_kind<>'AGENT_VERSION'
     or v_candidate.envelope->>'candidateId' is distinct from v_candidate.candidate_id
     or v_candidate.envelope->>'candidateKind' is distinct from 'AGENT_VERSION'
     or v_candidate.envelope#>>'{proposedIdentity,agent,candidateKind}' is distinct from 'AGENT'
     or v_candidate.envelope#>>'{sourceObject,connectionId}' is distinct from v_candidate.source_connection_id
     or v_candidate.envelope#>>'{sourceObject,externalType}' is distinct from v_candidate.source_external_type
     or v_candidate.envelope#>>'{sourceObject,externalId}' is distinct from v_candidate.source_external_id then
    raise exception 'PROFILE_CANDIDATE_INVALID' using errcode='22023';
  end if;

  -- Existing certification authorizes only support already in its exact human
  -- reconciliation chain, never a later or unrelated proposal using the same path.
  select min(d.decision_id),count(distinct d.decision_id) into v_authorizing_decision,v_count
  from gov_repo.reconciliation_decisions d
  join gov_repo.reconciliation_invocations i on i.organisation_id=d.organisation_id and i.reconciliation_decision_id=d.decision_id
  join gov_repo.review_subjects s on s.organisation_id=i.organisation_id and s.review_subject_id=i.review_subject_id
  join gov_repo.review_audit_events a on a.organisation_id=s.organisation_id and a.event_id=s.last_transition_id
  join gov_repo.materialization_operations m on m.organisation_id=d.organisation_id and m.reconciliation_decision_id=d.decision_id
  where d.organisation_id=p_organisation_id and d.family='OBJECT' and d.authority_kind='HUMAN'
    and d.subject_candidate_id=v_candidate.candidate_id and d.canonical_object_id=p_canonical_object_id
    and d.canonical_object_kind='AGENT_VERSION' and d.outcome in ('CREATE_NEW','MATCH_EXISTING')
    and i.actor_kind='HUMAN' and i.actor_reference=d.authority_reference
    and s.finding_id=v_candidate.finding_id and s.candidate_kind='AGENT_VERSION' and s.state='CERTIFIED'
    and a.review_subject_id=s.review_subject_id and a.new_state='CERTIFIED' and a.actor_kind='HUMAN'
    and v_proposal.created_at<=a.occurred_at and a.occurred_at<=d.decided_at and d.decided_at<=p_occurred_at
    and m.status='APPLIED' and m.resulting_canonical_object_id=p_canonical_object_id
    and not exists(select 1 from gov_repo.agent_version_technical_profile_proposal_field_assertions f
      where f.organisation_id=p_organisation_id and f.proposal_id=p_proposal_id and not exists(
        select 1 from gov_repo.reconciliation_decision_assertions x where x.organisation_id=f.organisation_id
          and x.decision_id=d.decision_id and x.assertion_id=f.assertion_id))
    and not exists(select 1 from gov_repo.agent_version_technical_profile_proposal_field_evidence f
      where f.organisation_id=p_organisation_id and f.proposal_id=p_proposal_id and not exists(
        select 1 from gov_repo.reconciliation_decision_evidence x where x.organisation_id=f.organisation_id
          and x.decision_id=d.decision_id and x.evidence_id=f.evidence_id))
  ;
  if v_authorizing_decision is null or v_count<>1 then
    raise exception 'PROFILE_AUTHORIZATION_REQUIRED' using errcode='42501';
  end if;

  -- Resolve the candidate's declared AGENT parent by exact typed source/candidate
  -- reference; never by display name, path suffix or inferred formal relationship.
  select array_agg(distinct parent_id) into v_parent_ids from (
    select n.canonical_object_id as parent_id from gov_repo.canonical_normalized_object_mappings n
    join gov_repo.canonical_objects o on o.organisation_id=n.organisation_id and o.canonical_object_id=n.canonical_object_id and o.kind='AGENT'
    where n.organisation_id=p_organisation_id and n.canonical_object_kind='AGENT' and n.valid_from<=p_occurred_at
      and ((v_candidate.envelope#>>'{proposedIdentity,agent,referenceKind}'='CANDIDATE' and n.candidate_id=v_candidate.envelope#>>'{proposedIdentity,agent,candidateId}')
        or (v_candidate.envelope#>>'{proposedIdentity,agent,referenceKind}'='SOURCE_OBJECT'
          and n.source_connection_id=v_candidate.envelope#>>'{proposedIdentity,agent,sourceObject,connectionId}'
          and n.source_external_type=v_candidate.envelope#>>'{proposedIdentity,agent,sourceObject,externalType}'
          and n.source_external_id=v_candidate.envelope#>>'{proposedIdentity,agent,sourceObject,externalId}'))
    union all
    select c.canonical_object_id from gov_repo.canonical_object_source_mappings c
    join gov_repo.canonical_objects o on o.organisation_id=c.organisation_id and o.canonical_object_id=c.canonical_object_id and o.kind='AGENT'
    join gov_repo.reconciliation_decisions parent_decision on parent_decision.organisation_id=c.organisation_id
      and parent_decision.decision_id=c.created_by_decision_id and parent_decision.canonical_object_id=c.canonical_object_id
      and parent_decision.canonical_object_kind='AGENT' and parent_decision.outcome in ('CREATE_NEW','MATCH_EXISTING')
    where c.organisation_id=p_organisation_id and c.canonical_object_kind='AGENT' and c.valid_from<=p_occurred_at and c.valid_to is null
      and ((v_candidate.envelope#>>'{proposedIdentity,agent,referenceKind}'='SOURCE_OBJECT'
      and c.source_connection_id=v_candidate.envelope#>>'{proposedIdentity,agent,sourceObject,connectionId}'
      and c.source_external_type=v_candidate.envelope#>>'{proposedIdentity,agent,sourceObject,externalType}'
      and c.source_external_id=v_candidate.envelope#>>'{proposedIdentity,agent,sourceObject,externalId}')
      or (v_candidate.envelope#>>'{proposedIdentity,agent,referenceKind}'='CANDIDATE'
        and parent_decision.subject_candidate_id=v_candidate.envelope#>>'{proposedIdentity,agent,candidateId}'))
  ) parents;
  if cardinality(v_parent_ids) is distinct from 1 then
    raise exception 'PROFILE_PARENT_MISSING_OR_AMBIGUOUS' using errcode='22023';
  end if;
  select count(*) into v_count from gov_repo.canonical_normalized_object_mappings n
  where n.organisation_id=p_organisation_id and n.candidate_id=v_candidate.candidate_id;
  if v_count>0 then
    -- Presence of a normalized mapping forbids falling back around a mismatch.
    if v_count<>1 then raise exception 'PROFILE_MAPPING_AMBIGUOUS' using errcode='22023'; end if;
    select * into v_mapping from gov_repo.canonical_normalized_object_mappings n
    where n.organisation_id=p_organisation_id and n.candidate_id=v_candidate.candidate_id;
    if v_mapping.canonical_object_id is distinct from p_canonical_object_id
      or v_mapping.canonical_object_kind<>'AGENT_VERSION'
      or v_mapping.normalized_object_identity is distinct from v_candidate.candidate_id
      or v_mapping.parent_canonical_object_id is distinct from v_parent_ids[1]
      or v_mapping.source_connection_id is distinct from v_candidate.source_connection_id
      or v_mapping.source_external_type is distinct from v_candidate.source_external_type
      or v_mapping.source_external_id is distinct from v_candidate.source_external_id
      or v_mapping.valid_from>p_occurred_at
      or v_mapping.created_by_decision_id is distinct from v_authorizing_decision then
      raise exception 'PROPOSAL_NOT_MAPPED_TO_TARGET' using errcode='22023';
    end if;
  else
    -- Historical mapping has no candidate_id: prove it through its authoring
    -- human decision for THIS candidate and THIS exact canonical target.
    select count(*) into v_count from gov_repo.canonical_object_source_mappings c
    where c.organisation_id=p_organisation_id and c.source_connection_id=v_candidate.source_connection_id
      and c.source_external_type=v_candidate.source_external_type and c.source_external_id=v_candidate.source_external_id
      and c.canonical_object_kind='AGENT_VERSION' and c.valid_to is null;
    select count(*)=1 into v_mapped from gov_repo.canonical_object_source_mappings c
    where c.organisation_id=p_organisation_id and c.canonical_object_id=p_canonical_object_id
      and c.canonical_object_kind='AGENT_VERSION' and c.source_connection_id=v_candidate.source_connection_id
      and c.source_external_type=v_candidate.source_external_type and c.source_external_id=v_candidate.source_external_id
      and c.valid_from<=p_occurred_at and c.valid_to is null and c.created_by_decision_id=v_authorizing_decision;
    if v_count<>1 or not v_mapped then raise exception 'PROPOSAL_NOT_MAPPED_TO_TARGET' using errcode='22023'; end if;
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
  -- First materialization must create the referenced profile BEFORE field support.
  -- The object row lock serializes concurrent applications; all writes remain atomic.
  if v_existing_profile.canonical_object_id is null then
    insert into gov_repo.agent_version_technical_profiles(
      organisation_id,canonical_object_id,source_proposal_id,
      behavior_fingerprint_algorithm,behavior_fingerprint_schema_version,behavior_fingerprint_value,
      build_reference,runtime_framework_reference,entrypoint_reference,configuration_reference,updated_at)
    values(p_organisation_id,p_canonical_object_id,p_proposal_id,
      v_proposal.behavior_fingerprint_algorithm,v_proposal.behavior_fingerprint_schema_version,v_proposal.behavior_fingerprint_value,
      v_final_build_reference,v_final_runtime_framework_reference,v_final_entrypoint_reference,v_final_configuration_reference,p_occurred_at);
  end if;

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
  on conflict on constraint agent_version_technical_profiles_pkey do update set
    build_reference = excluded.build_reference,
    runtime_framework_reference = excluded.runtime_framework_reference,
    entrypoint_reference = excluded.entrypoint_reference,
    configuration_reference = excluded.configuration_reference,
    revision = case when v_existing_profile.canonical_object_id is null then gov_repo.agent_version_technical_profiles.revision when v_changed then gov_repo.agent_version_technical_profiles.revision + 1 else gov_repo.agent_version_technical_profiles.revision end,
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

-- Same principal-bound M16 guard as canonical identity materialization.
CREATE FUNCTION gov_repo.materialize_agent_version_technical_profile_governed_v1(
 p_verified_organisation_id uuid,p_verified_actor_user_id uuid,p_verified_session_iat bigint,
 p_verified_session_exp bigint,p_verified_credential_epoch timestamptz,
 p_canonical_object_id text,p_proposal_id text,p_occurred_at timestamptz
) RETURNS TABLE(replay boolean,status text,canonical_object_id text)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,pg_temp SET lock_timeout='5s'
AS $wrapper$
BEGIN
 PERFORM gov_repo.require_governed_write_eligibility_v1(p_verified_organisation_id,p_verified_actor_user_id,
   p_verified_session_iat,p_verified_session_exp,p_verified_credential_epoch);
 RETURN QUERY SELECT * FROM gov_repo.materialize_agent_version_technical_profile(
   p_verified_organisation_id,p_canonical_object_id,p_proposal_id,p_occurred_at);
END;
$wrapper$;
ALTER FUNCTION gov_repo.materialize_agent_version_technical_profile_governed_v1(uuid,uuid,bigint,bigint,timestamptz,text,text,timestamptz) OWNER TO postgres;
REVOKE ALL ON FUNCTION gov_repo.materialize_agent_version_technical_profile(uuid,text,text,timestamptz) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION gov_repo.materialize_agent_version_technical_profile_governed_v1(uuid,uuid,bigint,bigint,timestamptz,text,text,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION gov_repo.materialize_agent_version_technical_profile_governed_v1(uuid,uuid,bigint,bigint,timestamptz,text,text,timestamptz) TO service_role;
-- These legacy invoker stores no longer need direct application DML.
REVOKE INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN ON TABLE
 gov_repo.agent_version_technical_profiles,gov_repo.agent_version_technical_profile_field_assertions,
 gov_repo.agent_version_technical_profile_field_evidence,gov_repo.agent_version_technical_profile_materializations
 FROM PUBLIC,anon,authenticated,service_role;
DO $postflight$
BEGIN
 IF has_function_privilege('service_role','gov_repo.materialize_agent_version_technical_profile(uuid,text,text,timestamptz)','EXECUTE')
   OR has_function_privilege('anon','gov_repo.materialize_agent_version_technical_profile_governed_v1(uuid,uuid,bigint,bigint,timestamptz,text,text,timestamptz)','EXECUTE')
   OR has_function_privilege('authenticated','gov_repo.materialize_agent_version_technical_profile_governed_v1(uuid,uuid,bigint,bigint,timestamptz,text,text,timestamptz)','EXECUTE') THEN
   RAISE EXCEPTION 'PROFILE_RPC_ACL_INVALID';
 END IF;
 IF EXISTS(SELECT 1 FROM pg_proc p,LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
    WHERE p.oid='gov_repo.materialize_agent_version_technical_profile_governed_v1(uuid,uuid,bigint,bigint,timestamptz,text,text,timestamptz)'::regprocedure
    AND (a.grantee NOT IN ('postgres'::regrole,'service_role'::regrole) OR a.privilege_type<>'EXECUTE' OR a.is_grantable))
 OR EXISTS(SELECT 1 FROM pg_class c WHERE c.relnamespace='gov_repo'::regnamespace
    AND c.relname IN ('agent_version_technical_profiles','agent_version_technical_profile_field_assertions','agent_version_technical_profile_field_evidence','agent_version_technical_profile_materializations')
    AND has_table_privilege('service_role',c.oid,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN')) THEN
   RAISE EXCEPTION 'PROFILE_CLOSED_WRITE_SURFACE_INVALID';
 END IF;
END $postflight$;
NOTIFY pgrst, 'reload schema';
COMMIT;
$govia_profile_9c22c983eb1cd9cd4832$]::text[]);
COMMIT;
