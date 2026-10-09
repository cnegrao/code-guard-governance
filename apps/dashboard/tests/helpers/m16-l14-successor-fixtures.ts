import { randomUUID } from 'node:crypto';
import type { L14AuthorityPolicyRule } from '@council/canonical-contracts';
import type { L14AuthorityPolicyProposalContent } from '@council/governance-review';
import { lastLine, rule, type Actor, type L14Cluster } from './m16-l14-fixtures';

/**
 * M16-S1A.2 successor-lifecycle fixtures on top of the S1A.1 L14 cluster. Every organisation is
 * bootstrapped through the real RPCs; successor commands also go through the real RPCs.
 */
const KINDS = ['AGENT', 'MODEL', 'TOOL', 'API', 'PROMPT', 'SKILL', 'DATA_ASSET', 'DATA_ELEMENT', 'MCP_SERVER', 'KNOWLEDGE_BASE', 'AGENT_VERSION'] as const;

export interface Flags { readonly validate?: Partial<L14AuthorityPolicyRule>; readonly revoke?: Partial<L14AuthorityPolicyRule> }

export async function successorKit(c: L14Cluster) {
  const { owner, exec, admitSql, submitSql, decideSql, adminRole, memberRole } = c;
  // One AP-ops role per cluster: a second kit on the same cluster (e.g. party + domain fixtures) reuses it.
  const opsRole = (await owner(`select role_id from gov_repo.governance_roles where role_code='L14_POLICY_OPS'`)).trim() || randomUUID();
  await owner(`insert into gov_repo.governance_roles(role_id,role_code,role_name,role_tier,is_system_role)
    values('${opsRole}','L14_POLICY_OPS','Policy ops','organisation',false) on conflict (role_id) do nothing`);

  /** Full Authority Policy administration for opsRole (+ ADMIT for the system admin). variant varies content. */
  const opsRules = (variant = 0, flags: Flags = {}): L14AuthorityPolicyRule[] => [
    rule(adminRole, 'L14_AUTHORITY_POLICY_ADMIT', 'ADMIT'),
    rule(opsRole, 'L14_AUTHORITY_POLICY_ADMIT', 'ADMIT'),
    rule(opsRole, 'L14_AUTHORITY_POLICY_ADMIN', 'VALIDATE', flags.validate),
    rule(opsRole, 'L14_AUTHORITY_POLICY_ADMIN', 'REJECT'),
    rule(opsRole, 'L14_AUTHORITY_POLICY_ADMIN', 'DEFER'),
    rule(opsRole, 'L14_AUTHORITY_POLICY_ADMIN', 'REVOKE', flags.revoke),
    rule(memberRole, 'L14_PARTY_VALIDATE', 'VALIDATE', { scopeTag: 'CANONICAL_KIND', scopeCanonicalKind: KINDS[variant % KINDS.length]! }),
  ];

  let n = 0;
  async function setup(v1Rules: readonly L14AuthorityPolicyRule[] = opsRules()) {
    const org = await c.newOrg();
    const boot = await c.mkUser(org, [adminRole, opsRole]);
    const ops = await c.mkUser(org, [opsRole]);
    const ops2 = await c.mkUser(org, [opsRole]);
    const member = await c.mkUser(org, [memberRole]);
    const label = `org${++n}`;
    const first = await c.bootstrapPolicy(boot, label, v1Rules);
    return { org, boot, ops, ops2, member, label, v1: first.admitted, s1: first.validated, cmd: (name: string) => `${label}-${name}` };
  }
  type Ctx = Awaited<ReturnType<typeof setup>>;

  const head = async (org: string) => JSON.parse(lastLine(await owner(
    `select to_json(h) from gov_repo.l14_authority_policy_heads h where organisation_id='${org}'`))) as { authority_policy_id: string; latest_version_id: string; latest_state_id: string | null };
  const instant = async (offset: string) => owner(
    `select to_char((clock_timestamp() + interval '${offset}') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`);
  const canonical = async (ts: string) => owner(
    `select to_char('${ts}'::timestamptz at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`);

  function admitNextSql(ctx: Ctx, actor: Actor, commandId: string, rules: readonly L14AuthorityPolicyRule[], latestVersionId: string) {
    return admitSql(actor, { commandId, rules, expected: { authorityPolicyId: ctx.v1.authority_policy_id, latestVersionId } });
  }
  async function admitNext(ctx: Ctx, actor: Actor, name: string, rules: readonly L14AuthorityPolicyRule[]) {
    const h = await head(ctx.org);
    return exec(admitNextSql(ctx, actor, ctx.cmd(name), rules, h.latest_version_id));
  }
  const validateProposal = (admitted: Record<string, any>, requestedEffectiveFrom: string | null = null): L14AuthorityPolicyProposalContent =>
    c.proposalFor(admitted, requestedEffectiveFrom);
  const revokeProposal = (state: { authority_policy_id: string; version_id: string; content_hash: string; state_id: string },
    requestedEffectiveFrom: string | null = null): L14AuthorityPolicyProposalContent => ({
    subjectKind: 'AUTHORITY_POLICY_VERSION', intent: 'REVOKE', sourceClass: 'LOCAL_HUMAN',
    authorityPolicyId: state.authority_policy_id, versionId: state.version_id, contentHash: state.content_hash,
    requestedEffectiveFrom, targetStateId: state.state_id });
  async function submit(ctx: Ctx, actor: Actor, name: string, proposal: L14AuthorityPolicyProposalContent) {
    return exec(submitSql(actor, { commandId: ctx.cmd(name), proposal }));
  }
  function decideSqlFor(ctx: Ctx, actor: Actor, commandId: string, proposalId: string, proposal: L14AuthorityPolicyProposalContent,
    outcome: 'VALIDATE' | 'REJECT' | 'DEFER' | 'REVOKE', expected: string | null) {
    return decideSql(actor, { commandId, proposalId, proposal, outcome, expected });
  }
  async function decide(ctx: Ctx, actor: Actor, name: string, submitted: Record<string, any>, proposal: L14AuthorityPolicyProposalContent,
    outcome: 'VALIDATE' | 'REJECT' | 'DEFER' | 'REVOKE' = 'VALIDATE') {
    const h = await head(ctx.org);
    return exec(decideSqlFor(ctx, actor, ctx.cmd(name), submitted.proposal_id, proposal, outcome, h.latest_state_id));
  }
  /** ADMIT → SUBMIT (by member) → DECIDE VALIDATE (by ops) for a successor. */
  async function successor(ctx: Ctx, name: string, rules: readonly L14AuthorityPolicyRule[], requestedEffectiveFrom: string | null = null,
    validator: Actor = ctx.ops) {
    const admitted = await admitNext(ctx, ctx.ops, `${name}-admit`, rules);
    const proposal = validateProposal(admitted, requestedEffectiveFrom);
    const submitted = await submit(ctx, ctx.member, `${name}-submit`, proposal);
    const decided = await decide(ctx, validator, `${name}-validate`, submitted, proposal);
    return { admitted, proposal, submitted, decided };
  }
  const state = async (org: string, stateId: string) => JSON.parse(lastLine(await owner(
    `select to_json(s) from gov_repo.l14_authority_policy_states s where organisation_id='${org}' and state_id='${stateId}'`)));
  const stateRowText = (org: string, stateId: string) => owner(
    `select s::text from gov_repo.l14_authority_policy_states s where organisation_id='${org}' and state_id='${stateId}'`);
  /** Version effective at business instant `at` as known at recorded cutoff `cutoff` (SQL expressions). */
  const resolve = async (org: string, at: string, cutoff: string) => {
    const out = await owner(`select coalesce(json_agg(r), '[]') from gov_repo.l14_effective_authority_policy_version_v1('${org}', ${at}, ${cutoff}) r`);
    const rows = JSON.parse(lastLine(out)) as Array<{ version_id: string }>;
    if (rows.length > 1) throw new Error('resolver returned more than one version');
    return rows[0]?.version_id ?? null;
  };
  const ts = (value: string) => `'${value}'::timestamptz`;
  return { opsRole, opsRules, setup, head, instant, canonical, admitNextSql, admitNext, validateProposal, revokeProposal, submit,
    decideSqlFor, decide, successor, state, stateRowText, resolve, ts };
}
export type SuccessorKit = Awaited<ReturnType<typeof successorKit>>;
