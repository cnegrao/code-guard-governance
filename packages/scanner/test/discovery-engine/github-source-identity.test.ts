import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { SOURCE_FAMILY } from '@council/canonical-contracts';

import {
  GitHubRepositoryRedirectedError,
  GitHubSourceAdapter,
} from '../../src/discovery/adapters/github-source-adapter';
import { DiscoveryPipeline } from '../../src/discovery/pipeline';
import type { SourceAdapter } from '../../src/discovery/source-adapter';

interface QueuedResponse {
  readonly body?: unknown;
  readonly ok?: boolean;
  readonly status?: number;
  readonly type?: string;
}

function mockFetch(responses: QueuedResponse[]) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const queued = [...responses];
  const fetchImpl = (async (input: unknown, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    const next = queued.shift();
    if (!next) throw new Error('Unexpected network request');
    const status = next.status ?? 200;
    return {
      ok: next.ok ?? (status >= 200 && status < 300),
      status,
      type: next.type ?? 'basic',
      json: async () => next.body,
    };
  }) as unknown as typeof globalThis.fetch;
  return { calls, fetchImpl };
}

const SHA = '1234567890abcdef1234567890abcdef12345678';
const REPOSITORY = { id: 1296269, full_name: 'acme/policy-repo', name: 'policy-repo' };

function adapter(fetchImpl: typeof globalThis.fetch, owner = 'acme', repo = 'policy-repo') {
  return new GitHubSourceAdapter({ owner, repo, ref: 'main', token: 'secret-token', fetchImpl });
}

const REDIRECT_STATUSES = [301, 302, 307, 308];

describe('GitHubSourceAdapter provider immutable source identity', () => {
  it('resolves the immutable repository id and observed full_name from repository metadata', async () => {
    const mock = mockFetch([{ body: REPOSITORY }]);
    const identity = await adapter(mock.fetchImpl).resolveProviderSourceIdentity();

    assert.deepEqual(identity, { providerCode: 'github', providerSourceId: '1296269', observedLocator: 'acme/policy-repo' });
    assert.ok(Object.isFrozen(identity));
    assert.equal(mock.calls.length, 1);
    assert.equal(mock.calls[0].url, 'https://api.github.com/repos/acme/policy-repo');
    assert.equal(mock.calls[0].init?.redirect, 'manual');
  });

  it('accepts a case-variant full_name in the same normalized scope and reports it verbatim', async () => {
    const mock = mockFetch([{ body: { ...REPOSITORY, full_name: 'Acme/Policy-Repo' } }]);
    const identity = await adapter(mock.fetchImpl).resolveProviderSourceIdentity();
    assert.equal(identity.observedLocator, 'Acme/Policy-Repo');
    assert.equal(identity.providerSourceId, '1296269');
  });

  it('memoizes sequential and concurrent resolution with a single request', async () => {
    const mock = mockFetch([{ body: REPOSITORY }]);
    const github = adapter(mock.fetchImpl);
    const [first, second] = await Promise.all([github.resolveProviderSourceIdentity(), github.resolveProviderSourceIdentity()]);
    const third = await github.resolveProviderSourceIdentity();
    assert.equal(first, second);
    assert.equal(first, third);
    assert.equal(mock.calls.length, 1);
  });

  it('does not cache a failed resolution', async () => {
    const mock = mockFetch([{ body: { message: 'boom' }, status: 500 }, { body: REPOSITORY }]);
    const github = adapter(mock.fetchImpl);
    await assert.rejects(github.resolveProviderSourceIdentity(), /GitHub API request failed/);
    assert.equal((await github.resolveProviderSourceIdentity()).providerSourceId, '1296269');
    assert.equal(mock.calls.length, 2);
  });

  it('fails closed on missing or malformed provider identity', async () => {
    const cases: Array<[unknown, RegExp]> = [
      [{ full_name: 'acme/policy-repo' }, /invalid repository id/],
      [{ ...REPOSITORY, id: '1296269' }, /invalid repository id/],
      [{ ...REPOSITORY, id: 0 }, /invalid repository id/],
      [{ ...REPOSITORY, id: -5 }, /invalid repository id/],
      [{ ...REPOSITORY, id: 1.5 }, /invalid repository id/],
      [{ ...REPOSITORY, id: Number.MAX_SAFE_INTEGER + 2 }, /invalid repository id/],
      [{ id: 1296269 }, /invalid repository full_name/],
      [{ ...REPOSITORY, full_name: 42 }, /invalid repository full_name/],
      [{ ...REPOSITORY, full_name: 'acme/policy-repo/extra' }, /invalid repository full_name/],
      [{ ...REPOSITORY, full_name: 'acme/other-repo' }, /does not match the configured locator/],
      [{ ...REPOSITORY, full_name: 'new-owner/policy-repo' }, /does not match the configured locator/],
      [[REPOSITORY], /invalid repository response/],
      [null, /invalid repository response/],
    ];
    for (const [body, expected] of cases) {
      const mock = mockFetch([{ body }]);
      await assert.rejects(adapter(mock.fetchImpl).resolveProviderSourceIdentity(), expected, JSON.stringify(body));
    }
  });

  it('does not leak the token through provider identity failures', async () => {
    const mock = mockFetch([{ body: { message: 'secret-token' }, status: 404 }]);
    await assert.rejects(adapter(mock.fetchImpl).resolveProviderSourceIdentity(), (error: unknown) =>
      !String(error).includes('secret-token'));
  });
});

describe('GitHubSourceAdapter redirects fail closed', () => {
  for (const status of REDIRECT_STATUSES) {
    it(`repository metadata ${status} is not followed`, async () => {
      const mock = mockFetch([{ status, body: {} }]);
      await assert.rejects(adapter(mock.fetchImpl).resolveProviderSourceIdentity(), GitHubRepositoryRedirectedError);
      assert.equal(mock.calls.length, 1);
    });

    it(`commit resolution ${status} is not followed`, async () => {
      const mock = mockFetch([{ status, body: { sha: SHA } }]);
      await assert.rejects(adapter(mock.fetchImpl).resolveSourceVersion(), /redirected - rebinding required/);
      assert.equal(mock.calls.length, 1);
    });

    it(`tree enumeration ${status} is not followed`, async () => {
      const mock = mockFetch([{ body: { sha: SHA } }, { status, body: { tree: [], truncated: false } }]);
      await assert.rejects(adapter(mock.fetchImpl).listArtifacts(), GitHubRepositoryRedirectedError);
      assert.equal(mock.calls.length, 2);
    });

    it(`content read ${status} yields no content and an explicit rebinding reason`, async () => {
      const mock = mockFetch([{ body: { sha: SHA } }, { status, body: { type: 'file', encoding: 'base64', content: '', path: 'a.ts' } }]);
      const outcome = await adapter(mock.fetchImpl).readArtifact('a.ts');
      assert.deepEqual(outcome, { ok: false, locator: 'a.ts', reason: 'GitHub repository redirected - rebinding required' });
      assert.equal(mock.calls.length, 2);
    });
  }

  it('treats an opaque redirect response as a redirect', async () => {
    const mock = mockFetch([{ status: 0, type: 'opaqueredirect', ok: false }]);
    await assert.rejects(adapter(mock.fetchImpl).resolveSourceVersion(), GitHubRepositoryRedirectedError);
  });

  it('requests manual redirect handling on every GitHub call', async () => {
    const mock = mockFetch([
      { body: REPOSITORY },
      { body: { sha: SHA } },
      { body: { tree: [{ path: 'a.ts', type: 'blob', size: 1 }], truncated: false } },
      { body: { type: 'file', encoding: 'base64', content: Buffer.from('x').toString('base64'), path: 'a.ts' } },
    ]);
    const github = adapter(mock.fetchImpl);
    await github.resolveProviderSourceIdentity();
    await github.listArtifacts();
    assert.equal((await github.readArtifact('a.ts')).ok, true);
    assert.equal(mock.calls.length, 4);
    for (const call of mock.calls) assert.equal(call.init?.redirect, 'manual', call.url);
  });
});

describe('DiscoveryPipeline does not consume provider identity in S1', () => {
  it('runs without ever calling resolveProviderSourceIdentity', async () => {
    let providerIdentityCalls = 0;
    const source: SourceAdapter = {
      adapterName: 'fixture-adapter',
      adapterVersion: '1.0.0',
      describeSource: () => ({ displayName: 'acme/policy-repo', family: SOURCE_FAMILY.REPOSITORY, providerCode: 'github' }),
      listArtifacts: async () => [],
      readArtifact: async (locator) => ({ ok: false, locator, reason: 'unused' }),
      resolveProviderSourceIdentity: async () => {
        providerIdentityCalls += 1;
        throw new Error('S1 pipeline must not consume provider identity');
      },
    };
    const result = await new DiscoveryPipeline(source, []).run();
    assert.equal(result.run.status, 'SUCCEEDED');
    assert.equal(providerIdentityCalls, 0);
  });
});
