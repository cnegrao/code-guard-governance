# Correção proposta do perfil técnico — revisão antes da aplicação

Destino único: `zkqfvqwqdypgpzauzinw`, GOVIA_DEMO. **Nada deste pacote foi aplicado no banco hospedado.** O empacotador é exclusivamente offline; não possui comando de implantação nem utiliza credenciais. A migração fica fora de `supabase/migrations` enquanto aguarda revisão. Não executar `db push`, reparar o histórico em massa ou reaplicar M16/M17 para instalar esta correção.

## Contrato e causa

O materializador histórico só reconhecia `canonical_object_source_mappings`. A versão real tem um vínculo exato em `canonical_normalized_object_mappings`. Além disso, faltava a ação de interface para materializar o perfil após a identidade. O ensaio SQL identificou dois defeitos na primeira gravação: suporte inserido antes do perfil exigido pela FK e `ON CONFLICT` ambíguo com a coluna de retorno. Esta correção preserva a revisão inicial 0, a imutabilidade do fingerprint e o replay sem efeitos adicionais.

O vínculo normalizado exige o candidato integral, tenant, AGENT_VERSION, identidade normalizada, origem completa, pai AGENT e a decisão autora. Se houver mapping normalizado inválido, não ocorre fallback para o histórico. O histórico só é aceito com origem completa e decisão humana autora para o mesmo candidato e alvo. Ambiguidades são recusadas; nenhuma relação canônica formal é criada.

A autorização exige certificação humana do review exato, reconciliação humana aplicada para a versão e proposta anterior à certificação, com todas as assertions/evidências abrangidas pela decisão. A evidência anterior do caso real está em `docs/codex/evidence/2026-11-09-real-agent-technical-profile-governance.md`. Não há certificado independente do campo no contrato vigente: a cadeia certificada e reconciliada é a autorização. Propostas posteriores ou suportes não abrangidos são recusados; devem voltar ao fluxo humano legítimo, sem inventar nova decisão ou alterar a anterior.

A RPC pública de aplicação passa pela mesma fronteira M16 de principal verificado, sessão, credential epoch e GOVERNANCE_ADMIN. O wrapper SECURITY DEFINER tem owner postgres, search_path fechado, lock_timeout e EXECUTE apenas postgres/service_role. A implementação invoker e as quatro tabelas de projeção deixam de admitir escrita direta por service_role. A gravação de propostas permanece inalterada. Esta é uma adição explícita de uma função definer; futuros inventários fechados de capacidades devem reconhecer exatamente esta assinatura após revisão, sem exceções por schema e sem reescrever os inventários históricos.

## Preparação e aplicação futura pelo responsável autorizado

1. Revisar SQL, integração e manifest; aprovar expressamente a aplicação deste pacote. O estado desta entrega é **aguardando revisão**, não aplicação autorizada.
2. No worktree E1 executar `node ops/agent-version-profile-v1/package.mjs --check`. Conferir o vínculo local `supabase/.temp/project-ref` e a conexão administrativa: ambos devem identificar exclusivamente `zkqfvqwqdypgpzauzinw`. O projeto não pode ser comprovado apenas por `current_database()`, pois bancos Supabase compartilham esse nome. Não usar credenciais do navegador. Não estabelecer conexão se o endpoint/projeto divergirem.
3. Pausar outras escritas de governança durante a janela. Reutilizar o procedimento de backup lógico consistente e leitura do arquivo já comprovado na execução M16/M17, com nova captura imediatamente antes da correção. Preservar esquema, dados, roles/ACLs e histórico em local privado; validar leitura e hashes. Não exportar credenciais nos recibos.
4. Executar `integrity.sql` na conexão aprovada e guardar JSON privado como `before`. Conferir a proposta e a certificação do caso real; o perfil ainda pode estar ausente. Conferir histórico e ausência da versão `20261109191942`. A ausência do corpo anterior esperado, do guard M16 ou do schema necessário é divergência: parar, não adaptar manualmente.
5. Depois da aprovação, aplicar **somente `deployment.sql`**, com o cliente PostgreSQL já instalado, `psql -X -v ON_ERROR_STOP=1 -f ops/agent-version-profile-v1/deployment.sql`, e conexão autenticada previamente conferida, usando o papel administrativo postgres. Não pôr senha em argumentos, logs ou documentação. O transporte conserva o SQL proposto e acrescenta lock, guarda de organização e histórico atômico. Não executar separadamente o arquivo de migração e o transporte.
6. A transação valida o corpo anterior, substitui somente a função, adiciona o wrapper e fecha as escritas diretas. Os postflights de ACL e o registro exato em `supabase_migrations.schema_migrations` pertencem ao mesmo COMMIT. Qualquer falha aborta a transação: fechar a conexão e confirmar ausência da versão; não ignorar erros nem usar migration repair para simular sucesso.
7. Reexecutar `integrity.sql` antes de qualquer ação de materialização: todos os counts/hashes das tabelas de domínio devem ser iguais a `before`. A única mudança de dados esperada nesta fase é a linha nova do histórico. Conferir o novo wrapper, a negação da RPC raw a service_role/anon/authenticated, a ausência de DML direto nos quatro stores e a ausência de alteração em funções Supabase gerenciadas. Registrar recibo com hashes, histórico e resultado sem conteúdo sensível.
8. Carregar a aplicação com este patch no worktree E1, porta 3101. O GET/render só consulta. A materialização exige a ação humana descrita abaixo e repete todos os gates no banco. Não promover, publicar ou fazer deploy nesta entrega.

## Ação exata do operador

Abrir autenticado como GOVERNANCE_ADMIN de GOVIA_DEMO:

`http://localhost:3101/governance/reviews/review-subject%3Adiscovery%3A94ab3bbabbd6398d3bd25c83ebf875a551854842bcf09437a59cd9ee7718af4f`

Conferir CERTIFIED e identidade APPLIED. No cartão **Technical profile · AgentVersion**, conferir o identificador da proposta `agent-version-technical-profile-proposal:14e70c6d806b1d2dfc5c4d5993ac27967c450a40d0e78688b3bc3235aa80d40f`, a versão `canonical-object:1e85ebd0823bc0355300fa46d0fefaee8c45281658ce27a200feac8e2e4efec1`, LangGraph proposto e demais campos UNKNOWN. Conferir a evidência da importação em `src/govia_agent_source/agent.py:10`, commit `cfa95f1ade234443435d4bd16c617fc847e35d91`, trust INFERRED. Então clicar uma vez em **Materialize technical profile**. Não repetir certificação, reconciliação ou criação da identidade. Se houver rejeição de autorização/vínculo, parar e registrar o erro; não alterar dados para liberar o botão.

Confirmar **Technical profile applied**. Abrir o Passport com a versão explícita:

`http://localhost:3101/agents/canonical/canonical-object%3A06b5f654e2b57694e6fd973d42275309a1149313792569ee2e9ed2cfe2eb1d81?version=canonical-object%3A1e85ebd0823bc0355300fa46d0fefaee8c45281658ce27a200feac8e2e4efec1`

Technology & Build deve mostrar LangGraph com a proveniência e suporte existentes, mantendo INFERRED. Build, entrypoint e configuration continuam UNKNOWN. O contexto AGENT lógico não herda o framework. Ausência de risco, controle ou conformidade comprovada permanece UNKNOWN. Repetir a mesma chamada autorizada deve ser replay, sem nova revisão, suporte, recibo ou evento. A correção de URL 404 continua coberta pelos testes de rota.

## Recuperação e limites

Antes do COMMIT, a transação inteira é revertida em erro. Depois do COMMIT, não oferecer rollback que reabra a escrita direta insegura: suspender o POST/ação no aplicativo e preparar correção versionada após diagnóstico. Não apagar perfil ou recibos já produzidos. Recuperação de desastre usa o backup lógico preservado sob autorização específica, sem substituir dados após novas decisões humanas. O pacote não aplica restauração, DROP ou exclusão de dados.

Os testes usam o harness PostgreSQL 17 já existente e fixtures apenas no cluster descartável. Não constituem reprodução integral do Supabase hospedado. A aplicação hospedada e a validação autenticada do caso real continuam pendentes de revisão e operação humana. O manifest inclui o arquivo inteiro da página de revisão, que também contém mudanças E1 anteriores; os demais arquivos sujos da sessão anterior não fazem parte desta correção.
