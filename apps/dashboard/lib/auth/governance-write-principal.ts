import "server-only";
import type { VerifiedGovernancePrincipal } from "./session-token";

/**
 * M16-S0.3.3C: the narrow session-authority transport for the *_governed_v1 DB
 * write wrappers. Contains ONLY the five values those wrappers accept as their
 * first five parameters — never constructed from request body/header/query
 * values, always derived from an already-verified VerifiedGovernancePrincipal.
 * Persistence never re-verifies a JWT itself, and never invents any of these
 * five values from anything other than that principal.
 */
export interface GovernanceWritePrincipal {
  readonly organisationId: string;
  readonly actorUserId: string;
  readonly issuedAtSeconds: number;
  readonly expiresAtSeconds: number;
  /** Exact verified claim string, never rounded/reconstructed through a JS Date. */
  readonly credentialEpoch: string;
}

export function toGovernanceWritePrincipal(
  principal: Pick<VerifiedGovernancePrincipal, "userId" | "organisationId" | "issuedAtSeconds" | "expiresAtSeconds" | "credentialEpoch">,
): GovernanceWritePrincipal {
  return Object.freeze({
    organisationId: principal.organisationId,
    actorUserId: principal.userId,
    issuedAtSeconds: principal.issuedAtSeconds,
    expiresAtSeconds: principal.expiresAtSeconds,
    credentialEpoch: principal.credentialEpoch,
  });
}
