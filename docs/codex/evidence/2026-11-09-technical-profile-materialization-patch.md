# Materialização do perfil técnico — patch pronto para revisão

**Estado: PROPOSED_NOT_APPLIED.** Preparado exclusivamente no worktree `D:\code-guard-governance\.worktrees\e1-operator-unblock`, branch `fix/e1-operator-unblock`, HEAD/base `a5f85bf099fdbf0a24f1a369e4428730a042a162`. A sessão já continha mudanças E1 autorizadas; nenhuma foi descartada, commitada ou publicada. Nesta correção não houve conexão nem escrita em banco hospedado, exportação de sessão ou ação humana simulada na aplicação.

## Diagnóstico e correção

1. O vínculo real da versão está em `canonical_normalized_object_mappings`, mas o materializador histórico aceitava apenas o mapping coarse. A migração proposta reconhece o vínculo normalizado exato, seu candidato integral, tenant, tipo, origem, pai AGENT e decisão autora; mantém o caminho histórico somente quando sua decisão prova o mesmo candidato e alvo. Recusa ambiguidade e não usa fallback histórico para contornar mapping normalizado inválido. Não cria relacionamento formal no grafo.
2. A interface materializava apenas a identidade, sem comando de perfil após APPLIED. O novo cartão de revisão consulta o contexto e oferece **Materialize technical profile** como POST explícito. GET/render não grava. A organização, ator e coordenadas do candidato/proposta/versão não são aceitos do corpo do cliente.
3. Os testes PostgreSQL comprovaram mais dois defeitos na primeira gravação do materializador original: suporte antes da linha exigida pela FK e `ON CONFLICT` ambíguo com o retorno `canonical_object_id`. A correção insere o perfil antes do suporte e referencia a constraint pelo nome. A revisão inicial continua 0.

O fingerprint permanece imutável, o enriquecimento continua monotônico e o replay não altera perfil, recibos, outbox, evidências ou assertions. Não há promoção de INFERRED para VALIDATED, certificação automática ou preenchimento de campos ausentes.

## Autoridade humana e segurança

A evidência válida do caso real é reutilizada do [diagnóstico anterior](2026-11-09-real-agent-technical-profile-governance.md): proposta anterior à certificação da versão, reconciliação humana aplicada, evidências e assertions abrangidas pela cadeia. Pelo ADR vigente, essa cadeia autoriza a projeção do perfil; não há decisão independente de campo a inventar. A função repete a comprovação transacionalmente: certificação humana do review exato, reconciliação humana, identidade aplicada, cronologia e suporte integral. Propostas posteriores ou suporte não abrangido falham com `PROFILE_AUTHORIZATION_REQUIRED` e precisam do fluxo humano legítimo.

O novo wrapper `materialize_agent_version_technical_profile_governed_v1(uuid,uuid,bigint,bigint,timestamptz,text,text,timestamptz)` reutiliza o guard M16 de sessão, credential epoch e GOVERNANCE_ADMIN. Owner postgres, search_path fechado, lock_timeout e EXECUTE apenas postgres/service_role. A implementação invoker e as quatro tabelas de projeção deixam de aceitar escrita direta da aplicação. A migração não altera propostas, identidades, decisões, evidências ou funções gerenciadas do Supabase.

Há uma nova função SECURITY DEFINER autorizada no pacote proposto. Inventários fechados futuros precisarão reconhecê-la explicitamente após revisão. Nenhuma contagem histórica, manifesto congelado ou migração canônica anterior foi reescrito para acomodá-la.

## Arquivos deste patch

| Área | Arquivo |
| --- | --- |
| Adaptador da fronteira de escrita | `apps/dashboard/lib/governance/agent-version-technical-profile-persistence.ts` |
| Contexto e coordenação de perfil | `apps/dashboard/lib/governance/technical-profile-materialization.ts` |
| GET/POST autenticados | `apps/dashboard/app/api/governance/workspace/reviews/[id]/technical-profile/route.ts` |
| Ação explícita | `apps/dashboard/components/workspace/TechnicalProfileMaterialization.tsx` |
| Integração na revisão existente | `apps/dashboard/app/(dashboard)/governance/reviews/[id]/page.tsx` |
| Regressão SQL real | `apps/dashboard/tests/postgres-m16/technical-profile-mapping.test.ts` |
| Coordenação, API e UI | `apps/dashboard/tests/technical-profile-materialization.test.ts` |
| Migração proposta, transporte, manifesto, integridade e procedimento | `ops/agent-version-profile-v1/` |

A alteração desta tarefa na página de revisão é o import e a inclusão do cartão para AGENT_VERSION. A correção de decodificação já existente nessa página é anterior. Os demais arquivos sujos listados pelo Git não pertencem a esta correção. A revisão React verificou hooks, ação no evento, botão desabilitado durante a operação, alerta acessível e import de tipo sem dependência server-only no bundle cliente; nenhuma reformulação visual foi iniciada.

## Migração e integridade do pacote

Arquivo: `ops/agent-version-profile-v1/20261109191942_agent_version_technical_profile_governed_mapping_v1.sql`.

- SHA-256 do SQL proposto: `9c22c983eb1cd9cd48329b7d153b555de48ba2c4475ffe7b5eb70f55726e60a6`.
- SHA-256 do transporte `deployment.sql`: `477f6b8dccb1a316c0e32bb376ed22fc29ddd8693c6add2a8a8108e9d50d9aab`.
- Corpo anterior exigido pelo preflight: `8754262bf27e47c7b5e502d8f2f9bcd1e18aeb482b3930b30e9f7d8c6759ecdd`.
- `manifest.json` fixa 12 arquivos, incluindo o SQL histórico inalterado e os arquivos da integração.

O rascunho fica fora do diretório de aplicação automática enquanto aguarda revisão. Sua promoção posterior ao inventário canônico deve conservar os bytes aprovados e ser registrada como novo sucessor operacional, sem reescrever o checkpoint histórico. O transporte aplica apenas esta correção e registra versão, nome e SQL exato no histórico dentro da mesma transação; recusa reaplicação. Não é necessário repetir as 25 migrações M16/M17.

## Testes e verificações

| Verificação | Resultado |
| --- | --- |
| PostgreSQL 17 real: mapping normalizado/histórico, tenant/kind/candidato/versão, certificação, ambiguidades, suporte, cronologia, replay, fingerprint e ACLs | **8/8 PASS** |
| Transporte: aplicação e histórico exato na mesma transação; segunda aplicação recusada | **PASS**, incluído no teste PostgreSQL |
| Coordenação/API/UI: leitura sem escrita, escopo, autenticação, POST explícito e valores propostos | **5/5 PASS** |
| Inventário canônico e sucessor legítimo do convite E1 | **24/24 PASS** |
| Consultas Passport | **68/68 PASS** |
| Rota/UI Passport, inclusive preservação da correção 404 | **21/21 PASS** |
| Typecheck dashboard, sem incremental | **PASS** |
| Verificação offline do manifesto/transporte e `git diff --check` | **PASS** |

Total: **126 testes aprovados**, sem skips. O SQL foi testado como postgres NOSUPERUSER e service_role no harness nativo existente, PostgreSQL 17.11, loopback aleatório; o cluster foi encerrado e removido. Isso testa esta correção e seus contratos, sem alegar equivalência integral com o runtime Supabase 17.6. Nenhum Docker, instalação ou novo ambiente hospedado foi utilizado.

Um teste do novo transporte detectou alteração de delimitadores `$$` no texto registrado por substituição JavaScript. O empacotador foi corrigido para preservar bytes literais; a comparação SQL exata do histórico passou na execução final. Os testes inicialmente bloqueados por `spawn EPERM` foram executados com a permissão de subprocessos locais; não se tratava de falha do produto.

Comandos reproduzíveis, a partir da raiz E1 salvo indicação:

```powershell
node ops/agent-version-profile-v1/package.mjs --check
node D:/code-guard-governance/node_modules/typescript/bin/tsc --noEmit -p apps/dashboard/tsconfig.json --incremental false
git diff --check
```

No diretório `apps/dashboard`:

```powershell
$env:M16_PG17_BIN='D:/code-guard-governance/out/pgvector-tooling-20261021/pg17-dev/pgsql/bin'
node --conditions=react-server --import tsx --test tests/postgres-m16/technical-profile-mapping.test.ts
node --conditions=react-server --experimental-test-module-mocks --import tsx --test tests/technical-profile-materialization.test.ts tests/m17-migration-chain-contract.test.ts
npm run test:passport
```

## Aplicação, operação e pendências

O [procedimento do pacote](../../../ops/agent-version-profile-v1/README.md) detalha confirmação do destino, backup lógico, manifesto, snapshot de integridade, transporte transacional e recuperação. A consulta `integrity.sql` produz counts/hashes de 25 tabelas do tenant e inventários de histórico/funções, sem exportar conteúdo dos registros. Deve ser comparada antes/depois da DDL, antes da ação do operador.

Após revisão e aplicação autorizada, o operador abre a [revisão da versão real](http://localhost:3101/governance/reviews/review-subject%3Adiscovery%3A94ab3bbabbd6398d3bd25c83ebf875a551854842bcf09437a59cd9ee7718af4f), confere a proposta LangGraph e seu suporte e clica **Materialize technical profile**. Após APPLIED, abre o [Passport com a versão explícita](http://localhost:3101/agents/canonical/canonical-object%3A06b5f654e2b57694e6fd973d42275309a1149313792569ee2e9ed2cfe2eb1d81?version=canonical-object%3A1e85ebd0823bc0355300fa46d0fefaee8c45281658ce27a200feac8e2e4efec1). Technology & Build deve apresentar LangGraph com suporte INFERRED; os demais campos sem evidência continuam UNKNOWN.

**Pendências reais:** revisão do pacote, aprovação/aplicação desta única migração e operação humana autenticada. Ainda não há novo resultado hospedado, materialização real do perfil ou screenshot dessa operação. O patch está pronto; o Passport real só pode ser declarado atualizado depois dessas etapas.

Registro de processo: o comando de handoff exigido pela skill [govia-slice](../../../.agents/skills/govia-slice/SKILL.md), instrução “Generate handoff with `scripts/agent/handoff.mjs`”, foi tentado. O guard recusou gerar o relatório automático com `STOP: Review hosted/deployment scope before proceeding: ops/agent-version-profile-v1/deployment.sql`. O arquivo é um transporte SQL local proposto, expressamente pedido neste escopo; não foi executado. O guard não foi desabilitado nem teve sua classificação contornada. Este relatório registra o resultado e a limitação; nenhum handoff automático foi alegado como aprovado.
