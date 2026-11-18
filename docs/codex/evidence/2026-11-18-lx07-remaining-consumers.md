# LX07 — Talk, Knowledge Graph e GraphOS

2026-11-18, America/Sao_Paulo. Candidato local para revisão ACP.

## Git e contrato

- Repositório: `cnegrao/code-guard-governance`.
- Branch: `fix/lx07-remaining-consumers-20261118`.
- Worktree: `.worktrees/lx07-remaining-consumers-20261118`.
- HEAD/base: `30dbdaf7cac8ec7464c531851a6c82d803bb0884`, merge do PR #86;
  coincide com `origin/main` observado no preflight. O `main` local em outro
  worktree estava antigo; não foi alterado.
- Preflight limpo, Node 24, origem canônica e 134 migrações históricas preservadas.
  Alvo operacional informativo: 90 minutos. Checkout original e trabalho de
  outras frentes preservados.
- Fontes: `AGENTS.md`, `docs/agent/OPERATING_MODEL.md`, índice arquitetural,
  ponteiro LX07 e `docs/trust-assurance/v1-hub-read-contract.md` §12/§14.
  Implementações integradas dos PRs #84, #85 e #86 fornecem o padrão aprovado.

O contrato público do detalhe/registro permanece idêntico. Sua projeção de
supervisão foi extraída como `projectAgentOversight` e reutilizada pelo grafo;
Talk reutiliza `projectAgentDetail`. Não há entrada canônica admitida nestas
leituras: `effectiveLevel=UNKNOWN`, `evidenceStatus=NOT_EVIDENCED`,
`authority=NON_AUTHORITATIVE`. O campo compatível `oversight_level` é UNKNOWN.
`recordedLevel` conserva exatamente strings históricas, inclusive vazias ou
desconhecidas; ausente/nulo/não textual resulta em null. A origem identifica
`gov_repo.agents.oversight_level`, organização e agente.

## Delta e comportamento

| Consumidor | Antes | Corrigido |
| --- | --- | --- |
| Talk | Rótulos em respostas/citações, flags descritos como agentes governados, contexto e supportingData brutos. | DTO comum nas leituras de agentes; respostas/citações separam histórico de supervisão efetiva; flags CG-AG-012 são descritos como históricos; metadados brutos aninhados não saem nos payloads de agentes. |
| Talk semântico/LLM | RPC expunha nível, snippet e campos do agente unido; memória de código e saída do modelo podiam repetir supervisão histórica. | Releitura dos IDs na organização verificada antes de atribuir origem/divulgar campos; linhas de supervisão em snippets/memória são substituídas pela limitação; perguntas correspondentes têm resposta determinística; saída do LLM que menciona supervisão recebe a mesma limitação. |
| Knowledge Graph | Nível bruto, cg_ag_007 e external_refs completos; relações SUPERVISES e observações derivadas sem limite de autoridade. | Projeção comum; flag somente no envelope legado não autoritativo; external_refs limitado aos quatro localizadores escalares necessários a Talk. Relações/controles históricos e evidências derivadas têm autoridade explícita; texto derivado de supervisão é contido. Flag humana de sistemas também fica no envelope legado. |
| GraphOS | Campo “Oversight” mostrava o nível bruto; SUPERVISES aparecia como “supervises”; controle humano sugeria requisito comprovado. | Painel neutro UNKNOWN / NOT_EVIDENCED, histórico separado, origem e limitação NON_AUTHORITATIVE. Relação e flag são apresentadas como registros históricos não verificados. Mesmo envelope positivo antigo/injetado não altera o nível efetivo exibido. |

Fluxos inspecionados: POST `/api/talk-to-governance` → serviço/repositório Talk;
intents diretos, intents de Discovery, contexto geral, agent_semantic_search e
Coding Memory; GET `/api/graph/estate` → serviço/repositório graph →
getUnifiedGraph → ReactFlowGraph. Nenhuma rota/autenticação foi substituída.
O schema externo GovernanceAnswer e os contadores de citações permanecem;
tais contadores não representam evidência canônica de supervisão.

Arquivos modificados, relativos à raiz do worktree:

| Arquivo | Função |
| --- | --- |
| `apps/dashboard/lib/agent-detail-dto.ts` | Extrair projeção aprovada sem alterar seu contrato; limitação e tratamento textual compartilhados. |
| `apps/dashboard/repositories/talk.ts` | Projeções, intent de supervisão, citações, gaps legados e releitura semântica por organização. |
| `apps/dashboard/services/talk.ts` | Memória derivada, instrução do modelo e limite determinístico na resposta. |
| `apps/dashboard/services/knowledge-graph.ts` | DTO do grafo, envelopes históricos e contenção dos metadados/textos expostos. |
| `apps/dashboard/repositories/graph.ts` | Reutilizar o tipo AgentGraphNode, removendo cópia divergente. |
| `apps/dashboard/components/graph/ReactFlowGraph.tsx` | Reutilizar DTO e apresentar efetivo/histórico separadamente. |
| `apps/dashboard/package.json` | Registrar teste visual no runner sem react-server já usado pelo projeto. |
| `apps/dashboard/tests/lx07-remaining-consumers.test.ts` | Dez testes dos consumidores reais com transporte em memória. |
| `apps/dashboard/tests/lx07-graphos-ui.test.ts` | Fetch, seleção, renderização e apresentação neutra do GraphOS real. |
| `docs/codex/evidence/2026-11-18-lx07-remaining-consumers.md` | Este handoff para ACP. |

## Validação local

| Seleção | Resultado |
| --- | --- |
| Consumidores Talk/Knowledge Graph, rotas e payloads | 10 PASS na rodada final |
| GraphOS real com hooks/store externos controlados | 1 PASS na rodada final; matriz de nove rótulos |
| Talk runtime producer | 6 PASS |
| Contrato/projeção/rotas de detalhe LX07 | 5 PASS |
| Compatibilidade M17-S0 de risco legado | 12 PASS |
| Fronteira ReactFlowProvider | 4 PASS |
| Dashboard typecheck sem emissão/cache incremental | PASS |

Os testes incluem L1–L4 e ambas as variantes L4, nulo/ausente/vazio/desconhecido,
flags favoráveis, payloads/ledger aninhados, imutabilidade, organizações com mesmo
nome de agente, IDs semânticos estrangeiros, contexto LLM, respostas fabricadas
de supervisão, respostas técnicas preservadas, ausência/negação e autenticação.
A pergunta sem relação com supervisão e a resposta “Human resources” preservam
o caminho genérico. O modelo externo e o banco são substituídos por fixtures;
nenhuma inferência real ou acesso de rede é reivindicado.

Comandos finais/integração, executados da raiz deste worktree:

```text
node scripts/agent/verify.mjs --base 30dbdaf7cac8ec7464c531851a6c82d803bb0884 --profile final --test apps/dashboard/tests/lx07-remaining-consumers.test.ts --script apps/dashboard:test:graphos-ui
node scripts/agent/verify.mjs --base 30dbdaf7cac8ec7464c531851a6c82d803bb0884 --profile integration --test apps/dashboard/tests/talk-runtime-producer.test.ts --test apps/dashboard/tests/lx07-agent-detail.test.ts --test apps/dashboard/tests/graph-provider-boundary.test.ts --script apps/dashboard:test:m17-s0-legacy
node ../../node_modules/typescript/bin/tsc --noEmit --incremental false -p apps/dashboard/tsconfig.json
git diff --check
```

Logs finais: `.artifacts/agent/7b22b1d2-2cf3-4e7a-ae61-af0be28aefa6-{0,1}.log`.
Integração: `.artifacts/agent/f2627e1e-74e4-4a90-abed-485a842ddcd5-{0,1,2,3}.log`.
A integração antecede apenas o refinamento do matcher textual e adições aos
testes, cobertos na rodada final. Evidência inalterada foi reutilizada; a adição
deste documento não modifica os inputs de código/testes. Resultado de whitespace,
estado Git, tentativas e tempos medidos constam em `.artifacts/agent/handoff.md`.

Não houve M15/M16 local, regressão completa ou repetição dos testes inalterados
de scanner/Discovery/Reports/registro. Evidências anteriores permanecem nos
PRs #84–#86 e em seus documentos integrados; não são apresentadas como CI novo
para este candidato sem commit.

## Tentativas, limites e próximo passo

- Sandbox bloqueou inicialmente metadados Git e subprocesso do preflight;
  execução local autorizada passou. Não houve dependência nova.
- Três tentativas do harness visual falharam: duas demonstraram que mock.module
  não interceptava o pacote CommonJS carregado pelo TSX; a terceira identificou
  exports forwardRef que não são métodos. Substituição/restauração dos exports
  reais resolveu. A primeira rodada de backend detectou whitespace no SELECT
  da fixture e uma pergunta que ativava estate em vez de fallback; fixtures
  corrigidas. Logs e tentativas foram preservados, sem reset de sessão.
- O tratamento de linguagem é conservador e lexical; não constitui avaliador
  canônico ou verificação geral de veracidade do modelo. Linhas/respostas
  correspondentes podem perder detalhes técnicos junto da alegação histórica.
- External_refs públicos agora contêm somente os localizadores consumidos por
  Talk. Clientes devem ler histórico em oversight.recordedLevel e flags no
  envelope legado. Contratos aprovados de detalhe/registro permanecem iguais.
- Sem browser interativo, banco real, RLS/hosted ou prova de produção. O defeito
  subjacente do RPC legado e demais gates LX03/SR2 não são encerrados pela
  releitura defensiva deste consumidor. Nenhuma admissão canônica foi criada.
- Histórico persistido, defaults e payloads antigos do ledger permanecem
  intactos. Outras superfícies independentes, inclusive compatibilidades de
  graphos-complete/packages/graphos, não recebem aceite global por este delta.
  LX07 global, V1-S1B e M17.5 não são declarados encerrados; HOLDs preservados.
- Sem commit, push, PR, merge, deploy, alteração Supabase, migração, Docker,
  infraestrutura ou GPU. Tempo ativo não é fornecido pela plataforma; não foi
  substituído por tempo de relógio.

**STOP após validação local. Próximo passo: revisão ACP deste delta de dez
arquivos contra 30dbdaf7cac8ec7464c531851a6c82d803bb0884.** Nenhuma publicação
ou implementação adicional começa automaticamente.

## Correção pontual F1 — continuação na mesma sessão

Após o PASS_WITH_FINDINGS informado pelo proprietário, foi corrigido somente F1:
a precedência dos estados históricos de controle no Knowledge Graph. Branch,
HEAD/base e identidade original da sessão foram mantidos. O candidato revisado,
manifesto SHA-256 e handoff anterior estão preservados em
`.artifacts/agent/f1-reviewed/`; nenhuma evidência ou contador foi reiniciado.

Delta desta correção em relação ao candidato revisado:

1. `apps/dashboard/repositories/agents.ts`: extrair o padrão existente para
   `resolveLegacyControlState`, compartilhado com o grafo. Os quatro estados
   válidos registrados em external_refs.controlStates têm prioridade; sem estado
   válido, somente flag booleano true resulta em passed. Demais valores resultam
   em not_assessed. getAgentCompliance reutiliza a mesma função, sem resolução
   concorrente ou mudança dos estados válidos do contrato.
2. `apps/dashboard/services/knowledge-graph.ts`: usar essa função nos envelopes
   de cg_ag_007_oversight/cg_sys_006_human_oversight e nas relações derivadas dos
   controles de agentes/sistemas. Flag false não fabrica mais failed; estado
   explícito failed não é mais substituído por passed.
3. `apps/dashboard/tests/lx07-remaining-consumers.test.ts`: fortalecer a asserção
   existente e adicionar matriz de 13 combinações. Inclui true+failed, false sem
   estado, os quatro estados válidos, ausência e valores inválidos; verifica
   igualdade entre nós e payloads recebidos pelas rotas reais do Talk, relações
   violates somente para failed, autoridade histórica e imutabilidade.
4. Este documento: registro adicional de F1; evidência anterior preservada.

A projeção de supervisão efetiva permanece UNKNOWN / NOT_EVIDENCED /
NON_AUTHORITATIVE, com recordedLevel e origem inalterados. Os envelopes de estado
e relações mantêm LEGACY_NON_AUTHORITATIVE. Não houve alteração de scores,
LX03, histórico persistido, migração, infraestrutura, Supabase ou outro componente.
Os demais arquivos revisados conservaram seus hashes anteriores à correção.

Verificação autorizada executada uma vez nesta correção:

| Comando/seleção | Resultado |
| --- | --- |
| `verify.mjs --profile final --test apps/dashboard/tests/lx07-remaining-consumers.test.ts`, com o mesmo base explícito | 11 testes PASS, incluindo a matriz F1 |
| `node ../../node_modules/typescript/bin/tsc --noEmit --incremental false -p apps/dashboard/tsconfig.json` | PASS, exit 0 |
| `git diff --check` | Resultado registrado no handoff final |

Log do teste: `.artifacts/agent/78107120-f89e-4ecc-b429-c869fd90bdea-0.log`.
Typecheck: `.artifacts/agent/f1-typecheck.log` (sem diagnósticos).
Não foram repetidos testes visuais, compatibilidade, M15/M16 ou outras suítes;
as demais evidências válidas anteriores são reutilizadas. A adição documental
posterior aos testes não altera seus inputs. O candidato consolidado agora
contém onze arquivos; o delta F1 contém os quatro arquivos acima.

**STOP para ACP de F1.** Sem commit, push, PR, merge, deploy ou operação hosted.
