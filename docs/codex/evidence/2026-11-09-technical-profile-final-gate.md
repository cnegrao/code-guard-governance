# Gate final — APTO

Parecer técnico: **APTO para aplicação controlada de uma única migração**, versão `20261109191942`, exclusivamente no projeto `zkqfvqwqdypgpzauzinw` / GOVIA_DEMO. Não é autorização nem alegação de aplicação: **a migração e a materialização não foram executadas neste gate**.

Escopo: `ops/agent-version-profile-v1`, integração do cartão de perfil na revisão, adaptador/rota/coordenador e dependências diretas. Worktree `D:\code-guard-governance\.worktrees\e1-operator-unblock`, branch `fix/e1-operator-unblock`, HEAD `a5f85bf099fdbf0a24f1a369e4428730a042a162`. Nenhum arquivo do pacote ou da implementação foi alterado durante a revisão. Mudanças E1 anteriores foram preservadas. Não houve acesso a gov-ia-dev.

## Resultado dos seis critérios

| Critério | Parecer e fundamento |
| --- | --- |
| Mapping, candidato e versão exatos | PASS. Org, candidato integral, envelope/origem, kind AGENT_VERSION, identidade normalizada, alvo, decisão autora e pai AGENT devem coincidir. Um mapping normalizado inválido não permite fallback histórico. Múltiplos vínculos/autorizações são recusados. O caminho histórico exige a decisão autora para o mesmo candidato/alvo; não basta caminho ou nome coincidente. |
| Autorização humana e permissões | PASS. Cadeia de review CERTIFIED por HUMAN, reconciliação HUMAN e identidade APPLIED, com cronologia e cobertura do suporte da proposta. Wrapper reutiliza o guard M16 com os cinco campos do principal verificado no servidor. A API ignora coordenadas do corpo; GET não escreve, POST só no evento explícito. Não há novo certificado automático. As ACLs não são byte a byte iguais: a mudança deliberada fecha escrita direta nos quatro stores e execução raw por service_role, preserva leitura e concentra a escrita na fronteira governada. EXECUTE do novo definer é restrito a postgres/service_role, com postflight que aborta se houver concessões inesperadas. |
| Evidências, fingerprint e INFERRED | PASS. A migração não atualiza evidências, assertions, trust, decisões ou propostas. Materialização copia referências de suporte por campo após validar sua cobertura. Fingerprint e proposta de origem nunca entram no UPDATE do upsert; conflito de fingerprint falha. LangGraph continua uma referência sustentada por evidência INFERRED, sem alegação de runtime observado, controle ou conformidade. |
| Replay, FK e ON CONFLICT | PASS. Alvo e candidato são bloqueados; replay retorna antes da gravação. Primeira linha do perfil precede a inserção dos suportes exigidos pela FK; o upsert usa a constraint `agent_version_technical_profiles_pkey`. Revisão inicial 0, enriquecimento monotônico, suporte em união e revisão sem incremento no replay. O transporte também recusa migração já registrada. |
| Efeitos sobre outros objetos | PASS. Nenhum INSERT/UPDATE/DELETE em canonical_objects, mappings, relações ou decisões. O comando só pode projetar o perfil do AGENT_VERSION validado, seus dois suportes, recibo e outbox. A DDL altera a implementação específica, cria seu wrapper e restringe essas escritas; nenhuma função gerenciada Supabase é alterada. Não cria relação formal nem herança do framework pelo AGENT lógico. |
| Hash, testes e histórico | PASS. Verificação offline do pacote aprovada sem regeneração; histórico hospedado comparado aos 100 recibos anteriores, sem diferenças de versão/nome/conteúdo. Corpo anterior exato, dependência M16 e mapping presentes; nova migração/wrapper ausentes. As evidências de 126 testes e typecheck anteriores continuam aplicáveis aos arquivos fixados no manifesto, que não mudaram. Não foi repetida regressão completa. |

## Conferência atual do projeto de testes

O conector Supabase retornou indisponibilidade; a leitura foi feita pela CLI instalada, `db query --linked`, após conferir que `supabase/.temp/project-ref` é exatamente `zkqfvqwqdypgpzauzinw`. SQL executado com `BEGIN READ ONLY`/`COMMIT`; nenhum comando de aplicação ou RPC de materialização foi chamado.

Resultado obtido:

```json
{
  "project_link": "zkqfvqwqdypgpzauzinw",
  "database": "postgres",
  "user": "postgres",
  "org": "GOVIA_DEMO",
  "history_count": 100,
  "history_differences": [],
  "new_version_absent": true,
  "raw_previous_match": true,
  "guard_exists": true,
  "wrapper_absent": true,
  "normalized_mapping_exists": true,
  "profile_count": 0,
  "profile_user_triggers": []
}
```

Comparação do histórico: 75 registros do baseline preservado e 25 variantes M16/M17 já aplicadas, incluindo a migração legítima de convite no inventário anterior. Esta comparação foi somente leitura; não houve repair nem reaplicação. Consulta local de conferência: `.artifacts/agent/profile-final-gate.sql`, SHA-256 `63751e9aca25eb1373cf2ebf96a8f5ea79d2c1934235cb753f5cde691bc46a74`.

## Artefatos e evidências reutilizadas

- SQL proposto: `ops/agent-version-profile-v1/20261109191942_agent_version_technical_profile_governed_mapping_v1.sql`, SHA-256 `9c22c983eb1cd9cd48329b7d153b555de48ba2c4475ffe7b5eb70f55726e60a6`.
- Transporte único: `ops/agent-version-profile-v1/deployment.sql`, SHA-256 `477f6b8dccb1a316c0e32bb376ed22fc29ddd8693c6add2a8a8108e9d50d9aab`.
- Corpo anterior exigido: `8754262bf27e47c7b5e502d8f2f9bcd1e18aeb482b3930b30e9f7d8c6759ecdd`, confirmado no banco.
- [Relatório do patch e testes](2026-11-09-technical-profile-materialization-patch.md): 8 testes PostgreSQL, 5 integração, 24 inventário, 68 consultas Passport e 21 rota/UI = **126 PASS**, typecheck PASS. O teste PostgreSQL comprovou também histórico com SQL exato e rejeição da segunda aplicação. Esses testes não foram apresentados como nova execução hospedada.
- [Evidência real de governança](2026-11-09-real-agent-technical-profile-governance.md): proposta, envelopes, certificação/reconciliação e suporte do fato LangGraph. Não foi reaberta a auditoria completa do Discovery.

## Procedimento direto — somente na próxima execução autorizada

1. Preservar backup lógico consistente e legível imediatamente antes da alteração, reutilizando o procedimento já comprovado. Pausar escritas concorrentes de governança durante a captura e a aplicação. Com a conexão administrativa comprovadamente ligada ao projeto autorizado, capturar todos os resultados de `ops/agent-version-profile-v1/integrity.sql` por psql, como `before`; guardar em local privado. Não usar cookies, credenciais em argumentos ou logs, Docker, branches ou outros ambientes.
2. Na raiz E1, executar a sequência abaixo **apenas depois da aprovação para aplicar**. A CLI está instalada e seu comando foi conferido neste gate. O primeiro bloco verifica arquivos; a última chamada é a aplicação futura, que não foi executada nesta revisão.

```powershell
Set-Location -LiteralPath 'D:\code-guard-governance\.worktrees\e1-operator-unblock'
if ((Get-Content -LiteralPath 'supabase/.temp/project-ref' -Raw).Trim() -ne 'zkqfvqwqdypgpzauzinw') {
  throw 'TARGET_MISMATCH'
}
node ops/agent-version-profile-v1/package.mjs --check
if ($LASTEXITCODE -ne 0) { throw 'PACKAGE_HASH_MISMATCH' }
$env:NODE_USE_SYSTEM_CA='1'
& D:/code-guard-governance/node_modules/.bin/supabase.cmd db query --linked --file ops/agent-version-profile-v1/deployment.sql --output json
if ($LASTEXITCODE -ne 0) { throw 'STOP_PROFILE_MIGRATION_FAILED' }
```

Aplicar **somente esse transporte**. Ele contém uma migração e registra versão/nome/SQL exato em `supabase_migrations.schema_migrations` no mesmo COMMIT. Não executar também o arquivo de migração isolado, `db push`, migration repair, nem as 25 migrações anteriores. Erro em qualquer preflight/postflight aborta a transação; confirmar rollback antes de qualquer nova ação.

3. Reexecutar `integrity.sql` via psql e comparar `before/after`, antes de materializar o perfil. Todos os hashes/counts de domínio devem permanecer iguais; o histórico passa de 100 para 101, com uma única entrada nova. Confirmar o novo wrapper, ACLs fechadas, corpo corrigido e nenhum perfil criado pela DDL. Conservar recibos da aplicação. O SQL aprovado deve ser posteriormente incorporado ao inventário do repositório com os mesmos bytes, como sucessor novo; não alterar migrações ou checkpoints históricos. A inclusão de uma nova função definer deve ser explícita em inventários futuros de capacidades.
4. Com a aplicação E1/3101 usando este patch, o operador GOVERNANCE_ADMIN de GOVIA_DEMO abre a [revisão da versão](http://localhost:3101/governance/reviews/review-subject%3Adiscovery%3A94ab3bbabbd6398d3bd25c83ebf875a551854842bcf09437a59cd9ee7718af4f). Confere CERTIFIED, identidade APPLIED e proposta LangGraph `agent-version-technical-profile-proposal:14e70c6d806b1d2dfc5c4d5993ac27967c450a40d0e78688b3bc3235aa80d40f`; confere suporte INFERRED da importação em `src/govia_agent_source/agent.py:10`, commit `cfa95f1ade234443435d4bd16c617fc847e35d91`. Clica **Materialize technical profile** uma vez. A certificação existente é reutilizada somente se a revalidação transacional comprovar a cobertura exata; uma rejeição deve ser investigada, nunca suprida por decisão artificial.
5. Após APPLIED, abrir o [Passport com AGENT_VERSION explícito](http://localhost:3101/agents/canonical/canonical-object%3A06b5f654e2b57694e6fd973d42275309a1149313792569ee2e9ed2cfe2eb1d81?version=canonical-object%3A1e85ebd0823bc0355300fa46d0fefaee8c45281658ce27a200feac8e2e4efec1) e verificar Technology & Build: LangGraph com proveniência/suporte existentes; campos sem evidência continuam UNKNOWN. O AGENT lógico não deve herdar o framework.

**Impedimentos técnicos identificados: nenhum no escopo revisado.** Aplicação, comparação pós-DDL e ação humana continuam pendentes por determinação do usuário. O bloqueio anterior do gerador automático de handoff por classificar o nome `deployment.sql` como escopo de implantação permanece registrado no relatório do patch; nenhum guard foi desabilitado. Essa classificação de processo não representa defeito da função nem autorização de implantação.
