import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MACHINE_COMMAND_OUTCOME, MACHINE_READ_OUTCOME, parseMachineCompleteAcquisitionRunCommand,
  MachineCommandParseError, type MachineCompleteAcquisitionRunCommand, type MachineIntakePort,
  type MachineCommandOutcome, type MachineReadOutcome } from '../src/discovery-machine/index.ts';

const base = {acquisitionRunId:'acquisition-run:00000000-0000-4000-8000-000000000001',
  completedAt:'2026-10-03T00:00:00.000Z',counts:{artifactsScanned:0,findingsDetected:0,objectCandidates:0,
    relationshipCandidates:0,reviewSubjectsCreated:0,proposalsCreated:0,alreadyGoverned:0,itemFailures:0}};
test('S3 failure code is optional only for FAILED, exact, and never silently normalized',()=>{
  for (const status of ['SUCCEEDED','PARTIAL','FAILED']) assert.equal(parseMachineCompleteAcquisitionRunCommand({...base,status}).status,status);
  for (const failureCode of ['PROVIDER_REDIRECT','PROVIDER_IDENTITY_MISMATCH','ACQUISITION_FAILED']) {
    assert.equal(parseMachineCompleteAcquisitionRunCommand({...base,status:'FAILED',failureCode}).failureCode,failureCode);
    for (const status of ['SUCCEEDED','PARTIAL']) assert.throws(()=>parseMachineCompleteAcquisitionRunCommand({...base,status,failureCode}),MachineCommandParseError);
  }
  for (const failureCode of [undefined,null,'','OTHER','provider_redirect',false,[],{}]) {
    assert.throws(()=>parseMachineCompleteAcquisitionRunCommand({...base,status:'FAILED',failureCode}),MachineCommandParseError);
  }
});
test('S3 read outcomes stay separate from mutation outcomes',()=>{
  assert.deepEqual(Object.values(MACHINE_COMMAND_OUTCOME),['APPLIED','REPLAYED','DENIED','CONTENT_CONFLICT','STATE_CONFLICT']);
  assert.deepEqual(Object.values(MACHINE_READ_OUTCOME),['READ','DENIED']);
});
type Equal<A,B> = (<T>()=>T extends A ? 1:2) extends (<T>()=>T extends B ? 1:2) ? true:false;
export const readClosed: Equal<MachineReadOutcome,'READ'|'DENIED'> = true;
export const mutationsExcludeRead: Equal<Extract<MachineCommandOutcome,'READ'>,never> = true;
type IntakeWrites = Exclude<keyof MachineIntakePort,'getNormalizedCandidate'|'isAlreadyGoverned'>;
export const intakeConflict: { [K in IntakeWrites]: Extract<Awaited<ReturnType<MachineIntakePort[K]>>,{outcome:'STATE_CONFLICT'}> } = {
  openAcquisitionRun:{outcome:'STATE_CONFLICT'},completeAcquisitionRun:{outcome:'STATE_CONFLICT'},admitObservation:{outcome:'STATE_CONFLICT'},
  admitFinding:{outcome:'STATE_CONFLICT'},admitLineageObservation:{outcome:'STATE_CONFLICT'},createDetectedSubject:{outcome:'STATE_CONFLICT'},
  recordTechnicalProfileProposal:{outcome:'STATE_CONFLICT'},recordExecutionSnapshot:{outcome:'STATE_CONFLICT'},
};
// @ts-expect-error a successful completion cannot carry a failure code
export const invalid: MachineCompleteAcquisitionRunCommand = {...base,status:'SUCCEEDED',failureCode:'ACQUISITION_FAILED'};
