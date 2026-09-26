import "server-only";
import { parseCredentialEpochMillis } from "./credential-epoch";
import { signToken, type SessionPayload } from "./session-token";
import { AuthPublicError, GENERIC_AUTH_ERROR_MESSAGE } from "./errors";

// Backend and database wall clocks must stay within this explicit bound.
export const MAX_DB_CLOCK_SKEW_SECONDS = 5;

/** DB owns the credential epoch; signToken owns iat. Never invent either one.
 * The exact DB epoch text is bound into the token (`credential_epoch`) and is the
 * revocation authority; the iat wait below is only issuance temporal validation.
 * The strict next-second boundary also makes the first signup session eligible.
 * Recheck after every timer wakeup (timers can wake early or clocks can move).
 * Transactional command eligibility remains S0.3.2/S0.3.3 work. */
export async function signSessionAfterCredentialEpoch(
  payload: SessionPayload,
  passwordChangedAt: unknown,
): Promise<string> {
  // Require a zoned DB timestamp (shared strict parser; sub-ms digits retained).
  const epoch = parseCredentialEpochMillis(passwordChangedAt);
  if (!Number.isFinite(epoch)) throw new AuthPublicError(GENERIC_AUTH_ERROR_MESSAGE, 500);
  const eligibleAt = (Math.floor(epoch / 1000) + 1) * 1000;
  for (;;) {
    const now = Date.now();
    if (epoch - now > MAX_DB_CLOCK_SKEW_SECONDS * 1000) {
      throw new AuthPublicError(GENERIC_AUTH_ERROR_MESSAGE, 500);
    }
    if (now >= eligibleAt) return signToken({ ...payload, credentialEpoch: passwordChangedAt as string });
    await new Promise<void>(resolve => setTimeout(resolve, eligibleAt - now));
  }
}
