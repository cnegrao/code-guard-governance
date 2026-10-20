# C-M17-01 — Hypothesis disposition projection

Status: **ACCEPTED / OWNER-APPROVED CLARIFICATION**. Authority: explicit
architecture-owner authorization received on 2026-10-20 for M17-S7D. This
additive clarification narrows frozen ADR section 5.2 without editing it.
O01–O91 keep their identifiers. Final closure requires **O01–O91 PASS AND
C-M17-01 PASS**.

The scalar projection uses this exact precedence:

1. `CITED_BY_GOVERNED_RISK`
2. `CITED_BY_LIVE_PROPOSAL`
3. `CITED_BY_REJECTED_PROPOSAL`
4. `UNREVIEWED`

This records only the furthest governance-use stage reached by the exact
hypothesis in the GOVERNED_RISK workflow. It is never confidence, hypothesis,
source, recency, generator or evidence ranking/scoring.

Only exact typed GOVERNED_RISK proposal/decision/state lineage affects the
projection. RISK_ASSESSMENT, RISK_TREATMENT, RISK_ACCEPTANCE and registry
citations remain support/provenance only. This narrows section 5.2's
“proposals/decisions that cite it” to the GOVERNED_RISK promotion path.

- `CITED_BY_GOVERNED_RISK`: the exact hypothesis entered durable GOVERNED_RISK
  state lineage through a GOVERNED_RISK proposal citing it. A later REVOKE
  closes the risk but never erases this historical governance-use provenance.
- `CITED_BY_LIVE_PROPOSAL`: no governed-risk condition exists, and a citing
  GOVERNED_RISK VALIDATE-intent proposal has no terminal VALIDATE or REJECT
  governance decision. DEFER is non-terminal. A denied attempt is not REJECT.
- `CITED_BY_REJECTED_PROPOSAL`: neither preceding condition exists, and a
  citing GOVERNED_RISK VALIDATE-intent proposal has a terminal REJECT decision.
- `UNREVIEWED`: none of those conditions exists.

Thus rejected P1 + live P2 yields LIVE; rejected P1 + validated P2 yields
GOVERNED_RISK; later risk revocation preserves GOVERNED_RISK; rejected-only
yields REJECTED; DEFER-only yields LIVE; no GOVERNED_RISK proposal citation
yields UNREVIEWED.

The projection remains read-only, `NON_AUTHORITATIVE`, exact-tenant,
exact-subject, with no inheritance and zero writes. A citation concerning
another subject must not poison the exact-subject read. There is no stored
disposition column, store or hypothesis mutation. It cannot authorize,
create/close a risk, select a hypothesis, alter rating/treatment/acceptance,
become evidence, or rank by confidence/count/recency/generator/source.

Implementation and executable proof are recorded in the
[M17-S7D evidence](../codex/evidence/2026-10-20-m17-s7d-adversarial-corrective.md).
