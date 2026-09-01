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

alter table gov_repo.ai_systems
  add column if not exists intended_use_cases text,
  add column if not exists intended_users text,
  add column if not exists intended_deployers text,
  add column if not exists geographic_markets text[],
  add column if not exists architecture_description text,
  add column if not exists training_methodology text,
  add column if not exists training_data_description text,
  add column if not exists validation_methodology text,
  add column if not exists testing_methodology text,
  add column if not exists computational_resources text,
  add column if not exists data_governance_measures text,
  add column if not exists data_residency_policy text,
  add column if not exists monitoring_approach text,
  add column if not exists performance_metrics_def text,
  add column if not exists user_instructions text,
  add column if not exists known_limitations text,
  add column if not exists foreseeable_misuse text,
  add column if not exists harmonised_standards text[],
  add column if not exists common_specifications text[],
  add column if not exists changes_log jsonb not null default '[]',
  add column if not exists technical_doc_evidence_id uuid references gov_repo.evidence(evidence_id),
  add column if not exists technical_doc_version varchar(50),
  add column if not exists technical_doc_last_updated date,
  add column if not exists declaration_of_conformity_id uuid references gov_repo.evidence(evidence_id);

comment on column gov_repo.ai_systems.changes_log is
  'Annex IV §7: Log of significant modifications under Art. 83. Each entry records version, date, description, conformity impact, rationale and approver.';
comment on column gov_repo.ai_systems.known_limitations is
  'Art. 13(3)(b)(iii): Providers must inform deployers of known limitations. Deployers must consider these when implementing human oversight.';

alter table gov_repo.ai_systems
  add column if not exists risk_mgmt_system_desc text,
  add column if not exists risk_mgmt_last_review date,
  add column if not exists risk_mgmt_next_review date,
  add column if not exists residual_risk_level gov_repo.agent_risk_level not null default 'low',
  add column if not exists residual_risk_accepted_by uuid references gov_repo.governance_users(user_id),
  add column if not exists residual_risk_accepted_at timestamptz,
  add column if not exists risk_mgmt_evidence_id uuid references gov_repo.evidence(evidence_id),
  add column if not exists risk_mgmt_policy_id uuid references gov_repo.governance_policies(policy_id),
  add column if not exists fria_conducted boolean not null default false,
  add column if not exists fria_date date,
  add column if not exists fria_evidence_id uuid references gov_repo.evidence(evidence_id),
  add column if not exists fria_outcome_summary text;

comment on column gov_repo.ai_systems.risk_mgmt_system_desc is
  'AI Act Art. 9(1): Risk management system must be a continuous iterative process throughout the lifecycle.';
comment on column gov_repo.ai_systems.fria_conducted is
  'Fundamental Rights Impact Assessment indicator linked to supporting evidence.';

alter table gov_repo.ai_systems
  add column if not exists ce_marking_status gov_repo.ce_marking_status not null default 'not_applicable',
  add column if not exists ce_marking_date date,
  add column if not exists ce_marking_notified_body varchar(255),
  add column if not exists ce_marking_nb_certificate_ref varchar(100),
  add column if not exists conformity_procedure varchar(100),
  add column if not exists conformity_version varchar(50),
  add column if not exists conformity_valid_until date,
  add column if not exists doc_ref varchar(100),
  add column if not exists doc_issued_date date,
  add column if not exists doc_issued_by varchar(255),
  add column if not exists eu_ai_db_submission_date date,
  add column if not exists eu_ai_db_last_updated date,
  add column if not exists eu_ai_db_system_uuid uuid,
  add column if not exists iso_42001_certified boolean not null default false,
  add column if not exists iso_42001_cert_ref varchar(100),
  add column if not exists iso_42001_cert_expires date;

comment on column gov_repo.ai_systems.ce_marking_status is
  'EU AI Act Art. 47 CE marking lifecycle.';
comment on column gov_repo.ai_systems.conformity_procedure is
  'Conformity procedure reference such as Annex VI, Annex VII, or Annex IX.';
comment on column gov_repo.ai_systems.eu_ai_db_system_uuid is
  'UUID assigned by the European AI Database upon registration.';
comment on column gov_repo.ai_systems.doc_ref is
  'Declaration of Conformity reference number per AI Act Art. 47(2).';

alter table gov_repo.ai_systems
  add column if not exists pms_plan_documented boolean not null default false,
  add column if not exists pms_plan_evidence_id uuid references gov_repo.evidence(evidence_id),
  add column if not exists pms_review_frequency gov_repo.review_frequency not null default 'quarterly',
  add column if not exists pms_last_review date,
  add column if not exists pms_next_review date,
  add column if not exists serious_incidents_reported integer not null default 0,
  add column if not exists last_serious_incident_at timestamptz,
  add column if not exists adversarial_testing_completed boolean not null default false,
  add column if not exists adversarial_testing_date date,
  add column if not exists adversarial_testing_evidence_id uuid references gov_repo.evidence(evidence_id);;
