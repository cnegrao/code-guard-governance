import "server-only";
import { db } from "../db";
import type { VerifiedGovernancePrincipal } from "../auth/session-token";

export type LedgerIntegrityStatus = "VALID" | "BROKEN" | "EMPTY" | "UNKNOWN";
export type LedgerHistory = "LEGACY_GLOBAL_ONLY" | "NO_LEGACY_ENTRIES" | "UNKNOWN";
export interface TenantLedgerIntegrity {
  organisation_id: string;
  status: LedgerIntegrityStatus;
  history: LedgerHistory;
  reason: string | null;
  chain_id: string | null;
  activation_id: string | null;
  algorithm_version: number | null;
  serialization_version: number | null;
  activated_at: string | null;
  scope: "COMPLETE_CURRENT_TENANT_V2";
  checked_entries: string | null;
  verified_through: string | null;
  failure_tenant_sequence: string | null;
  max_entries: 10000;
  integrity_meaning: "RETAINED_RECORD_INTEGRITY_ONLY";
  legacy_payload_authority: "LEGACY_NON_AUTHORITATIVE";
}
export interface TenantLedgerEvent {
  kind: "V2" | "LEGACY";
  event_id: string;
  organisation_id: string;
  tenant_sequence: string | null;
  event_type: string;
  description: string;
  subject_type: string;
  subject_id: string;
  actor_user_id: string | null;
  actor_ip: string | null;
  actor_session_id: string | null;
  event_timestamp: string;
  recorded_at: string;
  /** Evidence content only. Chain integrity cannot establish payload truth. */
  payload: unknown;
  history: "V2" | "LEGACY_GLOBAL_ONLY";
  payload_authority: "RETAINED_RECORD_ONLY" | "LEGACY_NON_AUTHORITATIVE";
  legacy_payload_authority: "LEGACY_NON_AUTHORITATIVE";
}
export interface TenantLedgerPage {
  organisation_id: string;
  events: TenantLedgerEvent[];
  next_cursor: string | null;
}
export class LedgerReadAuthorizationError extends Error {
  constructor() { super("Ledger access denied"); this.name = "LedgerReadAuthorizationError"; }
}
export class LedgerReadUnavailableError extends Error {
  constructor() { super("Ledger reading unavailable"); this.name = "LedgerReadUnavailableError"; }
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const cursor = /^(V2|LEGACY):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const record = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x);
const sequence = (x: unknown): x is string => typeof x === "string" && /^(0|[1-9][0-9]*)$/.test(x);
const nullableString = (x: unknown) => x === null || typeof x === "string";

async function call(principal: VerifiedGovernancePrincipal, name: string, args: Record<string, unknown> = {}): Promise<unknown> {
  let response;
  try {
    response = await db.write.rpc(name, {
      p_verified_organisation_id: principal.organisationId, p_verified_actor_user_id: principal.userId,
      p_verified_session_iat: principal.issuedAtSeconds, p_verified_session_exp: principal.expiresAtSeconds,
      p_verified_credential_epoch: principal.credentialEpoch, p_organisation_id: principal.organisationId, ...args,
    });
  } catch { throw new LedgerReadUnavailableError(); }
  const { data, error } = response;
  if (error) {
    if (/^GV00[1-4]$/.test(error.code)) throw new LedgerReadAuthorizationError();
    if (error.code === "22023") throw new RangeError("Invalid ledger request");
    throw new LedgerReadUnavailableError();
  }
  return data;
}
function unknownResult(org: string): TenantLedgerIntegrity {
  return { organisation_id: org, status: "UNKNOWN", history: "UNKNOWN", reason: "MALFORMED_RESULT",
    chain_id: null, activation_id: null, algorithm_version: null, serialization_version: null, activated_at: null,
    scope: "COMPLETE_CURRENT_TENANT_V2", checked_entries: null, verified_through: null, failure_tenant_sequence: null,
    max_entries: 10000, integrity_meaning: "RETAINED_RECORD_INTEGRITY_ONLY", legacy_payload_authority: "LEGACY_NON_AUTHORITATIVE" };
}
export async function verifyTenantLedger(principal: VerifiedGovernancePrincipal): Promise<TenantLedgerIntegrity> {
  const x = await call(principal, "ledger_tenant_verify_v2");
  if (!record(x) || x.organisation_id !== principal.organisationId ||
    !["VALID", "BROKEN", "EMPTY", "UNKNOWN"].includes(String(x.status)) ||
    !["LEGACY_GLOBAL_ONLY", "NO_LEGACY_ENTRIES", "UNKNOWN"].includes(String(x.history)) ||
    x.scope !== "COMPLETE_CURRENT_TENANT_V2" || x.max_entries !== 10000 ||
    x.integrity_meaning !== "RETAINED_RECORD_INTEGRITY_ONLY" || x.legacy_payload_authority !== "LEGACY_NON_AUTHORITATIVE" ||
    !nullableString(x.reason) || ![x.chain_id,x.activation_id,x.activated_at].every(nullableString) ||
    ![x.algorithm_version,x.serialization_version].every(v => v === null || Number.isInteger(v)) ||
    ![x.checked_entries,x.verified_through,x.failure_tenant_sequence].every(v => v === null || sequence(v)) ||
    (x.chain_id !== null && (typeof x.chain_id !== "string" || !uuid.test(x.chain_id))) ||
    (x.status !== "UNKNOWN" && (typeof x.activation_id !== "string" || !uuid.test(x.activation_id) ||
      x.algorithm_version !== 2 || x.serialization_version !== 1 || typeof x.activated_at !== "string" ||
      !Number.isFinite(Date.parse(x.activated_at)) || !sequence(x.checked_entries) || Number(x.checked_entries) > 10000)) ||
    (x.status === "VALID" && (!sequence(x.checked_entries) || x.checked_entries === "0" ||
      x.verified_through !== x.checked_entries || typeof x.chain_id !== "string" || !uuid.test(x.chain_id))) ||
    (x.status === "EMPTY" && (x.checked_entries !== "0" || x.verified_through !== null)) ||
    (x.status === "UNKNOWN" && (x.checked_entries !== null || x.verified_through !== null)) ||
    (["VALID","EMPTY"].includes(String(x.status)) && x.reason !== null) ||
    (x.status === "BROKEN" && typeof x.reason !== "string") ||
    (x.status !== "VALID" && x.verified_through !== null)) return unknownResult(principal.organisationId);
  // Copy the closed contract, rather than forwarding any unexpected DB metadata.
  return Object.fromEntries(Object.keys(unknownResult(principal.organisationId)).map(k => [k,x[k]])) as unknown as TenantLedgerIntegrity;
}
function event(x: unknown, org: string): TenantLedgerEvent {
  const keys = ["kind","event_id","organisation_id","tenant_sequence","event_type","description","subject_type","subject_id",
    "actor_user_id","actor_ip","actor_session_id","event_timestamp","recorded_at","payload","history","payload_authority","legacy_payload_authority"];
  if (!record(x) || x.organisation_id !== org || typeof x.event_id !== "string" || !uuid.test(x.event_id) ||
    !["V2","LEGACY"].includes(String(x.kind)) || !keys.every(k => Object.hasOwn(x,k)) ||
    ![x.event_type,x.description,x.subject_type,x.subject_id,x.event_timestamp,x.recorded_at].every(v => typeof v === "string") ||
    ![x.actor_user_id,x.actor_ip,x.actor_session_id].every(nullableString) ||
    x.legacy_payload_authority !== "LEGACY_NON_AUTHORITATIVE" ||
    (x.kind === "V2" ? (!sequence(x.tenant_sequence) || x.tenant_sequence === "0" || x.history !== "V2" || x.payload_authority !== "RETAINED_RECORD_ONLY")
      : (x.tenant_sequence !== null || x.history !== "LEGACY_GLOBAL_ONLY" || x.payload_authority !== "LEGACY_NON_AUTHORITATIVE"))) {
    throw new LedgerReadUnavailableError();
  }
  return Object.fromEntries(keys.map(k => [k,x[k]])) as unknown as TenantLedgerEvent;
}
export async function listTenantLedgerEvents(principal: VerifiedGovernancePrincipal,
  options: { limit?: number; cursor?: string; eventType?: string } = {}): Promise<TenantLedgerPage> {
  const limit = options.limit ?? 50;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100 ||
    (options.cursor !== undefined && !cursor.test(options.cursor)) ||
    (options.eventType !== undefined && options.eventType.length > 120)) throw new RangeError("Invalid ledger request");
  const x = await call(principal,"ledger_tenant_events_v2",{p_limit:limit,p_cursor:options.cursor ?? null,p_event_type:options.eventType ?? null});
  if (!record(x) || x.organisation_id !== principal.organisationId || !Array.isArray(x.events) || x.events.length > limit ||
    !(x.next_cursor === null || (typeof x.next_cursor === "string" && cursor.test(x.next_cursor)))) throw new LedgerReadUnavailableError();
  return { organisation_id: principal.organisationId, events: x.events.map(v => event(v,principal.organisationId)), next_cursor: x.next_cursor };
}
export async function getTenantLedgerEvent(principal: VerifiedGovernancePrincipal, kind: "V2" | "LEGACY", id: string): Promise<TenantLedgerEvent | null> {
  if (!["V2","LEGACY"].includes(kind) || !uuid.test(id)) throw new RangeError("Invalid ledger request");
  const x = await call(principal,"ledger_tenant_event_v2",{p_kind:kind,p_event_id:id});
  if (x === null) return null;
  const found = event(x,principal.organisationId);
  if (found.kind !== kind || found.event_id.toLowerCase() !== id.toLowerCase()) throw new LedgerReadUnavailableError();
  return found;
}
