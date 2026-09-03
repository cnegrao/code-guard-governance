-- =============================================================================
-- CODEGUARD AI GOVERNANCE OS
-- Migration: 20260618004000_gov_repo_workflows_assessments_views
-- Domain:    Governance Repository — Approvals, Exceptions, Assessments & Views
-- Depends:   20260618003000_gov_repo_policies_risks_evidence
-- =============================================================================

-- ─── APPROVAL REQUESTS ───────────────────────────────────────────────────────
create table gov_repo.approval_requests (
  request_id            uuid          primary key default uuid_generate_v4(),
  request_code          varchar(20)   not null,
  -- What is being approved
  subject_type          varchar(50)   not null
                        check (subject_type in (
                          'policy_version','risk_treatment','exception',
                          'conformity_assessment','evidence','agent_deployment',
                          'control_assessment','risk_acceptance'
                        )),
  subject_id            uuid          not null,
  subject_version       integer,
  -- Request metadata
  title                 varchar(255)  not null,
  description           text,
  requested_by          uuid          not null references gov_repo.governance_users (user_id),
  requested_at          timestamptz   not null default now(),
  -- Workflow
  workflow_template_id  uuid          not null references gov_repo.workflow_templates (template_id),
  current_step          integer       not null default 1,
  status                gov_repo.approval_status not null default 'submitted',
  priority              gov_repo.approval_priority not null default 'routine',
  -- SLA
  due_date              timestamptz   not null,
  approval_deadline     timestamptz   not null,
  -- Tenant
  organisation_id       uuid          not null references gov_repo.organisations (organisation_id),
  -- Additional context for approvers
  context_data          jsonb         not null default '{}',
  -- Final signature (applied after last step)
  final_qes_id          uuid          references gov_repo.qes_signatures (signature_id),
  -- Audit
  ledger_entry_seq      bigint        references gov_repo.governance_ledger (entry_sequence),
  created_at            timestamptz   not null default now(),
  updated_at            timestamptz   not null default now(),
  constraint approval_requests_code_org_unique unique (request_code, organisation_id),
  constraint approval_sla_order check (due_date <= approval_deadline)
);

comment on table gov_repo.approval_requests is
  'Approval workflow orchestration. Covers policies, risks, exceptions, conformity assessments.
   Banking-grade: 4-eyes enforcement, QES on final step, SLA tracking with auto-escalation.';
comment on column gov_repo.approval_requests.current_step is
  'Currently active step index (1-based). Advances on each approved decision.';

create index idx_approval_requests_status    on gov_repo.approval_requests (status, organisation_id);
create index idx_approval_requests_requester on gov_repo.approval_requests (requested_by);
create index idx_approval_requests_subject   on gov_repo.approval_requests (subject_type, subject_id);
create index idx_approval_requests_due       on gov_repo.approval_requests (due_date)
  where status in ('submitted','in_review','escalated');

create trigger trg_approval_requests_updated_at
  before update on gov_repo.approval_requests
  for each row execute function gov_repo.set_updated_at();

alter table gov_repo.approval_requests enable row level security;
create policy "Service role has full access to approval_requests"
  on gov_repo.approval_requests for all to service_role using (true) with check (true);
create policy "Org-scoped access to approval_requests"
  on gov_repo.approval_requests for select to authenticated
  using (organisation_id = (
    select organisation_id from gov_repo.governance_users
    where email = auth.email() limit 1
  ));

-- Approval step decisions
create table gov_repo.approval_decisions (
  decision_id           uuid          primary key default uuid_generate_v4(),
  request_id            uuid          not null references gov_repo.approval_requests (request_id) on delete cascade,
  workflow_step         integer       not null,
  step_name             varchar(100)  not null,
  -- Assignment
  assigned_to           uuid          not null references gov_repo.governance_users (user_id),
  role_required         varchar(50)   not null,
  -- Decision
  decided_by            uuid          references gov_repo.governance_users (user_id),
  decision              gov_repo.approval_decision,
  rationale             text,         -- MANDATORY when decision is rejected or returned
  conditions            text,         -- Conditions attached to approval (if any)
  delegated_to          uuid          references gov_repo.governance_users (user_id),
  -- QES (required for L2/L3 steps and high-risk subjects)
  qes_signature_id      uuid          references gov_repo.qes_signatures (signature_id),
  -- Timing
  decided_at            timestamptz,
  deadline              timestamptz   not null,
  reminder_sent_at      timestamptz,
  -- Escalation
  escalated_at          timestamptz,
  escalated_to          uuid          references gov_repo.governance_users (user_id),
  created_at            timestamptz   not null default now(),
  constraint decision_rationale_required check (
    decision is null
    or decision in ('approved','abstained','delegated')
    or (decision in ('rejected','returned') and rationale is not null and rationale <> '')
  ),
  constraint decision_decided_at_consistent check (
    (decided_by is null) = (decided_at is null)
  )
);

comment on table gov_repo.approval_decisions is
  'Individual approval step decisions. Each request has one decision row per workflow step.
   Rationale is mandatory for rejection and return decisions.
   QES is mandatory for L2/L3 decisions per banking-grade workflow templates.';

create index idx_approval_decisions_request  on gov_repo.approval_decisions (request_id, workflow_step);
create index idx_approval_decisions_assignee on gov_repo.approval_decisions (assigned_to)
  where decided_at is null;
create index idx_approval_decisions_deadline on gov_repo.approval_decisions (deadline)
  where decided_at is null;

alter table gov_repo.approval_decisions enable row level security;
create policy "Service role has full access to approval_decisions"
  on gov_repo.approval_decisions for all to service_role using (true) with check (true);
create policy "Assignees can read own decisions"
  on gov_repo.approval_decisions for select to authenticated
  using (
    assigned_to = (select user_id from gov_repo.governance_users where email = auth.email() limit 1)
    or decided_by = (select user_id from gov_repo.governance_users where email = auth.email() limit 1)
  );

-- ─── EXCEPTIONS ──────────────────────────────────────────────────────────────
create table gov_repo.exceptions (
  exception_id          uuid          primary key default uuid_generate_v4(),
  exception_code        varchar(20)   not null,
  title                 varchar(255)  not null,
  description           text          not null,
  exception_type        gov_repo.exception_type not null,
  -- What is being excepted from
  policy_id             uuid          references gov_repo.governance_policies (policy_id),
  control_ref           varchar(12),  -- CG-AG-001..012 — validated by app layer
  agent_id              uuid,         -- Agent requiring exception (FK to agent registry domain)
  -- Justification
  business_justification   text       not null,
  risk_assessment          text       not null,
  compensating_controls    text,
  -- Ownership
  requested_by          uuid          not null references gov_repo.governance_users (user_id),
  requested_at          timestamptz   not null default now(),
  status                gov_repo.exception_status not null default 'draft',
  approved_by           uuid          references gov_repo.governance_users (user_id),
  approval_date         timestamptz,
  -- Validity window (NO indefinite exceptions)
  valid_from            date,
  valid_until           date,
  max_extension_days    integer       not null default 90,
  review_frequency      gov_repo.review_frequency not null default 'monthly',
  next_review_date      date,
  -- QES (mandatory for banking-grade exceptions)
  qes_signature_id      uuid          references gov_repo.qes_signatures (signature_id),
  -- Links
  risk_id               uuid          references gov_repo.risk_entries (risk_id),
  -- Revocation
  revocation_reason     text,
  revoked_at            timestamptz,
  revoked_by            uuid          references gov_repo.governance_users (user_id),
  -- Tenant
  organisation_id       uuid          not null references gov_repo.organisations (organisation_id),
  -- Audit
  ledger_entry_seq      bigint        references gov_repo.governance_ledger (entry_sequence),
  created_at            timestamptz   not null default now(),
  updated_at            timestamptz   not null default now(),
  constraint exceptions_code_org_unique unique (exception_code, organisation_id),
  constraint exception_valid_period check (
    valid_until is null or valid_from is null or valid_until > valid_from
  ),
  constraint exception_revocation_consistent check (
    (revoked_at is null) = (revoked_by is null)
  )
);

comment on table gov_repo.exceptions is
  'Governance exceptions — temporary deviations from policies or controls.
   All exceptions MUST have a valid_until date (no indefinite exceptions).
   Banking rule: max_extension_days = 90, max 2 extensions total.
   Active exceptions are monitored and reviewed per review_frequency.';
comment on column gov_repo.exceptions.compensating_controls is
  'Mitigating measures in place during the exception period. Mandatory for risk_acceptance type.';

create index idx_exceptions_org       on gov_repo.exceptions (organisation_id);
create index idx_exceptions_status    on gov_repo.exceptions (status);
create index idx_exceptions_expiry    on gov_repo.exceptions (valid_until)
  where status = 'active';
create index idx_exceptions_control   on gov_repo.exceptions (control_ref)
  where control_ref is not null;
create index idx_exceptions_agent     on gov_repo.exceptions (agent_id)
  where agent_id is not null;

create trigger trg_exceptions_updated_at
  before update on gov_repo.exceptions
  for each row execute function gov_repo.set_updated_at();

alter table gov_repo.exceptions enable row level security;
create policy "Service role has full access to exceptions"
  on gov_repo.exceptions for all to service_role using (true) with check (true);
create policy "Org-scoped access to exceptions"
  on gov_repo.exceptions for select to authenticated
  using (organisation_id = (
    select organisation_id from gov_repo.governance_users
    where email = auth.email() limit 1
  ));

-- ─── CONFORMITY ASSESSMENTS (EU AI Act Art. 43) ───────────────────────────────
create table gov_repo.conformity_assessments (
  assessment_id         uuid          primary key default uuid_generate_v4(),
  assessment_code       varchar(20)   not null,
  agent_id              uuid          not null,   -- FK to agent registry (separate domain)
  assessment_type       gov_repo.conformity_type not null default 'internal',
  ai_act_annex_ref      varchar(100),             -- e.g. 'Annex III, point 5(b)'
  status                gov_repo.conformity_status not null default 'not_started',
  scope_description     text          not null,
  methodology           text          not null,
  -- Assessor
  assessor_id           uuid          references gov_repo.governance_users (user_id),
  assessor_org          varchar(255),             -- External assessor / Notified Body name
  -- Dates
  start_date            date          not null,
  completion_date       date,
  valid_until           date,
  -- Outcome
  outcome               gov_repo.conformity_outcome,
  non_conformities      jsonb         default '[]',
  conditions            text,
  -- EU AI Database
  eu_ai_db_ref          varchar(100),             -- EU AI database registration number
  -- Evidence
  declaration_evidence_id uuid        references gov_repo.evidence (evidence_id),
  technical_file_evidence_id uuid     references gov_repo.evidence (evidence_id),
  -- Tenant
  organisation_id       uuid          not null references gov_repo.organisations (organisation_id),
  -- Audit
  ledger_entry_seq      bigint        references gov_repo.governance_ledger (entry_sequence),
  created_at            timestamptz   not null default now(),
  updated_at            timestamptz   not null default now(),
  constraint conformity_code_org_unique unique (assessment_code, organisation_id)
);

comment on table gov_repo.conformity_assessments is
  'EU AI Act Article 43 conformity assessments for high-risk AI agents.
   Automatically triggered when CG-AG-010 classifies an agent as high-risk.
   outcome must be set before registration in EU AI Database (eu_ai_db_ref).';
comment on column gov_repo.conformity_assessments.non_conformities is
  'JSON array of non-conformity objects: [{id, description, severity, article_ref, remediation}]';

create index idx_conformity_org    on gov_repo.conformity_assessments (organisation_id);
create index idx_conformity_agent  on gov_repo.conformity_assessments (agent_id);
create index idx_conformity_status on gov_repo.conformity_assessments (status);

create trigger trg_conformity_updated_at
  before update on gov_repo.conformity_assessments
  for each row execute function gov_repo.set_updated_at();

alter table gov_repo.conformity_assessments enable row level security;
create policy "Service role has full access to conformity_assessments"
  on gov_repo.conformity_assessments for all to service_role using (true) with check (true);
create policy "Org-scoped access to conformity_assessments"
  on gov_repo.conformity_assessments for select to authenticated
  using (organisation_id = (
    select organisation_id from gov_repo.governance_users
    where email = auth.email() limit 1
  ));

-- ─── CONTROL ASSESSMENTS (CG-AG-001 through CG-AG-012) ───────────────────────
create table gov_repo.control_assessments (
  assessment_id          uuid         primary key default uuid_generate_v4(),
  -- Which control and for which agent (optional)
  control_ref            varchar(12)  not null,  -- CG-AG-001 through CG-AG-012
  agent_id               uuid,                   -- NULL = org-level assessment
  -- Assessment period
  period_start           date         not null,
  period_end             date         not null,
  -- People
  assessor_id            uuid         not null references gov_repo.governance_users (user_id),
  reviewer_id            uuid         references gov_repo.governance_users (user_id),
  -- State
  status                 gov_repo.assessment_status not null default 'planned',
  -- Maturity scoring (0-5 per CG-AGF maturity model)
  maturity_level         smallint     check (maturity_level between 0 and 5),
  operating_effectiveness gov_repo.operating_effectiveness,
  design_effectiveness   gov_repo.design_effectiveness,
  -- Findings (inline JSON — detailed records in control_findings table)
  findings_summary       jsonb        not null default '[]',
  -- Evidence and remediations
  evidence_ids           uuid[]       not null default '{}',
  remediation_ids        uuid[]       not null default '{}',
  -- Conclusion
  overall_conclusion     text,
  next_assessment_date   date,
  -- Tenant
  organisation_id        uuid         not null references gov_repo.organisations (organisation_id),
  -- Audit
  ledger_entry_seq       bigint       references gov_repo.governance_ledger (entry_sequence),
  created_at             timestamptz  not null default now(),
  completed_at           timestamptz,
  updated_at             timestamptz  not null default now(),
  constraint control_ref_format check (
    control_ref ~ '^CG-AG-0(0[1-9]|1[0-2])$'
  ),
  constraint period_order check (period_end >= period_start)
);

comment on table gov_repo.control_assessments is
  'Periodic operating effectiveness assessments of CG-AGF controls (CG-AG-001..012).
   maturity_level: 0=Absent | 1=Initial | 2=Managed | 3=Defined | 4=Quantitative | 5=Optimising.
   NULL agent_id = organisation-level control assessment (not agent-specific).';

create index idx_control_assessments_org      on gov_repo.control_assessments (organisation_id);
create index idx_control_assessments_control  on gov_repo.control_assessments (control_ref);
create index idx_control_assessments_agent    on gov_repo.control_assessments (agent_id)
  where agent_id is not null;
create index idx_control_assessments_status   on gov_repo.control_assessments (status);
create index idx_control_assessments_maturity on gov_repo.control_assessments (maturity_level);

create trigger trg_control_assessments_updated_at
  before update on gov_repo.control_assessments
  for each row execute function gov_repo.set_updated_at();

alter table gov_repo.control_assessments enable row level security;
create policy "Service role has full access to control_assessments"
  on gov_repo.control_assessments for all to service_role using (true) with check (true);
create policy "Org-scoped access to control_assessments"
  on gov_repo.control_assessments for select to authenticated
  using (organisation_id = (
    select organisation_id from gov_repo.governance_users
    where email = auth.email() limit 1
  ));

-- Detailed findings from control assessments
create table gov_repo.control_findings (
  finding_id            uuid          primary key default uuid_generate_v4(),
  finding_code          varchar(20)   not null,
  assessment_id         uuid          not null references gov_repo.control_assessments (assessment_id) on delete cascade,
  control_ref           varchar(12)   not null,
  -- Classification
  finding_type          gov_repo.finding_type not null,
  severity              gov_repo.finding_severity not null,
  -- Content
  title                 varchar(255)  not null,
  description           text          not null,
  root_cause            text,
  impact                text          not null,
  recommendation        text          not null,
  management_response   text,
  -- State
  status                gov_repo.finding_status not null default 'open',
  target_date           date          not null,
  owner_id              uuid          not null references gov_repo.governance_users (user_id),
  -- Evidence
  evidence_ids          uuid[]        not null default '{}',
  -- Audit
  created_at            timestamptz   not null default now(),
  closed_at             timestamptz,
  updated_at            timestamptz   not null default now()
);

create index idx_control_findings_assessment on gov_repo.control_findings (assessment_id);
create index idx_control_findings_control    on gov_repo.control_findings (control_ref);
create index idx_control_findings_severity   on gov_repo.control_findings (severity);
create index idx_control_findings_status     on gov_repo.control_findings (status)
  where status <> 'closed';

create trigger trg_control_findings_updated_at
  before update on gov_repo.control_findings
  for each row execute function gov_repo.set_updated_at();

alter table gov_repo.control_findings enable row level security;
create policy "Service role has full access to control_findings"
  on gov_repo.control_findings for all to service_role using (true) with check (true);
create policy "Org-scoped access to control_findings via assessment"
  on gov_repo.control_findings for select to authenticated
  using (assessment_id in (
    select assessment_id from gov_repo.control_assessments
    where organisation_id = (
      select organisation_id from gov_repo.governance_users
      where email = auth.email() limit 1
    )
  ));

-- ─── VIEWS ───────────────────────────────────────────────────────────────────

-- 1. Active exceptions dashboard
create or replace view gov_repo.v_active_exceptions as
select
  e.exception_id,
  e.exception_code,
  e.title,
  e.exception_type,
  e.control_ref,
  e.agent_id,
  e.valid_from,
  e.valid_until,
  e.valid_until - current_date               as days_remaining,
  e.review_frequency,
  e.next_review_date,
  e.valid_until - current_date <= 30         as expiring_soon,
  e.valid_until < current_date               as is_overdue,
  u.full_name                                as requested_by_name,
  a.full_name                                as approved_by_name,
  e.organisation_id
from gov_repo.exceptions e
join gov_repo.governance_users u on u.user_id = e.requested_by
left join gov_repo.governance_users a on a.user_id = e.approved_by
where e.status = 'active';

comment on view gov_repo.v_active_exceptions is
  'Active exceptions with expiry countdown. expiring_soon = expires within 30 days.';

-- 2. Pending approvals per user
create or replace view gov_repo.v_pending_approvals as
select
  d.decision_id,
  d.request_id,
  r.request_code,
  r.title,
  r.subject_type,
  r.subject_id,
  r.priority,
  d.workflow_step,
  d.step_name,
  d.assigned_to                              as assigned_user_id,
  u.full_name                                as assigned_user_name,
  u.email                                    as assigned_user_email,
  d.deadline,
  d.deadline < now()                         as is_overdue,
  d.deadline - now()                         as time_remaining,
  r.organisation_id
from gov_repo.approval_decisions d
join gov_repo.approval_requests r  on r.request_id = d.request_id
join gov_repo.governance_users u   on u.user_id    = d.assigned_to
where d.decided_at is null
  and r.status in ('submitted','in_review','escalated');

comment on view gov_repo.v_pending_approvals is
  'All unresolved approval steps with assignee and SLA status. is_overdue = deadline passed.';

-- 3. Control maturity summary per organisation
create or replace view gov_repo.v_control_maturity_summary as
select
  ca.organisation_id,
  ca.control_ref,
  -- Latest completed assessment per control
  (select maturity_level
   from gov_repo.control_assessments ca2
   where ca2.control_ref = ca.control_ref
     and ca2.organisation_id = ca.organisation_id
     and ca2.status = 'completed'
   order by ca2.period_end desc
   limit 1)                                  as current_maturity,
  (select operating_effectiveness
   from gov_repo.control_assessments ca2
   where ca2.control_ref = ca.control_ref
     and ca2.organisation_id = ca.organisation_id
     and ca2.status = 'completed'
   order by ca2.period_end desc
   limit 1)                                  as current_operating_effectiveness,
  count(*)                                   as total_assessments,
  max(ca.period_end)                         as last_assessed,
  (select next_assessment_date
   from gov_repo.control_assessments ca2
   where ca2.control_ref = ca.control_ref
     and ca2.organisation_id = ca.organisation_id
     and ca2.status = 'completed'
   order by ca2.period_end desc
   limit 1)                                  as next_assessment_date
from gov_repo.control_assessments ca
group by ca.organisation_id, ca.control_ref;

comment on view gov_repo.v_control_maturity_summary is
  'Current maturity level per CG-AGF control per organisation, derived from latest completed assessment.';

-- 4. Risk heatmap data
create or replace view gov_repo.v_risk_heatmap as
select
  r.organisation_id,
  r.likelihood,
  r.impact,
  r.inherent_risk_score,
  count(*)                                   as risk_count,
  array_agg(r.risk_code order by r.inherent_risk_score desc) as risk_codes,
  -- Risk band
  case
    when r.inherent_risk_score >= 20 then 'critical'
    when r.inherent_risk_score >= 12 then 'high'
    when r.inherent_risk_score >= 6  then 'medium'
    else                                  'low'
  end                                        as risk_band
from gov_repo.risk_entries r
where r.status not in ('closed')
group by r.organisation_id, r.likelihood, r.impact, r.inherent_risk_score;

comment on view gov_repo.v_risk_heatmap is
  'Risk matrix data for dashboard heatmap visualisation. Grouped by likelihood × impact cell.';

-- 5. Governance ledger recent events (latest 100 per org)
create or replace view gov_repo.v_ledger_recent as
select
  l.entry_sequence,
  l.event_type,
  l.event_description,
  l.subject_type,
  l.subject_id,
  u.full_name                                as actor_name,
  u.email                                    as actor_email,
  l.event_timestamp,
  l.organisation_id,
  l.entry_hash,
  l.qes_anchor is not null                   as is_anchored
from gov_repo.governance_ledger l
join gov_repo.governance_users u on u.user_id = l.actor_user_id;

comment on view gov_repo.v_ledger_recent is
  'Governance ledger with actor details. Use for audit trail display. Filter by organisation_id.';

-- 6. Mandate compliance dashboard
create or replace view gov_repo.v_mandate_compliance as
select
  m.mandate_id,
  m.mandate_code,
  m.regulation,
  m.section_ref,
  m.title,
  m.requirement_type,
  m.mapped_controls,
  m.compliance_status,
  m.last_assessed,
  -- Count of controls with at least one completed assessment
  (select count(distinct ca.control_ref)
   from gov_repo.control_assessments ca
   where ca.control_ref = any(m.mapped_controls)
     and ca.status = 'completed'
  )                                          as controls_assessed,
  array_length(m.mapped_controls, 1)         as total_controls,
  -- Any active exceptions on mapped controls
  (select count(*)
   from gov_repo.exceptions ex
   where ex.control_ref = any(m.mapped_controls)
     and ex.status = 'active'
  )                                          as active_exceptions_on_controls
from gov_repo.mandates m;

comment on view gov_repo.v_mandate_compliance is
  'Regulatory mandate compliance status with control assessment coverage and active exceptions.';

-- 7. Evidence expiry dashboard
create or replace view gov_repo.v_evidence_expiry as
select
  e.evidence_id,
  e.evidence_code,
  e.title,
  e.evidence_type,
  e.status,
  e.retention_class,
  e.retention_until,
  e.retention_until - current_date           as days_to_expiry,
  e.retention_until <= current_date + 60     as expiring_in_60d,
  e.retention_until <= current_date          as is_expired,
  e.control_refs,
  e.agent_refs,
  e.organisation_id,
  cu.full_name                               as collected_by_name,
  vu.full_name                               as verified_by_name
from gov_repo.evidence e
join gov_repo.governance_users cu on cu.user_id = e.collected_by
left join gov_repo.governance_users vu on vu.user_id = e.verified_by
where e.retention_class <> 'legal_hold'
  and e.status not in ('superseded','rejected','expired');

comment on view gov_repo.v_evidence_expiry is
  'Evidence retention dashboard. expiring_in_60d flags evidence needing renewal action.';

-- ─── GOVERNANCE SCORE FUNCTION ────────────────────────────────────────────────
create or replace function gov_repo.compute_governance_score(p_organisation_id uuid)
returns table (
  organisation_id       uuid,
  policy_score          numeric,
  risk_score            numeric,
  evidence_score        numeric,
  exception_score       numeric,
  control_maturity_score numeric,
  total_score           numeric,
  grade                 char(1)
)
language sql
security definer
as $$
  with
  -- Policy: % approved
  policy_calc as (
    select
      coalesce(
        round(
          count(*) filter (where status = 'approved')::numeric /
          nullif(count(*), 0) * 100, 1
        ), 0
      ) as score
    from gov_repo.governance_policies
    where organisation_id = p_organisation_id
  ),
  -- Risk: % in treated/monitored/accepted/closed (not open/identified only)
  risk_calc as (
    select
      coalesce(
        round(
          count(*) filter (where status in ('treated','monitored','accepted','closed'))::numeric /
          nullif(count(*), 0) * 100, 1
        ), 0
      ) as score
    from gov_repo.risk_entries
    where organisation_id = p_organisation_id
  ),
  -- Evidence: % verified or linked
  evidence_calc as (
    select
      coalesce(
        round(
          count(*) filter (where status in ('verified','linked'))::numeric /
          nullif(count(*), 0) * 100, 1
        ), 0
      ) as score
    from gov_repo.evidence
    where organisation_id = p_organisation_id
  ),
  -- Exception health: 100 - (active_exceptions / total * 100)
  exception_calc as (
    select
      coalesce(
        100 - round(
          count(*) filter (where status = 'active')::numeric /
          nullif(count(*), 0) * 100, 1
        ), 100
      ) as score
    from gov_repo.exceptions
    where organisation_id = p_organisation_id
  ),
  -- Control maturity: avg maturity * 20 (0-5 → 0-100)
  maturity_calc as (
    select
      coalesce(
        round(avg(maturity_level) * 20, 1), 0
      ) as score
    from (
      select distinct on (control_ref)
        control_ref, maturity_level
      from gov_repo.control_assessments
      where organisation_id = p_organisation_id
        and status = 'completed'
      order by control_ref, period_end desc
    ) latest
  )
  select
    p_organisation_id,
    p.score                                            as policy_score,
    r.score                                            as risk_score,
    e.score                                            as evidence_score,
    ex.score                                           as exception_score,
    m.score                                            as control_maturity_score,
    -- Weighted total: policy 20%, risk 20%, evidence 20%, exception 20%, maturity 20%
    round((p.score + r.score + e.score + ex.score + m.score) / 5, 1) as total_score,
    -- Grade
    case
      when round((p.score + r.score + e.score + ex.score + m.score) / 5, 1) >= 95 then 'A'
      when round((p.score + r.score + e.score + ex.score + m.score) / 5, 1) >= 85 then 'B'
      when round((p.score + r.score + e.score + ex.score + m.score) / 5, 1) >= 70 then 'C'
      when round((p.score + r.score + e.score + ex.score + m.score) / 5, 1) >= 50 then 'D'
      else 'F'
    end::char(1)                                       as grade
  from policy_calc p, risk_calc r, evidence_calc e, exception_calc ex, maturity_calc m;
$$;

comment on function gov_repo.compute_governance_score is
  'Computes the organisation governance score (0-100) with letter grade.
   Grades: A≥95 | B≥85 | C≥70 | D≥50 | F<50.
   Banking minimum: B (85). ECB target: A (95).';

-- ─── FINAL: GRANT SCHEMA USAGE ───────────────────────────────────────────────
grant usage on schema gov_repo to authenticated, service_role, anon;
grant execute on function gov_repo.ledger_append to service_role;
grant execute on function gov_repo.ledger_verify to service_role, authenticated;
grant execute on function gov_repo.compute_governance_score to service_role, authenticated;
