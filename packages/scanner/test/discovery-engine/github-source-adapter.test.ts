import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { describe, it } from 'node:test';

import { GitHubSourceAdapter } from '../../src/discovery/adapters/github-source-adapter';
import type { GitHubSourceAdapterOptions } from '../../src/discovery/adapters/github-source-adapter';

interface MockFetchResult {
  readonly calls: Array<{ readonly url: string; readonly init?: unknown }>;
  readonly fetchImpl: typeof globalThis.fetch;
}

function mockFetch(responses: Array<{ readonly body: unknown; readonly ok?: boolean }>): MockFetchResult {
  const calls: Array<{ url: string; init?: unknown }> = [];
  const queued = [...responses];
  const fetchImpl = (async (input: unknown, init?: unknown) => {
    calls.push({ url: String(input), init });
    const next = queued.shift();
    if (!next) {
      throw new Error('Unexpected network request');
    }
    return {
      ok: next.ok ?? true,
      json: async () => next.body,
    };
  }) as unknown as typeof globalThis.fetch;
  return { calls, fetchImpl };
}

function options(
  fetchImpl: typeof globalThis.fetch,
  overrides: Partial<GitHubSourceAdapterOptions> = {},
): GitHubSourceAdapterOptions {
  return {
    owner: 'acme',
    repo: 'policy-repo',
    ref: 'feature/source-adapter',
    token: 'secret-token',
    fetchImpl,
    ...overrides,
  };
}

function treeResponse(entries: Array<Record<string, unknown>>, truncated = false): Record<string, unknown> {
  return { tree: entries, truncated };
}

function treeEntry(
  path: string,
  type: string,
  size: number,
): Record<string, unknown> {
  return { path, type, size };
}

describe('GitHubSourceAdapter', () => {
  it('resolves a branch/ref to an immutable commit version', async () => {
    const sha = 'ABCDEF0123456789ABCDEF0123456789ABCDEF01';
    const mock = mockFetch([{ body: { sha } }]);
    const adapter = new GitHubSourceAdapter(options(mock.fetchImpl));

    assert.equal(await adapter.resolveSourceVersion(), `commit:${sha.toLowerCase()}`);
    assert.equal(mock.calls.length, 1);
    assert.equal(
      mock.calls[0].url,
      'https://api.github.com/repos/acme/policy-repo/commits/feature%2Fsource-adapter',
    );
  });

  it('lists artifacts with the resolved SHA rather than the original ref', async () => {
    const sha = '1234567890abcdef1234567890abcdef12345678';
    const mock = mockFetch([
      { body: { sha } },
      { body: treeResponse([treeEntry('README.md', 'blob', 4)]) },
    ]);
    const adapter = new GitHubSourceAdapter(options(mock.fetchImpl));

    assert.deepEqual(await adapter.listArtifacts(), [
      { locator: 'README.md', kind: 'file', sizeBytes: 4 },
    ]);
    assert.deepEqual(
      mock.calls.map((call) => call.url),
      [
        'https://api.github.com/repos/acme/policy-repo/commits/feature%2Fsource-adapter',
        `https://api.github.com/repos/acme/policy-repo/git/trees/${sha}?recursive=1`,
      ],
    );
  });

  it('orders artifacts deterministically by repository-relative locator', async () => {
    const sha = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const mock = mockFetch([
      { body: { sha } },
      {
        body: treeResponse([
          treeEntry('z.txt', 'blob', 1),
          treeEntry('nested/a.txt', 'blob', 1),
          treeEntry('directory', 'tree', 0),
          treeEntry('a.txt', 'blob', 1),
        ]),
      },
    ]);
    const adapter = new GitHubSourceAdapter(options(mock.fetchImpl));

    assert.deepEqual(
      (await adapter.listArtifacts()).map((artifact) => artifact.locator),
      ['a.txt', 'nested/a.txt', 'z.txt'],
    );
  });

  it('fails closed when GitHub marks a recursive tree as truncated', async () => {
    const sha = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
    const mock = mockFetch([
      { body: { sha } },
      { body: treeResponse([treeEntry('partial.txt', 'blob', 1)], true) },
    ]);
    const adapter = new GitHubSourceAdapter(options(mock.fetchImpl));

    await assert.rejects(adapter.listArtifacts(), /incomplete/i);
  });

  it('does not fall back to another ref when resolution fails', async () => {
    const mock = mockFetch([{ body: { message: 'not found' }, ok: false }]);
    const adapter = new GitHubSourceAdapter(options(mock.fetchImpl));

    await assert.rejects(adapter.resolveSourceVersion(), /failed/i);
    assert.equal(mock.calls.length, 1);
    assert.equal(
      mock.calls[0].url,
      'https://api.github.com/repos/acme/policy-repo/commits/feature%2Fsource-adapter',
    );
  });

  it('omits paths excluded by discovery policy', async () => {
    const sha = 'cccccccccccccccccccccccccccccccccccccccc';
    const mock = mockFetch([
      { body: { sha } },
      {
        body: treeResponse([
          treeEntry('visible.md', 'blob', 2),
          treeEntry('.govia-lab/private.json', 'blob', 2),
          treeEntry('docs/.govia-lab/private.json', 'blob', 2),
        ]),
      },
    ]);
    const adapter = new GitHubSourceAdapter(options(mock.fetchImpl));

    assert.deepEqual(
      (await adapter.listArtifacts()).map((artifact) => artifact.locator),
      ['visible.md'],
    );
  });

  it('returns UTF-8 content and a hash over the exact decoded bytes', async () => {
    const sha = 'dddddddddddddddddddddddddddddddddddddddd';
    const text = 'héllo\n';
    const bytes = Buffer.from(text, 'utf8');
    const mock = mockFetch([
      { body: { sha } },
      {
        body: {
          type: 'file',
          encoding: 'base64',
          content: bytes.toString('base64'),
          path: 'unicode.txt',
        },
      },
    ]);
    const adapter = new GitHubSourceAdapter(options(mock.fetchImpl));

    const outcome = await adapter.readArtifact('unicode.txt');
    assert.equal(outcome.ok, true);
    if (outcome.ok) {
      assert.equal(outcome.content.text, text);
      assert.equal(outcome.content.encoding, 'utf8');
      assert.equal(outcome.content.contentHash, createHash('sha256').update(bytes).digest('hex'));
    }
    assert.match(mock.calls[1].url, new RegExp(`ref=${sha}$`));
  });

  it('fails closed for invalid UTF-8 content', async () => {
    const sha = 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
    const mock = mockFetch([
      { body: { sha } },
      {
        body: {
          type: 'file',
          encoding: 'base64',
          content: Buffer.from([0xff]).toString('base64'),
          path: 'binary.bin',
        },
      },
    ]);
    const adapter = new GitHubSourceAdapter(options(mock.fetchImpl));

    const outcome = await adapter.readArtifact('binary.bin');
    assert.equal(outcome.ok, false);
    if (!outcome.ok) {
      assert.match(outcome.reason, /UTF-8/i);
    }
  });

  it('fails closed for non-2xx GitHub responses', async () => {
    const mock = mockFetch([{ body: { message: 'failure' }, ok: false }]);
    const adapter = new GitHubSourceAdapter(options(mock.fetchImpl));

    await assert.rejects(adapter.listArtifacts(), /failed/i);
  });

  it('does not expose the token in errors or returned data', async () => {
    const token = 'token-that-must-not-leak';
    const mock = mockFetch([{ body: { message: token }, ok: false }]);
    const adapter = new GitHubSourceAdapter(options(mock.fetchImpl, { token }));

    try {
      await adapter.listArtifacts();
      assert.fail('expected listArtifacts to fail');
    } catch (error) {
      assert.equal(String(error).includes(token), false);
    }
    const readOutcome = await adapter.readArtifact('secret.txt');
    assert.equal(JSON.stringify(readOutcome).includes(token), false);
  });

  it('reuses the resolved immutable SHA across repeated operations', async () => {
    const sha = 'ffffffffffffffffffffffffffffffffffffffff';
    const mock = mockFetch([
      { body: { sha } },
      { body: treeResponse([treeEntry('one.txt', 'blob', 1)]) },
      {
        body: {
          type: 'file',
          encoding: 'base64',
          content: Buffer.from('one').toString('base64'),
          path: 'one.txt',
        },
      },
    ]);
    const adapter = new GitHubSourceAdapter(options(mock.fetchImpl));

    assert.equal(await adapter.resolveSourceVersion(), `commit:${sha}`);
    await adapter.listArtifacts();
    const outcome = await adapter.readArtifact('one.txt');
    assert.equal(outcome.ok, true);
    assert.equal(mock.calls.length, 3);
    assert.equal(
      mock.calls.filter((call) => call.url.includes('/commits/')).length,
      1,
    );
    assert.equal(
      mock.calls[2].url,
      `https://api.github.com/repos/acme/policy-repo/contents/one.txt?ref=${sha}`,
    );
  });
});
