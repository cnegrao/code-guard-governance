-- =============================================================================
-- CODEGUARD AI GOVERNANCE OS
-- Migration: 20260906190000_governance_workspace_queue_v1
-- Domain:    Governance Workspace V1 — read-side support for the Enterprise
--            Review Queue. Adds exactly one read-only, service-role-only view
--            composing already-persisted Governance Persistence V1 data
--            (gov_repo.review_subjects + its evidence/assertion membership)
--            into the bounded projection the workspace queue needs: per-item
--            evidence/assertion counts and a deterministic triage ordering key.
--
-- This migration does NOT redesign packages/governance-review or
-- packages/canonical-contracts, and it does NOT alter any historical migration
-- file (20260905060000_governance_persistence_v1.sql,
-- 20260906120000_canonical_materialization_v1.sql,
-- 20260906180000_discovery_intake_v1.sql). It adds one new read-only view and
-- no new tables, columns, or write paths. No governed truth is created,
-- mutated, or bypassed by this view: it is queried only by the new
-- GovernanceWorkspaceQueryPort server-side adapter, never written to.
--
-- No production deployment is authorized by this migration. Controlled
-- runtime validation is performed only against the disposable project
-- zkqfvqwqdypgpzauzinw ("ov-ia-g2-test"); gov-ia-dev (bbisimozudihadfozyfz)
-- is never touched.
-- =============================================================================

begin;

do $preflight$
begin
  if to_regnamespace('gov_repo') is null then
    raise exception using
      errcode = '3F000',
      message = 'Cannot apply governance workspace queue migration.',
      hint = 'Schema gov_repo does not exist; foundation migrations must run first.';
  end if;

  if to_regclass('gov_repo.review_subjects') is null
     or to_regclass('gov_repo.review_subject_evidence') is null
     or to_regclass('gov_repo.review_subject_assertions') is null
  then
    raise exception using
      errcode = '3F000',
      message = 'Cannot apply governance workspace queue migration.',
      hint = 'Governance Persistence V1 tables are missing; that migration must run first.';
  end if;

  if to_regclass('gov_repo.review_subject_queue') is not null then
    raise exception using
      errcode = '42P07',
      message = 'Cannot apply governance workspace queue migration.',
      hint = 'gov_repo.review_subject_queue already exists; resolve the naming collision before retrying.';
  end if;
end;
$preflight$;

-- -----------------------------------------------------------------------------
-- A. REVIEW SUBJECT QUEUE — read-only composition of review_subjects with
--    bounded evidence/assertion counts and a triage_rank column so the
--    Governance Workspace queue can order "needs human attention" items first
--    (DETECTED/PROPOSED/CONFIRMED) ahead of terminal items (CERTIFIED/
--    REJECTED), then newest first, in one bounded query with no N+1 access.
--
--    security_invoker = true so this view is never a privilege-escalation
--    path: it always evaluates RLS/grants as the querying role, matching
--    every underlying table's existing service_role-only posture exactly.
-- -----------------------------------------------------------------------------

create view gov_repo.review_subject_queue
with (security_invoker = true) as
select
  rs.review_subject_id,
  rs.organisation_id,
  rs.finding_id,
  rs.candidate_kind,
  rs.source_connection_id,
  rs.source_external_type,
  rs.source_external_id,
  rs.state,
  rs.detected_at,
  rs.last_transition_id,
  rs.revision,
  rs.created_at,
  rs.updated_at,
  coalesce(ev.evidence_count, 0) as evidence_count,
  coalesce(asrt.assertion_count, 0) as assertion_count,
  case when rs.state in ('DETECTED', 'PROPOSED', 'CONFIRMED') then 0 else 1 end as triage_rank
from gov_repo.review_subjects rs
left join (
  select review_subject_id, count(*) as evidence_count
  from gov_repo.review_subject_evidence
  group by review_subject_id
) ev on ev.review_subject_id = rs.review_subject_id
left join (
  select review_subject_id, count(*) as assertion_count
  from gov_repo.review_subject_assertions
  group by review_subject_id
) asrt on asrt.review_subject_id = rs.review_subject_id;

comment on view gov_repo.review_subject_queue is
  'Read-only Governance Workspace queue projection: gov_repo.review_subjects plus bounded evidence_count/assertion_count and a triage_rank (0 = needs human attention: DETECTED/PROPOSED/CONFIRMED, 1 = terminal: CERTIFIED/REJECTED). security_invoker=true so RLS/grants are always evaluated as the querying role. Never written to; the authoritative rows remain gov_repo.review_subjects and its membership tables. Queried exclusively by the server-only GovernanceWorkspaceQueryPort adapter (apps/dashboard), which always filters by organisation_id explicitly — this view carries no independent tenant boundary beyond the one already enforced on gov_repo.review_subjects.';

revoke all on gov_repo.review_subject_queue from public, anon, authenticated;
grant select on gov_repo.review_subject_queue to service_role;

commit;
