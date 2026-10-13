import type { L15MachineHypothesisCommand, L15MachineSignalCommand, L15Subject } from '@council/canonical-contracts';
import { canonicalObjectKit, lit, named, technicalKit } from './m16-governed-write-fixtures';
import { lastLine, type Actor, type L14Cluster } from './m16-l14-fixtures';
import { m15RuntimeKit } from './m16-runtime-kit';

/**
 * M17-S1 fixtures on the M17S1-horizon L14 cluster (full canonical chain + M16 + M17-S0 + M17-S1). Owner access only inserts
 * administrator support rows (organisations, canonical objects / relationships, discovery evidence, source assertions,
 * technical / execution / lineage / M15 rows) and runs rolled-back probes; every L15 write goes through the real S1 RPCs:
 * machine intake as a real LOGIN holding only govia_l15_machine_intake_caller, member intake / reads as service_role with a
 * verified principal (M16-S0 helper).
 */
export const MACHINE = 'l15_detector';
export const UNBOUND = 'l15_unbound_login';
export const L15_TABLES = ['l15_risk_signals', 'l15_risk_hypotheses', 'l15_support_links'] as const;
/** Every governance envelope / M16 history / head table an admission must never touch. */
export const GOVERNANCE_TABLES = ['l14_authorization_decisions', 'l14_authorization_decision_roles', 'l14_authorization_decision_rules',
  'l14_proposals', 'l14_governance_decisions', 'l14_command_results', 'l14_fact_states', 'l14_registry_states', 'l14_support_links'] as const;

const text = (v: string | null | undefined) => (v == null ? 'null::text' : lit(v));
const uuid = (v: string | null | undefined) => (v == null ? 'null::uuid' : `${lit(v)}::uuid`);
const ts = (v: string | null | undefined) => (v == null ? 'null::timestamptz' : `${lit(v)}::timestamptz`);
const num = (v: number | null | undefined) => (v == null ? 'null::numeric' : `${v}::numeric`);
const textArray = (vs: readonly string[] | null) => (vs === null ? 'null::text[]' : vs.length ? `array[${vs.map(lit).join(',')}]::text[]` : `'{}'::text[]`);
const uuidArray = (vs: readonly string[] | null) => (vs === null ? 'null::uuid[]' : vs.length ? `array[${vs.map(v => `${lit(v)}::uuid`).join(',')}]` : `'{}'::uuid[]`);

/** Raw subject operands (deliberately loose so adversarial shapes can be sent). */
export interface SubjectOps { mode: string; kind?: string | null; objectId?: string | null; relId?: string | null; stateId?: string | null; reason?: string | null }
export const objectSubject = (kind: string, objectId: string): SubjectOps => ({ mode: 'CANONICAL_OBJECT', kind, objectId });
export const relSubject = (relId: string, stateId: string): SubjectOps => ({ mode: 'RELATIONSHIP_STATE', relId, stateId });
export const unresolved = (reason = 'NO_EXACT_MAPPING'): SubjectOps => ({ mode: 'UNRESOLVED', reason });
export function subjectOps(s: L15Subject): SubjectOps {
  if (s.mode === 'CANONICAL_OBJECT') return objectSubject(s.kind, s.canonicalObjectId);
  if (s.mode === 'RELATIONSHIP_STATE') return relSubject(s.relationshipId, s.relationshipStateId);
  return unresolved(s.reason);
}
const subjectArgs = (s: SubjectOps, withReason: boolean) => ({
  p_subject_mode: text(s.mode), p_subject_canonical_kind: text(s.kind), p_subject_canonical_object_id: text(s.objectId),
  p_subject_relationship_id: text(s.relId), p_subject_relationship_state_id: text(s.stateId),
  ...(withReason ? { p_unresolved_reason: text(s.reason) } : {}),
});

export interface SignalOps {
  org: string; key: string; kind: string; source: string; subject: SubjectOps; trust?: string | null;
  methodId?: string | null; methodVersion?: string | null; hintSeverity?: string | null; hintConfidence?: number | null;
  observedAt?: string | null; gapFamily?: string | null; gapRole?: string | null; gapSemantic?: string | null; gapControl?: string | null;
  tags: readonly string[] | null; ids: readonly string[] | null;
}
export function signalOps(c: L15MachineSignalCommand): SignalOps {
  return { org: c.organisationId, key: c.intakeKey, kind: c.signalKind, source: c.sourceClass, subject: subjectOps(c.subject),
    trust: c.trustState, methodId: c.methodId, methodVersion: c.methodVersion, hintSeverity: c.hintSeverity,
    hintConfidence: c.hintConfidence, observedAt: c.observedAt,
    gapFamily: c.gap?.family ?? null,
    gapRole: c.gap?.family === 'RESPONSIBILITY_ASSIGNMENT' ? c.gap.responsibilityRole : null,
    gapSemantic: c.gap?.family === 'BUSINESS_CONTEXT_ASSIGNMENT' ? c.gap.semanticKind : null,
    gapControl: c.gap?.family === 'CONTROL_ASSESSMENT' ? c.gap.controlDefinitionId : null,
    tags: c.support.map(s => s.tag), ids: c.support.map(s => s.targetId) };
}
export const machineSignalSql = (o: SignalOps) => `select to_json(r) from gov_repo.l15_admit_machine_signal_v1(${named({
  p_organisation_id: uuid(o.org), p_intake_key: text(o.key), p_signal_kind: text(o.kind), p_source_class: text(o.source),
  ...subjectArgs(o.subject, true), p_trust_state: text(o.trust), p_method_id: text(o.methodId), p_method_version: text(o.methodVersion),
  p_hint_severity: text(o.hintSeverity), p_hint_confidence: num(o.hintConfidence), p_observed_at: ts(o.observedAt),
  p_gap_fact_family: text(o.gapFamily), p_gap_responsibility_role: text(o.gapRole), p_gap_semantic_kind: text(o.gapSemantic),
  p_gap_control_definition_id: uuid(o.gapControl), p_support_tags: textArray(o.tags), p_support_target_ids: textArray(o.ids) })}) r;`;

export interface HypothesisOps {
  org: string; key: string; generator: string; subject: SubjectOps; methodId?: string | null; methodVersion?: string | null;
  modelProvider?: string | null; modelId?: string | null; promptVersion?: string | null; traversal?: string | null;
  representation?: string | null; hintConfidence?: number | null; signals: readonly string[] | null;
}
export function hypothesisOps(c: L15MachineHypothesisCommand): HypothesisOps {
  return { org: c.organisationId, key: c.intakeKey, generator: c.generatorKind, subject: subjectOps(c.subject), methodId: c.methodId,
    methodVersion: c.methodVersion, modelProvider: c.llm?.modelProvider ?? null, modelId: c.llm?.modelId ?? null,
    promptVersion: c.llm?.promptTemplateVersion ?? null, traversal: c.traversalPolicyVersion, representation: c.representationVersion,
    hintConfidence: c.hintConfidence, signals: c.citedSignalIds };
}
export const machineHypothesisSql = (o: HypothesisOps) => `select to_json(r) from gov_repo.l15_admit_machine_hypothesis_v1(${named({
  p_organisation_id: uuid(o.org), p_intake_key: text(o.key), p_generator_kind: text(o.generator), ...subjectArgs(o.subject, false),
  p_method_id: text(o.methodId), p_method_version: text(o.methodVersion), p_model_provider: text(o.modelProvider),
  p_model_id: text(o.modelId), p_prompt_template_version: text(o.promptVersion), p_traversal_policy_version: text(o.traversal),
  p_representation_version: text(o.representation), p_hint_confidence: num(o.hintConfidence), p_cited_signal_ids: uuidArray(o.signals) })}) r;`;

export async function m17s1Kit(c: L14Cluster) {
  const { owner, bootstrapSql } = c;
  await bootstrapSql(`create role ${MACHINE} login nosuperuser nobypassrls inherit;
    grant govia_l15_machine_intake_caller to ${MACHINE};
    create role ${UNBOUND} login nosuperuser nobypassrls inherit;`);
  const as = (role: string) => (query: string) => c.sql(query, role as never);
  const machine = as(MACHINE);
  const one = async (query: string) => lastLine(await owner(query));
  /** Whole output (json_agg spreads its elements over several lines). */
  const json = async (query: string, role: (q: string) => Promise<string> = owner) => JSON.parse((await role(query)).trim());
  const run = async (role: (q: string) => Promise<string>, query: string) => JSON.parse(lastLine(await role(query))) as Record<string, any>;

  const humanSignalSql = (actor: Actor, key: string, subject: SubjectOps, tags: readonly string[] | null = [], ids: readonly string[] | null = [],
    observedAt: string | null = null, org?: string) => `select to_json(r) from gov_repo.l15_admit_human_signal_v1(${named({
    ...c.principal(actor, org ? { org } : {}), p_intake_key: text(key), ...subjectArgs(subject, true), p_observed_at: ts(observedAt),
    p_support_tags: textArray(tags), p_support_target_ids: textArray(ids) })}) r;`;
  const humanHypothesisSql = (actor: Actor, key: string, subject: SubjectOps, signals: readonly string[] | null, hintConfidence: number | null = null) =>
    `select to_json(r) from gov_repo.l15_admit_human_hypothesis_v1(${named({
      ...c.principal(actor), p_intake_key: text(key), ...subjectArgs(subject, false), p_hint_confidence: num(hintConfidence),
      p_cited_signal_ids: uuidArray(signals) })}) r;`;
  const readSignalsSql = (actor: Actor, subject: SubjectOps) => `select coalesce(json_agg(r order by r.recorded_at, r.signal_id), '[]')
    from gov_repo.l15_read_signals_v1(${named({ ...c.principal(actor), ...subjectArgs(subject, false) })}) r;`;
  const dispositionsSql = (actor: Actor, subject: SubjectOps) => `select coalesce(json_agg(r order by r.recorded_at, r.hypothesis_id), '[]')
    from gov_repo.l15_read_hypothesis_dispositions_v1(${named({ ...c.principal(actor), ...subjectArgs(subject, false) })}) r;`;

  /** Row counts of the governance envelope + every *_heads table (whole database). */
  const governanceCounts = async () => json(`select json_build_object(${GOVERNANCE_TABLES.map(t => `'${t}',(select count(*) from gov_repo.${t})`).join(',')},
    'heads', (select coalesce(sum((xpath('/row/c/text()', query_to_xml(format('select count(*) as c from %I.%I', schemaname, tablename), false, true, '')))[1]::text::bigint), 0)
              from pg_tables where schemaname = 'gov_repo' and tablename like '%\\_heads' escape '\\'))`);
  const l15Counts = async () => json(`select json_build_object(${L15_TABLES.map(t => `'${t}',(select count(*) from gov_repo.${t})`).join(',')})`);

  let n = 0;
  /** A canonical object (+ its own source assertion `assertion-<label>`). */
  async function object(org: string, kind: string, label = `o${++n}`) {
    const kit = canonicalObjectKit(org, `s1-${label}`, kind, { proposedIdentity: { reference: label }, identity: `s1-${label}` });
    await owner(kit.sql);
    return { id: kit.objectId, assertion: `assertion-s1-${label}` };
  }
  async function relationship(org: string, type: string, source: { id: string; kind: string }, target: { id: string; kind: string }, label = `r${++n}`) {
    const relationshipId = `canonical-relationship:s1-${label}`, relationshipStateId = `${relationshipId}:initial`, decision = `decision-rel-s1-${label}`;
    await owner(`insert into gov_repo.reconciliation_decisions(decision_id,organisation_id,family,outcome,candidate_kind,authority_kind,authority_reference,
        reason_code,decided_at,relationship_candidate_id,relationship_type_code,contract_version,envelope,envelope_hash)
      values(${lit(decision)},'${org}','RELATIONSHIP','CREATE_NEW','RELATIONSHIP','HUMAN','fixture-admin','MANUAL_APPROVAL',now(),
        ${lit(`candidate:rel-s1-${label}`)},${lit(type)},'1.1','{}',repeat('a',64));
      insert into gov_repo.canonical_relationships(relationship_id,organisation_id,relationship_state_id,relationship_type,source_canonical_object_id,
        source_kind,target_canonical_object_id,target_kind,valid_from,recorded_at,created_by_decision_id)
      values(${lit(relationshipId)},'${org}',${lit(relationshipStateId)},${lit(type)},${lit(source.id)},${lit(source.kind)},
        ${lit(target.id)},${lit(target.kind)},now(),now(),${lit(decision)});`);
    return { relationshipId, relationshipStateId };
  }
  const evidence = (org: string, label = `ev${++n}`) => c.evidence(org, `evidence:s1-${label}`);
  /** An ACCEPTED technical field state (technical decision + state as administrator support rows). */
  async function technicalState(org: string, label = `t${++n}`) {
    const kit = technicalKit(org, `s1-${label}`);
    await owner(kit.sql);
    const d = kit.decision(`tdec-s1-${label}`, 'fixture-admin');
    await owner(`insert into gov_repo.technical_field_decisions(organisation_id,decision_id,canonical_object_id,object_kind,field_key,proposal_id,
        expected_source_observation_id,expected_source_snapshot_id,outcome,actor_kind,actor_reference,decided_at)
      values('${org}',${lit(d.decisionId)},${lit(kit.objectId)},'DATA_ASSET','technicalName',${lit(d.proposalId)},${lit(d.expectedSourceObservationId)},
        ${lit(d.expectedSourceSnapshotId)},'ACCEPT_PROPOSED','HUMAN','fixture-admin',now());
      insert into gov_repo.technical_field_states(organisation_id,state_id,canonical_object_id,object_kind,field_key,proposal_id,decision_id,recorded_at)
      values('${org}',${lit(`tstate-s1-${label}`)},${lit(kit.objectId)},'DATA_ASSET','technicalName',${lit(d.proposalId)},${lit(d.decisionId)},now());`);
    return `tstate-s1-${label}`;
  }

  /** Real M15 runtime kit (fixed tenants): one admitted L12 observation, the PRINCIPAL execution state, and M15 rows of each outcome. */
  async function runtime() {
    const m15 = await m15RuntimeKit(owner);
    const admitted = JSON.parse(lastLine(await c.svc(m15.admissionSql)));
    const observationId: string = admitted.observation.observation_id;
    const org = m15.runtimeOrg;
    const result = async (outcome: string, label: string) => {
      const id = `cross-signal-comparison:s1-${label}`;
      const evidenced = outcome !== 'INSUFFICIENT_EVIDENCE';
      await owner(`insert into gov_repo.cross_signal_comparison_results(organisation_id,comparison_id,subject_object_id,dimension,pairing_mode,method_code,
          method_version,left_kind,left_execution_field_state_id,left_execution_field_state_decision_id,left_execution_field_state_snapshot_id,
          right_observation_id,right_connection_id,left_temporal_basis,right_temporal_basis,outcome,reason,evaluated_at)
        values('${org}',${lit(id)},'m142-version','PRINCIPAL_IDENTITY','DESIGN_TIME_VS_RUNTIME','CROSS_SIGNAL_PRINCIPAL_DESIGN_RUNTIME_V1','1.0.0',
          ${evidenced ? `'EXECUTION_FIELD_STATE','m15-principal-state','m15-principal-decision','m13-snapshot','${observationId}',${lit(m15.connection)}`
                      : 'null,null,null,null,null,null'},
          'NOT_AVAILABLE','RUNTIME_EVENT_TIME',${lit(outcome)},${evidenced ? 'null' : `'CLOCK_UNCERTAIN'`},now())`);
      return id;
    };
    const consistent = await result('CONSISTENT', 'consistent');
    const conflict = await result('CONFLICT_CANDIDATE', 'conflict');
    const insufficient = await result('INSUFFICIENT_EVIDENCE', 'insufficient');
    // A lineage observation over the seeded discovery candidates / finding.
    await owner(`insert into gov_repo.lineage_candidate_observations(organisation_id,candidate_id,observation_finding_id,source_candidate_id,target_candidate_id)
      values('${org}','candidate:m142-model','finding-m142-model','candidate:agent-version:${'a'.repeat(32)}','candidate:m142-model')`);
    return { org, foreign: m15.runtimeForeign, observationId, executionStateId: 'm15-principal-state', consistent, conflict, insufficient,
      lineageFindingId: 'finding-m142-model', assertionId: 'assertion-m142-version', agentVersion: 'm142-version' };
  }
  return { machine, as, one, json, run, humanSignalSql, humanHypothesisSql, readSignalsSql, dispositionsSql, governanceCounts, l15Counts,
    object, relationship, evidence, technicalState, runtime };
}
export type M17S1Kit = Awaited<ReturnType<typeof m17s1Kit>>;
