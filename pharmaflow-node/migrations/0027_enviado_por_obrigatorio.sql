-- Migration 0027: quem enviou a lista passa a ser obrigatório
--
-- Regra de negócio do dono: o pedido de ofertas não pode chegar anônimo — o
-- gestor precisa saber com quem falar quando tiver dúvida sobre a lista.
--
-- Os pedidos antigos foram feitos quando o campo era opcional, então os que
-- estão sem nome recebem um marcador antes da coluna virar NOT NULL. Esse
-- texto só aparece nas telas internas do gestor (nunca no criativo nem no
-- grupo), então marcar é seguro aqui.
--
-- ATENÇÃO À ORDEM: destrutiva no sentido de restringir. Rode DEPOIS que o
-- código novo estiver no ar — ele é quem garante que nada mais chega nulo.

UPDATE solicitacoes_oferta
   SET enviado_por = 'Não informado'
 WHERE enviado_por IS NULL OR btrim(enviado_por) = '';

ALTER TABLE solicitacoes_oferta
  ALTER COLUMN enviado_por SET NOT NULL;
