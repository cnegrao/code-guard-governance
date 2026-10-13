-- M17-S1: RISK_SIGNAL + RISK_HYPOTHESIS non-authoritative stores, the L15 support / evidence union (D-03) and bounded intake.
-- Architecture (ACCEPTED / FROZEN, not modified): docs/architecture/ADR-GOVIA-RISK-INTELLIGENCE-v1.md §§4, 5, 8.3, 9, 12.1,
-- 12.4, 17, 24, 26 (O08-O18, O79-O82, O84); docs/architecture/ADR-GOVIA-M16-AUTHORITY-POLICY-M17-EXTENSION-v1.md (D-01,
-- unchanged here). Additive only. No historical migration is edited. Never run against a hosted DB from this slice.
--
-- Meaning:
--   * RISK_SIGNAL is an immutable, tenant-scoped, evidence-backed REFERENCE record that a detector, source or verified human
--     observed something potentially risk-relevant about an exact subject. It is NOT governed risk, NOT a governance decision,
--     NOT a canonical object, NOT an L14 fact, NOT VALIDATED; it has no lifecycle, no state, no head, no status column. It
--     copies no upstream value (no runtime latency / error / token / cost, no M15 outcome, no M16 fact content): it carries
--     only provenance (source class, method + version, trust where the source class has one), optional `hint_*` source labels
--     that no authority / rating / lifecycle logic reads, and exact typed support references (l15_support_links).
--   * RISK_HYPOTHESIS is an immutable analytical interpretation that >= 1 exact same-tenant signals MAY represent a risk on an
--     exact subject. Machine generators carry INFERRED trust; HUMAN carries none. Never VALIDATED. Never promoted by
--     confidence, count, recency, generator kind or agreement; contradictory hypotheses coexist.
--   * The optional §5.1 `proposed_scenario_definition_id` is DEFERRED to S2: no RISK_SCENARIO_DEFINITION registry exists and
--     none is created here, so no column exists yet (absent = "unclassified"). S2 adds it additively as a nullable column with
--     the exact typed validated-version FK; no fake table, label registry or free-text scenario is created.
--   * l15_support_links is the L15-specific closed tagged union of §9.1 (D-03) with one composite same-tenant FK per tag, and
--     the acyclic §9.2 owner -> target matrix for the two S1 owners (RISK_SIGNAL rank 1 -> rank-0 evidence; RISK_HYPOTHESIS
--     rank 2 -> RISK_SIGNAL). gov_repo.l14_support_links is neither reused nor widened. Rank-3 owners (S2-S6 governed
--     artifacts) are added additively by their slices; no future business store is created here.
--   * Subjects: exact canonical object (organisation + canonical_object_id + kind, composite FK onto canonical_objects),
--     exact relationship state (organisation + relationship_id + relationship_state_id, resolved by the EXISTING M16 exact
--     triple resolver l14_resolve_relationship_state_target_v1 — never a bare state id; F2 untouched: no FK / trigger / index /
--     uniqueness on canonical_relationships), or UNRESOLVED with the closed reason vocabulary reused verbatim from the L12
--     runtime binding contract (MISSING_REVISION_EVIDENCE, NO_EXACT_MAPPING, AMBIGUOUS_MAPPING, UNSUPPORTED_BINDING_PROOF).
--     No inheritance: the subject is exactly what is stored.
--   * Admission is TECHNICAL CAPABILITY ONLY. Machine sources: the NOLOGIN capability role govia_l15_machine_intake_caller
--     (granted to a technical LOGIN out of band, never service_role); it can EXECUTE exactly the two machine intake RPCs.
--     LOCAL_HUMAN / HUMAN: a verified ACTIVE same-tenant member through the existing M16-S0 eligibility helper (service_role
--     RPC, as every M16 RPC). Admission creates no L14 authorization decision, governance decision, proposal, command
--     result, fact / registry state or head, and never synthesizes or requires an L15 permission.
--   * Replay: identity organisation + intake_key; PostgreSQL computes the semantic fingerprint; identical content returns the
--     original id and recorded_at; changed content -> L15_REPLAY_CONFLICT. recorded_at is DB-authored (transaction instant);
--     observed_at is never defaulted and is accepted only when supported by evidence and not after recorded_at.
--
-- Sections: A preflight; B capability role; C tables; D guards; E owner-only helpers; F intake RPCs (SECURITY DEFINER);
-- G read projections (SECURITY DEFINER); H privileges + comments; I postflight.
BEGIN;

-- ---------------------------------------------------------------------------------------------------------------------
-- A. Preflight: exactly the post-M17-S0 catalog, or abort with nothing applied.
-- ---------------------------------------------------------------------------------------------------------------------
DO $preflight$
BEGIN
  IF pg_catalog.current_setting('server_version_num')::integer < 170000 OR current_user <> 'postgres'
     OR pg_catalog.current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'M17_S1_PREFLIGHT: PostgreSQL 17 / postgres / READ COMMITTED required' USING ERRCODE = '55000';
  END IF;
  IF pg_catalog.to_regprocedure('gov_repo.l15_governance_permission_v1(text,text)') IS NULL
     OR pg_catalog.to_regprocedure('gov_repo.l14_resolve_relationship_state_target_v1(uuid,text,text)') IS NULL
     OR pg_catalog.to_regprocedure('gov_repo.lock_and_resolve_governance_session_eligibility_v1(uuid,uuid,bigint,bigint,timestamp with time zone)') IS NULL
     OR pg_catalog.to_regprocedure('gov_repo.l14_responsibility_assignments_current_v1(uuid,text,text,timestamp with time zone,timestamp with time zone)') IS NULL
     OR pg_catalog.to_regprocedure('gov_repo.l14_business_context_assignments_current_v1(uuid,text,text,timestamp with time zone,timestamp with time zone)') IS NULL
     OR pg_catalog.to_regprocedure('gov_repo.l14_control_applicabilities_current_v1(uuid,text,text,text,text,text,timestamp with time zone,timestamp with time zone)') IS NULL
     OR pg_catalog.to_regprocedure('gov_repo.l14_control_assessments_current_v1(uuid,text,text,text,text,text,timestamp with time zone,timestamp with time zone)') IS NULL THEN
    RAISE EXCEPTION 'M17_S1_PREFLIGHT: M17-S0 / M16 read surface missing' USING ERRCODE = '55000';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_class AS c WHERE c.relnamespace = 'gov_repo'::regnamespace
               AND c.relname LIKE 'l15\_%' ESCAPE '\' AND c.relkind IN ('r','p','v','m','S','f'))
     OR (SELECT pg_catalog.array_agg(p.proname::text ORDER BY p.proname::text COLLATE "C") FROM pg_catalog.pg_proc AS p
         WHERE p.pronamespace = 'gov_repo'::regnamespace AND p.proname LIKE 'l15\_%' ESCAPE '\')
        IS DISTINCT FROM ARRAY['l15_authority_policy_rule_admission_basis_guard_v1','l15_authorization_allow_guard_v1',
                               'l15_decision_rule_isolation_guard_v1','l15_governance_permission_v1']
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_roles AS r WHERE r.rolname = 'govia_l15_machine_intake_caller') THEN
    RAISE EXCEPTION 'M17_S1_PREFLIGHT: an M17-S1 object already exists (post-S0 catalog expected)' USING ERRCODE = '55000';
  END IF;
  IF (SELECT pg_catalog.count(*) FROM pg_catalog.pg_proc AS p
       WHERE p.prosecdef AND p.pronamespace NOT IN ('pg_catalog'::regnamespace, 'information_schema'::regnamespace)
         AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_depend AS d
                          WHERE d.classid = 'pg_catalog.pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e')
         AND (pg_catalog.has_function_privilege('service_role', p.oid, 'EXECUTE')
              OR pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE')
              OR pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE')
              OR EXISTS (SELECT 1 FROM pg_catalog.aclexplode(COALESCE(p.proacl, pg_catalog.acldefault('f', p.proowner))) AS a
                          WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE'))) <> 45 THEN
    RAISE EXCEPTION 'M17_S1_PREFLIGHT: application SECURITY DEFINER surface is not the 45 post-S0 baseline' USING ERRCODE = '55000';
  END IF;
  IF (SELECT pg_catalog.pg_get_constraintdef(k.oid) FROM pg_catalog.pg_constraint AS k
      WHERE k.conrelid = 'gov_repo.cross_signal_comparison_results'::regclass AND k.conname = 'cross_signal_outcome_check')
     IS DISTINCT FROM 'CHECK ((outcome = ANY (ARRAY[''CONSISTENT''::text, ''CONFLICT_CANDIDATE''::text, ''INSUFFICIENT_EVIDENCE''::text])))'
     OR (SELECT pg_catalog.pg_get_constraintdef(k.oid) FROM pg_catalog.pg_constraint AS k
         WHERE k.conrelid = 'gov_repo.l14_control_assessment_states'::regclass AND k.conname = 'l14_control_assessment_states_assessment_outcome_check')
     IS DISTINCT FROM 'CHECK ((assessment_outcome = ANY (ARRAY[''SATISFIED''::text, ''PARTIALLY_SATISFIED''::text, ''NOT_SATISFIED''::text, ''NOT_ASSESSED''::text, ''INSUFFICIENT_EVIDENCE''::text])))'
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint AS k WHERE k.conrelid = 'gov_repo.l14_fact_states'::regclass
                      AND k.contype = 'u' AND pg_catalog.pg_get_constraintdef(k.oid) = 'UNIQUE (organisation_id, fact_state_id, subject_kind)')
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint AS k WHERE k.conrelid = 'gov_repo.canonical_objects'::regclass
                      AND k.contype = 'u' AND pg_catalog.pg_get_constraintdef(k.oid) = 'UNIQUE (organisation_id, canonical_object_id, kind)')
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint AS k WHERE k.conrelid = 'gov_repo.lineage_candidate_observations'::regclass
                      AND k.contype = 'u' AND pg_catalog.pg_get_constraintdef(k.oid) = 'UNIQUE (organisation_id, observation_finding_id)')
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint AS k WHERE k.conrelid = 'gov_repo.governance_users'::regclass
                      AND k.contype = 'u' AND pg_catalog.pg_get_constraintdef(k.oid) = 'UNIQUE (organisation_id, user_id)') THEN
    RAISE EXCEPTION 'M17_S1_PREFLIGHT: an upstream target key / vocabulary differs from the inspected catalog' USING ERRCODE = '55000';
  END IF;
END;
$preflight$;

-- Snapshot of every pre-existing gov_repo constraint and non-internal trigger: the postflight proves S1 changed none of them
-- (M16 / M15 / L11 / L12 / canonical / F2 history and shape untouched; FKs are owned by the new L15 tables only).
CREATE TEMPORARY TABLE m17_s1_constraint_snapshot ON COMMIT DROP AS
  SELECT k.conrelid::regclass::text AS rel, k.conname::text AS conname, pg_catalog.pg_get_constraintdef(k.oid) AS def
  FROM pg_catalog.pg_constraint AS k JOIN pg_catalog.pg_class AS c ON c.oid = k.conrelid
  WHERE c.relnamespace = 'gov_repo'::regnamespace;
CREATE TEMPORARY TABLE m17_s1_trigger_snapshot ON COMMIT DROP AS
  SELECT t.tgrelid::regclass::text AS rel, t.tgname::text AS tgname, t.tgenabled::text AS enabled, t.tgfoid::regprocedure::text AS fn
  FROM pg_catalog.pg_trigger AS t JOIN pg_catalog.pg_class AS c ON c.oid = t.tgrelid
  WHERE c.relnamespace = 'gov_repo'::regnamespace AND NOT t.tgisinternal;

-- ---------------------------------------------------------------------------------------------------------------------
-- B. Technical intake capability (NOT authority). NOLOGIN; a DBA grants it to a technical LOGIN out of band. It holds no
--    table privilege and EXECUTE on exactly the two machine intake RPCs (H). It can never call an L14 / L15 propose / decide
--    / admit-registry RPC, and it is not service_role (the M16 human-principal executor).
-- ---------------------------------------------------------------------------------------------------------------------
CREATE ROLE govia_l15_machine_intake_caller NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT;
GRANT USAGE ON SCHEMA gov_repo TO govia_l15_machine_intake_caller;

-- ---------------------------------------------------------------------------------------------------------------------
-- C. Tables (insert-only history; no status, no lifecycle, no head).
-- ---------------------------------------------------------------------------------------------------------------------
CREATE TABLE gov_repo.l15_risk_signals (
  organisation_id uuid NOT NULL REFERENCES gov_repo.organisations(organisation_id),
  signal_id uuid NOT NULL,
  intake_key text NOT NULL CHECK (intake_key COLLATE "C" ~ '^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,199}$'),
  semantic_fingerprint text NOT NULL CHECK (semantic_fingerprint COLLATE "C" ~ '^[0-9a-f]{64}$'),
  signal_kind text NOT NULL CHECK (signal_kind IN ('DETECTED_PATTERN','DETECTED_ABSENCE','RUNTIME_OBSERVATION_REF',
    'CROSS_SIGNAL_RESULT_REF','EXECUTION_CONTEXT_REF','CONTROL_ASSESSMENT_REF','GOVERNANCE_GAP_REF','LINEAGE_REF',
    'IMPORTED_ASSERTION','HUMAN_OBSERVATION')),
  source_class text NOT NULL CHECK (source_class IN ('SYSTEM_DETECTOR','SOURCE_CONNECTION','RUNTIME_SOURCE',
    'GOVERNED_FACT_REFERENCE','LOCAL_HUMAN')),
  subject_mode text NOT NULL CHECK (subject_mode IN ('CANONICAL_OBJECT','RELATIONSHIP_STATE','UNRESOLVED')),
  subject_canonical_kind text CHECK (subject_canonical_kind IN ('AGENT','AGENT_VERSION','MODEL','TOOL','MCP_SERVER','API',
    'PROMPT','KNOWLEDGE_BASE','DATA_ASSET','DATA_ELEMENT','SKILL')),
  subject_canonical_object_id text CHECK (pg_catalog.length(subject_canonical_object_id) BETWEEN 1 AND 500
    AND subject_canonical_object_id = pg_catalog.btrim(subject_canonical_object_id)),
  subject_relationship_id text CHECK (pg_catalog.length(subject_relationship_id) BETWEEN 1 AND 500
    AND subject_relationship_id = pg_catalog.btrim(subject_relationship_id)),
  subject_relationship_state_id text CHECK (pg_catalog.length(subject_relationship_state_id) BETWEEN 1 AND 500
    AND subject_relationship_state_id = pg_catalog.btrim(subject_relationship_state_id)),
  unresolved_reason text CHECK (unresolved_reason IN ('MISSING_REVISION_EVIDENCE','NO_EXACT_MAPPING','AMBIGUOUS_MAPPING',
    'UNSUPPORTED_BINDING_PROOF')),
  trust_state text CHECK (trust_state IN ('INFERRED','DECLARED','IMPORTED','OBSERVED')),
  method_id text CHECK (method_id COLLATE "C" ~ '^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,199}$'),
  method_version text CHECK (method_version COLLATE "C" ~ '^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$'),
  hint_severity text CHECK (hint_severity IN ('critical','high','medium','low','info')),
  hint_confidence numeric CHECK (hint_confidence >= 0 AND hint_confidence <= 1),
  observed_at timestamptz,
  support_status text NOT NULL CHECK (support_status IN ('NONE','PRESENT')),
  gap_fact_family text CHECK (gap_fact_family IN ('RESPONSIBILITY_ASSIGNMENT','BUSINESS_CONTEXT_ASSIGNMENT','CONTROL_ASSESSMENT')),
  gap_responsibility_role text CHECK (gap_responsibility_role IN ('BUSINESS_OWNER','TECHNICAL_OWNER','DATA_OWNER','DATA_STEWARD')),
  gap_semantic_kind text CHECK (gap_semantic_kind IN ('BUSINESS_DOMAIN','INFORMATION_DOMAIN')),
  gap_control_definition_id uuid,
  gap_effective_at timestamptz,
  gap_recorded_cutoff timestamptz,
  submitted_by_user_id uuid,
  admitted_by_technical_identity text CHECK (pg_catalog.length(admitted_by_technical_identity) BETWEEN 1 AND 63),
  recorded_at timestamptz NOT NULL,
  CONSTRAINT l15_risk_signals_pkey PRIMARY KEY (organisation_id, signal_id),
  CONSTRAINT l15_risk_signals_signal_id_unique UNIQUE (signal_id),
  CONSTRAINT l15_risk_signals_intake_key_unique UNIQUE (organisation_id, intake_key),
  CONSTRAINT l15_risk_signals_kind_unique UNIQUE (organisation_id, signal_id, signal_kind),
  -- §4.3: each kind has exactly one admissible source class.
  CONSTRAINT l15_risk_signals_kind_source_check CHECK (
    (signal_kind IN ('DETECTED_PATTERN','DETECTED_ABSENCE') AND source_class = 'SYSTEM_DETECTOR')
    OR (signal_kind = 'RUNTIME_OBSERVATION_REF' AND source_class = 'RUNTIME_SOURCE')
    OR (signal_kind IN ('CROSS_SIGNAL_RESULT_REF','EXECUTION_CONTEXT_REF','CONTROL_ASSESSMENT_REF','GOVERNANCE_GAP_REF',
                        'LINEAGE_REF') AND source_class = 'GOVERNED_FACT_REFERENCE')
    OR (signal_kind = 'IMPORTED_ASSERTION' AND source_class = 'SOURCE_CONNECTION')
    OR (signal_kind = 'HUMAN_OBSERVATION' AND source_class = 'LOCAL_HUMAN')),
  CONSTRAINT l15_risk_signals_subject_shape_check CHECK (
    (subject_mode = 'CANONICAL_OBJECT' AND subject_canonical_kind IS NOT NULL AND subject_canonical_object_id IS NOT NULL
      AND subject_relationship_id IS NULL AND subject_relationship_state_id IS NULL AND unresolved_reason IS NULL)
    OR (subject_mode = 'RELATIONSHIP_STATE' AND subject_canonical_kind IS NULL AND subject_canonical_object_id IS NULL
      AND subject_relationship_id IS NOT NULL AND subject_relationship_state_id IS NOT NULL AND unresolved_reason IS NULL)
    OR (subject_mode = 'UNRESOLVED' AND subject_canonical_kind IS NULL AND subject_canonical_object_id IS NULL
      AND subject_relationship_id IS NULL AND subject_relationship_state_id IS NULL AND unresolved_reason IS NOT NULL)),
  CONSTRAINT l15_risk_signals_subject_object_fkey FOREIGN KEY (organisation_id, subject_canonical_object_id, subject_canonical_kind)
    REFERENCES gov_repo.canonical_objects(organisation_id, canonical_object_id, kind) ON UPDATE RESTRICT ON DELETE RESTRICT,
  -- M16 §8 origin rules; never VALIDATED; GOVERNED_FACT_REFERENCE and LOCAL_HUMAN own no trust (absent, not a sixth value).
  CONSTRAINT l15_risk_signals_trust_source_check CHECK (
    (source_class = 'SYSTEM_DETECTOR' AND trust_state IN ('INFERRED','DECLARED'))
    OR (source_class = 'SOURCE_CONNECTION' AND trust_state = 'IMPORTED')
    OR (source_class = 'RUNTIME_SOURCE' AND trust_state = 'OBSERVED')
    OR (source_class IN ('GOVERNED_FACT_REFERENCE','LOCAL_HUMAN') AND trust_state IS NULL)),
  -- An unversioned detector cannot persist a signal; a human observation carries no method.
  CONSTRAINT l15_risk_signals_method_check CHECK (
    (source_class = 'LOCAL_HUMAN' AND method_id IS NULL AND method_version IS NULL)
    OR (source_class <> 'LOCAL_HUMAN' AND method_id IS NOT NULL AND method_version IS NOT NULL)),
  -- hint_* are non-authoritative source labels of detectors / imported sources only.
  CONSTRAINT l15_risk_signals_hint_check CHECK (
    source_class IN ('SYSTEM_DETECTOR','SOURCE_CONNECTION') OR (hint_severity IS NULL AND hint_confidence IS NULL)),
  -- Every non-human signal is evidence-backed; a human may record zero support only as an explicit NONE.
  CONSTRAINT l15_risk_signals_support_check CHECK (source_class = 'LOCAL_HUMAN' OR support_status = 'PRESENT'),
  -- A source observation time exists only when evidenced and never after the DB-authored recording time.
  CONSTRAINT l15_risk_signals_observed_at_check CHECK (
    observed_at IS NULL OR (support_status = 'PRESENT' AND observed_at <= recorded_at)),
  CONSTRAINT l15_risk_signals_provenance_check CHECK (
    (source_class = 'LOCAL_HUMAN' AND submitted_by_user_id IS NOT NULL AND admitted_by_technical_identity IS NULL)
    OR (source_class <> 'LOCAL_HUMAN' AND submitted_by_user_id IS NULL AND admitted_by_technical_identity IS NOT NULL)),
  CONSTRAINT l15_risk_signals_submitter_fkey FOREIGN KEY (organisation_id, submitted_by_user_id)
    REFERENCES gov_repo.governance_users(organisation_id, user_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  -- GOVERNANCE_GAP_REF: the exact M16 read coordinates (DB-authored = recorded_at) and the closed gap query. UNKNOWN != FALSE:
  -- the record states that the read returned no current fact, never a negative fact.
  CONSTRAINT l15_risk_signals_gap_shape_check CHECK (
    (signal_kind <> 'GOVERNANCE_GAP_REF' AND gap_fact_family IS NULL AND gap_responsibility_role IS NULL
      AND gap_semantic_kind IS NULL AND gap_control_definition_id IS NULL AND gap_effective_at IS NULL
      AND gap_recorded_cutoff IS NULL)
    OR (signal_kind = 'GOVERNANCE_GAP_REF' AND subject_mode <> 'UNRESOLVED'
      AND gap_effective_at = recorded_at AND gap_recorded_cutoff = recorded_at
      AND ((gap_fact_family = 'RESPONSIBILITY_ASSIGNMENT' AND subject_mode = 'CANONICAL_OBJECT'
            AND gap_semantic_kind IS NULL AND gap_control_definition_id IS NULL
            AND ((subject_canonical_kind = 'AGENT' AND gap_responsibility_role IN ('BUSINESS_OWNER','TECHNICAL_OWNER'))
              OR (subject_canonical_kind IN ('DATA_ASSET','DATA_ELEMENT') AND gap_responsibility_role IN ('DATA_OWNER','DATA_STEWARD'))))
        OR (gap_fact_family = 'BUSINESS_CONTEXT_ASSIGNMENT' AND subject_mode = 'CANONICAL_OBJECT'
            AND gap_responsibility_role IS NULL AND gap_control_definition_id IS NULL
            AND ((subject_canonical_kind = 'AGENT' AND gap_semantic_kind = 'BUSINESS_DOMAIN')
              OR (subject_canonical_kind = 'DATA_ASSET' AND gap_semantic_kind IN ('BUSINESS_DOMAIN','INFORMATION_DOMAIN'))
              OR (subject_canonical_kind = 'DATA_ELEMENT' AND gap_semantic_kind = 'INFORMATION_DOMAIN')))
        OR (gap_fact_family = 'CONTROL_ASSESSMENT' AND gap_control_definition_id IS NOT NULL
            AND gap_responsibility_role IS NULL AND gap_semantic_kind IS NULL))))
);

CREATE TABLE gov_repo.l15_risk_hypotheses (
  organisation_id uuid NOT NULL REFERENCES gov_repo.organisations(organisation_id),
  hypothesis_id uuid NOT NULL,
  intake_key text NOT NULL CHECK (intake_key COLLATE "C" ~ '^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,199}$'),
  semantic_fingerprint text NOT NULL CHECK (semantic_fingerprint COLLATE "C" ~ '^[0-9a-f]{64}$'),
  generator_kind text NOT NULL CHECK (generator_kind IN ('DETERMINISTIC_RULE','GRAPH_ANALYSIS','VECTOR_RETRIEVAL',
    'LLM_ASSISTED','HUMAN')),
  -- UNRESOLVED is not a legal hypothesis subject.
  subject_mode text NOT NULL CHECK (subject_mode IN ('CANONICAL_OBJECT','RELATIONSHIP_STATE')),
  subject_canonical_kind text CHECK (subject_canonical_kind IN ('AGENT','AGENT_VERSION','MODEL','TOOL','MCP_SERVER','API',
    'PROMPT','KNOWLEDGE_BASE','DATA_ASSET','DATA_ELEMENT','SKILL')),
  subject_canonical_object_id text CHECK (pg_catalog.length(subject_canonical_object_id) BETWEEN 1 AND 500
    AND subject_canonical_object_id = pg_catalog.btrim(subject_canonical_object_id)),
  subject_relationship_id text CHECK (pg_catalog.length(subject_relationship_id) BETWEEN 1 AND 500
    AND subject_relationship_id = pg_catalog.btrim(subject_relationship_id)),
  subject_relationship_state_id text CHECK (pg_catalog.length(subject_relationship_state_id) BETWEEN 1 AND 500
    AND subject_relationship_state_id = pg_catalog.btrim(subject_relationship_state_id)),
  method_id text CHECK (method_id COLLATE "C" ~ '^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,199}$'),
  method_version text CHECK (method_version COLLATE "C" ~ '^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$'),
  model_provider text CHECK (model_provider COLLATE "C" ~ '^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,99}$'),
  model_id text CHECK (model_id COLLATE "C" ~ '^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,199}$'),
  prompt_template_version text CHECK (prompt_template_version COLLATE "C" ~ '^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,99}$'),
  traversal_policy_version text CHECK (traversal_policy_version COLLATE "C" ~ '^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,99}$'),
  representation_version text CHECK (representation_version COLLATE "C" ~ '^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,199}$'),
  trust_state text CHECK (trust_state = 'INFERRED'),
  hint_confidence numeric CHECK (hint_confidence >= 0 AND hint_confidence <= 1),
  submitted_by_user_id uuid,
  admitted_by_technical_identity text CHECK (pg_catalog.length(admitted_by_technical_identity) BETWEEN 1 AND 63),
  recorded_at timestamptz NOT NULL,
  CONSTRAINT l15_risk_hypotheses_pkey PRIMARY KEY (organisation_id, hypothesis_id),
  CONSTRAINT l15_risk_hypotheses_hypothesis_id_unique UNIQUE (hypothesis_id),
  CONSTRAINT l15_risk_hypotheses_intake_key_unique UNIQUE (organisation_id, intake_key),
  CONSTRAINT l15_risk_hypotheses_subject_shape_check CHECK (
    (subject_mode = 'CANONICAL_OBJECT' AND subject_canonical_kind IS NOT NULL AND subject_canonical_object_id IS NOT NULL
      AND subject_relationship_id IS NULL AND subject_relationship_state_id IS NULL)
    OR (subject_mode = 'RELATIONSHIP_STATE' AND subject_canonical_kind IS NULL AND subject_canonical_object_id IS NULL
      AND subject_relationship_id IS NOT NULL AND subject_relationship_state_id IS NOT NULL)),
  CONSTRAINT l15_risk_hypotheses_subject_object_fkey FOREIGN KEY (organisation_id, subject_canonical_object_id, subject_canonical_kind)
    REFERENCES gov_repo.canonical_objects(organisation_id, canonical_object_id, kind) ON UPDATE RESTRICT ON DELETE RESTRICT,
  -- §5.1 provenance per generator: method + version for every machine generator; the exact LLM tuple; the graph traversal
  -- policy version; the vector representation / embedding version. HUMAN carries none.
  CONSTRAINT l15_risk_hypotheses_provenance_check CHECK (
    (generator_kind = 'HUMAN' AND method_id IS NULL AND method_version IS NULL AND model_provider IS NULL AND model_id IS NULL
      AND prompt_template_version IS NULL AND traversal_policy_version IS NULL AND representation_version IS NULL)
    OR (generator_kind <> 'HUMAN' AND method_id IS NOT NULL AND method_version IS NOT NULL
      AND ((generator_kind = 'LLM_ASSISTED') = (model_provider IS NOT NULL))
      AND (model_provider IS NULL) = (model_id IS NULL) AND (model_provider IS NULL) = (prompt_template_version IS NULL)
      AND ((generator_kind = 'GRAPH_ANALYSIS') = (traversal_policy_version IS NOT NULL))
      AND ((generator_kind = 'VECTOR_RETRIEVAL') = (representation_version IS NOT NULL)))),
  CONSTRAINT l15_risk_hypotheses_trust_check CHECK ((generator_kind = 'HUMAN') = (trust_state IS NULL)),
  CONSTRAINT l15_risk_hypotheses_submitter_check CHECK (
    (generator_kind = 'HUMAN' AND submitted_by_user_id IS NOT NULL AND admitted_by_technical_identity IS NULL)
    OR (generator_kind <> 'HUMAN' AND submitted_by_user_id IS NULL AND admitted_by_technical_identity IS NOT NULL)),
  CONSTRAINT l15_risk_hypotheses_submitter_fkey FOREIGN KEY (organisation_id, submitted_by_user_id)
    REFERENCES gov_repo.governance_users(organisation_id, user_id) ON UPDATE RESTRICT ON DELETE RESTRICT
);

CREATE TABLE gov_repo.l15_support_links (
  organisation_id uuid NOT NULL REFERENCES gov_repo.organisations(organisation_id),
  link_id uuid NOT NULL,
  owner_kind text NOT NULL CHECK (owner_kind IN ('RISK_SIGNAL','RISK_HYPOTHESIS')),
  owner_signal_id uuid,
  owner_signal_kind text,
  owner_hypothesis_id uuid,
  target_tag text NOT NULL CHECK (target_tag IN ('DISCOVERY_EVIDENCE','SOURCE_ASSERTION','RUNTIME_OBSERVATION',
    'CROSS_SIGNAL_RESULT','EXECUTION_FIELD_STATE','TECHNICAL_FIELD_STATE','LINEAGE_OBSERVATION','L14_FACT_STATE',
    'RISK_SIGNAL','RISK_HYPOTHESIS')),
  target_discovery_evidence_id text,
  target_source_assertion_id text,
  target_runtime_observation_id uuid,
  target_cross_signal_comparison_id text,
  target_execution_field_state_id text,
  target_technical_field_state_id text,
  target_lineage_observation_finding_id text,
  target_l14_fact_state_id uuid,
  target_l14_fact_subject_kind text,
  target_risk_signal_id uuid,
  target_risk_hypothesis_id uuid,
  recorded_at timestamptz NOT NULL,
  CONSTRAINT l15_support_links_pkey PRIMARY KEY (organisation_id, link_id),
  CONSTRAINT l15_support_links_owner_shape_check CHECK (
    (owner_kind = 'RISK_SIGNAL' AND owner_signal_id IS NOT NULL AND owner_signal_kind IS NOT NULL AND owner_hypothesis_id IS NULL)
    OR (owner_kind = 'RISK_HYPOTHESIS' AND owner_hypothesis_id IS NOT NULL AND owner_signal_id IS NULL AND owner_signal_kind IS NULL)),
  -- Exactly one typed target, matching its tag (O84).
  CONSTRAINT l15_support_links_target_shape_check CHECK (
    pg_catalog.num_nonnulls(target_discovery_evidence_id, target_source_assertion_id, target_runtime_observation_id,
      target_cross_signal_comparison_id, target_execution_field_state_id, target_technical_field_state_id,
      target_lineage_observation_finding_id, target_l14_fact_state_id, target_risk_signal_id, target_risk_hypothesis_id) = 1
    AND (target_l14_fact_state_id IS NULL) = (target_l14_fact_subject_kind IS NULL)
    AND ((target_tag = 'DISCOVERY_EVIDENCE') = (target_discovery_evidence_id IS NOT NULL))
    AND ((target_tag = 'SOURCE_ASSERTION') = (target_source_assertion_id IS NOT NULL))
    AND ((target_tag = 'RUNTIME_OBSERVATION') = (target_runtime_observation_id IS NOT NULL))
    AND ((target_tag = 'CROSS_SIGNAL_RESULT') = (target_cross_signal_comparison_id IS NOT NULL))
    AND ((target_tag = 'EXECUTION_FIELD_STATE') = (target_execution_field_state_id IS NOT NULL))
    AND ((target_tag = 'TECHNICAL_FIELD_STATE') = (target_technical_field_state_id IS NOT NULL))
    AND ((target_tag = 'LINEAGE_OBSERVATION') = (target_lineage_observation_finding_id IS NOT NULL))
    AND ((target_tag = 'L14_FACT_STATE') = (target_l14_fact_state_id IS NOT NULL))
    AND ((target_tag = 'RISK_SIGNAL') = (target_risk_signal_id IS NOT NULL))
    AND ((target_tag = 'RISK_HYPOTHESIS') = (target_risk_hypothesis_id IS NOT NULL))),
  -- §9.2 closed acyclic owner -> target matrix for the S1 owners: rank 1 -> rank 0, rank 2 -> rank 1. Same-rank (self /
  -- signal -> signal / hypothesis -> hypothesis), upward (signal -> hypothesis) and skip (hypothesis -> rank 0) are illegal.
  CONSTRAINT l15_support_links_owner_target_matrix_check CHECK (
    (owner_kind = 'RISK_SIGNAL' AND target_tag IN ('DISCOVERY_EVIDENCE','SOURCE_ASSERTION','RUNTIME_OBSERVATION',
      'CROSS_SIGNAL_RESULT','EXECUTION_FIELD_STATE','TECHNICAL_FIELD_STATE','LINEAGE_OBSERVATION','L14_FACT_STATE'))
    OR (owner_kind = 'RISK_HYPOTHESIS' AND target_tag = 'RISK_SIGNAL')),
  -- A *_REF signal is a typed reference to exactly the upstream record class its kind names (§4.3); detector signals cite
  -- source evidence; a governance-gap or human signal may cite any rank-0 evidence.
  CONSTRAINT l15_support_links_signal_kind_target_check CHECK (
    owner_kind <> 'RISK_SIGNAL'
    OR (owner_signal_kind IN ('DETECTED_PATTERN','DETECTED_ABSENCE')
        AND target_tag IN ('DISCOVERY_EVIDENCE','SOURCE_ASSERTION','TECHNICAL_FIELD_STATE'))
    OR (owner_signal_kind = 'RUNTIME_OBSERVATION_REF' AND target_tag = 'RUNTIME_OBSERVATION')
    OR (owner_signal_kind = 'CROSS_SIGNAL_RESULT_REF' AND target_tag = 'CROSS_SIGNAL_RESULT')
    OR (owner_signal_kind = 'EXECUTION_CONTEXT_REF' AND target_tag = 'EXECUTION_FIELD_STATE')
    OR (owner_signal_kind = 'CONTROL_ASSESSMENT_REF' AND target_tag = 'L14_FACT_STATE'
        AND target_l14_fact_subject_kind = 'CONTROL_ASSESSMENT')
    OR (owner_signal_kind = 'LINEAGE_REF' AND target_tag = 'LINEAGE_OBSERVATION')
    OR (owner_signal_kind = 'IMPORTED_ASSERTION' AND target_tag = 'SOURCE_ASSERTION')
    OR owner_signal_kind IN ('GOVERNANCE_GAP_REF','HUMAN_OBSERVATION')),
  CONSTRAINT l15_support_links_owner_signal_fkey FOREIGN KEY (organisation_id, owner_signal_id, owner_signal_kind)
    REFERENCES gov_repo.l15_risk_signals(organisation_id, signal_id, signal_kind) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT l15_support_links_owner_hypothesis_fkey FOREIGN KEY (organisation_id, owner_hypothesis_id)
    REFERENCES gov_repo.l15_risk_hypotheses(organisation_id, hypothesis_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  -- One composite same-tenant FK per tag (§9.1); cross-tenant / unknown / wrong-tag targets fail.
  CONSTRAINT l15_support_links_discovery_evidence_fkey FOREIGN KEY (organisation_id, target_discovery_evidence_id)
    REFERENCES gov_repo.discovery_evidence(organisation_id, evidence_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT l15_support_links_source_assertion_fkey FOREIGN KEY (organisation_id, target_source_assertion_id)
    REFERENCES gov_repo.source_assertions(organisation_id, assertion_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT l15_support_links_runtime_observation_fkey FOREIGN KEY (organisation_id, target_runtime_observation_id)
    REFERENCES gov_repo.runtime_observations(organisation_id, observation_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT l15_support_links_cross_signal_result_fkey FOREIGN KEY (organisation_id, target_cross_signal_comparison_id)
    REFERENCES gov_repo.cross_signal_comparison_results(organisation_id, comparison_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT l15_support_links_execution_field_state_fkey FOREIGN KEY (organisation_id, target_execution_field_state_id)
    REFERENCES gov_repo.execution_field_states(organisation_id, state_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT l15_support_links_technical_field_state_fkey FOREIGN KEY (organisation_id, target_technical_field_state_id)
    REFERENCES gov_repo.technical_field_states(organisation_id, state_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT l15_support_links_lineage_observation_fkey FOREIGN KEY (organisation_id, target_lineage_observation_finding_id)
    REFERENCES gov_repo.lineage_candidate_observations(organisation_id, observation_finding_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT l15_support_links_l14_fact_state_fkey FOREIGN KEY (organisation_id, target_l14_fact_state_id, target_l14_fact_subject_kind)
    REFERENCES gov_repo.l14_fact_states(organisation_id, fact_state_id, subject_kind) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT l15_support_links_risk_signal_fkey FOREIGN KEY (organisation_id, target_risk_signal_id)
    REFERENCES gov_repo.l15_risk_signals(organisation_id, signal_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT l15_support_links_risk_hypothesis_fkey FOREIGN KEY (organisation_id, target_risk_hypothesis_id)
    REFERENCES gov_repo.l15_risk_hypotheses(organisation_id, hypothesis_id) ON UPDATE RESTRICT ON DELETE RESTRICT
);
-- One link per owner x exact typed target.
CREATE UNIQUE INDEX l15_support_links_owner_target_unique ON gov_repo.l15_support_links (organisation_id, owner_kind,
  (COALESCE(owner_signal_id, owner_hypothesis_id)), target_tag,
  (COALESCE(target_discovery_evidence_id, target_source_assertion_id, target_runtime_observation_id::text,
    target_cross_signal_comparison_id, target_execution_field_state_id, target_technical_field_state_id,
    target_lineage_observation_finding_id, target_l14_fact_state_id::text, target_risk_signal_id::text,
    target_risk_hypothesis_id::text)));
CREATE INDEX l15_support_links_target_signal ON gov_repo.l15_support_links (organisation_id, target_risk_signal_id)
  WHERE target_risk_signal_id IS NOT NULL;
CREATE INDEX l15_support_links_target_hypothesis ON gov_repo.l15_support_links (organisation_id, target_risk_hypothesis_id)
  WHERE target_risk_hypothesis_id IS NOT NULL;
CREATE INDEX l15_risk_signals_subject_object ON gov_repo.l15_risk_signals (organisation_id, subject_canonical_kind, subject_canonical_object_id)
  WHERE subject_mode = 'CANONICAL_OBJECT';
CREATE INDEX l15_risk_signals_subject_relationship ON gov_repo.l15_risk_signals (organisation_id, subject_relationship_id, subject_relationship_state_id)
  WHERE subject_mode = 'RELATIONSHIP_STATE';
CREATE INDEX l15_risk_hypotheses_subject_object ON gov_repo.l15_risk_hypotheses (organisation_id, subject_canonical_kind, subject_canonical_object_id)
  WHERE subject_mode = 'CANONICAL_OBJECT';
CREATE INDEX l15_risk_hypotheses_subject_relationship ON gov_repo.l15_risk_hypotheses (organisation_id, subject_relationship_id, subject_relationship_state_id)
  WHERE subject_mode = 'RELATIONSHIP_STATE';

-- ---------------------------------------------------------------------------------------------------------------------
-- D. Structural guards (raising, ENABLE ALWAYS; owner-only SECURITY INVOKER trigger functions).
-- ---------------------------------------------------------------------------------------------------------------------
CREATE FUNCTION gov_repo.l15_history_immutable_v1() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $fn$
BEGIN
  RAISE EXCEPTION 'L15_HISTORY_IMMUTABLE' USING ERRCODE = '55000', DETAIL = TG_TABLE_NAME || ':' || TG_OP;
END;
$fn$;

-- DB-authored identity and recording time; exact relationship-state triple; the gap read coordinates.
CREATE FUNCTION gov_repo.l15_store_insert_guard_v1() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $fn$
DECLARE
  v_count bigint;
BEGIN
  NEW.recorded_at := pg_catalog.now();
  IF TG_TABLE_NAME = 'l15_risk_signals' THEN
    NEW.signal_id := pg_catalog.gen_random_uuid();
    IF NEW.signal_kind = 'GOVERNANCE_GAP_REF' THEN
      NEW.gap_effective_at := NEW.recorded_at;
      NEW.gap_recorded_cutoff := NEW.recorded_at;
    END IF;
  ELSIF TG_TABLE_NAME = 'l15_risk_hypotheses' THEN
    NEW.hypothesis_id := pg_catalog.gen_random_uuid();
  ELSE
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'UNEXPECTED_STORE';
  END IF;
  IF NEW.subject_mode = 'RELATIONSHIP_STATE' THEN
    SELECT r.match_count INTO v_count
    FROM gov_repo.l14_resolve_relationship_state_target_v1(NEW.organisation_id, NEW.subject_relationship_id,
                                                           NEW.subject_relationship_state_id) AS r;
    IF v_count IS DISTINCT FROM 1::bigint THEN
      RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'SUBJECT_RELATIONSHIP_STATE_UNRESOLVED';
    END IF;
  END IF;
  RETURN NEW;
END;
$fn$;

-- Links are written only together with their owner (same transaction), get DB-authored identity / time, and the
-- outcome-bearing references are admissible: an M15 result must be CONFLICT_CANDIDATE or INSUFFICIENT_EVIDENCE (CONSISTENT
-- is never a risk signal; DRIFT_CANDIDATE is admissible per §4.3 once a future M15 method can persist it — the current M15
-- store CHECK cannot hold it); a CONTROL_ASSESSMENT_REF must cite a
-- VALIDATED M16 CONTROL_ASSESSMENT state whose outcome is NOT_SATISFIED / PARTIALLY_SATISFIED / NOT_ASSESSED /
-- INSUFFICIENT_EVIDENCE (SATISFIED and REVOKED tombstones are not risk signals).
CREATE FUNCTION gov_repo.l15_support_link_insert_guard_v1() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $fn$
DECLARE
  v_owner_recorded timestamptz;
BEGIN
  NEW.link_id := pg_catalog.gen_random_uuid();
  NEW.recorded_at := pg_catalog.now();
  IF NEW.owner_kind = 'RISK_SIGNAL' THEN
    SELECT s.recorded_at INTO v_owner_recorded FROM gov_repo.l15_risk_signals AS s
    WHERE s.organisation_id = NEW.organisation_id AND s.signal_id = NEW.owner_signal_id;
  ELSIF NEW.owner_kind = 'RISK_HYPOTHESIS' THEN
    SELECT h.recorded_at INTO v_owner_recorded FROM gov_repo.l15_risk_hypotheses AS h
    WHERE h.organisation_id = NEW.organisation_id AND h.hypothesis_id = NEW.owner_hypothesis_id;
  END IF;
  IF v_owner_recorded IS DISTINCT FROM NEW.recorded_at THEN
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'SUPPORT_OWNER_NOT_IN_TRANSACTION';
  END IF;
  IF NEW.target_tag = 'CROSS_SIGNAL_RESULT' AND NOT EXISTS (
       SELECT 1 FROM gov_repo.cross_signal_comparison_results AS r
       WHERE r.organisation_id = NEW.organisation_id AND r.comparison_id = NEW.target_cross_signal_comparison_id
         AND r.outcome IN ('CONFLICT_CANDIDATE','INSUFFICIENT_EVIDENCE','DRIFT_CANDIDATE')) THEN
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'CROSS_SIGNAL_RESULT_NOT_ADMISSIBLE';
  END IF;
  IF NEW.owner_signal_kind = 'CONTROL_ASSESSMENT_REF' AND NOT EXISTS (
       SELECT 1 FROM gov_repo.l14_control_assessment_states AS a
       WHERE a.organisation_id = NEW.organisation_id AND a.fact_state_id = NEW.target_l14_fact_state_id
         AND a.state_kind = 'VALIDATED'
         AND a.assessment_outcome IN ('NOT_SATISFIED','PARTIALLY_SATISFIED','NOT_ASSESSED','INSUFFICIENT_EVIDENCE')) THEN
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'CONTROL_ASSESSMENT_NOT_ADMISSIBLE';
  END IF;
  RETURN NEW;
END;
$fn$;

-- Commit-time support completeness (DEFERRABLE INITIALLY DEFERRED): every non-human signal has >= 1 rank-0 link and the
-- stored support_status equals the actual link set; every hypothesis cites >= 1 signal. Never fabricated, never defaulted.
CREATE FUNCTION gov_repo.l15_support_completeness_guard_v1() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $fn$
DECLARE
  v_links bigint;
BEGIN
  IF TG_TABLE_NAME = 'l15_risk_signals' THEN
    SELECT pg_catalog.count(*) INTO v_links FROM gov_repo.l15_support_links AS l
    WHERE l.organisation_id = NEW.organisation_id AND l.owner_kind = 'RISK_SIGNAL' AND l.owner_signal_id = NEW.signal_id;
    IF (NEW.support_status = 'PRESENT') <> (v_links > 0) THEN
      RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'SIGNAL_SUPPORT_INCOMPLETE';
    END IF;
  ELSE
    SELECT pg_catalog.count(*) INTO v_links FROM gov_repo.l15_support_links AS l
    WHERE l.organisation_id = NEW.organisation_id AND l.owner_kind = 'RISK_HYPOTHESIS'
      AND l.owner_hypothesis_id = NEW.hypothesis_id AND l.target_tag = 'RISK_SIGNAL';
    IF v_links < 1 THEN
      RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'HYPOTHESIS_REQUIRES_SIGNAL';
    END IF;
  END IF;
  RETURN NULL;
END;
$fn$;

CREATE TRIGGER l15_risk_signals_insert_guard BEFORE INSERT ON gov_repo.l15_risk_signals
  FOR EACH ROW EXECUTE FUNCTION gov_repo.l15_store_insert_guard_v1();
CREATE TRIGGER l15_risk_hypotheses_insert_guard BEFORE INSERT ON gov_repo.l15_risk_hypotheses
  FOR EACH ROW EXECUTE FUNCTION gov_repo.l15_store_insert_guard_v1();
CREATE TRIGGER l15_support_links_insert_guard BEFORE INSERT ON gov_repo.l15_support_links
  FOR EACH ROW EXECUTE FUNCTION gov_repo.l15_support_link_insert_guard_v1();
CREATE CONSTRAINT TRIGGER l15_risk_signals_support_complete AFTER INSERT ON gov_repo.l15_risk_signals
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION gov_repo.l15_support_completeness_guard_v1();
CREATE CONSTRAINT TRIGGER l15_risk_hypotheses_support_complete AFTER INSERT ON gov_repo.l15_risk_hypotheses
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION gov_repo.l15_support_completeness_guard_v1();
CREATE TRIGGER l15_risk_signals_immutable BEFORE UPDATE OR DELETE ON gov_repo.l15_risk_signals
  FOR EACH ROW EXECUTE FUNCTION gov_repo.l15_history_immutable_v1();
CREATE TRIGGER l15_risk_signals_no_truncate BEFORE TRUNCATE ON gov_repo.l15_risk_signals
  FOR EACH STATEMENT EXECUTE FUNCTION gov_repo.l15_history_immutable_v1();
CREATE TRIGGER l15_risk_hypotheses_immutable BEFORE UPDATE OR DELETE ON gov_repo.l15_risk_hypotheses
  FOR EACH ROW EXECUTE FUNCTION gov_repo.l15_history_immutable_v1();
CREATE TRIGGER l15_risk_hypotheses_no_truncate BEFORE TRUNCATE ON gov_repo.l15_risk_hypotheses
  FOR EACH STATEMENT EXECUTE FUNCTION gov_repo.l15_history_immutable_v1();
CREATE TRIGGER l15_support_links_immutable BEFORE UPDATE OR DELETE ON gov_repo.l15_support_links
  FOR EACH ROW EXECUTE FUNCTION gov_repo.l15_history_immutable_v1();
CREATE TRIGGER l15_support_links_no_truncate BEFORE TRUNCATE ON gov_repo.l15_support_links
  FOR EACH STATEMENT EXECUTE FUNCTION gov_repo.l15_history_immutable_v1();
ALTER TABLE gov_repo.l15_risk_signals ENABLE ALWAYS TRIGGER l15_risk_signals_insert_guard;
ALTER TABLE gov_repo.l15_risk_signals ENABLE ALWAYS TRIGGER l15_risk_signals_support_complete;
ALTER TABLE gov_repo.l15_risk_signals ENABLE ALWAYS TRIGGER l15_risk_signals_immutable;
ALTER TABLE gov_repo.l15_risk_signals ENABLE ALWAYS TRIGGER l15_risk_signals_no_truncate;
ALTER TABLE gov_repo.l15_risk_hypotheses ENABLE ALWAYS TRIGGER l15_risk_hypotheses_insert_guard;
ALTER TABLE gov_repo.l15_risk_hypotheses ENABLE ALWAYS TRIGGER l15_risk_hypotheses_support_complete;
ALTER TABLE gov_repo.l15_risk_hypotheses ENABLE ALWAYS TRIGGER l15_risk_hypotheses_immutable;
ALTER TABLE gov_repo.l15_risk_hypotheses ENABLE ALWAYS TRIGGER l15_risk_hypotheses_no_truncate;
ALTER TABLE gov_repo.l15_support_links ENABLE ALWAYS TRIGGER l15_support_links_insert_guard;
ALTER TABLE gov_repo.l15_support_links ENABLE ALWAYS TRIGGER l15_support_links_immutable;
ALTER TABLE gov_repo.l15_support_links ENABLE ALWAYS TRIGGER l15_support_links_no_truncate;
ALTER TABLE gov_repo.l15_risk_signals ENABLE ROW LEVEL SECURITY;
ALTER TABLE gov_repo.l15_risk_hypotheses ENABLE ROW LEVEL SECURITY;
ALTER TABLE gov_repo.l15_support_links ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------------------------------------------------
-- E. Owner-only helpers (SECURITY INVOKER; EXECUTE revoked from every application role).
-- ---------------------------------------------------------------------------------------------------------------------
-- Length-prefixed frame -> SHA-256 hex. NULL is framed as '~' (distinct from every value, which is length-prefixed).
CREATE FUNCTION gov_repo.l15_frame_hash_v1(p_parts text[]) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, pg_temp AS $fn$
  SELECT pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
    COALESCE(pg_catalog.string_agg(CASE WHEN x.part IS NULL THEN '~' ELSE pg_catalog.length(x.part)::text || ':' || x.part END,
                                   '|' ORDER BY x.ord), ''), 'UTF8')), 'hex')
  FROM pg_catalog.unnest(p_parts) WITH ORDINALITY AS x(part, ord)
$fn$;

-- The technical intake identity: a LOGIN (session_user) that holds the capability through membership and is not an
-- application / owner / privileged role. Returns the identity recorded as provenance; never an authority.
CREATE FUNCTION gov_repo.l15_require_machine_intake_identity_v1() RETURNS text
LANGUAGE plpgsql STABLE SET search_path = pg_catalog, pg_temp AS $fn$
DECLARE
  v_role record;
BEGIN
  SELECT r.oid, r.rolname, r.rolcanlogin, r.rolsuper, r.rolbypassrls, r.rolcreaterole, r.rolcreatedb, r.rolreplication
  INTO v_role FROM pg_catalog.pg_roles AS r WHERE r.rolname = session_user;
  IF NOT FOUND OR NOT v_role.rolcanlogin OR v_role.rolsuper OR v_role.rolbypassrls OR v_role.rolcreaterole
     OR v_role.rolcreatedb OR v_role.rolreplication
     OR v_role.rolname IN ('postgres','service_role','anon','authenticated')
     OR NOT pg_catalog.pg_has_role(v_role.oid, 'govia_l15_machine_intake_caller', 'MEMBER')
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_roles AS a WHERE a.rolname IN ('postgres','service_role','anon','authenticated')
                  AND pg_catalog.pg_has_role(v_role.oid, a.oid, 'MEMBER')) THEN
    RAISE EXCEPTION 'L15_INTAKE_IDENTITY_INELIGIBLE' USING ERRCODE = '42501';
  END IF;
  RETURN v_role.rolname::text;
END;
$fn$;

-- Exact subject resolution (object: organisation + id + declared kind; relationship: exact triple, exactly one row).
CREATE FUNCTION gov_repo.l15_require_subject_v1(p_organisation_id uuid, p_mode text, p_kind text, p_object_id text,
  p_relationship_id text, p_relationship_state_id text, p_unresolved_reason text, p_allow_unresolved boolean)
RETURNS void LANGUAGE plpgsql STABLE SET search_path = pg_catalog, pg_temp AS $fn$
DECLARE
  v_count bigint;
BEGIN
  IF p_mode = 'CANONICAL_OBJECT' AND p_kind IS NOT NULL AND p_object_id IS NOT NULL AND p_relationship_id IS NULL
     AND p_relationship_state_id IS NULL AND p_unresolved_reason IS NULL THEN
    IF NOT EXISTS (SELECT 1 FROM gov_repo.canonical_objects AS o WHERE o.organisation_id = p_organisation_id
                     AND o.canonical_object_id = p_object_id AND o.kind = p_kind) THEN
      RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'SUBJECT_OBJECT_UNRESOLVED';
    END IF;
  ELSIF p_mode = 'RELATIONSHIP_STATE' AND p_kind IS NULL AND p_object_id IS NULL AND p_relationship_id IS NOT NULL
        AND p_relationship_state_id IS NOT NULL AND p_unresolved_reason IS NULL THEN
    SELECT r.match_count INTO v_count
    FROM gov_repo.l14_resolve_relationship_state_target_v1(p_organisation_id, p_relationship_id, p_relationship_state_id) AS r;
    IF v_count IS DISTINCT FROM 1::bigint THEN
      RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'SUBJECT_RELATIONSHIP_STATE_UNRESOLVED';
    END IF;
  ELSIF p_mode = 'UNRESOLVED' AND p_allow_unresolved AND p_kind IS NULL AND p_object_id IS NULL
        AND p_relationship_id IS NULL AND p_relationship_state_id IS NULL
        AND p_unresolved_reason IN ('MISSING_REVISION_EVIDENCE','NO_EXACT_MAPPING','AMBIGUOUS_MAPPING','UNSUPPORTED_BINDING_PROOF') THEN
    RETURN;
  ELSE
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'SUBJECT_SHAPE_INVALID';
  END IF;
END;
$fn$;

-- Normalized support set: equal-length, non-null, closed tags, duplicate-free, at most 64; sorted (C collation) so the
-- fingerprint is order-independent. Every target must exist in the SAME organisation in exactly the tagged store.
CREATE FUNCTION gov_repo.l15_normalize_support_v1(p_organisation_id uuid, p_tags text[], p_ids text[])
RETURNS TABLE(tag text, target_id text, l14_subject_kind text)
LANGUAGE plpgsql STABLE SET search_path = pg_catalog, pg_temp AS $fn$
DECLARE
  v_row record;
  v_kind text;
  v_found boolean;
BEGIN
  IF p_tags IS NULL OR p_ids IS NULL OR pg_catalog.cardinality(p_tags) <> pg_catalog.cardinality(p_ids)
     OR pg_catalog.cardinality(p_tags) > 64
     OR (pg_catalog.cardinality(p_tags) > 0 AND (pg_catalog.array_ndims(p_tags) <> 1 OR pg_catalog.array_ndims(p_ids) <> 1))
     OR pg_catalog.array_position(p_tags, NULL) IS NOT NULL OR pg_catalog.array_position(p_ids, NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'SUPPORT_SHAPE_INVALID';
  END IF;
  IF (SELECT pg_catalog.count(DISTINCT (t.tg, t.id)) FROM ROWS FROM (pg_catalog.unnest(p_tags), pg_catalog.unnest(p_ids)) AS t(tg, id))
     <> pg_catalog.cardinality(p_tags) THEN
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'SUPPORT_DUPLICATE';
  END IF;
  FOR v_row IN SELECT t.tg, t.id FROM ROWS FROM (pg_catalog.unnest(p_tags), pg_catalog.unnest(p_ids)) AS t(tg, id)
               ORDER BY t.tg COLLATE "C", t.id COLLATE "C" LOOP
    v_kind := NULL;
    IF v_row.tg IN ('RUNTIME_OBSERVATION','L14_FACT_STATE','RISK_SIGNAL','RISK_HYPOTHESIS')
       AND v_row.id COLLATE "C" !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'SUPPORT_TARGET_UNRESOLVED';
    END IF;
    IF pg_catalog.length(v_row.id) NOT BETWEEN 1 AND 500 OR v_row.id <> pg_catalog.btrim(v_row.id) THEN
      RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'SUPPORT_TARGET_UNRESOLVED';
    END IF;
    v_found := CASE v_row.tg
      WHEN 'DISCOVERY_EVIDENCE' THEN EXISTS (SELECT 1 FROM gov_repo.discovery_evidence AS x
        WHERE x.organisation_id = p_organisation_id AND x.evidence_id = v_row.id)
      WHEN 'SOURCE_ASSERTION' THEN EXISTS (SELECT 1 FROM gov_repo.source_assertions AS x
        WHERE x.organisation_id = p_organisation_id AND x.assertion_id = v_row.id)
      WHEN 'RUNTIME_OBSERVATION' THEN EXISTS (SELECT 1 FROM gov_repo.runtime_observations AS x
        WHERE x.organisation_id = p_organisation_id AND x.observation_id = v_row.id::uuid)
      WHEN 'CROSS_SIGNAL_RESULT' THEN EXISTS (SELECT 1 FROM gov_repo.cross_signal_comparison_results AS x
        WHERE x.organisation_id = p_organisation_id AND x.comparison_id = v_row.id)
      WHEN 'EXECUTION_FIELD_STATE' THEN EXISTS (SELECT 1 FROM gov_repo.execution_field_states AS x
        WHERE x.organisation_id = p_organisation_id AND x.state_id = v_row.id)
      WHEN 'TECHNICAL_FIELD_STATE' THEN EXISTS (SELECT 1 FROM gov_repo.technical_field_states AS x
        WHERE x.organisation_id = p_organisation_id AND x.state_id = v_row.id)
      WHEN 'LINEAGE_OBSERVATION' THEN EXISTS (SELECT 1 FROM gov_repo.lineage_candidate_observations AS x
        WHERE x.organisation_id = p_organisation_id AND x.observation_finding_id = v_row.id)
      WHEN 'L14_FACT_STATE' THEN EXISTS (SELECT 1 FROM gov_repo.l14_fact_states AS x
        WHERE x.organisation_id = p_organisation_id AND x.fact_state_id = v_row.id::uuid)
      WHEN 'RISK_SIGNAL' THEN EXISTS (SELECT 1 FROM gov_repo.l15_risk_signals AS x
        WHERE x.organisation_id = p_organisation_id AND x.signal_id = v_row.id::uuid)
      WHEN 'RISK_HYPOTHESIS' THEN EXISTS (SELECT 1 FROM gov_repo.l15_risk_hypotheses AS x
        WHERE x.organisation_id = p_organisation_id AND x.hypothesis_id = v_row.id::uuid)
      ELSE NULL END;
    IF v_found IS NULL THEN
      RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'SUPPORT_TAG_UNKNOWN';
    END IF;
    IF NOT v_found THEN
      RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'SUPPORT_TARGET_UNRESOLVED';
    END IF;
    IF v_row.tg = 'L14_FACT_STATE' THEN
      SELECT x.subject_kind INTO v_kind FROM gov_repo.l14_fact_states AS x
      WHERE x.organisation_id = p_organisation_id AND x.fact_state_id = v_row.id::uuid;
    END IF;
    tag := v_row.tg; target_id := v_row.id; l14_subject_kind := v_kind;
    RETURN NEXT;
  END LOOP;
END;
$fn$;

-- Typed link writer (one row per normalized support entry).
CREATE FUNCTION gov_repo.l15_write_support_links_v1(p_organisation_id uuid, p_owner_kind text, p_owner_signal_id uuid,
  p_owner_signal_kind text, p_owner_hypothesis_id uuid, p_tags text[], p_ids text[])
RETURNS integer LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $fn$
DECLARE
  v_row record;
  v_count integer := 0;
BEGIN
  FOR v_row IN SELECT * FROM gov_repo.l15_normalize_support_v1(p_organisation_id, p_tags, p_ids) LOOP
    INSERT INTO gov_repo.l15_support_links(organisation_id, link_id, owner_kind, owner_signal_id, owner_signal_kind,
      owner_hypothesis_id, target_tag, target_discovery_evidence_id, target_source_assertion_id, target_runtime_observation_id,
      target_cross_signal_comparison_id, target_execution_field_state_id, target_technical_field_state_id,
      target_lineage_observation_finding_id, target_l14_fact_state_id, target_l14_fact_subject_kind, target_risk_signal_id,
      target_risk_hypothesis_id, recorded_at)
    VALUES (p_organisation_id, pg_catalog.gen_random_uuid(), p_owner_kind, p_owner_signal_id, p_owner_signal_kind,
      p_owner_hypothesis_id, v_row.tag,
      CASE WHEN v_row.tag = 'DISCOVERY_EVIDENCE' THEN v_row.target_id END,
      CASE WHEN v_row.tag = 'SOURCE_ASSERTION' THEN v_row.target_id END,
      CASE WHEN v_row.tag = 'RUNTIME_OBSERVATION' THEN v_row.target_id::uuid END,
      CASE WHEN v_row.tag = 'CROSS_SIGNAL_RESULT' THEN v_row.target_id END,
      CASE WHEN v_row.tag = 'EXECUTION_FIELD_STATE' THEN v_row.target_id END,
      CASE WHEN v_row.tag = 'TECHNICAL_FIELD_STATE' THEN v_row.target_id END,
      CASE WHEN v_row.tag = 'LINEAGE_OBSERVATION' THEN v_row.target_id END,
      CASE WHEN v_row.tag = 'L14_FACT_STATE' THEN v_row.target_id::uuid END,
      v_row.l14_subject_kind,
      CASE WHEN v_row.tag = 'RISK_SIGNAL' THEN v_row.target_id::uuid END,
      CASE WHEN v_row.tag = 'RISK_HYPOTHESIS' THEN v_row.target_id::uuid END,
      pg_catalog.now());
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$fn$;

-- Frame of the normalized support set (tag, id pairs in C order).
CREATE FUNCTION gov_repo.l15_support_frame_v1(p_tags text[], p_ids text[]) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, pg_temp AS $fn$
  SELECT COALESCE(pg_catalog.string_agg(pg_catalog.length(t.tg)::text || ':' || t.tg || '=' || pg_catalog.length(t.id)::text
                                        || ':' || t.id, ',' ORDER BY t.tg COLLATE "C", t.id COLLATE "C"), '')
  FROM ROWS FROM (pg_catalog.unnest(p_tags), pg_catalog.unnest(p_ids)) AS t(tg, id)
$fn$;

-- Shared signal writer: replay-first under the (organisation, intake_key) guard, then subject / support / gap validation.
CREATE FUNCTION gov_repo.l15_write_signal_v1(p_organisation_id uuid, p_intake_key text, p_signal_kind text,
  p_source_class text, p_subject_mode text, p_subject_canonical_kind text, p_subject_canonical_object_id text,
  p_subject_relationship_id text, p_subject_relationship_state_id text, p_unresolved_reason text, p_trust_state text,
  p_method_id text, p_method_version text, p_hint_severity text, p_hint_confidence numeric, p_observed_at timestamptz,
  p_gap_fact_family text, p_gap_responsibility_role text, p_gap_semantic_kind text, p_gap_control_definition_id uuid,
  p_support_tags text[], p_support_target_ids text[], p_submitted_by_user_id uuid, p_technical_identity text)
RETURNS TABLE(signal_id uuid, recorded_at timestamptz, semantic_fingerprint text, replayed boolean)
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $fn$
DECLARE
  v_fp text;
  v_existing record;
  v_now timestamptz := pg_catalog.now();
  v_target_type text;
  v_id uuid;
  v_recorded timestamptz;
BEGIN
  IF p_intake_key IS NULL OR p_intake_key COLLATE "C" !~ '^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,199}$' THEN
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'INTAKE_KEY_INVALID';
  END IF;
  IF p_signal_kind IS NULL OR p_signal_kind NOT IN ('DETECTED_PATTERN','DETECTED_ABSENCE','RUNTIME_OBSERVATION_REF',
       'CROSS_SIGNAL_RESULT_REF','EXECUTION_CONTEXT_REF','CONTROL_ASSESSMENT_REF','GOVERNANCE_GAP_REF','LINEAGE_REF',
       'IMPORTED_ASSERTION','HUMAN_OBSERVATION') THEN
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'SIGNAL_KIND_UNKNOWN';
  END IF;
  IF p_source_class IS NULL OR p_source_class NOT IN ('SYSTEM_DETECTOR','SOURCE_CONNECTION','RUNTIME_SOURCE',
       'GOVERNED_FACT_REFERENCE','LOCAL_HUMAN') THEN
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'SOURCE_CLASS_UNKNOWN';
  END IF;
  IF p_trust_state = 'VALIDATED' THEN
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'TRUST_VALIDATED_FORBIDDEN';
  END IF;
  IF p_source_class IS DISTINCT FROM (CASE
       WHEN p_signal_kind IN ('DETECTED_PATTERN','DETECTED_ABSENCE') THEN 'SYSTEM_DETECTOR'
       WHEN p_signal_kind = 'RUNTIME_OBSERVATION_REF' THEN 'RUNTIME_SOURCE'
       WHEN p_signal_kind = 'IMPORTED_ASSERTION' THEN 'SOURCE_CONNECTION'
       WHEN p_signal_kind = 'HUMAN_OBSERVATION' THEN 'LOCAL_HUMAN'
       ELSE 'GOVERNED_FACT_REFERENCE' END) THEN
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'SIGNAL_SOURCE_MISMATCH';
  END IF;
  IF NOT ((p_source_class = 'SYSTEM_DETECTOR' AND p_trust_state IN ('INFERRED','DECLARED'))
          OR (p_source_class = 'SOURCE_CONNECTION' AND p_trust_state = 'IMPORTED')
          OR (p_source_class = 'RUNTIME_SOURCE' AND p_trust_state = 'OBSERVED')
          OR (p_source_class IN ('GOVERNED_FACT_REFERENCE','LOCAL_HUMAN') AND p_trust_state IS NULL)) THEN
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'TRUST_SOURCE_MISMATCH';
  END IF;
  IF p_source_class NOT IN ('SYSTEM_DETECTOR','SOURCE_CONNECTION') AND (p_hint_severity IS NOT NULL OR p_hint_confidence IS NOT NULL) THEN
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'HINT_NOT_ADMISSIBLE';
  END IF;
  IF p_source_class <> 'LOCAL_HUMAN' AND (p_method_id IS NULL OR p_method_version IS NULL) THEN
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'METHOD_VERSION_REQUIRED';
  END IF;
  v_fp := gov_repo.l15_frame_hash_v1(ARRAY['L15_RISK_SIGNAL_V1', p_organisation_id::text, p_intake_key, p_signal_kind,
    p_source_class, p_subject_mode, p_subject_canonical_kind, p_subject_canonical_object_id, p_subject_relationship_id,
    p_subject_relationship_state_id, p_unresolved_reason, p_trust_state, p_method_id, p_method_version, p_hint_severity,
    pg_catalog.trim_scale(p_hint_confidence)::text, EXTRACT(EPOCH FROM p_observed_at)::text, p_gap_fact_family, p_gap_responsibility_role, p_gap_semantic_kind,
    p_gap_control_definition_id::text, p_submitted_by_user_id::text, p_technical_identity,
    gov_repo.l15_support_frame_v1(p_support_tags, p_support_target_ids)]);
  -- Lock order: organisation (FOR SHARE, by the caller) -> intake-key guard. Held to commit; a concurrent identical or
  -- conflicting intake waits here and then replays / conflicts against the committed row.
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'L15_SIGNAL_INTAKE|' || p_organisation_id::text || '|' || p_intake_key, 0));
  SELECT s.signal_id, s.recorded_at, s.semantic_fingerprint INTO v_existing FROM gov_repo.l15_risk_signals AS s
  WHERE s.organisation_id = p_organisation_id AND s.intake_key = p_intake_key;
  IF FOUND THEN
    IF v_existing.semantic_fingerprint <> v_fp THEN
      RAISE EXCEPTION 'L15_REPLAY_CONFLICT' USING ERRCODE = 'GV008', DETAIL = 'SIGNAL_INTAKE_KEY_CONTENT_DIFFERS';
    END IF;
    RETURN QUERY SELECT v_existing.signal_id, v_existing.recorded_at, v_existing.semantic_fingerprint, true;
    RETURN;
  END IF;
  PERFORM gov_repo.l15_require_subject_v1(p_organisation_id, p_subject_mode, p_subject_canonical_kind,
    p_subject_canonical_object_id, p_subject_relationship_id, p_subject_relationship_state_id, p_unresolved_reason, true);
  IF p_observed_at IS NOT NULL AND (pg_catalog.cardinality(p_support_tags) = 0 OR p_observed_at > v_now) THEN
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'OBSERVED_AT_UNEVIDENCED';
  END IF;
  IF p_signal_kind = 'GOVERNANCE_GAP_REF' THEN
    IF p_subject_mode NOT IN ('CANONICAL_OBJECT','RELATIONSHIP_STATE') THEN
      RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'GOVERNANCE_GAP_SUBJECT_INVALID';
    END IF;
    -- The deterministic read at the DB-authored coordinates (effective = recorded cutoff = the recording instant) through
    -- the EXISTING M16 bounded current reads. A current governed fact means there is no gap; nothing is written.
    IF p_gap_fact_family = 'RESPONSIBILITY_ASSIGNMENT' THEN
      IF p_subject_mode <> 'CANONICAL_OBJECT' OR EXISTS (
           SELECT 1 FROM gov_repo.l14_responsibility_assignments_current_v1(p_organisation_id, p_subject_canonical_kind,
             p_subject_canonical_object_id, v_now, v_now) AS r WHERE r.responsibility_role = p_gap_responsibility_role) THEN
        RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'GOVERNANCE_GAP_NOT_UNKNOWN';
      END IF;
    ELSIF p_gap_fact_family = 'BUSINESS_CONTEXT_ASSIGNMENT' THEN
      IF p_subject_mode <> 'CANONICAL_OBJECT' OR EXISTS (
           SELECT 1 FROM gov_repo.l14_business_context_assignments_current_v1(p_organisation_id, p_subject_canonical_kind,
             p_subject_canonical_object_id, v_now, v_now) AS r WHERE r.semantic_kind = p_gap_semantic_kind) THEN
        RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'GOVERNANCE_GAP_NOT_UNKNOWN';
      END IF;
    ELSIF p_gap_fact_family = 'CONTROL_ASSESSMENT' THEN
      v_target_type := p_subject_mode;
      -- "Required" = a current APPLIES control applicability for the exact control on the exact subject.
      IF NOT EXISTS (
           SELECT 1 FROM gov_repo.l14_control_applicabilities_current_v1(p_organisation_id, v_target_type,
             p_subject_canonical_kind, p_subject_canonical_object_id, p_subject_relationship_id,
             p_subject_relationship_state_id, v_now, v_now) AS a
           WHERE a.control_definition_id = p_gap_control_definition_id AND a.applicability = 'APPLIES') THEN
        RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'GOVERNANCE_GAP_NOT_REQUIRED';
      END IF;
      IF EXISTS (
           SELECT 1 FROM gov_repo.l14_control_assessments_current_v1(p_organisation_id, v_target_type,
             p_subject_canonical_kind, p_subject_canonical_object_id, p_subject_relationship_id,
             p_subject_relationship_state_id, v_now, v_now) AS c
           WHERE c.control_definition_id = p_gap_control_definition_id) THEN
        RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'GOVERNANCE_GAP_NOT_UNKNOWN';
      END IF;
    ELSE
      RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'GOVERNANCE_GAP_FAMILY_UNKNOWN';
    END IF;
  END IF;
  INSERT INTO gov_repo.l15_risk_signals AS s (organisation_id, signal_id, intake_key, semantic_fingerprint, signal_kind,
    source_class, subject_mode, subject_canonical_kind, subject_canonical_object_id, subject_relationship_id,
    subject_relationship_state_id, unresolved_reason, trust_state, method_id, method_version, hint_severity, hint_confidence,
    observed_at, support_status, gap_fact_family, gap_responsibility_role, gap_semantic_kind, gap_control_definition_id,
    submitted_by_user_id, admitted_by_technical_identity, recorded_at)
  VALUES (p_organisation_id, pg_catalog.gen_random_uuid(), p_intake_key, v_fp, p_signal_kind, p_source_class, p_subject_mode,
    p_subject_canonical_kind, p_subject_canonical_object_id, p_subject_relationship_id, p_subject_relationship_state_id,
    p_unresolved_reason, p_trust_state, p_method_id, p_method_version, p_hint_severity, p_hint_confidence, p_observed_at,
    CASE WHEN pg_catalog.cardinality(p_support_tags) > 0 THEN 'PRESENT' ELSE 'NONE' END, p_gap_fact_family,
    p_gap_responsibility_role, p_gap_semantic_kind, p_gap_control_definition_id, p_submitted_by_user_id,
    p_technical_identity, v_now)
  RETURNING s.signal_id, s.recorded_at INTO v_id, v_recorded;
  PERFORM gov_repo.l15_write_support_links_v1(p_organisation_id, 'RISK_SIGNAL', v_id, p_signal_kind, NULL,
    p_support_tags, p_support_target_ids);
  RETURN QUERY SELECT v_id, v_recorded, v_fp, false;
END;
$fn$;

-- Shared hypothesis writer: replay-first, exact subject (never UNRESOLVED), >= 1 exact same-tenant cited signal.
CREATE FUNCTION gov_repo.l15_write_hypothesis_v1(p_organisation_id uuid, p_intake_key text, p_generator_kind text,
  p_subject_mode text, p_subject_canonical_kind text, p_subject_canonical_object_id text, p_subject_relationship_id text,
  p_subject_relationship_state_id text, p_method_id text, p_method_version text, p_model_provider text, p_model_id text,
  p_prompt_template_version text, p_traversal_policy_version text, p_representation_version text, p_hint_confidence numeric,
  p_cited_signal_ids uuid[], p_submitted_by_user_id uuid, p_technical_identity text)
RETURNS TABLE(hypothesis_id uuid, recorded_at timestamptz, semantic_fingerprint text, replayed boolean)
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $fn$
DECLARE
  v_fp text;
  v_existing record;
  v_ids text[];
  v_id uuid;
  v_recorded timestamptz;
BEGIN
  IF p_intake_key IS NULL OR p_intake_key COLLATE "C" !~ '^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,199}$' THEN
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'INTAKE_KEY_INVALID';
  END IF;
  IF p_generator_kind IS NULL OR p_generator_kind NOT IN ('DETERMINISTIC_RULE','GRAPH_ANALYSIS','VECTOR_RETRIEVAL',
       'LLM_ASSISTED','HUMAN') THEN
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'GENERATOR_KIND_UNKNOWN';
  END IF;
  IF p_generator_kind <> 'HUMAN' AND (p_method_id IS NULL OR p_method_version IS NULL) THEN
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'METHOD_VERSION_REQUIRED';
  END IF;
  IF p_generator_kind = 'LLM_ASSISTED' AND (p_model_provider IS NULL OR p_model_id IS NULL OR p_prompt_template_version IS NULL) THEN
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'LLM_PROVENANCE_REQUIRED';
  END IF;
  IF p_generator_kind = 'GRAPH_ANALYSIS' AND p_traversal_policy_version IS NULL THEN
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'TRAVERSAL_POLICY_VERSION_REQUIRED';
  END IF;
  IF p_generator_kind = 'VECTOR_RETRIEVAL' AND p_representation_version IS NULL THEN
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'REPRESENTATION_VERSION_REQUIRED';
  END IF;
  IF p_cited_signal_ids IS NULL OR pg_catalog.cardinality(p_cited_signal_ids) < 1 THEN
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'HYPOTHESIS_REQUIRES_SIGNAL';
  END IF;
  IF pg_catalog.array_position(p_cited_signal_ids, NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'SUPPORT_SHAPE_INVALID';
  END IF;
  v_ids := ARRAY(SELECT x::text FROM pg_catalog.unnest(p_cited_signal_ids) AS x);
  v_fp := gov_repo.l15_frame_hash_v1(ARRAY['L15_RISK_HYPOTHESIS_V1', p_organisation_id::text, p_intake_key,
    p_generator_kind, p_subject_mode, p_subject_canonical_kind, p_subject_canonical_object_id, p_subject_relationship_id,
    p_subject_relationship_state_id, p_method_id, p_method_version, p_model_provider, p_model_id, p_prompt_template_version,
    p_traversal_policy_version, p_representation_version, pg_catalog.trim_scale(p_hint_confidence)::text, p_submitted_by_user_id::text,
    p_technical_identity,
    gov_repo.l15_support_frame_v1(ARRAY(SELECT 'RISK_SIGNAL'::text FROM pg_catalog.unnest(v_ids)), v_ids)]);
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'L15_HYPOTHESIS_INTAKE|' || p_organisation_id::text || '|' || p_intake_key, 0));
  SELECT h.hypothesis_id, h.recorded_at, h.semantic_fingerprint INTO v_existing FROM gov_repo.l15_risk_hypotheses AS h
  WHERE h.organisation_id = p_organisation_id AND h.intake_key = p_intake_key;
  IF FOUND THEN
    IF v_existing.semantic_fingerprint <> v_fp THEN
      RAISE EXCEPTION 'L15_REPLAY_CONFLICT' USING ERRCODE = 'GV008', DETAIL = 'HYPOTHESIS_INTAKE_KEY_CONTENT_DIFFERS';
    END IF;
    RETURN QUERY SELECT v_existing.hypothesis_id, v_existing.recorded_at, v_existing.semantic_fingerprint, true;
    RETURN;
  END IF;
  PERFORM gov_repo.l15_require_subject_v1(p_organisation_id, p_subject_mode, p_subject_canonical_kind,
    p_subject_canonical_object_id, p_subject_relationship_id, p_subject_relationship_state_id, NULL, false);
  INSERT INTO gov_repo.l15_risk_hypotheses AS h (organisation_id, hypothesis_id, intake_key, semantic_fingerprint,
    generator_kind, subject_mode, subject_canonical_kind, subject_canonical_object_id, subject_relationship_id,
    subject_relationship_state_id, method_id, method_version, model_provider, model_id, prompt_template_version,
    traversal_policy_version, representation_version, trust_state, hint_confidence, submitted_by_user_id,
    admitted_by_technical_identity, recorded_at)
  VALUES (p_organisation_id, pg_catalog.gen_random_uuid(), p_intake_key, v_fp, p_generator_kind, p_subject_mode,
    p_subject_canonical_kind, p_subject_canonical_object_id, p_subject_relationship_id, p_subject_relationship_state_id,
    p_method_id, p_method_version, p_model_provider, p_model_id, p_prompt_template_version, p_traversal_policy_version,
    p_representation_version, CASE WHEN p_generator_kind = 'HUMAN' THEN NULL ELSE 'INFERRED' END, p_hint_confidence,
    p_submitted_by_user_id, p_technical_identity, pg_catalog.now())
  RETURNING h.hypothesis_id, h.recorded_at INTO v_id, v_recorded;
  PERFORM gov_repo.l15_write_support_links_v1(p_organisation_id, 'RISK_HYPOTHESIS', NULL, NULL, v_id,
    ARRAY(SELECT 'RISK_SIGNAL'::text FROM pg_catalog.unnest(v_ids)), v_ids);
  RETURN QUERY SELECT v_id, v_recorded, v_fp, false;
END;
$fn$;

-- Active organisation (FOR SHARE until commit) for the machine path; the human path locks it through the M16-S0 helper.
CREATE FUNCTION gov_repo.l15_lock_active_organisation_v1(p_organisation_id uuid) RETURNS void
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $fn$
BEGIN
  PERFORM 1 FROM gov_repo.organisations AS o WHERE o.organisation_id = p_organisation_id AND o.is_active FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'ORGANISATION_INELIGIBLE';
  END IF;
END;
$fn$;

-- Verified ACTIVE same-tenant member (M16-S0 helper, unchanged). Returns nothing; grants nothing.
CREATE FUNCTION gov_repo.l15_require_member_v1(p_organisation_id uuid, p_actor_user_id uuid, p_iat bigint, p_exp bigint,
  p_credential_epoch timestamptz) RETURNS void
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $fn$
DECLARE
  v_org uuid;
  v_actor uuid;
BEGIN
  SELECT e.organisation_id, e.actor_user_id INTO v_org, v_actor
  FROM gov_repo.lock_and_resolve_governance_session_eligibility_v1(p_organisation_id, p_actor_user_id, p_iat, p_exp,
                                                                    p_credential_epoch) AS e;
  IF NOT FOUND OR v_org IS DISTINCT FROM p_organisation_id OR v_actor IS DISTINCT FROM p_actor_user_id THEN
    RAISE EXCEPTION 'M16_ELIGIBILITY_ACTOR_OR_ORGANISATION_INELIGIBLE' USING ERRCODE = 'GV003', DETAIL = 'ELIGIBILITY_RESULT_MISMATCH';
  END IF;
END;
$fn$;

-- ---------------------------------------------------------------------------------------------------------------------
-- F. Intake RPCs (SECURITY DEFINER). Necessity: the L15 stores have no application privilege at all (§24); a bounded,
--    owner-pinned definer is the only write path, and it re-derives the technical identity / verified member, the tenant,
--    the subject, every support target and the fingerprint inside the write transaction.
-- ---------------------------------------------------------------------------------------------------------------------
CREATE FUNCTION gov_repo.l15_admit_machine_signal_v1(p_organisation_id uuid, p_intake_key text, p_signal_kind text,
  p_source_class text, p_subject_mode text, p_subject_canonical_kind text, p_subject_canonical_object_id text,
  p_subject_relationship_id text, p_subject_relationship_state_id text, p_unresolved_reason text, p_trust_state text,
  p_method_id text, p_method_version text, p_hint_severity text, p_hint_confidence numeric, p_observed_at timestamptz,
  p_gap_fact_family text, p_gap_responsibility_role text, p_gap_semantic_kind text, p_gap_control_definition_id uuid,
  p_support_tags text[], p_support_target_ids text[])
RETURNS TABLE(signal_id uuid, recorded_at timestamptz, semantic_fingerprint text, replayed boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp SET lock_timeout = '5s' AS $fn$
DECLARE
  v_identity text;
BEGIN
  v_identity := gov_repo.l15_require_machine_intake_identity_v1();
  IF pg_catalog.current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'READ_COMMITTED_REQUIRED';
  END IF;
  IF p_source_class = 'LOCAL_HUMAN' OR p_signal_kind = 'HUMAN_OBSERVATION' THEN
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'LOCAL_HUMAN_REQUIRES_VERIFIED_MEMBER';
  END IF;
  IF p_organisation_id IS NULL THEN
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'ORGANISATION_INELIGIBLE';
  END IF;
  PERFORM gov_repo.l15_lock_active_organisation_v1(p_organisation_id);
  IF p_support_tags IS NULL OR pg_catalog.cardinality(p_support_tags) < 1 THEN
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'MACHINE_SIGNAL_REQUIRES_EVIDENCE';
  END IF;
  RETURN QUERY SELECT * FROM gov_repo.l15_write_signal_v1(p_organisation_id, p_intake_key, p_signal_kind, p_source_class,
    p_subject_mode, p_subject_canonical_kind, p_subject_canonical_object_id, p_subject_relationship_id,
    p_subject_relationship_state_id, p_unresolved_reason, p_trust_state, p_method_id, p_method_version, p_hint_severity,
    p_hint_confidence, p_observed_at, p_gap_fact_family, p_gap_responsibility_role, p_gap_semantic_kind,
    p_gap_control_definition_id, p_support_tags, p_support_target_ids, NULL, v_identity);
END;
$fn$;

CREATE FUNCTION gov_repo.l15_admit_human_signal_v1(p_verified_organisation_id uuid, p_verified_actor_user_id uuid,
  p_verified_session_iat bigint, p_verified_session_exp bigint, p_verified_credential_epoch timestamptz,
  p_intake_key text, p_subject_mode text, p_subject_canonical_kind text, p_subject_canonical_object_id text,
  p_subject_relationship_id text, p_subject_relationship_state_id text, p_unresolved_reason text, p_observed_at timestamptz,
  p_support_tags text[], p_support_target_ids text[])
RETURNS TABLE(signal_id uuid, recorded_at timestamptz, semantic_fingerprint text, replayed boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp SET lock_timeout = '5s' AS $fn$
BEGIN
  IF pg_catalog.current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'READ_COMMITTED_REQUIRED';
  END IF;
  PERFORM gov_repo.l15_require_member_v1(p_verified_organisation_id, p_verified_actor_user_id, p_verified_session_iat,
    p_verified_session_exp, p_verified_credential_epoch);
  RETURN QUERY SELECT * FROM gov_repo.l15_write_signal_v1(p_verified_organisation_id, p_intake_key, 'HUMAN_OBSERVATION',
    'LOCAL_HUMAN', p_subject_mode, p_subject_canonical_kind, p_subject_canonical_object_id, p_subject_relationship_id,
    p_subject_relationship_state_id, p_unresolved_reason, NULL, NULL, NULL, NULL, NULL, p_observed_at, NULL, NULL, NULL, NULL,
    p_support_tags, p_support_target_ids, p_verified_actor_user_id, NULL);
END;
$fn$;

CREATE FUNCTION gov_repo.l15_admit_machine_hypothesis_v1(p_organisation_id uuid, p_intake_key text, p_generator_kind text,
  p_subject_mode text, p_subject_canonical_kind text, p_subject_canonical_object_id text, p_subject_relationship_id text,
  p_subject_relationship_state_id text, p_method_id text, p_method_version text, p_model_provider text, p_model_id text,
  p_prompt_template_version text, p_traversal_policy_version text, p_representation_version text, p_hint_confidence numeric,
  p_cited_signal_ids uuid[])
RETURNS TABLE(hypothesis_id uuid, recorded_at timestamptz, semantic_fingerprint text, replayed boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp SET lock_timeout = '5s' AS $fn$
DECLARE
  v_identity text;
BEGIN
  v_identity := gov_repo.l15_require_machine_intake_identity_v1();
  IF pg_catalog.current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'READ_COMMITTED_REQUIRED';
  END IF;
  IF p_generator_kind = 'HUMAN' THEN
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'HUMAN_REQUIRES_VERIFIED_MEMBER';
  END IF;
  IF p_organisation_id IS NULL THEN
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'ORGANISATION_INELIGIBLE';
  END IF;
  PERFORM gov_repo.l15_lock_active_organisation_v1(p_organisation_id);
  RETURN QUERY SELECT * FROM gov_repo.l15_write_hypothesis_v1(p_organisation_id, p_intake_key, p_generator_kind,
    p_subject_mode, p_subject_canonical_kind, p_subject_canonical_object_id, p_subject_relationship_id,
    p_subject_relationship_state_id, p_method_id, p_method_version, p_model_provider, p_model_id, p_prompt_template_version,
    p_traversal_policy_version, p_representation_version, p_hint_confidence, p_cited_signal_ids, NULL, v_identity);
END;
$fn$;

CREATE FUNCTION gov_repo.l15_admit_human_hypothesis_v1(p_verified_organisation_id uuid, p_verified_actor_user_id uuid,
  p_verified_session_iat bigint, p_verified_session_exp bigint, p_verified_credential_epoch timestamptz,
  p_intake_key text, p_subject_mode text, p_subject_canonical_kind text, p_subject_canonical_object_id text,
  p_subject_relationship_id text, p_subject_relationship_state_id text, p_hint_confidence numeric, p_cited_signal_ids uuid[])
RETURNS TABLE(hypothesis_id uuid, recorded_at timestamptz, semantic_fingerprint text, replayed boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp SET lock_timeout = '5s' AS $fn$
BEGIN
  IF pg_catalog.current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'READ_COMMITTED_REQUIRED';
  END IF;
  PERFORM gov_repo.l15_require_member_v1(p_verified_organisation_id, p_verified_actor_user_id, p_verified_session_iat,
    p_verified_session_exp, p_verified_credential_epoch);
  RETURN QUERY SELECT * FROM gov_repo.l15_write_hypothesis_v1(p_verified_organisation_id, p_intake_key, 'HUMAN',
    p_subject_mode, p_subject_canonical_kind, p_subject_canonical_object_id, p_subject_relationship_id,
    p_subject_relationship_state_id, NULL, NULL, NULL, NULL, NULL, NULL, NULL, p_hint_confidence, p_cited_signal_ids,
    p_verified_actor_user_id, NULL);
END;
$fn$;

-- ---------------------------------------------------------------------------------------------------------------------
-- G. Read projections (SECURITY DEFINER, read-only; tenant from the verified member). Necessity: same as F (no application
--    privilege on L15 tables).
-- ---------------------------------------------------------------------------------------------------------------------
-- Signals on an exact subject (no inheritance), with the non-authoritative presentation. DETECTED_ABSENCE is literally
-- "not detected" — never "absent", "failed", "NOT_SATISFIED", "false" or "non-compliant" (UNKNOWN != FALSE).
CREATE FUNCTION gov_repo.l15_read_signals_v1(p_verified_organisation_id uuid, p_verified_actor_user_id uuid,
  p_verified_session_iat bigint, p_verified_session_exp bigint, p_verified_credential_epoch timestamptz,
  p_subject_mode text, p_subject_canonical_kind text, p_subject_canonical_object_id text, p_subject_relationship_id text,
  p_subject_relationship_state_id text)
RETURNS TABLE(signal_id uuid, signal_kind text, source_class text, trust_state text, method_id text, method_version text,
  hint_severity text, hint_confidence numeric, observed_at timestamptz, recorded_at timestamptz, support_status text,
  support_link_count bigint, observation_presentation text, authority text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp SET lock_timeout = '5s' AS $fn$
BEGIN
  PERFORM gov_repo.l15_require_member_v1(p_verified_organisation_id, p_verified_actor_user_id, p_verified_session_iat,
    p_verified_session_exp, p_verified_credential_epoch);
  PERFORM gov_repo.l15_require_subject_v1(p_verified_organisation_id, p_subject_mode, p_subject_canonical_kind,
    p_subject_canonical_object_id, p_subject_relationship_id, p_subject_relationship_state_id, NULL, false);
  RETURN QUERY
  SELECT s.signal_id, s.signal_kind, s.source_class, s.trust_state, s.method_id, s.method_version, s.hint_severity,
         s.hint_confidence, s.observed_at, s.recorded_at, s.support_status,
         (SELECT pg_catalog.count(*) FROM gov_repo.l15_support_links AS l
          WHERE l.organisation_id = s.organisation_id AND l.owner_kind = 'RISK_SIGNAL' AND l.owner_signal_id = s.signal_id),
         CASE s.signal_kind WHEN 'DETECTED_ABSENCE' THEN 'not detected' WHEN 'DETECTED_PATTERN' THEN 'detected'
                            WHEN 'GOVERNANCE_GAP_REF' THEN 'unknown' ELSE 'referenced' END,
         'NON_AUTHORITATIVE'::text
  FROM gov_repo.l15_risk_signals AS s
  WHERE s.organisation_id = p_verified_organisation_id AND s.subject_mode = p_subject_mode
    AND s.subject_canonical_kind IS NOT DISTINCT FROM p_subject_canonical_kind
    AND s.subject_canonical_object_id IS NOT DISTINCT FROM p_subject_canonical_object_id
    AND s.subject_relationship_id IS NOT DISTINCT FROM p_subject_relationship_id
    AND s.subject_relationship_state_id IS NOT DISTINCT FROM p_subject_relationship_state_id
  ORDER BY s.recorded_at, s.signal_id
  LIMIT 1000;
END;
$fn$;

-- Hypothesis disposition (§5.2): a read projection, never a stored status. A hypothesis no L15 governed artifact cites is
-- UNREVIEWED. At S1 no owner kind can cite a hypothesis (only the rank-3 GOVERNED_RISK / assessment / treatment /
-- acceptance owners of S3-S6 may), so CITED_BY_* have no instances yet; should a citing link of an owner kind this version
-- does not classify ever exist, the projection fails closed instead of inventing a disposition (S3 replaces it, additively).
-- Contradictory hypotheses are listed side by side; nothing is ranked or selected.
CREATE FUNCTION gov_repo.l15_read_hypothesis_dispositions_v1(p_verified_organisation_id uuid, p_verified_actor_user_id uuid,
  p_verified_session_iat bigint, p_verified_session_exp bigint, p_verified_credential_epoch timestamptz,
  p_subject_mode text, p_subject_canonical_kind text, p_subject_canonical_object_id text, p_subject_relationship_id text,
  p_subject_relationship_state_id text)
RETURNS TABLE(hypothesis_id uuid, generator_kind text, trust_state text, hint_confidence numeric, recorded_at timestamptz,
  cited_signal_count bigint, disposition text, authority text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp SET lock_timeout = '5s' AS $fn$
BEGIN
  PERFORM gov_repo.l15_require_member_v1(p_verified_organisation_id, p_verified_actor_user_id, p_verified_session_iat,
    p_verified_session_exp, p_verified_credential_epoch);
  PERFORM gov_repo.l15_require_subject_v1(p_verified_organisation_id, p_subject_mode, p_subject_canonical_kind,
    p_subject_canonical_object_id, p_subject_relationship_id, p_subject_relationship_state_id, NULL, false);
  IF EXISTS (SELECT 1 FROM gov_repo.l15_support_links AS l JOIN gov_repo.l15_risk_hypotheses AS h
               ON h.organisation_id = l.organisation_id AND h.hypothesis_id = l.target_risk_hypothesis_id
             WHERE l.organisation_id = p_verified_organisation_id AND l.target_tag = 'RISK_HYPOTHESIS'
               AND h.subject_mode = p_subject_mode) THEN
    RAISE EXCEPTION 'L15_PROJECTION_UNAVAILABLE' USING ERRCODE = 'GV010', DETAIL = 'HYPOTHESIS_CITATION_OWNER_UNCLASSIFIED';
  END IF;
  RETURN QUERY
  SELECT h.hypothesis_id, h.generator_kind, h.trust_state, h.hint_confidence, h.recorded_at,
         (SELECT pg_catalog.count(*) FROM gov_repo.l15_support_links AS l
          WHERE l.organisation_id = h.organisation_id AND l.owner_kind = 'RISK_HYPOTHESIS'
            AND l.owner_hypothesis_id = h.hypothesis_id),
         'UNREVIEWED'::text, 'NON_AUTHORITATIVE'::text
  FROM gov_repo.l15_risk_hypotheses AS h
  WHERE h.organisation_id = p_verified_organisation_id AND h.subject_mode = p_subject_mode
    AND h.subject_canonical_kind IS NOT DISTINCT FROM p_subject_canonical_kind
    AND h.subject_canonical_object_id IS NOT DISTINCT FROM p_subject_canonical_object_id
    AND h.subject_relationship_id IS NOT DISTINCT FROM p_subject_relationship_id
    AND h.subject_relationship_state_id IS NOT DISTINCT FROM p_subject_relationship_state_id
  ORDER BY h.recorded_at, h.hypothesis_id
  LIMIT 1000;
END;
$fn$;

-- ---------------------------------------------------------------------------------------------------------------------
-- H. Privileges and comments. REVOKE ALL from PUBLIC / anon / authenticated / service_role (and the capability role) on
--    every L15 table and routine, then grant only: service_role EXECUTE on the four member RPCs; the capability role
--    EXECUTE on the two machine intake RPCs. service_role holds ZERO direct L15 table privilege.
-- ---------------------------------------------------------------------------------------------------------------------
DO $acl$
DECLARE
  v_rel text;
  v_fn regprocedure;
BEGIN
  FOREACH v_rel IN ARRAY ARRAY['l15_risk_signals','l15_risk_hypotheses','l15_support_links'] LOOP
    EXECUTE pg_catalog.format('REVOKE ALL ON TABLE gov_repo.%I FROM PUBLIC, anon, authenticated, service_role, govia_l15_machine_intake_caller', v_rel);
  END LOOP;
  FOR v_fn IN SELECT p.oid::regprocedure FROM pg_catalog.pg_proc AS p
              WHERE p.pronamespace = 'gov_repo'::regnamespace AND p.proname LIKE 'l15\_%' ESCAPE '\'
                AND p.proname NOT IN ('l15_governance_permission_v1','l15_decision_rule_isolation_guard_v1',
                                      'l15_authorization_allow_guard_v1','l15_authority_policy_rule_admission_basis_guard_v1') LOOP
    EXECUTE pg_catalog.format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated, service_role, govia_l15_machine_intake_caller', v_fn);
  END LOOP;
END;
$acl$;
GRANT EXECUTE ON FUNCTION gov_repo.l15_admit_human_signal_v1(uuid,uuid,bigint,bigint,timestamp with time zone,text,text,text,text,text,text,text,timestamp with time zone,text[],text[]) TO service_role;
GRANT EXECUTE ON FUNCTION gov_repo.l15_admit_human_hypothesis_v1(uuid,uuid,bigint,bigint,timestamp with time zone,text,text,text,text,text,text,numeric,uuid[]) TO service_role;
GRANT EXECUTE ON FUNCTION gov_repo.l15_read_signals_v1(uuid,uuid,bigint,bigint,timestamp with time zone,text,text,text,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION gov_repo.l15_read_hypothesis_dispositions_v1(uuid,uuid,bigint,bigint,timestamp with time zone,text,text,text,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION gov_repo.l15_admit_machine_signal_v1(uuid,text,text,text,text,text,text,text,text,text,text,text,text,text,numeric,timestamp with time zone,text,text,text,uuid,text[],text[]) TO govia_l15_machine_intake_caller;
GRANT EXECUTE ON FUNCTION gov_repo.l15_admit_machine_hypothesis_v1(uuid,text,text,text,text,text,text,text,text,text,text,text,text,text,text,numeric,uuid[]) TO govia_l15_machine_intake_caller;

COMMENT ON TABLE gov_repo.l15_risk_signals IS
  'M17-S1 L15 RISK_SIGNAL (ADR-GOVIA-RISK-INTELLIGENCE-v1 §4). NON-AUTHORITATIVE evidence-backed reference record; not governed risk, not a decision, not canonical, not an L14 fact, never VALIDATED; no lifecycle / status / head. Insert-only; hint_* are non-authoritative source labels.';
COMMENT ON TABLE gov_repo.l15_risk_hypotheses IS
  'M17-S1 L15 RISK_HYPOTHESIS (§5). NON-AUTHORITATIVE analytical interpretation citing >= 1 exact signal; machine trust INFERRED only, HUMAN none; never VALIDATED; disposition is a read projection. Scenario reference deferred to S2 (absent = unclassified). Insert-only.';
COMMENT ON TABLE gov_repo.l15_support_links IS
  'M17-S1 L15 support / evidence closed tagged union (D-03, §9.1) with the acyclic §9.2 owner -> target matrix (S1 owners: RISK_SIGNAL -> rank 0, RISK_HYPOTHESIS -> RISK_SIGNAL). Exactly one typed composite same-tenant target per row; no JSON / array / free-text reference. Insert-only together with the owner. Distinct from gov_repo.l14_support_links (not reused, not widened).';
COMMENT ON ROLE govia_l15_machine_intake_caller IS
  'M17-S1 technical intake CAPABILITY (not authority): EXECUTE on the two L15 machine intake RPCs only; no table privilege; never service_role; never a governance decision actor.';

-- ---------------------------------------------------------------------------------------------------------------------
-- I. Postflight over the effective post-S1 catalog.
-- ---------------------------------------------------------------------------------------------------------------------
DO $postflight$
DECLARE
  v_app text[] := ARRAY['service_role','authenticated','anon'];
  v_privileges text[] := ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN'];
  v_rel record;
  v_role text;
  v_privilege text;
  v_definers text[];
BEGIN
  -- I1. Exactly the three L15 S1 tables (+ their indexes); no other L15 relation, no view / sequence.
  IF (SELECT pg_catalog.array_agg(c.relname::text ORDER BY c.relname::text COLLATE "C") FROM pg_catalog.pg_class AS c
      WHERE c.relnamespace = 'gov_repo'::regnamespace AND c.relname LIKE 'l15\_%' ESCAPE '\' AND c.relkind <> 'i')
     IS DISTINCT FROM ARRAY['l15_risk_hypotheses','l15_risk_signals','l15_support_links'] THEN
    RAISE EXCEPTION 'M17_S1_POSTFLIGHT: unexpected l15 relation set';
  END IF;
  -- I2. Zero application privilege (table, column, PUBLIC) on every L15 relation, inherited / default grants included.
  FOR v_rel IN SELECT c.oid, c.relname, c.relowner, c.relacl FROM pg_catalog.pg_class AS c
               WHERE c.relnamespace = 'gov_repo'::regnamespace AND c.relname LIKE 'l15\_%' ESCAPE '\' AND c.relkind <> 'i' LOOP
    IF EXISTS (SELECT 1 FROM pg_catalog.aclexplode(COALESCE(v_rel.relacl, pg_catalog.acldefault('r', v_rel.relowner))) AS a
               WHERE a.grantee = 0) THEN
      RAISE EXCEPTION 'M17_S1_POSTFLIGHT: PUBLIC grant on %', v_rel.relname;
    END IF;
    FOREACH v_role IN ARRAY (v_app || 'govia_l15_machine_intake_caller'::text) LOOP
      FOREACH v_privilege IN ARRAY v_privileges LOOP
        IF pg_catalog.has_table_privilege(v_role, v_rel.oid, v_privilege) THEN
          RAISE EXCEPTION 'M17_S1_POSTFLIGHT: % holds % on %', v_role, v_privilege, v_rel.relname;
        END IF;
      END LOOP;
      IF pg_catalog.has_any_column_privilege(v_role, v_rel.oid, 'SELECT, INSERT, UPDATE, REFERENCES') THEN
        RAISE EXCEPTION 'M17_S1_POSTFLIGHT: % holds a column privilege on %', v_role, v_rel.relname;
      END IF;
    END LOOP;
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_inherits AS h WHERE v_rel.oid IN (h.inhrelid, h.inhparent)) THEN
      RAISE EXCEPTION 'M17_S1_POSTFLIGHT: inheritance on %', v_rel.relname;
    END IF;
    -- Raising, ENABLE ALWAYS immutability (BEFORE UPDATE OR DELETE row trigger + BEFORE TRUNCATE statement trigger).
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger AS t WHERE t.tgrelid = v_rel.oid AND NOT t.tgisinternal
                     AND t.tgenabled = 'A' AND (t.tgtype & 2) <> 0 AND (t.tgtype & 8) <> 0 AND (t.tgtype & 16) <> 0)
       OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger AS t WHERE t.tgrelid = v_rel.oid AND NOT t.tgisinternal
                        AND t.tgenabled = 'A' AND (t.tgtype & 2) <> 0 AND (t.tgtype & 32) <> 0)
       OR EXISTS (SELECT 1 FROM pg_catalog.pg_trigger AS t WHERE t.tgrelid = v_rel.oid AND NOT t.tgisinternal AND t.tgenabled <> 'A') THEN
      RAISE EXCEPTION 'M17_S1_POSTFLIGHT: % immutability triggers incomplete', v_rel.relname;
    END IF;
    -- No json / jsonb / array column anywhere in L15 S1 (O84 and the no-EAV rule).
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_attribute AS att JOIN pg_catalog.pg_type AS ty ON ty.oid = att.atttypid
               WHERE att.attrelid = v_rel.oid AND att.attnum > 0 AND NOT att.attisdropped
                 AND (ty.typname IN ('json','jsonb') OR ty.typcategory = 'A')) THEN
      RAISE EXCEPTION 'M17_S1_POSTFLIGHT: json / array column on %', v_rel.relname;
    END IF;
  END LOOP;
  -- I3. No FK action can erase / rewrite L15 history; no FK of an L15 table references canonical_relationships (F2).
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_constraint AS k JOIN pg_catalog.pg_class AS c ON c.oid IN (k.conrelid, k.confrelid)
             WHERE k.contype = 'f' AND c.relnamespace = 'gov_repo'::regnamespace AND c.relname LIKE 'l15\_%' ESCAPE '\'
               AND (k.confdeltype IN ('c','n','d') OR k.confupdtype IN ('c','n','d')))
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_constraint AS k WHERE k.contype = 'f'
                  AND k.confrelid = 'gov_repo.canonical_relationships'::regclass
                  AND k.conrelid IN (SELECT c.oid FROM pg_catalog.pg_class AS c WHERE c.relnamespace = 'gov_repo'::regnamespace
                                       AND c.relname LIKE 'l15\_%' ESCAPE '\'))
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_trigger AS t WHERE t.tgrelid = 'gov_repo.canonical_relationships'::regclass AND NOT t.tgisinternal)
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_index AS i JOIN pg_catalog.pg_attribute AS att
                  ON att.attrelid = i.indrelid AND att.attnum = ANY (i.indkey::int2[])
                WHERE i.indrelid = 'gov_repo.canonical_relationships'::regclass AND att.attname = 'relationship_state_id') THEN
    RAISE EXCEPTION 'M17_S1_POSTFLIGHT: cascade / F2 boundary violated';
  END IF;
  -- I4. Every pre-existing gov_repo constraint and non-internal trigger is byte-identical; nothing added to an existing table.
  IF EXISTS (SELECT s.rel, s.conname, s.def FROM pg_temp.m17_s1_constraint_snapshot AS s
             EXCEPT SELECT k.conrelid::regclass::text, k.conname::text, pg_catalog.pg_get_constraintdef(k.oid)
                    FROM pg_catalog.pg_constraint AS k JOIN pg_catalog.pg_class AS c ON c.oid = k.conrelid
                    WHERE c.relnamespace = 'gov_repo'::regnamespace)
     OR EXISTS (SELECT k.conrelid::regclass::text, k.conname::text FROM pg_catalog.pg_constraint AS k
                  JOIN pg_catalog.pg_class AS c ON c.oid = k.conrelid
                WHERE c.relnamespace = 'gov_repo'::regnamespace AND c.relname NOT LIKE 'l15\_%' ESCAPE '\'
                EXCEPT SELECT s.rel, s.conname FROM pg_temp.m17_s1_constraint_snapshot AS s)
     OR EXISTS (SELECT s.rel, s.tgname, s.enabled, s.fn FROM pg_temp.m17_s1_trigger_snapshot AS s
                EXCEPT SELECT t.tgrelid::regclass::text, t.tgname::text, t.tgenabled::text, t.tgfoid::regprocedure::text
                       FROM pg_catalog.pg_trigger AS t JOIN pg_catalog.pg_class AS c ON c.oid = t.tgrelid
                       WHERE c.relnamespace = 'gov_repo'::regnamespace AND NOT t.tgisinternal)
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_trigger AS t JOIN pg_catalog.pg_class AS c ON c.oid = t.tgrelid
                WHERE c.relnamespace = 'gov_repo'::regnamespace AND NOT t.tgisinternal AND c.relname NOT LIKE 'l15\_%' ESCAPE '\'
                  AND NOT EXISTS (SELECT 1 FROM pg_temp.m17_s1_trigger_snapshot AS s
                                  WHERE s.rel = t.tgrelid::regclass::text AND s.tgname = t.tgname::text)) THEN
    RAISE EXCEPTION 'M17_S1_POSTFLIGHT: a pre-existing gov_repo constraint / trigger changed';
  END IF;
  -- I5. Every L15 routine: pinned search_path, no PUBLIC EXECUTE; exactly six SECURITY DEFINER routines, owner postgres:
  --     four EXECUTE-able by exactly service_role (+ owner), two by exactly the capability role (+ owner).
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_proc AS p WHERE p.pronamespace = 'gov_repo'::regnamespace
               AND p.proname LIKE 'l15\_%' ESCAPE '\'
               AND (p.proconfig IS NULL OR NOT ('search_path=pg_catalog, pg_temp' = ANY (p.proconfig))
                    OR EXISTS (SELECT 1 FROM pg_catalog.aclexplode(COALESCE(p.proacl, pg_catalog.acldefault('f', p.proowner))) AS a
                               WHERE a.grantee = 0))) THEN
    RAISE EXCEPTION 'M17_S1_POSTFLIGHT: an l15 routine has an unpinned search_path or PUBLIC EXECUTE';
  END IF;
  v_definers := ARRAY(SELECT p.proname::text FROM pg_catalog.pg_proc AS p WHERE p.pronamespace = 'gov_repo'::regnamespace
                        AND p.proname LIKE 'l15\_%' ESCAPE '\' AND p.prosecdef ORDER BY p.proname::text COLLATE "C");
  IF v_definers IS DISTINCT FROM ARRAY['l15_admit_human_hypothesis_v1','l15_admit_human_signal_v1',
       'l15_admit_machine_hypothesis_v1','l15_admit_machine_signal_v1','l15_read_hypothesis_dispositions_v1',
       'l15_read_signals_v1'] THEN
    RAISE EXCEPTION 'M17_S1_POSTFLIGHT: unexpected l15 SECURITY DEFINER set %', v_definers;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_proc AS p WHERE p.pronamespace = 'gov_repo'::regnamespace
               AND p.proname LIKE 'l15\_%' ESCAPE '\'
               AND (p.proowner <> 'postgres'::regrole
                    OR EXISTS (SELECT 1 FROM pg_catalog.aclexplode(COALESCE(p.proacl, pg_catalog.acldefault('f', p.proowner))) AS a
                               WHERE a.grantee <> p.proowner AND NOT (
                                 (p.proname IN ('l15_admit_human_signal_v1','l15_admit_human_hypothesis_v1','l15_read_signals_v1',
                                                'l15_read_hypothesis_dispositions_v1')
                                  AND a.grantee = 'service_role'::regrole AND a.privilege_type = 'EXECUTE')
                                 OR (p.proname IN ('l15_admit_machine_signal_v1','l15_admit_machine_hypothesis_v1')
                                     AND a.grantee = 'govia_l15_machine_intake_caller'::regrole AND a.privilege_type = 'EXECUTE')))
                    OR ((SELECT pg_catalog.count(*) FROM pg_catalog.pg_proc AS q
                         WHERE q.pronamespace = p.pronamespace AND q.proname = p.proname) <> 1))) THEN
    RAISE EXCEPTION 'M17_S1_POSTFLIGHT: l15 routine owner / EXECUTE ACL / overload';
  END IF;
  -- I6. Application SECURITY DEFINER surface 45 -> 49 (the four member RPCs); the capability role reaches exactly the two
  --     machine intake RPCs and nothing else (no L14 / L15 propose / decide / admit, no table).
  IF (SELECT pg_catalog.count(*) FROM pg_catalog.pg_proc AS p
       WHERE p.prosecdef AND p.pronamespace NOT IN ('pg_catalog'::regnamespace, 'information_schema'::regnamespace)
         AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_depend AS d
                          WHERE d.classid = 'pg_catalog.pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e')
         AND (pg_catalog.has_function_privilege('service_role', p.oid, 'EXECUTE')
              OR pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE')
              OR pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE')
              OR EXISTS (SELECT 1 FROM pg_catalog.aclexplode(COALESCE(p.proacl, pg_catalog.acldefault('f', p.proowner))) AS a
                          WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE'))) <> 49 THEN
    RAISE EXCEPTION 'M17_S1_POSTFLIGHT: application SECURITY DEFINER surface is not exactly 49';
  END IF;
  IF (SELECT pg_catalog.array_agg(p.proname::text ORDER BY p.proname::text COLLATE "C") FROM pg_catalog.pg_proc AS p
      WHERE p.pronamespace NOT IN ('pg_catalog'::regnamespace, 'information_schema'::regnamespace)
        AND pg_catalog.has_function_privilege('govia_l15_machine_intake_caller', p.oid, 'EXECUTE')
        AND (p.prosecdef OR p.pronamespace = 'gov_repo'::regnamespace))
     IS DISTINCT FROM ARRAY['l15_admit_machine_hypothesis_v1','l15_admit_machine_signal_v1']
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_roles AS r WHERE r.rolname = 'govia_l15_machine_intake_caller'
                  AND (r.rolcanlogin OR r.rolsuper OR r.rolbypassrls OR r.rolcreaterole OR r.rolcreatedb OR r.rolinherit))
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members AS m WHERE m.member = 'govia_l15_machine_intake_caller'::regrole)
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_class AS c WHERE c.relnamespace = 'gov_repo'::regnamespace
                  AND c.relkind IN ('r','p','v','m','f','S')
                  AND (pg_catalog.has_table_privilege('govia_l15_machine_intake_caller', c.oid,
                         'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN')
                       OR (c.relkind <> 'S' AND pg_catalog.has_any_column_privilege('govia_l15_machine_intake_caller', c.oid,
                         'SELECT,INSERT,UPDATE,REFERENCES')))) THEN
    RAISE EXCEPTION 'M17_S1_POSTFLIGHT: machine intake capability surface is not exactly the two intake RPCs';
  END IF;
  -- I7. Frozen enumerations: 11 kinds, 12 relationship types, five M16 fact families; RISK_SIGNAL / RISK_HYPOTHESIS are in no
  --     governance subject vocabulary; no L15 governance / authorization / proposal row was written by this migration.
  IF (SELECT pg_catalog.array_agg(m.v[1] ORDER BY m.v[1] COLLATE "C")
      FROM pg_catalog.pg_constraint AS k
      CROSS JOIN LATERAL pg_catalog.regexp_matches(pg_catalog.pg_get_constraintdef(k.oid), '''([A-Z_]+)''', 'g') AS m(v)
      WHERE k.conrelid = 'gov_repo.canonical_objects'::regclass AND k.conname = 'canonical_objects_kind_check')
     IS DISTINCT FROM ARRAY['AGENT','AGENT_VERSION','API','DATA_ASSET','DATA_ELEMENT','KNOWLEDGE_BASE','MCP_SERVER',
                            'MODEL','PROMPT','SKILL','TOOL']
     OR (SELECT pg_catalog.array_agg(m.v[1] ORDER BY m.v[1] COLLATE "C")
      FROM pg_catalog.pg_constraint AS k
      CROSS JOIN LATERAL pg_catalog.regexp_matches(pg_catalog.pg_get_constraintdef(k.oid), '''([A-Z_]+)''', 'g') AS m(v)
      WHERE k.conrelid = 'gov_repo.canonical_relationships'::regclass AND k.conname = 'canonical_relationships_type_check')
     IS DISTINCT FROM ARRAY['DERIVED_FROM','EXPOSES','HANDOFF_TO','INVOKES','READS_FROM','USES_KNOWLEDGE_BASE','USES_MCP',
                            'USES_MODEL','USES_PROMPT','USES_SKILL','USES_TOOL','WRITES_TO']
     OR (SELECT pg_catalog.array_agg(m.v[1] ORDER BY m.v[1] COLLATE "C")
      FROM pg_catalog.pg_constraint AS k
      CROSS JOIN LATERAL pg_catalog.regexp_matches(pg_catalog.pg_get_constraintdef(k.oid), '''([A-Z_]+)''', 'g') AS m(v)
      WHERE k.conrelid = 'gov_repo.l14_fact_states'::regclass AND k.conname = 'l14_fact_states_subject_kind_check')
     IS DISTINCT FROM ARRAY['BUSINESS_CONTEXT_ASSIGNMENT','CONTROL_APPLICABILITY','CONTROL_ASSESSMENT','POLICY_APPLICABILITY',
                            'RESPONSIBILITY_ASSIGNMENT']
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_constraint AS k
                WHERE k.conrelid IN ('gov_repo.l14_authorization_decisions'::regclass, 'gov_repo.l14_proposals'::regclass,
                                     'gov_repo.l14_governance_decisions'::regclass, 'gov_repo.l14_command_results'::regclass)
                  AND pg_catalog.pg_get_constraintdef(k.oid) ~ 'RISK_(SIGNAL|HYPOTHESIS)') THEN
    RAISE EXCEPTION 'M17_S1_POSTFLIGHT: frozen vocabularies changed';
  END IF;
END;
$postflight$;

COMMIT;
