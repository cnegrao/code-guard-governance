import 'server-only';
import type { OrganisationId, PreCanonicalObjectReference } from '@council/canonical-contracts';
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
interface NamedCandidate extends Candidate {
  acquisition_run_id: string; source_connection_id: string; source_external_type: string; source_external_id: string;
  relationship_type_code: string | null; source_endpoint: PreCanonicalObjectReference | null; target_endpoint: PreCanonicalObjectReference | null;
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
        .order(table === 'discovery_candidates' ? 'candidate_id' : table === 'acquisition_runs' ? 'run_id' : 'mapping_id').range(offset, offset + 199);
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

const NAMED_CANDIDATE_COLUMNS = CANDIDATE_COLUMNS + ',acquisition_run_id,source_connection_id,source_external_type,source_external_id,relationship_type_code,source_endpoint,target_endpoint';

/** Queue labels use exact discovery references, never a canonical identity decision. */
export async function readRelationshipSourceLabels(org: OrganisationId, findingIds: readonly string[]) {
  const relationships = await rows<NamedCandidate>(org, 'discovery_candidates', NAMED_CANDIDATE_COLUMNS, 'finding_id', findingIds);
  const references = new Map<string, Promise<NamedCandidate[]>>();
  function resolve(ref: PreCanonicalObjectReference, runId: string): Promise<NamedCandidate[]> {
    const key = JSON.stringify([ref, runId]);
    let result = references.get(key);
    if (!result) {
      result = rows<NamedCandidate>(org, 'discovery_candidates', NAMED_CANDIDATE_COLUMNS,
        ref.referenceKind === 'CANDIDATE' ? 'candidate_id' : 'source_external_id',
        [ref.referenceKind === 'CANDIDATE' ? ref.candidateId : ref.sourceObject.externalId])
        .then(candidates => candidates.filter(c => c.candidate_kind === ref.candidateKind && (ref.referenceKind === 'CANDIDATE' ||
          (c.source_connection_id === ref.sourceObject.connectionId && c.source_external_type === ref.sourceObject.externalType && c.acquisition_run_id === runId))));
      references.set(key, result);
    }
    return result;
  }
  async function name(ref: PreCanonicalObjectReference | null, runId: string): Promise<string> {
    if (!ref) return 'UNKNOWN';
    const candidates = await resolve(ref, runId);
    const names = await Promise.all(candidates.map(async c => {
      // In a relationship row, identify a version by its declared logical agent.
      const parent = c.candidate_kind === 'AGENT_VERSION' ? (c.proposed_identity as { agent?: PreCanonicalObjectReference } | null)?.agent : undefined;
      return parent ? combineSourceNames((await resolve(parent, c.acquisition_run_id)).map(p => sourceName(p.candidate_kind, p.proposed_identity))) : sourceName(c.candidate_kind, c.proposed_identity);
    }));
    return combineSourceNames(names) ?? 'UNKNOWN';
  }
  const labels = await Promise.all(relationships.filter(c => c.candidate_kind === 'RELATIONSHIP').map(async c => {
    const [source, target] = await Promise.all([name(c.source_endpoint, c.acquisition_run_id), name(c.target_endpoint, c.acquisition_run_id)]);
    return { findingId: c.finding_id, label: `${source} → ${target} · ${c.relationship_type_code ?? 'UNKNOWN'}` };
  }));
  return Object.fromEntries(findingIds.map(id => [id, combineSourceNames(labels.filter(l => l.findingId === id).map(l => l.label))]));
}

/** Mapping associations are presentation context, not a thirteenth relationship type. */
export async function readCanonicalVersionParents(org: OrganisationId, versionIds: readonly string[], asOf: string) {
  const mappings = await rows<Mapping & { parent_canonical_object_id: string | null }>(org, 'canonical_normalized_object_mappings',
    'organisation_id,mapping_id,canonical_object_id,canonical_object_kind,candidate_id,valid_from,parent_canonical_object_id', 'canonical_object_id', versionIds);
  return Object.fromEntries(versionIds.map(id => {
    const associated = mappings.filter(m => m.canonical_object_id === id && m.canonical_object_kind === 'AGENT_VERSION');
    const parents = new Set(associated.map(m => m.parent_canonical_object_id));
    return [id, parents.size === 1 && associated.some(m => Date.parse(m.valid_from) <= Date.parse(asOf)) ? associated[0].parent_canonical_object_id : null];
  }));
}

/** Preserve all source commits when several source identities map to one canonical version. */
export async function readCanonicalVersionCommits(org: OrganisationId, versionIds: readonly string[], asOf: string) {
  const mappings = await rows<Mapping>(org, 'canonical_normalized_object_mappings',
    'organisation_id,mapping_id,canonical_object_id,canonical_object_kind,candidate_id,valid_from', 'canonical_object_id', versionIds);
  const effective = mappings.filter(m => m.canonical_object_kind === 'AGENT_VERSION' && Date.parse(m.valid_from) <= Date.parse(asOf));
  const candidates = await rows<Candidate & { acquisition_run_id: string }>(org, 'discovery_candidates', CANDIDATE_COLUMNS + ',acquisition_run_id', 'candidate_id', effective.map(m => m.candidate_id));
  const runs = await rows<{ organisation_id: string; run_id: string; source_version: string | null }>(org, 'acquisition_runs',
    'organisation_id,run_id,source_version', 'run_id', candidates.map(c => c.acquisition_run_id));
  return Object.fromEntries(versionIds.map(id => [id, [...new Set(effective.filter(m => m.canonical_object_id === id).flatMap(m => {
    const candidate = candidates.find(c => c.candidate_id === m.candidate_id && c.candidate_kind === 'AGENT_VERSION');
    const commit = runs.find(r => r.run_id === candidate?.acquisition_run_id)?.source_version;
    return commit ? [commit] : [];
  }))].sort()]));
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
