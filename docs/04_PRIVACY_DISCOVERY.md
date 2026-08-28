# Privacy & Sensitive Data Discovery — V4 FINAL

## Objective
Identify which categories of personal, sensitive or regulated data an agent can access, process, transmit, produce or persist without unnecessarily copying the underlying sensitive values into Gov IA.

## Target detector stack
1. **Lexical / Name Detector** — names of fields, DTO properties, columns, prompt variables and labels.
2. **Value Pattern Detector** — structured value patterns such as national identifiers, e-mail, phone, IBAN/card candidates where safe/applicable.
3. **Checksum / Domain Validator** — validate candidates when a domain-specific checksum/format rule exists.
4. **Structural / Schema Detector** — SQL/DDL, ORM, Prisma, Pydantic, TypeScript, OpenAPI/JSON Schema, protobuf/Avro and equivalent structures.
5. **Context Detector** — surrounding function/class/table/endpoint/prompt/data-flow context.
6. **Semantic Detector** — infer meaning for opaque, translated or domain-specific names.
7. **Correlation Engine** — combine signals into classification + confidence + evidence.
8. **Human/System Validation** — authoritative confirm/reject/reclassify.

## Privacy taxonomy examples
- PERSONAL_DATA
- SENSITIVE_PERSONAL_DATA
- IDENTIFICATION_DATA
- CONTACT_DATA
- LOCATION_DATA
- FINANCIAL_DATA
- BIOMETRIC_DATA
- GENETIC_DATA
- HEALTH_DATA
- RACIAL_ETHNIC_DATA
- RELIGIOUS_DATA
- POLITICAL_DATA
- TRADE_UNION_DATA
- SEXUAL_LIFE_ORIENTATION_DATA
- CHILD_ADOLESCENT_DATA
- CREDENTIAL_AUTHENTICATION_DATA
- DEVICE_ONLINE_IDENTIFIER
- BEHAVIORAL_PROFILING_DATA
- EMPLOYMENT_DATA
- CRIMINAL_JUDICIAL_DATA

`privacy category`, `data subtype`, `risk severity` and `legal/regulatory classification` are different dimensions and must not be collapsed.

## Evidence rule
Prefer storing:
- category/subtype
- source object/resource
- file/path/line/symbol when applicable
- detector/method(s)
- confidence
- validation status
- evidence fingerprint/hash where useful
- timestamps/provenance

Avoid storing raw CPF/passport/health/etc. values unless explicitly justified.

## As-is Dênio scanner
The current `standalone-compliance-scanner/src/core/enrichment/lgpd-pii.ts` is primarily lexical/name regex scanning. It is a useful `LexicalPrivacyDetector` seed, but it does NOT yet prove the target semantic/checksum/schema/context engine.

Known as-is cautions:
- rules often detect the word `cpf`, not the CPF value itself;
- broad terms such as `cliente`, `paciente`, `aluno` may create false positives;
- `paciente` alone should not automatically prove health-data processing;
- date of birth is personal data but is not automatically LGPD sensitive personal data;
- CNPJ should not be blindly classified as personal data without context.
