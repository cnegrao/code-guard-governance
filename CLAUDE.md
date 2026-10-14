# Gov IA — Claude Code

- Canonical repository: `cnegrao/code-guard-governance`.
- Resume from Git (branch, HEAD, diff and merged code), not conversation history.
- One objective per session. Follow the shared [operating model](docs/agent/OPERATING_MODEL.md).
- Use the [architecture index](docs/agent/ARCHITECTURE_INDEX.md) to load only relevant architecture.
- Never edit historical migrations. Hosted mutation requires explicit Carlos authorization; deployment and production changes require explicit authorization.
- Stop on architecture conflict, missing dependency, a historical migration or hosted mutation requirement, or scope ambiguity.
- No review-of-review loops or repeated full-regression loops.
