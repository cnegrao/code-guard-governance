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
