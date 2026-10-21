
export interface Violation {
    rule: string;
    severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
    line: number;
    match: string;
    message: string;
    category: 'GDPR' | 'LGPD' | 'CCPA' | 'HIPAA' | 'PCI' | 'OWASP' | 'AI_ACT' | 'SECURITY';
    suggestedFix?: string;
    fixDescription?: string;
}

export class GDPRScanner {
    static scan(content: string): Violation[] {
        const violations: Violation[] = [];
        const lines = content.split('\n');

        const rules = [
            {
                // Email hardcoded - Critical
                regex: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/,
                severity: 'CRITICAL',
                message: 'Hardcoded Email detected. Potential Personal Data leak.',
                rule: 'GDPR_EMAIL_HARDCODED'
            },
            {
                // SSN / CPF patterns (Simplified) - Critical
                regex: /\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/, // CPF logic in LGPD usually, but GDPR implies national ID
                severity: 'CRITICAL',
                message: 'Potential National ID (CPF/SSN) pattern detected.',
                rule: 'GDPR_NATIONAL_ID'
            },
            {
                // Secrets / Tokens - Critical
                regex: /(sk_live_|AIza|eyJ[a-zA-Z0-9_-]{10,})/,
                severity: 'CRITICAL',
                message: 'Potential Secret Key or Token detected.',
                rule: 'GDPR_SECRET_EXPOSED'
            },
            {
                // Generic Hardcoded Credentials (Teaser for Pro Security) - Critical
                regex: /\b(password|senha|passwd|api_key|access_token|secret)\s*[:=]\s*["'][^"']{3,}["']/,
                severity: 'CRITICAL',
                message: 'Hardcoded Credential detected. High security risk.',
                rule: 'SEC_HARDCODED_CREDENTIAL'
            },
            {
                // Logging Personal Data - Critical/High
                regex: /console\.log\s*\(\s*.*(email|user|password|token|creds).*\)/,
                severity: 'CRITICAL',
                message: 'Potential sensitive-data logging pattern detected. Review the logged fields.',
                rule: 'GDPR_LOGGING_SENSITIVE'
            }
        ];

        lines.forEach((line, index) => {
            for (const rule of rules) {
                const match = line.match(rule.regex);
                if (match) {
                    let fix = '';
                    let desc = '';

                    // Smart Fix Logic (Simple Heuristics)
                    if (rule.rule === 'SEC_HARDCODED_CREDENTIAL') {
                        const variableName = match[0].split(/[=:]/)[0].trim();
                        fix = `const ${variableName} = process.env.${variableName.toUpperCase()}_KEY;`;
                        desc = 'Move hardcoded secret to Environment Variable.';
                    } else if (rule.rule === 'GDPR_EMAIL_HARDCODED') {
                        fix = '// [REDACTED] Personal Data removed by CodeGuard';
                        desc = 'Remove PHI/PII from source code.';
                    }

                    violations.push({
                        category: 'GDPR',
                        rule: rule.rule,
                        severity: rule.severity as any,
                        line: index + 1,
                        match: match[0],
                        message: rule.message,
                        suggestedFix: fix,
                        fixDescription: desc
                    });
                }
            }
        });

        return violations;
    }
}
