import "server-only";
import { signToken, type SessionPayload } from "./session-token";
import { AuthPublicError, GENERIC_AUTH_ERROR_MESSAGE } from "./errors";

// Backend and database wall clocks must stay within this explicit bound.
export const MAX_DB_CLOCK_SKEW_SECONDS = 5;

/** DB owns the credential epoch; signToken owns iat. Never invent either one.
 * The strict next-second boundary also makes the first signup session eligible.
 * Recheck after every timer wakeup (timers can wake early or clocks can move).
 * Transactional command eligibility remains S0.3.2/S0.3.3 work. */
export async function signSessionAfterCredentialEpoch(
  payload: SessionPayload,
  passwordChangedAt: unknown,
): Promise<string> {
  // Require a zoned DB timestamp; Date.parse alone also accepts ambiguous inputs
  // such as "123" and silently normalizes invalid calendar days.
  const match = typeof passwordChangedAt === "string"
    ? /^(\d{4})-(\d{2})-(\d{2})[T ]\d{2}:\d{2}:\d{2}(?:\.(\d{1,6}))?(?:Z|[+-]\d{2}:\d{2})$/.exec(passwordChangedAt) : null;
  const daysInMonth = match ? new Date(Date.UTC(Number(match[1]), Number(match[2]), 0)).getUTCDate() : 0;
  // Retain sub-millisecond precision for the strict five-second skew ceiling.
  const fraction = match?.[4] ?? "";
  const epoch = match && Number(match[3]) <= daysInMonth
    ? Date.parse(passwordChangedAt as string) + Number(`0.${fraction.slice(3) || "0"}`) : NaN;
  if (!Number.isFinite(epoch)) throw new AuthPublicError(GENERIC_AUTH_ERROR_MESSAGE, 500);
  const eligibleAt = (Math.floor(epoch / 1000) + 1) * 1000;
  for (;;) {
    const now = Date.now();
    if (epoch - now > MAX_DB_CLOCK_SKEW_SECONDS * 1000) {
      throw new AuthPublicError(GENERIC_AUTH_ERROR_MESSAGE, 500);
    }
    if (now >= eligibleAt) return signToken(payload);
    await new Promise<void>(resolve => setTimeout(resolve, eligibleAt - now));
  }
}
