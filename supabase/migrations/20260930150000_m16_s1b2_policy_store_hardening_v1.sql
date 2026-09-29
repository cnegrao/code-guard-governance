-- M16-S1B.2: hardening of the REUSED policy stores (DB only, ADDITIVE, HARDENING ONLY).
-- Architecture: docs/architecture/ADR-GOVIA-OWNERSHIP-BUSINESS-POLICY-CONTROL-ENRICHMENT-v1.md
-- §§4, 13, 16, 19-21 plus the S1B architecture-owner decisions (D-3, D-4, D-5, D-13 FROZEN) and the
-- M16-S1B.2 gate. Hardens gov_repo.governance_policies and gov_repo.policy_versions IN PLACE so the later
-- Policy admission (S1B.3) and PolicyVersion validation (S1B.4) slices can reuse them. No third policy
-- store, no L14 object, no Policy lifecycle, no RPC, no application-callable routine.
-- No historical migration is edited. Never run against a hosted DB from this slice.
--
-- This migration:
--   A. Preflight: the exact legacy shape it hardens (CASCADE version FK, parent tenant key from
--      20260901134812, trigger set, no orphan/tenantless version) or it aborts atomically.
--   B. Tenancy: policy_versions.organisation_id backfilled ONLY from the exact parent
--      governance_policies.organisation_id, proven, then NOT NULL; the historical CASCADE FK is replaced
--      by (organisation_id, policy_id) -> governance_policies (organisation_id, policy_id) ON DELETE RESTRICT
--      (reusing governance_policies_organisation_policy_unique); tenant-safe identity keys
--      (organisation_id, policy_id, version_id) and (organisation_id, policy_id, version_id, content_hash).
--   C. D-3: content_hash is lowercase hex SHA-256 of the exact stored UTF-8 bytes of content_markdown, NO
--      normalization. A BEFORE INSERT guard recomputes it in PostgreSQL: an omitted hash is DB-authored,
--      a differing caller hash is rejected (23514). A NOT VALID CHECK is the backstop for new rows;
--      historical rows are NOT rewritten or validated (legacy data until explicit S1B.3/S1B.4 governance).
--   D. D-5: every policy_versions row is ENTIRELY immutable after INSERT (UPDATE of any column, DELETE,
--      TRUNCATE raise 55000, ENABLE ALWAYS, even for the owner). governance_policies: identity/creation
--      provenance (policy_id, organisation_id, created_at, created_by) immutable; DELETE/TRUNCATE raise.
--      Legacy descriptive fields (title, description, policy_code, policy_type, status, dates,
--      owner_user_id, approver_user_id, parent_policy_id, current_version_id, updated_at) stay mutable
--      legacy data and confer NO M16 authority.
--   E. D-13: ZERO direct privilege (INCLUDING SELECT) for PUBLIC/anon/authenticated/service_role on both
--      tables; the legacy USING(true)/org-scoped RLS policies are dropped (no replacement); any view that
--      reaches either table and any SECURITY DEFINER routine that reaches either table lose every
--      application-role privilege. No read RPC: future reads need an explicit controlled contract.
--   F. Postflight over the EFFECTIVE catalog after all grants, including the hostile 20260818013113
--      defaults (a default-granted object reaching the tables fails it). Re-executable.
-- Deliberately NOT done here: owner_user_id nullability (D-4 -> S1B.3), any use of current_version_id
-- (LEGACY / NON-AUTHORITATIVE / inert for M16: never read, written, or used to derive validation,
-- authority or temporal state), any promotion of legacy status/approval to M16 truth.
-- F2 untouched: no canonical_relationships DDL/DML/FK.
BEGIN;

-- Both reused stores are exclusively locked for the whole transaction (parent first).
LOCK TABLE gov_repo.governance_policies, gov_repo.policy_versions IN ACCESS EXCLUSIVE MODE;

-- ---------------------------------------------------------------------------------------
-- A. Preflight: harden exactly the audited legacy shape, or abort with nothing applied.
-- ---------------------------------------------------------------------------------------
DO $preflight$
DECLARE
  v_policies CONSTANT regclass := 'gov_repo.governance_policies'::regclass;
  v_versions CONSTANT regclass := 'gov_repo.policy_versions'::regclass;
  v_count bigint;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_attribute AS att
             WHERE att.attrelid = v_versions AND att.attname = 'organisation_id' AND NOT att.attisdropped) THEN
    RAISE EXCEPTION 'M16_S1B2_PREFLIGHT: policy_versions.organisation_id already exists' USING ERRCODE = '55000';
  END IF;
  IF (SELECT pg_catalog.count(*) FROM pg_catalog.pg_constraint AS k
      WHERE k.conrelid = v_versions AND k.contype = 'f' AND k.confrelid = v_policies) <> 1
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint AS k
                    WHERE k.conrelid = v_versions AND k.conname = 'policy_versions_policy_id_fkey' AND k.contype = 'f'
                      AND k.confrelid = v_policies AND k.confdeltype = 'c'
                      AND k.conkey = ARRAY[(SELECT att.attnum FROM pg_catalog.pg_attribute AS att
                                            WHERE att.attrelid = v_versions AND att.attname = 'policy_id')]::int2[]) THEN
    RAISE EXCEPTION 'M16_S1B2_PREFLIGHT: legacy policy_versions -> governance_policies FK is not the expected CASCADE FK'
      USING ERRCODE = '55000';
  END IF;
  -- The parent tenant key established by 20260901134812 is reused, never duplicated.
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint AS k
                 WHERE k.conrelid = v_policies AND k.conname = 'governance_policies_organisation_policy_unique'
                   AND k.contype = 'u'
                   AND k.conkey = ARRAY[
                     (SELECT att.attnum FROM pg_catalog.pg_attribute AS att WHERE att.attrelid = v_policies AND att.attname = 'organisation_id'),
                     (SELECT att.attnum FROM pg_catalog.pg_attribute AS att WHERE att.attrelid = v_policies AND att.attname = 'policy_id')]::int2[]) THEN
    RAISE EXCEPTION 'M16_S1B2_PREFLIGHT: parent key governance_policies (organisation_id, policy_id) missing' USING ERRCODE = '55000';
  END IF;
  -- The trigger set being hardened is exactly the legacy one.
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_trigger AS t WHERE t.tgrelid = v_versions AND NOT t.tgisinternal)
     OR (SELECT pg_catalog.array_agg(t.tgname::text ORDER BY t.tgname::text) FROM pg_catalog.pg_trigger AS t
         WHERE t.tgrelid = v_policies AND NOT t.tgisinternal) IS DISTINCT FROM ARRAY['trg_governance_policies_updated_at'] THEN
    RAISE EXCEPTION 'M16_S1B2_PREFLIGHT: unexpected user trigger on the reused policy stores' USING ERRCODE = '55000';
  END IF;
  -- The parent policy is the SOLE tenant source: every version must resolve it.
  SELECT pg_catalog.count(*) INTO v_count
  FROM gov_repo.policy_versions AS v
  LEFT JOIN gov_repo.governance_policies AS p ON p.policy_id = v.policy_id
  WHERE p.policy_id IS NULL;
  IF v_count > 0 THEN
    RAISE EXCEPTION 'M16_S1B2_PREFLIGHT: policy version(s) without a parent policy'
      USING ERRCODE = '23503', DETAIL = pg_catalog.format('%s orphan policy version(s); manual data-owner disposition required', v_count);
  END IF;
  SELECT pg_catalog.count(*) INTO v_count
  FROM gov_repo.policy_versions AS v
  JOIN gov_repo.governance_policies AS p ON p.policy_id = v.policy_id
  WHERE p.organisation_id IS NULL;
  IF v_count > 0 THEN
    RAISE EXCEPTION 'M16_S1B2_PREFLIGHT: parent policy without tenant ownership'
      USING ERRCODE = '23502', DETAIL = pg_catalog.format('%s policy version(s) under a tenantless policy', v_count);
  END IF;
END;
$preflight$;

-- ---------------------------------------------------------------------------------------
-- B. Tenancy. The backfill is the ONLY data change: it sets the new column from the exact parent.
-- ---------------------------------------------------------------------------------------
ALTER TABLE gov_repo.policy_versions ADD COLUMN organisation_id uuid;

UPDATE gov_repo.policy_versions AS v
SET organisation_id = p.organisation_id
FROM gov_repo.governance_policies AS p
WHERE p.policy_id = v.policy_id;

DO $backfill$
DECLARE
  v_count bigint;
BEGIN
  SELECT pg_catalog.count(*) INTO v_count FROM gov_repo.policy_versions AS v WHERE v.organisation_id IS NULL;
  IF v_count > 0 THEN
    RAISE EXCEPTION 'M16_S1B2_BACKFILL: policy version tenant unresolved'
      USING ERRCODE = '23514', DETAIL = pg_catalog.format('%s policy version(s)', v_count);
  END IF;
  SELECT pg_catalog.count(*) INTO v_count
  FROM gov_repo.policy_versions AS v
  JOIN gov_repo.governance_policies AS p ON p.policy_id = v.policy_id
  WHERE p.organisation_id IS DISTINCT FROM v.organisation_id;
  IF v_count > 0 THEN
    RAISE EXCEPTION 'M16_S1B2_BACKFILL: policy version tenant differs from its parent policy'
      USING ERRCODE = '23514', DETAIL = pg_catalog.format('%s policy version(s)', v_count);
  END IF;
END;
$backfill$;

ALTER TABLE gov_repo.policy_versions ALTER COLUMN organisation_id SET NOT NULL;

-- A Policy deletion can never erase or detach version history: CASCADE is dropped, RESTRICT added.
ALTER TABLE gov_repo.policy_versions
  DROP CONSTRAINT policy_versions_policy_id_fkey,
  ADD CONSTRAINT policy_versions_organisation_policy_fkey
    FOREIGN KEY (organisation_id, policy_id)
    REFERENCES gov_repo.governance_policies (organisation_id, policy_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  ADD CONSTRAINT policy_versions_organisation_policy_version_unique
    UNIQUE (organisation_id, policy_id, version_id),
  ADD CONSTRAINT policy_versions_organisation_policy_version_hash_unique
    UNIQUE (organisation_id, policy_id, version_id, content_hash),
  -- D-3 backstop for every NEW row. NOT VALID: historical rows are legacy data and are neither
  -- rewritten nor certified here.
  ADD CONSTRAINT policy_versions_content_hash_sha256_utf8_check
    CHECK (content_hash::text = pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(content_markdown, 'UTF8')), 'hex'))
    NOT VALID;

-- ---------------------------------------------------------------------------------------
-- C/D. Raising guards (never silent DO INSTEAD NOTHING), ENABLE ALWAYS, owner-only.
-- ---------------------------------------------------------------------------------------
CREATE FUNCTION gov_repo.policy_store_history_immutable_v1()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, pg_temp
AS $immutable$
BEGIN
  RAISE EXCEPTION 'POLICY_STORE_HISTORY_IMMUTABLE'
    USING ERRCODE = '55000', DETAIL = TG_TABLE_NAME || ':' || TG_OP;
END;
$immutable$;

-- D-3: PostgreSQL alone authors/verifies the canonical content hash; a caller value is never trusted.
CREATE FUNCTION gov_repo.policy_store_version_content_hash_guard_v1()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, pg_temp
AS $hash$
DECLARE
  v_hash text;
BEGIN
  IF NEW.content_markdown IS NULL THEN
    RAISE EXCEPTION 'POLICY_VERSION_CONTENT_REQUIRED' USING ERRCODE = '23502';
  END IF;
  v_hash := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(NEW.content_markdown, 'UTF8')), 'hex');
  IF NEW.content_hash IS NULL THEN
    NEW.content_hash := v_hash;
  ELSIF NEW.content_hash::text IS DISTINCT FROM v_hash THEN
    RAISE EXCEPTION 'POLICY_VERSION_CONTENT_HASH_MISMATCH'
      USING ERRCODE = '23514', DETAIL = 'CALLER_HASH_DIFFERS_FROM_DB_SHA256_OF_UTF8_CONTENT';
  END IF;
  RETURN NEW;
END;
$hash$;

-- Policy identity and creation provenance are immutable; legacy descriptive fields are not touched.
CREATE FUNCTION gov_repo.policy_store_policy_identity_guard_v1()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, pg_temp
AS $identity$
BEGIN
  IF NEW.policy_id IS DISTINCT FROM OLD.policy_id
     OR NEW.organisation_id IS DISTINCT FROM OLD.organisation_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR NEW.created_by IS DISTINCT FROM OLD.created_by THEN
    RAISE EXCEPTION 'POLICY_STORE_HISTORY_IMMUTABLE'
      USING ERRCODE = '55000', DETAIL = 'governance_policies:IDENTITY_OR_PROVENANCE';
  END IF;
  RETURN NEW;
END;
$identity$;

CREATE TRIGGER policy_versions_content_hash_guard BEFORE INSERT ON gov_repo.policy_versions
  FOR EACH ROW EXECUTE FUNCTION gov_repo.policy_store_version_content_hash_guard_v1();
CREATE TRIGGER policy_versions_immutable BEFORE UPDATE OR DELETE ON gov_repo.policy_versions
  FOR EACH ROW EXECUTE FUNCTION gov_repo.policy_store_history_immutable_v1();
CREATE TRIGGER policy_versions_no_truncate BEFORE TRUNCATE ON gov_repo.policy_versions
  FOR EACH STATEMENT EXECUTE FUNCTION gov_repo.policy_store_history_immutable_v1();
CREATE TRIGGER governance_policies_identity_guard BEFORE UPDATE ON gov_repo.governance_policies
  FOR EACH ROW EXECUTE FUNCTION gov_repo.policy_store_policy_identity_guard_v1();
CREATE TRIGGER governance_policies_no_delete BEFORE DELETE ON gov_repo.governance_policies
  FOR EACH ROW EXECUTE FUNCTION gov_repo.policy_store_history_immutable_v1();
CREATE TRIGGER governance_policies_no_truncate BEFORE TRUNCATE ON gov_repo.governance_policies
  FOR EACH STATEMENT EXECUTE FUNCTION gov_repo.policy_store_history_immutable_v1();

ALTER TABLE gov_repo.policy_versions ENABLE ALWAYS TRIGGER policy_versions_content_hash_guard;
ALTER TABLE gov_repo.policy_versions ENABLE ALWAYS TRIGGER policy_versions_immutable;
ALTER TABLE gov_repo.policy_versions ENABLE ALWAYS TRIGGER policy_versions_no_truncate;
ALTER TABLE gov_repo.governance_policies ENABLE ALWAYS TRIGGER governance_policies_identity_guard;
ALTER TABLE gov_repo.governance_policies ENABLE ALWAYS TRIGGER governance_policies_no_delete;
ALTER TABLE gov_repo.governance_policies ENABLE ALWAYS TRIGGER governance_policies_no_truncate;

-- ---------------------------------------------------------------------------------------
-- E. Privileges (D-13). The hostile 20260818013113 defaults granted ALL on both tables to service_role
--    and hand every new gov_repo routine to service_role (plus PUBLIC EXECUTE): all removed. No
--    application role keeps ANY privilege, INCLUDING SELECT. REVOKE ALL ON TABLE also revokes every
--    column-level privilege. No replacement RLS policy is invented.
-- ---------------------------------------------------------------------------------------
DROP POLICY "Service role has full access to governance_policies" ON gov_repo.governance_policies;
DROP POLICY "Org-scoped access to governance_policies" ON gov_repo.governance_policies;
DROP POLICY "Service role has full access to policy_versions" ON gov_repo.policy_versions;
DROP POLICY "Org-scoped access to policy_versions" ON gov_repo.policy_versions;
ALTER TABLE gov_repo.governance_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE gov_repo.policy_versions ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE gov_repo.governance_policies, gov_repo.policy_versions
FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION
  gov_repo.policy_store_history_immutable_v1(),
  gov_repo.policy_store_version_content_hash_guard_v1(),
  gov_repo.policy_store_policy_identity_guard_v1()
FROM PUBLIC, anon, authenticated, service_role;

-- Indirect paths that exist outside this repository's M16 chain (e.g. a legacy bridge view or a legacy
-- SECURITY DEFINER score function) lose every application-role privilege. Catalog-driven and reported.
DO $indirect$
DECLARE
  v_tables CONSTANT oid[] := ARRAY['gov_repo.governance_policies'::regclass::oid, 'gov_repo.policy_versions'::regclass::oid];
  v_obj record;
BEGIN
  FOR v_obj IN
    WITH RECURSIVE reach(oid) AS (
      SELECT w.ev_class FROM pg_catalog.pg_rewrite AS w
      JOIN pg_catalog.pg_depend AS d ON d.classid = 'pg_catalog.pg_rewrite'::regclass AND d.objid = w.oid
      WHERE d.refclassid = 'pg_catalog.pg_class'::regclass AND d.refobjid = ANY (v_tables) AND w.ev_class <> ALL (v_tables)
      UNION
      SELECT w.ev_class FROM reach
      JOIN pg_catalog.pg_depend AS d ON d.refclassid = 'pg_catalog.pg_class'::regclass AND d.refobjid = reach.oid
        AND d.classid = 'pg_catalog.pg_rewrite'::regclass
      JOIN pg_catalog.pg_rewrite AS w ON w.oid = d.objid
      WHERE w.ev_class <> reach.oid)
    SELECT DISTINCT reach.oid::regclass AS rel FROM reach
  LOOP
    RAISE NOTICE 'M16_S1B2: revoking application-role privileges on view %', v_obj.rel;
    EXECUTE pg_catalog.format('REVOKE ALL ON TABLE %s FROM PUBLIC, anon, authenticated, service_role', v_obj.rel);
  END LOOP;
  FOR v_obj IN
    SELECT p.oid::regprocedure AS fn
    FROM pg_catalog.pg_proc AS p
    WHERE p.prosecdef
      AND p.pronamespace NOT IN ('pg_catalog'::regnamespace, 'information_schema'::regnamespace)
      AND (p.prosrc ~ '(^|[^A-Za-z0-9_$])(governance_policies|policy_versions)([^A-Za-z0-9_$]|$)'
           OR EXISTS (SELECT 1 FROM pg_catalog.pg_depend AS d
                      WHERE d.classid = 'pg_catalog.pg_proc'::regclass AND d.objid = p.oid
                        AND d.refclassid = 'pg_catalog.pg_class'::regclass AND d.refobjid = ANY (v_tables)))
  LOOP
    RAISE NOTICE 'M16_S1B2: revoking application-role EXECUTE on definer routine %', v_obj.fn;
    EXECUTE pg_catalog.format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated, service_role', v_obj.fn);
  END LOOP;
END;
$indirect$;

COMMENT ON COLUMN gov_repo.policy_versions.organisation_id IS 'M16-S1B.2 tenant of this version, backfilled and enforced ONLY from the exact parent governance_policies.organisation_id via the (organisation_id, policy_id) RESTRICT FK; never inferred from owner, actor, status, current_version_id or session.';
COMMENT ON COLUMN gov_repo.policy_versions.content_hash IS 'M16-S1B.2 (D-3) lowercase hex SHA-256 of the exact stored UTF-8 bytes of content_markdown, no normalization; recomputed by PostgreSQL on INSERT (omitted = DB-authored, differing caller value rejected). Historical rows are legacy data and are not rewritten.';
COMMENT ON COLUMN gov_repo.governance_policies.current_version_id IS 'LEGACY / NON-AUTHORITATIVE for M16: never read or written by M16 and never used to derive validation, authority, applicability or temporal state. Points to the legacy-approved version only.';
COMMENT ON COLUMN gov_repo.governance_policies.owner_user_id IS 'Legacy owner (constraint unchanged by M16-S1B.2; D-4 is resolved at S1B.3 admission). Not an M16 responsibility fact or authority.';
COMMENT ON TABLE gov_repo.policy_versions IS 'Reused M16 policy-version store (M16-S1B.2 hardened): tenant-consistent with its parent policy, DB-verified content hash, ENTIRELY immutable after INSERT (corrections are NEW versions), no cascade deletion, no application-role privilege. Legacy status/approval fields are not M16 authority.';
COMMENT ON TABLE gov_repo.governance_policies IS 'Reused M16 policy identity store (M16-S1B.2 hardened): identity/creation provenance immutable, never deleted/truncated, no application-role privilege. Legacy status/owner/current_version_id are not M16 authority.';
COMMENT ON FUNCTION gov_repo.policy_store_version_content_hash_guard_v1() IS 'M16-S1B.2 owner-only BEFORE INSERT guard: DB-authored/verified canonical content hash (D-3).';
COMMENT ON FUNCTION gov_repo.policy_store_history_immutable_v1() IS 'M16-S1B.2 owner-only raising history guard (55000) for the reused policy stores.';
COMMENT ON FUNCTION gov_repo.policy_store_policy_identity_guard_v1() IS 'M16-S1B.2 owner-only guard: governance policy identity/creation provenance immutable (55000).';

-- ---------------------------------------------------------------------------------------
-- F. Postflight over the EFFECTIVE catalog (after ALL grants, including the broad legacy defaults).
-- ---------------------------------------------------------------------------------------
DO $postflight$
DECLARE
  v_policies CONSTANT regclass := 'gov_repo.governance_policies'::regclass;
  v_versions CONSTANT regclass := 'gov_repo.policy_versions'::regclass;
  v_tables CONSTANT oid[] := ARRAY['gov_repo.governance_policies'::regclass::oid, 'gov_repo.policy_versions'::regclass::oid];
  v_app_roles CONSTANT text[] := ARRAY['anon','authenticated','service_role'];
  v_expected_l14 CONSTANT text[] := ARRAY[
    'l14_authority_policies','l14_authority_policy_heads','l14_authority_policy_rules',
    'l14_authority_policy_states','l14_authority_policy_version_proposals','l14_authority_policy_versions',
    'l14_authorization_decision_roles','l14_authorization_decision_rules','l14_authorization_decisions',
    'l14_command_results','l14_governance_decisions','l14_governance_parties','l14_governance_party_heads',
    'l14_governance_party_proposals','l14_governance_party_states','l14_proposals','l14_registry_states',
    'l14_support_links'];
  v_public_rpcs CONSTANT text[] := ARRAY[
    'l14_admit_authority_policy_version_v1','l14_admit_governance_party_v1','l14_decide_authority_policy_proposal_v1',
    'l14_decide_governance_party_proposal_v1','l14_submit_governance_party_proposal_v1','l14_submit_proposal_v1'];
  v_guards CONSTANT text[] := ARRAY[
    'policy_store_history_immutable_v1','policy_store_policy_identity_guard_v1','policy_store_version_content_hash_guard_v1'];
  v_table_regex CONSTANT text := '(^|[^A-Za-z0-9_$])(governance_policies|policy_versions)([^A-Za-z0-9_$]|$)';
  v_privileges text[] := ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'];
  v_rel record;
  v_fn record;
  v_role text;
  v_privilege text;
  v_org int2;
  v_policy int2;
  v_version int2;
  v_hash int2;
BEGIN
  IF pg_catalog.current_setting('server_version_num')::integer >= 170000 THEN
    v_privileges := pg_catalog.array_append(v_privileges, 'MAINTAIN'::text);
  END IF;
  SELECT att.attnum INTO v_org FROM pg_catalog.pg_attribute AS att WHERE att.attrelid = v_versions AND att.attname = 'organisation_id' AND NOT att.attisdropped;
  SELECT att.attnum INTO v_policy FROM pg_catalog.pg_attribute AS att WHERE att.attrelid = v_versions AND att.attname = 'policy_id';
  SELECT att.attnum INTO v_version FROM pg_catalog.pg_attribute AS att WHERE att.attrelid = v_versions AND att.attname = 'version_id';
  SELECT att.attnum INTO v_hash FROM pg_catalog.pg_attribute AS att WHERE att.attrelid = v_versions AND att.attname = 'content_hash';

  -- Tenancy.
  IF v_org IS NULL OR NOT (SELECT att.attnotnull AND att.atttypid = 'uuid'::regtype FROM pg_catalog.pg_attribute AS att
                           WHERE att.attrelid = v_versions AND att.attnum = v_org) THEN
    RAISE EXCEPTION 'M16_S1B2_POSTFLIGHT: policy_versions.organisation_id must be NOT NULL uuid';
  END IF;
  IF EXISTS (SELECT 1 FROM gov_repo.policy_versions AS v
             LEFT JOIN gov_repo.governance_policies AS p ON p.policy_id = v.policy_id
             WHERE p.organisation_id IS DISTINCT FROM v.organisation_id) THEN
    RAISE EXCEPTION 'M16_S1B2_POSTFLIGHT: policy version tenant differs from its parent policy';
  END IF;
  IF (SELECT pg_catalog.count(*) FROM pg_catalog.pg_constraint AS k
      WHERE k.conrelid = v_versions AND k.contype = 'f' AND k.confrelid = v_policies) <> 1
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint AS k
                    WHERE k.conrelid = v_versions AND k.contype = 'f' AND k.confrelid = v_policies
                      AND k.conname = 'policy_versions_organisation_policy_fkey'
                      AND k.conkey = ARRAY[v_org, v_policy]::int2[]
                      AND k.confkey = ARRAY[
                        (SELECT att.attnum FROM pg_catalog.pg_attribute AS att WHERE att.attrelid = v_policies AND att.attname = 'organisation_id'),
                        (SELECT att.attnum FROM pg_catalog.pg_attribute AS att WHERE att.attrelid = v_policies AND att.attname = 'policy_id')]::int2[]
                      AND k.confdeltype = 'r' AND k.confupdtype = 'r' AND k.convalidated AND NOT k.condeferrable) THEN
    RAISE EXCEPTION 'M16_S1B2_POSTFLIGHT: tenant-safe (organisation_id, policy_id) RESTRICT FK missing or not exact';
  END IF;
  -- No cascade / set-null / set-default path can erase or detach version history.
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_constraint AS k
             WHERE k.contype = 'f' AND (k.conrelid = v_versions OR k.confrelid = v_versions)
               AND (k.confdeltype NOT IN ('a','r') OR k.confupdtype NOT IN ('a','r'))) THEN
    RAISE EXCEPTION 'M16_S1B2_POSTFLIGHT: a cascading/set-null FK touches policy_versions';
  END IF;
  -- Tenant-safe identity keys (existing ids; no new identity).
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint AS k WHERE k.conrelid = v_versions AND k.contype = 'u'
                   AND k.convalidated AND k.conkey = ARRAY[v_org, v_policy, v_version]::int2[])
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint AS k WHERE k.conrelid = v_versions AND k.contype = 'u'
                   AND k.convalidated AND k.conkey = ARRAY[v_org, v_policy, v_version, v_hash]::int2[])
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint AS k WHERE k.conrelid = v_versions AND k.contype = 'p'
                   AND k.conkey = ARRAY[v_version]::int2[])
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint AS k WHERE k.conrelid = v_policies AND k.contype = 'u'
                   AND k.conname = 'governance_policies_organisation_policy_unique') THEN
    RAISE EXCEPTION 'M16_S1B2_POSTFLIGHT: required tenant-safe identity keys missing';
  END IF;
  -- D-3 hash backstop present (deliberately NOT VALID: historical rows are not certified).
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint AS k WHERE k.conrelid = v_versions AND k.contype = 'c'
                   AND k.conname = 'policy_versions_content_hash_sha256_utf8_check'
                   AND pg_catalog.pg_get_constraintdef(k.oid) LIKE '%sha256(convert_to(content_markdown, ''UTF8''::name))%') THEN
    RAISE EXCEPTION 'M16_S1B2_POSTFLIGHT: content hash CHECK backstop missing';
  END IF;
  -- Exact ALWAYS guard set (tgtype bits: 1 ROW, 2 BEFORE, 4 INSERT, 8 DELETE, 16 UPDATE, 32 TRUNCATE).
  IF (SELECT pg_catalog.array_agg(t.tgname::text || ':' || t.tgenabled::text || ':' || t.tgtype::text || ':' || fp.pronamespace::regnamespace::text || '.' || fp.proname::text
                                  ORDER BY t.tgname::text)
      FROM pg_catalog.pg_trigger AS t JOIN pg_catalog.pg_proc AS fp ON fp.oid = t.tgfoid WHERE t.tgrelid = v_versions AND NOT t.tgisinternal)
     IS DISTINCT FROM ARRAY[
       'policy_versions_content_hash_guard:A:7:gov_repo.policy_store_version_content_hash_guard_v1',
       'policy_versions_immutable:A:27:gov_repo.policy_store_history_immutable_v1',
       'policy_versions_no_truncate:A:34:gov_repo.policy_store_history_immutable_v1'] THEN
    RAISE EXCEPTION 'M16_S1B2_POSTFLIGHT: policy_versions guard set is not exactly hash + immutable + no-truncate (ALWAYS)';
  END IF;
  IF (SELECT pg_catalog.array_agg(t.tgname::text || ':' || t.tgenabled::text || ':' || t.tgtype::text || ':' || fp.pronamespace::regnamespace::text || '.' || fp.proname::text
                                  ORDER BY t.tgname::text)
      FROM pg_catalog.pg_trigger AS t JOIN pg_catalog.pg_proc AS fp ON fp.oid = t.tgfoid WHERE t.tgrelid = v_policies AND NOT t.tgisinternal)
     IS DISTINCT FROM ARRAY[
       'governance_policies_identity_guard:A:19:gov_repo.policy_store_policy_identity_guard_v1',
       'governance_policies_no_delete:A:11:gov_repo.policy_store_history_immutable_v1',
       'governance_policies_no_truncate:A:34:gov_repo.policy_store_history_immutable_v1',
       'trg_governance_policies_updated_at:O:19:gov_repo.set_updated_at'] THEN
    RAISE EXCEPTION 'M16_S1B2_POSTFLIGHT: governance_policies guard set is not exactly identity + no-delete + no-truncate (ALWAYS) + legacy updated_at';
  END IF;
  -- D-4 deferred: the legacy owner constraint is preserved.
  IF NOT (SELECT att.attnotnull FROM pg_catalog.pg_attribute AS att WHERE att.attrelid = v_policies AND att.attname = 'owner_user_id') THEN
    RAISE EXCEPTION 'M16_S1B2_POSTFLIGHT: owner_user_id constraint changed (D-4 belongs to S1B.3)';
  END IF;

  -- D-13: zero application access to both tables.
  FOR v_rel IN
    SELECT c.oid, c.relname, c.relkind, c.relowner, c.relacl, c.relrowsecurity FROM pg_catalog.pg_class AS c WHERE c.oid = ANY (v_tables)
  LOOP
    IF v_rel.relkind <> 'r' OR NOT v_rel.relrowsecurity THEN
      RAISE EXCEPTION 'M16_S1B2_POSTFLIGHT: % must be an RLS-enabled ordinary table', v_rel.relname;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_catalog.aclexplode(COALESCE(v_rel.relacl, pg_catalog.acldefault('r', v_rel.relowner))) AS a
               WHERE a.grantee <> v_rel.relowner) THEN
      RAISE EXCEPTION 'M16_S1B2_POSTFLIGHT: % has a non-owner table grant', v_rel.relname;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_attribute AS att WHERE att.attrelid = v_rel.oid AND att.attacl IS NOT NULL) THEN
      RAISE EXCEPTION 'M16_S1B2_POSTFLIGHT: % has column-level grants', v_rel.relname;
    END IF;
    FOREACH v_role IN ARRAY v_app_roles LOOP
      FOREACH v_privilege IN ARRAY v_privileges LOOP
        IF pg_catalog.has_table_privilege(v_role, v_rel.oid, v_privilege) THEN
          RAISE EXCEPTION 'M16_S1B2_POSTFLIGHT: % holds % on %', v_role, v_privilege, v_rel.relname;
        END IF;
      END LOOP;
      IF pg_catalog.has_any_column_privilege(v_role, v_rel.oid, 'SELECT, INSERT, UPDATE, REFERENCES') THEN
        RAISE EXCEPTION 'M16_S1B2_POSTFLIGHT: % holds a column privilege on %', v_role, v_rel.relname;
      END IF;
    END LOOP;
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_policy AS pol WHERE pol.polrelid = v_rel.oid) THEN
      RAISE EXCEPTION 'M16_S1B2_POSTFLIGHT: % carries an RLS policy (no application access path may exist)', v_rel.relname;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_attribute AS att
               WHERE att.attrelid = v_rel.oid AND att.attnum > 0 AND NOT att.attisdropped
                 AND att.atttypid IN ('json'::regtype, 'jsonb'::regtype)) THEN
      RAISE EXCEPTION 'M16_S1B2_POSTFLIGHT: % has a JSON column (no JSON/EAV policy authority)', v_rel.relname;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_constraint AS k
               WHERE k.conrelid = v_rel.oid AND k.confrelid = 'gov_repo.canonical_relationships'::regclass) THEN
      RAISE EXCEPTION 'M16_S1B2_POSTFLIGHT: F2 boundary violated by %', v_rel.relname;
    END IF;
  END LOOP;
  IF pg_catalog.has_table_privilege('service_role', v_versions, 'SELECT')
     OR pg_catalog.has_table_privilege('service_role', v_policies, 'SELECT') THEN
    RAISE EXCEPTION 'M16_S1B2_POSTFLIGHT: service_role can SELECT a reused policy store';
  END IF;
  -- Inheritance would let another relation's rows/privileges reach the history.
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_inherits AS i WHERE i.inhrelid = ANY (v_tables) OR i.inhparent = ANY (v_tables)) THEN
    RAISE EXCEPTION 'M16_S1B2_POSTFLIGHT: inheritance involves a reused policy store';
  END IF;
  -- Sequences owned by / defaulted into either table.
  FOR v_rel IN
    SELECT DISTINCT s.oid, s.relname FROM pg_catalog.pg_class AS s
    JOIN pg_catalog.pg_depend AS d ON d.classid = 'pg_catalog.pg_class'::regclass AND d.objid = s.oid
    WHERE s.relkind = 'S' AND d.refclassid = 'pg_catalog.pg_class'::regclass AND d.refobjid = ANY (v_tables)
    UNION
    SELECT DISTINCT s.oid, s.relname FROM pg_catalog.pg_attrdef AS ad
    JOIN pg_catalog.pg_depend AS d ON d.classid = 'pg_catalog.pg_attrdef'::regclass AND d.objid = ad.oid
    JOIN pg_catalog.pg_class AS s ON s.oid = d.refobjid AND s.relkind = 'S'
    WHERE ad.adrelid = ANY (v_tables)
  LOOP
    FOREACH v_role IN ARRAY v_app_roles LOOP
      IF pg_catalog.has_sequence_privilege(v_role, v_rel.oid, 'USAGE') OR pg_catalog.has_sequence_privilege(v_role, v_rel.oid, 'SELECT')
         OR pg_catalog.has_sequence_privilege(v_role, v_rel.oid, 'UPDATE') THEN
        RAISE EXCEPTION 'M16_S1B2_POSTFLIGHT: % holds a privilege on sequence %', v_role, v_rel.relname;
      END IF;
    END LOOP;
  END LOOP;
  -- Any view (any schema, transitively) reaching either table: no application-role privilege at all.
  FOR v_rel IN
    WITH RECURSIVE reach(oid) AS (
      SELECT w.ev_class FROM pg_catalog.pg_rewrite AS w
      JOIN pg_catalog.pg_depend AS d ON d.classid = 'pg_catalog.pg_rewrite'::regclass AND d.objid = w.oid
      WHERE d.refclassid = 'pg_catalog.pg_class'::regclass AND d.refobjid = ANY (v_tables) AND w.ev_class <> ALL (v_tables)
      UNION
      SELECT w.ev_class FROM reach
      JOIN pg_catalog.pg_depend AS d ON d.refclassid = 'pg_catalog.pg_class'::regclass AND d.refobjid = reach.oid
        AND d.classid = 'pg_catalog.pg_rewrite'::regclass
      JOIN pg_catalog.pg_rewrite AS w ON w.oid = d.objid
      WHERE w.ev_class <> reach.oid)
    SELECT DISTINCT c.oid, c.relname, c.relowner, c.relacl FROM reach JOIN pg_catalog.pg_class AS c ON c.oid = reach.oid
  LOOP
    IF EXISTS (SELECT 1 FROM pg_catalog.aclexplode(COALESCE(v_rel.relacl, pg_catalog.acldefault('r', v_rel.relowner))) AS a
               WHERE a.grantee = 0) THEN
      RAISE EXCEPTION 'M16_S1B2_POSTFLIGHT: view % reaching a policy store has a PUBLIC grant', v_rel.relname;
    END IF;
    FOREACH v_role IN ARRAY v_app_roles LOOP
      FOREACH v_privilege IN ARRAY v_privileges LOOP
        IF pg_catalog.has_table_privilege(v_role, v_rel.oid, v_privilege) THEN
          RAISE EXCEPTION 'M16_S1B2_POSTFLIGHT: % holds % on view % reaching a policy store', v_role, v_privilege, v_rel.relname;
        END IF;
      END LOOP;
      IF pg_catalog.has_any_column_privilege(v_role, v_rel.oid, 'SELECT, INSERT, UPDATE, REFERENCES') THEN
        RAISE EXCEPTION 'M16_S1B2_POSTFLIGHT: % holds a column privilege on view % reaching a policy store', v_role, v_rel.relname;
      END IF;
    END LOOP;
  END LOOP;
  -- No application-callable definer routine reaches either table (no read/write RPC in S1B.2).
  FOR v_fn IN
    SELECT p.oid, p.proname, p.proowner, p.proacl FROM pg_catalog.pg_proc AS p
    WHERE p.prosecdef
      AND p.pronamespace NOT IN ('pg_catalog'::regnamespace, 'information_schema'::regnamespace)
      AND (p.prosrc ~ v_table_regex
           OR EXISTS (SELECT 1 FROM pg_catalog.pg_depend AS d
                      WHERE d.classid = 'pg_catalog.pg_proc'::regclass AND d.objid = p.oid
                        AND d.refclassid = 'pg_catalog.pg_class'::regclass AND d.refobjid = ANY (v_tables)))
  LOOP
    IF EXISTS (SELECT 1 FROM pg_catalog.aclexplode(COALESCE(v_fn.proacl, pg_catalog.acldefault('f', v_fn.proowner))) AS a
               WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE') THEN
      RAISE EXCEPTION 'M16_S1B2_POSTFLIGHT: definer routine % reaching a policy store has PUBLIC EXECUTE', v_fn.proname;
    END IF;
    FOREACH v_role IN ARRAY v_app_roles LOOP
      IF pg_catalog.has_function_privilege(v_role, v_fn.oid, 'EXECUTE') THEN
        RAISE EXCEPTION 'M16_S1B2_POSTFLIGHT: definer routine % reaching a policy store is executable by %', v_fn.proname, v_role;
      END IF;
    END LOOP;
  END LOOP;
  -- The three S1B.2 guards: owner-only SECURITY INVOKER trigger functions, pinned search_path, and they
  -- never consume current_version_id or touch canonical_relationships.
  IF (SELECT pg_catalog.array_agg(p.proname::text ORDER BY p.proname::text) FROM pg_catalog.pg_proc AS p
      WHERE p.pronamespace = 'gov_repo'::regnamespace AND p.proname LIKE 'policy\_store\_%' ESCAPE '\') IS DISTINCT FROM v_guards THEN
    RAISE EXCEPTION 'M16_S1B2_POSTFLIGHT: unexpected policy_store routine set';
  END IF;
  FOR v_fn IN
    SELECT p.oid, p.proname, p.proowner, p.proacl, p.prosecdef, p.proconfig, p.prorettype, p.prosrc FROM pg_catalog.pg_proc AS p
    WHERE p.pronamespace = 'gov_repo'::regnamespace AND p.proname::text = ANY (v_guards)
  LOOP
    IF v_fn.prosecdef OR v_fn.prorettype <> 'trigger'::regtype
       OR NOT COALESCE(v_fn.proconfig @> ARRAY['search_path=pg_catalog, pg_temp'], false)
       OR EXISTS (SELECT 1 FROM pg_catalog.aclexplode(COALESCE(v_fn.proacl, pg_catalog.acldefault('f', v_fn.proowner))) AS a
                  WHERE a.grantee <> v_fn.proowner)
       OR v_fn.prosrc ~ '(current_version_id|canonical_relationships)' THEN
      RAISE EXCEPTION 'M16_S1B2_POSTFLIGHT: guard % must be an owner-only SECURITY INVOKER trigger function', v_fn.proname;
    END IF;
  END LOOP;

  -- No Policy L14 lifecycle object: the l14 relation set and the public L14 RPC surface are unchanged.
  IF (SELECT pg_catalog.array_agg(c.relname::text ORDER BY c.relname::text COLLATE "C")
      FROM pg_catalog.pg_class AS c
      WHERE c.relnamespace = 'gov_repo'::regnamespace AND c.relname LIKE 'l14\_%' ESCAPE '\'
        AND c.relkind IN ('r','p','v','m','S','f')) IS DISTINCT FROM v_expected_l14 THEN
    RAISE EXCEPTION 'M16_S1B2_POSTFLIGHT: the l14 relation set changed (no Policy lifecycle object in S1B.2)';
  END IF;
  IF (SELECT pg_catalog.count(*) FROM pg_catalog.pg_proc AS p
      WHERE p.pronamespace = 'gov_repo'::regnamespace AND p.proname LIKE 'l14\_%' ESCAPE '\' AND p.prosecdef) <> 6
     OR (SELECT pg_catalog.array_agg(p.proname::text ORDER BY p.proname::text) FROM pg_catalog.pg_proc AS p
         WHERE p.pronamespace = 'gov_repo'::regnamespace AND p.proname LIKE 'l14\_%' ESCAPE '\'
           AND pg_catalog.has_function_privilege('service_role', p.oid, 'EXECUTE')) IS DISTINCT FROM v_public_rpcs
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_proc AS p
                WHERE p.pronamespace = 'gov_repo'::regnamespace AND p.proname LIKE 'l14\_%' ESCAPE '\'
                  AND (p.prosrc ~ v_table_regex
                       OR (p.proname ~ '^l14_.*(policy_version|policy_admission|admit_policy|policy_content)' AND p.proname !~ 'authority'))) THEN
    RAISE EXCEPTION 'M16_S1B2_POSTFLIGHT: the public L14 RPC surface must remain exactly the six S1B.1 RPCs, none reaching a policy store';
  END IF;
  -- F2: no L14 relation references canonical_relationships either.
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_constraint AS k
             WHERE k.confrelid = 'gov_repo.canonical_relationships'::regclass
               AND k.conrelid IN (SELECT c.oid FROM pg_catalog.pg_class AS c
                                  WHERE c.relnamespace = 'gov_repo'::regnamespace AND c.relname LIKE 'l14\_%' ESCAPE '\')) THEN
    RAISE EXCEPTION 'M16_S1B2_POSTFLIGHT: F2 boundary violated';
  END IF;
END;
$postflight$;

COMMIT;
