begin;

lock table
  gov_repo.policy_mandate_mappings,
  gov_repo.governance_policies,
  gov_repo.mandates
in share row exclusive mode;

do $preflight$
declare
  missing_policy_count bigint;
  null_policy_organisation_count bigint;
  missing_mandate_count bigint;
  cross_tenant_mapping_count bigint;
  duplicate_pair_count bigint;
begin
  select count(*)
  into missing_policy_count
  from gov_repo.policy_mandate_mappings as mapping
  left join gov_repo.governance_policies as policy
    on policy.policy_id = mapping.policy_id
  where policy.policy_id is null;

  if missing_policy_count > 0 then
    raise exception using
      errcode = '23503',
      message = 'Cannot enforce policy-to-mandate tenant isolation.',
      detail = format(
        '%s policy-to-mandate mapping(s) reference a missing governance policy.',
        missing_policy_count
      ),
      hint = 'Restore the missing governance policy references or obtain manual data-owner disposition before retrying this migration.';
  end if;

  select count(*)
  into null_policy_organisation_count
  from gov_repo.policy_mandate_mappings as mapping
  join gov_repo.governance_policies as policy
    on policy.policy_id = mapping.policy_id
  where policy.organisation_id is null;

  if null_policy_organisation_count > 0 then
    raise exception using
      errcode = '23502',
      message = 'Cannot enforce policy-to-mandate tenant isolation.',
      detail = format(
        '%s policy-to-mandate mapping(s) reference a governance policy without tenant ownership.',
        null_policy_organisation_count
      ),
      hint = 'Resolve the governance policy tenant ownership with the Product Owner or data owner before retrying this migration.';
  end if;

  select count(*)
  into missing_mandate_count
  from gov_repo.policy_mandate_mappings as mapping
  left join gov_repo.mandates as mandate
    on mandate.mandate_id = mapping.mandate_id
  where mandate.mandate_id is null;

  if missing_mandate_count > 0 then
    raise exception using
      errcode = '23503',
      message = 'Cannot enforce policy-to-mandate tenant isolation.',
      detail = format(
        '%s policy-to-mandate mapping(s) reference a missing mandate.',
        missing_mandate_count
      ),
      hint = 'Restore the missing mandate references or obtain manual data-owner disposition before retrying this migration.';
  end if;

  select count(*)
  into cross_tenant_mapping_count
  from gov_repo.policy_mandate_mappings as mapping
  join gov_repo.governance_policies as policy
    on policy.policy_id = mapping.policy_id
  join gov_repo.mandates as mandate
    on mandate.mandate_id = mapping.mandate_id
  where mandate.organisation_id is not null
    and mandate.organisation_id <> policy.organisation_id;

  if cross_tenant_mapping_count > 0 then
    raise exception using
      errcode = '23514',
      message = 'Cannot enforce policy-to-mandate tenant isolation.',
      detail = format(
        '%s cross-tenant policy-to-mandate mapping(s) require manual disposition.',
        cross_tenant_mapping_count
      ),
      hint = 'Resolve the inconsistent mappings with the Product Owner or data owner before retrying this migration.';
  end if;

  select count(*)
  into duplicate_pair_count
  from (
    select 1
    from gov_repo.policy_mandate_mappings
    group by policy_id, mandate_id
    having count(*) > 1
  ) as duplicate_pair;

  if duplicate_pair_count > 0 then
    raise exception using
      errcode = '23505',
      message = 'Cannot enforce policy-to-mandate tenant isolation.',
      detail = format(
        '%s duplicate policy-and-mandate pair(s) require manual disposition.',
        duplicate_pair_count
      ),
      hint = 'Resolve duplicate mappings with the Product Owner or data owner before retrying this migration.';
  end if;
end;
$preflight$;

alter table gov_repo.policy_mandate_mappings
  add column organisation_id uuid;

update gov_repo.policy_mandate_mappings as mapping
set organisation_id = policy.organisation_id
from gov_repo.governance_policies as policy
where policy.policy_id = mapping.policy_id;

do $backfill$
begin
  if exists (
    select 1
    from gov_repo.policy_mandate_mappings
    where organisation_id is null
  ) then
    raise exception using
      errcode = '23514',
      message = 'Policy-to-mandate tenant backfill did not resolve every mapping.',
      hint = 'Verify that every mapping references an existing governance policy before retrying this migration.';
  end if;
end;
$backfill$;

alter table gov_repo.policy_mandate_mappings
  alter column organisation_id set not null;

alter table gov_repo.governance_policies
  add constraint governance_policies_organisation_policy_unique
  unique (organisation_id, policy_id);

alter table gov_repo.policy_mandate_mappings
  drop constraint policy_mandate_mappings_policy_id_fkey,
  add constraint policy_mandate_mappings_organisation_policy_fkey
    foreign key (organisation_id, policy_id)
    references gov_repo.governance_policies (organisation_id, policy_id)
    on delete cascade;

create index idx_policy_mandate_mappings_organisation_policy
  on gov_repo.policy_mandate_mappings (organisation_id, policy_id);

create index idx_policy_mandate_mappings_mandate_organisation
  on gov_repo.policy_mandate_mappings (mandate_id, organisation_id);

create table gov_repo.mandate_mapping_guards (
  mandate_id uuid primary key
    references gov_repo.mandates (mandate_id)
    on update cascade
    on delete cascade,
  guard_version bigint not null default 0,
  constraint mandate_mapping_guards_version_nonnegative
    check (guard_version >= 0)
);

alter table gov_repo.mandate_mapping_guards enable row level security;

insert into gov_repo.mandate_mapping_guards (mandate_id)
select mandate.mandate_id
from gov_repo.mandates as mandate
order by mandate.mandate_id;

do $guard_population$
declare
  missing_guard_count bigint;
  duplicate_guard_count bigint;
  orphan_guard_count bigint;
begin
  select count(*)
  into missing_guard_count
  from gov_repo.mandates as mandate
  left join gov_repo.mandate_mapping_guards as guard
    on guard.mandate_id = mandate.mandate_id
  where guard.mandate_id is null;

  if missing_guard_count > 0 then
    raise exception using
      errcode = '23503',
      message = 'Cannot establish mandate mapping serialization guards.',
      detail = format(
        '%s mandate(s) do not have a serialization guard.',
        missing_guard_count
      );
  end if;

  select count(*)
  into duplicate_guard_count
  from (
    select guard.mandate_id
    from gov_repo.mandate_mapping_guards as guard
    group by guard.mandate_id
    having count(*) > 1
  ) as duplicate_guard;

  if duplicate_guard_count > 0 then
    raise exception using
      errcode = '23505',
      message = 'Cannot establish mandate mapping serialization guards.',
      detail = format(
        '%s mandate serialization guard key(s) are duplicated.',
        duplicate_guard_count
      );
  end if;

  select count(*)
  into orphan_guard_count
  from gov_repo.mandate_mapping_guards as guard
  left join gov_repo.mandates as mandate
    on mandate.mandate_id = guard.mandate_id
  where mandate.mandate_id is null;

  if orphan_guard_count > 0 then
    raise exception using
      errcode = '23503',
      message = 'Cannot establish mandate mapping serialization guards.',
      detail = format(
        '%s mandate serialization guard(s) do not reference an existing mandate.',
        orphan_guard_count
      );
  end if;
end;
$guard_population$;

create function gov_repo.create_mandate_mapping_guard()
returns trigger
language plpgsql
volatile
security invoker
set search_path = ''
as $function$
begin
  insert into gov_repo.mandate_mapping_guards (mandate_id)
  values (new.mandate_id);

  return new;
exception
  when unique_violation then
    raise exception using
      errcode = '23505',
      message = 'A mandate serialization guard already exists.';
end;
$function$;

create trigger trg_create_mandate_mapping_guard
after insert on gov_repo.mandates
for each row
execute function gov_repo.create_mandate_mapping_guard();

create function gov_repo.advance_mandate_mapping_guards(
  p_mandate_ids uuid[]
)
returns void
language plpgsql
volatile
security invoker
set search_path = ''
as $function$
declare
  affected_mandate_ids uuid[];
  expected_guard_count bigint;
  locked_guard_count bigint := 0;
  locked_mandate_id uuid;
begin
  select array_agg(
           distinct affected.mandate_id
           order by affected.mandate_id
         )
  into affected_mandate_ids
  from unnest(p_mandate_ids) as affected(mandate_id)
  where affected.mandate_id is not null;

  expected_guard_count := coalesce(cardinality(affected_mandate_ids), 0);

  if expected_guard_count = 0 then
    return;
  end if;

  for locked_mandate_id in
    select guard.mandate_id
    from gov_repo.mandate_mapping_guards as guard
    where guard.mandate_id = any (affected_mandate_ids)
    order by guard.mandate_id asc
    for update nowait
  loop
    locked_guard_count := locked_guard_count + 1;
  end loop;

  if locked_guard_count <> expected_guard_count then
    raise exception using
      errcode = '23503',
      message = 'A required mandate serialization guard is missing.',
      detail = format(
        '%s mandate serialization guard(s) are missing.',
        expected_guard_count - locked_guard_count
      );
  end if;

  update gov_repo.mandate_mapping_guards as guard
  set guard_version = guard.guard_version + 1
  where guard.mandate_id = any (affected_mandate_ids);
end;
$function$;

create function gov_repo.validate_explicit_policy_mandate_mapping_organisation()
returns trigger
language plpgsql
volatile
security invoker
set search_path = ''
as $function$
declare
  policy_organisation_id uuid;
begin
  select policy.organisation_id
  into policy_organisation_id
  from gov_repo.governance_policies as policy
  where policy.policy_id = new.policy_id
  for key share nowait;

  if not found then
    raise exception using
      errcode = '23503',
      message = 'Policy-to-mandate mapping references an unknown governance policy.';
  end if;

  if policy_organisation_id is null then
    raise exception using
      errcode = '23502',
      message = 'Governance policy does not have tenant ownership.';
  end if;

  if new.organisation_id is distinct from policy_organisation_id then
    raise exception using
      errcode = '23514',
      message = 'Explicit policy-to-mandate mapping organisation must match the new owning governance policy.';
  end if;

  return new;
end;
$function$;

create trigger trg_00_policy_mandate_mapping_explicit_organisation
before update of organisation_id
on gov_repo.policy_mandate_mappings
for each row
execute function gov_repo.validate_explicit_policy_mandate_mapping_organisation();

create function gov_repo.derive_policy_mandate_mapping_tenant()
returns trigger
language plpgsql
volatile
security invoker
set search_path = ''
as $function$
declare
  policy_organisation_id uuid;
begin
  select policy.organisation_id
  into policy_organisation_id
  from gov_repo.governance_policies as policy
  where policy.policy_id = new.policy_id
  for key share nowait;

  if not found then
    raise exception using
      errcode = '23503',
      message = 'Policy-to-mandate mapping references an unknown governance policy.';
  end if;

  if policy_organisation_id is null then
    raise exception using
      errcode = '23502',
      message = 'Governance policy does not have tenant ownership.';
  end if;

  if tg_op = 'INSERT'
     and new.organisation_id is not null
     and new.organisation_id is distinct from policy_organisation_id then
    raise exception using
      errcode = '23514',
      message = 'Policy-to-mandate mapping organisation must match the owning governance policy.';
  end if;

  new.organisation_id := policy_organisation_id;

  return new;
end;
$function$;

create trigger trg_policy_mandate_mapping_tenant
before insert or update of mapping_id, policy_id, mandate_id, organisation_id
on gov_repo.policy_mandate_mappings
for each row
execute function gov_repo.derive_policy_mandate_mapping_tenant();

create function gov_repo.enforce_policy_mandate_mapping_insert()
returns trigger
language plpgsql
volatile
security invoker
set search_path = ''
as $function$
declare
  affected_mandate_ids uuid[];
begin
  select array_agg(
           distinct mapping.mandate_id
           order by mapping.mandate_id
         )
  into affected_mandate_ids
  from new_mapping_rows as mapping;

  perform gov_repo.advance_mandate_mapping_guards(affected_mandate_ids);

  if exists (
    select 1
    from new_mapping_rows as mapping
    join gov_repo.mandates as mandate
      on mandate.mandate_id = mapping.mandate_id
    where mandate.organisation_id is not null
      and mandate.organisation_id <> mapping.organisation_id
  ) then
    raise exception using
      errcode = '23514',
      message = 'Tenant-local mandate must belong to the governance policy tenant.';
  end if;

  return null;
end;
$function$;

create trigger trg_policy_mandate_mapping_guard_insert
after insert on gov_repo.policy_mandate_mappings
referencing new table as new_mapping_rows
for each statement
execute function gov_repo.enforce_policy_mandate_mapping_insert();

create function gov_repo.enforce_policy_mandate_mapping_update()
returns trigger
language plpgsql
volatile
security invoker
set search_path = ''
as $function$
declare
  affected_mandate_ids uuid[];
begin
  select array_agg(
           distinct changed_mapping.mandate_id
           order by changed_mapping.mandate_id
         )
  into affected_mandate_ids
  from (
    select new_mapping.mandate_id
    from new_mapping_rows as new_mapping
    left join old_mapping_rows as old_mapping
      on old_mapping.mapping_id = new_mapping.mapping_id
    where old_mapping.mapping_id is null
       or new_mapping.policy_id is distinct from old_mapping.policy_id
       or new_mapping.mandate_id is distinct from old_mapping.mandate_id
       or new_mapping.organisation_id is distinct from old_mapping.organisation_id
  ) as changed_mapping;

  perform gov_repo.advance_mandate_mapping_guards(affected_mandate_ids);

  if exists (
    select 1
    from new_mapping_rows as mapping
    join gov_repo.mandates as mandate
      on mandate.mandate_id = mapping.mandate_id
    where mapping.mandate_id = any (affected_mandate_ids)
      and mandate.organisation_id is not null
      and mandate.organisation_id <> mapping.organisation_id
  ) then
    raise exception using
      errcode = '23514',
      message = 'Tenant-local mandate must belong to the governance policy tenant.';
  end if;

  return null;
end;
$function$;

create trigger trg_policy_mandate_mapping_guard_update
after update on gov_repo.policy_mandate_mappings
referencing old table as old_mapping_rows new table as new_mapping_rows
for each statement
execute function gov_repo.enforce_policy_mandate_mapping_update();

create function gov_repo.enforce_mandate_mapping_tenant_update()
returns trigger
language plpgsql
volatile
security invoker
set search_path = ''
as $function$
declare
  affected_mandate_ids uuid[];
begin
  select array_agg(
           distinct new_mandate.mandate_id
           order by new_mandate.mandate_id
         )
  into affected_mandate_ids
  from new_mandate_rows as new_mandate
  join old_mandate_rows as old_mandate
    on old_mandate.mandate_id = new_mandate.mandate_id
  where old_mandate.organisation_id is distinct from new_mandate.organisation_id;

  perform gov_repo.advance_mandate_mapping_guards(affected_mandate_ids);

  if exists (
    select 1
    from new_mandate_rows as mandate
    join old_mandate_rows as old_mandate
      on old_mandate.mandate_id = mandate.mandate_id
     and old_mandate.organisation_id is distinct from mandate.organisation_id
    join gov_repo.policy_mandate_mappings as mapping
      on mapping.mandate_id = mandate.mandate_id
    where mandate.organisation_id is not null
      and mapping.organisation_id <> mandate.organisation_id
  ) then
    raise exception using
      errcode = '23514',
      message = 'Mandate tenant would conflict with an existing policy-to-mandate mapping.';
  end if;

  return null;
end;
$function$;

create trigger trg_mandate_mapping_tenant_update
after update on gov_repo.mandates
referencing old table as old_mandate_rows new table as new_mandate_rows
for each statement
execute function gov_repo.enforce_mandate_mapping_tenant_update();

revoke all on table gov_repo.mandate_mapping_guards
  from public, anon, authenticated, service_role;

grant select, insert, update on table gov_repo.mandate_mapping_guards
  to service_role;

revoke all on function gov_repo.create_mandate_mapping_guard(),
  gov_repo.advance_mandate_mapping_guards(uuid[]),
  gov_repo.validate_explicit_policy_mandate_mapping_organisation(),
  gov_repo.derive_policy_mandate_mapping_tenant(),
  gov_repo.enforce_policy_mandate_mapping_insert(),
  gov_repo.enforce_policy_mandate_mapping_update(),
  gov_repo.enforce_mandate_mapping_tenant_update()
  from public, anon, authenticated, service_role;

grant execute on function gov_repo.create_mandate_mapping_guard(),
  gov_repo.advance_mandate_mapping_guards(uuid[]),
  gov_repo.validate_explicit_policy_mandate_mapping_organisation(),
  gov_repo.derive_policy_mandate_mapping_tenant(),
  gov_repo.enforce_policy_mandate_mapping_insert(),
  gov_repo.enforce_policy_mandate_mapping_update(),
  gov_repo.enforce_mandate_mapping_tenant_update()
  to service_role;

drop policy "Authenticated can read policy_mandate_mappings"
  on gov_repo.policy_mandate_mappings;

revoke all on table gov_repo.policy_mandate_mappings
  from public, anon, authenticated;

comment on column gov_repo.policy_mandate_mappings.organisation_id is
  'Identifier of the tenant organisation derived from the owning governance policy; it is not an independent tenant-authority claim.';

comment on table gov_repo.mandate_mapping_guards is
  'Private technical concurrency state used only to serialize policy-to-mandate relationship writes with mandate ownership changes; it carries no tenant ownership or governance authority.';

comment on column gov_repo.mandate_mapping_guards.mandate_id is
  'Mandate whose invariant-relevant writes share this technical serialization token; the identifier does not confer tenant or business authority.';

comment on column gov_repo.mandate_mapping_guards.guard_version is
  'Technical MVCC counter incremented only for concurrency serialization; it is not a business version and has no governance lifecycle or tenant-ownership semantics.';

comment on function gov_repo.create_mandate_mapping_guard() is
  'Creates the private technical serialization token required for a newly inserted mandate.';

comment on function gov_repo.advance_mandate_mapping_guards(uuid[]) is
  'Locks mandate serialization tokens in deterministic identifier order without waiting and performs one real MVCC counter update per distinct mandate.';

comment on function gov_repo.validate_explicit_policy_mandate_mapping_organisation() is
  'Fails fast when a caller-explicit mapping organisation differs from the protected tenant of the new governance policy.';

comment on function gov_repo.derive_policy_mandate_mapping_tenant() is
  'Protects the referenced policy key and derives mapping tenant ownership exclusively from the governance policy.';

comment on function gov_repo.enforce_policy_mandate_mapping_insert() is
  'Serializes and validates the mandates affected by one policy-to-mandate mapping insert statement.';

comment on function gov_repo.enforce_policy_mandate_mapping_update() is
  'Serializes and validates the mandates affected by relationship-changing rows in one policy-to-mandate mapping update statement.';

comment on function gov_repo.enforce_mandate_mapping_tenant_update() is
  'Serializes and validates mandate ownership changes against existing policy-to-mandate relationships.';

comment on trigger trg_create_mandate_mapping_guard
  on gov_repo.mandates is
  'Creates exactly one private technical serialization token for each newly inserted mandate.';

comment on trigger trg_00_policy_mandate_mapping_explicit_organisation
  on gov_repo.policy_mandate_mappings is
  'Validates caller-explicit organisation_id assignments before trg_policy_mandate_mapping_tenant derives the authoritative policy tenant; the trg_00 prefix makes this ordering deterministic.';

comment on trigger trg_policy_mandate_mapping_tenant
  on gov_repo.policy_mandate_mappings is
  'Derives mapping tenant ownership from the protected governance policy key before inserts or relationship- or ownership-relevant updates.';

comment on trigger trg_policy_mandate_mapping_guard_insert
  on gov_repo.policy_mandate_mappings is
  'Serializes distinct affected mandates in deterministic order and validates each inserted policy-to-mandate relationship.';

comment on trigger trg_policy_mandate_mapping_guard_update
  on gov_repo.policy_mandate_mappings is
  'Serializes distinct mandates affected by relationship changes and validates the resulting policy-to-mandate relationships.';

comment on trigger trg_mandate_mapping_tenant_update
  on gov_repo.mandates is
  'Serializes distinct mandate ownership changes and rejects changes that would make existing mappings cross-tenant.';

commit;
