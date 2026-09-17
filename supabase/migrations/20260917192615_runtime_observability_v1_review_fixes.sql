-- M14.2 independent adversarial review remediation (F01, F02). Additive only.
-- 20260917021203_runtime_observability_v1.sql is already applied to ov-ia-g2-test
-- and is not edited; migration history remains truthful.
begin;

-- F01: gov_repo.runtime_readback cast started_nano/duration_value/cost amounts/rates
-- to text but omitted ended_nano_value and source_observed_nano_value, both
-- full-range bigint (unix nanoseconds up to 9223372036854775807). to_jsonb emits
-- bigint as a bare JSON number, which silently loses precision above
-- Number.MAX_SAFE_INTEGER once it crosses PostgREST/JSON into JavaScript.
-- CREATE OR REPLACE preserves the function OID, owner and existing REVOKE/GRANT
-- ACL; no privilege changes are needed here.
create or replace function gov_repo.runtime_readback(o gov_repo.runtime_observations) returns jsonb
language sql stable security invoker set search_path=pg_catalog as $$
 select to_jsonb(o) || jsonb_build_object(
 'started_nano',o.started_nano::text,
 'received_at',gov_repo.runtime_iso(o.received_at),
 'duration_value',o.duration_value::text,
 'ended_nano_value',o.ended_nano_value::text,
 'source_observed_nano_value',o.source_observed_nano_value::text,
 'supplied_amount',o.supplied_amount::text,
 'derived_amount',o.derived_amount::text,
 'pricing_from',gov_repo.runtime_iso(o.pricing_from),
 'pricing_until_value',gov_repo.runtime_iso(o.pricing_until_value),
 'input_rate',o.input_rate::text,
 'output_rate',o.output_rate::text);
$$;

-- F02: connection_id carried an accidental table-wide UNIQUE constraint in
-- addition to the compound PRIMARY KEY(organisation_id, connection_id). This
-- forced connection identifiers into a single GLOBAL namespace shared by every
-- tenant, contradicting the tenant-scoped "organisation + connection" identity
-- model. Verified against ov-ia-g2-test (read-only, pg_constraint) that no FK
-- anywhere references connection_id alone; both dependent FKs
-- (runtime_deployment_bindings, runtime_source_configurations) already use the
-- compound (organisation_id, connection_id), which the retained PRIMARY KEY
-- continues to satisfy. Dropping this constraint changes no data and no other
-- constraint.
alter table gov_repo.runtime_source_heads
 drop constraint runtime_source_heads_connection_id_key;

commit;
