# Gov IA OTel span adapter — M14.3A

Pure internal library: `SupportedOtelSpan` -> allowlisted extraction/sanitization ->
explicit mapping -> unchanged `validateRuntimeObservation` -> `RuntimeObservation`.
The adapter has zero canonical write authority. No network, database, logging,
hashing, producer, SDK provider, identity resolver or raw-content archive exists here.

## Versions and supported source contract

| Contract | Revision |
| --- | --- |
| Core trace target | `1.41.0` |
| HTTP attribute definitions used | `1.29.0` |
| Gov IA mapping | `govia.runtime/1.0.0` |
| Adapter | `govia-otel-span/1.0.0` |
| Domain schema | `runtime-observation/1.0.0` |

The frozen domain's version fields contain the existing literal `1.0.0`; qualified
names above identify the contracts, not new domain values. Method provenance is
`GOVIA_OTEL_SPAN/1.0.0`. The qualified identifiers are derived from
`OTEL_ADAPTER_SEMVER`, `OTEL_MAPPING_SEMVER` and `OTEL_RUNTIME_SCHEMA_SEMVER`,
which also supply the corresponding semantic provenance fields. The method has
its own independent `OTEL_METHOD_VERSION`; equality with the other versions does
not couple their meanings or revisions. HTTP revision is KNOWN only when supported
HTTP attributes are extracted. GenAI and MCP convention revisions remain UNKNOWN/UNSUPPORTED.
All `govia.*` attributes below are Gov IA semantics, not claims of standardized
GenAI/MCP support. `gen_ai.*`, `mcp.*`, legacy HTTP aliases and unknown keys are ignored.

References: [trace API v1.41.0](https://github.com/open-telemetry/opentelemetry-specification/blob/v1.41.0/specification/trace/api.md)
and [HTTP spans v1.29.0](https://github.com/open-telemetry/semantic-conventions/blob/v1.29.0/docs/http/http-spans.md).
This supports a selected input vocabulary, not full OTel/OTLP conformance.

`SupportedOtelSpan` is an internal plain-data snapshot, not SDK `ReadableSpan`,
`SpanData` or OTLP JSON. A future producer/exporter must explicitly construct this
shape without copying excluded content. Exactly one source-selected completed or
partial snapshot is mapped per invocation. Later changed snapshots are still
subject to M14.2's immutable replay/conflict semantics; this adapter adds no upsert.

## Trusted context

`adaptOtelSpan(context, span)` receives an `OtelAdapterContext` only from authorized
server orchestration. The caller must obtain the immutable accepted source
configuration and already verified binding/mapping records independently of telemetry.
It supplies tenant, runtime connection, source system/provider, configuration version,
assigned observation UUID, receipt time, producer/scope/SDK identity, supported kinds
and facts, and approved coordinate lists (each list bounded to 128 entries).
The observation UUID is receipt-assigned, not semantic event identity.

This function does not authenticate, register/activate sources, query membership,
verify database existence or manufacture proof. The trusted caller must project the
M14.2 configuration accurately: kind/fact permissions, approved targets/providers,
reported models, tools (M14.2 approved target references), and approved deployments.
Target approval here additionally requires an exact `(kind, provider, reference)`
tuple; duplicate matches reject. Release coordinates require an approved
`(deployment reference, artifact digest)` pair. These narrower trusted projections
do not require database schema changes. Admission still checks the actual immutable
configuration, binding/mapping proof, activation, quota, admission window and replay.

Payload tenant/connection/configuration/agentVersion IDs are ignored, including
lookalike resource attributes. Matching producer identity is an attribution check,
not producer authorization. No caller should expose the context to telemetry clients.

## Exact input fields and mappings

| Input path | Meaning / output |
| --- | --- |
| `traceId`, `spanId` | Required nonzero lowercase hex, 32/16 characters; copied after validation |
| `parentSpanId` | Absent -> UNKNOWN/NOT_SUPPLIED; string -> SPAN_REFERENCE; explicit `null` -> ROOT only under this source's explicit no-parent semantics |
| `startTimeUnixNano` | Required source start; canonical decimal string |
| `endTimeUnixNano` | Optional source end; no fallback; must be >= start |
| `sourceObservedTimeUnixNano` | Optional independent source-observed timestamp; no clock substitution |
| `status.code` | Required numeric OTel code: 0 -> UNSET, 1 -> OK, 2 -> ERROR |
| `instrumentationScope.name`, `.version` | Required safe references, exact match to trusted instrumentation |
| `resource['govia.producer.id']` | Required safe reference, exact match to trusted producer |
| `resource['telemetry.sdk.name']`, `['telemetry.sdk.version']` | Required safe references, exact match to trusted SDK metadata; no installation inferred |
| `resource['govia.deployment.reference']`, `['govia.artifact.sha256']` | Optional paired release coordinates; deployment safe reference and exact approved 64-hex artifact digest |
| `traceFlags` | Optional 0 or 1 only -> explicit sampled false/true; other flags reject; no rate inferred |
| `droppedAttributesCount`, `droppedEventsCount`, `droppedLinksCount` | Independent optional nonnegative safe integers; zero preserved |

No other resource keys are read. The named resource fields are producer/release
coordinates, not observed environment, principal, network, authorization or binding proof.
Scope/SDK versions are required by the accepted domain source contract even though
general OTel may omit them. Missing required metadata rejects; no version is invented.

All timestamp/duration values stay decimal strings within `0..9223372036854775807`,
the frozen M14.1/M14.2 range. Only exact BigInt subtraction calculates duration when
both times and DURATION support exist; Unix nanos never pass through JS Number.
`receivedAt` comes only from trusted context; `recordedAt` stays UNKNOWN/NOT_SUPPLIED
until persistence. No ordering is imposed across source/server clocks.

## Closed span attribute allowlist

The table is exhaustive. Attributes listed for another kind are ignored without
reading their values. Generic OTel `SpanKind` and arbitrary span names never select
Gov IA semantics. Unsupported kinds/operations, including HANDOFF, reject.

| Kinds | Exact key | Mapping |
| --- | --- | --- |
| All five | `govia.observation.kind` | Exact EXECUTION / MODEL_CALL / TOOL_CALL / MCP_CALL / API_CALL discriminant |
| All five | `govia.operation` | Required closed operation, per table below |
| All five | `govia.error.code` | Optional closed code below; unsupported input -> UNKNOWN/UNSUPPORTED, without inspecting free text |
| Four call kinds | `govia.target.provider`, `govia.target.reference` | Both absent -> UNKNOWN; otherwise both required and must match one trusted approved target tuple |
| MODEL_CALL | `govia.model.reported` | Optional exact approved model reference, separate from requested/observed target |
| MODEL_CALL | `govia.usage.input_tokens` | Optional independent input token count |
| MODEL_CALL | `govia.usage.output_tokens` | Optional independent output token count |
| MODEL_CALL | `govia.usage.total_tokens` | Optional independent total token count |
| MCP_CALL | `govia.mcp.transport` | STDIO / STREAMABLE_HTTP / SERVER_SENT_EVENTS |
| MCP_CALL | `govia.mcp.tool` | Optional exact approved tool reference; valid only for tools/call |
| MCP_CALL | `govia.mcp.result` | Explicit SUCCESS / ERROR protocol result |
| API_CALL | `govia.api.protocol` | HTTP / GRPC / GRAPHQL / WEBSOCKET / EVENT |
| API_CALL | `http.request.method` | GET / POST / PUT / PATCH / DELETE / HEAD / OPTIONS; requires HTTP or GRAPHQL protocol |
| API_CALL | `http.response.status_code` | Integer 100..599; requires HTTP or GRAPHQL protocol |

| Kind | Operations | Target kind |
| --- | --- | --- |
| EXECUTION | GOVERNANCE_ANSWER, RUNTIME_EXECUTION | Not applicable; executionScope OPERATION |
| MODEL_CALL | CHAT_COMPLETION, EMBEDDING | MODEL |
| TOOL_CALL | INVOKE | TOOL |
| MCP_CALL | tools/call, resources/read, prompts/get, ping, initialize | MCP_SERVER |
| API_CALL | REQUEST | API |

`govia.error.code` maps only DEADLINE_EXCEEDED -> TIMEOUT,
OPERATION_CANCELLED -> CANCELLED, CONNECTION_FAILED -> TRANSPORT,
HTTP_ERROR/INVALID_RESPONSE -> PROTOCOL, PROVIDER_REJECTED -> PROVIDER,
OPERATION_FAILED -> APPLICATION. The domain preserves the exact closed code.
No classification is inferred from `error.type`, exception text or stack traces.

## Outcome, facts and uncertainty

With accepted OUTCOME support: OK -> SUCCESS/OTEL_STATUS, ERROR -> ERROR/OTEL_STATUS,
UNSET -> UNKNOWN unless supported explicit HTTP or MCP result evidence exists.
For UNSET, HTTP 2xx -> SUCCESS/HTTP_STATUS; 4xx/5xx -> FAILURE/HTTP_STATUS;
1xx/3xx -> UNKNOWN. MCP SUCCESS -> SUCCESS/DIRECT_RESULT and MCP ERROR ->
FAILURE/DIRECT_RESULT. OTel ERROR takes precedence over HTTP status (e.g. response
body transport failure after a 2xx response). OK plus HTTP >=400 rejects; conflicting
explicit OTel/MCP results reject. A known error and SUCCESS rejects in domain validation.
Without OUTCOME support, preserve source status and leave outcome UNKNOWN/UNSUPPORTED.

All directly supplied mapped facts require corresponding accepted fact support;
otherwise reject. Derived duration may remain UNKNOWN/UNSUPPORTED when not supported.
Unsupported optional error text stays UNKNOWN; other malformed allowlisted metadata
rejects. Unrecognized attribute names are ignored. Required unsafe identity rejects,
never redacts into a different identity. Counts are integers in `0..MAX_SAFE_INTEGER`.
Tokens remain independent; no sum, parent attribution, text-length inference or
provider-specific consistency check. Future OpenAI producer code must implement its
own provider consistency rule. Neither SUPPLIED nor DERIVED cost is supported by
this mapping: both remain UNKNOWN/UNSUPPORTED, with no cost/pricing attribute reads.

Principal/environment/network and sampling configuration remain UNKNOWN/UNSUPPORTED.
Coverage is OPERATION_ONLY with all five existing collection/clock/delivery/overlap
limitations; a known parent or root does not imply a complete trace.

## Binding, targets and identity

Semantic identity remains trusted tenant + runtime connection + traceId + spanId.
`sourceEventKey` is exactly `traceId:spanId`, scoped by the envelope. No cross-source
merge, parent query, global event hash, canonical lookup or new identity resolver.

Default binding is UNRESOLVED/MISSING_REVISION_EVIDENCE; an approved release without
trusted verified binding is UNRESOLVED/NO_EXACT_MAPPING. EXACT is emitted only when
the context supplies an existing verified release binding matching tenant, connection,
producer and the explicitly observed approved deployment/digest. Missing/mismatched
coordinates or foreign proof rejects. The domain validates method/version/shape;
M14.2 remains responsible for durable proof verification. Payload IDs never supply proof.

An observed target remains distinct from a canonical target. The latter may be
attached only from an independently verified trusted mapping for that exact approved
target, with correct tenant, kind, provider and source reference. Canonical source
connection may correctly be an independently governed catalog connection. No
USES_MODEL / USES_TOOL / USES_MCP / INVOKES / READS_FROM / WRITES_TO relationship is created.

## Sanitization and result

Own data descriptors on a fixed set of paths are read without getters or toJSON.
Excluded properties are never enumerated, copied, logged, hashed or diagnosed;
their size/depth does not expand adapter traversal. Narrow coordinate syntax
(`1..128` characters, letters/digits/`._/-`, plus secret-pattern exclusions) is
combined with trusted exact allowlists. No URL (even query-free), path or opaque
text is certified safe by regex alone. Text bounds are checked before matching;
counts, timestamps and enum values have closed limits. Trusted orchestration must
approve only safe technical references, not secrets disguised as identifiers.

Excluded: prompts/completions, request/response bodies, tool arguments/results,
headers/cookies/Authorization, API keys/tokens/passwords/client secrets/private keys,
URLs, baggage/tracestate, events/links and their contents, raw exceptions/stacks,
status descriptions, arbitrary resource/span attributes and arbitrary span names.
Excluded numeric measurements are not inferred from these contents.

Result is exactly ACCEPTED with a deeply frozen isolated RuntimeObservation, or
REJECTED with one closed `OtelAdapterError` code. No raw values, thrown messages, cause or path
is returned. No omitted-result variant is implemented. Plain-data callers are
required; arbitrary executable JS proxies are not a security isolation boundary,
although reflection failures are caught without echoing their messages.

Future transport must enforce byte/batch limits before parsing and must not log
raw input. M14.3A intentionally has no transport. Fixtures and mock RPC checks do
not establish live producer, SDK exporter, PostgREST or database acceptance.

## M14.3B — internal server ingestion boundary

`runtime-ingestion.ts` is the intended application composition entry point:

```ts
ingestSupportedRuntimeSpan(persistenceContext, adapterContext, span)
  // Promise<RuntimePersistenceResult>: { observation: RuntimeObservation, replay: boolean }
```

It imports `server-only` and the existing M14.2 persistence implementation. The
pure adapter and canonical contracts do not import this boundary or database code.
One call handles one `SupportedOtelSpan`; there is no route, listener, OTLP endpoint,
batch consumer, source registration, SDK installation or producer instrumentation.

Both contexts must come from trusted, already-authorized server orchestration.
The boundary checks `organisationId` and `connectionId` equality **before** adapting
or persisting. Those are the only coordinates in `RuntimePersistenceContext`;
there is no second source system/provider/configuration snapshot to compare.
Adapter validation checks producer/instrumentation and verified binding coordinates;
M14.2 admission remains responsible for actual durable source/configuration/proof
checks, activation, quotas and replay. No new source configuration loader or
authentication has been implemented: the inspected application exposes persistence,
while source administration is implemented by restricted M14.2 database RPCs.

`OtelAdapterContext` must accurately project the immutable authorized source
configuration, including supported kinds/facts, approved targets/models/tools/releases
and independently verified binding. Telemetry cannot supply any of that authority.
`observationId` and server-owned arrival `receivedAt` remain caller supplied through
that trusted context. This boundary generates neither another ID nor another clock.

Flow: trusted-context consistency -> `adaptOtelSpan` (allowlisted extraction and
existing domain validation) -> accepted sanitized `RuntimeObservation` -> unchanged
`persistRuntimeObservation` (existing validation/admission/typed readback).
Adapter rejection ends the call before persistence. The raw snapshot is passed only
to the adapter; the boundary never reads, logs, serializes, hashes or archives it.
Existing adapter bounds and M14.2 sanitized payload limits remain in force; future
transport byte/batch limits are not implemented or claimed here.

Success returns the **original M14.2 result** without reconstructing its observation.
An identical replay therefore retains `replay: true`, original observation ID,
binding, provenance, receivedAt and database-owned recordedAt. The boundary adds
no deduplication, retries, counters or historical rebinding.

Failures throw `RuntimeIngestionError` with one closed `code` and the same value-free
`message`; no raw value, database detail, original error or cause is attached:

| Code | Meaning |
| --- | --- |
| `RUNTIME_INGESTION_CONTEXT_MISMATCH` | Trusted organisation or connection differs |
| `RUNTIME_INGESTION_ADAPTER_REJECTED` | Adapter rejected the snapshot/context |
| `RUNTIME_INGESTION_ADMISSION_REJECTED` | Persistence validation/admission or unclassified persistence failure |
| `RUNTIME_INGESTION_READBACK_INVALID` | M14.2 returned its exact safe `RUNTIME_READBACK_INVALID` failure |

The error mapping intentionally collapses individual adapter/admission codes;
callers do not receive raw database/RPC details. A readback failure does not certify
that admission performed no write. Replay/conflict semantics remain M14.2-owned.

Boundary unit tests mock persistence. The structural compatibility test now invokes
this boundary with the real adapter and M14.2 persistence/readback, mocking only RPC.
Neither test mode establishes new database acceptance. Real producer coverage is
**NONE**; controlled producer orchestration and instrumentation remain M14.4.

## M14.4 — controlled OpenAI governance-answer producer

Implemented producer scope is **one OpenAI governance-answer invocation**, using
the existing `gpt-4o-mini` Chat Completions fetch path. It creates EXECUTION /
GOVERNANCE_ANSWER and its child MODEL_CALL / CHAT_COMPLETION on the same trace.
TOOL_CALL, MCP_CALL and API_CALL remain domain/fixture coverage only. Embeddings,
DeepSeek, Ollama, noop, intent routing, coding-memory and ledger are uninstrumented.
The producer does not make M14 complete; M14.5 remains the closure gate.

`Talk.ask` calls `generateGovernanceAnswer` only at its existing answer-generation
site. The optional fourth `LLMProvider.generateAnswer` parameter is an internal
OpenAI-only metadata callback. Existing three-argument callers and other providers
retain their behavior. Repository search found one answer caller (Talk) and four
provider-selection callers (Talk plus three embedding paths in coding-memory).
Prompts, model selection, max_tokens=500, temperature=0.1, answer formatting and
Talk fallback remain unchanged.

Each invocation owns a private `BasicTracerProvider`, `AlwaysOnSampler`, explicit
minimal resource and bounded processor retaining at most two ended DTOs. Root uses
ROOT_CONTEXT; child uses `trace.setSpan(ROOT_CONTEXT, execution)` explicitly.
No global registration, context manager, current-span variable, resource detector,
OTLP transport, exporter service, queue or retry exists. Static names are
`govia.governance_answer` and `govia.openai.chat_completion`; names are not exported
to the supported DTO. Attribute limit is eight, value length 128, events/links zero.

The caller waits synchronously for the producer's bounded two-admission attempt:
`generateGovernanceAnswer` awaits `finish` before returning the existing business
answer. The wait is capped at five seconds, so an observation failure can add up to
five seconds of latency without changing the answer. Timeout is not cancellation:
an RPC already in flight may complete afterward, and the timeout never starts a
retry or certifies that no row was written. M14.5 must revisit production delivery
and any decision to move this wait off the request path.

Exact packages: API **1.9.0**, sdk-trace-base **2.0.1**, resources **2.0.1**,
semantic-conventions **1.29.0**; transitive core **2.0.1**. All four direct packages
are used: tracing/context types, private SDK, explicit resource construction and
SDK resource attribute names respectively. Frozen adapter/schema/mapping/method
versions and trace/HTTP convention revisions are unchanged.

### Explicit deployment configuration and tenant boundary

Observation is enabled only with `GOVIA_RUNTIME_OPENAI_ENABLED=1` and a valid
`GOVIA_RUNTIME_OPENAI_SOURCE` JSON object (maximum 8192 UTF-8 bytes). This is a
credential-free deployment-admin projection of an **already authorized** immutable
M14.2 source configuration, not source registration or authority by itself.
Never populate it from a request, provider response, headers or telemetry.

Required fields:

| Field | Trusted origin / required value |
| --- | --- |
| organisationId | Deployment's tenant must exactly match the trusted Talk organisation argument |
| connectionId, sourceSystemId, providerCode | Existing authorized runtime source coordinates; no defaults |
| sourceConfigurationVersion, producerIdentity | Existing immutable configuration/head coordinates |
| instrumentation | `{name:"govia.openai.governance-answer",version:"1.0.0",sdkName:"opentelemetry",sdkVersion:"2.0.1"}` |
| supportedKinds | `["EXECUTION","MODEL_CALL"]` |
| supportedFacts | Exactly END_TIME, PARENT, TARGET, OUTCOME, DURATION, ERROR, TOKENS, SAMPLING, DROPPED_COUNTS; no duplicates |
| approvedModels | `["gpt-4o-mini"]` |
| approvedTargets, approvedTools, approvedDeployments | Each explicitly `[]` in this narrow producer |

The snapshot is frozen per invocation. Other organisations fail closed for
observation; their business answer still works. Narrow kind/fact/model approvals
must be authorized by the durable source configuration, which may support a
superset. The deployment snapshot is subordinate to, and never replaces or
upgrades, that durable M14.2 authority. At every admission M14.2 rechecks the exact
tenant/source coordinates, immutable identity/version, activation, approvals,
window, quotas and replay. A durable mismatch or configuration drift (including
`RUNTIME_CONFIGURATION_MISMATCH`) rejects the observation and returns `FAILED`; it
never bypasses authority, silently substitutes the projection, or turns the
business invocation into a success. No source table SELECT, admin RPC, privilege
expansion or source mutation is added to the request path. No migration is required.

No deployment association is asserted by this producer: binding remains
UNRESOLVED/MISSING_REVISION_EVIDENCE. No verified binding or canonical target is
loaded or fabricated. A future independently verified binding is not silently
inferred from model, repository or latest AgentVersion.

### Metadata and failure disposition

The existing HTTP client emits only a closed success/error discriminator and
direct validated prompt/completion/total usage counts. Zero is retained; absent,
negative, fractional, nonnumeric and unsafe counts stay absent. Independently
valid partial counts are retained; contradictory complete counts are discarded
without repair or estimation. No token values come from max_tokens or text.
`govia.model.reported=gpt-4o-mini` identifies the actual model reference sent by
this controlled client, approved by the trusted configuration; it is not an
assertion of the response's resolved model revision or canonical identity.
Arbitrary response model strings are not copied. Cost remains UNKNOWN.

HTTP failure maps to HTTP_ERROR, fetch failure to CONNECTION_FAILED and malformed
JSON/missing string answer to INVALID_RESPONSE. No body, exception message, cause
or stack is passed into OTel. Successful HTTP plus a string answer supplies explicit
OK; failures supply ERROR. Missing callback evidence remains UNSET, never success.
An empty string is still a valid provider string result: when the HTTP invocation
succeeds it may be recorded as `OK`/`SUCCESS` for that observed invocation. That
record proves only the provider/transport observation, not answer usefulness, Talk
selection or governance success; Talk's existing trim/fallback remains authoritative
for the returned user-facing answer. Existing business return/throw behavior is
preserved, including empty answers.

The public SDK `ReadableSpan` bridge reads explicit fields only. It ignores names,
events, links, arbitrary attributes/resources, status descriptions and exceptions.
SDK HrTime components convert separately to BigInt before combining into decimal
Unix-nanosecond strings. UUID observation IDs are server-generated outside spans;
receivedAt is assigned at ingestion; recordedAt is solely database-owned.

Flow: private ended spans -> explicit SupportedOtelSpan bridge -> unchanged
M14.3B ingestion -> unchanged M14.3A adapter -> unchanged M14.2 validation,
`admit_runtime_observation` and typed durable readback. Execution is admitted first,
then model; the two admissions are not a new atomic pair transaction.

Observability failure is **fail-open for the business answer and fail-closed for
the evidence claim**. The internal result is RECORDED only after both readbacks;
otherwise FAILED with a closed producer code. Server diagnostics contain only
`GOVIA_RUNTIME_OBSERVATION_FAILED` plus that code. No telemetry payload or raw error
is logged. Disabled observation reports NOT_OBSERVED internally, not "no execution".
Setup/configuration failure also preserves the existing business invocation.

The post-answer ingestion wait is bounded to five seconds for the pair. Timeout
does not establish that no row was written: an in-flight RPC may finish afterward.
No retry or next admission is started after timeout. Admission/readback failure
can also leave a partial pair; FAILED never certifies absence or complete coverage.
Existing M14.2 tenant+connection+trace+span replay semantics remain authoritative.

### Controlled real acceptance (explicit opt-in only)

`tests/openai-runtime-acceptance.test.ts` invokes the same producer/client once with
harmless synthetic inputs; it never logs the inputs or answer. No mocked fetch,
mock RPC, fake provider, source provisioning or migration exists in this harness.
Required environment, supplied securely outside source control:

- `RUN_M14_REAL_OPENAI_ACCEPTANCE=1`, `LLM_PROVIDER=openai`, real `OPENAI_API_KEY`.
- Valid producer configuration above and `M14_REAL_OPENAI_ORGANISATION_ID` matching it.
- `SUPABASE_URL=https://zkqfvqwqdypgpzauzinw.supabase.co` and its existing service key.
- `M14_HOSTED_DB_TEST=1`, `M14_DATABASE_MODE=supabase-hosted`,
  `M14_HOSTED_PROJECT_REF=zkqfvqwqdypgpzauzinw`.
- Existing authenticated Supabase CLI and repository link metadata for
  **ov-ia-g2-test**; PostgreSQL major 17 and applied M14.2 migrations.

From `apps/dashboard`, run only this gated test:

```powershell
node --conditions=react-server --experimental-test-module-mocks --import tsx --test tests/openai-runtime-acceptance.test.ts
```

Preflight performs only tenant/source-scoped administrator reads through the
existing lab-guarded CLI helper: platform/version, configuration compatibility,
activation, window and capacity for two observations. Runtime admission uses the
actual existing privileged client/service_role, not administrator admission.
A separate read verifies durable presence after typed readback. Only explicitly
selected metadata is printed as acceptance evidence. No credentials are loaded
automatically from `.env.local`; protected gov-ia-dev is rejected.

Missing key reports REAL_OPENAI_ACCEPTANCE_BLOCKED_NO_CREDENTIAL before DB access.
Missing/incompatible source reports STOP_REMOTE_DB_AUTHORIZATION_REQUIRED before
the OpenAI call. An owner must authorize any required administrative state first:
register_runtime_source only if the tenant-local head is absent;
configure_runtime_source for a new compatible immutable version when necessary;
activate_runtime_source to select/enable that version. No binding/canonical row is
needed. These operations are **not executed by the harness or application**.

Deterministic producer tests, structural integration with mock RPC and actual
external-provider/database acceptance are separate evidence categories. A skipped
or blocked harness supplies no claim of real OpenAI execution or database acceptance.
