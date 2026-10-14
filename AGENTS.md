# Gov IA — Codex

- Canonical repository: `cnegrao/code-guard-governance`.
- Git is the state source. Resume from branch, HEAD, diff and merged code, never conversation history.
- Pursue one objective per session; use the shared [operating model](docs/agent/OPERATING_MODEL.md).
- Locate relevant architecture through [ARCHITECTURE_INDEX.md](docs/agent/ARCHITECTURE_INDEX.md); do not read every ADR.
- Never edit historical migrations.
- Hosted mutation requires explicit Carlos authorization. Deployment and production changes require explicit authorization.
- Stop on architecture conflict, missing dependency, a historical migration or hosted mutation requirement, or scope ambiguity. Report the blocker before proceeding.
- No review-of-review loops or repeated full-regression loops.
