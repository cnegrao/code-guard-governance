# ADR-P06 — Profile History, Technical Fingerprints, Hashes and Field Support

Status: Accepted

Date: 2026-08-31

## Context

Canonical technical profiles are typed current views over immutable history. Their fields can be supported by different assertions and evidence, and changes in provenance do not necessarily change behavior-relevant technical configuration.

Behavior bindings freeze a target's `TechnicalFingerprint`, not a profile-state identifier. Multiple profile states may legitimately describe the same technical fingerprint while differing in capture time, provenance or evidence.

## Decision

Persist `TechnicalFingerprint` as a stable object-owned grain:

```text
technical_fingerprint
- organisation_id
- technical_fingerprint_id
- canonical_object_id
- algorithm
- schema_version
- value
```

Its PK is `(organisation_id, technical_fingerprint_id)`. Its exact logical candidate key is:

```text
(organisation_id,
 canonical_object_id,
 algorithm,
 schema_version,
 value)
```

Equality is exact and case-sensitive. Persistence does not trim values or infer equality across algorithms/schema versions. One canonical object may own many fingerprints; identical hash-looking values owned by different objects remain distinct grains.

Profile history uses an immutable profile-state root plus one compatible typed profile-state subtype. Model, Tool, MCP Server, API, Prompt, Knowledge Base and Skill technical profile states associate to exactly one object-owned TechnicalFingerprint through a normalized relation. Multiple profile states may reference the same fingerprint.

AgentVersion uses a distinct `BehaviorFingerprint`. DataAsset and DataElement profiles do not require `TechnicalFingerprint` in frozen V1A.1.

`EvidenceHash`, content hash, contract hash, specification hash and artifact hash remain integrity facts and are never reused as TechnicalFingerprint identity.

Field-level `TechnicalMetadataSupport` is persisted as normalized assertion/evidence junctions with a closed field-role catalog that routes provenance to an already-typed profile column. Support stores no generic value and cannot become EAV. Arrays and JSONB are not the support SOR.

## Invariants

- TechnicalFingerprint belongs to exactly one tenant and canonical object.
- Its equality includes object, algorithm, schema version and value.
- Fingerprint strings are stored once in their own grain, not copied into profiles or bindings.
- Multiple immutable profile states may share one fingerprint.
- Profile provenance/support remains state-specific.
- BehaviorFingerprint and all integrity hashes are semantically and physically distinct.
- Typed profile values remain typed columns.
- Field-role support never stores predicate/value or arbitrary metadata.

## Relational consequences

- `CanonicalObject 1 -> N TechnicalFingerprint`.
- Eligible `ProfileState N -> 1 TechnicalFingerprint`.
- A one-to-one state/fingerprint association ensures each eligible state has exactly one fingerprint without putting nullable fingerprint columns on unrelated profile kinds.
- Deferred validation proves that the profile state and fingerprint belong to the same canonical object and that the object kind requires the association.
- Profile support uses deduplicated N:N junctions to SourceAssertion and Evidence, keyed by profile state and controlled field role.
- Current profile views derive the applicable profile state; they do not change fingerprint identity.

## Security / tenant consequences

- Every profile, support and fingerprint FK includes `organisation_id`.
- A profile cannot attach another tenant's or another object's fingerprint.
- Support references only existing same-tenant assertions/evidence.
- Sanitized locator/hash contracts do not authorize storing secrets or raw sensitive content.

## Alternatives considered

1. Store fingerprint fields on every profile state.
2. Use profile-state identity as the binding pin.
3. Persist a stable object-owned TechnicalFingerprint and reference it independently.
4. Reuse EvidenceHash/content hashes as technical identity.
5. Store support arrays/JSONB on profile rows.

## Rejected alternatives

- Per-state fingerprint copies are rejected because they duplicate one stable fact and obscure equivalence across profile history.
- Profile-state pinning is rejected because provenance-only history changes must not change a binding.
- Reusing integrity hashes is rejected because artifact integrity and behavior-relevant technical equivalence are different facts.
- Support arrays/JSONB and generic fact bags are rejected because they weaken FK integrity and create EAV-like persistence.

## Consequences

Profile rehydration joins typed state, stable fingerprint and field support. The additional joins preserve 3NF and make provenance changes independent from technical identity. Fingerprint candidate-key storage/index limits must be explicitly validated before DDL so exact uniqueness remains operationally safe without changing the frozen TypeScript contract.

## Implementation gates

- Inventory typed fields and closed support roles for each eligible profile subtype.
- Define exact, non-lossy persistence validation for fingerprint components and candidate-key indexing.
- Specify the deferred same-object profile/fingerprint check.
- Define separate BehaviorFingerprint persistence for AgentVersion.
- Prove no profile or binding table duplicates fingerprint value fields.

## Required tests

- Exact fingerprint candidate-key reuse returns one object-owned grain.
- Case or schema-version differences remain distinct.
- The same value on different objects produces distinct fingerprints.
- Two profile states reference the same TechnicalFingerprint.
- New provenance/evidence with the same fingerprint creates a new profile state without changing the fingerprint.
- Profile state cannot reference another object's or tenant's fingerprint.
- BehaviorFingerprint cannot be used where TechnicalFingerprint is required.
- Evidence/content/contract/specification/artifact hashes cannot substitute for TechnicalFingerprint.
- Support N:N entries deduplicate exact references.
- Unknown field roles and generic support values are rejected.
- DataAsset/DataElement and AgentVersion are not incorrectly forced into the TechnicalFingerprint association.

## Out of scope

- A universal hashing/serialization algorithm.
- Generic schema validation or EAV.
- DataAsset/DataElement TechnicalFingerprint.
- Metrics, embeddings and vector search.
- Current-profile caching implementation.
