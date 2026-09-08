# ADR: Adopt Gov IA L0–L16 Canonical Intelligence Architecture v1.0

**ID:** `GOVIA-L0L16-CIA-v1.0`
**Status:** ACCEPTED / FROZEN BASELINE
**Date:** 2026-09-08

## Context

Architecture had accumulated correct but distributed decisions across
canonical contracts, Discovery, Agent Passport, GraphOS, multivendor design,
lineage, and semantic/vector intelligence, spread across implementation
milestones (Canonical Contracts, Discovery Validation Lab, Discovery Engine
V1, Discovery Relationships V1.1, Discovery Tools V1.2, HITL V1, Authorized
Reconciliation Gate, Canonical Reconciliation Factory, Governance
Persistence V1, Canonical Materialization V1, Discovery Intake V1,
Governance Workspace V1, Discovery Governance Input Persistence V1, Object
Candidate Normalization V1, Reconciliation & Materialization Workspace V1,
Graph Route Release Fix V1).

## Problem

Local milestones risk optimizing for current implementation gaps instead of
converging toward the intended enterprise product architecture. Without a
single frozen reference, future roadmap and milestone decisions could drift
from the approved product direction, redefining architecture implicitly
milestone by milestone.

## Decision

Freeze `GOVIA-L0L16-CIA-v1.0` as the primary architecture baseline for Gov
IA, as recorded in
[`GOVIA-L0L16-CIA-v1.0.md`](./GOVIA-L0L16-CIA-v1.0.md),
[`GOVIA-L0L16-CIA-v1.0-roadmap.md`](./GOVIA-L0L16-CIA-v1.0-roadmap.md), and
[`GOVIA-L0L16-CIA-v1.0-coverage.md`](./GOVIA-L0L16-CIA-v1.0-coverage.md).

This freezes: the L0–L16 canonical model; the cross-cutting invariants;
the trust vocabulary (INFERRED / DECLARED / IMPORTED / OBSERVED /
VALIDATED); the Agent Passport 360 16-family model; the AGENT /
AGENT_VERSION distinction and closed relationship taxonomy; lineage as a
first-class architectural axis; the Canonical / Graph / Vector / LLM
separation of responsibilities; and the multivendor field-specific
authority model.

## Consequences

- Implementation converges toward the architecture; the architecture is not
  rewritten to match current implementation gaps.
- Older diagrams, prompts, or milestone notes that conflict with this
  baseline become historical/superseded (see the drift register in
  [`GOVIA-L0L16-CIA-v1.0-coverage.md`](./GOVIA-L0L16-CIA-v1.0-coverage.md)).
- Any future intentional architectural divergence requires an explicit ADR
  with rationale, impact analysis, and an approved architecture version
  increment.
- The architecture is deliberately richer than current implementation;
  `NOT_IMPLEMENTED` and `PARTIAL` layers are expected and tracked, not
  treated as failures.
- `UNKNOWN` / missing capability is accepted as a valid state everywhere in
  the model. Fabricated semantics to fill a gap are never accepted.
- Future product milestones must declare architecture-mapping fields
  (baseline §9, "Future milestone Definition of Done") before
  implementation begins.

This ADR does not rewrite any historical decision; it records adoption of
the frozen baseline going forward.
