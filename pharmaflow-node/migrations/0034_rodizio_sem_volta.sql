-- Migration 0034: corrige o comentário da coluna cursor_midia
--
-- A 0033 foi escrita e aplicada quando o rodízio recomeçava a lista do início.
-- No dia seguinte o dono cortou essa regra: "a lista acabou, acabou, não é para
-- recomeçar". Um disparo repetido agora termina por uma de duas razões — os
-- produtos acabarem, ou chegar a data de término, o que vier primeiro.
--
-- A coluna em si não muda (continua sendo o índice do próximo envio), mas o
-- COMMENT gravado pela 0033 diz "dá a volta", que virou mentira. Comentário de
-- coluna é o que a próxima pessoa lê no \d da tabela; deixar errado custa mais
-- caro que esta migration.
--
-- Sem ALTER TABLE de propósito: nada de estrutura mudou.

COMMENT ON COLUMN disparos_grupo.cursor_midia IS
  'Índice em midias_json de onde o PRÓXIMO envio começa. Avança de 3 em 3 e NÃO dá a volta: ao alcançar o fim da lista o disparo é encerrado. Sempre 0 quando repetir = nunca.';
