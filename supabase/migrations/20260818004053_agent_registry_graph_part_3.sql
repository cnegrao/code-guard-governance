create index idx_risk_prop_path on gov_repo.agent_risk_propagation using gin(propagation_path);
alter table gov_repo.agent_risk_propagation enable row level security;
create policy "Service role has full access to agent_risk_propagation" on gov_repo.agent_risk_propagation for all to service_role using(true) with check(true);
create policy "Org-scoped access to agent_risk_propagation" on gov_repo.agent_risk_propagation for select to authenticated using(organisation_id=(select organisation_id from gov_repo.governance_users where email=auth.email() limit 1));
create table gov_repo.agent_embeddings (
 embedding_id uuid primary key default uuid_generate_v4(), agent_id uuid not null references gov_repo.agents(agent_id) on delete cascade, embedding vector(1536) not null, embedding_dimensions integer not null default 1536 check(embedding_dimensions in (384,512,768,1024,1536)), content_text text not null, content_hash char(64) not null, model_name varchar(100) not null, model_version varchar(50), model_is_local boolean not null default false, model_provider varchar(100), generated_at timestamptz not null default now(), is_current boolean not null default true, organisation_id uuid not null references gov_repo.organisations(organisation_id));
comment on table gov_repo.agent_embeddings is '[C1] Vector embeddings for AI agents. Foundation for Talk-to-Governance. vector(1536): pgvector HNSW max = 2000 dims. 1536 covers all banking-relevant models. embedding_dimensions: actual model output size. App zero-pads smaller models to 1536. Do NOT compare embeddings across different model_name values. [C3] Uniqueness on (agent_id) WHERE is_current = true via partial unique index.';
comment on column gov_repo.agent_embeddings.embedding_dimensions is 'Actual embedding dimensions from the model. Used to compute correct similarity. Do NOT compare embeddings from different models directly — always filter by model_name.';
create unique index idx_agent_embeddings_one_current on gov_repo.agent_embeddings(agent_id) where is_current=true;
create index idx_agent_embeddings_hnsw on gov_repo.agent_embeddings using hnsw(embedding vector_cosine_ops) with(m=16,ef_construction=64);
create index idx_agent_embeddings_agent on gov_repo.agent_embeddings(agent_id);
create index idx_agent_embeddings_org on gov_repo.agent_embeddings(organisation_id);
create index idx_agent_embeddings_model on gov_repo.agent_embeddings(model_name,embedding_dimensions);
alter table gov_repo.agent_embeddings enable row level security;
create policy "Service role has full access to agent_embeddings" on gov_repo.agent_embeddings for all to service_role using(true) with check(true);
create policy "Org-scoped access to agent_embeddings" on gov_repo.agent_embeddings for select to authenticated using(organisation_id=(select organisation_id from gov_repo.governance_users where email=auth.email() limit 1));
create or replace function gov_repo.agent_graph_traverse(p_root_agent_id uuid,p_max_depth integer default 5,p_edge_types gov_repo.edge_relationship[] default null,p_active_only boolean default true)
returns table(agent_id uuid,agent_code varchar,agent_name varchar,agent_type gov_repo.agent_type,risk_level gov_repo.agent_risk_level,depth integer,path uuid[],path_labels text[],cumulative_weight numeric,edge_types_used text[])
language sql security definer as $$
with recursive agent_graph as (
 select a.agent_id,a.agent_code,a.name as agent_name,a.agent_type,a.risk_level,0 as depth,array[a.agent_id] as path,array[a.name::text] as path_labels,1.0::numeric as cumulative_weight,array[]::text[] as edge_types_used from gov_repo.agents a where a.agent_id=p_root_agent_id
 union all
 select a.agent_id,a.agent_code,a.name,a.agent_type,a.risk_level,ag.depth+1,ag.path||a.agent_id,ag.path_labels||a.name,round((ag.cumulative_weight*e.weight)::numeric,6),ag.edge_types_used||e.relationship_type::text from agent_graph ag join gov_repo.agent_edges e on e.source_agent_id=ag.agent_id and (not p_active_only or e.is_active=true) and (p_edge_types is null or e.relationship_type=any(p_edge_types)) join gov_repo.agents a on a.agent_id=e.target_agent_id and (not p_active_only or a.status='active') where ag.depth<p_max_depth and not(a.agent_id=any(ag.path))
) select * from agent_graph where depth>0 order by depth asc,cumulative_weight desc; $$;
comment on function gov_repo.agent_graph_traverse is 'Recursive CTE graph traversal. Finds all agents reachable from a root. Cycle-safe via path array membership check. Returns depth, full path, cumulative edge weight (critical for risk propagation). Example — find all supervised agents: SELECT * FROM gov_repo.agent_graph_traverse(id, 5, ''{SUPERVISES}'');';
create or replace function gov_repo.recompute_risk_propagation(p_organisation_id uuid,p_source_agent_id uuid default null)
returns integer language plpgsql security definer as $$
declare v_agent record; v_traversal record; v_count integer := 0; v_risk_score numeric;
begin
 update gov_repo.agent_risk_propagation set is_active=false,invalidated_reason='recomputed' where organisation_id=p_organisation_id and (p_source_agent_id is null or risk_source_agent_id=p_source_agent_id);
 for v_agent in select agent_id,risk_level from gov_repo.agents where organisation_id=p_organisation_id and status='active' and (p_source_agent_id is null or agent_id=p_source_agent_id) and risk_level in ('critical','high','medium') loop
  v_risk_score := case v_agent.risk_level when 'critical' then 1.0 when 'high' then 0.75 when 'medium' then 0.5 else 0.25 end;
  for v_traversal in select * from gov_repo.agent_graph_traverse(v_agent.agent_id,10,null,true) loop
   insert into gov_repo.agent_risk_propagation(risk_source_agent_id,affected_agent_id,propagation_path,propagation_type,impact_score,agents_in_chain,is_active,computed_at,organisation_id)
   values(v_agent.agent_id,v_traversal.agent_id,v_traversal.path,case when v_traversal.depth=1 then 'direct'::gov_repo.propagation_type when v_traversal.depth<=3 then 'indirect'::gov_repo.propagation_type else 'cascading'::gov_repo.propagation_type end,round((v_risk_score*v_traversal.cumulative_weight)::numeric,4),array_length(v_traversal.path,1),true,now(),p_organisation_id)
   on conflict(risk_source_agent_id,affected_agent_id) do update set propagation_path=excluded.propagation_path,propagation_type=excluded.propagation_type,impact_score=excluded.impact_score,agents_in_chain=excluded.agents_in_chain,is_active=true,computed_at=now(); v_count:=v_count+1;
  end loop;
 end loop; return v_count;
end; $$;
comment on function gov_repo.recompute_risk_propagation is 'Recomputes the full risk propagation matrix. impact_score = risk × edge_weight_product. Returns count of records created/updated. Call after: agent risk change, edge add/remove. criticality column is auto-updated by trigger trg_propagation_criticality [FIX-1].';;
