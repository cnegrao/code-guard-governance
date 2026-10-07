import assert from 'node:assert/strict';
import {test} from 'node:test';
import {s3Cluster,s3Source,provisionS3} from '../helpers/discovery-machine-s3-fixtures';
import {literal as q,RAW,TABLES} from '../helpers/discovery-machine-s2-fixtures';
import {boundaryCluster,horizon,isS4} from '../helpers/discovery-machine-s4-fixtures';

export const commands=['open_run','complete_run','admit_observation','admit_finding','admit_lineage','create_subject','record_technical_profile','record_execution_snapshot','get_candidate','is_governed'].map(n=>'discovery_machine_'+n+'_v1').sort();
if(isS4) commands.push('propose_discovery_finding_v1');
test(`${horizon} exact effective ACL, routine attestation and transitive security closure`,{timeout:240_000},async t=>{
 const pg=await boundaryCluster(m=>t.diagnostic(m)); t.after(()=>pg.stop()); const m=await provisionS3(pg);
 const read=pg.bootstrapSql;
 await t.test(`${isS4 ? '20 intake/audit routines / 11 commands' : '19 routines / 10 commands'} / 22 HUMAN / 7 raw`,async()=>{
  const census=JSON.parse(await read(`select json_agg(json_build_object('name',p.proname,'args',oidvectortypes(p.proargtypes),'owner',pg_get_userbyid(p.proowner),'definer',p.prosecdef,'config',p.proconfig,'hash',encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')) order by p.proname) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='gov_repo' and p.proname like 'discovery_machine_%'`));
  assert.equal(census.length,isS4?20:19); assert.equal(census.filter((p:{definer:boolean})=>p.definer).length,isS4?12:11);
  for(const role of [m.role,'govia_discovery_machine_caller']) assert.deepEqual(JSON.parse(await read(`select json_agg(p.proname order by p.proname) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='gov_repo' and has_function_privilege(${q(role)},p.oid,'EXECUTE')`)),commands);
  assert.equal((await pg.inventory()).filter(p=>p.app).length,22);
  assert.equal(await read(`select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='gov_repo' and p.proname=any(array[${RAW.map(q)}])`),'7');
  t.diagnostic(horizon+' census: '+JSON.stringify(census));
 });
 await t.test('machine tables, direct S2 access, memberships and helper paths are closed',async()=>{
  for(const role of [m.role,'govia_discovery_machine_caller']) assert.equal(await read(`select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='gov_repo' and c.relkind in ('r','p','v','m') and (has_table_privilege(${q(role)},c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN') or has_any_column_privilege(${q(role)},c.oid,'SELECT,INSERT,UPDATE,REFERENCES'))`),'0');
  for(const role of ['govia_discovery_intake_owner','service_role']) for(const table of TABLES)
   if(isS4 && role==='govia_discovery_intake_owner' && table==='machine_invocation_audit') {
    assert.equal(await read(`select has_table_privilege(${q(role)},'gov_repo.${table}','SELECT')`),'t');
    assert.equal(await read(`select has_table_privilege(${q(role)},'gov_repo.${table}','INSERT,UPDATE,DELETE,TRUNCATE')`),'f');
   } else assert.equal(await read(`select has_table_privilege(${q(role)},'gov_repo.${table}','SELECT,INSERT,UPDATE,DELETE,TRUNCATE')`),'f');
  for(const table of ['discovery_run_bindings','discovery_machine_admissions']) assert.equal(await read(`select has_table_privilege('service_role','gov_repo.${table}','SELECT,INSERT,UPDATE,DELETE,TRUNCATE')`),'f');
  for(const role of ['govia_discovery_control_owner','govia_discovery_intake_owner','govia_runtime_executor','govia_discovery_provisioner','service_role','authenticated','postgres'])
   await assert.rejects(pg.login('set role '+role,m.role),/42501/);
  const helper=await read(`select prosrc from pg_proc where oid='gov_repo.discovery_machine_authorize_v1(uuid,bigint)'::regprocedure`);
  assert.ok(helper.includes('machine_lock_eligibility_v1')); assert.ok(!helper.includes('current_user'));
  assert.equal(await read(`select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='gov_repo' and p.proname like 'discovery_machine_%' and p.prosrc like '%record_execution_snapshot(%'`),'1');
 });
 await t.test('transitive routine, trigger, CHECK and RLS closure is catalog-audited',async()=>{
  type Routine={oid:number,name:string,owner:string,login:boolean,definer:boolean,path:string[],body:string};
  const catalog:Routine[]=JSON.parse(await read(`select json_agg(json_build_object('oid',p.oid,'name',p.proname,'owner',r.rolname,'login',r.rolcanlogin,'definer',p.prosecdef,'path',p.proconfig,'body',p.prosrc)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_roles r on r.oid=p.proowner where n.nspname='gov_repo'`));
  const reached=new Set(commands), written=new Set<string>();
  const triggers:{table:string,name:string}[]=JSON.parse(await read(`select json_agg(json_build_object('table',c.relname,'name',p.proname)) from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_proc p on p.oid=t.tgfoid join pg_namespace n on n.oid=c.relnamespace where n.nspname='gov_repo' and not t.tgisinternal`));
  const checks:{table:string,expression:string}[]=JSON.parse(await read(`select json_agg(json_build_object('table',c.relname,'expression',pg_get_constraintdef(k.oid))) from pg_constraint k join pg_class c on c.oid=k.conrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='gov_repo' and k.contype='c'`));
  const policies:{table:string,expression:string}[]=JSON.parse(await read(`select json_agg(json_build_object('table',c.relname,'expression',coalesce(pg_get_expr(p.polqual,p.polrelid),'')||' '||coalesce(pg_get_expr(p.polwithcheck,p.polrelid),''))) from pg_policy p join pg_class c on c.oid=p.polrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='gov_repo'`));
  const addCalls=(source:string)=>{for(const match of source.matchAll(/gov_repo\.([a-z_0-9]+)\s*\(/g))if(catalog.some(p=>p.name===match[1]))reached.add(match[1]);};
  let previous=-1;
  while(previous!==reached.size+written.size){
   previous=reached.size+written.size;
   for(const p of catalog.filter(p=>reached.has(p.name))){
    addCalls(p.body);
    for(const match of p.body.matchAll(/(?:insert\s+into|update|delete\s+from)\s+gov_repo\.([a-z_0-9]+)/gi))written.add(match[1]);
   }
   for(const tr of triggers)if(written.has(tr.table))reached.add(tr.name);
   for(const expr of [...checks,...policies])if(written.has(expr.table))addCalls(expr.expression);
  }
  for(const p of catalog.filter(p=>reached.has(p.name))){
   if(p.definer)assert.equal(p.login,false,p.name+' definer owner must be NOLOGIN');
   if(p.name==='set_updated_at'){
    // Frozen invoker trigger inherits the enclosing command's fixed pg_catalog,pg_temp path.
    assert.equal(p.definer,false); assert.ok(!/\b(?:from|join|execute)\b/i.test(p.body));
   } else assert.ok(p.path?.some(x=>['search_path=pg_catalog, pg_temp','search_path=pg_catalog','search_path=gov_repo, pg_catalog, pg_temp'].includes(x)),p.name+': '+p.path);
   const code=p.body.replace(/--[^\n]*/g,'');
   assert.ok(!/\bEXECUTE\s+(?:format|[a-z_]\w*\s*;|'|\$)/i.test(code),p.name+' runtime dynamic SQL');
   if(!commands.includes(p.name))assert.equal(await read(`select has_function_privilege(${q(m.role)},${p.oid},'EXECUTE')`),'f',p.name);
  }
  for(const name of ['machine_lock_eligibility_v1','machine_role_safe_v1','record_execution_snapshot','normalized_object_identity','frame_identity','set_updated_at','execution_field_valid','discovery_machine_run_binding_guard_v1'])assert.ok(reached.has(name),name);
  assert.ok(![...reached].some(n=>(RAW.includes(n) && !(isS4 && n==='apply_review_transition'))||n==='record_authorization_decision_governed_v1'));
  if(isS4) for(const name of ['propose_discovery_finding_v1','apply_review_transition','discovery_machine_audit_result_v1'])assert.ok(reached.has(name),name);
  t.diagnostic('Transitive routines: '+JSON.stringify(catalog.filter(p=>reached.has(p.name)).map(({body,...p})=>p)));
  t.diagnostic('Written-table triggers: '+JSON.stringify(triggers.filter(p=>written.has(p.table))));
  t.diagnostic('Written-table CHECK/RLS expressions: '+JSON.stringify([...checks,...policies].filter(p=>written.has(p.table))));
 });
 if(!isS4) await t.test('postflight rejects privilege and RLS drift under hostile historical defaults',async()=>{
  const src=s3Source(); const post=src.slice(src.indexOf('DO $s3_postflight$'),src.indexOf('$s3_postflight$;')+'$s3_postflight$;'.length);
  for(const attack of ['grant select on gov_repo.discovery_run_bindings to service_role','grant truncate on gov_repo.discovery_machine_admissions to public',
   'grant execute on function gov_repo.discovery_machine_authorize_v1(uuid,bigint) to govia_discovery_machine_caller',
   'alter table gov_repo.discovery_machine_admissions disable row level security','grant create on schema gov_repo to govia_discovery_intake_owner'])
   await assert.rejects(read(`begin; ${attack}; ${post}; rollback`),/S3_POSTFLIGHT/);
 });
 if(isS4) await t.test('S4 owners, hostile-default closure, exact definer owners and real PUBLIC/app/raw denials',async()=>{
  const owners=['govia_discovery_control_owner','govia_discovery_intake_owner','govia_discovery_audit_owner','govia_discovery_propose_owner'];
  assert.equal(await read(`select count(*) from pg_roles where rolname=any(array[${owners.map(q)}]) and (rolcanlogin or rolsuper or rolbypassrls or rolcreatedb or rolcreaterole or rolreplication)`),'0');
  assert.equal(await read(`select count(*) from pg_auth_members where member=any(array[${owners.map(n=>q(n)+'::regrole::oid').join(',')}])`),'0');
  assert.equal(await read(`select count(*) from pg_auth_members where member=${q(m.role)}::regrole and roleid<>'govia_discovery_machine_caller'::regrole`),'0');
  for(const [name,owner] of [['propose_discovery_finding_v1','govia_discovery_propose_owner'],['discovery_machine_audit_result_v1','govia_discovery_audit_owner']]) {
   assert.equal(await read(`select pg_get_userbyid(proowner) from pg_proc where pronamespace='gov_repo'::regnamespace and proname=${q(name)}`),owner);
  }
  assert.equal(await read(`select count(*) from pg_proc p,lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
   where p.pronamespace='gov_repo'::regnamespace and (p.proname like 'discovery_machine_%' or p.proname='propose_discovery_finding_v1') and a.grantee=0 and a.privilege_type='EXECUTE'`),'0');
  await pg.owner('create role s4_public_only login; grant usage on schema gov_repo to s4_public_only');
  for(const role of ['s4_public_only','anon','authenticated','service_role']) {
   assert.equal(await read(`select count(*) from pg_proc p where p.pronamespace='gov_repo'::regnamespace and
    (p.proname like 'discovery_machine_%' or p.proname='propose_discovery_finding_v1') and has_function_privilege(${q(role)},p.oid,'EXECUTE')`),'0');
   await assert.rejects(pg.login(`select gov_repo.propose_discovery_finding_v1('probe','probe')`,role),/42501/);
   await assert.rejects(pg.login(`select gov_repo.discovery_machine_audit_result_v1('probe',null,'{}',null)`,role),/42501/);
  }
  for(const role of [m.role,'service_role']) await assert.rejects(pg.login(`select gov_repo.apply_review_transition(null::uuid,null::text,null::text,null::text,null::text,null::text,null::text,null::text,null::text,null::timestamptz,null::text[],null::text,null::text,null::text)`,role),/42501/);
  for(const owner of owners) await assert.rejects(pg.login('set role '+owner,m.role),/42501/);
  // The permitted caller group conveys no owner authority, even when selected explicitly.
  await assert.rejects(pg.login('set role govia_discovery_machine_caller; set role govia_discovery_propose_owner',m.role),/42501/);
 });
 await t.test('role-safety rejects extra helper/definer/overload, table rights, CREATE and membership',async()=>{
  const attacks:[string,string][]=[
   [`grant execute on function gov_repo.discovery_machine_authorize_v1(uuid,bigint) to ${m.role}`,`revoke execute on function gov_repo.discovery_machine_authorize_v1(uuid,bigint) from ${m.role}`],
   [`create function gov_repo.s3_evil() returns int language sql security definer as 'select 1'; grant execute on function gov_repo.s3_evil() to ${m.role}`,`drop function gov_repo.s3_evil()`],
   [`create function gov_repo.discovery_machine_get_candidate_v1(text) returns int language sql as 'select 1'; grant execute on function gov_repo.discovery_machine_get_candidate_v1(text) to ${m.role}`,`drop function gov_repo.discovery_machine_get_candidate_v1(text)`],
   [`grant select on gov_repo.acquisition_runs to ${m.role}`,`revoke select on gov_repo.acquisition_runs from ${m.role}`],
   [`grant create on schema gov_repo to ${m.role}`,`revoke create on schema gov_repo from ${m.role}`],
   [`grant service_role to ${m.role} with inherit false,set true`,`revoke service_role from ${m.role}`],
  ];
  for(const [attack,undo] of attacks){await read(attack);try{assert.equal((await m.open()).outcome,'DENIED',attack);}finally{await read(undo);}}
  const definition=await read(`select pg_get_functiondef('gov_repo.discovery_machine_get_candidate_v1(text,text)'::regprocedure)`);
  await read(`alter function gov_repo.discovery_machine_get_candidate_v1(text,text) rename to s3_renamed`);
  try{assert.equal((await m.open()).outcome,'DENIED');}finally{await read(`alter function gov_repo.s3_renamed(text,text) rename to discovery_machine_get_candidate_v1`);}
  await read(`alter function gov_repo.discovery_machine_get_candidate_v1(text,text) owner to postgres`);
  try{assert.equal((await m.open()).outcome,'DENIED');}finally{await read(`alter function gov_repo.discovery_machine_get_candidate_v1(text,text) owner to govia_discovery_intake_owner`);}
  assert.equal((await m.open()).outcome,'APPLIED');
  // Recreating the same signature/body/owner must still fail the actual pg_proc identity attestation.
  await read(`drop function gov_repo.discovery_machine_get_candidate_v1(text,text); ${definition}; alter function gov_repo.discovery_machine_get_candidate_v1(text,text) owner to govia_discovery_intake_owner; grant execute on function gov_repo.discovery_machine_get_candidate_v1(text,text) to govia_discovery_machine_caller`);
  assert.equal((await m.open()).outcome,'DENIED');
 });
});
