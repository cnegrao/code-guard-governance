---
name: govia-slice
description: Execute one authorized Gov IA implementation slice with scoped architecture reading, verification and handoff.
---

Follow [OPERATING_MODEL.md](../../../docs/agent/OPERATING_MODEL.md).
Use [ARCHITECTURE_INDEX.md](../../../docs/agent/ARCHITECTURE_INDEX.md) and read only pointers relevant to the requested slice.
Inspect merged implementation patterns before inventing abstractions.
Run `node scripts/agent/preflight.mjs --expected-base <sha> --branch <name>` before implementation.
Use focused verification while coding, integration when candidate-ready, and final verification once.
Stop on repeated failure, architecture conflict or any shared stop condition; record the next action.
Generate handoff with `scripts/agent/handoff.mjs`.
Never perform hosted mutation. Never open or merge a PR unless explicitly requested.
