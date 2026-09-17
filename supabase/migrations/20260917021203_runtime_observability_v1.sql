-- M14.2 only. Typed persistence; observations confer no governance authority.
-- Ordered one-time migration. No canonical/M13 writes, raw payloads, TTL or backfill.
begin;
create domain gov_repo.runtime_reference as text check (
 value ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$'
 and value !~ '(-----BEGIN|eyJ[A-Za-z0-9_-]+\.|sk[-_][A-Za-z0-9_-]{8,}|gh[pousr]_[A-Za-z0-9]+|AKIA[A-Z0-9]{16})'
 and value !~* '^(bearer|basic|password|client[-_]?secret|api[-_]?key|authorization|cookie|access[-_]?token):'
);
create type gov_repo.runtime_kind as enum ('EXECUTION','MODEL_CALL','TOOL_CALL','MCP_CALL','API_CALL');
create type gov_repo.runtime_fact as enum ('END_TIME','SOURCE_TIME','PARENT','TARGET','CANONICAL_TARGET','EXACT_BINDING','OUTCOME','DURATION','ERROR','TOKENS','SUPPLIED_COST','DERIVED_COST','PRINCIPAL','ENVIRONMENT','NETWORK','SAMPLING','DROPPED_COUNTS','PROTOCOL');
-- JavaScript ISO year 0000 is PostgreSQL 1 BC. Transport formatting preserves
-- the entire M14.1 four-digit-year domain, including millisecond precision.
create function gov_repo.runtime_iso(t timestamptz) returns text
language sql immutable strict set search_path=pg_catalog as $$
 select case when extract(year from t at time zone 'UTC')=-1 then '0000'||to_char(t at time zone 'UTC','-MM-DD"T"HH24:MI:SS.MS"Z"')
 else to_char(t at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') end;
$$;
create table gov_repo.runtime_source_heads (
 organisation_id uuid not null references gov_repo.organisations(organisation_id),
 connection_id gov_repo.runtime_reference not null unique,
 source_system_id gov_repo.runtime_reference not null,
 provider_code gov_repo.runtime_reference not null,
 producer_identity gov_repo.runtime_reference not null,
 current_configuration_version gov_repo.runtime_reference,
 active boolean not null default false,
 created_by gov_repo.runtime_reference not null,
 created_at timestamptz not null default clock_timestamp(),
 administered_by gov_repo.runtime_reference not null,
 administered_at timestamptz not null default clock_timestamp(),
 primary key(organisation_id,connection_id)
);
create table gov_repo.runtime_source_configurations (
 organisation_id uuid not null,
 connection_id gov_repo.runtime_reference not null,
 configuration_version gov_repo.runtime_reference not null,
 family text not null check(family='RUNTIME'),
 source_system_id gov_repo.runtime_reference not null,
 provider_code gov_repo.runtime_reference not null,
 producer_identity gov_repo.runtime_reference not null,
 instrumentation_name gov_repo.runtime_reference not null,
 instrumentation_version gov_repo.runtime_reference not null,
 sdk_name gov_repo.runtime_reference not null,
 sdk_version gov_repo.runtime_reference not null,
 method_code gov_repo.runtime_reference not null,
 method_version gov_repo.runtime_reference not null,
 supported_kinds gov_repo.runtime_kind[] not null check(cardinality(supported_kinds) between 1 and 5 and array_position(supported_kinds,null) is null),
 supported_facts gov_repo.runtime_fact[] not null check(cardinality(supported_facts)<=19 and array_position(supported_facts,null) is null),
 adapter_version text not null check(adapter_version='1.0.0'),
 schema_version text not null check(schema_version='1.0.0'),
 mapping_version text not null check(mapping_version='1.0.0'),
 binding_method text not null check(binding_method='VERIFIED_RELEASE_ASSOCIATION_V1'),
 binding_version text not null check(binding_version='1.0.0'),
 max_payload_bytes integer not null check(max_payload_bytes between 1 and 1048576),
 max_batch_size integer not null check(max_batch_size between 1 and 10000),
 max_observations bigint not null check(max_observations between 1 and 9007199254740991),
 admission_from timestamptz not null check(isfinite(admission_from)),
 admission_until timestamptz not null check(isfinite(admission_until) and admission_until>admission_from),
 approved_target_references gov_repo.runtime_reference[] not null check(cardinality(approved_target_references)<=128 and array_position(approved_target_references,null) is null),
 approved_target_providers gov_repo.runtime_reference[] not null check(cardinality(approved_target_providers)<=128 and array_position(approved_target_providers,null) is null),
 approved_model_references gov_repo.runtime_reference[] not null check(cardinality(approved_model_references)<=128 and array_position(approved_model_references,null) is null),
 approved_deployments gov_repo.runtime_reference[] not null check(cardinality(approved_deployments)<=128 and array_position(approved_deployments,null) is null),
 approved_charge_references gov_repo.runtime_reference[] not null check(cardinality(approved_charge_references)<=128 and array_position(approved_charge_references,null) is null),
 approved_pricing_references gov_repo.runtime_reference[] not null check(cardinality(approved_pricing_references)<=128 and array_position(approved_pricing_references,null) is null),
 approved_principal_references gov_repo.runtime_reference[] not null check(cardinality(approved_principal_references)<=128 and array_position(approved_principal_references,null) is null),
 approved_authority_references gov_repo.runtime_reference[] not null check(cardinality(approved_authority_references)<=128 and array_position(approved_authority_references,null) is null),
 approved_network_references gov_repo.runtime_reference[] not null check(cardinality(approved_network_references)<=128 and array_position(approved_network_references,null) is null),
 created_by gov_repo.runtime_reference not null,
 created_at timestamptz not null default clock_timestamp(),
 primary key(organisation_id,connection_id,configuration_version),
 foreign key(organisation_id,connection_id) references gov_repo.runtime_source_heads(organisation_id,connection_id)
);
alter table gov_repo.runtime_source_heads add constraint runtime_current_configuration_fk
 foreign key(organisation_id,connection_id,current_configuration_version)
 references gov_repo.runtime_source_configurations(organisation_id,connection_id,configuration_version);
create table gov_repo.runtime_deployment_bindings (
 organisation_id uuid not null,
 binding_id gov_repo.runtime_reference not null,
 connection_id gov_repo.runtime_reference not null,
 producer_identity gov_repo.runtime_reference not null,
 deployment_reference gov_repo.runtime_reference not null,
 artifact_digest text not null check(artifact_digest ~ '^[a-f0-9]{64}$'),
 entrypoint_reference gov_repo.runtime_reference not null,
 agent_version_id text not null,
 agent_version_kind text not null check(agent_version_kind='AGENT_VERSION'),
 mapping_id text not null references gov_repo.canonical_normalized_object_mappings(mapping_id),
 candidate_id text not null,
 source_snapshot_id text not null,
 proof_method text not null check(proof_method='VERIFIED_RELEASE_ASSOCIATION_V1'),
 proof_version text not null check(proof_version='1.0.0'),
 verified_by gov_repo.runtime_reference not null,
 verified_at timestamptz not null default clock_timestamp(),
 primary key(organisation_id,binding_id),
 unique(organisation_id,connection_id,binding_id),
 foreign key(organisation_id,connection_id) references gov_repo.runtime_source_heads(organisation_id,connection_id),
 foreign key(organisation_id,agent_version_id,agent_version_kind) references gov_repo.canonical_objects(organisation_id,canonical_object_id,kind),
 foreign key(organisation_id,candidate_id) references gov_repo.discovery_candidates(organisation_id,candidate_id)
);
create index runtime_binding_version on gov_repo.runtime_deployment_bindings(organisation_id,agent_version_id);
create index runtime_binding_mapping on gov_repo.runtime_deployment_bindings(mapping_id);
create index runtime_binding_candidate on gov_repo.runtime_deployment_bindings(organisation_id,candidate_id);

-- All administrative and admission RPCs use this namespace. Hash collisions only
-- over-serialize; scoped UNIQUE/FK constraints establish identity independently.
create function gov_repo.runtime_lock(p_organisation_id uuid,p_connection_id text) returns void
language sql volatile security invoker set search_path=pg_catalog as $$
 select pg_advisory_xact_lock(hashtextextended(p_organisation_id::text||':runtime-source-v1:'||p_connection_id,0));
$$;
create function gov_repo.runtime_immutable() returns trigger
language plpgsql security invoker set search_path=pg_catalog as $$
begin raise exception 'RUNTIME_HISTORY_IMMUTABLE'; end;
$$;

create function gov_repo.register_runtime_source(p_organisation_id uuid,p_connection_id gov_repo.runtime_reference,
 p_source_system_id gov_repo.runtime_reference,p_provider_code gov_repo.runtime_reference,
 p_producer_identity gov_repo.runtime_reference,p_actor gov_repo.runtime_reference) returns void
language plpgsql security definer set search_path=pg_catalog as $$
begin
 perform gov_repo.runtime_lock(p_organisation_id,p_connection_id);
 insert into gov_repo.runtime_source_heads(organisation_id,connection_id,source_system_id,provider_code,producer_identity,created_by,administered_by)
 values(p_organisation_id,p_connection_id,p_source_system_id,p_provider_code,p_producer_identity,p_actor,p_actor);
exception when others then raise exception 'RUNTIME_SOURCE_REGISTRATION_REJECTED';
end;
$$;
create function gov_repo.configure_runtime_source(p_organisation_id uuid,p_connection_id text,p_configuration gov_repo.runtime_source_configurations) returns void
language plpgsql security definer set search_path=pg_catalog as $$
declare h gov_repo.runtime_source_heads%rowtype;
begin
 perform gov_repo.runtime_lock(p_organisation_id,p_connection_id);
 select * into strict h from gov_repo.runtime_source_heads where organisation_id=p_organisation_id and connection_id=p_connection_id;
 if p_configuration.organisation_id is distinct from p_organisation_id or p_configuration.connection_id is distinct from p_connection_id
 or p_configuration.source_system_id is distinct from h.source_system_id or p_configuration.provider_code is distinct from h.provider_code
 or p_configuration.producer_identity is distinct from h.producer_identity or p_configuration.created_at is not null then raise exception 'RUNTIME_CONFIGURATION_INVALID'; end if;
 p_configuration.created_at:=clock_timestamp();
 insert into gov_repo.runtime_source_configurations select p_configuration.*;
exception when others then raise exception 'RUNTIME_CONFIGURATION_REJECTED';
end;
$$;
create function gov_repo.activate_runtime_source(p_organisation_id uuid,p_connection_id text,p_configuration_version text,p_active boolean,p_actor gov_repo.runtime_reference) returns void
language plpgsql security definer set search_path=pg_catalog as $$
begin
 perform gov_repo.runtime_lock(p_organisation_id,p_connection_id);
 if p_configuration_version is null or p_actor is null or p_active is null then raise exception 'RUNTIME_SOURCE_INVALID'; end if;
 update gov_repo.runtime_source_heads set current_configuration_version=p_configuration_version,active=p_active,
 administered_by=p_actor,administered_at=clock_timestamp() where organisation_id=p_organisation_id and connection_id=p_connection_id;
 if not found then raise exception 'RUNTIME_SOURCE_INVALID'; end if;
exception when others then raise exception 'RUNTIME_SOURCE_ACTIVATION_REJECTED';
end;
$$;
create function gov_repo.register_runtime_binding(p_organisation_id uuid,p_connection_id text,p_binding gov_repo.runtime_deployment_bindings) returns void
language plpgsql security definer set search_path=pg_catalog as $$
declare m gov_repo.canonical_normalized_object_mappings%rowtype; c gov_repo.discovery_candidates%rowtype;
begin
 perform gov_repo.runtime_lock(p_organisation_id,p_connection_id);
 if p_binding.organisation_id is distinct from p_organisation_id or p_binding.connection_id is distinct from p_connection_id
 or p_binding.verified_at is not null then raise exception 'RUNTIME_BINDING_INVALID'; end if;
 perform 1 from gov_repo.runtime_source_heads where organisation_id=p_organisation_id and connection_id=p_connection_id and producer_identity=p_binding.producer_identity;
 if not found then raise exception 'RUNTIME_BINDING_INVALID'; end if;
 select * into strict m from gov_repo.canonical_normalized_object_mappings where organisation_id=p_organisation_id and mapping_id=p_binding.mapping_id;
 select * into strict c from gov_repo.discovery_candidates where organisation_id=p_organisation_id and candidate_id=p_binding.candidate_id;
 if m.canonical_object_kind<>'AGENT_VERSION' or m.canonical_object_id<>p_binding.agent_version_id
 or m.candidate_id<>c.candidate_id or c.candidate_kind<>'AGENT_VERSION'
 or m.normalized_object_identity<>c.candidate_id
 or m.source_connection_id<>c.source_connection_id or m.source_external_type<>c.source_external_type or m.source_external_id<>c.source_external_id
 then raise exception 'RUNTIME_BINDING_INVALID'; end if;
 if not exists(select 1 from gov_repo.reconciliation_decisions d where d.organisation_id=p_organisation_id
 and d.decision_id=m.created_by_decision_id and d.family='OBJECT' and d.outcome in ('CREATE_NEW','MATCH_EXISTING')
 and d.authority_kind='HUMAN' and d.subject_candidate_id=c.candidate_id
 and d.canonical_object_id=m.canonical_object_id and d.canonical_object_kind='AGENT_VERSION')
 then raise exception 'RUNTIME_BINDING_INVALID'; end if;
 -- Exact candidate support must include the independently acquired source snapshot.
 if not exists(select 1 from gov_repo.discovery_candidate_assertions ca
 join gov_repo.source_assertions a on a.organisation_id=ca.organisation_id and a.assertion_id=ca.assertion_id
 where ca.organisation_id=p_organisation_id and ca.candidate_id=c.candidate_id
 and a.run_id=c.acquisition_run_id and a.snapshot_id=p_binding.source_snapshot_id
 and a.source_connection_id=c.source_connection_id and a.source_external_type=c.source_external_type and a.source_external_id=c.source_external_id)
 then raise exception 'RUNTIME_BINDING_INVALID'; end if;
 p_binding.verified_at:=clock_timestamp();
 insert into gov_repo.runtime_deployment_bindings select p_binding.*;
exception when others then raise exception 'RUNTIME_BINDING_REJECTED';
end;
$$;

create function gov_repo.runtime_round_cost(n numeric) returns numeric
language sql immutable strict set search_path=pg_catalog as $$
 select (trunc(n*1000)+case when mod(n*1000,1)>0.5 or (mod(n*1000,1)=0.5 and mod(trunc(n*1000),2)=1) then 1 else 0 end)/1000000000;
$$;
create table gov_repo.runtime_observations (
 organisation_id uuid,
 observation_id uuid,
 connection_id gov_repo.runtime_reference,
 connection_system gov_repo.runtime_reference,
 source_system_id gov_repo.runtime_reference,
 provider_code gov_repo.runtime_reference,
 configuration_version gov_repo.runtime_reference,
 trace_id text,
 span_id text,
 source_event_key text,
 parent_state text,
 parent_reason text,
 parent_span_id text,
 started_nano bigint,
 ended_nano_state text,
 ended_nano_reason text,
 ended_nano_value bigint,
 source_observed_nano_state text,
 source_observed_nano_reason text,
 source_observed_nano_value bigint,
 received_at timestamptz,
 kind text,
 operation text,
 execution_scope text,
 binding_state text,
 unresolved_reason text,
 producer_identity gov_repo.runtime_reference,
 deployment_state text,
 deployment_reason text,
 deployment_value gov_repo.runtime_reference,
 artifact_state text,
 artifact_reason text,
 artifact_value text,
 agent_version_id gov_repo.runtime_reference,
 agent_version_org uuid,
 agent_version_kind text,
 binding_id gov_repo.runtime_reference,
 binding_org uuid,
 binding_connection gov_repo.runtime_reference,
 binding_method text,
 binding_version text,
 target_state text,
 target_reason text,
 target_kind text,
 target_provider gov_repo.runtime_reference,
 target_reference gov_repo.runtime_reference,
 canonical_target_state text,
 canonical_target_reason text,
 target_object_id gov_repo.runtime_reference,
 target_org uuid,
 target_object_kind text,
 target_proof_method text,
 target_proof_version text,
 target_mapping_id gov_repo.runtime_reference,
 target_proof_provider gov_repo.runtime_reference,
 target_source_connection gov_repo.runtime_reference,
 target_external_type gov_repo.runtime_reference,
 target_external_id gov_repo.runtime_reference,
 source_status text,
 outcome_state text,
 outcome_reason text,
 outcome_basis text,
 duration_state text,
 duration_reason text,
 duration_value bigint,
 duration_unit text,
 duration_basis text,
 duration_method gov_repo.runtime_reference,
 duration_version gov_repo.runtime_reference,
 error_state text,
 error_reason text,
 error_category text,
 error_code text,
 reported_model_state text,
 reported_model_reason text,
 reported_model_value gov_repo.runtime_reference,
 token_unit text,
 tokens_input_state text,
 tokens_input_reason text,
 tokens_input_value bigint,
 tokens_output_state text,
 tokens_output_reason text,
 tokens_output_value bigint,
 tokens_total_state text,
 tokens_total_reason text,
 tokens_total_value bigint,
 supplied_state text,
 supplied_reason text,
 supplied_kind text,
 supplied_amount numeric(27,9),
 supplied_currency text,
 supplied_scope text,
 supplied_observation uuid,
 supplied_evidence_org uuid,
 supplied_evidence_connection gov_repo.runtime_reference,
 supplied_evidence_observation uuid,
 charge_reference gov_repo.runtime_reference,
 derived_state text,
 derived_reason text,
 derived_kind text,
 derived_amount numeric(27,9),
 derived_currency text,
 derived_scope text,
 derived_observation uuid,
 pricing_source gov_repo.runtime_reference,
 pricing_version gov_repo.runtime_reference,
 pricing_provider gov_repo.runtime_reference,
 pricing_model gov_repo.runtime_reference,
 pricing_tier gov_repo.runtime_reference,
 pricing_from timestamptz,
 pricing_until_state text,
 pricing_until_reason text,
 pricing_until_value timestamptz,
 input_rate numeric(27,9),
 output_rate numeric(27,9),
 rate_unit text,
 input_coverage text,
 output_coverage text,
 adjustments text,
 usage_unit text,
 usage_input bigint,
 usage_output bigint,
 calculation_method text,
 calculation_version text,
 rounding text,
 decimal_places integer,
 rounding_stage text,
 principal_state text,
 principal_reason text,
 principal_kind text,
 principal_provider gov_repo.runtime_reference,
 principal_authority gov_repo.runtime_reference,
 principal_reference gov_repo.runtime_reference,
 principal_evidence_org uuid,
 principal_evidence_connection gov_repo.runtime_reference,
 principal_evidence_observation uuid,
 principal_method text,
 principal_version gov_repo.runtime_reference,
 environment_state text,
 environment_reason text,
 environment_value text,
 environment_evidence_org uuid,
 environment_evidence_connection gov_repo.runtime_reference,
 environment_evidence_observation uuid,
 environment_method text,
 environment_version gov_repo.runtime_reference,
 network_state text,
 network_reason text,
 network_reference gov_repo.runtime_reference,
 vpc_state text,
 vpc_reason text,
 vpc_value gov_repo.runtime_reference,
 network_evidence_org uuid,
 network_evidence_connection gov_repo.runtime_reference,
 network_evidence_observation uuid,
 network_method text,
 network_version gov_repo.runtime_reference,
 trust_state text,
 provenance_org uuid,
 provenance_connection gov_repo.runtime_reference,
 provenance_observation uuid,
 method_code gov_repo.runtime_reference,
 method_version gov_repo.runtime_reference,
 adapter_version text,
 schema_version text,
 mapping_version text,
 instrumentation_name gov_repo.runtime_reference,
 instrumentation_version gov_repo.runtime_reference,
 sdk_name gov_repo.runtime_reference,
 sdk_version gov_repo.runtime_reference,
 trace_revision text,
 http_revision_state text,
 http_revision_reason text,
 http_revision_value text,
 genai_revision_state text,
 genai_revision_reason text,
 mcp_revision_state text,
 mcp_revision_reason text,
 sampling_state text,
 sampling_reason text,
 sampling_mode text,
 sampling_rate numeric,
 sampled_state text,
 sampled_reason text,
 sampled_value boolean,
 dropped_attributes_state text,
 dropped_attributes_reason text,
 dropped_attributes_value bigint,
 dropped_events_state text,
 dropped_events_reason text,
 dropped_events_value bigint,
 dropped_links_state text,
 dropped_links_reason text,
 dropped_links_value bigint,
 collection_scope text,
 limitations text[],
 transport_state text,
 transport_reason text,
 transport_value text,
 tool_reference_state text,
 tool_reference_reason text,
 tool_reference_value gov_repo.runtime_reference,
 protocol_result_state text,
 protocol_result_reason text,
 protocol_result_value text,
 protocol_state text,
 protocol_reason text,
 protocol_value text,
 http_method_state text,
 http_method_reason text,
 http_method_value text,
 http_status_state text,
 http_status_reason text,
 http_status_value integer,
 recorded_at timestamptz not null,
 primary key(organisation_id,observation_id),
 unique(organisation_id,connection_id,trace_id,span_id),
 foreign key(organisation_id,connection_id,configuration_version) references gov_repo.runtime_source_configurations(organisation_id,connection_id,configuration_version),
 foreign key(organisation_id,connection_id,binding_id) references gov_repo.runtime_deployment_bindings(organisation_id,connection_id,binding_id),
 foreign key(organisation_id,agent_version_id,agent_version_kind) references gov_repo.canonical_objects(organisation_id,canonical_object_id,kind),
 foreign key(organisation_id,target_object_id,target_object_kind) references gov_repo.canonical_objects(organisation_id,canonical_object_id,kind),
 foreign key(target_mapping_id) references gov_repo.canonical_normalized_object_mappings(mapping_id)
);
create index runtime_observation_binding on gov_repo.runtime_observations(organisation_id,connection_id,binding_id);
create index runtime_observation_agent on gov_repo.runtime_observations(organisation_id,agent_version_id);
create index runtime_observation_target on gov_repo.runtime_observations(organisation_id,target_object_id);
create index runtime_observation_mapping on gov_repo.runtime_observations(target_mapping_id);
create index runtime_observation_configuration on gov_repo.runtime_observations(organisation_id,connection_id,configuration_version);

-- Shared constraint and pre-admission validation, including replay inputs.
create function gov_repo.runtime_valid_observation(o gov_repo.runtime_observations) returns boolean
language sql immutable security invoker set search_path=pg_catalog as $$
 select
 (case when true then organisation_id is not null else organisation_id is null end) is true
 and (case when true then observation_id is not null else observation_id is null end) is true
 and (case when true then connection_id is not null else connection_id is null end) is true
 and (case when true then connection_system is not null else connection_system is null end) is true
 and (case when true then source_system_id is not null else source_system_id is null end) is true
 and (case when true then provider_code is not null else provider_code is null end) is true
 and (case when true then configuration_version is not null else configuration_version is null end) is true
 and (case when true then trace_id is not null and (trace_id ~ '^[a-f0-9]{32}$' and trace_id <> repeat('0',32)) else trace_id is null end) is true
 and (case when true then span_id is not null and (span_id ~ '^[a-f0-9]{16}$' and span_id <> repeat('0',16)) else span_id is null end) is true
 and (case when true then source_event_key is not null and (source_event_key=trace_id||':'||span_id) else source_event_key is null end) is true
 and (case when true then parent_state is not null and (parent_state in ('ROOT','UNKNOWN','SPAN_REFERENCE')) else parent_state is null end) is true
 and (case when parent_state='UNKNOWN' then parent_reason is not null and (parent_reason in ('NOT_SUPPLIED','UNSUPPORTED','INSUFFICIENT_EVIDENCE','NOT_APPLICABLE')) else parent_reason is null end) is true
 and (case when parent_state='SPAN_REFERENCE' then parent_span_id is not null and (parent_span_id ~ '^[a-f0-9]{16}$' and parent_span_id <> repeat('0',16) and parent_span_id <> span_id) else parent_span_id is null end) is true
 and (case when true then started_nano is not null and (started_nano >= 0) else started_nano is null end) is true
 and (case when true then ended_nano_state is not null and (ended_nano_state in ('KNOWN','UNKNOWN')) else ended_nano_state is null end) is true
 and (case when ended_nano_state='UNKNOWN' then ended_nano_reason is not null and (ended_nano_reason in ('NOT_SUPPLIED','UNSUPPORTED','INSUFFICIENT_EVIDENCE','NOT_APPLICABLE')) else ended_nano_reason is null end) is true
 and (case when ended_nano_state='KNOWN' then ended_nano_value is not null and (ended_nano_value >= started_nano) else ended_nano_value is null end) is true
 and (case when true then source_observed_nano_state is not null and (source_observed_nano_state in ('KNOWN','UNKNOWN')) else source_observed_nano_state is null end) is true
 and (case when source_observed_nano_state='UNKNOWN' then source_observed_nano_reason is not null and (source_observed_nano_reason in ('NOT_SUPPLIED','UNSUPPORTED','INSUFFICIENT_EVIDENCE','NOT_APPLICABLE')) else source_observed_nano_reason is null end) is true
 and (case when source_observed_nano_state='KNOWN' then source_observed_nano_value is not null and (source_observed_nano_value >= 0) else source_observed_nano_value is null end) is true
 and (case when true then received_at is not null else received_at is null end) is true
 and (case when true then kind is not null and (kind in ('EXECUTION','MODEL_CALL','TOOL_CALL','MCP_CALL','API_CALL')) else kind is null end) is true
 and (case when true then operation is not null else operation is null end) is true
 and (case when kind='EXECUTION' then execution_scope is not null and (execution_scope in ('OPERATION')) else execution_scope is null end) is true
 and (case when true then binding_state is not null and (binding_state in ('EXACT','UNRESOLVED')) else binding_state is null end) is true
 and (case when binding_state='UNRESOLVED' then unresolved_reason is not null and (unresolved_reason in ('MISSING_REVISION_EVIDENCE','NO_EXACT_MAPPING','AMBIGUOUS_MAPPING','UNSUPPORTED_BINDING_PROOF')) else unresolved_reason is null end) is true
 and (case when true then producer_identity is not null else producer_identity is null end) is true
 and (case when true then deployment_state is not null and (deployment_state in ('KNOWN','UNKNOWN')) else deployment_state is null end) is true
 and (case when deployment_state='UNKNOWN' then deployment_reason is not null and (deployment_reason in ('NOT_SUPPLIED','UNSUPPORTED','INSUFFICIENT_EVIDENCE','NOT_APPLICABLE')) else deployment_reason is null end) is true
 and (case when deployment_state='KNOWN' then deployment_value is not null else deployment_value is null end) is true
 and (case when true then artifact_state is not null and (artifact_state in ('KNOWN','UNKNOWN')) else artifact_state is null end) is true
 and (case when artifact_state='UNKNOWN' then artifact_reason is not null and (artifact_reason in ('NOT_SUPPLIED','UNSUPPORTED','INSUFFICIENT_EVIDENCE','NOT_APPLICABLE')) else artifact_reason is null end) is true
 and (case when artifact_state='KNOWN' then artifact_value is not null and (artifact_value ~ '^[a-f0-9]{64}$') else artifact_value is null end) is true
 and (case when binding_state='EXACT' then agent_version_id is not null else agent_version_id is null end) is true
 and (case when binding_state='EXACT' then agent_version_org is not null else agent_version_org is null end) is true
 and (case when binding_state='EXACT' then agent_version_kind is not null and (agent_version_kind in ('AGENT_VERSION')) else agent_version_kind is null end) is true
 and (case when binding_state='EXACT' then binding_id is not null else binding_id is null end) is true
 and (case when binding_state='EXACT' then binding_org is not null else binding_org is null end) is true
 and (case when binding_state='EXACT' then binding_connection is not null else binding_connection is null end) is true
 and (case when binding_state='EXACT' then binding_method is not null and (binding_method in ('VERIFIED_RELEASE_ASSOCIATION_V1')) else binding_method is null end) is true
 and (case when binding_state='EXACT' then binding_version is not null and (binding_version in ('1.0.0')) else binding_version is null end) is true
 and (case when kind<>'EXECUTION' then target_state is not null and (target_state in ('KNOWN','UNKNOWN')) else target_state is null end) is true
 and (case when target_state='UNKNOWN' then target_reason is not null and (target_reason in ('NOT_SUPPLIED','UNSUPPORTED','INSUFFICIENT_EVIDENCE','NOT_APPLICABLE')) else target_reason is null end) is true
 and (case when target_state='KNOWN' then target_kind is not null and (target_kind in ('MODEL','TOOL','MCP_SERVER','API')) else target_kind is null end) is true
 and (case when target_state='KNOWN' then target_provider is not null else target_provider is null end) is true
 and (case when target_state='KNOWN' then target_reference is not null else target_reference is null end) is true
 and (case when kind<>'EXECUTION' then canonical_target_state is not null and (canonical_target_state in ('KNOWN','UNKNOWN')) else canonical_target_state is null end) is true
 and (case when canonical_target_state='UNKNOWN' then canonical_target_reason is not null and (canonical_target_reason in ('NOT_SUPPLIED','UNSUPPORTED','INSUFFICIENT_EVIDENCE','NOT_APPLICABLE')) else canonical_target_reason is null end) is true
 and (case when canonical_target_state='KNOWN' then target_object_id is not null else target_object_id is null end) is true
 and (case when canonical_target_state='KNOWN' then target_org is not null else target_org is null end) is true
 and (case when canonical_target_state='KNOWN' then target_object_kind is not null and (target_object_kind in ('MODEL','TOOL','MCP_SERVER','API')) else target_object_kind is null end) is true
 and (case when canonical_target_state='KNOWN' then target_proof_method is not null and (target_proof_method in ('EXACT_SOURCE_COORDINATES_V1')) else target_proof_method is null end) is true
 and (case when canonical_target_state='KNOWN' then target_proof_version is not null and (target_proof_version in ('1.0.0')) else target_proof_version is null end) is true
 and (case when canonical_target_state='KNOWN' then target_mapping_id is not null else target_mapping_id is null end) is true
 and (case when canonical_target_state='KNOWN' then target_proof_provider is not null else target_proof_provider is null end) is true
 and (case when canonical_target_state='KNOWN' then target_source_connection is not null else target_source_connection is null end) is true
 and (case when canonical_target_state='KNOWN' then target_external_type is not null else target_external_type is null end) is true
 and (case when canonical_target_state='KNOWN' then target_external_id is not null else target_external_id is null end) is true
 and (case when true then source_status is not null and (source_status in ('UNSET','OK','ERROR')) else source_status is null end) is true
 and (case when true then outcome_state is not null and (outcome_state in ('UNKNOWN','SUCCESS','ERROR','FAILURE')) else outcome_state is null end) is true
 and (case when outcome_state='UNKNOWN' then outcome_reason is not null and (outcome_reason in ('NOT_SUPPLIED','UNSUPPORTED','INSUFFICIENT_EVIDENCE','NOT_APPLICABLE')) else outcome_reason is null end) is true
 and (case when outcome_state<>'UNKNOWN' then outcome_basis is not null and (outcome_basis in ('OTEL_STATUS','HTTP_STATUS','DIRECT_RESULT')) else outcome_basis is null end) is true
 and (case when true then duration_state is not null and (duration_state in ('KNOWN','UNKNOWN')) else duration_state is null end) is true
 and (case when duration_state='UNKNOWN' then duration_reason is not null and (duration_reason in ('NOT_SUPPLIED','UNSUPPORTED','INSUFFICIENT_EVIDENCE','NOT_APPLICABLE')) else duration_reason is null end) is true
 and (case when duration_state='KNOWN' then duration_value is not null and (duration_value>=0) else duration_value is null end) is true
 and (case when duration_state='KNOWN' then duration_unit is not null and (duration_unit in ('NANOSECOND')) else duration_unit is null end) is true
 and (case when duration_state='KNOWN' then duration_basis is not null and (duration_basis in ('MEASURED','START_END_DIFFERENCE')) else duration_basis is null end) is true
 and (case when duration_state='KNOWN' then duration_method is not null else duration_method is null end) is true
 and (case when duration_state='KNOWN' then duration_version is not null else duration_version is null end) is true
 and (case when true then error_state is not null and (error_state in ('KNOWN','UNKNOWN')) else error_state is null end) is true
 and (case when error_state='UNKNOWN' then error_reason is not null and (error_reason in ('NOT_SUPPLIED','UNSUPPORTED','INSUFFICIENT_EVIDENCE','NOT_APPLICABLE')) else error_reason is null end) is true
 and (case when error_state='KNOWN' then error_category is not null and (error_category in ('TIMEOUT','CANCELLED','TRANSPORT','PROTOCOL','PROVIDER','APPLICATION')) else error_category is null end) is true
 and (case when error_state='KNOWN' then error_code is not null and (error_code in ('DEADLINE_EXCEEDED','OPERATION_CANCELLED','CONNECTION_FAILED','HTTP_ERROR','INVALID_RESPONSE','PROVIDER_REJECTED','OPERATION_FAILED')) else error_code is null end) is true
 and (case when kind='MODEL_CALL' then reported_model_state is not null and (reported_model_state in ('KNOWN','UNKNOWN')) else reported_model_state is null end) is true
 and (case when reported_model_state='UNKNOWN' then reported_model_reason is not null and (reported_model_reason in ('NOT_SUPPLIED','UNSUPPORTED','INSUFFICIENT_EVIDENCE','NOT_APPLICABLE')) else reported_model_reason is null end) is true
 and (case when reported_model_state='KNOWN' then reported_model_value is not null else reported_model_value is null end) is true
 and (case when kind='MODEL_CALL' then token_unit is not null and (token_unit in ('TOKEN')) else token_unit is null end) is true
 and (case when kind='MODEL_CALL' then tokens_input_state is not null and (tokens_input_state in ('KNOWN','UNKNOWN')) else tokens_input_state is null end) is true
 and (case when tokens_input_state='UNKNOWN' then tokens_input_reason is not null and (tokens_input_reason in ('NOT_SUPPLIED','UNSUPPORTED','INSUFFICIENT_EVIDENCE','NOT_APPLICABLE')) else tokens_input_reason is null end) is true
 and (case when tokens_input_state='KNOWN' then tokens_input_value is not null and (tokens_input_value between 0 and 9007199254740991) else tokens_input_value is null end) is true
 and (case when kind='MODEL_CALL' then tokens_output_state is not null and (tokens_output_state in ('KNOWN','UNKNOWN')) else tokens_output_state is null end) is true
 and (case when tokens_output_state='UNKNOWN' then tokens_output_reason is not null and (tokens_output_reason in ('NOT_SUPPLIED','UNSUPPORTED','INSUFFICIENT_EVIDENCE','NOT_APPLICABLE')) else tokens_output_reason is null end) is true
 and (case when tokens_output_state='KNOWN' then tokens_output_value is not null and (tokens_output_value between 0 and 9007199254740991) else tokens_output_value is null end) is true
 and (case when kind='MODEL_CALL' then tokens_total_state is not null and (tokens_total_state in ('KNOWN','UNKNOWN')) else tokens_total_state is null end) is true
 and (case when tokens_total_state='UNKNOWN' then tokens_total_reason is not null and (tokens_total_reason in ('NOT_SUPPLIED','UNSUPPORTED','INSUFFICIENT_EVIDENCE','NOT_APPLICABLE')) else tokens_total_reason is null end) is true
 and (case when tokens_total_state='KNOWN' then tokens_total_value is not null and (tokens_total_value between 0 and 9007199254740991) else tokens_total_value is null end) is true
 and (case when kind='MODEL_CALL' then supplied_state is not null and (supplied_state in ('KNOWN','UNKNOWN')) else supplied_state is null end) is true
 and (case when supplied_state='UNKNOWN' then supplied_reason is not null and (supplied_reason in ('NOT_SUPPLIED','UNSUPPORTED','INSUFFICIENT_EVIDENCE','NOT_APPLICABLE')) else supplied_reason is null end) is true
 and (case when supplied_state='KNOWN' then supplied_kind is not null and (supplied_kind in ('SUPPLIED')) else supplied_kind is null end) is true
 and (case when supplied_state='KNOWN' then supplied_amount is not null and (supplied_amount>=0) else supplied_amount is null end) is true
 and (case when supplied_state='KNOWN' then supplied_currency is not null and (supplied_currency ~ '^[A-Z]{3}$') else supplied_currency is null end) is true
 and (case when supplied_state='KNOWN' then supplied_scope is not null and (supplied_scope in ('SINGLE_CALL')) else supplied_scope is null end) is true
 and (case when supplied_state='KNOWN' then supplied_observation is not null and (supplied_observation=observation_id) else supplied_observation is null end) is true
 and (case when supplied_state='KNOWN' then supplied_evidence_org is not null else supplied_evidence_org is null end) is true
 and (case when supplied_state='KNOWN' then supplied_evidence_connection is not null else supplied_evidence_connection is null end) is true
 and (case when supplied_state='KNOWN' then supplied_evidence_observation is not null else supplied_evidence_observation is null end) is true
 and case when supplied_state='KNOWN' then supplied_evidence_org=organisation_id and supplied_evidence_connection=connection_id and supplied_evidence_observation=observation_id else true end
 and (case when supplied_state='KNOWN' then charge_reference is not null else charge_reference is null end) is true
 and (case when kind='MODEL_CALL' then derived_state is not null and (derived_state in ('KNOWN','UNKNOWN')) else derived_state is null end) is true
 and (case when derived_state='UNKNOWN' then derived_reason is not null and (derived_reason in ('NOT_SUPPLIED','UNSUPPORTED','INSUFFICIENT_EVIDENCE','NOT_APPLICABLE')) else derived_reason is null end) is true
 and (case when derived_state='KNOWN' then derived_kind is not null and (derived_kind in ('DERIVED')) else derived_kind is null end) is true
 and (case when derived_state='KNOWN' then derived_amount is not null and (derived_amount>=0) else derived_amount is null end) is true
 and (case when derived_state='KNOWN' then derived_currency is not null and (derived_currency ~ '^[A-Z]{3}$') else derived_currency is null end) is true
 and (case when derived_state='KNOWN' then derived_scope is not null and (derived_scope in ('SINGLE_CALL')) else derived_scope is null end) is true
 and (case when derived_state='KNOWN' then derived_observation is not null and (derived_observation=observation_id) else derived_observation is null end) is true
 and (case when derived_state='KNOWN' then pricing_source is not null else pricing_source is null end) is true
 and (case when derived_state='KNOWN' then pricing_version is not null else pricing_version is null end) is true
 and (case when derived_state='KNOWN' then pricing_provider is not null else pricing_provider is null end) is true
 and (case when derived_state='KNOWN' then pricing_model is not null else pricing_model is null end) is true
 and (case when derived_state='KNOWN' then pricing_tier is not null else pricing_tier is null end) is true
 and (case when derived_state='KNOWN' then pricing_from is not null else pricing_from is null end) is true
 and (case when derived_state='KNOWN' then pricing_until_state is not null and (pricing_until_state in ('KNOWN','UNKNOWN')) else pricing_until_state is null end) is true
 and (case when pricing_until_state='UNKNOWN' then pricing_until_reason is not null and (pricing_until_reason in ('NOT_SUPPLIED','UNSUPPORTED','INSUFFICIENT_EVIDENCE','NOT_APPLICABLE')) else pricing_until_reason is null end) is true
 and (case when pricing_until_state='KNOWN' then pricing_until_value is not null else pricing_until_value is null end) is true
 and (case when derived_state='KNOWN' then input_rate is not null and (input_rate>=0) else input_rate is null end) is true
 and (case when derived_state='KNOWN' then output_rate is not null and (output_rate>=0) else output_rate is null end) is true
 and (case when derived_state='KNOWN' then rate_unit is not null and (rate_unit in ('PER_MILLION_TOKENS')) else rate_unit is null end) is true
 and (case when derived_state='KNOWN' then input_coverage is not null and (input_coverage in ('ALL_INPUT_TOKENS')) else input_coverage is null end) is true
 and (case when derived_state='KNOWN' then output_coverage is not null and (output_coverage in ('ALL_OUTPUT_TOKENS')) else output_coverage is null end) is true
 and (case when derived_state='KNOWN' then adjustments is not null and (adjustments in ('NONE_APPLICABLE')) else adjustments is null end) is true
 and (case when derived_state='KNOWN' then usage_unit is not null and (usage_unit in ('TOKEN')) else usage_unit is null end) is true
 and (case when derived_state='KNOWN' then usage_input is not null and (usage_input between 0 and 9007199254740991) else usage_input is null end) is true
 and (case when derived_state='KNOWN' then usage_output is not null and (usage_output between 0 and 9007199254740991) else usage_output is null end) is true
 and (case when derived_state='KNOWN' then calculation_method is not null and (calculation_method in ('FLAT_TWO_BUCKET_TOKEN_TARIFF')) else calculation_method is null end) is true
 and (case when derived_state='KNOWN' then calculation_version is not null and (calculation_version in ('1.0.0')) else calculation_version is null end) is true
 and (case when derived_state='KNOWN' then rounding is not null and (rounding in ('HALF_EVEN')) else rounding is null end) is true
 and (case when derived_state='KNOWN' then decimal_places is not null and (decimal_places=9) else decimal_places is null end) is true
 and (case when derived_state='KNOWN' then rounding_stage is not null and (rounding_stage in ('FINAL_SUM')) else rounding_stage is null end) is true
 and (case when true then principal_state is not null and (principal_state in ('KNOWN','UNKNOWN')) else principal_state is null end) is true
 and (case when principal_state='UNKNOWN' then principal_reason is not null and (principal_reason in ('NOT_SUPPLIED','UNSUPPORTED','INSUFFICIENT_EVIDENCE','NOT_APPLICABLE')) else principal_reason is null end) is true
 and (case when principal_state='KNOWN' then principal_kind is not null and (principal_kind in ('SERVICE_ACCOUNT','OAUTH_CLIENT','MANAGED_IDENTITY','WORKLOAD_IDENTITY','USER_DELEGATED')) else principal_kind is null end) is true
 and (case when principal_state='KNOWN' then principal_provider is not null else principal_provider is null end) is true
 and (case when principal_state='KNOWN' then principal_authority is not null else principal_authority is null end) is true
 and (case when principal_state='KNOWN' then principal_reference is not null else principal_reference is null end) is true
 and (case when principal_state='KNOWN' then principal_evidence_org is not null else principal_evidence_org is null end) is true
 and (case when principal_state='KNOWN' then principal_evidence_connection is not null else principal_evidence_connection is null end) is true
 and (case when principal_state='KNOWN' then principal_evidence_observation is not null else principal_evidence_observation is null end) is true
 and case when principal_state='KNOWN' then principal_evidence_org=organisation_id and principal_evidence_connection=connection_id and principal_evidence_observation=observation_id else true end
 and (case when principal_state='KNOWN' then principal_method is not null and (principal_method in ('DIRECT_RUNTIME_MEASUREMENT')) else principal_method is null end) is true
 and (case when principal_state='KNOWN' then principal_version is not null else principal_version is null end) is true
 and (case when true then environment_state is not null and (environment_state in ('KNOWN','UNKNOWN')) else environment_state is null end) is true
 and (case when environment_state='UNKNOWN' then environment_reason is not null and (environment_reason in ('NOT_SUPPLIED','UNSUPPORTED','INSUFFICIENT_EVIDENCE','NOT_APPLICABLE')) else environment_reason is null end) is true
 and (case when environment_state='KNOWN' then environment_value is not null and (environment_value in ('DEVELOPMENT','TEST','STAGING','PRODUCTION')) else environment_value is null end) is true
 and (case when environment_state='KNOWN' then environment_evidence_org is not null else environment_evidence_org is null end) is true
 and (case when environment_state='KNOWN' then environment_evidence_connection is not null else environment_evidence_connection is null end) is true
 and (case when environment_state='KNOWN' then environment_evidence_observation is not null else environment_evidence_observation is null end) is true
 and case when environment_state='KNOWN' then environment_evidence_org=organisation_id and environment_evidence_connection=connection_id and environment_evidence_observation=observation_id else true end
 and (case when environment_state='KNOWN' then environment_method is not null and (environment_method in ('DIRECT_RUNTIME_MEASUREMENT')) else environment_method is null end) is true
 and (case when environment_state='KNOWN' then environment_version is not null else environment_version is null end) is true
 and (case when true then network_state is not null and (network_state in ('KNOWN','UNKNOWN')) else network_state is null end) is true
 and (case when network_state='UNKNOWN' then network_reason is not null and (network_reason in ('NOT_SUPPLIED','UNSUPPORTED','INSUFFICIENT_EVIDENCE','NOT_APPLICABLE')) else network_reason is null end) is true
 and (case when network_state='KNOWN' then network_reference is not null else network_reference is null end) is true
 and (case when network_state='KNOWN' then vpc_state is not null and (vpc_state in ('KNOWN','UNKNOWN')) else vpc_state is null end) is true
 and (case when vpc_state='UNKNOWN' then vpc_reason is not null and (vpc_reason in ('NOT_SUPPLIED','UNSUPPORTED','INSUFFICIENT_EVIDENCE','NOT_APPLICABLE')) else vpc_reason is null end) is true
 and (case when vpc_state='KNOWN' then vpc_value is not null else vpc_value is null end) is true
 and (case when network_state='KNOWN' then network_evidence_org is not null else network_evidence_org is null end) is true
 and (case when network_state='KNOWN' then network_evidence_connection is not null else network_evidence_connection is null end) is true
 and (case when network_state='KNOWN' then network_evidence_observation is not null else network_evidence_observation is null end) is true
 and case when network_state='KNOWN' then network_evidence_org=organisation_id and network_evidence_connection=connection_id and network_evidence_observation=observation_id else true end
 and (case when network_state='KNOWN' then network_method is not null and (network_method in ('DIRECT_RUNTIME_MEASUREMENT')) else network_method is null end) is true
 and (case when network_state='KNOWN' then network_version is not null else network_version is null end) is true
 and (case when true then trust_state is not null and (trust_state in ('OBSERVED')) else trust_state is null end) is true
 and (case when true then provenance_org is not null else provenance_org is null end) is true
 and (case when true then provenance_connection is not null else provenance_connection is null end) is true
 and (case when true then provenance_observation is not null else provenance_observation is null end) is true
 and case when true then provenance_org=organisation_id and provenance_connection=connection_id and provenance_observation=observation_id else true end
 and (case when true then method_code is not null else method_code is null end) is true
 and (case when true then method_version is not null else method_version is null end) is true
 and (case when true then adapter_version is not null and (adapter_version in ('1.0.0')) else adapter_version is null end) is true
 and (case when true then schema_version is not null and (schema_version in ('1.0.0')) else schema_version is null end) is true
 and (case when true then mapping_version is not null and (mapping_version in ('1.0.0')) else mapping_version is null end) is true
 and (case when true then instrumentation_name is not null else instrumentation_name is null end) is true
 and (case when true then instrumentation_version is not null else instrumentation_version is null end) is true
 and (case when true then sdk_name is not null else sdk_name is null end) is true
 and (case when true then sdk_version is not null else sdk_version is null end) is true
 and (case when true then trace_revision is not null and (trace_revision in ('1.41.0')) else trace_revision is null end) is true
 and (case when true then http_revision_state is not null and (http_revision_state in ('KNOWN','UNKNOWN')) else http_revision_state is null end) is true
 and (case when http_revision_state='UNKNOWN' then http_revision_reason is not null and (http_revision_reason in ('NOT_SUPPLIED','UNSUPPORTED','INSUFFICIENT_EVIDENCE','NOT_APPLICABLE')) else http_revision_reason is null end) is true
 and (case when http_revision_state='KNOWN' then http_revision_value is not null and (http_revision_value='1.29.0') else http_revision_value is null end) is true
 and (case when true then genai_revision_state is not null and (genai_revision_state in ('UNKNOWN')) else genai_revision_state is null end) is true
 and (case when true then genai_revision_reason is not null and (genai_revision_reason in ('NOT_SUPPLIED','UNSUPPORTED','INSUFFICIENT_EVIDENCE','NOT_APPLICABLE')) else genai_revision_reason is null end) is true
 and (case when true then mcp_revision_state is not null and (mcp_revision_state in ('UNKNOWN')) else mcp_revision_state is null end) is true
 and (case when true then mcp_revision_reason is not null and (mcp_revision_reason in ('NOT_SUPPLIED','UNSUPPORTED','INSUFFICIENT_EVIDENCE','NOT_APPLICABLE')) else mcp_revision_reason is null end) is true
 and (case when true then sampling_state is not null and (sampling_state in ('KNOWN','UNKNOWN')) else sampling_state is null end) is true
 and (case when sampling_state='UNKNOWN' then sampling_reason is not null and (sampling_reason in ('NOT_SUPPLIED','UNSUPPORTED','INSUFFICIENT_EVIDENCE','NOT_APPLICABLE')) else sampling_reason is null end) is true
 and (case when sampling_state='KNOWN' then sampling_mode is not null and (sampling_mode in ('ALWAYS_ON','TRACE_RATIO')) else sampling_mode is null end) is true
 and (case when sampling_state='KNOWN' then sampling_rate is not null and (sampling_rate between 0 and 1) else sampling_rate is null end) is true
 and (case when true then sampled_state is not null and (sampled_state in ('KNOWN','UNKNOWN')) else sampled_state is null end) is true
 and (case when sampled_state='UNKNOWN' then sampled_reason is not null and (sampled_reason in ('NOT_SUPPLIED','UNSUPPORTED','INSUFFICIENT_EVIDENCE','NOT_APPLICABLE')) else sampled_reason is null end) is true
 and (case when sampled_state='KNOWN' then sampled_value is not null else sampled_value is null end) is true
 and (case when true then dropped_attributes_state is not null and (dropped_attributes_state in ('KNOWN','UNKNOWN')) else dropped_attributes_state is null end) is true
 and (case when dropped_attributes_state='UNKNOWN' then dropped_attributes_reason is not null and (dropped_attributes_reason in ('NOT_SUPPLIED','UNSUPPORTED','INSUFFICIENT_EVIDENCE','NOT_APPLICABLE')) else dropped_attributes_reason is null end) is true
 and (case when dropped_attributes_state='KNOWN' then dropped_attributes_value is not null and (dropped_attributes_value between 0 and 9007199254740991) else dropped_attributes_value is null end) is true
 and (case when true then dropped_events_state is not null and (dropped_events_state in ('KNOWN','UNKNOWN')) else dropped_events_state is null end) is true
 and (case when dropped_events_state='UNKNOWN' then dropped_events_reason is not null and (dropped_events_reason in ('NOT_SUPPLIED','UNSUPPORTED','INSUFFICIENT_EVIDENCE','NOT_APPLICABLE')) else dropped_events_reason is null end) is true
 and (case when dropped_events_state='KNOWN' then dropped_events_value is not null and (dropped_events_value between 0 and 9007199254740991) else dropped_events_value is null end) is true
 and (case when true then dropped_links_state is not null and (dropped_links_state in ('KNOWN','UNKNOWN')) else dropped_links_state is null end) is true
 and (case when dropped_links_state='UNKNOWN' then dropped_links_reason is not null and (dropped_links_reason in ('NOT_SUPPLIED','UNSUPPORTED','INSUFFICIENT_EVIDENCE','NOT_APPLICABLE')) else dropped_links_reason is null end) is true
 and (case when dropped_links_state='KNOWN' then dropped_links_value is not null and (dropped_links_value between 0 and 9007199254740991) else dropped_links_value is null end) is true
 and (case when true then collection_scope is not null and (collection_scope in ('OPERATION_ONLY','PARTIAL_TRACE')) else collection_scope is null end) is true
 and (case when true then limitations is not null and (limitations <@ array['PARTIAL_COLLECTION','MISSING_PARENT_POSSIBLE','DELIVERY_NOT_GUARANTEED','CLOCK_UNCERTAINTY','CROSS_SOURCE_OVERLAP_POSSIBLE']::text[] and cardinality(limitations)<=5 and array_position(limitations,null) is null) else limitations is null end) is true
 and (case when kind='MCP_CALL' then transport_state is not null and (transport_state in ('KNOWN','UNKNOWN')) else transport_state is null end) is true
 and (case when transport_state='UNKNOWN' then transport_reason is not null and (transport_reason in ('NOT_SUPPLIED','UNSUPPORTED','INSUFFICIENT_EVIDENCE','NOT_APPLICABLE')) else transport_reason is null end) is true
 and (case when transport_state='KNOWN' then transport_value is not null and (transport_value in ('STDIO','STREAMABLE_HTTP','SERVER_SENT_EVENTS')) else transport_value is null end) is true
 and (case when kind='MCP_CALL' then tool_reference_state is not null and (tool_reference_state in ('KNOWN','UNKNOWN')) else tool_reference_state is null end) is true
 and (case when tool_reference_state='UNKNOWN' then tool_reference_reason is not null and (tool_reference_reason in ('NOT_SUPPLIED','UNSUPPORTED','INSUFFICIENT_EVIDENCE','NOT_APPLICABLE')) else tool_reference_reason is null end) is true
 and (case when tool_reference_state='KNOWN' then tool_reference_value is not null else tool_reference_value is null end) is true
 and (case when kind='MCP_CALL' then protocol_result_state is not null and (protocol_result_state in ('KNOWN','UNKNOWN')) else protocol_result_state is null end) is true
 and (case when protocol_result_state='UNKNOWN' then protocol_result_reason is not null and (protocol_result_reason in ('NOT_SUPPLIED','UNSUPPORTED','INSUFFICIENT_EVIDENCE','NOT_APPLICABLE')) else protocol_result_reason is null end) is true
 and (case when protocol_result_state='KNOWN' then protocol_result_value is not null and (protocol_result_value in ('SUCCESS','ERROR')) else protocol_result_value is null end) is true
 and (case when kind='API_CALL' then protocol_state is not null and (protocol_state in ('KNOWN','UNKNOWN')) else protocol_state is null end) is true
 and (case when protocol_state='UNKNOWN' then protocol_reason is not null and (protocol_reason in ('NOT_SUPPLIED','UNSUPPORTED','INSUFFICIENT_EVIDENCE','NOT_APPLICABLE')) else protocol_reason is null end) is true
 and (case when protocol_state='KNOWN' then protocol_value is not null and (protocol_value in ('HTTP','GRPC','GRAPHQL','WEBSOCKET','EVENT')) else protocol_value is null end) is true
 and (case when kind='API_CALL' then http_method_state is not null and (http_method_state in ('KNOWN','UNKNOWN')) else http_method_state is null end) is true
 and (case when http_method_state='UNKNOWN' then http_method_reason is not null and (http_method_reason in ('NOT_SUPPLIED','UNSUPPORTED','INSUFFICIENT_EVIDENCE','NOT_APPLICABLE')) else http_method_reason is null end) is true
 and (case when http_method_state='KNOWN' then http_method_value is not null and (http_method_value in ('GET','POST','PUT','PATCH','DELETE','HEAD','OPTIONS')) else http_method_value is null end) is true
 and (case when kind='API_CALL' then http_status_state is not null and (http_status_state in ('KNOWN','UNKNOWN')) else http_status_state is null end) is true
 and (case when http_status_state='UNKNOWN' then http_status_reason is not null and (http_status_reason in ('NOT_SUPPLIED','UNSUPPORTED','INSUFFICIENT_EVIDENCE','NOT_APPLICABLE')) else http_status_reason is null end) is true
 and (case when http_status_state='KNOWN' then http_status_value is not null and (http_status_value between 100 and 599) else http_status_value is null end) is true
 and (connection_system=source_system_id) is true
 and (observation_id::text ~ '^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$') is true
 and (case kind when 'EXECUTION' then operation in ('GOVERNANCE_ANSWER','RUNTIME_EXECUTION') when 'MODEL_CALL' then operation in ('CHAT_COMPLETION','EMBEDDING') when 'TOOL_CALL' then operation='INVOKE' when 'MCP_CALL' then operation in ('tools/call','resources/read','prompts/get','ping','initialize') when 'API_CALL' then operation='REQUEST' else false end) is true
 and (case when binding_state='EXACT' then agent_version_org=organisation_id and binding_org=organisation_id and binding_connection=connection_id and deployment_state='KNOWN' and artifact_state='KNOWN' else true end) is true
 and (case when target_state='KNOWN' then target_kind=case kind when 'MODEL_CALL' then 'MODEL' when 'TOOL_CALL' then 'TOOL' when 'MCP_CALL' then 'MCP_SERVER' when 'API_CALL' then 'API' end else true end) is true
 and (case when canonical_target_state='KNOWN' then target_state='KNOWN' and target_org=organisation_id and target_object_kind=target_kind and target_proof_provider=target_provider and target_external_id=target_reference else true end) is true
 and (case when duration_basis='START_END_DIFFERENCE' then ended_nano_state='KNOWN' and duration_value=ended_nano_value-started_nano else true end) is true
 and (case when outcome_basis='OTEL_STATUS' then (source_status='OK' and outcome_state='SUCCESS') or (source_status='ERROR' and outcome_state='ERROR') else true end) is true
 and (case when outcome_basis='HTTP_STATUS' then kind='API_CALL' and http_status_state='KNOWN' and ((http_status_value between 200 and 299 and outcome_state='SUCCESS') or (http_status_value>=400 and outcome_state='FAILURE')) else true end) is true
 and (case when outcome_state='SUCCESS' then source_status<>'ERROR' and error_state='UNKNOWN' else true end) is true
 and (case when http_method_state='KNOWN' or http_status_state='KNOWN' then protocol_state='KNOWN' and protocol_value in ('HTTP','GRAPHQL') else true end) is true
 and (case when tool_reference_state='KNOWN' then operation='tools/call' else true end) is true
 and (case when protocol_result_state='KNOWN' and outcome_basis='DIRECT_RESULT' then (protocol_result_value='SUCCESS' and outcome_state='SUCCESS') or (protocol_result_value='ERROR' and outcome_state in ('ERROR','FAILURE')) else true end) is true
 and (case when sampling_mode='ALWAYS_ON' then sampling_rate=1 else true end) is true
 and (case when error_state='KNOWN' then (error_category='TIMEOUT' and error_code='DEADLINE_EXCEEDED') or (error_category='CANCELLED' and error_code='OPERATION_CANCELLED') or (error_category='TRANSPORT' and error_code='CONNECTION_FAILED') or (error_category='PROTOCOL' and error_code in ('HTTP_ERROR','INVALID_RESPONSE')) or (error_category='PROVIDER' and error_code='PROVIDER_REJECTED') or (error_category='APPLICATION' and error_code='OPERATION_FAILED') else true end) is true
 and (case when derived_state='KNOWN' then target_state='KNOWN' and reported_model_state='KNOWN' and pricing_provider=target_provider and pricing_model=reported_model_value and tokens_input_state='KNOWN' and tokens_output_state='KNOWN' and usage_input=tokens_input_value and usage_output=tokens_output_value and started_nano::numeric>=extract(epoch from pricing_from)*1000000000 and (pricing_until_state='UNKNOWN' or (pricing_until_value>pricing_from and started_nano::numeric<extract(epoch from pricing_until_value)*1000000000)) and derived_amount=gov_repo.runtime_round_cost(usage_input*input_rate+usage_output*output_rate) else true end) is true
 and (cardinality(limitations)=(select count(distinct v) from unnest(limitations) v)) is true
 and (received_at is null or (isfinite(received_at) and extract(year from received_at at time zone 'UTC') between -1 and 9999 and date_trunc('milliseconds',received_at)=received_at)) is true
 and (pricing_from is null or (isfinite(pricing_from) and extract(year from pricing_from at time zone 'UTC') between -1 and 9999 and date_trunc('milliseconds',pricing_from)=pricing_from)) is true
 and (pricing_until_value is null or (isfinite(pricing_until_value) and extract(year from pricing_until_value at time zone 'UTC') between -1 and 9999 and date_trunc('milliseconds',pricing_until_value)=pricing_until_value)) is true
 from (select o.*) v;
$$;
alter table gov_repo.runtime_observations add constraint runtime_observation_semantics check(gov_repo.runtime_valid_observation(runtime_observations) is true);

-- Typed equality, no digest-only proof. Receipt/recording and newly assigned
-- observation IDs do not reinterpret an already-durable event. Limitations are
-- a duplicate-free closed set; their transport ordering has no semantic effect.
create function gov_repo.runtime_same_observation(a gov_repo.runtime_observations,b gov_repo.runtime_observations) returns boolean
language sql immutable security invoker set search_path=pg_catalog as $$
 select
 a.organisation_id is not distinct from b.organisation_id
 and a.connection_id is not distinct from b.connection_id
 and a.connection_system is not distinct from b.connection_system
 and a.source_system_id is not distinct from b.source_system_id
 and a.provider_code is not distinct from b.provider_code
 and a.configuration_version is not distinct from b.configuration_version
 and a.trace_id is not distinct from b.trace_id
 and a.span_id is not distinct from b.span_id
 and a.source_event_key is not distinct from b.source_event_key
 and a.parent_state is not distinct from b.parent_state
 and a.parent_reason is not distinct from b.parent_reason
 and a.parent_span_id is not distinct from b.parent_span_id
 and a.started_nano is not distinct from b.started_nano
 and a.ended_nano_state is not distinct from b.ended_nano_state
 and a.ended_nano_reason is not distinct from b.ended_nano_reason
 and a.ended_nano_value is not distinct from b.ended_nano_value
 and a.source_observed_nano_state is not distinct from b.source_observed_nano_state
 and a.source_observed_nano_reason is not distinct from b.source_observed_nano_reason
 and a.source_observed_nano_value is not distinct from b.source_observed_nano_value
 and a.kind is not distinct from b.kind
 and a.operation is not distinct from b.operation
 and a.execution_scope is not distinct from b.execution_scope
 and a.binding_state is not distinct from b.binding_state
 and a.unresolved_reason is not distinct from b.unresolved_reason
 and a.producer_identity is not distinct from b.producer_identity
 and a.deployment_state is not distinct from b.deployment_state
 and a.deployment_reason is not distinct from b.deployment_reason
 and a.deployment_value is not distinct from b.deployment_value
 and a.artifact_state is not distinct from b.artifact_state
 and a.artifact_reason is not distinct from b.artifact_reason
 and a.artifact_value is not distinct from b.artifact_value
 and a.agent_version_id is not distinct from b.agent_version_id
 and a.agent_version_org is not distinct from b.agent_version_org
 and a.agent_version_kind is not distinct from b.agent_version_kind
 and a.binding_id is not distinct from b.binding_id
 and a.binding_org is not distinct from b.binding_org
 and a.binding_connection is not distinct from b.binding_connection
 and a.binding_method is not distinct from b.binding_method
 and a.binding_version is not distinct from b.binding_version
 and a.target_state is not distinct from b.target_state
 and a.target_reason is not distinct from b.target_reason
 and a.target_kind is not distinct from b.target_kind
 and a.target_provider is not distinct from b.target_provider
 and a.target_reference is not distinct from b.target_reference
 and a.canonical_target_state is not distinct from b.canonical_target_state
 and a.canonical_target_reason is not distinct from b.canonical_target_reason
 and a.target_object_id is not distinct from b.target_object_id
 and a.target_org is not distinct from b.target_org
 and a.target_object_kind is not distinct from b.target_object_kind
 and a.target_proof_method is not distinct from b.target_proof_method
 and a.target_proof_version is not distinct from b.target_proof_version
 and a.target_mapping_id is not distinct from b.target_mapping_id
 and a.target_proof_provider is not distinct from b.target_proof_provider
 and a.target_source_connection is not distinct from b.target_source_connection
 and a.target_external_type is not distinct from b.target_external_type
 and a.target_external_id is not distinct from b.target_external_id
 and a.source_status is not distinct from b.source_status
 and a.outcome_state is not distinct from b.outcome_state
 and a.outcome_reason is not distinct from b.outcome_reason
 and a.outcome_basis is not distinct from b.outcome_basis
 and a.duration_state is not distinct from b.duration_state
 and a.duration_reason is not distinct from b.duration_reason
 and a.duration_value is not distinct from b.duration_value
 and a.duration_unit is not distinct from b.duration_unit
 and a.duration_basis is not distinct from b.duration_basis
 and a.duration_method is not distinct from b.duration_method
 and a.duration_version is not distinct from b.duration_version
 and a.error_state is not distinct from b.error_state
 and a.error_reason is not distinct from b.error_reason
 and a.error_category is not distinct from b.error_category
 and a.error_code is not distinct from b.error_code
 and a.reported_model_state is not distinct from b.reported_model_state
 and a.reported_model_reason is not distinct from b.reported_model_reason
 and a.reported_model_value is not distinct from b.reported_model_value
 and a.token_unit is not distinct from b.token_unit
 and a.tokens_input_state is not distinct from b.tokens_input_state
 and a.tokens_input_reason is not distinct from b.tokens_input_reason
 and a.tokens_input_value is not distinct from b.tokens_input_value
 and a.tokens_output_state is not distinct from b.tokens_output_state
 and a.tokens_output_reason is not distinct from b.tokens_output_reason
 and a.tokens_output_value is not distinct from b.tokens_output_value
 and a.tokens_total_state is not distinct from b.tokens_total_state
 and a.tokens_total_reason is not distinct from b.tokens_total_reason
 and a.tokens_total_value is not distinct from b.tokens_total_value
 and a.supplied_state is not distinct from b.supplied_state
 and a.supplied_reason is not distinct from b.supplied_reason
 and a.supplied_kind is not distinct from b.supplied_kind
 and a.supplied_amount is not distinct from b.supplied_amount
 and a.supplied_currency is not distinct from b.supplied_currency
 and a.supplied_scope is not distinct from b.supplied_scope
 and a.supplied_evidence_org is not distinct from b.supplied_evidence_org
 and a.supplied_evidence_connection is not distinct from b.supplied_evidence_connection
 and a.charge_reference is not distinct from b.charge_reference
 and a.derived_state is not distinct from b.derived_state
 and a.derived_reason is not distinct from b.derived_reason
 and a.derived_kind is not distinct from b.derived_kind
 and a.derived_amount is not distinct from b.derived_amount
 and a.derived_currency is not distinct from b.derived_currency
 and a.derived_scope is not distinct from b.derived_scope
 and a.pricing_source is not distinct from b.pricing_source
 and a.pricing_version is not distinct from b.pricing_version
 and a.pricing_provider is not distinct from b.pricing_provider
 and a.pricing_model is not distinct from b.pricing_model
 and a.pricing_tier is not distinct from b.pricing_tier
 and a.pricing_from is not distinct from b.pricing_from
 and a.pricing_until_state is not distinct from b.pricing_until_state
 and a.pricing_until_reason is not distinct from b.pricing_until_reason
 and a.pricing_until_value is not distinct from b.pricing_until_value
 and a.input_rate is not distinct from b.input_rate
 and a.output_rate is not distinct from b.output_rate
 and a.rate_unit is not distinct from b.rate_unit
 and a.input_coverage is not distinct from b.input_coverage
 and a.output_coverage is not distinct from b.output_coverage
 and a.adjustments is not distinct from b.adjustments
 and a.usage_unit is not distinct from b.usage_unit
 and a.usage_input is not distinct from b.usage_input
 and a.usage_output is not distinct from b.usage_output
 and a.calculation_method is not distinct from b.calculation_method
 and a.calculation_version is not distinct from b.calculation_version
 and a.rounding is not distinct from b.rounding
 and a.decimal_places is not distinct from b.decimal_places
 and a.rounding_stage is not distinct from b.rounding_stage
 and a.principal_state is not distinct from b.principal_state
 and a.principal_reason is not distinct from b.principal_reason
 and a.principal_kind is not distinct from b.principal_kind
 and a.principal_provider is not distinct from b.principal_provider
 and a.principal_authority is not distinct from b.principal_authority
 and a.principal_reference is not distinct from b.principal_reference
 and a.principal_evidence_org is not distinct from b.principal_evidence_org
 and a.principal_evidence_connection is not distinct from b.principal_evidence_connection
 and a.principal_method is not distinct from b.principal_method
 and a.principal_version is not distinct from b.principal_version
 and a.environment_state is not distinct from b.environment_state
 and a.environment_reason is not distinct from b.environment_reason
 and a.environment_value is not distinct from b.environment_value
 and a.environment_evidence_org is not distinct from b.environment_evidence_org
 and a.environment_evidence_connection is not distinct from b.environment_evidence_connection
 and a.environment_method is not distinct from b.environment_method
 and a.environment_version is not distinct from b.environment_version
 and a.network_state is not distinct from b.network_state
 and a.network_reason is not distinct from b.network_reason
 and a.network_reference is not distinct from b.network_reference
 and a.vpc_state is not distinct from b.vpc_state
 and a.vpc_reason is not distinct from b.vpc_reason
 and a.vpc_value is not distinct from b.vpc_value
 and a.network_evidence_org is not distinct from b.network_evidence_org
 and a.network_evidence_connection is not distinct from b.network_evidence_connection
 and a.network_method is not distinct from b.network_method
 and a.network_version is not distinct from b.network_version
 and a.trust_state is not distinct from b.trust_state
 and a.provenance_org is not distinct from b.provenance_org
 and a.provenance_connection is not distinct from b.provenance_connection
 and a.method_code is not distinct from b.method_code
 and a.method_version is not distinct from b.method_version
 and a.adapter_version is not distinct from b.adapter_version
 and a.schema_version is not distinct from b.schema_version
 and a.mapping_version is not distinct from b.mapping_version
 and a.instrumentation_name is not distinct from b.instrumentation_name
 and a.instrumentation_version is not distinct from b.instrumentation_version
 and a.sdk_name is not distinct from b.sdk_name
 and a.sdk_version is not distinct from b.sdk_version
 and a.trace_revision is not distinct from b.trace_revision
 and a.http_revision_state is not distinct from b.http_revision_state
 and a.http_revision_reason is not distinct from b.http_revision_reason
 and a.http_revision_value is not distinct from b.http_revision_value
 and a.genai_revision_state is not distinct from b.genai_revision_state
 and a.genai_revision_reason is not distinct from b.genai_revision_reason
 and a.mcp_revision_state is not distinct from b.mcp_revision_state
 and a.mcp_revision_reason is not distinct from b.mcp_revision_reason
 and a.sampling_state is not distinct from b.sampling_state
 and a.sampling_reason is not distinct from b.sampling_reason
 and a.sampling_mode is not distinct from b.sampling_mode
 and a.sampling_rate is not distinct from b.sampling_rate
 and a.sampled_state is not distinct from b.sampled_state
 and a.sampled_reason is not distinct from b.sampled_reason
 and a.sampled_value is not distinct from b.sampled_value
 and a.dropped_attributes_state is not distinct from b.dropped_attributes_state
 and a.dropped_attributes_reason is not distinct from b.dropped_attributes_reason
 and a.dropped_attributes_value is not distinct from b.dropped_attributes_value
 and a.dropped_events_state is not distinct from b.dropped_events_state
 and a.dropped_events_reason is not distinct from b.dropped_events_reason
 and a.dropped_events_value is not distinct from b.dropped_events_value
 and a.dropped_links_state is not distinct from b.dropped_links_state
 and a.dropped_links_reason is not distinct from b.dropped_links_reason
 and a.dropped_links_value is not distinct from b.dropped_links_value
 and a.collection_scope is not distinct from b.collection_scope
 and (a.limitations @> b.limitations and a.limitations <@ b.limitations)
 and a.transport_state is not distinct from b.transport_state
 and a.transport_reason is not distinct from b.transport_reason
 and a.transport_value is not distinct from b.transport_value
 and a.tool_reference_state is not distinct from b.tool_reference_state
 and a.tool_reference_reason is not distinct from b.tool_reference_reason
 and a.tool_reference_value is not distinct from b.tool_reference_value
 and a.protocol_result_state is not distinct from b.protocol_result_state
 and a.protocol_result_reason is not distinct from b.protocol_result_reason
 and a.protocol_result_value is not distinct from b.protocol_result_value
 and a.protocol_state is not distinct from b.protocol_state
 and a.protocol_reason is not distinct from b.protocol_reason
 and a.protocol_value is not distinct from b.protocol_value
 and a.http_method_state is not distinct from b.http_method_state
 and a.http_method_reason is not distinct from b.http_method_reason
 and a.http_method_value is not distinct from b.http_method_value
 and a.http_status_state is not distinct from b.http_status_state
 and a.http_status_reason is not distinct from b.http_status_reason
 and a.http_status_value is not distinct from b.http_status_value;
$$;
create function gov_repo.runtime_readback(o gov_repo.runtime_observations) returns jsonb
language sql stable security invoker set search_path=pg_catalog as $$
 select to_jsonb(o) || jsonb_build_object(
 'started_nano',o.started_nano::text,
 'received_at',gov_repo.runtime_iso(o.received_at),
 'duration_value',o.duration_value::text,
 'supplied_amount',o.supplied_amount::text,
 'derived_amount',o.derived_amount::text,
 'pricing_from',gov_repo.runtime_iso(o.pricing_from),
 'pricing_until_value',gov_repo.runtime_iso(o.pricing_until_value),
 'input_rate',o.input_rate::text,
 'output_rate',o.output_rate::text);
$$;
create function gov_repo.admit_runtime_observation(p_organisation_id uuid,p_connection_id text,p_observation gov_repo.runtime_observations)
returns table(replay boolean,observation jsonb)
language plpgsql security definer set search_path=pg_catalog as $$
declare old_observation gov_repo.runtime_observations%rowtype; h gov_repo.runtime_source_heads%rowtype;
 cfg gov_repo.runtime_source_configurations%rowtype; b gov_repo.runtime_deployment_bindings%rowtype;
 required_facts gov_repo.runtime_fact[]:='{}'; current_count bigint; safe_code text;
begin
 if p_observation.organisation_id is distinct from p_organisation_id or p_observation.connection_id is distinct from p_connection_id
 or p_observation.recorded_at is not null or not gov_repo.runtime_valid_observation(p_observation)
 then raise exception 'RUNTIME_OBSERVATION_INVALID'; end if;
 perform gov_repo.runtime_lock(p_organisation_id,p_connection_id);
 select * into old_observation from gov_repo.runtime_observations
 where organisation_id=p_organisation_id and connection_id=p_connection_id and trace_id=p_observation.trace_id and span_id=p_observation.span_id;
 if found then
  if not gov_repo.runtime_same_observation(old_observation,p_observation) then raise exception 'RUNTIME_REPLAY_CONFLICT'; end if;
  return query select true,gov_repo.runtime_readback(old_observation); return;
 end if;
 select * into strict h from gov_repo.runtime_source_heads where organisation_id=p_organisation_id and connection_id=p_connection_id;
 if not h.active then raise exception 'RUNTIME_SOURCE_INACTIVE'; end if;
 if h.current_configuration_version is distinct from p_observation.configuration_version then raise exception 'RUNTIME_CONFIGURATION_MISMATCH'; end if;
 select * into strict cfg from gov_repo.runtime_source_configurations where organisation_id=p_organisation_id
 and connection_id=p_connection_id and configuration_version=p_observation.configuration_version;
 if (p_observation.source_system_id,p_observation.provider_code,p_observation.producer_identity,
 p_observation.instrumentation_name,p_observation.instrumentation_version,p_observation.sdk_name,p_observation.sdk_version,
 p_observation.method_code,p_observation.method_version,p_observation.adapter_version,p_observation.schema_version,p_observation.mapping_version)
 is distinct from (cfg.source_system_id,cfg.provider_code,cfg.producer_identity,cfg.instrumentation_name,cfg.instrumentation_version,cfg.sdk_name,cfg.sdk_version,
 cfg.method_code,cfg.method_version,cfg.adapter_version,cfg.schema_version,cfg.mapping_version)
 or not (p_observation.kind::gov_repo.runtime_kind=any(cfg.supported_kinds)) then raise exception 'RUNTIME_SOURCE_MISMATCH'; end if;
 if clock_timestamp()<cfg.admission_from or clock_timestamp()>=cfg.admission_until then raise exception 'RUNTIME_ADMISSION_WINDOW_CLOSED'; end if;
 -- Limit sanitized RPC work; max_batch_size is for the future ingestion adapter.
 if octet_length(to_jsonb(p_observation)::text)>cfg.max_payload_bytes then raise exception 'RUNTIME_PAYLOAD_LIMIT'; end if;
 -- Quota counts immutable rows across configuration versions; rotation never resets it.
 select count(*) into current_count from gov_repo.runtime_observations where organisation_id=p_organisation_id and connection_id=p_connection_id;
 if current_count>=cfg.max_observations then raise exception 'RUNTIME_QUOTA_EXHAUSTED'; end if;
 if p_observation.ended_nano_state='KNOWN' then required_facts:=array_append(required_facts,'END_TIME'::gov_repo.runtime_fact); end if;
 if p_observation.source_observed_nano_state='KNOWN' then required_facts:=array_append(required_facts,'SOURCE_TIME'::gov_repo.runtime_fact); end if;
 if p_observation.parent_state<>'UNKNOWN' then required_facts:=array_append(required_facts,'PARENT'::gov_repo.runtime_fact); end if;
 if p_observation.target_state='KNOWN' or p_observation.reported_model_state='KNOWN' then required_facts:=array_append(required_facts,'TARGET'::gov_repo.runtime_fact); end if;
 if p_observation.canonical_target_state='KNOWN' then required_facts:=array_append(required_facts,'CANONICAL_TARGET'::gov_repo.runtime_fact); end if;
 if p_observation.binding_state='EXACT' then required_facts:=array_append(required_facts,'EXACT_BINDING'::gov_repo.runtime_fact); end if;
 if p_observation.outcome_state<>'UNKNOWN' then required_facts:=array_append(required_facts,'OUTCOME'::gov_repo.runtime_fact); end if;
 if p_observation.duration_state='KNOWN' then required_facts:=array_append(required_facts,'DURATION'::gov_repo.runtime_fact); end if;
 if p_observation.error_state='KNOWN' then required_facts:=array_append(required_facts,'ERROR'::gov_repo.runtime_fact); end if;
 if p_observation.tokens_input_state='KNOWN' or p_observation.tokens_output_state='KNOWN' or p_observation.tokens_total_state='KNOWN' then required_facts:=array_append(required_facts,'TOKENS'::gov_repo.runtime_fact); end if;
 if p_observation.supplied_state='KNOWN' then required_facts:=array_append(required_facts,'SUPPLIED_COST'::gov_repo.runtime_fact); end if;
 if p_observation.derived_state='KNOWN' then required_facts:=array_append(required_facts,'DERIVED_COST'::gov_repo.runtime_fact); end if;
 if p_observation.principal_state='KNOWN' then required_facts:=array_append(required_facts,'PRINCIPAL'::gov_repo.runtime_fact); end if;
 if p_observation.environment_state='KNOWN' then required_facts:=array_append(required_facts,'ENVIRONMENT'::gov_repo.runtime_fact); end if;
 if p_observation.network_state='KNOWN' then required_facts:=array_append(required_facts,'NETWORK'::gov_repo.runtime_fact); end if;
 if p_observation.sampling_state='KNOWN' or p_observation.sampled_state='KNOWN' then required_facts:=array_append(required_facts,'SAMPLING'::gov_repo.runtime_fact); end if;
 if p_observation.dropped_attributes_state='KNOWN' or p_observation.dropped_events_state='KNOWN' or p_observation.dropped_links_state='KNOWN' then required_facts:=array_append(required_facts,'DROPPED_COUNTS'::gov_repo.runtime_fact); end if;
 if p_observation.protocol_state='KNOWN' or p_observation.http_method_state='KNOWN' or p_observation.http_status_state='KNOWN' or p_observation.transport_state='KNOWN' or p_observation.tool_reference_state='KNOWN' or p_observation.protocol_result_state='KNOWN' then required_facts:=array_append(required_facts,'PROTOCOL'::gov_repo.runtime_fact); end if;
 if not (required_facts <@ cfg.supported_facts) then raise exception 'RUNTIME_FACT_UNSUPPORTED'; end if;
 if (p_observation.target_state='KNOWN' and (not(p_observation.target_reference=any(cfg.approved_target_references)) or not(p_observation.target_provider=any(cfg.approved_target_providers))))
 or (p_observation.reported_model_state='KNOWN' and not(p_observation.reported_model_value=any(cfg.approved_model_references)))
 or (p_observation.deployment_state='KNOWN' and not(p_observation.deployment_value=any(cfg.approved_deployments)))
 or (p_observation.supplied_state='KNOWN' and not(p_observation.charge_reference=any(cfg.approved_charge_references)))
 or (p_observation.derived_state='KNOWN' and not(p_observation.pricing_source=any(cfg.approved_pricing_references)))
 or (p_observation.principal_state='KNOWN' and (not(p_observation.principal_reference=any(cfg.approved_principal_references)) or not(p_observation.principal_authority=any(cfg.approved_authority_references)) or not(p_observation.principal_provider=any(cfg.approved_target_providers))))
 or (p_observation.network_state='KNOWN' and not(p_observation.network_reference=any(cfg.approved_network_references)))
 or (p_observation.vpc_state='KNOWN' and not(p_observation.vpc_value=any(cfg.approved_network_references)))
 or (p_observation.tool_reference_state='KNOWN' and not(p_observation.tool_reference_value=any(cfg.approved_target_references)))
 then raise exception 'RUNTIME_COORDINATE_NOT_APPROVED'; end if;
 if p_observation.binding_state='EXACT' then
  select * into strict b from gov_repo.runtime_deployment_bindings where organisation_id=p_organisation_id
   and connection_id=p_connection_id and binding_id=p_observation.binding_id;
  if (b.producer_identity,b.deployment_reference,b.artifact_digest,b.agent_version_id,b.proof_method,b.proof_version)
   is distinct from (p_observation.producer_identity,p_observation.deployment_value,p_observation.artifact_value,p_observation.agent_version_id,p_observation.binding_method,p_observation.binding_version)
  then raise exception 'RUNTIME_BINDING_INVALID'; end if;
 end if;
 if p_observation.canonical_target_state='KNOWN' and not exists(
  select 1 from gov_repo.canonical_normalized_object_mappings m
  join gov_repo.discovery_candidates c on c.organisation_id=m.organisation_id and c.candidate_id=m.candidate_id
  join gov_repo.acquisition_runs r on r.organisation_id=c.organisation_id and r.run_id=c.acquisition_run_id
  join gov_repo.reconciliation_decisions d on d.organisation_id=m.organisation_id and d.decision_id=m.created_by_decision_id
  where m.organisation_id=p_organisation_id and m.mapping_id=p_observation.target_mapping_id
  and m.canonical_object_id=p_observation.target_object_id and m.canonical_object_kind=p_observation.target_object_kind
  and m.source_connection_id=p_observation.target_source_connection and m.source_external_type=p_observation.target_external_type
  and m.source_external_id=p_observation.target_external_id and c.candidate_kind=m.canonical_object_kind
  and c.source_connection_id=m.source_connection_id and c.source_external_type=m.source_external_type and c.source_external_id=m.source_external_id
  and m.normalized_object_identity=gov_repo.normalized_object_identity(p_organisation_id,c.envelope)
  and r.source_connection_id=m.source_connection_id
  and d.family='OBJECT' and d.outcome in ('CREATE_NEW','MATCH_EXISTING') and d.authority_kind='HUMAN'
  and d.subject_candidate_id=c.candidate_id and d.canonical_object_id=m.canonical_object_id and d.canonical_object_kind=m.canonical_object_kind
 ) then raise exception 'RUNTIME_TARGET_INVALID'; end if;
 p_observation.recorded_at:=date_trunc('milliseconds',clock_timestamp());
 insert into gov_repo.runtime_observations select p_observation.*;
 return query select false,gov_repo.runtime_readback(p_observation);
exception when others then
 get stacked diagnostics safe_code=MESSAGE_TEXT;
 if safe_code in ('RUNTIME_REPLAY_CONFLICT','RUNTIME_SOURCE_INACTIVE','RUNTIME_CONFIGURATION_MISMATCH','RUNTIME_SOURCE_MISMATCH',
 'RUNTIME_ADMISSION_WINDOW_CLOSED','RUNTIME_PAYLOAD_LIMIT','RUNTIME_QUOTA_EXHAUSTED','RUNTIME_FACT_UNSUPPORTED','RUNTIME_COORDINATE_NOT_APPROVED',
 'RUNTIME_BINDING_INVALID','RUNTIME_TARGET_INVALID','RUNTIME_OBSERVATION_INVALID') then raise exception '%',safe_code; end if;
 raise exception 'RUNTIME_ADMISSION_REJECTED';
end;
$$;

-- No direct DML, including service_role with BYPASSRLS. RPC ownership is the
-- existing migration owner; privileges, constraints and immutable triggers are independent.
alter table gov_repo.runtime_source_heads enable row level security;
alter table gov_repo.runtime_source_configurations enable row level security;
alter table gov_repo.runtime_deployment_bindings enable row level security;
alter table gov_repo.runtime_observations enable row level security;
grant usage on schema gov_repo to service_role;
revoke all on gov_repo.runtime_source_heads,gov_repo.runtime_source_configurations,gov_repo.runtime_deployment_bindings,gov_repo.runtime_observations from public,anon,authenticated,service_role;
create trigger runtime_configuration_immutable before update or delete on gov_repo.runtime_source_configurations for each row execute function gov_repo.runtime_immutable();
create trigger runtime_binding_immutable before update or delete on gov_repo.runtime_deployment_bindings for each row execute function gov_repo.runtime_immutable();
create trigger runtime_observation_immutable before update or delete on gov_repo.runtime_observations for each row execute function gov_repo.runtime_immutable();
create trigger runtime_source_no_delete before delete on gov_repo.runtime_source_heads for each row execute function gov_repo.runtime_immutable();
create function gov_repo.runtime_source_identity_immutable() returns trigger
language plpgsql security invoker set search_path=pg_catalog as $$
begin
 if (new.organisation_id,new.connection_id,new.source_system_id,new.provider_code,new.producer_identity,new.created_by,new.created_at)
 is distinct from (old.organisation_id,old.connection_id,old.source_system_id,old.provider_code,old.producer_identity,old.created_by,old.created_at)
 then raise exception 'RUNTIME_SOURCE_IDENTITY_IMMUTABLE'; end if;
 perform gov_repo.runtime_lock(old.organisation_id,old.connection_id);
 return new;
end;
$$;
create trigger runtime_source_identity before update on gov_repo.runtime_source_heads for each row execute function gov_repo.runtime_source_identity_immutable();
revoke all on function gov_repo.runtime_iso(timestamptz) from public,anon,authenticated,service_role;
revoke all on function gov_repo.runtime_lock(uuid,text) from public,anon,authenticated,service_role;
revoke all on function gov_repo.runtime_immutable() from public,anon,authenticated,service_role;
revoke all on function gov_repo.register_runtime_source(uuid,gov_repo.runtime_reference,gov_repo.runtime_reference,gov_repo.runtime_reference,gov_repo.runtime_reference,gov_repo.runtime_reference) from public,anon,authenticated,service_role;
revoke all on function gov_repo.configure_runtime_source(uuid,text,gov_repo.runtime_source_configurations) from public,anon,authenticated,service_role;
revoke all on function gov_repo.activate_runtime_source(uuid,text,text,boolean,gov_repo.runtime_reference) from public,anon,authenticated,service_role;
revoke all on function gov_repo.register_runtime_binding(uuid,text,gov_repo.runtime_deployment_bindings) from public,anon,authenticated,service_role;
revoke all on function gov_repo.runtime_round_cost(numeric) from public,anon,authenticated,service_role;
revoke all on function gov_repo.runtime_valid_observation(gov_repo.runtime_observations) from public,anon,authenticated,service_role;
revoke all on function gov_repo.runtime_same_observation(gov_repo.runtime_observations,gov_repo.runtime_observations) from public,anon,authenticated,service_role;
revoke all on function gov_repo.runtime_readback(gov_repo.runtime_observations) from public,anon,authenticated,service_role;
revoke all on function gov_repo.admit_runtime_observation(uuid,text,gov_repo.runtime_observations) from public,anon,authenticated,service_role;
grant execute on function gov_repo.admit_runtime_observation(uuid,text,gov_repo.runtime_observations) to service_role;
revoke all on function gov_repo.runtime_source_identity_immutable() from public,anon,authenticated,service_role;
commit;
