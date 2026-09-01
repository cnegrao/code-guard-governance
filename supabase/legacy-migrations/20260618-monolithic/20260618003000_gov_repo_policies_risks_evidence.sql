-- =============================================================================
-- CODEGUARD AI GOVERNANCE OS
-- Migration: 20260618003000_gov_repo_policies_risks_evidence
-- Domain:    Governance Repository — Policy, Risk Register & Evidence
-- Depends:   20260618002000_gov_repo_identity_and_ledger
-- =============================================================================

-- ─── REGULATORY MANDATES ─────────────────────────────────────────────────────
-- Pre-loaded regulatory requirement catalogue mapped to CG-AGF controls.
create table gov_repo.mandates (
  mandate_id          uuid          primary key default uuid_generate_v4(),
  mandate_code        varchar(50)   not null,
  regulation          varchar(100)  not null,   -- EU_AI_ACT|DORA|ISO_42001|NIST_AI_RMF|GDPR|NIS2
  section_ref         varchar(100)  not null,   -- Article / clause reference
  title               varchar(255)  not null,
  requirement_text    text          not null,   -- Verbatim regulatory text
  requirement_type    gov_repo.mandate_type not null default 'mandatory',
  effective_date      date          not null,
  applicability       jsonb         not null default '{}',
  mapped_controls     varchar(12)[] not null default '{}',  -- CG-AG-001..012
  mapped_policies     uuid[]        not null default '{}',
  organisation_id     uuid          references gov_repo.organisations (organisation_id),
  compliance_status   gov_repo.compliance_status not null default 'not_assessed',
  last_assessed       date,
  created_at          timestamptz   not null default now(),
  constraint mandates_code_unique unique (mandate_code)
);

comment on table gov_repo.mandates is
  'Regulatory mandate catalogue. Maps regulation articles to CG-AGF controls and internal policies.
   NULL organisation_id = system-wide mandate applicable to all tenants.';
comment on column gov_repo.mandates.mapped_controls is
  'CG-AGF control references (CG-AG-001 through CG-AG-012) that satisfy this mandate.';

-- Seed: core regulatory mandates
insert into gov_repo.mandates
  (mandate_code, regulation, section_ref, title, requirement_text, mapped_controls, effective_date)
values
  ('EU-AI-ACT-ART-9',  'EU_AI_ACT', 'Article 9',
   'Risk Management System',
   'High-risk AI systems shall have a risk management system established, implemented, documented and maintained throughout the entire lifecycle.',
   array['CG-AG-010','CG-AG-012'], '2025-08-01'),

  ('EU-AI-ACT-ART-10', 'EU_AI_ACT', 'Article 10',
   'Data and Data Governance',
   'High-risk AI systems which make use of techniques involving the training of models with data shall be developed on the basis of training, validation and testing data sets that meet quality criteria.',
   array['CG-AG-003','CG-AG-009'], '2025-08-01'),

  ('EU-AI-ACT-ART-11', 'EU_AI_ACT', 'Article 11 + Annex IV',
   'Technical Documentation',
   'Providers of high-risk AI systems shall draw up technical documentation before that system is placed on the market or put into service.',
   array['CG-AG-001','CG-AG-003'], '2025-08-01'),

  ('EU-AI-ACT-ART-12', 'EU_AI_ACT', 'Article 12',
   'Record Keeping / Automatic Logging',
   'High-risk AI systems shall technically allow for the automatic recording of events throughout the lifetime of the system.',
   array['CG-AG-008'], '2025-08-01'),

  ('EU-AI-ACT-ART-13', 'EU_AI_ACT', 'Article 13',
   'Transparency and Provision of Information',
   'High-risk AI systems shall be designed and developed in such a way as to ensure that their operation is sufficiently transparent to enable deployers to interpret the system''s output.',
   array['CG-AG-007'], '2025-08-01'),

  ('EU-AI-ACT-ART-14', 'EU_AI_ACT', 'Article 14',
   'Human Oversight',
   'High-risk AI systems shall be designed and developed with human oversight measures, including the ability to interrupt, override or stop the system.',
   array['CG-AG-007'], '2025-08-01'),

  ('EU-AI-ACT-ART-15', 'EU_AI_ACT', 'Article 15',
   'Accuracy, Robustness and Cybersecurity',
   'High-risk AI systems shall be designed and developed in such a way that they achieve, in the light of their intended purpose, an appropriate level of accuracy, robustness, and cybersecurity.',
   array['CG-AG-003','CG-AG-005'], '2025-08-01'),

  ('DORA-ART-5', 'DORA', 'Article 5',
   'ICT Risk Management Framework',
   'Financial entities shall have in place a comprehensive, documented and annually reviewed ICT risk management framework.',
   array['CG-AG-001','CG-AG-002','CG-AG-010'], '2025-01-17'),

  ('DORA-ART-8', 'DORA', 'Article 8',
   'ICT Asset Management',
   'Financial entities shall identify and classify ICT assets, including AI systems and models, based on their criticality.',
   array['CG-AG-001','CG-AG-003','CG-AG-010'], '2025-01-17'),

  ('DORA-ART-9', 'DORA', 'Article 9',
   'ICT Security Policies',
   'Financial entities shall develop, document and implement an information security policy addressing access control, cryptography, supply chain risk and audit logging.',
   array['CG-AG-004','CG-AG-005','CG-AG-006','CG-AG-009'], '2025-01-17'),

  ('DORA-ART-10', 'DORA', 'Article 10',
   'ICT Logging and Monitoring',
   'Financial entities shall have logging and monitoring processes in place to enable detection of anomalous activities and ICT-related incidents.',
   array['CG-AG-008'], '2025-01-17'),

  ('DORA-ART-28', 'DORA', 'Article 28',
   'ICT Third-Party Risk Management',
   'Financial entities shall manage ICT third-party risk including AI model providers, MCP servers and cloud services.',
   array['CG-AG-003','CG-AG-006'], '2025-01-17'),

  ('ISO42001-6-1', 'ISO_42001', '§6.1',
   'Actions to Address Risks and Opportunities',
   'The organisation shall determine risks and opportunities related to its AI systems and plan actions to address them.',
   array['CG-AG-010'], '2023-12-01'),

  ('ISO42001-8-4', 'ISO_42001', '§8.4',
   'AI System Impact Assessment',
   'The organisation shall carry out AI system impact assessments throughout the AI system lifecycle.',
   array['CG-AG-010','CG-AG-003'], '2023-12-01'),

  ('NIST-GOVERN-1-2', 'NIST_AI_RMF', 'GOVERN 1.2',
   'Accountability Structures',
   'Accountability structures are in place so that appropriate teams and individuals are empowered, responsible, and trained for mapping, measuring, and managing AI risks.',
   array['CG-AG-002','CG-AG-007'], '2023-01-26'),

  ('NIST-MAP-1-5', 'NIST_AI_RMF', 'MAP 1.5',
   'AI System Context',
   'Organisational risk tolerances are determined and documented. AI system context is established and understood.',
   array['CG-AG-001','CG-AG-010'], '2023-01-26'),

  ('GDPR-ART-22', 'GDPR', 'Article 22',
   'Automated Individual Decision-Making',
   'Data subjects shall have the right not to be subject to a decision based solely on automated processing, including profiling, which produces legal or similarly significant effects.',
   array['CG-AG-007','CG-AG-012'], '2018-05-25'),

  ('GDPR-ART-35', 'GDPR', 'Article 35',
   'Data Protection Impact Assessment',
   'Where processing is likely to result in a high risk to the rights and freedoms of natural persons, the controller shall carry out an assessment of the impact of the envisaged processing operations.',
   array['CG-AG-009'], '2018-05-25');

alter table gov_repo.mandates enable row level security;
create policy "Service role has full access to mandates"
  on gov_repo.mandates for all to service_role using (true) with check (true);
create policy "Authenticated users can read mandates"
  on gov_repo.mandates for select to authenticated using (true);

-- ─── GOVERNANCE POLICIES ─────────────────────────────────────────────────────
create table gov_repo.governance_policies (
  policy_id           uuid          primary key default uuid_generate_v4(),
  policy_code         varchar(20)   not null,
  title               varchar(255)  not null,
  description         text,
  policy_type         gov_repo.policy_type not null,
  status              gov_repo.policy_status not null default 'draft',
  effective_date      date,
  expiry_date         date,
  owner_user_id       uuid          not null references gov_repo.governance_users (user_id),
  approver_user_id    uuid          references gov_repo.governance_users (user_id),
  organisation_id     uuid          not null references gov_repo.organisations (organisation_id),
  parent_policy_id    uuid          references gov_repo.governance_policies (policy_id),
  current_version_id  uuid,                         -- FK added after policy_versions created
  created_at          timestamptz   not null default now(),
  updated_at          timestamptz   not null default now(),
  created_by          uuid          not null references gov_repo.governance_users (user_id),
  constraint governance_policies_code_org_unique unique (policy_code, organisation_id),
  constraint policy_expiry_after_effective check (
    expiry_date is null or expiry_date > effective_date
  )
);

comment on table gov_repo.governance_policies is
  'AI governance policy master record. Content lives in policy_versions (versioned, immutable).';
comment on column gov_repo.governance_policies.current_version_id is
  'Points to the currently active approved version. NULL until first version is approved.';
comment on column gov_repo.governance_policies.parent_policy_id is
  'For hierarchical policies (e.g. sub-policy of an overarching AI Governance Policy).';

create index idx_gov_policies_org    on gov_repo.governance_policies (organisation_id);
create index idx_gov_policies_status on gov_repo.governance_policies (status);
create index idx_gov_policies_owner  on gov_repo.governance_policies (owner_user_id);

create trigger trg_governance_policies_updated_at
  before update on gov_repo.governance_policies
  for each row execute function gov_repo.set_updated_at();

alter table gov_repo.governance_policies enable row level security;
create policy "Service role has full access to governance_policies"
  on gov_repo.governance_policies for all to service_role using (true) with check (true);
create policy "Org-scoped access to governance_policies"
  on gov_repo.governance_policies for select to authenticated
  using (organisation_id = (
    select organisation_id from gov_repo.governance_users
    where email = auth.email() limit 1
  ));

-- Policy versions (immutable content snapshots)
create table gov_repo.policy_versions (
  version_id          uuid          primary key default uuid_generate_v4(),
  policy_id           uuid          not null references gov_repo.governance_policies (policy_id) on delete cascade,
  version_number      integer       not null,
  version_label       varchar(20)   not null,             -- e.g. "1.0", "2.3"
  content_markdown    text          not null,
  content_hash        char(64)      not null,             -- SHA-256(content_markdown)
  change_summary      text          not null,
  status              gov_repo.version_status not null default 'draft',
  reviewed_by         uuid          references gov_repo.governance_users (user_id),
  approved_by         uuid          references gov_repo.governance_users (user_id),
  approval_date       timestamptz,
  qes_signature_id    uuid          references gov_repo.qes_signatures (signature_id),
  ledger_entry_seq    bigint        references gov_repo.governance_ledger (entry_sequence),
  created_at          timestamptz   not null default now(),
  created_by          uuid          not null references gov_repo.governance_users (user_id),
  constraint policy_versions_unique unique (policy_id, version_number),
  constraint policy_version_approval_consistent check (
    (approved_by is null) = (approval_date is null)
  )
);

comment on table gov_repo.policy_versions is
  'Immutable versioned snapshots of policy content. Once approved, content cannot change.
   A new version must be created for any content modification.';
comment on column gov_repo.policy_versions.content_hash is
  'SHA-256 of content_markdown. Used for QES subject_hash binding and integrity checks.';

create index idx_policy_versions_policy  on gov_repo.policy_versions (policy_id, version_number);
create index idx_policy_versions_status  on gov_repo.policy_versions (status);

-- Now add the deferred FK from governance_policies to policy_versions
alter table gov_repo.governance_policies
  add constraint fk_current_version
  foreign key (current_version_id)
  references gov_repo.policy_versions (version_id)
  deferrable initially deferred;

alter table gov_repo.policy_versions enable row level security;
create policy "Service role has full access to policy_versions"
  on gov_repo.policy_versions for all to service_role using (true) with check (true);
create policy "Org-scoped access to policy_versions"
  on gov_repo.policy_versions for select to authenticated
  using (policy_id in (
    select policy_id from gov_repo.governance_policies
    where organisation_id = (
      select organisation_id from gov_repo.governance_users
      where email = auth.email() limit 1
    )
  ));

-- Policy ↔ Mandate mappings
create table gov_repo.policy_mandate_mappings (
  mapping_id          uuid          primary key default uuid_generate_v4(),
  policy_id           uuid          not null references gov_repo.governance_policies (policy_id) on delete cascade,
  mandate_id          uuid          not null references gov_repo.mandates (mandate_id),
  coverage_level      varchar(20)   not null default 'partial',  -- full|partial|none
  notes               text,
  created_at          timestamptz   not null default now(),
  constraint policy_mandate_unique unique (policy_id, mandate_id)
);

alter table gov_repo.policy_mandate_mappings enable row level security;
create policy "Service role has full access to policy_mandate_mappings"
  on gov_repo.policy_mandate_mappings for all to service_role using (true) with check (true);
create policy "Authenticated can read policy_mandate_mappings"
  on gov_repo.policy_mandate_mappings for select to authenticated using (true);

-- ─── RISK REGISTER ───────────────────────────────────────────────────────────
create table gov_repo.risk_entries (
  risk_id             uuid          primary key default uuid_generate_v4(),
  risk_code           varchar(20)   not null,
  title               varchar(255)  not null,
  description         text          not null,
  risk_category       gov_repo.risk_category not null,
  risk_domain         varchar(50)   not null,   -- ai_model|agent_autonomy|data_privacy|etc.
  -- Scoring (1-5 scales)
  likelihood          smallint      not null check (likelihood between 1 and 5),
  impact              smallint      not null check (impact between 1 and 5),
  inherent_risk_score integer       generated always as (likelihood * impact) stored,
  residual_risk_score integer       check (residual_risk_score between 1 and 25),
  risk_appetite       varchar(20)   not null default 'tolerable'
                      check (risk_appetite in ('acceptable','tolerable','unacceptable')),
  status              gov_repo.risk_status not null default 'identified',
  -- Ownership
  owner_user_id       uuid          not null references gov_repo.governance_users (user_id),
  reviewer_user_id    uuid          references gov_repo.governance_users (user_id),
  -- AI/regulatory cross-references
  related_agent_ids   uuid[]        not null default '{}',
  related_control_ids varchar(12)[] not null default '{}',   -- CG-AG-001..012
  ai_act_annex_ref    varchar(100),                           -- e.g. 'Annex III, point 5(b)'
  dora_chapter_ref    varchar(100),                           -- e.g. 'Art. 9'
  -- Dates
  first_identified    date          not null default current_date,
  last_reviewed_date  date,
  next_review_date    date,
  -- Tenant
  organisation_id     uuid          not null references gov_repo.organisations (organisation_id),
  -- Audit
  created_at          timestamptz   not null default now(),
  updated_at          timestamptz   not null default now(),
  ledger_entry_seq    bigint        references gov_repo.governance_ledger (entry_sequence),
  constraint risk_entries_code_org_unique unique (risk_code, organisation_id)
);

comment on table gov_repo.risk_entries is
  'AI governance risk register. Every risk is linked to CG-AGF controls, agents, and evidence.
   inherent_risk_score = likelihood × impact (computed). Max = 25 (5×5).';
comment on column gov_repo.risk_entries.related_control_ids is
  'CG-AGF control IDs (e.g. CG-AG-007) associated with this risk.';

create index idx_risk_entries_org      on gov_repo.risk_entries (organisation_id);
create index idx_risk_entries_status   on gov_repo.risk_entries (status);
create index idx_risk_entries_score    on gov_repo.risk_entries (inherent_risk_score desc);
create index idx_risk_entries_agents   on gov_repo.risk_entries using gin (related_agent_ids);
create index idx_risk_entries_controls on gov_repo.risk_entries using gin (related_control_ids);
create index idx_risk_entries_owner    on gov_repo.risk_entries (owner_user_id);

create trigger trg_risk_entries_updated_at
  before update on gov_repo.risk_entries
  for each row execute function gov_repo.set_updated_at();

alter table gov_repo.risk_entries enable row level security;
create policy "Service role has full access to risk_entries"
  on gov_repo.risk_entries for all to service_role using (true) with check (true);
create policy "Org-scoped access to risk_entries"
  on gov_repo.risk_entries for select to authenticated
  using (organisation_id = (
    select organisation_id from gov_repo.governance_users
    where email = auth.email() limit 1
  ));

-- Risk treatments (how each risk is addressed)
create table gov_repo.risk_treatments (
  treatment_id        uuid          primary key default uuid_generate_v4(),
  risk_id             uuid          not null references gov_repo.risk_entries (risk_id) on delete cascade,
  treatment_type      gov_repo.risk_treatment_type not null,
  treatment_plan      text          not null,
  controls_applied    varchar(12)[] not null default '{}',
  target_residual     integer       check (target_residual between 1 and 25),
  due_date            date          not null,
  responsible_id      uuid          not null references gov_repo.governance_users (user_id),
  status              varchar(30)   not null default 'planned'
                      check (status in ('planned','in_progress','implemented','verified','failed')),
  implementation_evidence uuid[]    default '{}',
  approved_by         uuid          references gov_repo.governance_users (user_id),
  approval_date       timestamptz,
  qes_signature_id    uuid          references gov_repo.qes_signatures (signature_id),
  created_at          timestamptz   not null default now(),
  updated_at          timestamptz   not null default now()
);

create index idx_risk_treatments_risk   on gov_repo.risk_treatments (risk_id);
create index idx_risk_treatments_status on gov_repo.risk_treatments (status);

create trigger trg_risk_treatments_updated_at
  before update on gov_repo.risk_treatments
  for each row execute function gov_repo.set_updated_at();

alter table gov_repo.risk_treatments enable row level security;
create policy "Service role has full access to risk_treatments"
  on gov_repo.risk_treatments for all to service_role using (true) with check (true);
create policy "Org-scoped access to risk_treatments via risk"
  on gov_repo.risk_treatments for select to authenticated
  using (risk_id in (
    select risk_id from gov_repo.risk_entries
    where organisation_id = (
      select organisation_id from gov_repo.governance_users
      where email = auth.email() limit 1
    )
  ));

-- ─── EVIDENCE REPOSITORY ─────────────────────────────────────────────────────
create table gov_repo.evidence (
  evidence_id         uuid          primary key default uuid_generate_v4(),
  evidence_code       varchar(20)   not null,
  title               varchar(255)  not null,
  description         text,
  evidence_type       gov_repo.evidence_type not null,
  collection_method   gov_repo.collection_method not null default 'manual_upload',
  status              gov_repo.evidence_status not null default 'draft',
  -- Collection
  collected_by        uuid          not null references gov_repo.governance_users (user_id),
  collected_at        timestamptz   not null default now(),
  -- Verification
  verified_by         uuid          references gov_repo.governance_users (user_id),
  verified_at         timestamptz,
  verification_method gov_repo.verification_method,
  -- Integrity
  content_hash        char(64),     -- SHA-256 of primary file content
  -- Retention (DORA / AI Act / GDPR)
  retention_class     gov_repo.retention_class not null default 'regulatory_5y',
  retention_until     date,         -- Computed by trigger
  -- Access control
  is_confidential     boolean       not null default false,
  classification      gov_repo.classification_level not null default 'internal',
  -- Cross-references
  organisation_id     uuid          not null references gov_repo.organisations (organisation_id),
  control_refs        varchar(12)[] not null default '{}',   -- CG-AG-001..012
  agent_refs          uuid[]        not null default '{}',
  risk_refs           uuid[]        not null default '{}',
  -- Chain of custody (immutable JSON array of transfer records)
  chain_of_custody    jsonb         not null default '[]',
  -- Audit
  ledger_entry_seq    bigint        references gov_repo.governance_ledger (entry_sequence),
  created_at          timestamptz   not null default now(),
  updated_at          timestamptz   not null default now(),
  constraint evidence_code_org_unique unique (evidence_code, organisation_id),
  constraint evidence_verification_consistent check (
    (verified_by is null and verified_at is null) or
    (verified_by is not null and verified_at is not null)
  )
);

comment on table gov_repo.evidence is
  'Governance evidence repository. Every piece of evidence is collected, verified, linked
   and retained per regulatory schedule. Chain of custody is append-only JSON.
   Retention periods: standard_3y=3yr | regulatory_5y=5yr | dora_5y=5yr |
                      aiact_10y=10yr | legal_hold=indefinite.';
comment on column gov_repo.evidence.chain_of_custody is
  'Append-only JSON array. Schema per record:
   {custody_id, transferred_at, from_user_id, to_user_id, transfer_reason, record_hash}';

-- Auto-compute retention_until from retention_class
create or replace function gov_repo.compute_retention_until()
returns trigger
language plpgsql as $$
begin
  new.retention_until := case new.retention_class
    when 'standard_3y'   then (new.collected_at::date + interval '3 years')::date
    when 'regulatory_5y' then (new.collected_at::date + interval '5 years')::date
    when 'dora_5y'       then (new.collected_at::date + interval '5 years')::date
    when 'aiact_10y'     then (new.collected_at::date + interval '10 years')::date
    when 'legal_hold'    then '9999-12-31'::date
    else                      (new.collected_at::date + interval '5 years')::date
  end;
  return new;
end;
$$;

create trigger trg_evidence_retention
  before insert on gov_repo.evidence
  for each row execute function gov_repo.compute_retention_until();

create trigger trg_evidence_updated_at
  before update on gov_repo.evidence
  for each row execute function gov_repo.set_updated_at();

create index idx_evidence_org        on gov_repo.evidence (organisation_id);
create index idx_evidence_status     on gov_repo.evidence (status);
create index idx_evidence_controls   on gov_repo.evidence using gin (control_refs);
create index idx_evidence_agents     on gov_repo.evidence using gin (agent_refs);
create index idx_evidence_risks      on gov_repo.evidence using gin (risk_refs);
create index idx_evidence_retention  on gov_repo.evidence (retention_until)
  where status not in ('expired','superseded','rejected');
create index idx_evidence_collector  on gov_repo.evidence (collected_by);

alter table gov_repo.evidence enable row level security;
create policy "Service role has full access to evidence"
  on gov_repo.evidence for all to service_role using (true) with check (true);
create policy "Org-scoped access to evidence"
  on gov_repo.evidence for select to authenticated
  using (organisation_id = (
    select organisation_id from gov_repo.governance_users
    where email = auth.email() limit 1
  ));
-- Regulator cannot see restricted evidence
create policy "Regulator cannot read restricted evidence"
  on gov_repo.evidence for select to authenticated
  using (classification <> 'restricted');

-- Evidence physical files
create table gov_repo.evidence_files (
  file_id             uuid          primary key default uuid_generate_v4(),
  evidence_id         uuid          not null references gov_repo.evidence (evidence_id) on delete cascade,
  filename            varchar(500)  not null,
  mime_type           varchar(100)  not null,
  file_size_bytes     bigint        not null,
  storage_path        text          not null,    -- Encrypted path in object store (NOT a URL)
  content_hash        char(64)      not null,    -- SHA-256 of file content
  encryption_key_ref  varchar(255)  not null,    -- HSM/KMS key reference
  uploaded_by         uuid          not null references gov_repo.governance_users (user_id),
  uploaded_at         timestamptz   not null default now(),
  is_primary          boolean       not null default false,
  virus_scan_status   varchar(20)   not null default 'pending'
                      check (virus_scan_status in ('pending','clean','quarantined')),
  virus_scan_at       timestamptz
);

comment on table gov_repo.evidence_files is
  'Physical files attached to evidence records. Stored encrypted in object storage.
   Files are NEVER deleted — only marked expired/superseded via parent evidence record.';
comment on column gov_repo.evidence_files.storage_path is
  'Opaque encrypted storage path. NOT a public URL. Access via signed URL API only.';
comment on column gov_repo.evidence_files.encryption_key_ref is
  'Reference to encryption key in on-premises HSM (FIPS 140-2 Level 3).';

create index idx_evidence_files_evidence on gov_repo.evidence_files (evidence_id);
create index idx_evidence_files_primary  on gov_repo.evidence_files (evidence_id, is_primary)
  where is_primary = true;

alter table gov_repo.evidence_files enable row level security;
create policy "Service role has full access to evidence_files"
  on gov_repo.evidence_files for all to service_role using (true) with check (true);
create policy "Org-scoped access to evidence_files via parent evidence"
  on gov_repo.evidence_files for select to authenticated
  using (evidence_id in (
    select evidence_id from gov_repo.evidence
    where organisation_id = (
      select organisation_id from gov_repo.governance_users
      where email = auth.email() limit 1
    )
  ));
