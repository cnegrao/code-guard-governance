# M17-S0 — Authority / Security / Root Contracts + Legacy Compatibility Hardening

Starting point: `origin/main` = `931d2d523992b98921b01f071f49997fe4bce678` (merge of PR #64,
`docs/m17-risk-intelligence-architecture`), verified equal to the expected SHA before branching, clean worktree. Repository
`cnegrao/code-guard-governance`. Branch `feat/m17-s0-authority-security-root-contracts` created from exactly that commit.

Architecture authority (not modified): [M17 ADR](../../architecture/ADR-GOVIA-RISK-INTELLIGENCE-v1.md) (ACCEPTED / FROZEN)
§§11-12, 16, 23-24, 26, 28 and the [M16 Authority Policy M17 extension](../../architecture/ADR-GOVIA-M16-AUTHORITY-POLICY-M17-EXTENSION-v1.md)
(D-01, ACCEPTED / FROZEN) §§4-7; [baseline](../../architecture/GOVIA-L0L16-CIA-v1.0.md) unchanged; M15 / M16 ADRs unchanged.

## Recorded state

| Item | State |
|---|---|
| Architecture PR #64 | MERGED (`931d2d5`) |
| `main` baseline at slice start | `931d2d523992b98921b01f071f49997fe4bce678` |
| M17-S0 | IMPLEMENTED ON BRANCH `feat/m17-s0-authority-security-root-contracts`; **NOT MERGED**; PR NOT OPENED |
| M17-S1 … S7 | **NOT STARTED** |
| M18 / M19 | NOT STARTED |
| Hosted (Supabase / Vercel / deployment) | **NOT TOUCHED** |

## Environments — LOCAL / CI / HOSTED

- **LOCAL**: disposable PostgreSQL **17.10** clusters (server binaries from `@embedded-postgres/linux-x64@17.10.0-beta.17`;
  `psql` is the local PostgreSQL 16 client; the PGDG apt host is not reachable from this environment), passed as
  `M16_PG17_BIN`, run as an unprivileged OS user; the harness asserts `server_version_num` 17.x. pgvector is not installed
  locally (the harness's labelled stand-in; the one HNSW statement is the only statement allowed to fail, asserted exactly).
  M15 ran on local PostgreSQL 16 (the CI runner's default major). Node **24.21.0**.
- **CI**: `M16 PostgreSQL 17 security suite` (PGDG PostgreSQL 17 + real pgvector) and `M15 PostgreSQL regression` on the pushed
  branch. The exact final branch HEAD CI is the arbiter; it is reported to ACP, not pre-recorded here.
- **HOSTED**: NOT TOUCHED. No hosted migration, no direct hosted DB access, no Vercel change, no deployment.

## Pre-flight (verified)

- Canonical repository `cnegrao/code-guard-governance`; `main` = `931d2d5`; worktree clean.
- PR #64 merged; M17 ADR **ACCEPTED / FROZEN**; M16 Authority Policy M17 extension **ACCEPTED / FROZEN**.
- The **actual** post-M16 catalog was materialized in a disposable PG17 cluster (full canonical chain through
  `20261012120000_m16_read_projection_closure_v1.sql`) and every constraint / routine touched below was read from
  `pg_get_constraintdef` / `pg_proc.prosrc`, not from ADR prose. Findings that shaped the slice:
  - the authorization evaluators (`l14_evaluate_authority_rules_v1`, `…_target_…`, `…_relationship_state_…`) are generic (the
    permission is a parameter): **no SECURITY DEFINER routine needs to change**;
  - the closed permission list lives in the two `permission` CHECKs and in the owner-only rule parser
    `l14_parse_authority_policy_rules_v1` (SECURITY INVOKER, not part of the definer inventory);
  - the closed subject / reason / command lists live only in table CHECKs of the four shared-envelope tables;
  - the subject → permission mapping of M16 lives inside each per-subject RPC (no shared enumerating routine to widen).
- No frozen semantic outside the D-01 amendment had to change → no STOP condition.

## Migration

Exactly one additive migration: **`supabase/migrations/20261012200000_m17_s0_authority_policy_l15_extension_v1.sql`**.
No historical migration was edited. It runs a preflight (exact post-M16 vocabularies, no pre-existing `l15_*` object, capture
of every `gov_repo` constraint definition and an order-independent row hash of every M16 governance envelope table, both
legacy risk stores and the legacy agent risk columns) and a postflight that re-proves everything below inside the same
transaction.

### D-01 — single Authority Policy extension

| Surface | Before | After |
|---|---|---|
| `l14_authority_policy_rules.permission` | 15 `L14_*` | **23** (+ the 8 `L15_*`) |
| `l14_authorization_decision_rules.permission` | 15 | **23** |
| `l14_authorization_decisions.subject_kind` | 11 | **17** (+ 6 L15) |
| `l14_proposals.subject_kind` | 11 | **17** |
| `l14_governance_decisions.subject_kind` | 11 | **17** |
| `l14_governance_decisions.reason_code` | 44 | **68** (+ exactly 24 = `<SUBJECT>_{VALIDATED,REJECTED,DEFERRED,REVOKED}`); `l14_governance_decisions_reason_check` (the subject × outcome rule) **unchanged** |
| `l14_command_results.subject_kind` | 11 | **17** |
| `l14_command_results.command_kind` | 9 | **11** (+ `ADMIT_RISK_SCENARIO_DEFINITION_VERSION`, `ADMIT_RISK_METHODOLOGY_VERSION`); `SUBMIT_PROPOSAL` / `DECIDE_PROPOSAL` reused |
| `l14_command_results.command_subject_check` | M16 pairs | + the two ADMIT kinds bound to their registry subject |
| `l14_command_results.shape_check` | AP / registry / fact branches | branches kept **verbatim** + one L15 branch: never AP / registry / fact columns; SUBMITTED, ADMITTED / DENIED (L15 ADMIT kinds), DECIDE DENIED / REJECTED / DEFERRED |
| Per-subject request-target CHECKs (new) | — | `…_l15_registry_target_check`: RISK_SCENARIO_DEFINITION / RISK_METHODOLOGY organisation-local (`ALL_ALLOWED_TARGETS`); `…_l15_risk_target_check`: GOVERNED_RISK / RISK_ASSESSMENT / RISK_TREATMENT / RISK_ACCEPTANCE never ADMIT, target = one exact canonical object of a legal V1 subject kind (§8.2: AGENT, AGENT_VERSION, MODEL, TOOL, MCP_SERVER, API, DATA_ASSET, DATA_ELEMENT) or one exact relationship state, explicit expectation |
| Rule parser `l14_parse_authority_policy_rules_v1` | 15-tag list | 23-tag list + L15 registry rules organisation-local (`RULE_REGISTRY_SCOPE_INVALID`, mirror of M16 D-14); same signature / owner / ACL / volatility / pinned `search_path`; frame and content hash unchanged (every stored policy version re-hashes identically) |
| `l14_authority_policy_rules_l15_registry_scope_check` (new) | — | table-level mirror of the same registry-scope rule |

`RISK_SIGNAL` and `RISK_HYPOTHESIS` are in **no** governance vocabulary. **Not widened:** `l14_fact_states` (exactly the five
M16 families), `l14_registry_states`, `l14_support_links`, every M16 typed proposal / state / head / admission table; requested
actions, source classes / dispositions, scope grammar and trust vocabulary are byte-identical. No sixth M16 family.

### L14 ↔ L15 authority isolation and no L15 bootstrap (fail-closed DB boundary)

Three owner-only SECURITY INVOKER routines (`search_path = pg_catalog, pg_temp`, EXECUTE revoked from PUBLIC / anon /
authenticated / service_role) and one mapping function:

- `l15_governance_permission_v1(subject, action)` — the closed amendment §4 mapping; NULL for every L14 subject,
  RISK_SIGNAL / RISK_HYPOTHESIS, unknown values and ADMIT on a non-registry subject.
- `l15_decision_rule_isolation_guard_v1` (BEFORE INSERT, ENABLE ALWAYS on `l14_authorization_decision_rules`): an L15 decision
  can snapshot **only** the mapped L15 permission for its exact action; an L14 decision can **never** snapshot an `L15_*` rule.
- `l15_authorization_allow_guard_v1` (DEFERRABLE INITIALLY DEFERRED constraint trigger, ENABLE ALWAYS, on
  `l14_authorization_decisions`, only for L15 ALLOW rows): at commit an L15 ALLOW must rest on an `AUTHORITY_POLICY_VERSION`
  basis, snapshot ≥ 1 `AUTHORITY_POLICY_RULE` of that exact basis with the mapped permission + action, and be made by an
  `active` governance user of the same **active** organisation. A service_role / technical / suspended / cross-tenant caller
  can never satisfy it.
- `l15_authority_policy_rule_admission_basis_guard_v1` (BEFORE INSERT, ENABLE ALWAYS on `l14_authority_policy_rules`): an
  `L15_*` rule may enter only a version admitted under the effective policy (`AUTHORITY_POLICY_VERSION` basis) — never the
  bootstrap-admitted first version. With the unchanged `l14_authorization_decisions_bootstrap_subject_check` (bootstrap basis
  only for AUTHORITY_POLICY_VERSION) and the new `l14_authorization_decision_rules_l15_no_bootstrap_check` (a
  `SYSTEM_BOOTSTRAP` snapshot is always `L14_*`), `SYSTEM_BOOTSTRAP_L14_AUTHORITY_V1` rejects every L15 permission and every
  L15 subject. There is no L15 bootstrap routine; bootstrap never reopens.

### SECURITY DEFINER / definer-capability inventory

**No SECURITY DEFINER routine was created or replaced.** The postflight re-asserts the closed 45-routine application surface
byte-identically (owner, body SHA-256, config, service_role-only EXECUTE, no extra application-executable definer). Nothing
needed re-registration; the new routines are SECURITY INVOKER and owner-only.

### D-05 — legacy risk write-freeze

`REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON gov_repo.risk_entries / gov_repo.risk_treatments FROM PUBLIC, anon,
authenticated, service_role`. Rows, columns, defaults, constraints, triggers, RLS policies are untouched; SELECT stays for the
labelled legacy consumers. Postflight (after **all** migrations, so the broad `20260818013113` defaults are accounted for):
`has_table_privilege` false for every application role × privilege (membership / defaults / PUBLIC included), no column-level
write grant, no PUBLIC write entry, no auto-updatable view reaching either table writable by an application role, no
application-executable definer writing them. The `risk_treatments → risk_entries ON DELETE CASCADE` path is unreachable by any
application role. Table comments mark both stores `LEGACY / NON-AUTHORITATIVE`.

## D-12 — scanner legacy risk writer stopped

`apps/dashboard/app/api/discovery/scan/route.ts`:

- the `gov_repo.agents` insert is **removed** (not field-omitted): both `risk_level` and `ai_act_risk_class` are NOT NULL with
  defaults, so no scanner/discovery row is created at all — neither a heuristic (`complianceExposure` / `suggestedRiskLevel`
  mapping, `?? "limited"`) nor a column default is fabricated; no placeholder is written;
- `inventory.discovery.agent.detected` ledger payloads no longer carry `risk_level`, and the classification is stripped of
  `riskLevel` / `aiActRiskClass`;
- the response reports `inventoryStored: 0`, `legacyInventoryWrite: "STOPPED_M17_S0_D12"`,
  `heuristicRiskAuthority: "LEGACY / NON-AUTHORITATIVE"` for the in-memory scan output.

Existing agent rows, values, columns, defaults, NOT NULL definitions and ledger history are preserved (row hash and
`information_schema.columns` equality proven in PG17). Nothing is migrated into M17; scanner → M17 integration is S1
(`RISK_SIGNAL` adapters). Human legacy writes (`AgentForm` / agents API) remain COMPATIBILITY ONLY and labelled.

The pre-existing dashboard test `tests/pre-demo-discovery.test.ts` asserted the old risk-bearing insert
(`inventoryStored = 1`); per the approved D-12 it now asserts zero table writes, `inventoryStored = 0` and
`legacyInventoryWrite = STOPPED_M17_S0_D12` (strengthened, not weakened).

## Legacy consumer labelling (`LEGACY / NON-AUTHORITATIVE`)

Shared contract `apps/dashboard/lib/legacy-risk.ts` (`LEGACY_RISK_LABEL`, `legacyRisk`, `legacyRiskText`) and
`components/ui/LegacyRiskBadge.tsx` (absent value → `unknown`, never low / none; `data-authority="LEGACY_NON_AUTHORITATIVE"`).

| Consumer (ADR §23 / inventory G07, G08, G12) | Treatment |
|---|---|
| Agents list (`AgentTable`) | column "Legacy risk label (LEGACY / NON-AUTHORITATIVE)", labelled badge |
| Agent detail | "Legacy risk label" + "Legacy AI Act risk class", both labelled badges |
| Dashboard aggregates (`repositories/dashboard.ts`, page) | summary carries `legacyRiskAuthority`; cards renamed "Legacy High-Risk Agent / AI System Labels", "Legacy Risk Label Distribution", top-gap badges labelled |
| Reports (`repositories/reports.ts`, PDF `services/reports.ts`) | `legacyRiskAuthority` on agents / systems; every PDF risk heading, row, table column and recommendation labelled; "classified as high risk" wording removed |
| Search | agent / system results carry `risk_level_authority`; labelled badge |
| Knowledge-graph overlay (`services/knowledge-graph.ts`, `ReactFlowGraph`) | nodes carry `risk_level_authority`; legacy-risk-inferred `affects` / `relates_to` edges carry `{ basis: LEGACY_RISK_LABEL, authority }`; labelled badge |
| Agents API (`GET /api/agents`, `?risk=`) | response carries `legacyRiskAuthority`, `legacyRiskFields`, `legacyRiskFilter` |
| Talk-to-governance | answers say "legacy risk label (LEGACY / NON-AUTHORITATIVE)"; the empty answer states governed risk is UNKNOWN (no "no high-risk agents") |
| Discovery page / review API, AgentForm | labelled badge / `legacyRiskAuthority` / labelled form fields |

No M17 / L15 code reads `agents.risk_level`, `ai_act_risk_class`, `risk_entries`, `risk_treatments`,
`agent_risk_propagation`, `evidence.risk_refs` or `ai_systems` residual-risk fields (static scan in the S0 tests).

## L15 root contracts (`packages/canonical-contracts/src/l15-risk-intelligence.ts`)

Closed V1 vocabularies matching the frozen ADR exactly (types + pure mappings, no persistence): the 8 L15 permissions,
`AUTHORITY_POLICY_PERMISSIONS` (23), the 6 L15 governance subjects, `GOVERNANCE_ENVELOPE_SUBJECT_KINDS` (17), the
non-authoritative store kinds RISK_SIGNAL / RISK_HYPOTHESIS, the four L15 fact families, the two registries, the subject ×
action → permission mapping (`l15PermissionFor`, mirror of the DB function), the 24 reason codes, the 2 ADMIT command kinds;
§11 vocabularies (9 risk domains, 10 signal kinds with their only admissible source class, 5 signal source classes, 4 signal
trust states — never VALIDATED, 5 hypothesis generator kinds, hypothesis disposition projection, governed state kinds,
assessment basis / outcome, rating bands, treatment option / implementation status, closure reasons, treatment revocation
reasons, lifecycle / residual-eligibility / conflict / support-currency projections, methodology scale 2..7); the §8.2 legal
subject kinds and the closed domain × subject matrix (70 legal pairs); the §9.1 support target union and the acyclic §9.2
owner → target matrix. `L14AuthorityPolicyRule.permission` is typed as the 23-tag vocabulary; the governance-review TS mirror
(`validateAuthorityPolicyRule`) accepts exactly the 23 and mirrors the L15 registry-scope rule. `L14_PERMISSIONS` (15) and
`L14_PROPOSAL_SUBJECT_KINDS` (11) are unchanged.

## Tests

| Suite | Result (local) |
|---|---|
| Focused **M17-S0 PG17** `apps/dashboard/tests/postgres-m16/m17-s0-authority-extension.test.ts` | **18 / 18 PASS** |
| Full **M16 PG17** suite `tests/postgres-m16/*.test.ts` (incl. the S0 suite) | **1199 / 1199 PASS** (1181 pre-existing + 18 S0) |
| **M15** PostgreSQL regression `tests/postgres/*.test.ts` | **8 / 8 PASS** |
| `@council/canonical-contracts` (`npm test`, incl. new `l15-risk-intelligence.test.mjs`, 11 tests) + `tsc --noEmit` | **243 / 243 PASS**; typecheck clean |
| `@council/governance-review` (`npm test`) + `tsc --noEmit` | **412 / 412 PASS**; typecheck clean |
| Dashboard unit (`npm test`: main + passport-ui + pre-demo-ui + new `test:m17-s0-legacy`) incl. new `m17-s0-authority-contract.test.ts` | **1238 PASS / 0 FAIL / 5 skipped (pre-existing skips)** + passport-ui 17 / 17 + pre-demo-ui 8 / 8 + m17-s0-legacy 12 / 12 |
| Dashboard `tsc --noEmit -p apps/dashboard/tsconfig.json` | clean |

The baseline full M16 PG17 suite on unmodified `main` (`931d2d5`) was run first in the same environment: 1181 / 1181 PASS.
**No existing M16 or M15 test was edited.** The M16 suites run on their own historical horizons (the S0 migration is applied
only by the new `M17S0` horizon), so no frozen-list assertion needed the permitted D-01 vocabulary edit. Harness changes are
additive only: the `m17S0AuthorityExtensionMigration` constant and the `M17S0` horizon (= `M16RP` + the S0 migration).

S0 PG17 suite coverage (real RPCs for every M16 write; owner-made envelope rows inside never-persisted transactions stand in
for the future L15 RPCs):

1. preflight refuses a pre-existing `l15_*` object and changes nothing;
2. row-hash preservation of every pre-existing M16 envelope + typed row, legacy risk rows, agent risk values and agent columns
   across the migration (real history: AP bootstrap, CONTROL_DEFINITION registry, CONTROL_APPLICABILITY, CONTROL_ASSESSMENT
   VALIDATE / REVOKE / REJECT / DENY);
3. exact widened vocabularies (23 / 17 / 68 with exactly 24 new / 11 with exactly 2 new); the reason rule unchanged;
4. only the 10 amendment constraints changed and only 5 constraints added; `l14_fact_states` (5 families),
   `l14_registry_states`, `l14_support_links` and every M16 typed constraint byte-identical; 11 kinds / 12 types; actions /
   sources / dispositions / scope tags byte-identical; no WAIVED; F2 untouched; no L15 bootstrap routine; no L15 store;
5. existing L14 behaviour after widening (VALIDATE, durable DENY + replay, REJECT on the M16 fixture);
6. no L15 rule → NO_MATCHING_AUTHORITY_RULE for every L15 permission, including the wildcard legacy `GOVERNANCE_ADMIN` role;
7. first-policy bootstrap rejects each of the 8 L15 permissions with nothing written; bootstrap still works without them and its
   grant snapshot is L14-only; a SYSTEM_BOOTSTRAP L15 snapshot is refused;
8. unknown / non-governance permissions (`L15_RISK_SIGNAL_VALIDATE`, `L15_RISK_HYPOTHESIS_VALIDATE`, `L15_GOVERNED_RISK_ADMIT`,
   …), wrong action pairing and non-local L15 registry scope fail closed in the parser; an L15 rule cannot be written into the
   bootstrap-admitted version at the table level;
9. one Authority Policy identity per organisation; the L15 rules enter only a normal successor (admitted under the effective
   policy, validated with `L14_AUTHORITY_POLICY_ADMIN`);
10. the table refuses a non-local L15 registry rule;
11. L14 ↔ L15 isolation on the effective policy (each L15 permission only its own action / typed scope; L14 roles never hold an
    L15 permission; L15 roles never hold an L14 permission); self-validation fail-closed unless the rule allows it; unknown
    permission / action fail closed; unknown temporal class raises; closed DB mapping;
12. the envelope admits each L15 subject only in its closed shape (positive controls for REJECT / DEFER / ADMIT / relationship
    target, never persisted); RISK_SIGNAL / RISK_HYPOTHESIS / unknown subjects rejected on proposals / decisions / results and
    as fact subjects; L15 subjects never enter `l14_fact_states`; free-form and mismatched reason codes, wrong command kinds,
    the deferred VALIDATED result, illegal targets rejected;
13. an L15 ALLOW is impossible without the mapped L15 rule: no snapshot, an L14 permission, another subject's permission, a wrong
    action, an L14 subject with an L15 rule, a bootstrap basis, a suspended actor, a deactivated organisation (both changed
    inside the committing transaction) and a cross-tenant actor all fail closed;
14. service_role: no privilege on any envelope table, no EXECUTE on the L15 / parser / evaluator routines, the shared proposal RPC
    refuses an L15 subject, a forged / cross-tenant principal never reaches authorization — zero L15 rows;
15. D-05: every application role lacks INSERT / UPDATE / DELETE / TRUNCATE (and column writes) on both legacy stores; actual
    writes, the cascade path and inserts are refused; reads still work; history unchanged; a re-granted privilege is detected;
16. L15 ACL harness profile (`tests/helpers/m17-l15-security-profile.ts`) clean, the 4 S0 routines owner-only INVOKER with a
    pinned path, and one rolled-back negative control detected per class: table privilege × 8 (incl. MAINTAIN), column
    privilege, PUBLIC grant, sequence privilege, inherited default grant (the broad `20260818013113` defaults), uninventoried
    definer, application EXECUTE, unpinned search_path, missing immutability, cascading FK, inheritance; a hardened probe
    passes; the definer surface stays 45;
17. the widened envelope history still refuses UPDATE / TRUNCATE for the owner.

Application tests (`tests/m17-s0-legacy-compatibility.test.ts`, 12): D-12 integration run of the real scan route with the
**real scanner** over the committed golden fixture repository `04-mcp-not-agent` (zero table writes, zero heuristic risk keys in
any ledger payload); static scan of every scanner / discovery path; one test per legacy consumer; static "no L15 code reads a
legacy risk surface". `tests/m17-s0-authority-contract.test.ts` (4): TS mirror of the 23-tag vocabulary, static migration
acceptance (additive, no store / definer / row write, every dropped constraint re-added, exact D-05 REVOKEs), Passport 16
families with no risk family.

## Acceptance criteria at S0

| Criterion | S0 status | Proof / dependency |
|---|---|---|
| O01 | **PASS** | 11 kinds / 12 types byte-identical, no RISK value (PG17 #4, contract tests) |
| O02 | **PASS (S0 migration)** | static scan: no canonical_relationships DDL/DML, no relationship_state_id uniqueness; no trigger on F2. Re-checked by every later slice. |
| O03 | **PASS (S0 portion)** | Passport family list = 16, no risk family. "status identical with / without L15 data" → **dependency-deferred to S7** (no L15 data / overlay exists). |
| O04 | **PARTIAL — contract only** | 9-domain vocabulary + negative values in canonical-contracts. The DB domain CHECK belongs to the scenario-definition store → **S2**. |
| O05 | **PARTIAL — contract only** | exactly four L15 fact families in contracts; catalog check over L15 state tables → **S3–S6** (no L15 state table may be created in S0). |
| O06 | **PARTIAL — contract only** | every §11 vocabulary closed in contracts; DB CHECK per vocabulary + 14 negative cases → owning slices **S1–S7**. |
| O07 | **PASS** | five M16 families; WAIVED absent; M16 history row-hash identical across the migration (re-run across each later slice). |
| O53 | **PASS (S0 framework)** | isolation proven on the effective policy evaluator + DB guards; end-to-end per L15 RPC → S2 / S3–S6. |
| O54 | **PASS** | unknown permission / action / scope fail closed (parser, evaluator, mapping); wildcard legacy role never expands L15. |
| O55 | **PASS (S0 framework)** | no L15 rule ⇒ NO_MATCHING_AUTHORITY_RULE for every L15 permission; no L15 ALLOW possible. "Durable DENY of each L15 decision" needs the L15 decide RPCs → **S2 / S3–S6**. |
| O56 | **PASS (S0 framework)** | self-validation fail-closed unless the rule allows it (evaluator on the L15 rule); per-RPC → S2+. |
| O57 | **PARTIAL** | DB guard fails an L15 ALLOW whose actor / organisation changes inside the committing transaction; the M16 transactional eligibility helper is reused unchanged. Concurrency harness on a real L15 commit → **S2 / S3** (no L15 commit RPC exists in S0). |
| O58 | **PARTIAL** | `l14_session_basis_v1` unchanged; a forged / cross-tenant principal never reaches authorization. "All L15 RPCs derive tenant / actor" → **S1–S6**. |
| O59 | **PASS (vacuous in S0) + harness** | no L15 table exists; the profile proves zero privileges and will gate every later slice. |
| O60 | **PASS** | one rolled-back negative control per privilege class detected by the L15 ACL checker. |
| O61 | **PASS (framework)** | no L15 definer exists; the checker fails on an uninventoried definer; the 45-routine inventory is re-asserted. |
| O62 | **PARTIAL — framework** | checker detects missing immutability / cascade; L15 history tables → **S1–S6**. |
| O73 | **PASS** | exact 23 / 17 vocabularies; RISK_SIGNAL / RISK_HYPOTHESIS rejected on all four tables. |
| O74 | **PASS** | `l14_fact_states` five families; registry / support-link / M16 typed constraint definitions byte-identical. |
| O75 | **PASS (envelope portion)** | exactly 24 L15 codes from the unchanged rule; unknown / mismatched codes rejected. `closure_reason` / `treatment_revocation_reason` are closed in contracts; their DB CHECKs belong to the GOVERNED_RISK / TREATMENT stores → **S3 / S5**. |
| O76 | **PASS** | actions / sources / dispositions / scope tags / trust byte-identical; bootstrap rejects every L15 subject and permission; no L15 bootstrap routine. |
| O77 | **PASS** | every pre-existing AP / rule / authz / proposal / decision / result / fact row byte-identical; L14 behaviour identical on the M16 fixture; full M16 PG17 suite green. |
| O78 | **PASS (S0 portion)** | one Authority Policy identity per organisation; L15 rules in a successor of the same policy; the ALLOW guard binds any L15 decision to that policy's basis. "Every L15 authorization decision snapshots …" re-proven with real decisions in S2+. |
| O85 | **PASS** | static scan + integration run on a golden fixture repository: zero agents rows, zero heuristic / default risk values, no `risk_level` in ledger payloads. |
| O86 | **PASS** | agent risk values, ledger rows and agent column / default / NOT NULL definitions byte-identical. |
| O87 | **PASS** | one test per consumer (agents list / detail, dashboard aggregates, reports, search, knowledge-graph overlay, agents API filter, + talk / discovery / form). |
| O88 | **PARTIAL** | static scan: no L15 code reads a legacy risk surface. "Seeding legacy values yields zero L15 signals / hypotheses / states / overlay entries" needs those stores → **S1 / S3 / S7**. |
| O89 | **PASS** | no application INSERT / UPDATE / DELETE / TRUNCATE on `risk_entries` / `risk_treatments` after all migrations; rows byte-identical. |
| O90 | **PASS (S0 framework)** | service_role holds no envelope privilege; an L15 ALLOW without a verified ACTIVE human + mapped L15 rule is structurally impossible. Per-RPC durable DENY → S2+. |
| O91 | **PASS (local; CI arbiter pending)** | M15 regression + full M16 PG17 suite; **no** existing test line edited. |

Not owned by S0 and not claimed: O08–O52, O63–O72, O79–O84 (S1–S7).

## Findings / deferred by dependency

- **F-S0-1 (dependency-deferred, amendment §4 command-result row):** the L15 `DECIDE_PROPOSAL VALIDATED / REVOKED` result
  branch must reference an L15 state id. No L15 state store exists in S0 and none may be created early, so the S0 shape branch
  admits every FK-less L15 outcome and rejects VALIDATED / REVOKED. The state-id reference (column + composite FK + branch)
  lands with the first L15 state store (**S2** registries, then S3–S6).
- **F-S0-2:** O04 / O05 / O06 / O62 / O75 (L15-field part) DB CHECKs belong to the stores that own those columns (S1–S7); the
  vocabularies are frozen in `canonical-contracts` now.
- **F-S0-3:** O55 / O56 / O57 / O58 / O78 / O90 are proven at the S0 framework level (policy evaluator, envelope guards,
  verified-principal gate); each L15 RPC slice must re-prove them end-to-end and run the L15 ACL profile.
- **F-S0-4 (observation, out of D-12 scope):** `services/coding-memory.ts` still writes the scanner's heuristic
  `riskLevel` into coding-memory chunk text / metadata (derived retrieval memory, not `agents` or the ledger). It is not an
  authority surface and M17 never reads it; recommended for labelling or removal alongside the S1 scanner adapter.
- **F-S0-5 (environment):** the PGDG apt repository is not reachable from this environment; PG17 server binaries came from the
  npm `@embedded-postgres` package and `psql` is the 16 client. CI (real PGDG PG17 + pgvector) is the arbiter.

## Invariants

M16 exactly five fact families; no sixth family; no L15 bootstrap; one Authority Policy identity per organisation;
11 CanonicalObjectKinds; 12 GovernedRelationshipTypes; F2 untouched; Passport exactly 16 families; trust vocabulary unchanged;
application SECURITY DEFINER surface 45 (unchanged); service_role has no direct L14 table privilege.

## Next gate

ACP review of M17-S0 on the pushed branch (CI on the exact final HEAD), then PR / merge. **S1 NOT STARTED.**
