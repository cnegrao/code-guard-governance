import 'server-only';
import { asCanonicalObjectId, asSemanticRepresentationId, asSourceAssertionId, asEvidenceId,
  createSemanticContentFingerprint, createSemanticRepresentation,
  type OrganisationId, type SemanticRepresentation, type CanonicalObjectKind } from '@council/canonical-contracts';
import type { CanonicalObjectRow, CanonicalRelationshipRow } from '@council/graphos/governed';
import { semanticSpaceIdentity, type SemanticSpaceIdentity } from '@council/scanner/semantic/similarity';
import { privilegedDb } from './persistence';

interface RepresentationRow {
  organisation_id: string; representation_id: string; subject_kind: string;
  subject_canonical_object_id: string; subject_canonical_object_kind: CanonicalObjectKind;
  projection_schema_version: string; content_fingerprint_algorithm: string;
  content_fingerprint_schema_version: string; content_fingerprint_value: string;
  embedding_provider_id: string; embedding_model_id: string; embedding_model_version: string;
  embedding_dimension: number; embedding: string | number[]; generated_at: string;
}
interface Tables {
  canonical_objects: CanonicalObjectRow;
  canonical_relationships: CanonicalRelationshipRow;
  semantic_representations: RepresentationRow;
  semantic_representation_assertions: { organisation_id: string; representation_id: string; assertion_id: string };
  semantic_representation_evidence: { organisation_id: string; representation_id: string; evidence_id: string };
}
const columns: { [K in keyof Tables]: readonly (keyof Tables[K] & string)[] } = {
  canonical_objects: ['organisation_id','canonical_object_id','kind','created_by_decision_id','created_at','revision'],
  canonical_relationships: ['organisation_id','relationship_id','relationship_state_id','relationship_type',
    'source_canonical_object_id','source_kind','target_canonical_object_id','target_kind','valid_from','valid_to',
    'recorded_at','revision','created_by_decision_id'],
  semantic_representations: ['organisation_id','representation_id','subject_kind','subject_canonical_object_id',
    'subject_canonical_object_kind','projection_schema_version','content_fingerprint_algorithm',
    'content_fingerprint_schema_version','content_fingerprint_value','embedding_provider_id','embedding_model_id',
    'embedding_model_version','embedding_dimension','embedding','generated_at'],
  semantic_representation_assertions: ['organisation_id','representation_id','assertion_id'],
  semantic_representation_evidence: ['organisation_id','representation_id','evidence_id'],
};
export function intelligenceReader(org: OrganisationId) {
  if (!org?.trim()) throw new TypeError('M12_TENANT_REQUIRED');
  async function read<K extends keyof Tables>(table: K,
    filter: Partial<Record<keyof Tables[K], string | number>> = {}): Promise<Tables[K][]> {
    const result: Tables[K][] = [];
    let expectedCount: number | undefined;
    // Fail closed on large reads. Never return a silently truncated exact population.
    for (let offset = 0; offset <= 10000; offset += 200) {
      let query = privilegedDb.from(table).select(columns[table].join(','), { count: 'exact' }).eq('organisation_id', org);
      for (const [key, value] of Object.entries(filter)) query = query.eq(key, value);
      for (const key of columns[table].slice(0, 3)) query = query.order(key);
      const { data, error, count } = await query.range(offset, offset + 199);
      if (error || !Array.isArray(data)) throw new Error('M12_READ_FAILED');
      if (count === null || !Number.isSafeInteger(count) || count < 0) throw new Error('M12_READ_COUNT_REQUIRED');
      if (count > 10000) throw new Error('M12_READ_LIMIT_EXCEEDED');
      if (expectedCount !== undefined && count !== expectedCount) throw new Error('M12_READ_CHANGED_DURING_PAGING');
      expectedCount = count;
      const page = data as unknown as Tables[K][];
      for (const row of page) {
        if (row.organisation_id !== org) throw new Error('M12_TENANT_MISMATCH');
        for (const [key, value] of Object.entries(filter)) {
          if ((row as unknown as Record<string, unknown>)[key] !== value) throw new Error('M12_READ_FILTER_MISMATCH');
        }
      }
      result.push(...page);
      if (result.length > 10000) throw new Error('M12_READ_LIMIT_EXCEEDED');
      if (result.length === count) return result;
      if (page.length !== 200 || result.length > count) throw new Error('M12_INCOMPLETE_READ');
    }
    throw new Error('M12_READ_LIMIT_EXCEEDED');
  }
  async function representation(row: RepresentationRow): Promise<SemanticRepresentation> {
    if (row.subject_kind !== 'CANONICAL_OBJECT') throw new Error('M12_CANONICAL_REPRESENTATION_REQUIRED');
    const [assertions, evidence] = await Promise.all([
      read('semantic_representation_assertions', { representation_id: row.representation_id }),
      read('semantic_representation_evidence', { representation_id: row.representation_id }),
    ]);
    const vector: unknown = typeof row.embedding === 'string' ? JSON.parse(row.embedding) : row.embedding;
    if (!Array.isArray(vector) || vector.some(v => typeof v !== 'number')) throw new Error('M12_INVALID_VECTOR');
    return createSemanticRepresentation({ organisationId: org, representationId: asSemanticRepresentationId(row.representation_id),
      subject: { subjectKind: 'CANONICAL_OBJECT', organisationId: org,
        canonicalObjectId: asCanonicalObjectId(row.subject_canonical_object_id), canonicalObjectKind: row.subject_canonical_object_kind },
      projectionSchemaVersion: row.projection_schema_version,
      contentFingerprint: createSemanticContentFingerprint({ algorithm: row.content_fingerprint_algorithm,
        schemaVersion: row.content_fingerprint_schema_version, value: row.content_fingerprint_value }),
      embeddingProvider: { providerId: row.embedding_provider_id, modelId: row.embedding_model_id,
        modelVersion: row.embedding_model_version, dimension: row.embedding_dimension },
      vector, generatedAt: row.generated_at,
      support: { assertionIds: assertions.map(r => asSourceAssertionId(r.assertion_id)),
        evidenceIds: evidence.map(r => asEvidenceId(r.evidence_id)) } });
  }
  return {
    async graphRows() {
      const [objects, relationships] = await Promise.all([read('canonical_objects'), read('canonical_relationships')]);
      return { objects, relationships };
    },
    async anchor(id: string) {
      const rows = await read('semantic_representations', { representation_id: id, subject_kind: 'CANONICAL_OBJECT' });
      if (rows.length !== 1) throw new Error('M12_EXACT_ANCHOR_REQUIRED');
      return representation(rows[0]);
    },
    async compatibleRepresentations(anchor: SemanticRepresentation) {
      if (anchor.organisationId !== org || anchor.subject.organisationId !== org
        || anchor.subject.subjectKind !== 'CANONICAL_OBJECT') throw new Error('M12_TENANT_OR_SUBJECT_MISMATCH');
      const space: SemanticSpaceIdentity = semanticSpaceIdentity(anchor);
      const rows = await read('semantic_representations', { subject_kind: 'CANONICAL_OBJECT',
        subject_canonical_object_kind: anchor.subject.canonicalObjectKind, projection_schema_version: space.projectionSchemaVersion,
        embedding_provider_id: space.providerId, embedding_model_id: space.modelId,
        embedding_model_version: space.modelVersion, embedding_dimension: space.dimension });
      const result: SemanticRepresentation[] = [];
      for (const row of rows) result.push(await representation(row));
      return result;
    },
  };
}
