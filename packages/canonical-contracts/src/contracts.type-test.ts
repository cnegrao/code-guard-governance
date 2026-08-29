import {
  CANONICAL_OBJECT_KIND,
  type CanonicalObjectKind,
  type Evidence,
  type InboundAdapterEnvelope,
  type SourceAssertion,
} from "./contracts.ts";
import { githubRepositoryDiscoveryFixture } from "./fixtures.ts";

const validKinds: readonly CanonicalObjectKind[] = [
  CANONICAL_OBJECT_KIND.AGENT,
  CANONICAL_OBJECT_KIND.AGENT_VERSION,
];
void validKinds;

// @ts-expect-error V1A is closed to AGENT and AGENT_VERSION.
const unsupportedKind: CanonicalObjectKind = "DATA_ASSET";
void unsupportedKind;

const envelopeCannotClaimTenant: InboundAdapterEnvelope = {
  ...githubRepositoryDiscoveryFixture,
  // @ts-expect-error Tenant authority is supplied by trusted orchestration, not an adapter.
  organisationId: "organisation-from-payload",
};
void envelopeCannotClaimTenant;

const assertionCannotStoreFacts: SourceAssertion = {
  ...githubRepositoryDiscoveryFixture.assertions[0],
  // @ts-expect-error SourceAssertion is a provenance envelope, not generic EAV.
  valueJson: { arbitrary: "fact" },
};
void assertionCannotStoreFacts;

const evidenceCannotStoreRawSecrets: Evidence = {
  ...githubRepositoryDiscoveryFixture.evidence[0],
  // @ts-expect-error Evidence has no raw secret or sensitive-value field.
  rawSensitiveValue: "must-not-exist",
};
void evidenceCannotStoreRawSecrets;
