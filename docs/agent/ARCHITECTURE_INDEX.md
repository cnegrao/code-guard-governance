# Architecture index

Pointers only. Section and acceptance identifiers below refer to the canonical M17 ADR.

- [M17 canonical ADR](../architecture/ADR-GOVIA-RISK-INTELLIGENCE-v1.md)
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
| F2 boundary remains untouched | §2, §8, §21; §25 canonical impact |
