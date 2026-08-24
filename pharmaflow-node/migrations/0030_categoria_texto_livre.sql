-- Migration 0030: categoria vira texto livre
--
-- A 0028 gravava um SLUG de uma lista fechada ('higiene-beleza') e a interface
-- traduzia para o rótulo. Na prática a lista fechada não serviu: o dono do
-- sistema precisa criar categoria própria sem esperar deploy, então o campo
-- passa a ser digitado à mão.
--
-- Duas consequências tratadas aqui:
--
-- 1) Os produtos já classificados guardam slug. Sem conversão eles apareceriam
--    na tela como "higiene-beleza" cru, porque não existe mais tabela de
--    rótulos para traduzir. O UPDATE abaixo grava o rótulo que a interface
--    mostrava, então nada muda aos olhos de quem usa.
--
-- 2) varchar(40) foi dimensionado para slug. Texto digitado precisa de folga —
--    "Vitaminas e Suplementos" já come 23, e ninguém vai contar caractere.
--
-- A partir daqui quem impede "Higiene", "higiene" e "HIGIENE" de virarem três
-- categorias distintas é o backend: ao salvar, um texto que normaliza igual a
-- uma categoria existente reaproveita a grafia já cadastrada
-- (canonizarCategoria, em src/catalogo/repository.ts).

ALTER TABLE catalogo_produtos
  ALTER COLUMN categoria TYPE varchar(60);

UPDATE catalogo_produtos SET categoria = CASE categoria
  WHEN 'higiene-beleza'  THEN 'Higiene e Beleza'
  WHEN 'dermocosmeticos' THEN 'Dermocosméticos'
  WHEN 'medicamentos'    THEN 'Medicamentos (MIP)'
  WHEN 'mamae-bebe'      THEN 'Mamãe e Bebê'
  WHEN 'vitaminas'       THEN 'Vitaminas e Suplementos'
  WHEN 'cuidado-pessoal' THEN 'Cuidado Pessoal'
  WHEN 'sazonais'        THEN 'Sazonais / Datas'
  ELSE categoria
END
WHERE categoria IN (
  'higiene-beleza', 'dermocosmeticos', 'medicamentos',
  'mamae-bebe', 'vitaminas', 'cuidado-pessoal', 'sazonais'
);

COMMENT ON COLUMN catalogo_produtos.categoria IS
  'Categoria digitada pelo gestor (texto livre). NULL = sem categoria.';
