import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { s0ExecutionContextClosureMigration } from '../helpers/disposable-m16-postgres';
import {
  APPROVED_SURFACE, fullChainCluster, r1PostflightAfterR2, r2Postflight, r3Postflight, s1b2Postflight,
} from '../helpers/m16-definer-surface-fixtures';
import * as fx from '../helpers/m16-governed-write-fixtures';

/** Types a caller can shadow with a same-named pg_temp domain (same technique as the S1B.2R2 suite). */
const SHADOWED = ['text', 'uuid', 'int2', 'int4', 'int8', 'numeric', 'bool', 'jsonb', 'json', 'timestamptz', 'timestamp', 'date', 'interval',
  'varchar', 'bpchar', 'bytea', 'float8', 'name', 'oid'] as const;
/** CHECK probe: raises only under a different current_user than the session user, i.e. inside a SECURITY DEFINER frame. */
const SHADOW = `create function pg_temp.r3_probe(v pg_catalog.anyelement) returns pg_catalog.bool language plpgsql as $probe$
  begin
    if current_user operator(pg_catalog.<>) session_user then
      raise exception 'R3_SHADOW_EXECUTED as % via %', current_user, pg_catalog.pg_typeof(v);
    end if;
    return true;
  end $probe$;
${SHADOWED.map(type => `create domain pg_temp.${type} as pg_catalog.${type} check (pg_temp.r3_probe(value));`).join('\n')}
`;
/** Inert shadow (no CHECK): isolates the frame-to-frame type-resolution inconsistency from any probe side effect. */
const INERT = `create domain pg_temp.text as pg_catalog.text; create domain pg_temp.jsonb as pg_catalog.jsonb;\n`;
/** One-shot shadowed-text CHECK that performs a CREATEROLE-only action as whoever runs it (service_role has no CREATEROLE). */
const escalate = (role: string) => `create function pg_temp.evil(v pg_catalog.text) returns pg_catalog.bool language plpgsql set search_path = pg_catalog, pg_temp as $e$
    begin
      if current_user operator(pg_catalog.=) session_user or pg_catalog.current_setting('r3.done', true) = '1' then return true; end if;
      perform pg_catalog.set_config('r3.done', '1', false);
      execute 'create role ${role} nologin';
      return true;
    end $e$;
    create domain pg_temp.text as pg_catalog.text check (pg_temp.evil(value));\n`;
const LEAK = /R3_SHADOW_EXECUTED as postgres/;
const lastLine = (out: string) => out.replace(/\r/g, '').trim().split('\n').pop() as string;

/** The ten routines R3 re-pins (existing path + pg_temp last); every other routine's catalog row must be byte-identical. */
const CORRECTED: ReadonlyArray<readonly [sig: string, before: string, after: string]> = [
  ['gov_repo.apply_review_transition(uuid,text,text,text,text,text,text,text,text,timestamp with time zone,text[],text,text,text)', 'gov_repo, pg_catalog', 'gov_repo, pg_catalog, pg_temp'],
  ['gov_repo.record_authorized_reconciliation(uuid,text,text,text,text,text,text,text,timestamp with time zone,text,text,text,text,timestamp with time zone,text,text,text,text,text,text,timestamp with time zone,text,text,text,text,text,text,text,text[],text[],text[],text,jsonb,character)', 'gov_repo, pg_catalog', 'gov_repo, pg_catalog, pg_temp'],
  ['gov_repo.guard_final_review_decision()', 'gov_repo, pg_catalog', 'gov_repo, pg_catalog, pg_temp'],
  ['gov_repo.materialize_object_reconciliation(uuid,text,text,text,text,text,text,text,text,text,character,timestamp with time zone)', 'gov_repo, pg_catalog', 'gov_repo, pg_catalog, pg_temp'],
  ['gov_repo.legacy_canonical_object_for_candidate(uuid,jsonb)', 'gov_repo, pg_catalog', 'gov_repo, pg_catalog, pg_temp'],
  ['gov_repo.materialize_relationship_reconciliation(uuid,text,text,text,text,text,text,text,text,text,text,timestamp with time zone,timestamp with time zone,character)', 'gov_repo, pg_catalog', 'gov_repo, pg_catalog, pg_temp'],
  ['gov_repo.resolve_canonical_endpoint(uuid,jsonb)', 'gov_repo, pg_catalog', 'gov_repo, pg_catalog, pg_temp'],
  ['gov_repo.record_technical_field_decision(uuid,jsonb)', 'gov_repo, pg_catalog', 'gov_repo, pg_catalog, pg_temp'],
  ['gov_repo.record_execution_field_decision(uuid,jsonb)', 'pg_catalog', 'pg_catalog, pg_temp'],
  ['gov_repo.technical_field_valid(text,text)', 'pg_catalog', 'pg_catalog, pg_temp'],
];
const WRAPPERS = ['apply_review_transition_governed_v1', 'record_authorized_reconciliation_governed_v1', 'materialize_object_reconciliation_governed_v1',
  'materialize_relationship_reconciliation_governed_v1', 'record_technical_field_decision_governed_v1', 'record_execution_field_decision_governed_v1'] as const;
type Wrapper = typeof WRAPPERS[number];

/**
 * M16-S1B.2R3 S0 governed-wrapper execution-context closure (disposable PG17, full primary chain + R1 + R2 -> R3).
 * BEFORE: the frozen S0 wrappers pin `pg_catalog, pg_temp`, but ten inner routines pin a path without pg_temp, so a caller
 * pg_temp type shadow resolves differently in the wrapper frame and the inner frame — the caller's CHECK runs as postgres
 * inside every wrapper, five wrappers fail with 42804, and a CREATEROLE-only action persists through the one that commits.
 * AFTER R3: the same calls behave exactly per the frozen S0 contracts.
 */
test('M16 S1B.2R3 S0 execution-context closure (disposable PG17, full primary chain + R1 + R2 -> R3)', { timeout: 1_800_000 }, async t => {
  const pg = await fullChainCluster(message => t.diagnostic(message), { r2: true });
  t.after(() => pg.stop());
  const { owner, svc, bootstrapSql, inventory } = pg;
  const users = 'gov_repo.governance_users';
  const adminRole = await owner(`select role_id from gov_repo.governance_roles where role_code='GOVERNANCE_ADMIN' and is_system_role`);
  const plainRole = randomUUID();
  await owner(`insert into gov_repo.governance_roles(role_id,role_code,role_name,role_tier,is_system_role) values('${plainRole}','R3_NON_ADMIN','Non-admin','organisation',false)`);

  let n = 0;
  interface Scenario { readonly wrapper: Wrapper; readonly label: string; readonly call: string; readonly counts: string; readonly expect: Record<string, unknown> }
  async function scenario(wrapper: Wrapper, admin = true): Promise<Scenario> {
    const org = randomUUID(), actor = randomUUID(), label = `r3s${++n}`;
    await owner(`insert into gov_repo.organisations(organisation_id,org_code,legal_name,display_name,country_code,is_active) values('${org}','R3S_${n}','R ${n}','R ${n}','PT',true);
      insert into ${users}(user_id,email,full_name,organisation_id,status,role_ids) values('${actor}','${actor}@example.invalid','F','${org}','active',array['${admin ? adminRole : plainRole}']::uuid[])`);
    await bootstrapSql(`begin; alter table ${users} disable trigger trg_governance_users_credential_epoch_v1;
      update ${users} set password_changed_at=clock_timestamp() - interval '12 hours' where user_id='${actor}';
      alter table ${users} enable always trigger trg_governance_users_credential_epoch_v1; commit;`);
    const epoch = await owner(`select password_changed_at::text from ${users} where user_id='${actor}'`);
    const principal = { p_verified_organisation_id: `'${org}'::uuid`, p_verified_actor_user_id: `'${actor}'::uuid`,
      p_verified_session_iat: '(floor(extract(epoch from clock_timestamp()))::bigint - 10)',
      p_verified_session_exp: '(floor(extract(epoch from clock_timestamp()))::bigint + 3600)', p_verified_credential_epoch: `'${epoch}'::timestamptz` };
    const count = (table: string) => `(select count(*) from gov_repo.${table} where organisation_id='${org}')`;
    const counts = (...tables: string[]) => `select ${tables.map(count).join(`||':'||`)};`;
    const call = (args: Record<string, string>) => `select to_json(w) from gov_repo.${wrapper}(${fx.named({ ...principal, ...args })}) w;`;
    switch (wrapper) {
      case 'apply_review_transition_governed_v1': {
        const kit = fx.reviewedObjectKit(org, label, 'DETECTED');
        await owner(kit.sql);
        return { wrapper, label, call: call(fx.reviewTransitionArgs(label, kit)), counts: counts('review_audit_events', 'outbox_events'),
          expect: { event_id: `evt-${label}`, review_subject_id: kit.subject, previous_state: 'DETECTED', new_state: 'PROPOSED', revision: 1, state: 'PROPOSED' } };
      }
      case 'record_authorized_reconciliation_governed_v1': {
        const kit = fx.reviewedObjectKit(org, label, 'CERTIFIED');
        await owner(kit.sql);
        return { wrapper, label, call: call(fx.governedReconciliationArgs(label, org, kit, actor)),
          counts: counts('reconciliation_decisions', 'reconciliation_invocations', 'authorization_decisions', 'outbox_events', 'reconciliation_command_locks'),
          expect: { authorization_decision_id: `authz-${label}`, invocation_id: `invocation-${label}`, reconciliation_decision_id: `decision-${label}` } };
      }
      case 'materialize_object_reconciliation_governed_v1': {
        const kit = fx.reviewedObjectKit(org, label, 'CERTIFIED');
        await owner(kit.sql);
        await owner(fx.legacyReconciliationSql(label, org, kit, actor));
        return { wrapper, label, call: call(fx.materializeObjectArgs(label, kit)),
          counts: counts('materialization_operations', 'canonical_objects', 'canonical_normalized_object_mappings', 'outbox_events', 'materialization_locks'),
          expect: { canonical_object_id: kit.canonicalObjectId } };
      }
      case 'materialize_relationship_reconciliation_governed_v1': {
        const kit = fx.relationshipKit(org, label, actor);
        await owner(kit.sql);
        await owner(kit.legacyDecisionSql);
        return { wrapper, label, call: call(kit.args), counts: counts('materialization_operations', 'canonical_relationships', 'outbox_events', 'materialization_locks'),
          expect: { relationship_id: kit.relationshipId } };
      }
      case 'record_technical_field_decision_governed_v1': {
        const kit = fx.technicalKit(org, label);
        await owner(kit.sql);
        return { wrapper, label, call: call({ p_decision: fx.jsonLit(kit.decision(`tdec-${label}`, actor)) }),
          counts: counts('technical_field_decisions', 'technical_field_decision_observations', 'technical_field_states'), expect: { state_id: null } };
      }
      case 'record_execution_field_decision_governed_v1': {
        const kit = fx.executionKit(org, label);
        await owner(kit.sql);
        return { wrapper, label, call: call({ p_decision: fx.jsonLit(kit.decision(`edec-${label}`, actor)) }),
          counts: counts('execution_field_decisions', 'execution_field_states'), expect: {} };
      }
    }
  }
  const countsOf = async (s: Scenario) => lastLine(await owner(s.counts));
  const errorOf = (call: Promise<unknown>) => call.then(() => 'NO ERROR', e => (String(e).match(/ERROR: +(\S+: .*)/) ?? ['', String(e)])[1].trim());
  const roleExists = (role: string) => owner(`select count(*) from pg_roles where rolname = '${role}'`);
  const catalog = () => owner(`select json_object_agg(p.oid::regprocedure::text, json_build_object('owner', pg_get_userbyid(p.proowner), 'secdef', p.prosecdef,
      'sha', encode(sha256(convert_to(p.prosrc, 'UTF8')), 'hex'), 'acl', coalesce(p.proacl::text, '-'), 'ret', p.prorettype::regtype::text, 'retset', p.proretset,
      'args', pg_get_function_arguments(p.oid), 'cfg', coalesce(array_to_string(p.proconfig, ';'), '-')))
    from pg_proc p where p.pronamespace not in ('pg_catalog'::regnamespace, 'information_schema'::regnamespace)`).then(JSON.parse);
  const catalogBefore: Record<string, Record<string, unknown>> = await catalog();

  // Control results on the R2 catalog without any shadow: the reference contract the AFTER calls must reproduce.
  const control: Partial<Record<Wrapper, { first: Record<string, unknown>; replay: Record<string, unknown>; counts: string }>> = {};
  await t.test('control (R2 catalog, no shadow): all six wrappers write once and replay', async () => {
    for (const wrapper of WRAPPERS) {
      const s = await scenario(wrapper);
      const first = JSON.parse(lastLine(await svc(s.call)));
      const replay = JSON.parse(lastLine(await svc(s.call)));
      assert.equal(first.replay, false, wrapper);
      assert.equal(replay.replay, true, wrapper);
      for (const [key, value] of Object.entries(s.expect)) assert.deepEqual(first[key], value, `${wrapper}.${key}`);
      control[wrapper] = { first, replay, counts: await countsOf(s) };
    }
  });

  await t.test('BEFORE (R2 catalog): a caller pg_temp type shadow executes as postgres inside all six S0 wrappers; nothing is written', async () => {
    for (const wrapper of WRAPPERS) {
      const s = await scenario(wrapper);
      const before = await countsOf(s);
      await assert.rejects(svc(SHADOW + s.call), LEAK, wrapper);
      assert.equal(await countsOf(s), before, `${wrapper}: the probe aborted the call`);
    }
  });

  await t.test('BEFORE: execution-context inconsistency — an inert shadow alone breaks five wrappers (first call or replay) with 42804', async () => {
    const outcomes: Record<string, string> = {};
    for (const wrapper of WRAPPERS) {
      const s = await scenario(wrapper);
      outcomes[wrapper] = `${await errorOf(svc(INERT + s.call))} / replay ${await errorOf(svc(INERT + s.call))}`;
    }
    const BROKEN = '42804: structure of query does not match function result type';
    assert.deepEqual(outcomes, {
      apply_review_transition_governed_v1: 'NO ERROR / replay NO ERROR',
      record_authorized_reconciliation_governed_v1: `NO ERROR / replay ${BROKEN}`,
      materialize_object_reconciliation_governed_v1: `${BROKEN} / replay ${BROKEN}`,
      materialize_relationship_reconciliation_governed_v1: `${BROKEN} / replay ${BROKEN}`,
      record_technical_field_decision_governed_v1: `${BROKEN} / replay ${BROKEN}`,
      record_execution_field_decision_governed_v1: `${BROKEN} / replay ${BROKEN}`,
    });
  });

  await t.test('BEFORE: a legitimate governed write carrying the shadow performs a CREATEROLE-only action as postgres, and it persists', async () => {
    await assert.rejects(svc('create role r3_direct nologin'), /permission denied to create role/, 'service_role cannot do this directly');
    const s = await scenario('apply_review_transition_governed_v1');
    const row = JSON.parse(lastLine(await svc(escalate('r3_forged_before') + s.call)));
    assert.equal(row.replay, false);
    assert.equal(await roleExists('r3_forged_before'), '1');
  });

  await t.test('R3 applies on the R2 catalog; R3, R2, R1 (successor config) and S1B.2 postflights re-execute; surface is exactly 22', async () => {
    await pg.migrate(s0ExecutionContextClosureMigration);
    await owner(r3Postflight());
    await owner(r3Postflight());
    await owner(r2Postflight());
    await owner(r1PostflightAfterR2());
    await owner(s1b2Postflight());
    const app = (await inventory()).filter(row => row.app);
    assert.deepEqual(app.map(row => [row.name, row.owner]).sort(), [...APPROVED_SURFACE].map(entry => [...entry]).sort());
    assert.equal(app.length, 22);
  });

  await t.test('R3 is proconfig-only: exactly the ten audited routines change, and only their search_path (pg_temp appended last)', async () => {
    const after: Record<string, Record<string, unknown>> = await catalog();
    assert.deepEqual(Object.keys(after).sort(), Object.keys(catalogBefore).sort(), 'no routine added or dropped');
    const changed = Object.keys(after).filter(sig => JSON.stringify(after[sig]) !== JSON.stringify(catalogBefore[sig])).sort();
    assert.deepEqual(changed, CORRECTED.map(([sig]) => sig).sort());
    for (const [sig, before, next] of CORRECTED) {
      assert.deepEqual({ ...after[sig], cfg: null }, { ...catalogBefore[sig], cfg: null }, `${sig}: body/owner/ACL/signature/return unchanged`);
      assert.equal(catalogBefore[sig].cfg, `search_path=${before}`);
      assert.equal(after[sig].cfg, `search_path=${next}`);
    }
    for (const wrapper of WRAPPERS) {
      const sig = Object.keys(after).find(key => key.startsWith(`gov_repo.${wrapper}(`)) as string;
      assert.deepEqual(after[sig], catalogBefore[sig], `${wrapper} frozen`);
    }
  });

  await t.test('R3 postflight negative controls (rolled back)', async () => {
    const inTxn = (setup: string) => bootstrapSql(`begin;\n${setup}\n${r3Postflight()}\nrollback;`);
    await inTxn('');
    await assert.rejects(inTxn(`alter function gov_repo.resolve_canonical_endpoint(uuid,jsonb) set search_path = gov_repo, pg_catalog;`),
      /M16_S1B2R3_POSTFLIGHT: gov_repo\.resolve_canonical_endpoint\(uuid,jsonb\) config is not its pinned path with pg_temp last/);
    await assert.rejects(inTxn(`alter function gov_repo.record_execution_field_decision(uuid,jsonb) reset search_path;`),
      /M16_S1B2R3_POSTFLIGHT: gov_repo\.record_execution_field_decision\(uuid,jsonb\) config is not/);
    await assert.rejects(inTxn(`alter function gov_repo.apply_review_transition_governed_v1(uuid,uuid,bigint,bigint,timestamptz,text,text,text,text,timestamptz,text[],text,text,text) set search_path = pg_catalog;`),
      /M16_S1B2R3_POSTFLIGHT: gov_repo\.apply_review_transition_governed_v1\(.*\) config is not/);
    await assert.rejects(inTxn(`create function gov_repo.r3_unpinned_trigger() returns trigger language plpgsql set search_path = gov_repo, pg_catalog as 'begin return new; end';
        create trigger r3_unpinned before update on gov_repo.review_subjects for each row execute function gov_repo.r3_unpinned_trigger();`),
      /M16_S1B2R3_POSTFLIGHT: S0 wrapper-reachable routine gov_repo\.r3_unpinned_trigger\(\) does not pin pg_temp last/);
    await assert.rejects(inTxn(`create function gov_repo.r3_unpinned_check(text) returns boolean language sql immutable set search_path = pg_catalog as 'select true';
        alter table gov_repo.technical_field_states add constraint r3_unpinned check (gov_repo.r3_unpinned_check(field_key)) not valid;`),
      /M16_S1B2R3_POSTFLIGHT: S0 wrapper-reachable routine gov_repo\.r3_unpinned_check\(text\) does not pin pg_temp last/);
    await assert.rejects(inTxn(`grant execute on function gov_repo.record_execution_field_decision_governed_v1(uuid,uuid,bigint,bigint,timestamptz,jsonb) to authenticated;`),
      /M16_S1B2R3_POSTFLIGHT: S0 wrapper EXECUTE is not exactly service_role/);
    await assert.rejects(inTxn(`grant execute on function gov_repo.require_governed_write_eligibility_v1(uuid,uuid,bigint,bigint,timestamptz) to service_role;`),
      /M16_S1B2R3_POSTFLIGHT: governed-write guard is application-executable/);
  });

  await t.test('AFTER: under the full shadow prelude every S0 wrapper writes, replays and returns exactly the control contract', async () => {
    for (const wrapper of WRAPPERS) {
      const s = await scenario(wrapper);
      const first = JSON.parse(lastLine(await svc(SHADOW + s.call)));
      const replay = JSON.parse(lastLine(await svc(SHADOW + s.call)));
      const ref = control[wrapper]!;
      assert.deepEqual(Object.keys(first).sort(), Object.keys(ref.first).sort(), `${wrapper}: return shape`);
      assert.equal(first.replay, false, wrapper);
      assert.equal(replay.replay, true, `${wrapper}: replay`);
      for (const [key, value] of Object.entries(s.expect)) assert.deepEqual(first[key], value, `${wrapper}.${key} deterministic`);
      // Replay returns the identical decision (only the replay flag differs), exactly as in the control run.
      const strip = (row: Record<string, unknown>) => ({ ...row, replay: null });
      assert.deepEqual(strip(replay), strip(first), `${wrapper}: replay stable`);
      assert.deepEqual(strip(ref.replay), strip(ref.first), `${wrapper}: control replay stable`);
      assert.equal(await countsOf(s), ref.counts, `${wrapper}: same rows written as the control`);
    }
  });

  await t.test('AFTER: denial and eligibility paths under the shadow write nothing (no partial writes)', async () => {
    for (const wrapper of WRAPPERS) {
      const s = await scenario(wrapper, false);
      const before = await countsOf(s);
      await assert.rejects(svc(SHADOW + s.call), (error: Error) => {
        assert.match(error.message, /GV006[\s\S]*M16_WRITE_AUTHORITY_DENIED/, wrapper);
        assert.doesNotMatch(error.message, /R3_SHADOW_EXECUTED/);
        return true;
      });
      assert.equal(await countsOf(s), before, `${wrapper}: nothing written`);
    }
  });

  await t.test('AFTER: the inert shadow no longer breaks any wrapper, and the reviewer-style escalation performs nothing', async () => {
    for (const wrapper of WRAPPERS) {
      const s = await scenario(wrapper);
      assert.equal(JSON.parse(lastLine(await svc(INERT + s.call))).replay, false, wrapper);
      assert.equal(JSON.parse(lastLine(await svc(INERT + s.call))).replay, true, `${wrapper}: replay`);
    }
    const s = await scenario('apply_review_transition_governed_v1');
    assert.equal(JSON.parse(lastLine(await svc(escalate('r3_forged_after') + s.call))).replay, false);
    assert.equal(await roleExists('r3_forged_after'), '0');
  });

  await t.test('AFTER: canonical materialization is identical to the control (objects, mappings, relationships); postflights still clean', async () => {
    const shape = (org: string) => owner(`select concat_ws('|',
        (select string_agg(kind || ':' || (created_by_decision_id is not null)::text, ',' order by kind) from gov_repo.canonical_objects where organisation_id='${org}'),
        (select string_agg(canonical_object_kind || ':' || match_method, ',' order by canonical_object_kind) from gov_repo.canonical_normalized_object_mappings where organisation_id='${org}'),
        (select count(*) from gov_repo.canonical_relationships where organisation_id='${org}'))`);
    const orgOf = (s: Scenario) => (s.call.match(/p_verified_organisation_id => '([0-9a-f-]{36})'/) as RegExpMatchArray)[1];
    for (const wrapper of ['materialize_object_reconciliation_governed_v1', 'materialize_relationship_reconciliation_governed_v1'] as const) {
      const plain = await scenario(wrapper);
      const shadowed = await scenario(wrapper);
      await svc(plain.call);
      await svc(SHADOW + shadowed.call);
      assert.equal(await shape(orgOf(shadowed)), await shape(orgOf(plain)), wrapper);
    }
    await owner(r3Postflight());
    await owner(r2Postflight());
    await owner(r1PostflightAfterR2());
  });
});
