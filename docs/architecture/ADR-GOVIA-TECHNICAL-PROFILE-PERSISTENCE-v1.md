# ADR: Technical Profile Persistence V1

**STATUS:** ACCEPTED

**Architecture ID this ADR extends:** `GOVIA-L0L16-CIA-v1.0` (FROZEN BASELINE — this ADR is additive and does not modify that document, `ADR-GOVIA-L0L16-CIA-v1.0.md`, the roadmap, the coverage matrix, or the implementation-conformance/reuse-register audits).

**Date:** 2026-09-08

---

## Context

Roadmap milestone 3 (Agent Technical Profile — L4 Round 1) discovered evidence-backed AgentVersion technical-profile facts (Framework/SDK, a Prompt's content fingerprint, and others across sibling canonical-object kinds) but found that **no persistence exists anywhere in the repository for any of the eight frozen `*TechnicalProfile` contracts** (`AgentVersionTechnicalProfile`, `ModelTechnicalProfile`, `ToolTechnicalProfile`, `McpServerTechnicalProfile`, `ApiTechnicalProfile`, `PromptTechnicalProfile`, `KnowledgeBaseTechnicalProfile`, `SkillTechnicalProfile` — all in `packages/canonical-contracts/src/contracts.ts`). `gov_repo.canonical_objects` intentionally carries identity only, by explicit prior design (see its own migration comment, `20260906120000_canonical_materialization_v1.sql`).

Implementing persistence for these contracts requires choosing a schema shape. Two candidate shapes were considered:

1. **A shared table with a JSONB/EAV-style value payload per field.** Directly forbidden: `GOVIA-L0L16-CIA-v1.0.md` §4 states *"Generic JSON/EAV never replaces modeled enterprise semantics."*
2. **One normalized, typed table per canonical-object kind**, with a parallel, strongly relational (non-JSON) representation for per-field evidence support. Architecturally correct and consistent with the frozen invariant, but had zero precedent anywhere in this repository's migration history before this ADR.

This is a genuine architecture decision (not an implementation detail), which is why milestone 3's first pass correctly returned `STOP_REQUIRES_ARCHITECTURE_DECISION` rather than inventing a schema unilaterally. This ADR resolves that decision.

## Decision

**TECHNICAL PROFILE PERSISTENCE V1** is adopted:

### A. Typed per-kind persistence

Technical-profile semantic values are persisted in normalized, typed persistence specific to each canonical-object kind. Forbidden, permanently: generic JSONB technical-profile payloads; generic value-carrying EAV; `field_name`/`value` profile stores; stuffing mutable profile semantics into `canonical_objects` identity rows.

**CANONICAL IDENTITY (`gov_repo.canonical_objects`) != CANONICAL TECHNICAL PROFILE.** A profile row is a governed projection associated with a canonical object; it never mutates or supersedes that object's own identity row.

### B. Global pattern, incremental implementation

This persistence pattern applies to all eight frozen `*TechnicalProfile` contracts. **Milestone 3 / PR #24 implements only `AgentVersionTechnicalProfile`** as the first instance of the pattern — see `20260908120000_agent_version_technical_profile_persistence_v1.sql`. This is not an AgentVersion-specific exception: `ModelTechnicalProfile`, `ToolTechnicalProfile`, `McpServerTechnicalProfile`, `ApiTechnicalProfile`, `PromptTechnicalProfile`, `KnowledgeBaseTechnicalProfile`, and `SkillTechnicalProfile` are **not implemented by this ADR or this migration** and must follow this same pattern (one normalized table + one field-support pair + one pre-canonical proposal stage + one narrow materialization RPC) only when their own roadmap milestones require them. Do not claim any sibling profile is implemented until its own migration exists.

### C. Pre-canonical profile proposal required

Scanner Discovery never writes directly to canonical profile persistence. Lifecycle:

```
Discovery Evidence
→ TechnicalProfileSignal / typed object evidence
→ typed AgentVersionTechnicalProfile proposal (durable, pre-canonical)
→ governed AgentVersion review/certification
→ reconciliation
→ canonical AGENT_VERSION materialization
→ governed AgentVersionTechnicalProfile materialization
```

A durable, typed, pre-canonical proposal representation (`gov_repo.agent_version_technical_profile_proposals`) exists so semantic profile values are never reconstructed by re-parsing raw evidence at materialization time.

### D. Typed proposal and typed canonical profile

Both the proposal table and the canonical `gov_repo.agent_version_technical_profiles` table carry explicit, unrenamed typed columns derived directly from the frozen `AgentVersionTechnicalProfile` contract (`contracts.ts:1104-1112`): `behaviorFingerprint` (flattened to `behavior_fingerprint_algorithm`/`_schema_version`/`_value`, matching `BehaviorFingerprint`'s own three fields exactly), `buildReference`, `runtimeFrameworkReference`, `entrypointReference`, `configurationReference`. No speculative field was added.

### E. Field-level support

Every persisted field preserves its own `assertionIds`/`evidenceIds`, matching `AgentVersionTechnicalProfileSupport` exactly. Support is stored as two strongly relational junction tables (`*_field_assertions`, `*_field_evidence`) keyed by an explicit `field_name` column, **CHECK-constrained to the five frozen field names** (never an arbitrary string), with FK references into the already-durable `gov_repo.source_assertions`/`gov_repo.discovery_evidence` tables. This is provenance, never a semantic value store, and never a generic EAV pattern — it is exactly the same relational shape `gov_repo.discovery_finding_assertions`/`discovery_finding_evidence` already established for `DiscoveryFinding`.

### F. Profile lifecycle

`AgentVersionTechnicalProfile` is a governed projection associated with a canonical `AGENT_VERSION`. Canonical identity remains separate and is never mutated by profile writes. Profile enrichment (stronger provenance, additional evidence, a corrected value) does not, by itself, create a new canonical AgentVersion. A genuine technical/behavioral semantic change continues to be detected upstream, exclusively, as a new `technicalRevisionFingerprint`/AgentVersion by `packages/scanner/src/discovery/agent-version-correlation.ts` — computed before any profile row is ever written.

### G. Materialization authority

Canonical profile materialization (`gov_repo.materialize_agent_version_technical_profile`) may occur only after: the canonical `AGENT_VERSION` object already exists (proof that its own reconciliation/materialization already succeeded); the proposal exists and belongs to the same organisation; and the proposal's own source candidate is actively mapped (`canonical_object_source_mappings`) to that exact canonical target. Scanner Discovery has zero direct canonical-profile write authority — it can only durably record a proposal. No automatic certification. No Discovery → canonical profile write of any kind.

## Consequences

- `AgentVersionTechnicalProfile` now has a real, governed, typed persistence path, incrementally extending the existing Decision-to-Truth pipeline without altering `canonical_objects`/`canonical_relationships`/`materialization_operations` or any historical migration.
- The other seven `*TechnicalProfile` contracts remain unimplemented and must be assessed and scoped individually by their own future milestones, following this exact pattern.
- No relationship taxonomy change. No new `CanonicalObjectKind`. No live Discovery production trigger was added by this ADR or its accompanying migration.

## Related documents

- [`GOVIA-L0L16-CIA-v1.0.md`](./GOVIA-L0L16-CIA-v1.0.md) — frozen baseline, §4 (the "no generic JSON/EAV" invariant this ADR is constrained by).
- `supabase/migrations/20260908120000_agent_version_technical_profile_persistence_v1.sql` — the implementation.
- `docs/codex/evidence/2026-09-08-agent-technical-profile-l4-round1-validation.md` — milestone 3 evidence, including the options analysis that led to this decision.
