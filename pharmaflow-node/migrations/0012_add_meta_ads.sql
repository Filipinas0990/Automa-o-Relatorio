-- Migration 0012: Módulo de Automação Meta Ads

-- Token Meta Ads por cliente (farmácia)
CREATE TABLE IF NOT EXISTS meta_tokens (
  id            SERIAL PRIMARY KEY,
  farmacia_id   INTEGER NOT NULL UNIQUE REFERENCES farmacias(id),
  access_token  TEXT NOT NULL,
  ad_account_id VARCHAR(60) NOT NULL,   -- "act_XXXXXXXXX"
  page_id       VARCHAR(60) NOT NULL,
  criado_em     TIMESTAMPTZ DEFAULT NOW(),
  atualizado_em TIMESTAMPTZ DEFAULT NOW()
);

-- Registro de cada campanha criada ou tentada via WhatsApp
CREATE TABLE IF NOT EXISTS campanhas_meta (
  id                SERIAL PRIMARY KEY,
  farmacia_id       INTEGER NOT NULL REFERENCES farmacias(id),
  gestor_telefone   VARCHAR(20) NOT NULL,
  status            VARCHAR(30) NOT NULL DEFAULT 'aguardando_confirmacao',
  -- 'aguardando_confirmacao' | 'publicada' | 'cancelada' | 'erro'
  payload_json      TEXT NOT NULL,           -- CampanhaExtraida (JSON)
  imagem_base64     TEXT,                    -- imagem enviada pelo gestor
  meta_campanha_id  VARCHAR(30),
  meta_conjunto_id  VARCHAR(30),
  meta_anuncio_id   VARCHAR(30),
  criado_em         TIMESTAMPTZ DEFAULT NOW(),
  atualizado_em     TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_campanhas_meta_gestor_status
  ON campanhas_meta (gestor_telefone, status);
