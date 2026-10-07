-- Migration 0037: conexão do Facebook por gestor
--
-- Cada gestor pode conectar o próprio Facebook ("Conectar com Facebook") e
-- publicar/listar contas com o token dele. Sem conexão, o sistema segue com o
-- META_ACCESS_TOKEN geral do servidor (usuário de sistema do BM).
--
-- O token fica CRIPTOGRAFADO (src/cripto.ts, chave FARMACIAS_KEY). É um token
-- de usuário de longa duração: vale ~60 dias, depois o gestor reconecta.
--
-- Idempotente: pode rodar de novo sem estragar nada.

ALTER TABLE gestores_trafego ADD COLUMN IF NOT EXISTS meta_access_token    text;
ALTER TABLE gestores_trafego ADD COLUMN IF NOT EXISTS meta_token_expira_em timestamptz;
ALTER TABLE gestores_trafego ADD COLUMN IF NOT EXISTS meta_usuario_id      varchar(40);
ALTER TABLE gestores_trafego ADD COLUMN IF NOT EXISTS meta_usuario_nome    varchar(120);
