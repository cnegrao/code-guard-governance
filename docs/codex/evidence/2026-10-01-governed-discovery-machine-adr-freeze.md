# Governed Discovery Machine Execution Boundary — Architecture Freeze Evidence

**Evidence class: ARCHITECTURE FREEZE ONLY.** This record is not runtime,
implementation, test, deployment or hosted validation evidence.

| Item | Value |
|---|---|
| Architecture identifier | `ADR-GOVIA-GOVERNED-DISCOVERY-MACHINE-EXECUTION-BOUNDARY-v1` |
| ADR | [docs/architecture/ADR-GOVIA-GOVERNED-DISCOVERY-MACHINE-EXECUTION-BOUNDARY-v1.md](../../architecture/ADR-GOVIA-GOVERNED-DISCOVERY-MACHINE-EXECUTION-BOUNDARY-v1.md) |
| Architectural baseline | `GOVIA-L0L16-CIA-v1.0`, unchanged |
| Repository / branch | `cnegrao/code-guard-governance` / `feat/m16-s1b-governed-registries` |
| Baseline HEAD | `7170131a73293e8b3b89ec4f8765ac7c9ca65b66` (uncommitted working tree) |
| Date / architecture owner approval | 2026-10-01 |
| Final ADR status | **ACCEPTED / FROZEN** |

## Review sequence

1. Initial architecture review: `GOVERNED DISCOVERY MACHINE BOUNDARY: READY_FOR_ADR`.
2. Machine principal / transport decision: `MACHINE EXECUTION PRINCIPAL: READY_FOR_ADR`.
3. ADR materialization: PROPOSED / PENDING INDEPENDENT REVIEW.
4. Independent adversarial review: **PASS_WITH_CORRECTIVES**.
   Material findings: H-1 (binding identity), H-2 (administration authority /
   default table privileges), M-1 (credential-generation identity), M-2 (pooler /
   session-local state), M-3 (source connection identity), M-4 (source/evidence
   trust residual); plus LOW L-1..L-4 and O-3.
5. Corrective revision of the ADR: completed for all material and LOW findings,
   with corrective acceptance gates C01–C20.
6. Independent corrective re-review: **PASS**, **READY_TO_FREEZE**. All findings
   CLOSED; remaining material findings NONE; new material regressions NONE.
7. Freeze: three LOW re-review clarifications folded in, status set to ACCEPTED / FROZEN.

## Findings at freeze

| Severity | Remaining |
|---|---|
| BLOCKER | NONE |
| HIGH | NONE |
| MEDIUM | NONE |

LOW clarifications folded into the frozen ADR:

- **D-L1** (§13, gate C05): the session role resolves to its catalog OID by an
  exact-name-safe mechanism; no security reliance on text-to-`regrole` cast
  case-folding; OID remains the anchor, name a secondary check; fail closed.
- **D-L2** (§7, §9, gate C20): bindings over the same source remain required for
  authorization, audit, revocation, configuration and run provenance, but are not
  a security boundary against a compromised worker assigned to all of them; its
  effective authority is the union of its principal's bindings. Principal per
  workload/environment remains the V1 default.
- **D-L3** (§15, gate C21): support admitted under a revoked binding cannot by
  itself authorize PROPOSE under another/replacement binding; current-binding
  re-admission or explicit association is required; deduplicated content need not
  be physically duplicated.

## Current state at freeze (unchanged)

| Item | Status |
|---|---|
| Implementation (machine worker, production `pg` executor, roles, control tables, bindings, restricted intake/PROPOSE commands) | NOT STARTED |
| Governed Discovery machine producer | DORMANT / NOT ACTIVATABLE |
| Hosted connectivity | NOT PROVEN |
| Hosted operations performed | NONE |
| Migrations / SQL / code / tests changed by this freeze | NONE |
| S1B.3 | NOT STARTED |
| L14 permissions added | NONE |

## Next gate

**GOVERNED DISCOVERY MACHINE BOUNDARY — IMPLEMENTATION PLAN / SLICE S1** — not
started by this freeze.
