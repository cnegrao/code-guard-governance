
import type { LicenseStatus } from '../license/manager';
import { GDPRScanner } from './gdpr';
import { LGPDScanner } from './lgpd';
import { CCPAScanner } from './ccpa';
import { AIActScanner } from './ai_act_preview';
import { Violation } from './gdpr';

import { ReportGenerator } from '../report/generator';
import type { TechnicalScanReport } from '../report/types';

import { PCIScanner } from './pci';
import { HIPAAScanner } from './hipaa';
import { OWASPScanner } from './owasp';
import { ShadowAPIScanner } from './shadowApi';

export class TechnicalScanEngine {
    static scanCode(content: string, license: LicenseStatus, hasCredits: boolean = false, fileName = 'scanned input'): TechnicalScanReport {
        let violations: Violation[] = [];

        // 1. Run Scanners
        const gdprViolations = GDPRScanner.scan(content);
        // PLG: Shadow API Detection (Free Tier High Value)
        const shadowApiViolations = ShadowAPIScanner.scan(content);

        violations = [...gdprViolations, ...shadowApiViolations];

        // Unlock advanced scanners if Paid License OR Has Credits
        const isUnlocked = license.plan !== 'FREE' || hasCredits;

        if (isUnlocked) {
            const lgpdViolations = LGPDScanner.scan(content);
            const ccpaViolations = CCPAScanner.scan(content);
            const aiActViolations = AIActScanner.scan(content);
            const pciViolations = PCIScanner.scan(content);
            const hipaaViolations = HIPAAScanner.scan(content);
            const owaspViolations = OWASPScanner.scan(content);

            violations = [
                ...violations,
                ...lgpdViolations,
                ...ccpaViolations,
                ...aiActViolations,
                ...pciViolations,
                ...hipaaViolations,
                ...owaspViolations
            ];
        }

        return ReportGenerator.generate(violations.map(f => ({ ...f, file: fileName })), license.plan, [fileName], {
            acquisition: content.trim().length === 0 ? 'EMPTY_INPUT' : 'INPUT_PROVIDED',
            detectors_run: ['GDPR', 'Shadow API', ...(isUnlocked ? ['LGPD', 'CCPA', 'AI Act', 'PCI', 'HIPAA', 'OWASP'] : [])],
            detector_access: license.plan !== 'FREE' ? 'PAID' : hasCredits ? 'CREDITS' : 'FREE',
            finding_limit: isUnlocked ? violations.length : license.maxViolations,
        });
    }
}
