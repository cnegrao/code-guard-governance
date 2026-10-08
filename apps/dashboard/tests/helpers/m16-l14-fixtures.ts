import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { L14AuthorityPolicyRule, L14GovernanceOutcome, L14Support } from '@council/canonical-contracts';
import {
  admitAuthorityPolicyVersionFingerprint, authorityPolicyReasonCode, decideProposalFingerprint, submitProposalFingerprint,
  type L14AuthorityPolicyProposalContent,
} from '@council/governance-review';
import {
  contractRawRpcRevocationMigration, credentialMigration, disposableM16Postgres, eligibilityMigration, epochBindingMigration,
  governedWriteWrapperMigration, l14AuthorityPolicyMigration, l14AuthorityPolicySuccessorMigration, l14NoResurrectionMigration, objectMaterializationCompatMigration,
  l14RegistryFrameworkMigration, l14GovernancePartyMigration, l14GovernancePartyPendingCancelMigration, l14PolicyStoreHardeningMigration,
  definerCapabilitySurfaceMigration, runtimeExecutionClosureMigration, s0ExecutionContextClosureMigration, postR3PrimaryChainMigrations,
  l14PolicyAdmissionMigration, l14PolicyVersionValidationMigration, l14DomainRegistryMigration, l14ControlDefinitionRegistryMigration,
  l14ResponsibilityAssignmentMigration,
} from './disposable-m16-postgres';
import { lit, named } from './m16-governed-write-fixtures';

/**
 * M16-S1A.1 disposable PG17 fixtures. Administrator-only support rows (organisations, users,
 * roles, canonical objects, evidence) are inserted directly as the owner, exactly like the S0
 * fixtures; every L14 write under test goes through the real RPC as service_role, with the
 * caller fingerprint computed by the production TypeScript mirror (@council/governance-review).
 */
export const lastLine = (out: string) => out.replace(/\r/g, '').trim().split('\n').pop() as string;
export const L14_TABLES = [
  'l14_authority_policies', 'l14_authority_policy_versions', 'l14_authority_policy_rules', 'l14_proposals',
  'l14_authority_policy_version_proposals', 'l14_authorization_decisions', 'l14_authorization_decision_roles',
  'l14_authorization_decision_rules', 'l14_governance_decisions', 'l14_authority_policy_states',
  'l14_authority_policy_heads', 'l14_command_results', 'l14_support_links',
] as const;
export const NONE: L14Support = Object.freeze({ status: 'NONE', evidenceIds: [] });

export interface Actor { readonly id: string; readonly org: string; readonly epoch: string }
export interface SessionOverride { readonly iat?: string; readonly exp?: string; readonly epoch?: string; readonly org?: string }

export function rule(roleId: string, permission: L14AuthorityPolicyRule['permission'],
  requestedAction: L14AuthorityPolicyRule['requestedAction'], overrides: Partial<L14AuthorityPolicyRule> = {}): L14AuthorityPolicyRule {
  return {
    roleId, permission, requestedAction, sourceClass: 'LOCAL_HUMAN', sourceDisposition: 'AUTHORITATIVE',
    scopeTag: 'ALL_ALLOWED_TARGETS', scopeCanonicalKind: null, scopeCanonicalObjectId: null, scopeRelationshipType: null,
    scopeRelationshipId: null, scopeRelationshipStateId: null, allowSelfValidation: false, allowFutureDating: false,
    allowBackdating: false, ...overrides,
  };
}

const rulesSql = (rules: readonly L14AuthorityPolicyRule[]) => `${lit(JSON.stringify(rules))}::jsonb`;
const idsSql = (ids: readonly string[]) => (ids.length ? `array[${ids.map(lit).join(',')}]::text[]` : `'{}'::text[]`);
const uuidOrNull = (value: string | null) => (value === null ? 'null::uuid' : `'${value}'::uuid`);

/**
 * Migration horizon of the disposable L14 cluster. 'S1A' (the default) ends at S1A.2R1 exactly, so
 * the audited S1A suites keep asserting the exact S1A catalog; 'S1B0' ends at the S1B.0 registry
 * framework exactly (its suites keep their exact S1B.0 assertions); 'S1B1' additionally applies the
 * S1B.1 GOVERNANCE_PARTY registry exactly; 'S1B1R1' additionally applies the S1B.1R1 pending-cancellation
 * corrective (the live Party behaviour); 'S1B2' is S1B1R1 on a chain that ALSO carries the existing
 * policy-store prerequisites (policyStorePrerequisites, merged chronologically around the broad-grant
 * migration) plus the S1B.2 policy-store hardening. A suite may also start earlier and apply later
 * migrations itself; `policyStore: true` gives an older horizon the policy-store prerequisites (e.g.
 * S1B1R1 + prerequisites, to seed legacy policy rows before applying S1B.2 itself). 'S1B3' is the FULL canonical
 * primary chain (fullPrimaryChain) + S1B.2R1/R2/R3 + the post-R3 discovery slices + S1B.3 policy content admission,
 * exactly the production order; `stopBefore` ends a horizon before a named migration (S1B.3 suites seed legacy policy
 * rows / probe the preflight before applying it themselves). 'S1B4' is 'S1B3' + the S1B.4 POLICY_VERSION governance
 * validation migration; the S1B3 horizon stays exactly the merged S1B.3 catalog for its historical suites. 'S1B5' is
 * 'S1B4' + the S1B.5 BUSINESS_DOMAIN / INFORMATION_DOMAIN registries; the S1B4 horizon stays exactly the merged S1B.4 catalog.
 * 'S1B6' is 'S1B5' + the S1B.6 CONTROL_DEFINITION registry; the S1B5 horizon stays exactly the merged S1B.5 catalog.
 * 'S1C1' is 'S1B6' + the S1C.1 RESPONSIBILITY_ASSIGNMENT fact family; the S1B6 horizon stays exactly the merged S1B.6 catalog.
 */
export type L14Horizon = 'S1A' | 'S1B0' | 'S1B1' | 'S1B1R1' | 'S1B2' | 'S1B3' | 'S1B4' | 'S1B5' | 'S1B6' | 'S1C1';
export const L14_HORIZON_MIGRATIONS: Record<L14Horizon, readonly string[]> = {
  S1C1: [definerCapabilitySurfaceMigration, runtimeExecutionClosureMigration, s0ExecutionContextClosureMigration,
    ...postR3PrimaryChainMigrations, l14PolicyAdmissionMigration, l14PolicyVersionValidationMigration, l14DomainRegistryMigration,
    l14ControlDefinitionRegistryMigration, l14ResponsibilityAssignmentMigration],
  S1B6: [definerCapabilitySurfaceMigration, runtimeExecutionClosureMigration, s0ExecutionContextClosureMigration,
    ...postR3PrimaryChainMigrations, l14PolicyAdmissionMigration, l14PolicyVersionValidationMigration, l14DomainRegistryMigration,
    l14ControlDefinitionRegistryMigration],
  S1B5: [definerCapabilitySurfaceMigration, runtimeExecutionClosureMigration, s0ExecutionContextClosureMigration,
    ...postR3PrimaryChainMigrations, l14PolicyAdmissionMigration, l14PolicyVersionValidationMigration, l14DomainRegistryMigration],
  S1B4: [definerCapabilitySurfaceMigration, runtimeExecutionClosureMigration, s0ExecutionContextClosureMigration,
    ...postR3PrimaryChainMigrations, l14PolicyAdmissionMigration, l14PolicyVersionValidationMigration],
  S1B3: [definerCapabilitySurfaceMigration, runtimeExecutionClosureMigration, s0ExecutionContextClosureMigration,
    ...postR3PrimaryChainMigrations, l14PolicyAdmissionMigration],
  S1A: [credentialMigration, eligibilityMigration, epochBindingMigration, objectMaterializationCompatMigration,
    governedWriteWrapperMigration, contractRawRpcRevocationMigration, l14AuthorityPolicyMigration,
    l14AuthorityPolicySuccessorMigration, l14NoResurrectionMigration],
  S1B0: [credentialMigration, eligibilityMigration, epochBindingMigration, objectMaterializationCompatMigration,
    governedWriteWrapperMigration, contractRawRpcRevocationMigration, l14AuthorityPolicyMigration,
    l14AuthorityPolicySuccessorMigration, l14NoResurrectionMigration, l14RegistryFrameworkMigration],
  S1B1: [credentialMigration, eligibilityMigration, epochBindingMigration, objectMaterializationCompatMigration,
    governedWriteWrapperMigration, contractRawRpcRevocationMigration, l14AuthorityPolicyMigration,
    l14AuthorityPolicySuccessorMigration, l14NoResurrectionMigration, l14RegistryFrameworkMigration,
    l14GovernancePartyMigration],
  S1B1R1: [credentialMigration, eligibilityMigration, epochBindingMigration, objectMaterializationCompatMigration,
    governedWriteWrapperMigration, contractRawRpcRevocationMigration, l14AuthorityPolicyMigration,
    l14AuthorityPolicySuccessorMigration, l14NoResurrectionMigration, l14RegistryFrameworkMigration,
    l14GovernancePartyMigration, l14GovernancePartyPendingCancelMigration],
  S1B2: [credentialMigration, eligibilityMigration, epochBindingMigration, objectMaterializationCompatMigration,
    governedWriteWrapperMigration, contractRawRpcRevocationMigration, l14AuthorityPolicyMigration,
    l14AuthorityPolicySuccessorMigration, l14NoResurrectionMigration, l14RegistryFrameworkMigration,
    l14GovernancePartyMigration, l14GovernancePartyPendingCancelMigration, l14PolicyStoreHardeningMigration],
};

export async function l14Cluster(diagnostic: (message: string) => void,
  options: { readonly horizon?: L14Horizon; readonly policyStore?: boolean; readonly stopBefore?: string } = {}) {
  const policyStorePrerequisites = options.horizon === 'S1B2' || options.policyStore === true;
  const pg = await disposableM16Postgres(diagnostic, options.horizon === 'S1B3' || options.horizon === 'S1B4' || options.horizon === 'S1B5' || options.horizon === 'S1B6'
    || options.horizon === 'S1C1'
    ? { fullPrimaryChain: true } : { governanceWriteChain: true, policyStorePrerequisites });
  try {
    const chain = L14_HORIZON_MIGRATIONS[options.horizon ?? 'S1A'];
    assert.ok(options.stopBefore === undefined || chain.includes(options.stopBefore), 'stopBefore names a horizon migration');
    for (const migration of chain) {
      if (migration === options.stopBefore) break;
      await pg.migrate(migration);
    }
  } catch (error) { pg.stop(); throw error; }
  const { sql, bootstrapSql } = pg;
  const owner = (query: string) => sql(query, 'postgres');
  const svc = (query: string) => sql(query, 'service_role');
  const adminRole = await owner(`select role_id from gov_repo.governance_roles where role_code='GOVERNANCE_ADMIN' and is_system_role`);
  const memberRole = randomUUID();
  await owner(`insert into gov_repo.governance_roles(role_id,role_code,role_name,role_tier,is_system_role)
    values('${memberRole}','L14_MEMBER','Member','organisation',false)`);

  let counter = 0;
  async function newOrg(active = true) {
    const id = randomUUID();
    const n = ++counter;
    await owner(`insert into gov_repo.organisations(organisation_id,org_code,legal_name,display_name,country_code,is_active)
      values('${id}','L14_${n}','L14 ${n}','L14 ${n}','PT',${active})`);
    return id;
  }
  const trigger = 'trg_governance_users_credential_epoch_v1';
  async function mkUser(org: string, roleIds: readonly string[]): Promise<Actor> {
    const id = randomUUID();
    const roles = roleIds.length ? `array[${roleIds.map(r => `'${r}'`).join(',')}]::uuid[]` : `'{}'::uuid[]`;
    await owner(`insert into gov_repo.governance_users(user_id,email,full_name,organisation_id,status,role_ids)
      values('${id}','${id}@example.invalid','Fixture','${org}','active',${roles})`);
    await bootstrapSql(`begin; alter table gov_repo.governance_users disable trigger ${trigger};
      update gov_repo.governance_users set password_changed_at=clock_timestamp() - interval '12 hours' where user_id='${id}';
      alter table gov_repo.governance_users enable always trigger ${trigger}; commit;`);
    const epoch = await owner(`select password_changed_at::text from gov_repo.governance_users where user_id='${id}'`);
    return { id, org, epoch };
  }
  const principal = (actor: Actor, o: SessionOverride = {}) => ({
    p_verified_organisation_id: `'${o.org ?? actor.org}'::uuid`,
    p_verified_actor_user_id: `'${actor.id}'::uuid`,
    p_verified_session_iat: o.iat ?? '(floor(extract(epoch from clock_timestamp()))::bigint - 10)',
    p_verified_session_exp: o.exp ?? '(floor(extract(epoch from clock_timestamp()))::bigint + 3600)',
    p_verified_credential_epoch: o.epoch ?? `'${actor.epoch}'::timestamptz`,
  });

  interface AdmitInput {
    commandId: string; rules: readonly L14AuthorityPolicyRule[]; support?: L14Support;
    expected?: { authorityPolicyId: string; latestVersionId: string } | null; sourceClass?: 'SYSTEM_SEED' | 'LOCAL_HUMAN' | 'SOURCE_CONNECTION';
    fingerprint?: string; session?: SessionOverride; rawRules?: string;
  }
  function admitSql(actor: Actor, input: AdmitInput) {
    const support = input.support ?? NONE, expected = input.expected ?? null, sourceClass = input.sourceClass ?? 'LOCAL_HUMAN';
    const fingerprint = input.fingerprint ?? admitAuthorityPolicyVersionFingerprint({
      organisationId: input.session?.org ?? actor.org, actorUserId: actor.id, expected, sourceClass, rules: input.rules, support });
    return `select to_json(r) from gov_repo.l14_admit_authority_policy_version_v1(${named({
      ...principal(actor, input.session), p_command_id: lit(input.commandId),
      p_expected_authority_policy_id: uuidOrNull(expected?.authorityPolicyId ?? null),
      p_expected_latest_version_id: uuidOrNull(expected?.latestVersionId ?? null),
      p_source_class: lit(sourceClass), p_rules: input.rawRules ?? rulesSql(input.rules),
      p_support_status: lit(support.status), p_support_evidence_ids: idsSql(support.evidenceIds),
      p_caller_fingerprint: lit(fingerprint) })}) r;`;
  }
  interface SubmitInput {
    commandId: string; proposal: L14AuthorityPolicyProposalContent; prior?: string | null; support?: L14Support;
    fingerprint?: string; session?: SessionOverride;
  }
  function submitSql(actor: Actor, input: SubmitInput) {
    const support = input.support ?? NONE, prior = input.prior ?? null;
    const fingerprint = input.fingerprint ?? submitProposalFingerprint({
      organisationId: input.session?.org ?? actor.org, actorUserId: actor.id, proposal: input.proposal, priorProposalId: prior, support });
    const p = input.proposal;
    return `select to_json(r) from gov_repo.l14_submit_proposal_v1(${named({
      ...principal(actor, input.session), p_command_id: lit(input.commandId), p_subject_kind: lit(p.subjectKind),
      p_intent: lit(p.intent), p_source_class: lit(p.sourceClass), p_authority_policy_id: uuidOrNull(p.authorityPolicyId),
      p_version_id: uuidOrNull(p.versionId), p_content_hash: lit(p.contentHash),
      p_requested_effective_from: p.requestedEffectiveFrom === null ? 'null::timestamptz' : `${lit(p.requestedEffectiveFrom)}::timestamptz`,
      p_target_state_id: uuidOrNull(p.targetStateId), p_prior_proposal_id: uuidOrNull(prior),
      p_support_status: lit(support.status), p_support_evidence_ids: idsSql(support.evidenceIds),
      p_caller_fingerprint: lit(fingerprint) })}) r;`;
  }
  interface DecideInput {
    commandId: string; proposalId: string; proposal: L14AuthorityPolicyProposalContent; outcome?: L14GovernanceOutcome;
    expected?: string | null; support?: L14Support; fingerprint?: string; session?: SessionOverride;
  }
  function decideSql(actor: Actor, input: DecideInput) {
    const support = input.support ?? NONE, outcome = input.outcome ?? 'VALIDATE', expected = input.expected ?? null;
    const fingerprint = input.fingerprint ?? decideProposalFingerprint({
      organisationId: input.session?.org ?? actor.org, actorUserId: actor.id, outcome, proposalId: input.proposalId,
      proposal: input.proposal, expectedCurrentStateId: expected, support });
    return `select to_json(r) from gov_repo.l14_decide_authority_policy_proposal_v1(${named({
      ...principal(actor, input.session), p_command_id: lit(input.commandId), p_proposal_id: uuidOrNull(input.proposalId),
      p_outcome: lit(outcome), p_reason_code: lit(authorityPolicyReasonCode(outcome)), p_expected_current_state_id: uuidOrNull(expected),
      p_support_status: lit(support.status), p_support_evidence_ids: idsSql(support.evidenceIds),
      p_caller_fingerprint: lit(fingerprint) })}) r;`;
  }
  const exec = async (query: string) => JSON.parse(lastLine(await svc(query))) as Record<string, any>;
  const rejects = (promise: Promise<unknown>, code: string, detail?: RegExp) => assert.rejects(promise, (error: Error) => {
    assert.match(error.message, new RegExp(`\\b${code}\\b`), error.message);
    if (detail) assert.match(error.message, detail, error.message);
    return true;
  });
  const counts = async (org: string) => JSON.parse(lastLine(await owner(`select json_build_object(${L14_TABLES.map(t =>
    `'${t}',(select count(*) from gov_repo.${t} where organisation_id='${org}')`).join(',')})`))) as Record<string, number>;
  const proposalFor = (admitted: Record<string, any>, requestedEffectiveFrom: string | null = null): L14AuthorityPolicyProposalContent => ({
    subjectKind: 'AUTHORITY_POLICY_VERSION', intent: 'VALIDATE', sourceClass: 'LOCAL_HUMAN',
    authorityPolicyId: admitted.authority_policy_id, versionId: admitted.version_id, contentHash: admitted.content_hash,
    requestedEffectiveFrom, targetStateId: null });
  async function evidence(org: string, evidenceId: string) {
    await owner(`insert into gov_repo.discovery_evidence(organisation_id,evidence_id,handling,captured_at,content_hash,contract_version,envelope,envelope_hash)
      values('${org}',${lit(evidenceId)},'HASH_ONLY',now(),repeat('e',64),'1.0','{}',repeat('f',64))`);
    return evidenceId;
  }
  /** Admin-bootstraps a complete first policy (ADMIT → SUBMIT → VALIDATE) for an organisation. */
  async function bootstrapPolicy(admin: Actor, label: string, rules: readonly L14AuthorityPolicyRule[]) {
    const admitted = await exec(admitSql(admin, { commandId: `${label}-admit`, rules }));
    const proposal = proposalFor(admitted);
    const submitted = await exec(submitSql(admin, { commandId: `${label}-submit`, proposal }));
    const validated = await exec(decideSql(admin, { commandId: `${label}-validate`, proposalId: submitted.proposal_id, proposal }));
    return { admitted, proposal, submitted, validated };
  }
  return {
    ...pg, owner, svc, adminRole, memberRole, newOrg, mkUser, principal, admitSql, submitSql, decideSql, exec, rejects, counts,
    proposalFor, evidence, bootstrapPolicy, rule,
  };
}
export type L14Cluster = Awaited<ReturnType<typeof l14Cluster>>;
