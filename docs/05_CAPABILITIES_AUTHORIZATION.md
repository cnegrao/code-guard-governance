# Capabilities, Permissions, Identity & Authorization — V4 FINAL

## Goal
For each agent answer independently:
1. What can it do?
2. Against which resource?
3. Under which execution identity/role?
4. What proves that action is authorized?

## Concepts
### Capability
Examples: SEARCH_WEB, SEND_REPORT, EXECUTE_SQL, READ_DATABASE, WRITE_DATABASE, EXECUTE_SHELL, CALL_API, ACCESS_MCP, CREATE_FILE, DELETE_FILE.

### Resource
API, database/data asset, system, MCP server, filesystem, cloud service, queue, tool, model endpoint, etc.

### Action / Permission
READ, WRITE, EXECUTE, DELETE, ADMIN, IMPERSONATE, APPROVE, etc.

### Capability evidence
- DECLARED — code/config/docs/manifest says the agent can do it.
- OBSERVED — runtime evidence shows the agent actually did it.

### Execution identity
Service account, OAuth client, IAM role, managed identity, Entra service principal, database role, API-key binding, personal/shared credential, UNKNOWN.

### Authorization status
- AUTHORIZED — positive evidence exists.
- UNAUTHORIZED — explicit evidence proves lack/prohibition.
- UNKNOWN — neither authorization nor prohibition can be proven.

`UNKNOWN` must never be promoted to `UNAUTHORIZED` solely because IAM/SQL/OAuth evidence was not visible in the repository.

### Authorization evidence sources
IAM policies; Terraform/CloudFormation/Bicep; Kubernetes RBAC; SQL GRANT/roles; OAuth scopes; Entra/AWS/GCP identities; MCP policies; CI/CD/config; and later enterprise IAM enrichment connectors.

## Risk signals
Destructive action; privileged action; unknown identity; unknown authorization; observed-but-unauthorized; destructive action without HITL; excessive permissions; privilege-escalation path.

## Lean 3NF direction
Do not create one table per adjective. A compact normalized target should center on concepts equivalent to:
- capability catalog
- agent-capability/resource/action association
- execution identity
- authorization binding
- authorization evidence

Exact physical tables must be designed against existing `agent_resource_links`, governance evidence and identity structures before migration.

## As-is status
The detailed email vocabulary (`DECLARED_CAPABILITY`, `UNKNOWN_AUTHORIZATION`, `Identity Binding`, etc.) has not yet been located in the currently fetched `upstream/main`. Treat this capability as a confirmed target requirement, not as fully implemented code, until the generating code/commit is identified.
