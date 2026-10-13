-- M17-S2: RISK_SCENARIO_DEFINITION + RISK_METHODOLOGY governed L15 supporting registries (DB only, ADDITIVE).
-- Architecture (ACCEPTED / FROZEN, not modified): docs/architecture/ADR-GOVIA-RISK-INTELLIGENCE-v1.md §§7, 8.2, 9.2, 11, 12,
-- 16, 17, 24, 26 (O19-O21; inherited O01, O02, O04-O07, O53-O62, O73-O84, O85-O91);
-- docs/architecture/ADR-GOVIA-M16-AUTHORITY-POLICY-M17-EXTENSION-v1.md (D-01) §4 (the command-result L15 decision branch,
-- dependency-deferred by S0 to the slices that create L15 state stores). Additive only; no historical migration edited.
-- Never run against a hosted DB from this slice.
--
-- Reuses the M16 CONTROL_DEFINITION GOVERNANCE PATTERN (stable tenant-scoped identity -> immutable admitted versions ->
-- DB-computed content hash -> typed proposal -> authorization -> governance decision -> immutable VALIDATED / REVOKED
-- state -> reconstructible technical head -> exact bitemporal resolver) with persistence in L15-SPECIFIC STORES ONLY:
--   * NOT used / NOT widened: l14_registry_states, l14_fact_states, l14_support_links and every M16 typed table. Each L15
--     typed state row carries its own envelope pins (proposal, governance decision, ALLOW authorization, Authority Policy
--     version + hash, source class, support) with exact composite FKs into the shared envelope.
--   * Shared envelope used unchanged in vocabulary: l14_authorization_decisions (+ rule / role snapshots), l14_proposals,
--     l14_governance_decisions, l14_command_results. The single change to the envelope is the S0-deferred D-01 §4 L15
--     decision-result branch: one nullable l14_command_results.l15_state_id (an L15 state id, never a registry / fact
--     state), its shape branch and an owner-only guard that it names the exact L15 state of that decision.
--   * The single existing Authority Policy root; no second root, no L15 bootstrap. ADMIT = L15_RISK_SCENARIO_ADMIT /
--     L15_RISK_METHODOLOGY_ADMIT; VALIDATE / REJECT / DEFER / REVOKE = L15_RISK_SCENARIO_VALIDATE /
--     L15_RISK_METHODOLOGY_VALIDATE (requested action = the exact outcome), organisation-wide (ALL_ALLOWED_TARGETS)
--     only, through gov_repo.l15_governance_permission_v1. Reason codes: the unchanged subject x outcome rule.
--   * Scenario version content: exactly one of the nine frozen domains; a non-empty normalized set of legal subject-kind
--     tokens (subset of the closed §8.2 domain x subject matrix; no inheritance; PROMPT / KNOWLEDGE_BASE / SKILL are not
--     direct subjects); >= 1 normalized typed reference code (closed namespace + bounded code; descriptive provenance only).
--   * Methodology version content: two ordered closed scales (2..7 levels; unique code; contiguous ordinal 1..n; typed
--     definition reference), a TOTAL lookup rating matrix (every likelihood x impact pair -> exactly one of LOW / MODERATE /
--     HIGH / CRITICAL; no arithmetic), and a positive assessment-validity maximum (interval). The scale ordinal is the only
--     numeric column of any L15 store; no score / weight / percentage exists.
--   * PostgreSQL computes both content hashes (input order irrelevant); the caller hash is an assertion. The stored
--     normalized content is re-hashed at commit and must equal the stored hash.
--   * SYSTEM_SEED is provenance, never authority: no seed rows, no default methodology, no machine path. A SYSTEM_SEED
--     version / proposal is human-mediated (verified ACTIVE member; ADMIT still needs the L15 ADMIT permission), carries
--     PRESENT support, never validates itself and can become VALIDATED only through a normal authorized human decision.
--     govia_l15_machine_intake_caller is NOT granted anything (its closed S1R1 surface stays exactly the two intake RPCs).
--   * l15_support_links widened additively with the rank-3 registry owners (proposal / decision / state of the two
--     registries) -> DISCOVERY_EVIDENCE / SOURCE_ASSERTION only (§9.2); S1 owners, rows and rules unchanged.
--   * Optional hypothesis -> scenario pin: DEPENDENCY-DEFERRED (not created here; see evidence): adding it would require
--     replacing the frozen S1 intake RPCs or a new machine-callable RPC (widening the S1R1 closed LOGIN surface).
--
-- Sections: A preflight + capture; B shared owner-only helpers; C tables; D l15_support_links / l14_command_results
-- additive widening; E guards; F result projections + resolvers; G RPCs; H immutability, privileges, comments; I postflight.
BEGIN;

-- ---------------------------------------------------------------------------------------------------------------------
-- A. Preflight: exactly the post-M17-S1R1 catalog, or abort with nothing applied.
-- ---------------------------------------------------------------------------------------------------------------------
DO $preflight$
BEGIN
  IF pg_catalog.current_setting('server_version_num')::integer NOT BETWEEN 170000 AND 179999 OR current_user <> 'postgres'
     OR pg_catalog.current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'M17_S2_PREFLIGHT: PostgreSQL 17 / postgres / READ COMMITTED required' USING ERRCODE = '55000';
  END IF;
  IF (SELECT pg_catalog.array_agg(c.relname::text ORDER BY c.relname::text COLLATE "C") FROM pg_catalog.pg_class AS c
      WHERE c.relnamespace = 'gov_repo'::regnamespace AND c.relname LIKE 'l15\_%' ESCAPE '\' AND c.relkind IN ('r','p','v','m','S','f'))
     IS DISTINCT FROM ARRAY['l15_risk_hypotheses','l15_risk_signals','l15_support_links']
     OR pg_catalog.to_regprocedure('gov_repo.l15_machine_role_safe_v1(oid,text)') IS NULL
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles AS r WHERE r.rolname = 'govia_l15_machine_intake_caller')
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_proc AS p WHERE p.pronamespace = 'gov_repo'::regnamespace
                AND p.proname ~ '^l15_(admit_(scenario|methodology)|submit_|decide_|risk_scenario|risk_methodology|registry)')
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_attribute AS a WHERE a.attrelid = 'gov_repo.l14_command_results'::regclass
                AND a.attname = 'l15_state_id') THEN
    RAISE EXCEPTION 'M17_S2_PREFLIGHT: the post-M17-S1R1 catalog is required (an S2 object already exists)' USING ERRCODE = '55000';
  END IF;
  IF (SELECT pg_catalog.count(*) FROM pg_catalog.pg_proc AS p
       WHERE p.prosecdef AND p.pronamespace NOT IN ('pg_catalog'::regnamespace, 'information_schema'::regnamespace)
         AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_depend AS d
                          WHERE d.classid = 'pg_catalog.pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e')
         AND (pg_catalog.has_function_privilege('service_role', p.oid, 'EXECUTE')
              OR pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE')
              OR pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE')
              OR EXISTS (SELECT 1 FROM pg_catalog.aclexplode(COALESCE(p.proacl, pg_catalog.acldefault('f', p.proowner))) AS a
                          WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE'))) <> 49
     OR (SELECT pg_catalog.count(*) FROM pg_catalog.pg_proc AS p WHERE p.pronamespace = 'gov_repo'::regnamespace
         AND p.proname LIKE 'l15\_%' ESCAPE '\' AND p.prosecdef) <> 7 THEN
    RAISE EXCEPTION 'M17_S2_PREFLIGHT: definer surface is not the post-S1R1 baseline (49 application / 7 L15)' USING ERRCODE = '55000';
  END IF;
  -- The frozen D-01 envelope keys this slice binds to.
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint AS k WHERE k.conrelid = 'gov_repo.l14_governance_decisions'::regclass
                   AND k.conname = 'l14_governance_decisions_state_link_unique' AND k.contype = 'u')
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint AS k WHERE k.conrelid = 'gov_repo.l14_authorization_decisions'::regclass
                      AND k.conname = 'l14_authorization_decisions_basis_unique' AND k.contype = 'u')
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint AS k WHERE k.conrelid = 'gov_repo.l14_proposals'::regclass
                      AND k.conname = 'l14_proposals_subject_unique' AND k.contype = 'u')
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint AS k WHERE k.conrelid = 'gov_repo.l14_command_results'::regclass
                      AND k.conname = 'l14_command_results_command_kind_check'
                      AND pg_catalog.pg_get_constraintdef(k.oid) LIKE '%ADMIT_RISK_SCENARIO_DEFINITION_VERSION%'
                      AND pg_catalog.pg_get_constraintdef(k.oid) LIKE '%ADMIT_RISK_METHODOLOGY_VERSION%')
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint AS k WHERE k.conrelid = 'gov_repo.l14_authority_policy_rules'::regclass
                      AND k.conname = 'l14_authority_policy_rules_l15_registry_scope_check')
     OR gov_repo.l15_governance_permission_v1('RISK_SCENARIO_DEFINITION', 'ADMIT') IS DISTINCT FROM 'L15_RISK_SCENARIO_ADMIT'
     OR gov_repo.l15_governance_permission_v1('RISK_METHODOLOGY', 'REVOKE') IS DISTINCT FROM 'L15_RISK_METHODOLOGY_VALIDATE' THEN
    RAISE EXCEPTION 'M17_S2_PREFLIGHT: the D-01 shared-envelope keys differ from the inspected catalog' USING ERRCODE = '55000';
  END IF;
  -- No L15 registry governance history may pre-exist (nothing before S2 could write any).
  IF EXISTS (SELECT 1 FROM gov_repo.l14_proposals AS p WHERE p.subject_kind IN ('RISK_SCENARIO_DEFINITION','RISK_METHODOLOGY'))
     OR EXISTS (SELECT 1 FROM gov_repo.l14_authorization_decisions AS a WHERE a.subject_kind IN ('RISK_SCENARIO_DEFINITION','RISK_METHODOLOGY'))
     OR EXISTS (SELECT 1 FROM gov_repo.l14_governance_decisions AS d WHERE d.subject_kind IN ('RISK_SCENARIO_DEFINITION','RISK_METHODOLOGY'))
     OR EXISTS (SELECT 1 FROM gov_repo.l14_command_results AS c WHERE c.subject_kind IN ('RISK_SCENARIO_DEFINITION','RISK_METHODOLOGY')) THEN
    RAISE EXCEPTION 'M17_S2_PREFLIGHT: L15 registry governance history already exists' USING ERRCODE = '55000';
  END IF;
END;
$preflight$;

-- Snapshot of every pre-existing gov_repo constraint / non-internal trigger and an order-independent row hash of the M16
-- governance envelope, the M16 typed registry / fact stores and the S1 L15 stores: the postflight proves S2 changed none of
-- them except the enumerated additive widenings.
CREATE TEMPORARY TABLE m17_s2_constraint_snapshot ON COMMIT DROP AS
  SELECT k.conrelid::regclass::text AS rel, k.conname::text AS conname, pg_catalog.pg_get_constraintdef(k.oid) AS def
  FROM pg_catalog.pg_constraint AS k JOIN pg_catalog.pg_class AS c ON c.oid = k.conrelid
  WHERE c.relnamespace = 'gov_repo'::regnamespace;
CREATE TEMPORARY TABLE m17_s2_trigger_snapshot ON COMMIT DROP AS
  SELECT t.tgrelid::regclass::text AS rel, t.tgname::text AS tgname, t.tgenabled::text AS enabled, t.tgfoid::regprocedure::text AS fn
  FROM pg_catalog.pg_trigger AS t JOIN pg_catalog.pg_class AS c ON c.oid = t.tgrelid
  WHERE c.relnamespace = 'gov_repo'::regnamespace AND NOT t.tgisinternal;
CREATE TEMPORARY TABLE m17_s2_row_capture (relation text PRIMARY KEY, row_count bigint NOT NULL, row_hash text NOT NULL) ON COMMIT DROP;
DO $capture$
DECLARE
  v_rel text;
  v_count bigint;
  v_hash text;
BEGIN
  FOR v_rel IN SELECT c.relname::text FROM pg_catalog.pg_class AS c
               WHERE c.relnamespace = 'gov_repo'::regnamespace AND c.relkind = 'r'
                 AND (c.relname LIKE 'l14\_%' ESCAPE '\' OR c.relname LIKE 'l15\_%' ESCAPE '\') LOOP
    EXECUTE pg_catalog.format(
      'SELECT pg_catalog.count(*), COALESCE(pg_catalog.md5(pg_catalog.string_agg(t::text, %L ORDER BY t::text COLLATE "C")), %L) FROM gov_repo.%I AS t',
      E'\n', 'EMPTY', v_rel) INTO v_count, v_hash;
    INSERT INTO m17_s2_row_capture (relation, row_count, row_hash) VALUES (v_rel, v_count, v_hash);
  END LOOP;
END;
$capture$;

-- ---------------------------------------------------------------------------------------------------------------------
-- B. Shared owner-only helpers (SECURITY INVOKER; EXECUTE revoked from every application role and the capability).
-- ---------------------------------------------------------------------------------------------------------------------
-- EXCLUSIVE per-subject guard for the two L15 registries (the M16 helper accepts only M16 registry kinds and is not
-- widened): organisation + subject kind + stable key, framed with the repository's length-prefixed frame_identity.
CREATE FUNCTION gov_repo.l15_lock_registry_subject_guard_v1(p_organisation_id uuid, p_subject_kind text, p_subject_key text)
RETURNS void LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, pg_temp AS $guard$
BEGIN
  IF p_organisation_id IS NULL OR p_subject_kind IS NULL OR p_subject_kind NOT IN ('RISK_SCENARIO_DEFINITION','RISK_METHODOLOGY')
     OR p_subject_key IS NULL OR pg_catalog.length(p_subject_key) NOT BETWEEN 1 AND 500
     OR p_subject_key <> pg_catalog.btrim(p_subject_key) THEN
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'GUARD_KEY_INVALID';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    gov_repo.frame_identity(ARRAY[p_organisation_id::text, 'l15-registry-subject-guard-v1', p_subject_kind, p_subject_key]), 0));
END;
$guard$;

-- The closed §8.2 domain x subject matrix (D-07). Subject tokens: the eight legal object kinds and REL:<one of the 12
-- frozen relationship types>. Every other pairing (and every unknown domain / token) is illegal. No inheritance.
CREATE FUNCTION gov_repo.l15_risk_domain_subject_legal_v1(p_risk_domain text, p_subject_kind text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, pg_temp AS $fn$
  SELECT COALESCE(
        (p_risk_domain = 'PRIVACY' AND p_subject_kind IN ('AGENT_VERSION','DATA_ASSET','DATA_ELEMENT','REL:READS_FROM','REL:WRITES_TO','REL:DERIVED_FROM'))
    OR     (p_risk_domain = 'CYBERSECURITY' AND p_subject_kind IN ('AGENT_VERSION','MODEL','TOOL','MCP_SERVER','API','REL:USES_TOOL','REL:USES_MCP','REL:INVOKES','REL:EXPOSES','REL:USES_PROMPT'))
    OR     (p_risk_domain = 'AUTHORIZATION' AND p_subject_kind IN ('AGENT_VERSION','TOOL','MCP_SERVER','API','REL:USES_TOOL','REL:USES_MCP','REL:INVOKES','REL:READS_FROM','REL:WRITES_TO'))
    OR     (p_risk_domain = 'AUTONOMY' AND p_subject_kind IN ('AGENT_VERSION','REL:HANDOFF_TO','REL:USES_TOOL','REL:USES_MCP','REL:INVOKES','REL:WRITES_TO'))
    OR     (p_risk_domain = 'MODEL' AND p_subject_kind IN ('MODEL','AGENT_VERSION','REL:USES_MODEL'))
    OR     (p_risk_domain = 'DATA' AND p_subject_kind IN ('DATA_ASSET','DATA_ELEMENT','REL:READS_FROM','REL:WRITES_TO','REL:DERIVED_FROM','REL:USES_KNOWLEDGE_BASE'))
    OR     (p_risk_domain = 'CONNECTIVITY' AND p_subject_kind IN ('AGENT_VERSION','TOOL','MCP_SERVER','API','REL:INVOKES','REL:USES_MCP','REL:USES_TOOL'))
    OR     (p_risk_domain = 'OPERATIONAL' AND p_subject_kind IN ('AGENT','AGENT_VERSION','MODEL','TOOL','MCP_SERVER','API','REL:USES_MODEL','REL:USES_TOOL','REL:USES_MCP','REL:INVOKES','REL:USES_PROMPT','REL:USES_KNOWLEDGE_BASE','REL:USES_SKILL','REL:EXPOSES','REL:HANDOFF_TO','REL:READS_FROM','REL:WRITES_TO','REL:DERIVED_FROM'))
    OR     (p_risk_domain = 'FINOPS' AND p_subject_kind IN ('AGENT_VERSION','MODEL','API','REL:USES_MODEL','REL:INVOKES')), false)
$fn$;

-- Typed scenario reference codes: closed namespace, bounded syntactically constrained code. Descriptive only.
--   SCANNER_RULE_ID            scanner DetectedRisk rule id (e.g. RISK-NO-README)
--   CG_AG_CONTROL_ID           CG-AG traceability id (e.g. CG-AG-001)
--   ORGANISATION_SCENARIO_CODE organisation-local bounded scenario code
CREATE FUNCTION gov_repo.l15_scenario_reference_code_valid_v1(p_namespace text, p_code text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, pg_temp AS $fn$
  SELECT COALESCE(pg_catalog.length(p_code) BETWEEN 1 AND 64 AND CASE p_namespace
    WHEN 'SCANNER_RULE_ID' THEN p_code COLLATE "C" ~ '^RISK-[A-Z0-9]+(-[A-Z0-9]+)*$'
    WHEN 'CG_AG_CONTROL_ID' THEN p_code COLLATE "C" ~ '^CG-AG-[0-9]{3}$'
    WHEN 'ORGANISATION_SCENARIO_CODE' THEN p_code COLLATE "C" ~ '^[A-Z][A-Z0-9]*([_.-][A-Z0-9]+)*$'
    ELSE false END, false)
$fn$;

-- Methodology level code and typed level-definition reference (closed namespace ORGANISATION_DEFINITION_CODE).
CREATE FUNCTION gov_repo.l15_methodology_level_code_valid_v1(p_code text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, pg_temp AS $fn$
  SELECT COALESCE(p_code COLLATE "C" ~ '^[A-Z][A-Z0-9_]{0,31}$', false)
$fn$;
CREATE FUNCTION gov_repo.l15_methodology_definition_reference_valid_v1(p_namespace text, p_code text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, pg_temp AS $fn$
  SELECT COALESCE(p_namespace = 'ORGANISATION_DEFINITION_CODE' AND pg_catalog.length(p_code) BETWEEN 1 AND 64
    AND p_code COLLATE "C" ~ '^[A-Z][A-Z0-9]*([_.-][A-Z0-9]+)*$', false)
$fn$;

-- Exact decomposition of a positive assessment-validity maximum: [months, days, time microseconds], each >= 0, not all
-- zero (no sign mixing, no zero / negative maximum). NULL = invalid. Never a number-of-days score.
CREATE FUNCTION gov_repo.l15_assessment_validity_maximum_parts_v1(p_value interval)
RETURNS text[] LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, pg_temp AS $fn$
  SELECT CASE WHEN x.months >= 0 AND x.days >= 0 AND x.micros >= 0 AND (x.months + x.days + x.micros) > 0
              THEN ARRAY[x.months::bigint::text, x.days::bigint::text, x.micros::bigint::text] END
  FROM (SELECT EXTRACT(year FROM p_value) * 12 + EXTRACT(month FROM p_value) AS months,
               EXTRACT(day FROM p_value) AS days,
               (EXTRACT(hour FROM p_value) * 3600 + EXTRACT(minute FROM p_value) * 60) * 1000000
                 + EXTRACT(microseconds FROM p_value) AS micros) AS x
$fn$;

-- Syntactic scenario content check (no table read). Stable closed error details.
CREATE FUNCTION gov_repo.l15_risk_scenario_content_check_v1(p_risk_domain text, p_subject_kinds text[],
  p_reference_namespaces text[], p_reference_codes text[])
RETURNS void LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog, pg_temp AS $fn$
BEGIN
  IF p_risk_domain IS NULL OR p_risk_domain NOT IN ('PRIVACY','CYBERSECURITY','AUTHORIZATION','AUTONOMY','MODEL','DATA','CONNECTIVITY','OPERATIONAL','FINOPS') THEN
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'RISK_DOMAIN_UNKNOWN';
  END IF;
  IF p_subject_kinds IS NULL OR (pg_catalog.cardinality(p_subject_kinds) > 0 AND pg_catalog.array_ndims(p_subject_kinds) <> 1)
     OR pg_catalog.array_position(p_subject_kinds, NULL::text) IS NOT NULL OR pg_catalog.cardinality(p_subject_kinds) > 20 THEN
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'SUBJECT_KINDS_MALFORMED';
  END IF;
  IF pg_catalog.cardinality(p_subject_kinds) = 0 THEN
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'SUBJECT_KINDS_EMPTY';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.unnest(p_subject_kinds) AS s(v) WHERE s.v NOT IN ('AGENT','AGENT_VERSION','MODEL','TOOL','MCP_SERVER','API','DATA_ASSET','DATA_ELEMENT','REL:USES_MODEL','REL:USES_TOOL','REL:USES_MCP','REL:INVOKES','REL:USES_PROMPT','REL:USES_KNOWLEDGE_BASE','REL:USES_SKILL','REL:EXPOSES','REL:HANDOFF_TO','REL:READS_FROM','REL:WRITES_TO','REL:DERIVED_FROM')) THEN
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'SUBJECT_KIND_UNKNOWN';
  END IF;
  IF (SELECT pg_catalog.count(DISTINCT s.v) FROM pg_catalog.unnest(p_subject_kinds) AS s(v)) <> pg_catalog.cardinality(p_subject_kinds) THEN
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'SUBJECT_KIND_DUPLICATE';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.unnest(p_subject_kinds) AS s(v)
             WHERE NOT gov_repo.l15_risk_domain_subject_legal_v1(p_risk_domain, s.v)) THEN
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'DOMAIN_SUBJECT_ILLEGAL';
  END IF;
  IF p_reference_namespaces IS NULL OR p_reference_codes IS NULL
     OR pg_catalog.cardinality(p_reference_namespaces) <> pg_catalog.cardinality(p_reference_codes)
     OR pg_catalog.cardinality(p_reference_namespaces) NOT BETWEEN 1 AND 32
     OR pg_catalog.array_ndims(p_reference_namespaces) <> 1 OR pg_catalog.array_ndims(p_reference_codes) <> 1
     OR pg_catalog.array_position(p_reference_namespaces, NULL::text) IS NOT NULL
     OR pg_catalog.array_position(p_reference_codes, NULL::text) IS NOT NULL THEN
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'REFERENCES_MALFORMED';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.unnest(p_reference_namespaces) AS n(v)
             WHERE n.v NOT IN ('SCANNER_RULE_ID','CG_AG_CONTROL_ID','ORGANISATION_SCENARIO_CODE')) THEN
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'REFERENCE_NAMESPACE_UNKNOWN';
  END IF;
  IF EXISTS (SELECT 1 FROM ROWS FROM (pg_catalog.unnest(p_reference_namespaces), pg_catalog.unnest(p_reference_codes)) AS r(ns, code)
             WHERE NOT gov_repo.l15_scenario_reference_code_valid_v1(r.ns, r.code)) THEN
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'REFERENCE_CODE_MALFORMED';
  END IF;
  IF (SELECT pg_catalog.count(DISTINCT (r.ns, r.code)) FROM ROWS FROM (pg_catalog.unnest(p_reference_namespaces),
        pg_catalog.unnest(p_reference_codes)) AS r(ns, code)) <> pg_catalog.cardinality(p_reference_namespaces) THEN
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'REFERENCE_DUPLICATE';
  END IF;
END;
$fn$;

-- Canonical scenario content hash (input order irrelevant): lowercase hex SHA-256 of the length-framed parts
-- (L15_RISK_SCENARIO_DEFINITION_CONTENT_V1, RISK_DOMAIN, domain, SUBJECT_KINDS, n, subject tokens in UTF-8 byte order,
-- REFERENCES, m, (namespace, code) pairs in UTF-8 byte order of namespace then code).
CREATE FUNCTION gov_repo.l15_risk_scenario_content_hash_v1(p_risk_domain text, p_subject_kinds text[],
  p_reference_namespaces text[], p_reference_codes text[])
RETURNS text LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $fn$
  SELECT gov_repo.l14_sha256_frame_v1(
    ARRAY['L15_RISK_SCENARIO_DEFINITION_CONTENT_V1', 'RISK_DOMAIN', p_risk_domain,
          'SUBJECT_KINDS', pg_catalog.cardinality(p_subject_kinds)::text]
    || COALESCE((SELECT pg_catalog.array_agg(s.v ORDER BY pg_catalog.convert_to(s.v, 'UTF8'))
                 FROM pg_catalog.unnest(p_subject_kinds) AS s(v)), ARRAY[]::text[])
    || ARRAY['REFERENCES', pg_catalog.cardinality(p_reference_namespaces)::text]
    || COALESCE((SELECT pg_catalog.array_agg(x.part ORDER BY pg_catalog.convert_to(r.ns, 'UTF8'), pg_catalog.convert_to(r.code, 'UTF8'), x.k)
                 FROM ROWS FROM (pg_catalog.unnest(p_reference_namespaces), pg_catalog.unnest(p_reference_codes)) AS r(ns, code)
                 CROSS JOIN LATERAL (VALUES (1, r.ns), (2, r.code)) AS x(k, part)), ARRAY[]::text[]))
$fn$;

-- Syntactic check of one ordered closed scale (LIKELIHOOD / IMPACT).
CREATE FUNCTION gov_repo.l15_risk_methodology_scale_check_v1(p_scale text, p_codes text[], p_ordinals integer[],
  p_namespaces text[], p_definition_codes text[])
RETURNS void LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog, pg_temp AS $fn$
DECLARE
  v_n integer;
BEGIN
  IF p_codes IS NULL OR p_ordinals IS NULL OR p_namespaces IS NULL OR p_definition_codes IS NULL
     OR pg_catalog.cardinality(p_ordinals) <> pg_catalog.cardinality(p_codes)
     OR pg_catalog.cardinality(p_namespaces) <> pg_catalog.cardinality(p_codes)
     OR pg_catalog.cardinality(p_definition_codes) <> pg_catalog.cardinality(p_codes)
     OR (pg_catalog.cardinality(p_codes) > 0 AND (pg_catalog.array_ndims(p_codes) <> 1 OR pg_catalog.array_ndims(p_ordinals) <> 1
         OR pg_catalog.array_ndims(p_namespaces) <> 1 OR pg_catalog.array_ndims(p_definition_codes) <> 1))
     OR pg_catalog.array_position(p_codes, NULL::text) IS NOT NULL OR pg_catalog.array_position(p_ordinals, NULL::integer) IS NOT NULL
     OR pg_catalog.array_position(p_namespaces, NULL::text) IS NOT NULL
     OR pg_catalog.array_position(p_definition_codes, NULL::text) IS NOT NULL THEN
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = p_scale || '_SCALE_MALFORMED';
  END IF;
  v_n := pg_catalog.cardinality(p_codes);
  IF v_n NOT BETWEEN 2 AND 7 THEN
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = p_scale || '_SCALE_SIZE_INVALID';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.unnest(p_codes) AS c(v) WHERE NOT gov_repo.l15_methodology_level_code_valid_v1(c.v)) THEN
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = p_scale || '_LEVEL_CODE_MALFORMED';
  END IF;
  IF (SELECT pg_catalog.count(DISTINCT c.v) FROM pg_catalog.unnest(p_codes) AS c(v)) <> v_n THEN
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = p_scale || '_LEVEL_CODE_DUPLICATE';
  END IF;
  -- Ordinals must be exactly {1..n}: no duplicate, no gap, deterministic explicit order.
  IF (SELECT pg_catalog.array_agg(o.v ORDER BY o.v) FROM pg_catalog.unnest(p_ordinals) AS o(v))
     IS DISTINCT FROM (SELECT pg_catalog.array_agg(g.v ORDER BY g.v) FROM pg_catalog.generate_series(1, v_n) AS g(v)) THEN
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = p_scale || '_LEVEL_ORDINAL_INVALID';
  END IF;
  IF EXISTS (SELECT 1 FROM ROWS FROM (pg_catalog.unnest(p_namespaces), pg_catalog.unnest(p_definition_codes)) AS d(ns, code)
             WHERE NOT gov_repo.l15_methodology_definition_reference_valid_v1(d.ns, d.code)) THEN
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = p_scale || '_DEFINITION_REFERENCE_MALFORMED';
  END IF;
END;
$fn$;

-- Syntactic methodology content check: both scales, the TOTAL matrix, the positive validity maximum.
CREATE FUNCTION gov_repo.l15_risk_methodology_content_check_v1(
  p_likelihood_level_codes text[], p_likelihood_ordinals integer[], p_likelihood_definition_namespaces text[],
  p_likelihood_definition_codes text[], p_impact_level_codes text[], p_impact_ordinals integer[],
  p_impact_definition_namespaces text[], p_impact_definition_codes text[], p_matrix_likelihood_level_codes text[],
  p_matrix_impact_level_codes text[], p_matrix_rating_bands text[], p_assessment_validity_maximum interval)
RETURNS void LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog, pg_temp AS $fn$
BEGIN
  PERFORM gov_repo.l15_risk_methodology_scale_check_v1('LIKELIHOOD', p_likelihood_level_codes, p_likelihood_ordinals,
    p_likelihood_definition_namespaces, p_likelihood_definition_codes);
  PERFORM gov_repo.l15_risk_methodology_scale_check_v1('IMPACT', p_impact_level_codes, p_impact_ordinals,
    p_impact_definition_namespaces, p_impact_definition_codes);
  IF p_matrix_likelihood_level_codes IS NULL OR p_matrix_impact_level_codes IS NULL OR p_matrix_rating_bands IS NULL
     OR pg_catalog.cardinality(p_matrix_impact_level_codes) <> pg_catalog.cardinality(p_matrix_likelihood_level_codes)
     OR pg_catalog.cardinality(p_matrix_rating_bands) <> pg_catalog.cardinality(p_matrix_likelihood_level_codes)
     OR (pg_catalog.cardinality(p_matrix_rating_bands) > 0 AND (pg_catalog.array_ndims(p_matrix_likelihood_level_codes) <> 1
         OR pg_catalog.array_ndims(p_matrix_impact_level_codes) <> 1 OR pg_catalog.array_ndims(p_matrix_rating_bands) <> 1))
     OR pg_catalog.array_position(p_matrix_likelihood_level_codes, NULL::text) IS NOT NULL
     OR pg_catalog.array_position(p_matrix_impact_level_codes, NULL::text) IS NOT NULL
     OR pg_catalog.array_position(p_matrix_rating_bands, NULL::text) IS NOT NULL THEN
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'RATING_MATRIX_MALFORMED';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.unnest(p_matrix_rating_bands) AS b(v) WHERE b.v NOT IN ('LOW','MODERATE','HIGH','CRITICAL')) THEN
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'RATING_BAND_UNKNOWN';
  END IF;
  IF EXISTS (SELECT 1 FROM ROWS FROM (pg_catalog.unnest(p_matrix_likelihood_level_codes), pg_catalog.unnest(p_matrix_impact_level_codes)) AS m(lik, imp)
             WHERE m.lik <> ALL (p_likelihood_level_codes) OR m.imp <> ALL (p_impact_level_codes)) THEN
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'RATING_MATRIX_LEVEL_UNKNOWN';
  END IF;
  IF (SELECT pg_catalog.count(DISTINCT (m.lik, m.imp)) FROM ROWS FROM (pg_catalog.unnest(p_matrix_likelihood_level_codes),
        pg_catalog.unnest(p_matrix_impact_level_codes)) AS m(lik, imp)) <> pg_catalog.cardinality(p_matrix_rating_bands) THEN
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'RATING_MATRIX_CELL_DUPLICATE';
  END IF;
  IF pg_catalog.cardinality(p_matrix_rating_bands)
     <> pg_catalog.cardinality(p_likelihood_level_codes) * pg_catalog.cardinality(p_impact_level_codes) THEN
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'RATING_MATRIX_INCOMPLETE';
  END IF;
  IF gov_repo.l15_assessment_validity_maximum_parts_v1(p_assessment_validity_maximum) IS NULL THEN
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'ASSESSMENT_VALIDITY_MAXIMUM_INVALID';
  END IF;
END;
$fn$;

-- Canonical methodology content hash (input order irrelevant): length-framed parts
-- (L15_RISK_METHODOLOGY_CONTENT_V1, LIKELIHOOD_SCALE, n, [ordinal, level_code, definition namespace, definition code] by
-- ordinal, IMPACT_SCALE, m, [...] by ordinal, RATING_MATRIX, n*m, [likelihood code, impact code, band] by (likelihood
-- ordinal, impact ordinal), ASSESSMENT_VALIDITY_MAXIMUM, months, days, time microseconds). Call only after the check.
CREATE FUNCTION gov_repo.l15_risk_methodology_content_hash_v1(
  p_likelihood_level_codes text[], p_likelihood_ordinals integer[], p_likelihood_definition_namespaces text[],
  p_likelihood_definition_codes text[], p_impact_level_codes text[], p_impact_ordinals integer[],
  p_impact_definition_namespaces text[], p_impact_definition_codes text[], p_matrix_likelihood_level_codes text[],
  p_matrix_impact_level_codes text[], p_matrix_rating_bands text[], p_assessment_validity_maximum interval)
RETURNS text LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $fn$
  WITH lik AS (SELECT l.ord, l.code, l.ns, l.def FROM ROWS FROM (pg_catalog.unnest(p_likelihood_ordinals),
                 pg_catalog.unnest(p_likelihood_level_codes), pg_catalog.unnest(p_likelihood_definition_namespaces),
                 pg_catalog.unnest(p_likelihood_definition_codes)) AS l(ord, code, ns, def)),
       imp AS (SELECT l.ord, l.code, l.ns, l.def FROM ROWS FROM (pg_catalog.unnest(p_impact_ordinals),
                 pg_catalog.unnest(p_impact_level_codes), pg_catalog.unnest(p_impact_definition_namespaces),
                 pg_catalog.unnest(p_impact_definition_codes)) AS l(ord, code, ns, def)),
       cells AS (SELECT m.lik, m.imp, m.band, li.ord AS lord, im.ord AS iord
                 FROM ROWS FROM (pg_catalog.unnest(p_matrix_likelihood_level_codes), pg_catalog.unnest(p_matrix_impact_level_codes),
                   pg_catalog.unnest(p_matrix_rating_bands)) AS m(lik, imp, band)
                 LEFT JOIN lik AS li ON li.code = m.lik LEFT JOIN imp AS im ON im.code = m.imp)
  SELECT gov_repo.l14_sha256_frame_v1(
    ARRAY['L15_RISK_METHODOLOGY_CONTENT_V1', 'LIKELIHOOD_SCALE', (SELECT pg_catalog.count(*) FROM lik)::text]
    || COALESCE((SELECT pg_catalog.array_agg(x.part ORDER BY l.ord, x.k) FROM lik AS l
                 CROSS JOIN LATERAL (VALUES (1, l.ord::text), (2, l.code), (3, l.ns), (4, l.def)) AS x(k, part)), ARRAY[]::text[])
    || ARRAY['IMPACT_SCALE', (SELECT pg_catalog.count(*) FROM imp)::text]
    || COALESCE((SELECT pg_catalog.array_agg(x.part ORDER BY l.ord, x.k) FROM imp AS l
                 CROSS JOIN LATERAL (VALUES (1, l.ord::text), (2, l.code), (3, l.ns), (4, l.def)) AS x(k, part)), ARRAY[]::text[])
    || ARRAY['RATING_MATRIX', (SELECT pg_catalog.count(*) FROM cells)::text]
    || COALESCE((SELECT pg_catalog.array_agg(x.part ORDER BY c.lord, c.iord, x.k) FROM cells AS c
                 CROSS JOIN LATERAL (VALUES (1, c.lik), (2, c.imp), (3, c.band)) AS x(k, part)), ARRAY[]::text[])
    || ARRAY['ASSESSMENT_VALIDITY_MAXIMUM']
    || gov_repo.l15_assessment_validity_maximum_parts_v1(p_assessment_validity_maximum))
$fn$;

-- Syntactic registry support (no table read): NONE = zero entries, PRESENT = 1..64 distinct (tag, id) entries; the
-- rank-3 registry owners may cite ONLY DISCOVERY_EVIDENCE / SOURCE_ASSERTION (§9.2). Returns the order-independent
-- fingerprint parts (SUPPORT, status, n, then tag / id pairs in UTF-8 byte order).
CREATE FUNCTION gov_repo.l15_registry_support_parts_v1(p_support_status text, p_tags text[], p_ids text[])
RETURNS text[] LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog, pg_temp AS $fn$
DECLARE
  v_n integer;
BEGIN
  IF p_support_status IS NULL OR p_support_status NOT IN ('NONE','PRESENT') OR p_tags IS NULL OR p_ids IS NULL
     OR pg_catalog.cardinality(p_tags) <> pg_catalog.cardinality(p_ids)
     OR (pg_catalog.cardinality(p_tags) > 0 AND (pg_catalog.array_ndims(p_tags) <> 1 OR pg_catalog.array_ndims(p_ids) <> 1))
     OR pg_catalog.array_position(p_tags, NULL::text) IS NOT NULL OR pg_catalog.array_position(p_ids, NULL::text) IS NOT NULL THEN
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'SUPPORT_MALFORMED';
  END IF;
  v_n := pg_catalog.cardinality(p_tags);
  IF (p_support_status = 'NONE') <> (v_n = 0) OR v_n > 64
     OR EXISTS (SELECT 1 FROM pg_catalog.unnest(p_ids) AS i(v) WHERE pg_catalog.length(i.v) NOT BETWEEN 1 AND 500 OR i.v <> pg_catalog.btrim(i.v)) THEN
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'SUPPORT_MALFORMED';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.unnest(p_tags) AS t(v) WHERE t.v NOT IN ('DISCOVERY_EVIDENCE','SOURCE_ASSERTION',
       'RUNTIME_OBSERVATION','CROSS_SIGNAL_RESULT','EXECUTION_FIELD_STATE','TECHNICAL_FIELD_STATE','LINEAGE_OBSERVATION',
       'L14_FACT_STATE','RISK_SIGNAL','RISK_HYPOTHESIS')) THEN
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'SUPPORT_TAG_UNKNOWN';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.unnest(p_tags) AS t(v) WHERE t.v NOT IN ('DISCOVERY_EVIDENCE','SOURCE_ASSERTION')) THEN
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'SUPPORT_TARGET_NOT_ADMISSIBLE';
  END IF;
  IF (SELECT pg_catalog.count(DISTINCT (s.tg, s.id)) FROM ROWS FROM (pg_catalog.unnest(p_tags), pg_catalog.unnest(p_ids)) AS s(tg, id)) <> v_n THEN
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'SUPPORT_DUPLICATE';
  END IF;
  RETURN ARRAY['SUPPORT', p_support_status, v_n::text]
    || COALESCE((SELECT pg_catalog.array_agg(x.part ORDER BY pg_catalog.convert_to(s.tg, 'UTF8'), pg_catalog.convert_to(s.id, 'UTF8'), x.k)
                 FROM ROWS FROM (pg_catalog.unnest(p_tags), pg_catalog.unnest(p_ids)) AS s(tg, id)
                 CROSS JOIN LATERAL (VALUES (1, s.tg), (2, s.id)) AS x(k, part)), ARRAY[]::text[]);
END;
$fn$;

-- ---------------------------------------------------------------------------------------------------------------------
-- C. Tables.
-- ---------------------------------------------------------------------------------------------------------------------

-- ---------------------------------------------------------------------------------------------------------------------
-- C. RISK_SCENARIO_DEFINITION: stable identity, immutable versions + normalized content, typed state, typed proposal, CAS head.
-- ---------------------------------------------------------------------------------------------------------------------
-- Stable tenant-scoped identity: organisation + opaque caller-supplied scenario_definition_id. Created once, right after its root version,
-- by the same exact ALLOW / RISK_SCENARIO_DEFINITION / ADMIT authorization. Carries no content and no mutable semantic field.
CREATE TABLE gov_repo.l15_risk_scenario_definitions (
  organisation_id uuid NOT NULL REFERENCES gov_repo.organisations (organisation_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  scenario_definition_id uuid NOT NULL,
  admission_authorization_decision_id uuid NOT NULL,
  admission_authorization_result text GENERATED ALWAYS AS ('ALLOW') STORED,
  admission_subject_kind text GENERATED ALWAYS AS ('RISK_SCENARIO_DEFINITION') STORED,
  admission_requested_action text GENERATED ALWAYS AS ('ADMIT') STORED,
  recorded_at timestamptz NOT NULL,
  CONSTRAINT l15_risk_scenario_definitions_pkey PRIMARY KEY (organisation_id, scenario_definition_id),
  CONSTRAINT l15_risk_scenario_definitions_authorization_unique UNIQUE (organisation_id, admission_authorization_decision_id),
  CONSTRAINT l15_risk_scenario_definitions_authorization_fkey
    FOREIGN KEY (organisation_id, admission_authorization_decision_id, admission_authorization_result,
                 admission_subject_kind, admission_requested_action)
    REFERENCES gov_repo.l14_authorization_decisions (organisation_id, authorization_decision_id, result, subject_kind, requested_action)
    ON UPDATE RESTRICT ON DELETE RESTRICT
);

-- Immutable versions: opaque version id (one identity per version id per organisation, never reused), DB content hash,
-- linear admission lineage (one root, one successor each), each pinned to its own exact ADMIT authorization. ADMITTED is
-- not VALIDATED: no decision, no state, no head.
CREATE TABLE gov_repo.l15_risk_scenario_definition_versions (
  organisation_id uuid NOT NULL,
  scenario_definition_id uuid NOT NULL,
  scenario_definition_version_id uuid NOT NULL,
  risk_domain text NOT NULL CHECK (risk_domain IN ('PRIVACY','CYBERSECURITY','AUTHORIZATION','AUTONOMY','MODEL','DATA','CONNECTIVITY','OPERATIONAL','FINOPS')),
  content_hash character(64) NOT NULL CHECK (content_hash::text ~ '^[0-9a-f]{64}$'),
  predecessor_version_id uuid,
  admission_authorization_decision_id uuid NOT NULL,
  admission_authorization_result text GENERATED ALWAYS AS ('ALLOW') STORED,
  admission_subject_kind text GENERATED ALWAYS AS ('RISK_SCENARIO_DEFINITION') STORED,
  admission_requested_action text GENERATED ALWAYS AS ('ADMIT') STORED,
  -- Provenance only. SYSTEM_SEED marks a seed-origin version (human-mediated, ADMIT permission still required); it is
  -- never authority. SOURCE_CONNECTION has no trusted intake primitive and is not admissible.
  source_class text NOT NULL CHECK (source_class IN ('SYSTEM_SEED','LOCAL_HUMAN')),
  admitted_by_actor_user_id uuid NOT NULL,
  recorded_at timestamptz NOT NULL,
  CONSTRAINT l15_risk_scenario_definition_versions_pkey PRIMARY KEY (organisation_id, scenario_definition_id, scenario_definition_version_id),
  CONSTRAINT l15_risk_scenario_definition_versions_version_unique UNIQUE (organisation_id, scenario_definition_version_id),
  CONSTRAINT l15_risk_scenario_definition_versions_tuple_unique UNIQUE (organisation_id, scenario_definition_id, scenario_definition_version_id, content_hash),
  CONSTRAINT l15_risk_scenario_definition_versions_authorization_unique UNIQUE (organisation_id, admission_authorization_decision_id),
  CONSTRAINT l15_risk_scenario_definition_versions_successor_unique UNIQUE (organisation_id, scenario_definition_id, predecessor_version_id),
  -- The exact (version, domain) pair the normalized subject-kind rows pin (domain x subject legality is per row).
  CONSTRAINT l15_risk_scenario_definition_versions_domain_unique UNIQUE (organisation_id, scenario_definition_version_id, risk_domain),
  CONSTRAINT l15_risk_scenario_definition_versions_self_check CHECK (predecessor_version_id IS NULL OR predecessor_version_id <> scenario_definition_version_id),
  CONSTRAINT l15_risk_scenario_definition_versions_identity_fkey FOREIGN KEY (organisation_id, scenario_definition_id)
    REFERENCES gov_repo.l15_risk_scenario_definitions (organisation_id, scenario_definition_id) ON UPDATE RESTRICT ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT l15_risk_scenario_definition_versions_predecessor_fkey FOREIGN KEY (organisation_id, scenario_definition_id, predecessor_version_id)
    REFERENCES gov_repo.l15_risk_scenario_definition_versions (organisation_id, scenario_definition_id, scenario_definition_version_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT l15_risk_scenario_definition_versions_authorization_fkey
    FOREIGN KEY (organisation_id, admission_authorization_decision_id, admission_authorization_result,
                 admission_subject_kind, admission_requested_action)
    REFERENCES gov_repo.l14_authorization_decisions (organisation_id, authorization_decision_id, result, subject_kind, requested_action)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT l15_risk_scenario_definition_versions_actor_fkey FOREIGN KEY (organisation_id, admitted_by_actor_user_id)
    REFERENCES gov_repo.governance_users (organisation_id, user_id) ON UPDATE RESTRICT ON DELETE RESTRICT
);
CREATE UNIQUE INDEX l15_risk_scenario_definition_versions_root_uidx ON gov_repo.l15_risk_scenario_definition_versions (organisation_id, scenario_definition_id)
  WHERE predecessor_version_id IS NULL;

-- Normalized, closed, non-empty legal subject-kind set of one immutable version (never JSON / CSV / free labels). Each row
-- pins the version's own domain and must be legal for it under the closed §8.2 matrix (no inheritance).
CREATE TABLE gov_repo.l15_risk_scenario_definition_subject_kinds (
  organisation_id uuid NOT NULL,
  scenario_definition_version_id uuid NOT NULL,
  risk_domain text NOT NULL,
  subject_kind text NOT NULL CHECK (subject_kind IN ('AGENT','AGENT_VERSION','MODEL','TOOL','MCP_SERVER','API','DATA_ASSET','DATA_ELEMENT','REL:USES_MODEL','REL:USES_TOOL','REL:USES_MCP','REL:INVOKES','REL:USES_PROMPT','REL:USES_KNOWLEDGE_BASE','REL:USES_SKILL','REL:EXPOSES','REL:HANDOFF_TO','REL:READS_FROM','REL:WRITES_TO','REL:DERIVED_FROM')),
  CONSTRAINT l15_risk_scenario_definition_subject_kinds_pkey PRIMARY KEY (organisation_id, scenario_definition_version_id, subject_kind),
  CONSTRAINT l15_risk_scenario_definition_subject_kinds_legal_check CHECK (gov_repo.l15_risk_domain_subject_legal_v1(risk_domain, subject_kind)),
  CONSTRAINT l15_risk_scenario_definition_subject_kinds_version_fkey
    FOREIGN KEY (organisation_id, scenario_definition_version_id, risk_domain)
    REFERENCES gov_repo.l15_risk_scenario_definition_versions (organisation_id, scenario_definition_version_id, risk_domain)
    ON UPDATE RESTRICT ON DELETE RESTRICT
);

-- Normalized typed reference codes of one immutable version: explicit closed namespace + bounded, syntactically
-- constrained code. Descriptive / provenance metadata only: never identity, authority, domain, validation or truth.
CREATE TABLE gov_repo.l15_risk_scenario_definition_references (
  organisation_id uuid NOT NULL,
  scenario_definition_version_id uuid NOT NULL,
  reference_namespace text NOT NULL CHECK (reference_namespace IN ('SCANNER_RULE_ID','CG_AG_CONTROL_ID','ORGANISATION_SCENARIO_CODE')),
  reference_code text NOT NULL,
  CONSTRAINT l15_risk_scenario_definition_references_pkey
    PRIMARY KEY (organisation_id, scenario_definition_version_id, reference_namespace, reference_code),
  CONSTRAINT l15_risk_scenario_definition_references_code_check
    CHECK (gov_repo.l15_scenario_reference_code_valid_v1(reference_namespace, reference_code)),
  CONSTRAINT l15_risk_scenario_definition_references_version_fkey
    FOREIGN KEY (organisation_id, scenario_definition_version_id)
    REFERENCES gov_repo.l15_risk_scenario_definition_versions (organisation_id, scenario_definition_version_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT
);

-- Typed immutable state (L15 store; l14_registry_states is NOT used). Each row pins the exact identity + version + DB
-- content hash, the exact deciding proposal, governance decision, ALLOW authorization and the Authority Policy version /
-- hash it was authorized under, plus the frozen-envelope provenance (source class, support). Linear, same-tuple,
-- alternating VALIDATED -> REVOKED -> VALIDATED lineage; history only appends.
CREATE TABLE gov_repo.l15_risk_scenario_definition_states (
  organisation_id uuid NOT NULL,
  state_id uuid NOT NULL,
  subject_kind text GENERATED ALWAYS AS ('RISK_SCENARIO_DEFINITION') STORED,
  state_kind text NOT NULL CHECK (state_kind IN ('VALIDATED','REVOKED')),
  scenario_definition_id uuid NOT NULL,
  scenario_definition_version_id uuid NOT NULL,
  content_hash character(64) NOT NULL CHECK (content_hash::text ~ '^[0-9a-f]{64}$'),
  predecessor_state_id uuid,
  predecessor_state_kind text GENERATED ALWAYS AS (
    CASE WHEN predecessor_state_id IS NULL THEN NULL WHEN state_kind = 'VALIDATED' THEN 'REVOKED' ELSE 'VALIDATED' END) STORED,
  revokes_state_id uuid,
  revoked_state_kind text GENERATED ALWAYS AS (CASE WHEN revokes_state_id IS NULL THEN NULL ELSE 'VALIDATED' END) STORED,
  effective_from timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL,
  proposal_id uuid NOT NULL,
  decision_outcome text GENERATED ALWAYS AS (CASE WHEN state_kind = 'VALIDATED' THEN 'VALIDATE' ELSE 'REVOKE' END) STORED,
  governance_decision_id uuid NOT NULL,
  authorization_decision_id uuid NOT NULL,
  authorization_result text GENERATED ALWAYS AS ('ALLOW') STORED,
  authority_policy_id uuid NOT NULL,
  authority_policy_version_id uuid NOT NULL,
  authority_policy_content_hash text NOT NULL CHECK (authority_policy_content_hash ~ '^[0-9a-f]{64}$'),
  source_class text NOT NULL CHECK (source_class IN ('SYSTEM_SEED','LOCAL_HUMAN')),
  support_status text NOT NULL CHECK (support_status IN ('NONE','PRESENT')),
  CONSTRAINT l15_risk_scenario_definition_states_pkey PRIMARY KEY (organisation_id, state_id),
  CONSTRAINT l15_risk_scenario_definition_states_decision_unique UNIQUE (organisation_id, governance_decision_id),
  CONSTRAINT l15_risk_scenario_definition_states_subject_unique UNIQUE (organisation_id, state_id, scenario_definition_id, scenario_definition_version_id, content_hash),
  -- The exact dependency key a later slice pins (organisation + identity + version + hash + state id + VALIDATED).
  CONSTRAINT l15_risk_scenario_definition_states_kind_unique UNIQUE (organisation_id, state_id, scenario_definition_id, scenario_definition_version_id, content_hash, state_kind),
  CONSTRAINT l15_risk_scenario_definition_states_shape_check CHECK (
    (state_kind = 'VALIDATED' AND revokes_state_id IS NULL)
    OR (state_kind = 'REVOKED' AND revokes_state_id IS NOT NULL AND predecessor_state_id = revokes_state_id)),
  CONSTRAINT l15_risk_scenario_definition_states_version_fkey FOREIGN KEY (organisation_id, scenario_definition_id, scenario_definition_version_id, content_hash)
    REFERENCES gov_repo.l15_risk_scenario_definition_versions (organisation_id, scenario_definition_id, scenario_definition_version_id, content_hash) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT l15_risk_scenario_definition_states_predecessor_fkey
    FOREIGN KEY (organisation_id, predecessor_state_id, scenario_definition_id, scenario_definition_version_id, content_hash, predecessor_state_kind)
    REFERENCES gov_repo.l15_risk_scenario_definition_states (organisation_id, state_id, scenario_definition_id, scenario_definition_version_id, content_hash, state_kind)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT l15_risk_scenario_definition_states_revokes_fkey
    FOREIGN KEY (organisation_id, revokes_state_id, scenario_definition_id, scenario_definition_version_id, content_hash, revoked_state_kind)
    REFERENCES gov_repo.l15_risk_scenario_definition_states (organisation_id, state_id, scenario_definition_id, scenario_definition_version_id, content_hash, state_kind)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  -- The exact governance decision of this subject kind and outcome, made under exactly this authorization.
  CONSTRAINT l15_risk_scenario_definition_states_decision_fkey
    FOREIGN KEY (organisation_id, governance_decision_id, subject_kind, decision_outcome, authorization_decision_id)
    REFERENCES gov_repo.l14_governance_decisions (organisation_id, governance_decision_id, subject_kind, outcome, authorization_decision_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  -- The exact ALLOW authorization of this subject kind and action, with its exact Authority Policy basis snapshot.
  CONSTRAINT l15_risk_scenario_definition_states_authorization_fkey
    FOREIGN KEY (organisation_id, authorization_decision_id, authorization_result, subject_kind, decision_outcome,
                 authority_policy_id, authority_policy_version_id, authority_policy_content_hash)
    REFERENCES gov_repo.l14_authorization_decisions (organisation_id, authorization_decision_id, result, subject_kind,
                 requested_action, basis_authority_policy_id, basis_version_id, basis_content_hash)
    ON UPDATE RESTRICT ON DELETE RESTRICT
);
CREATE UNIQUE INDEX l15_risk_scenario_definition_states_root_uidx ON gov_repo.l15_risk_scenario_definition_states (organisation_id, scenario_definition_id, scenario_definition_version_id, content_hash)
  WHERE predecessor_state_id IS NULL;
CREATE UNIQUE INDEX l15_risk_scenario_definition_states_successor_uidx ON gov_repo.l15_risk_scenario_definition_states (organisation_id, predecessor_state_id)
  WHERE predecessor_state_id IS NOT NULL;

-- Typed immutable proposal over the shared l14_proposals envelope: the exact admitted version tuple. No content copy, no
-- rationale, no free text. A REVOKE pins the exact VALIDATED state of the same tuple.
CREATE TABLE gov_repo.l15_risk_scenario_definition_proposals (
  organisation_id uuid NOT NULL,
  proposal_id uuid NOT NULL,
  subject_kind text GENERATED ALWAYS AS ('RISK_SCENARIO_DEFINITION') STORED,
  intent text NOT NULL CHECK (intent IN ('VALIDATE','REVOKE')),
  scenario_definition_id uuid NOT NULL,
  scenario_definition_version_id uuid NOT NULL,
  content_hash character(64) NOT NULL CHECK (content_hash::text ~ '^[0-9a-f]{64}$'),
  requested_effective_from timestamptz,          -- NULL = IMMEDIATE (DB transaction instant)
  target_state_id uuid,
  target_state_kind text GENERATED ALWAYS AS (CASE WHEN target_state_id IS NULL THEN NULL ELSE 'VALIDATED' END) STORED,
  CONSTRAINT l15_risk_scenario_definition_proposals_pkey PRIMARY KEY (organisation_id, proposal_id),
  CONSTRAINT l15_risk_scenario_definition_proposals_tuple_unique UNIQUE (organisation_id, proposal_id, scenario_definition_id, scenario_definition_version_id, content_hash, intent),
  CONSTRAINT l15_risk_scenario_definition_proposals_target_check CHECK (
    (intent = 'VALIDATE' AND target_state_id IS NULL) OR (intent = 'REVOKE' AND target_state_id IS NOT NULL)),
  CONSTRAINT l15_risk_scenario_definition_proposals_envelope_fkey FOREIGN KEY (organisation_id, proposal_id, subject_kind, intent)
    REFERENCES gov_repo.l14_proposals (organisation_id, proposal_id, subject_kind, intent) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT l15_risk_scenario_definition_proposals_version_fkey FOREIGN KEY (organisation_id, scenario_definition_id, scenario_definition_version_id, content_hash)
    REFERENCES gov_repo.l15_risk_scenario_definition_versions (organisation_id, scenario_definition_id, scenario_definition_version_id, content_hash) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT l15_risk_scenario_definition_proposals_target_fkey
    FOREIGN KEY (organisation_id, target_state_id, scenario_definition_id, scenario_definition_version_id, content_hash, target_state_kind)
    REFERENCES gov_repo.l15_risk_scenario_definition_states (organisation_id, state_id, scenario_definition_id, scenario_definition_version_id, content_hash, state_kind)
    ON UPDATE RESTRICT ON DELETE RESTRICT
);
-- A state belongs to the exact proposal its decision decided (same tuple, matching intent).
ALTER TABLE gov_repo.l15_risk_scenario_definition_states
  ADD CONSTRAINT l15_risk_scenario_definition_states_proposal_fkey
    FOREIGN KEY (organisation_id, proposal_id, scenario_definition_id, scenario_definition_version_id, content_hash, decision_outcome)
    REFERENCES gov_repo.l15_risk_scenario_definition_proposals (organisation_id, proposal_id, scenario_definition_id, scenario_definition_version_id, content_hash, intent)
    ON UPDATE RESTRICT ON DELETE RESTRICT;

-- Technical validation head per exact tuple: compare-and-set pointer only, created by the first state-appending decision,
-- advanced only to the direct lineage successor, reconstructible from history, never authority. There is NO per-identity
-- "current / latest version" pointer.
CREATE TABLE gov_repo.l15_risk_scenario_definition_heads (
  organisation_id uuid NOT NULL,
  scenario_definition_id uuid NOT NULL,
  scenario_definition_version_id uuid NOT NULL,
  content_hash character(64) NOT NULL CHECK (content_hash::text ~ '^[0-9a-f]{64}$'),
  latest_state_id uuid,
  CONSTRAINT l15_risk_scenario_definition_heads_pkey PRIMARY KEY (organisation_id, scenario_definition_id, scenario_definition_version_id),
  CONSTRAINT l15_risk_scenario_definition_heads_version_fkey FOREIGN KEY (organisation_id, scenario_definition_id, scenario_definition_version_id, content_hash)
    REFERENCES gov_repo.l15_risk_scenario_definition_versions (organisation_id, scenario_definition_id, scenario_definition_version_id, content_hash) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT l15_risk_scenario_definition_heads_state_fkey FOREIGN KEY (organisation_id, latest_state_id, scenario_definition_id, scenario_definition_version_id, content_hash)
    REFERENCES gov_repo.l15_risk_scenario_definition_states (organisation_id, state_id, scenario_definition_id, scenario_definition_version_id, content_hash) ON UPDATE RESTRICT ON DELETE RESTRICT
);


-- ---------------------------------------------------------------------------------------------------------------------
-- C. RISK_METHODOLOGY: stable identity, immutable versions + normalized content, typed state, typed proposal, CAS head.
-- ---------------------------------------------------------------------------------------------------------------------
-- Stable tenant-scoped identity: organisation + opaque caller-supplied methodology_id. Created once, right after its root version,
-- by the same exact ALLOW / RISK_METHODOLOGY / ADMIT authorization. Carries no content and no mutable semantic field.
CREATE TABLE gov_repo.l15_risk_methodologies (
  organisation_id uuid NOT NULL REFERENCES gov_repo.organisations (organisation_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  methodology_id uuid NOT NULL,
  admission_authorization_decision_id uuid NOT NULL,
  admission_authorization_result text GENERATED ALWAYS AS ('ALLOW') STORED,
  admission_subject_kind text GENERATED ALWAYS AS ('RISK_METHODOLOGY') STORED,
  admission_requested_action text GENERATED ALWAYS AS ('ADMIT') STORED,
  recorded_at timestamptz NOT NULL,
  CONSTRAINT l15_risk_methodologies_pkey PRIMARY KEY (organisation_id, methodology_id),
  CONSTRAINT l15_risk_methodologies_authorization_unique UNIQUE (organisation_id, admission_authorization_decision_id),
  CONSTRAINT l15_risk_methodologies_authorization_fkey
    FOREIGN KEY (organisation_id, admission_authorization_decision_id, admission_authorization_result,
                 admission_subject_kind, admission_requested_action)
    REFERENCES gov_repo.l14_authorization_decisions (organisation_id, authorization_decision_id, result, subject_kind, requested_action)
    ON UPDATE RESTRICT ON DELETE RESTRICT
);

-- Immutable versions: opaque version id (one identity per version id per organisation, never reused), DB content hash,
-- linear admission lineage (one root, one successor each), each pinned to its own exact ADMIT authorization. ADMITTED is
-- not VALIDATED: no decision, no state, no head.
CREATE TABLE gov_repo.l15_risk_methodology_versions (
  organisation_id uuid NOT NULL,
  methodology_id uuid NOT NULL,
  methodology_version_id uuid NOT NULL,
  assessment_validity_maximum interval NOT NULL
    CHECK (gov_repo.l15_assessment_validity_maximum_parts_v1(assessment_validity_maximum) IS NOT NULL),
  content_hash character(64) NOT NULL CHECK (content_hash::text ~ '^[0-9a-f]{64}$'),
  predecessor_version_id uuid,
  admission_authorization_decision_id uuid NOT NULL,
  admission_authorization_result text GENERATED ALWAYS AS ('ALLOW') STORED,
  admission_subject_kind text GENERATED ALWAYS AS ('RISK_METHODOLOGY') STORED,
  admission_requested_action text GENERATED ALWAYS AS ('ADMIT') STORED,
  -- Provenance only. SYSTEM_SEED marks a seed-origin version (human-mediated, ADMIT permission still required); it is
  -- never authority. SOURCE_CONNECTION has no trusted intake primitive and is not admissible.
  source_class text NOT NULL CHECK (source_class IN ('SYSTEM_SEED','LOCAL_HUMAN')),
  admitted_by_actor_user_id uuid NOT NULL,
  recorded_at timestamptz NOT NULL,
  CONSTRAINT l15_risk_methodology_versions_pkey PRIMARY KEY (organisation_id, methodology_id, methodology_version_id),
  CONSTRAINT l15_risk_methodology_versions_version_unique UNIQUE (organisation_id, methodology_version_id),
  CONSTRAINT l15_risk_methodology_versions_tuple_unique UNIQUE (organisation_id, methodology_id, methodology_version_id, content_hash),
  CONSTRAINT l15_risk_methodology_versions_authorization_unique UNIQUE (organisation_id, admission_authorization_decision_id),
  CONSTRAINT l15_risk_methodology_versions_successor_unique UNIQUE (organisation_id, methodology_id, predecessor_version_id),
  CONSTRAINT l15_risk_methodology_versions_self_check CHECK (predecessor_version_id IS NULL OR predecessor_version_id <> methodology_version_id),
  CONSTRAINT l15_risk_methodology_versions_identity_fkey FOREIGN KEY (organisation_id, methodology_id)
    REFERENCES gov_repo.l15_risk_methodologies (organisation_id, methodology_id) ON UPDATE RESTRICT ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT l15_risk_methodology_versions_predecessor_fkey FOREIGN KEY (organisation_id, methodology_id, predecessor_version_id)
    REFERENCES gov_repo.l15_risk_methodology_versions (organisation_id, methodology_id, methodology_version_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT l15_risk_methodology_versions_authorization_fkey
    FOREIGN KEY (organisation_id, admission_authorization_decision_id, admission_authorization_result,
                 admission_subject_kind, admission_requested_action)
    REFERENCES gov_repo.l14_authorization_decisions (organisation_id, authorization_decision_id, result, subject_kind, requested_action)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT l15_risk_methodology_versions_actor_fkey FOREIGN KEY (organisation_id, admitted_by_actor_user_id)
    REFERENCES gov_repo.governance_users (organisation_id, user_id) ON UPDATE RESTRICT ON DELETE RESTRICT
);
CREATE UNIQUE INDEX l15_risk_methodology_versions_root_uidx ON gov_repo.l15_risk_methodology_versions (organisation_id, methodology_id)
  WHERE predecessor_version_id IS NULL;

-- Ordered closed LIKELIHOOD scale of one immutable methodology version: 2..7 levels (commit-time guard), unique code,
-- unique contiguous ordinal 1..n, typed definition reference. The ordinal is the ONLY numeric column of any L15 store: no
-- score, weight or percentage exists.
CREATE TABLE gov_repo.l15_risk_methodology_likelihood_levels (
  organisation_id uuid NOT NULL,
  methodology_version_id uuid NOT NULL,
  ordinal smallint NOT NULL CHECK (ordinal BETWEEN 1 AND 7),
  level_code text NOT NULL CHECK (gov_repo.l15_methodology_level_code_valid_v1(level_code)),
  definition_reference_namespace text NOT NULL CHECK (definition_reference_namespace = 'ORGANISATION_DEFINITION_CODE'),
  definition_reference_code text NOT NULL
    CHECK (gov_repo.l15_methodology_definition_reference_valid_v1(definition_reference_namespace, definition_reference_code)),
  CONSTRAINT l15_risk_methodology_likelihood_levels_pkey PRIMARY KEY (organisation_id, methodology_version_id, ordinal),
  CONSTRAINT l15_risk_methodology_likelihood_levels_code_unique UNIQUE (organisation_id, methodology_version_id, level_code),
  CONSTRAINT l15_risk_methodology_likelihood_levels_version_fkey
    FOREIGN KEY (organisation_id, methodology_version_id)
    REFERENCES gov_repo.l15_risk_methodology_versions (organisation_id, methodology_version_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT
);

-- Ordered closed IMPACT scale of one immutable methodology version: 2..7 levels (commit-time guard), unique code,
-- unique contiguous ordinal 1..n, typed definition reference. The ordinal is the ONLY numeric column of any L15 store: no
-- score, weight or percentage exists.
CREATE TABLE gov_repo.l15_risk_methodology_impact_levels (
  organisation_id uuid NOT NULL,
  methodology_version_id uuid NOT NULL,
  ordinal smallint NOT NULL CHECK (ordinal BETWEEN 1 AND 7),
  level_code text NOT NULL CHECK (gov_repo.l15_methodology_level_code_valid_v1(level_code)),
  definition_reference_namespace text NOT NULL CHECK (definition_reference_namespace = 'ORGANISATION_DEFINITION_CODE'),
  definition_reference_code text NOT NULL
    CHECK (gov_repo.l15_methodology_definition_reference_valid_v1(definition_reference_namespace, definition_reference_code)),
  CONSTRAINT l15_risk_methodology_impact_levels_pkey PRIMARY KEY (organisation_id, methodology_version_id, ordinal),
  CONSTRAINT l15_risk_methodology_impact_levels_code_unique UNIQUE (organisation_id, methodology_version_id, level_code),
  CONSTRAINT l15_risk_methodology_impact_levels_version_fkey
    FOREIGN KEY (organisation_id, methodology_version_id)
    REFERENCES gov_repo.l15_risk_methodology_versions (organisation_id, methodology_version_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT
);

-- TOTAL rating lookup matrix of one immutable methodology version: every likelihood level x every impact level maps to
-- exactly one closed band (PK = one cell per pair; FKs = only levels of THIS version's two scales; commit-time guard =
-- exactly n x m cells). A lookup table, never arithmetic: no product, sum, weight or percentage.
CREATE TABLE gov_repo.l15_risk_methodology_rating_cells (
  organisation_id uuid NOT NULL,
  methodology_version_id uuid NOT NULL,
  likelihood_level_code text NOT NULL,
  impact_level_code text NOT NULL,
  rating_band text NOT NULL CHECK (rating_band IN ('LOW','MODERATE','HIGH','CRITICAL')),
  CONSTRAINT l15_risk_methodology_rating_cells_pkey
    PRIMARY KEY (organisation_id, methodology_version_id, likelihood_level_code, impact_level_code),
  CONSTRAINT l15_risk_methodology_rating_cells_likelihood_fkey
    FOREIGN KEY (organisation_id, methodology_version_id, likelihood_level_code)
    REFERENCES gov_repo.l15_risk_methodology_likelihood_levels (organisation_id, methodology_version_id, level_code)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT l15_risk_methodology_rating_cells_impact_fkey
    FOREIGN KEY (organisation_id, methodology_version_id, impact_level_code)
    REFERENCES gov_repo.l15_risk_methodology_impact_levels (organisation_id, methodology_version_id, level_code)
    ON UPDATE RESTRICT ON DELETE RESTRICT
);

-- Typed immutable state (L15 store; l14_registry_states is NOT used). Each row pins the exact identity + version + DB
-- content hash, the exact deciding proposal, governance decision, ALLOW authorization and the Authority Policy version /
-- hash it was authorized under, plus the frozen-envelope provenance (source class, support). Linear, same-tuple,
-- alternating VALIDATED -> REVOKED -> VALIDATED lineage; history only appends.
CREATE TABLE gov_repo.l15_risk_methodology_states (
  organisation_id uuid NOT NULL,
  state_id uuid NOT NULL,
  subject_kind text GENERATED ALWAYS AS ('RISK_METHODOLOGY') STORED,
  state_kind text NOT NULL CHECK (state_kind IN ('VALIDATED','REVOKED')),
  methodology_id uuid NOT NULL,
  methodology_version_id uuid NOT NULL,
  content_hash character(64) NOT NULL CHECK (content_hash::text ~ '^[0-9a-f]{64}$'),
  predecessor_state_id uuid,
  predecessor_state_kind text GENERATED ALWAYS AS (
    CASE WHEN predecessor_state_id IS NULL THEN NULL WHEN state_kind = 'VALIDATED' THEN 'REVOKED' ELSE 'VALIDATED' END) STORED,
  revokes_state_id uuid,
  revoked_state_kind text GENERATED ALWAYS AS (CASE WHEN revokes_state_id IS NULL THEN NULL ELSE 'VALIDATED' END) STORED,
  effective_from timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL,
  proposal_id uuid NOT NULL,
  decision_outcome text GENERATED ALWAYS AS (CASE WHEN state_kind = 'VALIDATED' THEN 'VALIDATE' ELSE 'REVOKE' END) STORED,
  governance_decision_id uuid NOT NULL,
  authorization_decision_id uuid NOT NULL,
  authorization_result text GENERATED ALWAYS AS ('ALLOW') STORED,
  authority_policy_id uuid NOT NULL,
  authority_policy_version_id uuid NOT NULL,
  authority_policy_content_hash text NOT NULL CHECK (authority_policy_content_hash ~ '^[0-9a-f]{64}$'),
  source_class text NOT NULL CHECK (source_class IN ('SYSTEM_SEED','LOCAL_HUMAN')),
  support_status text NOT NULL CHECK (support_status IN ('NONE','PRESENT')),
  CONSTRAINT l15_risk_methodology_states_pkey PRIMARY KEY (organisation_id, state_id),
  CONSTRAINT l15_risk_methodology_states_decision_unique UNIQUE (organisation_id, governance_decision_id),
  CONSTRAINT l15_risk_methodology_states_subject_unique UNIQUE (organisation_id, state_id, methodology_id, methodology_version_id, content_hash),
  -- The exact dependency key a later slice pins (organisation + identity + version + hash + state id + VALIDATED).
  CONSTRAINT l15_risk_methodology_states_kind_unique UNIQUE (organisation_id, state_id, methodology_id, methodology_version_id, content_hash, state_kind),
  CONSTRAINT l15_risk_methodology_states_shape_check CHECK (
    (state_kind = 'VALIDATED' AND revokes_state_id IS NULL)
    OR (state_kind = 'REVOKED' AND revokes_state_id IS NOT NULL AND predecessor_state_id = revokes_state_id)),
  CONSTRAINT l15_risk_methodology_states_version_fkey FOREIGN KEY (organisation_id, methodology_id, methodology_version_id, content_hash)
    REFERENCES gov_repo.l15_risk_methodology_versions (organisation_id, methodology_id, methodology_version_id, content_hash) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT l15_risk_methodology_states_predecessor_fkey
    FOREIGN KEY (organisation_id, predecessor_state_id, methodology_id, methodology_version_id, content_hash, predecessor_state_kind)
    REFERENCES gov_repo.l15_risk_methodology_states (organisation_id, state_id, methodology_id, methodology_version_id, content_hash, state_kind)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT l15_risk_methodology_states_revokes_fkey
    FOREIGN KEY (organisation_id, revokes_state_id, methodology_id, methodology_version_id, content_hash, revoked_state_kind)
    REFERENCES gov_repo.l15_risk_methodology_states (organisation_id, state_id, methodology_id, methodology_version_id, content_hash, state_kind)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  -- The exact governance decision of this subject kind and outcome, made under exactly this authorization.
  CONSTRAINT l15_risk_methodology_states_decision_fkey
    FOREIGN KEY (organisation_id, governance_decision_id, subject_kind, decision_outcome, authorization_decision_id)
    REFERENCES gov_repo.l14_governance_decisions (organisation_id, governance_decision_id, subject_kind, outcome, authorization_decision_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  -- The exact ALLOW authorization of this subject kind and action, with its exact Authority Policy basis snapshot.
  CONSTRAINT l15_risk_methodology_states_authorization_fkey
    FOREIGN KEY (organisation_id, authorization_decision_id, authorization_result, subject_kind, decision_outcome,
                 authority_policy_id, authority_policy_version_id, authority_policy_content_hash)
    REFERENCES gov_repo.l14_authorization_decisions (organisation_id, authorization_decision_id, result, subject_kind,
                 requested_action, basis_authority_policy_id, basis_version_id, basis_content_hash)
    ON UPDATE RESTRICT ON DELETE RESTRICT
);
CREATE UNIQUE INDEX l15_risk_methodology_states_root_uidx ON gov_repo.l15_risk_methodology_states (organisation_id, methodology_id, methodology_version_id, content_hash)
  WHERE predecessor_state_id IS NULL;
CREATE UNIQUE INDEX l15_risk_methodology_states_successor_uidx ON gov_repo.l15_risk_methodology_states (organisation_id, predecessor_state_id)
  WHERE predecessor_state_id IS NOT NULL;

-- Typed immutable proposal over the shared l14_proposals envelope: the exact admitted version tuple. No content copy, no
-- rationale, no free text. A REVOKE pins the exact VALIDATED state of the same tuple.
CREATE TABLE gov_repo.l15_risk_methodology_proposals (
  organisation_id uuid NOT NULL,
  proposal_id uuid NOT NULL,
  subject_kind text GENERATED ALWAYS AS ('RISK_METHODOLOGY') STORED,
  intent text NOT NULL CHECK (intent IN ('VALIDATE','REVOKE')),
  methodology_id uuid NOT NULL,
  methodology_version_id uuid NOT NULL,
  content_hash character(64) NOT NULL CHECK (content_hash::text ~ '^[0-9a-f]{64}$'),
  requested_effective_from timestamptz,          -- NULL = IMMEDIATE (DB transaction instant)
  target_state_id uuid,
  target_state_kind text GENERATED ALWAYS AS (CASE WHEN target_state_id IS NULL THEN NULL ELSE 'VALIDATED' END) STORED,
  CONSTRAINT l15_risk_methodology_proposals_pkey PRIMARY KEY (organisation_id, proposal_id),
  CONSTRAINT l15_risk_methodology_proposals_tuple_unique UNIQUE (organisation_id, proposal_id, methodology_id, methodology_version_id, content_hash, intent),
  CONSTRAINT l15_risk_methodology_proposals_target_check CHECK (
    (intent = 'VALIDATE' AND target_state_id IS NULL) OR (intent = 'REVOKE' AND target_state_id IS NOT NULL)),
  CONSTRAINT l15_risk_methodology_proposals_envelope_fkey FOREIGN KEY (organisation_id, proposal_id, subject_kind, intent)
    REFERENCES gov_repo.l14_proposals (organisation_id, proposal_id, subject_kind, intent) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT l15_risk_methodology_proposals_version_fkey FOREIGN KEY (organisation_id, methodology_id, methodology_version_id, content_hash)
    REFERENCES gov_repo.l15_risk_methodology_versions (organisation_id, methodology_id, methodology_version_id, content_hash) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT l15_risk_methodology_proposals_target_fkey
    FOREIGN KEY (organisation_id, target_state_id, methodology_id, methodology_version_id, content_hash, target_state_kind)
    REFERENCES gov_repo.l15_risk_methodology_states (organisation_id, state_id, methodology_id, methodology_version_id, content_hash, state_kind)
    ON UPDATE RESTRICT ON DELETE RESTRICT
);
-- A state belongs to the exact proposal its decision decided (same tuple, matching intent).
ALTER TABLE gov_repo.l15_risk_methodology_states
  ADD CONSTRAINT l15_risk_methodology_states_proposal_fkey
    FOREIGN KEY (organisation_id, proposal_id, methodology_id, methodology_version_id, content_hash, decision_outcome)
    REFERENCES gov_repo.l15_risk_methodology_proposals (organisation_id, proposal_id, methodology_id, methodology_version_id, content_hash, intent)
    ON UPDATE RESTRICT ON DELETE RESTRICT;

-- Technical validation head per exact tuple: compare-and-set pointer only, created by the first state-appending decision,
-- advanced only to the direct lineage successor, reconstructible from history, never authority. There is NO per-identity
-- "current / latest version" pointer.
CREATE TABLE gov_repo.l15_risk_methodology_heads (
  organisation_id uuid NOT NULL,
  methodology_id uuid NOT NULL,
  methodology_version_id uuid NOT NULL,
  content_hash character(64) NOT NULL CHECK (content_hash::text ~ '^[0-9a-f]{64}$'),
  latest_state_id uuid,
  CONSTRAINT l15_risk_methodology_heads_pkey PRIMARY KEY (organisation_id, methodology_id, methodology_version_id),
  CONSTRAINT l15_risk_methodology_heads_version_fkey FOREIGN KEY (organisation_id, methodology_id, methodology_version_id, content_hash)
    REFERENCES gov_repo.l15_risk_methodology_versions (organisation_id, methodology_id, methodology_version_id, content_hash) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT l15_risk_methodology_heads_state_fkey FOREIGN KEY (organisation_id, latest_state_id, methodology_id, methodology_version_id, content_hash)
    REFERENCES gov_repo.l15_risk_methodology_states (organisation_id, state_id, methodology_id, methodology_version_id, content_hash) ON UPDATE RESTRICT ON DELETE RESTRICT
);


-- ---------------------------------------------------------------------------------------------------------------------
-- D1. l15_support_links: rank-3 registry owners (§9.2), additive. One typed owner identity per row: the owner kind is the
--     registry subject kind; owner_registry_artifact names PROPOSAL / DECISION / STATE; exactly one typed owner column
--     (same-tenant composite FK) is non-null. Targets: DISCOVERY_EVIDENCE / SOURCE_ASSERTION only (rank 3 -> rank 0;
--     no RISK_SIGNAL / RISK_HYPOTHESIS / other tag; no L15 governed artifact is ever a target, so no cycle exists).
--     S1 owners, columns, rows and rules are unchanged (their branches are re-stated verbatim + new owner columns NULL).
-- ---------------------------------------------------------------------------------------------------------------------
ALTER TABLE gov_repo.l15_support_links
  ADD COLUMN owner_registry_artifact text CHECK (owner_registry_artifact IN ('PROPOSAL','DECISION','STATE')),
  ADD COLUMN owner_scenario_proposal_id uuid,
  ADD COLUMN owner_methodology_proposal_id uuid,
  ADD COLUMN owner_governance_decision_id uuid,
  ADD COLUMN owner_scenario_state_id uuid,
  ADD COLUMN owner_methodology_state_id uuid;
ALTER TABLE gov_repo.l15_support_links
  DROP CONSTRAINT l15_support_links_owner_kind_check,
  DROP CONSTRAINT l15_support_links_owner_shape_check,
  DROP CONSTRAINT l15_support_links_owner_target_matrix_check;
ALTER TABLE gov_repo.l15_support_links
  ADD CONSTRAINT l15_support_links_owner_kind_check CHECK (owner_kind IN (
    'RISK_SIGNAL','RISK_HYPOTHESIS','RISK_SCENARIO_DEFINITION','RISK_METHODOLOGY')),
  ADD CONSTRAINT l15_support_links_owner_shape_check CHECK (
    (owner_kind = 'RISK_SIGNAL' AND owner_signal_id IS NOT NULL AND owner_signal_kind IS NOT NULL AND owner_hypothesis_id IS NULL
      AND owner_registry_artifact IS NULL
      AND pg_catalog.num_nonnulls(owner_scenario_proposal_id, owner_methodology_proposal_id, owner_governance_decision_id,
                                  owner_scenario_state_id, owner_methodology_state_id) = 0)
    OR (owner_kind = 'RISK_HYPOTHESIS' AND owner_hypothesis_id IS NOT NULL AND owner_signal_id IS NULL AND owner_signal_kind IS NULL
      AND owner_registry_artifact IS NULL
      AND pg_catalog.num_nonnulls(owner_scenario_proposal_id, owner_methodology_proposal_id, owner_governance_decision_id,
                                  owner_scenario_state_id, owner_methodology_state_id) = 0)
    OR (owner_kind = 'RISK_SCENARIO_DEFINITION' AND owner_signal_id IS NULL AND owner_signal_kind IS NULL AND owner_hypothesis_id IS NULL
      AND owner_methodology_proposal_id IS NULL AND owner_methodology_state_id IS NULL
      AND pg_catalog.num_nonnulls(owner_scenario_proposal_id, owner_governance_decision_id, owner_scenario_state_id) = 1
      AND ((owner_registry_artifact = 'PROPOSAL') = (owner_scenario_proposal_id IS NOT NULL))
      AND ((owner_registry_artifact = 'DECISION') = (owner_governance_decision_id IS NOT NULL))
      AND ((owner_registry_artifact = 'STATE') = (owner_scenario_state_id IS NOT NULL)))
    OR (owner_kind = 'RISK_METHODOLOGY' AND owner_signal_id IS NULL AND owner_signal_kind IS NULL AND owner_hypothesis_id IS NULL
      AND owner_scenario_proposal_id IS NULL AND owner_scenario_state_id IS NULL
      AND pg_catalog.num_nonnulls(owner_methodology_proposal_id, owner_governance_decision_id, owner_methodology_state_id) = 1
      AND ((owner_registry_artifact = 'PROPOSAL') = (owner_methodology_proposal_id IS NOT NULL))
      AND ((owner_registry_artifact = 'DECISION') = (owner_governance_decision_id IS NOT NULL))
      AND ((owner_registry_artifact = 'STATE') = (owner_methodology_state_id IS NOT NULL)))),
  -- §9.2 closed acyclic owner -> target matrix: rank 1 -> rank 0, rank 2 -> rank 1, rank-3 registry -> two rank-0 tags.
  ADD CONSTRAINT l15_support_links_owner_target_matrix_check CHECK (
    (owner_kind = 'RISK_SIGNAL' AND target_tag IN ('DISCOVERY_EVIDENCE','SOURCE_ASSERTION','RUNTIME_OBSERVATION',
      'CROSS_SIGNAL_RESULT','EXECUTION_FIELD_STATE','TECHNICAL_FIELD_STATE','LINEAGE_OBSERVATION','L14_FACT_STATE'))
    OR (owner_kind = 'RISK_HYPOTHESIS' AND target_tag = 'RISK_SIGNAL')
    OR (owner_kind IN ('RISK_SCENARIO_DEFINITION','RISK_METHODOLOGY') AND target_tag IN ('DISCOVERY_EVIDENCE','SOURCE_ASSERTION'))),
  ADD CONSTRAINT l15_support_links_owner_scenario_proposal_fkey FOREIGN KEY (organisation_id, owner_scenario_proposal_id)
    REFERENCES gov_repo.l15_risk_scenario_definition_proposals (organisation_id, proposal_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  ADD CONSTRAINT l15_support_links_owner_methodology_proposal_fkey FOREIGN KEY (organisation_id, owner_methodology_proposal_id)
    REFERENCES gov_repo.l15_risk_methodology_proposals (organisation_id, proposal_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  ADD CONSTRAINT l15_support_links_owner_governance_decision_fkey FOREIGN KEY (organisation_id, owner_governance_decision_id)
    REFERENCES gov_repo.l14_governance_decisions (organisation_id, governance_decision_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  ADD CONSTRAINT l15_support_links_owner_scenario_state_fkey FOREIGN KEY (organisation_id, owner_scenario_state_id)
    REFERENCES gov_repo.l15_risk_scenario_definition_states (organisation_id, state_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  ADD CONSTRAINT l15_support_links_owner_methodology_state_fkey FOREIGN KEY (organisation_id, owner_methodology_state_id)
    REFERENCES gov_repo.l15_risk_methodology_states (organisation_id, state_id) ON UPDATE RESTRICT ON DELETE RESTRICT;
-- One link per registry owner x exact typed target (the S1 unique index covers the S1 owners).
CREATE UNIQUE INDEX l15_support_links_registry_owner_target_unique ON gov_repo.l15_support_links (organisation_id, owner_kind,
  owner_registry_artifact, (COALESCE(owner_scenario_proposal_id, owner_methodology_proposal_id, owner_governance_decision_id,
    owner_scenario_state_id, owner_methodology_state_id)), target_tag, (COALESCE(target_discovery_evidence_id, target_source_assertion_id)))
  WHERE owner_kind IN ('RISK_SCENARIO_DEFINITION','RISK_METHODOLOGY');

-- The S1 link guard, extended (S1 branches verbatim): a registry owner must have been written by THIS transaction (its
-- row xmin is the current transaction id) and a DECISION owner must be a governance decision of exactly that subject kind.
CREATE OR REPLACE FUNCTION gov_repo.l15_support_link_insert_guard_v1() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $fn$
DECLARE
  v_owner_recorded timestamptz;
  v_registry_owner boolean := false;
BEGIN
  NEW.link_id := pg_catalog.gen_random_uuid();
  NEW.recorded_at := pg_catalog.now();
  IF NEW.owner_kind = 'RISK_SIGNAL' THEN
    SELECT s.recorded_at INTO v_owner_recorded FROM gov_repo.l15_risk_signals AS s
    WHERE s.organisation_id = NEW.organisation_id AND s.signal_id = NEW.owner_signal_id;
  ELSIF NEW.owner_kind = 'RISK_HYPOTHESIS' THEN
    SELECT h.recorded_at INTO v_owner_recorded FROM gov_repo.l15_risk_hypotheses AS h
    WHERE h.organisation_id = NEW.organisation_id AND h.hypothesis_id = NEW.owner_hypothesis_id;
  ELSIF NEW.owner_kind IN ('RISK_SCENARIO_DEFINITION','RISK_METHODOLOGY') THEN
    v_registry_owner := CASE NEW.owner_registry_artifact
      WHEN 'PROPOSAL' THEN EXISTS (
        SELECT 1 FROM gov_repo.l14_proposals AS p
        WHERE p.organisation_id = NEW.organisation_id AND p.subject_kind = NEW.owner_kind
          AND p.proposal_id = COALESCE(NEW.owner_scenario_proposal_id, NEW.owner_methodology_proposal_id)
          AND p.xmin = pg_catalog.pg_current_xact_id()::xid)
      WHEN 'DECISION' THEN EXISTS (
        SELECT 1 FROM gov_repo.l14_governance_decisions AS d
        WHERE d.organisation_id = NEW.organisation_id AND d.governance_decision_id = NEW.owner_governance_decision_id
          AND d.subject_kind = NEW.owner_kind AND d.xmin = pg_catalog.pg_current_xact_id()::xid)
      WHEN 'STATE' THEN EXISTS (
        SELECT 1 FROM gov_repo.l15_risk_scenario_definition_states AS s
        WHERE s.organisation_id = NEW.organisation_id AND s.state_id = NEW.owner_scenario_state_id
          AND NEW.owner_kind = 'RISK_SCENARIO_DEFINITION' AND s.xmin = pg_catalog.pg_current_xact_id()::xid)
        OR EXISTS (
        SELECT 1 FROM gov_repo.l15_risk_methodology_states AS s
        WHERE s.organisation_id = NEW.organisation_id AND s.state_id = NEW.owner_methodology_state_id
          AND NEW.owner_kind = 'RISK_METHODOLOGY' AND s.xmin = pg_catalog.pg_current_xact_id()::xid)
      ELSE false END;
    IF NOT v_registry_owner THEN
      RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'SUPPORT_OWNER_NOT_IN_TRANSACTION';
    END IF;
    RETURN NEW;
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

-- Typed registry-owner link writer (one row per normalized support entry; the S1 normalizer resolves same-tenant targets).
CREATE FUNCTION gov_repo.l15_write_registry_support_links_v1(p_organisation_id uuid, p_owner_kind text, p_artifact text,
  p_proposal_id uuid, p_governance_decision_id uuid, p_state_id uuid, p_tags text[], p_ids text[])
RETURNS integer LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $fn$
DECLARE
  v_row record;
  v_count integer := 0;
BEGIN
  IF p_owner_kind NOT IN ('RISK_SCENARIO_DEFINITION','RISK_METHODOLOGY') OR p_artifact NOT IN ('PROPOSAL','DECISION','STATE') THEN
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'SUPPORT_OWNER_INVALID';
  END IF;
  FOR v_row IN SELECT * FROM gov_repo.l15_normalize_support_v1(p_organisation_id, p_tags, p_ids) LOOP
    INSERT INTO gov_repo.l15_support_links (organisation_id, link_id, owner_kind, owner_registry_artifact,
      owner_scenario_proposal_id, owner_methodology_proposal_id, owner_governance_decision_id, owner_scenario_state_id,
      owner_methodology_state_id, target_tag, target_discovery_evidence_id, target_source_assertion_id, recorded_at)
    VALUES (p_organisation_id, pg_catalog.gen_random_uuid(), p_owner_kind, p_artifact,
      CASE WHEN p_owner_kind = 'RISK_SCENARIO_DEFINITION' AND p_artifact = 'PROPOSAL' THEN p_proposal_id END,
      CASE WHEN p_owner_kind = 'RISK_METHODOLOGY' AND p_artifact = 'PROPOSAL' THEN p_proposal_id END,
      CASE WHEN p_artifact = 'DECISION' THEN p_governance_decision_id END,
      CASE WHEN p_owner_kind = 'RISK_SCENARIO_DEFINITION' AND p_artifact = 'STATE' THEN p_state_id END,
      CASE WHEN p_owner_kind = 'RISK_METHODOLOGY' AND p_artifact = 'STATE' THEN p_state_id END,
      v_row.tag,
      CASE WHEN v_row.tag = 'DISCOVERY_EVIDENCE' THEN v_row.target_id END,
      CASE WHEN v_row.tag = 'SOURCE_ASSERTION' THEN v_row.target_id END,
      pg_catalog.now());
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$fn$;

-- ---------------------------------------------------------------------------------------------------------------------
-- D2. l14_command_results: the S0-deferred D-01 §4 L15 decision-result branch. A VALIDATED / REVOKED decision result of an
--     L15 registry subject references the exact L15 state id (l15_state_id) and never an AP / registry / fact state. The AP,
--     M16 registry, M16 fact and other L15 branches are restated verbatim (l15_state_id NULL everywhere else).
-- ---------------------------------------------------------------------------------------------------------------------
ALTER TABLE gov_repo.l14_command_results ADD COLUMN l15_state_id uuid;
ALTER TABLE gov_repo.l14_command_results DROP CONSTRAINT l14_command_results_shape_check;
ALTER TABLE gov_repo.l14_command_results
  ADD CONSTRAINT l14_command_results_shape_check CHECK (
    (subject_kind = 'AUTHORITY_POLICY_VERSION' AND registry_state_id IS NULL AND fact_state_id IS NULL AND (
      (command_kind = 'SUBMIT_PROPOSAL' AND outcome = 'SUBMITTED' AND authorization_decision_id IS NULL
        AND proposal_id IS NOT NULL AND governance_decision_id IS NULL AND state_id IS NULL AND version_id IS NOT NULL)
      OR (command_kind = 'ADMIT_AUTHORITY_POLICY_VERSION' AND outcome = 'ADMITTED' AND authorization_decision_id IS NOT NULL
        AND proposal_id IS NULL AND governance_decision_id IS NULL AND state_id IS NULL
        AND authority_policy_id IS NOT NULL AND version_id IS NOT NULL)
      OR (command_kind IN ('ADMIT_AUTHORITY_POLICY_VERSION','DECIDE_PROPOSAL') AND outcome = 'DENIED'
        AND authorization_decision_id IS NOT NULL AND governance_decision_id IS NULL AND state_id IS NULL)
      OR (command_kind = 'DECIDE_PROPOSAL' AND outcome IN ('VALIDATED','REVOKED') AND authorization_decision_id IS NOT NULL
        AND proposal_id IS NOT NULL AND governance_decision_id IS NOT NULL AND state_id IS NOT NULL)
      OR (command_kind = 'DECIDE_PROPOSAL' AND outcome IN ('REJECTED','DEFERRED') AND authorization_decision_id IS NOT NULL
        AND proposal_id IS NOT NULL AND governance_decision_id IS NOT NULL AND state_id IS NULL)))
    OR (subject_kind IN ('GOVERNANCE_PARTY','BUSINESS_DOMAIN','INFORMATION_DOMAIN','CONTROL_DEFINITION','POLICY_VERSION')
      AND fact_state_id IS NULL
      AND authority_policy_id IS NULL AND version_id IS NULL AND state_id IS NULL AND (
      (command_kind = 'SUBMIT_PROPOSAL' AND outcome = 'SUBMITTED' AND authorization_decision_id IS NULL
        AND proposal_id IS NOT NULL AND governance_decision_id IS NULL AND registry_state_id IS NULL)
      OR (command_kind LIKE 'ADMIT\_%' ESCAPE '\' AND outcome = 'ADMITTED' AND authorization_decision_id IS NOT NULL
        AND proposal_id IS NULL AND governance_decision_id IS NULL AND registry_state_id IS NULL)
      OR (command_kind LIKE 'ADMIT\_%' ESCAPE '\' AND outcome = 'DENIED' AND authorization_decision_id IS NOT NULL
        AND proposal_id IS NULL AND governance_decision_id IS NULL AND registry_state_id IS NULL)
      OR (command_kind = 'DECIDE_PROPOSAL' AND outcome = 'DENIED' AND authorization_decision_id IS NOT NULL
        AND proposal_id IS NOT NULL AND governance_decision_id IS NULL AND registry_state_id IS NULL)
      OR (command_kind = 'DECIDE_PROPOSAL' AND outcome IN ('VALIDATED','REVOKED') AND authorization_decision_id IS NOT NULL
        AND proposal_id IS NOT NULL AND governance_decision_id IS NOT NULL AND registry_state_id IS NOT NULL)
      OR (command_kind = 'DECIDE_PROPOSAL' AND outcome IN ('REJECTED','DEFERRED') AND authorization_decision_id IS NOT NULL
        AND proposal_id IS NOT NULL AND governance_decision_id IS NOT NULL AND registry_state_id IS NULL)))
    OR (subject_kind IN ('RESPONSIBILITY_ASSIGNMENT','BUSINESS_CONTEXT_ASSIGNMENT','POLICY_APPLICABILITY',
                         'CONTROL_APPLICABILITY','CONTROL_ASSESSMENT')
      AND authority_policy_id IS NULL AND version_id IS NULL AND state_id IS NULL AND registry_state_id IS NULL AND (
      (command_kind = 'SUBMIT_PROPOSAL' AND outcome = 'SUBMITTED' AND authorization_decision_id IS NULL
        AND proposal_id IS NOT NULL AND governance_decision_id IS NULL AND fact_state_id IS NULL)
      OR (command_kind = 'DECIDE_PROPOSAL' AND outcome = 'DENIED' AND authorization_decision_id IS NOT NULL
        AND proposal_id IS NOT NULL AND governance_decision_id IS NULL AND fact_state_id IS NULL)
      OR (command_kind = 'DECIDE_PROPOSAL' AND outcome IN ('VALIDATED','REVOKED') AND authorization_decision_id IS NOT NULL
        AND proposal_id IS NOT NULL AND governance_decision_id IS NOT NULL AND fact_state_id IS NOT NULL)
      OR (command_kind = 'DECIDE_PROPOSAL' AND outcome IN ('REJECTED','DEFERRED') AND authorization_decision_id IS NOT NULL
        AND proposal_id IS NOT NULL AND governance_decision_id IS NOT NULL AND fact_state_id IS NULL)))
    OR (subject_kind IN ('RISK_SCENARIO_DEFINITION','RISK_METHODOLOGY','GOVERNED_RISK',
                         'RISK_ASSESSMENT','RISK_TREATMENT','RISK_ACCEPTANCE')
      AND authority_policy_id IS NULL AND version_id IS NULL AND state_id IS NULL AND registry_state_id IS NULL
      AND fact_state_id IS NULL AND (
      (command_kind = 'SUBMIT_PROPOSAL' AND outcome = 'SUBMITTED' AND authorization_decision_id IS NULL
        AND proposal_id IS NOT NULL AND governance_decision_id IS NULL)
      OR (command_kind IN ('ADMIT_RISK_SCENARIO_DEFINITION_VERSION','ADMIT_RISK_METHODOLOGY_VERSION')
        AND outcome IN ('ADMITTED','DENIED') AND authorization_decision_id IS NOT NULL
        AND proposal_id IS NULL AND governance_decision_id IS NULL)
      OR (command_kind = 'DECIDE_PROPOSAL' AND outcome = 'DENIED' AND authorization_decision_id IS NOT NULL
        AND proposal_id IS NOT NULL AND governance_decision_id IS NULL)
      OR (command_kind = 'DECIDE_PROPOSAL' AND outcome IN ('REJECTED','DEFERRED') AND authorization_decision_id IS NOT NULL
        AND proposal_id IS NOT NULL AND governance_decision_id IS NOT NULL)
      OR (subject_kind IN ('RISK_SCENARIO_DEFINITION','RISK_METHODOLOGY')
        AND command_kind = 'DECIDE_PROPOSAL' AND outcome IN ('VALIDATED','REVOKED') AND authorization_decision_id IS NOT NULL
        AND proposal_id IS NOT NULL AND governance_decision_id IS NOT NULL AND l15_state_id IS NOT NULL)))),
  -- l15_state_id is set ONLY on an L15 registry VALIDATED / REVOKED decision result (S3+ widen this for their families).
  ADD CONSTRAINT l14_command_results_l15_state_check CHECK (
    l15_state_id IS NULL
    OR (subject_kind IN ('RISK_SCENARIO_DEFINITION','RISK_METHODOLOGY') AND command_kind = 'DECIDE_PROPOSAL'
        AND outcome IN ('VALIDATED','REVOKED')));

-- The l15_state_id of a result names exactly the L15 state of that governance decision / proposal / outcome (no FK from
-- the shared L14 envelope onto an L15 store; the guard reads the typed L15 state store of the result's subject kind).
CREATE FUNCTION gov_repo.l15_command_result_state_guard_v1() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $guard$
BEGIN
  IF NOT (CASE NEW.subject_kind
       WHEN 'RISK_SCENARIO_DEFINITION' THEN EXISTS (
         SELECT 1 FROM gov_repo.l15_risk_scenario_definition_states AS s
         WHERE s.organisation_id = NEW.organisation_id AND s.state_id = NEW.l15_state_id
           AND s.governance_decision_id = NEW.governance_decision_id AND s.proposal_id = NEW.proposal_id
           AND s.authorization_decision_id = NEW.authorization_decision_id AND s.state_kind = NEW.outcome
           AND s.recorded_at = NEW.recorded_at)
       WHEN 'RISK_METHODOLOGY' THEN EXISTS (
         SELECT 1 FROM gov_repo.l15_risk_methodology_states AS s
         WHERE s.organisation_id = NEW.organisation_id AND s.state_id = NEW.l15_state_id
           AND s.governance_decision_id = NEW.governance_decision_id AND s.proposal_id = NEW.proposal_id
           AND s.authorization_decision_id = NEW.authorization_decision_id AND s.state_kind = NEW.outcome
           AND s.recorded_at = NEW.recorded_at)
       ELSE false END) THEN
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'COMMAND_RESULT_L15_STATE_MISMATCH';
  END IF;
  RETURN NEW;
END;
$guard$;
CREATE TRIGGER l15_command_results_state_guard BEFORE INSERT ON gov_repo.l14_command_results
  FOR EACH ROW WHEN (NEW.l15_state_id IS NOT NULL) EXECUTE FUNCTION gov_repo.l15_command_result_state_guard_v1();
ALTER TABLE gov_repo.l14_command_results ENABLE ALWAYS TRIGGER l15_command_results_state_guard;

-- ---------------------------------------------------------------------------------------------------------------------
-- E00. Stored-content hash recomputation (after the content tables exist).
-- ---------------------------------------------------------------------------------------------------------------------
-- The same hash recomputed from the STORED normalized content of one version (commit-time integrity).
CREATE FUNCTION gov_repo.l15_risk_scenario_stored_content_hash_v1(p_organisation_id uuid, p_version_id uuid)
RETURNS text LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $fn$
  SELECT gov_repo.l15_risk_scenario_content_hash_v1(v.risk_domain,
    COALESCE((SELECT pg_catalog.array_agg(s.subject_kind) FROM gov_repo.l15_risk_scenario_definition_subject_kinds AS s
              WHERE s.organisation_id = v.organisation_id AND s.scenario_definition_version_id = v.scenario_definition_version_id), ARRAY[]::text[]),
    COALESCE((SELECT pg_catalog.array_agg(r.reference_namespace ORDER BY r.reference_namespace, r.reference_code)
              FROM gov_repo.l15_risk_scenario_definition_references AS r
              WHERE r.organisation_id = v.organisation_id AND r.scenario_definition_version_id = v.scenario_definition_version_id), ARRAY[]::text[]),
    COALESCE((SELECT pg_catalog.array_agg(r.reference_code ORDER BY r.reference_namespace, r.reference_code)
              FROM gov_repo.l15_risk_scenario_definition_references AS r
              WHERE r.organisation_id = v.organisation_id AND r.scenario_definition_version_id = v.scenario_definition_version_id), ARRAY[]::text[]))
  FROM gov_repo.l15_risk_scenario_definition_versions AS v
  WHERE v.organisation_id = p_organisation_id AND v.scenario_definition_version_id = p_version_id
$fn$;

-- Methodology stored-content hash.
CREATE FUNCTION gov_repo.l15_risk_methodology_stored_content_hash_v1(p_organisation_id uuid, p_version_id uuid)
RETURNS text LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $fn$
  SELECT gov_repo.l15_risk_methodology_content_hash_v1(
    (SELECT pg_catalog.array_agg(l.level_code ORDER BY l.ordinal) FROM gov_repo.l15_risk_methodology_likelihood_levels AS l
     WHERE l.organisation_id = p_organisation_id AND l.methodology_version_id = p_version_id),
    (SELECT pg_catalog.array_agg(l.ordinal::integer ORDER BY l.ordinal) FROM gov_repo.l15_risk_methodology_likelihood_levels AS l
     WHERE l.organisation_id = p_organisation_id AND l.methodology_version_id = p_version_id),
    (SELECT pg_catalog.array_agg(l.definition_reference_namespace ORDER BY l.ordinal) FROM gov_repo.l15_risk_methodology_likelihood_levels AS l
     WHERE l.organisation_id = p_organisation_id AND l.methodology_version_id = p_version_id),
    (SELECT pg_catalog.array_agg(l.definition_reference_code ORDER BY l.ordinal) FROM gov_repo.l15_risk_methodology_likelihood_levels AS l
     WHERE l.organisation_id = p_organisation_id AND l.methodology_version_id = p_version_id),
    (SELECT pg_catalog.array_agg(l.level_code ORDER BY l.ordinal) FROM gov_repo.l15_risk_methodology_impact_levels AS l
     WHERE l.organisation_id = p_organisation_id AND l.methodology_version_id = p_version_id),
    (SELECT pg_catalog.array_agg(l.ordinal::integer ORDER BY l.ordinal) FROM gov_repo.l15_risk_methodology_impact_levels AS l
     WHERE l.organisation_id = p_organisation_id AND l.methodology_version_id = p_version_id),
    (SELECT pg_catalog.array_agg(l.definition_reference_namespace ORDER BY l.ordinal) FROM gov_repo.l15_risk_methodology_impact_levels AS l
     WHERE l.organisation_id = p_organisation_id AND l.methodology_version_id = p_version_id),
    (SELECT pg_catalog.array_agg(l.definition_reference_code ORDER BY l.ordinal) FROM gov_repo.l15_risk_methodology_impact_levels AS l
     WHERE l.organisation_id = p_organisation_id AND l.methodology_version_id = p_version_id),
    (SELECT pg_catalog.array_agg(c.likelihood_level_code ORDER BY c.likelihood_level_code, c.impact_level_code) FROM gov_repo.l15_risk_methodology_rating_cells AS c
     WHERE c.organisation_id = p_organisation_id AND c.methodology_version_id = p_version_id),
    (SELECT pg_catalog.array_agg(c.impact_level_code ORDER BY c.likelihood_level_code, c.impact_level_code) FROM gov_repo.l15_risk_methodology_rating_cells AS c
     WHERE c.organisation_id = p_organisation_id AND c.methodology_version_id = p_version_id),
    (SELECT pg_catalog.array_agg(c.rating_band ORDER BY c.likelihood_level_code, c.impact_level_code) FROM gov_repo.l15_risk_methodology_rating_cells AS c
     WHERE c.organisation_id = p_organisation_id AND c.methodology_version_id = p_version_id),
    v.assessment_validity_maximum)
  FROM gov_repo.l15_risk_methodology_versions AS v
  WHERE v.organisation_id = p_organisation_id AND v.methodology_version_id = p_version_id
$fn$;

-- ---------------------------------------------------------------------------------------------------------------------
-- E0. Shared registry guards.
-- ---------------------------------------------------------------------------------------------------------------------
-- Normalized content rows are written only together with their version (same transaction: the version row's xmin is the
-- current transaction id); no later top-up of an admitted version.
CREATE FUNCTION gov_repo.l15_registry_content_insert_guard_v1() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $guard$
DECLARE
  v_ok boolean := false;
BEGIN
  IF TG_TABLE_NAME IN ('l15_risk_scenario_definition_subject_kinds','l15_risk_scenario_definition_references') THEN
    PERFORM 1 FROM gov_repo.l15_risk_scenario_definition_versions AS v
    WHERE v.organisation_id = NEW.organisation_id AND v.scenario_definition_version_id = NEW.scenario_definition_version_id
      AND v.xmin = pg_catalog.pg_current_xact_id()::xid;
    v_ok := FOUND;
  ELSIF TG_TABLE_NAME IN ('l15_risk_methodology_likelihood_levels','l15_risk_methodology_impact_levels',
                          'l15_risk_methodology_rating_cells') THEN
    PERFORM 1 FROM gov_repo.l15_risk_methodology_versions AS v
    WHERE v.organisation_id = NEW.organisation_id AND v.methodology_version_id = NEW.methodology_version_id
      AND v.xmin = pg_catalog.pg_current_xact_id()::xid;
    v_ok := FOUND;
  END IF;
  IF NOT v_ok THEN
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'REGISTRY_CONTENT_NOT_IN_VERSION_TRANSACTION';
  END IF;
  RETURN NEW;
END;
$guard$;

-- Commit-time (DEFERRABLE INITIALLY DEFERRED) registry integrity:
--   * versions: the stored normalized content is complete (scenario: >= 1 subject kind, >= 1 reference; methodology: each
--     scale 2..7 levels with contiguous ordinals 1..n, exactly n x m matrix cells) and re-hashes to the stored hash;
--   * typed proposals / states: the stored support_status equals the actual registry support-link set; a SYSTEM_SEED
--     proposal has PRESENT support.
-- SECURITY DEFINER necessity (as the S1 completeness guard): a deferred trigger fires at COMMIT as the committing role
-- (service_role), which by design holds no L15 table privilege. Trigger function only: EXECUTE is owner-only, it reads
-- L15 / envelope rows and writes nothing.
CREATE FUNCTION gov_repo.l15_registry_commit_guard_v1() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $fn$
DECLARE
  v_a bigint;
  v_b bigint;
  v_c bigint;
  v_status text;
  v_source text;
BEGIN
  IF TG_TABLE_NAME = 'l15_risk_scenario_definition_versions' THEN
    SELECT pg_catalog.count(*) INTO v_a FROM gov_repo.l15_risk_scenario_definition_subject_kinds AS s
    WHERE s.organisation_id = NEW.organisation_id AND s.scenario_definition_version_id = NEW.scenario_definition_version_id;
    SELECT pg_catalog.count(*) INTO v_b FROM gov_repo.l15_risk_scenario_definition_references AS r
    WHERE r.organisation_id = NEW.organisation_id AND r.scenario_definition_version_id = NEW.scenario_definition_version_id;
    IF v_a < 1 OR v_b < 1
       OR gov_repo.l15_risk_scenario_stored_content_hash_v1(NEW.organisation_id, NEW.scenario_definition_version_id)
          IS DISTINCT FROM NEW.content_hash::text THEN
      RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'RISK_SCENARIO_DEFINITION_VERSION_CONTENT_INCOMPLETE';
    END IF;
  ELSIF TG_TABLE_NAME = 'l15_risk_methodology_versions' THEN
    SELECT pg_catalog.count(*), COALESCE(pg_catalog.max(l.ordinal), 0) INTO v_a, v_c FROM gov_repo.l15_risk_methodology_likelihood_levels AS l
    WHERE l.organisation_id = NEW.organisation_id AND l.methodology_version_id = NEW.methodology_version_id;
    IF v_a NOT BETWEEN 2 AND 7 OR v_c <> v_a THEN
      RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'RISK_METHODOLOGY_VERSION_CONTENT_INCOMPLETE';
    END IF;
    SELECT pg_catalog.count(*), COALESCE(pg_catalog.max(l.ordinal), 0) INTO v_b, v_c FROM gov_repo.l15_risk_methodology_impact_levels AS l
    WHERE l.organisation_id = NEW.organisation_id AND l.methodology_version_id = NEW.methodology_version_id;
    IF v_b NOT BETWEEN 2 AND 7 OR v_c <> v_b THEN
      RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'RISK_METHODOLOGY_VERSION_CONTENT_INCOMPLETE';
    END IF;
    SELECT pg_catalog.count(*) INTO v_c FROM gov_repo.l15_risk_methodology_rating_cells AS c
    WHERE c.organisation_id = NEW.organisation_id AND c.methodology_version_id = NEW.methodology_version_id;
    IF v_c <> v_a * v_b
       OR gov_repo.l15_risk_methodology_stored_content_hash_v1(NEW.organisation_id, NEW.methodology_version_id)
          IS DISTINCT FROM NEW.content_hash::text THEN
      RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'RISK_METHODOLOGY_VERSION_CONTENT_INCOMPLETE';
    END IF;
  ELSIF TG_TABLE_NAME IN ('l15_risk_scenario_definition_proposals','l15_risk_methodology_proposals') THEN
    SELECT p.support_status, p.source_class INTO v_status, v_source FROM gov_repo.l14_proposals AS p
    WHERE p.organisation_id = NEW.organisation_id AND p.proposal_id = NEW.proposal_id;
    SELECT pg_catalog.count(*) INTO v_a FROM gov_repo.l15_support_links AS l
    WHERE l.organisation_id = NEW.organisation_id AND l.owner_registry_artifact = 'PROPOSAL'
      AND COALESCE(l.owner_scenario_proposal_id, l.owner_methodology_proposal_id) = NEW.proposal_id;
    IF v_status IS NULL OR (v_status = 'PRESENT') <> (v_a > 0) OR (v_source = 'SYSTEM_SEED' AND v_a = 0) THEN
      RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'REGISTRY_PROPOSAL_SUPPORT_INCOMPLETE';
    END IF;
  ELSIF TG_TABLE_NAME IN ('l15_risk_scenario_definition_states','l15_risk_methodology_states') THEN
    SELECT pg_catalog.count(*) INTO v_a FROM gov_repo.l15_support_links AS l
    WHERE l.organisation_id = NEW.organisation_id AND l.owner_registry_artifact = 'STATE'
      AND COALESCE(l.owner_scenario_state_id, l.owner_methodology_state_id) = NEW.state_id;
    SELECT pg_catalog.count(*) INTO v_b FROM gov_repo.l15_support_links AS l
    WHERE l.organisation_id = NEW.organisation_id AND l.owner_registry_artifact = 'DECISION'
      AND l.owner_governance_decision_id = NEW.governance_decision_id;
    IF (NEW.support_status = 'PRESENT') <> (v_a > 0) OR v_a <> v_b THEN
      RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'REGISTRY_STATE_SUPPORT_INCOMPLETE';
    END IF;
  ELSE
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'UNEXPECTED_STORE';
  END IF;
  RETURN NULL;
END;
$fn$;

-- ---------------------------------------------------------------------------------------------------------------------
-- E. RISK_SCENARIO_DEFINITION structural guards (raising, ENABLE ALWAYS, owner-only SECURITY INVOKER).
-- ---------------------------------------------------------------------------------------------------------------------
-- The identity is created only right after its root version by the same exact ALLOW / RISK_SCENARIO_DEFINITION / ADMIT EXPECTED_NONE
-- authorization at the same instant.
CREATE FUNCTION gov_repo.l15_risk_scenario_definition_identity_guard_v1() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $guard$
DECLARE
  v_authz record;
BEGIN
  SELECT a.evaluated_at, a.expectation_kind, a.expected_latest_version_id INTO v_authz
  FROM gov_repo.l14_authorization_decisions AS a
  WHERE a.organisation_id = NEW.organisation_id AND a.authorization_decision_id = NEW.admission_authorization_decision_id
    AND a.result = 'ALLOW' AND a.subject_kind = 'RISK_SCENARIO_DEFINITION' AND a.requested_action = 'ADMIT';
  IF NOT FOUND OR v_authz.evaluated_at IS DISTINCT FROM NEW.recorded_at
     OR v_authz.expectation_kind IS DISTINCT FROM 'EXPECTED_NONE' OR v_authz.expected_latest_version_id IS NOT NULL THEN
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'RISK_SCENARIO_DEFINITION_IDENTITY_AUTHORIZATION_MISMATCH';
  END IF;
  PERFORM 1 FROM gov_repo.l15_risk_scenario_definition_versions AS v
  WHERE v.organisation_id = NEW.organisation_id AND v.scenario_definition_id = NEW.scenario_definition_id
    AND v.predecessor_version_id IS NULL AND v.admission_authorization_decision_id = NEW.admission_authorization_decision_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'RISK_SCENARIO_DEFINITION_IDENTITY_WITHOUT_ROOT_VERSION';
  END IF;
  RETURN NEW;
END;
$guard$;
CREATE TRIGGER l15_risk_scenario_definitions_guard BEFORE INSERT ON gov_repo.l15_risk_scenario_definitions
  FOR EACH ROW EXECUTE FUNCTION gov_repo.l15_risk_scenario_definition_identity_guard_v1();

-- A version mirrors its exact authorization (actor, source, instant, DB content hash as attempted content, the
-- expectation it was decided under = its lineage predecessor). Its content rows and its DB-recomputed stored content hash
-- are verified at commit (l15_registry_commit_guard_v1) because the normalized content rows follow it.
CREATE FUNCTION gov_repo.l15_risk_scenario_definition_version_guard_v1() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $guard$
DECLARE
  v_authz record;
  v_identity_authz uuid;
BEGIN
  SELECT a.actor_user_id, a.source_class, a.evaluated_at, a.attempted_content_hash, a.expectation_kind, a.expected_latest_version_id
  INTO v_authz
  FROM gov_repo.l14_authorization_decisions AS a
  WHERE a.organisation_id = NEW.organisation_id AND a.authorization_decision_id = NEW.admission_authorization_decision_id
    AND a.result = 'ALLOW' AND a.subject_kind = 'RISK_SCENARIO_DEFINITION' AND a.requested_action = 'ADMIT';
  IF NOT FOUND OR v_authz.actor_user_id IS DISTINCT FROM NEW.admitted_by_actor_user_id
     OR v_authz.source_class IS DISTINCT FROM NEW.source_class OR v_authz.evaluated_at IS DISTINCT FROM NEW.recorded_at
     OR v_authz.attempted_content_hash IS DISTINCT FROM NEW.content_hash::text
     OR v_authz.expectation_kind IS DISTINCT FROM (CASE WHEN NEW.predecessor_version_id IS NULL THEN 'EXPECTED_NONE' ELSE 'EXPECTED_CURRENT' END)
     OR v_authz.expected_latest_version_id IS DISTINCT FROM NEW.predecessor_version_id THEN
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'RISK_SCENARIO_DEFINITION_VERSION_AUTHORIZATION_MISMATCH';
  END IF;
  SELECT d.admission_authorization_decision_id INTO v_identity_authz
  FROM gov_repo.l15_risk_scenario_definitions AS d
  WHERE d.organisation_id = NEW.organisation_id AND d.scenario_definition_id = NEW.scenario_definition_id;
  IF (NEW.predecessor_version_id IS NULL AND FOUND)
     OR (NEW.predecessor_version_id IS NOT NULL AND (NOT FOUND OR v_identity_authz = NEW.admission_authorization_decision_id)) THEN
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'RISK_SCENARIO_DEFINITION_VERSION_IDENTITY_MISMATCH';
  END IF;
  RETURN NEW;
END;
$guard$;
CREATE TRIGGER l15_risk_scenario_definition_versions_guard BEFORE INSERT ON gov_repo.l15_risk_scenario_definition_versions
  FOR EACH ROW EXECUTE FUNCTION gov_repo.l15_risk_scenario_definition_version_guard_v1();
CREATE CONSTRAINT TRIGGER l15_risk_scenario_definition_versions_complete AFTER INSERT ON gov_repo.l15_risk_scenario_definition_versions
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION gov_repo.l15_registry_commit_guard_v1();
CREATE TRIGGER l15_risk_scenario_definition_subject_kinds_guard BEFORE INSERT ON gov_repo.l15_risk_scenario_definition_subject_kinds
  FOR EACH ROW EXECUTE FUNCTION gov_repo.l15_registry_content_insert_guard_v1();
CREATE TRIGGER l15_risk_scenario_definition_references_guard BEFORE INSERT ON gov_repo.l15_risk_scenario_definition_references
  FOR EACH ROW EXECUTE FUNCTION gov_repo.l15_registry_content_insert_guard_v1();

-- A proposal's envelope source class is the admission source class of its exact version tuple (no laundering).
CREATE FUNCTION gov_repo.l15_risk_scenario_definition_proposal_guard_v1() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $guard$
DECLARE
  v_envelope_source text;
  v_version_source text;
BEGIN
  SELECT p.source_class INTO v_envelope_source
  FROM gov_repo.l14_proposals AS p
  WHERE p.organisation_id = NEW.organisation_id AND p.proposal_id = NEW.proposal_id AND p.subject_kind = 'RISK_SCENARIO_DEFINITION';
  SELECT v.source_class INTO v_version_source
  FROM gov_repo.l15_risk_scenario_definition_versions AS v
  WHERE v.organisation_id = NEW.organisation_id AND v.scenario_definition_id = NEW.scenario_definition_id
    AND v.scenario_definition_version_id = NEW.scenario_definition_version_id AND v.content_hash = NEW.content_hash;
  IF v_envelope_source IS NULL OR v_version_source IS NULL OR v_envelope_source IS DISTINCT FROM v_version_source THEN
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'RISK_SCENARIO_DEFINITION_PROPOSAL_SOURCE_MISMATCH';
  END IF;
  RETURN NEW;
END;
$guard$;
CREATE TRIGGER l15_risk_scenario_definition_proposals_guard BEFORE INSERT ON gov_repo.l15_risk_scenario_definition_proposals
  FOR EACH ROW EXECUTE FUNCTION gov_repo.l15_risk_scenario_definition_proposal_guard_v1();
CREATE CONSTRAINT TRIGGER l15_risk_scenario_definition_proposals_support_complete AFTER INSERT ON gov_repo.l15_risk_scenario_definition_proposals
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION gov_repo.l15_registry_commit_guard_v1();

-- A state mirrors its exact decision / authorization / proposal / version, is recorded at the decision instant, takes its
-- effective_from from the proposal (NULL request = the decision instant), and respects the M16 S1B.1R1 interval rules.
CREATE FUNCTION gov_repo.l15_risk_scenario_definition_state_guard_v1() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $guard$
DECLARE
  v_decision record;
  v_proposal record;
  v_version_source text;
  v_related record;
BEGIN
  SELECT d.proposal_id, d.decided_at, d.support_status, d.actor_user_id INTO v_decision
  FROM gov_repo.l14_governance_decisions AS d
  WHERE d.organisation_id = NEW.organisation_id AND d.governance_decision_id = NEW.governance_decision_id
    AND d.subject_kind = 'RISK_SCENARIO_DEFINITION';
  SELECT p.source_class, t.requested_effective_from, t.target_state_id INTO v_proposal
  FROM gov_repo.l14_proposals AS p
  JOIN gov_repo.l15_risk_scenario_definition_proposals AS t ON t.organisation_id = p.organisation_id AND t.proposal_id = p.proposal_id
  WHERE p.organisation_id = NEW.organisation_id AND p.proposal_id = NEW.proposal_id;
  SELECT v.source_class INTO v_version_source
  FROM gov_repo.l15_risk_scenario_definition_versions AS v
  WHERE v.organisation_id = NEW.organisation_id AND v.scenario_definition_id = NEW.scenario_definition_id AND v.scenario_definition_version_id = NEW.scenario_definition_version_id
    AND v.content_hash = NEW.content_hash;
  IF v_decision.proposal_id IS DISTINCT FROM NEW.proposal_id OR v_decision.decided_at IS DISTINCT FROM NEW.recorded_at
     OR v_decision.support_status IS DISTINCT FROM NEW.support_status
     OR v_proposal.source_class IS DISTINCT FROM NEW.source_class OR v_version_source IS DISTINCT FROM NEW.source_class
     OR v_proposal.target_state_id IS DISTINCT FROM NEW.revokes_state_id
     OR NEW.effective_from IS DISTINCT FROM COALESCE(v_proposal.requested_effective_from, NEW.recorded_at) THEN
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'RISK_SCENARIO_DEFINITION_STATE_ENVELOPE_MISMATCH';
  END IF;
  IF NEW.predecessor_state_id IS NOT NULL THEN
    SELECT s.effective_from INTO v_related FROM gov_repo.l15_risk_scenario_definition_states AS s
    WHERE s.organisation_id = NEW.organisation_id AND s.state_id = NEW.predecessor_state_id;
    IF NEW.state_kind = 'REVOKED' AND NEW.effective_from < v_related.effective_from THEN
      RAISE EXCEPTION 'L15_CONTINUITY_VIOLATION' USING ERRCODE = 'GV011', DETAIL = 'REVOKE_BEFORE_TARGET_EFFECTIVE';
    END IF;
    IF NEW.state_kind = 'VALIDATED' AND NOT (NEW.effective_from >= v_related.effective_from) THEN
      RAISE EXCEPTION 'L15_CONTINUITY_VIOLATION' USING ERRCODE = 'GV011', DETAIL = 'REVALIDATION_OVERLAPS_PRIOR_INTERVAL';
    END IF;
  END IF;
  RETURN NEW;
END;
$guard$;
CREATE TRIGGER l15_risk_scenario_definition_states_guard BEFORE INSERT ON gov_repo.l15_risk_scenario_definition_states
  FOR EACH ROW EXECUTE FUNCTION gov_repo.l15_risk_scenario_definition_state_guard_v1();
CREATE CONSTRAINT TRIGGER l15_risk_scenario_definition_states_support_complete AFTER INSERT ON gov_repo.l15_risk_scenario_definition_states
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION gov_repo.l15_registry_commit_guard_v1();

-- The head is the only mutable RISK_SCENARIO_DEFINITION table: created empty, identity fixed, never deleted / truncated, only ever advanced
-- to the direct lineage successor of its current state.
CREATE FUNCTION gov_repo.l15_risk_scenario_definition_head_guard_v1() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $head$
BEGIN
  IF TG_OP IN ('DELETE','TRUNCATE') THEN
    RAISE EXCEPTION 'L15_HISTORY_IMMUTABLE' USING ERRCODE = '55000', DETAIL = 'l15_risk_scenario_definition_heads:' || TG_OP;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.latest_state_id IS NOT NULL THEN
      RAISE EXCEPTION 'L15_HISTORY_IMMUTABLE' USING ERRCODE = '55000', DETAIL = 'l15_risk_scenario_definition_heads:INSERT_WITH_STATE';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.organisation_id IS DISTINCT FROM OLD.organisation_id OR NEW.scenario_definition_id IS DISTINCT FROM OLD.scenario_definition_id
     OR NEW.scenario_definition_version_id IS DISTINCT FROM OLD.scenario_definition_version_id OR NEW.content_hash IS DISTINCT FROM OLD.content_hash
     OR (OLD.latest_state_id IS NOT NULL AND NEW.latest_state_id IS NULL) THEN
    RAISE EXCEPTION 'L15_HISTORY_IMMUTABLE' USING ERRCODE = '55000', DETAIL = 'l15_risk_scenario_definition_heads:IDENTITY';
  END IF;
  IF NEW.latest_state_id IS DISTINCT FROM OLD.latest_state_id AND NOT EXISTS (
       SELECT 1 FROM gov_repo.l15_risk_scenario_definition_states AS s
       WHERE s.organisation_id = NEW.organisation_id AND s.state_id = NEW.latest_state_id
         AND s.scenario_definition_id = NEW.scenario_definition_id AND s.scenario_definition_version_id = NEW.scenario_definition_version_id AND s.content_hash = NEW.content_hash
         AND s.predecessor_state_id IS NOT DISTINCT FROM OLD.latest_state_id) THEN
    RAISE EXCEPTION 'L15_HISTORY_IMMUTABLE' USING ERRCODE = '55000', DETAIL = 'l15_risk_scenario_definition_heads:LINEAGE';
  END IF;
  RETURN NEW;
END;
$head$;
CREATE TRIGGER l15_risk_scenario_definition_heads_guard BEFORE INSERT OR UPDATE OR DELETE ON gov_repo.l15_risk_scenario_definition_heads
  FOR EACH ROW EXECUTE FUNCTION gov_repo.l15_risk_scenario_definition_head_guard_v1();
CREATE TRIGGER l15_risk_scenario_definition_heads_no_truncate BEFORE TRUNCATE ON gov_repo.l15_risk_scenario_definition_heads
  FOR EACH STATEMENT EXECUTE FUNCTION gov_repo.l15_risk_scenario_definition_head_guard_v1();


-- ---------------------------------------------------------------------------------------------------------------------
-- E. RISK_METHODOLOGY structural guards (raising, ENABLE ALWAYS, owner-only SECURITY INVOKER).
-- ---------------------------------------------------------------------------------------------------------------------
-- The identity is created only right after its root version by the same exact ALLOW / RISK_METHODOLOGY / ADMIT EXPECTED_NONE
-- authorization at the same instant.
CREATE FUNCTION gov_repo.l15_risk_methodology_identity_guard_v1() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $guard$
DECLARE
  v_authz record;
BEGIN
  SELECT a.evaluated_at, a.expectation_kind, a.expected_latest_version_id INTO v_authz
  FROM gov_repo.l14_authorization_decisions AS a
  WHERE a.organisation_id = NEW.organisation_id AND a.authorization_decision_id = NEW.admission_authorization_decision_id
    AND a.result = 'ALLOW' AND a.subject_kind = 'RISK_METHODOLOGY' AND a.requested_action = 'ADMIT';
  IF NOT FOUND OR v_authz.evaluated_at IS DISTINCT FROM NEW.recorded_at
     OR v_authz.expectation_kind IS DISTINCT FROM 'EXPECTED_NONE' OR v_authz.expected_latest_version_id IS NOT NULL THEN
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'RISK_METHODOLOGY_IDENTITY_AUTHORIZATION_MISMATCH';
  END IF;
  PERFORM 1 FROM gov_repo.l15_risk_methodology_versions AS v
  WHERE v.organisation_id = NEW.organisation_id AND v.methodology_id = NEW.methodology_id
    AND v.predecessor_version_id IS NULL AND v.admission_authorization_decision_id = NEW.admission_authorization_decision_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'RISK_METHODOLOGY_IDENTITY_WITHOUT_ROOT_VERSION';
  END IF;
  RETURN NEW;
END;
$guard$;
CREATE TRIGGER l15_risk_methodologies_guard BEFORE INSERT ON gov_repo.l15_risk_methodologies
  FOR EACH ROW EXECUTE FUNCTION gov_repo.l15_risk_methodology_identity_guard_v1();

-- A version mirrors its exact authorization (actor, source, instant, DB content hash as attempted content, the
-- expectation it was decided under = its lineage predecessor). Its content rows and its DB-recomputed stored content hash
-- are verified at commit (l15_registry_commit_guard_v1) because the normalized content rows follow it.
CREATE FUNCTION gov_repo.l15_risk_methodology_version_guard_v1() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $guard$
DECLARE
  v_authz record;
  v_identity_authz uuid;
BEGIN
  SELECT a.actor_user_id, a.source_class, a.evaluated_at, a.attempted_content_hash, a.expectation_kind, a.expected_latest_version_id
  INTO v_authz
  FROM gov_repo.l14_authorization_decisions AS a
  WHERE a.organisation_id = NEW.organisation_id AND a.authorization_decision_id = NEW.admission_authorization_decision_id
    AND a.result = 'ALLOW' AND a.subject_kind = 'RISK_METHODOLOGY' AND a.requested_action = 'ADMIT';
  IF NOT FOUND OR v_authz.actor_user_id IS DISTINCT FROM NEW.admitted_by_actor_user_id
     OR v_authz.source_class IS DISTINCT FROM NEW.source_class OR v_authz.evaluated_at IS DISTINCT FROM NEW.recorded_at
     OR v_authz.attempted_content_hash IS DISTINCT FROM NEW.content_hash::text
     OR v_authz.expectation_kind IS DISTINCT FROM (CASE WHEN NEW.predecessor_version_id IS NULL THEN 'EXPECTED_NONE' ELSE 'EXPECTED_CURRENT' END)
     OR v_authz.expected_latest_version_id IS DISTINCT FROM NEW.predecessor_version_id THEN
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'RISK_METHODOLOGY_VERSION_AUTHORIZATION_MISMATCH';
  END IF;
  SELECT d.admission_authorization_decision_id INTO v_identity_authz
  FROM gov_repo.l15_risk_methodologies AS d
  WHERE d.organisation_id = NEW.organisation_id AND d.methodology_id = NEW.methodology_id;
  IF (NEW.predecessor_version_id IS NULL AND FOUND)
     OR (NEW.predecessor_version_id IS NOT NULL AND (NOT FOUND OR v_identity_authz = NEW.admission_authorization_decision_id)) THEN
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'RISK_METHODOLOGY_VERSION_IDENTITY_MISMATCH';
  END IF;
  RETURN NEW;
END;
$guard$;
CREATE TRIGGER l15_risk_methodology_versions_guard BEFORE INSERT ON gov_repo.l15_risk_methodology_versions
  FOR EACH ROW EXECUTE FUNCTION gov_repo.l15_risk_methodology_version_guard_v1();
CREATE CONSTRAINT TRIGGER l15_risk_methodology_versions_complete AFTER INSERT ON gov_repo.l15_risk_methodology_versions
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION gov_repo.l15_registry_commit_guard_v1();
CREATE TRIGGER l15_risk_methodology_likelihood_levels_guard BEFORE INSERT ON gov_repo.l15_risk_methodology_likelihood_levels
  FOR EACH ROW EXECUTE FUNCTION gov_repo.l15_registry_content_insert_guard_v1();
CREATE TRIGGER l15_risk_methodology_impact_levels_guard BEFORE INSERT ON gov_repo.l15_risk_methodology_impact_levels
  FOR EACH ROW EXECUTE FUNCTION gov_repo.l15_registry_content_insert_guard_v1();
CREATE TRIGGER l15_risk_methodology_rating_cells_guard BEFORE INSERT ON gov_repo.l15_risk_methodology_rating_cells
  FOR EACH ROW EXECUTE FUNCTION gov_repo.l15_registry_content_insert_guard_v1();

-- A proposal's envelope source class is the admission source class of its exact version tuple (no laundering).
CREATE FUNCTION gov_repo.l15_risk_methodology_proposal_guard_v1() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $guard$
DECLARE
  v_envelope_source text;
  v_version_source text;
BEGIN
  SELECT p.source_class INTO v_envelope_source
  FROM gov_repo.l14_proposals AS p
  WHERE p.organisation_id = NEW.organisation_id AND p.proposal_id = NEW.proposal_id AND p.subject_kind = 'RISK_METHODOLOGY';
  SELECT v.source_class INTO v_version_source
  FROM gov_repo.l15_risk_methodology_versions AS v
  WHERE v.organisation_id = NEW.organisation_id AND v.methodology_id = NEW.methodology_id
    AND v.methodology_version_id = NEW.methodology_version_id AND v.content_hash = NEW.content_hash;
  IF v_envelope_source IS NULL OR v_version_source IS NULL OR v_envelope_source IS DISTINCT FROM v_version_source THEN
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'RISK_METHODOLOGY_PROPOSAL_SOURCE_MISMATCH';
  END IF;
  RETURN NEW;
END;
$guard$;
CREATE TRIGGER l15_risk_methodology_proposals_guard BEFORE INSERT ON gov_repo.l15_risk_methodology_proposals
  FOR EACH ROW EXECUTE FUNCTION gov_repo.l15_risk_methodology_proposal_guard_v1();
CREATE CONSTRAINT TRIGGER l15_risk_methodology_proposals_support_complete AFTER INSERT ON gov_repo.l15_risk_methodology_proposals
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION gov_repo.l15_registry_commit_guard_v1();

-- A state mirrors its exact decision / authorization / proposal / version, is recorded at the decision instant, takes its
-- effective_from from the proposal (NULL request = the decision instant), and respects the M16 S1B.1R1 interval rules.
CREATE FUNCTION gov_repo.l15_risk_methodology_state_guard_v1() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $guard$
DECLARE
  v_decision record;
  v_proposal record;
  v_version_source text;
  v_related record;
BEGIN
  SELECT d.proposal_id, d.decided_at, d.support_status, d.actor_user_id INTO v_decision
  FROM gov_repo.l14_governance_decisions AS d
  WHERE d.organisation_id = NEW.organisation_id AND d.governance_decision_id = NEW.governance_decision_id
    AND d.subject_kind = 'RISK_METHODOLOGY';
  SELECT p.source_class, t.requested_effective_from, t.target_state_id INTO v_proposal
  FROM gov_repo.l14_proposals AS p
  JOIN gov_repo.l15_risk_methodology_proposals AS t ON t.organisation_id = p.organisation_id AND t.proposal_id = p.proposal_id
  WHERE p.organisation_id = NEW.organisation_id AND p.proposal_id = NEW.proposal_id;
  SELECT v.source_class INTO v_version_source
  FROM gov_repo.l15_risk_methodology_versions AS v
  WHERE v.organisation_id = NEW.organisation_id AND v.methodology_id = NEW.methodology_id AND v.methodology_version_id = NEW.methodology_version_id
    AND v.content_hash = NEW.content_hash;
  IF v_decision.proposal_id IS DISTINCT FROM NEW.proposal_id OR v_decision.decided_at IS DISTINCT FROM NEW.recorded_at
     OR v_decision.support_status IS DISTINCT FROM NEW.support_status
     OR v_proposal.source_class IS DISTINCT FROM NEW.source_class OR v_version_source IS DISTINCT FROM NEW.source_class
     OR v_proposal.target_state_id IS DISTINCT FROM NEW.revokes_state_id
     OR NEW.effective_from IS DISTINCT FROM COALESCE(v_proposal.requested_effective_from, NEW.recorded_at) THEN
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'RISK_METHODOLOGY_STATE_ENVELOPE_MISMATCH';
  END IF;
  IF NEW.predecessor_state_id IS NOT NULL THEN
    SELECT s.effective_from INTO v_related FROM gov_repo.l15_risk_methodology_states AS s
    WHERE s.organisation_id = NEW.organisation_id AND s.state_id = NEW.predecessor_state_id;
    IF NEW.state_kind = 'REVOKED' AND NEW.effective_from < v_related.effective_from THEN
      RAISE EXCEPTION 'L15_CONTINUITY_VIOLATION' USING ERRCODE = 'GV011', DETAIL = 'REVOKE_BEFORE_TARGET_EFFECTIVE';
    END IF;
    IF NEW.state_kind = 'VALIDATED' AND NOT (NEW.effective_from >= v_related.effective_from) THEN
      RAISE EXCEPTION 'L15_CONTINUITY_VIOLATION' USING ERRCODE = 'GV011', DETAIL = 'REVALIDATION_OVERLAPS_PRIOR_INTERVAL';
    END IF;
  END IF;
  RETURN NEW;
END;
$guard$;
CREATE TRIGGER l15_risk_methodology_states_guard BEFORE INSERT ON gov_repo.l15_risk_methodology_states
  FOR EACH ROW EXECUTE FUNCTION gov_repo.l15_risk_methodology_state_guard_v1();
CREATE CONSTRAINT TRIGGER l15_risk_methodology_states_support_complete AFTER INSERT ON gov_repo.l15_risk_methodology_states
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION gov_repo.l15_registry_commit_guard_v1();

-- The head is the only mutable RISK_METHODOLOGY table: created empty, identity fixed, never deleted / truncated, only ever advanced
-- to the direct lineage successor of its current state.
CREATE FUNCTION gov_repo.l15_risk_methodology_head_guard_v1() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $head$
BEGIN
  IF TG_OP IN ('DELETE','TRUNCATE') THEN
    RAISE EXCEPTION 'L15_HISTORY_IMMUTABLE' USING ERRCODE = '55000', DETAIL = 'l15_risk_methodology_heads:' || TG_OP;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.latest_state_id IS NOT NULL THEN
      RAISE EXCEPTION 'L15_HISTORY_IMMUTABLE' USING ERRCODE = '55000', DETAIL = 'l15_risk_methodology_heads:INSERT_WITH_STATE';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.organisation_id IS DISTINCT FROM OLD.organisation_id OR NEW.methodology_id IS DISTINCT FROM OLD.methodology_id
     OR NEW.methodology_version_id IS DISTINCT FROM OLD.methodology_version_id OR NEW.content_hash IS DISTINCT FROM OLD.content_hash
     OR (OLD.latest_state_id IS NOT NULL AND NEW.latest_state_id IS NULL) THEN
    RAISE EXCEPTION 'L15_HISTORY_IMMUTABLE' USING ERRCODE = '55000', DETAIL = 'l15_risk_methodology_heads:IDENTITY';
  END IF;
  IF NEW.latest_state_id IS DISTINCT FROM OLD.latest_state_id AND NOT EXISTS (
       SELECT 1 FROM gov_repo.l15_risk_methodology_states AS s
       WHERE s.organisation_id = NEW.organisation_id AND s.state_id = NEW.latest_state_id
         AND s.methodology_id = NEW.methodology_id AND s.methodology_version_id = NEW.methodology_version_id AND s.content_hash = NEW.content_hash
         AND s.predecessor_state_id IS NOT DISTINCT FROM OLD.latest_state_id) THEN
    RAISE EXCEPTION 'L15_HISTORY_IMMUTABLE' USING ERRCODE = '55000', DETAIL = 'l15_risk_methodology_heads:LINEAGE';
  END IF;
  RETURN NEW;
END;
$head$;
CREATE TRIGGER l15_risk_methodology_heads_guard BEFORE INSERT OR UPDATE OR DELETE ON gov_repo.l15_risk_methodology_heads
  FOR EACH ROW EXECUTE FUNCTION gov_repo.l15_risk_methodology_head_guard_v1();
CREATE TRIGGER l15_risk_methodology_heads_no_truncate BEFORE TRUNCATE ON gov_repo.l15_risk_methodology_heads
  FOR EACH STATEMENT EXECUTE FUNCTION gov_repo.l15_risk_methodology_head_guard_v1();


-- ---------------------------------------------------------------------------------------------------------------------
-- F. RISK_SCENARIO_DEFINITION owner-only helpers: durable result projection and the exact bitemporal resolver.
-- ---------------------------------------------------------------------------------------------------------------------
-- The ORIGINAL durable result, exactly as stored (replay never recomputes it).
CREATE FUNCTION gov_repo.l15_risk_scenario_definition_command_result_v1(p_organisation_id uuid, p_command_id text, p_replay boolean)
RETURNS TABLE (
  replay boolean, command_id text, command_kind text, subject_kind text, outcome text, command_fingerprint text,
  authorization_decision_id uuid, authorization_result text, deny_reason text, attempted_content_hash text,
  expectation_kind text, expected_latest_version_id uuid, expected_current_state_id uuid, proposal_id uuid,
  governance_decision_id uuid, scenario_definition_id uuid, scenario_definition_version_id uuid, predecessor_version_id uuid, content_hash text,
  state_id uuid, state_kind text, effective_from timestamptz, recorded_at timestamptz
)
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT p_replay, c.command_id, c.command_kind, c.subject_kind, c.outcome, c.command_fingerprint,
         c.authorization_decision_id, a.result, a.deny_reason, a.attempted_content_hash,
         a.expectation_kind, a.expected_latest_version_id, a.expected_current_state_id, c.proposal_id, c.governance_decision_id,
         COALESCE(v.scenario_definition_id, t.scenario_definition_id), COALESCE(v.scenario_definition_version_id, t.scenario_definition_version_id), v.predecessor_version_id,
         COALESCE(v.content_hash, t.content_hash)::text, c.l15_state_id, s.state_kind, s.effective_from, c.recorded_at
  FROM gov_repo.l14_command_results AS c
  LEFT JOIN gov_repo.l14_authorization_decisions AS a
    ON a.organisation_id = c.organisation_id AND a.authorization_decision_id = c.authorization_decision_id
  LEFT JOIN gov_repo.l15_risk_scenario_definition_versions AS v
    ON c.command_kind = 'ADMIT_RISK_SCENARIO_DEFINITION_VERSION' AND v.organisation_id = c.organisation_id
   AND v.admission_authorization_decision_id = c.authorization_decision_id
  LEFT JOIN gov_repo.l15_risk_scenario_definition_proposals AS t
    ON t.organisation_id = c.organisation_id AND t.proposal_id = c.proposal_id
  LEFT JOIN gov_repo.l15_risk_scenario_definition_states AS s
    ON s.organisation_id = c.organisation_id AND s.state_id = c.l15_state_id
  WHERE c.organisation_id = p_organisation_id AND c.command_id = p_command_id AND c.subject_kind = 'RISK_SCENARIO_DEFINITION'
    AND c.command_kind IN ('ADMIT_RISK_SCENARIO_DEFINITION_VERSION','SUBMIT_PROPOSAL','DECIDE_PROPOSAL')
$$;

-- Dependency contract S3/S4 pin: the exact VALIDATED state of the exact admitted (organisation, identity, version, DB
-- content hash) tuple valid at business instant p_effective_at as known at system cutoff p_recorded_cutoff
-- (recorded_at <= cutoff, effective_from <= instant, no visible REVOKED tombstone targeting it exactly with
-- effective_from <= instant). No row otherwise; ambiguity fails closed. Never the latest version, another version, a
-- code / label / domain match or a similar scenario.
CREATE FUNCTION gov_repo.l15_risk_scenario_definition_valid_state_v1(
  p_organisation_id uuid, p_scenario_definition_id uuid, p_scenario_definition_version_id uuid, p_content_hash text,
  p_effective_at timestamptz, p_recorded_cutoff timestamptz)
RETURNS TABLE (state_id uuid, effective_from timestamptz, recorded_at timestamptz)
LANGUAGE sql STABLE STRICT SET search_path = pg_catalog, pg_temp AS $$
  WITH visible AS (
    SELECT s.state_id, s.state_kind, s.revokes_state_id, s.effective_from, s.recorded_at
    FROM gov_repo.l15_risk_scenario_definition_states AS s
    JOIN gov_repo.l15_risk_scenario_definition_versions AS v
      ON v.organisation_id = s.organisation_id AND v.scenario_definition_id = s.scenario_definition_id AND v.scenario_definition_version_id = s.scenario_definition_version_id
     AND v.content_hash = s.content_hash
    WHERE s.organisation_id = p_organisation_id AND s.scenario_definition_id = p_scenario_definition_id AND s.scenario_definition_version_id = p_scenario_definition_version_id
      AND s.content_hash::text = p_content_hash AND s.recorded_at <= p_recorded_cutoff
  ), candidates AS (
    SELECT c.state_id, c.effective_from, c.recorded_at FROM visible AS c
    WHERE c.state_kind = 'VALIDATED' AND c.effective_from <= p_effective_at
      AND NOT EXISTS (SELECT 1 FROM visible AS r
                      WHERE r.state_kind = 'REVOKED' AND r.revokes_state_id = c.state_id AND r.effective_from <= p_effective_at)
  )
  SELECT c.state_id, c.effective_from, c.recorded_at FROM candidates AS c
  WHERE (SELECT pg_catalog.count(*) FROM candidates) = 1
$$;


-- ---------------------------------------------------------------------------------------------------------------------
-- F. RISK_METHODOLOGY owner-only helpers: durable result projection and the exact bitemporal resolver.
-- ---------------------------------------------------------------------------------------------------------------------
-- The ORIGINAL durable result, exactly as stored (replay never recomputes it).
CREATE FUNCTION gov_repo.l15_risk_methodology_command_result_v1(p_organisation_id uuid, p_command_id text, p_replay boolean)
RETURNS TABLE (
  replay boolean, command_id text, command_kind text, subject_kind text, outcome text, command_fingerprint text,
  authorization_decision_id uuid, authorization_result text, deny_reason text, attempted_content_hash text,
  expectation_kind text, expected_latest_version_id uuid, expected_current_state_id uuid, proposal_id uuid,
  governance_decision_id uuid, methodology_id uuid, methodology_version_id uuid, predecessor_version_id uuid, content_hash text,
  state_id uuid, state_kind text, effective_from timestamptz, recorded_at timestamptz
)
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT p_replay, c.command_id, c.command_kind, c.subject_kind, c.outcome, c.command_fingerprint,
         c.authorization_decision_id, a.result, a.deny_reason, a.attempted_content_hash,
         a.expectation_kind, a.expected_latest_version_id, a.expected_current_state_id, c.proposal_id, c.governance_decision_id,
         COALESCE(v.methodology_id, t.methodology_id), COALESCE(v.methodology_version_id, t.methodology_version_id), v.predecessor_version_id,
         COALESCE(v.content_hash, t.content_hash)::text, c.l15_state_id, s.state_kind, s.effective_from, c.recorded_at
  FROM gov_repo.l14_command_results AS c
  LEFT JOIN gov_repo.l14_authorization_decisions AS a
    ON a.organisation_id = c.organisation_id AND a.authorization_decision_id = c.authorization_decision_id
  LEFT JOIN gov_repo.l15_risk_methodology_versions AS v
    ON c.command_kind = 'ADMIT_RISK_METHODOLOGY_VERSION' AND v.organisation_id = c.organisation_id
   AND v.admission_authorization_decision_id = c.authorization_decision_id
  LEFT JOIN gov_repo.l15_risk_methodology_proposals AS t
    ON t.organisation_id = c.organisation_id AND t.proposal_id = c.proposal_id
  LEFT JOIN gov_repo.l15_risk_methodology_states AS s
    ON s.organisation_id = c.organisation_id AND s.state_id = c.l15_state_id
  WHERE c.organisation_id = p_organisation_id AND c.command_id = p_command_id AND c.subject_kind = 'RISK_METHODOLOGY'
    AND c.command_kind IN ('ADMIT_RISK_METHODOLOGY_VERSION','SUBMIT_PROPOSAL','DECIDE_PROPOSAL')
$$;

-- Dependency contract S3/S4 pin: the exact VALIDATED state of the exact admitted (organisation, identity, version, DB
-- content hash) tuple valid at business instant p_effective_at as known at system cutoff p_recorded_cutoff
-- (recorded_at <= cutoff, effective_from <= instant, no visible REVOKED tombstone targeting it exactly with
-- effective_from <= instant). No row otherwise; ambiguity fails closed. Never the latest version, another version, a
-- code / label / domain match or a similar scenario.
CREATE FUNCTION gov_repo.l15_risk_methodology_valid_state_v1(
  p_organisation_id uuid, p_methodology_id uuid, p_methodology_version_id uuid, p_content_hash text,
  p_effective_at timestamptz, p_recorded_cutoff timestamptz)
RETURNS TABLE (state_id uuid, effective_from timestamptz, recorded_at timestamptz)
LANGUAGE sql STABLE STRICT SET search_path = pg_catalog, pg_temp AS $$
  WITH visible AS (
    SELECT s.state_id, s.state_kind, s.revokes_state_id, s.effective_from, s.recorded_at
    FROM gov_repo.l15_risk_methodology_states AS s
    JOIN gov_repo.l15_risk_methodology_versions AS v
      ON v.organisation_id = s.organisation_id AND v.methodology_id = s.methodology_id AND v.methodology_version_id = s.methodology_version_id
     AND v.content_hash = s.content_hash
    WHERE s.organisation_id = p_organisation_id AND s.methodology_id = p_methodology_id AND s.methodology_version_id = p_methodology_version_id
      AND s.content_hash::text = p_content_hash AND s.recorded_at <= p_recorded_cutoff
  ), candidates AS (
    SELECT c.state_id, c.effective_from, c.recorded_at FROM visible AS c
    WHERE c.state_kind = 'VALIDATED' AND c.effective_from <= p_effective_at
      AND NOT EXISTS (SELECT 1 FROM visible AS r
                      WHERE r.state_kind = 'REVOKED' AND r.revokes_state_id = c.state_id AND r.effective_from <= p_effective_at)
  )
  SELECT c.state_id, c.effective_from, c.recorded_at FROM candidates AS c
  WHERE (SELECT pg_catalog.count(*) FROM candidates) = 1
$$;


-- ---------------------------------------------------------------------------------------------------------------------
-- G. RISK_SCENARIO_DEFINITION RPCs (SECURITY DEFINER; necessity: the L15 stores and the shared envelope have no application privilege at
--    all, so a bounded definer is the only write path). Owner postgres, search_path pinned, fully qualified, EXECUTE =
--    service_role only; tenant + actor + CURRENT locked roles re-derived in-RPC from the verified principal
--    (l14_session_basis_v1); service_role is transport, never authority. Replay-first order:
--    base session -> syntactic shape -> DB content hash -> syntactic support -> DB fingerprint -> AP guard SHARED ->
--    L15 subject guard(s) -> command guard -> replay arbitration -> tenant / reference / support resolution -> CURRENT
--    effective Authority Policy -> exact mapped L15 permission -> mutation -> final base-eligibility recheck.
-- ---------------------------------------------------------------------------------------------------------------------
-- G1. ADMIT an immutable scenario definition version (explicit expected-latest-version concurrency). EXPECTED_NONE creates the stable
--     identity with its root version; EXPECTED_CURRENT appends the successor of the exact latest admitted version.
--     PostgreSQL computes the content hash. No proposal, no decision, no state, no validation, no head.
CREATE FUNCTION gov_repo.l15_admit_scenario_version_v1(
  p_verified_organisation_id uuid,
  p_verified_actor_user_id uuid,
  p_verified_session_iat bigint,
  p_verified_session_exp bigint,
  p_verified_credential_epoch timestamptz,
  p_command_id text,
  p_scenario_definition_id uuid,                -- stable identity (opaque, caller-supplied, tenant-scoped)
  p_scenario_definition_version_id uuid,        -- the new immutable version (opaque, caller-supplied, never reused)
  p_expectation_kind text,                 -- EXPECTED_NONE (first version) | EXPECTED_CURRENT (successor)
  p_expected_latest_version_id uuid,       -- NULL iff EXPECTED_NONE; else the exact latest admitted version
  p_risk_domain text,                      -- exactly one of the nine frozen domains
  p_subject_kinds text[],                  -- non-empty closed legal subject-kind set (order irrelevant)
  p_reference_namespaces text[],           -- typed reference codes (parallel arrays; order irrelevant)
  p_reference_codes text[],
  p_content_hash text,                     -- assertion only; PostgreSQL recomputes
  p_source_class text,                     -- LOCAL_HUMAN | SYSTEM_SEED (seed provenance, human-mediated); never authority
  p_caller_fingerprint text                -- assertion only; PostgreSQL recomputes
)
RETURNS TABLE (
  replay boolean, command_id text, command_kind text, subject_kind text, outcome text, command_fingerprint text,
  authorization_decision_id uuid, authorization_result text, deny_reason text, attempted_content_hash text,
  expectation_kind text, expected_latest_version_id uuid, expected_current_state_id uuid, proposal_id uuid,
  governance_decision_id uuid, scenario_definition_id uuid, scenario_definition_version_id uuid, predecessor_version_id uuid, content_hash text,
  state_id uuid, state_kind text, effective_from timestamptz, recorded_at timestamptz
)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp SET lock_timeout = '5s'
AS $admit$
#variable_conflict use_column
DECLARE
  v_org uuid := p_verified_organisation_id;
  v_actor uuid := p_verified_actor_user_id;
  v_role_ids uuid[];
  v_content_hash text;
  v_fingerprint text;
  v_latest uuid;
  v_has_basis boolean := false;
  v_basis_policy uuid;
  v_basis_version uuid;
  v_basis_hash text;
  v_deny text;
  v_ordinals integer[];
  v_now timestamptz;
  v_authz uuid := pg_catalog.gen_random_uuid();
BEGIN
  -- 1. Base session eligibility (verified ACTIVE human of the ACTIVE organisation; locks ORG -> USER -> ROLES).
  SELECT b.role_ids INTO v_role_ids
  FROM gov_repo.l14_session_basis_v1(v_org, v_actor, p_verified_session_iat, p_verified_session_exp,
    p_verified_credential_epoch) AS b;

  -- 2. Syntactic shape (no table read).
  PERFORM gov_repo.l14_validate_command_id_v1(p_command_id, p_caller_fingerprint);
  IF p_scenario_definition_id IS NULL OR p_scenario_definition_version_id IS NULL OR p_scenario_definition_version_id = p_scenario_definition_id THEN
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'RISK_SCENARIO_DEFINITION_IDS_REQUIRED';
  END IF;
  IF p_expectation_kind IS NULL OR p_expectation_kind NOT IN ('EXPECTED_NONE','EXPECTED_CURRENT')
     OR (p_expectation_kind = 'EXPECTED_NONE') <> (p_expected_latest_version_id IS NULL)
     OR p_expected_latest_version_id = p_scenario_definition_version_id THEN
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'EXPECTATION_MALFORMED';
  END IF;
  PERFORM gov_repo.l15_risk_scenario_content_check_v1(p_risk_domain, p_subject_kinds, p_reference_namespaces, p_reference_codes);
  IF p_content_hash IS NULL OR p_content_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'CONTENT_HASH_MALFORMED';
  END IF;
  IF p_source_class IS NULL OR p_source_class NOT IN ('SYSTEM_SEED','LOCAL_HUMAN','SOURCE_CONNECTION') THEN
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'SOURCE_CLASS_UNKNOWN';
  END IF;
  IF p_source_class = 'SOURCE_CONNECTION' THEN
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'SOURCE_CLASS_NOT_EXECUTABLE';
  END IF;

  -- 3. The DB-authoritative canonical content hash. A caller hash is an assertion only.
  v_content_hash := gov_repo.l15_risk_scenario_content_hash_v1(p_risk_domain, p_subject_kinds, p_reference_namespaces, p_reference_codes);
  IF v_content_hash IS DISTINCT FROM p_content_hash THEN
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'CONTENT_HASH_MISMATCH';
  END IF;

  -- 4. PostgreSQL-authoritative fingerprint over the exact ids, DB hash, source and expectation.
  v_fingerprint := gov_repo.l14_sha256_frame_v1(
    ARRAY['L15_COMMAND_FINGERPRINT_V1', 'ADMIT_RISK_SCENARIO_DEFINITION_VERSION', v_org::text, v_actor::text, 'ADMIT', 'RISK_SCENARIO_DEFINITION',
          p_scenario_definition_id::text, p_scenario_definition_version_id::text, v_content_hash, p_source_class]
    || CASE WHEN p_expected_latest_version_id IS NULL THEN ARRAY['EXPECTED_NONE']
            ELSE ARRAY['EXPECTED_CURRENT', p_expected_latest_version_id::text] END);
  IF v_fingerprint IS DISTINCT FROM p_caller_fingerprint THEN
    RAISE EXCEPTION 'L14_FINGERPRINT_MISMATCH' USING ERRCODE = 'GV008', DETAIL = 'CALLER_FINGERPRINT_DIFFERS';
  END IF;

  -- 5-7. AP SHARED, identity guard (serializes first / successor admission of one identity), version-id guard
  --      (serializes reuse of one version id across identities), command guard; replay BEFORE any evaluation.
  PERFORM gov_repo.l14_lock_authority_policy_guard_shared_v1(v_org);
  PERFORM gov_repo.l15_lock_registry_subject_guard_v1(v_org, 'RISK_SCENARIO_DEFINITION', 'IDENTITY:' || p_scenario_definition_id::text);
  PERFORM gov_repo.l15_lock_registry_subject_guard_v1(v_org, 'RISK_SCENARIO_DEFINITION', 'VERSION:' || p_scenario_definition_version_id::text);
  PERFORM gov_repo.l14_lock_command_guard_v1(v_org, p_command_id);
  IF gov_repo.l14_replay_arbitrate_v1(v_org, p_command_id, v_fingerprint) THEN
    PERFORM 1 FROM gov_repo.l14_session_basis_v1(v_org, v_actor, p_verified_session_iat,
      p_verified_session_exp, p_verified_credential_epoch);
    RETURN QUERY SELECT * FROM gov_repo.l15_risk_scenario_definition_command_result_v1(v_org, p_command_id, true);
    RETURN;
  END IF;

  -- 8. Tenant / reference resolution under both guards: the version id is unused in THIS organisation; the exact
  --    expected latest admitted version of THIS organisation's identity holds (a foreign identity reads as unknown).
  PERFORM 1 FROM gov_repo.l15_risk_scenario_definition_versions AS v WHERE v.organisation_id = v_org AND v.scenario_definition_version_id = p_scenario_definition_version_id;
  IF FOUND THEN
    RAISE EXCEPTION 'L15_STALE_EXPECTATION' USING ERRCODE = 'GV009', DETAIL = 'RISK_SCENARIO_DEFINITION_VERSION_ID_EXISTS';
  END IF;
  SELECT v.scenario_definition_version_id INTO v_latest
  FROM gov_repo.l15_risk_scenario_definition_versions AS v
  WHERE v.organisation_id = v_org AND v.scenario_definition_id = p_scenario_definition_id
    AND NOT EXISTS (SELECT 1 FROM gov_repo.l15_risk_scenario_definition_versions AS n
                    WHERE n.organisation_id = v.organisation_id AND n.scenario_definition_id = v.scenario_definition_id
                      AND n.predecessor_version_id = v.scenario_definition_version_id);
  IF p_expected_latest_version_id IS NULL AND v_latest IS NOT NULL THEN
    RAISE EXCEPTION 'L15_STALE_EXPECTATION' USING ERRCODE = 'GV009', DETAIL = 'RISK_SCENARIO_DEFINITION_EXISTS';
  END IF;
  IF p_expected_latest_version_id IS DISTINCT FROM v_latest THEN
    RAISE EXCEPTION 'L15_STALE_EXPECTATION' USING ERRCODE = 'GV009', DETAIL = 'RISK_SCENARIO_DEFINITION_VERSION_EXPECTATION_MISMATCH';
  END IF;

  -- 9-10. The CURRENT effective Authority Policy (exact recomputed hash) is the ONLY basis; the exact mapped L15
  --       permission. Never L14_*, service_role, source class, seed origin, scanner, CG-AG, confidence or LLM.
  v_now := pg_catalog.clock_timestamp();
  SELECT b.authority_policy_id, b.version_id, b.content_hash INTO v_basis_policy, v_basis_version, v_basis_hash
  FROM gov_repo.l14_effective_authority_basis_v1(v_org, v_now) AS b;
  v_has_basis := FOUND;
  IF NOT v_has_basis THEN
    v_deny := 'NO_EFFECTIVE_AUTHORITY';
  ELSE
    SELECT e.deny_reason, e.rule_ordinals INTO v_deny, v_ordinals
    FROM gov_repo.l14_evaluate_authority_rules_v1(v_org, v_basis_policy, v_basis_version, v_role_ids,
      gov_repo.l15_governance_permission_v1('RISK_SCENARIO_DEFINITION', 'ADMIT'), 'ADMIT', false, 'IMMEDIATE') AS e;
  END IF;

  INSERT INTO gov_repo.l14_authorization_decisions (
    organisation_id, authorization_decision_id, command_id, command_fingerprint, actor_user_id,
    requested_action, subject_kind, scope_tag, source_class, proposal_id, is_self_validation,
    authority_basis, basis_authority_policy_id, basis_version_id, basis_content_hash, result, deny_reason,
    evaluated_at, attempted_content_hash, expectation_kind, expected_latest_version_id)
  VALUES (
    v_org, v_authz, p_command_id, v_fingerprint, v_actor,
    'ADMIT', 'RISK_SCENARIO_DEFINITION', 'ALL_ALLOWED_TARGETS', p_source_class, NULL, NULL,
    CASE WHEN v_has_basis THEN 'AUTHORITY_POLICY_VERSION' END,
    CASE WHEN v_has_basis THEN v_basis_policy END,
    CASE WHEN v_has_basis THEN v_basis_version END,
    CASE WHEN v_has_basis THEN v_basis_hash END,
    CASE WHEN v_deny IS NULL THEN 'ALLOW' ELSE 'DENY' END, v_deny, v_now,
    v_content_hash, p_expectation_kind, p_expected_latest_version_id);
  PERFORM gov_repo.l14_snapshot_roles_v1(v_org, v_authz, v_role_ids);
  IF v_has_basis THEN
    PERFORM gov_repo.l14_snapshot_policy_rules_v1(v_org, v_authz, v_basis_policy, v_basis_version, v_ordinals);
  END IF;
  IF v_deny IS NULL THEN
    -- The M17-S0 L15 ALLOW guard (deferred, SECURITY INVOKER) must evaluate HERE, as this owner-pinned definer, now that the
    -- rule snapshot exists: at COMMIT it would run as the committing role (service_role), which has no privilege on the
    -- envelope by design. Firing it immediately keeps its full check (effective-policy L15 rule of the exact mapped
    -- permission + action, AUTHORITY_POLICY_VERSION basis, ACTIVE human of the ACTIVE organisation); then restore DEFERRED.
    SET CONSTRAINTS gov_repo.l15_authorization_decisions_allow_guard IMMEDIATE;
    SET CONSTRAINTS gov_repo.l15_authorization_decisions_allow_guard DEFERRED;
  END IF;

  IF v_deny IS NOT NULL THEN
    -- 11 (DENY). Durable authorization + result only: no identity, no version, no content.
    INSERT INTO gov_repo.l14_command_results (organisation_id, command_id, command_kind, subject_kind,
      command_fingerprint, actor_user_id, outcome, authorization_decision_id, recorded_at)
    VALUES (v_org, p_command_id, 'ADMIT_RISK_SCENARIO_DEFINITION_VERSION', 'RISK_SCENARIO_DEFINITION', v_fingerprint, v_actor, 'DENIED', v_authz, v_now);
  ELSE
    -- 11 (ALLOW). Root / successor version + its normalized content rows; the identity right after a root version.
    INSERT INTO gov_repo.l15_risk_scenario_definition_versions (organisation_id, scenario_definition_id, scenario_definition_version_id, risk_domain, content_hash,
      predecessor_version_id, admission_authorization_decision_id, source_class, admitted_by_actor_user_id, recorded_at)
    VALUES (v_org, p_scenario_definition_id, p_scenario_definition_version_id, p_risk_domain, v_content_hash, v_latest, v_authz, p_source_class,
      v_actor, v_now);
    INSERT INTO gov_repo.l15_risk_scenario_definition_subject_kinds (organisation_id, scenario_definition_version_id, risk_domain, subject_kind)
    SELECT v_org, p_scenario_definition_version_id, p_risk_domain, s.v FROM pg_catalog.unnest(p_subject_kinds) AS s(v);
    INSERT INTO gov_repo.l15_risk_scenario_definition_references (organisation_id, scenario_definition_version_id, reference_namespace, reference_code)
    SELECT v_org, p_scenario_definition_version_id, r.ns, r.code
    FROM ROWS FROM (pg_catalog.unnest(p_reference_namespaces), pg_catalog.unnest(p_reference_codes)) AS r(ns, code);
    IF v_latest IS NULL THEN
      INSERT INTO gov_repo.l15_risk_scenario_definitions (organisation_id, scenario_definition_id, admission_authorization_decision_id, recorded_at)
      VALUES (v_org, p_scenario_definition_id, v_authz, v_now);
    END IF;
    INSERT INTO gov_repo.l14_command_results (organisation_id, command_id, command_kind, subject_kind,
      command_fingerprint, actor_user_id, outcome, authorization_decision_id, recorded_at)
    VALUES (v_org, p_command_id, 'ADMIT_RISK_SCENARIO_DEFINITION_VERSION', 'RISK_SCENARIO_DEFINITION', v_fingerprint, v_actor, 'ADMITTED', v_authz, v_now);
  END IF;

  -- 12. Base session eligibility must still hold at commitment (same-transaction final recheck).
  PERFORM 1 FROM gov_repo.l14_session_basis_v1(v_org, v_actor, p_verified_session_iat,
    p_verified_session_exp, p_verified_credential_epoch);
  RETURN QUERY SELECT * FROM gov_repo.l15_risk_scenario_definition_command_result_v1(v_org, p_command_id, false);
END;
$admit$;

-- G2. Proposal submission over the exact admitted version tuple by any verified ACTIVE same-tenant member. Grants no
--     authority; writes no decision / state / head. SYSTEM_SEED proposals are explicitly marked, human-mediated, must
--     equal the version's admission source class, and must carry PRESENT DISCOVERY_EVIDENCE / SOURCE_ASSERTION support.
CREATE FUNCTION gov_repo.l15_submit_scenario_proposal_v1(
  p_verified_organisation_id uuid,
  p_verified_actor_user_id uuid,
  p_verified_session_iat bigint,
  p_verified_session_exp bigint,
  p_verified_credential_epoch timestamptz,
  p_command_id text,
  p_intent text,                            -- VALIDATE | REVOKE
  p_source_class text,                      -- must equal the exact version's admission source class
  p_scenario_definition_id uuid,
  p_scenario_definition_version_id uuid,
  p_content_hash text,
  p_requested_effective_from timestamptz,   -- NULL = IMMEDIATE intent
  p_target_state_id uuid,                   -- REVOKE only: the exact current VALIDATED state of the same tuple
  p_prior_proposal_id uuid,                 -- correction link (same tuple)
  p_support_status text,
  p_support_tags text[],
  p_support_target_ids text[],
  p_caller_fingerprint text                 -- assertion only; PostgreSQL recomputes
)
RETURNS TABLE (
  replay boolean, command_id text, command_kind text, subject_kind text, outcome text, command_fingerprint text,
  authorization_decision_id uuid, authorization_result text, deny_reason text, attempted_content_hash text,
  expectation_kind text, expected_latest_version_id uuid, expected_current_state_id uuid, proposal_id uuid,
  governance_decision_id uuid, scenario_definition_id uuid, scenario_definition_version_id uuid, predecessor_version_id uuid, content_hash text,
  state_id uuid, state_kind text, effective_from timestamptz, recorded_at timestamptz
)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp SET lock_timeout = '5s'
AS $submit$
#variable_conflict use_column
DECLARE
  v_org uuid := p_verified_organisation_id;
  v_actor uuid := p_verified_actor_user_id;
  v_support text[];
  v_fingerprint text;
  v_version_source text;
  v_target record;
  v_latest uuid;
  v_proposal uuid := pg_catalog.gen_random_uuid();
  v_now timestamptz;
BEGIN
  PERFORM 1 FROM gov_repo.l14_session_basis_v1(v_org, v_actor, p_verified_session_iat,
    p_verified_session_exp, p_verified_credential_epoch);

  PERFORM gov_repo.l14_validate_command_id_v1(p_command_id, p_caller_fingerprint);
  IF p_intent IS NULL OR p_intent NOT IN ('VALIDATE','REVOKE')
     OR p_source_class IS NULL OR p_source_class NOT IN ('SYSTEM_SEED','LOCAL_HUMAN','SOURCE_CONNECTION') THEN
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'PROPOSAL_VOCABULARY_UNKNOWN';
  END IF;
  IF p_source_class = 'SOURCE_CONNECTION' THEN
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'SOURCE_CLASS_NOT_EXECUTABLE';
  END IF;
  IF p_scenario_definition_id IS NULL OR p_scenario_definition_version_id IS NULL THEN
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'RISK_SCENARIO_DEFINITION_IDS_REQUIRED';
  END IF;
  IF p_content_hash IS NULL OR p_content_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'CONTENT_HASH_MALFORMED';
  END IF;
  IF p_intent = 'VALIDATE' AND p_target_state_id IS NOT NULL THEN
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'TARGET_STATE_NOT_PERMITTED';
  END IF;
  IF p_intent = 'REVOKE' AND p_target_state_id IS NULL THEN
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'TARGET_STATE_REQUIRED';
  END IF;

  v_support := gov_repo.l15_registry_support_parts_v1(p_support_status, p_support_tags, p_support_target_ids);
  IF p_source_class = 'SYSTEM_SEED' AND p_support_status <> 'PRESENT' THEN
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'SYSTEM_SEED_SUPPORT_REQUIRED';
  END IF;
  v_fingerprint := gov_repo.l14_sha256_frame_v1(
    ARRAY['L15_COMMAND_FINGERPRINT_V1', 'SUBMIT_PROPOSAL', v_org::text, v_actor::text, 'RISK_SCENARIO_DEFINITION', p_intent,
          p_source_class, p_scenario_definition_id::text, p_scenario_definition_version_id::text, p_content_hash]
    || CASE WHEN p_requested_effective_from IS NULL THEN ARRAY['IMMEDIATE']
            ELSE ARRAY['EXPLICIT', gov_repo.l14_canonical_instant_v1(p_requested_effective_from)] END
    || CASE WHEN p_target_state_id IS NULL THEN ARRAY['NO_TARGET_STATE'] ELSE ARRAY['TARGET_STATE', p_target_state_id::text] END
    || CASE WHEN p_prior_proposal_id IS NULL THEN ARRAY['NO_PRIOR_PROPOSAL'] ELSE ARRAY['PRIOR_PROPOSAL', p_prior_proposal_id::text] END
    || v_support);
  IF v_fingerprint IS DISTINCT FROM p_caller_fingerprint THEN
    RAISE EXCEPTION 'L14_FINGERPRINT_MISMATCH' USING ERRCODE = 'GV008', DETAIL = 'CALLER_FINGERPRINT_DIFFERS';
  END IF;

  PERFORM gov_repo.l14_lock_authority_policy_guard_shared_v1(v_org);
  PERFORM gov_repo.l15_lock_registry_subject_guard_v1(v_org, 'RISK_SCENARIO_DEFINITION',
    'VALIDATION:' || p_scenario_definition_id::text || ':' || p_scenario_definition_version_id::text || ':' || p_content_hash);
  PERFORM gov_repo.l14_lock_command_guard_v1(v_org, p_command_id);
  IF gov_repo.l14_replay_arbitrate_v1(v_org, p_command_id, v_fingerprint) THEN
    PERFORM 1 FROM gov_repo.l14_session_basis_v1(v_org, v_actor, p_verified_session_iat,
      p_verified_session_exp, p_verified_credential_epoch);
    RETURN QUERY SELECT * FROM gov_repo.l15_risk_scenario_definition_command_result_v1(v_org, p_command_id, true);
    RETURN;
  END IF;

  -- Resolution: the exact admitted tuple of THIS organisation, its admission source class (no laundering), the exact
  -- REVOKE target (current VALIDATED state of the same tuple), the correction link, and same-tenant support.
  SELECT v.source_class INTO v_version_source
  FROM gov_repo.l15_risk_scenario_definition_versions AS v
  WHERE v.organisation_id = v_org AND v.scenario_definition_id = p_scenario_definition_id AND v.scenario_definition_version_id = p_scenario_definition_version_id AND v.content_hash = p_content_hash;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'RISK_SCENARIO_DEFINITION_VERSION_NOT_ADMITTED';
  END IF;
  IF v_version_source IS DISTINCT FROM p_source_class THEN
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'SOURCE_CLASS_LINEAGE_MISMATCH';
  END IF;
  IF p_intent = 'REVOKE' THEN
    SELECT s.state_kind, s.scenario_definition_id, s.scenario_definition_version_id, s.content_hash INTO v_target
    FROM gov_repo.l15_risk_scenario_definition_states AS s WHERE s.organisation_id = v_org AND s.state_id = p_target_state_id;
    IF NOT FOUND OR v_target.scenario_definition_id <> p_scenario_definition_id OR v_target.scenario_definition_version_id <> p_scenario_definition_version_id
       OR v_target.content_hash::text <> p_content_hash THEN
      RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'TARGET_STATE_UNRESOLVED';
    END IF;
    IF v_target.state_kind <> 'VALIDATED' THEN
      RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'TARGET_STATE_NOT_VALIDATED';
    END IF;
    PERFORM 1 FROM gov_repo.l15_risk_scenario_definition_states AS s
    WHERE s.organisation_id = v_org AND s.state_kind = 'REVOKED' AND s.revokes_state_id = p_target_state_id;
    IF FOUND THEN
      RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'TARGET_ALREADY_REVOKED';
    END IF;
    SELECT h.latest_state_id INTO v_latest FROM gov_repo.l15_risk_scenario_definition_heads AS h
    WHERE h.organisation_id = v_org AND h.scenario_definition_id = p_scenario_definition_id AND h.scenario_definition_version_id = p_scenario_definition_version_id;
    IF v_latest IS DISTINCT FROM p_target_state_id THEN
      RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'TARGET_STATE_NOT_CURRENT';
    END IF;
  END IF;
  IF p_prior_proposal_id IS NOT NULL THEN
    PERFORM 1 FROM gov_repo.l15_risk_scenario_definition_proposals AS cp
    WHERE cp.organisation_id = v_org AND cp.proposal_id = p_prior_proposal_id AND cp.scenario_definition_id = p_scenario_definition_id
      AND cp.scenario_definition_version_id = p_scenario_definition_version_id AND cp.content_hash = p_content_hash;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'PRIOR_PROPOSAL_UNRESOLVED';
    END IF;
  END IF;
  PERFORM 1 FROM gov_repo.l15_normalize_support_v1(v_org, p_support_tags, p_support_target_ids);

  v_now := pg_catalog.clock_timestamp();
  INSERT INTO gov_repo.l14_proposals (organisation_id, proposal_id, subject_kind, intent, source_class,
    submitted_by_actor_user_id, prior_proposal_id, support_status, submitted_at)
  VALUES (v_org, v_proposal, 'RISK_SCENARIO_DEFINITION', p_intent, p_source_class, v_actor, p_prior_proposal_id, p_support_status, v_now);
  INSERT INTO gov_repo.l15_risk_scenario_definition_proposals (organisation_id, proposal_id, intent, scenario_definition_id, scenario_definition_version_id, content_hash,
    requested_effective_from, target_state_id)
  VALUES (v_org, v_proposal, p_intent, p_scenario_definition_id, p_scenario_definition_version_id, p_content_hash, p_requested_effective_from, p_target_state_id);
  PERFORM gov_repo.l15_write_registry_support_links_v1(v_org, 'RISK_SCENARIO_DEFINITION', 'PROPOSAL', v_proposal, NULL, NULL,
    p_support_tags, p_support_target_ids);
  INSERT INTO gov_repo.l14_command_results (organisation_id, command_id, command_kind, subject_kind,
    command_fingerprint, actor_user_id, outcome, proposal_id, recorded_at)
  VALUES (v_org, p_command_id, 'SUBMIT_PROPOSAL', 'RISK_SCENARIO_DEFINITION', v_fingerprint, v_actor, 'SUBMITTED', v_proposal, v_now);

  PERFORM 1 FROM gov_repo.l14_session_basis_v1(v_org, v_actor, p_verified_session_iat,
    p_verified_session_exp, p_verified_credential_epoch);
  RETURN QUERY SELECT * FROM gov_repo.l15_risk_scenario_definition_command_result_v1(v_org, p_command_id, false);
END;
$submit$;

-- G3. Governance decision on a RISK_SCENARIO_DEFINITION proposal. VALIDATE intent: VALIDATE / REJECT / DEFER. REVOKE intent: REVOKE /
--     REJECT / DEFER. DEFER is non-terminal. L15_RISK_SCENARIO_VALIDATE governs all four (requested action = the
--     exact outcome). The state belongs to the exact version tuple only; REJECT / DEFER / DENY write no state.
CREATE FUNCTION gov_repo.l15_decide_scenario_proposal_v1(
  p_verified_organisation_id uuid,
  p_verified_actor_user_id uuid,
  p_verified_session_iat bigint,
  p_verified_session_exp bigint,
  p_verified_credential_epoch timestamptz,
  p_command_id text,
  p_proposal_id uuid,
  p_outcome text,
  p_reason_code text,
  p_expected_current_state_id uuid,         -- NULL = explicit expected-none
  p_support_status text,
  p_support_tags text[],
  p_support_target_ids text[],
  p_caller_fingerprint text                 -- assertion only; PostgreSQL recomputes
)
RETURNS TABLE (
  replay boolean, command_id text, command_kind text, subject_kind text, outcome text, command_fingerprint text,
  authorization_decision_id uuid, authorization_result text, deny_reason text, attempted_content_hash text,
  expectation_kind text, expected_latest_version_id uuid, expected_current_state_id uuid, proposal_id uuid,
  governance_decision_id uuid, scenario_definition_id uuid, scenario_definition_version_id uuid, predecessor_version_id uuid, content_hash text,
  state_id uuid, state_kind text, effective_from timestamptz, recorded_at timestamptz
)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp SET lock_timeout = '5s'
AS $decide$
#variable_conflict use_column
DECLARE
  v_org uuid := p_verified_organisation_id;
  v_actor uuid := p_verified_actor_user_id;
  v_role_ids uuid[];
  v_support text[];
  v_fingerprint text;
  v_proposal record;
  v_head_found boolean;
  v_head_latest uuid;
  v_latest_kind text;
  v_latest_from timestamptz;
  v_target_state_id uuid;
  v_has_basis boolean := false;
  v_basis_policy uuid;
  v_basis_version uuid;
  v_basis_hash text;
  v_deny text;
  v_ordinals integer[];
  v_self boolean;
  v_temporal text := 'IMMEDIATE';
  v_effective_from timestamptz;
  v_now timestamptz;
  v_authz uuid := pg_catalog.gen_random_uuid();
  v_decision uuid := pg_catalog.gen_random_uuid();
  v_state uuid := pg_catalog.gen_random_uuid();
  v_state_kind text;
BEGIN
  SELECT b.role_ids INTO v_role_ids
  FROM gov_repo.l14_session_basis_v1(v_org, v_actor, p_verified_session_iat, p_verified_session_exp,
    p_verified_credential_epoch) AS b;

  PERFORM gov_repo.l14_validate_command_id_v1(p_command_id, p_caller_fingerprint);
  IF p_outcome IS NULL OR p_outcome NOT IN ('VALIDATE','REJECT','DEFER','REVOKE')
     OR p_reason_code IS NULL OR p_reason_code NOT IN (
       'RISK_SCENARIO_DEFINITION_VALIDATED','RISK_SCENARIO_DEFINITION_REJECTED','RISK_SCENARIO_DEFINITION_DEFERRED','RISK_SCENARIO_DEFINITION_REVOKED')
     OR NOT ((p_outcome = 'VALIDATE' AND p_reason_code = 'RISK_SCENARIO_DEFINITION_VALIDATED')
          OR (p_outcome = 'REJECT' AND p_reason_code = 'RISK_SCENARIO_DEFINITION_REJECTED')
          OR (p_outcome = 'DEFER' AND p_reason_code = 'RISK_SCENARIO_DEFINITION_DEFERRED')
          OR (p_outcome = 'REVOKE' AND p_reason_code = 'RISK_SCENARIO_DEFINITION_REVOKED')) THEN
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'DECISION_VOCABULARY_INVALID';
  END IF;
  -- The immutable proposal defines the command identity; it is the only row read before replay arbitration.
  SELECT p.proposal_id, p.intent, p.source_class, p.submitted_by_actor_user_id,
         t.scenario_definition_id, t.scenario_definition_version_id, t.content_hash::text AS content_hash, t.requested_effective_from, t.target_state_id
  INTO v_proposal
  FROM gov_repo.l14_proposals AS p
  JOIN gov_repo.l15_risk_scenario_definition_proposals AS t ON t.organisation_id = p.organisation_id AND t.proposal_id = p.proposal_id
  WHERE p.organisation_id = v_org AND p.proposal_id = p_proposal_id AND p.subject_kind = 'RISK_SCENARIO_DEFINITION';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'PROPOSAL_UNRESOLVED';
  END IF;
  IF (p_outcome = 'VALIDATE' AND v_proposal.intent <> 'VALIDATE') OR (p_outcome = 'REVOKE' AND v_proposal.intent <> 'REVOKE') THEN
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'OUTCOME_INTENT_INCOMPATIBLE';
  END IF;

  v_support := gov_repo.l15_registry_support_parts_v1(p_support_status, p_support_tags, p_support_target_ids);
  v_fingerprint := gov_repo.l14_sha256_frame_v1(
    ARRAY['L15_COMMAND_FINGERPRINT_V1', 'DECIDE_PROPOSAL', v_org::text, v_actor::text, p_outcome, p_reason_code,
          v_proposal.proposal_id::text, 'RISK_SCENARIO_DEFINITION', v_proposal.intent, v_proposal.source_class,
          v_proposal.scenario_definition_id::text, v_proposal.scenario_definition_version_id::text, v_proposal.content_hash]
    || CASE WHEN v_proposal.requested_effective_from IS NULL THEN ARRAY['IMMEDIATE']
            ELSE ARRAY['EXPLICIT', gov_repo.l14_canonical_instant_v1(v_proposal.requested_effective_from)] END
    || CASE WHEN v_proposal.target_state_id IS NULL THEN ARRAY['NO_TARGET_STATE']
            ELSE ARRAY['TARGET_STATE', v_proposal.target_state_id::text] END
    || CASE WHEN p_expected_current_state_id IS NULL THEN ARRAY['EXPECTED_NONE']
            ELSE ARRAY['EXPECTED_CURRENT', p_expected_current_state_id::text] END
    || v_support);
  IF v_fingerprint IS DISTINCT FROM p_caller_fingerprint THEN
    RAISE EXCEPTION 'L14_FINGERPRINT_MISMATCH' USING ERRCODE = 'GV008', DETAIL = 'CALLER_FINGERPRINT_DIFFERS';
  END IF;

  PERFORM gov_repo.l14_lock_authority_policy_guard_shared_v1(v_org);
  PERFORM gov_repo.l15_lock_registry_subject_guard_v1(v_org, 'RISK_SCENARIO_DEFINITION',
    'VALIDATION:' || v_proposal.scenario_definition_id::text || ':' || v_proposal.scenario_definition_version_id::text || ':' || v_proposal.content_hash);
  PERFORM gov_repo.l14_lock_command_guard_v1(v_org, p_command_id);
  IF gov_repo.l14_replay_arbitrate_v1(v_org, p_command_id, v_fingerprint) THEN
    PERFORM 1 FROM gov_repo.l14_session_basis_v1(v_org, v_actor, p_verified_session_iat,
      p_verified_session_exp, p_verified_credential_epoch);
    RETURN QUERY SELECT * FROM gov_repo.l15_risk_scenario_definition_command_result_v1(v_org, p_command_id, true);
    RETURN;
  END IF;

  -- Resolution under the subject guard: terminality, head expectation, subject rules, support.
  PERFORM 1 FROM gov_repo.l14_governance_decisions AS d
  WHERE d.organisation_id = v_org AND d.proposal_id = p_proposal_id AND d.outcome IN ('VALIDATE','REJECT','REVOKE');
  IF FOUND THEN
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'PROPOSAL_TERMINAL';
  END IF;
  SELECT h.latest_state_id INTO v_head_latest FROM gov_repo.l15_risk_scenario_definition_heads AS h
  WHERE h.organisation_id = v_org AND h.scenario_definition_id = v_proposal.scenario_definition_id AND h.scenario_definition_version_id = v_proposal.scenario_definition_version_id;
  v_head_found := FOUND;
  IF p_expected_current_state_id IS NULL AND v_head_latest IS NOT NULL THEN
    RAISE EXCEPTION 'L15_STALE_EXPECTATION' USING ERRCODE = 'GV009', DETAIL = 'RISK_SCENARIO_DEFINITION_STATE_EXISTS';
  END IF;
  IF p_expected_current_state_id IS DISTINCT FROM v_head_latest THEN
    RAISE EXCEPTION 'L15_STALE_EXPECTATION' USING ERRCODE = 'GV009', DETAIL = 'RISK_SCENARIO_DEFINITION_STATE_EXPECTATION_MISMATCH';
  END IF;
  IF v_head_latest IS NOT NULL THEN
    SELECT s.state_kind, s.effective_from INTO v_latest_kind, v_latest_from
    FROM gov_repo.l15_risk_scenario_definition_states AS s WHERE s.organisation_id = v_org AND s.state_id = v_head_latest;
  END IF;
  IF p_outcome = 'VALIDATE' AND v_latest_kind = 'VALIDATED' THEN
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'RISK_SCENARIO_DEFINITION_ALREADY_VALIDATED';
  END IF;
  IF p_outcome = 'REVOKE' THEN
    PERFORM 1 FROM gov_repo.l15_risk_scenario_definition_states AS s
    WHERE s.organisation_id = v_org AND s.state_kind = 'REVOKED' AND s.revokes_state_id = v_proposal.target_state_id;
    IF FOUND THEN
      RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'TARGET_ALREADY_REVOKED';
    END IF;
    IF v_head_latest IS DISTINCT FROM v_proposal.target_state_id OR v_latest_kind IS DISTINCT FROM 'VALIDATED' THEN
      RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'TARGET_STATE_NOT_CURRENT';
    END IF;
    v_target_state_id := v_proposal.target_state_id;
  END IF;
  PERFORM 1 FROM gov_repo.l15_normalize_support_v1(v_org, p_support_tags, p_support_target_ids);

  -- One DB evaluation instant; temporal class; the CURRENT effective policy is the ONLY basis.
  v_now := pg_catalog.clock_timestamp();
  IF p_outcome IN ('VALIDATE','REVOKE') THEN
    IF v_proposal.requested_effective_from IS NULL THEN
      v_effective_from := v_now;
    ELSIF v_proposal.requested_effective_from < v_now THEN
      v_effective_from := v_proposal.requested_effective_from;
      v_temporal := 'BACKDATED';
    ELSE
      v_effective_from := v_proposal.requested_effective_from;
      v_temporal := 'FUTURE_DATED';
    END IF;
  END IF;
  v_self := v_proposal.submitted_by_actor_user_id = v_actor;
  SELECT b.authority_policy_id, b.version_id, b.content_hash INTO v_basis_policy, v_basis_version, v_basis_hash
  FROM gov_repo.l14_effective_authority_basis_v1(v_org, v_now) AS b;
  v_has_basis := FOUND;
  IF NOT v_has_basis THEN
    v_deny := 'NO_EFFECTIVE_AUTHORITY';
  ELSE
    SELECT e.deny_reason, e.rule_ordinals INTO v_deny, v_ordinals
    FROM gov_repo.l14_evaluate_authority_rules_v1(v_org, v_basis_policy, v_basis_version, v_role_ids,
      gov_repo.l15_governance_permission_v1('RISK_SCENARIO_DEFINITION', p_outcome), p_outcome, p_outcome = 'VALIDATE' AND v_self, v_temporal) AS e;
  END IF;

  INSERT INTO gov_repo.l14_authorization_decisions (
    organisation_id, authorization_decision_id, command_id, command_fingerprint, actor_user_id,
    requested_action, subject_kind, scope_tag, source_class, proposal_id, is_self_validation,
    authority_basis, basis_authority_policy_id, basis_version_id, basis_content_hash, result, deny_reason,
    evaluated_at, expectation_kind, expected_current_state_id)
  VALUES (
    v_org, v_authz, p_command_id, v_fingerprint, v_actor,
    p_outcome, 'RISK_SCENARIO_DEFINITION', 'ALL_ALLOWED_TARGETS', v_proposal.source_class, p_proposal_id, v_self,
    CASE WHEN v_has_basis THEN 'AUTHORITY_POLICY_VERSION' END,
    CASE WHEN v_has_basis THEN v_basis_policy END,
    CASE WHEN v_has_basis THEN v_basis_version END,
    CASE WHEN v_has_basis THEN v_basis_hash END,
    CASE WHEN v_deny IS NULL THEN 'ALLOW' ELSE 'DENY' END, v_deny, v_now,
    CASE WHEN p_expected_current_state_id IS NULL THEN 'EXPECTED_NONE' ELSE 'EXPECTED_CURRENT' END,
    p_expected_current_state_id);
  PERFORM gov_repo.l14_snapshot_roles_v1(v_org, v_authz, v_role_ids);
  IF v_has_basis THEN
    PERFORM gov_repo.l14_snapshot_policy_rules_v1(v_org, v_authz, v_basis_policy, v_basis_version, v_ordinals);
  END IF;
  IF v_deny IS NULL THEN
    -- The M17-S0 L15 ALLOW guard (deferred, SECURITY INVOKER) must evaluate HERE, as this owner-pinned definer, now that the
    -- rule snapshot exists: at COMMIT it would run as the committing role (service_role), which has no privilege on the
    -- envelope by design. Firing it immediately keeps its full check (effective-policy L15 rule of the exact mapped
    -- permission + action, AUTHORITY_POLICY_VERSION basis, ACTIVE human of the ACTIVE organisation); then restore DEFERRED.
    SET CONSTRAINTS gov_repo.l15_authorization_decisions_allow_guard IMMEDIATE;
    SET CONSTRAINTS gov_repo.l15_authorization_decisions_allow_guard DEFERRED;
  END IF;

  IF v_deny IS NOT NULL THEN
    -- Durable DENY: authorization + result only; consumes the command id; no decision, no state, no head change.
    INSERT INTO gov_repo.l14_command_results (organisation_id, command_id, command_kind, subject_kind,
      command_fingerprint, actor_user_id, outcome, authorization_decision_id, proposal_id, recorded_at)
    VALUES (v_org, p_command_id, 'DECIDE_PROPOSAL', 'RISK_SCENARIO_DEFINITION', v_fingerprint, v_actor, 'DENIED', v_authz, p_proposal_id, v_now);
  ELSE
    IF p_outcome = 'REVOKE' AND v_effective_from < v_latest_from THEN
      RAISE EXCEPTION 'L15_CONTINUITY_VIOLATION' USING ERRCODE = 'GV011', DETAIL = 'REVOKE_BEFORE_TARGET_EFFECTIVE';
    END IF;
    IF p_outcome = 'VALIDATE' AND v_latest_kind = 'REVOKED' AND NOT (v_effective_from >= v_latest_from) THEN
      RAISE EXCEPTION 'L15_CONTINUITY_VIOLATION' USING ERRCODE = 'GV011', DETAIL = 'REVALIDATION_OVERLAPS_PRIOR_INTERVAL';
    END IF;
    INSERT INTO gov_repo.l14_governance_decisions (organisation_id, governance_decision_id, proposal_id,
      subject_kind, outcome, reason_code, authorization_decision_id, actor_user_id, support_status, decided_at)
    VALUES (v_org, v_decision, p_proposal_id, 'RISK_SCENARIO_DEFINITION', p_outcome, p_reason_code, v_authz, v_actor, p_support_status, v_now);
    PERFORM gov_repo.l15_write_registry_support_links_v1(v_org, 'RISK_SCENARIO_DEFINITION', 'DECISION', NULL, v_decision, NULL,
      p_support_tags, p_support_target_ids);
    IF p_outcome IN ('VALIDATE','REVOKE') THEN
      v_state_kind := CASE WHEN p_outcome = 'VALIDATE' THEN 'VALIDATED' ELSE 'REVOKED' END;
      -- Append-only: predecessor = the expected head state; the target state is never modified.
      INSERT INTO gov_repo.l15_risk_scenario_definition_states (organisation_id, state_id, state_kind, scenario_definition_id, scenario_definition_version_id, content_hash,
        predecessor_state_id, revokes_state_id, effective_from, recorded_at, proposal_id, governance_decision_id,
        authorization_decision_id, authority_policy_id, authority_policy_version_id, authority_policy_content_hash,
        source_class, support_status)
      VALUES (v_org, v_state, v_state_kind, v_proposal.scenario_definition_id, v_proposal.scenario_definition_version_id, v_proposal.content_hash,
        v_head_latest, v_target_state_id, v_effective_from, v_now, p_proposal_id, v_decision, v_authz, v_basis_policy,
        v_basis_version, v_basis_hash, v_proposal.source_class, p_support_status);
      IF NOT v_head_found THEN
        INSERT INTO gov_repo.l15_risk_scenario_definition_heads (organisation_id, scenario_definition_id, scenario_definition_version_id, content_hash, latest_state_id)
        VALUES (v_org, v_proposal.scenario_definition_id, v_proposal.scenario_definition_version_id, v_proposal.content_hash, NULL);
      END IF;
      UPDATE gov_repo.l15_risk_scenario_definition_heads AS h SET latest_state_id = v_state
      WHERE h.organisation_id = v_org AND h.scenario_definition_id = v_proposal.scenario_definition_id AND h.scenario_definition_version_id = v_proposal.scenario_definition_version_id
        AND h.content_hash = v_proposal.content_hash AND h.latest_state_id IS NOT DISTINCT FROM p_expected_current_state_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'L15_STALE_EXPECTATION' USING ERRCODE = 'GV009', DETAIL = 'RISK_SCENARIO_DEFINITION_STATE_EXPECTATION_MISMATCH';
      END IF;
      PERFORM gov_repo.l15_write_registry_support_links_v1(v_org, 'RISK_SCENARIO_DEFINITION', 'STATE', NULL, NULL, v_state,
        p_support_tags, p_support_target_ids);
      INSERT INTO gov_repo.l14_command_results (organisation_id, command_id, command_kind, subject_kind,
        command_fingerprint, actor_user_id, outcome, authorization_decision_id, proposal_id, governance_decision_id,
        l15_state_id, recorded_at)
      VALUES (v_org, p_command_id, 'DECIDE_PROPOSAL', 'RISK_SCENARIO_DEFINITION', v_fingerprint, v_actor, v_state_kind,
        v_authz, p_proposal_id, v_decision, v_state, v_now);
    ELSE
      INSERT INTO gov_repo.l14_command_results (organisation_id, command_id, command_kind, subject_kind,
        command_fingerprint, actor_user_id, outcome, authorization_decision_id, proposal_id, governance_decision_id,
        recorded_at)
      VALUES (v_org, p_command_id, 'DECIDE_PROPOSAL', 'RISK_SCENARIO_DEFINITION', v_fingerprint, v_actor,
        CASE WHEN p_outcome = 'REJECT' THEN 'REJECTED' ELSE 'DEFERRED' END, v_authz, p_proposal_id, v_decision, v_now);
    END IF;
  END IF;

  PERFORM 1 FROM gov_repo.l14_session_basis_v1(v_org, v_actor, p_verified_session_iat,
    p_verified_session_exp, p_verified_credential_epoch);
  RETURN QUERY SELECT * FROM gov_repo.l15_risk_scenario_definition_command_result_v1(v_org, p_command_id, false);
END;
$decide$;


-- ---------------------------------------------------------------------------------------------------------------------
-- G. RISK_METHODOLOGY RPCs (SECURITY DEFINER; necessity: the L15 stores and the shared envelope have no application privilege at
--    all, so a bounded definer is the only write path). Owner postgres, search_path pinned, fully qualified, EXECUTE =
--    service_role only; tenant + actor + CURRENT locked roles re-derived in-RPC from the verified principal
--    (l14_session_basis_v1); service_role is transport, never authority. Replay-first order:
--    base session -> syntactic shape -> DB content hash -> syntactic support -> DB fingerprint -> AP guard SHARED ->
--    L15 subject guard(s) -> command guard -> replay arbitration -> tenant / reference / support resolution -> CURRENT
--    effective Authority Policy -> exact mapped L15 permission -> mutation -> final base-eligibility recheck.
-- ---------------------------------------------------------------------------------------------------------------------
-- G1. ADMIT an immutable methodology version (explicit expected-latest-version concurrency). EXPECTED_NONE creates the stable
--     identity with its root version; EXPECTED_CURRENT appends the successor of the exact latest admitted version.
--     PostgreSQL computes the content hash. No proposal, no decision, no state, no validation, no head.
CREATE FUNCTION gov_repo.l15_admit_methodology_version_v1(
  p_verified_organisation_id uuid,
  p_verified_actor_user_id uuid,
  p_verified_session_iat bigint,
  p_verified_session_exp bigint,
  p_verified_credential_epoch timestamptz,
  p_command_id text,
  p_methodology_id uuid,                -- stable identity (opaque, caller-supplied, tenant-scoped)
  p_methodology_version_id uuid,        -- the new immutable version (opaque, caller-supplied, never reused)
  p_expectation_kind text,                 -- EXPECTED_NONE (first version) | EXPECTED_CURRENT (successor)
  p_expected_latest_version_id uuid,       -- NULL iff EXPECTED_NONE; else the exact latest admitted version
  p_likelihood_level_codes text[],         -- ordered closed likelihood scale (parallel arrays; 2..7 levels)
  p_likelihood_ordinals integer[],
  p_likelihood_definition_namespaces text[],
  p_likelihood_definition_codes text[],
  p_impact_level_codes text[],             -- ordered closed impact scale (parallel arrays; 2..7 levels)
  p_impact_ordinals integer[],
  p_impact_definition_namespaces text[],
  p_impact_definition_codes text[],
  p_matrix_likelihood_level_codes text[],  -- total rating matrix (parallel arrays; one cell per level pair)
  p_matrix_impact_level_codes text[],
  p_matrix_rating_bands text[],
  p_assessment_validity_maximum interval,  -- positive; bounds a future assessment's valid_until - effective_from
  p_content_hash text,                     -- assertion only; PostgreSQL recomputes
  p_source_class text,                     -- LOCAL_HUMAN | SYSTEM_SEED (seed provenance, human-mediated); never authority
  p_caller_fingerprint text                -- assertion only; PostgreSQL recomputes
)
RETURNS TABLE (
  replay boolean, command_id text, command_kind text, subject_kind text, outcome text, command_fingerprint text,
  authorization_decision_id uuid, authorization_result text, deny_reason text, attempted_content_hash text,
  expectation_kind text, expected_latest_version_id uuid, expected_current_state_id uuid, proposal_id uuid,
  governance_decision_id uuid, methodology_id uuid, methodology_version_id uuid, predecessor_version_id uuid, content_hash text,
  state_id uuid, state_kind text, effective_from timestamptz, recorded_at timestamptz
)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp SET lock_timeout = '5s'
AS $admit$
#variable_conflict use_column
DECLARE
  v_org uuid := p_verified_organisation_id;
  v_actor uuid := p_verified_actor_user_id;
  v_role_ids uuid[];
  v_content_hash text;
  v_fingerprint text;
  v_latest uuid;
  v_has_basis boolean := false;
  v_basis_policy uuid;
  v_basis_version uuid;
  v_basis_hash text;
  v_deny text;
  v_ordinals integer[];
  v_now timestamptz;
  v_authz uuid := pg_catalog.gen_random_uuid();
BEGIN
  -- 1. Base session eligibility (verified ACTIVE human of the ACTIVE organisation; locks ORG -> USER -> ROLES).
  SELECT b.role_ids INTO v_role_ids
  FROM gov_repo.l14_session_basis_v1(v_org, v_actor, p_verified_session_iat, p_verified_session_exp,
    p_verified_credential_epoch) AS b;

  -- 2. Syntactic shape (no table read).
  PERFORM gov_repo.l14_validate_command_id_v1(p_command_id, p_caller_fingerprint);
  IF p_methodology_id IS NULL OR p_methodology_version_id IS NULL OR p_methodology_version_id = p_methodology_id THEN
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'RISK_METHODOLOGY_IDS_REQUIRED';
  END IF;
  IF p_expectation_kind IS NULL OR p_expectation_kind NOT IN ('EXPECTED_NONE','EXPECTED_CURRENT')
     OR (p_expectation_kind = 'EXPECTED_NONE') <> (p_expected_latest_version_id IS NULL)
     OR p_expected_latest_version_id = p_methodology_version_id THEN
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'EXPECTATION_MALFORMED';
  END IF;
  PERFORM gov_repo.l15_risk_methodology_content_check_v1(p_likelihood_level_codes, p_likelihood_ordinals,
    p_likelihood_definition_namespaces, p_likelihood_definition_codes, p_impact_level_codes, p_impact_ordinals,
    p_impact_definition_namespaces, p_impact_definition_codes, p_matrix_likelihood_level_codes, p_matrix_impact_level_codes,
    p_matrix_rating_bands, p_assessment_validity_maximum);
  IF p_content_hash IS NULL OR p_content_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'CONTENT_HASH_MALFORMED';
  END IF;
  IF p_source_class IS NULL OR p_source_class NOT IN ('SYSTEM_SEED','LOCAL_HUMAN','SOURCE_CONNECTION') THEN
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'SOURCE_CLASS_UNKNOWN';
  END IF;
  IF p_source_class = 'SOURCE_CONNECTION' THEN
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'SOURCE_CLASS_NOT_EXECUTABLE';
  END IF;

  -- 3. The DB-authoritative canonical content hash. A caller hash is an assertion only.
  v_content_hash := gov_repo.l15_risk_methodology_content_hash_v1(p_likelihood_level_codes, p_likelihood_ordinals,
    p_likelihood_definition_namespaces, p_likelihood_definition_codes, p_impact_level_codes, p_impact_ordinals,
    p_impact_definition_namespaces, p_impact_definition_codes, p_matrix_likelihood_level_codes, p_matrix_impact_level_codes,
    p_matrix_rating_bands, p_assessment_validity_maximum);
  IF v_content_hash IS DISTINCT FROM p_content_hash THEN
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'CONTENT_HASH_MISMATCH';
  END IF;

  -- 4. PostgreSQL-authoritative fingerprint over the exact ids, DB hash, source and expectation.
  v_fingerprint := gov_repo.l14_sha256_frame_v1(
    ARRAY['L15_COMMAND_FINGERPRINT_V1', 'ADMIT_RISK_METHODOLOGY_VERSION', v_org::text, v_actor::text, 'ADMIT', 'RISK_METHODOLOGY',
          p_methodology_id::text, p_methodology_version_id::text, v_content_hash, p_source_class]
    || CASE WHEN p_expected_latest_version_id IS NULL THEN ARRAY['EXPECTED_NONE']
            ELSE ARRAY['EXPECTED_CURRENT', p_expected_latest_version_id::text] END);
  IF v_fingerprint IS DISTINCT FROM p_caller_fingerprint THEN
    RAISE EXCEPTION 'L14_FINGERPRINT_MISMATCH' USING ERRCODE = 'GV008', DETAIL = 'CALLER_FINGERPRINT_DIFFERS';
  END IF;

  -- 5-7. AP SHARED, identity guard (serializes first / successor admission of one identity), version-id guard
  --      (serializes reuse of one version id across identities), command guard; replay BEFORE any evaluation.
  PERFORM gov_repo.l14_lock_authority_policy_guard_shared_v1(v_org);
  PERFORM gov_repo.l15_lock_registry_subject_guard_v1(v_org, 'RISK_METHODOLOGY', 'IDENTITY:' || p_methodology_id::text);
  PERFORM gov_repo.l15_lock_registry_subject_guard_v1(v_org, 'RISK_METHODOLOGY', 'VERSION:' || p_methodology_version_id::text);
  PERFORM gov_repo.l14_lock_command_guard_v1(v_org, p_command_id);
  IF gov_repo.l14_replay_arbitrate_v1(v_org, p_command_id, v_fingerprint) THEN
    PERFORM 1 FROM gov_repo.l14_session_basis_v1(v_org, v_actor, p_verified_session_iat,
      p_verified_session_exp, p_verified_credential_epoch);
    RETURN QUERY SELECT * FROM gov_repo.l15_risk_methodology_command_result_v1(v_org, p_command_id, true);
    RETURN;
  END IF;

  -- 8. Tenant / reference resolution under both guards: the version id is unused in THIS organisation; the exact
  --    expected latest admitted version of THIS organisation's identity holds (a foreign identity reads as unknown).
  PERFORM 1 FROM gov_repo.l15_risk_methodology_versions AS v WHERE v.organisation_id = v_org AND v.methodology_version_id = p_methodology_version_id;
  IF FOUND THEN
    RAISE EXCEPTION 'L15_STALE_EXPECTATION' USING ERRCODE = 'GV009', DETAIL = 'RISK_METHODOLOGY_VERSION_ID_EXISTS';
  END IF;
  SELECT v.methodology_version_id INTO v_latest
  FROM gov_repo.l15_risk_methodology_versions AS v
  WHERE v.organisation_id = v_org AND v.methodology_id = p_methodology_id
    AND NOT EXISTS (SELECT 1 FROM gov_repo.l15_risk_methodology_versions AS n
                    WHERE n.organisation_id = v.organisation_id AND n.methodology_id = v.methodology_id
                      AND n.predecessor_version_id = v.methodology_version_id);
  IF p_expected_latest_version_id IS NULL AND v_latest IS NOT NULL THEN
    RAISE EXCEPTION 'L15_STALE_EXPECTATION' USING ERRCODE = 'GV009', DETAIL = 'RISK_METHODOLOGY_EXISTS';
  END IF;
  IF p_expected_latest_version_id IS DISTINCT FROM v_latest THEN
    RAISE EXCEPTION 'L15_STALE_EXPECTATION' USING ERRCODE = 'GV009', DETAIL = 'RISK_METHODOLOGY_VERSION_EXPECTATION_MISMATCH';
  END IF;

  -- 9-10. The CURRENT effective Authority Policy (exact recomputed hash) is the ONLY basis; the exact mapped L15
  --       permission. Never L14_*, service_role, source class, seed origin, scanner, CG-AG, confidence or LLM.
  v_now := pg_catalog.clock_timestamp();
  SELECT b.authority_policy_id, b.version_id, b.content_hash INTO v_basis_policy, v_basis_version, v_basis_hash
  FROM gov_repo.l14_effective_authority_basis_v1(v_org, v_now) AS b;
  v_has_basis := FOUND;
  IF NOT v_has_basis THEN
    v_deny := 'NO_EFFECTIVE_AUTHORITY';
  ELSE
    SELECT e.deny_reason, e.rule_ordinals INTO v_deny, v_ordinals
    FROM gov_repo.l14_evaluate_authority_rules_v1(v_org, v_basis_policy, v_basis_version, v_role_ids,
      gov_repo.l15_governance_permission_v1('RISK_METHODOLOGY', 'ADMIT'), 'ADMIT', false, 'IMMEDIATE') AS e;
  END IF;

  INSERT INTO gov_repo.l14_authorization_decisions (
    organisation_id, authorization_decision_id, command_id, command_fingerprint, actor_user_id,
    requested_action, subject_kind, scope_tag, source_class, proposal_id, is_self_validation,
    authority_basis, basis_authority_policy_id, basis_version_id, basis_content_hash, result, deny_reason,
    evaluated_at, attempted_content_hash, expectation_kind, expected_latest_version_id)
  VALUES (
    v_org, v_authz, p_command_id, v_fingerprint, v_actor,
    'ADMIT', 'RISK_METHODOLOGY', 'ALL_ALLOWED_TARGETS', p_source_class, NULL, NULL,
    CASE WHEN v_has_basis THEN 'AUTHORITY_POLICY_VERSION' END,
    CASE WHEN v_has_basis THEN v_basis_policy END,
    CASE WHEN v_has_basis THEN v_basis_version END,
    CASE WHEN v_has_basis THEN v_basis_hash END,
    CASE WHEN v_deny IS NULL THEN 'ALLOW' ELSE 'DENY' END, v_deny, v_now,
    v_content_hash, p_expectation_kind, p_expected_latest_version_id);
  PERFORM gov_repo.l14_snapshot_roles_v1(v_org, v_authz, v_role_ids);
  IF v_has_basis THEN
    PERFORM gov_repo.l14_snapshot_policy_rules_v1(v_org, v_authz, v_basis_policy, v_basis_version, v_ordinals);
  END IF;
  IF v_deny IS NULL THEN
    -- The M17-S0 L15 ALLOW guard (deferred, SECURITY INVOKER) must evaluate HERE, as this owner-pinned definer, now that the
    -- rule snapshot exists: at COMMIT it would run as the committing role (service_role), which has no privilege on the
    -- envelope by design. Firing it immediately keeps its full check (effective-policy L15 rule of the exact mapped
    -- permission + action, AUTHORITY_POLICY_VERSION basis, ACTIVE human of the ACTIVE organisation); then restore DEFERRED.
    SET CONSTRAINTS gov_repo.l15_authorization_decisions_allow_guard IMMEDIATE;
    SET CONSTRAINTS gov_repo.l15_authorization_decisions_allow_guard DEFERRED;
  END IF;

  IF v_deny IS NOT NULL THEN
    -- 11 (DENY). Durable authorization + result only: no identity, no version, no content.
    INSERT INTO gov_repo.l14_command_results (organisation_id, command_id, command_kind, subject_kind,
      command_fingerprint, actor_user_id, outcome, authorization_decision_id, recorded_at)
    VALUES (v_org, p_command_id, 'ADMIT_RISK_METHODOLOGY_VERSION', 'RISK_METHODOLOGY', v_fingerprint, v_actor, 'DENIED', v_authz, v_now);
  ELSE
    -- 11 (ALLOW). Root / successor version + its normalized content rows; the identity right after a root version.
    INSERT INTO gov_repo.l15_risk_methodology_versions (organisation_id, methodology_id, methodology_version_id, assessment_validity_maximum, content_hash,
      predecessor_version_id, admission_authorization_decision_id, source_class, admitted_by_actor_user_id, recorded_at)
    VALUES (v_org, p_methodology_id, p_methodology_version_id, p_assessment_validity_maximum, v_content_hash, v_latest, v_authz, p_source_class,
      v_actor, v_now);
    INSERT INTO gov_repo.l15_risk_methodology_likelihood_levels (organisation_id, methodology_version_id, ordinal, level_code,
      definition_reference_namespace, definition_reference_code)
    SELECT v_org, p_methodology_version_id, l.ord::smallint, l.code, l.ns, l.def
    FROM ROWS FROM (pg_catalog.unnest(p_likelihood_ordinals), pg_catalog.unnest(p_likelihood_level_codes),
                    pg_catalog.unnest(p_likelihood_definition_namespaces), pg_catalog.unnest(p_likelihood_definition_codes)) AS l(ord, code, ns, def);
    INSERT INTO gov_repo.l15_risk_methodology_impact_levels (organisation_id, methodology_version_id, ordinal, level_code,
      definition_reference_namespace, definition_reference_code)
    SELECT v_org, p_methodology_version_id, l.ord::smallint, l.code, l.ns, l.def
    FROM ROWS FROM (pg_catalog.unnest(p_impact_ordinals), pg_catalog.unnest(p_impact_level_codes),
                    pg_catalog.unnest(p_impact_definition_namespaces), pg_catalog.unnest(p_impact_definition_codes)) AS l(ord, code, ns, def);
    INSERT INTO gov_repo.l15_risk_methodology_rating_cells (organisation_id, methodology_version_id, likelihood_level_code,
      impact_level_code, rating_band)
    SELECT v_org, p_methodology_version_id, m.lik, m.imp, m.band
    FROM ROWS FROM (pg_catalog.unnest(p_matrix_likelihood_level_codes), pg_catalog.unnest(p_matrix_impact_level_codes),
                    pg_catalog.unnest(p_matrix_rating_bands)) AS m(lik, imp, band);
    IF v_latest IS NULL THEN
      INSERT INTO gov_repo.l15_risk_methodologies (organisation_id, methodology_id, admission_authorization_decision_id, recorded_at)
      VALUES (v_org, p_methodology_id, v_authz, v_now);
    END IF;
    INSERT INTO gov_repo.l14_command_results (organisation_id, command_id, command_kind, subject_kind,
      command_fingerprint, actor_user_id, outcome, authorization_decision_id, recorded_at)
    VALUES (v_org, p_command_id, 'ADMIT_RISK_METHODOLOGY_VERSION', 'RISK_METHODOLOGY', v_fingerprint, v_actor, 'ADMITTED', v_authz, v_now);
  END IF;

  -- 12. Base session eligibility must still hold at commitment (same-transaction final recheck).
  PERFORM 1 FROM gov_repo.l14_session_basis_v1(v_org, v_actor, p_verified_session_iat,
    p_verified_session_exp, p_verified_credential_epoch);
  RETURN QUERY SELECT * FROM gov_repo.l15_risk_methodology_command_result_v1(v_org, p_command_id, false);
END;
$admit$;

-- G2. Proposal submission over the exact admitted version tuple by any verified ACTIVE same-tenant member. Grants no
--     authority; writes no decision / state / head. SYSTEM_SEED proposals are explicitly marked, human-mediated, must
--     equal the version's admission source class, and must carry PRESENT DISCOVERY_EVIDENCE / SOURCE_ASSERTION support.
CREATE FUNCTION gov_repo.l15_submit_methodology_proposal_v1(
  p_verified_organisation_id uuid,
  p_verified_actor_user_id uuid,
  p_verified_session_iat bigint,
  p_verified_session_exp bigint,
  p_verified_credential_epoch timestamptz,
  p_command_id text,
  p_intent text,                            -- VALIDATE | REVOKE
  p_source_class text,                      -- must equal the exact version's admission source class
  p_methodology_id uuid,
  p_methodology_version_id uuid,
  p_content_hash text,
  p_requested_effective_from timestamptz,   -- NULL = IMMEDIATE intent
  p_target_state_id uuid,                   -- REVOKE only: the exact current VALIDATED state of the same tuple
  p_prior_proposal_id uuid,                 -- correction link (same tuple)
  p_support_status text,
  p_support_tags text[],
  p_support_target_ids text[],
  p_caller_fingerprint text                 -- assertion only; PostgreSQL recomputes
)
RETURNS TABLE (
  replay boolean, command_id text, command_kind text, subject_kind text, outcome text, command_fingerprint text,
  authorization_decision_id uuid, authorization_result text, deny_reason text, attempted_content_hash text,
  expectation_kind text, expected_latest_version_id uuid, expected_current_state_id uuid, proposal_id uuid,
  governance_decision_id uuid, methodology_id uuid, methodology_version_id uuid, predecessor_version_id uuid, content_hash text,
  state_id uuid, state_kind text, effective_from timestamptz, recorded_at timestamptz
)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp SET lock_timeout = '5s'
AS $submit$
#variable_conflict use_column
DECLARE
  v_org uuid := p_verified_organisation_id;
  v_actor uuid := p_verified_actor_user_id;
  v_support text[];
  v_fingerprint text;
  v_version_source text;
  v_target record;
  v_latest uuid;
  v_proposal uuid := pg_catalog.gen_random_uuid();
  v_now timestamptz;
BEGIN
  PERFORM 1 FROM gov_repo.l14_session_basis_v1(v_org, v_actor, p_verified_session_iat,
    p_verified_session_exp, p_verified_credential_epoch);

  PERFORM gov_repo.l14_validate_command_id_v1(p_command_id, p_caller_fingerprint);
  IF p_intent IS NULL OR p_intent NOT IN ('VALIDATE','REVOKE')
     OR p_source_class IS NULL OR p_source_class NOT IN ('SYSTEM_SEED','LOCAL_HUMAN','SOURCE_CONNECTION') THEN
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'PROPOSAL_VOCABULARY_UNKNOWN';
  END IF;
  IF p_source_class = 'SOURCE_CONNECTION' THEN
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'SOURCE_CLASS_NOT_EXECUTABLE';
  END IF;
  IF p_methodology_id IS NULL OR p_methodology_version_id IS NULL THEN
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'RISK_METHODOLOGY_IDS_REQUIRED';
  END IF;
  IF p_content_hash IS NULL OR p_content_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'CONTENT_HASH_MALFORMED';
  END IF;
  IF p_intent = 'VALIDATE' AND p_target_state_id IS NOT NULL THEN
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'TARGET_STATE_NOT_PERMITTED';
  END IF;
  IF p_intent = 'REVOKE' AND p_target_state_id IS NULL THEN
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'TARGET_STATE_REQUIRED';
  END IF;

  v_support := gov_repo.l15_registry_support_parts_v1(p_support_status, p_support_tags, p_support_target_ids);
  IF p_source_class = 'SYSTEM_SEED' AND p_support_status <> 'PRESENT' THEN
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'SYSTEM_SEED_SUPPORT_REQUIRED';
  END IF;
  v_fingerprint := gov_repo.l14_sha256_frame_v1(
    ARRAY['L15_COMMAND_FINGERPRINT_V1', 'SUBMIT_PROPOSAL', v_org::text, v_actor::text, 'RISK_METHODOLOGY', p_intent,
          p_source_class, p_methodology_id::text, p_methodology_version_id::text, p_content_hash]
    || CASE WHEN p_requested_effective_from IS NULL THEN ARRAY['IMMEDIATE']
            ELSE ARRAY['EXPLICIT', gov_repo.l14_canonical_instant_v1(p_requested_effective_from)] END
    || CASE WHEN p_target_state_id IS NULL THEN ARRAY['NO_TARGET_STATE'] ELSE ARRAY['TARGET_STATE', p_target_state_id::text] END
    || CASE WHEN p_prior_proposal_id IS NULL THEN ARRAY['NO_PRIOR_PROPOSAL'] ELSE ARRAY['PRIOR_PROPOSAL', p_prior_proposal_id::text] END
    || v_support);
  IF v_fingerprint IS DISTINCT FROM p_caller_fingerprint THEN
    RAISE EXCEPTION 'L14_FINGERPRINT_MISMATCH' USING ERRCODE = 'GV008', DETAIL = 'CALLER_FINGERPRINT_DIFFERS';
  END IF;

  PERFORM gov_repo.l14_lock_authority_policy_guard_shared_v1(v_org);
  PERFORM gov_repo.l15_lock_registry_subject_guard_v1(v_org, 'RISK_METHODOLOGY',
    'VALIDATION:' || p_methodology_id::text || ':' || p_methodology_version_id::text || ':' || p_content_hash);
  PERFORM gov_repo.l14_lock_command_guard_v1(v_org, p_command_id);
  IF gov_repo.l14_replay_arbitrate_v1(v_org, p_command_id, v_fingerprint) THEN
    PERFORM 1 FROM gov_repo.l14_session_basis_v1(v_org, v_actor, p_verified_session_iat,
      p_verified_session_exp, p_verified_credential_epoch);
    RETURN QUERY SELECT * FROM gov_repo.l15_risk_methodology_command_result_v1(v_org, p_command_id, true);
    RETURN;
  END IF;

  -- Resolution: the exact admitted tuple of THIS organisation, its admission source class (no laundering), the exact
  -- REVOKE target (current VALIDATED state of the same tuple), the correction link, and same-tenant support.
  SELECT v.source_class INTO v_version_source
  FROM gov_repo.l15_risk_methodology_versions AS v
  WHERE v.organisation_id = v_org AND v.methodology_id = p_methodology_id AND v.methodology_version_id = p_methodology_version_id AND v.content_hash = p_content_hash;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'RISK_METHODOLOGY_VERSION_NOT_ADMITTED';
  END IF;
  IF v_version_source IS DISTINCT FROM p_source_class THEN
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'SOURCE_CLASS_LINEAGE_MISMATCH';
  END IF;
  IF p_intent = 'REVOKE' THEN
    SELECT s.state_kind, s.methodology_id, s.methodology_version_id, s.content_hash INTO v_target
    FROM gov_repo.l15_risk_methodology_states AS s WHERE s.organisation_id = v_org AND s.state_id = p_target_state_id;
    IF NOT FOUND OR v_target.methodology_id <> p_methodology_id OR v_target.methodology_version_id <> p_methodology_version_id
       OR v_target.content_hash::text <> p_content_hash THEN
      RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'TARGET_STATE_UNRESOLVED';
    END IF;
    IF v_target.state_kind <> 'VALIDATED' THEN
      RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'TARGET_STATE_NOT_VALIDATED';
    END IF;
    PERFORM 1 FROM gov_repo.l15_risk_methodology_states AS s
    WHERE s.organisation_id = v_org AND s.state_kind = 'REVOKED' AND s.revokes_state_id = p_target_state_id;
    IF FOUND THEN
      RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'TARGET_ALREADY_REVOKED';
    END IF;
    SELECT h.latest_state_id INTO v_latest FROM gov_repo.l15_risk_methodology_heads AS h
    WHERE h.organisation_id = v_org AND h.methodology_id = p_methodology_id AND h.methodology_version_id = p_methodology_version_id;
    IF v_latest IS DISTINCT FROM p_target_state_id THEN
      RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'TARGET_STATE_NOT_CURRENT';
    END IF;
  END IF;
  IF p_prior_proposal_id IS NOT NULL THEN
    PERFORM 1 FROM gov_repo.l15_risk_methodology_proposals AS cp
    WHERE cp.organisation_id = v_org AND cp.proposal_id = p_prior_proposal_id AND cp.methodology_id = p_methodology_id
      AND cp.methodology_version_id = p_methodology_version_id AND cp.content_hash = p_content_hash;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'PRIOR_PROPOSAL_UNRESOLVED';
    END IF;
  END IF;
  PERFORM 1 FROM gov_repo.l15_normalize_support_v1(v_org, p_support_tags, p_support_target_ids);

  v_now := pg_catalog.clock_timestamp();
  INSERT INTO gov_repo.l14_proposals (organisation_id, proposal_id, subject_kind, intent, source_class,
    submitted_by_actor_user_id, prior_proposal_id, support_status, submitted_at)
  VALUES (v_org, v_proposal, 'RISK_METHODOLOGY', p_intent, p_source_class, v_actor, p_prior_proposal_id, p_support_status, v_now);
  INSERT INTO gov_repo.l15_risk_methodology_proposals (organisation_id, proposal_id, intent, methodology_id, methodology_version_id, content_hash,
    requested_effective_from, target_state_id)
  VALUES (v_org, v_proposal, p_intent, p_methodology_id, p_methodology_version_id, p_content_hash, p_requested_effective_from, p_target_state_id);
  PERFORM gov_repo.l15_write_registry_support_links_v1(v_org, 'RISK_METHODOLOGY', 'PROPOSAL', v_proposal, NULL, NULL,
    p_support_tags, p_support_target_ids);
  INSERT INTO gov_repo.l14_command_results (organisation_id, command_id, command_kind, subject_kind,
    command_fingerprint, actor_user_id, outcome, proposal_id, recorded_at)
  VALUES (v_org, p_command_id, 'SUBMIT_PROPOSAL', 'RISK_METHODOLOGY', v_fingerprint, v_actor, 'SUBMITTED', v_proposal, v_now);

  PERFORM 1 FROM gov_repo.l14_session_basis_v1(v_org, v_actor, p_verified_session_iat,
    p_verified_session_exp, p_verified_credential_epoch);
  RETURN QUERY SELECT * FROM gov_repo.l15_risk_methodology_command_result_v1(v_org, p_command_id, false);
END;
$submit$;

-- G3. Governance decision on a RISK_METHODOLOGY proposal. VALIDATE intent: VALIDATE / REJECT / DEFER. REVOKE intent: REVOKE /
--     REJECT / DEFER. DEFER is non-terminal. L15_RISK_METHODOLOGY_VALIDATE governs all four (requested action = the
--     exact outcome). The state belongs to the exact version tuple only; REJECT / DEFER / DENY write no state.
CREATE FUNCTION gov_repo.l15_decide_methodology_proposal_v1(
  p_verified_organisation_id uuid,
  p_verified_actor_user_id uuid,
  p_verified_session_iat bigint,
  p_verified_session_exp bigint,
  p_verified_credential_epoch timestamptz,
  p_command_id text,
  p_proposal_id uuid,
  p_outcome text,
  p_reason_code text,
  p_expected_current_state_id uuid,         -- NULL = explicit expected-none
  p_support_status text,
  p_support_tags text[],
  p_support_target_ids text[],
  p_caller_fingerprint text                 -- assertion only; PostgreSQL recomputes
)
RETURNS TABLE (
  replay boolean, command_id text, command_kind text, subject_kind text, outcome text, command_fingerprint text,
  authorization_decision_id uuid, authorization_result text, deny_reason text, attempted_content_hash text,
  expectation_kind text, expected_latest_version_id uuid, expected_current_state_id uuid, proposal_id uuid,
  governance_decision_id uuid, methodology_id uuid, methodology_version_id uuid, predecessor_version_id uuid, content_hash text,
  state_id uuid, state_kind text, effective_from timestamptz, recorded_at timestamptz
)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp SET lock_timeout = '5s'
AS $decide$
#variable_conflict use_column
DECLARE
  v_org uuid := p_verified_organisation_id;
  v_actor uuid := p_verified_actor_user_id;
  v_role_ids uuid[];
  v_support text[];
  v_fingerprint text;
  v_proposal record;
  v_head_found boolean;
  v_head_latest uuid;
  v_latest_kind text;
  v_latest_from timestamptz;
  v_target_state_id uuid;
  v_has_basis boolean := false;
  v_basis_policy uuid;
  v_basis_version uuid;
  v_basis_hash text;
  v_deny text;
  v_ordinals integer[];
  v_self boolean;
  v_temporal text := 'IMMEDIATE';
  v_effective_from timestamptz;
  v_now timestamptz;
  v_authz uuid := pg_catalog.gen_random_uuid();
  v_decision uuid := pg_catalog.gen_random_uuid();
  v_state uuid := pg_catalog.gen_random_uuid();
  v_state_kind text;
BEGIN
  SELECT b.role_ids INTO v_role_ids
  FROM gov_repo.l14_session_basis_v1(v_org, v_actor, p_verified_session_iat, p_verified_session_exp,
    p_verified_credential_epoch) AS b;

  PERFORM gov_repo.l14_validate_command_id_v1(p_command_id, p_caller_fingerprint);
  IF p_outcome IS NULL OR p_outcome NOT IN ('VALIDATE','REJECT','DEFER','REVOKE')
     OR p_reason_code IS NULL OR p_reason_code NOT IN (
       'RISK_METHODOLOGY_VALIDATED','RISK_METHODOLOGY_REJECTED','RISK_METHODOLOGY_DEFERRED','RISK_METHODOLOGY_REVOKED')
     OR NOT ((p_outcome = 'VALIDATE' AND p_reason_code = 'RISK_METHODOLOGY_VALIDATED')
          OR (p_outcome = 'REJECT' AND p_reason_code = 'RISK_METHODOLOGY_REJECTED')
          OR (p_outcome = 'DEFER' AND p_reason_code = 'RISK_METHODOLOGY_DEFERRED')
          OR (p_outcome = 'REVOKE' AND p_reason_code = 'RISK_METHODOLOGY_REVOKED')) THEN
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'DECISION_VOCABULARY_INVALID';
  END IF;
  -- The immutable proposal defines the command identity; it is the only row read before replay arbitration.
  SELECT p.proposal_id, p.intent, p.source_class, p.submitted_by_actor_user_id,
         t.methodology_id, t.methodology_version_id, t.content_hash::text AS content_hash, t.requested_effective_from, t.target_state_id
  INTO v_proposal
  FROM gov_repo.l14_proposals AS p
  JOIN gov_repo.l15_risk_methodology_proposals AS t ON t.organisation_id = p.organisation_id AND t.proposal_id = p.proposal_id
  WHERE p.organisation_id = v_org AND p.proposal_id = p_proposal_id AND p.subject_kind = 'RISK_METHODOLOGY';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'PROPOSAL_UNRESOLVED';
  END IF;
  IF (p_outcome = 'VALIDATE' AND v_proposal.intent <> 'VALIDATE') OR (p_outcome = 'REVOKE' AND v_proposal.intent <> 'REVOKE') THEN
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'OUTCOME_INTENT_INCOMPATIBLE';
  END IF;

  v_support := gov_repo.l15_registry_support_parts_v1(p_support_status, p_support_tags, p_support_target_ids);
  v_fingerprint := gov_repo.l14_sha256_frame_v1(
    ARRAY['L15_COMMAND_FINGERPRINT_V1', 'DECIDE_PROPOSAL', v_org::text, v_actor::text, p_outcome, p_reason_code,
          v_proposal.proposal_id::text, 'RISK_METHODOLOGY', v_proposal.intent, v_proposal.source_class,
          v_proposal.methodology_id::text, v_proposal.methodology_version_id::text, v_proposal.content_hash]
    || CASE WHEN v_proposal.requested_effective_from IS NULL THEN ARRAY['IMMEDIATE']
            ELSE ARRAY['EXPLICIT', gov_repo.l14_canonical_instant_v1(v_proposal.requested_effective_from)] END
    || CASE WHEN v_proposal.target_state_id IS NULL THEN ARRAY['NO_TARGET_STATE']
            ELSE ARRAY['TARGET_STATE', v_proposal.target_state_id::text] END
    || CASE WHEN p_expected_current_state_id IS NULL THEN ARRAY['EXPECTED_NONE']
            ELSE ARRAY['EXPECTED_CURRENT', p_expected_current_state_id::text] END
    || v_support);
  IF v_fingerprint IS DISTINCT FROM p_caller_fingerprint THEN
    RAISE EXCEPTION 'L14_FINGERPRINT_MISMATCH' USING ERRCODE = 'GV008', DETAIL = 'CALLER_FINGERPRINT_DIFFERS';
  END IF;

  PERFORM gov_repo.l14_lock_authority_policy_guard_shared_v1(v_org);
  PERFORM gov_repo.l15_lock_registry_subject_guard_v1(v_org, 'RISK_METHODOLOGY',
    'VALIDATION:' || v_proposal.methodology_id::text || ':' || v_proposal.methodology_version_id::text || ':' || v_proposal.content_hash);
  PERFORM gov_repo.l14_lock_command_guard_v1(v_org, p_command_id);
  IF gov_repo.l14_replay_arbitrate_v1(v_org, p_command_id, v_fingerprint) THEN
    PERFORM 1 FROM gov_repo.l14_session_basis_v1(v_org, v_actor, p_verified_session_iat,
      p_verified_session_exp, p_verified_credential_epoch);
    RETURN QUERY SELECT * FROM gov_repo.l15_risk_methodology_command_result_v1(v_org, p_command_id, true);
    RETURN;
  END IF;

  -- Resolution under the subject guard: terminality, head expectation, subject rules, support.
  PERFORM 1 FROM gov_repo.l14_governance_decisions AS d
  WHERE d.organisation_id = v_org AND d.proposal_id = p_proposal_id AND d.outcome IN ('VALIDATE','REJECT','REVOKE');
  IF FOUND THEN
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'PROPOSAL_TERMINAL';
  END IF;
  SELECT h.latest_state_id INTO v_head_latest FROM gov_repo.l15_risk_methodology_heads AS h
  WHERE h.organisation_id = v_org AND h.methodology_id = v_proposal.methodology_id AND h.methodology_version_id = v_proposal.methodology_version_id;
  v_head_found := FOUND;
  IF p_expected_current_state_id IS NULL AND v_head_latest IS NOT NULL THEN
    RAISE EXCEPTION 'L15_STALE_EXPECTATION' USING ERRCODE = 'GV009', DETAIL = 'RISK_METHODOLOGY_STATE_EXISTS';
  END IF;
  IF p_expected_current_state_id IS DISTINCT FROM v_head_latest THEN
    RAISE EXCEPTION 'L15_STALE_EXPECTATION' USING ERRCODE = 'GV009', DETAIL = 'RISK_METHODOLOGY_STATE_EXPECTATION_MISMATCH';
  END IF;
  IF v_head_latest IS NOT NULL THEN
    SELECT s.state_kind, s.effective_from INTO v_latest_kind, v_latest_from
    FROM gov_repo.l15_risk_methodology_states AS s WHERE s.organisation_id = v_org AND s.state_id = v_head_latest;
  END IF;
  IF p_outcome = 'VALIDATE' AND v_latest_kind = 'VALIDATED' THEN
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'RISK_METHODOLOGY_ALREADY_VALIDATED';
  END IF;
  IF p_outcome = 'REVOKE' THEN
    PERFORM 1 FROM gov_repo.l15_risk_methodology_states AS s
    WHERE s.organisation_id = v_org AND s.state_kind = 'REVOKED' AND s.revokes_state_id = v_proposal.target_state_id;
    IF FOUND THEN
      RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'TARGET_ALREADY_REVOKED';
    END IF;
    IF v_head_latest IS DISTINCT FROM v_proposal.target_state_id OR v_latest_kind IS DISTINCT FROM 'VALIDATED' THEN
      RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'TARGET_STATE_NOT_CURRENT';
    END IF;
    v_target_state_id := v_proposal.target_state_id;
  END IF;
  PERFORM 1 FROM gov_repo.l15_normalize_support_v1(v_org, p_support_tags, p_support_target_ids);

  -- One DB evaluation instant; temporal class; the CURRENT effective policy is the ONLY basis.
  v_now := pg_catalog.clock_timestamp();
  IF p_outcome IN ('VALIDATE','REVOKE') THEN
    IF v_proposal.requested_effective_from IS NULL THEN
      v_effective_from := v_now;
    ELSIF v_proposal.requested_effective_from < v_now THEN
      v_effective_from := v_proposal.requested_effective_from;
      v_temporal := 'BACKDATED';
    ELSE
      v_effective_from := v_proposal.requested_effective_from;
      v_temporal := 'FUTURE_DATED';
    END IF;
  END IF;
  v_self := v_proposal.submitted_by_actor_user_id = v_actor;
  SELECT b.authority_policy_id, b.version_id, b.content_hash INTO v_basis_policy, v_basis_version, v_basis_hash
  FROM gov_repo.l14_effective_authority_basis_v1(v_org, v_now) AS b;
  v_has_basis := FOUND;
  IF NOT v_has_basis THEN
    v_deny := 'NO_EFFECTIVE_AUTHORITY';
  ELSE
    SELECT e.deny_reason, e.rule_ordinals INTO v_deny, v_ordinals
    FROM gov_repo.l14_evaluate_authority_rules_v1(v_org, v_basis_policy, v_basis_version, v_role_ids,
      gov_repo.l15_governance_permission_v1('RISK_METHODOLOGY', p_outcome), p_outcome, p_outcome = 'VALIDATE' AND v_self, v_temporal) AS e;
  END IF;

  INSERT INTO gov_repo.l14_authorization_decisions (
    organisation_id, authorization_decision_id, command_id, command_fingerprint, actor_user_id,
    requested_action, subject_kind, scope_tag, source_class, proposal_id, is_self_validation,
    authority_basis, basis_authority_policy_id, basis_version_id, basis_content_hash, result, deny_reason,
    evaluated_at, expectation_kind, expected_current_state_id)
  VALUES (
    v_org, v_authz, p_command_id, v_fingerprint, v_actor,
    p_outcome, 'RISK_METHODOLOGY', 'ALL_ALLOWED_TARGETS', v_proposal.source_class, p_proposal_id, v_self,
    CASE WHEN v_has_basis THEN 'AUTHORITY_POLICY_VERSION' END,
    CASE WHEN v_has_basis THEN v_basis_policy END,
    CASE WHEN v_has_basis THEN v_basis_version END,
    CASE WHEN v_has_basis THEN v_basis_hash END,
    CASE WHEN v_deny IS NULL THEN 'ALLOW' ELSE 'DENY' END, v_deny, v_now,
    CASE WHEN p_expected_current_state_id IS NULL THEN 'EXPECTED_NONE' ELSE 'EXPECTED_CURRENT' END,
    p_expected_current_state_id);
  PERFORM gov_repo.l14_snapshot_roles_v1(v_org, v_authz, v_role_ids);
  IF v_has_basis THEN
    PERFORM gov_repo.l14_snapshot_policy_rules_v1(v_org, v_authz, v_basis_policy, v_basis_version, v_ordinals);
  END IF;
  IF v_deny IS NULL THEN
    -- The M17-S0 L15 ALLOW guard (deferred, SECURITY INVOKER) must evaluate HERE, as this owner-pinned definer, now that the
    -- rule snapshot exists: at COMMIT it would run as the committing role (service_role), which has no privilege on the
    -- envelope by design. Firing it immediately keeps its full check (effective-policy L15 rule of the exact mapped
    -- permission + action, AUTHORITY_POLICY_VERSION basis, ACTIVE human of the ACTIVE organisation); then restore DEFERRED.
    SET CONSTRAINTS gov_repo.l15_authorization_decisions_allow_guard IMMEDIATE;
    SET CONSTRAINTS gov_repo.l15_authorization_decisions_allow_guard DEFERRED;
  END IF;

  IF v_deny IS NOT NULL THEN
    -- Durable DENY: authorization + result only; consumes the command id; no decision, no state, no head change.
    INSERT INTO gov_repo.l14_command_results (organisation_id, command_id, command_kind, subject_kind,
      command_fingerprint, actor_user_id, outcome, authorization_decision_id, proposal_id, recorded_at)
    VALUES (v_org, p_command_id, 'DECIDE_PROPOSAL', 'RISK_METHODOLOGY', v_fingerprint, v_actor, 'DENIED', v_authz, p_proposal_id, v_now);
  ELSE
    IF p_outcome = 'REVOKE' AND v_effective_from < v_latest_from THEN
      RAISE EXCEPTION 'L15_CONTINUITY_VIOLATION' USING ERRCODE = 'GV011', DETAIL = 'REVOKE_BEFORE_TARGET_EFFECTIVE';
    END IF;
    IF p_outcome = 'VALIDATE' AND v_latest_kind = 'REVOKED' AND NOT (v_effective_from >= v_latest_from) THEN
      RAISE EXCEPTION 'L15_CONTINUITY_VIOLATION' USING ERRCODE = 'GV011', DETAIL = 'REVALIDATION_OVERLAPS_PRIOR_INTERVAL';
    END IF;
    INSERT INTO gov_repo.l14_governance_decisions (organisation_id, governance_decision_id, proposal_id,
      subject_kind, outcome, reason_code, authorization_decision_id, actor_user_id, support_status, decided_at)
    VALUES (v_org, v_decision, p_proposal_id, 'RISK_METHODOLOGY', p_outcome, p_reason_code, v_authz, v_actor, p_support_status, v_now);
    PERFORM gov_repo.l15_write_registry_support_links_v1(v_org, 'RISK_METHODOLOGY', 'DECISION', NULL, v_decision, NULL,
      p_support_tags, p_support_target_ids);
    IF p_outcome IN ('VALIDATE','REVOKE') THEN
      v_state_kind := CASE WHEN p_outcome = 'VALIDATE' THEN 'VALIDATED' ELSE 'REVOKED' END;
      -- Append-only: predecessor = the expected head state; the target state is never modified.
      INSERT INTO gov_repo.l15_risk_methodology_states (organisation_id, state_id, state_kind, methodology_id, methodology_version_id, content_hash,
        predecessor_state_id, revokes_state_id, effective_from, recorded_at, proposal_id, governance_decision_id,
        authorization_decision_id, authority_policy_id, authority_policy_version_id, authority_policy_content_hash,
        source_class, support_status)
      VALUES (v_org, v_state, v_state_kind, v_proposal.methodology_id, v_proposal.methodology_version_id, v_proposal.content_hash,
        v_head_latest, v_target_state_id, v_effective_from, v_now, p_proposal_id, v_decision, v_authz, v_basis_policy,
        v_basis_version, v_basis_hash, v_proposal.source_class, p_support_status);
      IF NOT v_head_found THEN
        INSERT INTO gov_repo.l15_risk_methodology_heads (organisation_id, methodology_id, methodology_version_id, content_hash, latest_state_id)
        VALUES (v_org, v_proposal.methodology_id, v_proposal.methodology_version_id, v_proposal.content_hash, NULL);
      END IF;
      UPDATE gov_repo.l15_risk_methodology_heads AS h SET latest_state_id = v_state
      WHERE h.organisation_id = v_org AND h.methodology_id = v_proposal.methodology_id AND h.methodology_version_id = v_proposal.methodology_version_id
        AND h.content_hash = v_proposal.content_hash AND h.latest_state_id IS NOT DISTINCT FROM p_expected_current_state_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'L15_STALE_EXPECTATION' USING ERRCODE = 'GV009', DETAIL = 'RISK_METHODOLOGY_STATE_EXPECTATION_MISMATCH';
      END IF;
      PERFORM gov_repo.l15_write_registry_support_links_v1(v_org, 'RISK_METHODOLOGY', 'STATE', NULL, NULL, v_state,
        p_support_tags, p_support_target_ids);
      INSERT INTO gov_repo.l14_command_results (organisation_id, command_id, command_kind, subject_kind,
        command_fingerprint, actor_user_id, outcome, authorization_decision_id, proposal_id, governance_decision_id,
        l15_state_id, recorded_at)
      VALUES (v_org, p_command_id, 'DECIDE_PROPOSAL', 'RISK_METHODOLOGY', v_fingerprint, v_actor, v_state_kind,
        v_authz, p_proposal_id, v_decision, v_state, v_now);
    ELSE
      INSERT INTO gov_repo.l14_command_results (organisation_id, command_id, command_kind, subject_kind,
        command_fingerprint, actor_user_id, outcome, authorization_decision_id, proposal_id, governance_decision_id,
        recorded_at)
      VALUES (v_org, p_command_id, 'DECIDE_PROPOSAL', 'RISK_METHODOLOGY', v_fingerprint, v_actor,
        CASE WHEN p_outcome = 'REJECT' THEN 'REJECTED' ELSE 'DEFERRED' END, v_authz, p_proposal_id, v_decision, v_now);
    END IF;
  END IF;

  PERFORM 1 FROM gov_repo.l14_session_basis_v1(v_org, v_actor, p_verified_session_iat,
    p_verified_session_exp, p_verified_credential_epoch);
  RETURN QUERY SELECT * FROM gov_repo.l15_risk_methodology_command_result_v1(v_org, p_command_id, false);
END;
$decide$;

-- ---------------------------------------------------------------------------------------------------------------------
-- H. Immutability, RLS, privileges, comments. Every history table: ENABLE ALWAYS raising UPDATE / DELETE / TRUNCATE (owner
--    included); FK actions RESTRICT only. The hostile 20260818013113 defaults are revoked; PostgreSQL's PUBLIC EXECUTE on
--    new functions is revoked. Exactly the six registry RPCs are service_role-executable; nothing is granted to the
--    machine intake capability.
-- ---------------------------------------------------------------------------------------------------------------------
DO $immutable$
DECLARE
  v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY['l15_risk_scenario_definitions','l15_risk_scenario_definition_versions','l15_risk_scenario_definition_subject_kinds','l15_risk_scenario_definition_references','l15_risk_scenario_definition_states','l15_risk_scenario_definition_proposals','l15_risk_methodologies','l15_risk_methodology_versions','l15_risk_methodology_likelihood_levels','l15_risk_methodology_impact_levels','l15_risk_methodology_rating_cells','l15_risk_methodology_states','l15_risk_methodology_proposals'] LOOP
    EXECUTE pg_catalog.format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON gov_repo.%I FOR EACH ROW EXECUTE FUNCTION gov_repo.l15_history_immutable_v1()',
      v_table || '_immutable', v_table);
    EXECUTE pg_catalog.format('CREATE TRIGGER %I BEFORE TRUNCATE ON gov_repo.%I FOR EACH STATEMENT EXECUTE FUNCTION gov_repo.l15_history_immutable_v1()',
      v_table || '_no_truncate', v_table);
  END LOOP;
  FOR v_table IN SELECT x FROM pg_catalog.unnest(ARRAY['l15_risk_scenario_definitions','l15_risk_scenario_definition_versions','l15_risk_scenario_definition_subject_kinds','l15_risk_scenario_definition_references','l15_risk_scenario_definition_states','l15_risk_scenario_definition_proposals','l15_risk_scenario_definition_heads','l15_risk_methodologies','l15_risk_methodology_versions','l15_risk_methodology_likelihood_levels','l15_risk_methodology_impact_levels','l15_risk_methodology_rating_cells','l15_risk_methodology_states','l15_risk_methodology_proposals','l15_risk_methodology_heads']) AS x LOOP
    EXECUTE pg_catalog.format('ALTER TABLE gov_repo.%I ENABLE ROW LEVEL SECURITY', v_table);
    EXECUTE pg_catalog.format('REVOKE ALL ON TABLE gov_repo.%I FROM PUBLIC, anon, authenticated, service_role, govia_l15_machine_intake_caller', v_table);
  END LOOP;
END;
$immutable$;
DO $always$
DECLARE
  v_rec record;
BEGIN
  FOR v_rec IN SELECT t.tgrelid::regclass::text AS rel, t.tgname::text AS tg FROM pg_catalog.pg_trigger AS t
      WHERE NOT t.tgisinternal AND t.tgrelid IN (SELECT ('gov_repo.' || x)::regclass FROM pg_catalog.unnest(ARRAY['l15_risk_scenario_definitions','l15_risk_scenario_definition_versions','l15_risk_scenario_definition_subject_kinds','l15_risk_scenario_definition_references','l15_risk_scenario_definition_states','l15_risk_scenario_definition_proposals','l15_risk_scenario_definition_heads','l15_risk_methodologies','l15_risk_methodology_versions','l15_risk_methodology_likelihood_levels','l15_risk_methodology_impact_levels','l15_risk_methodology_rating_cells','l15_risk_methodology_states','l15_risk_methodology_proposals','l15_risk_methodology_heads']) AS x) LOOP
    EXECUTE pg_catalog.format('ALTER TABLE %s ENABLE ALWAYS TRIGGER %I', v_rec.rel, v_rec.tg);
  END LOOP;
END;
$always$;

-- Every routine created or replaced here: no PUBLIC / application / capability EXECUTE, then exactly the six RPCs to
-- service_role.
DO $acl$
DECLARE
  v_fn regprocedure;
BEGIN
  FOR v_fn IN SELECT p.oid::regprocedure FROM pg_catalog.pg_proc AS p
      WHERE p.pronamespace = 'gov_repo'::regnamespace AND p.proname LIKE 'l15\_%' ESCAPE '\'
        AND p.proname NOT IN ('l15_admit_machine_signal_v1','l15_admit_machine_hypothesis_v1','l15_admit_human_signal_v1',
          'l15_admit_human_hypothesis_v1','l15_read_signals_v1','l15_read_hypothesis_dispositions_v1') LOOP
    EXECUTE pg_catalog.format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated, service_role, govia_l15_machine_intake_caller', v_fn);
  END LOOP;
END;
$acl$;
GRANT EXECUTE ON FUNCTION
  gov_repo.l15_admit_scenario_version_v1(uuid,uuid,bigint,bigint,timestamp with time zone,text,uuid,uuid,text,uuid,text,text[],text[],text[],text,text,text),
  gov_repo.l15_submit_scenario_proposal_v1(uuid,uuid,bigint,bigint,timestamp with time zone,text,text,text,uuid,uuid,text,timestamp with time zone,uuid,uuid,text,text[],text[],text),
  gov_repo.l15_decide_scenario_proposal_v1(uuid,uuid,bigint,bigint,timestamp with time zone,text,uuid,text,text,uuid,text,text[],text[],text),
  gov_repo.l15_admit_methodology_version_v1(uuid,uuid,bigint,bigint,timestamp with time zone,text,uuid,uuid,text,uuid,text[],integer[],text[],text[],text[],integer[],text[],text[],text[],text[],text[],interval,text,text,text),
  gov_repo.l15_submit_methodology_proposal_v1(uuid,uuid,bigint,bigint,timestamp with time zone,text,text,text,uuid,uuid,text,timestamp with time zone,uuid,uuid,text,text[],text[],text),
  gov_repo.l15_decide_methodology_proposal_v1(uuid,uuid,bigint,bigint,timestamp with time zone,text,uuid,text,text,uuid,text,text[],text[],text)
TO service_role;

COMMENT ON TABLE gov_repo.l15_risk_scenario_definitions IS 'M17-S2 stable tenant-scoped RISK_SCENARIO_DEFINITION identity: organisation + opaque caller-supplied scenario_definition_id (never derived from a code, domain, scanner rule, CG-AG id, hash or label), created once by its root version under that exact ALLOW / ADMIT authorization. No content; not a canonical kind.';
COMMENT ON TABLE gov_repo.l15_risk_scenario_definition_versions IS 'M17-S2 immutable RISK_SCENARIO_DEFINITION versions: opaque version id (one identity per version id), exactly one of the nine frozen risk domains, PostgreSQL-computed content hash, linear admission lineage, own ADMIT authorization, provenance source class (SYSTEM_SEED is provenance only). ADMITTED is not VALIDATED.';
COMMENT ON TABLE gov_repo.l15_risk_scenario_definition_subject_kinds IS 'M17-S2 normalized non-empty legal subject-kind set of one scenario version (subset of the closed §8.2 domain x subject matrix; REL:<type> tokens for exact relationship-state subjects; no inheritance).';
COMMENT ON TABLE gov_repo.l15_risk_scenario_definition_references IS 'M17-S2 normalized typed reference codes of one scenario version (closed namespace SCANNER_RULE_ID / CG_AG_CONTROL_ID / ORGANISATION_SCENARIO_CODE + bounded code). Descriptive provenance only: never identity, authority, domain, validation or canonical truth.';
COMMENT ON TABLE gov_repo.l15_risk_scenario_definition_states IS 'M17-S2 immutable typed RISK_SCENARIO_DEFINITION state (L15 store; l14_registry_states unused): exact tuple + proposal + governance decision + ALLOW authorization + Authority Policy version/hash + source/support; linear alternating VALIDATED / REVOKED lineage. S3 pins (organisation, state_id, scenario_definition_id, scenario_definition_version_id, content_hash, VALIDATED).';
COMMENT ON TABLE gov_repo.l15_risk_scenario_definition_proposals IS 'M17-S2 immutable typed RISK_SCENARIO_DEFINITION proposal over l14_proposals: the exact admitted tuple, requested_effective_from (NULL = IMMEDIATE), target_state_id (REVOKE only). No content copy, no free text.';
COMMENT ON TABLE gov_repo.l15_risk_scenario_definition_heads IS 'M17-S2 technical validation compare-and-set pointer per exact tuple; RPC-maintained, reconstructible from history, never authority. No latest-scenario-version pointer exists.';
COMMENT ON TABLE gov_repo.l15_risk_methodologies IS 'M17-S2 stable tenant-scoped RISK_METHODOLOGY identity (opaque methodology_id), created once by its root version under that exact ALLOW / ADMIT authorization. No content; no implicit "latest validated methodology".';
COMMENT ON TABLE gov_repo.l15_risk_methodology_versions IS 'M17-S2 immutable RISK_METHODOLOGY versions: opaque version id, positive assessment_validity_maximum (interval; future S4 bound on valid_until - effective_from), PostgreSQL-computed content hash, linear admission lineage, own ADMIT authorization. ADMITTED is not VALIDATED.';
COMMENT ON TABLE gov_repo.l15_risk_methodology_likelihood_levels IS 'M17-S2 ordered closed likelihood scale (2..7 levels, unique code, contiguous ordinal 1..n, typed definition reference). The ordinal is the only numeric L15 column.';
COMMENT ON TABLE gov_repo.l15_risk_methodology_impact_levels IS 'M17-S2 ordered closed impact scale (2..7 levels, unique code, contiguous ordinal 1..n, typed definition reference).';
COMMENT ON TABLE gov_repo.l15_risk_methodology_rating_cells IS 'M17-S2 total rating lookup matrix: exactly one band (LOW / MODERATE / HIGH / CRITICAL) per likelihood x impact level pair of the same version. Lookup only: no product, sum, weight, percentage or score.';
COMMENT ON TABLE gov_repo.l15_risk_methodology_states IS 'M17-S2 immutable typed RISK_METHODOLOGY state (L15 store): exact tuple + proposal + governance decision + ALLOW authorization + Authority Policy version/hash + source/support. S4 pins (organisation, state_id, methodology_id, methodology_version_id, content_hash, VALIDATED).';
COMMENT ON TABLE gov_repo.l15_risk_methodology_proposals IS 'M17-S2 immutable typed RISK_METHODOLOGY proposal over l14_proposals: the exact admitted tuple; no content copy.';
COMMENT ON TABLE gov_repo.l15_risk_methodology_heads IS 'M17-S2 technical validation compare-and-set pointer per exact methodology tuple; never authority.';
COMMENT ON COLUMN gov_repo.l14_command_results.l15_state_id IS 'M17-S2 (D-01 amendment §4, S0-deferred): the exact L15 state id of an L15 registry VALIDATED / REVOKED decision result; NULL for every other result. Never a registry / fact / Authority Policy state.';
COMMENT ON FUNCTION gov_repo.l15_risk_scenario_definition_valid_state_v1(uuid, uuid, uuid, text, timestamptz, timestamptz) IS 'M17-S2 owner-only exact bitemporal RISK_SCENARIO_DEFINITION resolver (the S3 pin): exact VALIDATED, non-revoked state of the exact (organisation, identity, version, content hash) at both coordinates; no row otherwise; ambiguity fails closed; never latest / by code / by label / by domain.';
COMMENT ON FUNCTION gov_repo.l15_risk_methodology_valid_state_v1(uuid, uuid, uuid, text, timestamptz, timestamptz) IS 'M17-S2 owner-only exact bitemporal RISK_METHODOLOGY resolver (the S4 pin): same contract as the scenario resolver.';
COMMENT ON FUNCTION gov_repo.l15_registry_commit_guard_v1() IS 'M17-S2 owner-only deferred registry integrity trigger (SECURITY DEFINER: fires at COMMIT as the committing role, which holds no L15 privilege). Reads only; writes nothing.';

-- ---------------------------------------------------------------------------------------------------------------------
-- I. Postflight over the EFFECTIVE post-S2 catalog (after ALL grants, including the broad legacy defaults).
-- ---------------------------------------------------------------------------------------------------------------------
DO $postflight$
DECLARE
  v_rel text;
  v_count bigint;
  v_hash text;
  v_new_tables CONSTANT text[] := ARRAY['l15_risk_scenario_definitions','l15_risk_scenario_definition_versions','l15_risk_scenario_definition_subject_kinds','l15_risk_scenario_definition_references','l15_risk_scenario_definition_states','l15_risk_scenario_definition_proposals','l15_risk_scenario_definition_heads','l15_risk_methodologies','l15_risk_methodology_versions','l15_risk_methodology_likelihood_levels','l15_risk_methodology_impact_levels','l15_risk_methodology_rating_cells','l15_risk_methodology_states','l15_risk_methodology_proposals','l15_risk_methodology_heads'];
  v_allowed_changed CONSTANT text[] := ARRAY['gov_repo.l14_command_results|l14_command_results_shape_check',
    'gov_repo.l15_support_links|l15_support_links_owner_kind_check', 'gov_repo.l15_support_links|l15_support_links_owner_shape_check',
    'gov_repo.l15_support_links|l15_support_links_owner_target_matrix_check'];
BEGIN
  -- P1. Pre-existing constraints / triggers unchanged except the enumerated additive widenings; new constraints only on
  --     the new L15 tables, the S2 support-link owner columns and the single command-result l15_state_id check.
  IF EXISTS (SELECT 1 FROM m17_s2_constraint_snapshot AS b
             LEFT JOIN (SELECT k.conrelid::regclass::text AS rel, k.conname::text AS conname, pg_catalog.pg_get_constraintdef(k.oid) AS def
                        FROM pg_catalog.pg_constraint AS k JOIN pg_catalog.pg_class AS c ON c.oid = k.conrelid
                        WHERE c.relnamespace = 'gov_repo'::regnamespace) AS a ON a.rel = b.rel AND a.conname = b.conname
             WHERE a.def IS DISTINCT FROM b.def AND (b.rel || '|' || b.conname) <> ALL (v_allowed_changed))
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_constraint AS k JOIN pg_catalog.pg_class AS c ON c.oid = k.conrelid
                WHERE c.relnamespace = 'gov_repo'::regnamespace
                  AND NOT EXISTS (SELECT 1 FROM m17_s2_constraint_snapshot AS b WHERE b.rel = k.conrelid::regclass::text AND b.conname = k.conname::text)
                  AND NOT (c.relname::text = ANY (v_new_tables))
                  AND NOT (c.relname = 'l14_command_results' AND k.conname = 'l14_command_results_l15_state_check')
                  AND NOT (c.relname = 'l15_support_links' AND k.conname IN ('l15_support_links_owner_registry_artifact_check',
                    'l15_support_links_owner_scenario_proposal_fkey','l15_support_links_owner_methodology_proposal_fkey',
                    'l15_support_links_owner_governance_decision_fkey','l15_support_links_owner_scenario_state_fkey',
                    'l15_support_links_owner_methodology_state_fkey')))
     OR EXISTS (SELECT 1 FROM m17_s2_trigger_snapshot AS b
                LEFT JOIN (SELECT t.tgrelid::regclass::text AS rel, t.tgname::text AS tgname, t.tgenabled::text AS enabled,
                                  t.tgfoid::regprocedure::text AS fn
                           FROM pg_catalog.pg_trigger AS t JOIN pg_catalog.pg_class AS c ON c.oid = t.tgrelid
                           WHERE c.relnamespace = 'gov_repo'::regnamespace AND NOT t.tgisinternal) AS a
                  ON a.rel = b.rel AND a.tgname = b.tgname
                WHERE a.enabled IS DISTINCT FROM b.enabled OR a.fn IS DISTINCT FROM b.fn)
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_trigger AS t JOIN pg_catalog.pg_class AS c ON c.oid = t.tgrelid
                WHERE c.relnamespace = 'gov_repo'::regnamespace AND NOT t.tgisinternal
                  AND NOT EXISTS (SELECT 1 FROM m17_s2_trigger_snapshot AS b WHERE b.rel = t.tgrelid::regclass::text AND b.tgname = t.tgname::text)
                  AND NOT (c.relname::text = ANY (v_new_tables))
                  AND NOT (c.relname = 'l14_command_results' AND t.tgname = 'l15_command_results_state_guard')) THEN
    RAISE EXCEPTION 'M17_S2_POSTFLIGHT: a constraint / trigger outside the enumerated S2 surfaces changed or was added';
  END IF;
  -- P2. Every pre-existing L14 / L15 row is byte-identical (M16 history, shared envelope, S1 stores).
  FOR v_rel IN SELECT c.relation FROM m17_s2_row_capture AS c LOOP
    EXECUTE pg_catalog.format(
      'SELECT pg_catalog.count(*), COALESCE(pg_catalog.md5(pg_catalog.string_agg(t::text, %L ORDER BY t::text COLLATE "C")), %L) FROM gov_repo.%I AS t',
      E'\n', 'EMPTY', v_rel) INTO v_count, v_hash;
    -- Widened tables gain trailing NULL columns; compare their pre-existing columns only.
    IF v_rel = 'l14_command_results' THEN
      SELECT pg_catalog.count(*), COALESCE(pg_catalog.md5(pg_catalog.string_agg(t::text, E'\n' ORDER BY t::text COLLATE "C")), 'EMPTY')
      INTO v_count, v_hash
      FROM (SELECT x.organisation_id, x.command_id, x.command_kind, x.command_fingerprint, x.actor_user_id, x.outcome,
                   x.authorization_decision_id, x.proposal_id, x.governance_decision_id, x.authority_policy_id, x.version_id,
                   x.state_id, x.recorded_at, x.subject_kind, x.registry_state_id, x.fact_state_id
            FROM gov_repo.l14_command_results AS x) AS t;
    ELSIF v_rel = 'l15_support_links' THEN
      SELECT pg_catalog.count(*), COALESCE(pg_catalog.md5(pg_catalog.string_agg(t::text, E'\n' ORDER BY t::text COLLATE "C")), 'EMPTY')
      INTO v_count, v_hash
      FROM (SELECT x.organisation_id, x.link_id, x.owner_kind, x.owner_signal_id, x.owner_signal_kind, x.owner_hypothesis_id,
                   x.target_tag, x.target_discovery_evidence_id, x.target_source_assertion_id, x.target_runtime_observation_id,
                   x.target_cross_signal_comparison_id, x.target_execution_field_state_id, x.target_technical_field_state_id,
                   x.target_lineage_observation_finding_id, x.target_l14_fact_state_id, x.target_l14_fact_subject_kind,
                   x.target_risk_signal_id, x.target_risk_hypothesis_id, x.recorded_at
            FROM gov_repo.l15_support_links AS x) AS t;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM m17_s2_row_capture AS c WHERE c.relation = v_rel AND c.row_count = v_count AND c.row_hash = v_hash) THEN
      RAISE EXCEPTION 'M17_S2_POSTFLIGHT: rows of % changed', v_rel;
    END IF;
  END LOOP;
  -- P3. Frozen vocabularies: five M16 fact families, l14_registry_states / l14_support_links untouched (covered by P1),
  --     11 canonical kinds, 12 relationship types; F2 has no trigger.
  IF (SELECT pg_catalog.array_agg(m.v[1] ORDER BY m.v[1] COLLATE "C") FROM pg_catalog.pg_constraint AS k
      CROSS JOIN LATERAL pg_catalog.regexp_matches(pg_catalog.pg_get_constraintdef(k.oid), '''([A-Z_]+)''', 'g') AS m(v)
      WHERE k.conrelid = 'gov_repo.l14_fact_states'::regclass AND k.conname = 'l14_fact_states_subject_kind_check')
     IS DISTINCT FROM ARRAY['BUSINESS_CONTEXT_ASSIGNMENT','CONTROL_APPLICABILITY','CONTROL_ASSESSMENT','POLICY_APPLICABILITY','RESPONSIBILITY_ASSIGNMENT']
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_trigger AS t WHERE t.tgrelid = 'gov_repo.canonical_relationships'::regclass AND NOT t.tgisinternal)
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_constraint AS k JOIN pg_catalog.pg_class AS c ON c.oid = k.conrelid
                WHERE k.confrelid = 'gov_repo.canonical_relationships'::regclass AND c.relname LIKE 'l15\_%' ESCAPE '\') THEN
    RAISE EXCEPTION 'M17_S2_POSTFLIGHT: M16 families / F2 changed';
  END IF;
  -- P4. ACL: no application role or the capability holds any privilege on any new table; every L15 routine search_path
  --     pinned; the definer surface grew by exactly the six RPCs (49 -> 55) + one owner-only trigger fn (L15 7 -> 14).
  IF EXISTS (SELECT 1 FROM pg_catalog.unnest(v_new_tables) AS x(t)
             CROSS JOIN pg_catalog.unnest(ARRAY['service_role','authenticated','anon','govia_l15_machine_intake_caller']) AS r(role)
             CROSS JOIN pg_catalog.unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN']) AS p(pr)
             WHERE pg_catalog.has_table_privilege(r.role, ('gov_repo.' || x.t)::regclass, p.pr)
                OR pg_catalog.has_any_column_privilege(r.role, ('gov_repo.' || x.t)::regclass, 'SELECT, INSERT, UPDATE, REFERENCES'))
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_proc AS p WHERE p.pronamespace = 'gov_repo'::regnamespace AND p.proname LIKE 'l15\_%' ESCAPE '\'
                AND (pg_catalog.pg_get_userbyid(p.proowner) <> 'postgres'
                     OR NOT EXISTS (SELECT 1 FROM pg_catalog.unnest(COALESCE(p.proconfig, ARRAY[]::text[])) AS c(v) WHERE c.v = 'search_path=pg_catalog, pg_temp')
                     OR EXISTS (SELECT 1 FROM pg_catalog.aclexplode(COALESCE(p.proacl, pg_catalog.acldefault('f', p.proowner))) AS a WHERE a.grantee = 0)
                     OR pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE')
                     OR pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE')))
     OR (SELECT pg_catalog.count(*) FROM pg_catalog.pg_proc AS p WHERE p.pronamespace = 'gov_repo'::regnamespace AND p.proname LIKE 'l15\_%' ESCAPE '\'
         AND pg_catalog.has_function_privilege('service_role', p.oid, 'EXECUTE')) <> 10
     OR (SELECT pg_catalog.count(*) FROM pg_catalog.pg_proc AS p WHERE p.pronamespace = 'gov_repo'::regnamespace AND p.proname LIKE 'l15\_%' ESCAPE '\'
         AND p.prosecdef) <> 14
     OR (SELECT pg_catalog.array_agg(p.proname::text ORDER BY p.proname::text COLLATE "C") FROM pg_catalog.pg_proc AS p
         WHERE p.pronamespace = 'gov_repo'::regnamespace AND pg_catalog.has_function_privilege('govia_l15_machine_intake_caller', p.oid, 'EXECUTE'))
        IS DISTINCT FROM ARRAY['l15_admit_machine_hypothesis_v1','l15_admit_machine_signal_v1']
     OR (SELECT pg_catalog.count(*) FROM pg_catalog.pg_proc AS p
         WHERE p.prosecdef AND p.pronamespace NOT IN ('pg_catalog'::regnamespace, 'information_schema'::regnamespace)
           AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_depend AS d WHERE d.classid = 'pg_catalog.pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e')
           AND (pg_catalog.has_function_privilege('service_role', p.oid, 'EXECUTE')
                OR pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE')
                OR pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE')
                OR EXISTS (SELECT 1 FROM pg_catalog.aclexplode(COALESCE(p.proacl, pg_catalog.acldefault('f', p.proowner))) AS a
                            WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE'))) <> 55 THEN
    RAISE EXCEPTION 'M17_S2_POSTFLIGHT: ACL / definer surface violated';
  END IF;
  -- P5. The six RPC bodies never reach the M16 policy-content stores or any l14 typed registry / fact store.
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_proc AS p WHERE p.pronamespace = 'gov_repo'::regnamespace AND p.proname ~ '^l15_(admit_(scenario|methodology)|submit_|decide_|risk_|registry_|lock_registry|command_result|write_registry|scenario_|methodology_|assessment_)'
             AND p.prosrc ~ '(governance_policies|policy_versions|l14_registry_states|l14_fact_states|l14_support_links|l14_control_definition)') THEN
    RAISE EXCEPTION 'M17_S2_POSTFLIGHT: an L15 routine reaches an M16 policy / registry / fact store';
  END IF;
  -- P6. Every existing machine-intake LOGIN still satisfies the closed S1R1 surface (S2 granted it nothing).
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members AS m JOIN pg_catalog.pg_roles AS r ON r.oid = m.member
             WHERE m.roleid = 'govia_l15_machine_intake_caller'::regrole AND r.rolcanlogin AND r.rolname <> 'postgres'
               AND NOT gov_repo.l15_machine_role_safe_v1(r.oid, r.rolname::text)) THEN
    RAISE EXCEPTION 'M17_S2_POSTFLIGHT: a machine intake LOGIN is no longer on its closed S1R1 surface';
  END IF;
  -- P7. Definer-capability inventory: each of the seven new L15 SECURITY DEFINER routines has its exact owner, body SHA-256
  --     and config (any later change requires re-review of this inventory and of the test inventory).
  IF (SELECT pg_catalog.count(*) FROM (VALUES
      ('gov_repo.l15_admit_methodology_version_v1(uuid,uuid,bigint,bigint,timestamp with time zone,text,uuid,uuid,text,uuid,text[],integer[],text[],text[],text[],integer[],text[],text[],text[],text[],text[],interval,text,text,text)', '3641a97407bd75c4a066a34c5f648201e2df1765813166b6d5bbe98e7aa3e1c4', 'search_path=pg_catalog, pg_temp;lock_timeout=5s'),
      ('gov_repo.l15_admit_scenario_version_v1(uuid,uuid,bigint,bigint,timestamp with time zone,text,uuid,uuid,text,uuid,text,text[],text[],text[],text,text,text)', 'c45547e09b4d3729b4a146aef750a4835e90223a8efe17425c7aecfccdfc26cf', 'search_path=pg_catalog, pg_temp;lock_timeout=5s'),
      ('gov_repo.l15_decide_methodology_proposal_v1(uuid,uuid,bigint,bigint,timestamp with time zone,text,uuid,text,text,uuid,text,text[],text[],text)', 'faced910a33bbcb7b7f38531f227abfbef5c96a7b866555f9898d6b343e15172', 'search_path=pg_catalog, pg_temp;lock_timeout=5s'),
      ('gov_repo.l15_decide_scenario_proposal_v1(uuid,uuid,bigint,bigint,timestamp with time zone,text,uuid,text,text,uuid,text,text[],text[],text)', '16abef1bfb329985ebdbe117525af6dd36346a3385b95dec5c8e9284e2c50c7d', 'search_path=pg_catalog, pg_temp;lock_timeout=5s'),
      ('gov_repo.l15_submit_methodology_proposal_v1(uuid,uuid,bigint,bigint,timestamp with time zone,text,text,text,uuid,uuid,text,timestamp with time zone,uuid,uuid,text,text[],text[],text)', 'd76e90dad660e532f3cb9f1b359710191257f28c85f53f79175077bb2c8bfc1a', 'search_path=pg_catalog, pg_temp;lock_timeout=5s'),
      ('gov_repo.l15_submit_scenario_proposal_v1(uuid,uuid,bigint,bigint,timestamp with time zone,text,text,text,uuid,uuid,text,timestamp with time zone,uuid,uuid,text,text[],text[],text)', 'bc7bb094235d241f2893ddf00d14593dfaba5379f319c6357fa34e98330becad', 'search_path=pg_catalog, pg_temp;lock_timeout=5s'),
      ('gov_repo.l15_registry_commit_guard_v1()', 'fd7fc610a3659d2efcc552f1c934b341d1b235b1edfa6eea391871837c6d196d', 'search_path=pg_catalog, pg_temp')) AS m(sig, sha, cfg)
      JOIN pg_catalog.pg_proc AS p ON p.oid = pg_catalog.to_regprocedure(m.sig)
      WHERE p.prosecdef AND pg_catalog.pg_get_userbyid(p.proowner) = 'postgres'
        AND pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p.prosrc, 'UTF8')), 'hex') = m.sha
        AND COALESCE(pg_catalog.array_to_string(p.proconfig, ';'), '-') = m.cfg) <> 7 THEN
    RAISE EXCEPTION 'M17_S2_POSTFLIGHT: an S2 definer differs from its inventory (owner / body / config)';
  END IF;
END;
$postflight$;

COMMIT;
