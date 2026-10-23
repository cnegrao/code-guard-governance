import "server-only";
import { db } from "../db";
import type { GovernanceWritePrincipal } from "../auth/governance-write-principal";

export class LedgerWriteUnavailableError extends Error {
  constructor() { super("Ledger recording unavailable"); this.name = "LedgerWriteUnavailableError"; }
}

/** Retained operational records only; no governance authority or completeness claim. */
export async function appendLedgerEvent(
  principal: GovernanceWritePrincipal,
  event: { type: string; description: string; subjectType: string; subjectId: string; payload: Record<string, unknown> },
): Promise<void> {
  try {
    const { data, error } = await db.write.rpc("ledger_append_v2", {
      p_verified_organisation_id: principal.organisationId,
      p_verified_actor_user_id: principal.actorUserId,
      p_verified_session_iat: principal.issuedAtSeconds,
      p_verified_session_exp: principal.expiresAtSeconds,
      p_verified_credential_epoch: principal.credentialEpoch,
      p_event_type: event.type, p_event_desc: event.description,
      p_subject_type: event.subjectType, p_subject_id: event.subjectId,
      p_organisation_id: principal.organisationId, p_payload: event.payload, p_actor_ip: null,
    });
    if (error || typeof data !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(data)) {
      throw new LedgerWriteUnavailableError();
    }
  } catch { throw new LedgerWriteUnavailableError(); }
}
