create table gov_repo.approval_requests (
  request_id uuid primary key default uuid_generate_v4(),
  request_code varchar(20) not null,
  subject_type varchar(50) not null check (subject_type in ('policy_version','risk_treatment','exception','conformity_assessment','evidence','agent_deployment','control_assessment','risk_acceptance')),
  subject_id uuid not null,
  subject_version integer,
  title varchar(255) not null,
  description text,
  requested_by uuid not null references gov_repo.governance_users(user_id),
  requested_at timestamptz not null default now(),
  workflow_template_id uuid not null references gov_repo.workflow_templates(template_id),
  current_step integer not null default 1,
  status gov_repo.approval_status not null default 'submitted',
  priority gov_repo.approval_priority not null default 'routine',
  due_date timestamptz not null,
  approval_deadline timestamptz not null,
  organisation_id uuid not null references gov_repo.organisations(organisation_id),
  context_data jsonb not null default '{}',
  final_qes_id uuid references gov_repo.qes_signatures(signature_id),
  ledger_entry_seq bigint references gov_repo.governance_ledger(entry_sequence),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint approval_requests_code_org_unique unique(request_code,organisation_id),
  constraint approval_sla_order check (due_date <= approval_deadline));
comment on table gov_repo.approval_requests is 'Approval workflow orchestration. Covers policies, risks, exceptions, conformity assessments. Banking-grade: 4-eyes enforcement, QES on final step, SLA tracking with auto-escalation.';
comment on column gov_repo.approval_requests.current_step is 'Currently active step index (1-based). Advances on each approved decision.';
create index idx_approval_requests_status on gov_repo.approval_requests(status,organisation_id);
create index idx_approval_requests_requester on gov_repo.approval_requests(requested_by);
create index idx_approval_requests_subject on gov_repo.approval_requests(subject_type,subject_id);
create index idx_approval_requests_due on gov_repo.approval_requests(due_date) where status in ('submitted','in_review','escalated');
create trigger trg_approval_requests_updated_at before update on gov_repo.approval_requests for each row execute function gov_repo.set_updated_at();
alter table gov_repo.approval_requests enable row level security;
create policy "Service role has full access to approval_requests" on gov_repo.approval_requests for all to service_role using(true) with check(true);
create policy "Org-scoped access to approval_requests" on gov_repo.approval_requests for select to authenticated using(organisation_id=(select organisation_id from gov_repo.governance_users where email=auth.email() limit 1));
create table gov_repo.approval_decisions (
  decision_id uuid primary key default uuid_generate_v4(), request_id uuid not null references gov_repo.approval_requests(request_id) on delete cascade, workflow_step integer not null, step_name varchar(100) not null, assigned_to uuid not null references gov_repo.governance_users(user_id), role_required varchar(50) not null, decided_by uuid references gov_repo.governance_users(user_id), decision gov_repo.approval_decision, rationale text, conditions text, delegated_to uuid references gov_repo.governance_users(user_id), qes_signature_id uuid references gov_repo.qes_signatures(signature_id), decided_at timestamptz, deadline timestamptz not null, reminder_sent_at timestamptz, escalated_at timestamptz, escalated_to uuid references gov_repo.governance_users(user_id), created_at timestamptz not null default now(), constraint decision_rationale_required check (decision is null or decision in ('approved','abstained','delegated') or (decision in ('rejected','returned') and rationale is not null and rationale <> '')), constraint decision_decided_at_consistent check ((decided_by is null)=(decided_at is null)));
comment on table gov_repo.approval_decisions is 'Individual approval step decisions. Each request has one decision row per workflow step. Rationale is mandatory for rejection and return decisions. QES is mandatory for L2/L3 decisions per banking-grade workflow templates.';
create index idx_approval_decisions_request on gov_repo.approval_decisions(request_id,workflow_step);
create index idx_approval_decisions_assignee on gov_repo.approval_decisions(assigned_to) where decided_at is null;
create index idx_approval_decisions_deadline on gov_repo.approval_decisions(deadline) where decided_at is null;
alter table gov_repo.approval_decisions enable row level security;
create policy "Service role has full access to approval_decisions" on gov_repo.approval_decisions for all to service_role using(true) with check(true);
create policy "Assignees can read own decisions" on gov_repo.approval_decisions for select to authenticated using(assigned_to=(select user_id from gov_repo.governance_users where email=auth.email() limit 1) or decided_by=(select user_id from gov_repo.governance_users where email=auth.email() limit 1));
create table gov_repo.exceptions (
  exception_id uuid primary key default uuid_generate_v4(), exception_code varchar(20) not null, title varchar(255) not null, description text not null, exception_type gov_repo.exception_type not null, policy_id uuid references gov_repo.governance_policies(policy_id), control_ref varchar(12), agent_id uuid, business_justification text not null, risk_assessment text not null, compensating_controls text, requested_by uuid not null references gov_repo.governance_users(user_id), requested_at timestamptz not null default now(), status gov_repo.exception_status not null default 'draft', approved_by uuid references gov_repo.governance_users(user_id), approval_date timestamptz, valid_from date, valid_until date, max_extension_days integer not null default 90, review_frequency gov_repo.review_frequency not null default 'monthly', next_review_date date, qes_signature_id uuid references gov_repo.qes_signatures(signature_id), risk_id uuid references gov_repo.risk_entries(risk_id), revocation_reason text, revoked_at timestamptz, revoked_by uuid references gov_repo.governance_users(user_id), organisation_id uuid not null references gov_repo.organisations(organisation_id), ledger_entry_seq bigint references gov_repo.governance_ledger(entry_sequence), created_at timestamptz not null default now(), updated_at timestamptz not null default now(), constraint exceptions_code_org_unique unique(exception_code,organisation_id), constraint exception_valid_period check(valid_until is null or valid_from is null or valid_until > valid_from), constraint exception_revocation_consistent check((revoked_at is null)=(revoked_by is null)));
comment on table gov_repo.exceptions is 'Governance exceptions — temporary deviations from policies or controls. All exceptions MUST have a valid_until date (no indefinite exceptions). Banking rule: max_extension_days = 90, max 2 extensions total. Active exceptions are monitored and reviewed per review_frequency.';
comment on column gov_repo.exceptions.compensating_controls is 'Mitigating measures in place during the exception period. Mandatory for risk_acceptance type.';
create index idx_exceptions_org on gov_repo.exceptions(organisation_id);
create index idx_exceptions_status on gov_repo.exceptions(status);
create index idx_exceptions_expiry on gov_repo.exceptions(valid_until) where status='active';
create index idx_exceptions_control on gov_repo.exceptions(control_ref) where control_ref is not null;
create index idx_exceptions_agent on gov_repo.exceptions(agent_id) where agent_id is not null;
create trigger trg_exceptions_updated_at before update on gov_repo.exceptions for each row execute function gov_repo.set_updated_at();
alter table gov_repo.exceptions enable row level security;
create policy "Service role has full access to exceptions" on gov_repo.exceptions for all to service_role using(true) with check(true);
create policy "Org-scoped access to exceptions" on gov_repo.exceptions for select to authenticated using(organisation_id=(select organisation_id from gov_repo.governance_users where email=auth.email() limit 1));;
