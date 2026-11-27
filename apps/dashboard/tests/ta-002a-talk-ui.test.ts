import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { CODING_MEMORY_UNAVAILABLE } from '../lib/talk-retrieval-state';

test('Talk renders the returned acquisition notice separately from model text on every response path', async () => {
  Object.assign(globalThis, { React });
  let messages: unknown[] = [];
  let index = 0;
  mock.module('react', { namedExports: { ...React,
    useState: (initial: unknown) => [index++ === 0 ? messages : initial, () => {}],
    useEffect: () => {}, useRef: () => ({ current: null }),
  } });
  const Page = (await import('../app/(dashboard)/governance/page')).default;
  for (const status of ['available', 'no_matches', 'unavailable', 'not_requested'] as const) {
    messages = [{ role: 'system', content: 'An unrelated answer.', retrieval: {
      agentLookup: { status, mode: 'lexical', knowledge: 'UNKNOWN' }, codingMemory: CODING_MEMORY_UNAVAILABLE,
    } }]; index = 0;
    const html = renderToStaticMarkup(Page());
    assert.match(html, /role="status"/); assert.match(html, /Code memory unavailable \(UNKNOWN\)/);
    assert.match(html, /repository\/code context was not searched/);
    assert.match(html, /Semantic parity is not available/);
    if (status === 'no_matches') assert.match(html, /No agent text matches in the bounded lookup/);
    if (status === 'unavailable') assert.match(html, /Agent text lookup unavailable \(UNKNOWN\)/);
    if (status === 'available') assert.match(html, /direct, non-authoritative records/);
  }
});
