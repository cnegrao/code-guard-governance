import type { DiscoveredAgent, ClassificationResult } from "./types";
import type { EnrichedAgentData } from "./enrichment";
import { projectCodeguardOversight } from './oversight';
import { FINOPS_FLAG_RULES } from '../l15/finops-signal-adapter';

const RISK_MAP: Record<string, { risk: string; aiAct: string }> = {
  autonomous: { risk: "high", aiAct: "high" },
  orchestrator: { risk: "medium", aiAct: "limited" },
  supervisory: { risk: "high", aiAct: "high" },
  gateway: { risk: "medium", aiAct: "limited" },
  assistive: { risk: "low", aiAct: "minimal" },
  retrieval: { risk: "low", aiAct: "minimal" },
  classifier: { risk: "medium", aiAct: "high" },
};

const DOMAIN_PATTERNS: Array<{ domain: string; patterns: RegExp[] }> = [
  { domain: "Financial Services", patterns: [/payment|transaction|fraud|credit|loan|bank|fintech|kYC|AML|insurance|underwrit/i] },
  { domain: "Healthcare", patterns: [/patient|diagnos|medical|health|clinical|pharma|drug|HIPAA|FHIR/i] },
  { domain: "Legal", patterns: [/contract|legal|compliance|regulation|law|attorney|litigation/i] },
  { domain: "Customer Support", patterns: [/support|ticket|chatbot|customer.service|helpdesk|FAQ/i] },
  { domain: "Engineering", patterns: [/code|deploy|build|test|CI|CD|pipeline|infra|devops/i] },
];

export function classifyAgent(agent: DiscoveredAgent, enrichment?: EnrichedAgentData): ClassificationResult {
  const risk = RISK_MAP[agent.agentType] ?? { risk: "medium", aiAct: "limited" };

  const domain = DOMAIN_PATTERNS.find((d) =>
    d.patterns.some((p) => agent.evidence.some((e) => p.test(e)) || p.test(agent.name))
  );

  const reasoning: string[] = [
    `Agent type: ${agent.agentType} → risk ${risk.risk}, AI Act ${risk.aiAct}`,
    `Framework: ${agent.framework} (confidence: ${agent.confidence}%)`,
    `Evidence signals: ${agent.evidence.length}`,
  ];

  if (agent.isAutonomous) reasoning.push("Autonomy heuristic: L3 recommendation is NON_AUTHORITATIVE; effective oversight UNKNOWN / NOT_EVIDENCED.");
  if (domain) reasoning.push(`Business domain inferred: ${domain.domain}`);

  let finalRisk = risk.risk;
  let finalAiAct = risk.aiAct;
  const oversight = projectCodeguardOversight(agent, enrichment?.governancePriority === 'critical');

  if (enrichment) {
    if (enrichment.governancePriority === "critical") {
      finalRisk = "critical";
    } else if (enrichment.governancePriority === "high") {
      finalRisk = "high";
    }

    if (enrichment.aiActExposure === "high") finalAiAct = "high";
    else if (enrichment.aiActExposure === "limited") finalAiAct = "limited";

    if (enrichment.lineage.containsPii) reasoning.push("PII data detected in agent code.");
    if (enrichment.lineage.containsFinancialData) reasoning.push("Financial data patterns detected.");
    if (enrichment.lineage.containsHealthData) reasoning.push("Health data patterns detected.");
    if (enrichment.lgpd.credentialExposure) reasoning.push("Credential exposure risk detected.");
    if (enrichment.fapi.financialServices) reasoning.push("Financial services domain detected.");
    if (enrichment.fapi.doraExposure) reasoning.push("DORA exposure: operational resilience required.");
    // Reuse L15's admitted technical flags; never read estimate-derived risk, amounts or free-text hotspots.
    for (const rule of Object.values(FINOPS_FLAG_RULES)) {
      if (enrichment.finops[rule.flag] !== true) continue;
      const observation = rule.signalKind === 'DETECTED_ABSENCE' ? 'not detected' : 'pattern detected';
      reasoning.push(`FinOps technical signal (INFERRED / NON_AUTHORITATIVE): ${rule.observation}: ${observation}.`);
    }
    reasoning.push(`Trust zone: ${enrichment.trustZone.trustZone}`);
    reasoning.push(`Governance priority: ${enrichment.governancePriority}`);
    reasoning.push(`Compliance exposure: ${enrichment.complianceExposure}`);
    reasoning.push(`Confidence: discovery=${enrichment.discoveryConfidence}% governance=${enrichment.governanceConfidence}% compliance=${enrichment.complianceConfidence}%`);
  }

  return {
    agentType: agent.agentType,
    riskLevel: finalRisk,
    aiActRiskClass: finalAiAct,
    oversightLevel: oversight.level,
    oversight,
    businessDomain: enrichment?.fapi.financialServices ? "Financial Services" : domain?.domain ?? "General",
    isAutonomous: agent.isAutonomous,
    confidence: enrichment?.governanceConfidence ?? agent.confidence,
    reasoning,
  };
}
