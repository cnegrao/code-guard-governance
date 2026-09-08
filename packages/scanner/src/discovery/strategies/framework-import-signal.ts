import { TRUST_STATE } from '@council/canonical-contracts';

import type { SourceArtifactContent } from '../source-adapter';
import {
  TECHNICAL_PROFILE_SIGNAL_KIND,
  type TechnicalProfileSignalMatch,
  type TechnicalProfileSignalSpecification,
} from '../technical-profile-signal';

/**
 * Real-source Framework/SDK evidence. The technology list and JS/TS-import
 * regexes are adapted from the pre-existing (pre-PR#24)
 * `packages/scanner/src/core/framework-detector.ts`'s own
 * `FRAMEWORK_PATTERNS.imports` list — not a newly invented DSL. That file's
 * own `imports` regexes only ever match a JS/TS-shaped
 * `import X from "pkg"` / `require("pkg")` statement (verified: they never
 * match real Python `from pkg import X` / `import pkg`, since neither
 * carries a quote immediately after `from`/`import`); every Golden
 * Repository Agent fixture is Python or TS, so a Python-shaped import
 * regex is added here per technology so the same real, unambiguous
 * dependency-declaration evidence is actually detected in both languages —
 * this is a correction to a latent gap in the legacy patterns, not a new
 * detection surface. Only the `imports` tier is reused (an explicit import
 * statement is a real, unambiguous dependency declaration); the same
 * legacy file's broader `patterns` tier (bare identifier regexes like
 * `StateGraph\b`) is deliberately NOT reused — those are loose heuristics,
 * not explicit declarations, and would not justify DECLARED trust.
 *
 * "MCP" is intentionally excluded from this framework list: MCP is a
 * protocol, not an agent framework, and this milestone already detects it
 * as its own canonical MCP_SERVER object via real `mcp.json`-shaped config
 * (see mcp-server-declaration.ts) — including it here too would double-count
 * the same real-world signal under two different labels.
 */
interface FrameworkImportPattern {
  readonly name: string;
  readonly imports: readonly RegExp[];
  /** Mirrors codeguard/agent-detector.ts's own pre-existing `agentType`
   * classification for this exact framework name — "orchestrator" frameworks
   * also emit an ORCHESTRATION signal (see OrchestrationFrameworkSignalSpecification). */
  readonly isOrchestrator: boolean;
}

function importRegexes(pythonModule: string, jsPackage: string): readonly RegExp[] {
  const escapedPythonModule = pythonModule.replace(/[.]/g, '\\.');
  const escapedJsPackage = jsPackage.replace(/[/]/g, '\\/');
  return [
    // Python: `from <module>[.sub] import X` / `import <module>`
    new RegExp(`^\\s*from\\s+${escapedPythonModule}(?:\\.[\\w.]+)?\\s+import\\b`),
    new RegExp(`^\\s*import\\s+${escapedPythonModule}\\b`),
    // JS/TS: `import ... from "<pkg>"` / `require("<pkg>")`
    new RegExp(`from\\s+['"]@?${escapedJsPackage}['"]`),
    new RegExp(`require\\(['"]@?${escapedJsPackage}['"]\\)`),
  ];
}

function framework(name: string, pythonModule: string, jsPackage: string, isOrchestrator: boolean): FrameworkImportPattern {
  return { name, imports: importRegexes(pythonModule, jsPackage), isOrchestrator };
}

export const FRAMEWORK_IMPORT_PATTERNS: readonly FrameworkImportPattern[] = [
  framework('LangGraph', 'langgraph', 'langgraph', true),
  framework('CrewAI', 'crewai', 'crewai', true),
  framework('AutoGen', 'autogen', 'autogen', false),
  framework('PydanticAI', 'pydantic_ai', 'pydantic-ai', false),
  framework('OpenAI Swarm', 'swarm', 'swarm', false),
  framework('LangChain', 'langchain', 'langchain', false),
  framework('LlamaIndex', 'llama_index', 'llamaindex', false),
  framework('Haystack', 'haystack', 'haystack', false),
  framework('Semantic Kernel', 'semantic_kernel', 'semantic-kernel', true),
];

function detectFrameworkImportMatches(artifact: SourceArtifactContent): Array<{
  readonly framework: FrameworkImportPattern;
  readonly match: TechnicalProfileSignalMatch;
}> {
  const results: Array<{ framework: FrameworkImportPattern; match: TechnicalProfileSignalMatch }> = [];
  const lines = artifact.text.split(/\r\n|\r|\n/);

  lines.forEach((line, index) => {
    for (const framework of FRAMEWORK_IMPORT_PATTERNS) {
      if (!framework.imports.some((pattern) => pattern.test(line))) continue;
      const lineNumber = index + 1;
      results.push({
        framework,
        match: {
          value: framework.name,
          lineStart: lineNumber,
          lineEnd: lineNumber,
          excerpt: line.trim().slice(0, 200),
          confidence: 0.8,
          // An import statement is an explicit, unambiguous dependency
          // declaration — a semantically authoritative position the
          // language/module system itself defines, not a scanner inference.
          trustState: TRUST_STATE.DECLARED,
        },
      });
    }
  });

  return results;
}

/** Framework/SDK technical-profile signal, real-source (import statement). */
export class FrameworkImportSignalSpecification implements TechnicalProfileSignalSpecification {
  readonly code = 'framework-import-declaration';
  readonly version = '1.0.0';
  readonly signalKind = TECHNICAL_PROFILE_SIGNAL_KIND.FRAMEWORK;

  detect(artifact: SourceArtifactContent): readonly TechnicalProfileSignalMatch[] {
    return detectFrameworkImportMatches(artifact).map((entry) => entry.match);
  }
}

/**
 * Orchestration technical-profile signal, derived from the SAME real import
 * evidence as FrameworkImportSignalSpecification — never a separate
 * invented syntax. Only frameworks codeguard/agent-detector.ts's own
 * pre-existing `agentType: "orchestrator"` classification already applies
 * to (LangGraph, CrewAI, Semantic Kernel) also emit an ORCHESTRATION signal,
 * so Orchestration is a real semantic reclassification of already-real
 * evidence, not a new detection surface.
 */
export class OrchestrationFrameworkSignalSpecification implements TechnicalProfileSignalSpecification {
  readonly code = 'orchestration-framework-classification';
  readonly version = '1.0.0';
  readonly signalKind = TECHNICAL_PROFILE_SIGNAL_KIND.ORCHESTRATION;

  detect(artifact: SourceArtifactContent): readonly TechnicalProfileSignalMatch[] {
    return detectFrameworkImportMatches(artifact)
      .filter((entry) => entry.framework.isOrchestrator)
      .map((entry) => entry.match);
  }
}
