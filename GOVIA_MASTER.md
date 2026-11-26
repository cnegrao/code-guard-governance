# GOV IA — MASTER ÚNICO DE GOVERNANÇA, RECUPERAÇÃO E EXECUÇÃO

**Arquivo oficial:** `GOVIA_MASTER.md` na raiz de `cnegrao/code-guard-governance`  
**Documento ID:** `GOVIA-MASTER-001` · **Versão do conteúdo:** `1.0.5` · **Data de consolidação:** 23/11/2026 (Brasília)
**Aceite TA-001:** Carlos aceitou documentalmente o candidato `1.0.5-rc1` e autorizou este ajuste mínimo e a integração do [PR #94](https://github.com/cnegrao/code-guard-governance/pull/94), condicionados aos gates efetivos do GitHub e M15/M16 SUCCESS, sem bypass (`DEC-TA-001-DOC-ACCEPT`). Baseline `main@8ba80abb1cc9aa2e8a6ed01aff6ca8e428b92bb4`; conclusão documental e liberação do predecessor de TA-002 somente após publicação válida. Nenhum aceite funcional ou autorização de TA-002.
**Publicação histórica GOV-001:** [PR #88](https://github.com/cnegrao/code-guard-governance/pull/88) integrado à `main` em `2083ecff43e3569f6de7e7e03d07d5a60be2c097` · **Aprovador:** Carlos
**Baseline Git da regularização:** `main@2083ecff43e3569f6de7e7e03d07d5a60be2c097` · **Baseline histórica do PR #88:** `462751b239d1374f71337ddb6d525e27e1c9b267`  
**Escopo da aprovação:** matriz REC-01–14, Fase 0 documental e adoção de um arquivo único de gestão. Para GOV-001, Carlos aprovou a rc4 e a integração do PR #88, além de autorizar a regularização exclusiva deste arquivo e o fechamento após reconciliação das evidências (`DEC-GOV-001-ACCEPT`).

> **REGRA DE OURO — UMA FONTE DE GESTÃO:** este é o **único arquivo ativo** de plano, WBS, status, decisões, riscos, evidências, handoff e contrato operacional do GOV IA. A arquitetura congelada, ADRs, código, testes, migrações e workflows continuam existindo como **fontes técnicas de verdade e provas**, não como planos de gestão concorrentes. Excel, PDFs, checkpoints e pacotes anteriores são arquivos históricos: não receberão atualizações paralelas. Alteração de status só neste master, mediante evidência e autorização.

> **ESTADO CANÔNICO APÓS PUBLICAÇÃO VÁLIDA DE 1.0.4:** `M17.5 = OPEN` · `M18 = HOLD` · `FASE 0 = ENCERRADA DOCUMENTALMENTE` · `F0-007 = CONCLUÍDO DOCUMENTALMENTE` · `GOV-001 = DONE` · `GOV-002 = NÃO IMPLANTADO` · `EXPOSIÇÃO EXTERNA = NO-GO ATÉ DECISÃO ESPECÍFICA`. Aceite exclusivamente documental por Carlos (`DEC-F0-007-DOC-ACCEPT`); nenhum aceite funcional ou operacional. Nenhum registro neste arquivo constitui autorização automática de código, PR, merge, migração, banco, hosted, deploy, segredo ou publicação.

> **EFEITO APÓS PUBLICAÇÃO VÁLIDA DE 1.0.5:** `TA-001 = CONCLUÍDO DOCUMENTALMENTE` · `TA-002 = PENDENTE DE AUTORIZAÇÃO` · `TA-003/004 = BLOQUEADOS`. DEC-TA-001-DOC-ACCEPT sucede somente o estado documental TA-001 e a dependência de gestão TA-002; preserva integralmente Fase 0 encerrada, M17.5 OPEN, M18 HOLD, S1B/LX03 e A4 na rota SR2, REC-05/TEST, REC-09/quarentena, GOV-002 e exposição externa NO-GO.

## Índice operacional

1. [Painel de comando](#1-painel-de-comando-e-próxima-ação)
2. [Fontes e autoridade](#2-fontes-autoridade-e-escopo-do-documento)
3. [Contrato de governança dos agentes](#3-contrato-obrigatório-de-governança-dos-agentes)
4. [Gates GOV-001/GOV-002](#4-gov-001-e-gov-002--implantação-controlada)
5. [Matriz REC-01–REC-14](#5-matriz-de-recuperação-aprovada)
6. [Fase 0](#6-fase-0--estado-e-critérios-de-fechamento)
7. [Plano e WBS](#7-roadmap-integrado-e-wbs)
8. [M17.5/M18 e demonstração](#8-contratos-de-produto-e-critérios-de-aceite)
9. [UX enterprise](#9-experiência-enterprise--baseline-ds-0-a-ds-9)
10. [Decisões e evidências](#10-registro-aditivo-de-decisões-e-evidências)
11. [Riscos e responsabilidades](#11-riscos-e-responsabilidades)
12. [Custo, prazos, continuidade](#12-prazos-esforço-controle-de-progresso-e-handoff)
13. [Inventário dos fontes recuperados](#13-inventário-de-fontes-f0--77-arquivos-e-1-exclusão)
14. [Controle de versão e publicação](#14-controle-de-versão-e-critério-de-publicação)

## 1. Painel de comando e próxima ação

| Item | Situação documental em 23/11/2026; evidências históricas qualificadas | Próxima evidência necessária |
|---|---|---|
| GitHub `main` | Baseline `8ba80abb1cc9aa2e8a6ed01aff6ca8e428b92bb4` confirmada; master 1.0.4; publicação rc1 no PR #94, HEAD `4c4547634af4a5a1f13ae3b6d4a177ec5e32f7bd`, comprovada (EV-046); v1.0.5 aceita sob condição | Confirmar novo HEAD, arquivo/blob, M15/M16 SUCCESS, demais gates efetivos e merge do PR #94; SHA final somente após confirmação |
| Proteção `main` | `protected=false`, rulesets `[]` nas consultas de leitura | GOV-002: workflow verificado e ruleset efetivamente ACTIVE |
| CI existente | M15 regression e M16 PG17 security; histórico PASS no SHA citado | Não supor check required nem aceitação de M18 |
| Fase de recuperação | FASE 0 ENCERRADA DOCUMENTALMENTE e F0-007 CONCLUÍDO DOCUMENTALMENTE após publicação válida; F0-004–006 preservados, inclusive quarentena e condicionantes; 40 worktrees preexistentes preservados; inventário histórico 37/18 e 326 fingerprints mantido | Manter quarentena REC-09 e riscos residuais; nenhum aceite funcional/operacional |
| Sources locais exportados | 77 arquivos em 13 branches; teste Voyage excluído e mantido em quarentena | Duas ocorrências da linha 181 seguem SEGREDO_POTENCIAL; REC-09 bloqueado |
| M17.5 | OPEN | Fechamento V1 explícito com critérios e prova |
| M18 | HOLD; Executive S1 já integrado, não aceito | Respeitar predecessor M17.5 e aceite de personas |
| BYOM | Candidato funcional local, feature flag; não SaaS | Triagem de segurança/compatibilidade para autorização específica |
| SR2-A4 | BLOCKED; V2 preservada, V3 não promover; MPNet/Voyage experimentais | Nova hipótese e aceitação de qualidade, não tuning circular |
| Governança | GOV-001 DONE; GOV-002 NÃO IMPLANTADO; F0 encerrada documentalmente; aceite TA-001 DEC-TA-001-DOC-ACCEPT (EV-047); decisões/riscos anteriores preservados | Após publicação válida de 1.0.5: TA-001 CONCLUÍDO DOCUMENTALMENTE; TA-002 PENDENTE DE AUTORIZAÇÃO; TA-003/004 bloqueados |
| Demo externa | NO-GO | D01–D09 relevantes, ambiente, segurança e autorização do responsável |

**Ação corrente autorizada:** integrar o ajuste documental aceito no PR #94 somente após os gates do novo HEAD. **Próxima ação única após integração válida:** preparação de TA-002 sobre S1B/LX03, mediante autorização separada. TA-002/003/004 não iniciados; Fase 0 permanece encerrada documentalmente, sem nova dependência. Voyage em quarentena; GOV-002 permanece independente e não implantado.

**Permanecem congelados:** arquitetura L0–L16; 11 kinds, 12 relações, 16 famílias Passport; limite da autoridade de máquina em `PROPOSED`; S1 Executive/SEC-01 existentes; migrações históricas; verificações M15/M16 já pertinentes; decisões DEC-REC.

## 2. Fontes, autoridade e escopo do documento

### 2.1 Precedência normativa

1. **Arquitetura congelada, ADRs e roadmap do repositório**: limites do produto, regras de autoridade, gates, DoD. Este master não os revoga.
2. **Decisões explícitas de Carlos registradas aqui**: autorização de ação, prioridade, orçamento, mudança de escopo e aceite. As conversas originárias são comprovantes a reconciliar, não um registro de estado concorrente.
3. **Git, CI, ambientes e evidências**: comprovam o que foi implementado, testado, integrado e efetivamente implantado. O master nunca deve contrariar um fato técnico; se houver diferença, registrar conflito e STOP.
4. **Este `GOVIA_MASTER.md`**: **único registro corrente de gestão** de tarefas, status, decisões, riscos, roadmap operacional e próximo passo.
5. **Relatórios, conversas e documentos arquivados**: entradas para reconciliação, jamais fontes concorrentes para novas ações.

**Regra de conflito:** se Git, documentos arquiteturais, autorização e este master divergirem, abrir um `CONFLICT-ID` neste arquivo com evidências e dono; **não** escolher a versão conveniente nem produzir correção inferida. Se o próprio master estiver inacessível, iniciar apenas diagnóstico de localização e parar antes de implementar.

### 2.2 Repositórios e ambiente

- GOV IA: `https://github.com/cnegrao/code-guard-governance`; fonte de demo real: `https://github.com/cnegrao/govia-agent-source`, commit `cfa95f1ade234443435d4bd16c617fc847e35d91`.
- Ambiente operacional declarado: Windows e PostgreSQL de testes já existente. **Não** introduzir Docker, Linux/WSL, novo cluster ou novo banco como solução automática de dificuldade local.
- `AGENTS.md`, `CLAUDE.md`, `docs/agent/OPERATING_MODEL.md` e `docs/agent/ARCHITECTURE_INDEX.md` já existem no GitHub. São **instruções/índice técnico**; atualizá-los somente para apontar a este master e manter restrições técnicas existentes. Não criar outro registro paralelo de gestão em `docs/project-management/`.
- O checkpoint `.artifacts/agent/` é artefato local de evidência e não pode substituir o master versionado.

### 2.3 Termos de estado (eixos independentes)

| Estado | Definição / prova mínima |
|---|---|
| `PROPOSTO` | demanda registrada, sem autorização de execução |
| `AUTORIZADO` | Carlos autorizou a **classe específica** de operação e escopo; uma autorização de preparo não autoriza PR |
| `IMPLEMENTADO` | código identificado em arquivos/commit ou worktree; não implica teste ou integração |
| `TESTADO` | teste identificado, com candidato, ambiente, instante, logs e resultado |
| `INTEGRADO` | PR/merge comprovados na branch canônica |
| `CONCLUIDO_TECNICO` | resultado técnico verificável, não necessariamente aceito |
| `EVIDENCIA_HISTORICA` | prova de comportamento e contexto anterior, sem garantir estado atual |
| `ACEITO` | decisão de Carlos e critérios de aceite satisfeitos com evidência aplicável |
| `BLOCKED` | impedimento formal ou técnico com motivo, dono e condição de desbloqueio |
| `NOT_EVIDENCED` | lacuna de conhecimento ou prova, nunca interpretar como `PASS`, `0`, `COMPLIANT` ou defeito |
| `OPEN` / `HOLD` | estado de marco ou gate arquitetural; somente decisão formal altera |

**Não compactar esses estados em percentual estimado.** É possível estar simultaneamente `IMPLEMENTADO + TESTADO + INTEGRADO + NÃO ACEITO`.

## 3. Contrato obrigatório de governança dos agentes

### 3.1 Preflight — cinco perguntas que devem ter prova

Para cada tarefa, antes de qualquer edição, o agente (ChatGPT, Codex ou Claude) deve responder com referências específicas:

1. **Quem autorizou exatamente o quê?** `TASK_ID`, objetivo único, limites e classe de ação (análise, edição, execução de teste, PR, merge, TEST/hosted, deploy são classes diferentes).
2. **De qual baseline vou partir?** URL/branch/HEAD, SHA exato de `main`, `git status`, predecessor, bloqueios, contrato/ADR aplicável.
3. **O que já existe?** comparar código atual e histórico aprovado; descrever o menor delta por caminho e evitar nova implementação do que já está integrado.
4. **Como será comprovado?** teste focado, evidência adequada, revisor e critério de aceite; quando UI, navegador real; quando dados, tenant/proveniência.
5. **Quando devo parar?** hipóteses, riscos, orçamento operacional e condições de STOP.

Se faltar autorização, fonte ou prova aplicável: `BLOCKED/NOT_EVIDENCED`, **sem começar implementação**. Utilizar `scripts/agent/preflight.mjs` do repositório quando houver implementação autorizada. O arquivo atual `docs/agent/OPERATING_MODEL.md` preserva seus controles de tempo e runner.

### 3.2 Restrições que o assistente deve impor a si mesmo

- **Sem retrabalho:** não reconstruir M14–M17, Discovery S1–S3, LX07 PR #84–87, M18 S1 ou SEC-01 sem defeito reproduzido e autorização do delta.
- **Sem ação destrutiva:** não editar/reordenar/reaplicar migrações históricas; não `reset`, `clean`, rebase, merge ou apagar worktrees sem escopo específico; novas migrations somente aditivas e autorizadas.
- **Sem mutação de ambiente não autorizada:** banco TEST, hosted, produção, credenciais, rede, deploy e GitHub settings exigem autorização própria. `SHOW-001` não concede GO automaticamente.
- **Sem testes compulsivos:** teste focalizado primeiro; não repetir suítes completas sem mudança relevante. Mesma falha duas vezes sem hipótese material nova = STOP; não abrir ciclo de revisão da revisão.
- **Sem dado inventado:** `UNKNOWN≠0`, `NOT_EVIDENCED≠COMPLIANT`, nenhum score, certificação, ROI, controle ou autoridade gerada por IA sem fonte governada.
- **Sem substituição de autoridade:** agente pode implementar/revisar, mas não aprovar seu próprio trabalho nem declarar gate CLOSED por inferência.
- **Sem avanço silencioso:** nova tarefa/escopo exige aprovação e registro aditivo de decisão; mudança de chat não reinicia tentativas, horas ou bloqueios.
- **Sem promessa de atividade assíncrona:** somente registrar trabalho realmente concluído ou automação efetivamente configurada.

### 3.3 Contrato compacto de tarefa (registrar diretamente neste arquivo)

A entrada de tarefa deve ter o seguinte formato **no próprio master**, nunca em outro arquivo de gestão:

```text
TASK_ID: … | Objetivo único: … | Fora de escopo: …
DEC_ID/autorização: … (autor, data, classe de ação, origem)
Baseline: repo, branch, main SHA, HEAD, diff, worktree …
Status anterior: … | Implementação já existente: caminhos/refs …
Delta exato / arquivos permitidos: … | Dependências / gate: …
Hosted/TEST/deploy/segredos: NÃO, salvo autorização separada …
Aceite: critério mensurável … | Testes: focados, ambiente, evidência …
Risco / hipótese / condição STOP / budget ativo: …
Executor: … | Revisor humano elegível: … | Decisor final: Carlos
```

### 3.4 Contrato de handoff e retomada

**Toda nova sessão deve ler esta versão real** (arquivo ou URL canônica depois de publicada), verificar `main` e apresentar: `TASK_ID`, versão do master, SHA remoto, último `ACEITO` com EV-ID, tarefa ativa, último candidato e testes, bloqueios, conflitos, autorização disponível e **uma próxima ação concreta**. Se o arquivo não estiver disponível, `STOP` e pedir o arquivo/URL; nunca reconstruir o estado apenas por lembrança.

No encerramento da tarefa, inserir **neste master** registro datado: objetivo, status anterior/novo, commits/diff/PR, evidências, comandos executados ou `NOT_RUN`, ambiente, duração ativa conhecida (ou desconhecida), tentativas, bloqueios e próxima ação única. Citar logs brutos por caminho/URL em vez de copiá-los. Nenhuma sessão nova pode alterar status sem EV-ID e decisão quando aplicável.

### 3.5 Gestão de exceções

Exceção precisa `DEC-ID` novo, motivo, escopo, aprovador, risco, validade e retorno ao estado padrão. A autorização específica do PR documental GOV-001 não autoriza merge, banco, hosted, deploy, segredos, workflow nem alteração de regras do GitHub. Configuração de políticas de `main` e bypass só após autorização explícita e registro.

## 4. GOV-001 e GOV-002 — implantação controlada

**Diagnóstico remoto em 19/11/2026:** `main` em SHA `462751b...`, `protected=false`, rulesets vazios; `AGENTS.md`, `CLAUDE.md`, `OPERATING_MODEL.md` existentes; workflows `.github/workflows/m15-postgres-regression.yml` e `m16-postgres17-security.yml` existentes; sem workflow específico de contrato de PR no baseline. A preparação documental GOV-001/GOV-002 foi concluída e a abertura do PR documental GOV-001 foi autorizada em 19/11/2026. **A primeira tentativa de criar a branch via conector retornou HTTP 403 (`Resource not accessible by integration`). O bloqueio de publicação foi resolvido com a interface web autenticada do GitHub, que permitiu publicar a branch e abrir o [PR #88](https://github.com/cnegrao/code-guard-governance/pull/88) em draft.**

### GOV-001 — contrato único e adoção

1. Revisar e aceitar este `GOVIA_MASTER.md` como **único arquivo de gestão**.
2. **Integração:** [PR #88](https://github.com/cnegrao/code-guard-governance/pull/88) integrado à `main` em `2083ecff43e3569f6de7e7e03d07d5a60be2c097`, a partir do HEAD `271fa268d416e6d218e8719879706500255a4cfd`. A alteração incluiu o master e as referências mínimas em `AGENTS.md` e `CLAUDE.md` (EV-013 e EV-014).
3. **Não publicar** na mesma revisão uma cópia do velho Plano Mestre, um Decision Register, Task/Handoff templates ou checkpoints: seu conteúdo agora está incorporado aqui.
4. `DEC-GOV-001-ACCEPT` registra a decisão de Carlos. EV-015 comprova a primeira retomada com leitura direta do master e EV-016 registra o aceite formal. Revisão humana no PR #88: `NOT_EVIDENCED`.

**GOV-001 DONE somente após** texto aceito, PR autorizado e integrado, referências dos agentes verificadas e uma retomada de sessão comprovando leitura efetiva deste master.

### GOV-002 — CI e proteção de branch

**Arquivos auxiliares técnicos permitidos (não são planos):** `.github/PULL_REQUEST_TEMPLATE.md`, `.github/workflows/govia-governance-gate.yml`, `scripts/agent/check-pr-contract.mjs` e seus testes. O pacote de GOV-002 preparou essas propostas e reportou 15 testes unitários locais positivos e dois testes com Git temporário; **não foram executados na CI real do repositório**.

**Campos de PR previstos:** `TASK_ID`, `BASELINE_SHA`, `AUTHORIZATION_REF`, `CHANGE_CLASS`, `SCOPE`, `ACCEPTANCE`, `EVIDENCE`, `HOSTED_MUTATION`, `MIGRATION_MODE`, `CRITICAL_CHANGE_APPROVAL_REF`. CI valida formato e certos caminhos, não autenticidade das declarações.

**Implantação por duas etapas, sem deadlock:**

1. **Bootstrap autorizado:** criar branch/PR sob `main` SHA atual, publicar contrato e workflow; inspecionar diff, rodar gate no PR e consultar status/check names reais. Preservar workflows M15/M16. **Não exigir check inexistente.**
2. **Enforcement autorizado:** somente após prova do funcionamento, configurar ruleset ativo de `main` exigindo PR, pelo menos um revisor humano elegível, checks de governança + M15/M16 pelo nome observado, conversas resolvidas, bloqueio de force-push/delete e bypass mínimo/auditável. Se Carlos for autor, ele não poderá fornecer a revisão independente de seu PR; resolver revisor elegível antes de exigir aprovação.

**Testes negativos obrigatórios para aceitar GOV-002:**

| NEG-ID | Tentativa controlada | Resultado esperado |
|---|---|---|
| N-01 | PR sem `TASK_ID` | Check falha; merge bloqueado |
| N-02 | SHA de baseline inválido/não verificável | Check falha |
| N-03 | Evidência vazia ou placeholder | Check falha |
| N-04 | `HOSTED_MUTATION: YES` | Bloqueio na rota local; hospedagem requer rito próprio |
| N-05 | Migração histórica modificada/renomeada | Bloqueio |
| N-06 | Migração nova declarada `MIGRATION_MODE: NONE` | Bloqueio |
| N-07 | Check obrigatório M15 ou M16 reprovado | Merge bloqueado |
| N-08 | PR sem revisão humana qualificada | Merge bloqueado |
| N-09 | Push direto/force-push/delete contra política | Rejeição comprovada com meio de ensaio seguro, **sem operação destrutiva na `main`** |
| N-10 | Mudança em gate/scripts/workflows sem revisão especializada | Bloqueio ou autorização adicional comprovados |

**Limites do controle:** um autor pode escrever metadados falsos no PR; o próprio script de CI pode ser alterado por um PR; permissões de admin/bypass podem anular proteções; status checks não dão aceite de negócio. Portanto, exigir revisor elegível e rastreio periódico de regras/bypass. `CODEOWNERS` pode ser adotado apenas após verificar usuário real apto, evitando impasse.

**GOV-002 DONE somente após** workflow operando no GitHub, checks observados e required, ruleset ACTIVE consultado, testes negativos N-01–N-10 com evidências e nenhum bypass de rotina não aprovado.

**Estado atual:** `GOV-001 = DONE` · `GOV-002 = NÃO IMPLANTADO`. A proposta de GOV-002 foi testada localmente. O master único substituiu a proposta anterior de múltiplos documentos de gestão.

## 5. Matriz de recuperação aprovada

**Decisão `DEC-REC-000` aprovada em 19/11.** `REC` descreve tratamento, não código automaticamente aceito; prioridade P0/P1/P2 é de gestão.

| ID | Frente | Estado de prova | Tratamento aprovado | Prioridade | Gate próximo |
|---|---|---|---|---|---|
| REC-01 | Core M14–M17 | Presença em main; integração histórica | PRESERVAR | P0 | Sem reescrita; delta somente com prova de defeito |
| REC-02 | Discovery S1–S3 | Motor/fluxo integrados; jornada atual ainda por validar | REUTILIZAR | P0 | Avaliar fluxo real, não recodificar scanner |
| REC-03 | LX07 / segurança | PR #84–87 integrados; LX07 global não necessariamente CLOSED | MANTER CORREÇÕES | P0 | Deltas residuais com evidência |
| REC-04 | M18 Executive | UI e query no main; testes locais têm variantes | PRESERVAR/COMPARAR TESTES | P0 | Aceite S1 e permissão seguem pendentes |
| REC-05 | SEC-01 no TEST | Implantação/pós-check históricos de 11/11 reconciliados; TEST é projeto Supabase hospedado; estado atual NOT_EVIDENCED | VERIFICAR ESTADO | P0 | Nova autorização específica para coleta hosted antes de migração, D06/SHOW-003 ou aceite dependente do TEST atual; não reaplicar a migração |
| REC-06 | BYOM | Implementação local com feature flag, APIs/UI, serviço e testes | CANDIDATO A RECUPERAÇÃO | P1 | Segurança, compatibilidade e hosted separados |
| REC-07 | SR2-A4 V2/V3 | Qualificação experimental; V3 falhou em corpus independente | PRESERVAR V2/REJEITAR V3 | P1 | A4 BLOCKED |
| REC-08 | SR2 MPNet | Runtime qualificado; qualidade insuficiente | PESQUISA/ARQUIVO | P2 | Não promover provider |
| REC-09 | SR2 Voyage | Candidato local; revisão imutável/egress/probe sem prova; teste excluído, untracked e ignorado localmente; F0-005 encerrado documentalmente | PRESERVAR BLOQUEADO — ARQUIVO EM QUARENTENA | P2 | Duas ocorrências da linha 181 seguem SEGREDO_POTENCIAL; qualquer futura utilização exige triagem específica e autorização de Carlos (DEC-F0-005-DOC-QUARANTINE) |
| REC-10 | Passport compat | Pacote histórico de ensaio e patches | ARQUIVO APENAS | P1 | Proibido aplicar migrações antigas |
| REC-11 | Discovery Worker E0 | Correção local de ESM/startup | DELTA CONDICIONAL | P1 | Só integrar se falha atual reproduzida |
| REC-12 | UX enterprise | Design System v1.1 especificado; implantação não demonstrada | REUTILIZAR SPEC | P0 | UX-0 e implementação incremental |
| REC-13 | Trust & Assurance V1 | Contrato existente; Hub completo sem aceite | CONCLUIR DELTA | P0 | Fechar M17.5 gate antes de M18 formal |
| REC-14 | D06 / Demonstração | Fluxos e SEC-01 com prova histórica; browser atual não confirmado | VALIDAR JORNADA | P0 | GO de exposição separado do aceite |


**Leitura dos resultados e limites:**

- Core/LX07/Discovery: manter o que chegou ao `main`; 50 de 67 comparações de caminho committed são idênticas e 17 diferentes; nenhuma dessas 67 aponta caminho ausente. Diferença de branch histórica não equivale a lacuna do produto.
- BYOM: implementação local real (`lib/byom/*`, `/settings/models`, rotas API, testes), habilitação local e bloqueio explícito em production; os testes de sua própria branch são **evidência histórica**. Antes de incluir no produto, validar autenticação atual, tenant, filesystem/instância, credenciais, audit e compatibilidade com `main`; sem autorização de hosted.
- SR2-A4: MiniLM V2 preservado como baseline experimental; V3 12/12 corpus original e 3/8 independente — qualidade não aceita; MPNet teve runtime CUDA qualificado mas qualidade falhou; Voyage é adaptador/probe local sem revisão imutável garantida ou evidência de teste externo real. **A4 permanece BLOCKED**.
- M18: o `main` usa uma única RPC transacional `read_executive_workspace_v1`; variantes locais antigas contêm leituras separadas. Não sobrescrever o core com implementação anterior. Reconciliar apenas testes úteis, eventuais proteções faltantes e diferenças de UI.
- E0 Worker: variante local usa `createRequire` para interop CJS/ESM; `main` possui importações nomeadas. **Não aplicar por hipótese**: reproduzir falha atual antes de autorizar delta.
- Passport: preservar artefatos de compatibilidade/recovery como histórico; jamais executar patches de migração histórica por causa do inventário.

**Qualificação F0-006 (C3/C4):** A4 é o primeiro bloqueio técnico demonstrado dentro da rota SR2 atualmente documentada; não foi demonstrado que seja a única rota arquitetural de contenção LX03. Alternativa exige decisão ou emenda arquitetural própria, fora de F0-006. `REC-07 = P1 / A4 BLOCKED` permanece; a criticidade P0 da cadeia M17.5 decorre de `RISK-008`, sem reclassificar REC-07.

## 6. Fase 0 — estado e critérios de fechamento

**Escopo autorizado:** análise documental/read-only já aprovada. Nenhum teste, PR, merge, commit, alteração Git, DB/hosted, migração, deployment ou correção funcional decorre automaticamente da F0.

**Autorização específica desta publicação:** Carlos confirmou expressamente o aceite documental da Fase 0 e autorizou seu registro e publicação. Autoriza branch/worktree isolado, commit, PR e merge exclusivamente de `GOVIA_MASTER.md` para F0-007 (`DEC-F0-007-DOC-ACCEPT`, EV-035), condicionados ao preflight e aos gates GitHub efetivos, sem bypass. Essa autorização não amplia as demais classes de ação da F0. Os estados novos só têm efeito após publicação válida; os checkpoints anteriores abaixo permanecem históricos.

| TASK_ID | Entrega | Status nesta revisão | Evidência/pendência |
|---|---|---|---|
| `F0-001` | Congelar aprovação, SHA e decisões | CONCLUÍDO DOCUMENTAL | Chat + aditivo; não é merge |
| `F0-002` | Catalogar inventários de 37 worktrees/326 fingerprints | CONCLUÍDO DOCUMENTAL | ZIPs de inventário e fingerprint |
| `F0-003` | Indexar exportador (77 fontes/1 excluída) | CONCLUÍDO DOCUMENTAL | Registro SHA256 por arquivo na planilha v1.1 |
| `F0-004` | Comparar semântica M18/Worker/BYOM vs main atual | **CONCLUÍDO DOCUMENTAL** — `DEC-F0-004-DOC-CLOSE` | Codex e Claude reconciliados: EV-017–EV-020; F-01–F-07 e V1–V3 rastreados; testes NOT_RUN, sem aceite funcional |
| `F0-005` | Avaliar teste Voyage excluído sem compartilhar segredo | **CONCLUÍDO DOCUMENTAL — ARQUIVO EM QUARENTENA** | DEC-F0-005-DOC-QUARANTINE; EV-022–EV-027; triagem encerrada, candidato REC-09 não liberado |
| `F0-006` | Reconciliar evidências SEC-01 e bloqueios de M17.5 | **CONCLUÍDO DOCUMENTAL CONDICIONADO** | DEC-F0-006-DOC-CLOSE; EV-028–EV-034 preservadas; publicação comprovada em EV-038; F0(c) documental; TEST atual NOT_EVIDENCED |
| `F0-007` | Revisão independente e aceite formal de fechamento F0 | **CONCLUÍDO DOCUMENTALMENTE após publicação válida de 1.0.4** | DEC-F0-007-DOC-ACCEPT; EV-035–EV-040; gates A–E documentais; B sob manutenção contínua da quarentena; sem aceite funcional/operacional |
| `F0-008` | Bootstrap documental do controle por PR | CONCLUÍDO | PR #88 integrado e GOV-001 aceito conforme DEC-GOV-001-ACCEPT e EV-013–EV-016 |


**F0-004 — resultado parcial conhecido:** leitura dirigida de quatro paths do `main`, sem mutação. Comparação registrada em 19/11:

| Caminho | Git blob remoto | Decisão provisória |
|---|---|---|
| `apps/dashboard/app/(dashboard)/workspace/page.tsx` | `1beb138b873c365f6528b14d995731cc3d507c4d` | Preservar implementação integrada; variantes locais requerem análise de segurança pontual |
| `apps/dashboard/lib/workspace/executive-query.ts` | `4dfb88d71230fc627dc269a9d3b2b53e81f767b0` | RPC transacional atual prevalece sobre leituras locais múltiplas |
| `apps/discovery-worker/src/discovery-intake.ts` | `72504c4b37e361d9af181a4213712a1092490a51` | E0 createRequire somente se regressão atual comprovada |
| `apps/dashboard/components/layout/Sidebar.tsx` | `0bff02ef8f0480f58670e46ee01c9107` | CodeGuard e menu sem `/workspace`; lacuna de UX, não importação de Sidebar antiga |

### F0-004 — reconciliação semântica complementar (leitura, sem execução)

**Escopo efetivamente confrontado:** ZIP de 77 fontes exportadas com o `main@462751b...` remoto; caminhos de autenticação, adaptador OpenAI, componentes Executive, testes legados e Worker. **Não** houve execução de testes, diff/merge local, validação browser, varredura exaustiva de 134 caminhos ou inspeção de segredos. Os achados abaixo são decisões de triagem, não aceite.

| Candidato | Fato verificado no código | Decisão / menor delta permitido futuramente | Bloqueio e evidência ainda exigidos |
|---|---|---|---|
| **BYOM — funcionalidade local** | Rotas `GET/PUT/POST`, store com revisão otimista, cadeia de hashes e autorização `org_admin` por sessão/epoch; desativação explícita em produção; credencial por organização exclusivamente no servidor e probe sintético. | **Preservar os 12 arquivos exclusivos e 3 modificações como candidato**, não copiar indiscriminadamente; nenhum SaaS/hosted, publicação ou conexão real presumidos. | Análise de compatibilidade e segurança com o principal atual, persistência multi-instância, ciclo de credenciais, teste browser e regressões em branch autorizada. |
| **BYOM — dependência OpenAI** | `service.ts` importa `createOpenAIProvider` de `lib/llm.ts` local. **A função não está exportada pelo `lib/llm.ts` do `main`** (SHA remoto `3c5170cded3a74b7bf778cba2343f9573b2222a1`). A variante local introduz a factory mantendo `directOpenAIUsage`/callback de runtime. | Se houver autorização futura, portar **somente a factory/adaptação necessária**, preservando comportamento, assinatura e telemetria do adaptador atual. | Testes do produtor OpenAI, da configuração/probe, isolamento tenant e revisão de diffs antes de PR; não executar conexões reais sem consentimento. |
| **M18 Executive/Security** | `main` já usa RPC transacional `read_executive_workspace_v1`; variantes locais fazem leituras separadas ou revalidação adicional de sessão e possuem testes históricos ausentes pelo mesmo nome no `main`. | **Não restaurar páginas ou queries antigas.** Considerar testes `m18-executive-auth/session-security` somente após mapear cobertura efetiva da RPC/SEC01 e suites atuais. | Comparar cobertura de casos, não nomes de arquivos; evidência atual de lacuna necessária para novo teste/correção. |
| **Discovery Worker E0** | `main` importa valores nomeados de `@council/scanner/discovery`; variante local utiliza `createRequire` em tempo de execução e acrescenta teste de inicialização. | **Não aplicar alteração preventiva**. Conservar o teste como candidato se falha ESM for demonstrada no contexto oficial. | Reprodução do defeito no runtime aprovado (Windows/Node 24), sem alterar ambiente ou introduzir Docker/WSL. |

**Critério objetivo para sair de `EM_REVISAO_READONLY`:** fechar o mapeamento de cobertura M18/SEC01, confirmar o tratamento de BYOM como candidato não integrável sem adaptação e declarar se E0 possui evidência de defeito reproduzido. Se dados faltarem, registrar `NOT_EVIDENCED` e proposta de teste delimitado, sem abrir ciclo exploratório.

### F0-004 — consolidação Codex × Claude e fechamento DOCUMENTAL (19/11/2026)

**Escopo e decisão:** `F0-004` foi concluído exclusivamente quanto à **triagem semântica/documental**; aceite limitado autorizado por Carlos (`DEC-F0-004-DOC-CLOSE`). O Codex entregou `F0_004_CODEX_READONLY_HANDOFF`; o Claude Code fez revisão adversarial independente `F0_004_CLAUDE_ADVERSARIAL_HANDOFF`. Ambos usaram `main@fb11a04cf3688f544fcac9d733453c60f47fee1e`, preservaram o worktree dirty e não executaram testes, Worker, banco ou probes (`NOT_RUN`). Não houve validação funcional atual, nem ativação de BYOM/Worker, nem aceite do M18. **A Fase 0 permanece ABERTA**, com F0-005/006/007 pendentes. Nenhum P0 foi identificado na revisão documental (não equivale a auditoria exaustiva).

**Correções adversariais obrigatórias:** (i) o déficit integrado de teste M18 foi superestimado pelo Codex; `passport-ui-route.test.ts`, `m18-executive-ui.test.ts`, `session-consumer-security.test.ts` e SEC-01 cobrem partes distintas da cadeia, porém nem todos têm PASS de CI na baseline; (ii) no BYOM, a janela estática autorização→arquivo/egress **existe**, sendo `NOT_EVIDENCED` o impacto sob corrida, não a existência da janela; (iii) para E0, os insumos históricos de reprodução são equivalentes aos da baseline examinada, porém a falha não foi reproduzida no HEAD canônico. Preservar os relatórios e as qualificações, sem importar testes/queries antigos automaticamente.

| ID | Prioridade | Constatação verificável e classificação | Tratamento governado / desbloqueio | Fonte |
|---|---|---|---|---|
| `F-01` | P2 | Lacuna residual de cobertura M18: tokens malformados/expirados, composição em um processo e caminho negativo Next real; **não é defeito funcional demonstrado** | Não reintroduzir transporte legado; propor teste focal apenas após escopo autorizado | EV-017/018 |
| `F-02` | P2 | Assertivas de U/A/S/Passport/model presentes na fonte, mas **PASS dessas suítes na baseline não evidenciado**; CI conhecido cobre parte PostgreSQL, não todos os testes | V2: execução individual e leitura dos receipts, sem inferir PASS por presença de teste | EV-017/018; EV-002 histórico |
| `F-03` | **P1** | **BYOM**: autorização e verificação de epoch antes de gravação em arquivo/egress, sem lock/transação conjunta; janela de revogação confirmada por análise estática; impacto **NOT_EVIDENCED** | **BLOQUEIA qualquer integração/ativação BYOM** até adjudicar autoridade, revogação e controle concorrente; não transplantar garantias SEC-01 | EV-017/018 |
| `F-04` | P2 | BYOM: erro em autorização pós-egress pode deixar `PROBE_STARTED` sem `PROBE_FINISHED` apesar de chamada externa | Projetar trilha de conclusão/erro auditável antes de integrar, sem executar egress agora | EV-018 |
| `F-05` | P2 local; **P1 se hospedado** | BYOM: credenciais de tenants em `GOVIA_BYOM_CREDENTIALS_JSON`; texto sensível no ambiente e rotação exige reinício | Sem hosted; especificar segregação, provisionamento, rotação/revogação e proteção de segredos antes de ativar | EV-018 |
| `F-06` | P2 | BYOM: `.lock` órfão pode bloquear serviço; atomicidade/rename em Windows não comprovados; hash SHA256 sem chave não comprova resistência a adulteração | Validar crash-recovery, integridade e semântica local de filesystem sob autorização específica | EV-018 |
| `F-07` | P2 | E0: SyntaxError ESM/CJS reproduzido historicamente em Node 24.19.0/tsx 4.19.3; insumos permanecem equivalentes; **status atual NOT_EVIDENCED** | V1: reproduzir no runtime oficial antes de decidir entre alinhamento do tsx e `createRequire`; não corrigir preventivamente | EV-017/018 |

**Compatibilidade BYOM:** o candidato local permanece preservado, mas **não é integrável diretamente**: `service.ts` depende de `createOpenAIProvider` que o `lib/llm.ts` da `main` não exporta. O candidato também toca `apps/dashboard/package.json`, que sofreu alterações na baseline; reconciliar manualmente apenas sob futura autorização. Feature flag e bloqueio produtivo seguem ativos. Não criar novo SaaS nem hosted por inferência.

**Verificações futuras delimitadas — propostas, NÃO autorizadas:** `V1` = testar uma vez o startup E0 na baseline oficial com variáveis `DISCOVERY_*` removidas, sem banco/egress, e classificar SyntaxError vs ausência de configuração; `V2` = executar individualmente as suítes M18/SEC-01 relevantes, evitando cadeia `&&` e registrando SHA/logs; `V3` = decidir modelo de autoridade BYOM e mitigação do P1 F-03 antes de qualquer integração. Nenhuma V1–V3 foi executada nesta F0-004. V1/V2/V3 não constituem autorização de mudança de código, migração, DB, hosted ou deploy.

**Handoff F0-004:** `MASTER_VERSION=1.0.1`; `BASELINE=fb11a04cf3688f544fcac9d733453c60f47fee1e`; `EXECUTORES=Codex (análise) + Claude Code (adversarial)`; `TESTES=NOT_RUN`; `EVIDÊNCIAS=EV-017–EV-021`; `ACEITE=DOCUMENTAL LIMITADO`; `ESCOPO ALTERADO=GOVIA_MASTER.md SOMENTE`; publicação no [PR #90](https://github.com/cnegrao/code-guard-governance/pull/90), HEAD documental verificado `ee27ff1db87220c52d82b7b8d0c319d3399e9570` antes do registro aditivo EV-021; `ESFORÇO ATIVO=DESCONHECIDO`; `DONO DOS GATES/CORREÇÕES=Carlos (decisão) + Codex (eventual execução autorizada)`; `PRÓXIMA AÇÃO ÚNICA=F0-005 mediante autorização específica`. Não declarar F0-007 concluído, não declarar F0 CLOSED.

**Checkpoint histórico anterior ao fechamento F0-006, preservado integralmente:**

**Gate de encerramento F0:** (a) conciliar fontes e variantes relevantes com segurança; (b) manter o fechamento documental condicionado de F0-005 e a quarentena, sem liberar Voyage nem presumir sanitização/segurança; (c) reconciliar evidências SEC-01 no banco TEST **sem reaplicar migrations** e bloqueios formais M17.5, mediante autorização específica; (d) revisão independente; (e) aceite escrito de Carlos. Até atender: **F0 ABERTA**. F0-006 permanece PENDENTE; F0-007 permanece BLOQUEADO.

**F0-005:** o exportador excluiu `apps/dashboard/tests/voyage-embedding-provider.test.ts` por `POTENTIAL_EMBEDDED_SECRET`. É somente um alerta do filtro, **não prova de vazamento**. Nenhum agente deve solicitar ou publicar o texto bruto sem triagem local específica.

### F0-005 — fechamento documental condicionado (19/11/2026)

**Decisão de Carlos:** encerrar a triagem documental, aceitando o risco residual **exclusivamente enquanto o arquivo permanecer em quarentena** (`DEC-F0-005-DOC-QUARANTINE`). Isso não libera o candidato REC-09 nem autoriza uso, integração, execução, distribuição ou exposição do teste ou do candidato Voyage. Qualquer futura utilização exige triagem específica e nova autorização de Carlos.

**Evidências e adjudicação:** Codex concluiu a triagem de segurança com classificação inicial `SEGREDO_POTENCIAL` (EV-022); Claude Code realizou a revisão adversarial e recomendou contenção e classificação conservadora (EV-023), sem nova revisão nesta publicação. Carlos declarou fictícios os valores de teste das linhas 14, 17, 21 e 88; as **duas ocorrências da linha 181 permanecem `NOT_EVIDENCED` na adjudicação humana e `SEGREDO_POTENCIAL` na classificação de segurança** (EV-024). As declarações e os resultados anteriores são registrados conforme fornecidos por Carlos nesta solicitação; não são nova inspeção do arquivo nem prova independente de segurança.

**Contenção:** regra local específica em `.git/info/exclude`, linha 65; `git check-ignore -v` confirmou a regra, `git ls-files --error-unmatch` confirmou ausência no índice e a existência foi verificada apenas por metadados (EV-025). Arquivo preservado, untracked e ignorado. **Quarentena é contenção, não confirmação de segurança.** `git add -f` ainda pode forçar inclusão; `info/exclude` é local e não acompanha clones novos. Não há comprovação de ausência de vazamento, credencial ativa ou comprometimento; essas questões permanecem `NOT_EVIDENCED`.

**Contrato e handoff documental:** `TASK_ID=F0-005`; `MASTER_VERSION=1.0.2`; `BASELINE=826159b18766f8b032c3e2b09727945039d09bdd`; branch `docs/f0-005-documental-quarantine-20261119`, worktree isolado e limpo no preflight (EV-027); único delta permitido `GOVIA_MASTER.md`. Carlos autorizou branch, commit, PR e merge documental condicionado aos gates GitHub e à validação do HEAD (EV-026); publicação/merge desta versão ainda não comprovados neste checkpoint. Estado anterior BLOQUEADO → **CONCLUÍDO DOCUMENTAL — ARQUIVO EM QUARENTENA**. Verificação aplicável: integridade documental, WBS de 33 tarefas, históricos/gates e `git diff --check`; CI independente no PR. Testes funcionais locais, probes e chamadas externas Voyage: `NOT_RUN`; conteúdo do teste não aberto, lido, impresso ou incorporado nesta sessão. Alvo operacional ativo: 30 minutos; esforço ativo medido: DESCONHECIDO. Os 37 worktrees preexistentes não são alterados; apenas um worktree documental adicional é criado. STOP se escopo, checks, revisão exigida ou HEAD não satisfizerem os gates. Próxima ação única: **F0-006 mediante autorização específica**, sem iniciar F0-006, GOV-002 ou M18; F0-007 BLOQUEADO e FASE 0 ABERTA.

### F0-006 — fechamento documental condicionado (23/11/2026)

**Decisão e gate F0(c):** Carlos autoriza o fechamento documental condicionado e adota expressamente a interpretação de que F0(c) está atendido **quanto à reconciliação das evidências históricas sobre o PostgreSQL TEST**, não quanto à verificação do estado atual desse ambiente (`DEC-F0-006-DOC-CLOSE`, EV-031). O texto original do gate acima e `DEC-REC-005` permanecem preservados. A interpretação não elimina nem substitui futuras verificações técnicas; não encerra a Fase 0 nem equivale ao aceite de F0-007.

**Reconciliação reutilizada:** `F0_006_CODEX_READONLY_HANDOFF` e `F0_006_CLAUDE_ADVERSARIAL_HANDOFF` integrais foram recebidos e lidos (EV-029/030). O parecer Claude `READY_FOR_DOCUMENTAL_CLOSE` foi condicionado a C1–C6 e à decisão de Carlos, agora registrada. Resultados técnicos abaixo são atribuídos às verificações relatadas nesses handoffs; não foram novamente executados ou inspecionados nesta publicação. As instruções de próximas ações antigas dos relatórios não substituem a autorização atual.

| Eixo SEC-01 | Evidência reconciliada e limite |
|---|---|
| Implementação e integração | Migração `20261111123119_sec01_transactional_workspace_acquisition_v1.sql`, RPC e consumidor transacional integrados em `76e5676a1ca085f0d9448d4ef3e32bba0b51417e`; handoffs confirmam ancestralidade e ausência de delta funcional relevante até a baseline |
| Teste local e CI histórica | Local PG17.11: 12/12 documentados; M16 [44737680743](https://github.com/cnegrao/code-guard-governance/actions/runs/44737680743) e M15 [44737680757](https://github.com/cnegrao/code-guard-governance/actions/runs/44737680757), ambos success na baseline segundo os handoffs; clusters descartáveis, sem comprovar TEST atual |
| Implantação no TEST | Recibo histórico: COMMIT 11/11/2026 às 22h35 e pós-check independente às 22h35min16s de Brasília; histórico 101→102; 198 tabelas e 660 rotinas anteriores preservadas; D06/browser não executados nessa aplicação, conforme EV-029/030 |
| Estado atual e aceite | TEST atual NOT_EVIDENCED; REC-05 VERIFICAR ESTADO; SEC-01 e HIST-002/005 sem aceite funcional/operacional; M18 HOLD |

**C1/C2 — limite TA-001:** TA-001 permanece PENDENTE, com dependência canônica GOV-001 já DONE; não está bloqueado por F0-007. A matriz S1–S8 abaixo é exclusivamente insumo para futura TA-001: não registra sua implementação, execução ou aceite, nem aceite de TA-002/003/004. **C3/C4:** rota SR2/A4 e severidades qualificadas em §5, sem decisão arquitetural nova.

**C5 — TEST hosted:** o PostgreSQL TEST é projeto Supabase hospedado. Qualquer coleta atual de catálogo/ACL/dependências constitui acesso hosted e exige autorização específica posterior. Antes de migração nesse ambiente, D06/SHOW-003 contra ele ou aceite formal dependente de seu estado atual, realizar verificação específica autorizada. Não houve acesso hosted, SQL, migração, teste, deploy ou atualização de banco; nenhum identificador sensível ou credencial é registrado.

**C6 — proveniência e preservação:** os handoffs localizam o recibo Markdown e o JSON sanitizado adjacente em `.worktrees/d06-functional-20261111/docs/codex/evidence/`, com nome-base `2026-11-11-sec01-test-deployment-pass`, no worktree histórico `fad55c937667f036cc7af5b21d45efd8db1ed049` (EV-032). Ambos foram reportados untracked e não ignorados, sujeitos a staging e perda acidentais. O Markdown já consta do §13: OID `2f7354ffc8724693b8c4fcbab11976e06a9da135`, SHA256 `803d8354eb421888f150e93047cf659f1a860aea420408221913119adab99a11`, reconciliados pelos relatórios, sem nova verificação do recibo nesta publicação. O JSON não é usado como prova independente: só foi fornecido hash abreviado no handoff Claude, insuficiente para registrar SHA256 integral verificável. Não inferir base de cálculo do hash histórico do corpo da RPC. As variantes untracked do checkout original (`lib/workspace/`, `ExecutiveWorkspace.tsx`, `tests/m18-*`, `workspace/`) colidem com caminhos já tracked na main; preservar o checkout e usar o worktree isolado. Nenhum recibo foi adicionado, movido, excluído, modificado ou publicado. **Contenção futura proposta, não executada:** Carlos autorizar preservação em destino controlado com hashes integrais, acesso restrito e proteção local específica contra staging; reconciliar colisões em escopo próprio antes de trocar o checkout original.

**Contrato e handoff documental:** `TASK_ID=F0-006`; `MASTER_VERSION=1.0.3`; `BASELINE=3bb46f3060d918c3ce316b075d6588fef5bb6864`; branch/worktree `docs/f0-006-documental-close-20261123` / `.worktrees/f0-006-documental-close-20261123`, inicialmente limpo; único delta `GOVIA_MASTER.md`. Estado anterior PENDENTE → CONCLUÍDO DOCUMENTAL CONDICIONADO, com publicação sujeita a PR/checks/merge confirmados. Preflight documental manual (EV-028), sem scripts que criam artefatos adicionais, conforme restrição desta tarefa; verificação documental EV-033, 33 tarefas WBS preservadas. Nenhuma repetição das análises ou da revisão adversarial. Testes funcionais locais: NOT_RUN, não aplicáveis; CI do PR permanece gate independente. Alvo ativo informativo: 30 minutos; esforço ativo medido DESCONHECIDO. Uma tentativa de criação do worktree foi bloqueada pelo sandbox, resolvida pela execução autorizada. Preservados os 39 worktrees preexistentes e as alterações locais; criado somente o worktree documental adicional. STOP em baseline divergente, conflito material, delta fora do master ou falha dos gates, sem bypass. Próxima ação única após publicação válida: avaliação de F0-007 mediante autorização específica, sem início automático.

**Checkpoint de publicação F0-006 (23/11/2026):** [PR #92](https://github.com/cnegrao/code-guard-governance/pull/92) aberto para main; HEAD inicial publicado `618cab49e05b5c17b50b6b31e27dafab2e894bb3` e blob do master `d7af85a48907e1f212418ffa17a3d0f94adf5138` conferidos por Git/API (EV-034). Somente o master foi alterado. Este registro aditivo sucede aquele HEAD; CI do candidato final e merge ainda não comprovados neste checkpoint. Revisões observadas: nenhuma; não há exigência efetiva de revisão humana nas regras consultadas. Nenhum bypass ou setting alterado. A validação documental foi recuperada após EPERM de subprocesso Git no sandbox e perda de acentos no pipe Windows, corrigidos sem testes funcionais ou nova análise técnica.

### F0-007 — aceite formal e fechamento exclusivamente documental (23/11/2026)

**Decisão escrita de Carlos e proveniência:** a solicitação atual declara integralmente: “Carlos confirmou expressamente o aceite documental da Fase 0 e autorizou seu registro e publicação.” Determina executar o pacote `F0_007_CODEX_PUBLICATION_PACKAGE.md`, alterar exclusivamente o master, respeitar gates GitHub sem bypass e não iniciar TA-001. O pacote registra a resposta anterior **“confirmo”** à proposta integral de aceite; essa resposta é evidência declarada no pacote recebido, não acesso independente ao texto original da conversa. O aceite referencia F0-007, baseline `cccaf8812060ba2812e35dbcc6ae02715e0ba352`, master 1.0.3 e os dois pareceres integrais recebidos: `F0_007_CODEX_FINAL_GATE_HANDOFF` e `F0_007_CLAUDE_FINAL_ADVERSARIAL_HANDOFF` (EV-035–EV-037). As próximas ações históricas dos pareceres não substituem a autorização atual. Não houve nova revisão nem repetição de análise concluída.

| Gate | Estado documental aceito | Evidência e limite |
|---|---|---|
| A — fontes e variantes | ATENDIDO DOCUMENTALMENTE | DEC-F0-004-DOC-CLOSE; EV-017–EV-021 e EV-027; F-01–F-07/V1–V3 preservados |
| B — Voyage / REC-09 | ATENDIDO SOB MANUTENÇÃO CONTÍNUA DA QUARENTENA | DEC-F0-005-DOC-QUARANTINE; **EV-022–EV-027**; EV-028 pertence ao F0-006 e serve aqui apenas como prova do merge do PR #91 (correção editorial E1). Não houve nova inspeção Voyage; base de contenção histórica EV-025; RISK-014 OPEN |
| C — SEC-01/TEST e M17.5 | ATENDIDO DOCUMENTALMENTE | DEC-F0-006-DOC-CLOSE; EV-028–EV-034 e EV-038; F0(c) exclusivamente reconciliação histórica, gate original preservado; TEST atual NOT_EVIDENCED |
| D — revisão independente final | ATENDIDO DOCUMENTALMENTE | Parecer final Claude recebido (EV-037), com handoff Codex (EV-036); revisões anteriores preservadas. Claude não equivale a revisor humano GitHub |
| E — aceite escrito | ATENDIDO | Aceite expresso de Carlos e autorização de publicação na solicitação atual, com confirmação anterior declarada pelo pacote (EV-035); DEC-F0-007-DOC-ACCEPT |

**Efeito após publicação válida:** FASE 0 ABERTA → **ENCERRADA DOCUMENTALMENTE**; F0-007 BLOQUEADO → **CONCLUÍDO DOCUMENTALMENTE**. Não constitui aceite funcional ou operacional. Permanecem `M17.5 = OPEN`, `M18 = HOLD`, `TA-001 = PENDENTE` (sem dependência nova de F0-007), `REC-05 = VERIFICAR ESTADO`, `TEST atual = NOT_EVIDENCED`, `REC-09 = BLOQUEADO / QUARENTENA`, `GOV-002 = NÃO IMPLANTADO` e `EXPOSIÇÃO EXTERNA = NO-GO`. F0(c) aplica-se somente conforme DEC-F0-006-DOC-CLOSE; acesso hosted continua não autorizado. RISK-002, RISK-014 (condição contínua), RISK-015, RISK-016, F-03 e demais riscos/achados abertos mantêm severidades, gatilhos e limites originais. Sem liberação de SEC-01, LX07, BYOM, Voyage, M17.5, M18, banco, migrações ou deploy; nenhum uso, integração ou divulgação Voyage.

**Contrato/handoff documental:** `TASK_ID=F0-007`; `MASTER_VERSION=1.0.4`; `BASELINE=cccaf8812060ba2812e35dbcc6ae02715e0ba352`; branch `docs/f0-007-documental-publication-20261123`, worktree `.worktrees/f0-007-documental-publication-20261123`, limpo no preflight; único delta versionado `GOVIA_MASTER.md`. 40 worktrees anteriores, alterações preexistentes e recibos locais preservados. Preflight local PASS, 134 migrações históricas inalteradas; alvo ativo informativo 30 minutos, esforço ativo medido DESCONHECIDO. Validação documental EV-040: diff exclusivo, WBS 33, continuidade DEC/EV, estados, históricos e inventário íntegros; testes funcionais/SQL/hosted/Docker/WSL NOT_RUN. CI M15/M16 do PR e revisão humana efetivamente exigida são gates de publicação, sem bypass. Consultas GitHub retornaram main sem proteção, regras/rulesets vazios (EV-039); GOV-002/RISK-002 não são encerrados por este aceite. Restrições de rede e EPERM de subprocesso Git no sandbox foram recuperadas por execução autorizada, sem mudar o escopo. SHA de merge desta versão não é presumido neste checkpoint; confirmação de PR/HEAD/checks/merge e SHA final integra o handoff de publicação. STOP se baseline mudar, houver delta fora do master ou gate impedir publicação. Próxima ação única: TA-001 mediante autorização separada; não iniciada.

## 7. Roadmap integrado e WBS

### 7.1 Ordem de execução, por dependência

- **P0-GOV:** GOV-001 concluído. GOV-002 depende de autorização específica. F0 encerrada exclusivamente no eixo documental após publicação válida de 1.0.4; próximos trabalhos exigem autorização própria.
- **Fase 1 — demonstração interna verificável:** `GitHub real → Discovery → Human Review → Canonical Truth → Agent Passport → Executive Workspace`, com dados e autorização reais; primeiro verificar o que já foi comprovado historicamente.
- **Fase 2 — M17.5:** resolver bloqueios realmente obrigatórios (LX03/SR2 e V1 Trust & Assurance Hub) antes de liberar gate; não reabrir LX07 PRs já integrados.
- **Fase 3 — M18:** somente após gate formal; S0 e então S1–S8 e quatro personas. Recuperar S1, não reescrever.
- **Fase 4 — apresentação enterprise:** UX-0, DS-0–DS-9 e QA sobre dados reais. Diagnóstico visual/documental pode ocorrer em paralelo, mas desenvolvimento e lançamento dependem dos próprios gates.

**Duas pistas planejadas, não autorizadas por mera inclusão:**

- **Pista A — demonstração limitada, se GO explícito:** `GOV-001 → GOV-002/SHOW-001 → SHOW-002 + UX-001 → UX-002 → SHOW-003 → SHOW-004 → SHOW-005`. É prova limitada e não significa M18 CLOSED.
- **Pista B — conclusão M18:** `GOV-001 → TA-001 → TA-002/TA-003 → TA-004 → M18-000 → M18-001/002 → M18-003/004/005 → M18-006 → M18-007..010 → UX-003 → M18-011`.

**Importante:** a apresentação comercial principal do M18 só será prometida com aceite adequado. Uma demonstração interna/limitada anterior pode ser autorizada separadamente sem reivindicar produto concluído.

### 7.2 WBS integral herdada (33 tarefas), com estados ajustados do GOV

O quadro é um inventário de trabalho e critérios, **não autorização de execução**. Para cada novo trabalho, anexar contrato §3.3 e atualizar esta linha com EV-ID e decisão. Prazos herdados de novembro/2026 a março/2027 são **cenários históricos**, não calendário vinculante após a F0.

| TASK_ID | Frente | Entrega / resultado | Situação atual | Dependências | Critério de aceite |
|---|---|---|---|---|---|
| HIST-001 | GOV | PR #87 + LX07 escopo integrado | INTEGRADO_NAO_ACEITO | — | Preservar SHA e CI; não declarar LX07 global CLOSED |
| HIST-002 | GOV | SEC-01 Executive RPC transacional | INTEGRADO_NAO_ACEITO | — | Teste PG17 incorporado e CI PASS; não reiniciar R2/R3 |
| HIST-003 | SHOW | Fonte GitHub do agente de demonstração publicada | CONCLUIDO_TECNICO | — | Repositorio fonte acessível, SHA fixado e CI executando testes reais |
| HIST-004 | SHOW | Jornada D01–D06 demonstrada historicamente em hosted | EVIDENCIA_HISTORICA | — | Preservar recibos D01-D06; não equiparar hosted histórico a teste local atual |
| HIST-005 | M18 | S1 Executive Workspace implementado no main | INTEGRADO_NAO_ACEITO | — | URL /workspace no navegador com dados governados e critérios S1; sem 0/UNKNOWN indevido |
| GOV-001 | GOV | Adotar e versionar Plano Mestre + registro de decisões | DONE · DEC-GOV-001-ACCEPT · EV-013–EV-016 | — | Plano v1 aprovado; arquivo versionado e registro de tarefas sem ambiguidade |
| GOV-002 | GOV | Proteger main: PR obrigatório, checks e trilha TASK_ID | NÃO IMPLANTADO | GOV-001 | main protegida; merge sem PR/check é bloqueado; PR referencia TASK_ID, baseline, prova e decisão |
| GOV-003 | GOV | Implantar checkpoint e nova-sessão obrigatório | PENDENTE DE GOVERNANÇA ATIVA | GOV-001 | Todo chat começa com BASELINE_CHECK; cada tarefa termina com HANDOFF registrado |
| SHOW-001 | SHOW | Definir ambiente e audiência segura de demonstração | PENDENTE | GOV-001 | Ambiente, acesso, dados, risco de exposição e modo online/offline escolhidos e aprovados |
| SHOW-002 | SHOW | Catalogar e conferir recibos D01–D06 existentes | PENDENTE | HIST-004;SHOW-001 | Mapa 6 elos→SHA/ID/timestamp, validade temporal, ambiente e evidência acessível |
| UX-001 | UX | UX-0: auditoria visual real do fluxo de demonstração | PENDENTE | GOV-001;SHOW-001 | Screenshots reais desktop/mobile de 3 telas; defeitos classificados, sem redesign genérico |
| UX-002 | UX | DS0/DS1 + polimento de shell e telas demonstráveis | PENDENTE | UX-001;GOV-002 | Home/Sidebar, Agent Library, Passport e Executive coerentes; responsivos; sem mudar fatos |
| SHOW-003 | SHOW | Smoke navegador e evidência D05–D06 na versão atual | PENDENTE | SHOW-002;UX-002 | URL, SHA, tenant autorizado, Passports IDs reais, /workspace, captura desktop/mobile e logs |
| SHOW-004 | SHOW | Gate segurança/exposição da apresentação | PENDENTE | SHOW-003 | Checklist D07, exclusão de segredos, consentimento/dados e decisão externa formal |
| SHOW-005 | SHOW | Ensaio + pacote de demonstração auditável | PENDENTE | SHOW-004 | Roteiro 8–12 min, demo real ou gravação/capturas da build real, fallback honesto, D09 com GO/NO-GO |
| TA-001 | TA | M17.5 V1: registrar apenas deltas ainda abertos | CONCLUÍDO DOCUMENTALMENTE após publicação válida de 1.0.5 · DEC-TA-001-DOC-ACCEPT · EV-046–EV-049 | GOV-001 | Mapa V1 S1–S8, status prova por tarefa, 1º bloqueio real, sem reabrir PR #84–87 |
| TA-002 | TA | Concluir LX03/SR2 e contenções do M17.5 efetivamente bloqueantes | PENDENTE DE AUTORIZAÇÃO após conclusão válida de TA-001; não iniciado, bloqueios técnicos preservados | TA-001 | Cada lacuna do gate V1 resolvida por prova exata; sem supor encerramento global de LX07 |
| TA-003 | TA | Concluir Trust & Assurance V1 Hub operante | BLOQUEADO | TA-001;TA-002 | Capacidade→evidência→framework→assurance/gaps/claims, tenant, lineage, desconhecidos e provas V1 |
| TA-004 | TA | Gate formal de encerramento M17.5 V1 | BLOQUEADO | TA-002;TA-003 | DoD V1 verificadas, relatório de evidências, decisão explícita CLOSED/OPEN |
| M18-000 | M18 | S0 — ADR a partir do pré-desenho existente | BLOQUEADO | TA-004 | ADR aprovado + índice + amendment escopo/4 personas/economia + DoD A–O/W01–W48 |
| M18-001 | M18 | S1 — conter legado e aceitar Executive já implementado | BLOQUEADO | M18-000;HIST-005 | Rota principal não expõe métricas legadas, S1 browser E2E, D2/D3 revalidados, segurança e Passport |
| M18-002 | M18 | S2 — Display Claim Envelope e medidas com UNKNOWN | BLOQUEADO | M18-000 | W06–W16: conservação, escopo, no ratios, NON_ATOMIC, drill-down, UNKNOWN≠0 |
| M18-003 | M18 | S3 — leitura org-scoped governada e tenant-bound | BLOQUEADO | M18-002 | W01–W24/W41–W44: autorização, atomicidade, listagem, escopo, provas cross-tenant |
| M18-004 | M18 | S4 — leitura runtime/M15 e visibilidade de custo 7A | BLOQUEADO | M18-002 | W34–W37, por fonte/janela; SUPPLIED/DERIVED/UNKNOWN sem somas indevidas |
| M18-005 | M18 | S5 — fila de revisão/supervisão governada | BLOQUEADO | M18-002 | Pendentes/deferred com principal e lineage, sem novo workflow de governança |
| M18-006 | M18 | S6 — Shadow e Review Prompts determinísticos | BLOQUEADO | M18-003;M18-004;M18-005 | W25–W33, IDs determinísticos, sem escrita/LLM como autoridade |
| M18-007 | M18 | S7 — Executive e três níveis de navegação da matriz | BLOQUEADO | M18-001;M18-003;M18-006;TA-004 | Estratégico/tático/operacional, dados coerentes e drill-down provado |
| M18-008 | M18 | S7 — CISO / Security persona | BLOQUEADO | M18-003;M18-005;TA-004 | Riscos/controles/supervisão com links de evidência e autorização do principal |
| M18-009 | M18 | S7 — Compliance / Auditor persona | BLOQUEADO | M18-003;TA-004 | Assurance V1, evidências/lineage, histórico de decisões sem falso certificado |
| M18-010 | M18 | S7 — AI / Data Owner persona | BLOQUEADO | M18-003;M18-005 | Ownership/assigned-to-me de fatos permitidos, tenant e critérios sem herança fictícia |
| UX-003 | UX | Polimento corporativo completo/QA multi-rota DS-2..DS-9 | BLOQUEADO | M18-007;M18-008;M18-009;M18-010 | Coerência enterprise, desktop/mobile, teclado, contraste, temas por rota, screenshots de prova |
| M18-011 | M18 | S8 — validação W01–W48 + aceite M18 | BLOQUEADO | M18-006;M18-007;M18-008;M18-009;M18-010;UX-003 | Gates A–O + W01–W48, navegador E2E, CI PG17, provas por persona, GO formal |
| FUT-001 | FUTURO | Inteligência econômica 7B / Finance-FinOps (M19.5 proposto) | FORA_ESCOPO | M18-000 | Definir roadmap/ADR próprio; preservar objetivo de negócio, sem prometer ROI no M18 |


**TA-001 — consolidação da matriz S1–S8 existente (23/11/2026):** esta é a evolução da matriz reconciliada em F0-006 (EV-029/030), sem segundo mapa ou nova auditoria. Os estados técnicos são reutilizados, não retestados. O [contrato Hub §14](docs/trust-assurance/v1-hub-read-contract.md#14-implementation-classification-and-proposed-slices) governa capacidades/dependências; o [índice de arquitetura](docs/agent/ARCHITECTURE_INDEX.md) localiza provas e sucessores. O texto histórico de S0 `PROPOSED_NOT_STARTED` não reabre fechamentos posteriores. Desenho ou fechamento documental não comprova operação do Hub.

| Slice | Capacidade esperada | Estado técnico comprovado / preservado | Evidência ou referência canônica | Lacuna ainda aberta | Dependência obrigatória | Critério objetivo de fechamento |
|---|---|---|---|---|---|---|
| S1A Audit/LX08 | Leitura Audit V2 vinculada a org/principal, com EMPTY/UNKNOWN/missing explícitos e sem autoridade dos payloads | CONTAINED/PASS local; hosted não verificado | EV-029/030; [fechamento S1A1–3](docs/codex/evidence/2026-10-21-m17.5-v1-s1a1-3-audit-surface-lx08-closure.md); [status LX08 v2](docs/trust-assurance/lx08-audit-containment-status-v2.json) | Nenhum delta local demonstrado; não ampliar a prova para hosted | S0 documental, atendido no limite registrado | Preservar o fechamento local e suas provas de autorização/tenant/EMPTY/UNKNOWN; validação hosted somente em escopo futuro próprio, sem condicionar TA-001 a nova coleta |
| S1B legado vivo | Conter L01–L03/LX01–LX07, defaults e pontes legadas em todos os caminhos ativos afetados | L01/LX02, L02, L03 CONTAINED/PASS local; SR2 A1–A3 e pre-A4 H1/P1-H2/P1-FRAME/P3-REV/M1/M2/M3 fechados nos limites registrados; LX07 #84–87 integrados | EV-029/030, EV-003; [índice: C1/C2/A1–A3/pre-A4/LX07](docs/agent/ARCHITECTURE_INDEX.md); [status LX03 B1/B2](docs/trust-assurance/lx03-graph-search-talk-containment-status-v1.json); §5 REC-03/07/08 | LX03 NEEDS_CONTAINMENT; LX07 global e LX01/04/05/06 residuais abertos; A4 BLOCKED na rota SR2, A5/A6 não iniciados; M3 F-2/F-3 seguem para A4 | S1A, fechado localmente; rota técnica e gates próprios, sem refazer fundações concluídas | Prova por superfície/caller residual: tenant e principal exatos, ausência de fallback/ponte não admitida e de autoridade inferida; na rota SR2, gates de qualidade/segurança/paridade e desconexão legada comprovados antes do fechamento global |
| S1C packages/exportações | Conter L04 graphos-complete/compatibilidade e LX09 PDFs dormentes, preservando o guard L05 | Contrato existente; Reports com correção parcial; L05 SAFE somente no guard inspecionado | EV-029/030; contrato Hub §§12/14 (L04/L05/LX09); §5 REC-03, PR #84–87 | Fechamento global S1C não evidenciado; alcance hosted UNKNOWN | S1B | Provas dos caminhos de package/export/compatibilidade impedindo claims/percentuais/artefatos não admitidos e reativação LX09; nenhuma herança de SAFE para geradores ou deploy |
| S2 contratos | Identidades tipadas, mode/scope/errors, vetor de versão imutável e serialização D-V1-08 sem denominador genérico | S0 e decisões V1-A1/V1-A2 documentais preservados | EV-029/030; contrato Hub §§3–7/14 e W-V1-01–11 | Contratos operacionais compartilhados não evidenciados | S1C | Contratos tipados e verificações de identidade, versão, escopo, conservação de conjuntos e rejeição de denominação/serialização indevida; sem nova autoridade/permissão |
| S3 reads tenant-bound | Leituras aditivas de inventário, evidência/lineage e vínculos registry/M16/M17 sob autorização existente | 40 categorias de leitura e componentes upstream inventariados; composição completa não comprovada | EV-029/030; contrato Hub §6 (40 categorias de leitura), §§5/14 e W-V1-01–05/08/11 | Wrappers/composição atômica do Hub, completude e prova cross-source não evidenciados | S2 | Testes de principal forjado/revogado, tenant cruzado, paginação, snapshot/as-of e completude; negar sem filtro posterior na aplicação nem ampliação de grants |
| S4 PRODUCT | Projetar V0/E1 imutável, precedência de claims e populações separadas de gaps/exposição | Pack V0/E1 e contratos documentais disponíveis; operação não comprovada | EV-029/030; contrato Hub §§8–10/14 e W-V1-12/13/19 | Projeções PRODUCT operacionais não evidenciadas | S2; independente de S3 | Projeção determinística dos pins V0/E1, 38 ceilings S2 e 42 claims preservados; ausência/inconsistência S2 falha fechada; 61 gaps e 14 gates conhecidos separados, sem aprovação de exposição |
| S5 TENANT | Assurance por manifesto imutável, fontes lícitas completas, revisões e lineage sob leitura atômica | Manifesto e eixos independentes desenhados; execução não comprovada | EV-029/030; contrato Hub §§3–10/14 e W-V1-02–14 | Fontes/licenças, applicability/sufficiency review, vínculos aditivos e execução tenant ainda por provar | S3 + S4; autorização própria, fontes completas e revisões aplicáveis | Escopo/pins exatos, estados independentes e provas de atomicidade/lineage; fontes incompletas ou review ausente impedem execução completa e mantêm HOLD, sem inferir compliance |
| S6 European Profile | Eixos de edição original, direito vigente e aplicabilidade separados, com revisão qualificada | Contrato documental; execução tenant não comprovada | EV-029/030; contrato Hub §§10/14 e W-V1-15 | Revisão qualificada e eixos operacionais não comprovados | S4 + S5; painel de referência PRODUCT pode preceder execução tenant | Testes mantêm UNKNOWN sem revisão qualificada, distinguem edição OJ de direito vigente e vedam agregado legal/certificação inferidos |
| S7 API/UI Hub | Onze views A–K com allowlists server/client/export e drill-down autorizado/acessível | Views desenhadas; E2E completo não evidenciado | EV-029/030; contrato Hub §§10–14 e W-V1-16–19 | API/UI/exports e exposição real nos caminhos de navegação não comprovados | S1C + S4 + S5 + S6 | E2E de autorização, allowlists, UNKNOWN, lineage e exposição por caminho real, com acessibilidade e sem autoridade LLM/graph/vector; candidato interno, demo/publicação sob gate próprio |
| S8 fechamento adversarial | Aceitação runtime de segurança, semântica e contenção global V1 | W-V1-01–20 documentais; aceite runtime não evidenciado | EV-029/030; contrato Hub §§14–15 | Provas adversariais runtime e aceite global pendentes | S7 | Evidência por predicado de tenant/principal, paginação/as-of, EMPTY/UNKNOWN, denominadores, precedência de claims, invalidação de artefatos e exposição legada; revisão independente única aplicável e decisão formal, sem liberar HOLD automaticamente |

**Primeiro bloqueio efetivo:** TA-001 é o primeiro predecessor de gestão para TA-002, com GOV-001 já atendido. A primeira frente técnica efetivamente bloqueante é **S1B/LX03**, não a consolidação documental. Na rota SR2 documentada, **A4 BLOCKED**: MiniLM V3 obteve 12/12 no corpus original e 3/8 no independente, sem qualidade aceita; MPNet tem runtime CUDA qualificado, mas qualidade insuficiente (EV-029/030, §5 REC-07/08). V2 permanece baseline experimental; V3/MPNet não são promovidos; Voyage continua bloqueado/em quarentena. A4 não é automaticamente a única solução arquitetural de contenção. Nenhuma rota alternativa é decidida ou autorizada por TA-001.

**Problema LX03 a transportar, sem nova investigação:** B1/B2 originais são distintos dos achados encerrados de A3. EV-029/030 registram mitigação tenant na aplicação pelo PR #87, RPC `agent_semantic_search` legada sem o vínculo tenant completo do agent associado e dependência ativa `coding_memory_search` conflitante com o catálogo M16. A fundação SR2 fechada não prova substituição operacional, paridade Talk ou desconexão desses caminhos. LX07 global, LX01/04/05/06 e S1C permanecem lacunas separadas; os deltas #84–87 não são reabertos.

**TA-002 — menor recorte técnico proposto, NÃO AUTORIZADO / NÃO INICIADO:** começar por um candidato local delimitado de S1B/LX03 sobre B1/B2, reaproveitando as fundações e critérios existentes, antes de Hub S2–S8. Seu contrato de execução precisa fixar a hipótese técnica nova e a rota que Carlos autorizar. Se mantida SR2, o primeiro impedimento é a qualificação A4 ainda sem qualidade aceita; não repetir tuning V3/MPNet sem hipótese material nova. O escopo não é refazer SR2 A1–A3/M1–M3, implementar todo A4–A6 de uma vez, nem criar arquitetura alternativa por inferência.

| Campo do recorte TA-002 | Limite e prova exigidos |
|---|---|
| Problema exato / evidência existente | Eliminar dependência de leitura sem vínculo tenant completo e de RPC não admitida, preservando funções úteis Talk; EV-029/030, status LX03 B1/B2 e [ADR SR2 §§7–8/12–14](docs/architecture/ADR-GOVIA-M175-C3-SR2-TYPED-SEMANTIC-PARITY-V1.md) |
| Limite da intervenção | Um delta local de contenção/qualificação da rota explicitamente autorizada, com callers/superfícies e corpus fixados no início; sem hosted, ativação/população de produção, Voyage, alteração histórica de migrações, novos grants ou expansão Hub/M18 |
| Dependências | TA-001 aceito/publicado; autorização técnica específica de Carlos. Para SR2: gates de provider/revisão imutável, egress, recursos e qualidade (§8); obrigações pre-A4 remanescentes e M3 F-2 (ranking de fontes negadas)/F-3 (locks legados/barreira de writers), sem reabrir seus fechamentos. Follow-ups e H1 hosted equality continuam nos gates em que se aplicam; coleta hosted exige autorização própria |
| Aceite testável do recorte | Fixtures controladas comprovam negação para principal forjado/revogado/tenant cruzado, nenhum conteúdo de fonte não admitida, nenhum fallback às RPCs legadas ou outro space/provider; evidência por função/caso obrigatório de qualidade/paridade, sem média que esconda falha (§12). Na rota SR2, usar P01–P11 aplicáveis; P12 e desconexão somente nos estágios autorizados (§13). Registrar lacunas remanescentes: passar um recorte não fecha LX03, S1B ou TA-002 globalmente |
| Condição para retomar código | Contrato técnico de TA-002 autorizado, hipótese material nova para o bloqueio que atacar e critérios/corpus fixados. Sem isso, STOP no bloqueio já conhecido; não investigar alternativa em paralelo |

**Contrato TA-001:** `DEC-TA-001-LOCAL` / EV-043, solicitação de Carlos de 23/11/2026, autoriza apenas este candidato em `GOVIA_MASTER.md`; baseline remota/HEAD `8ba80abb1cc9aa2e8a6ed01aff6ca8e428b92bb4`, master de origem 1.0.4, branch `docs/ta-001-documental-deltas-20261123`, worktree `.worktrees/ta-001-documental-deltas-20261123`, limpa no preflight (EV-044). Estado anterior PENDENTE → CANDIDATO DOCUMENTAL LOCAL; conclusão formal na main pendente de publicação e aceite aplicáveis. Aceite documental: uma só matriz, seis campos por slice, dependências/EV rastreáveis, 33 tarefas WBS preservadas, nenhum delta funcional, estados/riscos canônicos preservados e `git diff --check` PASS (EV-045). Executor Codex; decisor Carlos; sem nova revisão Codex × Claude. Alvo ativo informativo 30 minutos; esforço ativo medido DESCONHECIDO. STOP em baseline divergente, conflito material, falta de dependência necessária à consolidação ou delta fora do master; nenhum código TA-002/003/004 ou M18, SQL, Docker/WSL, hosted, deploy, regras GitHub, ADR ou liberação Voyage.

### 7.3 Datas herdadas — referência histórica, não compromisso

Abaixo estão os cenários publicados no Plano Mestre v1.0/v1.1. Aguardam replanejamento por delta, capacidade, riscos, dependências e autorização. Não usar estas janelas como promessas a cliente ou como relógio para forçar gates.

| Janela prevista | Marco/gate | Resultado verificável | Confiança |
| --- | --- | --- | --- |
| 19–23 nov/2026 | G0 controle técnico e início de prova | Plano adotado + branch protegida + IDs ativos | Alta para preparação; segurança depende permissões |
| 20–24 nov/2026 | Fonte/E1 já comprovados + UX-0 | Recibos indexados; screenshots atuais e defeitos priorizados | Média |
| 25 nov–07 dez/2026 | Demonstração com UX coerente | Build real, jornada/recibo, tela responsiva, segurança e ensaio | Baixa; depende do ambiente autorizado |
| 23 nov–18 dez/2026 | M17.5 V1 pendências e gate | Hub V1 e contenções requeridas, critérios de CLOSED | Baixa; dependências ainda abertas |
| 21–23 dez/2026 | M18-S0 formal | ADR, decisões D01–D15, DoD W01–W48; após M17.5 | Baixa/condicional |
| 23 dez/2026–08 jan/2027 | M18 S1/S2 | Aceite Executive e contratos/limites de agregação | Baixa/condicional |
| 11 jan–05 fev/2027 | M18 S3–S5 | Leituras governadas de portfólio, runtime e supervisão | Baixa/condicional |
| 08–26 fev/2027 | M18 S6/S7 | Prompts, matriz e workspaces de quatro personas | Baixa/condicional |
| 01–12 mar/2027 | UX QA + M18 S8 | E2E, mobile, WCAG, segurança, W01–W48, aceite formal | Baixa/condicional |


## 8. Contratos de produto e critérios de aceite

### 8.1 Invariantes arquiteturais

**Tese:** matriz de governança da IA, com verdade canônica única e múltiplas perspectivas estratégicas/táticas/operacionais. Oito pilares (Discovery & Inventory; Data & Context; Identity/Access & Accountability; Risk; Controls & Human Oversight; Runtime & Operations; Value/Cost & Outcomes; Assurance & Proof) e seis dimensões transversais (Evidence/Provenance/Lineage; Coverage/UNKNOWN; Temporal/Version/Change; Human Oversight; Authority/Accountability; Security/Tenant Isolation). `Governance Effectiveness` é dimensão transversal, nunca nono pilar ou score.

**Contratos congelados:** 11 `CanonicalObjectKinds`, 12 tipos de relações, 16 famílias Passport, 5 famílias L14 e 4 L15; tudo com escopo de organização, fonte, tempo, decisão e proveniência. `DISCOVERY != GOVERNANCE AUTHORITY`; máquina no máximo `PROPOSED`; `SOURCE ASSERTION != CANONICAL FACT`; `UNKNOWN != 0`; `NOT_EVIDENCED != COMPLIANT`; persona não é permissão nem autoridade; sem inferir titularidade, ROI, cobertura ou certificação.

### 8.2 Estado M17.5 e M18

- **M17.5 V1 Trust & Assurance:** V0 documental e ADR/contratos do Hub V1 identificados; Hub operacional e contenções globais ainda não aceitos. `M17.5 OPEN`.
- **M18 Executive S1:** `/workspace`, query, modelo e UI presentes no `main`; RPC `read_executive_workspace_v1` transacional SEC-01 integrada; browser/UX e aceite de negócio ainda pendentes. `INTEGRADO_NAO_ACEITO`.
- **M18 completo:** `HOLD` até M17.5 formalmente CLOSED ou decisão arquitetural excepcional aprovada; S0 ADR ainda pendente, sem confundir código S1 antecipado com autorização para S2–S8.
- **Quatro personas oficiais:** Executive/Board, CISO/Security, Compliance/Auditor e AI/Data Owner. O limite 7A de visibilidade de custo sustentado por dados não autoriza ROI e FinOps 7B; `DEC-003` continua em aberto para S0/M19.5.
- **M18 DONE:** gates A–O e W01–W48 aplicáveis, quatro personas aceitas, segurança/tenant, browser real, CI e ato formal de aceite de Carlos. Nem visual novo nem demo parcial substituem essas provas.

**Limite do fechamento F0-006:** a matriz S1–S8 em §7 é insumo para TA-001, sem implementação ou aceite dessa tarefa. Permanecem LX03, LX07 global, contenções residuais/S1C e Hub operacional sem fechamento; A4 BLOCKED na rota SR2 atual, sem promover V3/MPNet/Voyage. SEC-01 integrado/testado historicamente não recebe aceite funcional ou operacional; TEST atual e browser Executive atual NOT_EVIDENCED. M17.5 OPEN, M18 HOLD e exposição externa NO-GO preservados.

**Atualização de aceite TA-001:** §7.2 mantém a consolidação aprovada sem alteração de matriz. DEC-TA-001-DOC-ACCEPT conclui TA-001 exclusivamente no eixo documental após publicação válida de 1.0.5; TA-002 passa a PENDENTE DE AUTORIZAÇÃO. Contenções e Hub operacional continuam pendentes, sem aceite de TA-002/003/004 ou de produto, sem reabrir F0-004–007 ou alterar seus limites.

### 8.3 Demonstração — checkpoints D01 a D09

| ID | Critério observável | Interpretação |
|---|---|---|
| D01 | GitHub de fonte real, SHA fixado, aquisição | Fonte pública e CI isolada não comprovam ingestão atual |
| D02 | Detecção e candidato com evidência/proveniência | Scanner não gera fatos canônicos diretamente |
| D03 | Revisão humana autenticada e decisão rastreável | Sem aprovação artificial |
| D04 | Objeto canônico persistido com escopo/lineage | Sem insert direto ou fixtures em banco operacional |
| D05 | Navegação real Discovery → Review → Passport | URL/IDs reais |
| D06 | `/workspace` lê a mesma verdade governada | `UNKNOWN` íntegro, sem dados encenados |
| D07 | Segurança e exposição aprovadas | Controle de segredos, audiência, dados e autorização |
| D08 | Estado de risco/controle/assurance honesto | Não alegar conformidade, certificação, ROI sem prova |
| D09 | Jornada E2E observada | SHA, ambiente, links, browser, screenshots e GO/NO-GO documentados |

**Histórico importante:** E1 já levantou evidências hospedadas D01–D06; estado de PostgreSQL TEST/local e navegador de hoje não é inferível desses recibos. SEC-01 foi reportado como aplicado no TEST em 11/11/2026; isso não é permissão para reaplicá-lo nem prova de instalação atual. Nunca criar novamente o repositório de demo, nem reexecutar o fluxo inteiro sem critério de aceite e escopo.

## 9. Experiência enterprise — baseline DS-0 a DS-9

**Estado:** especificação UX v1.1 tecnicamente revisada, implantação não autorizada automaticamente. Objetivo é tornar GOV IA enterprise — não um dashboard experimental genérico — usando estados, proveniência, legibilidade e navegação real. Rebranding GOV IA e i18n PT-BR/EN são frentes funcionais separadas até autorização; manter textos cobertos por testes enquanto migrar visual.

**Regras centrais:** tokens semânticos, dark seguro até light validado por rota; não gerar busca/ordenação/paginação fictícias em `/agents/canonical`; não promover `/workspace` no menu como prontidão sem liberação; `CERTIFIED` apenas onde verdadeiramente já existe no fluxo; nenhum novo badge de conformidade, scores ou métricas artificiais; foco, teclado, responsividade e contraste mensurado (normal ≥4,5:1, grande ≥3:1, ícones essenciais ≥3:1).

**Escopo visual:** `apps/dashboard` apresentação e `components/ds/` em slices autorizados; não tocar APIs, banco, auth, migrações, scanner, ledger, dependências sem consentimento, nem testes para simular PASS.

| Slice | Entrega | Arquivos permitidos principais | Validação focada | Condição de fechamento |
| --- | --- | --- | --- | --- |
| DS-0 | ADR, decisões e índice | `docs/architecture/ADR-GOVIA-DESIGN-SYSTEM-v1.md`, `docs/architecture/GOVIA_ENTERPRISE_UX_DS_V1_BASELINE_EXECUCAO_2026-11-16.md` (este baseline), `docs/agent/ARCHITECTURE_INDEX.md` | Diff documental + preflight; testes não aplicáveis | Escopo e gates registrados, sem modificar app |
| DS-1 | Tokens, fontes, infraestrutura de tema, aliases legados | `app/globals.css`, `app/layout.tsx`, `package.json` se autorizado | Typecheck + 4 suítes UI; contraste | Dark seguro; light não liberado globalmente antes da migração |
| DS-2 | `components/ds/`, ícones e seis primitivos compatíveis | `components/ui/*`, `components/ds/*`, `components.json` se autorizado | Typecheck + 4 suítes UI | Sem colisão Windows nem API de componentes quebrada |
| DS-3 | Estados/proveniência e componentes de leitura | `components/ds/*`, `components/workspace/StateBadge.tsx`, `components/ui/Badge.tsx`, `components/ui/LegacyRiskBadge.tsx` | Passport, Workspace, Audit + typecheck | Estado não passa a alegar autoridade inexistente |
| DS-4 | Shell e navegação | `components/layout/*`, `app/(dashboard)/layout.tsx` | Pre-demo UI + typecheck | Mesmos rótulos/rotas; nenhum M18 HOLD liberado |
| DS-5 | `/agents` e `/agents/canonical` visuais | `AgentTable.tsx`, `app/(dashboard)/agents/**`, `components/ds/DataTable*` | Passport UI + typecheck + testes existentes da rota se aplicáveis | Filtros/paginação reais onde a API suporta, nos termos da exceção §8.2 se autorizada; sem falsas capacidades |
| DS-6 | Passport 360 visual | `components/agents/AgentPassport.tsx` e DS já existentes | Passport UI + typecheck | 16 sections, âncoras, `<details>`, texto intactos |
| DS-7 | Review Queue; opcional DS-7a/7b | `app/(dashboard)/governance/reviews/**`, apresentações locais | Testes de revisão existentes + typecheck | Sem alteração em decisão/handlers/controle de acesso |
| DS-8 | Home, Workspace e demais telas; a função `State` do Workspace passa a ler o mapeamento único | `app/(dashboard)/**`, `components/workspace/*`, `components/dashboard/*`, `components/audit/*` e apresentação autorizada | Typecheck + 4 suítes UI | Zero novos indicadores/autoridades; claro/escuro por rota |
| DS-9 | Limpeza, contraste, acessibilidade, fechamento | `app/globals.css` e apresentações identificadas | Typecheck + `apps/dashboard:test` final, uma vez | Critérios §11 completos e modo claro global liberado |


**Gates UX:** UX-0 (screenshots reais e defeitos atuais) precede DS-0; uma branch/sessão por slice; inspeção visual desktop/mobile, contraste WCAG, testes focados e revisão independente. No DS-9, só liberar modo claro global quando todas as rotas críticas estiverem verificadas. Especificação antiga é **evidência de desenho**, não segunda fonte ativa de gestão.

## 10. Registro aditivo de decisões e evidências

### 10.1 Decisões base preservadas

| ID | Tema | Posição já existente / ação | Estado | Decisor |
| --- | --- | --- | --- | --- |
| DEC-001 | Prioridade do produto | Concluir M18 integralmente; demo segura como trilho imediato | FIXADA NESTA CONVERSA | Carlos |
| DEC-002 | Fonte demo real | Proibir mocks de negócio e inserts canônicos diretos; GitHub source real | FIXADA ANTERIORMENTE | Carlos |
| DEC-003 | Escopo econômico M18 versus M19.5 | Pré-draft propõe 7A no M18 e 7B/FinOps em M19.5; especificação inicial prevê S2/S3/Finance no M18 | PENDENTE FORMALIZAÇÃO | Carlos |
| DEC-004 | Gate M17.5→M18 | Não declarar M18 S0 formal implementável antes do M17.5 V1 CLOSED ou decisão formal de mudança | HERDADA ROADMAP | Carlos |
| DEC-005 | Produto visual enterprise | Preservar UX DS v1.1 e backlog UX v2; revisão visual real, sem trocar conteúdo sem autorização | BASELINE DE PROPOSTA | Carlos |
| DEC-006 | Exposição externa e ambiente demo | Escolher ambiente, tipo de demo, dados e audiência; GO/NO-GO específico | PENDENTE | Carlos |
| DEC-007 | Proteção de main e check de plano | Exigir PR com TASK_ID e status check/ruleset; registro de decisão e baseline | PENDENTE IMPLANTAÇÃO | Carlos |
| DEC-008 | DoD M18 full | Preservar pré-draft W01–W48; formalizar A–O e D01–D15 no M18-S0 | PENDENTE S0 | Carlos |


### 10.2 Decisões REC aprovadas (19/11/2026)

| DEC-ID | Decisão | Estado | Autoridade | Data |
|---|---|---|---|---|
| `DEC-REC-000` | Matriz de recuperação e F0 documental aprovadas | APROVADA | Carlos | 2026-11-19 |
| `DEC-REC-001` | Proibido refazer feature integrada sem delta comprovado | APROVADA | Carlos | 2026-11-19 |
| `DEC-REC-002` | Proibido merge automático de worktrees antigos | APROVADA | Carlos | 2026-11-19 |
| `DEC-REC-003` | BYOM é candidato local, não módulo SaaS aceito | APROVADA | Carlos | 2026-11-19 |
| `DEC-REC-004` | SR2-A4: preservar V2 experimental, não promover V3; tuning requer hipótese nova | APROVADA | Carlos | 2026-11-19 |
| `DEC-REC-005` | SEC-01 no TEST: evidência histórica, checagem antes de qualquer migração | APROVADA | Carlos | 2026-11-19 |
| `DEC-REC-006` | M18 S1 integrado não implica aceite; M18 HOLD preservado | APROVADA | Carlos | 2026-11-19 |
| `DEC-REC-007` | UX: usar DS v1.1; UX-0 antecede desenvolvimento | APROVADA | Carlos | 2026-11-19 |
| `DEC-REC-008` | Só declarar aceite/claim com prova; demo tem GO próprio | APROVADA | Carlos | 2026-11-19 |


### 10.3 Novas decisões de consolidação / autorização

| DEC-ID | Data | Decisão registrada | Autoridade | Estado |
|---|---|---|---|---|
| `DEC-GOV-001-PREP` | 2026-11-19 | Preparar contrato de agentes e proteção Git/CI GOV-001/GOV-002 **sem modificar o repositório** | Carlos | APROVADO — PREPARAÇÃO SOMENTE |
| `DEC-GOV-ONE-MASTER` | 2026-11-19 | Substituir múltiplos arquivos de **gestão** por um único `GOVIA_MASTER.md`, com plano, decisões, tarefas, status, fontes e regras de execução; entregar versão única para revisão | Carlos | APROVADA — CONSOLIDAÇÃO DOCUMENTAL |
| `DEC-GOV-PR-BOOTSTRAP` | 2026-11-19 | Criar branch e PR documental de GOV-001 com master único e referências mínimas em `AGENTS.md`/`CLAUDE.md`; sem merge e sem alteração direta de `main` | Carlos | **AUTORIZADO — PR APENAS; tentativa 403** |
| `DEC-GOV-001-DOC-CORRECTION` | 2026-11-19 | Atualizar somente `GOVIA_MASTER.md` na branch do [PR #88](https://github.com/cnegrao/code-guard-governance/pull/88) para registrar a publicação e preservar os gates vigentes | Carlos | AUTORIZADO — CORREÇÃO DOCUMENTAL |
| `DEC-GOV-PUBLISH` | — | Aceitar conteúdo final, integrar PR, instalar CI GOV-002 ou ativar ruleset | Carlos | **NÃO DECIDIDO**; exige decisão específica posterior |
| `DEC-GOV-001-ACCEPT` | 2026-11-19 | Aceite explícito da rc4 e autorização de integração do PR #88. Autorização subsequente de branch, PR e merge exclusivos de `GOVIA_MASTER.md` e fechamento de GOV-001 após reconciliação das provas e observância dos gates do GitHub. Substitui `DEC-GOV-PUBLISH` somente quanto a GOV-001 | Carlos | ACEITO · EV-016 |
| `DEC-F0-004-DOC-CLOSE` | 2026-11-19 | Carlos autorizou o PR documental e integração controlada de fechamento **somente documental** de F0-004 após conciliação Codex × Claude. Registrar F-01–F-07 e V1–V3, sem resolver funcionalmente nenhum achado, sem abrir F0-005 e sem mudar gates de produto | Carlos | ACEITE DOCUMENTAL LIMITADO — EV-020; publicação sujeita a PR/checks/revisão |
| `DEC-F0-005-DOC-QUARANTINE` | 2026-11-19 | Encerrar documentalmente F0-005 com arquivo em quarentena; Carlos aceita o risco residual exclusivamente durante a quarentena. Autoriza branch, commit, PR e merge **somente de GOVIA_MASTER.md**, sem bypass e após checks/revisão humana efetivamente exigidos e HEAD validado. Não libera REC-09 nem autoriza uso, integração, execução, distribuição ou exposição Voyage; utilização futura requer triagem específica e nova autorização. Atualiza o estado de F0-005 e seu tratamento no gate F0, preservando F0 ABERTA | Carlos | ACEITE DOCUMENTAL CONDICIONADO — EV-022–EV-027; não é liberação de segurança |
| `DEC-F0-006-DOC-CLOSE` | 2026-11-23 | Carlos autoriza fechamento documental condicionado F0-006, incorporação C1–C6 e branch/worktree/commit/PR/merge exclusivos do master, após gates GitHub efetivos e HEAD validado, sem bypass. Adota expressamente F0(c) atendido quanto à reconciliação das evidências históricas sobre o TEST, sem verificar seu estado atual nem apagar o gate original. REC-05 VERIFICAR ESTADO, TEST atual NOT_EVIDENCED; verificação específica futura autorizada obrigatória antes de migração, D06/SHOW-003 ou aceite dependente do TEST atual. Sem acesso hosted, aceite SEC-01/M18, execução TA-001 ou início F0-007 | Carlos | ACEITE DOCUMENTAL CONDICIONADO — EV-028–EV-034; FASE 0 ABERTA |
| `DEC-F0-007-DOC-ACCEPT` | 2026-11-23 | Carlos confirmou o aceite integral exclusivamente documental da Fase 0/F0-007 e autorizou registro/publicação somente no master, por branch/worktree isolado, commit, PR e merge após gates GitHub efetivos, sem bypass. Referencia baseline `cccaf8812060ba2812e35dbcc6ae02715e0ba352`, master 1.0.3 e os dois pareceres recebidos. Após publicação válida: FASE 0 ENCERRADA DOCUMENTALMENTE; F0-007 CONCLUÍDO DOCUMENTALMENTE. Incorpora E1 e gates A–E, B sob quarentena contínua. Preserva F0(c) conforme DEC-F0-006-DOC-CLOSE, REC-05/TEST, riscos/severidades, M17.5 OPEN, M18 HOLD, GOV-002 NÃO IMPLANTADO e exposição NO-GO. TA-001 PENDENTE, sem nova dependência, sujeita a autorização separada; nenhum aceite funcional/operacional nem hosted/deploy/banco/código autorizado | Carlos | ACEITE DOCUMENTAL FORMAL — EV-035–EV-040; eficácia condicionada à publicação válida; sucede somente o estado corrente de FASE 0/F0-007, sem revogar decisões/limites anteriores |
| `DEC-TA-001-LOCAL` | 2026-11-23 | Carlos autoriza iniciar TA-001 exclusivamente para consolidação documental local mínima no master, reutilizando §7.2, EV-029/030, contrato Hub e decisões aceitas. Formalizar pendências S1–S8, primeiro bloqueio e recorte sugerido TA-002; sem nova auditoria, revisão Codex × Claude, reabertura F0 ou retrabalho #84–87. Não autoriza commit, publicação, PR, merge, TA-002/003/004, M18, código/testes, SQL, hosted, Docker/WSL, deploy, regras GitHub, arquitetura/ADR ou liberação Voyage | Carlos | AUTORIZADO — CANDIDATO LOCAL SOMENTE; EV-043. Sucede apenas a espera de autorização de preparo TA-001; aceite e conclusão formal na main permanecem pendentes |
| `DEC-TA-001-DOC-ACCEPT` | 2026-11-23 | Carlos aceita documentalmente o candidato 1.0.5-rc1 do PR #94, HEAD `4c4547634af4a5a1f13ae3b6d4a177ec5e32f7bd`, e autoriza somente ajuste mínimo no master para 1.0.5, commit/push na mesma branch e merge normal condicionado ao novo HEAD, M15/M16 SUCCESS e demais gates efetivos do GitHub, sem bypass. Após publicação válida: TA-001 CONCLUÍDO DOCUMENTALMENTE; TA-002 PENDENTE DE AUTORIZAÇÃO. Não autoriza início de TA-002, nova consolidação/revisão, alteração da matriz/arquitetura ou operação funcional/hosted/deploy | Carlos | ACEITE DOCUMENTAL CONDICIONADO À PUBLICAÇÃO VÁLIDA — EV-047–EV-049. Sucede as restrições de publicação e a espera de aceite do candidato, sem apagar os checkpoints DEC-TA-001-LOCAL/rc1 nem liberar bloqueios técnicos e gates de produto |

**CONFLICT-GOV-001-001 — reconciliado.** A rc4 descrevia o PR #88 como aberto em draft após a integração já comprovada no GitHub. Dono: Carlos. EV-013 comprova o estado Git e DEC-GOV-001-ACCEPT autoriza a correção. O registro anterior permanece no histórico rc4.

**Histórico imutável:** decisões anteriores não são apagadas; correção ou revogação exige novo DEC-ID com vínculo `supersedes`, justificativa, impacto e aprovação. `DEC-003` (fronteira econômica M18/M19.5) segue em aberto. Não criar uma planilha ou Decision Register paralelo para editar decisões.

### 10.4 Evidências técnicas e operacionais existentes

| EV-ID | O que comprova | Tipo | Origem / URL | Data | Qualificação |
| --- | --- | --- | --- | --- | --- |
| EV-001 | M15 pós-merge | CI PASS | https://github.com/cnegrao/code-guard-governance/actions/runs/44398363855 | 2026-11-18 | CONFIRMADA |
| EV-002 | M16 PG17/SEC01 pós-merge | CI PASS | https://github.com/cnegrao/code-guard-governance/actions/runs/44398363634 | 2026-11-18 | CONFIRMADA |
| EV-003 | PR #87 | MERGED | https://github.com/cnegrao/code-guard-governance/pull/87 | 2026-11-18 | CONFIRMADA |
| EV-004 | Código-fonte demo | PUBLICADO | https://github.com/cnegrao/govia-agent-source | 2026-11-07 | CONFIRMADA |
| EV-005 | CI fonte demo | PASS | https://github.com/cnegrao/govia-agent-source/actions/runs/42426033651 | 2026-11-07 | CONFIRMADA |
| EV-006 | D01–D02 reais | PASS HISTÓRICO | E0_CFA95F1_EXECUTION_REPORT.md / acquisition-run:c839196c-77a6-48c5-9063-d2025bada1b7 | 2026-11-07 | HISTÓRICA |
| EV-007 | D03–D04 governança | EVIDÊNCIA HISTÓRICA | review-transition:867dc36411d9046e14a6164ac91e142d; reconciliation-decision:f9e291117ae6ddbd4eb2193a9307297d | 2026-11-09 | HISTÓRICA |
| EV-008 | D05 Passport | PASS HISTÓRICO | docs/codex/evidence/2026-11-09-passport-profile-provenance.md | 2026-11-09 | HISTÓRICA |
| EV-009 | D06 Executive | PASS HISTÓRICO | d06-workspace-runtime-20261112/.artifacts/agent/d06-3102-pass.md | 2026-11-12 | HISTÓRICA |
| EV-010 | SEC-01 PostgreSQL concorrência | PASS técnico | docs/codex/evidence/2026-11-11-sec01-transactional-acquisition.md | 2026-11-11 | CONFIRMADA |
| EV-011 | D-1 Passport decode | CÓDIGO PRESENTE | apps/dashboard/app/(dashboard)/agents/canonical/[canonicalObjectId]/page.tsx | 2026-11-18 | CONFIRMADA |
| EV-012 | Segurança Git main | SEM PROTEÇÃO INFORMADA | https://api.github.com/repos/cnegrao/code-guard-governance/branches/main | 2026-11-18 | CONFIRMADA |
| EV-013 | Integração do PR #88: HEAD `271fa268d416e6d218e8719879706500255a4cfd`, merge `2083ecff43e3569f6de7e7e03d07d5a60be2c097` | MERGED | [PR #88](https://github.com/cnegrao/code-guard-governance/pull/88) · [commit](https://github.com/cnegrao/code-guard-governance/commit/2083ecff43e3569f6de7e7e03d07d5a60be2c097) | 2026-11-19, 14h57 de Brasília | CONFIRMADA |
| EV-014 | Referências ao master em AGENTS.md e CLAUDE.md verificadas na main | Leitura Git | [AGENTS.md](https://github.com/cnegrao/code-guard-governance/blob/2083ecff43e3569f6de7e7e03d07d5a60be2c097/AGENTS.md) · [CLAUDE.md](https://github.com/cnegrao/code-guard-governance/blob/2083ecff43e3569f6de7e7e03d07d5a60be2c097/CLAUDE.md) | 2026-11-19, 15h30 de Brasília | CONFIRMADA |
| EV-015 | Primeira retomada governada: leitura dos quatro documentos, preflight §§3.1 e 3.4, handoff §12.2 e identificação da divergência | Relatório de retomada | Sessão Work de 19/11/2026, 15h30 de Brasília · [master lido](https://github.com/cnegrao/code-guard-governance/blob/2083ecff43e3569f6de7e7e03d07d5a60be2c097/GOVIA_MASTER.md) | 2026-11-19, 15h30 de Brasília | CONFIRMADA nesta sessão |
| EV-016 | Aceite rc4, autorização da integração do PR #88, da regularização exclusiva e do fechamento após reconciliação | Decisão explícita de Carlos | Solicitação de regularização final GOV-001 de 19/11/2026, §2 · DEC-GOV-001-ACCEPT | 2026-11-19 | CONFIRMADA nesta sessão |
| EV-017 | Codex concluiu o confronto semântico F0-004 e registrou matriz M18/SEC-01, BYOM e E0 | HANDOFF READ-ONLY; NOT_RUN | `F0_004_CODEX_READONLY_HANDOFF`, anexo de conversa `Pasted markdown(20261119-205059).md`; SHA256 `2c516a16586bf77dcafb8211dc3461f80dc64fd5e270c09591ac329f0cf6784d` | 2026-11-19 | RELATÓRIO RECEBIDO; não é PASS funcional nem objeto Git |
| EV-018 | Claude Code revisou adversarialmente o F0-004; F-01–F-07, V1–V3; nenhum P0 documentado | HANDOFF ADVERSARIAL; NOT_RUN | `F0_004_CLAUDE_ADVERSARIAL_HANDOFF`, anexo `Pasted markdown(20261119-233425).md`; SHA256 `940510fa812ba36e62fc27e63856cc8d2375a2dd40eca4f6d7a28ec88fd658d2` | 2026-11-19 | REVISÃO INDEPENDENTE DOCUMENTAL; não é aprovação humana do PR |
| EV-019 | Baseline Git F0-004 confirmada; master 1.0.0 disponível na `main`; 33 tarefas preservadas | GIT / LEITURA | [main@fb11a04](https://github.com/cnegrao/code-guard-governance/commit/fb11a04cf3688f544fcac9d733453c60f47fee1e); `GOVIA_MASTER.md` blob `ae779ad7e0af23243300d5dc905ce2b0f3b29433` | 2026-11-19 | CONFIRMADA baseline; nenhum novo teste/CI implícito |
| EV-020 | Autorização explícita do responsável para preparar e integrar PR **somente documental** do fechamento de F0-004 | DECISÃO DO RESPONSÁVEL | Resposta `autorizo` após conciliação Codex × Claude, 19/11/2026; `DEC-F0-004-DOC-CLOSE` | 2026-11-19 | Escopo exclusivo; checks/revisão Git continuam obrigatórios |
| EV-021 | Publicação documental F0-004: PR aberto para `main`, HEAD publicado verificado `ee27ff1db87220c52d82b7b8d0c319d3399e9570`, baseline `fb11a04cf3688f544fcac9d733453c60f47fee1e`; único arquivo alterado `GOVIA_MASTER.md` | PR / LEITURA GIT E API | [PR #90](https://github.com/cnegrao/code-guard-governance/pull/90) · [HEAD documental verificado](https://github.com/cnegrao/code-guard-governance/commit/ee27ff1db87220c52d82b7b8d0c319d3399e9570) | 2026-11-19 | CONFIRMADA publicação; HEAD verificado antes deste registro aditivo no mesmo PR. Preflight e validação documental PASS, WBS 33 e históricos/gates preservados; testes funcionais NOT_RUN. Merge ainda não comprovado; sem SHA de merge presumido, sujeito aos checks aplicáveis e requisitos de revisão humana |
| EV-022 | Codex concluiu a triagem F0-005 com classificação inicial SEGREDO_POTENCIAL | RESULTADO ANTERIOR DECLARADO | Solicitação de Carlos “F0-005 — Fechamento documental condicionado”, §3 | 2026-11-19 | Recebido nesta sessão; sem nova leitura do teste, log ou SHA independente fornecido |
| EV-023 | Claude Code realizou revisão adversarial F0-005, recomendando contenção e classificação conservadora | REVISÃO ANTERIOR DECLARADA | Mesma solicitação, §3 | 2026-11-19 | Revisão já concluída; não repetida; não equivale a aprovação humana de PR; artefato bruto/hash não fornecido |
| EV-024 | Carlos adjudicou linhas 14, 17, 21 e 88 como valores fictícios; duas ocorrências da linha 181 como NOT_EVIDENCED | DECLARAÇÃO HUMANA | Mesma solicitação, §3 — adjudicação de Carlos | 2026-11-19 | Duas ocorrências da linha 181 continuam SEGREDO_POTENCIAL; declaração não prova ausência de vazamento, credencial ativa ou comprometimento |
| EV-025 | Contenção Codex declarada e reconfirmada apenas por metadados: regra específica em info/exclude:65; check-ignore positivo; teste presente e ausente do índice | CONTENÇÃO LOCAL / LEITURA DE METADADOS | Mesma solicitação, §3; comandos nesta sessão: `git -C .worktrees/m175-sr2-a4-voyage-20261113 check-ignore -v -- apps/dashboard/tests/voyage-embedding-provider.test.ts`, `git ls-files --error-unmatch` no mesmo worktree e `Test-Path` | 2026-11-19 | Arquivo preservado, untracked e ignorado; conteúdo não acessado. Proteção local, ausente em clones novos; add -f pode forçar inclusão |
| EV-026 | Carlos autorizou fechamento documental condicionado e branch/commit/PR/merge exclusivos do master, aceitando risco residual somente sob quarentena | DECISÃO DO RESPONSÁVEL | Solicitação de Carlos nesta sessão, §§1, 3, 4 e 6; DEC-F0-005-DOC-QUARANTINE | 2026-11-19 | Gates GitHub e HEAD validado obrigatórios; nenhum uso Voyage ou início de F0-006/GOV-002/M18 autorizado |
| EV-027 | Baseline F0-005 remota confirmada e PR #90 integrado em 826159b18766f8b032c3e2b09727945039d09bdd; preflight limpo na nova branch documental, 134 migrações preservadas | GIT / API / PREFLIGHT LOCAL | `git ls-remote origin refs/heads/main`; API `branches/main`; [baseline](https://github.com/cnegrao/code-guard-governance/commit/826159b18766f8b032c3e2b09727945039d09bdd); `.worktrees/f0-005-documental-quarantine-20261119/.artifacts/agent/session.json` e checkpoint preflight | 2026-11-19 | main protected=false; regras efetivas e rulesets vazios na consulta. Preflight PASS após liberação de subprocesso Git bloqueado por EPERM no sandbox; 37 worktrees anteriores preservados; nenhum PASS funcional implícito |
| EV-028 | Preflight F0-006: main remota na baseline exata; PR #91 merged em `3bb46f3060d918c3ce316b075d6588fef5bb6864`; #84–87 merged; novo worktree documental limpo, index vazio e origin canônico | GIT / API / PREFLIGHT DOCUMENTAL | `git ls-remote origin refs/heads/main`; API `branches/main`, `pulls/84`–`87`, `pulls/91`, `rules/branches/main`, `rulesets`; `.worktrees/f0-006-documental-close-20261123` | 2026-11-23 | CONFIRMADA nesta publicação; protected=false, regras/rulesets vazios; 39 worktrees preexistentes preservados; inventário histórico 37/18 não reescrito; scripts geradores de artefatos não executados |
| EV-029 | Reconciliação SEC-01, recibo histórico TEST, matriz S1–S8 e bloqueios M17.5 | HANDOFF READ-ONLY RECEBIDO | `C:/Users/cnegr/Downloads/F0_006_CODEX_READONLY_HANDOFF.md`; SHA256 `220fee585893d8c59b60125790f8d070555a135d8243e9fc57a9a2a184c34ae7` | Recebido 2026-11-23; coleta relatada 2026-11-20 | Integridade do anexo calculada nesta publicação; verificações técnicas atribuídas ao relatório, sem reexecução. Rótulos TA-001/rota/severidade corrigidos por C1–C4; não é aceite funcional |
| EV-030 | Revisão adversarial já concluída: READY_FOR_DOCUMENTAL_CLOSE condicionado a C1–C6 e interpretação humana de F0(c) | HANDOFF ADVERSARIAL RECEBIDO | `C:/Users/cnegr/Downloads/F0_006_CLAUDE_ADVERSARIAL_HANDOFF.md`; SHA256 `71df3e694311ce3bfd90152cfd15b53f862f8eb442eb019999b584cd9dfee8d8` | Recebido 2026-11-23 | Integridade do anexo calculada nesta publicação; verificações independentes relatadas por Claude, não repetidas; não é revisão humana do PR |
| EV-031 | Decisão expressa de Carlos sobre F0(c), C1–C6 e publicação/merge exclusivo do master | DECISÃO DO RESPONSÁVEL | Solicitação “F0-006 — Fechamento documental condicionado”, §§1–10, retomada “SESSÃO: ATUAL / RETOMADA DE EXECUÇÃO AUTORIZADA”; DEC-F0-006-DOC-CLOSE | 2026-11-23 | CONFIRMADA nesta sessão; não autoriza hosted, SQL, testes locais, código, deploy, TA-001 ou F0-007 |
| EV-032 | Localização/proveniência histórica e riscos dos recibos SEC-01 e colisões de variantes locais | EVIDÊNCIA HISTÓRICA RELATADA / PRESERVAÇÃO | EV-029 §3 e EV-030 C6; recibo Markdown no §13, linha 11; localização lógica e limites em §6 | Recebido 2026-11-23 | Recibos reportados untracked/não ignorados; sem nova leitura, staging ou publicação. JSON sem hash integral disponível nos anexos, não usado como prova independente; contenção futura apenas proposta |
| EV-033 | Verificação exclusiva do delta documental: GOVIA_MASTER.md; WBS de 33 tarefas e registros anteriores preservados; C1–C6, gate original, estados e referências consistentes | VALIDAÇÃO DOCUMENTAL | `git diff --check` e comparação em memória com a baseline, na branch `docs/f0-006-documental-close-20261123` | 2026-11-23 | Verificação documental antes do PR; testes funcionais locais NOT_RUN, não aplicáveis. Publicação/merge dependem de HEAD publicado e gates GitHub, sem sucesso presumido |
| EV-034 | PR documental F0-006 aberto para main, baseline exata e único arquivo GOVIA_MASTER.md; HEAD inicial `618cab49e05b5c17b50b6b31e27dafab2e894bb3` e blob `d7af85a48907e1f212418ffa17a3d0f94adf5138` publicados iguais aos locais | PUBLICAÇÃO / LEITURA GIT E API | [PR #92](https://github.com/cnegrao/code-guard-governance/pull/92); API `pulls/92`, `pulls/92/files`, `pulls/92/reviews`; Git HEAD e blob | 2026-11-23 | CONFIRMADA publicação daquele HEAD antes deste registro aditivo; M15/M16 iniciados automaticamente, sem resultado presumido. Publicação válida condicionada aos gates e HEAD finais, sem bypass; merge/SHA final não presumidos |
| EV-035 | Aceite escrito de Carlos da Fase 0/F0-007 e autorização de registro/publicação documental por PR/merge controlados | DECISÃO DO RESPONSÁVEL / PACOTE RECEBIDO | Solicitação atual “SESSÃO: NOVA / TASK_ID: F0-007”, com a declaração transcrita em §6; `DEC-F0-007-DOC-ACCEPT`; pacote `C:/Users/cnegr/Downloads/F0_007_CODEX_PUBLICATION_PACKAGE.md`, 17678 bytes, SHA256 `656a5c8d7b1069804a55aad1ee69a8fd10b201af203c6a85ad124c0da58af387` | 2026-11-23 | Autorização atual expressa; “confirmo” anterior conforme declarado no pacote. Hash pertence ao arquivo efetivamente recebido, não ao texto original da conversa. Escopo exclusivo do master; TA-001 não autorizada |
| EV-036 | Handoff Codex final recebido: READY_FOR_F0_FORMAL_ACCEPTANCE, checklist e limites | CÓPIA TEXTUAL RECEBIDA / ANEXO A | `F0_007_CODEX_FINAL_GATE_HANDOFF`, anexo A do pacote EV-035; 5791 bytes, SHA256 `f015c9aa764a1ea3e8d7adcb9f58743cc722967ad626732a9178f875a8b87b93` | Recebido 2026-11-23 | Hash dos bytes [4649,10440) do arquivo recebido, do título do handoff até o marcador final e sua quebra de linha, sem normalização. Não é hash do texto original da conversa; relatório reutilizado, sem reexecução; D/E pendentes naquele checkpoint agora tratados por EV-037/035 |
| EV-037 | Revisão Claude final já concluída: critério D atendido documentalmente, A–C confirmados e correção editorial E1 | CÓPIA TEXTUAL RECEBIDA / ANEXO B | `F0_007_CLAUDE_FINAL_ADVERSARIAL_HANDOFF`, anexo B do pacote EV-035; 7176 bytes, SHA256 `ad241c44d618f9d12140edd0cf1fbe211fec4f11f731dea700a4fdc16d6b2255` | Recebido 2026-11-23 | Hash dos bytes [10502,17678) do arquivo recebido, do título ao marcador final e sua quebra de linha, sem normalização. Não é hash do texto original da conversa nem revisão humana de PR; nenhuma nova revisão; E pendente naquele parecer satisfeito pelo aceite atual EV-035 |
| EV-038 | Publicação efetiva de F0-006: PR #92 MERGED, HEAD `912cd6a4d57156475caf48049ad433e7aa939e6f`, merge/main `cccaf8812060ba2812e35dbcc6ae02715e0ba352`; somente master; M15/M16 pós-merge success | GIT / API / CI EXISTENTE | [PR #92](https://github.com/cnegrao/code-guard-governance/pull/92); [M15 45179524635](https://github.com/cnegrao/code-guard-governance/actions/runs/45179524635); [M16 45179524777](https://github.com/cnegrao/code-guard-governance/actions/runs/45179524777); APIs `pulls/92`, `pulls/92/files`, `commits/cccaf8812060ba2812e35dbcc6ae02715e0ba352/check-runs` | Confirmado 2026-11-23 | Checks `postgres-regression` e `postgres17-security` completed/success no SHA de merge, evento push; não reexecutados. Sucede o checkpoint EV-034 sem reescrevê-lo; CI não é aceite funcional |
| EV-039 | Preflight F0-007: main exata, master 1.0.3 e instruções lidos na baseline; worktree isolado limpo; 134 migrações preservadas; gates GitHub consultados | PREFLIGHT / GIT / API | `git ls-remote origin refs/heads/main`; `node scripts/agent/preflight.mjs --expected-base cccaf8812060ba2812e35dbcc6ae02715e0ba352 --base cccaf8812060ba2812e35dbcc6ae02715e0ba352 --branch docs/f0-007-documental-publication-20261123 --budget-minutes 30`; APIs `branches/main`, `branches/main/protection`, `rules/branches/main`, `rulesets` | 2026-11-23 | PASS local; protected=false, regras/rulesets []; protection retorna 404 Branch not protected. Nenhuma revisão humana exigida pelas regras consultadas; CI M15/M16 aguardado antes de merge. 40 worktrees preexistentes preservados; sem settings/bypass |
| EV-040 | Validação documental 1.0.4: somente master, WBS 33, registros DEC/EV anteriores, riscos e históricos preservados, gates A–E e E1 consistentes | VALIDAÇÃO DOCUMENTAL | Diff contra `cccaf8812060ba2812e35dbcc6ae02715e0ba352`, `git diff --check`, comparação estrutural e hashes das cópias recebidas na branch F0-007 | 2026-11-23 | Verificação documental local; NOT_RUN funcional/SQL/hosted/Docker/WSL, sem nova revisão. Publicação condicionada a HEAD, checks, requisitos efetivos e merge comprovados; nenhum SHA final presumido |
| EV-041 | PR F0-007 aberto para main; baseline exata; somente GOVIA_MASTER.md; HEAD inicial publicado `4b9af55b7dcd670831cd3c64594b78c15e821f8d` e blob `17c07ac6534807b18fc68b312ac185bfd6482ff9` iguais aos locais | PUBLICAÇÃO / GIT / API | [PR #93](https://github.com/cnegrao/code-guard-governance/pull/93); APIs `pulls/93/files`, `contents/GOVIA_MASTER.md?ref=4b9af55b7dcd670831cd3c64594b78c15e821f8d`; `gh pr view 93` | 2026-11-23 | HEAD inicial confirmado antes deste registro aditivo; M15/M16 iniciados automaticamente, resultados finais/merge ainda não comprovados neste checkpoint. Reviews observadas []; sem revisão humana exigida pelas regras consultadas. Conector indisponível na inicialização, publicação recuperada via gh autenticado. Sem bypass; eficácia dos estados condicionada ao HEAD final/checks/merge, confirmados no handoff final |
| EV-042 | Main remota exata; master 1.0.4 e cinco arquivos canônicos confirmados; PR #93 MERGED no SHA `8ba80abb1cc9aa2e8a6ed01aff6ca8e428b92bb4`, HEAD final `32679f5718753b553400ce9b6fdfd03c7432dc79`; M15/M16 pós-merge success | LEITURA GIT / API; CONFIRMAÇÃO DE PUBLICAÇÃO ANTERIOR | `git ls-remote origin refs/heads/main`; API `git/trees/main?recursive=1` comparada a `git ls-tree`; master blob `50cdf0410cfcfc06a6f6603cd09ecb02e5eac1e5`; [PR #93](https://github.com/cnegrao/code-guard-governance/pull/93), merge 23/11/2026 15h05min46s Brasília; [M15](https://github.com/cnegrao/code-guard-governance/actions/runs/45234687377), [M16](https://github.com/cnegrao/code-guard-governance/actions/runs/45234687319) | 2026-11-23 | Confirma eficácia documental 1.0.4 sem reabrir F0, reexecutar CI ou conceder aceite operacional. AGENTS.md/CLAUDE.md/OPERATING_MODEL.md/ARCHITECTURE_INDEX.md lidos na baseline; blobs iguais aos remotos. PRs #84–87 e #90–93 constam da ancestralidade first-parent da baseline |
| EV-043 | Autorização de Carlos para TA-001 documental local mínimo e restrições | DECISÃO DO RESPONSÁVEL | Solicitação “GOV IA — TA-001: Consolidação final dos deltas M17.5 V1”, §§1–7, nesta sessão; DEC-TA-001-LOCAL | 2026-11-23 | Não autoriza aceite/publicação/PR/merge nem execução de TA-002; decisões históricas que ainda descrevem TA-001 pendente permanecem como checkpoints |
| EV-044 | Preflight limpo, baseline/HEAD exatos, origem canônica, branch/worktree isolado e 134 migrações históricas preservadas | PREFLIGHT LOCAL | `.worktrees/ta-001-documental-deltas-20261123/.artifacts/agent/preflight.json` e `session.json`; comando `node scripts/agent/preflight.mjs --expected-base 8ba80abb1cc9aa2e8a6ed01aff6ca8e428b92bb4 --base 8ba80abb1cc9aa2e8a6ed01aff6ca8e428b92bb4 --branch docs/ta-001-documental-deltas-20261123 --budget-minutes 30` (com objetivo TA-001) | 2026-11-23, 15h22min17s Brasília | PASS após liberação dos metadados Git/subprocesso bloqueados pelo sandbox; 41 worktrees preexistentes preservados, criado somente este adicional. Worktree original em `feat/m17.5-c3-sr2-semantic-replacement@96f30b0e02d71189083ed1cd6478a12fd011dd09`, com alterações/untracked M18 preservados. Orçamento informativo, esforço ativo DESCONHECIDO |
| EV-045 | Validação do candidato TA-001: uma matriz, 10 linhas S1A–S8 com seis campos, dependências/rastreabilidade, 33 tarefas WBS, registros e estados/riscos preservados, somente master alterado e diff sem erros | VERIFICAÇÃO DOCUMENTAL LOCAL | `git diff --check`; comparação com baseline e resolução de referências locais: `.worktrees/ta-001-documental-deltas-20261123/.artifacts/agent/ta-001-validation.json`; checkpoint final `handoff.json`/`handoff.md` no mesmo diretório ignorado | 2026-11-23 | PASS documental do candidato; focused = integridade da matriz/WBS; integração = referências/dependências; final = diff/escopo/estados. Testes funcionais, SQL/hosted/Docker/WSL NOT_RUN, não aplicáveis. Nenhum novo CI ou aceite presumido; checkpoint local não é fonte concorrente ao master |
| EV-046 | Publicação do candidato rc1 no único PR #94, branch `docs/ta-001-documental-deltas-20261123`, HEAD `4c4547634af4a5a1f13ae3b6d4a177ec5e32f7bd`; somente master, blob `61e4da4269b6d1ed88e5b62662a70e1e36acfe41` | PUBLICAÇÃO / GIT / API | [PR #94](https://github.com/cnegrao/code-guard-governance/pull/94); APIs `pulls/94` e `pulls/94/files`; recibo `.worktrees/ta-001-documental-deltas-20261123/.artifacts/agent/ta-001-pr-api-evidence.json` | 2026-11-23 | Confirmado na retomada, PR OPEN e sem merge; candidato SHA256 `80f6339b90b107e4cbe3c843f373a0ae634fc1d3461b5e8fb4465af1dc216c2a` preservado na publicação anterior. Não comprova CI ou merge do novo ajuste 1.0.5 |
| EV-047 | Aceite documental de Carlos e autorização de ajuste mínimo, commit/push e merge condicionado do PR #94 | DECISÃO DO RESPONSÁVEL | Solicitação atual “GOV IA — TA-001: Aceite e integração final”, autorização e execução §§1–8; DEC-TA-001-DOC-ACCEPT | 2026-11-23 | Não é aceite funcional/operacional. Conclusão TA-001 e mudança do predecessor TA-002 somente após publicação válida; nenhuma execução TA-002 autorizada |
| EV-048 | Preflight de integração: main `8ba80abb1cc9aa2e8a6ed01aff6ca8e428b92bb4`, branch/HEAD rc1 exatos, worktree limpa, PR #94 e arquivo único confirmados; mergeable=true/clean no HEAD anterior | LEITURA GIT / API / GATES | `git status`, `git rev-parse`, diff da baseline; APIs `branches/main`, `pulls/94`, `pulls/94/files`, `rules/branches/main`, `rulesets` | 2026-11-23 | main protected=false, regras efetivas e rulesets vazios na consulta; nenhuma revisão humana exigida por essas regras. M15/M16 SUCCESS continuam obrigatórios por autorização de Carlos; gates e HEAD serão revalidados antes de merge, sem alterar regras ou bypass |
| EV-049 | Verificação do ajuste 1.0.5: master exclusivo, matriz S1–S8 e recorte técnico intactos, 33 tarefas/dependências preservadas, somente status TA-001/002 ajustados, histórico DEC/EV/rc1, riscos e estados preservados | VALIDAÇÃO DOCUMENTAL LOCAL | `git diff --check`; comparação em memória com `4c4547634af4a5a1f13ae3b6d4a177ec5e32f7bd`; recibo `.worktrees/ta-001-documental-deltas-20261123/.artifacts/agent/ta-001-accept-validation.json` | 2026-11-23 | PASS documental; nenhum teste funcional local, SQL, hosted, Docker/WSL ou deploy. CI do novo HEAD, publicação e merge ainda não comprovados neste checkpoint: confirmar no handoff final com SHA, blob e URLs reais, sem antecipar resultados |

### 10.5 Integridade das provas locais de recuperação

- Inventário local `GOVIA_LOCAL_AUDIT_20261118_225130.zip`: 37 worktrees, 18 dirty; SHA256 conforme relatório `8ad1239ad56207b56b31c8bbafeeadd65d66f686190ad1f5604624df5588a1cd`.
- Fingerprint `GOVIA_FINGERPRINT_20261119_062746.zip`: 326 registros; SHA256 `4db7e6f1af22d7d5977af55d49a2a400a9e8d72227cc5c666fd05f08a00e53b7`.
- Exportação dirigida `GOVIA_FOCUSED_SOURCES_20261119_091126.zip`: 77 arquivos/13 branches; SHA256 **`6389f3c99e5dbdf41a52dcbcc058faba8db897af401730fbcd36c5478f7f077b`**; 1 excluído. É uma amostra, não revisão exaustiva dos 134 caminhos ausentes.
- GOV-001/GOV-002 pacote de proposta: relato de 15 testes unitários e teste com Git temporário positivo; **não é CI em PR nem ruleset ativo**.
- Evidências históricas D01–D06 provam contextos anteriores, não estado atual de ambiente/tenant/browser.

**Regra para marcar ACEITO:** preencher no registro da tarefa `task_id`, versão do master, `baseline_sha`, commit/PR se houver, ambiente, EV-ID e timestamp, testes aplicáveis, segurança/tenant quando exigidos, browser quando UI, revisor e aprovação de Carlos. Sem isso, status `NOT_EVIDENCED` ou `INTEGRADO_NAO_ACEITO`.

## 11. Riscos e responsabilidades

### 11.1 Registro de riscos (herdado do Plano Mestre)

| ID | Severidade | Risco | Gatilho | Mitigação obrigatória | Dono |
| --- | --- | --- | --- | --- | --- |
| RISK-001 | P0 | Mudança de objetivo entre chats | Plano não é carregado/consultado | Bloquear arranque sem baseline e TASK_ID; prompt rígido e controle Git | Carlos |
| RISK-002 | P0 | main sem proteção contra push | GitHub reports protected=false | Aplicar ruleset e check obrigatório; negar bypass | Carlos |
| RISK-003 | P0 | Retrabalho M17.5/SEC01/LX07 | Nova sessão não reconhece integração | Registrar receipts imutáveis e só reabrir com novo defeito reproduzido | ACP |
| RISK-004 | P0 | Demo prometida sem acesso seguro | Hosted histórico sem autorização atual de exposição | Ambiente/audiência GO e fallback com registro real sanitizado | Carlos |
| RISK-005 | P1 | Produto visual sem qualidade enterprise | Mobile shell w-64 e visual legado | UX-0 e transformação progressiva com captura antes/depois; UX v1.1 | Codex UX |
| RISK-006 | P0 | Estouro de horas e tokens sem entrega | 3+ prompts no mesmo tema; testes duplicados | Budget por task, no 2º erro igual sem hipótese nova STOP | Carlos |
| RISK-007 | P1 | Escopo M18 e M19.5 misturado | Disputa de specs e personas | DEC-003 explícita no M18-S0; roadmap prevalece | Carlos |
| RISK-008 | P0 | M17.5 não encerra por dependências | V1 Hub sem aceite, LX03/C3 pendentes | TA-001 delta e fechar blockers por prova; limites de esforço | Codex/ACP |
| RISK-009 | P1 | Evidência hospedada vs local confundida | D06 browser localhost com backend hosted | Identificar ambiente/commit/time e não alegar novo E2E local | ACP |
| RISK-014 | P1 | Teste Voyage em quarentena contém duas ocorrências da linha 181 ainda SEGREDO_POTENCIAL; segurança e ausência de vazamento/credencial ativa/comprometimento não comprovadas | Uso/exposição, inclusão forçada com git add -f ou clone novo sem info/exclude | OPEN: manter quarentena local; não usar, integrar, executar, distribuir ou expor. Desbloqueio somente após triagem específica, evidência suficiente para adjudicar as duas ocorrências e riscos, contenção adequada ao destino e autorização explícita de Carlos | Carlos |
| RISK-015 | P1 | Recibos SEC-01 locais untracked/não ignorados; risco de staging ou perda e lacuna de proveniência integral do JSON | Inclusão acidental, limpeza ou perda do worktree histórico; uso de hash abreviado como prova | OPEN: preservar sem operar sobre recibos nesta tarefa; futura contenção específica autorizada com destino controlado, hashes integrais e proteção contra staging; colisões untracked/tracked exigem escopo próprio | Carlos |
| RISK-016 | P0 | TEST hospedado com estado atual NOT_EVIDENCED apesar de implantação histórica SEC-01 reconciliada | Migração, D06/SHOW-003 ou aceite dependente do estado atual | OPEN: REC-05 VERIFICAR ESTADO; coletar catálogo/ACL/dependências somente após nova autorização hosted específica; fechamento F0-006 não substitui a coleta | Carlos |


**Riscos adicionais da consolidação:** (RISK-010) este master não ser efetivamente lido por agentes em outro chat; (RISK-011) workflow/CI poder ser editado no mesmo PR que deveria fiscalizar; (RISK-012) deadlock de aprovação quando não há revisor humano elegível; (RISK-013) este próprio master ficar desatualizado em relação ao Git. Mitigação: gate de preflight lendo o arquivo real, review humana, bootstrap antes de required-check, reconciliação por SHA e registro de conflitos. Cada um permanece `OPEN` até prova de mitigação.

### 11.2 Responsabilidades RACI

| Atividade | Carlos | Assistente/PMO | Codex | Claude | GitHub CI |
| --- | --- | --- | --- | --- | --- |
| Direção do produto, prioridade e orçamento | A/R | C | I | I | C |
| Plano de execução, reconciliação e controle de status | A | R | C | C | I |
| Código, testes e PR por tarefa autorizada | A | C | R | C | I |
| Revisão independente técnica por lote | A | C | C | R | I |
| Segurança e GO/NO-GO de exposição | A | R | C | C | I |
| GitHub ruleset/branch protection | A/R | C | C | I | I |
| Atualização do status com evidência | A | R | R | C | I |
| Demonstração produto/aceite visual | A/R | C | C | I | I |


**Responsável único pelo aceite e autorização:** Carlos. ChatGPT atua como PMO/analista e deve explicitar limites da própria visibilidade; Codex implementa somente escopo autorizado; Claude Code pode revisar tecnicamente de forma independente, mas **não é** revisor humano do GitHub por definição. Responsável operacional por cada slice deve ser designado na ativação.

## 12. Prazos, esforço, controle de progresso e handoff

### 12.1 Gestão sem planilha paralela

Para cada tarefa da WBS, registrar diretamente neste documento (seção 7.2 ou um registro aditivo no fim): prioridade, dono, estimativa em horas, horas ativas medidas (sem somar espera de aprovação), data planejada **somente depois de estimar dependências e capacidade**, evidências e status. **Sem taxa/hora informada, custo `NÃO INFORMADO`; sem tempo medido, gasto `DESCONHECIDO`, jamais zero.** Não gerar outro XLSX/Gantt de controle como fonte operativa.

Indicadores reais: entregas `ACEITAS`, fluxos demonstrados em navegador, bloqueios com dono, evidências faltantes, esforço por tarefa, desvios de escopo e tempo de ciclo. Contagem de commits, prompts ou testes não equivale a progresso de negócio.

### 12.2 Handoff resumido — atualizar neste master

```text
HANDOFF [data/hora] — TASK_ID:
MASTER_VERSION: … | GIT_MAIN_SHA: … | BRANCH/HEAD: …
AUTORIZAÇÃO EFETIVA: … | OBJETIVO: …
ANTES → DEPOIS: … | DIFF / PR / ARQUIVOS: …
TESTES: [comando, candidato, ambiente, resultado] ou NOT_RUN
EVIDÊNCIAS: [EV-ID, link, hash, timestamp] | REVISÃO: …
ESFORÇO REAL: … / DESCONHECIDO | TENTATIVAS: …
BLOQUEIOS + DONO: … | DEC-ID NOVA: … / N/A
ÚNICA PRÓXIMA AÇÃO: … | DEPENDE DE AUTORIZAÇÃO? SIM/NÃO
```

**Protocolo de nova conversa:** fornecer **somente `GOVIA_MASTER.md`** ou seu link Git canônico; o agente lê a versão real, verifica SHA/Git e retorna ao usuário status, conflito, última tarefa aceita, tarefa ativa, bloqueios e próxima ação. Não é necessário anexar Excel, plano PDF, checkpoints antigos e ZIPs para **gestão**. Evidências/código brutos só quando uma tarefa técnica específica exigir acesso a eles.

**Checkpoints históricos do candidato rc1:** os quatro registros e a tentativa de validação abaixo descrevem o preparo anterior ao aceite; o registro de integração 1.0.5 adiante governa o estado corrente.

**TA_001_DOCUMENTAL_DELTA_HANDOFF — 23/11/2026 (Brasília):** baseline/main remota e HEAD local `8ba80abb1cc9aa2e8a6ed01aff6ca8e428b92bb4`; master de origem 1.0.4 → candidato **1.0.5-rc1**; branch `docs/ta-001-documental-deltas-20261123`, worktree `.worktrees/ta-001-documental-deltas-20261123`, limpa no preflight e agora com apenas `GOVIA_MASTER.md` modificado, sem commit. Origem canônica, 41 worktrees anteriores e alterações/untracked originais preservados (EV-044). Último aceite: Fase 0/F0-007 exclusivamente documental, DEC-F0-007-DOC-ACCEPT, EV-035–EV-042; F0 não reaberta. TA-001 PENDENTE → CANDIDATO DOCUMENTAL LOCAL; formalmente pendente na main, sem PR/merge/publicação/aceite desta entrega.

**Delta/provas:** matriz única §7.2 expandida, sem duplicação, com capacidade/estado/referência/lacuna/dependência/critério de fechamento; decisões e evidências aditivas EV-042–EV-045. S1A/LX08 local preservado; S1B mantém L01/L02/L03/LX02, SR2 A1–A3, pre-A4 M1/M2/M3 e LX07 #84–87; LX03, LX07 global e residuais continuam abertos. S1C → S2; S3 e S4 após S2 (S4 independente de S3); S5 após S3+S4; S6 após S4+S5; S7 após S1C+S4+S5+S6; S8 após S7. Primeiro predecessor de gestão TA-001; primeira frente técnica bloqueante S1B/LX03; A4 BLOCKED na rota SR2, sem qualidade aceita V3/MPNet, sem exclusividade arquitetural inferida. Recorte mínimo sugerido TA-002 e aceite testável constam de §7.2; execução NÃO INICIADA.

**Validações e limites:** EV-045 registra `git diff --check` PASS, escopo exclusivo, WBS 33, referências/dependências, preservação de históricos/riscos/estados e ausência de delta funcional. Testes de produto, SQL, hosted, Docker/WSL e deploy NOT_RUN; não aplicáveis à edição documental. Sem nova revisão Codex × Claude; evidências EV-029/030 reutilizadas integralmente nos limites registrados. Tentativas de acesso remoto, criação de worktree e subprocesso Git bloqueadas pelo sandbox foram recuperadas por execução autorizada; a primeira consulta `gh --jq` teve erro de quoting, corrigido lendo o JSON do tree, sem repetir auditoria ou alterar escopo. Alvo ativo informativo 30 minutos; esforço ativo medido DESCONHECIDO. M17.5 OPEN, M18 HOLD, quatro readiness HOLD, TEST atual NOT_EVIDENCED, GOV-002 NÃO IMPLANTADO, REC-09 bloqueado/quarentena, severidades e exposição NO-GO preservados.

**Pendências de decisão / próxima ação única:** Carlos revisar este candidato e decidir seu aceite documental e autorização específica de publicação de TA-001. Sem isso, TA-001 não é declarado formalmente concluído na main. Depois, eventual contrato técnico TA-002 exigirá autorização própria, hipótese material nova para o bloqueio atacado e rota/critério/corpus explícitos; nenhuma alternativa arquitetural, nova revisão ou execução é autorizada por este handoff.

**Tentativa de validação documental:** o primeiro verificador local contou genericamente os dois cabeçalhos `Slice` já presentes na baseline e interrompeu antes das checagens finais. A checagem foi corrigida para identificar a matriz S1–S8 por seu cabeçalho e comparar a quantidade total de tabelas com a baseline; não houve duplicação da matriz nem mudança funcional. Resultado da execução corrigida em EV-045; não foi repetida regressão de produto.

**TA_001_FINAL_INTEGRATION_HANDOFF — checkpoint documental 23/11/2026 (Brasília):** Carlos aceitou rc1 e autorizou ajuste/integração condicionados (DEC-TA-001-DOC-ACCEPT, EV-047). Baseline main `8ba80abb1cc9aa2e8a6ed01aff6ca8e428b92bb4`; PR #94 existente; branch/worktree preservados; HEAD anterior `4c4547634af4a5a1f13ae3b6d4a177ec5e32f7bd`. Único delta autorizado `GOVIA_MASTER.md`: versão 1.0.5, decisão/EV aditivos e estados correntes; matriz S1–S8, recorte TA-002, histórico rc1, 33 tarefas e demais estados/riscos preservados (EV-049). Preflight de retomada EV-048 reutiliza a identidade de sessão anterior sem reiniciar orçamento/tentativas; alvo ativo informativo 30 minutos, esforço ativo DESCONHECIDO. Testes funcionais locais/SQL/hosted/Docker/WSL/deploy NOT_RUN. Nenhuma nova consolidação ou revisão independente.

**Gate e efeito deste checkpoint:** novo HEAD, blob, CI M15/M16 SUCCESS, requisitos GitHub efetivos e merge normal devem ser comprovados antes de declarar integração válida. Resultados futuros e SHA de merge não são presumidos no conteúdo que será integrado; o handoff final deve informá-los com provas reais. Após publicação válida de 1.0.5: **TA-001 CONCLUÍDO DOCUMENTALMENTE; TA-002 PENDENTE DE AUTORIZAÇÃO**, sem início; TA-003/004 permanecem bloqueados. Fase 0 encerrada documentalmente, M17.5 OPEN, M18 HOLD, quatro readiness HOLD, S1B/LX03 NEEDS_CONTAINMENT, A4 BLOCKED na rota SR2, REC-05 VERIFICAR ESTADO/TEST atual NOT_EVIDENCED, REC-09 QUARENTENA, GOV-002 NÃO IMPLANTADO e exposição externa NO-GO preservados. STOP diante de baseline/HEAD/diff divergente, conflito material, gate ausente ou CI falho, sem repetição automática ou bypass. **Próxima ação única após integração válida:** preparação de TA-002 sobre S1B/LX03, mediante autorização separada.

### 12.3 Revisão/STOP

- Uma tarefa por sessão técnica; orçamento ativo explícito no preflight (trabalho pequeno normalmente 30 min, slice normal 90 min como **alvos informativos**, não relógios de encerramento).
- Mesmo comando/falha duas vezes sem hipótese material nova: STOP. Execução final pesada normalmente uma vez por candidato; logs e verificações anteriores mantêm sua validade no mesmo candidato/inputs.
- Não iniciar trabalho por data vencida ou por recomendação não autorizada.
- Cada sessão deve terminar com **uma** próxima ação e um registro curto; não produzir pacote novo de planos ao encerrar.

## 13. Inventário de fontes F0 — 77 arquivos e 1 exclusão

**Uso:** índice técnico de rastreabilidade consolidado aqui para descontinuar a aba `12_Fontes_F0` da planilha. `Git OID` refere-se ao conteúdo calculado pelo Git local; SHA256 é dos bytes exportados. Os arquivos reais continuam em seus caminhos de origem/worktrees e no ZIP de evidência; **não** foram movidos, fundidos ou executados.

| # | Branch local | Caminho relativo | Comparação com `main` | Git OID local | SHA256 exportado |
|---:|---|---|---|---|---|
| 1 | `feat/m17.5-c3-sr2-semantic-replacement` | `apps/dashboard/app/(dashboard)/workspace/page.tsx` | `DIFFERENT_OR_LINE_ENDINGS` | `e6d7f1b47aaa9a4a78a180a3786a3f53dd34a8ca` | `f21ae57248c849e4a11eb6683f7234a0450bb34278e74509c285097c30ab6305` |
| 2 | `feat/m17.5-c3-sr2-semantic-replacement` | `apps/dashboard/lib/workspace/executive-query.ts` | `DIFFERENT_OR_LINE_ENDINGS` | `cd8b432df855183e9e0ce6640c936e61c754fb60` | `16aa0aa36f6b0411e38779680558bb1ee9232fbe0ca168e6a13892999071452c` |
| 3 | `feat/m17.5-c3-sr2-semantic-replacement` | `apps/dashboard/tests/m18-executive-auth.test.ts` | `NOT_PRESENT_IN_MAIN` | `020730a57366bc7be9caf84001c9b13b55eb6a35` | `25704b2eaeaa6c3cdb4e55b953adb5739aad5befdaeb53f4d77e8c6c9293d82d` |
| 4 | `feat/m17.5-c3-sr2-semantic-replacement` | `apps/dashboard/tests/m18-executive-query.test.ts` | `NOT_PRESENT_IN_MAIN` | `ae91ff7c6c05af797d184b3e8268bb909f572438` | `38527082c40c3498f78924e62d1eb05d2b6f3705fe225086bd3e76b4eb5040e6` |
| 5 | `feat/m17.5-c3-sr2-semantic-replacement` | `apps/dashboard/tests/m18-executive-ui.test.ts` | `DIFFERENT_OR_LINE_ENDINGS` | `19ac7dff4545db5717eb0a34ee5991ac4d20e933` | `7cb0248c8b9c3e3ade8e469b4cec9769b1fd990d50bd1e95429d856598082ef3` |
| 6 | `feat/m17.5-c3-sr2-semantic-replacement` | `docs/codex/evidence/2026-11-03-m18-s1-corrective-slice.md` | `NOT_PRESENT_IN_MAIN` | `031e6c71789fbe55be2dfc95ff9cdeb654bc5381` | `6918041c68b510e858079f42ac57184992497a603d6716fb57fb674a8d9ca9cd` |
| 7 | `feat/m17.5-c3-sr2-semantic-replacement` | `docs/codex/evidence/2026-11-03-m18-s1-executive-workspace.md` | `NOT_PRESENT_IN_MAIN` | `26b708a3eef3a59ef91004a1324316817cc8ec7e` | `9d9d3d27cb3c1dd0e9ffce46d655c9700d4f382862890534eb6727e09092be9d` |
| 8 | `feat/m17.5-c3-sr2-semantic-replacement` | `docs/codex/evidence/2026-11-03-m18-s1-final-semantic-corrections.md` | `NOT_PRESENT_IN_MAIN` | `eaea4002ef5e46f5ba0f7e2072983f9c01402272` | `c78941e819c970db91a9e77042b9f40aa58880420065fa5af9e9cff58083b4df` |
| 9 | `fix/d06-functional-20261111` | `docs/codex/evidence/2026-11-11-sec01-lab-identity-blocker.md` | `NOT_PRESENT_IN_MAIN` | `1d9e84cc34afed698f306013331e0fd3a95424d0` | `040da0d99e2a8954e6b73faece3275f102741db53dd643806150b540d88e1092` |
| 10 | `fix/d06-functional-20261111` | `docs/codex/evidence/2026-11-11-sec01-postflight-local-stop.md` | `NOT_PRESENT_IN_MAIN` | `4c0968554413a93e7ff36c45ce532cbac8b88366` | `9d716ebc6a5acafbe25d0e7bb672449b4667cdfee73509f5dda3f8372d5d4d95` |
| 11 | `fix/d06-functional-20261111` | `docs/codex/evidence/2026-11-11-sec01-test-deployment-pass.md` | `NOT_PRESENT_IN_MAIN` | `2f7354ffc8724693b8c4fcbab11976e06a9da135` | `803d8354eb421888f150e93047cf659f1a860aea420408221913119adab99a11` |
| 12 | `fix/d06-functional-20261111` | `docs/codex/evidence/2026-11-11-sec01-test-deployment-stop.md` | `NOT_PRESENT_IN_MAIN` | `343885bd8bc31085149228cfe34c6216af4c2b6e` | `714a529b92a2f0b2af5d4eb6d35aacd134e89b6c3f33ab056641c1df40d2203a` |
| 13 | `fix/d06-functional-20261111` | `docs/codex/evidence/2026-11-11-sec01-test-resume-stop.md` | `NOT_PRESENT_IN_MAIN` | `f722dd3afaf2de6f9fcb431fac0a831119c2c3de` | `5074f0f28009519a05889d04bdad568d501cfca037bb72eb06a907e2b3ad9f58` |
| 14 | `fix/e0-worker-unblock` | `apps/discovery-worker/package.json` | `DIFFERENT_OR_LINE_ENDINGS` | `8caf1ff056c66f31575727b6532fb9d16314a311` | `4f1cfeea26d09468eb747604c0d7359d6b818c0d50a3911ebd9264b2113bf72a` |
| 15 | `fix/e0-worker-unblock` | `apps/discovery-worker/src/discovery-intake.ts` | `DIFFERENT_OR_LINE_ENDINGS` | `e169195b30e7433642ade5be9f8d494894f724ef` | `2f3c6007127f0fbe5b85202dbb0d00e6e15b1252defc6f70f5f1fd30d6e16c70` |
| 16 | `fix/e0-worker-unblock` | `apps/discovery-worker/test/startup.test.mjs` | `NOT_PRESENT_IN_MAIN` | `96d8886be117daf71aae2ab5706257efa30524a5` | `4737234bbb4f99ac8651224b1d2895846b3cb7da8f80c7c206507966f8d0b724` |
| 17 | `feat/m175-byom-vertical-20261114` | `apps/dashboard/components/layout/Sidebar.tsx` | `DIFFERENT_OR_LINE_ENDINGS` | `ad09a9844a80fd817b2879bad995fca079a02d66` | `a23fb522f611925c6e4a1f632e579e28db3f30b24b7878c1ee72c246cbe82ed9` |
| 18 | `feat/m175-byom-vertical-20261114` | `apps/dashboard/lib/llm.ts` | `DIFFERENT_OR_LINE_ENDINGS` | `f237e977ceb023ad8003bcb893927e88b27d2c48` | `91d94da550b9b5e9c172178d6ebc8cf21cc1b2b446b60c3f6944b3abebbf6e0c` |
| 19 | `feat/m175-byom-vertical-20261114` | `apps/dashboard/package.json` | `DIFFERENT_OR_LINE_ENDINGS` | `d65f551e1993ff52cfdfb369fb39d0daf58262de` | `acafdde726f9486fb9a592fa661cbf044fb86289fe2c887e23af404a5102a850` |
| 20 | `feat/m175-byom-vertical-20261114` | `apps/dashboard/app/(dashboard)/settings/models/page.tsx` | `NOT_PRESENT_IN_MAIN` | `d81f5468482665d064e69ab2ad795bee5c846bc3` | `9fdbd82899b10e33fcc17799de7243cdb920ee79c774284d40450a4c95d98c98` |
| 21 | `feat/m175-byom-vertical-20261114` | `apps/dashboard/app/api/settings/models/probe/route.ts` | `NOT_PRESENT_IN_MAIN` | `fee6d6cbef45a3ec2ea7cffca8a69c72be6e436a` | `84c04ab5f3e768012c7869e3326c9060b2524d55290a0f65ab047522c04eff64` |
| 22 | `feat/m175-byom-vertical-20261114` | `apps/dashboard/app/api/settings/models/route.ts` | `NOT_PRESENT_IN_MAIN` | `5f556986b1f1e74ba70d837d999d34b3c07be768` | `7d4bd67766b05c7e86cb661d04e4543d452bd64be250e64068ac257391e98318` |
| 23 | `feat/m175-byom-vertical-20261114` | `apps/dashboard/components/settings/ModelsSettings.tsx` | `NOT_PRESENT_IN_MAIN` | `630b8abcd50d96eef96e656f9ac3a43325150fca` | `21a22244d8bfa85311a36b09ac013e74e3daccb8f0754c38ab4bd626c47f63e1` |
| 24 | `feat/m175-byom-vertical-20261114` | `apps/dashboard/lib/byom/contract.ts` | `NOT_PRESENT_IN_MAIN` | `8923f2c6ac73ebfd92cc621e6197fca9ab561f29` | `dbe821d3393ad332572f6ff12ab6326b2894bd7c348d338562a9d622c744bbf4` |
| 25 | `feat/m175-byom-vertical-20261114` | `apps/dashboard/lib/byom/local-store.ts` | `NOT_PRESENT_IN_MAIN` | `718edf5bab10ae48c66f7e688ee5b28fcb8010ae` | `265897a6b2aac3b18acfbb8484571af7ca799ae2da42f46f3c466f0da4664258` |
| 26 | `feat/m175-byom-vertical-20261114` | `apps/dashboard/lib/byom/runtime.ts` | `NOT_PRESENT_IN_MAIN` | `9977c2edfde9c67613051cada2b0aa584adfbabf` | `3132545c246e565c16ae64d8186719907e254f0c5f1b13d6601b2e568b6f8524` |
| 27 | `feat/m175-byom-vertical-20261114` | `apps/dashboard/lib/byom/service.ts` | `NOT_PRESENT_IN_MAIN` | `25dd87064f505efac0579a295d1d8ecba06796a9` | `59911f7006d101188dd9058f48871aebc0e91ceb241a5afe6bbaaa83ee2f3d0d` |
| 28 | `feat/m175-byom-vertical-20261114` | `apps/dashboard/tests/byom-routes.test.ts` | `NOT_PRESENT_IN_MAIN` | `d6f3167fd98d46e742c546bcc73750621fa4a1ba` | `61108e57bfef34d83ff00cf1f851fad84a12f8162cb4f50eaba59970a4602f18` |
| 29 | `feat/m175-byom-vertical-20261114` | `apps/dashboard/tests/byom-service.test.ts` | `NOT_PRESENT_IN_MAIN` | `598d7aa6c8c61866a41cd55722c737e0872f3edc` | `efb2c1ce2b41d2aa47d13cb7b9fb0faa87f25a03947a590e852a32cfe55a45f5` |
| 30 | `feat/m175-byom-vertical-20261114` | `apps/dashboard/tests/byom-ui.test.tsx` | `NOT_PRESENT_IN_MAIN` | `04e0b4b46de1dcce1369d209aa910e5627d5dee2` | `25fddb316e3414bded933b91feb29b0abedd89fb406266a00c879520f9562f86` |
| 31 | `feat/m175-byom-vertical-20261114` | `docs/codex/evidence/2026-11-14-m175-byom-first-local-flow.md` | `NOT_PRESENT_IN_MAIN` | `aa61591bfab4f81f84d1c55b7ea7a8c5210a9067` | `a25aa43d293301defcb0934052ae88a6d3be3f10a67f5445f615d6862181cb36` |
| 32 | `feat/m175-sr2-a4-local-20261112` | `services/semantic-gpu/README.md` | `DIFFERENT_OR_LINE_ENDINGS` | `ac7ef3064a0af49f72c9be00e113e6c9e329ba1e` | `c471cd4c91c3309077d002d97bd169bcc7d4282099a855179e245671d4aa51f2` |
| 33 | `feat/m175-sr2-a4-local-20261112` | `services/semantic-gpu/app.py` | `DIFFERENT_OR_LINE_ENDINGS` | `d302d03a7f9ee2c419c243f5b4a67b9bc07b7ae5` | `adc538a88c5670ef061c32b89df7904538abdf5302f36af121fb7832d872c7d6` |
| 34 | `feat/m175-sr2-a4-local-20261112` | `docs/codex/evidence/2026-11-13-m175-c3-sr2-a4-local128-provider.md` | `NOT_PRESENT_IN_MAIN` | `1cfab5adc7b50ac24e1204d30c508b5353b2604b` | `63df1a8e32f84237a9299bee3d76beecb0995edb93f209926a9de6f8bb089498` |
| 35 | `feat/m175-sr2-a4-local-20261112` | `services/semantic-gpu/a4_profile.py` | `NOT_PRESENT_IN_MAIN` | `f667ad576e191a376652da5d6125bc0c496e8e56` | `6ea188144706c51a23837a6e1a1c6f119092c6f3d76bd25814a38c443ef80e76` |
| 36 | `feat/m175-sr2-a4-local-20261112` | `services/semantic-gpu/qualify_a4.py` | `NOT_PRESENT_IN_MAIN` | `79b3e35aa9d840d496d4cd09825a702e1b5f455c` | `0b8fcbfbdfe19bc60eb7b1a74a9b9a2180989612be5650a899fea46d9afa14cd` |
| 37 | `feat/m175-sr2-a4-local-20261112` | `services/semantic-gpu/test_a4_profile.py` | `NOT_PRESENT_IN_MAIN` | `33eb9bde5c2a04ee48ff4247662f9913241f28c1` | `3fe1a36eb4115c9102553212211d96783a16e41c33f28955ab10c7a395eadd47` |
| 38 | `feat/m175-sr2-a4-mpnet-20261113` | `docs/codex/evidence/2026-11-13-m175-c3-sr2-a4-mpnet-comparison.md` | `NOT_PRESENT_IN_MAIN` | `445f10c4dbfbac6246d8d7ff5e05f0eee8ee8c5e` | `32d181f26d6abd873e1f5cec9082ba110e6697ec9b3e06b1f5891403c9475f1c` |
| 39 | `feat/m175-sr2-a4-mpnet-20261113` | `services/semantic-gpu/a4_independent_corpus_v1.json` | `NOT_PRESENT_IN_MAIN` | `c106ec2be13e212246332a2a4cfbffac29e85221` | `4188ead79f32e46c801a69d2869bfe8172816af0fbf33148b0baa234f7534c7d` |
| 40 | `feat/m175-sr2-a4-mpnet-20261113` | `services/semantic-gpu/a4_mpnet_local.py` | `NOT_PRESENT_IN_MAIN` | `f51885546ef04ddddfde71551908e8128a013846` | `c5cd4749a11a740631f0166e4fafac5b885da1578d2ffe7b2e02eaf87c65c296` |
| 41 | `feat/m175-sr2-a4-mpnet-20261113` | `services/semantic-gpu/a4_projection_v2.py` | `NOT_PRESENT_IN_MAIN` | `9382fd32a22376bac986e2a7050519bfb13e9cf4` | `0d26f3bc3090405adc76a4e20032fbe53f395a20b20232c1ed2f066ad7dee65d` |
| 42 | `feat/m175-sr2-a4-mpnet-20261113` | `services/semantic-gpu/qualify_a4_mpnet.py` | `NOT_PRESENT_IN_MAIN` | `1f789f0bbcb9cdc5b1237cb202ee784c2d2bd20f` | `f5cd096c2b1a44672bce4b5fe248072c83048083d7f8707efab1088bd6c52de9` |
| 43 | `feat/m175-sr2-a4-mpnet-20261113` | `services/semantic-gpu/test_a4_mpnet_local.py` | `NOT_PRESENT_IN_MAIN` | `7efc2dd00f0920075b850384fec0847258ab98a9` | `77a4f8f0ad298a390743c43539249c25c83c4ecd7002bd4c00f835fa8aeb85e0` |
| 44 | `feat/m175-sr2-a4-mpnet-20261113` | `services/semantic-gpu/test_a4_projection_v2.py` | `NOT_PRESENT_IN_MAIN` | `e257217c31d11aa31b44e23ed3334800102f6f9c` | `4bea6e4376caf4fb0f85c73e6f0133e3e8ba1d5038ae02d9854791f50d12038b` |
| 45 | `feat/m175-sr2-a4-projection-v2-20261113` | `docs/codex/evidence/2026-11-13-m175-c3-sr2-a4-projection-v2.md` | `NOT_PRESENT_IN_MAIN` | `8d0a5744a4df656a7abbb6fd544b37e576654701` | `799723eca3d1ed56caca4ff3dceeb114c2a63645f889a97e646bd8966a83206c` |
| 46 | `feat/m175-sr2-a4-projection-v2-20261113` | `services/semantic-gpu/qualify_a4_projection_v2.py` | `NOT_PRESENT_IN_MAIN` | `24c4a977110bd29a2e20e8ff9ad103f2d8201b4a` | `1f9204ba9943a377c71c7a45c1e985628ce29b09c2f9e3b7ba1df3f971ba37a9` |
| 47 | `feat/m175-sr2-a4-projection-v3-20261113` | `docs/codex/evidence/2026-11-13-m175-c3-sr2-a4-final-quality-intervention.md` | `NOT_PRESENT_IN_MAIN` | `33c994cc3398c158d249cce74f65a0da777ab361` | `26b2f7243fd8f0ef86320fa598f40ff16d69a2a97ed2577b160a33779670c974` |
| 48 | `feat/m175-sr2-a4-projection-v3-20261113` | `services/semantic-gpu/a4_projection_v3.py` | `NOT_PRESENT_IN_MAIN` | `b1befcb74954fa74240997d26bc24c9b0cc21eba` | `480d861878ad52d45f3066f669b40b4f94d81715b4f0d629ecf3e2cc912f062f` |
| 49 | `feat/m175-sr2-a4-projection-v3-20261113` | `services/semantic-gpu/qualify_a4_projection_v3.py` | `NOT_PRESENT_IN_MAIN` | `0dfecd24ca86edb8671695527047a6c4518d5cc4` | `44019f3e4068cc9cc3a64f49aad0fd4bc57689d3587abf416b2e02cdbc5128e7` |
| 50 | `feat/m175-sr2-a4-projection-v3-20261113` | `services/semantic-gpu/test_a4_projection_v3.py` | `NOT_PRESENT_IN_MAIN` | `84ad66ca3af883ee162a5890e01345fc9479eb71` | `5c229ea53f79cff3a3a5d872e0e1b1663474aeff64c88bf82438dcd8c571f61c` |
| 51 | `feat/m175-sr2-a4-voyage-20261113` | `apps/dashboard/lib/governance/voyage-embedding-provider.ts` | `NOT_PRESENT_IN_MAIN` | `cb47a87e6fb867af8a7f4e8e9cae240850c27ca9` | `4dde3b1e802713ab177da6fd5a3fa24a2e2df1572d9fe3e18af02a7ef2479978` |
| 52 | `feat/m175-sr2-a4-voyage-20261113` | `docs/codex/evidence/2026-11-13-m175-c3-sr2-a4-voyage-cloud-adapter.md` | `NOT_PRESENT_IN_MAIN` | `41f3c397c84f71a4bd5bd3f19e7391fd43c29489` | `7bcc5a916e956bcff704b66ab7c48ac14b0e6a9e6a64612192357a7bf419238e` |
| 53 | `feat/m18-s1-executive-workspace-recovery` | `apps/dashboard/components/layout/Sidebar.tsx` | `DIFFERENT_OR_LINE_ENDINGS` | `0bf8a8898efa83f340704d46615ab8466a9a9bd2` | `dc7d3d4dc27382a2c8d49d3514ac45052e16d58e949098eca4367e41126b7c5c` |
| 54 | `feat/m18-s1-executive-workspace-recovery` | `apps/dashboard/lib/auth.ts` | `DIFFERENT_OR_LINE_ENDINGS` | `76996e2c2fac2aed618f0356a59bd92a5a0316c6` | `53a6342f3e92a63826e3f23d1a15bb8be55a39220f0488961bbd10e4aef7ba5b` |
| 55 | `feat/m18-s1-executive-workspace-recovery` | `apps/dashboard/lib/auth/errors.ts` | `DIFFERENT_OR_LINE_ENDINGS` | `29416eb14cbee2bf569ba77f6cccde1a37832fdb` | `6294120228ef4f9585400c93b60dfc42b7c02d5abaf6064d65b17795bdec844c` |
| 56 | `feat/m18-s1-executive-workspace-recovery` | `apps/dashboard/lib/auth/persistence.ts` | `DIFFERENT_OR_LINE_ENDINGS` | `506a42328d422e79ee7eda2f22373316866338fc` | `e07cb7fe58bea93f69f7b09802f1c79f46f464bcd20ec837ed94fb56a05cb001` |
| 57 | `feat/m18-s1-executive-workspace-recovery` | `apps/dashboard/lib/governance/passport-governance-read.ts` | `DIFFERENT_OR_LINE_ENDINGS` | `b5b54fc06e988c0c00a3990980743ceaa72c0341` | `c6b376a0f53a249ac8726a5f7f7d2e11c62021db4a46a6ab26d96489d444787a` |
| 58 | `feat/m18-s1-executive-workspace-recovery` | `apps/dashboard/lib/governance/passport-read-store.ts` | `DIFFERENT_OR_LINE_ENDINGS` | `8216fd650305dff64ec63975aa37061c9bca17e7` | `a6d31bf27552cb202bb97d58307c595abc1137fa236c4f75f686d686b653403d` |
| 59 | `feat/m18-s1-executive-workspace-recovery` | `apps/dashboard/lib/governance/passport-risk-overlay-read.ts` | `DIFFERENT_OR_LINE_ENDINGS` | `9d4724a28e0431323b7497de8588c1b86e4de57e` | `b32aeffdb2f7e02fd001cf0b6590a04046787f795b0baef86c87a82fa19af063` |
| 60 | `feat/m18-s1-executive-workspace-recovery` | `apps/dashboard/lib/governance/passport-session.ts` | `DIFFERENT_OR_LINE_ENDINGS` | `909637e4dba40f122f82c9f35e0b55b3d75f42b7` | `5f63a91fcd70b86660050897f6023ec48e5007526025358e17636918d9629531` |
| 61 | `feat/m18-s1-executive-workspace-recovery` | `apps/dashboard/package.json` | `DIFFERENT_OR_LINE_ENDINGS` | `66ec2947b6498e310c912df896c59c93300c8199` | `52fa1c28a9bbe66d6024c166faeee9e938a74303d3f6d53b159a652ac4f2986d` |
| 62 | `feat/m18-s1-executive-workspace-recovery` | `apps/dashboard/tests/l14-read-projection-contract.test.ts` | `DIFFERENT_OR_LINE_ENDINGS` | `6492ad459f4e737d7c0233ea95de584e32b274a4` | `90f7a7f6aa6443a2e42c5a18a567db86190bf309dc3696a945b2be2f09e587db` |
| 63 | `feat/m18-s1-executive-workspace-recovery` | `apps/dashboard/app/(dashboard)/workspace/page.tsx` | `DIFFERENT_OR_LINE_ENDINGS` | `3038553e6d422d2ac0839e1fc5cc4c81955ffc21` | `c7ad4c4c9baf6ab51c8584db6381f9958675a58dd0b02fd1c3083056f6fe0948` |
| 64 | `feat/m18-s1-executive-workspace-recovery` | `apps/dashboard/lib/workspace/executive-query.ts` | `DIFFERENT_OR_LINE_ENDINGS` | `8f7958500c513732ecc780ac859f3896027bd929` | `374dd2aedb54fac2b78d94da7b160ce0395c6b7b652255e4ee2d1b5fbd651de4` |
| 65 | `feat/m18-s1-executive-workspace-recovery` | `apps/dashboard/tests/m18-executive-auth.test.ts` | `NOT_PRESENT_IN_MAIN` | `fecd38b3733b922d6e2d6ce7dd0034e6bba9588c` | `fb89594fd0d62ef7f61f38ca06c7b867a4f0307486a426ab60fe808a22bba903` |
| 66 | `feat/m18-s1-executive-workspace-recovery` | `apps/dashboard/tests/m18-executive-session-security.test.ts` | `NOT_PRESENT_IN_MAIN` | `ef580bd0ac6a034254b4557c8ca2897ea3f323be` | `b9ad58f642ce454d4c3c0a653f701aa6e48a949c2e532a3221b600a31a5c64ec` |
| 67 | `feat/m18-s1-executive-workspace-recovery` | `apps/dashboard/tests/m18-executive-ui.test.ts` | `DIFFERENT_OR_LINE_ENDINGS` | `d31f011fa29b088ef972bae21f2c8bf6612a5a09` | `e29dcde1c79bfe681d9680ecb410d65ca3d94e406eeead78f91f7a71f786be1f` |
| 68 | `fix/m18-s1-sec01-r2` | `apps/dashboard/app/(dashboard)/workspace/page.tsx` | `DIFFERENT_OR_LINE_ENDINGS` | `19de8e52df7a59af8b0f8b8a1b1cc0db3809966f` | `4bb4c6e9939a47a64f1bccfaa97a2f12e5f6e70462b88c5623bd33745e665212` |
| 69 | `fix/m18-s1-sec01-r2` | `apps/dashboard/tests/m18-executive-session-security.test.ts` | `NOT_PRESENT_IN_MAIN` | `35ce9bcd343abcc5f2199d91031c58127d9d397e` | `72574c7d307434f94096a7f77a30062229b98da863b7690498b94b8ca9655929` |
| 70 | `fix/m18-s1-sec01-r2` | `apps/dashboard/tests/m18-executive-ui.test.ts` | `DIFFERENT_OR_LINE_ENDINGS` | `a0df4a470e33f560ec9769f62fae8d0f51a4059f` | `57dd2181939950326c5f11c0ad1d66c9b352603347370ccbef989ff3e3f6493c` |
| 71 | `test/passport-compat-rehearsal` | `docs/codex/evidence/2026-11-08-passport-compat-package.md` | `NOT_PRESENT_IN_MAIN` | `e7be837fde06ba04e17b2297412fa794fa58af46` | `821cd4e41c0da1a25f35702b66cdd081873833a9739420e27f613d03bdfa53e5` |
| 72 | `test/passport-compat-rehearsal` | `docs/codex/evidence/2026-11-08-passport-test-alignment.md` | `NOT_PRESENT_IN_MAIN` | `1321e96f711928ab39b0bf9d8321a1ebb17a2ddb` | `41d7eb98ab064f203d32244f610ba852eca6e0ed13d767b3e12f1c2d13bd878e` |
| 73 | `test/passport-compat-rehearsal` | `docs/codex/evidence/2026-11-09-passport-controlled-rehearsal.md` | `NOT_PRESENT_IN_MAIN` | `9c63787e47edd0bdc03c4a9194564364d68191bb` | `57f8d35d69138c9969ad9f2357a9b7a1cac184c03e2d556823af26b5377c8028` |
| 74 | `test/passport-compat-rehearsal` | `ops/passport-compat-v1/README.md` | `NOT_PRESENT_IN_MAIN` | `2573ae766c1ec19b02ce85363bfad8654f2069c4` | `85eeb3d63f299b102cda9116b8e608ad17e356ef40b67cf2397e6a31a00b7a60` |
| 75 | `test/passport-compat-rehearsal` | `ops/passport-compat-v1/gate-matrix.md` | `NOT_PRESENT_IN_MAIN` | `d5451251350f24210aad7487a0a98005e8b83cc1` | `a8d158ff084fd01610cdca4611e31d17ef74827fd97e38c509ab648fbd04c8d6` |
| 76 | `docs/passport-runtime-options` | `docs/codex/evidence/2026-11-09-passport-runtime-recovery.md` | `NOT_PRESENT_IN_MAIN` | `bae58def93851d2a1c019008e80a3a45fb9660c6` | `f4da2a9e959c4c21d5c918a85cf064898ad40fbdd8c48f7cdec0e2695b581c71` |
| 77 | `docs/passport-runtime-options` | `ops/passport-runtime-recovery/README.md` | `NOT_PRESENT_IN_MAIN` | `5e70c797fc0e566790e29569a3bb9f6ef355025f` | `c7fd1ba72e6b9ab978c5becd8ce5e2ba506488bdbba4d63d76e41e9d7caedcdc` |


**Exclusão controlada (não enviada no ZIP):** `feat/m175-sr2-a4-voyage-20261113` / `apps/dashboard/tests/voyage-embedding-provider.test.ts` — `POTENTIAL_EMBEDDED_SECRET`. O filtro não prova existência de segredo. Tratar como F0-005, com inspeção segura em origem e sem circulação de credenciais.

**Contagens de inventário original:** 37 worktrees (18 dirty); 83 branches locais; 326 fingerprints (41 brutos iguais à main, 51 divergentes/EOL, 234 registros de ausência representando 134 caminhos únicos). Esses números não representam 134 funcionalidades. Os 77 arquivos selecionados não cobrem todo o repositório nem autorizam limpeza de worktrees.

## 14. Controle de versão e critério de publicação

### 14.1 Sem múltiplos arquivos de gestão

- **Nome final único:** `GOVIA_MASTER.md`. Proposta de localização: raiz do repositório, para facilitar a leitura por agentes e humanos.
- **Não criar:** segundo Plano Mestre, planilha de status, registro de decisões, arquivo Fase 0, template de tarefa/handoff em Markdown separado, documento de reunião ou novo handoff como fontes oficiais. O conteúdo pertinente já existe aqui.
- **Podem continuar existindo:** arquitetura congelada, ADRs, código, testes, scripts de CI, issues, PRs, evidências anexas e arquivos históricos — sem serem atualizados em paralelo para **gestão**.
- **Orientadores técnicos existentes:** `AGENTS.md` e `CLAUDE.md` devem conter referência curta e obrigatória a `GOVIA_MASTER.md`. `OPERATING_MODEL.md` mantém os controles específicos do runner/preflight; este master governa autorização, escopo, status e decisões.

### 14.2 Aceite e publicação (passos separados)

1. **Aceite de conteúdo:** Carlos revisa este arquivo; correções de conteúdo não alteram estados formais sem DEC-ID.
2. **Publicação GOV-001:** abertura histórica em draft e integração confirmada no [PR #88](https://github.com/cnegrao/code-guard-governance/pull/88); aceite registrado em `DEC-GOV-001-ACCEPT`.
3. **Checks de GOV-002:** instalar e testar workflow de PR em bootstrap; verificar contexto real do check e a existência de revisor elegível.
4. **Ruleset ativo:** somente após CI observado, exigir PR/review/checks, proibir atualização direta e registrar evidências N-01–N-10.
5. **Adoção operacional comprovada:** a primeira retomada com preflight e handoff ocorreu em 19/11/2026, às 15h30 de Brasília (EV-015).

### 14.3 Registro de versões e diferenças

| Versão | Data | Origem e decisão | Estado |
|---|---|---|---|
| Plano Mestre `1.0.0` | 18/11/2026 | WBS, riscos, RACI, evidências, proposta de cronograma | Histórico, substituído para gestão |
| Plano Mestre `1.1.0` | 19/11/2026 | Matriz REC aprovada, F0, índice de 77 fontes e deltas M18/E0 | Histórico consolidado aqui |
| Pacote GOV-001/GOV-002 | 19/11/2026 | Preparação de contrato e CI, 15 testes unitários reportados | Proposta técnica, **não instalada** |
| `GOVIA_MASTER.md 1.0.0-rc1` | 19/11/2026 | Consolidação única solicitada/autorizada por Carlos | Histórico documental; não publicado |
| `GOVIA_MASTER.md 1.0.0-rc2` | 19/11/2026 | QA estrutural (77 hashes; 33 tarefas), correção de tabela e triagem F0-004 BYOM/M18/E0 sem mutação | Histórico documental |
| `GOVIA_MASTER.md 1.0.0-rc3` | 19/11/2026 | `DEC-GOV-PR-BOOTSTRAP` registrado; tentativa de publicação bloqueada pela integração GitHub (403), sem mutação | Histórico anterior à abertura do PR |
| `GOVIA_MASTER.md 1.0.0-rc4` | 19/11/2026 | Correção do estado após abertura do [PR #88](https://github.com/cnegrao/code-guard-governance/pull/88) em draft. HTTP 403 mantido como ocorrência histórica resolvida por publicação via interface web autenticada | **GOV-001 EM REVISÃO. GOV-002 NÃO IMPLANTADO.** |
| `GOVIA_MASTER.md 1.0.0` | 19/11/2026 | Regularização do PR #88 e fechamento com DEC-GOV-001-ACCEPT e EV-013–EV-016 | GOV-001 DONE |
| `GOVIA_MASTER.md 1.0.1` | 19/11/2026 | Reconciliação Codex × Claude F0-004: F-01–F-07, V1–V3, EV-017–EV-021 e DEC-F0-004-DOC-CLOSE; nenhuma modificação funcional | Encerramento DOCUMENTAL F0-004; F0 ABERTA; publicação e HEAD documental verificado no PR #90 (EV-021); merge ainda não comprovado |
| `GOVIA_MASTER.md 1.0.2` | 19/11/2026 | DEC-F0-005-DOC-QUARANTINE; EV-022–EV-027; triagem Codex, revisão Claude já realizada, adjudicação humana e contenção local; baseline 826159b confirma merge histórico do PR #90 (EV-027), sem reescrever EV-021 | F0-005 CONCLUÍDO DOCUMENTAL — ARQUIVO EM QUARENTENA; REC-09 bloqueado; F0-006 PENDENTE; F0-007 BLOQUEADO; FASE 0 ABERTA. Publicação desta versão sujeita a PR, checks/revisão efetivos e HEAD validado |
| `GOVIA_MASTER.md 1.0.3` | 23/11/2026 | DEC-F0-006-DOC-CLOSE; EV-028–EV-034; reconciliação Codex × Claude reutilizada, C1–C6 e interpretação documental expressa de F0(c); baseline `3bb46f3060d918c3ce316b075d6588fef5bb6864` comprova PR #91 merged sem reescrever o checkpoint 1.0.2 | F0-006 CONCLUÍDO DOCUMENTAL CONDICIONADO; REC-05 VERIFICAR ESTADO/TEST atual NOT_EVIDENCED; REC-07 P1/A4 BLOCKED; TA-001 PENDENTE; F0-007 BLOQUEADO; FASE 0 ABERTA; M17.5 OPEN; M18 HOLD; GOV-002 NÃO IMPLANTADO; exposição externa NO-GO. Publicação válida sujeita a PR/checks/revisão efetiva/merge e HEAD confirmado |
| `GOVIA_MASTER.md 1.0.4` | 23/11/2026 | DEC-F0-007-DOC-ACCEPT; EV-035–EV-040; aceite escrito de Carlos, dois handoffs integrais recebidos com hashes de cópia, gates A–E e E1; PR #92/CI pós-merge comprovados sem reescrever checkpoints | Após publicação válida: FASE 0 ENCERRADA DOCUMENTALMENTE; F0-007 CONCLUÍDO DOCUMENTALMENTE. Sem aceite funcional/operacional; quarentena, riscos e severidades preservados; M17.5 OPEN, M18 HOLD, TA-001 PENDENTE, REC-05 VERIFICAR ESTADO/TEST NOT_EVIDENCED, GOV-002 NÃO IMPLANTADO, exposição NO-GO |
| `GOVIA_MASTER.md 1.0.5-rc1` | 23/11/2026 | DEC-TA-001-LOCAL; EV-042–EV-045; consolidação da matriz existente S1–S8 e recorte mínimo sugerido TA-002; baseline main `8ba80abb1cc9aa2e8a6ed01aff6ca8e428b92bb4` confirma PR #93/CI sem reabrir F0 | CANDIDATO DOCUMENTAL LOCAL, sem commit/publicação/PR/merge/aceite TA-001. 33 tarefas e estados/riscos preservados; M17.5 OPEN, M18 HOLD, TA-002/003/004 não iniciados, Voyage em quarentena |
| `GOVIA_MASTER.md 1.0.5` | 23/11/2026 | DEC-TA-001-DOC-ACCEPT; EV-046–EV-049; aceite do candidato rc1 e ajuste mínimo na mesma branch/PR #94, sem alterar matriz ou repetir consolidação/revisão | Após publicação válida e gates do novo HEAD: TA-001 CONCLUÍDO DOCUMENTALMENTE; TA-002 PENDENTE DE AUTORIZAÇÃO, não iniciado; TA-003/004 bloqueados. Estados técnicos, F0, riscos, quarentena e NO-GO preservados; merge/CI final ainda não presumidos neste checkpoint |

**Próxima ação única após integração válida:** preparação de TA-002 sobre S1B/LX03, mediante autorização separada. Aceite TA-001 registrado em DEC-TA-001-DOC-ACCEPT; conclusão documental somente após gates e publicação válida do PR #94. Nenhum início TA-002/003/004; quarentena Voyage e GOV-002 independente/não implantado preservados.

**Checkpoint histórico de publicação rc4:** branch `docs/gov001-master-bootstrap-20261119` publicada pela interface web autenticada do GitHub, com commit inicial `29168c2d1ae765bb17723848ec286bf9665e87ae`. O [PR #88](https://github.com/cnegrao/code-guard-governance/pull/88) foi aberto em draft para `main` e aguardava revisão e aceite naquele checkpoint. A tentativa anterior pelo conector retornou HTTP 403. Permanecem `M17.5 = OPEN`, `M18 = HOLD`, `FASE 0 = ABERTA` e `GOV-002 = NÃO IMPLANTADO`.

**Checkpoint de publicação F0-007 (23/11/2026):** [PR #93](https://github.com/cnegrao/code-guard-governance/pull/93), branch `docs/f0-007-documental-publication-20261123`, HEAD inicial `4b9af55b7dcd670831cd3c64594b78c15e821f8d`, blob `17c07ac6534807b18fc68b312ac185bfd6482ff9`; único arquivo versionado alterado `GOVIA_MASTER.md` (EV-041). Este aditivo sucede o HEAD inicial e será validado como candidato final antes do merge. Integração/final: CI independente M15/M16 e leitura dos gates GitHub/HEAD/diff; testes funcionais locais NOT_RUN, sem nova revisão. O handoff final `F0_007_DOCUMENTAL_PUBLICATION_HANDOFF` deve confirmar PR MERGED, SHA final da main e checks; não há como inserir antecipadamente o próprio SHA de merge no conteúdo que ele identifica. Estados documentais entram em vigor somente após essa publicação válida. Próxima ação: TA-001 mediante autorização separada; não iniciada.

**Checkpoint histórico TA-001 rc1 (anterior ao aceite):** EV-042 confirma merge/HEAD/checks do PR #93, sem reescrever o relato histórico acima. DEC-TA-001-LOCAL autoriza apenas a consolidação atual; seu `TA_001_DOCUMENTAL_DELTA_HANDOFF` está em §12.2. Main/master publicado permanecem em 1.0.4; 1.0.5-rc1 é somente candidato local para decisão de Carlos.

**Sucessor de aceite TA-001:** DEC-TA-001-DOC-ACCEPT / EV-046–EV-049 governam o ajuste mínimo 1.0.5 e a publicação válida no PR #94. Confirmação do HEAD final, CI, SHA da main, blob e estado MERGED integra `TA_001_FINAL_INTEGRATION_HANDOFF`, sem alterar o histórico rc1 nem antecipar sucesso. Próxima ação técnica após integração válida: preparação autorizada separadamente de TA-002 sobre S1B/LX03.

### Aditivo local de execução — TA-002 / S1B-LX04 — 24/11/2026

**TASK_ID:** `TA-002/S1B-LX04` · **Autorização:** pedido explícito de Carlos nesta sessão Codex/VSCode de 24/11/2026 para código/testes locais de contenção do fluxo `POST /api/discovery/scan`. Após STOP de compatibilidade, Carlos escolheu: “Preservar os números e acrescentar marcação explícita HEURISTIC/QUARANTINED; remover sua influência em compliance e reasoning.” Essa decisão resolve somente o tratamento dos campos monetários legados deste candidato; não autoriza publicação, PR, merge ou fechamento global.

**Baseline / predecessor:** `main@2873adea90fc92ea4b7f541c5431087a542db340`, confirmada por leitura remota; master 1.0.5 e TA-001 documental integrado via PR #94. Branch `fix/ta-002-s1b-lx04-functional-20261124`; worktree isolada `.worktrees/ta-002-s1b-lx04-functional-20261124`; HEAD inicial igual à base, diff limpo. Preflight local PASS, identidade `9d0c8486-186d-4f49-afd8-560e235cbd45`, 134 migrações preservadas. Mesma identidade/orçamento mantidos após a decisão; o STOP de compatibilidade e sua resolução ficam registrados neste aditivo.

**Objetivo / delta permitido:** impedir promoção financeira dos custos presumidos em Discovery. Reutilizar a quarentena L15 §23 e seus cinco flags existentes; acrescentar metadados às estimativas e ao summary, preservando números/tipos numéricos; retirar `costRisk` de compliance e substituir alegações financeiras no reasoning por sinais técnicos inferidos. Arquivos de implementação: `packages/scanner/src/codeguard/enrichment/{finops,index}.ts`, `packages/scanner/src/codeguard/classifier.ts`, os dois tipos públicos de Discovery e testes focados no dashboard; este registro atende §§3.3–3.4. A rota e o adaptador L15 existentes são verificados por integração, sem nova ingestão governada.

**Aceite / limites:** testes com detecção real de APIs, cinco sinais técnicos preservados, números sempre HEURISTIC/QUARANTINED nas projeções públicas, custo observado UNKNOWN/NOT_EVIDENCED inclusive para estimativa zero, invariância de classificação/compliance sob custo presumido e ledger sem alegações financeiras. Typechecks scanner/dashboard e `git diff --check`. Sem A4, LX03, A5/A6, Hub S2–S8, M18, migrações, Docker, TEST/hosted, deploy, credenciais ou mudanças no candidato documental 1.0.6-rc1 de outra worktree. STOP em conflito arquitetural/contratual, dependência ausente ou falha repetida sem hipótese nova. Alvo ativo informativo 90 minutos; tempo ativo conhecido não disponível. Executor Codex; revisão humana pendente; decisor Carlos. Nenhum estado global LX04/S1B/TA-002/M17.5/M18 alterado por este registro.

**TA_002_S1B_LX04_FUNCTIONAL_HANDOFF — candidato funcional local, 24/11/2026:** IMPLEMENTADO + TESTADO LOCALMENTE, não integrado/não aceito. Branch/HEAD/base acima preservados; nenhum commit, push, PR ou merge. Diff de oito arquivos: `GOVIA_MASTER.md`, `packages/scanner/src/codeguard/enrichment/finops.ts`, `packages/scanner/src/codeguard/enrichment/index.ts`, `packages/scanner/src/codeguard/classifier.ts`, `packages/scanner/src/codeguard/types.ts`, `apps/dashboard/lib/discovery/types.ts` e os novos `apps/dashboard/tests/lx04-finops-containment.test.ts` / `apps/dashboard/tests/lx04-discovery-finops.test.ts`. O cache incremental produzido pelo typecheck foi restaurado à baseline. As worktrees anteriores e o candidato documental 1.0.6-rc1 não receberam escritas desta implementação.

**Antes/depois:** o cálculo preserva seus valores numéricos e a fórmula legada. Antes, `costRisk` heurístico compunha `exposureSignals` e o classifier incluía dólares/mês no reasoning também enviado ao ledger. Agora, FinOps e cada item do breakdown recebem `costEvidence={kind:HEURISTIC,authority:QUARANTINED,observedCostState:UNKNOWN,evidenceState:NOT_EVIDENCED}`; summary recebe `monthly_cost_estimate_evidence` com a mesma fronteira. `result` e `classified` carregam essas marcações; nenhuma estimativa alimenta compliance/classificação. O reasoning conserva apenas os cinco flags do mapa L15, com INFERRED/NON_AUTHORITATIVE e ausência descrita como “not detected”. Rota, adaptador, autenticação, tenant, identidades, proveniência, contratos numéricos e ingestão governada permanecem existentes. Metadados opcionais nos tipos mantêm compatibilidade com produtores/objetos legados; o scanner novo sempre os emite.

**EV-TA002-LX04-LOCAL-20261124 — provas efetivas:** 123 casos distintos PASS: 7 focados (quarentena, valores 520/zero, ausência de inflação de compliance com/sem PII, invariância de classificação/L15, independência de objetos e entrada L15 legada), 3 da rota real com portas externas simuladas, 2 Discovery oversight, 2 pre-demo Discovery, 5 aceite estático M17-S1, 7 adapters L15, 6 contratos de sinais/hipóteses L15 e 91 runtime observation L12. Logs em `.artifacts/agent/4e42805e-7ef1-4ab3-b367-65434a430865-0.log` e `.artifacts/agent/3dfe3044-e759-4e24-96e1-aa929a95ff9d-{0..6}.log`. Typechecks finais scanner e dashboard PASS: `.artifacts/agent/62721c0a-9ac2-428a-b550-165f714be336-{0,1}.log`. Comandos completos, candidatos, tentativas e durações estão em `.artifacts/agent/verification.jsonl`; checkpoint final em `.artifacts/agent/handoff.{json,md}`. A integração foi executada uma vez; após a revisão única, o único ajuste de produto foi opcionalidade TypeScript, com fixture nova e typechecks renovados; evidência runtime anterior reutilizada sem nova regressão completa. Após esses checks, somente este registro documental foi complementado; `git diff --check` e o fingerprint final são registrados no checkpoint.

**Riscos / limitações / próxima ação única:** números estimados continuam expostos por compatibilidade expressamente escolhida por Carlos; consumidores fora deste fluxo que ignorem QUARANTINED não são tornados seguros por este recorte. Este scanner não admite custo real: custo observado permanece UNKNOWN/NOT_EVIDENCED; comprovação real continua dependendo de L12. Integração usa fontes controladas e ledger RPC simulado, sem hosted, deploy ou banco TEST; CI/revisão humana não executadas. Não há falhas de testes ou bloqueio remanescente deste candidato; o STOP inicial foi resolvido por Carlos. Aguardar a revisão/decisão de Carlos sobre este diff local; nenhuma publicação está autorizada. LX04/S1B/TA-002 não declarados globalmente CLOSED; M17.5 OPEN, M18 HOLD e NO-GO preservados.

### Registro de decisões — 25/11/2026 (decisor Carlos; arquiteto Claude)

| ID | Decisão | Estado |
| --- | --- | --- |
| DEC-ARCH-001 | `graphos-complete` arquivado (não builda, não testa, não publica); ADR `docs/architecture/ADR-GOVIA-ARCHIVE-GRAPHOS-COMPLETE-v1.md`. Supera os candidatos S1C-L04 (cinco entrypoints e `/api/v1`), que não serão integrados. Os GETs residuais (MÉDIO-1) deixam de existir com a retirada do deploy hosted, ação do dono fora do repositório. | INTEGRADO — PR #95, `main@4325dd3` |
| DEC-ARCH-002 | Papel de arquiteto transferido ao Claude. Codex implementa; revisão adversarial em sessão separada; Carlos decide produto, produção e merge. Candidato com `PASS_WITH_FINDINGS` sem bloqueador vira PR; achados viram issue. | VIGENTE |
| DEC-ARCH-003 | GO para a Pista A (demonstração limitada). Não declara M18 CLOSED nem prontidão comercial. | VIGENTE |
| DEC-ARCH-004 | Mutação hosted autorizada somente no projeto TEST `zkqfvqwqdypgpzauzinw` (GOVIA_DEMO) para OPS-001: aplicar as 10 migrações de 21–29/10/2026 ausentes nele. Produção excluída. | AUTORIZADO, NÃO EXECUTADO |
| DEC-ARCH-005 | LX04 integrado por este PR. M-01 da revisão de 24/11 fica obsoleto com DEC-ARCH-001; L-01 a L-03 seguem como issues. | NESTE PR |
| DEC-ARCH-006 | Demonstração roda no TEST (GOVIA_DEMO). A produção hosted atual não será migrada; uma produção nova será criada a partir das migrações da `main` quando autorizada. | VIGENTE |

**EV-ARCH-PRD-20261125:** leitura só de metadados, feita por Carlos. A produção hosted contém apenas o schema de agosto/2026, sem L14/L15/Discovery Machine. Nela, 12 funções `SECURITY DEFINER` (incluindo `ledger_append`, `agent_graph_traverse`, `compute_governance_score`) são executáveis por `anon` e `authenticated`, sem `search_path` fixo. No TEST as mesmas estão revogadas. A correção (REVOKE) está pendente de decisão de Carlos. O TEST tem RLS ligado em todas as tabelas de `gov_repo`.

### Atualização de decisões — 25/11/2026, noite (decisor Carlos; arquiteto Claude)

| ID | Decisão / evidência | Estado |
| --- | --- | --- |
| DEC-ARCH-004 (atualização) | OPS-001 executada por Carlos no TEST `zkqfvqwqdypgpzauzinw` via Supabase CLI (`db push --include-all`, lista conferida antes). Aplicadas 3 de 10: `20261021030240`, `20261021134359`, `20261021201316` (ledger v2). A 4ª (`20261022142630`, SR1) foi recusada pela própria trava `SR1_UNAPPROVED_STARTING_CATALOG` (hash do catálogo diverge porque o TEST já tinha migrações de novembro); transação desfeita, banco íntegro. Ledger v2 ativado por Carlos com `call gov_repo.ledger_v2_activate(array['discovery_scan','talk_governance_logging'])`; `ledger_integrity_epochs_v2 = 1`. | EXECUTADO PARCIALMENTE — suficiente para a demo |
| DEC-ARCH-008 | As 7 migrações de busca semântica (`20261022142630` a `20261029195734`) ficam adiadas no TEST. Nenhuma rota ou tela do dashboard chama essas funções hoje. Se forem necessárias, serão reescritas para o catálogo atual; a trava não será contornada. Busca semântica (LX03/SR2) sai do caminho da demonstração. | VIGENTE |
| DEC-ARCH-007 | Fonte de teste e demonstração: somente GitHub (repositório `cnegrao/govia-agent-source`). Demais fontes (GitLab, Bitbucket, Azure DevOps, CI/CD/IaC, documentos, identidade) e conectores de catálogo (M19) permanecem no roadmap e serão implementados conforme demanda comercial, cada um com cliente, ambiente e critério de aceite reais. Catálogo com implementação hoje: apenas Purview inbound (M10), sem conexão live comprovada. | VIGENTE |

**EV-ARCH-PRD-20261125 (complemento):** Carlos executou o REVOKE das 12 funções `SECURITY DEFINER` na produção hosted e confirmou `anon_pode = false` e `authenticated_pode = false` em todas. Carlos declarou que não há dados válidos em nenhum ambiente (produção, dev ou TEST).

**EV-DEMO-SOURCE-V2-20261125:** branch `feat/v2-ouvidoria` (commit `5f2ce87`) em `cnegrao/govia-agent-source` acrescenta dois agentes de ouvidoria (triagem e encaminhamento), ferramentas, API, `mcp.json`, base de conhecimento e `db/schema.sql` com colunas de dados pessoais. A `main` do repositório de demonstração permanece em `cfa95f1` até o fim da SHOW-001. Integração da v2 é decisão de Carlos após a SHOW-001.

### REV-001 — revisão humana da cadeia de um agente (26/11/2026)

**DEC-REV-001 / autorização:** Carlos solicitou implementar uma ação `Review agent chain` no Passport AGENT e na fila de revisão, com prévia, seleção humana, justificativa única, decisões individuais vinculadas a um lote e execução sequencial pelos serviços governados existentes. Autorizados código, testes, build, commit, push e PR aberto sem merge. Fora de escopo: migrations, alteração do contrato canônico, aprovação automática, tradução, deploy e escrita hosted/PRD. Verificação visual expressamente pendente, com telas a listar no PR. Esta autorização específica sucede apenas o escopo desta tarefa; preserva os demais gates.

**Preflight / EV-REV-001-PREFLIGHT:** master 1.0.5; baseline `main@acdf3ceaeb50fd411c0ca6dedbd17ad3a5e1a83e`, após PR #99. Worktree nova `.worktrees/rev-001-agent-chain-approval`, branch `rev-001-agent-chain-approval`, inicialmente limpa; checkout principal e worktrees históricos preservados. Comandos existentes: `workspaceCommands.confirmReview/certifyReview`, `submitReconciliationDecision` e `triggerMaterialization`, com wrappers governados e principal humano verificado por sessão. Menor delta: coordenador/read model da cadeia, rota autenticada, prévia e links nas duas superfícies. `reasonCode` existente transporta identificador do lote e justificativa, sem coluna nova. Alvo ativo informativo: 90 minutos; duração ativa medida indisponível. STOP se migration, proibição arquitetural, serviços inacessíveis no servidor, ambiguidade de escopo ou controles do operating model. Executor Codex; revisão independente em sessão separada; decisor Carlos. Estado desta entrada: AUTORIZADO / EM IMPLEMENTAÇÃO, sem aceite funcional.

**EV-REV-001-LOCAL / candidato para PR:** IMPLEMENTADO + TESTADO LOCALMENTE; sem aceite ou integração. Prévia autenticada pelos anchors de review AGENT ou Passport canônico; composição por referência de pai e suporte persistido da revisão, sem inferir vínculo apenas pelo arquivo. Ordem topológica, seleção com dependências obrigatórias, justificativa humana digitada e MATCH proposto por identidade normalizada exata (sinal sujeito ao aceite humano, não igualdade canônica automática). Mais de um candidato de MATCH exclui o item e seus dependentes do lote; decisão já finalizada permanece em revisão individual. Confirmação, certificação, reconciliação e materialização usam exclusivamente os serviços existentes e o mesmo principal verificado, com autorização transacional preservada. Cada decisão mantém `Agent chain batch <UUID>` e a justificativa no `reasonCode` existente; confirmação agora preserva também esse motivo opcional no evento individual. Sem schema, contrato canônico, scanner, migrations, hosted ou deploy alterados. `DERIVED_FROM` continua sujeito às extremidades existentes na cadeia e à taxonomia congelada DATA_ELEMENT→DATA_ELEMENT; nenhum objeto de dados é incorporado por inferência.

**Verificação efetiva:** 122 testes distintos PASS, incluindo 19 novos (18 de cadeia/serviço/API e 1 de justificativa no evento de confirmação). Cobrem ordenação, seleção/dependências, ambiguidade, parada no primeiro erro, recibo de escrita com resposta perdida, estado UNKNOWN, tenant/ator da sessão, paginação, MATCH por identidade e exclusão de relações já materializadas. Integração com Passport (24), workspace commands (17), decision commands (27), relationship resolution (25) e decision routes (11); os 18 testes de cadeia completam o total. Evidências em `.artifacts/agent/verification.jsonl` e logs `b227fc83-edbc-488f-89c9-55a49cf7c376-{0..5}.log`, `0158b1d8-46da-4ab1-9981-657f032496ab-0.log` e `5dc7658e-caa6-4712-b0b8-45b65cc87f6e-{0,1}.log`. Typecheck dashboard PASS. Build completo `npm run build --workspace apps/dashboard` PASS, com Supabase/JWT sintéticos e URL `example.invalid`; log `.artifacts/agent/rev001-build-attempt3.log`. Regressões anteriores reutilizadas quando seus inputs não mudaram; nenhuma suíte completa repetida. Não houve teste em banco, hosted ou browser.

**Tentativas / limites:** o primeiro typecheck apontou a conversão necessária de `OrganisationId`; corrigida e verificada. Primeiro build compilou e recusou comparação redundante no matcher durante typecheck; matcher foi indexado e validado. Segundo build passou compilação/tipos e parou por `SUPABASE_ANON_KEY` ausente; terceiro completou com configuração inteiramente sintética. Logs anteriores preservados em `rev001-build.log` e `rev001-build-attempt2.log`. Leituras paginadas têm teto explícito de 10.000 linhas por tabela e falham sem entregar prévia truncada. Se transporte falhar após uma escrita, o executor consulta o recibo e para; recibo indisponível produz UNKNOWN, sem alegar rollback. Revisão delta local realizada; revisão independente e visual pendentes. Por instrução expressa de Carlos, a visual não bloqueia este PR e deverá cobrir Passport AGENT, fila AGENT, prévia/seleção/ambiguidade e resultado de falha parcial/UNKNOWN em `/governance/agent-chain`. Nenhum gate M17.5/M18, demo ou exposição externa é alterado. Próxima ação única: publicar o candidato autorizado em PR para revisão, sem merge.
