grant usage on schema gov_repo to service_role;
grant all privileges on all tables in schema gov_repo to service_role;
grant all privileges on all sequences in schema gov_repo to service_role;
grant all privileges on all routines in schema gov_repo to service_role;
alter default privileges for role postgres in schema gov_repo grant all privileges on tables to service_role;
alter default privileges for role postgres in schema gov_repo grant all privileges on sequences to service_role;
alter default privileges for role postgres in schema gov_repo grant all privileges on routines to service_role;;
