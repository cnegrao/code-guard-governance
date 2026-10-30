-- GOVIA_SR2_DEPENDENCY_MANIFEST_V4. Read-only catalog query; run inside a transaction.
-- psql -X -qAt --single-transaction -v ON_ERROR_STOP=1 -f <this file>
-- No objects are installed. OIDs are used only for catalog joins, never serialized.
SET LOCAL search_path = pg_catalog, pg_temp;
SET LOCAL TimeZone = 'UTC';
SET LOCAL DateStyle = 'ISO, YMD';
SET LOCAL extra_float_digits = 3;
SET LOCAL quote_all_identifiers = off;
SET LOCAL standard_conforming_strings = on;

WITH
vector_extension AS (
 SELECT e.*, n.nspname FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace WHERE e.extname='vector'
),
-- Explicit horizon, not a wildcard: future unrelated objects cannot silently enter V4.
required_relations(name, columns) AS (VALUES
 ('organisations', ARRAY['organisation_id','is_active']::text[]),
 ('governance_users', ARRAY['user_id','organisation_id','status','password_changed_at','role_ids']),
 ('governance_roles', ARRAY['role_id','role_code','is_system_role']),
 ('technical_source_connections', ARRAY['organisation_id','connection_id','family','source_system_id','provider_code']),
 ('agents', ARRAY['organisation_id','agent_id','agent_code','name','description','agent_type','business_domain','ai_system_id','status']),
 ('ai_systems', ARRAY['organisation_id','system_id','system_code','name','status','lifecycle']),
 ('semantic_representations', NULL), ('semantic_representation_assertions', NULL),
 ('semantic_representation_evidence', NULL), ('canonical_objects', NULL), ('discovery_candidates', NULL),
 ('source_assertions', NULL), ('discovery_evidence', NULL),
 ('sr2_repositories_v1', NULL), ('sr2_snapshots_v1', NULL), ('sr2_captures_v1', NULL),
 ('sr2_manifest_entries_v1', NULL), ('sr2_chunk_locators_v1', NULL), ('sr2_symbol_locators_v1', NULL),
 ('sr2_subjects_v1', NULL), ('sr2_source_admissions_v1', NULL), ('sr2_source_sets_v1', NULL),
 ('sr2_source_set_members_v1', NULL), ('sr2_projections_v1', NULL), ('sr2_protected_projections_v1', NULL),
 ('sr2_projection_sources_v1', NULL), ('sr2_facet_collections_v1', NULL), ('sr2_module_facets_v1', NULL),
 ('sr2_service_facets_v1', NULL), ('sr2_dependency_facets_v1', NULL), ('sr2_configuration_facets_v1', NULL),
 ('sr2_summary_facets_v1', NULL), ('sr2_domain_facets_v1', NULL), ('sr2_agent_facets_v1', NULL),
 ('sr2_entrypoint_facets_v1', NULL), ('sr2_fragments_v1', NULL), ('sr2_representations_v1', NULL),
 ('sr2_disclosure_profiles_v1', NULL), ('sr2_disclosure_profile_heads_v1', NULL), ('sr2_source_admission_heads_v1', NULL),
 ('sr2_operational_agent_observations_v1', NULL), ('sr2_operational_agent_representations_v1', NULL),
 ('sr2_operational_agent_heads_v1', NULL), ('sr2_operational_disclosure_admissions_v1', NULL), ('sr2_operational_disclosure_heads_v1', NULL)
),
relations AS (
 SELECT r.columns required_columns, c.* FROM required_relations r JOIN pg_namespace n ON n.nspname='gov_repo'
 JOIN pg_class c ON c.relnamespace=n.oid AND c.relname=r.name
),
columns AS (
 SELECT a.*, c.relname FROM relations c JOIN pg_attribute a ON a.attrelid=c.oid
 WHERE a.attnum>0 AND NOT a.attisdropped AND (c.required_columns IS NULL OR a.attname=ANY(c.required_columns))
),
required_routines(identity) AS (VALUES
 ('gov_repo.semantic_context_search_v1(uuid,uuid,bigint,bigint,timestamp with time zone,__vector__.vector,text,text,text,integer,text,integer,double precision)'),
 ('gov_repo.frame_identity(text[])'),
 ('gov_repo.sr2_operational_safe_v1(text,integer)'), ('gov_repo.sr2_operational_scope_lock_v1()'),
 ('gov_repo.sr2_operational_disclosure_guard_v1()'), ('gov_repo.sr2_operational_observation_admit_v1()'),
 ('gov_repo.sr2_operational_binding_v1(gov_repo.sr2_operational_agent_observations_v1)'),
 ('gov_repo.l14_session_basis_v1(uuid,uuid,bigint,bigint,timestamp with time zone)'),
 ('gov_repo.lock_and_resolve_governance_session_eligibility_v1(uuid,uuid,bigint,bigint,timestamp with time zone)'),
 ('gov_repo.sr2_list_valid_v1(text[],integer)'), ('gov_repo.sr2_immutable_v1()'),
 ('gov_repo.sr2_repository_guard_v1()'), ('gov_repo.sr2_capture_guard_v1()'), ('gov_repo.sr2_record_time_guard_v1()'),
 ('gov_repo.sr2_manifest_lock_v1()'), ('gov_repo.sr2_manifest_integrity_v1()'),
 ('gov_repo.sr2_source_set_lock_v1()'), ('gov_repo.sr2_source_set_integrity_v1()'),
 ('gov_repo.sr2_projection_lock_v1()'), ('gov_repo.sr2_projection_integrity_v1()'),
 ('gov_repo.sr2_disclosure_head_guard_v1()'), ('gov_repo.sr2_operational_agent_head_guard_v1()'),
 ('gov_repo.technical_semantic_context_search_v1(uuid,uuid,bigint,bigint,timestamp with time zone,text,text,__vector__.vector,text,text,text,integer,text,text,integer,double precision)'),
 ('gov_repo.operational_agent_semantic_context_search_v1(uuid,uuid,bigint,bigint,timestamp with time zone,__vector__.vector,text,text,text,integer,text,text,integer,double precision)'),
 ('__vector__.vector_dims(__vector__.vector)'), ('__vector__.vector_norm(__vector__.vector)'),
 ('__vector__.l2_normalize(__vector__.vector)'),
 ('__vector__.cosine_distance(__vector__.vector,__vector__.vector)')
),
resolved_routines AS (
 SELECT r.identity, to_regprocedure(replace(r.identity,'__vector__',quote_ident(e.nspname))) routine_oid
 FROM required_routines r CROSS JOIN vector_extension e
),
-- Include the actual operator implementation even if its name/identity is changed.
cosine AS (
 SELECT o.* FROM pg_operator o CROSS JOIN vector_extension e
 WHERE o.oprnamespace=e.extnamespace AND o.oprname='<=>'
 AND o.oprleft=to_regtype(format('%I.vector',e.nspname)) AND o.oprright=o.oprleft
),
routine_oids AS (SELECT routine_oid oid FROM resolved_routines WHERE routine_oid IS NOT NULL UNION SELECT oprcode FROM cosine),
routine_rows AS (
 SELECT p.*, n.nspname, l.lanname FROM routine_oids r JOIN pg_proc p ON p.oid=r.oid
 JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_language l ON l.oid=p.prolang
),
-- Explode ACLs so OIDs and catalog/insertion order never become evidence.
acl_sources(kind, identity, acl) AS (
 SELECT 'relation', 'gov_repo.'||c.relname, c.relacl FROM relations c UNION ALL
 SELECT 'routine', p.oid::regprocedure::text, p.proacl FROM routine_rows p UNION ALL
 SELECT 'column', 'gov_repo.'||a.relname||'.'||a.attname, a.attacl FROM columns a UNION ALL
 SELECT 'schema', n.nspname::text, n.nspacl FROM pg_namespace n
 WHERE n.nspname='gov_repo' OR n.oid=(SELECT extnamespace FROM vector_extension)
),
acl_rows AS (
 SELECT s.kind,s.identity, CASE WHEN s.acl IS NULL THEN NULL ELSE coalesce((
  SELECT jsonb_agg(jsonb_build_object('grantor',pg_get_userbyid(a.grantor),
   'grantee',CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END,
   'privilege',a.privilege_type,'grantable',a.is_grantable)
   ORDER BY pg_get_userbyid(a.grantor) COLLATE "C",
    (CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END) COLLATE "C",
    a.privilege_type COLLATE "C", a.is_grantable)
  FROM aclexplode(nullif(s.acl,'{}'::aclitem[])) a),'[]'::jsonb) END acl FROM acl_sources s
),
-- Explicitly represent absence of global/per-schema defaults, including built-in fallback.
default_scopes AS (
 SELECT 0::oid namespace_oid, '__global__'::text schema UNION ALL
 SELECT n.oid,n.nspname::text FROM pg_namespace n WHERE n.nspname='gov_repo'
 OR n.oid=(SELECT extnamespace FROM vector_extension)
),
default_rows AS (
 SELECT s.schema,k.kind,d.oid IS NOT NULL present,
 (SELECT coalesce(jsonb_agg(jsonb_build_object('grantor',pg_get_userbyid(a.grantor),
  'grantee',CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END,
  'privilege',a.privilege_type,'grantable',a.is_grantable)
  ORDER BY pg_get_userbyid(a.grantor) COLLATE "C",
   (CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END) COLLATE "C",
   a.privilege_type COLLATE "C",a.is_grantable),'[]'::jsonb)
 FROM aclexplode(nullif(coalesce(d.defaclacl,CASE WHEN s.namespace_oid=0 THEN acldefault((CASE WHEN k.kind='S' THEN 's' ELSE k.kind END)::"char",'postgres'::regrole)
  ELSE NULL::aclitem[] END),'{}'::aclitem[])) a) acl
 FROM default_scopes s CROSS JOIN (VALUES ('r'),('S'),('f'),('T'),('n')) k(kind)
 LEFT JOIN pg_default_acl d ON d.defaclrole='postgres'::regrole AND d.defaclnamespace=s.namespace_oid AND d.defaclobjtype=k.kind::"char"
 WHERE k.kind<>'n' OR s.namespace_oid=0
),
document AS (
 SELECT jsonb_build_object(
 'manifest','GOVIA_SR2_DEPENDENCY_MANIFEST_V4',
 'horizon',jsonb_build_object('canonical_migrations',109,'through','20261029195734_m175_pre_a4_m3_a3_binding_disclosure_v1.sql'),
 'runtime',(SELECT jsonb_build_object('encoding',pg_encoding_to_char(d.encoding),'collation',d.datcollate,'ctype',d.datctype,
   'locale_provider',to_jsonb(d)->>'datlocprovider','locale',to_jsonb(d)->>'datlocale',
   'icu_locale',to_jsonb(d)->>'daticulocale','icu_rules',to_jsonb(d)->>'daticurules',
   'collation_version',d.datcollversion,'actual_collation_version',pg_database_collation_actual_version(d.oid),
   'postgres_major',current_setting('server_version_num')::integer/10000)
   FROM pg_database d WHERE d.datname=current_database()),
 'missing',(SELECT coalesce(jsonb_agg(identity ORDER BY identity COLLATE "C"),'[]'::jsonb) FROM (
  SELECT 'gov_repo.'||r.name identity FROM required_relations r WHERE NOT EXISTS(SELECT FROM relations c WHERE c.relname=r.name)
  UNION ALL SELECT 'gov_repo.'||r.name||'.'||a.name FROM required_relations r CROSS JOIN LATERAL unnest(r.columns) a(name)
   WHERE NOT EXISTS(SELECT FROM columns c WHERE c.relname=r.name AND c.attname=a.name)
  UNION ALL SELECT identity FROM resolved_routines WHERE routine_oid IS NULL
  UNION ALL SELECT '__vector__.<=>' WHERE NOT EXISTS(SELECT FROM cosine)
  UNION ALL SELECT 'extension.vector' WHERE NOT EXISTS(SELECT FROM vector_extension)) missing),
 'routines',(SELECT jsonb_agg(jsonb_build_object(
  'identity',p.oid::regprocedure::text,'owner',pg_get_userbyid(p.proowner),'language',p.lanname,'kind',p.prokind,
  'body_sha256',encode(sha256(convert_to(replace(replace(replace(replace(replace(p.prosrc,chr(13),''),
   quote_ident(e.nspname)||'.vector','__vector__.vector'),quote_ident(e.nspname)||'.l2_normalize','__vector__.l2_normalize'),
   quote_ident(e.nspname)||'.cosine_distance','__vector__.cosine_distance'),quote_ident(e.nspname)||'.<=>','__vector__.<=>'),'UTF8')),'hex'),
  'binary',p.probin,'sql_body',CASE WHEN p.prosqlbody IS NULL THEN NULL ELSE pg_get_function_sqlbody(p.oid) END,
  'config',(SELECT jsonb_agg(value ORDER BY value COLLATE "C") FROM unnest(p.proconfig) value),
  'acl',(SELECT a.acl FROM acl_rows a WHERE a.kind='routine' AND a.identity=p.oid::regprocedure::text),
  'security_definer',p.prosecdef,'volatility',p.provolatile,'parallel',p.proparallel,'strict',p.proisstrict,'leakproof',p.proleakproof,
  'result',pg_get_function_result(p.oid),'returns_set',p.proretset,'arguments',pg_get_function_arguments(p.oid),
  'identity_arguments',pg_get_function_identity_arguments(p.oid),'argument_names',p.proargnames,'argument_modes',p.proargmodes,
  'default_count',p.pronargdefaults,'defaults',pg_get_expr(p.proargdefaults,0),
  'variadic_type',CASE WHEN p.provariadic=0 THEN NULL ELSE format_type(p.provariadic,NULL) END,
  'support',CASE WHEN p.prosupport=0 THEN NULL ELSE p.prosupport::regprocedure::text END)
  ORDER BY replace(replace(replace(replace(p.oid::regprocedure::text,quote_ident(e.nspname)||'.vector','__vector__.vector'),
   quote_ident(e.nspname)||'.l2_normalize','__vector__.l2_normalize'),quote_ident(e.nspname)||'.cosine_distance','__vector__.cosine_distance'),
   quote_ident(e.nspname)||'.<=>','__vector__.<=>') COLLATE "C") FROM routine_rows p CROSS JOIN vector_extension e),
 'relations',(SELECT jsonb_agg(jsonb_build_object(
  'identity','gov_repo.'||c.relname,'kind',c.relkind,'persistence',c.relpersistence,
  'rewrite_rules',(SELECT coalesce(jsonb_agg(jsonb_build_object('name',r.rulename,'enabled',r.ev_enabled,
   'instead',r.is_instead,'definition',pg_get_ruledef(r.oid,false)) ORDER BY r.rulename::text COLLATE "C"),'[]'::jsonb)
   FROM pg_rewrite r WHERE r.ev_class=c.oid),
  'parents',(SELECT coalesce(jsonb_agg(jsonb_build_object('identity',format('%I.%I',n.nspname,p.relname),'sequence',i.inhseqno)
    ORDER BY n.nspname::text COLLATE "C",p.relname::text COLLATE "C",i.inhseqno),'[]'::jsonb)
    FROM pg_inherits i JOIN pg_class p ON p.oid=i.inhparent JOIN pg_namespace n ON n.oid=p.relnamespace WHERE i.inhrelid=c.oid),
  'children',(SELECT coalesce(jsonb_agg(jsonb_build_object('identity',format('%I.%I',n.nspname,p.relname),'sequence',i.inhseqno)
    ORDER BY n.nspname::text COLLATE "C",p.relname::text COLLATE "C",i.inhseqno),'[]'::jsonb)
    FROM pg_inherits i JOIN pg_class p ON p.oid=i.inhrelid JOIN pg_namespace n ON n.oid=p.relnamespace WHERE i.inhparent=c.oid),'owner',pg_get_userbyid(c.relowner),
  'rls',c.relrowsecurity,'force_rls',c.relforcerowsecurity,
  'acl',(SELECT a.acl FROM acl_rows a WHERE a.kind='relation' AND a.identity='gov_repo.'||c.relname),
  'columns',(SELECT jsonb_agg(jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),
   'not_null',a.attnotnull,'collation',CASE WHEN a.attcollation=0 THEN NULL ELSE format('%I.%I',n.nspname,co.collname) END,
   'default',pg_get_expr(d.adbin,d.adrelid),'identity',a.attidentity,'generated',a.attgenerated,
   'acl',(SELECT ar.acl FROM acl_rows ar WHERE ar.kind='column' AND ar.identity='gov_repo.'||c.relname||'.'||a.attname))
   ORDER BY a.attname::text COLLATE "C") FROM columns a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
   LEFT JOIN pg_collation co ON co.oid=a.attcollation LEFT JOIN pg_namespace n ON n.oid=co.collnamespace WHERE a.attrelid=c.oid),
  'constraints',(SELECT coalesce(jsonb_agg(jsonb_build_object('name',k.conname,'type',k.contype,'definition',pg_get_constraintdef(k.oid,false),
   'validated',k.convalidated,'deferrable',k.condeferrable,'deferred',k.condeferred,'no_inherit',k.connoinherit)
   ORDER BY k.conname::text COLLATE "C"),'[]'::jsonb) FROM pg_constraint k WHERE k.conrelid=c.oid
   AND (c.required_columns IS NULL OR EXISTS(SELECT FROM columns a WHERE a.attrelid=c.oid AND a.attnum=ANY(k.conkey)))),
  'indexes',(SELECT coalesce(jsonb_agg(jsonb_build_object('name',ic.relname,'definition',pg_get_indexdef(i.indexrelid),
   'valid',i.indisvalid,'ready',i.indisready,'unique',i.indisunique,'primary',i.indisprimary)
   ORDER BY ic.relname::text COLLATE "C"),'[]'::jsonb) FROM pg_index i JOIN pg_class ic ON ic.oid=i.indexrelid
   WHERE i.indrelid=c.oid AND c.required_columns IS NULL),
  'triggers',(SELECT coalesce(jsonb_agg(jsonb_build_object('name',t.tgname,'enabled',t.tgenabled,
   'function',t.tgfoid::regprocedure::text,'definition',pg_get_triggerdef(t.oid,false)) ORDER BY t.tgname::text COLLATE "C"),'[]'::jsonb)
   FROM pg_trigger t WHERE t.tgrelid=c.oid AND NOT t.tgisinternal),
  'policy_count',(SELECT count(*) FROM pg_policy p WHERE p.polrelid=c.oid)) ORDER BY c.relname::text COLLATE "C") FROM relations c),
 'enums',(SELECT jsonb_agg(jsonb_build_object('identity',format('%I.%I',n.nspname,t.typname),
  'labels',(SELECT jsonb_agg(e.enumlabel ORDER BY e.enumsortorder) FROM pg_enum e WHERE e.enumtypid=t.oid))
  ORDER BY n.nspname::text COLLATE "C",t.typname::text COLLATE "C") FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace
  WHERE t.typtype='e' AND t.oid IN (SELECT atttypid FROM columns)),
 'schemas',(SELECT jsonb_agg(jsonb_build_object('identity',CASE WHEN n.oid=e.extnamespace THEN '__vector__' ELSE n.nspname END,
  'owner',pg_get_userbyid(n.nspowner),'acl',(SELECT a.acl FROM acl_rows a WHERE a.kind='schema' AND a.identity=n.nspname),
  'create_capability',(SELECT jsonb_agg(jsonb_build_object('role',r.name,'create',has_schema_privilege(r.name,n.oid,'CREATE'))
   ORDER BY r.name COLLATE "C") FROM (VALUES ('postgres'),('anon'),('authenticated'),('service_role')) r(name)),
  'public_create',EXISTS(SELECT FROM aclexplode(coalesce(n.nspacl,acldefault('n',n.nspowner))) a WHERE a.grantee=0 AND a.privilege_type='CREATE'))
  ORDER BY (CASE WHEN n.oid=e.extnamespace THEN '__vector__' ELSE n.nspname END) COLLATE "C") FROM pg_namespace n CROSS JOIN vector_extension e
  WHERE n.nspname='gov_repo' OR n.oid=e.extnamespace),
 'vector',(SELECT jsonb_build_object('version',e.extversion,'schema','__vector__','relocatable',e.extrelocatable,
  'cosine_operator',(SELECT jsonb_build_object('identity','__vector__.<=>',
   'left',format_type(o.oprleft,NULL),'right',format_type(o.oprright,NULL),'result',format_type(o.oprresult,NULL),
   'implementation',o.oprcode::regprocedure::text,'commutator',CASE WHEN o.oprcom=0 THEN NULL ELSE o.oprcom::regoperator::text END,
   'negator',CASE WHEN o.oprnegate=0 THEN NULL ELSE o.oprnegate::regoperator::text END,'can_hash',o.oprcanhash,'can_merge',o.oprcanmerge) FROM cosine o)) FROM vector_extension e),
 'default_acls',(SELECT jsonb_agg(jsonb_build_object('owner','postgres',
  'schema',CASE WHEN d.schema=(SELECT nspname FROM vector_extension) THEN '__vector__' ELSE d.schema END,
  'kind',d.kind,'explicit',d.present,'acl',d.acl)
  ORDER BY (CASE WHEN d.schema=(SELECT nspname FROM vector_extension) THEN '__vector__' ELSE d.schema END) COLLATE "C",d.kind COLLATE "C") FROM default_rows d)
 ) value
),
normalized AS (
 -- Normalize only required vector identifiers. Unrelated public.uuid_generate_v4, etc. retain their real identity.
 SELECT replace(replace(replace(replace(d.value::text,quote_ident(e.nspname)||'.vector','__vector__.vector'),
  quote_ident(e.nspname)||'.l2_normalize','__vector__.l2_normalize'),quote_ident(e.nspname)||'.cosine_distance','__vector__.cosine_distance'),
  quote_ident(e.nspname)||'.<=>','__vector__.<=>')::jsonb document FROM document d CROSS JOIN vector_extension e
)
SELECT jsonb_build_object('document',document,'sha256',encode(sha256(convert_to(document::text,'UTF8')),'hex'))::text FROM normalized;
