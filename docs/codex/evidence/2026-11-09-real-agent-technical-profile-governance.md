# RepositoryAnalysisAgent — governança do perfil técnico real

Data: 2026-11-09, America/Sao_Paulo. Estado: **PROPOSTA ÍNTEGRA; CICLO BLOQUEADO POR INTEGRAÇÃO E INCOMPATIBILIDADE DE MAPPING**.

## Escopo e resultado

Somente `D:\code-guard-governance\.worktrees\e1-operator-unblock`, branch `fix/e1-operator-unblock`, HEAD `a5f85bf099fdbf0a24f1a369e4428730a042a162`. Banco único consultado: projeto `zkqfvqwqdypgpzauzinw`, nome vinculado `ov-ia-g2-test`, organização funcional `GOVIA_DEMO` (`082ef694-e016-4893-908c-1eef373f53af`). Consultas às 15:04 e 15:09 de 09/11 (São Paulo); os recibos preservam os timestamps UTC exatos.

Foi usada a CLI já autenticada com `--linked`, após conferir o Project ID, pois o MCP Supabase estava indisponível. Todas as consultas foram delimitadas por `BEGIN READ ONLY` / `COMMIT`. Não houve acesso a gov-ia-dev, migração, chamada de materialização, decisão/certificação automática, escrita canônica, alteração de contrato ou reformulação visual. As alterações anteriores do worktree foram preservadas.

**O perfil continua ausente. A autorização/certificação humana da identidade já existe; repetir essa decisão não resolve o impedimento técnico.**

## Proposta e evidências verificadas

- Proposta: `agent-version-technical-profile-proposal:14e70c6d806b1d2dfc5c4d5993ac27967c450a40d0e78688b3bc3235aa80d40f`.
- Candidato: `candidate:agent-version:bfd834e05e6d1579106c5518eca9fd85`.
- AGENT_VERSION: `canonical-object:1e85ebd0823bc0355300fa46d0fefaee8c45281658ce27a200feac8e2e4efec1`.
- Mapping normalizado: `1f4a37e5-0dd6-4809-813e-cec0ab8e2c38`, com vínculo ao AGENT esperado. Não há mapping ativo correspondente na tabela antiga `canonical_object_source_mappings`.

| Campo proposto | Valor | Suporte |
| --- | --- | --- |
| behaviorFingerprint | `sha256 / 1.0 / 01b4e279d914a1e00593de92fd0c1fc3` | 3 assertions e 3 evidências |
| runtimeFrameworkReference | `LangGraph` | 1 assertion e 1 evidência próprias do campo |
| buildReference | UNKNOWN (`NULL`) | Sem suporte |
| entrypointReference | UNKNOWN (`NULL`) | Sem suporte |
| configurationReference | UNKNOWN (`NULL`) | Sem suporte |

A evidência do framework é `evidence:127932415e4d6542a6563af45b87498e`, ligada à assertion homônima `source-assertion:127932415e4d6542a6563af45b87498e`, método `framework-import-declaration`, trust **INFERRED**. Localização: `src/govia_agent_source/agent.py`, linha 10, commit `cfa95f1ade234443435d4bd16c617fc847e35d91`:

```python
from langgraph.graph import StateGraph, START, END
```

Isso sustenta a referência proposta ao framework; não comprova execução em runtime, versão instalada, implantação ou conformidade. Esses fatos não foram inferidos.

O ID da proposta foi recalculado pela fórmula implementada no Discovery. Foram conferidos os hashes canônicos do candidato, das três evidências, das três assertions e da decisão de reconciliação — **8 envelopes válidos**. O suporte de campo é subconjunto do suporte do candidato, sem referências faltantes e no mesmo tenant/origem. As assertions apontam para o mesmo snapshot e hash de conteúdo `7779ea0924dac37f6475b19eade149788d293aaa3dda59b37bf6890c204165d0`, consistente com o commit e a evidência. Essa é uma conferência dos registros capturados; não foi executado novo scan nem download do blob GitHub.

## Fluxo implementado e estado humano existente

O [ADR Technical Profile Persistence V1](../../architecture/ADR-GOVIA-TECHNICAL-PROFILE-PERSISTENCE-v1.md) define: evidência Discovery → proposta tipada pré-canônica → revisão/certificação da versão → reconciliação → materialização da identidade AGENT_VERSION → materialização governada do perfil. Identidade e perfil são persistências distintas; a proposta não é verdade canônica.

Neste caso, os registros atuais demonstram:

1. Proposta durável desde 07/11, sem perfil canônico.
2. Review `review-subject:discovery:94ab3bbabbd6398d3bd25c83ebf875a551854842bcf09437a59cd9ee7718af4f`: `PROPOSED` por regra, depois `CONFIRMED` e **CERTIFIED por HUMAN**, em 08/11 às 20:16 e 20:24, respectivamente (horário de São Paulo).
3. Reconciliação humana `reconciliation-decision:f9e291117ae6ddbd4eb2193a9307297d`, `CREATE_NEW`, em 08/11 às 20:28; ator consistente com a certificação.
4. Materialização da identidade `3b7b48f3-dce8-4402-a828-30a751c4ac95`: **APPLIED**, para o AGENT_VERSION acima.
5. `agent_version_technical_profiles`: **0** registros neste tenant; `agent_version_technical_profile_materializations`: **0**.

O review certificado é o da versão. Não foi inventada uma decisão adicional de aprovação do campo LangGraph nem se tratou a existência da proposta como autorização humana.

## Impedimentos comprovados

**1. Materializador de perfil não está ligado à operação da interface.** O adaptador existente em `apps/dashboard/lib/governance/agent-version-technical-profile-persistence.ts` expõe `materializeAgentVersionTechnicalProfile`, mas não tem chamada/importação no fluxo de comando da aplicação. O botão `Materialize` da revisão chama a materialização da **identidade**, via `triggerMaterialization` e `materialize_object_reconciliation_governed_v1`; não chama a RPC de perfil. O botão também deixa de ser exibido quando a materialização de identidade já existe. Seu replay não completaria o perfil.

**2. O gate de persistência do perfil é incompatível com o vínculo real da versão.** A função hospedada `gov_repo.materialize_agent_version_technical_profile(uuid,text,text,timestamptz)` verifica o vínculo ativo em `canonical_object_source_mappings`; não consulta `canonical_normalized_object_mappings`. Seu hash de corpo é `8754262bf27e47c7b5e502d8f2f9bcd1e18aeb482b3930b30e9f7d8c6759ecdd`. O banco contém somente o mapping normalizado exato para esse candidato/AGENT_VERSION e zero mappings antigos correspondentes. Portanto, o predicado de vínculo exigido não está satisfeito; o caminho falharia com `PROPOSAL_NOT_MAPPED_TO_TARGET`. Não foi chamada a função de escrita, nem em transação de teste.

Criar um mapping antigo, trocar a identidade de origem, repetir CREATE_NEW ou escrever o perfil diretamente seria contorno, não conclusão do fluxo autorizado. Corrigir o gate hospedado exigiria uma alteração versionada em outro escopo; esta tarefa proíbe migrações. Nenhuma migração histórica foi reescrita.

## Ação exata disponível ao operador

Abrir a [revisão da versão](http://localhost:3101/governance/reviews/review-subject%3Adiscovery%3A94ab3bbabbd6398d3bd25c83ebf875a551854842bcf09437a59cd9ee7718af4f), autenticado em GOVIA_DEMO, e conferir **CERTIFIED**, as três evidências e **Materialization applied** da identidade. A evidência do framework é a importação da linha 10 indicada acima.

**Não repetir a certificação/reconciliação nem criar outro objeto. Não existe hoje uma ação funcional de interface para materializar este perfil.** Não há decisão humana pendente na interface atual que resolva os dois impedimentos. O próximo passo é um escopo específico para alinhar o materializador ao mapping governado normalizado e expor sua chamada pela fronteira humana já verificada, preservando os contratos e a autoridade existente. Não foi solicitado ou realizado esse ajuste neste relatório.

Depois dessa correção e de uma operação humana efetiva no fluxo governado, a verificação deve confirmar: perfil APPLIED com origem nesta proposta, suporte por campo preservado, identidade/mapping inalterados e LangGraph em **Technology & Build** somente quando este [AGENT_VERSION estiver selecionado explicitamente](http://localhost:3101/agents/canonical/canonical-object%3A06b5f654e2b57694e6fd973d42275309a1149313792569ee2e9ed2cfe2eb1d81?version=canonical-object%3A1e85ebd0823bc0355300fa46d0fefaee8c45281658ce27a200feac8e2e4efec1). O contexto AGENT lógico não deve herdar automaticamente o framework, e os três campos sem suporte devem continuar UNKNOWN.

O Passport já consulta exclusivamente `agent_version_technical_profiles` e o suporte canônico, não a tabela de propostas. Com o perfil ausente, Technology & Build permanece corretamente **UNKNOWN**; não houve atualização alegada como concluída.

## Verificações

- Integridade do caso real: PASS — proposal ID, 8 envelopes, suporte, tenant/origem, snapshot/commit, cadeia humana e materialização da identidade.
- Testes existentes de perfil SQL e consultas Passport: **100/100 PASS** (32 estáticos + 68 consultas).
- Discovery Technical Profile Persistence V1: **7/7 PASS**, inclusive ausência de materialização/certificação automática.
- Dashboard typecheck, `--incremental false`: PASS. `git diff --check`: PASS.
- Não foi executado teste de escrita no banco hospedado. Os testes estáticos aprovados validam o gate antigo; seu PASS não prova compatibilidade com este mapping normalizado real.
- Não houve alteração de código de produção ou visual nesta sessão. Os únicos arquivos novos de entrega são este relatório e seu recibo sanitizado; SQLs e capturas locais ficam em `.artifacts/agent/profile-*`.

**Resultado: investigação e preparação concluídas; materialização técnica e atualização do Passport não concluídas, devido aos dois impedimentos acima.**
