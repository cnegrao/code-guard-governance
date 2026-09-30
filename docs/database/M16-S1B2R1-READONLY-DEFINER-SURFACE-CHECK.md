# M16-S1B.2R1 — read-only target catalog check

READ-ONLY. Run by an authorised operator against a target database BEFORE deploying
`20260930160000_m16_s1b2r1_definer_capability_surface_v1.sql`; it only reads `pg_catalog`. It was never run by the
implementation slice. Any row in sections 1–3 means the migration will fail closed (or, for `gov_exec`, will revoke
application EXECUTE) and needs an architecture-owner ruling before deployment.

```sql
-- 1. Application-executable SECURITY DEFINER routines (the canonical closed surface is exactly 22).
select p.oid::regprocedure as routine, pg_get_userbyid(p.proowner) as owner, p.proacl,
       has_function_privilege('service_role', p.oid, 'EXECUTE') as service_role,
       has_function_privilege('anon', p.oid, 'EXECUTE') as anon,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated,
       exists (select 1 from pg_depend d where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e') as extension_member
from pg_proc p
where p.prosecdef and p.pronamespace not in ('pg_catalog'::regnamespace, 'information_schema'::regnamespace)
  and (has_function_privilege('service_role', p.oid, 'EXECUTE') or has_function_privilege('anon', p.oid, 'EXECUTE')
       or has_function_privilege('authenticated', p.oid, 'EXECUTE')
       or exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where a.grantee = 0 and a.privilege_type = 'EXECUTE'))
order by 1;

-- 2. Forbidden executors and quarantined noncanonical routines (gov_exec*, coding memory, M008E, credits, legacy ledger overload).
select p.oid::regprocedure as routine, pg_get_userbyid(p.proowner) as owner, p.prosecdef, p.proacl,
       has_function_privilege('service_role', p.oid, 'EXECUTE') as service_role
from pg_proc p
where p.proname in ('gov_exec', 'gov_exec_dml', 'coding_memory_search', 'log_agent_event', 'compute_cg_ag_008',
                    'get_credits', 'use_credits', 'add_credits', 'handle_new_user', 'set_graphos_updated_at', 'ledger_append')
   or (p.proname = 'update_agent_compliance_flags' and p.prosecdef)
order by 1;

-- 3. Pre-existing technical owner roles (must be absent, or exactly NOLOGIN/NOSUPERUSER/NOCREATEDB/NOCREATEROLE/
--    NOREPLICATION/NOBYPASSRLS/NOINHERIT with no memberships).
select rolname, rolcanlogin, rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls, rolinherit
from pg_roles where rolname like 'govia\_%';

-- 4. Migration runner and extension topology the corrective resolves at run time.
select current_user, r.rolsuper, r.rolcreaterole, r.rolbypassrls, current_setting('server_version_num')
from pg_roles r where r.rolname = current_user;
select extname, extnamespace::regnamespace from pg_extension where extname in ('pgcrypto', 'uuid-ossp', 'vector');
select defaclrole::regrole, defaclnamespace::regnamespace, defaclobjtype, defaclacl from pg_default_acl order by 1, 2, 3;

-- 5. Schemas where PUBLIC can CREATE (a technical owner would inherit it: the postflight then fails closed), and the
--    ACL of the pgcrypto schema pinned into the ledger search_path (only its owner may CREATE there).
select n.nspname, n.nspowner::regrole, n.nspacl from pg_namespace n
where exists (select 1 from aclexplode(coalesce(n.nspacl, acldefault('n', n.nspowner))) a where a.grantee = 0 and a.privilege_type = 'CREATE')
   or n.oid = (select extnamespace from pg_extension where extname = 'pgcrypto');
```
