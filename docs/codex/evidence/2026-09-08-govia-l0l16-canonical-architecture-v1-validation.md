# Gov IA Requirements Baseline & Roadmap Freeze V1 — Validation Evidence

## Starting state

- Starting SHA (authoritative main): `b663db462d0bdfeabcdb0402148c8459de914d94`
- Branch: `docs/govia-l0l16-canonical-architecture-v1`
- Local main == origin/main == starting SHA, no tracked changes prior to
  this work. Only allowed untracked item present: `codex-recovery-6101-6240.txt`
  (never touched, read, staged, or modified).

## Architecture identifier

- ID: `GOVIA-L0L16-CIA-v1.0`
- Short name: GOV IA CIA L0–L16 v1.0
- Status: FROZEN BASELINE
- Baseline date: 2026-09-08

## Documents inspected

- `docs/codex/evidence/*.md` (all files, dated 2026-09-01 through 2026-09-07)
  — validation evidence for prior closed milestones.
- `packages/canonical-contracts/src/contracts.ts` and
  `contracts.type-test.ts` — closed canonical object-kind and relationship
  taxonomy, machine authority ceiling (`OBJECT_SOURCE_MAPPING_STATUS.PROPOSED`),
  evidence/provenance primitives.
- `supabase/migrations/20260906120000_canonical_materialization_v1.sql`,
  `supabase/migrations/20260907120000_discovery_governance_input_persistence_v1.sql`
  — confirmed no embedding/vector columns exist yet (L7 not implemented).
- `apps/dashboard/` directory structure — confirmed active GraphOS surface
  at `apps/dashboard/components/graph`, distinct from the legacy prototype.
- `graphos-complete/src/graphos/ROADMAP.md` — historical prototype roadmap,
  classified HISTORICAL in the drift register.
- `TRACEABILITY_MATRIX.md` — regulatory control mapping (CG-AG-001…012 vs.
  EU AI Act / DORA / ISO 42001 / NIST AI RMF / ISO 27001), classified
  CURRENT / IMPLEMENTATION-SPECIFIC.
- `packages/scanner/` top-level structure — confirmed discovery/codeguard/
  connectors/core layout consistent with "Discovery" milestones referenced
  in the closed-milestone list; not re-audited in depth per scope
  instructions.

## Canonical decisions frozen

All decisions in section 5 through 12 of the operator instructions were
transcribed verbatim (with no substantive rewording of frozen vocabulary or
taxonomy) into:

- `docs/architecture/GOVIA-L0L16-CIA-v1.0.md`
- `docs/architecture/GOVIA-L0L16-CIA-v1.0-roadmap.md`
- `docs/architecture/GOVIA-L0L16-CIA-v1.0-coverage.md`
- `docs/architecture/ADR-GOVIA-L0L16-CIA-v1.0.md`

## L0–L16 map

Frozen exactly as specified (L0 Source & Acquisition through L16 Drift &
Change Intelligence). See
`docs/architecture/GOVIA-L0L16-CIA-v1.0.md` §1.

## Passport map

16 governed metadata families frozen exactly as specified; Risk Intelligence
declared transversal, no 17th family created. See
`docs/architecture/GOVIA-L0L16-CIA-v1.0.md` §4.

## Lineage decision

Frozen as a first-class architectural axis with DataElement grain =
column/field/nested path where technically supported. See
`docs/architecture/GOVIA-L0L16-CIA-v1.0.md` §6.

## Vector decision

Frozen as L7, derived analytical state, never canonical identity;
pgvector/Postgres-first preferred direction; not yet implemented (confirmed
via migration inspection — no embedding/vector columns exist). See coverage
matrix, L7 row.

## Canonical / Graph / Vector / LLM separation

Frozen exactly as specified: PostgreSQL/Supabase is system of record;
GraphOS is a projection, not SoR; Vector is derived semantic state; LLM
produces explanations/analysis/proposals but never canonical truth. See
`docs/architecture/GOVIA-L0L16-CIA-v1.0.md` §7.

## Trust vocabulary

INFERRED / DECLARED / IMPORTED / OBSERVED / VALIDATED frozen with no
competing synonyms and no automatic confidence-based promotion. See
`docs/architecture/GOVIA-L0L16-CIA-v1.0.md` §3.

## AGENT / AGENT_VERSION rule

Frozen: AGENT = stable logical identity; AGENT_VERSION = temporal/versioned
technical state; behavior bindings source from AGENT_VERSION. Cross-checked
against `packages/canonical-contracts/src/contracts.ts` —
`RELATIONSHIP_ENDPOINT_RULES` confirms `USES_MODEL`, `USES_TOOL`, `USES_MCP`,
`HANDOFF_TO`, `READS_FROM`, `WRITES_TO` all source from `AGENT_VERSION`,
matching the frozen baseline exactly. No contradiction found.

## Relationship taxonomy

Cross-checked `GOVERNED_RELATIONSHIP_TYPE` in
`packages/canonical-contracts/src/contracts.ts:1623-1636`: 12 types
(`USES_MODEL`, `USES_TOOL`, `USES_MCP`, `INVOKES`, `USES_PROMPT`,
`USES_KNOWLEDGE_BASE`, `USES_SKILL`, `EXPOSES`, `HANDOFF_TO`, `READS_FROM`,
`WRITES_TO`, `DERIVED_FROM`) — exact match to the frozen baseline taxonomy
in section 9 of the operator instructions. No architectural divergence
found; no ADR-triggering contradiction encountered.

## Drift register

8 entries (A–H) recorded in
`docs/architecture/GOVIA-L0L16-CIA-v1.0-coverage.md` §4, covering historical
shorthand diagrams, "Discovery as source of truth" phrasing, open graph
vocabulary, `CONTAINS` promotion, speculative persistence technologies,
Vector technology direction, the `graphos-complete/` legacy prototype, and
`TRACEABILITY_MATRIX.md` classification. No historical document deleted.

## Roadmap

23 milestones (0–22) frozen in dependency order exactly as specified in
`docs/architecture/GOVIA-L0L16-CIA-v1.0-roadmap.md`. Next development
milestone identified as **1. GOLDEN REPOSITORIES & DISCOVERY BASELINE V2**,
followed by **2. AGENT IDENTITY & VERSION DISCOVERY V1**.

## Implementation gap matrix

Full L0–L16 layer coverage and Agent Passport 360 family coverage recorded
in `docs/architecture/GOVIA-L0L16-CIA-v1.0-coverage.md` §1–§2, classified
IMPLEMENTED / PARTIAL / NOT_IMPLEMENTED / FOUNDATIONAL_ONLY based on current
merged code and prior evidence only — no completion inferred from
architecture or planning documents. All "known facts to preserve" from the
operator instructions (§13) were verified consistent with current code and
retained verbatim in §3 of the coverage document.

## Review result

Document quality gate (20-point checklist, operator instructions §19)
performed once against the four authored documents. All 20 points verified
pass. No contradiction was found between the frozen baseline and the
current APPROVED canonical contracts (`packages/canonical-contracts`) — the
relationship taxonomy, object kinds, and machine authority ceiling in code
match the frozen baseline exactly, so no `STOP_REQUIRES_ARCHITECTURE_DECISION`
condition was triggered.

## Validation

- `git diff --check` — clean, no whitespace errors.
- `git status` — only `docs/architecture/*` (4 new files) added; pre-existing
  untracked `codex-recovery-6101-6240.txt` untouched; no tracked files
  modified.
- No markdown lint tooling configured in this repository (no
  `.markdownlint*` config found) — skipped per validation scope.
- No Supabase access performed. No migrations run. No production build
  required or performed (documentation-only change with no compiled
  reference index affected).

## Production status

No code, contracts, migrations, or deployment surfaces were touched. Gov IA
production status is unchanged by this milestone.
