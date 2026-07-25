-- Migration 0018: liga/desliga produto do catálogo de imagens
--
-- Cada produto do banco de imagens agora pode ser ativado ou desativado no
-- painel (tela "Banco de Imagens", estilo lista com toggle). Um produto
-- DESLIGADO deixa de entrar no match de criativos (carregarCatalogo filtra
-- ativo = true) e não é oferecido no link público de ofertas.
--
-- Coluna aditiva e segura: default true garante que todo produto existente
-- continua ativo.

ALTER TABLE catalogo_produtos
  ADD COLUMN IF NOT EXISTS ativo boolean NOT NULL DEFAULT true;
