# GOV IA — MASTER ÚNICO DE GOVERNANÇA, RECUPERAÇÃO E EXECUÇÃO

**Arquivo oficial proposto:** `GOVIA_MASTER.md` (preferencialmente na raiz de `cnegrao/code-guard-governance`)  
**Documento ID:** `GOVIA-MASTER-001` · **Versão do conteúdo:** `1.0.0-rc3` · **Data de consolidação:** 19/11/2026 (Brasília)  
**Estado de publicação:** **PR DOCUMENTAL AUTORIZADO; CRIAÇÃO BLOQUEADA POR PERMISSÃO GITHUB (HTTP 403); NÃO PUBLICADO** · **Aprovador:** Carlos  
**Baseline Git verificada:** `main@462751b239d1374f71337ddb6d525e27e1c9b267`  
**Escopo da aprovação já concedida:** (i) matriz REC-01–14 e Fase 0 documental; (ii) preparação GOV-001/GOV-002 sem mutação; (iii) adoção do conceito de **um arquivo único de gestão**. **Carlos autorizou a criação de PR documental GOV-001 em 19/11/2026, sem merge. A tentativa de criar a branch foi recusada pelo GitHub (HTTP 403); aceite final, merge e ativação de proteções continuam sujeitos a autorizações separadas.**

> **REGRA DE OURO — UMA FONTE DE GESTÃO:** este é o **único arquivo ativo** de plano, WBS, status, decisões, riscos, evidências, handoff e contrato operacional do GOV IA. A arquitetura congelada, ADRs, código, testes, migrações e workflows continuam existindo como **fontes técnicas de verdade e provas**, não como planos de gestão concorrentes. Excel, PDFs, checkpoints e pacotes anteriores são arquivos históricos: não receberão atualizações paralelas. Alteração de status só neste master, mediante evidência e autorização.

> **ESTADO INVIOLÁVEL:** `M17.5 = OPEN` · `M18 = HOLD` · `F0 = ABERTA` · `GOV-001 = PR AUTORIZADO / BLOQUEADO POR PERMISSÃO` · `GOV-002 = DESENHADO / NÃO ATIVADO` · `EXPOSIÇÃO EXTERNA = NO-GO ATÉ DECISÃO ESPECÍFICA`. Nenhum registro neste arquivo constitui autorização automática de código, PR, merge, migração, banco, hosted, deploy, segredo ou publicação.

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

| Item | Situação verificável em 19/11/2026 | Próxima evidência necessária |
|---|---|---|
| GitHub `main` | SHA `462751b239d1374f71337ddb6d525e27e1c9b267` | Revalidar no início da implementação, não inferir que permanece fixo |
| Proteção `main` | `protected=false`, rulesets `[]` nas consultas de leitura | GOV-002: workflow verificado e ruleset efetivamente ACTIVE |
| CI existente | M15 regression e M16 PG17 security; histórico PASS no SHA citado | Não supor check required nem aceitação de M18 |
| Fase de recuperação | F0 documental aberta; 37 worktrees/18 dirty; 326 fingerprints | Finalizar F0-004 a F0-007; preservar worktrees |
| Sources locais exportados | 77 arquivos em 13 branches; 1 excluído por potencial segredo | Segurança do teste Voyage; demais deltas semânticos |
| M17.5 | OPEN | Fechamento V1 explícito com critérios e prova |
| M18 | HOLD; Executive S1 já integrado, não aceito | Respeitar predecessor M17.5 e aceite de personas |
| BYOM | Candidato funcional local, feature flag; não SaaS | Triagem de segurança/compatibilidade para autorização específica |
| SR2-A4 | BLOCKED; V2 preservada, V3 não promover; MPNet/Voyage experimentais | Nova hipótese e aceitação de qualidade, não tuning circular |
| Governança | GOV-001 autorizado para PR, bloqueado por permissão GitHub; GOV-002 não implantado | Restaurar acesso de escrita autorizado e publicar PR documental; CI/ruleset depois |
| Demo externa | NO-GO | D01–D09 relevantes, ambiente, segurança e autorização do responsável |

**Próxima ação técnica única autorizada neste momento:** `F0-004` — finalizar a comparação *read-only* dos deltas e a elegibilidade dos testes herdados contra o `main`, sem solicitar novo inventário, alterar código ou executar bancos/testes. Triagem BYOM/M18/E0 documentada na seção 6; nenhuma integração funcional está autorizada. **Próxima ação administrativa autorizada:** abrir PR documental GOV-001 com este master e referências mínimas dos agentes, sem merge, CI nova ou alteração direta em `main`; **STOP atual: criação de branch negada com HTTP 403 pela integração GitHub**. Ambos são tarefas documentais compatíveis; nenhum trabalho funcional em paralelo.

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

**Diagnóstico remoto em 19/11/2026:** `main` em SHA `462751b...`, `protected=false`, rulesets vazios; `AGENTS.md`, `CLAUDE.md`, `OPERATING_MODEL.md` existentes; workflows `.github/workflows/m15-postgres-regression.yml` e `m16-postgres17-security.yml` existentes; sem workflow específico de contrato de PR no baseline. A preparação documental GOV-001/GOV-002 foi concluída e a abertura do PR documental GOV-001 foi autorizada em 19/11/2026. **A criação da branch foi negada por HTTP 403 (Resource not accessible by integration); nenhuma publicação nem ativação ocorreu.**

### GOV-001 — contrato único e adoção

1. Revisar e aceitar este `GOVIA_MASTER.md` como **único arquivo de gestão**.
2. **PR documental GOV-001 autorizado em 19/11/2026, execução bloqueada por permissão:** incluir `GOVIA_MASTER.md` e ajustar `AGENTS.md`/`CLAUDE.md` **somente para apontar** a este arquivo; preservar `OPERATING_MODEL.md` existente. **Sem merge ou implantação GOV-002.**
3. **Não publicar** na mesma revisão uma cópia do velho Plano Mestre, um Decision Register, Task/Handoff templates ou checkpoints: seu conteúdo agora está incorporado aqui.
4. Registrar `DEC-ID`, SHA do PR, revisor e aceite neste master. Publicação no Git não prova que novos agentes efetivamente leram o documento: conferir o preflight de uma sessão real.

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

**Estado atual:** GOV-001 autorizado para PR documental, **bloqueado pela permissão de escrita do conector GitHub**; GOV-002 proposta testada localmente, **não publicada nem ativada**. A proposta antiga de múltiplos documentos GOV foi **substituída** por esta abordagem de um master, por decisão do proprietário nesta conversa.

## 5. Matriz de recuperação aprovada

**Decisão `DEC-REC-000` aprovada em 19/11.** `REC` descreve tratamento, não código automaticamente aceito; prioridade P0/P1/P2 é de gestão.

| ID | Frente | Estado de prova | Tratamento aprovado | Prioridade | Gate próximo |
|---|---|---|---|---|---|
| REC-01 | Core M14–M17 | Presença em main; integração histórica | PRESERVAR | P0 | Sem reescrita; delta somente com prova de defeito |
| REC-02 | Discovery S1–S3 | Motor/fluxo integrados; jornada atual ainda por validar | REUTILIZAR | P0 | Avaliar fluxo real, não recodificar scanner |
| REC-03 | LX07 / segurança | PR #84–87 integrados; LX07 global não necessariamente CLOSED | MANTER CORREÇÕES | P0 | Deltas residuais com evidência |
| REC-04 | M18 Executive | UI e query no main; testes locais têm variantes | PRESERVAR/COMPARAR TESTES | P0 | Aceite S1 e permissão seguem pendentes |
| REC-05 | SEC-01 no TEST | Prova histórica de implantação e pós-check 11/11 | VERIFICAR ESTADO | P0 | Não reaplicar a migração |
| REC-06 | BYOM | Implementação local com feature flag, APIs/UI, serviço e testes | CANDIDATO A RECUPERAÇÃO | P1 | Segurança, compatibilidade e hosted separados |
| REC-07 | SR2-A4 V2/V3 | Qualificação experimental; V3 falhou em corpus independente | PRESERVAR V2/REJEITAR V3 | P1 | A4 BLOCKED |
| REC-08 | SR2 MPNet | Runtime qualificado; qualidade insuficiente | PESQUISA/ARQUIVO | P2 | Não promover provider |
| REC-09 | SR2 Voyage | Adaptador local; revisão/egress/probe sem prova; teste excluído | PRESERVAR BLOQUEADO | P2 | Revisão de segredo necessária |
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

## 6. Fase 0 — estado e critérios de fechamento

**Escopo autorizado:** análise documental/read-only já aprovada. Nenhum teste, PR, merge, commit, alteração Git, DB/hosted, migração, deployment ou correção funcional decorre automaticamente da F0.

| TASK_ID | Entrega | Status nesta revisão | Evidência/pendência |
|---|---|---|---|
| `F0-001` | Congelar aprovação, SHA e decisões | CONCLUÍDO DOCUMENTAL | Chat + aditivo; não é merge |
| `F0-002` | Catalogar inventários de 37 worktrees/326 fingerprints | CONCLUÍDO DOCUMENTAL | ZIPs de inventário e fingerprint |
| `F0-003` | Indexar exportador (77 fontes/1 excluída) | CONCLUÍDO DOCUMENTAL | Registro SHA256 por arquivo na planilha v1.1 |
| `F0-004` | Comparar semântica M18/Worker/BYOM vs main atual | EM_REVISAO_READONLY — TRIAGEM DOCUMENTADA | Dependência BYOM/LLM identificada; testes M18/E0 condicionais; revisão final pendente |
| `F0-005` | Avaliar teste Voyage excluído sem compartilhar segredo | BLOQUEADO | Revisão sanitizada/autorizada localmente |
| `F0-006` | Reconciliar evidências SEC-01 e bloqueios de M17.5 | PENDENTE | Somente verificação sem migração automática |
| `F0-007` | Revisão independente e aceite formal de fechamento F0 | BLOQUEADO | F0-004–006 necessários |
| `F0-008` | Bootstrap documental do controle por PR | AUTORIZADO; BLOCKED (GitHub HTTP 403) | Recuperar permissão de escrita ou usar executor Git autenticado; GOV-002/merge/ruleset exigem autorizações separadas |


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

**Gate de encerramento F0:** (a) conciliar fontes e variantes relevantes com segurança; (b) resolver F0-005 por verificação local/sanitização do teste Voyage, sem publicar segredos; (c) reconciliar evidências SEC-01 no banco TEST **sem reaplicar migrations** e bloqueios formais M17.5; (d) revisão independente; (e) aceite escrito de Carlos. Até atender: **F0 ABERTA**.

**F0-005:** o exportador excluiu `apps/dashboard/tests/voyage-embedding-provider.test.ts` por `POTENTIAL_EMBEDDED_SECRET`. É somente um alerta do filtro, **não prova de vazamento**. Nenhum agente deve solicitar ou publicar o texto bruto sem triagem local específica.

## 7. Roadmap integrado e WBS

### 7.1 Ordem de execução, por dependência

- **P0-GOV:** concluir revisão deste master/GOV-001, implantar GOV-002 somente após PR autorizado e gate observado; F0 continua em read-only. A proteção não permite burlar o HOLD de M18.
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
| GOV-001 | GOV | Adotar e versionar Plano Mestre + registro de decisões | PR AUTORIZADO / BLOQUEADO POR PERMISSÃO / NÃO INTEGRADO | — | Plano v1 aprovado; arquivo versionado e registro de tarefas sem ambiguidade |
| GOV-002 | GOV | Proteger main: PR obrigatório, checks e trilha TASK_ID | DESENHADO; CI/RULESET NÃO ATIVOS | GOV-001 | main protegida; merge sem PR/check é bloqueado; PR referencia TASK_ID, baseline, prova e decisão |
| GOV-003 | GOV | Implantar checkpoint e nova-sessão obrigatório | PENDENTE DE GOVERNANÇA ATIVA | GOV-001 | Todo chat começa com BASELINE_CHECK; cada tarefa termina com HANDOFF registrado |
| SHOW-001 | SHOW | Definir ambiente e audiência segura de demonstração | PENDENTE | GOV-001 | Ambiente, acesso, dados, risco de exposição e modo online/offline escolhidos e aprovados |
| SHOW-002 | SHOW | Catalogar e conferir recibos D01–D06 existentes | PENDENTE | HIST-004;SHOW-001 | Mapa 6 elos→SHA/ID/timestamp, validade temporal, ambiente e evidência acessível |
| UX-001 | UX | UX-0: auditoria visual real do fluxo de demonstração | PENDENTE | GOV-001;SHOW-001 | Screenshots reais desktop/mobile de 3 telas; defeitos classificados, sem redesign genérico |
| UX-002 | UX | DS0/DS1 + polimento de shell e telas demonstráveis | PENDENTE | UX-001;GOV-002 | Home/Sidebar, Agent Library, Passport e Executive coerentes; responsivos; sem mudar fatos |
| SHOW-003 | SHOW | Smoke navegador e evidência D05–D06 na versão atual | PENDENTE | SHOW-002;UX-002 | URL, SHA, tenant autorizado, Passports IDs reais, /workspace, captura desktop/mobile e logs |
| SHOW-004 | SHOW | Gate segurança/exposição da apresentação | PENDENTE | SHOW-003 | Checklist D07, exclusão de segredos, consentimento/dados e decisão externa formal |
| SHOW-005 | SHOW | Ensaio + pacote de demonstração auditável | PENDENTE | SHOW-004 | Roteiro 8–12 min, demo real ou gravação/capturas da build real, fallback honesto, D09 com GO/NO-GO |
| TA-001 | TA | M17.5 V1: registrar apenas deltas ainda abertos | PENDENTE | GOV-001 | Mapa V1 S1–S8, status prova por tarefa, 1º bloqueio real, sem reabrir PR #84–87 |
| TA-002 | TA | Concluir LX03/SR2 e contenções do M17.5 efetivamente bloqueantes | BLOQUEADO | TA-001 | Cada lacuna do gate V1 resolvida por prova exata; sem supor encerramento global de LX07 |
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


### 10.3 Novas decisões de consolidação / autorização — sem inferir publicação

| DEC-ID | Data | Decisão registrada | Autoridade | Estado |
|---|---|---|---|---|
| `DEC-GOV-001-PREP` | 2026-11-19 | Preparar contrato de agentes e proteção Git/CI GOV-001/GOV-002 **sem modificar o repositório** | Carlos | APROVADO — PREPARAÇÃO SOMENTE |
| `DEC-GOV-ONE-MASTER` | 2026-11-19 | Substituir múltiplos arquivos de **gestão** por um único `GOVIA_MASTER.md`, com plano, decisões, tarefas, status, fontes e regras de execução; entregar versão única para revisão | Carlos | APROVADA — CONSOLIDAÇÃO DOCUMENTAL |
| `DEC-GOV-PR-BOOTSTRAP` | 2026-11-19 | Criar branch e PR documental de GOV-001 com master único e referências mínimas em `AGENTS.md`/`CLAUDE.md`; sem merge e sem alteração direta de `main` | Carlos | **AUTORIZADO — PR APENAS; tentativa 403** |
| `DEC-GOV-PUBLISH` | — | Aceitar conteúdo final, integrar PR, instalar CI GOV-002 ou ativar ruleset | Carlos | **NÃO DECIDIDO**; exige decisão específica posterior |

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
2. **PR GOV-001 autorizado em 19/11/2026:** comparar `main` atual, propor criação `GOVIA_MASTER.md` e atualização mínima de referências de agentes. **Criação bloqueada por HTTP 403 do conector; publicação futura em branch/PR não equivale a aceite nem autoriza merge.**
3. **Checks de GOV-002:** instalar e testar workflow de PR em bootstrap; verificar contexto real do check e a existência de revisor elegível.
4. **Ruleset ativo:** somente após CI observado, exigir PR/review/checks, proibir atualização direta e registrar evidências N-01–N-10.
5. **Adoção operacional comprovada:** iniciar uma nova tarefa, ler o master versionado e produzir preflight e handoff por referência real. Só então marcar GOV-001/GOV-002 `DONE` conforme respectivos critérios.

### 14.3 Registro de versões e diferenças

| Versão | Data | Origem e decisão | Estado |
|---|---|---|---|
| Plano Mestre `1.0.0` | 18/11/2026 | WBS, riscos, RACI, evidências, proposta de cronograma | Histórico, substituído para gestão |
| Plano Mestre `1.1.0` | 19/11/2026 | Matriz REC aprovada, F0, índice de 77 fontes e deltas M18/E0 | Histórico consolidado aqui |
| Pacote GOV-001/GOV-002 | 19/11/2026 | Preparação de contrato e CI, 15 testes unitários reportados | Proposta técnica, **não instalada** |
| `GOVIA_MASTER.md 1.0.0-rc1` | 19/11/2026 | Consolidação única solicitada/autorizada por Carlos | Histórico documental; não publicado |
| `GOVIA_MASTER.md 1.0.0-rc2` | 19/11/2026 | QA estrutural (77 hashes; 33 tarefas), correção de tabela e triagem F0-004 BYOM/M18/E0 sem mutação | Histórico documental |
| `GOVIA_MASTER.md 1.0.0-rc3` | 19/11/2026 | `DEC-GOV-PR-BOOTSTRAP` registrado; tentativa de publicação bloqueada pela integração GitHub (403), sem mutação | **PR AUTORIZADO; NÃO PUBLICADO** |

**Próxima revisão recomendada deste master:** após concluir a revisão read-only F0-004, atualizar exclusivamente as linhas de status afetadas e acrescentar EV-ID; não reescrever o documento inteiro.

**Checkpoint de publicação rc3:** tentativa de criar a branch `docs/gov001-master-bootstrap-20261119` via conector GitHub recusada com HTTP 403 (`Resource not accessible by integration`). **Nenhuma branch, commit, PR, merge ou alteração de `main` foi realizada.** O escopo já autorizado permanece exclusivamente documental; `M17.5 OPEN`, `M18 HOLD`, `F0 ABERTA`, `GOV-001/002 NÃO IMPLANTADOS`.
