# E1 — handoff após consolidação local

Atualizado em **2026-11-10**. Este estado supera o plano de 09/11, mantido como evidência histórica.

## Retomar pelo Git

Worktree: `D:\code-guard-governance\.worktrees\e1-operator-unblock`. Branch: `fix/e1-operator-unblock`. Repositório `cnegrao/code-guard-governance`. Base anterior `a5f85bf099fdbf0a24f1a369e4428730a042a162`.

Foram separados convite/CLI, login, rotas, evidências, materializador/registro canônico, proveniência e documentação. O [relatório](../codex/evidence/2026-11-10-e1-finalization.md) e JSON registram os seis hashes de implementação/evidências. Resolver o hash do próprio commit documental com git log -1 --format=%H -- docs/agent/E1_HANDOFF.md. Conferir git status e git log antes de agir; não retomar o antigo plano como se ainda não houvesse commits.

Nenhum push, merge, rebase ou reescrita foi autorizado ou executado. A autorização de commits locais não autoriza publicação.

## Gates fechados

A migração 20261109191942 está em supabase/migrations, byte a byte igual ao artefato em ops, SHA-256 9c22c983eb1cd9cd48329b7d153b555de48ba2c4475ffe7b5eb70f55726e60a6. Leitura do histórico confirmou versão/nome/hash e 101 entradas. Não reaplicar SQL. Fonte local: 109 históricas congeladas mais convite 20261108002618 e perfil 20261109191942, total 111. Contagens diferentes não autorizam db push ou repair em massa.

O CLI tem cinco regressões diretas offline, sem emissão real. A validação de cada prefixo do índice passou; 155 testes distintos cobertos, typecheck em C1/C5/C6, pacote --check e todos os diffs staged --check. Os três arquivos compartilhados foram separados por hunks.

## Estado funcional conhecido

Projeto permitido zkqfvqwqdypgpzauzinw / GOVIA_DEMO. **gov-ia-dev é proibido.** Nesta finalização somente houve leitura do histórico, sem alteração de banco.

As 25 variantes M16/M17 foram aplicadas anteriormente; a migração técnica veio depois, totalizando 101. O humano já materializou LangGraph: recibo ceb7f82b-3207-4a1f-8374-24df028fb403, APPLIED em 2026-11-09T23:29:16.741+00:00. Relatórios anteriores de aguardo do clique são snapshots de outra etapa. Não repetir Discovery, convites, certificações, reconciliações ou materializações.

A proveniência real foi validada por leitura e renderização de servidor em 2026-11-10T01:35:20.357Z, sem sessão inventada ou cookies exportados. Certificação da versão, reconciliação da identidade e recibo técnico estão separados; aprovação individual do campo permanece UNKNOWN, trust INFERRED.

AGENT canonical-object:06b5f654e2b57694e6fd973d42275309a1149313792569ee2e9ed2cfe2eb1d81.

AGENT_VERSION canonical-object:1e85ebd0823bc0355300fa46d0fefaee8c45281658ce27a200feac8e2e4efec1.

Consultar o Passport com versão explícita; o AGENT lógico não herda o framework. Campos sem evidência seguem UNKNOWN.

## Pendência separada

O código passport-compat-v1 continua no worktree passport-compat-package, branch feat/passport-test-compat-package. O [backlog](../codex/evidence/2026-11-10-m16-m17-integration-backlog.md) e JSON listam 65 artefatos/hashes e as 25 variantes aplicadas. Só metadados entraram em E1. Consolidar o pacote na origem e planejar integração apenas sob nova instrução; não copiar indiscriminadamente código nem misturar M17.5/M18 de outros worktrees.

## Preservação

Backups, SQL legível com dados, activation-code.txt, chave de sessão, ambiente, credenciais, runtime e logs ficam ignorados em .artifacts; nunca git add -f. Os recibos versionados são sanitizados. Não regenerar o manifesto auditado para refletir o estado hospedado posterior.

O gerador automático tinha a classificação de escopo conhecida para deployment.sql; nenhum guard foi desabilitado. Este handoff documental não alega PASS daquele gerador. Nenhuma nova ação hospedada é necessária. Encerrar após os commits locais e aguardar nova instrução.
