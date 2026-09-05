// Source-agnostic boundary between the discovery core and any concrete
// source of repository content (local filesystem, GitHub, GitLab, ...).
// Core discovery logic depends only on this contract, never on a
// provider's own vocabulary.

import type { SourceFamily } from '@council/canonical-contracts';

/** Opaque, adapter-assigned metadata describing where content came from. */
export interface SourceDescriptor {
  readonly displayName: string;
  readonly family: SourceFamily;
  /** Opaque provider metadata, never a canonical object kind (e.g. "local-filesystem"). */
  readonly providerCode: string;
}

/** One discoverable artifact, prior to reading its content. */
export interface SourceArtifactRef {
  /** Repository-relative, forward-slash-normalized locator. Never absolute. */
  readonly locator: string;
  readonly kind: 'file';
  readonly sizeBytes: number;
}

/** The realized content of one artifact. */
export interface SourceArtifactContent {
  readonly locator: string;
  readonly text: string;
  readonly encoding: 'utf8';
  /** sha256 hex digest of the exact bytes read. */
  readonly contentHash: string;
}

export type ReadArtifactOutcome =
  | { readonly ok: true; readonly content: SourceArtifactContent }
  | { readonly ok: false; readonly locator: string; readonly reason: string };

/**
 * Adapter boundary. Implementations own every provider-specific detail
 * (filesystem walking, API pagination, auth, ...); the core discovery
 * pipeline only ever sees these neutral domain objects.
 */
export interface SourceAdapter {
  readonly adapterName: string;
  readonly adapterVersion: string;

  describeSource(): SourceDescriptor;

  /** Deterministically ordered; excludes anything the adapter's own policy forbids. */
  listArtifacts(): Promise<readonly SourceArtifactRef[]>;

  /** Never throws for missing/unreadable content; reports failure via the outcome. */
  readArtifact(locator: string): Promise<ReadArtifactOutcome>;
}
