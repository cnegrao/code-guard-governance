
import { Violation } from './gdpr';

export class PCIScanner {
    static scan(content: string): Violation[] {
        const violations: Violation[] = [];
        const lines = content.split('\n');

        const rules = [
            {
                // Simple Luhn-like regex or standard CC patterns (simplified for V1 speed)
                // Visa, MasterCard, Amex, Discover
                regex: /\b(?:4[0-9]{12}(?:[0-9]{3})?|5[1-5][0-9]{14}|3[47][0-9]{13}|6(?:011|5[0-9]{2})[0-9]{12})\b/,
                severity: 'CRITICAL',
                message: 'Potential credit-card number pattern detected by the PCI detector.',
                rule: 'PCI_PAN_EXPOSED'
            },
            {
                regex: /\b(cvv|cvc|cvn)\s*[:=]\s*[0-9]{3,4}\b/i,
                severity: 'CRITICAL',
                message: 'CVV/CVC code detected. NEVER log or store sensitive authentication data.',
                rule: 'PCI_SAD_EXPOSED'
            },
            {
                regex: /track2|magnetic/i,
                severity: 'CRITICAL',
                message: 'Track2-related term detected. Review whether sensitive track data is stored.',
                rule: 'PCI_TRACK_DATA'
            }
        ];

        lines.forEach((line, index) => {
            for (const rule of rules) {
                const match = line.match(rule.regex);
                if (match) {
                    violations.push({
                        category: 'SECURITY', // PCI falls under robust security
                        rule: rule.rule,
                        severity: rule.severity as any,
                        line: index + 1,
                        match: match[0],
                        message: rule.message
                    });
                }
            }
        });

        return violations;
    }
}
