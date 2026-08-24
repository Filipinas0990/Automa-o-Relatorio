-- Migration 0029: guarda QUAIS produtos foram disparados
--
-- Até aqui `disparos_grupo` gravava só `midias_json` — os PNGs já rasterizados
-- do criativo, com um `rotulo` de texto ("dove - 123456 — R$9,99"). O id do
-- produto no catálogo se perdia no caminho: depois de disparar, não havia como
-- saber que aquele criativo veio do produto 42.
--
-- Isso inviabilizava o filtro "Recentes" no passo 3 do disparo, que mostra ao
-- gestor os produtos anunciados na última campanha DAQUELE cliente — de longe o
-- ponto de partida mais provável para montar a próxima.
--
-- Dava para tentar reconstruir casando `rotulo` com `catalogo_produtos.nome`,
-- mas o rótulo carrega preço concatenado e o nome do produto pode ter sido
-- editado desde então; o match erraria calado. Guardar o id é barato e exato.
--
-- Formato: [{"id": 42, "nome": "dove - 123456"}] — mesmo formato de
-- `solicitacoes_oferta.produtos_json`. O nome vai junto de propósito, para o
-- histórico continuar legível se o produto for apagado do banco de imagens.
--
-- Entra NULL nos disparos antigos e não há como preencher retroativamente: o
-- dado nunca existiu. Na prática o filtro "Recentes" começa vazio para todo
-- mundo e passa a valer a partir do primeiro disparo feito depois deste deploy.
-- A interface trata isso escondendo o chip quando não há nada.

ALTER TABLE disparos_grupo
  ADD COLUMN IF NOT EXISTS produtos_json text;

COMMENT ON COLUMN disparos_grupo.produtos_json IS
  'JSON [{id, nome}] dos produtos do catálogo que geraram os criativos. NULL nos disparos anteriores à migration 0029.';
