# Correção do perfil técnico aplicada — aguardando ação humana

**Uma migração aplicada e verificada. Histórico: 100 → 101. Nenhum perfil foi materializado automaticamente.**

Destino exclusivo `zkqfvqwqdypgpzauzinw`, GOVIA_DEMO; worktree `D:\code-guard-governance\.worktrees\e1-operator-unblock`, branch `fix/e1-operator-unblock`, HEAD `a5f85bf099fdbf0a24f1a369e4428730a042a162`. Carlos autorizou expressamente esta aplicação após o gate APTO. Não houve acesso a gov-ia-dev, aplicação de outras migrações, recertificação, criação de evidências ou escrita direta em dados de governança.

## Aplicação

- Versão: `20261109191942`, nome `agent_version_technical_profile_governed_mapping_v1`.
- Transporte único executado: `ops/agent-version-profile-v1/deployment.sql`, sem alterações, pela CLI vinculada ao projeto autorizado.
- SHA-256 do SQL de origem: `9c22c983eb1cd9cd48329b7d153b555de48ba2c4475ffe7b5eb70f55726e60a6`.
- SHA-256 do transporte: `477f6b8dccb1a316c0e32bb376ed22fc29ddd8693c6add2a8a8108e9d50d9aab`.
- Execução em 09/11/2026, **22:51:40–22:51:45 UTC** (19:51 de São Paulo), exit code 0; preflights e postflights transacionais passaram.
- Exatamente uma entrada nova no histórico; as 100 anteriores permaneceram iguais. Nome, versão e hash do SQL armazenado conferem com o pacote aprovado.

`package.mjs --check` passou antes da aplicação e na verificação posterior. Os bytes do pacote auditado, inclusive seu manifesto de preparação, foram preservados; o estado efetivamente aplicado é registrado neste recibo e no histórico hospedado. Nenhuma migração histórica foi modificada. Não foi usado db push, migration repair nem reaplicação de M16/M17.

## Backup e preservação

Foi produzido novo backup lógico consistente imediatamente antes da correção, usando um snapshot REPEATABLE READ READ ONLY compartilhado pelo dump completo, exportação crítica e inventário. Inclui esquema, dados e as 100 entradas de histórico. Roles/ACLs foram exportadas separadamente, sem senhas de roles.

- Dump completo: **5.548.859 bytes**, SHA-256 `656dc0033039543b78b633915d16910540f40b05fdf7db628bd7f999eae3f46a`.
- Exportação crítica de dados de **198 tabelas gov_repo**: 417.194 bytes, SHA-256 `59cea09084c3ece1747bd116c73493f799ac16670d5dfdd2634b8b9a51e98506`.
- Ambos os arquivos foram inventariados e integralmente lidos/descomprimidos com pg_restore em SQL privado, sem executar restauração. O histórico e todas as entradas de dados críticos foram conferidos.
- Snapshot: `0000002A-000007C2-1`; leitura verificada em `2026-11-09T22:36:37.994Z`.
- Oito arquivos do backup tiveram seus hashes revalidados antes e depois da migração. Diretório privado com ACL NTFS limitada ao executor e SYSTEM; nenhum conteúdo de dados foi publicado.

Evidências privadas: `D:/code-guard-governance/.worktrees/e1-operator-unblock/.artifacts/agent/technical-profile-apply-2026-11-09T22-35-56-926Z`. O [recibo sanitizado](2026-11-09-technical-profile-applied.json) publica apenas metadados, hashes e resultados. Os clientes PostgreSQL já instalados foram reutilizados; nenhum Docker ou ambiente alternativo foi provisionado.

`integrity.sql` foi executado antes e depois, via psql, capturando todos os seus resultados. Comparações aprovadas:

| Controle | Resultado |
| --- | --- |
| Todas as tabelas de domínio gov_repo | **198/198**, counts e hashes integrais iguais ao backup/baseline |
| Tabelas do recorte Passport/governança em integrity.sql | **25/25**, counts e hashes iguais |
| AGENT e AGENT_VERSION conhecidos | **2/2**, preservados com tipos e identidades exatos |
| Mappings normalizados/históricos, evidências, assertions, revisões e decisões | Preservados, incluídos na comparação integral |
| Review da versão | **CERTIFIED**, sem nova transição humana |
| Proposta existente | LangGraph, mesmo candidato e mesma versão |
| Perfis técnicos / recibos de perfil GOVIA_DEMO | **0 / 0** após a DDL |

A presença de 198 tabelas atuais é o inventário efetivo após o alinhamento M16/M17 anterior, não uma suposição do inventário inicial de 132 tabelas.

## Funções e segurança

O corpo da implementação invoker e o corpo do novo wrapper foram comparados por hash com o SQL aprovado. O wrapper existe como SECURITY DEFINER, owner postgres, search_path fechado e lock_timeout. service_role pode executar o wrapper, mas não a implementação raw; anon e authenticated não podem executar o wrapper. Os quatro stores canônicos do perfil preservam SELECT para service_role e recusam DML direto. As verificações não chamaram as funções de materialização.

## Testes após aplicação

- Integração da revisão/API/UI e inventário canônico: **29/29 PASS**.
- Consultas Passport: **68/68 PASS**.
- Rota e UI Passport, inclusive correção 404: **21/21 PASS**.
- SQL do materializador e transporte/histórico no harness PostgreSQL existente: **8/8 PASS**; cluster local de teste encerrado e removido. Fixtures somente no teste isolado, nunca no Supabase.
- Total desta execução: **126 PASS, 0 falhas, 0 skips**.
- Dashboard typecheck com `--incremental false`: **PASS**.

Nenhum teste de escrita do perfil foi executado no banco hospedado. A aplicação dessa função à proposta real aguarda exclusivamente a operação humana.

## Disponibilidade da ação e limite da verificação

O coordenador de leitura de produção `getReviewTechnicalProfile`, consultando o projeto autorizado com os dados reais, retornou:

```json
{
  "status": "READY",
  "proposalId": "agent-version-technical-profile-proposal:14e70c6d806b1d2dfc5c4d5993ac27967c450a40d0e78688b3bc3235aa80d40f",
  "canonicalVersionId": "canonical-object:1e85ebd0823bc0355300fa46d0fefaee8c45281658ce27a200feac8e2e4efec1",
  "values": {
    "runtimeFrameworkReference": "LangGraph",
    "buildReference": null,
    "entrypointReference": null,
    "configurationReference": null
  }
}
```

READY é a condição que apresenta **Materialize technical profile** no cartão da revisão. Essa foi uma leitura administrativa do mesmo coordenador usado pelo GET da interface; não foi criada sessão para representar o operador. Não houve inspeção visual autenticada, exportação de cookie ou POST. A aplicação responde em `http://localhost:3101`: login 200; revisão e endpoint de perfil sem sessão redirecionam 307 para `/login`, conforme o middleware existente. A rota isolada continua coberta pelos testes de autenticação.

Foram corrigidas apenas expectativas da instrumentação local: o acesso direto ao projeto usa login temporário CLI, não usuário de pooler; e o middleware redireciona a API sem cookie antes que sua rota possa responder 401. Nenhum controle de autorização foi flexibilizado. A tentativa de iniciar outro servidor encontrou EADDRINUSE; a aplicação já disponível foi mantida, sem parar ou substituir processos. A enumeração CIM não confirmou um PID para a porta, embora as consultas HTTP tenham respondido; não se alega novo processo iniciado com sucesso.

## Próxima ação — somente o operador humano

Abrir, autenticado como GOVERNANCE_ADMIN de GOVIA_DEMO, a [revisão certificada da versão](http://localhost:3101/governance/reviews/review-subject%3Adiscovery%3A94ab3bbabbd6398d3bd25c83ebf875a551854842bcf09437a59cd9ee7718af4f).

Conferir CERTIFIED, identidade APPLIED, proposta LangGraph e suporte INFERRED da importação `src/govia_agent_source/agent.py:10`, commit `cfa95f1ade234443435d4bd16c617fc847e35d91`. Então clicar uma vez em **Materialize technical profile**. Não repetir certificação, reconciliação ou criação da identidade.

Após APPLIED, verificar o [Passport com a versão explicitamente selecionada](http://localhost:3101/agents/canonical/canonical-object%3A06b5f654e2b57694e6fd973d42275309a1149313792569ee2e9ed2cfe2eb1d81?version=canonical-object%3A1e85ebd0823bc0355300fa46d0fefaee8c45281658ce27a200feac8e2e4efec1). Technology & Build deve apresentar LangGraph com a proveniência existente, mantendo INFERRED; campos sem evidência continuam UNKNOWN. O contexto AGENT lógico não herda o framework.

**Execução encerrada. Aguardando o clique humano; a materialização real do perfil e sua apresentação como fato no Passport ainda não foram alegadas como concluídas.**
