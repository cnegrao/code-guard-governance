# Passport 360 — aplicação controlada M16/M17

Data: 2026-11-09. **25/25 etapas aplicadas; nenhuma migração falhou. Passport confirmado pelo operador na sessão real.**

## Autorização e destino

Carlos autorizou explicitamente a aplicação das 25 variantes auditadas em ov-ia-g2-test, com backup lógico consistente e verificação de legibilidade, dispensando PITR e ensaio completo de restauração. Este procedimento substitui o gate anterior de recuperação gerenciada; não autoriza outro projeto, Docker ou mudança dos contratos.

Destino único: `zkqfvqwqdypgpzauzinw`, organização funcional `GOVIA_DEMO`. A conexão derivou do vínculo E1 validado; host/usuário foram restritos ao projeto e a identidade ao vivo confirmou database postgres, PostgreSQL17.6 e GOVIA_DEMO. O worktree é `D:\code-guard-governance\.worktrees\e1-operator-unblock`, branch `fix/e1-operator-unblock`, HEAD `a5f85bf099fdbf0a24f1a369e4428730a042a162`. Alterações E1 preexistentes foram preservadas. Não houve acesso a gov-ia-dev, Docker ou ambiente alternativo.

## Proteção e backup

- Backup completo em formato custom: **2950525 bytes**, esquema e dados do database, inclusive histórico Supabase.
- Exportação separada dos dados de todas as **132 tabelas GOV IA**, cobrindo identidades, mappings, certificações/revisões, decisões, materializações, fontes e evidências reais.
- Ambos os arquivos e o inventário usaram o mesmo snapshot `0000000F-00000548-1`, em REPEATABLE READ READ ONLY, iniciado 2026-11-09T14:56:58.542Z. Roles foram exportadas separadamente sem senhas de roles.
- `pg_restore --list` conferiu o conteúdo; `pg_restore --file` leu e descomprimiu integralmente ambos os arquivos em SQL privado, sem executar restore. Foram conferidos o histórico e cada uma das 132 entradas de dados de governança.
- Verificação concluída 2026-11-09T14:57:31.327Z; SHA-256 do backup completo: `762ed2b154a1df75100274d08b09feda899670d95394157df280a388b3d5f25f`.
- Arquivos privados e logs de execução: `D:/code-guard-governance/.worktrees/e1-operator-unblock/.artifacts/agent/passport-controlled-2026-11-09T14-56-55-143Z`. ACL NTFS restrita ao usuário executor e SYSTEM. Conexões e chaves permaneceram em memória; nenhum cookie exportado. Não publicar os arquivos de dados ou SQL legível.
- Foi usado apenas o cliente pg_dump17.11 já disponível contra o servidor17.6. Nenhum servidor local foi iniciado. Não se afirma ter ensaiado restauração; a verificação foi de integridade, conteúdo e leitura, como autorizado.

O [recibo público sanitizado](2026-11-09-passport-controlled-m16-m17.json) contém tamanhos e hashes, sem dados do backup. A documentação [PostgreSQL17](https://www.postgresql.org/docs/17/app-pgdump.html) descreve consistência e compartilhamento de snapshot; a prova desta execução são os recibos e arquivos privados citados.

## Pacote, execução e histórico

Reutilizado `passport-compat-v1`, identidade do recibo `51a27ae2c5a49aa5e7e8ac25cb67e2521a801bd1ec8c9301ba826cf11429497f`: 64 arquivos e as 109 migrações canônicas passaram na conferência de hashes. Os 49 testes offline anteriores foram reutilizados, sem nova execução. Variantes, patches e fontes históricas não foram editados.

Cada variante manteve todos os seus comandos e preflights/postflights. O envelope do executor acrescentou identificação, lock de coordenação e INSERT de metadados antes do COMMIT original. A linha em `supabase_migrations.schema_migrations` guarda a versão/nome originais e a variante exata em `statements[1]`; o hash do SQL de transporte completo está em recibo separado. DDL e registro de histórico foram atômicos por etapa. `ON_ERROR_STOP` fechava a conexão em erro, sem avançar. Não foi necessário rollback de etapa.

Antes e depois de cada migração foram conferidos histórico e conteúdo das 132 tabelas. Os guards auditados verificaram também OIDs/colunas/dados e a função gerenciada dentro da transação. A comparação global projetou as colunas originais, distinguindo a adição nullable auditada de uma alteração em valores existentes.

Histórico: **75 → 100**, mantendo as 75 entradas anteriores e incluindo exatamente as 25 abaixo. Nenhuma etapa já registrada foi reaplicada; nenhuma M17.5 foi aplicada. Não houve repair/reset/db push global, exclusão de dados ou DDL fora da cadeia auditada, além do registro obrigatório em histórico.

| Ordem | Versão | Migração | Resultado |
| --- | --- | --- | --- |
| 1 | `20261007120000` | `m16_s1b3_policy_admission_v1` | PASS |
| 2 | `20261008120000` | `m16_s1b4_policy_version_validation_v1` | PASS |
| 3 | `20261008180000` | `m16_s1b5_domain_registries_v1` | PASS |
| 4 | `20261008200000` | `m16_s1b6_control_definition_registry_v1` | PASS |
| 5 | `20261008220000` | `m16_s1c1_responsibility_assignment_v1` | PASS |
| 6 | `20261009120000` | `m16_s1c2_business_context_assignment_v1` | PASS |
| 7 | `20261009121000` | `m16_s1c1r1_party_dependency_guard_v1` | PASS |
| 8 | `20261009130000` | `m16_s1c3_policy_applicability_v1` | PASS |
| 9 | `20261009220000` | `m16_s1c4_control_applicability_v1` | PASS |
| 10 | `20261010120000` | `m16_s1c5_control_assessment_v1` | PASS |
| 11 | `20261012120000` | `m16_read_projection_closure_v1` | PASS |
| 12 | `20261012200000` | `m17_s0_authority_policy_l15_extension_v1` | PASS |
| 13 | `20261012210000` | `m17_s1_signals_hypotheses_support_v1` | PASS |
| 14 | `20261012220000` | `m17_s1r1_machine_intake_login_closure_v1` | PASS |
| 15 | `20261013120000` | `m17_s2_scenario_methodology_registries_v1` | PASS |
| 16 | `20261013130000` | `m17_s2r1_l15_allow_guard_execution_context_v1` | PASS |
| 17 | `20261013140000` | `m17_s3_governed_risk_v1` | PASS |
| 18 | `20261013150000` | `m17_s3r1_governed_risk_support_currency_lineage_v1` | PASS |
| 19 | `20261013160000` | `m17_s4_inherent_risk_assessment_v1` | PASS |
| 20 | `20261015122639` | `m17_s5_risk_treatment_v1` | PASS |
| 21 | `20261016021012` | `m17_s6_residual_risk_acceptance_v1` | PASS |
| 22 | `20261017020733` | `m17_s7a_read_projections_v1` | PASS |
| 23 | `20261019130000` | `m17_s7b_passport_risk_overlay_v1` | PASS |
| 24 | `20261019140000` | `m17_s7c_final_security_closure_v1` | PASS |
| 25 | `20261020031523` | `m17_s7d_adversarial_corrective_v1` | PASS |

## Convite legítimo reconciliado

A migração `20261108002618_governance_operator_invitation_v1.sql` mantém integralmente o hash `2aa8821a4e3b01043f907a1b38b8ed2a2d862cc44ce752ef3d85845674173878`, igual ao SQL já registrado no banco. O teste agora trata esse único sucessor por nome e hash fixados, conforme autorização expressa de Carlos. O checkpoint Git original de 109 arquivos e a fixture V4 continuam intactos.

O validador original permanece estrito. Não há filtro por nome genérico, exceção para schema ou aceitação irrestrita de apêndices. Os novos casos rejeitam alteração do convite, renomeação, duplicação, ausência, symlink e mutação histórica. **24/24 testes passaram.**

Código alterado nesta execução: `apps/dashboard/tests/helpers/m17-canonical-migration-chain.ts` e `apps/dashboard/tests/m17-migration-chain-contract.test.ts`. As demais alterações E1 já existiam. Não houve commit, push ou PR.

## Integridade, RPCs e segurança

- As **132 tabelas originais** mantiveram dados, contagens e hashes em todas as etapas; zero divergências.
- AGENT `canonical-object:06b5f654e2b57694e6fd973d42275309a1149313792569ee2e9ed2cfe2eb1d81`: decisão original existente; **1 assertion / 1 evidência**, nenhuma referência faltante.
- AGENT_VERSION `canonical-object:1e85ebd0823bc0355300fa46d0fefaee8c45281658ce27a200feac8e2e4efec1`: decisão original existente; **3 assertions / 3 evidências**, nenhuma referência faltante.
- Associação preservada: mapping `1f4a37e5-0dd6-4809-813e-cec0ab8e2c38`, do AGENT_VERSION para o AGENT esperado.
- `l14_read_passport_governance_v1` e `l15_read_passport_risk_overlay_v1`: presentes, assinaturas exatas, owner postgres, SECURITY DEFINER, configurações e hashes de corpo iguais aos contratos. EXECUTE permitido ao service_role, negado a anon/authenticated/PUBLIC e ao caller técnico L15.
- Passaram os checks SQL auditados: superfície de 36 definers L15, ausência de concessão direta aos authority stores e atestação exata da função gerenciada `storage.reconcile_lifecycle_state(text,boolean)`. Nenhuma função gerenciada foi alterada.
- As duas RPCs foram chamadas via API real com metadados de sessão ausentes: ambas responderam HTTP400 / **GV001**, como rejeição de autenticação esperada. Não foi fabricada uma sessão positiva.
- Stores autoritativos: `l14_fact_states=0`, `l15_governed_risk_states=0`. Não foram inventados riscos, controles, classificações ou fatos para preencher o Passport; campos sem respaldo permanecem **UNKNOWN**.

## Testes e funcionamento

**117 testes direcionados passaram:** 68 consultas Passport, 21 rota/UI, 24 inventário e 4 overlay estático M17. Typecheck dashboard `--incremental false` e `git diff --check`: PASS. Não se executou uma bateria de integração com dados sintéticos no banco hospedado nem suíte PostgreSQL que exige outro servidor.

HTTP local sem sessão: login200; listagem e URL exata do Passport307 para login. Esses redirecionamentos validam a proteção, não são contados como sucesso autenticado. A confirmação positiva veio diretamente do operador, após a aplicação, na sessão real GOVIA_DEMO: **“Carregou o AGENT e a versão”**. Não houve captura automatizada do corpo HTTP autenticado, navegação automatizada ou exportação de cookies. Logs da aplicação também registraram login real e validação de JWT; erros históricos anteriores às migrações não foram reclassificados como erros novos.

As leituras de catálogo, linhagem e API estão no recibo sanitizado; os SQLs de transporte, stdout/stderr e recibos por etapa ficam no diretório privado. Um erro de argumento em helper local foi corrigido antes do primeiro DDL e um parêntese no SQL de verificação final foi corrigido em transação somente leitura. **Nenhuma migração falhou ou precisou ser reaplicada.**

## Resultado

**Alinhamento concluído no Supabase de teste; Agent Passport 360 desbloqueado, com AGENT e AGENT_VERSION confirmados pelo operador.** Não há pendência de migração nesta cadeia. A ausência de fatos autoritativos adicionais é representada por UNKNOWN e não é preenchida artificialmente. Histórico canônico, função gerenciada e governança existente foram preservados. Os artefatos locais de código/evidência permanecem sem commit; publicação não foi solicitada.
