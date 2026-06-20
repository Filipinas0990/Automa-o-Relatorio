-- Registra tokens Meta para os clientes que já estão no banco de produção
-- Executa com: psql $DATABASE_URL -f migrations/0012_meta_tokens_clientes.sql

-- Remove coluna access_token se ainda existir (migration 0014)
ALTER TABLE meta_tokens DROP COLUMN IF EXISTS access_token;

-- Insere/atualiza tokens usando o nome da farmácia para encontrar o ID
INSERT INTO meta_tokens (farmacia_id, ad_account_id, page_id)
SELECT id, 'act_832145212983751', '953291854530653'
FROM farmacias WHERE nome ILIKE '%são marcos%' OR nome ILIKE '%sao marcos%' LIMIT 1
ON CONFLICT (farmacia_id) DO UPDATE SET
  ad_account_id = EXCLUDED.ad_account_id,
  page_id       = EXCLUDED.page_id,
  atualizado_em = NOW();

INSERT INTO meta_tokens (farmacia_id, ad_account_id, page_id)
SELECT id, 'act_1414616263384279', '709643962241986'
FROM farmacias WHERE nome ILIKE '%bem estar%' LIMIT 1
ON CONFLICT (farmacia_id) DO UPDATE SET
  ad_account_id = EXCLUDED.ad_account_id,
  page_id       = EXCLUDED.page_id,
  atualizado_em = NOW();

INSERT INTO meta_tokens (farmacia_id, ad_account_id, page_id)
SELECT id, 'act_918531661024937', '964228586782823'
FROM farmacias WHERE nome ILIKE '%drogavaz%' LIMIT 1
ON CONFLICT (farmacia_id) DO UPDATE SET
  ad_account_id = EXCLUDED.ad_account_id,
  page_id       = EXCLUDED.page_id,
  atualizado_em = NOW();

INSERT INTO meta_tokens (farmacia_id, ad_account_id, page_id)
SELECT id, 'act_965063529858709', '1163762873484946'
FROM farmacias WHERE nome ILIKE '%tiburcio%' LIMIT 1
ON CONFLICT (farmacia_id) DO UPDATE SET
  ad_account_id = EXCLUDED.ad_account_id,
  page_id       = EXCLUDED.page_id,
  atualizado_em = NOW();

INSERT INTO meta_tokens (farmacia_id, ad_account_id, page_id)
SELECT id, 'act_887437228695489', '1157328480801507'
FROM farmacias WHERE nome ILIKE '%ultra popular%' LIMIT 1
ON CONFLICT (farmacia_id) DO UPDATE SET
  ad_account_id = EXCLUDED.ad_account_id,
  page_id       = EXCLUDED.page_id,
  atualizado_em = NOW();

INSERT INTO meta_tokens (farmacia_id, ad_account_id, page_id)
SELECT id, 'act_865986067319628', '790552567481618'
FROM farmacias WHERE nome ILIKE '%portal farma%' LIMIT 1
ON CONFLICT (farmacia_id) DO UPDATE SET
  ad_account_id = EXCLUDED.ad_account_id,
  page_id       = EXCLUDED.page_id,
  atualizado_em = NOW();

INSERT INTO meta_tokens (farmacia_id, ad_account_id, page_id)
SELECT id, 'act_536308321580835', '1083298384862225'
FROM farmacias WHERE nome ILIKE '%preço baixo%' OR nome ILIKE '%preco baixo%' LIMIT 1
ON CONFLICT (farmacia_id) DO UPDATE SET
  ad_account_id = EXCLUDED.ad_account_id,
  page_id       = EXCLUDED.page_id,
  atualizado_em = NOW();

INSERT INTO meta_tokens (farmacia_id, ad_account_id, page_id)
SELECT id, 'act_1345131310829198', '1090223057513578'
FROM farmacias WHERE nome ILIKE '%detox%' LIMIT 1
ON CONFLICT (farmacia_id) DO UPDATE SET
  ad_account_id = EXCLUDED.ad_account_id,
  page_id       = EXCLUDED.page_id,
  atualizado_em = NOW();

-- Confirma o que foi inserido
SELECT f.nome, m.ad_account_id, m.page_id, m.atualizado_em
FROM meta_tokens m
JOIN farmacias f ON f.id = m.farmacia_id
ORDER BY f.nome;
