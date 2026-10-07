import { Pool } from 'pg';
import { openSync, writeSync, fsyncSync, closeSync } from 'node:fs';
import { checkServerIdentity } from 'node:tls';
import {
  asAcquisitionRunId, asOrganisationId, asSourceConnectionId,
  type Evidence,
} from '@council/canonical-contracts';
import {
  asExecutionBindingId, asBindingRevision, asCredentialGenerationId,
  parseMachineProposeCommand, type MachineProposeResult,
} from '@council/governance-review';
import { MachineAuthorityError, type DiscoveryIntakePorts } from './discovery-intake.ts';

export interface MachineExecutorConfiguration {
  readonly host: string; readonly port: number; readonly database: string;
  readonly user: string; readonly password: string; readonly ca: string;
  readonly bindingId: string; readonly authorizedRef: string;
  readonly auditPath: string; readonly maxConnections?: number;
}

/** Dedicated generation pool, closed SQL surface. Never accepts connectionString,
 * caller TLS options, role overrides, SQL text, HUMAN or service credentials. */
export function createMachineExecutor(config: MachineExecutorConfiguration) {
  asExecutionBindingId(config.bindingId);
  if (!config.host || !config.database || !config.user || !config.password || !config.ca || !config.auditPath
    || !Number.isSafeInteger(config.port) || config.port < 1 || config.port > 65535
    || !Number.isSafeInteger(config.maxConnections ?? 2) || (config.maxConnections ?? 2) < 1
    || (config.maxConnections ?? 2) > 4
    || /^(postgres|m16_bootstrap|service_role|anon|authenticated|authenticator|govia_)/i.test(config.user)) {
    throw new MachineAuthorityError('MACHINE_CONFIGURATION_REJECTED');
  }
  const journal = openSync(config.auditPath, 'a', 0o600);
  let sequence = 0;
  function audit(command: string, phase: string, code?: string) {
    writeSync(journal, JSON.stringify({ at: new Date().toISOString(), sequence: ++sequence, command, phase,
      ...(code ? { code } : {}) }) + '\n');
    fsyncSync(journal);
  }
  const pool = new Pool({ host: config.host, port: config.port, database: config.database,
    user: config.user, password: config.password, max: config.maxConnections ?? 2,
    connectionTimeoutMillis: 10_000, idleTimeoutMillis: 10_000,
    statement_timeout: 30_000, application_name: 'govia-discovery-machine',
    ssl: { ca: config.ca, rejectUnauthorized: true,
      checkServerIdentity: (_hostname, certificate) => checkServerIdentity(config.host, certificate) },
  });
  pool.on('error', () => audit('POOL', 'TRANSPORT_FAILED'));
  // Static prepared text only. No machine caller can pick a function or supply SQL.
  const statements = {
    open: 'select gov_repo.discovery_machine_open_run_v1($1,$2,$3,$4,$5,$6,$7,$8) as result',
    complete: 'select gov_repo.discovery_machine_complete_run_v1($1,$2,$3,$4,$5) as result',
    observation: 'select gov_repo.discovery_machine_admit_observation_v1($1,$2,$3) as result',
    finding: 'select gov_repo.discovery_machine_admit_finding_v1($1,$2,$3) as result',
    lineage: 'select gov_repo.discovery_machine_admit_lineage_v1($1,$2,$3) as result',
    subject: 'select gov_repo.discovery_machine_create_subject_v1($1,$2) as result',
    profile: 'select gov_repo.discovery_machine_record_technical_profile_v1($1,$2) as result',
    snapshot: 'select gov_repo.discovery_machine_record_execution_snapshot_v1($1,$2) as result',
    candidate: 'select gov_repo.discovery_machine_get_candidate_v1($1,$2) as result',
    mapping: 'select gov_repo.discovery_machine_is_governed_v1($1,$2,$3,$4,$5) as result',
    propose: 'select gov_repo.propose_discovery_finding_v1($1,$2) as result',
  } as const;
  async function invoke(command: keyof typeof statements, values: unknown[]) {
    audit(command, 'ATTEMPT'); // Durable even if authentication/SQL/commit fails.
    try {
      const { rows } = await pool.query(statements[command], values);
      const result = rows[0]?.result;
      if (!result || !['APPLIED','REPLAYED','READ','DENIED','CONTENT_CONFLICT','STATE_CONFLICT'].includes(result.outcome))
        throw new MachineAuthorityError('MACHINE_INVALID_RESPONSE');
      audit(command, result.outcome);
      if (command === 'propose' && result.outcome === 'STATE_CONFLICT') {
        if (!['PROPOSED','CONFIRMED','CERTIFIED','REJECTED'].includes(result.currentState))
          throw new MachineAuthorityError('MACHINE_INVALID_RESPONSE');
        return result; // Audited item outcome; current HUMAN state is authoritative.
      }
      if (!['APPLIED','REPLAYED','READ'].includes(result.outcome)) throw new MachineAuthorityError(`MACHINE_${result.outcome}`);
      return result;
    } catch (error) {
      const sqlstate = typeof (error as { code?: unknown }).code === 'string' ? (error as { code: string }).code : '';
      audit(command, 'FAILED_OR_COMMIT_UNKNOWN', /^[0-9A-Z]{5}$/.test(sqlstate) ? sqlstate : undefined);
      // Neither credentials, SQL, provider payloads nor raw server messages leave this boundary.
      throw new MachineAuthorityError(error instanceof MachineAuthorityError ? error.message : 'MACHINE_DATABASE_FAILED');
    }
  }
  let admittedRun: string | undefined;
  let organisation: string | undefined;
  const evidence = new Map<string, Evidence>();
  const runId = () => {
    if (!admittedRun) throw new MachineAuthorityError('MACHINE_RUN_REQUIRED');
    return admittedRun;
  };
  const scope = (org: string) => {
    if (org !== organisation) throw new MachineAuthorityError('MACHINE_TENANT_MISMATCH');
  };
  const json = (value: unknown) => JSON.stringify(value);
  const ports: DiscoveryIntakePorts = {
    machine: {
      async openRun(run, adapter) {
        if (admittedRun) throw new MachineAuthorityError('MACHINE_EXECUTOR_ALREADY_USED');
        const identity = await adapter.resolveProviderSourceIdentity?.();
        if (adapter.describeSource().providerCode !== 'github' || !identity?.providerSourceId)
          throw new MachineAuthorityError('MACHINE_PIN_REQUIRED');
        const result = await invoke('open', [config.bindingId, adapter.describeSource().displayName, config.authorizedRef,
          adapter.adapterName, adapter.adapterVersion, identity.providerSourceId, run.sourceVersion ?? null, run.startedAt]);
        const p = result.provenance;
        // GitHub worker activation requires a pin, not merely an unpinned observation.
        if (p.provider_identity_state !== 'PINNED_MATCH') throw new MachineAuthorityError('MACHINE_PIN_REQUIRED');
        admittedRun = asAcquisitionRunId(p.run_id); organisation = asOrganisationId(p.organisation_id);
        return { acquisitionRunId: asAcquisitionRunId(p.run_id), organisationId: asOrganisationId(p.organisation_id),
          bindingId: asExecutionBindingId(p.binding_id), bindingRevision: asBindingRevision(Number(p.binding_revision)),
          sourceConnectionId: asSourceConnectionId(p.source_connection_id), providerCode: p.provider,
          configuredLocator: p.configured_locator, normalizedLocator: p.normalized_locator, authorizedRef: p.authorized_ref,
          providerSourceId: p.provider_source_id_observed, adapterName: p.adapter_name, adapterVersion: p.adapter_version,
          resolvedSourceVersion: p.resolved_source_version,
          admissionCredentialGenerationId: asCredentialGenerationId(p.admission_generation_id) };
      },
      async admitFinding(command) {
        if (command.acquisitionRunId !== runId()) throw new MachineAuthorityError('MACHINE_RUN_MISMATCH');
        return invoke('finding', [runId(), json(command.finding), command.candidate ? json(command.candidate) : null]);
      },
      async createDetectedSubject(command) {
        if (command.acquisitionRunId !== runId()) throw new MachineAuthorityError('MACHINE_RUN_MISMATCH');
        return invoke('subject', [runId(), command.findingId]);
      },
      async proposeDiscoveryFinding(input): Promise<MachineProposeResult> {
        const command = parseMachineProposeCommand(input);
        if (command.acquisitionRunId !== runId()) throw new MachineAuthorityError('MACHINE_RUN_MISMATCH');
        return invoke('propose', [runId(), command.findingId]);
      },
      async isAlreadyGoverned(input) {
        scope(input.organisationId);
        return (await invoke('mapping', [runId(), input.sourceExternalType, input.sourceExternalId,
          input.canonicalObjectKind, input.normalizedObjectIdentity])).isGoverned === true;
      },
    },
    intake: {
      async startAcquisitionRun() { throw new MachineAuthorityError('MACHINE_OPEN_REQUIRED'); },
      async completeAcquisitionRun(org, run, counts) {
        scope(org);
        const status = counts.itemFailures ? 'PARTIAL' : run.status === 'FAILED' ? 'FAILED' : 'SUCCEEDED';
        const result = await invoke('complete', [runId(), status, json(counts), run.completedAt ?? new Date().toISOString(), null]);
        return { replay: result.outcome === 'REPLAYED', runId: asAcquisitionRunId(runId()), status: run.status };
      },
      async recordEvidence(org, value) {
        scope(org); evidence.set(value.evidenceId, value);
        // Admission is atomic with its assertion; nothing references this buffer as durable.
        return { replay: false, evidenceId: value.evidenceId };
      },
      async recordSourceAssertion(org, assertion) {
        scope(org);
        const support = assertion.evidenceIds.map(id => {
          const value = evidence.get(id);
          if (!value) throw new MachineAuthorityError('MACHINE_EVIDENCE_REQUIRED');
          return value;
        });
        const result = await invoke('observation', [runId(), json(support), json({ ...assertion, runId: runId() })]);
        return { replay: result.outcome === 'REPLAYED', assertionId: assertion.assertionId };
      },
      async getNormalizedCandidateForFinding(org, findingId) {
        scope(org); return (await invoke('candidate', [runId(), findingId])).candidate ?? undefined;
      },
      async recordLineageObservation(org, finding, candidate) {
        scope(org); const result = await invoke('lineage', [runId(), json(finding), json(candidate)]);
        return { finding: result.finding, candidate: result.candidate };
      },
    },
    agentVersionTechnicalProfile: {
      async recordAgentVersionTechnicalProfileProposal({ organisationId, ...proposal }) {
        scope(organisationId); const result = await invoke('profile', [runId(), json(proposal)]);
        return { replay: result.outcome === 'REPLAYED', proposalId: result.proposalId };
      },
    },
    executionContext: {
      async recordSnapshot({ organisationId, sourceScope, sourceSystemId, providerCode, ...snapshot }) {
        scope(organisationId); await invoke('snapshot', [runId(), json(snapshot)]);
      },
    },
  };
  return { ports, async close() { await pool.end(); fsyncSync(journal); closeSync(journal); } };
}
