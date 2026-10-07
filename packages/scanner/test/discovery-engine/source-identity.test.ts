import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import { SOURCE_FAMILY } from '@council/canonical-contracts';

import { GitHubSourceAdapter } from '../../src/discovery/adapters/github-source-adapter';
import { createSourceConnection, createSourceSystem } from '../../src/discovery/provenance';
import {
  SOURCE_IDENTITY_ERROR_CODE,
  SourceIdentityError,
  deriveSourceConnectionId,
  parseGitHubLocatorString,
  parseGitHubRepositoryLocator,
  sameGitHubScope,
  validateAuthorizedRef,
} from '../../src/discovery/source-identity';

interface GitHubConnectionVector {
  readonly providerCode: string;
  readonly owner: string;
  readonly repo: string;
  readonly configuredLocator: string;
  readonly normalizedLocator: string;
  readonly sourceConnectionId: string;
}

const vectors = JSON.parse(
  readFileSync(
    new URL('../../../governance-review/test/fixtures/discovery-machine-identity-vectors.json', import.meta.url),
    'utf8',
  ),
) as {
  readonly githubSourceConnections: readonly GitHubConnectionVector[];
  readonly otherDescriptors: readonly { providerCode: string; displayName: string; sourceConnectionId: string }[];
  readonly scopeComparisons: readonly { a: string; b: string; sameScope: boolean }[];
};

/** Pre-S1 provenance.ts stableConnectionSeed + createSourceConnection, verbatim, as the compatibility oracle. */
function legacySourceConnectionId(providerCode: string, displayName: string): string {
  const seed = createHash('sha256').update(`${providerCode}:${displayName}`).digest('hex').slice(0, 32);
  return `source-connection:${seed}`;
}

const neverFetch = (async () => {
  throw new Error('Unexpected network request');
}) as unknown as typeof globalThis.fetch;

const isCode = (code: string) => (error: unknown) => error instanceof SourceIdentityError && error.code === code;

describe('deterministic source identity', () => {
  it('reproduces every golden GitHub sourceConnectionId through the real adapter path', () => {
    assert.ok(vectors.githubSourceConnections.length >= 6);
    for (const vector of vectors.githubSourceConnections) {
      const adapter = new GitHubSourceAdapter({ owner: vector.owner, repo: vector.repo, ref: 'main', fetchImpl: neverFetch });
      const descriptor = adapter.describeSource();
      assert.equal(descriptor.displayName, vector.configuredLocator);
      assert.equal(createSourceConnection(createSourceSystem(descriptor), descriptor).connectionId, vector.sourceConnectionId);
      assert.equal(deriveSourceConnectionId(descriptor), vector.sourceConnectionId);
      assert.equal(legacySourceConnectionId('github', vector.configuredLocator), vector.sourceConnectionId);
    }
  });

  it('never validates or normalizes the identity input: non-GitHub and legacy descriptors are unchanged', () => {
    for (const vector of vectors.otherDescriptors) {
      assert.equal(deriveSourceConnectionId(vector), vector.sourceConnectionId);
      assert.equal(legacySourceConnectionId(vector.providerCode, vector.displayName), vector.sourceConnectionId);
    }
  });

  it('is byte-identical to the pre-S1 algorithm across a randomized descriptor corpus', () => {
    const samples = ['', ' ', 'a/b', 'A/B', 'ÉÜ/ß', '\u0000', '😀/repo', 'owner/repo/extra', ' acme/policy-repo '];
    for (let index = 0; index < 500; index += 1) {
      samples.push(randomBytes(1 + (index % 24)).toString(index % 2 === 0 ? 'hex' : 'latin1'));
    }
    for (const providerCode of ['github', 'local-filesystem', 'gitlab', '']) {
      for (const displayName of samples) {
        const descriptor = { providerCode, displayName, family: SOURCE_FAMILY.REPOSITORY };
        const expected = legacySourceConnectionId(providerCode, displayName);
        assert.equal(deriveSourceConnectionId(descriptor), expected);
        assert.equal(createSourceConnection(createSourceSystem(descriptor), descriptor).connectionId, expected);
      }
    }
  });

  it('keeps configured spelling as identity and the normalized locator for scope only', () => {
    for (const vector of vectors.githubSourceConnections) {
      const locator = parseGitHubRepositoryLocator(vector.owner, vector.repo);
      assert.equal(locator.configuredLocator, vector.configuredLocator);
      assert.equal(locator.normalizedLocator, vector.normalizedLocator);
      assert.equal(locator.owner, vector.owner);
      assert.equal(locator.repo, vector.repo);
      assert.ok(Object.isFrozen(locator));
    }
    const lower = parseGitHubRepositoryLocator('acme', 'policy-repo');
    const mixed = parseGitHubRepositoryLocator('Acme', 'Policy-Repo');
    assert.equal(sameGitHubScope(lower, mixed), true);
    assert.notEqual(
      deriveSourceConnectionId({ providerCode: 'github', displayName: lower.configuredLocator }),
      deriveSourceConnectionId({ providerCode: 'github', displayName: mixed.configuredLocator }),
      'case variants share scope but keep their distinct historical identities',
    );
  });

  it('compares case-variant scope exactly as the golden vectors state', () => {
    for (const { a, b, sameScope } of vectors.scopeComparisons) {
      assert.equal(sameGitHubScope(parseGitHubLocatorString(a), parseGitHubLocatorString(b)), sameScope, `${a} vs ${b}`);
    }
  });

  it('preserves authorized refs exactly, without case or path normalization', () => {
    for (const ref of ['main', 'Main', 'feature/Source-Adapter', 'refs/heads/RELEASE', 'v1.0.0', 'ABCDEF0123456789ABCDEF0123456789ABCDEF01']) {
      assert.equal(validateAuthorizedRef(ref), ref);
    }
  });

  it('rejects unsupported V0 owners', () => {
    for (const owner of [
      '', ' acme', 'acme ', 'ac me', 'acme/x', 'acme\\x', 'acme:x', 'https://github.com/acme', '-acme', 'acme-',
      '.', '..', 'acme.org', 'acme_org', 'Ａcme', 'аcme', 'acmé', 'a'.repeat(40), 'acme\n',
    ]) {
      assert.throws(() => parseGitHubRepositoryLocator(owner, 'repo'), isCode(SOURCE_IDENTITY_ERROR_CODE.GITHUB_OWNER_UNSUPPORTED), JSON.stringify(owner));
    }
  });

  it('rejects unsupported V0 repositories', () => {
    for (const repo of [
      '', ' repo', 'repo ', 're po', 'repo/extra', 'repo\\x', 'repo:x', 'github.com/acme/repo', 'https://x',
      '.', '..', 'repo.git', 'repo.GIT', 'répo', 'rеpo', 'ｒepo', 'r'.repeat(101), 'repo\t',
    ]) {
      assert.throws(() => parseGitHubRepositoryLocator('acme', repo), isCode(SOURCE_IDENTITY_ERROR_CODE.GITHUB_REPOSITORY_UNSUPPORTED), JSON.stringify(repo));
    }
  });

  it('rejects ambiguous locator strings', () => {
    for (const locator of ['acme', 'acme/repo/extra', '/acme/repo', 'acme//repo', 'https://github.com/acme/repo', 'acme/repo/']) {
      assert.throws(() => parseGitHubLocatorString(locator), SourceIdentityError, locator);
    }
  });

  it('rejects invalid authorized refs', () => {
    for (const ref of ['', ' main', 'main ', '\tmain', 'ma\u0000in', 'main\n', 'ma\u007fin', 'ma\u0085in']) {
      assert.throws(() => validateAuthorizedRef(ref), isCode(SOURCE_IDENTITY_ERROR_CODE.AUTHORIZED_REF_INVALID), JSON.stringify(ref));
    }
  });

  it('GitHubSourceAdapter enforces the same V0 constraints without echoing input', () => {
    assert.throws(() => new GitHubSourceAdapter({ owner: '', repo: 'r', ref: 'main' }), /requires owner, repo, and ref/);
    assert.throws(() => new GitHubSourceAdapter({ owner: 'acme', repo: 'r', ref: '' }), /requires owner, repo, and ref/);
    for (const options of [
      { owner: 'acme ', repo: 'repo', ref: 'main' },
      { owner: 'acme', repo: 'repo.git', ref: 'main' },
      { owner: 'acme', repo: 'https://github.com/acme/repo', ref: 'main' },
      { owner: 'acme', repo: 'repo', ref: ' main' },
      { owner: 'acme', repo: 'repo', ref: 'main\u0000' },
    ]) {
      try {
        new GitHubSourceAdapter({ ...options, fetchImpl: neverFetch });
        assert.fail('expected rejection');
      } catch (error) {
        assert.ok(error instanceof SourceIdentityError);
        assert.equal(String(error).includes(options.repo === 'repo' ? options.ref : options.repo), false);
      }
    }
  });
});
