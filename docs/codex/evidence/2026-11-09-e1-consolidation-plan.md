# E1 — plano de consolidação, sem executar commits

**Estado: PLAN_ONLY. Nenhum staging, commit, push ou merge foi executado.**

Worktree confirmado pelo Git: `D:\code-guard-governance\.worktrees\e1-operator-unblock`. O caminho abreviado no pedido foi resolvido para esse worktree já utilizado pelo E1. Branch `fix/e1-operator-unblock`; HEAD/base `a5f85bf099fdbf0a24f1a369e4428730a042a162`; origin `https://github.com/cnegrao/code-guard-governance.git`. O índice está vazio.

O inventário inicial contém **55 arquivos: 16 rastreados modificados e 39 não rastreados**. Todos estão atribuídos ao plano, sem arquivos órfãos. Os três documentos desta preparação acrescentam três arquivos não rastreados: este plano, o [inventário completo](2026-11-09-e1-consolidation-inventory.json) e o [handoff](../../agent/E1_HANDOFF.md). Portanto, a entrega contém **58 candidatos: 16 modificados e 42 novos**, antes de qualquer alteração futura.

O JSON lista **cada caminho**, status, tamanho, SHA-256, commits propostos, dependências, instruções de staging parcial e evidências de teste. Não contém dumps ou conteúdo de credenciais. Nenhum SHA de commit foi inventado: todos permanecem `null` até uma execução posterior autorizada.

## Sequência proposta

| Ordem | Título proposto | Conteúdo e motivo da separação |
| --- | --- | --- |
| C1 | `feat(auth): add governed operator invitation` | Convite administrativo, ativação, API/serviço, CLI, migração aditiva de convite, testes de API/PostgreSQL e recibo exato do sucessor no inventário operacional. Inclui somente a liberação da página accept-invitation no middleware. |
| C2 | `fix(auth): stabilize E1 localhost login and diagnostics` | Login com navegação same-origin, cookie/JWT existentes, alias localhost, recusa de POST no alias e diagnóstico sem segredos. Inclui o README operacional final, após o convite estar presente. |
| C3 | `fix(routes): decode canonical and review identifiers once` | Correção de uma camada de URI no Passport e no review, regressões e evidências de acesso. Não inclui o novo cartão de materialização nem a nova proveniência. |
| C4 | `docs(e1): record Passport alignment and real profile governance` | Recibos sanitizados da aplicação anterior de 25 variantes M16/M17 e da investigação da proposta real. Não copia o pacote pertencente a outro worktree e não executa SQL. |
| C5 | `fix(governance): materialize exact governed technical profiles` | Pacote SQL auditado de seis arquivos, fronteira governada, adaptador, ação explícita de interface, testes e relatórios de revisão/aplicação. O SQL já foi aplicado; o commit apenas o preserva. Ver pendência de registro canônico abaixo. |
| C6 | `fix(passport): project technical profile governance lineage` | Projeção somente de leitura, DTO de apresentação, certificação/reconciliação/recibo separados, suporte INFERRED preservado e testes da proveniência com evidências reais. |
| C7 | `docs(e1): record consolidation inventory and session handoff` | Os três documentos desta preparação. Deve registrar a decisão de fechamento e, somente após execução autorizada, os SHAs reais produzidos. |

Dependências: C1 → C2 → C3 → C4; C5 depende de C1/C3/C4; C6 depende de C3/C5; C7 encerra a sequência. Nenhum commit pode ser criado com `git add .` ou inclusão indiscriminada de diretórios, pois isso quebraria as separações abaixo.

## Staging parcial obrigatório em três arquivos

1. `apps/dashboard/middleware.ts`: C1 recebe **apenas** `pathname === "/accept-invitation"` na condição de página pública. C2 recebe import/eventos de diagnóstico e tratamento do alias localhost. O diff atual reúne mudanças em um mesmo hunk; será necessário separar por linhas/patch, não adicionar o arquivo inteiro em C1.
2. `apps/dashboard/app/(dashboard)/governance/reviews/[id]/page.tsx`: C3 recebe import de `reviewSubjectIdFromRouteParam` e decodificação de `params.id`. C5 recebe import e render do cartão `TechnicalProfileMaterialization`.
3. `apps/dashboard/tests/passport-ui-route.test.ts`: C3 recebe import de `getDynamicParam` e os três testes de decodificação. C6 recebe o tipo `ProfileFact`, `profileTraceView` e os dois testes de proveniência. O import de tipos e o import Next aparecem próximos no mesmo hunk e precisam ser tratados separadamente.

As fronteiras foram conferidas no diff real. Os testes comprovaram o **estado combinado atual**; os prefixos intermediários ainda não foram montados/testados individualmente, porque o índice e os commits devem permanecer intocados nesta tarefa. Na execução futura, conferir o diff staged e os testes aplicáveis a cada prefixo antes do commit; não reescrever a implementação para tornar o staging conveniente.

## Verificações e cobertura

- **40/40 testes focados executados nesta preparação**: autenticação E1 4, convite/API 5, rotas review 2, integração técnica 5 e inventário de migrações 24. Nenhuma conexão hospedada foi aberta.
- **105/105 testes Passport reutilizados**: 82 query e 23 UI. Os hashes dos sete arquivos fixados no recibo final continuam iguais aos bytes presentes no E1. Não houve nova alteração de código de produto nesta preparação.
- Typecheck dashboard: PASS do candidato final anterior, reutilizado. Nenhum arquivo de implementação TypeScript foi alterado desde essa prova.
- PostgreSQL local: evidências anteriores de convite (7) e correção técnica/transporte (8), sem nova execução nesta preparação. O manifesto técnico confirmou SQL, teste e dependências exatos.
- `node ops/agent-version-profile-v1/package.mjs --check`: **PASS**, sem regenerar manifesto ou transporte.
- Sintaxe do CLI administrativo: `node --check scripts/admin/issue-operator-invitation.mjs`: **PASS**.
- `git diff --check`: **PASS**. Nenhuma modificação em migração histórica ou `packages/canonical-contracts`.
- `.gitattributes` fixa texto em LF, inclusive SQL e manifesto; isso prevalece sobre core.autocrlf=true. Preservar os hashes auditados, sem normalizar/regenerar arquivos para esconder divergências.

Não foi repetida uma regressão geral nem uma auditoria do Supabase. O inventário canônico local contém o checkpoint congelado de 109 migrações mais o convite E1 exato; o PASS de seus testes **não comprova o registro canônico da correção técnica ainda fora desse diretório**.

## Pendências concretas

**I1 — Registro canônico da migração técnica incompleto.** `20261109191942_agent_version_technical_profile_governed_mapping_v1.sql` está aplicado no teste e preservado em `ops/agent-version-profile-v1`, mas não em `supabase/migrations`. O helper operacional admite somente o convite como sucessor do checkpoint congelado. Isso não invalida os testes do SQL aplicado nem impede salvar o código auditado em commits locais; impede declarar o inventário canônico definitivamente consolidado.

Antes de um fechamento sem essa pendência, preparar um sucessor de consolidação separado: cópia byte a byte do SQL aprovado para seu caminho canônico, recibo operacional exato e testes dessa nova entrada. Não alterar o checkpoint congelado, suas 109 migrações, contratos ou manifests históricos. **Não reaplicar SQL no banco.** Esse ajuste não foi implementado nesta tarefa de inventário/plano e ainda não integra os sete commits de arquivos existentes.

**I2 — Cobertura direta do CLI administrativo.** Há testes da API, do serviço/banco e evidência de emissão real, mas não foi encontrado teste rastreável que exercite diretamente `validateInvitationInput` ou a orquestração de `scripts/admin/issue-operator-invitation.mjs`. O CLI passou na verificação de sintaxe. Recomenda-se acrescentar regressão offline desse executável antes de declarar cobertura automatizada completa; não emitir novo convite ou criar usuário para testar. Não há falha funcional comprovada do CLI neste inventário.

**I3 — Pacote M16/M17 de outro worktree.** Os recibos E1 referenciam `passport-compat-v1`, preparado em `passport-compat-package`. Seus arquivos não foram copiados, examinados como candidato ou misturados ao plano E1. Se esse pacote ainda precisar de consolidação própria, tratar no worktree responsável, em escopo separado. Os quatro documentos de C4 são evidências já presentes no E1, não uma importação da implementação externa.

**I4 — Handoff automático.** A recusa anterior do gerador local, que classifica o nome `ops/agent-version-profile-v1/deployment.sql` como escopo de implantação, continua registrada. Nenhum guard foi desabilitado ou tentativa idêntica repetida. O handoff documental desta entrega cobre a transferência; não se alega aprovação automática do gerador. Essa classificação não é uma falha funcional do Passport nem uma autorização de implantação.

Não foi identificada outra implementação de produto interrompida entre os arquivos inventariados. Aprovação individual de campo UNKNOWN é uma fronteira deliberada, não um TODO. Declarações antigas de bloqueio/aguardo nos relatórios são snapshots históricos e não devem ser reescritas: o handoff aponta o estado posterior que as supera.

## Exclusões e preservação

A varredura limitada dos 55 candidatos procurou formatos conhecidos de JWT literal, token Supabase/GitHub/provedor, chave privada, URL PostgreSQL com senha e tipos de arquivos privados. **Nenhuma ocorrência foi encontrada.** Isso é uma verificação delimitada, não garantia universal de ausência de todos os formatos de segredo. O diff staged deve ser revisado novamente antes de qualquer commit futuro.

Excluir expressamente `.artifacts/**`, `.env*`, estado privado Supabase, node_modules, .next, out, dumps, SQLs de backup legível, activation-code.txt, session-signing-key e logs temporários. As regras Git ignoram os caminhos privados conhecidos. Os recibos JSON públicos contêm nomes de arquivos de backup, tamanhos, hashes, IDs e localização privada; não contêm os backups, códigos de ativação, senhas ou cookies. `deployment.sql` e `integrity.sql` são código auditado do pacote, não dumps ou logs.

Usar a lista explícita do JSON para preparar cada commit somente após autorização. Não importar mudanças do worktree principal, E0, M17.5, M18, passport-404 ou qualquer outro. Nenhum comando de rede Git, push, merge, cherry-pick ou checkout foi executado.

**Parada solicitada respeitada: plano entregue, índice vazio e HEAD inalterado. A próxima sessão deve começar pelo [E1_HANDOFF.md](../../agent/E1_HANDOFF.md), conferir Git e obter a decisão do usuário antes de criar commits.**
