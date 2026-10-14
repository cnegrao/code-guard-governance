-- M17-S4: INHERENT RISK_ASSESSMENT — the second L15 authoritative fact family (DB only, ADDITIVE).
-- Architecture (ACCEPTED / FROZEN, not modified): docs/architecture/ADR-GOVIA-RISK-INTELLIGENCE-v1.md §§9.2, 10, 11, 12, 16-18,
-- 20.1, 24, 26 (O31-O37; inherited O01, O02, O05-O07, O13, O14, O53-O66, O73-O84, O90, O91);
-- docs/architecture/ADR-GOVIA-M16-AUTHORITY-POLICY-M17-EXTENSION-v1.md (D-01) §4 (the command-result L15 decision branch,
-- widened from the two registries + GOVERNED_RISK to RISK_ASSESSMENT). Additive only; no historical migration edited. Never
-- run against a hosted DB from this slice.
--
-- Meaning: a RISK_ASSESSMENT state with assessment_basis INHERENT is the governed, human-authorized assessment of ONE exact
-- current VALIDATED GOVERNED_RISK state under ONE exact VALIDATED RISK_METHODOLOGY version, for a bounded validity interval.
-- It is NOT a score: no numeric value of any kind exists in any assessment store.
--   * Logical key = organisation + governed_risk_state_id + assessment_basis. One technical head (compare-and-set pointer,
--     never authority) per key. A successor GOVERNED_RISK state is a DIFFERENT key: an assessment never transfers (O35).
--   * Pins (dependency, never support): the exact governed-risk state (composite FK onto the S3 dependency key
--     l15_governed_risk_states_kind_unique: organisation + state + subject key + scenario pins + VALIDATED) and the exact
--     methodology version tuple + PostgreSQL content hash + the exact VALIDATED methodology state it was decided against
--     (composite FK onto l15_risk_methodology_states_kind_unique). A methodology successor never repins an assessment.
--   * assessment_outcome RATED | INSUFFICIENT_EVIDENCE. RATED: likelihood_level_code + impact_level_code REQUIRED, each a
--     member of the PINNED version's scale (composite FKs; never another version, never an ordinal, never a fold), and the
--     rating_band is derived by PostgreSQL ONLY from the exact rating cell of the pinned version (lookup, never arithmetic;
--     there is no caller band parameter). INSUFFICIENT_EVIDENCE: no level, no band. No default level, no implicit LOW.
--   * Validity: mandatory valid_until on every VALIDATED state, valid_until > effective_from and valid_until <= effective_from
--     + the pinned version's assessment_validity_maximum (calendar arithmetic in UTC); half-open [effective_from,
--     valid_until); valid_until IS the effective end (no second effective_to). Expiry writes nothing.
--   * assessment_basis: the closed family vocabulary INHERENT | RESIDUAL is stored, but a separately named executable CHECK
--     admits INHERENT only (S6 widens that one constraint for RESIDUAL; no S4 history is rewritten).
--   * States VALIDATED / REVOKED only (append-only lineage). REJECT / DEFER / DENY write no state. REVOKE targets the exact
--     current VALIDATED assessment state. Shared reason codes RISK_ASSESSMENT_{VALIDATED,REJECTED,DEFERRED,REVOKED} only.
--   * Authority: L15_RISK_ASSESSMENT_VALIDATE (requested action = the exact outcome) over the CURRENT effective Authority
--     Policy and CURRENT persisted roles, typed scope evaluated against the SUBJECT OF THE PINNED GOVERNED_RISK STATE (the
--     existing M16 object / relationship-state evaluators, unchanged). Band / level / domain / hint / confidence / count never
--     enter evaluation (O37). Self-validation fail-closed. No bootstrap. The S2R1 root ALLOW guard runs naturally at COMMIT:
--     these RPCs never issue SET CONSTRAINTS.
--   * Proposal submission: verified ACTIVE same-tenant human (LOCAL_HUMAN) only. SYSTEM_SEED and SOURCE_CONNECTION are never
--     admissible for RISK_ASSESSMENT (the ADR admits SOURCE_CONNECTION intake for GOVERNED_RISK only). The machine intake
--     capability is granted nothing.
--   * l15_support_links widened additively with the RISK_ASSESSMENT rank-3 owners (PROPOSAL / DECISION / STATE; typed owner
--     columns, same-tenant composite FKs) -> RISK_HYPOTHESIS, RISK_SIGNAL and every rank-0 tag. No L15 governed artifact is
--     ever a target. Support is provenance only and never substitutes a pin.
--   * Owner-only exact bitemporal resolver (the S6 dependency contract): CURRENT only when the assessment's own interval /
--     lineage, the pinned GOVERNED_RISK state and the pinned methodology state are ALL valid at the same coordinates. No
--     row = UNKNOWN; the member read RPC returns UNKNOWN / RATED / INSUFFICIENT_EVIDENCE explicitly (O36).
--
-- Sections: A preflight + capture; B owner-only helpers; C tables; D l15_support_links / l14_command_results additive
-- widening; E guards; F resolver, resolution, result projection; G RPCs; H immutability, privileges, comments; I postflight.
BEGIN;

-- ---------------------------------------------------------------------------------------------------------------------
-- A. Preflight: exactly the post-M17-S3R1 catalog, or abort with nothing applied.
-- ---------------------------------------------------------------------------------------------------------------------
DO $preflight$
BEGIN
  IF pg_catalog.current_setting('server_version_num')::integer NOT BETWEEN 170000 AND 179999 OR current_user <> 'postgres'
     OR pg_catalog.current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'M17_S4_PREFLIGHT: PostgreSQL 17 / postgres / READ COMMITTED required' USING ERRCODE = '55000';
  END IF;
  IF (SELECT pg_catalog.count(*) FROM pg_catalog.pg_class AS c
      WHERE c.relnamespace = 'gov_repo'::regnamespace AND c.relname LIKE 'l15\_%' ESCAPE '\' AND c.relkind IN ('r','p')) <> 21
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_class AS c WHERE c.relnamespace = 'gov_repo'::regnamespace
                AND c.relname LIKE 'l15\_risk\_assessment%' ESCAPE '\')
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_proc AS p WHERE p.pronamespace = 'gov_repo'::regnamespace
                AND p.proname ~ '^l15_(.*risk_assessment|assessment_validity_limit|lock_governed_risk_dependency|lock_methodology_dependency)')
     OR pg_catalog.to_regprocedure('gov_repo.l15_risk_methodology_valid_state_v1(uuid,uuid,uuid,text,timestamptz,timestamptz)') IS NULL
     OR pg_catalog.to_regprocedure('gov_repo.l15_assessment_validity_maximum_parts_v1(interval)') IS NULL
     OR pg_catalog.to_regprocedure('gov_repo.l15_governed_risk_state_current_v1(uuid,uuid,timestamptz,timestamptz)') IS NULL
     OR pg_catalog.to_regprocedure('gov_repo.l15_governed_risk_valid_state_v1(uuid,text,text,text,text,text,uuid,timestamptz,timestamptz)') IS NULL
     OR pg_catalog.to_regprocedure('gov_repo.l15_lock_scenario_dependency_guard_shared_v1(uuid,uuid,uuid,text)') IS NULL
     OR pg_catalog.to_regprocedure('gov_repo.l15_lock_governed_risk_key_guard_v1(uuid,text,uuid)') IS NULL
     OR pg_catalog.to_regprocedure('gov_repo.l15_lock_registry_subject_guard_v1(uuid,text,text)') IS NULL
     OR pg_catalog.to_regprocedure('gov_repo.l15_governed_risk_support_parts_v1(text,text[],text[])') IS NULL
     OR pg_catalog.to_regprocedure('gov_repo.l15_normalize_support_v1(uuid,text[],text[])') IS NULL
     OR pg_catalog.to_regprocedure('gov_repo.l14_evaluate_target_authority_rules_v1(uuid,uuid,uuid,uuid[],text,text,boolean,text,text,text)') IS NULL
     OR pg_catalog.to_regprocedure('gov_repo.l14_evaluate_relationship_state_authority_rules_v1(uuid,uuid,uuid,uuid[],text,text,boolean,text,text,text,text)') IS NULL THEN
    RAISE EXCEPTION 'M17_S4_PREFLIGHT: the post-M17-S3R1 catalog is required (an S4 object exists or an S2 / S3 object is missing)' USING ERRCODE = '55000';
  END IF;
  -- The exact S2 / S3 keys S4 binds to (read from the catalog).
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint AS k WHERE k.conrelid = 'gov_repo.l15_governed_risk_states'::regclass
                   AND k.conname = 'l15_governed_risk_states_kind_unique' AND k.contype = 'u'
                   AND pg_catalog.pg_get_constraintdef(k.oid) = 'UNIQUE (organisation_id, state_id, subject_key, scenario_definition_id, scenario_definition_version_id, scenario_content_hash, scenario_validated_state_id, state_kind)')
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint AS k WHERE k.conrelid = 'gov_repo.l15_risk_methodology_states'::regclass
                   AND k.conname = 'l15_risk_methodology_states_kind_unique' AND k.contype = 'u'
                   AND pg_catalog.pg_get_constraintdef(k.oid) = 'UNIQUE (organisation_id, state_id, methodology_id, methodology_version_id, content_hash, state_kind)')
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint AS k WHERE k.conrelid = 'gov_repo.l15_risk_methodology_versions'::regclass
                   AND k.conname = 'l15_risk_methodology_versions_tuple_unique' AND k.contype = 'u')
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint AS k WHERE k.conrelid = 'gov_repo.l15_risk_methodology_likelihood_levels'::regclass
                   AND k.conname = 'l15_risk_methodology_likelihood_levels_code_unique' AND k.contype = 'u')
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint AS k WHERE k.conrelid = 'gov_repo.l15_risk_methodology_impact_levels'::regclass
                   AND k.conname = 'l15_risk_methodology_impact_levels_code_unique' AND k.contype = 'u')
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint AS k WHERE k.conrelid = 'gov_repo.l15_risk_methodology_rating_cells'::regclass
                   AND k.conname = 'l15_risk_methodology_rating_cells_pkey' AND k.contype = 'p'
                   AND pg_catalog.pg_get_constraintdef(k.oid) = 'PRIMARY KEY (organisation_id, methodology_version_id, likelihood_level_code, impact_level_code)')
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attribute AS a WHERE a.attrelid = 'gov_repo.l14_command_results'::regclass
                    AND a.attname = 'l15_state_id' AND NOT a.attisdropped)
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attribute AS a WHERE a.attrelid = 'gov_repo.l15_support_links'::regclass
                    AND a.attname = 'owner_governed_risk_state_id' AND NOT a.attisdropped) THEN
    RAISE EXCEPTION 'M17_S4_PREFLIGHT: the S2 / S3 dependency keys differ from the inspected catalog' USING ERRCODE = '55000';
  END IF;
  -- S3R1 is effective: the O44 projection covers the exact PROPOSAL + DECISION + STATE lineage.
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc AS p
                 WHERE p.oid = 'gov_repo.l15_governed_risk_support_currency_v1(uuid,uuid,timestamptz,timestamptz)'::regprocedure
                   AND p.prosrc ~ 'owner_governed_risk_proposal_id' AND p.prosrc ~ 'owner_governance_decision_id') THEN
    RAISE EXCEPTION 'M17_S4_PREFLIGHT: the S3R1 lineage support-currency correction is not effective' USING ERRCODE = '55000';
  END IF;
  -- The S2R1 root ALLOW guard is the owner-only SECURITY DEFINER with the byte-identical S0 body; S4 RPCs rely on it running
  -- naturally at COMMIT and never issue SET CONSTRAINTS.
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc AS p WHERE p.oid = 'gov_repo.l15_authorization_allow_guard_v1()'::regprocedure
                   AND p.prosecdef AND pg_catalog.pg_get_userbyid(p.proowner) = 'postgres'
                   AND pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p.prosrc, 'UTF8')), 'hex')
                       = 'ee7885662da87a4946ad06596dbcd9f1af9bbb52de0e86fb7b16fd17731b5236'
                   AND NOT pg_catalog.has_function_privilege('service_role', p.oid, 'EXECUTE')) THEN
    RAISE EXCEPTION 'M17_S4_PREFLIGHT: the S2R1 root ALLOW guard is not the owner-only SECURITY DEFINER' USING ERRCODE = '55000';
  END IF;
  -- The reviewed S3 definer inventory (owner / body / config) is unchanged.
  IF (SELECT pg_catalog.count(*) FROM (VALUES
      ('gov_repo.l15_submit_governed_risk_proposal_v1(uuid,uuid,bigint,bigint,timestamp with time zone,text,text,text,text,text,text,text,text,uuid,uuid,text,timestamp with time zone,timestamp with time zone,uuid,uuid,text,uuid,text,text[],text[],text)', 'e6d8587dacea996a38c7f15bb50db3c3937cdc32a574f61e67a20a5e035531f5'),
      ('gov_repo.l15_decide_governed_risk_proposal_v1(uuid,uuid,bigint,bigint,timestamp with time zone,text,uuid,text,text,text,uuid,text,text[],text[],text)', '73e0d2401cf073e67d27cc6510d05b7ce0f556dbe397ff6baa8ae07128f60038'),
      ('gov_repo.l15_read_governed_risk_v1(uuid,uuid,bigint,bigint,timestamp with time zone,text,text,text,text,text,uuid,timestamp with time zone,timestamp with time zone)', '9425fa2272293d5148d3aa6433407afc85cc09825432844cd4a440d489326862'),
      ('gov_repo.l15_governed_risk_commit_guard_v1()', 'b9b88cf166ad7294fc47264893fc4e8051ce381009e4fcc32111c3bedf26ad5c')) AS m(sig, sha)
      JOIN pg_catalog.pg_proc AS p ON p.oid = pg_catalog.to_regprocedure(m.sig)
      WHERE p.prosecdef AND pg_catalog.pg_get_userbyid(p.proowner) = 'postgres'
        AND pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p.prosrc, 'UTF8')), 'hex') = m.sha) <> 4 THEN
    RAISE EXCEPTION 'M17_S4_PREFLIGHT: the S3 definer inventory differs from the reviewed one' USING ERRCODE = '55000';
  END IF;
  IF (SELECT pg_catalog.count(*) FROM pg_catalog.pg_proc AS p
       WHERE p.prosecdef AND p.pronamespace NOT IN ('pg_catalog'::regnamespace, 'information_schema'::regnamespace)
         AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_depend AS d
                          WHERE d.classid = 'pg_catalog.pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e')
         AND (pg_catalog.has_function_privilege('service_role', p.oid, 'EXECUTE')
              OR pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE')
              OR pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE')
              OR EXISTS (SELECT 1 FROM pg_catalog.aclexplode(COALESCE(p.proacl, pg_catalog.acldefault('f', p.proowner))) AS a
                          WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE'))) <> 58
     OR (SELECT pg_catalog.count(*) FROM pg_catalog.pg_proc AS p WHERE p.pronamespace = 'gov_repo'::regnamespace
         AND p.proname LIKE 'l15\_%' ESCAPE '\' AND p.prosecdef) <> 19
     OR (SELECT pg_catalog.count(*) FROM pg_catalog.pg_proc AS p WHERE p.pronamespace = 'gov_repo'::regnamespace
         AND p.proname LIKE 'l15\_%' ESCAPE '\' AND pg_catalog.has_function_privilege('service_role', p.oid, 'EXECUTE')) <> 13
     OR (SELECT pg_catalog.array_agg(p.proname::text ORDER BY p.proname::text COLLATE "C") FROM pg_catalog.pg_proc AS p
         WHERE p.pronamespace = 'gov_repo'::regnamespace AND pg_catalog.has_function_privilege('govia_l15_machine_intake_caller', p.oid, 'EXECUTE'))
        IS DISTINCT FROM ARRAY['l15_admit_machine_hypothesis_v1','l15_admit_machine_signal_v1'] THEN
    RAISE EXCEPTION 'M17_S4_PREFLIGHT: definer surface is not the post-S3R1 baseline (58 application / 19 L15 / 13 RPC / 2 intake)' USING ERRCODE = '55000';
  END IF;
  -- The D-01 envelope already carries RISK_ASSESSMENT: permission mapping, reason codes, request-target shape.
  IF gov_repo.l15_governance_permission_v1('RISK_ASSESSMENT', 'VALIDATE') IS DISTINCT FROM 'L15_RISK_ASSESSMENT_VALIDATE'
     OR gov_repo.l15_governance_permission_v1('RISK_ASSESSMENT', 'REVOKE') IS DISTINCT FROM 'L15_RISK_ASSESSMENT_VALIDATE'
     OR gov_repo.l15_governance_permission_v1('RISK_ASSESSMENT', 'ADMIT') IS NOT NULL
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint AS k WHERE k.conrelid = 'gov_repo.l14_governance_decisions'::regclass
                      AND k.conname = 'l14_governance_decisions_reason_code_check'
                      AND pg_catalog.pg_get_constraintdef(k.oid) ~ 'RISK_ASSESSMENT_VALIDATED' AND pg_catalog.pg_get_constraintdef(k.oid) ~ 'RISK_ASSESSMENT_REVOKED')
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint AS k WHERE k.conrelid = 'gov_repo.l14_authorization_decisions'::regclass
                      AND k.conname = 'l14_authorization_decisions_l15_risk_target_check'
                      AND pg_catalog.pg_get_constraintdef(k.oid) ~ 'RISK_ASSESSMENT') THEN
    RAISE EXCEPTION 'M17_S4_PREFLIGHT: the D-01 envelope does not carry RISK_ASSESSMENT as inspected' USING ERRCODE = '55000';
  END IF;
  -- No RISK_ASSESSMENT governance history may pre-exist (nothing before S4 could write any).
  IF EXISTS (SELECT 1 FROM gov_repo.l14_proposals AS p WHERE p.subject_kind = 'RISK_ASSESSMENT')
     OR EXISTS (SELECT 1 FROM gov_repo.l14_authorization_decisions AS a WHERE a.subject_kind = 'RISK_ASSESSMENT')
     OR EXISTS (SELECT 1 FROM gov_repo.l14_governance_decisions AS d WHERE d.subject_kind = 'RISK_ASSESSMENT')
     OR EXISTS (SELECT 1 FROM gov_repo.l14_command_results AS c WHERE c.subject_kind = 'RISK_ASSESSMENT') THEN
    RAISE EXCEPTION 'M17_S4_PREFLIGHT: RISK_ASSESSMENT governance history already exists' USING ERRCODE = '55000';
  END IF;
END;
$preflight$;

CREATE TEMPORARY TABLE m17_s4_constraint_snapshot ON COMMIT DROP AS
  SELECT k.conrelid::regclass::text AS rel, k.conname::text AS conname, pg_catalog.pg_get_constraintdef(k.oid) AS def
  FROM pg_catalog.pg_constraint AS k JOIN pg_catalog.pg_class AS c ON c.oid = k.conrelid
  WHERE c.relnamespace = 'gov_repo'::regnamespace;
CREATE TEMPORARY TABLE m17_s4_trigger_snapshot ON COMMIT DROP AS
  SELECT t.tgrelid::regclass::text AS rel, t.tgname::text AS tgname, t.tgenabled::text AS enabled, t.tgfoid::regprocedure::text AS fn
  FROM pg_catalog.pg_trigger AS t JOIN pg_catalog.pg_class AS c ON c.oid = t.tgrelid
  WHERE c.relnamespace = 'gov_repo'::regnamespace AND NOT t.tgisinternal;
CREATE TEMPORARY TABLE m17_s4_routine_snapshot ON COMMIT DROP AS
  SELECT p.oid::regprocedure::text AS sig, pg_catalog.md5(p.prosrc) AS body, p.prosecdef AS definer,
         COALESCE(pg_catalog.array_to_string(p.proconfig, ';'), '-') AS cfg, COALESCE(p.proacl::text, '-') AS acl
  FROM pg_catalog.pg_proc AS p WHERE p.pronamespace = 'gov_repo'::regnamespace;
CREATE TEMPORARY TABLE m17_s4_relation_acl_snapshot ON COMMIT DROP AS
  SELECT c.relname::text AS relname, COALESCE(c.relacl::text, '-') AS acl
  FROM pg_catalog.pg_class AS c WHERE c.relnamespace = 'gov_repo'::regnamespace;
CREATE TEMPORARY TABLE m17_s4_row_capture (relation text PRIMARY KEY, row_count bigint NOT NULL, row_hash text NOT NULL) ON COMMIT DROP;
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
    INSERT INTO m17_s4_row_capture (relation, row_count, row_hash) VALUES (v_rel, v_count, v_hash);
  END LOOP;
END;
$capture$;

-- ---------------------------------------------------------------------------------------------------------------------
-- B. Owner-only helpers (SECURITY INVOKER; EXECUTE revoked from every application role and the capability).
-- ---------------------------------------------------------------------------------------------------------------------
-- EXCLUSIVE per-logical-key guard (organisation + exact governed-risk state + assessment basis), framed with the
-- repository's length-prefixed frame_identity. Serializes first / successor / REVOKE decisions of one assessment key only:
-- assessments of different governed-risk states never serialize on each other.
CREATE FUNCTION gov_repo.l15_lock_risk_assessment_key_guard_v1(p_organisation_id uuid, p_governed_risk_state_id uuid,
  p_assessment_basis text)
RETURNS void LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, pg_temp AS $guard$
BEGIN
  IF p_organisation_id IS NULL OR p_governed_risk_state_id IS NULL OR p_assessment_basis IS NULL
     OR p_assessment_basis NOT IN ('INHERENT','RESIDUAL') THEN
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'GUARD_KEY_INVALID';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    gov_repo.frame_identity(ARRAY[p_organisation_id::text, 'l15-risk-assessment-key-guard-v1', p_governed_risk_state_id::text,
                                  p_assessment_basis]), 0));
END;
$guard$;

-- SHARED mode of the EXACT S3 GOVERNED_RISK logical-key guard key (frame_identity([organisation,
-- 'l15-governed-risk-key-guard-v1', subject_key, scenario_definition_id]) — byte-identical to the key
-- gov_repo.l15_lock_governed_risk_key_guard_v1 derives for the S3 SUBMIT / DECIDE RPCs, which take it EXCLUSIVELY). No new
-- lock namespace. An assessment VALIDATE pinning a state of that key therefore serializes deterministically with every
-- governed-risk REVOKE / supersession on the key (one committed first is seen by the resolver; one waiting behind commits
-- after it and makes the assessment not current through the exact resolver), while assessments never serialize on each
-- other through it. Held to commit.
CREATE FUNCTION gov_repo.l15_lock_governed_risk_dependency_guard_shared_v1(
  p_organisation_id uuid, p_subject_key text, p_scenario_definition_id uuid)
RETURNS void LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, pg_temp AS $guard$
BEGIN
  IF p_organisation_id IS NULL OR p_subject_key IS NULL OR pg_catalog.length(p_subject_key) NOT BETWEEN 1 AND 1100
     OR p_scenario_definition_id IS NULL THEN
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'GUARD_KEY_INVALID';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock_shared(pg_catalog.hashtextextended(
    gov_repo.frame_identity(ARRAY[p_organisation_id::text, 'l15-governed-risk-key-guard-v1', p_subject_key,
                                  p_scenario_definition_id::text]), 0));
END;
$guard$;

-- SHARED mode of the EXACT S2 registry subject guard key of one RISK_METHODOLOGY version tuple
-- (frame_identity([organisation, 'l15-registry-subject-guard-v1', 'RISK_METHODOLOGY', 'VALIDATION:' || id || ':' || version
-- || ':' || hash]) — byte-identical to the key the S2 methodology SUBMIT / DECIDE RPCs take EXCLUSIVELY). An assessment
-- VALIDATE pinning that tuple serializes deterministically with every methodology decision on it. Held to commit.
CREATE FUNCTION gov_repo.l15_lock_methodology_dependency_guard_shared_v1(
  p_organisation_id uuid, p_methodology_id uuid, p_methodology_version_id uuid, p_content_hash text)
RETURNS void LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, pg_temp AS $guard$
BEGIN
  IF p_organisation_id IS NULL OR p_methodology_id IS NULL OR p_methodology_version_id IS NULL
     OR p_content_hash IS NULL OR p_content_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'GUARD_KEY_INVALID';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock_shared(pg_catalog.hashtextextended(
    gov_repo.frame_identity(ARRAY[p_organisation_id::text, 'l15-registry-subject-guard-v1', 'RISK_METHODOLOGY',
      'VALIDATION:' || p_methodology_id::text || ':' || p_methodology_version_id::text || ':' || p_content_hash]), 0));
END;
$guard$;

-- The latest admissible valid_until of an assessment effective at p_effective_from under a methodology maximum: the exact
-- calendar sum in UTC (months, then days, then time — the components of l15_assessment_validity_maximum_parts_v1), so the
-- bound never depends on a session TimeZone. NULL for an invalid maximum. Never a number of days, never a score.
CREATE FUNCTION gov_repo.l15_assessment_validity_limit_v1(p_effective_from timestamptz, p_maximum interval)
RETURNS timestamptz LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, pg_temp AS $fn$
  SELECT CASE WHEN p_effective_from IS NOT NULL AND gov_repo.l15_assessment_validity_maximum_parts_v1(p_maximum) IS NOT NULL
              THEN ((p_effective_from AT TIME ZONE 'UTC') + p_maximum) AT TIME ZONE 'UTC' END
$fn$;

-- The DB-derived rating band of one RATED assessment: the band of EXACTLY the one rating cell of the pinned methodology
-- version for the exact (likelihood level code, impact level code) pair. A lookup, never arithmetic (no product, sum,
-- average, weight, percentage or ordinal comparison). 0 cells -> RATING_CELL_UNRESOLVED; > 1 -> RATING_CELL_AMBIGUOUS
-- (structurally impossible: the cell PK), both GV010.
CREATE FUNCTION gov_repo.l15_risk_assessment_rating_band_v1(p_organisation_id uuid, p_methodology_version_id uuid,
  p_likelihood_level_code text, p_impact_level_code text)
RETURNS text LANGUAGE plpgsql STABLE SET search_path = pg_catalog, pg_temp AS $fn$
DECLARE
  v_bands text[];
BEGIN
  SELECT pg_catalog.array_agg(c.rating_band) INTO v_bands
  FROM gov_repo.l15_risk_methodology_rating_cells AS c
  WHERE c.organisation_id = p_organisation_id AND c.methodology_version_id = p_methodology_version_id
    AND c.likelihood_level_code = p_likelihood_level_code AND c.impact_level_code = p_impact_level_code;
  IF v_bands IS NULL THEN
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'RATING_CELL_UNRESOLVED';
  END IF;
  IF pg_catalog.cardinality(v_bands) <> 1 THEN
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'RATING_CELL_AMBIGUOUS';
  END IF;
  RETURN v_bands[1];
END;
$fn$;

-- ---------------------------------------------------------------------------------------------------------------------
-- C. Tables (L15-specific stores; l14_fact_states / l14_registry_states / l14_support_links are NOT used).
-- ---------------------------------------------------------------------------------------------------------------------
-- C1. Typed immutable RISK_ASSESSMENT proposal detail over the shared l14_proposals envelope: the exact governed-risk state
--     pin (FK material only; no risk truth copied), the basis, the exact methodology version tuple, the governed assessment
--     content (outcome + the two level codes of the pinned scales; NEVER a band), the temporal intent with the MANDATORY
--     requested valid_until (VALIDATE), the explicit expected-current / expected-none and the exact REVOKE target. No
--     rationale / title / description / score.
CREATE TABLE gov_repo.l15_risk_assessment_proposals (
  organisation_id uuid NOT NULL,
  proposal_id uuid NOT NULL,
  subject_kind text GENERATED ALWAYS AS ('RISK_ASSESSMENT') STORED,
  intent text NOT NULL CHECK (intent IN ('VALIDATE','REVOKE')),
  assessment_basis text NOT NULL CHECK (assessment_basis IN ('INHERENT','RESIDUAL')),
  -- Dependency pin: the exact VALIDATED GOVERNED_RISK state (S3 dependency key; the caller names only the state id, the rest
  -- is copied by the RPC from that row and bound by the composite FK).
  governed_risk_state_id uuid NOT NULL,
  governed_risk_subject_key text NOT NULL CHECK (pg_catalog.length(governed_risk_subject_key) BETWEEN 1 AND 1100),
  governed_risk_scenario_definition_id uuid NOT NULL,
  governed_risk_scenario_definition_version_id uuid NOT NULL,
  governed_risk_scenario_content_hash character(64) NOT NULL CHECK (governed_risk_scenario_content_hash::text ~ '^[0-9a-f]{64}$'),
  governed_risk_scenario_validated_state_id uuid NOT NULL,
  governed_risk_state_kind text GENERATED ALWAYS AS ('VALIDATED') STORED,
  -- Dependency pin: the exact admitted methodology version tuple (validated state pinned by the decision).
  methodology_id uuid NOT NULL,
  methodology_version_id uuid NOT NULL,
  methodology_content_hash character(64) NOT NULL CHECK (methodology_content_hash::text ~ '^[0-9a-f]{64}$'),
  assessment_outcome text CHECK (assessment_outcome IN ('RATED','INSUFFICIENT_EVIDENCE')),
  likelihood_level_code text,
  impact_level_code text,
  requested_effective_from timestamptz,          -- NULL = IMMEDIATE (DB transaction instant)
  requested_valid_until timestamptz,             -- MANDATORY on VALIDATE (becomes valid_until); NULL on REVOKE
  expected_current_state_id uuid,                -- NULL = explicit expected-none of the logical key
  target_state_id uuid,                          -- REVOKE only: the exact current VALIDATED assessment state
  target_state_kind text GENERATED ALWAYS AS (CASE WHEN target_state_id IS NULL THEN NULL ELSE 'VALIDATED' END) STORED,
  CONSTRAINT l15_risk_assessment_proposals_pkey PRIMARY KEY (organisation_id, proposal_id),
  CONSTRAINT l15_risk_assessment_proposals_tuple_unique UNIQUE (organisation_id, proposal_id, governed_risk_state_id,
    assessment_basis, methodology_id, methodology_version_id, methodology_content_hash, intent),
  -- M17-S4 executable basis: INHERENT only (RESIDUAL is S6; S6 widens exactly this constraint).
  CONSTRAINT l15_risk_assessment_proposals_basis_executable_check CHECK (assessment_basis = 'INHERENT'),
  CONSTRAINT l15_risk_assessment_proposals_intent_shape_check CHECK (
    (intent = 'VALIDATE' AND target_state_id IS NULL AND assessment_outcome IS NOT NULL AND requested_valid_until IS NOT NULL)
    OR (intent = 'REVOKE' AND target_state_id IS NOT NULL AND expected_current_state_id = target_state_id
        AND assessment_outcome IS NULL AND requested_valid_until IS NULL)),
  -- RATED: both level codes; otherwise (INSUFFICIENT_EVIDENCE / REVOKE): none. No default level.
  CONSTRAINT l15_risk_assessment_proposals_outcome_levels_check CHECK (
    (assessment_outcome = 'RATED' AND likelihood_level_code IS NOT NULL AND impact_level_code IS NOT NULL)
    OR (assessment_outcome IS DISTINCT FROM 'RATED' AND likelihood_level_code IS NULL AND impact_level_code IS NULL)),
  CONSTRAINT l15_risk_assessment_proposals_interval_check CHECK (
    requested_valid_until IS NULL OR requested_effective_from IS NULL OR requested_valid_until > requested_effective_from),
  CONSTRAINT l15_risk_assessment_proposals_envelope_fkey FOREIGN KEY (organisation_id, proposal_id, subject_kind, intent)
    REFERENCES gov_repo.l14_proposals (organisation_id, proposal_id, subject_kind, intent) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT l15_risk_assessment_proposals_governed_risk_fkey
    FOREIGN KEY (organisation_id, governed_risk_state_id, governed_risk_subject_key, governed_risk_scenario_definition_id,
                 governed_risk_scenario_definition_version_id, governed_risk_scenario_content_hash,
                 governed_risk_scenario_validated_state_id, governed_risk_state_kind)
    REFERENCES gov_repo.l15_governed_risk_states (organisation_id, state_id, subject_key, scenario_definition_id,
                 scenario_definition_version_id, scenario_content_hash, scenario_validated_state_id, state_kind)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT l15_risk_assessment_proposals_methodology_fkey
    FOREIGN KEY (organisation_id, methodology_id, methodology_version_id, methodology_content_hash)
    REFERENCES gov_repo.l15_risk_methodology_versions (organisation_id, methodology_id, methodology_version_id, content_hash)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT l15_risk_assessment_proposals_likelihood_fkey
    FOREIGN KEY (organisation_id, methodology_version_id, likelihood_level_code)
    REFERENCES gov_repo.l15_risk_methodology_likelihood_levels (organisation_id, methodology_version_id, level_code)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT l15_risk_assessment_proposals_impact_fkey
    FOREIGN KEY (organisation_id, methodology_version_id, impact_level_code)
    REFERENCES gov_repo.l15_risk_methodology_impact_levels (organisation_id, methodology_version_id, level_code)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT l15_risk_assessment_proposals_cell_fkey
    FOREIGN KEY (organisation_id, methodology_version_id, likelihood_level_code, impact_level_code)
    REFERENCES gov_repo.l15_risk_methodology_rating_cells (organisation_id, methodology_version_id, likelihood_level_code, impact_level_code)
    ON UPDATE RESTRICT ON DELETE RESTRICT
);

-- C2. Typed immutable RISK_ASSESSMENT state. Pins the exact governed-risk state (S3 dependency key), the exact methodology
--     version + DB hash + the exact VALIDATED methodology registry state, the governed content (outcome, levels of the pinned
--     scales, the DB-derived band of the pinned cell), the mandatory validity interval, the deciding proposal, governance
--     decision, ALLOW authorization with its Authority Policy version / hash, source and support. Append-only lineage per
--     logical key: a REVOKED tombstone revokes exactly its VALIDATED predecessor (same key and pins); a VALIDATED successor
--     follows a REVOKED tombstone (re-validation) or renews / corrects a VALIDATED predecessor. Predecessors are never written.
CREATE TABLE gov_repo.l15_risk_assessment_states (
  organisation_id uuid NOT NULL,
  state_id uuid NOT NULL,
  subject_kind text GENERATED ALWAYS AS ('RISK_ASSESSMENT') STORED,
  state_kind text NOT NULL CHECK (state_kind IN ('VALIDATED','REVOKED')),
  assessment_basis text NOT NULL CHECK (assessment_basis IN ('INHERENT','RESIDUAL')),
  governed_risk_state_id uuid NOT NULL,
  governed_risk_subject_key text NOT NULL CHECK (pg_catalog.length(governed_risk_subject_key) BETWEEN 1 AND 1100),
  governed_risk_scenario_definition_id uuid NOT NULL,
  governed_risk_scenario_definition_version_id uuid NOT NULL,
  governed_risk_scenario_content_hash character(64) NOT NULL CHECK (governed_risk_scenario_content_hash::text ~ '^[0-9a-f]{64}$'),
  governed_risk_scenario_validated_state_id uuid NOT NULL,
  governed_risk_state_kind text GENERATED ALWAYS AS ('VALIDATED') STORED,
  methodology_id uuid NOT NULL,
  methodology_version_id uuid NOT NULL,
  methodology_content_hash character(64) NOT NULL CHECK (methodology_content_hash::text ~ '^[0-9a-f]{64}$'),
  methodology_validated_state_id uuid NOT NULL,  -- dependency pin: the exact VALIDATED methodology registry state
  methodology_state_kind text GENERATED ALWAYS AS ('VALIDATED') STORED,
  assessment_outcome text CHECK (assessment_outcome IN ('RATED','INSUFFICIENT_EVIDENCE')),
  likelihood_level_code text,
  impact_level_code text,
  rating_band text CHECK (rating_band IN ('LOW','MODERATE','HIGH','CRITICAL')),   -- DB-derived (guard); never supplied
  predecessor_state_id uuid,
  revokes_state_id uuid,
  revoked_state_kind text GENERATED ALWAYS AS (CASE WHEN revokes_state_id IS NULL THEN NULL ELSE 'VALIDATED' END) STORED,
  effective_from timestamptz NOT NULL,
  valid_until timestamptz,                       -- MANDATORY on VALIDATED: the effective end, [effective_from, valid_until)
  recorded_at timestamptz NOT NULL,
  proposal_id uuid NOT NULL,
  decision_outcome text GENERATED ALWAYS AS (CASE WHEN state_kind = 'VALIDATED' THEN 'VALIDATE' ELSE 'REVOKE' END) STORED,
  governance_decision_id uuid NOT NULL,
  authorization_decision_id uuid NOT NULL,
  authorization_result text GENERATED ALWAYS AS ('ALLOW') STORED,
  authority_policy_id uuid NOT NULL,
  authority_policy_version_id uuid NOT NULL,
  authority_policy_content_hash text NOT NULL CHECK (authority_policy_content_hash ~ '^[0-9a-f]{64}$'),
  source_class text NOT NULL CHECK (source_class = 'LOCAL_HUMAN'),
  support_status text NOT NULL CHECK (support_status IN ('NONE','PRESENT')),
  CONSTRAINT l15_risk_assessment_states_pkey PRIMARY KEY (organisation_id, state_id),
  CONSTRAINT l15_risk_assessment_states_decision_unique UNIQUE (organisation_id, governance_decision_id),
  CONSTRAINT l15_risk_assessment_states_key_unique UNIQUE (organisation_id, state_id, governed_risk_state_id, assessment_basis),
  CONSTRAINT l15_risk_assessment_states_tuple_kind_unique UNIQUE (organisation_id, state_id, governed_risk_state_id,
    assessment_basis, methodology_id, methodology_version_id, methodology_content_hash, state_kind),
  -- The exact dependency key S6 pins (organisation + state + key + methodology pins + VALIDATED).
  CONSTRAINT l15_risk_assessment_states_kind_unique UNIQUE (organisation_id, state_id, governed_risk_state_id, assessment_basis,
    methodology_id, methodology_version_id, methodology_content_hash, methodology_validated_state_id, state_kind),
  CONSTRAINT l15_risk_assessment_states_basis_executable_check CHECK (assessment_basis = 'INHERENT'),
  CONSTRAINT l15_risk_assessment_states_shape_check CHECK (
    (state_kind = 'VALIDATED' AND revokes_state_id IS NULL AND assessment_outcome IS NOT NULL
      AND valid_until IS NOT NULL AND valid_until > effective_from)
    OR (state_kind = 'REVOKED' AND revokes_state_id IS NOT NULL AND predecessor_state_id = revokes_state_id
      AND assessment_outcome IS NULL AND valid_until IS NULL)),
  CONSTRAINT l15_risk_assessment_states_outcome_levels_check CHECK (
    (assessment_outcome = 'RATED' AND likelihood_level_code IS NOT NULL AND impact_level_code IS NOT NULL AND rating_band IS NOT NULL)
    OR (assessment_outcome IS DISTINCT FROM 'RATED' AND likelihood_level_code IS NULL AND impact_level_code IS NULL
        AND rating_band IS NULL)),
  CONSTRAINT l15_risk_assessment_states_self_check CHECK (
    (predecessor_state_id IS NULL OR predecessor_state_id <> state_id) AND (revokes_state_id IS NULL OR revokes_state_id <> state_id)),
  CONSTRAINT l15_risk_assessment_states_first_check CHECK (predecessor_state_id IS NOT NULL OR state_kind = 'VALIDATED'),
  CONSTRAINT l15_risk_assessment_states_governed_risk_fkey
    FOREIGN KEY (organisation_id, governed_risk_state_id, governed_risk_subject_key, governed_risk_scenario_definition_id,
                 governed_risk_scenario_definition_version_id, governed_risk_scenario_content_hash,
                 governed_risk_scenario_validated_state_id, governed_risk_state_kind)
    REFERENCES gov_repo.l15_governed_risk_states (organisation_id, state_id, subject_key, scenario_definition_id,
                 scenario_definition_version_id, scenario_content_hash, scenario_validated_state_id, state_kind)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT l15_risk_assessment_states_methodology_state_fkey
    FOREIGN KEY (organisation_id, methodology_validated_state_id, methodology_id, methodology_version_id,
                 methodology_content_hash, methodology_state_kind)
    REFERENCES gov_repo.l15_risk_methodology_states (organisation_id, state_id, methodology_id, methodology_version_id,
                 content_hash, state_kind) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT l15_risk_assessment_states_likelihood_fkey
    FOREIGN KEY (organisation_id, methodology_version_id, likelihood_level_code)
    REFERENCES gov_repo.l15_risk_methodology_likelihood_levels (organisation_id, methodology_version_id, level_code)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT l15_risk_assessment_states_impact_fkey
    FOREIGN KEY (organisation_id, methodology_version_id, impact_level_code)
    REFERENCES gov_repo.l15_risk_methodology_impact_levels (organisation_id, methodology_version_id, level_code)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT l15_risk_assessment_states_cell_fkey
    FOREIGN KEY (organisation_id, methodology_version_id, likelihood_level_code, impact_level_code)
    REFERENCES gov_repo.l15_risk_methodology_rating_cells (organisation_id, methodology_version_id, likelihood_level_code, impact_level_code)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT l15_risk_assessment_states_predecessor_fkey
    FOREIGN KEY (organisation_id, predecessor_state_id, governed_risk_state_id, assessment_basis)
    REFERENCES gov_repo.l15_risk_assessment_states (organisation_id, state_id, governed_risk_state_id, assessment_basis)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT l15_risk_assessment_states_revokes_fkey
    FOREIGN KEY (organisation_id, revokes_state_id, governed_risk_state_id, assessment_basis, methodology_id,
                 methodology_version_id, methodology_content_hash, methodology_validated_state_id, revoked_state_kind)
    REFERENCES gov_repo.l15_risk_assessment_states (organisation_id, state_id, governed_risk_state_id, assessment_basis,
                 methodology_id, methodology_version_id, methodology_content_hash, methodology_validated_state_id, state_kind)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT l15_risk_assessment_states_proposal_fkey
    FOREIGN KEY (organisation_id, proposal_id, governed_risk_state_id, assessment_basis, methodology_id,
                 methodology_version_id, methodology_content_hash, decision_outcome)
    REFERENCES gov_repo.l15_risk_assessment_proposals (organisation_id, proposal_id, governed_risk_state_id, assessment_basis,
                 methodology_id, methodology_version_id, methodology_content_hash, intent) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT l15_risk_assessment_states_decision_fkey
    FOREIGN KEY (organisation_id, governance_decision_id, subject_kind, decision_outcome, authorization_decision_id)
    REFERENCES gov_repo.l14_governance_decisions (organisation_id, governance_decision_id, subject_kind, outcome, authorization_decision_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT l15_risk_assessment_states_authorization_fkey
    FOREIGN KEY (organisation_id, authorization_decision_id, authorization_result, subject_kind, decision_outcome,
                 authority_policy_id, authority_policy_version_id, authority_policy_content_hash)
    REFERENCES gov_repo.l14_authorization_decisions (organisation_id, authorization_decision_id, result, subject_kind,
                 requested_action, basis_authority_policy_id, basis_version_id, basis_content_hash)
    ON UPDATE RESTRICT ON DELETE RESTRICT
);
CREATE UNIQUE INDEX l15_risk_assessment_states_root_uidx ON gov_repo.l15_risk_assessment_states (organisation_id,
  governed_risk_state_id, assessment_basis) WHERE predecessor_state_id IS NULL;
CREATE UNIQUE INDEX l15_risk_assessment_states_successor_uidx ON gov_repo.l15_risk_assessment_states (organisation_id, predecessor_state_id)
  WHERE predecessor_state_id IS NOT NULL;
CREATE UNIQUE INDEX l15_risk_assessment_states_revocation_uidx ON gov_repo.l15_risk_assessment_states (organisation_id, revokes_state_id)
  WHERE state_kind = 'REVOKED';
CREATE INDEX l15_risk_assessment_states_key_idx ON gov_repo.l15_risk_assessment_states (organisation_id, governed_risk_state_id, assessment_basis);
CREATE INDEX l15_risk_assessment_states_methodology_idx ON gov_repo.l15_risk_assessment_states (organisation_id, methodology_validated_state_id);

-- The REVOKE target and the explicit expected-current of a proposal are exact states of the SAME logical key (and, for a
-- REVOKE, the same methodology pins).
ALTER TABLE gov_repo.l15_risk_assessment_proposals
  ADD CONSTRAINT l15_risk_assessment_proposals_target_state_fkey
    FOREIGN KEY (organisation_id, target_state_id, governed_risk_state_id, assessment_basis, methodology_id,
                 methodology_version_id, methodology_content_hash, target_state_kind)
    REFERENCES gov_repo.l15_risk_assessment_states (organisation_id, state_id, governed_risk_state_id, assessment_basis,
                 methodology_id, methodology_version_id, methodology_content_hash, state_kind) ON UPDATE RESTRICT ON DELETE RESTRICT,
  ADD CONSTRAINT l15_risk_assessment_proposals_expected_state_fkey
    FOREIGN KEY (organisation_id, expected_current_state_id, governed_risk_state_id, assessment_basis)
    REFERENCES gov_repo.l15_risk_assessment_states (organisation_id, state_id, governed_risk_state_id, assessment_basis)
    ON UPDATE RESTRICT ON DELETE RESTRICT;

-- C3. Technical compare-and-set head per logical key: pointer only, created empty by the first state-appending decision,
--     advanced only to the direct lineage successor, reconstructible from history, never authority.
CREATE TABLE gov_repo.l15_risk_assessment_heads (
  organisation_id uuid NOT NULL,
  governed_risk_state_id uuid NOT NULL,
  assessment_basis text NOT NULL CHECK (assessment_basis IN ('INHERENT','RESIDUAL')),
  latest_state_id uuid,
  CONSTRAINT l15_risk_assessment_heads_pkey PRIMARY KEY (organisation_id, governed_risk_state_id, assessment_basis),
  CONSTRAINT l15_risk_assessment_heads_basis_executable_check CHECK (assessment_basis = 'INHERENT'),
  CONSTRAINT l15_risk_assessment_heads_governed_risk_fkey FOREIGN KEY (organisation_id, governed_risk_state_id)
    REFERENCES gov_repo.l15_governed_risk_states (organisation_id, state_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT l15_risk_assessment_heads_state_fkey FOREIGN KEY (organisation_id, latest_state_id, governed_risk_state_id, assessment_basis)
    REFERENCES gov_repo.l15_risk_assessment_states (organisation_id, state_id, governed_risk_state_id, assessment_basis)
    ON UPDATE RESTRICT ON DELETE RESTRICT
);

-- ---------------------------------------------------------------------------------------------------------------------
-- D1. l15_support_links (D-03) widened additively with the RISK_ASSESSMENT rank-3 owners: owner_kind RISK_ASSESSMENT;
--     owner_risk_assessment_artifact names PROPOSAL / DECISION / STATE; exactly one typed owner column (same-tenant composite
--     FK) is non-null (DECISION reuses the S2 owner_governance_decision_id column; the guard pins the decision's subject
--     kind). Targets: RISK_HYPOTHESIS, RISK_SIGNAL and every rank-0 tag (rank 3 -> 2/1/0). No L15 governed artifact is a
--     target tag, so no cycle can exist. S1 / S2 / S3 branches restated verbatim + the new columns NULL.
-- ---------------------------------------------------------------------------------------------------------------------
ALTER TABLE gov_repo.l15_support_links
  ADD COLUMN owner_risk_assessment_artifact text CHECK (owner_risk_assessment_artifact IN ('PROPOSAL','DECISION','STATE')),
  ADD COLUMN owner_risk_assessment_proposal_id uuid,
  ADD COLUMN owner_risk_assessment_state_id uuid;
ALTER TABLE gov_repo.l15_support_links
  DROP CONSTRAINT l15_support_links_owner_kind_check,
  DROP CONSTRAINT l15_support_links_owner_shape_check,
  DROP CONSTRAINT l15_support_links_owner_target_matrix_check;
ALTER TABLE gov_repo.l15_support_links
  ADD CONSTRAINT l15_support_links_owner_kind_check CHECK (owner_kind IN (
    'RISK_SIGNAL','RISK_HYPOTHESIS','RISK_SCENARIO_DEFINITION','RISK_METHODOLOGY','GOVERNED_RISK','RISK_ASSESSMENT')),
  ADD CONSTRAINT l15_support_links_owner_shape_check CHECK (
    (owner_kind = 'RISK_SIGNAL' AND owner_signal_id IS NOT NULL AND owner_signal_kind IS NOT NULL AND owner_hypothesis_id IS NULL
      AND owner_registry_artifact IS NULL
      AND pg_catalog.num_nonnulls(owner_scenario_proposal_id, owner_methodology_proposal_id, owner_governance_decision_id,
                                  owner_scenario_state_id, owner_methodology_state_id) = 0
      AND pg_catalog.num_nonnulls(owner_governed_risk_artifact, owner_governed_risk_proposal_id, owner_governed_risk_state_id) = 0
      AND pg_catalog.num_nonnulls(owner_risk_assessment_artifact, owner_risk_assessment_proposal_id, owner_risk_assessment_state_id) = 0)
    OR (owner_kind = 'RISK_HYPOTHESIS' AND owner_hypothesis_id IS NOT NULL AND owner_signal_id IS NULL AND owner_signal_kind IS NULL
      AND owner_registry_artifact IS NULL
      AND pg_catalog.num_nonnulls(owner_scenario_proposal_id, owner_methodology_proposal_id, owner_governance_decision_id,
                                  owner_scenario_state_id, owner_methodology_state_id) = 0
      AND pg_catalog.num_nonnulls(owner_governed_risk_artifact, owner_governed_risk_proposal_id, owner_governed_risk_state_id) = 0
      AND pg_catalog.num_nonnulls(owner_risk_assessment_artifact, owner_risk_assessment_proposal_id, owner_risk_assessment_state_id) = 0)
    OR (owner_kind = 'RISK_SCENARIO_DEFINITION' AND owner_signal_id IS NULL AND owner_signal_kind IS NULL AND owner_hypothesis_id IS NULL
      AND owner_methodology_proposal_id IS NULL AND owner_methodology_state_id IS NULL
      AND pg_catalog.num_nonnulls(owner_scenario_proposal_id, owner_governance_decision_id, owner_scenario_state_id) = 1
      AND ((owner_registry_artifact = 'PROPOSAL') = (owner_scenario_proposal_id IS NOT NULL))
      AND ((owner_registry_artifact = 'DECISION') = (owner_governance_decision_id IS NOT NULL))
      AND ((owner_registry_artifact = 'STATE') = (owner_scenario_state_id IS NOT NULL))
      AND pg_catalog.num_nonnulls(owner_governed_risk_artifact, owner_governed_risk_proposal_id, owner_governed_risk_state_id) = 0
      AND pg_catalog.num_nonnulls(owner_risk_assessment_artifact, owner_risk_assessment_proposal_id, owner_risk_assessment_state_id) = 0)
    OR (owner_kind = 'RISK_METHODOLOGY' AND owner_signal_id IS NULL AND owner_signal_kind IS NULL AND owner_hypothesis_id IS NULL
      AND owner_scenario_proposal_id IS NULL AND owner_scenario_state_id IS NULL
      AND pg_catalog.num_nonnulls(owner_methodology_proposal_id, owner_governance_decision_id, owner_methodology_state_id) = 1
      AND ((owner_registry_artifact = 'PROPOSAL') = (owner_methodology_proposal_id IS NOT NULL))
      AND ((owner_registry_artifact = 'DECISION') = (owner_governance_decision_id IS NOT NULL))
      AND ((owner_registry_artifact = 'STATE') = (owner_methodology_state_id IS NOT NULL))
      AND pg_catalog.num_nonnulls(owner_governed_risk_artifact, owner_governed_risk_proposal_id, owner_governed_risk_state_id) = 0
      AND pg_catalog.num_nonnulls(owner_risk_assessment_artifact, owner_risk_assessment_proposal_id, owner_risk_assessment_state_id) = 0)
    OR (owner_kind = 'GOVERNED_RISK' AND owner_signal_id IS NULL AND owner_signal_kind IS NULL AND owner_hypothesis_id IS NULL
      AND owner_registry_artifact IS NULL
      AND pg_catalog.num_nonnulls(owner_scenario_proposal_id, owner_methodology_proposal_id, owner_scenario_state_id,
                                  owner_methodology_state_id) = 0
      AND pg_catalog.num_nonnulls(owner_governed_risk_proposal_id, owner_governance_decision_id, owner_governed_risk_state_id) = 1
      AND ((owner_governed_risk_artifact = 'PROPOSAL') = (owner_governed_risk_proposal_id IS NOT NULL))
      AND ((owner_governed_risk_artifact = 'DECISION') = (owner_governance_decision_id IS NOT NULL))
      AND ((owner_governed_risk_artifact = 'STATE') = (owner_governed_risk_state_id IS NOT NULL))
      AND pg_catalog.num_nonnulls(owner_risk_assessment_artifact, owner_risk_assessment_proposal_id, owner_risk_assessment_state_id) = 0)
    OR (owner_kind = 'RISK_ASSESSMENT' AND owner_signal_id IS NULL AND owner_signal_kind IS NULL AND owner_hypothesis_id IS NULL
      AND owner_registry_artifact IS NULL
      AND pg_catalog.num_nonnulls(owner_scenario_proposal_id, owner_methodology_proposal_id, owner_scenario_state_id,
                                  owner_methodology_state_id) = 0
      AND pg_catalog.num_nonnulls(owner_governed_risk_artifact, owner_governed_risk_proposal_id, owner_governed_risk_state_id) = 0
      AND owner_risk_assessment_artifact IS NOT NULL
      AND pg_catalog.num_nonnulls(owner_risk_assessment_proposal_id, owner_governance_decision_id, owner_risk_assessment_state_id) = 1
      AND ((owner_risk_assessment_artifact = 'PROPOSAL') = (owner_risk_assessment_proposal_id IS NOT NULL))
      AND ((owner_risk_assessment_artifact = 'DECISION') = (owner_governance_decision_id IS NOT NULL))
      AND ((owner_risk_assessment_artifact = 'STATE') = (owner_risk_assessment_state_id IS NOT NULL)))),
  -- §9.2 closed acyclic owner -> target matrix: rank 1 -> rank 0, rank 2 -> rank 1, rank-3 registry -> two rank-0 tags,
  -- rank-3 GOVERNED_RISK / RISK_ASSESSMENT -> rank 2 / 1 / 0 (every tag of the closed union; none is an L15 governed artifact).
  ADD CONSTRAINT l15_support_links_owner_target_matrix_check CHECK (
    (owner_kind = 'RISK_SIGNAL' AND target_tag IN ('DISCOVERY_EVIDENCE','SOURCE_ASSERTION','RUNTIME_OBSERVATION',
      'CROSS_SIGNAL_RESULT','EXECUTION_FIELD_STATE','TECHNICAL_FIELD_STATE','LINEAGE_OBSERVATION','L14_FACT_STATE'))
    OR (owner_kind = 'RISK_HYPOTHESIS' AND target_tag = 'RISK_SIGNAL')
    OR (owner_kind IN ('RISK_SCENARIO_DEFINITION','RISK_METHODOLOGY') AND target_tag IN ('DISCOVERY_EVIDENCE','SOURCE_ASSERTION'))
    OR (owner_kind = 'GOVERNED_RISK' AND target_tag IN ('RISK_HYPOTHESIS','RISK_SIGNAL','DISCOVERY_EVIDENCE','SOURCE_ASSERTION',
      'RUNTIME_OBSERVATION','CROSS_SIGNAL_RESULT','EXECUTION_FIELD_STATE','TECHNICAL_FIELD_STATE','LINEAGE_OBSERVATION','L14_FACT_STATE'))
    OR (owner_kind = 'RISK_ASSESSMENT' AND target_tag IN ('RISK_HYPOTHESIS','RISK_SIGNAL','DISCOVERY_EVIDENCE','SOURCE_ASSERTION',
      'RUNTIME_OBSERVATION','CROSS_SIGNAL_RESULT','EXECUTION_FIELD_STATE','TECHNICAL_FIELD_STATE','LINEAGE_OBSERVATION','L14_FACT_STATE'))),
  ADD CONSTRAINT l15_support_links_owner_risk_assessment_proposal_fkey FOREIGN KEY (organisation_id, owner_risk_assessment_proposal_id)
    REFERENCES gov_repo.l15_risk_assessment_proposals (organisation_id, proposal_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  ADD CONSTRAINT l15_support_links_owner_risk_assessment_state_fkey FOREIGN KEY (organisation_id, owner_risk_assessment_state_id)
    REFERENCES gov_repo.l15_risk_assessment_states (organisation_id, state_id) ON UPDATE RESTRICT ON DELETE RESTRICT;
-- One link per RISK_ASSESSMENT owner x exact typed target.
CREATE UNIQUE INDEX l15_support_links_risk_assessment_owner_target_unique ON gov_repo.l15_support_links (organisation_id,
  owner_risk_assessment_artifact, (COALESCE(owner_risk_assessment_proposal_id, owner_governance_decision_id, owner_risk_assessment_state_id)),
  target_tag, (COALESCE(target_discovery_evidence_id, target_source_assertion_id, (target_runtime_observation_id)::text,
    target_cross_signal_comparison_id, target_execution_field_state_id, target_technical_field_state_id,
    target_lineage_observation_finding_id, (target_l14_fact_state_id)::text, (target_risk_signal_id)::text,
    (target_risk_hypothesis_id)::text)))
  WHERE owner_kind = 'RISK_ASSESSMENT';
CREATE INDEX l15_support_links_risk_assessment_state_idx ON gov_repo.l15_support_links (organisation_id, owner_risk_assessment_state_id)
  WHERE owner_risk_assessment_state_id IS NOT NULL;

-- The S1 / S2 / S3 link guard, extended (S1, S2 and S3 branches verbatim): a RISK_ASSESSMENT owner must have been written
-- by THIS transaction (its row xmin is the current transaction id; a DECISION owner must be a governance decision of
-- exactly RISK_ASSESSMENT), and a CROSS_SIGNAL_RESULT target keeps the S1 outcome admissibility.
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
  ELSIF NEW.owner_kind = 'RISK_ASSESSMENT' THEN
    IF NOT (CASE NEW.owner_risk_assessment_artifact
      WHEN 'PROPOSAL' THEN EXISTS (
        SELECT 1 FROM gov_repo.l15_risk_assessment_proposals AS p
        WHERE p.organisation_id = NEW.organisation_id AND p.proposal_id = NEW.owner_risk_assessment_proposal_id
          AND p.xmin = pg_catalog.pg_current_xact_id()::xid)
      WHEN 'DECISION' THEN EXISTS (
        SELECT 1 FROM gov_repo.l14_governance_decisions AS d
        WHERE d.organisation_id = NEW.organisation_id AND d.governance_decision_id = NEW.owner_governance_decision_id
          AND d.subject_kind = 'RISK_ASSESSMENT' AND d.xmin = pg_catalog.pg_current_xact_id()::xid)
      WHEN 'STATE' THEN EXISTS (
        SELECT 1 FROM gov_repo.l15_risk_assessment_states AS s
        WHERE s.organisation_id = NEW.organisation_id AND s.state_id = NEW.owner_risk_assessment_state_id
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

-- Typed RISK_ASSESSMENT-owner link writer (one row per normalized support entry; the S1 normalizer resolves same-tenant
-- targets of every tag and fails closed on an unknown / foreign / malformed target).
CREATE FUNCTION gov_repo.l15_write_risk_assessment_support_links_v1(p_organisation_id uuid, p_artifact text,
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
    INSERT INTO gov_repo.l15_support_links (organisation_id, link_id, owner_kind, owner_risk_assessment_artifact,
      owner_risk_assessment_proposal_id, owner_governance_decision_id, owner_risk_assessment_state_id, target_tag,
      target_discovery_evidence_id, target_source_assertion_id, target_runtime_observation_id, target_cross_signal_comparison_id,
      target_execution_field_state_id, target_technical_field_state_id, target_lineage_observation_finding_id,
      target_l14_fact_state_id, target_l14_fact_subject_kind, target_risk_signal_id, target_risk_hypothesis_id, recorded_at)
    VALUES (p_organisation_id, pg_catalog.gen_random_uuid(), 'RISK_ASSESSMENT', p_artifact,
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
-- D2. l14_command_results: the D-01 §4 L15 decision-result branch widened from the two registries + GOVERNED_RISK to
--     RISK_ASSESSMENT (a VALIDATED / REVOKED RISK_ASSESSMENT decision result references the exact L15 state; never an AP /
--     registry / fact state). Every other branch restated verbatim.
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
      OR (subject_kind IN ('RISK_SCENARIO_DEFINITION','RISK_METHODOLOGY','GOVERNED_RISK','RISK_ASSESSMENT')
        AND command_kind = 'DECIDE_PROPOSAL' AND outcome IN ('VALIDATED','REVOKED') AND authorization_decision_id IS NOT NULL
        AND proposal_id IS NOT NULL AND governance_decision_id IS NOT NULL AND l15_state_id IS NOT NULL)))),
  -- l15_state_id is set ONLY on an L15 registry / GOVERNED_RISK / RISK_ASSESSMENT VALIDATED / REVOKED decision result (S5+
  -- widen this).
  ADD CONSTRAINT l14_command_results_l15_state_check CHECK (
    l15_state_id IS NULL
    OR (subject_kind IN ('RISK_SCENARIO_DEFINITION','RISK_METHODOLOGY','GOVERNED_RISK','RISK_ASSESSMENT')
        AND command_kind = 'DECIDE_PROPOSAL' AND outcome IN ('VALIDATED','REVOKED')));

-- The S2 / S3 owner-only result guard, extended (S2 / S3 branches verbatim): a RISK_ASSESSMENT result names the exact L15
-- state of that decision / proposal / authorization / instant.
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
       WHEN 'RISK_ASSESSMENT' THEN EXISTS (
         SELECT 1 FROM gov_repo.l15_risk_assessment_states AS s
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
-- E1. A RISK_ASSESSMENT proposal is LOCAL_HUMAN only (SYSTEM_SEED / SOURCE_CONNECTION are never admissible for this family);
--     the executable basis / GOVERNED_RISK VALIDATED pin / methodology / level membership are structural (CHECK / FK).
CREATE FUNCTION gov_repo.l15_risk_assessment_proposal_guard_v1() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $guard$
DECLARE
  v_envelope_source text;
BEGIN
  SELECT p.source_class INTO v_envelope_source
  FROM gov_repo.l14_proposals AS p
  WHERE p.organisation_id = NEW.organisation_id AND p.proposal_id = NEW.proposal_id AND p.subject_kind = 'RISK_ASSESSMENT';
  IF v_envelope_source IS DISTINCT FROM 'LOCAL_HUMAN' THEN
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'RISK_ASSESSMENT_PROPOSAL_SOURCE_INVALID';
  END IF;
  RETURN NEW;
END;
$guard$;
CREATE TRIGGER l15_risk_assessment_proposals_guard BEFORE INSERT ON gov_repo.l15_risk_assessment_proposals
  FOR EACH ROW EXECUTE FUNCTION gov_repo.l15_risk_assessment_proposal_guard_v1();

-- E2. A state mirrors its exact decision / proposal / authorization target (the SUBJECT OF THE PINNED GOVERNED_RISK STATE),
--     is recorded at the decision instant, takes its effective_from from the proposal (NULL request = the decision instant)
--     and its mandatory valid_until only from a VALIDATE proposal, respects the per-key interval lineage (the M16
--     CONTROL_ASSESSMENT renewal / correction rules) and, when VALIDATED: the pinned GOVERNED_RISK state is CURRENT and the
--     pinned methodology state is EXACTLY the one the S2 exact resolver returns, both at the state's own (effective_from,
--     recorded_at); valid_until is within the pinned version's maximum; the band is EXACTLY the pinned cell's band.
CREATE FUNCTION gov_repo.l15_risk_assessment_state_guard_v1() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $guard$
DECLARE
  v_decision record;
  v_proposal record;
  v_authz record;
  v_risk record;
  v_predecessor record;
  v_maximum interval;
BEGIN
  SELECT d.proposal_id, d.decided_at, d.support_status, d.actor_user_id INTO v_decision
  FROM gov_repo.l14_governance_decisions AS d
  WHERE d.organisation_id = NEW.organisation_id AND d.governance_decision_id = NEW.governance_decision_id
    AND d.subject_kind = 'RISK_ASSESSMENT';
  SELECT p.source_class, t.* INTO v_proposal
  FROM gov_repo.l14_proposals AS p
  JOIN gov_repo.l15_risk_assessment_proposals AS t ON t.organisation_id = p.organisation_id AND t.proposal_id = p.proposal_id
  WHERE p.organisation_id = NEW.organisation_id AND p.proposal_id = NEW.proposal_id;
  IF v_decision.proposal_id IS DISTINCT FROM NEW.proposal_id OR v_decision.decided_at IS DISTINCT FROM NEW.recorded_at
     OR v_decision.support_status IS DISTINCT FROM NEW.support_status
     OR v_proposal.source_class IS DISTINCT FROM NEW.source_class
     OR v_proposal.assessment_basis IS DISTINCT FROM NEW.assessment_basis
     OR v_proposal.governed_risk_state_id IS DISTINCT FROM NEW.governed_risk_state_id
     OR v_proposal.methodology_id IS DISTINCT FROM NEW.methodology_id
     OR v_proposal.methodology_version_id IS DISTINCT FROM NEW.methodology_version_id
     OR v_proposal.methodology_content_hash IS DISTINCT FROM NEW.methodology_content_hash
     OR v_proposal.assessment_outcome IS DISTINCT FROM NEW.assessment_outcome
     OR v_proposal.likelihood_level_code IS DISTINCT FROM NEW.likelihood_level_code
     OR v_proposal.impact_level_code IS DISTINCT FROM NEW.impact_level_code
     OR v_proposal.target_state_id IS DISTINCT FROM NEW.revokes_state_id
     OR v_proposal.expected_current_state_id IS DISTINCT FROM NEW.predecessor_state_id
     OR NEW.effective_from IS DISTINCT FROM COALESCE(v_proposal.requested_effective_from, NEW.recorded_at)
     OR NEW.valid_until IS DISTINCT FROM (CASE WHEN NEW.state_kind = 'VALIDATED' THEN v_proposal.requested_valid_until END) THEN
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'RISK_ASSESSMENT_STATE_ENVELOPE_MISMATCH';
  END IF;
  -- The authorization target is the exact subject of the pinned GOVERNED_RISK state (never the assessment, the methodology,
  -- the band, the domain or a level).
  SELECT s.subject_type, s.subject_canonical_kind, s.subject_canonical_object_id, s.subject_relationship_type,
         s.subject_relationship_id, s.subject_relationship_state_id INTO v_risk
  FROM gov_repo.l15_governed_risk_states AS s
  WHERE s.organisation_id = NEW.organisation_id AND s.state_id = NEW.governed_risk_state_id;
  SELECT a.scope_tag, a.target_canonical_kind, a.target_canonical_object_id, a.target_relationship_type,
         a.target_relationship_id, a.target_relationship_state_id, a.source_class, a.evaluated_at, a.actor_user_id
  INTO v_authz
  FROM gov_repo.l14_authorization_decisions AS a
  WHERE a.organisation_id = NEW.organisation_id AND a.authorization_decision_id = NEW.authorization_decision_id;
  IF NOT FOUND OR v_risk.subject_type IS NULL OR v_authz.source_class IS DISTINCT FROM NEW.source_class
     OR v_authz.scope_tag IS DISTINCT FROM v_risk.subject_type
     OR v_authz.target_canonical_kind IS DISTINCT FROM v_risk.subject_canonical_kind
     OR v_authz.target_canonical_object_id IS DISTINCT FROM v_risk.subject_canonical_object_id
     OR v_authz.target_relationship_type IS DISTINCT FROM v_risk.subject_relationship_type
     OR v_authz.target_relationship_id IS DISTINCT FROM v_risk.subject_relationship_id
     OR v_authz.target_relationship_state_id IS DISTINCT FROM v_risk.subject_relationship_state_id
     OR v_authz.evaluated_at IS DISTINCT FROM NEW.recorded_at OR v_authz.actor_user_id IS DISTINCT FROM v_decision.actor_user_id THEN
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'RISK_ASSESSMENT_STATE_AUTHORIZATION_TARGET_MISMATCH';
  END IF;
  IF NEW.predecessor_state_id IS NOT NULL THEN
    SELECT s.state_kind, s.effective_from, s.valid_until INTO v_predecessor
    FROM gov_repo.l15_risk_assessment_states AS s
    WHERE s.organisation_id = NEW.organisation_id AND s.state_id = NEW.predecessor_state_id;
    IF NEW.state_kind = 'REVOKED' THEN
      IF NEW.effective_from < v_predecessor.effective_from THEN
        RAISE EXCEPTION 'L15_CONTINUITY_VIOLATION' USING ERRCODE = 'GV011', DETAIL = 'REVOKE_BEFORE_TARGET_EFFECTIVE';
      END IF;
      IF v_predecessor.valid_until IS NOT NULL AND NEW.effective_from >= v_predecessor.valid_until THEN
        RAISE EXCEPTION 'L15_CONTINUITY_VIOLATION' USING ERRCODE = 'GV011', DETAIL = 'REVOKE_AFTER_TARGET_EXPIRY';
      END IF;
    ELSIF v_predecessor.state_kind = 'REVOKED' THEN
      IF NOT (NEW.effective_from >= v_predecessor.effective_from) THEN
        RAISE EXCEPTION 'L15_CONTINUITY_VIOLATION' USING ERRCODE = 'GV011', DETAIL = 'REVALIDATION_OVERLAPS_PRIOR_INTERVAL';
      END IF;
    ELSIF NEW.effective_from < v_predecessor.effective_from THEN
      -- Renewal / correction: never before the predecessor's start (its closure is derived from this successor).
      RAISE EXCEPTION 'L15_CONTINUITY_VIOLATION' USING ERRCODE = 'GV011', DETAIL = 'SUCCESSOR_BEFORE_PREDECESSOR_EFFECTIVE';
    END IF;
  END IF;
  IF NEW.state_kind = 'VALIDATED' THEN
    IF NOT gov_repo.l15_governed_risk_state_current_v1(NEW.organisation_id, NEW.governed_risk_state_id, NEW.effective_from,
         NEW.recorded_at) THEN
      RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'GOVERNED_RISK_DEPENDENCY_NOT_VALID';
    END IF;
    IF NOT EXISTS (
         SELECT 1 FROM gov_repo.l15_risk_methodology_valid_state_v1(NEW.organisation_id, NEW.methodology_id,
           NEW.methodology_version_id, NEW.methodology_content_hash::text, NEW.effective_from, NEW.recorded_at) AS mv
         WHERE mv.state_id = NEW.methodology_validated_state_id) THEN
      RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'METHODOLOGY_DEPENDENCY_NOT_VALID';
    END IF;
    SELECT v.assessment_validity_maximum INTO v_maximum
    FROM gov_repo.l15_risk_methodology_versions AS v
    WHERE v.organisation_id = NEW.organisation_id AND v.methodology_id = NEW.methodology_id
      AND v.methodology_version_id = NEW.methodology_version_id AND v.content_hash = NEW.methodology_content_hash;
    IF NOT (NEW.valid_until <= gov_repo.l15_assessment_validity_limit_v1(NEW.effective_from, v_maximum)) THEN
      RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'VALIDITY_EXCEEDS_METHODOLOGY_MAXIMUM';
    END IF;
    IF NEW.rating_band IS DISTINCT FROM (CASE WHEN NEW.assessment_outcome = 'RATED' THEN
         gov_repo.l15_risk_assessment_rating_band_v1(NEW.organisation_id, NEW.methodology_version_id,
           NEW.likelihood_level_code, NEW.impact_level_code) END) THEN
      RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'RATING_BAND_NOT_DERIVED';
    END IF;
  END IF;
  RETURN NEW;
END;
$guard$;
CREATE TRIGGER l15_risk_assessment_states_guard BEFORE INSERT ON gov_repo.l15_risk_assessment_states
  FOR EACH ROW EXECUTE FUNCTION gov_repo.l15_risk_assessment_state_guard_v1();

-- E3. Commit-time (DEFERRABLE INITIALLY DEFERRED) support integrity: a proposal's stored support_status equals its actual
--     link set; a state's link set equals its decision's link set and its support_status.
-- SECURITY DEFINER necessity (as the S1 / S2 / S3 commit guards): a deferred trigger fires at COMMIT as the committing role
-- (service_role), which by design holds no L15 table privilege. Trigger function only: EXECUTE is owner-only; it reads L15 /
-- envelope rows and writes nothing.
CREATE FUNCTION gov_repo.l15_risk_assessment_commit_guard_v1() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $fn$
DECLARE
  v_a bigint;
  v_b bigint;
  v_status text;
BEGIN
  IF TG_TABLE_NAME = 'l15_risk_assessment_proposals' THEN
    SELECT p.support_status INTO v_status FROM gov_repo.l14_proposals AS p
    WHERE p.organisation_id = NEW.organisation_id AND p.proposal_id = NEW.proposal_id;
    SELECT pg_catalog.count(*) INTO v_a FROM gov_repo.l15_support_links AS l
    WHERE l.organisation_id = NEW.organisation_id AND l.owner_kind = 'RISK_ASSESSMENT'
      AND l.owner_risk_assessment_artifact = 'PROPOSAL' AND l.owner_risk_assessment_proposal_id = NEW.proposal_id;
    IF v_status IS NULL OR (v_status = 'PRESENT') <> (v_a > 0) THEN
      RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'RISK_ASSESSMENT_PROPOSAL_SUPPORT_INCOMPLETE';
    END IF;
  ELSIF TG_TABLE_NAME = 'l15_risk_assessment_states' THEN
    SELECT pg_catalog.count(*) INTO v_a FROM gov_repo.l15_support_links AS l
    WHERE l.organisation_id = NEW.organisation_id AND l.owner_kind = 'RISK_ASSESSMENT'
      AND l.owner_risk_assessment_artifact = 'STATE' AND l.owner_risk_assessment_state_id = NEW.state_id;
    SELECT pg_catalog.count(*) INTO v_b FROM gov_repo.l15_support_links AS l
    WHERE l.organisation_id = NEW.organisation_id AND l.owner_kind = 'RISK_ASSESSMENT'
      AND l.owner_risk_assessment_artifact = 'DECISION' AND l.owner_governance_decision_id = NEW.governance_decision_id;
    IF (NEW.support_status = 'PRESENT') <> (v_a > 0) OR v_a <> v_b THEN
      RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'RISK_ASSESSMENT_STATE_SUPPORT_INCOMPLETE';
    END IF;
  ELSE
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'UNEXPECTED_STORE';
  END IF;
  RETURN NULL;
END;
$fn$;
CREATE CONSTRAINT TRIGGER l15_risk_assessment_proposals_support_complete AFTER INSERT ON gov_repo.l15_risk_assessment_proposals
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION gov_repo.l15_risk_assessment_commit_guard_v1();
CREATE CONSTRAINT TRIGGER l15_risk_assessment_states_support_complete AFTER INSERT ON gov_repo.l15_risk_assessment_states
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION gov_repo.l15_risk_assessment_commit_guard_v1();

-- E4. The head is the only mutable RISK_ASSESSMENT table: created empty, key fixed, never deleted / truncated, only ever
--     advanced to the direct lineage successor of its current state.
CREATE FUNCTION gov_repo.l15_risk_assessment_head_guard_v1() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $head$
BEGIN
  IF TG_OP IN ('DELETE','TRUNCATE') THEN
    RAISE EXCEPTION 'L15_HISTORY_IMMUTABLE' USING ERRCODE = '55000', DETAIL = 'l15_risk_assessment_heads:' || TG_OP;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.latest_state_id IS NOT NULL THEN
      RAISE EXCEPTION 'L15_HISTORY_IMMUTABLE' USING ERRCODE = '55000', DETAIL = 'l15_risk_assessment_heads:INSERT_WITH_STATE';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.organisation_id IS DISTINCT FROM OLD.organisation_id OR NEW.governed_risk_state_id IS DISTINCT FROM OLD.governed_risk_state_id
     OR NEW.assessment_basis IS DISTINCT FROM OLD.assessment_basis
     OR (OLD.latest_state_id IS NOT NULL AND NEW.latest_state_id IS NULL) THEN
    RAISE EXCEPTION 'L15_HISTORY_IMMUTABLE' USING ERRCODE = '55000', DETAIL = 'l15_risk_assessment_heads:IDENTITY';
  END IF;
  IF NEW.latest_state_id IS DISTINCT FROM OLD.latest_state_id AND NOT EXISTS (
       SELECT 1 FROM gov_repo.l15_risk_assessment_states AS s
       WHERE s.organisation_id = NEW.organisation_id AND s.state_id = NEW.latest_state_id
         AND s.governed_risk_state_id = OLD.governed_risk_state_id AND s.assessment_basis = OLD.assessment_basis
         AND s.predecessor_state_id IS NOT DISTINCT FROM OLD.latest_state_id) THEN
    RAISE EXCEPTION 'L15_HISTORY_IMMUTABLE' USING ERRCODE = '55000', DETAIL = 'l15_risk_assessment_heads:LINEAGE';
  END IF;
  RETURN NEW;
END;
$head$;
CREATE TRIGGER l15_risk_assessment_heads_guard BEFORE INSERT OR UPDATE OR DELETE ON gov_repo.l15_risk_assessment_heads
  FOR EACH ROW EXECUTE FUNCTION gov_repo.l15_risk_assessment_head_guard_v1();
CREATE TRIGGER l15_risk_assessment_heads_no_truncate BEFORE TRUNCATE ON gov_repo.l15_risk_assessment_heads
  FOR EACH STATEMENT EXECUTE FUNCTION gov_repo.l15_risk_assessment_head_guard_v1();

-- ---------------------------------------------------------------------------------------------------------------------
-- F1. Owner-only exact bitemporal RISK_ASSESSMENT resolver (the S6 dependency contract). The exact VALIDATED assessment of
--     the exact logical key (organisation + exact governed_risk_state_id + basis; NEVER a subject, a scenario, a domain, a
--     band, a methodology, a successor risk state or another tenant) valid at business instant p_effective_at as known at
--     system cutoff p_recorded_cutoff, returned ONLY when ALL hold at the SAME pair of coordinates:
--       * own state: recorded_at <= cutoff, effective_from <= instant < valid_until (expiry needs no row update), and no
--         VISIBLE lineage successor (renewal / correction or the exact REVOKED tombstone, recorded <= cutoff) with
--         effective_from <= instant — closure is DERIVED, never stored, so a later-recorded successor never leaks into an
--         earlier cutoff and a future-effective successor / REVOKE never hides the state early; exactly one candidate;
--       * GOVERNED_RISK dependency: the pinned state is CURRENT (l15_governed_risk_state_current_v1: its own key's exact
--         resolver, incl. subject resolution and the scenario dependency) — a revoked / superseded / expired /
--         dependency-invalid risk state makes the assessment not current; it never transfers to a successor risk state;
--       * methodology dependency: the pinned VALIDATED methodology state is EXACTLY the state the S2 exact resolver returns for
--         the same identity + version + hash (a revoked / not-yet-effective / not-visible methodology makes the assessment
--         not current; it is never repinned to another version or a re-validation).
--     No row otherwise = UNKNOWN. Dependency invalidation never writes a row and never manufactures REVOKED.
-- ---------------------------------------------------------------------------------------------------------------------
CREATE FUNCTION gov_repo.l15_risk_assessment_valid_state_v1(
  p_organisation_id uuid, p_governed_risk_state_id uuid, p_assessment_basis text,
  p_effective_at timestamptz, p_recorded_cutoff timestamptz)
RETURNS TABLE (state_id uuid, assessment_outcome text, likelihood_level_code text, impact_level_code text, rating_band text,
               methodology_id uuid, methodology_version_id uuid, methodology_content_hash text,
               methodology_validated_state_id uuid, effective_from timestamptz, valid_until timestamptz, recorded_at timestamptz)
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  WITH visible AS (
    SELECT s.state_id, s.state_kind, s.predecessor_state_id, s.effective_from, s.valid_until, s.recorded_at,
           s.assessment_outcome, s.likelihood_level_code, s.impact_level_code, s.rating_band, s.methodology_id,
           s.methodology_version_id, s.methodology_content_hash, s.methodology_validated_state_id
    FROM gov_repo.l15_risk_assessment_states AS s
    WHERE s.organisation_id = p_organisation_id AND s.governed_risk_state_id = p_governed_risk_state_id
      AND s.assessment_basis = p_assessment_basis AND s.recorded_at <= p_recorded_cutoff
  ), candidates AS (
    SELECT v.* FROM visible AS v
    WHERE v.state_kind = 'VALIDATED' AND v.effective_from <= p_effective_at
      AND v.valid_until IS NOT NULL AND p_effective_at < v.valid_until
      AND NOT EXISTS (SELECT 1 FROM visible AS n WHERE n.predecessor_state_id = v.state_id AND n.effective_from <= p_effective_at)
  )
  SELECT c.state_id, c.assessment_outcome, c.likelihood_level_code, c.impact_level_code, c.rating_band, c.methodology_id,
         c.methodology_version_id, c.methodology_content_hash::text, c.methodology_validated_state_id, c.effective_from,
         c.valid_until, c.recorded_at
  FROM candidates AS c
  WHERE (SELECT pg_catalog.count(*) FROM candidates) = 1
    AND gov_repo.l15_governed_risk_state_current_v1(p_organisation_id, p_governed_risk_state_id, p_effective_at, p_recorded_cutoff)
    AND EXISTS (SELECT 1 FROM gov_repo.l15_risk_methodology_valid_state_v1(p_organisation_id, c.methodology_id,
                  c.methodology_version_id, c.methodology_content_hash::text, p_effective_at, p_recorded_cutoff) AS mv
                WHERE mv.state_id = c.methodology_validated_state_id)
$$;

-- Exact-state form (the S6 pin check): is THIS exact assessment state THE current assessment of its own logical key at both
-- coordinates? Never "the latest assessment of the risk", never a successor.
CREATE FUNCTION gov_repo.l15_risk_assessment_state_current_v1(
  p_organisation_id uuid, p_state_id uuid, p_effective_at timestamptz, p_recorded_cutoff timestamptz)
RETURNS boolean LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT COALESCE((
    SELECT EXISTS (SELECT 1 FROM gov_repo.l15_risk_assessment_valid_state_v1(s.organisation_id, s.governed_risk_state_id,
                     s.assessment_basis, p_effective_at, p_recorded_cutoff) AS v
                   WHERE v.state_id = s.state_id)
    FROM gov_repo.l15_risk_assessment_states AS s
    WHERE s.organisation_id = p_organisation_id AND s.state_id = p_state_id AND s.state_kind = 'VALIDATED'), false)
$$;

-- Closed not-current classification of the latest VISIBLE lineage state of one logical key at both coordinates (read
-- projection only; persists nothing): CURRENT, NO_STATE, REVOKED, NOT_YET_EFFECTIVE, EXPIRED,
-- GOVERNED_RISK_DEPENDENCY_INVALID, METHODOLOGY_DEPENDENCY_INVALID. The latest visible state = the visible state without a
-- visible lineage successor that is already effective at the instant (a future-effective successor never hides early).
CREATE FUNCTION gov_repo.l15_risk_assessment_resolution_v1(
  p_organisation_id uuid, p_governed_risk_state_id uuid, p_assessment_basis text,
  p_effective_at timestamptz, p_recorded_cutoff timestamptz)
RETURNS TABLE (resolution text, state_id uuid, state_kind text)
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  WITH visible AS (
    SELECT s.* FROM gov_repo.l15_risk_assessment_states AS s
    WHERE s.organisation_id = p_organisation_id AND s.governed_risk_state_id = p_governed_risk_state_id
      AND s.assessment_basis = p_assessment_basis AND s.recorded_at <= p_recorded_cutoff
  ), latest AS (
    SELECT v.* FROM visible AS v
    WHERE (v.effective_from <= p_effective_at OR v.predecessor_state_id IS NULL)
      AND NOT EXISTS (SELECT 1 FROM visible AS n WHERE n.predecessor_state_id = v.state_id AND n.effective_from <= p_effective_at)
  ), current AS (
    SELECT c.state_id FROM gov_repo.l15_risk_assessment_valid_state_v1(p_organisation_id, p_governed_risk_state_id,
      p_assessment_basis, p_effective_at, p_recorded_cutoff) AS c
  )
  SELECT CASE
           WHEN EXISTS (SELECT 1 FROM current) THEN 'CURRENT'
           WHEN l.state_id IS NULL THEN 'NO_STATE'
           WHEN l.state_kind = 'REVOKED' THEN 'REVOKED'
           WHEN l.effective_from > p_effective_at THEN 'NOT_YET_EFFECTIVE'
           WHEN p_effective_at >= l.valid_until THEN 'EXPIRED'
           WHEN NOT gov_repo.l15_governed_risk_state_current_v1(p_organisation_id, p_governed_risk_state_id, p_effective_at,
                  p_recorded_cutoff) THEN 'GOVERNED_RISK_DEPENDENCY_INVALID'
           ELSE 'METHODOLOGY_DEPENDENCY_INVALID' END,
         COALESCE((SELECT c.state_id FROM current AS c), l.state_id),
         CASE WHEN EXISTS (SELECT 1 FROM current) THEN 'VALIDATED' ELSE l.state_kind END
  FROM (SELECT 1) AS one
  LEFT JOIN LATERAL (SELECT * FROM latest ORDER BY latest.effective_from DESC, latest.recorded_at DESC LIMIT 1) AS l ON true
$$;

-- F2. The ORIGINAL durable RISK_ASSESSMENT result, exactly as stored (replay never recomputes it). SUBMIT / DECIDE project
--     the exact pins + governed content their immutable typed proposal holds; VALIDATED / REVOKED project the state (incl.
--     its lineage predecessor, methodology registry pin, DB-derived band and validity interval).
CREATE FUNCTION gov_repo.l15_risk_assessment_command_result_v1(p_organisation_id uuid, p_command_id text, p_replay boolean)
RETURNS TABLE (
  replay boolean, command_id text, command_kind text, subject_kind text, outcome text, command_fingerprint text,
  authorization_decision_id uuid, authorization_result text, deny_reason text, expectation_kind text,
  expected_current_state_id uuid, proposal_id uuid, governance_decision_id uuid, governed_risk_state_id uuid,
  assessment_basis text, methodology_id uuid, methodology_version_id uuid, methodology_content_hash text,
  assessment_outcome text, likelihood_level_code text, impact_level_code text, rating_band text,
  requested_valid_until timestamptz, state_id uuid, state_kind text, predecessor_state_id uuid,
  methodology_validated_state_id uuid, effective_from timestamptz, valid_until timestamptz, recorded_at timestamptz
)
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT p_replay, c.command_id, c.command_kind, c.subject_kind, c.outcome, c.command_fingerprint,
         c.authorization_decision_id, a.result, a.deny_reason, a.expectation_kind, a.expected_current_state_id,
         c.proposal_id, c.governance_decision_id, t.governed_risk_state_id, t.assessment_basis, t.methodology_id,
         t.methodology_version_id, t.methodology_content_hash::text, t.assessment_outcome, t.likelihood_level_code,
         t.impact_level_code, s.rating_band, t.requested_valid_until, c.l15_state_id, s.state_kind, s.predecessor_state_id,
         s.methodology_validated_state_id, s.effective_from, s.valid_until, c.recorded_at
  FROM gov_repo.l14_command_results AS c
  LEFT JOIN gov_repo.l14_authorization_decisions AS a
    ON a.organisation_id = c.organisation_id AND a.authorization_decision_id = c.authorization_decision_id
  LEFT JOIN gov_repo.l15_risk_assessment_proposals AS t
    ON t.organisation_id = c.organisation_id AND t.proposal_id = c.proposal_id
  LEFT JOIN gov_repo.l15_risk_assessment_states AS s
    ON s.organisation_id = c.organisation_id AND s.state_id = c.l15_state_id
  WHERE c.organisation_id = p_organisation_id AND c.command_id = p_command_id AND c.subject_kind = 'RISK_ASSESSMENT'
    AND c.command_kind IN ('SUBMIT_PROPOSAL','DECIDE_PROPOSAL')
$$;

-- ---------------------------------------------------------------------------------------------------------------------
-- G. RPCs (SECURITY DEFINER; necessity: the L15 stores and the shared envelope have no application privilege at all, so a
--    bounded definer is the only write / read path). Owner postgres, search_path pinned, fully qualified, EXECUTE =
--    service_role only (never the machine intake capability); tenant + actor + CURRENT locked roles re-derived in-RPC from the
--    verified principal (l14_session_basis_v1); service_role is transport, never authority. Replay-first order:
--    base session -> syntactic shape -> syntactic support -> DB fingerprint -> AP guard SHARED -> (VALIDATE) scenario
--    dependency SHARED -> governed-risk dependency SHARED -> methodology dependency SHARED -> exact logical-key guard ->
--    command guard -> replay arbitration -> resolution -> CURRENT effective Authority Policy -> exact mapped L15 permission
--    over the SUBJECT OF THE PINNED GOVERNED_RISK STATE -> mutation -> final base-eligibility recheck. No SET CONSTRAINTS:
--    the S2R1 root ALLOW guard fires naturally at COMMIT.
-- ---------------------------------------------------------------------------------------------------------------------
-- G1. Proposal submission by a verified ACTIVE same-tenant human member (LOCAL_HUMAN). Grants no authority; writes no
--     authorization, decision, state or head. The caller supplies NO rating band, score, weight, percentage, domain, subject,
--     scenario, title, description or rationale (no such parameter exists).
CREATE FUNCTION gov_repo.l15_submit_risk_assessment_proposal_v1(
  p_verified_organisation_id uuid,
  p_verified_actor_user_id uuid,
  p_verified_session_iat bigint,
  p_verified_session_exp bigint,
  p_verified_credential_epoch timestamptz,
  p_command_id text,
  p_intent text,                            -- VALIDATE | REVOKE
  p_source_class text,                      -- LOCAL_HUMAN only (SYSTEM_SEED / SOURCE_CONNECTION: never for RISK_ASSESSMENT)
  p_governed_risk_state_id uuid,            -- the exact current VALIDATED GOVERNED_RISK state (dependency pin)
  p_assessment_basis text,                  -- INHERENT (RESIDUAL: S6)
  p_methodology_id uuid,                    -- the exact methodology identity ...
  p_methodology_version_id uuid,            -- ... the exact validated version ...
  p_methodology_content_hash text,          -- ... and its exact PostgreSQL content hash
  p_assessment_outcome text,                -- VALIDATE: RATED | INSUFFICIENT_EVIDENCE; REVOKE: NULL
  p_likelihood_level_code text,             -- RATED only: a level code of the pinned likelihood scale
  p_impact_level_code text,                 -- RATED only: a level code of the pinned impact scale
  p_requested_effective_from timestamptz,   -- NULL = IMMEDIATE intent
  p_requested_valid_until timestamptz,      -- VALIDATE: MANDATORY; REVOKE: NULL
  p_expected_current_state_id uuid,         -- NULL = explicit expected-none of the logical key
  p_target_state_id uuid,                   -- REVOKE only: the exact current VALIDATED assessment (= the expected current)
  p_prior_proposal_id uuid,                 -- correction link (same logical key)
  p_support_status text,
  p_support_tags text[],
  p_support_target_ids text[],
  p_caller_fingerprint text                 -- assertion only; PostgreSQL recomputes
)
RETURNS TABLE (
  replay boolean, command_id text, command_kind text, subject_kind text, outcome text, command_fingerprint text,
  authorization_decision_id uuid, authorization_result text, deny_reason text, expectation_kind text,
  expected_current_state_id uuid, proposal_id uuid, governance_decision_id uuid, governed_risk_state_id uuid,
  assessment_basis text, methodology_id uuid, methodology_version_id uuid, methodology_content_hash text,
  assessment_outcome text, likelihood_level_code text, impact_level_code text, rating_band text,
  requested_valid_until timestamptz, state_id uuid, state_kind text, predecessor_state_id uuid,
  methodology_validated_state_id uuid, effective_from timestamptz, valid_until timestamptz, recorded_at timestamptz
)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp SET lock_timeout = '5s'
AS $submit$
#variable_conflict use_column
DECLARE
  v_org uuid := p_verified_organisation_id;
  v_actor uuid := p_verified_actor_user_id;
  v_support text[];
  v_fingerprint text;
  v_risk record;
  v_maximum interval;
  v_target record;
  v_head uuid;
  v_from timestamptz;
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
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'SOURCE_CONNECTION_NOT_ADMISSIBLE';
  END IF;
  IF p_assessment_basis IS NULL OR p_assessment_basis NOT IN ('INHERENT','RESIDUAL') THEN
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'ASSESSMENT_BASIS_UNKNOWN';
  END IF;
  IF p_assessment_basis <> 'INHERENT' THEN
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'ASSESSMENT_BASIS_NOT_EXECUTABLE';
  END IF;
  IF p_governed_risk_state_id IS NULL THEN
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'GOVERNED_RISK_STATE_REQUIRED';
  END IF;
  IF p_methodology_id IS NULL OR p_methodology_version_id IS NULL THEN
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'METHODOLOGY_IDS_REQUIRED';
  END IF;
  IF p_methodology_content_hash IS NULL OR p_methodology_content_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'CONTENT_HASH_MALFORMED';
  END IF;
  IF p_assessment_outcome IS NOT NULL AND p_assessment_outcome NOT IN ('RATED','INSUFFICIENT_EVIDENCE') THEN
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'ASSESSMENT_OUTCOME_UNKNOWN';
  END IF;
  IF p_intent = 'VALIDATE' AND p_target_state_id IS NOT NULL THEN
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'TARGET_STATE_NOT_PERMITTED';
  END IF;
  IF p_intent = 'VALIDATE' AND p_assessment_outcome IS NULL THEN
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'ASSESSMENT_OUTCOME_REQUIRED';
  END IF;
  IF p_intent = 'VALIDATE' AND p_requested_valid_until IS NULL THEN
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'VALID_UNTIL_REQUIRED';
  END IF;
  IF p_intent = 'REVOKE' AND p_target_state_id IS NULL THEN
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'TARGET_STATE_REQUIRED';
  END IF;
  IF p_intent = 'REVOKE' AND (p_assessment_outcome IS NOT NULL OR p_likelihood_level_code IS NOT NULL
       OR p_impact_level_code IS NOT NULL OR p_requested_valid_until IS NOT NULL) THEN
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'ASSESSMENT_CONTENT_NOT_PERMITTED';
  END IF;
  IF p_intent = 'REVOKE' AND p_expected_current_state_id IS DISTINCT FROM p_target_state_id THEN
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'EXPECTATION_MALFORMED';
  END IF;
  -- RATED: both level codes REQUIRED; INSUFFICIENT_EVIDENCE: no level (no default, no implicit LOW).
  IF p_assessment_outcome = 'RATED' AND p_likelihood_level_code IS NULL THEN
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'LIKELIHOOD_LEVEL_REQUIRED';
  END IF;
  IF p_assessment_outcome = 'RATED' AND p_impact_level_code IS NULL THEN
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'IMPACT_LEVEL_REQUIRED';
  END IF;
  IF p_assessment_outcome = 'INSUFFICIENT_EVIDENCE' AND p_likelihood_level_code IS NOT NULL THEN
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'LIKELIHOOD_LEVEL_NOT_PERMITTED';
  END IF;
  IF p_assessment_outcome = 'INSUFFICIENT_EVIDENCE' AND p_impact_level_code IS NOT NULL THEN
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'IMPACT_LEVEL_NOT_PERMITTED';
  END IF;
  IF p_requested_valid_until IS NOT NULL AND p_requested_effective_from IS NOT NULL
     AND NOT (p_requested_valid_until > p_requested_effective_from) THEN
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'EFFECTIVE_INTERVAL_INVALID';
  END IF;

  -- 3-4. Syntactic support (the rank-3 admissibility of RISK_ASSESSMENT equals GOVERNED_RISK's: RISK_HYPOTHESIS, RISK_SIGNAL,
  --      every rank-0 tag), then the PostgreSQL-authoritative fingerprint over the exact key, pins, content and intent.
  v_support := gov_repo.l15_governed_risk_support_parts_v1(p_support_status, p_support_tags, p_support_target_ids);
  v_fingerprint := gov_repo.l14_sha256_frame_v1(
    ARRAY['L15_COMMAND_FINGERPRINT_V1', 'SUBMIT_PROPOSAL', v_org::text, v_actor::text, 'RISK_ASSESSMENT', p_intent,
          p_source_class, p_governed_risk_state_id::text, p_assessment_basis, p_methodology_id::text,
          p_methodology_version_id::text, p_methodology_content_hash]
    || CASE WHEN p_assessment_outcome IS NULL THEN ARRAY['NO_ASSESSMENT_OUTCOME'] ELSE ARRAY['ASSESSMENT_OUTCOME', p_assessment_outcome] END
    || CASE WHEN p_likelihood_level_code IS NULL THEN ARRAY['NO_LIKELIHOOD_LEVEL'] ELSE ARRAY['LIKELIHOOD_LEVEL', p_likelihood_level_code] END
    || CASE WHEN p_impact_level_code IS NULL THEN ARRAY['NO_IMPACT_LEVEL'] ELSE ARRAY['IMPACT_LEVEL', p_impact_level_code] END
    || CASE WHEN p_requested_effective_from IS NULL THEN ARRAY['IMMEDIATE']
            ELSE ARRAY['EXPLICIT', gov_repo.l14_canonical_instant_v1(p_requested_effective_from)] END
    || CASE WHEN p_requested_valid_until IS NULL THEN ARRAY['NO_VALID_UNTIL']
            ELSE ARRAY['VALID_UNTIL', gov_repo.l14_canonical_instant_v1(p_requested_valid_until)] END
    || CASE WHEN p_expected_current_state_id IS NULL THEN ARRAY['EXPECTED_NONE']
            ELSE ARRAY['EXPECTED_CURRENT', p_expected_current_state_id::text] END
    || CASE WHEN p_target_state_id IS NULL THEN ARRAY['NO_TARGET_STATE'] ELSE ARRAY['TARGET_STATE', p_target_state_id::text] END
    || CASE WHEN p_prior_proposal_id IS NULL THEN ARRAY['NO_PRIOR_PROPOSAL'] ELSE ARRAY['PRIOR_PROPOSAL', p_prior_proposal_id::text] END
    || v_support);
  IF v_fingerprint IS DISTINCT FROM p_caller_fingerprint THEN
    RAISE EXCEPTION 'L14_FINGERPRINT_MISMATCH' USING ERRCODE = 'GV008', DETAIL = 'CALLER_FINGERPRINT_DIFFERS';
  END IF;

  -- 5-7. Guards (AP shared, exact logical key, command), then replay arbitration BEFORE any resolution.
  PERFORM gov_repo.l14_lock_authority_policy_guard_shared_v1(v_org);
  PERFORM gov_repo.l15_lock_risk_assessment_key_guard_v1(v_org, p_governed_risk_state_id, p_assessment_basis);
  PERFORM gov_repo.l14_lock_command_guard_v1(v_org, p_command_id);
  IF gov_repo.l14_replay_arbitrate_v1(v_org, p_command_id, v_fingerprint) THEN
    PERFORM 1 FROM gov_repo.l14_session_basis_v1(v_org, v_actor, p_verified_session_iat,
      p_verified_session_exp, p_verified_credential_epoch);
    RETURN QUERY SELECT * FROM gov_repo.l15_risk_assessment_command_result_v1(v_org, p_command_id, true);
    RETURN;
  END IF;

  -- 8. Resolution: the exact GOVERNED_RISK state of THIS organisation (a foreign / unknown id is indistinguishable), its
  --    currency (VALIDATE), the exact admitted methodology tuple of THIS organisation and its validity (VALIDATE), level
  --    membership in the PINNED scales and the pinned cell (RATED), the validity maximum (explicit start), the expectation,
  --    the exact REVOKE target.
  SELECT s.state_kind, s.subject_key, s.scenario_definition_id, s.scenario_definition_version_id,
         s.scenario_content_hash, s.scenario_validated_state_id INTO v_risk
  FROM gov_repo.l15_governed_risk_states AS s WHERE s.organisation_id = v_org AND s.state_id = p_governed_risk_state_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'GOVERNED_RISK_STATE_UNRESOLVED';
  END IF;
  IF v_risk.state_kind <> 'VALIDATED' THEN
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'GOVERNED_RISK_STATE_NOT_VALIDATED';
  END IF;
  v_now := pg_catalog.clock_timestamp();
  v_from := COALESCE(p_requested_effective_from, v_now);
  IF p_intent = 'VALIDATE' AND NOT gov_repo.l15_governed_risk_state_current_v1(v_org, p_governed_risk_state_id, v_from, v_now) THEN
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'GOVERNED_RISK_STATE_NOT_CURRENT';
  END IF;
  SELECT v.assessment_validity_maximum INTO v_maximum
  FROM gov_repo.l15_risk_methodology_versions AS v
  WHERE v.organisation_id = v_org AND v.methodology_id = p_methodology_id
    AND v.methodology_version_id = p_methodology_version_id AND v.content_hash = p_methodology_content_hash;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'METHODOLOGY_VERSION_NOT_ADMITTED';
  END IF;
  IF p_intent = 'VALIDATE' AND NOT EXISTS (
       SELECT 1 FROM gov_repo.l15_risk_methodology_valid_state_v1(v_org, p_methodology_id, p_methodology_version_id,
         p_methodology_content_hash, v_from, v_now)) THEN
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'METHODOLOGY_VERSION_NOT_VALID';
  END IF;
  IF p_assessment_outcome = 'RATED' THEN
    PERFORM 1 FROM gov_repo.l15_risk_methodology_likelihood_levels AS l
    WHERE l.organisation_id = v_org AND l.methodology_version_id = p_methodology_version_id
      AND l.level_code = p_likelihood_level_code;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'LIKELIHOOD_LEVEL_NOT_IN_METHODOLOGY';
    END IF;
    PERFORM 1 FROM gov_repo.l15_risk_methodology_impact_levels AS l
    WHERE l.organisation_id = v_org AND l.methodology_version_id = p_methodology_version_id
      AND l.level_code = p_impact_level_code;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'IMPACT_LEVEL_NOT_IN_METHODOLOGY';
    END IF;
    PERFORM gov_repo.l15_risk_assessment_rating_band_v1(v_org, p_methodology_version_id, p_likelihood_level_code,
      p_impact_level_code);
  END IF;
  IF p_intent = 'VALIDATE' AND NOT (p_requested_valid_until > v_from) THEN
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'EFFECTIVE_INTERVAL_INVALID';
  END IF;
  IF p_intent = 'VALIDATE' AND p_requested_effective_from IS NOT NULL
     AND NOT (p_requested_valid_until <= gov_repo.l15_assessment_validity_limit_v1(p_requested_effective_from, v_maximum)) THEN
    -- An IMMEDIATE start is fixed only by the decision (which re-checks authoritatively); an explicit start is final here.
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'VALIDITY_EXCEEDS_METHODOLOGY_MAXIMUM';
  END IF;
  SELECT h.latest_state_id INTO v_head FROM gov_repo.l15_risk_assessment_heads AS h
  WHERE h.organisation_id = v_org AND h.governed_risk_state_id = p_governed_risk_state_id AND h.assessment_basis = p_assessment_basis;
  IF p_expected_current_state_id IS NULL AND v_head IS NOT NULL THEN
    RAISE EXCEPTION 'L15_STALE_EXPECTATION' USING ERRCODE = 'GV009', DETAIL = 'RISK_ASSESSMENT_STATE_EXISTS';
  END IF;
  IF p_expected_current_state_id IS DISTINCT FROM v_head THEN
    RAISE EXCEPTION 'L15_STALE_EXPECTATION' USING ERRCODE = 'GV009', DETAIL = 'RISK_ASSESSMENT_STATE_EXPECTATION_MISMATCH';
  END IF;
  IF p_intent = 'REVOKE' THEN
    SELECT s.state_kind, s.governed_risk_state_id, s.assessment_basis, s.methodology_id, s.methodology_version_id,
           s.methodology_content_hash INTO v_target
    FROM gov_repo.l15_risk_assessment_states AS s WHERE s.organisation_id = v_org AND s.state_id = p_target_state_id;
    IF NOT FOUND OR v_target.governed_risk_state_id <> p_governed_risk_state_id OR v_target.assessment_basis <> p_assessment_basis
       OR v_target.methodology_id <> p_methodology_id OR v_target.methodology_version_id <> p_methodology_version_id
       OR v_target.methodology_content_hash::text <> p_methodology_content_hash THEN
      RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'TARGET_STATE_UNRESOLVED';
    END IF;
    IF v_target.state_kind <> 'VALIDATED' THEN
      RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'TARGET_STATE_NOT_VALIDATED';
    END IF;
    PERFORM 1 FROM gov_repo.l15_risk_assessment_states AS s
    WHERE s.organisation_id = v_org AND s.state_kind = 'REVOKED' AND s.revokes_state_id = p_target_state_id;
    IF FOUND THEN
      RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'TARGET_ALREADY_REVOKED';
    END IF;
  END IF;
  IF p_prior_proposal_id IS NOT NULL THEN
    PERFORM 1 FROM gov_repo.l15_risk_assessment_proposals AS cp
    WHERE cp.organisation_id = v_org AND cp.proposal_id = p_prior_proposal_id
      AND cp.governed_risk_state_id = p_governed_risk_state_id AND cp.assessment_basis = p_assessment_basis;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'PRIOR_PROPOSAL_UNRESOLVED';
    END IF;
  END IF;
  PERFORM 1 FROM gov_repo.l15_normalize_support_v1(v_org, p_support_tags, p_support_target_ids);

  -- 9. Envelope + typed detail + support + durable result. Nothing else.
  INSERT INTO gov_repo.l14_proposals (organisation_id, proposal_id, subject_kind, intent, source_class,
    submitted_by_actor_user_id, prior_proposal_id, support_status, submitted_at)
  VALUES (v_org, v_proposal, 'RISK_ASSESSMENT', p_intent, p_source_class, v_actor, p_prior_proposal_id, p_support_status, v_now);
  INSERT INTO gov_repo.l15_risk_assessment_proposals (organisation_id, proposal_id, intent, assessment_basis,
    governed_risk_state_id, governed_risk_subject_key, governed_risk_scenario_definition_id,
    governed_risk_scenario_definition_version_id, governed_risk_scenario_content_hash, governed_risk_scenario_validated_state_id,
    methodology_id, methodology_version_id, methodology_content_hash, assessment_outcome, likelihood_level_code,
    impact_level_code, requested_effective_from, requested_valid_until, expected_current_state_id, target_state_id)
  VALUES (v_org, v_proposal, p_intent, p_assessment_basis, p_governed_risk_state_id, v_risk.subject_key,
    v_risk.scenario_definition_id, v_risk.scenario_definition_version_id, v_risk.scenario_content_hash,
    v_risk.scenario_validated_state_id, p_methodology_id, p_methodology_version_id, p_methodology_content_hash,
    p_assessment_outcome, p_likelihood_level_code, p_impact_level_code, p_requested_effective_from, p_requested_valid_until,
    p_expected_current_state_id, p_target_state_id);
  PERFORM gov_repo.l15_write_risk_assessment_support_links_v1(v_org, 'PROPOSAL', v_proposal, NULL, NULL,
    p_support_tags, p_support_target_ids);
  INSERT INTO gov_repo.l14_command_results (organisation_id, command_id, command_kind, subject_kind,
    command_fingerprint, actor_user_id, outcome, proposal_id, recorded_at)
  VALUES (v_org, p_command_id, 'SUBMIT_PROPOSAL', 'RISK_ASSESSMENT', v_fingerprint, v_actor, 'SUBMITTED', v_proposal, v_now);

  PERFORM 1 FROM gov_repo.l14_session_basis_v1(v_org, v_actor, p_verified_session_iat,
    p_verified_session_exp, p_verified_credential_epoch);
  RETURN QUERY SELECT * FROM gov_repo.l15_risk_assessment_command_result_v1(v_org, p_command_id, false);
END;
$submit$;

-- G2. Governance decision on a RISK_ASSESSMENT proposal. VALIDATE intent: VALIDATE / REJECT / DEFER. REVOKE intent: REVOKE /
--     REJECT / DEFER. DEFER is non-terminal. L15_RISK_ASSESSMENT_VALIDATE governs all four (requested action = the exact
--     outcome), evaluated over the exact typed SUBJECT OF THE PINNED GOVERNED_RISK STATE. The rating band is derived here from
--     the pinned cell (there is no band argument). REJECT / DEFER / DENY write no state and move no head.
CREATE FUNCTION gov_repo.l15_decide_risk_assessment_proposal_v1(
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
  authorization_decision_id uuid, authorization_result text, deny_reason text, expectation_kind text,
  expected_current_state_id uuid, proposal_id uuid, governance_decision_id uuid, governed_risk_state_id uuid,
  assessment_basis text, methodology_id uuid, methodology_version_id uuid, methodology_content_hash text,
  assessment_outcome text, likelihood_level_code text, impact_level_code text, rating_band text,
  requested_valid_until timestamptz, state_id uuid, state_kind text, predecessor_state_id uuid,
  methodology_validated_state_id uuid, effective_from timestamptz, valid_until timestamptz, recorded_at timestamptz
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
  v_risk record;
  v_head_found boolean;
  v_head_latest uuid;
  v_latest_kind text;
  v_latest_from timestamptz;
  v_latest_until timestamptz;
  v_latest_methodology_id uuid;
  v_latest_methodology_version uuid;
  v_latest_methodology_hash text;
  v_latest_methodology_state uuid;
  v_latest_outcome text;
  v_latest_likelihood text;
  v_latest_impact text;
  v_target_state_id uuid;
  v_methodology_state uuid;
  v_maximum interval;
  v_band text;
  v_has_basis boolean := false;
  v_basis_policy uuid;
  v_basis_version uuid;
  v_basis_hash text;
  v_deny text;
  v_ordinals integer[];
  v_self boolean;
  v_temporal text := 'IMMEDIATE';
  v_effective_from timestamptz;
  v_valid_until timestamptz;
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

  -- 2. Syntactic shape: the unchanged subject x outcome reason rule (no per-band / per-outcome code exists).
  PERFORM gov_repo.l14_validate_command_id_v1(p_command_id, p_caller_fingerprint);
  IF p_outcome IS NULL OR p_outcome NOT IN ('VALIDATE','REJECT','DEFER','REVOKE')
     OR p_reason_code IS NULL OR p_reason_code NOT IN (
       'RISK_ASSESSMENT_VALIDATED','RISK_ASSESSMENT_REJECTED','RISK_ASSESSMENT_DEFERRED','RISK_ASSESSMENT_REVOKED')
     OR NOT ((p_outcome = 'VALIDATE' AND p_reason_code = 'RISK_ASSESSMENT_VALIDATED')
          OR (p_outcome = 'REJECT' AND p_reason_code = 'RISK_ASSESSMENT_REJECTED')
          OR (p_outcome = 'DEFER' AND p_reason_code = 'RISK_ASSESSMENT_DEFERRED')
          OR (p_outcome = 'REVOKE' AND p_reason_code = 'RISK_ASSESSMENT_REVOKED')) THEN
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'DECISION_VOCABULARY_INVALID';
  END IF;
  -- The immutable proposal defines the command identity; it is the only row read before replay arbitration.
  SELECT p.proposal_id, p.intent, p.source_class, p.submitted_by_actor_user_id, t.assessment_basis, t.governed_risk_state_id,
         t.governed_risk_subject_key, t.governed_risk_scenario_definition_id, t.governed_risk_scenario_definition_version_id,
         t.governed_risk_scenario_content_hash::text AS governed_risk_scenario_content_hash, t.methodology_id,
         t.methodology_version_id, t.methodology_content_hash::text AS methodology_content_hash, t.assessment_outcome,
         t.likelihood_level_code, t.impact_level_code, t.requested_effective_from, t.requested_valid_until,
         t.expected_current_state_id, t.target_state_id
  INTO v_proposal
  FROM gov_repo.l14_proposals AS p
  JOIN gov_repo.l15_risk_assessment_proposals AS t ON t.organisation_id = p.organisation_id AND t.proposal_id = p.proposal_id
  WHERE p.organisation_id = v_org AND p.proposal_id = p_proposal_id AND p.subject_kind = 'RISK_ASSESSMENT';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'PROPOSAL_UNRESOLVED';
  END IF;
  IF (p_outcome = 'VALIDATE' AND v_proposal.intent <> 'VALIDATE') OR (p_outcome = 'REVOKE' AND v_proposal.intent <> 'REVOKE') THEN
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'OUTCOME_INTENT_INCOMPATIBLE';
  END IF;

  -- 3-4. Syntactic support, then the PostgreSQL-authoritative fingerprint.
  v_support := gov_repo.l15_governed_risk_support_parts_v1(p_support_status, p_support_tags, p_support_target_ids);
  v_fingerprint := gov_repo.l14_sha256_frame_v1(
    ARRAY['L15_COMMAND_FINGERPRINT_V1', 'DECIDE_PROPOSAL', v_org::text, v_actor::text, p_outcome, p_reason_code,
          v_proposal.proposal_id::text, 'RISK_ASSESSMENT', v_proposal.intent, v_proposal.source_class,
          v_proposal.governed_risk_state_id::text, v_proposal.assessment_basis, v_proposal.methodology_id::text,
          v_proposal.methodology_version_id::text, v_proposal.methodology_content_hash]
    || CASE WHEN v_proposal.assessment_outcome IS NULL THEN ARRAY['NO_ASSESSMENT_OUTCOME']
            ELSE ARRAY['ASSESSMENT_OUTCOME', v_proposal.assessment_outcome] END
    || CASE WHEN v_proposal.likelihood_level_code IS NULL THEN ARRAY['NO_LIKELIHOOD_LEVEL']
            ELSE ARRAY['LIKELIHOOD_LEVEL', v_proposal.likelihood_level_code] END
    || CASE WHEN v_proposal.impact_level_code IS NULL THEN ARRAY['NO_IMPACT_LEVEL']
            ELSE ARRAY['IMPACT_LEVEL', v_proposal.impact_level_code] END
    || CASE WHEN v_proposal.requested_effective_from IS NULL THEN ARRAY['IMMEDIATE']
            ELSE ARRAY['EXPLICIT', gov_repo.l14_canonical_instant_v1(v_proposal.requested_effective_from)] END
    || CASE WHEN v_proposal.requested_valid_until IS NULL THEN ARRAY['NO_VALID_UNTIL']
            ELSE ARRAY['VALID_UNTIL', gov_repo.l14_canonical_instant_v1(v_proposal.requested_valid_until)] END
    || CASE WHEN v_proposal.target_state_id IS NULL THEN ARRAY['NO_TARGET_STATE']
            ELSE ARRAY['TARGET_STATE', v_proposal.target_state_id::text] END
    || CASE WHEN p_expected_current_state_id IS NULL THEN ARRAY['EXPECTED_NONE']
            ELSE ARRAY['EXPECTED_CURRENT', p_expected_current_state_id::text] END
    || v_support);
  IF v_fingerprint IS DISTINCT FROM p_caller_fingerprint THEN
    RAISE EXCEPTION 'L14_FINGERPRINT_MISMATCH' USING ERRCODE = 'GV008', DETAIL = 'CALLER_FINGERPRINT_DIFFERS';
  END IF;

  -- 5-7. Guards in the fixed order: AP SHARED -> (VALIDATE only) the pinned risk's scenario dependency SHARED (S2 registry key)
  --      -> the pinned GOVERNED_RISK key SHARED (S3 key) -> the pinned methodology dependency SHARED (S2 registry key) -> exact
  --      assessment KEY -> command; then replay arbitration BEFORE any resolution. Every dependency guard is a SHARED mode of
  --      the exact key its own family's decisions take EXCLUSIVELY (no new lock namespace). REVOKE / REJECT / DEFER never wait
  --      on a dependency (explicit cleanup stays possible).
  PERFORM gov_repo.l14_lock_authority_policy_guard_shared_v1(v_org);
  IF p_outcome = 'VALIDATE' THEN
    PERFORM gov_repo.l15_lock_scenario_dependency_guard_shared_v1(v_org, v_proposal.governed_risk_scenario_definition_id,
      v_proposal.governed_risk_scenario_definition_version_id, v_proposal.governed_risk_scenario_content_hash);
    PERFORM gov_repo.l15_lock_governed_risk_dependency_guard_shared_v1(v_org, v_proposal.governed_risk_subject_key,
      v_proposal.governed_risk_scenario_definition_id);
    PERFORM gov_repo.l15_lock_methodology_dependency_guard_shared_v1(v_org, v_proposal.methodology_id,
      v_proposal.methodology_version_id, v_proposal.methodology_content_hash);
  END IF;
  PERFORM gov_repo.l15_lock_risk_assessment_key_guard_v1(v_org, v_proposal.governed_risk_state_id, v_proposal.assessment_basis);
  PERFORM gov_repo.l14_lock_command_guard_v1(v_org, p_command_id);
  IF gov_repo.l14_replay_arbitrate_v1(v_org, p_command_id, v_fingerprint) THEN
    PERFORM 1 FROM gov_repo.l14_session_basis_v1(v_org, v_actor, p_verified_session_iat,
      p_verified_session_exp, p_verified_credential_epoch);
    RETURN QUERY SELECT * FROM gov_repo.l15_risk_assessment_command_result_v1(v_org, p_command_id, true);
    RETURN;
  END IF;

  -- 8. Resolution under the guards: terminality, the pinned risk state's exact subject (the authority target), head
  --    expectation (= the proposal's own explicit expectation), latest lineage state, the exact REVOKE target, support.
  PERFORM 1 FROM gov_repo.l14_governance_decisions AS d
  WHERE d.organisation_id = v_org AND d.proposal_id = p_proposal_id AND d.outcome IN ('VALIDATE','REJECT','REVOKE');
  IF FOUND THEN
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'PROPOSAL_TERMINAL';
  END IF;
  SELECT s.subject_type, s.subject_canonical_kind, s.subject_canonical_object_id, s.subject_relationship_type,
         s.subject_relationship_id, s.subject_relationship_state_id INTO v_risk
  FROM gov_repo.l15_governed_risk_states AS s
  WHERE s.organisation_id = v_org AND s.state_id = v_proposal.governed_risk_state_id AND s.state_kind = 'VALIDATED';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'GOVERNED_RISK_STATE_UNRESOLVED';
  END IF;
  SELECT h.latest_state_id INTO v_head_latest FROM gov_repo.l15_risk_assessment_heads AS h
  WHERE h.organisation_id = v_org AND h.governed_risk_state_id = v_proposal.governed_risk_state_id
    AND h.assessment_basis = v_proposal.assessment_basis;
  v_head_found := FOUND;
  IF p_expected_current_state_id IS NULL AND v_head_latest IS NOT NULL THEN
    RAISE EXCEPTION 'L15_STALE_EXPECTATION' USING ERRCODE = 'GV009', DETAIL = 'RISK_ASSESSMENT_STATE_EXISTS';
  END IF;
  IF p_expected_current_state_id IS DISTINCT FROM v_head_latest
     OR p_expected_current_state_id IS DISTINCT FROM v_proposal.expected_current_state_id THEN
    RAISE EXCEPTION 'L15_STALE_EXPECTATION' USING ERRCODE = 'GV009', DETAIL = 'RISK_ASSESSMENT_STATE_EXPECTATION_MISMATCH';
  END IF;
  IF v_head_latest IS NOT NULL THEN
    SELECT s.state_kind, s.effective_from, s.valid_until, s.methodology_id, s.methodology_version_id,
           s.methodology_content_hash::text, s.methodology_validated_state_id, s.assessment_outcome, s.likelihood_level_code,
           s.impact_level_code
    INTO v_latest_kind, v_latest_from, v_latest_until, v_latest_methodology_id, v_latest_methodology_version,
         v_latest_methodology_hash, v_latest_methodology_state, v_latest_outcome, v_latest_likelihood, v_latest_impact
    FROM gov_repo.l15_risk_assessment_states AS s WHERE s.organisation_id = v_org AND s.state_id = v_head_latest;
  END IF;
  IF p_outcome = 'VALIDATE' AND v_latest_kind = 'VALIDATED'
     AND v_latest_methodology_id = v_proposal.methodology_id AND v_latest_methodology_version = v_proposal.methodology_version_id
     AND v_latest_methodology_hash = v_proposal.methodology_content_hash
     AND v_latest_outcome = v_proposal.assessment_outcome
     AND v_latest_likelihood IS NOT DISTINCT FROM v_proposal.likelihood_level_code
     AND v_latest_impact IS NOT DISTINCT FROM v_proposal.impact_level_code
     AND v_latest_until = v_proposal.requested_valid_until THEN
    -- A renewal / correction must change something: another methodology pin, outcome, level or valid_until.
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'RISK_ASSESSMENT_ALREADY_VALIDATED';
  END IF;
  IF p_outcome = 'REVOKE' THEN
    PERFORM 1 FROM gov_repo.l15_risk_assessment_states AS r
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
  --    ONLY basis, evaluated over the exact typed subject of the PINNED GOVERNED_RISK state. Never L14_*, another L15
  --    permission, service_role, machine capability, source class, band, level, domain, confidence, severity or count.
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
      v_valid_until := v_proposal.requested_valid_until;
    END IF;
  END IF;
  v_self := v_proposal.submitted_by_actor_user_id = v_actor;
  SELECT b.authority_policy_id, b.version_id, b.content_hash INTO v_basis_policy, v_basis_version, v_basis_hash
  FROM gov_repo.l14_effective_authority_basis_v1(v_org, v_now) AS b;
  v_has_basis := FOUND;
  IF NOT v_has_basis THEN
    v_deny := 'NO_EFFECTIVE_AUTHORITY';
  ELSIF v_risk.subject_type = 'CANONICAL_OBJECT' THEN
    SELECT e.deny_reason, e.rule_ordinals INTO v_deny, v_ordinals
    FROM gov_repo.l14_evaluate_target_authority_rules_v1(v_org, v_basis_policy, v_basis_version, v_role_ids,
      gov_repo.l15_governance_permission_v1('RISK_ASSESSMENT', p_outcome), p_outcome, p_outcome = 'VALIDATE' AND v_self, v_temporal,
      v_risk.subject_canonical_kind, v_risk.subject_canonical_object_id) AS e;
  ELSE
    SELECT e.deny_reason, e.rule_ordinals INTO v_deny, v_ordinals
    FROM gov_repo.l14_evaluate_relationship_state_authority_rules_v1(v_org, v_basis_policy, v_basis_version, v_role_ids,
      gov_repo.l15_governance_permission_v1('RISK_ASSESSMENT', p_outcome), p_outcome, p_outcome = 'VALIDATE' AND v_self, v_temporal,
      v_risk.subject_relationship_type, v_risk.subject_relationship_id, v_risk.subject_relationship_state_id) AS e;
  END IF;

  INSERT INTO gov_repo.l14_authorization_decisions (
    organisation_id, authorization_decision_id, command_id, command_fingerprint, actor_user_id,
    requested_action, subject_kind, scope_tag, target_canonical_kind, target_canonical_object_id,
    target_relationship_type, target_relationship_id, target_relationship_state_id, source_class,
    proposal_id, is_self_validation, authority_basis, basis_authority_policy_id, basis_version_id, basis_content_hash,
    result, deny_reason, evaluated_at, expectation_kind, expected_current_state_id)
  VALUES (
    v_org, v_authz, p_command_id, v_fingerprint, v_actor,
    p_outcome, 'RISK_ASSESSMENT', v_risk.subject_type, v_risk.subject_canonical_kind,
    v_risk.subject_canonical_object_id, v_risk.subject_relationship_type, v_risk.subject_relationship_id,
    v_risk.subject_relationship_state_id, v_proposal.source_class, p_proposal_id, v_self,
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
    VALUES (v_org, p_command_id, 'DECIDE_PROPOSAL', 'RISK_ASSESSMENT', v_fingerprint, v_actor, 'DENIED', v_authz, p_proposal_id, v_now);
  ELSE
    -- 10. Interval and dependency rules (authorized commands only; a violation raises and rolls back the WHOLE command:
    --     nothing is consumed).
    IF p_outcome = 'VALIDATE' AND NOT (v_valid_until > v_effective_from) THEN
      -- valid_until is mandatory and strictly later than the effective start (incl. an IMMEDIATE start).
      RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'EFFECTIVE_INTERVAL_INVALID';
    END IF;
    IF p_outcome = 'REVOKE' AND v_effective_from < v_latest_from THEN
      RAISE EXCEPTION 'L15_CONTINUITY_VIOLATION' USING ERRCODE = 'GV011', DETAIL = 'REVOKE_BEFORE_TARGET_EFFECTIVE';
    END IF;
    IF p_outcome = 'REVOKE' AND v_effective_from >= v_latest_until THEN
      RAISE EXCEPTION 'L15_CONTINUITY_VIOLATION' USING ERRCODE = 'GV011', DETAIL = 'REVOKE_AFTER_TARGET_EXPIRY';
    END IF;
    IF p_outcome = 'VALIDATE' AND v_latest_kind = 'REVOKED' AND NOT (v_effective_from >= v_latest_from) THEN
      RAISE EXCEPTION 'L15_CONTINUITY_VIOLATION' USING ERRCODE = 'GV011', DETAIL = 'REVALIDATION_OVERLAPS_PRIOR_INTERVAL';
    END IF;
    -- Renewal / correction (another pin / outcome / level / valid_until): never before the predecessor's start; it may begin
    -- before the predecessor's valid_until (the predecessor's closure is derived from it).
    IF p_outcome = 'VALIDATE' AND v_latest_kind = 'VALIDATED' AND v_effective_from < v_latest_from THEN
      RAISE EXCEPTION 'L15_CONTINUITY_VIOLATION' USING ERRCODE = 'GV011', DETAIL = 'SUCCESSOR_BEFORE_PREDECESSOR_EFFECTIVE';
    END IF;
    IF p_outcome = 'VALIDATE' THEN
      -- The exact pinned GOVERNED_RISK state must be THE current risk state of its own key at the effective instant as known
      -- now, under the shared dependency guards (a revoked / superseded / expired / subject- or scenario-invalid risk state
      -- never validates an assessment; no successor risk state is ever selected instead).
      IF NOT gov_repo.l15_governed_risk_state_current_v1(v_org, v_proposal.governed_risk_state_id, v_effective_from, v_now) THEN
        RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'GOVERNED_RISK_DEPENDENCY_NOT_VALID';
      END IF;
      -- The exact pinned methodology version must be THE VALIDATED, non-revoked, effective methodology state of that exact
      -- tuple at the effective instant as known now (never latest, never a successor version, never a default).
      SELECT mv.state_id INTO v_methodology_state
      FROM gov_repo.l15_risk_methodology_valid_state_v1(v_org, v_proposal.methodology_id, v_proposal.methodology_version_id,
        v_proposal.methodology_content_hash, v_effective_from, v_now) AS mv;
      IF v_methodology_state IS NULL THEN
        RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'METHODOLOGY_DEPENDENCY_NOT_VALID';
      END IF;
      SELECT v.assessment_validity_maximum INTO v_maximum
      FROM gov_repo.l15_risk_methodology_versions AS v
      WHERE v.organisation_id = v_org AND v.methodology_id = v_proposal.methodology_id
        AND v.methodology_version_id = v_proposal.methodology_version_id
        AND v.content_hash = v_proposal.methodology_content_hash;
      IF NOT (v_valid_until <= gov_repo.l15_assessment_validity_limit_v1(v_effective_from, v_maximum)) THEN
        RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'VALIDITY_EXCEEDS_METHODOLOGY_MAXIMUM';
      END IF;
      IF v_proposal.assessment_outcome = 'RATED' THEN
        v_band := gov_repo.l15_risk_assessment_rating_band_v1(v_org, v_proposal.methodology_version_id,
          v_proposal.likelihood_level_code, v_proposal.impact_level_code);
      END IF;
    ELSIF p_outcome = 'REVOKE' THEN
      v_methodology_state := v_latest_methodology_state;
    END IF;

    INSERT INTO gov_repo.l14_governance_decisions (organisation_id, governance_decision_id, proposal_id,
      subject_kind, outcome, reason_code, authorization_decision_id, actor_user_id, support_status, decided_at)
    VALUES (v_org, v_decision, p_proposal_id, 'RISK_ASSESSMENT', p_outcome, p_reason_code, v_authz, v_actor, p_support_status, v_now);
    PERFORM gov_repo.l15_write_risk_assessment_support_links_v1(v_org, 'DECISION', NULL, v_decision, NULL,
      p_support_tags, p_support_target_ids);
    IF p_outcome IN ('VALIDATE','REVOKE') THEN
      v_state_kind := CASE WHEN p_outcome = 'VALIDATE' THEN 'VALIDATED' ELSE 'REVOKED' END;
      -- Append-only: predecessor = the expected head state; the predecessor row is never modified (its closure is derived).
      INSERT INTO gov_repo.l15_risk_assessment_states (organisation_id, state_id, state_kind, assessment_basis,
        governed_risk_state_id, governed_risk_subject_key, governed_risk_scenario_definition_id,
        governed_risk_scenario_definition_version_id, governed_risk_scenario_content_hash,
        governed_risk_scenario_validated_state_id, methodology_id, methodology_version_id, methodology_content_hash,
        methodology_validated_state_id, assessment_outcome, likelihood_level_code, impact_level_code, rating_band,
        predecessor_state_id, revokes_state_id, effective_from, valid_until, recorded_at, proposal_id, governance_decision_id,
        authorization_decision_id, authority_policy_id, authority_policy_version_id, authority_policy_content_hash,
        source_class, support_status)
      SELECT v_org, v_state, v_state_kind, t.assessment_basis, t.governed_risk_state_id, t.governed_risk_subject_key,
        t.governed_risk_scenario_definition_id, t.governed_risk_scenario_definition_version_id,
        t.governed_risk_scenario_content_hash, t.governed_risk_scenario_validated_state_id, t.methodology_id,
        t.methodology_version_id, t.methodology_content_hash, v_methodology_state, t.assessment_outcome,
        t.likelihood_level_code, t.impact_level_code, v_band, v_head_latest, v_target_state_id, v_effective_from,
        v_valid_until, v_now, p_proposal_id, v_decision, v_authz, v_basis_policy, v_basis_version, v_basis_hash,
        v_proposal.source_class, p_support_status
      FROM gov_repo.l15_risk_assessment_proposals AS t
      WHERE t.organisation_id = v_org AND t.proposal_id = p_proposal_id;
      IF NOT v_head_found THEN
        INSERT INTO gov_repo.l15_risk_assessment_heads (organisation_id, governed_risk_state_id, assessment_basis, latest_state_id)
        VALUES (v_org, v_proposal.governed_risk_state_id, v_proposal.assessment_basis, NULL);
      END IF;
      UPDATE gov_repo.l15_risk_assessment_heads AS h SET latest_state_id = v_state
      WHERE h.organisation_id = v_org AND h.governed_risk_state_id = v_proposal.governed_risk_state_id
        AND h.assessment_basis = v_proposal.assessment_basis
        AND h.latest_state_id IS NOT DISTINCT FROM p_expected_current_state_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'L15_STALE_EXPECTATION' USING ERRCODE = 'GV009', DETAIL = 'RISK_ASSESSMENT_STATE_EXPECTATION_MISMATCH';
      END IF;
      PERFORM gov_repo.l15_write_risk_assessment_support_links_v1(v_org, 'STATE', NULL, NULL, v_state,
        p_support_tags, p_support_target_ids);
      INSERT INTO gov_repo.l14_command_results (organisation_id, command_id, command_kind, subject_kind,
        command_fingerprint, actor_user_id, outcome, authorization_decision_id, proposal_id, governance_decision_id,
        l15_state_id, recorded_at)
      VALUES (v_org, p_command_id, 'DECIDE_PROPOSAL', 'RISK_ASSESSMENT', v_fingerprint, v_actor, v_state_kind,
        v_authz, p_proposal_id, v_decision, v_state, v_now);
    ELSE
      -- REJECT / DEFER: governance decision only; no state, no head change.
      INSERT INTO gov_repo.l14_command_results (organisation_id, command_id, command_kind, subject_kind,
        command_fingerprint, actor_user_id, outcome, authorization_decision_id, proposal_id, governance_decision_id, recorded_at)
      VALUES (v_org, p_command_id, 'DECIDE_PROPOSAL', 'RISK_ASSESSMENT', v_fingerprint, v_actor,
        CASE WHEN p_outcome = 'REJECT' THEN 'REJECTED' ELSE 'DEFERRED' END, v_authz, p_proposal_id, v_decision, v_now);
    END IF;
  END IF;

  -- 11. Base session eligibility at commitment (same-transaction final recheck).
  PERFORM 1 FROM gov_repo.l14_session_basis_v1(v_org, v_actor, p_verified_session_iat,
    p_verified_session_exp, p_verified_credential_epoch);
  RETURN QUERY SELECT * FROM gov_repo.l15_risk_assessment_command_result_v1(v_org, p_command_id, false);
END;
$decide$;

-- G3. Read projection (verified ACTIVE same-tenant member; read-only; persists nothing; no cache, no latest-methodology
--     fallback, no score synthesis): the exact assessment key (exact GOVERNED_RISK state of THIS organisation + basis) at
--     (effective_at, recorded_cutoff) (NULL = the DB instant). Closed read status: UNKNOWN when no current valid assessment
--     exists (with the closed reason) — then EVERY assessment field is NULL (no LOW, no 0, no default level / band);
--     RATED (+ exact levels + DB-derived band) or INSUFFICIENT_EVIDENCE for the exact current state with its full lineage.
--     UNKNOWN is a read result only, never a stored outcome.
CREATE FUNCTION gov_repo.l15_read_risk_assessment_v1(
  p_verified_organisation_id uuid,
  p_verified_actor_user_id uuid,
  p_verified_session_iat bigint,
  p_verified_session_exp bigint,
  p_verified_credential_epoch timestamptz,
  p_governed_risk_state_id uuid,
  p_assessment_basis text,                  -- INHERENT (RESIDUAL: S6)
  p_effective_at timestamptz,               -- NULL = the DB instant
  p_recorded_cutoff timestamptz             -- NULL = the DB instant
)
RETURNS TABLE (
  assessment_status text, resolution text, effective_at timestamptz, recorded_cutoff timestamptz,
  governed_risk_state_id uuid, assessment_basis text, state_id uuid, assessment_outcome text, likelihood_level_code text,
  impact_level_code text, rating_band text, methodology_id uuid, methodology_version_id uuid, methodology_content_hash text,
  methodology_validated_state_id uuid, effective_from timestamptz, valid_until timestamptz, recorded_at timestamptz,
  predecessor_state_id uuid, proposal_id uuid, governance_decision_id uuid, authorization_decision_id uuid,
  authority_policy_id uuid, authority_policy_version_id uuid, authority_policy_content_hash text, source_class text,
  support_status text
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
  IF p_assessment_basis IS NULL OR p_assessment_basis NOT IN ('INHERENT','RESIDUAL') THEN
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'ASSESSMENT_BASIS_UNKNOWN';
  END IF;
  IF p_assessment_basis <> 'INHERENT' THEN
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'ASSESSMENT_BASIS_NOT_EXECUTABLE';
  END IF;
  PERFORM 1 FROM gov_repo.l15_governed_risk_states AS g
  WHERE g.organisation_id = v_org AND g.state_id = p_governed_risk_state_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'L15_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'GOVERNED_RISK_STATE_UNRESOLVED';
  END IF;
  v_at := COALESCE(p_effective_at, pg_catalog.clock_timestamp());
  v_cutoff := COALESCE(p_recorded_cutoff, pg_catalog.clock_timestamp());
  RETURN QUERY
  SELECT CASE WHEN r.resolution = 'CURRENT' THEN s.assessment_outcome ELSE 'UNKNOWN' END,
         r.resolution, v_at, v_cutoff, p_governed_risk_state_id, p_assessment_basis,
         s.state_id, s.assessment_outcome, s.likelihood_level_code, s.impact_level_code, s.rating_band, s.methodology_id,
         s.methodology_version_id, s.methodology_content_hash::text, s.methodology_validated_state_id, s.effective_from,
         s.valid_until, s.recorded_at, s.predecessor_state_id, s.proposal_id, s.governance_decision_id,
         s.authorization_decision_id, s.authority_policy_id, s.authority_policy_version_id, s.authority_policy_content_hash,
         s.source_class, s.support_status
  FROM gov_repo.l15_risk_assessment_resolution_v1(v_org, p_governed_risk_state_id, p_assessment_basis, v_at, v_cutoff) AS r
  LEFT JOIN gov_repo.l15_risk_assessment_states AS s
    ON r.resolution = 'CURRENT' AND s.organisation_id = v_org AND s.state_id = r.state_id;
  PERFORM 1 FROM gov_repo.l14_session_basis_v1(v_org, p_verified_actor_user_id, p_verified_session_iat,
    p_verified_session_exp, p_verified_credential_epoch);
END;
$read$;

-- ---------------------------------------------------------------------------------------------------------------------
-- H. Immutability, RLS, privileges, comments. Every history table: ENABLE ALWAYS raising UPDATE / DELETE / TRUNCATE (owner
--    included); FK actions RESTRICT only (no cascade reaches L15 history). The hostile 20260818013113 defaults are revoked;
--    PostgreSQL's PUBLIC EXECUTE on new functions is revoked. Exactly the three RISK_ASSESSMENT RPCs are service_role-
--    executable; nothing is granted to the machine intake capability.
-- ---------------------------------------------------------------------------------------------------------------------
DO $immutable$
DECLARE
  v_table text;
  v_rec record;
BEGIN
  FOREACH v_table IN ARRAY ARRAY['l15_risk_assessment_proposals','l15_risk_assessment_states'] LOOP
    EXECUTE pg_catalog.format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON gov_repo.%I FOR EACH ROW EXECUTE FUNCTION gov_repo.l15_history_immutable_v1()',
      v_table || '_immutable', v_table);
    EXECUTE pg_catalog.format('CREATE TRIGGER %I BEFORE TRUNCATE ON gov_repo.%I FOR EACH STATEMENT EXECUTE FUNCTION gov_repo.l15_history_immutable_v1()',
      v_table || '_no_truncate', v_table);
  END LOOP;
  FOREACH v_table IN ARRAY ARRAY['l15_risk_assessment_proposals','l15_risk_assessment_states','l15_risk_assessment_heads'] LOOP
    EXECUTE pg_catalog.format('ALTER TABLE gov_repo.%I ENABLE ROW LEVEL SECURITY', v_table);
    EXECUTE pg_catalog.format('REVOKE ALL ON TABLE gov_repo.%I FROM PUBLIC, anon, authenticated, service_role, govia_l15_machine_intake_caller', v_table);
  END LOOP;
  FOR v_rec IN SELECT t.tgrelid::regclass::text AS rel, t.tgname::text AS tg FROM pg_catalog.pg_trigger AS t
      WHERE NOT t.tgisinternal AND t.tgrelid IN ('gov_repo.l15_risk_assessment_proposals'::regclass,
        'gov_repo.l15_risk_assessment_states'::regclass, 'gov_repo.l15_risk_assessment_heads'::regclass) LOOP
    EXECUTE pg_catalog.format('ALTER TABLE %s ENABLE ALWAYS TRIGGER %I', v_rec.rel, v_rec.tg);
  END LOOP;
END;
$immutable$;

-- The four new SECURITY DEFINER routines are owned by postgres explicitly (the P8 inventory asserts owner + body hash).
ALTER FUNCTION gov_repo.l15_risk_assessment_commit_guard_v1() OWNER TO postgres;
ALTER FUNCTION gov_repo.l15_submit_risk_assessment_proposal_v1(uuid,uuid,bigint,bigint,timestamp with time zone,text,text,text,uuid,text,uuid,uuid,text,text,text,text,timestamp with time zone,timestamp with time zone,uuid,uuid,uuid,text,text[],text[],text) OWNER TO postgres;
ALTER FUNCTION gov_repo.l15_decide_risk_assessment_proposal_v1(uuid,uuid,bigint,bigint,timestamp with time zone,text,uuid,text,text,uuid,text,text[],text[],text) OWNER TO postgres;
ALTER FUNCTION gov_repo.l15_read_risk_assessment_v1(uuid,uuid,bigint,bigint,timestamp with time zone,uuid,text,timestamp with time zone,timestamp with time zone) OWNER TO postgres;

-- Every routine created or replaced here: no PUBLIC / application / capability EXECUTE, then exactly the three RPCs to
-- service_role. Routines of earlier slices keep their ACL (asserted in the postflight).
DO $acl$
DECLARE
  v_fn regprocedure;
BEGIN
  FOR v_fn IN SELECT p.oid::regprocedure FROM pg_catalog.pg_proc AS p
      WHERE p.pronamespace = 'gov_repo'::regnamespace
        AND p.proname IN ('l15_lock_risk_assessment_key_guard_v1','l15_lock_governed_risk_dependency_guard_shared_v1',
          'l15_lock_methodology_dependency_guard_shared_v1','l15_assessment_validity_limit_v1','l15_risk_assessment_rating_band_v1',
          'l15_support_link_insert_guard_v1','l15_write_risk_assessment_support_links_v1','l15_command_result_state_guard_v1',
          'l15_risk_assessment_proposal_guard_v1','l15_risk_assessment_state_guard_v1','l15_risk_assessment_commit_guard_v1',
          'l15_risk_assessment_head_guard_v1','l15_risk_assessment_valid_state_v1','l15_risk_assessment_state_current_v1',
          'l15_risk_assessment_resolution_v1','l15_risk_assessment_command_result_v1','l15_submit_risk_assessment_proposal_v1',
          'l15_decide_risk_assessment_proposal_v1','l15_read_risk_assessment_v1') LOOP
    EXECUTE pg_catalog.format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated, service_role, govia_l15_machine_intake_caller', v_fn);
  END LOOP;
END;
$acl$;
GRANT EXECUTE ON FUNCTION
  gov_repo.l15_submit_risk_assessment_proposal_v1(uuid,uuid,bigint,bigint,timestamp with time zone,text,text,text,uuid,text,uuid,uuid,text,text,text,text,timestamp with time zone,timestamp with time zone,uuid,uuid,uuid,text,text[],text[],text),
  gov_repo.l15_decide_risk_assessment_proposal_v1(uuid,uuid,bigint,bigint,timestamp with time zone,text,uuid,text,text,uuid,text,text[],text[],text),
  gov_repo.l15_read_risk_assessment_v1(uuid,uuid,bigint,bigint,timestamp with time zone,uuid,text,timestamp with time zone,timestamp with time zone)
TO service_role;

COMMENT ON TABLE gov_repo.l15_risk_assessment_proposals IS 'M17-S4 immutable typed RISK_ASSESSMENT proposal over l14_proposals: exact GOVERNED_RISK state pin (S3 dependency key; FK material only), basis (INHERENT executable), exact methodology version tuple, governed content (RATED + the two level codes of the pinned scales, or INSUFFICIENT_EVIDENCE with none), temporal intent with mandatory valid_until, explicit expected-current / expected-none, exact REVOKE target. LOCAL_HUMAN only. No band, score, rationale or free text.';
COMMENT ON TABLE gov_repo.l15_risk_assessment_states IS 'M17-S4 immutable RISK_ASSESSMENT state (L15 authoritative fact; NOT a score): logical key organisation + governed_risk_state_id + assessment_basis; pins the exact GOVERNED_RISK state and the exact VALIDATED methodology state + version + hash; rating_band DB-derived from the pinned rating cell; mandatory [effective_from, valid_until). VALIDATED / REVOKED only; append-only. S6 pin (organisation, state_id, governed_risk_state_id, assessment_basis, methodology_id, methodology_version_id, methodology_content_hash, methodology_validated_state_id, VALIDATED).';
COMMENT ON TABLE gov_repo.l15_risk_assessment_heads IS 'M17-S4 technical compare-and-set pointer per RISK_ASSESSMENT logical key; RPC-maintained, reconstructible from history, never authority.';
COMMENT ON COLUMN gov_repo.l15_risk_assessment_states.rating_band IS 'M17-S4 DB-derived band of EXACTLY the pinned methodology rating cell (lookup; never caller-supplied, never arithmetic). NULL unless RATED.';
COMMENT ON COLUMN gov_repo.l15_risk_assessment_states.valid_until IS 'M17-S4 mandatory effective end of a VALIDATED assessment: [effective_from, valid_until), <= effective_from + the pinned assessment_validity_maximum (UTC calendar). Expiry writes nothing.';
COMMENT ON FUNCTION gov_repo.l15_risk_assessment_valid_state_v1(uuid, uuid, text, timestamptz, timestamptz) IS 'M17-S4 owner-only exact bitemporal RISK_ASSESSMENT resolver (the S6 pin): exact logical key, both coordinates, own interval / lineage, the pinned GOVERNED_RISK state current, the pinned methodology state valid; no row = UNKNOWN; never transferred, never repinned.';
COMMENT ON FUNCTION gov_repo.l15_risk_assessment_commit_guard_v1() IS 'M17-S4 owner-only deferred RISK_ASSESSMENT support-integrity trigger (SECURITY DEFINER: fires at COMMIT as the committing role, which holds no L15 privilege). Reads only; writes nothing.';

-- ---------------------------------------------------------------------------------------------------------------------
-- I. Postflight over the EFFECTIVE post-S4 catalog (after ALL grants, including the broad legacy defaults).
-- ---------------------------------------------------------------------------------------------------------------------
DO $postflight$
DECLARE
  v_rel text;
  v_count bigint;
  v_hash text;
  v_new_tables CONSTANT text[] := ARRAY['l15_risk_assessment_proposals','l15_risk_assessment_states','l15_risk_assessment_heads'];
  v_allowed_changed CONSTANT text[] := ARRAY['gov_repo.l14_command_results|l14_command_results_shape_check',
    'gov_repo.l14_command_results|l14_command_results_l15_state_check',
    'gov_repo.l15_support_links|l15_support_links_owner_kind_check', 'gov_repo.l15_support_links|l15_support_links_owner_shape_check',
    'gov_repo.l15_support_links|l15_support_links_owner_target_matrix_check'];
BEGIN
  -- P1. Pre-existing constraints / triggers unchanged except the enumerated additive widenings; new constraints only on the
  --     new L15 tables and the S4 support-link owner columns.
  IF EXISTS (SELECT 1 FROM m17_s4_constraint_snapshot AS b
             LEFT JOIN (SELECT k.conrelid::regclass::text AS rel, k.conname::text AS conname, pg_catalog.pg_get_constraintdef(k.oid) AS def
                        FROM pg_catalog.pg_constraint AS k JOIN pg_catalog.pg_class AS c ON c.oid = k.conrelid
                        WHERE c.relnamespace = 'gov_repo'::regnamespace) AS a ON a.rel = b.rel AND a.conname = b.conname
             WHERE a.def IS DISTINCT FROM b.def AND (b.rel || '|' || b.conname) <> ALL (v_allowed_changed))
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_constraint AS k JOIN pg_catalog.pg_class AS c ON c.oid = k.conrelid
                WHERE c.relnamespace = 'gov_repo'::regnamespace
                  AND NOT EXISTS (SELECT 1 FROM m17_s4_constraint_snapshot AS b WHERE b.rel = k.conrelid::regclass::text AND b.conname = k.conname::text)
                  AND NOT (c.relname::text = ANY (v_new_tables))
                  AND NOT (c.relname = 'l15_support_links' AND k.conname IN ('l15_support_links_owner_risk_assessment_artifact_check',
                    'l15_support_links_owner_risk_assessment_proposal_fkey','l15_support_links_owner_risk_assessment_state_fkey')))
     OR EXISTS (SELECT 1 FROM m17_s4_trigger_snapshot AS b
                LEFT JOIN (SELECT t.tgrelid::regclass::text AS rel, t.tgname::text AS tgname, t.tgenabled::text AS enabled,
                                  t.tgfoid::regprocedure::text AS fn
                           FROM pg_catalog.pg_trigger AS t JOIN pg_catalog.pg_class AS c ON c.oid = t.tgrelid
                           WHERE c.relnamespace = 'gov_repo'::regnamespace AND NOT t.tgisinternal) AS a
                  ON a.rel = b.rel AND a.tgname = b.tgname
                WHERE a.enabled IS DISTINCT FROM b.enabled OR a.fn IS DISTINCT FROM b.fn)
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_trigger AS t JOIN pg_catalog.pg_class AS c ON c.oid = t.tgrelid
                WHERE c.relnamespace = 'gov_repo'::regnamespace AND NOT t.tgisinternal
                  AND NOT EXISTS (SELECT 1 FROM m17_s4_trigger_snapshot AS b WHERE b.rel = t.tgrelid::regclass::text AND b.tgname = t.tgname::text)
                  AND NOT (c.relname::text = ANY (v_new_tables)))
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_trigger AS t WHERE t.tgrelid = ANY (ARRAY['gov_repo.l15_risk_assessment_proposals'::regclass,
                  'gov_repo.l15_risk_assessment_states'::regclass, 'gov_repo.l15_risk_assessment_heads'::regclass])
                  AND NOT t.tgisinternal AND t.tgenabled <> 'A') THEN
    RAISE EXCEPTION 'M17_S4_POSTFLIGHT: a constraint / trigger outside the enumerated S4 surfaces changed or was added';
  END IF;
  -- P2. Every pre-existing routine is unchanged (body, definer, config, ACL) except the two owner-only invoker guards S4
  --     replaces (S1 / S2 / S3 branches restated verbatim); no pre-existing relation's ACL changed.
  IF EXISTS (SELECT 1 FROM m17_s4_routine_snapshot AS b
             LEFT JOIN pg_catalog.pg_proc AS p ON p.oid = pg_catalog.to_regprocedure(b.sig)
             WHERE (p.oid IS NULL OR pg_catalog.md5(p.prosrc) IS DISTINCT FROM b.body OR p.prosecdef IS DISTINCT FROM b.definer
                    OR COALESCE(pg_catalog.array_to_string(p.proconfig, ';'), '-') IS DISTINCT FROM b.cfg
                    OR COALESCE(p.proacl::text, '-') IS DISTINCT FROM b.acl)
               AND b.sig NOT IN ('gov_repo.l15_support_link_insert_guard_v1()', 'gov_repo.l15_command_result_state_guard_v1()'))
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_proc AS p
                WHERE p.oid IN ('gov_repo.l15_support_link_insert_guard_v1()'::regprocedure, 'gov_repo.l15_command_result_state_guard_v1()'::regprocedure)
                  AND (p.prosecdef OR pg_catalog.has_function_privilege('service_role', p.oid, 'EXECUTE')))
     OR EXISTS (SELECT 1 FROM m17_s4_relation_acl_snapshot AS b
                JOIN pg_catalog.pg_class AS c ON c.relnamespace = 'gov_repo'::regnamespace AND c.relname::text = b.relname
                WHERE COALESCE(c.relacl::text, '-') IS DISTINCT FROM b.acl) THEN
    RAISE EXCEPTION 'M17_S4_POSTFLIGHT: a pre-existing routine / relation ACL changed outside the two enumerated guard replacements';
  END IF;
  -- P3. Every pre-existing L14 / L15 / canonical row is byte-identical (M16 history, shared envelope, S1 / S2 / S3 stores, F2).
  FOR v_rel IN SELECT c.relation FROM m17_s4_row_capture AS c LOOP
    IF v_rel = 'l15_support_links' THEN
      SELECT pg_catalog.count(*), COALESCE(pg_catalog.md5(pg_catalog.string_agg(t::text, E'\n' ORDER BY t::text COLLATE "C")), 'EMPTY')
      INTO v_count, v_hash
      FROM (SELECT x.organisation_id, x.link_id, x.owner_kind, x.owner_signal_id, x.owner_signal_kind, x.owner_hypothesis_id,
                   x.target_tag, x.target_discovery_evidence_id, x.target_source_assertion_id, x.target_runtime_observation_id,
                   x.target_cross_signal_comparison_id, x.target_execution_field_state_id, x.target_technical_field_state_id,
                   x.target_lineage_observation_finding_id, x.target_l14_fact_state_id, x.target_l14_fact_subject_kind,
                   x.target_risk_signal_id, x.target_risk_hypothesis_id, x.recorded_at, x.owner_registry_artifact,
                   x.owner_scenario_proposal_id, x.owner_methodology_proposal_id, x.owner_governance_decision_id,
                   x.owner_scenario_state_id, x.owner_methodology_state_id, x.owner_governed_risk_artifact,
                   x.owner_governed_risk_proposal_id, x.owner_governed_risk_state_id
            FROM gov_repo.l15_support_links AS x) AS t;
    ELSE
      EXECUTE pg_catalog.format(
        'SELECT pg_catalog.count(*), COALESCE(pg_catalog.md5(pg_catalog.string_agg(t::text, %L ORDER BY t::text COLLATE "C")), %L) FROM gov_repo.%I AS t',
        E'\n', 'EMPTY', v_rel) INTO v_count, v_hash;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM m17_s4_row_capture AS c WHERE c.relation = v_rel AND c.row_count = v_count AND c.row_hash = v_hash) THEN
      RAISE EXCEPTION 'M17_S4_POSTFLIGHT: rows of % changed', v_rel;
    END IF;
  END LOOP;
  -- P4. Frozen vocabularies: five M16 fact families, 11 canonical kinds, 12 relationship types; F2 has no trigger and no
  --     L15 FK; exactly four L15 authoritative families are possible (GOVERNED_RISK + RISK_ASSESSMENT are implemented).
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
         AND c.relkind = 'r' AND c.relname ~ '^l15_.*_states$') <> 4 THEN
    RAISE EXCEPTION 'M17_S4_POSTFLIGHT: M16 families / canonical taxonomy / F2 / L15 family count changed';
  END IF;
  -- P5. ACL: no application role or the capability holds any privilege on any new table; every L15 routine owner postgres
  --     with a pinned search_path and no PUBLIC / anon / authenticated EXECUTE; the application definer surface grew by
  --     exactly the three RPCs (58 -> 61); L15 definers 19 -> 23 (+3 RPCs, +1 owner-only commit guard); service_role-
  --     executable L15 routines 13 -> 16; the technical intake surface stays exactly the two S1 RPCs; L15 tables 21 -> 24.
  IF EXISTS (SELECT 1 FROM pg_catalog.unnest(v_new_tables) AS x(t)
             CROSS JOIN pg_catalog.unnest(ARRAY['service_role','authenticated','anon','govia_l15_machine_intake_caller']) AS r(role)
             CROSS JOIN pg_catalog.unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN']) AS p(pr)
             WHERE pg_catalog.has_table_privilege(r.role, ('gov_repo.' || x.t)::regclass, p.pr)
                OR pg_catalog.has_any_column_privilege(r.role, ('gov_repo.' || x.t)::regclass, 'SELECT, INSERT, UPDATE, REFERENCES'))
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_class AS c
                CROSS JOIN pg_catalog.unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN']) AS p(pr)
                WHERE c.relnamespace = 'gov_repo'::regnamespace AND c.relkind = 'r' AND c.relname LIKE 'l15\_%' ESCAPE '\'
                  AND pg_catalog.has_table_privilege('service_role', c.oid, p.pr))
     OR (SELECT pg_catalog.count(*) FROM pg_catalog.pg_class AS c
         WHERE c.relnamespace = 'gov_repo'::regnamespace AND c.relname LIKE 'l15\_%' ESCAPE '\' AND c.relkind IN ('r','p')) <> 24
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_proc AS p WHERE p.pronamespace = 'gov_repo'::regnamespace AND p.proname LIKE 'l15\_%' ESCAPE '\'
                AND (pg_catalog.pg_get_userbyid(p.proowner) <> 'postgres'
                     OR NOT EXISTS (SELECT 1 FROM pg_catalog.unnest(COALESCE(p.proconfig, ARRAY[]::text[])) AS c(v) WHERE c.v = 'search_path=pg_catalog, pg_temp')
                     OR EXISTS (SELECT 1 FROM pg_catalog.aclexplode(COALESCE(p.proacl, pg_catalog.acldefault('f', p.proowner))) AS a WHERE a.grantee = 0)
                     OR pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE')
                     OR pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE')))
     OR (SELECT pg_catalog.count(*) FROM pg_catalog.pg_proc AS p WHERE p.pronamespace = 'gov_repo'::regnamespace AND p.proname LIKE 'l15\_%' ESCAPE '\'
         AND pg_catalog.has_function_privilege('service_role', p.oid, 'EXECUTE')) <> 16
     OR (SELECT pg_catalog.count(*) FROM pg_catalog.pg_proc AS p WHERE p.pronamespace = 'gov_repo'::regnamespace AND p.proname LIKE 'l15\_%' ESCAPE '\'
         AND p.prosecdef) <> 23
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
                            WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE'))) <> 61 THEN
    RAISE EXCEPTION 'M17_S4_POSTFLIGHT: ACL / definer surface violated';
  END IF;
  -- P6. No S4 routine writes any M16 / F2 store, issues SET CONSTRAINTS, or reads a legacy risk / score surface.
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_proc AS p WHERE p.pronamespace = 'gov_repo'::regnamespace
             AND p.proname ~ '^l15_(.*risk_assessment|assessment_validity_limit|lock_governed_risk_dependency|lock_methodology_dependency)'
             AND (p.prosrc ~* '(insert\s+into|update|delete\s+from|truncate)\s+gov_repo\.(l14_fact_states|l14_registry_states|l14_support_links|l14_[a-z_]+_(states|proposals|heads)|canonical_|l15_governed_risk_|l15_risk_methodolog|l15_risk_scenario)'
                  OR p.prosrc ~* 'set\s+constraints'
                  OR p.prosrc ~* '(risk_entries|risk_treatments|risk_level|risk_status|risk_category|ai_act_risk_class|inherent_risk_score|residual_risk_score|risk_appetite|agent_risk_propagation|compute_governance_score|risk_refs|residual_risk_level|heatmap)')) THEN
    RAISE EXCEPTION 'M17_S4_POSTFLIGHT: an S4 routine writes M16 / F2 / S2 / S3, forces the ALLOW guard or reads a legacy risk surface';
  END IF;
  -- P6b. O31: no L15 column is named like a score / weight / percentage / product, and the only numeric L15 columns are the S2
  --      methodology scale ordinals and the two pre-existing non-authoritative S1 hint_confidence columns (never read by any
  --      authority, rating or lifecycle logic). No RISK_ASSESSMENT store has any numeric column.
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_attribute AS a JOIN pg_catalog.pg_class AS c ON c.oid = a.attrelid
             WHERE c.relnamespace = 'gov_repo'::regnamespace AND c.relkind IN ('r','p') AND c.relname LIKE 'l15\_%' ESCAPE '\'
               AND a.attnum > 0 AND NOT a.attisdropped AND a.attname ~* '(score|weight|percent|product)')
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_attribute AS a JOIN pg_catalog.pg_class AS c ON c.oid = a.attrelid
                WHERE c.relnamespace = 'gov_repo'::regnamespace AND c.relkind IN ('r','p') AND c.relname LIKE 'l15\_%' ESCAPE '\'
                  AND a.attnum > 0 AND NOT a.attisdropped
                  AND a.atttypid IN ('pg_catalog.int2'::regtype, 'pg_catalog.int4'::regtype, 'pg_catalog.int8'::regtype,
                                     'pg_catalog.numeric'::regtype, 'pg_catalog.float4'::regtype, 'pg_catalog.float8'::regtype,
                                     'pg_catalog.money'::regtype)
                  AND (c.relname || '.' || a.attname) NOT IN ('l15_risk_methodology_likelihood_levels.ordinal',
                    'l15_risk_methodology_impact_levels.ordinal', 'l15_risk_signals.hint_confidence',
                    'l15_risk_hypotheses.hint_confidence')) THEN
    RAISE EXCEPTION 'M17_S4_POSTFLIGHT: O31 numeric score / weight / percentage / product column present in an L15 store';
  END IF;
  -- P7. Every existing machine-intake LOGIN still satisfies the closed S1R1 surface (S4 granted it nothing).
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members AS m JOIN pg_catalog.pg_roles AS r ON r.oid = m.member
             WHERE m.roleid = 'govia_l15_machine_intake_caller'::regrole AND r.rolcanlogin AND r.rolname <> 'postgres'
               AND NOT gov_repo.l15_machine_role_safe_v1(r.oid, r.rolname::text)) THEN
    RAISE EXCEPTION 'M17_S4_POSTFLIGHT: a machine intake LOGIN is no longer on its closed S1R1 surface';
  END IF;
  -- P8. Definer-capability inventory: each of the four new L15 SECURITY DEFINER routines has its exact owner, body SHA-256
  --     and config (any later change requires re-review of this inventory and of the test inventory).
  IF (SELECT pg_catalog.count(*) FROM (VALUES
      ('gov_repo.l15_submit_risk_assessment_proposal_v1(uuid,uuid,bigint,bigint,timestamp with time zone,text,text,text,uuid,text,uuid,uuid,text,text,text,text,timestamp with time zone,timestamp with time zone,uuid,uuid,uuid,text,text[],text[],text)', 'fb44d9beab311e29d11c5188f3831aa6200068856e9b276d8961f48e5dfb331b', 'search_path=pg_catalog, pg_temp;lock_timeout=5s'),
      ('gov_repo.l15_decide_risk_assessment_proposal_v1(uuid,uuid,bigint,bigint,timestamp with time zone,text,uuid,text,text,uuid,text,text[],text[],text)', 'd39a4505473f169f246bf40ff60749a73820cf8ab40e9e03117fd20ec6ceddda', 'search_path=pg_catalog, pg_temp;lock_timeout=5s'),
      ('gov_repo.l15_read_risk_assessment_v1(uuid,uuid,bigint,bigint,timestamp with time zone,uuid,text,timestamp with time zone,timestamp with time zone)', '8ee008ad3911d82887c46d090a91fc3da84a345373dcab80350e34a6c856df66', 'search_path=pg_catalog, pg_temp;lock_timeout=5s'),
      ('gov_repo.l15_risk_assessment_commit_guard_v1()', 'afed637992ab3fdf692e56d9409854283020d0f8214ffae70c4eae5187b87e37', 'search_path=pg_catalog, pg_temp')) AS m(sig, sha, cfg)
      JOIN pg_catalog.pg_proc AS p ON p.oid = pg_catalog.to_regprocedure(m.sig)
      WHERE p.prosecdef AND pg_catalog.pg_get_userbyid(p.proowner) = 'postgres'
        AND pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p.prosrc, 'UTF8')), 'hex') = m.sha
        AND COALESCE(pg_catalog.array_to_string(p.proconfig, ';'), '-') = m.cfg) <> 4 THEN
    RAISE EXCEPTION 'M17_S4_POSTFLIGHT: an S4 definer differs from its inventory (owner / body / config)';
  END IF;
END;
$postflight$;

COMMIT;
