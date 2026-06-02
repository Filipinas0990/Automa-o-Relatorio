-- ============================================================
-- Migration 0008: Sistema de Ações de Marketing
-- ============================================================

-- Tabela principal: define uma ação de marketing para um mês
CREATE TABLE IF NOT EXISTS acoes (
    id              SERIAL PRIMARY KEY,
    nome            VARCHAR(200) NOT NULL,
    tipo            VARCHAR(80)  NOT NULL,
    -- Exemplos de tipo: 'abre_mes', 'fecha_mes', 'campanha', 'promocao', 'evento', 'outro'
    descricao       TEXT,
    mes_referencia  VARCHAR(7)   NOT NULL,   -- 'YYYY-MM', ex: '2026-06'
    status          VARCHAR(20)  NOT NULL DEFAULT 'planejada',
    -- 'planejada' | 'em_andamento' | 'concluida' | 'cancelada'
    cor             VARCHAR(7),              -- cor HEX para badge na UI, ex: '#3B82F6'
    criado_por_id   INTEGER REFERENCES gestores_trafego(id) ON DELETE SET NULL,
    criado_em       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    atualizado_em   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

    CONSTRAINT acoes_status_check
        CHECK (status IN ('planejada', 'em_andamento', 'concluida', 'cancelada')),
    CONSTRAINT acoes_mes_formato_check
        CHECK (mes_referencia ~ '^\d{4}-\d{2}$')
);

-- Tabela de participação: relaciona farmácias com ações
CREATE TABLE IF NOT EXISTS farmacia_acoes (
    id                  SERIAL PRIMARY KEY,
    acao_id             INTEGER NOT NULL REFERENCES acoes(id) ON DELETE CASCADE,
    farmacia_id         INTEGER NOT NULL REFERENCES farmacias(id) ON DELETE CASCADE,
    observacoes         TEXT,
    adicionado_em       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    adicionado_por_id   INTEGER REFERENCES gestores_trafego(id) ON DELETE SET NULL,

    CONSTRAINT farmacia_acoes_unique UNIQUE (acao_id, farmacia_id)
);

-- Índices para queries frequentes
CREATE INDEX IF NOT EXISTS idx_acoes_mes_referencia  ON acoes(mes_referencia);
CREATE INDEX IF NOT EXISTS idx_acoes_status          ON acoes(status);
CREATE INDEX IF NOT EXISTS idx_acoes_tipo            ON acoes(tipo);
CREATE INDEX IF NOT EXISTS idx_farmacia_acoes_acao   ON farmacia_acoes(acao_id);
CREATE INDEX IF NOT EXISTS idx_farmacia_acoes_farm   ON farmacia_acoes(farmacia_id);

-- Trigger para manter atualizado_em sincronizado
CREATE OR REPLACE FUNCTION update_acoes_atualizado_em()
RETURNS TRIGGER AS $$
BEGIN
    NEW.atualizado_em = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_acoes_atualizado_em
BEFORE UPDATE ON acoes
FOR EACH ROW EXECUTE FUNCTION update_acoes_atualizado_em();
