-- Migration 0047: o gestor pausa UM produto de uma campanha sem cancelar a campanha
--
-- O problema (pedido do dono, 23/11/2026): o cliente escolhe os produtos, a
-- campanha é agendada e, no meio do caminho, um produto acaba o estoque ou
-- muda de preço. O preço está IMPRESSO na arte (ver midias_json), então não
-- dá para corrigir; até aqui a única saída era cancelar a campanha inteira e
-- montar tudo de novo sem aquele produto.
--
-- Agora o gestor pausa o produto no acompanhamento do disparo. Pausado, ele
-- não sai; reativado, volta para a fila. Os índices apontam para posições de
-- midias_json, que é imutável depois de criado.
--
-- midias_puladas existe para a reativação funcionar no rodízio: o cursor só
-- anda para a frente, então um produto que estava pausado quando chegou a vez
-- dele ficaria para trás para sempre. Ele é anotado aqui e, quando reativado,
-- sai na postagem seguinte. É também o que permite à tela dizer a verdade:
-- produto atrás do cursor não quer dizer "já saiu" se ele foi pulado.
--
-- Defaults vazios: as campanhas que já existem continuam exatamente como
-- estão — nada pausado, nada pulado.

ALTER TABLE disparos_grupo
  ADD COLUMN IF NOT EXISTS midias_pausadas integer[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS midias_puladas  integer[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN disparos_grupo.midias_pausadas IS
  'Índices de midias_json que o gestor pausou. Pausado não sai em postagem nenhuma até ser reativado. Só a rota PATCH /api/disparos/:id/produtos/:indice escreve aqui.';

COMMENT ON COLUMN disparos_grupo.midias_puladas IS
  'Índices de midias_json que perderam a vez no rodízio por estarem pausados e ainda devem sair. Reativado, sai na postagem seguinte. Na volta da lista (repetir_produtos) é zerado. Só o envio escreve aqui.';
