# Integration & Enrichment Architecture

## Adapter principle
External systems integrate through provider-specific adapters mapped to a canonical domain model.

Inbound:
`External Provider → Provider Adapter → Canonical Metadata → Gov IA Core`

Outbound:
`Gov IA Canonical Metadata → Destination Adapter → External Provider`

## Priority enterprise enrichment sources
- Informatica IDMC
- Microsoft Purview
- Microsoft Entra
- Databricks Unity Catalog
- AWS
- Google Cloud
- ServiceNow / CMDB
- Okta / Keycloak

## IDMC custom metadata validation
The model must be able to ingest source attributes such as:
- CUSTOM_1 = Criticidade Operacional / CRITICAL
- CUSTOM_2 = Sigilo Bancário / RESTRICTED
- CUSTOM_3 = Domínio Regulatório / BCB

These are examples of source-defined metadata, not physical database columns.

## Enrichment is not Discovery
Git/repository scans discover agent implementation and engineering evidence. Enterprise catalogs/IAM enrich or validate the registered agent with governance/business/security context.
