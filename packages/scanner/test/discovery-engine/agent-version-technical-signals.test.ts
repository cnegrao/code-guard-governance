import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';

import { correlateAgentVersions } from '../../src/discovery/agent-version-correlation';
import { DiscoveryPipeline } from '../../src/discovery/pipeline';
import { LocalRepositoryAdapter } from '../../src/discovery/adapters/local-repository-adapter';
import { AgentKindDeclarationSpecification } from '../../src/discovery/strategies/agent-kind-declaration';
import { ModelReferenceDeclarationSpecification } from '../../src/discovery/strategies/model-reference-declaration';
import { ToolListDeclarationSpecification } from '../../src/discovery/strategies/tool-list-declaration';
import { PromptDeclarationSpecification } from '../../src/discovery/strategies/prompt-declaration';
import { McpServerDeclarationSpecification } from '../../src/discovery/strategies/mcp-server-declaration';
import { ApiDeclarationSpecification } from '../../src/discovery/strategies/api-declaration';
import { KnowledgeBaseDeclarationSpecification } from '../../src/discovery/strategies/knowledge-base-declaration';
import { SkillListDeclarationSpecification } from '../../src/discovery/strategies/skill-list-declaration';
import {
  BuildReferenceDeclarationSpecification,
  FrameworkReferenceDeclarationSpecification,
  GuardrailReferenceDeclarationSpecification,
  HitlReferenceDeclarationSpecification,
  MemoryReferenceDeclarationSpecification,
  OrchestrationReferenceDeclarationSpecification,
} from '../../src/discovery/strategies/agent-version-technical-signal-declaration';

const OBSERVED_AT = '2026-01-01T00:00:00.000Z';

function fixedClock() {
  return { now: () => OBSERVED_AT };
}

async function withTempRepository(
  files: Record<string, string>,
  run: (root: string) => Promise<void>,
): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'agent-version-technical-signals-'));
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

const ALL_SPECIFICATIONS = () => [
  new AgentKindDeclarationSpecification(),
  new ModelReferenceDeclarationSpecification(),
  new ToolListDeclarationSpecification(),
  new PromptDeclarationSpecification(),
  new McpServerDeclarationSpecification(),
  new ApiDeclarationSpecification(),
  new KnowledgeBaseDeclarationSpecification(),
  new SkillListDeclarationSpecification(),
  new FrameworkReferenceDeclarationSpecification(),
  new BuildReferenceDeclarationSpecification(),
  new MemoryReferenceDeclarationSpecification(),
  new OrchestrationReferenceDeclarationSpecification(),
  new GuardrailReferenceDeclarationSpecification(),
  new HitlReferenceDeclarationSpecification(),
];

async function scanAndCorrelate(root: string) {
  const pipeline = new DiscoveryPipeline(new LocalRepositoryAdapter(root), ALL_SPECIFICATIONS(), {
    clock: fixedClock(),
  });
  const { candidates } = await pipeline.run();
  return correlateAgentVersions(candidates, { observedAt: OBSERVED_AT });
}

describe('AgentVersion technical signals: Framework/Build/Memory/Orchestration/Guardrail/HITL', () => {
  it('a Framework signal alone (no Model/Tool) satisfies minimum evidence and produces one AGENT_VERSION', async () => {
    await withTempRepository(
      {
        'agent.py': ['class SupportAgent:', '    kind = "agent"', '    FRAMEWORK_REFERENCE = "langgraph"', ''].join(
          '\n',
        ),
      },
      async (root) => {
        const results = await scanAndCorrelate(root);
        assert.equal(results.length, 1);
      },
    );
  });

  it('each of the six technical signals is captured independently and contributes its own evidence to AGENT_VERSION', async () => {
    await withTempRepository(
      {
        'agent.py': [
          'class SupportAgent:',
          '    kind = "agent"',
          '    modelReference = "gpt-x"',
          '    FRAMEWORK_REFERENCE = "langgraph"',
          '    BUILD_REFERENCE = "py3.11-slim"',
          '    MEMORY_REFERENCE = "redis-session-store"',
          '    ORCHESTRATION_REFERENCE = "state-graph-v1"',
          '    GUARDRAIL_REFERENCE = "content-safety-filter-v1"',
          '    HITL_REFERENCE = "manager-approval-checkpoint"',
          '',
        ].join('\n'),
      },
      async (root) => {
        const results = await scanAndCorrelate(root);
        assert.equal(results.length, 1);
        const [result] = results;
        // 1 agent-code + 1 model + 6 technical signals = 8 distinct assertion ids.
        assert.ok(result.finding.assertionIds.length >= 7);
        assert.ok(result.finding.evidenceIds.length >= 7);
      },
    );
  });

  it('changing a Framework reference value produces a different AGENT_VERSION identity (version-relevant change)', async () => {
    const base = {
      'agent.py': [
        'class SupportAgent:',
        '    kind = "agent"',
        '    modelReference = "gpt-x"',
        '    FRAMEWORK_REFERENCE = "langgraph"',
        '',
      ].join('\n'),
    };
    await withTempRepository(base, async (root) => {
      const results = await scanAndCorrelate(root);
      assert.equal(results.length, 1);
      const beforeId = results[0].candidate.candidateId;

      await writeFile(
        join(root, 'agent.py'),
        [
          'class SupportAgent:',
          '    kind = "agent"',
          '    modelReference = "gpt-x"',
          '    FRAMEWORK_REFERENCE = "crewai"',
          '',
        ].join('\n'),
      );
      const after = await scanAndCorrelate(root);
      assert.equal(after.length, 1);
      assert.notEqual(after[0].candidate.candidateId, beforeId);
    });
  });

  it('an unrelated comment/blank-line insertion does not change the AGENT_VERSION identity even with technical signals present', async () => {
    await withTempRepository(
      {
        'agent.py': [
          'class SupportAgent:',
          '    kind = "agent"',
          '    modelReference = "gpt-x"',
          '    FRAMEWORK_REFERENCE = "langgraph"',
          '',
        ].join('\n'),
      },
      async (root) => {
        const before = await scanAndCorrelate(root);
        const beforeId = before[0].candidate.candidateId;

        await writeFile(
          join(root, 'agent.py'),
          [
            '# Unrelated header comment.',
            '',
            'class SupportAgent:',
            '    kind = "agent"',
            '    modelReference = "gpt-x"',
            '    FRAMEWORK_REFERENCE = "langgraph"',
            '',
          ].join('\n'),
        );
        const after = await scanAndCorrelate(root);
        assert.equal(after[0].candidate.candidateId, beforeId);
      },
    );
  });

  it('HITL evidence is captured as a design-time signal only — trust state is never OBSERVED (evidence-assembly.ts always fixes INFERRED)', async () => {
    await withTempRepository(
      {
        'agent.py': [
          'class SupportAgent:',
          '    kind = "agent"',
          '    modelReference = "gpt-x"',
          '    HITL_REFERENCE = "manager-approval-checkpoint"',
          '',
        ].join('\n'),
      },
      async (root) => {
        const pipeline = new DiscoveryPipeline(new LocalRepositoryAdapter(root), ALL_SPECIFICATIONS(), {
          clock: fixedClock(),
        });
        const { candidates } = await pipeline.run();
        const hitlCandidate = candidates.find((c) => c.assertion.method.code === 'hitl-reference-declaration');
        assert.ok(hitlCandidate);
        assert.equal(hitlCandidate?.assertion.trustState, 'INFERRED');
      },
    );
  });

  it('a bare mention of "guardrail" in a comment/docstring never becomes a Guardrail signal', async () => {
    await withTempRepository(
      {
        'agent.py': [
          '# This agent has a guardrail against unsafe outputs.',
          'class SupportAgent:',
          '    kind = "agent"',
          '    modelReference = "gpt-x"',
          '',
        ].join('\n'),
      },
      async (root) => {
        const pipeline = new DiscoveryPipeline(new LocalRepositoryAdapter(root), ALL_SPECIFICATIONS(), {
          clock: fixedClock(),
        });
        const { candidates } = await pipeline.run();
        assert.equal(candidates.some((c) => c.assertion.method.code === 'guardrail-reference-declaration'), false);
      },
    );
  });
});

describe('AgentVersion technical revision: Round 1 correlated object kinds (Prompt/MCP/API/KB/Skill)', () => {
  it('a Prompt binding alone (no Model/Tool) satisfies minimum evidence', async () => {
    await withTempRepository(
      {
        'agent.py': ['class SupportAgent:', '    kind = "agent"', '    PROMPT_REFERENCE = "support-prompt-v1"', ''].join(
          '\n',
        ),
      },
      async (root) => {
        const results = await scanAndCorrelate(root);
        assert.equal(results.length, 1);
      },
    );
  });

  it('changing the correlated Skill set produces a different AGENT_VERSION identity', async () => {
    await withTempRepository(
      {
        'agent.py': [
          'class SupportAgent:',
          '    kind = "agent"',
          '    modelReference = "gpt-x"',
          '    skills = [summarize_ticket]',
          '',
        ].join('\n'),
      },
      async (root) => {
        const before = await scanAndCorrelate(root);
        const beforeId = before[0].candidate.candidateId;

        await writeFile(
          join(root, 'agent.py'),
          [
            'class SupportAgent:',
            '    kind = "agent"',
            '    modelReference = "gpt-x"',
            '    skills = [summarize_ticket, draft_reply]',
            '',
          ].join('\n'),
        );
        const after = await scanAndCorrelate(root);
        assert.notEqual(after[0].candidate.candidateId, beforeId);
      },
    );
  });

  it('two Agents declared in the same file remain ambiguous and produce no AGENT_VERSION even with Prompt/MCP/Skill evidence present', async () => {
    await withTempRepository(
      {
        'agents.py': [
          'class FirstAgent:',
          '    kind = "agent"',
          '    modelReference = "gpt-x"',
          '',
          'class SecondAgent:',
          '    kind = "agent"',
          '    PROMPT_REFERENCE = "shared-prompt"',
          '',
        ].join('\n'),
      },
      async (root) => {
        const results = await scanAndCorrelate(root);
        assert.equal(results.length, 0);
      },
    );
  });
});
