import 'server-only';
import type { GovernanceWritePrincipal } from '../auth/governance-write-principal';
import { privilegedDb } from '../governance/persistence';
import { decodePassportGovernedFacts } from '../governance/passport-governance-read';
import { decodePassportRiskOverlay } from '../governance/passport-risk-overlay-read';
import { buildExecutiveModel } from './executive-model';

export class ExecutiveAuthorizationError extends Error {
  constructor() { super('EXECUTIVE_AUTHORIZATION_DENIED'); this.name = 'ExecutiveAuthorizationError'; }
}
const fail = (): never => { throw new Error('EXECUTIVE_ACQUISITION_INVALID'); };
const record = (x: unknown): Record<string, unknown> => x && typeof x === 'object' && !Array.isArray(x) ? x as Record<string, unknown> : fail();
const array = (x: unknown): unknown[] => Array.isArray(x) ? x : fail();
const kinds = ['AGENT', 'AGENT_VERSION', 'MODEL', 'TOOL', 'MCP_SERVER', 'API', 'DATA_ASSET', 'DATA_ELEMENT', 'PROMPT', 'KNOWLEDGE_BASE', 'SKILL'];

/** One POST RPC, no privileged read outside its transaction and no partial fallback. */
export async function getExecutiveWorkspace(principal: GovernanceWritePrincipal, requestedPage?: string | string[]) {
  const requested = typeof requestedPage === 'string' && /^[1-9]\d{0,6}$/.test(requestedPage) ? Number(requestedPage) : 1;
  const { data, error, status } = await privilegedDb.rpc('read_executive_workspace_v1', {
    p_verified_organisation_id: principal.organisationId, p_verified_actor_user_id: principal.actorUserId,
    p_verified_session_iat: principal.issuedAtSeconds, p_verified_session_exp: principal.expiresAtSeconds,
    p_verified_credential_epoch: principal.credentialEpoch, p_page: requested,
  });
  if (error) {
    // Preserve explicit refusals, including those from nested projections. No
    // authorization code (or other transaction failure) becomes UNKNOWN.
    if (status === 401 || status === 403 || /^GV[A-Z0-9]{3}$/.test(error.code ?? '') || error.code === '42501' || /^28[A-Z0-9]{3}$/.test(error.code ?? '') ||
        ['401', '403', 'PGRST301', 'PGRST302', 'PGRST303'].includes(error.code ?? '')) throw new ExecutiveAuthorizationError();
    throw new Error('EXECUTIVE_ACQUISITION_FAILED');
  }
  // PostgREST has completed the transaction before resolving a successful POST.
  // Validate everything before constructing any presentation model.
  const result = record(data);
  if (result.organisation_id !== principal.organisationId || result.page_size !== 12) fail();
  const objects = array(result.objects).map(raw => {
    const row = record(raw);
    if (row.organisation_id !== principal.organisationId || typeof row.canonical_object_id !== 'string' || !row.canonical_object_id ||
        typeof row.kind !== 'string' || !kinds.includes(row.kind)) fail();
    return { canonical_object_id: row.canonical_object_id as string, kind: row.kind as string };
  });
  if (new Set(objects.map(o => o.canonical_object_id)).size !== objects.length) fail();
  // Match the RPC's explicit C ordering without locale-dependent collation.
  const agents = objects.filter(o => o.kind === 'AGENT').sort((a, b) => Buffer.compare(Buffer.from(a.canonical_object_id), Buffer.from(b.canonical_object_id)));
  const page = Math.min(requested, Math.max(1, Math.ceil(agents.length / 12)));
  if (result.page !== page) fail();
  const selected = agents.slice((page - 1) * 12, page * 12);
  const rawSubjects = array(result.subjects);
  if (rawSubjects.length !== selected.length) fail();
  const subjects = rawSubjects.map((raw, i) => {
    const row = record(raw), id = selected[i].canonical_object_id;
    if (row.id !== id) fail();
    return { id, facts: { status: 'AVAILABLE' as const, value: decodePassportGovernedFacts(row.facts, id, null) },
      risks: { status: 'AVAILABLE' as const, value: decodePassportRiskOverlay(row.risks, 'AGENT', id) } };
  });
  return buildExecutiveModel({ organisationId: principal.organisationId, objects: { status: 'AVAILABLE', value: objects }, subjects, page, pageSize: 12 });
}
