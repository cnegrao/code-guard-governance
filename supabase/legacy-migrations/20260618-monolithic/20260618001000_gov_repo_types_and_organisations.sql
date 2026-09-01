-- =============================================================================
-- CODEGUARD AI GOVERNANCE OS
-- Migration: 20260618001000_gov_repo_types_and_organisations
-- Domain:    Governance Repository — Foundation Layer
-- Requires:  uuid-ossp, pgcrypto
-- Regulatory: EU AI Act | DORA | ISO 42001 | NIST AI RMF
-- =============================================================================

-- ─── EXTENSIONS ──────────────────────────────────────────────────────────────
create extension if not exists "uuid-ossp";
create extension if not exists "pgcrypto";
create extension if not exists "pg_trgm";   -- Text similarity search

-- ─── SCHEMA ──────────────────────────────────────────────────────────────────
create schema if not exists gov_repo;

-- ─── CUSTOM ENUM TYPES ───────────────────────────────────────────────────────

-- Policy lifecycle states
create type gov_repo.policy_status as enum (
  'draft',
  'in_review',
  'approved',
  'deprecated',
  'superseded'
);

create type gov_repo.policy_type as enum (
  'operational',
  'risk',
  'security',
  'data',
  'ethics',
  'compliance'
);

create type gov_repo.version_status as enum (
  'draft',
  'under_review',
  'approved',
  'rejected',
  'superseded'
);

-- Risk management states
create type gov_repo.risk_status as enum (
  'identified',
  'assessed',
  'treated',
  'monitored',
  'accepted',
  'closed',
  'escalated'
);

create type gov_repo.risk_category as enum (
  'operational',
  'compliance',
  'reputational',
  'strategic',
  'financial',
  'legal',
  'technology',
  'third_party'
);

create type gov_repo.risk_treatment_type as enum (
  'mitigate',
  'accept',
  'transfer',
  'avoid',
  'share'
);

-- Evidence lifecycle states
create type gov_repo.evidence_status as enum (
  'draft',
  'submitted',
  'under_review',
  'verified',
  'linked',
  'superseded',
  'expired',
  'rejected'
);

create type gov_repo.evidence_type as enum (
  'document',
  'screenshot',
  'log_export',
  'test_result',
  'attestation',
  'certificate',
  'audit_report',
  'configuration',
  'interview_record',
  'system_export'
);

create type gov_repo.collection_method as enum (
  'manual_upload',
  'automated_collection',
  'api_export',
  'system_generated'
);

create type gov_repo.retention_class as enum (
  'standard_3y',      -- 3 years  — general governance artefacts
  'regulatory_5y',    -- 5 years  — regulatory submissions
  'dora_5y',          -- 5 years  — DORA Art. 8 requirement
  'aiact_10y',        -- 10 years — EU AI Act high-risk systems
  'legal_hold'        -- Indefinite — legal proceedings
);

create type gov_repo.classification_level as enum (
  'public',
  'internal',
  'confidential',
  'restricted'
);

create type gov_repo.verification_method as enum (
  'technical',
  'manual',
  'automated',
  'third_party'
);

-- Approval workflow states
create type gov_repo.approval_status as enum (
  'draft',
  'submitted',
  'in_review',
  'escalated',
  'approved',
  'rejected',
  'returned',
  'withdrawn',
  'expired'
);

create type gov_repo.approval_decision as enum (
  'approved',
  'rejected',
  'returned',
  'abstained',
  'delegated'
);

create type gov_repo.approval_priority as enum (
  'routine',
  'high',
  'urgent',
  'emergency'
);

-- Exception states
create type gov_repo.exception_status as enum (
  'draft',
  'submitted',
  'under_review',
  'approved',
  'rejected',
  'active',
  'expired',
  'revoked',
  'closed'
);

create type gov_repo.exception_type as enum (
  'policy_deviation',
  'control_waiver',
  'risk_acceptance',
  'regulatory_gap',
  'technical_constraint'
);

create type gov_repo.review_frequency as enum (
  'monthly',
  'quarterly',
  'on_event'
);

-- Conformity assessment states (EU AI Act Art. 43)
create type gov_repo.conformity_status as enum (
  'not_started',
  'in_progress',
  'completed',
  'approved',
  'rejected',
  'under_notified_body_review'
);

create type gov_repo.conformity_outcome as enum (
  'conformant',
  'non_conformant',
  'conditionally_conformant'
);

create type gov_repo.conformity_type as enum (
  'internal',
  'third_party',
  'notified_body'
);

-- Control assessment states
create type gov_repo.assessment_status as enum (
  'planned',
  'in_progress',
  'completed',
  'reviewed',
  'closed'
);

create type gov_repo.operating_effectiveness as enum (
  'not_effective',
  'partially_effective',
  'substantially_effective',
  'fully_effective'
);

create type gov_repo.design_effectiveness as enum (
  'deficient',
  'needs_improvement',
  'adequate',
  'strong'
);

-- Findings
create type gov_repo.finding_type as enum (
  'deficiency',
  'weakness',
  'observation',
  'best_practice'
);

create type gov_repo.finding_severity as enum (
  'critical',
  'high',
  'medium',
  'low',
  'informational'
);

create type gov_repo.finding_status as enum (
  'open',
  'in_remediation',
  'closed',
  'accepted',
  'escalated'
);

-- QES / eIDAS
create type gov_repo.signature_format as enum (
  'pades',
  'xades',
  'cades',
  'jades'
);

create type gov_repo.signature_status as enum (
  'valid',
  'invalid',
  'expired',
  'revoked',
  'unknown'
);

-- User states
create type gov_repo.user_status as enum (
  'active',
  'suspended',
  'pending',
  'deactivated'
);

-- Compliance states
create type gov_repo.compliance_status as enum (
  'not_assessed',
  'partial',
  'compliant',
  'non_compliant'
);

create type gov_repo.mandate_type as enum (
  'mandatory',
  'recommended',
  'conditional'
);

-- ─── ORGANISATIONS ────────────────────────────────────────────────────────────
create table gov_repo.organisations (
  organisation_id   uuid primary key default uuid_generate_v4(),
  org_code          varchar(20)  not null,
  legal_name        varchar(500) not null,
  display_name      varchar(255) not null,
  regulatory_id     varchar(100),               -- BIC / LEI / NIF / VAT
  country_code      char(2)      not null,       -- ISO 3166-1 alpha-2
  regulatory_tier   varchar(50),                -- significant|less_significant|non_supervised
  is_active         boolean      not null default true,
  created_at        timestamptz  not null default now(),
  updated_at        timestamptz  not null default now(),
  constraint organisations_org_code_unique unique (org_code)
);

comment on table gov_repo.organisations is
  'Regulated entity or organisational unit. Root tenant for all governance data.';
comment on column gov_repo.organisations.regulatory_id is
  'External regulatory identifier: BIC for banks, LEI for capital markets, NIF for Portugal.';
comment on column gov_repo.organisations.regulatory_tier is
  'ECB supervisory tier: significant institution (SI) or less significant institution (LSI).';

-- Updated-at trigger
create or replace function gov_repo.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger trg_organisations_updated_at
  before update on gov_repo.organisations
  for each row execute function gov_repo.set_updated_at();

-- RLS
alter table gov_repo.organisations enable row level security;

create policy "Service role has full access to organisations"
  on gov_repo.organisations
  for all to service_role using (true) with check (true);
