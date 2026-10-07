import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { s2Cluster, s2Source, literal as q, TABLES, RAW } from '../helpers/discovery-machine-s2-fixtures';

test('Discovery Machine S2 control plane on historical PG17 R3 baseline', { timeout: 1_800_000 }, async t => {
  const pg = await s2Cluster(message => t.diagnostic(message));
  t.after(() => pg.stop());
  const { owner, bootstrapSql: root, login, loginSession } = pg;
  const read = root; // Fixture inspections use the isolated bootstrap; never a simulated machine identity.
  let serial = 0;
  const org = randomUUID();
  await owner(`insert into gov_repo.organisations(organisation_id,org_code,legal_name,display_name,country_code,is_active)
    values('${org}','S2','S2','S2','BR',true)`);
  const createPrincipal = () => owner(`select gov_repo.machine_provision_principal_v1('s2_${++serial}','test','test setup','S2')`);
  const principal = await createPrincipal();
  const connection = (locator: string) => q(`source-connection:${createHash('sha256').update(`github:${locator}`).digest('hex').slice(0,32)}`);
  const bindingSql = (p = principal, locator = 'Acme/Policy-Repo', ref = 'main', orgId = org) =>
    `select gov_repo.machine_provision_binding_v1('${p}','${orgId}','github',${q(locator)},${q(locator.toLowerCase())},
    ${connection(locator)},'123',${q(ref)},'github','1.0',true,false,'setup','S2')`;
  const createLogin = async () => {
    const name = `s2_login_${++serial}`;
    await owner(`create role ${name} login nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
      grant govia_discovery_machine_caller to ${name} with inherit true, set true`);
    return name;
  };
  const register = (p: string, role: string, until = "clock_timestamp()+interval '1 hour'") => owner(
    `select gov_repo.machine_register_generation_v1('${p}',${q(role)},clock_timestamp()-interval '1 minute',${until},'setup','S2')`);
  const activate = (id: string) => owner(`select gov_repo.machine_set_generation_state_v1('${id}','CURRENT','rotate','S2')`);
  const change = (id: string, rev: number, state: string, intake = true, propose = false) =>
    `select gov_repo.machine_change_binding_v1('${id}',${rev},${q(state)},${intake},${propose},'change','S2')`;
  const binding = await owner(bindingSql());
  await owner('create role s2_public_only login; grant usage on schema gov_repo to s2_public_only');
  const machine = await createLogin();
  const generation = await register(principal,machine);
  await activate(generation);

  await t.test('schema, NOLOGIN ownership, effective ACLs, sequences and closed routine census', async () => {
    assert.equal(await read(`select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='gov_repo' and c.relkind='S' and c.relname like 'machine_%'`), '0', 'UUIDs require no sequence grants');
    assert.equal(await read(`select count(*) from pg_roles where rolname like 'govia_discovery_%' and
      (rolcanlogin or rolsuper or rolcreatedb or rolcreaterole or rolreplication or rolbypassrls)`),'0');
    const census = JSON.parse(await read(`select json_agg(json_build_object('name',p.proname,'signature',p.oid::regprocedure::text,'definer',p.prosecdef,
      'owner',pg_get_userbyid(p.proowner),'config',p.proconfig,'bodyHash',encode(sha256(convert_to(p.prosrc,'UTF8')),'hex'),
      'hash',encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')) order by p.proname)
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='gov_repo' and p.proname like 'machine_%'`));
    assert.equal(census.length,14); assert.equal(census.filter((p: {definer:boolean}) => p.definer).length,7);
    const expected = [
      'machine_change_binding_v1(uuid,bigint,text,boolean,boolean,text,text)',
      'machine_control_guard_v1()', 'machine_lock_eligibility_v1(uuid,bigint)', 'machine_no_mutation_v1()',
      'machine_normalized_locator_v1(text)', 'machine_provision_binding_v1(uuid,uuid,text,text,text,text,text,text,text,text,boolean,boolean,text,text)',
      'machine_provision_principal_v1(text,text,text,text)', 'machine_record_revision_v1()',
      'machine_register_generation_v1(uuid,text,timestamp with time zone,timestamp with time zone,text,text)',
      'machine_require_provisioner_v1()', 'machine_role_safe_v1(oid,text)', 'machine_set_generation_state_v1(uuid,text,text,text)',
      'machine_set_principal_state_v1(uuid,text,text,text)', 'machine_source_connection_id_v1(text,text)',
    ].map(s=>`gov_repo.${s}`).sort();
    assert.deepEqual(census.map((p: {signature:string})=>p.signature).sort(),expected);
    for(const part of s2Source().split('CREATE FUNCTION gov_repo.').slice(1)) {
      const name=part.slice(0,part.indexOf('(')), body=part.match(/AS \$fn\$([\s\S]*?)\$fn\$;/)?.[1];
      if(body) assert.equal(census.find((p: {name:string})=>p.name===name).bodyHash,createHash('sha256').update(body).digest('hex'),name);
    }
    for (const p of census) { assert.equal(p.owner,'govia_discovery_control_owner'); assert.ok(p.config.includes('search_path=pg_catalog, pg_temp')); assert.match(p.hash,/^[a-f0-9]{64}$/); }
    const roles = ['anon','authenticated','service_role',machine,'govia_discovery_provisioner','govia_discovery_machine_caller',
      'govia_ledger_executor','govia_runtime_executor','govia_legacy_read_executor','govia_legacy_graph_executor'];
    for (const role of roles) for (const table of TABLES) assert.equal(await read(`select has_table_privilege(${q(role)},'gov_repo.${table}',
      'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN') or has_any_column_privilege(${q(role)},'gov_repo.${table}','SELECT,INSERT,UPDATE,REFERENCES')`),'f',`${role}/${table}`);
    assert.equal(await read(`select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace,
      lateral aclexplode(c.relacl) a where n.nspname='gov_repo' and c.relname like 'machine_%' and a.grantee=0`),'0');
    assert.equal(await read(`select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace,
      lateral aclexplode(p.proacl) a where n.nspname='gov_repo' and p.proname like 'machine_%' and a.grantee=0`),'0');
    for (const role of ['anon','authenticated','service_role','s2_public_only',machine]) {
      for (const table of TABLES) for (const sql of [`select * from gov_repo.${table}`,`delete from gov_repo.${table}`,`truncate gov_repo.${table}`])
        await assert.rejects(login(sql,role),/42501/);
      await assert.rejects(login(`insert into gov_repo.machine_execution_bindings default values`,role),/42501/);
      await assert.rejects(login(`update gov_repo.machine_credential_generations set state='CURRENT'`,role),/42501/);
      await assert.rejects(login(`select gov_repo.machine_provision_principal_v1('evil','test','evil','S2')`,role),/42501/);
      await assert.rejects(login(`select * from gov_repo.machine_lock_eligibility_v1('${binding}',1)`,role),/42501/);
      await assert.rejects(login(`create table gov_repo.s2_evil(id int)`,role),/42501/);
      for (const target of ['govia_discovery_control_owner','govia_discovery_audit_owner','govia_discovery_provisioner'])
        await assert.rejects(login(`set role ${target}`,role),/42501/);
    }
    for (const target of ['service_role','authenticated','anon','govia_runtime_executor']) await assert.rejects(login(`set role ${target}`,machine),/42501/);
    t.diagnostic(`Machine routine census: ${JSON.stringify(census)}`);
  });

  await t.test('principal workload/environment and generated identity are immutable', async () => {
    const row=JSON.parse(await read(`select to_jsonb(p) from gov_repo.machine_principals p where principal_id='${principal}'`));
    assert.equal(row.workload_kind,'GOVERNED_DISCOVERY'); assert.equal(row.environment,'test'); assert.equal(row.state,'ENABLED');
    for(const assignment of ["principal_id=gen_random_uuid()","principal_code='retarget'","environment='production'","workload_kind='HUMAN'"])
      await assert.rejects(root(`update gov_repo.machine_principals set ${assignment} where principal_id='${principal}'`),/S2_PRINCIPAL_IMMUTABLE/);
    await assert.rejects(owner(`select gov_repo.machine_provision_principal_v1('missing_env','','bad','S2')`),/23514/);
    const supplied=randomUUID();
    const generated=await root(`insert into gov_repo.machine_principals(principal_id,principal_code,environment,administered_by,reason,reference)
      values('${supplied}','s2_generated','test','untrusted value','test','S2') returning principal_id`);
    assert.notEqual(generated,supplied);
    const suppliedBinding=randomUUID();
    const generatedBinding=await root(`insert into gov_repo.machine_execution_bindings(binding_id,principal_id,organisation_id,source_connection_id,
      provider,configured_locator,normalized_locator,authorized_ref,adapter_name,adapter_version,administered_by,reason,reference)
      values('${suppliedBinding}','${principal}','${org}',${connection('acme/generated')},'github','acme/generated','acme/generated','main','github','1.0','x','test','S2') returning binding_id`);
    assert.notEqual(generatedBinding,suppliedBinding);
  });

  await t.test('technical-owner default privileges and sequence closure; trusted provisioning LOGIN only', async () => {
    const defaults=JSON.parse(await read(`select coalesce(json_agg(json_build_object('creator',pg_get_userbyid(d.defaclrole),
      'schema',d.defaclnamespace::regnamespace::text,'type',d.defaclobjtype,'acl',d.defaclacl::text)),'[]') from pg_default_acl d
      where pg_get_userbyid(d.defaclrole) in ('postgres','govia_discovery_control_owner','govia_discovery_audit_owner')`));
    assert.ok(defaults.some((d: {creator:string;type:string;acl:string})=>d.creator==='postgres' && d.type==='r' && d.acl.includes('service_role')));
    assert.equal(await read(`select count(*) from pg_default_acl d,lateral aclexplode(d.defaclacl) a
      where pg_get_userbyid(d.defaclrole) in ('govia_discovery_control_owner','govia_discovery_audit_owner')
      and (a.grantee=0 or pg_get_userbyid(a.grantee) in ('anon','authenticated','service_role'))`),'0');
    t.diagnostic(`S2 creator/owner pg_default_acl: ${JSON.stringify(defaults)}`);
    for(const role of ['govia_discovery_control_owner','govia_discovery_audit_owner']) {
      assert.equal(await root(`begin; grant create on schema gov_repo to ${role}; set role ${role};
        create table gov_repo.s2_default_probe(id bigint generated always as identity);
        create function gov_repo.s2_default_function() returns integer language sql as 'select 1'; reset role;
        select count(*) from pg_roles r where r.rolname in ('anon','authenticated','service_role',${q(machine)}) and
          (has_table_privilege(r.oid,'gov_repo.s2_default_probe','SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
          or has_sequence_privilege(r.oid,'gov_repo.s2_default_probe_id_seq','SELECT,USAGE,UPDATE')
          or has_function_privilege(r.oid,'gov_repo.s2_default_function()','EXECUTE')); rollback`),'0');
    }
    await owner(`create role s2_trusted_provisioning login; grant govia_discovery_provisioner to s2_trusted_provisioning with inherit true, set true`);
    const id=await login(`select gov_repo.machine_provision_principal_v1('s2_oob','test','ticket approved','S2-ADMIN')`,'s2_trusted_provisioning');
    assert.equal(await read(`select administered_by from gov_repo.machine_principals where principal_id='${id}'`),'s2_trusted_provisioning');
    await assert.rejects(login(`insert into gov_repo.machine_principals default values`,'s2_trusted_provisioning'),/42501/);
    await owner(`create role s2_untrusted_provisioning login; grant usage on schema gov_repo to s2_untrusted_provisioning`);
    await root(`grant execute on function gov_repo.machine_provision_principal_v1(text,text,text,text) to s2_untrusted_provisioning`);
    await assert.rejects(login(`select gov_repo.machine_provision_principal_v1('s2_fake','test','bad','S2')`,'s2_untrusted_provisioning'),/S2_TRUSTED_PROVISIONING_REQUIRED/);
    await root(`revoke execute on function gov_repo.machine_provision_principal_v1(text,text,text,text) from s2_untrusted_provisioning`);
  });

  await t.test('S1 golden source identities, configured casing, locator and ref validation', async () => {
    const vectors = JSON.parse(readFileSync(new URL('../../../../packages/governance-review/test/fixtures/discovery-machine-identity-vectors.json',import.meta.url),'utf8'));
    for (const v of [...vectors.githubSourceConnections,...vectors.otherDescriptors]) {
      assert.equal(await read(`select gov_repo.machine_source_connection_id_v1(${q(v.providerCode)},${q(v.configuredLocator ?? v.displayName)})`),v.sourceConnectionId);
      if (v.normalizedLocator) assert.equal(await read(`select gov_repo.machine_normalized_locator_v1(${q(v.configuredLocator)})`),v.normalizedLocator);
    }
    for (const locator of ['acme/.','acme/..','acme/repo.git','acme/repo.GIT','-acme/repo','acme-/repo','a_b/r','acme/r/extra','a//b',' a/b','a/b\n','https://a/b','аcme/repo',`${'a'.repeat(40)}/r`,`a/${'r'.repeat(101)}`])
      await assert.rejects(read(`select gov_repo.machine_normalized_locator_v1(${q(locator)})`),/S2_SOURCE_INVALID/);
    for (const ref of ['',' main','main ','main\n','\tmain','main\u0080','\u00a0main','main\u3000']) await assert.rejects(owner(bindingSql(principal,'acme/other',ref)),/23514/);
    await assert.rejects(owner(bindingSql().replace("'github','Acme/Policy-Repo'","'gitlab','Acme/Policy-Repo'")),/23514/);
    await assert.rejects(owner(bindingSql().replace("'acme/policy-repo'","'wrong/repo'")),/23514/);
    await assert.rejects(owner(bindingSql().replace(connection('Acme/Policy-Repo'),connection('acme/policy-repo'))),/23514/);
  });

  await t.test('immutable identity, disabled uniqueness, distinct refs and concurrent case aliases', async () => {
    await assert.rejects(owner(bindingSql()),/23505/);
    await assert.rejects(owner(bindingSql(principal,'acme/policy-repo')),/23505/);
    const otherRef = await owner(bindingSql(principal,'Acme/Policy-Repo','Main'));
    assert.notEqual(otherRef,binding);
    const otherPrincipal = await createPrincipal();
    assert.notEqual(await owner(bindingSql(otherPrincipal)),binding);
    assert.equal(await owner(change(otherRef,1,'DISABLED')),'2');
    await assert.rejects(owner(bindingSql(principal,'ACME/POLICY-REPO','Main')),/23505/);
    const results = await Promise.allSettled([owner(bindingSql(principal,'Race/Repo')),owner(bindingSql(principal,'race/repo'))]);
    assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
    assert.match(String((results.find(r=>r.status==='rejected') as PromiseRejectedResult).reason),/23505/);
    for (const field of ["principal_id=gen_random_uuid()","authorised_ref='evil'".replace('authorised','authorized'),"provider_source_id='456'","binding_id=gen_random_uuid()","binding_revision=0"])
      await assert.rejects(root(`update gov_repo.machine_execution_bindings set ${field} where binding_id='${binding}'`),/S2_BINDING_IMMUTABLE/);
    assert.equal(await owner(change(otherRef,2,'REVOKED')),'3');
    await assert.rejects(owner(change(otherRef,3,'ENABLED')),/S2_BINDING_IMMUTABLE/);
    await assert.rejects(root(`delete from gov_repo.machine_execution_bindings where binding_id='${otherRef}'`),/S2_APPEND_ONLY/);
    const replacement = await owner(bindingSql(principal,'Acme/Policy-Repo','Main'));
    assert.notEqual(replacement,otherRef);
    assert.equal(await read(`select binding_revision from gov_repo.machine_execution_bindings where binding_id='${replacement}'`),'1');
    assert.equal(await read(`select string_agg(binding_revision::text,',' order by binding_revision) from gov_repo.machine_binding_revisions where binding_id='${otherRef}'`),'1,2,3');
    assert.equal(await read(`select snapshot->>'state' from gov_repo.machine_binding_revisions where binding_id='${otherRef}' and binding_revision=3`),'REVOKED');
    await assert.rejects(owner(change(replacement,0,'DISABLED')),/S2_BINDING_REVISION_STALE/);
  });

  await t.test('history and invocation audit deny UPDATE DELETE TRUNCATE even as maintenance owner', async () => {
    await root(`insert into gov_repo.machine_invocation_audit(outcome) values('DENIED')`);
    for (const table of TABLES) {
      await assert.rejects(root(`delete from gov_repo.${table}`),/S2_APPEND_ONLY/);
      await assert.rejects(root(`truncate gov_repo.${table} cascade`),/S2_APPEND_ONLY/);
    }
    await assert.rejects(root(`update gov_repo.machine_invocation_audit set outcome='APPLIED'`),/S2_APPEND_ONLY/);
    await assert.rejects(root(`update gov_repo.machine_binding_revisions set snapshot='{}'`),/S2_APPEND_ONLY/);
    assert.equal(await read(`select count(*) from gov_repo.machine_invocation_audit`),'1');
    await root(`begin; insert into gov_repo.machine_invocation_audit(outcome) values('DENIED'); rollback`);
    assert.equal(await read(`select count(*) from gov_repo.machine_invocation_audit`),'1','no claim of rollback survival');
    await assert.rejects(root(`set role govia_discovery_control_owner; update gov_repo.organisations set is_active=false where organisation_id='${org}'`),/42501/);
    assert.equal(await read(`select is_active from gov_repo.organisations where organisation_id='${org}'`),'t','lock privilege cannot modify tenant state');
  });

  await t.test('unsafe LOGIN attributes, memberships, table grants and CREATE paths reject registration', async () => {
    const p=await createPrincipal();
    for(const attribute of ['superuser','createdb','createrole','replication','bypassrls','nologin']) {
      const role=`s2_bad_${++serial}`; await root(`create role ${role} ${attribute==='nologin'?'':'login'} ${attribute}`);
      await assert.rejects(register(p,role),/S2_ROLE_UNSAFE/);
    }
    for(const target of ['service_role','authenticated','govia_discovery_control_owner']) {
      const role=await createLogin(); await root(`grant ${target} to ${role}`);
      await assert.rejects(register(p,role),/S2_ROLE_UNSAFE/);
    }
    const direct=await createLogin(); await owner(`grant select on gov_repo.organisations to ${direct}`);
    await assert.rejects(register(p,direct),/S2_ROLE_UNSAFE/);
    const schema=await createLogin(); await owner(`grant create on schema gov_repo to ${schema}`);
    await assert.rejects(register(p,schema),/S2_ROLE_UNSAFE/);
    const database=await createLogin(); await owner(`grant create on database postgres to ${database}`);
    await assert.rejects(register(p,database),/S2_ROLE_UNSAFE/);
    const authority=await createLogin(); await root(`grant govia_discovery_machine_caller to ${authority} with admin true`);
    await assert.rejects(register(p,authority),/S2_ROLE_UNSAFE/);
    const pendingRole=await createLogin(), pending=await register(principal,pendingRole);
    await assert.rejects(root(`update gov_repo.machine_credential_generations set state='CURRENT' where generation_id='${pending}'`),/23505/);
  });

  // Test-only closed probe. Production migration deliberately exposes no machine command.
  await root(`create function gov_repo.s2_test_probe(b uuid,r bigint) returns jsonb language sql security definer
    set search_path=pg_catalog,pg_temp as 'select to_jsonb(e) from gov_repo.machine_lock_eligibility_v1(b,r) e';
    alter function gov_repo.s2_test_probe(uuid,bigint) owner to govia_discovery_control_owner;
    revoke all on function gov_repo.s2_test_probe(uuid,bigint) from public,anon,authenticated,service_role;
    grant execute on function gov_repo.s2_test_probe(uuid,bigint) to govia_discovery_machine_caller`);
  const eligible = (id = binding, rev = 1) => `select gov_repo.s2_test_probe('${id}',${rev});`;

  await t.test('real LOGIN identity, no GUC/SET ROLE authority, closed scope and current durable state', async () => {
    assert.equal(await login('select session_user',machine),machine);
    const result = JSON.parse(await login(eligible(),machine));
    assert.equal(result.principal_id,principal); assert.equal(result.generation_id,generation);
    assert.equal(result.binding.binding_id,binding); assert.equal(result.binding.propose_enabled,false);
    assert.equal(await login(`set role govia_discovery_machine_caller; select session_user`,machine),machine);
    assert.equal(JSON.parse(await login(`set role govia_discovery_machine_caller; ${eligible()}`,machine)).principal_id,principal);
    await assert.rejects(root(`set role ${machine}; ${eligible()}`),/S2_CREDENTIAL_INELIGIBLE/,'SET ROLE is not session_user');
    await assert.rejects(login(`set app.principal_id='${principal}'; ${eligible(randomUUID())}`,machine),/S2_SCOPE_INELIGIBLE/);
    const foreign = await owner(bindingSql(await createPrincipal()));
    await assert.rejects(login(eligible(foreign),machine),/S2_SCOPE_INELIGIBLE/);
    await assert.rejects(login(eligible(binding,2),machine),/S2_SCOPE_INELIGIBLE/);
    for (const isolation of ['repeatable read','serializable']) await assert.rejects(login(`begin isolation level ${isolation}; ${eligible()}; commit`,machine),/S2_READ_COMMITTED_REQUIRED/);
    await owner(`select gov_repo.machine_set_principal_state_v1('${principal}','DISABLED','disable','S2')`);
    await assert.rejects(login(eligible(),machine),/S2_CREDENTIAL_INELIGIBLE/);
    await owner(`select gov_repo.machine_set_principal_state_v1('${principal}','ENABLED','enable','S2')`);
    await owner(`update gov_repo.organisations set is_active=false where organisation_id='${org}'`);
    await assert.rejects(login(eligible(),machine),/S2_SCOPE_INELIGIBLE/);
    await owner(`update gov_repo.organisations set is_active=true where organisation_id='${org}'`);
    const id=await owner(bindingSql(principal,'acme/lifecycle'));
    await owner(change(id,1,'DISABLED')); await assert.rejects(login(eligible(id,2),machine),/S2_SCOPE_INELIGIBLE/);
    await owner(change(id,2,'ENABLED')); await login(eligible(id,3),machine);
    await owner(change(id,3,'REVOKED')); const replacement=await owner(bindingSql(principal,'acme/lifecycle'));
    await assert.rejects(login(eligible(id,4),machine),/S2_SCOPE_INELIGIBLE/); await login(eligible(replacement),machine);
  });

  await t.test('transitive MEMBER / INHERIT / SET / ADMIN closure rejects privileged and dormant paths', async () => {
    await owner('create role s2_membership_bridge nologin');
    const targets=['govia_discovery_control_owner','govia_discovery_audit_owner','govia_discovery_provisioner',
      'service_role','authenticated','anon','govia_runtime_executor','govia_ledger_executor'];
    // The first edge starts at the only permitted direct membership. The forbidden target is two hops away.
    for(const target of targets) {
      await root(`grant s2_membership_bridge to govia_discovery_machine_caller with inherit false, set true;
        grant ${target} to s2_membership_bridge with inherit false, set true`);
      try {
        assert.equal(await read(`select pg_has_role(${q(machine)},${q(target)},'SET')`),'t','actual SET ROLE path exists');
        const edges=JSON.parse(await read(`select json_agg(json_build_object('admin',admin_option,'inherit',inherit_option,'set',set_option))
          from pg_auth_members where member=(select oid from pg_roles where rolname='s2_membership_bridge')`));
        assert.deepEqual(edges,[{admin:false,inherit:false,set:true}]);
        await assert.rejects(login(eligible(),machine),/S2_CREDENTIAL_INELIGIBLE/);
      } finally { await root(`revoke ${target} from s2_membership_bridge; revoke s2_membership_bridge from govia_discovery_machine_caller`); }
    }
    for(const options of ['inherit true, set false, admin false','inherit false, set false, admin true','inherit false, set false, admin false']) {
      await root(`grant s2_membership_bridge to govia_discovery_machine_caller with ${options}`);
      try {
        await assert.rejects(login(eligible(),machine),/S2_CREDENTIAL_INELIGIBLE/);
        const candidate=await createLogin(); await assert.rejects(register(principal,candidate),/S2_ROLE_UNSAFE/);
      } finally { await root('revoke s2_membership_bridge from govia_discovery_machine_caller'); }
    }
    await login(eligible(),machine);
    await assert.rejects(login('set session authorization service_role',machine),/42501/);
  });

  await t.test('pg_temp type/table/function shadowing cannot run under the definer owner', async () => {
    const shadows = ['text','uuid','int8','bool','timestamptz','oid','jsonb'];
    const prelude = `create function pg_temp.evil(v pg_catalog.anyelement) returns pg_catalog.bool language plpgsql as $p$
      begin if current_user <> session_user then raise exception 'S2_SHADOW_EXECUTED'; end if; return true; end $p$;
      ${shadows.map(s=>`create domain pg_temp.${s} as pg_catalog.${s} check(pg_temp.evil(value));`).join('\n')}
      create temp table machine_principals(principal_id uuid,state text);
      set search_path=pg_temp,public,gov_repo;`;
    assert.equal(JSON.parse(await login(prelude+eligible(),machine)).principal_id,principal);
  });

  await t.test('OID/name exact matching, rename and drop/recreate fail closed; retired names cannot be reused', async () => {
    const p = await createPrincipal(), role = await createLogin(), id = await register(p,role);
    await activate(id); const b=await owner(bindingSql(p)); await login(eligible(b),role);
    const oid=await read(`select role_oid from gov_repo.machine_credential_generations where generation_id='${id}'`);
    await owner(`alter role ${role} rename to ${role}_renamed`);
    await assert.rejects(login(eligible(b),`${role}_renamed`),/S2_CREDENTIAL_INELIGIBLE/);
    assert.equal(await read(`select gov_repo.machine_role_safe_v1(${oid},${q(role)})`),'f');
    await root(`drop owned by ${role}_renamed; drop role ${role}_renamed; create role ${role} login;
      grant govia_discovery_machine_caller to ${role}`);
    await assert.rejects(login(eligible(b),role),/S2_CREDENTIAL_INELIGIBLE/);
    assert.notEqual(await read(`select oid from pg_roles where rolname=${q(role)}`),oid);
    await assert.rejects(register(p,role),/23505/);
    await assert.rejects(root(`update gov_repo.machine_credential_generations set role_oid=(select oid from pg_roles where rolname=${q(role)}) where generation_id='${id}'`),/S2_GENERATION_IMMUTABLE/);
    assert.equal(await read(`select gov_repo.machine_role_safe_v1(0,${q(role)})`),'f');
    assert.equal(await read(`select gov_repo.machine_role_safe_v1(${oid},'WRONG_NAME')`),'f');
    const quoted='S2.Mixed"Role'; await owner(`create role "S2.Mixed""Role" login`);
    const exact=await register(await createPrincipal(),quoted); assert.match(exact,/^[0-9a-f-]{36}$/);
    await assert.rejects(register(await createPrincipal(),'s2.mixed"role'),/S2_ROLE_UNSAFE/);
  });

  await t.test('generation switch invalidates already-open sessions; one CURRENT; expiry uses fresh DB time', async () => {
    const persistent=loginSession(machine); t.after(()=>persistent.close());
    assert.equal((await persistent.run(eligible())).err,'');
    const next=await createLogin(), nextId=await register(principal,next); await activate(nextId);
    assert.match((await persistent.run(eligible())).err,/S2_CREDENTIAL_INELIGIBLE/);
    await login(eligible(),next);
    assert.equal(await read(`select count(*) from gov_repo.machine_credential_generations where principal_id='${principal}' and state='CURRENT'`),'1');
    await assert.rejects(activate(generation),/S2_CREDENTIAL_INELIGIBLE/);
    const retired=await createPrincipal(); await owner(`select gov_repo.machine_set_principal_state_v1('${retired}','RETIRED','retire','S2')`);
    await assert.rejects(owner(`select gov_repo.machine_set_principal_state_v1('${retired}','ENABLED','bad','S2')`),/S2_PRINCIPAL_IMMUTABLE/);
    const expiredRole=await createLogin(), expired=await register(await createPrincipal(),expiredRole,"clock_timestamp()-interval '1 second'");
    await assert.rejects(activate(expired),/S2_CREDENTIAL_INELIGIBLE/);
    const p=await createPrincipal(), role=await createLogin(), b=await owner(bindingSql(p));
    const short=await register(p,role,"clock_timestamp()+interval '2 seconds'"); await activate(short);
    const s=loginSession(role); t.after(()=>s.close());
    assert.equal((await s.run(`begin; ${eligible(b)} select pg_sleep(2.1);`)).err,'');
    assert.match((await s.run(eligible(b))).err,/S2_CREDENTIAL_INELIGIBLE/); await s.run('rollback;');
  });

  await t.test('principal guard orders concurrent eligibility and committed binding revocation', async () => {
    const p=await createPrincipal(), role=await createLogin(), id=await register(p,role), b=await owner(bindingSql(p)); await activate(id);
    const s=loginSession(role); t.after(()=>s.close());
    assert.equal((await s.run(`begin; ${eligible(b)}`)).err,'');
    let done=false; const revocation=owner(change(b,1,'REVOKED')).finally(()=>{done=true;});
    // pg_stat_activity waits prove the lock, not only elapsed wall time.
    let waiting=false;
    for(let i=0;i<40;i++) {
      waiting=await read(`select exists(select 1 from pg_stat_activity where wait_event_type='Lock' and query like '%machine_change_binding_v1%' and pid<>pg_backend_pid())`)==='t';
      if(waiting) break;
      await new Promise(r=>setTimeout(r,25));
    }
    assert.ok(waiting); assert.equal(done,false); await s.run('commit;'); assert.equal(await revocation,'2');
    await assert.rejects(login(eligible(b,2),role),/S2_SCOPE_INELIGIBLE/);
  });

  await t.test('seven raw RPCs and 22 HUMAN application routines remain unchanged', async () => {
    assert.deepEqual((await pg.inventory()).filter(p=>p.app),pg.human);
    for (const role of ['anon','authenticated','service_role',machine,'govia_discovery_machine_caller','govia_discovery_provisioner'])
      assert.equal(await read(`select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='gov_repo'
        and p.proname in (${RAW.map(q).join(',')}) and has_function_privilege(${q(role)},p.oid,'EXECUTE')`),'0');
    assert.equal(await read(`select count(*) from pg_proc p where p.proname like '%governed_v1' and has_function_privilege(${q(machine)},p.oid,'EXECUTE')`),'0');
  });
});
