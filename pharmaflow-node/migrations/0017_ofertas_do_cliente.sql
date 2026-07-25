-- Migration 0017: ofertas enviadas pelo dono da farmácia
--
-- O dono da farmácia não posta no grupo de ofertas. A agência assumiu a
-- postagem, mas quem sabe QUAIS produtos entram é o dono. Então o gestor manda
-- um link público (com token) para o dono escolher os produtos; a seleção cai
-- numa fila que o gestor consome dentro do disparo.

-- Link público do gestor. Um por gestor; regenerar troca o token.
CREATE TABLE IF NOT EXISTS links_oferta (
  id            SERIAL PRIMARY KEY,
  gestor_id     INTEGER NOT NULL UNIQUE REFERENCES gestores_trafego(id),
  token         VARCHAR(64) NOT NULL UNIQUE,
  ativo         BOOLEAN NOT NULL DEFAULT TRUE,
  criado_em     TIMESTAMPTZ DEFAULT NOW(),
  atualizado_em TIMESTAMPTZ DEFAULT NOW()
);

-- O que o dono da farmácia enviou
CREATE TABLE IF NOT EXISTS solicitacoes_oferta (
  id              SERIAL PRIMARY KEY,
  gestor_id       INTEGER NOT NULL REFERENCES gestores_trafego(id),
  farmacia_id     INTEGER NOT NULL REFERENCES farmacias(id),
  -- JSON: [{ "id": 12, "nome": "Dipirona 500mg" }] — produtos do catálogo
  produtos_json   TEXT NOT NULL,
  -- itens fora do catálogo, um por linha (não têm imagem pronta)
  produtos_livres TEXT,
  observacao      TEXT,
  enviado_por     VARCHAR(120),
  -- pendente | atendida | descartada
  status          VARCHAR(20) NOT NULL DEFAULT 'pendente',
  criado_em       TIMESTAMPTZ DEFAULT NOW(),
  atendida_em     TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_solicitacoes_oferta_gestor_status
  ON solicitacoes_oferta (gestor_id, status);

CREATE INDEX IF NOT EXISTS idx_solicitacoes_oferta_farmacia
  ON solicitacoes_oferta (farmacia_id);

-- Um disparo passa a levar VÁRIOS criativos (o cliente manda uma lista de
-- produtos). A tabela está vazia, então a troca de colunas é segura.
ALTER TABLE disparos_grupo DROP COLUMN IF EXISTS midia_b64;
ALTER TABLE disparos_grupo DROP COLUMN IF EXISTS midia_mime;

-- JSON: [{ "b64": "...", "mime": "image/png", "rotulo": "Dipirona — R$ 9,90" }]
ALTER TABLE disparos_grupo ADD COLUMN IF NOT EXISTS midias_json TEXT;

-- De qual cliente/pedido veio este disparo (null = envio avulso)
ALTER TABLE disparos_grupo ADD COLUMN IF NOT EXISTS farmacia_id INTEGER REFERENCES farmacias(id);
ALTER TABLE disparos_grupo ADD COLUMN IF NOT EXISTS solicitacao_id INTEGER REFERENCES solicitacoes_oferta(id);
