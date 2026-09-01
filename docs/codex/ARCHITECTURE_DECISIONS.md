# Architecture Decisions

This file records only the Product Owner decisions finalized during M1A-R1. It remains subordinate to executable/versioned repository artifacts and approved ADRs and architecture documents.

## Wave A semantic decisions

### `gov_repo.governance_users.preferred_mfa`

Classification: **LEGACY / UNUSED / NON-AUTHORITATIVE**.

The field is not MFA enrollment state, MFA verification state, authentication enforcement, authorization authority, or identity-provider synchronization authority.

### `gov_repo.governance_roles.can_approve_up_to`

Classification: **LEGACY / UNUSED / NON-AUTHORITATIVE**.

The field does not define authorization, approval authority, workflow authorization, role hierarchy, or approval limits. Structured permissions and workflows are authoritative.

### `gov_repo.governance_ledger.actor_session_id`

Classification: **LEGACY / DEPRECATED / NON-AUTHORITATIVE**.

The field is not authentication-session identity, authorization authority, JWT or session authority, actor identity authority, or ledger-integrity evidence. No new producer or consumer is to be created for it.

### `gov_repo.mandates.mapped_policies`

Classification: **LEGACY / DENORMALIZED / NON-AUTHORITATIVE**.

The field is not the source of truth for policy-to-mandate relationships. It has no approved synchronization, dual-write, trigger, consumer, or backfill behavior.

### `gov_repo.policy_mandate_mappings`

Classification: **CANONICAL POLICY-TO-MANDATE RELATIONSHIP REPRESENTATION**.

This relation is the authoritative normalized representation of policy-to-mandate relationships in the current `gov_repo` model.
