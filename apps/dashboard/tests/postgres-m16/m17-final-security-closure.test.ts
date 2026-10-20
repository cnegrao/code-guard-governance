import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { l14Cluster } from '../helpers/m16-l14-fixtures';
import { m17S7CFinalSecurityClosureMigration } from '../helpers/disposable-m16-postgres';
import { l15SecurityViolationsSql, type DefinerInventoryEntry } from '../helpers/m17-l15-security-profile';
import {
  L15_S1_DEFINER_INVENTORY, L15_S2_DEFINER_INVENTORY, L15_S2R1_DEFINER_INVENTORY,
  L15_S3_DEFINER_INVENTORY, L15_S4_DEFINER_INVENTORY, L15_S5_DEFINER_INVENTORY,
  L15_S6_PHASE_A_DEFINER_DELTA, L15_S6_PHASE_B_DEFINER_DELTA, L15_S7_DEFINER_INVENTORY,
} from '../helpers/m17-l15-definer-inventory';

const replacedAtS6 = 'gov_repo.l15_decide_risk_assessment_proposal_v1(';
const FINAL_INVENTORY: readonly DefinerInventoryEntry[] = [
  ...L15_S1_DEFINER_INVENTORY, ...L15_S2_DEFINER_INVENTORY, ...L15_S2R1_DEFINER_INVENTORY,
  ...L15_S3_DEFINER_INVENTORY, ...L15_S4_DEFINER_INVENTORY.filter(e => !e.sig.startsWith(replacedAtS6)),
  ...L15_S5_DEFINER_INVENTORY, ...L15_S6_PHASE_A_DEFINER_DELTA, ...L15_S6_PHASE_B_DEFINER_DELTA,
  ...L15_S7_DEFINER_INVENTORY,
];
const bySignature = <T extends { sig: string }>(rows: readonly T[]) => [...rows].sort((a, b) => a.sig.localeCompare(b.sig));
const migration = readFileSync(new URL(`../../../../supabase/migrations/${m17S7CFinalSecurityClosureMigration}`, import.meta.url), 'utf8');

type NumericCatalogEntry = {
  column_name: string;
  data_type: string;
  category: 'STRUCTURAL_SCALE_COORDINATE' | 'NON_AUTHORITATIVE_ANALYTICAL_SOURCE_HINT' |
    'STRUCTURAL_INTEGRITY_COMPLETENESS_COUNTER' | 'PROHIBITED_GOVERNED_RISK_NUMERIC';
};

const FINAL_NUMERIC_CATALOG: readonly NumericCatalogEntry[] = [
  { column_name: 'l15_risk_hypotheses.hint_confidence', data_type: 'numeric', category: 'NON_AUTHORITATIVE_ANALYTICAL_SOURCE_HINT' },
  { column_name: 'l15_risk_methodology_impact_levels.ordinal', data_type: 'smallint', category: 'STRUCTURAL_SCALE_COORDINATE' },
  { column_name: 'l15_risk_methodology_likelihood_levels.ordinal', data_type: 'smallint', category: 'STRUCTURAL_SCALE_COORDINATE' },
  { column_name: 'l15_risk_signals.hint_confidence', data_type: 'numeric', category: 'NON_AUTHORITATIVE_ANALYTICAL_SOURCE_HINT' },
  { column_name: 'l15_risk_treatment_proposals.control_pin_count', data_type: 'integer', category: 'STRUCTURAL_INTEGRITY_COMPLETENESS_COUNTER' },
];

const FINAL_REVIEWED_NUMERIC_CONSUMERS = [
  { token: 'control_pin_count', object_kind: 'CONSTRAINT', identity: 'gov_repo.l15_risk_treatment_proposals.l15_risk_treatment_proposals_control_pin_count_check', definition_sha: '24e6958fb5a0335497682bf1071633b6fdb8c65fabd93235ecf0895973c1ac39' },
  { token: 'control_pin_count', object_kind: 'ROUTINE', identity: 'gov_repo.l15_risk_treatment_commit_guard_v1()', definition_sha: '37754139af6db700e4a504d95f8993c4cc163a96cbbe68d609f98be5aed7abfd' },
  { token: 'control_pin_count', object_kind: 'ROUTINE', identity: 'gov_repo.l15_submit_risk_treatment_proposal_v1(uuid,uuid,bigint,bigint,timestamp with time zone,text,text,text,uuid,text,text,uuid,uuid,text,date,text,uuid[],timestamp with time zone,timestamp with time zone,uuid,uuid,uuid,text,text[],text[],text)', definition_sha: 'a2b016bc4496ba68c0aa1fffd89b2be68cb5b45bb14fb2c5b550d8ae9db9f9d5' },
  { token: 'hint_confidence', object_kind: 'CONSTRAINT', identity: 'gov_repo.l15_risk_hypotheses.l15_risk_hypotheses_hint_confidence_check', definition_sha: 'dff50da487e84b111ad63cb0f39525e21f45598b2501e323dea0ae9b803da639' },
  { token: 'hint_confidence', object_kind: 'CONSTRAINT', identity: 'gov_repo.l15_risk_signals.l15_risk_signals_hint_check', definition_sha: '0e83779390f2f44daaa0c39ae9029c47ac0d337dcef31dde01bc7798714e6c51' },
  { token: 'hint_confidence', object_kind: 'CONSTRAINT', identity: 'gov_repo.l15_risk_signals.l15_risk_signals_hint_confidence_check', definition_sha: 'dff50da487e84b111ad63cb0f39525e21f45598b2501e323dea0ae9b803da639' },
  { token: 'hint_confidence', object_kind: 'ROUTINE', identity: 'gov_repo.l15_read_hypothesis_dispositions_v1(uuid,uuid,bigint,bigint,timestamp with time zone,text,text,text,text,text)', definition_sha: '759086fea06b757f854963ffd9fa507606aeb3c4ead241f02d194e44adc3b487' },
  { token: 'hint_confidence', object_kind: 'ROUTINE', identity: 'gov_repo.l15_read_signals_v1(uuid,uuid,bigint,bigint,timestamp with time zone,text,text,text,text,text)', definition_sha: '2e7809bbbf935582b9e95cfcd7deb7665ddf61f7c3866d7cce23e1b5e9ac0fd4' },
  { token: 'hint_confidence', object_kind: 'ROUTINE', identity: 'gov_repo.l15_write_hypothesis_v1(uuid,text,text,text,text,text,text,text,text,text,text,text,text,text,text,numeric,uuid[],uuid,text)', definition_sha: '9d53d32cbf293f1ddeab7585e186b0c1c3fc2276ef843cba6850ab13e3aa2bfc' },
  { token: 'hint_confidence', object_kind: 'ROUTINE', identity: 'gov_repo.l15_write_signal_v1(uuid,text,text,text,text,text,text,text,text,text,text,text,text,text,numeric,timestamp with time zone,text,text,text,uuid,text[],text[],uuid,text)', definition_sha: '5c5d9de332c83988a28ef9c5f0cc791638151cba9672600195ca12ed97da26f9' },
] as const;

test('final M17S7B security closure pins the complete L15 definer, ACL and non-authority surface',
  { timeout: 600_000 }, async t => {
    const c = await l14Cluster(message => t.diagnostic(message), { horizon: 'M17S7B' });
    t.after(() => c.stop());

    const snapshot = async () => {
      const tables = JSON.parse(await c.owner(`select json_agg(c.relname order by c.relname) from pg_catalog.pg_class c
        where c.relnamespace='gov_repo'::regnamespace and c.relname like 'l15\\_%' escape '\\' and c.relkind='r'`)) as string[];
      return Promise.all(tables.map(async name => [name, await c.owner(`select pg_catalog.md5(coalesce(
        pg_catalog.string_agg(pg_catalog.row_to_json(t)::text,'|' order by pg_catalog.row_to_json(t)::text),''))
        from gov_repo.${name} t`)]));
    };
    const before = await snapshot();

    const inventory = JSON.parse(await c.owner(`select json_agg(to_json(q) order by sig) from (
      select p.oid::regprocedure::text sig,pg_catalog.pg_get_userbyid(p.proowner) owner,
        pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p.prosrc,'UTF8')),'hex') sha,
        coalesce(pg_catalog.array_to_string(p.proconfig,';'),'-') cfg
      from pg_catalog.pg_proc p where p.pronamespace='gov_repo'::regnamespace
        and p.proname like 'l15\\_%' escape '\\' and p.prosecdef) q`)) as DefinerInventoryEntry[];
    assert.equal(inventory.length, 36, 'measured final catalog count');
    assert.deepEqual(bySignature(inventory), bySignature(FINAL_INVENTORY), 'no unknown, missing or changed definer');

    const serviceRpcs = FINAL_INVENTORY.filter(e => !e.sig.includes('_guard_') && !e.sig.includes('l15_admit_machine_'))
      .map(e => e.sig);
    assert.deepEqual(await c.exec(l15SecurityViolationsSql(FINAL_INVENTORY, serviceRpcs)), []);

    const acl = JSON.parse(await c.owner(`select json_agg(to_json(q) order by sig,grantee) from (
      select p.oid::regprocedure::text sig,pg_catalog.pg_get_userbyid(a.grantee) grantee,
        a.privilege_type privilege,a.is_grantable grantable
      from pg_catalog.pg_proc p cross join lateral pg_catalog.aclexplode(p.proacl) a
      where p.pronamespace='gov_repo'::regnamespace and p.proname like 'l15\\_%' escape '\\' and p.prosecdef) q`)) as
      Array<{ sig: string; grantee: string; privilege: string; grantable: boolean }>;
    const expectedAcl = FINAL_INVENTORY.flatMap(({ sig }) => [
      { sig, grantee: 'postgres', privilege: 'EXECUTE', grantable: false },
      ...(sig.includes('l15_admit_machine_')
        ? [{ sig, grantee: 'govia_l15_machine_intake_caller', privilege: 'EXECUTE', grantable: false }]
        : sig.includes('_guard_') ? [] : [{ sig, grantee: 'service_role', privilege: 'EXECUTE', grantable: false }]),
    ]).sort((a, b) => a.sig.localeCompare(b.sig) || a.grantee.localeCompare(b.grantee));
    assert.deepEqual(acl, expectedAcl, 'effective explicit EXECUTE ACL is exact');

    const machineRpcs = JSON.parse(await c.owner(`select json_agg(p.oid::regprocedure::text order by p.oid::regprocedure::text)
      from pg_catalog.pg_proc p where p.pronamespace='gov_repo'::regnamespace
        and pg_catalog.has_function_privilege('govia_l15_machine_intake_caller',p.oid,'EXECUTE')`));
    assert.deepEqual(machineRpcs, FINAL_INVENTORY.filter(e => e.sig.includes('l15_admit_machine_')).map(e => e.sig).sort(),
      'machine intake capability remains exactly the approved two RPCs');

    const s7Sources = JSON.parse(await c.owner(`select json_agg(p.prosrc order by p.proname) from pg_catalog.pg_proc p
      where p.oid in ('${L15_S7_DEFINER_INVENTORY[0]!.sig}'::regprocedure,'${L15_S7_DEFINER_INVENTORY[1]!.sig}'::regprocedure)`)) as string[];
    for (const source of s7Sources) {
      assert.doesNotMatch(source, /\b(?:insert\s+into|update|delete\s+from|merge\s+into|truncate)\b/i);
      assert.doesNotMatch(source, /\bl15_(?:submit|decide|admit)_\w+\s*\(/i);
    }

    const numericColumns = JSON.parse(await c.owner(`select json_agg(to_json(q) order by column_name) from (
      select format('%s.%s',c.relname,a.attname) column_name, pg_catalog.format_type(a.atttypid,a.atttypmod) data_type
      from pg_catalog.pg_attribute a join pg_catalog.pg_class c on c.oid=a.attrelid
      where c.relnamespace='gov_repo'::regnamespace and c.relname like 'l15\\_%' escape '\\' and c.relkind in ('r','p')
        and a.attnum>0 and not a.attisdropped
        and a.atttypid in ('smallint'::regtype,'integer'::regtype,'bigint'::regtype,'numeric'::regtype,
          'real'::regtype,'double precision'::regtype)) q`)) as Array<Omit<NumericCatalogEntry, 'category'>>;
    assert.deepEqual(numericColumns, FINAL_NUMERIC_CATALOG.map(({ column_name, data_type }) => ({ column_name, data_type })),
      'every final numeric/integer/decimal/real/double/smallint/bigint L15 column is classified');
    assert.equal(FINAL_NUMERIC_CATALOG.filter(row => row.category === 'PROHIBITED_GOVERNED_RISK_NUMERIC').length, 0,
      'Category 4 is empty');
    const scoringColumns = await c.owner(`select count(*) from pg_catalog.pg_attribute a join pg_catalog.pg_class c on c.oid=a.attrelid
      where c.relnamespace='gov_repo'::regnamespace and c.relname like 'l15\\_%' escape '\\' and a.attnum>0 and not a.attisdropped
        and a.attname ~* '(score|weight|percent|product)'`);
    assert.equal(scoringColumns, '0');

    const numericConsumerObjects = JSON.parse(await c.owner(`select json_agg(to_json(q) order by token,object_kind,identity) from (
      select token, 'ROUTINE' object_kind, p.oid::regprocedure::text identity,
        pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p.prosrc,'UTF8')),'hex') definition_sha
      from (values ('hint_confidence'),('control_pin_count')) n(token)
      join pg_catalog.pg_proc p on p.prosrc ~ ('\\m'||n.token||'\\M')
      union all
      select token, 'CONSTRAINT', format('%s.%s',c.oid::regclass,con.conname),
        pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.pg_get_constraintdef(con.oid,true),'UTF8')),'hex')
      from (values ('hint_confidence'),('control_pin_count')) n(token)
      join pg_catalog.pg_constraint con on pg_catalog.pg_get_constraintdef(con.oid,true) ~ ('\\m'||n.token||'\\M')
      join pg_catalog.pg_class c on c.oid=con.conrelid
      where c.relnamespace='gov_repo'::regnamespace
      union all
      select token, 'VIEW', format('%s.%s',nv.nspname,v.relname),
        pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.pg_get_viewdef(v.oid,true),'UTF8')),'hex')
      from (values ('hint_confidence'),('control_pin_count')) n(token)
      join pg_catalog.pg_class v on v.relkind in ('v','m') and pg_catalog.pg_get_viewdef(v.oid,true) ~ ('\\m'||n.token||'\\M')
      join pg_catalog.pg_namespace nv on nv.oid=v.relnamespace
      where nv.nspname='gov_repo'
      union all
      select token, 'POLICY', format('%s.%s',c.oid::regclass,pol.polname),
        pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
          coalesce(pg_catalog.pg_get_expr(pol.polqual,pol.polrelid),'')||';'||
          coalesce(pg_catalog.pg_get_expr(pol.polwithcheck,pol.polrelid),''),'UTF8')),'hex')
      from (values ('hint_confidence'),('control_pin_count')) n(token)
      join pg_catalog.pg_policy pol on (coalesce(pg_catalog.pg_get_expr(pol.polqual,pol.polrelid),'')||';'||
        coalesce(pg_catalog.pg_get_expr(pol.polwithcheck,pol.polrelid),'')) ~ ('\\m'||n.token||'\\M')
      join pg_catalog.pg_class c on c.oid=pol.polrelid where c.relnamespace='gov_repo'::regnamespace
      union all
      select token, 'TRIGGER', format('%s.%s',c.oid::regclass,tr.tgname),
        pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.pg_get_triggerdef(tr.oid,true),'UTF8')),'hex')
      from (values ('hint_confidence'),('control_pin_count')) n(token)
      join pg_catalog.pg_trigger tr on not tr.tgisinternal and pg_catalog.pg_get_triggerdef(tr.oid,true) ~ ('\\m'||n.token||'\\M')
      join pg_catalog.pg_class c on c.oid=tr.tgrelid where c.relnamespace='gov_repo'::regnamespace
      union all
      select token, 'INDEX', idx.indexname,
        pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(idx.indexdef,'UTF8')),'hex')
      from (values ('hint_confidence'),('control_pin_count')) n(token)
      join pg_catalog.pg_indexes idx on idx.indexdef ~ ('\\m'||n.token||'\\M') where idx.schemaname='gov_repo'
      union all
      select token, 'COLUMN_EXPRESSION', format('%s.%s',c.oid::regclass,a.attname),
        pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.pg_get_expr(d.adbin,d.adrelid),'UTF8')),'hex')
      from (values ('hint_confidence'),('control_pin_count')) n(token)
      join pg_catalog.pg_attrdef d on pg_catalog.pg_get_expr(d.adbin,d.adrelid) ~ ('\\m'||n.token||'\\M')
      join pg_catalog.pg_class c on c.oid=d.adrelid join pg_catalog.pg_attribute a on a.attrelid=c.oid and a.attnum=d.adnum
      where c.relnamespace='gov_repo'::regnamespace
    ) q`)) as Array<{ token: string; object_kind: string; identity: string; definition_sha: string }>;
    assert.deepEqual(numericConsumerObjects, FINAL_REVIEWED_NUMERIC_CONSUMERS,
      'hint_confidence and control_pin_count have only the reviewed non-authoritative/integrity consumers');

    await c.migrate(m17S7CFinalSecurityClosureMigration);
    assert.deepEqual(await snapshot(), before, 'the final security proof mutates no L15 production table/state');
  });

test('S7C postflight migration is assertion-only and introduces no durable capability', () => {
  const code = migration.split('\n').filter(line => !line.trimStart().startsWith('--')).join('\n');
  assert.match(code, /DO \$postflight\$/);
  assert.doesNotMatch(code, /\b(?:CREATE|ALTER|DROP|GRANT|REVOKE|INSERT|UPDATE|DELETE|MERGE|TRUNCATE)\b/i);
  assert.doesNotMatch(code, /\b(?:TABLE|VIEW|TYPE|SEQUENCE|FUNCTION|ROLE)\s+gov_repo\./i);
});
