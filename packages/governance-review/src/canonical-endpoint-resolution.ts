import { createHash } from "node:crypto";
import type { CanonicalObjectIdentity, CanonicalObjectKind, GovernedRelationshipType, NormalizedObjectCandidate, NormalizedRelationshipCandidate, OrganisationId, PreCanonicalObjectReference } from "@council/canonical-contracts";
import { SubjectMismatchError } from "./errors";

export class EndpointResolutionError extends SubjectMismatchError {
  readonly reason: "ENDPOINT_NOT_CANONICAL" | "ENDPOINT_MAPPING_AMBIGUOUS" | "ENDPOINT_IDENTITY_MISSING" | "ENDPOINT_CONTEXT_MISMATCH";
  constructor(reason: EndpointResolutionError["reason"]) {
    super(reason);
    this.reason = reason;
  }
}

/** Length framing preserves opaque identifiers, including separators and Unicode. */
export function frameIdentity(parts: readonly string[]): string {
  return parts.map(value => `${Buffer.byteLength(value, "utf8")}:${value}`).join("");
}

/** Existing normalized semantic values only. Detector finding IDs contain locations. */
export function normalizedObjectIdentity(candidate: NormalizedObjectCandidate, parent?: NormalizedObjectCandidate): string {
  if (candidate.candidateKind === "AGENT_VERSION") {
    if (!/^candidate:agent-version:[a-f0-9]{32}$/.test(candidate.candidateId)) {
      throw new EndpointResolutionError("ENDPOINT_IDENTITY_MISSING");
    }
    return candidate.candidateId;
  }
  const fields = {
    AGENT: "agentCode", MODEL: "modelReference", TOOL: "declarationKey",
    MCP_SERVER: "serverReference", API: "apiReference", PROMPT: "declarationKey",
    KNOWLEDGE_BASE: "sourceReference", SKILL: "declarationReference", DATA_ASSET: "sourceReference",
  } as const;
  if (candidate.candidateKind === "DATA_ELEMENT") {
    if (!parent || parent.candidateKind !== "DATA_ASSET" || !candidate.proposedIdentity.elementPath?.trim()) {
      throw new EndpointResolutionError("ENDPOINT_IDENTITY_MISSING");
    }
    return frameIdentity([parent.sourceObject.connectionId, parent.sourceObject.externalType,
      parent.sourceObject.externalId, normalizedObjectIdentity(parent), candidate.proposedIdentity.elementPath]);
  }

  const value = (candidate.proposedIdentity as Record<string, unknown>)[fields[candidate.candidateKind]];
  if (typeof value !== "string" || !value.trim()) throw new EndpointResolutionError("ENDPOINT_IDENTITY_MISSING");
  return value;
}

export function canonicalRelationshipId(org: OrganisationId, type: GovernedRelationshipType, sourceId: string, targetId: string): string {
  return `canonical-relationship:${createHash("sha256").update(frameIdentity([org, type, sourceId, targetId])).digest("hex")}`;
}

export interface CanonicalEndpointResolutionPort {
  resolveEndpoint(organisationId: OrganisationId, reference: PreCanonicalObjectReference): Promise<CanonicalObjectIdentity>;
  getRelationshipCandidate(organisationId: OrganisationId, candidateId: string): Promise<NormalizedRelationshipCandidate | undefined>;
}

export function stableCandidateContent(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableCandidateContent).join(",")}]`;
  if (value !== null && typeof value === "object") return `{${Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${stableCandidateContent(v)}`).join(",")}}`;
  return JSON.stringify(value);
}

export function requireExactCanonicalMapping(
  organisationId: OrganisationId,
  kind: CanonicalObjectKind,
  objects: readonly CanonicalObjectIdentity[],
): CanonicalObjectIdentity {
  if (!objects.length) throw new EndpointResolutionError("ENDPOINT_NOT_CANONICAL");
  if (objects.length !== 1) throw new EndpointResolutionError("ENDPOINT_MAPPING_AMBIGUOUS");
  const object = objects[0];
  if (object.organisationId !== organisationId || object.kind !== kind || !object.objectId) {
    throw new EndpointResolutionError("ENDPOINT_CONTEXT_MISMATCH");
  }
  return Object.freeze({ ...object });
}
