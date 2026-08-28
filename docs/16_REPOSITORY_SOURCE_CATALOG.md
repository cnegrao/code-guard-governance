# Repository Discovery Source Catalog — V4 FINAL

## Confirmed providers in current Dênio scanner code
- GitHub
- GitLab
- Azure DevOps Repos
- Bitbucket
- Gitea
- Forgejo

The connector types and registry explicitly include Forgejo. Gitea/Forgejo self-hosted scenarios may require explicit `provider` and `baseUrl` because arbitrary corporate URLs cannot always be inferred safely.

## Engineering artifacts to scan
- source code / monorepos / workspaces
- IaC: Terraform, CloudFormation, Bicep and equivalents
- CI/CD pipeline definitions
- Docker/Kubernetes configuration
- agent manifests
- MCP manifests/configuration
- prompts and agent configuration
- dependency/package manifests
- OpenAPI/API schemas
- SQL/ORM/schema definitions
- README/docs that declare capabilities/instructions

## Boundary
PostgreSQL/Oracle/Teradata/Snowflake/etc. are not automatically primary repository Discovery sources. They may first be detected as referenced resources in code. Direct connectors can later enrich authorization/schema/classification metadata when justified.
