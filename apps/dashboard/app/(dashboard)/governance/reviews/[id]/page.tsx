"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { StateBadge } from "@/components/workspace/StateBadge";

interface EvidenceHash {
  algorithm: string;
  value: string;
}
interface EvidenceLocation {
  kind: string;
  locator: string;
  path?: string;
  commit?: string;
  symbol?: string;
  lineStart?: number;
  lineEnd?: number;
}
interface EvidencePresentation {
  evidenceId: string;
  handling: "HASH_ONLY" | "REDACTED" | "NON_SENSITIVE";
  capturedAt: string;
  hashes: EvidenceHash[];
  locations: EvidenceLocation[];
  redactedExcerpt?: string;
}
interface SourceAssertionPresentation {
  assertionId: string;
  runId: string;
  sourceConnectionId: string;
  sourceExternalType: string;
  sourceExternalId: string;
  methodCode: string;
  methodVersion?: string;
  trustState: string;
  confidence?: number;
  observedAt: string;
  recordedAt: string;
}
interface AcquisitionRunSummary {
  runId: string;
  sourceConnectionId: string;
  sourceSystemId: string;
  adapterName: string;
  adapterVersion: string;
  mode: string;
  status: string;
  startedAt: string;
  completedAt?: string;
}
interface GovernanceHistoryEntry {
  eventId: string;
  previousState: string;
  newState: string;
  actorKind: "HUMAN" | "DETERMINISTIC_RULE";
  actorReference?: string;
  actorRuleCode?: string;
  actorRuleVersion?: string;
  occurredAt: string;
  reasonCode?: string;
}
interface AllowedGovernanceActions {
  canPropose: boolean;
  canConfirm: boolean;
  canCertify: boolean;
  canReject: boolean;
}
interface ReviewSubjectDetail {
  reviewSubjectId: string;
  candidateKind: string;
  state: string;
  findingId: string;
  sourceConnectionId: string;
  sourceExternalType: string;
  sourceExternalId: string;
  detectedAt: string;
  evidence: EvidencePresentation[];
  assertions: SourceAssertionPresentation[];
  acquisitionRuns: AcquisitionRunSummary[];
  history: GovernanceHistoryEntry[];
  allowedActions: AllowedGovernanceActions;
}

function formatTimestamp(value: string): string {
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
}

type PendingAction = "PROPOSE" | "CONFIRM" | "CERTIFY" | "REJECT" | null;

export default function ReviewSubjectDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const reviewSubjectId = params.id;

  const [detail, setDetail] = useState<ReviewSubjectDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);

  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const [reasonCode, setReasonCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [staleNotice, setStaleNotice] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setNotFound(false);
    try {
      const res = await fetch(`/api/governance/workspace/reviews/${encodeURIComponent(reviewSubjectId)}`);
      if (res.status === 404) {
        setNotFound(true);
        return;
      }
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Unable to load this review subject.");
      }
      setDetail(await res.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load this review subject.");
    } finally {
      setLoading(false);
    }
  }, [reviewSubjectId]);

  useEffect(() => {
    load();
  }, [load]);

  async function submitAction(action: Exclude<PendingAction, null>, reason?: string) {
    if (!detail) return;
    setSubmitting(true);
    setActionError(null);
    setStaleNotice(false);
    try {
      const res = await fetch(`/api/governance/workspace/reviews/${encodeURIComponent(reviewSubjectId)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, expectedState: detail.state, reasonCode: reason }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.status === 409 && body.outcome === "STALE_REVIEW_SUBJECT") {
        setStaleNotice(true);
        await load();
        return;
      }
      if (!res.ok) {
        throw new Error(body.error ?? "Unable to process this action.");
      }
      setPendingAction(null);
      setReasonCode("");
      await load();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Unable to process this action.");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) return <Spinner className="py-12" />;

  if (notFound) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-400 mb-4">This review subject was not found.</p>
        <Button variant="secondary" onClick={() => router.push("/governance/reviews")}>Back to Queue</Button>
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-12">
        <p className="text-danger mb-4">{error}</p>
        <Button variant="secondary" onClick={() => load()}>Retry</Button>
      </div>
    );
  }

  if (!detail) return null;

  const requiresReason = pendingAction === "CERTIFY" || pendingAction === "REJECT";

  return (
    <div className="max-w-5xl">
      <div className="mb-6 flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <h2 className="text-xl font-bold text-white">{detail.candidateKind}</h2>
            <StateBadge state={detail.state} />
          </div>
          <p className="text-sm text-gray-400">{detail.sourceExternalId}</p>
        </div>
        <Button variant="ghost" size="sm" onClick={() => router.push("/governance/reviews")}>Back to Queue</Button>
      </div>

      {staleNotice && (
        <Card className="mb-4 border-warning/40">
          <p className="text-sm text-warning">
            This review subject changed since it was loaded. It has been refreshed below — please review the current
            state before acting again.
          </p>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <Card>
            <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-wide mb-4">Identity &amp; Provenance</h3>
            <dl className="grid grid-cols-2 gap-y-3 text-sm">
              <dt className="text-gray-500">Finding</dt>
              <dd className="text-gray-200 break-all">{detail.findingId}</dd>
              <dt className="text-gray-500">Source connection</dt>
              <dd className="text-gray-200">{detail.sourceConnectionId}</dd>
              <dt className="text-gray-500">Source identity</dt>
              <dd className="text-gray-200 break-all">{detail.sourceExternalType} · {detail.sourceExternalId}</dd>
              <dt className="text-gray-500">Detected</dt>
              <dd className="text-gray-200">{formatTimestamp(detail.detectedAt)}</dd>
            </dl>

            {detail.acquisitionRuns.length > 0 && (
              <div className="mt-4 pt-4 border-t border-border-dark/50">
                <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Acquisition Runs</h4>
                <div className="space-y-2">
                  {detail.acquisitionRuns.map((run) => (
                    <div key={run.runId} className="text-xs text-gray-400">
                      <span className="text-gray-300">{run.adapterName} v{run.adapterVersion}</span> · {run.mode} ·{" "}
                      <span className={run.status === "SUCCEEDED" ? "text-success" : run.status === "FAILED" ? "text-danger" : "text-warning"}>
                        {run.status}
                      </span>{" "}
                      · started {formatTimestamp(run.startedAt)}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {detail.candidateKind === "RELATIONSHIP" && (
              <div className="mt-4 pt-4 border-t border-border-dark/50">
                <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Relationship</h4>
                <p className="text-xs text-gray-500">
                  This is a relationship finding. Endpoint-level lineage is materialized only after certification and
                  reconciliation, so it is not yet available for a pre-certification review subject.
                </p>
              </div>
            )}
          </Card>

          <Card>
            <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-wide mb-4">
              Evidence ({detail.evidence.length})
            </h3>
            {detail.evidence.length === 0 && <p className="text-sm text-gray-500">No evidence recorded.</p>}
            <div className="space-y-3">
              {detail.evidence.map((item) => (
                <div key={item.evidenceId} className="p-3 rounded-lg bg-white/5 border border-border-dark/50">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs text-gray-500">{item.evidenceId}</span>
                    <span className="text-xs px-2 py-0.5 rounded bg-gray-500/20 text-gray-300">{item.handling}</span>
                  </div>
                  <div className="text-xs text-gray-400 mb-1">Captured {formatTimestamp(item.capturedAt)}</div>
                  {item.hashes.length > 0 && (
                    <div className="text-xs text-gray-500 break-all">
                      {item.hashes.map((h) => `${h.algorithm}:${h.value}`).join(", ")}
                    </div>
                  )}
                  {item.locations.length > 0 && (
                    <div className="text-xs text-gray-500 mt-1">
                      {item.locations.map((loc, idx) => (
                        <div key={idx}>
                          {loc.kind}{loc.path ? ` · ${loc.path}` : ""}{loc.lineStart ? `:${loc.lineStart}${loc.lineEnd ? `-${loc.lineEnd}` : ""}` : ""}
                        </div>
                      ))}
                    </div>
                  )}
                  {item.redactedExcerpt && (
                    <pre className="text-xs text-gray-400 mt-2 whitespace-pre-wrap bg-black/30 p-2 rounded">
                      {item.redactedExcerpt}
                    </pre>
                  )}
                </div>
              ))}
            </div>
          </Card>

          <Card>
            <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-wide mb-4">
              Source Assertions ({detail.assertions.length})
            </h3>
            {detail.assertions.length === 0 && <p className="text-sm text-gray-500">No source assertions recorded.</p>}
            <div className="space-y-3">
              {detail.assertions.map((assertion) => (
                <div key={assertion.assertionId} className="p-3 rounded-lg bg-white/5 border border-border-dark/50 text-xs">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-gray-300">{assertion.methodCode}{assertion.methodVersion ? ` v${assertion.methodVersion}` : ""}</span>
                    <span className="text-gray-500">{assertion.trustState}{assertion.confidence !== undefined ? ` · ${(assertion.confidence * 100).toFixed(0)}%` : ""}</span>
                  </div>
                  <div className="text-gray-500">Observed {formatTimestamp(assertion.observedAt)}</div>
                </div>
              ))}
            </div>
          </Card>

          <Card>
            <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-wide mb-4">Governance History</h3>
            {detail.history.length === 0 && <p className="text-sm text-gray-500">No transitions recorded yet.</p>}
            <div className="space-y-3">
              {detail.history.map((event) => (
                <div key={event.eventId} className="flex items-start gap-3 text-xs">
                  <div className="w-2 h-2 rounded-full bg-primary mt-1.5 shrink-0" />
                  <div>
                    <div className="text-gray-300">
                      {event.previousState} → {event.newState}
                    </div>
                    <div className="text-gray-500">
                      {event.actorKind === "HUMAN" ? `by ${event.actorReference}` : `by rule ${event.actorRuleCode} v${event.actorRuleVersion}`}
                      {" · "}
                      {formatTimestamp(event.occurredAt)}
                    </div>
                    {event.reasonCode && <div className="text-gray-500 italic mt-0.5">"{event.reasonCode}"</div>}
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>

        <div>
          <Card>
            <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-wide mb-4">Governance Actions</h3>

            {!detail.allowedActions.canPropose &&
              !detail.allowedActions.canConfirm &&
              !detail.allowedActions.canCertify &&
              !detail.allowedActions.canReject && (
                <p className="text-sm text-gray-500">No governance actions are currently available to you for this item.</p>
              )}

            {actionError && <p className="text-sm text-danger mb-3">{actionError}</p>}

            {pendingAction && requiresReason ? (
              <div className="space-y-3">
                <label className="block text-sm text-gray-300">Reason</label>
                <textarea
                  className="w-full px-3 py-2 bg-surface-dark border border-border-dark rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                  rows={3}
                  value={reasonCode}
                  onChange={(e) => setReasonCode(e.target.value)}
                  placeholder="Explain the basis for this decision"
                />
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant={pendingAction === "REJECT" ? "danger" : "primary"}
                    loading={submitting}
                    disabled={reasonCode.trim().length === 0}
                    onClick={() => submitAction(pendingAction, reasonCode.trim())}
                  >
                    Confirm {pendingAction === "CERTIFY" ? "Certify" : "Reject"}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => { setPendingAction(null); setReasonCode(""); }}>
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                {detail.allowedActions.canPropose && (
                  <Button className="w-full" variant="secondary" loading={submitting} onClick={() => submitAction("PROPOSE")}>
                    Propose
                  </Button>
                )}
                {detail.allowedActions.canConfirm && (
                  <Button className="w-full" loading={submitting} onClick={() => submitAction("CONFIRM")}>
                    Confirm
                  </Button>
                )}
                {detail.allowedActions.canCertify && (
                  <Button className="w-full" loading={submitting} onClick={() => setPendingAction("CERTIFY")}>
                    Certify
                  </Button>
                )}
                {detail.allowedActions.canReject && (
                  <Button className="w-full" variant="danger" loading={submitting} onClick={() => setPendingAction("REJECT")}>
                    Reject
                  </Button>
                )}
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
