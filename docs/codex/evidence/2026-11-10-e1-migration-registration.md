# E1 — registro canônico da migração técnica

`20261109191942_agent_version_technical_profile_governed_mapping_v1.sql` foi incorporada a `supabase/migrations` por cópia byte a byte do artefato auditado em `ops/agent-version-profile-v1`. SHA-256 de ambos: `9c22c983eb1cd9cd48329b7d153b555de48ba2c4475ffe7b5eb70f55726e60a6`.

Uma consulta READ ONLY ao projeto `zkqfvqwqdypgpzauzinw` confirmou GOVIA_DEMO, histórico com 101 entradas, versão/nome exatos e uma única statement com o mesmo hash. **Nenhum SQL de migração foi reaplicado e nenhum dado foi alterado.** O [recibo](2026-11-10-e1-migration-registration.json) registra a correspondência.

O checkpoint congelado de 109 migrações e seus manifests permanecem intactos. O helper operacional reconhece agora exatamente dois sucessores autorizados: convite `20261108002618` e perfil `20261109191942`, totalizando 111 arquivos locais. Testes recusam ausência, reordenação, duplicata, acréscimo não autorizado, alteração de conteúdo e entradas não regulares. Não há exceção genérica de sufixo.

Os 111 arquivos locais e as 101 entradas hospedadas pertencem a inventários com históricos diferentes; sua contagem não deve ser usada para disparar db push ou reparo em massa. Esta regularização registra a fonte já aplicada. Preservar o manifesto auditado de preparação e os recibos posteriores como evidências de momentos distintos.
