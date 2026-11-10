# Passport — rastreabilidade do perfil técnico concluída

**Patch implementado, 105 testes aprovados e validação com registros reais aprovada. Nenhuma alteração no banco.**

Worktree `D:\code-guard-governance\.worktrees\e1-operator-unblock`, branch `fix/e1-operator-unblock`, HEAD `a5f85bf099fdbf0a24f1a369e4428730a042a162`. A sessão continuou sobre as mudanças E1 existentes; nenhuma foi descartada ou publicada. Não houve commit, push, deploy, migração, criação de decisão/certificação, chamada de materialização ou acesso a gov-ia-dev.

## Causa e comportamento corrigido

A projeção anterior lia `agent_version_technical_profiles`, proposta de origem e suporte por campo, mas não lia os recibos de materialização nem a certificação humana. O detalhe genérico exibia `Decision: UNKNOWN`, embora a governança da versão estivesse persistida. Simplesmente copiar a decisão da identidade para o campo seria incorreto.

O novo leitor recupera, por identificadores completos e no mesmo tenant: recibo APPLIED → proposta tipada → candidato Discovery → mapping exato → reconciliação da identidade → invocação/review → eventos históricos CERTIFIED por HUMAN. A interface apresenta certificação, reconciliação da identidade e materialização técnica em blocos separados, com IDs, atores e horários próprios. O candidato, finding, origem, proposta e AGENT_VERSION permanecem identificáveis.

As assertions e evidências exibidas continuam sendo as do **campo**. O leitor de auditoria não importa o suporte mais amplo da decisão de identidade, não promove trust e não inventa uma aprovação individual. A interface declara: **Individual field approval: UNKNOWN** e explica que a certificação é do review da versão e a reconciliação é de sua identidade canônica.

O escopo preserva as 16 famílias, a seleção explícita da versão, o fingerprint e os campos ausentes UNKNOWN. A família Technology & Build e a família Provenance & Trust reutilizam a mesma proveniência projetada. O AGENT lógico não herda os fatos da versão.

## Integridade e isolamento

- Todas as novas leituras passam pelo `passportReader`, com `organisation_id` obrigatório, conferência do tenant nas linhas retornadas, paginação estável e projeções escalares explícitas.
- Nenhum envelope bruto de candidato, evidência, fornecedor ou Prompt é selecionado para reconstruir fatos.
- Mapping normalizado exige candidato integral, tipo AGENT_VERSION, alvo, identidade normalizada e origem exatos. O histórico exige a decisão autora para o mesmo candidato e versão; coincidência de caminho não basta.
- A validade do mapping histórico é avaliada no instante da materialização. Um mapping encerrado posteriormente não apaga sua proveniência histórica.
- Eventos de certificação posteriores à reconciliação não são substituídos na cadeia anterior. Não há seleção implícita de último evento/proposta/recibo.
- A proposta de origem e outras propostas efetivamente aplicadas são mostradas separadamente. Ausência de registro é UNKNOWN; erro de armazenamento continua erro. Vínculos contraditórios falham com `PASSPORT_PROFILE_LINEAGE_INVALID`.
- O novo DTO é exclusivamente de apresentação em `apps/dashboard`; nenhum contrato canônico foi modificado.

## Validação real

Projeto exclusivo `zkqfvqwqdypgpzauzinw`, organização `082ef694-e016-4893-908c-1eef373f53af` / GOVIA_DEMO. A consulta inicial foi SQL `BEGIN READ ONLY`; a validação do leitor de produção usou somente SELECTs pelo adaptador Supabase. Não foram criadas sessões, inventados principals para RPCs governadas ou exportados cookies.

O perfil já havia sido materializado pelo operador em **09/11/2026 às 20:29:16 de São Paulo**. Esta tarefa apenas recuperou e apresentou os registros existentes:

| Etapa | Registro comprovado |
| --- | --- |
| AGENT | `canonical-object:06b5f654e2b57694e6fd973d42275309a1149313792569ee2e9ed2cfe2eb1d81` |
| AGENT_VERSION | `canonical-object:1e85ebd0823bc0355300fa46d0fefaee8c45281658ce27a200feac8e2e4efec1` |
| Candidato Discovery | `candidate:agent-version:bfd834e05e6d1579106c5518eca9fd85` |
| Proposta técnica | `agent-version-technical-profile-proposal:14e70c6d806b1d2dfc5c4d5993ac27967c450a40d0e78688b3bc3235aa80d40f` |
| Evidência do framework | `evidence:127932415e4d6542a6563af45b87498e` |
| Certificação humana | `review-transition:867dc36411d9046e14a6164ac91e142d`, ocorrida em `2026-11-08T23:24:03.182+00:00` |
| Reconciliação da identidade | `reconciliation-decision:f9e291117ae6ddbd4eb2193a9307297d`, CREATE_NEW em `2026-11-08T23:28:23.391+00:00` |
| Mapping | `1f4a37e5-0dd6-4809-813e-cec0ab8e2c38` |
| Recibo técnico | `ceb7f82b-3207-4a1f-8374-24df028fb403`, APPLIED em `2026-11-09T23:29:16.741+00:00` |

O novo leitor recuperou essa cadeia sem lacunas. O componente de produção `Provenance` foi renderizado localmente com esses dados reais e o suporte original do campo. O HTML contém os três eventos separados, os identificadores corretos, INFERRED e a ressalva de aprovação individual UNKNOWN. A linha do perfil foi comparada com a leitura anterior: valores, fingerprint, origem, revisão e horários permaneceram iguais.

Essa prova é uma renderização de servidor do detalhe de proveniência com dados reais; **não é uma captura de navegador autenticado nem um teste de ponta a ponta da sessão do operador**. A autenticação da página permanece no fluxo existente e está coberta pelos testes de rota. O [recibo sanitizado](2026-11-09-passport-profile-provenance.json) registra o escopo, os IDs, hashes dos sete arquivos e hash do HTML privado, sem credenciais.

## Arquivos do patch

1. `apps/dashboard/lib/governance/passport-profile-provenance.ts` — novo leitor da cadeia de auditoria.
2. `apps/dashboard/lib/governance/passport-read-store.ts` — tabelas/colunas escalares e paginação estável por invocation_id.
3. `apps/dashboard/lib/governance/agent-passport.ts` — DTO de apresentação da cadeia.
4. `apps/dashboard/lib/governance/passport-query.ts` — composição da proveniência no perfil selecionado, calculada uma vez e reutilizada por campo.
5. `apps/dashboard/components/agents/AgentPassport.tsx` — blocos separados, ressalva de autoridade e acesso ao review certificado.
6. `apps/dashboard/tests/passport-query.test.ts` — rastreabilidade, isolamento, vínculos incorretos, histórico, ausência de dados e preservação do suporte.
7. `apps/dashboard/tests/passport-ui-route.test.ts` — renderização dos três estágios, UNKNOWN e INFERRED.

O último arquivo também contém a correção 404 anterior, preservada. Nenhuma outra alteração E1 foi incorporada a este escopo.

## Testes executados

| Verificação | Resultado final |
| --- | --- |
| Passport query | **82/82 PASS**, incluindo 14 novos casos |
| Passport UI/route | **23/23 PASS**, incluindo 2 novos casos |
| Total | **105 PASS, 0 falhas, 0 skips** |
| Dashboard typecheck, `--incremental false` | **PASS** |
| Novo leitor + componente de proveniência com registros reais | **PASS** |
| `git diff --check` | **PASS** |
| Diff de migrações históricas e packages/canonical-contracts | **Nenhum** |

```powershell
# Em apps/dashboard
npm run test:passport

# Na raiz E1
node D:/code-guard-governance/node_modules/typescript/bin/tsc --noEmit -p apps/dashboard/tsconfig.json --incremental false
git diff --check
```

Um erro de nulabilidade do ator no novo código foi corrigido após sua validação explícita; o typecheck final passou. Nenhuma falha de requisito foi mascarada como UNKNOWN. Não houve repetição de auditoria de infraestrutura ou execução SQL de escrita.

## Conferência pelo operador e encerramento

Atualizar o [Passport com esta versão explicitamente selecionada](http://localhost:3101/agents/canonical/canonical-object%3A06b5f654e2b57694e6fd973d42275309a1149313792569ee2e9ed2cfe2eb1d81?version=canonical-object%3A1e85ebd0823bc0355300fa46d0fefaee8c45281658ce27a200feac8e2e4efec1). Em Technology & Build → runtimeFrameworkReference: LangGraph, abrir **Source, trust and provenance**. A cadeia aparece em **Technical profile governance chain**, com certificação humana, reconciliação da identidade e recibo técnico separados; o suporte INFERRED está abaixo. Nenhuma nova certificação ou materialização é necessária.

Registro de processo: foi preservada a sessão E1 existente, sem alegar preflight limpo novo. A skill [govia-slice](../../../.agents/skills/govia-slice/SKILL.md) instrui “Generate handoff with `scripts/agent/handoff.mjs`”; a recusa anterior desse gerador por classificar o artefato preservado `ops/agent-version-profile-v1/deployment.sql` como escopo de implantação permanece documentada. Não se repetiu a tentativa sem nova hipótese nem se desabilitou o guard. O checkpoint específico desta tarefa está em `.artifacts/agent/passport-profile-provenance-handoff.json`, explicitamente manual, e este relatório registra o resultado.

**Correção concluída. Nenhuma ação de banco, migração ou governança pendente para este patch. Execução encerrada após a entrega.**
