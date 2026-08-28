# Gov IA — Architecture V4 FINAL

## Architecture
```mermaid
flowchart TB
  subgraph DS[1. Repository Discovery Sources]
    RP[GitHub / GitLab / Azure DevOps / Bitbucket / Gitea / Forgejo / Self-hosted Git]
    EA[Source Code / IaC / CI-CD / Agent & MCP manifests / Prompts & Config / Dependencies / Schemas]
  end

  subgraph EN[2. Enterprise Enrichment Sources]
    CAT[Informatica IDMC / Purview / Unity Catalog / ServiceNow CMDB]
    IAM[Entra / AWS IAM / GCP IAM / Okta / Keycloak / Kubernetes RBAC]
    SYS[Provider-specific data/cloud/system metadata when justified]
  end

  subgraph RI[3. Regulatory Intelligence Sources]
    REG[Regulations / resolutions / circulars / communications / policies / procedures / controlled documents / APIs & feeds]
  end

  subgraph RT[4. Runtime Sources — Future]
    TEL[OpenTelemetry / logs / traces / tool-model invocations / usage / cost / enforcement events]
  end

  RP --> CONN[Repository Connector Layer]
  EA --> CONN
  CONN --> SCAN[Discovery Engine]
  SCAN --> DET[Detectors\nframework + agent candidate + model + tool/MCP + data access + privacy + capability]
  DET --> FIND[Discovery Findings\nevidence + confidence + provenance]
  FIND --> NORM[Normalization / Dedup / Classification]
  NORM --> CAN[Canonical Agent Metadata Model]

  CAT --> CAN
  IAM --> CAN
  SYS --> CAN
  REG --> POL[Mandates & Policy Governance]
  TEL --> EVT[Runtime Event Model]

  CAN --> CORE[Gov IA Core\nRegistry | Agent Passport | Policies | Controls | Risk | HITL | Evidence | Ledger | Incidents | GraphOS]
  POL --> CORE
  EVT --> CORE

  CORE --> PG[(PostgreSQL / Supabase\n3NF Operational System of Record)]
  PG --> MET[Metrics & Objectives Engine\nDerived from historical facts]
  MET --> UI[Native Lenses\nCISO | Board | Agent | Risk | Policy | Privacy | Audit]

  PG -. CDC / events later .-> CH[(ClickHouse\nAnalytical / Event Store)]
  CH --> MET
  PG -. graph projection later .-> N4J[(Neo4j\nGraph Intelligence)]
  N4J --> CORE
```

## Persistence responsibilities
- **PostgreSQL/Supabase:** operational truth, transactions, 3NF, historical/versioned governance facts.
- **ClickHouse:** future high-volume analytical/event workload, telemetry, time-series, FinOps and concurrent analytics.
- **Neo4j:** future complex path traversal, lineage, dependency analysis and blast radius.
- **Object storage:** evidence files, reports and large immutable artifacts when appropriate.

## Connector boundaries
Repository connectors and enterprise enrichment connectors are separate families. The current repository connector contract (`fetchMeta`, `fetchTree`, `fetchFile`, `fetchLanguages`) is suitable for repository Discovery but must not be stretched to represent IDMC/Purview/Entra/regulatory feeds.
