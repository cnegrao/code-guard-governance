-- SEC-01: owner-supplied technical reference recovered on 2026-11-11.
-- Local implementation only; no prior formal architecture approval is asserted.
BEGIN;

CREATE FUNCTION gov_repo.read_executive_workspace_v1(
  p_verified_organisation_id uuid,
  p_verified_actor_user_id uuid,
  p_verified_session_iat bigint,
  p_verified_session_exp bigint,
  p_verified_credential_epoch timestamptz,
  p_page integer DEFAULT 1
)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
SET lock_timeout = '5s'
SET default_transaction_isolation = 'read committed'
AS $read$
DECLARE
  v_org uuid;
  v_objects jsonb;
  v_agents integer;
  v_page integer;
  v_agent text;
  v_facts jsonb;
  v_risks jsonb;
  v_subjects jsonb := '[]'::jsonb;
  v_at timestamptz;
BEGIN
  -- The canonical helper enforces READ COMMITTED and locks ORG -> USER ->
  -- ascending ROLES FOR SHARE. No exception block/subtransaction may release
  -- these locks or turn a denial/transaction failure into a partial result.
  SELECT e.organisation_id INTO STRICT v_org
  FROM gov_repo.lock_and_resolve_governance_session_eligibility_v1(
    p_verified_organisation_id, p_verified_actor_user_id,
    p_verified_session_iat, p_verified_session_exp, p_verified_credential_epoch) e;
  v_at := pg_catalog.clock_timestamp();

  -- One identity population, including an empty estate. Page membership and
  -- all counts derive from this materialized result, never another HTTP read.
  SELECT coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'organisation_id', o.organisation_id,
    'canonical_object_id', o.canonical_object_id, 'kind', o.kind)
    ORDER BY o.canonical_object_id COLLATE "C"), '[]'::jsonb)
  INTO v_objects FROM gov_repo.canonical_objects o WHERE o.organisation_id = v_org;

  SELECT pg_catalog.count(*)::integer INTO v_agents
  FROM pg_catalog.jsonb_array_elements(v_objects) o WHERE o->>'kind' = 'AGENT';
  v_page := least(greatest(coalesce(p_page, 1), 1), greatest(1, (v_agents + 11) / 12));

  FOR v_agent IN
    SELECT o->>'canonical_object_id' FROM pg_catalog.jsonb_array_elements(v_objects) o
    WHERE o->>'kind' = 'AGENT' ORDER BY (o->>'canonical_object_id') COLLATE "C"
    LIMIT 12 OFFSET ((v_page - 1) * 12)
  LOOP
    -- Reuse the existing protected projections unchanged, on the same backend
    -- and transaction. Their repeated M16 checks retain the same lock set.
    SELECT coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(f)), '[]'::jsonb)
    INTO v_facts FROM gov_repo.l14_read_passport_governance_v1(
      v_org, p_verified_actor_user_id, p_verified_session_iat, p_verified_session_exp,
      p_verified_credential_epoch, v_agent, NULL, v_at, v_at) f;
    SELECT pg_catalog.to_jsonb(r) INTO STRICT v_risks
    FROM gov_repo.l15_read_passport_risk_overlay_v1(
      v_org, p_verified_actor_user_id, p_verified_session_iat, p_verified_session_exp,
      p_verified_credential_epoch, 'AGENT', v_agent, v_at, v_at) r;
    v_subjects := v_subjects || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'id', v_agent, 'facts', v_facts, 'risks', v_risks));
  END LOOP;

  -- Buffer the complete acquisition. PostgREST releases a successful RPC only
  -- after transaction completion; callers must use POST, without get/head.
  RETURN pg_catalog.jsonb_build_object('organisation_id', v_org, 'objects', v_objects,
    'subjects', v_subjects, 'page', v_page, 'page_size', 12);
END;
$read$;

ALTER FUNCTION gov_repo.read_executive_workspace_v1(uuid,uuid,bigint,bigint,timestamptz,integer) OWNER TO postgres;
REVOKE ALL ON FUNCTION gov_repo.read_executive_workspace_v1(uuid,uuid,bigint,bigint,timestamptz,integer)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION gov_repo.read_executive_workspace_v1(uuid,uuid,bigint,bigint,timestamptz,integer) TO service_role;
COMMENT ON FUNCTION gov_repo.read_executive_workspace_v1(uuid,uuid,bigint,bigint,timestamptz,integer) IS
  'SEC-01: verified-backend-principal only; M16 admission and protected Executive acquisition in one READ COMMITTED transaction. ORG/USER/ROLE locks last until transaction end. Consistency ends at commit, not HTTP delivery. No write, policy or assurance decision.';
COMMIT;
