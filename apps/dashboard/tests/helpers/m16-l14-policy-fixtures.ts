import { randomUUID } from 'node:crypto';
import type { L14AuthorityPolicyRule, L14GovernancePolicyDescriptor, L14SourceClass, L14Support } from '@council/canonical-contracts';
import { admitGovernancePolicyFingerprint, admitPolicyVersionFingerprint, policyVersionContentHash } from '@council/governance-review';
import { lit, named } from './m16-governed-write-fixtures';
import { NONE, lastLine, rule, type Actor, type L14Cluster, type SessionOverride } from './m16-l14-fixtures';
import { successorKit } from './m16-l14-successor-fixtures';

/**
 * M16-S1B.3 policy content admission fixtures on the S1B3-horizon L14 cluster (full canonical chain). Every
 * organisation's Authority Policy is bootstrapped through the real AP RPCs; every policy command goes through the
 * real S1B.3 RPCs as service_role with the caller fingerprint computed by the production TypeScript mirror
 * (@council/governance-review). Only administrator support rows (and explicit LEGACY policy rows) are inserted as
 * the owner.
 */
export const POLICY_LINEAGE_TABLES = ['l14_policy_admissions', 'l14_policy_version_admissions'] as const;
export const L14_S1B3_TABLES = [
  'l14_authority_policies', 'l14_authority_policy_versions', 'l14_authority_policy_rules', 'l14_proposals',
  'l14_authority_policy_version_proposals', 'l14_authorization_decisions', 'l14_authorization_decision_roles',
  'l14_authorization_decision_rules', 'l14_governance_decisions', 'l14_authority_policy_states',
  'l14_authority_policy_heads', 'l14_command_results', 'l14_support_links', 'l14_registry_states',
  'l14_governance_parties', 'l14_governance_party_proposals', 'l14_governance_party_states', 'l14_governance_party_heads',
  ...POLICY_LINEAGE_TABLES, 'governance_policies', 'policy_versions',
] as const;

const KINDS = ['AGENT', 'MODEL', 'TOOL', 'API', 'PROMPT', 'SKILL', 'DATA_ASSET', 'DATA_ELEMENT', 'MCP_SERVER', 'KNOWLEDGE_BASE', 'AGENT_VERSION'] as const;
const uuidOrNull = (value: string | null) => (value === null ? 'null::uuid' : `'${value}'::uuid`);
const idsSql = (ids: readonly string[]) => (ids.length ? `array[${ids.map(lit).join(',')}]::text[]` : `'{}'::text[]`);
/** Exact UTF-8 bytes as a SQL text expression: no client line-ending or encoding translation can alter the content. */
export const utf8Sql = (value: string) => `convert_from(decode('${Buffer.from(value, 'utf8').toString('base64')}', 'base64'), 'UTF8')`;

export async function policyKit(c: L14Cluster) {
  const { owner, exec, adminRole, memberRole } = c;
  const ap = await successorKit(c);
  const role = async (code: string) => {
    const id = randomUUID();
    await owner(`insert into gov_repo.governance_roles(role_id,role_code,role_name,role_tier,is_system_role)
      values('${id}','${code}','${code}','organisation',false)`);
    return id;
  };
  const authorRole = await role('L14_POLICY_AUTHOR');
  const contribRole = await role('L14_POLICY_CONTRIBUTOR');
  const partyRole = await role('L14_POLICY_PARTY_REGISTRAR');
  const validatorRole = await role('L14_POLICY_VALIDATOR');

  /**
   * AP administration (opsRole) + policy content administration. author: L14_POLICY_CONTENT_ADMIT / ADMIT.
   * contributor: a CONTRIBUTING (never authorizing) ADMIT rule. party: a different subject family (L14_PARTY_ADMIT).
   * validator: a different permission (L14_POLICY_VERSION_VALIDATE / VALIDATE). All registry rules ALL_ALLOWED_TARGETS.
   */
  const policyRules = (variant = 0, drop: readonly string[] = []): L14AuthorityPolicyRule[] => [
    rule(adminRole, 'L14_AUTHORITY_POLICY_ADMIT', 'ADMIT'),
    rule(ap.opsRole, 'L14_AUTHORITY_POLICY_ADMIT', 'ADMIT'),
    rule(ap.opsRole, 'L14_AUTHORITY_POLICY_ADMIN', 'VALIDATE'),
    rule(ap.opsRole, 'L14_AUTHORITY_POLICY_ADMIN', 'REJECT'),
    rule(ap.opsRole, 'L14_AUTHORITY_POLICY_ADMIN', 'DEFER'),
    rule(ap.opsRole, 'L14_AUTHORITY_POLICY_ADMIN', 'REVOKE'),
    rule(authorRole, 'L14_POLICY_CONTENT_ADMIT', 'ADMIT'),
    rule(contribRole, 'L14_POLICY_CONTENT_ADMIT', 'ADMIT', { sourceDisposition: 'CONTRIBUTING' }),
    rule(partyRole, 'L14_PARTY_ADMIT', 'ADMIT'),
    rule(validatorRole, 'L14_POLICY_VERSION_VALIDATE', 'VALIDATE'),
    // variant only varies content (a distinct content hash per successor).
    ...KINDS.slice(0, variant).map(kind => rule(memberRole, 'L14_RESPONSIBILITY_VALIDATE', 'VALIDATE',
      { scopeTag: 'CANONICAL_KIND', scopeCanonicalKind: kind })),
  ].filter(r => !drop.includes(`${r.roleId}:${r.permission}:${r.requestedAction}`));

  let n = 0;
  async function setup(rules: readonly L14AuthorityPolicyRule[] = policyRules(), options: { bootstrap?: boolean } = {}) {
    const org = await c.newOrg();
    const boot = await c.mkUser(org, [adminRole, ap.opsRole]);
    const ops = await c.mkUser(org, [ap.opsRole]);
    const author = await c.mkUser(org, [authorRole]);
    const author2 = await c.mkUser(org, [authorRole]);
    const member = await c.mkUser(org, [memberRole]);
    const contrib = await c.mkUser(org, [contribRole]);
    const party = await c.mkUser(org, [partyRole]);
    const validator = await c.mkUser(org, [validatorRole]);
    const label = `pol${++n}`;
    const first = options.bootstrap === false ? null : await c.bootstrapPolicy(boot, label, rules);
    return { org, boot, ops, author, author2, member, contrib, party, validator, label,
      v1: first?.admitted as Record<string, any>, cmd: (name: string) => `${label}-${name}` };
  }
  type Ctx = Awaited<ReturnType<typeof setup>>;

  const descriptor = (policyCode: string, title = `Policy ${policyCode}`,
    policyType: L14GovernancePolicyDescriptor['policyType'] = 'compliance'): L14GovernancePolicyDescriptor => ({ policyCode, title, policyType });

  interface AdmitPolicyInput {
    commandId: string; descriptor: L14GovernancePolicyDescriptor; support?: L14Support; sourceClass?: L14SourceClass | string;
    expectation?: string | null; fingerprint?: string; session?: SessionOverride;
  }
  function admitPolicySql(actor: Actor, input: AdmitPolicyInput) {
    const support = input.support ?? NONE, sourceClass = input.sourceClass ?? 'LOCAL_HUMAN', d = input.descriptor;
    const fingerprint = input.fingerprint ?? admitGovernancePolicyFingerprint({
      organisationId: input.session?.org ?? actor.org, actorUserId: actor.id, descriptor: d,
      sourceClass: sourceClass as L14SourceClass, support });
    return `select to_json(r) from gov_repo.l14_admit_governance_policy_v1(${named({
      ...c.principal(actor, input.session), p_command_id: lit(input.commandId),
      p_expectation_kind: input.expectation === null ? 'null::text' : lit(input.expectation ?? 'EXPECTED_NONE'),
      p_policy_code: lit(d.policyCode), p_title: lit(d.title), p_policy_type: lit(d.policyType), p_source_class: lit(sourceClass),
      p_support_status: lit(support.status), p_support_evidence_ids: idsSql(support.evidenceIds),
      p_caller_fingerprint: lit(fingerprint) })}) r;`;
  }
  interface AdmitVersionInput {
    commandId: string; policyId: string; content: string; expected?: string | null; contentHash?: string; support?: L14Support;
    sourceClass?: L14SourceClass | string; fingerprint?: string; session?: SessionOverride;
  }
  function admitVersionSql(actor: Actor, input: AdmitVersionInput) {
    const support = input.support ?? NONE, sourceClass = input.sourceClass ?? 'LOCAL_HUMAN', expected = input.expected ?? null;
    const contentHash = input.contentHash ?? policyVersionContentHash(input.content);
    const fingerprint = input.fingerprint ?? admitPolicyVersionFingerprint({
      organisationId: input.session?.org ?? actor.org, actorUserId: actor.id, policyId: input.policyId,
      expectedLatestVersionId: expected, contentHash, sourceClass: sourceClass as L14SourceClass, support });
    return `select to_json(r) from gov_repo.l14_admit_policy_version_v1(${named({
      ...c.principal(actor, input.session), p_command_id: lit(input.commandId), p_policy_id: uuidOrNull(input.policyId),
      p_expected_latest_version_id: uuidOrNull(expected), p_content_markdown: utf8Sql(input.content), p_content_hash: lit(contentHash),
      p_source_class: lit(sourceClass), p_support_status: lit(support.status), p_support_evidence_ids: idsSql(support.evidenceIds),
      p_caller_fingerprint: lit(fingerprint) })}) r;`;
  }
  function readSql(actor: Actor, policyId: string | null = null, session?: SessionOverride) {
    return `select coalesce(json_agg(r), '[]'::json) from gov_repo.l14_read_policy_descriptors_v1(${named({
      ...c.principal(actor, session), p_policy_id: uuidOrNull(policyId) })}) r;`;
  }
  const read = async (actor: Actor, policyId: string | null = null, session?: SessionOverride) =>
    JSON.parse(await c.svc(readSql(actor, policyId, session))) as Array<Record<string, any>>; // json_agg spans lines

  async function admitPolicy(ctx: Ctx, actor: Actor, name: string, d = descriptor(`${ctx.label}-${name}`.slice(0, 20)), support?: L14Support) {
    return exec(admitPolicySql(actor, { commandId: ctx.cmd(name), descriptor: d, support }));
  }
  async function admitVersion(ctx: Ctx, actor: Actor, name: string, policyId: string, content: string, expected: string | null = null,
    support?: L14Support) {
    return exec(admitVersionSql(actor, { commandId: ctx.cmd(name), policyId, content, expected, support }));
  }
  /** An explicit LEGACY policy row (owner-inserted, never admitted): exactly what pre-M16 data looks like. */
  async function legacyPolicy(org: string, ownerUser: string, code: string, withVersion = true) {
    const policyId = randomUUID();
    await owner(`insert into gov_repo.governance_policies(policy_id,policy_code,title,policy_type,status,owner_user_id,organisation_id,created_by)
      values('${policyId}',${lit(code)},'Legacy ${code}','compliance','approved','${ownerUser}','${org}','${ownerUser}')`);
    let versionId: string | null = null;
    if (withVersion) {
      versionId = randomUUID();
      await owner(`insert into gov_repo.policy_versions(version_id,organisation_id,policy_id,version_number,version_label,content_markdown,change_summary,status,approved_by,approval_date,created_by)
        values('${versionId}','${org}','${policyId}',1,'1.0','# legacy ${code}','legacy','approved','${ownerUser}',now(),'${ownerUser}')`);
    }
    return { policyId, versionId };
  }
  const counts = async (org: string) => JSON.parse(lastLine(await owner(`select json_build_object(${L14_S1B3_TABLES.map(t =>
    `'${t}',(select count(*) from gov_repo.${t} where organisation_id='${org}')`).join(',')})`))) as Record<string, number>;
  /** A successor Authority Policy through the real AP RPCs (ops ADMIT → member SUBMIT → ops VALIDATE). */
  async function apSuccessor(ctx: Ctx, name: string, rules: readonly L14AuthorityPolicyRule[]) {
    return ap.successor(ctx as never, name, rules);
  }
  return {
    ap, authorRole, contribRole, partyRole, validatorRole, policyRules, setup, descriptor, admitPolicySql, admitVersionSql,
    readSql, read, admitPolicy, admitVersion, legacyPolicy, counts, apSuccessor,
  };
}
export type PolicyKit = Awaited<ReturnType<typeof policyKit>>;
