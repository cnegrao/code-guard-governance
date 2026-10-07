import { createHash } from 'node:crypto';

import { SOURCE_FAMILY } from '@council/canonical-contracts';

import { isDiscoveryPathExcluded } from '../path-policy';
import type {
  ProviderSourceIdentity,
  ReadArtifactOutcome,
  SourceAdapter,
  SourceArtifactRef,
  SourceDescriptor,
} from '../source-adapter';
import {
  GITHUB_PROVIDER_CODE,
  parseGitHubLocatorString,
  parseGitHubRepositoryLocator,
  validateAuthorizedRef,
  type GitHubRepositoryLocator,
} from '../source-identity';

/**
 * A renamed/transferred repository answers with an HTTP redirect. It is never
 * followed: the configured locator no longer identifies the acquired source,
 * so acquisition fails closed and trusted provisioning must rebind.
 */
export class GitHubRepositoryRedirectedError extends Error {
  constructor() {
    super('GitHub repository redirected - rebinding required');
    this.name = 'GitHubRepositoryRedirectedError';
  }
}

export interface GitHubSourceAdapterOptions {
  readonly owner: string;
  readonly repo: string;
  readonly ref: string;
  readonly token?: string;
  readonly apiBaseUrl?: string;
  readonly fetchImpl?: typeof globalThis.fetch;
}

export type GitHubSourceAdapterInput = GitHubSourceAdapterOptions;

interface GitHubTreeEntry {
  readonly path?: unknown;
  readonly type?: unknown;
  readonly size?: unknown;
}

interface GitHubTreeResponse {
  readonly tree?: unknown;
  readonly truncated?: unknown;
}

interface GitHubContentsResponse {
  readonly type?: unknown;
  readonly encoding?: unknown;
  readonly content?: unknown;
  readonly path?: unknown;
}

const ADAPTER_NAME = 'github-source-adapter';
const ADAPTER_VERSION = '1.0.0';
const DEFAULT_API_BASE_URL = 'https://api.github.com';
const FULL_SHA_PATTERN = /^[0-9a-fA-F]{40}$/;
const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

function normalizeApiBaseUrl(apiBaseUrl: string | undefined): string {
  return (apiBaseUrl ?? DEFAULT_API_BASE_URL).replace(/\/+$/, '');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertRepositoryRelativeLocator(locator: string): string {
  if (
    locator.length === 0 ||
    locator.startsWith('/') ||
    locator.includes('\\') ||
    locator.includes('//') ||
    /^[A-Za-z]:/.test(locator) ||
    locator.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')
  ) {
    throw new TypeError('Locator must be a repository-relative forward-slash path');
  }
  return locator;
}

function normalizeResolvedSha(value: unknown): string {
  if (typeof value !== 'string' || !FULL_SHA_PATTERN.test(value)) {
    throw new Error('GitHub returned an invalid commit SHA');
  }
  return value.toLowerCase();
}

function decodeBase64Bytes(value: string): Buffer | undefined {
  // The GitHub REST Contents API line-wraps base64 content with CR/LF. Normalize only
  // CR and LF before validation/decoding; any other stray character (space, tab, etc.)
  // must still fail closed rather than be silently stripped.
  const normalized = value.replace(/[\r\n]/g, '');
  if (!BASE64_PATTERN.test(normalized)) {
    return undefined;
  }
  const bytes = Buffer.from(normalized, 'base64');
  return bytes.toString('base64') === normalized ? bytes : undefined;
}

function decodeStrictUtf8(bytes: Buffer): string {
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

export class GitHubSourceAdapter implements SourceAdapter {
  readonly adapterName = ADAPTER_NAME;
  readonly adapterVersion = ADAPTER_VERSION;

  private readonly owner: string;
  private readonly repo: string;
  private readonly ref: string;
  private readonly token?: string;
  private readonly apiBaseUrl: string;
  private readonly fetchImpl: typeof globalThis.fetch;
  private readonly locator: GitHubRepositoryLocator;
  private resolvedSha: string | undefined;
  private resolutionPromise: Promise<string> | undefined;
  private providerIdentityPromise: Promise<ProviderSourceIdentity> | undefined;

  constructor(options: GitHubSourceAdapterOptions) {
    if (!options.owner || !options.repo || !options.ref) {
      throw new TypeError('GitHub source adapter requires owner, repo, and ref');
    }
    // Commercial V0 support constraint; valid input is kept verbatim, so the
    // configured owner/repo spelling (and its connection identity) is unchanged.
    this.locator = parseGitHubRepositoryLocator(options.owner, options.repo);
    validateAuthorizedRef(options.ref);

    this.owner = options.owner;
    this.repo = options.repo;
    this.ref = options.ref;
    this.token = options.token;
    this.apiBaseUrl = normalizeApiBaseUrl(options.apiBaseUrl);
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
  }

  describeSource(): SourceDescriptor {
    return {
      displayName: `${this.owner}/${this.repo}`,
      family: SOURCE_FAMILY.REPOSITORY,
      providerCode: 'github',
    };
  }

  async resolveSourceVersion(): Promise<string | undefined> {
    if (this.resolvedSha) {
      return `commit:${this.resolvedSha}`;
    }
    if (!this.resolutionPromise) {
      const pendingResolution = this.fetchResolvedSha();
      this.resolutionPromise = pendingResolution;
      try {
        const sha = await pendingResolution;
        this.resolvedSha = sha;
        return `commit:${sha}`;
      } catch (error) {
        if (this.resolutionPromise === pendingResolution) {
          this.resolutionPromise = undefined;
        }
        throw error;
      }
    }

    const sha = await this.resolutionPromise;
    this.resolvedSha = sha;
    return `commit:${sha}`;
  }

  /**
   * Immutable GitHub repository id plus the provider-reported `full_name`,
   * which must match the configured locator under normalized scope
   * comparison. Memoized; a failed resolution is not cached.
   */
  resolveProviderSourceIdentity(): Promise<ProviderSourceIdentity> {
    if (!this.providerIdentityPromise) {
      const pending = this.fetchProviderSourceIdentity();
      this.providerIdentityPromise = pending;
      pending.catch(() => {
        if (this.providerIdentityPromise === pending) {
          this.providerIdentityPromise = undefined;
        }
      });
    }
    return this.providerIdentityPromise;
  }

  async listArtifacts(): Promise<readonly SourceArtifactRef[]> {
    const version = await this.resolveSourceVersion();
    const sha = version?.startsWith('commit:') ? version.slice('commit:'.length) : undefined;
    if (!sha) {
      throw new Error('GitHub source version could not be resolved');
    }

    const response = await this.fetchJson(
      `/repos/${encodeURIComponent(this.owner)}/${encodeURIComponent(this.repo)}/git/trees/${encodeURIComponent(sha)}?recursive=1`,
    );
    if (!isRecord(response) || response.truncated === true) {
      throw new Error('GitHub repository tree is incomplete');
    }
    if (!Array.isArray(response.tree)) {
      throw new Error('GitHub returned an invalid repository tree');
    }

    const artifacts: SourceArtifactRef[] = [];
    for (const entry of response.tree) {
      if (!isRecord(entry)) {
        throw new Error('GitHub returned an invalid repository tree entry');
      }
      if (entry.type !== 'blob' && entry.type !== 'file') {
        continue;
      }
      if (typeof entry.path !== 'string') {
        throw new Error('GitHub returned a repository tree entry without a path');
      }

      let locator: string;
      try {
        locator = assertRepositoryRelativeLocator(entry.path);
      } catch {
        throw new Error('GitHub returned an invalid repository-relative path');
      }
      if (isDiscoveryPathExcluded(locator)) {
        continue;
      }

      if (
        typeof entry.size !== 'number' ||
        !Number.isFinite(entry.size) ||
        entry.size < 0
      ) {
        throw new Error('GitHub returned a repository tree entry without a valid size');
      }
      artifacts.push({ locator, kind: 'file', sizeBytes: entry.size });
    }

    artifacts.sort((left, right) => (left.locator < right.locator ? -1 : left.locator > right.locator ? 1 : 0));
    return Object.freeze(artifacts);
  }

  async readArtifact(locator: string): Promise<ReadArtifactOutcome> {
    let safeLocator: string;
    try {
      safeLocator = assertRepositoryRelativeLocator(locator);
    } catch (error) {
      return {
        ok: false,
        locator,
        reason: error instanceof Error ? error.message : 'Invalid locator',
      };
    }
    if (isDiscoveryPathExcluded(safeLocator)) {
      return { ok: false, locator: safeLocator, reason: 'Locator is excluded by discovery policy' };
    }

    let sha: string | undefined;
    try {
      const version = await this.resolveSourceVersion();
      sha = version?.startsWith('commit:') ? version.slice('commit:'.length) : undefined;
    } catch {
      return { ok: false, locator: safeLocator, reason: 'GitHub source version could not be resolved' };
    }
    if (!sha) {
      return { ok: false, locator: safeLocator, reason: 'GitHub source version could not be resolved' };
    }

    const path = safeLocator.split('/').map(encodeURIComponent).join('/');
    let response: unknown;
    try {
      response = await this.fetchJson(
        `/repos/${encodeURIComponent(this.owner)}/${encodeURIComponent(this.repo)}/contents/${path}?ref=${encodeURIComponent(sha)}`,
      );
    } catch (error) {
      if (error instanceof GitHubRepositoryRedirectedError) {
        return { ok: false, locator: safeLocator, reason: error.message };
      }
      return { ok: false, locator: safeLocator, reason: 'Artifact could not be read from GitHub' };
    }

    if (
      !isRecord(response) ||
      response.type !== 'file' ||
      response.encoding !== 'base64' ||
      typeof response.content !== 'string'
    ) {
      return { ok: false, locator: safeLocator, reason: 'GitHub returned non-file or non-base64 content' };
    }
    if (typeof response.path !== 'string' || response.path !== safeLocator) {
      return { ok: false, locator: safeLocator, reason: 'GitHub returned content for an unexpected path' };
    }

    const bytes = decodeBase64Bytes(response.content);
    if (!bytes) {
      return { ok: false, locator: safeLocator, reason: 'GitHub returned invalid base64 content' };
    }

    let text: string;
    try {
      text = decodeStrictUtf8(bytes);
    } catch {
      return { ok: false, locator: safeLocator, reason: 'Artifact is not valid UTF-8 text' };
    }

    return {
      ok: true,
      content: {
        locator: safeLocator,
        text,
        encoding: 'utf8',
        contentHash: createHash('sha256').update(bytes).digest('hex'),
      },
    };
  }

  private async fetchResolvedSha(): Promise<string> {
    const response = await this.fetchJson(
      `/repos/${encodeURIComponent(this.owner)}/${encodeURIComponent(this.repo)}/commits/${encodeURIComponent(this.ref)}`,
    );
    if (!isRecord(response)) {
      throw new Error('GitHub returned an invalid commit response');
    }
    return normalizeResolvedSha(response.sha);
  }

  private async fetchProviderSourceIdentity(): Promise<ProviderSourceIdentity> {
    const response = await this.fetchJson(
      `/repos/${encodeURIComponent(this.owner)}/${encodeURIComponent(this.repo)}`,
    );
    if (!isRecord(response)) {
      throw new Error('GitHub returned an invalid repository response');
    }
    const { id, full_name: fullName } = response;
    if (typeof id !== 'number' || !Number.isSafeInteger(id) || id <= 0) {
      throw new Error('GitHub returned an invalid repository id');
    }
    if (typeof fullName !== 'string') {
      throw new Error('GitHub returned an invalid repository full_name');
    }
    let observed: GitHubRepositoryLocator;
    try {
      observed = parseGitHubLocatorString(fullName);
    } catch {
      throw new Error('GitHub returned an invalid repository full_name');
    }
    if (observed.normalizedLocator !== this.locator.normalizedLocator) {
      throw new Error('GitHub repository identity does not match the configured locator');
    }
    return Object.freeze({
      providerCode: GITHUB_PROVIDER_CODE,
      providerSourceId: String(id),
      observedLocator: fullName,
    });
  }

  private async fetchJson(path: string): Promise<unknown> {
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    };
    if (this.token) {
      headers.Authorization = `Bearer ${this.token}`;
    }

    let response: Response;
    try {
      response = await this.fetchImpl(`${this.apiBaseUrl}${path}`, {
        method: 'GET',
        headers,
        redirect: 'manual',
      });
    } catch {
      throw new Error('GitHub API request failed');
    }
    if (response.type === 'opaqueredirect' || (response.status >= 300 && response.status < 400)) {
      throw new GitHubRepositoryRedirectedError();
    }
    if (!response.ok) {
      throw new Error('GitHub API request failed');
    }

    try {
      return await response.json();
    } catch {
      throw new Error('GitHub API response could not be parsed');
    }
  }
}
