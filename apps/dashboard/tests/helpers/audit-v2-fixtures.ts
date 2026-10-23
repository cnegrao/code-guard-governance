import type { TenantLedgerEvent, TenantLedgerIntegrity } from '../../lib/governance/ledger-read';
import type { VerifiedGovernancePrincipal } from '../../lib/auth/session-token';
export const org = '11111111-1111-4111-8111-111111111111';
export const id = '22222222-2222-4222-8222-222222222222';
export const foreign = '99999999-9999-4999-8999-999999999999';
export const principal: VerifiedGovernancePrincipal = { organisationId: org, userId: id, issuedAtSeconds: 100, expiresAtSeconds: 200,
  credentialEpoch: '2026-10-21T00:00:00.123456+00:00', informational: { role: 'display-only', email: 'ignored@example.invalid' } };
export function integrity(status: TenantLedgerIntegrity['status'] = 'VALID', history: TenantLedgerIntegrity['history'] = 'LEGACY_GLOBAL_ONLY'): TenantLedgerIntegrity {
  return { organisation_id: org, status, history, reason: status === 'BROKEN' ? 'HEAD_MISMATCH' : null,
    chain_id: id, activation_id: id, algorithm_version: 2, serialization_version: 1, activated_at: '2026-10-21T00:00:00Z',
    scope: 'COMPLETE_CURRENT_TENANT_V2', checked_entries: status === 'UNKNOWN' ? null : status === 'EMPTY' ? '0' : '3',
    verified_through: status === 'VALID' ? '3' : null, failure_tenant_sequence: null, max_entries: 10000,
    integrity_meaning: 'RETAINED_RECORD_INTEGRITY_ONLY', legacy_payload_authority: 'LEGACY_NON_AUTHORITATIVE' };
}
export function event(kind: TenantLedgerEvent['kind'] = 'V2'): TenantLedgerEvent {
  return { kind, event_id: id, organisation_id: org, tenant_sequence: kind === 'V2' ? '3' : null, event_type: 'TEST',
    description: 'Retained description', subject_type: 'SYSTEM', subject_id: id, actor_user_id: null, actor_ip: null, actor_session_id: null,
    event_timestamp: '2026-10-21T00:00:00Z', recorded_at: '2026-10-21T00:00:01Z', payload: { human_oversight_verified: true, semantic_truth: false },
    history: kind === 'V2' ? 'V2' : 'LEGACY_GLOBAL_ONLY', payload_authority: kind === 'V2' ? 'RETAINED_RECORD_ONLY' : 'LEGACY_NON_AUTHORITATIVE',
    legacy_payload_authority: 'LEGACY_NON_AUTHORITATIVE' };
}
