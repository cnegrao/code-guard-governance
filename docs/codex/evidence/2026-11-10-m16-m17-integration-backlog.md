# M16/M17 — incorporação em etapa separada

O fechamento E1 não importa o código de `passport-compat-package`. A conferência somente de leitura confirmou a branch `feat/passport-test-compat-package`, HEAD `a5f85bf099fdbf0a24f1a369e4428730a042a162`, e o bundle SHA-256 `51a27ae2c5a49aa5e7e8ac25cb67e2521a801bd1ec8c9301ba826cf11429497f`.

O [inventário de integração](2026-11-10-m16-m17-integration-backlog.json) registra os nomes e hashes de **64 arquivos do bundle mais o próprio manifesto**, incluindo 25 variantes, 25 patches, build/package, fontes/inventário, política vendor, templates de preservação, checks de ensaio, testes e recibos. As 25 variantes são correlacionadas, em ordem, aos hashes efetivamente aplicados constantes do recibo E1 anterior. Todos os hashes conferiram nesta etapa; nenhum desses arquivos foi copiado para E1.

Etapa futura: obter autorização para consolidar o pacote em seu próprio worktree; verificar estes hashes; executar os testes offline do pacote; revisar e criar seu commit; só então planejar integração explícita desse commit. Nenhum push, merge ou cherry-pick é autorizado por este documento.

As variantes já foram aplicadas no teste. A futura incorporação é de fonte e evidência, **não reaplicação SQL**. Preservar as migrações históricas canônicas, os recibos de aplicação e a exceção vendor específica; não substituir variantes por alterações globais de contagem ou exceções de schema.
