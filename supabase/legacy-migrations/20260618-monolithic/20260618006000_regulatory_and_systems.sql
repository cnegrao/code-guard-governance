-- =============================================================================
-- CODEGUARD AI GOVERNANCE OS
-- Migration: 20260618006000_regulatory_and_systems
-- Domain:    AI Systems, Third-Party Risk, Incident Management, Regulatory Changes
-- Depends:   20260618005000_agent_registry_graph
-- =============================================================================
-- Aligns GraphOS with the language of European Regulators:
--   1. AI Systems (AI Act Art. 3, 11, 43) - Systems are regulated, not just agents.
--   2. Third Party Providers (DORA Art. 28) - ICT concentration risk.
--   3. ICT Incidents (DORA Art. 19) - Operational resilience.
--   4. AI Serious Incidents (AI Act Art. 73) - Health, safety, fundamental rights.
--   5. Regulatory Change Engine - Change tracking.
-- =============================================================================

-- ─── ENUM TYPES ──────────────────────────────────────────────────────────────

create type gov_repo.system_status as enum (
  'development',
  'testing',
  'production',
  'decommissioned'
);

create type gov_repo.dora_criticality as enum (
  'critical',     -- Subject to direct EU oversight under DORA
  'high',
  'medium',
  'low'
);

create type gov_repo.incident_severity as enum (
  'critical',     -- Major ICT incident (DORA) or Serious Incident (AI Act)
  'high',
  'medium',
  'low'
);

create type gov_repo.incident_status as enum (
  'reported',
  'investigating',
  'mitigated',
  'resolved',
  'closed'
);

create type gov_repo.serious_incident_type as enum (
  'health_safety',
  'fundamental_rights',
  'property_damage',
  'critical_infrastructure',
  'other'
);

create type gov_repo.provider_service_type as enum (
  'cloud_infrastructure',
  'foundation_model_api',
  'saas_platform',
  'data_provider',
  'managed_service'
);

create type gov_repo.reg_change_status as enum (
  'identified',
  'impact_assessed',
  'implementation_plan',
  'implementing',
  'compliant',
  'closed'
);

-- =============================================================================
-- TABLE 1: AI_SYSTEMS (AI Act Art. 3, 11, 43)
-- =============================================================================
create table gov_repo.ai_systems (
  system_id             uuid          primary key default uuid_generate_v4(),
  system_code           varchar(20)   not null,
  name                  varchar(255)  not null,
  description           text          not null,
  intended_purpose      text          not null, -- Crucial for AI Act
  
  risk_class            gov_repo.ai_act_risk_class not null default 'minimal',
  status                gov_repo.system_status not null default 'development',
  
  owner_user_id         uuid          not null references gov_repo.governance_users (user_id),
  business_domain       varchar(100),
  
  -- Conformity
  eu_ai_db_registered   boolean       not null default false,
  eu_ai_db_ref          varchar(100),
  conformity_assessment_id uuid       references gov_repo.conformity_assessments (assessment_id),
  
  organisation_id       uuid          not null references gov_repo.organisations (organisation_id),
  
  ledger_entry_seq      bigint        references gov_repo.governance_ledger (entry_sequence),
  created_at            timestamptz   not null default now(),
  updated_at            timestamptz   not null default now(),
  
  constraint ai_systems_code_org_unique unique (system_code, organisation_id)
);

comment on table gov_repo.ai_systems is
  'AI Systems registry. The EU AI Act regulates at the system level (Art. 3.1), not the agent level.
   An AI System groups multiple agents. Conformity assessments (Art. 43) apply here.';

create index idx_ai_systems_org on gov_repo.ai_systems (organisation_id);
create trigger trg_ai_systems_updated_at before update on gov_repo.ai_systems for each row execute function gov_repo.set_updated_at();

-- Add FK from agents to ai_systems
alter table gov_repo.agents
  add constraint fk_agent_ai_system
  foreign key (ai_system_id) references gov_repo.ai_systems(system_id);


-- =============================================================================
-- TABLE 2: THIRD_PARTY_PROVIDERS (DORA Art. 28)
-- =============================================================================
create table gov_repo.third_party_providers (
  provider_id           uuid          primary key default uuid_generate_v4(),
  provider_code         varchar(20)   not null,
  name                  varchar(255)  not null,
  service_type          gov_repo.provider_service_type not null,
  
  dora_criticality      gov_repo.dora_criticality not null default 'medium',
  
  -- Jurisdiction and sovereignty
  headquarters_country  varchar(2)    not null, -- ISO 3166-1 alpha-2
  data_processing_regions text[]      not null default '{}',
  
  -- Vendor Management
  status                varchar(30)   not null default 'active' check (status in ('under_review','active','suspended','terminated')),
  contract_ref          varchar(100),
  contract_expires_at   date,
  
  exit_plan_documented  boolean       not null default false,
  concentration_risk_score numeric(4,2), -- Internal score 0-10
  
  organisation_id       uuid          not null references gov_repo.organisations (organisation_id),
  
  created_at            timestamptz   not null default now(),
  updated_at            timestamptz   not null default now(),
  
  constraint providers_code_org_unique unique (provider_code, organisation_id)
);

comment on table gov_repo.third_party_providers is
  'ICT Third-Party Service Providers registry. Mandatory under DORA Art. 28.
   Tracks concentration risk, sovereignty (data regions), and DORA criticality.';

create index idx_third_party_org on gov_repo.third_party_providers (organisation_id);
create trigger trg_third_party_updated_at before update on gov_repo.third_party_providers for each row execute function gov_repo.set_updated_at();

-- Link agent resources to providers
alter table gov_repo.agent_resource_links
  add column provider_id uuid references gov_repo.third_party_providers(provider_id);

-- =============================================================================
-- TABLE 3: ICT_INCIDENTS (DORA Art. 19)
-- =============================================================================
create table gov_repo.ict_incidents (
  incident_id           uuid          primary key default uuid_generate_v4(),
  incident_code         varchar(20)   not null,
  title                 varchar(255)  not null,
  description           text          not null,
  
  severity              gov_repo.incident_severity not null,
  status                gov_repo.incident_status not null default 'reported',
  
  -- Linkages
  impacted_system_ids   uuid[]        not null default '{}',
  impacted_agent_ids    uuid[]        not null default '{}',
  impacted_provider_ids uuid[]        not null default '{}',
  
  -- Impact metrics
  downtime_minutes      integer       default 0,
  financial_impact_eur  numeric(12,2) default 0,
  data_breach_involved  boolean       not null default false,
  
  -- Root cause
  root_cause            text,
  remediation_plan      text,
  
  reported_at           timestamptz   not null default now(),
  resolved_at           timestamptz,
  reported_by           uuid          references gov_repo.governance_users (user_id),
  
  organisation_id       uuid          not null references gov_repo.organisations (organisation_id),
  
  created_at            timestamptz   not null default now(),
  updated_at            timestamptz   not null default now(),
  
  constraint ict_incidents_code_org_unique unique (incident_code, organisation_id)
);

comment on table gov_repo.ict_incidents is
  'Major ICT-related incidents tracking (DORA Art. 19).
   Focus is on availability, integrity, confidentiality, and financial/operational impact.';

create index idx_ict_incidents_org on gov_repo.ict_incidents (organisation_id);
create trigger trg_ict_incidents_updated_at before update on gov_repo.ict_incidents for each row execute function gov_repo.set_updated_at();


-- =============================================================================
-- TABLE 4: AI_SERIOUS_INCIDENTS (AI Act Art. 73)
-- =============================================================================
create table gov_repo.ai_serious_incidents (
  incident_id           uuid          primary key default uuid_generate_v4(),
  incident_code         varchar(20)   not null,
  title                 varchar(255)  not null,
  description           text          not null,
  
  severity              gov_repo.incident_severity not null,
  incident_type         gov_repo.serious_incident_type not null,
  status                gov_repo.incident_status not null default 'reported',
  
  system_id             uuid          not null references gov_repo.ai_systems (system_id),
  agent_id              uuid          references gov_repo.agents (agent_id),
  
  -- Regulatory Reporting (Art. 73: max 15 days)
  regulatory_reported   boolean       not null default false,
  reported_to_authority_at timestamptz,
  deadline_for_reporting timestamptz,
  
  -- Remediation
  root_cause_analysis   text,
  mitigating_actions    text,
  
  occurred_at           timestamptz   not null,
  reported_at           timestamptz   not null default now(),
  reported_by           uuid          references gov_repo.governance_users (user_id),
  
  organisation_id       uuid          not null references gov_repo.organisations (organisation_id),
  
  created_at            timestamptz   not null default now(),
  updated_at            timestamptz   not null default now(),
  
  constraint ai_serious_incidents_code_org_unique unique (incident_code, organisation_id)
);

comment on table gov_repo.ai_serious_incidents is
  'AI Serious Incidents (AI Act Art. 73).
   Focus is on harm to health, safety, fundamental rights, or critical infrastructure.
   Mandatory reporting to authorities within 15 days.';

create index idx_ai_serious_incidents_org on gov_repo.ai_serious_incidents (organisation_id);
create trigger trg_ai_serious_incidents_updated_at before update on gov_repo.ai_serious_incidents for each row execute function gov_repo.set_updated_at();


-- =============================================================================
-- TABLE 5: REGULATORY_CHANGES (Change Engine)
-- =============================================================================
create table gov_repo.regulatory_changes (
  change_id             uuid          primary key default uuid_generate_v4(),
  change_code           varchar(20)   not null,
  regulation_name       varchar(100)  not null, -- e.g., 'EU AI Act', 'DORA'
  title                 varchar(255)  not null,
  description           text          not null,
  
  source_url            text,
  impact_level          gov_repo.dora_criticality not null default 'medium',
  status                gov_repo.reg_change_status not null default 'identified',
  
  effective_date        date,
  enforcement_date      date,
  
  owner_user_id         uuid          references gov_repo.governance_users (user_id),
  
  -- Impact mapping
  impacted_policies     uuid[]        not null default '{}',
  impacted_systems      uuid[]        not null default '{}',
  
  organisation_id       uuid          not null references gov_repo.organisations (organisation_id),
  
  created_at            timestamptz   not null default now(),
  updated_at            timestamptz   not null default now(),
  
  constraint reg_changes_code_org_unique unique (change_code, organisation_id)
);

comment on table gov_repo.regulatory_changes is
  'Regulatory Change Management. Tracks new or updated regulations (e.g., AI Act amendments),
   timelines, and links them to internal policies and AI systems that need adaptation.';

create index idx_reg_changes_org on gov_repo.regulatory_changes (organisation_id);
create trigger trg_reg_changes_updated_at before update on gov_repo.regulatory_changes for each row execute function gov_repo.set_updated_at();


-- =============================================================================
-- VIEWS — Operational / Regulatory Lenses
-- =============================================================================

-- View: AI Systems Inventory with Agent Counts
create or replace view gov_repo.v_ai_systems_inventory as
select
  sys.organisation_id,
  sys.system_id,
  sys.system_code,
  sys.name as system_name,
  sys.risk_class,
  sys.status,
  sys.eu_ai_db_registered,
  u.full_name as owner_name,
  (select count(*) from gov_repo.agents a where a.ai_system_id = sys.system_id and a.status != 'decommissioned') as active_agents_count,
  (select count(*) from gov_repo.ai_serious_incidents i where i.system_id = sys.system_id) as total_serious_incidents
from gov_repo.ai_systems sys
left join gov_repo.governance_users u on u.user_id = sys.owner_user_id;

-- View: DORA Third-Party Risk Concentration
create or replace view gov_repo.v_dora_third_party_concentration as
select
  p.organisation_id,
  p.provider_code,
  p.name as provider_name,
  p.service_type,
  p.dora_criticality,
  p.status,
  (select count(*) from gov_repo.agent_resource_links rl where rl.provider_id = p.provider_id and rl.is_active = true) as linked_resources_count,
  (select count(distinct a.ai_system_id) 
   from gov_repo.agent_resource_links rl 
   join gov_repo.agents a on a.agent_id = rl.agent_id
   where rl.provider_id = p.provider_id and rl.is_active = true) as impacted_systems_count
from gov_repo.third_party_providers p;

-- RLS
alter table gov_repo.ai_systems enable row level security;
alter table gov_repo.third_party_providers enable row level security;
alter table gov_repo.ict_incidents enable row level security;
alter table gov_repo.ai_serious_incidents enable row level security;
alter table gov_repo.regulatory_changes enable row level security;

create policy "Service role full access ai_systems" on gov_repo.ai_systems for all to service_role using (true) with check (true);
create policy "Org-scoped ai_systems" on gov_repo.ai_systems for select to authenticated using (organisation_id = (select organisation_id from gov_repo.governance_users where email = auth.email() limit 1));

create policy "Service role full access third_party_providers" on gov_repo.third_party_providers for all to service_role using (true) with check (true);
create policy "Org-scoped third_party_providers" on gov_repo.third_party_providers for select to authenticated using (organisation_id = (select organisation_id from gov_repo.governance_users where email = auth.email() limit 1));

create policy "Service role full access ict_incidents" on gov_repo.ict_incidents for all to service_role using (true) with check (true);
create policy "Org-scoped ict_incidents" on gov_repo.ict_incidents for select to authenticated using (organisation_id = (select organisation_id from gov_repo.governance_users where email = auth.email() limit 1));

create policy "Service role full access ai_serious_incidents" on gov_repo.ai_serious_incidents for all to service_role using (true) with check (true);
create policy "Org-scoped ai_serious_incidents" on gov_repo.ai_serious_incidents for select to authenticated using (organisation_id = (select organisation_id from gov_repo.governance_users where email = auth.email() limit 1));

create policy "Service role full access regulatory_changes" on gov_repo.regulatory_changes for all to service_role using (true) with check (true);
create policy "Org-scoped regulatory_changes" on gov_repo.regulatory_changes for select to authenticated using (organisation_id = (select organisation_id from gov_repo.governance_users where email = auth.email() limit 1));
