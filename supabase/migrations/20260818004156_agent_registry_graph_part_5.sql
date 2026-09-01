comment on view gov_repo.v_agents_without_ai_system is '[C2] AI Act compliance gap: agents not associated with an AI System. EU AI Act regulates at AI System level (Art. 3.1), not individual agent level. All agents must be linked to an ai_system_id before passing conformity assessment. FK will be enforced in Migration 006 when gov_repo.ai_systems is created.';
grant execute on function gov_repo.agent_graph_traverse to service_role,authenticated;
grant execute on function gov_repo.recompute_risk_propagation to service_role;
grant execute on function gov_repo.agent_semantic_search to service_role,authenticated;
grant execute on function gov_repo.agent_compliance_gaps to service_role,authenticated;
grant execute on function gov_repo.update_agent_compliance_flags to service_role;
grant execute on function gov_repo.set_propagation_criticality to service_role;;
