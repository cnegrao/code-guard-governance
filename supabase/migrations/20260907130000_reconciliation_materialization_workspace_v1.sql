-- =============================================================================
-- CODEGUARD AI GOVERNANCE OS
-- Migration: 20260907130000_reconciliation_materialization_workspace_v1
-- Domain:    Reconciliation & Materialization Workspace V1 — the human
--            Enterprise Governance Workspace surface over the existing,
--            closed Authorized Reconciliation Gate (packages/governance-review
--            invokeObjectReconciliation / invokeRelationshipReconciliation)
--            and Canonical Materialization V1
--            (20260906120000_canonical_materialization_v1.sql).
--
-- This migration does NOT redesign gov_repo.reconciliation_invocations,
-- gov_repo.reconciliation_decisions, gov_repo.materialization_operations, or
-- any prior migration — all byte-for-byte untouched. It adds exactly one
-- additive index.
--
-- Why: the new Governance Decision Query Service (apps/dashboard/lib/
-- governance/decision-query.ts) must answer "does this certified
-- ReviewSubject already have a reconciliation decision?" on every Review
-- detail page load and before every reconciliation-decision submission (the
-- read-before-write guard backing the workspace's optimistic concurrency —
-- see decision-commands.ts). gov_repo.reconciliation_invocations previously
-- carried only idx_reconciliation_invocations_org (organisation_id) and
-- idx_reconciliation_invocations_command (organisation_id, command_id) — no
-- index covers a lookup by review_subject_id, which this milestone is the
-- first caller to need. review_subject_id is nullable (MERGE_CANDIDATES
-- invocations carry none), so the index is partial.
-- =============================================================================

create index if not exists idx_reconciliation_invocations_review_subject
  on gov_repo.reconciliation_invocations (organisation_id, review_subject_id)
  where review_subject_id is not null;

comment on index gov_repo.idx_reconciliation_invocations_review_subject is
  'Reconciliation & Materialization Workspace V1: backs "does this certified ReviewSubject already have a reconciliation decision?" reads and the read-before-write concurrency guard in decision-commands.ts. Partial because review_subject_id is null for MERGE_CANDIDATES invocations.';
