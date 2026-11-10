"use client";
import { useCallback, useEffect, useState } from "react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import type { ReviewTechnicalProfile } from "@/lib/governance/technical-profile-materialization";

export function TechnicalProfileMaterialization({ reviewSubjectId }: { reviewSubjectId: string }) {
  const [context, setContext] = useState<ReviewTechnicalProfile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const endpoint = `/api/governance/workspace/reviews/${encodeURIComponent(reviewSubjectId)}/technical-profile`;
  const load = useCallback(async () => {
    try {
      const response = await fetch(endpoint);
      if (!response.ok) throw new Error("Unable to read the technical profile proposal.");
      setContext(await response.json());
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to read profile."); }
  }, [endpoint]);
  useEffect(() => { void load(); }, [load]);
  async function materialize() {
    setBusy(true); setError(null);
    try {
      const response = await fetch(endpoint, { method: "POST" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? result.reason ?? "Materialization rejected.");
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Materialization rejected."); }
    finally { setBusy(false); }
  }
  return <Card>
    <h3 className="font-semibold text-white">Technical profile · AgentVersion</h3>
    <p className="mt-2 text-sm text-gray-300">Separate from canonical identity. The existing human certification must cover this exact proposal and all its evidence. Source trust is preserved.</p>
    {error && <p role="alert" className="mt-2 text-sm text-danger">{error}</p>}
    {!context && !error && <p className="mt-2 text-sm text-gray-300">Loading proposal…</p>}
    {context?.status === "UNAVAILABLE" && <p className="mt-2 text-sm text-gray-300">{context.reason}</p>}
    {context?.values && <>
      <p className="mt-2 text-sm text-gray-300">{context.status === "APPLIED" ? "Materialized profile" : "Proposed values — not canonical facts"}</p>
      <dl className="mt-2 break-words text-sm text-gray-300">
        <dt>Runtime framework</dt><dd>{context.values.runtimeFrameworkReference ?? "UNKNOWN"}</dd>
        <dt>Build</dt><dd>{context.values.buildReference ?? "UNKNOWN"}</dd>
        <dt>Entrypoint</dt><dd>{context.values.entrypointReference ?? "UNKNOWN"}</dd>
        <dt>Configuration</dt><dd>{context.values.configurationReference ?? "UNKNOWN"}</dd>
      </dl>
      <details className="mt-2 break-all text-xs text-gray-300"><summary>Proposal and version identifiers</summary><p>{context.proposalId}</p><p>{context.canonicalVersionId}</p></details>
    </>}
    {context?.status === "READY" && <Button className="mt-4" loading={busy} onClick={materialize}>Materialize technical profile</Button>}
    {context?.status === "APPLIED" && <p role="status" className="mt-3 text-sm text-gray-200">Technical profile applied. Select this AgentVersion in the Passport to inspect Technology &amp; Build.</p>}
  </Card>;
}
