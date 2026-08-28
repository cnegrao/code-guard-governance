# VS Code / Codex Start Procedure — V4 FINAL

## Current safe Git posture
- `origin`: user's fork and development source of truth.
- `upstream`: Dênio `negraodenio/code-guard-governance`, fetch/read-only; push disabled.
- Do not use `git pull`, merge or rebase from upstream before an explicit reconciliation plan.

## Install this spec pack
Place `AGENTS.md` at repository root and merge/copy the `docs/` files. Keep `README_V4_PROPOSED.md` separate; do not overwrite existing `README.md` automatically.

## First Codex instruction
```text
Leia AGENTS.md e todos os documentos em docs/. Não altere nenhum arquivo.
Valide o estado atual do repositório contra docs/14_WAVE_01.md e docs/13_AS_IS_VS_TARGET.md.
Considere o upstream do Dênio apenas como referência read-only.
Produza:
1) inventário do que já existe por módulo;
2) gaps reais contra a V4;
3) plano de implementação por arquivo/migration;
4) riscos de segurança, dados e compatibilidade;
5) testes necessários;
6) ordem recomendada dos commits.
Não implemente nada. Aguarde aprovação.
```

## Execution discipline after plan approval
One backlog item → inspect diff → tests/typecheck/build → small commit. Database migration requires explicit 3NF model review before execution.
