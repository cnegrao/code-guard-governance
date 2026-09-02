# Codex Project Context

This directory is the repository's canonical continuity package for Codex work. It records current operational context, approved local architecture decisions, open security findings, real blockers, controlled runtime evidence, and concise handoffs without turning chat history into project authority.

## Required reading order

1. `README.md`
2. `CURRENT_STATE.md`
3. `ARCHITECTURE_DECISIONS.md`
4. `SECURITY_FINDINGS.md`
5. `BLOCKERS.md`
6. The latest dated file in `evidence/`
7. The latest dated file in `handoffs/`

Use `WORK_LOG.md` when a compact chronology is needed.

## Authority hierarchy

When sources differ, use this order:

1. Executable and versioned repository code and migrations.
2. Approved ADRs and architecture documents.
3. Controlled runtime evidence from `docs/codex/evidence/` (G2-E3, G2-E4, etc.).
4. `docs/codex/ARCHITECTURE_DECISIONS.md`.
5. `docs/codex/CURRENT_STATE.md`.
6. `docs/codex/SECURITY_FINDINGS.md`.
7. `docs/codex/BLOCKERS.md`.
8. Dated handoffs and `docs/codex/WORK_LOG.md`.
9. Recovery transcripts, chat history, and session history, which are historical evidence only and are never executable or architecture authority.

## Continuity rules

- Do not reconstruct project authority from chats or session history.
- Do not promote recovery transcripts into canonical authority.
- Do not infer missing product or architecture decisions.
- If repository evidence and the canonical files remain ambiguous, stop and request a Product Owner decision.
- Preserve existing database comments classified `KEEP` unless an explicit scope authorizes changing them.
- Database or Supabase operations require explicit scope authorization.

Recovery material may help locate evidence, but every operative conclusion must be checked against higher-authority sources above.
