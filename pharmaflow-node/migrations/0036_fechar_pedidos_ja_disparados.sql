-- Migration 0036: fecha os pedidos que já viraram campanha
--
-- Não muda schema: é um acerto de DADOS, para a carteira parar de mentir.
--
-- O QUE ACONTECEU: a solicitação só era marcada 'atendida' quando o disparo
-- saía na hora ("quando = agora"). O caminho normal do gestor é AGENDAR, e
-- nesse caminho ninguém fechava o pedido — além disso a tela do passo 3 nem
-- mandava o solicitacao_id. Resultado: o cliente ficava verde na carteira
-- ("respondeu / aguardando você montar") para sempre, mesmo com a campanha
-- dele já programada e postada.
--
-- O código já está corrigido (a campanha agendada fecha o pedido, e o
-- cancelamento reabre). Falta o passado: os pendentes que já foram atendidos
-- continuam verdes porque ninguém nunca escreveu 'atendida' neles.
--
-- COMO CASAMOS: os disparos antigos foram gravados sem solicitacao_id, então
-- não dá para ligar pedido e campanha pelo id. O que existe é gestor +
-- farmácia + tempo: se saiu uma campanha DAQUELE gestor, PARA AQUELE cliente,
-- DEPOIS que o pedido chegou, aquele pedido foi atendido. Campanha cancelada
-- não conta — ela não foi ao ar, e o pedido continua de pé.
--
-- atendida_em recebe a data da campanha, não NOW(): é quando o pedido foi
-- realmente montado, e é essa data que a carteira mostra na linha.
--
-- Idempotente: rodar de novo não pega nada, porque só olha 'pendente'.

UPDATE solicitacoes_oferta s
SET    status      = 'atendida',
       -- a PRIMEIRA campanha que saiu depois do pedido é a que o atendeu
       atendida_em = (
         SELECT min(dg.criado_em)
         FROM   disparos_grupo dg
         WHERE  dg.gestor_id   = s.gestor_id
           AND  dg.farmacia_id = s.farmacia_id
           AND  dg.status     <> 'cancelado'
           AND  dg.criado_em  >= s.criado_em
       )
WHERE  s.status = 'pendente'
  AND  EXISTS (
         SELECT 1
         FROM   disparos_grupo dg
         WHERE  dg.gestor_id   = s.gestor_id
           AND  dg.farmacia_id = s.farmacia_id
           AND  dg.status     <> 'cancelado'
           AND  dg.criado_em  >= s.criado_em
       );

-- Conferência (rode depois, deve voltar 0):
--   SELECT count(*)
--   FROM   solicitacoes_oferta s
--   WHERE  s.status = 'pendente'
--     AND  EXISTS (SELECT 1 FROM disparos_grupo dg
--                  WHERE dg.gestor_id = s.gestor_id
--                    AND dg.farmacia_id = s.farmacia_id
--                    AND dg.status <> 'cancelado'
--                    AND dg.criado_em >= s.criado_em);
