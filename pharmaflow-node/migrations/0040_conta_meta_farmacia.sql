-- Migration 0040: conta de anúncios do Meta de cada farmácia
--
-- Cada cliente roda em UMA conta de anúncios (decisão do dono em 19/10/2026).
-- O custo por resultado lê só esta conta; farmácia sem conta não aparece no
-- painel. Antes o vínculo era adivinhado pelo nome da conta, o que errava
-- quando a farmácia tinha CA01 e CA02 ou o nome de fachada estava trocado.
--
-- Índice único: a mesma conta não pode ser de dois clientes.
--
-- Idempotente: pode rodar de novo sem estragar nada.

ALTER TABLE farmacias ADD COLUMN IF NOT EXISTS meta_ad_account_id varchar(40);

CREATE UNIQUE INDEX IF NOT EXISTS farmacias_meta_ad_account_id_unico
  ON farmacias (meta_ad_account_id)
  WHERE meta_ad_account_id IS NOT NULL;
