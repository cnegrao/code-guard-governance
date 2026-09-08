import { TRUST_STATE } from '@council/canonical-contracts';

import type { SourceArtifactContent } from '../source-adapter';
import {
  TECHNICAL_PROFILE_SIGNAL_KIND,
  type TechnicalProfileSignalMatch,
  type TechnicalProfileSignalSpecification,
} from '../technical-profile-signal';

/**
 * Real-source Memory evidence. The technology list is adapted from the
 * pre-existing (pre-PR#24) `packages/scanner/src/core/memory-detector.ts`'s
 * own `MEMORY_PATTERNS` — not a newly invented DSL. Only technologies with a
 * dedicated `imports` array in that file are reused (an explicit
 * `import redis`/`from chromadb import Client` statement is a real,
 * unambiguous dependency declaration); the same file's bare-pattern-only
 * entries (`ConversationBufferMemory`, `session_state`, `semantic_memory`,
 * `agent_memory` — generic identifier regexes with no `imports` array) are
 * deliberately NOT reused here, since they are loose heuristics rather than
 * explicit declarations and would not justify DECLARED trust.
 *
 * That legacy file's own `imports` regexes only reliably match a bare
 * `import <module>` Python statement or a JS/TS `import X from "pkg"` /
 * `require("pkg")` statement — they do not match the equally common Python
 * `from <module> import X` form (no quote follows `from`). A real Python
 * memory-technology import is at least as likely to use that form (e.g.
 * `from chromadb import Client`), so a matching `from <module> import`
 * regex is added here per technology — a correction to a latent gap in the
 * legacy patterns, not a new detection surface.
 *
 * Neo4j is deliberately excluded even though memory-detector.ts lists it: that
 * same file already classifies Neo4j under its own distinct `type: "knowledge"`
 * (not `"vector_store"`/`"long_term"`), i.e. even the legacy code treats it as
 * conceptually closer to Knowledge Base than to Memory. Folding it into this
 * Memory signal would risk exactly the Memory-vs-Knowledge-Base conflation
 * the original milestone brief prohibits (§17); it is intentionally not
 * detected as either a Memory signal or a KNOWLEDGE_BASE candidate in this
 * round (see the evidence document's KNOWLEDGE_BASE/RAG section).
 */
interface MemoryImportPattern {
  readonly technology: string;
  readonly imports: readonly RegExp[];
}

function importRegexes(pythonModule: string, jsPackage: string): readonly RegExp[] {
  const escapedPythonModule = pythonModule.replace(/[.]/g, '\\.');
  const escapedJsPackage = jsPackage.replace(/[/]/g, '\\/');
  return [
    new RegExp(`^\\s*from\\s+${escapedPythonModule}(?:\\.[\\w.]+)?\\s+import\\b`),
    new RegExp(`^\\s*import\\s+${escapedPythonModule}\\b`),
    new RegExp(`from\\s+['"]@?${escapedJsPackage}['"]`),
    new RegExp(`require\\(['"]@?${escapedJsPackage}['"]\\)`),
  ];
}

function memoryTechnology(technology: string, pythonModule: string, jsPackage: string): MemoryImportPattern {
  return { technology, imports: importRegexes(pythonModule, jsPackage) };
}

export const MEMORY_IMPORT_PATTERNS: readonly MemoryImportPattern[] = [
  memoryTechnology('ChromaDB', 'chromadb', 'chromadb'),
  memoryTechnology('Pinecone', 'pinecone', 'pinecone'),
  memoryTechnology('FAISS', 'faiss', 'faiss'),
  memoryTechnology('Weaviate', 'weaviate', 'weaviate'),
  memoryTechnology('Qdrant', 'qdrant_client', 'qdrant'),
  memoryTechnology('Milvus', 'pymilvus', 'milvus'),
  memoryTechnology('Redis', 'redis', 'redis'),
  memoryTechnology('SQLite', 'sqlite3', 'sqlite3'),
  memoryTechnology('PostgreSQL', 'psycopg2', 'pg'),
];

/** Memory technical-profile signal, real-source (import statement). Never conflated with KNOWLEDGE_BASE. */
export class MemoryImportSignalSpecification implements TechnicalProfileSignalSpecification {
  readonly code = 'memory-import-declaration';
  readonly version = '1.0.0';
  readonly signalKind = TECHNICAL_PROFILE_SIGNAL_KIND.MEMORY;

  detect(artifact: SourceArtifactContent): readonly TechnicalProfileSignalMatch[] {
    const matches: TechnicalProfileSignalMatch[] = [];
    const lines = artifact.text.split(/\r\n|\r|\n/);

    lines.forEach((line, index) => {
      for (const entry of MEMORY_IMPORT_PATTERNS) {
        if (!entry.imports.some((pattern) => pattern.test(line))) continue;
        const lineNumber = index + 1;
        matches.push({
          value: entry.technology,
          lineStart: lineNumber,
          lineEnd: lineNumber,
          excerpt: line.trim().slice(0, 200),
          confidence: 0.8,
          trustState: TRUST_STATE.DECLARED,
        });
      }
    });

    return matches;
  }
}
