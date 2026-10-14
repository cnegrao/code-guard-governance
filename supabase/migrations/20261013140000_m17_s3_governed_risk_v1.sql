-- M17-S3: GOVERNED_RISK — the first L15 authoritative fact family (DB only, ADDITIVE).
-- Architecture (ACCEPTED / FROZEN, not modified): docs/architecture/ADR-GOVIA-RISK-INTELLIGENCE-v1.md §§6, 8, 9.2, 11-13,
-- 16-19, 24, 26 (O22-O30, O44; inherited O01, O02, O04-O07, O13, O14, O19, O21, O53-O66, O73-O82, O84-O91);
-- docs/architecture/ADR-GOVIA-M16-AUTHORITY-POLICY-M17-EXTENSION-v1.md (D-01) §4 (the command-result L15 decision branch,
-- widened from the two registries to GOVERNED_RISK). Additive only; no historical migration edited. Never run against a
-- hosted DB from this slice.
--
-- Meaning: a GOVERNED_RISK state is the authoritative organisation-local statement that an exact VALIDATED risk scenario
-- version applies to ONE exact subject, established only by an explicit authorized human governance decision. It is an L15
-- fact: NOT a canonical object (no RISK kind), NOT a governed relationship (no HAS_RISK / MITIGATES / IMPACTS_RISK), NOT a
-- score, NOT a hypothesis, NOT a graph projection. 11 canonical kinds / 12 relationship types / F2 untouched.
--   * Logical key = organisation + exact subject + stable scenario_definition_id (NEVER the version id). One technical
--     head (compare-and-set pointer, never authority) per key. Each immutable state pins the exact scenario version id +
--     PostgreSQL content hash + the exact VALIDATED scenario registry state it was decided against. A newer scenario version
--     never repins a risk: only an explicit, authorized successor VALIDATE (same key, other version) does.
--   * Subject = closed typed union: CANONICAL_OBJECT (organisation + id + declared kind, one of AGENT, AGENT_VERSION, MODEL,
--     TOOL, MCP_SERVER, API, DATA_ASSET, DATA_ELEMENT; composite FK onto canonical_objects) or RELATIONSHIP_STATE (organisation +
--     relationship_id + relationship_state_id, resolved ONLY by the existing exact M16 F2 triple helper; 0 = unresolved,
--     > 1 = fail closed; the type is DB-resolved; no FK / uniqueness / trigger onto canonical_relationships). PROMPT /
--     KNOWLEDGE_BASE / SKILL are not direct subjects. No inheritance of any kind.
--   * The risk domain is never supplied: it is the frozen domain of the pinned scenario version (FK onto the version's
--     (version, domain) key); the S2 closed §8.2 matrix (l15_risk_domain_subject_legal_v1) is a DB CHECK on every proposal /
--     state, and the subject token must be one of the scenario version's own declared subject kinds (FK).
--   * States VALIDATED / REVOKED only (append-only lineage, optional authorized immutable effective_to as in the M16 fact
--     families). REJECT / DEFER / DENY write no state. Closure ONLY through an explicit REVOKE of the exact current
--     VALIDATED state, carrying exactly one typed closure_reason (closed L15 field; the shared reason code stays
--     GOVERNED_RISK_REVOKED). No score / likelihood / impact / rating / title / description / rationale column exists.
--   * Authority: L15_GOVERNED_RISK_VALIDATE (requested action = the exact outcome) over the CURRENT effective Authority
--     Policy and the actor's CURRENT persisted roles, typed scope evaluated against the exact subject (the existing M16 object
--     / relationship-state evaluators, unchanged); no domain- or rating-conditioned authority; no bootstrap; self-validation
--     fail-closed unless the policy explicitly allows it. The S2R1 root ALLOW guard runs naturally at COMMIT: these RPCs
--     never issue SET CONSTRAINTS.
--   * Proposal submission: verified ACTIVE same-tenant human (LOCAL_HUMAN) only. SYSTEM_SEED is structurally impossible.
--     SOURCE_CONNECTION is admitted by the frozen ADR only as bounded imported intake; no SOURCE_CONNECTION intake identity
--     exists in this repository (M19), so it is NOT executable here (SOURCE_CLASS_NOT_EXECUTABLE). The machine intake
--     capability is granted nothing.
--   * l15_support_links widened additively with the GOVERNED_RISK rank-3 owners (PROPOSAL / DECISION / STATE; typed owner
--     columns, same-tenant composite FKs) -> RISK_HYPOTHESIS, RISK_SIGNAL and every rank-0 tag. No L15 governed artifact is
--     ever a target (acyclic). S1 / S2 owners, rows and rules unchanged.
--   * Owner-only exact bitemporal resolver (S4 / S5 dependency contract) and the O44 support-currency projection
--     (SUPPORT_CURRENT / SUPPORT_DEGRADED / SUPPORT_NONE, naming the exact failing link), which reads M16 only through the
--     existing owner-only exact M16 resolvers and never writes anything.
--
-- Sections: A preflight + capture; B owner-only helpers; C tables; D l15_support_links / l14_command_results additive
-- widening; E guards; F resolver, support currency, result projection; G RPCs; H immutability, privileges, comments;
-- I postflight.
BEGIN;

-- ---------------------------------------------------------------------------------------------------------------------
-- A. Preflight: exactly the post-M17-S2R1 catalog, or abort with nothing applied.
-- ---------------------------------------------------------------------------------------------------------------------
DO $preflight$
BEGIN
  IF pg_catalog.current_setting('server_version_num')::integer NOT BETWEEN 170000 AND 179999 OR current_user <> 'postgres'
     OR pg_catalog.current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'M17_S3_PREFLIGHT: PostgreSQL 17 / postgres / READ COMMITTED required' USING ERRCODE = '55000';
  END IF;
  IF (SELECT pg_catalog.count(*) FROM pg_catalog.pg_class AS c
      WHERE c.relnamespace = 'gov_repo'::regnamespace AND c.relname LIKE 'l15\_%' ESCAPE '\' AND c.relkind IN ('r','p')) <> 18
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_class AS c WHERE c.relnamespace = 'gov_repo'::regnamespace
                AND c.relname LIKE 'l15\_governed\_risk%' ESCAPE '\')
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_proc AS p WHERE p.pronamespace = 'gov_repo'::regnamespace
                AND p.proname ~ '^l15_(.*governed_risk|risk_subject)')
     OR pg_catalog.to_regprocedure('gov_repo.l15_risk_scenario_definition_valid_state_v1(uuid,uuid,uuid,text,timestamptz,timestamptz)') IS NULL
     OR pg_catalog.to_regprocedure('gov_repo.l14_resolve_relationship_state_target_v1(uuid,text,text)') IS NULL
     OR pg_catalog.to_regprocedure('gov_repo.l14_evaluate_target_authority_rules_v1(uuid,uuid,uuid,uuid[],text,text,boolean,text,text,text)') IS NULL
     OR pg_catalog.to_regprocedure('gov_repo.l14_evaluate_relationship_state_authority_rules_v1(uuid,uuid,uuid,uuid[],text,text,boolean,text,text,text,text)') IS NULL
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attribute AS a WHERE a.attrelid = 'gov_repo.l14_command_results'::regclass
                    AND a.attname = 'l15_state_id' AND NOT a.attisdropped) THEN
    RAISE EXCEPTION 'M17_S3_PREFLIGHT: the post-M17-S2R1 catalog is required (an S3 object exists or an S2 object is missing)' USING ERRCODE = '55000';
  END IF;
  -- The S2R1 root ALLOW guard is an owner-only SECURITY DEFINER with the byte-identical S0 body (S3 RPCs rely on it
  -- running naturally at COMMIT and never issue SET CONSTRAINTS).
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc AS p WHERE p.oid = 'gov_repo.l15_authorization_allow_guard_v1()'::regprocedure
                   AND p.prosecdef AND pg_catalog.pg_get_userbyid(p.proowner) = 'postgres'
                   AND pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p.prosrc, 'UTF8')), 'hex')
                       = 'ee7885662da87a4946ad06596dbcd9f1af9bbb52de0e86fb7b16fd17731b5236'
                   AND NOT pg_catalog.has_function_privilege('service_role', p.oid, 'EXECUTE')) THEN
    RAISE EXCEPTION 'M17_S3_PREFLIGHT: the S2R1 root ALLOW guard is not the owner-only SECURITY DEFINER' USING ERRCODE = '55000';
  END IF;
  IF (SELECT pg_catalog.count(*) FROM pg_catalog.pg_proc AS p
       WHERE p.prosecdef AND p.pronamespace NOT IN ('pg_catalog'::regnamespace, 'information_schema'::regnamespace)
         AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_depend AS d
                          WHERE d.classid = 'pg_catalog.pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e')
         AND (pg_catalog.has_function_privilege('service_role', p.oid, 'EXECUTE')
              OR pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE')
              OR pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE')
              OR EXISTS (SELECT 1 FROM pg_catalog.aclexplode(COALESCE(p.proacl, pg_catalog.acldefault('f', p.proowner))) AS a
                          WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE'))) <> 55
     OR (SELECT pg_catalog.count(*) FROM pg_catalog.pg_proc AS p WHERE p.pronamespace = 'gov_repo'::regnamespace
         AND p.proname LIKE 'l15\_%' ESCAPE '\' AND p.prosecdef) <> 15
     OR (SELECT pg_catalog.array_agg(p.proname::text ORDER BY p.proname::text COLLATE "C") FROM pg_catalog.pg_proc AS p
         WHERE p.pronamespace = 'gov_repo'::regnamespace AND pg_catalog.has_function_privilege('govia_l15_machine_intake_caller', p.oid, 'EXECUTE'))
        IS DISTINCT FROM ARRAY['l15_admit_machine_hypothesis_v1','l15_admit_machine_signal_v1'] THEN
    RAISE EXCEPTION 'M17_S3_PREFLIGHT: definer surface is not the post-S2R1 baseline (55 application / 15 L15 / 2 intake)' USING ERRCODE = '55000';
  END IF;
  IF gov_repo.l15_governance_permission_v1('GOVERNED_RISK', 'VALIDATE') IS DISTINCT FROM 'L15_GOVERNED_RISK_VALIDATE'
     OR gov_repo.l15_governance_permission_v1('GOVERNED_RISK', 'REVOKE') IS DISTINCT FROM 'L15_GOVERNED_RISK_VALIDATE'
     OR gov_repo.l15_governance_permission_v1('GOVERNED_RISK', 'ADMIT') IS NOT NULL
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint AS k WHERE k.conrelid = 'gov_repo.l14_authorization_decisions'::regclass
                      AND k.conname = 'l14_authorization_decisions_l15_risk_target_check')
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint AS k WHERE k.conrelid = 'gov_repo.l15_risk_scenario_definition_states'::regclass
                      AND k.conname = 'l15_risk_scenario_definition_states_kind_unique' AND k.contype = 'u')
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint AS k WHERE k.conrelid = 'gov_repo.l15_risk_scenario_definition_versions'::regclass
                      AND k.conname = 'l15_risk_scenario_definition_versions_domain_unique' AND k.contype = 'u') THEN
    RAISE EXCEPTION 'M17_S3_PREFLIGHT: the D-01 / S2 keys differ from the inspected catalog' USING ERRCODE = '55000';
  END IF;
  -- No GOVERNED_RISK governance history may pre-exist (nothing before S3 could write any).
  IF EXISTS (SELECT 1 FROM gov_repo.l14_proposals AS p WHERE p.subject_kind = 'GOVERNED_RISK')
     OR EXISTS (SELECT 1 FROM gov_repo.l14_authorization_decisions AS a WHERE a.subject_kind = 'GOVERNED_RISK')
     OR EXISTS (SELECT 1 FROM gov_repo.l14_governance_decisions AS d WHERE d.subject_kind = 'GOVERNED_RISK')
     OR EXISTS (SELECT 1 FROM gov_repo.l14_command_results AS c WHERE c.subject_kind = 'GOVERNED_RISK') THEN
    RAISE EXCEPTION 'M17_S3_PREFLIGHT: GOVERNED_RISK governance history already exists' USING ERRCODE = '55000';
  END IF;
END;
$preflight$;

CREATE TEMPORARY TABLE m17_s3_constraint_snapshot ON COMMIT DROP AS
  SELECT k.conrelid::regclass::text AS rel, k.conname::text AS conname, pg_catalog.pg_get_constraintdef(k.oid) AS def
  FROM pg_catalog.pg_constraint AS k JOIN pg_catalog.pg_class AS c ON c.oid = k.conrelid
  WHERE c.relnamespace = 'gov_repo'::regnamespace;
CREATE TEMPORARY TABLE m17_s3_trigger_snapshot ON COMMIT DROP AS
  SELECT t.tgrelid::regclass::text AS rel, t.tgname::text AS tgname, t.tgenabled::text AS enabled, t.tgfoid::regprocedure::text AS fn
  FROM pg_catalog.pg_trigger AS t JOIN pg_catalog.pg_class AS c ON c.oid = t.tgrelid
  WHERE c.relnamespace = 'gov_repo'::regnamespace AND NOT t.tgisinternal;
CREATE TEMPORARY TABLE m17_s3_routine_snapshot ON COMMIT DROP AS
  SELECT p.oid::regprocedure::text AS sig, pg_catalog.md5(p.prosrc) AS body, p.prosecdef AS definer,
         COALESCE(pg_catalog.array_to_string(p.proconfig, ';'), '-') AS cfg, COALESCE(p.proacl::text, '-') AS acl
  FROM pg_catalog.pg_proc AS p WHERE p.pronamespace = 'gov_repo'::regnamespace;
CREATE TEMPORARY TABLE m17_s3_row_capture (relation text PRIMARY KEY, row_count bigint NOT NULL, row_hash text NOT NULL) ON COMMIT DROP;
DO $capture$
DECLARE
  v_rel text;
  v_count bigint;
  v_hash text;
BEGIN
  FOR v_rel IN SELECT c.relname::text FROM pg_catalog.pg_class AS c
               WHERE c.relnamespace = 'gov_repo'::regnamespace AND c.relkind = 'r'
                 AND (c.relname LIKE 'l14\_%' ESCAPE '\' OR c.relname LIKE 'l15\_%' ESCAPE '\'
                      OR c.relname IN ('canonical_objects','canonical_relationships')) LOOP
    EXECUTE pg_catalog.format(
      'SELECT pg_catalog.count(*), COALESCE(pg_catalog.md5(pg_catalog.string_agg(t::text, %L ORDER BY t::text COLLATE "C")), %L) FROM gov_repo.%I AS t',
      E'\n', 'EMPTY', v_rel) INTO v_count, v_hash;
    INSERT INTO m17_s3_row_capture (relation, row_count, row_hash) VALUES (v_rel, v_count, v_hash);
  END LOOP;
END;
$capture$;

-- ---------------------------------------------------------------------------------------------------------------------
-- B. Owner-only helpers (SECURITY INVOKER; EXECUTE revoked from every application role and the capability).
-- ---------------------------------------------------------------------------------------------------------------------
-- Injective exact subject-key encoder of the closed subject union (same length-prefixed, branch-tagged framing as the M16
-- target key). NULL for any hybrid / partial / non-subject shape, so an illegal shape can never obtain a key.
CREATE FUNCTION gov_repo.l15_risk_subject_key_v1(
  p_subject_type text, p_canonical_kind text, p_canonical_object_id text, p_relationship_id text, p_relationship_state_id text)
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = pg_catalog, pg_temp AS $fn$
  SELECT CASE
    WHEN p_subject_type = 'CANONICAL_OBJECT' AND p_canonical_kind IN ('AGENT','AGENT_VERSION','MODEL','TOOL','MCP_SERVER','API','DATA_ASSET','DATA_ELEMENT')
         AND p_canonical_object_id IS NOT NULL AND p_relationship_id IS NULL AND p_relationship_state_id IS NULL
      THEN 'CANONICAL_OBJECT|' || pg_catalog.length(p_canonical_kind)::text || ':' || p_canonical_kind
           || '|' || pg_catalog.length(p_canonical_object_id)::text || ':' || p_canonical_object_id
    WHEN p_subject_type = 'RELATIONSHIP_STATE' AND p_canonical_kind IS NULL AND p_canonical_object_id IS NULL
         AND p_relationship_id IS NOT NULL AND p_relationship_state_id IS NOT NULL
      THEN 'RELATIONSHIP_STATE|' || pg_catalog.length(p_relationship_id)::text || ':' || p_relationship_id
           || '|' || pg_catalog.length(p_relationship_state_id)::text || ':' || p_relationship_state_id
  END
$fn$;

-- The §8.2 subject token of an exact subject: the object kind, or REL:<DB-resolved relationship type>.
CREATE FUNCTION gov_repo.l15_risk_subject_token_v1(p_subject_type text, p_canonical_kind text, p_relationship_type text)
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = pg_catalog, pg_temp AS $fn$
  SELECT CASE WHEN p_subject_type = 'CANONICAL_OBJECT' THEN p_canonical_kind
              WHEN p_subject_type = 'RELATIONSHIP_STATE' AND p_relationship_type IS NOT NULL THEN 'REL:' || p_relationship_type END
$fn$;

-- EXCLUSIVE per-logical-key guard (organisation + exact subject key + stable scenario definition id), framed with the
-- repository's length-prefixed frame_identity. Serializes first / successor / REVOKE decisions of one key.
CREATE FUNCTION gov_repo.l15_lock_governed_risk_key_guard_v1(p_organisation_id uuid, p_subject_key text, p_scenario_definition_id uuid)
RETURNS void LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, pg_temp AS $guard$
BEGIN
  IF p_organisation_id IS NULL OR p_subject_key IS NULL OR pg_catalog.length(p_subject_key) NOT BETWEEN 1 AND 1100
     OR p_scenario_definition_id IS NULL THEN
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'GUARD_KEY_INVALID';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    gov_repo.frame_identity(ARRAY[p_organisation_id::text, 'l15-governed-risk-key-guard-v1', p_subject_key,
                                  p_scenario_definition_id::text]), 0));
END;
$guard$;

-- SHARED mode of the EXACT S2 registry subject guard key of one RISK_SCENARIO_DEFINITION version tuple
-- (frame_identity([organisation, 'l15-registry-subject-guard-v1', 'RISK_SCENARIO_DEFINITION', 'VALIDATION:' || id || ':' ||
-- version || ':' || hash]) — byte-identical to the key the S2 SUBMIT / DECIDE RPCs take EXCLUSIVELY). A governed-risk
-- VALIDATE pinning that tuple serializes deterministically with every scenario decision on it (a revocation committed first
-- is seen; one waiting behind commits after and invalidates the risk through the resolver). Held to commit.
CREATE FUNCTION gov_repo.l15_lock_scenario_dependency_guard_shared_v1(
  p_organisation_id uuid, p_scenario_definition_id uuid, p_scenario_definition_version_id uuid, p_content_hash text)
RETURNS void LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, pg_temp AS $guard$
BEGIN
  IF p_organisation_id IS NULL OR p_scenario_definition_id IS NULL OR p_scenario_definition_version_id IS NULL
     OR p_content_hash IS NULL OR p_content_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'GUARD_KEY_INVALID';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock_shared(pg_catalog.hashtextextended(
    gov_repo.frame_identity(ARRAY[p_organisation_id::text, 'l15-registry-subject-guard-v1', 'RISK_SCENARIO_DEFINITION',
      'VALIDATION:' || p_scenario_definition_id::text || ':' || p_scenario_definition_version_id::text || ':' || p_content_hash]), 0));
END;
$guard$;

-- Syntactic GOVERNED_RISK support (no table read): NONE = zero entries, PRESENT = 1..64 distinct (tag, id) entries of the
-- closed union. Every one of the ten tags is admissible for a rank-3 GOVERNED_RISK owner (§9.2: RISK_HYPOTHESIS,
-- RISK_SIGNAL, all rank-0 tags); no L15 governed artifact is a tag. Returns the order-independent fingerprint parts.
CREATE FUNCTION gov_repo.l15_governed_risk_support_parts_v1(p_support_status text, p_tags text[], p_ids text[])
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
  IF (SELECT pg_catalog.count(DISTINCT (s.tg, s.id)) FROM ROWS FROM (pg_catalog.unnest(p_tags), pg_catalog.unnest(p_ids)) AS s(tg, id)) <> v_n THEN
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'SUPPORT_DUPLICATE';
  END IF;
  RETURN ARRAY['SUPPORT', p_support_status, v_n::text]
    || COALESCE((SELECT pg_catalog.array_agg(x.part ORDER BY pg_catalog.convert_to(s.tg, 'UTF8'), pg_catalog.convert_to(s.id, 'UTF8'), x.k)
                 FROM ROWS FROM (pg_catalog.unnest(p_tags), pg_catalog.unnest(p_ids)) AS s(tg, id)
                 CROSS JOIN LATERAL (VALUES (1, s.tg), (2, s.id)) AS x(k, part)), ARRAY[]::text[]);
END;
$fn$;

-- Syntactic subject check (no table read): the closed union, the legal V1 object kinds (PROMPT / KNOWLEDGE_BASE / SKILL are
-- not direct subjects), bounded operands. Returns the exact subject key.
CREATE FUNCTION gov_repo.l15_risk_subject_shape_v1(
  p_subject_type text, p_canonical_kind text, p_canonical_object_id text, p_relationship_id text, p_relationship_state_id text)
RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog, pg_temp AS $fn$
BEGIN
  IF p_subject_type IS NULL OR p_subject_type NOT IN ('CANONICAL_OBJECT','RELATIONSHIP_STATE') THEN
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'SUBJECT_TYPE_UNKNOWN';
  END IF;
  IF p_subject_type = 'CANONICAL_OBJECT' AND (p_relationship_id IS NOT NULL OR p_relationship_state_id IS NOT NULL
       OR p_canonical_kind IS NULL OR p_canonical_object_id IS NULL)
     OR p_subject_type = 'RELATIONSHIP_STATE' AND (p_canonical_kind IS NOT NULL OR p_canonical_object_id IS NOT NULL
       OR p_relationship_id IS NULL OR p_relationship_state_id IS NULL) THEN
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'SUBJECT_SHAPE_INVALID';
  END IF;
  IF p_subject_type = 'CANONICAL_OBJECT' AND p_canonical_kind NOT IN ('AGENT','AGENT_VERSION','MODEL','TOOL','MCP_SERVER','API','DATA_ASSET','DATA_ELEMENT') THEN
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'SUBJECT_KIND_NOT_LEGAL';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.unnest(ARRAY[p_canonical_object_id, p_relationship_id, p_relationship_state_id]) AS o(v)
             WHERE o.v IS NOT NULL AND (pg_catalog.length(o.v) NOT BETWEEN 1 AND 500 OR o.v <> pg_catalog.btrim(o.v))) THEN
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'SUBJECT_OPERAND_MALFORMED';
  END IF;
  RETURN gov_repo.l15_risk_subject_key_v1(p_subject_type, p_canonical_kind, p_canonical_object_id, p_relationship_id,
    p_relationship_state_id);
END;
$fn$;

-- ---------------------------------------------------------------------------------------------------------------------
-- C. Tables (L15-specific stores; l14_fact_states / l14_registry_states / l14_support_links are NOT used).
-- ---------------------------------------------------------------------------------------------------------------------
-- C1. Typed immutable GOVERNED_RISK proposal detail over the shared l14_proposals envelope. The exact subject, the exact
--     scenario version tuple (domain DB-derived from it), the temporal intent, the explicit expected-current / expected-none
--     of the logical key, the exact REVOKE target and its closure_reason. No title / description / rationale / score.
CREATE TABLE gov_repo.l15_governed_risk_proposals (
  organisation_id uuid NOT NULL,
  proposal_id uuid NOT NULL,
  subject_kind text GENERATED ALWAYS AS ('GOVERNED_RISK') STORED,
  intent text NOT NULL CHECK (intent IN ('VALIDATE','REVOKE')),
  subject_type text NOT NULL CHECK (subject_type IN ('CANONICAL_OBJECT','RELATIONSHIP_STATE')),
  subject_canonical_kind text CHECK (subject_canonical_kind IN ('AGENT','AGENT_VERSION','MODEL','TOOL','MCP_SERVER','API','DATA_ASSET','DATA_ELEMENT')),
  subject_canonical_object_id text CHECK (pg_catalog.length(subject_canonical_object_id) BETWEEN 1 AND 500
    AND subject_canonical_object_id = pg_catalog.btrim(subject_canonical_object_id)),
  subject_relationship_id text CHECK (pg_catalog.length(subject_relationship_id) BETWEEN 1 AND 500
    AND subject_relationship_id = pg_catalog.btrim(subject_relationship_id)),
  subject_relationship_state_id text CHECK (pg_catalog.length(subject_relationship_state_id) BETWEEN 1 AND 500
    AND subject_relationship_state_id = pg_catalog.btrim(subject_relationship_state_id)),
  -- DB-resolved (exact triple, exactly one row) at submission; never caller-supplied.
  subject_relationship_type text CHECK (subject_relationship_type IN ('USES_MODEL','USES_TOOL','USES_MCP','INVOKES','USES_PROMPT',
    'USES_KNOWLEDGE_BASE','USES_SKILL','EXPOSES','HANDOFF_TO','READS_FROM','WRITES_TO','DERIVED_FROM')),
  subject_key text NOT NULL GENERATED ALWAYS AS (gov_repo.l15_risk_subject_key_v1(subject_type, subject_canonical_kind,
    subject_canonical_object_id, subject_relationship_id, subject_relationship_state_id)) STORED
    CHECK (pg_catalog.length(subject_key) BETWEEN 1 AND 1100),
  subject_token text NOT NULL GENERATED ALWAYS AS (gov_repo.l15_risk_subject_token_v1(subject_type, subject_canonical_kind,
    subject_relationship_type)) STORED,
  scenario_definition_id uuid NOT NULL,
  scenario_definition_version_id uuid NOT NULL,
  scenario_content_hash character(64) NOT NULL CHECK (scenario_content_hash::text ~ '^[0-9a-f]{64}$'),
  -- Derived from the pinned scenario version (FK below); never caller-supplied.
  risk_domain text NOT NULL,
  requested_effective_from timestamptz,          -- NULL = IMMEDIATE (DB transaction instant)
  requested_effective_to timestamptz,            -- NULL = open-ended; VALIDATE only; immutable
  expected_current_state_id uuid,                -- NULL = explicit expected-none of the logical key
  target_state_id uuid,                          -- REVOKE only: the exact current VALIDATED state of the same key
  target_state_kind text GENERATED ALWAYS AS (CASE WHEN target_state_id IS NULL THEN NULL ELSE 'VALIDATED' END) STORED,
  closure_reason text CHECK (closure_reason IN ('RISK_NO_LONGER_APPLICABLE','SUBJECT_RETIRED','DUPLICATE_OF_GOVERNED_RISK',
    'RISK_ELIMINATED_BY_AVOIDANCE','RECORDED_IN_ERROR')),
  CONSTRAINT l15_governed_risk_proposals_pkey PRIMARY KEY (organisation_id, proposal_id),
  CONSTRAINT l15_governed_risk_proposals_tuple_unique UNIQUE (organisation_id, proposal_id, subject_key, scenario_definition_id,
    scenario_definition_version_id, scenario_content_hash, intent),
  CONSTRAINT l15_governed_risk_proposals_subject_union_check CHECK (
    (subject_type = 'CANONICAL_OBJECT' AND subject_canonical_kind IS NOT NULL AND subject_canonical_object_id IS NOT NULL
      AND subject_relationship_id IS NULL AND subject_relationship_state_id IS NULL AND subject_relationship_type IS NULL)
    OR (subject_type = 'RELATIONSHIP_STATE' AND subject_canonical_kind IS NULL AND subject_canonical_object_id IS NULL
      AND subject_relationship_id IS NOT NULL AND subject_relationship_state_id IS NOT NULL AND subject_relationship_type IS NOT NULL)),
  CONSTRAINT l15_governed_risk_proposals_intent_shape_check CHECK (
    (intent = 'VALIDATE' AND target_state_id IS NULL AND closure_reason IS NULL)
    OR (intent = 'REVOKE' AND target_state_id IS NOT NULL AND closure_reason IS NOT NULL AND requested_effective_to IS NULL
        AND expected_current_state_id = target_state_id)),
  CONSTRAINT l15_governed_risk_proposals_interval_check CHECK (
    requested_effective_to IS NULL OR requested_effective_from IS NULL OR requested_effective_to > requested_effective_from),
  CONSTRAINT l15_governed_risk_proposals_domain_subject_check CHECK (gov_repo.l15_risk_domain_subject_legal_v1(risk_domain, subject_token)),
  CONSTRAINT l15_governed_risk_proposals_envelope_fkey FOREIGN KEY (organisation_id, proposal_id, subject_kind, intent)
    REFERENCES gov_repo.l14_proposals (organisation_id, proposal_id, subject_kind, intent) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT l15_governed_risk_proposals_object_fkey FOREIGN KEY (organisation_id, subject_canonical_object_id, subject_canonical_kind)
    REFERENCES gov_repo.canonical_objects (organisation_id, canonical_object_id, kind) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT l15_governed_risk_proposals_scenario_version_fkey
    FOREIGN KEY (organisation_id, scenario_definition_id, scenario_definition_version_id, scenario_content_hash)
    REFERENCES gov_repo.l15_risk_scenario_definition_versions (organisation_id, scenario_definition_id, scenario_definition_version_id, content_hash)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT l15_governed_risk_proposals_scenario_domain_fkey FOREIGN KEY (organisation_id, scenario_definition_version_id, risk_domain)
    REFERENCES gov_repo.l15_risk_scenario_definition_versions (organisation_id, scenario_definition_version_id, risk_domain)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT l15_governed_risk_proposals_scenario_subject_fkey FOREIGN KEY (organisation_id, scenario_definition_version_id, subject_token)
    REFERENCES gov_repo.l15_risk_scenario_definition_subject_kinds (organisation_id, scenario_definition_version_id, subject_kind)
    ON UPDATE RESTRICT ON DELETE RESTRICT
);

-- C2. Typed immutable GOVERNED_RISK state. Pins the exact subject, the exact scenario version + DB hash + the exact
--     VALIDATED scenario registry state, the DB-derived domain, the deciding proposal, governance decision, ALLOW
--     authorization with its Authority Policy version / hash, source and support. Append-only lineage per logical key: a
--     REVOKED state revokes exactly its VALIDATED predecessor (same key and pins) with one closure_reason; a VALIDATED
--     successor follows a REVOKED tombstone (re-validation) or explicitly supersedes a VALIDATED predecessor (governed repin
--     to another scenario version / renewal after an explicit end). Predecessors are never written.
CREATE TABLE gov_repo.l15_governed_risk_states (
  organisation_id uuid NOT NULL,
  state_id uuid NOT NULL,
  subject_kind text GENERATED ALWAYS AS ('GOVERNED_RISK') STORED,
  state_kind text NOT NULL CHECK (state_kind IN ('VALIDATED','REVOKED')),
  subject_type text NOT NULL CHECK (subject_type IN ('CANONICAL_OBJECT','RELATIONSHIP_STATE')),
  subject_canonical_kind text CHECK (subject_canonical_kind IN ('AGENT','AGENT_VERSION','MODEL','TOOL','MCP_SERVER','API','DATA_ASSET','DATA_ELEMENT')),
  subject_canonical_object_id text CHECK (pg_catalog.length(subject_canonical_object_id) BETWEEN 1 AND 500
    AND subject_canonical_object_id = pg_catalog.btrim(subject_canonical_object_id)),
  subject_relationship_id text CHECK (pg_catalog.length(subject_relationship_id) BETWEEN 1 AND 500
    AND subject_relationship_id = pg_catalog.btrim(subject_relationship_id)),
  subject_relationship_state_id text CHECK (pg_catalog.length(subject_relationship_state_id) BETWEEN 1 AND 500
    AND subject_relationship_state_id = pg_catalog.btrim(subject_relationship_state_id)),
  subject_relationship_type text CHECK (subject_relationship_type IN ('USES_MODEL','USES_TOOL','USES_MCP','INVOKES','USES_PROMPT',
    'USES_KNOWLEDGE_BASE','USES_SKILL','EXPOSES','HANDOFF_TO','READS_FROM','WRITES_TO','DERIVED_FROM')),
  subject_key text NOT NULL GENERATED ALWAYS AS (gov_repo.l15_risk_subject_key_v1(subject_type, subject_canonical_kind,
    subject_canonical_object_id, subject_relationship_id, subject_relationship_state_id)) STORED
    CHECK (pg_catalog.length(subject_key) BETWEEN 1 AND 1100),
  subject_token text NOT NULL GENERATED ALWAYS AS (gov_repo.l15_risk_subject_token_v1(subject_type, subject_canonical_kind,
    subject_relationship_type)) STORED,
  scenario_definition_id uuid NOT NULL,
  scenario_definition_version_id uuid NOT NULL,
  scenario_content_hash character(64) NOT NULL CHECK (scenario_content_hash::text ~ '^[0-9a-f]{64}$'),
  scenario_validated_state_id uuid NOT NULL,     -- dependency pin: the exact VALIDATED scenario registry state
  scenario_state_kind text GENERATED ALWAYS AS ('VALIDATED') STORED,
  risk_domain text NOT NULL,
  predecessor_state_id uuid,
  revokes_state_id uuid,
  revoked_state_kind text GENERATED ALWAYS AS (CASE WHEN revokes_state_id IS NULL THEN NULL ELSE 'VALIDATED' END) STORED,
  closure_reason text CHECK (closure_reason IN ('RISK_NO_LONGER_APPLICABLE','SUBJECT_RETIRED','DUPLICATE_OF_GOVERNED_RISK',
    'RISK_ELIMINATED_BY_AVOIDANCE','RECORDED_IN_ERROR')),
  effective_from timestamptz NOT NULL,
  effective_to timestamptz,                      -- explicit immutable end fixed at creation (VALIDATED only)
  recorded_at timestamptz NOT NULL,
  proposal_id uuid NOT NULL,
  decision_outcome text GENERATED ALWAYS AS (CASE WHEN state_kind = 'VALIDATED' THEN 'VALIDATE' ELSE 'REVOKE' END) STORED,
  governance_decision_id uuid NOT NULL,
  authorization_decision_id uuid NOT NULL,
  authorization_result text GENERATED ALWAYS AS ('ALLOW') STORED,
  authority_policy_id uuid NOT NULL,
  authority_policy_version_id uuid NOT NULL,
  authority_policy_content_hash text NOT NULL CHECK (authority_policy_content_hash ~ '^[0-9a-f]{64}$'),
  source_class text NOT NULL CHECK (source_class IN ('LOCAL_HUMAN','SOURCE_CONNECTION')),
  support_status text NOT NULL CHECK (support_status IN ('NONE','PRESENT')),
  CONSTRAINT l15_governed_risk_states_pkey PRIMARY KEY (organisation_id, state_id),
  CONSTRAINT l15_governed_risk_states_decision_unique UNIQUE (organisation_id, governance_decision_id),
  CONSTRAINT l15_governed_risk_states_key_unique UNIQUE (organisation_id, state_id, subject_key, scenario_definition_id),
  CONSTRAINT l15_governed_risk_states_tuple_kind_unique UNIQUE (organisation_id, state_id, subject_key, scenario_definition_id,
    scenario_definition_version_id, scenario_content_hash, state_kind),
  -- The exact dependency key S4 / S5 pin (organisation + state + key + scenario pins + VALIDATED).
  CONSTRAINT l15_governed_risk_states_kind_unique UNIQUE (organisation_id, state_id, subject_key, scenario_definition_id,
    scenario_definition_version_id, scenario_content_hash, scenario_validated_state_id, state_kind),
  CONSTRAINT l15_governed_risk_states_subject_union_check CHECK (
    (subject_type = 'CANONICAL_OBJECT' AND subject_canonical_kind IS NOT NULL AND subject_canonical_object_id IS NOT NULL
      AND subject_relationship_id IS NULL AND subject_relationship_state_id IS NULL AND subject_relationship_type IS NULL)
    OR (subject_type = 'RELATIONSHIP_STATE' AND subject_canonical_kind IS NULL AND subject_canonical_object_id IS NULL
      AND subject_relationship_id IS NOT NULL AND subject_relationship_state_id IS NOT NULL AND subject_relationship_type IS NOT NULL)),
  CONSTRAINT l15_governed_risk_states_shape_check CHECK (
    (state_kind = 'VALIDATED' AND revokes_state_id IS NULL AND closure_reason IS NULL)
    OR (state_kind = 'REVOKED' AND revokes_state_id IS NOT NULL AND predecessor_state_id = revokes_state_id
        AND closure_reason IS NOT NULL AND effective_to IS NULL)),
  CONSTRAINT l15_governed_risk_states_self_check CHECK (
    (predecessor_state_id IS NULL OR predecessor_state_id <> state_id) AND (revokes_state_id IS NULL OR revokes_state_id <> state_id)),
  CONSTRAINT l15_governed_risk_states_first_check CHECK (predecessor_state_id IS NOT NULL OR state_kind = 'VALIDATED'),
  CONSTRAINT l15_governed_risk_states_interval_check CHECK (
    effective_to IS NULL OR (state_kind = 'VALIDATED' AND effective_to > effective_from)),
  CONSTRAINT l15_governed_risk_states_domain_subject_check CHECK (gov_repo.l15_risk_domain_subject_legal_v1(risk_domain, subject_token)),
  CONSTRAINT l15_governed_risk_states_object_fkey FOREIGN KEY (organisation_id, subject_canonical_object_id, subject_canonical_kind)
    REFERENCES gov_repo.canonical_objects (organisation_id, canonical_object_id, kind) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT l15_governed_risk_states_scenario_state_fkey
    FOREIGN KEY (organisation_id, scenario_validated_state_id, scenario_definition_id, scenario_definition_version_id,
                 scenario_content_hash, scenario_state_kind)
    REFERENCES gov_repo.l15_risk_scenario_definition_states (organisation_id, state_id, scenario_definition_id,
                 scenario_definition_version_id, content_hash, state_kind) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT l15_governed_risk_states_scenario_domain_fkey FOREIGN KEY (organisation_id, scenario_definition_version_id, risk_domain)
    REFERENCES gov_repo.l15_risk_scenario_definition_versions (organisation_id, scenario_definition_version_id, risk_domain)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT l15_governed_risk_states_scenario_subject_fkey FOREIGN KEY (organisation_id, scenario_definition_version_id, subject_token)
    REFERENCES gov_repo.l15_risk_scenario_definition_subject_kinds (organisation_id, scenario_definition_version_id, subject_kind)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT l15_governed_risk_states_predecessor_fkey FOREIGN KEY (organisation_id, predecessor_state_id, subject_key, scenario_definition_id)
    REFERENCES gov_repo.l15_governed_risk_states (organisation_id, state_id, subject_key, scenario_definition_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT l15_governed_risk_states_revokes_fkey
    FOREIGN KEY (organisation_id, revokes_state_id, subject_key, scenario_definition_id, scenario_definition_version_id,
                 scenario_content_hash, scenario_validated_state_id, revoked_state_kind)
    REFERENCES gov_repo.l15_governed_risk_states (organisation_id, state_id, subject_key, scenario_definition_id,
                 scenario_definition_version_id, scenario_content_hash, scenario_validated_state_id, state_kind)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT l15_governed_risk_states_proposal_fkey
    FOREIGN KEY (organisation_id, proposal_id, subject_key, scenario_definition_id, scenario_definition_version_id,
                 scenario_content_hash, decision_outcome)
    REFERENCES gov_repo.l15_governed_risk_proposals (organisation_id, proposal_id, subject_key, scenario_definition_id,
                 scenario_definition_version_id, scenario_content_hash, intent) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT l15_governed_risk_states_decision_fkey
    FOREIGN KEY (organisation_id, governance_decision_id, subject_kind, decision_outcome, authorization_decision_id)
    REFERENCES gov_repo.l14_governance_decisions (organisation_id, governance_decision_id, subject_kind, outcome, authorization_decision_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT l15_governed_risk_states_authorization_fkey
    FOREIGN KEY (organisation_id, authorization_decision_id, authorization_result, subject_kind, decision_outcome,
                 authority_policy_id, authority_policy_version_id, authority_policy_content_hash)
    REFERENCES gov_repo.l14_authorization_decisions (organisation_id, authorization_decision_id, result, subject_kind,
                 requested_action, basis_authority_policy_id, basis_version_id, basis_content_hash)
    ON UPDATE RESTRICT ON DELETE RESTRICT
);
CREATE UNIQUE INDEX l15_governed_risk_states_root_uidx ON gov_repo.l15_governed_risk_states (organisation_id, subject_key, scenario_definition_id)
  WHERE predecessor_state_id IS NULL;
CREATE UNIQUE INDEX l15_governed_risk_states_successor_uidx ON gov_repo.l15_governed_risk_states (organisation_id, predecessor_state_id)
  WHERE predecessor_state_id IS NOT NULL;
CREATE UNIQUE INDEX l15_governed_risk_states_revocation_uidx ON gov_repo.l15_governed_risk_states (organisation_id, revokes_state_id)
  WHERE state_kind = 'REVOKED';
CREATE INDEX l15_governed_risk_states_key_idx ON gov_repo.l15_governed_risk_states (organisation_id, subject_key, scenario_definition_id);
CREATE INDEX l15_governed_risk_states_scenario_idx ON gov_repo.l15_governed_risk_states (organisation_id, scenario_validated_state_id);

-- The REVOKE target and the explicit expected-current of a proposal are exact states of the SAME logical key (and, for a
-- REVOKE, the same scenario pins).
ALTER TABLE gov_repo.l15_governed_risk_proposals
  ADD CONSTRAINT l15_governed_risk_proposals_target_state_fkey
    FOREIGN KEY (organisation_id, target_state_id, subject_key, scenario_definition_id, scenario_definition_version_id,
                 scenario_content_hash, target_state_kind)
    REFERENCES gov_repo.l15_governed_risk_states (organisation_id, state_id, subject_key, scenario_definition_id,
                 scenario_definition_version_id, scenario_content_hash, state_kind) ON UPDATE RESTRICT ON DELETE RESTRICT,
  ADD CONSTRAINT l15_governed_risk_proposals_expected_state_fkey
    FOREIGN KEY (organisation_id, expected_current_state_id, subject_key, scenario_definition_id)
    REFERENCES gov_repo.l15_governed_risk_states (organisation_id, state_id, subject_key, scenario_definition_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT;

-- C3. Technical compare-and-set head per logical key: pointer only, created empty by the first state-appending decision,
--     advanced only to the direct lineage successor, reconstructible from history, never authority.
CREATE TABLE gov_repo.l15_governed_risk_heads (
  organisation_id uuid NOT NULL,
  subject_type text NOT NULL CHECK (subject_type IN ('CANONICAL_OBJECT','RELATIONSHIP_STATE')),
  subject_canonical_kind text CHECK (subject_canonical_kind IN ('AGENT','AGENT_VERSION','MODEL','TOOL','MCP_SERVER','API','DATA_ASSET','DATA_ELEMENT')),
  subject_canonical_object_id text CHECK (pg_catalog.length(subject_canonical_object_id) BETWEEN 1 AND 500
    AND subject_canonical_object_id = pg_catalog.btrim(subject_canonical_object_id)),
  subject_relationship_id text CHECK (pg_catalog.length(subject_relationship_id) BETWEEN 1 AND 500
    AND subject_relationship_id = pg_catalog.btrim(subject_relationship_id)),
  subject_relationship_state_id text CHECK (pg_catalog.length(subject_relationship_state_id) BETWEEN 1 AND 500
    AND subject_relationship_state_id = pg_catalog.btrim(subject_relationship_state_id)),
  subject_key text NOT NULL GENERATED ALWAYS AS (gov_repo.l15_risk_subject_key_v1(subject_type, subject_canonical_kind,
    subject_canonical_object_id, subject_relationship_id, subject_relationship_state_id)) STORED
    CHECK (pg_catalog.length(subject_key) BETWEEN 1 AND 1100),
  scenario_definition_id uuid NOT NULL,
  latest_state_id uuid,
  CONSTRAINT l15_governed_risk_heads_pkey PRIMARY KEY (organisation_id, subject_key, scenario_definition_id),
  CONSTRAINT l15_governed_risk_heads_subject_union_check CHECK (
    (subject_type = 'CANONICAL_OBJECT' AND subject_canonical_kind IS NOT NULL AND subject_canonical_object_id IS NOT NULL
      AND subject_relationship_id IS NULL AND subject_relationship_state_id IS NULL)
    OR (subject_type = 'RELATIONSHIP_STATE' AND subject_canonical_kind IS NULL AND subject_canonical_object_id IS NULL
      AND subject_relationship_id IS NOT NULL AND subject_relationship_state_id IS NOT NULL)),
  CONSTRAINT l15_governed_risk_heads_object_fkey FOREIGN KEY (organisation_id, subject_canonical_object_id, subject_canonical_kind)
    REFERENCES gov_repo.canonical_objects (organisation_id, canonical_object_id, kind) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT l15_governed_risk_heads_scenario_fkey FOREIGN KEY (organisation_id, scenario_definition_id)
    REFERENCES gov_repo.l15_risk_scenario_definitions (organisation_id, scenario_definition_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT l15_governed_risk_heads_state_fkey FOREIGN KEY (organisation_id, latest_state_id, subject_key, scenario_definition_id)
    REFERENCES gov_repo.l15_governed_risk_states (organisation_id, state_id, subject_key, scenario_definition_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT
);

-- ---------------------------------------------------------------------------------------------------------------------
-- D1. l15_support_links (D-03) widened additively with the GOVERNED_RISK rank-3 owners: owner_kind GOVERNED_RISK;
--     owner_governed_risk_artifact names PROPOSAL / DECISION / STATE; exactly one typed owner column (same-tenant composite
--     FK) is non-null (DECISION reuses the S2 owner_governance_decision_id column, FK onto l14_governance_decisions; the guard
--     pins the decision's subject kind). Targets: RISK_HYPOTHESIS, RISK_SIGNAL and every rank-0 tag (rank 3 -> 2/1/0). No L15
--     governed artifact is a target tag, so no cycle can exist. S1 / S2 branches restated verbatim + the new columns NULL.
-- ---------------------------------------------------------------------------------------------------------------------
ALTER TABLE gov_repo.l15_support_links
  ADD COLUMN owner_governed_risk_artifact text CHECK (owner_governed_risk_artifact IN ('PROPOSAL','DECISION','STATE')),
  ADD COLUMN owner_governed_risk_proposal_id uuid,
  ADD COLUMN owner_governed_risk_state_id uuid;
ALTER TABLE gov_repo.l15_support_links
  DROP CONSTRAINT l15_support_links_owner_kind_check,
  DROP CONSTRAINT l15_support_links_owner_shape_check,
  DROP CONSTRAINT l15_support_links_owner_target_matrix_check;
ALTER TABLE gov_repo.l15_support_links
  ADD CONSTRAINT l15_support_links_owner_kind_check CHECK (owner_kind IN (
    'RISK_SIGNAL','RISK_HYPOTHESIS','RISK_SCENARIO_DEFINITION','RISK_METHODOLOGY','GOVERNED_RISK')),
  ADD CONSTRAINT l15_support_links_owner_shape_check CHECK (
    (owner_kind = 'RISK_SIGNAL' AND owner_signal_id IS NOT NULL AND owner_signal_kind IS NOT NULL AND owner_hypothesis_id IS NULL
      AND owner_registry_artifact IS NULL
      AND pg_catalog.num_nonnulls(owner_scenario_proposal_id, owner_methodology_proposal_id, owner_governance_decision_id,
                                  owner_scenario_state_id, owner_methodology_state_id) = 0
      AND pg_catalog.num_nonnulls(owner_governed_risk_artifact, owner_governed_risk_proposal_id, owner_governed_risk_state_id) = 0)
    OR (owner_kind = 'RISK_HYPOTHESIS' AND owner_hypothesis_id IS NOT NULL AND owner_signal_id IS NULL AND owner_signal_kind IS NULL
      AND owner_registry_artifact IS NULL
      AND pg_catalog.num_nonnulls(owner_scenario_proposal_id, owner_methodology_proposal_id, owner_governance_decision_id,
                                  owner_scenario_state_id, owner_methodology_state_id) = 0
      AND pg_catalog.num_nonnulls(owner_governed_risk_artifact, owner_governed_risk_proposal_id, owner_governed_risk_state_id) = 0)
    OR (owner_kind = 'RISK_SCENARIO_DEFINITION' AND owner_signal_id IS NULL AND owner_signal_kind IS NULL AND owner_hypothesis_id IS NULL
      AND owner_methodology_proposal_id IS NULL AND owner_methodology_state_id IS NULL
      AND pg_catalog.num_nonnulls(owner_scenario_proposal_id, owner_governance_decision_id, owner_scenario_state_id) = 1
      AND ((owner_registry_artifact = 'PROPOSAL') = (owner_scenario_proposal_id IS NOT NULL))
      AND ((owner_registry_artifact = 'DECISION') = (owner_governance_decision_id IS NOT NULL))
      AND ((owner_registry_artifact = 'STATE') = (owner_scenario_state_id IS NOT NULL))
      AND pg_catalog.num_nonnulls(owner_governed_risk_artifact, owner_governed_risk_proposal_id, owner_governed_risk_state_id) = 0)
    OR (owner_kind = 'RISK_METHODOLOGY' AND owner_signal_id IS NULL AND owner_signal_kind IS NULL AND owner_hypothesis_id IS NULL
      AND owner_scenario_proposal_id IS NULL AND owner_scenario_state_id IS NULL
      AND pg_catalog.num_nonnulls(owner_methodology_proposal_id, owner_governance_decision_id, owner_methodology_state_id) = 1
      AND ((owner_registry_artifact = 'PROPOSAL') = (owner_methodology_proposal_id IS NOT NULL))
      AND ((owner_registry_artifact = 'DECISION') = (owner_governance_decision_id IS NOT NULL))
      AND ((owner_registry_artifact = 'STATE') = (owner_methodology_state_id IS NOT NULL))
      AND pg_catalog.num_nonnulls(owner_governed_risk_artifact, owner_governed_risk_proposal_id, owner_governed_risk_state_id) = 0)
    OR (owner_kind = 'GOVERNED_RISK' AND owner_signal_id IS NULL AND owner_signal_kind IS NULL AND owner_hypothesis_id IS NULL
      AND owner_registry_artifact IS NULL
      AND pg_catalog.num_nonnulls(owner_scenario_proposal_id, owner_methodology_proposal_id, owner_scenario_state_id,
                                  owner_methodology_state_id) = 0
      AND pg_catalog.num_nonnulls(owner_governed_risk_proposal_id, owner_governance_decision_id, owner_governed_risk_state_id) = 1
      AND ((owner_governed_risk_artifact = 'PROPOSAL') = (owner_governed_risk_proposal_id IS NOT NULL))
      AND ((owner_governed_risk_artifact = 'DECISION') = (owner_governance_decision_id IS NOT NULL))
      AND ((owner_governed_risk_artifact = 'STATE') = (owner_governed_risk_state_id IS NOT NULL)))),
  -- §9.2 closed acyclic owner -> target matrix: rank 1 -> rank 0, rank 2 -> rank 1, rank-3 registry -> two rank-0 tags,
  -- rank-3 GOVERNED_RISK -> rank 2 / 1 / 0 (every tag of the closed union; none of them is an L15 governed artifact).
  ADD CONSTRAINT l15_support_links_owner_target_matrix_check CHECK (
    (owner_kind = 'RISK_SIGNAL' AND target_tag IN ('DISCOVERY_EVIDENCE','SOURCE_ASSERTION','RUNTIME_OBSERVATION',
      'CROSS_SIGNAL_RESULT','EXECUTION_FIELD_STATE','TECHNICAL_FIELD_STATE','LINEAGE_OBSERVATION','L14_FACT_STATE'))
    OR (owner_kind = 'RISK_HYPOTHESIS' AND target_tag = 'RISK_SIGNAL')
    OR (owner_kind IN ('RISK_SCENARIO_DEFINITION','RISK_METHODOLOGY') AND target_tag IN ('DISCOVERY_EVIDENCE','SOURCE_ASSERTION'))
    OR (owner_kind = 'GOVERNED_RISK' AND target_tag IN ('RISK_HYPOTHESIS','RISK_SIGNAL','DISCOVERY_EVIDENCE','SOURCE_ASSERTION',
      'RUNTIME_OBSERVATION','CROSS_SIGNAL_RESULT','EXECUTION_FIELD_STATE','TECHNICAL_FIELD_STATE','LINEAGE_OBSERVATION','L14_FACT_STATE'))),
  ADD CONSTRAINT l15_support_links_owner_governed_risk_proposal_fkey FOREIGN KEY (organisation_id, owner_governed_risk_proposal_id)
    REFERENCES gov_repo.l15_governed_risk_proposals (organisation_id, proposal_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  ADD CONSTRAINT l15_support_links_owner_governed_risk_state_fkey FOREIGN KEY (organisation_id, owner_governed_risk_state_id)
    REFERENCES gov_repo.l15_governed_risk_states (organisation_id, state_id) ON UPDATE RESTRICT ON DELETE RESTRICT;
-- One link per GOVERNED_RISK owner x exact typed target.
CREATE UNIQUE INDEX l15_support_links_governed_risk_owner_target_unique ON gov_repo.l15_support_links (organisation_id,
  owner_governed_risk_artifact, (COALESCE(owner_governed_risk_proposal_id, owner_governance_decision_id, owner_governed_risk_state_id)),
  target_tag, (COALESCE(target_discovery_evidence_id, target_source_assertion_id, (target_runtime_observation_id)::text,
    target_cross_signal_comparison_id, target_execution_field_state_id, target_technical_field_state_id,
    target_lineage_observation_finding_id, (target_l14_fact_state_id)::text, (target_risk_signal_id)::text,
    (target_risk_hypothesis_id)::text)))
  WHERE owner_kind = 'GOVERNED_RISK';
CREATE INDEX l15_support_links_governed_risk_state_idx ON gov_repo.l15_support_links (organisation_id, owner_governed_risk_state_id)
  WHERE owner_governed_risk_state_id IS NOT NULL;

-- The S1 / S2 link guard, extended (S1 and S2 branches verbatim): a GOVERNED_RISK owner must have been written by THIS
-- transaction (its row xmin is the current transaction id; a DECISION owner must be a governance decision of exactly
-- GOVERNED_RISK), and a CROSS_SIGNAL_RESULT target keeps the S1 outcome admissibility.
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
  ELSIF NEW.owner_kind = 'GOVERNED_RISK' THEN
    IF NOT (CASE NEW.owner_governed_risk_artifact
      WHEN 'PROPOSAL' THEN EXISTS (
        SELECT 1 FROM gov_repo.l15_governed_risk_proposals AS p
        WHERE p.organisation_id = NEW.organisation_id AND p.proposal_id = NEW.owner_governed_risk_proposal_id
          AND p.xmin = pg_catalog.pg_current_xact_id()::xid)
      WHEN 'DECISION' THEN EXISTS (
        SELECT 1 FROM gov_repo.l14_governance_decisions AS d
        WHERE d.organisation_id = NEW.organisation_id AND d.governance_decision_id = NEW.owner_governance_decision_id
          AND d.subject_kind = 'GOVERNED_RISK' AND d.xmin = pg_catalog.pg_current_xact_id()::xid)
      WHEN 'STATE' THEN EXISTS (
        SELECT 1 FROM gov_repo.l15_governed_risk_states AS s
        WHERE s.organisation_id = NEW.organisation_id AND s.state_id = NEW.owner_governed_risk_state_id
          AND s.xmin = pg_catalog.pg_current_xact_id()::xid)
      ELSE false END) THEN
      RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'SUPPORT_OWNER_NOT_IN_TRANSACTION';
    END IF;
    IF NEW.target_tag = 'CROSS_SIGNAL_RESULT' AND NOT EXISTS (
         SELECT 1 FROM gov_repo.cross_signal_comparison_results AS r
         WHERE r.organisation_id = NEW.organisation_id AND r.comparison_id = NEW.target_cross_signal_comparison_id
           AND r.outcome IN ('CONFLICT_CANDIDATE','INSUFFICIENT_EVIDENCE','DRIFT_CANDIDATE')) THEN
      RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'CROSS_SIGNAL_RESULT_NOT_ADMISSIBLE';
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

-- Typed GOVERNED_RISK-owner link writer (one row per normalized support entry; the S1 normalizer resolves same-tenant
-- targets of every tag and fails closed on an unknown / foreign / malformed target).
CREATE FUNCTION gov_repo.l15_write_governed_risk_support_links_v1(p_organisation_id uuid, p_artifact text,
  p_proposal_id uuid, p_governance_decision_id uuid, p_state_id uuid, p_tags text[], p_ids text[])
RETURNS integer LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $fn$
DECLARE
  v_row record;
  v_count integer := 0;
BEGIN
  IF p_artifact IS NULL OR p_artifact NOT IN ('PROPOSAL','DECISION','STATE') THEN
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'SUPPORT_OWNER_INVALID';
  END IF;
  FOR v_row IN SELECT * FROM gov_repo.l15_normalize_support_v1(p_organisation_id, p_tags, p_ids) LOOP
    INSERT INTO gov_repo.l15_support_links (organisation_id, link_id, owner_kind, owner_governed_risk_artifact,
      owner_governed_risk_proposal_id, owner_governance_decision_id, owner_governed_risk_state_id, target_tag,
      target_discovery_evidence_id, target_source_assertion_id, target_runtime_observation_id, target_cross_signal_comparison_id,
      target_execution_field_state_id, target_technical_field_state_id, target_lineage_observation_finding_id,
      target_l14_fact_state_id, target_l14_fact_subject_kind, target_risk_signal_id, target_risk_hypothesis_id, recorded_at)
    VALUES (p_organisation_id, pg_catalog.gen_random_uuid(), 'GOVERNED_RISK', p_artifact,
      CASE WHEN p_artifact = 'PROPOSAL' THEN p_proposal_id END,
      CASE WHEN p_artifact = 'DECISION' THEN p_governance_decision_id END,
      CASE WHEN p_artifact = 'STATE' THEN p_state_id END,
      v_row.tag,
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

-- ---------------------------------------------------------------------------------------------------------------------
-- D2. l14_command_results: the D-01 §4 L15 decision-result branch widened from the two registries to GOVERNED_RISK (a
--     VALIDATED / REVOKED GOVERNED_RISK decision result references the exact L15 state; never an AP / registry / fact
--     state). Every other branch restated verbatim.
-- ---------------------------------------------------------------------------------------------------------------------
ALTER TABLE gov_repo.l14_command_results DROP CONSTRAINT l14_command_results_shape_check;
ALTER TABLE gov_repo.l14_command_results DROP CONSTRAINT l14_command_results_l15_state_check;
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
      OR (subject_kind IN ('RISK_SCENARIO_DEFINITION','RISK_METHODOLOGY','GOVERNED_RISK')
        AND command_kind = 'DECIDE_PROPOSAL' AND outcome IN ('VALIDATED','REVOKED') AND authorization_decision_id IS NOT NULL
        AND proposal_id IS NOT NULL AND governance_decision_id IS NOT NULL AND l15_state_id IS NOT NULL)))),
  -- l15_state_id is set ONLY on an L15 registry / GOVERNED_RISK VALIDATED / REVOKED decision result (S4+ widen this).
  ADD CONSTRAINT l14_command_results_l15_state_check CHECK (
    l15_state_id IS NULL
    OR (subject_kind IN ('RISK_SCENARIO_DEFINITION','RISK_METHODOLOGY','GOVERNED_RISK') AND command_kind = 'DECIDE_PROPOSAL'
        AND outcome IN ('VALIDATED','REVOKED')));

-- The S2 owner-only result guard, extended (S2 branches verbatim): a GOVERNED_RISK result names the exact L15 state of that
-- decision / proposal / authorization / instant.
CREATE OR REPLACE FUNCTION gov_repo.l15_command_result_state_guard_v1() RETURNS trigger
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
       WHEN 'GOVERNED_RISK' THEN EXISTS (
         SELECT 1 FROM gov_repo.l15_governed_risk_states AS s
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

-- ---------------------------------------------------------------------------------------------------------------------
-- E. Structural guards (raising, ENABLE ALWAYS; owner-only SECURITY INVOKER except the deferred commit guard).
-- ---------------------------------------------------------------------------------------------------------------------
-- E1. A proposal is LOCAL_HUMAN in this slice (SYSTEM_SEED is structurally impossible for GOVERNED_RISK; SOURCE_CONNECTION
--     has no bounded intake identity here: M19). It mirrors the subject the DB resolved at submission (relationship type of
--     exactly one triple row) and is never a governed artifact of another tenant (composite FKs).
CREATE FUNCTION gov_repo.l15_governed_risk_proposal_guard_v1() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $guard$
DECLARE
  v_envelope_source text;
  v_rel record;
BEGIN
  SELECT p.source_class INTO v_envelope_source
  FROM gov_repo.l14_proposals AS p
  WHERE p.organisation_id = NEW.organisation_id AND p.proposal_id = NEW.proposal_id AND p.subject_kind = 'GOVERNED_RISK';
  IF v_envelope_source IS DISTINCT FROM 'LOCAL_HUMAN' THEN
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'GOVERNED_RISK_PROPOSAL_SOURCE_INVALID';
  END IF;
  IF NEW.subject_type = 'RELATIONSHIP_STATE' THEN
    SELECT r.match_count, r.relationship_type INTO v_rel
    FROM gov_repo.l14_resolve_relationship_state_target_v1(NEW.organisation_id, NEW.subject_relationship_id,
      NEW.subject_relationship_state_id) AS r;
    IF v_rel.match_count IS DISTINCT FROM 1::bigint OR v_rel.relationship_type IS DISTINCT FROM NEW.subject_relationship_type THEN
      RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'SUBJECT_RELATIONSHIP_STATE_UNRESOLVED';
    END IF;
  END IF;
  RETURN NEW;
END;
$guard$;
CREATE TRIGGER l15_governed_risk_proposals_guard BEFORE INSERT ON gov_repo.l15_governed_risk_proposals
  FOR EACH ROW EXECUTE FUNCTION gov_repo.l15_governed_risk_proposal_guard_v1();

-- E2. A state mirrors its exact decision / proposal / authorization target, is recorded at the decision instant, takes its
--     effective_from from the proposal (NULL request = the decision instant) and its explicit end only from a VALIDATE
--     proposal, re-resolves the exact subject, respects the per-key interval lineage (M16 §17 / S1B.1R1 rules) and, when
--     VALIDATED, pins EXACTLY the scenario registry state the S2 exact resolver returns at the state's own coordinates.
CREATE FUNCTION gov_repo.l15_governed_risk_state_guard_v1() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $guard$
DECLARE
  v_decision record;
  v_proposal record;
  v_authz record;
  v_predecessor record;
  v_rel record;
BEGIN
  SELECT d.proposal_id, d.decided_at, d.support_status, d.actor_user_id INTO v_decision
  FROM gov_repo.l14_governance_decisions AS d
  WHERE d.organisation_id = NEW.organisation_id AND d.governance_decision_id = NEW.governance_decision_id
    AND d.subject_kind = 'GOVERNED_RISK';
  SELECT p.source_class, t.* INTO v_proposal
  FROM gov_repo.l14_proposals AS p
  JOIN gov_repo.l15_governed_risk_proposals AS t ON t.organisation_id = p.organisation_id AND t.proposal_id = p.proposal_id
  WHERE p.organisation_id = NEW.organisation_id AND p.proposal_id = NEW.proposal_id;
  IF v_decision.proposal_id IS DISTINCT FROM NEW.proposal_id OR v_decision.decided_at IS DISTINCT FROM NEW.recorded_at
     OR v_decision.support_status IS DISTINCT FROM NEW.support_status
     OR v_proposal.source_class IS DISTINCT FROM NEW.source_class
     OR v_proposal.subject_type IS DISTINCT FROM NEW.subject_type
     OR v_proposal.subject_canonical_kind IS DISTINCT FROM NEW.subject_canonical_kind
     OR v_proposal.subject_canonical_object_id IS DISTINCT FROM NEW.subject_canonical_object_id
     OR v_proposal.subject_relationship_id IS DISTINCT FROM NEW.subject_relationship_id
     OR v_proposal.subject_relationship_state_id IS DISTINCT FROM NEW.subject_relationship_state_id
     OR v_proposal.subject_relationship_type IS DISTINCT FROM NEW.subject_relationship_type
     OR v_proposal.risk_domain IS DISTINCT FROM NEW.risk_domain
     OR v_proposal.target_state_id IS DISTINCT FROM NEW.revokes_state_id
     OR v_proposal.closure_reason IS DISTINCT FROM NEW.closure_reason
     OR v_proposal.expected_current_state_id IS DISTINCT FROM NEW.predecessor_state_id
     OR NEW.effective_from IS DISTINCT FROM COALESCE(v_proposal.requested_effective_from, NEW.recorded_at)
     OR NEW.effective_to IS DISTINCT FROM (CASE WHEN NEW.state_kind = 'VALIDATED' THEN v_proposal.requested_effective_to END) THEN
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'GOVERNED_RISK_STATE_ENVELOPE_MISMATCH';
  END IF;
  SELECT a.scope_tag, a.target_canonical_kind, a.target_canonical_object_id, a.target_relationship_type,
         a.target_relationship_id, a.target_relationship_state_id, a.source_class, a.evaluated_at, a.actor_user_id
  INTO v_authz
  FROM gov_repo.l14_authorization_decisions AS a
  WHERE a.organisation_id = NEW.organisation_id AND a.authorization_decision_id = NEW.authorization_decision_id;
  IF NOT FOUND OR v_authz.source_class IS DISTINCT FROM NEW.source_class
     OR v_authz.scope_tag IS DISTINCT FROM NEW.subject_type
     OR v_authz.target_canonical_kind IS DISTINCT FROM NEW.subject_canonical_kind
     OR v_authz.target_canonical_object_id IS DISTINCT FROM NEW.subject_canonical_object_id
     OR v_authz.target_relationship_type IS DISTINCT FROM NEW.subject_relationship_type
     OR v_authz.target_relationship_id IS DISTINCT FROM NEW.subject_relationship_id
     OR v_authz.target_relationship_state_id IS DISTINCT FROM NEW.subject_relationship_state_id
     OR v_authz.evaluated_at IS DISTINCT FROM NEW.recorded_at OR v_authz.actor_user_id IS DISTINCT FROM v_decision.actor_user_id THEN
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'GOVERNED_RISK_STATE_AUTHORIZATION_TARGET_MISMATCH';
  END IF;
  IF NEW.subject_type = 'RELATIONSHIP_STATE' THEN
    SELECT r.match_count, r.relationship_type INTO v_rel
    FROM gov_repo.l14_resolve_relationship_state_target_v1(NEW.organisation_id, NEW.subject_relationship_id,
      NEW.subject_relationship_state_id) AS r;
    IF v_rel.match_count = 0 THEN
      RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'SUBJECT_RELATIONSHIP_STATE_UNRESOLVED';
    END IF;
    IF v_rel.match_count <> 1 THEN
      RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'SUBJECT_RELATIONSHIP_STATE_AMBIGUOUS';
    END IF;
    IF v_rel.relationship_type IS DISTINCT FROM NEW.subject_relationship_type THEN
      RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'GOVERNED_RISK_STATE_AUTHORIZATION_TARGET_MISMATCH';
    END IF;
  END IF;
  IF NEW.predecessor_state_id IS NOT NULL THEN
    SELECT s.state_kind, s.effective_from, s.effective_to INTO v_predecessor
    FROM gov_repo.l15_governed_risk_states AS s
    WHERE s.organisation_id = NEW.organisation_id AND s.state_id = NEW.predecessor_state_id;
    IF NEW.state_kind = 'REVOKED' THEN
      IF NEW.effective_from < v_predecessor.effective_from THEN
        RAISE EXCEPTION 'L15_CONTINUITY_VIOLATION' USING ERRCODE = 'GV011', DETAIL = 'REVOKE_BEFORE_TARGET_EFFECTIVE';
      END IF;
      IF v_predecessor.effective_to IS NOT NULL AND NEW.effective_from >= v_predecessor.effective_to THEN
        RAISE EXCEPTION 'L15_CONTINUITY_VIOLATION' USING ERRCODE = 'GV011', DETAIL = 'REVOKE_AFTER_TARGET_EXPIRY';
      END IF;
    ELSIF v_predecessor.state_kind = 'REVOKED' THEN
      IF NOT (NEW.effective_from >= v_predecessor.effective_from) THEN
        RAISE EXCEPTION 'L15_CONTINUITY_VIOLATION' USING ERRCODE = 'GV011', DETAIL = 'REVALIDATION_OVERLAPS_PRIOR_INTERVAL';
      END IF;
    ELSE
      IF NEW.effective_from < v_predecessor.effective_from THEN
        RAISE EXCEPTION 'L15_CONTINUITY_VIOLATION' USING ERRCODE = 'GV011', DETAIL = 'SUCCESSOR_BEFORE_PREDECESSOR_EFFECTIVE';
      END IF;
      IF v_predecessor.effective_to IS NOT NULL AND NEW.effective_from < v_predecessor.effective_to THEN
        RAISE EXCEPTION 'L15_CONTINUITY_VIOLATION' USING ERRCODE = 'GV011', DETAIL = 'SUCCESSOR_BEFORE_PREDECESSOR_END';
      END IF;
    END IF;
  END IF;
  IF NEW.state_kind = 'VALIDATED' AND NOT EXISTS (
       SELECT 1 FROM gov_repo.l15_risk_scenario_definition_valid_state_v1(NEW.organisation_id, NEW.scenario_definition_id,
         NEW.scenario_definition_version_id, NEW.scenario_content_hash::text, NEW.effective_from, NEW.recorded_at) AS sv
       WHERE sv.state_id = NEW.scenario_validated_state_id) THEN
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'SCENARIO_DEPENDENCY_NOT_VALID';
  END IF;
  RETURN NEW;
END;
$guard$;
CREATE TRIGGER l15_governed_risk_states_guard BEFORE INSERT ON gov_repo.l15_governed_risk_states
  FOR EACH ROW EXECUTE FUNCTION gov_repo.l15_governed_risk_state_guard_v1();

-- E3. Commit-time (DEFERRABLE INITIALLY DEFERRED) support integrity: a proposal's stored support_status equals its actual
--     link set; a state's link set equals its decision's link set and its support_status.
-- SECURITY DEFINER necessity (as the S1 / S2 commit guards): a deferred trigger fires at COMMIT as the committing role
-- (service_role), which by design holds no L15 table privilege. Trigger function only: EXECUTE is owner-only; it reads L15 /
-- envelope rows and writes nothing.
CREATE FUNCTION gov_repo.l15_governed_risk_commit_guard_v1() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $fn$
DECLARE
  v_a bigint;
  v_b bigint;
  v_status text;
BEGIN
  IF TG_TABLE_NAME = 'l15_governed_risk_proposals' THEN
    SELECT p.support_status INTO v_status FROM gov_repo.l14_proposals AS p
    WHERE p.organisation_id = NEW.organisation_id AND p.proposal_id = NEW.proposal_id;
    SELECT pg_catalog.count(*) INTO v_a FROM gov_repo.l15_support_links AS l
    WHERE l.organisation_id = NEW.organisation_id AND l.owner_kind = 'GOVERNED_RISK'
      AND l.owner_governed_risk_artifact = 'PROPOSAL' AND l.owner_governed_risk_proposal_id = NEW.proposal_id;
    IF v_status IS NULL OR (v_status = 'PRESENT') <> (v_a > 0) THEN
      RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'GOVERNED_RISK_PROPOSAL_SUPPORT_INCOMPLETE';
    END IF;
  ELSIF TG_TABLE_NAME = 'l15_governed_risk_states' THEN
    SELECT pg_catalog.count(*) INTO v_a FROM gov_repo.l15_support_links AS l
    WHERE l.organisation_id = NEW.organisation_id AND l.owner_kind = 'GOVERNED_RISK'
      AND l.owner_governed_risk_artifact = 'STATE' AND l.owner_governed_risk_state_id = NEW.state_id;
    SELECT pg_catalog.count(*) INTO v_b FROM gov_repo.l15_support_links AS l
    WHERE l.organisation_id = NEW.organisation_id AND l.owner_kind = 'GOVERNED_RISK'
      AND l.owner_governed_risk_artifact = 'DECISION' AND l.owner_governance_decision_id = NEW.governance_decision_id;
    IF (NEW.support_status = 'PRESENT') <> (v_a > 0) OR v_a <> v_b THEN
      RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'GOVERNED_RISK_STATE_SUPPORT_INCOMPLETE';
    END IF;
  ELSE
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'UNEXPECTED_STORE';
  END IF;
  RETURN NULL;
END;
$fn$;
CREATE CONSTRAINT TRIGGER l15_governed_risk_proposals_support_complete AFTER INSERT ON gov_repo.l15_governed_risk_proposals
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION gov_repo.l15_governed_risk_commit_guard_v1();
CREATE CONSTRAINT TRIGGER l15_governed_risk_states_support_complete AFTER INSERT ON gov_repo.l15_governed_risk_states
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION gov_repo.l15_governed_risk_commit_guard_v1();

-- E4. The head is the only mutable GOVERNED_RISK table: created empty, key fixed, never deleted / truncated, only ever
--     advanced to the direct lineage successor of its current state.
CREATE FUNCTION gov_repo.l15_governed_risk_head_guard_v1() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $head$
BEGIN
  IF TG_OP IN ('DELETE','TRUNCATE') THEN
    RAISE EXCEPTION 'L15_HISTORY_IMMUTABLE' USING ERRCODE = '55000', DETAIL = 'l15_governed_risk_heads:' || TG_OP;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.latest_state_id IS NOT NULL THEN
      RAISE EXCEPTION 'L15_HISTORY_IMMUTABLE' USING ERRCODE = '55000', DETAIL = 'l15_governed_risk_heads:INSERT_WITH_STATE';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.organisation_id IS DISTINCT FROM OLD.organisation_id OR NEW.subject_type IS DISTINCT FROM OLD.subject_type
     OR NEW.subject_canonical_kind IS DISTINCT FROM OLD.subject_canonical_kind
     OR NEW.subject_canonical_object_id IS DISTINCT FROM OLD.subject_canonical_object_id
     OR NEW.subject_relationship_id IS DISTINCT FROM OLD.subject_relationship_id
     OR NEW.subject_relationship_state_id IS DISTINCT FROM OLD.subject_relationship_state_id
     OR NEW.scenario_definition_id IS DISTINCT FROM OLD.scenario_definition_id
     OR (OLD.latest_state_id IS NOT NULL AND NEW.latest_state_id IS NULL) THEN
    RAISE EXCEPTION 'L15_HISTORY_IMMUTABLE' USING ERRCODE = '55000', DETAIL = 'l15_governed_risk_heads:IDENTITY';
  END IF;
  IF NEW.latest_state_id IS DISTINCT FROM OLD.latest_state_id AND NOT EXISTS (
       SELECT 1 FROM gov_repo.l15_governed_risk_states AS s
       WHERE s.organisation_id = NEW.organisation_id AND s.state_id = NEW.latest_state_id
         AND s.subject_key = OLD.subject_key AND s.scenario_definition_id = OLD.scenario_definition_id
         AND s.predecessor_state_id IS NOT DISTINCT FROM OLD.latest_state_id) THEN
    RAISE EXCEPTION 'L15_HISTORY_IMMUTABLE' USING ERRCODE = '55000', DETAIL = 'l15_governed_risk_heads:LINEAGE';
  END IF;
  RETURN NEW;
END;
$head$;
CREATE TRIGGER l15_governed_risk_heads_guard BEFORE INSERT OR UPDATE OR DELETE ON gov_repo.l15_governed_risk_heads
  FOR EACH ROW EXECUTE FUNCTION gov_repo.l15_governed_risk_head_guard_v1();
CREATE TRIGGER l15_governed_risk_heads_no_truncate BEFORE TRUNCATE ON gov_repo.l15_governed_risk_heads
  FOR EACH STATEMENT EXECUTE FUNCTION gov_repo.l15_governed_risk_head_guard_v1();

-- ---------------------------------------------------------------------------------------------------------------------
-- F1. Owner-only exact bitemporal GOVERNED_RISK resolver (the S4 / S5 dependency contract). The exact VALIDATED state of the
--     exact logical key (organisation + exact subject + stable scenario_definition_id; NEVER a version, a label, a domain, a
--     similar subject or another tenant) valid at business instant p_effective_at as known at system cutoff
--     p_recorded_cutoff, returned ONLY when ALL hold at the SAME pair of coordinates:
--       * own state: recorded_at <= cutoff, effective_from <= instant, instant < explicit effective_to (if any), and no
--         VISIBLE lineage successor (superseding VALIDATED state or the exact REVOKED tombstone, recorded <= cutoff) with
--         effective_from <= instant — closure is DERIVED, never stored, so a later-recorded successor never leaks into an
--         earlier cutoff and a future-effective successor / REVOKE never hides the state early; exactly one candidate;
--       * subject: the exact object still resolves (organisation + id + kind), or the exact relationship-state triple
--         resolves to exactly one row of the pinned type (never a bare state id, a relationship rollup, a successor);
--       * scenario dependency: the pinned VALIDATED scenario registry state is EXACTLY the state the S2 exact resolver returns
--         for the same identity + version + hash at the same instant and cutoff (a revoked / not-yet-effective / not-visible
--         scenario version makes the risk not current; it is never repinned to a successor version).
--     No row otherwise = UNKNOWN / not current. Dependency invalidation never writes a row and never manufactures REVOKED.
-- ---------------------------------------------------------------------------------------------------------------------
CREATE FUNCTION gov_repo.l15_governed_risk_valid_state_v1(
  p_organisation_id uuid, p_subject_type text, p_subject_canonical_kind text, p_subject_canonical_object_id text,
  p_subject_relationship_id text, p_subject_relationship_state_id text, p_scenario_definition_id uuid,
  p_effective_at timestamptz, p_recorded_cutoff timestamptz)
RETURNS TABLE (state_id uuid, scenario_definition_version_id uuid, scenario_content_hash text, scenario_validated_state_id uuid,
               risk_domain text, effective_from timestamptz, effective_to timestamptz, recorded_at timestamptz)
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  WITH k AS (
    SELECT gov_repo.l15_risk_subject_key_v1(p_subject_type, p_subject_canonical_kind, p_subject_canonical_object_id,
             p_subject_relationship_id, p_subject_relationship_state_id) AS subject_key
  ), visible AS (
    SELECT s.state_id, s.state_kind, s.predecessor_state_id, s.effective_from, s.effective_to, s.recorded_at,
           s.scenario_definition_version_id, s.scenario_content_hash, s.scenario_validated_state_id, s.risk_domain,
           s.subject_relationship_type
    FROM gov_repo.l15_governed_risk_states AS s CROSS JOIN k
    WHERE s.organisation_id = p_organisation_id AND s.subject_key = k.subject_key
      AND s.scenario_definition_id = p_scenario_definition_id AND s.recorded_at <= p_recorded_cutoff
  ), candidates AS (
    SELECT v.* FROM visible AS v
    WHERE v.state_kind = 'VALIDATED' AND v.effective_from <= p_effective_at
      AND (v.effective_to IS NULL OR p_effective_at < v.effective_to)
      AND NOT EXISTS (SELECT 1 FROM visible AS n WHERE n.predecessor_state_id = v.state_id AND n.effective_from <= p_effective_at)
  )
  SELECT c.state_id, c.scenario_definition_version_id, c.scenario_content_hash::text, c.scenario_validated_state_id,
         c.risk_domain, c.effective_from, c.effective_to, c.recorded_at
  FROM candidates AS c
  WHERE (SELECT pg_catalog.count(*) FROM candidates) = 1
    AND ((p_subject_type = 'CANONICAL_OBJECT'
          AND EXISTS (SELECT 1 FROM gov_repo.canonical_objects AS o
                      WHERE o.organisation_id = p_organisation_id AND o.canonical_object_id = p_subject_canonical_object_id
                        AND o.kind = p_subject_canonical_kind))
      OR (p_subject_type = 'RELATIONSHIP_STATE'
          AND EXISTS (SELECT 1 FROM gov_repo.l14_resolve_relationship_state_target_v1(p_organisation_id,
                        p_subject_relationship_id, p_subject_relationship_state_id) AS r
                      WHERE r.match_count = 1 AND r.relationship_type = c.subject_relationship_type)))
    AND EXISTS (SELECT 1 FROM gov_repo.l15_risk_scenario_definition_valid_state_v1(p_organisation_id, p_scenario_definition_id,
                  c.scenario_definition_version_id, c.scenario_content_hash::text, p_effective_at, p_recorded_cutoff) AS sv
                WHERE sv.state_id = c.scenario_validated_state_id)
$$;

-- Exact-state form (the S4 / S5 pin check): is THIS exact state THE current governed risk of its own logical key at both
-- coordinates? Never "the latest by scenario", never a successor.
CREATE FUNCTION gov_repo.l15_governed_risk_state_current_v1(
  p_organisation_id uuid, p_state_id uuid, p_effective_at timestamptz, p_recorded_cutoff timestamptz)
RETURNS boolean LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT COALESCE((
    SELECT EXISTS (SELECT 1 FROM gov_repo.l15_governed_risk_valid_state_v1(s.organisation_id, s.subject_type, s.subject_canonical_kind,
                     s.subject_canonical_object_id, s.subject_relationship_id, s.subject_relationship_state_id,
                     s.scenario_definition_id, p_effective_at, p_recorded_cutoff) AS v
                   WHERE v.state_id = s.state_id)
    FROM gov_repo.l15_governed_risk_states AS s
    WHERE s.organisation_id = p_organisation_id AND s.state_id = p_state_id AND s.state_kind = 'VALIDATED'), false)
$$;

-- Closed not-current classification of the latest VISIBLE lineage state of one logical key at both coordinates (read
-- projection only; persists nothing): CURRENT, NO_STATE, REVOKED, NOT_YET_EFFECTIVE, EXPIRED, SUBJECT_UNRESOLVED,
-- SCENARIO_DEPENDENCY_INVALID. The latest visible state = the visible state without a visible lineage successor that is
-- already effective at the instant (a future-effective successor never hides its predecessor early).
CREATE FUNCTION gov_repo.l15_governed_risk_resolution_v1(
  p_organisation_id uuid, p_subject_type text, p_subject_canonical_kind text, p_subject_canonical_object_id text,
  p_subject_relationship_id text, p_subject_relationship_state_id text, p_scenario_definition_id uuid,
  p_effective_at timestamptz, p_recorded_cutoff timestamptz)
RETURNS TABLE (resolution text, state_id uuid, state_kind text)
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  WITH k AS (
    SELECT gov_repo.l15_risk_subject_key_v1(p_subject_type, p_subject_canonical_kind, p_subject_canonical_object_id,
             p_subject_relationship_id, p_subject_relationship_state_id) AS subject_key
  ), visible AS (
    SELECT s.* FROM gov_repo.l15_governed_risk_states AS s CROSS JOIN k
    WHERE s.organisation_id = p_organisation_id AND s.subject_key = k.subject_key
      AND s.scenario_definition_id = p_scenario_definition_id AND s.recorded_at <= p_recorded_cutoff
  ), latest AS (
    SELECT v.* FROM visible AS v
    WHERE (v.effective_from <= p_effective_at OR v.predecessor_state_id IS NULL)
      AND NOT EXISTS (SELECT 1 FROM visible AS n WHERE n.predecessor_state_id = v.state_id AND n.effective_from <= p_effective_at)
  ), current AS (
    SELECT c.state_id FROM gov_repo.l15_governed_risk_valid_state_v1(p_organisation_id, p_subject_type, p_subject_canonical_kind,
      p_subject_canonical_object_id, p_subject_relationship_id, p_subject_relationship_state_id, p_scenario_definition_id,
      p_effective_at, p_recorded_cutoff) AS c
  )
  SELECT CASE
           WHEN EXISTS (SELECT 1 FROM current) THEN 'CURRENT'
           WHEN l.state_id IS NULL THEN 'NO_STATE'
           WHEN l.state_kind = 'REVOKED' THEN 'REVOKED'
           WHEN l.effective_from > p_effective_at THEN 'NOT_YET_EFFECTIVE'
           WHEN l.effective_to IS NOT NULL AND p_effective_at >= l.effective_to THEN 'EXPIRED'
           WHEN NOT ((l.subject_type = 'CANONICAL_OBJECT' AND EXISTS (SELECT 1 FROM gov_repo.canonical_objects AS o
                        WHERE o.organisation_id = p_organisation_id AND o.canonical_object_id = l.subject_canonical_object_id
                          AND o.kind = l.subject_canonical_kind))
                     OR (l.subject_type = 'RELATIONSHIP_STATE' AND EXISTS (SELECT 1 FROM gov_repo.l14_resolve_relationship_state_target_v1(
                        p_organisation_id, l.subject_relationship_id, l.subject_relationship_state_id) AS r
                        WHERE r.match_count = 1 AND r.relationship_type = l.subject_relationship_type))) THEN 'SUBJECT_UNRESOLVED'
           ELSE 'SCENARIO_DEPENDENCY_INVALID' END,
         COALESCE((SELECT c.state_id FROM current AS c), l.state_id),
         CASE WHEN EXISTS (SELECT 1 FROM current) THEN 'VALIDATED' ELSE l.state_kind END
  FROM (SELECT 1) AS one
  LEFT JOIN LATERAL (SELECT * FROM latest ORDER BY latest.effective_from DESC, latest.recorded_at DESC LIMIT 1) AS l ON true
$$;

-- ---------------------------------------------------------------------------------------------------------------------
-- F2. O44 support-currency projection (read only; persists nothing; never mutates, revokes or replaces anything).
--     Validity of ONE rank-0 support target at (effective_at, recorded_cutoff):
--       * L14_FACT_STATE: CURRENT iff the existing owner-only exact M16 resolver of that family, called with the cited
--         state's own logical key at the SAME coordinates, returns EXACTLY the cited fact_state_id (a revoked, expired,
--         superseded, not-yet-effective or dependency-invalid M16 state is never current; no replacement is selected). The
--         typed M16 state row is read only to obtain its key; no M16 status column is interpreted; nothing is written.
--       * TECHNICAL_FIELD_STATE / EXECUTION_FIELD_STATE: the upstream lineage contract (previous_state_id): CURRENT iff no
--         successor state of it is visible at the cutoff (FIELD_STATE_SUPERSEDED otherwise).
--       * DISCOVERY_EVIDENCE, SOURCE_ASSERTION, RUNTIME_OBSERVATION, CROSS_SIGNAL_RESULT, LINEAGE_OBSERVATION: immutable
--         evidence with no lifecycle invalidation: existence + same-tenant typed identity (composite FK) is the validity.
-- ---------------------------------------------------------------------------------------------------------------------
CREATE FUNCTION gov_repo.l15_support_link_target_failure_v1(
  p_organisation_id uuid, p_link_id uuid, p_effective_at timestamptz, p_recorded_cutoff timestamptz)
RETURNS text LANGUAGE plpgsql STABLE SET search_path = pg_catalog, pg_temp AS $fn$
DECLARE
  v_link record;
  v_key record;
  v_ok boolean;
BEGIN
  SELECT l.* INTO v_link FROM gov_repo.l15_support_links AS l WHERE l.organisation_id = p_organisation_id AND l.link_id = p_link_id;
  IF NOT FOUND THEN
    RETURN 'SUPPORT_LINK_UNRESOLVED';
  END IF;
  IF v_link.target_tag = 'L14_FACT_STATE' THEN
    v_ok := CASE v_link.target_l14_fact_subject_kind
      WHEN 'RESPONSIBILITY_ASSIGNMENT' THEN EXISTS (
        SELECT 1 FROM gov_repo.l14_responsibility_assignment_states AS d
        CROSS JOIN LATERAL gov_repo.l14_responsibility_assignment_valid_state_v1(d.organisation_id, d.target_kind,
          d.target_canonical_object_id, d.responsibility_role, d.governance_party_id, p_effective_at, p_recorded_cutoff) AS r
        WHERE d.organisation_id = p_organisation_id AND d.fact_state_id = v_link.target_l14_fact_state_id
          AND r.fact_state_id = v_link.target_l14_fact_state_id)
      WHEN 'BUSINESS_CONTEXT_ASSIGNMENT' THEN EXISTS (
        SELECT 1 FROM gov_repo.l14_business_context_assignment_states AS d
        CROSS JOIN LATERAL gov_repo.l14_business_context_assignment_valid_state_v1(d.organisation_id, d.target_kind,
          d.target_canonical_object_id, d.semantic_kind, p_effective_at, p_recorded_cutoff) AS r
        WHERE d.organisation_id = p_organisation_id AND d.fact_state_id = v_link.target_l14_fact_state_id
          AND r.fact_state_id = v_link.target_l14_fact_state_id)
      WHEN 'POLICY_APPLICABILITY' THEN EXISTS (
        SELECT 1 FROM gov_repo.l14_policy_applicability_states AS d
        CROSS JOIN LATERAL gov_repo.l14_policy_applicability_valid_state_v1(d.organisation_id, d.target_type,
          d.target_canonical_kind, d.target_canonical_object_id, d.target_relationship_id, d.target_relationship_state_id,
          d.policy_id, p_effective_at, p_recorded_cutoff) AS r
        WHERE d.organisation_id = p_organisation_id AND d.fact_state_id = v_link.target_l14_fact_state_id
          AND r.fact_state_id = v_link.target_l14_fact_state_id)
      WHEN 'CONTROL_APPLICABILITY' THEN EXISTS (
        SELECT 1 FROM gov_repo.l14_control_applicability_states AS d
        CROSS JOIN LATERAL gov_repo.l14_control_applicability_valid_state_v1(d.organisation_id, d.target_type,
          d.target_canonical_kind, d.target_canonical_object_id, d.target_relationship_id, d.target_relationship_state_id,
          d.control_definition_id, p_effective_at, p_recorded_cutoff) AS r
        WHERE d.organisation_id = p_organisation_id AND d.fact_state_id = v_link.target_l14_fact_state_id
          AND r.fact_state_id = v_link.target_l14_fact_state_id)
      WHEN 'CONTROL_ASSESSMENT' THEN EXISTS (
        SELECT 1 FROM gov_repo.l14_control_assessment_states AS d
        CROSS JOIN LATERAL gov_repo.l14_control_assessment_valid_state_v1(d.organisation_id, d.control_applicability_state_id,
          p_effective_at, p_recorded_cutoff) AS r
        WHERE d.organisation_id = p_organisation_id AND d.fact_state_id = v_link.target_l14_fact_state_id
          AND r.fact_state_id = v_link.target_l14_fact_state_id)
      ELSE false END;
    RETURN CASE WHEN v_ok THEN NULL ELSE 'L14_FACT_STATE_NOT_CURRENT' END;
  ELSIF v_link.target_tag = 'TECHNICAL_FIELD_STATE' THEN
    RETURN CASE WHEN EXISTS (SELECT 1 FROM gov_repo.technical_field_states AS n
                             WHERE n.organisation_id = p_organisation_id AND n.previous_state_id = v_link.target_technical_field_state_id
                               AND n.recorded_at <= p_recorded_cutoff)
                THEN 'FIELD_STATE_SUPERSEDED' END;
  ELSIF v_link.target_tag = 'EXECUTION_FIELD_STATE' THEN
    RETURN CASE WHEN EXISTS (SELECT 1 FROM gov_repo.execution_field_states AS n
                             WHERE n.organisation_id = p_organisation_id AND n.previous_state_id = v_link.target_execution_field_state_id
                               AND n.recorded_at <= p_recorded_cutoff)
                THEN 'FIELD_STATE_SUPERSEDED' END;
  ELSIF v_link.target_tag IN ('DISCOVERY_EVIDENCE','SOURCE_ASSERTION','RUNTIME_OBSERVATION','CROSS_SIGNAL_RESULT','LINEAGE_OBSERVATION') THEN
    RETURN NULL;  -- immutable evidence; existence + same-tenant typed identity is enforced by the composite FK
  END IF;
  RETURN 'SUPPORT_TARGET_NOT_RANK_ZERO';
END;
$fn$;

-- Per-link currency of one GOVERNED_RISK state's support (the links of the STATE owner = the deciding decision's links).
-- RISK_SIGNAL targets inherit the currency of the signal's own rank-0 links; RISK_HYPOTHESIS targets that of their cited
-- signals (rank 2 -> 1 -> 0; bounded, acyclic by construction). Each degraded row names the exact failing link of the risk
-- and, for a transitive failure, the exact upstream (signal-owned) link that failed.
CREATE FUNCTION gov_repo.l15_governed_risk_support_currency_v1(
  p_organisation_id uuid, p_state_id uuid, p_effective_at timestamptz, p_recorded_cutoff timestamptz)
RETURNS TABLE (link_id uuid, target_tag text, target_id text, link_currency text, failure_reason text, upstream_link_id uuid)
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  WITH links AS (
    SELECT l.* FROM gov_repo.l15_support_links AS l
    WHERE l.organisation_id = p_organisation_id AND l.owner_kind = 'GOVERNED_RISK' AND l.owner_governed_risk_artifact = 'STATE'
      AND l.owner_governed_risk_state_id = p_state_id AND l.recorded_at <= p_recorded_cutoff
  ), evaluated AS (
    SELECT l.link_id, l.target_tag,
           COALESCE(l.target_discovery_evidence_id, l.target_source_assertion_id, l.target_runtime_observation_id::text,
                    l.target_cross_signal_comparison_id, l.target_execution_field_state_id, l.target_technical_field_state_id,
                    l.target_lineage_observation_finding_id, l.target_l14_fact_state_id::text, l.target_risk_signal_id::text,
                    l.target_risk_hypothesis_id::text) AS target_id,
           CASE WHEN l.target_tag IN ('RISK_SIGNAL','RISK_HYPOTHESIS') THEN NULL
                ELSE gov_repo.l15_support_link_target_failure_v1(p_organisation_id, l.link_id, p_effective_at, p_recorded_cutoff) END AS direct_failure,
           (SELECT u.link_id FROM gov_repo.l15_support_links AS u
            WHERE u.organisation_id = p_organisation_id AND u.owner_kind = 'RISK_SIGNAL'
              AND (u.owner_signal_id = l.target_risk_signal_id
                   OR u.owner_signal_id IN (SELECT h.target_risk_signal_id FROM gov_repo.l15_support_links AS h
                                            WHERE h.organisation_id = p_organisation_id AND h.owner_kind = 'RISK_HYPOTHESIS'
                                              AND h.owner_hypothesis_id = l.target_risk_hypothesis_id))
              AND gov_repo.l15_support_link_target_failure_v1(p_organisation_id, u.link_id, p_effective_at, p_recorded_cutoff) IS NOT NULL
            ORDER BY u.link_id LIMIT 1) AS upstream_failure_link
    FROM links AS l
  )
  SELECT e.link_id, e.target_tag, e.target_id,
         CASE WHEN e.direct_failure IS NULL AND e.upstream_failure_link IS NULL THEN 'CURRENT' ELSE 'DEGRADED' END,
         COALESCE(e.direct_failure, CASE WHEN e.upstream_failure_link IS NOT NULL THEN
           CASE e.target_tag WHEN 'RISK_SIGNAL' THEN 'SIGNAL_SUPPORT_NOT_CURRENT' ELSE 'HYPOTHESIS_SUPPORT_NOT_CURRENT' END END),
         e.upstream_failure_link
  FROM evaluated AS e
$$;

-- Aggregate support currency of one GOVERNED_RISK state (closed projection vocabulary): SUPPORT_NONE (no support link),
-- SUPPORT_DEGRADED (>= 1 link not current; the first failing link is named), SUPPORT_CURRENT otherwise.
CREATE FUNCTION gov_repo.l15_governed_risk_support_summary_v1(
  p_organisation_id uuid, p_state_id uuid, p_effective_at timestamptz, p_recorded_cutoff timestamptz)
RETURNS TABLE (support_currency text, support_link_count bigint, degraded_link_count bigint, failing_link_id uuid,
               failing_reason text, failing_upstream_link_id uuid)
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  WITH c AS (SELECT * FROM gov_repo.l15_governed_risk_support_currency_v1(p_organisation_id, p_state_id, p_effective_at, p_recorded_cutoff))
  SELECT CASE WHEN (SELECT pg_catalog.count(*) FROM c) = 0 THEN 'SUPPORT_NONE'
              WHEN EXISTS (SELECT 1 FROM c WHERE c.link_currency = 'DEGRADED') THEN 'SUPPORT_DEGRADED'
              ELSE 'SUPPORT_CURRENT' END,
         (SELECT pg_catalog.count(*) FROM c),
         (SELECT pg_catalog.count(*) FROM c WHERE c.link_currency = 'DEGRADED'),
         f.link_id, f.failure_reason, f.upstream_link_id
  FROM (SELECT 1) AS one
  LEFT JOIN LATERAL (SELECT c.link_id, c.failure_reason, c.upstream_link_id FROM c WHERE c.link_currency = 'DEGRADED'
                     ORDER BY c.link_id LIMIT 1) AS f ON true
$$;

-- F3. The ORIGINAL durable GOVERNED_RISK result, exactly as stored (replay never recomputes it). SUBMIT / DECIDE project
--     the exact subject + scenario tuple + closure_reason their immutable typed proposal pins; VALIDATED / REVOKED project
--     the state (incl. its lineage predecessor and scenario registry pin).
CREATE FUNCTION gov_repo.l15_governed_risk_command_result_v1(p_organisation_id uuid, p_command_id text, p_replay boolean)
RETURNS TABLE (
  replay boolean, command_id text, command_kind text, subject_kind text, outcome text, command_fingerprint text,
  authorization_decision_id uuid, authorization_result text, deny_reason text, expectation_kind text,
  expected_current_state_id uuid, proposal_id uuid, governance_decision_id uuid, subject_type text,
  subject_canonical_kind text, subject_canonical_object_id text, subject_relationship_id text,
  subject_relationship_state_id text, subject_relationship_type text, scenario_definition_id uuid,
  scenario_definition_version_id uuid, scenario_content_hash text, risk_domain text, closure_reason text, state_id uuid,
  state_kind text, predecessor_state_id uuid, scenario_validated_state_id uuid, effective_from timestamptz,
  effective_to timestamptz, recorded_at timestamptz
)
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT p_replay, c.command_id, c.command_kind, c.subject_kind, c.outcome, c.command_fingerprint,
         c.authorization_decision_id, a.result, a.deny_reason, a.expectation_kind, a.expected_current_state_id,
         c.proposal_id, c.governance_decision_id, t.subject_type, t.subject_canonical_kind, t.subject_canonical_object_id,
         t.subject_relationship_id, t.subject_relationship_state_id, t.subject_relationship_type, t.scenario_definition_id,
         t.scenario_definition_version_id, t.scenario_content_hash::text, t.risk_domain, t.closure_reason, c.l15_state_id,
         s.state_kind, s.predecessor_state_id, s.scenario_validated_state_id, s.effective_from, s.effective_to, c.recorded_at
  FROM gov_repo.l14_command_results AS c
  LEFT JOIN gov_repo.l14_authorization_decisions AS a
    ON a.organisation_id = c.organisation_id AND a.authorization_decision_id = c.authorization_decision_id
  LEFT JOIN gov_repo.l15_governed_risk_proposals AS t
    ON t.organisation_id = c.organisation_id AND t.proposal_id = c.proposal_id
  LEFT JOIN gov_repo.l15_governed_risk_states AS s
    ON s.organisation_id = c.organisation_id AND s.state_id = c.l15_state_id
  WHERE c.organisation_id = p_organisation_id AND c.command_id = p_command_id AND c.subject_kind = 'GOVERNED_RISK'
    AND c.command_kind IN ('SUBMIT_PROPOSAL','DECIDE_PROPOSAL')
$$;

-- ---------------------------------------------------------------------------------------------------------------------
-- G. RPCs (SECURITY DEFINER; necessity: the L15 stores and the shared envelope have no application privilege at all, so a
--    bounded definer is the only write / read path). Owner postgres, search_path pinned, fully qualified, EXECUTE =
--    service_role only (never the machine intake capability); tenant + actor + CURRENT locked roles re-derived in-RPC from the
--    verified principal (l14_session_basis_v1); service_role is transport, never authority. Replay-first order:
--    base session -> syntactic shape -> syntactic support -> DB fingerprint -> AP guard SHARED -> (VALIDATE) scenario
--    dependency guard SHARED -> exact logical-key guard -> command guard -> replay arbitration -> tenant / subject / scenario
--    / support resolution -> CURRENT effective Authority Policy -> exact mapped L15 permission over the exact typed subject
--    -> mutation -> final base-eligibility recheck. No SET CONSTRAINTS: the S2R1 root ALLOW guard fires naturally at COMMIT.
-- ---------------------------------------------------------------------------------------------------------------------
-- G1. Proposal submission by a verified ACTIVE same-tenant human member (LOCAL_HUMAN). Grants no authority; writes no
--     authorization, decision, state or head. The caller supplies NO domain, score, likelihood, impact, rating, lifecycle,
--     owner, title, description or rationale (no such parameter exists).
CREATE FUNCTION gov_repo.l15_submit_governed_risk_proposal_v1(
  p_verified_organisation_id uuid,
  p_verified_actor_user_id uuid,
  p_verified_session_iat bigint,
  p_verified_session_exp bigint,
  p_verified_credential_epoch timestamptz,
  p_command_id text,
  p_intent text,                            -- VALIDATE | REVOKE
  p_source_class text,                      -- LOCAL_HUMAN (SOURCE_CONNECTION: not executable in S3; SYSTEM_SEED: never)
  p_subject_type text,                      -- CANONICAL_OBJECT | RELATIONSHIP_STATE
  p_subject_canonical_kind text,            -- object subject: one of the eight legal V1 kinds
  p_subject_canonical_object_id text,
  p_subject_relationship_id text,           -- relationship subject: the exact relationship_id ...
  p_subject_relationship_state_id text,     -- ... + relationship_state_id (exact triple; never a bare state id)
  p_scenario_definition_id uuid,            -- stable scenario identity (the logical key)
  p_scenario_definition_version_id uuid,    -- the exact validated scenario version
  p_scenario_content_hash text,             -- its exact PostgreSQL content hash
  p_requested_effective_from timestamptz,   -- NULL = IMMEDIATE intent
  p_requested_effective_to timestamptz,     -- NULL = open-ended; VALIDATE only; immutable
  p_expected_current_state_id uuid,         -- NULL = explicit expected-none of the logical key
  p_target_state_id uuid,                   -- REVOKE only: the exact current VALIDATED state (= the expected current)
  p_closure_reason text,                    -- REVOKE only: exactly one closed closure_reason
  p_prior_proposal_id uuid,                 -- correction link (same logical key)
  p_support_status text,
  p_support_tags text[],
  p_support_target_ids text[],
  p_caller_fingerprint text                 -- assertion only; PostgreSQL recomputes
)
RETURNS TABLE (
  replay boolean, command_id text, command_kind text, subject_kind text, outcome text, command_fingerprint text,
  authorization_decision_id uuid, authorization_result text, deny_reason text, expectation_kind text,
  expected_current_state_id uuid, proposal_id uuid, governance_decision_id uuid, subject_type text,
  subject_canonical_kind text, subject_canonical_object_id text, subject_relationship_id text,
  subject_relationship_state_id text, subject_relationship_type text, scenario_definition_id uuid,
  scenario_definition_version_id uuid, scenario_content_hash text, risk_domain text, closure_reason text, state_id uuid,
  state_kind text, predecessor_state_id uuid, scenario_validated_state_id uuid, effective_from timestamptz,
  effective_to timestamptz, recorded_at timestamptz
)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp SET lock_timeout = '5s'
AS $submit$
#variable_conflict use_column
DECLARE
  v_org uuid := p_verified_organisation_id;
  v_actor uuid := p_verified_actor_user_id;
  v_subject_key text;
  v_support text[];
  v_fingerprint text;
  v_rel record;
  v_relationship_type text;
  v_domain text;
  v_token text;
  v_target record;
  v_head uuid;
  v_proposal uuid := pg_catalog.gen_random_uuid();
  v_now timestamptz;
BEGIN
  -- 1. Any verified ACTIVE same-tenant human member. Tenant + actor come ONLY from here.
  PERFORM 1 FROM gov_repo.l14_session_basis_v1(v_org, v_actor, p_verified_session_iat,
    p_verified_session_exp, p_verified_credential_epoch);

  -- 2. Syntactic shape (no table read).
  PERFORM gov_repo.l14_validate_command_id_v1(p_command_id, p_caller_fingerprint);
  IF p_intent IS NULL OR p_intent NOT IN ('VALIDATE','REVOKE')
     OR p_source_class IS NULL OR p_source_class NOT IN ('SYSTEM_SEED','LOCAL_HUMAN','SOURCE_CONNECTION') THEN
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'PROPOSAL_VOCABULARY_UNKNOWN';
  END IF;
  IF p_source_class = 'SYSTEM_SEED' THEN
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'SYSTEM_SEED_NOT_ADMISSIBLE';
  END IF;
  IF p_source_class = 'SOURCE_CONNECTION' THEN
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'SOURCE_CLASS_NOT_EXECUTABLE';
  END IF;
  v_subject_key := gov_repo.l15_risk_subject_shape_v1(p_subject_type, p_subject_canonical_kind, p_subject_canonical_object_id,
    p_subject_relationship_id, p_subject_relationship_state_id);
  IF p_scenario_definition_id IS NULL OR p_scenario_definition_version_id IS NULL THEN
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'SCENARIO_IDS_REQUIRED';
  END IF;
  IF p_scenario_content_hash IS NULL OR p_scenario_content_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'CONTENT_HASH_MALFORMED';
  END IF;
  IF p_closure_reason IS NOT NULL AND p_closure_reason NOT IN ('RISK_NO_LONGER_APPLICABLE','SUBJECT_RETIRED',
       'DUPLICATE_OF_GOVERNED_RISK','RISK_ELIMINATED_BY_AVOIDANCE','RECORDED_IN_ERROR') THEN
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'CLOSURE_REASON_UNKNOWN';
  END IF;
  IF p_intent = 'VALIDATE' AND p_target_state_id IS NOT NULL THEN
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'TARGET_STATE_NOT_PERMITTED';
  END IF;
  IF p_intent = 'VALIDATE' AND p_closure_reason IS NOT NULL THEN
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'CLOSURE_REASON_NOT_PERMITTED';
  END IF;
  IF p_intent = 'REVOKE' AND p_target_state_id IS NULL THEN
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'TARGET_STATE_REQUIRED';
  END IF;
  IF p_intent = 'REVOKE' AND p_closure_reason IS NULL THEN
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'CLOSURE_REASON_REQUIRED';
  END IF;
  IF p_intent = 'REVOKE' AND p_requested_effective_to IS NOT NULL THEN
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'EFFECTIVE_TO_NOT_PERMITTED';
  END IF;
  IF p_intent = 'REVOKE' AND p_expected_current_state_id IS DISTINCT FROM p_target_state_id THEN
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'EXPECTATION_MALFORMED';
  END IF;
  IF p_requested_effective_to IS NOT NULL AND p_requested_effective_from IS NOT NULL
     AND NOT (p_requested_effective_to > p_requested_effective_from) THEN
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'EFFECTIVE_INTERVAL_INVALID';
  END IF;

  -- 3-4. Syntactic support, then the PostgreSQL-authoritative fingerprint over the exact key, pins and intent.
  v_support := gov_repo.l15_governed_risk_support_parts_v1(p_support_status, p_support_tags, p_support_target_ids);
  v_fingerprint := gov_repo.l14_sha256_frame_v1(
    ARRAY['L15_COMMAND_FINGERPRINT_V1', 'SUBMIT_PROPOSAL', v_org::text, v_actor::text, 'GOVERNED_RISK', p_intent,
          p_source_class, p_subject_type]
    || CASE WHEN p_subject_type = 'CANONICAL_OBJECT' THEN ARRAY[p_subject_canonical_kind, p_subject_canonical_object_id]
            ELSE ARRAY[p_subject_relationship_id, p_subject_relationship_state_id] END
    || ARRAY[p_scenario_definition_id::text, p_scenario_definition_version_id::text, p_scenario_content_hash]
    || CASE WHEN p_requested_effective_from IS NULL THEN ARRAY['IMMEDIATE']
            ELSE ARRAY['EXPLICIT', gov_repo.l14_canonical_instant_v1(p_requested_effective_from)] END
    || CASE WHEN p_requested_effective_to IS NULL THEN ARRAY['NO_EFFECTIVE_TO']
            ELSE ARRAY['EFFECTIVE_TO', gov_repo.l14_canonical_instant_v1(p_requested_effective_to)] END
    || CASE WHEN p_expected_current_state_id IS NULL THEN ARRAY['EXPECTED_NONE']
            ELSE ARRAY['EXPECTED_CURRENT', p_expected_current_state_id::text] END
    || CASE WHEN p_target_state_id IS NULL THEN ARRAY['NO_TARGET_STATE'] ELSE ARRAY['TARGET_STATE', p_target_state_id::text] END
    || CASE WHEN p_closure_reason IS NULL THEN ARRAY['NO_CLOSURE_REASON'] ELSE ARRAY['CLOSURE_REASON', p_closure_reason] END
    || CASE WHEN p_prior_proposal_id IS NULL THEN ARRAY['NO_PRIOR_PROPOSAL'] ELSE ARRAY['PRIOR_PROPOSAL', p_prior_proposal_id::text] END
    || v_support);
  IF v_fingerprint IS DISTINCT FROM p_caller_fingerprint THEN
    RAISE EXCEPTION 'L14_FINGERPRINT_MISMATCH' USING ERRCODE = 'GV008', DETAIL = 'CALLER_FINGERPRINT_DIFFERS';
  END IF;

  -- 5-7. Guards (AP shared, exact logical key, command), then replay arbitration BEFORE any resolution.
  PERFORM gov_repo.l14_lock_authority_policy_guard_shared_v1(v_org);
  PERFORM gov_repo.l15_lock_governed_risk_key_guard_v1(v_org, v_subject_key, p_scenario_definition_id);
  PERFORM gov_repo.l14_lock_command_guard_v1(v_org, p_command_id);
  IF gov_repo.l14_replay_arbitrate_v1(v_org, p_command_id, v_fingerprint) THEN
    PERFORM 1 FROM gov_repo.l14_session_basis_v1(v_org, v_actor, p_verified_session_iat,
      p_verified_session_exp, p_verified_credential_epoch);
    RETURN QUERY SELECT * FROM gov_repo.l15_governed_risk_command_result_v1(v_org, p_command_id, true);
    RETURN;
  END IF;

  -- 8. Resolution: the exact subject of THIS organisation (a foreign / wrong-kind / swapped / unknown subject is
  --    indistinguishable), the exact admitted scenario tuple of THIS organisation and its DB domain, the closed §8.2 matrix,
  --    the scenario's declared subject kinds, scenario validity (VALIDATE), the expectation, the exact REVOKE target.
  IF p_subject_type = 'CANONICAL_OBJECT' THEN
    PERFORM 1 FROM gov_repo.canonical_objects AS o
    WHERE o.organisation_id = v_org AND o.canonical_object_id = p_subject_canonical_object_id AND o.kind = p_subject_canonical_kind;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'SUBJECT_OBJECT_UNRESOLVED';
    END IF;
  ELSE
    SELECT r.match_count, r.relationship_type INTO v_rel
    FROM gov_repo.l14_resolve_relationship_state_target_v1(v_org, p_subject_relationship_id, p_subject_relationship_state_id) AS r;
    IF v_rel.match_count = 0 THEN
      RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'SUBJECT_RELATIONSHIP_STATE_UNRESOLVED';
    END IF;
    IF v_rel.match_count <> 1 THEN
      RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'SUBJECT_RELATIONSHIP_STATE_AMBIGUOUS';
    END IF;
    v_relationship_type := v_rel.relationship_type;
  END IF;
  SELECT v.risk_domain INTO v_domain
  FROM gov_repo.l15_risk_scenario_definition_versions AS v
  WHERE v.organisation_id = v_org AND v.scenario_definition_id = p_scenario_definition_id
    AND v.scenario_definition_version_id = p_scenario_definition_version_id AND v.content_hash = p_scenario_content_hash;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'SCENARIO_VERSION_NOT_ADMITTED';
  END IF;
  v_token := gov_repo.l15_risk_subject_token_v1(p_subject_type, p_subject_canonical_kind, v_relationship_type);
  IF NOT gov_repo.l15_risk_domain_subject_legal_v1(v_domain, v_token) THEN
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'DOMAIN_SUBJECT_ILLEGAL';
  END IF;
  PERFORM 1 FROM gov_repo.l15_risk_scenario_definition_subject_kinds AS sk
  WHERE sk.organisation_id = v_org AND sk.scenario_definition_version_id = p_scenario_definition_version_id AND sk.subject_kind = v_token;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'SCENARIO_SUBJECT_KIND_NOT_DECLARED';
  END IF;
  v_now := pg_catalog.clock_timestamp();
  IF p_intent = 'VALIDATE' AND NOT EXISTS (
       SELECT 1 FROM gov_repo.l15_risk_scenario_definition_valid_state_v1(v_org, p_scenario_definition_id,
         p_scenario_definition_version_id, p_scenario_content_hash, COALESCE(p_requested_effective_from, v_now), v_now)) THEN
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'SCENARIO_VERSION_NOT_VALID';
  END IF;
  SELECT h.latest_state_id INTO v_head FROM gov_repo.l15_governed_risk_heads AS h
  WHERE h.organisation_id = v_org AND h.subject_key = v_subject_key AND h.scenario_definition_id = p_scenario_definition_id;
  IF p_expected_current_state_id IS NULL AND v_head IS NOT NULL THEN
    RAISE EXCEPTION 'L15_STALE_EXPECTATION' USING ERRCODE = 'GV009', DETAIL = 'GOVERNED_RISK_STATE_EXISTS';
  END IF;
  IF p_expected_current_state_id IS DISTINCT FROM v_head THEN
    RAISE EXCEPTION 'L15_STALE_EXPECTATION' USING ERRCODE = 'GV009', DETAIL = 'GOVERNED_RISK_STATE_EXPECTATION_MISMATCH';
  END IF;
  IF p_intent = 'REVOKE' THEN
    SELECT s.state_kind, s.subject_key, s.scenario_definition_id, s.scenario_definition_version_id, s.scenario_content_hash
    INTO v_target
    FROM gov_repo.l15_governed_risk_states AS s WHERE s.organisation_id = v_org AND s.state_id = p_target_state_id;
    IF NOT FOUND OR v_target.subject_key <> v_subject_key OR v_target.scenario_definition_id <> p_scenario_definition_id
       OR v_target.scenario_definition_version_id <> p_scenario_definition_version_id
       OR v_target.scenario_content_hash::text <> p_scenario_content_hash THEN
      RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'TARGET_STATE_UNRESOLVED';
    END IF;
    IF v_target.state_kind <> 'VALIDATED' THEN
      RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'TARGET_STATE_NOT_VALIDATED';
    END IF;
    PERFORM 1 FROM gov_repo.l15_governed_risk_states AS s
    WHERE s.organisation_id = v_org AND s.state_kind = 'REVOKED' AND s.revokes_state_id = p_target_state_id;
    IF FOUND THEN
      RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'TARGET_ALREADY_REVOKED';
    END IF;
  END IF;
  IF p_prior_proposal_id IS NOT NULL THEN
    PERFORM 1 FROM gov_repo.l15_governed_risk_proposals AS cp
    WHERE cp.organisation_id = v_org AND cp.proposal_id = p_prior_proposal_id AND cp.subject_key = v_subject_key
      AND cp.scenario_definition_id = p_scenario_definition_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'PRIOR_PROPOSAL_UNRESOLVED';
    END IF;
  END IF;
  PERFORM 1 FROM gov_repo.l15_normalize_support_v1(v_org, p_support_tags, p_support_target_ids);

  -- 9. Envelope + typed detail + support + durable result. Nothing else.
  INSERT INTO gov_repo.l14_proposals (organisation_id, proposal_id, subject_kind, intent, source_class,
    submitted_by_actor_user_id, prior_proposal_id, support_status, submitted_at)
  VALUES (v_org, v_proposal, 'GOVERNED_RISK', p_intent, p_source_class, v_actor, p_prior_proposal_id, p_support_status, v_now);
  INSERT INTO gov_repo.l15_governed_risk_proposals (organisation_id, proposal_id, intent, subject_type, subject_canonical_kind,
    subject_canonical_object_id, subject_relationship_id, subject_relationship_state_id, subject_relationship_type,
    scenario_definition_id, scenario_definition_version_id, scenario_content_hash, risk_domain, requested_effective_from,
    requested_effective_to, expected_current_state_id, target_state_id, closure_reason)
  VALUES (v_org, v_proposal, p_intent, p_subject_type, p_subject_canonical_kind, p_subject_canonical_object_id,
    p_subject_relationship_id, p_subject_relationship_state_id, v_relationship_type, p_scenario_definition_id,
    p_scenario_definition_version_id, p_scenario_content_hash, v_domain, p_requested_effective_from, p_requested_effective_to,
    p_expected_current_state_id, p_target_state_id, p_closure_reason);
  PERFORM gov_repo.l15_write_governed_risk_support_links_v1(v_org, 'PROPOSAL', v_proposal, NULL, NULL,
    p_support_tags, p_support_target_ids);
  INSERT INTO gov_repo.l14_command_results (organisation_id, command_id, command_kind, subject_kind,
    command_fingerprint, actor_user_id, outcome, proposal_id, recorded_at)
  VALUES (v_org, p_command_id, 'SUBMIT_PROPOSAL', 'GOVERNED_RISK', v_fingerprint, v_actor, 'SUBMITTED', v_proposal, v_now);

  PERFORM 1 FROM gov_repo.l14_session_basis_v1(v_org, v_actor, p_verified_session_iat,
    p_verified_session_exp, p_verified_credential_epoch);
  RETURN QUERY SELECT * FROM gov_repo.l15_governed_risk_command_result_v1(v_org, p_command_id, false);
END;
$submit$;

-- G2. Governance decision on a GOVERNED_RISK proposal. VALIDATE intent: VALIDATE / REJECT / DEFER. REVOKE intent:
--     REVOKE / REJECT / DEFER. DEFER is non-terminal. L15_GOVERNED_RISK_VALIDATE governs all four (requested action = the
--     exact outcome), evaluated over the exact typed subject (CANONICAL_OBJECT or RELATIONSHIP_STATE). closure_reason: exactly
--     one (= the proposal's) for REVOKE; absent otherwise. REJECT / DEFER / DENY write no state and move no head.
CREATE FUNCTION gov_repo.l15_decide_governed_risk_proposal_v1(
  p_verified_organisation_id uuid,
  p_verified_actor_user_id uuid,
  p_verified_session_iat bigint,
  p_verified_session_exp bigint,
  p_verified_credential_epoch timestamptz,
  p_command_id text,
  p_proposal_id uuid,
  p_outcome text,
  p_reason_code text,
  p_closure_reason text,                    -- REVOKE only (must equal the proposal's); NULL otherwise
  p_expected_current_state_id uuid,         -- NULL = explicit expected-none
  p_support_status text,
  p_support_tags text[],
  p_support_target_ids text[],
  p_caller_fingerprint text                 -- assertion only; PostgreSQL recomputes
)
RETURNS TABLE (
  replay boolean, command_id text, command_kind text, subject_kind text, outcome text, command_fingerprint text,
  authorization_decision_id uuid, authorization_result text, deny_reason text, expectation_kind text,
  expected_current_state_id uuid, proposal_id uuid, governance_decision_id uuid, subject_type text,
  subject_canonical_kind text, subject_canonical_object_id text, subject_relationship_id text,
  subject_relationship_state_id text, subject_relationship_type text, scenario_definition_id uuid,
  scenario_definition_version_id uuid, scenario_content_hash text, risk_domain text, closure_reason text, state_id uuid,
  state_kind text, predecessor_state_id uuid, scenario_validated_state_id uuid, effective_from timestamptz,
  effective_to timestamptz, recorded_at timestamptz
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
  v_rel record;
  v_head_found boolean;
  v_head_latest uuid;
  v_latest_kind text;
  v_latest_from timestamptz;
  v_latest_to timestamptz;
  v_latest_version uuid;
  v_latest_hash text;
  v_latest_scenario_state uuid;
  v_target_state_id uuid;
  v_scenario_state uuid;
  v_has_basis boolean := false;
  v_basis_policy uuid;
  v_basis_version uuid;
  v_basis_hash text;
  v_deny text;
  v_ordinals integer[];
  v_self boolean;
  v_temporal text := 'IMMEDIATE';
  v_effective_from timestamptz;
  v_effective_to timestamptz;
  v_now timestamptz;
  v_authz uuid := pg_catalog.gen_random_uuid();
  v_decision uuid := pg_catalog.gen_random_uuid();
  v_state uuid := pg_catalog.gen_random_uuid();
  v_state_kind text;
BEGIN
  -- 1. Base session eligibility. Tenant + actor + CURRENT locked persisted roles come ONLY from here.
  SELECT b.role_ids INTO v_role_ids
  FROM gov_repo.l14_session_basis_v1(v_org, v_actor, p_verified_session_iat, p_verified_session_exp,
    p_verified_credential_epoch) AS b;

  -- 2. Syntactic shape: the unchanged subject x outcome reason rule; the closed closure_reason field.
  PERFORM gov_repo.l14_validate_command_id_v1(p_command_id, p_caller_fingerprint);
  IF p_outcome IS NULL OR p_outcome NOT IN ('VALIDATE','REJECT','DEFER','REVOKE')
     OR p_reason_code IS NULL OR p_reason_code NOT IN (
       'GOVERNED_RISK_VALIDATED','GOVERNED_RISK_REJECTED','GOVERNED_RISK_DEFERRED','GOVERNED_RISK_REVOKED')
     OR NOT ((p_outcome = 'VALIDATE' AND p_reason_code = 'GOVERNED_RISK_VALIDATED')
          OR (p_outcome = 'REJECT' AND p_reason_code = 'GOVERNED_RISK_REJECTED')
          OR (p_outcome = 'DEFER' AND p_reason_code = 'GOVERNED_RISK_DEFERRED')
          OR (p_outcome = 'REVOKE' AND p_reason_code = 'GOVERNED_RISK_REVOKED')) THEN
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'DECISION_VOCABULARY_INVALID';
  END IF;
  IF p_closure_reason IS NOT NULL AND p_closure_reason NOT IN ('RISK_NO_LONGER_APPLICABLE','SUBJECT_RETIRED',
       'DUPLICATE_OF_GOVERNED_RISK','RISK_ELIMINATED_BY_AVOIDANCE','RECORDED_IN_ERROR') THEN
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'CLOSURE_REASON_UNKNOWN';
  END IF;
  IF p_outcome = 'REVOKE' AND p_closure_reason IS NULL THEN
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'CLOSURE_REASON_REQUIRED';
  END IF;
  IF p_outcome <> 'REVOKE' AND p_closure_reason IS NOT NULL THEN
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'CLOSURE_REASON_NOT_PERMITTED';
  END IF;
  -- The immutable proposal defines the command identity; it is the only row read before replay arbitration.
  SELECT p.proposal_id, p.intent, p.source_class, p.submitted_by_actor_user_id,
         t.subject_type, t.subject_canonical_kind, t.subject_canonical_object_id, t.subject_relationship_id,
         t.subject_relationship_state_id, t.subject_relationship_type, t.subject_key, t.scenario_definition_id,
         t.scenario_definition_version_id, t.scenario_content_hash::text AS scenario_content_hash, t.risk_domain,
         t.requested_effective_from, t.requested_effective_to, t.expected_current_state_id, t.target_state_id, t.closure_reason
  INTO v_proposal
  FROM gov_repo.l14_proposals AS p
  JOIN gov_repo.l15_governed_risk_proposals AS t ON t.organisation_id = p.organisation_id AND t.proposal_id = p.proposal_id
  WHERE p.organisation_id = v_org AND p.proposal_id = p_proposal_id AND p.subject_kind = 'GOVERNED_RISK';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'PROPOSAL_UNRESOLVED';
  END IF;
  IF (p_outcome = 'VALIDATE' AND v_proposal.intent <> 'VALIDATE') OR (p_outcome = 'REVOKE' AND v_proposal.intent <> 'REVOKE') THEN
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'OUTCOME_INTENT_INCOMPATIBLE';
  END IF;
  IF p_outcome = 'REVOKE' AND p_closure_reason IS DISTINCT FROM v_proposal.closure_reason THEN
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'CLOSURE_REASON_MISMATCH';
  END IF;

  -- 3-4. Syntactic support, then the PostgreSQL-authoritative fingerprint.
  v_support := gov_repo.l15_governed_risk_support_parts_v1(p_support_status, p_support_tags, p_support_target_ids);
  v_fingerprint := gov_repo.l14_sha256_frame_v1(
    ARRAY['L15_COMMAND_FINGERPRINT_V1', 'DECIDE_PROPOSAL', v_org::text, v_actor::text, p_outcome, p_reason_code,
          v_proposal.proposal_id::text, 'GOVERNED_RISK', v_proposal.intent, v_proposal.source_class, v_proposal.subject_type]
    || CASE WHEN v_proposal.subject_type = 'CANONICAL_OBJECT'
            THEN ARRAY[v_proposal.subject_canonical_kind, v_proposal.subject_canonical_object_id]
            ELSE ARRAY[v_proposal.subject_relationship_id, v_proposal.subject_relationship_state_id] END
    || ARRAY[v_proposal.scenario_definition_id::text, v_proposal.scenario_definition_version_id::text, v_proposal.scenario_content_hash]
    || CASE WHEN v_proposal.requested_effective_from IS NULL THEN ARRAY['IMMEDIATE']
            ELSE ARRAY['EXPLICIT', gov_repo.l14_canonical_instant_v1(v_proposal.requested_effective_from)] END
    || CASE WHEN v_proposal.requested_effective_to IS NULL THEN ARRAY['NO_EFFECTIVE_TO']
            ELSE ARRAY['EFFECTIVE_TO', gov_repo.l14_canonical_instant_v1(v_proposal.requested_effective_to)] END
    || CASE WHEN v_proposal.target_state_id IS NULL THEN ARRAY['NO_TARGET_STATE']
            ELSE ARRAY['TARGET_STATE', v_proposal.target_state_id::text] END
    || CASE WHEN p_expected_current_state_id IS NULL THEN ARRAY['EXPECTED_NONE']
            ELSE ARRAY['EXPECTED_CURRENT', p_expected_current_state_id::text] END
    || CASE WHEN p_closure_reason IS NULL THEN ARRAY['NO_CLOSURE_REASON'] ELSE ARRAY['CLOSURE_REASON', p_closure_reason] END
    || v_support);
  IF v_fingerprint IS DISTINCT FROM p_caller_fingerprint THEN
    RAISE EXCEPTION 'L14_FINGERPRINT_MISMATCH' USING ERRCODE = 'GV008', DETAIL = 'CALLER_FINGERPRINT_DIFFERS';
  END IF;

  -- 5-7. Guards in the fixed order: AP SHARED -> (VALIDATE only) exact scenario dependency SHARED (the S2 registry subject
  --      key, held to commit) -> exact logical KEY -> command; then replay arbitration BEFORE any resolution. REVOKE /
  --      REJECT / DEFER never wait on the dependency (explicit closure stays possible).
  PERFORM gov_repo.l14_lock_authority_policy_guard_shared_v1(v_org);
  IF p_outcome = 'VALIDATE' THEN
    PERFORM gov_repo.l15_lock_scenario_dependency_guard_shared_v1(v_org, v_proposal.scenario_definition_id,
      v_proposal.scenario_definition_version_id, v_proposal.scenario_content_hash);
  END IF;
  PERFORM gov_repo.l15_lock_governed_risk_key_guard_v1(v_org, v_proposal.subject_key, v_proposal.scenario_definition_id);
  PERFORM gov_repo.l14_lock_command_guard_v1(v_org, p_command_id);
  IF gov_repo.l14_replay_arbitrate_v1(v_org, p_command_id, v_fingerprint) THEN
    PERFORM 1 FROM gov_repo.l14_session_basis_v1(v_org, v_actor, p_verified_session_iat,
      p_verified_session_exp, p_verified_credential_epoch);
    RETURN QUERY SELECT * FROM gov_repo.l15_governed_risk_command_result_v1(v_org, p_command_id, true);
    RETURN;
  END IF;

  -- 8. Resolution under the guards: terminality, exact subject, head expectation (= the proposal's own explicit
  --    expectation), per-key lineage rules, the exact REVOKE target, support.
  PERFORM 1 FROM gov_repo.l14_governance_decisions AS d
  WHERE d.organisation_id = v_org AND d.proposal_id = p_proposal_id AND d.outcome IN ('VALIDATE','REJECT','REVOKE');
  IF FOUND THEN
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'PROPOSAL_TERMINAL';
  END IF;
  IF v_proposal.subject_type = 'CANONICAL_OBJECT' THEN
    PERFORM 1 FROM gov_repo.canonical_objects AS o
    WHERE o.organisation_id = v_org AND o.canonical_object_id = v_proposal.subject_canonical_object_id
      AND o.kind = v_proposal.subject_canonical_kind;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'SUBJECT_OBJECT_UNRESOLVED';
    END IF;
  ELSE
    SELECT r.match_count, r.relationship_type INTO v_rel
    FROM gov_repo.l14_resolve_relationship_state_target_v1(v_org, v_proposal.subject_relationship_id,
      v_proposal.subject_relationship_state_id) AS r;
    IF v_rel.match_count = 0 THEN
      RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'SUBJECT_RELATIONSHIP_STATE_UNRESOLVED';
    END IF;
    IF v_rel.match_count <> 1 THEN
      RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'SUBJECT_RELATIONSHIP_STATE_AMBIGUOUS';
    END IF;
    IF v_rel.relationship_type IS DISTINCT FROM v_proposal.subject_relationship_type THEN
      RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'SUBJECT_RELATIONSHIP_TYPE_CHANGED';
    END IF;
  END IF;
  SELECT h.latest_state_id INTO v_head_latest FROM gov_repo.l15_governed_risk_heads AS h
  WHERE h.organisation_id = v_org AND h.subject_key = v_proposal.subject_key AND h.scenario_definition_id = v_proposal.scenario_definition_id;
  v_head_found := FOUND;
  IF p_expected_current_state_id IS NULL AND v_head_latest IS NOT NULL THEN
    RAISE EXCEPTION 'L15_STALE_EXPECTATION' USING ERRCODE = 'GV009', DETAIL = 'GOVERNED_RISK_STATE_EXISTS';
  END IF;
  IF p_expected_current_state_id IS DISTINCT FROM v_head_latest
     OR p_expected_current_state_id IS DISTINCT FROM v_proposal.expected_current_state_id THEN
    RAISE EXCEPTION 'L15_STALE_EXPECTATION' USING ERRCODE = 'GV009', DETAIL = 'GOVERNED_RISK_STATE_EXPECTATION_MISMATCH';
  END IF;
  IF v_head_latest IS NOT NULL THEN
    SELECT s.state_kind, s.effective_from, s.effective_to, s.scenario_definition_version_id, s.scenario_content_hash::text,
           s.scenario_validated_state_id
    INTO v_latest_kind, v_latest_from, v_latest_to, v_latest_version, v_latest_hash, v_latest_scenario_state
    FROM gov_repo.l15_governed_risk_states AS s WHERE s.organisation_id = v_org AND s.state_id = v_head_latest;
  END IF;
  IF p_outcome = 'VALIDATE' AND v_latest_kind = 'VALIDATED' AND v_latest_to IS NULL
     AND v_latest_version = v_proposal.scenario_definition_version_id
     AND v_latest_hash = v_proposal.scenario_content_hash THEN
    -- A successor must change something: an explicit repin to another scenario version (never automatic).
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'GOVERNED_RISK_ALREADY_VALIDATED';
  END IF;
  IF p_outcome = 'REVOKE' THEN
    PERFORM 1 FROM gov_repo.l15_governed_risk_states AS r
    WHERE r.organisation_id = v_org AND r.state_kind = 'REVOKED' AND r.revokes_state_id = v_proposal.target_state_id;
    IF FOUND THEN
      RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'TARGET_ALREADY_REVOKED';
    END IF;
    IF v_head_latest IS DISTINCT FROM v_proposal.target_state_id OR v_latest_kind IS DISTINCT FROM 'VALIDATED' THEN
      RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'TARGET_STATE_NOT_CURRENT';
    END IF;
    v_target_state_id := v_proposal.target_state_id;
  END IF;
  PERFORM 1 FROM gov_repo.l15_normalize_support_v1(v_org, p_support_tags, p_support_target_ids);

  -- 9. One DB evaluation instant; temporal class (M16 §17 verbatim, no skew tolerance); the CURRENT effective policy is the
  --    ONLY basis, evaluated over the exact typed subject. Never L14_*, another L15 permission, service_role, machine
  --    capability, source class, confidence, severity, count, domain or rating.
  v_now := pg_catalog.clock_timestamp();
  IF p_outcome IN ('VALIDATE','REVOKE') THEN
    IF v_proposal.requested_effective_from IS NULL OR v_proposal.requested_effective_from = v_now THEN
      v_effective_from := v_now;
    ELSIF v_proposal.requested_effective_from < v_now THEN
      v_effective_from := v_proposal.requested_effective_from;
      v_temporal := 'BACKDATED';
    ELSE
      v_effective_from := v_proposal.requested_effective_from;
      v_temporal := 'FUTURE_DATED';
    END IF;
    IF p_outcome = 'VALIDATE' THEN
      v_effective_to := v_proposal.requested_effective_to;
    END IF;
  END IF;
  v_self := v_proposal.submitted_by_actor_user_id = v_actor;
  SELECT b.authority_policy_id, b.version_id, b.content_hash INTO v_basis_policy, v_basis_version, v_basis_hash
  FROM gov_repo.l14_effective_authority_basis_v1(v_org, v_now) AS b;
  v_has_basis := FOUND;
  IF NOT v_has_basis THEN
    v_deny := 'NO_EFFECTIVE_AUTHORITY';
  ELSIF v_proposal.subject_type = 'CANONICAL_OBJECT' THEN
    SELECT e.deny_reason, e.rule_ordinals INTO v_deny, v_ordinals
    FROM gov_repo.l14_evaluate_target_authority_rules_v1(v_org, v_basis_policy, v_basis_version, v_role_ids,
      gov_repo.l15_governance_permission_v1('GOVERNED_RISK', p_outcome), p_outcome, p_outcome = 'VALIDATE' AND v_self, v_temporal,
      v_proposal.subject_canonical_kind, v_proposal.subject_canonical_object_id) AS e;
  ELSE
    SELECT e.deny_reason, e.rule_ordinals INTO v_deny, v_ordinals
    FROM gov_repo.l14_evaluate_relationship_state_authority_rules_v1(v_org, v_basis_policy, v_basis_version, v_role_ids,
      gov_repo.l15_governance_permission_v1('GOVERNED_RISK', p_outcome), p_outcome, p_outcome = 'VALIDATE' AND v_self, v_temporal,
      v_proposal.subject_relationship_type, v_proposal.subject_relationship_id, v_proposal.subject_relationship_state_id) AS e;
  END IF;

  INSERT INTO gov_repo.l14_authorization_decisions (
    organisation_id, authorization_decision_id, command_id, command_fingerprint, actor_user_id,
    requested_action, subject_kind, scope_tag, target_canonical_kind, target_canonical_object_id,
    target_relationship_type, target_relationship_id, target_relationship_state_id, source_class,
    proposal_id, is_self_validation, authority_basis, basis_authority_policy_id, basis_version_id, basis_content_hash,
    result, deny_reason, evaluated_at, expectation_kind, expected_current_state_id)
  VALUES (
    v_org, v_authz, p_command_id, v_fingerprint, v_actor,
    p_outcome, 'GOVERNED_RISK', v_proposal.subject_type, v_proposal.subject_canonical_kind,
    v_proposal.subject_canonical_object_id, v_proposal.subject_relationship_type, v_proposal.subject_relationship_id,
    v_proposal.subject_relationship_state_id, v_proposal.source_class, p_proposal_id, v_self,
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
  -- The S2R1 root L15 ALLOW guard (owner-only SECURITY DEFINER, DEFERRABLE INITIALLY DEFERRED) is NOT forced here: it fires
  -- naturally at COMMIT in the committing (service_role) session with its full check.

  IF v_deny IS NOT NULL THEN
    -- Durable DENY: authorization + result only; consumes the command id; no decision, no state, no head change.
    INSERT INTO gov_repo.l14_command_results (organisation_id, command_id, command_kind, subject_kind,
      command_fingerprint, actor_user_id, outcome, authorization_decision_id, proposal_id, recorded_at)
    VALUES (v_org, p_command_id, 'DECIDE_PROPOSAL', 'GOVERNED_RISK', v_fingerprint, v_actor, 'DENIED', v_authz, p_proposal_id, v_now);
  ELSE
    -- 10. Interval and dependency rules (authorized commands only; a violation raises and rolls back the WHOLE command:
    --     nothing is consumed).
    IF v_effective_to IS NOT NULL AND NOT (v_effective_to > v_effective_from) THEN
      RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'EFFECTIVE_INTERVAL_INVALID';
    END IF;
    IF p_outcome = 'REVOKE' AND v_effective_from < v_latest_from THEN
      RAISE EXCEPTION 'L15_CONTINUITY_VIOLATION' USING ERRCODE = 'GV011', DETAIL = 'REVOKE_BEFORE_TARGET_EFFECTIVE';
    END IF;
    IF p_outcome = 'REVOKE' AND v_latest_to IS NOT NULL AND v_effective_from >= v_latest_to THEN
      RAISE EXCEPTION 'L15_CONTINUITY_VIOLATION' USING ERRCODE = 'GV011', DETAIL = 'REVOKE_AFTER_TARGET_EXPIRY';
    END IF;
    IF p_outcome = 'VALIDATE' AND v_latest_kind = 'REVOKED' AND NOT (v_effective_from >= v_latest_from) THEN
      RAISE EXCEPTION 'L15_CONTINUITY_VIOLATION' USING ERRCODE = 'GV011', DETAIL = 'REVALIDATION_OVERLAPS_PRIOR_INTERVAL';
    END IF;
    IF p_outcome = 'VALIDATE' AND v_latest_kind = 'VALIDATED' AND v_effective_from < v_latest_from THEN
      RAISE EXCEPTION 'L15_CONTINUITY_VIOLATION' USING ERRCODE = 'GV011', DETAIL = 'SUCCESSOR_BEFORE_PREDECESSOR_EFFECTIVE';
    END IF;
    IF p_outcome = 'VALIDATE' AND v_latest_kind = 'VALIDATED' AND v_latest_to IS NOT NULL
       AND v_effective_from < v_latest_to THEN
      RAISE EXCEPTION 'L15_CONTINUITY_VIOLATION' USING ERRCODE = 'GV011', DETAIL = 'SUCCESSOR_BEFORE_PREDECESSOR_END';
    END IF;
    IF p_outcome = 'VALIDATE' THEN
      -- The exact pinned scenario version must be THE VALIDATED, non-revoked, effective scenario state of that exact tuple at
      -- the requested effective instant as known now, under the shared dependency guard (never latest, never a successor).
      SELECT sv.state_id INTO v_scenario_state
      FROM gov_repo.l15_risk_scenario_definition_valid_state_v1(v_org, v_proposal.scenario_definition_id,
        v_proposal.scenario_definition_version_id, v_proposal.scenario_content_hash, v_effective_from, v_now) AS sv;
      IF v_scenario_state IS NULL THEN
        RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'SCENARIO_DEPENDENCY_NOT_VALID';
      END IF;
    ELSIF p_outcome = 'REVOKE' THEN
      v_scenario_state := v_latest_scenario_state;
    END IF;

    INSERT INTO gov_repo.l14_governance_decisions (organisation_id, governance_decision_id, proposal_id,
      subject_kind, outcome, reason_code, authorization_decision_id, actor_user_id, support_status, decided_at)
    VALUES (v_org, v_decision, p_proposal_id, 'GOVERNED_RISK', p_outcome, p_reason_code, v_authz, v_actor, p_support_status, v_now);
    PERFORM gov_repo.l15_write_governed_risk_support_links_v1(v_org, 'DECISION', NULL, v_decision, NULL,
      p_support_tags, p_support_target_ids);
    IF p_outcome IN ('VALIDATE','REVOKE') THEN
      v_state_kind := CASE WHEN p_outcome = 'VALIDATE' THEN 'VALIDATED' ELSE 'REVOKED' END;
      -- Append-only: predecessor = the expected head state; the predecessor row is never modified (its closure is derived).
      INSERT INTO gov_repo.l15_governed_risk_states (organisation_id, state_id, state_kind, subject_type, subject_canonical_kind,
        subject_canonical_object_id, subject_relationship_id, subject_relationship_state_id, subject_relationship_type,
        scenario_definition_id, scenario_definition_version_id, scenario_content_hash, scenario_validated_state_id, risk_domain,
        predecessor_state_id, revokes_state_id, closure_reason, effective_from, effective_to, recorded_at, proposal_id,
        governance_decision_id, authorization_decision_id, authority_policy_id, authority_policy_version_id,
        authority_policy_content_hash, source_class, support_status)
      VALUES (v_org, v_state, v_state_kind, v_proposal.subject_type, v_proposal.subject_canonical_kind,
        v_proposal.subject_canonical_object_id, v_proposal.subject_relationship_id, v_proposal.subject_relationship_state_id,
        v_proposal.subject_relationship_type, v_proposal.scenario_definition_id, v_proposal.scenario_definition_version_id,
        v_proposal.scenario_content_hash, v_scenario_state, v_proposal.risk_domain, v_head_latest, v_target_state_id,
        CASE WHEN p_outcome = 'REVOKE' THEN v_proposal.closure_reason END, v_effective_from, v_effective_to, v_now, p_proposal_id,
        v_decision, v_authz, v_basis_policy, v_basis_version, v_basis_hash, v_proposal.source_class, p_support_status);
      IF NOT v_head_found THEN
        INSERT INTO gov_repo.l15_governed_risk_heads (organisation_id, subject_type, subject_canonical_kind,
          subject_canonical_object_id, subject_relationship_id, subject_relationship_state_id, scenario_definition_id, latest_state_id)
        VALUES (v_org, v_proposal.subject_type, v_proposal.subject_canonical_kind, v_proposal.subject_canonical_object_id,
          v_proposal.subject_relationship_id, v_proposal.subject_relationship_state_id, v_proposal.scenario_definition_id, NULL);
      END IF;
      UPDATE gov_repo.l15_governed_risk_heads AS h SET latest_state_id = v_state
      WHERE h.organisation_id = v_org AND h.subject_key = v_proposal.subject_key
        AND h.scenario_definition_id = v_proposal.scenario_definition_id
        AND h.latest_state_id IS NOT DISTINCT FROM p_expected_current_state_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'L15_STALE_EXPECTATION' USING ERRCODE = 'GV009', DETAIL = 'GOVERNED_RISK_STATE_EXPECTATION_MISMATCH';
      END IF;
      PERFORM gov_repo.l15_write_governed_risk_support_links_v1(v_org, 'STATE', NULL, NULL, v_state,
        p_support_tags, p_support_target_ids);
      INSERT INTO gov_repo.l14_command_results (organisation_id, command_id, command_kind, subject_kind,
        command_fingerprint, actor_user_id, outcome, authorization_decision_id, proposal_id, governance_decision_id,
        l15_state_id, recorded_at)
      VALUES (v_org, p_command_id, 'DECIDE_PROPOSAL', 'GOVERNED_RISK', v_fingerprint, v_actor, v_state_kind,
        v_authz, p_proposal_id, v_decision, v_state, v_now);
    ELSE
      -- REJECT / DEFER: governance decision only; no state, no head change.
      INSERT INTO gov_repo.l14_command_results (organisation_id, command_id, command_kind, subject_kind,
        command_fingerprint, actor_user_id, outcome, authorization_decision_id, proposal_id, governance_decision_id, recorded_at)
      VALUES (v_org, p_command_id, 'DECIDE_PROPOSAL', 'GOVERNED_RISK', v_fingerprint, v_actor,
        CASE WHEN p_outcome = 'REJECT' THEN 'REJECTED' ELSE 'DEFERRED' END, v_authz, p_proposal_id, v_decision, v_now);
    END IF;
  END IF;

  -- 11. Base session eligibility at commitment (same-transaction final recheck).
  PERFORM 1 FROM gov_repo.l14_session_basis_v1(v_org, v_actor, p_verified_session_iat,
    p_verified_session_exp, p_verified_credential_epoch);
  RETURN QUERY SELECT * FROM gov_repo.l15_governed_risk_command_result_v1(v_org, p_command_id, false);
END;
$decide$;

-- G3. Read projection (verified ACTIVE same-tenant member; read-only; persists nothing): the exact logical key at
--     (effective_at, recorded_cutoff) (NULL = the DB instant): the closed resolution (CURRENT or the named not-current
--     reason), the resolved / latest visible state with its full lineage pins, and its O44 support currency naming the first
--     failing link. A subject with no governed risk is UNKNOWN (NO_STATE), never "no risk" / "low risk".
CREATE FUNCTION gov_repo.l15_read_governed_risk_v1(
  p_verified_organisation_id uuid,
  p_verified_actor_user_id uuid,
  p_verified_session_iat bigint,
  p_verified_session_exp bigint,
  p_verified_credential_epoch timestamptz,
  p_subject_type text,
  p_subject_canonical_kind text,
  p_subject_canonical_object_id text,
  p_subject_relationship_id text,
  p_subject_relationship_state_id text,
  p_scenario_definition_id uuid,
  p_effective_at timestamptz,               -- NULL = the DB instant
  p_recorded_cutoff timestamptz             -- NULL = the DB instant
)
RETURNS TABLE (
  resolution text, effective_at timestamptz, recorded_cutoff timestamptz, state_id uuid, state_kind text, risk_domain text,
  scenario_definition_version_id uuid, scenario_content_hash text, scenario_validated_state_id uuid,
  predecessor_state_id uuid, revokes_state_id uuid, closure_reason text, effective_from timestamptz, effective_to timestamptz,
  recorded_at timestamptz, proposal_id uuid, governance_decision_id uuid, authorization_decision_id uuid,
  authority_policy_id uuid, authority_policy_version_id uuid, authority_policy_content_hash text, source_class text,
  support_currency text, support_link_count bigint, degraded_link_count bigint, failing_link_id uuid, failing_reason text,
  failing_upstream_link_id uuid
)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp SET lock_timeout = '5s'
AS $read$
#variable_conflict use_column
DECLARE
  v_org uuid := p_verified_organisation_id;
  v_at timestamptz;
  v_cutoff timestamptz;
BEGIN
  PERFORM 1 FROM gov_repo.l14_session_basis_v1(v_org, p_verified_actor_user_id, p_verified_session_iat,
    p_verified_session_exp, p_verified_credential_epoch);
  PERFORM gov_repo.l15_risk_subject_shape_v1(p_subject_type, p_subject_canonical_kind, p_subject_canonical_object_id,
    p_subject_relationship_id, p_subject_relationship_state_id);
  IF p_scenario_definition_id IS NULL THEN
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'SCENARIO_IDS_REQUIRED';
  END IF;
  v_at := COALESCE(p_effective_at, pg_catalog.clock_timestamp());
  v_cutoff := COALESCE(p_recorded_cutoff, pg_catalog.clock_timestamp());
  RETURN QUERY
  SELECT r.resolution, v_at, v_cutoff, s.state_id, s.state_kind, s.risk_domain, s.scenario_definition_version_id,
         s.scenario_content_hash::text, s.scenario_validated_state_id, s.predecessor_state_id, s.revokes_state_id,
         s.closure_reason, s.effective_from, s.effective_to, s.recorded_at, s.proposal_id, s.governance_decision_id,
         s.authorization_decision_id, s.authority_policy_id, s.authority_policy_version_id, s.authority_policy_content_hash,
         s.source_class, sc.support_currency, sc.support_link_count, sc.degraded_link_count, sc.failing_link_id,
         sc.failing_reason, sc.failing_upstream_link_id
  FROM gov_repo.l15_governed_risk_resolution_v1(v_org, p_subject_type, p_subject_canonical_kind, p_subject_canonical_object_id,
         p_subject_relationship_id, p_subject_relationship_state_id, p_scenario_definition_id, v_at, v_cutoff) AS r
  LEFT JOIN gov_repo.l15_governed_risk_states AS s ON s.organisation_id = v_org AND s.state_id = r.state_id
  LEFT JOIN LATERAL gov_repo.l15_governed_risk_support_summary_v1(v_org, s.state_id, v_at, v_cutoff) AS sc ON s.state_id IS NOT NULL;
  PERFORM 1 FROM gov_repo.l14_session_basis_v1(v_org, p_verified_actor_user_id, p_verified_session_iat,
    p_verified_session_exp, p_verified_credential_epoch);
END;
$read$;

-- ---------------------------------------------------------------------------------------------------------------------
-- H. Immutability, RLS, privileges, comments. Every history table: ENABLE ALWAYS raising UPDATE / DELETE / TRUNCATE (owner
--    included); FK actions RESTRICT only (no cascade reaches L15 history). The hostile 20260818013113 defaults are revoked;
--    PostgreSQL's PUBLIC EXECUTE on new functions is revoked. Exactly the three GOVERNED_RISK RPCs are service_role-
--    executable; nothing is granted to the machine intake capability.
-- ---------------------------------------------------------------------------------------------------------------------
DO $immutable$
DECLARE
  v_table text;
  v_rec record;
BEGIN
  FOREACH v_table IN ARRAY ARRAY['l15_governed_risk_proposals','l15_governed_risk_states'] LOOP
    EXECUTE pg_catalog.format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON gov_repo.%I FOR EACH ROW EXECUTE FUNCTION gov_repo.l15_history_immutable_v1()',
      v_table || '_immutable', v_table);
    EXECUTE pg_catalog.format('CREATE TRIGGER %I BEFORE TRUNCATE ON gov_repo.%I FOR EACH STATEMENT EXECUTE FUNCTION gov_repo.l15_history_immutable_v1()',
      v_table || '_no_truncate', v_table);
  END LOOP;
  FOREACH v_table IN ARRAY ARRAY['l15_governed_risk_proposals','l15_governed_risk_states','l15_governed_risk_heads'] LOOP
    EXECUTE pg_catalog.format('ALTER TABLE gov_repo.%I ENABLE ROW LEVEL SECURITY', v_table);
    EXECUTE pg_catalog.format('REVOKE ALL ON TABLE gov_repo.%I FROM PUBLIC, anon, authenticated, service_role, govia_l15_machine_intake_caller', v_table);
  END LOOP;
  FOR v_rec IN SELECT t.tgrelid::regclass::text AS rel, t.tgname::text AS tg FROM pg_catalog.pg_trigger AS t
      WHERE NOT t.tgisinternal AND t.tgrelid IN ('gov_repo.l15_governed_risk_proposals'::regclass,
        'gov_repo.l15_governed_risk_states'::regclass, 'gov_repo.l15_governed_risk_heads'::regclass) LOOP
    EXECUTE pg_catalog.format('ALTER TABLE %s ENABLE ALWAYS TRIGGER %I', v_rec.rel, v_rec.tg);
  END LOOP;
END;
$immutable$;

-- The four new SECURITY DEFINER routines are owned by postgres explicitly (the P8 inventory asserts owner + body hash).
ALTER FUNCTION gov_repo.l15_governed_risk_commit_guard_v1() OWNER TO postgres;
ALTER FUNCTION gov_repo.l15_submit_governed_risk_proposal_v1(uuid,uuid,bigint,bigint,timestamp with time zone,text,text,text,text,text,text,text,text,uuid,uuid,text,timestamp with time zone,timestamp with time zone,uuid,uuid,text,uuid,text,text[],text[],text) OWNER TO postgres;
ALTER FUNCTION gov_repo.l15_decide_governed_risk_proposal_v1(uuid,uuid,bigint,bigint,timestamp with time zone,text,uuid,text,text,text,uuid,text,text[],text[],text) OWNER TO postgres;
ALTER FUNCTION gov_repo.l15_read_governed_risk_v1(uuid,uuid,bigint,bigint,timestamp with time zone,text,text,text,text,text,uuid,timestamp with time zone,timestamp with time zone) OWNER TO postgres;

-- Every routine created or replaced here: no PUBLIC / application / capability EXECUTE, then exactly the three RPCs to
-- service_role. Routines of earlier slices keep their ACL (asserted in the postflight).
DO $acl$
DECLARE
  v_fn regprocedure;
BEGIN
  FOR v_fn IN SELECT p.oid::regprocedure FROM pg_catalog.pg_proc AS p
      WHERE p.pronamespace = 'gov_repo'::regnamespace
        AND p.proname IN ('l15_risk_subject_key_v1','l15_risk_subject_token_v1','l15_lock_governed_risk_key_guard_v1',
          'l15_lock_scenario_dependency_guard_shared_v1','l15_governed_risk_support_parts_v1','l15_risk_subject_shape_v1',
          'l15_support_link_insert_guard_v1','l15_write_governed_risk_support_links_v1','l15_command_result_state_guard_v1',
          'l15_governed_risk_proposal_guard_v1','l15_governed_risk_state_guard_v1','l15_governed_risk_commit_guard_v1',
          'l15_governed_risk_head_guard_v1','l15_governed_risk_valid_state_v1','l15_governed_risk_state_current_v1',
          'l15_governed_risk_resolution_v1','l15_support_link_target_failure_v1','l15_governed_risk_support_currency_v1',
          'l15_governed_risk_support_summary_v1','l15_governed_risk_command_result_v1','l15_submit_governed_risk_proposal_v1',
          'l15_decide_governed_risk_proposal_v1','l15_read_governed_risk_v1') LOOP
    EXECUTE pg_catalog.format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated, service_role, govia_l15_machine_intake_caller', v_fn);
  END LOOP;
END;
$acl$;
GRANT EXECUTE ON FUNCTION
  gov_repo.l15_submit_governed_risk_proposal_v1(uuid,uuid,bigint,bigint,timestamp with time zone,text,text,text,text,text,text,text,text,uuid,uuid,text,timestamp with time zone,timestamp with time zone,uuid,uuid,text,uuid,text,text[],text[],text),
  gov_repo.l15_decide_governed_risk_proposal_v1(uuid,uuid,bigint,bigint,timestamp with time zone,text,uuid,text,text,text,uuid,text,text[],text[],text),
  gov_repo.l15_read_governed_risk_v1(uuid,uuid,bigint,bigint,timestamp with time zone,text,text,text,text,text,uuid,timestamp with time zone,timestamp with time zone)
TO service_role;

COMMENT ON TABLE gov_repo.l15_governed_risk_proposals IS 'M17-S3 immutable typed GOVERNED_RISK proposal over l14_proposals: exact subject (closed object / relationship-state union), exact scenario version tuple (domain DB-derived), temporal intent, explicit expected-current / expected-none, exact REVOKE target + closure_reason. LOCAL_HUMAN only in S3. No title / description / rationale / score.';
COMMENT ON TABLE gov_repo.l15_governed_risk_states IS 'M17-S3 immutable GOVERNED_RISK state (L15 authoritative fact; NOT a canonical object / relationship / score): logical key organisation + subject_key + scenario_definition_id; pins scenario version + hash + exact VALIDATED scenario registry state, decision, ALLOW authorization, Authority Policy version / hash. VALIDATED / REVOKED only; append-only. S4 / S5 pin (organisation, state_id, subject_key, scenario_definition_id, scenario_definition_version_id, scenario_content_hash, scenario_validated_state_id, VALIDATED).';
COMMENT ON TABLE gov_repo.l15_governed_risk_heads IS 'M17-S3 technical compare-and-set pointer per GOVERNED_RISK logical key; RPC-maintained, reconstructible from history, never authority.';
COMMENT ON COLUMN gov_repo.l15_governed_risk_states.closure_reason IS 'M17-S3 closed L15 closure field (REVOKED only): RISK_NO_LONGER_APPLICABLE, SUBJECT_RETIRED, DUPLICATE_OF_GOVERNED_RISK, RISK_ELIMINATED_BY_AVOIDANCE, RECORDED_IN_ERROR. The shared reason code stays GOVERNED_RISK_REVOKED.';
COMMENT ON FUNCTION gov_repo.l15_governed_risk_valid_state_v1(uuid, text, text, text, text, text, uuid, timestamptz, timestamptz) IS 'M17-S3 owner-only exact bitemporal GOVERNED_RISK resolver (the S4 / S5 pin): exact logical key, both coordinates, exact subject, exact scenario dependency via the S2 resolver; no row = UNKNOWN / not current; never latest-by-scenario, never repinned.';
COMMENT ON FUNCTION gov_repo.l15_governed_risk_support_currency_v1(uuid, uuid, timestamptz, timestamptz) IS 'M17-S3 O44 per-link support-currency projection (read only): M16 fact support through the exact M16 resolvers only; field states through their lineage; immutable evidence by existence; signals / hypotheses transitively.';
COMMENT ON FUNCTION gov_repo.l15_governed_risk_commit_guard_v1() IS 'M17-S3 owner-only deferred GOVERNED_RISK support-integrity trigger (SECURITY DEFINER: fires at COMMIT as the committing role, which holds no L15 privilege). Reads only; writes nothing.';

-- ---------------------------------------------------------------------------------------------------------------------
-- I. Postflight over the EFFECTIVE post-S3 catalog (after ALL grants, including the broad legacy defaults).
-- ---------------------------------------------------------------------------------------------------------------------
DO $postflight$
DECLARE
  v_rel text;
  v_count bigint;
  v_hash text;
  v_new_tables CONSTANT text[] := ARRAY['l15_governed_risk_proposals','l15_governed_risk_states','l15_governed_risk_heads'];
  v_allowed_changed CONSTANT text[] := ARRAY['gov_repo.l14_command_results|l14_command_results_shape_check',
    'gov_repo.l14_command_results|l14_command_results_l15_state_check',
    'gov_repo.l15_support_links|l15_support_links_owner_kind_check', 'gov_repo.l15_support_links|l15_support_links_owner_shape_check',
    'gov_repo.l15_support_links|l15_support_links_owner_target_matrix_check'];
BEGIN
  -- P1. Pre-existing constraints / triggers unchanged except the enumerated additive widenings; new constraints only on the
  --     new L15 tables and the S3 support-link owner columns.
  IF EXISTS (SELECT 1 FROM m17_s3_constraint_snapshot AS b
             LEFT JOIN (SELECT k.conrelid::regclass::text AS rel, k.conname::text AS conname, pg_catalog.pg_get_constraintdef(k.oid) AS def
                        FROM pg_catalog.pg_constraint AS k JOIN pg_catalog.pg_class AS c ON c.oid = k.conrelid
                        WHERE c.relnamespace = 'gov_repo'::regnamespace) AS a ON a.rel = b.rel AND a.conname = b.conname
             WHERE a.def IS DISTINCT FROM b.def AND (b.rel || '|' || b.conname) <> ALL (v_allowed_changed))
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_constraint AS k JOIN pg_catalog.pg_class AS c ON c.oid = k.conrelid
                WHERE c.relnamespace = 'gov_repo'::regnamespace
                  AND NOT EXISTS (SELECT 1 FROM m17_s3_constraint_snapshot AS b WHERE b.rel = k.conrelid::regclass::text AND b.conname = k.conname::text)
                  AND NOT (c.relname::text = ANY (v_new_tables))
                  AND NOT (c.relname = 'l15_support_links' AND k.conname IN ('l15_support_links_owner_governed_risk_artifact_check',
                    'l15_support_links_owner_governed_risk_proposal_fkey','l15_support_links_owner_governed_risk_state_fkey')))
     OR EXISTS (SELECT 1 FROM m17_s3_trigger_snapshot AS b
                LEFT JOIN (SELECT t.tgrelid::regclass::text AS rel, t.tgname::text AS tgname, t.tgenabled::text AS enabled,
                                  t.tgfoid::regprocedure::text AS fn
                           FROM pg_catalog.pg_trigger AS t JOIN pg_catalog.pg_class AS c ON c.oid = t.tgrelid
                           WHERE c.relnamespace = 'gov_repo'::regnamespace AND NOT t.tgisinternal) AS a
                  ON a.rel = b.rel AND a.tgname = b.tgname
                WHERE a.enabled IS DISTINCT FROM b.enabled OR a.fn IS DISTINCT FROM b.fn)
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_trigger AS t JOIN pg_catalog.pg_class AS c ON c.oid = t.tgrelid
                WHERE c.relnamespace = 'gov_repo'::regnamespace AND NOT t.tgisinternal
                  AND NOT EXISTS (SELECT 1 FROM m17_s3_trigger_snapshot AS b WHERE b.rel = t.tgrelid::regclass::text AND b.tgname = t.tgname::text)
                  AND NOT (c.relname::text = ANY (v_new_tables)))
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_trigger AS t WHERE t.tgrelid = ANY (ARRAY['gov_repo.l15_governed_risk_proposals'::regclass,
                  'gov_repo.l15_governed_risk_states'::regclass, 'gov_repo.l15_governed_risk_heads'::regclass])
                  AND NOT t.tgisinternal AND t.tgenabled <> 'A') THEN
    RAISE EXCEPTION 'M17_S3_POSTFLIGHT: a constraint / trigger outside the enumerated S3 surfaces changed or was added';
  END IF;
  -- P2. Every pre-existing routine is unchanged (body, definer, config, ACL) except the two owner-only invoker guards S3
  --     replaces (S1 / S2 branches restated verbatim).
  IF EXISTS (SELECT 1 FROM m17_s3_routine_snapshot AS b
             LEFT JOIN pg_catalog.pg_proc AS p ON p.oid = pg_catalog.to_regprocedure(b.sig)
             WHERE (p.oid IS NULL OR pg_catalog.md5(p.prosrc) IS DISTINCT FROM b.body OR p.prosecdef IS DISTINCT FROM b.definer
                    OR COALESCE(pg_catalog.array_to_string(p.proconfig, ';'), '-') IS DISTINCT FROM b.cfg
                    OR COALESCE(p.proacl::text, '-') IS DISTINCT FROM b.acl)
               AND b.sig NOT IN ('gov_repo.l15_support_link_insert_guard_v1()', 'gov_repo.l15_command_result_state_guard_v1()'))
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_proc AS p
                WHERE p.oid IN ('gov_repo.l15_support_link_insert_guard_v1()'::regprocedure, 'gov_repo.l15_command_result_state_guard_v1()'::regprocedure)
                  AND (p.prosecdef OR pg_catalog.has_function_privilege('service_role', p.oid, 'EXECUTE'))) THEN
    RAISE EXCEPTION 'M17_S3_POSTFLIGHT: a pre-existing routine changed outside the two enumerated guard replacements';
  END IF;
  -- P3. Every pre-existing L14 / L15 / canonical row is byte-identical (M16 history, shared envelope, S1 / S2 stores, F2).
  FOR v_rel IN SELECT c.relation FROM m17_s3_row_capture AS c LOOP
    IF v_rel = 'l15_support_links' THEN
      SELECT pg_catalog.count(*), COALESCE(pg_catalog.md5(pg_catalog.string_agg(t::text, E'\n' ORDER BY t::text COLLATE "C")), 'EMPTY')
      INTO v_count, v_hash
      FROM (SELECT x.organisation_id, x.link_id, x.owner_kind, x.owner_signal_id, x.owner_signal_kind, x.owner_hypothesis_id,
                   x.target_tag, x.target_discovery_evidence_id, x.target_source_assertion_id, x.target_runtime_observation_id,
                   x.target_cross_signal_comparison_id, x.target_execution_field_state_id, x.target_technical_field_state_id,
                   x.target_lineage_observation_finding_id, x.target_l14_fact_state_id, x.target_l14_fact_subject_kind,
                   x.target_risk_signal_id, x.target_risk_hypothesis_id, x.recorded_at, x.owner_registry_artifact,
                   x.owner_scenario_proposal_id, x.owner_methodology_proposal_id, x.owner_governance_decision_id,
                   x.owner_scenario_state_id, x.owner_methodology_state_id
            FROM gov_repo.l15_support_links AS x) AS t;
    ELSE
      EXECUTE pg_catalog.format(
        'SELECT pg_catalog.count(*), COALESCE(pg_catalog.md5(pg_catalog.string_agg(t::text, %L ORDER BY t::text COLLATE "C")), %L) FROM gov_repo.%I AS t',
        E'\n', 'EMPTY', v_rel) INTO v_count, v_hash;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM m17_s3_row_capture AS c WHERE c.relation = v_rel AND c.row_count = v_count AND c.row_hash = v_hash) THEN
      RAISE EXCEPTION 'M17_S3_POSTFLIGHT: rows of % changed', v_rel;
    END IF;
  END LOOP;
  -- P4. Frozen vocabularies: five M16 fact families, 11 canonical kinds, 12 relationship types; F2 has no trigger and no
  --     L15 FK; exactly four L15 authoritative families are possible (GOVERNED_RISK is the only implemented one).
  IF (SELECT pg_catalog.array_agg(m.v[1] ORDER BY m.v[1] COLLATE "C") FROM pg_catalog.pg_constraint AS k
      CROSS JOIN LATERAL pg_catalog.regexp_matches(pg_catalog.pg_get_constraintdef(k.oid), '''([A-Z_]+)''', 'g') AS m(v)
      WHERE k.conrelid = 'gov_repo.l14_fact_states'::regclass AND k.conname = 'l14_fact_states_subject_kind_check')
     IS DISTINCT FROM ARRAY['BUSINESS_CONTEXT_ASSIGNMENT','CONTROL_APPLICABILITY','CONTROL_ASSESSMENT','POLICY_APPLICABILITY','RESPONSIBILITY_ASSIGNMENT']
     OR (SELECT pg_catalog.array_agg(m.v[1] ORDER BY m.v[1] COLLATE "C") FROM pg_catalog.pg_constraint AS k
      CROSS JOIN LATERAL pg_catalog.regexp_matches(pg_catalog.pg_get_constraintdef(k.oid), '''([A-Z_]+)''', 'g') AS m(v)
      WHERE k.conrelid = 'gov_repo.canonical_objects'::regclass AND k.conname = 'canonical_objects_kind_check')
     IS DISTINCT FROM ARRAY['AGENT','AGENT_VERSION','API','DATA_ASSET','DATA_ELEMENT','KNOWLEDGE_BASE','MCP_SERVER','MODEL','PROMPT','SKILL','TOOL']
     OR (SELECT pg_catalog.array_agg(m.v[1] ORDER BY m.v[1] COLLATE "C") FROM pg_catalog.pg_constraint AS k
      CROSS JOIN LATERAL pg_catalog.regexp_matches(pg_catalog.pg_get_constraintdef(k.oid), '''([A-Z_]+)''', 'g') AS m(v)
      WHERE k.conrelid = 'gov_repo.canonical_relationships'::regclass AND k.conname = 'canonical_relationships_type_check')
     IS DISTINCT FROM ARRAY['DERIVED_FROM','EXPOSES','HANDOFF_TO','INVOKES','READS_FROM','USES_KNOWLEDGE_BASE','USES_MCP','USES_MODEL','USES_PROMPT','USES_SKILL','USES_TOOL','WRITES_TO']
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_trigger AS t WHERE t.tgrelid = 'gov_repo.canonical_relationships'::regclass AND NOT t.tgisinternal)
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_constraint AS k JOIN pg_catalog.pg_class AS c ON c.oid = k.conrelid
                WHERE k.confrelid = 'gov_repo.canonical_relationships'::regclass AND c.relname LIKE 'l15\_%' ESCAPE '\')
     OR (SELECT pg_catalog.count(*) FROM pg_catalog.pg_class AS c WHERE c.relnamespace = 'gov_repo'::regnamespace
         AND c.relkind = 'r' AND c.relname ~ '^l15_.*_states$') <> 3 THEN
    RAISE EXCEPTION 'M17_S3_POSTFLIGHT: M16 families / canonical taxonomy / F2 / L15 family count changed';
  END IF;
  -- P5. ACL: no application role or the capability holds any privilege on any new table; every L15 routine owner postgres
  --     with a pinned search_path and no PUBLIC / anon / authenticated EXECUTE; the application definer surface grew by
  --     exactly the three RPCs (55 -> 58); L15 definers 15 -> 19 (+3 RPCs, +1 owner-only commit guard); service_role-
  --     executable L15 routines 10 -> 13; the technical intake surface stays exactly the two S1 RPCs.
  IF EXISTS (SELECT 1 FROM pg_catalog.unnest(v_new_tables) AS x(t)
             CROSS JOIN pg_catalog.unnest(ARRAY['service_role','authenticated','anon','govia_l15_machine_intake_caller']) AS r(role)
             CROSS JOIN pg_catalog.unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN']) AS p(pr)
             WHERE pg_catalog.has_table_privilege(r.role, ('gov_repo.' || x.t)::regclass, p.pr)
                OR pg_catalog.has_any_column_privilege(r.role, ('gov_repo.' || x.t)::regclass, 'SELECT, INSERT, UPDATE, REFERENCES'))
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_class AS c
                CROSS JOIN pg_catalog.unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) AS p(pr)
                WHERE c.relnamespace = 'gov_repo'::regnamespace AND c.relkind = 'r' AND c.relname LIKE 'l15\_%' ESCAPE '\'
                  AND pg_catalog.has_table_privilege('service_role', c.oid, p.pr))
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_proc AS p WHERE p.pronamespace = 'gov_repo'::regnamespace AND p.proname LIKE 'l15\_%' ESCAPE '\'
                AND (pg_catalog.pg_get_userbyid(p.proowner) <> 'postgres'
                     OR NOT EXISTS (SELECT 1 FROM pg_catalog.unnest(COALESCE(p.proconfig, ARRAY[]::text[])) AS c(v) WHERE c.v = 'search_path=pg_catalog, pg_temp')
                     OR EXISTS (SELECT 1 FROM pg_catalog.aclexplode(COALESCE(p.proacl, pg_catalog.acldefault('f', p.proowner))) AS a WHERE a.grantee = 0)
                     OR pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE')
                     OR pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE')))
     OR (SELECT pg_catalog.count(*) FROM pg_catalog.pg_proc AS p WHERE p.pronamespace = 'gov_repo'::regnamespace AND p.proname LIKE 'l15\_%' ESCAPE '\'
         AND pg_catalog.has_function_privilege('service_role', p.oid, 'EXECUTE')) <> 13
     OR (SELECT pg_catalog.count(*) FROM pg_catalog.pg_proc AS p WHERE p.pronamespace = 'gov_repo'::regnamespace AND p.proname LIKE 'l15\_%' ESCAPE '\'
         AND p.prosecdef) <> 19
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
                            WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE'))) <> 58 THEN
    RAISE EXCEPTION 'M17_S3_POSTFLIGHT: ACL / definer surface violated';
  END IF;
  -- P6. No S3 routine writes any M16 / F2 store, issues SET CONSTRAINTS, or reads a legacy risk / score surface.
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_proc AS p WHERE p.pronamespace = 'gov_repo'::regnamespace
             AND p.proname ~ '^l15_(.*governed_risk|risk_subject|support_link_target_failure|lock_scenario_dependency)'
             AND (p.prosrc ~* '(insert\s+into|update|delete\s+from|truncate)\s+gov_repo\.(l14_fact_states|l14_registry_states|l14_support_links|l14_[a-z_]+_(states|proposals|heads)|canonical_)'
                  OR p.prosrc ~* 'set\s+constraints'
                  OR p.prosrc ~* '(risk_entries|risk_treatments|risk_level|agent_risk_propagation|compute_governance_score|risk_refs|residual_risk_level)')) THEN
    RAISE EXCEPTION 'M17_S3_POSTFLIGHT: an S3 routine writes M16 / F2, forces the ALLOW guard or reads a legacy risk surface';
  END IF;
  -- P7. Every existing machine-intake LOGIN still satisfies the closed S1R1 surface (S3 granted it nothing).
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members AS m JOIN pg_catalog.pg_roles AS r ON r.oid = m.member
             WHERE m.roleid = 'govia_l15_machine_intake_caller'::regrole AND r.rolcanlogin AND r.rolname <> 'postgres'
               AND NOT gov_repo.l15_machine_role_safe_v1(r.oid, r.rolname::text)) THEN
    RAISE EXCEPTION 'M17_S3_POSTFLIGHT: a machine intake LOGIN is no longer on its closed S1R1 surface';
  END IF;
  -- P8. Definer-capability inventory: each of the four new L15 SECURITY DEFINER routines has its exact owner, body SHA-256
  --     and config (any later change requires re-review of this inventory and of the test inventory).
  IF (SELECT pg_catalog.count(*) FROM (VALUES
      ('gov_repo.l15_submit_governed_risk_proposal_v1(uuid,uuid,bigint,bigint,timestamp with time zone,text,text,text,text,text,text,text,text,uuid,uuid,text,timestamp with time zone,timestamp with time zone,uuid,uuid,text,uuid,text,text[],text[],text)', 'e6d8587dacea996a38c7f15bb50db3c3937cdc32a574f61e67a20a5e035531f5', 'search_path=pg_catalog, pg_temp;lock_timeout=5s'),
      ('gov_repo.l15_decide_governed_risk_proposal_v1(uuid,uuid,bigint,bigint,timestamp with time zone,text,uuid,text,text,text,uuid,text,text[],text[],text)', '73e0d2401cf073e67d27cc6510d05b7ce0f556dbe397ff6baa8ae07128f60038', 'search_path=pg_catalog, pg_temp;lock_timeout=5s'),
      ('gov_repo.l15_read_governed_risk_v1(uuid,uuid,bigint,bigint,timestamp with time zone,text,text,text,text,text,uuid,timestamp with time zone,timestamp with time zone)', '9425fa2272293d5148d3aa6433407afc85cc09825432844cd4a440d489326862', 'search_path=pg_catalog, pg_temp;lock_timeout=5s'),
      ('gov_repo.l15_governed_risk_commit_guard_v1()', 'b9b88cf166ad7294fc47264893fc4e8051ce381009e4fcc32111c3bedf26ad5c', 'search_path=pg_catalog, pg_temp')) AS m(sig, sha, cfg)
      JOIN pg_catalog.pg_proc AS p ON p.oid = pg_catalog.to_regprocedure(m.sig)
      WHERE p.prosecdef AND pg_catalog.pg_get_userbyid(p.proowner) = 'postgres'
        AND pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p.prosrc, 'UTF8')), 'hex') = m.sha
        AND COALESCE(pg_catalog.array_to_string(p.proconfig, ';'), '-') = m.cfg) <> 4 THEN
    RAISE EXCEPTION 'M17_S3_POSTFLIGHT: an S3 definer differs from its inventory (owner / body / config)';
  END IF;
END;
$postflight$;

COMMIT;
