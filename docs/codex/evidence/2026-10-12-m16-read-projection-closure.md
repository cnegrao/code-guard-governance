# M16 — Read-projection closure (O32 / O41 corrective slice)

Starting point: `origin/main` = `18e57b299a9fd7e317f4ba5fe35d1dd26db6dcc9` (the merge of PR #61,
`feat/m16-s1c5-control-assessment`), verified equal to the expected SHA before branching. Repository
`cnegrao/code-guard-governance`. Branch `fix/m16-read-projection-closure` was created from exactly that commit with a clean
worktree. Architecture authority: `docs/architecture/ADR-GOVIA-OWNERSHIP-BUSINESS-POLICY-CONTROL-ENRICHMENT-v1.md` §§3, 7.2,
15, 18.1, 18.2, 20, 22 (O32, O41; also O26, O27, O28, O36, O38, O49). The ADR is **not** modified.

This is a corrective slice for the two conformance blockers found by the formal M16 closure. It is **not** the M16 closure
document and does **not** start M17.

## Recorded state

| Item | State |
|---|---|
| PR #61 / S1C.5 | MERGED (`18e57b2`) |
| `main` baseline at slice start | `18e57b299a9fd7e317f4ba5fe35d1dd26db6dcc9` |
| O32 / O41 corrective slice | IMPLEMENTED ON BRANCH `fix/m16-read-projection-closure`; NOT MERGED; PR NOT OPENED |
| M16 | IN PROGRESS until the corrective PR is merged and the formal closure passes |
| M16 closure document | NOT WRITTEN |
| M17+ | NOT STARTED |
| Hosted | NOT TOUCHED |

## Environments — LOCAL / CI / HOSTED

- **LOCAL**: disposable PostgreSQL **17.10** clusters (server binaries from `@embedded-postgres/linux-x64@17.10.0-beta.17`;
  `psql` is the local PostgreSQL 16 client), passed as `M16_PG17_BIN`, run as an unprivileged OS user; the harness asserts
  `server_version_num` 17.x. pgvector is not installed locally (the harness's labelled stand-in type is used; the one HNSW
  statement is the only statement allowed to fail, asserted exactly). M15 ran on local PostgreSQL 16. Node **24.21.0**.
- **CI**: GitHub Actions `M16 PostgreSQL 17 security suite` (PGDG PostgreSQL 17 + real pgvector) and `M15 PostgreSQL regression`
  on the pushed branch. The exact final branch HEAD CI is the arbiter; it is reported to ACP, not pre-recorded here.
- **HOSTED**: **NOT TOUCHED.** No Supabase hosted project, no Vercel, no deployment, no hosted migration.

## Blockers closed

### O32 / ADR §22 — Passport governed projection

Before: Passport family 3 (Ownership) and family 4 (Business) were hard-coded UNKNOWN, and family 12 (Governance Controls)
rendered the **canonical identity fact** as its only fact — identity used as a proxy for control coverage. Family 14 carried no
M16 lineage.

After:

- **Family 3 — Ownership & Responsibility**: the current valid `RESPONSIBILITY_ASSIGNMENT` facts of the **exact AGENT**
  (S1C.1 bounded current read `l14_responsibility_assignments_current_v1`, which pins and re-checks the Party dependency at the
  same effective + recorded coordinates). Role, GovernanceParty id and the exact pinned Party state are rendered; a missing
  `BUSINESS_OWNER` / `TECHNICAL_OWNER` is listed as UNKNOWN. Never an AGENT_VERSION row (illegal target; the adapter fails
  closed if one ever appeared). No legacy owner field.
- **Family 4 — Business Context**: the current valid `BUSINESS_CONTEXT_ASSIGNMENT` of the exact AGENT, **BUSINESS_DOMAIN only**
  (the one legal AGENT semantic kind; S1C.2 bounded read, Domain dependency re-checked). No legacy `business_domain` string.
  Purpose / description remain UNKNOWN (not governed in M16 V1).
- **Family 12 — Governance Controls**: `POLICY_APPLICABILITY`, `CONTROL_APPLICABILITY` and `CONTROL_ASSESSMENT` of the exact
  AGENT and, **separately**, of the exact selected AGENT_VERSION (S1C.3 / S1C.4 / S1C.5 bounded reads). `DOES_NOT_APPLY` is
  rendered as an explicit governed negative ("not coverage and not UNKNOWN"). An assessment appears only for **exactly** the
  current `APPLIES` applicability state of the same target (never carried across a successor state; expiry at `valid_until`;
  a dependency-invalid applicability removes both). An `APPLIES` control without such an assessment is listed as
  "assessment UNKNOWN". Canonical identity is **no longer** a family-12 fact; with no governed fact the family is UNKNOWN.
  No score / coverage / percentage / risk field exists anywhere in the projection.
- **Family 14 — Provenance & Trust**: every rendered M16 fact carries its exact lineage: fact state (+ predecessor, interval,
  `recorded_at`, trust `VALIDATED`, source class, support status), the deciding proposal, the `VALIDATE` governance decision
  (+ closed reason code), the `ALLOW` authorization decision, the Authority Policy basis, the exact pinned dependency state,
  the normalized support evidence ids of the state / decision / proposal, and the single pair of read coordinates. Evidence
  metadata is loaded only for those linked ids (existing `discovery_evidence` read, metadata only); no source assertion or
  trust is invented (sources stay empty for LOCAL_HUMAN L14 facts).
- **AGENT ↔ AGENT_VERSION**: no inheritance either way. AGENT facts are never copied to the version; version facts appear only
  when that exact version is selected (and the existing exact-association gate still applies).
- **Coordinates**: one DB instant is both the effective and the recorded coordinate of every row of one projection; explicit
  historical coordinates are supported by the RPC (as-of readback) but not exposed by the Passport UI.

### O41 / ADR §18.2 — conflict read projection

A read-only projection over **one exact logical fact key** of one of the five closed families (ADR §3 keys, never collapsed):
RESPONSIBILITY (`target + role + governancePartyId`), BUSINESS_CONTEXT (`target + semantic kind`), POLICY_APPLICABILITY
(`exact target union + policy_id`), CONTROL_APPLICABILITY (`exact target union + control_definition_id`), CONTROL_ASSESSMENT
(`control_applicability_state_id`). Closed outcomes exactly `RESOLVED` | `CONFLICT` | `INSUFFICIENT_EVIDENCE`:

| Outcome | Rule (deterministic, at the requested effective + recorded coordinates) |
|---|---|
| `RESOLVED` | The family's **existing exact resolver** returns the current governed fact (own state + target + every pinned dependency valid at the same coordinates). The `GOVERNED_FACT` row references the fact state, its governance decision and interval. |
| `CONFLICT` | No current governed fact, and the **live** proposals of the exact key carry **≥ 2 distinct typed asserted contents**. Every live proposal is returned (identity, submission time, source class, support status + evidence ids, deferred flag, content digest and typed content), ordered by the opaque proposal id only — never ranked. |
| `INSUFFICIENT_EVIDENCE` | Otherwise (no fact and < 2 distinct typed asserted contents — including no proposal, one proposal, or several proposals that assert identical content). |

Interpretation used (grounded in the frozen ADR / schema; no new semantics, no new vocabulary):

1. **Live proposal** = a typed **VALIDATE-intent** proposal of the exact key with `submitted_at <= recorded cutoff` and no
   terminal governance decision (`VALIDATE` / `REJECT`) with `decided_at <= recorded cutoff` — exactly ADR §7.2 (DEFER is
   non-terminal; VALIDATE / REJECT terminate). REVOKE-intent proposals assert no subject content and are not competitors.
   Correction links (`prior_proposal_id`) are not used to collapse proposals (ADR: competing proposals MUST remain explicit).
2. **Typed asserted subject content** = every typed column of the family's existing proposal table other than the logical key,
   the intent and process metadata (submitter, source, support, prior link): RESPONSIBILITY — pinned Party state + requested
   interval; BUSINESS_CONTEXT — domain id + pinned domain state + requested interval; POLICY_APPLICABILITY — version + content
   hash + pinned PolicyVersion state + APPLIES/DOES_NOT_APPLY + requested interval; CONTROL_APPLICABILITY — control version +
   content hash + pinned CONTROL_DEFINITION state + applicability + requested interval; CONTROL_ASSESSMENT — the mirrored pin +
   assessment outcome + requested effective_from + valid_until. Compared by exact typed equality through a length-framed SHA-256
   digest (`gov_repo.frame_identity`, explicit NULL markers, UTC-normalized instants) — no free-form comparison.
3. **Proposals carry no effective coordinate**: only the recorded cutoff filters them (they are knowledge-time artefacts); the
   effective coordinate applies to the governed-fact resolution (which re-checks dependencies at both coordinates).
4. **Support / confidence / recency / source / submitter never decide**: they are returned, never used to filter, rank or pick.

Absence never fabricates a winner; a later governed decision makes the read `RESOLVED` while every competing proposal row stays
in history (verified). The projection creates no state / head / history and mutates no proposal or decision (verified by a
whole-L14 row digest before / after).

## Read / security boundary

- The existing resolvers / bounded current reads stay **owner-only SECURITY INVOKER** helpers (byte-identical; routine digest
  proven). service_role still has **zero** privilege on every L14 table (direct `SELECT` on each of the 48 L14 tables is
  `permission denied`, tested; postflight P2 enforces it). **No direct authority-table grant was added.**
- Two new postgres-owned SECURITY DEFINER read projections are the only addition:
  `gov_repo.l14_read_passport_governance_v1(...)` and `gov_repo.l14_read_fact_conflict_v1(...)`. Each: `search_path` pinned to
  `pg_catalog, pg_temp`, `lock_timeout=5s`, fully qualified objects, VOLATILE only because the first statement revalidates base
  session eligibility through the canonical `l14_session_basis_v1` (tenant derived ONLY from the verified principal, exactly the
  pattern of the existing `l14_read_policy_descriptors_v1`); EXECUTE revoked from PUBLIC / anon / authenticated / service_role
  then granted to service_role only (ACL exactly `{postgres=X/postgres,service_role=X/postgres}`).
- Bodies are read-only (no INSERT / UPDATE / DELETE / TRUNCATE / MERGE / COPY / dynamic SQL / locks / sequences), read no head
  as truth, no legacy owner / `business_domain` / `cg_*` / `agents` / legacy `control_assessments` surface, no policy content
  store, no directory / profile PII, no score / risk / confidence. Enforced by postflight P3 and by rolled-back negative controls.
- Dashboard: a new server-only adapter `lib/governance/passport-governance-read.ts` calls exactly these two RPCs (and nothing
  else), passes the five verified principal values verbatim, re-validates every row against the closed vocabularies and the
  exact requested targets, and fails closed (never renders UNKNOWN on a projection failure). `getAgentPassport` now takes the
  verified `GovernanceWritePrincipal` (from the same strict cookie verification, `passportPrincipal()`); the conflict reader has
  no route / UI consumer in this slice.

## DB delta

One additive migration: `supabase/migrations/20261012120000_m16_read_projection_closure_v1.sql` (BEGIN … COMMIT).

- **Preflight** (aborts with nothing applied): PostgreSQL 17; the exact post-S1C.5 l14 relation set (48); the reused resolvers
  exist as owner-only postgres SECURITY INVOKER helpers; neither projection exists; the exact 43 approved application definers
  (owner class, body SHA-256, config) and a closed surface of exactly 43.
- **B** `l14_read_passport_governance_v1` · **C** `l14_read_fact_conflict_v1` · **D** REVOKE / GRANT EXECUTE + comments.
- **Postflight**: P1 relation set unchanged (no store); P2 every L14 table + both policy stores: RLS, zero non-owner / column /
  application privilege incl. MAINTAIN, no RLS policy on L14; P3 projection shape (inputs, VOLATILE, definer, owner, config),
  session-first, reused-resolver needles, read-only / no-head / no-legacy / no-score body; P4 l14 routine ACLs — 29 public RPCs,
  every other l14 routine owner-only INVOKER; P5 closed surface **45** approved (owner, body hash, config, EXECUTE exactly
  service_role, no overload), **35** canonical-owner, no projection reaches a policy store; P6 default privileges; P7 no
  view / sequence / inheritance exposure of L14 history; P8 11 canonical kinds, 12 relationship types, **5** fact families;
  P9 F2 boundary.
- No table, column, constraint, index, trigger, view, sequence, type, policy or default ACL is created or changed; no historical
  migration is edited; no reused routine is replaced. Projection body SHA-256:
  `l14_read_passport_governance_v1` = `1d99930bd7569148637d137387410b774c221f48770f1d77a3080004e8ceca47`,
  `l14_read_fact_conflict_v1` = `c63485ed0e6a6be770f12e93a4d8eae010e324b341f214f748eae3e59a5ff9ca`.
- Test harness: new L14 horizon `M16RP` (= S1C5 + this migration); every historical horizon keeps its exact chain and
  expectations.

## Security surface

| Measure | Before (post-S1C.5) | After |
|---|---|---|
| Application SECURITY DEFINER surface | 43 | **45** (+ the two read projections) |
| Canonical-owner (policy-store-capable) class | 33 | **35** (owner capability; neither body reaches a policy store) |
| Public L14 RPCs (service_role EXECUTE) | 27 | **29** |
| service_role privileges on L14 tables | none | **none** |
| L14 relations | 48 | 48 |

ACL suite (`tests/postgres-m16/l14-read-projection-acl.test.ts`, real PG17): 4 preflight breaks each abort atomically with
nothing applied (extra definer; reused resolver granted to service_role; a new l14 relation; projection name taken); live
inventory 45 / 35; exact projection ACL / owner / config / volatility; every pre-existing gov_repo routine, relation and L14 /
canonical_relationships row byte-identical; default ACLs unchanged; actual denied operations for anon / authenticated (EXECUTE)
and service_role (direct SELECT on all 48 L14 tables); **35 rolled-back postflight negative controls**, one per class: PUBLIC /
anon / authenticated EXECUTE, reused resolver EXECUTE, default-privilege reintroduction, extra definer, overload, SECURITY
INVOKER flip, owner / search_path / volatility drift, a write, a legacy owner / `business_domain` read, a `cg_*` read, a head
read, a confidence / recency ranking, a bypassed resolver, a body hash drift, service_role table SELECT / column SELECT / INSERT,
TRUNCATE, REFERENCES, TRIGGER, MAINTAIN, an RLS policy, RLS disabled, readable / writable / PUBLIC view over history, a
sequence leak, inheritance, a second store (new l14 relation), a sixth fact family, and an F2 trigger. Every control is
detected with its specific message; the clean postflight re-passes afterwards.

## Tests

New:

- `apps/dashboard/tests/postgres-m16/l14-read-projection.test.ts` (PG17, 12 subtests) — O32: valid ownership with exact lineage
  and support; Party revocation ⇒ UNKNOWN without history mutation (state rows byte-identical; as-of readback; a re-validated
  Party is not auto-selected); valid business context; Domain revocation ⇒ UNKNOWN; policy APPLIES + explicit DOES_NOT_APPLY;
  PolicyVersion revocation ⇒ UNKNOWN; control applicability + assessment of exactly its APPLIES state; DOES_NOT_APPLY never
  assessed; expiry / supersession / CONTROL_DEFINITION revocation ⇒ no current assessment; canonical identity alone ⇒ zero
  rows; AGENT ↔ AGENT_VERSION no inheritance; foreign tenant and tenant-mismatched session; legacy `agents` owner /
  `business_domain` / `cg_ag_*` values never surface; malformed reads refused; zero authoritative writes. O41: RESOLVED /
  CONFLICT / INSUFFICIENT_EVIDENCE (BUSINESS_CONTEXT); identical content corroborates (no conflict); support / recency / source
  never rank; DEFER stays live; REJECT terminates; bitemporal cutoff; a later decision RESOLVES without deleting history;
  different keys never conflict (RESPONSIBILITY party, POLICY id, target); tenant isolation; shape / vocabulary refusal
  (incl. `CONTROL_FINDING`); POLICY_APPLICABILITY dependency-invalid old fact is never RESOLVED; CONTROL_APPLICABILITY on a
  relationship-state target; CONTROL_ASSESSMENT conflict → RESOLVED → expiry; service_role direct reads / resolver calls denied.
- `apps/dashboard/tests/postgres-m16/l14-read-projection-acl.test.ts` (PG17) — see Security surface.
- `apps/dashboard/tests/l14-read-projection-contract.test.ts` — migration-text invariants (additive, read-only, no table grant,
  grants only to service_role, session first, no head / legacy / score, closed outcomes, proposal-id ordering) and the conflict
  adapter (exact operands, closed contract, fail closed, no route / UI consumer).
- `apps/dashboard/tests/passport-query.test.ts` (+7) — Passport composition: identity alone ⇒ families 3 / 4 / 12 UNKNOWN; governed
  facts with exact lineage and only linked evidence; DOES_NOT_APPLY explicit; exact-state assessment gap; version facts only
  when selected; illegal / foreign / open-vocabulary rows and projection failures fail closed; principal passed verbatim;
  legacy values never used. The DB mock now permits **only** the read projection RPC (every other RPC still throws).
- `apps/dashboard/tests/passport-ui-route.test.ts` (+2) — the page passes the cookie-verified principal; `passportPrincipal()`
  fails closed like `passportOrganisation()`; governed facts render with lineage; the boundary test pins the new read module
  to exactly the two read RPCs.
- `packages/canonical-contracts/test/contracts.test.mjs` (+2) — closed conflict outcomes never extend trust / applicability;
  Passport targets; still five fact families.

Adjusted (not weakened): `l14-policy-store-contract.test.ts` closed `l14-*` contract-file inventory gains
`l14-read-projection.ts` (its content checks apply to it unchanged); `passport-query.test.ts` call sites pass a verified
principal instead of a bare organisation id.

Local development runs (Node 24.21.0; development evidence only — the final exact-HEAD branch CI is the arbiter):

| Suite | Result |
|---|---|
| Targeted O32 / O41 PG17 (`l14-read-projection.test.ts`) | 12 / 12 pass |
| Targeted ACL PG17 (`l14-read-projection-acl.test.ts`) | 4 / 4 pass (35 negative controls) |
| Full M16 PG17 (`tests/postgres-m16/*.test.ts`, 77 files) | running at commit time; result recorded in a follow-up commit |
| M15 PostgreSQL regression (PG16) | 8 / 8 pass |
| Dashboard (`npm test`) | 1234 pass / 0 fail (+ passport-ui 17 / 17, pre-demo-ui 8 / 8) |
| canonical-contracts | 232 / 232 pass |
| governance-review | 412 / 412 pass |
| Typecheck: dashboard, scanner, graphos-pkg, canonical-contracts, governance-review | clean |
| `git diff --check` / secret scan | clean / no match |

## F2 / vocabularies

- F2 untouched: no `canonical_relationships` DDL / DML / FK / trigger / index; relationship-state targets are resolved only
  through the existing exact triple resolver inside the reused S1C.3 / S1C.4 resolvers. P9 + a negative control enforce it.
- Exactly 11 canonical object kinds, 12 governed relationship types, **5** fact families (P8; a sixth-family negative control
  is detected). No new trust, applicability, assessment, party, domain or reason-code value. `RESOLVED | CONFLICT |
  INSUFFICIENT_EVIDENCE` is a read-only vocabulary, never stored (the token `INSUFFICIENT_EVIDENCE` already exists as an
  assessment outcome in a different, unchanged vocabulary; the two are never mixed).
- No LLM / scanner / confidence promotion; no evidence invented; no score / coverage / risk; M17 not started.

## Findings

1. **O41 interpretation (for ACP review)** — §18.2 does not define "live" or "materially different". The slice uses the
   ADR §7.2 terminal-decision rule for liveness and exact typed equality over the full typed proposal content (incl. the pinned
   dependency state and the requested interval) for material difference. Consequence: two proposals asserting the same domain
   but different requested intervals, or pinned to different states of the same domain, are a CONFLICT. Support status is never
   a criterion (a CONFLICT may consist of unsupported proposals; support is shown, not weighed). If ACP wants a narrower
   materiality set, that is an ADR-level decision, not an implementation guess.
2. **Passport UNKNOWN on projection failure is not silent**: an eligibility failure (e.g. GV003 inactive user) or any projection
   error fails the whole Passport read closed instead of rendering families 3 / 4 / 12 as UNKNOWN.
3. **Family 12 scope**: object targets AGENT and the selected AGENT_VERSION only. Applicability on relationship-state targets
   (e.g. the version's READS_FROM state) is not rendered in Passport in this slice (it remains readable through the conflict
   projection and the governed reads).
4. **Pre-existing, unrelated**: `npm run typecheck:graphos` fails on `main` (153 errors in `graphos-complete/**` and the
   `.ts`-extension imports of `packages/canonical-contracts/src/index.ts` under that tsconfig); this slice adds one identical-
   pattern export line (154). Not a CI gate; not fixed here.
5. **ADR §3 CONTROL_FINDING detail** remains unimplemented (as recorded in S1C.5); not in scope.

## Files changed

- `supabase/migrations/20261012120000_m16_read_projection_closure_v1.sql` (new)
- `packages/canonical-contracts/src/l14-read-projection.ts` (new), `packages/canonical-contracts/src/index.ts`,
  `packages/canonical-contracts/test/contracts.test.mjs`
- `apps/dashboard/lib/governance/passport-governance-read.ts` (new), `passport-query.ts`, `agent-passport.ts`,
  `passport-session.ts`; `apps/dashboard/app/(dashboard)/agents/canonical/[canonicalObjectId]/page.tsx`;
  `apps/dashboard/components/agents/AgentPassport.tsx`
- Tests: `apps/dashboard/tests/postgres-m16/l14-read-projection.test.ts` (new), `l14-read-projection-acl.test.ts` (new),
  `apps/dashboard/tests/l14-read-projection-contract.test.ts` (new), `apps/dashboard/tests/helpers/m16-l14-read-projection-fixtures.ts`
  (new), `apps/dashboard/tests/helpers/disposable-m16-postgres.ts`, `apps/dashboard/tests/helpers/m16-l14-fixtures.ts`,
  `apps/dashboard/tests/passport-query.test.ts`, `apps/dashboard/tests/passport-ui-route.test.ts`,
  `apps/dashboard/tests/l14-policy-store-contract.test.ts`
- Docs: this evidence; `docs/architecture/GOVIA-L0L16-CIA-v1.0-roadmap.md` (state only)

## Next gate

ACP review of this branch on its exact final HEAD CI (M16 PG17 security suite + M15 regression). On approval: open the corrective
PR, merge, then re-run the formal M16 closure (O01–O55) and only then write the M16 closure document. M17 stays NOT STARTED.
