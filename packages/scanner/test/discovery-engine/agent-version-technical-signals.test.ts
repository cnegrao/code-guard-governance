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
];

async function scanAndCorrelate(root: string) {
  const pipeline = new DiscoveryPipeline(new LocalRepositoryAdapter(root), OBJECT_SPECIFICATIONS(), {
    clock: fixedClock(),
    signalSpecifications: SIGNAL_SPECIFICATIONS(),
  });
  const { candidates, technicalProfileSignals } = await pipeline.run();
  return { results: correlateAgentVersions(candidates, technicalProfileSignals, { observedAt: OBSERVED_AT }), candidates, technicalProfileSignals };
}

describe('Framework/Orchestration trust (corrected): import evidence is real, but AgentVersion-bound interpretation is INFERRED', () => {
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

  it('DEFECT #1A CORRECTION: a Framework import alone does NOT produce DECLARED AgentVersion-framework truth — it is INFERRED', async () => {
    await withTempRepository({ 'agent.py': 'from langgraph import StateGraph\n' }, async (root) => {
      const pipeline = new DiscoveryPipeline(new LocalRepositoryAdapter(root), [], {
        clock: fixedClock(),
        signalSpecifications: SIGNAL_SPECIFICATIONS(),
      });
      const { technicalProfileSignals } = await pipeline.run();
      const frameworkSignal = technicalProfileSignals.find((s) => s.signalKind === 'FRAMEWORK');
      assert.ok(frameworkSignal);
      assert.equal(
        frameworkSignal!.assertion.trustState,
        'INFERRED',
        'an import declares a dependency; it does not explicitly declare this AgentVersion\'s framework binding',
      );
    });
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

  it('DEFECT #1B CORRECTION: Orchestration derived from Framework is INFERRED, never DECLARED, and never inherits a stronger tier than its own Framework evidence', async () => {
    await withTempRepository({ 'agent.py': 'from langgraph import StateGraph\n' }, async (root) => {
      const pipeline = new DiscoveryPipeline(new LocalRepositoryAdapter(root), [], {
        clock: fixedClock(),
        signalSpecifications: SIGNAL_SPECIFICATIONS(),
      });
      const { technicalProfileSignals } = await pipeline.run();
      const orchestrationSignal = technicalProfileSignals.find((s) => s.signalKind === 'ORCHESTRATION');
      assert.ok(orchestrationSignal);
      assert.equal(orchestrationSignal!.assertion.trustState, 'INFERRED');
    });
  });

  it('DEFECT #1C CORRECTION: a generic Redis/PostgreSQL/SQLite/vector-store import no longer produces ANY technical-profile signal (Memory detection removed — imports alone never prove memory usage)', async () => {
    await withTempRepository(
      { 'agent.py': ['import redis', 'import sqlite3', 'from psycopg2 import connect', 'import chromadb', 'import pinecone'].join('\n') },
      async (root) => {
        const pipeline = new DiscoveryPipeline(new LocalRepositoryAdapter(root), [], {
          clock: fixedClock(),
          signalSpecifications: SIGNAL_SPECIFICATIONS(),
        });
        const { technicalProfileSignals } = await pipeline.run();
        assert.equal(
          technicalProfileSignals.length,
          0,
          'no signal kind exists for Memory in this round; a generic storage/vector-store import must never be promoted to an AgentVersion Memory fact',
        );
      },
    );
  });

  it('Neo4j is deliberately not detected by anything (Memory removed; never folded into KNOWLEDGE_BASE either)', async () => {
    await withTempRepository({ 'agent.py': 'from neo4j import GraphDatabase\n' }, async (root) => {
      const pipeline = new DiscoveryPipeline(new LocalRepositoryAdapter(root), [], {
        clock: fixedClock(),
        signalSpecifications: SIGNAL_SPECIFICATIONS(),
      });
      const { technicalProfileSignals } = await pipeline.run();
      assert.equal(technicalProfileSignals.length, 0);
    });
  });

  it('SYNTHETIC FALSE COMPLETION: the previously invented FRAMEWORK_REFERENCE/MEMORY_REFERENCE declaration syntax is not recognized by anything', async () => {
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

  it('design-time detection never becomes OBSERVED; nothing becomes VALIDATED automatically', async () => {
    await withTempRepository({ 'agent.py': 'from langgraph import StateGraph\n' }, async (root) => {
      const pipeline = new DiscoveryPipeline(new LocalRepositoryAdapter(root), [], {
        clock: fixedClock(),
        signalSpecifications: SIGNAL_SPECIFICATIONS(),
      });
      const { technicalProfileSignals } = await pipeline.run();
      for (const signal of technicalProfileSignals) {
        assert.notEqual(signal.assertion.trustState, 'OBSERVED');
        assert.notEqual(signal.assertion.trustState, 'VALIDATED');
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

  it('mixed trust states are preserved on one AgentVersion: AGENT/MODEL stay INFERRED, Framework stays INFERRED too (corrected — no longer DECLARED)', async () => {
    await withTempRepository(
      {
        'agent.py': [
          'class SupportAgent:',
          '    kind = "agent"',
          '    modelReference = "gpt-x"',
          '    PROMPT_HANDLER_PROMPT = "Assist the customer."',
          'from langgraph import StateGraph',
        ].join('\n'),
      },
      async (root) => {
        const { candidates, technicalProfileSignals } = await scanAndCorrelate(root);
        const agentCandidate = candidates.find((c) => c.finding.candidateKind === 'AGENT');
        const modelCandidate = candidates.find((c) => c.finding.candidateKind === 'MODEL');
        const promptCandidate = candidates.find((c) => c.finding.candidateKind === 'PROMPT');
        assert.equal(agentCandidate?.assertion.trustState, 'INFERRED');
        assert.equal(modelCandidate?.assertion.trustState, 'INFERRED');
        assert.equal(promptCandidate?.assertion.trustState, 'DECLARED', 'Prompt remains a real, explicit declaration — DECLARED is still correct for it');
        for (const signal of technicalProfileSignals) {
          assert.equal(signal.assertion.trustState, 'INFERRED');
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

});

describe('DEFECT #2 CORRECTION: Prompt content participates in AgentVersion technical revision', () => {
  // Every case below scans the SAME temp root (same SourceConnection) both
  // times, overwriting the file in place between scans — two independent
  // mkdtemp roots would legitimately differ in sourceScope alone (a
  // different source connection is a different AgentVersion source scope
  // by design), which would make "same content -> same id" trivially true
  // for the wrong reason and "different content -> different id" prove
  // nothing about content-sensitivity specifically.

  it('same Prompt declaration key + same content, rescanned -> same technical revision (idempotent)', async () => {
    await withTempRepository(
      { 'agent.py': ['class SupportAgent:', '    kind = "agent"', '    CARE_PROMPT = "Draft a plan, then require approval."', ''].join('\n') },
      async (root) => {
        const first = await scanAndCorrelate(root);
        const second = await scanAndCorrelate(root);
        assert.equal(first.results.length, 1);
        assert.equal(second.results[0].candidate.candidateId, first.results[0].candidate.candidateId);
      },
    );
  });

  it('same Prompt declaration key + CHANGED content -> DIFFERENT technical revision (this is the corrected behavior; the prior milestone pass had this backwards)', async () => {
    await withTempRepository(
      { 'agent.py': ['class SupportAgent:', '    kind = "agent"', '    CARE_PROMPT = "Draft a plan, then require approval."', ''].join('\n') },
      async (root) => {
        const before = await scanAndCorrelate(root);
        const beforeId = before.results[0].candidate.candidateId;

        await writeFile(
          join(root, 'agent.py'),
          ['class SupportAgent:', '    kind = "agent"', '    CARE_PROMPT = "Draft a plan, then escalate immediately."', ''].join('\n'),
        );
        const after = await scanAndCorrelate(root);
        assert.notEqual(
          after.results[0].candidate.candidateId,
          beforeId,
          "changing the Prompt's own effective content must produce a different AGENT_VERSION technical revision",
        );
      },
    );
  });

  it('raw Prompt content never enters the AGENT_VERSION candidateId (only its sha256 content fingerprint does)', async () => {
    await withTempRepository(
      {
        'agent.py': [
          'class SupportAgent:',
          '    kind = "agent"',
          '    CARE_PROMPT = "A very specific and identifiable sentence that must never leak."',
          '',
        ].join('\n'),
      },
      async (root) => {
        const { results } = await scanAndCorrelate(root);
        assert.equal(results.length, 1);
        assert.equal(results[0].candidate.candidateId.includes('very specific'), false);
        assert.equal(results[0].candidate.candidateId.includes('identifiable sentence'), false);
      },
    );
  });

  it('an unrelated comment/blank-line insertion elsewhere in the file does not change the technical revision even with a Prompt present', async () => {
    await withTempRepository(
      { 'agent.py': ['class SupportAgent:', '    kind = "agent"', '    CARE_PROMPT = "Draft a plan, then require approval."', ''].join('\n') },
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
            '    CARE_PROMPT = "Draft a plan, then require approval."',
            '',
          ].join('\n'),
        );
        const after = await scanAndCorrelate(root);
        assert.equal(after.results[0].candidate.candidateId, beforeId);
      },
    );
  });
});

describe('AgentVersion correlation: cross-file attribution', () => {
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
