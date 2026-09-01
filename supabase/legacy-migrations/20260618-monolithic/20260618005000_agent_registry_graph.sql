-- =============================================================================
-- CODEGUARD AI GOVERNANCE OS
-- Migration: 20260618005000_agent_registry_graph
-- Domain:    Agent Registry + Graph Engine (Knowledge Graph — Postgres Native)
-- Depends:   20260618004000_gov_repo_workflows_assessments_views
-- Version:   1.1 — Corrections applied per architectural review
-- =============================================================================
-- Corrections vs v1.0:
--   [C1] vector(1536) kept (pgvector HNSW max = 2000 dims) + embedding_dimensions column
--   [C2] agents.ai_system_id added (AI Act: systems, not agents — FK added in M006)
--   [C3] agent_embeddings unique constraint: deferrable → partial unique index
--   [C4] agent_semantic_search updated to use cosine distance correctly
--   [C5] agent_edges: PII-carrying edges without data governance comment strengthened
--   [C6] agents constraint: high-risk oversight check made non-blocking on insert
-- Bug fixes vs v1.1 submission:
--   [FIX-1] agent_risk_propagation.criticality: GENERATED ALWAYS AS with ENUM cast
--           is NOT supported in PostgreSQL. Replaced with a trigger-maintained column.
--   [FIX-2] agent_risk_propagation.propagation_depth: array_length() returns NULL for
--           empty arrays, violating NOT NULL. Wrapped with coalesce(..., 0).
--   [FIX-3] agent_compliance_gaps: boolean-expression::int cast made explicit with
--           CASE WHEN for maximum compatibility across PostgreSQL versions.
-- Architecture:
--   Graph = PostgreSQL + pgvector + Recursive CTE
--   NO Neo4j. NO Apollo Federation. NO Kafka.
--   Enables: CG-AG-001|002|003|004|005|006|007|009|010|011|012
-- =============================================================================

-- ─── EXTENSIONS ──────────────────────────────────────────────────────────────
create extension if not exists "vector";
create extension if not exists "uuid-ossp";
create extension if not exists "pgcrypto";

-- ─── ENUM TYPES ──────────────────────────────────────────────────────────────

create type gov_repo.agent_type as enum (
  'autonomous',       -- Acts without human intervention (CG-AG-012 mandatory)
  'assistive',        -- Assists humans, human makes final decision
  'supervisory',      -- Monitors and supervises other agents (CG-AG-011)
  'gateway',          -- Entry point / orchestrator for agent networks
  'orchestrator',     -- Coordinates multiple sub-agents
  'retrieval',        -- RAG / knowledge retrieval agent
  'classifier'        -- Risk/content classification agent
);

create type gov_repo.agent_risk_level as enum (
  'critical',         -- Unacceptable risk — requires immediate action
  'high',             -- High-risk per EU AI Act Annex III
  'medium',           -- Tolerable with compensating controls
  'low'               -- Minimal risk — standard monitoring
);

create type gov_repo.ai_act_risk_class as enum (
  'unacceptable',     -- Prohibited (AI Act Art. 5)
  'high',             -- High-risk (AI Act Annex III) — Art. 43 conformity required
  'limited',          -- Limited risk (Art. 50) — transparency obligations only
  'minimal'           -- Minimal risk — no mandatory requirements
);

create type gov_repo.oversight_level as enum (
  'l1_automated',      -- Fully automated monitoring only
  'l2_human_review',   -- Human reviews output before acting
  'l3_human_approval', -- Human must approve before action (CG-AG-007)
  'l4_human_in_loop'   -- Human participates in every decision
);

create type gov_repo.agent_status as enum (
  'pending_registration',
  'registered',
  'approved',
  'active',
  'suspended',
  'under_review',
  'decommissioned'
);

create type gov_repo.edge_relationship as enum (
  'CALLS_AGENT',
  'DELEGATES_TO',
  'SUPERVISES',
  'DEPENDS_ON',
  'ESCALATES_TO',
  'ORCHESTRATES',
  'FALLBACK_TO',
  'PEER_COORDINATES'
);

create type gov_repo.resource_type as enum (
  'mcp_server',
  'tool',
  'model',
  'prompt',
  'policy',
  'api',
  'database',
  'file_system',
  'message_queue',
  'vector_store'
);

create type gov_repo.access_type as enum (
  'read', 'write', 'execute', 'admin', 'read_write'
);

create type gov_repo.propagation_type as enum (
  'direct',
  'indirect',
  'cascading'
);

-- =============================================================================
-- TABLE 1: AGENTS
-- CG-AG-001 Agent Inventory | CG-AG-002 Agent Owner | CG-AG-010 Risk Classification
-- [C2] ai_system_id added — AI Act Art. 3.1 regulates AI Systems, not individual agents.
--      FK to gov_repo.ai_systems will be added in Migration 006.
-- =============================================================================
create table gov_repo.agents (
  -- Identity
  agent_id              uuid          primary key default uuid_generate_v4(),
  agent_code            varchar(20)   not null,
  name                  varchar(255)  not null,
  description           text          not null,
  version               varchar(50)   not null default '1.0.0',

  -- [C2] AI System reference (AI Act Art. 3.1 — system is the regulated unit)
  -- FK to gov_repo.ai_systems added in Migration 006.
  -- NULL = agent not yet associated with an AI System (governance gap)
  ai_system_id          uuid,

  -- Classification (CG-AG-010)
  agent_type            gov_repo.agent_type not null,
  risk_level            gov_repo.agent_risk_level not null default 'medium',
  ai_act_risk_class     gov_repo.ai_act_risk_class not null default 'minimal',
  oversight_level       gov_repo.oversight_level not null default 'l2_human_review',

  -- Ownership (CG-AG-002)
  owner_user_id         uuid          not null references gov_repo.governance_users (user_id),
  technical_owner_id    uuid          references gov_repo.governance_users (user_id),
  business_domain       varchar(100),
  department            varchar(100),

  -- Model info (CG-AG-003)
  model_name            varchar(255),
  model_version         varchar(100),
  model_provider        varchar(100),
  model_is_local        boolean       not null default false,
  model_endpoint        text,

  -- Deployment
  deployment_env        varchar(30)   not null default 'development'
                        check (deployment_env in ('development','staging','production')),
  deployment_region     varchar(50),
  deployment_type       varchar(30)   not null default 'on_premises'
                        check (deployment_type in ('on_premises','private_cloud','hybrid','public_cloud')),

  -- Status
  status                gov_repo.agent_status not null default 'pending_registration',
  approved_for_production boolean     not null default false,
  suspended_reason      text,
  suspended_at          timestamptz,

  -- CG-AGF Compliance Flags (auto-updated by trigger)
  cg_ag_001_registered  boolean       not null default false,
  cg_ag_002_owner       boolean       not null default false,
  cg_ag_003_model_reg   boolean       not null default false,
  cg_ag_007_oversight   boolean       not null default false,
  cg_ag_008_audit_trail boolean       not null default false,
  cg_ag_010_classified  boolean       not null default false,
  cg_ag_012_autonomous_governed boolean not null default false,

  -- Conformity (AI Act Art. 43)
  conformity_assessment_id uuid       references gov_repo.conformity_assessments (assessment_id),
  eu_ai_db_registered   boolean       not null default false,
  eu_ai_db_ref          varchar(100),

  -- Metadata
  tags                  jsonb         not null default '[]',
  capabilities          jsonb         not null default '[]',
  external_refs         jsonb         not null default '{}',

  -- Tenant
  organisation_id       uuid          not null references gov_repo.organisations (organisation_id),

  -- Audit
  ledger_entry_seq      bigint        references gov_repo.governance_ledger (entry_sequence),
  created_at            timestamptz   not null default now(),
  updated_at            timestamptz   not null default now(),
  created_by            uuid          not null references gov_repo.governance_users (user_id),

  constraint agents_code_org_unique unique (agent_code, organisation_id)

  -- [C6] Removed hard constraint on oversight_level for high risk agents.
  -- Enforced at application layer + compliance flag cg_ag_007_oversight.
  -- Hard DB constraint caused blocking on initial registration before owner sets oversight.
);

comment on table gov_repo.agents is
  'AI Agent master registry. Node principal of the Governance Knowledge Graph.
   CG-AG-001 (Inventory) | CG-AG-002 (Owner) | CG-AG-010 (Risk Classification).
   [C2] ai_system_id links agent to its parent AI System (AI Act Art. 3.1).
   FK to gov_repo.ai_systems added in Migration 006.
   NULL ai_system_id = governance gap — agent not associated to any AI System.
   Applicable to any regulated sector: financial services, insurance, healthcare,
   utilities, public sector, critical infrastructure.';

comment on column gov_repo.agents.ai_system_id is
  '[C2] AI Act Art. 3(1) defines AI System as the regulated unit, not individual agents.
   Example: Credit Scoring AI System contains 4 agents (scoring, fraud, risk, explainability).
   This FK will be enforced in Migration 006 when gov_repo.ai_systems is created.';

comment on column gov_repo.agents.model_is_local is
  'Data sovereignty flag. TRUE = model runs on-premises or in private cloud
   (no data leaves the organisation''s controlled jurisdiction).
   Required for: agents processing PHI, PII, financial data, or any data
   subject to residency requirements (GDPR, DORA, NIS2, sector-specific rules).
   Applicable to: financial services, healthcare, insurance, public sector,
   critical infrastructure, any organisation with data localisation obligations.';

-- Indexes
create index idx_agents_org           on gov_repo.agents (organisation_id);
create index idx_agents_status        on gov_repo.agents (status);
create index idx_agents_risk_level    on gov_repo.agents (risk_level);
create index idx_agents_ai_act        on gov_repo.agents (ai_act_risk_class);
create index idx_agents_owner         on gov_repo.agents (owner_user_id);
create index idx_agents_type          on gov_repo.agents (agent_type);
create index idx_agents_domain        on gov_repo.agents (business_domain);
create index idx_agents_ai_system     on gov_repo.agents (ai_system_id) where ai_system_id is not null;
create index idx_agents_tags          on gov_repo.agents using gin (tags);
create index idx_agents_capabilities  on gov_repo.agents using gin (capabilities);
-- Compliance gap indexes
create index idx_agents_no_system     on gov_repo.agents (organisation_id)
  where ai_system_id is null and status = 'active';
create index idx_agents_cg001_gap     on gov_repo.agents (organisation_id)
  where cg_ag_001_registered = false and status not in ('decommissioned');

-- Auto-set compliance flags trigger
create or replace function gov_repo.update_agent_compliance_flags()
returns trigger language plpgsql as $$
begin
  new.cg_ag_001_registered := (
    new.agent_code is not null and
    new.name is not null and
    new.agent_type is not null and
    new.organisation_id is not null
  );
  new.cg_ag_002_owner   := (new.owner_user_id is not null);
  new.cg_ag_003_model_reg := (new.model_name is not null and new.model_provider is not null);
  new.cg_ag_007_oversight := (
    new.oversight_level is not null and (
      new.risk_level = 'low' or
      new.oversight_level in ('l2_human_review','l3_human_approval','l4_human_in_loop')
    )
  );
  return new;
end;
$$;

create trigger trg_agents_compliance_flags
  before insert or update on gov_repo.agents
  for each row execute function gov_repo.update_agent_compliance_flags();

create trigger trg_agents_updated_at
  before update on gov_repo.agents
  for each row execute function gov_repo.set_updated_at();

alter table gov_repo.agents enable row level security;
create policy "Service role has full access to agents"
  on gov_repo.agents for all to service_role using (true) with check (true);
create policy "Org-scoped access to agents"
  on gov_repo.agents for select to authenticated
  using (organisation_id = (
    select organisation_id from gov_repo.governance_users
    where email = auth.email() limit 1
  ));

-- =============================================================================
-- TABLE 2: AGENT_EDGES (Coração do Grafo)
-- CG-AG-011: Agent-to-Agent Governance
-- =============================================================================
create table gov_repo.agent_edges (
  edge_id               uuid          primary key default uuid_generate_v4(),
  source_agent_id       uuid          not null references gov_repo.agents (agent_id),
  target_agent_id       uuid          not null references gov_repo.agents (agent_id),
  relationship_type     gov_repo.edge_relationship not null,
  direction             varchar(20)   not null default 'unidirectional'
                        check (direction in ('unidirectional','bidirectional')),
  -- [C5] weight documented explicitly: 1.0 = critical dep, 0.1 = loose coupling
  weight                numeric(4,3)  not null default 0.5
                        check (weight between 0.001 and 1.000),
  requires_approval     boolean       not null default false,
  approval_mode         varchar(30)   not null default 'automatic'
                        check (approval_mode in ('automatic','human_review','human_approval')),
  approved_by           uuid          references gov_repo.governance_users (user_id),
  approved_at           timestamptz,
  sla_ms                integer,
  max_calls_per_minute  integer,
  timeout_ms            integer,
  is_active             boolean       not null default true,
  deactivated_reason    text,
  deactivated_at        timestamptz,
  -- Data flowing on this edge (CG-AG-009)
  -- [C5] These 3 flags trigger MANDATORY Data Governance review per CG-AG-009
  data_classification   gov_repo.classification_level not null default 'internal',
  carries_pii           boolean       not null default false,
  carries_phi           boolean       not null default false,
  carries_financial     boolean       not null default false,
  metadata              jsonb         not null default '{}',
  organisation_id       uuid          not null references gov_repo.organisations (organisation_id),
  ledger_entry_seq      bigint        references gov_repo.governance_ledger (entry_sequence),
  created_at            timestamptz   not null default now(),
  updated_at            timestamptz   not null default now(),
  constraint agent_edges_no_self_loop check (source_agent_id <> target_agent_id),
  constraint agent_edges_unique unique (source_agent_id, target_agent_id, relationship_type)
);

comment on table gov_repo.agent_edges is
  'Directed edges of the Agent Knowledge Graph. CG-AG-011: all agent-to-agent
   relationships MUST be registered here before production.
   weight: 1.0 = critical (full risk propagation), 0.1 = loose coupling.
   carries_pii/phi/financial: triggers mandatory CG-AG-009 Data Governance review.';

create index idx_agent_edges_source    on gov_repo.agent_edges (source_agent_id) where is_active = true;
create index idx_agent_edges_target    on gov_repo.agent_edges (target_agent_id) where is_active = true;
create index idx_agent_edges_type      on gov_repo.agent_edges (relationship_type);
create index idx_agent_edges_org       on gov_repo.agent_edges (organisation_id);
create index idx_agent_edges_pii       on gov_repo.agent_edges (carries_pii) where carries_pii = true;
create index idx_agent_edges_traversal on gov_repo.agent_edges
  (source_agent_id, target_agent_id, is_active, weight desc);

create trigger trg_agent_edges_updated_at
  before update on gov_repo.agent_edges
  for each row execute function gov_repo.set_updated_at();

alter table gov_repo.agent_edges enable row level security;
create policy "Service role has full access to agent_edges"
  on gov_repo.agent_edges for all to service_role using (true) with check (true);
create policy "Org-scoped access to agent_edges"
  on gov_repo.agent_edges for select to authenticated
  using (organisation_id = (
    select organisation_id from gov_repo.governance_users
    where email = auth.email() limit 1
  ));

-- =============================================================================
-- TABLE 3: AGENT_RESOURCE_LINKS
-- CG-AG-003|004|005|006|009
-- =============================================================================
create table gov_repo.agent_resource_links (
  link_id               uuid          primary key default uuid_generate_v4(),
  agent_id              uuid          not null references gov_repo.agents (agent_id),
  resource_type         gov_repo.resource_type not null,
  resource_ref          varchar(255)  not null,
  resource_name         varchar(255)  not null,
  resource_version      varchar(50),
  resource_provider     varchar(255),
  resource_endpoint     text,
  access_type           gov_repo.access_type not null,
  is_active             boolean       not null default true,
  requires_approval     boolean       not null default false,
  data_classification   gov_repo.classification_level not null default 'internal',
  processes_pii         boolean       not null default false,
  processes_phi         boolean       not null default false,
  processes_financial   boolean       not null default false,
  data_residency        varchar(50),
  cg_ag_004_compliant   boolean       not null default false,
  cg_ag_005_compliant   boolean       not null default false,
  cg_ag_006_compliant   boolean       not null default false,
  cg_ag_009_compliant   boolean       not null default false,
  last_reviewed_at      timestamptz,
  reviewed_by           uuid          references gov_repo.governance_users (user_id),
  next_review_date      date,
  metadata              jsonb         not null default '{}',
  organisation_id       uuid          not null references gov_repo.organisations (organisation_id),
  created_at            timestamptz   not null default now(),
  updated_at            timestamptz   not null default now(),
  constraint agent_resource_links_unique unique (agent_id, resource_type, resource_ref)
);

comment on table gov_repo.agent_resource_links is
  'Links agents to all external resources: MCP, tools, models, prompts, databases.
   CG-AG-003|004|005|006|009.
   processes_pii/phi/financial: triggers enhanced governance and DPIA requirements.
   resource_provider links to gov_repo.third_party_providers (Migration 006).';

create index idx_agent_resource_agent  on gov_repo.agent_resource_links (agent_id);
create index idx_agent_resource_type   on gov_repo.agent_resource_links (resource_type);
create index idx_agent_resource_org    on gov_repo.agent_resource_links (organisation_id);
create index idx_agent_resource_pii    on gov_repo.agent_resource_links (processes_pii) where processes_pii = true;
create index idx_agent_resource_mcp    on gov_repo.agent_resource_links (resource_type)
  where resource_type = 'mcp_server' and is_active = true;

create trigger trg_agent_resource_links_updated_at
  before update on gov_repo.agent_resource_links
  for each row execute function gov_repo.set_updated_at();

alter table gov_repo.agent_resource_links enable row level security;
create policy "Service role has full access to agent_resource_links"
  on gov_repo.agent_resource_links for all to service_role using (true) with check (true);
create policy "Org-scoped access to agent_resource_links"
  on gov_repo.agent_resource_links for select to authenticated
  using (organisation_id = (
    select organisation_id from gov_repo.governance_users
    where email = auth.email() limit 1
  ));

-- =============================================================================
-- TABLE 4: AGENT_RISK_PROPAGATION (Risk Propagation Engine)
-- CG-AG-010 | CG-AG-012
--
-- [FIX-1] criticality: GENERATED ALWAYS AS with cast to a custom ENUM type is NOT
--         supported in PostgreSQL (ERROR: generation expression must be immutable /
--         cannot cast to user-defined enum in stored generated column).
--         Solution: plain column + trigger gov_repo.set_propagation_criticality().
--
-- [FIX-2] propagation_depth: array_length(arr, 1) returns NULL for an empty array,
--         which violates NOT NULL. Wrapped with coalesce(..., 0).
-- =============================================================================
create table gov_repo.agent_risk_propagation (
  propagation_id        uuid          primary key default uuid_generate_v4(),
  risk_source_agent_id  uuid          not null references gov_repo.agents (agent_id),
  affected_agent_id     uuid          not null references gov_repo.agents (agent_id),
  propagation_path      uuid[]        not null,

  -- [FIX-2] coalesce prevents NULL violation when propagation_path is empty
  propagation_depth     integer       not null generated always as
                          (coalesce(array_length(propagation_path, 1), 0)) stored,

  propagation_type      gov_repo.propagation_type not null default 'direct',
  impact_score          numeric(5,4)  not null check (impact_score between 0 and 1),

  -- [FIX-1] criticality is a plain column maintained by trigger below.
  --         PostgreSQL does not allow CAST to a custom ENUM inside a stored
  --         generated column expression (it is not immutable at the catalog level).
  criticality           gov_repo.agent_risk_level not null default 'low',

  financial_impact_eur  bigint,
  processes_impacted    text[],
  agents_in_chain       integer       not null default 1,
  risk_id               uuid          references gov_repo.risk_entries (risk_id),
  is_active             boolean       not null default true,
  invalidated_reason    text,
  computed_at           timestamptz   not null default now(),
  expires_at            timestamptz,
  organisation_id       uuid          not null references gov_repo.organisations (organisation_id),
  constraint propagation_unique unique (risk_source_agent_id, affected_agent_id),
  constraint propagation_no_self check (risk_source_agent_id <> affected_agent_id)
);

-- [FIX-1] Trigger to keep criticality in sync with impact_score
create or replace function gov_repo.set_propagation_criticality()
returns trigger language plpgsql as $$
begin
  new.criticality := case
    when new.impact_score >= 0.75 then 'critical'::gov_repo.agent_risk_level
    when new.impact_score >= 0.50 then 'high'::gov_repo.agent_risk_level
    when new.impact_score >= 0.25 then 'medium'::gov_repo.agent_risk_level
    else                               'low'::gov_repo.agent_risk_level
  end;
  return new;
end;
$$;

create trigger trg_propagation_criticality
  before insert or update of impact_score on gov_repo.agent_risk_propagation
  for each row execute function gov_repo.set_propagation_criticality();

comment on table gov_repo.agent_risk_propagation is
  'Pre-computed risk propagation paths across the agent graph.
   Answers: "If FinanceAgent fails, which agents are impacted and at what cost?"
   impact_score = source_risk_score × product of edge weights along path.
   criticality is auto-derived by trigger trg_propagation_criticality [FIX-1].
   financial_impact_eur enables CFO/CISO Risk Officer Lens.
   Recomputed by gov_repo.recompute_risk_propagation() on graph changes.';

create index idx_risk_prop_source      on gov_repo.agent_risk_propagation (risk_source_agent_id);
create index idx_risk_prop_affected    on gov_repo.agent_risk_propagation (affected_agent_id);
create index idx_risk_prop_criticality on gov_repo.agent_risk_propagation (criticality) where is_active = true;
create index idx_risk_prop_org         on gov_repo.agent_risk_propagation (organisation_id);
create index idx_risk_prop_score       on gov_repo.agent_risk_propagation (impact_score desc) where is_active = true;
create index idx_risk_prop_path        on gov_repo.agent_risk_propagation using gin (propagation_path);

alter table gov_repo.agent_risk_propagation enable row level security;
create policy "Service role has full access to agent_risk_propagation"
  on gov_repo.agent_risk_propagation for all to service_role using (true) with check (true);
create policy "Org-scoped access to agent_risk_propagation"
  on gov_repo.agent_risk_propagation for select to authenticated
  using (organisation_id = (
    select organisation_id from gov_repo.governance_users
    where email = auth.email() limit 1
  ));

-- =============================================================================
-- TABLE 5: AGENT_EMBEDDINGS (pgvector — Talk-to-Governance)
-- [C1] vector(1536) + embedding_dimensions column
--      Supports: OpenAI ada-002 (1536), text-embedding-3-small (1536),
--                Nomic/MiniLM (768), Mistral (1024), all zero-padded to 1536
-- [C3] Deferrable unique constraint → partial unique index (cleaner, faster)
-- =============================================================================
create table gov_repo.agent_embeddings (
  embedding_id          uuid          primary key default uuid_generate_v4(),
  agent_id              uuid          not null references gov_repo.agents (agent_id)
                          on delete cascade,

  -- [C1] vector(1536): pgvector HNSW index hard limit = 2000 dims.
  --   vector(3072) exceeds this limit and breaks HNSW creation.
  --   1536 covers all relevant models for regulated-sector deployments:
  --     OpenAI text-embedding-3-small : 1536 dims (native)
  --     OpenAI text-embedding-ada-002 : 1536 dims (native)
  --     Nomic nomic-embed-text        :  768 dims (zero-pad to 1536)
  --     Google text-embedding-004     :  768 dims (zero-pad to 1536)
  --     Mistral mistral-embed         : 1024 dims (zero-pad to 1536)
  --     Local: all-MiniLM-L6-v2      :  384 dims (zero-pad to 1536)
  --   OpenAI text-embedding-3-large (3072) exceeds HNSW limit — use IVFFlat if needed.
  embedding             vector(1536)  not null,

  -- [C1] Actual model output dimensions (application zero-pads to 1536 if smaller)
  embedding_dimensions  integer       not null default 1536
                        check (embedding_dimensions in (384, 512, 768, 1024, 1536)),

  -- What was embedded
  content_text          text          not null,
  content_hash          char(64)      not null,

  -- Model provenance (data sovereignty)
  model_name            varchar(100)  not null,
  model_version         varchar(50),
  model_is_local        boolean       not null default false,
  model_provider        varchar(100),

  -- State
  generated_at          timestamptz   not null default now(),
  is_current            boolean       not null default true,

  -- Tenant
  organisation_id       uuid          not null references gov_repo.organisations (organisation_id)
);

comment on table gov_repo.agent_embeddings is
  '[C1] Vector embeddings for AI agents. Foundation for Talk-to-Governance.
   vector(1536): pgvector HNSW max = 2000 dims. 1536 covers all banking-relevant models.
   embedding_dimensions: actual model output size. App zero-pads smaller models to 1536.
   Do NOT compare embeddings across different model_name values.
   [C3] Uniqueness on (agent_id) WHERE is_current = true via partial unique index.';

comment on column gov_repo.agent_embeddings.embedding_dimensions is
  'Actual embedding dimensions from the model. Used to compute correct similarity.
   Do NOT compare embeddings from different models directly — always filter by model_name.';

-- [C3] Partial unique index: only one CURRENT embedding per agent (cleaner than deferrable)
create unique index idx_agent_embeddings_one_current
  on gov_repo.agent_embeddings (agent_id)
  where is_current = true;

-- HNSW index for fast ANN search
create index idx_agent_embeddings_hnsw on gov_repo.agent_embeddings
  using hnsw (embedding vector_cosine_ops)
  with (m = 16, ef_construction = 64);

create index idx_agent_embeddings_agent on gov_repo.agent_embeddings (agent_id);
create index idx_agent_embeddings_org   on gov_repo.agent_embeddings (organisation_id);
create index idx_agent_embeddings_model on gov_repo.agent_embeddings (model_name, embedding_dimensions);

alter table gov_repo.agent_embeddings enable row level security;
create policy "Service role has full access to agent_embeddings"
  on gov_repo.agent_embeddings for all to service_role using (true) with check (true);
create policy "Org-scoped access to agent_embeddings"
  on gov_repo.agent_embeddings for select to authenticated
  using (organisation_id = (
    select organisation_id from gov_repo.governance_users
    where email = auth.email() limit 1
  ));

-- =============================================================================
-- GRAPH TRAVERSAL FUNCTIONS
-- =============================================================================

-- ─── FUNCTION 1: Agent Graph Traversal (Recursive CTE) ───────────────────────
create or replace function gov_repo.agent_graph_traverse(
  p_root_agent_id   uuid,
  p_max_depth       integer default 5,
  p_edge_types      gov_repo.edge_relationship[] default null,
  p_active_only     boolean default true
)
returns table (
  agent_id          uuid,
  agent_code        varchar,
  agent_name        varchar,
  agent_type        gov_repo.agent_type,
  risk_level        gov_repo.agent_risk_level,
  depth             integer,
  path              uuid[],
  path_labels       text[],
  cumulative_weight numeric,
  edge_types_used   text[]
)
language sql security definer as $$
  with recursive agent_graph as (
    select
      a.agent_id,
      a.agent_code,
      a.name                              as agent_name,
      a.agent_type,
      a.risk_level,
      0                                   as depth,
      array[a.agent_id]                   as path,
      array[a.name::text]                 as path_labels,
      1.0::numeric                        as cumulative_weight,
      array[]::text[]                     as edge_types_used
    from gov_repo.agents a
    where a.agent_id = p_root_agent_id

    union all

    select
      a.agent_id,
      a.agent_code,
      a.name,
      a.agent_type,
      a.risk_level,
      ag.depth + 1,
      ag.path || a.agent_id,
      ag.path_labels || a.name,
      round((ag.cumulative_weight * e.weight)::numeric, 6),
      ag.edge_types_used || e.relationship_type::text
    from agent_graph ag
    join gov_repo.agent_edges e
      on e.source_agent_id = ag.agent_id
      and (not p_active_only or e.is_active = true)
      and (p_edge_types is null or e.relationship_type = any(p_edge_types))
    join gov_repo.agents a
      on a.agent_id = e.target_agent_id
      and (not p_active_only or a.status = 'active')
    where
      ag.depth < p_max_depth
      and not (a.agent_id = any(ag.path))   -- cycle prevention
  )
  select * from agent_graph
  where depth > 0
  order by depth asc, cumulative_weight desc;
$$;

comment on function gov_repo.agent_graph_traverse is
  'Recursive CTE graph traversal. Finds all agents reachable from a root.
   Cycle-safe via path array membership check.
   Returns depth, full path, cumulative edge weight (critical for risk propagation).
   Example — find all supervised agents:
     SELECT * FROM gov_repo.agent_graph_traverse(id, 5, ''{SUPERVISES}'');';

-- ─── FUNCTION 2: Risk Propagation Computation ────────────────────────────────
create or replace function gov_repo.recompute_risk_propagation(
  p_organisation_id uuid,
  p_source_agent_id uuid default null
)
returns integer
language plpgsql security definer as $$
declare
  v_agent      record;
  v_traversal  record;
  v_count      integer := 0;
  v_risk_score numeric;
begin
  update gov_repo.agent_risk_propagation
  set is_active = false, invalidated_reason = 'recomputed'
  where organisation_id = p_organisation_id
    and (p_source_agent_id is null or risk_source_agent_id = p_source_agent_id);

  for v_agent in
    select agent_id, risk_level
    from gov_repo.agents
    where organisation_id = p_organisation_id
      and status = 'active'
      and (p_source_agent_id is null or agent_id = p_source_agent_id)
      and risk_level in ('critical','high','medium')
  loop
    v_risk_score := case v_agent.risk_level
      when 'critical' then 1.0
      when 'high'     then 0.75
      when 'medium'   then 0.5
      else                 0.25
    end;

    for v_traversal in
      select * from gov_repo.agent_graph_traverse(v_agent.agent_id, 10, null, true)
    loop
      insert into gov_repo.agent_risk_propagation (
        risk_source_agent_id, affected_agent_id, propagation_path,
        propagation_type, impact_score, agents_in_chain, is_active, computed_at, organisation_id
      )
      values (
        v_agent.agent_id,
        v_traversal.agent_id,
        v_traversal.path,
        case
          when v_traversal.depth = 1  then 'direct'::gov_repo.propagation_type
          when v_traversal.depth <= 3 then 'indirect'::gov_repo.propagation_type
          else                             'cascading'::gov_repo.propagation_type
        end,
        round((v_risk_score * v_traversal.cumulative_weight)::numeric, 4),
        array_length(v_traversal.path, 1),
        true,
        now(),
        p_organisation_id
      )
      on conflict (risk_source_agent_id, affected_agent_id) do update set
        propagation_path  = excluded.propagation_path,
        propagation_type  = excluded.propagation_type,
        impact_score      = excluded.impact_score,
        agents_in_chain   = excluded.agents_in_chain,
        is_active         = true,
        computed_at       = now();

      v_count := v_count + 1;
    end loop;
  end loop;

  return v_count;
end;
$$;

comment on function gov_repo.recompute_risk_propagation is
  'Recomputes the full risk propagation matrix. impact_score = risk × edge_weight_product.
   Returns count of records created/updated. Call after: agent risk change, edge add/remove.
   criticality column is auto-updated by trigger trg_propagation_criticality [FIX-1].';

-- ─── FUNCTION 3: Semantic Search ─────────────────────────────────────────────
-- [C4] Fixed: correct cosine similarity formula, filter by model for accuracy
create or replace function gov_repo.agent_semantic_search(
  p_query_embedding    vector(1536),
  p_organisation_id    uuid,
  p_model_name         varchar default null,   -- [C4] Filter by model to avoid cross-model comparison
  p_limit              integer default 10,
  p_similarity_threshold numeric default 0.70  -- [C4] lowered from 0.75 — more recall
)
returns table (
  agent_id          uuid,
  agent_code        varchar,
  agent_name        varchar,
  agent_type        gov_repo.agent_type,
  risk_level        gov_repo.agent_risk_level,
  oversight_level   gov_repo.oversight_level,
  ai_system_id      uuid,
  owner_name        varchar,
  similarity        numeric,
  content_snippet   text
)
language sql security definer as $$
  select
    a.agent_id,
    a.agent_code,
    a.name,
    a.agent_type,
    a.risk_level,
    a.oversight_level,
    a.ai_system_id,
    u.full_name                                                     as owner_name,
    -- [C4] cosine similarity = 1 - cosine distance
    round((1 - (ae.embedding <=> p_query_embedding))::numeric, 4)  as similarity,
    left(ae.content_text, 300)                                      as content_snippet
  from gov_repo.agent_embeddings ae
  join gov_repo.agents a on a.agent_id = ae.agent_id
  join gov_repo.governance_users u on u.user_id = a.owner_user_id
  where ae.organisation_id = p_organisation_id
    and ae.is_current = true
    and a.status in ('active','approved')
    -- [C4] Only compare embeddings from same model (different dims = invalid comparison)
    and (p_model_name is null or ae.model_name = p_model_name)
    and (1 - (ae.embedding <=> p_query_embedding)) >= p_similarity_threshold
  order by ae.embedding <=> p_query_embedding asc
  limit p_limit;
$$;

comment on function gov_repo.agent_semantic_search is
  '[C4] Semantic similarity search via pgvector cosine distance.
   p_model_name: STRONGLY recommended — prevents cross-model dimension mismatch.
   p_similarity_threshold: 0.70 = good match. 0.90 = very close.
   Returns ai_system_id for AI Act system-level grouping.
   Foundation for Talk-to-Governance NL interface (Migration 008).';

-- ─── FUNCTION 4: Compliance Gap Detection ────────────────────────────────────
-- [FIX-3] Boolean-expression casts to integer made explicit with CASE WHEN.
--         The pattern (bool_expr)::int is valid SQL but (compound_bool_expr)::int
--         can be ambiguous in some PG versions. CASE WHEN is unambiguous.
create or replace function gov_repo.agent_compliance_gaps(p_organisation_id uuid)
returns table (
  agent_id          uuid,
  agent_code        varchar,
  agent_name        varchar,
  risk_level        gov_repo.agent_risk_level,
  status            gov_repo.agent_status,
  ai_system_id      uuid,   -- [C2] included for system-level gap grouping
  gap_cg_ag_001     boolean,
  gap_cg_ag_002     boolean,
  gap_cg_ag_003     boolean,
  gap_cg_ag_007     boolean,
  gap_cg_ag_010     boolean,
  gap_cg_ag_012     boolean,
  gap_no_ai_system  boolean,   -- [C2] new: agent not linked to any AI System
  total_gaps        integer,
  owner_name        varchar,
  owner_email       varchar
)
language sql security definer as $$
  select
    a.agent_id,
    a.agent_code,
    a.name,
    a.risk_level,
    a.status,
    a.ai_system_id,
    not a.cg_ag_001_registered                                            as gap_cg_ag_001,
    not a.cg_ag_002_owner                                                 as gap_cg_ag_002,
    not a.cg_ag_003_model_reg                                             as gap_cg_ag_003,
    not a.cg_ag_007_oversight                                             as gap_cg_ag_007,
    not a.cg_ag_010_classified                                            as gap_cg_ag_010,
    (a.agent_type = 'autonomous' and not a.cg_ag_012_autonomous_governed) as gap_cg_ag_012,
    (a.ai_system_id is null)                                              as gap_no_ai_system,
    -- [FIX-3] explicit CASE WHEN instead of compound boolean cast to int
    (
      case when not a.cg_ag_001_registered                                            then 1 else 0 end +
      case when not a.cg_ag_002_owner                                                 then 1 else 0 end +
      case when not a.cg_ag_003_model_reg                                             then 1 else 0 end +
      case when not a.cg_ag_007_oversight                                             then 1 else 0 end +
      case when not a.cg_ag_010_classified                                            then 1 else 0 end +
      case when a.agent_type = 'autonomous' and not a.cg_ag_012_autonomous_governed   then 1 else 0 end +
      case when a.ai_system_id is null                                                then 1 else 0 end
    )                                                                     as total_gaps,
    u.full_name,
    u.email
  from gov_repo.agents a
  join gov_repo.governance_users u on u.user_id = a.owner_user_id
  where a.organisation_id = p_organisation_id
    and a.status not in ('decommissioned')
    and (
      not a.cg_ag_001_registered or
      not a.cg_ag_002_owner      or
      not a.cg_ag_003_model_reg  or
      not a.cg_ag_007_oversight  or
      not a.cg_ag_010_classified or
      (a.agent_type = 'autonomous' and not a.cg_ag_012_autonomous_governed) or
      a.ai_system_id is null
    )
  order by
    case a.risk_level when 'critical' then 1 when 'high' then 2 when 'medium' then 3 else 4 end,
    total_gaps desc;
$$;

comment on function gov_repo.agent_compliance_gaps is
  'CG-AGF compliance gap detector. Returns one row per non-compliant agent.
   [C2] gap_no_ai_system: agent not linked to an AI System (AI Act gap).
   [FIX-3] total_gaps uses explicit CASE WHEN for PostgreSQL version compatibility.
   Sorted by risk level then total gaps. Answer: "Which agents need governance attention?"';

-- =============================================================================
-- VIEWS — Role Lenses
-- =============================================================================

-- CISO Lens
create or replace view gov_repo.v_ciso_agent_risk_lens as
select
  a.organisation_id,
  a.agent_id,
  a.agent_code,
  a.name                                as agent_name,
  a.agent_type,
  a.risk_level,
  a.ai_act_risk_class,
  a.oversight_level,
  a.status,
  a.deployment_env,
  a.model_is_local,
  a.ai_system_id,                       -- [C2] AI System grouping
  u.full_name                           as owner_name,
  u.email                               as owner_email,
  not a.cg_ag_001_registered            as gap_inventory,
  not a.cg_ag_002_owner                 as gap_owner,
  not a.cg_ag_007_oversight             as gap_oversight,
  not a.cg_ag_010_classified            as gap_risk_class,
  (a.ai_system_id is null)              as gap_no_ai_system,  -- [C2]
  (select count(*) from gov_repo.agent_edges e
   where e.source_agent_id = a.agent_id and e.is_active = true)  as outbound_edges,
  (select count(*) from gov_repo.agent_edges e
   where e.target_agent_id = a.agent_id and e.is_active = true)  as inbound_edges,
  (select count(*) from gov_repo.agent_resource_links rl
   where rl.agent_id = a.agent_id and rl.processes_pii = true and rl.is_active = true)
                                        as pii_resource_count,
  (select count(*) from gov_repo.agent_risk_propagation rp
   where rp.risk_source_agent_id = a.agent_id and rp.is_active = true)
                                        as agents_it_can_impact,
  (select coalesce(sum(rp.financial_impact_eur), 0)
   from gov_repo.agent_risk_propagation rp
   where rp.risk_source_agent_id = a.agent_id and rp.is_active = true)
                                        as total_financial_exposure_eur,
  (select count(*) from gov_repo.exceptions ex
   where ex.agent_id = a.agent_id and ex.status = 'active')
                                        as active_exceptions
from gov_repo.agents a
join gov_repo.governance_users u on u.user_id = a.owner_user_id
where a.status not in ('decommissioned')
  and a.risk_level in ('critical','high');

comment on view gov_repo.v_ciso_agent_risk_lens is
  'CISO lens: critical/high risk agents with compliance gaps, PII exposure, financial risk.
   [C2] gap_no_ai_system: agents not linked to AI Systems (AI Act gap).';

-- Risk Officer / CFO Lens
create or replace view gov_repo.v_risk_propagation_chains as
select
  rp.organisation_id,
  rp.propagation_id,
  src.agent_code                        as source_agent_code,
  src.name                              as source_agent_name,
  src.risk_level                        as source_risk_level,
  src.ai_system_id                      as source_ai_system_id,  -- [C2]
  aff.agent_code                        as affected_agent_code,
  aff.name                              as affected_agent_name,
  aff.risk_level                        as affected_risk_level,
  rp.propagation_depth,
  rp.propagation_type,
  rp.impact_score,
  rp.criticality,
  rp.financial_impact_eur,
  rp.propagation_path,
  rp.processes_impacted,
  rp.computed_at,
  u.full_name                           as affected_owner_name
from gov_repo.agent_risk_propagation rp
join gov_repo.agents src on src.agent_id = rp.risk_source_agent_id
join gov_repo.agents aff on aff.agent_id = rp.affected_agent_id
join gov_repo.governance_users u on u.user_id = aff.owner_user_id
where rp.is_active = true
  and rp.criticality in ('critical','high')
order by rp.impact_score desc;

-- MCP Governance Lens (CG-AG-006)
create or replace view gov_repo.v_mcp_governance_lens as
select
  rl.organisation_id,
  a.agent_code,
  a.name                                as agent_name,
  a.risk_level,
  a.status                              as agent_status,
  rl.resource_name                      as mcp_name,
  rl.resource_ref                       as mcp_ref,
  rl.resource_provider                  as mcp_provider,
  rl.access_type,
  rl.data_classification,
  rl.processes_pii,
  rl.processes_phi,
  rl.processes_financial,
  rl.data_residency,
  rl.cg_ag_006_compliant,
  rl.cg_ag_009_compliant,
  rl.last_reviewed_at,
  rl.next_review_date,
  rl.next_review_date < current_date    as review_overdue,
  u.full_name                           as agent_owner
from gov_repo.agent_resource_links rl
join gov_repo.agents a on a.agent_id = rl.agent_id
join gov_repo.governance_users u on u.user_id = a.owner_user_id
where rl.resource_type = 'mcp_server'
  and rl.is_active = true
  and a.status not in ('decommissioned');

-- Orphan Agents (no owner — biggest governance gap)
create or replace view gov_repo.v_orphan_agents as
select
  a.organisation_id,
  a.agent_id,
  a.agent_code,
  a.name,
  a.agent_type,
  a.risk_level,
  a.status,
  a.ai_system_id,                       -- [C2]
  (a.ai_system_id is null)              as missing_ai_system,
  a.created_at,
  now() - a.created_at                  as age_without_owner
from gov_repo.agents a
where a.cg_ag_002_owner = false
  and a.status not in ('decommissioned')
order by
  case a.risk_level when 'critical' then 1 when 'high' then 2 else 3 end,
  a.created_at asc;

-- [C2] NEW: Agents not linked to any AI System (AI Act gap)
create or replace view gov_repo.v_agents_without_ai_system as
select
  a.organisation_id,
  a.agent_id,
  a.agent_code,
  a.name,
  a.agent_type,
  a.risk_level,
  a.ai_act_risk_class,
  a.status,
  u.full_name                           as owner_name,
  u.email                               as owner_email,
  a.created_at
from gov_repo.agents a
join gov_repo.governance_users u on u.user_id = a.owner_user_id
where a.ai_system_id is null
  and a.status not in ('decommissioned')
order by
  case a.risk_level when 'critical' then 1 when 'high' then 2 else 3 end,
  a.created_at asc;

comment on view gov_repo.v_agents_without_ai_system is
  '[C2] AI Act compliance gap: agents not associated with an AI System.
   EU AI Act regulates at AI System level (Art. 3.1), not individual agent level.
   All agents must be linked to an ai_system_id before passing conformity assessment.
   FK will be enforced in Migration 006 when gov_repo.ai_systems is created.';

-- =============================================================================
-- GRANTS
-- =============================================================================
grant execute on function gov_repo.agent_graph_traverse          to service_role, authenticated;
grant execute on function gov_repo.recompute_risk_propagation    to service_role;
grant execute on function gov_repo.agent_semantic_search         to service_role, authenticated;
grant execute on function gov_repo.agent_compliance_gaps         to service_role, authenticated;
grant execute on function gov_repo.update_agent_compliance_flags to service_role;
grant execute on function gov_repo.set_propagation_criticality   to service_role;
