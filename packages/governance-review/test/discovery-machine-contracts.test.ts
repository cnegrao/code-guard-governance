import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { AcquisitionRunId, DiscoveryFindingId } from "@council/canonical-contracts";

import {
  MACHINE_CAPABILITY,
  MACHINE_COMMAND_OUTCOME,
  MACHINE_DENIAL_CODE,
  MACHINE_PROPOSAL_RULE,
  MachineCommandParseError,
  PassThroughSemanticProposalStrategy,
  asBindingRevision,
  asExecutionBindingId,
  asMachinePrincipalId,
  parseMachineAdmitFindingCommand,
  parseMachineAdmitLineageObservationCommand,
  parseMachineAdmitObservationCommand,
  parseMachineCompleteAcquisitionRunCommand,
  parseMachineGovernedMappingQuery,
  parseMachineOpenAcquisitionRunCommand,
  parseMachineProposeCommand,
  parseMachineRecordExecutionSnapshotCommand,
  parseMachineRecordTechnicalProfileProposalCommand,
  parseMachineRunFindingSelector,
  type DiscoveryIntakePersistencePort,
  type GovernanceReviewPersistencePort,
  type MachineAdmitFindingCommand,
  type MachineAdmitLineageObservationCommand,
  type MachineAdmitObservationCommand,
  type MachineCompleteAcquisitionRunCommand,
  type MachineGovernedMappingQuery,
  type MachineIntakePort,
  type MachineOpenAcquisitionRunCommand,
  type MachineProposeCommand,
  type MachineProposePort,
  type MachineRecordExecutionSnapshotCommand,
  type MachineRecordTechnicalProfileProposalCommand,
  type MachineRunFindingSelector,
} from "../src/index.ts";

const RUN_ID = "acquisition-run:3f0c2a8e-6b1d-4c2e-9a77-1d2e3f4a5b6c";
const FINDING_ID = "discovery-finding:0123456789abcdef0123456789abcdef";
const BINDING_ID = "0b6f2d1e-8c4a-4f3b-9e2d-7a6b5c4d3e2f";

const isMalformed = (error: unknown) =>
  error instanceof MachineCommandParseError && error.code === MACHINE_DENIAL_CODE.MALFORMED_COMMAND;

// ---------------------------------------------------------------------------
// Compile-time restrictions (enforced by `npm run typecheck`).
// ---------------------------------------------------------------------------

type Equals<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;

type AllMachineCommandKeys =
  | keyof MachineProposeCommand
  | keyof MachineOpenAcquisitionRunCommand
  | keyof MachineCompleteAcquisitionRunCommand
  | keyof MachineAdmitObservationCommand
  | keyof MachineAdmitFindingCommand
  | keyof MachineAdmitLineageObservationCommand
  | keyof MachineRunFindingSelector
  | keyof MachineRecordTechnicalProfileProposalCommand
  | keyof MachineRecordExecutionSnapshotCommand
  | keyof MachineGovernedMappingQuery;

type AuthoritySelectors =
  | "actor"
  | "actorKind"
  | "newState"
  | "previousState"
  | "expectedState"
  | "rule"
  | "ruleCode"
  | "ruleVersion"
  | "role"
  | "organisationId"
  | "reviewSubjectId"
  | "commandId"
  | "eventId"
  | "principalId"
  | "capability"
  | "sql";

export const proposeCommandIsExactlyRunAndFinding: Equals<keyof MachineProposeCommand, "acquisitionRunId" | "findingId"> = true;
export const proposePortHasOneCommand: Equals<keyof MachineProposePort, "proposeDiscoveryFinding"> = true;
export const intakePortSurfaceIsClosed: Equals<
  keyof MachineIntakePort,
  | "openAcquisitionRun"
  | "completeAcquisitionRun"
  | "admitObservation"
  | "admitFinding"
  | "admitLineageObservation"
  | "createDetectedSubject"
  | "recordTechnicalProfileProposal"
  | "recordExecutionSnapshot"
  | "getNormalizedCandidate"
  | "isAlreadyGoverned"
> = true;
export const noCommandCarriesAnAuthoritySelector: Equals<Extract<AllMachineCommandKeys, AuthoritySelectors>, never> = true;
export const snapshotScopeIsNotCallerSupplied: Equals<
  Extract<keyof MachineRecordExecutionSnapshotCommand["snapshot"], "sourceScope" | "organisationId" | "sourceSystemId" | "providerCode">,
  never
> = true;
export const technicalProposalHasNoTenantSelector: Equals<
  Extract<keyof MachineRecordTechnicalProfileProposalCommand["proposal"], "organisationId">,
  never
> = true;

export const intakeIsNotLegacyPort: MachineIntakePort extends DiscoveryIntakePersistencePort ? false : true = true;
export const proposeIsNotReviewPort: MachineProposePort extends GovernanceReviewPersistencePort ? false : true = true;
export const legacyIntakeIsNotMachinePort: DiscoveryIntakePersistencePort extends MachineIntakePort ? false : true = true;

const runId = RUN_ID as AcquisitionRunId;
const findingId = FINDING_ID as DiscoveryFindingId;
export const validPropose: MachineProposeCommand = { acquisitionRunId: runId, findingId };
// @ts-expect-error actor is fixed by the database
export const proposeWithActor: MachineProposeCommand = { acquisitionRunId: runId, findingId, actor: "DETERMINISTIC_RULE" };
// @ts-expect-error destination state is fixed
export const proposeWithNewState: MachineProposeCommand = { acquisitionRunId: runId, findingId, newState: "CERTIFIED" };
// @ts-expect-error previous state is loaded under lock
export const proposeWithPreviousState: MachineProposeCommand = { acquisitionRunId: runId, findingId, previousState: "DETECTED" };
// @ts-expect-error rule is fixed
export const proposeWithRule: MachineProposeCommand = { acquisitionRunId: runId, findingId, rule: "PASS_THROUGH_V1" };
// @ts-expect-error no role selector
export const proposeWithRole: MachineProposeCommand = { acquisitionRunId: runId, findingId, role: "ADMIN" };
// @ts-expect-error organisation comes from the execution binding
export const proposeWithOrganisation: MachineProposeCommand = { acquisitionRunId: runId, findingId, organisationId: "org" };
// @ts-expect-error subject is derived
export const proposeWithSubject: MachineProposeCommand = { acquisitionRunId: runId, findingId, reviewSubjectId: "rs" };

// ---------------------------------------------------------------------------
// Runtime contract tests (defence in depth; the DB remains the authority).
// ---------------------------------------------------------------------------

describe("discovery machine contracts", () => {
  it("fixes the proposal rule to the existing PASS_THROUGH_V1 / 1.0 strategy", () => {
    assert.deepEqual({ ...MACHINE_PROPOSAL_RULE }, { code: "PASS_THROUGH_V1", version: "1.0" });
    assert.ok(Object.isFrozen(MACHINE_PROPOSAL_RULE));
    assert.equal(new PassThroughSemanticProposalStrategy().strategyCode, MACHINE_PROPOSAL_RULE.code);
  });

  it("has exactly two closed capabilities and closed outcomes", () => {
    assert.deepEqual(Object.values(MACHINE_CAPABILITY).sort(), ["DISCOVERY_INTAKE", "DISCOVERY_PROPOSE"]);
    assert.deepEqual(Object.values(MACHINE_COMMAND_OUTCOME).sort(),
      ["APPLIED", "CONTENT_CONFLICT", "DENIED", "REPLAYED", "STATE_CONFLICT"]);
    assert.ok(Object.values(MACHINE_DENIAL_CODE).includes("SCOPE_MISMATCH"));
  });

  it("constrains DB-generated identifiers and revisions", () => {
    assert.equal(asExecutionBindingId(BINDING_ID), BINDING_ID);
    assert.equal(asBindingRevision(1), 1);
    for (const bad of ["", BINDING_ID.toUpperCase(), `${BINDING_ID} `, "binding-1"]) {
      assert.throws(() => asExecutionBindingId(bad), TypeError);
      assert.throws(() => asMachinePrincipalId(bad), TypeError);
    }
    for (const bad of [0, -1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1]) {
      assert.throws(() => asBindingRevision(bad), TypeError);
    }
  });

  it("PROPOSE accepts exactly acquisitionRunId + findingId", () => {
    const parsed = parseMachineProposeCommand({ acquisitionRunId: RUN_ID, findingId: FINDING_ID });
    assert.deepEqual(Object.keys(parsed).sort(), ["acquisitionRunId", "findingId"]);
    assert.ok(Object.isFrozen(parsed));
  });

  it("PROPOSE rejects every authority-bearing or unknown field", () => {
    const base = { acquisitionRunId: RUN_ID, findingId: FINDING_ID };
    for (const key of [
      "actor", "newState", "previousState", "rule", "ruleVersion", "role", "organisationId",
      "reviewSubjectId", "commandId", "eventId", "bindingId", "payload", "sql",
    ]) {
      assert.throws(() => parseMachineProposeCommand({ ...base, [key]: "x" }), isMalformed, key);
    }
    assert.throws(() => parseMachineProposeCommand(JSON.parse(`{"acquisitionRunId":"${RUN_ID}","findingId":"${FINDING_ID}","__proto__":{"actor":"HUMAN"}}`)), isMalformed);
    assert.throws(() => parseMachineProposeCommand({ ...base, [Symbol("actor")]: "x" }), isMalformed);
  });

  it("PROPOSE rejects malformed shapes", () => {
    const inherited = Object.create({ acquisitionRunId: RUN_ID, findingId: FINDING_ID });
    for (const bad of [
      null, undefined, "x", 1, [], [RUN_ID, FINDING_ID], inherited, new (class Command {})(),
      {}, { acquisitionRunId: RUN_ID }, { findingId: FINDING_ID },
      { acquisitionRunId: RUN_ID, findingId: undefined },
      { acquisitionRunId: "run:github:fixture", findingId: FINDING_ID },
      { acquisitionRunId: RUN_ID, findingId: "finding:github:agent-candidate" },
      { acquisitionRunId: ` ${RUN_ID}`, findingId: FINDING_ID },
      { acquisitionRunId: RUN_ID, findingId: 42 },
    ]) {
      assert.throws(() => parseMachineProposeCommand(bad), isMalformed);
    }
  });

  it("intake parsers reject tenant, principal, capability and scope injection", () => {
    const open = {
      bindingId: BINDING_ID,
      configuredLocator: "Acme/Policy-Repo",
      authorizedRef: "main",
      adapterName: "github-source-adapter",
      adapterVersion: "1.0.0",
      startedAt: "2026-10-02T00:00:00.000Z",
    };
    assert.deepEqual(parseMachineOpenAcquisitionRunCommand(open), open);
    assert.equal(parseMachineOpenAcquisitionRunCommand({ ...open, providerSourceId: "1296269" }).providerSourceId, "1296269");
    for (const key of ["organisationId", "sourceConnectionId", "principalId", "capability", "bindingRevision", "normalizedLocator"]) {
      assert.throws(() => parseMachineOpenAcquisitionRunCommand({ ...open, [key]: "x" }), isMalformed, key);
    }
    assert.throws(() => parseMachineOpenAcquisitionRunCommand({ ...open, bindingId: "not-a-uuid" }), isMalformed);
    assert.throws(() => parseMachineOpenAcquisitionRunCommand({ ...open, authorizedRef: " main" }), isMalformed);

    const selector = { acquisitionRunId: RUN_ID, findingId: FINDING_ID };
    assert.deepEqual(parseMachineRunFindingSelector(selector), selector);
    assert.throws(() => parseMachineRunFindingSelector({ ...selector, initialState: "PROPOSED" }), isMalformed);

    const mapping = {
      acquisitionRunId: RUN_ID,
      sourceExternalType: "MODEL",
      sourceExternalId: "models/gpt",
      canonicalObjectKind: "MODEL",
      normalizedObjectIdentity: "model:gpt",
    };
    assert.deepEqual(parseMachineGovernedMappingQuery(mapping), mapping);
    for (const key of ["prefix", "pattern", "limit", "organisationId", "sourceConnectionId"]) {
      assert.throws(() => parseMachineGovernedMappingQuery({ ...mapping, [key]: "x" }), isMalformed, key);
    }
  });

  it("envelope parsers check the closed top-level shape and derived-field exclusion", () => {
    assert.throws(() => parseMachineCompleteAcquisitionRunCommand({
      acquisitionRunId: RUN_ID, status: "CANCELLED", counts: {}, completedAt: "2026-10-02T00:00:00.000Z",
    }), isMalformed);
    assert.throws(() => parseMachineAdmitObservationCommand({ acquisitionRunId: RUN_ID, evidence: [], assertion: {} }), isMalformed);
    assert.throws(() => parseMachineAdmitFindingCommand({ acquisitionRunId: RUN_ID, finding: {}, propose: true }), isMalformed);
    assert.throws(() => parseMachineRecordTechnicalProfileProposalCommand({
      acquisitionRunId: RUN_ID, proposal: { organisationId: "org" },
    }), isMalformed);
    for (const key of ["organisationId", "sourceScope", "sourceSystemId", "providerCode"]) {
      assert.throws(() => parseMachineRecordExecutionSnapshotCommand({
        acquisitionRunId: RUN_ID, snapshot: { authorizationState: "UNKNOWN", [key]: "x" },
      }), isMalformed, key);
    }
    assert.throws(() => parseMachineRecordExecutionSnapshotCommand({
      acquisitionRunId: RUN_ID, snapshot: { authorizationState: "AUTHORIZED" },
    }), isMalformed);
  });
});

describe("machine finding authority (M-1)", () => {
  const finding = {
    findingId: FINDING_ID,
    findingNature: "CANDIDATE",
    candidateKind: "RELATIONSHIP",
    sourceObject: { connectionId: "connection:fixture", externalType: "file", externalId: "load.sql" },
    assertionIds: ["assertion:fixture"],
    evidenceIds: ["evidence:fixture"],
    confidence: 1,
    reviewStatus: "UNREVIEWED",
    requiresReview: true,
    createsCanonicalObject: false,
    detectedAt: "2026-10-02T00:00:00.000Z",
  };
  const candidate = {
    candidateId: "candidate:relationship:fixture",
    candidateKind: "RELATIONSHIP",
    findingId: FINDING_ID,
    sourceObject: finding.sourceObject,
    relationshipTypeCode: "DERIVED_FROM",
    sourceEndpoint: { referenceKind: "CANDIDATE", candidateKind: "DATA_ELEMENT", candidateId: "element:target" },
    targetEndpoint: { referenceKind: "CANDIDATE", candidateKind: "DATA_ELEMENT", candidateId: "element:source" },
    assertionIds: finding.assertionIds,
    evidenceIds: finding.evidenceIds,
    confidence: 1,
    requiresReconciliation: true,
  };

  for (const [name, parse] of [
    ["admitFinding", parseMachineAdmitFindingCommand],
    ["admitLineageObservation", parseMachineAdmitLineageObservationCommand],
  ] as const) {
    it(name + " accepts UNREVIEWED / true / false without rewriting the finding", () => {
      const command = { acquisitionRunId: RUN_ID, finding, candidate };
      assert.deepEqual(parse(command), command);
      assert.strictEqual(parse(command).finding, finding);
      if (name === "admitFinding") {
        assert.deepEqual(parse({ acquisitionRunId: RUN_ID, finding }), { acquisitionRunId: RUN_ID, finding });
      }
    });

    for (const [key, value] of [
      ["reviewStatus", "ACCEPTED"],
      ["reviewStatus", "REJECTED"],
      ["reviewStatus", "DUPLICATE"],
      ["reviewStatus", "SUPERSEDED"],
      ["requiresReview", false],
      ["createsCanonicalObject", true],
    ] as const) {
      it(name + " rejects " + key + "=" + value + " without normalization", () => {
        const suppliedFinding = { ...finding, [key]: value };
        const before = { ...suppliedFinding };
        assert.throws(() => parse({ acquisitionRunId: RUN_ID, finding: suppliedFinding, candidate }), isMalformed);
        assert.deepEqual(suppliedFinding, before);
      });
    }

    it(name + " fails closed on missing or malformed authority fields", () => {
      for (const key of ["reviewStatus", "requiresReview", "createsCanonicalObject"] as const) {
        const missing: Record<string, unknown> = { ...finding };
        delete missing[key];
        assert.throws(() => parse({ acquisitionRunId: RUN_ID, finding: missing, candidate }), isMalformed, key);
        for (const value of [undefined, null, 0, 1, "", "true", "false", "unreviewed"]) {
          assert.throws(() => parse({
            acquisitionRunId: RUN_ID, finding: { ...finding, [key]: value }, candidate,
          }), isMalformed, key);
        }
      }
    });
  }

  it("does not echo an unknown caller-controlled top-level key (L-3)", () => {
    const key = "attacker-controlled-key";
    assert.throws(() => parseMachineAdmitFindingCommand({
      acquisitionRunId: RUN_ID, finding, [key]: true,
    }), (error: unknown) => isMalformed(error) && !(error as Error).message.includes(key));
  });
});
