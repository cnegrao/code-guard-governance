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

describe('PROMPT: PromptDeclarationSpecification + normalization', () => {
  it('detects an explicit PROMPT_REFERENCE declaration and promotes it to declarationKey', async () => {
    await withTempRepository(
      { 'agent.py': 'PROMPT_REFERENCE = "support-system-prompt-v1"\n' },
      async (root) => {
        const { candidates } = await scan(root);
        const found = candidatesByKind(candidates, 'PROMPT');
        assert.equal(found.length, 1);
        const normalized = normalizeObjectCandidate(found[0]);
        assert.equal(normalized.status, 'NORMALIZED');
        if (normalized.status === 'NORMALIZED' && normalized.candidate.candidateKind === 'PROMPT') {
          assert.equal(normalized.candidate.proposedIdentity.declarationKey, 'support-system-prompt-v1');
        }
      },
    );
  });

  it('never leaks raw prompt content: a docstring or prose mentioning "prompt" produces no candidate', async () => {
    await withTempRepository(
      {
        'agent.py': [
          '"""This agent uses a carefully engineered prompt to answer questions."""',
          'SYSTEM_PROMPT = "You are a helpful assistant. Always be kind."',
        ].join('\n'),
      },
      async (root) => {
        const { candidates } = await scan(root);
        assert.equal(candidatesByKind(candidates, 'PROMPT').length, 0);
      },
    );
  });

  it('camelCase promptReference spelling is also recognized', async () => {
    await withTempRepository({ 'agent.ts': 'promptReference: "triage-prompt-v2",\n' }, async (root) => {
      const { candidates } = await scan(root);
      assert.equal(candidatesByKind(candidates, 'PROMPT').length, 1);
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

describe('MCP_SERVER: McpServerDeclarationSpecification + normalization', () => {
  it('detects an explicit MCP_SERVER_REFERENCE declaration and promotes it to serverReference', async () => {
    await withTempRepository({ 'agent.py': 'MCP_SERVER_REFERENCE = "filesystem-mcp"\n' }, async (root) => {
      const { candidates } = await scan(root);
      const found = candidatesByKind(candidates, 'MCP_SERVER');
      assert.equal(found.length, 1);
      const normalized = normalizeObjectCandidate(found[0]);
      assert.equal(normalized.status, 'NORMALIZED');
      if (normalized.status === 'NORMALIZED' && normalized.candidate.candidateKind === 'MCP_SERVER') {
        assert.equal(normalized.candidate.proposedIdentity.serverReference, 'filesystem-mcp');
      }
    });
  });

  it('a Tool declaration or an mcp-related import alone never implies an MCP_SERVER candidate', async () => {
    await withTempRepository(
      {
        'agent.py': ['import mcp', 'from modelcontextprotocol import Client', 'tools = [search_docs]'].join('\n'),
      },
      async (root) => {
        const { candidates } = await scan(root);
        assert.equal(candidatesByKind(candidates, 'MCP_SERVER').length, 0);
      },
    );
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

describe('API: ApiDeclarationSpecification + normalization', () => {
  it('detects an explicit API_REFERENCE declaration and promotes it to apiReference', async () => {
    await withTempRepository({ 'agent.py': 'API_REFERENCE = "billing-service-api"\n' }, async (root) => {
      const { candidates } = await scan(root);
      const found = candidatesByKind(candidates, 'API');
      assert.equal(found.length, 1);
      const normalized = normalizeObjectCandidate(found[0]);
      assert.equal(normalized.status, 'NORMALIZED');
      if (normalized.status === 'NORMALIZED' && normalized.candidate.candidateKind === 'API') {
        assert.equal(normalized.candidate.proposedIdentity.apiReference, 'billing-service-api');
      }
    });
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

describe('KNOWLEDGE_BASE: KnowledgeBaseDeclarationSpecification + normalization', () => {
  it('detects an explicit KNOWLEDGE_BASE_REFERENCE declaration and promotes it to sourceReference', async () => {
    await withTempRepository(
      { 'agent.py': 'KNOWLEDGE_BASE_REFERENCE = "product-docs-index"\n' },
      async (root) => {
        const { candidates } = await scan(root);
        const found = candidatesByKind(candidates, 'KNOWLEDGE_BASE');
        assert.equal(found.length, 1);
        const normalized = normalizeObjectCandidate(found[0]);
        assert.equal(normalized.status, 'NORMALIZED');
        if (normalized.status === 'NORMALIZED' && normalized.candidate.candidateKind === 'KNOWLEDGE_BASE') {
          assert.equal(normalized.candidate.proposedIdentity.sourceReference, 'product-docs-index');
        }
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

describe('SKILL: SkillListDeclarationSpecification + normalization', () => {
  it('detects explicit Skills bound via skills = [...] and promotes each to declarationReference', async () => {
    await withTempRepository({ 'agent.py': 'skills = [summarize_ticket, draft_reply]\n' }, async (root) => {
      const { candidates } = await scan(root);
      const found = candidatesByKind(candidates, 'SKILL');
      assert.equal(found.length, 2);
      const values = found
        .map((c) => {
          const normalized = normalizeObjectCandidate(c);
          return normalized.status === 'NORMALIZED' && normalized.candidate.candidateKind === 'SKILL'
            ? normalized.candidate.proposedIdentity.declarationReference
            : undefined;
        })
        .sort();
      assert.deepEqual(values, ['draft_reply', 'summarize_ticket']);
    });
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

  it('a quoted-string skills array fails closed (ambiguous, never a bare identifier)', async () => {
    await withTempRepository({ 'agent.py': 'skills = ["summarize_ticket"]\n' }, async (root) => {
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

describe('L4 Round 1: evidence/provenance for every new object kind', () => {
  it('every accepted PROMPT/MCP_SERVER/API/KNOWLEDGE_BASE/SKILL candidate carries its own finding assertion/evidence ids', async () => {
    await withTempRepository(
      {
        'agent.py': [
          'PROMPT_REFERENCE = "p1"',
          'MCP_SERVER_REFERENCE = "m1"',
          'API_REFERENCE = "a1"',
          'KNOWLEDGE_BASE_REFERENCE = "k1"',
          'skills = [s1]',
        ].join('\n'),
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
        }
      },
    );
  });
});
