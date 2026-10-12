# ADR — M16 Authority Policy Extension for M17 (additive amendment)

**Status:** ACCEPTED / FROZEN

**Date:** 2026-10-12

**Architecture:** `GOVIA-L0L16-CIA-v1.0` — FROZEN. **No baseline version change.**

**Amends (additively):** [ADR — M16 Ownership / Business / Policy / Control Enrichment V1](./ADR-GOVIA-OWNERSHIP-BUSINESS-POLICY-CONTROL-ENRICHMENT-v1.md)
§§4, 6, 7, 17, 20 — the closed permission vocabulary and the shared governance-envelope subject vocabularies only.
The M16 ADR text stays historically frozen and is **not** rewritten; this record is the explicit ADR treatment that
the M16 ADR requires for any architectural change.

**Consumer:** [ADR — M17 Risk Intelligence V1](./ADR-GOVIA-RISK-INTELLIGENCE-v1.md) §12 (decision D-01).

**Base SHA:** `5aec0b500cb16b0e3ce67376629ffa68cf2e6186` (canonical main after PR #63; M16 CLOSED / MERGED)

## 1. Owner approval

Explicit owner approval, 2026-10-12 (decision D-01), verbatim:

> "Ampliar aditivamente o Authority Policy e os shared governance ledgers do M16 para suportar M17, preservando as
> cinco famílias M16 e sem reabrir bootstrap."

(*Additively extend the M16 Authority Policy and the shared governance ledgers to support M17, preserving the five M16
families and without reopening bootstrap.*)

## 2. Decision

M17 (L15) governed decisions are authorized by the **single organisation-local `L14AuthorityPolicy`** established by
M16 and recorded through the **shared governance envelope** (authorization decisions, proposals, governance decisions,
command results). The closed vocabularies of those shared surfaces are widened **additively** to admit exactly the
L15 permissions and L15 governance subject kinds listed below. Nothing else in M16 changes.

## 3. Rationale — one authority root

- **One root of authority per organisation.** M16 §5 establishes exactly one stable Authority Policy identity per
  organisation with continuity and no autonomous expiry. A second, L15-local policy would create a second root, a
  second bootstrap, and two places where "who may decide" is answered — exactly the divergence M16 was built to remove.
- **No implicit authority.** M16 §6 forbids a permission name implying any action it does not name. L15 authority
  therefore cannot be derived from `L14_*` permissions; it needs its own explicit tags in the same policy.
- **One decision ledger.** Reusing the shared envelope keeps one replay/fingerprint/DENY/DEFER/terminality discipline,
  one authorization snapshot format, and one audit trail across L14 and L15.
- **Fact separation is preserved.** The authority envelope is shared; authoritative fact stores are not. L15 facts live
  in L15 state stores (M17 ADR §16), never in `l14_fact_states`.

## 4. Exact additive surfaces (implemented only in M17-S0)

| Surface | Current closed vocabulary (at `5aec0b5`) | Additive widening |
|---|---|---|
| `gov_repo.l14_authority_policy_rules.permission` | 15 `L14_*` permissions | + the 8 `L15_*` permissions (§5) |
| `gov_repo.l14_authorization_decision_rules.permission` | 15 `L14_*` permissions | + the 8 `L15_*` permissions |
| `gov_repo.l14_authorization_decisions.subject_kind` | 11 M16 subjects | + the 6 L15 subjects (§6); per-subject request-target shape CHECKs added for each L15 subject, mirroring the M16 per-subject target CHECKs |
| `gov_repo.l14_proposals.subject_kind` | 11 M16 subjects | + the 6 L15 subjects |
| `gov_repo.l14_governance_decisions.subject_kind` | 11 M16 subjects | + the 6 L15 subjects |
| `gov_repo.l14_governance_decisions.reason_code` | 44 codes under the existing *one code per subject × outcome* rule | + exactly 24 codes produced by the **same unchanged rule** for the 6 L15 subjects: `<SUBJECT>_{VALIDATED,REJECTED,DEFERRED,REVOKED}` |
| `gov_repo.l14_command_results.subject_kind` | 11 M16 subjects | + the 6 L15 subjects |
| `gov_repo.l14_command_results.command_kind` | `ADMIT_AUTHORITY_POLICY_VERSION`, `SUBMIT_PROPOSAL`, `DECIDE_PROPOSAL` and the M16 registry `ADMIT_*` kinds | + exactly `ADMIT_RISK_SCENARIO_DEFINITION_VERSION`, `ADMIT_RISK_METHODOLOGY_VERSION`; `SUBMIT_PROPOSAL` / `DECIDE_PROPOSAL` reused unchanged |
| `gov_repo.l14_command_results` shape CHECK | Per-subject result shapes | + L15 branches: decision results reference the L15 state id; no `registry_state_id` / `fact_state_id` for L15 subjects |
| Shared authorization / decision / proposal routines that enumerate closed subject or permission lists | M16 lists | Additive acceptance of the L15 subjects with the exact permission ↔ subject ↔ action mapping in §5; every re-created SECURITY DEFINER routine is re-registered in the definer-surface inventory with its new hash |

Subject × permission × action mapping (closed):

| L15 subject kind | ADMIT permission | VALIDATE / REJECT / DEFER / REVOKE permission |
|---|---|---|
| `RISK_SCENARIO_DEFINITION` | `L15_RISK_SCENARIO_ADMIT` | `L15_RISK_SCENARIO_VALIDATE` |
| `RISK_METHODOLOGY` | `L15_RISK_METHODOLOGY_ADMIT` | `L15_RISK_METHODOLOGY_VALIDATE` |
| `GOVERNED_RISK` | — (no ADMIT) | `L15_GOVERNED_RISK_VALIDATE` |
| `RISK_ASSESSMENT` | — | `L15_RISK_ASSESSMENT_VALIDATE` |
| `RISK_TREATMENT` | — | `L15_RISK_TREATMENT_VALIDATE` |
| `RISK_ACCEPTANCE` | — | `L15_RISK_ACCEPTANCE_VALIDATE` |

## 5. Exact L15 permissions

`L15_RISK_SCENARIO_ADMIT`, `L15_RISK_SCENARIO_VALIDATE`, `L15_RISK_METHODOLOGY_ADMIT`, `L15_RISK_METHODOLOGY_VALIDATE`,
`L15_GOVERNED_RISK_VALIDATE`, `L15_RISK_ASSESSMENT_VALIDATE`, `L15_RISK_TREATMENT_VALIDATE`,
`L15_RISK_ACCEPTANCE_VALIDATE`.

The closed permission vocabulary becomes exactly 23 tags (15 `L14_*` + 8 `L15_*`). An `L14_*` permission never
authorizes an L15 subject; an `L15_*` permission never authorizes an L14 subject.

## 6. Exact governance subject kinds

`RISK_SCENARIO_DEFINITION`, `RISK_METHODOLOGY`, `GOVERNED_RISK`, `RISK_ASSESSMENT`, `RISK_TREATMENT`, `RISK_ACCEPTANCE`.

The shared envelope subject vocabulary becomes exactly 17 values (11 M16 + 6 L15). **`RISK_SIGNAL` and
`RISK_HYPOTHESIS` are NOT governance-decision subject kinds**; they are non-authoritative L15 stores admitted through
bounded intake with their own replay identity and never appear in proposals, authorization decisions, governance
decisions or command results.

## 7. What does NOT change

| Item | Rule |
|---|---|
| `gov_repo.l14_fact_states.subject_kind` | **Not widened.** Remains exactly the five M16 families. |
| M16 fact families | Exactly five: `RESPONSIBILITY_ASSIGNMENT`, `BUSINESS_CONTEXT_ASSIGNMENT`, `POLICY_APPLICABILITY`, `CONTROL_APPLICABILITY`, `CONTROL_ASSESSMENT`. No sixth family. |
| `l14_registry_states`, `l14_support_links`, M16 admission tables, M16 typed proposal/state/head tables | Not widened. L15 registries, support links and states live in L15 stores. |
| Bootstrap | `SYSTEM_BOOTSTRAP_L14_AUTHORITY_V1` is unchanged and **never** authorizes an L15 permission or subject. There is **no L15 bootstrap**. Bootstrap never reopens. L15 rules enter an organisation only through a normal Authority Policy successor version validated under the effective policy (`L14_AUTHORITY_POLICY_ADMIN`). |
| Requested actions | Exactly `ADMIT`, `VALIDATE`, `REJECT`, `DEFER`, `REVOKE`. |
| Source classes / dispositions | Exactly `SYSTEM_SEED`, `LOCAL_HUMAN`, `SOURCE_CONNECTION` / `AUTHORITATIVE`, `CONTRIBUTING`, `NON_AUTHORITATIVE`. |
| Typed scope grammar | Exactly `ALL_ALLOWED_TARGETS`, `CANONICAL_KIND`, `CANONICAL_OBJECT`, `RELATIONSHIP_TYPE`, `RELATIONSHIP_STATE`. |
| Trust states | Exactly the five frozen baseline states. |
| Existing `L14_*` permissions | Semantics, subject mapping and evaluation unchanged. |
| Governance reason-code rule | Unchanged (one code per subject × outcome; no free text). Richer L15 reasons (e.g. risk-closure reason) are typed closed fields of L15 proposals/states, not shared reason codes. |
| M16 history | No existing Authority Policy version, rule, authorization decision, proposal, governance decision, command result or fact row is updated or deleted. Constraint widening only admits new values; every existing row satisfies the widened CHECKs unchanged. |
| Canonical taxonomy / F2 | 11 kinds, 12 types, F2 untouched. |
| Baseline | `GOVIA-L0L16-CIA-v1.0` unchanged; no version increment. |

## 8. Acceptance linkage

Verified by M17 ADR criteria (§26 there): exact widened vocabularies; `l14_fact_states` and other M16-only
vocabularies byte-identical to `5aec0b5`; no L15 bootstrap; bootstrap rejects every L15 subject; reason codes follow
the unchanged rule; existing M16 rows byte-identical after widening; M16 PG17 suite and M15 regression green, with only
the vocabulary-assertion lines that enumerate the widened closed lists updated to the amended lists.

## 9. Implementation boundary

This amendment is documentation only. It creates or runs no migration and changes no code, test or hosted
environment. Implementation is deferred to **M17-S0** and MUST NOT begin before the M17 architecture PR is merged
into main.
