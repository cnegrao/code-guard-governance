import { AgentTable } from "@/components/agents/AgentTable";
import Link from "next/link";

export default function AgentsPage() {
  return (
    <div>
      <div className="mb-6">
        <h2 className="text-xl font-bold text-white">Agents</h2>
        <p className="text-sm text-gray-400 mt-1">
          Legacy operational agent inventory and compliance status
        </p>
        <Link href="/agents/canonical" className="mt-2 inline-block text-sm text-primary underline">
          Browse governed canonical Agent Passports
        </Link>
      </div>
      <AgentTable />
    </div>
  );
}
