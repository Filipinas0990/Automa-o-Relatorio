-- Migration 0026: remove "itens livres" e "observação" do pedido de oferta
--
-- Os dois campos saíram do link público a pedido do dono. Confirmamos no banco
-- que nenhuma solicitação tinha conteúdo neles antes de derrubar, então não há
-- histórico se perdendo.
--
-- ATENÇÃO À ORDEM DO DEPLOY: esta migration é DESTRUTIVA e, ao contrário das
-- anteriores, tem de rodar DEPOIS do código novo estar no ar. O código antigo
-- faz SELECT dessas colunas — se elas sumirem antes, as telas de ofertas
-- quebram com erro 500.

ALTER TABLE solicitacoes_oferta DROP COLUMN IF EXISTS produtos_livres;
ALTER TABLE solicitacoes_oferta DROP COLUMN IF EXISTS observacao;
