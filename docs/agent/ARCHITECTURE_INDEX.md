# Architecture index

Pointers only. Section and acceptance identifiers below refer to the canonical M17 ADR.

- [M17.5-S3 Award Readiness Matrix](../trust-assurance/award-readiness-matrix-v0.md) / [JSON](../trust-assurance/award-readiness-matrix-v0.json) — six organizer-verified edition records; all applicant eligibility UNKNOWN; no submission or external claim approval.
- [M17.5-S3 Award Calendar](../trust-assurance/award-calendar-v0.md) / [JSON](../trust-assurance/award-calendar-v0.json) — 25 source-pinned events, explicit precision/timezone UNKNOWN, preserved historical dates and unresolved organizer chronology conflicts.
- [M17.5-S3 handoff](../codex/evidence/2026-10-20-m17.5-s3-award-readiness.md) — source research, deterministic documentation checks, boundaries and proposed S4, not started.

- [M17.5-S2 Gap Register](../trust-assurance/gap-register-v0.md) / [JSON](../trust-assurance/gap-register-v0.json) — 61 open Assurance projection gaps with S0/S1 lineage and closure/review gates; no governed risk/control creation.
- [M17.5-S2 draft Commercial Claims Register](../trust-assurance/commercial-claims-register-v0.md) / [JSON](../trust-assurance/commercial-claims-register-v0.json) — all 38 capability ceilings and 42 INELIGIBLE proposals; five alignment candidates are not approved claims.
- [M17.5-S2 handoff](../codex/evidence/2026-10-20-m17.5-s2-gaps-claims.md) — documentation checks, publication/legacy gates and proposed S3, not started.

- [M17.5-S1 source catalog](../trust-assurance/framework-source-catalog-v0.json) — seven publisher-verified version identities, bounded public reference gate and immutable source/version policy; licensed requirement populations stay pending.
- [M17.5-S1 draft crosswalk](../trust-assurance/framework-crosswalk-v0.md) and [credibility matrix](../trust-assurance/external-credibility-matrix-v0.md) — 38 S0 capability dispositions, limited repository correspondences and explicit claim ceilings.
- [M17.5-S1 evidence index](../trust-assurance/evidence-index-v0.md) and [legacy containment](../trust-assurance/legacy-containment-register-v0.md) — 109 immutable S0 references and unresolved presentation gates.
- [M17.5-S1 handoff](../codex/evidence/2026-10-20-m17.5-s1-source-crosswalk.md) — source/access decisions, verification, gaps and proposed S2; documentation only.

- [M17.5 Trust & Assurance contract](../architecture/ADR-GOVIA-TRUST-ASSURANCE-v1.md) — S0 read/projection boundary, neutral model, separate status axes, source provenance, claims and KPI semantics.
- [M17.5-S0 verified inventory](../codex/evidence/2026-10-20-m17.5-s0-trust-assurance-inventory.md) — current implementation evidence, machine-readable inventory, legacy containment and proposed S1.

- [M17 canonical ADR](../architecture/ADR-GOVIA-RISK-INTELLIGENCE-v1.md)
- [M17 O31 numeric catalog clarification](../architecture/ADR-GOVIA-RISK-INTELLIGENCE-O31-CLARIFICATION-v1.md)
- [C-M17-01 owner-approved hypothesis disposition clarification](../architecture/ADR-GOVIA-RISK-INTELLIGENCE-C-M17-01-CLARIFICATION-v1.md)
- [M17-S7C corrective closure evidence](../codex/evidence/2026-10-19-m17-closure-corrective.md)
- [M17 authority extension](../architecture/ADR-GOVIA-M16-AUTHORITY-POLICY-M17-EXTENSION-v1.md)
- [Roadmap](../architecture/GOVIA-L0L16-CIA-v1.0-roadmap.md)

| Requested scope | Read in canonical ADR | Acceptance |
| --- | --- | --- |
| S5 RISK_TREATMENT | §15.1, §15.2, §18; execution slice table §28 | O46–O48 |
| S6 RESIDUAL / RISK_ACCEPTANCE | §14.2, §14.3, §15.3; §28 | O38–O43, O49–O52, O83 |
| S7 lifecycle / conflict / read projections | §16–§20; §21–§22 for exposure and Passport overlay; §28 | O45, O63–O72 |

| Global invariant | Source pointer |
| --- | --- |
| Frozen 11 CanonicalObjectKinds | §2, §8 |
| Frozen 12 relationship types | §2, §8 |
| Exactly 16 Passport families | §2, §22 |
| Exactly five M16 authoritative fact families | §12–§13; O07, O74 |
| Exactly four L15 authoritative fact families | §16; O05 |
| O31 governed-risk numeric prohibition and final catalog classification | [additive O31 clarification](../architecture/ADR-GOVIA-RISK-INTELLIGENCE-O31-CLARIFICATION-v1.md) |
| F2 boundary remains untouched | §2, §8, §21; §25 canonical impact |
