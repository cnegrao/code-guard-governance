import { createHash } from 'node:crypto';

import { asSourceConnectionId, type SourceConnectionId } from '@council/canonical-contracts';

import type { SourceDescriptor } from './source-adapter';

/**
 * Deterministic source identity and GitHub source-scope comparison
 * (ADR-GOVIA-GOVERNED-DISCOVERY-MACHINE-EXECUTION-BOUNDARY-v1, section 12).
 *
 * Two distinct concepts are kept apart here:
 *
 * - IDENTITY: `deriveSourceConnectionId` is the existing, historical
 *   connection-identity algorithm, extracted unchanged. It hashes the
 *   descriptor exactly as configured (original owner/repo spelling) and never
 *   validates, trims or case-normalizes anything. Every previously derived
 *   `source-connection:` identity stays byte-identical.
 * - SCOPE: the normalized GitHub locator is only a comparison representation
 *   (for future execution-binding scope checks). It is never hashed into an
 *   identity and never forms a new canonical source namespace or registry.
 */

/** The existing connection identity: "source-connection:" + first32hex(SHA256(UTF8(providerCode + ":" + displayName))). */
export function deriveSourceConnectionId(
  descriptor: Pick<SourceDescriptor, 'providerCode' | 'displayName'>,
): SourceConnectionId {
  const seed = createHash('sha256')
    .update(`${descriptor.providerCode}:${descriptor.displayName}`)
    .digest('hex')
    .slice(0, 32);
  return asSourceConnectionId(`source-connection:${seed}`);
}

export const GITHUB_PROVIDER_CODE = 'github';

export const SOURCE_IDENTITY_ERROR_CODE = {
  GITHUB_OWNER_UNSUPPORTED: 'GITHUB_OWNER_UNSUPPORTED',
  GITHUB_REPOSITORY_UNSUPPORTED: 'GITHUB_REPOSITORY_UNSUPPORTED',
  GITHUB_LOCATOR_UNSUPPORTED: 'GITHUB_LOCATOR_UNSUPPORTED',
  AUTHORIZED_REF_INVALID: 'AUTHORIZED_REF_INVALID',
} as const;

export type SourceIdentityErrorCode =
  (typeof SOURCE_IDENTITY_ERROR_CODE)[keyof typeof SOURCE_IDENTITY_ERROR_CODE];

/** Raised for input outside the supported source-identity contract. Never echoes the rejected value. */
export class SourceIdentityError extends TypeError {
  readonly code: SourceIdentityErrorCode;

  constructor(code: SourceIdentityErrorCode) {
    super(`Unsupported source identity input (${code})`);
    this.name = 'SourceIdentityError';
    this.code = code;
  }
}

/**
 * COMMERCIAL V0 SUPPORT CONSTRAINT, not a claim about every name GitHub may
 * accept: owner = ASCII letters/digits/hyphen, not starting or ending with a
 * hyphen, at most 39 characters; repository = ASCII letters/digits and
 * `.`, `_`, `-`, at most 100 characters, never `.`/`..` and never a `.git`
 * suffix. Anything else (whitespace, `/`, `\`, `:`, URL or path forms,
 * non-ASCII including Unicode confusables) is rejected rather than
 * reinterpreted.
 */
const GITHUB_OWNER_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;
const GITHUB_REPOSITORY_PATTERN = /^[A-Za-z0-9._-]{1,100}$/;
const GIT_SUFFIX_PATTERN = /\.git$/i;

export interface GitHubRepositoryLocator {
  readonly owner: string;
  readonly repo: string;
  /** Exact configured spelling, `owner/repo`; the only form ever used for deterministic identity. */
  readonly configuredLocator: string;
  /** Locale-independent ASCII-lowercase `owner/repo`; scope comparison only, never identity. */
  readonly normalizedLocator: string;
}

/** Locale-independent: maps only ASCII A-Z to a-z. Callers only pass already-ASCII-validated text. */
function asciiLowercase(value: string): string {
  return value.replace(/[A-Z]/g, (letter) => String.fromCharCode(letter.charCodeAt(0) + 32));
}

function assertSupportedOwner(owner: string): void {
  if (!GITHUB_OWNER_PATTERN.test(owner)) {
    throw new SourceIdentityError(SOURCE_IDENTITY_ERROR_CODE.GITHUB_OWNER_UNSUPPORTED);
  }
}

function assertSupportedRepository(repo: string): void {
  if (!GITHUB_REPOSITORY_PATTERN.test(repo) || repo === '.' || repo === '..' || GIT_SUFFIX_PATTERN.test(repo)) {
    throw new SourceIdentityError(SOURCE_IDENTITY_ERROR_CODE.GITHUB_REPOSITORY_UNSUPPORTED);
  }
}

export function parseGitHubRepositoryLocator(owner: string, repo: string): GitHubRepositoryLocator {
  if (typeof owner !== 'string') throw new SourceIdentityError(SOURCE_IDENTITY_ERROR_CODE.GITHUB_OWNER_UNSUPPORTED);
  if (typeof repo !== 'string') throw new SourceIdentityError(SOURCE_IDENTITY_ERROR_CODE.GITHUB_REPOSITORY_UNSUPPORTED);
  assertSupportedOwner(owner);
  assertSupportedRepository(repo);
  const configuredLocator = `${owner}/${repo}`;
  return Object.freeze({
    owner,
    repo,
    configuredLocator,
    normalizedLocator: asciiLowercase(configuredLocator),
  });
}

/** Parses an `owner/repo` string (e.g. a configured locator or GitHub's observed `full_name`). Exactly one `/`. */
export function parseGitHubLocatorString(locator: string): GitHubRepositoryLocator {
  if (typeof locator !== 'string') throw new SourceIdentityError(SOURCE_IDENTITY_ERROR_CODE.GITHUB_LOCATOR_UNSUPPORTED);
  const parts = locator.split('/');
  if (parts.length !== 2) throw new SourceIdentityError(SOURCE_IDENTITY_ERROR_CODE.GITHUB_LOCATOR_UNSUPPORTED);
  return parseGitHubRepositoryLocator(parts[0], parts[1]);
}

/** Case variants compare equal for scope; their configured identities (and connection IDs) may still differ. */
export function sameGitHubScope(a: GitHubRepositoryLocator, b: GitHubRepositoryLocator): boolean {
  return a.normalizedLocator === b.normalizedLocator;
}

// C0 controls, DEL and C1 controls.
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f-\u009f]/;

/**
 * Exact, case-sensitive authorized ref. Returned unchanged when valid; never
 * normalized (owner/repo case normalization never applies to refs or paths).
 */
export function validateAuthorizedRef(ref: string): string {
  if (
    typeof ref !== 'string' ||
    ref.length === 0 ||
    ref.trim() !== ref ||
    CONTROL_CHARACTER_PATTERN.test(ref)
  ) {
    throw new SourceIdentityError(SOURCE_IDENTITY_ERROR_CODE.AUTHORIZED_REF_INVALID);
  }
  return ref;
}
