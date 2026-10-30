-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 0005 — Campo tem_chatbot na tabela farmacias
-- Execute com:  psql $DATABASE_URL -f migrations/0005_add_tem_chatbot.sql
-- ─────────────────────────────────────────────────────────────────────────────

-- Adiciona o campo: TRUE = tem chatbot (comportamento atual), FALSE = só gestão/reuniões
ALTER TABLE farmacias
  ADD COLUMN IF NOT EXISTS tem_chatbot BOOLEAN NOT NULL DEFAULT TRUE;

-- Farmácias sem url_base configurada (se existirem) marcadas como sem chatbot
UPDATE farmacias
  SET tem_chatbot = FALSE
  WHERE url_base IS NULL OR url_base = '';

-- Índice para filtrar facilmente
CREATE INDEX IF NOT EXISTS idx_farmacias_tem_chatbot ON farmacias (tem_chatbot);

DO $$
BEGIN
  RAISE NOTICE 'Migration 0005 aplicada — campo tem_chatbot adicionado à tabela farmacias.';
END;
$$;
