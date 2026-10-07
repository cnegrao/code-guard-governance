import type {
  AcquisitionRunId,
  CanonicalObjectKind,
  DiscoveryCandidateKind,
  DiscoveryFinding,
  DiscoveryFindingId,
  Evidence,
  ExecutionSourceSnapshot,
  IsoTimestamp,
  NormalizedCandidate,
  NormalizedRelationshipCandidate,
  RelationshipDiscoveryFinding,
  SourceAssertion,
} from "@council/canonical-contracts";

import type { AgentVersionTechnicalProfileProposalInput } from "../agent-version-technical-profile-port.ts";
import type { AcquisitionRunCounts } from "../discovery-intake-port.ts";
import type { ReviewSubjectId, ReviewTransitionId } from "../identifiers.ts";
import type { ReviewState } from "../review-state.ts";
import {
  MACHINE_COMMAND_OUTCOME,
  MACHINE_DENIAL_CODE,
  asExecutionBindingId,
  type ExecutionBindingId,
  type MachineCommandResult,
  type MachineIntakeMutationResult,
  type MachineReadResult,
  type RunBindingProvenance,
} from "./contracts.ts";
import { ACQUISITION_RUN_ID_PATTERN, DISCOVERY_FINDING_ID_PATTERN } from "./identity.ts";

/**
 * Closed machine ports for governed Discovery. They intentionally do NOT
 * extend DiscoveryIntakePersistencePort or GovernanceReviewPersistencePort
 * and expose no actor, state, rule, role, organisation or subject selector,
 * no HUMAN action, reconciliation, materialization, canonical write or
 * generic SQL/DML. Organisation and source scope always come from the
 * execution binding that admitted the run, resolved by the database.
 * Intake never proposes as a side effect; PROPOSE is a separate command.
 */

// ---------------------------------------------------------------------------
// Intake commands (pre-canonical admission and exact scope-bound reads)
// ---------------------------------------------------------------------------

export interface MachineOpenAcquisitionRunCommand {
  /** Selector only; the DB verifies the binding belongs to the authenticated principal. */
  readonly bindingId: ExecutionBindingId;
  readonly configuredLocator: string;
  readonly authorizedRef: string;
  readonly adapterName: string;
  readonly adapterVersion: string;
  /** Worker-observed provider pin; checked against the binding when pinned. */
  readonly providerSourceId?: string;
  /** Worker-resolved immutable source version; absent when unknown, never fabricated. */
  readonly resolvedSourceVersion?: string;
  /** Source observation time; not the DB-authored admission time. */
  readonly startedAt: IsoTimestamp;
}

export type MachineAcquisitionTerminalStatus = "SUCCEEDED" | "PARTIAL" | "FAILED";

export type MachineAcquisitionFailureCode = "PROVIDER_REDIRECT" | "PROVIDER_IDENTITY_MISMATCH" | "ACQUISITION_FAILED";

export type MachineCompleteAcquisitionRunCommand = {
  readonly acquisitionRunId: AcquisitionRunId;
  /** Operational counts reported by the worker; never governance outcomes. */
  readonly counts: AcquisitionRunCounts;
  readonly completedAt: IsoTimestamp;
} & (
  | { readonly status: "FAILED"; readonly failureCode?: MachineAcquisitionFailureCode }
  | { readonly status: "SUCCEEDED" | "PARTIAL"; readonly failureCode?: never }
);

export interface MachineAdmitObservationCommand {
  readonly acquisitionRunId: AcquisitionRunId;
  readonly evidence: readonly Evidence[];
  readonly assertion: SourceAssertion;
}

export interface MachineAdmitFindingCommand {
  readonly acquisitionRunId: AcquisitionRunId;
  readonly finding: DiscoveryFinding<DiscoveryCandidateKind>;
  readonly candidate?: NormalizedCandidate;
}

export interface MachineAdmitLineageObservationCommand {
  readonly acquisitionRunId: AcquisitionRunId;
  readonly finding: RelationshipDiscoveryFinding;
  readonly candidate: NormalizedRelationshipCandidate;
}

/** Selector for subject creation (initial state fixed to DETECTED by the DB) and exact candidate reads. */
export interface MachineRunFindingSelector {
  readonly acquisitionRunId: AcquisitionRunId;
  readonly findingId: DiscoveryFindingId;
}

export interface MachineRecordTechnicalProfileProposalCommand {
  readonly acquisitionRunId: AcquisitionRunId;
  readonly proposal: Omit<AgentVersionTechnicalProfileProposalInput, "organisationId">;
}

/** source_scope, organisation and source system/provider are derived by the DB from the admitted run. */
export type MachineExecutionSnapshotInput = Omit<
  ExecutionSourceSnapshot,
  "organisationId" | "sourceScope" | "sourceSystemId" | "providerCode"
>;

export interface MachineRecordExecutionSnapshotCommand {
  readonly acquisitionRunId: AcquisitionRunId;
  readonly snapshot: MachineExecutionSnapshotInput;
}

/** Exact-key lookup only: no list, prefix, pattern or enumeration. */
export interface MachineGovernedMappingQuery {
  readonly acquisitionRunId: AcquisitionRunId;
  readonly sourceExternalType: string;
  readonly sourceExternalId: string;
  readonly canonicalObjectKind: CanonicalObjectKind;
  readonly normalizedObjectIdentity: string;
}

export interface MachineIntakePort {
  openAcquisitionRun(
    command: MachineOpenAcquisitionRunCommand,
  ): Promise<MachineIntakeMutationResult<{ readonly provenance: RunBindingProvenance }>>;
  completeAcquisitionRun(
    command: MachineCompleteAcquisitionRunCommand,
  ): Promise<MachineIntakeMutationResult<{ readonly acquisitionRunId: AcquisitionRunId }>>;
  admitObservation(
    command: MachineAdmitObservationCommand,
  ): Promise<MachineIntakeMutationResult<{ readonly assertionId: SourceAssertion["assertionId"] }>>;
  admitFinding(
    command: MachineAdmitFindingCommand,
  ): Promise<MachineIntakeMutationResult<{ readonly findingId: DiscoveryFindingId }>>;
  admitLineageObservation(
    command: MachineAdmitLineageObservationCommand,
  ): Promise<MachineIntakeMutationResult<{
    readonly finding: RelationshipDiscoveryFinding;
    readonly candidate: NormalizedRelationshipCandidate;
  }>>;
  createDetectedSubject(
    command: MachineRunFindingSelector,
  ): Promise<MachineIntakeMutationResult<{ readonly reviewSubjectId: ReviewSubjectId; readonly currentState: ReviewState }>>;
  recordTechnicalProfileProposal(
    command: MachineRecordTechnicalProfileProposalCommand,
  ): Promise<MachineIntakeMutationResult<{ readonly proposalId: string }>>;
  recordExecutionSnapshot(
    command: MachineRecordExecutionSnapshotCommand,
  ): Promise<MachineIntakeMutationResult<{ readonly snapshotId: string }>>;
  getNormalizedCandidate(
    query: MachineRunFindingSelector,
  ): Promise<MachineReadResult<{ readonly candidate?: NormalizedCandidate }>>;
  /** Boolean only; nonexistent and out-of-scope mappings are indistinguishable. */
  isAlreadyGoverned(query: MachineGovernedMappingQuery): Promise<MachineReadResult<{ readonly governed: boolean }>>;
}

// ---------------------------------------------------------------------------
// PROPOSE
// ---------------------------------------------------------------------------

/**
 * The complete machine PROPOSE command. Actor (DETERMINISTIC_RULE), rule
 * (PASS_THROUGH_V1 / 1.0), transition (DETECTED -> PROPOSED), organisation,
 * subject, command/event identity and support are fixed or derived by the DB.
 */
export interface MachineProposeCommand {
  readonly acquisitionRunId: AcquisitionRunId;
  readonly findingId: DiscoveryFindingId;
}

export type MachineProposeResult =
  | MachineCommandResult<{
      readonly reviewSubjectId: ReviewSubjectId;
      readonly eventId: ReviewTransitionId;
      /** Current state; a replay never regresses a HUMAN-advanced subject. */
      readonly currentState: ReviewState;
    }>
  | { readonly outcome: typeof MACHINE_COMMAND_OUTCOME.STATE_CONFLICT; readonly currentState: ReviewState };

export interface MachineProposePort {
  proposeDiscoveryFinding(command: MachineProposeCommand): Promise<MachineProposeResult>;
}

// ---------------------------------------------------------------------------
// Top-level exact-key parsers; nested envelopes are shape-checked — defence in depth only. They never authorize: the
// database re-establishes all authority on every command.
// ---------------------------------------------------------------------------

export class MachineCommandParseError extends TypeError {
  readonly code = MACHINE_DENIAL_CODE.MALFORMED_COMMAND;

  constructor(detail: string) {
    super(`Malformed machine command: ${detail}`);
    this.name = "MachineCommandParseError";
  }
}

const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f-\u009f]/;

function exactRecord(
  input: unknown,
  required: readonly string[],
  optional: readonly string[] = [],
): Record<string, unknown> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new MachineCommandParseError("command must be a plain object");
  }
  const prototype = Object.getPrototypeOf(input);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new MachineCommandParseError("command must be a plain object");
  }
  if (Object.getOwnPropertySymbols(input).length > 0) {
    throw new MachineCommandParseError("symbol keys are not permitted");
  }
  const allowed = new Set([...required, ...optional]);
  const record = input as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) throw new MachineCommandParseError("unknown key");
  }
  for (const key of required) {
    if (!Object.hasOwn(record, key) || record[key] === undefined) {
      throw new MachineCommandParseError(`missing key "${key}"`);
    }
  }
  return record;
}

function plainText(value: unknown, key: string): string {
  if (typeof value !== "string" || value.length === 0 || value.trim() !== value || CONTROL_CHARACTER_PATTERN.test(value)) {
    throw new MachineCommandParseError(`"${key}" must be a non-empty string without surrounding whitespace or control characters`);
  }
  return value;
}

function acquisitionRunId(value: unknown): AcquisitionRunId {
  if (typeof value !== "string" || !ACQUISITION_RUN_ID_PATTERN.test(value)) {
    throw new MachineCommandParseError('"acquisitionRunId" has an unsupported shape');
  }
  return value as AcquisitionRunId;
}

function discoveryFindingId(value: unknown): DiscoveryFindingId {
  if (typeof value !== "string" || !DISCOVERY_FINDING_ID_PATTERN.test(value)) {
    throw new MachineCommandParseError('"findingId" has an unsupported shape');
  }
  return value as DiscoveryFindingId;
}

function envelope<T>(value: unknown, key: string): T {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new MachineCommandParseError(`"${key}" must be an object`);
  }
  return value as T;
}

/**
 * Machine intake cannot select a review outcome. Other nested canonical
 * semantics, source, tenant and content checks remain the DB's S3 responsibility.
 */
function machineFinding<T extends DiscoveryFinding>(value: unknown): T {
  const finding = envelope<Record<string, unknown>>(value, "finding");
  if (finding.reviewStatus !== "UNREVIEWED") {
    throw new MachineCommandParseError('"finding.reviewStatus" must be UNREVIEWED');
  }
  if (finding.requiresReview !== true) {
    throw new MachineCommandParseError('"finding.requiresReview" must be true');
  }
  if (finding.createsCanonicalObject !== false) {
    throw new MachineCommandParseError('"finding.createsCanonicalObject" must be false');
  }
  return finding as unknown as T;
}

function optionalText(record: Record<string, unknown>, key: string): { readonly [k: string]: string } {
  return record[key] === undefined ? {} : { [key]: plainText(record[key], key) };
}

export function parseMachineProposeCommand(input: unknown): MachineProposeCommand {
  const record = exactRecord(input, ["acquisitionRunId", "findingId"]);
  return Object.freeze({
    acquisitionRunId: acquisitionRunId(record.acquisitionRunId),
    findingId: discoveryFindingId(record.findingId),
  });
}

export function parseMachineRunFindingSelector(input: unknown): MachineRunFindingSelector {
  const record = exactRecord(input, ["acquisitionRunId", "findingId"]);
  return Object.freeze({
    acquisitionRunId: acquisitionRunId(record.acquisitionRunId),
    findingId: discoveryFindingId(record.findingId),
  });
}

export function parseMachineOpenAcquisitionRunCommand(input: unknown): MachineOpenAcquisitionRunCommand {
  const record = exactRecord(
    input,
    ["bindingId", "configuredLocator", "authorizedRef", "adapterName", "adapterVersion", "startedAt"],
    ["providerSourceId", "resolvedSourceVersion"],
  );
  let bindingId: ExecutionBindingId;
  try {
    bindingId = asExecutionBindingId(record.bindingId as string);
  } catch {
    throw new MachineCommandParseError('"bindingId" has an unsupported shape');
  }
  return Object.freeze({
    bindingId,
    configuredLocator: plainText(record.configuredLocator, "configuredLocator"),
    authorizedRef: plainText(record.authorizedRef, "authorizedRef"),
    adapterName: plainText(record.adapterName, "adapterName"),
    adapterVersion: plainText(record.adapterVersion, "adapterVersion"),
    startedAt: plainText(record.startedAt, "startedAt") as IsoTimestamp,
    ...optionalText(record, "providerSourceId"),
    ...optionalText(record, "resolvedSourceVersion"),
  });
}

const TERMINAL_STATUSES: ReadonlySet<string> = new Set(["SUCCEEDED", "PARTIAL", "FAILED"]);

export function parseMachineCompleteAcquisitionRunCommand(input: unknown): MachineCompleteAcquisitionRunCommand {
  const record = exactRecord(input, ["acquisitionRunId", "status", "counts", "completedAt"], ["failureCode"]);
  if (typeof record.status !== "string" || !TERMINAL_STATUSES.has(record.status)) {
    throw new MachineCommandParseError('"status" must be SUCCEEDED, PARTIAL or FAILED');
  }
  if (Object.hasOwn(record, "failureCode") && (record.status !== "FAILED" ||
      typeof record.failureCode !== "string" ||
      !["PROVIDER_REDIRECT", "PROVIDER_IDENTITY_MISMATCH", "ACQUISITION_FAILED"].includes(record.failureCode))) {
    throw new MachineCommandParseError('"failureCode" requires FAILED and a supported failure code');
  }
  return Object.freeze({
    acquisitionRunId: acquisitionRunId(record.acquisitionRunId),
    status: record.status as MachineAcquisitionTerminalStatus,
    counts: envelope<AcquisitionRunCounts>(record.counts, "counts"),
    completedAt: plainText(record.completedAt, "completedAt") as IsoTimestamp,
    ...(Object.hasOwn(record, "failureCode") ? { failureCode: record.failureCode as MachineAcquisitionFailureCode } : {}),
  }) as MachineCompleteAcquisitionRunCommand;
}

export function parseMachineAdmitObservationCommand(input: unknown): MachineAdmitObservationCommand {
  const record = exactRecord(input, ["acquisitionRunId", "evidence", "assertion"]);
  if (!Array.isArray(record.evidence) || record.evidence.length === 0) {
    throw new MachineCommandParseError('"evidence" must be a non-empty array');
  }
  return Object.freeze({
    acquisitionRunId: acquisitionRunId(record.acquisitionRunId),
    evidence: Object.freeze(record.evidence.map((item, index) => envelope<Evidence>(item, `evidence[${index}]`))),
    assertion: envelope<SourceAssertion>(record.assertion, "assertion"),
  });
}

export function parseMachineAdmitFindingCommand(input: unknown): MachineAdmitFindingCommand {
  const record = exactRecord(input, ["acquisitionRunId", "finding"], ["candidate"]);
  return Object.freeze({
    acquisitionRunId: acquisitionRunId(record.acquisitionRunId),
    finding: machineFinding<DiscoveryFinding<DiscoveryCandidateKind>>(record.finding),
    ...(record.candidate === undefined ? {} : { candidate: envelope<NormalizedCandidate>(record.candidate, "candidate") }),
  });
}

export function parseMachineAdmitLineageObservationCommand(input: unknown): MachineAdmitLineageObservationCommand {
  const record = exactRecord(input, ["acquisitionRunId", "finding", "candidate"]);
  return Object.freeze({
    acquisitionRunId: acquisitionRunId(record.acquisitionRunId),
    finding: machineFinding<RelationshipDiscoveryFinding>(record.finding),
    candidate: envelope<NormalizedRelationshipCandidate>(record.candidate, "candidate"),
  });
}

export function parseMachineRecordTechnicalProfileProposalCommand(
  input: unknown,
): MachineRecordTechnicalProfileProposalCommand {
  const record = exactRecord(input, ["acquisitionRunId", "proposal"]);
  const proposal = envelope<Record<string, unknown>>(record.proposal, "proposal");
  if (Object.hasOwn(proposal, "organisationId")) {
    throw new MachineCommandParseError('"proposal.organisationId" is derived by the database');
  }
  return Object.freeze({
    acquisitionRunId: acquisitionRunId(record.acquisitionRunId),
    proposal: proposal as unknown as MachineRecordTechnicalProfileProposalCommand["proposal"],
  });
}

const SNAPSHOT_DERIVED_KEYS = ["organisationId", "sourceScope", "sourceSystemId", "providerCode"] as const;

export function parseMachineRecordExecutionSnapshotCommand(input: unknown): MachineRecordExecutionSnapshotCommand {
  const record = exactRecord(input, ["acquisitionRunId", "snapshot"]);
  const snapshot = envelope<Record<string, unknown>>(record.snapshot, "snapshot");
  for (const key of SNAPSHOT_DERIVED_KEYS) {
    if (Object.hasOwn(snapshot, key)) {
      throw new MachineCommandParseError(`"snapshot.${key}" is derived by the database`);
    }
  }
  if (snapshot.authorizationState !== "UNKNOWN") {
    throw new MachineCommandParseError('"snapshot.authorizationState" must be UNKNOWN');
  }
  return Object.freeze({
    acquisitionRunId: acquisitionRunId(record.acquisitionRunId),
    snapshot: snapshot as unknown as MachineExecutionSnapshotInput,
  });
}

export function parseMachineGovernedMappingQuery(input: unknown): MachineGovernedMappingQuery {
  const record = exactRecord(input, [
    "acquisitionRunId",
    "sourceExternalType",
    "sourceExternalId",
    "canonicalObjectKind",
    "normalizedObjectIdentity",
  ]);
  return Object.freeze({
    acquisitionRunId: acquisitionRunId(record.acquisitionRunId),
    sourceExternalType: plainText(record.sourceExternalType, "sourceExternalType"),
    sourceExternalId: plainText(record.sourceExternalId, "sourceExternalId"),
    canonicalObjectKind: plainText(record.canonicalObjectKind, "canonicalObjectKind") as CanonicalObjectKind,
    normalizedObjectIdentity: plainText(record.normalizedObjectIdentity, "normalizedObjectIdentity"),
  });
}
