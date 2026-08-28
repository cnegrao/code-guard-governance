# Trust, Provenance & Validation Model

## Why it exists
Gov IA must distinguish a scanner inference from an authoritative enterprise fact. Every important Agent Passport assertion should be explainable: what is known, from where, when, by which method, with what confidence, and who/what validated it.

## Knowledge/trust states
- **DISCOVERED / INFERRED** — derived by scanner/detector.
- **DECLARED** — explicitly declared in code/config/manifest/documentation.
- **IMPORTED** — imported from an external metadata/IAM/governance source.
- **OBSERVED** — supported by runtime evidence.
- **VALIDATED** — confirmed by an authoritative system or approved human/governance process.

These states may coexist as evidence for the same assertion; do not force them into a simplistic linear lifecycle.

## Provenance minimum
Where applicable preserve:
- organisation/tenant
- source system/provider/connection
- external object ID
- repository/branch/commit
- file/path/line/symbol
- original source attribute/code/value
- detector/method/version
- observed/imported/discovered time
- valid-from/valid-to
- confidence/detection score
- validation status
- evidence reference/hash

## Governance validation
A discovered architectural classification may be pending review/committee approval without implying the Agent does not exist. Separate:
- discovery status
- classification status
- governance approval/decision
- operational lifecycle status
