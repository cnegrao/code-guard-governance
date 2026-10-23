import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { test } from 'node:test';
import ts from 'typescript';

const root = resolve(import.meta.dirname, '..');
const entrypoints = ['app/api/audit/integrity/route.ts', 'app/api/audit/events/route.ts', 'app/api/audit/events/[id]/route.ts',
  'app/(dashboard)/audit/page.tsx', 'app/(dashboard)/audit/[id]/page.tsx'];
const source = (file: string) => readFileSync(file, 'utf8');
function moduleImports(file: string) {
  const ast = ts.createSourceFile(file, source(file), ts.ScriptTarget.Latest, true);
  return ast.statements.filter(ts.isImportDeclaration).filter(node => !node.importClause?.isTypeOnly)
    .map(node => (node.moduleSpecifier as ts.StringLiteral).text);
}
function children(file: string) {
  return moduleImports(file).flatMap(specifier => {
    if (!specifier.startsWith('@/') && !specifier.startsWith('.')) return [];
    const path = specifier.startsWith('@/') ? join(root, specifier.slice(2)) : resolve(dirname(file), specifier);
    const found = [path + '.ts', path + '.tsx', join(path, 'index.ts')].find(existsSync);
    assert.ok(found, `unresolved active local dependency ${specifier} in ${file}`); return [found];
  });
}
function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? files(join(dir, entry.name)) : /\.tsx?$/.test(entry.name) ? [join(dir, entry.name)] : []);
}
test('complete active Audit import graph has no legacy/global fallback or raw global fields', () => {
  const visited = new Set<string>(), todo = entrypoints.map(path => join(root, path));
  while (todo.length) {
    const file = todo.pop()!; if (visited.has(file)) continue; visited.add(file);
    const text = source(file);
    assert.doesNotMatch(text, /\bledger_verify\b|repositories\/audit|services\/audit|\bhash_chain_valid\b|\bprevious_hash\b|\bentry_hash\b|\bentry_sequence\b|\.from\(\s*["']governance_ledger["']/, relative(root, file));
    todo.push(...children(file));
  }
  assert.ok(visited.has(join(root, 'lib/governance/ledger-read.ts')));
  assert.ok(visited.has(join(root, 'components/audit/use-audit-read.ts')));
  assert.ok(!visited.has(join(root, 'repositories/audit.ts')));
});
test('three routes bind the complete principal directly to the frozen adapter; no org-only service layer', () => {
  for (const [path, method] of entrypoints.slice(0, 3).map((path, i) => [path, ['verifyTenantLedger', 'listTenantLedgerEvents', 'getTenantLedgerEvent'][i]])) {
    const text = source(join(root, path));
    assert.match(text, /const principal = await requireVerifiedGovernancePrincipal\(\)/);
    assert.ok(text.includes(`${method}(principal`)); assert.doesNotMatch(text, /organisationId|db\.|service_role/);
  }
  assert.equal(existsSync(join(root, 'services/audit.ts')), false);
});
test('legacy repository is quarantined and imported by no app/lib/service/repository/component; bounded old script only', () => {
  assert.match(source(join(root, 'repositories/audit.ts')), /QUARANTINED LEGACY \/ NON-AUTHORITATIVE/);
  for (const directory of ['app', 'lib', 'services', 'repositories', 'components']) for (const file of files(join(root, directory))) {
    assert.ok(!moduleImports(file).some(specifier => /(?:repositories\/audit|services\/audit)$/.test(specifier)), relative(root, file));
  }
  const scripts = files(join(root, 'scripts')).filter(file => moduleImports(file).some(specifier => /repositories\/audit$/.test(specifier)));
  assert.deepEqual(scripts.map(file => relative(root, file).replaceAll('\\', '/')), ['scripts/accept-hosted-pre-demo.ts']);
  assert.match(source(scripts[0]), /QUARANTINED historical pre-V2/);
});
test('Audit presentation uses only cursor navigation, bounded language, separate payload authority and no aggregate/filter workaround', () => {
  const texts = [...entrypoints.slice(3), 'components/audit/AuditRecords.tsx', 'components/audit/use-audit-read.ts'].map(path => source(join(root, path))).join('\n');
  assert.doesNotMatch(texts, /tamper-proof|fully governed|audit-ready|totalPages|total_entries|latest_sequence|entries_last_30_days|events_by_type|date_from|date_to|subject_type["']\)|actor_id|Search events|\.catch\(\(\) => \{\}\)/);
  assert.match(texts, /next_cursor/); assert.match(texts, /setEventType\(event.target.value\); setCursor\(null\)/);
  assert.match(texts, /encodeURIComponent\(auditEventHandle\(event\)\)/);
  // Authority is projected from the frozen adapter, not re-authored by the UI.
  assert.match(texts, /event\.payload_authority/); assert.match(texts, /event\.legacy_payload_authority/);
  assert.match(texts, /current = false; controller.abort\(\)/); assert.match(texts, /cache: "no-store"/);
});
