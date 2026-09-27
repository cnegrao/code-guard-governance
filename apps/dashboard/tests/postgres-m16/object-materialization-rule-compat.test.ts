import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { disposableM16Postgres } from '../helpers/disposable-m16-postgres';

/**
 * M16-S0.3.3B0 — corrective slice, DB-only. Proves, on a real disposable PostgreSQL 17 cluster
 * using the REAL, unmodified production functions (never test doubles):
 *  (1) the pre-existing gov_repo.materialize_object_reconciliation (as of
 *      20260909210640_relationship_decision_to_truth_v1.sql, unmodified here) fails every
 *      CREATE_NEW/MATCH_EXISTING object materialization with SQLSTATE 0A000, because its
 *      normalized-mapping INSERT ... ON CONFLICT targets a table (canonical_normalized_
 *      object_mappings) that carries the required normalized_mapping_no_update /
 *      normalized_mapping_no_delete immutability rules — PostgreSQL categorically refuses
 *      ON CONFLICT on any relation with a rewrite rule;
 *  (2) the corrective migration (20260925175000_m16_s0_object_materialization_rule_compat_v1.sql)
 *      fixes exactly that one insert strategy, with zero other change to signature, security
 *      mode, ACL, validation, locking, idempotency, replay, or error taxonomy;
 *  (3) the immutability rules themselves are untouched (UPDATE/DELETE remain no-ops);
 *  (4) gov_repo.materialize_relationship_reconciliation (never modified) remains green.
 *
 * This test establishes its own additional governance/materialization migration chain by
 * reading migration files directly (not via the base helper's migrationSource()/migrate()
 * allowlist, which is deliberately left unmodified in this corrective commit).
 */

const MIGRATIONS_DIR = fileURLToPath(new URL('../../../../supabase/migrations/', import.meta.url));
const readMigration = (name: string) => readFileSync(join(MIGRATIONS_DIR, name), 'utf8');

// Real governance/materialization chain required by the REAL, unmodified functions under test.
// Order matches the canonical migration history; nothing here is a test double.
const GOVERNANCE_WRITE_CHAIN = [
  '20260905060000_governance_persistence_v1.sql',
  '20260906120000_canonical_materialization_v1.sql',
  '20260906180000_discovery_intake_v1.sql',
  '20260907120000_discovery_governance_input_persistence_v1.sql',
  // Required by 909210640's materialize_relationship_reconciliation: its RELATIONSHIP_
  // FINGERPRINT_SUPPORT_MISSING check references this table's name in a query the planner
  // must resolve regardless of which relationship_type branch is taken at runtime.
  '20260908120000_agent_version_technical_profile_persistence_v1.sql',
  // Defines the CURRENT (pre-fix) materialize_object_reconciliation with the 0A000 defect,
  // and the canonical_normalized_object_mappings immutability rules that cause it.
  '20260909210640_relationship_decision_to_truth_v1.sql',
];
const CORRECTIVE_MIGRATION = '20260925175000_m16_s0_object_materialization_rule_compat_v1.sql';

const lit = (value: string) => `'${value.replace(/'/g, "''")}'`;
const jsonLit = (value: unknown) => `${lit(JSON.stringify(value))}::jsonb`;
const HASH = `repeat('a',64)`;
const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
const named = (args: Record<string, string>) => Object.entries(args).map(([key, value]) => `${key} => ${value}`).join(',\n    ');
const lastLine = (out: string) => out.replace(/\r/g, '').trim().split('\n').pop() as string;

test('M16 S0.3.3B0 object materialization rule compatibility (real PG17, real production functions)', { timeout: 900_000 }, async t => {
  const pg = await disposableM16Postgres(message => t.diagnostic(message));
  t.after(() => pg.stop());
  const { sql, bootstrapSql } = pg;
  const owner = (query: string) => sql(query, 'postgres');
  const svc = (query: string) => sql(query, 'service_role');
  const applyMigration = async (name: string) => {
    await owner(readMigration(name));
    t.diagnostic(`Executed migration (read directly; not added to the base helper's allowlist): ${name}`);
  };
  for (const migration of GOVERNANCE_WRITE_CHAIN) await applyMigration(migration);

  // The real functions call extensions.digest(). disposableM16Postgres() already applied
  // m16Prerequisites, which creates pgcrypto unqualified (public schema); move it into an
  // "extensions" schema here rather than re-creating it (disposable-m16-postgres.ts is left
  // unmodified in this corrective commit).
  await bootstrapSql(`create schema extensions authorization postgres;
    alter extension pgcrypto set schema extensions;
    grant usage on schema extensions to postgres, service_role, anon, authenticated;`);

  const org = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const run = 'run-object-compat';
  await owner(`insert into gov_repo.organisations(organisation_id,org_code,legal_name,display_name,country_code,is_active)
      values('${org}','OBJCOMPAT','Obj Compat','Obj Compat','PT',true);
    insert into gov_repo.acquisition_runs(run_id,organisation_id,source_connection_id,source_system_id,adapter_name,adapter_version,mode,status,started_at)
      values('${run}','${org}','conn-shared','catalog','fixture','1','FULL','RUNNING',now());`);

  const rejects = (query: string, matcher: RegExp | ((message: string) => void), role: 'service_role' | 'postgres' = 'service_role') =>
    assert.rejects(sql(query, role), (error: Error) => {
      if (matcher instanceof RegExp) assert.match(error.message, matcher, error.message);
      else matcher(error.message);
      return true;
    });

  const countsSql = () => owner(`select
      (select count(*) from gov_repo.canonical_objects where organisation_id='${org}')||':'||
      (select count(*) from gov_repo.canonical_normalized_object_mappings where organisation_id='${org}')||':'||
      (select count(*) from gov_repo.materialization_operations where organisation_id='${org}')||':'||
      (select count(*) from gov_repo.materialization_locks where organisation_id='${org}')||':'||
      (select count(*) from gov_repo.outbox_events where organisation_id='${org}')`);

  interface Candidate { readonly candidate: string; readonly finding: string; readonly subject: string; readonly conn: string; readonly extType: string; readonly extId: string; readonly kind: string }
  async function seedObjectCandidate(label: string, kind: string, proposedIdentity: Record<string, string>, opts: { conn?: string; extType?: string; extId?: string } = {}): Promise<Candidate> {
    const conn = opts.conn ?? `conn-${label}`, extType = opts.extType ?? 'source', extId = opts.extId ?? `${label}.ts`;
    const candidate = `candidate:${label}`, finding = `finding-${label}`, subject = `review-${label}`;
    const envelope = { candidateId: candidate, candidateKind: kind, sourceObject: { connectionId: conn, externalType: extType, externalId: extId },
      findingId: finding, assertionIds: [], evidenceIds: [], confidence: 1, requiresReconciliation: true, proposedIdentity };
    await owner(`
      insert into gov_repo.discovery_findings(organisation_id,finding_id,finding_nature,candidate_kind,source_connection_id,source_external_type,source_external_id,
        confidence,review_status,requires_review,creates_canonical_object,detected_at,acquisition_run_id,contract_version,envelope,envelope_hash)
        values('${org}',${lit(finding)},'CANDIDATE',${lit(kind)},${lit(conn)},${lit(extType)},${lit(extId)},1,'ACCEPTED',true,false,now(),${lit(run)},'1.0','{}',${HASH});
      insert into gov_repo.discovery_candidates(organisation_id,candidate_id,candidate_kind,candidate_family,finding_id,source_connection_id,source_external_type,source_external_id,
        confidence,requires_reconciliation,proposed_identity,acquisition_run_id,contract_version,envelope,envelope_hash)
        values('${org}',${lit(candidate)},${lit(kind)},'OBJECT',${lit(finding)},${lit(conn)},${lit(extType)},${lit(extId)},1,true,${jsonLit(proposedIdentity)},${lit(run)},'1.0',${jsonLit(envelope)},${HASH});
      insert into gov_repo.review_subjects(review_subject_id,organisation_id,finding_id,candidate_kind,source_connection_id,source_external_type,source_external_id,state,detected_at)
        values(${lit(subject)},'${org}',${lit(finding)},${lit(kind)},${lit(conn)},${lit(extType)},${lit(extId)},'CERTIFIED',now());`);
    return { candidate, finding, subject, conn, extType, extId, kind };
  }

  interface Decision { readonly decisionId: string; readonly invocationId: string; readonly canonicalObjectId: string; readonly outcome: string }
  /** Calls the REAL, unmodified gov_repo.record_authorized_reconciliation (never touched by the corrective migration). */
  async function authorizeObject(label: string, cand: Candidate, outcome: 'CREATE_NEW' | 'MATCH_EXISTING', canonicalObjectId: string): Promise<Decision> {
    const decisionId = `decision-${label}`, invocationId = `invocation-${label}`;
    await svc(`select 1 from gov_repo.record_authorized_reconciliation(${named({
      p_organisation_id: `'${org}'::uuid`, p_review_subject_id: lit(cand.subject), p_authorization_decision_id: lit(`authz-${label}`),
      p_authorization_actor_reference: lit('fixture-admin'), p_authorization_subject_kind: `'CANDIDATE'`, p_authorization_subject_candidate_id: lit(cand.candidate),
      p_authorization_subject_candidate_merge_id: 'null::text', p_requested_action: lit(outcome), p_authorization_evaluated_at: 'now()',
      p_policy_reference: 'null::text', p_invocation_id: lit(invocationId), p_command_id: lit(`cmd-${label}`), p_command_fingerprint: lit(`fp-${label}`),
      p_requested_at: 'now()', p_reason_code: `'MANUAL_APPROVAL'`, p_decision_id: lit(decisionId), p_family: `'OBJECT'`, p_outcome: lit(outcome),
      p_candidate_kind: lit(cand.kind), p_authority_reference: lit('fixture-admin'), p_decided_at: 'now()', p_subject_candidate_id: lit(cand.candidate),
      p_subject_candidate_merge_id: 'null::text', p_canonical_object_id: lit(canonicalObjectId), p_canonical_object_kind: lit(cand.kind),
      p_relationship_candidate_id: 'null::text', p_relationship_type_code: 'null::text', p_candidate_merge_id: 'null::text',
      p_merge_member_candidate_ids: `'{}'::text[]`, p_assertion_ids: `'{}'::text[]`, p_evidence_ids: `'{}'::text[]`, p_contract_version: `'1.1'`,
      p_envelope: `'{}'::jsonb`, p_envelope_hash: HASH,
    })}) x;`);
    return { decisionId, invocationId, canonicalObjectId, outcome };
  }

  const materializeSql = (cand: Candidate, decision: Decision, fingerprint: string) =>
    `select to_json(m) from gov_repo.materialize_object_reconciliation(${named({
      p_organisation_id: `'${org}'::uuid`, p_reconciliation_decision_id: lit(decision.decisionId), p_invocation_id: lit(decision.invocationId),
      p_outcome: lit(decision.outcome), p_canonical_object_id: lit(decision.canonicalObjectId), p_canonical_object_kind: lit(cand.kind),
      p_source_connection_id: lit(cand.conn), p_source_external_type: lit(cand.extType), p_source_external_id: lit(cand.extId),
      p_match_method: `'MANUAL'`, p_idempotency_fingerprint: lit(sha256(fingerprint)), p_occurred_at: 'now()',
    })}) m;`;

  const mappingRow = (conn: string, extType: string, extId: string, kind: string) => owner(`select mapping_id||':'||canonical_object_id from
    gov_repo.canonical_normalized_object_mappings where organisation_id='${org}' and source_connection_id=${lit(conn)}
    and source_external_type=${lit(extType)} and source_external_id=${lit(extId)} and canonical_object_kind=${lit(kind)}`);

  let functionMeta: (label: string) => Promise<string>;
  let functionOid: () => Promise<string>;
  let metaBeforeCorrective = '';
  let oidBeforeCorrective = '';
  {
    const oidQuery = `(select oid from pg_proc where pronamespace='gov_repo'::regnamespace and proname='materialize_object_reconciliation')`;
    functionOid = () => owner(`select ${oidQuery}::text`);
    // OID is deliberately EXCLUDED from this comparable string (E. OID parity is asserted
    // separately in test 2, so a genuine OID change would still be caught, just not silently
    // baked into this string's own equality check).
    functionMeta = (label: string) => owner(`select ${lit(label)}||':'||pg_get_userbyid(proowner)||':'||prosecdef::text||':'||provolatile::text||':'||
      coalesce(proconfig::text,'null')||':'||pg_get_function_identity_arguments(oid)||':'||pg_get_function_result(oid)||':'||coalesce(proacl::text,'null')
      from pg_proc where oid=${oidQuery}`);
  }

  // =====================================================================================
  await t.test('1. baseline: the CURRENT (pre-fix) function reproduces 0A000 on the object success path; zero mutation survives', async () => {
    const cand = await seedObjectCandidate('baseline', 'MODEL', { modelReference: 'model-baseline' });
    const canonicalObjectId = 'canonical-object:baseline';
    const decision = await authorizeObject('baseline', cand, 'CREATE_NEW', canonicalObjectId);
    // Snapshot AFTER record_authorized_reconciliation's own legitimate, already-committed
    // outbox row (GOVERNANCE_RECONCILIATION_DECIDED) — that write is real and expected;
    // only the SUBSEQUENT materialize attempt must leave zero trace.
    const before = await countsSql();
    await rejects(materializeSql(cand, decision, 'baseline'), (message: string) => {
      assert.match(message, /0A000/);
      assert.match(message, /INSERT with ON CONFLICT clause cannot be used with table that has INSERT or UPDATE rules/);
      assert.match(message, /canonical_normalized_object_mappings/);
    });
    assert.equal(await countsSql(), before, 'the entire failed statement (its own materialization_locks insert included) rolled back: zero additional mutation');
    t.diagnostic('Baseline 0A000 reproduced against the unmodified pre-fix function; retrying the identical decision after the fix below.');

    // Function metadata snapshot BEFORE the corrective migration (compared after it below).
    metaBeforeCorrective = await functionMeta('before-corrective');
    oidBeforeCorrective = await functionOid();
    assert.match(oidBeforeCorrective, /^\d+$/);
  });

  await t.test('2. corrective migration applies successfully; function owner/security/volatility/search_path/ACL parity with before', async () => {
    await applyMigration(CORRECTIVE_MIGRATION);
    const before = metaBeforeCorrective.replace('before-corrective', 'X');
    const after = (await functionMeta('after-corrective')).replace('after-corrective', 'X');
    assert.equal(after, before, 'owner, SECURITY mode, volatility, search_path, identity arguments, result shape and ACL are byte-for-byte unchanged');
    // E. OID parity: CREATE OR REPLACE FUNCTION with an identical name and argument-type list
    // preserves the function's OID; a same-signature DROP+CREATE would NOT. This distinguishes
    // the two and is exactly what lets dependent objects/comments/permissions survive untouched.
    assert.equal(await functionOid(), oidBeforeCorrective, 'CREATE OR REPLACE preserved the exact same function OID, not a new one');
    for (const role of ['service_role', 'anon', 'authenticated']) {
      const privilege = await owner(`select has_function_privilege('${role}','gov_repo.materialize_object_reconciliation(uuid,text,text,text,text,text,text,text,text,text,character,timestamptz)','EXECUTE')`);
      assert.equal(privilege, role === 'service_role' ? 't' : 'f', `${role} EXECUTE unchanged by the corrective migration (no GRANT/REVOKE in it)`);
    }
  });

  await t.test('3. source no longer contains the incompatible ON CONFLICT form; constraint-name filtering is exact', async () => {
    const source = (await owner(`select prosrc from pg_proc where oid=(select oid from pg_proc where pronamespace='gov_repo'::regnamespace and proname='materialize_object_reconciliation')`))
      .replace(/--[^\r\n]*/g, '');
    assert.doesNotMatch(source, /on conflict on constraint normalized_mapping_identity_unique/i, 'the incompatible ON CONFLICT form is gone');
    // materialization_locks carries no rewrite rule, so its OWN, pre-existing, untouched
    // ON CONFLICT (organisation_id, reconciliation_decision_id) DO NOTHING idempotency gate is
    // expected to remain; only the ON CONFLICT against canonical_normalized_object_mappings
    // (the one that actually collides with a rewrite rule) had to be replaced.
    assert.doesNotMatch(source, /canonical_normalized_object_mappings[\s\S]{0,400}\bon conflict\b/i, 'no ON CONFLICT reaches the ruled table any more');
    assert.match(source, /get stacked diagnostics\s+\S+\s*=\s*constraint_name/i, 'uses GET STACKED DIAGNOSTICS ... CONSTRAINT_NAME');
    assert.match(source, /normalized_mapping_identity_unique/, 'still names the exact constraint it resolves');
    assert.match(source, /is distinct from\s+'normalized_mapping_identity_unique'[\s\S]{0,40}then[\s\S]{0,20}raise;/i,
      'any OTHER constraint name is re-raised unchanged, never swallowed');
    assert.match(source, /normalized_mapping_no_update|canonical_normalized_object_mappings/); // sanity: still the right function
  });

  // =====================================================================================
  let target1: string, target1Fp: string, target1Candidate: Candidate;
  await t.test('4. CREATE_NEW object materialization succeeds after the fix (identical decision retried)', async () => {
    // The candidate/finding/review_subject/decision/invocation from test 1 already exist
    // (that failed statement's own transaction rolled back, but its FIXTURE rows were
    // inserted and committed BEFORE the materialize call, in separate statements) — reuse
    // them unchanged; retrying the SAME decision proves the fix on the exact prior failure.
    const existingCand: Candidate = { candidate: 'candidate:baseline', finding: 'finding-baseline', subject: 'review-baseline', conn: 'conn-baseline', extType: 'source', extId: 'baseline.ts', kind: 'MODEL' };
    const decision: Decision = { decisionId: 'decision-baseline', invocationId: 'invocation-baseline', canonicalObjectId: 'canonical-object:baseline', outcome: 'CREATE_NEW' };
    const row = JSON.parse(lastLine(await svc(materializeSql(existingCand, decision, 'baseline'))));
    assert.equal(row.replay, false);
    assert.equal(row.status, 'APPLIED');
    assert.equal(row.canonical_object_id, decision.canonicalObjectId);
    assert.ok(row.mapping_id);
    assert.deepEqual(Object.keys(row).sort(), ['canonical_object_id', 'mapping_id', 'replay', 'status'], '12. return columns unchanged');
    target1 = decision.canonicalObjectId;
    target1Fp = sha256('baseline');
    target1Candidate = existingCand;
    assert.equal(await owner(`select count(*) from gov_repo.canonical_objects where organisation_id='${org}' and canonical_object_id='${target1}'`), '1');
    assert.equal(await owner(`select count(*) from gov_repo.outbox_events where organisation_id='${org}' and event_type='GOVERNANCE_CANONICAL_OBJECT_MATERIALIZED'`), '1');
  });

  await t.test('5. replay of the same decision returns replay=true and duplicates nothing', async () => {
    const decision: Decision = { decisionId: 'decision-baseline', invocationId: 'invocation-baseline', canonicalObjectId: target1, outcome: 'CREATE_NEW' };
    const before = await countsSql();
    const row = JSON.parse(lastLine(await svc(materializeSql(target1Candidate, decision, 'baseline'))));
    assert.equal(row.replay, true);
    assert.equal(row.status, 'APPLIED');
    assert.equal(row.canonical_object_id, target1);
    assert.equal(await countsSql(), before, 'replay wrote nothing new (mapping/materialization/outbox counts unchanged)');
  });

  let target2: string;
  await t.test('setup: a second, independent MODEL canonical object (target2), for the incompatible-target case', async () => {
    const cand = await seedObjectCandidate('target2', 'MODEL', { modelReference: 'model-target2' });
    const decision = await authorizeObject('target2', cand, 'CREATE_NEW', 'canonical-object:target2');
    const row = JSON.parse(lastLine(await svc(materializeSql(cand, decision, 'target2'))));
    assert.equal(row.replay, false);
    target2 = decision.canonicalObjectId;
  });

  await t.test('7. MATCH_EXISTING object materialization succeeds (new source identity, existing target1)', async () => {
    const cand = await seedObjectCandidate('match-existing', 'MODEL', { modelReference: 'model-match-existing' });
    const decision = await authorizeObject('match-existing', cand, 'MATCH_EXISTING', target1);
    const before = await countsSql();
    const row = JSON.parse(lastLine(await svc(materializeSql(cand, decision, 'match-existing'))));
    assert.equal(row.replay, false);
    assert.equal(row.status, 'APPLIED');
    assert.equal(row.canonical_object_id, target1);
    assert.ok(row.mapping_id);
    const [beforeObjects] = before.split(':');
    const [afterObjects, afterMappings] = (await countsSql()).split(':');
    assert.equal(afterObjects, beforeObjects, 'MATCH_EXISTING creates no new canonical object');
    assert.equal(Number(afterMappings) >= 1, true);
  });

  await t.test('8. same normalized identity + compatible existing mapping resolves to the EXISTING mapping (no duplicate row)', async () => {
    // Same source_connection_id/external_type/external_id/kind AND same proposedIdentity as
    // test 4's target1 candidate => identical normalized_object_identity. Different candidate/
    // finding/decision, same MATCH_EXISTING target (target1) => "compatible".
    const cand = await seedObjectCandidate('compat', 'MODEL', { modelReference: 'model-baseline' }, { conn: 'conn-baseline', extType: 'source', extId: 'baseline.ts' });
    const decision = await authorizeObject('compat', cand, 'MATCH_EXISTING', target1);
    const beforeMappingCount = await owner(`select count(*) from gov_repo.canonical_normalized_object_mappings where organisation_id='${org}'
      and source_connection_id='conn-baseline' and source_external_type='source' and source_external_id='baseline.ts' and canonical_object_kind='MODEL'`);
    assert.equal(beforeMappingCount, '1', 'exactly one existing mapping row for this normalized identity before the compatible call');
    const existing = await mappingRow('conn-baseline', 'source', 'baseline.ts', 'MODEL');
    const row = JSON.parse(lastLine(await svc(materializeSql(cand, decision, 'compat'))));
    assert.equal(row.replay, false, 'this is a NEW decision, not a replay of decision-baseline');
    assert.equal(row.status, 'APPLIED');
    assert.equal(row.canonical_object_id, target1);
    assert.equal(`${row.mapping_id}:${target1}`, existing, 'the EXISTING mapping_id is reused, never a new one');
    const afterMappingCount = await owner(`select count(*) from gov_repo.canonical_normalized_object_mappings where organisation_id='${org}'
      and source_connection_id='conn-baseline' and source_external_type='source' and source_external_id='baseline.ts' and canonical_object_kind='MODEL'`);
    assert.equal(afterMappingCount, '1', 'no duplicate mapping row was inserted for the identical normalized identity');
  });

  await t.test('9. same normalized identity + DIFFERENT canonical target fails NORMALIZED_MAPPING_CONFLICT; zero mutation', async () => {
    const cand = await seedObjectCandidate('incompat', 'MODEL', { modelReference: 'model-baseline' }, { conn: 'conn-baseline', extType: 'source', extId: 'baseline.ts' });
    const decision = await authorizeObject('incompat', cand, 'MATCH_EXISTING', target2);
    const before = await countsSql();
    await rejects(materializeSql(cand, decision, 'incompat'), (message: string) => {
      assert.match(message, /23514/);
      assert.match(message, /NORMALIZED_MAPPING_CONFLICT/);
    });
    assert.equal(await countsSql(), before, 'the incompatible attempt left zero mutation (the unique-violation catch never inserted, and the whole statement rolled back on the subsequent raise)');
  });

  // =====================================================================================
  // B0 TEST HARDENING (independent-review deltas). These strengthen coverage only; the
  // already-audited 20260925175000 migration is not modified by any test in this file.
  await t.test('B0-hardening B: an UNEXPECTED unique violation propagates unchanged; it never becomes NORMALIZED_MAPPING_CONFLICT', async () => {
    // Test-only, deterministic, real PG17 constraint scoped to a connection this test owns
    // exclusively (created empty — earlier tests already hold other mapping rows for this org,
    // so an org-wide singleton index could not even be created). Forces at most one mapping row
    // for that one connection, entirely unrelated to normalized_mapping_identity_unique. A
    // SECOND, non-colliding (different normalized identity) plain INSERT under the same
    // connection still raises 23505, but on THIS index, not on the resolvable one.
    const conn = 'conn-unexpected-unique';
    await owner(`create unique index test_only_singleton_mapping_per_conn on gov_repo.canonical_normalized_object_mappings ((1)) where source_connection_id='${conn}';`);
    try {
      const first = await seedObjectCandidate('unexpected-unique-1', 'MODEL', { modelReference: 'model-unexpected-unique-1' }, { conn });
      const firstDecision = await authorizeObject('unexpected-unique-1', first, 'MATCH_EXISTING', target1);
      const firstRow = JSON.parse(lastLine(await svc(materializeSql(first, firstDecision, 'unexpected-unique-1'))));
      assert.equal(firstRow.replay, false, 'the first mapping under this connection is created normally, occupying the test-only singleton slot');

      const second = await seedObjectCandidate('unexpected-unique-2', 'MODEL', { modelReference: 'model-unexpected-unique-2' }, { conn });
      const secondDecision = await authorizeObject('unexpected-unique-2', second, 'MATCH_EXISTING', target1);
      const before = await countsSql();
      await rejects(materializeSql(second, secondDecision, 'unexpected-unique-2'), (message: string) => {
        assert.match(message, /23505/, 'the ORIGINAL unique_violation SQLSTATE propagates, not a re-coded one');
        assert.match(message, /test_only_singleton_mapping_per_conn/, 'the message names the ACTUAL violated constraint');
        assert.doesNotMatch(message, /NORMALIZED_MAPPING_CONFLICT/, 'an unrelated constraint name must never be treated as the resolvable one');
      });
      assert.equal(await countsSql(), before, 'the unexpected violation was a hard failure: zero mutation, never a resolved/caught conflict');
    } finally {
      await owner(`drop index gov_repo.test_only_singleton_mapping_per_conn;`);
    }
  });

  await t.test('B0-hardening C: same normalized identity + a DIFFERENT resolved parent gives NORMALIZED_MAPPING_CONFLICT', async () => {
    // AGENT_VERSION/DATA_ELEMENT are the only kinds with a resolved parent. Two independent
    // AGENT canonical objects (distinct parents) are materialized first; two independent
    // AGENT_VERSION discovery candidates then deliberately claim the SAME envelope candidateId
    // (== normalized_object_identity) while each resolving to its OWN, different parent agent —
    // a real UNIQUE-key collision with genuinely incompatible parents, not a mocked check.
    const agentA = await seedObjectCandidate('parent-agent-a', 'AGENT', { agentCode: 'agent-parent-a' });
    const agentADecision = await authorizeObject('parent-agent-a', agentA, 'CREATE_NEW', 'canonical-object:parent-agent-a');
    assert.equal(JSON.parse(lastLine(await svc(materializeSql(agentA, agentADecision, 'parent-agent-a')))).replay, false);

    const agentB = await seedObjectCandidate('parent-agent-b', 'AGENT', { agentCode: 'agent-parent-b' });
    const agentBDecision = await authorizeObject('parent-agent-b', agentB, 'CREATE_NEW', 'canonical-object:parent-agent-b');
    assert.equal(JSON.parse(lastLine(await svc(materializeSql(agentB, agentBDecision, 'parent-agent-b')))).replay, false);

    const sharedIdentity = `candidate:agent-version:${'f'.repeat(32)}`;
    async function seedAgentVersion(label: string, parentAgent: Candidate): Promise<Candidate> {
      const conn = 'conn-parent-shared', extType = 'source', extId = 'parent-shared.ts';
      const candidate = `candidate:${label}`, finding = `finding-${label}`, subject = `review-${label}`;
      const proposedIdentity = { agent: { referenceKind: 'CANDIDATE', candidateKind: 'AGENT', candidateId: parentAgent.candidate } };
      // This row's OWN candidate_id (PK) differs per label; its envelope deliberately claims the
      // SAME candidateId/normalized identity as the other row — the identity string, per
      // gov_repo.normalized_object_identity, is exactly envelope->>'candidateId', independent of
      // the row's own candidate_id column.
      const envelope = { candidateId: sharedIdentity, candidateKind: 'AGENT_VERSION', sourceObject: { connectionId: conn, externalType: extType, externalId: extId },
        findingId: finding, assertionIds: [], evidenceIds: [], confidence: 1, requiresReconciliation: true, proposedIdentity };
      await owner(`
        insert into gov_repo.discovery_findings(organisation_id,finding_id,finding_nature,candidate_kind,source_connection_id,source_external_type,source_external_id,
          confidence,review_status,requires_review,creates_canonical_object,detected_at,acquisition_run_id,contract_version,envelope,envelope_hash)
          values('${org}',${lit(finding)},'CANDIDATE','AGENT_VERSION',${lit(conn)},${lit(extType)},${lit(extId)},1,'ACCEPTED',true,false,now(),${lit(run)},'1.0','{}',${HASH});
        insert into gov_repo.discovery_candidates(organisation_id,candidate_id,candidate_kind,candidate_family,finding_id,source_connection_id,source_external_type,source_external_id,
          confidence,requires_reconciliation,proposed_identity,acquisition_run_id,contract_version,envelope,envelope_hash)
          values('${org}',${lit(candidate)},'AGENT_VERSION','OBJECT',${lit(finding)},${lit(conn)},${lit(extType)},${lit(extId)},1,true,${jsonLit(proposedIdentity)},${lit(run)},'1.0',${jsonLit(envelope)},${HASH});
        insert into gov_repo.review_subjects(review_subject_id,organisation_id,finding_id,candidate_kind,source_connection_id,source_external_type,source_external_id,state,detected_at)
          values(${lit(subject)},'${org}',${lit(finding)},'AGENT_VERSION',${lit(conn)},${lit(extType)},${lit(extId)},'CERTIFIED',now());`);
      return { candidate, finding, subject, conn, extType, extId, kind: 'AGENT_VERSION' };
    }

    const targetId = 'canonical-object:parent-av-target';
    const av1 = await seedAgentVersion('parent-av-1', agentA);
    const av1Decision = await authorizeObject('parent-av-1', av1, 'CREATE_NEW', targetId);
    const av1Row = JSON.parse(lastLine(await svc(materializeSql(av1, av1Decision, 'parent-av-1'))));
    assert.equal(av1Row.replay, false);
    assert.equal(av1Row.canonical_object_id, targetId);

    const av2 = await seedAgentVersion('parent-av-2', agentB); // same identity, DIFFERENT resolved parent
    const av2Decision = await authorizeObject('parent-av-2', av2, 'MATCH_EXISTING', targetId);
    const before = await countsSql();
    await rejects(materializeSql(av2, av2Decision, 'parent-av-2'), (message: string) => {
      assert.match(message, /23514/);
      assert.match(message, /NORMALIZED_MAPPING_CONFLICT/);
    });
    assert.equal(await countsSql(), before, 'the parent-incompatible attempt left zero mutation');
  });

  await t.test('B0-hardening D: replaying decision-baseline with a DIFFERENT idempotency fingerprint retains MATERIALIZATION_IDEMPOTENCY_CONFLICT', async () => {
    const decision: Decision = { decisionId: 'decision-baseline', invocationId: 'invocation-baseline', canonicalObjectId: target1, outcome: 'CREATE_NEW' };
    const before = await countsSql();
    await rejects(materializeSql(target1Candidate, decision, 'a-completely-different-fingerprint'), (message: string) => {
      assert.match(message, /23514/);
      assert.match(message, /MATERIALIZATION_IDEMPOTENCY_CONFLICT/);
    });
    assert.equal(await countsSql(), before, 'zero mutation from the mismatched-fingerprint replay attempt');
  });

  // =====================================================================================
  await t.test('10. concurrent same-identity materialization: two real PG sessions race the real UNIQUE constraint', async () => {
    const identityLabel = 'race';
    const conn = `conn-${identityLabel}`, extType = 'source', extId = `${identityLabel}.ts`;
    const candA = await seedObjectCandidate(`${identityLabel}-a`, 'MODEL', { modelReference: `model-${identityLabel}` }, { conn, extType, extId });
    const candB = await seedObjectCandidate(`${identityLabel}-b`, 'MODEL', { modelReference: `model-${identityLabel}` }, { conn, extType, extId });
    const decisionA = await authorizeObject(`${identityLabel}-a`, candA, 'MATCH_EXISTING', target1);
    const decisionB = await authorizeObject(`${identityLabel}-b`, candB, 'MATCH_EXISTING', target1);

    const blocker = pg.session('m16_bootstrap');
    const sessionA = pg.session('service_role');
    const sessionB = pg.session('service_role');
    try {
      const pidOf = async (session: ReturnType<typeof pg.session>) => (await session.run('select pg_backend_pid();')).out.trim();
      async function awaitBlocked(blockedPid: string, holderPid: string) {
        for (let i = 0; i < 500; i++) {
          const state = (await blocker.run(`select coalesce((select wait_event_type from pg_stat_activity where pid=${blockedPid}),'')
            ||':'||(pg_blocking_pids(${blockedPid}) @> array[${holderPid}])::text;`)).out.trim();
          if (state === 'Lock:true') return;
          await new Promise(resolve => setTimeout(resolve, 20));
        }
        assert.fail(`session ${blockedPid} never observed blocked by ${holderPid}`);
      }
      const [aPid, bPid, blockerPid] = await Promise.all([pidOf(sessionA), pidOf(sessionB), pidOf(blocker)]);

      // A blocks AFTER its mapping insert (uncommitted) but BEFORE materialization_operations,
      // by contending on a table lock a bootstrap session holds — proving A's row genuinely
      // exists (uncommitted) before B ever starts, matching the CASE A/B ordering required.
      await blocker.run('begin; lock table gov_repo.materialization_operations in share row exclusive mode;');
      const pendingA = sessionA.run(materializeSql(candA, decisionA, `${identityLabel}-a`));
      await awaitBlocked(aPid, blockerPid);

      // B starts a REAL, independent call for a DIFFERENT decision (own materialization_locks
      // row: no contention there) and blocks on the real UNIQUE index, waiting on A's
      // uncommitted duplicate key — never a mocked race.
      const pendingB = sessionB.run(materializeSql(candB, decisionB, `${identityLabel}-b`));
      await awaitBlocked(bPid, aPid);

      await blocker.run('rollback;'); // release A's remaining path; A's statement now auto-commits.
      const resultA = await pendingA;
      assert.equal(resultA.err, '', resultA.err);
      const rowA = JSON.parse(lastLine(resultA.out));
      assert.equal(rowA.replay, false);

      // A committed (not aborted): B's blocked INSERT now raises unique_violation, is caught,
      // and resolves to A's just-committed mapping (compatible: same target1, same parent NULL).
      const resultB = await pendingB;
      assert.equal(resultB.err, '', resultB.err);
      const rowB = JSON.parse(lastLine(resultB.out));
      assert.equal(rowB.replay, false, 'B is a new decision, not a replay');
      assert.equal(rowB.mapping_id, rowA.mapping_id, 'B reused the SAME mapping A committed, rather than erroring or duplicating');

      const mappingCount = await owner(`select count(*) from gov_repo.canonical_normalized_object_mappings where organisation_id='${org}'
        and source_connection_id='${conn}' and source_external_type='${extType}' and source_external_id='${extId}' and canonical_object_kind='MODEL'`);
      assert.equal(mappingCount, '1', 'exactly one durable mapping row for the raced identity');
      const opCount = await owner(`select count(*) from gov_repo.materialization_operations where organisation_id='${org}'
        and reconciliation_decision_id in ('${decisionA.decisionId}','${decisionB.decisionId}')`);
      assert.equal(opCount, '2', 'both decisions independently recorded their own materialization operation');
    } finally {
      await Promise.all([blocker.close(), sessionA.close(), sessionB.close()]);
    }
  });

  await t.test('winner-abort: if the first INSERT rolls back, the blocked second session succeeds normally (no exception path taken)', async () => {
    const identityLabel = 'abort';
    const conn = `conn-${identityLabel}`, extType = 'source', extId = `${identityLabel}.ts`;
    const candA = await seedObjectCandidate(`${identityLabel}-a`, 'MODEL', { modelReference: `model-${identityLabel}` }, { conn, extType, extId });
    const candB = await seedObjectCandidate(`${identityLabel}-b`, 'MODEL', { modelReference: `model-${identityLabel}` }, { conn, extType, extId });
    const decisionA = await authorizeObject(`${identityLabel}-a`, candA, 'MATCH_EXISTING', target1);
    const decisionB = await authorizeObject(`${identityLabel}-b`, candB, 'MATCH_EXISTING', target1);

    const sessionA = pg.session('service_role');
    const sessionB = pg.session('service_role');
    const monitor = pg.session('m16_bootstrap');
    try {
      const pidOf = async (session: ReturnType<typeof pg.session>) => (await session.run('select pg_backend_pid();')).out.trim();
      async function awaitBlocked(blockedPid: string, holderPid: string) {
        for (let i = 0; i < 500; i++) {
          const state = (await monitor.run(`select coalesce((select wait_event_type from pg_stat_activity where pid=${blockedPid}),'')
            ||':'||(pg_blocking_pids(${blockedPid}) @> array[${holderPid}])::text;`)).out.trim();
          if (state === 'Lock:true') return;
          await new Promise(resolve => setTimeout(resolve, 20));
        }
        assert.fail(`session ${blockedPid} never observed blocked by ${holderPid}`);
      }
      const [aPid, bPid] = await Promise.all([pidOf(sessionA), pidOf(sessionB)]);
      await sessionA.run('begin;');
      const resultAWrite = await sessionA.run(materializeSql(candA, decisionA, `${identityLabel}-a`));
      assert.equal(resultAWrite.err, '', resultAWrite.err); // A's whole function body succeeded, transaction still OPEN (no commit yet)

      const pendingB = sessionB.run(materializeSql(candB, decisionB, `${identityLabel}-b`));
      await awaitBlocked(bPid, aPid); // B blocks on A's UNCOMMITTED duplicate key

      await sessionA.run('rollback;'); // the winner aborts: its mapping row (and everything else it wrote) never existed
      const resultB = await pendingB;
      assert.equal(resultB.err, '', resultB.err);
      const rowB = JSON.parse(lastLine(resultB.out));
      assert.equal(rowB.replay, false, 'B succeeded as a normal first insert, never entering the exception-catch path');

      assert.equal(await owner(`select count(*) from gov_repo.materialization_locks where organisation_id='${org}' and reconciliation_decision_id='${decisionA.decisionId}'`),
        '0', "A's aborted attempt left no trace, including its own idempotency lock row");
      assert.equal(await owner(`select count(*) from gov_repo.canonical_normalized_object_mappings where organisation_id='${org}'
        and source_connection_id='${conn}' and source_external_type='${extType}' and source_external_id='${extId}'`), '1', "exactly B's mapping survives");
    } finally {
      await Promise.all([sessionA.close(), sessionB.close(), monitor.close()]);
    }
  });

  // =====================================================================================
  await t.test('6. normalized-mapping UPDATE remains immutable (genuinely value-changing update is silently discarded)', async () => {
    // A. Not MANUAL -> MANUAL (a no-op even without the rule). valid_from carries no CHECK
    // constraint and is otherwise freely settable; setting it decades into the past WOULD
    // visibly change the stored row if the rule did not intercept the UPDATE.
    const where = `organisation_id='${org}' and source_connection_id='conn-baseline' and source_external_type='source'
      and source_external_id='baseline.ts' and canonical_object_kind='MODEL'`;
    const before = await owner(`select valid_from::text||':'||mapping_id from gov_repo.canonical_normalized_object_mappings where ${where}`);
    const [beforeValidFrom] = before.split(':');
    assert.notEqual(beforeValidFrom, '2020-01-01 00:00:00+00', 'sanity: the pre-update value is not already the value we are about to try to set');
    await owner(`update gov_repo.canonical_normalized_object_mappings set valid_from='2020-01-01T00:00:00Z'::timestamptz,
      match_method='NOT_MANUAL_WOULD_VIOLATE_CHECK_IF_APPLIED' where ${where};`);
    const after = await owner(`select valid_from::text||':'||mapping_id||':'||match_method from gov_repo.canonical_normalized_object_mappings where ${where}`);
    assert.equal(after, `${before}:MANUAL`, 'the DO INSTEAD NOTHING rule silently discarded the ENTIRE update: valid_from and match_method are both exactly as before');
  });

  await t.test('6b. normalized_mapping_no_update / normalized_mapping_no_delete rules themselves are untouched by the corrective migration', async () => {
    assert.equal(await owner(`select count(*) from pg_rewrite r join pg_class c on c.oid=r.ev_class
      where c.relname='canonical_normalized_object_mappings' and r.rulename in ('normalized_mapping_no_update','normalized_mapping_no_delete')
      and r.ev_type in ('2','4') and r.is_instead`), '2', 'both immutability rules (UPDATE and DELETE, INSTEAD) still exist');
  });

  await t.test('7d. normalized-mapping DELETE remains immutable (silent no-op, row survives)', async () => {
    const before = await owner(`select count(*) from gov_repo.canonical_normalized_object_mappings where organisation_id='${org}'
      and source_connection_id='conn-baseline' and source_external_type='source' and source_external_id='baseline.ts' and canonical_object_kind='MODEL'`);
    assert.equal(before, '1');
    await owner(`delete from gov_repo.canonical_normalized_object_mappings where organisation_id='${org}'
      and source_connection_id='conn-baseline' and source_external_type='source' and source_external_id='baseline.ts' and canonical_object_kind='MODEL';`);
    const after = await owner(`select count(*) from gov_repo.canonical_normalized_object_mappings where organisation_id='${org}'
      and source_connection_id='conn-baseline' and source_external_type='source' and source_external_id='baseline.ts' and canonical_object_kind='MODEL'`);
    assert.equal(after, '1', 'the DO INSTEAD NOTHING rule silently discarded the DELETE; the row still exists');
  });

  // =====================================================================================
  await t.test('11. gov_repo.materialize_relationship_reconciliation (never modified) remains green end-to-end', async () => {
    const source = await seedObjectCandidate('rel-src', 'MCP_SERVER', { serverReference: 'server-rel' });
    const sourceDecision = await authorizeObject('rel-src', source, 'CREATE_NEW', 'canonical-object:rel-src');
    const srcRow = JSON.parse(lastLine(await svc(materializeSql(source, sourceDecision, 'rel-src'))));
    assert.equal(srcRow.replay, false);

    const target = await seedObjectCandidate('rel-tgt', 'TOOL', { declarationKey: 'tool-rel' });
    const targetDecision = await authorizeObject('rel-tgt', target, 'CREATE_NEW', 'canonical-object:rel-tgt');
    const tgtRow = JSON.parse(lastLine(await svc(materializeSql(target, targetDecision, 'rel-tgt'))));
    assert.equal(tgtRow.replay, false);

    const candidate = 'candidate:rel-edge', finding = 'finding-rel-edge', subject = 'review-rel-edge';
    const envelope = { candidateId: candidate, candidateKind: 'RELATIONSHIP', assertionIds: ['assertion-rel-edge'], evidenceIds: ['evidence-rel-edge'] };
    await owner(`
      insert into gov_repo.discovery_findings(organisation_id,finding_id,finding_nature,candidate_kind,source_connection_id,source_external_type,source_external_id,
        confidence,review_status,requires_review,creates_canonical_object,detected_at,acquisition_run_id,contract_version,envelope,envelope_hash)
        values('${org}',${lit(finding)},'CANDIDATE','RELATIONSHIP','conn-rel-edge','source','rel-edge',1,'ACCEPTED',true,false,now(),${lit(run)},'1.0','{}',${HASH});
      insert into gov_repo.discovery_candidates(organisation_id,candidate_id,candidate_kind,candidate_family,finding_id,source_connection_id,source_external_type,source_external_id,
        confidence,requires_reconciliation,relationship_type_code,source_endpoint,target_endpoint,acquisition_run_id,contract_version,envelope,envelope_hash)
        values('${org}',${lit(candidate)},'RELATIONSHIP','RELATIONSHIP',${lit(finding)},'conn-rel-edge','source','rel-edge',1,true,'EXPOSES',
        ${jsonLit({ referenceKind: 'CANDIDATE', candidateKind: 'MCP_SERVER', candidateId: source.candidate })},
        ${jsonLit({ referenceKind: 'CANDIDATE', candidateKind: 'TOOL', candidateId: target.candidate })},${lit(run)},'1.0',${jsonLit(envelope)},${HASH});
      insert into gov_repo.review_subjects(review_subject_id,organisation_id,finding_id,candidate_kind,source_connection_id,source_external_type,source_external_id,state,detected_at)
        values(${lit(subject)},'${org}',${lit(finding)},'RELATIONSHIP','conn-rel-edge','source','rel-edge','CERTIFIED',now());`);

    // Mirrors gov_repo.frame_identity(text[]) exactly: octet_length-prefixed concatenation, in order.
    const frameIdentity = (parts: string[]) => parts.map(part => `${Buffer.byteLength(part, 'utf8')}:${part}`).join('');
    const relationshipId = `canonical-relationship:${createHash('sha256')
      .update(frameIdentity([org, 'EXPOSES', 'canonical-object:rel-src', 'canonical-object:rel-tgt']), 'utf8').digest('hex')}`;
    const stateId = `${relationshipId}:initial`;
    const validFrom = '2026-09-01T00:00:00.000Z';
    const decisionEnvelope = { organisationId: org, decisionId: 'decision-rel-edge', outcome: 'CREATE_NEW', authority: { authorityKind: 'HUMAN', actorReference: 'fixture-admin' },
      assertionIds: ['assertion-rel-edge'], evidenceIds: ['evidence-rel-edge'],
      authorizedState: { organisationId: org, relationshipId, relationshipStateId: stateId, relationshipType: 'EXPOSES', validFrom, recordedAt: validFrom,
        source: { canonicalObject: { organisationId: org, objectId: 'canonical-object:rel-src', kind: 'MCP_SERVER' } },
        target: { canonicalObject: { organisationId: org, objectId: 'canonical-object:rel-tgt', kind: 'TOOL' } } } };
    await svc(`select 1 from gov_repo.record_authorized_reconciliation(${named({
      p_organisation_id: `'${org}'::uuid`, p_review_subject_id: lit(subject), p_authorization_decision_id: lit('authz-rel-edge'),
      p_authorization_actor_reference: lit('fixture-admin'), p_authorization_subject_kind: `'CANDIDATE'`, p_authorization_subject_candidate_id: lit(candidate),
      p_authorization_subject_candidate_merge_id: 'null::text', p_requested_action: `'CREATE_NEW'`, p_authorization_evaluated_at: 'now()',
      p_policy_reference: 'null::text', p_invocation_id: lit('invocation-rel-edge'), p_command_id: lit('cmd-rel-edge'), p_command_fingerprint: lit('fp-rel-edge'),
      p_requested_at: 'now()', p_reason_code: `'MANUAL_APPROVAL'`, p_decision_id: lit('decision-rel-edge'), p_family: `'RELATIONSHIP'`, p_outcome: `'CREATE_NEW'`,
      p_candidate_kind: `'RELATIONSHIP'`, p_authority_reference: lit('fixture-admin'), p_decided_at: 'now()', p_subject_candidate_id: 'null::text',
      p_subject_candidate_merge_id: 'null::text', p_canonical_object_id: 'null::text', p_canonical_object_kind: 'null::text',
      p_relationship_candidate_id: lit(candidate), p_relationship_type_code: `'EXPOSES'`, p_candidate_merge_id: 'null::text',
      p_merge_member_candidate_ids: `'{}'::text[]`, p_assertion_ids: `array[${lit('assertion-rel-edge')}]`, p_evidence_ids: `array[${lit('evidence-rel-edge')}]`,
      p_contract_version: `'1.1'`, p_envelope: jsonLit(decisionEnvelope), p_envelope_hash: HASH,
    })}) x;`);

    const before = await owner(`select count(*) from gov_repo.canonical_relationships where organisation_id='${org}'`);
    const row = JSON.parse(lastLine(await svc(`select to_json(m) from gov_repo.materialize_relationship_reconciliation(${named({
      p_organisation_id: `'${org}'::uuid`, p_reconciliation_decision_id: `'decision-rel-edge'`, p_invocation_id: `'invocation-rel-edge'`, p_outcome: `'CREATE_NEW'`,
      p_relationship_id: lit(relationshipId), p_relationship_state_id: lit(stateId), p_relationship_type: `'EXPOSES'`,
      p_source_canonical_object_id: `'canonical-object:rel-src'`, p_source_kind: `'MCP_SERVER'`, p_target_canonical_object_id: `'canonical-object:rel-tgt'`, p_target_kind: `'TOOL'`,
      p_valid_from: lit(validFrom), p_recorded_at: lit(validFrom), p_idempotency_fingerprint: lit(sha256('rel-edge')),
    })}) m;`)));
    assert.equal(row.replay, false);
    assert.equal(row.status, 'APPLIED');
    assert.equal(row.relationship_id, relationshipId);
    const after = await owner(`select count(*) from gov_repo.canonical_relationships where organisation_id='${org}'`);
    assert.equal(Number(after), Number(before) + 1, 'the unmodified relationship materializer wrote exactly one new edge');
  });
});
