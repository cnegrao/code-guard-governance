# Canonical endpoint identity and source mapping granularity V1

Status: **ACCEPTED**. Authority: explicit milestone 7 architecture resolution,
2026-09-09. Baseline: GOVIA-L0L16-CIA-v1.0, unchanged. This additive ADR resolves
the two accepted blockers recorded in milestone 7 evidence.

## Decision

Source/provenance identity, typed normalized object identity and canonical
object identity are separate layers. A file locates evidence; it does not select
a canonical object. An exact typed normalized identity distinguishes the Agent,
its successive AgentVersions and other objects sharing that artifact.

Canonical relationship endpoints use only the canonical object's organisation,
object ID and kind. The existing `canonicalObject` reference shape is retained.
Relationship endpoint equality excludes rich AgentVersion/Agent attributes.
VersionCode and parent identity are not reconstructed to reference an existing
canonical object. Behavior sources remain AGENT_VERSION. The eleven object kinds
and twelve relationship types remain closed.

No versionCode is invented. An explicitly supported version remains metadata;
absence remains unknown/not declared. Parent Agent linkage remains an object
integrity/provenance concern using existing pre-canonical parent references;
it is not an endpoint key and introduces no VERSION_OF edge.

The existing AgentVersion candidate ID is an admissible revision discriminator:
`candidate:agent-version:` plus the existing truncated SHA-256 of source scope
and technical revision fingerprint. The latter is the sorted, deduplicated
projection of normalized Agent code and supported technical facts, including
protected Prompt fingerprints. Neither input uses row IDs, timestamps or line
positions. Organisation and source scope must still scope every mapping; a
candidate ID alone is not tenant authority. Ordinary detector candidate IDs
include finding locations and must not be mistaken for semantic identity;
their existing typed proposed identity values supply the source-scoped key.

New mappings use organisation, existing source scope, object kind and normalized
semantic identity. Same-file Agent and versions may map independently. Exact
replay is idempotent; conflicting targets fail closed. Historical coarse mapping
rows and constraints remain intact. They are not backfilled, reinterpreted or
used to guess an AgentVersion. No latest-created/current-version selection.

Endpoint resolution requires an exact governed mapping and an existing canonical
object: zero matches yields ENDPOINT_NOT_CANONICAL; more than one yields
ENDPOINT_MAPPING_AMBIGUOUS. Organisation and allowed endpoint kinds must agree.
Relationship governance never implicitly creates endpoint objects. Those must
first pass their independent governed object workflow.

Canonical relationship identity is the deterministic directed tuple of
organisation, closed relationship type, canonical source ID and canonical target
ID. Candidate/review/decision/support IDs and timestamps are provenance only.
CREATE_NEW requires explicit scoped human governance and exact endpoints.
MATCH_EXISTING requires the identical directed tuple. REJECT and DEFER retain
audit/evidence and materialize nothing. Existing transactional materialization,
ledger, outbox and uniqueness mechanisms are reused and hardened as necessary.

At most one additive migration is permitted. Preserve historical mappings;
new writes follow typed granularity and existing tenant/service-role patterns.
No live Supabase execution. Migration validation is structural only.

## Architecture impact A-O

| Dimension | Accepted impact |
| --- | --- |
| A. CIA baseline | Additive resolution; baseline documents unchanged |
| B. L0-L16 | Governed object mapping and relationship reconciliation/materialization continuity; no discovery expansion |
| C. Passport | Canonical references remain compatible; no Passport feature |
| D. Canonical | Minimal canonical endpoint key; exact typed normalized source mappings |
| E. Lineage | Direction and AgentVersion history retained; no new type |
| F. Evidence/provenance | Source anchors, candidates, decisions and support remain separate and traceable |
| G. Trust/authority | No escalation; certified human/scoped authorization precedes truth |
| H. Vector | Analytical only; no identity or authorization authority |
| I. Graph | Downstream projection only; PostgreSQL/Supabase remains SoR |
| J. LLM | Non-authoritative; no external model required |
| K. Tenancy/security | Organisation-scoped mapping and canonical existence/kind checks; no ambiguous fallback |
| L. Migration | One additive migration maximum; historical rows/constraints preserved |
| M. Downstream continuity | Existing decision, materialization and outbox contracts reused |
| N. Non-fabrication | No fake versionCode, parent, endpoint, mapping or blocked L9 population |
| O. Acceptance quality | Original 52-case matrix plus identity/mapping cases, one focused adversarial pass and affected regressions |

## Boundaries and stop conditions

SOURCE ASSERTION != CANONICAL FACT; SEMANTIC SIMILARITY != PHYSICAL IDENTITY;
CAPABILITY != AUTHORIZATION; DESIGN-TIME DECLARATION != RUNTIME OBSERVATION;
DISCOVERY != GOVERNANCE AUTHORITY; SCANNER MACHINE AUTHORITY CEILING = PROPOSED;
HIGH CONFIDENCE != VALIDATED; VECTOR SIMILARITY != CANONICAL MERGE;
GRAPH PROJECTION != SYSTEM OF RECORD; LLM OUTPUT != CANONICAL TRUTH;
UNKNOWN != FALSE; MISSING EVIDENCE MUST NEVER BE FABRICATED.

USES_MODEL/USES_TOOL discovery remain implemented; USES_MCP, INVOKES,
USES_PROMPT, USES_KNOWLEDGE_BASE and USES_SKILL remain BLOCKED_CORRELATION.
No frozen baseline edits, Graph feature, similarity authority or milestone 8.
Stop for an insufficient existing version discriminator, taxonomy change,
unrepresentable parent semantics, non-atomic writes, destructive ambiguous
legacy reinterpretation, or inability to establish exact tenant-safe resolution.
