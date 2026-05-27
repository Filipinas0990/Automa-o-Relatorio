-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 0004 — Agenda: Bloqueios e Controle de Conflitos
-- Execute com:  psql $DATABASE_URL -f migrations/0004_add_agenda_bloqueios.sql
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Tabela de bloqueios de agenda (dias/horários fechados pelo dono)
CREATE TABLE IF NOT EXISTS agenda_bloqueios (
  id             SERIAL PRIMARY KEY,
  data           DATE        NOT NULL,
  hora_inicio    TIME,                          -- NULL = dia inteiro bloqueado
  hora_fim       TIME,
  dia_inteiro    BOOLEAN     NOT NULL DEFAULT FALSE,
  motivo         VARCHAR(200),                  -- "Viagem", "Feriado", etc.
  criado_por_id  INTEGER REFERENCES gestores_trafego(id) ON DELETE SET NULL,
  criado_em      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT bloqueio_horas_ck CHECK (
    dia_inteiro = TRUE OR (hora_inicio IS NOT NULL AND hora_fim IS NOT NULL AND hora_fim > hora_inicio)
  )
);

CREATE INDEX IF NOT EXISTS idx_agenda_bloqueios_data ON agenda_bloqueios (data);

-- 2. Função para verificar conflito de horário (usada no trigger de reunioes)
CREATE OR REPLACE FUNCTION fn_verificar_conflito_reuniao()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_fim         TIMESTAMPTZ;
  v_data        DATE;
  v_hora_ini    TIME;
  v_hora_fim    TIME;
  v_bloqueio    RECORD;
  v_conflito    RECORD;
BEGIN
  -- Só verifica reuniões ativas
  IF NEW.status = 'cancelada' THEN
    RETURN NEW;
  END IF;

  v_fim      := NEW.data_reuniao + (COALESCE(NEW.duracao_minutos, 60) || ' minutes')::interval;
  v_data     := NEW.data_reuniao::date;
  v_hora_ini := NEW.data_reuniao::time;
  v_hora_fim := v_fim::time;

  -- Verifica bloqueio de agenda
  SELECT motivo INTO v_bloqueio
  FROM agenda_bloqueios
  WHERE data = v_data
    AND (
      dia_inteiro = TRUE
      OR (hora_inicio <= v_hora_fim AND hora_fim >= v_hora_ini)
    )
  LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION 'AGENDA_BLOQUEADA: %',
      COALESCE(v_bloqueio.motivo, 'Agenda fechada neste horário');
  END IF;

  -- Verifica sobreposição com reunião existente
  SELECT titulo, data_reuniao INTO v_conflito
  FROM reunioes
  WHERE id != COALESCE(NEW.id, -1)
    AND status NOT IN ('cancelada')
    AND data_reuniao < v_fim
    AND (data_reuniao + (duracao_minutos || ' minutes')::interval) > NEW.data_reuniao
  LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION 'CONFLITO_HORARIO: Já existe a reunião "%" às %',
      v_conflito.titulo,
      TO_CHAR(v_conflito.data_reuniao AT TIME ZONE 'America/Sao_Paulo', 'DD/MM HH24:MI');
  END IF;

  RETURN NEW;
END;
$$;

-- 3. Trigger que roda antes de INSERT ou UPDATE em reunioes
DROP TRIGGER IF EXISTS trg_conflito_reuniao ON reunioes;
CREATE TRIGGER trg_conflito_reuniao
  BEFORE INSERT OR UPDATE OF data_reuniao, duracao_minutos, status ON reunioes
  FOR EACH ROW EXECUTE FUNCTION fn_verificar_conflito_reuniao();

-- ─────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  RAISE NOTICE 'Migration 0004 aplicada — agenda_bloqueios + trigger de conflito criados.';
END;
$$;
