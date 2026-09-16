-- M13: closed direct declaration facts; no runtime/grant authority or new canonical kinds.
begin;
create function gov_repo.execution_field_valid(f text) returns boolean
language sql immutable strict set search_path = pg_catalog as $$
 select f in ('CAPABILITY','PRINCIPAL','DECLARED_CONNECTIVITY','REQUESTED_SCOPE');
$$;
create table gov_repo.execution_source_snapshots (
 organisation_id uuid not null references gov_repo.organisations(organisation_id),
 snapshot_id text not null, source_scope text not null, candidate_id text not null,
 connection_id text not null, source_system_id text not null, provider_code text not null,
 external_type text not null, external_id text not null, declaration_key text not null,
 source_snapshot_id text not null, fingerprint_value text not null check (fingerprint_value ~ '^[a-f0-9]{32}$'),
 fingerprint_schema text not null check (fingerprint_schema in ('1.0','1.1')),
 authorization_state text not null default 'UNKNOWN' check (authorization_state = 'UNKNOWN'),
 recorded_at timestamptz not null, content_digest text not null,
 primary key (organisation_id,snapshot_id), unique (organisation_id,source_scope,snapshot_id),
 foreign key (organisation_id,candidate_id) references gov_repo.discovery_candidates(organisation_id,candidate_id)
);
create table gov_repo.execution_source_heads (
 organisation_id uuid not null, source_scope text not null, snapshot_id text not null,
 primary key (organisation_id,source_scope),
 foreign key (organisation_id,source_scope,snapshot_id) references gov_repo.execution_source_snapshots(organisation_id,source_scope,snapshot_id)
);
-- Each row is one of four closed typed shapes. JSON is RPC transport only.
create table gov_repo.execution_source_facts (
 organisation_id uuid not null, snapshot_id text not null, ordinal integer not null check (ordinal >= 0),
 field_key text not null check (gov_repo.execution_field_valid(field_key)),
 capability_reference text, tool_candidate_id text,
 principal_kind text check (principal_kind in ('SERVICE_ACCOUNT','OAUTH_CLIENT','MANAGED_IDENTITY','WORKLOAD_IDENTITY','USER_DELEGATED')),
 principal_provider text, principal_authority text, principal_reference text,
 endpoint text, protocol_kind text check (protocol_kind in ('API','MCP')), protocol_value text,
 scope_reference text, resource_reference text,
 assertion_id text not null, evidence_id text not null,
 primary key (organisation_id,snapshot_id,ordinal),
 foreign key (organisation_id,snapshot_id) references gov_repo.execution_source_snapshots(organisation_id,snapshot_id),
 foreign key (organisation_id,assertion_id) references gov_repo.source_assertions(organisation_id,assertion_id),
 foreign key (organisation_id,evidence_id) references gov_repo.discovery_evidence(organisation_id,evidence_id),
 foreign key (organisation_id,tool_candidate_id) references gov_repo.discovery_candidates(organisation_id,candidate_id),
 check (case field_key
  when 'CAPABILITY' then capability_reference is not null and tool_candidate_id is not null and num_nonnulls(principal_kind,principal_provider,principal_authority,principal_reference,endpoint,protocol_kind,protocol_value,scope_reference,resource_reference)=0
  when 'PRINCIPAL' then num_nonnulls(principal_kind,principal_provider,principal_authority,principal_reference)=4 and num_nonnulls(capability_reference,tool_candidate_id,endpoint,protocol_kind,protocol_value,scope_reference,resource_reference)=0
  when 'DECLARED_CONNECTIVITY' then num_nonnulls(endpoint,protocol_kind,protocol_value)=3 and num_nonnulls(capability_reference,tool_candidate_id,principal_kind,principal_provider,principal_authority,principal_reference,scope_reference,resource_reference)=0
  when 'REQUESTED_SCOPE' then num_nonnulls(scope_reference,resource_reference)=2 and num_nonnulls(capability_reference,tool_candidate_id,principal_kind,principal_provider,principal_authority,principal_reference,endpoint,protocol_kind,protocol_value)=0
  else false end),
 check (protocol_kind is null or (protocol_kind='API' and protocol_value in ('UNKNOWN','HTTP','GRPC','GRAPHQL','WEBSOCKET','EVENT','OTHER'))
  or (protocol_kind='MCP' and protocol_value in ('UNKNOWN','STREAMABLE_HTTP','SERVER_SENT_EVENTS','OTHER'))),
 check (endpoint is null or (endpoint ~ '^(https?|wss?)://' and endpoint !~ '[?#%@[:space:]]'))
);
create unique index execution_one_principal on gov_repo.execution_source_facts(organisation_id,snapshot_id) where field_key='PRINCIPAL';
create index execution_facts_assertion on gov_repo.execution_source_facts(organisation_id,assertion_id);
create index execution_facts_evidence on gov_repo.execution_source_facts(organisation_id,evidence_id);
create index execution_facts_tool on gov_repo.execution_source_facts(organisation_id,tool_candidate_id);
create index execution_snapshots_candidate on gov_repo.execution_source_snapshots(organisation_id,candidate_id);

-- Same M10 policy semantics, separate closed AGENT_VERSION field domain.
create table gov_repo.execution_field_policies (
 organisation_id uuid not null references gov_repo.organisations(organisation_id), policy_id text not null,
 version text not null check (length(btrim(version))>0), field_key text not null check (gov_repo.execution_field_valid(field_key)),
 source_system_id text not null, provider_code text not null, connection_id text,
 disposition text not null check (disposition in ('AUTHORITATIVE','CONTRIBUTING','NON_AUTHORITATIVE')),
 primary key(organisation_id,policy_id,version)
);
create table gov_repo.execution_field_policy_heads (
 organisation_id uuid not null, policy_id text not null, version text not null,
 primary key(organisation_id,policy_id),
 foreign key(organisation_id,policy_id,version) references gov_repo.execution_field_policies(organisation_id,policy_id,version)
);
create table gov_repo.execution_field_decisions (
 organisation_id uuid not null, decision_id text not null, canonical_object_id text not null,
 object_kind text not null default 'AGENT_VERSION' check(object_kind='AGENT_VERSION'),
 snapshot_id text not null, field_key text not null check(gov_repo.execution_field_valid(field_key)),
 expected_current_state_id text, policy_id text, policy_version text,
 outcome text not null check(outcome in ('ACCEPT_PROPOSED','KEEP_CURRENT','DEFER','REJECT_PROPOSED')),
 actor_reference text not null check(length(btrim(actor_reference))>0), decided_at timestamptz not null,
 content_digest text not null,
 primary key(organisation_id,decision_id),
 foreign key(organisation_id,canonical_object_id,object_kind) references gov_repo.canonical_objects(organisation_id,canonical_object_id,kind),
 foreign key(organisation_id,snapshot_id) references gov_repo.execution_source_snapshots(organisation_id,snapshot_id),
 foreign key(organisation_id,policy_id,policy_version) references gov_repo.execution_field_policies(organisation_id,policy_id,version),
 check ((policy_id is null) = (policy_version is null))
);
create table gov_repo.execution_field_states (
 organisation_id uuid not null, state_id text not null, canonical_object_id text not null,
 field_key text not null check(gov_repo.execution_field_valid(field_key)),
 snapshot_id text not null, decision_id text not null, previous_state_id text, recorded_at timestamptz not null,
 primary key(organisation_id,state_id), unique(organisation_id,canonical_object_id,field_key,state_id),
 foreign key(organisation_id,decision_id) references gov_repo.execution_field_decisions(organisation_id,decision_id),
 foreign key(organisation_id,snapshot_id) references gov_repo.execution_source_snapshots(organisation_id,snapshot_id),
 foreign key(organisation_id,canonical_object_id,field_key,previous_state_id) references gov_repo.execution_field_states(organisation_id,canonical_object_id,field_key,state_id)
);
create unique index execution_state_root on gov_repo.execution_field_states(organisation_id,canonical_object_id,field_key) where previous_state_id is null;
create unique index execution_state_successor on gov_repo.execution_field_states(organisation_id,previous_state_id) where previous_state_id is not null;
create index execution_states_snapshot on gov_repo.execution_field_states(organisation_id,snapshot_id);
create index execution_states_decision on gov_repo.execution_field_states(organisation_id,decision_id);

create function gov_repo.execution_immutable() returns trigger
language plpgsql security invoker set search_path=pg_catalog as $$
begin raise exception 'EXECUTION_HISTORY_IMMUTABLE'; end;
$$;
create function gov_repo.execution_policy_lock() returns trigger
language plpgsql security invoker set search_path=pg_catalog as $$
declare tenant uuid;
begin
 if TG_OP='UPDATE' and (new.organisation_id<>old.organisation_id or new.policy_id<>old.policy_id) then raise exception 'EXECUTION_POLICY_IDENTITY_IMMUTABLE'; end if;
 if TG_OP='DELETE' then tenant:=old.organisation_id; else tenant:=new.organisation_id; end if;
 perform pg_advisory_xact_lock(hashtextextended(tenant::text||':execution-policy',0));
 if TG_OP='DELETE' then return old; else return new; end if;
end;
$$;
create trigger execution_policy_head_lock before insert or update or delete on gov_repo.execution_field_policy_heads for each row execute function gov_repo.execution_policy_lock();

create function gov_repo.record_execution_snapshot(p_organisation_id uuid,p_snapshot jsonb,p_expected_previous text)
-- Only these two service-only RPCs own writes; direct proposal/state inserts are revoked below.
returns void language plpgsql security definer set search_path=pg_catalog as $$
declare s gov_repo.execution_source_snapshots%rowtype; c gov_repo.discovery_candidates%rowtype;
 a gov_repo.source_assertions%rowtype; item jsonb; f jsonb; current_id text; pos integer:=0; dg text;
begin
 if p_snapshot->>'organisationId' is distinct from p_organisation_id::text or p_snapshot->>'authorizationState' is distinct from 'UNKNOWN'
  or jsonb_typeof(p_snapshot->'facts') is distinct from 'array' or jsonb_array_length(p_snapshot->'facts')>193 then raise exception 'EXECUTION_SNAPSHOT_INVALID'; end if;
 dg:=encode(sha256(convert_to((p_snapshot-'recordedAt')::text,'UTF8')),'hex');
 perform pg_advisory_xact_lock(hashtextextended(p_organisation_id::text||':execution-source:'||(p_snapshot->>'sourceScope'),0));
 select * into s from gov_repo.execution_source_snapshots where organisation_id=p_organisation_id and snapshot_id=p_snapshot->>'snapshotId';
 if found then
  if s.content_digest<>dg then raise exception 'EXECUTION_REPLAY_CONFLICT'; end if;
  return; -- Exact old replay never moves a source head backwards.
 end if;
 select snapshot_id into current_id from gov_repo.execution_source_heads where organisation_id=p_organisation_id and source_scope=p_snapshot->>'sourceScope';
 if current_id is distinct from p_expected_previous then raise exception 'EXECUTION_STALE_SOURCE'; end if;
 select * into strict c from gov_repo.discovery_candidates where organisation_id=p_organisation_id and candidate_id=p_snapshot->>'agentVersionCandidateId';
 if c.candidate_kind is distinct from 'AGENT_VERSION' or c.source_connection_id is distinct from p_snapshot#>>'{sourceObject,connectionId}'
  or c.source_external_type is distinct from p_snapshot#>>'{sourceObject,externalType}' or c.source_external_id is distinct from p_snapshot#>>'{sourceObject,externalId}' then raise exception 'EXECUTION_BINDING_MISMATCH'; end if;
 -- Typed technical-profile proposal is persisted before this independent field proposal.
 if not exists(select 1 from gov_repo.agent_version_technical_profile_proposals p where p.organisation_id=p_organisation_id
  and p.agent_version_candidate_id=c.candidate_id and p.behavior_fingerprint_value=p_snapshot#>>'{behaviorFingerprint,value}'
  and p.behavior_fingerprint_schema_version=p_snapshot#>>'{behaviorFingerprint,schemaVersion}'
  and p.behavior_fingerprint_algorithm='sha256') then raise exception 'EXECUTION_REVISION_MISMATCH'; end if;
 insert into gov_repo.execution_source_snapshots values(p_organisation_id,p_snapshot->>'snapshotId',p_snapshot->>'sourceScope',c.candidate_id,
  c.source_connection_id,p_snapshot->>'sourceSystemId',p_snapshot->>'providerCode',c.source_external_type,c.source_external_id,p_snapshot->>'declarationKey',
  p_snapshot->>'sourceSnapshotId',p_snapshot#>>'{behaviorFingerprint,value}',p_snapshot#>>'{behaviorFingerprint,schemaVersion}','UNKNOWN',(p_snapshot->>'recordedAt')::timestamptz,dg);
 for item in select value from jsonb_array_elements(p_snapshot->'facts') loop
  f:=item->'fact';
  if not coalesce(gov_repo.execution_field_valid(f->>'field'),false) then raise exception 'EXECUTION_FACT_INVALID'; end if;
  select * into strict a from gov_repo.source_assertions where organisation_id=p_organisation_id and assertion_id=item->>'assertionId';
  if a.source_connection_id<>c.source_connection_id or a.source_external_type<>c.source_external_type or a.source_external_id<>c.source_external_id
   or a.snapshot_id is distinct from p_snapshot->>'sourceSnapshotId' or a.trust_state<>'DECLARED' or a.method_code<>'DIRECT_AGENT_EXECUTION_V1' then raise exception 'EXECUTION_SUPPORT_MISMATCH'; end if;
  if not exists(select 1 from gov_repo.acquisition_runs r where r.organisation_id=p_organisation_id and r.run_id=a.run_id and r.source_system_id=p_snapshot->>'sourceSystemId')
   or not exists(select 1 from gov_repo.source_assertion_evidence e where e.organisation_id=p_organisation_id and e.assertion_id=a.assertion_id and e.evidence_id=item->>'evidenceId')
   or not exists(select 1 from gov_repo.discovery_evidence e where e.organisation_id=p_organisation_id and e.evidence_id=item->>'evidenceId' and e.handling='HASH_ONLY') then raise exception 'EXECUTION_SUPPORT_MISMATCH'; end if;
  if f->>'field'='CAPABILITY' and not exists(select 1 from gov_repo.discovery_candidates t where t.organisation_id=p_organisation_id
   and t.candidate_id=item->>'toolCandidateId' and t.candidate_kind='TOOL' and t.source_connection_id=c.source_connection_id
   and t.source_external_type=c.source_external_type and t.source_external_id=c.source_external_id
   and t.envelope#>>'{proposedIdentity,declarationKey}'=f->>'capabilityReference') then raise exception 'EXECUTION_TOOL_MISMATCH'; end if;
  insert into gov_repo.execution_source_facts values(p_organisation_id,p_snapshot->>'snapshotId',pos,f->>'field',
   f->>'capabilityReference',item->>'toolCandidateId',f#>>'{principal,kind}',f#>>'{principal,providerCode}',f#>>'{principal,authorityReference}',f#>>'{principal,principalReference}',
   f->>'endpoint',f#>>'{protocol,kind}',coalesce(f#>>'{protocol,family}',f#>>'{protocol,transport}'),f->>'scopeReference',f->>'resourceReference',item->>'assertionId',item->>'evidenceId');
  pos:=pos+1;
 end loop;
 insert into gov_repo.execution_source_heads values(p_organisation_id,p_snapshot->>'sourceScope',p_snapshot->>'snapshotId')
 on conflict(organisation_id,source_scope) do update set snapshot_id=excluded.snapshot_id;
end;
$$;

create function gov_repo.record_execution_field_decision(p_organisation_id uuid,p_decision jsonb)
returns table(replay boolean,state_id text) language plpgsql security definer set search_path=pg_catalog as $$
declare s gov_repo.execution_source_snapshots%rowtype; d gov_repo.execution_field_decisions%rowtype;
 pol gov_repo.execution_field_policies%rowtype; dg text; current_id text; source_id text; matches integer; target text; result_id text;
begin
 if p_decision->>'organisationId' is distinct from p_organisation_id::text or p_decision#>>'{canonicalObject,organisationId}' is distinct from p_organisation_id::text
  or p_decision#>>'{canonicalObject,kind}' is distinct from 'AGENT_VERSION' or p_decision#>>'{actor,authorityKind}' is distinct from 'HUMAN'
  or not coalesce(gov_repo.execution_field_valid(p_decision->>'field'),false) then raise exception 'EXECUTION_DECISION_INVALID'; end if;
 dg:=encode(sha256(convert_to(p_decision::text,'UTF8')),'hex');
 perform pg_advisory_xact_lock(hashtextextended(p_organisation_id::text||':execution-decision:'||(p_decision->>'decisionId'),0));
 select * into d from gov_repo.execution_field_decisions where organisation_id=p_organisation_id and decision_id=p_decision->>'decisionId';
 if found then
  if d.content_digest<>dg then raise exception 'EXECUTION_REPLAY_CONFLICT'; end if;
  return query select true, st.state_id from (select 1) x left join gov_repo.execution_field_states st on st.organisation_id=p_organisation_id and st.decision_id=d.decision_id;
  return;
 end if;
 select * into strict s from gov_repo.execution_source_snapshots where organisation_id=p_organisation_id and snapshot_id=p_decision->>'snapshotId';
 perform pg_advisory_xact_lock(hashtextextended(p_organisation_id::text||':execution-source:'||s.source_scope,0));
 select snapshot_id into source_id from gov_repo.execution_source_heads where organisation_id=p_organisation_id and source_scope=s.source_scope;
 if source_id is distinct from s.snapshot_id then raise exception 'EXECUTION_STALE_SOURCE'; end if;
 target:=p_decision#>>'{canonicalObject,objectId}';
 select count(*) into matches from gov_repo.canonical_normalized_object_mappings m where m.organisation_id=p_organisation_id
  and m.canonical_object_kind='AGENT_VERSION' and m.normalized_object_identity=s.candidate_id and m.source_connection_id=s.connection_id
  and m.source_external_type=s.external_type and m.source_external_id=s.external_id;
 if matches<>1 or not exists(select 1 from gov_repo.canonical_normalized_object_mappings m where m.organisation_id=p_organisation_id
  and m.canonical_object_id=target and m.canonical_object_kind='AGENT_VERSION' and m.normalized_object_identity=s.candidate_id
  and m.source_connection_id=s.connection_id and m.source_external_type=s.external_type and m.source_external_id=s.external_id) then raise exception 'EXECUTION_BINDING_MISMATCH'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_organisation_id::text||':execution-state:'||target||':'||(p_decision->>'field'),0));
 select st.state_id into current_id from gov_repo.execution_field_states st where st.organisation_id=p_organisation_id and st.canonical_object_id=target and st.field_key=p_decision->>'field'
  and not exists(select 1 from gov_repo.execution_field_states next where next.organisation_id=st.organisation_id and next.previous_state_id=st.state_id);
 if current_id is distinct from p_decision->>'expectedCurrentStateId' then raise exception 'EXECUTION_STALE_STATE'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_organisation_id::text||':execution-policy',0));
 select count(*) into matches from gov_repo.execution_field_policies p join gov_repo.execution_field_policy_heads h using(organisation_id,policy_id,version)
  where p.organisation_id=p_organisation_id and p.field_key=p_decision->>'field' and p.source_system_id=s.source_system_id
   and p.provider_code=s.provider_code and (p.connection_id is null or p.connection_id=s.connection_id);
 if matches>1 then raise exception 'EXECUTION_POLICY_AMBIGUOUS'; end if;
 select p.* into pol from gov_repo.execution_field_policies p join gov_repo.execution_field_policy_heads h using(organisation_id,policy_id,version)
  where p.organisation_id=p_organisation_id and p.field_key=p_decision->>'field' and p.source_system_id=s.source_system_id
   and p.provider_code=s.provider_code and (p.connection_id is null or p.connection_id=s.connection_id);
 if pol.policy_id is distinct from p_decision->>'policyId' or pol.version is distinct from p_decision->>'policyVersion' then raise exception 'EXECUTION_STALE_POLICY'; end if;
 if p_decision->>'outcome'='ACCEPT_PROPOSED' and (pol.policy_id is null or pol.disposition='NON_AUTHORITATIVE') then raise exception 'EXECUTION_NO_FIELD_AUTHORITY'; end if;
 insert into gov_repo.execution_field_decisions values(p_organisation_id,p_decision->>'decisionId',target,'AGENT_VERSION',s.snapshot_id,p_decision->>'field',current_id,
  pol.policy_id,pol.version,p_decision->>'outcome',p_decision#>>'{actor,actorReference}',(p_decision->>'decidedAt')::timestamptz,dg);
 if p_decision->>'outcome'='ACCEPT_PROPOSED' then
  result_id:='execution-state:'||(p_decision->>'decisionId');
  insert into gov_repo.execution_field_states values(p_organisation_id,result_id,target,p_decision->>'field',s.snapshot_id,p_decision->>'decisionId',current_id,(p_decision->>'decidedAt')::timestamptz);
 end if;
 return query select false,result_id;
end;
$$;

do $$ declare t text; begin
 foreach t in array array['execution_source_snapshots','execution_source_facts','execution_field_policies','execution_field_decisions','execution_field_states','execution_source_heads','execution_field_policy_heads'] loop
  execute format('alter table gov_repo.%I enable row level security',t);
  execute format('revoke all on gov_repo.%I from public,anon,authenticated',t);
  execute format('grant select,insert on gov_repo.%I to service_role',t);
  execute format('create policy execution_service on gov_repo.%I for all to service_role using(true) with check(true)',t);
  if t not in ('execution_source_heads','execution_field_policy_heads') then
   execute format('create trigger execution_immutable before update or delete on gov_repo.%I for each row execute function gov_repo.execution_immutable()',t);
  end if;
 end loop;
end $$;
-- Prevent bypass of the transactional source/policy/decision checks via REST table writes.
revoke insert,update,delete on gov_repo.execution_source_snapshots,gov_repo.execution_source_facts,
 gov_repo.execution_source_heads,gov_repo.execution_field_decisions,gov_repo.execution_field_states from service_role;
grant update,delete on gov_repo.execution_field_policy_heads to service_role;
revoke all on function gov_repo.record_execution_snapshot(uuid,jsonb,text),gov_repo.record_execution_field_decision(uuid,jsonb),gov_repo.execution_immutable(),gov_repo.execution_policy_lock(),gov_repo.execution_field_valid(text) from public,anon,authenticated;
grant execute on function gov_repo.record_execution_snapshot(uuid,jsonb,text),gov_repo.record_execution_field_decision(uuid,jsonb),gov_repo.execution_immutable(),gov_repo.execution_policy_lock(),gov_repo.execution_field_valid(text) to service_role;
commit;
