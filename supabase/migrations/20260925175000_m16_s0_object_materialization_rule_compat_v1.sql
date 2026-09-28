-- M16-S0.3.3B0: corrective, append-only. Makes gov_repo.materialize_object_reconciliation's
-- normalized-mapping insert compatible with PostgreSQL's categorical restriction that
-- INSERT ... ON CONFLICT cannot target a relation carrying ANY rewrite RULE, regardless of
-- which DML the rule fires on (SQLSTATE 0A000, unconditional as of at least PG17). gov_repo.
-- canonical_normalized_object_mappings carries the normalized_mapping_no_update /
-- normalized_mapping_no_delete DO INSTEAD NOTHING immutability rules that
-- 20260909210640_relationship_decision_to_truth_v1.sql already added (that migration is NOT
-- modified here), so the function's ON CONFLICT ... DO NOTHING ... RETURNING form can never
-- execute on PostgreSQL 17: every CREATE_NEW/MATCH_EXISTING object materialization fails closed
-- with 0A000 before writing anything. This is a real defect in the current function body, not
-- in any S0.3.3 wrapper.
--
-- CREATE OR REPLACE FUNCTION with an identical name and argument-type list preserves the
-- function's OID, so its existing owner (postgres), SECURITY INVOKER mode, search_path, ACL
-- (service_role EXECUTE only; PUBLIC/anon/authenticated remain revoked — inherited automatically,
-- never re-granted here) and COMMENT ON FUNCTION are all untouched by this migration. The ONLY
-- behavioral change is the normalized-mapping insert strategy: the incompatible
-- "INSERT ... ON CONFLICT ON CONSTRAINT normalized_mapping_identity_unique DO NOTHING ...
-- RETURNING mapping_id" is replaced by a plain INSERT inside a narrow PL/pgSQL sub-block whose
-- EXCEPTION WHEN unique_violation handler is filtered to the EXACT constraint the former ON
-- CONFLICT target named, via GET STACKED DIAGNOSTICS ... = CONSTRAINT_NAME. Any other unique
-- violation — including the mapping's own primary key, or a future unique constraint on this
-- table — is RAISE'd unchanged, never swallowed. Every other statement, validation, lock,
-- idempotency, replay, materialization_operations write, outbox write and error taxonomy is
-- byte-for-byte the same as before. No immutability rule is weakened: normalized_mapping_no_update
-- and normalized_mapping_no_delete are untouched, and UPDATE/DELETE on this table remain DO
-- INSTEAD NOTHING.
--
-- Concurrency: the UNIQUE constraint (normalized_mapping_identity_unique) remains the sole
-- concurrency authority, exactly as the former ON CONFLICT DO NOTHING path relied on it. Two
-- concurrent callers materializing the identical normalized identity: the plain INSERT that
-- reaches the row first commits; the other's INSERT raises 23505 on that exact constraint, is
-- caught, and re-reads the now-committed row under the SAME compatibility predicate
-- (canonical_object_id / canonical_object_kind / normalized_object_identity / parent) the former
-- DO NOTHING branch already required — a compatible existing row resolves silently, an
-- incompatible one still raises 23514 NORMALIZED_MAPPING_CONFLICT. If the first winner's
-- transaction instead aborts before commit, its row never durably existed, so the second
-- INSERT simply succeeds as a normal first insert — no special-cased retry, no SELECT-then-INSERT
-- race window substituted for the constraint.
--
-- Never run against a hosted DB from this slice.
begin;

create or replace function gov_repo.materialize_object_reconciliation(
  p_organisation_id            uuid,
  p_reconciliation_decision_id text,
  p_invocation_id              text,
  p_outcome                    text,
  p_canonical_object_id        text,
  p_canonical_object_kind      text,
  p_source_connection_id       text,
  p_source_external_type       text,
  p_source_external_id         text,
  p_match_method               text,
  p_idempotency_fingerprint    char(64),
  p_occurred_at                timestamptz
)
returns table (
  replay              boolean,
  status              text,
  canonical_object_id text,
  mapping_id          text
)
language plpgsql
volatile
security invoker
set search_path = 'gov_repo', 'pg_catalog'
as $$
#variable_conflict use_column
declare
  v_won          text;
  v_decision     gov_repo.reconciliation_decisions%rowtype;
  v_invocation   gov_repo.reconciliation_invocations%rowtype;
  v_existing_fp  text;
  v_existing_op  gov_repo.materialization_operations%rowtype;
  v_mapping_id   text;
  v_operation_id text;
  v_payload      jsonb;
  v_candidate gov_repo.discovery_candidates%rowtype;
  v_identity text;
  v_parent text;
  v_legacy_object_id text;
  v_constraint_name text;
begin
  if p_outcome not in ('CREATE_NEW', 'MATCH_EXISTING') then
    raise exception using errcode = '22023', message = 'UNSUPPORTED_MATERIALIZATION_OUTCOME';
  end if;

  select * into v_decision from gov_repo.reconciliation_decisions as rd
    where rd.organisation_id = p_organisation_id and rd.decision_id = p_reconciliation_decision_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'RECONCILIATION_DECISION_NOT_FOUND';
  end if;
  if v_decision.family <> 'OBJECT' or v_decision.outcome <> p_outcome then
    raise exception using errcode = '22023', message = 'DECISION_FAMILY_OR_OUTCOME_MISMATCH';
  end if;
  if v_decision.canonical_object_id is distinct from p_canonical_object_id
     or v_decision.canonical_object_kind is distinct from p_canonical_object_kind then
    raise exception using errcode = '22023', message = 'CANONICAL_IDENTITY_MISMATCH';
  end if;

  select * into v_invocation from gov_repo.reconciliation_invocations as ri
    where ri.organisation_id = p_organisation_id and ri.invocation_id = p_invocation_id;
  if not found or v_invocation.reconciliation_decision_id <> p_reconciliation_decision_id then
    raise exception using errcode = 'P0002', message = 'INVOCATION_DECISION_MISMATCH';
  end if;

  insert into gov_repo.materialization_locks (organisation_id, reconciliation_decision_id, idempotency_fingerprint)
  values (p_organisation_id, p_reconciliation_decision_id, p_idempotency_fingerprint)
  on conflict (organisation_id, reconciliation_decision_id) do nothing
  returning reconciliation_decision_id into v_won;

  if v_won is null then
    -- Another call already claimed this decision. Wait for it to finish
    -- (row lock blocks until the winner commits or aborts), then read the
    -- outcome it produced rather than racing it.
    perform 1 from gov_repo.materialization_locks as ml
      where ml.organisation_id = p_organisation_id and ml.reconciliation_decision_id = p_reconciliation_decision_id
      for share;

    select ml.idempotency_fingerprint into v_existing_fp
      from gov_repo.materialization_locks as ml
      where ml.organisation_id = p_organisation_id and ml.reconciliation_decision_id = p_reconciliation_decision_id;
    if v_existing_fp is distinct from p_idempotency_fingerprint then
      raise exception using
        errcode = '23514',
        message = 'MATERIALIZATION_IDEMPOTENCY_CONFLICT',
        detail = format('reconciliation_decision_id %s already materialized with a different fingerprint', p_reconciliation_decision_id);
    end if;

    select * into v_existing_op from gov_repo.materialization_operations as mo
      where mo.organisation_id = p_organisation_id and mo.reconciliation_decision_id = p_reconciliation_decision_id;
    if not found then
      -- The winner's transaction aborted after taking the lock (which is
      -- itself part of that aborted transaction and was rolled back with
      -- it) yet ours observed a conflict before the abort was visible; this
      -- is a narrow race the caller should simply retry.
      raise exception using errcode = '40001', message = 'MATERIALIZATION_CONCURRENT_ATTEMPT_FAILED';
    end if;

    select csm.mapping_id into v_mapping_id from gov_repo.canonical_object_source_mappings as csm
      where csm.organisation_id = p_organisation_id and csm.created_by_decision_id = p_reconciliation_decision_id;

    if v_mapping_id is null then
      select m.mapping_id into v_mapping_id from gov_repo.canonical_normalized_object_mappings m
      where m.organisation_id = p_organisation_id and m.canonical_object_id = v_existing_op.resulting_canonical_object_id
        and m.source_connection_id = p_source_connection_id and m.source_external_type = p_source_external_type
        and m.source_external_id = p_source_external_id and m.canonical_object_kind = p_canonical_object_kind
        and m.normalized_object_identity = (select gov_repo.normalized_object_identity(p_organisation_id, dc.envelope) from gov_repo.discovery_candidates dc
          where dc.organisation_id = p_organisation_id and dc.candidate_id = v_decision.subject_candidate_id);
    end if;
    return query select true, v_existing_op.status, v_existing_op.resulting_canonical_object_id, v_mapping_id;
    return;
  end if;

  select dc.* into v_candidate from gov_repo.discovery_candidates dc
    join gov_repo.review_subjects rs on rs.organisation_id = dc.organisation_id and rs.finding_id = dc.finding_id
    where dc.organisation_id = p_organisation_id and dc.candidate_id = v_decision.subject_candidate_id
      and dc.candidate_kind = p_canonical_object_kind and rs.review_subject_id = v_invocation.review_subject_id
      and rs.state = 'CERTIFIED' and dc.source_connection_id = p_source_connection_id
      and dc.source_external_type = p_source_external_type and dc.source_external_id = p_source_external_id;
  if not found then raise exception using errcode = '23514', message = 'OBJECT_CANDIDATE_BINDING_MISMATCH'; end if;
  if p_match_method <> 'MANUAL' then raise exception using errcode = '23514', message = 'HUMAN_MAPPING_REQUIRED'; end if;
  v_identity := gov_repo.normalized_object_identity(p_organisation_id, v_candidate.envelope);
  if p_canonical_object_kind in ('AGENT_VERSION','DATA_ELEMENT') then
    select ep.canonical_object_id into v_parent from gov_repo.resolve_canonical_endpoint(p_organisation_id,
      v_candidate.envelope->'proposedIdentity'->(case p_canonical_object_kind when 'AGENT_VERSION' then 'agent' else 'parentDataAsset' end)) ep
      where ep.canonical_object_kind = case p_canonical_object_kind when 'AGENT_VERSION' then 'AGENT' else 'DATA_ASSET' end;
    if not found then raise exception using errcode = 'P0002', message = 'PARENT_NOT_CANONICAL'; end if;
  end if;
  -- Repeat the preflight inside this authoritative transaction before any canonical write.
  v_legacy_object_id := gov_repo.legacy_canonical_object_for_candidate(p_organisation_id, v_candidate.envelope);
  if v_legacy_object_id is not null then
    if p_outcome = 'CREATE_NEW' then
      raise exception using errcode = '23514', message = 'LEGACY_OBJECT_ALREADY_CANONICAL';
    elsif p_canonical_object_id is distinct from v_legacy_object_id then
      raise exception using errcode = '23514', message = 'LEGACY_OBJECT_MATCH_MISMATCH';
    end if;
  end if;
  -- We hold the lock uncontested for this decision: perform materialization.
  if p_outcome = 'CREATE_NEW' then
    begin
      insert into gov_repo.canonical_objects (canonical_object_id, organisation_id, kind, created_by_decision_id)
      values (p_canonical_object_id, p_organisation_id, p_canonical_object_kind, p_reconciliation_decision_id);
    exception when unique_violation then
      raise exception using
        errcode = '23505',
        message = 'CANONICAL_OBJECT_IDENTITY_CONFLICT',
        detail = format('canonical_object_id %s already exists under a different decision', p_canonical_object_id);
    end;
  else
    perform 1 from gov_repo.canonical_objects as co
      where co.organisation_id = p_organisation_id
        and co.canonical_object_id = p_canonical_object_id
        and co.kind = p_canonical_object_kind;
    if not found then
      raise exception using errcode = 'P0002', message = 'MATCH_EXISTING_TARGET_NOT_FOUND';
    end if;
  end if;

  -- PostgreSQL 17 (unconditionally, not only PG17): INSERT ... ON CONFLICT cannot target a
  -- relation carrying ANY rewrite RULE (canonical_normalized_object_mappings carries
  -- normalized_mapping_no_update / normalized_mapping_no_delete). A plain INSERT is unaffected
  -- by those UPDATE/DELETE-only rules; conflict resolution is instead a narrowly filtered
  -- EXCEPTION WHEN unique_violation, scoped to EXACTLY the constraint the former ON CONFLICT
  -- target named. Any other unique violation (including this table's own primary key) RAISEs
  -- unchanged, never swallowed here.
  v_mapping_id := gen_random_uuid()::text;
  begin
    insert into gov_repo.canonical_normalized_object_mappings (
      mapping_id, organisation_id, canonical_object_id, canonical_object_kind,
      source_connection_id, source_external_type, source_external_id, normalized_object_identity,
      candidate_id, parent_canonical_object_id, match_method, created_by_decision_id, valid_from
    ) values (v_mapping_id, p_organisation_id, p_canonical_object_id, p_canonical_object_kind,
      p_source_connection_id, p_source_external_type, p_source_external_id, v_identity,
      v_candidate.candidate_id, v_parent, p_match_method, p_reconciliation_decision_id, p_occurred_at);
  exception when unique_violation then
    get stacked diagnostics v_constraint_name = constraint_name;
    if v_constraint_name is distinct from 'normalized_mapping_identity_unique' then
      raise;
    end if;
    v_mapping_id := null;
  end;
  if v_mapping_id is null then
    select m.mapping_id into v_mapping_id from gov_repo.canonical_normalized_object_mappings m
      where m.organisation_id = p_organisation_id and m.source_connection_id = p_source_connection_id
        and m.source_external_type = p_source_external_type and m.source_external_id = p_source_external_id
        and m.canonical_object_kind = p_canonical_object_kind and m.normalized_object_identity = v_identity
        and m.canonical_object_id = p_canonical_object_id and m.parent_canonical_object_id is not distinct from v_parent;
    if not found then raise exception using errcode = '23514', message = 'NORMALIZED_MAPPING_CONFLICT'; end if;
  end if;

  v_operation_id := gen_random_uuid()::text;
  insert into gov_repo.materialization_operations (
    materialization_operation_id, organisation_id, reconciliation_decision_id, invocation_id,
    decision_family, outcome, status, idempotency_fingerprint, resulting_canonical_object_id, applied_at
  ) values (
    v_operation_id, p_organisation_id, p_reconciliation_decision_id, p_invocation_id,
    'OBJECT', p_outcome, 'APPLIED', p_idempotency_fingerprint, p_canonical_object_id, p_occurred_at
  );

  v_payload := jsonb_build_object(
    'organisationId', p_organisation_id,
    'reconciliationDecisionId', p_reconciliation_decision_id,
    'materializationOperationId', v_operation_id,
    'canonicalObjectId', p_canonical_object_id,
    'canonicalObjectKind', p_canonical_object_kind,
    'outcome', p_outcome,
    'mappingId', v_mapping_id
  );
  insert into gov_repo.outbox_events (organisation_id, event_type, payload, payload_hash, occurred_at)
  values (
    p_organisation_id, 'GOVERNANCE_CANONICAL_OBJECT_MATERIALIZED', v_payload,
    encode(extensions.digest(convert_to(v_payload::text, 'UTF8'), 'sha256'), 'hex'),
    p_occurred_at
  );

  return query select false, 'APPLIED'::text, p_canonical_object_id, v_mapping_id;
end;
$$;

commit;
