import { CanonicalGraph } from "@/components/graph/CanonicalGraph";
import { getGovernedGraph } from "@/lib/governance/intelligence-query";
import { readCanonicalSourceNames, readCanonicalVersionParents } from '@/lib/governance/source-name-query';

export default async function GraphPage() {
  const graph = await getGovernedGraph();
  const [sourceNames, versionParents] = await Promise.all([
    readCanonicalSourceNames(graph.organisationId, graph.nodes.map(node => ({ objectId: node.canonicalObjectId, kind: node.canonicalObjectKind })), graph.asOf),
    readCanonicalVersionParents(graph.organisationId, graph.nodes.filter(node => node.canonicalObjectKind === 'AGENT_VERSION').map(node => node.canonicalObjectId), graph.asOf),
  ]);
  return (
    <div>
      <div className="mb-4">
        <h2 className="text-xl font-bold text-white">Governed Graph</h2>
        <p className="text-sm text-gray-400 mt-1">Read projection of canonical objects and relationships. PostgreSQL remains the system of record. Effective at {graph.asOf}; reads are not a transaction-wide snapshot.</p>
      </div>
      <CanonicalGraph graph={graph} sourceNames={sourceNames} versionParents={versionParents} />
    </div>
  );
}
