import "server-only";

import type { NormalizedObjectCandidate, OrganisationId } from "@council/canonical-contracts";
import { stableCandidateContent } from "@council/governance-review";
import { privilegedDb } from "./persistence";
import { normalizedCandidateEnvelopeHash, rehydrateNormalizedCandidate } from "./discovery-intake-persistence";
import { objectMappingIdentity } from "./relationship-resolution";

export class LegacyObjectMappingConflict extends Error {}

/** Preflight only. The object materialization RPC repeats this proof before writing. */
export async function assertLegacyObjectCompatibility(
  org: OrganisationId,
  candidate: NormalizedObjectCandidate,
  outcome: "CREATE_NEW" | "MATCH_EXISTING",
  matchId?: string,
): Promise<void> {
  const ambiguous = () => new LegacyObjectMappingConflict("Historical object mapping cannot be resolved exactly from its governed candidate.");
  const { data: mappings, error } = await privilegedDb.from("canonical_object_source_mappings")
    .select("canonical_object_id,created_by_decision_id")
    .eq("organisation_id", org).eq("canonical_object_kind", candidate.candidateKind)
    .eq("source_connection_id", candidate.sourceObject.connectionId)
    .eq("source_external_type", candidate.sourceObject.externalType)
    .eq("source_external_id", candidate.sourceObject.externalId).is("valid_to", null).limit(2);
  if (error) throw ambiguous();
  if (!mappings?.length) return;
  if (mappings.length !== 1) throw ambiguous();
  const mapping = mappings[0];
  const { data: decision, error: decisionError } = await privilegedDb.from("reconciliation_decisions")
    .select("subject_candidate_id,outcome")
    .eq("organisation_id", org).eq("decision_id", mapping.created_by_decision_id).eq("family", "OBJECT")
    .eq("canonical_object_id", mapping.canonical_object_id).eq("canonical_object_kind", candidate.candidateKind).maybeSingle();
  if (decisionError || !decision?.subject_candidate_id || !["CREATE_NEW", "MATCH_EXISTING"].includes(decision.outcome)) throw ambiguous();
  const { data: original, error: candidateError } = await privilegedDb.from("discovery_candidates")
    .select("envelope,envelope_hash").eq("organisation_id", org).eq("candidate_id", decision.subject_candidate_id)
    .eq("candidate_family", "OBJECT").eq("candidate_kind", candidate.candidateKind)
    .eq("source_connection_id", candidate.sourceObject.connectionId)
    .eq("source_external_type", candidate.sourceObject.externalType)
    .eq("source_external_id", candidate.sourceObject.externalId).maybeSingle();
  if (candidateError || !original) throw ambiguous();
  const { data: canonical, error: canonicalError } = await privilegedDb.from("canonical_objects")
    .select("canonical_object_id").eq("organisation_id", org).eq("canonical_object_id", mapping.canonical_object_id)
    .eq("kind", candidate.candidateKind).maybeSingle();
  if (canonicalError || !canonical) throw ambiguous();
  let same: boolean;
  try {
    const historical = rehydrateNormalizedCandidate(original.envelope);
    if (historical.candidateKind === "RELATIONSHIP" || historical.candidateKind !== candidate.candidateKind ||
        historical.candidateId !== decision.subject_candidate_id ||
        stableCandidateContent(historical.sourceObject) !== stableCandidateContent(candidate.sourceObject) ||
        normalizedCandidateEnvelopeHash(historical) !== original.envelope_hash) throw ambiguous();
    same = await objectMappingIdentity(org, historical) === await objectMappingIdentity(org, candidate);
  } catch { throw ambiguous(); }
  if (!same) return;
  if (outcome === "CREATE_NEW") {
    throw new LegacyObjectMappingConflict("This normalized object already has canonical truth. Use governed MATCH_EXISTING to preserve its historical object and establish the exact mapping.");
  }
  if (matchId !== mapping.canonical_object_id) {
    throw new LegacyObjectMappingConflict("The exact historical object must be selected for MATCH_EXISTING.");
  }
}
