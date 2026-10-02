import Link from "next/link";
export default function ReportsPage() {
  return <div className="space-y-4">
    <h2 className="text-xl font-bold text-white">Reports — NOT_ASSESSED</h2>
    <p className="text-gray-400">Regulatory exports are unavailable for this demo. Legacy inventory and heuristic scores do not establish AI Act or DORA compliance, board-ready regulatory assurance, or governed certification.</p>
    <p className="text-gray-400">Review actual governed decisions and their audit evidence in the governance workspace.</p>
    <Link href="/governance" className="text-primary">Open Governance</Link>
  </div>;
}
