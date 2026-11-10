# E1 — consolidação local concluída

Data: 2026-11-10. Worktree D:\code-guard-governance\.worktrees\e1-operator-unblock; branch fix/e1-operator-unblock; base a5f85bf099fdbf0a24f1a369e4428730a042a162. O plano de 09/11 é o snapshot histórico de preparação; este relatório registra a execução autorizada. Nenhum push, merge, rebase ou reescrita de histórico. Nenhum banco alterado.

| ID | Hash | Escopo |
| --- | --- | --- |
| C1 | `a145375b1c3efb75f4fd826b864c701ff245509e` | feat(auth): add governed operator invitation |
| C2 | `9178ae40f7ecd3a36fe3dc37bb0f36974983dcf9` | fix(auth): stabilize E1 localhost login and diagnostics |
| C3 | `fa9f876556ab0c5d7a09936b78cdf0ba1f322268` | fix(routes): decode canonical and review identifiers once |
| C4 | `2a7d1ac67b50903f5d7c4a7ada38d443776bf26c` | docs(e1): record Passport alignment and real profile governance |
| C5 | `138f42f5a8111d51052745a2b7413dfd29e30ea5` | fix(governance): materialize exact governed technical profiles |
| C6 | `18628c6501824eda61034f7d74edc8c2a9825e41` | fix(passport): project technical profile governance lineage |
| C7 | Commit que contém este documento: resolver com git log -1 --format=%H -- docs/agent/E1_HANDOFF.md | Inventário e handoff |

Não se insere um hash inventado/autorreferente para o próprio commit documental. Git é a autoridade para o SHA de C7.

## Gates concluídos

A migração 20261109191942 foi copiada byte a byte para supabase/migrations. SHA-256 9c22c983eb1cd9cd48329b7d153b555de48ba2c4475ffe7b5eb70f55726e60a6. Uma consulta READ ONLY confirmou versão/nome, uma statement com esse hash e 101 entradas no teste autorizado. Não houve reaplicação SQL. O inventário local contém 109 históricas intactas e dois sucessores exatos E1, total 111. Nenhum contrato canônico foi alterado. Ver [registro](2026-11-10-e1-migration-registration.json).

O CLI recebeu cinco testes diretos: validação de argumentos; fluxo com processos simulados; proteção da entrega e hash do bearer; link divergente; falhas de ACL/transporte/recibo; entrypoint real com argumentos que falham antes de rede. Nenhum convite real foi emitido e nenhuma correção de produto no CLI foi necessária.

Cada staging usou lista explícita, revisão do diff, git diff --cached --check e verificação delimitada de formatos de segredos. Os três casos de staging parcial foram respeitados. O incremento do inventário técnico ficou em C5, mantendo apenas o convite em C1. Não houve git add . ou -f.

Validações em cópias exportadas do índice, sem código reservado a commits posteriores: C1 34 testes/typecheck; C2 4 testes; C3 23 testes; C4 JSONs; C5 34 testes/typecheck/pacote; C6 105 testes/typecheck. Total 155 testes distintos, 200 execuções por prefixo com sobreposição deliberada. C7 valida documentos, pacote e escopo. As regressões PostgreSQL anteriores permanecem preservadas e não foram reexecutadas. Duas falhas locais de instrumentação/teste foram corrigidas e constam do JSON; nenhum guard foi desabilitado.

## Integração separada e transferência

O [backlog M16/M17](2026-11-10-m16-m17-integration-backlog.json) lista 65 artefatos/hashes e a correlação das 25 variantes já aplicadas. Apenas metadados entraram em E1. Consolidar o pacote em seu próprio worktree em etapa autorizada separada, com testes offline e revisão; não reaplicar variantes.

O [handoff atualizado](../../agent/E1_HANDOFF.md) é a entrada da próxima sessão. Backups, SQL de dados, códigos, chaves, runtime e logs permanecem ignorados. O pacote SQL auditado é código, não dump. Planos e recibos antigos mantêm seus estados históricos; este fechamento os supera. A limpeza final e os sete hashes são conferidos após C7 e entregues ao usuário, sem modificar novamente este documento para inserir seu próprio hash.
