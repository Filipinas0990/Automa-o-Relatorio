-- Migration 0015: Disparo de ofertas em grupos de WhatsApp (multi-tenant)
-- Cada gestor tem suas farmácias; cada farmácia tem sua própria instância
-- Evolution API e, portanto, seus próprios grupos.

-- Instância Evolution por farmácia — a ponte multi-tenant.
-- Diferente de whatsapp_config (instância única global usada na notificação de reuniões).
CREATE TABLE IF NOT EXISTS farmacia_whatsapp (
  id               SERIAL PRIMARY KEY,
  farmacia_id      INTEGER NOT NULL UNIQUE REFERENCES farmacias(id),
  instance_name    VARCHAR(100) NOT NULL UNIQUE,   -- convenção: 'farmacia_<id>'
  status           VARCHAR(20) NOT NULL DEFAULT 'close',  -- close | connecting | open
  numero_conectado VARCHAR(30),
  qr_code          TEXT,
  criado_em        TIMESTAMPTZ DEFAULT NOW(),
  atualizado_em    TIMESTAMPTZ DEFAULT NOW()
);

-- Disparo de ofertas nos grupos (imediato ou agendado com repetição)
CREATE TABLE IF NOT EXISTS disparos_grupo (
  id            SERIAL PRIMARY KEY,
  farmacia_id   INTEGER NOT NULL REFERENCES farmacias(id),
  criado_por_id INTEGER REFERENCES gestores_trafego(id),
  titulo        VARCHAR(200) NOT NULL,
  mensagem      TEXT NOT NULL,
  midia_b64     TEXT,                    -- criativo PNG em base64 (sem o prefixo data:)
  midia_mime    VARCHAR(40),
  grupos_json   TEXT NOT NULL,           -- JSON: [{ "jid": "...@g.us", "nome": "..." }]
  quando        VARCHAR(10) NOT NULL DEFAULT 'agora',   -- agora | agendado
  agendado_para TIMESTAMPTZ,
  repetir       VARCHAR(10) NOT NULL DEFAULT 'nunca',   -- nunca | diario | semanal | mensal
  timezone      VARCHAR(50) NOT NULL DEFAULT 'America/Sao_Paulo',
  status        VARCHAR(20) NOT NULL DEFAULT 'agendado',
  -- agendado | enviando | enviado | erro | cancelado
  proximo_envio TIMESTAMPTZ,
  ultimo_envio  TIMESTAMPTZ,
  criado_em     TIMESTAMPTZ DEFAULT NOW(),
  atualizado_em TIMESTAMPTZ DEFAULT NOW()
);

-- O scheduler varre por (status, proximo_envio) a cada minuto
CREATE INDEX IF NOT EXISTS idx_disparos_grupo_pendentes
  ON disparos_grupo (status, proximo_envio);

CREATE INDEX IF NOT EXISTS idx_disparos_grupo_farmacia
  ON disparos_grupo (farmacia_id);

-- Log de entrega por grupo (visibilidade de falha)
CREATE TABLE IF NOT EXISTS disparos_grupo_log (
  id         SERIAL PRIMARY KEY,
  disparo_id INTEGER NOT NULL REFERENCES disparos_grupo(id),
  grupo_jid  VARCHAR(120) NOT NULL,
  grupo_nome VARCHAR(200),
  status     VARCHAR(10) NOT NULL,   -- ok | erro
  erro       TEXT,
  enviado_em TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_disparos_grupo_log_disparo
  ON disparos_grupo_log (disparo_id);
