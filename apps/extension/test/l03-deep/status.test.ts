import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';
import ts from 'typescript';

const root = resolve(__dirname, '../../../..');
const c2b2ClosingCommit = 'e9293be4488112e703ab746c2f5f0fed301f3b7c';
test('additive L03 closure preserves history, every HOLD and unrelated authority', () => {
    const read = (path: string) => JSON.parse(readFileSync(resolve(root, path), 'utf8'));
    const status = read('docs/trust-assurance/l03-llm-deep-containment-status-v1.json');
    assert.equal(status.starting_head, 'c37d613730a8f4a915125aa7875180ce044cb201');
    assert.equal(status.slice_status, 'CLOSED / PASS');
    assert.equal(status.l03_overall, 'CONTAINED / PASS - LOCAL');
    assert.equal(status.v1_s1b_status, 'OPEN');
    assert.equal(status.m17_5_status, 'OPEN');
    for (const state of Object.values(status.readiness)) assert.equal(state, 'HOLD');
    assert.deepEqual(status.gates.map((gate: any) => gate.id), Array.from({ length: 21 }, (_, i) => i + 1));
    for (const gate of status.gates) assert.equal(gate.result, 'PASS');
    for (const key of ['database_delta', 'migration_delta', 'hosted_delta']) assert.equal(status[key], 0);
    assert.equal(status.hosted_verified, false);
    assert.equal(status.next_checkpoint_started, false);
    assert.equal(status.next_checkpoint_authorized, false);
    assert.equal(status.validation.extension_global_typecheck, 'BASELINE_TS2589_UNCHANGED');
    const historical = read('docs/trust-assurance/l03-extension-deterministic-containment-status-v1.json');
    assert.equal(historical.l03_overall, 'NEEDS_CONTAINMENT');
    const git = (args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
    // This receipt protects the closed C2B-2 slice, not every later authorized slice.
    git(['rev-parse', '--verify', `${c2b2ClosingCommit}^{commit}`]);
    git(['merge-base', '--is-ancestor', status.starting_head, c2b2ClosingCommit]);
    git(['merge-base', '--is-ancestor', c2b2ClosingCommit, 'HEAD']);
    assert.equal(git(['rev-parse', `${c2b2ClosingCommit}^`]), status.starting_head);
    assert.equal(git(['rev-parse', `${c2b2ClosingCommit}^{tree}`]), '1a068d1bf93e23227745ba590d5cd5a3b442bdfc');
    const unchanged = execFileSync('git', ['diff', '--name-only', status.starting_head, c2b2ClosingCommit, '--', 'supabase', 'packages/scanner/src',
        'packages/canonical-contracts', 'packages/governance-review', 'apps/dashboard',
        'docs/trust-assurance/l03-extension-deterministic-containment-status-v1.json',
        'docs/trust-assurance/l02-scanner-containment-status-v1.json',
        'docs/codex/evidence/2026-10-21-m17.5-v1-s1b-c2b1-l03-extension-deterministic-containment.md'], { cwd: root, encoding: 'utf8' });
    assert.equal(unchanged.trim(), '');
    // MCP semantics are independent from the separately recorded TS2589 location.
    const mcp = readFileSync(resolve(root, 'apps/extension/src/mcp-server.ts'), 'utf8');
    const tree = ts.createSourceFile('mcp-server.ts', mcp, ts.ScriptTarget.Latest, true);
    const tools: ts.CallExpression[] = [];
    const visit = (node: ts.Node) => {
        if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'tool' &&
            node.arguments[0] && ts.isStringLiteral(node.arguments[0]) && node.arguments[0].text === 'codeguard_audit') tools.push(node);
        ts.forEachChild(node, visit);
    };
    visit(tree);
    assert.equal(tools.length, 1);
    assert.match(mcp, /LEGACY_TRANSPORT_IDENTIFIER: codeguard_audit; technical review only/);
    const description = tools[0].arguments[1];
    assert.ok(ts.isStringLiteral(description));
    assert.match(description.text, /technical framework review.*non-authoritative.*UNKNOWN/);
    assert.match(description.text, /never legal compliance or certification/);
    const handler = tools[0].arguments[3];
    assert.ok(ts.isArrowFunction(handler));
    // The existing executable MCP fixture checks this forwarded result against
    // the safe runtime contract. This guard verifies the actual transport edge.
    assert.match(handler.body.getText(tree), /const result = await dispatcher\.dispatch\('codeguard_audit', args\)/);
    assert.match(handler.body.getText(tree), /text: JSON\.stringify\(result, null, 2\)/);
    assert.doesNotMatch(handler.body.getText(tree), /status_overall|overall_status|compliant|certified/);
});
