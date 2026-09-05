import { createHash } from 'node:crypto';
import { readdir, readFile, stat } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';

import { SOURCE_FAMILY } from '@council/canonical-contracts';

import { isDiscoveryPathExcluded } from '../path-policy';
import type {
  ReadArtifactOutcome,
  SourceAdapter,
  SourceArtifactRef,
  SourceDescriptor,
} from '../source-adapter';

const ADAPTER_NAME = 'local-repository-adapter';
const ADAPTER_VERSION = '1.0.0';

/**
 * Directory segments every local repository scan skips by default. This is
 * adapter-level hygiene (generated/private local tooling state) and is
 * separate from the Discovery Lab's own `.govia-lab` reservation, which is
 * enforced everywhere via {@link isDiscoveryPathExcluded}.
 */
const DEFAULT_EXCLUDED_SEGMENTS = new Set(['.git', 'node_modules']);

function normalizeToPosix(path: string): string {
  return path
    .replaceAll('\\', '/')
    .split('/')
    .filter((segment) => segment !== '' && segment !== '.')
    .join('/');
}

function isAdapterExcluded(repositoryPath: string): boolean {
  if (isDiscoveryPathExcluded(repositoryPath)) return true;
  return repositoryPath
    .split('/')
    .some((segment) => DEFAULT_EXCLUDED_SEGMENTS.has(segment));
}

function compareStableText(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function assertRepositoryRelativeLocator(locator: string): string {
  const trimmed = locator.trim();
  if (trimmed.length === 0) {
    throw new TypeError('Locator must be a non-empty string');
  }
  const posix = trimmed.replaceAll('\\', '/');
  if (posix.startsWith('/') || /^[A-Za-z]:/.test(posix)) {
    throw new TypeError('Locator must be repository-relative');
  }
  if (posix.split('/').some((segment) => segment === '..')) {
    throw new TypeError('Locator cannot contain path traversal');
  }
  return normalizeToPosix(posix);
}

/**
 * First concrete {@link SourceAdapter}: exposes a local directory (a
 * repository checkout, or any plain folder) to the discovery core. Core
 * discovery logic never sees Node's `fs`, drive letters, or path
 * separators — only the neutral locators this adapter produces.
 */
export class LocalRepositoryAdapter implements SourceAdapter {
  readonly adapterName = ADAPTER_NAME;
  readonly adapterVersion = ADAPTER_VERSION;

  private readonly rootPath: string;

  constructor(rootPath: string) {
    this.rootPath = resolve(rootPath);
  }

  describeSource(): SourceDescriptor {
    return {
      displayName: this.rootPath,
      family: SOURCE_FAMILY.REPOSITORY,
      providerCode: 'local-filesystem',
    };
  }

  async listArtifacts(): Promise<readonly SourceArtifactRef[]> {
    const rootStat = await stat(this.rootPath).catch(() => null);
    if (!rootStat || !rootStat.isDirectory()) {
      throw new TypeError(
        `Local repository root must be an existing directory: ${this.rootPath}`,
      );
    }

    const artifacts: SourceArtifactRef[] = [];

    const walk = async (directory: string): Promise<void> => {
      const entries = await readdir(directory, { withFileTypes: true });
      entries.sort((left, right) => compareStableText(left.name, right.name));

      for (const entry of entries) {
        const absolutePath = resolve(directory, entry.name);
        const repositoryPath = normalizeToPosix(
          relative(this.rootPath, absolutePath),
        );
        if (isAdapterExcluded(repositoryPath)) continue;

        if (entry.isDirectory()) {
          await walk(absolutePath);
          continue;
        }
        if (!entry.isFile()) continue;

        const fileStat = await stat(absolutePath);
        artifacts.push({
          locator: repositoryPath,
          kind: 'file',
          sizeBytes: fileStat.size,
        });
      }
    };

    await walk(this.rootPath);
    artifacts.sort((left, right) => compareStableText(left.locator, right.locator));
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

    if (isAdapterExcluded(safeLocator)) {
      return { ok: false, locator: safeLocator, reason: 'Locator is excluded by discovery policy' };
    }

    const absolutePath = resolve(this.rootPath, ...safeLocator.split('/'));
    const relativePath = relative(this.rootPath, absolutePath);
    if (relativePath === '..' || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)) {
      return { ok: false, locator: safeLocator, reason: 'Locator escapes the repository root' };
    }

    let fileStat;
    try {
      fileStat = await stat(absolutePath);
    } catch {
      return { ok: false, locator: safeLocator, reason: 'Artifact does not exist' };
    }
    if (!fileStat.isFile()) {
      return { ok: false, locator: safeLocator, reason: 'Locator does not identify a file' };
    }

    let buffer: Buffer;
    try {
      buffer = await readFile(absolutePath);
    } catch (error) {
      return {
        ok: false,
        locator: safeLocator,
        reason: error instanceof Error ? error.message : 'Artifact could not be read',
      };
    }

    let text: string;
    try {
      text = decodeStrictUtf8(buffer);
    } catch {
      return { ok: false, locator: safeLocator, reason: 'Artifact is not valid UTF-8 text' };
    }

    const contentHash = createHash('sha256').update(buffer).digest('hex');
    return {
      ok: true,
      content: { locator: safeLocator, text, encoding: 'utf8', contentHash },
    };
  }
}

/** Rejects binary content instead of silently substituting replacement characters. */
function decodeStrictUtf8(buffer: Buffer): string {
  const decoder = new TextDecoder('utf-8', { fatal: true });
  return decoder.decode(buffer);
}
