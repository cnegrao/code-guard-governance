import type { DetectedAgent, DetectedRisk, SourceAnalysis, PackageAnalysis } from './types';
import { projectScannerOversight, type ScannerOversight } from './oversight';

export interface AgentClassification {
  agentId: string;
  agentName: string;
  riskCategory: 'low' | 'medium' | 'high' | 'critical';
  aiActCategory: 'none' | 'minimal' | 'limited' | 'high' | 'unacceptable';
  domain: 'general' | 'healthcare' | 'finance' | 'government' | 'education';
  oversightLevel: 'UNKNOWN';
  oversight: ScannerOversight;
  confidence: number;
  evidence: string[];
}

export function classifyAgent(
  agent: DetectedAgent,
  source: SourceAnalysis,
  packages: PackageAnalysis
): AgentClassification {
  const evidence: string[] = [];

  // ── Domain Classification ──
  let domain: AgentClassification['domain'] = 'general';
  const healthSignals = ['health', 'medical', 'clinical', 'patient', 'hipaa', 'anvisa', 'phq', 'cops[oó]q'];
  const financeSignals = ['finance', 'bank', 'payment', 'stripe', 'bcb', '4893', 'pci', 'transaction'];
  const govSignals = ['government', 'public', 'policy', 'regulat', 'compliance', 'audit'];
  const eduSignals = ['educational', 'tutorial', 'guide', 'learn', 'example', 'demo', 'notebook'];

  const allText = [
    agent.name,
    ...agent.tools,
    ...agent.models,
    agent.framework ?? '',
  ].join(' ').toLowerCase();

  if (healthSignals.some(s => allText.includes(s))) {
    domain = 'healthcare';
    evidence.push('Health-related patterns detected');
  } else if (financeSignals.some(s => allText.includes(s))) {
    domain = 'finance';
    evidence.push('Finance-related patterns detected');
  } else if (govSignals.some(s => allText.includes(s))) {
    domain = 'government';
    evidence.push('Government/compliance patterns detected');
  } else if (eduSignals.some(s => allText.includes(s))) {
    domain = 'education';
    evidence.push('Educational patterns detected');
  }

  // ── AI Act Category ──
  let aiActCategory: AgentClassification['aiActCategory'] = 'minimal';
  if (agent.riskLevel === 'critical' || agent.isAutonomous) {
    aiActCategory = 'high';
    evidence.push('Critical risk or autonomous operation → AI Act High-Risk');
  } else if (agent.riskLevel === 'high') {
    aiActCategory = agent.type === 'ai_persona' ? 'high' : 'limited';
    evidence.push('High-risk agent or AI persona');
  } else if (domain === 'healthcare' || domain === 'government') {
    aiActCategory = 'high';
    evidence.push(`Domain (${domain}) implies AI Act High-Risk`);
  }

  // ── Risk Category ──
  let riskCategory: AgentClassification['riskCategory'] = 'low';
  if (agent.critical || agent.isAutonomous) {
    riskCategory = 'critical';
  } else if (agent.riskLevel === 'high' || agent.riskLevel === 'medium') {
    riskCategory = agent.riskLevel === 'high' ? 'high' : 'medium';
  }

  const oversight = projectScannerOversight(agent);
  evidence.push('Effective oversight UNKNOWN (NOT_EVIDENCED); any recommendation is a non-authoritative heuristic.');

  const confidence = Math.min(
    95,
    40 +
      (agent.framework ? 20 : 0) +
      (agent.riskLevel !== 'low' ? 15 : 0) +
      (domain !== 'general' ? 10 : 0) +
      (agent.isAutonomous ? 10 : 0)
  );

  return {
    agentId: agent.name.toLowerCase().replace(/[^a-z0-9]/g, '-'),
    agentName: agent.name,
    riskCategory,
    aiActCategory,
    domain,
    oversightLevel: oversight.level,
    oversight,
    confidence,
    evidence,
  };
}

export function classifyAllAgents(
  agents: DetectedAgent[],
  source: SourceAnalysis,
  packages: PackageAnalysis
): AgentClassification[] {
  return agents.map(a => classifyAgent(a, source, packages));
}

export interface RepoAIActSummary {
  totalAgents: number;
  highRiskCount: number;
  limitedRiskCount: number;
  minimalRiskCount: number;
  unacceptableCount: number;
  requiresConformityAssessment: boolean;
  /** No governed applicability/oversight decision is available to this scanner. */
  requiresHumanOversight: 'UNKNOWN';
  requiresTransparency: boolean;
  evidence: string[];
}

export function summarizeAIAct(
  classifications: AgentClassification[]
): RepoAIActSummary {
  const highRiskCount = classifications.filter(c => c.aiActCategory === 'high').length;
  const limitedRiskCount = classifications.filter(c => c.aiActCategory === 'limited').length;
  const minimalRiskCount = classifications.filter(c => c.aiActCategory === 'minimal').length;
  const unacceptableCount = classifications.filter(c => c.aiActCategory === 'unacceptable').length;

  const evidence: string[] = [];
  if (highRiskCount > 0) evidence.push(`${highRiskCount} high-risk AI system(s) → conformity assessment required`);
  if (limitedRiskCount > 0) evidence.push(`${limitedRiskCount} limited-risk system(s) → transparency obligations`);
  if (unacceptableCount > 0) evidence.push(`${unacceptableCount} unacceptable risk system(s) → prohibited`);

  return {
    totalAgents: classifications.length,
    highRiskCount,
    limitedRiskCount,
    minimalRiskCount,
    unacceptableCount,
    requiresConformityAssessment: highRiskCount > 0,
    requiresHumanOversight: 'UNKNOWN',
    requiresTransparency: limitedRiskCount > 0 || highRiskCount > 0,
    evidence,
  };
}
