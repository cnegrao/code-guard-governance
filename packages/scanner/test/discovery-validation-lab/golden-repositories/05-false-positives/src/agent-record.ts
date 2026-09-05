export interface AgentRecord {
  readonly agentId: string;
  readonly assignedTeam: string;
}

export function formatAgentRecord(record: AgentRecord): string {
  return `${record.agentId}:${record.assignedTeam}`;
}
