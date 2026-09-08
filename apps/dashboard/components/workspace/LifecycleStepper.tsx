export type LifecycleStageStatus =
  | "COMPLETED"
  | "AVAILABLE"
  | "PENDING"
  | "NOT_APPLICABLE"
  | "UNAVAILABLE"
  | "NOT_STARTED";

export interface LifecycleStage {
  readonly label: string;
  readonly status: LifecycleStageStatus;
  readonly detail?: string;
}

const DOT_CLASS: Record<LifecycleStageStatus, string> = {
  COMPLETED: "bg-success",
  AVAILABLE: "bg-primary",
  PENDING: "bg-warning",
  NOT_APPLICABLE: "bg-gray-600",
  UNAVAILABLE: "bg-gray-600",
  NOT_STARTED: "bg-gray-700",
};

const LABEL_CLASS: Record<LifecycleStageStatus, string> = {
  COMPLETED: "text-success",
  AVAILABLE: "text-primary",
  PENDING: "text-warning",
  NOT_APPLICABLE: "text-gray-500",
  UNAVAILABLE: "text-gray-500",
  NOT_STARTED: "text-gray-500",
};

/**
 * Enterprise Lifecycle Stepper (Reconciliation & Materialization Workspace
 * V1). Presentation-only projection over already-fetched, server-derived
 * facts (readiness/reconciliation/materialization) — it never computes those
 * facts itself and never fabricates a completed stage the server has not
 * proven.
 */
export function LifecycleStepper({ stages }: { stages: readonly LifecycleStage[] }) {
  return (
    <ol className="flex flex-wrap gap-x-1 gap-y-3">
      {stages.map((stage, index) => (
        <li key={stage.label} className="flex items-center">
          {index > 0 && <span className="w-4 h-px bg-border-dark mx-2 shrink-0" aria-hidden="true" />}
          <div className="flex items-center gap-1.5">
            <span className={`w-2 h-2 rounded-full shrink-0 ${DOT_CLASS[stage.status]}`} />
            <span className={`text-xs font-medium ${LABEL_CLASS[stage.status]}`} title={stage.detail}>
              {stage.label}
            </span>
          </div>
        </li>
      ))}
    </ol>
  );
}
