import type { AcquisitionRun } from '@council/canonical-contracts';

import type { DetectionMatch, DetectionSpecification } from './detection-specification';
import { attachExecutionDeclarations } from './execution-declaration';
import { assembleDiscoveryCandidate, type DiscoveryCandidate } from './evidence-assembly';
import {
  completeAcquisitionRun,
  createSourceConnection,
  createSourceSystem,
  startAcquisitionRun,
  systemClock,
  type ProvenanceClock,
} from './provenance';
import type { SourceAdapter, SourceArtifactRef } from './source-adapter';
import {
  assembleTechnicalProfileSignal,
  type TechnicalProfileSignal,
  type TechnicalProfileSignalMatch,
  type TechnicalProfileSignalSpecification,
} from './technical-profile-signal';

/** An artifact or specification the pipeline skipped rather than trusted blindly. */
export interface DiscoveryRunWarning {
  readonly locator: string;
  readonly reason: string;
}

/**
 * Thrown instead of a bare error whenever `run()` fails closed after
 * `startAcquisitionRun` has already produced a run identity (and, for a
 * versioned adapter, after `resolveSourceVersion` has already resolved and
 * merged its immutable sourceVersion into that run — see `run()` below).
 * Carries the exact terminal, FAILED `AcquisitionRun` the pipeline itself
 * computed, so a caller (e.g. Discovery Intake) can persist that real
 * provenance directly instead of reconstructing a fresh run from adapter
 * identity alone and silently losing an already-known immutable source
 * version. The wrapped `cause` is the original failure (a network error, an
 * invalid/truncated tree, ...); `message` mirrors it so existing callers
 * that only inspect `error.message` are unaffected.
 */
export class DiscoveryPipelineFailure extends Error {
  readonly run: AcquisitionRun;

  constructor(run: AcquisitionRun, cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause), { cause });
    this.name = 'DiscoveryPipelineFailure';
    this.run = run;
  }
}

export interface DiscoveryRunResult {
  readonly run: AcquisitionRun;
  readonly candidates: readonly DiscoveryCandidate[];
  /**
   * The count of artifacts returned by this run's own, single
   * `adapter.listArtifacts()` enumeration (see `run()` below) — never a
   * second, later re-enumeration. A caller that wants an accurate artifact
   * count (e.g. Discovery Intake's executive summary) must read it from here
   * rather than calling `listArtifacts()` again, which for a remote adapter
   * (e.g. GitHubSourceAdapter) would otherwise issue a second, redundant
   * network request purely to recompute a number this run already knows.
   */
  readonly artifactsScanned: number;
  /**
   * AgentVersion technical-profile signals (Framework/Memory/Orchestration
   * — see technical-profile-signal.ts) collected in the same single pass
   * over the source. Structurally separate from `candidates`: never a
   * CanonicalObjectKind, never routed through Object Candidate
   * Normalization or ReviewSubject creation.
   */
  readonly technicalProfileSignals: readonly TechnicalProfileSignal[];
  readonly warnings: readonly DiscoveryRunWarning[];
}

export interface DiscoveryPipelineOptions {
  readonly clock?: ProvenanceClock;
  /** Artifacts larger than this are skipped with a warning, never read. */
  readonly maxArtifactSizeBytes?: number;
  /** Optional AgentVersion technical-profile signal specifications, run in the same artifact pass as `specifications`. */
  readonly signalSpecifications?: readonly TechnicalProfileSignalSpecification[];
}

const DEFAULT_MAX_ARTIFACT_SIZE_BYTES = 2_000_000;

/**
 * Deterministic pipeline: SourceAdapter -> enumerate -> read -> detect ->
 * evidence-backed candidates. It never decides governance; every output
 * candidate carries `requiresReview: true` / `createsCanonicalObject: false`
 * by construction (see evidence-assembly.ts).
 */
export class DiscoveryPipeline {
  private readonly adapter: SourceAdapter;
  private readonly specifications: readonly DetectionSpecification[];
  private readonly options: DiscoveryPipelineOptions;

  constructor(
    adapter: SourceAdapter,
    specifications: readonly DetectionSpecification[],
    options: DiscoveryPipelineOptions = {},
  ) {
    this.adapter = adapter;
    this.specifications = specifications;
    this.options = options;
  }

  async run(): Promise<DiscoveryRunResult> {
    const clock = this.options.clock ?? systemClock;
    const maxArtifactSizeBytes =
      this.options.maxArtifactSizeBytes ?? DEFAULT_MAX_ARTIFACT_SIZE_BYTES;

    const descriptor = this.adapter.describeSource();
    const system = createSourceSystem(descriptor);
    const connection = createSourceConnection(system, descriptor);
    let run = startAcquisitionRun(this.adapter, connection, clock);

    // Resolve exactly once, logically, for the run: GitHubSourceAdapter caches
    // its own immutable SHA internally, so this call and every later
    // listArtifacts()/readArtifact() call it makes all observe the same
    // commit. A resolution failure fails the whole run closed, before any
    // discovery output is produced, rather than presenting output captured
    // against an unresolved/undefined source version as a successful
    // acquisition. Adapters without resolveSourceVersion() (e.g.
    // LocalRepositoryAdapter) are unaffected: run.sourceVersion stays absent,
    // never fabricated.
    if (this.adapter.resolveSourceVersion) {
      let sourceVersion: string | undefined;
      try {
        sourceVersion = await this.adapter.resolveSourceVersion();
      } catch (error) {
        // Resolution itself failed: no sourceVersion is known at all, so the
        // terminal run correctly carries none — never fabricated, never
        // retried here merely to try to recover one.
        throw new DiscoveryPipelineFailure(completeAcquisitionRun(run, 'FAILED', clock), error);
      }
      run = { ...run, ...(sourceVersion === undefined ? {} : { sourceVersion }) };
    }

    const warnings: DiscoveryRunWarning[] = [];
    const candidates: DiscoveryCandidate[] = [];
    const technicalProfileSignals: TechnicalProfileSignal[] = [];
    const signalSpecifications = this.options.signalSpecifications ?? [];

    let artifacts: readonly SourceArtifactRef[];
    try {
      artifacts = await this.adapter.listArtifacts();
    } catch (error) {
      // Fail closed: an unenumerable source produces no candidates at all,
      // never a partial/best-effort result presented as complete. `run` at
      // this point already carries any sourceVersion resolved above (a
      // GitHub-style adapter resolves it once and caches it internally, so
      // this listArtifacts() failure never needs — and must never trigger —
      // a second resolution call); DiscoveryPipelineFailure preserves that
      // exact value for the caller rather than losing it.
      throw new DiscoveryPipelineFailure(completeAcquisitionRun(run, 'FAILED', clock), error);
    }

    for (const artifactRef of artifacts) {
      if (artifactRef.sizeBytes > maxArtifactSizeBytes) {
        warnings.push({
          locator: artifactRef.locator,
          reason: `Artifact exceeds the ${maxArtifactSizeBytes} byte limit and was skipped`,
        });
        continue;
      }

      const outcome = await this.adapter.readArtifact(artifactRef.locator);
      if (!outcome.ok) {
        warnings.push({ locator: outcome.locator, reason: outcome.reason });
        continue;
      }

      const artifactCandidateStart = candidates.length;
      for (const specification of this.specifications) {
        let matches: readonly DetectionMatch[];
        try {
          matches = specification.isSatisfiedBy(outcome.content);
        } catch (error) {
          warnings.push({
            locator: artifactRef.locator,
            reason: `Specification "${specification.code}" failed: ${
              error instanceof Error ? error.message : String(error)
            }`,
          });
          continue;
        }

        for (const match of matches) {
          candidates.push(
            assembleDiscoveryCandidate({
              connection,
              run,
              artifact: outcome.content,
              specification,
              match,
              observedAt: clock.now(),
            }),
          );
        }
      }

      const attached = attachExecutionDeclarations(outcome.content, candidates.slice(artifactCandidateStart));
      candidates.splice(artifactCandidateStart, candidates.length - artifactCandidateStart, ...attached);

      for (const specification of signalSpecifications) {
        let matches: readonly TechnicalProfileSignalMatch[];
        try {
          matches = specification.detect(outcome.content);
        } catch (error) {
          warnings.push({
            locator: artifactRef.locator,
            reason: `Technical-profile signal specification "${specification.code}" failed: ${
              error instanceof Error ? error.message : String(error)
            }`,
          });
          continue;
        }

        for (const match of matches) {
          technicalProfileSignals.push(
            assembleTechnicalProfileSignal({
              connection,
              run,
              artifact: outcome.content,
              specification,
              match,
              observedAt: clock.now(),
            }),
          );
        }
      }
    }

    run = completeAcquisitionRun(run, 'SUCCEEDED', clock);
    return {
      run,
      candidates: Object.freeze(candidates),
      artifactsScanned: artifacts.length,
      technicalProfileSignals: Object.freeze(technicalProfileSignals),
      warnings: Object.freeze(warnings),
    };
  }
}
