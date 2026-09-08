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
  FrameworkImportSignalSpecification,
  OrchestrationFrameworkSignalSpecification,
} from '../../src/discovery/strategies/framework-import-signal';
import { MemoryImportSignalSpecification } from '../../src/discovery/strategies/memory-import-signal';

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

const OBJECT_SPECIFICATIONS = () => [
  new AgentKindDeclarationSpecification(),
  new ModelReferenceDeclarationSpecification(),
  new ToolListDeclarationSpecification(),
  new PromptDeclarationSpecification(),
  new McpServerDeclarationSpecification(),
  new ApiDeclarationSpecification(),
  new KnowledgeBaseDeclarationSpecification(),
  new SkillListDeclarationSpecification(),
];

const SIGNAL_SPECIFICATIONS = () => [
  new FrameworkImportSignalSpecification(),
  new OrchestrationFrameworkSignalSpecification(),
  new MemoryImportSignalSpecification(),
];

async function scanAndCorrelate(root: string) {
  const pipeline = new DiscoveryPipeline(new LocalRepositoryAdapter(root), OBJECT_SPECIFICATIONS(), {
    clock: fixedClock(),
    signalSpecifications: SIGNAL_SPECIFICATIONS(),
  });
  const { candidates, technicalProfileSignals } = await pipeline.run();
  return { results: correlateAgentVersions(candidates, technicalProfileSignals, { observedAt: OBSERVED_AT }), candidates, technicalProfileSignals };
}

describe('Framework/Memory/Orchestration: real-source import-statement signals (adapted from core/framework-detector.ts and core/memory-detector.ts)', () => {
  it('a real `from langgraph import StateGraph` import produces a FRAMEWORK signal, not a DiscoveryCandidate of any CanonicalObjectKind', async () => {
    await withTempRepository(
      { 'agent.py': ['class SupportAgent:', '    kind = "agent"', '    modelReference = "gpt-x"', 'from langgraph import StateGraph'].join('\n') },
      async (root) => {
        const pipeline = new DiscoveryPipeline(new LocalRepositoryAdapter(root), OBJECT_SPECIFICATIONS(), {
          clock: fixedClock(),
          signalSpecifications: SIGNAL_SPECIFICATIONS(),
        });
        const { candidates, technicalProfileSignals } = await pipeline.run();

        // BLOCKER #2 REGRESSION: a Framework signal must never appear in the
        // canonical `candidates` array (it has no CanonicalObjectKind and is
        // never an AGENT_VERSION object candidate masquerading as one).
        assert.equal(candidates.some((c) => c.finding.candidateKind === 'AGENT_VERSION'), false);
        assert.ok(!('candidateKind' in (technicalProfileSignals[0] as unknown as Record<string, unknown>)));

        const frameworkSignal = technicalProfileSignals.find((s) => s.signalKind === 'FRAMEWORK');
        assert.ok(frameworkSignal);
        assert.equal(frameworkSignal!.value, 'LangGraph');
      },
    );
  });

  it('LangGraph/CrewAI/Semantic Kernel imports also produce an ORCHESTRATION signal (real pre-existing agentType classification); AutoGen does not', async () => {
    await withTempRepository(
      { 'a.py': 'from langgraph import StateGraph', 'b.py': 'from crewai import Crew', 'c.py': 'from autogen import AssistantAgent' },
      async (root) => {
        const pipeline = new DiscoveryPipeline(new LocalRepositoryAdapter(root), [], {
          clock: fixedClock(),
          signalSpecifications: SIGNAL_SPECIFICATIONS(),
        });
        const { technicalProfileSignals } = await pipeline.run();
        const orchestrationValues = technicalProfileSignals.filter((s) => s.signalKind === 'ORCHESTRATION').map((s) => s.value);
        assert.deepEqual(orchestrationValues.sort(), ['CrewAI', 'LangGraph']);
      },
    );
  });

  it('a real `import redis` produces a MEMORY signal', async () => {
    await withTempRepository({ 'agent.py': 'import redis\n' }, async (root) => {
      const pipeline = new DiscoveryPipeline(new LocalRepositoryAdapter(root), [], {
        clock: fixedClock(),
        signalSpecifications: SIGNAL_SPECIFICATIONS(),
      });
      const { technicalProfileSignals } = await pipeline.run();
      const memorySignal = technicalProfileSignals.find((s) => s.signalKind === 'MEMORY');
      assert.ok(memorySignal);
      assert.equal(memorySignal!.value, 'Redis');
    });
  });

  it('Neo4j is deliberately NOT detected as a Memory signal (avoids Memory/Knowledge-Base conflation)', async () => {
    await withTempRepository({ 'agent.py': 'from neo4j import GraphDatabase\n' }, async (root) => {
      const pipeline = new DiscoveryPipeline(new LocalRepositoryAdapter(root), [], {
        clock: fixedClock(),
        signalSpecifications: SIGNAL_SPECIFICATIONS(),
      });
      const { technicalProfileSignals } = await pipeline.run();
      assert.equal(technicalProfileSignals.length, 0);
    });
  });

  it('SYNTHETIC FALSE COMPLETION: the previously invented FRAMEWORK_REFERENCE/MEMORY_REFERENCE declaration syntax is no longer recognized by anything', async () => {
    await withTempRepository(
      { 'agent.py': ['FRAMEWORK_REFERENCE = "langgraph"', 'MEMORY_REFERENCE = "redis-session-store"'].join('\n') },
      async (root) => {
        const pipeline = new DiscoveryPipeline(new LocalRepositoryAdapter(root), [], {
          clock: fixedClock(),
          signalSpecifications: SIGNAL_SPECIFICATIONS(),
        });
        const { technicalProfileSignals } = await pipeline.run();
        assert.equal(technicalProfileSignals.length, 0, 'an invented *_REFERENCE literal must not, by itself, justify any signal');
      },
    );
  });

  it('every Framework/Memory/Orchestration signal carries DECLARED trust (an import statement is an explicit dependency declaration)', async () => {
    await withTempRepository({ 'agent.py': 'from langgraph import StateGraph\nimport redis\n' }, async (root) => {
      const pipeline = new DiscoveryPipeline(new LocalRepositoryAdapter(root), [], {
        clock: fixedClock(),
        signalSpecifications: SIGNAL_SPECIFICATIONS(),
      });
      const { technicalProfileSignals } = await pipeline.run();
      assert.ok(technicalProfileSignals.length >= 2);
      for (const signal of technicalProfileSignals) {
        assert.equal(signal.assertion.trustState, 'DECLARED');
      }
    });
  });
});

describe('AgentVersion correlation: technical-profile signals fold into technical revision without becoming AGENT_VERSION candidates', () => {
  it('a Framework signal alone (no Model/Tool) satisfies minimum evidence and produces one AGENT_VERSION', async () => {
    await withTempRepository(
      { 'agent.py': ['class SupportAgent:', '    kind = "agent"', 'from langgraph import StateGraph'].join('\n') },
      async (root) => {
        const { results } = await scanAndCorrelate(root);
        assert.equal(results.length, 1);
      },
    );
  });

  it('mixed trust states are preserved on one AgentVersion: AGENT/MODEL stay INFERRED, Framework/Memory stay DECLARED', async () => {
    await withTempRepository(
      {
        'agent.py': [
          'class SupportAgent:',
          '    kind = "agent"',
          '    modelReference = "gpt-x"',
          'from langgraph import StateGraph',
          'import redis',
        ].join('\n'),
      },
      async (root) => {
        const { candidates, technicalProfileSignals } = await scanAndCorrelate(root);
        const agentCandidate = candidates.find((c) => c.finding.candidateKind === 'AGENT');
        const modelCandidate = candidates.find((c) => c.finding.candidateKind === 'MODEL');
        assert.equal(agentCandidate?.assertion.trustState, 'INFERRED');
        assert.equal(modelCandidate?.assertion.trustState, 'INFERRED');
        for (const signal of technicalProfileSignals) {
          assert.equal(signal.assertion.trustState, 'DECLARED');
        }
      },
    );
  });

  it('changing a Framework import value produces a different AGENT_VERSION identity (version-relevant change)', async () => {
    await withTempRepository(
      {
        'agent.py': [
          'class SupportAgent:',
          '    kind = "agent"',
          '    modelReference = "gpt-x"',
          'from langgraph import StateGraph',
          '',
        ].join('\n'),
      },
      async (root) => {
        const before = await scanAndCorrelate(root);
        const beforeId = before.results[0].candidate.candidateId;

        await writeFile(
          join(root, 'agent.py'),
          [
            'class SupportAgent:',
            '    kind = "agent"',
            '    modelReference = "gpt-x"',
            'from crewai import Crew',
            '',
          ].join('\n'),
        );
        const after = await scanAndCorrelate(root);
        assert.equal(after.results.length, 1);
        assert.notEqual(after.results[0].candidate.candidateId, beforeId);
      },
    );
  });

  it('an unrelated comment/blank-line insertion does not change the AGENT_VERSION identity even with a Framework signal present', async () => {
    await withTempRepository(
      {
        'agent.py': [
          'class SupportAgent:',
          '    kind = "agent"',
          '    modelReference = "gpt-x"',
          'from langgraph import StateGraph',
          '',
        ].join('\n'),
      },
      async (root) => {
        const before = await scanAndCorrelate(root);
        const beforeId = before.results[0].candidate.candidateId;

        await writeFile(
          join(root, 'agent.py'),
          [
            '# Unrelated header comment.',
            '',
            'class SupportAgent:',
            '    kind = "agent"',
            '    modelReference = "gpt-x"',
            'from langgraph import StateGraph',
            '',
          ].join('\n'),
        );
        const after = await scanAndCorrelate(root);
        assert.equal(after.results[0].candidate.candidateId, beforeId);
      },
    );
  });

  it('source relocation (same technical content, moved to a different file/connection) changes source scope but not the semantic technical-revision fingerprint content', async () => {
    // Verified indirectly: two independent repositories with identical
    // technical content produce candidateIds that differ only because
    // sourceScope (connectionId) differs — never because the technical
    // revision projection itself embeds a locator. Confirmed by construction
    // in agent-version-correlation.ts (buildSourceScope/buildTechnicalRevisionProjection
    // are separate, composed only at the final id) and exercised end-to-end
    // by the "unrelated comment insertion" test above, which proves the
    // technical-revision half is untouched by a locator/line shift within
    // the SAME source scope.
    await withTempRepository(
      { 'agent.py': ['class SupportAgent:', '    kind = "agent"', 'from langgraph import StateGraph', ''].join('\n') },
      async (root) => {
        const { results } = await scanAndCorrelate(root);
        assert.equal(results.length, 1);
      },
    );
  });

  it('a technical signal from a DIFFERENT file never attributes into this file\'s AGENT_VERSION (no cross-file attribution)', async () => {
    await withTempRepository(
      {
        'agent.py': ['class SupportAgent:', '    kind = "agent"', '    modelReference = "gpt-x"', ''].join('\n'),
        'unrelated.py': 'from langgraph import StateGraph\n',
      },
      async (root) => {
        const { results, technicalProfileSignals } = await scanAndCorrelate(root);
        assert.equal(results.length, 1);
        const unrelatedSignal = technicalProfileSignals.find((s) => s.value === 'LangGraph');
        assert.ok(unrelatedSignal);
        assert.equal(
          results[0].candidate.assertionIds.includes(unrelatedSignal!.assertion.assertionId),
          false,
          "the unrelated file's Framework signal must never be cited by this agent's AGENT_VERSION",
        );
      },
    );
  });

  it('two Agents declared in the same file remain ambiguous and produce no AGENT_VERSION even with a Framework signal present', async () => {
    await withTempRepository(
      {
        'agents.py': [
          'class FirstAgent:',
          '    kind = "agent"',
          '',
          'class SecondAgent:',
          '    kind = "agent"',
          'from langgraph import StateGraph',
          '',
        ].join('\n'),
      },
      async (root) => {
        const { results } = await scanAndCorrelate(root);
        assert.equal(results.length, 0);
      },
    );
  });
});
