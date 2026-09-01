-- =============================================================================
-- CODEGUARD AI GOVERNANCE OS
-- Migration: 20260618002000_gov_repo_identity_and_ledger
-- Domain:    Governance Repository — Identity, Roles, QES & Immutable Ledger
-- Depends:   20260618001000_gov_repo_types_and_organisations
-- =============================================================================

-- ─── GOVERNANCE ROLES ────────────────────────────────────────────────────────
create table gov_repo.governance_roles (
  role_id              uuid        primary key default uuid_generate_v4(),
  role_code            varchar(50) not null,
  role_name            varchar(100) not null,
  role_description     text,
  role_tier            varchar(20) not null,       -- system|organisation|department|agent
  permissions          jsonb       not null default '[]',
  can_approve_up_to    varchar(50),                -- policy|risk|exception|conformity
  requires_qes         boolean     not null default false,
  max_agents_owned     integer,                    -- capacity limit per owner
  is_system_role       boolean     not null default false,
  created_at           timestamptz not null default now(),
  constraint governance_roles_code_unique unique (role_code),
  constraint role_tier_check check (role_tier in ('system','organisation','department','agent'))
);

comment on table gov_repo.governance_roles is
  'RBAC role definitions with permission sets. System roles are immutable.';
comment on column gov_repo.governance_roles.permissions is
  'JSON array of permission strings in format: {domain}.{resource}.{action}. Wildcard: *.*.*';
comment on column gov_repo.governance_roles.requires_qes is
  'When true, actions performed under this role must carry a QES signature (eIDAS).';
comment on column gov_repo.governance_roles.max_agents_owned is
  'Maximum AI agents this role can own simultaneously. NULL = unlimited.';

-- Seed: system roles (immutable baseline)
insert into gov_repo.governance_roles
  (role_code, role_name, role_tier, permissions, requires_qes, is_system_role, role_description)
values
  ('GOVERNANCE_ADMIN',
   'Governance Administrator',
   'system',
   '["*.*.*"]',
   true, true,
   'Full platform access. Manages roles, workflow templates, and system configuration.'),

  ('POLICY_OWNER',
   'Policy Owner',
   'organisation',
   '["policy.*.create","policy.*.read","policy.*.update","policy.*.submit"]',
   false, true,
   'Creates and submits policies for approval. Cannot approve own policies.'),

  ('POLICY_APPROVER',
   'Policy Approver',
   'organisation',
   '["policy.version.approve","policy.version.reject","policy.version.return","policy.*.read"]',
   true, true,
   'Reviews and approves policy versions. QES required on approval decision.'),

  ('RISK_MANAGER',
   'Risk Manager',
   'organisation',
   '["risk.*.create","risk.*.read","risk.*.update","risk_treatment.*.create","risk_treatment.*.update"]',
   false, true,
   'Manages risk register entries and treatment plans.'),

  ('EVIDENCE_CURATOR',
   'Evidence Curator',
   'organisation',
   '["evidence.*.create","evidence.*.read","evidence.*.update","evidence.*.verify","evidence.*.link"]',
   false, true,
   'Collects, verifies, and links evidence to controls and risks.'),

  ('CONTROL_ASSESSOR',
   'Control Assessor',
   'organisation',
   '["assessment.*.create","assessment.*.read","assessment.*.update","assessment.*.complete","evidence.*.read"]',
   false, true,
   'Performs CG-AGF control assessments and raises findings.'),

  ('L1_APPROVER',
   'Level 1 Approver',
   'organisation',
   '["approval.l1.decide","*.*.read"]',
   false, true,
   'Approves routine governance artefacts (Step 1 of workflow).'),

  ('L2_APPROVER',
   'Level 2 Approver',
   'organisation',
   '["approval.l1.decide","approval.l2.decide","*.*.read"]',
   true, true,
   'Senior approval authority. QES required. Approves L1 and L2 workflow steps.'),

  ('L3_APPROVER',
   'Level 3 Approver (Executive)',
   'organisation',
   '["approval.l1.decide","approval.l2.decide","approval.l3.decide","*.*.read"]',
   true, true,
   'Executive approval authority. QES mandatory. Final approval for high-risk artefacts.'),

  ('CISO',
   'Chief Information Security Officer',
   'organisation',
   '["security.*.manage","approval.l2.decide","risk.acceptance.approve","*.*.read"]',
   true, true,
   'Security governance authority. Approves risk acceptances and security exceptions.'),

  ('DPO',
   'Data Protection Officer',
   'organisation',
   '["data.*.manage","evidence.*.verify","policy.*.review","*.*.read"]',
   false, true,
   'Data protection authority. Reviews DPIA evidence and data governance policies.'),

  ('AUDITOR',
   'Internal / External Auditor',
   'organisation',
   '["*.*.read","ledger.*.export"]',
   false, true,
   'Read-only access across all governance artefacts. Can export ledger for audit.'),

  ('REGULATOR_VIEW',
   'Regulatory Read Access',
   'system',
   '["*.*.read.non_restricted","ledger.*.export"]',
   false, true,
   'Scoped read-only access for supervisory authorities (ECB, Banco de Portugal, EBA).');

-- RLS
alter table gov_repo.governance_roles enable row level security;
create policy "Service role has full access to governance_roles"
  on gov_repo.governance_roles for all to service_role using (true) with check (true);
create policy "Authenticated users can read governance_roles"
  on gov_repo.governance_roles for select to authenticated using (true);

-- ─── GOVERNANCE USERS ────────────────────────────────────────────────────────
create table gov_repo.governance_users (
  user_id              uuid          primary key default uuid_generate_v4(),
  external_id          varchar(255),             -- Enterprise IdP (LDAP / OIDC) subject ID
  email                varchar(255)  not null,
  full_name            varchar(255)  not null,
  display_name         varchar(100),
  organisation_id      uuid          not null references gov_repo.organisations (organisation_id),
  department           varchar(100),
  job_title            varchar(100),
  status               gov_repo.user_status not null default 'active',
  eidas_subject_id     varchar(500),             -- Bound eIDAS identity for QES
  preferred_mfa        varchar(20),              -- totp|fido2|smartcard|pki
  role_ids             uuid[]        not null default '{}',
  created_at           timestamptz   not null default now(),
  updated_at           timestamptz   not null default now(),
  last_login_at        timestamptz,
  password_changed_at  timestamptz,
  constraint governance_users_email_unique unique (email)
);

comment on table gov_repo.governance_users is
  'Platform users with governance role assignments. Linked to enterprise IdP via external_id.';
comment on column gov_repo.governance_users.eidas_subject_id is
  'Distinguished Name from eIDAS qualified certificate, bound at first QES operation.';
comment on column gov_repo.governance_users.role_ids is
  'Array of governance_roles.role_id values. Resolved at runtime for permission checks.';

create index idx_gov_users_org    on gov_repo.governance_users (organisation_id);
create index idx_gov_users_email  on gov_repo.governance_users (email);
create index idx_gov_users_status on gov_repo.governance_users (status) where status = 'active';

create trigger trg_governance_users_updated_at
  before update on gov_repo.governance_users
  for each row execute function gov_repo.set_updated_at();

-- RLS
alter table gov_repo.governance_users enable row level security;

create policy "Service role has full access to governance_users"
  on gov_repo.governance_users for all to service_role using (true) with check (true);

create policy "Users can read own record"
  on gov_repo.governance_users for select to authenticated
  using (email = auth.email());

create policy "Org-scoped read for authenticated users"
  on gov_repo.governance_users for select to authenticated
  using (organisation_id = (
    select organisation_id from gov_repo.governance_users
    where email = auth.email() limit 1
  ));

-- ─── QES SIGNATURES (eIDAS) ──────────────────────────────────────────────────
create table gov_repo.qes_signatures (
  signature_id          uuid           primary key default uuid_generate_v4(),
  -- What was signed
  subject_type          varchar(100)   not null,  -- e.g. 'policy_version', 'approval_decision'
  subject_id            uuid           not null,
  subject_hash          char(64)       not null,  -- SHA-256 of signed content at time of signing
  -- Signer identity
  signatory_user_id     uuid           not null references gov_repo.governance_users (user_id),
  signatory_legal_name  varchar(255)   not null,  -- From eIDAS certificate CommonName
  signatory_cert_serial varchar(255)   not null,  -- X.509 certificate serial number
  -- Trust Service Provider
  tsp_name              varchar(255)   not null,  -- e.g. 'Digidentity', 'FNMT', 'SCEE'
  tsp_url               text           not null,
  -- Signature data
  signature_format      gov_repo.signature_format not null default 'pades',
  signature_bytes       bytea          not null,
  signature_timestamp   timestamptz    not null,  -- From TSP timestamp token
  timestamp_token       bytea,                    -- RFC 3161 timestamp token
  -- Validation
  validation_status     gov_repo.signature_status not null default 'valid',
  validated_at          timestamptz,
  certificate_chain     jsonb          not null,  -- Full cert chain at signing time
  created_at            timestamptz    not null default now()
  -- NOTE: NO updated_at — signatures are immutable once created
);

comment on table gov_repo.qes_signatures is
  'Qualified Electronic Signatures (eIDAS Regulation). Immutable once created.
   Every record in this table represents a legally binding signature from an EU-recognised TSP.';
comment on column gov_repo.qes_signatures.subject_hash is
  'SHA-256 hash of the signed content. Used to verify content has not changed since signing.';
comment on column gov_repo.qes_signatures.timestamp_token is
  'RFC 3161 trusted timestamp token from the TSP. Proves exact time of signing.';

create index idx_qes_signatures_subject on gov_repo.qes_signatures (subject_type, subject_id);
create index idx_qes_signatures_signatory on gov_repo.qes_signatures (signatory_user_id);

-- QES records are immutable — no updates or deletes
alter table gov_repo.qes_signatures enable row level security;

create policy "Service role has full access to qes_signatures"
  on gov_repo.qes_signatures for all to service_role using (true) with check (true);

create policy "Authenticated users can read signatures"
  on gov_repo.qes_signatures for select to authenticated using (true);

-- ─── GOVERNANCE LEDGER (IMMUTABLE APPEND-ONLY) ───────────────────────────────
-- This table forms a hash-chained, tamper-evident audit record of all governance
-- events. Every row contains the SHA-256 hash of the previous row + its own
-- payload, forming an integrity chain.
--
-- Design principles:
--   1. NO UPDATE ever allowed on immutable fields
--   2. NO DELETE ever allowed
--   3. entry_sequence is monotonically increasing (BIGSERIAL)
--   4. entry_hash = SHA-256(previous_hash || event_type || subject_id ||
--                           actor_user_id || recorded_at || payload)
--   5. Periodic RFC 3161 timestamping anchors the chain externally
-- ─────────────────────────────────────────────────────────────────────────────
create table gov_repo.governance_ledger (
  -- Sequence is the true primary key (UUID is secondary / lookup key)
  entry_sequence        bigserial     not null,
  entry_id              uuid          not null default uuid_generate_v4(),
  -- Event classification
  event_type            varchar(100)  not null,
  event_description     text          not null,
  -- Subject of the event
  subject_type          varchar(100)  not null,
  subject_id            uuid          not null,
  -- Actor
  actor_user_id         uuid          not null,
  actor_ip              inet,
  actor_session_id      uuid,
  -- Tenant
  organisation_id       uuid          not null,
  -- Timing
  event_timestamp       timestamptz   not null default now(),
  recorded_at           timestamptz   not null default now(),
  -- Hash chain (integrity)
  previous_hash         char(64)      not null,
  entry_hash            char(64)      not null,
  -- Full event payload (immutable)
  payload               jsonb         not null,
  -- RFC 3161 anchor (written by anchoring job — only mutable fields allowed)
  qes_anchor            text,                    -- Base64 timestamp token
  qes_anchor_at         timestamptz,
  -- Primary key on sequence
  constraint governance_ledger_pkey primary key (entry_sequence)
);

comment on table gov_repo.governance_ledger is
  'IMMUTABLE append-only governance event ledger. Hash-chained for tamper detection.
   Satisfies: EU AI Act Art. 12 | DORA Art. 10 | GDPR Art. 5(2) accountability.
   DO NOT: UPDATE immutable fields, DELETE any row, reset entry_sequence.';
comment on column gov_repo.governance_ledger.previous_hash is
  'SHA-256 of the immediately preceding ledger entry. First entry uses hash of "GENESIS".';
comment on column gov_repo.governance_ledger.entry_hash is
  'SHA-256(previous_hash || event_type || subject_id || actor_user_id || recorded_at || payload).
   Recompute and compare to detect tampering.';
comment on column gov_repo.governance_ledger.qes_anchor is
  'RFC 3161 timestamp token anchoring a batch of entries to an external trusted timestamp.
   Updated by the periodic ledger anchoring job — only mutable column.';

create index idx_ledger_subject     on gov_repo.governance_ledger (subject_type, subject_id);
create index idx_ledger_org_time    on gov_repo.governance_ledger (organisation_id, event_timestamp desc);
create index idx_ledger_actor       on gov_repo.governance_ledger (actor_user_id);
create index idx_ledger_event_type  on gov_repo.governance_ledger (event_type);
create index idx_ledger_entry_id    on gov_repo.governance_ledger (entry_id);

-- Immutability: block UPDATE on core fields via rule
-- (Only qes_anchor and qes_anchor_at are ever permitted to be updated)
create or replace rule governance_ledger_immutable_core as
  on update to gov_repo.governance_ledger
  where (
    old.entry_sequence  is distinct from new.entry_sequence  or
    old.entry_id        is distinct from new.entry_id        or
    old.event_type      is distinct from new.event_type      or
    old.subject_type    is distinct from new.subject_type    or
    old.subject_id      is distinct from new.subject_id      or
    old.actor_user_id   is distinct from new.actor_user_id   or
    old.payload         is distinct from new.payload         or
    old.previous_hash   is distinct from new.previous_hash   or
    old.entry_hash      is distinct from new.entry_hash      or
    old.recorded_at     is distinct from new.recorded_at
  )
  do instead nothing;

-- Immutability: block DELETE unconditionally
create or replace rule governance_ledger_no_delete as
  on delete to gov_repo.governance_ledger
  do instead nothing;

-- RLS
alter table gov_repo.governance_ledger enable row level security;

create policy "Service role has full access to governance_ledger"
  on gov_repo.governance_ledger for all to service_role using (true) with check (true);

create policy "Auditors and regulators can read ledger"
  on gov_repo.governance_ledger for select to authenticated
  using (
    organisation_id = (
      select organisation_id from gov_repo.governance_users
      where email = auth.email() limit 1
    )
  );

-- ─── LEDGER APPEND FUNCTION ──────────────────────────────────────────────────
-- Sole write path to the governance ledger.
-- Computes hash chain automatically. Must be called in SERIALIZABLE isolation.
create or replace function gov_repo.ledger_append(
  p_event_type      varchar,
  p_event_desc      text,
  p_subject_type    varchar,
  p_subject_id      uuid,
  p_actor_user_id   uuid,
  p_actor_ip        inet,
  p_organisation_id uuid,
  p_payload         jsonb
)
returns bigint
language plpgsql
security definer
as $$
declare
  v_prev_hash   char(64);
  v_entry_data  text;
  v_entry_hash  char(64);
  v_sequence    bigint;
  v_now         timestamptz := now();
begin
  -- Lock last row to prevent concurrent inserts breaking the chain
  select entry_hash into v_prev_hash
  from gov_repo.governance_ledger
  order by entry_sequence desc
  limit 1
  for update skip locked;

  -- Genesis block if ledger is empty
  if v_prev_hash is null then
    v_prev_hash := encode(digest('CODEGUARD-GENESIS-2026', 'sha256'), 'hex');
  end if;

  -- Compute this entry's hash
  v_entry_data := v_prev_hash
    || p_event_type
    || p_subject_id::text
    || p_actor_user_id::text
    || v_now::text
    || p_payload::text;

  v_entry_hash := encode(digest(v_entry_data, 'sha256'), 'hex');

  -- Append to ledger
  insert into gov_repo.governance_ledger (
    event_type,
    event_description,
    subject_type,
    subject_id,
    actor_user_id,
    actor_ip,
    organisation_id,
    event_timestamp,
    recorded_at,
    previous_hash,
    entry_hash,
    payload
  )
  values (
    p_event_type,
    p_event_desc,
    p_subject_type,
    p_subject_id,
    p_actor_user_id,
    p_actor_ip,
    p_organisation_id,
    v_now,
    v_now,
    v_prev_hash,
    v_entry_hash,
    p_payload
  )
  returning entry_sequence into v_sequence;

  return v_sequence;
end;
$$;

comment on function gov_repo.ledger_append is
  'Sole authorised write path to the governance ledger. Computes and validates the
   SHA-256 hash chain. Call inside SERIALIZABLE transaction for strict ordering.';

-- ─── LEDGER INTEGRITY VERIFICATION FUNCTION ──────────────────────────────────
create or replace function gov_repo.ledger_verify(
  p_from_sequence bigint default 1,
  p_to_sequence   bigint default null
)
returns table (
  is_valid        boolean,
  entries_checked bigint,
  first_break_at  bigint,
  break_reason    text
)
language plpgsql
security definer
as $$
declare
  r               record;
  v_prev_hash     char(64);
  v_expected_hash char(64);
  v_entry_data    text;
  v_entries       bigint := 0;
  v_break_seq     bigint := null;
  v_break_reason  text   := null;
begin
  for r in
    select
      entry_sequence,
      previous_hash,
      entry_hash,
      event_type,
      subject_id,
      actor_user_id,
      recorded_at,
      payload
    from gov_repo.governance_ledger
    where entry_sequence >= p_from_sequence
      and (p_to_sequence is null or entry_sequence <= p_to_sequence)
    order by entry_sequence asc
  loop
    v_entries := v_entries + 1;

    -- Verify previous_hash links correctly
    if v_prev_hash is not null and r.previous_hash <> v_prev_hash then
      v_break_seq    := r.entry_sequence;
      v_break_reason := 'previous_hash mismatch at sequence ' || r.entry_sequence
                        || '. Expected: ' || v_prev_hash
                        || ', found: ' || r.previous_hash;
      exit;
    end if;

    -- Recompute and verify entry_hash
    v_entry_data := r.previous_hash
      || r.event_type
      || r.subject_id::text
      || r.actor_user_id::text
      || r.recorded_at::text
      || r.payload::text;

    v_expected_hash := encode(digest(v_entry_data, 'sha256'), 'hex');

    if r.entry_hash <> v_expected_hash then
      v_break_seq    := r.entry_sequence;
      v_break_reason := 'entry_hash tampered at sequence ' || r.entry_sequence
                        || '. Recomputed: ' || v_expected_hash
                        || ', stored: ' || r.entry_hash;
      exit;
    end if;

    v_prev_hash := r.entry_hash;
  end loop;

  return query
    select
      (v_break_seq is null),
      v_entries,
      v_break_seq,
      v_break_reason;
end;
$$;

comment on function gov_repo.ledger_verify is
  'Verifies the SHA-256 hash chain integrity of the governance ledger.
   Returns first break point if tampering is detected.
   Run by the daily integrity-check scheduled job.';

-- ─── WORKFLOW TEMPLATES ──────────────────────────────────────────────────────
create table gov_repo.workflow_templates (
  template_id        uuid         primary key default uuid_generate_v4(),
  template_code      varchar(50)  not null,
  name               varchar(255) not null,
  subject_type       varchar(100) not null,
  -- Steps: ordered JSON array
  -- Each step: {step, name, role, sla_hours, mandatory, requires_qes}
  steps              jsonb        not null,
  -- Escalation: [{after_hours, escalate_to_role, notify_roles}]
  escalation_rules   jsonb        not null default '[]',
  -- Expiry: {total_sla_hours, reminder_at_hours, auto_reject_on_expiry}
  expiry_rules       jsonb        not null default '{}',
  requires_qes       boolean      not null default false,
  min_approvers      integer      not null default 1,
  requires_4_eyes    boolean      not null default false,   -- No two consecutive steps by same person
  sla_hours          integer      not null default 72,
  organisation_id    uuid         references gov_repo.organisations (organisation_id),
  is_active          boolean      not null default true,
  created_at         timestamptz  not null default now(),
  constraint workflow_templates_code_unique unique (template_code)
);

comment on table gov_repo.workflow_templates is
  'Configurable approval workflow templates. NULL organisation_id = system-wide default template.';
comment on column gov_repo.workflow_templates.requires_4_eyes is
  'Banking control: no two consecutive approval steps can be decided by the same person.';
comment on column gov_repo.workflow_templates.steps is
  'Ordered JSON array of step definitions.
   Schema: [{step:int, name:str, role:str, sla_hours:int, mandatory:bool, requires_qes:bool}]';

-- Seed: banking-grade system workflow templates
insert into gov_repo.workflow_templates
  (template_code, name, subject_type, steps, requires_qes, requires_4_eyes, sla_hours, min_approvers)
values
(
  'POLICY_APPROVAL_BANKING',
  'Banking-Grade Policy Approval',
  'policy_version',
  '[
    {"step":1,"name":"Legal Review",       "role":"L1_APPROVER",    "sla_hours":24,"mandatory":true,"requires_qes":false},
    {"step":2,"name":"Compliance Review",  "role":"L2_APPROVER",    "sla_hours":24,"mandatory":true,"requires_qes":true},
    {"step":3,"name":"CISO Approval",      "role":"CISO",           "sla_hours":48,"mandatory":true,"requires_qes":true},
    {"step":4,"name":"Executive Approval", "role":"L3_APPROVER",    "sla_hours":48,"mandatory":true,"requires_qes":true}
  ]',
  true, true, 144, 4
),
(
  'EXCEPTION_APPROVAL_BANKING',
  'Banking-Grade Exception Approval',
  'exception',
  '[
    {"step":1,"name":"Risk Assessment",    "role":"RISK_MANAGER",   "sla_hours":24,"mandatory":true,"requires_qes":false},
    {"step":2,"name":"CISO Review",        "role":"CISO",           "sla_hours":24,"mandatory":true,"requires_qes":true},
    {"step":3,"name":"Executive Approval", "role":"L3_APPROVER",    "sla_hours":48,"mandatory":true,"requires_qes":true}
  ]',
  true, true, 96, 3
),
(
  'RISK_ACCEPTANCE_BANKING',
  'Banking-Grade Risk Acceptance',
  'risk_treatment',
  '[
    {"step":1,"name":"Risk Owner Submission","role":"RISK_MANAGER",  "sla_hours":24,"mandatory":true,"requires_qes":false},
    {"step":2,"name":"Second Line Review",   "role":"L2_APPROVER",  "sla_hours":48,"mandatory":true,"requires_qes":true},
    {"step":3,"name":"CRO/CISO Acceptance",  "role":"L3_APPROVER",  "sla_hours":48,"mandatory":true,"requires_qes":true}
  ]',
  true, true, 120, 3
),
(
  'CONFORMITY_ASSESSMENT_BANKING',
  'AI Act Conformity Assessment Approval',
  'conformity_assessment',
  '[
    {"step":1,"name":"Assessor Completion", "role":"CONTROL_ASSESSOR","sla_hours":48,"mandatory":true,"requires_qes":false},
    {"step":2,"name":"CISO Review",         "role":"CISO",            "sla_hours":48,"mandatory":true,"requires_qes":true},
    {"step":3,"name":"Executive Sign-off",  "role":"L3_APPROVER",     "sla_hours":72,"mandatory":true,"requires_qes":true}
  ]',
  true, true, 168, 3
),
(
  'EVIDENCE_VERIFICATION_STANDARD',
  'Standard Evidence Verification',
  'evidence',
  '[
    {"step":1,"name":"Curator Verification","role":"EVIDENCE_CURATOR","sla_hours":48,"mandatory":true,"requires_qes":false}
  ]',
  false, false, 48, 1
),
(
  'POLICY_APPROVAL_STANDARD',
  'Standard Policy Approval',
  'policy_version',
  '[
    {"step":1,"name":"Peer Review",         "role":"L1_APPROVER",    "sla_hours":48,"mandatory":true,"requires_qes":false},
    {"step":2,"name":"Manager Approval",    "role":"L2_APPROVER",    "sla_hours":48,"mandatory":true,"requires_qes":false}
  ]',
  false, true, 96, 2
);

alter table gov_repo.workflow_templates enable row level security;
create policy "Service role has full access to workflow_templates"
  on gov_repo.workflow_templates for all to service_role using (true) with check (true);
create policy "Authenticated users can read workflow_templates"
  on gov_repo.workflow_templates for select to authenticated using (true);
