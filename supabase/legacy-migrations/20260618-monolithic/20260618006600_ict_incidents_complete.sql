-- =============================================================================
-- CODEGUARD AI GOVERNANCE OS
-- Migration: 20260618006600_ict_incidents_complete
-- Domain:    ICT Incident Management — Full Production Implementation
-- Depends:   20260618005000_agent_registry_graph  (agents, governance_users)
--            20260618004000 (conformity_assessments, evidence)
-- Self-contained: includes M006 + M006500 stub guards — safe to run standalone.
-- Replaces:  gov_repo.ict_incidents stub (20 cols) with complete DORA schema
-- Version:   1.1 — Self-contained guard added
-- =============================================================================
-- Regulatory basis:
--   DORA (EU 2022/2554):
--     Art. 17   — ICT-related incident classification
--     Art. 18   — Classification of ICT-related incidents and cyber threats
--     Art. 19   — Reporting of major ICT-related incidents (4h / 72h / 1-month)
--     Art. 20   — Harmonisation of reporting content and timelines
--     Art. 21   — Voluntary notification of significant cyber threats
--     Art. 24   — General requirements for DORA testing programme
--     RTS on incident classification (EBA/RTS/2023/xx)
--     ITS on reporting templates (EBA/ITS/2023/xx)
--   EU AI Act (2024/1689):
--     Art. 73   — Reporting of serious incidents (provider obligations)
--   ISO/IEC 27001:2022:
--     A.5.24    — Information security incident management planning
--     A.5.25    — Assessment and decision on information security events
--     A.5.26    — Response to information security incidents
--     A.5.27    — Learning from information security incidents
--     A.5.28    — Collection of evidence
--   NIST AI RMF 1.0: RESPOND 1.1, RESPOND 2.1, RESPOND 2.2
--   ISO/IEC 42001:2023: 8.2 (Incident management for AI systems)
-- =============================================================================
-- What this migration does:
--   [C1]  New ENUM types (5 new types, all prefixed to avoid conflicts)
--   [C2]  Expand gov_repo.ict_incidents via ALTER TABLE (55+ new columns, 9 groups)
--   [C3]  New table: gov_repo.ict_incident_timeline   (chronological event log)
--   [C4]  New table: gov_repo.ict_incident_notifications (DORA regulatory reports)
--   [C5]  New table: gov_repo.ict_incident_affected_services (impacted services map)
--   [C6]  Table-level constraints on ict_incidents
--   [C7]  Indexes (ict_incidents: 22 new; child tables: 12)
--   [C8]  Triggers (updated_at already exists; add classification + SLA trigger)
--   [C9]  RLS — existing policies kept; add authenticated read + restricted write
--   [C10] Views (5 views; drop/replace v_ai_systems_inventory stub if needed)
--   [C11] Functions (3 functions)
--   [C12] Mandate seeds (DORA Art. 17-20 + NIST RESPOND)
--   [C13] Grants
-- =============================================================================
-- Naming prefix map (zero conflicts guaranteed):
--   Enums    : gov_repo.dora_incident_category, dora_reporting_phase,
--              ict_function_type, rca_method, recovery_status
--   Indexes  : idx_ict_* (only idx_ict_incidents_org exists — all new use full name)
--   Triggers : trg_ict_inc_* (trg_ict_incidents_updated_at exists — not recreated)
--   Functions: gov_repo.ict_incident_classify(), ict_incident_dora_status(),
--              ict_incident_sla_check()
--   Views    : gov_repo.v_ict_* (none exist yet)
--   Policies : "Authenticated read ict_incidents", "Incident reporters can insert"
-- =============================================================================

-- =============================================================================
-- [C1] NEW ENUM TYPES
-- =============================================================================

-- DORA Art. 18 + EBA RTS on incident classification
-- The RTS defines criteria that determine whether an ICT incident is "major"
-- (triggers mandatory reporting to competent authority under Art. 19).
create type gov_repo.dora_incident_category as enum (
  'cyber_attack',              -- Malicious external/internal attack
  'ransomware',                -- Ransomware — specific DORA category
  'data_breach',               -- Unauthorized data disclosure/access
  'system_failure',            -- Hardware, OS, platform failure
  'software_defect',           -- Bug, regression, configuration error
  'third_party_failure',       -- ICT provider outage/failure (Art. 28)
  'ai_system_failure',         -- AI model drift, hallucination, unexpected output
  'process_failure',           -- Human/process error leading to ICT disruption
  'natural_disaster',          -- Physical event affecting ICT infrastructure
  'supply_chain_attack',       -- Attack via third-party software/hardware supply
  'insider_threat',            -- Malicious/accidental insider action
  'ddos',                      -- Distributed denial-of-service
  'social_engineering',        -- Phishing, vishing, pretexting
  'other'                      -- Not otherwise classified
);

comment on type gov_repo.dora_incident_category is
  'ICT incident category per DORA Art. 18 + EBA RTS on classification criteria.
   ai_system_failure: covers AI-specific incidents — model drift, unexpected outputs,
   bias incidents, autonomy failures. Links to gov_repo.ai_serious_incidents via
   ai_serious_incident_id FK when the incident triggers AI Act Art. 73 obligations.
   third_party_failure: triggers DORA Art. 28 third-party risk review.';

-- DORA Art. 19-20: reporting has three mandatory phases with hard deadlines
create type gov_repo.dora_reporting_phase as enum (
  'not_required',              -- Incident not classified as major; no reporting required
  'initial_notification',      -- Art. 19(4)(a): within 4 hours of major classification
  'intermediate_report',       -- Art. 19(4)(b): within 72 hours
  'final_report',              -- Art. 19(4)(c): within 1 month of initial notification
  'voluntary_notification',    -- Art. 21: voluntary notification of significant cyber threat
  'all_complete'               -- All mandatory reporting phases completed
);

comment on type gov_repo.dora_reporting_phase is
  'DORA Art. 19 reporting lifecycle for major ICT incidents.
   Deadlines (from major classification, not from occurrence):
     initial_notification : 4 hours  (Art. 19(4)(a))
     intermediate_report  : 72 hours (Art. 19(4)(b))
     final_report         : 1 month  (Art. 19(4)(c))
   Competent authority: ECB (significant institutions), national NCA, ESMA, EIOPA.
   EBA single entry point: financial entities report to home NCA.';

-- DORA Art. 8(1): ICT assets supporting critical or important functions
-- Used to classify which services are affected by the incident
create type gov_repo.ict_function_type as enum (
  'critical',                  -- Function whose disruption materially impairs financial stability
  'important',                 -- Function whose disruption significantly impacts business
  'standard',                  -- Supporting function — not critical/important
  'regulatory_reporting',      -- Regulatory and supervisory reporting function
  'customer_facing',           -- Direct customer services
  'payment_settlement',        -- Payment and settlement infrastructure
  'risk_management',           -- Risk management and compliance functions
  'internal_operations'        -- Internal operations — no direct customer/regulatory impact
);

comment on type gov_repo.ict_function_type is
  'ICT function classification per DORA Art. 8(1).
   critical/important: disruption triggers DORA major incident assessment thresholds.
   EBA RTS on classification: incidents affecting critical functions for >2 hours OR
   important functions for >4 hours are presumptively major.
   payment_settlement: any disruption triggers immediate escalation in FSI context.';

-- Root Cause Analysis methodology (ISO 27035 + industry standard)
create type gov_repo.rca_method as enum (
  'five_whys',                 -- Iterative "why" questioning
  'fishbone_ishikawa',         -- Cause-and-effect diagram
  'fault_tree_analysis',       -- Top-down deductive analysis
  'event_timeline',            -- Chronological event chain analysis
  'bow_tie',                   -- Risk barrier analysis
  'failure_mode_effects',      -- FMEA — systematic failure mode analysis
  'kill_chain',                -- Cyber kill chain analysis (MITRE ATT&CK)
  'blameless_postmortem',      -- SRE-style postmortem without attribution
  'combined'                   -- Multiple methods applied
);

comment on type gov_repo.rca_method is
  'Root cause analysis methodology used per ISO/IEC 27035 and industry practice.
   kill_chain: maps to MITRE ATT&CK framework for cyber incidents.
   blameless_postmortem: preferred for AI system failures where blame assignment
   obscures systemic causes. Mandated by ISO 42001:2023 §8.2.';

-- Recovery tracking status (granular, beyond incident_status enum)
create type gov_repo.recovery_status as enum (
  'not_started',               -- No recovery actions initiated
  'containment_active',        -- Containment measures applied; spread stopped
  'eradication_active',        -- Eradicating root cause from environment
  'recovery_active',           -- Restoring systems and services
  'restored_partial',          -- Partial restoration — some services back
  'restored_full',             -- Full restoration — all services back
  'monitoring_period',         -- Post-recovery monitoring phase
  'lessons_learned_pending',   -- Recovery complete; PIR/AAR not yet held
  'closed'                     -- Post-incident review complete; incident formally closed
);

comment on type gov_repo.recovery_status is
  'Granular recovery lifecycle tracking.
   Decoupled from incident_status (reported→closed) to allow more precise
   recovery progress reporting to CISO, CRO, and DORA competent authority.
   restored_full does NOT equal closed — PIR must still be conducted.
   DORA Art. 11: recovery time objectives (RTO) are assessed against this progression.';

-- =============================================================================
-- [C0] SELF-CONTAINED GUARD
-- Creates the M006 stub tables (ict_incidents, third_party_providers, ai_systems)
-- exactly as 20260618006000_regulatory_and_systems.sql would have created them.
-- All statements use CREATE TABLE IF NOT EXISTS / DO $$ guards so this block
-- is a complete no-op when M006 and M006500 have already run.
-- Minimum required dependencies (must be applied before this file):
--   20260618005000_agent_registry_graph  (agents, governance_users, organisations)
--   20260618004000 (conformity_assessments, evidence, governance_policies)
-- =============================================================================

-- ── Required enums (all guarded) ──────────────────────────────────────────────

do $$ begin
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                 where n.nspname = 'gov_repo' and t.typname = 'system_status') then
    create type gov_repo.system_status as enum (
      'development', 'testing', 'production', 'decommissioned'
    );
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                 where n.nspname = 'gov_repo' and t.typname = 'dora_criticality') then
    create type gov_repo.dora_criticality as enum (
      'critical', 'high', 'medium', 'low'
    );
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                 where n.nspname = 'gov_repo' and t.typname = 'incident_severity') then
    create type gov_repo.incident_severity as enum (
      'critical', 'high', 'medium', 'low'
    );
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                 where n.nspname = 'gov_repo' and t.typname = 'incident_status') then
    create type gov_repo.incident_status as enum (
      'reported', 'investigating', 'mitigated', 'resolved', 'closed'
    );
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                 where n.nspname = 'gov_repo' and t.typname = 'provider_service_type') then
    create type gov_repo.provider_service_type as enum (
      'cloud_infrastructure', 'foundation_model_api', 'saas_platform',
      'data_provider', 'managed_service'
    );
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                 where n.nspname = 'gov_repo' and t.typname = 'ai_system_lifecycle') then
    create type gov_repo.ai_system_lifecycle as enum (
      'concept', 'development', 'testing', 'pre_market_review',
      'conformity_assessed', 'production', 'under_significant_modification',
      'post_market_surveillance', 'decommissioned'
    );
  end if;
end $$;

-- ── M006 stub: gov_repo.ai_systems ────────────────────────────────────────────

create table if not exists gov_repo.ai_systems (
  system_id                 uuid          primary key default uuid_generate_v4(),
  system_code               varchar(20)   not null,
  name                      varchar(255)  not null,
  description               text          not null,
  intended_purpose          text          not null,
  risk_class                gov_repo.ai_act_risk_class not null default 'minimal',
  status                    gov_repo.system_status not null default 'development',
  owner_user_id             uuid          not null
                                           references gov_repo.governance_users (user_id),
  business_domain           varchar(100),
  eu_ai_db_registered       boolean       not null default false,
  eu_ai_db_ref              varchar(100),
  conformity_assessment_id  uuid
                                           references gov_repo.conformity_assessments (assessment_id),
  organisation_id           uuid          not null
                                           references gov_repo.organisations (organisation_id),
  ledger_entry_seq          bigint
                                           references gov_repo.governance_ledger (entry_sequence),
  created_at                timestamptz   not null default now(),
  updated_at                timestamptz   not null default now(),
  constraint ai_systems_code_org_unique unique (system_code, organisation_id)
);

create index if not exists idx_ai_systems_org
  on gov_repo.ai_systems (organisation_id);

do $$ begin
  if not exists (
    select 1 from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'gov_repo' and c.relname = 'ai_systems'
      and t.tgname = 'trg_ai_systems_updated_at'
  ) then
    create trigger trg_ai_systems_updated_at
      before update on gov_repo.ai_systems
      for each row execute function gov_repo.set_updated_at();
  end if;
end $$;

do $$ begin
  if not exists (
    select 1 from information_schema.table_constraints
    where constraint_schema = 'gov_repo' and table_name = 'agents'
      and constraint_name = 'fk_agent_ai_system'
  ) then
    alter table gov_repo.agents
      add constraint fk_agent_ai_system
      foreign key (ai_system_id) references gov_repo.ai_systems (system_id);
  end if;
end $$;

alter table gov_repo.ai_systems enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'gov_repo'
    and tablename = 'ai_systems' and policyname = 'Service role full access ai_systems') then
    execute $pol$ create policy "Service role full access ai_systems"
      on gov_repo.ai_systems for all to service_role using (true) with check (true) $pol$;
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'gov_repo'
    and tablename = 'ai_systems' and policyname = 'Org-scoped ai_systems') then
    execute $pol$ create policy "Org-scoped ai_systems"
      on gov_repo.ai_systems for select to authenticated
      using (organisation_id = (select organisation_id from gov_repo.governance_users
        where email = auth.email() limit 1)) $pol$;
  end if;
end $$;

-- ── M006 stub: gov_repo.third_party_providers ─────────────────────────────────

create table if not exists gov_repo.third_party_providers (
  provider_id               uuid          primary key default uuid_generate_v4(),
  provider_code             varchar(20)   not null,
  name                      varchar(255)  not null,
  service_type              gov_repo.provider_service_type not null,
  dora_criticality          gov_repo.dora_criticality not null default 'medium',
  headquarters_country      varchar(2)    not null,
  data_processing_regions   text[]        not null default '{}',
  status                    varchar(30)   not null default 'active'
                                           check (status in (
                                             'under_review','active','suspended','terminated')),
  contract_ref              varchar(100),
  contract_expires_at       date,
  exit_plan_documented      boolean       not null default false,
  concentration_risk_score  numeric(4,2),
  organisation_id           uuid          not null
                                           references gov_repo.organisations (organisation_id),
  created_at                timestamptz   not null default now(),
  updated_at                timestamptz   not null default now(),
  constraint providers_code_org_unique unique (provider_code, organisation_id)
);

create index if not exists idx_third_party_org
  on gov_repo.third_party_providers (organisation_id);

do $$ begin
  if not exists (
    select 1 from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'gov_repo' and c.relname = 'third_party_providers'
      and t.tgname = 'trg_third_party_updated_at'
  ) then
    create trigger trg_third_party_updated_at
      before update on gov_repo.third_party_providers
      for each row execute function gov_repo.set_updated_at();
  end if;
end $$;

-- FK on agent_resource_links.provider_id
do $$ begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'gov_repo' and table_name = 'agent_resource_links'
      and column_name = 'provider_id'
  ) then
    alter table gov_repo.agent_resource_links
      add column provider_id uuid
      references gov_repo.third_party_providers (provider_id);
  end if;
end $$;

alter table gov_repo.third_party_providers enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'gov_repo'
    and tablename = 'third_party_providers'
    and policyname = 'Service role full access third_party_providers') then
    execute $pol$ create policy "Service role full access third_party_providers"
      on gov_repo.third_party_providers for all to service_role
      using (true) with check (true) $pol$;
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'gov_repo'
    and tablename = 'third_party_providers'
    and policyname = 'Org-scoped third_party_providers') then
    execute $pol$ create policy "Org-scoped third_party_providers"
      on gov_repo.third_party_providers for select to authenticated
      using (organisation_id = (select organisation_id from gov_repo.governance_users
        where email = auth.email() limit 1)) $pol$;
  end if;
end $$;

-- ── M006 stub: gov_repo.ict_incidents ────────────────────────────────────────

create table if not exists gov_repo.ict_incidents (
  incident_id               uuid          primary key default uuid_generate_v4(),
  incident_code             varchar(20)   not null,
  title                     varchar(255)  not null,
  description               text          not null,
  severity                  gov_repo.incident_severity not null,
  status                    gov_repo.incident_status not null default 'reported',
  impacted_system_ids       uuid[]        not null default '{}',
  impacted_agent_ids        uuid[]        not null default '{}',
  impacted_provider_ids     uuid[]        not null default '{}',
  downtime_minutes          integer       default 0,
  financial_impact_eur      numeric(12,2) default 0,
  data_breach_involved      boolean       not null default false,
  root_cause                text,
  remediation_plan          text,
  reported_at               timestamptz   not null default now(),
  resolved_at               timestamptz,
  reported_by               uuid
                                           references gov_repo.governance_users (user_id),
  organisation_id           uuid          not null
                                           references gov_repo.organisations (organisation_id),
  created_at                timestamptz   not null default now(),
  updated_at                timestamptz   not null default now(),
  constraint ict_incidents_code_org_unique unique (incident_code, organisation_id)
);

create index if not exists idx_ict_incidents_org
  on gov_repo.ict_incidents (organisation_id);

do $$ begin
  if not exists (
    select 1 from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'gov_repo' and c.relname = 'ict_incidents'
      and t.tgname = 'trg_ict_incidents_updated_at'
  ) then
    create trigger trg_ict_incidents_updated_at
      before update on gov_repo.ict_incidents
      for each row execute function gov_repo.set_updated_at();
  end if;
end $$;

alter table gov_repo.ict_incidents enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'gov_repo'
    and tablename = 'ict_incidents'
    and policyname = 'Service role full access ict_incidents') then
    execute $pol$ create policy "Service role full access ict_incidents"
      on gov_repo.ict_incidents for all to service_role
      using (true) with check (true) $pol$;
  end if;
end $$;

-- ── M006500 ALTER TABLE guard: apply ai_systems expansion if not yet done ─────
-- Each column uses ADD COLUMN IF NOT EXISTS — safe if M006500 already ran.
-- We inline the minimum columns needed by this migration's views and triggers.
-- The full M006500 expansion is not repeated here; run M006500 independently
-- for the complete ai_systems schema. These columns are the ones 006600 reads.

alter table gov_repo.ai_systems
  add column if not exists lifecycle              gov_repo.ai_system_lifecycle
                                                   not null default 'development',
  add column if not exists serious_incidents_reported integer not null default 0,
  add column if not exists last_serious_incident_at   timestamptz;

-- =============================================================================
-- [C2] EXPAND gov_repo.ict_incidents VIA ALTER TABLE
-- Stub columns (from M006, kept intact):
--   incident_id, incident_code, title, description, severity, status,
--   impacted_system_ids[], impacted_agent_ids[], impacted_provider_ids[],
--   downtime_minutes, financial_impact_eur, data_breach_involved,
--   root_cause, remediation_plan, reported_at, resolved_at,
--   reported_by, organisation_id, created_at, updated_at
-- All ADD COLUMN statements use IF NOT EXISTS — safe to re-run.
-- =============================================================================

-- ─── [C2.1] Classification & DORA Criteria ───────────────────────────────────
-- DORA Art. 17-18 + EBA RTS on incident classification criteria

alter table gov_repo.ict_incidents
  -- Richer classification
  add column if not exists incident_category     gov_repo.dora_incident_category
                                                  not null default 'system_failure',

  -- DORA major incident determination (Art. 18)
  -- An incident is "major" if it meets threshold criteria in the EBA RTS:
  --   clients affected > threshold, financial impact > threshold,
  --   critical service downtime > threshold, reputational impact, etc.
  add column if not exists is_major_incident     boolean  not null default false,

  -- Justification for major / not-major determination (mandatory when is_major = true)
  add column if not exists major_classification_rationale text,

  -- EBA RTS classification criteria flags (Art. 18(3) + EBA RTS criteria)
  -- Each flag = one criterion assessed
  add column if not exists criterion_clients_affected      boolean not null default false,
  add column if not exists criterion_financial_threshold   boolean not null default false,
  add column if not exists criterion_reputational_impact   boolean not null default false,
  add column if not exists criterion_critical_service_down boolean not null default false,
  add column if not exists criterion_data_integrity_loss   boolean not null default false,
  add column if not exists criterion_geographic_spread     boolean not null default false,
  add column if not exists criterion_duration_exceeded     boolean not null default false,

  -- Quantitative criteria values (populate to support criterion flags)
  add column if not exists clients_affected_count          integer,
  add column if not exists clients_affected_pct            numeric(5,2), -- % of total client base
  add column if not exists transactions_affected_count     bigint,
  add column if not exists geographic_regions_affected     text[]        not null default '{}',

  -- Cyber threat dimension (DORA Art. 21 — voluntary notification)
  add column if not exists is_cyber_threat                 boolean not null default false,
  add column if not exists cyber_threat_indicator          text,   -- IOC, TTPs, MITRE ATT&CK ref
  add column if not exists mitre_attack_techniques         text[]  not null default '{}';

comment on column gov_repo.ict_incidents.is_major_incident is
  'DORA Art. 18: incident classified as "major" triggering Art. 19 reporting obligations.
   Set to TRUE when any EBA RTS classification criterion is met.
   Once TRUE, DORA reporting clock starts: 4h → 72h → 1 month.
   major_classification_rationale must be populated with the assessment reasoning.
   The competent authority (NCA/ECB) may challenge this determination.';

comment on column gov_repo.ict_incidents.criterion_clients_affected is
  'EBA RTS criterion: number or percentage of clients affected exceeds threshold.
   Threshold varies by institution type (significant vs. less significant).
   Populate clients_affected_count and clients_affected_pct for evidence.';

comment on column gov_repo.ict_incidents.criterion_critical_service_down is
  'EBA RTS criterion: critical or important ICT function unavailable for > threshold duration.
   Typical thresholds: critical = 2h, important = 4h (EBA RTS Art. 4).
   Must be correlated with ict_incident_affected_services (child table).';

comment on column gov_repo.ict_incidents.mitre_attack_techniques is
  'MITRE ATT&CK technique IDs applicable to this incident (e.g. T1486, T1059).
   Populated by security analysts during investigation.
   Used for: threat intelligence sharing (DORA Art. 21), TIBER-EU mapping,
   DORA threat-led penetration testing (TLPT) scope refinement (Art. 24).';

-- ─── [C2.2] Detection & Initial Response ─────────────────────────────────────

alter table gov_repo.ict_incidents
  -- Detection timeline (ISO 27035: detect → report → assess → respond)
  add column if not exists occurred_at          timestamptz,  -- When incident actually started
  add column if not exists detected_at          timestamptz,  -- When first detected/alerted
  add column if not exists detected_by          varchar(100), -- System, tool, or person name
  add column if not exists detection_method     varchar(100), -- SIEM alert, manual, customer report, etc.

  -- Initial triage
  add column if not exists triaged_at           timestamptz,
  add column if not exists triaged_by           uuid
                                                 references gov_repo.governance_users (user_id),
  add column if not exists initial_severity     gov_repo.incident_severity,  -- severity at detection (may change)

  -- Containment
  add column if not exists contained_at         timestamptz,
  add column if not exists containment_actions  text,

  -- Incident commander (accountable individual — DORA Art. 5 accountability)
  add column if not exists incident_commander_id uuid
                                                 references gov_repo.governance_users (user_id),

  -- DORA reporting owner (person responsible for submitting reports to NCA/ECB)
  add column if not exists reporting_owner_id   uuid
                                                 references gov_repo.governance_users (user_id);

comment on column gov_repo.ict_incidents.occurred_at is
  'Actual start of the incident — may differ from reported_at by hours or days.
   Critical for DORA Art. 19: reporting deadlines are measured from
   when the entity became AWARE, not from occurrence.
   Detection lag (detected_at - occurred_at) is a key resilience KPI.
   Must be documented in DORA initial notification report.';

comment on column gov_repo.ict_incidents.incident_commander_id is
  'Accountable individual for the incident response.
   DORA Art. 5(4): management body bears ultimate responsibility.
   For major incidents, the incident commander should be at VP/Director level minimum.
   Named here for accountability trail in ledger and regulatory evidence.';

-- ─── [C2.3] DORA Regulatory Reporting Timeline ───────────────────────────────
-- DORA Art. 19(4): three mandatory reports with hard deadlines

alter table gov_repo.ict_incidents
  -- Reporting phase tracking
  add column if not exists reporting_phase       gov_repo.dora_reporting_phase
                                                  not null default 'not_required',

  -- Phase 1: Initial notification — within 4 hours of major classification
  add column if not exists initial_notification_deadline  timestamptz,
  add column if not exists initial_notification_sent_at   timestamptz,
  add column if not exists initial_notification_ref       varchar(100), -- NCA acknowledgement ref

  -- Phase 2: Intermediate report — within 72 hours of initial notification
  add column if not exists intermediate_report_deadline   timestamptz,
  add column if not exists intermediate_report_sent_at    timestamptz,
  add column if not exists intermediate_report_ref        varchar(100),

  -- Phase 3: Final report — within 1 month of initial notification
  add column if not exists final_report_deadline          timestamptz,
  add column if not exists final_report_sent_at           timestamptz,
  add column if not exists final_report_ref               varchar(100),

  -- Competent authority details
  add column if not exists competent_authority  varchar(100), -- ECB / BaFin / PRA / AMF / etc.
  add column if not exists nca_case_ref         varchar(100), -- Reference assigned by NCA
  add column if not exists nca_acknowledged_at  timestamptz,

  -- Art. 21 voluntary notification (significant cyber threat, not yet incident)
  add column if not exists voluntary_notif_sent_at timestamptz,
  add column if not exists voluntary_notif_ref      varchar(100);

comment on column gov_repo.ict_incidents.reporting_phase is
  'DORA Art. 19 reporting phase tracking.
   Deadlines run from the moment is_major_incident is set to TRUE:
     initial_notification_deadline = major classification time + 4 hours
     intermediate_report_deadline  = initial_notification_sent_at + 72 hours
     final_report_deadline         = initial_notification_sent_at + 1 month
   These deadlines are auto-computed by trigger trg_ict_inc_dora_deadlines.
   SLA breaches are surfaced in v_ict_dora_reporting_status view.';

comment on column gov_repo.ict_incidents.competent_authority is
  'The competent authority to which DORA Art. 19 reports are submitted.
   For significant institutions (EU): ECB via SSM.
   For less significant institutions: home NCA (BaFin, PRA, AMF, Banca d''Italia, etc.)
   For investment firms / CCPs / CSDs: ESMA.
   For insurance: EIOPA / national insurance supervisor.
   Financial entities report to their HOME MEMBER STATE authority regardless of
   where the incident occurred (Art. 19(1)).';

comment on column gov_repo.ict_incidents.nca_case_ref is
  'Reference number assigned by the National Competent Authority upon receipt of
   the initial notification. Must be included in all subsequent reports.
   NULL until NCA acknowledges the initial notification.';

-- ─── [C2.4] Root Cause Analysis ──────────────────────────────────────────────
-- ISO 27035 + ISO 42001 §8.2 + DORA Art. 19(4)(c) final report requirement

alter table gov_repo.ict_incidents
  -- RCA methodology and findings
  add column if not exists rca_method            gov_repo.rca_method,
  add column if not exists rca_conducted_by      uuid
                                                  references gov_repo.governance_users (user_id),
  add column if not exists rca_started_at        timestamptz,
  add column if not exists rca_completed_at      timestamptz,

  -- Structured RCA findings (replaces/supplements free-text root_cause column)
  -- root_cause TEXT column from stub remains as executive summary
  add column if not exists root_cause_category   varchar(100), -- technical/process/people/external
  add column if not exists root_cause_detail     jsonb         not null default '{}',
  -- Format: {"primary": "...", "contributing": ["...", "..."],
  --          "timeline_of_events": [...], "failure_mode": "..."}

  add column if not exists contributing_factors  text[],       -- List of contributing factors
  add column if not exists control_failures      varchar(12)[] not null default '{}',
  -- CG-AG-* controls that failed or were absent during the incident

  add column if not exists ai_root_cause_type    varchar(100),
  -- For AI incidents: model_drift, data_poisoning, prompt_injection,
  --   hallucination, autonomy_failure, bias_amplification, etc.

  add column if not exists rca_evidence_id       uuid
                                                  references gov_repo.evidence (evidence_id),

  -- Lessons learned (DORA Art. 19(4)(c) final report + ISO 27035-3)
  add column if not exists lessons_learned       text,
  add column if not exists lessons_learned_at    timestamptz,
  add column if not exists pir_conducted         boolean not null default false,
  add column if not exists pir_date              date,
  add column if not exists pir_evidence_id       uuid
                                                  references gov_repo.evidence (evidence_id);

comment on column gov_repo.ict_incidents.root_cause_detail is
  'Structured RCA output. JSON format:
   {"primary": "Database connection pool exhaustion due to query N+1 bug",
    "contributing": ["No connection limit on agent pool", "Missing circuit breaker"],
    "timeline_of_events": [{"t": "2026-06-18T09:00Z", "event": "..."}],
    "failure_mode": "cascade_failure",
    "mitre_technique": "T1499.002"}
   The free-text root_cause column (from stub) is retained as executive summary.
   root_cause_detail provides structured evidence for DORA final report §4.';

comment on column gov_repo.ict_incidents.control_failures is
  'CG-AG-* control IDs that were absent or failed during this incident.
   Array of control references (e.g. [''CG-AG-008'', ''CG-AG-011'']).
   Used to: trigger control re-assessment, update control maturity scores,
   and feed into the annual DORA testing programme scope.
   Linked back to gov_repo.control_assessments via the control_ref column.';

comment on column gov_repo.ict_incidents.ai_root_cause_type is
  'AI-specific root cause classification. Only applicable when
   incident_category = ''ai_system_failure''.
   Standard values:
     model_drift        — model performance degraded over time
     data_poisoning     — training/inference data was corrupted/manipulated
     prompt_injection   — adversarial prompt caused unexpected behaviour
     hallucination      — model generated false/harmful content
     autonomy_failure   — autonomous agent took unanticipated action
     bias_amplification — model amplified bias in inputs
     cascade_failure    — failure propagated across agent graph
   Links to gov_repo.ai_serious_incidents.root_cause_analysis.';

-- ─── [C2.5] Recovery Tracking ─────────────────────────────────────────────────
-- DORA Art. 11: RTO/RPO targets + actual recovery performance

alter table gov_repo.ict_incidents
  -- Granular recovery status
  add column if not exists recovery_status       gov_repo.recovery_status
                                                  not null default 'not_started',

  -- Actual recovery timeline
  add column if not exists eradication_started_at  timestamptz,
  add column if not exists eradication_completed_at timestamptz,
  add column if not exists recovery_started_at    timestamptz,
  add column if not exists recovery_completed_at  timestamptz, -- full restoration (supplements resolved_at)
  add column if not exists monitoring_started_at  timestamptz,
  add column if not exists monitoring_ends_at     timestamptz,

  -- RTO/RPO performance (DORA Art. 11)
  -- Target values come from DORA resilience testing programme
  add column if not exists rto_target_minutes    integer,  -- Recovery Time Objective
  add column if not exists rpo_target_minutes    integer,  -- Recovery Point Objective (data loss window)
  add column if not exists rto_actual_minutes    integer generated always as (
    case
      when recovery_completed_at is not null and occurred_at is not null
      then extract(epoch from (recovery_completed_at - occurred_at))::integer / 60
      else null
    end
  ) stored,
  add column if not exists rto_breach            boolean generated always as (
    case
      when rto_target_minutes is not null and recovery_completed_at is not null
           and occurred_at is not null
      then (extract(epoch from (recovery_completed_at - occurred_at)) / 60)
           > rto_target_minutes
      else false
    end
  ) stored,
  add column if not exists data_loss_minutes     integer,  -- Actual data loss window (RPO actual)
  add column if not exists rpo_breach            boolean generated always as (
    case
      when rpo_target_minutes is not null and data_loss_minutes is not null
      then data_loss_minutes > rpo_target_minutes
      else false
    end
  ) stored,

  -- Remediation actions (supplements text remediation_plan from stub)
  add column if not exists remediation_actions   jsonb  not null default '[]',
  -- Format: [{"action": "...", "owner": "user_id", "due": "date", "status": "done"}]

  add column if not exists remediation_evidence_id uuid
                                                   references gov_repo.evidence (evidence_id),

  -- Permanent fixes vs. temporary workarounds
  add column if not exists workaround_applied    boolean not null default false,
  add column if not exists permanent_fix_applied boolean not null default false,
  add column if not exists permanent_fix_date    date;

comment on column gov_repo.ict_incidents.rto_actual_minutes is
  'Actual Recovery Time: minutes from occurrence (occurred_at) to full recovery
   (recovery_completed_at). Auto-computed as GENERATED ALWAYS AS stored column.
   DORA Art. 11: entities must demonstrate RTO/RPO targets were met.
   rto_breach = true triggers automatic escalation to DORA resilience report.';

comment on column gov_repo.ict_incidents.recovery_status is
  'Granular recovery progress. Decoupled from incident_status to allow:
   - CISO to track recovery while regulators track reporting phase separately
   - DORA intermediate report (72h) to accurately reflect recovery progress
   - RTO measurement against DORA resilience targets (Art. 11)
   Progression: not_started → containment → eradication → recovery → restored → monitoring → closed';

-- ─── [C2.6] Impacted AI Systems & Agents (Structured) ───────────────────────
-- The stub uses arrays. We add FK-based linkage via child table
-- but also add summary columns here for quick querying.

alter table gov_repo.ict_incidents
  -- AI-specific linkage
  add column if not exists involves_ai_system    boolean not null default false,
  -- TRUE when any element of impacted_system_ids is an AI system
  -- Auto-set by trigger when impacted_system_ids is updated

  add column if not exists primary_ai_system_id  uuid
                                                  references gov_repo.ai_systems (system_id),
  -- The primary AI system involved (when involves_ai_system = true)

  add column if not exists ai_serious_incident_id uuid,
  -- FK to gov_repo.ai_serious_incidents if this ICT incident also triggered
  -- an AI Act Art. 73 serious incident report. Added as plain column to avoid
  -- circular dependency (ai_serious_incidents has no back-reference here).
  -- Application layer enforces consistency.

  add column if not exists ai_act_reporting_required boolean not null default false,
  -- TRUE when the incident also requires AI Act Art. 73 provider reporting

  -- Data breach / PII exposure (GDPR Art. 33 + DORA Art. 18)
  add column if not exists pii_data_exposed      boolean not null default false,
  add column if not exists phi_data_exposed      boolean not null default false,
  add column if not exists financial_data_exposed boolean not null default false,
  add column if not exists gdpr_breach_notified  boolean not null default false,
  add column if not exists gdpr_breach_ref       varchar(100),
  add column if not exists dpa_notification_deadline timestamptz;
  -- GDPR Art. 33: 72-hour notification to DPA

comment on column gov_repo.ict_incidents.primary_ai_system_id is
  'When the incident primarily involves an AI system (involves_ai_system = true),
   this column identifies the root AI system. Used for:
   - AI Act Art. 73 serious incident linkage
   - Post-market surveillance event (gov_repo.ai_systems.serious_incidents_reported)
   - CISO AI risk lens aggregation
   The broader impacted_system_ids[] array tracks ALL affected systems.';

comment on column gov_repo.ict_incidents.dpa_notification_deadline is
  'GDPR Art. 33: if pii_data_exposed = true, controller must notify DPA within
   72 hours of becoming aware of the breach.
   Auto-computed as: detected_at + 72 hours when pii_data_exposed is set.
   Computed by trigger trg_ict_inc_gdpr_deadline.
   NULL when pii_data_exposed = false.';

-- ─── [C2.7] Third-Party Provider Linkage ─────────────────────────────────────

alter table gov_repo.ict_incidents
  add column if not exists involves_third_party  boolean not null default false,
  add column if not exists primary_provider_id   uuid
                                                  references gov_repo.third_party_providers (provider_id),
  -- Primary third-party provider responsible for or involved in the incident
  -- The broader impacted_provider_ids[] array tracks all affected providers.

  add column if not exists provider_sla_breach   boolean not null default false,
  -- TRUE when the provider's contractual SLA was breached during this incident

  add column if not exists provider_incident_ref varchar(100),
  -- Provider's own incident reference (for cross-org correlation)

  add column if not exists subcontractor_involved boolean not null default false,
  -- DORA Art. 30(2)(f): sub-outsourcing must be tracked in incident reports

  add column if not exists concentration_risk_flag boolean not null default false;
  -- TRUE when incident affects a provider used by > N% of critical services

comment on column gov_repo.ict_incidents.concentration_risk_flag is
  'DORA Art. 29: incident that reveals or worsens ICT third-party concentration risk.
   Set by trigger when primary_provider_id matches a provider with
   gov_repo.third_party_providers.dora_criticality = ''critical''.
   Triggers escalation to competent authority beyond standard Art. 19 reporting.';

-- ─── [C2.8] Financial Impact & Business Impact ───────────────────────────────
-- DORA Art. 18(1)(d) + EBA RTS criterion: financial impact threshold

alter table gov_repo.ict_incidents
  -- Supplement the stub's financial_impact_eur (numeric(12,2)) with breakdown
  add column if not exists direct_financial_loss_eur     numeric(15,2),
  add column if not exists indirect_financial_loss_eur   numeric(15,2),
  add column if not exists regulatory_fine_risk_eur      numeric(15,2),
  add column if not exists reputational_cost_eur         numeric(15,2),

  -- Business impact narrative (DORA intermediate + final reports require this)
  add column if not exists business_impact_summary       text,
  add column if not exists operations_affected           text[],  -- list of business operations
  add column if not exists sla_breaches_to_clients       boolean not null default false,
  add column if not exists client_notifications_required boolean not null default false,
  add column if not exists client_notifications_sent_at  timestamptz,

  -- Insurance / cyber insurance
  add column if not exists cyber_insurance_claim_raised  boolean not null default false,
  add column if not exists cyber_insurance_ref           varchar(100);

comment on column gov_repo.ict_incidents.direct_financial_loss_eur is
  'EBA RTS classification criterion: financial loss thresholds for major incident.
   Typically EUR 1M for significant institutions (indicative; check current RTS).
   direct = immediate losses (transaction failures, emergency response costs).
   indirect = consequential losses (client attrition, delayed revenue, etc.).
   Populate all fields for DORA final report financial impact section.';

-- ─── [C2.9] Metadata, Evidence & Audit ───────────────────────────────────────

alter table gov_repo.ict_incidents
  -- Evidence chain
  add column if not exists evidence_ids          uuid[]  not null default '{}',
  -- Array of gov_repo.evidence.evidence_id links

  -- Ledger integration (immutable audit trail)
  add column if not exists ledger_entry_seq      bigint
                                                  references gov_repo.governance_ledger (entry_sequence),

  -- Classification history (DORA: severity may be upgraded/downgraded)
  add column if not exists severity_history      jsonb   not null default '[]',
  -- Format: [{"from": "medium", "to": "high", "by": "user_id", "at": "...", "reason": "..."}]

  -- Tags and external references
  add column if not exists tags                  jsonb   not null default '[]',
  add column if not exists external_refs         jsonb   not null default '{}',
  -- external_refs: {"jira": "INC-42", "servicenow": "INC0012345", "splunk_case": "..."}

  -- Resolver (who formally closed the incident)
  add column if not exists closed_by             uuid
                                                  references gov_repo.governance_users (user_id),
  add column if not exists closed_at             timestamptz,
  add column if not exists closure_rationale     text,

  -- Created by
  add column if not exists created_by            uuid
                                                  references gov_repo.governance_users (user_id);

comment on column gov_repo.ict_incidents.severity_history is
  'Immutable log of severity reclassifications. DORA requires that the evolution
   of the incident classification is documented in the intermediate report.
   Format: [{"from":"medium","to":"critical","by":"<uuid>","at":"<ts>","reason":"..."}]
   Application layer appends on every severity change; never overwrites.';

-- =============================================================================
-- [C3] TABLE: gov_repo.ict_incident_timeline
-- Chronological event log for each incident.
-- Implements: ISO 27035 §6, DORA Art. 19 (report timelines require event log),
-- NIST RESPOND 2.2 (incident timeline documentation)
-- =============================================================================

create table gov_repo.ict_incident_timeline (
  event_id              uuid          primary key default uuid_generate_v4(),
  incident_id           uuid          not null
                                       references gov_repo.ict_incidents (incident_id)
                                       on delete cascade,

  -- Event details
  event_timestamp       timestamptz   not null,
  event_type            varchar(50)   not null
                                       check (event_type in (
                                         'occurrence',        -- Incident started
                                         'detection',         -- First detected/alerted
                                         'notification',      -- Internal team notified
                                         'triage',            -- Severity/impact assessed
                                         'escalation',        -- Escalated to higher tier
                                         'containment',       -- Containment action applied
                                         'eradication',       -- Root cause removed
                                         'recovery',          -- Service restoration action
                                         'regulatory_report', -- Report sent to NCA/ECB
                                         'client_communication', -- Clients notified
                                         'workaround',        -- Temporary fix applied
                                         'permanent_fix',     -- Permanent fix applied
                                         'monitoring',        -- Monitoring milestone
                                         'closure',           -- Incident formally closed
                                         'evidence_collected',-- Evidence artifact logged
                                         'rca_milestone',     -- RCA progress event
                                         'other'
                                       )),
  event_description     text          not null,
  actor_user_id         uuid          references gov_repo.governance_users (user_id),
  actor_system          varchar(255), -- Automated system/tool name if actor is not a person
  is_key_milestone      boolean       not null default false,
  -- Key milestones are included in DORA regulatory reports

  -- DORA reporting reference (if this event is a regulatory submission)
  reporting_phase       gov_repo.dora_reporting_phase,
  report_ref            varchar(100),

  -- Evidence artifact attached to this event
  evidence_id           uuid          references gov_repo.evidence (evidence_id),

  -- Metadata
  metadata              jsonb         not null default '{}',
  organisation_id       uuid          not null
                                       references gov_repo.organisations (organisation_id),
  created_at            timestamptz   not null default now(),

  constraint ict_timeline_event_actor_check check (
    actor_user_id is not null or actor_system is not null
  )
);

comment on table gov_repo.ict_incident_timeline is
  'Chronological event log per incident. Immutable — events are appended, never updated.
   Implements DORA Art. 19 timeline documentation requirement:
   regulatory reports must reference the chronological sequence of events.
   is_key_milestone = true: event is included in DORA regulatory report narrative.
   Actor must be a person (actor_user_id) or a system (actor_system) — not both null.
   Use gov_repo.ledger_append() for events that require cryptographic integrity.';

create index idx_ict_timeline_incident
  on gov_repo.ict_incident_timeline (incident_id, event_timestamp asc);

create index idx_ict_timeline_org
  on gov_repo.ict_incident_timeline (organisation_id);

create index idx_ict_timeline_milestones
  on gov_repo.ict_incident_timeline (incident_id)
  where is_key_milestone = true;

create index idx_ict_timeline_regulatory
  on gov_repo.ict_incident_timeline (incident_id)
  where reporting_phase is not null;

create index idx_ict_timeline_type
  on gov_repo.ict_incident_timeline (event_type);

alter table gov_repo.ict_incident_timeline enable row level security;

create policy "Service role full access ict_incident_timeline"
  on gov_repo.ict_incident_timeline for all to service_role
  using (true) with check (true);

create policy "Org-scoped read ict_incident_timeline"
  on gov_repo.ict_incident_timeline for select to authenticated
  using (organisation_id = (
    select organisation_id from gov_repo.governance_users
    where email = auth.email() limit 1
  ));

-- =============================================================================
-- [C4] TABLE: gov_repo.ict_incident_notifications
-- DORA Art. 19-20 regulatory notification tracker.
-- Each row = one report sent to a competent authority.
-- Provides full audit trail of the regulatory reporting obligation.
-- =============================================================================

create table gov_repo.ict_incident_notifications (
  notification_id       uuid          primary key default uuid_generate_v4(),
  incident_id           uuid          not null
                                       references gov_repo.ict_incidents (incident_id)
                                       on delete cascade,

  -- Which phase of DORA reporting this notification covers
  reporting_phase       gov_repo.dora_reporting_phase not null,

  -- Competent authority
  authority_name        varchar(100)  not null,
  -- ECB, BaFin, PRA, AMF, Banca d'Italia, ESMA, EIOPA, etc.
  authority_country     char(2),
  authority_case_ref    varchar(100),  -- Reference assigned by authority on receipt

  -- Deadline and actual submission (SLA enforcement)
  deadline              timestamptz   not null,
  submitted_at          timestamptz,
  is_breached           boolean       not null generated always as (
    submitted_at is null or submitted_at > deadline
  ) stored,
  breach_explanation    text,          -- Mandatory if is_breached = true

  -- Report content
  report_summary        text          not null,
  report_template_version varchar(20),  -- EBA ITS template version used
  report_evidence_id    uuid          references gov_repo.evidence (evidence_id),
  -- The formal report document stored in gov_repo.evidence

  -- Submission channel and confirmation
  submission_channel    varchar(50)   not null default 'secure_portal'
                                       check (submission_channel in (
                                         'secure_portal', 'encrypted_email',
                                         'api', 'physical', 'other')),
  confirmation_ref      varchar(100),  -- Authority's acknowledgement reference
  acknowledged_at       timestamptz,

  -- Follow-up from authority
  authority_response    text,
  authority_response_at timestamptz,
  requires_followup     boolean       not null default false,
  followup_deadline     timestamptz,
  followup_completed_at timestamptz,

  -- Submitted by
  submitted_by          uuid          references gov_repo.governance_users (user_id),
  reviewed_by           uuid          references gov_repo.governance_users (user_id),
  qes_signature_id      uuid          references gov_repo.qes_signatures (signature_id),

  -- Ledger (each regulatory submission is a ledger event)
  ledger_entry_seq      bigint        references gov_repo.governance_ledger (entry_sequence),

  organisation_id       uuid          not null
                                       references gov_repo.organisations (organisation_id),
  created_at            timestamptz   not null default now(),
  updated_at            timestamptz   not null default now(),

  -- One notification per phase per incident per authority
  constraint ict_notif_unique unique (incident_id, reporting_phase, authority_name),

  -- Cannot breach without explanation
  constraint ict_notif_breach_explanation check (
    not is_breached or breach_explanation is not null
  )
);

comment on table gov_repo.ict_incident_notifications is
  'DORA Art. 19-20 regulatory notification audit trail.
   One row per report phase per authority per incident.
   is_breached: GENERATED ALWAYS AS — true when submitted after deadline.
   breach_explanation: mandatory when is_breached = true (regulator will ask).
   qes_signature_id: for institutions required to sign regulatory submissions with QES.
   Each submission must be a ledger event (ledger_entry_seq required on INSERT).
   Use v_ict_dora_reporting_status to monitor SLA compliance across all incidents.';

comment on column gov_repo.ict_incident_notifications.is_breached is
  'DORA Art. 19(4): reporting within prescribed deadlines is a legal obligation.
   Breach of the initial 4-hour notification deadline may result in:
     - Supervisory measure under DORA Art. 50
     - Administrative sanction under DORA Art. 52
     - Public disclosure in EBA register under Art. 52(5)
   breach_explanation documents why the deadline was missed — required for
   any supervisory enquiry or audit.';

create index idx_ict_notif_incident
  on gov_repo.ict_incident_notifications (incident_id);

create index idx_ict_notif_phase
  on gov_repo.ict_incident_notifications (reporting_phase);

create index idx_ict_notif_deadline
  on gov_repo.ict_incident_notifications (deadline)
  where submitted_at is null;

create index idx_ict_notif_breached
  on gov_repo.ict_incident_notifications (organisation_id)
  where is_breached = true;

create index idx_ict_notif_org
  on gov_repo.ict_incident_notifications (organisation_id);

create index idx_ict_notif_followup
  on gov_repo.ict_incident_notifications (followup_deadline)
  where requires_followup = true and followup_completed_at is null;

create trigger trg_ict_notif_updated_at
  before update on gov_repo.ict_incident_notifications
  for each row execute function gov_repo.set_updated_at();

alter table gov_repo.ict_incident_notifications enable row level security;

create policy "Service role full access ict_incident_notifications"
  on gov_repo.ict_incident_notifications for all to service_role
  using (true) with check (true);

create policy "Org-scoped read ict_incident_notifications"
  on gov_repo.ict_incident_notifications for select to authenticated
  using (organisation_id = (
    select organisation_id from gov_repo.governance_users
    where email = auth.email() limit 1
  ));

-- =============================================================================
-- [C5] TABLE: gov_repo.ict_incident_affected_services
-- Per-service impact register.
-- Enables: DORA Art. 18 threshold assessment, RTO/RPO per service,
-- DORA Art. 9 ICT function criticality tracking.
-- =============================================================================

create table gov_repo.ict_incident_affected_services (
  service_id            uuid          primary key default uuid_generate_v4(),
  incident_id           uuid          not null
                                       references gov_repo.ict_incidents (incident_id)
                                       on delete cascade,

  -- Service identification
  service_name          varchar(255)  not null,
  service_ref           varchar(100),   -- Internal service identifier / CMDB ref
  ict_function_type     gov_repo.ict_function_type not null,

  -- Linked entities (optional — service may be external or unregistered)
  ai_system_id          uuid          references gov_repo.ai_systems (system_id),
  agent_id              uuid          references gov_repo.agents (agent_id),
  provider_id           uuid          references gov_repo.third_party_providers (provider_id),

  -- Impact timeline
  impact_started_at     timestamptz   not null,
  impact_ended_at       timestamptz,
  downtime_minutes      integer       generated always as (
    case
      when impact_ended_at is not null
      then extract(epoch from (impact_ended_at - impact_started_at))::integer / 60
      else null
    end
  ) stored,

  -- Impact severity for this specific service
  service_impact        varchar(30)   not null default 'degraded'
                                       check (service_impact in (
                                         'full_outage',     -- Completely unavailable
                                         'degraded',        -- Reduced functionality
                                         'data_loss',       -- Data loss occurred
                                         'data_corruption', -- Data integrity compromised
                                         'security_breach', -- Unauthorized access
                                         'performance',     -- Performance degradation only
                                         'monitoring_only'  -- Observed but not impacted
                                       )),

  -- DORA threshold assessment for this service
  rto_target_minutes    integer,
  rto_actual_minutes    integer generated always as (
    case
      when impact_ended_at is not null
      then extract(epoch from (impact_ended_at - impact_started_at))::integer / 60
      else null
    end
  ) stored,
  rto_breach            boolean generated always as (
    case
      when rto_target_minutes is not null and impact_ended_at is not null
      then (extract(epoch from (impact_ended_at - impact_started_at)) / 60)
           > rto_target_minutes
      else false
    end
  ) stored,

  -- Clients affected by this specific service disruption
  clients_affected      integer,

  -- Notes
  impact_notes          text,
  recovery_actions      text,
  organisation_id       uuid          not null
                                       references gov_repo.organisations (organisation_id),
  created_at            timestamptz   not null default now()
);

comment on table gov_repo.ict_incident_affected_services is
  'Per-service impact register. One row per affected service per incident.
   Enables precise DORA Art. 18 classification threshold assessment:
   - Critical function down for > 2h → presumptive major incident
   - Important function down for > 4h → presumptive major incident
   ict_function_type drives the applicable threshold.
   rto_breach = true on any critical/important service triggers escalation.
   Feeds v_ict_dora_reporting_status and v_ict_major_incident_dashboard.';

create index idx_ict_services_incident
  on gov_repo.ict_incident_affected_services (incident_id);

create index idx_ict_services_org
  on gov_repo.ict_incident_affected_services (organisation_id);

create index idx_ict_services_ai_system
  on gov_repo.ict_incident_affected_services (ai_system_id)
  where ai_system_id is not null;

create index idx_ict_services_agent
  on gov_repo.ict_incident_affected_services (agent_id)
  where agent_id is not null;

create index idx_ict_services_rto_breach
  on gov_repo.ict_incident_affected_services (incident_id)
  where rto_breach = true;

create index idx_ict_services_ict_function
  on gov_repo.ict_incident_affected_services (ict_function_type)
  where ict_function_type in ('critical','important');

alter table gov_repo.ict_incident_affected_services enable row level security;

create policy "Service role full access ict_incident_affected_services"
  on gov_repo.ict_incident_affected_services for all to service_role
  using (true) with check (true);

create policy "Org-scoped read ict_incident_affected_services"
  on gov_repo.ict_incident_affected_services for select to authenticated
  using (organisation_id = (
    select organisation_id from gov_repo.governance_users
    where email = auth.email() limit 1
  ));

-- =============================================================================
-- [C6] TABLE-LEVEL CONSTRAINTS ON ict_incidents
-- =============================================================================

-- Major incident requires rationale
alter table gov_repo.ict_incidents
  add constraint ict_major_requires_rationale check (
    not is_major_incident
    or major_classification_rationale is not null
  );

-- Resolved incidents must have resolved_at populated
alter table gov_repo.ict_incidents
  add constraint ict_resolved_has_timestamp check (
    status not in ('resolved','closed')
    or resolved_at is not null
  );

-- Closed incidents must have closure rationale
alter table gov_repo.ict_incidents
  add constraint ict_closed_requires_rationale check (
    status != 'closed'
    or (closed_at is not null and closure_rationale is not null)
  );

-- DORA deadlines require major incident flag
alter table gov_repo.ict_incidents
  add constraint ict_dora_deadlines_require_major check (
    initial_notification_deadline is null
    or is_major_incident = true
  );

-- RCA completion consistency
alter table gov_repo.ict_incidents
  add constraint ict_rca_completion_consistent check (
    (rca_started_at is null) = (rca_conducted_by is null)
  );

-- Detection must precede reporting
alter table gov_repo.ict_incidents
  add constraint ict_detection_before_report check (
    detected_at is null
    or reported_at is null
    or detected_at <= reported_at
  );

-- Occurrence must precede detection
alter table gov_repo.ict_incidents
  add constraint ict_occurrence_before_detection check (
    occurred_at is null
    or detected_at is null
    or occurred_at <= detected_at
  );

-- GDPR breach notification requires DPA deadline
alter table gov_repo.ict_incidents
  add constraint ict_gdpr_deadline_when_pii check (
    not pii_data_exposed
    or dpa_notification_deadline is not null
  );

-- =============================================================================
-- [C7] INDEXES ON ict_incidents
-- Existing: idx_ict_incidents_org
-- All new indexes use prefix idx_ict_inc_*
-- =============================================================================

-- Core classification
create index idx_ict_inc_severity
  on gov_repo.ict_incidents (severity);

create index idx_ict_inc_status
  on gov_repo.ict_incidents (status);

create index idx_ict_inc_category
  on gov_repo.ict_incidents (incident_category);

create index idx_ict_inc_major
  on gov_repo.ict_incidents (organisation_id)
  where is_major_incident = true;

-- DORA reporting SLA
create index idx_ict_inc_reporting_phase
  on gov_repo.ict_incidents (reporting_phase)
  where reporting_phase not in ('not_required','all_complete');

create index idx_ict_inc_initial_notif_deadline
  on gov_repo.ict_incidents (initial_notification_deadline)
  where is_major_incident = true
    and initial_notification_sent_at is null;

create index idx_ict_inc_intermediate_deadline
  on gov_repo.ict_incidents (intermediate_report_deadline)
  where is_major_incident = true
    and intermediate_report_sent_at is null;

create index idx_ict_inc_final_deadline
  on gov_repo.ict_incidents (final_report_deadline)
  where is_major_incident = true
    and final_report_sent_at is null;

-- Recovery tracking
create index idx_ict_inc_recovery_status
  on gov_repo.ict_incidents (recovery_status)
  where recovery_status not in ('closed');

create index idx_ict_inc_rto_breach
  on gov_repo.ict_incidents (organisation_id)
  where rto_breach = true;

-- AI system involvement
create index idx_ict_inc_ai_system
  on gov_repo.ict_incidents (primary_ai_system_id)
  where primary_ai_system_id is not null;

create index idx_ict_inc_ai_flag
  on gov_repo.ict_incidents (organisation_id)
  where involves_ai_system = true;

-- Third party
create index idx_ict_inc_provider
  on gov_repo.ict_incidents (primary_provider_id)
  where primary_provider_id is not null;

create index idx_ict_inc_third_party
  on gov_repo.ict_incidents (organisation_id)
  where involves_third_party = true;

-- Data exposure
create index idx_ict_inc_pii
  on gov_repo.ict_incidents (organisation_id)
  where pii_data_exposed = true;

create index idx_ict_inc_gdpr_deadline
  on gov_repo.ict_incidents (dpa_notification_deadline)
  where pii_data_exposed = true
    and gdpr_breach_notified = false;

-- Timeline
create index idx_ict_inc_occurred_at
  on gov_repo.ict_incidents (occurred_at desc)
  where occurred_at is not null;

create index idx_ict_inc_detected_at
  on gov_repo.ict_incidents (detected_at desc)
  where detected_at is not null;

-- Commander and reporter
create index idx_ict_inc_commander
  on gov_repo.ict_incidents (incident_commander_id)
  where incident_commander_id is not null;

-- GIN indexes
create index idx_ict_inc_impacted_systems
  on gov_repo.ict_incidents using gin (impacted_system_ids);

create index idx_ict_inc_impacted_agents
  on gov_repo.ict_incidents using gin (impacted_agent_ids);

create index idx_ict_inc_impacted_providers
  on gov_repo.ict_incidents using gin (impacted_provider_ids);

create index idx_ict_inc_control_failures
  on gov_repo.ict_incidents using gin (control_failures);

create index idx_ict_inc_tags
  on gov_repo.ict_incidents using gin (tags);

-- =============================================================================
-- [C8] TRIGGERS
-- trg_ict_incidents_updated_at already exists from M006 — NOT recreated.
-- New triggers: DORA deadline computation + GDPR deadline + major flag helper.
-- =============================================================================

-- Auto-compute DORA reporting deadlines when is_major_incident is set to TRUE
create or replace function gov_repo.compute_dora_reporting_deadlines()
returns trigger language plpgsql as $$
begin
  -- When an incident becomes "major", compute the three DORA Art. 19 deadlines
  if new.is_major_incident = true and (
    old.is_major_incident is distinct from true
  ) then
    -- Deadline 1: initial notification within 4 hours of classification
    new.initial_notification_deadline :=
      now() + interval '4 hours';

    -- Deadline 2: intermediate report within 72 hours of initial notification
    -- (Approximated from classification time; updated when initial_notification_sent_at is set)
    new.intermediate_report_deadline :=
      now() + interval '72 hours';

    -- Deadline 3: final report within 1 month of initial notification
    new.final_report_deadline :=
      now() + interval '1 month';

    -- Set reporting phase to initial notification
    new.reporting_phase := 'initial_notification';

  end if;

  -- When intermediate report is sent, recompute intermediate deadline precisely
  -- (was estimated from classification; now measured from actual initial submission)
  if new.initial_notification_sent_at is not null
     and old.initial_notification_sent_at is null then
    new.intermediate_report_deadline :=
      new.initial_notification_sent_at + interval '72 hours';
    new.final_report_deadline :=
      new.initial_notification_sent_at + interval '1 month';
    new.reporting_phase := 'intermediate_report';
  end if;

  -- Track phase progression
  if new.intermediate_report_sent_at is not null
     and old.intermediate_report_sent_at is null then
    new.reporting_phase := 'final_report';
  end if;

  if new.final_report_sent_at is not null
     and old.final_report_sent_at is null then
    new.reporting_phase := 'all_complete';
  end if;

  -- Auto-compute GDPR DPA deadline when PII exposure is flagged
  if new.pii_data_exposed = true
     and old.pii_data_exposed is distinct from true
     and new.dpa_notification_deadline is null then
    -- GDPR Art. 33: 72 hours from becoming aware (use detected_at, else now())
    new.dpa_notification_deadline :=
      coalesce(new.detected_at, now()) + interval '72 hours';
  end if;

  -- Auto-set involves_ai_system flag if primary_ai_system_id is set
  if new.primary_ai_system_id is not null then
    new.involves_ai_system := true;
  end if;

  -- Auto-set involves_third_party flag if primary_provider_id is set
  if new.primary_provider_id is not null then
    new.involves_third_party := true;
  end if;

  return new;
end;
$$;

comment on function gov_repo.compute_dora_reporting_deadlines is
  'Auto-computes DORA Art. 19 reporting deadlines and GDPR Art. 33 DPA deadline.
   Fires BEFORE INSERT OR UPDATE on ict_incidents.
   DORA deadlines:
     initial_notification  = classification time + 4h
     intermediate_report   = initial_notification_sent_at + 72h (recalibrated when sent)
     final_report          = initial_notification_sent_at + 1 month
   GDPR DPA deadline = detected_at + 72h (when pii_data_exposed set to true).
   reporting_phase is auto-advanced as each report is submitted.';

create trigger trg_ict_inc_dora_deadlines
  before insert or update on gov_repo.ict_incidents
  for each row execute function gov_repo.compute_dora_reporting_deadlines();

-- Update ai_systems.serious_incidents_reported when an ICT incident
-- involving an AI system is closed
create or replace function gov_repo.sync_ai_system_incident_count()
returns trigger language plpgsql as $$
begin
  -- When incident is linked to an AI system and closed, increment counter
  if new.primary_ai_system_id is not null
     and new.status = 'closed'
     and (old.status is null or old.status != 'closed') then
    update gov_repo.ai_systems
    set
      serious_incidents_reported = serious_incidents_reported + 1,
      last_serious_incident_at   = now()
    where system_id = new.primary_ai_system_id;
  end if;
  return new;
end;
$$;

comment on function gov_repo.sync_ai_system_incident_count is
  'Keeps gov_repo.ai_systems.serious_incidents_reported in sync.
   Fires AFTER INSERT OR UPDATE on ict_incidents.
   AI Act Art. 72(2): post-market surveillance must track serious incidents.
   Increments counter only when incident is closed (not on every status change).';

create trigger trg_ict_inc_ai_system_sync
  after insert or update of status, primary_ai_system_id
  on gov_repo.ict_incidents
  for each row execute function gov_repo.sync_ai_system_incident_count();

-- =============================================================================
-- [C9] RLS — ict_incidents
-- Existing policies from M006:
--   "Service role full access ict_incidents"  — FOR ALL, service_role
--   "Org-scoped ict_incidents"                — FOR SELECT, authenticated
-- Changes:
--   Drop the M006 SELECT policy and replace with identically-scoped policy
--   under the canonical name used across all gov_repo tables.
--   Add INSERT policy for self-reporting by authenticated users.
-- =============================================================================

-- Replace the M006 stub SELECT policy with the canonical name
drop policy if exists "Org-scoped ict_incidents" on gov_repo.ict_incidents;

create policy "Authenticated read ict_incidents"
  on gov_repo.ict_incidents for select to authenticated
  using (organisation_id = (
    select organisation_id from gov_repo.governance_users
    where email = auth.email() limit 1
  ));

create policy "Incident reporters can insert"
  on gov_repo.ict_incidents for insert to authenticated
  with check (
    organisation_id = (
      select organisation_id from gov_repo.governance_users
      where email = auth.email() limit 1
    )
    and reported_by = (
      select user_id from gov_repo.governance_users
      where email = auth.email() limit 1
    )
  );

-- =============================================================================
-- [C10] VIEWS
-- =============================================================================

-- ─── VIEW 1: DORA Major Incident Dashboard ───────────────────────────────────

create or replace view gov_repo.v_ict_major_incident_dashboard as
select
  i.organisation_id,
  i.incident_id,
  i.incident_code,
  i.title,
  i.severity,
  i.incident_category,
  i.status,
  i.recovery_status,
  i.reporting_phase,
  -- Timeline
  i.occurred_at,
  i.detected_at,
  i.reported_at,
  i.contained_at,
  i.recovery_completed_at,
  i.closed_at,
  -- Detection lag (hours)
  round(
    extract(epoch from (i.detected_at - i.occurred_at)) / 3600.0, 1
  )                                                           as detection_lag_hours,
  -- DORA reporting status
  i.is_major_incident,
  i.competent_authority,
  i.nca_case_ref,
  -- Initial notification
  i.initial_notification_deadline,
  i.initial_notification_sent_at,
  (i.initial_notification_sent_at is null
   and i.initial_notification_deadline < now())              as initial_notif_breached,
  round(
    extract(epoch from (
      i.initial_notification_deadline - now()
    )) / 3600.0, 1
  )                                                           as initial_notif_hours_remaining,
  -- Intermediate report
  i.intermediate_report_deadline,
  i.intermediate_report_sent_at,
  (i.intermediate_report_sent_at is null
   and i.intermediate_report_deadline < now())               as intermediate_report_breached,
  -- Final report
  i.final_report_deadline,
  i.final_report_sent_at,
  (i.final_report_sent_at is null
   and i.final_report_deadline < now())                      as final_report_breached,
  -- RTO performance
  i.rto_target_minutes,
  i.rto_actual_minutes,
  i.rto_breach,
  -- AI involvement
  i.involves_ai_system,
  s.name                                                      as primary_ai_system_name,
  s.risk_class                                                as ai_system_risk_class,
  i.ai_act_reporting_required,
  -- Third-party involvement
  i.involves_third_party,
  p.name                                                      as primary_provider_name,
  p.dora_criticality                                          as provider_dora_criticality,
  i.concentration_risk_flag,
  -- Data exposure
  i.pii_data_exposed,
  i.gdpr_breach_notified,
  i.dpa_notification_deadline,
  (i.pii_data_exposed = true
   and i.gdpr_breach_notified = false
   and i.dpa_notification_deadline < now())                  as gdpr_deadline_breached,
  -- Financial impact
  i.financial_impact_eur,
  i.direct_financial_loss_eur,
  -- People
  u_cmd.full_name                                             as incident_commander,
  u_rep.full_name                                             as reporting_owner,
  u_rpt.full_name                                             as reported_by_name,
  -- Affected services summary
  (select count(*)
   from gov_repo.ict_incident_affected_services svc
   where svc.incident_id = i.incident_id)                    as affected_services_count,
  (select count(*)
   from gov_repo.ict_incident_affected_services svc
   where svc.incident_id = i.incident_id
     and svc.rto_breach = true)                              as services_with_rto_breach,
  -- Notifications submitted
  (select count(*)
   from gov_repo.ict_incident_notifications n
   where n.incident_id = i.incident_id)                      as notifications_submitted,
  (select count(*)
   from gov_repo.ict_incident_notifications n
   where n.incident_id = i.incident_id
     and n.is_breached = true)                               as notifications_breached
from gov_repo.ict_incidents i
left join gov_repo.ai_systems                s on s.system_id   = i.primary_ai_system_id
left join gov_repo.third_party_providers     p on p.provider_id = i.primary_provider_id
left join gov_repo.governance_users  u_cmd on u_cmd.user_id = i.incident_commander_id
left join gov_repo.governance_users  u_rep on u_rep.user_id = i.reporting_owner_id
left join gov_repo.governance_users  u_rpt on u_rpt.user_id = i.reported_by
where i.is_major_incident = true
  and i.status not in ('closed')
order by
  case i.severity
    when 'critical' then 1
    when 'high'     then 2
    when 'medium'   then 3
    else 4
  end,
  i.occurred_at desc nulls last;

comment on view gov_repo.v_ict_major_incident_dashboard is
  'DORA Art. 19 major incident dashboard. Active major incidents only (not closed).
   Shows all three reporting deadlines with breach flags.
   detection_lag_hours: key resilience KPI — time from occurrence to detection.
   initial_notif_hours_remaining: countdown to 4-hour DORA deadline.
   Use for: CISO war room, DORA reporting officer dashboard, NCA evidence preparation.
   For all incidents (including closed): query gov_repo.ict_incidents directly.';

-- ─── VIEW 2: DORA Reporting Status ───────────────────────────────────────────

create or replace view gov_repo.v_ict_dora_reporting_status as
select
  i.organisation_id,
  i.incident_id,
  i.incident_code,
  i.title,
  i.severity,
  i.is_major_incident,
  i.reporting_phase,
  i.competent_authority,
  i.nca_case_ref,
  -- Initial notification
  i.initial_notification_deadline,
  i.initial_notification_sent_at,
  i.initial_notification_ref,
  (i.initial_notification_sent_at is null
   and i.initial_notification_deadline is not null
   and i.initial_notification_deadline < now())             as initial_overdue,
  -- Intermediate report
  i.intermediate_report_deadline,
  i.intermediate_report_sent_at,
  i.intermediate_report_ref,
  (i.intermediate_report_sent_at is null
   and i.intermediate_report_deadline is not null
   and i.intermediate_report_deadline < now())              as intermediate_overdue,
  -- Final report
  i.final_report_deadline,
  i.final_report_sent_at,
  i.final_report_ref,
  (i.final_report_sent_at is null
   and i.final_report_deadline is not null
   and i.final_report_deadline < now())                     as final_overdue,
  -- Overall reporting compliance
  (
    (i.initial_notification_sent_at is not null
      and i.initial_notification_sent_at <= i.initial_notification_deadline)
    and
    (i.intermediate_report_sent_at is not null
      and i.intermediate_report_sent_at <= i.intermediate_report_deadline)
    and
    (i.final_report_sent_at is not null
      and i.final_report_sent_at <= i.final_report_deadline)
  )                                                          as fully_compliant,
  -- Notification records
  (select count(*)
   from gov_repo.ict_incident_notifications n
   where n.incident_id = i.incident_id
     and n.is_breached = true)                              as breach_count,
  -- Voluntary notification
  i.voluntary_notif_sent_at,
  -- Timestamps
  i.occurred_at,
  i.reported_at
from gov_repo.ict_incidents i
where i.is_major_incident = true
order by
  case
    when i.initial_notification_sent_at is null
         and i.initial_notification_deadline < now() then 1  -- overdue
    when i.initial_notification_deadline is not null
         and i.initial_notification_deadline > now()
         and extract(epoch from (i.initial_notification_deadline - now())) < 3600 then 2  -- < 1h remaining
    else 3
  end,
  i.initial_notification_deadline asc;

comment on view gov_repo.v_ict_dora_reporting_status is
  'DORA Art. 19 reporting SLA compliance per major incident.
   fully_compliant = all three reports submitted on time.
   initial_overdue / intermediate_overdue / final_overdue: actionable gap indicators.
   Sorted: overdue first, then < 1h remaining, then remaining by deadline.
   Use for: DORA reporting officer dashboard, audit evidence, supervisory requests.';

-- ─── VIEW 3: ICT Incident AI Impact Lens ─────────────────────────────────────

create or replace view gov_repo.v_ict_ai_impact_lens as
select
  i.organisation_id,
  i.incident_id,
  i.incident_code,
  i.title,
  i.severity,
  i.incident_category,
  i.status,
  i.recovery_status,
  i.involves_ai_system,
  -- Primary AI system
  s.system_id,
  s.system_code,
  s.name                                                      as ai_system_name,
  s.risk_class                                                as ai_system_risk_class,
  s.lifecycle                                                 as ai_system_lifecycle,
  -- AI Act reporting
  i.ai_act_reporting_required,
  i.ai_serious_incident_id,
  -- AI root cause
  i.ai_root_cause_type,
  -- Control failures in this incident
  i.control_failures,
  -- Impact on all systems (array)
  i.impacted_system_ids,
  i.impacted_agent_ids,
  -- Affected services that are AI
  (select count(*)
   from gov_repo.ict_incident_affected_services svc
   where svc.incident_id = i.incident_id
     and svc.ai_system_id is not null)                       as ai_services_affected,
  -- Financial impact
  i.financial_impact_eur,
  -- RTO
  i.rto_target_minutes,
  i.rto_actual_minutes,
  i.rto_breach,
  -- Timeline
  i.occurred_at,
  i.detected_at,
  i.recovery_completed_at,
  -- Owner
  u.full_name                                                 as ai_system_owner
from gov_repo.ict_incidents i
left join gov_repo.ai_systems s      on s.system_id = i.primary_ai_system_id
left join gov_repo.governance_users u on u.user_id   = s.owner_user_id
where i.involves_ai_system = true
order by
  case i.severity
    when 'critical' then 1
    when 'high'     then 2
    else 3
  end,
  i.occurred_at desc nulls last;

comment on view gov_repo.v_ict_ai_impact_lens is
  'All ICT incidents involving AI systems.
   Bridges ICT incident management (DORA) with AI governance (AI Act Art. 73).
   ai_serious_incident_id: links to gov_repo.ai_serious_incidents when incident
   also constitutes a serious AI incident requiring Art. 73 provider reporting.
   control_failures: which CG-AG controls failed — feeds into control re-assessment.
   Use for: CISO AI risk dashboard, post-market surveillance evidence (Art. 72),
   AI Act Art. 73 reporting triage.';

-- ─── VIEW 4: Recovery Tracker ────────────────────────────────────────────────

create or replace view gov_repo.v_ict_recovery_tracker as
select
  i.organisation_id,
  i.incident_id,
  i.incident_code,
  i.title,
  i.severity,
  i.status,
  i.recovery_status,
  -- Recovery timeline
  i.occurred_at,
  i.contained_at,
  i.eradication_started_at,
  i.eradication_completed_at,
  i.recovery_started_at,
  i.recovery_completed_at,
  i.monitoring_started_at,
  i.monitoring_ends_at,
  -- RTO/RPO
  i.rto_target_minutes,
  i.rto_actual_minutes,
  i.rto_breach,
  i.rpo_target_minutes,
  i.data_loss_minutes,
  i.rpo_breach,
  -- Workaround vs permanent fix
  i.workaround_applied,
  i.permanent_fix_applied,
  i.permanent_fix_date,
  -- PIR
  i.pir_conducted,
  i.pir_date,
  i.lessons_learned is not null                               as lessons_learned_documented,
  -- Progress percentage (approximate — based on recovery_status)
  case i.recovery_status
    when 'not_started'             then 0
    when 'containment_active'      then 15
    when 'eradication_active'      then 35
    when 'recovery_active'         then 55
    when 'restored_partial'        then 70
    when 'restored_full'           then 85
    when 'monitoring_period'       then 90
    when 'lessons_learned_pending' then 95
    when 'closed'                  then 100
    else 0
  end                                                         as recovery_progress_pct,
  -- Third-party involvement affects recovery complexity
  i.involves_third_party,
  p.name                                                      as provider_name,
  i.provider_sla_breach,
  -- Incident commander
  u.full_name                                                 as incident_commander
from gov_repo.ict_incidents i
left join gov_repo.third_party_providers p  on p.provider_id = i.primary_provider_id
left join gov_repo.governance_users      u  on u.user_id     = i.incident_commander_id
where i.status not in ('closed')
order by
  case i.recovery_status
    when 'not_started'        then 1
    when 'containment_active' then 2
    when 'eradication_active' then 3
    when 'recovery_active'    then 4
    when 'restored_partial'   then 5
    else 6
  end,
  case i.severity
    when 'critical' then 1
    when 'high'     then 2
    else 3
  end;

comment on view gov_repo.v_ict_recovery_tracker is
  'Active incident recovery progress tracker.
   recovery_progress_pct: approximate 0-100% completion based on recovery_status.
   rto_breach / rpo_breach: GENERATED columns — automatically true when targets exceeded.
   pir_conducted: lessons learned completion tracking (ISO 27035-3).
   DORA Art. 11: RTO/RPO must be tested and documented — this view provides
   evidence of actual vs target performance for DORA resilience reports.';

-- ─── VIEW 5: Third-Party Incident Concentration ──────────────────────────────

create or replace view gov_repo.v_ict_third_party_incident_concentration as
select
  p.organisation_id,
  p.provider_id,
  p.provider_code,
  p.name                                                      as provider_name,
  p.service_type,
  p.dora_criticality,
  p.status                                                    as provider_status,
  p.contract_expires_at,
  p.exit_plan_documented,
  p.concentration_risk_score,
  -- Incident history
  count(i.incident_id)                                        as total_incidents,
  count(i.incident_id) filter (where i.is_major_incident)    as major_incidents,
  count(i.incident_id) filter (
    where i.severity = 'critical'
  )                                                           as critical_incidents,
  count(i.incident_id) filter (
    where i.status not in ('resolved','closed')
  )                                                           as open_incidents,
  max(i.occurred_at)                                          as last_incident_at,
  -- Financial exposure
  coalesce(sum(i.financial_impact_eur), 0)                   as total_financial_impact_eur,
  -- RTO performance
  count(i.incident_id) filter (where i.rto_breach = true)    as rto_breaches,
  -- Linked agents/systems
  (select count(distinct rl.agent_id)
   from gov_repo.agent_resource_links rl
   where rl.provider_id = p.provider_id
     and rl.is_active = true)                                 as linked_agents,
  (select count(distinct a.ai_system_id)
   from gov_repo.agent_resource_links rl
   join gov_repo.agents a on a.agent_id = rl.agent_id
   where rl.provider_id = p.provider_id
     and rl.is_active = true
     and a.ai_system_id is not null)                         as linked_ai_systems
from gov_repo.third_party_providers p
left join gov_repo.ict_incidents i
  on i.primary_provider_id = p.provider_id
group by
  p.organisation_id, p.provider_id, p.provider_code, p.name,
  p.service_type, p.dora_criticality, p.status,
  p.contract_expires_at, p.exit_plan_documented, p.concentration_risk_score
order by
  major_incidents desc,
  total_incidents desc,
  p.dora_criticality;

comment on view gov_repo.v_ict_third_party_incident_concentration is
  'DORA Art. 29 third-party concentration risk with incident history.
   Combines: provider register, incident history, linked agents/systems.
   major_incidents: providers with most major incidents = highest concentration risk.
   exit_plan_documented: DORA Art. 28(8) — exit strategy must be documented.
   Use for: DORA Art. 28 register submission, concentration risk reporting,
   NCA supervisory requests on third-party dependencies.';

-- =============================================================================
-- [C11] FUNCTIONS
-- =============================================================================

-- ─── FUNCTION 1: ICT Incident DORA Classification Check ──────────────────────

create or replace function gov_repo.ict_incident_classify_major(
  p_incident_id uuid
)
returns table (
  is_major                    boolean,
  classification_basis        text[],
  recommended_authority       text,
  initial_notif_deadline      timestamptz,
  intermediate_deadline       timestamptz,
  final_deadline              timestamptz,
  ai_act_reporting_required   boolean,
  gdpr_notification_required  boolean,
  dpa_deadline                timestamptz
)
language plpgsql security definer as $$
declare
  v_inc        record;
  v_basis      text[] := '{}';
  v_is_major   boolean := false;
  v_authority  text;
begin
  select * into v_inc
  from gov_repo.ict_incidents
  where incident_id = p_incident_id;

  if not found then
    raise exception 'Incident % not found', p_incident_id;
  end if;

  -- EBA RTS classification criteria assessment
  if v_inc.criterion_clients_affected then
    v_is_major := true;
    v_basis := v_basis || 'EBA RTS Criterion: client threshold exceeded';
  end if;

  if v_inc.criterion_financial_threshold then
    v_is_major := true;
    v_basis := v_basis || 'EBA RTS Criterion: financial impact threshold exceeded';
  end if;

  if v_inc.criterion_critical_service_down then
    v_is_major := true;
    v_basis := v_basis || 'EBA RTS Criterion: critical ICT function unavailable > threshold';
  end if;

  if v_inc.criterion_reputational_impact then
    v_is_major := true;
    v_basis := v_basis || 'EBA RTS Criterion: reputational impact assessed';
  end if;

  if v_inc.criterion_data_integrity_loss then
    v_is_major := true;
    v_basis := v_basis || 'EBA RTS Criterion: data integrity or confidentiality loss';
  end if;

  if v_inc.criterion_duration_exceeded then
    v_is_major := true;
    v_basis := v_basis || 'EBA RTS Criterion: duration threshold exceeded';
  end if;

  if v_inc.criterion_geographic_spread then
    v_is_major := true;
    v_basis := v_basis || 'EBA RTS Criterion: geographic spread across regions';
  end if;

  if v_inc.severity = 'critical' then
    v_is_major := true;
    v_basis := v_basis || 'Severity: critical — presumptive major incident';
  end if;

  -- Authority recommendation (simplified — real logic is jurisdiction-specific)
  v_authority := case
    when v_inc.organisation_id is not null then 'Home NCA / ECB (SSM) — confirm with compliance'
    else 'Undetermined — consult legal'
  end;

  return query select
    v_is_major,
    v_basis,
    v_authority,
    case when v_is_major then now() + interval '4 hours'  else null end,
    case when v_is_major then now() + interval '72 hours' else null end,
    case when v_is_major then now() + interval '1 month'  else null end,
    -- AI Act reporting required when AI system is involved and incident is serious
    (v_inc.involves_ai_system = true and v_inc.severity in ('critical','high')),
    -- GDPR notification required when PII is exposed
    v_inc.pii_data_exposed,
    case when v_inc.pii_data_exposed
         then coalesce(v_inc.detected_at, now()) + interval '72 hours'
         else null end;
end;
$$;

comment on function gov_repo.ict_incident_classify_major is
  'Applies EBA RTS criteria to determine if an incident qualifies as "major" under DORA Art. 18.
   Returns: is_major flag, classification basis (list of triggered criteria),
   recommended competent authority, computed DORA deadlines, and parallel obligations.
   Use this function BEFORE setting is_major_incident = true on the incident record:
     SELECT * FROM gov_repo.ict_incident_classify_major(''<incident_id>'');
   After review, update the incident: UPDATE ict_incidents SET is_major_incident = true,
   major_classification_rationale = ''...''.
   The trigger trg_ict_inc_dora_deadlines then auto-computes the deadlines.';

-- ─── FUNCTION 2: DORA Reporting SLA Status ───────────────────────────────────

create or replace function gov_repo.ict_dora_sla_status(
  p_organisation_id uuid
)
returns table (
  incident_id                 uuid,
  incident_code               varchar,
  title                       varchar,
  severity                    gov_repo.incident_severity,
  reporting_phase             gov_repo.dora_reporting_phase,
  initial_notif_status        text,
  initial_notif_minutes_left  integer,
  intermediate_status         text,
  intermediate_minutes_left   integer,
  final_status                text,
  final_minutes_left          integer,
  overall_sla_status          text,
  gdpr_status                 text,
  gdpr_minutes_left           integer
)
language sql security definer as $$
  select
    i.incident_id,
    i.incident_code,
    i.title,
    i.severity,
    i.reporting_phase,

    -- Initial notification status
    case
      when i.initial_notification_sent_at is not null
           and i.initial_notification_sent_at <= i.initial_notification_deadline
        then 'submitted_on_time'
      when i.initial_notification_sent_at is not null
           and i.initial_notification_sent_at > i.initial_notification_deadline
        then 'submitted_late'
      when i.initial_notification_deadline < now()
        then 'overdue'
      when i.initial_notification_deadline is null
        then 'not_required'
      else 'pending'
    end,

    -- Minutes until initial notification deadline (negative = overdue)
    case
      when i.initial_notification_deadline is not null
        then extract(epoch from (i.initial_notification_deadline - now()))::integer / 60
      else null
    end,

    -- Intermediate report status
    case
      when i.intermediate_report_sent_at is not null
           and i.intermediate_report_sent_at <= i.intermediate_report_deadline
        then 'submitted_on_time'
      when i.intermediate_report_sent_at is not null
           and i.intermediate_report_sent_at > i.intermediate_report_deadline
        then 'submitted_late'
      when i.intermediate_report_deadline is not null
           and i.intermediate_report_deadline < now()
           and i.intermediate_report_sent_at is null
        then 'overdue'
      when i.intermediate_report_deadline is null
        then 'not_required'
      else 'pending'
    end,

    case
      when i.intermediate_report_deadline is not null
        then extract(epoch from (i.intermediate_report_deadline - now()))::integer / 60
      else null
    end,

    -- Final report status
    case
      when i.final_report_sent_at is not null
           and i.final_report_sent_at <= i.final_report_deadline
        then 'submitted_on_time'
      when i.final_report_sent_at is not null
           and i.final_report_sent_at > i.final_report_deadline
        then 'submitted_late'
      when i.final_report_deadline is not null
           and i.final_report_deadline < now()
           and i.final_report_sent_at is null
        then 'overdue'
      when i.final_report_deadline is null
        then 'not_required'
      else 'pending'
    end,

    case
      when i.final_report_deadline is not null
        then extract(epoch from (i.final_report_deadline - now()))::integer / 60
      else null
    end,

    -- Overall SLA status
    case
      when not i.is_major_incident
        then 'not_required'
      when (i.initial_notification_sent_at is null
            and i.initial_notification_deadline < now())
        or  (i.intermediate_report_sent_at is null
             and i.intermediate_report_deadline is not null
             and i.intermediate_report_deadline < now())
        or  (i.final_report_sent_at is null
             and i.final_report_deadline is not null
             and i.final_report_deadline < now())
        then 'breach'
      when i.reporting_phase = 'all_complete'
        then 'compliant'
      else 'in_progress'
    end,

    -- GDPR status
    case
      when not i.pii_data_exposed
        then 'not_required'
      when i.gdpr_breach_notified
        then 'notified'
      when i.dpa_notification_deadline < now()
        then 'overdue'
      else 'pending'
    end,

    case
      when i.dpa_notification_deadline is not null
        then extract(epoch from (i.dpa_notification_deadline - now()))::integer / 60
      else null
    end

  from gov_repo.ict_incidents i
  where i.organisation_id = p_organisation_id
    and i.is_major_incident = true
    and i.status not in ('closed')
  order by
    case
      when (i.initial_notification_sent_at is null
            and i.initial_notification_deadline < now()) then 1
      else 2
    end,
    i.initial_notification_deadline asc nulls last;
$$;

comment on function gov_repo.ict_dora_sla_status is
  'Real-time DORA Art. 19 SLA status for all active major incidents.
   Returns per-phase status strings and minutes remaining (negative = overdue).
   overall_sla_status:
     not_required  = incident not classified as major
     breach        = at least one report is overdue
     compliant     = all reports submitted on time
     in_progress   = reporting in progress, no breach yet
   Use for: DORA reporting officer live dashboard, compliance alerts,
   supervisory MIS pack for Board Risk Committee.';

-- ─── FUNCTION 3: Incident Impact Summary ─────────────────────────────────────

create or replace function gov_repo.ict_incident_impact_summary(
  p_incident_id uuid
)
returns table (
  incident_id           uuid,
  incident_code         varchar,
  title                 varchar,
  severity              gov_repo.incident_severity,
  total_downtime_mins   integer,
  rto_breach            boolean,
  rpo_breach            boolean,
  services_affected     bigint,
  critical_services_down bigint,
  ai_systems_affected   bigint,
  agents_affected       bigint,
  providers_affected    bigint,
  clients_affected_total bigint,
  financial_impact_eur  numeric,
  pii_data_exposed      boolean,
  notifications_sent    bigint,
  notifications_overdue bigint,
  recovery_progress_pct integer,
  has_lessons_learned   boolean
)
language sql security definer as $$
  select
    i.incident_id,
    i.incident_code,
    i.title,
    i.severity,
    i.downtime_minutes,
    i.rto_breach,
    i.rpo_breach,
    -- Affected services
    (select count(*) from gov_repo.ict_incident_affected_services s
     where s.incident_id = i.incident_id),
    (select count(*) from gov_repo.ict_incident_affected_services s
     where s.incident_id = i.incident_id
       and s.ict_function_type in ('critical','important')
       and s.service_impact = 'full_outage'),
    -- AI systems / agents
    (select count(distinct s.ai_system_id)
     from gov_repo.ict_incident_affected_services s
     where s.incident_id = i.incident_id
       and s.ai_system_id is not null),
    cardinality(i.impacted_agent_ids),
    cardinality(i.impacted_provider_ids),
    -- Clients
    (select coalesce(sum(s.clients_affected), 0)
     from gov_repo.ict_incident_affected_services s
     where s.incident_id = i.incident_id),
    -- Financial
    coalesce(i.financial_impact_eur, 0),
    -- Data
    i.pii_data_exposed,
    -- Notifications
    (select count(*) from gov_repo.ict_incident_notifications n
     where n.incident_id = i.incident_id),
    (select count(*) from gov_repo.ict_incident_notifications n
     where n.incident_id = i.incident_id and n.is_breached = true),
    -- Recovery progress
    case i.recovery_status
      when 'not_started'             then 0
      when 'containment_active'      then 15
      when 'eradication_active'      then 35
      when 'recovery_active'         then 55
      when 'restored_partial'        then 70
      when 'restored_full'           then 85
      when 'monitoring_period'       then 90
      when 'lessons_learned_pending' then 95
      when 'closed'                  then 100
      else 0
    end,
    (i.lessons_learned is not null)
  from gov_repo.ict_incidents i
  where i.incident_id = p_incident_id;
$$;

comment on function gov_repo.ict_incident_impact_summary is
  'Single-call impact summary for a given incident. Aggregates all child tables.
   Returns: downtime, RTO/RPO performance, services/systems/agents affected,
   client exposure, financial impact, notification compliance, recovery progress.
   Use for: incident report generation, DORA intermediate/final report data,
   board briefing packs, post-incident review input.';

-- =============================================================================
-- [C12] MANDATE SEEDS
-- Adding DORA Art. 17-21 + NIST RESPOND mandates not in original M003 seeds
-- =============================================================================

insert into gov_repo.mandates (
  mandate_code, regulation, section_ref, title,
  requirement_text, requirement_type, effective_date,
  applicability, mapped_controls
)
values
  (
    'DORA-ART-17',
    'DORA (EU 2022/2554)',
    'Art. 17',
    'ICT-Related Incident Management Process',
    'Financial entities shall define, establish and implement an ICT-related incident '
    'management process to detect, manage and notify ICT-related incidents. The process '
    'shall include procedures to classify, escalate and resolve incidents.',
    'mandatory',
    '2025-01-17',
    '{"sectors": ["banking","insurance","investment_firm","payment_institution"]}',
    array['CG-AG-008', 'CG-AG-011']
  ),
  (
    'DORA-ART-18',
    'DORA (EU 2022/2554)',
    'Art. 18',
    'Classification of ICT-Related Incidents',
    'Financial entities shall classify ICT-related incidents using harmonised criteria '
    'including: number of clients affected, duration, geographic spread, data losses, '
    'criticality of services affected, and economic impact. Major incidents require '
    'Art. 19 mandatory reporting.',
    'mandatory',
    '2025-01-17',
    '{"sectors": ["banking","insurance","investment_firm","payment_institution"]}',
    array['CG-AG-010']
  ),
  (
    'DORA-ART-19',
    'DORA (EU 2022/2554)',
    'Art. 19',
    'Reporting of Major ICT-Related Incidents',
    'Financial entities shall report major ICT incidents to the competent authority: '
    'initial notification within 4 hours, intermediate report within 72 hours, '
    'final report within 1 month. Reports must follow EBA ITS templates.',
    'mandatory',
    '2025-01-17',
    '{"sectors": ["banking","insurance","investment_firm","payment_institution"]}',
    array['CG-AG-008']
  ),
  (
    'DORA-ART-20',
    'DORA (EU 2022/2554)',
    'Art. 20',
    'Harmonisation of Reporting Content and Timelines',
    'EBA, ESMA and EIOPA shall develop implementing technical standards to specify '
    'the content, format and templates of reports. Financial entities must use '
    'approved ITS templates for all DORA Art. 19 reports.',
    'mandatory',
    '2025-01-17',
    '{"sectors": ["banking","insurance","investment_firm","payment_institution"]}',
    array['CG-AG-008']
  ),
  (
    'DORA-ART-21',
    'DORA (EU 2022/2554)',
    'Art. 21',
    'Voluntary Notification of Significant Cyber Threats',
    'Financial entities may voluntarily notify competent authorities of significant '
    'cyber threats when there is reason to believe the threat may materialise. '
    'Notifications shall follow prescribed templates.',
    'recommended',
    '2025-01-17',
    '{"sectors": ["banking","insurance","investment_firm","payment_institution"]}',
    array['CG-AG-010']
  ),
  (
    'NIST-RESPOND-1-1',
    'NIST AI RMF 1.0',
    'RESPOND 1.1',
    'Incident Response Policies and Procedures',
    'Policies, procedures and practices are in place to address AI risks that occur '
    'during deployment and use of AI systems. Incident response plans include AI-specific '
    'failure modes and escalation procedures.',
    'recommended',
    '2023-01-26',
    '{"sectors": ["all"]}',
    array['CG-AG-007', 'CG-AG-008', 'CG-AG-012']
  ),
  (
    'NIST-RESPOND-2-1',
    'NIST AI RMF 1.0',
    'RESPOND 2.1',
    'Incident Containment and Recovery',
    'Responses to AI risks and incidents are communicated to relevant stakeholders. '
    'Lessons learned are reflected in future AI risk management activities and '
    'organizational policies.',
    'recommended',
    '2023-01-26',
    '{"sectors": ["all"]}',
    array['CG-AG-008', 'CG-AG-010']
  ),
  (
    'ISO42001-8-2',
    'ISO/IEC 42001:2023',
    'Clause 8.2',
    'AI System Incident Management',
    'The organisation shall establish, implement and maintain an AI incident management '
    'process including: incident identification, classification, root cause analysis, '
    'corrective action, and lessons learned integration back into the AIMS.',
    'mandatory',
    '2023-12-18',
    '{"sectors": ["all"]}',
    array['CG-AG-008', 'CG-AG-010', 'CG-AG-012']
  ),
  (
    'ISO27001-A-5-24',
    'ISO/IEC 27001:2022',
    'A.5.24',
    'Information Security Incident Management Planning and Preparation',
    'The organisation shall plan and prepare for managing information security incidents '
    'including: roles and responsibilities, escalation processes, evidence preservation, '
    'communication procedures, and regulatory notification workflows.',
    'mandatory',
    '2022-10-25',
    '{"sectors": ["all"]}',
    array['CG-AG-008']
  ),
  (
    'ISO27001-A-5-26',
    'ISO/IEC 27001:2022',
    'A.5.26',
    'Response to Information Security Incidents',
    'Incidents shall be responded to in accordance with documented procedures. '
    'Responses shall include containment, evidence preservation, root cause analysis, '
    'eradication, recovery, and post-incident review.',
    'mandatory',
    '2022-10-25',
    '{"sectors": ["all"]}',
    array['CG-AG-008']
  )
on conflict (mandate_code) do nothing;

-- =============================================================================
-- [C13] GRANTS
-- =============================================================================

grant execute on function gov_repo.compute_dora_reporting_deadlines  to service_role;
grant execute on function gov_repo.sync_ai_system_incident_count      to service_role;
grant execute on function gov_repo.ict_incident_classify_major        to service_role, authenticated;
grant execute on function gov_repo.ict_dora_sla_status                to service_role, authenticated;
grant execute on function gov_repo.ict_incident_impact_summary        to service_role, authenticated;
