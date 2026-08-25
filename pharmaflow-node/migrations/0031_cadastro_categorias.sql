-- Migration 0031: categoria vira cadastro próprio
--
-- Até aqui categoria não existia como registro: era só o texto gravado em
-- catalogo_produtos.categoria, e a lista das telas saía de um GROUP BY. Isso
-- tem dois furos que só aparecem quando alguém tenta ORGANIZAR o acervo:
--
--   • categoria sem produto não existe. Criar "Verão 2026" antes de subir a
--     primeira imagem era impossível — sumia no refresh.
--   • renomear e excluir não tinham onde acontecer. O único jeito de corrigir
--     "Dermocosmeticos" para "Dermocosméticos" era reclassificar produto a
--     produto.
--
-- A tabela abaixo resolve os dois sem mexer em catalogo_produtos.categoria, que
-- CONTINUA sendo o texto da categoria. Não virou foreign key de propósito: três
-- telas (banco de imagens, passo 3 do disparo, link público) filtram por esse
-- texto, e trocá-lo por id seria refatorar tudo para ganhar integridade que a
-- canonização do backend já entrega na prática. Renomear no cadastro faz o
-- UPDATE em cascata nos produtos; excluir deixa os produtos sem categoria.
--
-- nome_norm é a chave de unicidade — sem acento, minúscula, espaço colapsado.
-- É o que impede "Higiene", "higiene" e "HIGIENE " de virarem três cadastros.

CREATE TABLE IF NOT EXISTS catalogo_categorias (
  id            serial PRIMARY KEY,
  nome          varchar(60) NOT NULL,
  nome_norm     varchar(60) NOT NULL UNIQUE,
  criado_em     timestamptz DEFAULT now(),
  atualizado_em timestamptz DEFAULT now()
);

COMMENT ON TABLE catalogo_categorias IS
  'Cadastro de categorias do banco de imagens. O vínculo com o produto é o TEXTO em catalogo_produtos.categoria, não um id.';
COMMENT ON COLUMN catalogo_categorias.nome_norm IS
  'Chave de comparação (sem acento, minúscula, espaços colapsados) — espelha normalizarCategoria() em src/catalogo/categorias.ts.';

-- ── Backfill 1: o que já está aplicado a algum produto ───────────────────────
-- A grafia que entra no cadastro é a MAIS USADA no acervo, não a alfabética:
-- se 40 produtos estão em "Higiene e Beleza" e 1 em "higiene e beleza", a
-- oficial tem de ser a dos 40 — é a que aparece hoje nas telas.

INSERT INTO catalogo_categorias (nome, nome_norm)
SELECT nome, norm FROM (
  SELECT
    categoria AS nome,
    lower(btrim(regexp_replace(
      translate(categoria,
        'áàâãäéèêëíìîïóòôõöúùûüçñÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑ',
        'aaaaaeeeeiiiiooooouuuucnAAAAAEEEEIIIIOOOOOUUUUCN'),
      '\s+', ' ', 'g'))) AS norm,
    row_number() OVER (
      PARTITION BY lower(btrim(regexp_replace(
        translate(categoria,
          'áàâãäéèêëíìîïóòôõöúùûüçñÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑ',
          'aaaaaeeeeiiiiooooouuuucnAAAAAEEEEIIIIOOOOOUUUUCN'),
        '\s+', ' ', 'g')))
      ORDER BY count(*) DESC, categoria
    ) AS pos
  FROM catalogo_produtos
  WHERE categoria IS NOT NULL AND btrim(categoria) <> ''
  GROUP BY categoria
) t
WHERE pos = 1
ON CONFLICT (nome_norm) DO NOTHING;

-- ── Backfill 2: as categorias padrão do negócio ──────────────────────────────
-- Eram uma constante no código (CATEGORIAS_PADRAO), devolvida como "sugestões"
-- em toda listagem. Viram linha de cadastro para poderem ser renomeadas e
-- excluídas como qualquer outra — a constante deixa de mandar em tempo de
-- execução e fica só como semente desta migration.

INSERT INTO catalogo_categorias (nome, nome_norm)
SELECT v.nome,
       lower(btrim(regexp_replace(
         translate(v.nome,
           'áàâãäéèêëíìîïóòôõöúùûüçñÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑ',
           'aaaaaeeeeiiiiooooouuuucnAAAAAEEEEIIIIOOOOOUUUUCN'),
         '\s+', ' ', 'g')))
FROM (VALUES
  ('Higiene e Beleza'),
  ('Dermocosméticos'),
  ('Medicamentos (MIP)'),
  ('Mamãe e Bebê'),
  ('Vitaminas e Suplementos'),
  ('Cuidado Pessoal'),
  ('Sazonais / Datas')
) AS v(nome)
ON CONFLICT (nome_norm) DO NOTHING;
