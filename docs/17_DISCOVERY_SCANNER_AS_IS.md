# Dênio Discovery Scanner — Read-Only As-Is Assessment

Source reviewed: `negraodenio/code-guard-governance`, `standalone-compliance-scanner` on fetched `upstream/main`.

## Repository connector layer
The current interface is lean and useful for MVP:
- `fetchMeta`
- `fetchTree`
- `fetchFile`
- `fetchLanguages`

Providers confirmed in code: GitHub, GitLab, Azure DevOps, Bitbucket, Gitea, Forgejo.

### Keep
- provider-specific adapters behind a common repository interface;
- normalized repository metadata DTO;
- explicit self-hosted config support.

### Evolve later
- rename generic `SourceConnector` toward repository-specific semantics if helpful;
- add connector capability negotiation/testConnection only when needed;
- remove silent unknown-URL→GitHub fallback in production.

## Agent framework detector
Current detector uses framework-specific regular expressions and creates candidate agents from matched files.

### Reuse
- framework pattern catalog;
- multi-language file scanning;
- evidence/confidence concept;
- config-based MCP/CLAUDE/AGENTS detection.

### Target improvements
- candidate vs confirmed Agent status;
- symbol/line/commit provenance;
- AST/structure/context detection where valuable;
- calibrated or clearly named detection score;
- risk derived from actual behavior/context rather than framework defaults.

Important: framework detection is not equivalent to proving an Agent instance. An imported framework may support zero, one or many agents.

## Privacy detector
Current `lgpd-pii.ts` is primarily lexical/name regex scanning. Treat it as a first detector, not as the complete semantic privacy engine.

## Scanner DTOs
Arrays/nested objects are acceptable for scanner transport. They are not a target persistence schema. Normalize stable concepts before storing them in the 3NF System of Record.
