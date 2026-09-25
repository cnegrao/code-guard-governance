import "server-only";
import { findCurrentUserForAuthorization, getOrganisationForAuth, resolveRoleCodesForAuth } from "./persistence";
import { createLegacyAuthAdapter } from "./legacy-authorization";
import type { VerifiedGovernancePrincipal } from "./session-token";

export class CurrentAuthorizationInfrastructureError extends Error {
  constructor() {
    super("Unable to resolve current governance authorization");
    this.name = "CurrentAuthorizationInfrastructureError";
  }
}

/** Existing pre-M16 reviewer ceiling, resolved afresh from persistence.
 * This is not L14 Authority Policy or transactional S0.3 eligibility. */
export async function resolveCurrentGovernanceRole(
  principal: Pick<VerifiedGovernancePrincipal, "userId" | "organisationId">,
): Promise<"org_admin" | "user"> {
  try {
    const user = await findCurrentUserForAuthorization(principal.userId, principal.organisationId);
    if (!user || user.user_id !== principal.userId || user.organisation_id !== principal.organisationId ||
        user.status !== "active" || !Array.isArray(user.role_ids) ||
        user.role_ids.some(id => typeof id !== "string" || !id.trim())) return "user";
    const org = await getOrganisationForAuth(principal.organisationId);
    if (!org || org.organisation_id !== principal.organisationId || !org.is_active) return "user";
    const roles = await resolveRoleCodesForAuth(user.role_ids);
    return createLegacyAuthAdapter(user.role_ids, roles).isSystemAdmin() ? "org_admin" : "user";
  } catch {
    // Persistence/transport failures are not evidence of current ineligibility.
    // Deliberately discard private database diagnostics at this boundary.
    throw new CurrentAuthorizationInfrastructureError();
  }
}
