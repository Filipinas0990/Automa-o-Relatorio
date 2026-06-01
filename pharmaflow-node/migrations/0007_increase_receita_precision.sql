-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 0007 — Aumentar precisão dos campos de receita
-- Motivo: NUMERIC(12,2) suporta no máximo ~9.999.999.999,99.
--         Valores de receita acima desse limite causavam overflow no INSERT.
-- Execute com:  psql $DATABASE_URL -f migrations/0007_increase_receita_precision.sql
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE coletas
  ALTER COLUMN receita_total TYPE NUMERIC(15, 2);

ALTER TABLE coleta_canais
  ALTER COLUMN receita_vendas TYPE NUMERIC(15, 2);

ALTER TABLE farmacias
  ALTER COLUMN meta_receita TYPE NUMERIC(15, 2);

DO $$
BEGIN
  RAISE NOTICE 'Migration 0007 aplicada — precisão de receita aumentada para NUMERIC(15,2).';
END;
$$;
