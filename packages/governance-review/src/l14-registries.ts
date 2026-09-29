import {
  L14_GOVERNANCE_OUTCOMES, L14_REGISTRY_PERMISSIONS, L14_REGISTRY_REASON_CODES, L14_REGISTRY_SUBJECT_KINDS,
  type L14AuthorityPolicyRule, type L14GovernanceOutcome, type L14RegistryReasonCode, type L14RegistrySubjectKind,
} from '@council/canonical-contracts';
import { L14ContractError } from './l14-authority-policy.ts';

/**
 * M16-S1B.0 mirrors of the registry-framework database rules. PostgreSQL enforces them itself;
 * these only fail earlier with the same closed reason. The S1A validateAuthorityPolicyRule mirror
 * is deliberately unchanged: historical S1A commands (whose payload may hold a registry rule with a
 * non-ALL scope) must still compute their original fingerprint for exact replay.
 */

const REGISTRY_PERMISSIONS: readonly string[] = L14_REGISTRY_PERMISSIONS;

/** Mirror of the D-14 insertion guard: a NEW registry-permission rule must be ALL_ALLOWED_TARGETS. */
export function assertRegistryRuleScope(rule: L14AuthorityPolicyRule): void {
  if (REGISTRY_PERMISSIONS.includes(rule.permission) && rule.scopeTag !== 'ALL_ALLOWED_TARGETS') {
    throw new L14ContractError('RULE_REGISTRY_SCOPE_INVALID');
  }
}

/** Mirror of l14_governance_decisions_reason_check for the five registry subjects. */
export function registryReasonCode(subjectKind: L14RegistrySubjectKind, outcome: L14GovernanceOutcome): L14RegistryReasonCode {
  if (!(L14_REGISTRY_SUBJECT_KINDS as readonly string[]).includes(subjectKind)
    || !(L14_GOVERNANCE_OUTCOMES as readonly string[]).includes(outcome)) {
    throw new L14ContractError('DECISION_VOCABULARY_INVALID');
  }
  return L14_REGISTRY_REASON_CODES[subjectKind][outcome];
}
