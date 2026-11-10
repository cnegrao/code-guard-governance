import assert from 'node:assert/strict';
import { test } from 'node:test';
import { reviewSubjectIdFromRouteParam } from '../lib/governance/review-subject-route';

test('queue and shared encoded E1 links address the same exact persisted ID at the API boundary',()=>{
  const ids=[
    'review-subject:discovery:6d82d4eeab00b7cfaed4d8c2b5ddb57b455f2819137a98bbf2e803ab2fdd919b',
    'review-subject:discovery:94ab3bbabbd6398d3bd25c83ebf875a551854842bcf09437a59cd9ee7718af4f',
  ];
  for(const id of ids)for(const route of [id,encodeURIComponent(id)]){
    const canonical=reviewSubjectIdFromRouteParam(route);
    assert.equal(canonical,id);
    const apiSegment=encodeURIComponent(canonical);
    assert.equal(decodeURIComponent(apiSegment),id);
    assert.equal(apiSegment.includes('%253A'),false);
  }
});
test('route decoding is bounded to one layer and malformed escapes cannot crash the detail view',()=>{
  assert.equal(reviewSubjectIdFromRouteParam('review-subject:bad%escape'),'review-subject:bad%escape');
  assert.equal(reviewSubjectIdFromRouteParam('review-subject%253Adiscovery%253Aabc'),'review-subject%3Adiscovery%3Aabc');
});
