# M17 O31 numeric catalog clarification V1

Status: **ACCEPTED / FROZEN CLARIFICATION**. Architecture:
**ADR-GOVIA-RISK-INTELLIGENCE-v1 — unchanged**. Milestone: **M17 final closure at
the M17S7B horizon**. Authority: explicit architecture-owner instruction on
2026-10-19. This is an additive erratum; it does not edit or replace the frozen
ADR and does not change runtime semantics.

## Frozen normative intent

O31 means all of the following:

- numeric governed-risk scoring, weighting, percentage and arithmetic-product
  mechanisms are prohibited;
- no numeric value may drive governance authority, rating, lifecycle, treatment
  or acceptance unless the frozen categorical methodology lookup explicitly
  defines that use;
- methodology ordinals are structural scale coordinates only;
- `hint_confidence` is non-authoritative analytical/source metadata only; and
- `control_pin_count` is a structural integrity/completeness counter only.

The stale literal sentence in O31 saying that methodology ordinals are the only
numeric columns is not an instruction to remove legitimate non-authoritative or
integrity metadata. The prohibitions above are the frozen rule.

## Complete final PostgreSQL 17 catalog enumeration

The disposable PostgreSQL **17.11** catalog was measured after the complete
canonical migration chain through M17S7B. The enumeration covers every ordinary
`gov_repo.l15_%` table column whose PostgreSQL type is `smallint`, `integer`,
`bigint`, `numeric`/`decimal`, `real` or `double precision`.

| Final catalog column | PostgreSQL type | Classification |
|---|---|---|
| `l15_risk_methodology_impact_levels.ordinal` | `smallint` | 1. STRUCTURAL SCALE COORDINATE |
| `l15_risk_methodology_likelihood_levels.ordinal` | `smallint` | 1. STRUCTURAL SCALE COORDINATE |
| `l15_risk_hypotheses.hint_confidence` | `numeric` | 2. NON-AUTHORITATIVE ANALYTICAL / SOURCE HINT |
| `l15_risk_signals.hint_confidence` | `numeric` | 2. NON-AUTHORITATIVE ANALYTICAL / SOURCE HINT |
| `l15_risk_treatment_proposals.control_pin_count` | `integer` | 3. STRUCTURAL INTEGRITY / COMPLETENESS COUNTER |

**Category 4 — PROHIBITED GOVERNED RISK NUMERIC: empty.** No other qualifying
numeric column exists at the final M17S7B horizon.

## Consumer classification

The final catalog consumer inventory is closed and body/definition-hash pinned by
the final regression proof:

- `hint_confidence` is admitted, range/source-shape checked, fingerprinted,
  stored and returned by the S1 signal/hypothesis intake and read surfaces. It is
  not consumed by authority, rating, lifecycle, treatment or acceptance logic.
- `control_pin_count` is populated from the submitted control-pin cardinality and
  read only by the deferred treatment integrity guard to reject incomplete pin
  sets. It does not choose, rank, authorize or validate a treatment outcome.

Any new consumer object, or a body/constraint change to a reviewed consumer,
invalidates the pinned inventory and requires architecture review.

## Regression obligation

The final O31 proof must fail closed when:

1. a numeric L15 column is not present in the exact classified catalog above;
2. any column name introduces a score, weight, percent/percentage or product
   mechanism;
3. `hint_confidence` gains an unreviewed consumer or drives authority, rating,
   lifecycle, treatment or acceptance; or
4. `control_pin_count` gains an unreviewed consumer or is used for anything other
   than completeness/integrity checking.

The proof is catalog-based. It does not whitelist from migration memory and does
not mutate production state.
