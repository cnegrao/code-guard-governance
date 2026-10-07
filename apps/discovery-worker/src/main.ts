import { readFileSync } from 'node:fs';
import { asOrganisationId } from '@council/canonical-contracts';
import { createMachineExecutor } from './executor.ts';
import { runGovernanceDiscoveryScan } from './discovery-intake.ts';

// The standalone process accepts only its own workload configuration. Launch it
// in a separate secret scope/container; the dashboard must never launch it with
// its environment. This guard fails closed on known inherited authority secrets.
for (const key of Object.keys(process.env)) {
  if (/SUPABASE|SERVICE_ROLE|JWT|SESSION_SECRET|SIGNING|PROVISION|DATABASE_URL|^PG|NODE_OPTIONS|NODE_TLS_REJECT_UNAUTHORIZED/i.test(key))
    throw new Error('MACHINE_ENVIRONMENT_REJECTED');
}
function required(name: string) {
  const value = process.env[`DISCOVERY_${name}`];
  if (!value) throw new Error(`Missing DISCOVERY_${name}`);
  return value;
}
const executor = createMachineExecutor({ host: required('DB_HOST'), port: Number(required('DB_PORT')),
  database: required('DB_NAME'), user: required('DB_USER'), password: required('DB_PASSWORD'),
  ca: readFileSync(required('DB_CA_FILE'), 'utf8'), bindingId: required('BINDING_ID'),
  authorizedRef: required('REF'), auditPath: required('AUDIT_FILE') });
try {
  const result = await runGovernanceDiscoveryScan({
    // Ignored by machine composition: DB run admission supplies the actual tenant.
    executionContext: { organisationId: asOrganisationId('00000000-0000-0000-0000-000000000000') },
    sourceConfiguration: { kind: 'GITHUB_REPOSITORY', owner: required('OWNER'), repo: required('REPO'),
      ref: required('REF'), token: process.env.DISCOVERY_SOURCE_TOKEN },
  }, executor.ports);
  process.stdout.write(JSON.stringify(result) + '\n');
  if (result.status !== 'SUCCEEDED') process.exitCode = 1;
} catch {
  process.stderr.write('DISCOVERY_MACHINE_FAILED: inspect the operational journal and committed invocation audit\n');
  process.exitCode = 1;
} finally { await executor.close(); }
