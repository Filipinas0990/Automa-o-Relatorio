-- Migration v4: Adiciona vendas e receita_vendas por canal em coleta_canais
-- Execute no servidor após o git pull:
--   docker compose exec postgres psql -U farmacia_user -d farmacia_monitor -f /app/sql/migration_v4.sql

ALTER TABLE coleta_canais
    ADD COLUMN IF NOT EXISTS vendas         INTEGER      NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS receita_vendas NUMERIC(12,2) NOT NULL DEFAULT 0;

SELECT 'Migration v4 aplicada com sucesso!' AS resultado;
