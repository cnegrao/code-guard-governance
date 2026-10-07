"use client";

import { useState, useEffect } from "react";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Spinner } from "@/components/ui/Spinner";
import Link from "next/link";

interface DiscoveredAgent {
  agent_id: string;
  agent_code: string;
  name: string;
  agent_type: string;
  risk_level: string;
  status: string;
  business_domain?: string;
  external_refs?: {
    discovery?: {
      provider: string;
      repository: string;
      filePath: string;
      framework: string;
      confidence: number;
    };
  };
  created_at: string;
}

export default function DiscoveryPage() {
  const [provider, setProvider] = useState("github");
  const [owner, setOwner] = useState("");
  const [repo, setRepo] = useState("");
  const [branch, setBranch] = useState("main");
  const [scanning, setScanning] = useState(false);
  const [result, setResult] = useState<string>("");
  const [pending, setPending] = useState<DiscoveredAgent[]>([]);
  const [approved, setApproved] = useState<DiscoveredAgent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function loadDiscovered() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/discovery/review");
      if (!res.ok) throw new Error("Inventory read failed");
      const data = await res.json();
      setPending(data.pending ?? []);
      setApproved(data.inventory ?? []);
    } catch { setError("ERROR: Inventory could not be read"); }
    setLoading(false);
  }

  useEffect(() => { void loadDiscovered(); }, []);

  async function startScan() {
    if (!owner || !repo) return;
    setScanning(true);
    setResult("");
    try {
      const res = await fetch("/api/discovery/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, owner, repo, branch }),
      });
      const data = await res.json();
      if (res.ok) {
        setResult(`✓ ${data.message}`);
        loadDiscovered();
      } else {
        setResult(`✗ ${data.error}`);
      }
    } catch {
      setResult("✗ Scan failed");
    }
    setScanning(false);
  }

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-xl font-bold text-white">Repository Discovery</h2>
        <p className="text-sm text-gray-400 mt-1">Source intelligence writes operational inventory only. Automated governed ingestion is NOT ACTIVE; canonical decisions remain in human Governance Review.</p>
      </div>

      <Card className="mb-6">
        <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-wide mb-4">Scan Repository</h3>
        <div className="grid grid-cols-4 gap-3 mb-4">
          <Select
            options={[
              { value: "github", label: "GitHub" },
              { value: "gitlab", label: "GitLab" },
              { value: "bitbucket", label: "Bitbucket" },
            ]}
            value={provider}
            onChange={(e) => setProvider(e.target.value)}
          />
          <Input placeholder="Owner/Org" value={owner} onChange={(e) => setOwner(e.target.value)} />
          <Input placeholder="Repository" value={repo} onChange={(e) => setRepo(e.target.value)} />
          <Input placeholder="Branch (main)" value={branch} onChange={(e) => setBranch(e.target.value)} />
        </div>
        <div className="flex items-center gap-3">
          <Button onClick={startScan} loading={scanning}>Scan Repository</Button>
          {result && <span className={`text-sm ${result.startsWith("✓") ? "text-success" : "text-danger"}`}>{result}</span>}
        </div>
      </Card>

      {error && <p role="alert" className="text-danger">{error}</p>}
      {!error && !loading && <div className="grid grid-cols-2 gap-4 mb-6">
        <Card>
          <h3 className="text-sm font-semibold text-gray-300 mb-2">Detected inventory</h3>
          <div className="text-3xl font-bold text-warning">{pending.length}</div>
        </Card>
        <Card>
          <h3 className="text-sm font-semibold text-gray-300 mb-2">Existing legacy inventory</h3>
          <div className="text-3xl font-bold text-success">{approved.length}</div>
        </Card>
      </div>}
      {loading && <Spinner className="py-6" />}

      {!loading && !error && pending.length === 0 && approved.length === 0 && (
        <div className="text-center py-12">
          <p className="text-gray-500">No agents discovered yet.</p>
          <p className="text-sm text-gray-600 mt-1">Scan a repository to discover AI agents and systems.</p>
        </div>
      )}

      {!error && !loading && pending.length > 0 && (
        <div className="mb-6">
          <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-wide mb-3">Detected inventory ({pending.length})</h3>
          <div className="space-y-2">
            {pending.map((a) => (
              <Card key={a.agent_id} className="flex items-center justify-between">
                <div>
                  <div className="text-sm text-white">{a.name}</div>
                  <div className="text-xs text-gray-500 mt-0.5">
                    {a.external_refs?.discovery?.framework ?? a.agent_type} · {a.external_refs?.discovery?.repository} · {a.external_refs?.discovery?.filePath}
                  </div>
                  <div className="flex items-center gap-2 mt-1">
                    <Badge variant={a.risk_level as "critical"|"high"|"medium"|"low"}>{a.risk_level}</Badge>
                    <Badge variant="registered">{a.agent_type}</Badge>
                    {a.business_domain && <Badge variant="registered">{a.business_domain}</Badge>}
                  </div>
                </div>
                <div className="flex gap-2">
                  <Link href={`/agents/${a.agent_id}`}><Button size="sm" variant="ghost">View</Button></Link>
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}

      {!error && !loading && approved.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-wide mb-3">Existing legacy inventory ({approved.length})</h3>
          <div className="space-y-2">
            {approved.map((a) => (
              <Card key={a.agent_id} className="flex items-center justify-between">
                <div>
                  <div className="text-sm text-white">{a.name}</div>
                  <div className="text-xs text-gray-500 mt-0.5">
                    {a.external_refs?.discovery?.framework} · {a.external_refs?.discovery?.repository}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="proposed">Legacy: {a.status}</Badge>
                  <Link href={`/agents/${a.agent_id}`}><Button size="sm" variant="ghost">View</Button></Link>
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
