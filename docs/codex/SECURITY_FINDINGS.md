# Security Findings

## HIGH — Potential cross-tenant policy-to-mandate metadata exposure

Status: **OPEN / NOT REMEDIATED**

Affected relation: `gov_repo.policy_mandate_mappings`.

Repository evidence records an authenticated read policy with `USING (true)`, while the relation has no `organisation_id`. If the relation is reachable through effective grants or API exposure, authenticated users may be able to read policy-to-mandate mapping metadata across tenant boundaries.

This finding is tracked separately from M1A-R1. No RLS, grant, authentication, schema, data, or runtime remediation is authorized or performed by the metadata-comment or context-hardening work.
