# Discovery Validation Lab Golden Repositories

A Golden Repository is a small synthetic repository whose expected Discovery
result is defined by `.govia-lab/expected.json`. The oracle is test input only:
scanner-facing snapshots must never list or read anything under `.govia-lab/`.

Every expectation declares `requiredFromRound`. A benchmark for round `N`
scores only expectations whose required round is at most `N`. Semantic concept
membership expresses meaning, not physical identity or data overlap.

The fixtures contain no real PII, credentials, secrets, customer data, package
installation, or runtime/network requirement. Current scenarios are:

1. `01-simple-agent`
2. `02-multi-agent`
3. `03-monorepo`
4. `04-mcp-not-agent`
5. `05-false-positives`
6. `06-care-coordination`

To add a future scenario, create a small deterministic source tree, add a
schema `1.0` oracle using only supported fields, keep every locator
repository-relative, assign cumulative rounds, and extend the structural tests.
