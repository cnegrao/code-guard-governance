import { createHash } from 'node:crypto';
import { asAcquisitionRunId, asDiscoveryFindingId, asEvidenceId, asExternalId, asIsoTimestamp,
  asNormalizedCandidateId, asSourceAssertionId, asSourceSnapshotId, sanitizeEvidenceLocator,
  type InboundAdapterEnvelope, type SourceConnectionReference, type SourceSystem, type NormalizedObjectCandidate,
  type TechnicalFact, type TechnicalFactTransport, type IsoTimestamp } from '@council/canonical-contracts';

export const PURVIEW_PROVIDER = 'microsoft-purview';
export const PURVIEW_ADAPTER = { name: 'microsoft-purview-datamap', version: '1.0.0', apiVersion: '2023-09-01' } as const;
export const PURVIEW_TYPE_MAPPING = {
  azure_sql_table: { kind: 'DATA_ASSET', structuralKind: 'TABLE' },
  azure_sql_column: { kind: 'DATA_ELEMENT' },
} as const;
/** Minimum documented Atlas entity projection. No tenant, policy or canonical ID. */
export interface PurviewAtlasEntity {
  readonly guid: string;
  readonly typeName: keyof typeof PURVIEW_TYPE_MAPPING;
  readonly attributes: { readonly qualifiedName: string; readonly name: string; readonly description?: string; readonly data_type?: string };
  readonly version?: number;
  readonly lastModifiedTS?: string;
  readonly tableGuid?: string;
  readonly columnGuids?: readonly string[];
}
const digest = (x: unknown) => createHash('sha256').update(JSON.stringify(x)).digest('hex');
function record(x: unknown): Record<string, unknown> {
  if (!x || typeof x !== 'object' || Array.isArray(x) || Object.getPrototypeOf(x) !== Object.prototype) throw new TypeError('PURVIEW_INVALID_OBJECT');
  return x as Record<string, unknown>;
}
function text(x: unknown): string {
  if (typeof x !== 'string' || !x.trim() || x !== x.trim() || x.length > 2048 || /[\u0000-\u001f]|(?:password|secret|token)\s*[:=]|bearer\s|eyJ[A-Za-z0-9_-]+\./iu.test(x)) throw new TypeError('PURVIEW_INVALID_STRING');
  return x;
}
function guid(x: unknown): string {
  const value = text(x);
  if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(value)) throw new TypeError('PURVIEW_INVALID_GUID');
  return value.toLowerCase();
}
function ref(x: unknown, type: string): string {
  const r = record(x);
  if (r.typeName !== type || (r.entityStatus !== undefined && r.entityStatus !== 'ACTIVE') ||
      (r.relationshipStatus !== undefined && r.relationshipStatus !== 'ACTIVE')) throw new TypeError('PURVIEW_INVALID_REFERENCE');
  return guid(r.guid);
}
function rejectAuthority(x: unknown, depth = 0): void {
  if (depth > 12) throw new TypeError('PURVIEW_DEPTH_LIMIT');
  if (!x || typeof x !== 'object') return;
  for (const [key, value] of Object.entries(x)) {
    if (/^(?:__proto__|prototype|constructor|organisationId|organizationId|canonicalObject|canonicalObjectId|canonicalMappings|authorityPolicy|governanceDecision|trustState|connectionId|sourceSystemId)$/i.test(key)) throw new TypeError('PURVIEW_FORBIDDEN_PROPERTY');
    rejectAuthority(value, depth + 1);
  }
}
export function parsePurviewEntities(json: string): readonly PurviewAtlasEntity[] {
  if (typeof json !== 'string' || Buffer.byteLength(json) > 1_048_576) throw new TypeError('PURVIEW_SIZE_LIMIT');
  const payload = record(JSON.parse(json));
  rejectAuthority(payload);
  if (Object.keys(payload).some(k => !['entities','referredEntities'].includes(k)) || !Array.isArray(payload.entities) || payload.entities.length > 500) throw new TypeError('PURVIEW_INVALID_BATCH');
  const referred = payload.referredEntities === undefined ? [] : Object.entries(record(payload.referredEntities)).map(([key, entity]) => {
    if (guid(record(entity).guid) !== guid(key)) throw new TypeError('PURVIEW_REFERRED_GUID_MISMATCH');
    return entity;
  });
  const entities = [...payload.entities, ...referred].map(raw => {
    const e = record(raw), a = record(e.attributes);
    if (e.typeName !== 'azure_sql_table' && e.typeName !== 'azure_sql_column') throw new TypeError('PURVIEW_UNSUPPORTED_TYPE');
    if (e.status !== 'ACTIVE' || e.isIncomplete === true || e.proxy === true) throw new TypeError('PURVIEW_INACTIVE_OR_INCOMPLETE');
    const q = text(a.qualifiedName), name = text(a.name);
    const url = new URL(q);
    if (url.protocol !== 'mssql:' || !url.hostname || url.username || url.password || url.search ||
        (e.typeName === 'azure_sql_table' && url.hash)) throw new TypeError('PURVIEW_UNSAFE_QUALIFIED_NAME');
    if (e.version !== undefined && (!Number.isSafeInteger(e.version) || (e.version as number) < 0)) throw new TypeError('PURVIEW_INVALID_VERSION');
    const relationships = e.relationshipAttributes === undefined ? {} : record(e.relationshipAttributes);
    const columnGuids = relationships.columns === undefined ? undefined : (() => {
      if (!Array.isArray(relationships.columns)) throw new TypeError('PURVIEW_INVALID_COLUMNS');
      return relationships.columns.map(c => ref(c, 'azure_sql_column'));
    })();
    return { guid: guid(e.guid), typeName: e.typeName, attributes: { qualifiedName: q, name,
      ...(a.description == null ? {} : { description: text(a.description) }),
      ...(a.data_type == null ? {} : { data_type: text(a.data_type) }) },
      ...(e.version === undefined ? {} : { version: e.version as number }),
      ...(e.lastModifiedTS === undefined ? {} : { lastModifiedTS: text(e.lastModifiedTS) }),
      ...(e.typeName === 'azure_sql_column' ? { tableGuid: ref(relationships.table, 'azure_sql_table') } : {}),
      ...(columnGuids === undefined ? {} : { columnGuids }) } satisfies PurviewAtlasEntity;
  });
  if (!entities.length || entities.length > 500 || new Set(entities.map(e => e.guid)).size !== entities.length) throw new TypeError('PURVIEW_DUPLICATE_OR_EMPTY');
  const map = new Map(entities.map(e => [e.guid, e]));
  const elementNames = new Set<string>(), assetNames = new Set<string>();
  for (const e of entities) {
    if (e.typeName === 'azure_sql_column') {
      const parent = map.get(e.tableGuid!);
      if (!parent || parent.typeName !== 'azure_sql_table' || (parent.columnGuids && !parent.columnGuids.includes(e.guid))) throw new TypeError('PURVIEW_PARENT_MISSING');
      const key = JSON.stringify([parent.guid, e.attributes.name]);
      if (elementNames.has(key)) throw new TypeError('PURVIEW_AMBIGUOUS_ELEMENT');
      elementNames.add(key);
    } else {
      if (assetNames.has(e.attributes.qualifiedName)) throw new TypeError('PURVIEW_AMBIGUOUS_ASSET');
      assetNames.add(e.attributes.qualifiedName);
      if (e.columnGuids && (new Set(e.columnGuids).size !== e.columnGuids.length || e.columnGuids.some(id => map.get(id)?.tableGuid !== e.guid))) throw new TypeError('PURVIEW_DANGLING_COLUMN');
    }
  }
  return entities.sort((a,b) => a.typeName === b.typeName ? a.guid.localeCompare(b.guid) : a.typeName === 'azure_sql_table' ? -1 : 1);
}

export function purviewInbound(json: string, configured: { readonly sourceSystem: SourceSystem; readonly connection: SourceConnectionReference }, capturedAt: IsoTimestamp): InboundAdapterEnvelope {
  const { sourceSystem, connection } = configured;
  if (sourceSystem.family !== 'CATALOG' || sourceSystem.provider.providerCode !== PURVIEW_PROVIDER ||
      sourceSystem.provider.resolution !== 'EXPLICIT' || connection.sourceSystemId !== sourceSystem.sourceSystemId || !connection.connectionId) throw new TypeError('PURVIEW_CONNECTION_MISMATCH');
  asIsoTimestamp(capturedAt);
  const entities = parsePurviewEntities(json);
  const runId = asAcquisitionRunId(`purview-run:${digest([connection.connectionId, entities])}`);
  const objects: InboundAdapterEnvelope['objects'][number][] = [], snapshots: InboundAdapterEnvelope['snapshots'][number][] = [],
    evidence: InboundAdapterEnvelope['evidence'][number][] = [], assertions: InboundAdapterEnvelope['assertions'][number][] = [],
    findings: InboundAdapterEnvelope['findings'][number][] = [], candidates: NormalizedObjectCandidate[] = [], technicalFacts: TechnicalFactTransport[] = [];
  for (const e of entities) {
    const identity = { connectionId: connection.connectionId, externalType: e.typeName, externalId: asExternalId(e.guid) };
    const hash = digest(e), suffix = digest([connection.connectionId, e.guid, hash]);
    const sourceVersion = e.lastModifiedTS ?? (e.version === undefined ? undefined : String(e.version));
    const snapshot = { snapshotId: asSourceSnapshotId(`purview-snapshot:${suffix}`), sourceObject: identity, observedAt: capturedAt,
      ...(sourceVersion === undefined ? {} : { sourceVersion }), contentHash: { algorithm: 'sha256', value: hash } };
    const evidenceId = asEvidenceId(`purview-evidence:${suffix}`);
    const candidateId = asNormalizedCandidateId(`purview-candidate:${suffix}`), findingId = asDiscoveryFindingId(`purview-finding:${suffix}`);
    const facts: { fact: TechnicalFact; path: string }[] = e.typeName === 'azure_sql_table'
      ? [{ fact: { objectKind: 'DATA_ASSET', field: 'structuralKind', value: 'TABLE' }, path: 'typeName' },
         { fact: { objectKind: 'DATA_ASSET', field: 'technicalName', value: e.attributes.name }, path: 'attributes.name' },
         { fact: { objectKind: 'DATA_ASSET', field: 'qualifiedTechnicalLocator', value: e.attributes.qualifiedName }, path: 'attributes.qualifiedName' },
         ...(e.attributes.description ? [{ fact: { objectKind: 'DATA_ASSET', field: 'technicalDescription', value: e.attributes.description } as const, path: 'attributes.description' }] : [])]
      : [{ fact: { objectKind: 'DATA_ELEMENT', field: 'technicalName', value: e.attributes.name }, path: 'attributes.name' },
         ...(e.attributes.data_type ? [{ fact: { objectKind: 'DATA_ELEMENT', field: 'dataType.nativeType', value: e.attributes.data_type } as const, path: 'attributes.data_type' }] : [])];
    const assertionIds = facts.map(({fact,path}) => {
      const assertionId = asSourceAssertionId(`purview-assertion:${digest([suffix, path])}`);
      assertions.push({ assertionId, sourceObject: identity, runId, snapshot, method: { code: PURVIEW_ADAPTER.name, version: PURVIEW_ADAPTER.version },
        trustState: 'IMPORTED', observedAt: capturedAt, recordedAt: capturedAt, sourceAttribute: { code: path, path }, evidenceIds: [evidenceId] });
      technicalFacts.push({ candidateId, fact, sourceAttribute: { code: path, path }, support: { assertionIds: [assertionId], evidenceIds: [evidenceId] } });
      return assertionId;
    });
    const parent = e.tableGuid ? candidates.find(c => c.sourceObject.externalId === e.tableGuid) : undefined;
    objects.push({ identity, observedAt: capturedAt, ...(sourceVersion === undefined ? {} : { sourceVersion }), ...(parent ? { parent: parent.sourceObject } : {}) });
    snapshots.push(snapshot);
    evidence.push({ evidenceId, handling: 'HASH_ONLY', hashes: [snapshot.contentHash], capturedAt,
      locations: [{ kind: 'SOURCE_OBJECT', locator: sanitizeEvidenceLocator(`purview://${connection.connectionId}/${e.guid}`) }] });
    const candidateKind = PURVIEW_TYPE_MAPPING[e.typeName].kind;
    findings.push({ findingId, findingNature: 'CANDIDATE', candidateKind, sourceObject: identity, assertionIds, evidenceIds: [evidenceId], confidence: 1,
      reviewStatus: 'UNREVIEWED', requiresReview: true, createsCanonicalObject: false, detectedAt: capturedAt });
    const base = { candidateId, findingId, sourceObject: identity, assertionIds, evidenceIds: [evidenceId], confidence: 1, requiresReconciliation: true as const };
    candidates.push(e.typeName === 'azure_sql_table'
      ? { ...base, candidateKind: 'DATA_ASSET', proposedIdentity: { sourceReference: e.attributes.qualifiedName, displayName: e.attributes.name } }
      : { ...base, candidateKind: 'DATA_ELEMENT', proposedIdentity: { parentDataAsset: { referenceKind: 'CANDIDATE', candidateKind: 'DATA_ASSET', candidateId: parent!.candidateId }, elementPath: e.attributes.name, displayName: e.attributes.name } });
  }
  return { contractVersion: '1.0', sourceSystem, connection,
    run: { runId, connection, mode: 'FULL', status: 'RUNNING', adapterName: PURVIEW_ADAPTER.name, adapterVersion: PURVIEW_ADAPTER.version, startedAt: capturedAt },
    objects, snapshots, assertions, evidence, findings, candidates, technicalFacts };
}
