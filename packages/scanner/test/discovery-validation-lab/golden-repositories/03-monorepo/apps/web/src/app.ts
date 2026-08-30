export interface AgentRecordView {
  readonly label: string;
  readonly status: "active" | "inactive";
}

export function renderAgentDirectory(
  records: readonly AgentRecordView[],
): string {
  return records.map((record) => `${record.label}:${record.status}`).join("\n");
}
