-- =============================================================================
-- CODEGUARD AI GOVERNANCE OS
-- Migration: 20260618006500_ai_systems_complete
-- Domain:    AI Systems Registry — Full Production Implementation
-- Depends:   20260618005000_agent_registry_graph  (agents table must exist)
--            20260618004000 (conformity_assessments, evidence, governance_policies)
-- Self-contained: includes M006 stub guard — safe to run without M006 applied.
-- Replaces:  gov_repo.ai_systems stub created in M006 with complete schema
-- Version:   1.1 — Self-contained guard added
-- =============================================================================
-- Context:
--   Migration 20260618006000 created a minimal gov_repo.ai_systems stub with
--   9 columns and added fk_agent_ai_system on agents.ai_system_id.
--   This migration expands ai_systems to the full production schema required by:
--     - EU AI Act (2024/1689): Art. 6, 9, 10, 11, 13, 14, 15, 16, 17, 43, 47, 49, 72
--     - DORA (2022/2554): Art. 8, 9, 11
--     - ISO/IEC 42001:2023: 6.1, 6.2, 8.4, 9.1
--     - NIST AI RMF 1.0: GOVERN, MAP, MEASURE, MANAGE
--     - ISO/IEC 27001:2022: A.5.9, A.5.12, A.8.8
-- =============================================================================
-- What this migration does:
--   [S1]  Add new ENUM types for AI System lifecycle and CE marking
--   [S2]  Expand gov_repo.ai_systems with 60+ additional columns via ALTER TABLE
--   [S3]  Add all indexes (functional, partial, GIN)
--   [S4]  Add triggers (updated_at already exists from M006; add compliance trigger)
--   [S5]  Enable RLS + policies (RLS already enabled from M006; add missing policies)
--   [S6]  Add governance views (4 views)
--   [S7]  Add governance functions (2 functions)
--   [S8]  Add new mandate seeds for M006 gaps
--   [S9]  Grants
-- =============================================================================
-- Naming conventions (no conflicts with existing names):
--   Tables:    gov_repo.ai_systems (exists, expanded here)
--   Enums:     gov_repo.ai_system_lifecycle  (new)
--              gov_repo.ce_marking_status     (new)
--              gov_repo.annex_iii_sector       (new)
--              gov_repo.gpai_tier              (new)
--              gov_repo.provider_role          (new)
--   Indexes:   idx_ai_sys_* prefix  (existing: idx_ai_systems_org only)
--   Triggers:  trg_ai_sys_* prefix
--   Functions: gov_repo.ai_system_compliance_gaps()
--              gov_repo.update_ai_system_compliance_flags()
--   Views:     gov_repo.v_ai_sys_*  (existing: v_ai_systems_inventory)
--              gov_repo.v_ai_act_high_risk_dashboard (new)
--              gov_repo.v_ai_system_conformity_status (new)
--              gov_repo.v_ai_system_agent_roster (new)
--              gov_repo.v_ai_system_risk_posture (new)
--   Policies:  existing "Service role full access ai_systems" / "Org-scoped ai_systems"
--              adding: "Authenticated read ai_systems" (new)
-- =============================================================================

-- ─── [S1] NEW ENUM TYPES ─────────────────────────────────────────────────────

-- AI System lifecycle (distinct from agent_status — system has its own lifecycle)
-- Note: gov_repo.system_status already exists from M006 with values:
--   development, testing, production, decommissioned
-- We augment with a richer lifecycle enum for AI Act Art. 17 QMS phases.
create type gov_repo.ai_system_lifecycle as enum (
  'concept',                -- Feasibility and design phase — not yet in development
  'development',            -- Active development; not yet tested
  'testing',                -- Pre-production validation, conformity testing
  'pre_market_review',      -- Conformity assessment submitted; awaiting outcome
  'conformity_assessed',    -- Passed conformity assessment; CE marking eligible
  'production',             -- Live in production; post-market surveillance active
  'under_significant_modification', -- Art. 83: modification that resets lifecycle
  'post_market_surveillance',       -- Decommissioned from active use; 10yr retention
  'decommissioned'          -- Fully decommissioned; all data under retention policy
);

comment on type gov_repo.ai_system_lifecycle is
  'Full AI System lifecycle per EU AI Act Art. 17 Quality Management System.
   Distinct from gov_repo.system_status (M006 stub) which has 4 values.
   pre_market_review → conformity_assessed → CE marking eligible (Art. 43).
   under_significant_modification: Art. 83 — a significant modification resets
   the conformity assessment requirement.
   post_market_surveillance: Art. 72 — active surveillance after decommission.';

-- CE Marking status (EU AI Act Art. 47 — CE marking of conformity)
create type gov_repo.ce_marking_status as enum (
  'not_applicable',         -- Risk class not requiring CE marking (limited/minimal)
  'not_started',            -- High-risk; CE marking process not initiated
  'in_progress',            -- Conformity assessment ongoing
  'marked',                 -- CE marking affixed; system in production
  'suspended',              -- CE marking suspended pending re-assessment
  'withdrawn'               -- CE marking withdrawn; system must not operate
);

comment on type gov_repo.ce_marking_status is
  'CE marking lifecycle per EU AI Act Art. 47.
   Only applicable to ai_act_risk_class = ''high''.
   marked = CE marking physically/digitally affixed per Art. 47(1).
   withdrawn = Art. 47(4) — competent authority ordered withdrawal.';

-- EU AI Act Annex III sector classification
-- These are the 8 high-risk sectors defined in Annex III
create type gov_repo.annex_iii_sector as enum (
  'biometric_identification',          -- Annex III §1: remote biometric ID
  'critical_infrastructure',           -- Annex III §2: safety components
  'education_vocational_training',     -- Annex III §3: access/outcomes
  'employment_worker_management',      -- Annex III §4: hiring, performance
  'essential_services_benefits',       -- Annex III §5: credit, social benefits
  'law_enforcement',                   -- Annex III §6: profiling, evidence
  'migration_asylum_border',           -- Annex III §7: border control
  'administration_of_justice',         -- Annex III §8: courts
  'not_annex_iii'                      -- Does not fall within Annex III
);

comment on type gov_repo.annex_iii_sector is
  'EU AI Act Annex III high-risk use case classification.
   If annex_iii_sector != ''not_annex_iii'', the system is presumptively high-risk
   and ai_act_risk_class MUST be ''high'' unless Art. 6(3) exception applies.
   Financial services (credit scoring) maps to ''essential_services_benefits''.';

-- GPAI model tier classification (EU AI Act Art. 51)
create type gov_repo.gpai_tier as enum (
  'not_gpai',               -- System does not use or constitute a GPAI model
  'gpai_standard',          -- GPAI model — standard obligations (Art. 53)
  'gpai_systemic_risk'      -- GPAI model with systemic risk (Art. 55) — >10^25 FLOPs
);

comment on type gov_repo.gpai_tier is
  'GPAI model classification per EU AI Act Title VIII.
   gpai_standard: Art. 53 obligations — transparency, copyright policy, technical docs.
   gpai_systemic_risk: Art. 55 obligations — adversarial testing, incident reporting,
   cybersecurity measures, energy efficiency reporting.
   Threshold: training computation > 10^25 FLOPs (Art. 51(1)(a)).';

-- Provider/Deployer role per AI Act (important: one organisation may be both)
create type gov_repo.provider_role as enum (
  'provider',               -- Art. 3(3): develops/places system on market
  'deployer',               -- Art. 3(4): uses system under own authority
  'provider_and_deployer',  -- Both roles (common for internal AI systems)
  'importer',               -- Art. 3(6): places third-country system on EU market
  'distributor'             -- Art. 3(7): makes system available on market
);

comment on type gov_repo.provider_role is
  'Organisation''s role in the AI value chain per EU AI Act Art. 3.
   Determines which obligations apply (Art. 16 = provider, Art. 26 = deployer).
   Internal AI systems built and deployed by same organisation = provider_and_deployer.
   Obligations cascade: provider obligations are more extensive than deployer obligations.';

-- =============================================================================
-- [S0] SELF-CONTAINED GUARD
-- Creates the M006 stub exactly as 20260618006000_regulatory_and_systems.sql
-- would have created it.  Uses CREATE TABLE IF NOT EXISTS so this block is
-- a no-op when M006 has already run.  Also re-creates the M006 trigger, index,
-- and FK on agents — all guarded with IF NOT EXISTS / DO NOTHING patterns so
-- they are safe to run on top of a fully applied M006.
-- =============================================================================

-- Required enum from M006 (also guarded)
do $$ begin
  if not exists (select 1 from pg_type t
                 join pg_namespace n on n.oid = t.typnamespace
                 where n.nspname = 'gov_repo' and t.typname = 'system_status') then
    create type gov_repo.system_status as enum (
      'development', 'testing', 'production', 'decommissioned'
    );
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_type t
                 join pg_namespace n on n.oid = t.typnamespace
                 where n.nspname = 'gov_repo' and t.typname = 'dora_criticality') then
    create type gov_repo.dora_criticality as enum (
      'critical', 'high', 'medium', 'low'
    );
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_type t
                 join pg_namespace n on n.oid = t.typnamespace
                 where n.nspname = 'gov_repo' and t.typname = 'incident_severity') then
    create type gov_repo.incident_severity as enum (
      'critical', 'high', 'medium', 'low'
    );
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_type t
                 join pg_namespace n on n.oid = t.typnamespace
                 where n.nspname = 'gov_repo' and t.typname = 'incident_status') then
    create type gov_repo.incident_status as enum (
      'reported', 'investigating', 'mitigated', 'resolved', 'closed'
    );
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_type t
                 join pg_namespace n on n.oid = t.typnamespace
                 where n.nspname = 'gov_repo' and t.typname = 'provider_service_type') then
    create type gov_repo.provider_service_type as enum (
      'cloud_infrastructure', 'foundation_model_api', 'saas_platform',
      'data_provider', 'managed_service'
    );
  end if;
end $$;

-- M006 stub: gov_repo.ai_systems
create table if not exists gov_repo.ai_systems (
  system_id             uuid          primary key default uuid_generate_v4(),
  system_code           varchar(20)   not null,
  name                  varchar(255)  not null,
  description           text          not null,
  intended_purpose      text          not null,
  risk_class            gov_repo.ai_act_risk_class not null default 'minimal',
  status                gov_repo.system_status not null default 'development',
  owner_user_id         uuid          not null
                                       references gov_repo.governance_users (user_id),
  business_domain       varchar(100),
  eu_ai_db_registered   boolean       not null default false,
  eu_ai_db_ref          varchar(100),
  conformity_assessment_id uuid
                                       references gov_repo.conformity_assessments (assessment_id),
  organisation_id       uuid          not null
                                       references gov_repo.organisations (organisation_id),
  ledger_entry_seq      bigint
                                       references gov_repo.governance_ledger (entry_sequence),
  created_at            timestamptz   not null default now(),
  updated_at            timestamptz   not null default now(),
  constraint ai_systems_code_org_unique unique (system_code, organisation_id)
);

-- Index (IF NOT EXISTS is safe in PG 9.5+)
create index if not exists idx_ai_systems_org
  on gov_repo.ai_systems (organisation_id);

-- updated_at trigger — only create if not already present
do $$ begin
  if not exists (
    select 1 from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'gov_repo'
      and c.relname = 'ai_systems'
      and t.tgname = 'trg_ai_systems_updated_at'
  ) then
    create trigger trg_ai_systems_updated_at
      before update on gov_repo.ai_systems
      for each row execute function gov_repo.set_updated_at();
  end if;
end $$;

-- FK on agents.ai_system_id — only add if not already present
do $$ begin
  if not exists (
    select 1 from information_schema.table_constraints
    where constraint_schema = 'gov_repo'
      and table_name        = 'agents'
      and constraint_name   = 'fk_agent_ai_system'
  ) then
    alter table gov_repo.agents
      add constraint fk_agent_ai_system
      foreign key (ai_system_id) references gov_repo.ai_systems (system_id);
  end if;
end $$;

-- RLS (enable is idempotent; policies use IF NOT EXISTS pattern via DO block)
alter table gov_repo.ai_systems enable row level security;

do $$ begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'gov_repo'
      and tablename  = 'ai_systems'
      and policyname = 'Service role full access ai_systems'
  ) then
    execute $pol$
      create policy "Service role full access ai_systems"
        on gov_repo.ai_systems for all to service_role
        using (true) with check (true)
    $pol$;
  end if;
end $$;

do $$ begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'gov_repo'
      and tablename  = 'ai_systems'
      and policyname = 'Org-scoped ai_systems'
  ) then
    execute $pol$
      create policy "Org-scoped ai_systems"
        on gov_repo.ai_systems for select to authenticated
        using (organisation_id = (
          select organisation_id from gov_repo.governance_users
          where email = auth.email() limit 1
        ))
    $pol$;
  end if;
end $$;

-- =============================================================================
-- [S2] EXPAND gov_repo.ai_systems
-- The M006 stub has: system_id, system_code, name, description, intended_purpose,
-- risk_class, status (system_status), owner_user_id, business_domain,
-- eu_ai_db_registered, eu_ai_db_ref, conformity_assessment_id,
-- organisation_id, ledger_entry_seq, created_at, updated_at
-- (16 columns total in stub)
-- We add 60+ columns below, grouped by EU AI Act article obligation.
-- All ADD COLUMN statements use IF NOT EXISTS — safe to re-run.
-- =============================================================================

-- ─── [S2.1] Core Identity & Lifecycle ────────────────────────────────────────

alter table gov_repo.ai_systems
  -- Rich lifecycle (replaces stub's system_status enum in meaning; both coexist)
  add column if not exists lifecycle          gov_repo.ai_system_lifecycle
                                               not null default 'development',

  -- Version control (AI Act Art. 11 — technical documentation must include version)
  add column if not exists version            varchar(50)
                                               not null default '1.0.0',
  add column if not exists version_notes      text,

  -- Short identifier for display (badge / UI reference)
  add column if not exists display_code       varchar(10),

  -- Sector and domain
  -- business_domain already exists (varchar(100)) from M006 stub
  add column if not exists annex_iii_sector   gov_repo.annex_iii_sector
                                               not null default 'not_annex_iii',
  add column if not exists industry_sector    varchar(100),    -- NACE code or free text
  add column if not exists geographic_scope   varchar(100),    -- EU, national, regional

  -- Deployment context
  add column if not exists deployment_env     varchar(30)
                                               not null default 'development'
                                               check (deployment_env in (
                                                 'development','staging','production')),
  add column if not exists deployment_regions text[]           not null default '{}',
  add column if not exists deployment_type    varchar(30)
                                               not null default 'on_premises'
                                               check (deployment_type in (
                                                 'on_premises','private_cloud',
                                                 'hybrid','public_cloud')),
  add column if not exists is_cross_border    boolean          not null default false;

comment on column gov_repo.ai_systems.lifecycle is
  'Full lifecycle stage per AI Act Art. 17 QMS. Complements stub status column.
   pre_market_review: conformity assessment submitted.
   conformity_assessed: passed; CE marking may be affixed (Art. 47).
   under_significant_modification: Art. 83 triggers new conformity assessment.';

comment on column gov_repo.ai_systems.annex_iii_sector is
  'EU AI Act Annex III classification. If not not_annex_iii, system is presumptively
   high-risk (Art. 6(2)). Financial services credit scoring = essential_services_benefits.
   Biometric ID systems face additional restrictions under Art. 5 (prohibited uses).';

comment on column gov_repo.ai_systems.is_cross_border is
  'TRUE if the AI system is used or affects persons in more than one EU Member State.
   Cross-border high-risk systems may require notification to multiple NCAs.
   Relevant for DORA Art. 28 cross-border ICT concentration risk.';

-- ─── [S2.2] Provider / Deployer Identity (EU AI Act Art. 16 & 26) ────────────

alter table gov_repo.ai_systems
  -- Role this organisation plays in the value chain
  add column if not exists organisation_role  gov_repo.provider_role
                                               not null default 'provider_and_deployer',

  -- Provider details (if organisation is the provider — Art. 16)
  add column if not exists provider_legal_name  varchar(500),
  add column if not exists provider_address     text,
  add column if not exists provider_country     char(2),
  add column if not exists provider_contact_email varchar(255),

  -- EU Authorised Representative (Art. 22 — required if provider outside EU)
  add column if not exists eu_rep_name        varchar(255),
  add column if not exists eu_rep_address     text,
  add column if not exists eu_rep_country     char(2)      check (eu_rep_country is null
                                               or length(eu_rep_country) = 2),
  add column if not exists eu_rep_contact_email varchar(255),

  -- Deployer details (if different from provider — Art. 26)
  add column if not exists deployer_legal_name  varchar(500),
  add column if not exists deployer_address     text,
  add column if not exists deployer_country     char(2),

  -- Technical ownership (operational accountability)
  add column if not exists technical_owner_id uuid
                                               references gov_repo.governance_users (user_id),

  -- DPO and AI Officer contacts (AI Act Art. 3(8) — AI officer role)
  add column if not exists ai_officer_id      uuid
                                               references gov_repo.governance_users (user_id),
  add column if not exists dpo_id             uuid
                                               references gov_repo.governance_users (user_id);

comment on column gov_repo.ai_systems.organisation_role is
  'EU AI Act Art. 3 role of the owning organisation in this AI system.
   provider = built and places on market (Art. 16 obligations apply).
   deployer = uses system under own responsibility (Art. 26 obligations apply).
   Most internal bank AI systems are provider_and_deployer.
   Obligations differ: provider must ensure conformity; deployer must implement oversight.';

comment on column gov_repo.ai_systems.eu_rep_name is
  'EU Authorised Representative per AI Act Art. 22.
   MANDATORY if the provider is established outside the EU.
   The representative acts on behalf of the provider for regulatory obligations.
   NULL = provider is EU-established (most common for domestic banks).';

comment on column gov_repo.ai_systems.ai_officer_id is
  'AI Officer per EU AI Act Art. 3(8) — the natural person responsible for
   AI literacy, governance, and AI Act compliance within the organisation.
   Required for all deployers of high-risk AI systems under Art. 26(6).';

-- ─── [S2.3] EU AI Act Risk Classification (Art. 6, 9, 51) ───────────────────

alter table gov_repo.ai_systems
  -- GPAI classification (EU AI Act Title VIII)
  add column if not exists gpai_tier          gov_repo.gpai_tier
                                               not null default 'not_gpai',
  add column if not exists gpai_model_ref     varchar(255),    -- model identifier if GPAI
  add column if not exists gpai_training_flops numeric(30,0),  -- for systemic risk threshold

  -- Art. 6(3) exception: Annex III system that is NOT high-risk
  -- Provider must demonstrate exception and document rationale
  add column if not exists annex_iii_exception_claimed boolean
                                               not null default false,
  add column if not exists annex_iii_exception_rationale text,
  add column if not exists annex_iii_exception_evidence_id uuid
                                               references gov_repo.evidence (evidence_id),

  -- Unacceptable risk justification (Art. 5 — should never be active)
  add column if not exists prohibited_use_analysis text,

  -- Overall compliance flags (auto-set by trigger)
  add column if not exists cg_sys_001_registered        boolean not null default false,
  add column if not exists cg_sys_002_owner             boolean not null default false,
  add column if not exists cg_sys_003_risk_classified   boolean not null default false,
  add column if not exists cg_sys_004_tech_doc          boolean not null default false,
  add column if not exists cg_sys_005_risk_mgmt         boolean not null default false,
  add column if not exists cg_sys_006_human_oversight   boolean not null default false,
  add column if not exists cg_sys_007_conformity        boolean not null default false,
  add column if not exists cg_sys_008_post_market       boolean not null default false;

comment on column gov_repo.ai_systems.gpai_tier is
  'GPAI classification per EU AI Act Art. 51-55.
   gpai_systemic_risk: training computation > 10^25 FLOPs — requires adversarial testing,
   cyber incident reporting to AI Office, cybersecurity measures (Art. 55).
   gpai_standard: Art. 53 — technical documentation, transparency, copyright policy.
   Foundation models (GPT-4, Claude, Gemini) = gpai_standard or gpai_systemic_risk.
   Models fine-tuned internally from GPAI base = still subject to GPAI obligations.';

comment on column gov_repo.ai_systems.annex_iii_exception_claimed is
  'Art. 6(3): Provider may claim that an Annex III system is NOT high-risk if it
   does not pose significant risk of harm. Must be documented and notified to
   competent authority before placing on market.
   If TRUE, annex_iii_exception_rationale and evidence are MANDATORY.
   NCA may challenge this determination (Art. 6(4)).';

comment on column gov_repo.ai_systems.cg_sys_001_registered is
  'System-level compliance flag: AI System formally registered with all mandatory
   identity fields populated. Auto-set by trigger trg_ai_sys_compliance_flags.';

-- ─── [S2.4] Technical Documentation (EU AI Act Art. 11 + Annex IV) ───────────

alter table gov_repo.ai_systems
  -- Annex IV §1: General description
  add column if not exists intended_use_cases       text,       -- Annex IV §1(b)
  add column if not exists intended_users           text,       -- Annex IV §1(c) — natural persons
  add column if not exists intended_deployers       text,       -- Annex IV §1(d)
  add column if not exists geographic_markets       text[],     -- Annex IV §1(e)

  -- Annex IV §2: Technical specifications
  add column if not exists architecture_description text,       -- Annex IV §2(a)
  add column if not exists training_methodology     text,       -- Annex IV §2(b)
  add column if not exists training_data_description text,      -- Annex IV §2(c)
  add column if not exists validation_methodology   text,       -- Annex IV §2(d)
  add column if not exists testing_methodology      text,       -- Annex IV §2(e)
  add column if not exists computational_resources  text,       -- Annex IV §2(g)

  -- Annex IV §3: Information on training, validation and testing data
  add column if not exists data_governance_measures text,       -- Art. 10 + Annex IV §3
  add column if not exists data_residency_policy    text,       -- GDPR + DORA Art. 28

  -- Annex IV §4: Monitoring, functioning and control
  add column if not exists monitoring_approach      text,       -- Annex IV §4
  add column if not exists performance_metrics_def  text,       -- Art. 15 — accuracy specs

  -- Annex IV §5: Instructions for use (Art. 13)
  add column if not exists user_instructions        text,       -- Art. 13(3) instructions
  add column if not exists known_limitations        text,       -- Art. 13(3)(b)(iii)
  add column if not exists foreseeable_misuse       text,       -- Art. 9(2)(b)

  -- Annex IV §6: Standards applied
  add column if not exists harmonised_standards     text[],     -- Annex IV §6
  add column if not exists common_specifications    text[],     -- Art. 41 CS references

  -- Annex IV §7: Changes log (Art. 83 — significant modifications)
  add column if not exists changes_log              jsonb       not null default '[]',

  -- Evidence linkages
  add column if not exists technical_doc_evidence_id  uuid
                                                    references gov_repo.evidence (evidence_id),
  add column if not exists technical_doc_version       varchar(50),
  add column if not exists technical_doc_last_updated  date,

  -- Declaration of Conformity (Art. 47(2))
  add column if not exists declaration_of_conformity_id uuid
                                                    references gov_repo.evidence (evidence_id);

comment on column gov_repo.ai_systems.changes_log is
  'Annex IV §7: Log of significant modifications under Art. 83.
   Each entry: {"version": "2.0.0", "date": "...", "description": "...",
                "requires_new_conformity": true, "rationale": "...",
                "approved_by": "user_id"}.
   A significant modification requires the provider to reassess conformity (Art. 83(3)).
   Changes tracked here to demonstrate QMS (Art. 17(1)(g)) is followed.';

comment on column gov_repo.ai_systems.known_limitations is
  'Art. 13(3)(b)(iii): Providers must inform deployers of known limitations.
   Deployers must consider these when implementing human oversight (Art. 26(5)).
   This field is surfaced to deployers via the transparency view.';

-- ─── [S2.5] Risk Management System (EU AI Act Art. 9) ────────────────────────

alter table gov_repo.ai_systems
  -- Risk management system documentation
  add column if not exists risk_mgmt_system_desc    text,       -- Art. 9(1) — iterative process
  add column if not exists risk_mgmt_last_review    date,       -- Art. 9(1)(b) — continuous process
  add column if not exists risk_mgmt_next_review    date,
  add column if not exists residual_risk_level      gov_repo.agent_risk_level
                                                     not null default 'low',
  add column if not exists residual_risk_accepted_by uuid
                                                     references gov_repo.governance_users (user_id),
  add column if not exists residual_risk_accepted_at timestamptz,

  -- Risk management evidence linkage
  add column if not exists risk_mgmt_evidence_id    uuid
                                                     references gov_repo.evidence (evidence_id),

  -- Risk management policy linkage
  add column if not exists risk_mgmt_policy_id      uuid
                                                     references gov_repo.governance_policies (policy_id),

  -- Fundamental rights impact assessment (Art. 9(9) + FRA guidance)
  add column if not exists fria_conducted           boolean     not null default false,
  add column if not exists fria_date                date,
  add column if not exists fria_evidence_id         uuid
                                                     references gov_repo.evidence (evidence_id),
  add column if not exists fria_outcome_summary     text;

comment on column gov_repo.ai_systems.risk_mgmt_system_desc is
  'AI Act Art. 9(1): Risk management system must be a continuous iterative process
   running throughout the entire lifecycle. Not a one-time assessment.
   Must include: identification/analysis of known risks, estimation of risks from
   intended use and foreseeable misuse, evaluation against Art. 9(4) requirements,
   adoption of risk management measures.';

comment on column gov_repo.ai_systems.fria_conducted is
  'Fundamental Rights Impact Assessment per AI Act Art. 9(9).
   MANDATORY for deployers of high-risk AI systems that are public bodies.
   STRONGLY RECOMMENDED for all deployers affecting natural persons.
   In financial services: credit scoring, insurance underwriting, fraud detection
   all interact with fundamental rights (non-discrimination, access to services).';

-- ─── [S2.6] Conformity Assessment & CE Marking (Art. 43, 47, 49) ─────────────

alter table gov_repo.ai_systems
  -- CE Marking (Art. 47)
  add column if not exists ce_marking_status        gov_repo.ce_marking_status
                                                     not null default 'not_applicable',
  add column if not exists ce_marking_date          date,       -- date marking was affixed
  add column if not exists ce_marking_notified_body varchar(255), -- if notified body involved
  add column if not exists ce_marking_nb_certificate_ref varchar(100), -- NB certificate number

  -- Conformity assessment type (Art. 43)
  -- Note: conformity_assessment_id already exists from M006 stub
  -- We add the assessment procedure reference
  add column if not exists conformity_procedure     varchar(100), -- Annex VI, VII, or IX procedure
  add column if not exists conformity_version       varchar(50),  -- version assessed
  add column if not exists conformity_valid_until   date,

  -- Declaration of Conformity (Art. 47(2)) — separate from evidence linkage
  add column if not exists doc_ref                  varchar(100), -- DoC document reference
  add column if not exists doc_issued_date          date,
  add column if not exists doc_issued_by            varchar(255), -- legal entity issuing

  -- EU AI Database (Art. 49)
  -- eu_ai_db_registered and eu_ai_db_ref already exist from M006 stub
  add column if not exists eu_ai_db_submission_date date,
  add column if not exists eu_ai_db_last_updated    date,
  add column if not exists eu_ai_db_system_uuid     uuid,        -- UUID assigned by EU AI DB

  -- Standards compliance self-declaration
  add column if not exists iso_42001_certified      boolean     not null default false,
  add column if not exists iso_42001_cert_ref       varchar(100),
  add column if not exists iso_42001_cert_expires   date;

comment on column gov_repo.ai_systems.ce_marking_status is
  'EU AI Act Art. 47 CE marking lifecycle.
   CE marking is the visible conformity indicator for high-risk AI systems.
   marked = provider has affixed CE marking and issued Declaration of Conformity (Art. 47(2)).
   suspended = Art. 47(4): competent authority has suspended marketing pending investigation.
   withdrawn = Art. 47(4): authority ordered withdrawal; system MUST cease operation immediately.
   not_applicable = system is limited/minimal risk; CE marking not required.';

comment on column gov_repo.ai_systems.conformity_procedure is
  'Annex VI = internal control (most common for high-risk AI not listed in Annex VII).
   Annex VII = quality management system assessment by notified body.
   Annex IX = applicable to AI systems used in product areas (Machinery, MDR, etc.)
   Reference format: "Annex VI", "Annex VII", "Annex IX + Annex X".';

comment on column gov_repo.ai_systems.eu_ai_db_system_uuid is
  'UUID assigned by the European AI Database (Art. 71) upon registration.
   Different from the internal system_id. Must be included in technical documentation
   and Declaration of Conformity after registration.
   NULL = not yet registered (gap alert for high-risk systems before market placement).';

comment on column gov_repo.ai_systems.doc_ref is
  'Declaration of Conformity reference number per AI Act Art. 47(2).
   Required content per Art. 47(2): system name/version, provider details,
   statement that system conforms, list of standards applied, NB reference if applicable.
   Must be kept for 10 years after system placed on market (Art. 18(1)).';

-- ─── [S2.7] Post-Market Surveillance (Art. 72) ───────────────────────────────

alter table gov_repo.ai_systems
  -- Post-market surveillance plan
  add column if not exists pms_plan_documented      boolean     not null default false,
  add column if not exists pms_plan_evidence_id     uuid
                                                     references gov_repo.evidence (evidence_id),
  add column if not exists pms_review_frequency     gov_repo.review_frequency
                                                     not null default 'quarterly',
  add column if not exists pms_last_review          date,
  add column if not exists pms_next_review          date,

  -- Serious incident reporting (Art. 73)
  add column if not exists serious_incidents_reported integer not null default 0,
  add column if not exists last_serious_incident_at   timestamptz,

  -- GPAI systemic risk — adversarial testing (Art. 55(1)(a))
  add column if not exists adversarial_testing_completed boolean not null default false,
  add column if not exists adversarial_testing_date      date,
  add column if not exists adversarial_testing_evidence_id uuid
                                                     references gov_repo.evidence (evidence_id);

comment on column gov_repo.ai_systems.pms_plan_documented is
  'EU AI Act Art. 72(1): Providers of high-risk AI systems must establish and document
   a post-market surveillance plan BEFORE the system is placed on the market.
   The plan must be proportionate to the nature of the AI technology and its risks.
   pms_plan_evidence_id links to the documented plan in gov_repo.evidence.';

comment on column gov_repo.ai_systems.adversarial_testing_completed is
  'EU AI Act Art. 55(1)(a): GPAI models with systemic risk must perform adversarial
   testing including red-teaming to identify and mitigate systemic risks.
   Only mandatory for gpai_tier = ''gpai_systemic_risk''.
   For standard GPAI and non-GPAI: best practice, not mandatory.';

-- ─── [S2.8] Human Oversight Design (Art. 14) ─────────────────────────────────

alter table gov_repo.ai_systems
  add column if not exists oversight_measures_desc  text,       -- Art. 14(2) — built-in measures
  add column if not exists oversight_person_id      uuid
                                                     references gov_repo.governance_users (user_id),
  add column if not exists override_mechanism_desc  text,       -- Art. 14(4)(d) — intervention
  add column if not exists halt_mechanism_desc      text,       -- Art. 14(4)(e) — stop button

  -- Transparency (Art. 13) — information for deployers and users
  add column if not exists transparency_notice_url  text,
  add column if not exists transparency_last_updated date,

  -- Instructions for use publicly available? (Art. 13(1))
  add column if not exists instructions_public      boolean     not null default false;

comment on column gov_repo.ai_systems.override_mechanism_desc is
  'Art. 14(4)(d): The AI system must allow oversight persons to override, disregard,
   or reverse the outputs of the high-risk AI system.
   This field documents HOW override is technically implemented.
   Example: "Loan officer can reject model recommendation via UI before decision is
   recorded. Override is logged with reason to governance_ledger."
   Must be tested periodically; test evidence linked to pms_plan_evidence_id.';

comment on column gov_repo.ai_systems.halt_mechanism_desc is
  'Art. 14(4)(e): The AI system must include a "stop button" or similar procedure
   that allows the system to be halted immediately.
   In practice: status → ''suspended'' via API or UI emergency action.
   For autonomous systems: automated circuit-breaker on anomaly detection.';

-- ─── [S2.9] Accuracy, Robustness, Cybersecurity (Art. 15) ────────────────────

alter table gov_repo.ai_systems
  add column if not exists accuracy_metrics         jsonb       not null default '{}',
  -- Format: {"metric": "F1", "threshold": 0.95, "current": 0.97, "measured_at": "..."}

  add column if not exists robustness_measures      text,       -- Art. 15(3)
  add column if not exists cybersecurity_measures   text,       -- Art. 15(5)

  -- Accuracy thresholds by use case (may vary)
  add column if not exists accuracy_threshold_overall  numeric(5,4) check (
                                                     accuracy_threshold_overall between 0 and 1),

  -- Bias and fairness assessment (Art. 9(7) — training data, bias examination)
  add column if not exists bias_assessment_conducted boolean    not null default false,
  add column if not exists bias_assessment_date      date,
  add column if not exists bias_assessment_evidence_id uuid
                                                     references gov_repo.evidence (evidence_id),
  add column if not exists fairness_metrics          jsonb      not null default '{}';

comment on column gov_repo.ai_systems.accuracy_metrics is
  'Art. 15(1): Providers must declare accuracy metrics in technical documentation.
   Deployers must monitor against these thresholds.
   Format example:
     {"overall_accuracy": {"threshold": 0.95, "current": 0.97, "measured_at": "2026-06-01"},
      "false_positive_rate": {"threshold": 0.05, "current": 0.03},
      "demographic_parity": {"threshold": 0.05, "current": 0.02}}
   Drift from threshold triggers PMS alert and risk re-assessment.';

comment on column gov_repo.ai_systems.fairness_metrics is
  'Bias and fairness measurements per Art. 9(7) and EBA ML Guidelines.
   Mandatory for credit scoring, insurance underwriting, employment AI.
   Format: {"demographic_parity": 0.02, "equalized_odds": 0.03, "group": "gender"}
   ECB/EBA/PRA supervisors increasingly request this data in OSI reviews.';

-- ─── [S2.10] Quality Management System (Art. 17) ─────────────────────────────

alter table gov_repo.ai_systems
  add column if not exists qms_documented           boolean     not null default false,
  add column if not exists qms_policy_id            uuid
                                                     references gov_repo.governance_policies (policy_id),
  add column if not exists qms_last_review          date,
  add column if not exists qms_next_review          date,

  -- ISO 9001 or sector-equivalent
  add column if not exists qms_standard_ref         varchar(100),  -- e.g. "ISO 9001:2015"

  -- Art. 17(1)(k): Data management procedures
  add column if not exists data_mgmt_procedures_id  uuid
                                                     references gov_repo.governance_policies (policy_id);

comment on column gov_repo.ai_systems.qms_documented is
  'EU AI Act Art. 17: Providers of high-risk AI must implement a quality management
   system covering: strategy, design controls, verification and validation, risk mgmt,
   post-market surveillance, communication, customer relations, documentation,
   corrective action, resource management.
   qms_policy_id links to the governing QMS policy in gov_repo.governance_policies.';

-- ─── [S2.11] Metadata, Tags & External References ────────────────────────────

alter table gov_repo.ai_systems
  add column if not exists tags                     jsonb       not null default '[]',
  add column if not exists capabilities             jsonb       not null default '[]',
  add column if not exists external_refs            jsonb       not null default '{}',
  -- external_refs format: {"jira": "AI-42", "sharepoint_doc_id": "...", "archi_id": "..."}

  -- Internal project references
  add column if not exists project_code             varchar(100),
  add column if not exists budget_code              varchar(100),

  -- Contact and escalation
  add column if not exists escalation_contact_email varchar(255),
  add column if not exists regulatory_contact_email varchar(255), -- for NCA queries

  add column if not exists created_by              uuid
                                                    not null
                                                    references gov_repo.governance_users (user_id);

comment on column gov_repo.ai_systems.external_refs is
  'Free-form external reference map for integration with existing enterprise systems.
   Common keys: jira (project tracker), archi (enterprise architecture tool),
   sharepoint_doc_id (technical documentation store), model_card_url,
   vendor_system_id (if third-party AI system), dora_register_id.';

-- =============================================================================
-- [S2.12] TABLE-LEVEL CONSTRAINTS
-- =============================================================================

-- CE marking only applies to high-risk systems
alter table gov_repo.ai_systems
  add constraint ai_sys_ce_marking_only_high_risk check (
    ce_marking_status = 'not_applicable' or risk_class = 'high'
  );

-- Annex III exception requires documented rationale
alter table gov_repo.ai_systems
  add constraint ai_sys_exception_requires_rationale check (
    not annex_iii_exception_claimed
    or (annex_iii_exception_rationale is not null)
  );

-- EU AI DB mandatory for active high-risk systems in production
-- (enforced as advisory constraint — application layer enforces hard block)
-- Hard constraint not added here to avoid blocking initial registration.

-- Conformity assessed status requires conformity_assessment_id
alter table gov_repo.ai_systems
  add constraint ai_sys_conformity_id_required check (
    lifecycle not in ('conformity_assessed','production')
    or conformity_assessment_id is not null
  );

-- DoC ref required when CE marked
alter table gov_repo.ai_systems
  add constraint ai_sys_doc_ref_when_marked check (
    ce_marking_status != 'marked'
    or (doc_ref is not null and doc_issued_date is not null)
  );

-- Residual risk acceptance requires actor
alter table gov_repo.ai_systems
  add constraint ai_sys_residual_risk_acceptance_consistent check (
    (residual_risk_accepted_by is null) = (residual_risk_accepted_at is null)
  );

comment on table gov_repo.ai_systems is
  'AI System master registry — the primary unit of regulation under EU AI Act Art. 3(1).
   The AI Act regulates AI SYSTEMS, not individual agents. This table is the root
   entity for all governance obligations.
   One AI System contains 1..N Agents (gov_repo.agents.ai_system_id FK).
   EU AI Act compliance chain:
     ai_systems → conformity_assessments (Art. 43)
     ai_systems → technical documentation evidence (Art. 11 + Annex IV)
     ai_systems → risk management system (Art. 9)
     ai_systems → post-market surveillance (Art. 72)
     ai_systems → agents (Art. 3(1) — system boundary)
   DORA integration:
     ai_systems → third_party_providers (AI system dependencies)
     ai_systems → ict_incidents (DORA Art. 17 classification)
     ai_systems → ai_serious_incidents (Art. 73 reporting)
   For financial services (banking, insurance):
     All credit scoring, fraud detection, AML, and underwriting AI systems
     with material impact on natural persons are presumptively high-risk
     under Annex III §5 (essential private and public services — access to credit).';

-- =============================================================================
-- [S3] INDEXES
-- Existing: idx_ai_systems_org (on organisation_id)
-- New indexes use idx_ai_sys_* prefix to avoid conflicts
-- =============================================================================

-- Core lookup indexes
create index idx_ai_sys_status
  on gov_repo.ai_systems (status);

create index idx_ai_sys_lifecycle
  on gov_repo.ai_systems (lifecycle);

create index idx_ai_sys_risk_class
  on gov_repo.ai_systems (risk_class);

create index idx_ai_sys_owner
  on gov_repo.ai_systems (owner_user_id);

create index idx_ai_sys_tech_owner
  on gov_repo.ai_systems (technical_owner_id)
  where technical_owner_id is not null;

create index idx_ai_sys_ai_officer
  on gov_repo.ai_systems (ai_officer_id)
  where ai_officer_id is not null;

-- Annex III and GPAI
create index idx_ai_sys_annex_iii
  on gov_repo.ai_systems (annex_iii_sector)
  where annex_iii_sector != 'not_annex_iii';

create index idx_ai_sys_gpai
  on gov_repo.ai_systems (gpai_tier)
  where gpai_tier != 'not_gpai';

-- Conformity and CE marking
create index idx_ai_sys_conformity_id
  on gov_repo.ai_systems (conformity_assessment_id)
  where conformity_assessment_id is not null;

create index idx_ai_sys_ce_marking
  on gov_repo.ai_systems (ce_marking_status)
  where ce_marking_status != 'not_applicable';

-- EU AI Database registration gaps
create index idx_ai_sys_eu_db_gap
  on gov_repo.ai_systems (organisation_id)
  where eu_ai_db_registered = false
    and risk_class = 'high'
    and lifecycle in ('production','conformity_assessed');

-- Post-market surveillance overdue
create index idx_ai_sys_pms_overdue
  on gov_repo.ai_systems (pms_next_review)
  where pms_plan_documented = true
    and status = 'production';

-- Compliance flag gaps (high-risk systems with missing flags)
create index idx_ai_sys_compliance_gaps
  on gov_repo.ai_systems (organisation_id, risk_class)
  where risk_class = 'high'
    and (  cg_sys_004_tech_doc    = false
        or cg_sys_005_risk_mgmt   = false
        or cg_sys_007_conformity  = false );

-- Cross-border systems
create index idx_ai_sys_cross_border
  on gov_repo.ai_systems (organisation_id)
  where is_cross_border = true;

-- GIN indexes for JSONB and array columns
create index idx_ai_sys_tags
  on gov_repo.ai_systems using gin (tags);

create index idx_ai_sys_capabilities
  on gov_repo.ai_systems using gin (capabilities);

create index idx_ai_sys_harmonised_standards
  on gov_repo.ai_systems using gin (harmonised_standards)
  where harmonised_standards is not null;

create index idx_ai_sys_deployment_regions
  on gov_repo.ai_systems using gin (deployment_regions);

-- Residual risk level
create index idx_ai_sys_residual_risk
  on gov_repo.ai_systems (residual_risk_level)
  where residual_risk_level in ('critical','high');

-- DoC and CE marking expiry for renewal tracking
create index idx_ai_sys_conformity_expiry
  on gov_repo.ai_systems (conformity_valid_until)
  where conformity_valid_until is not null;

create index idx_ai_sys_iso42001_cert_expiry
  on gov_repo.ai_systems (iso_42001_cert_expires)
  where iso_42001_certified = true;

-- =============================================================================
-- [S4] COMPLIANCE FLAG TRIGGER
-- trg_ai_systems_updated_at already exists from M006 — do not recreate.
-- Adding: compliance flags trigger (auto-sets cg_sys_* flags on every mutation).
-- =============================================================================

create or replace function gov_repo.update_ai_system_compliance_flags()
returns trigger language plpgsql as $$
begin
  -- CG-SYS-001: System registered (identity fields complete)
  new.cg_sys_001_registered := (
    new.system_code   is not null and
    new.name          is not null and
    new.description   is not null and
    new.intended_purpose is not null and
    new.organisation_id is not null
  );

  -- CG-SYS-002: Owner assigned
  new.cg_sys_002_owner := (new.owner_user_id is not null);

  -- CG-SYS-003: Risk classified (both dimensions set — operational + AI Act)
  new.cg_sys_003_risk_classified := (
    new.risk_class is not null and
    new.annex_iii_sector is not null and
    -- If Annex III sector claimed, either high-risk OR exception documented
    (new.annex_iii_sector = 'not_annex_iii'
     or new.risk_class = 'high'
     or new.annex_iii_exception_claimed = true)
  );

  -- CG-SYS-004: Technical documentation (minimum viable — full coverage needs Annex IV)
  new.cg_sys_004_tech_doc := (
    new.intended_purpose  is not null and
    new.architecture_description is not null and
    new.training_methodology     is not null and
    new.known_limitations        is not null and
    (new.risk_class != 'high' or new.technical_doc_evidence_id is not null)
  );

  -- CG-SYS-005: Risk management system documented
  new.cg_sys_005_risk_mgmt := (
    new.risk_mgmt_system_desc is not null and
    new.risk_mgmt_last_review is not null and
    new.residual_risk_accepted_by is not null
  );

  -- CG-SYS-006: Human oversight designed in
  new.cg_sys_006_human_oversight := (
    new.oversight_measures_desc is not null and
    new.override_mechanism_desc is not null and
    new.halt_mechanism_desc     is not null and
    new.oversight_person_id     is not null
  );

  -- CG-SYS-007: Conformity assessment completed (high-risk) or not required
  new.cg_sys_007_conformity := (
    new.risk_class != 'high' or (
      new.conformity_assessment_id is not null and
      new.ce_marking_status in ('marked') and
      new.doc_ref is not null
    )
  );

  -- CG-SYS-008: Post-market surveillance plan in place (production systems)
  new.cg_sys_008_post_market := (
    new.lifecycle not in ('production','post_market_surveillance') or
    (new.pms_plan_documented = true and new.pms_plan_evidence_id is not null)
  );

  return new;
end;
$$;

comment on function gov_repo.update_ai_system_compliance_flags is
  'Auto-sets cg_sys_001 through cg_sys_008 compliance flags on every INSERT/UPDATE.
   Each flag validates a specific EU AI Act obligation:
     cg_sys_001: Art. 16(a) — registration
     cg_sys_002: Art. 16(c) — accountability / owner
     cg_sys_003: Art. 6 — risk classification
     cg_sys_004: Art. 11 + Annex IV — technical documentation
     cg_sys_005: Art. 9 — risk management system
     cg_sys_006: Art. 14 — human oversight design
     cg_sys_007: Art. 43 + 47 — conformity assessment + CE marking
     cg_sys_008: Art. 72 — post-market surveillance plan';

create trigger trg_ai_sys_compliance_flags
  before insert or update on gov_repo.ai_systems
  for each row execute function gov_repo.update_ai_system_compliance_flags();

-- =============================================================================
-- [S5] ROW LEVEL SECURITY
-- RLS is already enabled on ai_systems from M006.
-- Existing policies: "Service role full access ai_systems" / "Org-scoped ai_systems"
-- Adding: authenticated read policy (was missing from M006 stub)
-- =============================================================================

-- Authenticated users in the same organisation can read AI Systems
-- (matching pattern used across all other gov_repo tables)
create policy "Authenticated read ai_systems"
  on gov_repo.ai_systems for select to authenticated
  using (organisation_id = (
    select organisation_id from gov_repo.governance_users
    where email = auth.email() limit 1
  ));

-- =============================================================================
-- [S6] GOVERNANCE VIEWS
-- Existing view from M006: gov_repo.v_ai_systems_inventory (drop and recreate)
-- New views: v_ai_act_high_risk_dashboard, v_ai_system_conformity_status,
--            v_ai_system_agent_roster, v_ai_system_risk_posture
-- =============================================================================

-- ─── VIEW 1: AI Systems Inventory (enhanced replacement for M006 stub) ────────
drop view if exists gov_repo.v_ai_systems_inventory;

create or replace view gov_repo.v_ai_systems_inventory as
select
  s.organisation_id,
  s.system_id,
  s.system_code,
  s.name                                            as system_name,
  s.version,
  s.lifecycle,
  s.status,
  s.risk_class,
  s.annex_iii_sector,
  s.gpai_tier,
  s.organisation_role,
  s.ce_marking_status,
  s.eu_ai_db_registered,
  s.eu_ai_db_ref,
  s.deployment_env,
  s.deployment_regions,
  s.is_cross_border,
  s.business_domain,
  s.industry_sector,
  u_owner.full_name                                 as owner_name,
  u_owner.email                                     as owner_email,
  u_tech.full_name                                  as technical_owner_name,
  u_officer.full_name                               as ai_officer_name,
  -- Agent count
  (select count(*) from gov_repo.agents a
   where a.ai_system_id = s.system_id
     and a.status not in ('decommissioned'))        as active_agent_count,
  -- High-risk agent count within system
  (select count(*) from gov_repo.agents a
   where a.ai_system_id = s.system_id
     and a.risk_level in ('critical','high')
     and a.status not in ('decommissioned'))        as high_risk_agent_count,
  -- Compliance score (flags)
  (
    s.cg_sys_001_registered::int +
    s.cg_sys_002_owner::int +
    s.cg_sys_003_risk_classified::int +
    s.cg_sys_004_tech_doc::int +
    s.cg_sys_005_risk_mgmt::int +
    s.cg_sys_006_human_oversight::int +
    s.cg_sys_007_conformity::int +
    s.cg_sys_008_post_market::int
  )                                                 as compliance_score,  -- 0-8
  -- Total gaps
  (8 - (
    s.cg_sys_001_registered::int +
    s.cg_sys_002_owner::int +
    s.cg_sys_003_risk_classified::int +
    s.cg_sys_004_tech_doc::int +
    s.cg_sys_005_risk_mgmt::int +
    s.cg_sys_006_human_oversight::int +
    s.cg_sys_007_conformity::int +
    s.cg_sys_008_post_market::int
  ))                                                as total_gaps,
  s.pms_next_review,
  (s.pms_next_review < current_date
   and s.pms_plan_documented = true)               as pms_overdue,
  s.conformity_valid_until,
  (s.conformity_valid_until < current_date
   and s.conformity_valid_until is not null)       as conformity_expired,
  s.created_at,
  s.updated_at
from gov_repo.ai_systems s
left join gov_repo.governance_users u_owner   on u_owner.user_id   = s.owner_user_id
left join gov_repo.governance_users u_tech    on u_tech.user_id    = s.technical_owner_id
left join gov_repo.governance_users u_officer on u_officer.user_id = s.ai_officer_id
where s.status != 'decommissioned';

comment on view gov_repo.v_ai_systems_inventory is
  'Master AI Systems inventory view. Replaces M006 stub.
   compliance_score: 0-8 (count of cg_sys_00x flags that are true).
   total_gaps: 8 - compliance_score (gaps remaining).
   pms_overdue: PMS review is past due date.
   conformity_expired: conformity assessment has lapsed — re-assessment required.
   Use for: executive dashboard, regulatory inventory submissions, audit preparation.';

-- ─── VIEW 2: EU AI Act High-Risk Dashboard ───────────────────────────────────

create or replace view gov_repo.v_ai_act_high_risk_dashboard as
select
  s.organisation_id,
  s.system_id,
  s.system_code,
  s.name                                            as system_name,
  s.version,
  s.lifecycle,
  s.risk_class,
  s.annex_iii_sector,
  s.gpai_tier,
  s.organisation_role,
  -- CE Marking status
  s.ce_marking_status,
  s.ce_marking_date,
  s.ce_marking_notified_body,
  s.ce_marking_nb_certificate_ref,
  -- Declaration of Conformity
  s.doc_ref,
  s.doc_issued_date,
  -- EU AI Database
  s.eu_ai_db_registered,
  s.eu_ai_db_ref,
  s.eu_ai_db_system_uuid,
  s.eu_ai_db_submission_date,
  -- Conformity Assessment
  s.conformity_assessment_id,
  s.conformity_procedure,
  s.conformity_version,
  s.conformity_valid_until,
  (s.conformity_valid_until is not null
   and s.conformity_valid_until < current_date)    as conformity_expired,
  (s.conformity_valid_until is not null
   and s.conformity_valid_until < current_date + interval '90 days'
   and s.conformity_valid_until >= current_date)   as conformity_expiring_soon,
  -- Technical documentation
  s.cg_sys_004_tech_doc,
  s.technical_doc_last_updated,
  -- Risk management
  s.cg_sys_005_risk_mgmt,
  s.residual_risk_level,
  s.risk_mgmt_next_review,
  (s.risk_mgmt_next_review is not null
   and s.risk_mgmt_next_review < current_date)    as risk_review_overdue,
  -- Human oversight
  s.cg_sys_006_human_oversight,
  u_oversight.full_name                            as oversight_person_name,
  -- Post-market surveillance
  s.pms_plan_documented,
  s.pms_next_review,
  (s.pms_next_review is not null
   and s.pms_next_review < current_date)          as pms_overdue,
  s.serious_incidents_reported,
  -- Annex III exception
  s.annex_iii_exception_claimed,
  -- FRIA
  s.fria_conducted,
  s.fria_date,
  -- ISO 42001
  s.iso_42001_certified,
  s.iso_42001_cert_expires,
  (s.iso_42001_cert_expires is not null
   and s.iso_42001_cert_expires < current_date)   as iso42001_cert_expired,
  -- Compliance gaps
  not s.cg_sys_004_tech_doc                        as gap_tech_doc,
  not s.cg_sys_005_risk_mgmt                       as gap_risk_mgmt,
  not s.cg_sys_006_human_oversight                 as gap_oversight,
  not s.cg_sys_007_conformity                      as gap_conformity,
  not s.cg_sys_008_post_market                     as gap_pms,
  (s.eu_ai_db_registered = false
   and s.lifecycle in ('production','conformity_assessed')) as gap_eu_db,
  -- Owner
  u_owner.full_name                                as owner_name,
  u_owner.email                                    as owner_email
from gov_repo.ai_systems s
left join gov_repo.governance_users u_owner    on u_owner.user_id    = s.owner_user_id
left join gov_repo.governance_users u_oversight on u_oversight.user_id = s.oversight_person_id
where s.risk_class = 'high'
  and s.status != 'decommissioned'
order by
  case s.lifecycle
    when 'production'            then 1
    when 'conformity_assessed'   then 2
    when 'pre_market_review'     then 3
    when 'testing'               then 4
    else 5
  end,
  s.name;

comment on view gov_repo.v_ai_act_high_risk_dashboard is
  'EU AI Act compliance dashboard for high-risk AI systems only.
   Shows: CE marking, DoC, conformity assessment, EU AI DB, PMS, FRIA, oversight.
   gap_* columns: true = compliance obligation not yet satisfied.
   conformity_expiring_soon: within 90 days — trigger renewal workflow.
   For CISO / Chief AI Officer / DPO / regulatory submissions.
   Sorted by lifecycle (production first, then conformity assessed, then in-flight).';

-- ─── VIEW 3: AI System Conformity & Evidence Chain ───────────────────────────

create or replace view gov_repo.v_ai_system_conformity_status as
select
  s.organisation_id,
  s.system_id,
  s.system_code,
  s.name                                             as system_name,
  s.risk_class,
  s.lifecycle,
  s.version,
  s.ce_marking_status,
  s.conformity_procedure,
  -- Conformity Assessment record
  ca.assessment_code,
  ca.assessment_type,
  ca.status                                          as assessment_status,
  ca.outcome,
  ca.start_date                                      as assessment_start,
  ca.completion_date                                 as assessment_completed,
  ca.valid_until                                     as assessment_valid_until,
  ca.assessor_org,
  ca.non_conformities,
  -- Evidence chain
  s.technical_doc_evidence_id,
  e_techdoc.evidence_code                            as tech_doc_evidence_code,
  e_techdoc.status                                   as tech_doc_evidence_status,
  e_techdoc.verified_at                              as tech_doc_verified_at,
  s.declaration_of_conformity_id,
  e_doc.evidence_code                                as doc_evidence_code,
  e_doc.status                                       as doc_evidence_status,
  s.pms_plan_evidence_id,
  e_pms.evidence_code                                as pms_evidence_code,
  e_pms.status                                       as pms_evidence_status,
  -- DoC details
  s.doc_ref,
  s.doc_issued_date,
  s.doc_issued_by,
  -- EU AI DB
  s.eu_ai_db_registered,
  s.eu_ai_db_ref,
  s.eu_ai_db_system_uuid,
  -- ISO 42001
  s.iso_42001_certified,
  s.iso_42001_cert_ref,
  s.iso_42001_cert_expires,
  -- Completeness indicator
  (
    ca.assessment_id is not null and
    ca.outcome = 'conformant' and
    s.ce_marking_status = 'marked' and
    s.doc_ref is not null and
    s.eu_ai_db_registered = true
  )                                                  as fully_conformant
from gov_repo.ai_systems s
left join gov_repo.conformity_assessments ca
       on ca.assessment_id = s.conformity_assessment_id
left join gov_repo.evidence e_techdoc
       on e_techdoc.evidence_id = s.technical_doc_evidence_id
left join gov_repo.evidence e_doc
       on e_doc.evidence_id = s.declaration_of_conformity_id
left join gov_repo.evidence e_pms
       on e_pms.evidence_id = s.pms_plan_evidence_id
where s.status != 'decommissioned';

comment on view gov_repo.v_ai_system_conformity_status is
  'Full conformity evidence chain per AI system.
   fully_conformant = all four conditions met:
     1. Conformity assessment completed and outcome = conformant
     2. CE marking affixed (Art. 47)
     3. Declaration of Conformity issued with reference number (Art. 47(2))
     4. Registered in EU AI Database (Art. 49)
   Use for: audit evidence packs, regulatory submissions, notified body review.';

-- ─── VIEW 4: AI System → Agent Roster ────────────────────────────────────────

create or replace view gov_repo.v_ai_system_agent_roster as
select
  s.organisation_id,
  s.system_id,
  s.system_code,
  s.name                                             as system_name,
  s.risk_class                                       as system_risk_class,
  s.lifecycle                                        as system_lifecycle,
  -- Agent
  a.agent_id,
  a.agent_code,
  a.name                                             as agent_name,
  a.agent_type,
  a.risk_level                                       as agent_risk_level,
  a.ai_act_risk_class                                as agent_ai_act_class,
  a.oversight_level,
  a.status                                           as agent_status,
  a.deployment_env,
  a.model_name,
  a.model_provider,
  a.model_is_local,
  -- Agent compliance flags
  a.cg_ag_001_registered,
  a.cg_ag_002_owner,
  a.cg_ag_003_model_reg,
  a.cg_ag_007_oversight,
  a.cg_ag_010_classified,
  a.cg_ag_012_autonomous_governed,
  -- Agent gaps
  not a.cg_ag_001_registered                         as gap_001,
  not a.cg_ag_002_owner                              as gap_002,
  not a.cg_ag_003_model_reg                          as gap_003,
  not a.cg_ag_007_oversight                          as gap_007,
  not a.cg_ag_010_classified                         as gap_010,
  (a.agent_type = 'autonomous'
   and not a.cg_ag_012_autonomous_governed)          as gap_012,
  -- Agent owner
  u.full_name                                        as agent_owner_name,
  u.email                                            as agent_owner_email
from gov_repo.ai_systems s
join gov_repo.agents a on a.ai_system_id = s.system_id
join gov_repo.governance_users u on u.user_id = a.owner_user_id
where a.status not in ('decommissioned')
  and s.status != 'decommissioned'
order by
  s.system_code,
  case a.risk_level
    when 'critical' then 1
    when 'high'     then 2
    when 'medium'   then 3
    else 4
  end,
  a.agent_code;

comment on view gov_repo.v_ai_system_agent_roster is
  'All agents within each AI System with individual compliance status.
   Enables system-level conformity assessment to enumerate all agents in scope.
   Use for: Annex IV §2(a) architecture description, Art. 9 risk analysis per component,
   conformity assessment evidence (assessor needs to see all agents in scope).
   gap_* columns: agent-level CG-AG control gaps that affect system conformity.';

-- ─── VIEW 5: AI System Risk Posture ──────────────────────────────────────────

create or replace view gov_repo.v_ai_system_risk_posture as
select
  s.organisation_id,
  s.system_id,
  s.system_code,
  s.name                                             as system_name,
  s.risk_class,
  s.residual_risk_level,
  s.lifecycle,
  -- Risk management status
  s.cg_sys_005_risk_mgmt,
  s.risk_mgmt_last_review,
  s.risk_mgmt_next_review,
  (s.risk_mgmt_next_review < current_date
   and s.risk_mgmt_next_review is not null)         as risk_review_overdue,
  -- Bias and fairness
  s.bias_assessment_conducted,
  s.bias_assessment_date,
  -- FRIA
  s.fria_conducted,
  s.fria_date,
  -- Agent risk summary
  (select count(*) from gov_repo.agents a
   where a.ai_system_id = s.system_id
     and a.status not in ('decommissioned'))        as total_agents,
  (select count(*) from gov_repo.agents a
   where a.ai_system_id = s.system_id
     and a.risk_level = 'critical'
     and a.status not in ('decommissioned'))        as critical_agents,
  (select count(*) from gov_repo.agents a
   where a.ai_system_id = s.system_id
     and a.risk_level = 'high'
     and a.status not in ('decommissioned'))        as high_risk_agents,
  -- Risk propagation exposure
  (select coalesce(sum(rp.financial_impact_eur), 0)
   from gov_repo.agent_risk_propagation rp
   join gov_repo.agents a on a.agent_id = rp.risk_source_agent_id
   where a.ai_system_id = s.system_id
     and rp.is_active = true)                       as total_financial_exposure_eur,
  (select count(*) from gov_repo.agent_risk_propagation rp
   join gov_repo.agents a on a.agent_id = rp.risk_source_agent_id
   where a.ai_system_id = s.system_id
     and rp.criticality in ('critical','high')
     and rp.is_active = true)                       as critical_propagation_paths,
  -- Incident history
  s.serious_incidents_reported,
  s.last_serious_incident_at,
  -- Active exceptions against this system's agents
  (select count(*) from gov_repo.exceptions ex
   join gov_repo.agents a on a.agent_id = ex.agent_id
   where a.ai_system_id = s.system_id
     and ex.status = 'active')                      as active_exceptions,
  -- Risk entries count
  (select count(*) from gov_repo.risk_entries re
   where s.system_id = any(re.related_agent_ids::uuid[])
      or exists (
        select 1 from gov_repo.agents a
        where a.ai_system_id = s.system_id
          and a.agent_id = any(re.related_agent_ids)
      ))                                            as open_risk_entries,
  u_owner.full_name                                 as owner_name,
  u_ra.full_name                                    as residual_risk_acceptor_name
from gov_repo.ai_systems s
left join gov_repo.governance_users u_owner on u_owner.user_id = s.owner_user_id
left join gov_repo.governance_users u_ra    on u_ra.user_id    = s.residual_risk_accepted_by
where s.status != 'decommissioned'
order by
  case s.risk_class
    when 'unacceptable' then 1
    when 'high'         then 2
    when 'limited'      then 3
    else 4
  end,
  case s.residual_risk_level
    when 'critical' then 1
    when 'high'     then 2
    when 'medium'   then 3
    else 4
  end,
  s.name;

comment on view gov_repo.v_ai_system_risk_posture is
  'Aggregated risk posture per AI System.
   Combines system-level risk management status with agent-level risk propagation.
   total_financial_exposure_eur: sum of all propagation financial impacts from agents in this system.
   critical_propagation_paths: number of critical/high cascading risk paths within system.
   Use for: CISO board report, CFO risk review, DORA ICT risk assessment,
   Art. 9 risk management system evidence.';

-- =============================================================================
-- [S7] GOVERNANCE FUNCTIONS
-- =============================================================================

-- ─── FUNCTION 1: AI System Compliance Gap Detector ───────────────────────────

create or replace function gov_repo.ai_system_compliance_gaps(
  p_organisation_id uuid
)
returns table (
  system_id                 uuid,
  system_code               varchar,
  system_name               varchar,
  risk_class                gov_repo.ai_act_risk_class,
  lifecycle                 gov_repo.ai_system_lifecycle,
  gap_registered            boolean,
  gap_owner                 boolean,
  gap_risk_classified       boolean,
  gap_tech_doc              boolean,
  gap_risk_mgmt             boolean,
  gap_human_oversight       boolean,
  gap_conformity            boolean,
  gap_post_market           boolean,
  gap_eu_db                 boolean,
  gap_ce_marking            boolean,
  gap_pms_plan              boolean,
  gap_fria                  boolean,   -- FRIA for deployers of public-impact AI
  total_gaps                integer,
  owner_name                varchar,
  owner_email               varchar
)
language sql security definer as $$
  select
    s.system_id,
    s.system_code,
    s.name,
    s.risk_class,
    s.lifecycle,
    not s.cg_sys_001_registered                                      as gap_registered,
    not s.cg_sys_002_owner                                           as gap_owner,
    not s.cg_sys_003_risk_classified                                 as gap_risk_classified,
    not s.cg_sys_004_tech_doc                                        as gap_tech_doc,
    not s.cg_sys_005_risk_mgmt                                       as gap_risk_mgmt,
    not s.cg_sys_006_human_oversight                                 as gap_human_oversight,
    not s.cg_sys_007_conformity                                      as gap_conformity,
    not s.cg_sys_008_post_market                                     as gap_post_market,
    (s.eu_ai_db_registered = false
     and s.risk_class = 'high'
     and s.lifecycle in ('production','conformity_assessed'))        as gap_eu_db,
    (s.ce_marking_status not in ('marked','not_applicable')
     and s.risk_class = 'high'
     and s.lifecycle in ('production','conformity_assessed'))        as gap_ce_marking,
    (s.pms_plan_documented = false
     and s.lifecycle in ('production','post_market_surveillance'))   as gap_pms_plan,
    (s.fria_conducted = false
     and s.risk_class = 'high'
     and s.annex_iii_sector in (
       'essential_services_benefits',
       'employment_worker_management',
       'law_enforcement',
       'biometric_identification'
     ))                                                               as gap_fria,
    -- Total gaps (explicit CASE WHEN for PG compatibility — FIX-3 pattern)
    (
      case when not s.cg_sys_001_registered                                       then 1 else 0 end +
      case when not s.cg_sys_002_owner                                            then 1 else 0 end +
      case when not s.cg_sys_003_risk_classified                                  then 1 else 0 end +
      case when not s.cg_sys_004_tech_doc                                         then 1 else 0 end +
      case when not s.cg_sys_005_risk_mgmt                                        then 1 else 0 end +
      case when not s.cg_sys_006_human_oversight                                  then 1 else 0 end +
      case when not s.cg_sys_007_conformity                                       then 1 else 0 end +
      case when not s.cg_sys_008_post_market                                      then 1 else 0 end +
      case when s.eu_ai_db_registered = false
              and s.risk_class = 'high'
              and s.lifecycle in ('production','conformity_assessed')              then 1 else 0 end +
      case when s.ce_marking_status not in ('marked','not_applicable')
              and s.risk_class = 'high'
              and s.lifecycle in ('production','conformity_assessed')              then 1 else 0 end +
      case when s.pms_plan_documented = false
              and s.lifecycle in ('production','post_market_surveillance')        then 1 else 0 end +
      case when s.fria_conducted = false
              and s.risk_class = 'high'
              and s.annex_iii_sector in (
                'essential_services_benefits','employment_worker_management',
                'law_enforcement','biometric_identification')                      then 1 else 0 end
    )                                                                as total_gaps,
    u.full_name,
    u.email
  from gov_repo.ai_systems s
  join gov_repo.governance_users u on u.user_id = s.owner_user_id
  where s.organisation_id = p_organisation_id
    and s.status not in ('decommissioned')
    and (
      not s.cg_sys_001_registered or
      not s.cg_sys_002_owner      or
      not s.cg_sys_003_risk_classified or
      not s.cg_sys_004_tech_doc   or
      not s.cg_sys_005_risk_mgmt  or
      not s.cg_sys_006_human_oversight or
      not s.cg_sys_007_conformity or
      not s.cg_sys_008_post_market or
      (s.eu_ai_db_registered = false and s.risk_class = 'high'
        and s.lifecycle in ('production','conformity_assessed')) or
      (s.ce_marking_status not in ('marked','not_applicable')
        and s.risk_class = 'high'
        and s.lifecycle in ('production','conformity_assessed')) or
      (s.pms_plan_documented = false
        and s.lifecycle in ('production','post_market_surveillance')) or
      (s.fria_conducted = false and s.risk_class = 'high'
        and s.annex_iii_sector in (
          'essential_services_benefits','employment_worker_management',
          'law_enforcement','biometric_identification'))
    )
  order by
    case s.risk_class
      when 'unacceptable' then 1
      when 'high'         then 2
      when 'limited'      then 3
      else 4
    end,
    total_gaps desc;
$$;

comment on function gov_repo.ai_system_compliance_gaps is
  'EU AI Act gap detector at AI System level.
   Complements gov_repo.agent_compliance_gaps() which operates at agent level.
   Checks 12 gap conditions: 8 from cg_sys_* flags + 4 additional runtime checks
   (EU DB registration, CE marking, PMS plan, FRIA).
   gap_fria: FRIA required for high-risk systems in sectors with direct person impact.
   Returns only systems with at least one gap. Sorted by risk class then total gaps.
   Answer: "Which AI Systems need governance attention before audit?"';

-- ─── FUNCTION 2: AI System Full Evidence Report ──────────────────────────────

create or replace function gov_repo.ai_system_evidence_report(
  p_system_id uuid
)
returns table (
  evidence_category   text,
  evidence_id         uuid,
  evidence_code       varchar,
  title               varchar,
  evidence_type       gov_repo.evidence_type,
  status              gov_repo.evidence_status,
  verified_at         timestamptz,
  retention_until     date,
  classification      gov_repo.classification_level,
  collected_at        timestamptz,
  eu_ai_act_article   text,
  is_mandatory        boolean
)
language sql security definer as $$
  -- Technical documentation evidence (Art. 11 + Annex IV)
  select
    'Technical Documentation (Art. 11 + Annex IV)'::text,
    e.evidence_id, e.evidence_code, e.title, e.evidence_type,
    e.status, e.verified_at, e.retention_until, e.classification,
    e.collected_at,
    'Art. 11 + Annex IV'::text,
    true
  from gov_repo.ai_systems s
  join gov_repo.evidence e on e.evidence_id = s.technical_doc_evidence_id
  where s.system_id = p_system_id
    and s.technical_doc_evidence_id is not null

  union all

  -- Declaration of Conformity (Art. 47(2))
  select
    'Declaration of Conformity (Art. 47)'::text,
    e.evidence_id, e.evidence_code, e.title, e.evidence_type,
    e.status, e.verified_at, e.retention_until, e.classification,
    e.collected_at,
    'Art. 47(2)'::text,
    (s.risk_class = 'high')
  from gov_repo.ai_systems s
  join gov_repo.evidence e on e.evidence_id = s.declaration_of_conformity_id
  where s.system_id = p_system_id
    and s.declaration_of_conformity_id is not null

  union all

  -- Risk management evidence (Art. 9)
  select
    'Risk Management System (Art. 9)'::text,
    e.evidence_id, e.evidence_code, e.title, e.evidence_type,
    e.status, e.verified_at, e.retention_until, e.classification,
    e.collected_at,
    'Art. 9'::text,
    (s.risk_class = 'high')
  from gov_repo.ai_systems s
  join gov_repo.evidence e on e.evidence_id = s.risk_mgmt_evidence_id
  where s.system_id = p_system_id
    and s.risk_mgmt_evidence_id is not null

  union all

  -- PMS plan evidence (Art. 72)
  select
    'Post-Market Surveillance Plan (Art. 72)'::text,
    e.evidence_id, e.evidence_code, e.title, e.evidence_type,
    e.status, e.verified_at, e.retention_until, e.classification,
    e.collected_at,
    'Art. 72'::text,
    (s.risk_class = 'high')
  from gov_repo.ai_systems s
  join gov_repo.evidence e on e.evidence_id = s.pms_plan_evidence_id
  where s.system_id = p_system_id
    and s.pms_plan_evidence_id is not null

  union all

  -- FRIA evidence (Art. 9(9))
  select
    'Fundamental Rights Impact Assessment (Art. 9(9))'::text,
    e.evidence_id, e.evidence_code, e.title, e.evidence_type,
    e.status, e.verified_at, e.retention_until, e.classification,
    e.collected_at,
    'Art. 9(9)'::text,
    (s.risk_class = 'high')
  from gov_repo.ai_systems s
  join gov_repo.evidence e on e.evidence_id = s.fria_evidence_id
  where s.system_id = p_system_id
    and s.fria_evidence_id is not null

  union all

  -- Bias assessment evidence (Art. 9(7))
  select
    'Bias & Fairness Assessment (Art. 9(7))'::text,
    e.evidence_id, e.evidence_code, e.title, e.evidence_type,
    e.status, e.verified_at, e.retention_until, e.classification,
    e.collected_at,
    'Art. 9(7)'::text,
    false
  from gov_repo.ai_systems s
  join gov_repo.evidence e on e.evidence_id = s.bias_assessment_evidence_id
  where s.system_id = p_system_id
    and s.bias_assessment_evidence_id is not null

  union all

  -- Adversarial testing evidence (Art. 55)
  select
    'Adversarial Testing — GPAI Systemic Risk (Art. 55)'::text,
    e.evidence_id, e.evidence_code, e.title, e.evidence_type,
    e.status, e.verified_at, e.retention_until, e.classification,
    e.collected_at,
    'Art. 55(1)(a)'::text,
    (s.gpai_tier = 'gpai_systemic_risk')
  from gov_repo.ai_systems s
  join gov_repo.evidence e on e.evidence_id = s.adversarial_testing_evidence_id
  where s.system_id = p_system_id
    and s.adversarial_testing_evidence_id is not null

  union all

  -- Annex III exception evidence (Art. 6(3))
  select
    'Annex III Exception Justification (Art. 6(3))'::text,
    e.evidence_id, e.evidence_code, e.title, e.evidence_type,
    e.status, e.verified_at, e.retention_until, e.classification,
    e.collected_at,
    'Art. 6(3)'::text,
    s.annex_iii_exception_claimed
  from gov_repo.ai_systems s
  join gov_repo.evidence e on e.evidence_id = s.annex_iii_exception_evidence_id
  where s.system_id = p_system_id
    and s.annex_iii_exception_evidence_id is not null

  order by is_mandatory desc, evidence_category;
$$;

comment on function gov_repo.ai_system_evidence_report is
  'Returns the complete evidence chain for a single AI System, categorised by
   EU AI Act article. is_mandatory = true means the evidence is legally required
   for the system''s risk class and lifecycle stage.
   Use for: Annex IV technical file assembly, conformity assessment evidence pack,
   regulator/NCA evidence submission, ISO 42001 audit evidence bundle.
   Missing mandatory evidence = gap that must be closed before market placement.';

-- =============================================================================
-- [S8] MANDATE SEEDS — Additional regulatory mandates not in M006
-- These add EU AI Act articles not covered by the original mandate seed in M003
-- =============================================================================

insert into gov_repo.mandates (
  mandate_code, regulation, section_ref, title,
  requirement_text, requirement_type, effective_date,
  applicability, mapped_controls
)
values
  (
    'EU-AI-ACT-ART-6',
    'EU AI Act (2024/1689)',
    'Art. 6 + Annex III',
    'Classification Rules for High-Risk AI Systems',
    'AI systems listed in Annex III and AI systems embedded in regulated products '
    '(Annex I) shall be considered high-risk. Providers may claim exception under '
    'Art. 6(3) if they demonstrate no significant risk of harm.',
    'mandatory',
    '2025-08-02',
    '{"sectors": ["all"], "risk_classes": ["high"], "roles": ["provider"]}',
    array['CG-AG-010']
  ),
  (
    'EU-AI-ACT-ART-13',
    'EU AI Act (2024/1689)',
    'Art. 13',
    'Transparency and Provision of Information to Deployers',
    'High-risk AI systems shall be designed and developed in such a way as to ensure '
    'that their operation is sufficiently transparent to enable deployers to interpret '
    'the system''s output and use it appropriately. Provider shall accompany system '
    'with instructions for use in appropriate digital format.',
    'mandatory',
    '2025-08-02',
    '{"sectors": ["all"], "risk_classes": ["high"], "roles": ["provider"]}',
    array['CG-AG-007']
  ),
  (
    'EU-AI-ACT-ART-17',
    'EU AI Act (2024/1689)',
    'Art. 17',
    'Quality Management System',
    'Providers of high-risk AI systems shall implement a quality management system '
    'that ensures compliance with this Regulation. The QMS shall cover the entire '
    'lifecycle including design, development, testing, deployment, monitoring, and '
    'post-market surveillance.',
    'mandatory',
    '2025-08-02',
    '{"sectors": ["all"], "risk_classes": ["high"], "roles": ["provider"]}',
    array['CG-AG-001', 'CG-AG-010']
  ),
  (
    'EU-AI-ACT-ART-43',
    'EU AI Act (2024/1689)',
    'Art. 43',
    'Conformity Assessment',
    'Before placing a high-risk AI system on the market, providers shall carry out '
    'a conformity assessment. The conformity assessment shall follow procedures in '
    'Annex VI (internal control) or Annex VII (third-party) as applicable.',
    'mandatory',
    '2025-08-02',
    '{"sectors": ["all"], "risk_classes": ["high"], "roles": ["provider"]}',
    array['CG-AG-010']
  ),
  (
    'EU-AI-ACT-ART-47',
    'EU AI Act (2024/1689)',
    'Art. 47',
    'EU Declaration of Conformity and CE Marking',
    'Providers shall draw up a written EU Declaration of Conformity and affix the '
    'CE marking of conformity to high-risk AI systems before placing them on the market. '
    'The CE marking shall be subject to the principles in Art. 30 of Regulation (EC) No 765/2008.',
    'mandatory',
    '2025-08-02',
    '{"sectors": ["all"], "risk_classes": ["high"], "roles": ["provider"]}',
    array['CG-AG-010']
  ),
  (
    'EU-AI-ACT-ART-49',
    'EU AI Act (2024/1689)',
    'Art. 49',
    'Registration in EU AI Database',
    'Before placing high-risk AI systems on the market or putting them into service, '
    'providers shall register themselves and their systems in the EU AI database '
    'established under Art. 71.',
    'mandatory',
    '2025-08-02',
    '{"sectors": ["all"], "risk_classes": ["high"], "roles": ["provider", "deployer"]}',
    array['CG-AG-001', 'CG-AG-010']
  ),
  (
    'EU-AI-ACT-ART-53',
    'EU AI Act (2024/1689)',
    'Art. 53',
    'GPAI Model Obligations',
    'Providers of GPAI models shall draw up and maintain technical documentation, '
    'provide information and documentation to downstream providers, comply with EU '
    'copyright law, and publish a summary of training content.',
    'mandatory',
    '2025-08-02',
    '{"sectors": ["all"], "gpai": true, "roles": ["provider"]}',
    array['CG-AG-003']
  ),
  (
    'EU-AI-ACT-ART-55',
    'EU AI Act (2024/1689)',
    'Art. 55',
    'GPAI Models with Systemic Risk — Additional Obligations',
    'Providers of GPAI models with systemic risk shall perform adversarial testing, '
    'track and report serious incidents to the AI Office, implement cybersecurity '
    'measures, and report on energy efficiency.',
    'mandatory',
    '2025-08-02',
    '{"sectors": ["all"], "gpai_systemic_risk": true, "roles": ["provider"]}',
    array['CG-AG-003', 'CG-AG-010']
  ),
  (
    'EU-AI-ACT-ART-72',
    'EU AI Act (2024/1689)',
    'Art. 72',
    'Post-Market Surveillance',
    'Providers of high-risk AI systems shall establish and document a post-market '
    'surveillance system proportionate to the nature of the AI technology. The system '
    'shall actively and systematically collect, document and analyse relevant data '
    'throughout the operational lifetime.',
    'mandatory',
    '2025-08-02',
    '{"sectors": ["all"], "risk_classes": ["high"], "roles": ["provider"]}',
    array['CG-AG-010', 'CG-AG-012']
  ),
  (
    'EU-AI-ACT-ART-26',
    'EU AI Act (2024/1689)',
    'Art. 26',
    'Obligations of Deployers of High-Risk AI Systems',
    'Deployers shall implement human oversight measures, assign AI officer, ensure '
    'data governance, conduct fundamental rights impact assessment where required, '
    'maintain logs per Art. 12, and inform workers'' representatives.',
    'mandatory',
    '2025-08-02',
    '{"sectors": ["all"], "risk_classes": ["high"], "roles": ["deployer", "provider_and_deployer"]}',
    array['CG-AG-007', 'CG-AG-008', 'CG-AG-009']
  ),
  (
    'ISO42001-8-3',
    'ISO/IEC 42001:2023',
    'Clause 8.3',
    'AI System Impact Assessment',
    'The organisation shall conduct impact assessments for AI systems to identify '
    'potential negative impacts on individuals, groups, and society, and implement '
    'appropriate measures to prevent or mitigate them.',
    'mandatory',
    '2023-12-18',
    '{"sectors": ["all"]}',
    array['CG-AG-009', 'CG-AG-010']
  ),
  (
    'NIST-MANAGE-1-3',
    'NIST AI RMF 1.0',
    'MANAGE 1.3',
    'Risk Tolerance and Residual Risk',
    'Responses to identified AI risks are prioritized and documented based on '
    'established risk tolerance. Residual risks are accepted or escalated with '
    'documented rationale.',
    'recommended',
    '2023-01-26',
    '{"sectors": ["all"]}',
    array['CG-AG-010', 'CG-AG-012']
  )
on conflict (mandate_code) do nothing;

-- =============================================================================
-- [S9] GRANTS
-- =============================================================================

grant execute on function gov_repo.update_ai_system_compliance_flags  to service_role;
grant execute on function gov_repo.ai_system_compliance_gaps           to service_role, authenticated;
grant execute on function gov_repo.ai_system_evidence_report           to service_role, authenticated;
