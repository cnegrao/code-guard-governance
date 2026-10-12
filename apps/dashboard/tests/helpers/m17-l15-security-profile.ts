/**
 * M17-S0 L15 privilege / ACL harness profile (ADR-GOVIA-RISK-INTELLIGENCE-v1 §24; O59-O62 framework). Every later M17 slice
 * that creates an L15 object (gov_repo.l15_*) runs this checker in its postflight test; it must return no violation.
 *
 * Classes checked over every gov_repo.l15_* object, for each application role (service_role, authenticated, anon):
 *  - TABLE_PRIVILEGE: SELECT / INSERT / UPDATE / DELETE / TRUNCATE / REFERENCES / TRIGGER / MAINTAIN on any relation;
 *  - COLUMN_PRIVILEGE: any column-level SELECT / INSERT / UPDATE / REFERENCES;
 *  - SEQUENCE_PRIVILEGE: USAGE / SELECT / UPDATE;
 *  - PUBLIC_GRANT: an explicit or default PUBLIC entry on a relation or routine;
 *  - ROUTINE_EXECUTE: application EXECUTE on an l15 routine that is not an approved RPC of the inventory;
 *  - DEFINER_NOT_INVENTORIED: an l15 SECURITY DEFINER routine missing from the inventory, or differing in owner / body hash /
 *    config (the definer-capability surface rule);
 *  - ROUTINE_SEARCH_PATH: an l15 routine whose search_path is not pinned to pg_catalog, pg_temp;
 *  - NO_IMMUTABILITY: an l15 history table (every table except *_heads) without ENABLE ALWAYS raising BEFORE UPDATE OR DELETE
 *    and BEFORE TRUNCATE triggers;
 *  - CASCADE_FK: any FK action that would rewrite or erase an l15 row (CASCADE / SET NULL / SET DEFAULT);
 *  - INHERITANCE: an l15 relation in an inheritance tree.
 * has_*_privilege resolves membership, inherited and default grants (incl. the broad 20260818013113 defaults).
 */
export interface DefinerInventoryEntry { readonly sig: string; readonly owner: string; readonly sha: string; readonly cfg: string }

const lit = (value: string) => `'${value.replace(/'/g, "''")}'`;

export function l15SecurityViolationsSql(inventory: readonly DefinerInventoryEntry[] = [], approvedRpcs: readonly string[] = []): string {
  const inv = inventory.length
    ? `(values ${inventory.map(e => `(${lit(e.sig)}, ${lit(e.owner)}, ${lit(e.sha)}, ${lit(e.cfg)})`).join(', ')}) as i(sig, owner_role, sha, cfg)`
    : `(select null::text as sig, null::text as owner_role, null::text as sha, null::text as cfg where false) as i`;
  const approved = approvedRpcs.length ? `array[${approvedRpcs.map(lit).join(',')}]::text[]` : `array[]::text[]`;
  return `with app(r) as (values ('service_role'), ('authenticated'), ('anon')),
  rels as (select c.oid, c.relname::text as relname, c.relkind, c.relowner, c.relacl from pg_catalog.pg_class as c
           where c.relnamespace = 'gov_repo'::regnamespace and c.relname like 'l15\\_%' escape '\\' and c.relkind <> 'i'),
  procs as (select p.oid, p.oid::regprocedure::text as sig, p.prosecdef, p.proowner, p.prosrc, p.proconfig, p.proacl from pg_catalog.pg_proc as p
            where p.pronamespace = 'gov_repo'::regnamespace and p.proname like 'l15\\_%' escape '\\'),
  inv as (select * from ${inv}),
  v(v) as (
    select 'TABLE_PRIVILEGE ' || app.r || ' ' || pr || ' ' || rels.relname from rels cross join app
      cross join unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN']) as pr
      where rels.relkind in ('r','p','v','m','f') and pg_catalog.has_table_privilege(app.r, rels.oid, pr)
    union all select 'COLUMN_PRIVILEGE ' || app.r || ' ' || rels.relname from rels cross join app
      where rels.relkind in ('r','p','v','m','f') and pg_catalog.has_any_column_privilege(app.r, rels.oid, 'SELECT, INSERT, UPDATE, REFERENCES')
    union all select 'SEQUENCE_PRIVILEGE ' || app.r || ' ' || pr || ' ' || rels.relname from rels cross join app
      cross join unnest(array['USAGE','SELECT','UPDATE']) as pr
      where rels.relkind = 'S' and pg_catalog.has_sequence_privilege(app.r, rels.oid, pr)
    union all select 'PUBLIC_GRANT ' || rels.relname from rels
      where exists (select 1 from pg_catalog.aclexplode(coalesce(rels.relacl,
                    pg_catalog.acldefault(case when rels.relkind = 'S' then 's'::"char" else 'r'::"char" end, rels.relowner))) as a
                    where a.grantee = 0)
    union all select 'PUBLIC_GRANT ' || procs.sig from procs
      where exists (select 1 from pg_catalog.aclexplode(coalesce(procs.proacl, pg_catalog.acldefault('f'::"char", procs.proowner))) as a
                    where a.grantee = 0)
    union all select 'ROUTINE_EXECUTE ' || app.r || ' ' || procs.sig from procs cross join app
      where pg_catalog.has_function_privilege(app.r, procs.oid, 'EXECUTE') and procs.sig <> all (${approved})
    union all select 'DEFINER_NOT_INVENTORIED ' || procs.sig from procs
      where procs.prosecdef and not exists (select 1 from inv
        where inv.sig = procs.sig and inv.owner_role = pg_catalog.pg_get_userbyid(procs.proowner)
          and inv.sha = pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(procs.prosrc, 'UTF8')), 'hex')
          and inv.cfg = coalesce(pg_catalog.array_to_string(procs.proconfig, ';'), '-'))
    union all select 'ROUTINE_SEARCH_PATH ' || procs.sig from procs
      where not exists (select 1 from pg_catalog.unnest(coalesce(procs.proconfig, array[]::text[])) as cfg
                        where cfg = 'search_path=pg_catalog, pg_temp')
    union all select 'NO_IMMUTABILITY ' || rels.relname from rels
      where rels.relkind in ('r','p') and rels.relname !~ '_heads$' and not (
        exists (select 1 from pg_catalog.pg_trigger as t where t.tgrelid = rels.oid and not t.tgisinternal and t.tgenabled = 'A'
                and (t.tgtype & 2) <> 0 and (t.tgtype & 8) <> 0 and (t.tgtype & 16) <> 0)
        and exists (select 1 from pg_catalog.pg_trigger as t where t.tgrelid = rels.oid and not t.tgisinternal and t.tgenabled = 'A'
                    and (t.tgtype & 2) <> 0 and (t.tgtype & 32) <> 0))
    union all select 'CASCADE_FK ' || k.conname::text from pg_catalog.pg_constraint as k join rels on rels.oid = k.confrelid
      where k.contype = 'f' and (k.confdeltype in ('c','n','d') or k.confupdtype in ('c','n','d'))
    union all select 'INHERITANCE ' || rels.relname from rels
      where exists (select 1 from pg_catalog.pg_inherits as h where rels.oid in (h.inhrelid, h.inhparent)))
  select coalesce(pg_catalog.json_agg(v order by v), '[]') from v;`;
}
