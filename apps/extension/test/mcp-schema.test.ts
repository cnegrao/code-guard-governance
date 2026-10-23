import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { z } from 'zod/v3';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

const extension = resolve(__dirname, '..');
const read = (path: string) => JSON.parse(readFileSync(path, 'utf8'));
const source = readFileSync(resolve(extension, 'src/mcp-server.ts'), 'utf8');
const tree = ts.createSourceFile('mcp-server.ts', source, ts.ScriptTarget.Latest, true);
const factoryNode = tree.statements.find((node): node is ts.FunctionDeclaration =>
    ts.isFunctionDeclaration(node) && node.name?.text === 'createMcpServer');
assert.ok(factoryNode);

async function connection() {
    const calls: Array<{ name: string; args: unknown }> = [];
    const result = { analysis_boundary: { authoritative: false, certification: false }, analysis_state: 'UNKNOWN' };
    const dispatcher = { async dispatch(name: string, args: unknown) { calls.push({ name, args }); return result; } };
    // Execute the actual registration function with the real SDK/Zod. Only dispatch is local;
    // application bootstrap, SSE/stdio, providers and filesystem analysis never start.
    const factory = vm.runInNewContext(`(${factoryNode!.getText(tree)})`, { McpServer, z, dispatcher }) as () => McpServer;
    const server = factory();
    const client = new Client({ name: 'local-schema-contract', version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    return { client, calls, result, async close() { await client.close(); await server.close(); } };
}

test('real MCP tools/list publishes every raw-shape field and required/optional distinction', async t => {
    const session = await connection(); t.after(() => session.close());
    const listed = await session.client.listTools();
    assert.deepEqual(listed.tools.map(tool => tool.name).sort(), ['codeguard_audit', 'codeguard_graph', 'detect_shadow_apis']);
    const expected: Record<string, { fields: string[]; required: string[] }> = {
        codeguard_audit: { fields: ['region', 'frameworks', 'filePath'], required: ['region', 'frameworks'] },
        codeguard_graph: { fields: ['filePath'], required: [] },
        detect_shadow_apis: { fields: ['content', 'filePath'], required: [] },
    };
    for (const tool of listed.tools) {
        assert.equal(tool.inputSchema.type, 'object');
        assert.deepEqual(Object.keys(tool.inputSchema.properties ?? {}).sort(), [...expected[tool.name].fields].sort());
        assert.deepEqual([...(tool.inputSchema.required ?? [])].sort(), [...expected[tool.name].required].sort());
    }
    const audit = listed.tools.find(tool => tool.name === 'codeguard_audit')!;
    const properties = audit.inputSchema.properties as Record<string, { type: string; enum?: string[]; items?: { type: string } }>;
    assert.equal(properties.region.type, 'string'); assert.deepEqual(properties.region.enum, ['BR', 'EU']);
    assert.equal(properties.frameworks.type, 'array'); assert.equal(properties.frameworks.items?.type, 'string');
    assert.equal(properties.filePath.type, 'string');
    assert.match(audit.description!, /technical framework review.*non-authoritative.*UNKNOWN/);
    assert.match(audit.description!, /never legal compliance or certification/);
    for (const tool of listed.tools.filter(tool => tool.name !== 'codeguard_audit')) {
        for (const property of Object.values(tool.inputSchema.properties ?? {})) assert.equal((property as { type: string }).type, 'string');
    }
});

test('real MCP tools/call validates and forwards all three callbacks without changing bounded text', async t => {
    const session = await connection(); t.after(() => session.close());
    const inputs = [
        { name: 'codeguard_audit', arguments: { region: 'EU', frameworks: ['GDPR'], filePath: 'input.ts' } },
        { name: 'codeguard_graph', arguments: { filePath: 'src' } },
        { name: 'detect_shadow_apis', arguments: { content: 'const count = 1;', filePath: 'input.ts' } },
        { name: 'codeguard_audit', arguments: { region: 'BR', frameworks: [] } },
        { name: 'codeguard_graph', arguments: {} },
        { name: 'detect_shadow_apis', arguments: {} },
    ];
    for (const input of inputs) {
        const output = await session.client.callTool(input);
        assert.equal(output.isError, false);
        assert.deepEqual(output.content, [{ type: 'text', text: JSON.stringify(session.result, null, 2) }]);
    }
    assert.deepEqual(session.calls, inputs.map(input => ({ name: input.name, args: input.arguments })));
});

test('real MCP validation rejects missing or malformed parameters before dispatch', async t => {
    const session = await connection(); t.after(() => session.close());
    for (const arguments_ of [{ region: 'EU' }, { frameworks: [] }, { region: 'US', frameworks: [] },
        { region: 'EU', frameworks: 'GDPR' }, { region: 'EU', frameworks: [], filePath: 3 }]) {
        const output = await session.client.callTool({ name: 'codeguard_audit', arguments: arguments_ });
        assert.equal(output.isError, true);
    }
    for (const name of ['codeguard_graph', 'detect_shadow_apis']) {
        assert.equal((await session.client.callTool({ name, arguments: { filePath: 3 } })).isError, true);
    }
    assert.deepEqual(session.calls, []);
});

test('explicit v3 entrypoint and both lock layouts retain compatible Zod without SDK or dashboard migration', () => {
    const repo = resolve(extension, '../..');
    const manifest = read(resolve(extension, 'package.json'));
    const workspace = read(resolve(repo, 'package-lock.json'));
    const standalone = read(resolve(extension, 'package-lock.json'));
    assert.equal(manifest.dependencies.zod, '3.25.76');
    assert.equal(manifest.dependencies['@modelcontextprotocol/sdk'], '^1.26.0');
    assert.equal(workspace.packages['apps/extension'].dependencies.zod, '3.25.76');
    assert.equal(standalone.packages[''].dependencies.zod, '3.25.76');
    for (const lock of [workspace, standalone]) {
        assert.equal(lock.packages['node_modules/zod'].version, '3.25.76');
        assert.equal(lock.packages['node_modules/@modelcontextprotocol/sdk'].peerDependencies.zod, '^3.25 || ^4.0');
        assert.equal(lock.packages['node_modules/@vercel/python-analysis/node_modules/zod'].version, '3.22.4');
    }
    assert.equal(workspace.packages['node_modules/@modelcontextprotocol/sdk'].version, '1.29.0');
    assert.equal(standalone.packages['node_modules/@modelcontextprotocol/sdk'].version, '1.26.0');
    assert.equal(read(resolve(repo, 'apps/dashboard/package.json')).dependencies.zod, '^3.24.2');
    assert.ok(tree.statements.some(node => ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier) && node.moduleSpecifier.text === 'zod/v3'));
    assert.strictEqual(require('zod').z, z, 'pinned Zod root and explicit v3 use the same runtime implementation');
});
