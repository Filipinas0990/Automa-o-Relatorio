-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 0003 — Feature Reuniões com Gestores + Google Calendar
-- Execute com:  psql $DATABASE_URL -f migrations/0003_add_reunioes.sql
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Adiciona token OAuth do Google por gestor (para sincronização automática)
ALTER TABLE gestores_trafego
  ADD COLUMN IF NOT EXISTS google_refresh_token TEXT,
  ADD COLUMN IF NOT EXISTS google_calendar_id   VARCHAR(255) DEFAULT 'primary';

-- 2. Cria tabela principal de reuniões
CREATE TABLE IF NOT EXISTS reunioes (
  id               SERIAL PRIMARY KEY,
  farmacia_id      INTEGER      NOT NULL REFERENCES farmacias(id) ON DELETE CASCADE,
  gestor_id        INTEGER               REFERENCES gestores_trafego(id) ON DELETE SET NULL,
  criado_por_id    INTEGER               REFERENCES gestores_trafego(id) ON DELETE SET NULL,

  titulo           VARCHAR(200) NOT NULL,
  descricao        TEXT,
  data_reuniao     TIMESTAMPTZ  NOT NULL,
  duracao_minutos  INTEGER      NOT NULL DEFAULT 60,
  local            VARCHAR(300),
  link_meet        VARCHAR(500),                          -- Google Meet / Zoom / etc.

  status           VARCHAR(20)  NOT NULL DEFAULT 'agendada'
                   CONSTRAINT reunioes_status_ck
                   CHECK (status IN ('agendada','confirmada','realizada','cancelada')),

  google_event_id  VARCHAR(255),                          -- ID do evento no Google Calendar
  observacoes      TEXT,                                  -- notas pós-reunião

  criado_em        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  atualizado_em    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- 3. Índices de performance
CREATE INDEX IF NOT EXISTS idx_reunioes_farmacia  ON reunioes (farmacia_id);
CREATE INDEX IF NOT EXISTS idx_reunioes_gestor    ON reunioes (gestor_id);
CREATE INDEX IF NOT EXISTS idx_reunioes_data      ON reunioes (data_reuniao);
CREATE INDEX IF NOT EXISTS idx_reunioes_status    ON reunioes (status);

-- 4. Trigger para atualizar automaticamente atualizado_em
CREATE OR REPLACE FUNCTION fn_set_atualizado_em()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.atualizado_em = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_reunioes_atualizado_em ON reunioes;
CREATE TRIGGER trg_reunioes_atualizado_em
  BEFORE UPDATE ON reunioes
  FOR EACH ROW EXECUTE FUNCTION fn_set_atualizado_em();

-- ─────────────────────────────────────────────────────────────────────────────
-- Verificação
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  RAISE NOTICE 'Migration 0003 aplicada com sucesso — tabela reunioes criada.';
END;
$$;
