-- Migration 0021: um link de ofertas POR CLIENTE (farmácia)
--
-- Antes existia um único link por gestor: o dono abria, procurava a farmácia
-- dele numa lista e só então escolhia os produtos. Isso obrigava o dono a se
-- identificar (e deixava ele enxergar as outras farmácias da carteira).
--
-- Agora cada farmácia tem o seu token. O gestor copia o link direto na linha
-- do cliente, e quem abre já cai na tela de produtos da própria farmácia.
--
-- Os links antigos (farmacia_id NULL) continuam válidos: já foram mandados por
-- WhatsApp e quebrá-los deixaria clientes sem conseguir enviar a lista.

ALTER TABLE links_oferta
  ADD COLUMN IF NOT EXISTS farmacia_id integer REFERENCES farmacias(id);

-- Deixou de ser "um link por gestor".
ALTER TABLE links_oferta DROP CONSTRAINT IF EXISTS links_oferta_gestor_id_key;

-- Um link por (gestor, farmácia)...
CREATE UNIQUE INDEX IF NOT EXISTS idx_links_oferta_gestor_farmacia
  ON links_oferta (gestor_id, farmacia_id)
  WHERE farmacia_id IS NOT NULL;

-- ...e, no máximo, um link legado (sem farmácia) por gestor.
CREATE UNIQUE INDEX IF NOT EXISTS idx_links_oferta_legado
  ON links_oferta (gestor_id)
  WHERE farmacia_id IS NULL;

-- Resolver token é o caminho quente das rotas públicas.
CREATE INDEX IF NOT EXISTS idx_links_oferta_farmacia
  ON links_oferta (farmacia_id);
