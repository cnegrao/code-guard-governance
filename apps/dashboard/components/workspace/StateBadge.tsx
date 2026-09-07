import { Badge } from "@/components/ui/Badge";

const VARIANT_BY_STATE: Record<string, "detected" | "proposed" | "confirmed" | "certified" | "rejected"> = {
  DETECTED: "detected",
  PROPOSED: "proposed",
  CONFIRMED: "confirmed",
  CERTIFIED: "certified",
  REJECTED: "rejected",
};

export function StateBadge({ state }: { state: string }) {
  return <Badge variant={VARIANT_BY_STATE[state] ?? "detected"}>{state}</Badge>;
}
