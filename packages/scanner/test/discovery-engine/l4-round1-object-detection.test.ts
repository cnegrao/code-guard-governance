import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';

import type { DiscoveryCandidateKind } from '@council/canonical-contracts';

import { LocalRepositoryAdapter } from '../../src/discovery/adapters/local-repository-adapter';
import {
  ApiCandidateNormalizationStrategy,
  KnowledgeBaseCandidateNormalizationStrategy,
  McpServerCandidateNormalizationStrategy,
  normalizeObjectCandidate,
  OBJECT_NORMALIZATION_REASON_CODE,
  PromptCandidateNormalizationStrategy,
  SkillCandidateNormalizationStrategy,
} from '../../src/discovery/object-candidate-normalization';
import { DiscoveryPipeline } from '../../src/discovery/pipeline';
import { ApiDeclarationSpecification } from '../../src/discovery/strategies/api-declaration';
import { KnowledgeBaseDeclarationSpecification } from '../../src/discovery/strategies/knowledge-base-declaration';
import { McpServerDeclarationSpecification } from '../../src/discovery/strategies/mcp-server-declaration';
import { PromptDeclarationSpecification } from '../../src/discovery/strategies/prompt-declaration';
import { SkillListDeclarationSpecification } from '../../src/discovery/strategies/skill-list-declaration';
import type { DiscoveryCandidate } from '../../src/discovery/evidence-assembly';

// This suite deliberately uses synthetic fixtures outside the frozen Golden
// Repository oracle (packages/scanner/test/discovery-validation-lab/**,
// never modified here), but every fixture shape below mirrors the exact
// real-source convention already established by that oracle's own fixtures
// (01-simple-agent's SUPPORT_PROMPT, 06-care-coordination's CARE_NETWORK_API/
// knowledge-base.yaml, 04-mcp-not-agent's mcp.json) — read, never modified,
// to derive each detector's real pattern. See each strategy file's own doc
// comment for the exact fixture it was derived from.

function fixedClock() {
  return { now: () => '2026-01-01T00:00:00.000Z' };
}

async function withTempRepository(
  files: Record<string, string>,
  run: (root: string) => Promise<void>,
): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'l4-round1-object-detection-'));
  try {
    for (const [name, content] of Object.entries(files)) {
      const filePath = join(root, name);
      await mkdir(dirname(filePath), { recursive: true });
      await writeFile(filePath, content);
    }
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function scan(root: string) {
  const pipeline = new DiscoveryPipeline(
    new LocalRepositoryAdapter(root),
    [
      new PromptDeclarationSpecification(),
      new McpServerDeclarationSpecification(),
      new ApiDeclarationSpecification(),
      new KnowledgeBaseDeclarationSpecification(),
      new SkillListDeclarationSpecification(),
    ],
    { clock: fixedClock() },
  );
  return pipeline.run();
}

function candidatesByKind(
  candidates: readonly DiscoveryCandidate[],
  kind: DiscoveryCandidateKind,
): readonly DiscoveryCandidate[] {
  return candidates.filter((c) => c.finding.candidateKind === kind);
}

describe('PROMPT: real `<NAME>_PROMPT = "..."` constant convention (matches 01-simple-agent/02-multi-agent/06-care-coordination)', () => {
  it('detects a Python module-level `<NAME>_PROMPT = "..."` constant and promotes the identifier, never the string content, to declarationKey', async () => {
    await withTempRepository(
      { 'agent.py': 'SUPPORT_PROMPT = "Assist with account questions using only approved records."\n' },
      async (root) => {
        const { candidates } = await scan(root);
        const found = candidatesByKind(candidates, 'PROMPT');
        assert.equal(found.length, 1);
        const normalized = normalizeObjectCandidate(found[0]);
        assert.equal(normalized.status, 'NORMALIZED');
        if (normalized.status === 'NORMALIZED' && normalized.candidate.candidateKind === 'PROMPT') {
          assert.equal(normalized.candidate.proposedIdentity.declarationKey, 'SUPPORT_PROMPT');
        }
      },
    );
  });

  it('detects the TypeScript `export const <NAME>_PROMPT = "..."` convention (matches 02-multi-agent)', async () => {
    await withTempRepository(
      { 'agent.ts': 'export const TRIAGE_PROMPT = "Route synthetic requests to the correct team.";\n' },
      async (root) => {
        const { candidates } = await scan(root);
        const found = candidatesByKind(candidates, 'PROMPT');
        assert.equal(found.length, 1);
        const normalized = normalizeObjectCandidate(found[0]);
        if (normalized.status === 'NORMALIZED' && normalized.candidate.candidateKind === 'PROMPT') {
          assert.equal(normalized.candidate.proposedIdentity.declarationKey, 'TRIAGE_PROMPT');
        }
      },
    );
  });

  it('never leaks raw prompt content: a bare reference (`instructions = SUPPORT_PROMPT`) is never re-matched as a second Prompt', async () => {
    await withTempRepository(
      {
        'agent.py': [
          'SUPPORT_PROMPT = "Assist with account questions using only approved records."',
          'instructions = SUPPORT_PROMPT',
        ].join('\n'),
      },
      async (root) => {
        const { candidates } = await scan(root);
        assert.equal(candidatesByKind(candidates, 'PROMPT').length, 1);
      },
    );
  });

  it('PROMPT canonical identity (candidateId) is content-independent: two different prompt string values under the identical declaration key produce the identical candidateId', async () => {
    // Scans the SAME temp root (same SourceConnection) both times, overwriting
    // the file in place — two independent mkdtemp roots would legitimately
    // differ by sourceScope/connection alone, which would prove nothing about
    // content-independence specifically.
    await withTempRepository({ 'agent.py': 'SUPPORT_PROMPT = "Assist with account questions."\n' }, async (root) => {
      const before = await scan(root);
      const beforeCandidate = candidatesByKind(before.candidates, 'PROMPT')[0];
      const beforeNormalized = normalizeObjectCandidate(beforeCandidate);
      assert.equal(beforeNormalized.status, 'NORMALIZED');

      await writeFile(join(root, 'agent.py'), 'SUPPORT_PROMPT = "A completely different prompt body."\n');
      const after = await scan(root);
      const afterCandidate = candidatesByKind(after.candidates, 'PROMPT')[0];
      const afterNormalized = normalizeObjectCandidate(afterCandidate);
      assert.equal(afterNormalized.status, 'NORMALIZED');

      if (beforeNormalized.status === 'NORMALIZED' && afterNormalized.status === 'NORMALIZED') {
        assert.equal(
          afterNormalized.candidate.candidateId,
          beforeNormalized.candidate.candidateId,
          'canonical PROMPT identity must never depend on the prompt\'s own string content, only its declaration key',
        );
      }
    });
  });

  it('evidence never persists the full raw Prompt literal by default: the redacted excerpt shows only the declaration shape', async () => {
    await withTempRepository(
      { 'agent.py': 'SUPPORT_PROMPT = "This exact sentence must never appear in the evidence excerpt."\n' },
      async (root) => {
        const { candidates } = await scan(root);
        const found = candidatesByKind(candidates, 'PROMPT');
        assert.equal(found.length, 1);
        const excerpt = found[0].evidence.redactedExcerpt ?? '';
        assert.equal(excerpt.includes('This exact sentence'), false, 'raw prompt content must never leak into the evidence excerpt');
        assert.equal(excerpt, 'SUPPORT_PROMPT = <redacted>');
      },
    );
  });

  it('a docstring or prose mentioning "prompt" produces no candidate (no `_PROMPT`-suffixed constant present)', async () => {
    await withTempRepository(
      { 'agent.py': '"""This agent uses a carefully engineered prompt to answer questions."""\n' },
      async (root) => {
        const { candidates } = await scan(root);
        assert.equal(candidatesByKind(candidates, 'PROMPT').length, 0);
      },
    );
  });

  it('a variable NOT ending in `_PROMPT` is never treated as a Prompt (e.g. SYSTEM_MESSAGE)', async () => {
    await withTempRepository({ 'agent.py': 'SYSTEM_MESSAGE = "You are a helpful assistant."\n' }, async (root) => {
      const { candidates } = await scan(root);
      assert.equal(candidatesByKind(candidates, 'PROMPT').length, 0);
    });
  });

  it('PromptCandidateNormalizationStrategy fails closed on a blank displayValue', () => {
    const strategy = new PromptCandidateNormalizationStrategy();
    const result = strategy.normalize({
      finding: {
        findingId: 'discovery-finding:x' as never,
        findingNature: 'CANDIDATE',
        candidateKind: 'PROMPT',
        sourceObject: { connectionId: 'c' as never, externalType: 'file', externalId: 'x.py' as never },
        assertionIds: ['a' as never],
        evidenceIds: ['e' as never],
        confidence: 0.6,
        reviewStatus: 'UNREVIEWED',
        requiresReview: true,
        createsCanonicalObject: false,
        detectedAt: '2026-01-01T00:00:00.000Z' as never,
      },
      assertion: {} as never,
      evidence: {} as never,
      displayValue: '   ',
    });
    assert.equal(result.status, 'NOT_SAFELY_NORMALIZABLE');
    if (result.status === 'NOT_SAFELY_NORMALIZABLE') {
      assert.equal(result.reasonCode, OBJECT_NORMALIZATION_REASON_CODE.EMPTY_IDENTITY_VALUE);
    }
  });
});

describe('MCP_SERVER: real `mcp.json`-shaped config convention (matches 04-mcp-not-agent)', () => {
  it('detects a Golden-Repository-shaped `{ "serverIdentity": "..." }` mcp.json and promotes serverIdentity to serverReference', async () => {
    await withTempRepository(
      {
        'mcp.json': JSON.stringify({
          serverIdentity: 'synthetic-catalog-mcp',
          entrypoint: 'src/server.ts',
          tools: ['lookup_catalog', 'list_policies'],
        }),
      },
      async (root) => {
        const { candidates } = await scan(root);
        const found = candidatesByKind(candidates, 'MCP_SERVER');
        assert.equal(found.length, 1);
        const normalized = normalizeObjectCandidate(found[0]);
        assert.equal(normalized.status, 'NORMALIZED');
        if (normalized.status === 'NORMALIZED' && normalized.candidate.candidateKind === 'MCP_SERVER') {
          assert.equal(normalized.candidate.proposedIdentity.serverReference, 'synthetic-catalog-mcp');
        }
      },
    );
  });

  it('detects a legacy-shaped `{ "mcpServers": { "name": {...} } }` claude_desktop_config.json and promotes each named key', async () => {
    await withTempRepository(
      {
        'claude_desktop_config.json': JSON.stringify({
          mcpServers: { filesystem: { command: 'npx', args: ['-y', 'x'] }, github: { command: 'npx' } },
        }),
      },
      async (root) => {
        const { candidates } = await scan(root);
        const found = candidatesByKind(candidates, 'MCP_SERVER');
        assert.equal(found.length, 2);
        const values = found
          .map((c) => {
            const normalized = normalizeObjectCandidate(c);
            return normalized.status === 'NORMALIZED' && normalized.candidate.candidateKind === 'MCP_SERVER'
              ? normalized.candidate.proposedIdentity.serverReference
              : undefined;
          })
          .sort();
        assert.deepEqual(values, ['filesystem', 'github']);
      },
    );
  });

  it('a Tool declaration or an mcp-related import in an unrelated, non-config-path file never implies an MCP_SERVER candidate', async () => {
    await withTempRepository(
      { 'agent.py': ['import mcp', 'from modelcontextprotocol import Client', 'tools = [search_docs]'].join('\n') },
      async (root) => {
        const { candidates } = await scan(root);
        assert.equal(candidatesByKind(candidates, 'MCP_SERVER').length, 0);
      },
    );
  });

  it('invalid JSON at a recognized MCP config path fails closed (no candidate, no throw)', async () => {
    await withTempRepository({ 'mcp.json': '{ not valid json' }, async (root) => {
      const { candidates } = await scan(root);
      assert.equal(candidatesByKind(candidates, 'MCP_SERVER').length, 0);
    });
  });

  it('McpServerCandidateNormalizationStrategy fails closed on a blank displayValue', () => {
    const strategy = new McpServerCandidateNormalizationStrategy();
    const result = strategy.normalize({
      finding: {
        findingId: 'discovery-finding:x' as never,
        findingNature: 'CANDIDATE',
        candidateKind: 'MCP_SERVER',
        sourceObject: { connectionId: 'c' as never, externalType: 'file', externalId: 'x.py' as never },
        assertionIds: ['a' as never],
        evidenceIds: ['e' as never],
        confidence: 0.6,
        reviewStatus: 'UNREVIEWED',
        requiresReview: true,
        createsCanonicalObject: false,
        detectedAt: '2026-01-01T00:00:00.000Z' as never,
      },
      assertion: {} as never,
      evidence: {} as never,
      displayValue: '',
    });
    assert.equal(result.status, 'NOT_SAFELY_NORMALIZABLE');
  });
});

describe('API: real `<NAME>_API = { "id": "..." }` object-literal convention (matches 06-care-coordination)', () => {
  it('detects the object literal and promotes only its explicit id field to apiReference', async () => {
    await withTempRepository(
      {
        'agent.py': [
          'CARE_NETWORK_API = {',
          '    "id": "care-network-api",',
          '    "base_url": "https://care-network.invalid/v1/follow-ups",',
          '}',
          '',
        ].join('\n'),
      },
      async (root) => {
        const { candidates } = await scan(root);
        const found = candidatesByKind(candidates, 'API');
        assert.equal(found.length, 1);
        const normalized = normalizeObjectCandidate(found[0]);
        assert.equal(normalized.status, 'NORMALIZED');
        if (normalized.status === 'NORMALIZED' && normalized.candidate.candidateKind === 'API') {
          assert.equal(normalized.candidate.proposedIdentity.apiReference, 'care-network-api');
        }
      },
    );
  });

  it('a bare URL literal anywhere in prose/code never becomes an API candidate on its own', async () => {
    await withTempRepository(
      { 'agent.py': ['# See https://example.com/docs for details', 'endpoint = "https://api.example.com/v1"'].join('\n') },
      async (root) => {
        const { candidates } = await scan(root);
        assert.equal(candidatesByKind(candidates, 'API').length, 0);
      },
    );
  });

  it('an `_API` object literal with zero or multiple `id` fields fails closed (ambiguous)', async () => {
    await withTempRepository(
      {
        'agent.py': ['BILLING_API = {', '    "base_url": "https://billing.invalid",', '}', ''].join('\n'),
      },
      async (root) => {
        const { candidates } = await scan(root);
        assert.equal(candidatesByKind(candidates, 'API').length, 0);
      },
    );
  });

  it('ApiCandidateNormalizationStrategy fails closed on a blank displayValue', () => {
    const strategy = new ApiCandidateNormalizationStrategy();
    const result = strategy.normalize({
      finding: {
        findingId: 'discovery-finding:x' as never,
        findingNature: 'CANDIDATE',
        candidateKind: 'API',
        sourceObject: { connectionId: 'c' as never, externalType: 'file', externalId: 'x.py' as never },
        assertionIds: ['a' as never],
        evidenceIds: ['e' as never],
        confidence: 0.6,
        reviewStatus: 'UNREVIEWED',
        requiresReview: true,
        createsCanonicalObject: false,
        detectedAt: '2026-01-01T00:00:00.000Z' as never,
      },
      assertion: {} as never,
      evidence: {} as never,
      displayValue: '  ',
    });
    assert.equal(result.status, 'NOT_SAFELY_NORMALIZABLE');
  });
});

describe('KNOWLEDGE_BASE: real `knowledge_base:`/`identity:` YAML convention (matches 06-care-coordination)', () => {
  it('detects the YAML block and promotes only the nested identity field to sourceReference', async () => {
    await withTempRepository(
      {
        'config/knowledge-base.yaml': ['knowledge_base:', '  identity: approved-care-handbook', '  source: synthetic-guidance', '  mode: retrieval', ''].join(
          '\n',
        ),
      },
      async (root) => {
        const { candidates } = await scan(root);
        const found = candidatesByKind(candidates, 'KNOWLEDGE_BASE');
        assert.equal(found.length, 1);
        const normalized = normalizeObjectCandidate(found[0]);
        assert.equal(normalized.status, 'NORMALIZED');
        if (normalized.status === 'NORMALIZED' && normalized.candidate.candidateKind === 'KNOWLEDGE_BASE') {
          assert.equal(normalized.candidate.proposedIdentity.sourceReference, 'approved-care-handbook');
        }
      },
    );
  });

  it('an inline `knowledge_base = "..."` field on an unrelated Agent class is never treated as KNOWLEDGE_BASE evidence (matches the Golden Repository oracle\'s own boundary)', async () => {
    await withTempRepository(
      { 'agent.py': 'class CareCoordinationAgent:\n    knowledge_base = "approved-care-handbook"\n' },
      async (root) => {
        const { candidates } = await scan(root);
        assert.equal(candidatesByKind(candidates, 'KNOWLEDGE_BASE').length, 0);
      },
    );
  });

  it('the bare word "memory" or a generic vector-store import never implies a KNOWLEDGE_BASE candidate', async () => {
    await withTempRepository(
      { 'agent.py': ['import chromadb', 'memory_store = chromadb.Client()'].join('\n') },
      async (root) => {
        const { candidates } = await scan(root);
        assert.equal(candidatesByKind(candidates, 'KNOWLEDGE_BASE').length, 0);
      },
    );
  });

  it('KnowledgeBaseCandidateNormalizationStrategy fails closed on a blank displayValue', () => {
    const strategy = new KnowledgeBaseCandidateNormalizationStrategy();
    const result = strategy.normalize({
      finding: {
        findingId: 'discovery-finding:x' as never,
        findingNature: 'CANDIDATE',
        candidateKind: 'KNOWLEDGE_BASE',
        sourceObject: { connectionId: 'c' as never, externalType: 'file', externalId: 'x.py' as never },
        assertionIds: ['a' as never],
        evidenceIds: ['e' as never],
        confidence: 0.6,
        reviewStatus: 'UNREVIEWED',
        requiresReview: true,
        createsCanonicalObject: false,
        detectedAt: '2026-01-01T00:00:00.000Z' as never,
      },
      assertion: {} as never,
      evidence: {} as never,
      displayValue: '',
    });
    assert.equal(result.status, 'NOT_SAFELY_NORMALIZABLE');
  });
});

describe('SKILL: real `.claude/skills/<name>/SKILL.md` path convention (reused from codeguard/agent-detector.ts)', () => {
  it('detects the path convention and promotes the directory name to declarationReference', async () => {
    await withTempRepository(
      { '.claude/skills/summarize-ticket/SKILL.md': '# Summarize Ticket\n\nSummarizes a support ticket.\n' },
      async (root) => {
        const { candidates } = await scan(root);
        const found = candidatesByKind(candidates, 'SKILL');
        assert.equal(found.length, 1);
        const normalized = normalizeObjectCandidate(found[0]);
        assert.equal(normalized.status, 'NORMALIZED');
        if (normalized.status === 'NORMALIZED' && normalized.candidate.candidateKind === 'SKILL') {
          assert.equal(normalized.candidate.proposedIdentity.declarationReference, 'summarize-ticket');
        }
      },
    );
  });

  it('a generic function definition or a Tool declaration never implies a Skill', async () => {
    await withTempRepository(
      { 'agent.py': ['def summarize_ticket():', '    pass', '', 'tools = [summarize_ticket]'].join('\n') },
      async (root) => {
        const { candidates } = await scan(root);
        assert.equal(candidatesByKind(candidates, 'SKILL').length, 0);
      },
    );
  });

  it('a markdown file NOT at the exact .claude/skills/<name>/SKILL.md path is never treated as a Skill', async () => {
    await withTempRepository({ 'docs/skills/summarize-ticket.md': '# Summarize Ticket\n' }, async (root) => {
      const { candidates } = await scan(root);
      assert.equal(candidatesByKind(candidates, 'SKILL').length, 0);
    });
  });

  it('SkillCandidateNormalizationStrategy fails closed on a blank displayValue', () => {
    const strategy = new SkillCandidateNormalizationStrategy();
    const result = strategy.normalize({
      finding: {
        findingId: 'discovery-finding:x' as never,
        findingNature: 'CANDIDATE',
        candidateKind: 'SKILL',
        sourceObject: { connectionId: 'c' as never, externalType: 'file', externalId: 'x.py' as never },
        assertionIds: ['a' as never],
        evidenceIds: ['e' as never],
        confidence: 0.6,
        reviewStatus: 'UNREVIEWED',
        requiresReview: true,
        createsCanonicalObject: false,
        detectedAt: '2026-01-01T00:00:00.000Z' as never,
      },
      assertion: {} as never,
      evidence: {} as never,
      displayValue: '',
    });
    assert.equal(result.status, 'NOT_SAFELY_NORMALIZABLE');
  });
});

describe('L4 Round 1: evidence/provenance and DECLARED trust for every new object kind', () => {
  it('every accepted PROMPT/MCP_SERVER/API/KNOWLEDGE_BASE/SKILL candidate carries its own finding assertion/evidence ids and DECLARED trust', async () => {
    await withTempRepository(
      {
        'agent.py': [
          'SUPPORT_PROMPT = "Assist with account questions."',
          'CARE_NETWORK_API = {',
          '    "id": "care-network-api",',
          '}',
        ].join('\n'),
        'mcp.json': JSON.stringify({ serverIdentity: 'synthetic-catalog-mcp' }),
        'config/knowledge-base.yaml': 'knowledge_base:\n  identity: approved-care-handbook\n',
        '.claude/skills/summarize-ticket/SKILL.md': '# Summarize Ticket\n',
      },
      async (root) => {
        const { candidates } = await scan(root);
        for (const kind of ['PROMPT', 'MCP_SERVER', 'API', 'KNOWLEDGE_BASE', 'SKILL'] as const) {
          const found = candidatesByKind(candidates, kind);
          assert.equal(found.length, 1, `expected exactly one ${kind} candidate`);
          assert.ok(found[0].finding.assertionIds.length > 0);
          assert.ok(found[0].finding.evidenceIds.length > 0);
          assert.equal(found[0].finding.requiresReview, true);
          assert.equal(found[0].finding.createsCanonicalObject, false);
          assert.equal(
            found[0].assertion.trustState,
            'DECLARED',
            `expected ${kind}'s real-source declaration to carry DECLARED trust`,
          );
        }
      },
    );
  });
});
