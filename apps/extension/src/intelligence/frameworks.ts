/**
 * Technical framework reference mapping
 * Maps each framework reference to the optimal LLM model
 */

export interface FrameworkConfig {
    id: string;
    name: string;
    llm: string;
    region: 'BR' | 'EU' | 'GLOBAL' | 'US';
    description: string;
}

/**
 * LLM Model Selection Strategy:
 * - claude-3.5-sonnet: Source-code data-handling review (LGPD, GDPR)
 * - gpt-4o: Technical security analysis (ISO 27001, NIS2)
 * - gemini-2.0-flash: High volume, pattern matching (BACEN, ANVISA, PSD2)
 */
export const COMPLIANCE_LLM_MAP: Record<string, string> = {
    "LGPD": "anthropic/claude-3.5-sonnet",
    "GDPR": "anthropic/claude-3.5-sonnet",
    "ISO27001": "openai/gpt-4o",
    "SOC2": "openai/gpt-4o",
    "OWASP": "openai/gpt-4o",
    "AIACT": "google/gemini-2.0-flash-001",
    "MDR_HIPAA": "google/gemini-2.0-flash-001", // Legacy key kept for safety
    "MDR": "google/gemini-2.0-flash-001",
    "HIPAA": "google/gemini-2.0-flash-001",
    "PSD2": "google/gemini-2.0-flash-001",
    "BACEN_CVM": "google/gemini-2.0-flash-001",
    "ANVISA": "google/gemini-2.0-flash-001",
    "NIS2": "openai/gpt-4o",
    "CRA": "openai/gpt-4o",
    "DORA": "anthropic/claude-3.5-sonnet",
    "PCI_DSS": "openai/gpt-4o",
    "PIX_SECURITY": "google/gemini-2.0-flash-001",
    "CCPA": "anthropic/claude-3.5-sonnet"
};

/**
 * Global frameworks available for all regions
 */
export const GLOBAL_FRAMEWORKS: FrameworkConfig[] = [
    {
        id: "ISO27001",
        name: "ISO 27001",
        llm: COMPLIANCE_LLM_MAP["ISO27001"],
        region: "GLOBAL",
        description: "Information Security Management System standard"
    },
    {
        id: "PCI_DSS",
        name: "PCI-DSS v4.0",
        llm: COMPLIANCE_LLM_MAP["PCI_DSS"],
        region: "GLOBAL",
        description: "Payment Card Industry Data Security Standard (Critical for Fintechs)"
    },
    {
        id: "SOC2",
        name: "SOC 2 Type II",
        llm: COMPLIANCE_LLM_MAP["SOC2"],
        region: "GLOBAL",
        description: "SaaS Security, Availability & Confidentiality (Trust Services Criteria)"
    },
    {
        id: "OWASP",
        name: "OWASP Top 10",
        llm: COMPLIANCE_LLM_MAP["OWASP"],
        region: "GLOBAL",
        description: "Standard for Web Application Security Vulnerabilities"
    }
];

/**
 * Brazil-specific framework reference topics
 */
export const BR_FRAMEWORKS: FrameworkConfig[] = [
    {
        id: "LGPD",
        name: "LGPD (Lei Geral de Proteção de Dados)",
        llm: COMPLIANCE_LLM_MAP["LGPD"],
        region: "BR",
        description: "Brazilian data protection law - Art. 7, 15, 33, 46"
    },
    {
        id: "BACEN_CVM",
        name: "BACEN/CVM (Resolução 4.893)",
        llm: COMPLIANCE_LLM_MAP["BACEN_CVM"],
        region: "BR",
        description: "Brazilian Central Bank cybersecurity requirements for financial institutions"
    },
    {
        id: "ANVISA",
        name: "ANVISA (SaMD - RDC 665/2022)",
        llm: COMPLIANCE_LLM_MAP["ANVISA"],
        region: "BR",
        description: "Brazilian health agency - Software as Medical Device (RDC 665/2022)"
    },
    {
        id: "PIX_SECURITY",
        name: "Pix Security (Bacen Res. 1)",
        llm: COMPLIANCE_LLM_MAP["PIX_SECURITY"],
        region: "BR",
        description: "Specific security requirements for Pix keys and transactions"
    },
    {
        id: "fapi-br",
        name: "FAPI 1 Advanced (Open Finance BR)",
        llm: "google/gemini-2.0-flash-001",
        region: "BR",
        description: "Raidiam/OFB Profile: PS256, mtLS, Consent-related code & DCR configuration"
    },
    ...GLOBAL_FRAMEWORKS
];

/**
 * Europe-specific framework reference topics
 */
export const EU_FRAMEWORKS: FrameworkConfig[] = [
    {
        id: "GDPR",
        name: "GDPR (General Data Protection Regulation)",
        llm: COMPLIANCE_LLM_MAP["GDPR"],
        region: "EU",
        description: "EU data protection regulation - Art. 5, 17, 25, 32, 35"
    },
    {
        id: "AIACT",
        name: "EU AI Act",
        llm: COMPLIANCE_LLM_MAP["AIACT"],
        region: "EU",
        description: "EU AI Regulation 2024/1689 - AI transparency and decision-log technical signals"
    },
    {
        id: "PSD2",
        name: "PSD2/EBA",
        llm: COMPLIANCE_LLM_MAP["PSD2"],
        region: "EU",
        description: "Payment Services Directive 2 - SCA, API security"
    },
    {
        id: "MDR",
        name: "MDR (Medical Device Regulation)",
        llm: COMPLIANCE_LLM_MAP["MDR"],
        region: "EU",
        description: "EU Medical Device Regulation 2017/745"
    },
    {
        id: "NIS2",
        name: "NIS2 Directive",
        llm: COMPLIANCE_LLM_MAP["NIS2"],
        region: "EU",
        description: "Network and Information Security - Critical infrastructure & Supply Chain"
    },
    {
        id: "CRA",
        name: "CRA (Cyber Resilience Act)",
        llm: COMPLIANCE_LLM_MAP["CRA"],
        region: "EU",
        description: "EU regulation for digital products - SBOM, vuln reporting, security by design"
    },
    {
        id: "DORA",
        name: "DORA (Digital Operational Resilience)",
        llm: COMPLIANCE_LLM_MAP["DORA"],
        region: "EU",
        description: "EU Financial sector resilience - ICT risk management & incident reporting"
    },
    ...GLOBAL_FRAMEWORKS
];

/**
 * US-specific framework reference topics
 */
export const US_FRAMEWORKS: FrameworkConfig[] = [
    {
        id: "CCPA",
        name: "CCPA (California Consumer Privacy Act)",
        llm: COMPLIANCE_LLM_MAP["CCPA"],
        region: "US",
        description: "California data privacy law - AB 375, consumer rights & opt-out"
    },
    {
        id: "HIPAA",
        name: "HIPAA (Health Insurance Portability)",
        llm: COMPLIANCE_LLM_MAP["HIPAA"],
        region: "US",
        description: "US Federal Law protecting sensitive patient health information (PHI)"
    },
    ...GLOBAL_FRAMEWORKS
];

/**
 * Get frameworks by region
 */
export function getFrameworksByRegion(region: 'BR' | 'EU' | 'US'): FrameworkConfig[] {
    if (region === 'US') return US_FRAMEWORKS;
    return region === 'BR' ? BR_FRAMEWORKS : EU_FRAMEWORKS;
}

/**
 * Get LLM model for a specific framework
 */
export function getLLMForFramework(frameworkId: string): string {
    return COMPLIANCE_LLM_MAP[frameworkId] || 'openai/gpt-4o-mini';
}
