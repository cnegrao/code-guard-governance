"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { StateBadge } from "@/components/workspace/StateBadge";
import { LifecycleStepper, type LifecycleStage, type LifecycleStageStatus } from "@/components/workspace/LifecycleStepper";

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

interface CanonicalObjectMatchCandidate {
  canonicalObjectId: string;
  kind: string;
  createdAt: string;
  sourceMappings: { connectionId: string; externalType: string; externalId: string }[];
}
interface ReconciliationDecisionSummary {
  reconciliationDecisionId: string;
  family: string;
  outcome: string;
  decidedAt: string;
  actorReference: string;
  reasonCode: string;
  canonicalObject?: { objectId: string; kind: string };
}
interface MaterializationSummary {
  status: string;
  outcome: string;
  family: string;
  canonicalObjectId?: string;
  relationshipId?: string;
  appliedAt?: string;
  failureClassification?: string;
}
interface GovernanceDecisionDetail {
  reviewSubjectId: string;
  candidateKind: string;
  readiness: { ready: boolean; reason: string };
  availableOutcomes: string[];
  matchCandidates?: CanonicalObjectMatchCandidate[];
  reconciliation?: ReconciliationDecisionSummary;
  materialization?: MaterializationSummary;
}

const READINESS_REASON_TEXT: Record<string, string> = {
  READY: "Ready for reconciliation.",
  NOT_CERTIFIED: "This review subject is not yet CERTIFIED.",
  FINDING_ONLY: "No trustworthy normalized object identity is currently available from Discovery.",
  INPUT_UNAVAILABLE: "The original discovery input for this review subject is no longer available.",
  ALREADY_RECONCILED: "A reconciliation decision has already been recorded for this review subject.",
  ALREADY_MATERIALIZED: "This review subject has already been materialized into governed canonical state.",
};

function computeLifecycleStages(detail: ReviewSubjectDetail, decision: GovernanceDecisionDetail | null): LifecycleStage[] {
  const state = detail.state;
  const discovery: LifecycleStage = { label: "Discovery", status: "COMPLETED" };
  const review: LifecycleStage = { label: "Review", status: state === "DETECTED" ? "AVAILABLE" : "COMPLETED" };

  if (state === "REJECTED") {
    return [
      discovery,
      review,
      { label: "Certification", status: "NOT_APPLICABLE", detail: "This review subject was rejected." },
      { label: "Input Readiness", status: "NOT_APPLICABLE" },
      { label: "Authorization", status: "NOT_APPLICABLE" },
      { label: "Reconciliation", status: "NOT_APPLICABLE" },
      { label: "Materialization", status: "NOT_APPLICABLE" },
      { label: "Governed", status: "NOT_APPLICABLE" },
    ];
  }

  const certification: LifecycleStage = {
    label: "Certification",
    status: state === "CERTIFIED" ? "COMPLETED" : "PENDING",
  };

  if (!decision || state !== "CERTIFIED") {
    return [
      discovery,
      review,
      certification,
      { label: "Input Readiness", status: "NOT_STARTED" },
      { label: "Authorization", status: "NOT_STARTED" },
      { label: "Reconciliation", status: "NOT_STARTED" },
      { label: "Materialization", status: "NOT_STARTED" },
      { label: "Governed", status: "NOT_STARTED" },
    ];
  }

  const hasDecision = !!decision.reconciliation;
  const inputReadinessStatus: LifecycleStageStatus =
    decision.readiness.ready || hasDecision
      ? "COMPLETED"
      : decision.readiness.reason === "FINDING_ONLY" || decision.readiness.reason === "INPUT_UNAVAILABLE"
        ? "NOT_APPLICABLE"
        : "UNAVAILABLE";

  const authAndReconciliationStatus: LifecycleStageStatus = hasDecision
    ? "COMPLETED"
    : decision.readiness.ready
      ? "AVAILABLE"
      : inputReadinessStatus === "NOT_APPLICABLE"
        ? "NOT_APPLICABLE"
        : "UNAVAILABLE";

  const materializable =
    hasDecision && (decision.reconciliation!.outcome === "CREATE_NEW" || decision.reconciliation!.outcome === "MATCH_EXISTING");
  const materializationStatus: LifecycleStageStatus =
    decision.materialization?.status === "APPLIED"
      ? "COMPLETED"
      : materializable
        ? "AVAILABLE"
        : hasDecision
          ? "NOT_APPLICABLE"
          : "NOT_STARTED";

  const governedStatus: LifecycleStageStatus = decision.materialization?.status === "APPLIED" ? "COMPLETED" : "NOT_STARTED";

  return [
    discovery,
    review,
    certification,
    { label: "Input Readiness", status: inputReadinessStatus, detail: decision.readiness.reason },
    { label: "Authorization", status: authAndReconciliationStatus },
    { label: "Reconciliation", status: authAndReconciliationStatus, detail: decision.reconciliation?.outcome },
    { label: "Materialization", status: materializationStatus },
    { label: "Governed", status: governedStatus },
  ];
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

  const [decision, setDecision] = useState<GovernanceDecisionDetail | null>(null);
  const [decisionOutcome, setDecisionOutcome] = useState<string | null>(null);
  const [matchTarget, setMatchTarget] = useState<string | null>(null);
  const [decisionReason, setDecisionReason] = useState("");
  const [submittingDecision, setSubmittingDecision] = useState(false);
  const [decisionError, setDecisionError] = useState<string | null>(null);
  const [materializing, setMaterializing] = useState(false);
  const [materializeError, setMaterializeError] = useState<string | null>(null);

  const loadDecision = useCallback(async () => {
    try {
      const res = await fetch(`/api/governance/workspace/reviews/${encodeURIComponent(reviewSubjectId)}/decision`);
      if (!res.ok) {
        setDecision(null);
        return;
      }
      setDecision(await res.json());
    } catch {
      setDecision(null);
    }
  }, [reviewSubjectId]);

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
      await loadDecision();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load this review subject.");
    } finally {
      setLoading(false);
    }
  }, [reviewSubjectId, loadDecision]);

  useEffect(() => {
    load();
  }, [load]);

  async function submitDecision() {
    if (!decisionOutcome) return;
    setSubmittingDecision(true);
    setDecisionError(null);
    try {
      const res = await fetch(`/api/governance/workspace/reviews/${encodeURIComponent(reviewSubjectId)}/decision`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requestedOutcome: decisionOutcome,
          matchCanonicalObjectId: decisionOutcome === "MATCH_EXISTING" ? matchTarget : undefined,
          reasonCode: decisionReason,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        // A 409 (NOT_READY/ALREADY_RECONCILED/ALREADY_MATERIALIZED, or a
        // persistence conflict) means the screen's belief about readiness is
        // stale — another operator (or tab) already acted. Refresh so the
        // lifecycle view shows the current truth instead of leaving the
        // outcome form visibly stuck.
        if (res.status === 409) await loadDecision();
        throw new Error(body.error ?? "Unable to record this reconciliation decision.");
      }
      setDecisionOutcome(null);
      setMatchTarget(null);
      setDecisionReason("");
      await loadDecision();
    } catch (err) {
      setDecisionError(err instanceof Error ? err.message : "Unable to record this reconciliation decision.");
    } finally {
      setSubmittingDecision(false);
    }
  }

  async function submitMaterialize() {
    setMaterializing(true);
    setMaterializeError(null);
    try {
      const res = await fetch(`/api/governance/workspace/reviews/${encodeURIComponent(reviewSubjectId)}/materialize`, {
        method: "POST",
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        // Same stale-screen protection as submitDecision: a 409 means
        // another operator (or tab) already materialized (or the decision
        // changed) since this screen loaded — refresh to the current truth.
        if (res.status === 409) await loadDecision();
        throw new Error(body.error ?? "Unable to materialize this decision.");
      }
      await loadDecision();
    } catch (err) {
      setMaterializeError(err instanceof Error ? err.message : "Unable to materialize this decision.");
    } finally {
      setMaterializing(false);
    }
  }

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

      <Card className="mb-6">
        <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-wide mb-4">Decision to Truth</h3>
        <LifecycleStepper stages={computeLifecycleStages(detail, decision)} />
      </Card>

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

          {decision && (
            <Card className="mt-6">
              <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-wide mb-4">Reconciliation &amp; Materialization</h3>

              {decision.readiness.reason === "FINDING_ONLY" && !decision.reconciliation && (
                <div className="text-xs space-y-1 mb-3">
                  <div className="text-gray-500">Reconciliation input: <span className="text-gray-300">FINDING_ONLY</span></div>
                  <div className="text-warning font-medium">NOT READY FOR RECONCILIATION</div>
                  <div className="text-gray-500">Reason: {READINESS_REASON_TEXT.FINDING_ONLY}</div>
                </div>
              )}

              {!decision.reconciliation &&
                decision.readiness.reason !== "READY" &&
                decision.readiness.reason !== "FINDING_ONLY" && (
                  <p className="text-sm text-gray-500 mb-3">{READINESS_REASON_TEXT[decision.readiness.reason] ?? decision.readiness.reason}</p>
                )}

              {decisionError && <p className="text-sm text-danger mb-3">{decisionError}</p>}

              {!decision.reconciliation && decision.readiness.ready && (
                <div className="space-y-3">
                  {decisionOutcome ? (
                    <div className="space-y-3">
                      {decisionOutcome === "MATCH_EXISTING" && (
                        <div>
                          <label className="block text-sm text-gray-300 mb-1">Match to existing canonical object</label>
                          {(decision.matchCandidates ?? []).length === 0 ? (
                            <p className="text-xs text-gray-500">No existing canonical objects of this kind are governed yet.</p>
                          ) : (
                            <select
                              className="w-full px-3 py-2 bg-surface-dark border border-border-dark rounded-lg text-white text-sm"
                              value={matchTarget ?? ""}
                              onChange={(e) => setMatchTarget(e.target.value || null)}
                            >
                              <option value="">Select a canonical object…</option>
                              {(decision.matchCandidates ?? []).map((candidate) => (
                                <option key={candidate.canonicalObjectId} value={candidate.canonicalObjectId}>
                                  {candidate.canonicalObjectId}
                                  {candidate.sourceMappings.length > 0
                                    ? ` — ${candidate.sourceMappings.map((m) => m.externalId).join(", ")}`
                                    : ""}
                                </option>
                              ))}
                            </select>
                          )}
                        </div>
                      )}
                      <label className="block text-sm text-gray-300">Reason</label>
                      <textarea
                        className="w-full px-3 py-2 bg-surface-dark border border-border-dark rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                        rows={3}
                        value={decisionReason}
                        onChange={(e) => setDecisionReason(e.target.value)}
                        placeholder="Explain the basis for this reconciliation decision"
                      />
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          variant={decisionOutcome === "REJECT" ? "danger" : "primary"}
                          loading={submittingDecision}
                          disabled={
                            decisionReason.trim().length === 0 ||
                            (decisionOutcome === "MATCH_EXISTING" && !matchTarget)
                          }
                          onClick={submitDecision}
                        >
                          Confirm {decisionOutcome.replace("_", " ")}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            setDecisionOutcome(null);
                            setMatchTarget(null);
                            setDecisionReason("");
                          }}
                        >
                          Cancel
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {decision.availableOutcomes.map((outcome) => (
                        <Button
                          key={outcome}
                          className="w-full"
                          variant={outcome === "REJECT" ? "danger" : outcome === "DEFER" ? "secondary" : "primary"}
                          onClick={() => setDecisionOutcome(outcome)}
                        >
                          {outcome.replace("_", " ")}
                        </Button>
                      ))}
                      {detail.candidateKind === "RELATIONSHIP" && (
                        <p className="text-xs text-gray-500 pt-1">
                          CREATE NEW / MATCH EXISTING are not yet available for relationships: every governed
                          relationship type requires an already-governed AGENT_VERSION or DATA_ELEMENT source
                          endpoint, and neither kind has a production identity normalizer yet.
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )}

              {decision.reconciliation && (
                <div className="text-xs space-y-1 p-3 rounded-lg bg-white/5 border border-border-dark/50 mb-3">
                  <div className="flex items-center justify-between">
                    <span className="text-gray-300 font-medium">{decision.reconciliation.outcome.replace("_", " ")}</span>
                    <span className="text-gray-500">{formatTimestamp(decision.reconciliation.decidedAt)}</span>
                  </div>
                  <div className="text-gray-500">by {decision.reconciliation.actorReference}</div>
                  <div className="text-gray-500 italic">&quot;{decision.reconciliation.reasonCode}&quot;</div>
                  {decision.reconciliation.canonicalObject && (
                    <div className="text-gray-500 break-all">
                      Canonical object: {decision.reconciliation.canonicalObject.objectId} ({decision.reconciliation.canonicalObject.kind})
                    </div>
                  )}
                </div>
              )}

              {materializeError && <p className="text-sm text-danger mb-3">{materializeError}</p>}

              {decision.reconciliation &&
                !decision.materialization &&
                (decision.reconciliation.outcome === "CREATE_NEW" || decision.reconciliation.outcome === "MATCH_EXISTING") && (
                  <Button className="w-full" loading={materializing} onClick={submitMaterialize}>
                    Materialize
                  </Button>
                )}

              {decision.materialization?.status === "APPLIED" && (
                <div className="text-xs space-y-1 p-3 rounded-lg bg-success/10 border border-success/30">
                  <div className="text-success font-semibold">GOVERNED CANONICAL STATE ESTABLISHED</div>
                  <div className="text-gray-400">Outcome: {decision.materialization.outcome.replace("_", " ")}</div>
                  {decision.materialization.canonicalObjectId && (
                    <div className="text-gray-400 break-all">Canonical object: {decision.materialization.canonicalObjectId}</div>
                  )}
                  {decision.materialization.relationshipId && (
                    <div className="text-gray-400 break-all">Canonical relationship: {decision.materialization.relationshipId}</div>
                  )}
                  {decision.materialization.appliedAt && (
                    <div className="text-gray-500">Applied {formatTimestamp(decision.materialization.appliedAt)}</div>
                  )}
                </div>
              )}
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
