import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { mock, test } from 'node:test';
import { ledgerFoundationCluster, ledgerRepo, seedLedger, orgA, orgB, lit } from '../helpers/ledger-v2-foundation-fixtures';

test('current Audit routes -> real signed session -> V2 adapter -> service-role SQL -> disposable PG17', { timeout: 900_000 }, async t => {
  const pg = await ledgerFoundationCluster(message => t.diagnostic(message)); t.after(() => pg.stop());
  await seedLedger(pg); await pg.applyFoundation();
  for (const migration of ['20261021134359_m175_v1_s1a1_2a_ledger_v2_write_cutover.sql', '20261021201316_m175_v1_s1a1_2b_ledger_v2_tenant_read.sql']) {
    await pg.owner(readFileSync(join(ledgerRepo, 'supabase/migrations', migration), 'utf8'));
  }
  let cookie: string | undefined;
  const secretBefore = process.env.JWT_SECRET;
  process.env.JWT_SECRET = '76e9297c715947288e6b5d43887d65c4a5641b87635648bdbd898f5cd1e4851b';
  t.after(() => { if (secretBefore === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = secretBefore; });
  mock.module('next/headers', { namedExports: { cookies: async () => ({ get: () => cookie ? { value: cookie } : undefined }) } });
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  let down = false;
  mock.module('../../lib/db', { namedExports: { db: { write: { rpc: async (name: string, args: Record<string, unknown>) => {
    calls.push({ name, args });
    assert.ok(['ledger_tenant_verify_v2', 'ledger_tenant_events_v2', 'ledger_tenant_event_v2'].includes(name));
    if (down) throw new Error('private transport failed');
    try {
      const expression = `gov_repo.${name}(${Object.entries(args).map(([key, value]) => `${key}=>${lit(value)}`).join(',')})`;
      return { data: JSON.parse(await pg.svc(`SELECT coalesce(${expression},'null'::jsonb)`)), error: null };
    } catch (error) {
      const message = String(error);
      return { data: null, error: { code: message.match(/(?:ERROR:\s+)([A-Z0-9]{5}):/)?.[1] ?? 'XX000', message } };
    }
  } } } } });
  const { signToken } = await import('../../lib/auth/session-token');
  async function actor(org: string) {
    const id = randomUUID();
    await pg.owner(`INSERT INTO gov_repo.governance_users(user_id,email,full_name,organisation_id,status,role_ids)
      SELECT '${id}','${id}@example.invalid','Audit reader','${org}','active',ARRAY[role_id] FROM gov_repo.governance_roles WHERE role_code='POLICY_OWNER'`);
    await pg.bootstrapSql(`BEGIN; ALTER TABLE gov_repo.governance_users DISABLE TRIGGER trg_governance_users_credential_epoch_v1;
      UPDATE gov_repo.governance_users SET password_changed_at=clock_timestamp()-interval '12 hours' WHERE user_id='${id}';
      ALTER TABLE gov_repo.governance_users ENABLE ALWAYS TRIGGER trg_governance_users_credential_epoch_v1; COMMIT;`);
    // PostgreSQL JSON uses the zoned +00:00 representation that PostgREST and
    // the signed-session parser accept; ::text shortens it to +00.
    const epoch: string = JSON.parse(await pg.owner(`SELECT to_json(password_changed_at)::text FROM gov_repo.governance_users WHERE user_id='${id}'`));
    return { id, org, epoch, token: await signToken({ sub: id, org, email: 'display@example.invalid', role: 'ignored', credentialEpoch: epoch }) };
  }
  const a = await actor(orgA), b = await actor(orgB);
  const verify = (await import('../../app/api/audit/integrity/route')).GET;
  const list = (await import('../../app/api/audit/events/route')).GET;
  const detail = (await import('../../app/api/audit/events/[id]/route')).GET;
  const request = (query = '') => new Request(`http://local/api/audit/events${query}`);
  const byId = (id: string) => detail(request(), { params: Promise.resolve({ id }) });
  await t.test('real session authentication precedes reads; inactive is ordinary UNKNOWN 200, activated legacy-only is EMPTY', async () => {
    for (const token of [undefined, 'forged-token']) { cookie = token; assert.equal((await verify()).status, 401); }
    assert.equal(calls.length, 0);
    cookie = a.token;
    const unknown = await verify(); assert.equal(unknown.status, 200); assert.equal((await unknown.json()).status, 'UNKNOWN');
    await pg.owner(`CALL gov_repo.ledger_v2_activate(ARRAY['discovery_scan','talk_governance_logging']);`);
    const empty = await verify(); assert.equal(empty.status, 200);
    const body = await empty.json(); assert.equal(body.status, 'EMPTY'); assert.equal(body.history, 'LEGACY_GLOBAL_ONLY');
  });
  async function append(actor: typeof a) {
    const now = 'floor(extract(epoch from clock_timestamp()))::bigint';
    await pg.svc(`SELECT gov_repo.ledger_append_v2(p_verified_organisation_id=>'${actor.org}',p_verified_actor_user_id=>'${actor.id}',
      p_verified_session_iat=>${now}-10,p_verified_session_exp=>${now}+3600,p_verified_credential_epoch=>${lit(actor.epoch)},
      p_organisation_id=>'${actor.org}',p_event_type=>'AUDIT_ROUTE_TEST',p_event_desc=>'Retained event',p_subject_type=>'SYSTEM',
      p_subject_id=>'${actor.id}',p_payload=>'{}');`);
  }
  await append(a); await append(a); await append(b);
  await t.test('A/B sessions independently verify, page and inspect V2/legacy; no global metadata/aggregates', async () => {
    for (const actor of [a, b]) {
      cookie = actor.token;
      const verified = await verify(); assert.equal(verified.status, 200); const state = await verified.json();
      assert.equal(state.status, 'VALID'); assert.equal(state.organisation_id, actor.org);
      const res = await list(request('?limit=1')); assert.equal(res.status, 200); const page = await res.json();
      assert.equal(page.events.length, 1); assert.ok(page.next_cursor); assert.equal(page.organisation_id, actor.org);
      const next = await list(request(`?limit=1&cursor=${encodeURIComponent(page.next_cursor)}`)); assert.equal(next.status, 200);
      assert.notEqual((await next.json()).events[0].event_id, page.events[0].event_id);
      const all = await (await list(request())).json();
      for (const e of all.events) {
        assert.equal(e.organisation_id, actor.org);
        const found = await byId(`${e.kind}:${e.event_id}`); assert.equal(found.status, 200); assert.deepEqual(await found.json(), { event: e });
        assert.equal(e.payload_authority, e.kind === 'V2' ? 'RETAINED_RECORD_ONLY' : 'LEGACY_NON_AUTHORITATIVE');
        for (const key of ['entry_sequence', 'entry_hash', 'previous_hash', 'source_entry_id', 'source_entry_sequence', 'global']) assert.ok(!Object.hasOwn(e, key));
      }
      for (const key of ['total', 'totalPages', 'page', 'hash_chain_valid']) { assert.ok(!Object.hasOwn(all, key)); assert.ok(!Object.hasOwn(state, key)); }
      assert.equal(verified.headers.get('cache-control'), 'private, no-store');
    }
  });
  await t.test('foreign and nonexistent V2/legacy details and cursors are indistinguishable at real routes; numeric URL no RPC', async () => {
    cookie = b.token; const bEvents = (await (await list(request())).json()).events;
    cookie = a.token;
    for (const kind of ['V2', 'LEGACY']) {
      const foreign = bEvents.find((e: { kind: string }) => e.kind === kind);
      const first = await byId(`${kind}:${foreign.event_id}`), second = await byId(`${kind}:${randomUUID()}`);
      assert.equal(first.status, 404); assert.equal(second.status, 404); assert.deepEqual(await first.json(), await second.json());
      const x = await list(request(`?cursor=${kind}:${foreign.event_id}`)), y = await list(request(`?cursor=${kind}:${randomUUID()}`));
      assert.equal(x.status, 400); assert.equal(y.status, 400); assert.deepEqual(await x.json(), await y.json());
    }
    const count = calls.length; assert.equal((await byId('1')).status, 400); assert.equal(calls.length, count);
  });
  await t.test('unavailable new transport has no legacy fallback; actual credential revocation is 403 in all routes', async () => {
    down = true;
    for (const response of [await verify(), await list(request()), await byId(`V2:${randomUUID()}`)]) {
      assert.equal(response.status, 503); assert.doesNotMatch(JSON.stringify(await response.json()), /private/);
    }
    down = false;
    await pg.owner(`UPDATE gov_repo.governance_users SET external_id='rotated-${randomUUID()}' WHERE user_id='${a.id}'`);
    for (const response of [await verify(), await list(request()), await byId(`V2:${randomUUID()}`)]) assert.equal(response.status, 403);
    assert.ok(calls.every(c => c.args.p_verified_credential_epoch === a.epoch || c.args.p_verified_credential_epoch === b.epoch));
  });
  t.diagnostic('Real signed cookies and persisted principal eligibility; actual route/adapter/PG responses. SQL transport substitutes local PostgREST only; no hosted HTTP claim.');
});
