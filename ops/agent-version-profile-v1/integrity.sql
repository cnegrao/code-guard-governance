-- Run only on the reviewed test connection. Read-only, one consistent snapshot.
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SELECT current_database(), current_user,
 (SELECT org_code FROM gov_repo.organisations WHERE organisation_id='082ef694-e016-4893-908c-1eef373f53af') AS organisation;
SELECT jsonb_agg(to_jsonb(s) ORDER BY relation) AS domain_integrity FROM (
 SELECT 'canonical_objects'::text AS relation,count(*) AS row_count,
 encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text COLLATE "C"),'[]'::jsonb)::text,'UTF8')),'hex') AS row_sha256
 FROM gov_repo.canonical_objects t WHERE organisation_id='082ef694-e016-4893-908c-1eef373f53af'
 UNION ALL
 SELECT 'canonical_normalized_object_mappings'::text AS relation,count(*) AS row_count,
 encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text COLLATE "C"),'[]'::jsonb)::text,'UTF8')),'hex') AS row_sha256
 FROM gov_repo.canonical_normalized_object_mappings t WHERE organisation_id='082ef694-e016-4893-908c-1eef373f53af'
 UNION ALL
 SELECT 'canonical_object_source_mappings'::text AS relation,count(*) AS row_count,
 encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text COLLATE "C"),'[]'::jsonb)::text,'UTF8')),'hex') AS row_sha256
 FROM gov_repo.canonical_object_source_mappings t WHERE organisation_id='082ef694-e016-4893-908c-1eef373f53af'
 UNION ALL
 SELECT 'canonical_relationships'::text AS relation,count(*) AS row_count,
 encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text COLLATE "C"),'[]'::jsonb)::text,'UTF8')),'hex') AS row_sha256
 FROM gov_repo.canonical_relationships t WHERE organisation_id='082ef694-e016-4893-908c-1eef373f53af'
 UNION ALL
 SELECT 'discovery_candidates'::text AS relation,count(*) AS row_count,
 encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text COLLATE "C"),'[]'::jsonb)::text,'UTF8')),'hex') AS row_sha256
 FROM gov_repo.discovery_candidates t WHERE organisation_id='082ef694-e016-4893-908c-1eef373f53af'
 UNION ALL
 SELECT 'discovery_evidence'::text AS relation,count(*) AS row_count,
 encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text COLLATE "C"),'[]'::jsonb)::text,'UTF8')),'hex') AS row_sha256
 FROM gov_repo.discovery_evidence t WHERE organisation_id='082ef694-e016-4893-908c-1eef373f53af'
 UNION ALL
 SELECT 'source_assertions'::text AS relation,count(*) AS row_count,
 encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text COLLATE "C"),'[]'::jsonb)::text,'UTF8')),'hex') AS row_sha256
 FROM gov_repo.source_assertions t WHERE organisation_id='082ef694-e016-4893-908c-1eef373f53af'
 UNION ALL
 SELECT 'source_assertion_evidence'::text AS relation,count(*) AS row_count,
 encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text COLLATE "C"),'[]'::jsonb)::text,'UTF8')),'hex') AS row_sha256
 FROM gov_repo.source_assertion_evidence t WHERE organisation_id='082ef694-e016-4893-908c-1eef373f53af'
 UNION ALL
 SELECT 'review_subjects'::text AS relation,count(*) AS row_count,
 encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text COLLATE "C"),'[]'::jsonb)::text,'UTF8')),'hex') AS row_sha256
 FROM gov_repo.review_subjects t WHERE organisation_id='082ef694-e016-4893-908c-1eef373f53af'
 UNION ALL
 SELECT 'review_subject_assertions'::text AS relation,count(*) AS row_count,
 encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text COLLATE "C"),'[]'::jsonb)::text,'UTF8')),'hex') AS row_sha256
 FROM gov_repo.review_subject_assertions t WHERE organisation_id='082ef694-e016-4893-908c-1eef373f53af'
 UNION ALL
 SELECT 'review_subject_evidence'::text AS relation,count(*) AS row_count,
 encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text COLLATE "C"),'[]'::jsonb)::text,'UTF8')),'hex') AS row_sha256
 FROM gov_repo.review_subject_evidence t WHERE organisation_id='082ef694-e016-4893-908c-1eef373f53af'
 UNION ALL
 SELECT 'review_audit_events'::text AS relation,count(*) AS row_count,
 encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text COLLATE "C"),'[]'::jsonb)::text,'UTF8')),'hex') AS row_sha256
 FROM gov_repo.review_audit_events t WHERE organisation_id='082ef694-e016-4893-908c-1eef373f53af'
 UNION ALL
 SELECT 'reconciliation_decisions'::text AS relation,count(*) AS row_count,
 encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text COLLATE "C"),'[]'::jsonb)::text,'UTF8')),'hex') AS row_sha256
 FROM gov_repo.reconciliation_decisions t WHERE organisation_id='082ef694-e016-4893-908c-1eef373f53af'
 UNION ALL
 SELECT 'reconciliation_decision_assertions'::text AS relation,count(*) AS row_count,
 encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text COLLATE "C"),'[]'::jsonb)::text,'UTF8')),'hex') AS row_sha256
 FROM gov_repo.reconciliation_decision_assertions t WHERE organisation_id='082ef694-e016-4893-908c-1eef373f53af'
 UNION ALL
 SELECT 'reconciliation_decision_evidence'::text AS relation,count(*) AS row_count,
 encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text COLLATE "C"),'[]'::jsonb)::text,'UTF8')),'hex') AS row_sha256
 FROM gov_repo.reconciliation_decision_evidence t WHERE organisation_id='082ef694-e016-4893-908c-1eef373f53af'
 UNION ALL
 SELECT 'reconciliation_invocations'::text AS relation,count(*) AS row_count,
 encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text COLLATE "C"),'[]'::jsonb)::text,'UTF8')),'hex') AS row_sha256
 FROM gov_repo.reconciliation_invocations t WHERE organisation_id='082ef694-e016-4893-908c-1eef373f53af'
 UNION ALL
 SELECT 'materialization_operations'::text AS relation,count(*) AS row_count,
 encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text COLLATE "C"),'[]'::jsonb)::text,'UTF8')),'hex') AS row_sha256
 FROM gov_repo.materialization_operations t WHERE organisation_id='082ef694-e016-4893-908c-1eef373f53af'
 UNION ALL
 SELECT 'agent_version_technical_profile_proposals'::text AS relation,count(*) AS row_count,
 encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text COLLATE "C"),'[]'::jsonb)::text,'UTF8')),'hex') AS row_sha256
 FROM gov_repo.agent_version_technical_profile_proposals t WHERE organisation_id='082ef694-e016-4893-908c-1eef373f53af'
 UNION ALL
 SELECT 'agent_version_technical_profile_proposal_field_assertions'::text AS relation,count(*) AS row_count,
 encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text COLLATE "C"),'[]'::jsonb)::text,'UTF8')),'hex') AS row_sha256
 FROM gov_repo.agent_version_technical_profile_proposal_field_assertions t WHERE organisation_id='082ef694-e016-4893-908c-1eef373f53af'
 UNION ALL
 SELECT 'agent_version_technical_profile_proposal_field_evidence'::text AS relation,count(*) AS row_count,
 encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text COLLATE "C"),'[]'::jsonb)::text,'UTF8')),'hex') AS row_sha256
 FROM gov_repo.agent_version_technical_profile_proposal_field_evidence t WHERE organisation_id='082ef694-e016-4893-908c-1eef373f53af'
 UNION ALL
 SELECT 'agent_version_technical_profiles'::text AS relation,count(*) AS row_count,
 encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text COLLATE "C"),'[]'::jsonb)::text,'UTF8')),'hex') AS row_sha256
 FROM gov_repo.agent_version_technical_profiles t WHERE organisation_id='082ef694-e016-4893-908c-1eef373f53af'
 UNION ALL
 SELECT 'agent_version_technical_profile_field_assertions'::text AS relation,count(*) AS row_count,
 encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text COLLATE "C"),'[]'::jsonb)::text,'UTF8')),'hex') AS row_sha256
 FROM gov_repo.agent_version_technical_profile_field_assertions t WHERE organisation_id='082ef694-e016-4893-908c-1eef373f53af'
 UNION ALL
 SELECT 'agent_version_technical_profile_field_evidence'::text AS relation,count(*) AS row_count,
 encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text COLLATE "C"),'[]'::jsonb)::text,'UTF8')),'hex') AS row_sha256
 FROM gov_repo.agent_version_technical_profile_field_evidence t WHERE organisation_id='082ef694-e016-4893-908c-1eef373f53af'
 UNION ALL
 SELECT 'agent_version_technical_profile_materializations'::text AS relation,count(*) AS row_count,
 encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text COLLATE "C"),'[]'::jsonb)::text,'UTF8')),'hex') AS row_sha256
 FROM gov_repo.agent_version_technical_profile_materializations t WHERE organisation_id='082ef694-e016-4893-908c-1eef373f53af'
 UNION ALL
 SELECT 'outbox_events'::text AS relation,count(*) AS row_count,
 encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text COLLATE "C"),'[]'::jsonb)::text,'UTF8')),'hex') AS row_sha256
 FROM gov_repo.outbox_events t WHERE organisation_id='082ef694-e016-4893-908c-1eef373f53af'
) s;
SELECT version,name,encode(sha256(convert_to(coalesce(array_to_string(statements,E'\n'),''),'UTF8')),'hex') AS statements_sha256
 FROM supabase_migrations.schema_migrations ORDER BY version;
SELECT p.oid::regprocedure::text AS signature,pg_get_userbyid(p.proowner) AS owner,
 p.prosecdef,p.proconfig,p.proacl,encode(sha256(convert_to(p.prosrc,'UTF8')),'hex') AS body_sha256
 FROM pg_proc p WHERE p.oid IN (
 to_regprocedure('gov_repo.materialize_agent_version_technical_profile(uuid,text,text,timestamptz)'),
 to_regprocedure('gov_repo.materialize_agent_version_technical_profile_governed_v1(uuid,uuid,bigint,bigint,timestamptz,text,text,timestamptz)'));
COMMIT;
