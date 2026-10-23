-- Migration 0042: vínculo da farmácia com a empresa no PharmaChatbot
--
-- Os números do painel (atendimentos, vendas, receita, canais) voltaram a
-- vir do PharmaChatbot, agora pelo banco de produção deles (MCP engine-prod,
-- só leitura). Lá cada farmácia é um `company_id` dentro de um tenant
-- (pharma-11, pharma-12, pharma-13, pharma-14, cyborg) — o mesmo id pode
-- existir em tenants diferentes, por isso o par é o que identifica.
--
-- Índice único: a mesma empresa não pode ser de duas farmácias.
--
-- Idempotente: pode rodar de novo sem estragar nada.

ALTER TABLE farmacias ADD COLUMN IF NOT EXISTS pc_tenant varchar(40);
ALTER TABLE farmacias ADD COLUMN IF NOT EXISTS pc_company_id bigint;

CREATE UNIQUE INDEX IF NOT EXISTS farmacias_pc_empresa_unica
  ON farmacias (pc_tenant, pc_company_id)
  WHERE pc_tenant IS NOT NULL AND pc_company_id IS NOT NULL;
