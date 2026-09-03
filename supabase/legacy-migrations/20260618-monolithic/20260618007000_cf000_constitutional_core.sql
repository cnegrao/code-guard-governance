-- =============================================================================
-- CODEGUARD AI GOVERNANCE OS
-- Migration: CF-000 Constitutional Core
-- Domain:    Meta-governança — quem governa o próprio padrão
-- Depends:   20260618002000_gov_repo_identity_and_ledger
-- =============================================================================

-- ─── CONSTITUTION REGISTRY ──────────────────────────────────────────────────
-- Versões ratificadas do Constitutional Core (CF-000 a CF-012)
create table gov_repo.constitution_registry (
  const_id         uuid        primary key default uuid_generate_v4(),
  const_code       varchar(20) not null,       -- CF-000, CF-001, etc.
  const_name       varchar(255) not null,       -- Constitutional Core, Agent Governance Framework, etc.
  version          varchar(20) not null,        -- 1.0, 1.1, 2.0
  status           varchar(30) not null default 'draft',  -- draft|ratified|superseded|amended
  governing_question text not null,             -- Pergunta governante do módulo
  content_md       text,                        -- Texto constitucional completo
  content_hash     char(64),                    -- SHA-256 do conteúdo
  ratified_by      uuid references gov_repo.governance_users(user_id),
  ratified_at      timestamptz,
  superseded_by    uuid references gov_repo.constitution_registry(const_id),
  organisation_id  uuid not null references gov_repo.organisations(organisation_id),
  ledger_entry_seq bigint references gov_repo.governance_ledger(entry_sequence),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint constitution_registry_code_version_unique unique (const_code, version)
);

comment on table gov_repo.constitution_registry is
  'CF-000: Ratified versions of the Constitutional Core — the meta-governance register';
comment on column gov_repo.constitution_registry.governing_question is
  'The fundamental question this CF module must answer in real time';

-- ─── RFC REGISTRY ──────────────────────────────────────────────────────────
-- Request for Comments — propostas de mudança ao framework
create table gov_repo.rfc_registry (
  rfc_id           uuid        primary key default uuid_generate_v4(),
  rfc_code         varchar(30) not null,       -- RFC-001, RFC-002, etc.
  title            varchar(255) not null,
  summary          text not null,
  affected_cf      varchar(20)[],              -- CF-000, CF-001, etc.
  rfc_type         varchar(30) not null,       -- amendment|new_module|clarification|deprecation
  status           varchar(30) not null default 'draft', -- draft|review|voting|accepted|rejected|implemented
  author_id        uuid not null references gov_repo.governance_users(user_id),
  content_md       text,
  discussion_log   jsonb not null default '[]', -- histórico de discussões
  votes_for        integer not null default 0,
  votes_against    integer not null default 0,
  votes_abstain    integer not null default 0,
  voting_deadline  timestamptz,
  outcome          text,                        -- justificativa da decisão final
  implemented_in   varchar(20),                 -- versão do framework que implementou
  organisation_id  uuid not null references gov_repo.organisations(organisation_id),
  ledger_entry_seq bigint references gov_repo.governance_ledger(entry_sequence),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint rfc_registry_code_unique unique (rfc_code)
);

comment on table gov_repo.rfc_registry is
  'CF-000: Request for Comments — formal proposals to change the Living Standards Framework';

-- ─── APPEALS ───────────────────────────────────────────────────────────────
-- Recursos e contestações a decisões de governança
create table gov_repo.appeals (
  appeal_id        uuid        primary key default uuid_generate_v4(),
  appeal_code      varchar(30) not null,       -- APL-001, APL-002, etc.
  title            varchar(255) not null,
  description      text not null,
  subject_type     varchar(50) not null,        -- decision|exception|assessment|certification
  subject_id       uuid not null,               -- ID da decisão/avaliação contestada
  grounds          text not null,               -- fundamentos do recurso
  appellant_id     uuid not null references gov_repo.governance_users(user_id),
  status           varchar(30) not null default 'submitted', -- submitted|under_review|upheld|rejected|partially_upheld
  reviewer_id      uuid references gov_repo.governance_users(user_id),
  reviewed_at      timestamptz,
  decision         text,                        -- decisão do conselho
  decision_rationale text,
  remedy           text,                        -- ação corretiva se uphold
  organisation_id  uuid not null references gov_repo.organisations(organisation_id),
  ledger_entry_seq bigint references gov_repo.governance_ledger(entry_sequence),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint appeals_code_unique unique (appeal_code)
);

comment on table gov_repo.appeals is
  'CF-000: Appeals against governance decisions — constitutional right of contestation';

-- ─── COUNCIL DECISIONS ────────────────────────────────────────────────────
-- Decisões do conselho de governança constitucional
create table gov_repo.council_decisions (
  decision_id      uuid        primary key default uuid_generate_v4(),
  decision_code    varchar(30) not null,       -- CD-001, CD-002, etc.
  title            varchar(255) not null,
  summary          text not null,
  subject_type     varchar(50),                 -- rfc|appeal|amendment|interpretation
  subject_id       uuid,                        -- ID do assunto relacionado
  decision_type    varchar(30) not null,        -- interpretive_ruling|procedural|emergency|amendment_ratification
  ruling           text not null,               -- texto completo da decisão
  rationale        text not null,               -- fundamentação
  decided_by       uuid[] not null,             -- conselheiros que decidiram
  majority_percent numeric(5,2),                -- % de votos a favor
  dissenting_opinions jsonb default '[]',
  effective_date   date not null,
  status           varchar(30) not null default 'active', -- active|superseded|overturned
  overturned_by    uuid references gov_repo.council_decisions(decision_id),
  organisation_id  uuid not null references gov_repo.organisations(organisation_id),
  ledger_entry_seq bigint references gov_repo.governance_ledger(entry_sequence),
  created_at       timestamptz not null default now(),
  constraint council_decisions_code_unique unique (decision_code)
);

comment on table gov_repo.council_decisions is
  'CF-000: Governance council decisions — interpretive rulings and constitutional adjudication';

-- ─── AMENDMENTS ────────────────────────────────────────────────────────────
-- Emendas ratificadas ao framework
create table gov_repo.amendments (
  amendment_id     uuid        primary key default uuid_generate_v4(),
  amendment_code   varchar(30) not null,       -- AMD-001, AMD-002, etc.
  title            varchar(255) not null,
  description      text not null,
  rfc_id           uuid references gov_repo.rfc_registry(rfc_id),
  affected_cf      varchar(20) not null,       -- CF-000..CF-012
  change_type      varchar(30) not null,       -- add|modify|deprecate|remove
  change_summary   text not null,
  old_text         text,                        -- texto anterior (se modify/deprecate)
  new_text         text not null,               -- novo texto constitucional
  ratified_by      uuid not null references gov_repo.governance_users(user_id),
  council_decision_id uuid references gov_repo.council_decisions(decision_id),
  effective_date   date not null,
  status           varchar(30) not null default 'ratified', -- proposed|ratified|superseded|reverted
  superseded_by    uuid references gov_repo.amendments(amendment_id),
  organisation_id  uuid not null references gov_repo.organisations(organisation_id),
  ledger_entry_seq bigint references gov_repo.governance_ledger(entry_sequence),
  created_at       timestamptz not null default now(),
  constraint amendments_code_unique unique (amendment_code)
);

comment on table gov_repo.amendments is
  'CF-000: Ratified amendments to the Living Standards Framework — constitutional change tracking';

-- ─── RLS Policies ─────────────────────────────────────────────────────────
alter table gov_repo.constitution_registry enable row level security;
alter table gov_repo.rfc_registry enable row level security;
alter table gov_repo.appeals enable row level security;
alter table gov_repo.council_decisions enable row level security;
alter table gov_repo.amendments enable row level security;

-- ─── Seed: CF-000 a CF-012 no constitution_registry ──────────────────────
-- (opcional: registrar os 13 módulos como versão inicial)
