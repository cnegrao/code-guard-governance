
import { Violation } from './gdpr';

export class AIActScanner {
    static scan(content: string): Violation[] {
        const violations: Violation[] = [];
        const lines = content.split('\n');

        // Heuristics for "High Risk" systems under EU AI Act
        const heuristics = [
            {
                pattern: /(creditScore|riskScore|socialScore|trustScore)/i,
                message: 'Scoring/profiling-related identifier detected. Review its actual purpose and use.',
                rule: 'AI_ACT_SOCIAL_SCORING'
            },
            {
                pattern: /(biometric|facial|fingerprint|retina|emotion)/i,
                message: 'Biometric-related identifier detected. Review whether biometric data is processed.',
                rule: 'AI_ACT_BIOMETRICS'
            },
            {
                pattern: /(predict|approve|reject|decide)\s*\(.*(loan|hire|fire|exclude|grant).*\)/i,
                message: 'Potential automated-decision call pattern detected. Review its purpose and affected subjects.',
                rule: 'AI_ACT_AUTOMATED_DECISION'
            },
            {
                pattern: /(race|religion|political|union|genetic|orient)/i,
                message: 'Potential sensitive-category identifier detected. Review its actual data context.',
                rule: 'AI_ACT_SENSITIVE_DATA'
            }
        ];

        lines.forEach((line, index) => {
            for (const heuristic of heuristics) {
                const match = line.match(heuristic.pattern);
                if (match) {
                    violations.push({
                        category: 'AI_ACT',
                        rule: heuristic.rule,
                        severity: 'LOW', // Always warn/low/info for Preview
                        line: index + 1,
                        match: match[0],
                        message: `[PREVIEW] ${heuristic.message} (Heuristic technical pattern; review required).`
                    });
                }
            }
        });

        return violations;
    }
}
