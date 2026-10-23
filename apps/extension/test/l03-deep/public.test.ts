import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
// Existing Mocha dependency; a local typed require avoids adding a declaration package.
const { load } = require('js-yaml') as { load(text: string): unknown };
import { localDependencies, output, potentialFinding, assertSafe } from './fixtures';
import { getPromptForFramework } from '../../src/intelligence/prompts';
import { getFrameworksByRegion } from '../../src/intelligence/frameworks';
import { ComplianceOrchestrator } from '../../src/intelligence/orchestrator';
import { GET } from '../../api/openapi';
import { technicalReviewSchemas } from '../../api/review-schema';
import type { TechnicalFrameworkReviewResult, FrameworkReviewResult } from '../../src/intelligence/review-contract';
import { CodeGuardClient } from '../../packages/sdk/src/index';
import type { TechnicalFrameworkReviewResult as SDKReview } from '../../packages/sdk/src/index';
// @ts-expect-error old determination contracts have no compatibility aliases
import type { ConsolidatedAuditResult, FrameworkAuditResult, ComplianceIssue } from '../../src/intelligence/orchestrator';
// @ts-expect-error removed misleading public SDK finding name
import type { ComplianceIssue as SDKComplianceIssue } from '../../packages/sdk/src/index';

const root = resolve(__dirname, '../..');
const source = (path: string) => readFileSync(resolve(root, path), 'utf8').replace(/\r\n/g, '\n');
// Native VS Code is supplied by Extension Host in production. HTTP tests use the
// existing repository API shim, without changing production bootstrap/transport.
require('module-alias').addAlias('vscode', resolve(root, 'api/vscode-shim.ts'));

test('closed runtime/SDK types forbid attainment fields and affirmative boundary', () => {
    function negative(result: TechnicalFrameworkReviewResult, framework: FrameworkReviewResult, sdk: SDKReview) {
        const sdkMirror: SDKReview = result;
        const runtimeMirror: TechnicalFrameworkReviewResult = sdk;
        // @ts-expect-error no aggregate framework conclusion
        result.overall_status;
        // @ts-expect-error no framework conclusion
        framework.status_overall;
        // @ts-expect-error no statutory compliance determination
        sdk.compliant;
        // @ts-expect-error no inferred certification
        sdk.certified;
        // @ts-expect-error no alignment percentage
        sdk.alignment;
        // @ts-expect-error no compliance score
        sdk.compliance_score;
        // @ts-expect-error no certification state
        sdk.certification_status;
        // @ts-expect-error closed negative authority
        const boundary: SDKReview['analysis_boundary']['certification'] = true;
        // @ts-expect-error no favorable framework attainment state
        const state: FrameworkReviewResult['analysis_state'] = 'pass';
        // @ts-expect-error no warning framework attainment state
        const warning: FrameworkReviewResult['analysis_state'] = 'warn';
        // @ts-expect-error infrastructure failure is not framework failure
        const failure: FrameworkReviewResult['analysis_state'] = 'fail';
        return [sdkMirror, runtimeMirror, boundary, state, warning, failure];
    }
    assert.equal(typeof negative, 'function');
});

const frameworkIds = new Set(['MDR_HIPAA', ...['BR','EU','US'].flatMap(region => getFrameworksByRegion(region as 'BR').map(f => f.id))]);
for (const id of frameworkIds) {
    test(`bounded prompt for every active reference: ${id}`, () => {
        const prompt = getPromptForFramework(id);
        const text = prompt.systemPrompt + prompt.userPromptTemplate;
        assert.match(text, /technical code-review assistant/);
        assert.match(text, /Do not determine legal compliance or legal applicability/);
        assert.match(text, /Do not infer absence of findings as satisfaction/);
        assert.match(text, /Analyze only supplied source\/context/);
        assert.match(text, /human\/domain\/legal review/);
        assert.match(text, /external organizational\/legal facts/);
        assert.match(prompt.userPromptTemplate, new RegExp(`"framework": "${id}"`));
        assert.equal(prompt.userPromptTemplate.split('{CODE_CONTENT}').length, 2);
        assert.doesNotMatch(text, /You are (?:a |an )?(?:.*Compliance Auditor|.*Compliance Officer|.*Lead Auditor)|status_overall|risk_classification|risk_class"|entity_type/);
        assert.match(text, /NO_FINDINGS_DETECTED/);
    });
}

test('deep runtime/public source guards prohibit legacy conclusions and fallback results', () => {
    for (const path of ['src/intelligence/orchestrator.ts', 'src/intelligence/review-contract.ts', 'src/intelligence/prompts/index.ts',
        'src/ui/dashboard.ts', 'src/ui/diagnostics.ts', 'src/ui/quickFix.ts', 'src/extension.ts',
        'src/core/dispatcher.ts', 'api/scan.ts', 'api/v1/scan.ts', 'api/openapi.ts', 'api/review-schema.ts', 'packages/sdk/src/index.ts']) {
        assert.doesNotMatch(source(path), /status_overall|overall_status|ConsolidatedAuditResult|FrameworkAuditResult|ComplianceIssue|CERTIFIED COMPLIANT|copyBadge|Certified-success|risk_classification|\bcompliance_score\b/, path);
    }
    assert.doesNotMatch(source('src/intelligence/orchestrator.ts'), /compliance rules for|parsed\.summary|Raw response|raw\.substring/);
    assert.match(source('src/intelligence/orchestrator.ts'), /source-code technical signals relevant to/);
    assert.match(source('src/intelligence/orchestrator.ts'), /success: frameworkResult\.completeness === 'COMPLETE'/);
    assert.match(source('src/ui/diagnostics.ts'), /Potential technical finding \(untrusted model output\)/);
    assert.match(source('src/ui/diagnostics.ts'), /TECHNICAL_REVIEW_HINT/);
    assert.match(source('src/ui/quickFix.ts'), /Fix with CodeGuard/);
    assert.doesNotMatch(source('src/ui/quickFix.ts'), /compliance failed|certified|framework violation/i);
});

test('package/commands and reachable templates use technical wording and closed result', () => {
    const pkg = JSON.parse(source('package.json'));
    assert.match(pkg.contributes.commands.find((c: any) => c.command === 'codeguard.complianceAudit').title, /Technical Framework Review/);
    for (const path of ['package.json', 'glama.json', 'packages/sdk/package.json', 'packages/sdk/README.md', 'templates/bolt/src/App.tsx', 'templates/lovable/README.md', 'templates/nextjs/pages/api/scan.ts']) {
        assert.doesNotMatch(source(path), /Compliance Engine|Compliance Orchestrator|Deep Compliance Audit|regulatory auditing|result\.issues|No issues found|text-green|✅/i, path);
    }
    assert.match(source('templates/bolt/src/App.tsx'), /analysis_state.*completeness/);
    assert.match(source('templates/bolt/src/App.tsx'), /review\.limitations/);
    assert.doesNotMatch(source('examples/api-consumption.js'), /No compliance violations found|Compliance violations found|summary\.total_violations/);
    assert.deepEqual(JSON.parse(source('.well-known/mcp/server-card.json')).tools, []);
    assert.doesNotMatch(source('smithery.yaml') + source('api/docs.ts'), /compliance|certif|pass\/fail/i);
});

test('OpenAPI endpoint and YAML agree on the entire closed deep-review schema', async () => {
    const response = await GET(new Request('https://local.invalid/api/openapi'));
    const spec = await response.json() as any;
    const yaml = load(source('docs/openapi.yaml')) as any;
    for (const [name, schema] of Object.entries(technicalReviewSchemas)) {
        assert.deepEqual(spec.components.schemas[name], schema);
        assert.deepEqual(yaml.components.schemas[name], schema);
    }
    assert.equal(spec.paths['/api/scan'].post.responses['200'].content['application/json'].schema.$ref, '#/components/schemas/ScanResult');
    assert.equal(spec.paths['/api/v1/scan'].post.responses['200'].content['application/json'].schema.$ref, '#/components/schemas/V1ScanResult');
    assert.doesNotMatch(JSON.stringify(spec), /status_overall|overall_status|risk_classification/);
    assert.equal(technicalReviewSchemas.AnalysisBoundary.properties.certification.enum[0], false);
});

for (const [label, value] of [['zero findings', output()], ['findings', output('GDPR', [potentialFinding])], ['UNKNOWN', '{bad']] as const) {
    test(`both HTTP scan routes preserve the safe ${label} contract`, async t => {
        localDependencies(t, [value, value]);
        const old = { keys: process.env.CODEGUARD_API_KEYS, license: process.env.CODEGUARD_LICENSE_KEY, secret: process.env.CODEGUARD_API_SECRET };
        t.after(() => {
            for (const [key, val] of Object.entries({ CODEGUARD_API_KEYS: old.keys, CODEGUARD_LICENSE_KEY: old.license, CODEGUARD_API_SECRET: old.secret })) {
                if (val === undefined) delete process.env[key]; else process.env[key] = val;
            }
        });
        process.env.CODEGUARD_API_KEYS = 'local-test-key';
        process.env.CODEGUARD_LICENSE_KEY = 'pro_local_test';
        process.env.CODEGUARD_API_SECRET = 'local-test-secret-long-enough';
        const { POST } = await import('../../api/scan');
        const { handler } = await import('../../api/v1/scan');
        const body = JSON.stringify({ region: 'EU', frameworks: ['GDPR'], code: 'const count = 1;' });
        const first = await POST(new Request('https://local.invalid/api/scan', { method: 'POST', headers: { authorization: 'Bearer local-test-key' }, body }));
        assert.equal(first.status, 200);
        const flat = await first.json() as any;
        assert.equal(flat.success, true);
        assertSafe(flat);
        const second = await handler(new Request('https://local.invalid/api/v1/scan', { method: 'POST', headers: { authorization: 'Bearer local-test-secret-long-enough' }, body }));
        assert.equal(second.status, 200);
        const wrapped = await second.json() as any;
        assert.equal(wrapped.success, true);
        assertSafe(wrapped.result);
        assert.equal(flat.results[0].analysis_state, wrapped.result.results[0].analysis_state);
        assert.equal(wrapped.result.acquisition.state, 'COMPLETE');
        const unauthorized = await handler(new Request('https://local.invalid/api/v1/scan', { method: 'POST', body }));
        assert.equal(unauthorized.status, 401);
        assert.equal((await POST(new Request('https://local.invalid/api/scan', { method: 'POST', body }))).status, 401);
    });
}

test('SDK client preserves actual v1 safe envelope, UNKNOWN and authority boundary', async t => {
    localDependencies(t, ['{bad']);
    const result = await new ComplianceOrchestrator().runAudit('EU', ['GDPR']);
    t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ success: true, result }), { status: 200 }));
    const response = await new CodeGuardClient({ baseUrl: 'https://local.invalid' }).scan({ code: 'const count = 1;', region: 'EU' });
    assert.ok(response.result);
    assertSafe(response.result);
    assert.equal(response.result.results[0].analysis_state, 'UNKNOWN');
});

test('MCP descriptor and serialization execute with a local dispatcher substitute, without starting a server', async t => {
    localDependencies(t, [output('GDPR', [potentialFinding])]);
    const result = await new ComplianceOrchestrator().runAudit('EU', ['GDPR']);
    const tools: Array<{ name: string; description: string; handler: (args: any) => Promise<any> }> = [];
    class Server {
        tool(name: string, description: string, schema: any, handler: (args: any) => Promise<any>) { tools.push({ name, description, handler }); }
        async connect() {}
    }
    const transpiled = ts.transpileModule(source('src/mcp-server.ts'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true }, reportDiagnostics: true });
    assert.equal(transpiled.diagnostics?.length, 0);
    const req = (id: string): any => {
        if (id === 'dotenv/config') return {};
        if (id.includes('/server/mcp')) return { McpServer: Server };
        if (id.includes('/server/stdio')) return { StdioServerTransport: class {} };
        if (id.includes('/server/sse')) return { SSEServerTransport: class {} };
        if (id === './core/dispatcher') return { AuditDispatcher: class { async dispatch() { return result; } } };
        if (id === './core/auth' || id === './core/security') return {};
        if (id === 'express') return () => { throw new Error('Server must not start in this test'); };
        if (id === 'zod/v3') return require('zod/v3');
        throw new Error(`Unexpected MCP dependency: ${id}`);
    };
    vm.runInNewContext(transpiled.outputText, { exports: {}, require: req, process: { env: { TRANSPORT_MODE: 'stdio' }, exit: () => { throw new Error('Unexpected exit'); } }, console: { error() {} } });
    const tool = tools.find(tool => tool.name === 'codeguard_audit');
    assert.ok(tool);
    assert.match(tool.description, /technical framework review.*non-authoritative/);
    assert.doesNotMatch(tool.description, /Runs deep compliance audit/);
    const response = await tool.handler({ region: 'EU', frameworks: ['GDPR'] });
    assertSafe(JSON.parse(response.content[0].text));
    assert.equal(response.isError, false);
});

test('diagnostics and quick-fix source execute as engineering assistance only', async t => {
    localDependencies(t, [output('GDPR', [potentialFinding])]);
    const result = await new ComplianceOrchestrator().runAudit('EU', ['GDPR']);
    const diagnostics: any[] = [];
    const collection = { clear() {}, set(uri: any, values: any[]) { diagnostics.push(...values); } };
    class Range { start: { line: number }; constructor(start: number, a: number, b: number, c: number) { this.start = { line: start }; } }
    class Diagnostic { source = ''; code: any; constructor(public range: Range, public message: string, public severity: number) {} }
    class CodeAction { command: any; diagnostics: any; isPreferred: any; constructor(public title: string, public kind: any) {} }
    const vscode = { languages: { createDiagnosticCollection: () => collection }, Uri: { file: (path: string) => ({ fsPath: path }) }, Range, Diagnostic, CodeAction,
        DiagnosticSeverity: { Information: 2, Error: 0, Warning: 1 }, CodeActionKind: { QuickFix: 'quickfix' } };
    const evaluate = (path: string) => {
        const exports: any = {};
        const compiled = ts.transpileModule(source(path), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } });
        vm.runInNewContext(compiled.outputText, { exports, require: (id: string) => { assert.equal(id, 'vscode'); return vscode; } });
        return exports;
    };
    evaluate('src/ui/diagnostics.ts').DiagnosticsManager.getInstance().updateDiagnostics(result);
    assert.equal(diagnostics.length, 1);
    assert.match(diagnostics[0].message, /Potential technical finding \(untrusted model output\)/);
    assert.equal(diagnostics[0].code, potentialFinding.reference_hint);
    const provider = new (evaluate('src/ui/quickFix.ts').CodeGuardCodeActionProvider)();
    const actions = provider.provideCodeActions({}, {}, { diagnostics }, {});
    assert.equal(actions[0].command.command, 'codeguard.fix');
    assert.match(actions[0].title, /Fix with CodeGuard/);
    assert.doesNotMatch(actions[0].title, /framework failed|certified|compliance passed/i);
});
