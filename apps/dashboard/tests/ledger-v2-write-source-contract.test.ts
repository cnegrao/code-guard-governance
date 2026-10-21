import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { test } from 'node:test';
import { ledgerRepo, ledgerMigration, replay } from './helpers/ledger-v2-foundation-fixtures';

const base='6cafd6cfcf4a3f1467bfb1a71a7ef0d9b421baa8';
const migration='20261021134359_m175_v1_s1a1_2a_ledger_v2_write_cutover.sql';
function files(dir: string): string[] {
  return readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?files(join(dir,e.name)):/\.tsx?$/.test(e.name)?[join(dir,e.name)]:[]);
}
test('2A write inventory exactly discovery/Talk; no raw application ledger append or direct source DML',()=>{
  const app=join(ledgerRepo,'apps/dashboard');
  const sources=['app','lib','repositories','services'].flatMap(d=>files(join(app,d)));
  const writers=sources.filter(f=>/\bawait appendLedgerEvent\(/.test(readFileSync(f,'utf8')))
    .map(f=>relative(app,f).replaceAll('\\','/')).sort();
  assert.deepEqual(writers,['app/api/discovery/scan/route.ts','services/talk.ts']);
  for(const f of sources) {
    const text=readFileSync(f,'utf8');
    assert.doesNotMatch(text,/\.rpc\(\s*["']ledger_append["']/i,f);
    assert.doesNotMatch(text,/\.from\(["']governance_ledger["']\)[\s\S]{0,40}\.(?:insert|upsert|update|delete)\(/i,f);
  }
});
test('2A is a single additive migration; historical foundation and all tenant read/Audit/authority surfaces untouched',()=>{
  // Frozen 2A scope receipt, as in the foundation test. Later authorized read
  // and Audit slices have their own current-path source contracts.
  const end='a8a72f2df1d57196e83cd512525e6dd10e6611de';
  const names=execFileSync('git',['ls-tree','--name-only',end+':supabase/migrations'],{cwd:ledgerRepo,encoding:'utf8'}).trim().split(/\r?\n/).sort();
  assert.deepEqual(names,[...replay.applied.map(p=>p.split('/').at(-1)!),migration]);
  const paths=['supabase/migrations/'+ledgerMigration,'apps/dashboard/app/api/audit','apps/dashboard/repositories/audit.ts',
    'apps/dashboard/app/(dashboard)/audit','apps/dashboard/components/audit','docs/architecture','packages/canonical-contracts','packages/governance-review'];
  assert.equal(execFileSync('git',['diff','--name-only',base,end,'--',...paths],{cwd:ledgerRepo,encoding:'utf8'}).trim(),'');
  const sql=readFileSync(join(ledgerRepo,'supabase/migrations',migration),'utf8');
  assert.doesNotMatch(sql,/CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+gov_repo\.ledger_tenant_(?:verify|events|event)_v2/i);
  assert.doesNotMatch(sql,/^\s*CALL\s+gov_repo\.ledger_v2_activate/im,'migration alone never activates');
});
