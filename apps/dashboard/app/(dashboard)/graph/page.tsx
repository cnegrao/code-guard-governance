import { CanonicalGraph } from "@/components/graph/CanonicalGraph";
import { getGovernedGraph } from "@/lib/governance/intelligence-query";

export default async function GraphPage() {
  const graph = await getGovernedGraph();
  return (
    <div>
      <div className="mb-4">
        <h2 className="text-xl font-bold text-white">Governed Graph</h2>
        <p className="text-sm text-gray-400 mt-1">Read projection of canonical objects and relationships. PostgreSQL remains the system of record. Effective at {graph.asOf}; reads are not a transaction-wide snapshot.</p>
      </div>
      <CanonicalGraph graph={graph} />
    </div>
  );
}
