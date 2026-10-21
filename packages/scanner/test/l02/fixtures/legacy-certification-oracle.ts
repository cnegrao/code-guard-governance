// LEGACY_NON_AUTHORITATIVE: frozen test oracle from starting HEAD 8a10a99.
// Never imported by src or exposed as a product API. Preserves regression provenance only.
type CertificationResult = {
  overall: 'bronze' | 'silver' | 'gold' | 'platinum' | 'none';
  levels: Record<'bronze' | 'silver' | 'gold' | 'platinum', { pass: boolean; evidence: string[]; fail: string[] }>;
};
import type { SourceAnalysis, DetectedRisk, ComplianceAnalysis, PackageAnalysis } from '../../../src/core/types';

export function certifySystem(
  source: SourceAnalysis,
  risks: DetectedRisk[],
  compliance: ComplianceAnalysis,
  packages: PackageAnalysis,
): CertificationResult {
  const criticalRisks = risks.filter(r => r.severity === 'critical');
  const highRisks = risks.filter(r => r.severity === 'high');
  const hasPII = source.dataAssets.some(d => d.hasPII);
  const hasConsent = source.authPatterns.some(a => /consent/i.test(a)) || source.dataAssets.some(d => d.name.toLowerCase().includes('consent'));
  const hasAuditLogs = source.authPatterns.some(a => /audit|log|trace/i.test(a)) || source.databaseTables.some(t => /audit|log/i.test(t)) || source.fileTree.some(f => /audit|log|trace/i.test(f));
  const hasRLS = source.databaseTables.some(t => /rls|policy/i.test(t)) || source.fileTree.some(f => /policy|rls/i.test(f)) || source.fileTree.some(f => /migrations/i.test(f) && f.endsWith('.sql'));
  const hasAuthMiddleware = source.apiRoutes.some(r => r.authRequired);
  const hasCI = Object.values(packages.scripts).some(s => /test|lint|build|check/i.test(s));
  const isApp = source.apiRoutes.length > 0 || source.databaseTables.length > 0 || source.fileTree.some(f => f.startsWith('src/') || f.startsWith('app/'));
  const isFramework = !isApp && (source.frameworks.length > 0 || source.agents.length > 3);
  const hasEvidence = source.fileTree.length > 0;
  const hasAgents = source.agents.length > 0;
  const hasDeps = Object.keys(packages.dependencies).length > 0 || packages.aiDependencies.length > 0;

  // Bronze: Security basics (contextual — skip infra checks for framework/lib repos)
  const bronzeEvidence: string[] = [];
  const bronzeFail: string[] = [];
  if (isApp) {
    if (hasRLS) bronzeEvidence.push('RLS presente');
    else if (source.databaseTables.length > 0) bronzeFail.push('Sem RLS detectado');
    if (hasConsent) bronzeEvidence.push('Gerenciamento de consentimento presente');
    else if (hasPII) bronzeFail.push('Sem gerenciamento de consentimento');
    if (hasAuditLogs) bronzeEvidence.push('Audit logs presentes');
    else if (source.authPatterns.length > 0) bronzeFail.push('Sem audit logs detectados');
  }
  if (packages.hasTestFramework) bronzeEvidence.push('Testes automatizados presentes');
  if (packages.hasLinter) bronzeEvidence.push('Linter configurado');
  if (hasEvidence) bronzeEvidence.push('Arquivos-fonte escaneados');
  if (hasAgents) bronzeEvidence.push('Agentes de IA identificados');
  if (hasDeps) bronzeEvidence.push('Dependências gerenciadas');
  const bronzePass = bronzeFail.length <= 2 && (bronzeEvidence.length >= 2 || hasAgents);

  // Silver: Governance
  const silverEvidence: string[] = [];
  const silverFail: string[] = [];
  if (source.agents.some(a => a.critical)) silverEvidence.push('Agentes críticos identificados');
  else silverFail.push('Sem registro de agentes críticos');
  if (packages.aiDependencies.length > 0) silverEvidence.push('Dependências de IA registradas');
  else silverFail.push('Sem registro de dependências de IA');
  const criticalPct = risks.length > 0 ? (criticalRisks.length / risks.length) * 100 : 0;
  if (criticalPct <= 15) silverEvidence.push(`${criticalRisks.length} riscos críticos (${criticalPct.toFixed(0)}%) — dentro do limite de 15%`);
  else silverFail.push(`${criticalRisks.length} riscos críticos (${criticalPct.toFixed(0)}%) — acima do limite de 15%`);
  if (hasAuthMiddleware || isFramework) silverEvidence.push('Autenticação em API routes detectada');
  else silverFail.push('API routes sem autenticação detectada');
  const silverPass = bronzePass && silverFail.length <= 2;

  // Gold: Full compliance  
  const goldEvidence: string[] = [];
  const goldFail: string[] = [];
  const compliant = compliance.applicableRegulations.filter(r => r.status === 'compliant');
  const applicableRegs = compliance.applicableRegulations.filter(r => r.status !== 'not_applicable');
  if (compliant.length >= 2 || applicableRegs.filter(r => r.status === 'compliant' || r.status === 'partial').length >= 3) {
    goldEvidence.push(`${compliant.length} regulamentações conformes`);
  } else {
    goldFail.push('Menos de 2 regulamentações conformes');
  }
  if (source.aiModels.length > 0 && source.agents.length > 0) goldEvidence.push('Modelos e agentes de IA mapeados');
  else goldFail.push('Modelos ou agentes de IA não mapeados');
  const highPct = risks.length > 0 ? (highRisks.length / risks.length) * 100 : 0;
  if (highPct <= 30) goldEvidence.push(`Riscos altos controlados (${highPct.toFixed(0)}%)`);
  else goldFail.push(`${highRisks.length} riscos altos (${highPct.toFixed(0)}%) — acima de 30%`);
  if (!hasPII || (hasPII && hasConsent)) goldEvidence.push('PII com consentimento');
  else goldFail.push('PII sem consentimento documentado');
  const goldPass = silverPass && goldFail.length <= 2;

  // Platinum: Full automation + audit trail + mature compliance
  const platEvidence: string[] = [];
  const platFail: string[] = [];
  if (hasCI) platEvidence.push('Pipeline de CI/CD detectado');
  else platFail.push('Sem CI/CD');
  if (hasAuditLogs || hasEvidence) platEvidence.push('Audit trail automatizado');
  else platFail.push('Sem audit trail automatizado');
  if (compliance.overallScore >= 60) platEvidence.push(`Score de compliance ${compliance.overallScore}/100`);
  else platFail.push(`Score de compliance ${compliance.overallScore}/100 (<60)`);
  if (criticalRisks.length === 0) platEvidence.push('Nenhum risco crítico pendente');
  else platFail.push(`${criticalRisks.length} risco(s) crítico(s) pendente(s)`);
  const platPass = goldPass && platFail.length === 0;

  let overall: CertificationResult['overall'] = 'none';
  if (platPass) overall = 'platinum';
  else if (goldPass) overall = 'gold';
  else if (silverPass) overall = 'silver';
  else if (bronzePass) overall = 'bronze';

  return {
    levels: {
      bronze: { pass: bronzePass, evidence: bronzeEvidence, fail: bronzeFail },
      silver: { pass: silverPass, evidence: silverEvidence, fail: silverFail },
      gold: { pass: goldPass, evidence: goldEvidence, fail: goldFail },
      platinum: { pass: platPass, evidence: platEvidence, fail: platFail },
    },
    overall,
  };
}
