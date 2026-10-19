import assert from 'node:assert/strict';
import { test } from 'node:test';
import { l14Cluster, type Actor, type L14Cluster } from '../helpers/m16-l14-fixtures';
import { m17s3Kit, objectSubject } from '../helpers/m17-s3-fixtures';
import { lit, named } from '../helpers/m16-governed-write-fixtures';

const overlay = (c:L14Cluster,actor:Actor,kind:'AGENT'|'AGENT_VERSION',id:string) => c.exec(`select to_json(r) from
  gov_repo.l15_read_passport_risk_overlay_v1(${named({...c.principal(actor),p_subject_canonical_kind:lit(kind),
    p_subject_canonical_object_id:lit(id),p_effective_at:'null::timestamptz',p_recorded_cutoff:'null::timestamptz'})}) r;`);

test('S7B O72 exact Passport overlay is UNKNOWN on absence, mapped on presence, non-inherited and zero-write',
  {timeout:600_000},async t=>{
    const c=await l14Cluster(message=>t.diagnostic(message),{horizon:'M17S7B'});t.after(()=>c.stop());
    const k=await m17s3Kit(c),x=await k.setup();
    const agent=x.objects.AGENT!,version=x.objects.AGENT_VERSION!;
    let result=await overlay(c,x.member,'AGENT',agent);
    assert.equal(result.overlay_status,'UNKNOWN');assert.deepEqual(result.items,[]);

    const scenario=await k.scenario(x,'passport-operational','OPERATIONAL',['AGENT']);
    const proposal=k.proposalOf(objectSubject('AGENT',agent),scenario);
    const submitted=await k.submit(x,'passport-risk',proposal);
    await k.decide(x,'passport-risk',submitted,proposal);
    const before=await k.historyDigest(x.org);
    result=await overlay(c,x.member,'AGENT',agent);
    assert.equal(await k.historyDigest(x.org),before,'overlay execution writes no authority row');
    assert.equal(result.overlay_status,'PRESENT');assert.equal(result.items.length,1);
    const [item]=result.items;
    assert.deepEqual([item.riskDomain,item.familyId,item.lifecycle],['OPERATIONAL','runtime','IDENTIFIED']);
    assert.deepEqual([item.inherentBand,item.residualBand,item.acceptanceStatus,item.acceptanceValidity,item.supportCurrency],
      ['UNKNOWN','UNKNOWN','UNKNOWN','UNKNOWN','SUPPORT_NONE']);
    assert.deepEqual([item.subjectKind,item.subjectCanonicalObjectId],['AGENT',agent]);
    assert.ok(item.lineage.proposalId&&item.lineage.authorizationDecisionId&&item.lineage.governanceDecisionId);

    const versionResult=await overlay(c,x.member,'AGENT_VERSION',version);
    assert.equal(versionResult.overlay_status,'UNKNOWN','AGENT risk never inherits to its AGENT_VERSION');
    assert.deepEqual(versionResult.items,[]);
  });
