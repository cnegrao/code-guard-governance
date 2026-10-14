-- M17-S3R1: GOVERNED_RISK O44 support currency over the EXACT authoritative lineage (DB only, ADDITIVE corrective).
-- Architecture (ACCEPTED / FROZEN, not modified): docs/architecture/ADR-GOVIA-RISK-INTELLIGENCE-v1.md §13.2 (O44): support
-- invalidation is visible on every governed-risk read even when the dependency was only CITED as support (signals, proposal
-- support): the GOVERNED_RISK remains as decided, but every read exposes SUPPORT_DEGRADED and names the exact invalid link.
--
-- F-S3-1 (ACP delta review of M17-S3): 20261013140000_m17_s3_governed_risk_v1.sql projected only the STATE-owned support
-- links of a GOVERNED_RISK state. A VALIDATED state has one authoritative lineage — its proposal + its governance decision +
-- the state itself — and D-03 makes PROPOSAL / DECISION / STATE first-class support owners. Support cited only on the
-- proposal (or only on the decision) was invisible to the projection: a risk validated with proposal-only support read
-- SUPPORT_NONE, and an invalidated proposal-cited M16 fact never surfaced as SUPPORT_DEGRADED.
--
-- Correction (read / projection layer only): the two owner-only SECURITY INVOKER projections are replaced in place
-- (CREATE OR REPLACE: same signature, same result columns, owner / ACL / pinned search_path preserved):
--   * l15_governed_risk_support_currency_v1(org, state_id, at, cutoff) now evaluates the UNION of the GOVERNED_RISK support
--     links owned by exactly the lineage of that state:
--        PROPOSAL  owner_governed_risk_artifact = 'PROPOSAL' AND owner_governed_risk_proposal_id = S.proposal_id
--        DECISION  owner_governed_risk_artifact = 'DECISION' AND owner_governance_decision_id   = S.governance_decision_id
--        STATE     owner_governed_risk_artifact = 'STATE'    AND owner_governed_risk_state_id   = S.state_id
--     (owner_kind = 'GOVERNED_RISK', same organisation, link recorded at or before the cutoff). Never the support of another
--     proposal / decision / state, never scenario-registry support, never other support of the same logical key.
--   * l15_governed_risk_support_summary_v1 aggregates that union: SUPPORT_NONE iff zero lineage links; SUPPORT_DEGRADED iff
--     >= 1 lineage link fails; SUPPORT_CURRENT otherwise. The first failing link is deterministic: PROPOSAL -> DECISION ->
--     STATE, then link_id.
-- The per-link target rules are UNCHANGED (l15_support_link_target_failure_v1 is reused verbatim, not replaced): exact M16
-- resolver for L14_FACT_STATE, lineage for field states, existence for immutable evidence, transitive for signals /
-- hypotheses. Nothing is written, selected, replaced, revoked, repinned or re-decided; no RPC, definer, table, constraint,
-- trigger, privilege, owner-target matrix or store changes. l15_read_governed_risk_v1 already reads the summary function,
-- so its body (and inventory hash) is unchanged.
BEGIN;

-- ---------------------------------------------------------------------------------------------------------------------
-- A. Preflight: exactly the post-M17-S3 catalog (S3 projection not yet corrected), or abort with nothing applied.
-- ---------------------------------------------------------------------------------------------------------------------
DO $preflight$
BEGIN
  IF pg_catalog.current_setting('server_version_num')::integer NOT BETWEEN 170000 AND 179999 OR current_user <> 'postgres'
     OR pg_catalog.current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'M17_S3R1_PREFLIGHT: PostgreSQL 17 / postgres / READ COMMITTED required' USING ERRCODE = '55000';
  END IF;
  IF pg_catalog.to_regprocedure('gov_repo.l15_governed_risk_support_currency_v1(uuid,uuid,timestamptz,timestamptz)') IS NULL
     OR pg_catalog.to_regprocedure('gov_repo.l15_governed_risk_support_summary_v1(uuid,uuid,timestamptz,timestamptz)') IS NULL
     OR pg_catalog.to_regprocedure('gov_repo.l15_support_link_target_failure_v1(uuid,uuid,timestamptz,timestamptz)') IS NULL
     OR pg_catalog.to_regclass('gov_repo.l15_governed_risk_states') IS NULL
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attribute AS a WHERE a.attrelid = 'gov_repo.l15_support_links'::regclass
                    AND a.attname = 'owner_governed_risk_proposal_id' AND NOT a.attisdropped)
     -- The S3 projection is the uncorrected STATE-only body.
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_proc AS p
                WHERE p.oid = 'gov_repo.l15_governed_risk_support_currency_v1(uuid,uuid,timestamptz,timestamptz)'::regprocedure
                  AND (p.prosrc ~ 'owner_governed_risk_proposal_id' OR p.prosrc !~ 'owner_governed_risk_artifact = ''STATE''')) THEN
    RAISE EXCEPTION 'M17_S3R1_PREFLIGHT: the post-M17-S3 catalog (uncorrected O44 projection) is required' USING ERRCODE = '55000';
  END IF;
  -- The S3 definer inventory (owner / body / config) is exactly the reviewed one.
  IF (SELECT pg_catalog.count(*) FROM (VALUES
      ('gov_repo.l15_submit_governed_risk_proposal_v1(uuid,uuid,bigint,bigint,timestamp with time zone,text,text,text,text,text,text,text,text,uuid,uuid,text,timestamp with time zone,timestamp with time zone,uuid,uuid,text,uuid,text,text[],text[],text)', 'e6d8587dacea996a38c7f15bb50db3c3937cdc32a574f61e67a20a5e035531f5'),
      ('gov_repo.l15_decide_governed_risk_proposal_v1(uuid,uuid,bigint,bigint,timestamp with time zone,text,uuid,text,text,text,uuid,text,text[],text[],text)', '73e0d2401cf073e67d27cc6510d05b7ce0f556dbe397ff6baa8ae07128f60038'),
      ('gov_repo.l15_read_governed_risk_v1(uuid,uuid,bigint,bigint,timestamp with time zone,text,text,text,text,text,uuid,timestamp with time zone,timestamp with time zone)', '9425fa2272293d5148d3aa6433407afc85cc09825432844cd4a440d489326862'),
      ('gov_repo.l15_governed_risk_commit_guard_v1()', 'b9b88cf166ad7294fc47264893fc4e8051ce381009e4fcc32111c3bedf26ad5c')) AS m(sig, sha)
      JOIN pg_catalog.pg_proc AS p ON p.oid = pg_catalog.to_regprocedure(m.sig)
      WHERE p.prosecdef AND pg_catalog.pg_get_userbyid(p.proowner) = 'postgres'
        AND pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p.prosrc, 'UTF8')), 'hex') = m.sha) <> 4 THEN
    RAISE EXCEPTION 'M17_S3R1_PREFLIGHT: the S3 definer inventory differs from the reviewed one' USING ERRCODE = '55000';
  END IF;
END;
$preflight$;

CREATE TEMPORARY TABLE m17_s3r1_routine_snapshot ON COMMIT DROP AS
  SELECT p.oid::regprocedure::text AS sig, pg_catalog.md5(p.prosrc) AS body, p.prosecdef AS definer, p.proowner AS owner,
         COALESCE(pg_catalog.array_to_string(p.proconfig, ';'), '-') AS cfg, COALESCE(p.proacl::text, '-') AS acl,
         pg_catalog.pg_get_function_result(p.oid) AS result
  FROM pg_catalog.pg_proc AS p WHERE p.pronamespace = 'gov_repo'::regnamespace;
CREATE TEMPORARY TABLE m17_s3r1_relation_snapshot ON COMMIT DROP AS
  SELECT 'c:' || k.conrelid::regclass::text || ':' || k.conname::text || ':' || pg_catalog.pg_get_constraintdef(k.oid) AS item
  FROM pg_catalog.pg_constraint AS k JOIN pg_catalog.pg_class AS c ON c.oid = k.conrelid WHERE c.relnamespace = 'gov_repo'::regnamespace
  UNION ALL
  SELECT 't:' || t.tgrelid::regclass::text || ':' || t.tgname::text || ':' || t.tgenabled::text || ':' || t.tgfoid::regprocedure::text
  FROM pg_catalog.pg_trigger AS t JOIN pg_catalog.pg_class AS c ON c.oid = t.tgrelid
  WHERE c.relnamespace = 'gov_repo'::regnamespace AND NOT t.tgisinternal
  UNION ALL
  SELECT 'r:' || c.relname::text || ':' || c.relkind::text || ':' || COALESCE(c.relacl::text, '-')
  FROM pg_catalog.pg_class AS c WHERE c.relnamespace = 'gov_repo'::regnamespace;
CREATE TEMPORARY TABLE m17_s3r1_row_capture ON COMMIT DROP AS
  SELECT 'l15_support_links' AS relation, pg_catalog.count(*) AS row_count,
         COALESCE(pg_catalog.md5(pg_catalog.string_agg(t::text, E'\n' ORDER BY t::text COLLATE "C")), 'EMPTY') AS row_hash
  FROM gov_repo.l15_support_links AS t
  UNION ALL
  SELECT 'l15_governed_risk_states', pg_catalog.count(*),
         COALESCE(pg_catalog.md5(pg_catalog.string_agg(t::text, E'\n' ORDER BY t::text COLLATE "C")), 'EMPTY')
  FROM gov_repo.l15_governed_risk_states AS t
  UNION ALL
  SELECT 'l15_governed_risk_heads', pg_catalog.count(*),
         COALESCE(pg_catalog.md5(pg_catalog.string_agg(t::text, E'\n' ORDER BY t::text COLLATE "C")), 'EMPTY')
  FROM gov_repo.l15_governed_risk_heads AS t
  UNION ALL
  SELECT 'l14_fact_states', pg_catalog.count(*),
         COALESCE(pg_catalog.md5(pg_catalog.string_agg(t::text, E'\n' ORDER BY t::text COLLATE "C")), 'EMPTY')
  FROM gov_repo.l14_fact_states AS t;

-- ---------------------------------------------------------------------------------------------------------------------
-- B. The corrected O44 projections (owner-only SECURITY INVOKER; read only; persist nothing).
-- ---------------------------------------------------------------------------------------------------------------------
-- Per-link currency of the EXACT lineage support of one GOVERNED_RISK state: the GOVERNED_RISK links owned by its proposal,
-- its governance decision and the state itself (union; each link appears once, under its own owner). Target rules are the
-- reviewed S3 rules, unchanged (l15_support_link_target_failure_v1). RISK_SIGNAL targets inherit the currency of the signal's
-- own rank-0 links; RISK_HYPOTHESIS targets that of their cited signals (rank 2 -> 1 -> 0; bounded, acyclic by construction).
-- Each degraded row names the exact failing lineage link and, for a transitive failure, the exact upstream (signal-owned)
-- link that failed. Rows are returned PROPOSAL -> DECISION -> STATE, then link_id.
CREATE OR REPLACE FUNCTION gov_repo.l15_governed_risk_support_currency_v1(
  p_organisation_id uuid, p_state_id uuid, p_effective_at timestamptz, p_recorded_cutoff timestamptz)
RETURNS TABLE (link_id uuid, target_tag text, target_id text, link_currency text, failure_reason text, upstream_link_id uuid)
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  WITH s AS (
    SELECT st.organisation_id, st.state_id, st.proposal_id, st.governance_decision_id
    FROM gov_repo.l15_governed_risk_states AS st
    WHERE st.organisation_id = p_organisation_id AND st.state_id = p_state_id
  ), links AS (
    SELECT l.*, CASE l.owner_governed_risk_artifact WHEN 'PROPOSAL' THEN 1 WHEN 'DECISION' THEN 2 ELSE 3 END AS owner_rank
    FROM gov_repo.l15_support_links AS l
    JOIN s ON l.organisation_id = s.organisation_id
    WHERE l.owner_kind = 'GOVERNED_RISK' AND l.recorded_at <= p_recorded_cutoff
      AND ((l.owner_governed_risk_artifact = 'PROPOSAL' AND l.owner_governed_risk_proposal_id = s.proposal_id)
        OR (l.owner_governed_risk_artifact = 'DECISION' AND l.owner_governance_decision_id = s.governance_decision_id)
        OR (l.owner_governed_risk_artifact = 'STATE' AND l.owner_governed_risk_state_id = s.state_id))
  ), evaluated AS (
    SELECT l.link_id, l.owner_rank, l.target_tag,
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
  ORDER BY e.owner_rank, e.link_id
$$;

-- Aggregate support currency of the exact lineage of one GOVERNED_RISK state (closed projection vocabulary):
-- SUPPORT_NONE iff zero lineage links (PROPOSAL + DECISION + STATE); SUPPORT_DEGRADED iff >= 1 lineage link is not current
-- (the first failing link is named, deterministically PROPOSAL -> DECISION -> STATE, then link_id); SUPPORT_CURRENT otherwise.
CREATE OR REPLACE FUNCTION gov_repo.l15_governed_risk_support_summary_v1(
  p_organisation_id uuid, p_state_id uuid, p_effective_at timestamptz, p_recorded_cutoff timestamptz)
RETURNS TABLE (support_currency text, support_link_count bigint, degraded_link_count bigint, failing_link_id uuid,
               failing_reason text, failing_upstream_link_id uuid)
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  WITH c AS (
    SELECT x.*, CASE l.owner_governed_risk_artifact WHEN 'PROPOSAL' THEN 1 WHEN 'DECISION' THEN 2 ELSE 3 END AS owner_rank
    FROM gov_repo.l15_governed_risk_support_currency_v1(p_organisation_id, p_state_id, p_effective_at, p_recorded_cutoff) AS x
    JOIN gov_repo.l15_support_links AS l ON l.organisation_id = p_organisation_id AND l.link_id = x.link_id
  )
  SELECT CASE WHEN (SELECT pg_catalog.count(*) FROM c) = 0 THEN 'SUPPORT_NONE'
              WHEN EXISTS (SELECT 1 FROM c WHERE c.link_currency = 'DEGRADED') THEN 'SUPPORT_DEGRADED'
              ELSE 'SUPPORT_CURRENT' END,
         (SELECT pg_catalog.count(*) FROM c),
         (SELECT pg_catalog.count(*) FROM c WHERE c.link_currency = 'DEGRADED'),
         f.link_id, f.failure_reason, f.upstream_link_id
  FROM (SELECT 1) AS one
  LEFT JOIN LATERAL (SELECT c.link_id, c.failure_reason, c.upstream_link_id FROM c WHERE c.link_currency = 'DEGRADED'
                     ORDER BY c.owner_rank, c.link_id LIMIT 1) AS f ON true
$$;

COMMENT ON FUNCTION gov_repo.l15_governed_risk_support_currency_v1(uuid, uuid, timestamptz, timestamptz) IS 'M17-S3R1 O44 per-link support-currency projection over the EXACT lineage of a GOVERNED_RISK state (its PROPOSAL + DECISION + STATE GOVERNED_RISK support links; read only): M16 fact support through the exact M16 resolvers only; field states through their lineage; immutable evidence by existence; signals / hypotheses transitively. Ordered PROPOSAL -> DECISION -> STATE, then link_id.';
COMMENT ON FUNCTION gov_repo.l15_governed_risk_support_summary_v1(uuid, uuid, timestamptz, timestamptz) IS 'M17-S3R1 O44 aggregate over the exact lineage support union: SUPPORT_NONE (no lineage link) / SUPPORT_CURRENT / SUPPORT_DEGRADED (first failing link PROPOSAL -> DECISION -> STATE, then link_id). Read only; never authority.';

-- ---------------------------------------------------------------------------------------------------------------------
-- C. Postflight over the effective catalog.
-- ---------------------------------------------------------------------------------------------------------------------
DO $postflight$
BEGIN
  -- P1. Only the two projection bodies changed; signature, result columns, invoker, owner, config and ACL preserved; every
  --     other routine byte-identical (incl. the four S3 definers and l15_support_link_target_failure_v1).
  IF EXISTS (SELECT 1 FROM m17_s3r1_routine_snapshot AS b
             LEFT JOIN pg_catalog.pg_proc AS p ON p.oid = pg_catalog.to_regprocedure(b.sig)
             WHERE p.oid IS NULL OR p.prosecdef IS DISTINCT FROM b.definer OR p.proowner IS DISTINCT FROM b.owner
                OR COALESCE(pg_catalog.array_to_string(p.proconfig, ';'), '-') IS DISTINCT FROM b.cfg
                OR COALESCE(p.proacl::text, '-') IS DISTINCT FROM b.acl
                OR pg_catalog.pg_get_function_result(p.oid) IS DISTINCT FROM b.result
                OR (pg_catalog.md5(p.prosrc) IS DISTINCT FROM b.body
                    AND b.sig NOT IN ('gov_repo.l15_governed_risk_support_currency_v1(uuid,uuid,timestamp with time zone,timestamp with time zone)',
                                      'gov_repo.l15_governed_risk_support_summary_v1(uuid,uuid,timestamp with time zone,timestamp with time zone)')))
     OR (SELECT pg_catalog.count(*) FROM pg_catalog.pg_proc AS p WHERE p.pronamespace = 'gov_repo'::regnamespace)
        <> (SELECT pg_catalog.count(*) FROM m17_s3r1_routine_snapshot)
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_proc AS p
                WHERE p.oid IN ('gov_repo.l15_governed_risk_support_currency_v1(uuid,uuid,timestamptz,timestamptz)'::regprocedure,
                                'gov_repo.l15_governed_risk_support_summary_v1(uuid,uuid,timestamptz,timestamptz)'::regprocedure)
                  AND (p.prosecdef OR pg_catalog.pg_get_userbyid(p.proowner) <> 'postgres'
                       OR COALESCE(pg_catalog.array_to_string(p.proconfig, ';'), '-') <> 'search_path=pg_catalog, pg_temp'
                       OR pg_catalog.has_function_privilege('service_role', p.oid, 'EXECUTE')
                       OR pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE')
                       OR pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE')
                       OR pg_catalog.has_function_privilege('govia_l15_machine_intake_caller', p.oid, 'EXECUTE'))) THEN
    RAISE EXCEPTION 'M17_S3R1_POSTFLIGHT: a routine other than the two O44 projections changed, or their contract / ACL moved';
  END IF;
  -- P2. No table, constraint, trigger or table ACL changed; no support / risk / M16 row changed.
  IF EXISTS (SELECT item FROM m17_s3r1_relation_snapshot EXCEPT
             (SELECT 'c:' || k.conrelid::regclass::text || ':' || k.conname::text || ':' || pg_catalog.pg_get_constraintdef(k.oid)
              FROM pg_catalog.pg_constraint AS k JOIN pg_catalog.pg_class AS c ON c.oid = k.conrelid WHERE c.relnamespace = 'gov_repo'::regnamespace
              UNION ALL
              SELECT 't:' || t.tgrelid::regclass::text || ':' || t.tgname::text || ':' || t.tgenabled::text || ':' || t.tgfoid::regprocedure::text
              FROM pg_catalog.pg_trigger AS t JOIN pg_catalog.pg_class AS c ON c.oid = t.tgrelid
              WHERE c.relnamespace = 'gov_repo'::regnamespace AND NOT t.tgisinternal
              UNION ALL
              SELECT 'r:' || c.relname::text || ':' || c.relkind::text || ':' || COALESCE(c.relacl::text, '-')
              FROM pg_catalog.pg_class AS c WHERE c.relnamespace = 'gov_repo'::regnamespace))
     OR (SELECT pg_catalog.count(*) FROM m17_s3r1_relation_snapshot) <>
        (SELECT (SELECT pg_catalog.count(*) FROM pg_catalog.pg_constraint AS k JOIN pg_catalog.pg_class AS c ON c.oid = k.conrelid
                 WHERE c.relnamespace = 'gov_repo'::regnamespace)
              + (SELECT pg_catalog.count(*) FROM pg_catalog.pg_trigger AS t JOIN pg_catalog.pg_class AS c ON c.oid = t.tgrelid
                 WHERE c.relnamespace = 'gov_repo'::regnamespace AND NOT t.tgisinternal)
              + (SELECT pg_catalog.count(*) FROM pg_catalog.pg_class AS c WHERE c.relnamespace = 'gov_repo'::regnamespace))
     OR EXISTS (SELECT 1 FROM m17_s3r1_row_capture AS b
                WHERE (b.relation, b.row_count, b.row_hash) NOT IN (
                  SELECT 'l15_support_links', pg_catalog.count(*),
                         COALESCE(pg_catalog.md5(pg_catalog.string_agg(t::text, E'\n' ORDER BY t::text COLLATE "C")), 'EMPTY')
                  FROM gov_repo.l15_support_links AS t
                  UNION ALL
                  SELECT 'l15_governed_risk_states', pg_catalog.count(*),
                         COALESCE(pg_catalog.md5(pg_catalog.string_agg(t::text, E'\n' ORDER BY t::text COLLATE "C")), 'EMPTY')
                  FROM gov_repo.l15_governed_risk_states AS t
                  UNION ALL
                  SELECT 'l15_governed_risk_heads', pg_catalog.count(*),
                         COALESCE(pg_catalog.md5(pg_catalog.string_agg(t::text, E'\n' ORDER BY t::text COLLATE "C")), 'EMPTY')
                  FROM gov_repo.l15_governed_risk_heads AS t
                  UNION ALL
                  SELECT 'l14_fact_states', pg_catalog.count(*),
                         COALESCE(pg_catalog.md5(pg_catalog.string_agg(t::text, E'\n' ORDER BY t::text COLLATE "C")), 'EMPTY')
                  FROM gov_repo.l14_fact_states AS t)) THEN
    RAISE EXCEPTION 'M17_S3R1_POSTFLIGHT: a table / constraint / trigger / ACL or a support / risk / M16 row changed';
  END IF;
  -- P3. Surface unchanged: application definers 58, L15 definers 19, service_role L15 routines 13, intake exactly 2.
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
    RAISE EXCEPTION 'M17_S3R1_POSTFLIGHT: definer / RPC / intake surface changed';
  END IF;
  -- P4. The corrected projections write nothing and read no legacy surface.
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_proc AS p
             WHERE p.oid IN ('gov_repo.l15_governed_risk_support_currency_v1(uuid,uuid,timestamptz,timestamptz)'::regprocedure,
                             'gov_repo.l15_governed_risk_support_summary_v1(uuid,uuid,timestamptz,timestamptz)'::regprocedure)
               AND (p.provolatile <> 's' OR p.prosrc ~* '(insert\s+into|update\s+gov_repo|delete\s+from|truncate|set\s+constraints)'
                    OR p.prosrc ~* '(risk_entries|risk_treatments|risk_level|agent_risk_propagation|compute_governance_score)')) THEN
    RAISE EXCEPTION 'M17_S3R1_POSTFLIGHT: an O44 projection writes or reads a legacy surface';
  END IF;
END;
$postflight$;

COMMIT;
