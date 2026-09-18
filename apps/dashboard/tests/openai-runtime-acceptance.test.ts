import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';
import { getLLMProvider } from '../lib/llm';
import { generateGovernanceAnswer, type RuntimeObservationReport } from '../lib/runtime/openai-governance-answer-producer';
import { loadRuntimeProducerConfiguration } from '../lib/runtime/runtime-producer-config';

/** Real network + real unchanged privileged RPC. No mock, fixture provisioning,
 * migration, customer context, retry, public endpoint or default-on external call.
 */
test('M14.4 controlled REAL OpenAI -> hosted lab admission -> typed durable readback', {
  skip: process.env.RUN_M14_REAL_OPENAI_ACCEPTANCE !== '1' ? 'Explicit real-acceptance opt-in required' : false,
}, async t => {
  // Check credential availability without printing or reading its value into evidence.
  if (!process.env.OPENAI_API_KEY) throw new Error('REAL_OPENAI_ACCEPTANCE_BLOCKED_NO_CREDENTIAL');
  if (process.env.LLM_PROVIDER !== 'openai' || process.env.SUPABASE_URL !== 'https://zkqfvqwqdypgpzauzinw.supabase.co' ||
    !process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.M14_HOSTED_DB_TEST !== '1' ||
    process.env.M14_DATABASE_MODE !== 'supabase-hosted' || process.env.M14_HOSTED_PROJECT_REF !== 'zkqfvqwqdypgpzauzinw') {
    throw new Error('M14_REAL_ACCEPTANCE_ENVIRONMENT_REQUIRED');
  }
  const configuration = loadRuntimeProducerConfiguration(process.env.M14_REAL_OPENAI_ORGANISATION_ID ?? '');
  if (configuration.state !== 'ENABLED') throw new Error('M14_REAL_ACCEPTANCE_SOURCE_REQUIRED');
  const source = configuration.source;
  // Existing repository helper enforces the exact linked lab project before EACH
  // read. These are administrator READS only; application admission uses service_role.
  const { sql, literal, verifyDatabaseEnvironment } = await import('./helpers/runtime-database');
  let version: string;
  try {
    await verifyDatabaseEnvironment();
    if (await sql("select count(*) from supabase_migrations.schema_migrations where version='20260917192615';") !== '1') {
      throw new Error('M14_REAL_ACCEPTANCE_MIGRATION_MISSING');
    }
    version = await sql("select current_setting('server_version');");
    const configured = await sql(`select exists(
      select 1 from gov_repo.runtime_source_heads h
      join gov_repo.runtime_source_configurations c using(organisation_id,connection_id)
      where h.organisation_id=${literal(source.organisationId)}::uuid and h.connection_id=${literal(source.connectionId)}
      and h.active and h.current_configuration_version=c.configuration_version
      and c.configuration_version=${literal(source.sourceConfigurationVersion)} and c.family='RUNTIME'
      and c.source_system_id=${literal(source.sourceSystemId)} and c.provider_code=${literal(source.providerCode)}
      and c.producer_identity=${literal(source.producerIdentity)}
      and c.instrumentation_name=${literal(source.instrumentation.name)} and c.instrumentation_version='1.0.0'
      and c.sdk_name='opentelemetry' and c.sdk_version='2.0.1'
      and c.method_code='GOVIA_OTEL_SPAN' and c.method_version='1.0.0'
      and c.adapter_version='1.0.0' and c.schema_version='1.0.0' and c.mapping_version='1.0.0'
      and array['EXECUTION','MODEL_CALL']::gov_repo.runtime_kind[] <@ c.supported_kinds
      and array['END_TIME','PARENT','TARGET','OUTCOME','DURATION','ERROR','TOKENS','SAMPLING','DROPPED_COUNTS']::gov_repo.runtime_fact[] <@ c.supported_facts
      and 'gpt-4o-mini'=any(c.approved_model_references)
      and clock_timestamp()>=c.admission_from and clock_timestamp()<c.admission_until
      and c.max_payload_bytes>=16384
      and c.max_observations >= 2+(select count(*) from gov_repo.runtime_observations o
        where o.organisation_id=c.organisation_id and o.connection_id=c.connection_id)
    );`);
    if (configured !== 't') throw new Error('STOP_REMOTE_DB_AUTHORIZATION_REQUIRED');
  } catch (error) {
    throw new Error(error instanceof Error && error.message === 'STOP_REMOTE_DB_AUTHORIZATION_REQUIRED'
      ? 'STOP_REMOTE_DB_AUTHORIZATION_REQUIRED' : 'M14_REAL_ACCEPTANCE_READ_ONLY_PREFLIGHT_FAILED');
  }
  let report: RuntimeObservationReport | undefined;
  try {
    // Exactly one harmless invocation. Neither its inputs nor its answer are logged.
    await generateGovernanceAnswer(getLLMProvider(), source.organisationId,
      'You are a test governance assistant.',
      'Agent TEST-001 is registered for a controlled runtime validation.',
      'What agent is referenced?', value => { report = value; });
  } catch { throw new Error('M14_REAL_OPENAI_INVOCATION_FAILED'); }
  if (!report || report.state !== 'RECORDED') throw new Error('M14_REAL_ACCEPTANCE_INGESTION_FAILED');
  const [execution, model] = report.observations.map(item => item.observation);
  assert.equal(execution.kind, 'EXECUTION'); assert.equal(model.kind, 'MODEL_CALL');
  assert.equal(execution.traceId, model.traceId);
  assert.deepEqual(model.parent, { state: 'SPAN_REFERENCE', parentSpanId: execution.spanId });
  assert.ok(report.observations.every(item => !item.replay && item.observation.sourceStatus === 'OK' && item.observation.recordedAt.state === 'KNOWN'));
  // Verify durable presence independently through a second, read-only DB connection.
  try {
    const rows = await sql(`select count(*) from gov_repo.runtime_observations
      where organisation_id=${literal(source.organisationId)}::uuid and connection_id=${literal(source.connectionId)}
      and trace_id=${literal(execution.traceId)} and observation_id in
      (${literal(execution.observationId)}::uuid,${literal(model.observationId)}::uuid);`);
    assert.equal(rows, '2');
  } catch { throw new Error('M14_REAL_ACCEPTANCE_DURABLE_VERIFICATION_FAILED'); }
  t.diagnostic(JSON.stringify({
    executedAt: new Date().toISOString(), gitHead: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', windowsHide: true }).trim(),
    environment: 'ov-ia-g2-test', postgresqlVersion: version,
    connectionId: source.connectionId, configurationVersion: source.sourceConfigurationVersion, producerIdentity: source.producerIdentity,
    observations: report.observations.map(({ observation: o, replay }) => ({
      observationId: o.observationId, traceId: o.traceId, spanId: o.spanId, parent: o.parent, replay,
      kind: o.kind, operation: o.operation, sourceStatus: o.sourceStatus, outcome: o.outcome,
      reportedModel: o.kind === 'MODEL_CALL' ? o.reportedModel : undefined,
      tokens: o.kind === 'MODEL_CALL' ? o.tokens : undefined, bindingState: o.binding.state, recordedAt: o.recordedAt,
    })),
    rawContentPersisted: false,
  }));
});
