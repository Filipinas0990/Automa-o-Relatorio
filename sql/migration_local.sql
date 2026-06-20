-- Migração local: traz o banco para o estado atual do schema.ts
-- Seguro para rodar múltiplas vezes (IF NOT EXISTS / IF EXISTS em tudo)

-- ── gestores_trafego: novas colunas ──────────────────────────────────────────
ALTER TABLE gestores_trafego
  ADD COLUMN IF NOT EXISTS google_refresh_token TEXT,
  ADD COLUMN IF NOT EXISTS google_calendar_id   VARCHAR(255) DEFAULT 'primary';

-- ── farmacias: colunas novas + relaxar NOT NULL ───────────────────────────────
ALTER TABLE farmacias
  ALTER COLUMN url_base DROP NOT NULL,
  ALTER COLUMN email    DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS tem_chatbot  BOOLEAN     NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS fase         VARCHAR(10) NOT NULL DEFAULT 'ativo',
  ADD COLUMN IF NOT EXISTS telefone     VARCHAR(20),
  ADD COLUMN IF NOT EXISTS responsavel  VARCHAR(120),
  ADD COLUMN IF NOT EXISTS cidade       VARCHAR(100),
  ADD COLUMN IF NOT EXISTS observacoes  TEXT;

-- ── reunioes ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS reunioes (
  id               SERIAL PRIMARY KEY,
  farmacia_id      INTEGER NOT NULL REFERENCES farmacias(id) ON DELETE CASCADE,
  gestor_id        INTEGER REFERENCES gestores_trafego(id) ON DELETE SET NULL,
  criado_por_id    INTEGER REFERENCES gestores_trafego(id) ON DELETE SET NULL,
  titulo           VARCHAR(200) NOT NULL,
  descricao        TEXT,
  data_reuniao     TIMESTAMPTZ  NOT NULL,
  duracao_minutos  INTEGER DEFAULT 60,
  local            VARCHAR(300),
  link_meet        VARCHAR(500),
  status           VARCHAR(20)  NOT NULL DEFAULT 'agendada',
  telefone         VARCHAR(20),
  google_event_id  VARCHAR(255),
  observacoes      TEXT,
  whatsapp_notificado_em TIMESTAMPTZ,
  criado_em        TIMESTAMPTZ DEFAULT NOW(),
  atualizado_em    TIMESTAMPTZ DEFAULT NOW()
);

-- ── agenda_bloqueios ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS agenda_bloqueios (
  id             SERIAL PRIMARY KEY,
  data           DATE NOT NULL,
  hora_inicio    VARCHAR(5),
  hora_fim       VARCHAR(5),
  dia_inteiro    BOOLEAN NOT NULL DEFAULT FALSE,
  motivo         VARCHAR(200),
  criado_por_id  INTEGER REFERENCES gestores_trafego(id) ON DELETE SET NULL,
  criado_em      TIMESTAMPTZ DEFAULT NOW()
);

-- ── whatsapp_config ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS whatsapp_config (
  id                SERIAL PRIMARY KEY,
  instance_name     VARCHAR(100) NOT NULL,
  status            VARCHAR(20)  NOT NULL DEFAULT 'close',
  qr_code           TEXT,
  numero_conectado  VARCHAR(30),
  atualizado_em     TIMESTAMPTZ DEFAULT NOW()
);

-- ── acoes ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS acoes (
  id              SERIAL PRIMARY KEY,
  nome            VARCHAR(200) NOT NULL,
  tipo            VARCHAR(80)  NOT NULL,
  descricao       TEXT,
  mes_referencia  VARCHAR(7)   NOT NULL,
  status          VARCHAR(20)  NOT NULL DEFAULT 'planejada',
  cor             VARCHAR(7),
  criado_por_id   INTEGER REFERENCES gestores_trafego(id) ON DELETE SET NULL,
  criado_em       TIMESTAMPTZ DEFAULT NOW(),
  atualizado_em   TIMESTAMPTZ DEFAULT NOW()
);

-- ── farmacia_acoes ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS farmacia_acoes (
  id                SERIAL PRIMARY KEY,
  acao_id           INTEGER NOT NULL REFERENCES acoes(id) ON DELETE CASCADE,
  farmacia_id       INTEGER NOT NULL REFERENCES farmacias(id) ON DELETE CASCADE,
  observacoes       TEXT,
  adicionado_em     TIMESTAMPTZ DEFAULT NOW(),
  adicionado_por_id INTEGER REFERENCES gestores_trafego(id) ON DELETE SET NULL,
  UNIQUE (acao_id, farmacia_id)
);
