-- Migration 0028: categoria no banco de imagens
--
-- O banco de imagens cresceu para centenas de produtos e as três telas que o
-- consomem só ofereciam busca por texto:
--   • Banco de Imagens  (admin faz a curadoria)
--   • passo 3 do disparo (gestor monta o criativo, botão "Ver todo o banco")
--   • link público de ofertas (o DONO da farmácia escolhe, no celular)
-- A terceira é a que mais dói: rolar 300 miniaturas em duas colunas no celular
-- para achar um desodorante. Categoria transforma isso em filtro por chip,
-- estilo iFood.
--
-- Guarda o SLUG ('higiene-beleza'), não o rótulo exibido — renomear o rótulo
-- vira mudança de código em src/catalogo/categorias.ts, sem migration de dados.
--
-- Entra NULL de propósito: os produtos já cadastrados não têm o dado e não dá
-- para adivinhar a categoria a partir do nome ("dove - 123456" tanto pode ser
-- sabonete quanto desodorante). NULL é lido como "Sem categoria" e a interface
-- oferece um chip próprio para esses, mais seleção em lote para classificar o
-- acervo antigo de uma vez.

ALTER TABLE catalogo_produtos
  ADD COLUMN IF NOT EXISTS categoria varchar(40);

COMMENT ON COLUMN catalogo_produtos.categoria IS
  'Slug da categoria (ver src/catalogo/categorias.ts). NULL = sem categoria.';

-- Todo filtro das três telas passa por aqui; a coluna tem baixa cardinalidade
-- (7 valores + NULL), então o índice serve mais ao ORDER BY/agrupamento da
-- listagem do que a uma busca seletiva. É barato o suficiente para valer.
CREATE INDEX IF NOT EXISTS idx_catalogo_categoria
  ON catalogo_produtos (categoria);
