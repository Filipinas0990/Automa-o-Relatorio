-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 0006 — Clientes de Entrada
-- Execute com:  psql $DATABASE_URL -f migrations/0006_add_clientes_entrada.sql
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE farmacias
  ADD COLUMN IF NOT EXISTS fase        VARCHAR(10)  NOT NULL DEFAULT 'ativo',
  ADD COLUMN IF NOT EXISTS telefone    VARCHAR(20),
  ADD COLUMN IF NOT EXISTS responsavel VARCHAR(120),
  ADD COLUMN IF NOT EXISTS cidade      VARCHAR(100),
  ADD COLUMN IF NOT EXISTS observacoes TEXT;

-- Clientes existentes já estão ativos
UPDATE farmacias SET fase = 'ativo' WHERE fase IS NULL OR fase = '';

CREATE INDEX IF NOT EXISTS idx_farmacias_fase ON farmacias (fase);

DO $$
BEGIN
  RAISE NOTICE 'Migration 0006 aplicada — clientes de entrada adicionados à tabela farmacias.';
END;
$$;
