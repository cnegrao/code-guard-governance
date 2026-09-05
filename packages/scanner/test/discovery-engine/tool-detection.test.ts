import assert from 'node:assert/strict';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { LocalRepositoryAdapter } from '../../src/discovery/adapters/local-repository-adapter';
import { DiscoveryPipeline, type DiscoveryRunResult } from '../../src/discovery/pipeline';
import { AgentKindDeclarationSpecification } from '../../src/discovery/strategies/agent-kind-declaration';
import { ModelReferenceDeclarationSpecification } from '../../src/discovery/strategies/model-reference-declaration';
import { ToolListDeclarationSpecification } from '../../src/discovery/strategies/tool-list-declaration';

const GOLDEN_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'discovery-validation-lab',
  'golden-repositories',
);

const OBSERVED_AT = '2026-01-01T00:00:00.000Z';

function fixedClock() {
  return { now: () => OBSERVED_AT };
}

async function runDiscovery(scenario: string): Promise<DiscoveryRunResult> {
  const pipeline = new DiscoveryPipeline(
    new LocalRepositoryAdapter(resolve(GOLDEN_ROOT, scenario)),
    [
      new AgentKindDeclarationSpecification(),
      new ModelReferenceDeclarationSpecification(),
      new ToolListDeclarationSpecification(),
    ],
    { clock: fixedClock() },
  );
  return pipeline.run();
}

function toolCandidates(result: DiscoveryRunResult) {
  return result.candidates.filter((candidate) => candidate.finding.candidateKind === 'TOOL');
}

async function withTempRepository(
  build: (root: string) => Promise<void>,
  run: (root: string) => Promise<void>,
): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'discovery-engine-tool-detection-'));
  try {
    await build(root);
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

describe('ToolListDeclarationSpecification: TOOL detection', () => {
  it('detects one explicit Tool in the 01-simple-agent golden repository (tools = [lookup_customer])', async () => {
    const result = await runDiscovery('01-simple-agent');
    const tools = toolCandidates(result);
    assert.equal(tools.length, 1);
    assert.equal(tools[0].displayValue, 'lookup_customer');
  });

  it('detects multiple Tools across the 02-multi-agent golden repository', async () => {
    const result = await runDiscovery('02-multi-agent');
    const tools = toolCandidates(result).map((candidate) => candidate.displayValue).sort();
    assert.deepEqual(tools, ['classifyRequest', 'readBalance', 'selectRetentionOption']);
  });

  it('detects every explicitly declared Tool for a single Agent (06-care-coordination)', async () => {
    const result = await runDiscovery('06-care-coordination');
    const tools = toolCandidates(result).map((candidate) => candidate.displayValue).sort();
    assert.deepEqual(tools, ['draft_care_plan', 'load_patient_record', 'require_human_approval']);
  });

  it('detects Tools declared on a non-Agent artifact (04-mcp-not-agent: tools = [lookupCatalog, listPolicies])', async () => {
    const result = await runDiscovery('04-mcp-not-agent');
    const tools = toolCandidates(result).map((candidate) => candidate.displayValue).sort();
    assert.deepEqual(tools, ['listPolicies', 'lookupCatalog']);
  });

  it('never matches the quoted-string tools array in mcp.json (only the bare-identifier code declaration counts)', async () => {
    const result = await runDiscovery('04-mcp-not-agent');
    // mcp.json declares `"tools": ["lookup_catalog", "list_policies"]` with
    // quoted strings; only src/server.ts's bare-identifier array counts.
    const fromMcpJson = toolCandidates(result).filter(
      (candidate) => candidate.finding.sourceObject.externalId === 'mcp.json',
    );
    assert.equal(fromMcpJson.length, 0);
  });

  it('produces zero Tool candidates for 03-monorepo (no tools = [...] declaration present)', async () => {
    const result = await runDiscovery('03-monorepo');
    assert.equal(toolCandidates(result).length, 0);
  });

  it('produces zero Tool candidates for the 05-false-positives golden repository', async () => {
    const result = await runDiscovery('05-false-positives');
    assert.equal(toolCandidates(result).length, 0);
  });

  it('does not infer a Tool merely because a generic function is declared, without a tools = [...] binding', async () => {
    await withTempRepository(
      async (root) => {
        await writeFile(
          root + '/lib.py',
          ['def lookup_customer(customer_id):', '    return customer_id', ''].join('\n'),
        );
      },
      async (root) => {
        const pipeline = new DiscoveryPipeline(new LocalRepositoryAdapter(root), [
          new ToolListDeclarationSpecification(),
        ]);
        const result = await pipeline.run();
        assert.equal(result.candidates.length, 0);
      },
    );
  });

  it('does not infer a Tool from a documentation/prose mention of "tools"', async () => {
    await withTempRepository(
      async (root) => {
        await writeFile(
          root + '/README.md',
          '# Overview\n\nThis project plans to add tools for its agents in the future.\n',
        );
      },
      async (root) => {
        const pipeline = new DiscoveryPipeline(new LocalRepositoryAdapter(root), [
          new ToolListDeclarationSpecification(),
        ]);
        const result = await pipeline.run();
        assert.equal(result.candidates.length, 0);
      },
    );
  });

  it('does not infer a Tool from a quoted-string or non-identifier tools array (ambiguous, fails closed)', async () => {
    await withTempRepository(
      async (root) => {
        await writeFile(
          root + '/config.ts',
          [
            'export const config = {',
            '  tools: ["not-an-identifier", "another"],',
            '};',
            '',
          ].join('\n'),
        );
      },
      async (root) => {
        const pipeline = new DiscoveryPipeline(new LocalRepositoryAdapter(root), [
          new ToolListDeclarationSpecification(),
        ]);
        const result = await pipeline.run();
        assert.equal(result.candidates.length, 0);
      },
    );
  });

  it('produces no Tool candidate for the reserved .govia-lab canary file (excluded path)', async () => {
    const result = await runDiscovery('01-simple-agent');
    for (const candidate of toolCandidates(result)) {
      assert.ok(!candidate.finding.sourceObject.externalId.includes('.govia-lab'));
      assert.ok(!candidate.finding.sourceObject.externalId.includes('leak-agent'));
    }
  });

  it('preserves evidence/provenance for detected Tool candidates', async () => {
    const result = await runDiscovery('01-simple-agent');
    const [tool] = toolCandidates(result);
    assert.ok(tool);
    assert.equal(tool.finding.assertionIds.length, 1);
    assert.equal(tool.finding.evidenceIds.length, 1);
    assert.equal(tool.assertion.trustState, 'INFERRED');
    assert.equal(tool.evidence.locations.length, 1);
    assert.equal(tool.evidence.locations[0].path, 'src/customer_support_agent.py');
    assert.ok(tool.evidence.redactedExcerpt);
    assert.match(tool.evidence.redactedExcerpt ?? '', /tools\s*=\s*\[lookup_customer\]/);
  });

  it('is deterministic across repeated runs against the same golden repository', async () => {
    const first = await runDiscovery('06-care-coordination');
    const second = await runDiscovery('06-care-coordination');
    assert.deepEqual(
      toolCandidates(first).map((candidate) => candidate.finding.findingId).sort(),
      toolCandidates(second).map((candidate) => candidate.finding.findingId).sort(),
    );
  });

  it('deduplicates a repeated identical identifier within the same declaration line', async () => {
    await withTempRepository(
      async (root) => {
        await writeFile(root + '/agent.ts', 'export const agent = {\n  tools: [doThing, doThing],\n};\n');
      },
      async (root) => {
        const pipeline = new DiscoveryPipeline(new LocalRepositoryAdapter(root), [
          new ToolListDeclarationSpecification(),
        ]);
        const result = await pipeline.run();
        assert.equal(result.candidates.length, 1);
        assert.equal(result.candidates[0].displayValue, 'doThing');
      },
    );
  });
});
