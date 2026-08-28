type RiskLevel = "critical" | "high" | "medium" | "low";

const colors: Record<string, string> = {
  critical: "bg-danger/20 text-danger border-danger/30",
  high: "bg-orange-500/20 text-orange-400 border-orange-500/30",
  medium: "bg-warning/20 text-warning border-warning/30",
  low: "bg-success/20 text-success border-success/30",
  active: "bg-success/20 text-success border-success/30",
  registered: "bg-primary/20 text-primary border-primary/30",
  decommissioned: "bg-gray-500/20 text-gray-400 border-gray-500/30",
  suspended: "bg-danger/20 text-danger border-danger/30",
  passed: "bg-success/20 text-success border-success/30",
  failed: "bg-danger/20 text-danger border-danger/30",
  neutral: "bg-gray-500/20 text-gray-400 border-gray-500/30",
};

interface BadgeProps {
  variant?: RiskLevel | "active" | "registered" | "decommissioned" | "suspended" | "passed" | "failed" | "neutral";
  children: React.ReactNode;
}

export function Badge({ variant = "medium", children }: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${
        colors[variant] ?? "bg-gray-500/20 text-gray-400 border-gray-500/30"
      }`}
    >
      {children}
    </span>
  );
}
