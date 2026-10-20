-- M17-S7C final security closure: catalog assertions only. This migration creates no object, changes no ACL or routine,
-- and persists no authority. It fails closed unless the measured final S7A/S7B SECURITY DEFINER surface remains exact.
BEGIN;

DO $postflight$
DECLARE
  v_mismatch text;
BEGIN
  IF (SELECT pg_catalog.count(*) FROM pg_catalog.pg_proc p
      WHERE p.pronamespace = 'gov_repo'::regnamespace
        AND p.proname LIKE 'l15\_%' ESCAPE '\'
        AND p.prosecdef) <> 36 THEN
    RAISE EXCEPTION 'M17_S7C_POSTFLIGHT: expected exactly 36 L15 SECURITY DEFINER routines' USING ERRCODE = '55000';
  END IF;

  WITH expected(sig, owner_role, sha, cfg) AS (VALUES
    ('gov_repo.l15_read_risk_projections_v1(uuid,uuid,bigint,bigint,timestamp with time zone,text,text,text,text,text,uuid,timestamp with time zone,timestamp with time zone)',
      'postgres', '2e9de73461b30f67b98019658cd6fba77ccc05dda8c7c8ba3ba898c2c726bc26',
      'search_path=pg_catalog, pg_temp;lock_timeout=5s'),
    ('gov_repo.l15_read_passport_risk_overlay_v1(uuid,uuid,bigint,bigint,timestamp with time zone,text,text,timestamp with time zone,timestamp with time zone)',
      'postgres', 'd5933d65d5fce751cb98d85dbb7a98da15c6f21fdf166775da472f952941bb20',
      'search_path=pg_catalog, pg_temp;lock_timeout=5s')
  ), actual AS (
    SELECT p.oid::regprocedure::text AS sig, pg_catalog.pg_get_userbyid(p.proowner) AS owner_role,
      pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p.prosrc, 'UTF8')), 'hex') AS sha,
      coalesce(pg_catalog.array_to_string(p.proconfig, ';'), '-') AS cfg, p.oid, p.proacl
    FROM pg_catalog.pg_proc p
    WHERE p.oid IN (
      pg_catalog.to_regprocedure('gov_repo.l15_read_risk_projections_v1(uuid,uuid,bigint,bigint,timestamp with time zone,text,text,text,text,text,uuid,timestamp with time zone,timestamp with time zone)'),
      pg_catalog.to_regprocedure('gov_repo.l15_read_passport_risk_overlay_v1(uuid,uuid,bigint,bigint,timestamp with time zone,text,text,timestamp with time zone,timestamp with time zone)')
    )
  ), violations AS (
    SELECT 'inventory ' || e.sig AS violation FROM expected e
    LEFT JOIN actual a USING (sig, owner_role, sha, cfg) WHERE a.sig IS NULL
    UNION ALL
    SELECT 'acl ' || a.sig FROM actual a
    WHERE NOT pg_catalog.has_function_privilege('service_role', a.oid, 'EXECUTE')
       OR pg_catalog.has_function_privilege('anon', a.oid, 'EXECUTE')
       OR pg_catalog.has_function_privilege('authenticated', a.oid, 'EXECUTE')
       OR pg_catalog.has_function_privilege('govia_l15_machine_intake_caller', a.oid, 'EXECUTE')
       OR (SELECT pg_catalog.array_agg(pg_catalog.pg_get_userbyid(x.grantee) || ':' || x.privilege_type || ':' || x.is_grantable
             ORDER BY pg_catalog.pg_get_userbyid(x.grantee)) FROM pg_catalog.aclexplode(a.proacl) x)
          <> ARRAY['postgres:EXECUTE:false', 'service_role:EXECUTE:false']::text[]
  )
  SELECT pg_catalog.string_agg(violation, ', ' ORDER BY violation) INTO v_mismatch FROM violations;

  IF v_mismatch IS NOT NULL THEN
    RAISE EXCEPTION 'M17_S7C_POSTFLIGHT: %', v_mismatch USING ERRCODE = '55000';
  END IF;

  IF (SELECT pg_catalog.count(*) FROM pg_catalog.pg_proc p
      WHERE p.pronamespace = 'gov_repo'::regnamespace
        AND pg_catalog.has_function_privilege('govia_l15_machine_intake_caller', p.oid, 'EXECUTE')) <> 2 THEN
    RAISE EXCEPTION 'M17_S7C_POSTFLIGHT: machine intake capability is not exactly two routines' USING ERRCODE = '55000';
  END IF;

  WITH expected(relname, attname, atttype) AS (VALUES
    ('l15_risk_hypotheses', 'hint_confidence', 'numeric'),
    ('l15_risk_methodology_impact_levels', 'ordinal', 'smallint'),
    ('l15_risk_methodology_likelihood_levels', 'ordinal', 'smallint'),
    ('l15_risk_signals', 'hint_confidence', 'numeric'),
    ('l15_risk_treatment_proposals', 'control_pin_count', 'integer')
  ), actual AS (
    SELECT c.relname, a.attname, pg_catalog.format_type(a.atttypid, a.atttypmod) AS atttype
    FROM pg_catalog.pg_attribute a
    JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
    WHERE c.relnamespace = 'gov_repo'::regnamespace
      AND c.relname LIKE 'l15\_%' ESCAPE '\'
      AND c.relkind IN ('r', 'p') AND a.attnum > 0 AND NOT a.attisdropped
      AND a.atttypid IN ('smallint'::regtype, 'integer'::regtype, 'bigint'::regtype, 'numeric'::regtype,
        'real'::regtype, 'double precision'::regtype)
  ), violations AS (
    SELECT 'unclassified numeric ' || a.relname || '.' || a.attname || ':' || a.atttype AS violation
    FROM actual a LEFT JOIN expected e USING (relname, attname, atttype) WHERE e.relname IS NULL
    UNION ALL
    SELECT 'missing classified numeric ' || e.relname || '.' || e.attname || ':' || e.atttype
    FROM expected e LEFT JOIN actual a USING (relname, attname, atttype) WHERE a.relname IS NULL
    UNION ALL
    SELECT 'prohibited numeric mechanism ' || c.relname || '.' || a.attname
    FROM pg_catalog.pg_attribute a JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
    WHERE c.relnamespace = 'gov_repo'::regnamespace AND c.relname LIKE 'l15\_%' ESCAPE '\'
      AND c.relkind IN ('r', 'p') AND a.attnum > 0 AND NOT a.attisdropped
      AND a.attname ~* '(score|weight|percent|percentage|product)'
  )
  SELECT pg_catalog.string_agg(violation, ', ' ORDER BY violation) INTO v_mismatch FROM violations;

  IF v_mismatch IS NOT NULL THEN
    RAISE EXCEPTION 'M17_S7C_POSTFLIGHT: O31 %', v_mismatch USING ERRCODE = '55000';
  END IF;
END $postflight$;

COMMIT;
