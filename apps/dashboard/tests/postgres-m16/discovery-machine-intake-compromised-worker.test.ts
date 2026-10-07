import assert from 'node:assert/strict';
import {test} from 'node:test';
import {s3Cluster,provisionS3,producerCorpus} from '../helpers/discovery-machine-s3-fixtures';
import {literal as q} from '../helpers/discovery-machine-s2-fixtures';
import {normalizeObjectCandidate} from '../../../../packages/scanner/src/discovery/index';
import {boundaryCluster,horizon,isS4} from '../helpers/discovery-machine-s4-fixtures';

test(`${horizon} compromised real LOGIN is confined to its authorized intake-only binding`,{timeout:240_000},async t=>{
 const pg=await boundaryCluster(m=>t.diagnostic(m)); t.after(()=>pg.stop());
 const m=await provisionS3(pg), foreign=await provisionS3(pg); const foreignRun=(await foreign.open()).provenance.run_id;
 const allowed=['acquisition_runs','discovery_run_bindings','discovery_machine_admissions','discovery_evidence','source_assertions','source_assertion_evidence',
  'discovery_findings','discovery_finding_assertions','discovery_finding_evidence','discovery_candidates','discovery_candidate_assertions','discovery_candidate_evidence',
  'review_subjects','review_subject_assertions','review_subject_evidence'];
 if(isS4) allowed.push('machine_invocation_audit'); // Command audit is expected; direct audit DML remains forbidden below.
 const tables: string[]=JSON.parse(await pg.bootstrapSql(`select json_agg(c.relname order by c.relname) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='gov_repo' and c.relkind='r'`));
 const protectedTables=tables.filter(n=>!allowed.includes(n));
 const checksumSql=`select jsonb_object_agg(name,digest) from (${protectedTables.map(n=>`select ${q(n)} name,encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb)::text,'UTF8')),'hex') digest from gov_repo."${n}" t`).join(' union all ')}) x`;
 const protectedBefore=await pg.bootstrapSql(checksumSql);
 const foreignBefore=await pg.bootstrapSql(`select to_jsonb(r) from gov_repo.discovery_run_bindings r where run_id=${q(foreignRun)}`);
 const run=(await m.open()).provenance.run_id;
 const {groups}=await producerCorpus(); const item=groups.evidenceAssembly.find(c=>c.finding.candidateKind==='AGENT')!;
 const normalized=normalizeObjectCandidate(item); assert.equal(normalized.status,'NORMALIZED');
 const candidate=normalized.status==='NORMALIZED'?normalized.candidate:null;
 const observation=`select gov_repo.discovery_machine_admit_observation_v1(${q(run)},${q(JSON.stringify([item.evidence]))},${q(JSON.stringify({...item.assertion,runId:run}))})`;
 assert.equal((await m.call(observation)).outcome,'APPLIED');
 assert.equal((await m.call(`select gov_repo.discovery_machine_admit_finding_v1(${q(run)},${q(JSON.stringify(item.finding))},${q(JSON.stringify(candidate))})`)).outcome,'APPLIED');
 const subject=await m.call(`select gov_repo.discovery_machine_create_subject_v1(${q(run)},${q(item.finding.findingId)})`);
 assert.equal(subject.currentState,'DETECTED');
 await t.test('all noncertified gov_repo routines reject direct invocation, including HUMAN/raw/legacy/internal/S2',async()=>{
  const blocked: {name:string,sql:string}[]=JSON.parse(await pg.bootstrapSql(`select json_agg(json_build_object('name',p.proname,'sql',format('select gov_repo.%I(%s)',p.proname,(select string_agg(
   (case when not p.proisstrict then 'NULL' when x='text'::regtype then quote_literal('probe') when x='uuid'::regtype then quote_literal('00000000-0000-0000-0000-000000000001')
    when x='timestamptz'::regtype then quote_literal('2026-10-02T12:00:00Z') when x in ('text[]'::regtype,'jsonb'::regtype) then quote_literal('{}') when x='numeric'::regtype then '0' else 'NULL' end)
   ||'::'||format_type(x,NULL),',' order by pos) from unnest(p.proargtypes::oid[]) with ordinality a(x,pos)))))
   from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='gov_repo' and p.prokind='f' and NOT(p.prosecdef and p.proowner='govia_discovery_intake_owner'::regrole)
   ${isS4 ? "and p.oid<>'gov_repo.propose_discovery_finding_v1(text,text)'::regprocedure" : ''}`));
  for(const part of Array.from({length:Math.ceil(blocked.length/40)},(_,i)=>blocked.slice(i*40,(i+1)*40))){
   await pg.login(`do $attack$ declare s text; denied boolean; begin foreach s in array ARRAY[${part.map(p=>q(p.sql)).join(',')}] loop denied:=false; begin execute s; exception when insufficient_privilege then denied:=true; end; if not denied then raise exception 'UNEXPECTED_EXECUTE: %',s; end if; end loop; end $attack$`,m.role);
  }
  t.diagnostic(`Direct noncertified invocation denials: ${blocked.length}`);
 });
 if(isS4) await t.test('PROPOSE remains denied without proposal capability; audit is append-only command evidence',async()=>{
  assert.equal((await m.call(`select gov_repo.propose_discovery_finding_v1(${q(run)},${q(item.finding.findingId)})`)).outcome,'DENIED');
  assert.equal(await pg.bootstrapSql(`select count(*) from gov_repo.machine_invocation_audit where principal_id='${m.principal}' and event_id is not null`),'0');
  assert.ok(Number(await pg.bootstrapSql(`select count(*) from gov_repo.machine_invocation_audit where principal_id='${m.principal}' and outcome='DENIED'`))>0);
 });
 await t.test('every gov_repo table has zero direct privileges; DML is denied or eliminated by immutable NOTHING rules',async()=>{
  assert.equal(await pg.bootstrapSql(`select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='gov_repo' and c.relkind='r' and has_table_privilege(${q(m.role)},c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')`),'0');
  await pg.login(`do $attack$ declare r record; s text; denied boolean; col text; begin
   for r in select c.oid,c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='gov_repo' and c.relkind='r' loop
    select attname into col from pg_attribute where attrelid=r.oid and attnum>0 and not attisdropped order by attnum limit 1;
    foreach s in array array[format('select * from gov_repo.%I limit 0',r.relname),format('insert into gov_repo.%I default values',r.relname),
     format('update gov_repo.%I set %I=%I where false',r.relname,col,col),format('delete from gov_repo.%I where false',r.relname),format('truncate gov_repo.%I cascade',r.relname)] loop
     denied:=false; begin execute s; exception when insufficient_privilege then denied:=true; end;
     -- PostgreSQL may discard a query through an existing unconditional DO INSTEAD NOTHING
     -- rule before ACL checks. Such a command executes no DML; the ACL and checksum checks
     -- still prove absence of capability. Do not alter these frozen immutability rules.
     if not denied then
      if not exists(select 1 from pg_rewrite w where w.ev_class=r.oid and w.is_instead and w.ev_qual::text='<>'
       and pg_get_ruledef(w.oid) like '%DO INSTEAD NOTHING;'
       and ((s like 'delete %' and w.ev_type='4') or (s like 'update %' and w.ev_type='2'))) then
       raise exception 'UNEXPECTED_TABLE_ACCESS: %',s;
      end if;
     end if;
    end loop;
   end loop; end $attack$`,m.role);
  t.diagnostic(`Direct table probes: ${tables.length} tables × 5 operations; zero ACL privileges; frozen NOTHING rewrites may eliminate DML before privilege evaluation`);
 });
 await t.test('foreign scope, unassigned binding, governance injection and role/CREATE escalation fail',async()=>{
  assert.equal((await m.call(`select gov_repo.discovery_machine_open_run_v1('${foreign.binding}','Acme/Producer-Fixtures','main','github','1.0','123','commit:${'a'.repeat(40)}',clock_timestamp())`)).outcome,'DENIED');
  assert.equal((await m.call(`select gov_repo.discovery_machine_create_subject_v1(${q(foreignRun)},${q(item.finding.findingId)})`)).outcome,'DENIED');
  for(const patch of [{state:'PROPOSED'},{actor:{authorityKind:'HUMAN'}},{reviewStatus:'ACCEPTED'},{createsCanonicalObject:true}])
   await assert.rejects(m.call(`select gov_repo.discovery_machine_admit_finding_v1(${q(run)},${q(JSON.stringify({...item.finding,...patch}))},null)`),/22023/);
  for(const role of ['postgres','service_role','authenticated','govia_runtime_executor','govia_discovery_control_owner','govia_discovery_intake_owner','govia_discovery_provisioner'])
   await assert.rejects(pg.login('set role '+role,m.role),/42501/);
  await assert.rejects(pg.login('set session authorization postgres',m.role),/42501/);
  for(const schema of ['public','gov_repo']) await assert.rejects(pg.login(`create table ${schema}.s3_escape(id int)`,m.role),/42501/);
  await assert.rejects(pg.login('create schema s3_escape',m.role),/42501/);
  // Hostile temporary objects and request GUCs cannot replace qualified references/session_user.
  const attack=await pg.login(`create temp table machine_execution_bindings(binding_id uuid); set search_path=pg_temp,gov_repo,pg_catalog;
   set request.jwt.claims='{"role":"service_role"}'; ${observation}`,m.role);
  assert.equal(JSON.parse(attack).outcome,'REPLAYED');
 });
 assert.equal(await pg.bootstrapSql(checksumSql),protectedBefore,'all protected stores remain byte-equivalent');
 assert.equal(await pg.bootstrapSql(`select to_jsonb(r) from gov_repo.discovery_run_bindings r where run_id=${q(foreignRun)}`),foreignBefore);
 assert.equal(await pg.bootstrapSql(`select state from gov_repo.review_subjects where review_subject_id=${q(subject.reviewSubjectId)}`),'DETECTED');
 t.diagnostic(`Protected-store before/after checksums equal: ${protectedTables.length} tables; no PROPOSED/canonical/HUMAN/L11/L14/control-plane writes`);
});
