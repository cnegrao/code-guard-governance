# M17.5 / V1-S1B / LX07 - report oversight containment

2026-11-16, America/Sao_Paulo. Local candidate for independent Claude Code
adversarial review. **LX07, V1-S1B and M17.5 remain OPEN.** No readiness release.

## Git baseline and preservation

- Canonical origin: `https://github.com/cnegrao/code-guard-governance.git`.
- Candidate worktree: `.worktrees/m175-lx07-reports-oversight-20261116`, branch
  `fix/m175-lx07-reports-oversight-20261116`, HEAD/base
  `fad55c937667f036cc7af5b21d45efd8db1ed049`. Clean preflight succeeded; informative
  active-work target 90 minutes. Remote freshness is not claimed.
- Root remains on `feat/m17.5-c3-sr2-semantic-replacement`, HEAD
  `96f30b0e02d71189083ed1cd6478a12fd011dd09`, with its unrelated M18 changes.
- Approved scanner producer: `.worktrees/m175-s1b-lx07-20261116`, branch
  `feat/m175-s1b-lx07-20261116`. Approved live route:
  `.worktrees/m175-lx07-discovery-oversight-20261116`, branch
  `fix/m175-lx07-discovery-oversight-20261116`. Both remain at `fad55c9`, with their
  uncommitted candidates preserved. Carlos reports both `PASS_WITH_FINDINGS`;
  that approval does not extend to this report correction.
- `.artifacts/agent/reports-preserved-inputs.json` snapshots branch, HEAD, dirty
  file set and SHA-256 bytes for all three pre-existing worktrees.
  `reports-preservation.cjs` verifies preservation at delivery. This report
  worktree does not copy or integrate either prior candidate: its two report
  sources are identical to their HEAD versions in both approved worktrees.
- No switch, stash, reset, staging, commit, push, merge, PR, deploy, hosted read
  or hosted mutation. Historical migrations are read-only architectural sources.

## Actual report flow

```text
Existing HTTP GET /api/reports/{executive,ai-act,dora}
  -> requireVerifiedGovernancePrincipal (verified session organisation)
  -> 409 NOT_ASSESSED, with organisationId; no gather/generator call
     missing/invalid authentication -> 401; other failures -> 500

Dormant repository/service path (not activated by this correction):
  gatherReportData(orgId)
    -> db.write (server-only Supabase service client; schema gov_repo)
    -> 15 tenant-scoped reads/RPC + getUnifiedGraph(orgId)
       -> 7 further tenant-scoped reads, including findings parent join
    -> aggregate report data
    -> generateExecutiveReport / generateAIActReport / generateDORAReport
       -> PDFKit
```

All existing `.throwOnError()`, tenant predicates, findings
`control_assessments!inner(organisation_id)` join, RPC organisation argument and
export guards are unchanged. The dormant repository accepts an organisation
argument; it is not a newly authorized public reader. Service credentials bypass
RLS, so these server/ingress boundaries remain essential. No anonymous fallback,
new capability, name join, canonical identity, evidence admission or database
object is introduced. Isolated test transports do not prove hosted RLS security.

Repository-wide consumer search finds the three generator exports only in
`services/reports.ts`; production export routes do not import them. The prior
`aiAct.oversightLevels` projection was consumed only by the AI Act generator.
The repository is also called by the existing local read-regression tests.
`scripts/validate-repository.ts` has a separate local validation-summary type and
function, not this oversight report path. UI export callers still receive the
existing rejection; no visual interface was reopened.

## Tables and fields actually read

All names below are in `gov_repo`; `organisation_id` or the indicated parent
predicate is bound to the passed tenant. Count-only `select('*', {head:true,
count:'exact'})` returns counts, not complete record bodies. No evidence or
authoritative oversight table is queried.

| Source | Fields/operations used by report flow |
| --- | --- |
| `organisations` | `legal_name` as `name`; graph also reads `country_code`. Report `industry` lookup is not selected by the legacy query and falls back to `other`; unchanged. |
| `agents` | Non-decommissioned count, `risk_level`, `oversight_level`, `ai_system_id IS NULL` count. Graph: `agent_id`, `agent_code`, `name`, `agent_type`, `risk_level`, `oversight_level`, `status`, `deployment_env`, `model_name`, `cg_ag_001_registered`, `cg_ag_002_owner`, `cg_ag_003_model_reg`, `cg_ag_007_oversight`, `cg_ag_008_audit_trail`, `cg_ag_010_classified`, `cg_ag_012_autonomous_governed`, `external_refs`, `business_domain`, `ai_system_id`. |
| `ai_systems` | Non-decommissioned and legacy high/unacceptable `risk_class` counts; `lifecycle`. Graph: `system_id`, `system_code`, `name`, `risk_class`, `lifecycle`, `status`, `owner_user_id` as `owner_id`, all eight `cg_sys_001_registered` through `cg_sys_008_post_market` flags, `annex_iii_sector`, `annex_iii_exception_claimed`, `conformity_procedure`, `conformity_assessment_id`, `eu_ai_db_registered`, `eu_ai_db_system_uuid`, `eu_ai_db_ref`, `external_refs`. |
| `control_findings` / `control_assessments` | `finding_id`, `severity`, `status`; graph also `title`, `assessment_id`, `created_at`; inner parent join to `control_assessments.organisation_id`. Excludes closed/accepted findings. |
| `ict_incidents` | Open, reporting-required and major counts; recent `incident_code`, `title`, `severity`, `status`, `occurred_at`; graph additionally `is_major_incident`, `reporting_phase`. Count filters preserve resolved/closed exclusions. |
| `agent_edges` (graph) | `source_agent_id`, `target_agent_id`, `relationship_type`, `is_active`, `weight`, `carries_pii`, `carries_phi`, `carries_financial`; active edges only. |
| `third_party_providers` (graph) | `provider_id`, `name` as `provider_name`, `dora_criticality`, `concentration_risk_score`, `service_type`, `status`; active providers only. |
| RPC `agent_compliance_gaps(p_organisation_id)` | Report uses `agent_name`, `total_gaps`, `risk_level`. Historical SQL joins `agents.owner_user_id` to `governance_users.user_id`; checks agent registration/owner/model/oversight/classification/autonomy flags and `ai_system_id`; returns only agents with legacy gaps. |

Graph-derived report fields remain legacy: mean `systemComplianceScore` becomes
`controlCoverage`; node severity yields critical findings; system sector yields
Annex III counts; third-party nodes yield concentration count; agent enrichment
yields regulatory exposure counts. `regulatory.evidenceCount` counts technical
graph nodes synthesized from `agents.external_refs.discovery` evidence, lineage,
FAPI/findings and enrichment; it is not an admitted oversight-evidence count.
Graph regulation constants, technical heuristics and unrelated legacy report
metrics are not refactored or certified by this correction.

## Oversight reads, derived classifications and before/after

1. Direct query: `agents.oversight_level`, grouped by its recorded value.
2. Indirect graph read: same column is copied onto agent nodes; reports do not
   derive their effective oversight state from those nodes.
3. Historical agent trigger `update_agent_compliance_flags()` derives
   `cg_ag_007_oversight` from risk/level presence and L2-L4 membership. The gaps
   RPC consumes that flag; the report turns gap absence into a compliance rate.
4. Historical system trigger `update_ai_system_compliance_flags()` derives
   `cg_sys_006_human_oversight` from populated descriptions/person fields. The
   graph includes it among eight boolean controls for `systemComplianceScore`.
   This is not proof of effectiveness, applicability or sufficiency.

Historical sources: `20260818004009_agent_registry_graph_part_1.sql`,
`20260818004146_agent_registry_graph_part_4_fixed_total_gaps_order.sql`,
`20260818004534_ai_systems_complete_part_5.sql`. The enum has
`l1_automated`, `l2_human_review`, `l3_human_approval`, `l4_human_in_loop`;
the original agent column default in the inspected migration is L2. The frozen
LX07 contract also warns about historical L1 producer defaults. Neither default
is upgraded into proof, and neither historical source is edited.

| Boundary | Before | After |
| --- | --- | --- |
| Repository projection | Ambiguous `aiAct.oversightLevels[{level,count}]` | Internal `aiAct.oversight`: `effectiveLevel: UNKNOWN`, `evidenceStatus: NOT_EVIDENCED`, `authority: NON_AUTHORITATIVE`, `recommendationStatus: UNKNOWN`, tenant/table/field provenance; separate `recordedLevels[{recordedLevel,count}]`. |
| Historical values | Raw L1-L4 distribution could imply effective supervision | Exact recorded strings/nulls and counts retained separately. Source does not identify default/manual/heuristic origin, so no heuristic recommendation is fabricated. |
| AI Act PDF | Section `Human Oversight` and unqualified level counts | Explicit unknown evidence state; recorded values labelled unverified; counts cover returned non-decommissioned rows only. Empty results explicitly do not prove absence of supervision. |
| All three PDF writers | Favourable legacy rates/flags could suggest supervision | Explicit readable notice: recorded labels/recommendations are non-authoritative; rates, gaps, flags and technical evidence counts prove no supervision. Applicability and sufficiency remain unknown. |
| AI Act/DORA recommendations | Empty recommendation list produced a favourable `No critical ... issues detected` statement | Always retain an explicit oversight `UNKNOWN / NOT_EVIDENCED` evidence-verification action. |
| Auth/export/database | Verified-principal rejection guards; error-throwing tenant reads | Unchanged; no report activation, persisted record rewrite or canonical contract change. |

There is no positive admitted-evidence path in this source. A legitimate future
claim of proven supervision requires separately authorized authoritative evidence
and scope/sufficiency validation. `NOT_EVIDENCED` means this report path provides
no such evidence; it does not assert supervision is absent in the real world.
Stored labels are not automatically recast as heuristic recommendations.

Only the private legacy `ReportData` projection changes shape; the obsolete
ambiguous field is removed so a stale typed consumer fails compilation. Canonical
packages, database schema/enums, identities and approved scanner/route contracts
are unchanged. Returned-row counts are deliberately not declared complete tenant
populations: the legacy Data API row limit and independent query snapshots remain.

## Exact correction and local evidence

Exactly four delivered files:

1. `apps/dashboard/repositories/reports.ts`
2. `apps/dashboard/services/reports.ts`
3. `apps/dashboard/tests/lx07-reports-oversight.test.ts` (new)
4. This evidence document (new).

Full patch including new files: `.artifacts/agent/reports-oversight-only.patch`.
`reports-delivery.cjs` generates it, checks the exact allowed dirty-file set,
verifies reverse applicability without applying it and records SHA-256 hashes in
`reports-delivery.json`. Preservation is checked independently against the three
original worktree snapshots.

| Verification | Result/evidence |
| --- | --- |
| Initial focused report tests | 5/5 PASS, `f1af044a-8d24-4246-bc57-bd7b3eecedbe-0.log`; later focused additions use the actual L4 enum and positive technical-evidence nodes, covered by final verification. |
| Integration `pre-demo-reads.test.ts` | 6/6 PASS, `b8d499ac-7ff2-46a0-88e1-aa586d3768b1-0.log`; tenant predicates, server-only reads, empty data, read denial and all three export 409 guards. |
| Dashboard TypeScript | `node ../../node_modules/typescript/bin/tsc --noEmit --incremental false -p apps/dashboard/tsconfig.json`: exit 0; no generated tracked build-info changes. |
| Final focused report tests | Exact command, result and immutable log recorded in `.artifacts/agent/handoff.json` / `verification.jsonl`; includes empty inventory, real enum L1-L4, null/unknown/unrecognized values, provenance, separate tenant reads, denied source and all three real PDFKit writers with favourable legacy indicators. |
| PDF inspection | Six isolated synthetic previews (empty and populated for each writer), captured from real PDFKit streams and rendered with bundled PDFium. All six have one page and readable new notices/recorded-label rows; `preview-render.json`, `preview-montage.png`, `report-preview.json`. Not tenant evidence or a functional export claim. |
| Final packaging | `git diff --check`, exact patch reverse check and root/producer/live-route preservation checks; results in delivery manifest/handoff. |

Tests use the real repository, real graph transform, Supabase query builder and
PDFKit. Only the HTTP transport/database responses are synthetic and isolated;
every request is tenant-checked and unrecognized writes are refused. Same-name
fixtures do not imply real PostgreSQL multitenant acceptance. No provider/model,
PostgreSQL replay, browser or hosted test is claimed. Full regression is not
proportionate to this read/presentation-only correction.

Operational sandbox denials for Git/esbuild subprocesses were rerun with explicit
tool escalation; no test failure is hidden. Wall-clock telemetry includes tool
approval waits, is diagnostic only, and does not measure active work. Platform
working-time telemetry was unavailable; no fabricated active duration is reported.

## Findings and remaining work - no closure

- Approved producer and live discovery slices remain unintegrated. Their findings
  are preserved; neither was rerun, edited or reopened here.
- Historical oversight values, defaults and ledger payloads remain recorded.
  Talk, GraphOS, AgentForm, agent-detail/other legacy consumers and alternate
  producers remain outside this correction. No complete LX07 exposure acceptance.
- LX09 remains open: export activation, general regulatory wording, legacy
  compliance percentages, pagination/population completeness and visual template
  repair require separate scope. Existing PDF white text/low contrast and old
  wrapped-label overlaps are visible in previews; the new oversight notice is
  readable and separated. This is not a general PDF design clearance.
- The dormant generators return `Buffer.concat(chunks)` synchronously, before
  PDFKit completes streaming; all six diagnostic calls returned zero bytes while
  their captured streams completed. That pre-existing lifecycle defect is
  unchanged. Tests inspect completed real streams, not successful HTTP exports.
  Re-enabling exports requires resolving it and the existing broader gates.
- No authoritative oversight evaluator, applicability/sufficiency decision or
  positive proof contract was invented. Technical evidence counts and populated
  fields remain insufficient. BYOM, SR2-A4 and readiness HOLDs are unchanged.

**STOP after implementation and verification. Next action: independent Claude
Code adversarial review of this exact four-file correction.** No automatic
follow-up correction, integration or hosted action is authorized by this handoff.
