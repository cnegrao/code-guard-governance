import "server-only";
import { createHash } from "node:crypto";
import { asDiscoveryFindingId, type NormalizedRelationshipCandidate, type RelationshipDiscoveryFinding } from "@council/canonical-contracts";

/** Observation identity may contain support and row references; semantic
 * candidate identity is never changed. Capture time is not a replay key. */
export function lineageObservationFinding(finding: RelationshipDiscoveryFinding, candidate: NormalizedRelationshipCandidate): RelationshipDiscoveryFinding {
  if (candidate.relationshipTypeCode !== "DERIVED_FROM" || candidate.findingId !== finding.findingId) {
    throw new Error("LINEAGE_OBSERVATION_CONTEXT_MISMATCH");
  }
  const assertionIds = [...new Set(candidate.assertionIds)].sort();
  const evidenceIds = [...new Set(candidate.evidenceIds)].sort();
  const endpoint = (ref: NormalizedRelationshipCandidate["sourceEndpoint"]) => {
    if (ref.referenceKind !== "CANDIDATE" || ref.candidateKind !== "DATA_ELEMENT") throw new Error("LINEAGE_OBSERVATION_ENDPOINT_KIND");
    return [ref.referenceKind, ref.candidateKind, ref.candidateId];
  };
  const fingerprint = createHash("sha256").update(JSON.stringify([
    "lineage-observation-v1", candidate.candidateId,
    endpoint(candidate.sourceEndpoint), endpoint(candidate.targetEndpoint), assertionIds, evidenceIds,
  ])).digest("hex");
  return { ...finding, findingId: asDiscoveryFindingId(`discovery-finding:lineage-observation:${fingerprint}`), assertionIds, evidenceIds };
}
