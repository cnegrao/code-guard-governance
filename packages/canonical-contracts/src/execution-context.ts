import {
  API_PROTOCOL_FAMILY, MCP_TRANSPORT,
  type ApiProtocolFamily, type McpTransport, type CanonicalObjectIdentity,
  type SourceObjectIdentity, type TechnicalMetadataSupport, type BehaviorFingerprint,
} from './contracts.ts';
import { sanitizeTechnicalLocator, type IsoTimestamp, type SanitizedTechnicalLocator } from './identifiers.ts';
import type { FieldAuthorityPolicy, FieldAuthorityPolicyHead } from './technical-facts.ts';

/** M13 foundation contracts. No source adapter, acceptance or persistence authority. */
export type ExecutionPrincipalKind = 'SERVICE_ACCOUNT' | 'OAUTH_CLIENT'
  | 'MANAGED_IDENTITY' | 'WORKLOAD_IDENTITY' | 'USER_DELEGATED';
export interface ExecutionPrincipalReference {
  readonly kind: ExecutionPrincipalKind;
  readonly providerCode: string;
  /** Provider directory/account/issuer namespace; never a credential. */
  readonly authorityReference: string;
  readonly principalReference: string;
}
export type ExecutionProtocol =
  | { readonly kind: 'API'; readonly family: ApiProtocolFamily }
  | { readonly kind: 'MCP'; readonly transport: McpTransport };

export type DeclaredExecutionFact =
  | { readonly field: 'CAPABILITY'; readonly capabilityReference: string }
  | { readonly field: 'REQUESTED_SCOPE'; readonly scopeReference: string; readonly resourceReference: string }
  | { readonly field: 'DECLARED_CONNECTIVITY'; readonly endpoint: SanitizedTechnicalLocator; readonly protocol: ExecutionProtocol };
export type TemporalExecutionFact =
  | { readonly field: 'PRINCIPAL'; readonly principal: ExecutionPrincipalReference }
  | { readonly field: 'ROLE_REFERENCE'; readonly principal: ExecutionPrincipalReference; readonly roleReference: string }
  | { readonly field: 'GRANTED_SCOPE'; readonly principal: ExecutionPrincipalReference; readonly scopeReference: string; readonly resourceReference: string }
  | { readonly field: 'PERMISSION'; readonly principal: ExecutionPrincipalReference; readonly actionReference: string; readonly resourceReference: string; readonly state: 'ALLOWED' | 'DENIED' | 'UNKNOWN' }
  | { readonly field: 'ENVIRONMENT'; readonly environment: 'DEVELOPMENT' | 'TEST' | 'STAGING' | 'PRODUCTION' | 'UNKNOWN' }
  | { readonly field: 'NETWORK_CONTEXT'; readonly networkReference: string; readonly vpcReference?: string }
  | { readonly field: 'EGRESS'; readonly egressReference: string }
  | { readonly field: 'DEPLOYMENT_CONNECTIVITY'; readonly endpoint: SanitizedTechnicalLocator; readonly protocol: ExecutionProtocol; readonly classification: 'INTERNAL' | 'EXTERNAL' | 'UNKNOWN' };
export type ExecutionFact = DeclaredExecutionFact | TemporalExecutionFact;
export type ExecutionField = ExecutionFact['field'];
export type ExecutionFactClassification = 'BEHAVIOR_VERSIONED' | 'EXECUTION_CONTEXT_TEMPORAL';

/** Approved direct source subset. Actual grant/deny facts have no producer in V1. */
export type DirectExecutionFact = DeclaredExecutionFact | Extract<TemporalExecutionFact, { field: 'PRINCIPAL' }>;
export type DirectExecutionField = DirectExecutionFact['field'];
export const DIRECT_EXECUTION_FIELDS: readonly DirectExecutionField[] = Object.freeze(['CAPABILITY', 'PRINCIPAL', 'DECLARED_CONNECTIVITY', 'REQUESTED_SCOPE']);
export interface ExecutionSourceSnapshot {
  readonly organisationId: import('./identifiers.ts').OrganisationId;
  readonly snapshotId: string;
  readonly sourceScope: string;
  readonly agentVersionCandidateId: string;
  readonly sourceObject: SourceObjectIdentity;
  readonly sourceSystemId: string;
  readonly providerCode: string;
  readonly declarationKey: string;
  readonly sourceSnapshotId: string;
  readonly behaviorFingerprint: BehaviorFingerprint;
  readonly recordedAt: IsoTimestamp;
  readonly authorizationState: 'UNKNOWN';
  readonly facts: readonly {
    readonly fact: DirectExecutionFact;
    readonly assertionId: string;
    readonly evidenceId: string;
    readonly toolCandidateId?: string;
  }[];
}
export interface ExecutionFieldDecision {
  readonly organisationId: import('./identifiers.ts').OrganisationId;
  readonly decisionId: string;
  readonly canonicalObject: CanonicalObjectIdentity<'AGENT_VERSION'>;
  readonly snapshotId: string;
  readonly field: DirectExecutionField;
  readonly expectedCurrentStateId?: string;
  readonly policyId?: string;
  readonly policyVersion?: string;
  readonly outcome: import('./technical-facts.ts').FieldDecisionOutcome;
  readonly actor: { readonly authorityKind: 'HUMAN'; readonly actorReference: string };
  readonly decidedAt: IsoTimestamp;
}

/** Deliberately independent of M10's DataAsset/DataElement TechnicalFact union. */
export interface ExecutionFieldAuthorityPolicy extends Omit<FieldAuthorityPolicy, 'objectKind' | 'field'> {
  readonly objectKind: 'AGENT_VERSION';
  readonly field: ExecutionField;
}
export type ExecutionFieldAuthorityPolicyHead = FieldAuthorityPolicyHead;

/** A trusted reader/adapter must prove this binding; this shape is not proof by itself. */
export interface ExecutionFactSupport {
  readonly sourceSystemId: string;
  readonly providerCode: string;
  readonly sourceObject: SourceObjectIdentity;
  readonly snapshotId: string;
  readonly method: { readonly code: string; readonly version: string };
  /** All semantic leaves of the fact must be supported by these assertions. */
  readonly support: TechnicalMetadataSupport;
  readonly recordedAt: IsoTimestamp;
}
export interface DeclaredExecutionContract {
  readonly subject: CanonicalObjectIdentity<'AGENT_VERSION'>;
  readonly behaviorFingerprint: BehaviorFingerprint;
  readonly facts: readonly {
    readonly fact: DeclaredExecutionFact;
    readonly trustState: 'DECLARED';
    readonly provenance: ExecutionFactSupport;
  }[];
}
export interface ExecutionContextFact {
  readonly subject: CanonicalObjectIdentity<'AGENT_VERSION'>;
  /** Explicit source deployment/context identity, never guessed from version/name. */
  readonly contextReference: string;
  readonly fact: TemporalExecutionFact;
  readonly trustState: 'DECLARED' | 'IMPORTED';
  readonly effectiveFrom?: IsoTimestamp;
  readonly effectiveTo?: IsoTimestamp;
  readonly provenance: ExecutionFactSupport;
}

/** Value-free errors: callers must never log rejected source values. */
function invalid(): never { throw new TypeError('INVALID_EXECUTION_FACT'); }
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))) invalid();
  return value as Record<string, unknown>;
}
function keys(value: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  const item = record(value);
  if (Object.keys(item).some(key => !required.includes(key) && !optional.includes(key)) ||
    required.some(key => !Object.hasOwn(item, key))) invalid();
  // JSON-like own data properties only: never run getters supplied by a caller.
  if (Object.values(Object.getOwnPropertyDescriptors(item)).some(d => !('value' in d))) invalid();
  return item;
}
function oneOf(value: unknown, values: readonly string[]): void {
  if (typeof value !== 'string' || !values.includes(value)) invalid();
}
/** Conservative transport guard, not proof that an arbitrary opaque string is non-secret. */
function reference(value: unknown): string {
  if (typeof value !== 'string' || !value.length || value !== value.trim() || value.length > 512 ||
    /[\s\u0000-\u001f\u007f]/u.test(value) ||
    /(?:bearer|basic|password|passwd|client[_-]?secret|api[_-]?key|access[_-]?token|refresh[_-]?token|authorization|cookie|private[_-]?key)[=:]/i.test(value) ||
    /(?:-----BEGIN|eyJ[A-Za-z0-9_-]+\.|sk[-_][A-Za-z0-9_-]{8,}|gh[pousr]_[A-Za-z0-9]+|AKIA[A-Z0-9]{16})/.test(value)) invalid();
  // References may be safe URIs, but never credentials, query strings or fragments.
  if (/[?#%]/.test(value) || /:\/\/[^/]*@/.test(value)) invalid();
  return value;
}
function principal(value: unknown): ExecutionPrincipalReference {
  const p = keys(value, ['kind', 'providerCode', 'authorityReference', 'principalReference']);
  oneOf(p.kind, ['SERVICE_ACCOUNT', 'OAUTH_CLIENT', 'MANAGED_IDENTITY', 'WORKLOAD_IDENTITY', 'USER_DELEGATED']);
  return Object.freeze({ kind: p.kind as ExecutionPrincipalKind, providerCode: reference(p.providerCode),
    authorityReference: reference(p.authorityReference), principalReference: reference(p.principalReference) });
}
function protocol(value: unknown): ExecutionProtocol {
  const p = record(value);
  if (Object.values(Object.getOwnPropertyDescriptors(p)).some(d => !('value' in d))) invalid();
  if (p.kind === 'API') {
    keys(p, ['kind', 'family']); oneOf(p.family, Object.values(API_PROTOCOL_FAMILY));
    return Object.freeze({ kind: 'API', family: p.family as ApiProtocolFamily });
  }
  if (p.kind === 'MCP') {
    keys(p, ['kind', 'transport']); oneOf(p.transport, Object.values(MCP_TRANSPORT));
    return Object.freeze({ kind: 'MCP', transport: p.transport as McpTransport });
  }
  return invalid();
}
function endpoint(value: unknown): SanitizedTechnicalLocator {
  const safe = reference(value);
  // M13 endpoint foundation is URI-only; filesystem/command locators are not network endpoints.
  try {
    const url = new URL(safe);
    if (!['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol) || !url.hostname || url.username || url.password) invalid();
  } catch { invalid(); }
  return sanitizeTechnicalLocator(safe);
}

/** Closed copied/frozen semantic value. It does not assert source support or authority. */
export function createExecutionFact(value: ExecutionFact): ExecutionFact {
  const f = record(value);
  // Reject accessors before examining discriminants.
  if (Object.values(Object.getOwnPropertyDescriptors(f)).some(d => !('value' in d))) invalid();
  switch (f.field) {
    case 'CAPABILITY':
      keys(f, ['field', 'capabilityReference']);
      return Object.freeze({ field: f.field, capabilityReference: reference(f.capabilityReference) });
    case 'REQUESTED_SCOPE':
      keys(f, ['field', 'scopeReference', 'resourceReference']);
      return Object.freeze({ field: f.field, scopeReference: reference(f.scopeReference), resourceReference: reference(f.resourceReference) });
    case 'DECLARED_CONNECTIVITY':
      keys(f, ['field', 'endpoint', 'protocol']);
      return Object.freeze({ field: f.field, endpoint: endpoint(f.endpoint), protocol: protocol(f.protocol) });
    case 'PRINCIPAL':
      keys(f, ['field', 'principal']);
      return Object.freeze({ field: f.field, principal: principal(f.principal) });
    case 'ROLE_REFERENCE':
      keys(f, ['field', 'principal', 'roleReference']);
      return Object.freeze({ field: f.field, principal: principal(f.principal), roleReference: reference(f.roleReference) });
    case 'GRANTED_SCOPE':
      keys(f, ['field', 'principal', 'scopeReference', 'resourceReference']);
      return Object.freeze({ field: f.field, principal: principal(f.principal), scopeReference: reference(f.scopeReference), resourceReference: reference(f.resourceReference) });
    case 'PERMISSION':
      keys(f, ['field', 'principal', 'actionReference', 'resourceReference', 'state']);
      oneOf(f.state, ['ALLOWED', 'DENIED', 'UNKNOWN']);
      return Object.freeze({ field: f.field, principal: principal(f.principal), actionReference: reference(f.actionReference),
        resourceReference: reference(f.resourceReference), state: f.state as 'ALLOWED' | 'DENIED' | 'UNKNOWN' });
    case 'ENVIRONMENT':
      keys(f, ['field', 'environment']); oneOf(f.environment, ['DEVELOPMENT', 'TEST', 'STAGING', 'PRODUCTION', 'UNKNOWN']);
      return Object.freeze({ field: f.field, environment: f.environment as Extract<TemporalExecutionFact, { field: 'ENVIRONMENT' }>['environment'] });
    case 'NETWORK_CONTEXT':
      keys(f, ['field', 'networkReference'], ['vpcReference']);
      return Object.freeze({ field: f.field, networkReference: reference(f.networkReference),
        ...(f.vpcReference === undefined ? {} : { vpcReference: reference(f.vpcReference) }) });
    case 'EGRESS':
      keys(f, ['field', 'egressReference']);
      return Object.freeze({ field: f.field, egressReference: reference(f.egressReference) });
    case 'DEPLOYMENT_CONNECTIVITY':
      keys(f, ['field', 'endpoint', 'protocol', 'classification']); oneOf(f.classification, ['INTERNAL', 'EXTERNAL', 'UNKNOWN']);
      return Object.freeze({ field: f.field, endpoint: endpoint(f.endpoint), protocol: protocol(f.protocol),
        classification: f.classification as 'INTERNAL' | 'EXTERNAL' | 'UNKNOWN' });
    default: return invalid();
  }
}

export function classifyExecutionFact(value: ExecutionFact): ExecutionFactClassification {
  const fact = createExecutionFact(value);
  return ['CAPABILITY', 'REQUESTED_SCOPE', 'DECLARED_CONNECTIVITY'].includes(fact.field)
    ? 'BEHAVIOR_VERSIONED' : 'EXECUTION_CONTEXT_TEMPORAL';
}

/** Closed semantic projection only; caller must prove declaration/binding before version discovery. */
export function declaredExecutionSemanticValues(facts: readonly DeclaredExecutionFact[]): readonly string[] {
  if (!Array.isArray(facts)) invalid();
  return Object.freeze([...new Set(facts.map(fact => {
    const copied = createExecutionFact(fact);
    if (classifyExecutionFact(copied) !== 'BEHAVIOR_VERSIONED') invalid();
    return JSON.stringify(copied);
  }))].sort());
}
