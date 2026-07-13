-- Catálogo de produtos com imagem PNG (usado no fluxo Criativos e Campanhas)
-- Seguro para rodar múltiplas vezes.

CREATE TABLE IF NOT EXISTS catalogo_produtos (
  id          SERIAL PRIMARY KEY,
  nome        VARCHAR(200) NOT NULL,
  -- nome normalizado (sem acento, minúsculo, espaços colapsados) usado para o match
  nome_norm   VARCHAR(200) NOT NULL,
  -- imagem PNG guardada como base64 (sem o prefixo data:)
  imagem_b64  TEXT,
  mime        VARCHAR(40) DEFAULT 'image/png',
  criado_em   TIMESTAMPTZ DEFAULT NOW(),
  atualizado_em TIMESTAMPTZ DEFAULT NOW()
);

-- índice único no nome normalizado permite upsert (reimportar sobrescreve)
CREATE UNIQUE INDEX IF NOT EXISTS idx_catalogo_nome_norm
  ON catalogo_produtos (nome_norm);
