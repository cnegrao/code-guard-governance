import type { CanonicalObjectIdentity, TechnicalFact } from './index.ts';
import type { DeclaredExecutionContract, DeclaredExecutionFact, ExecutionContextFact,
  ExecutionFieldAuthorityPolicy, ExecutionPrincipalReference, TemporalExecutionFact } from './execution-context.ts';

declare const agent: CanonicalObjectIdentity<'AGENT'>;
declare const declared: DeclaredExecutionContract;
declare const context: ExecutionContextFact;
declare const policy: ExecutionFieldAuthorityPolicy;
declare const principal: ExecutionPrincipalReference;
const capability: DeclaredExecutionFact = { field: 'CAPABILITY', capabilityReference: 'call-api' };
const requested: DeclaredExecutionFact = { field: 'REQUESTED_SCOPE', scopeReference: 'read', resourceReference: 'catalog' };
const granted: TemporalExecutionFact = { field: 'GRANTED_SCOPE', principal, scopeReference: 'read', resourceReference: 'catalog' };
// @ts-expect-error Logical AGENT never substitutes for technical subject.
const wrongSubject: DeclaredExecutionContract = { ...declared, subject: agent };
// @ts-expect-error Assignment is temporal, never a behavior declaration.
const wrongLayer: DeclaredExecutionFact = { field: 'PRINCIPAL', principal };
// @ts-expect-error Requested scope cannot populate a granted-scope fact.
const copiedScope: TemporalExecutionFact = requested;
// @ts-expect-error Static declaration cannot claim runtime observation.
const runtime: ExecutionContextFact = { ...context, trustState: 'OBSERVED' };
// @ts-expect-error Closed fact authority vocabulary, no arbitrary field paths.
const arbitraryPolicy: ExecutionFieldAuthorityPolicy = { ...policy, field: 'custom.authz' };
// @ts-expect-error M10 data fact domain is not silently widened.
const dataFact: TechnicalFact = capability;
// @ts-expect-error No credential fields on principal.
const credentials: ExecutionPrincipalReference = { ...principal, clientSecret: 'synthetic' };
// @ts-expect-error A group is not a principal kind.
const group: ExecutionPrincipalReference = { ...principal, kind: 'GROUP' };
void [capability, requested, granted, wrongSubject, wrongLayer, copiedScope, runtime, arbitraryPolicy, dataFact, credentials, group];
