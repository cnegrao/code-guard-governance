import { analyseDataLineage, type DataLineageResult } from "./lineage";
import { analyseFinOps, heuristicCostEvidence, type FinOpsResult } from "./finops";
import { scanLGPDP, type LGPDPResult } from "./lgpd";
import { detectFAPI, type FAPIResult } from "./fapi";
import { inferTrustZone, computeGovernancePriority, type TrustZoneResult } from "./trust-zone";
import { extractCodeMap, type CodeMapResult } from "./code-map";
import type { DiscoveredAgent } from "../types";

export interface EnrichedAgentData {
  lineage: DataLineageResult;
  finops: FinOpsResult;
  lgpd: LGPDPResult;
  fapi: FAPIResult;
  trustZone: TrustZoneResult;
  codeMap: CodeMapResult;
  governancePriority: "critical" | "high" | "medium" | "low";
  complianceExposure: "critical" | "high" | "medium" | "low" | "none";
  aiActExposure: "high" | "limited" | "minimal" | "none";
  doraExposure: boolean;
  annexIiiCategory: string | null;
  discoveryConfidence: number;
  governanceConfidence: number;
  complianceConfidence: number;
}

export async function enrichAgent(
  agent: DiscoveredAgent,
  fileContent: string
): Promise<EnrichedAgentData> {
  const [lineage, finops, lgpd, fapi, trustZone, codeMap] = await Promise.all([
    Promise.resolve(analyseDataLineage(fileContent, agent.filePath)),
    Promise.resolve(analyseFinOps(fileContent)),
    Promise.resolve(scanLGPDP(fileContent, agent.filePath)),
    Promise.resolve(detectFAPI(fileContent, agent.filePath)),
    Promise.resolve(inferTrustZone(agent.filePath, fileContent)),
    Promise.resolve(extractCodeMap(agent.filePath, fileContent)),
  ]);

  const governancePriority = computeGovernancePriority(
    trustZone.trustZone,
    agent.suggestedRiskLevel,
    agent.isAutonomous
  );

  let complianceExposure: EnrichedAgentData["complianceExposure"] = "none";
  const exposureSignals: string[] = [];
  if (lgpd.severity === "critical") exposureSignals.push("critical_lgpd");
  if (lgpd.severity === "high") exposureSignals.push("high_lgpd");
  if (lineage.riskLevel === "critical") exposureSignals.push("critical_lineage");
  if (lineage.riskLevel === "high") exposureSignals.push("high_lineage");
  // L15 §23 / LX04: costRisk mixes presumed usage and pattern flags; it is not compliance evidence.
  if (fapi.doraExposure && !fapi.fapiCompliant) exposureSignals.push("dora_gap");

  if (exposureSignals.filter((s) => s.startsWith("critical")).length >= 2) complianceExposure = "critical";
  else if (exposureSignals.some((s) => s.startsWith("critical"))) complianceExposure = "high";
  else if (exposureSignals.length >= 2) complianceExposure = "medium";
  else if (exposureSignals.length >= 1) complianceExposure = "low";

  const annexIiiCategory = classifyAnnexIII(agent);
  const aiActExposure: EnrichedAgentData["aiActExposure"] = annexIiiCategory ? "high" : "none";

  const discoveryConfidence = agent.confidence;

  const signalCount = lineage.evidence.length + lgpd.findings.length + fapi.evidence.length;
  const frameworkCertainty = agent.framework === "custom" ? 30 : agent.framework === "openai" || agent.framework === "anthropic" ? 50 : 70;
  const evidenceCount = signalCount;
  const verificationStatus = agent.suggestedRiskLevel === "low" ? 80 : 50;
  const jurisdictionCertainty = 70;
  const annexIiiCertainty = annexIiiCategory ? 80 : 50;

  const governanceConfidence = Math.min(98, Math.round(
    (discoveryConfidence * 0.25) +
    (frameworkCertainty * 0.20) +
    (evidenceCount > 0 ? Math.min(evidenceCount * 5, 30) : 0) +
    (verificationStatus * 0.15) +
    (jurisdictionCertainty * 0.10) +
    (annexIiiCertainty * 0.10)
  ));

  const complianceConfidence = Math.min(98, Math.round(
    (complianceExposure === "none" || complianceExposure === "low" ? 80 : 50) * 0.25 +
    (lgpd.severity === "low" ? 80 : lgpd.severity === "medium" ? 60 : 40) * 0.20 +
    (evidenceCount > 0 ? Math.min(evidenceCount * 4, 25) : 0) +
    (fapi.confidence > 0 ? Math.min(fapi.confidence, 20) : 0) +
    (jurisdictionCertainty * 0.10) +
    (verificationStatus * 0.25)
  ));

  return {
    lineage,
    finops,
    lgpd,
    fapi,
    trustZone,
    codeMap,
    governancePriority,
    complianceExposure,
    aiActExposure,
    doraExposure: fapi.doraExposure,
    annexIiiCategory,
    discoveryConfidence,
    governanceConfidence,
    complianceConfidence,
  };
}

export function enrichSummary(
  agent: DiscoveredAgent,
  enrichment: EnrichedAgentData
) {
  return {
    framework_detected: agent.framework,
    agent_type: agent.agentType,
    risk_level: agent.suggestedRiskLevel,
    ai_act_risk_class: enrichment.aiActExposure,
    trust_zone: enrichment.trustZone.trustZone,
    governance_priority: enrichment.governancePriority,
    contains_pii: enrichment.lineage.containsPii,
    contains_financial_data: enrichment.lineage.containsFinancialData,
    contains_health_data: enrichment.lineage.containsHealthData,
    external_sinks: enrichment.lineage.externalSinks.length,
    internal_sinks: enrichment.lineage.internalSinks.length,
    monthly_cost_estimate: enrichment.finops.monthlyCostEstimate,
    monthly_cost_estimate_evidence: heuristicCostEvidence(),
    code_locations: enrichment.codeMap.agentCodeLocations.length,
    compliance_exposure: enrichment.complianceExposure,
    ai_act_exposure: enrichment.aiActExposure,
    dora_exposure: enrichment.doraExposure,
    annex_iii_category: enrichment.annexIiiCategory,
    discovery_confidence: enrichment.discoveryConfidence,
    governance_confidence: enrichment.governanceConfidence,
    compliance_confidence: enrichment.complianceConfidence,
  };
}

const ANNEX_III_MAP: Array<{ category: string; domains: string[]; types: string[]; signals: string[] }> = [
  { category: "biometric_identification", domains: ["security", "law_enforcement", "identity"], types: ["classifier", "supervisory"], signals: ["biometric", "facial", "fingerprint", "iris", "gait", "voice_print"] },
  { category: "critical_infrastructure", domains: ["energy", "transport", "water", "healthcare"], types: ["supervisory", "gateway", "autonomous"], signals: ["critical_infrastructure", "scada", "industrial_control", "safety"] },
  { category: "education_vocational_training", domains: ["education"], types: ["classifier", "assistive"], signals: ["education", "student", "exam", "admission", "learning"] },
  { category: "employment_worker_management", domains: ["hr", "recruitment", "workforce"], types: ["classifier", "assistive"], signals: ["recruitment", "hiring", "candidate", "cv", "resume", "employee", "promotion", "termination"] },
  { category: "essential_services_benefits", domains: ["government", "financial_services", "insurance"], types: ["gateway", "classifier"], signals: ["benefit", "welfare", "social_security", "public_assistance", "credit", "loan", "mortgage"] },
  { category: "law_enforcement", domains: ["government", "security"], types: ["supervisory", "classifier"], signals: ["law_enforcement", "police", "surveillance", "investigation", "forensic", "criminal"] },
  { category: "migration_asylum_border", domains: ["government"], types: ["supervisory", "classifier", "gateway"], signals: ["migration", "asylum", "border", "visa", "immigration", "passport", "customs"] },
  { category: "administration_of_justice", domains: ["government", "legal"], types: ["classifier", "assistive"], signals: ["justice", "court", "judicial", "sentencing", "legal_proceeding", "dispute"] },
  { category: "credit_scoring", domains: ["financial_services", "insurance"], types: ["classifier", "gateway"], signals: ["credit_score", "credit_risk", "lending", "loan", "underwriting", "insurance_premium"] },
];

function classifyAnnexIII(agent: DiscoveredAgent): string | null {
  const domain = agent.filePath?.toLowerCase() ?? "";
  const agentType = agent.agentType?.toLowerCase() ?? "";

  const matches: string[] = [];
  for (const entry of ANNEX_III_MAP) {
    const domainMatch = entry.domains.some((d) => domain.includes(d));
    const typeMatch = entry.types.some((t) => agentType.includes(t));
    const signalMatch = entry.signals.some((s) => domain.includes(s));
    if (typeMatch && (domainMatch || signalMatch)) {
      matches.push(entry.category);
    }
  }

  return matches.length > 0 ? matches[0] : null;
}

export { analyseDataLineage } from "./lineage";
export { analyseFinOps } from "./finops";
export { scanLGPDP } from "./lgpd";
export { detectFAPI } from "./fapi";
export { inferTrustZone, computeGovernancePriority } from "./trust-zone";
export { extractCodeMap } from "./code-map";
