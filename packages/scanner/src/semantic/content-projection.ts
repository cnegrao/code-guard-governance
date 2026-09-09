import { createHash } from "node:crypto";

import { createSemanticContentFingerprint, type SemanticContentFingerprint } from "@council/canonical-contracts";

/**
 * Semantic Intelligence Foundation V1 (roadmap milestone 4, L6/L7 §9).
 *
 * The projection schema/version. Changing the schema requires a new version
 * string so prior representations remain distinguishable and re-generation
 * never silently corrupts them (contracts.ts's SemanticRepresentation keeps
 * `projectionSchemaVersion` as part of the representation's own identity
 * inputs).
 */
export const SEMANTIC_CONTENT_PROJECTION_SCHEMA_VERSION = "GOVIA_SEMANTIC_CONTENT_V1";

/**
 * Deterministic, bounded semantic-content projection input. Every fact must
 * already be evidence-backed and intentionally selected for semantic
 * representation — never raw uncontrolled repository content, never
 * secrets, never full Prompt text (protected per milestone 3's Prompt
 * content-storage policy). Absence of a frozen L6 dimension (Business
 * Domain/Term/Information Domain, purpose, capability) means
 * FOUNDATION_ONLY/NOT_POPULATED for this round — no field here fabricates
 * one; callers simply omit facts they do not have.
 */
export interface SemanticContentProjectionInput {
  readonly subjectKind: "CANONICAL_OBJECT" | "NORMALIZED_CANDIDATE";
  readonly objectKind: string;
  /**
   * Evidence-backed technical facts already governed/observed elsewhere —
   * e.g. an AgentVersion's own behaviorFingerprint.value, a declared
   * identity/declaration key. Never raw file content, never secrets, never
   * Prompt string content. Order is irrelevant to the caller; the
   * projection sorts by key then value and deduplicates exact pairs so
   * traversal/insertion order never affects the resulting fingerprint.
   */
  readonly knownTechnicalFacts: ReadonlyArray<readonly [string, string]>;
}

export interface SemanticContentProjection extends SemanticContentProjectionInput {
  readonly projectionSchemaVersion: typeof SEMANTIC_CONTENT_PROJECTION_SCHEMA_VERSION;
}

const SECRET_LOOKING_VALUE = /-----BEGIN [A-Z ]*PRIVATE KEY-----|api[_-]?key\s*[:=]|secret\s*[:=]|bearer\s+[a-z0-9._-]{16,}/i;

/**
 * Builds a normalized, order-independent projection from caller-supplied
 * evidence-backed facts. Fails closed (throws) rather than silently
 * embedding a value that looks like a secret/credential — this is a
 * deliberately conservative allowlist-style refusal, not a full secret
 * detector; callers remain responsible for only ever supplying
 * evidence-backed, already-vetted technical facts.
 */
export function buildSemanticContentProjection(input: SemanticContentProjectionInput): SemanticContentProjection {
  if (input.objectKind.trim().length === 0) {
    throw new TypeError("Semantic content projection objectKind must be a non-empty string");
  }

  const validatedFacts = input.knownTechnicalFacts.map(([key, value]) => {
    if (typeof key !== "string" || key.trim().length === 0) {
      throw new TypeError("Semantic content projection fact keys must be non-empty");
    }
    if (typeof value !== "string") {
      throw new TypeError("Semantic content projection fact values must be strings");
    }
    if (SECRET_LOOKING_VALUE.test(value)) {
      throw new Error(
        `Semantic content projection refuses fact "${key}": value looks like a secret/credential`,
      );
    }
    return Object.freeze([key, value] as const);
  });
  const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
  const sortedFacts = validatedFacts
    .sort(([aKey, aValue], [bKey, bValue]) => compare(aKey, bKey) || compare(aValue, bValue))
    .filter(([key, value], index, facts) =>
      index === 0 || key !== facts[index - 1][0] || value !== facts[index - 1][1],
    );

  return Object.freeze({
    subjectKind: input.subjectKind,
    objectKind: input.objectKind,
    knownTechnicalFacts: Object.freeze(sortedFacts),
    projectionSchemaVersion: SEMANTIC_CONTENT_PROJECTION_SCHEMA_VERSION,
  });
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/**
 * sha256(canonicalize(projection)), truncated to 32 hex chars — the same
 * deterministic-hash idiom already used by
 * packages/scanner/src/discovery/object-candidate-normalization.ts and
 * agent-version-correlation.ts. Deterministic: no timestamp, no random
 * value, no database row id, no Evidence id, and (because
 * buildSemanticContentProjection sorts facts by key) no traversal-order
 * sensitivity.
 */
export function computeSemanticContentFingerprint(projection: SemanticContentProjection): SemanticContentFingerprint {
  const value = createHash("sha256").update(canonicalJson(projection)).digest("hex").slice(0, 32);

  return createSemanticContentFingerprint({
    algorithm: "sha256",
    schemaVersion: SEMANTIC_CONTENT_PROJECTION_SCHEMA_VERSION,
    value,
  });
}
