import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readdirSync,readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { ledgerMigration,ledgerRepo,replay } from './helpers/ledger-v2-foundation-fixtures';

const git=(args:string[])=>execFileSync('git',args,{cwd:ledgerRepo,encoding:'utf8'}).trimEnd();
test('121 historical Git blobs unchanged; 100 executable files fully reconciled with quarantine authority',()=>{
  const entries=git(['ls-tree','-r',replay.base]).split('\n').map(line=>{const parts=line.split(/\s+/);return {path:parts[3],oid:parts[2]};})
    .filter(e=>/(^|\/)migrations\//.test(e.path));
  assert.deepEqual(replay.historical,entries);
  assert.equal(entries.length,121);
  for(const entry of entries){
    // Existing checkout uses CRLF. Compare canonical Git blob bytes, not an
    // invented raw-LF claim about pre-existing worktree line endings.
    const bytes=Buffer.from(readFileSync(join(ledgerRepo,entry.path)).toString('latin1').replace(/\r\n/g,'\n'),'latin1');
    const blob=createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
    assert.equal(blob,entry.oid,entry.path);
  }
  const canonical=entries.filter(e=>e.path.startsWith('supabase/migrations/')).map(e=>e.path);
  assert.equal(canonical.length,99);assert.deepEqual(replay.applied,[...canonical,`supabase/migrations/${ledgerMigration}`]);
  assert.equal(replay.applied.length,100);
  assert.deepEqual(readdirSync(join(ledgerRepo,'supabase/migrations')).sort(),replay.applied.map(p=>p.split('/').at(-1)).sort());
  const manifest=JSON.parse(readFileSync(join(ledgerRepo,'docs/architecture/m16-noncanonical-migration-roots.manifest.json'),'utf8'));
  assert.equal(manifest.canonicalMigrationAuthority,'supabase/migrations');
  assert.deepEqual(replay.excluded.map(e=>e.path),entries.filter(e=>!canonical.includes(e.path)).map(e=>e.path));
  for(const entry of replay.excluded)assert.ok(manifest.noncanonicalRoots.some((root:string)=>entry.path.startsWith(root)),entry.path);
  const counts=Object.fromEntries(['apps/extension','graphos-complete','vibe-code-compliance'].map(root=>[root,replay.excluded.filter(e=>e.path.startsWith(root+'/')).length]));
  assert.deepEqual(counts,{'apps/extension':7,'graphos-complete':14,'vibe-code-compliance':1});
});

test('original 41 vectors and independent oracle preserved; app/writers/Audit/authority source unchanged',()=>{
  const original:Record<string,string>={
    'apps/dashboard/tests/fixtures/ledger-v2-serialization-v1.json':'9d2ed82e965c9297796e11e70b117f01d8ee0daa4f51f76625eabc1237793f11',
    'apps/dashboard/tests/helpers/ledger-v2-golden-vectors.py':'c3f1812dcba7e97db542e772b9fc914b9908c7b0039ee05b934fed14b2e49383',
  };
  // Pin Git-canonical bytes so Windows CRLF checkouts and CI LF checkouts agree.
  // No serialized bytes or expected vector digest is regenerated or changed.
  for(const [file,sha] of Object.entries(original))assert.equal(createHash('sha256')
    .update(Buffer.from(readFileSync(join(ledgerRepo,file)).toString('latin1').replace(/\r\n/g,'\n'),'latin1')).digest('hex'),sha,file);
  const changed=git(['diff','--name-only',replay.base,'--','apps/dashboard/app','apps/dashboard/services','apps/dashboard/repositories',
    'apps/dashboard/components','packages/canonical-contracts','packages/governance-review','docs/architecture']);
  assert.equal(changed,'','no runtime, API, UI, governance truth or architecture change');
  const migration=readFileSync(join(ledgerRepo,'supabase/migrations',ledgerMigration),'utf8').replace(/^\s*--.*$/gm,'');
  assert.doesNotMatch(migration,/\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM|TRUNCATE)\s+gov_repo\.governance_ledger\b/i);
  assert.doesNotMatch(migration,/CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+gov_repo\.ledger_(?:append|verify)\s*\(/i);
  assert.doesNotMatch(migration,/SECURITY\s+DEFINER/i);
  assert.doesNotMatch(migration,/INSERT\s+INTO\s+gov_repo\.ledger_(?:integrity_epochs|tenant_|global_append_head)/i);
});

test('measured PG17 catalog belongs to unchanged migration; complete index contract and historical STOP retained',()=>{
  const readCanonical=(file:string)=>Buffer.from(readFileSync(join(ledgerRepo,file)).toString('latin1').replace(/\r\n/g,'\n'),'latin1');
  const catalog=JSON.parse(readFileSync(join(ledgerRepo,'docs/codex/evidence/2026-10-21-m17.5-v1-s1a1-1-catalog.json'),'utf8'));
  assert.equal(createHash('sha256').update(readCanonical(`supabase/migrations/${ledgerMigration}`)).digest('hex'),catalog.migration.sha256LF);
  assert.deepEqual(catalog.counts,{tables:6,columns:50,constraints:43,indexes:15,triggers:13,functions:11});
  const expectedIndexes=[
    ['ledger_global_append_head_v2','singleton',true],
    ['ledger_integrity_epochs_v2','activation_id, algorithm_version, serialization_version, activated_at',true],
    ['ledger_integrity_epochs_v2','activation_id',true],
    ['ledger_integrity_epochs_v2','(true)',true,' WHERE is_active'],
    ['ledger_tenant_entries_v2','organisation_id, tenant_entry_id',true],
    ['ledger_tenant_entries_v2','organisation_id, chain_id, tenant_sequence',true],
    ['ledger_tenant_entries_v2','source_entry_sequence',true],
    ['ledger_tenant_entries_v2','organisation_id, recorded_at, tenant_sequence',false],
    ['ledger_tenant_genesis_v2','organisation_id, chain_id, activation_id, algorithm_version, serialization_version',true],
    ['ledger_tenant_genesis_v2','organisation_id',true],
    ['ledger_tenant_genesis_v2','organisation_id, chain_id',true],
    ['ledger_tenant_heads_v2','organisation_id, chain_id',true],
    ['ledger_tenant_legacy_refs_v2','legacy_ref_id',true],
    ['ledger_tenant_legacy_refs_v2','source_entry_sequence',true],
    ['ledger_tenant_legacy_refs_v2','organisation_id, legacy_ref_id',false],
  ].map(([table,keys,unique,predicate])=>`CREATE ${unique?'UNIQUE ':''}INDEX ON gov_repo.${table} USING btree (${keys})${predicate??''}`).sort();
  assert.deepEqual(catalog.indexes.map((i:{definition:string})=>i.definition.replace(/ INDEX \S+ ON /,' INDEX ON ')).sort(),expectedIndexes);
  for(const row of catalog.tables){assert.equal(row.owner,'postgres');assert.equal(row.rls,true);assert.deepEqual(row.acl,['postgres=arwdDxtm/postgres']);}
  for(const row of catalog.functions){assert.equal(row.owner,'postgres');assert.equal(row.securityDefiner,false);assert.deepEqual(row.config,['search_path=pg_catalog, pg_temp']);assert.deepEqual(row.acl,['postgres=X/postgres']);}
  assert.equal(catalog.activeEpochCount,0);
  assert.ok(Object.values(catalog.inactive).every(n=>n===0));
  const report=readCanonical('docs/codex/evidence/2026-10-20-m17.5-v1-s1a1-1-ledger-v2-foundation.md');
  const marker=report.indexOf(Buffer.from('\n\n## Resumed verification — 2026-10-21'));
  assert.ok(marker>0,'resumption appends rather than erasing the historical STOP');
  assert.equal(createHash('sha256').update(report.subarray(0,marker)).digest('hex'),'4eeab86eea313eb955ff255ac7a53ae870d0e5451f1c5511f502bdcf763ad1ec');
});
