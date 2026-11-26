import 'server-only';
import type { OrganisationId } from '@council/canonical-contracts';
import { privilegedDb } from './persistence';
import { combineSourceNames, sourceName } from './source-name';

interface Candidate {
  organisation_id: string; candidate_id: string; candidate_kind: string;
  finding_id: string; proposed_identity: unknown;
}
interface Mapping {
  organisation_id: string; mapping_id: string; canonical_object_id: string;
  canonical_object_kind: string; candidate_id: string; valid_from: string;
}

/** Bounded tenant-scoped scalar reads; no envelopes, evidence bodies or writes. */
async function rows<T extends { organisation_id: string }>(org: OrganisationId, table: string,
  columns: string, key: string, ids: readonly string[]): Promise<T[]> {
  const result: T[] = [];
  const unique = [...new Set(ids)];
  for (let start = 0; start < unique.length; start += 100) {
    for (let offset = 0; ; offset += 200) {
      const { data, error } = await privilegedDb.from(table).select(columns)
        .eq('organisation_id', org).in(key, unique.slice(start, start + 100))
        .order(table === 'discovery_candidates' ? 'candidate_id' : 'mapping_id').range(offset, offset + 199);
      if (error || !Array.isArray(data)) throw new Error('SOURCE_NAME_READ_FAILED');
      const page = data as unknown as T[];
      if (page.some(row => row.organisation_id !== org)) throw new Error('SOURCE_NAME_TENANT_MISMATCH');
      result.push(...page);
      if (result.length > 10000) throw new Error('SOURCE_NAME_READ_LIMIT_EXCEEDED');
      if (page.length < 200) break;
    }
  }
  return result;
}
const CANDIDATE_COLUMNS = 'organisation_id,candidate_id,candidate_kind,finding_id,proposed_identity';

export async function readFindingSourceNames(org: OrganisationId, findingIds: readonly string[]) {
  const candidates = await rows<Candidate>(org, 'discovery_candidates', CANDIDATE_COLUMNS, 'finding_id', findingIds);
  return Object.fromEntries(findingIds.map(id => [id,
    combineSourceNames(candidates.filter(c => c.finding_id === id).map(c => sourceName(c.candidate_kind, c.proposed_identity)))]));
}

export async function readCanonicalSourceNames(org: OrganisationId,
  objects: readonly { objectId: string; kind: string }[], asOf: string): Promise<Record<string, string | null>> {
  const mappings = await rows<Mapping>(org, 'canonical_normalized_object_mappings',
    'organisation_id,mapping_id,canonical_object_id,canonical_object_kind,candidate_id,valid_from',
    'canonical_object_id', objects.map(o => o.objectId));
  const effective = mappings.filter(m => Date.parse(m.valid_from) <= Date.parse(asOf));
  const candidates = await rows<Candidate>(org, 'discovery_candidates', CANDIDATE_COLUMNS, 'candidate_id', effective.map(m => m.candidate_id));
  const byId = new Map(candidates.map(c => [c.candidate_id, c]));
  return Object.fromEntries(objects.map(object => [object.objectId, combineSourceNames(effective
    .filter(m => m.canonical_object_id === object.objectId && m.canonical_object_kind === object.kind)
    .map(m => { const c = byId.get(m.candidate_id); return c?.candidate_kind === object.kind ? sourceName(c.candidate_kind, c.proposed_identity) : null; }))]));
}
