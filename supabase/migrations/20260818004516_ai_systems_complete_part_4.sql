comment on column gov_repo.ai_systems.pms_plan_documented is 'EU AI Act Art. 72(1): Providers of high-risk AI systems must establish and document a post-market surveillance plan before the system is placed on the market.';
comment on column gov_repo.ai_systems.adversarial_testing_completed is 'EU AI Act Art. 55(1)(a): GPAI models with systemic risk must perform adversarial testing including red-teaming.';
alter table gov_repo.ai_systems
 add column if not exists oversight_measures_desc text,
 add column if not exists oversight_person_id uuid references gov_repo.governance_users(user_id),
 add column if not exists override_mechanism_desc text,
 add column if not exists halt_mechanism_desc text,
 add column if not exists transparency_notice_url text,
 add column if not exists transparency_last_updated date,
 add column if not exists instructions_public boolean not null default false;
comment on column gov_repo.ai_systems.override_mechanism_desc is 'Art. 14(4)(d): documentation of how authorised oversight persons can override, disregard, or reverse system outputs.';
comment on column gov_repo.ai_systems.halt_mechanism_desc is 'Art. 14(4)(e): documentation of the mechanism allowing the system to be halted immediately.';
alter table gov_repo.ai_systems
 add column if not exists accuracy_metrics jsonb not null default '{}',
 add column if not exists robustness_measures text,
 add column if not exists cybersecurity_measures text,
 add column if not exists accuracy_threshold_overall numeric(5,4) check(accuracy_threshold_overall between 0 and 1),
 add column if not exists bias_assessment_conducted boolean not null default false,
 add column if not exists bias_assessment_date date,
 add column if not exists bias_assessment_evidence_id uuid references gov_repo.evidence(evidence_id),
 add column if not exists fairness_metrics jsonb not null default '{}';
comment on column gov_repo.ai_systems.accuracy_metrics is 'Art. 15 accuracy metrics and thresholds for technical documentation and monitoring.';
comment on column gov_repo.ai_systems.fairness_metrics is 'Bias and fairness measurements supporting risk and impact assessment.';
alter table gov_repo.ai_systems
 add column if not exists qms_documented boolean not null default false,
 add column if not exists qms_policy_id uuid references gov_repo.governance_policies(policy_id),
 add column if not exists qms_last_review date,
 add column if not exists qms_next_review date,
 add column if not exists qms_standard_ref varchar(100),
 add column if not exists data_mgmt_procedures_id uuid references gov_repo.governance_policies(policy_id);
comment on column gov_repo.ai_systems.qms_documented is 'EU AI Act Art. 17 quality management system documentation indicator.';
alter table gov_repo.ai_systems
 add column if not exists tags jsonb not null default '[]',
 add column if not exists capabilities jsonb not null default '[]',
 add column if not exists external_refs jsonb not null default '{}',
 add column if not exists project_code varchar(100),
 add column if not exists budget_code varchar(100),
 add column if not exists escalation_contact_email varchar(255),
 add column if not exists regulatory_contact_email varchar(255),
 add column if not exists created_by uuid not null references gov_repo.governance_users(user_id);
comment on column gov_repo.ai_systems.external_refs is 'Free-form external reference map for enterprise integrations.';
alter table gov_repo.ai_systems add constraint ai_sys_ce_marking_only_high_risk check(ce_marking_status='not_applicable' or risk_class='high');
alter table gov_repo.ai_systems add constraint ai_sys_exception_requires_rationale check(not annex_iii_exception_claimed or annex_iii_exception_rationale is not null);
alter table gov_repo.ai_systems add constraint ai_sys_conformity_id_required check(lifecycle not in ('conformity_assessed','production') or conformity_assessment_id is not null);
alter table gov_repo.ai_systems add constraint ai_sys_doc_ref_when_marked check(ce_marking_status!='marked' or (doc_ref is not null and doc_issued_date is not null));
alter table gov_repo.ai_systems add constraint ai_sys_residual_risk_acceptance_consistent check((residual_risk_accepted_by is null)=(residual_risk_accepted_at is null));
create index idx_ai_sys_status on gov_repo.ai_systems(status);
create index idx_ai_sys_lifecycle on gov_repo.ai_systems(lifecycle);
create index idx_ai_sys_risk_class on gov_repo.ai_systems(risk_class);
create index idx_ai_sys_owner on gov_repo.ai_systems(owner_user_id);
create index idx_ai_sys_tech_owner on gov_repo.ai_systems(technical_owner_id) where technical_owner_id is not null;
create index idx_ai_sys_ai_officer on gov_repo.ai_systems(ai_officer_id) where ai_officer_id is not null;
create index idx_ai_sys_annex_iii on gov_repo.ai_systems(annex_iii_sector) where annex_iii_sector!='not_annex_iii';
create index idx_ai_sys_gpai on gov_repo.ai_systems(gpai_tier) where gpai_tier!='not_gpai';
create index idx_ai_sys_conformity_id on gov_repo.ai_systems(conformity_assessment_id) where conformity_assessment_id is not null;
create index idx_ai_sys_ce_marking on gov_repo.ai_systems(ce_marking_status) where ce_marking_status!='not_applicable';
create index idx_ai_sys_eu_db_gap on gov_repo.ai_systems(organisation_id) where eu_ai_db_registered=false and risk_class='high' and lifecycle in ('production','conformity_assessed');
create index idx_ai_sys_pms_overdue on gov_repo.ai_systems(pms_next_review) where pms_plan_documented=true and status='production';
create index idx_ai_sys_compliance_gaps on gov_repo.ai_systems(organisation_id,risk_class) where risk_class='high' and (cg_sys_004_tech_doc=false or cg_sys_005_risk_mgmt=false or cg_sys_007_conformity=false);;
