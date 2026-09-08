import type { AcquisitionRun } from '@council/canonical-contracts';

import type { DetectionMatch, DetectionSpecification } from './detection-specification';
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

export interface DiscoveryRunResult {
  readonly run: AcquisitionRun;
  readonly candidates: readonly DiscoveryCandidate[];
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

    const warnings: DiscoveryRunWarning[] = [];
    const candidates: DiscoveryCandidate[] = [];
    const technicalProfileSignals: TechnicalProfileSignal[] = [];
    const signalSpecifications = this.options.signalSpecifications ?? [];

    let artifacts: readonly SourceArtifactRef[];
    try {
      artifacts = await this.adapter.listArtifacts();
    } catch (error) {
      // Fail closed: an unenumerable source produces no candidates at all,
      // never a partial/best-effort result presented as complete.
      completeAcquisitionRun(run, 'FAILED', clock);
      throw error;
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
      technicalProfileSignals: Object.freeze(technicalProfileSignals),
      warnings: Object.freeze(warnings),
    };
  }
}
